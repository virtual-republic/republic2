// Entities, value, contracts, settlement, and integrity.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import { at, config } from '../../core/config.js';
import { append, records, verifyChain, checkpoints, nextCheckpoint, writeCheckpoint, readLedger, hashRecord, GENESIS, merkleRoot, merkleProof, verifyProof } from '../../core/ledger.js';
import { canonical } from '../../core/canonical.js';
import { sign, verify } from '../../core/sshsig.js';
import { readKey } from '../../core/keys.js';
import { citizens, active, citizen, entities, entity, offices, holderOf } from '../../core/registry.js';
import { state, accounts, mayActFor, TREASURY } from '../../core/value.js';
import { writeAct, settle as runSettle, actMessage } from '../../core/acts.js';
import { corpus, frontmatter } from '../../core/corpus.js';
import { powersOf, charterOf, electorateOf, resolutions, resolution, countResolution } from '../../core/governance.js';
import { tally, closesAt } from '../../core/tally.js';
import { classOf } from '../../core/config.js';
import { classify } from '../../core/rules.js';
import { sha256 } from '../../core/hash.js';

const now = () => new Date().toISOString();
const salt = (n = 8) => crypto.randomBytes(n).toString('hex');

// Every act goes out the same door: sign it, write it, let settlement apply it.
async function offer(root, by, body) {
  const act = { ...body, by, at: now(), salt: salt() };
  act.signature = await sign(actMessage(act), await readKey(root, by), 'republic');
  const file = writeAct(root, act);
  console.log(`Signed ${act.kind}.`);
  console.log(`  ${path.relative(root, file)}`);
  console.log(`  settle it:  republic settle`);
  return act;
}

export const entityCmd = {
  group: 'Entities',
  summary: 'form and manage an entity',
  help: `  republic entity form --name "..." --type <type> --by <c-0001> [--under <P-0002>] [--organ role=c-0001]
  republic entity charter --entity <e-0001> --by <c-0001>       write or amend the charter
  republic entity members --entity <e-0001> --admit a,b --by <c-0001>
  republic entity organs  --entity <e-0001> --set role=a/b --by <c-0001>
  republic entity dissolve --entity <e-0001> --by <c-0001>
  republic entity powers --entity <e-0001>            what its charter allows
  republic entity resolve --entity <e-0001> --title "..." --by <c-0001> [--kind policy|officer|charter] [--organ director]
  republic entity vote --entity <e-0001> --resolution <R-0001> <yes|no|abstain|c-0002> --by <c-0001>
  republic entity resolutions --entity <e-0001>
  republic entity list`,
  async run({ root, arg, positional }) {
    const [sub] = positional;
    const types = config(root).entities;

    if (!sub || sub === 'list') {
      const all = entities(root);
      if (!all.length) console.log('No entities. Any citizen may form one — art-04/§1/¶1.');
      for (const e of all) console.log(`  ${e.id.padEnd(8)} ${String(e.type).padEnd(12)} ${e.name}${e.status !== 'active' ? '  — ' + e.status : ''}`);
      console.log('\nTypes:');
      for (const [k, t] of Object.entries(types)) console.log(`  ${k.padEnd(12)} ${t.formed_by === 'citizen' ? 'formed by any citizen as of right' : 'formed only on a carried measure, entered by the Registrar'}${t.instruments ? ' · may issue instruments' : ''}`);
      return 0;
    }

    // Reading what a charter allows asks nothing of anyone, so it needs no key.
    const readOnly = ['powers', 'resolutions'].includes(sub);
    const by = arg('by');
    if (!by && !readOnly) { console.error('--by <citizen> is required'); return 2; }

    if (readOnly) {
      const rid = arg('entity');
      if (!rid) { console.error('--entity <e-0001> is required'); return 2; }
      const re = entity(root, rid);
      if (!re) { console.error(`No entity ${rid}.`); return 1; }
      if (sub === 'powers') return showPowers(root, rid, re);
      return showResolutions(root, rid);
    }

    if (sub === 'form') {
      const name = arg('name'), type = arg('type', 'association');
      if (!name) { console.error('--name is required'); return 2; }
      if (!types[type]) { console.error(`Unknown type "${type}". Types: ${Object.keys(types).join(', ')}`); return 1; }
      const nums = entities(root).map((e) => Number(String(e.id).replace('e-', ''))).filter(Number.isFinite);
      const id = arg('id', 'e-' + String(Math.max(0, ...nums) + 1).padStart(4, '0'));
      const organs = (arg('organ') ? [arg('organ')] : []).concat(arg('organs') ? arg('organs').split(',') : [])
        .map((s) => { const [n, h] = s.split('='); return { name: n.trim(), held_by: (h || by).split('/').map((x) => x.trim()) }; });
      await offer(root, by, { kind: 'entity.form', entity: id, type, name, under: arg('under') || undefined, organs: organs.length ? organs : undefined, members: [by] });
      console.log(`\nOnce settled, write its charter:  republic entity charter --entity ${id} --by ${by}`);
      return 0;
    }

    const id = arg('entity');
    if (!id) { console.error('--entity <e-0001> is required'); return 2; }
    const e = entity(root, id);
    if (!e) { console.error(`No entity ${id}.`); return 1; }

    if (sub === 'charter') {
      const file = path.join(root, e.charter || `charters/${id}.md`);
      if (!fs.existsSync(file)) {
        // art-04/§3/¶1 — every entity has a charter. One created on the website
        // has none yet, because one commit creates one file.
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, defaultCharter(root, e));
        console.log(`${id} had no charter — art-04/§3/¶1 says it must have one.`);
        console.log(`Written a default to:\n  ${file}`);
        console.log(`\nIt exists only on this machine until you commit it.`);
        console.log(`Edit it, then run this again to sign the amendment.`);
        return 0;
      }
      await offer(root, by, { kind: 'entity.amend', entity: id, what: 'charter', text: fs.readFileSync(file, 'utf8') });
      return 0;
    }

    if (sub === 'members') {
      const admit = (arg('admit') || '').split(',').filter(Boolean);
      const remove = (arg('remove') || '').split(',').filter(Boolean);
      const roll = citizens(root).map((c) => c.id);
      for (const m of [...admit, ...remove]) if (!roll.includes(m)) { console.error(`${m} is not on the register.`); return 1; }
      if (!admit.length && !remove.length) { console.error('--admit or --remove'); return 2; }
      await offer(root, by, { kind: 'entity.amend', entity: id, what: admit.length ? 'members.admit' : 'members.remove', members: admit.length ? admit : remove });
      return 0;
    }

    if (sub === 'organs') {
      const spec = arg('set');
      if (!spec) { console.error('--set role=citizen,role=a/b'); return 2; }
      const organs = spec.split(',').map((x) => { const [n, h] = x.split('='); return { name: (n || '').trim(), held_by: (h || '').split('/').map((y) => y.trim()).filter(Boolean) }; }).filter((o) => o.name);
      await offer(root, by, { kind: 'entity.amend', entity: id, what: 'organs', organs });
      return 0;
    }

    if (sub === 'resolve') {
      const title = arg('title');
      if (!title) { console.error('--title says what is decided'); return 2; }
      const kind = arg('kind', 'policy');
      const existing = resolutions(root, id);
      const rid = arg('resolution', 'R-' + String(existing.length + 1).padStart(4, '0'));
      await offer(root, by, {
        kind: 'entity.resolve', entity: id, resolution: rid, title,
        resolutionKind: kind,
        ...(arg('organ') ? { organ: arg('organ') } : {}),
        ...(arg('candidates') ? { candidates: arg('candidates').split(',').map((x) => x.trim()) } : {}),
        text: arg('text') || undefined,
      });
      const p = powersOf(root, id);
      console.log(`\n  ${id} decides by ${p.vote === 'members' ? 'its members, one vote each' : 'its shares'}; quorum ${(p.quorum * 100).toFixed(0)}%, threshold ${(p.threshold * 100).toFixed(0)}%.`);
      return 0;
    }

    if (sub === 'vote') {
      const rid = arg('resolution');
      const choice = positional[1];
      if (!rid || !choice) { console.error('republic entity vote --entity <e-0001> --resolution <R-0001> <choice> --by <citizen>'); return 2; }
      await offer(root, by, { kind: 'entity.vote', entity: id, resolution: rid, choice });
      return 0;
    }

    if (sub === 'dissolve') {
      await offer(root, by, { kind: 'entity.amend', entity: id, what: 'dissolve' });
      return 0;
    }

    console.error('republic entity <form|charter|members|organs|dissolve|list>');
    return 2;
  },
};

