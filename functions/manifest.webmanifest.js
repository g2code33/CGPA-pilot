// Cloudflare Pages Function — serves the PWA manifest from the PAGES origin
// (a web manifest must be same-origin as the site, so the static manifest in
// public/ can never reflect the admin's branding).
//
// This proxies the DYNAMIC manifest from the configuration Worker, which
// builds it from the published catalog (admin app name + the admin's current
// app logo). If the Worker is unreachable it falls back to the static
// bundled manifest, so the PWA always has a valid manifest.
const API = 'https://cgpa-pilot.calcitoninpay.workers.dev';

export const onRequest = async (ctx) => {
  try {
    const res = await fetch(`${API}/manifest.webmanifest`);
    if (res.ok) {
      return new Response(await res.arrayBuffer(), {
        status: 200,
        headers: {
          'content-type': 'application/manifest+json; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }
  } catch {
    /* Worker unreachable — fall through to the static default below. */
  }
  return ctx.next(); // public/manifest.webmanifest (bundled defaults)
};
