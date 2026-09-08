#!/usr/bin/env node
// Every feature, end to end, from nothing.
//
// Builds a whole Republic in a scratch directory and exercises each capability
// in turn. This is what stops a fix to one thing quietly breaking another, and
// it runs in CI on every push.
//
//   node test/selftest.js          run it
//   node test/selftest.js --keep   leave the scratch republic for inspection

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = process.argv.includes('--keep');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'republic-'));

let pass = 0, fail = 0;
let society = null;
const failures = [];

const run = (...args) => {
  try { return { ok: true, out: execFileSync('node', ['cli/republic.js', ...args], { cwd: DIR, encoding: 'utf8', stdio: 'pipe' }) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || ''), code: e.status }; }
};

async function check(name, fn) {
  try {
    const why = await fn();
    if (why === true || why === undefined) { console.log(`  \u2713 ${name}`); pass++; }
    else { console.log(`  \u2717 ${name}\n      ${String(why).split('\n').slice(0, 4).join('\n      ')}`); fail++; failures.push(name); }
  } catch (e) {
    console.log(`  \u2717 ${name}\n      ${e.message.split('\n').slice(0, 4).join('\n      ')}`);
    fail++; failures.push(name);
  }
}

const has = (f) => fs.existsSync(path.join(DIR, f));
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(DIR, f)), { recursive: true }); fs.writeFileSync(path.join(DIR, f), t); };

// ---- a fresh Republic from this repository's code ----------------------------

for (const d of ['core', 'cli', 'site', 'test', 'node_modules', 'journal/constitution']) {
  if (fs.existsSync(path.join(SRC, d))) fs.cpSync(path.join(SRC, d), path.join(DIR, d), { recursive: true });
}
for (const f of ['republic.yml', 'package.json']) fs.cpSync(path.join(SRC, f), path.join(DIR, f));

console.log(`\nScratch republic: ${DIR}\n`);
console.log('Founding\n');

await check('the Republic is founded', () => {
  const r = run('init', '--id', 'c-0001', '--name', 'Tester');
  return r.out.includes('Founded') || r.out;
});
await check('the register names one citizen', () => has('register/citizens/c-0001.yml') || 'no c-0001.yml');
await check('every office of art-06/§1 exists', () => {
  const y = read('register/offices.yml');
  const missing = ['registrar', 'keeper', 'treasurer', 'auditor', 'judge'].filter((o) => !y.includes(`id: ${o}`));
  return missing.length ? `missing: ${missing.join(', ')}` : true;
});
await check('founding is refused a second time', () => !run('init', '--id', 'c-0009').ok || 'founded twice');
await check('the register verifies', () => { const r = run('verify'); return r.out.includes('verifies') || r.out; });
await check('the Journal has its first issue', () => has('journal/issues/' + new Date().getFullYear() + '/0001-founding.md') || 'no founding issue');

console.log('\nKeys and citizenship\n');

