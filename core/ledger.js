// The register.
//
// Append-only, hash-chained, and read defensively. A merge can put conflict
// markers or duplicate lines into a file that must parse as JSON; reading must
// report that rather than throw, because the tool that diagnoses damage cannot
// be the tool that dies on it.
//
// Invariants, enforced here and nowhere else:
//   every record has exactly one author
//   every record cites a provision
//   every record carries the hash of the one before it
//   a record, once written, is never altered

import fs from 'node:fs';
import path from 'node:path';
import { canonical } from './canonical.js';
import { sha256, GENESIS, merkleRoot, merkleProof, verifyProof } from './hash.js';
import { at, config } from './config.js';

export const hashRecord = (prev, body) => sha256(prev + canonical(body));

const CONFLICT = /^(<{7}|={7}|>{7})/;

// Returns { records, damage }. Never throws on a damaged file.
export function readLedger(root) {
  const file = at(root, 'ledger');
  if (!fs.existsSync(file)) return { records: [], damage: [] };

  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const records = [];
  const damage = [];

  lines.forEach((line, i) => {
    if (!line.trim()) return;
    if (CONFLICT.test(line)) { damage.push({ line: i + 1, kind: 'conflict', text: line.slice(0, 40) }); return; }
    try { records.push(JSON.parse(line)); }
    catch { damage.push({ line: i + 1, kind: 'unparsable', text: line.slice(0, 40) }); }
  });

  return { records, damage };
}

export const records = (root) => readLedger(root).records;

const REQUIRED = ['at', 'author', 'kind', 'provision', 'payload'];

export function append(root, event) {
  // Default first, then check. The time of a record is supplied when it is not
  // given; the author and the provision never are.
  const when = event.at || new Date().toISOString();
  const filled = { ...event, at: when };

  for (const f of REQUIRED) {
    if (filled[f] === undefined || filled[f] === null || filled[f] === '') {
      throw new Error(`record refused: no "${f}" — art-02/§1/¶1 and art-02/§4/¶1: every record has one author and cites a provision`);
    }
  }
  if (Array.isArray(filled.author)) throw new Error('record refused: exactly one author (art-02/§1/¶1)');

  const { records: existing, damage } = readLedger(root);
  if (damage.length) throw new Error(`record refused: the ledger is damaged at line ${damage[0].line}. Run: republic doctor`);

  const prev = existing.length ? existing[existing.length - 1].hash : GENESIS;
  const body = {
    seq: existing.length + 1,
    at: when,
    author: filled.author,
    entity: filled.entity,
    kind: filled.kind,
    provision: filled.provision,
    payload: filled.payload,
    prev,
  };
  const record = { ...body, hash: hashRecord(prev, body) };

  fs.mkdirSync(path.dirname(at(root, 'ledger')), { recursive: true });
  fs.appendFileSync(at(root, 'ledger'), JSON.stringify(record) + '\n');
  return record;
}

export function verifyChain(root) {
  const { records: rs, damage } = readLedger(root);
  const problems = damage.map((d) => ({ seq: d.line, error: `${d.kind} at line ${d.line}` }));
  let prev = GENESIS;

  if (!damage.length) {
    rs.forEach((e, i) => {
      const { hash, ...body } = e;
      if (body.seq !== i + 1) problems.push({ seq: i + 1, error: `sequence is ${body.seq}` });
      if (body.prev !== prev) problems.push({ seq: body.seq, error: 'broken link to the record before it' });
      if (hashRecord(prev, body) !== hash) problems.push({ seq: body.seq, error: 'hash does not match content' });
      prev = hash;
    });
  }

  return { ok: problems.length === 0, count: rs.length, head: prev, problems, damage };
}

// ---- checkpoints ---------------------------------------------------------------

export function checkpoints(root) {
  const dir = at(root, 'checkpoints');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

export function nextCheckpoint(root) {
  const rs = records(root);
  const list = checkpoints(root);
  const prev = list[list.length - 1] || null;
  return {
    number: (prev?.number ?? 0) + 1,
    at: new Date().toISOString(),
    records: rs.length,
    root: merkleRoot(rs.map((e) => e.hash)),
    head: rs.length ? rs[rs.length - 1].hash : GENESIS,
    previous: prev ? prev.root : GENESIS,
  };
}

export function writeCheckpoint(root, checkpoint) {
  const dir = at(root, 'checkpoints');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(checkpoint.number).padStart(6, '0')}.json`);
  fs.writeFileSync(file, JSON.stringify(checkpoint, null, 2) + '\n');
  return file;
}

export { merkleRoot, merkleProof, verifyProof, GENESIS };
