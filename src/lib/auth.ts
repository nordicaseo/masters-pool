import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { logError } from './log';

const COOKIE_NAME = 'mp_user';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

function sign(value: string): string {
  return createHmac('sha256', getSecret()).update(value).digest('hex');
}

function pack(participantId: number): string {
  const v = String(participantId);
  return `${v}.${sign(v)}`;
}

function unpack(raw: string): number | null {
  const idx = raw.indexOf('.');
  if (idx < 0) return null;
  const v = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = sign(v);
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (error) {
    logError(error, { subsystem: 'auth', operation: 'verify_cookie' });
    return null;
  }
  const id = Number(v);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function setParticipantCookie(participantId: number): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, pack(participantId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearParticipantCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getParticipantId(): Promise<number | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return unpack(raw);
}
