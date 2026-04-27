import { NextResponse, type NextRequest } from 'next/server'

// Protected routes that require a logged-in session.
// Auth is stored in localStorage (client-only), so full server-side
// auth isn't possible here without a cookie-based session. Instead we
// redirect unauthenticated requests at the edge using a lightweight
// cookie that the login page sets.
const PUBLIC_PATHS = ['/login', '/activate']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public paths through
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Check for the auth cookie set by the login page
  const isAuthed = request.cookies.has('rs_authed')

  if (!isAuthed) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

// Only run on actual page routes — skip all static assets, API routes,
// _next internals. This stops Next.js from invoking the middleware
// function for every .js/.css/.png file the browser requests.
export const config = {
  matcher: [
    '/(dashboard|incidents|responders|analytics|advisories|feedback|activity|settings|login|map)(.*)',
  ],
}