function showPowers(root, id, e) {
  const p = powersOf(root, id);
  const c = charterOf(root, id);
  console.log(`${id} — ${e.name} (${p.type})\n`);
  console.log(`  charter        ${c.missing ? 'MISSING — art-04/§3/¶1 requires one' : path.relative(root, c.file)}`);
  console.log(`  may issue      ${p.instruments ? 'yes' : 'no'}`);
  console.log(`  listed         ${p.listed ? 'yes — its instruments may be traded' : 'no — private; shares transfer directly, not on the exchange'}`);
  console.log(`  votes by       ${p.vote === 'members' ? 'members, one each' : 'shares, weighted by holding'}`);
  console.log(`  quorum         ${(p.quorum * 100).toFixed(0)}%`);
  console.log(`  threshold      ${(p.threshold * 100).toFixed(0)}%`);
  console.log(`  officer term   ${p.term} days`);
  console.log(`\n  organs         ${(p.organs || []).map((o) => `${o.name}=${(o.held_by || []).join('/')}`).join(', ') || 'none'}`);
  console.log(`  members        ${(p.members || []).join(', ') || 'none'}`);
  const roll = electorateOf(root, id);
  console.log(`\n  who may vote (${roll.length}):`);
  for (const v of roll) console.log(`    ${v.id.padEnd(10)} weight ${v.weight}`);
  if (!roll.length) console.log('    nobody yet');
  return 0;
}

function showResolutions(root, id) {
  const all = resolutions(root, id);
  if (!all.length) { console.log(`No resolutions of ${id}.`); return 0; }
  for (const r of all) {
    const res = countResolution(root, r);
    console.log(`  ${r.id}  ${r.title}`);
    console.log(`      ${r.kind}${r.organ ? ' (' + r.organ + ')' : ''} · ${res.cast} of ${res.electorate} by ${res.vote}, ${res.quorumNeeded} needed · ${
      res.open ? 'open until ' + r.closes : res.carried ? (res.winner ? 'carried — ' + res.winner : 'carried') : 'not carried'}`);
  }
  return 0;
}

