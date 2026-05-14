import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { golfers as golfersTable, participants, picks } from '@/db/schema';
import { getGameByCode } from '@/lib/games';
import { getParticipantForGame } from '@/lib/auth';
import { nextSlot } from '@/lib/draft';
import { PickForm } from './pick-form';
import { SnakeDraftBoard } from './snake-draft-board';

export const dynamic = 'force-dynamic';

export default async function PickPage(props: PageProps<'/games/[code]/pick'>) {
  const { code } = await props.params;
  const game = await getGameByCode(code);
  if (!game) notFound();

  const { userId } = await auth();
  if (!userId) {
    redirect(`/games/${game.code}/join`);
  }

  // --- Free mode (current default) ---
  if (game.draftMode === 'free') {
    const me = await getParticipantForGame(game.id);
    if (!me) redirect(`/games/${game.code}/join`);
    if (me.picksLocked === 1) redirect(`/games/${game.code}`);
    return FreePickPage({ game, me });
  }

  // --- Snake mode ---
  // For Open+Snake: the caller must already be a participant.
  // For Manual+Snake: the caller must be the game creator (they pick for everyone).
  const isCreator = game.createdByUserId === userId;
  const me = await getParticipantForGame(game.id);
  if (!me && !isCreator) {
    redirect(`/games/${game.code}/join`);
  }

  // Roster + draft state.
  const allParts = await db
    .select({
      id: participants.id,
      displayName: participants.displayName,
      userId: participants.userId,
      pickOrder: participants.pickOrder,
      picksLocked: participants.picksLocked,
    })
    .from(participants)
    .where(eq(participants.gameId, game.id))
    .orderBy(asc(participants.pickOrder), asc(participants.id));

  const allPicks = await db
    .select({
      id: picks.id,
      participantId: picks.participantId,
      golferId: picks.golferId,
      name: golfersTable.name,
      country: golfersTable.country,
      position: golfersTable.position,
      scoreToPar: golfersTable.scoreToPar,
    })
    .from(picks)
    .innerJoin(participants, eq(picks.participantId, participants.id))
    .innerJoin(golfersTable, eq(picks.golferId, golfersTable.id))
    .where(eq(participants.gameId, game.id));

  // Field — every golfer is rendered. Picked golfers are shown disabled with
  // a "Picked by X" tag so the next drafter knows who's already taken instead
  // of wondering why their search came up empty.
  const fieldRows = await db
    .select({
      id: golfersTable.id,
      name: golfersTable.name,
      country: golfersTable.country,
      position: golfersTable.position,
      scoreToPar: golfersTable.scoreToPar,
      missedCut: golfersTable.missedCut,
    })
    .from(golfersTable)
    .where(eq(golfersTable.gameId, game.id));
  const pickedByName = new Map<number, string>();
  for (const p of allPicks) {
    const picker = allParts.find((pp) => pp.id === p.participantId);
    if (picker) pickedByName.set(p.golferId, picker.displayName);
  }
  // For late-start pools (start_round > 2 — i.e. starting after the cut),
  // cut golfers aren't playing anymore, so they shouldn't be pickable.
  const filteredField =
    game.startRound > 2
      ? fieldRows.filter((g) => g.missedCut === 0)
      : fieldRows;
  const annotatedField = filteredField
    .map((g) => ({
      id: g.id,
      name: g.name,
      country: g.country,
      position: g.position,
      scoreToPar: g.scoreToPar,
      pickedBy: pickedByName.get(g.id) ?? null,
    }))
    .sort((a, b) => {
      const ap = a.scoreToPar ?? 999;
      const bp = b.scoreToPar ?? 999;
      if (ap !== bp) return ap - bp;
      return a.name.localeCompare(b.name);
    });

  const draftStarted = game.draftStartedAt !== null && game.maxPlayers !== null;
  if (!draftStarted) {
    return (
      <Shell game={game}>
        <RosterWaiting
          game={game}
          allParts={allParts.map((p) => ({
            id: p.id,
            displayName: p.displayName,
            isYou: me?.id === p.id,
          }))}
        />
      </Shell>
    );
  }

  // Compute whose turn it is.
  const k = game.scoringRules.picks_per_user;
  const n = game.maxPlayers as number;
  const slot = nextSlot(allPicks.length, n, k);
  if (slot === null) {
    // Draft is done; send everyone home.
    redirect(`/games/${game.code}`);
  }
  const currentPicker = allParts.find((p) => p.pickOrder === slot) ?? null;
  const round = Math.floor(allPicks.length / n) + 1;

  // Can the caller pick right now?
  // - Manual rosters: only the creator picks (for whoever's slot is up).
  // - Open rosters: the picker is the participant whose pick_order matches.
  const callerCanPick =
    game.rosterMode === 'manual'
      ? isCreator
      : me?.id === currentPicker?.id;

  // Build the picks-by-participant breakdown for the board.
  const picksByParticipant = new Map<
    number,
    Array<{
      golferId: number;
      name: string;
      position: string | null;
      scoreToPar: number | null;
    }>
  >();
  for (const p of allPicks) {
    const arr = picksByParticipant.get(p.participantId) ?? [];
    arr.push({
      golferId: p.golferId,
      name: p.name,
      position: p.position,
      scoreToPar: p.scoreToPar,
    });
    picksByParticipant.set(p.participantId, arr);
  }

  return (
    <Shell game={game}>
      <SnakeDraftBoard
        gameCode={game.code}
        round={round}
        totalRounds={k}
        currentPickerId={currentPicker?.id ?? null}
        callerCanPick={callerCanPick}
        actingAsCreator={isCreator && currentPicker?.userId === null}
        participants={allParts.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          isYou: me?.id === p.id,
          isManual: p.userId === null,
          picks: picksByParticipant.get(p.id) ?? [],
        }))}
        field={annotatedField}
        picksPerUser={k}
      />
    </Shell>
  );
}

