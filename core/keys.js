// Finding and installing the key a command needs.
//
// A key downloaded from the website arrives under whatever name the browser gave
// it. Looking for it by content beats guessing at filenames, which is what the
// last attempt did and got wrong.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { at } from './config.js';
import { importPrivate, normalisePem } from './sshsig.js';
import { whoseKey } from './registry.js';

export const keyFile = (root, id) => path.join(at(root, 'private'), `${id}.pem`);

export async function readKey(root, id) {
  const file = keyFile(root, id);
  if (fs.existsSync(file)) return importPrivate(fs.readFileSync(file, 'utf8'));

  const dir = at(root, 'private');
  const have = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.pem')) : [];
  const e = new Error([
    `No key for ${id} at ${path.relative(root, file)}.`,
    '',
    have.length ? `${path.relative(root, dir)}/ holds: ${have.join(', ')}` : `${path.relative(root, dir)}/ is empty or missing.`,
    '',
    'If you made your key on the website, it downloaded under whatever name your',
    'browser chose. Find and install it:',
    '  republic key find',
    '  republic key import',
    '',
    'If you have no key yet:',
    `  republic key new ${id}`,
  ].join('\n'));
  e.friendly = true;
  throw e;
}

export async function saveKey(root, id, pem) {
  const dir = at(root, 'private');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile(root, id), normalisePem(pem), { mode: 0o600 });
  return keyFile(root, id);
}

// Every private key on this machine that might be a citizenship, newest first.
export async function findKeys(root) {
  const home = os.homedir();
  const dirs = [path.join(home, 'Downloads'), path.join(home, 'Desktop'), home, root, at(root, 'private')];
  const seen = new Set();
  const out = [];

  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const f of names) {
      if (!/\.(pem|key|txt)$/i.test(f)) continue;
      const full = path.join(d, f);
      if (seen.has(full)) continue;
      seen.add(full);
      let body;
      try { body = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (!body.includes('BEGIN PRIVATE KEY')) continue;
      let id = null, publicKey = null;
      try {
        const k = await importPrivate(body);
        publicKey = k.publicKey;
        id = whoseKey(root, k.publicKey)?.id ?? null;
      } catch { continue; }
      let when = new Date(0);
      try { when = fs.statSync(full).mtime; } catch {}
      out.push({ path: full, citizen: id, publicKey, when });
    }
  }
  return out.sort((a, b) => b.when - a.when);
}
