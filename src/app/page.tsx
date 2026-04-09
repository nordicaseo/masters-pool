import Link from 'next/link';
import { JoinForm } from './_components/join-form';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-12 px-6 py-16 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
          Masters Pool
        </p>
        <h1 className="text-4xl font-bold tracking-tight">Pick three. Win beers.</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          A tiny fantasy pool for your friend group. Pick 3 golfers, score birdies and eagles, owe a beer for every cut.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Join an existing pool</h2>
        <JoinForm />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Or start a new one</h2>
        <Link
          href="/games/new"
          className="inline-flex h-11 items-center justify-center rounded-md bg-emerald-600 px-6 font-medium text-white transition hover:bg-emerald-700"
        >
          Create a game
        </Link>
      </section>

      <footer className="mt-auto text-xs text-zinc-500">
        Live scores via ESPN. No accounts. No emails. Just beer debt.
      </footer>
    </main>
  );
}
