/**
 * In-game activity feed.
 *
 * Aggregates every interesting moment in a pool — per-hole scoring
 * events, substitutions, rule-change proposals, emergency pick swaps —
 * into one time-ordered stream the sidebar can render. Built deliberately
 * cheap: a handful of small queries on a single pool, merged in JS.
 *
 * Each item carries a viewer-aware playful message (`"Rory just bogeyed
 * (your pick) — -1."` vs `"Rory just bogeyed (Ebbi's pick)."`) so the
 * UI doesn't have to know how to attribute events.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  emergencySwapProposals,
  games,
  golfers as golfersTable,
  participants,
  picks,
  ruleChangeProposals,
  scoringEvents,
  substitutions,
  type ScoringEventKind,
  type SubstitutionWindow,
} from '@/db/schema';

export type FeedRelevance = 'yours' | 'shared' | 'rival' | 'pool';

export type FeedItem = {
  /** Stable id across renders so React keys are happy. */
  id: string;
  timestamp: Date;
  category: 'event' | 'substitution' | 'rule_change' | 'emergency_swap';
  relevance: FeedRelevance;
  /** Big emoji shown next to the message. */
  emoji: string;
  /** Pre-rendered playful copy. Pure-function output of `messageForEvent` etc. */
  message: string;
  /** Optional positive/negative tone hint for color. */
  tone: 'good' | 'bad' | 'neutral';
};

/**
 * Pure: turn a scoring event + its attribution into a feed message.
 * Exported so tests can pin down the copy.
 */
export function messageForEvent(input: {
  golferName: string;
  kind: ScoringEventKind;
  round: number;
  hole: number;
  points: number;
  ownedByViewer: boolean;
  otherOwners: string[];
}): { emoji: string; message: string; tone: 'good' | 'bad' | 'neutral' } {
  const { golferName, kind, round, hole, points, ownedByViewer, otherOwners } =
    input;

  const verb: Record<ScoringEventKind, { emoji: string; text: string }> = {
    birdie: { emoji: '🐦', text: `birdied hole ${hole}` },
    eagle: { emoji: '🦅', text: `eagled hole ${hole}!` },
    albatross: { emoji: '🦫', text: `made an ALBATROSS on hole ${hole}!!` },
    hole_in_one: { emoji: '🎯', text: `aced hole ${hole}!!` },
    bogey: { emoji: '😬', text: `bogeyed hole ${hole}` },
    double_bogey: { emoji: '😖', text: `double bogeyed hole ${hole}` },
    triple_plus: { emoji: '💀', text: `imploded with a triple+ on hole ${hole}` },
    finish_1: { emoji: '🏆', text: 'WON the tournament' },
    finish_2: { emoji: '🥈', text: 'finished 2nd' },
    finish_3: { emoji: '🥉', text: 'finished 3rd' },
    missed_cut: { emoji: '🍺', text: 'missed the cut' },
  };
  const v = verb[kind];

  const goodKinds: ScoringEventKind[] = [
    'birdie',
    'eagle',
    'albatross',
    'hole_in_one',
    'finish_1',
    'finish_2',
    'finish_3',
  ];
  const badKinds: ScoringEventKind[] = [
    'bogey',
    'double_bogey',
    'triple_plus',
    'missed_cut',
  ];
  const tone: 'good' | 'bad' | 'neutral' = goodKinds.includes(kind)
    ? 'good'
    : badKinds.includes(kind)
      ? 'bad'
      : 'neutral';

  const attribution = formatAttribution(ownedByViewer, otherOwners);
  const roundTag = round > 0 ? ` (R${round})` : '';
  const pointsTag = points !== 0 ? ` ${points > 0 ? '+' : ''}${points} pts.` : '';
  return {
    emoji: v.emoji,
    message: `${golferName} just ${v.text}${roundTag}${attribution}${pointsTag}`,
    tone,
  };
}

