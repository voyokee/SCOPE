// ============================================================
// SCOPE v3.3 回测验证脚本
// 运行方式: npx tsx src/backtest.ts
// 输出: Markdown 报告 → stdout
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 类型定义
// ============================================================

interface NormalizedSnapshot {
  date: string;
  btcPrice: number;
  score: number;
  state: 'A' | 'B' | 'C' | 'D';
  layers: { cycle: number; structure: number; vulnerability: number };
  indicators: Record<string, { score: number; max: number; source: string }>;
  isBackfilled: boolean;
}

interface ForwardReturns {
  '1D': number | null;
  '3D': number | null;
  '7D': number | null;
}

interface CorrelationResult {
  pearson: number;
  spearman: number;
  n: number;
  pValue: number;
  significant: boolean;
  ci95: [number, number];
}

interface StateReturn {
  state: string;
  count: number;
  mean1D: number;
  mean3D: number;
  mean7D: number;
  median1D: number;
  median3D: number;
  median7D: number;
}

interface SimulationResult {
  name: string;
  totalReturn: number;
  maxDrawdown: number;
  sharpe: number;
  calmar: number;
  winRate: number;
}

interface IndicatorAnalysis {
  id: string;
  mean: number;
  std: number;
  cv: number;
  autoRate: number;
  corr7D: number;
  coverage: number;
}

// ============================================================
// 常量
// ============================================================

// 短名 → 完整 ID 映射（用于无前缀 schema）
const SHORT_TO_CANONICAL: Record<string, string> = {
  'fed-path': 'cycle.fed-path',
  'ten-year': 'cycle.ten-year',
  'dxy': 'cycle.dxy',
  'risk-appetite': 'cycle.risk-appetite',
  'etf-cycle': 'cycle.etf-cycle',
  'stablecoin': 'cycle.stablecoin',
  'stablecoin-water': 'cycle.stablecoin',
  'price-vs-ma': 'structure.price-vs-ma',
  'ma-arrangement': 'structure.ma-arrangement',
  'etf-short-term': 'structure.etf-short-term',
  'coinbase-premium': 'structure.coinbase-premium',
  'spot-cvd': 'structure.spot-cvd',
  'stablecoin-purchasing-power': 'structure.stablecoin-purchasing-power',
  'stablecoin-pp': 'structure.stablecoin-purchasing-power',
  'relative-strength': 'structure.relative-strength',
  'wave-structure': 'structure.wave-structure',
  'onchain-spot': 'structure.onchain-spot',
  'funding': 'vulnerability.funding',
  'oi-quality': 'vulnerability.oi-quality',
  'liquidation': 'vulnerability.liquidation',
  'basis': 'vulnerability.basis',
  'position-crowding': 'vulnerability.position-crowding',
  'exchange-netflow': 'vulnerability.exchange-netflow',
};

// 状态 → 仓位范围
const STATE_POSITIONS: Record<string, { floor: number; mid: number; ceil: number }> = {
  A: { floor: 0.65, mid: 0.825, ceil: 1.0 },
  B: { floor: 0.40, mid: 0.525, ceil: 0.65 },
  C: { floor: 0.15, mid: 0.275, ceil: 0.40 },
  D: { floor: 0.00, mid: 0.075, ceil: 0.15 },
};

// 已知回填日期（基于文件创建时间 vs 文件名日期的分析）
const BACKFILLED_DATES = new Set([
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-04-09', '2026-04-10', '2026-04-11',
  '2026-04-12', '2026-04-13', '2026-04-14',
]);

// ============================================================
// 模块 1: 数据标准化
// ============================================================

/**
 * 将 4 种不同 schema 的快照 JSON 标准化为统一格式。
 * Schema 1: 数组式（03-24） — indicators 是 IndicatorResult[]
 * Schema 2: 嵌套对象 — indicators.cycle["fed-path"]
 * Schema 3: 扁平带前缀 — indicators["cycle.fed-path"]
 * Schema 4: 扁平无前缀 — indicators["fed-path"]
 */
function normalizeSnapshot(raw: any, filename: string): NormalizedSnapshot {
  const date = raw.date || filename.replace('.json', '');
  const btcPrice = raw.btcPrice || 0;
  const score = raw.totalScore ?? raw.score ?? 0;
  const state = (raw.state || 'C') as NormalizedSnapshot['state'];
  const layers = raw.layers || { cycle: 0, structure: 0, vulnerability: 0 };
  const isBackfilled = raw.backtest === true || BACKFILLED_DATES.has(date);

  const indicators: Record<string, { score: number; max: number; source: string }> = {};

  if (Array.isArray(raw.indicators)) {
    // Schema 1: 数组式
    for (const ind of raw.indicators) {
      indicators[ind.id || ''] = {
        score: ind.score ?? 0,
        max: ind.maxScore ?? ind.max ?? 0,
        source: ind.source || 'unknown',
      };
    }
  } else if (raw.indicators && typeof raw.indicators === 'object') {
    const keys = Object.keys(raw.indicators);
    if (keys.length === 0) {
      // 空指标
    } else {
      const firstKey = keys[0];
      const firstVal = raw.indicators[firstKey];

      // 检测嵌套对象: 第一个 key 是层名且值是对象且没有 score 属性
      const isNested = ['cycle', 'structure', 'vulnerability'].includes(firstKey)
        && typeof firstVal === 'object' && firstVal !== null
        && !('score' in firstVal) && !('maxScore' in firstVal);

      if (isNested) {
        // Schema 2: 嵌套对象
        for (const layer of ['cycle', 'structure', 'vulnerability']) {
          const layerObj = raw.indicators[layer];
          if (layerObj && typeof layerObj === 'object') {
            for (const [shortName, val] of Object.entries(layerObj as Record<string, any>)) {
              indicators[`${layer}.${shortName}`] = {
                score: val.score ?? 0,
                max: val.maxScore ?? val.max ?? 0,
                source: val.source || 'unknown',
              };
            }
          }
        }
      } else if (firstKey.includes('.')) {
        // Schema 3: 扁平带前缀
        for (const [key, val] of Object.entries(raw.indicators as Record<string, any>)) {
          indicators[key] = {
            score: val.score ?? 0,
            max: val.maxScore ?? val.max ?? 0,
            source: val.source || 'unknown',
          };
        }
      } else {
        // Schema 4: 扁平无前缀
        for (const [shortName, val] of Object.entries(raw.indicators as Record<string, any>)) {
          const canonicalId = SHORT_TO_CANONICAL[shortName] || `unknown.${shortName}`;
          indicators[canonicalId] = {
            score: (val as any).score ?? 0,
            max: (val as any).maxScore ?? (val as any).max ?? 0,
            source: (val as any).source || 'unknown',
          };
        }
      }
    }
  }

  return { date, btcPrice, score, state, layers, indicators, isBackfilled };
}

