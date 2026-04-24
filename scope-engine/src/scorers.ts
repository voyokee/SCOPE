// ============================================================
// SCOPE v3.3 自动打分逻辑
// 严格按 scope.md v3.3 规则实现
// ============================================================

import type { IndicatorResult, Kline, FundingRate, YahooPrice } from './types.js';
import { sma, smaArray, linearSlope, percentileRank, changePercent, volumeRatio, atrPercentile } from './utils.js';
import type { AllFetchedData, ETFFlowDay, LiquidationInfo, StablecoinPurchasingPower } from './fetchers.js';

// ============================================================
// 周期层
// ============================================================

/**
 * 2) 10Y 折现率压力（4分）
 * 规则：
 * - 10Y 明显下行，20D 趋势向下 → 4
 * - 10Y 震荡走平 → 2-3
 * - 10Y 高位上行或重新加速上行 → 0-1
 */
export function scoreTenYear(
  fred10Y: { date: string; value: number }[]
): IndicatorResult {
  if (!fred10Y || fred10Y.length < 20) {
    return {
      id: 'cycle.ten-year', name: '10Y 折现率压力', layer: 'cycle',
      score: 2, maxScore: 4, reasoning: '数据不足，给予中性分', source: 'auto',
    };
  }

  const values = fred10Y.map((d) => d.value);
  const current = values[values.length - 1];
  const slope20d = linearSlope(values, 20);

  // 判断趋势方向
  // slope20d > 0.001 = 上行，< -0.001 = 下行，中间 = 走平
  let score: number;
  let reasoning: string;

  if (slope20d < -0.001) {
    // 明显下行
    score = 4;
    reasoning = `10Y ${current.toFixed(2)}%，20D 斜率 ${(slope20d * 100).toFixed(3)} 明显下行`;
  } else if (slope20d > 0.001) {
    // 上行
    if (slope20d > 0.003) {
      score = 0;
      reasoning = `10Y ${current.toFixed(2)}%，20D 斜率 ${(slope20d * 100).toFixed(3)} 加速上行`;
    } else {
      score = 1;
      reasoning = `10Y ${current.toFixed(2)}%，20D 斜率 ${(slope20d * 100).toFixed(3)} 温和上行`;
    }
  } else {
    // 震荡走平
    score = 2.5;
    reasoning = `10Y ${current.toFixed(2)}%，20D 斜率接近 0 震荡走平`;
  }

  return {
    id: 'cycle.ten-year', name: '10Y 折现率压力', layer: 'cycle',
    score, maxScore: 4, reasoning, rawValue: current, source: 'auto',
  };
}

/**
 * 3) DXY（3分）
 * 规则：
 * - 位于 20D、50D 下方，且 20D 向下 → 3
 * - 震荡中性 → 1-2
 * - 强势站上均线，且 20D 向上 → 0
 */
export function scoreDXY(yahooDXY: YahooPrice[]): IndicatorResult {
  if (!yahooDXY || yahooDXY.length < 50) {
    return {
      id: 'cycle.dxy', name: 'DXY', layer: 'cycle',
      score: 1.5, maxScore: 3, reasoning: '数据不足，给予中性分', source: 'auto',
    };
  }

  const closes = yahooDXY.map((d) => d.close);
  const current = closes[closes.length - 1];
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const slope20d = linearSlope(closes, 20);

  let score: number;
  let reasoning: string;

  const belowMA20 = current < ma20;
  const belowMA50 = current < ma50;
  const slopeDown = slope20d < -0.0005;
  const slopeUp = slope20d > 0.0005;

  if (belowMA20 && belowMA50 && slopeDown) {
    score = 3;
    reasoning = `DXY ${current.toFixed(2)} < 20D(${ma20.toFixed(2)}) < 50D(${ma50.toFixed(2)})，20D 向下`;
  } else if (!belowMA20 && !belowMA50 && slopeUp) {
    score = 0;
    reasoning = `DXY ${current.toFixed(2)} > 20D(${ma20.toFixed(2)}) > 50D(${ma50.toFixed(2)})，20D 向上`;
  } else if (belowMA20 || belowMA50) {
    score = 2;
    reasoning = `DXY ${current.toFixed(2)}，位于均线附近偏弱，20D 斜率 ${slopeDown ? '向下' : '走平'}`;
  } else {
    score = 1;
    reasoning = `DXY ${current.toFixed(2)}，位于均线上方但未强势，20D 斜率 ${slopeUp ? '向上' : '走平'}`;
  }

  return {
    id: 'cycle.dxy', name: 'DXY', layer: 'cycle',
    score, maxScore: 3, reasoning, rawValue: current, source: 'auto',
  };
}

/**
 * 4) 风险偏好 QQQ/VIX（3分）
 * 规则：
 * - 纳指站上 50D，VIX 低位或回落 → 3
 * - 震荡中性 → 1-2
 * - 纳指弱于 50D，VIX 上行 → 0
 */
export function scoreRiskAppetite(
  yahooQQQ: YahooPrice[],
  yahooVIX: YahooPrice[]
): IndicatorResult {
  if (!yahooQQQ || yahooQQQ.length < 50 || !yahooVIX || yahooVIX.length < 20) {
    return {
      id: 'cycle.risk-appetite', name: '风险偏好(QQQ/VIX)', layer: 'cycle',
      score: 1.5, maxScore: 3, reasoning: '数据不足，给予中性分', source: 'auto',
    };
  }

  const qqqCloses = yahooQQQ.map((d) => d.close);
  const qqqCurrent = qqqCloses[qqqCloses.length - 1];
  const qqq50d = sma(qqqCloses, 50);
  const qqqAbove50d = qqqCurrent > qqq50d;

  const vixCloses = yahooVIX.map((d) => d.close);
  const vixCurrent = vixCloses[vixCloses.length - 1];
  const vixLow = vixCurrent < 20;
  const vixSlope = linearSlope(vixCloses, 10);
  const vixFalling = vixSlope < -0.005;

  let score: number;
  let reasoning: string;

  if (qqqAbove50d && (vixLow || vixFalling)) {
    score = 3;
    reasoning = `QQQ ${qqqCurrent.toFixed(2)} > 50D(${qqq50d.toFixed(2)})，VIX ${vixCurrent.toFixed(1)} ${vixLow ? '低位' : '回落'}`;
  } else if (!qqqAbove50d && !vixLow && vixSlope > 0.005) {
    score = 0;
    reasoning = `QQQ ${qqqCurrent.toFixed(2)} < 50D(${qqq50d.toFixed(2)})，VIX ${vixCurrent.toFixed(1)} 上行`;
  } else if (qqqAbove50d) {
    score = 2;
    reasoning = `QQQ 站上 50D，但 VIX ${vixCurrent.toFixed(1)} 偏高/中性`;
  } else {
    score = 1;
    reasoning = `QQQ 弱于 50D，VIX ${vixCurrent.toFixed(1)} 中性`;
  }

  return {
    id: 'cycle.risk-appetite', name: '风险偏好(QQQ/VIX)', layer: 'cycle',
    score, maxScore: 3, reasoning, source: 'auto',
  };
}

