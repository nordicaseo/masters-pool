import Link from 'next/link';
import { fetchSeasonSchedule, type ScheduledTournament } from '@/lib/espn';
import { logError } from '@/lib/log';
import { CreateGameForm } from './create-game-form';

export const dynamic = 'force-dynamic';

export default async function NewGamePage() {
  const year = new Date().getUTCFullYear();
  const tournaments = await fetchSeasonSchedule(year).catch((err) => {
    logError(err, {
      subsystem: 'espn',
      operation: 'fetch_season_schedule',
      extra: { year },
    });
    return [] as ScheduledTournament[];
  });

  // Upcoming + live first, sorted by start date ascending.
  // Past (post) below as a "test" section, sorted by start date descending
  // so the most-recently-finished tournament is at the top.
  const upcoming = tournaments
    .filter((t) => t.state !== 'post')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = tournaments
    .filter((t) => t.state === 'post')
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  return (
    <main className="fairway-bg min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-600 transition hover:text-fairway dark:text-zinc-400"
        >
          ← Back
        </Link>
        <header className="mb-8 space-y-2">
          <h1 className="font-display text-4xl font-black tracking-tight">
            Start a new pool
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Pick the tournament, set the rules, share the code with your group.
          </p>
        </header>
        <CreateGameForm upcoming={upcoming} past={past} />
      </div>
    </main>
  );
}
