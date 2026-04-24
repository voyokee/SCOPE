# SCOPE — BTC Investment State Machine

A rules-based, 100-point scoring framework for medium-term BTC position management. It doesn't predict price — it constrains exposure in bad environments and sizes positions in good ones.

## How It Works

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

## Architecture

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

## Scoring Engine

The engine automatically scores ~70/100 points from live market data. The remaining ~30 points (Fed path, wave structure, ETF flows) are supplemented by AI analysis via Claude Code.

### Automated Data Sources

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

### Run the Scorer

```bash
cd scope-engine
cp .env.example .env          # Add your FRED_API_KEY
npm install
npx tsx src/index.ts          # Outputs JSON to stdout
```

### Run the Backtest

Validates the framework against 32 days of historical data (Mar 24 – Apr 24, 2026):

```bash
npx tsx src/backtest.ts       # Outputs Markdown report
```

Key backtest findings:
- SCOPE-midpoint captures **46%** of buy-and-hold returns with only **28%** of the drawdown (Sharpe 4.24 vs 3.79)
- The dual-condition C→D downgrade rule correctly blocked a false alarm on Mar 29, preserving +17.7% of subsequent gains
- Top predictive indicators: Spot CVD (|ρ|=0.68), Relative Strength (0.42), MA Arrangement (0.39)

## v4.0 Improvements

Based on backtest validation:

1. **Dynamic Funding & Basis** — Split from static thresholds into level + trend scoring. Funding uses all 10 rate periods; Basis cross-references OI change for leverage detection.

2. **Macro Consolidation** — Merged 3 redundant indicators (DXY/10Y/Risk, pairwise r>0.92) into a single weighted macro-conditions score (8 pts). Freed 2 pts for ETF cycle upgrade.

3. **ETF Data Reliability** — Added Bitbo.io AUM parser as stable reference. CoinGlass fallback chain with graceful degradation.

4. **Buy/Sell Signal Layer** — Generates directional signals from score velocity + state transitions. Backtested: BUY 7D return +4.15% > HOLD +3.18% > SELL +2.49%.

## Configuration

Create `scope-engine/.env`:

```
FRED_API_KEY=your_key_here
```

Get a free API key at [fred.stlouisfed.org/docs/api](https://fred.stlouisfed.org/docs/api/api_key.html).

## License

MIT