function defaultCharter(root, e) {
  const type = config(root).entities[e.type] || {};
  const g = type.governance || {};
  const organs = e.organs || [{ name: 'convenor', held_by: [] }];
  const marks = '¹²³⁴⁵⁶⁷⁸⁹';

  // The front matter is read by the tools. It may narrow what the type allows
  // and never widen it — art-04/§3/¶3.
  const front = {
    id: e.id, type: e.type, title: e.name, formed: e.formed,
    ...(type.instruments ? { instruments: true, listed: type.listed_by_default ?? false } : {}),
    governance: { vote: g.vote || 'members', quorum: g.quorum ?? 0.5, threshold: g.threshold ?? 0.5, term: g.term ?? 365 },
  };

  const votes = front.governance.vote === 'shares'
    ? 'Each holder votes in proportion to the instruments they hold.'
    : 'Each member has one vote, whatever they hold.';

  return `---
${yaml.dump(front).trim()}
---

## § 1  Name and type

¹ The entity is named ${e.name}.

² It is a ${e.type}, formed under Article 4 § 1.

## § 2  Purpose

¹ The purpose of the entity is stated by its members and may be altered by them.

## § 3  Membership

¹ Membership is open to any citizen on application to an organ named in § 5.

² ${front.governance.vote === 'members'
    ? 'Every member is a coequal member. Admission confers the same standing as every other member holds, and no member has more.'
    : 'Membership is by holding. A person who holds an instrument of the entity is a member to the extent of that holding.'}

³ A member may withdraw at any time by a signed record.

## § 4  Decisions

¹ ${votes}

² A resolution carries when ${(front.governance.quorum * 100).toFixed(0)} per cent of the vote is cast and ${(front.governance.threshold * 100).toFixed(0)} per cent of the decisive votes are in favour.

³ These figures are those in the front matter of this charter, and the tools read them there. Altering them here without altering them there changes nothing.

⁴ A resolution is proposed, voted and recorded like any other act of the Republic, and is published.

## § 5  Organs

${organs.map((o, i) => `${marks[i] || i + 1} The ${o.name} is held by ${(o.held_by || []).join(', ') || 'no one at present'}, and acts for the entity within the authority this charter confers and no further — Article 4 § 3 ².`).join('\n\n')}

${marks[organs.length] || organs.length + 1} An organ is filled by a resolution of the kind "officer", and is held for ${front.governance.term} days.

## § 6  Instruments

¹ ${type.instruments
    ? `The entity may issue instruments representing a share in itself — Article 10 § 4 ¹. It is ${front.listed ? 'listed: those instruments may be traded on the exchange' : 'NOT listed: its instruments exist and may be transferred directly, but are not traded on the exchange'}.`
    : `A ${e.type} may not issue instruments — Article 4 § 2 ³. This charter cannot grant what the type withholds.`}

² ${type.instruments ? 'Listing is changed by amending the "listed" field of this charter, which is a resolution of the kind "charter".' : ''}

## § 7  Consistency

¹ This charter is subordinate to the Constitution, and any provision inconsistent with it is of no effect — Article 4 § 3 ³.

² It may narrow what the entity's type allows. It may never widen it.

## § 8  Dissolution

¹ The entity is dissolved by resolution of its members, by the procedure in this charter, or by judgment of the Court.

² On dissolution its holdings pass to the Treasury, unless the resolution provides otherwise — Article 4 § 4 ².
`;
}

export const issue = {
  group: 'Value',
  summary: 'issue the unit, or a share in an entity',
  help: `  republic issue --unit 50000 --under <P-0002> --by <c-0001> [--to treasury]
  republic issue --instrument <e-0001> --quantity 1000 --by <c-0001> [--class ordinary] [--to e-0001]

art-10/§2/¶1 — the unit is issued only by the Treasurer, only under a resolution
that has carried, and only in the amount it states.`,
  async run({ root, arg }) {
    const by = arg('by');
    if (!by) { console.error('--by <citizen> is required'); return 2; }
    if (arg('unit')) {
      await offer(root, by, { kind: 'value.issue', amount: Number(arg('unit')), to: arg('to', TREASURY), resolution: arg('under') });
      return 0;
    }
    if (arg('instrument')) {
      await offer(root, by, { kind: 'instrument.issue', issuer: arg('instrument'), class: arg('class', 'ordinary'), quantity: Number(arg('quantity')), to: arg('to') || arg('instrument') });
      return 0;
    }
    console.error('republic issue --unit <n> --under <measure> --by <citizen>  |  --instrument <e-0001> --quantity <n> --by <citizen>');
    return 2;
  },
};

export const pay = {
  group: 'Value',
  summary: 'transfer the unit, or an instrument',
  help: `  republic pay --from <account> --to <account> --amount 250 --by <c-0001>
  republic pay --from <account> --to <account> --instrument e-0001:ordinary --quantity 10 --by <c-0001>`,
  async run({ root, arg }) {
    const from = arg('from'), to = arg('to'), by = arg('by', from);
    if (!from || !to) { console.error('--from and --to are required'); return 2; }
    if (arg('amount')) { await offer(root, by, { kind: 'value.transfer', from, to, amount: Number(arg('amount')), note: arg('note') || undefined }); return 0; }
    if (arg('instrument')) { await offer(root, by, { kind: 'instrument.transfer', from, to, instrument: arg('instrument'), quantity: Number(arg('quantity')) }); return 0; }
    console.error('give --amount, or --instrument and --quantity');
    return 2;
  },
};

