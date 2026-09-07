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
import { state, accounts, mayActFor, matchAuction, TREASURY } from './value.js';
import { corpus, frontmatter, isoDate } from './corpus.js';

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
      const e = entity(root, a.issuer);
      if (!e) return `no entity ${a.issuer}`;
      if (!config(root).entities[e.type]?.instruments) return `a ${e.type} may not issue instruments (art-04/§2/¶3)`;
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
      if (!accounts(root).has(a.account)) return `"${a.account}" is not an account`;
      if (!mayActFor(root, a.by, a.account)) return `${a.by} may not act for ${a.account}`;
      if (!['buy', 'sell'].includes(a.side)) return 'an order is a buy or a sell';
      if (!(a.quantity > 0) || !(a.price > 0)) return 'an order needs a positive quantity and price';
      return null;
    },
    apply: null,          // orders are held and cleared together, below
    describe: (root, a) => `${a.side} ${a.quantity} × ${a.instrument} at ${a.price}`,
  },

  'entity.form': {
    provision: 'art-04/§1/¶1',
    check(root, a) {
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

  'contract.sign': {
    provision: 'art-09/§7/¶2',
    check(root, a) {
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

  // ---- the exchange, one auction per instrument -----------------------------
  const books = new Map();
  for (const o of orders) {
    if (!books.has(o.instrument)) books.set(o.instrument, []);
    books.get(o.instrument).push(o);
  }
  for (const [instrument, book] of books) {
    const { cleared, fills } = matchAuction(book);
    if (!cleared) { applied.push({ what: `${instrument}: no price clears; the orders stand` }); continue; }
    for (const f of fills) {
      const s = state(root);
      const held = (s.holdings.get(f.seller) || new Map()).get(instrument) || 0;
      const bal = s.balances.get(f.buyer) || 0;
      if (held < f.quantity) { refused.push({ kind: 'order.matched', why: `${f.seller} holds ${held} at settlement` }); continue; }
      if (bal < f.quantity * f.price) { refused.push({ kind: 'order.matched', why: `${f.buyer} holds ${bal} at settlement` }); continue; }
      if (!dry) append(root, { at: new Date().toISOString(), author: f.buyer, kind: 'order.matched', provision: 'art-10/§5/¶2', payload: { instrument, ...f } });
      applied.push({ what: `${f.seller} → ${f.buyer}  ${f.quantity} × ${instrument} at ${f.price}` });
    }
    applied.push({ what: `${instrument}: cleared ${cleared.volume} at ${cleared.price}, one price for all (art-10/§5/¶2)` });
    for (const o of book) done(o);
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