/**
 * 5B) 稳定币水位（3分）
 * 规则：
 * - 7日和30日都扩张 → 3
 * - 30日扩张，7日持平 → 2
 * - 基本持平 → 1
 * - 7日和30日都收缩 → 0
 */
export function scoreStablecoin(
  stablecoinHistory: {
    usdt: { timestamp: number; marketCap: number }[];
    usdc: { timestamp: number; marketCap: number }[];
  }
): IndicatorResult {
  if (
    !stablecoinHistory?.usdt?.length ||
    !stablecoinHistory?.usdc?.length
  ) {
    return {
      id: 'cycle.stablecoin', name: '稳定币水位', layer: 'cycle',
      score: 1, maxScore: 3, reasoning: '数据不足，给予中性偏低分', source: 'auto',
    };
  }

  // 计算 USDT + USDC 总市值的 7D 和 30D 变化率
  const usdtData = stablecoinHistory.usdt;
  const usdcData = stablecoinHistory.usdc;

  // 取时间对齐的数据点
  const latestUsdt = usdtData[usdtData.length - 1]?.marketCap || 0;
  const latestUsdc = usdcData[usdcData.length - 1]?.marketCap || 0;
  const totalNow = latestUsdt + latestUsdc;

  // 7 日前（约第 23 个数据点，因为每天约 1 个点在 30 天数据中）
  const idx7d = Math.max(0, usdtData.length - 8);
  const total7dAgo =
    (usdtData[idx7d]?.marketCap || latestUsdt) +
    (usdcData[Math.min(idx7d, usdcData.length - 1)]?.marketCap || latestUsdc);

  // 30 日前
  const total30dAgo =
    (usdtData[0]?.marketCap || latestUsdt) +
    (usdcData[0]?.marketCap || latestUsdc);

  const change7d = total7dAgo > 0 ? ((totalNow - total7dAgo) / total7dAgo) * 100 : 0;
  const change30d = total30dAgo > 0 ? ((totalNow - total30dAgo) / total30dAgo) * 100 : 0;

  const expanding7d = change7d > 0.1; // > 0.1% 视为扩张
  const expanding30d = change30d > 0.2;
  const contracting7d = change7d < -0.1;
  const contracting30d = change30d < -0.2;

  let score: number;
  let reasoning: string;

  if (expanding7d && expanding30d) {
    score = 3;
    reasoning = `稳定币总市值 7D ${change7d > 0 ? '+' : ''}${change7d.toFixed(2)}%，30D ${change30d > 0 ? '+' : ''}${change30d.toFixed(2)}%，双扩张`;
  } else if (expanding30d && !contracting7d) {
    score = 2;
    reasoning = `稳定币 30D 扩张 ${change30d.toFixed(2)}%，7D 持平 ${change7d.toFixed(2)}%`;
  } else if (contracting7d && contracting30d) {
    score = 0;
    reasoning = `稳定币 7D ${change7d.toFixed(2)}%，30D ${change30d.toFixed(2)}%，双收缩`;
  } else {
    score = 1;
    reasoning = `稳定币 7D ${change7d.toFixed(2)}%，30D ${change30d.toFixed(2)}%，基本持平`;
  }

  return {
    id: 'cycle.stablecoin', name: '稳定币水位', layer: 'cycle',
    score, maxScore: 3, reasoning, source: 'auto',
  };
}

// ============================================================
// 结构层
// ============================================================

/**
 * 1) 价格 vs 50D / 200D（10分）— v3.3.1 增强
 *
 * v3.3 原始规则：
 * - 价格 > 50D 且 > 200D，连续 3 天以上 → 10
 * - 价格 > 50D 且接近/刚突破 200D → 7-8
 * - 价格 < 50D 但 > 200D → 4-5
 * - 价格 < 50D 且 < 200D → 0-2
 *
 * v3.3.1 补丁:
 * [改进2] 渐进式 200D 距离评分 — 取消二元判定，按距离分档
 * [改进1] 量价调节器 — 在中间地带(2-6)根据量能结构 ±1
 */