export const order = {
  group: 'Value',
  summary: 'place an order on the exchange',
  help: `  republic order --side buy|sell --instrument e-0001:ordinary --quantity 10 --price 25 --by <c-0001> [--account <a>]

art-10/§5/¶2 — an order does not execute on arrival. It joins the book and clears
at the next auction, at one price for everyone.`,
  async run({ root, arg }) {
    const by = arg('by');
    if (!by) { console.error('--by <citizen> is required'); return 2; }
    await offer(root, by, { kind: 'order', side: arg('side'), instrument: arg('instrument'), quantity: Number(arg('quantity')), price: Number(arg('price')), account: arg('account', by) });
    return 0;
  },
};

export const contract = {
  group: 'Contracts',
  summary: 'draft, sign and list contracts',
  help: `  republic contract draft --title "..." --parties a,b --by <c-0001> [--terms "..."]
  republic contract sign --id <slug> --by <c-0001>
  republic contract list

art-09/§7 — a contract takes effect when every party has signed. A signature
covers the text as it then stands; an alteration afterwards voids every one.`,
  async run({ root, arg, positional }) {
    const [sub] = positional;
    const dir = at(root, 'contracts');

    if (!sub || sub === 'list') {
      if (!fs.existsSync(dir)) { console.log('No contracts.'); return 0; }
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
        const [meta] = frontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
        const sigDir = path.join(dir, meta.id);
        const signed = fs.existsSync(sigDir) ? fs.readdirSync(sigDir).map((x) => path.basename(x, '.json')) : [];
        console.log(`  ${meta.id}  ${meta.title}`);
        console.log(`      ${[].concat(meta.parties || []).map((p) => p + (signed.includes(p) ? ' ✓' : ' —')).join('  ')}${meta.executed ? '  executed ' + meta.executed : ''}`);
      }
      return 0;
    }

    if (sub === 'draft') {
      const title = arg('title'), by = arg('by');
      const parties = (arg('parties') || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!title || !by || parties.length < 2) { console.error('republic contract draft --title "..." --parties a,b --by <citizen>'); return 2; }
      const acct = accounts(root);
      for (const p of parties) if (!acct.has(p)) { console.error(`"${p}" is not an account.`); return 1; }
      if (!parties.some((p) => mayActFor(root, by, p))) { console.error(`${by} is not a party and acts for none of them.`); return 1; }

      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${id}.md`);
      if (fs.existsSync(file)) { console.error(`${id} already exists.`); return 1; }
      const expires = new Date(Date.now() + config(root).contracts.expiry * 86400000).toISOString().slice(0, 10);
      fs.writeFileSync(file, `---\n${yaml.dump({ id, title, parties, drafted_by: by, drafted: now().slice(0, 10), expires }).trim()}\n---\n\n## § 1  Parties\n\n¹ This contract is between ${parties.join(' and ')}.\n\n## § 2  Terms\n\n¹ ${arg('terms') || 'The terms are as the parties agree and as set out below.'}\n\n## § 3  Effect\n\n¹ This contract takes effect when every party has signed it — Article 9 § 7 ².\n\n² A signature covers the text as it then stands; an alteration afterwards voids every signature given — Article 9 § 7 ³.\n`);
      console.log(`Drafted ${id}. Edit contracts/${id}.md, then each party signs:`);
      console.log(`  republic contract sign --id ${id} --by <citizen>`);
      return 0;
    }

    if (sub === 'sign') {
      const id = arg('id'), by = arg('by');
      if (!id || !by) { console.error('republic contract sign --id <slug> --by <citizen>'); return 2; }
      const file = path.join(dir, `${id}.md`);
      if (!fs.existsSync(file)) { console.error(`No contract ${id}.`); return 1; }
      const [meta] = frontmatter(fs.readFileSync(file, 'utf8'));
      const party = [].concat(meta.parties || []).find((p) => mayActFor(root, by, p));
      if (!party) { console.error(`${by} is not a party to ${id}.`); return 1; }
      await offer(root, by, { kind: 'contract.sign', contract: id, party, document: sha256(fs.readFileSync(file, 'utf8')) });
      return 0;
    }

    console.error('republic contract <draft|sign|list>');
    return 2;
  },
};