function formatAttribution(
  ownedByViewer: boolean,
  otherOwners: string[],
): string {
  if (ownedByViewer && otherOwners.length === 0) return ' — your pick.';
  if (ownedByViewer && otherOwners.length === 1)
    return ` — your pick + ${otherOwners[0]}'s.`;
  if (ownedByViewer && otherOwners.length > 1)
    return ` — your pick + ${otherOwners.length} others'.`;
  if (otherOwners.length === 1) return ` — ${otherOwners[0]}'s pick.`;
  if (otherOwners.length > 1)
    return ` — picked by ${otherOwners.join(', ')}.`;
  return ''; // nobody's pick — shouldn't surface in the feed, defensive
}

/** Pure message for a substitution. */
export function messageForSubstitution(input: {
  participantName: string;
  droppedGolferName: string;
  newGolferName: string;
  window: SubstitutionWindow;
  costPoints: number;
  isViewer: boolean;
}): { emoji: string; message: string; tone: 'neutral' } {
  const { participantName, droppedGolferName, newGolferName, window, costPoints, isViewer } = input;
  const dayLabel = window === 'day_1' ? 'Day 1' : 'Day 2';
  const who = isViewer ? 'You' : participantName;
  const verb = isViewer ? 'swapped' : 'swapped';
  const costTag = costPoints < 0 ? ` (cost ${costPoints} pts)` : '';
  return {
    emoji: '🔄',
    message: `${who} ${verb} ${droppedGolferName} → ${newGolferName} after ${dayLabel}${costTag}.`,
    tone: 'neutral',
  };
}

/** Pure message for a rule-change proposal event. */
export function messageForRuleChange(input: {
  proposerName: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  summary: string;
  isViewer: boolean;
}): { emoji: string; message: string; tone: 'neutral' } {
  const who = input.isViewer ? 'You' : input.proposerName;
  const action =
    input.status === 'approved'
      ? '✅ Rule change approved'
      : input.status === 'rejected'
        ? '❌ Rule change rejected'
        : input.status === 'cancelled'
          ? '↩️ Rule change cancelled'
          : '⚖️ Rule change proposed';
  const lead = input.status === 'pending' ? `${who} proposed:` : action + ':';
  return {
    emoji: input.status === 'approved' ? '✅' : '⚖️',
    message: `${lead} ${input.summary}`,
    tone: 'neutral',
  };
}

/** Pure message for an emergency-swap proposal event. */
export function messageForEmergencySwap(input: {
  participantName: string;
  droppedGolferName: string;
  newGolferName: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  isViewer: boolean;
}): { emoji: string; message: string; tone: 'neutral' } {
  const who = input.isViewer ? 'You' : input.participantName;
  const lead =
    input.status === 'approved'
      ? `✅ Emergency swap applied for ${who}:`
      : input.status === 'rejected'
        ? `❌ Emergency swap rejected for ${who}:`
        : input.status === 'cancelled'
          ? `↩️ Emergency swap cancelled by ${who}:`
          : `🚨 ${who} requested emergency swap:`;
  return {
    emoji: input.status === 'approved' ? '✅' : '🚨',
    message: `${lead} ${input.droppedGolferName} → ${input.newGolferName}.`,
    tone: 'neutral',
  };
}

/**
 * Decide how an event should be tagged for color/border. "yours" =
 * picked by the viewer (alone or with others). "rival" = picked only by
 * other participants. "shared" reserved for future use. "pool" = no
 * specific pick attribution (rule changes, future tournament-level
 * events).
 */
function relevance(
  ownedByViewer: boolean,
  otherOwners: string[],
): FeedRelevance {
  if (ownedByViewer) return 'yours';
  if (otherOwners.length > 0) return 'rival';
  return 'pool';
}

/**
 * Build the full activity feed for a game, viewer-aware. Limits to the
 * `limit` most recent items across all sources.
 */