function Shell({
  game,
  children,
}: {
  game: { tournamentName: string; name: string };
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-cream dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fairway-deep dark:text-fairway-light">
          {game.tournamentName}
        </p>
        <h1 className="mt-1 font-display text-4xl font-black tracking-tight">
          {game.name}
        </h1>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

function RosterWaiting({
  game,
  allParts,
}: {
  game: { code: string; maxPlayers: number | null };
  allParts: Array<{ id: number; displayName: string; isYou: boolean }>;
}) {
  const remaining = (game.maxPlayers ?? 0) - allParts.length;
  return (
    <div className="rounded-2xl border border-fairway-deep/15 bg-white p-6 shadow-sm dark:border-fairway-light/20 dark:bg-zinc-900">
      <h2 className="font-display text-2xl font-bold">Snake draft</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Waiting for {remaining} more player{remaining === 1 ? '' : 's'} — draft
        starts as soon as the roster is full and the pick order is drawn at
        random.
      </p>
      <p className="mt-3 text-xs text-zinc-500">
        Share the code{' '}
        <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono font-semibold tracking-[0.2em] dark:bg-zinc-800">
          {game.code}
        </span>
      </p>
      <ul className="mt-4 space-y-1.5">
        {allParts.map((p, i) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <span className="w-5 text-right font-mono text-xs text-zinc-500">
              {i + 1}.
            </span>
            <span className="font-medium">{p.displayName}</span>
            {p.isYou ? (
              <span className="rounded-full bg-fairway-light px-2 py-0.5 text-[10px] font-semibold text-fairway-deep dark:bg-fairway-deep dark:text-fairway-light">
                You
              </span>
            ) : null}
          </li>
        ))}
        {Array.from({ length: Math.max(0, remaining) }).map((_, i) => (
          <li
            key={`empty-${i}`}
            className="flex items-center gap-2 text-sm text-zinc-400"
          >
            <span className="w-5 text-right font-mono text-xs">
              {allParts.length + i + 1}.
            </span>
            <span>Waiting…</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FreePickPage({
  game,
  me,
}: {
  game: {
    id: number;
    code: string;
    tournamentName: string;
    name: string;
    scoringRules: { picks_per_user: number };
    startRound: number;
  };
  me: { displayName: string };
}) {
  return <FreePickAsync game={game} me={me} />;
}

async function FreePickAsync({
  game,
  me,
}: {
  game: {
    id: number;
    code: string;
    tournamentName: string;
    name: string;
    scoringRules: { picks_per_user: number };
    startRound: number;
  };
  me: { displayName: string };
}) {
  const field = await db
    .select({
      id: golfersTable.id,
      name: golfersTable.name,
      country: golfersTable.country,
      position: golfersTable.position,
      scoreToPar: golfersTable.scoreToPar,
      missedCut: golfersTable.missedCut,
    })
    .from(golfersTable)
    .where(eq(golfersTable.gameId, game.id));
  const filtered =
    game.startRound > 2 ? field.filter((g) => g.missedCut === 0) : field;
  const sorted = [...filtered].sort((a, b) => {
    const ap = a.scoreToPar ?? 999;
    const bp = b.scoreToPar ?? 999;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });
  return (
    <main className="min-h-screen bg-cream dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fairway-deep dark:text-fairway-light">
          {game.tournamentName}
        </p>
        <h1 className="mt-1 font-display text-4xl font-black tracking-tight">
          Pick {game.scoringRules.picks_per_user} golfers
        </h1>
        <p className="mt-2 mb-8 text-sm text-zinc-600 dark:text-zinc-400">
          Hi <span className="font-semibold">{me.displayName}</span> — once
          you submit, your picks are locked for the rest of the tournament.
        </p>
        {sorted.length === 0 ? (
          <FieldPublishesSoon code={game.code} />
        ) : (
          <PickForm
            gameCode={game.code}
            picksRequired={game.scoringRules.picks_per_user}
            field={sorted}
          />
        )}
      </div>
    </main>
  );
}

function FieldPublishesSoon({ code }: { code: string }) {
  return (
    <div className="rounded-2xl border border-fairway-deep/15 bg-white p-8 text-center shadow-sm dark:border-fairway-light/20 dark:bg-zinc-900">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-fairway-light text-2xl dark:bg-fairway-deep/40">
        ⛳
      </div>
      <h2 className="font-display text-2xl font-bold">Field publishes soon</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        ESPN hasn&apos;t posted the tee sheet for this tournament yet — that
        usually happens a day or two before the first round. Come back to this
        page once the field drops to lock in your picks. Your spot is saved.
      </p>
      <Link
        href={`/games/${code}`}
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-fairway px-5 font-semibold text-white shadow-sm transition hover:bg-fairway-deep"
      >
        Back to pool →
      </Link>
    </div>
  );
}
