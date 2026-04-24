// ============================================================
// SCOPE v3.3 工具函数
// ============================================================

import type { Kline, PricePoint, SwingPoint } from './types.js';

/**
 * 简单移动平均（SMA）
 * @param values 价格序列（从旧到新）
 * @param period 周期
 * @returns 最新的 SMA 值
 */
export function sma(values: number[], period: number): number {
  if (values.length < period) {
    throw new Error(`数据不足: 需要 ${period} 个数据点，实际 ${values.length}`);
  }
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/**
 * 计算完整 SMA 序列
 * @param values 价格序列（从旧到新）
 * @param period 周期
 * @returns SMA 序列（长度 = values.length - period + 1）
 */
export function smaArray(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += values[j];
    }
    result.push(sum / period);
  }
  return result;
}

/**
 * 线性回归斜率
 * 用于判断趋势方向（正=上行，负=下行）
 * @param values 数值序列（从旧到新）
 * @param period 计算窗口
 * @returns 标准化斜率（每日变化量 / 均值），正数=上行，负数=下行
 */
export function linearSlope(values: number[], period: number): number {
  if (values.length < period) {
    throw new Error(`数据不足: 需要 ${period} 个数据点，实际 ${values.length}`);
  }
  const slice = values.slice(-period);
  const n = slice.length;
  const mean = slice.reduce((s, v) => s + v, 0) / n;

  // 最小二乘法: y = a + bx
  let sumXY = 0;
  let sumX2 = 0;
  const xMean = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const x = i - xMean;
    sumXY += x * slice[i];
    sumX2 += x * x;
  }
  const slope = sumXY / sumX2; // 原始斜率（每日变化量）

  // 标准化：除以均值，得到百分比级别的斜率
  return mean !== 0 ? slope / Math.abs(mean) : 0;
}

/**
 * 分位数计算
 * @param values 数值序列
 * @param value 要计算分位的值
 * @returns 该值在序列中的分位数（0-100）
 */
export function percentileRank(values: number[], value: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  let count = 0;
  for (const v of sorted) {
    if (v < value) count++;
    else if (v === value) count += 0.5;
  }
  return (count / sorted.length) * 100;
}

/**
 * 识别价格摆动高低点（Zigzag 简化版）
 * 用于波段结构 HH/HL 分析
 * @param klines K 线数据
 * @param threshold 最小摆动幅度百分比（默认 3%）
 * @returns 摆动点序列
 */
export function findSwingPoints(klines: Kline[], threshold = 3): SwingPoint[] {
  if (klines.length < 5) return [];

  const points: SwingPoint[] = [];
  let lastType: 'high' | 'low' | null = null;
  let lastHigh = klines[0].high;
  let lastHighIdx = 0;
  let lastLow = klines[0].low;
  let lastLowIdx = 0;

  for (let i = 1; i < klines.length; i++) {
    const k = klines[i];

    if (k.high > lastHigh) {
      lastHigh = k.high;
      lastHighIdx = i;
    }
    if (k.low < lastLow) {
      lastLow = k.low;
      lastLowIdx = i;
    }

    // 从高点回落超过阈值 → 确认高点
    const dropFromHigh = ((lastHigh - k.low) / lastHigh) * 100;
    if (dropFromHigh >= threshold && lastType !== 'high') {
      const date = new Date(klines[lastHighIdx].openTime).toISOString().split('T')[0];
      // 如果上一个点也是 high，替换为更高的
      if (points.length > 0 && points[points.length - 1].type === 'high') {
        if (lastHigh > points[points.length - 1].price) {
          points[points.length - 1] = { date, type: 'high', price: lastHigh };
        }
      } else {
        points.push({ date, type: 'high', price: lastHigh });
      }
      lastType = 'high';
      lastLow = k.low;
      lastLowIdx = i;
    }

    // 从低点反弹超过阈值 → 确认低点
    const bounceFromLow = ((k.high - lastLow) / lastLow) * 100;
    if (bounceFromLow >= threshold && lastType !== 'low') {
      const date = new Date(klines[lastLowIdx].openTime).toISOString().split('T')[0];
      if (points.length > 0 && points[points.length - 1].type === 'low') {
        if (lastLow < points[points.length - 1].price) {
          points[points.length - 1] = { date, type: 'low', price: lastLow };
        }
      } else {
        points.push({ date, type: 'low', price: lastLow });
      }
      lastType = 'low';
      lastHigh = k.high;
      lastHighIdx = i;
    }
  }

  return points;
}

/**
 * K 线转为简化价格点
 */
export function klinesToPricePoints(klines: Kline[]): PricePoint[] {
  return klines.map(k => ({
    date: new Date(k.openTime).toISOString().split('T')[0],
    close: k.close,
    high: k.high,
    low: k.low,
  }));
}

/**
 * 计算 Binance 当前季度合约到期日
 * 规则：每个季度的最后一个周五（3月、6月、9月、12月）
 * 返回格式：YYMMDD（用于拼接合约符号）
 */
