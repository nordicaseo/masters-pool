import { clerkMiddleware } from '@clerk/nextjs/server';

// Bare middleware — we protect individual routes with `auth.protect()` in
// the server component / route handler, so this just wires Clerk into the
// request pipeline and exposes `auth()` everywhere.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes.
    '/(api|trpc)(.*)',
  ],
};
