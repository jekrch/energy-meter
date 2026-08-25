import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Content Security Policy for the built site.
//
// What it defends: a Google Drive access token lives in sessionStorage for the
// tab's lifetime, and every script on the page can read it. The analytics
// script is third-party code holding exactly that access, so the policy names
// the handful of origins the app genuinely talks to and blocks the rest —
// including any exfiltration target an injected script would need.
//
// GitHub Pages cannot send response headers, so this ships as a <meta> tag. It
// is injected here rather than written into index.html because the dev server's
// HMR websocket would fall foul of `connect-src`, and a policy carrying ws://
// exceptions to keep `bun run dev` working is weaker than the one users get.
// `bun run preview` serves the built output, so the real policy is testable.
//
// `frame-ancestors` is deliberately absent: it is ignored in a meta policy.
// Clickjacking protection needs real response headers, i.e. a different host.
const CSP = [
  "default-src 'self'",
  // accounts.google.com is origin-wide rather than the /gsi/ path Google
  // documents for CSP: revoking the token on sign-out hits /o/oauth2/revoke,
  // which the narrower form would silently break.
  "script-src 'self' https://accounts.google.com https://analytics.jacobkrch.com",
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com" +
    ' https://archive-api.open-meteo.com https://geocoding-api.open-meteo.com' +
    ' https://analytics.jacobkrch.com',
  // data: covers the serialized chart SVG the PNG export rasterizes;
  // googleusercontent is the signed-in account's profile photo.
  "img-src 'self' data: blob: https://*.googleusercontent.com https://accounts.google.com",
  // 'unsafe-inline' is unavoidable here: React style attributes and Recharts'
  // own inline styles both fall under style-src.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // The GIS token flow opens a popup rather than a frame, but the library
  // still creates iframes of its own. The touch-device sign-in leaves the
  // document entirely (a top-level navigation to accounts.google.com), which
  // no directive here governs — `form-action` covers form submissions only.
  'frame-src https://accounts.google.com',
  // The rankings worker is emitted as a same-origin chunk.
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

// Placed immediately after <meta charset>, which has to stay inside the first
// 1024 bytes for the browser to trust it. Everything the document goes on to
// fetch is declared below this point, which is what a meta policy needs — it
// only governs what follows it. A build that cannot find the charset tag fails
// rather than quietly shipping an ungoverned page.
function cspMeta(): Plugin {
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => {
        const charset = /<meta\s+charset=[^>]*>/i
        if (!charset.test(html)) {
          throw new Error('inject-csp-meta: no <meta charset> to anchor the policy to')
        }
        return html.replace(
          charset,
          (tag) => `${tag}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}">`,
        )
      },
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), cspMeta()],
  base: "/", 
})
