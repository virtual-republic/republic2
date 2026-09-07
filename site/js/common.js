// Shared by every page: identity, page data, citation copying.
//
// This is a static file. The builder never writes JavaScript, so no page can
// have a syntax error the builder introduced.

export const DATA = JSON.parse(document.getElementById('page-data').textContent);
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => [...document.querySelectorAll(sel)];

export const u = (p) => DATA.base + p;

export async function getJSON(path) {
  const r = await fetch(u(path));
  if (!r.ok) throw new Error(`${r.status} for ${path}`);
  return r.json();
}

export function say(text, bad = false) {
  const el = $('[data-msg]');
  if (!el) { console[bad ? 'error' : 'log']('[republic]', text); return; }
  el.textContent = text;
  el.className = 'msg' + (bad ? ' bad' : '');
}

export function problem(where, err) {
  const text = `${where}: ${err && err.message ? err.message : err}`;
  say(text, true);
  console.error('[republic]', where, err);
}

export const rand = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

// Canonical serialisation, identical to core/canonical.js. A ballot signed here
// must verify there.
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

export async function sha256(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// GitHub's "create a file" form, prefilled. This is how a static page writes to
// the repository without a server anywhere.
export function commitUrl(filename, content, message) {
  const q = new URLSearchParams({ filename, value: content, message });
  return `https://github.com/${DATA.repo}/new/${DATA.branch}?${q}`;
}

export function offerCommit(filename, body, message) {
  const out = $('[data-out]');
  const link = $('[data-commit]');
  const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  if (out) { out.hidden = false; out.textContent = text; }
  if (link) { link.href = commitUrl(filename, text, message); link.hidden = false; }
}

// ---- identity ----------------------------------------------------------------

let identity = null;
let me = null;
let pem = null;
let roll = [];

export const who = () => me;
export const key = () => identity;
export const privatePem = () => pem;

const listeners = [];
export const onIdentity = (fn) => { listeners.push(fn); fn(me); };
const announce = () => { for (const fn of listeners) { try { fn(me); } catch (e) { console.error(e); } } };

export async function useKey(text) {
  const S = await import('./core/sshsig.js');
  identity = await S.importPrivate(text);
  pem = S.normalisePem(text);
  const fp = S.fingerprint(identity.publicKey);
  const found = roll.find((c) => (c.keys || []).some((k) => S.fingerprint(k) === fp));
  me = found && found.status === 'active' ? found.id : null;
  try { localStorage.setItem('republic.key', pem); } catch {}
  const w = document.querySelector('[data-whoami]');
  if (w) w.textContent = me || 'key loaded';
  announce();
  return me;
}

export function forgetKey() {
  try { localStorage.removeItem('republic.key'); } catch {}
  identity = null; me = null; pem = null;
  announce();
}

export async function sign(message, namespace = 'republic') {
  if (!identity) throw new Error('no key is loaded — see Your key');
  const S = await import('./core/sshsig.js');
  return S.sign(message, identity, namespace);
}

// Restore whatever this browser already holds, before any page module runs.
export const ready = (async () => {
  try { roll = await getJSON('/data/citizens.json'); } catch { roll = []; }
  let held = null;
  try { held = localStorage.getItem('republic.key'); } catch {}
  if (held) { try { await useKey(held); } catch { forgetKey(); } }
  else {
    const w = document.querySelector('[data-whoami]');
    if (w) w.textContent = 'sign in';
    announce();
  }
  return me;
})();

export const citizens = () => roll;

// Copy-a-citation, on every page that has one.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-cite], [data-copy]');
  if (!el) return;
  const id = el.dataset.cite || el.dataset.copy;
  const href = el.getAttribute('href');
  e.preventDefault();
  navigator.clipboard.writeText(id + (href ? '  ' + new URL(href, location).href : '  ' + location.href));
  const was = el.textContent;
  el.classList.add('copied');
  if (el.dataset.copy) el.textContent = 'copied';
  setTimeout(() => { el.classList.remove('copied'); if (el.dataset.copy) el.textContent = was; }, 1200);
  if (href) history.replaceState(null, '', href);
});