export const deed = {
  group: 'Deeds',
  summary: 'request, recognise, refuse and transfer recognised title',
  help: `  republic deed request --id <slug> --title "..." --by <c-0001> [--kind property] [--transferable] [--holder <account>] [--text "..."]
  republic deed recognise --id <slug> --by <keeper> [--holder <account>] [--transferable] [--title "..."]
  republic deed refuse --id <slug> --by <keeper> --reasons "..."
  republic deed transfer --id <slug> --to <account> --by <holder>
  republic deed list

art-05/§2/¶2 — a deed is valid only when the Keeper has recognised it and it is
published in the Journal. Recognition and publication are one act.

Anyone may ask. Only the holder of deed.recognise may recognise, and may do so
directly without a request. A deed is transferable only if it says so.`,
  async run({ root, arg, flag, positional }) {
    const [sub] = positional;
    const dir = at(root, 'deeds');

    if (!sub || sub === 'list') {
      const live = corpus(root).deeds;
      const reqDir = path.join(dir, 'requested');
      const asked = fs.existsSync(reqDir)
        ? fs.readdirSync(reqDir).filter((f) => f.endsWith('.md')).map((f) => frontmatter(fs.readFileSync(path.join(reqDir, f), 'utf8'))[0])
        : [];
      if (!live.length && !asked.length) { console.log('No deeds, and nothing requested.'); return 0; }
      if (live.length) {
        console.log('Recognised — valid (art-05/§2/¶2):\n');
        for (const d of live) console.log(`  deed.${String(d.id).padEnd(24)} ${String(d.kind || '').padEnd(11)} held by ${String(d.holder).padEnd(10)} ${d.transferable ? 'transferable' : 'not transferable'}   Journal ${d.journal}`);
      }
      const pending = asked.filter((d) => d.status === 'requested');
      const refused = asked.filter((d) => d.status === 'refused');
      if (pending.length) {
        console.log(`\nRequested — not valid until recognised:\n`);
        for (const d of pending) console.log(`  ${String(d.id).padEnd(24)} ${d.title}  (asked by ${d.requested_by})`);
        const who = offices(root).find((o) => (o.powers || []).includes('deed.recognise'));
        console.log(`\n  ${who ? who.title + ' is ' + who.holder : 'Nobody holds deed.recognise'}:  republic deed recognise --id <slug> --by ${who ? who.holder : '<keeper>'}`);
      }
      if (refused.length) {
        console.log(`\nRefused:\n`);
        for (const d of refused) console.log(`  ${String(d.id).padEnd(24)} ${d.reasons}`);
      }
      return 0;
    }

    const by = arg('by');
    const id = arg('id');
    if (!by || !id) { console.error('--id and --by are required'); return 2; }

    if (sub === 'request') {
      const title = arg('title');
      if (!title) { console.error('--title says what is claimed'); return 2; }
      await offer(root, by, { kind: 'deed.request', deed: id, title, deedKind: arg('kind', 'property'),
        holder: arg('holder', by), transferable: flag('transferable'), text: arg('text') || undefined });
      console.log(`\nIt confers nothing until the Keeper recognises it — art-05/§2/¶2.`);
      return 0;
    }
    if (sub === 'recognise') {
      await offer(root, by, { kind: 'deed.recognise', deed: id,
        ...(arg('holder') ? { holder: arg('holder') } : {}),
        ...(arg('title') ? { title: arg('title') } : {}),
        ...(arg('kind') ? { deedKind: arg('kind') } : {}),
        ...(flag('transferable') ? { transferable: true } : {}),
        text: arg('text') || undefined });
      return 0;
    }
    if (sub === 'refuse') {
      if (!arg('reasons')) { console.error('--reasons is required; a refusal states them'); return 2; }
      await offer(root, by, { kind: 'deed.refuse', deed: id, reasons: arg('reasons') });
      return 0;
    }
    if (sub === 'transfer') {
      if (!arg('to')) { console.error('--to <account>'); return 2; }
      await offer(root, by, { kind: 'deed.transfer', deed: id, to: arg('to') });
      return 0;
    }
    console.error('republic deed <request|recognise|refuse|transfer|list>');
    return 2;
  },
};

export const settle = {
  group: 'Value',
  summary: 'verify every pending act and record what holds',
  help: `  republic settle [--dry-run]

Every signed instrument is checked here and nowhere else. A refusal is an outcome,
not a failure: the instrument is set aside in refused/ with the reason beside it.`,
  async run({ root, flag }) {
    const { applied, refused } = await runSettle(root, { dry: flag('dry-run') });
    for (const a of applied) console.log(`  ✓ ${a.what}`);
    for (const r of refused) console.log(`  ✗ ${r.file || r.kind} — ${r.why}`);
    if (!applied.length && !refused.length) console.log('Nothing pending.');
    else console.log(`\n${applied.length} applied, ${refused.length} refused${flag('dry-run') ? ' (dry run)' : ''}.`);
    return 0;   // a refusal is not a failed build
  },
};

export const value = {
  group: 'Value',
  summary: 'what the ledger says anyone holds',
  help: `  republic value              every account
  republic value <account>    one account, and every record that touched it
  republic value --accounts   who may hold value at all`,
  async run({ root, positional, flag }) {
    const s = state(root);
    const acct = accounts(root);
    const unit = config(root).value.unit;

    if (flag('accounts')) {
      for (const [id, m] of acct) console.log(`  ${id.padEnd(12)} ${m.kind}${m.organs?.length ? '  organs: ' + m.organs.map((o) => `${o.name}=${(o.held_by || []).join('/')}`).join(', ') : ''}`);
      return 0;
    }

    const who = positional[0];
    if (who) {
      if (!acct.has(who)) {
        console.error(`"${who}" is not an account.`);
        console.error(`Accounts: ${[...acct.keys()].join(', ')}`);
        console.error('A citizenship must be active, and an entity must be of a type that may hold one.');
        return 1;
      }
      const held = [...(s.holdings.get(who) || new Map())].filter(([, q]) => q > 0);
      console.log(`  ${who}  ${s.balances.get(who) || 0} ${unit}${held.length ? '   ' + held.map(([i, q]) => `${q} × ${i}`).join(', ') : ''}\n`);
      for (const e of records(root)) {
        const p = e.payload || {};
        if ([p.to, p.from, p.buyer, p.seller].includes(who)) console.log(`  ${e.at.slice(0, 16).replace('T', ' ')}  ${e.kind.padEnd(24)} ${JSON.stringify(p)}`);
      }
      return 0;
    }

    console.log(`Issued in total: ${s.issued} ${unit}\n`);
    for (const id of acct.keys()) {
      const held = [...(s.holdings.get(id) || new Map())].filter(([, q]) => q > 0);
      console.log(`  ${id.padEnd(12)} ${String(s.balances.get(id) || 0).padStart(8)} ${unit}${held.length ? '   ' + held.map(([i, q]) => `${q} × ${i}`).join(', ') : ''}`);
    }
    if (s.instruments.size) {
      console.log('\nInstruments:');
      for (const [i, m] of s.instruments) console.log(`  ${i.padEnd(24)} ${m.issued} issued by ${m.issuer}`);
    }
    return 0;
  },
};

