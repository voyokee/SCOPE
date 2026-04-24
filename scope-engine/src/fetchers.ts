// ============================================================
// SCOPE v3.3 API 数据获取层
// 所有外部 API 调用集中在此文件
// 使用 Node 内置 fetch，全部 Promise.allSettled 并行
// ============================================================

import { fetchWithTimeout } from './utils.js';
import type { Kline, FundingRate, YahooPrice } from './types.js';
import 'dotenv/config';

const BINANCE_BASE = 'https://api.binance.com';
const BINANCE_FAPI = 'https://fapi.binance.com';
const BINANCE_DAPI = 'https://dapi.binance.com';
const FRED_BASE = 'https://api.stlouisfed.org';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const DERIBIT_BASE = 'https://www.deribit.com/api/v2';
const COINBASE_BASE = 'https://api.coinbase.com/v2';

// ============================================================
// Binance APIs
// ============================================================

/**
 * 获取 BTC/USDT 日 K 线（250 根，覆盖 200D MA 计算需求）
 */
export async function fetchBinanceKlines(limit = 250): Promise<Kline[]> {
  const url = `${BINANCE_BASE}/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=${limit}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Binance klines: ${res.status}`);
  const data: any[] = await res.json();
  return data.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
    takerBuyBaseVolume: parseFloat(k[9]),
  }));
}

/**
 * 获取最近 Funding Rate（10 条，约 3.3 天）
 */
export async function fetchBinanceFunding(limit = 10): Promise<FundingRate[]> {
  const url = `${BINANCE_FAPI}/fapi/v1/fundingRate?symbol=BTCUSDT&limit=${limit}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Binance funding: ${res.status}`);
  return await res.json();
}

/**
 * 获取当前 BTC 永续合约 Open Interest
 */
