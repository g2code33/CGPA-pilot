// ─────────────────────────────────────────────────────────────────────────
// passcodeCrypto — the shared PBKDF2 helpers for the SINGLE admin passcode.
// Pure WebCrypto (DOM-free), so the same code runs in the Worker, the admin
// client, and here under Node 22's global WebCrypto.
// ─────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PBKDF2_ITERATIONS,
  SALT_BYTE_LENGTH,
  MIN_PASSCODE_LENGTH,
  MAX_PASSCODE_LENGTH,
  createCredential,
  verifyPasscode,
  derivePasscodeHash,
  randomSaltHex,
  timingSafeEqualHex,
  passcodePolicy,
} from '../src/admin/passcodeCrypto.ts';

test('createCredential produces a salted PBKDF2-SHA256 digest (never the plaintext)', async () => {
  const cred = await createCredential('s3cret-pass');
  assert.equal(cred.iterations, PBKDF2_ITERATIONS);
  assert.equal(cred.version, 1);
  assert.equal(cred.salt.length, SALT_BYTE_LENGTH * 2); // hex
  assert.equal(cred.hash.length, 64); // 256-bit hex digest
  assert.match(cred.salt, /^[0-9a-f]+$/);
  assert.match(cred.hash, /^[0-9a-f]+$/);
  const json = JSON.stringify(cred);
  assert.ok(!json.includes('s3cret-pass'), 'credential params must not embed the passcode');
});

test('salts are random (two credentials differ even for the same passcode)', async () => {
  const a = await createCredential('same-pass');
  const b = await createCredential('same-pass');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('verifyPasscode accepts the right passcode and rejects the wrong one', async () => {
  const cred = await createCredential('s3cret-pass');
  assert.equal(await verifyPasscode('s3cret-pass', cred), true);
  assert.equal(await verifyPasscode('s3cret-pasx', cred), false);
  assert.equal(await verifyPasscode('S3Cret-pass', cred), false); // case-sensitive
  assert.equal(await verifyPasscode('', cred), false);
});

test('derivePasscodeHash is deterministic for (passcode, salt, iterations)', async () => {
  const salt = randomSaltHex();
  const h1 = await derivePasscodeHash('abc123', salt, PBKDF2_ITERATIONS);
  const h2 = await derivePasscodeHash('abc123', salt, PBKDF2_ITERATIONS);
  assert.equal(h1, h2);
  const h3 = await derivePasscodeHash('abc123', randomSaltHex(), PBKDF2_ITERATIONS);
  assert.notEqual(h1, h3);
});

test('verifyPasscode is robust against malformed/absent credentials', async () => {
  assert.equal(await verifyPasscode('x', null), false);
  assert.equal(await verifyPasscode('x', { salt: '', hash: 'aa', iterations: 1 }), false);
  assert.equal(await verifyPasscode('x', { salt: 'aa', hash: '', iterations: 1 }), false);
});

test('timingSafeEqualHex compares constant-length hex digests', () => {
  assert.equal(timingSafeEqualHex('ab12', 'ab12'), true);
  assert.equal(timingSafeEqualHex('ab12', 'ab13'), false);
  assert.equal(timingSafeEqualHex('ab12', 'ab1'), false); // length mismatch
  assert.equal(timingSafeEqualHex('', ''), false); // empty rejected
});

test('passcodePolicy enforces 6..128 characters', () => {
  assert.equal(passcodePolicy('abcdef'), null);
  assert.ok(passcodePolicy('abcde'), 'too short');
  assert.equal(passcodePolicy('x'.repeat(MAX_PASSCODE_LENGTH)), null);
  assert.ok(passcodePolicy('x'.repeat(MAX_PASSCODE_LENGTH + 1)), 'too long');
  assert.ok(passcodePolicy(''), 'empty');
  assert.ok(passcodePolicy(null), 'non-string');
  assert.equal(MIN_PASSCODE_LENGTH, 6);
});