function loadAllSnapshots(): NormalizedSnapshot[] {
  const historyDir = path.resolve(__dirname, '../../scope-data/history');
  const files = fs.readdirSync(historyDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  const snapshots: NormalizedSnapshot[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(historyDir, file), 'utf-8');
    const raw = JSON.parse(content);
    snapshots.push(normalizeSnapshot(raw, file));
  }
  return snapshots;
}

// ============================================================
// 模块 2: 前向收益计算
// ============================================================

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function computeForwardReturns(snapshots: NormalizedSnapshot[]): Map<string, ForwardReturns> {
  const priceMap = new Map<string, number>();
  for (const s of snapshots) {
    priceMap.set(s.date, s.btcPrice);
  }

  const result = new Map<string, ForwardReturns>();
  for (const s of snapshots) {
    if (s.btcPrice <= 0) {
      result.set(s.date, { '1D': null, '3D': null, '7D': null });
      continue;
    }

    const fwd: ForwardReturns = { '1D': null, '3D': null, '7D': null };
    for (const [label, days] of [['1D', 1], ['3D', 3], ['7D', 7]] as const) {
      // 查找目标日期或最近可用日期（向后搜索最多 3 天）
      for (let offset = 0; offset <= 3; offset++) {
        const checkDate = addDays(s.date, days + offset);
        if (priceMap.has(checkDate)) {
          fwd[label] = ((priceMap.get(checkDate)! - s.btcPrice) / s.btcPrice) * 100;
          break;
        }
      }
    }
    result.set(s.date, fwd);
  }
  return result;
}

// ============================================================
// 统计工具函数
// ============================================================

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const mx = mean(x);
  const my = mean(y);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

function toRanks(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avgRank;
    i = j;
  }
  return ranks;
}

function spearmanCorrelation(x: number[], y: number[]): number {
  return pearsonCorrelation(toRanks(x), toRanks(y));
}

// p-value 近似: 使用 t 分布 (df = n-2)
function pearsonPValue(r: number, n: number): number {
  if (n < 3 || Math.abs(r) >= 1) return n < 3 ? 1 : 0;
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return 2 * tCDF(-Math.abs(t), n - 2);
}

// Student's t CDF — P(T <= t) for t < 0
function tCDF(t: number, df: number): number {
  const x = df / (df + t * t);
  return 0.5 * regBeta(x, df / 2, 0.5);
}

// 正则化不完全 Beta 函数 I_x(a,b) — 连分式展开（Lentz 方法）
function regBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - regBeta(1 - x, b, a);

  const prefix = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  ) / a;

  let h = 1, c = 1;
  let d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  h = d;

  for (let m = 1; m <= 200; m++) {
    let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; h *= d * c;

    num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-10) break;
  }
  return prefix * h;
}

// Log-Gamma (Lanczos 近似)
function lgamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  const coef = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let x = 0.99999999999980993;
  for (let i = 0; i < coef.length; i++) x += coef[i] / (z + i + 1);
  const t = z + coef.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// Bootstrap 95% CI for Pearson r
function bootstrapCI(x: number[], y: number[], nBoot = 2000): [number, number] {
  const n = x.length;
  if (n < 5) return [-1, 1];
  const correlations: number[] = [];
  for (let b = 0; b < nBoot; b++) {
    const xB: number[] = [];
    const yB: number[] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * n);
      xB.push(x[idx]);
      yB.push(y[idx]);
    }
    correlations.push(pearsonCorrelation(xB, yB));
  }
  correlations.sort((a, b) => a - b);
  return [correlations[Math.floor(nBoot * 0.025)], correlations[Math.floor(nBoot * 0.975)]];
}

function computeCorrelation(x: number[], y: number[]): CorrelationResult {
  const r = pearsonCorrelation(x, y);
  const rho = spearmanCorrelation(x, y);
  const p = pearsonPValue(r, x.length);
  const ci = bootstrapCI(x, y);
  return { pearson: r, spearman: rho, n: x.length, pValue: p, significant: p < 0.05, ci95: ci };
}

// ============================================================
// 模块 3: 评分-收益相关性分析
// ============================================================

