import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGameByCode } from '@/lib/games';
import { golferTotals, participantTotals } from '@/lib/scoring';
import { getParticipantId } from '@/lib/auth';
import { db } from '@/db';
import { participants } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function GamePage(props: PageProps<'/games/[code]'>) {
  const { code } = await props.params;
  const game = await getGameByCode(code);
  if (!game) notFound();

  const [users, golfers, currentParticipantId] = await Promise.all([
    participantTotals(game.id),
    golferTotals(game.id),
    getParticipantId(),
  ]);

  // Has the current visitor joined this game (and locked picks)?
  let needsToPick = false;
  if (currentParticipantId) {
    const [me] = await db
      .select()
      .from(participants)
      .where(and(eq(participants.id, currentParticipantId), eq(participants.gameId, game.id)))
      .limit(1);
    if (me && me.picksLocked === 0) needsToPick = true;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-zinc-900 dark:text-zinc-100">
      <header className="mb-8 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
          {game.tournamentName}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">{game.name}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          <span>
            Join code: <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{game.code}</span>
          </span>
          <span>•</span>
          <span>Status: {game.status}</span>
          {needsToPick ? (
            <Link
              href={`/games/${game.code}/pick`}
              className="ml-auto rounded-md bg-emerald-600 px-3 py-1 font-medium text-white"
            >
              Pick your golfers
            </Link>
          ) : null}
        </div>
      </header>

      <section className="mb-12">
        <h2 className="mb-3 text-xl font-semibold">Pool leaderboard</h2>
        {users.length === 0 ? (
          <p className="text-sm text-zinc-500">No one has joined yet. Share the join code above.</p>
        ) : (
          <ol className="space-y-2">
            {users.map((u, i) => (
              <li
                key={u.participantId}
                className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 text-right font-mono text-zinc-500">{i + 1}.</span>
                  <span className="flex-1 font-medium">{u.displayName}</span>
                  <span className="font-mono font-semibold tabular-nums">{u.points}</span>
                </div>
                {u.picks.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2 pl-9 text-xs text-zinc-600 dark:text-zinc-400">
                    {u.picks.map((p) => (
                      <span key={p.golferId} className="rounded bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
                        {p.name}
                        {p.position ? ` (${p.position})` : ''}
                        <span className="ml-1 font-mono">{p.points >= 0 ? `+${p.points}` : p.points}</span>
                        {p.missedCut ? <span className="ml-1" title="Missed cut — owes a beer">🍺</span> : null}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Field leaderboard</h2>
        <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2">Pos</th>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2 text-right">To par</th>
                <th className="px-3 py-2 text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {golfers.map((g) => (
                <tr key={g.golferId} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-1.5 font-mono text-zinc-500">{g.position ?? '-'}</td>
                  <td className="px-3 py-1.5">
                    {g.name}
                    {g.missedCut ? <span className="ml-1">🍺</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {g.scoreToPar === null ? '-' : g.scoreToPar === 0 ? 'E' : g.scoreToPar > 0 ? `+${g.scoreToPar}` : g.scoreToPar}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">{g.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