export async function getGameActivityFeed(input: {
  gameId: number;
  viewerParticipantId: number | null;
  /** Default 50 — large enough to feel "live", small enough to keep the page light. */
  limit?: number;
}): Promise<FeedItem[]> {
  const limit = input.limit ?? 50;

  // --- 1. Per-hole scoring events that fall inside ANY pick's active period.
  const allPicksRows = await db
    .select({
      pickId: picks.id,
      participantId: picks.participantId,
      golferId: picks.golferId,
      startRound: picks.startRound,
      endRound: picks.endRound,
      participantName: participants.displayName,
    })
    .from(picks)
    .innerJoin(participants, eq(participants.id, picks.participantId))
    .where(eq(participants.gameId, input.gameId));

  // Index picks by golferId for O(events) attribution.
  const picksByGolfer = new Map<number, typeof allPicksRows>();
  for (const p of allPicksRows) {
    const arr = picksByGolfer.get(p.golferId) ?? [];
    arr.push(p);
    picksByGolfer.set(p.golferId, arr);
  }

  const recentEvents = await db
    .select({
      id: scoringEvents.id,
      golferId: scoringEvents.golferId,
      golferName: golfersTable.name,
      kind: scoringEvents.kind,
      round: scoringEvents.round,
      hole: scoringEvents.hole,
      points: scoringEvents.points,
      createdAt: scoringEvents.createdAt,
    })
    .from(scoringEvents)
    .innerJoin(golfersTable, eq(golfersTable.id, scoringEvents.golferId))
    .where(eq(scoringEvents.gameId, input.gameId))
    .orderBy(desc(scoringEvents.createdAt))
    .limit(limit * 2);

  const eventItems: FeedItem[] = [];
  for (const e of recentEvents) {
    const candidatePicks = picksByGolfer.get(e.golferId) ?? [];
    const activePicks = candidatePicks.filter(
      (p) => e.round === 0
        ? p.endRound === 99
        : e.round >= p.startRound && e.round <= p.endRound,
    );
    if (activePicks.length === 0) continue; // no one held this golfer at this time → not feed-worthy
    const ownedByViewer = activePicks.some(
      (p) => p.participantId === input.viewerParticipantId,
    );
    const otherOwners = activePicks
      .filter((p) => p.participantId !== input.viewerParticipantId)
      .map((p) => p.participantName);
    const { emoji, message, tone } = messageForEvent({
      golferName: e.golferName,
      kind: e.kind,
      round: e.round,
      hole: e.hole,
      points: e.points,
      ownedByViewer,
      otherOwners,
    });
    eventItems.push({
      id: `event:${e.id}`,
      timestamp: e.createdAt,
      category: 'event',
      relevance: relevance(ownedByViewer, otherOwners),
      emoji,
      message,
      tone,
    });
  }

  // --- 2. Substitutions.
  const subRows = await db
    .select({
      id: substitutions.id,
      participantId: substitutions.participantId,
      participantName: participants.displayName,
      window: substitutions.window,
      costPoints: substitutions.costPoints,
      droppedPickId: substitutions.droppedPickId,
      newPickId: substitutions.newPickId,
      createdAt: substitutions.createdAt,
    })
    .from(substitutions)
    .innerJoin(participants, eq(participants.id, substitutions.participantId))
    .where(eq(substitutions.gameId, input.gameId))
    .orderBy(desc(substitutions.createdAt))
    .limit(limit);

  // Hydrate dropped+new golfer names. Small N, parallel.
  const subItems: FeedItem[] = await Promise.all(
    subRows.map(async (s) => {
      const [dropped, fresh] = await Promise.all([
        db
          .select({ name: golfersTable.name })
          .from(picks)
          .innerJoin(golfersTable, eq(golfersTable.id, picks.golferId))
          .where(eq(picks.id, s.droppedPickId))
          .limit(1),
        db
          .select({ name: golfersTable.name })
          .from(picks)
          .innerJoin(golfersTable, eq(golfersTable.id, picks.golferId))
          .where(eq(picks.id, s.newPickId))
          .limit(1),
      ]);
      const isViewer = s.participantId === input.viewerParticipantId;
      const { emoji, message, tone } = messageForSubstitution({
        participantName: s.participantName,
        droppedGolferName: dropped[0]?.name ?? '?',
        newGolferName: fresh[0]?.name ?? '?',
        window: s.window,
        costPoints: s.costPoints,
        isViewer,
      });
      return {
        id: `sub:${s.id}`,
        timestamp: s.createdAt,
        category: 'substitution',
        relevance: isViewer ? 'yours' : 'rival',
        emoji,
        message,
        tone,
      };
    }),
  );

  // --- 3. Rule-change proposals (one item per status transition).
  const ruleRows = await db
    .select()
    .from(ruleChangeProposals)
    .where(eq(ruleChangeProposals.gameId, input.gameId));
  const [game] = await db
    .select({ createdByUserId: games.createdByUserId })
    .from(games)
    .where(eq(games.id, input.gameId))
    .limit(1);
  const ruleItems: FeedItem[] = [];
  for (const r of ruleRows) {
    const isProposerViewer =
      input.viewerParticipantId !== null &&
      r.proposedByUserId === game?.createdByUserId;
    // For now just keep the diff brief — first changed field's label only,
    // or "N changes" if multiple.
    const before = r.beforeRules as Record<string, unknown>;
    const after = r.afterRules as Record<string, unknown>;
    const changed = Object.keys(before).filter(
      (k) =>
        JSON.stringify(before[k]) !== JSON.stringify(after[k]),
    );
    const summary =
      changed.length === 0
        ? '(no fields changed)'
        : changed.length === 1
          ? `${changed[0]} edited`
          : `${changed.length} fields edited`;

    if (r.status === 'pending') {
      const { emoji, message, tone } = messageForRuleChange({
        proposerName: 'The creator',
        status: 'pending',
        summary,
        isViewer: isProposerViewer,
      });
      ruleItems.push({
        id: `rule:${r.id}:pending`,
        timestamp: r.proposedAt,
        category: 'rule_change',
        relevance: 'pool',
        emoji,
        message,
        tone,
      });
    } else if (r.resolvedAt) {
      // also include the proposal time so the timeline shows two beats.
      const { emoji: pEmoji, message: pMessage } = messageForRuleChange({
        proposerName: 'The creator',
        status: 'pending',
        summary,
        isViewer: isProposerViewer,
      });
      ruleItems.push({
        id: `rule:${r.id}:proposed`,
        timestamp: r.proposedAt,
        category: 'rule_change',
        relevance: 'pool',
        emoji: pEmoji,
        message: pMessage,
        tone: 'neutral',
      });
      const { emoji, message } = messageForRuleChange({
        proposerName: 'The creator',
        status: r.status,
        summary,
        isViewer: isProposerViewer,
      });
      ruleItems.push({
        id: `rule:${r.id}:${r.status}`,
        timestamp: r.resolvedAt,
        category: 'rule_change',
        relevance: 'pool',
        emoji,
        message,
        tone: 'neutral',
      });
    }
  }

  // --- 4. Emergency swap proposals.
  const swapRows = await db
    .select({
      id: emergencySwapProposals.id,
      participantId: emergencySwapProposals.participantId,
      participantName: participants.displayName,
      droppedPickId: emergencySwapProposals.droppedPickId,
      newGolferId: emergencySwapProposals.newGolferId,
      status: emergencySwapProposals.status,
      proposedAt: emergencySwapProposals.proposedAt,
      resolvedAt: emergencySwapProposals.resolvedAt,
    })
    .from(emergencySwapProposals)
    .innerJoin(
      participants,
      eq(participants.id, emergencySwapProposals.participantId),
    )
    .where(eq(emergencySwapProposals.gameId, input.gameId));

  const swapItems: FeedItem[] = [];
  for (const s of swapRows) {
    const isViewer = s.participantId === input.viewerParticipantId;
    const [dropped, fresh] = await Promise.all([
      db
        .select({ name: golfersTable.name })
        .from(picks)
        .innerJoin(golfersTable, eq(golfersTable.id, picks.golferId))
        .where(eq(picks.id, s.droppedPickId))
        .limit(1),
      db
        .select({ name: golfersTable.name })
        .from(golfersTable)
        .where(
          and(
            eq(golfersTable.id, s.newGolferId),
            eq(golfersTable.gameId, input.gameId),
          ),
        )
        .limit(1),
    ]);
    if (s.status === 'pending') {
      const { emoji, message } = messageForEmergencySwap({
        participantName: s.participantName,
        droppedGolferName: dropped[0]?.name ?? '?',
        newGolferName: fresh[0]?.name ?? '?',
        status: 'pending',
        isViewer,
      });
      swapItems.push({
        id: `swap:${s.id}:pending`,
        timestamp: s.proposedAt,
        category: 'emergency_swap',
        relevance: isViewer ? 'yours' : 'rival',
        emoji,
        message,
        tone: 'neutral',
      });
    } else if (s.resolvedAt) {
      // proposal beat
      const { emoji: pEmoji, message: pMessage } = messageForEmergencySwap({
        participantName: s.participantName,
        droppedGolferName: dropped[0]?.name ?? '?',
        newGolferName: fresh[0]?.name ?? '?',
        status: 'pending',
        isViewer,
      });
      swapItems.push({
        id: `swap:${s.id}:proposed`,
        timestamp: s.proposedAt,
        category: 'emergency_swap',
        relevance: isViewer ? 'yours' : 'rival',
        emoji: pEmoji,
        message: pMessage,
        tone: 'neutral',
      });
      // resolution beat
      const { emoji, message } = messageForEmergencySwap({
        participantName: s.participantName,
        droppedGolferName: dropped[0]?.name ?? '?',
        newGolferName: fresh[0]?.name ?? '?',
        status: s.status,
        isViewer,
      });
      swapItems.push({
        id: `swap:${s.id}:${s.status}`,
        timestamp: s.resolvedAt,
        category: 'emergency_swap',
        relevance: isViewer ? 'yours' : 'rival',
        emoji,
        message,
        tone: 'neutral',
      });
    }
  }

  // --- 5. Merge + sort + cap.
  const merged = [...eventItems, ...subItems, ...ruleItems, ...swapItems];
  merged.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return merged.slice(0, limit);
}

