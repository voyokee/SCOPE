import { describe, test, expect } from 'vitest';
import {
  sma,
  smaArray,
  linearSlope,
  percentileRank,
  changePercent,
  volumeRatio,
  atr,
  atrPercentile,
  annualizedBasis,
} from '../utils.js';
import type { Kline } from '../types.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeKline(
  close: number,
  high?: number,
  low?: number,
  vol = 1000,
  i = 0,
): Kline {
  return {
    openTime: i * 86_400_000,
    open: close,
    high: high ?? close * 1.01,
    low: low ?? close * 0.99,
    close,
    volume: vol,
    closeTime: i * 86_400_000 + 86_399_000,
    takerBuyBaseVolume: vol * 0.55,
  };
}

/** N identical klines at `price` */
function uniformKlines(n: number, price: number, vol = 1000): Kline[] {
  return Array.from({ length: n }, (_, i) => makeKline(price, price * 1.01, price * 0.99, vol, i));
}

// ─── sma ────────────────────────────────────────────────────────────────────

describe('sma', () => {
  test('average of equal values', () => {
    expect(sma([10, 10, 10, 10, 10], 5)).toBe(10);
  });

  test('uses only the last `period` values', () => {
    // [1,1,1,1, 5,5,5,5,5] → sma(5) = 5
    const values = [...Array(4).fill(1), ...Array(5).fill(5)];
    expect(sma(values, 5)).toBe(5);
  });

  test('throws when insufficient data', () => {
    expect(() => sma([1, 2, 3], 5)).toThrow();
  });
});

// ─── smaArray ───────────────────────────────────────────────────────────────

describe('smaArray', () => {
  test('output length = input length - period + 1', () => {
    const arr = smaArray([1, 2, 3, 4, 5], 3);
    expect(arr.length).toBe(3);
  });

  test('correct values for simple sequence', () => {
    const arr = smaArray([1, 2, 3, 4, 5], 3);
    expect(arr[0]).toBeCloseTo(2, 5);   // (1+2+3)/3
    expect(arr[1]).toBeCloseTo(3, 5);   // (2+3+4)/3
    expect(arr[2]).toBeCloseTo(4, 5);   // (3+4+5)/3
  });
});

// ─── linearSlope ────────────────────────────────────────────────────────────

describe('linearSlope', () => {
  test('flat series → ~0', () => {
    const values = Array(20).fill(100);
    expect(linearSlope(values, 20)).toBeCloseTo(0, 8);
  });

  test('strictly rising → positive', () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(linearSlope(values, 20)).toBeGreaterThan(0);
  });

  test('strictly falling → negative', () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(linearSlope(values, 20)).toBeLessThan(0);
  });

  test('rising faster → larger slope than rising slowly', () => {
    const fast = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
    const slow = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(linearSlope(fast, 20)).toBeGreaterThan(linearSlope(slow, 20));
  });

  test('throws when insufficient data', () => {
    expect(() => linearSlope([1, 2], 5)).toThrow();
  });
});

// ─── percentileRank ─────────────────────────────────────────────────────────

describe('percentileRank', () => {
  test('lowest value → 0', () => {
    expect(percentileRank([1, 2, 3, 4, 5], 1)).toBeCloseTo(10, 5); // 0.5/5*100
  });

  test('middle value → 50 in symmetric set', () => {
    expect(percentileRank([1, 2, 3, 4, 5], 3)).toBeCloseTo(50, 5); // (2+0.5)/5*100
  });

  test('highest value → high percentile', () => {
    expect(percentileRank([1, 2, 3, 4, 5], 5)).toBeCloseTo(90, 5); // (4+0.5)/5*100
  });

  test('value above all → 100', () => {
    expect(percentileRank([1, 2, 3], 100)).toBe(100);
  });

  test('value below all → 0', () => {
    expect(percentileRank([1, 2, 3], 0)).toBe(0);
  });
});

// ─── changePercent ──────────────────────────────────────────────────────────

