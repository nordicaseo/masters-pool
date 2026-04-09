/**
 * 6-character invite codes. Excludes ambiguous chars (0/O, 1/I/L).
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateGameCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function normalizeGameCode(input: string): string {
  return input.trim().toUpperCase();
}
