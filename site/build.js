// Building the public site.
//
// The old approach generated JavaScript by string concatenation, and every
// escaping mistake became a page whose script silently failed. Here:
//
//   HTML is generated;
//   JavaScript is NOT — site/js/*.js are static files, copied verbatim;
//   data reaches them through a <script type="application/json"> island.
//
// A page therefore cannot have a syntax error introduced by the builder. That
// whole class of fault is gone rather than guarded against.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { at, config } from '../core/config.js';
import { corpus, linkify, slug, isoDate, hrefOf, frontmatter as frontmatterOf, MARKS } from '../core/corpus.js';
import { records, verifyChain, checkpoints } from '../core/ledger.js';
import { citizens, active, entities, offices, asDate } from '../core/registry.js';
import { state, accounts, bookOf, matchBook, TREASURY } from '../core/value.js';
import { closesAt } from '../core/tally.js';
import { powersOf, electorateOf, resolutions as resolutionsOf, countResolution } from '../core/governance.js';
import { diffLines, pairEdits, summarise, locate, hunks } from '../core/diff.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function buildSite(root, { base = '' } = {}) {
  const cfg = config(root);
  const C = corpus(root);
  const B = base.replace(/\/$/, '');
  const u = (p) => B + p;
  const link = (t) => linkify(t, C.entries, { esc, base: B });

  const OUT = at(root, 'dist');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

  // Static assets, copied byte for byte. Nothing is generated into them.
  fs.cpSync(path.join(HERE, 'js'), path.join(OUT, 'js'), { recursive: true });

  // The browser runs the same modules as the command line, copied verbatim.
  // Not a port, not a re-implementation — the same files.
  fs.mkdirSync(path.join(OUT, 'js/core'), { recursive: true });
  for (const f of ['canonical.js', 'sshsig.js', 'tally.js', 'diff.js']) {
    fs.copyFileSync(path.join(HERE, '..', 'core', f), path.join(OUT, 'js/core', f));
  }
  fs.copyFileSync(path.join(HERE, 'style.css'), path.join(OUT, 'style.css'));

  const ev = records(root);
  const chain = verifyChain(root);
  const roll = citizens(root);
  const live = active(root);
  const ents = entities(root);
  const offs = offices(root);
  const V = state(root);
  const ACCT = accounts(root);
  const UNIT = cfg.value.unit;

  const repo = process.env.GITHUB_REPOSITORY || 'virtual-republic/republic';
  const branch = process.env.GITHUB_BRANCH || 'main';

  // ---- pages -----------------------------------------------------------------

  const NAV = [['', 'Republic'], ['journal', 'Journal'], ['assembly', 'Assembly'],
               ['office', 'Office'], ['register', 'Register'], ['value', 'Value'],
               ['exchange', 'Exchange'], ['ledger', 'Ledger']];
  const SUB = [['journal/constitution', 'Constitution'], ['journal/law', 'Law'],
               ['journal/court', 'Court'], ['journal/deeds', 'Deeds'], ['journal/issues', 'Issues']];

  let pageCount = 0;

  function page(title, body, { on = '', module: mod = null, data = null, wide = false } = {}) {
    const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(cfg.name)}</title>
<link rel="stylesheet" href="${u('/style.css')}">
<body>
<header class="top">
  <a class="name" href="${u('/')}">${esc(cfg.name)}</a>
  <nav>${NAV.map(([s, l]) => `<a href="${u('/' + s + (s ? '/' : ''))}"${on === s || (s === 'journal' && on.startsWith('journal')) ? ' class="on"' : ''}>${esc(l)}</a>`).join('')}</nav>
  <span class="who"><a href="${u('/key/')}" data-whoami>sign in</a></span>
