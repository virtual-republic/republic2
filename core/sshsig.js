// SSHSIG over Ed25519, in code that runs unchanged in Node and in a browser.
//
// This is the format `ssh-keygen -Y sign` produces, so a signature made here
// verifies there and the other way about. Ed25519 only, deliberately: one curve,
// one code path, nothing to negotiate.
//
// The whole module uses only Web Crypto and Uint8Array, which Node has provided
// as globals since 18. There is no second implementation to drift from this one.

const enc = new TextEncoder();
const MAGIC = enc.encode('SSHSIG');
const SPKI = Uint8Array.from(atob('MCowBQYDK2VwAyEA'), (c) => c.charCodeAt(0));
const PKCS8 = Uint8Array.from(atob('MC4CAQAwBQYDK2VwBCIEIA=='), (c) => c.charCodeAt(0));

// ---- bytes -------------------------------------------------------------------

const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const str = (b) => { const x = typeof b === 'string' ? enc.encode(b) : b; return cat(u32(x.length), x); };
const b64 = (b) => btoa(String.fromCharCode(...b));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function reader(buf) {
  let o = 0;
  return {
    string() { const n = (buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]; o += 4; const s = buf.subarray(o, o + n); o += n; return s; },
    u32() { const n = (buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]; o += 4; return n >>> 0; },
  };
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---- keys ---------------------------------------------------------------------

export async function generate(comment = '') {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const raw = spki.subarray(SPKI.length);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { publicKey: publicKeyLine(raw, comment), privateKey: pem(pkcs8), raw };
}

export function publicKeyLine(raw, comment = '') {
  return `ssh-ed25519 ${b64(cat(str('ssh-ed25519'), str(raw)))}${comment ? ' ' + comment : ''}`;
}

export function parsePublicKey(line) {
  const parts = String(line).trim().split(/\s+/);
  const i = parts.indexOf('ssh-ed25519');
  if (i === -1) throw new Error('only ssh-ed25519 keys are accepted');
  const r = reader(unb64(parts[i + 1]));
  if (new TextDecoder().decode(r.string()) !== 'ssh-ed25519') throw new Error('malformed key');
  const raw = r.string();
  if (raw.length !== 32) throw new Error('malformed ed25519 key');
  return raw;
}

// The fingerprint a register entry is matched on: the base64 blob, not the
// comment, so a key renamed is still the same key.
export const fingerprint = (line) => String(line).trim().split(/\s+/)[1];

export function pem(pkcs8) {
  const body = b64(pkcs8).replace(/(.{64})/g, '$1\n').trim();
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
}

// Any PEM however it was saved: blank lines, no trailing newline, extra spaces.
export function normalisePem(text) {
  const body = String(text).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return pem(unb64(body));
}

export function looksPublic(text) {
  const t = String(text).trim();
  return t.startsWith('ssh-') || /^AAAAC3NzaC1lZDI1NTE5/.test(t.replace(/\s+/g, ''));
}

export async function importPrivate(text) {
  const raw = String(text).trim();
  if (!raw) throw new Error('nothing given');
  if (looksPublic(raw)) throw new Error('that is the PUBLIC half — the private key begins "-----BEGIN PRIVATE KEY-----"');
  if (raw.includes('BEGIN OPENSSH PRIVATE KEY')) throw new Error('that is an OpenSSH key; Web Crypto cannot read it. Use a key made by this Republic.');

  let pkcs8;
  try { pkcs8 = unb64(raw.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')); }
  catch { throw new Error('this is not base64'); }
  if (pkcs8.length < 48) throw new Error('too short to be an Ed25519 private key');

  let key;
  try { key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']); }
  catch { throw new Error('the runtime could not read this as an Ed25519 private key'); }

  const jwk = await crypto.subtle.exportKey('jwk', key);
  const pub = unb64(jwk.x.replace(/-/g, '+').replace(/_/g, '/'));
  return { key, raw: pub, publicKey: publicKeyLine(pub) };
}

// ---- signing -------------------------------------------------------------------

const HASH = 'sha512';

async function blob(namespace, digest) {
  return cat(MAGIC, str(namespace), str(''), str(HASH), str(digest));
}

export async function sign(message, identity, namespace = 'republic') {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', enc.encode(message)));
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, identity.key, await blob(namespace, digest)));
  const armoured = cat(
    MAGIC, u32(1),
    str(cat(str('ssh-ed25519'), str(identity.raw))),
    str(namespace), str(''), str(HASH),
    str(cat(str('ssh-ed25519'), str(raw))),
  );
  return `-----BEGIN SSH SIGNATURE-----\n${b64(armoured).replace(/(.{70})/g, '$1\n')}\n-----END SSH SIGNATURE-----\n`;
}

export function parseSignature(armoured) {
  const buf = unb64(String(armoured).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''));
  if (!same(buf.subarray(0, 6), MAGIC)) throw new Error('not an SSH signature');
  const r = reader(buf.subarray(6));
  if (r.u32() !== 1) throw new Error('unsupported SSHSIG version');
  const pk = reader(r.string());
  const keyType = new TextDecoder().decode(pk.string());
  const keyRaw = pk.string();
  const namespace = new TextDecoder().decode(r.string());
  r.string();
  const hash = new TextDecoder().decode(r.string());
  const sw = reader(r.string());
  const sigType = new TextDecoder().decode(sw.string());
  const signature = sw.string();
  return { keyType, keyRaw, namespace, hash, sigType, signature };
}

// Returns { ok } or { ok:false, error }. Never throws on bad input — a malformed
// signature is a refusal, not a crash.
export async function verify(message, armoured, allowedKeys, namespace = 'republic') {
  let p;
  try { p = parseSignature(armoured || ''); }
  catch (e) { return { ok: false, error: e.message }; }

  if (p.keyType !== 'ssh-ed25519' || p.sigType !== 'ssh-ed25519') return { ok: false, error: 'only ed25519 signatures are accepted' };
  if (p.namespace !== namespace) return { ok: false, error: `signed in namespace "${p.namespace}", expected "${namespace}"` };

  const match = allowedKeys.find((line) => { try { return same(parsePublicKey(line), p.keyRaw); } catch { return false; } });
  if (!match) return { ok: false, error: 'the signing key is not on the register' };

  let digest;
  try { digest = new Uint8Array(await crypto.subtle.digest(p.hash === 'sha512' ? 'SHA-512' : 'SHA-256', enc.encode(message))); }
  catch { return { ok: false, error: `unsupported hash ${p.hash}` }; }

  const pub = await crypto.subtle.importKey('spki', cat(SPKI, p.keyRaw), { name: 'Ed25519' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'Ed25519' }, pub, p.signature, await blob(p.namespace, digest));
  return ok ? { ok: true, key: match } : { ok: false, error: 'the signature does not verify' };
}
