// ─────────────────────────────────────────────────────────────────────────
// passcodeCrypto — pure WebCrypto helpers for the SINGLE admin passcode.
//
// The passcode is the one credential that opens the admin console, on any
// device. It is NEVER stored in plaintext — not in D1, not on any device.
// What is stored (backend + each signed-in device, for offline sign-in) is:
//
//   { salt: 16 random bytes (hex), hash: PBKDF2-SHA256 digest (hex),
//     iterations: 12000, version }
//
// Shared by the Cloudflare Worker (authoritative verification) and the
// admin client (offline verification against the synced credential).
// Must stay DOM-free / storage-free.
// ─────────────────────────────────────────────────────────────────────────

/**
 * PBKDF2-SHA256 iteration count for the admin passcode.
 *
 * Deliberately 12,000 (not the OWASP "desktop" 600k): the authoritative
 * verification runs INSIDE the Cloudflare Worker, and the Workers Free
 * plan allows only ~10 ms of CPU time per request — a measured 210k
 * iterations took ~40 ms and blew the budget (setup/login returned 500
 * "Script CPU timer exceeded"). 12,000 measures ~2–3 ms, leaving ample
 * headroom for cold isolates.
 *
 * Protection model at this budget:
 *  - ONLINE attacks: every guess is a full HTTP request to a single
 *    endpoint gated by the operator token (setup) — network latency is
 *    the real limiter; 12k iterations is far beyond what any online
 *    brute force can chew through.
 *  - OFFLINE attacks (stolen device storage): mitigated by the 16-byte
 *    random salt and the ≥8-character passcode policy (see
 *    MIN_PASSCODE_LENGTH).
 *
 * If the Worker moves to the Paid plan (30 s CPU per request), raise
 * this back up (e.g. 210_000) — each stored credential records its own
 * iteration count, so verification always uses the value from the row.
 */
export const PBKDF2_ITERATIONS = 12_000;
export const SALT_BYTE_LENGTH = 16;
export const MIN_PASSCODE_LENGTH = 8;
export const MAX_PASSCODE_LENGTH = 128;

/** The passcode credential parameters (safe to store; never the plaintext). */
export interface AdminCredentialParams {
  salt: string; // hex
  hash: string; // hex (PBKDF2-SHA256, 256 bits)
  iterations: number;
  version: number;
}

export function randomSaltHex(): string {
  const bytes = new Uint8Array(SALT_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

/** Derive the passcode digest: PBKDF2-SHA256(256 bits) → hex. */
export async function derivePasscodeHash(
  passcode: string,
  saltHex: string,
  iterations: number
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(passcode),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(saltHex) as BufferSource,
      iterations,
    },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

/** Constant-time comparison of two hex digests. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Create fresh credential parameters for a passcode. */
export async function createCredential(
  passcode: string,
  version = 1
): Promise<AdminCredentialParams> {
  const salt = randomSaltHex();
  const hash = await derivePasscodeHash(passcode, salt, PBKDF2_ITERATIONS);
  return { salt, hash, iterations: PBKDF2_ITERATIONS, version };
}

/** Verify a passcode against stored credential parameters. */
export async function verifyPasscode(
  passcode: string,
  cred: AdminCredentialParams
): Promise<boolean> {
  if (!cred || !cred.salt || !cred.hash) return false;
  const hash = await derivePasscodeHash(passcode, cred.salt, cred.iterations);
  return timingSafeEqualHex(hash, cred.hash);
}

/** Basic passcode policy check (shared by client UI and server). */
export function passcodePolicy(passcode: string): string | null {
  if (typeof passcode !== 'string') return 'Passcode is required.';
  if (passcode.length < MIN_PASSCODE_LENGTH) {
    return `Passcode must be at least ${MIN_PASSCODE_LENGTH} characters.`;
  }
  if (passcode.length > MAX_PASSCODE_LENGTH) {
    return `Passcode must be at most ${MAX_PASSCODE_LENGTH} characters.`;
  }
  return null;
}
