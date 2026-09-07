// The citation helper.
//
// Every text the Republic has, browsable down to the paragraph, producing the
// standard citation. Typing one by hand still works — this is for when you do
// not remember whether the Assembly is Article 6 § 2 or Article 6 § 3.
//
//     const.art-05/§2/¶4      a provision of the Constitution
//     stat.obol-issuance/§1/¶2 a paragraph of a statute
//     stat.one                 a whole statute
//     deed.river-mill          a deed
//
// It reads /data/citations.json, which the build writes from the same corpus
// that resolves citations — so anything offered here is guaranteed to resolve.

import { u, $ } from './common.js';

let index = null;
export async function load() {
  if (!index) index = await (await fetch(u('/data/citations.json'))).json();
  return index;
}

const LABELS = { const: 'Constitution', stat: 'Statute', jour: 'Journal', jdgt: 'Judgment', deed: 'Deed', prop: 'Measure' };

// Wire a picker made of five elements to a textarea.
export async function attachPicker({ box, body, doc, sec, par, preview, insert, open, close, target }) {
  const data = await load();

  const fill = (el, items, blank) => {
    el.innerHTML = (blank ? `<option value="">${blank}</option>` : '') +
      items.map((i) => `<option value="${i.value}">${i.label}</option>`).join('');
    el.disabled = !items.length;
  };

  const corpora = [...new Set(data.map((d) => d.corpus))];
  fill(body, corpora.map((c) => ({ value: c, label: LABELS[c] || c })));

  const docsFor = (c) => {
    const seen = new Map();
    for (const d of data) if (d.corpus === c && !seen.has(d.document)) seen.set(d.document, d.title || d.document);
    return [...seen].map(([value, label]) => ({ value, label }));
  };
  const secsFor = (c, d) => [...new Set(data.filter((x) => x.corpus === c && x.document === d && x.section).map((x) => x.section))]
    .sort((a, b) => a - b).map((v) => ({ value: v, label: '§ ' + v }));
  const parsFor = (c, d, sN) => [...new Set(data.filter((x) => x.corpus === c && x.document === d && x.section === Number(sN) && x.paragraph).map((x) => x.paragraph))]
    .sort((a, b) => a - b).map((v) => ({ value: v, label: '¶ ' + v }));

  const citation = () => {
    if (!doc.value) return '';
    let c = `${body.value}.${doc.value}`;
    if (sec.value) c += `/§${sec.value}`;
    if (sec.value && par.value) c += `/¶${par.value}`;
    return c;
  };

  const refresh = () => {
    const c = citation();
    const hit = data.find((x) => x.id === c);
    preview.textContent = c ? `${c}${hit && hit.label ? ' — ' + hit.label : ''}` : '—';
    preview.className = c && hit ? 'quiet' : 'quiet';
  };

  body.onchange = () => { fill(doc, docsFor(body.value)); doc.onchange(); };
  doc.onchange = () => { fill(sec, secsFor(body.value, doc.value), 'the whole text'); sec.onchange(); };
  sec.onchange = () => { fill(par, sec.value ? parsFor(body.value, doc.value, sec.value) : [], 'the whole section'); refresh(); };
  par.onchange = refresh;
  body.onchange();

  open.onclick = () => { box.hidden = !box.hidden; };
  close.onclick = () => { box.hidden = true; };

  insert.onclick = () => {
    const c = citation();
    if (!c) return;
    const el = target();
    const at = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, at) + c + el.value.slice(el.selectionEnd ?? at);
    el.focus();
    el.selectionStart = el.selectionEnd = at + c.length;
    box.hidden = true;
  };
}

// § and ¶ marks, inserted where the cursor is.
const MARKS = '¹²³⁴⁵⁶⁷⁸⁹';

export function insertSection(el) {
  const text = el.value;
  const next = (text.match(/^##\s+§\s*(\d+)/gm) || []).reduce((n, h) => Math.max(n, Number(h.match(/\d+/)[0])), 0) + 1;
  const block = `${text.trim() ? '\n\n' : ''}## § ${next}  \n\n¹ `;
  const at = el.selectionStart ?? text.length;
  el.value = text.slice(0, at) + block + text.slice(at);
  el.focus();
  // put the cursor on the heading, which is what you want to type next
  const head = at + block.indexOf('  \n') + 2;
  el.selectionStart = el.selectionEnd = head;
}

// The next paragraph in the section the cursor is in — art-02/§4/¶1 wants every
// paragraph separately addressable, so they are numbered as they are written.
export function insertParagraph(el) {
  const before = el.value.slice(0, el.selectionStart ?? el.value.length);
  const section = before.split(/^##\s+§/m).pop();
  const used = (section.match(new RegExp(`^[${MARKS}]`, 'gm')) || []).length;
  const mark = MARKS[Math.min(used, MARKS.length - 1)];
  const block = `\n\n${mark} `;
  const at = el.selectionStart ?? el.value.length;
  el.value = el.value.slice(0, at) + block + el.value.slice(at);
  el.focus();
  el.selectionStart = el.selectionEnd = at + block.length;
}

// Renumber every mark so they run 1, 2, 3 within each section however they were
// typed, pasted or reordered.
export function renumber(text) {
  let n = 0;
  return String(text).split('\n').map((line) => {
    if (/^##\s+§/.test(line)) { n = 0; return line; }
    const m = line.match(new RegExp(`^[${MARKS}](\\s.*)$`));
    if (!m) return line;
    return MARKS[Math.min(n++, MARKS.length - 1)] + m[1];
  }).join('\n');
}