describe('changePercent', () => {
  test('20% rise over 1 day', () => {
    expect(changePercent([100, 120], 1)).toBeCloseTo(20, 5);
  });

  test('-10% over 7 days', () => {
    const values = [100, 105, 103, 101, 99, 97, 95, 90];
    expect(changePercent(values, 7)).toBeCloseTo(-10, 5);
  });

  test('insufficient data → 0', () => {
    expect(changePercent([100], 5)).toBe(0);
  });

  test('zero base → 0 (no div-by-zero)', () => {
    expect(changePercent([0, 100], 1)).toBe(0);
  });
});

// ─── volumeRatio ────────────────────────────────────────────────────────────

describe('volumeRatio', () => {
  test('equal volumes → 1.0', () => {
    const vols = Array(20).fill(1000);
    expect(volumeRatio(vols, 5, 20)).toBeCloseTo(1, 5);
  });

  test('recent volumes half of average → ~0.5', () => {
    // last 5 = 500, prior 15 = 1000 → shortAvg=500, longAvg=(15*1000+5*500)/20=875
    const vols = [...Array(15).fill(1000), ...Array(5).fill(500)];
    const ratio = volumeRatio(vols, 5, 20);
    expect(ratio).toBeCloseTo(500 / 875, 3);
  });

  test('insufficient data → 1 (neutral fallback)', () => {
    expect(volumeRatio([1000, 2000, 3000], 5, 20)).toBe(1);
  });
});

// ─── atr ────────────────────────────────────────────────────────────────────

describe('atr', () => {
  test('uniform klines → ATR ≈ H-L spread', () => {
    const klines = uniformKlines(20, 100); // high=101, low=99 → H-L=2
    const result = atr(klines, 14);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeCloseTo(2, 0); // 2% of 100
  });

  test('insufficient data → 0', () => {
    expect(atr(uniformKlines(5, 100), 14)).toBe(0);
  });
});

// ─── atrPercentile ──────────────────────────────────────────────────────────

describe('atrPercentile', () => {
  test('insufficient data → 50 (neutral fallback)', () => {
    // needs 14+60+1 = 75 klines; give 74
    expect(atrPercentile(uniformKlines(74, 100), 14, 60)).toBe(50);
  });

  test('uniform klines → percentile in [0, 100]', () => {
    const result = atrPercentile(uniformKlines(80, 100), 14, 60);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  test('recent ATR spike → high percentile', () => {
    // First 70 klines: tiny range (low ATR baseline)
    const stable = Array.from({ length: 70 }, (_, i) =>
      makeKline(100, 100.1, 99.9, 1000, i),
    );
    // Next 15 klines: huge range (spike ATR to push current percentile high)
    const spike = Array.from({ length: 15 }, (_, i) =>
      makeKline(100, 120, 80, 1000, 70 + i),
    );
    const pct = atrPercentile([...stable, ...spike], 14, 60);
    expect(pct).toBeGreaterThan(50);
  });

  test('current ATR compressed after volatile history → low percentile', () => {
    // First 70 klines: large range (volatile history)
    const volatile = Array.from({ length: 70 }, (_, i) =>
      makeKline(100, 115, 85, 1000, i),
    );
    // Next 15 klines: tiny range (compressed current ATR)
    const quiet = Array.from({ length: 15 }, (_, i) =>
      makeKline(100, 100.05, 99.95, 1000, 70 + i),
    );
    const pct = atrPercentile([...volatile, ...quiet], 14, 60);
    expect(pct).toBeLessThan(20);
  });
});

// ─── annualizedBasis ────────────────────────────────────────────────────────

describe('annualizedBasis', () => {
  test('no basis (future = spot) → 0%', () => {
    expect(annualizedBasis(100, 100, 90)).toBe(0);
  });

  test('1% premium over 365 days → 1% annualized', () => {
    expect(annualizedBasis(101, 100, 365)).toBeCloseTo(1, 5);
  });

  test('1% premium over 73 days → 5% annualized', () => {
    expect(annualizedBasis(101, 100, 73)).toBeCloseTo(5, 3);
  });

  test('negative basis (backwardation)', () => {
    expect(annualizedBasis(99, 100, 365)).toBeCloseTo(-1, 5);
  });

  test('zero daysToExpiry → 0 (guard against Infinity)', () => {
    expect(annualizedBasis(101, 100, 0)).toBe(0);
  });
});