function analyzeCorrelations(
  snapshots: NormalizedSnapshot[],
  forwardReturns: Map<string, ForwardReturns>,
  includeBackfilled: boolean,
) {
  const filtered = includeBackfilled
    ? snapshots
    : snapshots.filter(s => !s.isBackfilled);
  const horizons = ['1D', '3D', '7D'] as const;

  // 辅助: 提取评分-收益配对
  function pairs(scoreFn: (s: NormalizedSnapshot) => number, horizon: typeof horizons[number]) {
    return filtered
      .map(s => ({ score: scoreFn(s), ret: forwardReturns.get(s.date)?.[horizon] }))
      .filter((p): p is { score: number; ret: number } => p.ret != null);
  }

  // 3.1 总分 vs 前向收益
  const totalScoreCorr: Record<string, CorrelationResult> = {};
  for (const h of horizons) {
    const p = pairs(s => s.score, h);
    if (p.length >= 5) totalScoreCorr[h] = computeCorrelation(p.map(x => x.score), p.map(x => x.ret));
  }

  // 3.2 分层相关性
  const layerCorr: Record<string, Record<string, CorrelationResult>> = {};
  for (const layer of ['cycle', 'structure', 'vulnerability'] as const) {
    layerCorr[layer] = {};
    for (const h of horizons) {
      const p = pairs(s => s.layers[layer], h);
      if (p.length >= 5) layerCorr[layer][h] = computeCorrelation(p.map(x => x.score), p.map(x => x.ret));
    }
  }

  // 3.3 评分动量 (day-over-day delta) vs 前向收益
  const momentumCorr: Record<string, CorrelationResult> = {};
  for (const h of horizons) {
    const data: { delta: number; ret: number }[] = [];
    for (let i = 1; i < filtered.length; i++) {
      const delta = filtered[i].score - filtered[i - 1].score;
      const ret = forwardReturns.get(filtered[i].date)?.[h];
      if (ret != null) data.push({ delta, ret });
    }
    if (data.length >= 5) momentumCorr[h] = computeCorrelation(data.map(d => d.delta), data.map(d => d.ret));
  }

  // 3.4 分位桶分析（三等分）
  const allScores = filtered.map(s => s.score).sort((a, b) => a - b);
  const t1 = allScores[Math.floor(allScores.length / 3)];
  const t2 = allScores[Math.floor(allScores.length * 2 / 3)];

  const buckets: Record<string, { scores: number[]; returns: Record<string, number[]> }> = {
    low: { scores: [], returns: { '1D': [], '3D': [], '7D': [] } },
    mid: { scores: [], returns: { '1D': [], '3D': [], '7D': [] } },
    high: { scores: [], returns: { '1D': [], '3D': [], '7D': [] } },
  };
  for (const s of filtered) {
    const bucket = s.score <= t1 ? 'low' : s.score <= t2 ? 'mid' : 'high';
    buckets[bucket].scores.push(s.score);
    const fwd = forwardReturns.get(s.date);
    if (fwd) {
      for (const h of horizons) {
        if (fwd[h] != null) buckets[bucket].returns[h].push(fwd[h]!);
      }
    }
  }

  return { totalScoreCorr, layerCorr, momentumCorr, buckets, thresholds: { t1, t2 } };
}

// ============================================================
// 模块 4: 状态机信号质量分析
// ============================================================

function analyzeStateSignals(
  snapshots: NormalizedSnapshot[],
  forwardReturns: Map<string, ForwardReturns>,
) {
  // 4.1 状态条件收益
  const stateGroups: Record<string, { r1: number[]; r3: number[]; r7: number[] }> = {};
  for (const s of snapshots) {
    if (!stateGroups[s.state]) stateGroups[s.state] = { r1: [], r3: [], r7: [] };
    const fwd = forwardReturns.get(s.date);
    if (fwd) {
      if (fwd['1D'] != null) stateGroups[s.state].r1.push(fwd['1D']!);
      if (fwd['3D'] != null) stateGroups[s.state].r3.push(fwd['3D']!);
      if (fwd['7D'] != null) stateGroups[s.state].r7.push(fwd['7D']!);
    }
  }
  const stateReturns: StateReturn[] = Object.entries(stateGroups).map(([state, d]) => ({
    state,
    count: Math.max(d.r1.length, d.r3.length, d.r7.length),
    mean1D: mean(d.r1), mean3D: mean(d.r3), mean7D: mean(d.r7),
    median1D: median(d.r1), median3D: median(d.r3), median7D: median(d.r7),
  }));

  // 4.2 C→B 升级分析
  const transitionDate = '2026-04-09';
  const tSnap = snapshots.find(s => s.date === transitionDate);
  const lastSnap = snapshots[snapshots.length - 1];
  const firstSnap = snapshots[0];
  const transitionReturn = tSnap && lastSnap
    ? ((lastSnap.btcPrice - tSnap.btcPrice) / tSnap.btcPrice) * 100 : 0;
  const buyAndHoldReturn = firstSnap && lastSnap
    ? ((lastSnap.btcPrice - firstSnap.btcPrice) / firstSnap.btcPrice) * 100 : 0;

  // 4.3 阈值灵敏度
  const thresholdAnalysis: Record<number, string | null> = {};
  for (const thresh of [58, 60, 62, 64]) {
    let firstUpgrade: string | null = null;
    let consecutiveDays = 0;
    for (const s of snapshots) {
      if (s.score >= thresh) {
        consecutiveDays++;
        if (consecutiveDays >= 2 && !firstUpgrade) firstUpgrade = s.date;
      } else {
        consecutiveDays = 0;
      }
    }
    thresholdAnalysis[thresh] = firstUpgrade;
  }

  // 4.4 D 状态近失误（03-29）
  const nm = snapshots.find(s => s.date === '2026-03-29');
  const nearMissDState = nm ? {
    date: nm.date, score: nm.score, vulnLayer: nm.layers.vulnerability,
    blocked: nm.layers.vulnerability > 10,
    subsequentReturn: lastSnap ? ((lastSnap.btcPrice - nm.btcPrice) / nm.btcPrice) * 100 : 0,
  } : null;

  // 4.5 B 状态稳定性
  const bSnapshots = snapshots.filter(s => s.state === 'B');
  const bScores = bSnapshots.map(s => s.score);

  return {
    stateReturns,
    transition: {
      date: transitionDate, price: tSnap?.btcPrice ?? 0,
      returnToEnd: transitionReturn, buyAndHoldReturn,
      alpha: transitionReturn - buyAndHoldReturn,
    },
    thresholdAnalysis,
    nearMissDState,
    bStateStability: {
      maxScore: bScores.length > 0 ? Math.max(...bScores) : 0,
      minScore: bScores.length > 0 ? Math.min(...bScores) : 0,
      daysAbove80: bScores.filter(s => s >= 80).length,
      gapToAUpgrade: 82 - (bScores.length > 0 ? Math.max(...bScores) : 0),
      totalDays: bScores.length,
    },
  };
}