/**
 * Per-participant substitution history for display under their leaderboard
 * row. Lets you see WHY a participant was at -14 before they swapped a
 * star golfer out.
 */
export type SubstitutionHistoryItem = {
  id: number;
  window: SubstitutionWindow;
  droppedGolferName: string;
  newGolferName: string;
  costPoints: number;
};

/** day_1 first, then day_2. */
function windowOrder(w: SubstitutionWindow): number {
  return w === 'day_1' ? 0 : 1;
}

export async function getSubstitutionHistoryByParticipant(
  gameId: number,
): Promise<Map<number, SubstitutionHistoryItem[]>> {
  const rows = await db
    .select({
      id: substitutions.id,
      participantId: substitutions.participantId,
      window: substitutions.window,
      costPoints: substitutions.costPoints,
      droppedPickId: substitutions.droppedPickId,
      newPickId: substitutions.newPickId,
    })
    .from(substitutions)
    .where(eq(substitutions.gameId, gameId));
  if (rows.length === 0) return new Map();

  const hydrated = await Promise.all(
    rows.map(async (r) => {
      const [dropped, fresh] = await Promise.all([
        db
          .select({ name: golfersTable.name })
          .from(picks)
          .innerJoin(golfersTable, eq(golfersTable.id, picks.golferId))
          .where(eq(picks.id, r.droppedPickId))
          .limit(1),
        db
          .select({ name: golfersTable.name })
          .from(picks)
          .innerJoin(golfersTable, eq(golfersTable.id, picks.golferId))
          .where(eq(picks.id, r.newPickId))
          .limit(1),
      ]);
      return {
        participantId: r.participantId,
        item: {
          id: r.id,
          window: r.window,
          droppedGolferName: dropped[0]?.name ?? '?',
          newGolferName: fresh[0]?.name ?? '?',
          costPoints: r.costPoints,
        },
      };
    }),
  );

  const out = new Map<number, SubstitutionHistoryItem[]>();
  for (const h of hydrated) {
    const arr = out.get(h.participantId) ?? [];
    arr.push(h.item);
    out.set(h.participantId, arr);
  }
  // Order each participant's subs day_1 first, then day_2.
  for (const arr of out.values()) {
    arr.sort((a, b) => windowOrder(a.window) - windowOrder(b.window));
  }
  return out;
}
