import { describe, it, expect } from 'vitest';
import { RULES_2567 } from './rules2567.js';
import { progressiveTax, marginalRate } from './engine.js';

describe('progressiveTax', () => {
  const b = RULES_2567.brackets;
  it('is zero up to the 150k exemption', () => {
    expect(progressiveTax(150000, b).tax).toBe(0);
  });
  it('taxes only the amount inside each bracket', () => {
    // 300,000 → 5% of (300k-150k) = 7,500
    expect(progressiveTax(300000, b).tax).toBeCloseTo(7500, 2);
  });
  it('stacks brackets correctly at 1,000,000', () => {
    // 7,500 + 10%*200k(20,000) + 15%*250k(37,500) + 20%*250k(50,000) = 115,000
    expect(progressiveTax(1000000, b).tax).toBeCloseTo(115000, 2);
  });
  it('reports the marginal rate of the top reached bracket', () => {
    expect(marginalRate(400000, b)).toBe(0.1);
    expect(marginalRate(6000000, b)).toBe(0.35);
  });
});
