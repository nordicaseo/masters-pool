import { auth, clerkClient } from '@clerk/nextjs/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { games, legacyUserEmails, participants } from '@/db/schema';
import { logError } from '@/lib/log';

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

/**
 * One-time account preservation for the 2026-06 Clerk instance migration.
 *
 * Existing `participants.user_id` / `games.created_by_user_id` values are ids
 * from the old Clerk instance. The `legacy_user_emails` table maps each old
 * id to the email that account signs in with on the new instance. On a
 * returning user's first authenticated home-page load we match their new
 * email here and re-point ownership of their rows to their new Clerk id.
 *
 * Idempotent and self-terminating: each mapping row is deleted once consumed,
 * and a cheap existence check short-circuits (no Clerk API call) once the
 * table is empty — i.e. after everyone has returned. Failures are logged but
 * never thrown, so a hiccup here can't break the page render.
 */
export async function relinkLegacyAccount(userId: string): Promise<void> {
  try {
    // Cheap gate: nothing left to migrate → return before any Clerk call.
    const remaining = await db.select({ id: legacyUserEmails.oldUserId }).from(legacyUserEmails).limit(1);
    if (remaining.length === 0) return;

    // Resolve this user's primary email on the new instance.
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const email = user.primaryEmailAddress?.emailAddress?.toLowerCase();
    if (!email) return;

    // Old account id(s) that map to this email.
    const matches = await db
      .select({ oldUserId: legacyUserEmails.oldUserId })
      .from(legacyUserEmails)
      .where(eq(sql`lower(${legacyUserEmails.email})`, email));
    if (matches.length === 0) return;
    const oldIds = matches.map((m) => m.oldUserId);

    // Games where this user already has a row under their NEW id — skip those
    // to avoid the (game_id, user_id) unique conflict.
    const existing = await db
      .select({ gameId: participants.gameId })
      .from(participants)
      .where(eq(participants.userId, userId));
    const ownedGameIds = new Set(existing.map((r) => r.gameId));

    const oldRows = await db
      .select({ id: participants.id, gameId: participants.gameId })
      .from(participants)
      .where(inArray(participants.userId, oldIds));
    const movable = oldRows.filter((r) => !ownedGameIds.has(r.gameId)).map((r) => r.id);

    if (movable.length > 0) {
      await db.update(participants).set({ userId }).where(inArray(participants.id, movable));
    }
    // Re-point pool ownership (creator-only powers: delete, manual roster, etc.).
    await db.update(games).set({ createdByUserId: userId }).where(inArray(games.createdByUserId, oldIds));

    // Consume the mappings so this user is never re-processed.
    await db.delete(legacyUserEmails).where(inArray(legacyUserEmails.oldUserId, oldIds));
  } catch (error) {
    logError(error, { subsystem: 'auth', operation: 'relink_legacy_account', extra: { userId } });
    // Non-fatal — the page must still render.
  }
}