export const checkpoint = {
  group: 'Integrity',
  summary: 'sign a checkpoint attesting the register',
  help: `  republic checkpoint [--by <c-0001>]

art-02/§3/¶2 — a checkpoint at intervals of not more than one week, verifiable
by any person without permission and without an account.`,
  async run({ root, arg }) {
    const chain = verifyChain(root);
    if (!chain.ok) { console.error('Refusing: the register does not verify. Run: republic doctor'); return 1; }
    const keeper = holderOf(root, 'checkpoint.sign');
    const by = arg('by', keeper?.holder);
    if (!by) { console.error('Nobody holds checkpoint.sign.'); return 1; }
    const cp = nextCheckpoint(root);
    cp.signature = await sign(canonical(cp), await readKey(root, by), 'republic-checkpoint');
    const file = writeCheckpoint(root, cp);
    console.log(`Checkpoint ${cp.number}: ${cp.records} records, root ${cp.root.slice(0, 16)}…`);
    console.log(`  ${path.relative(root, file)}`);
    return 0;
  },
};

export const verifyCmd = {
  group: 'Integrity',
  summary: 'check the register, without permission or a network',
  help: `  republic verify

Needs nothing but this repository. Anyone who runs it is a monitor — art-05/§4/¶2.`,
  async run({ root }) {
    let bad = 0;
    const ok = (m) => console.log(`  ✓ ${m}`);
    const no = (m) => { console.log(`  ✗ ${m}`); bad++; };

    const chain = verifyChain(root);
    console.log('\nRegister\n');
    if (chain.ok) ok(`${chain.count} records, chain intact, head ${chain.head.slice(0, 16)}…`);
    else { no(`${chain.problems.length} problem(s)`); for (const p of chain.problems.slice(0, 6)) console.log(`      ${p.error}`); }

    console.log('\nCheckpoints\n');
    const rs = records(root);
    const leaves = rs.map((e) => e.hash);
    const keeperKeys = fs.existsSync(at(root, 'keepers')) ? fs.readFileSync(at(root, 'keepers'), 'utf8').split('\n').filter(Boolean) : [];
    let expected = GENESIS;
    const list = checkpoints(root);
    if (!list.length) console.log('  (none published yet)');
    for (const c of list) {
      const label = `checkpoint ${c.number} (${c.records} records)`;
      if (c.previous !== expected) no(`${label}: does not follow the one before it`);
      else if (c.records > rs.length) no(`${label}: attests more records than the register holds`);
      else if (merkleRoot(leaves.slice(0, c.records)) !== c.root) no(`${label}: the root does not match`);
      else ok(`${label}: the root matches`);
      if (c.signature) {
        const { signature, ...body } = c;
        const v = await verify(canonical(body), signature, keeperKeys, 'republic-checkpoint');
        v.ok ? ok('  signed by the Keeper') : no(`  signature: ${v.error}`);
      }
      expected = c.root;
    }

    console.log('\nInclusion\n');
    if (rs.length) {
      const i = Math.floor(rs.length / 2);
      const p = merkleProof(leaves, i);
      verifyProof(leaves[i], p, merkleRoot(leaves))
        ? ok(`record ${i + 1} proves inclusion in ${p.length} steps`)
        : no('the inclusion proof failed');
    }

    console.log(`\n${bad ? `${bad} failure(s).` : 'The Republic verifies.'}\n`);
    return bad ? 1 : 0;
  },
};

