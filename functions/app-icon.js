// Cloudflare Pages Function — serves the PWA app icon from the PAGES origin.
//
// Proxies /app-icon from the configuration Worker (the admin-set logo from
// the published catalog, resolved from its `asset:<key>` R2 reference or a
// legacy inline data URL). The Worker cache-busts its own manifest icon URL
// with a hash of the logo bytes (?v=…), but the URL the Pages manifest uses is
// stable ("/app-icon"), so the copy served here must NOT be immutable — the
// Worker says `immutable`, which would freeze an installed PWA's icon on the
// first logo it ever saw. A short TTL plus the service worker's network-first
// identity handling is what makes a branding change reach already-installed
// apps. If the Worker is unreachable, the bundled default icon is served.
const API = 'https://cgpa-pilot.calcitoninpay.workers.dev';
const ICON_TTL_SECONDS = 300;

export const onRequest = async (ctx) => {
  const headers = new Headers({
    'content-type': 'image/png',
    'cache-control': `public, max-age=${ICON_TTL_SECONDS}`,
    // The manifest/SW on the same origin fetch this; keep it open anyway so a
    // custom-origin PWA can still read the icon.
    'access-control-allow-origin': '*',
  });
  try {
    const res = await fetch(`${API}/app-icon`, {
      headers: { 'cache-control': 'no-cache' },
      cf: { cacheTtl: 0 },
    });
    if (res.ok && res.status === 200) {
      const type = res.headers.get('content-type') ?? '';
      // Only bytes that can be an icon are worth passing on: an error page or a
      // JSON body served as 200 would be cached for the TTL and shown broken,
      // which is worse than the bundled default. An asset uploaded without
      // metadata arrives as octet-stream, so that stays valid.
      if (/^image\//i.test(type) || /^application\/octet-stream$/i.test(type)) {
        if (/^image\//i.test(type)) headers.set('content-type', type);
        return new Response(res.body, { status: 200, headers });
      }
    }
  } catch {
    /* Worker unreachable — fall through to the bundled default below. */
  }
  return Response.redirect(new URL('icon-512.png', ctx.request.url).href, 302);
};
