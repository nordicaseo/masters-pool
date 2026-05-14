import { describe, expect, it } from 'vitest';
import { formatStakeItems, hasStakeItems } from '@/db/schema';

describe('formatStakeItems', () => {
  it('returns empty string for null / undefined', () => {
    expect(formatStakeItems(null)).toBe('');
    expect(formatStakeItems(undefined)).toBe('');
  });

  it('returns empty string when every field is empty', () => {
    expect(formatStakeItems({})).toBe('');
    expect(formatStakeItems({ beers: 0, hotDogs: 0, hotSoup: 0, other: '   ' })).toBe('');
  });

  it('pluralizes correctly', () => {
    expect(formatStakeItems({ beers: 1 })).toBe('1 beer');
    expect(formatStakeItems({ beers: 3 })).toBe('3 beers');
    expect(formatStakeItems({ hotDogs: 1 })).toBe('1 hot dog');
    expect(formatStakeItems({ hotDogs: 5 })).toBe('5 hot dogs');
    expect(formatStakeItems({ hotSoup: 1 })).toBe('1 hot soup');
    expect(formatStakeItems({ hotSoup: 2 })).toBe('2 hot soups');
  });

  it('joins multiple items with " · "', () => {
    expect(
      formatStakeItems({ beers: 3, hotDogs: 2, hotSoup: 1 }),
    ).toBe('3 beers · 2 hot dogs · 1 hot soup');
  });

  it('trims and appends the `other` field at the end', () => {
    expect(
      formatStakeItems({ beers: 1, other: '   loser does dishes  ' }),
    ).toBe('1 beer · loser does dishes');
  });

  it('handles only `other`', () => {
    expect(formatStakeItems({ other: 'winner picks the next course' })).toBe(
      'winner picks the next course',
    );
  });
});

describe('hasStakeItems', () => {
  it('returns false for null / undefined / empty', () => {
    expect(hasStakeItems(null)).toBe(false);
    expect(hasStakeItems(undefined)).toBe(false);
    expect(hasStakeItems({})).toBe(false);
  });

  it('returns false when every quantity is 0 and other is empty / whitespace', () => {
    expect(hasStakeItems({ beers: 0, hotDogs: 0, hotSoup: 0, other: '' })).toBe(false);
    expect(hasStakeItems({ beers: 0, other: '   ' })).toBe(false);
  });

  it('returns true when any quantity is positive', () => {
    expect(hasStakeItems({ beers: 1 })).toBe(true);
    expect(hasStakeItems({ hotDogs: 5 })).toBe(true);
    expect(hasStakeItems({ hotSoup: 2 })).toBe(true);
  });

  it('returns true when `other` has content (even with zero quantities)', () => {
    expect(hasStakeItems({ beers: 0, other: 'dishes' })).toBe(true);
  });
});
