// Acts.
//
// Every change to the Republic that is not a plain file edit arrives as a signed
// instrument in acts/ and is applied here. One pipeline, one place where the
// rules are checked. A tool that appended to the ledger by its own route would
// be a second set of rules waiting to disagree with this one.
//
// Each kind declares who may sign it and what must hold. Adding a kind means
// adding an entry to KINDS and nothing else.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { canonical } from './canonical.js';
import { at, config, classOf } from './config.js';
import { append } from './ledger.js';
import { verify } from './sshsig.js';
import { citizen, entity, entities, offices, mayExercise, keysOf, writeOffices, asDate } from './registry.js';
import { state, accounts, mayActFor, matchBook, TREASURY } from './value.js';
import { corpus, frontmatter, isoDate, parseSections } from './corpus.js';
import { refuseUnused } from './vocabulary.js';
import { deedState } from './deeds.js';
import { powersOf, charterOf, electorateOf, resolution, countResolution, writeResolutionResult, resolutionDir } from './governance.js';

// The message an act signs: everything except the signature, canonically.
export const actMessage = (act) => {
  const { signature, _file, _path, ...body } = act;
  return canonical(body);
};

export function loadActs(root) {
  const dir = at(root, 'acts');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort()
    .map((f) => ({ ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), _file: f, _path: path.join(dir, f) }));
}

