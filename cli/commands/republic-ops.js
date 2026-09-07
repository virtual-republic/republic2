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

    const by = arg('by');
    if (!by) { console.error('--by <citizen> is required'); return 2; }

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
        fs.writeFileSync(file, defaultCharter(e));
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

    if (sub === 'dissolve') {
      await offer(root, by, { kind: 'entity.amend', entity: id, what: 'dissolve' });
      return 0;
    }

    console.error('republic entity <form|charter|members|organs|dissolve|list>');
    return 2;
  },
};

function defaultCharter(e) {
  const organs = (e.organs || [{ name: 'convenor', held_by: [] }]);
  const marks = '¹²³⁴⁵⁶⁷⁸⁹';
  return `---
id: ${e.id}
type: ${e.type}
title: ${e.name}
formed: ${e.formed}
---

## § 1  Name and type

¹ The entity is named ${e.name}.

² It is a ${e.type}, formed under Article 4 § 1.

## § 2  Purpose

¹ The purpose of the entity is stated by its members and may be altered by them.

## § 3  Membership

¹ Membership is open to any citizen on application to an organ named in § 4.

² A member may withdraw at any time by a signed record.

## § 4  Organs

${organs.map((o, i) => `${marks[i] || i + 1} The ${o.name} is held by ${(o.held_by || []).join(', ') || 'no one at present'} and acts for the entity within the authority this charter confers.`).join('\n\n')}

## § 5  Decisions

¹ The entity decides by a majority of its members, unless this charter provides otherwise.

## § 6  Consistency

¹ This charter is subordinate to the Constitution, and any provision inconsistent with it is of no effect — Article 4 § 3 ³.

## § 7  Dissolution

¹ The entity is dissolved by this charter's procedure, by resolution of its members, or by judgment of the Court.

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
  help: `  republic gate [--base origin/main] [--measure P-0002] [--after-the-fact]

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

    const rf = path.join(at(root, 'ballots'), id, '_result.json');
    if (!fs.existsSync(rf)) return fail([`${id} has not been counted.`]);
    const r = JSON.parse(fs.readFileSync(rf, 'utf8'));
    if (!r.carried) return fail([`${id} ${r.open ? 'is still open' : 'did not carry'}. art-08/§5/¶1 — a measure that carries is enacted; this one has not.`]);

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