</header>
<main${wide ? '' : ' class="narrow"'}>
${on.startsWith('journal') ? `<nav class="sub">${SUB.map(([s, l]) => `<a href="${u('/' + s + '/')}"${on === s ? ' class="on"' : ''}>${esc(l)}</a>`).join('')}</nav>` : ''}
${body}
</main>
<script type="application/json" id="page-data">${JSON.stringify({ base: B, repo, branch, ...(data || {}) }).replace(/</g, '\\u003c')}</script>
<script type="module" src="${u('/js/common.js')}"></script>
${mod ? `<script type="module" src="${u(`/js/${mod}.js`)}"></script>` : ''}
</body></html>`;
    return html;
  }

  const write = (rel, html) => {
    const f = path.join(OUT, rel, 'index.html');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, html);
    pageCount++;
  };

  // Two grid children only — the mark, and one span holding all the text — so
  // links inside a paragraph stay inline.
  const para = (n, text, id, cite) =>
    `<p class="para"${id ? ` id="${id}"` : ''}>` +
    (cite ? `<a class="mark" href="#${id}" data-cite="${esc(cite)}">${n}</a>` : `<span class="mark">${n}</span>`) +
    `<span class="text">${link(text)}</span></p>`;

  const sections = (secs, citeBase) => secs.map((s) => {
    const c = citeBase ? `${citeBase}/§${s.num}` : null;
    return `<section class="sec" id="s${s.num}">
      <h2><span class="n">§ ${s.num}</span> ${esc(s.heading)}${c ? `<a class="anchor" href="#s${s.num}" data-cite="${esc(c)}" title="copy citation">§</a>` : ''}</h2>
      ${s.paragraphs.map((p) => para(p.num, p.text, `s${s.num}p${p.num}`, c ? `${c}/¶${p.num}` : null)).join('')}
    </section>`;
  }).join('');

  // Markdown, enough for a Journal issue or a judgment.
  function markdown(src) {
    const out = [];
    let list = null, para_ = [], item = null, mark = null;
    const inline = (t) => link(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const flushItem = () => { if (item) { out[out.length - 1] = `<li>${inline(item.join(' '))}</li>`; item = null; } };
    const flushMark = () => { if (mark) { out[out.length - 1] = `<p class="para"><span class="mark">${mark.n}</span><span class="text">${inline(mark.t.join(' '))}</span></p>`; mark = null; } };
    const flushPara = () => { flushItem(); flushMark(); if (para_.length) { out.push(`<p>${inline(para_.join(' '))}</p>`); para_ = []; } };
    const flushList = () => { flushItem(); if (list) { out.push(`</${list}>`); list = null; } };

    for (const raw of String(src).split('\n')) {
      const line = raw.trim();
      if (!line) { flushPara(); continue; }
      if (/^---+$/.test(line)) { flushPara(); flushList(); out.push('<hr class="rule">'); continue; }
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { flushPara(); flushList(); out.push(`<h${Math.min(h[1].length + 1, 4)}>${inline(h[2])}</h${Math.min(h[1].length + 1, 4)}>`); continue; }
      const ul = line.match(/^[-*]\s+(.*)$/);
      if (ul) { flushPara(); if (list !== 'ul') { flushList(); out.push('<ul class="md">'); list = 'ul'; } item = [ul[1]]; out.push(''); continue; }
      const ol = line.match(/^\d+[.)]\s+(.*)$/);
      if (ol) { flushPara(); if (list !== 'ol') { flushList(); out.push('<ol class="md">'); list = 'ol'; } item = [ol[1]]; out.push(''); continue; }
      const q = line.match(/^>\s?(.*)$/);
      if (q) { flushPara(); flushList(); out.push(`<blockquote>${inline(q[1])}</blockquote>`); continue; }
      const mk = line.match(new RegExp(`^([${MARKS}])\\s+(.*)$`));
      if (mk) { flushPara(); flushList(); mark = { n: MARKS.indexOf(mk[1]) + 1, t: [mk[2]] }; out.push(''); continue; }
      if (item) { item.push(line); continue; }
      if (mark) { mark.t.push(line); continue; }
      flushList(); para_.push(line);
    }
    flushPara(); flushList();
    return out.filter(Boolean).join('\n');
  }

  // Backlinks: every act, keyed by what it cites.
  const back = new Map();
  const cite = (id, e) => {
    const n = id.includes('.') ? id : 'const.' + id;
    if (!back.has(n)) back.set(n, []);
    back.get(n).push(e);
    const parts = n.split('/');
    if (parts.length === 3) cite(parts.slice(0, 2).join('/'), e);
    if (parts.length === 2) cite(parts[0], e);
  };
  for (const e of ev) cite(String(e.provision), { label: e.kind, href: `/ledger/#r${e.seq}`, at: e.at });
  for (const j of C.issues) for (const c of [].concat(j.cites || [])) cite(String(c), { label: `Journal ${j.number}`, href: `/journal/issues/${j.number}/`, at: j.date });
  for (const m of C.measures) for (const c of [].concat(m.cites || [])) cite(String(c), { label: m.id, href: `/assembly/${m.id}/`, at: m.opened });

  // ---- measure status --------------------------------------------------------
  const resultOf = (id) => {
    const f = path.join(at(root, 'ballots'), id, '_result.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  };
  const statusOf = (m) => {
    const r = resultOf(m.id);
    if (r && !r.open) {
      if (r.winner) return { open: false, label: r.carried ? `elected ${r.winner}` : 'no result', carried: r.carried };
      return { open: false, label: r.carried ? 'carried' : 'not carried', carried: r.carried };
    }
    const c = closesAt(m, cfg.classes[m.class] || { window: 7 });
    if (c && new Date() >= c) return { open: false, label: 'closed, not yet counted', carried: false };
    return { open: true, label: 'open', carried: false };
  };

  // ---- home ------------------------------------------------------------------

  const openMeasures = C.measures.filter((m) => statusOf(m).open);
  write('', page('Republic', `
    <h1>${esc(cfg.name)}<span class="sub">${esc(cfg.motto)}</span></h1>
    <p class="lede">A voluntary civic association governed by a text its citizens wrote. Every act is recorded, published, and verifiable by anyone.</p>

    <h2>Before the Assembly</h2>
    <ul class="list">${openMeasures.length ? openMeasures.slice().reverse().map((m) =>
      `<li><a href="${u(`/assembly/${m.id}/`)}">${esc(m.title)}</a><span class="meta">closes ${esc(m.closes || '')}</span></li>`).join('')
      : '<li class="quiet">Nothing is before the Assembly.</li>'}</ul>

    <h2>Law in force</h2>
    <ul class="list">${C.statutes.length ? C.statutes.map((s) =>
      `<li><a href="${u(`/journal/law/${s.id}/`)}">${esc(s.title || s.id)}</a><span class="meta">${esc(isoDate(s.enacted))}</span></li>`).join('')
      : '<li class="quiet">Nothing enacted yet.</li>'}</ul>

    <h2>State</h2>
    <table><tbody>
      <tr><td class="q">Citizens</td><td>${live.length}</td></tr>
      <tr><td class="q">Entities</td><td>${ents.filter((e) => e.status === 'active').length}</td></tr>
      <tr><td class="q">Records</td><td>${ev.length}</td></tr>
      <tr><td class="q">Register</td><td>${chain.ok ? 'verifies' : 'DOES NOT VERIFY'}</td></tr>
    </tbody></table>`, { on: '' }));

  // ---- journal ----------------------------------------------------------------

  write('journal', page('Journal', `
    <h1>Journal<span class="sub">Everything the Republic has published. Publication is promulgation — art-05/§2/¶2.</span></h1>
    <table><tbody>
      <tr><td><a href="${u('/journal/constitution/')}">Constitution</a></td><td class="q">${C.articles.length} articles · the highest law</td></tr>
      <tr><td><a href="${u('/journal/law/')}">Law</a></td><td class="q">${C.statutes.length} statute${C.statutes.length === 1 ? '' : 's'} in force</td></tr>
      <tr><td><a href="${u('/journal/court/')}">Court</a></td><td class="q">${C.judgments.length} case${C.judgments.length === 1 ? '' : 's'}</td></tr>
      <tr><td><a href="${u('/journal/deeds/')}">Deeds</a></td><td class="q">${C.deeds.length} recognised</td></tr>
      <tr><td><a href="${u('/journal/issues/')}">Issues</a></td><td class="q">${C.issues.length} issue${C.issues.length === 1 ? '' : 's'}</td></tr>
    </tbody></table>
    <p class="note">On disk this is one directory. The site follows the corpus rather than inventing a second arrangement.</p>`,
    { on: 'journal' }));

  write('journal/constitution', page('Constitution', `
    <h1>Constitution</h1>
    <ol class="contents">${C.articles.map((a) =>
      `<li><span class="n">${esc(String(a.id).replace('art-', ''))}</span><a href="${u(`/journal/constitution/${slug(a.id)}/`)}">${esc(a.title)}</a>${a.entrenched ? '<span class="meta">entrenched</span>' : ''}</li>`).join('')}</ol>`,
    { on: 'journal/constitution' }));

  for (const a of C.articles) {
    write(`journal/constitution/${slug(a.id)}`, page(a.title, `
      <p class="crumb"><a href="${u('/journal/constitution/')}">Constitution</a> · ${esc(a.id)}</p>
      <article class="law">
        <h1>${esc(a.title)}${a.entrenched ? '<span class="sub">Entrenched — art-12/§2/¶1</span>' : ''}</h1>
        ${a.note ? `<div class="note">${markdown(a.note.replace(/^\*|\*$/g, ''))}</div>` : ''}
        ${sections(a.sections, `const.${a.id}`)}
      </article>`, { on: 'journal/constitution' }));

    for (const s of a.sections) {
      for (const t of [{ bare: `${a.id}/§${s.num}`, only: null }, ...s.paragraphs.map((p) => ({ bare: `${a.id}/§${s.num}/¶${p.num}`, only: p.num }))]) {
        const id = 'const.' + t.bare;
        const links = back.get(id) || [];
        const ps = t.only ? s.paragraphs.filter((p) => p.num === t.only) : s.paragraphs;
        write(`journal/constitution/${slug(t.bare)}`, page(t.bare, `
          <p class="crumb"><a href="${u('/journal/constitution/')}">Constitution</a> · <a href="${u(`/journal/constitution/${slug(a.id)}/`)}">${esc(a.title)}</a> · § ${s.num}${t.only ? ' ¶ ' + t.only : ''}</p>
          <h1>${esc(s.heading)}<span class="sub">${esc(id)}</span></h1>
          <article class="law">${ps.map((p) => para(p.num, p.text)).join('')}</article>
          <div class="row"><button class="plain" data-copy="${esc(id)}">copy citation</button></div>
          <h2>Acts under this provision</h2>
          ${links.length ? `<ul class="list">${links.map((l) => `<li><a href="${u(l.href)}">${esc(l.label)}</a><span class="meta">${esc(String(l.at || '').slice(0, 10))}</span></li>`).join('')}</ul>` : '<p class="quiet">None yet.</p>'}`,
          { on: 'journal/constitution' }));
      }
    }
  }

  // Law index: the Constitution is law like any other, listed with it.
  const lawRows = [
    ...C.articles.map((a) => ({ href: u(`/journal/constitution/${slug(a.id)}/`), title: a.title, cls: a.entrenched ? 'Constitution (entrenched)' : 'Constitution', version: '', when: '', cite: `const.${a.id}`, sortId: a.id })),
    ...C.statutes.map((s) => ({ href: u(`/journal/law/${s.id}/`), title: s.title || s.id, cls: cfg.classes[s.class]?.label || s.class || '', version: s.version || 1, when: isoDate(s.enacted), cite: `stat.${s.id}`, sortId: s.id })),
  ];
  write('journal/law', page('Law', `
    <h1>Law in force<span class="sub">One corpus. The Constitution is the highest law and is listed with the rest — art-01/§3/¶1.</span></h1>
    <div class="row">
      <button class="plain" data-sort="title">title</button>
      <button class="plain" data-sort="class">class</button>
      <button class="plain" data-sort="enacted">date</button>
      <button class="plain" data-sort="id">identifier</button>
    </div>
    <table id="laws"><thead><tr><th>Text</th><th>Class</th><th>Version</th><th>In force since</th><th>Cite as</th></tr></thead>
    <tbody>${lawRows.map((r) => `<tr data-title="${esc(r.title)}" data-class="${esc(r.cls)}" data-enacted="${esc(r.when)}" data-id="${esc(r.sortId)}">
      <td><a href="${r.href}">${esc(r.title)}</a></td><td class="q">${esc(r.cls)}</td><td class="q">${r.version}</td>
      <td class="q">${esc(r.when)}</td><td class="q">${esc(r.cite)}</td></tr>`).join('')}</tbody></table>`,
    { on: 'journal/law', module: 'law', wide: true }));

  for (const s of C.statutes) {
    const cited = back.get(`stat.${s.id}`) || [];
    write(`journal/law/${s.id}`, page(s.title || s.id, `
      <p class="crumb"><a href="${u('/journal/law/')}">Law</a> · stat.${esc(s.id)}</p>
      <h1>${esc(s.title || s.id)}<span class="sub">${esc(cfg.classes[s.class]?.label || s.class || '')}${s.version ? ' · version ' + s.version : ''}${s.enacted ? ' · in force since ' + esc(isoDate(s.enacted)) : ''}${s.measure ? ' · ' + esc(s.measure) : ''}</span></h1>
      <div class="row">
        <button class="plain" data-copy="stat.${esc(s.id)}">copy citation</button>
        <button id="revise">Propose a revision</button>
      </div>
      <p class="note">Editing statute is an act of the Assembly — art-08/§5/¶1. A revision is a measure like any other: it goes to a vote, and until it carries the text below is what is in force.</p>

      <div id="editor" hidden>
        <h2>Revise</h2>
        <p data-msg class="msg quiet"></p>
        <label for="rtitle">Title of the measure</label><input type="text" id="rtitle" value="${esc(s.title || s.id)}">
        <label for="rclass">Class</label><select id="rclass">${Object.entries(cfg.classes).filter(([k]) => k !== 'election').map(([k, v]) => `<option value="${esc(k)}"${k === s.class ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select>

        <div class="editorbar">
          <button type="button" class="plain" data-ins="section">new §</button>
          <button type="button" class="plain" data-ins="paragraph">new ¶</button>
          <button type="button" class="plain" data-cite-open>insert a citation</button>
          <button type="button" class="plain" data-preview>see the changes</button>
        </div>
        <textarea id="rtext" rows="20" spellcheck="false"></textarea>

        <div id="citepicker" hidden>
          <h3>Cite a provision</h3>
          <label for="cbody">Body of law</label><select id="cbody"></select>
          <label for="cdoc">Text</label><select id="cdoc"></select>
          <label for="csec">§</label><select id="csec"></select>
          <label for="cpar">¶</label><select id="cpar"></select>
          <p class="quiet" data-citepreview>—</p>
          <div class="row"><button type="button" data-cite-insert>Insert</button><button type="button" class="plain" data-cite-close>close</button></div>
        </div>

        <div id="preview" hidden></div>

        <label for="rcites">Provisions the measure is made under, one per line</label>
        <textarea id="rcites" rows="2">${esc(([].concat(s.cites || [])).join('\n'))}</textarea>
        <div class="row"><button id="rprepare">Prepare the measure</button><a data-commit class="button" hidden>Open on GitHub</a></div>
        <div data-out class="out" hidden></div>
      </div>
      <article class="law">${sections(s.sections, `stat.${s.id}`)}</article>
      ${(s.history || []).length ? `<h2>Earlier versions</h2><ul class="list">${[].concat(s.history).map((h) => `<li class="quiet">${esc(String(h))}</li>`).join('')}</ul>` : ''}
      ${s.journal ? `<h2>Promulgated</h2><ul class="list"><li><a href="${u(`/journal/issues/${s.journal}/`)}">Journal ${s.journal}</a></li>${s.measure ? `<li><a href="${u(`/assembly/${s.measure}/`)}">${esc(s.measure)}</a></li>` : ''}</ul>` : ''}
      ${cited.length ? `<h2>Cited by</h2><ul class="list">${cited.map((l) => `<li><a href="${u(l.href)}">${esc(l.label)}</a><span class="meta">${esc(String(l.at || '').slice(0, 10))}</span></li>`).join('')}</ul>` : ''}`,
      { on: 'journal/law', module: 'revise', data: {
        statute: s.id,
        text: fs.readFileSync(s.path, 'utf8').split(/\n---\n/).slice(1).join('\n---\n').trim(),
        classes: cfg.classes,
        cites: [].concat(s.cites || []),
        next: 'P-' + String(C.measures.reduce((n, m) => Math.max(n, Number(String(m.id).replace('P-', '')) || 0), 0) + 1).padStart(4, '0'),
      } }));
  }

  write('journal/issues', page('Journal', `
    <h1>Issues<span class="sub">Publication is promulgation — art-05/§2/¶2.</span></h1>
    <ul class="list">${C.issues.slice().reverse().map((j) =>
      `<li><a href="${u(`/journal/issues/${j.number}/`)}">No. ${j.number} · ${esc(j.title || '')}</a><span class="meta">${esc(j.date)}</span></li>`).join('')
      || '<li class="quiet">No issues yet.</li>'}</ul>`, { on: 'journal/issues' }));

  for (const j of C.issues) {
    const st = j.statute ? C.statutes.find((s) => s.id === j.statute) : null;
    write(`journal/issues/${j.number}`, page(j.title || `Issue ${j.number}`, `
      <p class="crumb"><a href="${u('/journal/issues/')}">Journal</a> · No. ${j.number}</p>
      <h1>${esc(j.title || 'Issue ' + j.number)}<span class="sub">No. ${j.number} · ${esc(j.date)}${j.measure ? ' · ' + esc(j.measure) : ''}</span></h1>
      <article class="law">${markdown(j.body)}</article>
      ${st ? `<h2>The text in force</h2>
        <p class="quiet">stat.${esc(st.id)}${st.version ? ', version ' + st.version : ''} — kept once, shown here. <a href="${u(`/journal/law/${st.id}/`)}">Open the statute</a>.</p>
        <article class="law">${sections(st.sections, `stat.${st.id}`)}</article>` : ''}
      ${j.measure ? `<h2>The measure</h2><ul class="list"><li><a href="${u(`/assembly/${j.measure}/`)}">${esc(j.measure)}</a>${j.elected ? `<span class="meta">elected ${esc(j.elected)}</span>` : ''}</li></ul>` : ''}`,
      { on: 'journal/issues' }));
  }

  // ---- court -------------------------------------------------------------------

  const bench = offs.filter((o) => (o.powers || []).includes('court.judge'));
  write('journal/court', page('Court', `
    <h1>Court<span class="sub">Decides disputes under this Constitution, reviews acts for consistency with it, and construes the text — art-07/§2.</span></h1>
    <h2>The bench</h2>
    ${bench.length ? `<table><thead><tr><th>Judge</th><th>Until</th><th>May</th></tr></thead>
    <tbody>${bench.map((o) => `<tr><td>${esc(o.holder)}</td><td class="q">${esc(asDate(o.term_ends))}</td><td class="q">halt an act · declare it of no effect · give judgment</td></tr>`).join('')}</tbody></table>
    <p class="note">The Court may not transfer value and holds no power over the Treasury — art-07/§3/¶4.</p>`
    : '<p class="quiet">No Judge is elected, so the Assembly exercises the Court\u2019s functions — art-07/§1/¶2.</p>'}

    <h2>Cases</h2>
    <ul class="list">${C.judgments.length ? C.judgments.slice().reverse().map((j) =>
      `<li><a href="${u(`/journal/court/${j.number}/`)}">${esc(j.title || 'Case ' + j.number)}</a><span class="meta">${esc(j.holding || 'undecided')}</span></li>`).join('')
      : '<li class="quiet">No case has been brought.</li>'}</ul>

    <h2>Bring a case</h2>
    <p data-msg class="msg quiet"></p>
    <label for="against">The act complained of</label><input type="text" id="against" placeholder="P-0004, or stat.some-statute">
    <label for="seeking">Seeking</label>
    <select id="seeking">
      <option value="construe">that a provision be construed — art-07/§2/¶3</option>
      <option value="halt">that the act be halted — art-07/§3/¶1</option>
      <option value="void">that the act be declared of no effect — art-07/§3/¶2</option>
      <option value="remedy">a remedy under Article 9 — art-07/§3/¶3</option>
    </select>
    <label for="construes">Provisions construed, comma separated</label><input type="text" id="construes" placeholder="art-08/§1/¶3">
    <label for="ground">Ground</label><textarea id="ground" rows="5"></textarea>
    <div class="row"><button id="file" disabled>Prepare the application</button><a data-commit class="button" hidden>Open on GitHub</a></div>
    <div data-out class="out" hidden></div>`,
    { on: 'journal/court', module: 'court', data: { next: C.judgments.reduce((n, j) => Math.max(n, j.number || 0), 0) + 1 } }));

  for (const j of C.judgments) {
    write(`journal/court/${j.number}`, page(j.title || `Case ${j.number}`, `
      <p class="crumb"><a href="${u('/journal/court/')}">Court</a> · case ${j.number}</p>
      <h1>${esc(j.title || 'Case ' + j.number)}<span class="sub">${j.holding ? 'decided ' + esc(j.decided) + ' — ' + esc(j.holding) : 'undecided'} · filed ${esc(j.filed)}</span></h1>
      <table><tbody>
        <tr><td class="q">Applicant</td><td>${esc(j.applicant || '')}</td></tr>
        <tr><td class="q">Act complained of</td><td>${link(String(j.against || ''))}</td></tr>
        <tr><td class="q">Seeking</td><td>${esc(j.seeking || '')}</td></tr>
        ${j.bench ? `<tr><td class="q">Bench</td><td>${esc(j.bench)}</td></tr>` : ''}
      </tbody></table>
      <article class="law">${markdown(j.body)}</article>
      ${[].concat(j.construes || []).length ? `<h2>Provisions construed</h2><ul class="list">${[].concat(j.construes).map((c) => `<li>${link(String(c))}</li>`).join('')}</ul>` : ''}`,
      { on: 'journal/court' }));
  }

  // ---- deeds ------------------------------------------------------------------

  const keeperOffice = offs.find((o) => (o.powers || []).includes('deed.recognise'));
  const requestedDir = path.join(at(root, 'deeds'), 'requested');
  const requested = fs.existsSync(requestedDir)
    ? fs.readdirSync(requestedDir).filter((f) => f.endsWith('.md'))
        .map((f) => { const [m, b] = frontmatterOf(fs.readFileSync(path.join(requestedDir, f), 'utf8')); return { ...m, body: b }; })
    : [];
  const pendingDeeds = requested.filter((d) => d.status === 'requested');
  const refusedDeeds = requested.filter((d) => d.status === 'refused');

  write('journal/deeds', page('Deeds', `
    <h1>Deeds<span class="sub">Recognised title. A deed is valid only when the Keeper has recognised it and it is published in the Journal — art-05/§2/¶2.</span></h1>

    <h2>Recognised</h2>
    ${C.deeds.length ? `<table><thead><tr><th>Deed</th><th>Kind</th><th>Held by</th><th>Transferable</th><th>Published</th></tr></thead>
    <tbody>${C.deeds.map((d) => `<tr>
      <td><a href="${u(`/journal/deeds/${d.id}/`)}">${esc(d.title || d.id)}</a></td>
      <td class="q">${esc(d.kind || '')}</td><td>${esc(d.holder)}</td>
      <td class="q">${d.transferable ? 'yes' : 'no'}</td>
      <td class="q">${d.journal ? `<a href="${u(`/journal/issues/${d.journal}/`)}">Journal ${d.journal}</a>` : '—'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="quiet">None recognised.</p>'}

    <h2>Requested</h2>
    <p class="quiet">A request confers nothing. It is not a deed until the Keeper recognises it.</p>
    ${pendingDeeds.length ? `<table><thead><tr><th>Asked for</th><th>By</th><th>For</th><th>Transferable</th></tr></thead>
    <tbody>${pendingDeeds.map((d) => `<tr><td>${esc(d.title || d.id)}</td><td class="q">${esc(d.requested_by)}</td>
      <td class="q">${esc(d.holder)}</td><td class="q">${d.transferable ? 'yes' : 'no'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="quiet">Nothing outstanding.</p>'}

    ${refusedDeeds.length ? `<h2>Refused</h2>
    <table><thead><tr><th>Asked for</th><th>Reasons</th></tr></thead>
    <tbody>${refusedDeeds.map((d) => `<tr><td>${esc(d.title || d.id)}</td><td class="q">${esc(d.reasons || '')}</td></tr>`).join('')}</tbody></table>` : ''}

    <h2>Ask for a deed</h2>
    <p data-msg class="msg quiet"></p>
    <label for="dtitle">What is claimed</label><input type="text" id="dtitle" placeholder="The mill at the river">
    <label for="dkind">Kind</label><select id="dkind">${cfg.deeds.kinds.map((k) => `<option>${esc(k)}</option>`).join('')}</select>
    <label for="dholder">To be held by</label><select id="dholder">${[...ACCT.keys()].map((x) => `<option>${esc(x)}</option>`).join('')}</select>
    <label for="dtransferable">Transferable</label>
    <select id="dtransferable"><option value="no">no — it stays where it is granted</option><option value="yes">yes — the holder may pass it on</option></select>
    <label for="dtext">The deed itself</label><textarea id="dtext" rows="5" placeholder="¹ ..."></textarea>
    <div class="row"><button data-act="request" disabled>Sign the request</button></div>

    <div data-keeper hidden>
      <hr class="rule">
      <h2>Recognise or refuse</h2>
      <p class="quiet">Yours alone — art-05/§2/¶2. Recognition publishes the deed in the Journal, which is what makes it valid.</p>
      <label for="rid">Request</label><select id="rid"></select>
      <div class="row"><button data-act="recognise">Recognise and publish</button></div>
      <label for="rreasons">Reasons for refusing</label><input type="text" id="rreasons">
      <div class="row"><button data-act="refuse" class="plain">Refuse the request</button></div>

      <h3>Recognise one directly</h3>
      <p class="quiet">No request is needed. You may recognise title on your own motion.</p>
      <label for="did">Identifier</label><input type="text" id="did" placeholder="river-mill">
      <label for="dtitle2">What is recognised</label><input type="text" id="dtitle2">
      <label for="dholder2">Held by</label><select id="dholder2">${[...ACCT.keys()].map((x) => `<option>${esc(x)}</option>`).join('')}</select>
      <label for="dtransferable2">Transferable</label>
      <select id="dtransferable2"><option value="no">no</option><option value="yes">yes</option></select>
      <div class="row"><button data-act="recognise-direct">Recognise and publish</button></div>
    </div>

    <div data-out class="out" hidden></div>
    <div class="row"><a data-commit class="button" hidden>Open on GitHub</a></div>`,
    { on: 'journal/deeds', module: 'deeds', data: {
      kinds: cfg.deeds.kinds,
      pending: pendingDeeds.map((d) => ({ id: d.id, title: d.title })),
      keeper: keeperOffice ? { id: keeperOffice.id, title: keeperOffice.title, holder: keeperOffice.holder } : null,
      accounts: [...ACCT.keys()],
    } }));

  for (const d of C.deeds) {
    write(`journal/deeds/${d.id}`, page(d.title || d.id, `
      <p class="crumb"><a href="${u('/journal/deeds/')}">Deeds</a> · deed.${esc(d.id)}</p>
      <h1>${esc(d.title || d.id)}<span class="sub">${esc(d.kind || 'deed')} · held by ${esc(d.holder)} · ${d.transferable ? 'transferable' : 'not transferable'} · recognised ${esc(d.recognised)}</span></h1>
      <table><tbody>
        <tr><td class="q">Cite as</td><td>deed.${esc(d.id)}</td></tr>
        <tr><td class="q">Recognised by</td><td>${esc(d.recognised_by || '')}${d.recognised_directly ? ' <span class="q">on their own motion</span>' : ''}</td></tr>
        <tr><td class="q">Published</td><td>${d.journal ? `<a href="${u(`/journal/issues/${d.journal}/`)}">Journal ${d.journal}</a> — this is what makes it valid` : '—'}</td></tr>
        ${d.requested_by ? `<tr><td class="q">Asked for by</td><td>${esc(d.requested_by)} on ${esc(String(d.requested))}</td></tr>` : ''}
        ${(d.previously || []).length ? `<tr><td class="q">Previously held by</td><td>${[].concat(d.previously).map(esc).join(', ')}</td></tr>` : ''}
      </tbody></table>
      <article class="law">${markdown(d.body)}</article>
      <div class="row"><button class="plain" data-copy="deed.${esc(d.id)}">copy citation</button></div>

      ${d.transferable ? `<h2>Transfer</h2>
      <p data-msg class="msg quiet"></p>
      <label for="to">To</label><select id="to">${[...ACCT.keys()].filter((x) => x !== d.holder).map((x) => `<option>${esc(x)}</option>`).join('')}</select>
      <div class="row"><button data-act="transfer" disabled>Sign the transfer</button><a data-commit class="button" hidden>Open on GitHub</a></div>
      <div data-out class="out" hidden></div>`
      : '<p class="note">This deed is not transferable. It stays where it was granted — art-05/§2/¶2.</p>'}`,
      { on: 'journal/deeds', module: 'deed', data: { deed: d.id, holder: d.holder, transferable: !!d.transferable } }));
  }

  // ---- assembly ------------------------------------------------------------------

  write('assembly', page('Assembly', `
    <h1>Assembly<span class="sub">The Assembly is all citizens — art-06/§2/¶1.</span></h1>
    <ul class="list">${C.measures.length ? C.measures.slice().reverse().map((m) => {
      const s = statusOf(m);
      return `<li><a href="${u(`/assembly/${m.id}/`)}">${esc(m.title)}</a><span class="meta">${m.revises || m.amends ? 'revision of stat.' + esc(m.revises || m.amends) + ' · ' : ''}${esc(cfg.classes[m.class]?.label || m.class)} · ${esc(s.label)}</span></li>`;
    }).join('') : '<li class="quiet">Nothing before the Assembly.</li>'}</ul>

    <h2>Lay a measure</h2>
    <p data-msg class="msg quiet"></p>
    <label for="title">Title</label><input type="text" id="title">
    <label for="cls">Class</label><select id="cls">${Object.entries(cfg.classes).filter(([k]) => k !== 'election').map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)}</option>`).join('')}</select>
    <label for="cites">Provisions it is made under, one per line</label><textarea id="cites" rows="3"></textarea>
    <label for="authorises">Pull request or commit it authorises, if it changes the code or the law (optional)</label><input type="text" id="authorises" placeholder="#12">
    <label for="amends">Statute it replaces, by slug, if it amends one (optional)</label><input type="text" id="amends">
    <label for="body">Text</label>
    <div class="editorbar">
      <button type="button" class="plain" data-ins="section">new §</button>
      <button type="button" class="plain" data-ins="paragraph">new ¶</button>
      <button type="button" class="plain" data-cite-open>insert a citation</button>
    </div>
    <textarea id="body" rows="14" spellcheck="false" placeholder="## § 1  Heading&#10;&#10;¹ ..."></textarea>

    <div id="citepicker" hidden>
      <h3>Cite a provision</h3>
      <label for="cbody">Body of law</label><select id="cbody"></select>
      <label for="cdoc">Text</label><select id="cdoc"></select>
      <label for="csec">§</label><select id="csec"></select>
      <label for="cpar">¶</label><select id="cpar"></select>
      <p class="quiet" data-citepreview>—</p>
      <div class="row"><button type="button" data-cite-insert>Insert</button><button type="button" class="plain" data-cite-close>close</button></div>
    </div>

    <div class="row"><button id="prepare">Check</button><a data-commit class="button" hidden>Open on GitHub</a></div>
    <div data-out class="out" hidden></div>`,
    { on: 'assembly', module: 'propose', data: {
      classes: cfg.classes,
      next: 'P-' + String(C.measures.reduce((n, m) => Math.max(n, Number(String(m.id).replace('P-', '')) || 0), 0) + 1).padStart(4, '0'),
    } }));

  fs.mkdirSync(path.join(OUT, 'data/ballots'), { recursive: true });
  for (const m of C.measures) {
    const dir = path.join(at(root, 'ballots'), m.id);
    const ballots = {};
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.json') && !f.startsWith('_')) ballots[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    fs.writeFileSync(path.join(OUT, `data/ballots/${m.id}.json`), JSON.stringify(ballots, null, 2));

    const s = statusOf(m);
    const spec = cfg.classes[m.class] || {};
    const election = m.class === 'election';
    const cands = [].concat(m.candidates || []);

    write(`assembly/${m.id}`, page(m.title, `
      <p class="crumb"><a href="${u('/assembly/')}">Assembly</a> · ${esc(m.id)}</p>
      <h1>${esc(m.title)}<span class="sub">${esc(spec.label || m.class)} · sponsored by ${esc(m.sponsor || '')} · ${s.open ? 'closes ' + esc(m.closes || '') : esc(s.label)}</span></h1>
      <p class="state" data-state>counting…</p>
      ${(() => {
        const target = m.revises || m.amends;
        const st = target ? C.statutes.find((x) => x.id === target) : null;
        if (!st) return `<article class="law">${m.sections.length ? sections(m.sections, `prop.${m.id}`) : `<p>${link(m.body)}</p>`}</article>`;

        // art-08/§1/¶2 — a measure states its text. A revision states it as a
        // change to what is in force, so it is read that way.
        const before = fs.readFileSync(st.path, 'utf8').split(/\n---\n/).slice(1).join('\n---\n').trim();
        const d = pairEdits(diffLines(before, m.body));
        const n = summarise(d);
        const where = locate(m.body);
        const wasWhere = locate(before);

        return `<p class="quiet">A revision of <a href="${u(`/journal/law/${st.id}/`)}">stat.${esc(st.id)}</a>${st.version ? `, version ${st.version}` : ''} —
          ${n.added} added, ${n.altered} altered, ${n.removed} struck. Until it carries, the text in force is unchanged.</p>
        <div class="diff">${hunks(d, 2).map((x) => {
          if (x.kind === 'gap') return '<div class="gap">\u22ef</div>';
          const w = x.after ? where[x.after - 1] : x.before ? wasWhere[x.before - 1] : null;
          const at = w && w.section ? `§${w.section}${w.paragraph ? '/¶' + w.paragraph : ''}` : '';
          if (x.kind === 'altered') return `<div class="line was"><span class="at">${esc(at)}</span><span class="sign">\u2212</span><span class="t">${esc(x.from)}</span></div>
            <div class="line now"><span class="at"></span><span class="sign">+</span><span class="t">${esc(x.text)}</span></div>`;
          const cls = { same: 'same', added: 'now', removed: 'was' }[x.kind];
          const sign = { same: ' ', added: '+', removed: '\u2212' }[x.kind];
          return `<div class="line ${cls}"><span class="at">${esc(at)}</span><span class="sign">${sign}</span><span class="t">${esc(x.text)}</span></div>`;
        }).join('')}</div>

        <h2>The text as it would stand</h2>
        <article class="law">${m.sections.length ? sections(m.sections, `prop.${m.id}`) : `<p>${link(m.body)}</p>`}</article>`;
      })()}

      <h2>Made under</h2>
      <ul class="list">${[].concat(m.cites || []).map((c) => `<li>${link(String(c))}</li>`).join('') || '<li class="quiet">—</li>'}</ul>
      <div class="row"><button class="plain" data-copy="prop.${esc(m.id)}">copy citation</button>
        <a class="button" target="_blank" rel="noopener" href="https://github.com/${esc(repo)}/edit/${esc(branch)}/${esc(m.file)}">Edit the measure</a></div>

      ${s.open ? `<h2>${election ? 'Rank the candidates' : 'Vote'}</h2>
      <p data-msg class="msg quiet"></p>
      ${election
        ? `<p class="quiet">Click them in order of preference — art-08/§6/¶1.</p>
           <div class="choices">${cands.map((c) => `<button data-cand="${esc(c)}">${esc(c)}</button>`).join('')}</div>
           <p data-rank class="quiet"></p>`
        : `<div class="choices">
             <button data-choice="yes">yes</button><button data-choice="no">no</button><button data-choice="abstain">abstain</button>
           </div>`}
      <div class="row"><button id="sign" disabled>Sign ballot</button><a data-commit class="button" hidden>Open on GitHub</a></div>
      <div data-out class="out" hidden></div>` : ''}

      <div data-rounds></div>
      <h2>Ballots</h2>
      <table><thead><tr><th>Citizen</th><th>Choice</th><th>Cast</th></tr></thead><tbody data-rows></tbody></table>`,
      { on: 'assembly', module: 'measure', data: {
        measure: m.id, election, candidates: cands, spec,
        closes: closesAt(m, spec)?.toISOString() ?? null,
        closeRules: cfg.ballot.close_early,
      } }));
  }

  // ---- office, register, value, exchange, contracts, key, ledger ----------------

  const POWERS = {
    'citizen.admit': ['Admit a citizenship', 'register/citizens/', 'art-03/§2/¶3'],
    'citizen.object': ['Object to an admission', 'journal/issues/', 'art-03/§2/¶4'],
    'entity.register': ['Enter an entity formed by law', 'register/entities/', 'art-04/§1/¶2'],
    'journal.publish': ['Publish an issue of the Journal', 'journal/issues/', 'art-05/§2/¶1'],
    'checkpoint.sign': ['Sign a checkpoint', 'checkpoints/', 'art-02/§3/¶2'],
    'code.approve': ['Approve a change to the tools', '', 'art-08/§7/¶2'],
    'value.issue': ['Issue the unit', '', 'art-10/§2/¶1'],
    'treasury.disburse': ['Disburse from the Treasury', '', 'art-10/§6/¶2'],
    'audit.report': ['Report to the Assembly', 'journal/issues/', 'art-06/§5/¶3'],
    'court.halt': ['Halt an act', 'journal/judgments/', 'art-07/§3/¶1'],
    'court.void': ['Declare an act of no effect', 'journal/judgments/', 'art-07/§3/¶2'],
    'court.judge': ['Give judgment, with reasons', 'journal/judgments/', 'art-07/§4/¶3'],
  };

  write('office', page('Office', `
    <h1>Offices<span class="sub">Every office holds an enumerated set of powers and no others — art-06/§4/¶1.</span></h1>
    <table class="wide"><thead><tr><th>Office</th><th>Holder</th><th>Until</th><th>Under</th><th>May</th></tr></thead>
    <tbody>${offs.map((o) => `<tr><td>${esc(o.title)}</td><td>${esc(o.holder)}</td><td class="q">${esc(asDate(o.term_ends))}</td>
      <td class="q">${esc(o.under || '')}</td><td class="q">${(o.powers || []).map((p) => esc((POWERS[p] || [p])[0])).join('<br>')}</td></tr>`).join('')}</tbody></table>

    <h2>What your key may do</h2>
    <p data-msg class="msg quiet">Load a key to see. <a href="${u('/key/')}">Your key</a>.</p>
    <div data-powers></div>

    <h2>Carried elections</h2>
    <p data-pending class="quiet">—</p>

    <h2>Stand for office</h2>
    <p class="quiet">Every citizen may stand — art-09/§2/¶1. An election is a measure; the vote is by instant runoff — art-08/§6/¶1.</p>
    <label for="office">Office</label><select id="office">${offs.map((o) => `<option value="${esc(o.id)}">${esc(o.title)}</option>`).join('')}</select>
    <div class="row"><button id="stand" disabled>Prepare the election</button><a data-commit class="button" hidden>Open on GitHub</a></div>
    <div data-out class="out" hidden></div>`,
    { on: 'office', module: 'office', wide: true, data: {
      offices: offs.map((o) => ({ id: o.id, title: o.title, holder: o.holder, powers: o.powers, under: o.under })),
      powers: POWERS,
      elections: C.measures.filter((m) => m.class === 'election').map((m) => { const r = resultOf(m.id); return { id: m.id, office: m.office, winner: r?.winner ?? null, carried: !!r?.carried }; }),
      classes: cfg.classes,
      next: 'P-' + String(C.measures.reduce((n, m) => Math.max(n, Number(String(m.id).replace('P-', '')) || 0), 0) + 1).padStart(4, '0'),
    } }));

  write('register', page('Register', `
    <h1>Register</h1>
    <h2>Citizens</h2>
    <table><thead><tr><th>Citizenship</th><th>Status</th><th>Admitted</th></tr></thead>
    <tbody>${roll.map((c) => `<tr><td>${esc(c.id)}</td><td${c.status === 'active' ? '' : ' class="q"'}>${esc(c.status)}</td><td class="q">${esc(asDate(c.admitted))}</td></tr>`).join('')}</tbody></table>
    <p class="quiet">The register names no person; only identifiers appear — art-09/§6/¶2.</p>

    <h2>Form an entity</h2>
    <p data-msg class="msg quiet"></p>
    <label for="name">Name</label><input type="text" id="name">
    <label for="type">Type</label><select id="type">${Object.entries(cfg.entities).map(([k, t]) => `<option value="${esc(k)}">${esc(t.label)} — ${t.formed_by === 'citizen' ? 'as of right' : 'requires a carried measure'}</option>`).join('')}</select>
    <label for="under">Measure that establishes it, if its type requires one</label><input type="text" id="under" placeholder="P-0007">
    <div class="row"><button id="form" disabled>Prepare</button><a data-commit class="button" hidden>Open on GitHub</a></div>
    <div data-out class="out" hidden></div>

    <h2>Entities</h2>
    ${ents.length ? `<table><thead><tr><th>Entity</th><th>Type</th><th>Name</th><th>Status</th></tr></thead>
    <tbody>${ents.map((e) => `<tr><td><a href="${u(`/register/${e.id}/`)}">${esc(e.id)}</a></td><td class="q">${esc(e.type)}</td><td>${esc(e.name)}</td><td class="q">${esc(e.status)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="quiet">None yet. Any citizen may form one — art-04/§1/¶1.</p>'}

    <h2>Your citizenship</h2>
    <p data-mymsg class="quiet">Load a key to act on your own citizenship.</p>
    <div data-mine hidden>
      <label for="delegate">Delegate your vote to (blank to revoke)</label>
      <input type="text" id="delegate" placeholder="c-0002">
      <div class="row"><button data-act="delegate">Prepare</button></div>
      <p class="quiet">art-08/§3/¶4 \u2014 a delegated vote is exercised openly and recorded as delegated. It is used only where you have not voted yourself, and you may revoke it before the close.</p>
      <div class="row"><button data-act="depart" class="plain">Depart the Republic</button></div>
      <p class="quiet">art-03/§4/¶1 \u2014 you may depart at any time, and return by the procedure for admission. Departure alters no record already made.</p>
    </div>
    <div data-out2 class="out" hidden></div>
    <div class="row"><a data-commit2 class="button" hidden>Open on GitHub</a></div>

    <h2>Checkpoints</h2>
    <table><thead><tr><th>No.</th><th>Records</th><th>Root</th></tr></thead>
    <tbody>${checkpoints(root).slice().reverse().map((c) => `<tr><td>${c.number}</td><td class="q">${c.records}</td><td class="q">${esc(String(c.root).slice(0, 20))}…</td></tr>`).join('') || '<tr><td colspan="3" class="q">None yet.</td></tr>'}</tbody></table>`,
    { on: 'register', module: 'register', data: {
      entities: cfg.entities,
      next: 'e-' + String(ents.reduce((n, e) => Math.max(n, Number(String(e.id).replace('e-', '')) || 0), 0) + 1).padStart(4, '0'),
      citizens: roll.map((c) => ({ id: c.id, status: c.status, admitted: asDate(c.admitted), keys: c.keys || [], delegate_to: c.delegate_to || null, github: c.github || null })),
    } }));

  const instruments = [...V.instruments.entries()];
  fs.mkdirSync(path.join(OUT, 'data/charters'), { recursive: true });

  for (const e of ents) {
    const charterFile = path.join(root, e.charter || `charters/${e.id}.md`);
    const charter = fs.existsSync(charterFile) ? fs.readFileSync(charterFile, 'utf8') : null;
    if (charter) fs.writeFileSync(path.join(OUT, `data/charters/${e.id}.md`), charter);
    const type = cfg.entities[e.type] || {};
    const P = powersOf(root, e.id);
    const roll = electorateOf(root, e.id);
    const res = resolutionsOf(root, e.id).map((r) => ({ r, c: countResolution(root, r) }));
    const mine = instruments.filter(([, m]) => m.issuer === e.id);
    const held = [...(V.holdings.get(e.id) || new Map())].filter(([, q]) => q > 0);

    write(`register/${e.id}`, page(e.name, `
      <p class="crumb"><a href="${u('/register/')}">Register</a> · ${esc(e.id)}</p>
      <h1>${esc(e.name)}<span class="sub">${esc(type.label || e.type)} · formed ${esc(asDate(e.formed))} under ${esc(e.under || 'art-04/§1/¶1')}${e.status !== 'active' ? ' · ' + esc(e.status) : ''}</span></h1>
      <table><tbody>
        <tr><td class="q">Organs</td><td>${(e.organs || []).map((o) => `${esc(o.name)}: ${(o.held_by || []).join(', ')}`).join('<br>') || '—'}</td></tr>
        <tr><td class="q">Members</td><td>${(e.members || []).join(', ') || '—'}</td></tr>
        <tr><td class="q">Holds</td><td>${V.balances.get(e.id) || 0} ${esc(UNIT)}${held.length ? '<br>' + held.map(([i, q]) => `${q} × ${esc(i)}`).join('<br>') : ''}</td></tr>
        <tr><td class="q">May issue shares</td><td class="q">${P.instruments ? 'yes — art-10/§4/¶1' : 'no — art-04/§2/¶3'}</td></tr>
        ${P.instruments ? `<tr><td class="q">Listed</td><td class="q">${P.listed
          ? 'yes — its instruments are traded on the exchange'
          : 'no — private. Its shares exist and transfer directly, but are not traded.'}</td></tr>` : ''}
        <tr><td class="q">Decides by</td><td class="q">${P.vote === 'members' ? 'its members, one vote each' : 'its shares, weighted by holding'} · quorum ${(P.quorum * 100).toFixed(0)}% · threshold ${(P.threshold * 100).toFixed(0)}%</td></tr>
      </tbody></table>

      <h2>Who decides</h2>
      ${roll.length ? `<table><thead><tr><th>${P.vote === 'members' ? 'Member' : 'Holder'}</th><th>Weight</th></tr></thead>
      <tbody>${roll.map((v) => `<tr><td>${esc(v.id)}</td><td>${v.weight}</td></tr>`).join('')}</tbody></table>
      <p class="note">${P.vote === 'members'
        ? 'Every member is a coequal member — one vote each, however much they hold (art-04/§3/¶2).'
        : 'Each holder votes in proportion to what they hold.'}</p>`
      : '<p class="quiet">Nobody yet.</p>'}

      <h2>Resolutions</h2>
      ${res.length ? `<table class="wide"><thead><tr><th>Resolution</th><th>Kind</th><th>Cast</th><th>Outcome</th></tr></thead>
      <tbody>${res.map(({ r, c }) => `<tr><td>${esc(r.title)}<span class="q"> · ${esc(r.id)}</span></td>
        <td class="q">${esc(r.kind)}${r.organ ? ' (' + esc(r.organ) + ')' : ''}</td>
        <td class="q">${c.cast} of ${c.electorate}, ${c.quorumNeeded} needed</td>
        <td class="q">${c.open ? 'open until ' + esc(String(r.closes)) : c.carried ? (c.winner ? 'carried — ' + esc(c.winner) : 'carried') : 'not carried'}</td></tr>`).join('')}</tbody></table>`
      : '<p class="quiet">None yet.</p>'}

      <div data-vote hidden>
        <h3>Vote on a resolution</h3>
        <label for="rpick">Resolution</label><select id="rpick"></select>
        <div class="choices" data-choices></div>
        <div class="row"><button data-act="entityvote" disabled>Sign the vote</button></div>
      </div>

      ${charter ? `<h2>Charter</h2><article class="law">${markdown(charter.replace(/^---[\s\S]*?\n---\n/, ''))}</article>`
        : `<h2>Charter</h2><p class="quiet">${esc(e.id)} has no charter yet. Every entity has one — art-04/§3/¶1.</p>
           <div class="row"><a class="button" target="_blank" rel="noopener" href="https://github.com/${esc(repo)}/new/${esc(branch)}?filename=charters/${esc(e.id)}.md">Create the charter</a></div>`}

      ${mine.length ? `<h2>Instruments</h2><table><thead><tr><th>Instrument</th><th>Issued</th></tr></thead>
      <tbody>${mine.map(([i, m]) => `<tr><td>${esc(i)}</td><td class="q">${m.issued}</td></tr>`).join('')}</tbody></table>` : ''}

      <hr class="rule">
      <h2>Manage</h2>
      <p data-msg class="msg quiet">Load a key that is an organ of ${esc(e.id)} to act for it.</p>
      <div data-console hidden>
        ${type.instruments ? `<h3>Issue a share</h3>
        <label for="icls">Class</label><input type="text" id="icls" value="ordinary">
        <label for="iqty">Quantity</label><input type="text" id="iqty" inputmode="numeric">
        <label for="ito">To</label><input type="text" id="ito" value="${esc(e.id)}">
        <div class="row"><button data-act="issue">Sign</button></div>` : ''}

        <h3>Transfer</h3>
        <label for="twhat">What</label><select id="twhat"><option value="unit">${esc(UNIT)}s</option>${held.map(([i]) => `<option value="${esc(i)}">${esc(i)}</option>`).join('')}</select>
        <label for="tto">To</label><select id="tto">${[...ACCT.keys()].filter((x) => x !== e.id).map((x) => `<option>${esc(x)}</option>`).join('')}</select>
        <label for="tamt">Amount</label><input type="text" id="tamt" inputmode="numeric">
        <div class="row"><button data-act="transfer">Sign</button></div>

        <h3>Trade</h3>
        <label for="oside">Side</label><select id="oside"><option value="sell">sell</option><option value="buy">buy</option></select>
        <label for="oinst">Instrument</label><select id="oinst">${instruments.map(([i]) => `<option>${esc(i)}</option>`).join('') || '<option value="">none issued</option>'}</select>
        <label for="oqty">Quantity</label><input type="text" id="oqty" inputmode="numeric">
        <label for="oprice">Price</label><input type="text" id="oprice" inputmode="numeric">
        <div class="row"><button data-act="order">Sign</button></div>

        <h3>Propose a resolution</h3>
        <p class="quiet">Decided by ${P.vote === 'members' ? 'the members, one vote each' : 'the holders, weighted by shares'} — art-04/§3/¶2.</p>
        <label for="rtitle">What is decided</label><input type="text" id="rtitle">
        <label for="rkind">Kind</label>
        <select id="rkind">
          <option value="policy">policy — a decision of the entity</option>
          <option value="officer">officer — fill an organ, which then acts for the entity</option>
          <option value="charter">charter — replace the charter itself</option>
        </select>
        <label for="rorgan">Organ to fill, for an officer resolution</label><input type="text" id="rorgan" placeholder="director">
        <label for="rtext">Text, or the whole charter for a charter resolution</label><textarea id="rtext" rows="6"></textarea>
        <div class="row"><button data-act="resolve">Sign</button></div>

        <h3>Members</h3>
        <label for="mwho">Citizenships, comma separated</label><input type="text" id="mwho" placeholder="c-0002, c-0003">
        <div class="row"><button data-act="admit">Admit</button><button data-act="remove">Remove</button></div>

        <h3>Organs</h3>
        <p class="quiet">art-04/§3/¶2 — an organ holds only the authority the charter confers.</p>
        <label for="oset">role=citizen, separated by commas; several holders with /</label>
        <input type="text" id="oset" value="${esc((e.organs || []).map((o) => `${o.name}=${(o.held_by || []).join('/')}`).join(', '))}">
        <div class="row"><button data-act="organs">Sign</button></div>

        <h3>Charter</h3>
        <p class="quiet">art-04/§3/¶3 — a charter must not be inconsistent with the Constitution.</p>
        <textarea id="ctext" rows="14"></textarea>
        <div class="row"><button data-act="charter">Sign</button></div>

        <h3>Dissolve</h3>
        <p class="quiet">art-04/§4/¶2 — on dissolution its holdings pass as the charter provides, and failing that to the Treasury.</p>
        <div class="row"><button data-act="dissolve">Sign dissolution</button></div>

        <div data-out class="out" hidden></div>
        <div class="row"><a data-commit class="button" hidden>Open on GitHub</a></div>
      </div>`,
      { on: 'register', module: 'entity', data: {
        entity: e.id, organs: e.organs || [], hasCharter: !!charter,
        powers: P, electorate: roll,
        resolutions: res.filter(({ c }) => c.open).map(({ r }) => ({ id: r.id, title: r.title, kind: r.kind, organ: r.organ || null })),
        candidates: roll.map((v) => v.id),
        next: 'R-' + String(res.length + 1).padStart(4, '0'),
      } }));
  }

  const treasurer = offs.find((o) => (o.powers || []).includes('treasury.disburse'));
  const carriedMeasures = C.measures.filter((m) => resultOf(m.id)?.carried).map((m) => ({ id: m.id, title: m.title }));

  write('value', page('Value', `
    <h1>Value<span class="sub">The ${esc(UNIT)} has no value outside the Republic and may not be sold, redeemed, or exchanged — art-10/§1/¶2.</span></h1>

    <h2>Your accounts</h2>
    <p data-msg class="msg quiet">Load a key to see what you hold. <a href="${u('/key/')}">Your key</a>.</p>
    <table data-mine hidden><thead><tr><th>Account</th><th>Kind</th><th>${esc(UNIT[0].toUpperCase() + UNIT.slice(1))}s</th><th>Instruments</th></tr></thead><tbody></tbody></table>
    <p class="note">Only accounts your key may act for are shown. The ledger is public; what you hold is not printed on a page anyone may open.</p>

    <h2>In circulation</h2>
    <table><tbody>
      <tr><td class="q">Issued in total</td><td>${V.issued}</td></tr>
      <tr><td class="q">Accounts</td><td>${ACCT.size}</td></tr>
      <tr><td class="q">Held by the Treasury</td><td>${V.balances.get(TREASURY) || 0}</td></tr>
    </tbody></table>

    <h2 data-issue-head hidden>Issue</h2>
    <div data-issue hidden>
      <p class="quiet">Only the Treasurer may issue, only under a resolution that has carried, and only in the amount it states — art-10/§2/¶1.</p>
      <label for="ires">Resolution that authorises it</label><select id="ires">${carriedMeasures.map((m) => `<option value="${esc(m.id)}">${esc(m.id)} — ${esc(m.title)}</option>`).join('') || '<option value="">no measure has carried</option>'}</select>
      <label for="iamt">Amount</label><input type="text" id="iamt" inputmode="numeric">
      <label for="ito2">To</label><select id="ito2">${[...ACCT.keys()].map((x) => `<option${x === TREASURY ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <div class="row"><button data-act="issue">Sign the issue</button></div>
    </div>

    <h2>Transfer</h2>
    <label for="tfrom">From</label><select id="tfrom"></select>
    <label for="tto">To</label><select id="tto">${[...ACCT.keys()].map((x) => `<option>${esc(x)}</option>`).join('')}</select>
    <label for="twhat">What</label><select id="twhat"><option value="unit">${esc(UNIT)}s</option>${instruments.map(([i]) => `<option value="${esc(i)}">${esc(i)}</option>`).join('')}</select>
    <label for="tamt">Amount</label><input type="text" id="tamt" inputmode="numeric">
    <label for="tnote">Note (optional)</label><input type="text" id="tnote">
    <div class="row"><button data-act="transfer" disabled>Sign transfer</button><a data-commit class="button" hidden>Open on GitHub</a></div>
    <div data-out class="out" hidden></div>
    <p class="note">A transfer is signed here and settled by the workflow, which checks the balance and records it — art-10/§3/¶2.</p>`,
    { on: 'value', module: 'value', data: {
      accounts: [...ACCT.entries()].map(([id, m]) => ({ id, kind: m.kind, organs: m.organs || [], balance: V.balances.get(id) || 0,
        officer: id === TREASURY && treasurer ? treasurer.holder : undefined,
        holdings: [...(V.holdings.get(id) || new Map())].filter(([, q]) => q > 0).map(([instrument, quantity]) => ({ instrument, quantity })) })),
      offices: offs.map((o) => ({ id: o.id, holder: o.holder, powers: o.powers })),
      unit: UNIT,
    } }));

  // Pending orders, so the book is public before it clears — art-10/§5/¶3.
  const pending = (() => {
    const dir = at(root, 'acts');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
      .filter((a) => a && a.kind === 'order');
  })();
  const trades = ev.filter((e) => e.kind === 'order.matched');
  const refusedList = (() => {
    const dir = at(root, 'refused');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } }).filter(Boolean);
  })();

  write('exchange', page('Exchange', `
    <h1>Exchange<span class="sub">Cleared by periodic auction at a uniform price, with no priority to the order of arrival — art-10/§5/¶2.</span></h1>
    ${instruments.length ? instruments.map(([inst, m]) => {
      const book = pending.filter((o) => o.instrument === inst);
      const { bids, asks, best, spread } = bookOf(book);
      const would = matchBook(book, { tradeAt: cfg.value.exchange?.trade_at || 'resting', cancelRemainder: cfg.value.exchange?.partial_fill_cancels_remainder !== false });
      const last = trades.filter((t) => t.payload.instrument === inst).slice(-1)[0];
      return `<h2>${esc(inst)}</h2>
      <table><tbody>
        <tr><td class="q">Issuer</td><td><a href="${u(`/register/${m.issuer}/`)}">${esc(m.issuer)}</a></td></tr>
        <tr><td class="q">Issued</td><td>${m.issued}</td></tr>
        <tr><td class="q">Last traded</td><td>${last ? last.payload.price + ' ' + esc(UNIT) : '\u2014'}</td></tr>
        <tr><td class="q">Best bid / best ask</td><td>${best.bid ?? '\u2014'} / ${best.ask ?? '\u2014'}${spread !== null ? ` <span class="q">spread ${spread}</span>` : ''}</td></tr>
        <tr><td class="q">Next settlement would</td><td>${would.fills.length
          ? would.fills.map((f) => `trade ${f.quantity} at ${f.price}`).join('; ') + (would.cancelled.length ? `, and cancel ${would.cancelled.map((c) => c.remainder).join(' + ')} left over` : '')
          : 'match nothing \u2014 the spread has not crossed'}</td></tr>
      </tbody></table>
      <table><thead><tr><th>Bids</th><th>Asks</th></tr></thead><tbody><tr>
        <td>${bids.length ? bids.map((o) => `${o.quantity} @ ${o.price} <span class="q">${esc(o.account)} \u00b7 ${esc(String(o.at).slice(0, 10))}</span>`).join('<br>') : '<span class="q">none</span>'}</td>
        <td>${asks.length ? asks.map((o) => `${o.quantity} @ ${o.price} <span class="q">${esc(o.account)} \u00b7 ${esc(String(o.at).slice(0, 10))}</span>`).join('<br>') : '<span class="q">none</span>'}</td>
      </tr></tbody></table>`;
    }).join('') : '<p class="quiet">No instrument has been issued, so there is nothing to trade. A company may issue a share in itself \u2014 art-10/§4/¶1.</p>'}

    <h2 data-issue-head hidden>Issue a share</h2>
    <div data-issue hidden>
      <p class="quiet">A company may issue an instrument representing a share in itself \u2014 art-10/§4/¶1. Only an organ of it may do so.</p>
      <label for="ientity">Company</label><select id="ientity"></select>
      <label for="icls">Class</label><input type="text" id="icls" value="ordinary">
      <label for="iqty">Quantity</label><input type="text" id="iqty" inputmode="numeric">
      <label for="ito">To</label><select id="ito"></select>
      <div class="row"><button data-act="issue">Sign the issue</button></div>
    </div>

    ${instruments.length ? `<h2>Place an order</h2>
    <p data-msg class="msg quiet"></p>
    <label for="oside">Side</label><select id="oside"><option value="buy">buy</option><option value="sell">sell</option></select>
    <label for="oinst">Instrument</label><select id="oinst">${instruments.map(([i]) => `<option>${esc(i)}</option>`).join('')}</select>
    <label for="oacct">Account</label><select id="oacct"></select>
    <label for="oqty">Quantity</label><input type="text" id="oqty" inputmode="numeric">
    <label for="oprice">Price in ${esc(UNIT)}s</label><input type="text" id="oprice" inputmode="numeric">
    <div class="row"><button data-act="order" disabled>Sign order</button><a data-commit class="button" hidden>Open on GitHub</a></div>
    <div data-out class="out" hidden></div>
    <p class="note">Best price first; among equal prices, whoever arrived first. A trade happens at the <strong>resting</strong> order's price \u2014 the one who waited set the terms. An order partly filled is cancelled for the remainder, so nothing is left half-alive. Orders that do not cross rest until they do \u2014 art-10/§5.</p>` : ''}

    ${refusedList.length ? `<h2>Refused</h2>
    <p class="quiet">An instrument that did not settle is kept with the reason, rather than retried or discarded.</p>
    <table><thead><tr><th>Kind</th><th>By</th><th>Why</th></tr></thead>
    <tbody>${refusedList.map((r) => `<tr><td>${esc(r.kind || '—')}</td><td class="q">${esc(r.by || '')}</td><td class="q">${esc(r._refused?.why || '')}</td></tr>`).join('')}</tbody></table>` : ''}

    ${(() => {
      const cancels = ev.filter((e) => e.kind === 'order.cancelled');
      return cancels.length ? `<h2>Cancelled</h2>
      <p class="quiet">An order partly filled is cancelled for the remainder \u2014 art-10/§5/¶4.</p>
      <table><thead><tr><th>Instrument</th><th>Account</th><th>Side</th><th>Filled</th><th>Cancelled</th></tr></thead>
      <tbody>${cancels.slice().reverse().map((e) => `<tr><td>${esc(e.payload.instrument)}</td><td class="q">${esc(e.payload.account)}</td>
        <td class="q">${esc(e.payload.side)}</td><td>${e.payload.filled}</td><td>${e.payload.remainder}</td></tr>`).join('')}</tbody></table>` : '';
    })()}

    <h2>Trades</h2>
    <table><thead><tr><th>Instrument</th><th>Seller</th><th>Buyer</th><th>Quantity</th><th>Price</th><th>Set by</th><th>When</th></tr></thead>
    <tbody>${trades.slice().reverse().map((e) => `<tr><td>${esc(e.payload.instrument)}</td><td class="q">${esc(e.payload.seller)}</td>
      <td class="q">${esc(e.payload.buyer)}</td><td>${e.payload.quantity}</td><td>${e.payload.price}</td>
      <td class="q">the resting ${esc(e.payload.resting || '\u2014')}</td><td class="q">${esc(e.at.slice(0, 10))}</td></tr>`).join('')
      || '<tr><td colspan="7" class="q">No trades yet.</td></tr>'}</tbody></table>`,
    { on: 'exchange', module: 'exchange', wide: true, data: {
      accounts: [...ACCT.entries()].map(([id, m]) => ({ id, kind: m.kind, organs: m.organs || [] })),
      issuers: ents.filter((e) => e.status === 'active' && cfg.entities[e.type]?.instruments)
        .map((e) => ({ id: e.id, name: e.name, organs: e.organs || [] })),
    } }));

  // Contracts
  const contractsDir = at(root, 'contracts');
  const contractList = fs.existsSync(contractsDir)
    ? fs.readdirSync(contractsDir).filter((f) => f.endsWith('.md')).map((f) => {
        const src = fs.readFileSync(path.join(contractsDir, f), 'utf8');
        const [meta, body] = frontmatterOf(src);
        const id = meta.id || path.basename(f, '.md');
        const sigDir = path.join(contractsDir, id);
        const signed = fs.existsSync(sigDir) ? fs.readdirSync(sigDir).filter((x) => x.endsWith('.json')).map((x) => path.basename(x, '.json')) : [];
        return { ...meta, id, body, signed, source: src };
      })
    : [];

  fs.mkdirSync(path.join(OUT, 'data/contracts'), { recursive: true });
  write('contracts', page('Contracts', `
    <h1>Contracts<span class="sub">Drafted by one party, executed when every party has signed — art-09/§7/¶2.</span></h1>
    <ul class="list">${contractList.length ? contractList.map((c) =>
      `<li><a href="${u(`/contracts/${c.id}/`)}">${esc(c.title || c.id)}</a><span class="meta">${[].concat(c.parties || []).map((p) => esc(p) + (c.signed.includes(p) ? ' \u2713' : ' \u2014')).join('  ')}</span></li>`).join('')
      : '<li class="quiet">None yet.</li>'}</ul>

    <h2>Draft a contract</h2>
    <p data-msg class="msg quiet"></p>
    <label for="ctitle">Title</label><input type="text" id="ctitle">
    <label for="cparties">Parties, comma separated</label><input type="text" id="cparties" placeholder="c-0001, e-0001">
    <label for="cterms">Terms</label><textarea id="cterms" rows="6"></textarea>
    <div class="row"><button id="draft" disabled>Prepare</button><a data-commit class="button" hidden>Open on GitHub</a></div>
    <div data-out class="out" hidden></div>
    <p class="note">Each party then signs it on its own page. It takes effect when every one has \u2014 art-09/§7/¶2.</p>`,
    { on: 'value', module: 'contracts', data: {
      accounts: [...ACCT.keys()],
      expiry: cfg.contracts.expiry,
    } }));

  for (const c of contractList) {
    fs.writeFileSync(path.join(OUT, `data/contracts/${c.id}.txt`), c.source);
    write(`contracts/${c.id}`, page(c.title || c.id, `
      <p class="crumb"><a href="${u('/contracts/')}">Contracts</a> · ${esc(c.id)}</p>
      <h1>${esc(c.title || c.id)}<span class="sub">${c.executed ? 'executed ' + esc(asDate(c.executed)) : 'awaiting signature'} · drafted ${esc(asDate(c.drafted))}</span></h1>
      <h2>Parties</h2>
      <table><tbody>${[].concat(c.parties || []).map((p) => `<tr><td>${esc(p)}</td><td class="q">${c.signed.includes(p) ? 'signed' : 'not yet signed'}</td></tr>`).join('')}</tbody></table>
      <article class="law">${markdown(c.body)}</article>
      <h2>Sign</h2>
      <p data-msg class="msg quiet"></p>
      <div class="row"><button data-act="sign" disabled>Sign this contract</button><a data-commit class="button" hidden>Open on GitHub</a></div>
      <div data-out class="out" hidden></div>
      <p class="note">A signature covers the text as it now stands. An alteration afterwards voids every signature given — art-09/§7/¶3.</p>`,
      { on: 'value', module: 'contract', data: { contract: c.id, parties: [].concat(c.parties || []) } }));
  }

  write('key', page('Key', `
    <h1>Your key<span class="sub">A citizenship is a keypair. It is made here and never leaves this browser.</span></h1>
    <p data-msg class="msg quiet">No key loaded.</p>
    <div class="row">
      <button id="make">Create a citizenship</button>
      <button id="pick">Load a key</button>
      <button id="drop" class="plain">forget</button>
    </div>
    <div id="loader" hidden>
      <label for="file">Choose your .pem file</label><input type="file" id="file" accept=".pem,.txt,.key">
      <label for="paste">Or paste it, headers and all</label><textarea id="paste" placeholder="-----BEGIN PRIVATE KEY-----" rows="6"></textarea>
      <div class="row"><button id="go">Load</button></div>
    </div>
    <div id="shown" hidden>
      <h2>Private key</h2>
      <p class="quiet">This is your citizenship. Save it. Never publish it, never commit it.</p>
      <div class="out" id="privout"></div>
      <div class="row"><button id="dl" class="plain">download</button><button id="copy" class="plain">copy</button></div>
      <h2>Public key</h2>
      <p class="quiet">The harmless half. This is what goes on the register.</p>
      <div class="out" id="pubout"></div>
      <div class="row"><a data-commit class="button" hidden>Apply for citizenship on GitHub</a></div>
    </div>`,
    { on: '', module: 'key', data: { next: 'c-' + String(roll.reduce((n, c) => Math.max(n, Number(String(c.id).replace('c-', '')) || 0), 0) + 1).padStart(4, '0') } }));

  write('ledger', page('Ledger', `
    <h1>Ledger<span class="sub">No record is altered; a correction is a new record — art-02/§2.</span></h1>
    <p class="state" data-verify>verifying…</p>
    <table class="wide"><thead><tr><th>#</th><th>Act</th><th>Author</th><th>Under</th><th>When</th></tr></thead>
    <tbody>${ev.slice().reverse().map((e) => `<tr id="r${e.seq}"><td class="q">${e.seq}</td><td>${esc(e.kind)}</td>
      <td class="q">${esc(e.author)}</td><td>${link(String(e.provision))}</td><td class="q">${esc(e.at.slice(0, 10))}</td></tr>`).join('')}</tbody></table>`,
    { on: 'ledger', module: 'ledger', wide: true }));

  // ---- data ---------------------------------------------------------------------

  fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
  const resolveIndex = {};
  for (const [id] of C.entries) resolveIndex[id] = B + hrefOf(id);
  fs.writeFileSync(path.join(OUT, 'data/resolve.json'), JSON.stringify(resolveIndex));

  // Everything citable, browsable by corpus → text → § → ¶. The picker reads
  // this, so anything it offers is guaranteed to resolve.
  const titleOf = (corpusName, document) => {
    if (corpusName === 'const') return C.articles.find((a) => a.id === document)?.title || document;
    if (corpusName === 'stat') return C.statutes.find((x) => x.id === document)?.title || document;
    if (corpusName === 'deed') return C.deeds.find((x) => x.id === document)?.title || document;
    return document;
  };
  fs.writeFileSync(path.join(OUT, 'data/citations.json'), JSON.stringify(
    [...C.entries.values()]
      .filter((e) => ['const', 'stat', 'deed'].includes(e.corpus))
      .map((e) => ({ id: e.id, corpus: e.corpus, document: e.document, title: titleOf(e.corpus, e.document),
                     section: e.section ?? null, paragraph: e.paragraph ?? null, label: e.label })),
  ));
  fs.writeFileSync(path.join(OUT, 'data/citizens.json'), JSON.stringify(roll.map((c) => ({ id: c.id, status: c.status, keys: c.keys || [] })), null, 2));
  fs.writeFileSync(path.join(OUT, 'data/events.jsonl'), fs.existsSync(at(root, 'ledger')) ? fs.readFileSync(at(root, 'ledger')) : '');

  return { pages: pageCount, citations: C.entries.size };
}