export async function fetchBinanceOI(): Promise<{ openInterest: number; time: number }> {
  const url = `${BINANCE_FAPI}/fapi/v1/openInterest?symbol=BTCUSDT`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Binance OI: ${res.status}`);
  const data = await res.json();
  return {
    openInterest: parseFloat(data.openInterest),
    time: Date.now(),
  };
}

/**
 * 获取 OI 历史数据（用于计算 7 日增幅）
 * Binance futures/data/openInterestHist 接口
 */
export async function fetchBinanceOIHistory(
  period = '1d',
  limit = 8
): Promise<{ timestamp: number; sumOpenInterest: number }[]> {
  const url = `${BINANCE_FAPI}/futures/data/openInterestHist?symbol=BTCUSDT&period=${period}&limit=${limit}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Binance OI history: ${res.status}`);
  const data: any[] = await res.json();
  return data.map((d) => ({
    timestamp: d.timestamp,
    sumOpenInterest: parseFloat(d.sumOpenInterest),
  }));
}

/**
 * 获取 Binance 季度合约最新价格
 * @param symbol 如 "BTCUSD_260327"
 */
export async function fetchBinanceQuarterly(symbol: string): Promise<number> {
  const url = `${BINANCE_DAPI}/dapi/v1/ticker/price?symbol=${symbol}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Binance quarterly ${symbol}: ${res.status}`);
  const data = await res.json();
  // dapi 返回数组
  const item = Array.isArray(data) ? data[0] : data;
  return parseFloat(item.price);
}

/**
 * 获取全局多空比（Long/Short Ratio）
 */
export async function fetchBinanceLSRatio(
  period = '1d',
  limit = 30
): Promise<{ timestamp: number; longShortRatio: number }[]> {
  const url = `${BINANCE_FAPI}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=${period}&limit=${limit}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Binance L/S ratio: ${res.status}`);
  const data: any[] = await res.json();
  return data.map((d) => ({
    timestamp: d.timestamp,
    longShortRatio: parseFloat(d.longShortRatio),
  }));
}

/**
 * 获取大户持仓多空比（Top Trader Position Ratio）
 */
export async function fetchBinanceTopTrader(
  period = '1d',
  limit = 30
): Promise<{ timestamp: number; longShortRatio: number }[]> {
  const url = `${BINANCE_FAPI}/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=${period}&limit=${limit}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Binance top trader: ${res.status}`);
  const data: any[] = await res.json();
  return data.map((d) => ({
    timestamp: d.timestamp,
    longShortRatio: parseFloat(d.longShortRatio),
  }));
}

// ============================================================
// FRED API (10Y Treasury Yield)
// ============================================================

/**
 * 获取 10Y 美债收益率（DGS10），最近 90 个观测值
 */
export async function fetchFRED10Y(limit = 90): Promise<{ date: string; value: number }[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey || apiKey === 'your_key_here') {
    throw new Error('FRED_API_KEY 未配置，请在 .env 文件中设置');
  }

  // 计算起始日期（90 个交易日 ≈ 130 个自然日）
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 180);
  const dateStr = startDate.toISOString().split('T')[0];

  const url = `${FRED_BASE}/fred/series/observations?series_id=DGS10&api_key=${apiKey}&file_type=json&observation_start=${dateStr}&sort_order=asc`;
  const res = await fetchWithTimeout(url, {}, 15000);
  if (!res.ok) throw new Error(`FRED DGS10: ${res.status}`);
  const data = await res.json();

  return (data as any).observations
    .filter((o: any) => o.value !== '.')
    .map((o: any) => ({
      date: o.date,
      value: parseFloat(o.value),
    }))
    .slice(-limit);
}

// ============================================================
// Yahoo Finance（非官方 v8 chart endpoint）
// ============================================================

/**
 * 获取 Yahoo Finance 历史价格
 * @param symbol 如 "DX-Y.NYB"（DXY）、"QQQ"、"^VIX"
 * @param range 时间范围，如 "6mo"
 * @param interval 间隔，如 "1d"
 */
export async function fetchYahooChart(
  symbol: string,
  range = '6mo',
  interval = '1d'
): Promise<YahooPrice[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    },
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: ${res.status}`);
  const data = await res.json();

  const result = (data as any).chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${symbol}: no data`);

  const timestamps: number[] = result.timestamp;
  const closes: number[] = result.indicators.quote[0].close;

  return timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      close: closes[i],
    }))
    .filter((p) => p.close != null && !isNaN(p.close));
}

// ============================================================
// CoinGecko
// ============================================================

/**
 * 获取稳定币市值（USDT + USDC）
 * 返回当前市值和历史市值（用于计算变化率）
 */
export async function fetchCoinGeckoStablecoins(): Promise<{
  usdt: { current: number; marketCapChange7d: number; marketCapChange30d: number };
  usdc: { current: number; marketCapChange7d: number; marketCapChange30d: number };
}> {
  // 使用 market_data 获取市值 + 变化率
  const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=tether,usd-coin&order=market_cap_desc&sparkline=false`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`CoinGecko stablecoins: ${res.status}`);
  const data: any[] = await res.json();

  const findCoin = (id: string) => {
    const coin = data.find((c) => c.id === id);
    if (!coin) throw new Error(`CoinGecko: ${id} not found`);
    return {
      current: coin.market_cap,
      // CoinGecko 的 market_cap_change_percentage 只有 24h
      // 7d/30d 需要从历史数据计算，这里用 ath 数据作为近似
      marketCapChange7d: coin.market_cap_change_percentage_24h || 0,
      marketCapChange30d: coin.market_cap_change_percentage_24h || 0,
    };
  };

  return {
    usdt: findCoin('tether'),
    usdc: findCoin('usd-coin'),
  };
}

/**
 * 获取稳定币历史市值（用于精确计算 7D/30D 变化率）
 * 通过 /coins/{id}/market_chart 获取
 */