export function getQuarterlyExpiry(): { symbol: string; daysToExpiry: number } {
  const now = new Date();
  const quarterMonths = [2, 5, 8, 11]; // 0-indexed: Mar, Jun, Sep, Dec

  // 找到下一个季度到期月
  let expiryDate: Date | null = null;

  for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
    for (const month of quarterMonths) {
      const year = now.getFullYear() + yearOffset;
      // 找到该月最后一个周五
      const lastDay = new Date(year, month + 1, 0); // 该月最后一天
      const dayOfWeek = lastDay.getDay();
      const fridayOffset = dayOfWeek >= 5 ? dayOfWeek - 5 : dayOfWeek + 2;
      const lastFriday = new Date(year, month + 1, -fridayOffset);

      if (lastFriday > now) {
        expiryDate = lastFriday;
        break;
      }
    }
    if (expiryDate) break;
  }

  if (!expiryDate) {
    throw new Error('无法计算季度合约到期日');
  }

  const yy = String(expiryDate.getFullYear()).slice(-2);
  const mm = String(expiryDate.getMonth() + 1).padStart(2, '0');
  const dd = String(expiryDate.getDate()).padStart(2, '0');
  const symbol = `BTCUSD_${yy}${mm}${dd}`;

  const daysToExpiry = Math.ceil(
    (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  return { symbol, daysToExpiry };
}

/**
 * 年化基差计算
 */
export function annualizedBasis(
  futurePrice: number,
  spotPrice: number,
  daysToExpiry: number
): number {
  if (daysToExpiry <= 0 || spotPrice <= 0) return 0;
  return ((futurePrice - spotPrice) / spotPrice) * (365 / daysToExpiry) * 100;
}

/**
 * 带超时的 fetch 封装
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 安全地从序列中获取变化率
 * @param values 数值序列（从旧到新）
 * @param days 回看天数
 * @returns 百分比变化率
 */
export function changePercent(values: number[], days: number): number {
  if (values.length < days + 1) return 0;
  const current = values[values.length - 1];
  const past = values[values.length - 1 - days];
  if (past === 0) return 0;
  return ((current - past) / past) * 100;
}

// ============================================================
// v3.3.1 新增: 量能-波动率工具函数
// ============================================================

/**
 * 成交量比率：短期均量 / 长期均量
 * 用于判断缩量/放量状态
 * @param volumes 成交量序列（从旧到新）
 * @param shortPeriod 短期窗口（默认 5）
 * @param longPeriod 长期窗口（默认 20）
 * @returns 比率。< 0.7 缩量, 0.7-1.3 正常, > 1.3 放量
 */
export function volumeRatio(
  volumes: number[],
  shortPeriod = 5,
  longPeriod = 20
): number {
  if (volumes.length < longPeriod) return 1; // 数据不足，返回中性
  const shortAvg = sma(volumes, shortPeriod);
  const longAvg = sma(volumes, longPeriod);
  if (longAvg === 0) return 1;
  return shortAvg / longAvg;
}

/**
 * ATR (Average True Range) 计算
 * 使用经典 Wilder ATR：max(H-L, |H-prevC|, |L-prevC|) 的 SMA
 * @param klines K 线数据
 * @param period ATR 周期（默认 14）
 * @returns 最新 ATR 值
 */
export function atr(klines: Kline[], period = 14): number {
  if (klines.length < period + 1) return 0;
  const trValues: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const h = klines[i].high;
    const l = klines[i].low;
    const prevC = klines[i - 1].close;
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    trValues.push(tr);
  }
  return sma(trValues, period);
}

/**
 * ATR 分位数：当前 ATR 在近 N 日 ATR 序列中的位置
 * 用于判断波动率是否极度压缩或扩张
 * @param klines K 线数据
 * @param atrPeriod ATR 计算周期（默认 14）
 * @param lookback 分位数计算回看窗口（默认 60）
 * @returns 0-100 分位数。< 20 极度压缩, > 80 波动率扩张
 */
export function atrPercentile(
  klines: Kline[],
  atrPeriod = 14,
  lookback = 60
): number {
  // 需要 atrPeriod + lookback + 1 根 K 线
  if (klines.length < atrPeriod + lookback + 1) return 50; // 数据不足，返回中性

  // 计算完整 TR 序列
  const trValues: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const h = klines[i].high;
    const l = klines[i].low;
    const prevC = klines[i - 1].close;
    trValues.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
  }

  // 计算滚动 ATR 序列
  const atrSeries = smaArray(trValues, atrPeriod);
  if (atrSeries.length < lookback) return 50;

  // 取最近 lookback 个 ATR 值
  const recentATRs = atrSeries.slice(-lookback);
  const currentATR = recentATRs[recentATRs.length - 1];

  return percentileRank(recentATRs, currentATR);
}
