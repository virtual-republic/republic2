// Other Republics.
//
//   art-05/§4/¶2  any person may operate a monitor, checking each published
//                 checkpoint against the last
//   art-11/§2/¶2  both Republics succeed to the history, and neither may
//                 describe the other as illegitimate in its own Journal
//
// A Republic that recognises another does not trust it. It VERIFIES it: it holds
// the other's Keeper key, fetches its published checkpoints, checks the
// signature and the chain from one to the next, and records what it saw.
//
// That record is the foundation of everything else. Nothing crosses between two
// Republics until each can say, from its own register, what the other's history
// was at a stated moment — and notice if it changes afterwards.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { at, config } from './config.js';
import { canonical } from './canonical.js';
import { verify } from './sshsig.js';
import { records } from './ledger.js';

export const foreignFile = (root) => path.join(root, 'register', 'republics.yml');

export function republics(root) {
  const f = foreignFile(root);
  if (!fs.existsSync(f)) return [];
  return (yaml.load(fs.readFileSync(f, 'utf8')) || {}).republics || [];
}

export function writeRepublics(root, list) {
  fs.mkdirSync(path.dirname(foreignFile(root)), { recursive: true });
  fs.writeFileSync(foreignFile(root), yaml.dump({ republics: list }, { lineWidth: 100 }));
}

export const republic = (root, name) => republics(root).find((r) => r.name === name) || null;

// What we have witnessed of another Republic, newest last.
export function witnessed(root, name) {
  return records(root)
    .filter((e) => e.kind === 'republic.witnessed' && e.payload.republic === name)
    .map((e) => e.payload);
}

// Check a foreign checkpoint: signed by their Keeper, and following the last one
// we saw. Returns { ok } or { ok:false, error } — never throws on bad input,
// because a neighbour publishing nonsense is an observation, not a crash.
export async function checkForeign(root, name, checkpoint) {
  const them = republic(root, name);
  if (!them) return { ok: false, error: `${name} is not a recognised Republic` };
  if (!them.keeper_key) return { ok: false, error: `no Keeper key recorded for ${name}` };

  if (!checkpoint || typeof checkpoint !== 'object') return { ok: false, error: 'not a checkpoint' };
  for (const f of ['number', 'records', 'root', 'previous', 'signature']) {
    if (checkpoint[f] === undefined) return { ok: false, error: `the checkpoint has no "${f}"` };
  }

  const { signature, ...body } = checkpoint;
  const v = await verify(canonical(body), signature, [them.keeper_key], 'republic-checkpoint');
  if (!v.ok) return { ok: false, error: `signature: ${v.error}` };

  // art-05/§4/¶2 — each checkpoint checked against the last. This is what turns
  // a snapshot into a chain, and what makes a rewrite visible.
  const seen = witnessed(root, name);
  const last = seen[seen.length - 1];
  if (last) {
    if (checkpoint.number <= last.number) {
      return checkpoint.root === last.root && checkpoint.number === last.number
        ? { ok: true, already: true, checkpoint }
        : { ok: false, error: `${name} has republished checkpoint ${checkpoint.number} with a different root. Its history has been rewritten.` };
    }
    if (checkpoint.records < last.records) {
      return { ok: false, error: `${name} now attests ${checkpoint.records} records, fewer than the ${last.records} we witnessed. Records have been removed.` };
    }
  }

  return { ok: true, checkpoint };
}
