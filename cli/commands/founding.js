// Founding, keys, citizenship, offices.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { at, config, reload } from '../../core/config.js';
import { append, records } from '../../core/ledger.js';
import { generate, publicKeyLine, importPrivate } from '../../core/sshsig.js';
import { readKey, saveKey, findKeys, keyFile } from '../../core/keys.js';
import { citizens, active, citizen, offices, writeOffices, whoseKey, asDate } from '../../core/registry.js';

const today = () => new Date().toISOString().slice(0, 10);
const inAYear = () => { const d = new Date(); d.setDate(d.getDate() + 365); return d.toISOString().slice(0, 10); };

export const init = {
  group: 'Founding',
  summary: 'found the Republic, with you as its first citizen',
  help: `  --id <c-0001>     the citizenship to create
  --key <file.pem>  a key you already have; otherwise one is made
  --name <name>     kept in private/ only, never on the register`,
  async run({ root, arg }) {
    const id = arg('id', 'c-0001');
    if (!/^c-\d{4}$/.test(id)) { console.error('--id looks like c-0001'); return 2; }
    if (citizens(root).length) { console.error('This Republic already has a register. Founding happens once.'); return 1; }

    for (const k of ['citizens', 'entities', 'issues', 'statutes', 'judgments', 'proposals', 'ballots', 'acts', 'checkpoints', 'private', 'charters', 'contracts']) {
      fs.mkdirSync(at(root, k), { recursive: true });
    }

    let pem, pub;
    const given = arg('key');
    if (given) {
      pem = fs.readFileSync(given.replace(/^~/, os.homedir()), 'utf8');
      pub = (await importPrivate(pem)).publicKey;
    } else {
      const kp = await generate(id);
      pem = kp.privateKey; pub = kp.publicKey;
    }
    await saveKey(root, id, pem);
    await saveKey(root, 'keeper', pem);

    // art-09/§6/¶2 — the register names a person only by their identifier.
    fs.writeFileSync(path.join(at(root, 'citizens'), `${id}.yml`), yaml.dump({
      id, status: 'active', admitted: today(), under: 'art-12/§6/¶2',
      keys: [publicKeyLine((await importPrivate(pem)).raw, id)],
    }));
    fs.writeFileSync(at(root, 'keepers'), publicKeyLine((await importPrivate(pem)).raw, id) + '\n');
    if (arg('name')) fs.writeFileSync(path.join(at(root, 'private'), 'persons.json'), JSON.stringify({ [id]: { display: arg('name'), joined: today() } }, null, 2));

    // art-06/§3/¶4 — the Assembly appoints until an election is held.
    const spec = config(root).offices;
    writeOffices(root, Object.entries(spec).filter(([k]) => k !== 'term').map(([oid, o]) => ({
      id: oid, title: o.title, holder: id, since: today(), term_ends: inAYear(),
      under: 'art-06/§3/¶4', powers: o.powers,
    })));

    append(root, { author: id, kind: 'constitution.enacted', provision: 'art-12/§6/¶1', payload: { version: '1.0.0' } });
    append(root, { author: id, kind: 'citizen.admitted', provision: 'art-12/§6/¶2', payload: { citizen: id } });
    for (const [oid] of Object.entries(spec).filter(([k]) => k !== 'term')) {
      append(root, { author: id, kind: 'office.taken', provision: 'art-06/§3/¶4', payload: { office: oid, holder: id } });
    }

    const dir = at(root, 'issues');
    fs.mkdirSync(path.join(dir, today().slice(0, 4)), { recursive: true });
    fs.writeFileSync(path.join(dir, today().slice(0, 4), '0001-founding.md'), `---
number: 1
date: ${today()}
title: Founding of the Republic
cites: [art-12/§6/¶1]
---

The Constitution takes effect this day, on its publication in this issue —
Article 12 § 6 ¹.

The founding citizen is ${id}, named in the first record of the register —
Article 12 § 6 ². The offices are held under Article 6 § 3 ⁴ until an election.
`);

    console.log(`Founded. ${id} is the first citizen and holds every office until an election.`);
    console.log(`  private/${id}.pem  — your citizenship. Save it. Never commit it.`);
    console.log(`\nNext:  republic verify  ·  republic build`);
    return 0;
  },
};