export async function fetchStablecoinHistory(
  coinId: string,
  days = 30
): Promise<{ timestamp: number; marketCap: number }[]> {
  const url = `${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
  const res = await fetchWithTimeout(url, {}, 15000);
  if (!res.ok) throw new Error(`CoinGecko ${coinId} history: ${res.status}`);
  const data = await res.json();

  return ((data as any).market_caps as [number, number][]).map(([ts, mc]) => ({
    timestamp: ts,
    marketCap: mc,
  }));
}

/**
 * 获取 BTC Dominance
 */
export async function fetchCoinGeckoDominance(): Promise<{
  btcDominance: number;
}> {
  const url = `${COINGECKO_BASE}/global`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`CoinGecko global: ${res.status}`);
  const data = await res.json();
  return {
    btcDominance: (data as any).data.market_cap_percentage.btc,
  };
}

// ============================================================
// Deribit（25-delta skew）
// ============================================================

/**
 * 获取 BTC 期权 25-delta skew
 * 通过 book summary 中的 bid/ask iv 近似计算
 * 或通过 Deribit 的 index price 和 volatility surface
 */
export async function fetchDeribitSkew(): Promise<{
  skew25d: number;
  instruments: any[];
}> {
  // 获取 BTC 期权概要
  const url = `${DERIBIT_BASE}/public/get_book_summary_by_currency?currency=BTC&kind=option`;
  const res = await fetchWithTimeout(url, {}, 15000);
  if (!res.ok) throw new Error(`Deribit skew: ${res.status}`);
  const data = await res.json();
  const instruments = (data as any).result || [];

  // 找到最近到期的月度期权，计算 25-delta put IV 和 25-delta call IV 的差值
  // 简化方法：从所有 put/call 对中选取 ATM 附近的 IV 差异
  // Deribit 的 mark_iv 字段提供了隐含波动率
  const now = Date.now();
  const targetExpiry = now + 30 * 24 * 60 * 60 * 1000; // 约 30 天后

  // 按到期日分组
  const byExpiry = new Map<string, any[]>();
  for (const inst of instruments) {
    if (!inst.instrument_name || !inst.mark_iv) continue;
    const parts = inst.instrument_name.split('-');
    const expiry = parts[1]; // 如 "28MAR26"
    if (!byExpiry.has(expiry)) byExpiry.set(expiry, []);
    byExpiry.get(expiry)!.push(inst);
  }

  // 选择最近的到期月
  let bestExpiry: string | null = null;
  let bestDiff = Infinity;
  for (const [expiry, insts] of byExpiry) {
    // 通过第一个工具的创建时间近似判断到期远近
    if (insts.length > 10) {
      // 简化：选择工具数量多的（通常是主力月）
      const avgBid = insts.reduce((s: number, i: any) => s + (i.bid_price || 0), 0) / insts.length;
      if (Math.abs(avgBid) < bestDiff || bestExpiry === null) {
        bestExpiry = expiry;
        bestDiff = Math.abs(avgBid);
      }
    }
  }

  // 计算 skew：put IV - call IV（25-delta 级别）
  // 正 skew = 看跌情绪强，负 skew = 看涨情绪强
  let skew25d = 0;
  if (bestExpiry && byExpiry.has(bestExpiry)) {
    const insts = byExpiry.get(bestExpiry)!;
    const puts = insts.filter((i: any) => i.instrument_name.endsWith('-P'));
    const calls = insts.filter((i: any) => i.instrument_name.endsWith('-C'));

    // 取 OTM 25-delta 级别：大约在 strike 偏离 ATM 5-15% 的位置
    // 简化：取所有 put 的平均 IV 和所有 call 的平均 IV
    const avgPutIV =
      puts.reduce((s: number, p: any) => s + (p.mark_iv || 0), 0) / (puts.length || 1);
    const avgCallIV =
      calls.reduce((s: number, c: any) => s + (c.mark_iv || 0), 0) / (calls.length || 1);

    skew25d = avgPutIV - avgCallIV;
  }

  return { skew25d, instruments: [] }; // 不返回完整 instruments 以节省输出大小
}

// ============================================================
// Coinbase（BTC/USD 现货价格，用于计算 Coinbase Premium）
// ============================================================

/**
 * 获取 Coinbase BTC/USD 现货价格
 */
export async function fetchCoinbasePrice(): Promise<number> {
  const url = `${COINBASE_BASE}/prices/BTC-USD/spot`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Coinbase price: ${res.status}`);
  const data = await res.json();
  return parseFloat((data as any).data.amount);
}