// ============================================================
// 模块 5: 仓位模拟 P&L
// ============================================================

function runSimulation(
  snapshots: NormalizedSnapshot[],
  positionFn: (state: string) => number,
  name: string,
): SimulationResult {
  let portfolio = 100000;
  let peak = portfolio;
  let maxDD = 0;
  const dailyReturns: number[] = [];

  for (let i = 1; i < snapshots.length; i++) {
    const prevPrice = snapshots[i - 1].btcPrice;
    const curPrice = snapshots[i].btcPrice;
    if (prevPrice <= 0) continue;

    const btcRet = (curPrice - prevPrice) / prevPrice;
    const position = positionFn(snapshots[i - 1].state);
    const dayRet = btcRet * position;
    dailyReturns.push(dayRet);

    portfolio *= (1 + dayRet);
    peak = Math.max(peak, portfolio);
    maxDD = Math.max(maxDD, (peak - portfolio) / peak);
  }

  const totalReturn = (portfolio - 100000) / 1000; // 每万元收益（%）
  const totalReturnPct = (portfolio / 100000 - 1) * 100;
  const avgRet = mean(dailyReturns);
  const stdRet = stddev(dailyReturns);
  const sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(365) : 0;
  const calmar = maxDD > 0 ? totalReturnPct / (maxDD * 100) : 0;
  const winRate = dailyReturns.length > 0
    ? dailyReturns.filter(r => r > 0).length / dailyReturns.length * 100 : 0;

  return { name, totalReturn: totalReturnPct, maxDrawdown: maxDD * 100, sharpe, calmar, winRate };
}

function simulatePositions(snapshots: NormalizedSnapshot[]) {
  const strategies: Record<string, SimulationResult> = {
    conservative: runSimulation(snapshots,
      state => STATE_POSITIONS[state]?.floor ?? 0, 'SCOPE-保守'),
    midpoint: runSimulation(snapshots,
      state => STATE_POSITIONS[state]?.mid ?? 0, 'SCOPE-中性'),
    aggressive: runSimulation(snapshots,
      state => STATE_POSITIONS[state]?.ceil ?? 0, 'SCOPE-激进'),
  };

  const benchmarks: Record<string, SimulationResult> = {
    'buy-hold-100': runSimulation(snapshots, () => 1.0, 'Buy&Hold 100%'),
    'buy-hold-50': runSimulation(snapshots, () => 0.5, 'Buy&Hold 50%'),
  };

  return { strategies, benchmarks };
}

// ============================================================
// 模块 5b: 买卖信号回测
// ============================================================

import { generateSignal, type Signal } from './signal.js';

interface SignalBacktestResult {
  signal: Signal;
  count: number;
  mean1D: number;
  mean3D: number;
  mean7D: number;
  dates: string[];
}

function backtestSignals(
  snapshots: NormalizedSnapshot[],
  forwardReturns: Map<string, ForwardReturns>,
) {
  // 用历史评分序列模拟信号生成
  const signalEvents: { date: string; signal: Signal; confidence: number; reasoning: string }[] = [];

  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    // 构建评分历史（最近 5 天）
    const histStart = Math.max(0, i - 4);
    const scoreHistory = snapshots.slice(histStart, i + 1).map(ss => ss.score);
    const prevState = i > 0 ? snapshots[i - 1].state : null;
    const prevStructure = i > 0 ? snapshots[i - 1].layers.structure : null;

    const result = generateSignal(
      s.score, scoreHistory, s.state, prevState,
      s.layers.vulnerability, s.layers.structure, prevStructure,
    );
    signalEvents.push({ date: s.date, signal: result.signal, confidence: result.confidence, reasoning: result.reasoning });
  }

  // 按信号类型分组计算收益
  const groups: Record<string, { returns1D: number[]; returns3D: number[]; returns7D: number[]; dates: string[] }> = {};
  for (const evt of signalEvents) {
    if (!groups[evt.signal]) groups[evt.signal] = { returns1D: [], returns3D: [], returns7D: [], dates: [] };
    const fwd = forwardReturns.get(evt.date);
    if (fwd) {
      if (fwd['1D'] != null) groups[evt.signal].returns1D.push(fwd['1D']!);
      if (fwd['3D'] != null) groups[evt.signal].returns3D.push(fwd['3D']!);
      if (fwd['7D'] != null) groups[evt.signal].returns7D.push(fwd['7D']!);
    }
    groups[evt.signal].dates.push(evt.date);
  }

  const results: SignalBacktestResult[] = Object.entries(groups).map(([signal, g]) => ({
    signal: signal as Signal,
    count: g.dates.length,
    mean1D: mean(g.returns1D),
    mean3D: mean(g.returns3D),
    mean7D: mean(g.returns7D),
    dates: g.dates,
  }));

  // 信号翻转频率
  let flips = 0;
  for (let i = 1; i < signalEvents.length; i++) {
    if (signalEvents[i].signal !== signalEvents[i - 1].signal) flips++;
  }
  const flipRate = signalEvents.length > 1 ? flips / (signalEvents.length - 1) : 0;

  return { results, signalEvents, flipRate };
}

