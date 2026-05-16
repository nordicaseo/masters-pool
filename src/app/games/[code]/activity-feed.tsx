import type { FeedItem } from '@/lib/activity-feed';

/**
 * Activity feed shown alongside the leaderboards. Each row is one moment
 * — a per-hole event, a substitution, a rule change, an emergency swap —
 * with a viewer-aware playful copy built in `lib/activity-feed.ts`.
 *
 * Layout-wise this is a sticky sidebar on `lg+` viewports and a stacked
 * section on mobile; the parent page is responsible for the grid.
 */
export function ActivityFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return (
      <aside className="rounded-2xl border border-fairway-deep/15 bg-white/70 p-4 text-sm text-zinc-500 shadow-sm dark:border-fairway-light/20 dark:bg-zinc-900/60">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
          Live feed
        </p>
        <p className="mt-2">
          Nothing&apos;s happened yet. Once the field tees off, every
          birdie and bogey on someone&apos;s pick will land here.
        </p>
      </aside>
    );
  }
  return (
    <aside className="overflow-hidden rounded-2xl border border-fairway-deep/15 bg-white shadow-sm dark:border-fairway-light/20 dark:bg-zinc-900">
      <div className="scorecard-stripe flex items-center justify-between px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white">
        <span>Live feed</span>
        <span className="font-mono">📰</span>
      </div>
      <ul className="max-h-[70vh] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
        {items.map((item) => (
          <li key={item.id} className={rowClass(item)}>
            <div className="flex items-start gap-2.5 px-3 py-2.5">
              <span aria-hidden className="mt-0.5 text-base leading-none">
                {item.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm leading-snug ${messageClass(item)}`}
                >
                  {item.message}
                </p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {timeAgo(item.timestamp)}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function rowClass(item: FeedItem): string {
  if (item.relevance === 'yours') {
    if (item.tone === 'good') return 'bg-fairway-light/30 dark:bg-fairway-deep/20';
    if (item.tone === 'bad') return 'bg-flag/5 dark:bg-flag/10';
    return 'bg-fairway-light/15 dark:bg-fairway-deep/10';
  }
  if (item.relevance === 'rival') {
    if (item.tone === 'good') return 'bg-zinc-50 dark:bg-zinc-800/40';
    if (item.tone === 'bad') return 'bg-zinc-50 dark:bg-zinc-800/40';
  }
  return '';
}

function messageClass(item: FeedItem): string {
  if (item.tone === 'good' && item.relevance === 'yours')
    return 'font-medium text-fairway-deep dark:text-fairway-light';
  if (item.tone === 'bad' && item.relevance === 'yours')
    return 'font-medium text-flag';
  return 'text-zinc-700 dark:text-zinc-200';
}

/**
 * Lightweight relative time: "just now", "12m", "3h", "yesterday", "Wed".
 * Rendered server-side so timezone of the request rules; close enough.
 */
function timeAgo(ts: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return ts.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
