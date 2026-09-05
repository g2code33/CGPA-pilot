// Cloudflare Pages Function — serves the PWA app icon from the PAGES origin.
//
// Proxies /app-icon from the configuration Worker (the admin-set logo from
// the published catalog). The Worker cache-busts the icon URL with a hash of
// the logo bytes (?v=…), so browsers re-download it whenever the admin
// changes the logo. If the Worker is unreachable, the bundled default icon
// is served instead.
const API = 'https://cgpa-pilot.calcitoninpay.workers.dev';

export const onRequest = async (ctx) => {
  try {
    const res = await fetch(`${API}/app-icon`);
    if (res.ok) {
      return new Response(res.body, {
        status: 200,
        headers: {
          'content-type': res.headers.get('content-type') ?? 'image/png',
          'cache-control': res.headers.get('cache-control') ?? 'public, max-age=31536000, immutable',
        },
      });
    }
  } catch {
    /* Worker unreachable — fall through to the bundled default below. */
  }
  return Response.redirect(new URL('icon-512.png', ctx.request.url).href, 302);
};
