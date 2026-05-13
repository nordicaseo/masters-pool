import { describe, expect, it } from 'vitest';
import { nextSlot, shuffleWithSeed, snakeDraftOrder } from '@/lib/draft';

describe('snakeDraftOrder', () => {
  it('returns 2-player 3-pick snake', () => {
    expect(snakeDraftOrder(2, 3)).toEqual([1, 2, 2, 1, 1, 2]);
  });
  it('returns 3-player 2-pick snake', () => {
    expect(snakeDraftOrder(3, 2)).toEqual([1, 2, 3, 3, 2, 1]);
  });
  it('returns 4-player 3-pick snake', () => {
    expect(snakeDraftOrder(4, 3)).toEqual([1, 2, 3, 4, 4, 3, 2, 1, 1, 2, 3, 4]);
  });
  it('handles 1 player', () => {
    expect(snakeDraftOrder(1, 4)).toEqual([1, 1, 1, 1]);
  });
  it('returns [] for invalid inputs', () => {
    expect(snakeDraftOrder(0, 3)).toEqual([]);
    expect(snakeDraftOrder(2, 0)).toEqual([]);
  });
});

describe('nextSlot', () => {
  it('walks the snake', () => {
    const order = [0, 1, 2, 3, 4, 5]; // 2x3 snake = [1,2,2,1,1,2]
    expect(order.map((p) => nextSlot(p, 2, 3))).toEqual([1, 2, 2, 1, 1, 2]);
  });
  it('returns null when complete', () => {
    expect(nextSlot(6, 2, 3)).toBeNull();
    expect(nextSlot(7, 2, 3)).toBeNull();
  });
});

describe('shuffleWithSeed', () => {
  it('is deterministic for the same seed', () => {
    const a = shuffleWithSeed([1, 2, 3, 4, 5], 42);
    const b = shuffleWithSeed([1, 2, 3, 4, 5], 42);
    expect(a).toEqual(b);
  });
  it('preserves all elements', () => {
    const shuffled = shuffleWithSeed([1, 2, 3, 4, 5, 6, 7, 8], 12345);
    expect([...shuffled].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('produces different orders for different seeds', () => {
    const a = shuffleWithSeed([1, 2, 3, 4, 5, 6, 7, 8], 1);
    const b = shuffleWithSeed([1, 2, 3, 4, 5, 6, 7, 8], 2);
    expect(a).not.toEqual(b);
  });
});
