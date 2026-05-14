'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RuleDiffEntry } from '@/lib/rule-changes';

type Voter = {
  participantId: number;
  displayName: string;
  /** null = hasn't voted yet. */
  vote: 'approve' | 'reject' | null;
};

export function RuleProposalBanner({
  gameCode,
  proposalId,
  proposerDisplayName,
  isProposer,
  callerCanVote,
  callerHasVoted,
  voters,
  diff,
  approveCount,
  eligibleCount,
}: {
  gameCode: string;
  proposalId: number;
  proposerDisplayName: string;
  isProposer: boolean;
  /** True when the signed-in user is an eligible voter and hasn't voted yet. */
  callerCanVote: boolean;
  callerHasVoted: boolean;
  voters: Voter[];
  diff: RuleDiffEntry[];
  approveCount: number;
  eligibleCount: number;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitVote(vote: 'approve' | 'reject') {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/games/${gameCode}/rule-proposals/${proposalId}/votes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ vote }),
        },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'failed to vote');
        setSubmitting(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to vote');
      setSubmitting(false);
    }
  }

  async function cancelProposal() {
    if (!confirm('Cancel your rule-change proposal?')) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/games/${gameCode}/rule-proposals/${proposalId}/cancel`,
        { method: 'POST' },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'failed to cancel');
        setSubmitting(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to cancel');
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-8 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 shadow-sm dark:border-amber-600 dark:bg-amber-950/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-amber-700 dark:text-amber-300">
            Rule change proposed
          </p>
          <p className="mt-1 text-sm">
            <span className="font-semibold">{proposerDisplayName}</span> wants
            to change the scoring rules. Every signed-in participant must
            approve before it takes effect — once approved, every existing
            event is recomputed retroactively.
          </p>
        </div>
        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-900 dark:bg-amber-800 dark:text-amber-100">
          {approveCount} / {eligibleCount} approved
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {diff.length === 0 ? (
          <p className="col-span-2 text-xs text-zinc-500">
            (No changes detected — this proposal is a no-op.)
          </p>
        ) : (
          diff.map((d) => (
            <div
              key={d.key}
              className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm dark:bg-zinc-900"
            >
              <span className="font-medium">{d.label}</span>
              <span className="font-mono text-xs">
                <span className="text-flag line-through">{d.before}</span>
                <span className="mx-1 text-zinc-400">→</span>
                <span className="font-semibold text-fairway">{d.after}</span>
              </span>
            </div>
          ))
        )}
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          Voters
        </p>
        <div className="flex flex-wrap gap-1.5">
          {voters.map((v) => (
            <span
              key={v.participantId}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                v.vote === 'approve'
                  ? 'bg-fairway-light text-fairway-deep dark:bg-fairway-deep/40 dark:text-fairway-light'
                  : v.vote === 'reject'
                    ? 'bg-flag/10 text-flag'
                    : 'border border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-700'
              }`}
            >
              {v.vote === 'approve' ? '✓' : v.vote === 'reject' ? '✗' : '…'}{' '}
              {v.displayName}
            </span>
          ))}
        </div>
      </div>

      {error ? (
        <p className="mt-2 text-sm font-medium text-flag">{error}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {callerCanVote ? (
          <>
            <button
              type="button"
              onClick={() => submitVote('approve')}
              disabled={submitting}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-fairway px-4 text-sm font-semibold text-white transition hover:bg-fairway-deep disabled:opacity-50"
            >
              ✓ Approve
            </button>
            <button
              type="button"
              onClick={() => submitVote('reject')}
              disabled={submitting}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-flag px-4 text-sm font-semibold text-flag transition hover:bg-flag/10 disabled:opacity-50"
            >
              ✗ Reject
            </button>
          </>
        ) : callerHasVoted ? (
          <span className="text-xs text-zinc-500">
            You&apos;ve voted — waiting on{' '}
            {voters.filter((v) => v.vote === null).length} more.
          </span>
        ) : null}
        {isProposer ? (
          <button
            type="button"
            onClick={cancelProposal}
            disabled={submitting}
            className="ml-auto text-xs font-semibold text-zinc-500 underline transition hover:text-flag disabled:opacity-50"
          >
            Cancel proposal
          </button>
        ) : null}
      </div>
    </div>
  );
}