export function scorePriceVsMA(klines: Kline[]): IndicatorResult {
  if (!klines || klines.length < 200) {
    return {
      id: 'structure.price-vs-ma', name: '价格 vs 50D/200D', layer: 'structure',
      score: 5, maxScore: 10, reasoning: '数据不足200根K线，给予中性分', source: 'auto',
    };
  }

  const closes = klines.map((k) => k.close);
  const volumes = klines.map((k) => k.volume);
  const current = closes[closes.length - 1];
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);

  // 计算连续在 50D 和 200D 上方的天数
  let daysAboveBoth = 0;
  const ma50Array = smaArray(closes, 50);
  const ma200Array = smaArray(closes, 200);
  const offset = closes.length - ma200Array.length;
  const offset50 = closes.length - ma50Array.length;

  for (let i = ma200Array.length - 1; i >= 0; i--) {
    const closeIdx = i + offset;
    const ma50Idx = closeIdx - offset50;
    if (ma50Idx < 0) break;
    if (closes[closeIdx] > ma50Array[ma50Idx] && closes[closeIdx] > ma200Array[i]) {
      daysAboveBoth++;
    } else {
      break;
    }
  }

  const aboveMA50 = current > ma50;
  const aboveMA200 = current > ma200;
  const distToMA200 = ((current - ma200) / ma200) * 100; // 负数 = 在下方

  let score: number;
  let reasoning: string;

  if (aboveMA50 && aboveMA200 && daysAboveBoth >= 3) {
    score = 10;
    reasoning = `价格 ${current.toFixed(0)} > 50D(${ma50.toFixed(0)}) > 200D(${ma200.toFixed(0)})，连续 ${daysAboveBoth} 天站上`;
  } else if (aboveMA50 && aboveMA200) {
    score = 7.5;
    reasoning = `价格 > 50D 且 > 200D，但连续天数仅 ${daysAboveBoth} 天，刚突破`;
  } else if (aboveMA200 && !aboveMA50) {
    // 价格在 200D 上方但 50D 下方
    const distToMA50 = ((current - ma50) / ma50) * 100;
    score = distToMA50 > -2 ? 5 : 4;
    reasoning = `价格 < 50D(${ma50.toFixed(0)}) 但 > 200D(${ma200.toFixed(0)})，距 50D ${distToMA50.toFixed(1)}%`;
  } else if (aboveMA50 && !aboveMA200) {
    // [改进2] 价格 > 50D 但 < 200D — 渐进式距离评分
    const absDist = Math.abs(distToMA200); // 正数: 距 200D 百分比
    if (absDist < 5) {
      score = 7;      // 接近突破 200D
    } else if (absDist < 10) {
      score = 6;
    } else if (absDist < 15) {
      score = 5;
    } else if (absDist < 20) {
      score = 4;
    } else {
      score = 3;
    }
    reasoning = `价格 > 50D(${ma50.toFixed(0)})，< 200D(${ma200.toFixed(0)})，距 200D ${distToMA200.toFixed(1)}%`;
  } else {
    // 价格 < 50D 且 < 200D — 渐进式距离评分
    const absDist = Math.abs(distToMA200);
    if (absDist < 5) {
      score = 2;
    } else if (absDist < 15) {
      score = 1;
    } else {
      score = 0;
    }
    reasoning = `价格 < 50D 且 < 200D，距 200D ${distToMA200.toFixed(1)}%`;
  }

  // [改进1] 量价调节器：仅在中间地带 (2-6分) 生效
  if (score >= 2 && score <= 6) {
    const vRatio = volumeRatio(volumes, 5, 20);
    const atrPct = atrPercentile(klines, 14, 60);
    const slope20 = linearSlope(closes, 20);
    const price7dChange = changePercent(closes, 7);

    let adj = 0;
    let adjReason = '';

    if (vRatio < 0.7 && atrPct < 25) {
      // 缩量 + 波动率压缩 → 积蓄突破模式
      adj = 1;
      adjReason = `量能积蓄(量比${vRatio.toFixed(2)},ATR分位${atrPct.toFixed(0)}%)`;
    } else if (vRatio > 1.3 && price7dChange > 0) {
      // 放量 + 价格上涨 → 突破确认
      adj = 1;
      adjReason = `放量上攻(量比${vRatio.toFixed(2)},7D${price7dChange > 0 ? '+' : ''}${price7dChange.toFixed(1)}%)`;
    } else if (vRatio < 0.7 && slope20 < -0.0003) {
      // 缩量 + 下行趋势 → 衰竭模式
      adj = -1;
      adjReason = `缩量下行(量比${vRatio.toFixed(2)},20D斜率${(slope20 * 10000).toFixed(1)})`;
    } else if (vRatio > 1.3 && price7dChange < -3) {
      // 放量下跌 → 分布模式
      adj = -1;
      adjReason = `放量下跌(量比${vRatio.toFixed(2)},7D${price7dChange.toFixed(1)}%)`;
    }

    if (adj !== 0) {
      score = Math.max(0, Math.min(10, score + adj));
      reasoning += `；${adjReason} ${adj > 0 ? '+' : ''}${adj}`;
    }
  }

  return {
    id: 'structure.price-vs-ma', name: '价格 vs 50D/200D', layer: 'structure',
    score, maxScore: 10, reasoning, rawValue: current, source: 'auto',
  };
}

/**
 * 2) 20/50/200 排列与斜率（6分）
 * 规则：
 * - 20 > 50 > 200，且 20、50 都向上 → 6
 * - 排列修复中，至少 20D 上拐，50D 不下压 → 4-5
 * - 均线缠绕，趋势未组织 → 2-3
 * - 空头排列，且 20、50 向下 → 0-1
 */
export function scoreMAArrangement(klines: Kline[]): IndicatorResult {
  if (!klines || klines.length < 200) {
    return {
      id: 'structure.ma-arrangement', name: '均线排列与斜率', layer: 'structure',
      score: 3, maxScore: 6, reasoning: '数据不足，给予中性分', source: 'auto',
    };
  }

  const closes = klines.map((k) => k.close);
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);

  const slope20 = linearSlope(closes, 20);
  const slope50 = linearSlope(closes, 50);

  const bullishOrder = ma20 > ma50 && ma50 > ma200;
  const bearishOrder = ma20 < ma50 && ma50 < ma200;
  const ma20Up = slope20 > 0.0003;
  const ma50Up = slope50 > 0.0001;
  const ma20Down = slope20 < -0.0003;
  const ma50Down = slope50 < -0.0001;

  let score: number;
  let reasoning: string;

  if (bullishOrder && ma20Up && ma50Up) {
    score = 6;
    reasoning = `多头排列 20D(${ma20.toFixed(0)}) > 50D(${ma50.toFixed(0)}) > 200D(${ma200.toFixed(0)})，20D/50D 均向上`;
  } else if (ma20Up && !ma50Down) {
    // 修复中
    score = bullishOrder ? 5 : 4;
    reasoning = `${bullishOrder ? '多头排列' : '排列修复中'}，20D 上拐，50D ${ma50Up ? '向上' : '走平'}`;
  } else if (bearishOrder && ma20Down && ma50Down) {
    score = 0;
    reasoning = `空头排列，20D/50D 均向下`;
  } else if (bearishOrder) {
    score = 1;
    reasoning = `空头排列，但斜率有所收敛`;
  } else {
    // 缠绕
    score = 2.5;
    reasoning = `均线缠绕，20D=${ma20.toFixed(0)} 50D=${ma50.toFixed(0)} 200D=${ma200.toFixed(0)}，趋势未组织`;
  }

  return {
    id: 'structure.ma-arrangement', name: '均线排列与斜率', layer: 'structure',
    score, maxScore: 6, reasoning, source: 'auto',
  };
}