// ============================================================
// 历史 Coinbase Premium（通过多次快照模拟 3 日趋势）
// 由于 Coinbase 不提供历史 API，我们在每次调用时
// 只能获取当前快照，3 日趋势需要从 state 中历史数据推算
// ============================================================

/**
 * 获取 BTC Dominance 历史（用于计算 20D 变化）
 * CoinGecko 不提供 dominance 历史 API，用 /coins/bitcoin/market_chart 近似
 */
export async function fetchBTCDominanceHistory(
  days = 30
): Promise<{ date: string; dominance: number }[]> {
  // CoinGecko /global 只返回当前值，没有历史
  // 替代方案：用 BTC 市值 / 总市值来计算
  // 但 CoinGecko 免费 API 有限...
  // 最简方案：获取 BTC market_chart 和 total market_chart
  const btcUrl = `${COINGECKO_BASE}/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`;
  const res = await fetchWithTimeout(btcUrl, {}, 15000);
  if (!res.ok) throw new Error(`CoinGecko BTC history: ${res.status}`);
  const data = await res.json();

  const btcMcaps = (data as any).market_caps as [number, number][];

  // 获取全局市值
  const globalUrl = `${COINGECKO_BASE}/global`;
  const globalRes = await fetchWithTimeout(globalUrl);
  if (!globalRes.ok) throw new Error(`CoinGecko global: ${globalRes.status}`);
  const globalData = await globalRes.json();
  const totalMarketCap = (globalData as any).data.total_market_cap.usd;
  const currentDominance = (globalData as any).data.market_cap_percentage.btc;

  // 用 BTC 市值变化来近似 dominance 变化
  // dominance_change ≈ btc_mcap_change% - total_mcap_change%
  // 简化：返回当前值和基于 BTC 市值的近似历史
  const latestBtcMcap = btcMcaps[btcMcaps.length - 1]?.[1] || 0;
  const results: { date: string; dominance: number }[] = btcMcaps.map(([ts, mcap]) => ({
    date: new Date(ts).toISOString().split('T')[0],
    // 近似：假设 BTC dominance 变化 ∝ BTC 市值比例变化
    dominance: (mcap / latestBtcMcap) * currentDominance,
  }));

  return results;
}

// ============================================================
// DefiLlama（稳定币购买力 — 免费 API，无需 auth）
// ============================================================

const DEFILLAMA_STABLECOINS = 'https://stablecoins.llama.fi';

/** 稳定币购买力汇总数据 */
export interface StablecoinPurchasingPower {
  /** 当前 USD 锚定稳定币总流通量 */
  totalCirculatingUSD: number;
  /** 7 日变化百分比 */
  change7dPct: number;
  /** 30 日变化百分比 */
  change30dPct: number;
}

/**
 * 从 DefiLlama 获取稳定币总量及 7D/30D 变化
 * 用于"稳定币购买力/供给扩张"指标
 * API: https://stablecoins.llama.fi/stablecoins?includePrices=false
 */
export async function fetchDefiLlamaStablecoins(): Promise<StablecoinPurchasingPower> {
  const url = `${DEFILLAMA_STABLECOINS}/stablecoins?includePrices=false`;
  const res = await fetchWithTimeout(url, {}, 15000);
  if (!res.ok) throw new Error(`DefiLlama stablecoins: ${res.status}`);
  const json = await res.json();
  const assets = (json as any)?.peggedAssets;
  if (!assets || !Array.isArray(assets)) throw new Error('DefiLlama stablecoins: unexpected format');

  // 只统计 USD 锚定的稳定币
  let totalNow = 0;
  let totalPrevWeek = 0;
  let totalPrevMonth = 0;

  for (const asset of assets) {
    const now = asset.circulating?.peggedUSD || 0;
    const prevWeek = asset.circulatingPrevWeek?.peggedUSD || 0;
    const prevMonth = asset.circulatingPrevMonth?.peggedUSD || 0;
    if (now > 0) {
      totalNow += now;
      totalPrevWeek += prevWeek || now; // fallback 到当前值
      totalPrevMonth += prevMonth || now;
    }
  }

  const change7dPct = totalPrevWeek > 0
    ? ((totalNow - totalPrevWeek) / totalPrevWeek) * 100
    : 0;
  const change30dPct = totalPrevMonth > 0
    ? ((totalNow - totalPrevMonth) / totalPrevMonth) * 100
    : 0;

  return { totalCirculatingUSD: totalNow, change7dPct, change30dPct };
}

