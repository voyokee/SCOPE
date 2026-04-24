// ============================================================
// SCOPE v4.0 买卖信号层
// 在现有状态机评分上叠加信号判断
// ============================================================

/** 信号类型 */
export type Signal = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

/** 信号输出 */
export interface SignalOutput {
  signal: Signal;
  confidence: number;
  reasoning: string;
  scoreVelocity: number;
  scoreAcceleration: number;
}

/**
 * 从评分历史中计算 scoreVelocity（3D 移动均值的日变化）
 * @param scores 最近若干天的评分（从旧到新，至少 4 个元素）
 * @returns velocity（正=上升，负=下降）
 */
function calcVelocity(scores: number[]): number {
  if (scores.length < 3) return 0;
  const n = scores.length;
  // 最近 3 天均值 vs 前一天的 3 天均值
  const avg3 = (scores[n - 1] + scores[n - 2] + scores[n - 3]) / 3;
  if (n >= 4) {
    const avgPrev3 = (scores[n - 2] + scores[n - 3] + scores[n - 4]) / 3;
    return avg3 - avgPrev3;
  }
  return 0;
}

/**
 * 生成买卖信号
 *
 * 核心逻辑来源于回测发现:
 * - 低分桶 7D 回报 +5.51% > 高分桶 +2.07%（逆向信号）
 * - 评分从低位上升 = 最佳入场时机
 * - 状态转换 = 最强确认信号
 *
 * @param currentScore 当日总分
 * @param scoreHistory 评分历史序列（从旧到新，包含当日，来自 state.json.stateHistory）
 * @param currentState 当前状态 'A'|'B'|'C'|'D'
 * @param previousState 前一日状态
 * @param vulnerabilityScore 当日脆弱性层得分
 * @param structureScore 当日结构层得分
 * @param previousStructureScore 前一日结构层得分
 */
export function generateSignal(
  currentScore: number,
  scoreHistory: number[],
  currentState: string,
  previousState: string | null,
  vulnerabilityScore: number,
  structureScore: number,
  previousStructureScore: number | null,
): SignalOutput {
  // 1. 评分动量
  const velocity = calcVelocity(scoreHistory);
  let acceleration = 0;
  if (scoreHistory.length >= 5) {
    const prevVelocity = calcVelocity(scoreHistory.slice(0, -1));
    acceleration = velocity - prevVelocity;
  }

  // 2. 信号判断（优先级从高到低）
  let signal: Signal = 'HOLD';
  let confidence = 0.5;
  let reasoning = '';

  // 状态质量排序: A > B > C > D（注意 ASCII 中 A < B < C < D，方向相反）
  const stateRank: Record<string, number> = { A: 4, B: 3, C: 2, D: 1 };
  const curRank = stateRank[currentState] ?? 0;
  const prevRank = previousState ? (stateRank[previousState] ?? 0) : curRank;

  // STRONG_BUY: 状态升级（C→B 或 B→A）
  if (curRank > prevRank) {
    signal = 'STRONG_BUY';
    confidence = 0.85;
    reasoning = `状态升级 ${previousState}→${currentState}`;
  }
  // STRONG_SELL: 状态降级（A→B 或 B→C 或 C→D）
  else if (curRank < prevRank) {
    signal = 'STRONG_SELL';
    confidence = 0.85;
    reasoning = `状态降级 ${previousState}→${currentState}`;
  }
  // BUY: 低分区 + 上升动量 + 脆弱性健康
  // 回测验证: 低分区(36-51)的 7D 均回报 +5.51%，是最佳入场区
  else if (currentScore < 60 && velocity > 2 && vulnerabilityScore >= 17) {
    confidence = 0.55 + Math.min(0.25, velocity / 15);
    signal = 'BUY';
    reasoning = `低分区(${currentScore}) + 上升动量(v=${velocity.toFixed(1)}) + 脆弱性${vulnerabilityScore}≥17`;
  }
  // SELL: 高分区 + 下降动量 + 结构层快速恶化
  else if (
    currentScore > 70 && velocity < -2
    && previousStructureScore !== null
    && structureScore < previousStructureScore - 2
  ) {
    confidence = 0.55 + Math.min(0.25, Math.abs(velocity) / 15);
    signal = 'SELL';
    reasoning = `高分区(${currentScore}) + 下降动量(v=${velocity.toFixed(1)}) + 结构恶化(${structureScore}←${previousStructureScore})`;
  }
  // BUY 弱信号: 分数连续 3 天上升（不论分数水平）
  else if (scoreHistory.length >= 3 && velocity > 3 && acceleration > 0) {
    signal = 'BUY';
    confidence = 0.5;
    reasoning = `持续加速上升(v=${velocity.toFixed(1)}, a=${acceleration.toFixed(1)})`;
  }
  // SELL 弱信号: 分数连续 3 天下降
  else if (scoreHistory.length >= 3 && velocity < -3 && acceleration < 0) {
    signal = 'SELL';
    confidence = 0.5;
    reasoning = `持续加速下降(v=${velocity.toFixed(1)}, a=${acceleration.toFixed(1)})`;
  }
  // HOLD
  else {
    signal = 'HOLD';
    confidence = 0.5;
    reasoning = `无明确信号(score=${currentScore}, v=${velocity.toFixed(1)})`;
  }

  return { signal, confidence, reasoning, scoreVelocity: velocity, scoreAcceleration: acceleration };
}