export const doctor = {
  group: 'Integrity',
  summary: 'diagnose damage, and repair what can be repaired',
  help: `  republic doctor [--repair]

A merge can damage the register without anyone deciding to. That is damage, not
an alteration under art-02/§2 — but it must be found, reported and repaired in
the open. The ledger only grows, so a conflict means both sides are real records.`,
  async run({ root, flag }) {
    const repair = flag('repair');
    const problems = [];
    const file = at(root, 'ledger');
    console.log('Examining the register.\n');

    let { records: rs, damage } = readLedger(root);
    console.log(`  ${rs.length} record(s) read, ${damage.length} damaged line(s)`);

    if (damage.length) {
      const conflicts = damage.filter((d) => d.kind === 'conflict');
      problems.push(conflicts.length
        ? { what: `${conflicts.length} conflict marker(s) in the ledger`, fix: 'both sides are genuine records; --repair keeps both and re-chains' }
        : { what: `${damage.length} unparsable line(s)`, fix: 'repair them by hand' });

      if (!repair) {
        report(problems);
        console.log('\nA damaged ledger cannot be read at all, so nothing else can be checked.');
        console.log('  republic doctor --repair');
        return 1;
      }
      if (damage.some((d) => d.kind === 'unparsable')) { report(problems); console.error('\nRefusing: fix the unparsable lines by hand first.'); return 1; }

      fs.copyFileSync(file, file + '.with-conflict');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').filter((l) => !/^(<{7}|={7}|>{7})/.test(l)).join('\n'));
      console.log('  conflict markers removed, both sides kept');
      ({ records: rs } = readLedger(root));
      console.log(`  ${rs.length} record(s) recovered`);
      problems.length = 0;
    }

    const seen = new Set();
    const dupes = rs.filter((e) => (seen.has(e.hash) ? true : (seen.add(e.hash), false)));
    if (dupes.length) problems.push({ what: `${dupes.length} record(s) appear more than once`, fix: '--repair removes the duplicates' });

    const chain = verifyChain(root);
    if (!chain.ok) problems.push({ what: `${chain.problems.length} break(s) in the hash chain`, fix: '--repair re-chains every record, keeping its content exactly' });
    else console.log('  chain intact');

    const leaves = rs.map((e) => e.hash);
    for (const c of checkpoints(root)) {
      if (c.records > rs.length) problems.push({ what: `checkpoint ${c.number} attests ${c.records} records but the register holds ${rs.length}`, fix: '--repair reissues the checkpoints' });
      else if (merkleRoot(leaves.slice(0, c.records)) !== c.root) problems.push({ what: `checkpoint ${c.number} does not match the register`, fix: '--repair reissues the checkpoints' });
    }

    if (!problems.length) { console.log('\nNothing is wrong. The register verifies.'); return 0; }
    report(problems);
    if (!repair) { console.log('\n  republic doctor --repair'); console.log('Nothing is changed until you ask for it.'); return 1; }

    console.log('\nRepairing.\n');
    fs.copyFileSync(file, file + '.before-repair');
    const keep = [];
    const fp = new Set();
    for (const e of rs) {
      const f = canonical({ at: e.at, author: e.author, entity: e.entity, kind: e.kind, provision: e.provision, payload: e.payload });
      if (fp.has(f)) continue;
      fp.add(f); keep.push(e);
    }
    keep.sort((a, b) => String(a.at).localeCompare(String(b.at)));

    let prev = GENESIS;
    const out = keep.map((e, i) => {
      const body = { seq: i + 1, at: e.at, author: e.author, entity: e.entity, kind: e.kind, provision: e.provision, payload: e.payload, prev };
      const hash = hashRecord(prev, body);
      prev = hash;
      return JSON.stringify({ ...body, hash });
    });
    fs.writeFileSync(file, out.join('\n') + '\n');
    console.log(`  ${rs.length} in, ${keep.length} kept, ${rs.length - keep.length} duplicate(s) removed`);
    console.log('  re-chained in time order; the previous file is kept beside it');

    const stale = checkpoints(root);
    if (stale.length) {
      fs.rmSync(at(root, 'checkpoints'), { recursive: true, force: true });
      fs.mkdirSync(at(root, 'checkpoints'), { recursive: true });
      console.log(`  ${stale.length} checkpoint(s) removed — they attested a register that no longer exists`);
      console.log('  reissue one:  republic checkpoint');
    }
    console.log('\nSay in the commit message what was repaired.');
    return 0;

    function report(list) {
      console.log(`\n${list.length} problem(s):\n`);
      for (const p of list) console.log(`  ✗ ${p.what}\n      ${p.fix}`);
    }
  },
};