/**
 * 4-子项) Coinbase Premium（场内现货承接的 +3 子项）
 * 规则：
 * - Premium > 0，且 3 日均值环比上升 → 3 (改善)
 * - Premium ≈ 0 或略负，无明显趋势 → 1-2
 * - Premium 明显为负 → 0
 */
export function scoreCoinbasePremium(
  coinbasePrice: number,
  binancePrice: number
): IndicatorResult {
  if (!coinbasePrice || !binancePrice || binancePrice === 0) {
    return {
      id: 'structure.coinbase-premium', name: 'Coinbase Premium', layer: 'structure',
      score: 1.5, maxScore: 3, reasoning: '数据不可用，给予中性分', source: 'auto',
    };
  }

  const premium = ((coinbasePrice - binancePrice) / binancePrice) * 100;

  let score: number;
  let reasoning: string;

  // 注意：我们只能获取当前快照，无法计算 3 日均值趋势
  // 所以只按当前 premium 值判断，趋势部分由 Claude 在 AI 层补充
  if (premium > 0.05) {
    score = 3;
    reasoning = `Premium ${premium.toFixed(3)}% > 0，表明 Coinbase 买盘强于 Binance`;
  } else if (premium > -0.02) {
    score = 2;
    reasoning = `Premium ${premium.toFixed(3)}%，接近持平`;
  } else if (premium > -0.1) {
    score = 1;
    reasoning = `Premium ${premium.toFixed(3)}%，轻微为负`;
  } else {
    score = 0;
    reasoning = `Premium ${premium.toFixed(3)}%，明显为负，Coinbase 卖盘偏强`;
  }

  return {
    id: 'structure.coinbase-premium', name: 'Coinbase Premium', layer: 'structure',
    score, maxScore: 3, reasoning, rawValue: `${premium.toFixed(4)}%`, source: 'auto',
  };
}

/**
 * 5) BTC 相对强弱（6分）
 * A. BTC/QQQ 20日相对收益（4分）
 * B. BTC Dominance 20日变化（2分）
 */
export function scoreRelativeStrength(
  btcKlines: Kline[],
  yahooQQQ: YahooPrice[],
  btcDominanceHistory: { date: string; dominance: number }[]
): IndicatorResult {
  let scoreA = 2; // 默认中性
  let scoreB = 1;
  let reasonA = '';
  let reasonB = '';

  // A. BTC/QQQ 20日相对收益
  if (btcKlines && btcKlines.length >= 20 && yahooQQQ && yahooQQQ.length >= 20) {
    const btcCloses = btcKlines.map((k) => k.close);
    const qqqCloses = yahooQQQ.map((d) => d.close);

    const btcReturn20d = changePercent(btcCloses, 20);
    const qqqReturn20d = changePercent(qqqCloses, 20);
    const relativeReturn = btcReturn20d - qqqReturn20d;

    if (relativeReturn > 5) {
      scoreA = 4;
      reasonA = `BTC 20D ${btcReturn20d.toFixed(1)}% vs QQQ ${qqqReturn20d.toFixed(1)}%，相对收益 +${relativeReturn.toFixed(1)}% 显著为正`;
    } else if (relativeReturn > 0) {
      scoreA = 3;
      reasonA = `BTC 20D ${btcReturn20d.toFixed(1)}% vs QQQ ${qqqReturn20d.toFixed(1)}%，小幅为正`;
    } else if (relativeReturn > -5) {
      scoreA = 2;
      reasonA = `BTC 20D ${btcReturn20d.toFixed(1)}% vs QQQ ${qqqReturn20d.toFixed(1)}%，接近持平`;
    } else {
      scoreA = 0;
      reasonA = `BTC 20D ${btcReturn20d.toFixed(1)}% vs QQQ ${qqqReturn20d.toFixed(1)}%，明显为负`;
    }
  } else {
    reasonA = 'BTC/QQQ 数据不足';
  }

  // B. BTC Dominance 20日变化
  if (btcDominanceHistory && btcDominanceHistory.length >= 20) {
    const domValues = btcDominanceHistory.map((d) => d.dominance);
    const domChange = changePercent(domValues, 20);

    if (domChange > 0.5) {
      scoreB = 2;
      reasonB = `Dominance 20D 上升 ${domChange.toFixed(2)}%`;
    } else if (domChange < -0.5) {
      scoreB = 0;
      reasonB = `Dominance 20D 下降 ${domChange.toFixed(2)}%`;
    } else {
      scoreB = 1;
      reasonB = `Dominance 20D 持平 ${domChange.toFixed(2)}%`;
    }
  } else {
    reasonB = 'Dominance 历史数据不足';
  }

  const totalScore = scoreA + scoreB;

  return {
    id: 'structure.relative-strength', name: 'BTC 相对强弱', layer: 'structure',
    score: totalScore, maxScore: 6,
    reasoning: `[A] ${reasonA}(${scoreA}/4) [B] ${reasonB}(${scoreB}/2)`,
    source: 'auto',
  };
}

// ============================================================
// 脆弱性层
// ============================================================

/**
 * 1) Funding（6分）
 * 绝对阈值打分（规则 1 优先级）：
 * - |F| ≤ 0.01% → 6（中性）
 * - +0.01% ~ +0.03% → 5（温和偏多）
 * - -0.03% ~ -0.01% → 4（温和偏空）
 * - |F| 0.03%~0.06% → 2-3
 * - |F| > 0.06% → 0-1
 */