await check('a key may be made and a citizenship admitted', () => {
  run('key', 'new', 'c-0002');
  const r = run('join', 'private/c-0002.pem', 'c-0002');
  return r.out.includes('Admitted') || r.out;
});
await check('the same key cannot be admitted twice', () => !run('join', 'private/c-0002.pem', 'c-0003').ok || 'admitted one key twice');
await check('a key is identified by content, whatever its name', () => {
  fs.copyFileSync(path.join(DIR, 'private/c-0002.pem'), path.join(DIR, 'anything-at-all.pem'));
  return run('key', 'import', 'anything-at-all.pem').out.includes('c-0002') || run('key', 'import', 'anything-at-all.pem').out;
});
await check('the public half is refused as a private key', () => {
  put('pub.pem', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample');
  return !run('key', 'import', 'pub.pem', 'c-0009').ok || 'accepted a public key';
});
await check('a citizenship may depart, and is then not counted', () => {
  run('key', 'new', 'c-0003'); run('join', 'private/c-0003.pem', 'c-0003');
  run('depart', 'c-0003');
  return read('register/citizens/c-0003.yml').includes('departed') && !run('value', '--accounts').out.includes('c-0003')
    || 'still active';
});

console.log('\nMeasures and law\n');

await check('a measure is received', () => run('propose', '--title', 'Statute on Meetings', '--by', 'c-0001',
  '--class', 'policy', '--cites', 'art-01/§4/¶2', '--text', '## § 1  Calling\n\n¹ The Assembly meets when a citizen calls it.\n')
  .out.includes('Received') || run('propose', '--title', 'x', '--by', 'c-0001').out);
await check('a measure citing nothing resolvable is refused', () =>
  !run('propose', '--title', 'Bad', '--by', 'c-0001', '--cites', 'art-99/§400').ok || 'accepted an unresolvable citation');
await check('a measure citing nothing at all is refused', () =>
  !run('propose', '--title', 'Bare', '--by', 'c-0001', '--cites', '').ok || 'accepted a measure citing nothing');
await check('ballots are signed and counted', () => {
  run('vote', 'P-0001', 'yes', '--by', 'c-0001');
  run('vote', 'P-0001', 'yes', '--by', 'c-0002');
  const r = run('count', 'P-0001');
  return r.out.includes('closed early') && r.out.includes('CARRIED') || r.out;
});
await check('a ballot from an unregistered key is not counted', () => {
  const b = JSON.parse(read('ballots/P-0001/c-0002.json'));
  put('ballots/P-0001/c-0003.json', JSON.stringify({ ...b, measure: 'P-0001' }));
  const r = run('count', 'P-0001');
  fs.rmSync(path.join(DIR, 'ballots/P-0001/c-0003.json'));
  return r.out.includes('c-0003') || 'a departed citizenship was counted';
});
await check('a carried measure enacts, and produces a statute', () => {
  const r = run('enact', 'P-0001');
  return r.out.includes('Enacted') && has('journal/statutes/statute-on-meetings.md') || r.out;
});
await check('the Journal records the act without copying the text', () => {
  const y = new Date().getFullYear();
  const f = fs.readdirSync(path.join(DIR, `journal/issues/${y}`)).find((x) => x.includes('p-0001'));
  return !read(`journal/issues/${y}/${f}`).includes('meets when a citizen') || 'the Journal duplicates the statute';
});
await check('a statute is amended, and the version rises', () => {
  run('propose', '--title', 'Statute on Meetings', '--by', 'c-0001', '--class', 'policy',
    '--cites', 'art-01/§4/¶2', '--amends', 'statute-on-meetings',
    '--text', '## § 1  Calling\n\n¹ The Assembly meets on three days\u2019 notice.\n');
  run('vote', 'P-0002', 'yes', '--by', 'c-0001');
  run('vote', 'P-0002', 'yes', '--by', 'c-0002');
  run('count', 'P-0002'); run('enact', 'P-0002');
  return read('journal/statutes/statute-on-meetings.md').includes('version: 2') || 'version did not rise';
});
await check('the superseded text is kept', () => has('journal/statutes/superseded/statute-on-meetings.v1.md') || 'not kept');
await check('a measure enacts only once', () => run('enact', 'P-0002').out.includes('already published') || 'enacted twice');

console.log('\nElections and office\n');

await check('an election is opened and ranked ballots counted', () => {
  run('propose', '--title', 'Election — Treasurer', '--by', 'c-0001', '--class', 'election', '--office', 'treasurer', '--candidates', 'c-0001,c-0002');
  run('vote', 'P-0003', 'c-0001,c-0002', '--by', 'c-0001');
  run('vote', 'P-0003', 'c-0001', '--by', 'c-0002');
  const r = run('count', 'P-0003');
  return r.out.includes('ELECTED c-0001') && r.out.includes('CARRIED') || r.out;
});
await check('enacting an election installs the winner', () => {
  const r = run('enact', 'P-0003');
  return r.out.includes('takes treasurer') && read('register/offices.yml').includes('under: P-0003') || r.out;
});
await check('office reports nothing outstanding', () => { const r = run('office'); return r.out.includes('has taken effect') || r.out; });
await check('an office held by a departed citizenship is vacant in fact', () => {
  run('office', 'appoint', '--office', 'auditor', '--holder', 'c-0002');
  run('depart', 'c-0002', '--offices-to', 'c-0001');
  const r = run('office');
  return read('register/offices.yml').includes('holder: c-0001') && !r.out.includes('vacant in fact') || r.out;
});

console.log('\nEntities\n');

await check('a company is formed as of right', () => {
  run('entity', 'form', '--name', 'Test Company', '--type', 'company', '--by', 'c-0001', '--organ', 'director=c-0001');
  const r = run('settle');
  return r.out.includes('formed e-0001') || r.out;
});
await check('a commune is refused without a carried measure', () => {
  run('entity', 'form', '--name', 'North', '--type', 'commune', '--by', 'c-0001');
  const r = run('settle');
  return r.out.includes('carried measure') || r.out;
});
await check('a charter is written when missing', () => {
  const r = run('entity', 'charter', '--entity', 'e-0001', '--by', 'c-0001');
  return has('charters/e-0001.md') || r.out;
});
await check('the charter may then be amended', () => {
  fs.appendFileSync(path.join(DIR, 'charters/e-0001.md'), '\n## § 8  Records\n\n¹ The director keeps the records.\n');
  run('entity', 'charter', '--entity', 'e-0001', '--by', 'c-0001');
  const r = run('settle');
  return r.out.includes('charter of e-0001') || r.out;
});
await check('members and organs may be changed', () => {
  run('key', 'new', 'c-0004'); run('join', 'private/c-0004.pem', 'c-0004');
  run('entity', 'members', '--entity', 'e-0001', '--admit', 'c-0004', '--by', 'c-0001');
  run('entity', 'organs', '--entity', 'e-0001', '--set', 'director=c-0001,secretary=c-0004', '--by', 'c-0001');
  run('settle');
  const y = read('register/entities/e-0001.yml');
  return y.includes('secretary') && y.includes('c-0004') || y;
});
await check('a non-organ may not act for the entity', () => {
  run('key', 'new', 'c-0005'); run('join', 'private/c-0005.pem', 'c-0005');
  run('entity', 'dissolve', '--entity', 'e-0001', '--by', 'c-0005');
  const r = run('settle');
  return r.out.includes('not an organ') || r.out;
});

console.log('\nEntity governance\n');

await check('a charter is operative, not decoration', () => {
  const r = run('entity', 'powers', '--entity', 'e-0001');
  return (r.out.includes('may issue') && r.out.includes('votes by') && r.out.includes('who may vote')) || r.out;
});
await check('a company decides by its shares', () => {
  const r = run('entity', 'powers', '--entity', 'e-0001');
  return r.out.includes('shares, weighted by holding') || r.out;
});
await check('a company is private unless its charter lists it', () => {
  const r = run('entity', 'powers', '--entity', 'e-0001');
  return r.out.includes('private') || r.out;
});
await check('an unlisted company\u2019s shares are not traded', () => {
  run('order', '--side', 'sell', '--instrument', 'e-0001:ordinary', '--quantity', '5', '--price', '5', '--by', 'c-0001', '--account', 'e-0001');
  const r = run('settle');
  return r.out.includes('not listed') || r.out;
});
await check('an association makes its members coequal', () => {
  run('entity', 'form', '--name', 'The Society', '--type', 'association', '--by', 'c-0001', '--organ', 'convenor=c-0001');
  run('settle');
  const id = 'e-000' + fs.readdirSync(path.join(DIR, 'register/entities')).length;
  run('entity', 'charter', '--entity', id, '--by', 'c-0001');
  run('entity', 'charter', '--entity', id, '--by', 'c-0001');
  run('settle');
  run('entity', 'members', '--entity', id, '--admit', 'c-0004,c-0005', '--by', 'c-0001');
  run('settle');
  society = id;
  const r = run('entity', 'powers', '--entity', id);
  return (r.out.includes('members, one each') && (r.out.match(/weight 1/g) || []).length >= 3) || r.out;
});
await check('the members resolve, and it carries', () => {
  run('entity', 'resolve', '--entity', society, '--title', 'Meet on Thursdays', '--by', 'c-0004');
  run('settle');
  for (const c of ['c-0001', 'c-0004', 'c-0005']) run('entity', 'vote', '--entity', society, '--resolution', 'R-0001', 'yes', '--by', c);
  const r = run('settle');
  return r.out.includes('R-0001 carried') || r.out;
});
await check('an officer resolution installs its winner as an organ', () => {
  run('entity', 'resolve', '--entity', society, '--title', 'Convenor', '--kind', 'officer', '--organ', 'convenor', '--by', 'c-0001');
  run('settle');
  for (const c of ['c-0001', 'c-0004', 'c-0005']) run('entity', 'vote', '--entity', society, '--resolution', 'R-0002', 'c-0005', '--by', c);
  const r = run('settle');
  if (!r.out.includes('takes the convenor')) return r.out;
  return read(`register/entities/${society}.yml`).includes('c-0005') || 'the organ was not filled';
});
await check('a stranger may not vote in an entity', () => {
  run('key', 'new', 'c-0006'); run('join', 'private/c-0006.pem', 'c-0006');
  run('entity', 'vote', '--entity', society, '--resolution', 'R-0001', 'yes', '--by', 'c-0006');
  const r = run('settle');
  return /not a member|holds no share/.test(r.out) || r.out;
});

console.log('\nValue\n');

// Whoever is active when the measure is laid must vote, or it does not close
// early — art-08/§3/¶6. Read the roll rather than assuming it.
const activeNow = () => fs.readdirSync(path.join(DIR, 'register/citizens'))
  .filter((f) => f.endsWith('.yml'))
  .map((f) => f.replace('.yml', ''))
  .filter((id) => read(`register/citizens/${id}.yml`).includes('status: active'));

let issueMeasure = null;

await check('a resolution authorising an issue carries', () => {
  const p = run('propose', '--title', 'First Issue', '--by', 'c-0001', '--class', 'ordinary',
    '--cites', 'art-10/§2/¶1', '--text', '## § 1\n\n¹ The Treasurer is authorised to issue 50000 obols.\n');
  issueMeasure = (p.out.match(/Received (P-\d{4})/) || [])[1];
  if (!issueMeasure) return p.out;
  for (const c of activeNow()) run('vote', issueMeasure, 'yes', '--by', c);
  run('count', issueMeasure);
  const r = run('enact', issueMeasure);
  return r.out.includes('Enacted') || r.out + run('count', issueMeasure).out;
});

await check('the Treasurer issues under it', () => {
  run('issue', '--unit', '50000', '--under', issueMeasure, '--by', 'c-0001');
  const r = run('settle');
  return r.out.includes('issued 50000') || r.out;
});
await check('an issue under a measure that has not carried is refused', () => {
  run('issue', '--unit', '10', '--under', 'P-9999', '--by', 'c-0001');
  const r = run('settle');
  return r.out.includes('has not been counted') || r.out;
});
await check('an issue by someone who does not hold the power is refused', () => {
  run('issue', '--unit', '10', '--under', issueMeasure, '--by', 'c-0006');
  const r = run('settle');
  return r.out.includes('value.issue') || r.out;
});
await check('an issue above the cap is refused', () => {
  run('issue', '--unit', '999999999', '--under', issueMeasure, '--by', 'c-0001');
  const r = run('settle');
  return r.out.includes('exceeds the cap') || r.out;
});
await check('the Treasury disburses to a citizen', () => {
  run('pay', '--from', 'treasury', '--to', 'c-0001', '--amount', '10000', '--by', 'c-0001');
  const r = run('settle');
  return r.out.includes('treasury \u2192 c-0001') || r.out;
});
await check('nobody may debit an account they do not hold', () => {
  run('pay', '--from', 'c-0001', '--to', 'c-0005', '--amount', '10', '--by', 'c-0005');
  const r = run('settle');
  return r.out.includes('may not act for') || r.out;
});
await check('a transfer beyond the balance is refused, with the reason kept', () => {
  run('pay', '--from', 'c-0001', '--to', 'c-0005', '--amount', '99999999', '--by', 'c-0001');
  const r = run('settle');
  if (!r.out.includes('refused')) return r.out;
  const f = fs.readdirSync(path.join(DIR, 'refused'))[0];
  return JSON.parse(read(`refused/${f}`))._refused?.why ? true : 'the reason was not kept';
});
await check('value is conserved', () => {
  const out = run('value').out;
  const issued = Number((out.match(/Issued in total: (\d+)/) || [])[1] || 0);
  const held = [...out.matchAll(/^\s+\S+\s+(\d+) obol/gm)].reduce((a, m) => a + Number(m[1]), 0);
  return issued > 0 && issued === held || `issued ${issued}, held ${held}\n${out}`;
});

console.log('\nShares and the exchange\n');

await check('a company issues a share in itself', () => {
  run('issue', '--instrument', 'e-0001', '--quantity', '1000', '--by', 'c-0001', '--to', 'e-0001');
  const r = run('settle');
  return r.out.includes('1000 \u00d7 e-0001:ordinary') || r.out;
});
await check('a foundation may not issue', () => {
  run('entity', 'form', '--name', 'Test Foundation', '--type', 'foundation', '--by', 'c-0001', '--organ', 'convenor=c-0001');
  run('settle');
  run('issue', '--instrument', 'e-0002', '--quantity', '10', '--by', 'c-0001');
  const r = run('settle');
  return r.out.includes('may not issue instruments') || r.out;
});
await check('shares transfer', () => {
  run('pay', '--from', 'e-0001', '--to', 'c-0001', '--instrument', 'e-0001:ordinary', '--quantity', '300', '--by', 'c-0001');
  const r = run('settle');
  return r.out.includes('300 \u00d7 e-0001:ordinary') || r.out;
});
// art-10/§5 — best price first, then time; the trade happens at the RESTING
// order's price; and an order partly filled is cancelled for the remainder.
// A private company is the default. Listing is a decision of its holders,
// taken by amending its own charter — art-04/§3/¶2.
await check('the holders may list the company by amending the charter', () => {
  const charter = read('charters/e-0001.md').replace('listed: false', 'listed: true');
  run('entity', 'resolve', '--entity', 'e-0001', '--title', 'List the company', '--kind', 'charter', '--by', 'c-0001', '--text', charter);
  run('settle');
  run('entity', 'vote', '--entity', 'e-0001', '--resolution', 'R-0001', 'yes', '--by', 'c-0001');
  const r = run('settle');
  if (!r.out.includes('charter is amended')) return r.out;
  return run('entity', 'powers', '--entity', 'e-0001').out.includes('may be traded') || 'still unlisted';
});

await check('an order that crosses nothing rests', () => {
  run('order', '--side', 'sell', '--instrument', 'e-0001:ordinary', '--quantity', '30', '--price', '20', '--by', 'c-0001', '--account', 'e-0001');
  const r = run('settle');
  return r.out.includes('rest') || r.out;
});
let lastSettle = '';
await check('a crossing order trades at the resting price', () => {
  run('order', '--side', 'buy', '--instrument', 'e-0001:ordinary', '--quantity', '20', '--price', '25', '--by', 'c-0001', '--account', 'c-0001');
  const r = run('settle');
  lastSettle = r.out;
  return (r.out.includes('20 \u00d7 e-0001:ordinary at 20') && r.out.includes('resting sell')) || r.out;
});
await check('a partial fill cancels the remainder', () => {
  const cancelled = run('value').out;
  return /10 of 30 cancelled/.test(lastSettle) || lastSettle;
});
await check('nothing is left resting afterwards', () => {
  const r = run('settle');
  return r.out.includes('Nothing pending') || r.out;
});

console.log('\nContracts\n');

await check('a contract is drafted', () => run('contract', 'draft', '--title', 'Test Contract', '--parties', 'c-0001,c-0004', '--by', 'c-0001').ok || 'could not draft');
await check('it does not execute on one signature', () => {
  run('contract', 'sign', '--id', 'test-contract', '--by', 'c-0001');
  const r = run('settle');
  return r.out.includes('awaits c-0004') || r.out;
});
await check('it executes when every party has signed', () => {
  run('contract', 'sign', '--id', 'test-contract', '--by', 'c-0004');
  const r = run('settle');
  return r.out.includes('executed by c-0001 and c-0004') || r.out;
});
await check('a stranger may not sign', () => {
  run('contract', 'draft', '--title', 'Other', '--parties', 'c-0001,c-0004', '--by', 'c-0001');
  const r = run('contract', 'sign', '--id', 'other', '--by', 'c-0005');
  return !r.ok || 'a stranger signed';
});
await check('an alteration after signature voids every signature', () => {
  run('contract', 'draft', '--title', 'Tamper', '--parties', 'c-0001,c-0004', '--by', 'c-0001');
  run('contract', 'sign', '--id', 'tamper', '--by', 'c-0001');
  run('contract', 'sign', '--id', 'tamper', '--by', 'c-0004');
  fs.appendFileSync(path.join(DIR, 'contracts/tamper.md'), '\nAn extra line.\n');
  const r = run('settle');
  return r.out.includes('changed after') || r.out;
});

console.log('\nDeeds\n');

await check('anyone may ask for a deed', () => {
  run('deed', 'request', '--id', 'river-mill', '--title', 'The mill at the river', '--by', 'c-0004', '--transferable');
  const r = run('settle');
  return r.out.includes('asks the Keeper') || r.out;
});
await check('a request is not a deed', () => {
  const r = run('deed', 'list');
  return (!r.out.includes('Recognised \u2014 valid') && r.out.includes('Requested')) || `a mere request appeared as valid:\n${r.out}`;
});
await check('only the holder of deed.recognise may recognise one', () => {
  run('deed', 'recognise', '--id', 'river-mill', '--by', 'c-0004');
  const r = run('settle');
  return r.out.includes('may recognise a deed') || r.out;
});
await check('the Keeper recognises it, and it is published', () => {
  run('deed', 'recognise', '--id', 'river-mill', '--by', 'c-0001');
  const r = run('settle');
  if (!r.out.includes('recognised and published')) return r.out;
  const d = read('journal/deeds/river-mill.md');
  const issue = (d.match(/journal: (\d+)/) || [])[1];
  if (!issue) return 'no Journal issue recorded';
  const year = new Date().getFullYear();
  const files = fs.readdirSync(path.join(DIR, `journal/issues/${year}`));
  return files.some((f) => f.startsWith(String(issue).padStart(4, '0'))) || `Journal ${issue} was not written`;
});
await check('a recognised deed is citable', () => {
  const r = run('build');
  return has('dist/journal/deeds/river-mill/index.html') || r.out;
});
await check('the holder may transfer a transferable deed', () => {
  run('deed', 'transfer', '--id', 'river-mill', '--to', 'c-0001', '--by', 'c-0004');
  const r = run('settle');
  return r.out.includes('passes to c-0001') || r.out;
});
await check('someone who does not hold it may not transfer it', () => {
  run('deed', 'transfer', '--id', 'river-mill', '--to', 'c-0005', '--by', 'c-0004');
  const r = run('settle');
  return r.out.includes('does not hold') || r.out;
});
await check('a deed that is not transferable cannot be transferred', () => {
  run('deed', 'recognise', '--id', 'seat', '--title', 'A seat', '--holder', 'c-0004', '--by', 'c-0001');
  run('settle');
  run('deed', 'transfer', '--id', 'seat', '--to', 'c-0001', '--by', 'c-0004');
  const r = run('settle');
  return r.out.includes('not transferable') || r.out;
});
await check('the Keeper may recognise one directly, with no request', () => {
  const d = read('journal/deeds/seat.md');
  return d.includes('recognised_directly: true') || d;
});
await check('the Keeper may refuse a request, with reasons', () => {
  run('deed', 'request', '--id', 'the-moon', '--title', 'The moon', '--by', 'c-0004');
  run('settle');
  run('deed', 'refuse', '--id', 'the-moon', '--by', 'c-0001', '--reasons', 'The Republic holds no territory.');
  const r = run('settle');
  return r.out.includes('is refused') || r.out;
});
await check('a refused request confers nothing', () => !has('journal/deeds/the-moon.md') || 'a refused request became a deed');

console.log('\nThe Court\n');

await check('a case may be brought', () => run('court', 'file', '--against', 'P-0001', '--by', 'c-0001',
  '--ground', 'A ground.', '--construes', 'art-08/§1/¶3').ok || 'could not file');
await check('a case citing an unresolvable provision is refused', () =>
  !run('court', 'file', '--against', 'P-0001', '--by', 'c-0001', '--ground', 'g', '--construes', 'art-99/§9').ok || 'accepted it');
await check('a judge decides it', () => {
  run('office', 'appoint', '--office', 'judge', '--holder', 'c-0001');
  const r = run('court', 'judge', '--case', '1', '--by', 'c-0001', '--holding', 'dismissed', '--reasons', 'Because.');
  return r.out.includes('decided') || r.out;
});
await check('someone who does not sit may not judge', () => {
  run('court', 'file', '--against', 'P-0002', '--by', 'c-0001', '--ground', 'g');
  return !run('court', 'judge', '--case', '2', '--by', 'c-0005', '--holding', 'void', '--reasons', 'r').ok || 'a non-judge decided';
});
await check('a case is decided only once', () =>
  !run('court', 'judge', '--case', '1', '--by', 'c-0001', '--holding', 'void', '--reasons', 'r').ok || 'decided twice');

console.log('\nFitting it to a body\n');

await check('an office does not gain a power by the settings changing', () => {
  // art-06/§4/¶1 — the register governs what an office may do.
  // Strip the power however the register formats it — a list item or inline.
  const before = read('register/offices.yml');
  const after = before.replace(/^\s*- deed\.recognise\s*$/m, '').replace(/,\s*deed\.recognise/, '');
  if (after === before) return 'could not strip deed.recognise from the register';
  put('register/offices.yml', after);
  run('deed', 'request', '--id', 'sync-test', '--title', 'A test', '--by', 'c-0001');
  run('settle');
  run('deed', 'recognise', '--id', 'sync-test', '--by', 'c-0001');
  const r = run('settle');
  return r.out.includes('office sync') || r.out;
});
await check('sync shows the difference without changing anything', () => {
  const r = run('office', 'sync');
  return (!r.ok && r.out.includes('deed.recognise') && r.out.includes('Nothing is changed')) || r.out;
});
await check('sync --apply records the grant', () => {
  const r = run('office', 'sync', '--apply');
  if (!r.out.includes('deed.recognise')) return r.out;
  run('deed', 'recognise', '--id', 'sync-test', '--by', 'c-0001');
  return run('settle').out.includes('recognised and published') || 'still refused';
});
await check('a part switched off refuses its acts, and says why', () => {
  const y = read('republic.yml').replace(/  exchange: true/, '  exchange: false');
  put('republic.yml', y);
  run('order', '--side', 'sell', '--instrument', 'e-0001:ordinary', '--quantity', '1', '--price', '1', '--by', 'c-0001', '--account', 'e-0001');
  const r = run('settle');
  put('republic.yml', read('republic.yml').replace(/  exchange: false/, '  exchange: true'));
  return (r.out.includes('not in use') && r.out.includes('art-01/§2/¶2')) || r.out;
});
await check('the vocabulary changes the words and no rule', () => {
  const y = read('republic.yml').replace(/^  citizens: citizens$/m, '  citizens: members').replace(/^  republic: Republic$/m, '  republic: Fellowship');
  put('republic.yml', y);
  run('build');
  const h = read('dist/index.html');
  const stillResolves = read('dist/data/citations.json').includes('const.art-01');
  put('republic.yml', read('republic.yml').replace(/^  citizens: members$/m, '  citizens: citizens').replace(/^  republic: Fellowship$/m, '  republic: Republic'));
  run('build');
  return (h.includes('Fellowship') && h.includes('members') && stillResolves) || 'the words did not change, or a citation stopped resolving';
});

console.log('\nVersions of a law\n');

await check('every version of a statute is kept and published', () => {
  const st = fs.readdirSync(path.join(DIR, 'journal/statutes')).filter((f) => f.endsWith('.md'))[0];
  const id = st.replace('.md', '');
  run('build');
  return has(`dist/journal/law/${id}/index.html`) || 'no statute page';
});
await check('any version may be compared with any other', () => {
  const sup = path.join(DIR, 'journal/statutes/superseded');
  if (!fs.existsSync(sup)) return true;                    // only one version yet
  const f = fs.readdirSync(sup)[0];
  if (!f) return true;
  const id = f.split('.v')[0];
  run('build');
  return has(`dist/journal/law/${id}/v1-v2/index.html`) || 'no comparison page';
});

console.log('\nThe gate\n');

const git = (...a) => { try { execFileSync('git', a, { cwd: DIR, stdio: 'pipe' }); } catch {} };
git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
git('add', '-A'); git('commit', '-qm', 'base');

const gateClass = (file) => {
  fs.appendFileSync(path.join(DIR, file), '\n');
  git('add', '-A'); git('commit', '-qm', 'x');
  const r = run('gate', '--base', 'HEAD~1');
  const m = r.out.match(/class "([a-z]+)"/);
  return m ? m[1] : (r.out.includes('No governed path') ? 'none' : r.out.slice(0, 80));
};

await check('the Constitution needs an amendment', () => gateClass('journal/constitution/06-offices.md') === 'amendment' || gateClass('journal/constitution/06-offices.md'));
await check('an entrenched Article needs more', () => gateClass('journal/constitution/02-invariants.md') === 'entrenched' || 'wrong class');
await check('the core needs an organic measure', () => gateClass('core/tally.js') === 'organic' || 'wrong class');
await check('the tools need an organic measure', () => gateClass('cli/republic.js') === 'organic' || 'wrong class');
await check('the settings need an organic measure', () => gateClass('republic.yml') === 'organic' || 'wrong class');
await check('the browser signing code needs an organic measure', () => gateClass('site/js/common.js') === 'organic' || 'wrong class');
await check('statute needs a policy measure', () => gateClass('journal/statutes/statute-on-meetings.md') === 'policy' || 'wrong class');
await check('offices need an ordinary measure', () => gateClass('register/offices.yml') === 'ordinary' || 'wrong class');
await check('records need nothing', () => gateClass('ledger/events.jsonl') === 'none' || 'records were gated');
await check('a stylesheet needs nothing', () => gateClass('site/style.css') === 'none' || 'presentation was gated');

let forged = null;

// ballots/ is exempt, so a pull request could carry both a change to the law and
// a result file claiming it carried. The gate counts the signed ballots instead
// of believing that file — art-08/§4/¶5.
await check('a forged result cannot enact a law', () => {
  put('journal/statutes/forge-target.md', '---\nid: forge-target\ntitle: Target\nclass: policy\nversion: 1\n---\n\n## § 1\n\n¹ Original.\n');
  git('add', '-A'); git('commit', '-qm', 'a statute to attack');
  const p0 = run('propose', '--title', 'Sneak', '--by', 'c-0001', '--class', 'policy', '--cites', 'art-01/§4/¶2');
  const id = (p0.out.match(/Received (P-\d{4})/) || [])[1];
  if (!id) return p0.out;
  forged = id;
  put(`ballots/${id}/_result.json`, JSON.stringify({ measure: id, carried: true, open: false, cast: 9, electorate: 1, quorumNeeded: 1, quorumMet: true, counted: [], rejected: [] }));
  fs.appendFileSync(path.join(DIR, 'journal/statutes/forge-target.md'), '\n² Slipped in.\n');
  git('add', '-A'); git('commit', '-qm', 'sneak');
  const r = run('gate', '--base', 'HEAD~1', '--measure', id);
  return (!r.ok && /no ballots|did not carry|does not match/.test(r.out)) || `the forgery passed:\n${r.out}`;
});

await check('a result that disagrees with the ballots is refused', () => {
  const id = forged;
  for (const c of ['c-0001', 'c-0004', 'c-0005', 'c-0006']) run('vote', id, 'yes', '--by', c);
  run('count', id);
  const rf = `ballots/${id}/_result.json`;
  const claimed = JSON.parse(read(rf));
  claimed.cast = 99;
  put(rf, JSON.stringify(claimed));
  fs.appendFileSync(path.join(DIR, 'journal/statutes/forge-target.md'), '\n³ And again.\n');
  git('add', '-A'); git('commit', '-qm', 'mismatch');
  const r = run('gate', '--base', 'HEAD~1', '--measure', id);
  return (!r.ok && /does not match/.test(r.out)) || `a mismatched result passed:\n${r.out}`;
});

await check('a change backed by a real vote passes', () => {
  const p1 = run('propose', '--title', 'Honest', '--by', 'c-0001', '--class', 'policy', '--cites', 'art-01/§4/¶2');
  const id = (p1.out.match(/Received (P-\d{4})/) || [])[1];
  if (!id) return p1.out;
  for (const c of ['c-0001', 'c-0004', 'c-0005', 'c-0006']) run('vote', id, 'yes', '--by', c);
  run('count', id);
  fs.appendFileSync(path.join(DIR, 'journal/statutes/forge-target.md'), '\n⁴ Properly enacted.\n');
  git('add', '-A'); git('commit', '-qm', 'honest');
  const r = run('gate', '--base', 'HEAD~1', '--measure', id);
  return r.ok || `an honest change was refused:\n${r.out}`;
});

console.log('\nIntegrity\n');

await check('the register still verifies', () => { const r = run('verify'); return r.out.includes('verifies') || r.out; });
await check('the doctor finds nothing wrong', () => { const r = run('doctor'); return r.out.includes('Nothing is wrong') || r.out; });
await check('a checkpoint signs and verifies', () => {
  run('checkpoint');
  const r = run('verify');
  return r.out.includes('signed by the Keeper') || r.out;
});
await check('altering a record breaks the chain', () => {
  const f = path.join(DIR, 'ledger/events.jsonl');
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  const backup = lines.join('\n');
  const e = JSON.parse(lines[1]); e.payload = { ...e.payload, tampered: true };
  lines[1] = JSON.stringify(e);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  const broke = !run('verify').ok;
  fs.writeFileSync(f, backup + '\n');
  return broke || 'tampering was not detected';
});
await check('the doctor resolves conflict markers', () => {
  const f = path.join(DIR, 'ledger/events.jsonl');
  const good = fs.readFileSync(f, 'utf8');
  const lines = good.trim().split('\n');
  fs.writeFileSync(f, [...lines.slice(0, 3), '<<<<<<< HEAD', ...lines.slice(3, 6), '=======', ...lines.slice(6), '>>>>>>> origin/main'].join('\n') + '\n');
  if (run('doctor').ok) return 'markers not detected';
  const r = run('doctor', '--repair');
  if (!r.out.includes('markers removed')) return r.out;
  run('checkpoint');
  return run('verify').out.includes('verifies') || 'did not recover';
});
await check('the doctor repairs a merge that duplicated records', () => {
  const f = path.join(DIR, 'ledger/events.jsonl');
  const good = fs.readFileSync(f, 'utf8');
  fs.appendFileSync(f, good.trim().split('\n').slice(0, 5).join('\n') + '\n');
  if (run('doctor').ok) return 'duplication not detected';
  run('doctor', '--repair');
  run('checkpoint');
  return run('verify').out.includes('verifies') || 'did not recover';
});

console.log('\nThe site\n');

await check('the site builds', () => { const r = run('build'); return r.out.includes('Built') || r.out; });
await check('every script it ships parses', () => {
  const bad = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.js')) {
      try { execFileSync('node', ['--check', p], { stdio: 'pipe' }); } catch { bad.push(p.replace(DIR, '')); }
    }
  } };
  walk(path.join(DIR, 'dist/js'));
  return bad.length ? bad.join(', ') : true;
});
await check('no page contains generated JavaScript', () => {
  const bad = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name === 'index.html') {
      const h = fs.readFileSync(p, 'utf8');
      // Only <script src> and one JSON island are allowed.
      for (const m of h.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/json)[^>]*>/g)) bad.push(p.replace(DIR, ''));
    }
  } };
  walk(path.join(DIR, 'dist'));
  return bad.length ? `${bad.length} page(s) carry inline script: ${bad.slice(0, 3).join(', ')}` : true;
});
await check('every JSON island parses', () => {
  const bad = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name === 'index.html') {
      const m = fs.readFileSync(p, 'utf8').match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/);
      if (!m) { bad.push(p.replace(DIR, '') + ' (missing)'); continue; }
      try { JSON.parse(m[1].replace(/\\u003c/g, '<')); } catch (e) { bad.push(p.replace(DIR, '') + ': ' + e.message); }
    }
  } };
  walk(path.join(DIR, 'dist'));
  return bad.length ? bad.slice(0, 3).join('; ') : true;
});
await check('no page shows undefined or NaN', () => {
  const bad = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name === 'index.html' && />undefined<|NaN/.test(fs.readFileSync(p, 'utf8'))) bad.push(p.replace(DIR, ''));
  } };
  walk(path.join(DIR, 'dist'));
  return bad.length ? bad.slice(0, 3).join(', ') : true;
});
await check('the site has no footer', () => {
  let found = 0;
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name === 'index.html' && fs.readFileSync(p, 'utf8').includes('<footer')) found++;
  } };
  walk(path.join(DIR, 'dist'));
  return found === 0 || `${found} pages have one`;
});
await check('the law section carries the Constitution and the statutes', () => {
  const h = read('dist/journal/law/index.html');
  return h.includes('const.art-01') && h.includes('stat.statute-on-meetings') || 'law index incomplete';
});
await check('the site mirrors the corpus on disk', () => {
  for (const p of ['dist/journal/constitution', 'dist/journal/law', 'dist/journal/court', 'dist/journal/issues']) if (!has(p)) return `${p} missing`;
  return true;
});
await check('the browser is served the same counting code', () => {
  const shipped = read('dist/js/core/tally.js');
  const source = read('core/tally.js');
  return shipped === source || 'the shipped tally differs from the core';
});

