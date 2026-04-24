// ============================================================
// SCOPE v3.3 自动评分引擎 — 主入口
// 运行方式: npx tsx src/index.ts
// 输出: JSON → stdout (供 Claude Skill 读取)
// ============================================================

import 'dotenv/config';

// 处理 SSL 证书链问题（公司代理 / 自签名证书场景）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { fetchAllData } from './fetchers.js';
import {
  scoreMacroConditions,
  scoreStablecoin,
  scorePriceVsMA,
  scoreMAArrangement,
  scoreCoinbasePremium,
  scoreRelativeStrength,
  scoreFunding,
  scoreOIQuality,
  scoreBasis,
  scorePositionCrowding,
  scoreSpotCVD,
  scoreETFCycle,
  scoreETFShortTerm,
  scoreLiquidation,
  scoreStablecoinPurchasingPower,
} from './scorers.js';
import {
  findSwingPoints,
  klinesToPricePoints,
  getQuarterlyExpiry,
  annualizedBasis as calcAnnualizedBasis,
  changePercent,
  volumeRatio as calcVolumeRatio,
  atrPercentile as calcAtrPercentile,
} from './utils.js';
import type { IndicatorResult, ScriptOutput } from './types.js';

async function main(): Promise<void> {
  const startTime = Date.now();

  // 1. 并行获取所有 API 数据
  process.stderr.write('正在获取市场数据...\n');
  const { data, errors } = await fetchAllData();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stderr.write(`数据获取完成 (${elapsed}s)，${errors.length} 个错误\n`);
  if (errors.length > 0) {
    process.stderr.write(`错误列表:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
  }

  // 2. 逐指标打分
  const indicators: IndicatorResult[] = [];

  // --- 周期层 ---

  // 宏观环境（v4.0: 合并原 10Y + DXY + 风险偏好，8分）
  indicators.push(scoreMacroConditions(
    data.fred10Y || [], data.yahooDXY || [],
    data.yahooQQQ || [], data.yahooVIX || [],
  ));

  // 稳定币水位
  indicators.push(
    scoreStablecoin(
      data.stablecoinHistory || { usdt: [], usdc: [] }
    )
  );

  // --- 结构层 ---

  // 价格 vs 50D/200D
  indicators.push(scorePriceVsMA(data.binanceKlines || []));

  // 均线排列与斜率
  indicators.push(scoreMAArrangement(data.binanceKlines || []));

  // Coinbase Premium
  const btcPrice =
    data.binanceKlines && data.binanceKlines.length > 0
      ? data.binanceKlines[data.binanceKlines.length - 1].close
      : 0;
  indicators.push(scoreCoinbasePremium(data.coinbasePrice || 0, btcPrice));

  // Spot CVD（场内现货承接子项，使用 taker buy volume）
  indicators.push(scoreSpotCVD(data.binanceKlines || []));

  // 稳定币购买力（场内现货承接子项，DefiLlama 数据）
  indicators.push(scoreStablecoinPurchasingPower(data.defiLlamaStablecoins || null));

  // ETF 周期水位（CoinGlass 数据）
  indicators.push(scoreETFCycle(data.coinglassETF || []));

  // ETF 短期承接（CoinGlass 数据）
  indicators.push(scoreETFShortTerm(data.coinglassETF || []));

  // BTC 相对强弱
  indicators.push(
    scoreRelativeStrength(
      data.binanceKlines || [],
      data.yahooQQQ || [],
      data.btcDominanceHistory || []
    )
  );

  // --- 脆弱性层 ---

  // Funding
  const fundingResult = scoreFunding(data.binanceFunding || []);
  indicators.push(fundingResult);

  // 最新 funding rate（供 OI 质量的上限修正）
  const latestFundingRate =
    data.binanceFunding && data.binanceFunding.length > 0
      ? parseFloat(data.binanceFunding[data.binanceFunding.length - 1].fundingRate)
      : 0;

  // OI 7日变化率（共享变量，供 OI 质量和 Basis 使用）
  let oiChange7dPct = 0;
  const oiHist = data.binanceOIHistory || [];
  if (oiHist.length >= 2) {
    const oiNow = oiHist[oiHist.length - 1].sumOpenInterest;
    const oi7dAgo = oiHist[0].sumOpenInterest;
    oiChange7dPct = oi7dAgo > 0 ? ((oiNow - oi7dAgo) / oi7dAgo) * 100 : 0;
  }

  // OI 质量（内含 Funding 上限修正）
  indicators.push(
    scoreOIQuality(
      oiHist,
      data.binanceKlines || [],
      latestFundingRate
    )
  );

  // 年化 Basis（v4.0: 传入 OI 变化率作为杠杆趋势信号）
  let annualizedBasisPct = 0;
  if (data.binanceQuarterlyPrice && btcPrice > 0 && (data.daysToExpiry ?? 0) > 0) {
    annualizedBasisPct = calcAnnualizedBasis(
      data.binanceQuarterlyPrice,
      btcPrice,
      data.daysToExpiry!
    );
  }
  indicators.push(scoreBasis(annualizedBasisPct, oiChange7dPct));

  // 清算脆弱性（CoinGlass 数据 → proxy 兜底: OI+Funding+Price）
  indicators.push(
    scoreLiquidation(data.coinglassLiquidation || null, {
      oiHistory: data.binanceOIHistory || [],
      klines: data.binanceKlines || [],
      fundingRate: latestFundingRate,
    })
  );

  // 仓位一致性（3/4 子项）
  indicators.push(
    scorePositionCrowding(
      data.deribitSkew || null,
      data.binanceLSRatio || [],
      data.binanceTopTrader || []
    )
  );

  // 3. 准备原始数据供 Claude 进一步分析
  const klines = data.binanceKlines || [];
  const priceHistory = klinesToPricePoints(klines.slice(-60)); // 近 60 日
  const swingPoints = findSwingPoints(klines.slice(-90), 3); // 近 90 日摆动点
  const btc7dChange =
    klines.length >= 8
      ? changePercent(
          klines.map((k) => k.close),
          7
        )
      : 0;
  const btc1dChange =
    klines.length >= 2
      ? changePercent(
          klines.map((k) => k.close),
          1
        )
      : 0;
  const closes = klines.map((k) => k.close);
  let ma50 = 0;
  let ma200 = 0;
  let volRatio: number | undefined;
  let atrPct: number | undefined;
  try {
    const { sma } = await import('./utils.js');
    if (closes.length >= 50) ma50 = sma(closes, 50);
    if (closes.length >= 200) ma200 = sma(closes, 200);
    // [v3.3.1] 量能-波动率指标
    const volumes = klines.map((k) => k.volume);
    if (volumes.length >= 20) volRatio = calcVolumeRatio(volumes, 5, 20);
    if (klines.length >= 75) atrPct = calcAtrPercentile(klines, 14, 60);
  } catch {}

  // 4. 组装非计分参考指标
  const reference: ScriptOutput['reference'] = {};
  if (data.fearGreedIndex) {
    reference.fearGreed = {
      value: data.fearGreedIndex.value,
      label: data.fearGreedIndex.label,
    };
  }
  // Bitbo ETF AUM 快照（供 Claude Skill 对比上日值推导流入方向）
  if (data.bitboETFAUM) {
    (reference as any).bitboETFAUM = data.bitboETFAUM;
  }

  // 5. 组装输出
  const output: ScriptOutput = {
    timestamp: new Date().toISOString(),
    btcPrice,
    indicators,
    rawData: {
      priceHistory,
      swingPoints,
      latestFundingRate,
      btc7dChange,
      btc1dChange,
      ma50,
      ma200,
      volumeRatio: volRatio,
      atrPercentile: atrPct,
    },
    reference,
    errors,
  };

  // 6. JSON 输出到 stdout
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  process.stderr.write(`致命错误: ${err.message}\n`);
  // 即使出错也输出一个最小结构，让 Claude 知道发生了什么
  const fallback: ScriptOutput = {
    timestamp: new Date().toISOString(),
    btcPrice: 0,
    indicators: [],
    rawData: {
      priceHistory: [],
      swingPoints: [],
      latestFundingRate: 0,
      btc7dChange: 0,
      btc1dChange: 0,
      ma50: 0,
      ma200: 0,
    },
    errors: [`致命错误: ${err.message}`],
  };
  console.log(JSON.stringify(fallback, null, 2));
  process.exit(1);
});