export function scoreFunding(fundingRates: FundingRate[]): IndicatorResult {
  if (!fundingRates || fundingRates.length === 0) {
    return {
      id: 'vulnerability.funding', name: 'Funding', layer: 'vulnerability',
      score: 4, maxScore: 6, reasoning: '数据不可用，给予保守中性分', source: 'auto',
    };
  }

  // 取最新一期 funding rate
  const latest = parseFloat(fundingRates[fundingRates.length - 1].fundingRate);
  const absRate = Math.abs(latest);
  const pct = latest * 100; // 转为百分比

  let score: number;
  let reasoning: string;

  if (absRate <= 0.0001) {
    score = 6;
    reasoning = `Funding ${pct.toFixed(4)}%，基本中性`;
  } else if (latest > 0.0001 && latest <= 0.0003) {
    score = 5;
    reasoning = `Funding +${pct.toFixed(4)}%，温和偏多`;
  } else if (latest < -0.0001 && latest >= -0.0003) {
    score = 4;
    reasoning = `Funding ${pct.toFixed(4)}%，温和偏空`;
  } else if (absRate > 0.0003 && absRate <= 0.0006) {
    score = latest > 0 ? 2 : 3;
    reasoning = `Funding ${pct.toFixed(4)}%，${latest > 0 ? '偏多' : '偏空'}过热`;
  } else {
    score = latest > 0 ? 0 : 1;
    reasoning = `Funding ${pct.toFixed(4)}%，极端${latest > 0 ? '多头' : '空头'}拥挤`;
  }

  return {
    id: 'vulnerability.funding', name: 'Funding', layer: 'vulnerability',
    score, maxScore: 6, reasoning, rawValue: pct, source: 'auto',
  };
}

/**
 * 2) OI 质量（7分）
 * 主规则：
 * - 价格上涨，OI 7日增幅 < 10% → 7
 * - 价格上涨，OI 7日增幅 10%-20% → 5-6
 * - 价格上涨，OI 7日增幅 > 20% → 2-4
 * - 价格停滞/下跌，OI 继续抬升 → 0-1
 *
 * Funding 上限修正：
 * - |Funding| > 0.03% → OI 上限 5
 * - |Funding| > 0.06% → OI 上限 3
 */
export function scoreOIQuality(
  oiHistory: { timestamp: number; sumOpenInterest: number }[],
  klines: Kline[],
  latestFundingRate: number
): IndicatorResult {
  if (!oiHistory || oiHistory.length < 2 || !klines || klines.length < 7) {
    return {
      id: 'vulnerability.oi-quality', name: 'OI 质量', layer: 'vulnerability',
      score: 4, maxScore: 7, reasoning: '数据不足，给予中性分', source: 'auto',
    };
  }

  // 7 日 OI 增幅
  const oiNow = oiHistory[oiHistory.length - 1].sumOpenInterest;
  const oi7dAgo = oiHistory[0].sumOpenInterest;
  const oiChange7d = oi7dAgo > 0 ? ((oiNow - oi7dAgo) / oi7dAgo) * 100 : 0;

  // 7 日价格变化
  const closesRecent = klines.slice(-8).map((k) => k.close);
  const priceChange7d = closesRecent.length >= 2
    ? ((closesRecent[closesRecent.length - 1] - closesRecent[0]) / closesRecent[0]) * 100
    : 0;
  const priceUp = priceChange7d > 1;
  const priceSideways = Math.abs(priceChange7d) <= 1;
  const priceDown = priceChange7d < -1;

  let score: number;
  let reasoning: string;

  if (priceUp && oiChange7d < 10) {
    score = 7;
    reasoning = `价格 7D +${priceChange7d.toFixed(1)}%，OI 增幅 ${oiChange7d.toFixed(1)}% < 10%，健康上涨`;
  } else if (priceUp && oiChange7d >= 10 && oiChange7d <= 20) {
    score = 5.5;
    reasoning = `价格 7D +${priceChange7d.toFixed(1)}%，OI 增幅 ${oiChange7d.toFixed(1)}%，杠杆温和抬升`;
  } else if (priceUp && oiChange7d > 20) {
    score = 3;
    reasoning = `价格 7D +${priceChange7d.toFixed(1)}%，OI 增幅 ${oiChange7d.toFixed(1)}% > 20%，杠杆过热`;
  } else if ((priceSideways || priceDown) && oiChange7d > 10) {
    score = 0.5;
    reasoning = `价格 7D ${priceChange7d.toFixed(1)}% 停滞/下跌，OI 增幅 ${oiChange7d.toFixed(1)}%，背离`;
  } else {
    score = 4;
    reasoning = `价格 7D ${priceChange7d.toFixed(1)}%，OI 增幅 ${oiChange7d.toFixed(1)}%，中性`;
  }

  // Funding 上限修正
  const absFunding = Math.abs(latestFundingRate);
  let cap = 7;
  let capNote = '';
  if (absFunding > 0.0006) {
    cap = 3;
    capNote = `，Funding |${(latestFundingRate * 100).toFixed(4)}%| > 0.06% → 上限 3`;
  } else if (absFunding > 0.0003) {
    cap = 5;
    capNote = `，Funding |${(latestFundingRate * 100).toFixed(4)}%| > 0.03% → 上限 5`;
  }

  if (score > cap) {
    score = cap;
    reasoning += capNote;
  }

  return {
    id: 'vulnerability.oi-quality', name: 'OI 质量', layer: 'vulnerability',
    score, maxScore: 7, reasoning,
    rawValue: `OI7d: ${oiChange7d.toFixed(1)}%, Price7d: ${priceChange7d.toFixed(1)}%`,
    source: 'auto',
  };
}

/**
 * 3B) 年化 Basis（3分）
 * 绝对阈值打分：
 * - < 8% → 3
 * - 8%-12% → 2
 * - 12%-18% → 1
 * - > 18% → 0
 */
export function scoreBasis(
  annualizedBasisPct: number
): IndicatorResult {
  let score: number;
  let reasoning: string;

  if (annualizedBasisPct < 0) {
    // 负基差（贴水）
    score = 3;
    reasoning = `年化基差 ${annualizedBasisPct.toFixed(2)}%，贴水，无过热`;
  } else if (annualizedBasisPct < 8) {
    score = 3;
    reasoning = `年化基差 ${annualizedBasisPct.toFixed(2)}% < 8%，健康`;
  } else if (annualizedBasisPct < 12) {
    score = 2;
    reasoning = `年化基差 ${annualizedBasisPct.toFixed(2)}%，8%-12% 区间，温和`;
  } else if (annualizedBasisPct < 18) {
    score = 1;
    reasoning = `年化基差 ${annualizedBasisPct.toFixed(2)}%，12%-18%，偏热`;
  } else {
    score = 0;
    reasoning = `年化基差 ${annualizedBasisPct.toFixed(2)}% > 18%，过热`;
  }

  return {
    id: 'vulnerability.basis', name: '年化 Basis', layer: 'vulnerability',
    score, maxScore: 3, reasoning, rawValue: `${annualizedBasisPct.toFixed(2)}%`, source: 'auto',
  };
}