export const key = {
  group: 'Keys',
  summary: 'make, find, install and list keys',
  help: `  republic key new <c-0002>        make a key
  republic key find                look for keys on this machine
  republic key import [file] [id]  install one; finds it if no file is given
  republic key list                what is installed`,
  async run({ root, positional }) {
    const [sub, a, b] = positional;

    if (sub === 'new') {
      const id = a || 'c-0001';
      const kp = await generate(id);
      const f = await saveKey(root, id, kp.privateKey);
      console.log(`Made a key for ${id}.`);
      console.log(`  ${path.relative(root, f)} — never commit it`);
      console.log(`\nIts public half, for the register:\n  ${kp.publicKey}`);
      return 0;
    }

    if (sub === 'find') {
      const found = await findKeys(root);
      if (!found.length) {
        console.log('No private keys found in Downloads, Desktop, your home directory, or here.');
        console.log('If you have none:  republic key new c-0001');
        return 0;
      }
      console.log(`Found ${found.length} key${found.length === 1 ? '' : 's'}:\n`);
      for (const f of found) console.log(`  ${f.path}\n      ${f.citizen ? f.citizen + ' — on the register' : 'not on the register'}`);
      console.log(`\nInstall one:  republic key import "${found[0].path}"`);
      return 0;
    }

    if (sub === 'import') {
      let file = a ? a.replace(/^~/, os.homedir()) : null;
      if (!file || !fs.existsSync(file)) {
        const found = await findKeys(root);
        const pick = found.find((f) => f.citizen) || found[0];
        if (!pick) { console.error('No key given and none found. Try: republic key find'); return 2; }
        if (file) console.error(`No file at ${file}.`);
        console.log(`Using ${pick.path}${pick.citizen ? ` — it belongs to ${pick.citizen}` : ''}`);
        file = pick.path;
      }
      const pem = fs.readFileSync(file, 'utf8');
      let k;
      try { k = await importPrivate(pem); } catch (e) { console.error(e.message); return 2; }
      const known = whoseKey(root, k.publicKey);
      const id = b || known?.id;
      if (!id) {
        console.error('That key is not on the register, so I cannot tell whose it is.');
        console.error('Say so explicitly:  republic key import <file> c-0002');
        console.error(`\nIts public half:\n  ${k.publicKey}`);
        return 1;
      }
      await saveKey(root, id, pem);
      console.log(`Installed as private/${id}.pem${known ? ' — it matches the register' : ' — not yet on the register'}`);
      return 0;
    }

    if (sub === 'list' || !sub) {
      const dir = at(root, 'private');
      const have = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.pem')) : [];
      if (!have.length) { console.log('No keys installed.'); return 0; }
      for (const f of have) {
        try {
          const k = await importPrivate(fs.readFileSync(path.join(dir, f), 'utf8'));
          const c = whoseKey(root, k.publicKey);
          console.log(`  ${f.padEnd(20)} ${c ? c.id + ' — on the register' : 'not on the register'}`);
        } catch { console.log(`  ${f.padEnd(20)} unreadable`); }
      }
      return 0;
    }

    console.error('republic key <new|find|import|list>');
    return 2;
  },
};

export const join = {
  group: 'Citizenship',
  summary: 'admit a citizenship from a key',
  help: `  republic join <file.pem> [c-0002]

art-03/§2/¶3 — admission takes effect on the recording of the application.
No support, sponsorship or seconding is required.`,
  async run({ root, positional }) {
    const [file, wanted] = positional;
    if (!file) { console.error('republic join <file.pem> [c-0002]'); return 2; }
    const pem = fs.readFileSync(file.replace(/^~/, os.homedir()), 'utf8');
    let k;
    try { k = await importPrivate(pem); } catch (e) { console.error(e.message); return 2; }

    const already = whoseKey(root, k.publicKey);
    if (already) { console.error(`That key already belongs to ${already.id} (art-02/§6/¶3).`); return 1; }

    const nums = citizens(root).map((c) => Number(String(c.id).replace('c-', ''))).filter(Number.isFinite);
    const id = wanted || 'c-' + String(Math.max(0, ...nums) + 1).padStart(4, '0');
    if (citizen(root, id)) { console.error(`${id} is already on the register.`); return 1; }

    fs.mkdirSync(at(root, 'citizens'), { recursive: true });
    fs.writeFileSync(path.join(at(root, 'citizens'), `${id}.yml`), yaml.dump({
      id, status: 'active', admitted: today(), under: 'art-03/§2/¶3',
      keys: [publicKeyLine(k.raw, id)],
    }));
    await saveKey(root, id, pem);
    append(root, { author: id, kind: 'citizen.admitted', provision: 'art-03/§2/¶3', payload: { citizen: id } });

    console.log(`Admitted ${id}.`);
    console.log(`  register/citizens/${id}.yml  ·  private/${id}.pem`);
    return 0;
  },
};

