// Citizens, entities, offices — who exists and what they may do.
//
// The register never holds a name, an address, or anything else identifying.
// A citizenship is an identifier and a key; who stands behind it lives in
// private/, which is not committed.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { at, config } from './config.js';
import { fingerprint } from './sshsig.js';

const loadDir = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f) && !f.startsWith('_')).sort()
    .map((f) => ({ file: f, ...yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')) }));
};

export const citizens = (root) => loadDir(at(root, 'citizens'));
export const active = (root) => citizens(root).filter((c) => c.status === 'active');
export const citizen = (root, id) => citizens(root).find((c) => c.id === id) || null;

export const entities = (root) => loadDir(at(root, 'entities'));
export const entity = (root, id) => entities(root).find((e) => e.id === id) || null;

export function offices(root) {
  const file = at(root, 'offices');
  if (!fs.existsSync(file)) return [];
  const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  const spec = config(root).offices;
  return (doc.offices || []).map((o) => ({
    ...o,
    title: o.title || spec[o.id]?.title || o.id,
    powers: o.powers || spec[o.id]?.powers || [],
  }));
}

export function writeOffices(root, list) {
  const clean = list.map((o) => ({
    id: o.id, title: o.title, holder: o.holder,
    since: asDate(o.since), term_ends: asDate(o.term_ends),
    under: o.under || 'art-06/§5/¶1',
    powers: o.powers,
  }));
  fs.mkdirSync(path.dirname(at(root, 'offices')), { recursive: true });
  fs.writeFileSync(at(root, 'offices'), yaml.dump({ offices: clean }, { lineWidth: 100 }));
}

// js-yaml turns bare dates into Date objects; the register should read as text.
export const asDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

// Who holds a given power right now.
export const holderOf = (root, power) => offices(root).find((o) => (o.powers || []).includes(power)) || null;
export const mayExercise = (root, id, power) => offices(root).some((o) => o.holder === id && (o.powers || []).includes(power));

// Every key that may sign for a citizenship.
export function keysOf(root, id) {
  const c = citizen(root, id);
  return c && c.status === 'active' ? (c.keys || []) : [];
}

export function whoseKey(root, publicKeyLine) {
  const f = fingerprint(publicKeyLine);
  return citizens(root).find((c) => (c.keys || []).some((k) => fingerprint(k) === f)) || null;
}

// Personal data, kept apart and never committed. Erasure is deleting from here;
// the register keeps the identifier, so no record is altered.
export function persons(root) {
  const f = path.join(at(root, 'private'), 'persons.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
