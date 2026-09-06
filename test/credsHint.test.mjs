// ─────────────────────────────────────────────────────────────────────────
// credsHint — v1.0.21: when the Storage page's Cloudflare creds probe fails,
// the raw error must map to the exact fix. The two live failures that
// shipped with v1.0.20:
//   • an R2 "Object Read Only" token (S3-API-only) → 7003 "could not route"
//   • a Global API key ("cfk_…") pasted as the Account ID
// Run: npm test
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { credsProbeHint, accountIdLooksValid } from '../src/admin/credsHint.ts';

test('7003 "could not route" → points at the token type (S3-only tokens)', () => {
  const hint = credsProbeHint(
    '7003 Could not route to /client/v4/accounts/abcdef0123456789abcdef0123456789/r2/buckets, perhaps your object identifier is invalid?'
  );
  assert.match(hint, /R2 'Object Read Only'/);
  assert.match(hint, /S3 API/);
  assert.match(hint, /Admin Read/);
  assert.doesNotMatch(hint, /Account ID is the 32-character/);
});

test('a "cfk_…" value in the message → points at the wrong Account ID first', () => {
  const hint = credsProbeHint(
    '7003 Could not route to /client/v4/accounts/cfk_REDACTED-TEST-VALUE/r2/buckets'
  );
  assert.match(hint, /cfk_/);
  assert.match(hint, /Global API key/);
  assert.match(hint, /Account Home page/);
  // The account-id mistake wins over the token hint — fixing the id is step 1.
  assert.doesNotMatch(hint, /Admin Read/);
});

test('unauthorized / authentication error → token hint', () => {
  assert.match(credsProbeHint('10000 Unauthorized'), /Admin Read/);
  assert.match(credsProbeHint('10000 Authentication error'), /S3 API/);
});

test('account not found → Account ID hint', () => {
  assert.match(credsProbeHint('404 The account you were looking for could not be found.'), /32-character hex/);
});

test('unknown failure → generic "check both values" hint (still actionable)', () => {
  const hint = credsProbeHint('fetch failed: network error');
  assert.match(hint, /My Profile → API Tokens/);
  assert.match(hint, /Account Home page/);
});

test('empty detail → generic hint, no crash', () => {
  assert.equal(typeof credsProbeHint(''), 'string');
  assert.ok(credsProbeHint('').length > 20);
});

test('accountIdLooksValid — 32 hex passes (case-insensitive), with/without spaces', () => {
  assert.equal(accountIdLooksValid('0123456789abcdef0123456789abcdef'), true);
  assert.equal(accountIdLooksValid('0123456789ABCDEF0123456789ABCDEF'), true);
  assert.equal(accountIdLooksValid('  0123456789abcdef0123456789abcdef  '), true);
});

test('accountIdLooksValid — rejects cfk_ keys, short/long ids, non-hex', () => {
  assert.equal(accountIdLooksValid('cfk_REDACTED-TEST-VALUE'), false);
  assert.equal(accountIdLooksValid('0123456789abcdef0123456789abcde'), false); // 31
  assert.equal(accountIdLooksValid('0123456789abcdef0123456789abcdef0'), false); // 33
  assert.equal(accountIdLooksValid('zzzz456789abcdef0123456789abcdef'), false); // non-hex
  assert.equal(accountIdLooksValid(''), false);
  assert.equal(accountIdLooksValid('some random account id'), false);
});