export const depart = {
  group: 'Citizenship',
  summary: 'record a departure',
  help: `  republic depart <c-0002>
  republic depart --all-except <c-0001> [--offices-to <c-0001>]

art-03/§4 — a citizen may depart at any time, and may return by the procedure
for admission. Departure alters no record already made, so the citizenship is
marked departed rather than deleted.`,
  async run({ root, arg, positional }) {
    const keep = arg('all-except');
    const one = positional[0];
    const roll = active(root);
    const targets = keep ? roll.filter((c) => c.id !== keep).map((c) => c.id) : one ? [one] : [];
    if (!targets.length) { console.error('republic depart <c-0002> | --all-except <c-0001>'); return 2; }
    if (targets.length >= roll.length) { console.error('That would leave no citizen. art-12/§5/¶3 — a Republic of one citizen is a Republic, but not of none.'); return 1; }

    const heir = arg('offices-to', keep || roll.find((c) => !targets.includes(c.id))?.id);
    for (const id of targets) {
      const c = citizen(root, id);
      if (!c || c.status !== 'active') { console.log(`${id} is not active`); continue; }
      const file = path.join(at(root, 'citizens'), c.file);
      const doc = yaml.load(fs.readFileSync(file, 'utf8'));
      doc.status = 'departed'; doc.departed = today(); doc.departed_under = 'art-03/§4/¶1';
      fs.writeFileSync(file, yaml.dump(doc));
      append(root, { author: id, kind: 'citizen.departed', provision: 'art-03/§4/¶1', payload: { citizen: id } });
      console.log(`${id} departed.`);
    }

    // art-06/§3/¶5 — an office recorded to a citizenship that is not active is
    // vacant in fact, so it is filled rather than left saying something untrue.
    const live = new Set(active(root).map((c) => c.id));
    const list = offices(root);
    const stranded = list.filter((o) => !live.has(o.holder));
    if (stranded.length && heir && live.has(heir)) {
      for (const o of stranded) {
        const from = o.holder;
        o.holder = heir; o.since = today(); o.term_ends = inAYear(); o.under = 'art-06/§3/¶4';
        append(root, { author: heir, kind: 'office.appointed', provision: 'art-06/§3/¶4', payload: { office: o.id, holder: heir, from } });
        console.log(`  ${o.id} appointed to ${heir} — art-06/§3/¶4`);
      }
      writeOffices(root, list);

      const k = list.find((o) => (o.powers || []).includes('checkpoint.sign'));
      if (k && k.holder === heir) {
        const c = citizen(root, heir);
        if (c?.keys?.[0]) { fs.writeFileSync(at(root, 'keepers'), c.keys[0] + '\n'); console.log('  register/keepers.txt now holds the Keeper\u2019s key — art-02/§3/¶2'); }
      }
    }

    const remaining = active(root);
    console.log(`\n${remaining.length} active citizenship(s): ${remaining.map((c) => c.id).join(', ')}`);
    return 0;
  },
};