/**
 * 3C 子项) 仓位一致性 / 供给扰动风险（3/4 自动子项）
 *
 * 1. 25-delta skew 未极端偏斜 → +1
 * 2. L/S Ratio 未出现明显单边 → +1
 * 3. Top Trader Positioning 未极端一致 → +1
 *
 * 第 4 项（交易所 BTC 净流入）由 Claude AI 评判
 */
export function scorePositionCrowding(
  deribitSkew: { skew25d: number } | null,
  lsRatio: { timestamp: number; longShortRatio: number }[],
  topTrader: { timestamp: number; longShortRatio: number }[]
): IndicatorResult {
  let healthyCount = 0;
  const details: string[] = [];

  // 1. 25-delta skew
  if (deribitSkew) {
    const skew = deribitSkew.skew25d;
    // "未达到近 90 日极端分位" — 由于我们没有 90 日历史，
    // 使用绝对值判断：|skew| < 10 视为非极端
    if (Math.abs(skew) < 10) {
      healthyCount++;
      details.push(`Skew ${skew.toFixed(2)} 非极端 ✓`);
    } else {
      details.push(`Skew ${skew.toFixed(2)} 极端偏斜 ✗`);
    }
  } else {
    details.push('Skew 数据不可用，假设健康 ✓');
    healthyCount++; // 保守假设
  }

  // 2. L/S Ratio
  if (lsRatio && lsRatio.length >= 10) {
    const ratios = lsRatio.map((d) => d.longShortRatio);
    const current = ratios[ratios.length - 1];
    const rank = percentileRank(ratios, current);
    // 20%-80% 区间为健康
    if (rank >= 20 && rank <= 80) {
      healthyCount++;
      details.push(`L/S Ratio ${current.toFixed(3)} 分位 ${rank.toFixed(0)}% 在 20-80% 区间 ✓`);
    } else {
      details.push(`L/S Ratio ${current.toFixed(3)} 分位 ${rank.toFixed(0)}% 单边偏极 ✗`);
    }
  } else {
    details.push('L/S Ratio 数据不足');
  }

  // 3. Top Trader
  if (topTrader && topTrader.length >= 10) {
    const ratios = topTrader.map((d) => d.longShortRatio);
    const current = ratios[ratios.length - 1];
    const rank = percentileRank(ratios, current);
    // 未达到极端分位（< 10% 或 > 90%）
    if (rank >= 10 && rank <= 90) {
      healthyCount++;
      details.push(`TopTrader ${current.toFixed(3)} 分位 ${rank.toFixed(0)}% 非极端 ✓`);
    } else {
      details.push(`TopTrader ${current.toFixed(3)} 分位 ${rank.toFixed(0)}% 极端一致 ✗`);
    }
  } else {
    details.push('TopTrader 数据不足');
  }

  return {
    id: 'vulnerability.position-crowding', name: '仓位一致性(3/4)', layer: 'vulnerability',
    score: healthyCount,
    maxScore: 3, // 3/4 由脚本评，剩余 1/4 由 Claude
    reasoning: details.join('；'),
    source: 'auto',
  };
}

// ============================================================
// 新增自动指标（v3.3.1: 替代 WebFetch）
// ============================================================

/**
 * Spot CVD 近似（场内现货承接子项，+4 分）
 * 使用 Binance klines 的 takerBuyBaseVolume / volume 比率
 * 判断标准（scope.md 0.4 章）：
 * - 24h Spot CVD 为正，且 3 日趋势非连续下行 → 改善 → 4
 * - CVD 中性 → 2
 * - CVD 明显为负 → 0-1
 */
export function scoreSpotCVD(klines: Kline[]): IndicatorResult {
  if (!klines || klines.length < 3) {
    return {
      id: 'structure.spot-cvd', name: 'Spot CVD', layer: 'structure',
      score: 2, maxScore: 4, reasoning: '数据不足，给予中性分', source: 'auto',
    };
  }

  const recent3 = klines.slice(-3);
  const latest = klines[klines.length - 1];

  // taker buy ratio: > 0.5 表示买方主导（正 CVD）
  const latestRatio = latest.volume > 0
    ? latest.takerBuyBaseVolume / latest.volume
    : 0.5;
  const cvdPositive = latestRatio > 0.50;

  // 3 日趋势：检查 ratio 是否连续下行
  const ratios = recent3.map((k) =>
    k.volume > 0 ? k.takerBuyBaseVolume / k.volume : 0.5
  );
  const declining = ratios[2] < ratios[1] && ratios[1] < ratios[0];

  // 计算 24h net taker buy 百分比（偏离 50% 的程度）
  const netBuyPct = ((latestRatio - 0.5) * 100).toFixed(2);

  let score: number;
  let reasoning: string;

  if (cvdPositive && !declining) {
    score = 4;
    reasoning = `Taker buy ratio ${(latestRatio * 100).toFixed(1)}%，买方主导且 3 日未连续下行 → 改善`;
  } else if (cvdPositive && declining) {
    score = 2.5;
    reasoning = `Taker buy ratio ${(latestRatio * 100).toFixed(1)}%，买方主导但 3 日趋势下行`;
  } else if (latestRatio > 0.48) {
    score = 2;
    reasoning = `Taker buy ratio ${(latestRatio * 100).toFixed(1)}%，接近中性`;
  } else {
    score = 0.5;
    reasoning = `Taker buy ratio ${(latestRatio * 100).toFixed(1)}%，卖方主导，CVD 明显为负`;
  }

  return {
    id: 'structure.spot-cvd', name: 'Spot CVD', layer: 'structure',
    score, maxScore: 4, reasoning, rawValue: `${netBuyPct}%`, source: 'auto',
  };
}

/**
 * ETF 周期水位（4 分）+ ETF 短期承接（10 分）
 * 基于 CoinGlass ETF 每日净流量数据
 */
