'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

const NOOP_SUBSCRIBE = () => () => {};

/**
 * Invite-sharing control: shows the 6-char join code and gives the user a
 * one-tap way to share the pool. On mobile we surface the native share sheet
 * (`navigator.share`); everywhere else we copy the join URL to the clipboard.
 *
 * The whole friend-group growth loop is "share the code", so this is the
 * primary call-to-action on the game header and the draft-waiting screen.
 */
export function ShareInvite({
  code,
  gameName,
  tone = 'light',
}: {
  code: string;
  gameName?: string;
  /** `dark` = on the green scorecard header; `light` = on white panels. */
  tone?: 'light' | 'dark';
}) {
  const [copied, setCopied] = useState(false);

  // Detect the native share sheet. `useSyncExternalStore` returns the server
  // snapshot (false) during SSR and the real value after hydration, so there's
  // no hydration mismatch and no setState-in-effect.
  const canShare = useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    () => false,
  );

  const buildUrl = useCallback(() => {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://golfer.is';
    return `${origin}/games/${code}/join`;
  }, [code]);

  const copyLink = useCallback(async () => {
    const url = buildUrl();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API blocked (insecure context / permission) — fall back to a
      // manual-copy prompt rather than failing silently.
      window.prompt('Copy this invite link:', url);
    }
  }, [buildUrl]);

  const share = useCallback(async () => {
    const url = buildUrl();
    const text = gameName
      ? `Join my pool "${gameName}" — pick 3 golfers, win beers. Code ${code}.`
      : `Pick 3 golfers in my Masters Pool. Code ${code}.`;
    try {
      await navigator.share({
        title: gameName ? `Join ${gameName}` : 'Join my Masters Pool',
        text,
        url,
      });
    } catch (err) {
      // User dismissing the sheet is not an error; for anything else, copy.
      if (err instanceof Error && err.name === 'AbortError') return;
      await copyLink();
    }
  }, [buildUrl, copyLink, gameName, code]);

  const dark = tone === 'dark';
  const chipClass = dark
    ? 'rounded-md bg-white/10 px-2 py-0.5 font-mono font-semibold tracking-[0.2em] text-white'
    : 'rounded bg-zinc-100 px-2 py-0.5 font-mono font-semibold tracking-[0.2em] dark:bg-zinc-800';
  const btnClass = dark
    ? 'inline-flex h-8 items-center gap-1.5 rounded-full bg-white/15 px-3 text-xs font-semibold text-white transition hover:bg-white/25'
    : 'inline-flex h-8 items-center gap-1.5 rounded-full bg-fairway px-3 text-xs font-semibold text-white transition hover:bg-fairway-deep';
  const labelClass = dark ? 'text-fairway-light/90' : 'text-zinc-500';

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={labelClass}>Join code</span>
      <span className={chipClass}>{code}</span>
      {canShare ? (
        <button type="button" onClick={share} className={btnClass} aria-label="Share invite link">
          <ShareIcon />
          Share
        </button>
      ) : null}
      <button
        type="button"
        onClick={copyLink}
        className={btnClass}
        aria-label="Copy invite link"
      >
        {copied ? (
          <>
            <CheckIcon />
            Copied
          </>
        ) : (
          <>
            <LinkIcon />
            Copy link
          </>
        )}
      </button>
    </span>
  );
}

function LinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" />
    </svg>
  );
}