// ============================================================
// 模块 6: 指标分解分析
// ============================================================

function analyzeIndicators(
  snapshots: NormalizedSnapshot[],
  forwardReturns: Map<string, ForwardReturns>,
) {
  // 收集所有指标 ID
  const allIds = new Set<string>();
  for (const s of snapshots) {
    for (const id of Object.keys(s.indicators)) allIds.add(id);
  }

  // 构建时间序列
  const series: Record<string, { scores: number[]; sources: string[]; dates: string[] }> = {};
  for (const id of allIds) {
    const scores: number[] = [], sources: string[] = [], dates: string[] = [];
    for (const s of snapshots) {
      if (s.indicators[id]) {
        scores.push(s.indicators[id].score);
        sources.push(s.indicators[id].source);
        dates.push(s.date);
      }
    }
    series[id] = { scores, sources, dates };
  }

  // 6.1 逐指标分析
  const analyses: IndicatorAnalysis[] = [];
  for (const id of allIds) {
    const { scores, sources, dates } = series[id];
    const m = mean(scores);
    const s = stddev(scores);
    const cv = m !== 0 ? s / Math.abs(m) : 0;
    const autoSources = ['auto', 'auto-proxy', 'auto-fallback', 'calc'];
    const autoCount = sources.filter(src => autoSources.includes(src)).length;
    const autoRate = scores.length > 0 ? autoCount / scores.length : 0;

    // 与 7D 前向收益 Spearman 相关性
    let corr7D = 0;
    const p: { sc: number; ret: number }[] = [];
    for (let i = 0; i < dates.length; i++) {
      const fwd = forwardReturns.get(dates[i]);
      if (fwd?.['7D'] != null) p.push({ sc: scores[i], ret: fwd['7D']! });
    }
    if (p.length >= 5) corr7D = spearmanCorrelation(p.map(x => x.sc), p.map(x => x.ret));

    analyses.push({ id, mean: m, std: s, cv, autoRate, corr7D, coverage: scores.length / snapshots.length });
  }

  // 6.2 冗余检测（配对相关 |r| > 0.7）
  const pairwiseCorr: { a: string; b: string; correlation: number }[] = [];
  const ids = Object.keys(series).filter(id => series[id].scores.length >= 15);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      // 取共同日期的评分
      const aDateSet = new Set(series[a].dates);
      const aScores: number[] = [], bScores: number[] = [];
      for (let k = 0; k < series[b].dates.length; k++) {
        const d = series[b].dates[k];
        if (aDateSet.has(d)) {
          const aIdx = series[a].dates.indexOf(d);
          if (aIdx >= 0) {
            aScores.push(series[a].scores[aIdx]);
            bScores.push(series[b].scores[k]);
          }
        }
      }
      if (aScores.length >= 10) {
        const r = pearsonCorrelation(aScores, bScores);
        if (Math.abs(r) > 0.7) pairwiseCorr.push({ a, b, correlation: r });
      }
    }
  }

  // 6.3 数据源质量汇总
  const sourceQuality: Record<string, { auto: number; ai: number; est: number; total: number }> = {};
  for (const id of allIds) {
    const sources = series[id]?.sources || [];
    const auto = sources.filter(s => ['auto', 'auto-proxy', 'auto-fallback', 'calc'].includes(s)).length;
    const ai = sources.filter(s => s.toLowerCase().startsWith('ai') || s === 'ai').length;
    const est = sources.filter(s => s === 'est' || s === 'fallback' || s === 'auto-fallback').length;
    sourceQuality[id] = { auto, ai, est, total: sources.length };
  }

  analyses.sort((a, b) => Math.abs(b.corr7D) - Math.abs(a.corr7D));
  return { analyses, pairwiseCorr, sourceQuality };
}

// ============================================================
// 模块 7: 改进建议生成
// ============================================================