export function scoreETFCycle(etfFlows: ETFFlowDay[]): IndicatorResult {
  if (!etfFlows || etfFlows.length < 10) {
    return {
      id: 'cycle.etf-cycle', name: 'ETF 周期水位', layer: 'cycle',
      score: 2, maxScore: 4, reasoning: 'ETF 数据不足，给予中性分', source: 'auto',
    };
  }

  const flows = etfFlows.map((d) => d.totalNetInflow);
  const last10 = flows.slice(-10);
  const last20 = flows.slice(-20);

  const sum10 = last10.reduce((a, b) => a + b, 0);
  const sum20 = last20.reduce((a, b) => a + b, 0);

  let score: number;
  let reasoning: string;

  // 单位：美元
  const sum10m = (sum10 / 1e6).toFixed(1);
  const sum20m = (sum20 / 1e6).toFixed(1);

  if (sum20 > 0 && sum10 > 0) {
    score = 4;
    reasoning = `20D 净流 +${sum20m}M 且 10D 净流 +${sum10m}M，双正`;
  } else if (sum20 > 0) {
    score = 3;
    reasoning = `20D 净流 +${sum20m}M，10D 净流 ${sum10m}M 一般`;
  } else if (Math.abs(sum20) < sum20 * 0.1) {
    score = 2;
    reasoning = `20D 净流 ${sum20m}M 接近持平`;
  } else if (sum10 < 0 && sum20 < 0) {
    score = 0;
    reasoning = `10D 净流 ${sum10m}M 和 20D 净流 ${sum20m}M 都为负`;
  } else {
    score = 1;
    reasoning = `20D 净流 ${sum20m}M 明显为负`;
  }

  return {
    id: 'cycle.etf-cycle', name: 'ETF 周期水位', layer: 'cycle',
    score, maxScore: 4, reasoning, source: 'auto',
  };
}

export function scoreETFShortTerm(etfFlows: ETFFlowDay[]): IndicatorResult {
  if (!etfFlows || etfFlows.length < 5) {
    return {
      id: 'structure.etf-short-term', name: 'ETF 短期承接', layer: 'structure',
      score: 5, maxScore: 10, reasoning: 'ETF 数据不足，给予中性分', source: 'auto',
    };
  }

  const last5 = etfFlows.slice(-5);
  const flows5 = last5.map((d) => d.totalNetInflow);
  const sum5 = flows5.reduce((a, b) => a + b, 0);
  const sum3 = flows5.slice(-3).reduce((a, b) => a + b, 0);
  const inflowDays = flows5.filter((f) => f > 0).length;

  const sum5m = (sum5 / 1e6).toFixed(1);

  let score: number;
  let reasoning: string;

  if (sum5 > 0 && inflowDays >= 4) {
    score = 10;
    reasoning = `5D 净流 +${sum5m}M，${inflowDays}/5 天净流入，承接强劲`;
  } else if (sum5 > 0 && inflowDays >= 3) {
    score = 7.5;
    reasoning = `5D 净流 +${sum5m}M，${inflowDays}/5 天净流入`;
  } else if (sum5 > 0 || (sum3 > 0 && inflowDays >= 2)) {
    score = 5;
    reasoning = `5D 净流 ${sum5m}M，${inflowDays}/5 天净流入，承接一般`;
  } else if (sum5 < 0 && inflowDays >= 2) {
    score = 2.5;
    reasoning = `5D 净流 ${sum5m}M 为负，但仍有 ${inflowDays} 天净流入`;
  } else {
    score = 0.5;
    reasoning = `5D 净流 ${sum5m}M，仅 ${inflowDays}/5 天净流入，承接明显转弱`;
  }

  return {
    id: 'structure.etf-short-term', name: 'ETF 短期承接', layer: 'structure',
    score, maxScore: 10, reasoning, source: 'auto',
  };
}

/**
 * 稳定币购买力（场内现货承接子项，+3 分）
 * 使用 DefiLlama 全稳定币供给变化作为交易所稳定币流入的 proxy
 *
 * 规则：
 * - 7D 扩张 > 0.3% 且 30D 扩张 > 0.5% → 3（强扩张，购买力充沛）
 * - 30D 扩张 > 0.3%，7D 非收缩 → 2（温和扩张）
 * - 基本持平（|7D| < 0.3% 且 |30D| < 0.3%）→ 1（中性）
 * - 7D 和 30D 都收缩 → 0（购买力萎缩）
 */
export function scoreStablecoinPurchasingPower(
  data: StablecoinPurchasingPower | null
): IndicatorResult {
  if (!data) {
    return {
      id: 'structure.stablecoin-purchasing-power', name: '稳定币购买力', layer: 'structure',
      score: 1.5, maxScore: 3, reasoning: '数据不可用，给予中性分', source: 'auto',
    };
  }

  const { change7dPct, change30dPct, totalCirculatingUSD } = data;
  const totalB = (totalCirculatingUSD / 1e9).toFixed(1);

  let score: number;
  let reasoning: string;

  if (change7dPct > 0.3 && change30dPct > 0.5) {
    score = 3;
    reasoning = `稳定币总量 ${totalB}B，7D +${change7dPct.toFixed(2)}% 30D +${change30dPct.toFixed(2)}%，强扩张`;
  } else if (change30dPct > 0.3 && change7dPct > -0.1) {
    score = 2;
    reasoning = `稳定币总量 ${totalB}B，30D +${change30dPct.toFixed(2)}%，7D ${change7dPct > 0 ? '+' : ''}${change7dPct.toFixed(2)}%，温和扩张`;
  } else if (change7dPct < -0.1 && change30dPct < -0.1) {
    score = 0;
    reasoning = `稳定币总量 ${totalB}B，7D ${change7dPct.toFixed(2)}% 30D ${change30dPct.toFixed(2)}%，双收缩`;
  } else {
    score = 1;
    reasoning = `稳定币总量 ${totalB}B，7D ${change7dPct > 0 ? '+' : ''}${change7dPct.toFixed(2)}% 30D ${change30dPct > 0 ? '+' : ''}${change30dPct.toFixed(2)}%，基本持平`;
  }

  return {
    id: 'structure.stablecoin-purchasing-power', name: '稳定币购买力', layer: 'structure',
    score, maxScore: 3, reasoning,
    rawValue: `7D: ${change7dPct.toFixed(2)}%, 30D: ${change30dPct.toFixed(2)}%`,
    source: 'auto',
  };
}