export const office = {
  group: 'Offices',
  summary: 'show, appoint to, and give effect to elections for office',
  help: `  republic office                          what is held and what is outstanding
  republic office install [P-0002|--all]   give effect to a carried election
  republic office appoint --office <id> --holder <c-0001>
  republic office vacant --fill <c-0001>   fill every office held by nobody`,
  async run({ root, arg, positional }) {
    const [sub] = positional;
    const list = offices(root);
    const live = new Set(active(root).map((c) => c.id));
    const stranded = () => offices(root).filter((o) => !live.has(o.holder));

    const elections = () => {
      const out = [];
      const dir = at(root, 'proposals');
      if (!fs.existsSync(dir)) return out;
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md') && x !== 'TEMPLATE.md')) {
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        const end = src.indexOf('\n---', 3);
        const meta = yaml.load(src.slice(4, end)) || {};
        if (meta.class !== 'election') continue;
        const rf = path.join(at(root, 'ballots'), meta.id, '_result.json');
        if (!fs.existsSync(rf)) continue;
        const r = JSON.parse(fs.readFileSync(rf, 'utf8'));
        if (r.carried && r.winner) out.push({ id: meta.id, office: meta.office, winner: r.winner });
      }
      return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    };
    const outstanding = () => elections().filter((e) => list.find((o) => o.id === e.office)?.holder !== e.winner);

    const install = (list2, holder, under, why) => {
      const all = offices(root);
      for (const id of list2) {
        const o = all.find((x) => x.id === id);
        if (!o) { console.error(`  no office "${id}"`); continue; }
        const from = o.holder;
        o.holder = holder; o.since = today(); o.term_ends = inAYear(); o.under = under;
        append(root, { author: holder, kind: 'office.taken', provision: why, payload: { office: id, holder, from, ...(under.startsWith('P-') ? { measure: under } : {}) } });
        console.log(`  ${holder} takes ${id}${from ? ` in place of ${from}` : ''} — ${under}`);
      }
      writeOffices(root, all);
    };

    if (!sub) {
      console.log('Offices:\n');
      for (const o of list) console.log(`  ${o.id.padEnd(12)} ${String(o.holder).padEnd(10)} until ${asDate(o.term_ends)}${live.has(o.holder) ? '' : '   — not an active citizenship'}`);
      const out = outstanding();
      console.log(out.length ? '\nCarried but not given effect:\n' : '\nEvery carried election has taken effect.');
      for (const e of out) console.log(`  ${e.id}  elected ${e.winner} to ${e.office}`);
      if (out.length) console.log('\n  republic office install --all');
      const empty = stranded();
      if (empty.length) {
        console.log('\nHeld by a citizenship that is not active — vacant in fact (art-06/§3/¶5):\n');
        for (const o of empty) console.log(`  ${o.id.padEnd(12)} recorded to ${o.holder}`);
        console.log(`\n  republic office vacant --fill ${[...live][0] || '<citizen>'}`);
      }
      return 0;
    }

    if (sub === 'install') {
      const only = positional[1];
      const todo = positional.includes('--all') || !only ? outstanding() : elections().filter((e) => e.id === only);
      if (!todo.length) { console.log('Nothing outstanding.'); return 0; }
      for (const e of todo) install([e.office], e.winner, e.id, 'art-06/§3/¶1');
      console.log('\nCommit register/offices.yml and the ledger for it to take effect on the site.');
      return 0;
    }

    if (sub === 'appoint') {
      const o = arg('office'), h = arg('holder');
      if (!o || !h) { console.error('republic office appoint --office <id> --holder <c-0001>'); return 2; }
      if (!live.has(h)) { console.error(`${h} is not an active citizenship.`); return 1; }
      install([o], h, 'art-06/§3/¶4', 'art-06/§3/¶4');
      return 0;
    }

    if (sub === 'vacant') {
      const h = arg('fill');
      const empty = stranded();
      if (!empty.length) { console.log('No office is held by an inactive citizenship.'); return 0; }
      if (!h) { for (const o of empty) console.log(`  ${o.id.padEnd(12)} recorded to ${o.holder}`); console.log('\n  republic office vacant --fill <citizen>'); return 0; }
      if (!live.has(h)) { console.error(`${h} is not an active citizenship.`); return 1; }
      install(empty.map((o) => o.id), h, 'art-06/§3/¶4', 'art-06/§3/¶4');
      return 0;
    }

    console.error('republic office [install|appoint|vacant]');
    return 2;
  },
};
