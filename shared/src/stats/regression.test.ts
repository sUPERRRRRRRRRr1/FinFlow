import { describe, it, expect } from 'vitest';
import { linearRegression, forecast, forecastNext } from './regression.js';
import { shannonEntropy, normalizedEntropy } from './entropy.js';
import { detectOutliers } from './outliers.js';

describe('linear regression (least squares)', () => {
  it('fits a perfect line exactly', () => {
    const fit = linearRegression([0, 1, 2, 3], [1, 3, 5, 7]);
    expect(fit.slope).toBeCloseTo(2, 6);
    expect(fit.intercept).toBeCloseTo(1, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
    expect(forecast(fit, 4)).toBeCloseTo(9, 6);
    expect(forecastNext(fit, 2)).toEqual([expect.closeTo(9, 6), expect.closeTo(11, 6)]);
  });

  it('handles noisy data with 0<r2<1', () => {
    const fit = linearRegression([0, 1, 2, 3], [1, 2, 2, 5]);
    expect(fit.slope).toBeGreaterThan(0);
    expect(fit.r2).toBeGreaterThan(0);
    expect(fit.r2).toBeLessThan(1);
  });
});

describe('entropy', () => {
  it('uniform distribution → max entropy, Hn=1', () => {
    expect(shannonEntropy([1, 1])).toBeCloseTo(Math.log(2), 6);
    expect(normalizedEntropy([1, 1])).toBeCloseTo(1, 6);
    expect(normalizedEntropy([1, 1, 1, 1])).toBeCloseTo(1, 6);
  });

  it('single category → Hn=0', () => {
    expect(normalizedEntropy([5, 0, 0])).toBe(0);
  });

  it('skewed 75/25', () => {
    expect(shannonEntropy([3, 1])).toBeCloseTo(0.5623351446, 6);
    expect(normalizedEntropy([3, 1])).toBeCloseTo(0.5623351446 / Math.log(2), 6);
  });
});

describe('outlier detection', () => {
  it('flags an IQR-fence outlier', () => {
    const { outliers } = detectOutliers([10, 10, 10, 10, 100], { highOnly: true });
    expect(outliers).toHaveLength(1);
    expect(outliers[0]!.value).toBe(100);
    expect(outliers[0]!.beyondIqr).toBe(true);
  });

  it('flags a clear z-score outlier', () => {
    const { outliers } = detectOutliers([5, 5, 5, 5, 5, 5, 5, 5, 5, 50], { zThreshold: 2 });
    expect(outliers.some((o) => o.value === 50)).toBe(true);
  });

  it('no outliers in flat data', () => {
    const { outliers } = detectOutliers([5, 5, 5, 5, 5]);
    expect(outliers).toHaveLength(0);
  });
});
