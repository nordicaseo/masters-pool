import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
});

export const metadata: Metadata = {
  title: "Masters Pool — Pick three. Win beers.",
  description:
    "A tiny fantasy golf pool for closed friend groups. Pick 3 golfers, score birdies and eagles, owe a beer per cut.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { userId } = await auth();
  const signedIn = Boolean(userId);
  return (
    <ClerkProvider afterSignOutUrl="/">
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          <TopBar signedIn={signedIn} />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

function TopBar({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="border-b border-fairway-deep/10 bg-white/70 backdrop-blur dark:border-fairway-light/15 dark:bg-zinc-950/70">
      <div className="mx-auto flex h-12 max-w-5xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-display text-base font-bold tracking-tight text-fairway-deep dark:text-fairway-light"
        >
          Masters Pool
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link
            href="/games"
            className="text-zinc-600 transition hover:text-fairway dark:text-zinc-300"
          >
            Browse pools
          </Link>
          {signedIn ? (
            <UserButton />
          ) : (
            <>
              <SignInButton mode="modal">
                <button className="rounded-full px-3 py-1.5 font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900">
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="rounded-full bg-fairway px-3 py-1.5 font-semibold text-white transition hover:bg-fairway-deep">
                  Sign up
                </button>
              </SignUpButton>
            </>
          )}
        </nav>
      </div>
    </div>
  );
}