export const gate = {
  group: 'Integrity',
  summary: 'what a change requires, and whether it has it',
  help: `  republic gate [--base origin/main] [--measure P-0002] [--approvers a,b] [--after-the-fact]

art-08/§7 — a change to the tools, the settings or the procedure is a measure of
the class the settings fix for it. This says which, and whether that measure
carried. --after-the-fact judges what has already landed.`,
  async run({ root, arg, flag }) {
    const retrospective = flag('after-the-fact');
    const base = arg('base', retrospective ? 'HEAD~1' : 'origin/main');
    let changed = [];
    try { changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean); }
    catch { try { changed = execFileSync('git', ['diff', '--name-only', base], { cwd: root, encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean); } catch { changed = []; } }

    if (!changed.length) { console.log('Nothing changed.'); return 0; }
    const { need, governed } = classify(changed);
    console.log(`Changed: ${changed.length} file(s)\n`);
    if (!need) { console.log('No governed path touched. No measure required.'); for (const c of changed) console.log(`  · ${c}`); return 0; }

    const spec = config(root).classes[need];
    console.log(`This requires a measure of class "${need}" (${spec.label}):\n`);
    for (const g of governed) console.log(`  ${g.path}\n      ${g.why}`);

    const hay = [arg('measure'), process.env.PR_TITLE, process.env.PR_BODY, process.env.GITHUB_HEAD_REF].filter(Boolean).join(' ');
    const found = hay.match(/\bP-\d{4}\b/);
    if (!found) return fail(['No measure is cited.', 'Name it in the pull request title or body, or pass --measure.', 'art-02/§4/¶1 — every act cites the provision under which it is made.']);

    const id = found[0];
    const m = corpus(root).measures.find((x) => x.id === id);
    if (!m) return fail([`${id} is not among the measures.`]);
    if (m.class !== need) return fail([`${id} is of class "${m.class}", but this requires "${need}".`, 'A measure cannot enact more than the class it was voted under.']);

    // art-08/§4/¶5 — the tally is performed by the published tool, and the
    // tool's result is the result. So COUNT, rather than believe a file.
    //
    // ballots/ is exempt from the gate, because recording a vote cannot itself
    // require a vote. That means a pull request could carry both a change to the
    // law and a _result.json saying it carried. Reading that file would let a
    // measure nobody voted on enact anything. Counting the signed ballots
    // instead closes it: a ballot not verified against a registered key is not
    // counted (art-08/§3/¶2), and forging one means forging a signature.
    const dir = path.join(at(root, 'ballots'), id);
    const ballots = {};
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json') || f.startsWith('_')) continue;
        try { ballots[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch {}
      }
    }
    if (!Object.keys(ballots).length) return fail([`${id} has no ballots. Nothing has been voted on.`]);

    const mSpec = classOf(root, m.class);
    const r = await tally({
      measure: id, spec: mSpec, ballots, roll: active(root),
      closes: closesAt(m, mSpec)?.toISOString() ?? null,
      closeRules: config(root).ballot.close_early,
    });

    console.log(`\nCounted here, from the signed ballots: ${r.cast} of ${r.electorate} cast, ${r.quorumNeeded} needed.`);
    for (const x of r.rejected) console.log(`  not counted — ${x.id}: ${x.why}`);

    if (!r.carried) {
      return fail([
        `${id} ${r.open ? 'is still open' : 'did not carry'} on the ballots actually cast.`,
        'art-08/§5/¶1 — a measure that carries is enacted; this one has not.',
      ]);
    }

    // If a result file is present and disagrees with the count, say so. One of
    // them is wrong, and the count is the one that governs.
    const rf = path.join(dir, '_result.json');
    if (fs.existsSync(rf)) {
      try {
        const claimed = JSON.parse(fs.readFileSync(rf, 'utf8'));
        if (claimed.carried !== r.carried || claimed.cast !== r.cast) {
          return fail([
            `The recorded result for ${id} does not match the ballots.`,
            `It claims ${claimed.cast} ballot(s) and carried=${claimed.carried}; counting gives ${r.cast} and ${r.carried}.`,
            'art-08/§4/¶5 — the tally is performed by the published tool, and the tool\u2019s result is the result.',
          ]);
        }
      } catch { return fail([`The recorded result for ${id} cannot be read.`]); }
    }

    // art-08/§1/¶5 — where a measure names the change it authorises, it enacts
    // that change and no other.
    if (m.authorises) {
      const named = String(m.authorises).replace(/["']/g, '').split(/[,\s]+/).filter(Boolean);
      const pr = process.env.PR_NUMBER || '';
      const sha = process.env.PR_HEAD_SHA || process.env.GITHUB_SHA || '';
      const matched = named.some((n) => { const b = n.replace(/^#/, ''); return (pr && b === pr) || (sha && sha.startsWith(b)); });
      console.log(`\n${id} authorises: ${named.join(', ')}`);
      console.log(`This change is: pull request ${pr || '(none)'}${sha ? ', commit ' + sha.slice(0, 10) : ''}`);
      if (!matched) return fail([`${id} authorises ${named.join(', ')}, which is not this change.`, 'A measure enacts what it named and nothing else (art-08/§1/¶5).']);
      console.log(`✓ this is the change ${id} authorised.`);
    }

    // art-08/§7/¶2 — and the holder of the power to approve must confirm that
    // what is being made effective is what carried.
    const approvers = (arg('approvers') || process.env.APPROVERS || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    const office = holderOf(root, 'code.approve');
    const holder = office ? citizen(root, office.holder) : null;
    const account = holder?.github || null;

    if (office && account) {
      console.log(`\n${office.title}: ${office.holder} (${account})`);
      console.log(`Approved by: ${approvers.join(', ') || '(nobody yet)'}`);
      if (!approvers.map((a) => a.toLowerCase()).includes(String(account).toLowerCase())) {
        return fail([
          `This awaits the ${office.title}'s approval (art-08/§7/¶2).`,
          'The Assembly decides what the law is; the Keeper confirms that what is',
          'being made effective is what the Assembly carried.',
        ]);
      }
      console.log(`\u2713 approved by the ${office.title}.`);
    } else if (office) {
      console.log(`\n${office.title} is ${office.holder}, but no forge account is recorded, so approval cannot bind yet.`);
      console.log(`Add "github: <login>" to register/citizens/${office.holder}.yml.`);
    }

    console.log(`\n${id} carried. This change may be enacted (art-08/§5/¶1).`);
    return 0;

    function fail(lines) {
      console.error(retrospective ? '\nUNGATED — this landed without the measure it required:' : '\nNot enacted:');
      for (const l of lines) console.error(`  ${l}`);
      return 1;
    }
  },
};

export const approve = {
  group: 'Integrity',
  summary: 'who approves a change to the tools, and whether they have',
  help: `  republic approve [--approvers a,b] [--who]

art-08/§7/¶2 — a change is given effect only after the holder of the power to
approve has confirmed that what is being made effective is what carried.`,
  async run({ root, arg, flag }) {
    const office = holderOf(root, 'code.approve');
    if (!office) { console.log('Nobody holds the power to approve, so no approval can be required (art-06/§3/¶4).'); return 0; }
    const c = citizen(root, office.holder);
    const account = c?.github || null;

    if (flag('who') || !arg('approvers')) {
      console.log(`${office.title}: ${office.holder}${account ? ` (${account})` : ' — no forge account recorded'}`);
      if (!account) console.log(`Add "github: <login>" to register/citizens/${office.holder}.yml to make this check bind.`);
      return 0;
    }
    if (!account) { console.log(`${office.holder} holds the power to approve, but no forge account is recorded, so this cannot bind yet.`); return 0; }

    const approvers = arg('approvers').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    console.log(`${office.title}: ${office.holder} (${account})`);
    console.log(`Approved by: ${approvers.join(', ') || '(nobody yet)'}`);
    if (approvers.map((a) => a.toLowerCase()).includes(account.toLowerCase())) { console.log(`\n✓ approved (art-08/§7/¶2)`); return 0; }
    console.error(`\n✗ this awaits the ${office.title}'s approval.`);
    console.error('  The Assembly decides what the law is; the Keeper checks that what is');
    console.error('  made effective is what the Assembly carried.');
    return 1;
  },
};
