// Measures, voting, closing, enactment, and the Court.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { at, config, classOf } from '../../core/config.js';
import { append } from '../../core/ledger.js';
import { sign } from '../../core/sshsig.js';
import { readKey } from '../../core/keys.js';
import { citizens, active, citizen, offices, holderOf, mayExercise, writeOffices, asDate } from '../../core/registry.js';
import { corpus, frontmatter, normalise, isoDate } from '../../core/corpus.js';
import { tally, closesAt, ballotMessage, receiptOf } from '../../core/tally.js';

const today = () => new Date().toISOString().slice(0, 10);
const salt = () => crypto.randomBytes(8).toString('hex');
const measures = (root) => corpus(root).measures;
const measure = (root, id) => measures(root).find((m) => m.id === id);
const ballotsOf = (root, id) => {
  const dir = path.join(at(root, 'ballots'), id);
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json') && !f.startsWith('_')) out[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return out;
};
const resultOf = (root, id) => {
  const f = path.join(at(root, 'ballots'), id, '_result.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
const delegationsOf = (root) => Object.fromEntries(citizens(root).filter((c) => c.delegate_to).map((c) => [c.id, c.delegate_to]));

async function count(root, id) {
  const m = measure(root, id);
  if (!m) throw Object.assign(new Error(`No measure "${id}".`), { friendly: true });
  const spec = classOf(root, m.class);
  const closes = closesAt(m, spec);
  return {
    m, spec,
    result: await tally({
      measure: id, spec, ballots: ballotsOf(root, id), roll: active(root),
      closes: closes?.toISOString() ?? null, closeRules: config(root).ballot.close_early,
      delegations: delegationsOf(root),
    }),
  };
}

export const propose = {
  group: 'The Assembly',
  summary: 'lay a measure before the Assembly',
  help: `  --title <text>      required
  --class <name>      ${'policy | ordinary | organic | amendment | entrenched | election'}
  --cites a,b         the provisions it is made under; each must resolve
  --by <c-0001>       the sponsor
  --text <text>       the body, or edit the file afterwards
  --authorises <#12>  the one change this measure permits (art-08/§1/¶5)
  --amends <slug>     the statute it replaces
  --office <id>       for an election
  --candidates a,b    for an election`,
  async run({ root, arg }) {
    const title = arg('title'), by = arg('by'), cls = arg('class', 'policy');
    if (!title || !by) { console.error('republic propose --title "..." --by c-0001 [--class policy] [--cites a,b]'); return 2; }
    const spec = classOf(root, cls);
    if (!citizen(root, by) || citizen(root, by).status !== 'active') { console.error(`${by} is not an active citizenship.`); return 1; }

    const { entries } = corpus(root);
    const cites = (arg('cites') || (cls === 'election' ? 'art-06/§3/¶1,art-08/§6/¶1' : '')).split(',').map((s) => s.trim()).filter(Boolean);
    if (!cites.length) { console.error('A measure that cites nothing is not received (art-08/§1/¶3).'); return 1; }
    const bad = cites.filter((c) => !entries.has(normalise(c)));
    if (bad.length) { console.error(`Does not resolve: ${bad.join(', ')} — not received (art-08/§1/¶3).`); return 1; }

    const nums = measures(root).map((m) => Number(String(m.id).replace('P-', ''))).filter(Number.isFinite);
    const id = arg('id', 'P-' + String(Math.max(0, ...nums) + 1).padStart(4, '0'));
    const closes = new Date(Date.now() + spec.window * 86400000).toISOString().slice(0, 10);

    const meta = { id, title, sponsor: by, class: cls, cites, opened: today(), closes };
    if (arg('authorises')) meta.authorises = arg('authorises');
    if (arg('amends')) meta.amends = arg('amends');
    if (cls === 'election') { meta.office = arg('office'); meta.candidates = (arg('candidates') || by).split(',').map((s) => s.trim()); }

    const body = arg('text') || (cls === 'election'
      ? `## § 1  The office\n\n¹ The office of ${meta.office} is filled under Article 8 § 6 ¹.\n\n² The vote is by the single transferable vote in its instant-runoff form.\n`
      : `## § 1\n\n¹ \n`);

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    const file = path.join(at(root, 'proposals'), `${id}-${slug}.md`);
    fs.mkdirSync(at(root, 'proposals'), { recursive: true });
    fs.writeFileSync(file, `---\n${yaml.dump(meta).trim()}\n---\n\n${body}`);

    console.log(`Received ${id} — ${title}`);
    console.log(`  class    ${cls} (${spec.label})`);
    console.log(`  cites    ${cites.join(', ')}`);
    console.log(`  quorum   ${Math.ceil(spec.quorum * active(root).length)} of ${active(root).length}`);
    console.log(`  closes   ${closes}${spec.readings ? `, and must be carried ${spec.readings} times ${spec.apart} days apart` : ''}`);
    console.log(`  ${path.relative(root, file)}`);
    return 0;
  },
};

export const vote = {
  group: 'The Assembly',
  summary: 'sign a ballot',
  help: `  republic vote <P-0002> <yes|no|abstain> --by <c-0001>
  republic vote <P-0002> c-0004,c-0001 --by c-0001    (an election: ranked)

art-08/§3/¶3 — one ballot per citizenship. Voting again replaces the earlier
ballot, and an earlier one never replaces a later.`,
  async run({ root, arg, positional }) {
    const [id, choiceRaw] = positional;
    const by = arg('by');
    if (!id || !choiceRaw || !by) { console.error('republic vote <measure> <choice> --by <citizen>'); return 2; }
    const m = measure(root, id);
    if (!m) { console.error(`No measure "${id}".`); return 1; }

    const choice = choiceRaw.includes(',') ? choiceRaw.split(',').map((s) => s.trim()) : choiceRaw;
    const b = { measure: id, choice, at: new Date().toISOString(), salt: salt() };
    b.signature = await sign(ballotMessage(b), await readKey(root, by), 'republic');

    const dir = path.join(at(root, 'ballots'), id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${by}.json`);
    const replacing = fs.existsSync(file);
    fs.writeFileSync(file, JSON.stringify(b, null, 2) + '\n');

    console.log(`${by} voted on ${id}${replacing ? ', replacing an earlier ballot' : ''}.`);
    console.log(`  receipt ${await receiptOf(b)}`);
    return 0;
  },
};

export const count_ = {
  group: 'The Assembly',
  summary: 'count a measure',
  help: `  republic count <P-0002>

The count is written to ballots/<measure>/_result.json and is reproducible by
anyone from the published ballots — art-08/§4/¶4.`,
  async run({ root, positional }) {
    const id = positional[0];
    if (!id) { console.error('republic count <measure>'); return 2; }
    const { m, spec, result } = await count(root, id);

    console.log(`${id} — ${m.title}`);
    console.log(`class: ${m.class} (${spec.label})`);
    if (result.closes) console.log(`closes: ${result.closes.slice(0, 10)}`);
    console.log('');
    console.log(`Ballots counted: ${result.counted.length}`);
    if (result.delegated.length) console.log(`Delegated: ${result.delegated.map((d) => `${d.from}→${d.to}`).join(', ')}`);
    for (const r of result.rejected) console.log(`  ✗ ${r.id}: ${r.why} (art-08/§3/¶2)`);
    console.log('');

    if (result.election) {
      result.rounds.forEach((r, i) => {
        console.log(`Round ${i + 1}: ${r.counts.map(([c, v]) => `${c} ${v}`).join(' · ')}${r.eliminated ? `  eliminated ${r.eliminated}` : ''}`);
      });
      console.log(`\nquorum ${result.cast}/${result.electorate}, ${result.quorumNeeded} needed — ${result.quorumMet ? 'met' : 'NOT met'}`);
    } else {
      console.log(`  yes ${result.yes}   no ${result.no}   abstain ${result.abstain}`);
      console.log(`  quorum    ${result.cast}/${result.electorate}, ${result.quorumNeeded} needed — ${result.quorumMet ? 'met' : 'NOT met'}`);
      console.log(`  threshold ${(result.share * 100).toFixed(2)}%, ${(result.threshold * 100).toFixed(2)}% needed — ${result.thresholdMet ? 'met' : 'NOT met'}`);
    }
    if (result.closedEarly) console.log(`\n  closed early — ${result.closedEarly} (art-08/§3/¶6)`);
    console.log(result.open ? '\n  OPEN — the count is provisional'
      : result.election ? (result.carried ? `\n  ELECTED ${result.winner} — CARRIED (art-08/§6/¶3)` : '\n  NOT CARRIED')
      : result.carried ? '\n  CARRIED (art-08/§4/¶1)' : '\n  NOT CARRIED (art-08/§4/¶1)');

    console.log('\nReceipts — each citizen may confirm their own (art-08/§4/¶3):');
    for (const b of result.counted) console.log(`  ${b.id}  ${b.receipt}`);

    const dir = path.join(at(root, 'ballots'), id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '_result.json'), JSON.stringify({ ...result, countedAt: new Date().toISOString() }, null, 2));
    return result.open ? 0 : result.carried ? 0 : 1;
  },
};

export const enact = {
  group: 'The Assembly',
  summary: 'give effect to a measure that carried',
  help: `  republic enact <P-0002>

art-08/§5 — a measure that carries is enacted by publication in the Journal.
A measure enacting standing law produces a statute, which is the text in force;
the Journal issue records the act and points at it rather than copying it.`,
  async run({ root, positional }) {
    const id = positional[0];
    if (!id) { console.error('republic enact <measure>'); return 2; }
    const m = measure(root, id);
    if (!m) { console.error(`No measure "${id}".`); return 1; }
    const r = resultOf(root, id);
    if (!r) { console.error(`${id} has not been counted.`); return 1; }
    if (r.open) { console.log(`${id} is still open. Nothing to enact.`); return 0; }
    if (!r.carried) { console.log(`${id} did not carry. Nothing to enact (art-08/§5/¶1).`); return 0; }

    const issues = corpus(root).issues;
    if (issues.some((j) => j.measure === id)) { console.log(`${id} is already published in the Journal.`); return 0; }
    const number = issues.reduce((n, j) => Math.max(n, j.number || 0), 0) + 1;
    const keeper = holderOf(root, 'journal.publish');

    // art-08/§6/¶3 — an election installs its winner.
    if (m.class === 'election' && r.winner) {
      const list = offices(root);
      const o = list.find((x) => x.id === m.office);
      if (!o) { console.error(`${id} elected ${r.winner} to "${m.office}", which is not on the register.`); return 1; }
      const from = o.holder;
      const ends = new Date(); ends.setDate(ends.getDate() + config(root).offices.term);
      o.holder = r.winner; o.since = today(); o.term_ends = ends.toISOString().slice(0, 10); o.under = id;
      writeOffices(root, list);
      append(root, { author: r.winner, kind: 'office.taken', provision: 'art-06/§3/¶1', payload: { office: m.office, holder: r.winner, from, measure: id } });
      console.log(`  ${r.winner} takes ${m.office} until ${o.term_ends} — art-06/§3/¶1`);
    }

    // art-08/§5/¶3 — standing law becomes a statute, which is the text in force.
    const STANDING = ['policy', 'ordinary', 'organic'];
    let statuteId = null;
    if (STANDING.includes(m.class)) {
      const slug = m.amends || (m.title || id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      statuteId = slug;
      const file = path.join(at(root, 'statutes'), `${slug}.md`);
      fs.mkdirSync(at(root, 'statutes'), { recursive: true });
      let version = 1, history = [];
      if (fs.existsSync(file)) {
        const [prior] = frontmatter(fs.readFileSync(file, 'utf8'));
        version = (prior.version || 1) + 1;
        history = [...(prior.history || []), `${prior.version || 1}: ${prior.measure} (Journal ${prior.journal})`];
        fs.mkdirSync(path.join(at(root, 'statutes'), 'superseded'), { recursive: true });
        fs.writeFileSync(path.join(at(root, 'statutes'), 'superseded', `${slug}.v${prior.version || 1}.md`), fs.readFileSync(file, 'utf8'));
      }
      fs.writeFileSync(file, `---\n${yaml.dump({
        id: slug, title: m.title, class: m.class, version,
        enacted: today(), measure: id, journal: number,
        ...(history.length ? { history } : {}), cites: m.cites || [],
      }).trim()}\n---\n\n${m.body}\n`);
      append(root, { author: keeper?.holder || m.sponsor, kind: version > 1 ? 'statute.amended' : 'statute.enacted', provision: 'art-08/§5/¶3', payload: { statute: slug, measure: id, journal: number, version } });
      console.log(`  ${version > 1 ? `stat.${slug} amended to version ${version}` : `stat.${slug} written`} — ${path.relative(root, file)}`);
    }

    const year = today().slice(0, 4);
    fs.mkdirSync(path.join(at(root, 'issues'), year), { recursive: true });
    fs.writeFileSync(path.join(at(root, 'issues'), year, `${String(number).padStart(4, '0')}-${id.toLowerCase()}.md`), `---\n${yaml.dump({
      number, date: today(), measure: id, class: m.class, title: m.title,
      ...(statuteId ? { statute: statuteId } : {}),
      ...(m.class === 'election' && r.winner ? { office: m.office, elected: r.winner } : {}),
      cites: ['art-08/§5/¶1'],
    }).trim()}\n---\n\n${m.class === 'election'
      ? `${r.winner} was elected ${m.office} and takes the office on publication of this issue — Article 6 § 3 ¹.`
      : `${m.title} was carried by the Assembly and is enacted by publication in this issue — Article 8 § 5 ¹.`}

Of ${r.cast} ballot${r.cast === 1 ? '' : 's'} cast against an electorate of ${r.electorate}, ${r.election ? r.cast : r.yes} were in favour and ${r.election ? 0 : r.no} against.

${statuteId ? `The text in force is stat.${statuteId}. It is amended only by a further measure, and every version is recorded there.` : `The measure is ${id}. It enacts no standing law.`}
`);

    append(root, { author: keeper?.holder || m.sponsor, kind: 'measure.enacted', provision: 'art-08/§5/¶1', payload: { measure: id, class: m.class, journal: number } });
    console.log(`Enacted ${id}. Journal issue ${number}.`);
    return 0;
  },
};

export const close = {
  group: 'The Assembly',
  summary: 'close and enact every measure that is due',
  help: `  republic close [P-0002] [--dry-run]

art-08/§3/¶5 — voting closes at the earlier of the end of the period, or the
moment the outcome can no longer change. A measure so closed is enacted at once;
there is nothing left to deliberate.`,
  async run({ root, positional, flag }) {
    const only = positional[0];
    const dry = flag('dry-run');
    const due = [];

    for (const m of measures(root)) {
      if (only && m.id !== only) continue;
      const r0 = resultOf(root, m.id);
      if (r0 && !r0.open && corpus(root).issues.some((j) => j.measure === m.id)) continue;
      const { result } = await count(root, m.id);
      if (!result.open) due.push({ id: m.id, title: m.title, why: result.closedEarly || 'the period has ended' });
    }

    if (!due.length) { console.log(only ? `${only} is not due to close.` : 'Nothing is due to close.'); return 0; }
    console.log(`${due.length} measure(s) due:\n`);
    for (const d of due) console.log(`  ${d.id} — ${d.title}\n      ${d.why}`);
    if (dry) { console.log('\n(dry run — nothing changed)'); return 0; }

    let closed = 0, enacted = 0;
    for (const d of due) {
      console.log(`\n=== ${d.id} ===`);
      await count_.run({ root, positional: [d.id], arg: () => null, flag: () => false });
      closed++;
      const r = resultOf(root, d.id);
      if (r?.carried) { await enact.run({ root, positional: [d.id], arg: () => null, flag: () => false }); enacted++; }
    }
    console.log(`\n${closed} closed, ${enacted} enacted.`);
    return 0;
  },
};

export const court = {
  group: 'The Court',
  summary: 'bring a case, decide one, or list the docket',
  help: `  republic court file --against <act> --by <c-0001> --ground "..." [--seeking construe|halt|void|remedy] [--construes a,b]
  republic court judge --case <n> --by <judge> --holding <halt|void|dismissed|construed> --reasons "..."
  republic court list`,
  async run({ root, arg, positional }) {
    const [sub] = positional;
    const dir = at(root, 'judgments');
    const cases = () => corpus(root).judgments;

    if (!sub || sub === 'list') {
      const all = cases();
      const bench = offices(root).filter((o) => (o.powers || []).includes('court.judge'));
      if (!all.length) console.log('No cases.');
      for (const c of all) console.log(`  ${String(c.number).padStart(3)}  ${c.title}\n       against ${c.against} · ${c.seeking} · ${c.holding || 'undecided'}`);
      console.log(`\nBench: ${bench.length ? bench.map((o) => o.holder).join(', ') : 'none elected — the Assembly sits as the Court (art-07/§1/¶2)'}`);
      return 0;
    }

    if (sub === 'file') {
      const by = arg('by'), against = arg('against'), ground = arg('ground'), seeking = arg('seeking', 'construe');
      if (!by || !against || !ground) { console.error('republic court file --against <act> --by <citizen> --ground "..."'); return 2; }
      if (!citizen(root, by) || citizen(root, by).status !== 'active') { console.error(`${by} is not an active citizenship.`); return 1; }

      const { entries } = corpus(root);
      const construes = (arg('construes') || '').split(',').map((s) => s.trim()).filter(Boolean);
      const bad = construes.filter((c) => !entries.has(normalise(c)));
      if (bad.length) { console.error(`Does not resolve: ${bad.join(', ')} (art-07/§4/¶2).`); return 1; }

      const number = cases().reduce((n, c) => Math.max(n, c.number || 0), 0) + 1;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${String(number).padStart(4, '0')}-${String(against).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`), `---\n${yaml.dump({
        number, title: arg('title', `${by} v ${against}`), against, applicant: by, seeking,
        filed: today(), construes, cites: ['art-07/§2/¶1', 'art-09/§4/¶2'],
      }).trim()}\n---\n\n## § 1  The application\n\n¹ ${by} applies in respect of ${against}.\n\n## § 2  Ground\n\n¹ ${ground}\n\n## § 3  Answer\n\n¹ *To be completed by the respondent, or left blank.*\n`);
      append(root, { author: by, kind: 'case.filed', provision: 'art-09/§4/¶2', payload: { case: number, against, seeking, applicant: by } });
      console.log(`Filed case ${number} against ${against}.`);
      return 0;
    }

    if (sub === 'judge') {
      const by = arg('by'), n = Number(arg('case')), holding = arg('holding'), reasons = arg('reasons');
      if (!by || !n || !holding || !reasons) { console.error('republic court judge --case <n> --by <judge> --holding <h> --reasons "..."'); return 2; }
      const bench = offices(root).filter((o) => (o.powers || []).includes('court.judge'));
      const seated = bench.some((o) => o.holder === by);
      const assembly = bench.length === 0 && active(root).some((c) => c.id === by);
      if (!seated && !assembly) { console.error(`${by} does not sit. The bench is ${bench.map((o) => o.holder).join(', ') || 'empty'} (art-07/§1).`); return 1; }

      const c = cases().find((x) => x.number === n);
      if (!c) { console.error(`No case ${n}.`); return 1; }
      if (c.holding) { console.error(`Case ${n} was decided: ${c.holding}.`); return 1; }

      const src = fs.readFileSync(c.path, 'utf8');
      const [meta, body] = frontmatter(src);
      Object.assign(meta, { holding, decided: today(), bench: seated ? by : `${by} (Assembly sitting as the Court)` });
      fs.writeFileSync(c.path, `---\n${yaml.dump(meta).trim()}\n---\n${body}\n## § 4  Judgment\n\n¹ The Court holds: **${holding}**.\n\n² Reasons: ${reasons}\n\n³ Provisions construed: ${(meta.construes || []).join(', ') || 'none'}.\n\n⁴ Published under Article 7 § 4 ³.\n`);
      append(root, { author: by, kind: 'judgment.given', provision: 'art-07/§4/¶3', payload: { case: n, against: c.against, holding } });
      if (holding === 'halt' || holding === 'void') {
        append(root, { author: by, kind: holding === 'halt' ? 'act.halted' : 'act.voided', provision: 'art-07/§3', payload: { case: n, act: c.against } });
      }
      console.log(`Case ${n} decided: ${holding}.`);
      return 0;
    }

    console.error('republic court <file|judge|list>');
    return 2;
  },
};
