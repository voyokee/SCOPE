# SCOPE — BTC Investment State Machine

[English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

A rules-based, 100-point scoring framework for medium-term BTC position management. It doesn't predict price — it constrains exposure in bad environments and sizes positions in good ones.

### How It Works

Three scoring layers feed a four-state machine:

```
  Cycle Layer (25 pts)          "Can you go big?"
+ Structure Layer (50 pts)      "Should you?"
+ Fragility Layer (25 pts)      "Do you dare?"
= Total Score (0-100)    →     State A / B / C / D
```

| State | Score | Position | Description |
|-------|-------|----------|-------------|
| **A** | 80-100 | 65-100% | Trend advance — ride the wave |
| **B** | 60-79 | 40-65% | Tailwind recovery — buy dips > chase |
| **C** | 40-59 | 15-40% | Fragile balance — tactical only |
| **D** | 0-39 | 0-15% | Defense — no leverage, drawdown control |

Upgrades require 2-day confirmation. Downgrades are immediate. A circuit breaker freezes everything for 3 days on extreme events (>15% daily drop, exchange hacks, stablecoin depegs).

### Architecture

```
scope.md                  Scoring rules (the source of truth)
scope-data/
  state.json              Current state machine state
  history/                Daily scoring snapshots (JSON)
scope-engine/
  src/
    index.ts              Main entry — fetches data, runs scorers, outputs JSON
    scorers.ts            17 automated scoring functions (v4.0)
    fetchers.ts           20+ parallel API data fetchers
    signal.ts             Buy/sell signal generator (v4.0)
    backtest.ts           Historical backtest & validation
    utils.ts              SMA, slope, ATR, swing point detection
    types.ts              TypeScript interfaces
```

### Scoring Engine

The engine automatically scores ~70/100 points from live market data. The remaining ~30 points (Fed path, wave structure, ETF flows) are supplemented by AI analysis via Claude Code.

#### Automated Data Sources

| Source | Data | Indicators |
|--------|------|-----------|
| Binance Spot/Futures | Price, funding, OI, L/S ratios | 10 indicators |
| FRED API | 10Y yield | Macro conditions |
| Yahoo Finance | DXY, QQQ, VIX | Macro conditions |
| CoinGecko | Stablecoins, dominance | 2 indicators |
| DefiLlama | Stablecoin supply | Purchasing power |
| Coinbase | BTC spot price | Premium calculation |
| Deribit | Options skew | Position crowding |
| Bitbo.io | ETF AUM snapshot | Reference data |

#### Run the Scorer

```bash
cd scope-engine
cp .env.example .env          # Add your FRED_API_KEY
npm install
npx tsx src/index.ts          # Outputs JSON to stdout
```

#### Run the Backtest

Validates the framework against 32 days of historical data (Mar 24 – Apr 24, 2026):

```bash
npx tsx src/backtest.ts       # Outputs Markdown report
```

Key backtest findings:
- SCOPE-midpoint captures **46%** of buy-and-hold returns with only **28%** of the drawdown (Sharpe 4.24 vs 3.79)
- The dual-condition C→D downgrade rule correctly blocked a false alarm on Mar 29, preserving +17.7% of subsequent gains
- Top predictive indicators: Spot CVD (|ρ|=0.68), Relative Strength (0.42), MA Arrangement (0.39)

### v4.0 Improvements

Based on backtest validation:

1. **Dynamic Funding & Basis** — Split from static thresholds into level + trend scoring. Funding uses all 10 rate periods; Basis cross-references OI change for leverage detection.

2. **Macro Consolidation** — Merged 3 redundant indicators (DXY/10Y/Risk, pairwise r>0.92) into a single weighted macro-conditions score (8 pts). Freed 2 pts for ETF cycle upgrade.

3. **ETF Data Reliability** — Added Bitbo.io AUM parser as stable reference. CoinGlass fallback chain with graceful degradation.

4. **Buy/Sell Signal Layer** — Generates directional signals from score velocity + state transitions. Backtested: BUY 7D return +4.15% > HOLD +3.18% > SELL +2.49%.

### Configuration

Create `scope-engine/.env`:

```
FRED_API_KEY=your_key_here
```

Get a free API key at [fred.stlouisfed.org/docs/api](https://fred.stlouisfed.org/docs/api/api_key.html).

---

<a id="中文"></a>

## 中文

基于规则的 100 分制 BTC 中短期仓位管理框架。它不预测价格 — 而是在差环境中约束暴露，在好环境中合理配仓。

### 工作原理

三层评分驱动四状态机：

```
  周期层（25 分）           "能不能做大？"
+ 结构层（50 分）           "该不该做？"
+ 脆弱性层（25 分）         "敢不敢做重？"
= 总分（0-100）      →     状态 A / B / C / D
```

| 状态 | 分数 | 仓位 | 说明 |
|------|------|------|------|
| **A** | 80-100 | 65-100% | 趋势推进 — 顺势持仓，回调加仓 |
| **B** | 60-79 | 40-65% | 顺风修复 — 以现货和低杠杆为主 |
| **C** | 40-59 | 15-40% | 脆弱平衡 — 战术交易，少信仰多确认 |
| **D** | 0-39 | 0-15% | 防守状态 — 不用杠杆，控制回撤 |

升级需要连续 2 个日线收盘确认。降级即时生效。极端事件（单日跌 >15%、交易所安全事件、稳定币脱锚 >2%）触发熔断，冻结 3 个日线收盘。

### 项目结构

```
scope.md                  评分规则（唯一权威来源）
scope-data/
  state.json              当前状态机状态
  history/                每日评分快照（JSON）
scope-engine/
  src/
    index.ts              主入口 — 获取数据、运行评分、输出 JSON
    scorers.ts            17 个自动评分函数（v4.0）
    fetchers.ts           20+ 个并行 API 数据获取器
    signal.ts             买卖信号生成器（v4.0）
    backtest.ts           历史回测与验证
    utils.ts              SMA、斜率、ATR、摆动点检测
    types.ts              TypeScript 类型定义
```

### 评分引擎

引擎从实时市场数据中自动评出约 70/100 分。剩余约 30 分（Fed 路径、波段结构、ETF 流量）由 Claude Code AI 分析补充。

#### 自动化数据源

| 数据源 | 数据内容 | 覆盖指标 |
|--------|---------|---------|
| Binance 现货/合约 | 价格、funding、OI、多空比 | 10 个指标 |
| FRED API | 10Y 国债收益率 | 宏观环境 |
| Yahoo Finance | DXY、QQQ、VIX | 宏观环境 |
| CoinGecko | 稳定币、市占率 | 2 个指标 |
| DefiLlama | 稳定币总供给 | 购买力指标 |
| Coinbase | BTC 现货价 | Premium 计算 |
| Deribit | 期权偏斜度 | 仓位一致性 |
| Bitbo.io | ETF AUM 快照 | 参考数据 |

#### 运行评分

```bash
cd scope-engine
cp .env.example .env          # 填入你的 FRED_API_KEY
npm install
npx tsx src/index.ts          # JSON 输出到 stdout
```

#### 运行回测

基于 32 天历史数据（2026 年 3 月 24 日 – 4 月 24 日）验证框架有效性：

```bash
npx tsx src/backtest.ts       # 输出 Markdown 报告
```

关键回测发现：
- SCOPE 中性策略捕获了 buy-and-hold **46%** 的收益，回撤仅为其 **28%**（Sharpe 4.24 vs 3.79）
- C→D 双条件降级规则在 3/29 正确阻止了误降级，保住了后续 **+17.7%** 的涨幅
- 预测力最强的指标：Spot CVD（|ρ|=0.68）、相对强弱（0.42）、均线排列（0.39）

### v4.0 改进

基于回测验证驱动的四项改进：

1. **动态 Funding & Basis** — 从静态阈值拆分为"水平 + 趋势"双维评分。Funding 利用全部 10 期数据；Basis 交叉引用 OI 变化率检测杠杆堆积。

2. **宏观指标合并** — 将 3 个高度冗余的指标（DXY/10Y/风险偏好，配对 r>0.92）合并为加权综合评分（8 分），释放 2 分给 ETF 周期水位提权。

3. **ETF 数据可靠性** — 新增 Bitbo.io AUM 解析（静态 HTML，稳定）。CoinGlass Fallback Chain 优雅降级。

4. **买卖信号层** — 基于评分速度和状态转换生成方向信号。回测验证：BUY 7D 回报 +4.15% > HOLD +3.18% > SELL +2.49%。

### 配置

创建 `scope-engine/.env`：

```
FRED_API_KEY=your_key_here
```

在 [fred.stlouisfed.org/docs/api](https://fred.stlouisfed.org/docs/api/api_key.html) 免费申请 API Key。

## License

MIT
