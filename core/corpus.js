// Every text the Republic has, and one way to cite any part of it.
//
//     const.art-05/§8/¶1      a provision of the Constitution
//     stat.unit-of-account/§3 a section of a statute
//     jour.2026/1             an issue of the Journal
//     jdgt.2026/2             a judgment
//     prop.P-0002/§1          a measure's own text
//
// A bare constitutional citation (art-05/§8/¶1) normalises to const.*, because
// the ledger is full of them and a record is never rewritten.
//
// Citations are logical, not paths. Moving a file never breaks one.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { at, config } from './config.js';

const MARKS = '¹²³⁴⁵⁶⁷⁸⁹';

export const CORPORA = {
  const: { label: 'Constitution', pathKey: 'constitution', href: (d) => `/journal/constitution/${slug(d)}/` },
  stat:  { label: 'Statute',      pathKey: 'statutes',     href: (d) => `/journal/law/${d}/` },
  jour:  { label: 'Journal',      pathKey: 'issues',       href: (d) => `/journal/issues/${d.split('/')[1]}/` },
  jdgt:  { label: 'Judgment',     pathKey: 'judgments',    href: (d) => `/journal/court/${d.split('/')[1]}/` },
  prop:  { label: 'Measure',      pathKey: 'proposals',    href: (d) => `/assembly/${d}/` },
  deed:  { label: 'Deed',         pathKey: 'deeds',        href: (d) => `/journal/deeds/${d}/` },
};

export const slug = (id) => id.replace(/§/g, 's').replace(/¶/g, 'p').replace(/\//g, '-');
export const isoDate = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

export function normalise(raw) {
  let c = String(raw).trim().replace(/\s+/g, '').replace(/§§/g, '§');
  if (/^art[-.]?\d/i.test(c)) c = 'const.' + c.replace(/^art[.]/i, 'art-');
  return c;
}

// ---- reading documents ----------------------------------------------------------

export function frontmatter(src) {
  if (!src.startsWith('---')) return [{}, src];
  const end = src.indexOf('\n---', 3);
  if (end === -1) return [{}, src];
  return [yaml.load(src.slice(4, end)) || {}, src.slice(end + 4)];
}

// § headings and ¶ paragraphs, with continuation lines folded into the thing
// above them. One parser for every kind of legal text.
export function parseSections(body) {
  const sections = [];
  let sec = null, para = null, note = [];

  for (const raw of String(body).split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^##\s+§\s*(\d+)\s*(.*)$/);
    if (h) { sec = { num: Number(h[1]), heading: (h[2] || '').trim(), paragraphs: [] }; sections.push(sec); para = null; continue; }

    const p = line.match(new RegExp(`^([${MARKS}])\\s+(.*)$`));
    if (p && sec) { para = { num: MARKS.indexOf(p[1]) + 1, text: p[2].trim() }; sec.paragraphs.push(para); continue; }

    if (!line.trim()) { para = null; continue; }
    if (para) { para.text += ' ' + line.trim(); continue; }
    if (!sec) note.push(line);
  }
  return { sections, note: note.join('\n').trim() };
}

function readAll(dir, ext = '.md') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      // Not in force: superseded texts, and requests the Keeper has not
      // recognised. A request appearing among the deeds would be a deed nobody
      // granted — art-05/§2/¶2.
      if (f === 'superseded' || f === 'requested') continue;
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(ext) && f !== 'TEMPLATE.md') out.push({ path: p, src: fs.readFileSync(p, 'utf8') });
    }
  };
  walk(dir);
  return out;
}

// ---- the corpus -------------------------------------------------------------------

