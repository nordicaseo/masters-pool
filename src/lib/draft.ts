/**
 * Snake-draft helpers.
 *
 * A snake draft with N players and K picks each runs N*K overall picks.
 * Player order in round `r` (1-indexed) is:
 *   - r odd:  [1, 2, ..., N]
 *   - r even: [N, ..., 2, 1]
 *
 * The functions here are pure (no DB) so they can be unit-tested.
 */

/**
 * Returns the player slot (1..N) for each overall pick index 0..N*K-1.
 *
 * Example: snakeDraftOrder(2, 3) → [1, 2, 2, 1, 1, 2]
 * Example: snakeDraftOrder(3, 2) → [1, 2, 3, 3, 2, 1]
 */
export function snakeDraftOrder(n: number, k: number): number[] {
  if (n < 1 || k < 1) return [];
  const out: number[] = [];
  for (let r = 1; r <= k; r++) {
    if (r % 2 === 1) {
      for (let slot = 1; slot <= n; slot++) out.push(slot);
    } else {
      for (let slot = n; slot >= 1; slot--) out.push(slot);
    }
  }
  return out;
}

/**
 * Given the total number of picks already made (`pickedSoFar`), return the
 * player slot (1..N) whose turn it is next, or `null` if the draft is
 * complete (i.e., pickedSoFar >= n*k).
 */
export function nextSlot(pickedSoFar: number, n: number, k: number): number | null {
  if (pickedSoFar >= n * k) return null;
  const order = snakeDraftOrder(n, k);
  return order[pickedSoFar] ?? null;
}

/**
 * Deterministic Fisher-Yates shuffle keyed by a numeric seed. We use this
 * to randomize pick_order from the participant ids when the snake draft
 * starts. Deterministic so the same (seed, ids) always produces the same
 * order — handy for debugging, replays, and tests.
 */
export function shuffleWithSeed<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed | 0;
  for (let i = out.length - 1; i > 0; i--) {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const j = Math.abs(s) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
