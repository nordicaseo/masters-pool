import { CreateGameForm } from './create-game-form';

export const dynamic = 'force-dynamic';

export default function NewGamePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-zinc-900 dark:text-zinc-100">
      <h1 className="mb-2 text-3xl font-bold">Create a pool</h1>
      <p className="mb-8 text-zinc-600 dark:text-zinc-400">
        Defaults are set for the 2026 Masters. You can tweak the scoring, then share the join code with your group.
      </p>
      <CreateGameForm />
    </main>
  );
}
