'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Voter = {
  participantId: number;
  displayName: string;
  vote: 'approve' | 'reject' | null;
};

export function EmergencySwapBanner({
  gameCode,
  proposalId,
  participantDisplayName,
  droppedGolferName,
  newGolferName,
  isProposer,
  callerCanVote,
  callerHasVoted,
  voters,
  approveCount,
  eligibleCount,
}: {
  gameCode: string;
  proposalId: number;
  participantDisplayName: string;
  droppedGolferName: string;
  newGolferName: string;
  isProposer: boolean;
  callerCanVote: boolean;
  callerHasVoted: boolean;
  voters: Voter[];
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
        `/api/games/${gameCode}/emergency-swaps/${proposalId}/votes`,
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
    if (!confirm('Cancel your emergency swap request?')) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/games/${gameCode}/emergency-swaps/${proposalId}/cancel`,
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
    <div className="mb-8 rounded-2xl border-2 border-flag bg-flag/5 p-4 shadow-sm dark:border-flag/70 dark:bg-flag/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-flag">
            🚨 Emergency pick swap requested
          </p>
          <p className="mt-1 text-sm">
            <span className="font-semibold">{participantDisplayName}</span>{' '}
            says they meant to pick someone else. Approve only if it&apos;s
            an honest misclick — once approved, the new golfer&apos;s points
            count retroactively.
          </p>
        </div>
        <span className="rounded-full bg-flag/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-flag">
          {approveCount} / {eligibleCount} approved
        </span>
      </div>

      <div className="mt-3 flex items-center justify-center gap-3 rounded-lg bg-white px-3 py-2.5 text-sm dark:bg-zinc-900">
        <span className="font-medium text-flag line-through">
          {droppedGolferName}
        </span>
        <span aria-hidden className="text-xl">
          →
        </span>
        <span className="font-semibold text-fairway-deep dark:text-fairway-light">
          {newGolferName}
        </span>
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
              ✓ Honest mistake — approve
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
            Cancel my request
          </button>
        ) : null}
      </div>
    </div>
  );
}
