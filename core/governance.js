// The governance of an entity.
//
//   art-04/§3/¶1  every entity has a charter, which is a published document
//   art-04/§3/¶2  an organ holds only the authority the charter confers
//   art-04/§3/¶3  a charter must not be inconsistent with this Constitution
//   art-04/§3/¶4  an entity acts only through an organ of it
//
// A charter here is not decoration. Its front matter is read: who may vote, how
// their votes are weighed, what carries, how long an officer serves, and whether
// the entity's instruments may be traded at all. The prose beneath binds the
// members as a matter of their own agreement; the front matter binds the tools.
//
// A charter may NARROW what its type allows and never widen it. A company whose
// type may issue instruments may decide not to list them; an association whose
// type may not issue them cannot grant itself the power.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { at, config } from './config.js';
import { entity, entities, citizen } from './registry.js';
import { state } from './value.js';
import { frontmatter, parseSections, isoDate } from './corpus.js';

export function charterOf(root, id) {
  const e = entity(root, id);
  if (!e) return null;
  const file = path.join(root, e.charter || `charters/${id}.md`);
  if (!fs.existsSync(file)) return { entity: e, meta: {}, body: '', sections: [], missing: true, file };
  const [meta, body] = frontmatter(fs.readFileSync(file, 'utf8'));
  const { sections } = parseSections(body);
  return { entity: e, meta, body: body.trim(), sections, missing: false, file };
}

// What the entity may actually do: the type's grant, narrowed by the charter.
export function powersOf(root, id) {
  const cfg = config(root);
  const e = entity(root, id);
  if (!e) return null;
  const type = cfg.entities[e.type] || {};
  const c = charterOf(root, id);
  const ch = c?.meta || {};

  const narrow = (typeAllows, charterSays) =>
    typeAllows === false ? false : (charterSays === undefined ? typeAllows : !!charterSays && typeAllows);

  const gov = { ...(type.governance || {}), ...(ch.governance || {}) };

  return {
    type: e.type,
    // art-04/§2/¶3 — the type decides whether instruments are possible at all.
    instruments: narrow(!!type.instruments, ch.instruments),
    // A company may be private: its shares exist but are not traded.
    listed: !type.instruments ? false
      : (ch.listed === undefined ? (type.listed_by_default ?? false) : !!ch.listed),
    account: narrow(!!type.account, ch.account),
    vote: gov.vote === 'shares' && type.instruments ? 'shares' : 'members',
    quorum: Number(gov.quorum ?? 0.5),
    threshold: Number(gov.threshold ?? 0.5),
    term: Number(gov.term ?? 365),
    organs: e.organs || [],
    members: e.members || [],
  };
}

// Who may vote in this entity, and with what weight — art-04/§3/¶2.
//
//   members  every member alike, however much they hold. This is what makes an
//            association an association: joining makes you a coequal member.
//   shares   weighted by the instruments held, so a company answers to its
//            holders in proportion.
export function electorateOf(root, id) {
  const p = powersOf(root, id);
  if (!p) return [];

  if (p.vote === 'members') {
    return (p.members || [])
      .filter((m) => citizen(root, m)?.status === 'active')
      .map((m) => ({ id: m, weight: 1 }));
  }

  const holdings = state(root).holdings;
  const prefix = `${id}:`;
  const out = [];
  for (const [who, held] of holdings) {
    let n = 0;
    for (const [inst, q] of held) if (inst.startsWith(prefix) && q > 0) n += q;
    if (n > 0 && who !== id) out.push({ id: who, weight: n });
  }
  return out.sort((a, b) => b.weight - a.weight || String(a.id).localeCompare(String(b.id)));
}

// ---- resolutions ---------------------------------------------------------------

export const resolutionDir = (root, id) => path.join(at(root, 'resolutions'), id);

export function resolutions(root, id = null) {
  const base = at(root, 'resolutions');
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const ent of fs.readdirSync(base)) {
    if (id && ent !== id) continue;
    const dir = path.join(base, ent);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const [meta, body] = frontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      out.push({ ...meta, entity: meta.entity || ent, body: body.trim(), file: path.join(dir, f) });
    }
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export const resolution = (root, entityId, rid) => resolutions(root, entityId).find((r) => r.id === rid) || null;

export function ballotsOf(root, entityId, rid) {
  const dir = path.join(resolutionDir(root, entityId), rid);
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    out[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  return out;
}

// Counting, by the entity's own rule rather than the Republic's.
export function countResolution(root, r) {
  const p = powersOf(root, r.entity);
  const roll = electorateOf(root, r.entity);
  const byId = new Map(roll.map((x) => [x.id, x.weight]));
  const ballots = ballotsOf(root, r.entity, r.id);

  const counted = [];
  const rejected = [];
  for (const [who, b] of Object.entries(ballots)) {
    const weight = byId.get(who);
    if (!weight) { rejected.push({ id: who, why: p.vote === 'members' ? 'not a member' : 'holds no share' }); continue; }
    counted.push({ id: who, choice: b.choice, weight, at: b.at });
  }

  const total = roll.reduce((n, x) => n + x.weight, 0);
  const cast = counted.reduce((n, x) => n + x.weight, 0);
  const quorumNeeded = Math.ceil(p.quorum * total);
  const quorumMet = cast >= quorumNeeded;

  const closes = r.closes ? new Date(r.closes + 'T23:59:59Z') : null;
  const everyone = counted.length >= roll.length && roll.length > 0;
  const early = config(root).resolutions.close_early?.on_full_participation && everyone;
  const open = (closes ? new Date() < closes : true) && !early;

  if (r.kind === 'officer') {
    const tallies = new Map();
    for (const b of counted) for (const c of [].concat(b.choice)) tallies.set(c, (tallies.get(c) || 0) + b.weight);
    const sorted = [...tallies.entries()].sort((a, b) => b[1] - a[1]);
    const winner = sorted.length && (!sorted[1] || sorted[0][1] > sorted[1][1]) ? sorted[0][0] : null;
    return { ...base(), kind: 'officer', tallies: sorted, winner, carried: !open && quorumMet && !!winner };
  }

  let yes = 0, no = 0, abstain = 0;
  for (const b of counted) {
    if (b.choice === 'yes') yes += b.weight;
    else if (b.choice === 'no') no += b.weight;
    else abstain += b.weight;
  }
  const decisive = yes + no;
  const share = decisive ? yes / decisive : 0;
  return { ...base(), kind: r.kind || 'policy', yes, no, abstain, share, thresholdMet: share >= p.threshold, carried: !open && quorumMet && share >= p.threshold };

  function base() {
    return {
      resolution: r.id, entity: r.entity, vote: p.vote,
      electorate: total, voters: roll.length, cast, counted, rejected,
      quorumNeeded, quorumMet, threshold: p.threshold,
      open, closedEarly: early ? 'every voter has voted' : null,
      closes: r.closes || null,
    };
  }
}

export function writeResolutionResult(root, r, result) {
  const dir = path.join(resolutionDir(root, r.entity), r.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '_result.json'), JSON.stringify({ ...result, countedAt: new Date().toISOString() }, null, 2));
}