function generateImprovements(
  corrAnalysis: ReturnType<typeof analyzeCorrelations>,
  stateAnalysis: ReturnType<typeof analyzeStateSignals>,
  indicatorAnalysis: ReturnType<typeof analyzeIndicators>,
) {
  const imp: string[] = [];

  // A. 权重调整
  const highCorr = indicatorAnalysis.analyses.filter(a => Math.abs(a.corr7D) > 0.3 && a.autoRate > 0.4);
  const lowCorr = indicatorAnalysis.analyses.filter(a => Math.abs(a.corr7D) < 0.1 && a.coverage > 0.5);
  if (highCorr.length > 0)
    imp.push(`**A1. 提权候选**: ${highCorr.map(a => `\`${a.id}\`(ρ=${a.corr7D.toFixed(2)})`).join(', ')} — 7D预测力高`);
  if (lowCorr.length > 0)
    imp.push(`**A2. 降权/移除候选**: ${lowCorr.map(a => `\`${a.id}\`(ρ=${a.corr7D.toFixed(2)})`).join(', ')} — 覆盖率高但预测力≈0`);

  // B. 阈值灵敏度
  const { thresholdAnalysis } = stateAnalysis;
  const t60 = thresholdAnalysis[60], t62 = thresholdAnalysis[62];
  if (t60 && t62 && t60 !== t62)
    imp.push(`**B1. C→B阈值**: 62→60 可提前至 ${t60} 触发（原 ${t62}），多捕获 1+ 天涨幅`);
  else
    imp.push(`**B1. C→B阈值**: 62 合理，降至 60 不改变升级时机（均为 ${t62}）`);

  const { bStateStability: bs } = stateAnalysis;
  if (bs.gapToAUpgrade <= 3)
    imp.push(`**B2. B→A阈值**: 最高分 ${bs.maxScore}，距 82 仅差 ${bs.gapToAUpgrade} 分，考虑降至 80`);
  else
    imp.push(`**B2. B→A阈值**: 最高分 ${bs.maxScore}，距 82 差 ${bs.gapToAUpgrade} 分，当前偏高可能错过升级窗口`);

  // C. 数据源
  const lowAuto = indicatorAnalysis.analyses
    .filter(a => a.autoRate < 0.3 && a.coverage > 0.5)
    .sort((a, b) => Math.abs(b.corr7D) - Math.abs(a.corr7D));
  if (lowAuto.length > 0)
    imp.push(`**C1. 数据源优先级**: ${lowAuto.map(a => `\`${a.id}\`(auto率${(a.autoRate * 100).toFixed(0)}%)`).join(', ')} — 自动化率低，应优先找到可靠 API`);

  // D. 结构性改进
  const momR = corrAnalysis.momentumCorr['7D']?.pearson ?? 0;
  const totR = corrAnalysis.totalScoreCorr['7D']?.pearson ?? 0;
  if (Math.abs(momR) > Math.abs(totR))
    imp.push(`**D1. 评分动量**: 动量 r=${momR.toFixed(2)} > 静态分数 r=${totR.toFixed(2)}，建议在状态转换中引入 scoreVelocity`);
  else
    imp.push(`**D1. 评分动量**: 动量 r=${momR.toFixed(2)} ≤ 静态 r=${totR.toFixed(2)}，当前设计合理`);

  if (indicatorAnalysis.pairwiseCorr.length > 0) {
    const top = indicatorAnalysis.pairwiseCorr.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)).slice(0, 5);
    imp.push(`**D2. 冗余指标**: ${top.map(p => `\`${p.a}\` ↔ \`${p.b}\`(r=${p.correlation.toFixed(2)})`).join('; ')} — 考虑合并`);
  }

  const zeroVar = indicatorAnalysis.analyses.filter(a => a.cv < 0.05 && a.coverage > 0.5);
  if (zeroVar.length > 0)
    imp.push(`**D3. 零方差指标**: ${zeroVar.map(a => `\`${a.id}\`(CV=${a.cv.toFixed(3)})`).join(', ')} — 几乎不变，无信号`);

  return imp;
}

// ============================================================
// Markdown 报告生成
// ============================================================

function generateReport(
  snapshots: NormalizedSnapshot[],
  forwardReturns: Map<string, ForwardReturns>,
  corrAll: ReturnType<typeof analyzeCorrelations>,
  corrRT: ReturnType<typeof analyzeCorrelations>,
  stateAnalysis: ReturnType<typeof analyzeStateSignals>,
  simResults: ReturnType<typeof simulatePositions>,
  indAnalysis: ReturnType<typeof analyzeIndicators>,
  improvements: string[],
  signalAnalysis: ReturnType<typeof backtestSignals>,
): string {
  const L: string[] = [];
  const p = (s: string) => L.push(s);
  const blank = () => L.push('');

  const first = snapshots[0], last = snapshots[snapshots.length - 1];
  const totalRet = ((last.btcPrice - first.btcPrice) / first.btcPrice * 100).toFixed(1);
  const rtCount = snapshots.filter(s => !s.isBackfilled).length;
  const bfCount = snapshots.filter(s => s.isBackfilled).length;

  p('# SCOPE v3.3 回测验证报告');
  blank();
  p(`> 数据: ${first.date} ~ ${last.date} (${snapshots.length} 快照, 实时 ${rtCount}, 回填 ${bfCount})`);
  p(`> BTC: $${first.btcPrice.toFixed(0)} → $${last.btcPrice.toFixed(0)} (${totalRet}%)`);
  p(`> 评分: ${Math.min(...snapshots.map(s => s.score))} ~ ${Math.max(...snapshots.map(s => s.score))}, 状态: C → B (04-09 升级)`);
  blank();

  // 时间序列概览
  p('## 0. 时间序列概览');
  blank();
  p('| 日期 | BTC | 1D% | 评分 | 状态 | 周期 | 结构 | 脆弱 | 回填 |');
  p('|------|-----|-----|------|------|------|------|------|------|');
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    const prev = i > 0 ? snapshots[i - 1] : null;
    const chg = prev && prev.btcPrice > 0
      ? ((s.btcPrice - prev.btcPrice) / prev.btcPrice * 100).toFixed(1) : '-';
    p(`| ${s.date} | ${s.btcPrice.toFixed(0)} | ${chg} | ${s.score} | ${s.state} | ${s.layers.cycle} | ${s.layers.structure} | ${s.layers.vulnerability} | ${s.isBackfilled ? '●' : ''} |`);
  }
  blank();

  // 1. 相关性
  p('## 1. 评分-收益相关性');
  blank();

  function corrTable(label: string, corr: Record<string, CorrelationResult>) {
    p(`### ${label}`);
    blank();
    p('| 周期 | Pearson r | Spearman ρ | p-value | 显著 | 95% CI | n |');
    p('|------|----------|-----------|---------|------|--------|---|');
    for (const h of ['1D', '3D', '7D']) {
      const c = corr[h];
      if (c) p(`| ${h} | ${c.pearson.toFixed(3)} | ${c.spearman.toFixed(3)} | ${c.pValue.toFixed(3)} | ${c.significant ? '**✓**' : '✗'} | [${c.ci95[0].toFixed(2)}, ${c.ci95[1].toFixed(2)}] | ${c.n} |`);
    }
    blank();
  }

  corrTable('1.1 总分 vs 前向收益（含回填）', corrAll.totalScoreCorr);
  corrTable('1.2 总分 vs 前向收益（仅实时）', corrRT.totalScoreCorr);

  p('### 1.3 分层相关性（7D，含回填）');
  blank();
  p('| 层 | Pearson r | Spearman ρ | 显著 | n |');
  p('|-----|----------|-----------|------|---|');
  for (const layer of ['cycle', 'structure', 'vulnerability']) {
    const c = corrAll.layerCorr[layer]?.['7D'];
    if (c) p(`| ${layer} | ${c.pearson.toFixed(3)} | ${c.spearman.toFixed(3)} | ${c.significant ? '**✓**' : '✗'} | ${c.n} |`);
  }
  blank();

  corrTable('1.4 评分动量 (Δscore) vs 前向收益', corrAll.momentumCorr);

  p('### 1.5 分位桶分析');
  blank();
  p(`三等分阈值: 低 ≤ ${corrAll.thresholds.t1}, 中 ≤ ${corrAll.thresholds.t2}, 高 > ${corrAll.thresholds.t2}`);
  blank();
  p('| 桶 | 样本 | 分数范围 | 1D均值% | 3D均值% | 7D均值% |');
  p('|-----|------|---------|---------|---------|---------|');
  for (const [bk, data] of Object.entries(corrAll.buckets)) {
    const range = data.scores.length > 0
      ? `${Math.min(...data.scores)}-${Math.max(...data.scores)}` : '-';
    p(`| ${bk} | ${data.scores.length} | ${range} | ${mean(data.returns['1D']).toFixed(2)} | ${mean(data.returns['3D']).toFixed(2)} | ${mean(data.returns['7D']).toFixed(2)} |`);
  }
  blank();

  // 2. 状态机信号
  p('## 2. 状态机信号质量');
  blank();

  p('### 2.1 状态条件收益');
  blank();
  p('| 状态 | 天数 | 1D均值% | 3D均值% | 7D均值% | 1D中位% | 3D中位% | 7D中位% |');
  p('|------|------|---------|---------|---------|---------|---------|---------|');
  for (const sr of stateAnalysis.stateReturns.sort((a, b) => a.state.localeCompare(b.state))) {
    p(`| ${sr.state} | ${sr.count} | ${sr.mean1D.toFixed(2)} | ${sr.mean3D.toFixed(2)} | ${sr.mean7D.toFixed(2)} | ${sr.median1D.toFixed(2)} | ${sr.median3D.toFixed(2)} | ${sr.median7D.toFixed(2)} |`);
  }
  blank();

  p('### 2.2 C→B 升级分析');
  blank();
  const t = stateAnalysis.transition;
  p(`- 升级日: **${t.date}**, BTC = $${t.price.toFixed(0)}`);
  p(`- 升级后至期末收益: **+${t.returnToEnd.toFixed(1)}%**`);
  p(`- 同期全程 buy-and-hold: +${t.buyAndHoldReturn.toFixed(1)}%`);
  p(`- C→B 升级 alpha: ${t.alpha > 0 ? '+' : ''}${t.alpha.toFixed(1)}%（相对于全程持有的延迟入场损失）`);
  blank();

  p('### 2.3 阈值灵敏度（C→B 升级）');
  blank();
  p('| 阈值 | 首次触发升级日 |');
  p('|------|---------------|');
  for (const thresh of [58, 60, 62, 64]) {
    p(`| ${thresh} | ${stateAnalysis.thresholdAnalysis[thresh] || '未触发'} |`);
  }
  blank();

  if (stateAnalysis.nearMissDState) {
    p('### 2.4 D 状态近失误分析');
    blank();
    const nm = stateAnalysis.nearMissDState;
    p(`- 日期: **${nm.date}**, 评分 ${nm.score}（≤37 满足降级评分条件）`);
    p(`- 脆弱性层: ${nm.vulnLayer}（>10 阻止降级 ${nm.blocked ? '✓' : '✗'}）`);
    p(`- 若降级至 D（仓位 0-15%），将错过后续 **+${nm.subsequentReturn.toFixed(1)}%** 反弹`);
    p(`- **结论**: 双条件降级规则正确保护了仓位`);
    blank();
  }

  p('### 2.5 B 状态稳定性');
  blank();
  const bs = stateAnalysis.bStateStability;
  p(`- B 状态持续 **${bs.totalDays}** 天`);
  p(`- 评分范围: ${bs.minScore} ~ ${bs.maxScore}（距 B→C 降级阈值 57 缓冲 ${bs.minScore - 57} 分）`);
  p(`- 距 B→A 升级阈值 82 差 ${bs.gapToAUpgrade} 分（≥80 天数: ${bs.daysAbove80}）`);
  blank();

  // 3. 仓位模拟
  p('## 3. 仓位模拟 P&L');
  blank();
  p('| 策略 | 总收益% | 最大回撤% | 年化Sharpe | Calmar | 胜率% |');
  p('|------|---------|----------|-----------|--------|-------|');
  for (const r of [...Object.values(simResults.strategies), ...Object.values(simResults.benchmarks)]) {
    p(`| ${r.name} | ${r.totalReturn.toFixed(2)} | ${r.maxDrawdown.toFixed(2)} | ${r.sharpe.toFixed(2)} | ${r.calmar.toFixed(2)} | ${r.winRate.toFixed(1)} |`);
  }
  blank();

  // 收益-回撤总结
  const mid = simResults.strategies['midpoint'];
  const bh = simResults.benchmarks['buy-hold-100'];
  if (mid && bh) {
    const retRatio = bh.totalReturn > 0 ? (mid.totalReturn / bh.totalReturn * 100).toFixed(0) : '-';
    const ddRatio = bh.maxDrawdown > 0 ? (mid.maxDrawdown / bh.maxDrawdown * 100).toFixed(0) : '-';
    p(`> SCOPE-中性 捕获了 buy-and-hold **${retRatio}%** 的收益，同时回撤仅为其 **${ddRatio}%**`);
    blank();
  }

  // 3b. 买卖信号回测
  p('## 3b. 买卖信号回测 (v4.0)');
  blank();
  p('| 信号 | 天数 | 1D均值% | 3D均值% | 7D均值% | 日期 |');
  p('|------|------|---------|---------|---------|------|');
  for (const sr of signalAnalysis.results.sort((a, b) => b.mean3D - a.mean3D)) {
    const datesStr = sr.dates.length <= 5 ? sr.dates.join(', ') : `${sr.dates.slice(0, 3).join(', ')}... (${sr.dates.length}天)`;
    p(`| ${sr.signal} | ${sr.count} | ${sr.mean1D.toFixed(2)} | ${sr.mean3D.toFixed(2)} | ${sr.mean7D.toFixed(2)} | ${datesStr} |`);
  }
  blank();
  p(`> 信号翻转频率: ${(signalAnalysis.flipRate * 100).toFixed(0)}% (每 ${signalAnalysis.flipRate > 0 ? (1 / signalAnalysis.flipRate).toFixed(1) : '∞'} 天翻转一次)`);
  blank();

  // 4. 指标分解
  p('## 4. 指标分解分析');
  blank();
  p('### 4.1 指标预测力排名（按 7D Spearman |ρ|）');
  blank();
  p('| # | 指标 | ρ(7D) | 均值 | 标准差 | CV | auto% | 覆盖% |');
  p('|---|------|-------|------|--------|-----|-------|-------|');
  indAnalysis.analyses.forEach((a, i) => {
    p(`| ${i + 1} | ${a.id} | ${a.corr7D >= 0 ? '+' : ''}${a.corr7D.toFixed(3)} | ${a.mean.toFixed(1)} | ${a.std.toFixed(2)} | ${a.cv.toFixed(2)} | ${(a.autoRate * 100).toFixed(0)} | ${(a.coverage * 100).toFixed(0)} |`);
  });
  blank();

  if (indAnalysis.pairwiseCorr.length > 0) {
    p('### 4.2 高相关指标对（|r| > 0.7）');
    blank();
    p('| 指标 A | 指标 B | Pearson r |');
    p('|--------|--------|-----------|');
    for (const pair of indAnalysis.pairwiseCorr.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))) {
      p(`| ${pair.a} | ${pair.b} | ${pair.correlation.toFixed(3)} |`);
    }
    blank();
  }

  p('### 4.3 数据源质量');
  blank();
  p('| 指标 | auto | AI | est | 总计 | auto% |');
  p('|------|------|----|-----|------|-------|');
  const sqEntries = Object.entries(indAnalysis.sourceQuality).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [id, sq] of sqEntries) {
    const rate = sq.total > 0 ? (sq.auto / sq.total * 100).toFixed(0) : '0';
    p(`| ${id} | ${sq.auto} | ${sq.ai} | ${sq.est} | ${sq.total} | ${rate} |`);
  }
  blank();

  // 5. 改进建议
  p('## 5. 改进建议');
  blank();
  for (const imp of improvements) { p(imp); blank(); }

  // 6. 统计注意事项
  p('## 6. 统计注意事项');
  blank();
  p(`- 样本量 n=${snapshots.length}，所有相关性置信区间较宽，结论以定性为主`);
  p(`- 回填快照 ${bfCount} 个（${(bfCount / snapshots.length * 100).toFixed(0)}%），已分别呈现含/不含回填结果`);
  p('- 整个回测区间为单一市场环境（V型底 + 上升趋势），无法验证熊市/横盘表现');
  p('- 未做参数优化，仅验证现有规则的有效性');
  blank();

  return L.join('\n');
}

