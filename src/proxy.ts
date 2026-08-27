import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/auth', '/setup'];

/**
 * A cheap redirect gate — deliberately with no network call.
 *
 * This used to run supabase.auth.getUser(), which hits the Supabase auth server
 * on *every* request, including the RSC fetch behind each tab change. Together
 * with the same call in the app layout, that was the bulk of the delay when
 * switching tabs.
 *
 * Looking for the session cookie is enough to decide where to send someone. It
 * is not an authorisation check and does not need to be: the app shell validates
 * the session, and row-level security means a forged cookie reads nothing.
 */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name) && c.value.length > 0);
}

export default function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const path = request.nextUrl.pathname;

  // Not configured yet — send everything to the setup page so the app explains
  // itself instead of throwing.
  if (!url || !key) {
    if (path !== '/setup') return NextResponse.redirect(new URL('/setup', request.url));
    return NextResponse.next();
  }

  const signedIn = hasSessionCookie(request);
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!signedIn && !isPublic) {
    const target = new URL('/login', request.url);
    if (path !== '/') target.searchParams.set('next', path);
    return NextResponse.redirect(target);
  }

  if (signedIn && path.startsWith('/login')) {
    return NextResponse.redirect(new URL('/add', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