export function writeAct(root, act) {
  const dir = at(root, 'acts');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${act.at.replace(/[:.]/g, '-')}-${act.kind.replace(/\./g, '-')}.json`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(act, null, 2) + '\n');
  return file;
}

// Publication is promulgation (art-05/§2/¶2). Recognition of a deed and
// enactment of a measure both go through here, so an issue is written one way.
export function publishIssue(root, { title, body, cites = [], extra = {} }) {
  const dir = at(root, 'issues');
  const year = new Date().toISOString().slice(0, 4);
  const existing = corpus(root).issues;
  const number = existing.reduce((n, j) => Math.max(n, j.number || 0), 0) + 1;
  fs.mkdirSync(path.join(dir, year), { recursive: true });
  const file = path.join(dir, year, `${String(number).padStart(4, '0')}-${(extra.slug || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.md`);
  const { slug: _s, ...front } = extra;
  fs.writeFileSync(file, `---\n${yaml.dump({ number, date: new Date().toISOString().slice(0, 10), title, ...front, cites }).trim()}\n---\n\n${body}\n`);
  return { number, file };
}

const carried = (root, measureId) => {
  const f = path.join(at(root, 'ballots'), measureId, '_result.json');
  if (!fs.existsSync(f)) return { ok: false, why: `${measureId} has not been counted` };
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!r.carried) return { ok: false, why: `${measureId} ${r.open ? 'is still open' : 'did not carry'}, so it authorises nothing (art-08/§5/¶1)` };
  return { ok: true, result: r };
};

// ---- the kinds -------------------------------------------------------------------

export const KINDS = {

  'value.issue': {
    provision: 'art-10/§2/¶1',
    check(root, a) {
      const off = refuseUnused(root, 'value', 'issuing the unit');
      if (off) return off;
      if (!mayExercise(root, a.by, 'value.issue')) return `only the holder of value.issue may issue the unit (art-10/§2/¶1)`;
      if (!a.resolution) return 'an issue must cite the resolution that authorises it (art-10/§2/¶1)';
      const c = carried(root, a.resolution);
      if (!c.ok) return c.why;
      const cap = config(root).value.issue_cap;
      if (a.amount > cap) return `${a.amount} exceeds the cap of ${cap} (art-10/§2/¶2)`;
      if (!(a.amount > 0)) return 'an issue must be a positive amount';
      return null;
    },
    apply: (root, a) => ({ kind: 'value.issued', payload: { amount: a.amount, unit: config(root).value.unit, to: a.to || TREASURY, resolution: a.resolution } }),
    describe: (root, a) => `issued ${a.amount} ${config(root).value.unit} to ${a.to || TREASURY} under ${a.resolution}`,
  },

  'value.transfer': {
    provision: 'art-10/§3/¶2',
    check(root, a) {
      const off = refuseUnused(root, 'value', 'transferring the unit');
      if (off) return off;
      const acct = accounts(root);
      if (!acct.has(a.from) || !acct.has(a.to)) return 'unknown account';
      if (a.from === a.to) return 'from and to are the same account';
      if (!mayActFor(root, a.by, a.from)) return `${a.by} may not act for ${a.from} (art-02/§5/¶3)`;
      if (!(a.amount > 0)) return 'a transfer must be a positive amount';
      const bal = state(root).balances.get(a.from) || 0;
      if (bal < a.amount) return `${a.from} holds ${bal}, and the transfer needs ${a.amount}`;
      return null;
    },
    apply: (root, a) => ({ kind: 'value.transferred', payload: { from: a.from, to: a.to, amount: a.amount, unit: config(root).value.unit, ...(a.note ? { note: a.note } : {}) } }),
    describe: (root, a) => `${a.from} → ${a.to}  ${a.amount} ${config(root).value.unit}`,
  },

  'instrument.issue': {
    provision: 'art-10/§4/¶1',
    check(root, a) {
      const off = refuseUnused(root, 'instruments', 'issuing a share');
      if (off) return off;
      const e = entity(root, a.issuer);
      if (!e) return `no entity ${a.issuer}`;
      const p = powersOf(root, a.issuer);
      if (!p.instruments) return `${a.issuer} may not issue instruments — its ${config(root).entities[e.type]?.instruments ? 'charter withholds it' : 'type does not allow it'} (art-04/§2/¶3, art-04/§3/¶2)`;
      if (!mayActFor(root, a.by, a.issuer)) return `${a.by} is not an organ of ${a.issuer} (art-04/§3/¶4)`;
      if (!(a.quantity > 0)) return 'an issue must be a positive quantity';
      return null;
    },
    apply: (root, a) => ({ entity: a.issuer, kind: 'instrument.issued', payload: { instrument: `${a.issuer}:${a.class || 'ordinary'}`, issuer: a.issuer, class: a.class || 'ordinary', quantity: a.quantity, to: a.to || a.issuer } }),
    describe: (root, a) => `${a.issuer} issued ${a.quantity} × ${a.issuer}:${a.class || 'ordinary'} to ${a.to || a.issuer}`,
  },

  'instrument.transfer': {
    provision: 'art-10/§4/¶2',
    check(root, a) {
      const off = refuseUnused(root, 'instruments', 'transferring a share');
      if (off) return off;
      const acct = accounts(root);
      if (!acct.has(a.from) || !acct.has(a.to)) return 'unknown account';
      if (!mayActFor(root, a.by, a.from)) return `${a.by} may not act for ${a.from}`;
      const held = (state(root).holdings.get(a.from) || new Map()).get(a.instrument) || 0;
      if (held < a.quantity) return `${a.from} holds ${held} of ${a.instrument}, not ${a.quantity}`;
      return null;
    },
    apply: (root, a) => ({ kind: 'instrument.transferred', payload: { from: a.from, to: a.to, instrument: a.instrument, quantity: a.quantity } }),
    describe: (root, a) => `${a.from} → ${a.to}  ${a.quantity} × ${a.instrument}`,
  },

  'order': {
    provision: 'art-10/§5/¶1',
    check(root, a) {
      const off = refuseUnused(root, 'exchange', 'the exchange');
      if (off) return off;
      if (!accounts(root).has(a.account)) return `"${a.account}" is not an account`;
      if (!mayActFor(root, a.by, a.account)) return `${a.by} may not act for ${a.account}`;
      if (!['buy', 'sell'].includes(a.side)) return 'an order is a buy or a sell';
      // A company may be private: its shares exist, and are not traded.
      const issuer = String(a.instrument || '').split(':')[0];
      if (entity(root, issuer) && !powersOf(root, issuer).listed) {
        return `${issuer} is not listed — its charter does not permit its instruments to be traded (art-04/§3/¶2). They may still be transferred directly.`;
      }
      if (!(a.quantity > 0) || !(a.price > 0)) return 'an order needs a positive quantity and price';
      return null;
    },
    apply: null,          // orders are held and cleared together, below
    describe: (root, a) => `${a.side} ${a.quantity} × ${a.instrument} at ${a.price}`,
  },

  'entity.form': {
    provision: 'art-04/§1/¶1',
    check(root, a) {
      const off = refuseUnused(root, 'entities', 'forming an entity');
      if (off) return off;
      const spec = config(root).entities[a.type];
      if (!spec) return `unknown type "${a.type}"`;
      if (!citizen(root, a.by) || citizen(root, a.by).status !== 'active') return `${a.by} is not an active citizenship`;
      if (entity(root, a.entity)) return `${a.entity} already exists`;
      if (spec.formed_by === 'law') {
        if (!a.under) return `a ${a.type} is formed only on a carried measure (art-04/§1/¶2)`;
        const c = carried(root, a.under);
        if (!c.ok) return c.why;
        if (spec.entered_by && !mayExercise(root, a.by, `${spec.entered_by === 'registrar' ? 'entity.register' : spec.entered_by}`)) {
          return `only the Registrar may enter a ${a.type} (art-04/§1/¶2)`;
        }
      }
      return null;
    },
    apply(root, a) {
      const file = path.join(at(root, 'entities'), `${a.entity}.yml`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, yaml.dump({
        id: a.entity, type: a.type, name: a.name,
        formed: a.at.slice(0, 10), formed_by: a.by,
        under: a.under || 'art-04/§1/¶1',
        charter: `charters/${a.entity}.md`,
        organs: a.organs || [{ name: 'convenor', held_by: [a.by] }],
        members: a.members || [a.by],
        status: 'active',
      }));
      return { entity: a.entity, kind: 'entity.formed', payload: { entity: a.entity, type: a.type, name: a.name, ...(a.under ? { measure: a.under } : {}) } };
    },
    describe: (root, a) => `${a.by} formed ${a.entity} — ${a.name} (${a.type})`,
  },

  'entity.amend': {
    provision: 'art-04/§3/¶2',
    check(root, a) {
      const off = refuseUnused(root, 'entities', 'managing an entity');
      if (off) return off;
      if (!entity(root, a.entity)) return `no entity ${a.entity}`;
      if (!mayActFor(root, a.by, a.entity)) return `${a.by} is not an organ of ${a.entity} (art-04/§3/¶4)`;
      if (!['charter', 'organs', 'members.admit', 'members.remove', 'dissolve'].includes(a.what)) return `unknown change "${a.what}"`;
      return null;
    },
    apply(root, a) {
      const file = path.join(at(root, 'entities'), `${a.entity}.yml`);
      const doc = yaml.load(fs.readFileSync(file, 'utf8'));
      let what = '';
      switch (a.what) {
        case 'charter': {
          const cf = path.join(root, doc.charter || `charters/${a.entity}.md`);
          fs.mkdirSync(path.dirname(cf), { recursive: true });
          fs.writeFileSync(cf, a.text);
          what = `the charter of ${a.entity}`;
          break;
        }
        case 'organs': doc.organs = a.organs; what = `the organs of ${a.entity}`; break;
        case 'members.admit': doc.members = [...new Set([...(doc.members || []), ...a.members])]; what = `${a.members.join(', ')} admitted to ${a.entity}`; break;
        case 'members.remove': { const out = new Set(a.members); doc.members = (doc.members || []).filter((m) => !out.has(m)); what = `${a.members.join(', ')} removed from ${a.entity}`; break; }
        case 'dissolve': doc.status = 'dissolved'; doc.dissolved = a.at.slice(0, 10); what = `${a.entity} dissolved`; break;
      }
      if (a.what !== 'charter') fs.writeFileSync(file, yaml.dump(doc));
      return { entity: a.entity, kind: a.what === 'dissolve' ? 'entity.dissolved' : 'entity.amended', payload: { entity: a.entity, change: a.what, ...(a.members ? { members: a.members } : {}), ...(a.organs ? { organs: a.organs } : {}) }, _what: what };
    },
    describe: (root, a) => `${a.what} of ${a.entity}`,
  },

  // A deed is recognised title. Anyone may ASK for one; only the holder of the
  // power may recognise it; and it is valid only once published — so
  // recognition writes the deed and its Journal issue in one act.
  'deed.request': {
    provision: 'art-05/§2/¶1',
    check(root, a) {
      const off = refuseUnused(root, 'deeds', 'deeds');
      if (off) return off;
      if (!citizen(root, a.by) || citizen(root, a.by).status !== 'active') return `${a.by} is not an active citizenship`;
      if (!a.title) return 'a request must state what is claimed';
      if (!accounts(root).has(a.holder || a.by)) return `"${a.holder || a.by}" is not an account`;
      const kinds = config(root).deeds.kinds;
      if (a.deedKind && !kinds.includes(a.deedKind)) return `unknown kind "${a.deedKind}" — one of ${kinds.join(', ')}`;
      if (existingDeed(root, a.deed)) return `deed.${a.deed} already exists`;
      return null;
    },
    apply(root, a) {
      // A request is recorded, and nothing more. It confers no title.
      const dir = path.join(at(root, 'deeds'), 'requested');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${a.deed}.md`), `---\n${yaml.dump({
        id: a.deed, title: a.title, kind: a.deedKind || 'property',
        holder: a.holder || a.by, requested_by: a.by, requested: a.at.slice(0, 10),
        transferable: a.transferable === true,
        status: 'requested',
      }).trim()}\n---\n\n${a.text || '¹ ' + a.title}\n`);
      return { kind: 'deed.requested', payload: { deed: a.deed, holder: a.holder || a.by, title: a.title, transferable: a.transferable === true } };
    },
    describe: (root, a) => `${a.by} asks the Keeper to recognise deed.${a.deed} — not yet valid`,
  },

  'deed.recognise': {
    provision: 'art-05/§2/¶2',
    check(root, a) {
      const off = refuseUnused(root, 'deeds', 'deeds');
      if (off) return off;
      if (!mayExercise(root, a.by, 'deed.recognise')) {
        const who = holderOfPower(root, 'deed.recognise');
        if (who) return `only the ${who.title} may recognise a deed. That is ${who.holder}.`;
        // art-06/§4/¶1 — the register governs what an office may do. An office
        // written before a power existed does not gain it by the settings
        // changing; the grant has to be recorded.
        return `no office on the register holds deed.recognise, so nobody may recognise a deed. `
          + `The settings grant it to the Keeper, but the register was written before it existed. `
          + `Run: republic office sync --apply`;
      }
      if (existingDeed(root, a.deed)) return `deed.${a.deed} is already recognised`;
      const req = requestedDeed(root, a.deed);
      if (!req && !a.title) return `no request for "${a.deed}", and no title given to recognise one directly`;
      // art-05/§2/¶2 — the Keeper may recognise on their own motion. With no
      // request behind it there is nobody to take the holder from, so it is the
      // Keeper unless they name someone.
      const holder = a.holder || req?.holder || a.by;
      if (!accounts(root).has(holder)) return `"${holder}" is not an account`;
      return null;
    },
    apply(root, a) {
      const req = requestedDeed(root, a.deed);
      const holder = a.holder || req?.holder || a.by;
      const transferable = a.transferable !== undefined ? a.transferable === true : !!req?.transferable;
      const title = a.title || req?.title;
      const kind = a.deedKind || req?.kind || 'property';
      const body = a.text || req?.body || `¹ ${title}`;

      // art-05/§2/¶2 — publication is promulgation. The deed and its issue are
      // written together, because a deed unpublished is not a deed.
      const issue = publishIssue(root, {
        title: `Recognition of deed.${a.deed}`,
        slug: `deed-${a.deed}`,
        cites: ['art-05/§2/¶2'],
        extra: { deed: a.deed, holder, slug: `deed-${a.deed}` },
        body: `The Keeper of the Journal recognises deed.${a.deed} — ${title} — held by ${holder}.\n\nIt is ${transferable ? 'transferable' : 'not transferable'}.\n\nA deed is valid on its recognition and publication, and not before — Article 5 § 2 ².`,
      });

      fs.mkdirSync(at(root, 'deeds'), { recursive: true });
      fs.writeFileSync(path.join(at(root, 'deeds'), `${a.deed}.md`), `---\n${yaml.dump({
        id: a.deed, title, kind, holder, transferable,
        recognised: a.at.slice(0, 10), recognised_by: a.by, journal: issue.number,
        ...(req ? { requested_by: req.requested_by, requested: req.requested } : { recognised_directly: true }),
        status: 'valid',
      }).trim()}\n---\n\n${body}\n`);

      if (req) fs.rmSync(path.join(at(root, 'deeds'), 'requested', `${a.deed}.md`), { force: true });

      return { kind: 'deed.recognised', payload: { deed: a.deed, holder, transferable, journal: issue.number } };
    },
    describe: (root, a) => `deed.${a.deed} recognised and published`,
  },

  'deed.refuse': {
    provision: 'art-05/§2/¶1',
    check(root, a) {
      const off = refuseUnused(root, 'deeds', 'deeds');
      if (off) return off;
      if (!mayExercise(root, a.by, 'deed.recognise')) return 'only the holder of deed.recognise may refuse a request';
      if (!requestedDeed(root, a.deed)) return `no request for "${a.deed}"`;
      if (!a.reasons) return 'a refusal states its reasons';
      return null;
    },
    apply(root, a) {
      const f = path.join(at(root, 'deeds'), 'requested', `${a.deed}.md`);
      const src = fs.readFileSync(f, 'utf8');
      const [meta, body] = frontmatter(src);
      fs.writeFileSync(f, `---\n${yaml.dump({ ...meta, status: 'refused', refused: a.at.slice(0, 10), refused_by: a.by, reasons: a.reasons }).trim()}\n---\n${body}`);
      return { kind: 'deed.refused', payload: { deed: a.deed, reasons: a.reasons } };
    },
    describe: (root, a) => `the request for deed.${a.deed} is refused — ${a.reasons}`,
  },

  'deed.transfer': {
    provision: 'art-05/§2/¶2',
    check(root, a) {
      const off = refuseUnused(root, 'deeds', 'deeds');
      if (off) return off;
      const d = existingDeed(root, a.deed);
      if (!d) return `no deed "${a.deed}", or it is not yet recognised`;
      if (!d.transferable) return `deed.${a.deed} is not transferable`;
      if (!mayActFor(root, a.by, d.holder)) return `${a.by} does not hold deed.${a.deed}; ${d.holder} does`;
      if (!accounts(root).has(a.to)) return `"${a.to}" is not an account`;
      if (a.to === d.holder) return 'it is already held there';
      return null;
    },
    apply(root, a) {
      const f = path.join(at(root, 'deeds'), `${a.deed}.md`);
      const [meta, body] = frontmatter(fs.readFileSync(f, 'utf8'));
      const from = meta.holder;
      fs.writeFileSync(f, `---\n${yaml.dump({ ...meta, holder: a.to, transferred: a.at.slice(0, 10), previously: [...(meta.previously || []), from] }).trim()}\n---\n${body}`);
      return { kind: 'deed.transferred', payload: { deed: a.deed, from, to: a.to } };
    },
    describe: (root, a) => `deed.${a.deed} passes to ${a.to}`,
  },

  // art-04/§3 — an entity decides by its charter. A resolution is the entity's
  // own measure: its members or its holders vote, weighed as the charter says.
  'entity.resolve': {
    provision: 'art-04/§3/¶2',
    check(root, a) {
      const off = refuseUnused(root, 'entities', 'a resolution of an entity');
      if (off) return off;
      const e = entity(root, a.entity);
      if (!e) return `no entity ${a.entity}`;
      const roll = electorateOf(root, a.entity);
      if (!roll.some((x) => x.id === a.by) && !mayActFor(root, a.by, a.entity)) {
        return `${a.by} neither votes in ${a.entity} nor acts for it (art-04/§3/¶2)`;
      }
      if (!a.title) return 'a resolution states what it decides';
      const kinds = config(root).resolutions.kinds;
      if (a.resolutionKind && !kinds.includes(a.resolutionKind)) return `unknown kind "${a.resolutionKind}" — one of ${kinds.join(', ')}`;
      if (a.resolutionKind === 'officer' && !a.organ) return 'an officer resolution names the organ to be filled';
      if (resolution(root, a.entity, a.resolution)) return `${a.resolution} already exists`;
      return null;
    },
    apply(root, a) {
      const dir = resolutionDir(root, a.entity);
      fs.mkdirSync(dir, { recursive: true });
      const window = config(root).resolutions.window;
      const closes = new Date(Date.now() + window * 86400000).toISOString().slice(0, 10);
      fs.writeFileSync(path.join(dir, `${a.resolution}.md`), `---\n${yaml.dump({
        id: a.resolution, entity: a.entity, title: a.title,
        kind: a.resolutionKind || 'policy',
        ...(a.organ ? { organ: a.organ } : {}),
        ...(a.candidates ? { candidates: a.candidates } : {}),
        proposed_by: a.by, opened: a.at.slice(0, 10), closes,
      }).trim()}\n---\n\n${a.text || '## § 1\n\n¹ ' + a.title}\n`);
      return { entity: a.entity, kind: 'resolution.proposed', payload: { entity: a.entity, resolution: a.resolution, kind: a.resolutionKind || 'policy', title: a.title, ...(a.organ ? { organ: a.organ } : {}) } };
    },
    describe: (root, a) => `${a.entity}: ${a.resolution} — ${a.title}`,
  },

  'entity.vote': {
    provision: 'art-04/§3/¶2',
    check(root, a) {
      const off = refuseUnused(root, 'entities', 'voting in an entity');
      if (off) return off;
      const r = resolution(root, a.entity, a.resolution);
      if (!r) return `no resolution ${a.resolution} of ${a.entity}`;
      const roll = electorateOf(root, a.entity);
      const mine = roll.find((x) => x.id === a.by);
      if (!mine) {
        const p = powersOf(root, a.entity);
        return p.vote === 'members' ? `${a.by} is not a member of ${a.entity}` : `${a.by} holds no share in ${a.entity}`;
      }
      if (r.kind === 'officer') { if (!a.choice) return 'name whom you are voting for'; }
      else if (!['yes', 'no', 'abstain'].includes(a.choice)) return 'vote yes, no or abstain';
      return null;
    },
    apply(root, a) {
      const dir = path.join(resolutionDir(root, a.entity), a.resolution);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${a.by}.json`), JSON.stringify({ resolution: a.resolution, entity: a.entity, choice: a.choice, at: a.at }, null, 2));
      return { entity: a.entity, kind: 'resolution.voted', payload: { entity: a.entity, resolution: a.resolution, by: a.by } };
    },
    describe: (root, a) => `${a.by} voted on ${a.resolution} of ${a.entity}`,
  },

  'contract.sign': {
    provision: 'art-09/§7/¶2',
    check(root, a) {
      const off = refuseUnused(root, 'contracts', 'contracts');
      if (off) return off;
      const f = path.join(at(root, 'contracts'), `${a.contract}.md`);
      if (!fs.existsSync(f)) return `no contract ${a.contract}`;
      const [meta] = frontmatter(fs.readFileSync(f, 'utf8'));
      const parties = [].concat(meta.parties || []);
      if (!parties.some((p) => mayActFor(root, a.by, p))) return `${a.by} is not a party to ${a.contract}`;
      return null;
    },
    apply: null,          // signatures accumulate; execution is checked below
    describe: (root, a) => `${a.party || a.by} signed ${a.contract}`,
  },
};

function existingDeed(root, id) {
  const folded = existingDeedFolded(root, id);
  if (!folded) return null;
  const f = path.join(at(root, 'deeds'), `${id}.md`);
  const fromFile = fs.existsSync(f) ? frontmatter(fs.readFileSync(f, 'utf8')) : [{}, ''];
  return { ...fromFile[0], ...folded, body: (fromFile[1] || folded.body || '').trim() };
}

// The RECORD is authoritative, not the file — art-05/§1/¶2. A request that was
// recorded may be recognised even if its file went astray in a merge, and a
// file with no record behind it is not a request at all.
function requestedDeed(root, id) {
  const folded = deedState(root).all.find((d) => d.id === id);
  if (!folded || folded.status !== 'requested') return null;

  // The file supplies the words where it survives; the record supplies the rest.
  const f = path.join(at(root, 'deeds'), 'requested', `${id}.md`);
  const fromFile = fs.existsSync(f) ? frontmatter(fs.readFileSync(f, 'utf8')) : [{}, ''];
  return { ...fromFile[0], ...folded, body: (fromFile[1] || folded.body || '').trim() };
}

function existingDeedFolded(root, id) {
  const d = deedState(root).all.find((x) => x.id === id);
  return d && d.status === 'valid' ? d : null;
}

const holderOfPower = (root, power) => offices(root).find((o) => (o.powers || []).includes(power)) || null;

// ---- settlement ------------------------------------------------------------------

export async function settle(root, { dry = false } = {}) {
  const applied = [];
  const refused = [];
  const orders = [];
  const signatures = [];

  const setAside = (act, why) => {
    refused.push({ file: act._file, kind: act.kind, by: act.by, why });
    if (dry) return;
    const dir = at(root, 'refused');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, act._file), JSON.stringify({ ...act, _refused: { why, at: new Date().toISOString() } }, null, 2));
    fs.rmSync(act._path);
  };
  const done = (act) => {
    if (dry) return;
    const dir = at(root, 'settled');
    fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(act._path, path.join(dir, act._file));
  };

  for (const act of loadActs(root)) {
    const spec = KINDS[act.kind];
    if (!spec) { setAside(act, `unknown kind "${act.kind}"`); continue; }

    // art-02/§1/¶3 — a record whose author cannot be verified is not received.
    const v = await verify(actMessage(act), act.signature, keysOf(root, act.by), 'republic');
    if (!v.ok) { setAside(act, v.error); continue; }

    const why = spec.check(root, act);
    if (why) { setAside(act, why); continue; }

    if (act.kind === 'order') { orders.push(act); continue; }
    if (act.kind === 'contract.sign') { signatures.push(act); continue; }

    const out = spec.apply(root, act);
    if (!dry) append(root, { at: act.at, author: act.by, entity: out.entity, kind: out.kind, provision: spec.provision, payload: out.payload });
    applied.push({ what: out._what || spec.describe(root, act) });
    done(act);
  }

  // ---- the exchange -----------------------------------------------------
  //
  // Orders that do not fill REST: they stay pending, and are matched again next
  // time. Only a filled or cancelled order leaves the book, so a standing offer
  // stays standing until somebody takes it — art-10/§5/¶4.

  const cfg = config(root).value.exchange || {};
  const books = new Map();
  for (const o of orders) {
    if (!books.has(o.instrument)) books.set(o.instrument, []);
    books.get(o.instrument).push(o);
  }

  for (const [instrument, book] of books) {
    const { fills, cancelled, filled } = matchBook(book, {
      tradeAt: cfg.trade_at || 'resting',
      cancelRemainder: cfg.partial_fill_cancels_remainder !== false,
    });

    if (!fills.length) { applied.push({ what: `${instrument}: nothing crosses; ${book.length} order(s) rest` }); continue; }

    for (const f of fills) {
      const st = state(root);
      const held = (st.holdings.get(f.seller) || new Map()).get(instrument) || 0;
      const bal = st.balances.get(f.buyer) || 0;
      const cost = f.quantity * f.price;
      if (held < f.quantity) { refused.push({ kind: 'order.matched', why: `${f.seller} holds ${held} of ${instrument} at settlement, not ${f.quantity}` }); continue; }
      if (bal < cost) { refused.push({ kind: 'order.matched', why: `${f.buyer} holds ${bal} at settlement, and the trade costs ${cost}` }); continue; }
      if (!dry) append(root, { at: new Date().toISOString(), author: f.buyer, kind: 'order.matched', provision: 'art-10/§5/¶2',
        payload: { instrument, buyer: f.buyer, seller: f.seller, quantity: f.quantity, price: f.price, resting: f.resting } });
      applied.push({ what: `${f.seller} \u2192 ${f.buyer}  ${f.quantity} \u00d7 ${instrument} at ${f.price} (the resting ${f.resting} set the price)` });
    }

    // art-10/§5/¶4 — a cancellation is published like everything else.
    for (const c of cancelled) {
      if (!dry) append(root, { at: new Date().toISOString(), author: c.account, kind: 'order.cancelled', provision: 'art-10/§5/¶4',
        payload: { instrument, account: c.account, side: c.side, filled: c.filled, remainder: c.remainder, why: 'partly filled' } });
      applied.push({ what: `${c.account}: ${c.remainder} of ${c.quantity} cancelled \u2014 an order partly filled is not left half-alive` });
    }

    const gone = new Set([...filled, ...cancelled].map((o) => o._file));
    for (const o of book) if (gone.has(o._file)) done(o);
  }

  // ---- resolutions of entities -------------------------------------------
  //
  // Counted by the entity's own charter, and an officer resolution that carries
  // installs its winner as an organ — art-04/§3/¶2.

  for (const r of (await import('./governance.js')).resolutions(root)) {
    const done0 = path.join(resolutionDir(root, r.entity), r.id, '_result.json');
    const already = fs.existsSync(done0) ? JSON.parse(fs.readFileSync(done0, 'utf8')) : null;
    if (already && !already.open) continue;

    const result = countResolution(root, r);
    if (result.open) continue;
    if (!dry) writeResolutionResult(root, r, result);

    if (!result.carried) {
      applied.push({ what: `${r.entity}: ${r.id} did not carry (${result.cast} of ${result.electorate}, ${result.quorumNeeded} needed)` });
      if (!dry) append(root, { at: new Date().toISOString(), author: r.proposed_by, entity: r.entity, kind: 'resolution.failed', provision: 'art-04/§3/¶2', payload: { entity: r.entity, resolution: r.id } });
      continue;
    }

    if (r.kind === 'officer' && result.winner) {
      const file = path.join(at(root, 'entities'), `${r.entity}.yml`);
      const doc = yaml.load(fs.readFileSync(file, 'utf8'));
      const organs = doc.organs || [];
      const found = organs.find((o) => o.name === r.organ);
      if (found) found.held_by = [result.winner];
      else organs.push({ name: r.organ, held_by: [result.winner] });
      doc.organs = organs;
      if (!dry) fs.writeFileSync(file, yaml.dump(doc));
      if (!dry) append(root, { at: new Date().toISOString(), author: result.winner, entity: r.entity, kind: 'organ.filled', provision: 'art-04/§3/¶2', payload: { entity: r.entity, organ: r.organ, holder: result.winner, resolution: r.id } });
      applied.push({ what: `${r.entity}: ${result.winner} takes the ${r.organ} under ${r.id} — the charter confers its authority` });
      continue;
    }

    if (r.kind === 'charter') {
      const c = charterOf(root, r.entity);
      if (!dry && c) { fs.mkdirSync(path.dirname(c.file), { recursive: true }); fs.writeFileSync(c.file, r.body + '\n'); }
      if (!dry) append(root, { at: new Date().toISOString(), author: r.proposed_by, entity: r.entity, kind: 'charter.amended', provision: 'art-04/§3/¶1', payload: { entity: r.entity, resolution: r.id } });
      applied.push({ what: `${r.entity}: the charter is amended by ${r.id}` });
      continue;
    }

    if (!dry) append(root, { at: new Date().toISOString(), author: r.proposed_by, entity: r.entity, kind: 'resolution.carried', provision: 'art-04/§3/¶2', payload: { entity: r.entity, resolution: r.id, title: r.title } });
    applied.push({ what: `${r.entity}: ${r.id} carried — ${r.title}` });
  }

  // ---- contracts ------------------------------------------------------------
  // art-09/§7 — effective when every party has signed, and a signature covers
  // the text as it then stood.
  const byContract = new Map();
  for (const s of signatures) {
    if (!byContract.has(s.contract)) byContract.set(s.contract, []);
    byContract.get(s.contract).push(s);
  }
  for (const [id, sigs] of byContract) {
    const file = path.join(at(root, 'contracts'), `${id}.md`);
    const src = fs.readFileSync(file, 'utf8');
    const [meta] = frontmatter(src);
    if (meta.executed) { for (const s of sigs) setAside(s, `${id} is already executed`); continue; }

    const dir = path.join(at(root, 'contracts'), id);
    fs.mkdirSync(dir, { recursive: true });
    for (const s of sigs) { if (!dry) fs.writeFileSync(path.join(dir, `${s.party || s.by}.json`), JSON.stringify(s, null, 2)); done(s); }

    const held = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
    const parties = [].concat(meta.parties || []);
    const signed = new Set(held.map((s) => s.party || s.by));
    if (!parties.every((p) => signed.has(p))) {
      applied.push({ what: `${id} awaits ${parties.filter((p) => !signed.has(p)).join(', ')}` });
      continue;
    }

    const { sha256 } = await import('./hash.js');
    const digest = sha256(src);
    const stale = held.filter((s) => s.document !== digest);
    if (stale.length) {
      refused.push({ kind: 'contract.sign', why: `${id}: the text changed after ${stale.map((s) => s.party || s.by).join(', ')} signed — every signature is void (art-09/§7/¶3)` });
      continue;
    }
    if (!dry) {
      append(root, { at: new Date().toISOString(), author: meta.drafted_by || parties[0], kind: 'contract.executed', provision: 'art-09/§7/¶2', payload: { contract: id, parties, document: digest } });
      fs.writeFileSync(file, src.replace(/^---\n/, `---\nexecuted: ${new Date().toISOString().slice(0, 10)}\n`));
    }
    applied.push({ what: `${id} executed by ${parties.join(' and ')}` });
  }

  return { applied, refused };
}