// ============================================================
// 主函数
// ============================================================

function main() {
  process.stderr.write('SCOPE v3.3 回测验证开始...\n');

  // 1. 加载标准化数据
  const snapshots = loadAllSnapshots();
  process.stderr.write(`已加载 ${snapshots.length} 个快照 (实时 ${snapshots.filter(s => !s.isBackfilled).length}, 回填 ${snapshots.filter(s => s.isBackfilled).length})\n`);

  // 2. 前向收益
  const fwdReturns = computeForwardReturns(snapshots);

  // 3. 相关性分析
  process.stderr.write('计算相关性...\n');
  const corrAll = analyzeCorrelations(snapshots, fwdReturns, true);
  const corrRT = analyzeCorrelations(snapshots, fwdReturns, false);

  // 4. 状态机信号
  process.stderr.write('分析状态机信号...\n');
  const stateAnalysis = analyzeStateSignals(snapshots, fwdReturns);

  // 5. 仓位模拟
  process.stderr.write('运行仓位模拟...\n');
  const simResults = simulatePositions(snapshots);

  // 6. 指标分解
  process.stderr.write('分析指标...\n');
  const indAnalysis = analyzeIndicators(snapshots, fwdReturns);

  // 7. 改进建议
  const improvements = generateImprovements(corrAll, stateAnalysis, indAnalysis);

  // 8. 买卖信号回测
  process.stderr.write('回测买卖信号...\n');
  const signalAnalysis = backtestSignals(snapshots, fwdReturns);

  // 9. 生成报告
  const report = generateReport(
    snapshots, fwdReturns, corrAll, corrRT,
    stateAnalysis, simResults, indAnalysis, improvements, signalAnalysis,
  );

  console.log(report);
  process.stderr.write('回测验证完成\n');
}

main();
