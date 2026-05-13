import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth, currentUser } from '@clerk/nextjs/server';
import { SignInButton } from '@clerk/nextjs';
import { getGameByCode } from '@/lib/games';
import { getParticipantForGame } from '@/lib/auth';
import { JoinNamedForm } from './join-named-form';

export const dynamic = 'force-dynamic';

export default async function JoinPage(props: PageProps<'/games/[code]/join'>) {
  const { code } = await props.params;
  const game = await getGameByCode(code);
  if (!game) notFound();

  const { userId } = await auth();

  // Manual roster pools refuse new joins from outside.
  if (game.rosterMode === 'manual') {
    return (
      <main className="fairway-bg min-h-screen">
        <div className="mx-auto max-w-md px-6 py-16">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fairway-deep dark:text-fairway-light">
            {game.tournamentName}
          </p>
          <h1 className="mt-1 font-display text-4xl font-black tracking-tight">
            {game.name}
          </h1>
          <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            This pool has a manual roster — only the players the creator added
            can play. You can still watch the leaderboard.
          </p>
          <Link
            href={`/games/${game.code}`}
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-fairway px-5 font-semibold text-white shadow-sm transition hover:bg-fairway-deep"
          >
            View pool →
          </Link>
        </div>
      </main>
    );
  }

  if (!userId) {
    return (
      <main className="fairway-bg min-h-screen">
        <div className="mx-auto max-w-md px-6 py-16">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fairway-deep dark:text-fairway-light">
            {game.tournamentName}
          </p>
          <h1 className="mt-1 font-display text-4xl font-black tracking-tight">
            {game.name}
          </h1>
          <p className="mt-2 mb-8 text-sm text-zinc-600 dark:text-zinc-400">
            Sign in to join this pool — your picks are saved to your account
            so they show up on every device.
          </p>
          <SignInButton mode="modal">
            <button className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-fairway px-6 font-semibold text-white shadow-sm transition hover:bg-fairway-deep">
              Sign in to join
            </button>
          </SignInButton>
          <Link
            href={`/games/${game.code}`}
            className="mt-4 block text-center text-sm text-zinc-500 hover:text-fairway"
          >
            Or peek at the leaderboard without joining →
          </Link>
        </div>
      </main>
    );
  }

  // Already in the pool? Send them straight to picks or the game home.
  const existing = await getParticipantForGame(game.id);
  if (existing) {
    redirect(
      existing.picksLocked === 1
        ? `/games/${game.code}`
        : `/games/${game.code}/pick`,
    );
  }

  const u = await currentUser();
  const suggestedName =
    u?.firstName ??
    u?.username ??
    u?.emailAddresses?.[0]?.emailAddress?.split('@')[0] ??
    '';

  return (
    <main className="fairway-bg min-h-screen">
      <div className="mx-auto max-w-md px-6 py-16">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fairway-deep dark:text-fairway-light">
          {game.tournamentName}
        </p>
        <h1 className="mt-1 font-display text-4xl font-black tracking-tight">
          {game.name}
        </h1>
        <p className="mt-2 mb-8 text-sm text-zinc-600 dark:text-zinc-400">
          Pick a display name for this pool, then lock in your 3 picks.
        </p>
        <JoinNamedForm code={game.code} suggestedName={suggestedName} />
      </div>
    </main>
  );
}
