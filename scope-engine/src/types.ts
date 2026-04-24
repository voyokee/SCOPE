// ============================================================
// SCOPE v3.3 核心类型定义
// ============================================================

/** 指标所属层级 */
export type Layer = 'cycle' | 'structure' | 'vulnerability';

/** 数据来源类型 */
export type SourceType = 'auto' | 'ai' | 'manual';

/** 单个指标评分结果 */
export interface IndicatorResult {
  /** 指标 ID，如 "cycle.ten-year" */
  id: string;
  /** 指标名称，如 "10Y 折现率压力" */
  name: string;
  /** 所属层级 */
  layer: Layer;
  /** 得分 */
  score: number;
  /** 满分 */
  maxScore: number;
  /** 判断理由，如 "10Y 4.25% 震荡走平，20D 斜率接近 0 → 2.5/4" */
  reasoning: string;
  /** 原始值（供 Claude 参考） */
  rawValue?: number | string;
  /** 数据来源 */
  source: SourceType;
}

/** K 线数据 */
export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  /** Taker 买入量（Binance kline index 9），用于 Spot CVD 近似 */
  takerBuyBaseVolume: number;
}

/** 价格历史（简化版，供 Claude 分析波段结构） */
export interface PricePoint {
  date: string;
  close: number;
  high: number;
  low: number;
}

/** 摆动点（高/低点） */
export interface SwingPoint {
  date: string;
  type: 'high' | 'low';
  price: number;
}

/** Funding Rate 数据 */
export interface FundingRate {
  fundingTime: number;
  fundingRate: string;
}

/** Yahoo Finance 价格数据 */
export interface YahooPrice {
  date: string;
  close: number;
}

/** 非计分参考指标 */
export interface ReferenceData {
  /** Crypto Fear & Greed Index (0-100) */
  fearGreed?: {
    value: number;
    label: string;
  };
}

/** 脚本输出的完整结构 */
export interface ScriptOutput {
  /** 数据拉取时间 */
  timestamp: string;
  /** BTC 当前价格 */
  btcPrice: number;
  /** 12 个自动指标评分结果 */
  indicators: IndicatorResult[];
  /** 原始数据，供 Claude 进一步分析 */
  rawData: {
    /** 近 60 日价格历史 */
    priceHistory: PricePoint[];
    /** 识别的摆动高低点 */
    swingPoints: SwingPoint[];
    /** 最新 Funding Rate 绝对值 */
    latestFundingRate: number;
    /** BTC 7 日涨跌幅 */
    btc7dChange: number;
    /** BTC 1 日涨跌幅 */
    btc1dChange: number;
    /** 当前 50D / 200D 均线值 */
    ma50: number;
    ma200: number;
    /** [v3.3.1] 成交量比率 5D/20D */
    volumeRatio?: number;
    /** [v3.3.1] ATR 在近 60 日中的分位数 (0-100) */
    atrPercentile?: number;
  };
  /** 非计分参考指标 */
  reference?: ReferenceData;
  /** API 调用失败的指标列表 */
  errors: string[];
}