// ============================================================
// Alternative.me（Crypto Fear & Greed Index — 非计分参考项）
// ============================================================

/** 恐慌贪婪指数数据 */
export interface FearGreedData {
  /** 指数值 0-100 */
  value: number;
  /** 标签：Extreme Fear / Fear / Neutral / Greed / Extreme Greed */
  label: string;
  /** 数据时间戳（Unix 秒） */
  timestamp: number;
}

/**
 * 获取 Crypto Fear & Greed Index（当前值）
 * API 文档: https://alternative.me/crypto/fear-and-greed-index/#api
 */
export async function fetchFearGreedIndex(): Promise<FearGreedData> {
  const url = 'https://api.alternative.me/fng/?limit=1';
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Fear & Greed Index: ${res.status}`);
  const json = await res.json();
  const item = (json as any)?.data?.[0];
  if (!item) throw new Error('Fear & Greed Index: no data');
  return {
    value: parseInt(item.value, 10),
    label: item.value_classification,
    timestamp: parseInt(item.timestamp, 10),
  };
}

// ============================================================
// CoinGlass（ETF 流量 + 清算数据）
// ============================================================

const COINGLASS_API = 'https://fapi.coinglass.com/api';

/** ETF 每日流量数据 */
export interface ETFFlowDay {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 总净流入（美元） */
  totalNetInflow: number;
}

/**
 * 获取 BTC ETF 每日净流量（最近 20 个交易日）
 * 使用 CoinGlass 内部 API（不稳定，经常 404）
 */
async function fetchCoinGlassETFInternal(): Promise<ETFFlowDay[]> {
  const url = `${COINGLASS_API}/index/bitcoin-etf-total-netflow?`;
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  }, 15000);
  if (!res.ok) throw new Error(`CoinGlass ETF: ${res.status}`);
  const json = await res.json();
  const data = (json as any)?.data;
  if (!data || !Array.isArray(data)) throw new Error('CoinGlass ETF: unexpected format');

  return data
    .filter((d: any) => d.date && d.totalNetInflow != null)
    .map((d: any) => ({
      date: typeof d.date === 'number'
        ? new Date(d.date).toISOString().split('T')[0]
        : String(d.date),
      totalNetInflow: Number(d.totalNetInflow),
    }))
    .slice(-20);
}

/** ETF AUM 快照（来自 Bitbo 页面解析） */
export interface ETFAUMSnapshot {
  /** 总 AUM（美元） */
  totalAUM: number;
  /** 总 BTC 持仓 */
  totalBTC: number;
  /** 数据获取时间 */
  fetchedAt: string;
}

/**
 * 从 Bitbo.io 获取 ETF 总持仓数据（静态 HTML，稳定可用）
 * 返回当前 ETF AUM 和 BTC 持仓的快照
 * 可与上一日 state.json 中的值比较，推导流入/流出方向
 */
export async function fetchBitboETFAUM(): Promise<ETFAUMSnapshot> {
  const url = 'https://bitbo.io/etf/';
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  }, 15000);
  if (!res.ok) throw new Error(`Bitbo ETF: ${res.status}`);
  const html = await res.text();

  // 解析 Bitbo 页面中 ETF 总持仓数据
  // 实际 HTML 格式:
  //   Total Holdings...
  //   1,319,170<span class="currency">BTC</span>
  //   <span class="holdings-value...">(102.49<span class="abbrv">B)</span></span>
  // 匹配: 数字,数字 + 任意标签 + BTC + 任意内容 + (数字 + B)
  const holdingsPattern = /([\d,]+)\s*<span[^>]*>BTC<\/span>\s*<span[^>]*>\(([\d.]+)<span[^>]*>B\)<\/span>/g;
  const allMatches = [...html.matchAll(holdingsPattern)];
  let totalAUM = 0;
  let totalBTC = 0;

  if (allMatches.length > 0) {
    // 取 BTC 数量最大的条目（即 Total Holdings）
    for (const m of allMatches) {
      const btc = parseInt(m[1].replace(/,/g, ''), 10);
      if (btc > totalBTC) {
        totalBTC = btc;
        totalAUM = parseFloat(m[2]) * 1e9;
      }
    }
  }

  if (totalAUM === 0 && totalBTC === 0) {
    throw new Error('Bitbo ETF: failed to parse AUM/BTC from HTML');
  }

  return { totalAUM, totalBTC, fetchedAt: new Date().toISOString() };
}

/**
 * ETF 数据获取 — Fallback Chain
 * L0: CoinGlass（如果可用，提供精确日流量）
 * L1: 返回空数组（scorer 使用中性分，Bitbo AUM 作为参考数据单独获取）
 */
export async function fetchCoinGlassETF(): Promise<ETFFlowDay[]> {
  // L0: CoinGlass（不稳定但数据最完整）
  try {
    const data = await fetchCoinGlassETFInternal();
    if (data.length >= 5) return data;
  } catch { /* CoinGlass 失败，静默 */ }

  // L1: 无可靠的免费 ETF 日流量 API，返回空数组
  // Bitbo AUM 快照通过 fetchBitboETFAUM() 单独获取，作为参考数据
  return [];
}

/** 清算数据 */
export interface LiquidationInfo {
  /** 最近主清算密集区距现价的百分比 */
  nearestLiqPctFromPrice: number;
  /** 方向: long/short 清算 */
  direction: 'long' | 'short';
}

/**
 * 获取 BTC 清算数据
 * 尝试 CoinGlass 内部 API
 */
export async function fetchCoinGlassLiquidation(): Promise<LiquidationInfo> {
  // 尝试获取清算热图数据
  const url = `${COINGLASS_API}/futures/liquidation/info?symbol=BTC&timeType=h24`;
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  }, 15000);
  if (!res.ok) throw new Error(`CoinGlass liquidation: ${res.status}`);
  const json = await res.json();
  const data = (json as any)?.data;
  if (!data) throw new Error('CoinGlass liquidation: no data');

  // 解析清算数据 — 格式可能变化，做容错处理
  // 寻找最近的清算密集区
  const price = data.price || data.currentPrice || 0;
  const longLiqPrice = data.longLiqPrice || data.longLiquidationPrice || 0;
  const shortLiqPrice = data.shortLiqPrice || data.shortLiquidationPrice || 0;

  let nearestPct = 100;
  let direction: 'long' | 'short' = 'long';

  if (price > 0) {
    if (longLiqPrice > 0) {
      const longPct = Math.abs((price - longLiqPrice) / price) * 100;
      if (longPct < nearestPct) {
        nearestPct = longPct;
        direction = 'long';
      }
    }
    if (shortLiqPrice > 0) {
      const shortPct = Math.abs((shortLiqPrice - price) / price) * 100;
      if (shortPct < nearestPct) {
        nearestPct = shortPct;
        direction = 'short';
      }
    }
  }

  return { nearestLiqPctFromPrice: nearestPct, direction };
}

// ============================================================
// 统一数据获取接口
// ============================================================

export interface AllFetchedData {
  binanceKlines: Kline[];
  binanceFunding: FundingRate[];
  binanceOI: { openInterest: number; time: number };
  binanceOIHistory: { timestamp: number; sumOpenInterest: number }[];
  binanceQuarterlyPrice: number | null;
  quarterlySymbol: string;
  daysToExpiry: number;
  binanceLSRatio: { timestamp: number; longShortRatio: number }[];
  binanceTopTrader: { timestamp: number; longShortRatio: number }[];
  fred10Y: { date: string; value: number }[];
  yahooDXY: YahooPrice[];
  yahooQQQ: YahooPrice[];
  yahooVIX: YahooPrice[];
  stablecoinHistory: {
    usdt: { timestamp: number; marketCap: number }[];
    usdc: { timestamp: number; marketCap: number }[];
  };
  btcDominance: { btcDominance: number };
  btcDominanceHistory: { date: string; dominance: number }[];
  deribitSkew: { skew25d: number };
  coinbasePrice: number;
  coinglassETF: ETFFlowDay[];
  bitboETFAUM: ETFAUMSnapshot;
  coinglassLiquidation: LiquidationInfo;
  defiLlamaStablecoins: StablecoinPurchasingPower;
  fearGreedIndex: FearGreedData;
}

/**
 * 并行获取所有数据源
 * 使用 Promise.allSettled，单个失败不影响其他
 */
export async function fetchAllData(): Promise<{
  data: Partial<AllFetchedData>;
  errors: string[];
}> {
  // 动态计算季度合约符号
  let quarterlySymbol = '';
  let daysToExpiry = 0;
  try {
    const { getQuarterlyExpiry } = await import('./utils.js');
    const expiry = getQuarterlyExpiry();
    quarterlySymbol = expiry.symbol;
    daysToExpiry = expiry.daysToExpiry;
  } catch (e) {
    // 如果计算失败，尝试常见格式
    quarterlySymbol = '';
  }

  const tasks = [
    { key: 'binanceKlines', fn: () => fetchBinanceKlines(250) },
    { key: 'binanceFunding', fn: () => fetchBinanceFunding(10) },
    { key: 'binanceOI', fn: () => fetchBinanceOI() },
    { key: 'binanceOIHistory', fn: () => fetchBinanceOIHistory('1d', 8) },
    {
      key: 'binanceQuarterlyPrice',
      fn: () => (quarterlySymbol ? fetchBinanceQuarterly(quarterlySymbol) : Promise.resolve(null)),
    },
    { key: 'binanceLSRatio', fn: () => fetchBinanceLSRatio('1d', 30) },
    { key: 'binanceTopTrader', fn: () => fetchBinanceTopTrader('1d', 30) },
    { key: 'fred10Y', fn: () => fetchFRED10Y(90) },
    { key: 'yahooDXY', fn: () => fetchYahooChart('DX-Y.NYB', '6mo', '1d') },
    { key: 'yahooQQQ', fn: () => fetchYahooChart('QQQ', '6mo', '1d') },
    { key: 'yahooVIX', fn: () => fetchYahooChart('^VIX', '3mo', '1d') },
    {
      key: 'stablecoinHistory',
      fn: async () => ({
        usdt: await fetchStablecoinHistory('tether', 30),
        usdc: await fetchStablecoinHistory('usd-coin', 30),
      }),
    },
    { key: 'btcDominance', fn: () => fetchCoinGeckoDominance() },
    { key: 'btcDominanceHistory', fn: () => fetchBTCDominanceHistory(30) },
    { key: 'deribitSkew', fn: () => fetchDeribitSkew() },
    { key: 'coinbasePrice', fn: () => fetchCoinbasePrice() },
    { key: 'coinglassETF', fn: () => fetchCoinGlassETF() },
    { key: 'bitboETFAUM', fn: () => fetchBitboETFAUM() },
    { key: 'coinglassLiquidation', fn: () => fetchCoinGlassLiquidation() },
    { key: 'defiLlamaStablecoins', fn: () => fetchDefiLlamaStablecoins() },
    { key: 'fearGreedIndex', fn: () => fetchFearGreedIndex() },
  ];

  const results = await Promise.allSettled(tasks.map((t) => t.fn()));

  const data: Record<string, any> = {
    quarterlySymbol,
    daysToExpiry,
  };
  const errors: string[] = [];

  results.forEach((result, i) => {
    const task = tasks[i];
    if (result.status === 'fulfilled') {
      data[task.key] = result.value;
    } else {
      errors.push(`${task.key}: ${result.reason?.message || result.reason}`);
      data[task.key] = null;
    }
  });

  return { data: data as Partial<AllFetchedData>, errors };
}
