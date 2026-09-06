/**
 * v1.0.21 — human guidance for when the Storage page's Cloudflare creds probe fails.
 *
 * The probe returns Cloudflare's raw error detail; this maps the common failures
 * to the exact fix so the user doesn't have to guess which value is wrong:
 *
 *  - R2 "Object Read Only" / "Object Read & Write" tokens (created in the R2
 *    dashboard) are S3-API-only — they CANNOT hit api.cloudflare.com management
 *    routes (error 7003 "could not route"). The account-wide usage view needs a
 *    read-only ACCOUNT token: My Profile → API Tokens → template "Admin Read".
 *  - "cfk_…" values are (new-format) Global API KEYS, not Account IDs — pasting
 *    one into the Account ID field can never work.
 */

const ACCOUNT_ID_HINT =
  "That Account ID looks like a Global API key (starts with 'cfk_') — that's the wrong value. " +
  "The Account ID is the 32-character hex code shown on your Account Home page (top-right of the Cloudflare dashboard).";

const TOKEN_HINT =
  "That token can't reach the Cloudflare API — R2 'Object Read Only' / 'Object Read & Write' tokens " +
  "(created in R2 → Manage R2 API Tokens) only work with the S3 API, not this usage view. " +
  "Make a read-only account token instead: My Profile (avatar) → API Tokens → Create token → " +
  "template 'Read all resources' (a.k.a. 'Admin Read'). It can only read — it can't change anything.";

const ACCOUNT_NOT_FOUND_HINT =
  "Cloudflare couldn't find that Account ID. Use the 32-character hex code from your Account Home " +
  "page (top-right of the dashboard) — not an API token or key.";

/** Map a Cloudflare error detail string to the actionable fix for it. */
export function credsProbeHint(detail: string): string {
  const d = (detail ?? '').toLowerCase();
  // The account id is echoed in the request URL of most errors — catch it first,
  // because a cfk_ id breaks everything regardless of the token.
  if (d.includes('cfk_')) return ACCOUNT_ID_HINT;
  if (
    d.includes('7003') ||
    d.includes('could not route') ||
    d.includes('unauthorized') ||
    d.includes('authentication error')
  ) {
    return TOKEN_HINT;
  }
  if (d.includes('account') && (d.includes('not found') || d.includes('could not be found') || d.includes('404'))) {
    return ACCOUNT_NOT_FOUND_HINT;
  }
  return (
    'Check that both values are exact copies: the token from My Profile → API Tokens, ' +
    'and the 32-character hex Account ID from the Account Home page.'
  );
}

/**
 * A Cloudflare Account ID is a 32-character hex code. Anything else — in
 * particular 'cfk_…' Global API keys — is saved wrong. Used to warn in the
 * form BEFORE the user submits, so the mistake is caught client-side.
 */
export function accountIdLooksValid(id: string): boolean {
  return /^[0-9a-f]{32}$/i.test((id ?? '').trim());
}