export function corpus(root) {
  const entries = new Map();
  const add = (id, e) => { if (!entries.has(id)) entries.set(id, { id, ...e }); return entries.get(id); };

  // Constitution
  const articles = [];
  for (const d of readAll(at(root, 'constitution'))) {
    const [meta, body] = frontmatter(d.src);
    const { sections, note } = parseSections(body);
    const art = { id: meta.id, title: meta.title, entrenched: !!meta.entrenched, note, sections, path: d.path };
    articles.push(art);
    add(`const.${art.id}`, { corpus: 'const', label: art.title, document: art.id, kind: 'article' });
    for (const s of sections) {
      add(`const.${art.id}/§${s.num}`, { corpus: 'const', label: s.heading, document: art.id, kind: 'section', section: s.num });
      for (const p of s.paragraphs) add(`const.${art.id}/§${s.num}/¶${p.num}`, { corpus: 'const', label: p.text.slice(0, 60), document: art.id, kind: 'paragraph', section: s.num, paragraph: p.num });
    }
  }
  articles.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // Statutes — the law in force
  const statutes = [];
  for (const d of readAll(at(root, 'statutes'))) {
    const [meta, body] = frontmatter(d.src);
    const { sections } = parseSections(body);
    const st = { ...meta, id: meta.id || path.basename(d.path, '.md'), sections, path: d.path, body: body.trim() };
    statutes.push(st);
    add(`stat.${st.id}`, { corpus: 'stat', label: st.title || st.id, document: st.id, kind: 'statute' });
    for (const s of sections) {
      add(`stat.${st.id}/§${s.num}`, { corpus: 'stat', label: s.heading, document: st.id, kind: 'section', section: s.num });
      for (const p of s.paragraphs) add(`stat.${st.id}/§${s.num}/¶${p.num}`, { corpus: 'stat', label: p.text.slice(0, 60), document: st.id, kind: 'paragraph', section: s.num, paragraph: p.num });
    }
  }

  // Journal
  const issues = [];
  for (const d of readAll(at(root, 'issues'))) {
    const [meta, body] = frontmatter(d.src);
    const date = isoDate(meta.date);
    const issue = { ...meta, date, year: date.slice(0, 4), body: body.trim(), path: d.path };
    issues.push(issue);
    add(`jour.${issue.year}/${issue.number}`, { corpus: 'jour', label: issue.title || `Issue ${issue.number}`, document: `${issue.year}/${issue.number}`, kind: 'issue' });
  }
  issues.sort((a, b) => (a.number || 0) - (b.number || 0));

  // Judgments
  const judgments = [];
  for (const d of readAll(at(root, 'judgments'))) {
    const [meta, body] = frontmatter(d.src);
    const j = { ...meta, filed: isoDate(meta.filed), decided: meta.decided ? isoDate(meta.decided) : null, body: body.trim(), path: d.path };
    judgments.push(j);
    const year = (j.filed || '').slice(0, 4);
    add(`jdgt.${year}/${j.number}`, { corpus: 'jdgt', label: j.title || `Case ${j.number}`, document: `${year}/${j.number}`, kind: 'judgment' });
  }
  judgments.sort((a, b) => (a.number || 0) - (b.number || 0));

  // Deeds — recognised title, valid on publication
  const deeds = [];
  for (const d of readAll(at(root, 'deeds'))) {
    const [meta, body] = frontmatter(d.src);
    const deed = { ...meta, id: meta.id || path.basename(d.path, '.md'), recognised: isoDate(meta.recognised), body: body.trim(), path: d.path };
    deeds.push(deed);
    add(`deed.${deed.id}`, { corpus: 'deed', label: deed.title || deed.id, document: deed.id, kind: 'deed' });
  }
  deeds.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // Measures
  const measures = [];
  for (const d of readAll(at(root, 'proposals'))) {
    const [meta, body] = frontmatter(d.src);
    if (!meta.id) continue;
    const { sections } = parseSections(body);
    const m = { ...meta, opened: isoDate(meta.opened), closes: meta.closes ? isoDate(meta.closes) : null, sections, body: body.trim(), path: d.path, file: path.relative(root, d.path) };
    measures.push(m);
    add(`prop.${m.id}`, { corpus: 'prop', label: m.title || m.id, document: m.id, kind: 'measure' });
    for (const s of sections) add(`prop.${m.id}/§${s.num}`, { corpus: 'prop', label: s.heading, document: m.id, kind: 'section', section: s.num });
  }
  measures.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return { articles, statutes, issues, judgments, measures, deeds, entries };
}

export const resolves = (entries, citation) => entries.has(normalise(citation));

export function hrefOf(id) {
  const [, corpusName] = id.match(/^([a-z]{3,5})\./) || [];
  const c = CORPORA[corpusName];
  if (!c) return null;
  const rest = id.slice(corpusName.length + 1);
  const [document] = [rest.split('/§')[0]];
  const base = c.href(document);
  const sec = rest.match(/§(\d+)/), par = rest.match(/¶(\d+)/);
  if (corpusName === 'const') return `/journal/constitution/${slug(rest)}/`;
  return sec ? `${base}#s${sec[1]}${par ? 'p' + par[1] : ''}` : base;
}

// ---- linking citations inside prose -------------------------------------------------

const ID_RE = /\b(?:(const|stat|jour|jdgt|prop)\.)?([A-Za-z0-9][A-Za-z0-9-]{1,48})(?:\/(§\d+))?(?:\/(¶\d+))?/g;
const PROSE_RE = new RegExp(`\\b[Aa]rticles?\\s+(\\d{1,2})(?:\\s*§+\\s*(\\d{1,3}))?(?:\\s*([${MARKS}]))?`, 'g');

export function linkify(text, entries, { esc = (s) => s, base = '' } = {}) {
  let out = esc(text);

  out = out.replace(ID_RE, (m, c, doc, sec, par) => {
    if (!c && !/^art-\d/.test(doc)) return m;
    const id = normalise(`${c ? c + '.' : ''}${doc}${sec ? '/' + sec : ''}${par ? '/' + par : ''}`);
    const hit = entries.get(id);
    return hit ? `<a class="cite" href="${base}${hrefOf(id)}" data-cite="${id}">${m}</a>` : m;
  });

  out = out.replace(PROSE_RE, (m, a, s, p) => {
    const id = ['const.art-' + String(a).padStart(2, '0'), s ? '§' + s : null, p ? '¶' + (MARKS.indexOf(p) + 1) : null].filter(Boolean).join('/');
    const hit = entries.get(id);
    return hit ? `<a class="cite" href="${base}${hrefOf(id)}" data-cite="${id}">${m}</a>` : m;
  });

  return out;
}

export { MARKS };
