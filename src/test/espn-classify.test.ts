import { describe, expect, it } from 'vitest';
import { classifyHole } from '@/lib/espn';

describe('classifyHole', () => {
  it('returns null for par', () => {
    expect(classifyHole(4, 4, 'PAR')).toBeNull();
  });

  it('classifies birdie', () => {
    expect(classifyHole(3, 4, 'BIRDIE')).toBe('birdie');
  });

  it('classifies eagle', () => {
    expect(classifyHole(3, 5, 'EAGLE')).toBe('eagle');
  });

  it('classifies albatross', () => {
    expect(classifyHole(2, 5, 'ALBATROSS')).toBe('albatross');
    expect(classifyHole(2, 5, 'DOUBLE_EAGLE')).toBe('albatross');
  });

  it('classifies bogey', () => {
    expect(classifyHole(5, 4, 'BOGEY')).toBe('bogey');
  });

  it('classifies double bogey', () => {
    expect(classifyHole(6, 4, 'DOUBLE_BOGEY')).toBe('double_bogey');
  });

  it('classifies triple+', () => {
    expect(classifyHole(7, 4, 'TRIPLE_BOGEY')).toBe('triple_plus');
    expect(classifyHole(8, 4, 'OTHER')).toBe('triple_plus');
  });

  it('treats any 1-stroke hole as a hole-in-one regardless of par', () => {
    // ESPN reports a 1 on a par 3 as EAGLE — we still want hole_in_one.
    expect(classifyHole(1, 3, 'EAGLE')).toBe('hole_in_one');
    expect(classifyHole(1, 4, 'ALBATROSS')).toBe('hole_in_one');
  });

  it('falls back to stroke math when scoreType is missing', () => {
    expect(classifyHole(3, 4, undefined)).toBe('birdie');
    expect(classifyHole(5, 4, undefined)).toBe('bogey');
    expect(classifyHole(6, 4, undefined)).toBe('double_bogey');
    expect(classifyHole(3, 5, undefined)).toBe('eagle');
    expect(classifyHole(2, 5, undefined)).toBe('albatross');
  });
});