/**
 * 清算脆弱性（5 分）
 * 主方案：CoinGlass 清算热图数据（如有 API key）
 * Proxy 方案：OI 增幅 + Funding 拥挤度 + 价格距近期极值位置
 *
 * Proxy 逻辑：
 * - 基础分 3（中性）
 * - OI 7D 增幅 > 20%: -1.5 | > 10%: -0.5
 * - |Funding| > 0.06%: -1 | > 0.03%: -0.5
 * - 价格在 14D range 的上 10% 或下 10%（极端位置）: -0.5
 * - OI 平稳 + Funding 中性: +1.5
 * - clamp to [0, 5]
 */
export function scoreLiquidation(
  liquidation: LiquidationInfo | null,
  proxyData?: {
    oiHistory: { timestamp: number; sumOpenInterest: number }[];
    klines: Kline[];
    fundingRate: number;
  }
): IndicatorResult {
  // 主方案：CoinGlass 清算数据
  if (liquidation && liquidation.nearestLiqPctFromPrice < 100) {
    const pct = liquidation.nearestLiqPctFromPrice;
    const dir = liquidation.direction === 'long' ? '多头' : '空头';

    let score: number;
    let reasoning: string;

    if (pct > 6) {
      score = 5;
      reasoning = `最近${dir}清算密集区距现价 ${pct.toFixed(1)}% > 6%，安全`;
    } else if (pct >= 3) {
      score = pct > 4.5 ? 4 : 3;
      reasoning = `最近${dir}清算密集区距现价 ${pct.toFixed(1)}%，3-6% 区间`;
    } else if (pct >= 1.5) {
      score = pct > 2.25 ? 2 : 1;
      reasoning = `最近${dir}清算密集区距现价 ${pct.toFixed(1)}%，1.5-3% 偏近`;
    } else {
      score = 0;
      reasoning = `最近${dir}清算密集区距现价 ${pct.toFixed(1)}% < 1.5%，极危险`;
    }

    return {
      id: 'vulnerability.liquidation', name: '清算脆弱性', layer: 'vulnerability',
      score, maxScore: 5, reasoning,
      rawValue: `${pct.toFixed(1)}% (${dir})`,
      source: 'auto',
    };
  }

  // Proxy 方案：用 OI + Funding + Price 推断
  if (proxyData && proxyData.oiHistory.length >= 2 && proxyData.klines.length >= 14) {
    let score = 3; // 基础中性
    const details: string[] = ['[proxy]'];

    // OI 7D 增幅
    const oiNow = proxyData.oiHistory[proxyData.oiHistory.length - 1].sumOpenInterest;
    const oi7dAgo = proxyData.oiHistory[0].sumOpenInterest;
    const oiChange = oi7dAgo > 0 ? ((oiNow - oi7dAgo) / oi7dAgo) * 100 : 0;

    if (oiChange > 20) {
      score -= 1.5;
      details.push(`OI 7D +${oiChange.toFixed(1)}% 杠杆激增`);
    } else if (oiChange > 10) {
      score -= 0.5;
      details.push(`OI 7D +${oiChange.toFixed(1)}% 温和抬升`);
    } else if (oiChange < 5) {
      score += 1.5;
      details.push(`OI 7D ${oiChange.toFixed(1)}% 平稳`);
    } else {
      details.push(`OI 7D +${oiChange.toFixed(1)}%`);
    }

    // Funding 拥挤度
    const absF = Math.abs(proxyData.fundingRate);
    if (absF > 0.0006) {
      score -= 1;
      details.push(`|Funding| ${(absF * 100).toFixed(4)}% 极端`);
    } else if (absF > 0.0003) {
      score -= 0.5;
      details.push(`|Funding| ${(absF * 100).toFixed(4)}% 偏热`);
    } else {
      details.push(`Funding 中性`);
    }

    // 价格距 14D range 的位置
    const recent14 = proxyData.klines.slice(-14);
    const high14 = Math.max(...recent14.map((k) => k.high));
    const low14 = Math.min(...recent14.map((k) => k.low));
    const range = high14 - low14;
    const current = proxyData.klines[proxyData.klines.length - 1].close;
    if (range > 0) {
      const position = (current - low14) / range; // 0=最低, 1=最高
      if (position > 0.9 || position < 0.1) {
        score -= 0.5;
        details.push(`价格处于 14D range ${(position * 100).toFixed(0)}% 极端位置`);
      }
    }

    // [v3.3.1 改进3] 假平静检测：波动率压缩 + 缩量 = 潜在风险
    const proxyVolumes = proxyData.klines.map((k) => k.volume);
    const vRatio = volumeRatio(proxyVolumes, 5, 20);
    const atrPct = atrPercentile(proxyData.klines, 14, 60);

    if (atrPct < 15 && vRatio < 0.65) {
      // 波动率极度压缩 + 成交量萎缩 = "暴风前的宁静"
      score -= 1.5;
      details.push(`假平静: ATR分位${atrPct.toFixed(0)}%+量比${vRatio.toFixed(2)}`);
    } else if (oiChange > 5 && vRatio < 0.75) {
      // OI 上升但成交量下降 = "薄量加杠杆"
      score -= 1.0;
      details.push(`薄量加杠杆: OI+${oiChange.toFixed(1)}%但量比${vRatio.toFixed(2)}`);
    } else if (atrPct < 20 || vRatio < 0.7) {
      // 单一信号轻度预警
      score -= 0.5;
      details.push(`波动率偏低(ATR分位${atrPct.toFixed(0)}%)或量能不足(${vRatio.toFixed(2)})`);
    }

    score = Math.max(0, Math.min(5, score));

    return {
      id: 'vulnerability.liquidation', name: '清算脆弱性', layer: 'vulnerability',
      score, maxScore: 5,
      reasoning: details.join('；'),
      rawValue: `proxy: OI ${oiChange.toFixed(1)}%`,
      source: 'auto',
    };
  }

  // 两种方案都无数据
  return {
    id: 'vulnerability.liquidation', name: '清算脆弱性', layer: 'vulnerability',
    score: 2.5, maxScore: 5, reasoning: '清算数据不可用，给予中性保守分', source: 'auto',
  };
}