// Counting, run the way the browser runs it, against a recount by the register
// at the same moment. Both see the same roll, so they must reach the same
// verdict — art-08/§4/¶5. (Comparing against a result recorded earlier would
// compare two different electorates, which is a different question.)
{
  const { tally } = await import(path.join(DIR, 'core/tally.js'));
  const yaml = (await import(path.join(DIR, 'node_modules/js-yaml/dist/js-yaml.mjs'))).default;
  const cfg = yaml.load(read('republic.yml'));
  const roll = JSON.parse(read('dist/data/citizens.json'));

  for (const [id, cls] of [['P-0001', 'policy'], ['P-0003', 'election']]) {
    await check(`the browser and the register agree on ${id}`, async () => {
      run('count', id);                                   // recount now
      const recorded = JSON.parse(read(`ballots/${id}/_result.json`));
      const ballots = JSON.parse(read(`dist/data/ballots/${id}.json`));
      const t = await tally({
        measure: id, spec: cfg.classes[cls], ballots, roll,
        closes: recorded.closes, closeRules: cfg.ballot.close_early,
      });
      const mine = { carried: t.carried, cast: t.cast, winner: t.winner ?? null, quorumMet: t.quorumMet };
      const theirs = { carried: recorded.carried, cast: recorded.cast, winner: recorded.winner ?? null, quorumMet: recorded.quorumMet };
      return JSON.stringify(mine) === JSON.stringify(theirs)
        || `browser ${JSON.stringify(mine)} vs register ${JSON.stringify(theirs)}`;
    });
  }
}

// ---- report --------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) { console.log('Failed:'); for (const f of failures) console.log(`  ${f}`); console.log(''); }
if (KEEP) console.log(`Scratch republic kept at ${DIR}\n`);
else fs.rmSync(DIR, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
