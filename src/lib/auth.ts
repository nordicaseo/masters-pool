import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { participants } from '@/db/schema';

/**
 * Resolve the current Clerk user's `participants` row inside a given
 * game, if any. Returns null when:
 *   - the user is not signed in, or
 *   - the user has not joined this game yet.
 *
 * Legacy participants (created before Clerk was added) have `user_id = NULL`
 * and are not reachable via this helper. They'll show up on leaderboards
 * but the original creator has to re-join with their Clerk account to
 * regain write access. That's an acceptable one-time migration cost.
 */
export async function getParticipantForGame(gameId: number): Promise<{
  id: number;
  userId: string;
  displayName: string;
  picksLocked: number;
} | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const [row] = await db
    .select({
      id: participants.id,
      userId: participants.userId,
      displayName: participants.displayName,
      picksLocked: participants.picksLocked,
    })
    .from(participants)
    .where(and(eq(participants.userId, userId), eq(participants.gameId, gameId)))
    .limit(1);
  if (!row || row.userId === null) return null;
  return {
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    picksLocked: row.picksLocked,
  };
}

/**
 * Get the currently authenticated Clerk user id. Throws if not signed in
 * (intended for use inside route handlers that have already gated on auth).
 */
export async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error('not signed in');
  return userId;
}
