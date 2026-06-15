import { describe, it, expect } from 'vitest';
import {
  mean,
  variance,
  stdev,
  median,
  quantile,
  iqr,
  coefficientOfVariation,
  clamp,
} from './descriptive.js';

describe('descriptive statistics', () => {
  it('mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([])).toBe(0);
  });

  it('population variance & stdev', () => {
    // ชุดคลาสสิก mean=5, variance(pop)=4, sd=2
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(variance(xs, false)).toBeCloseTo(4, 6);
    expect(stdev(xs, false)).toBeCloseTo(2, 6);
  });

  it('sample variance differs (Bessel correction)', () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(variance(xs, true)).toBeCloseTo(32 / 7, 6);
  });

  it('quantile (R type-7) & median', () => {
    const xs = [1, 2, 3, 4];
    expect(median(xs)).toBeCloseTo(2.5, 6);
    expect(quantile(xs, 0.25)).toBeCloseTo(1.75, 6);
    expect(quantile(xs, 0.75)).toBeCloseTo(3.25, 6);
  });

  it('iqr fences', () => {
    const r = iqr([1, 2, 3, 4]);
    expect(r.q1).toBeCloseTo(1.75, 6);
    expect(r.q3).toBeCloseTo(3.25, 6);
    expect(r.iqr).toBeCloseTo(1.5, 6);
    expect(r.upperFence).toBeCloseTo(5.5, 6);
    expect(r.lowerFence).toBeCloseTo(-0.5, 6);
  });

  it('coefficient of variation', () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(coefficientOfVariation(xs)).toBeCloseTo(stdev(xs, true) / 5, 6);
  });

  it('clamp', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });
});
