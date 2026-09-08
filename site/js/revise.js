import { DATA, $, say, problem, ready, onIdentity, who, offerCommit } from './common.js';
import { attachPicker, insertSection, insertParagraph, renumber } from './cite.js';
await ready;

// Compare any two versions — art-12/§3/¶2.
const cmp = $('#compare');
if (cmp) {
  const go = () => {
    const a = Number($('#va').value), b = Number($('#vb').value);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    cmp.href = lo === hi ? '#' : `${DATA.base}/journal/law/${DATA.statute}/v${lo}-v${hi}/`;
    cmp.setAttribute('aria-disabled', String(lo === hi));
    cmp.textContent = lo === hi ? 'same version' : `Compare v${lo} to v${hi}`;
  };
  $('#va').onchange = go; $('#vb').onchange = go; go();
}

const box = $('#editor');
$('#revise').onclick = () => {
  box.hidden = !box.hidden;
  if (!box.hidden && !$('#rtext').value) $('#rtext').value = DATA.text;
};

onIdentity(() => { $('#rprepare').disabled = !who(); });

for (const b of document.querySelectorAll('[data-ins]')) b.onclick = () => {
  const el = $('#rtext');
  if (b.dataset.ins === 'section') insertSection(el); else insertParagraph(el);
};

await attachPicker({
  box: $('#citepicker'),
  body: $('#cbody'), doc: $('#cdoc'), sec: $('#csec'), par: $('#cpar'),
  preview: document.querySelector('[data-citepreview]'),
  insert: document.querySelector('[data-cite-insert]'),
  open: document.querySelector('[data-cite-open]'),
  close: document.querySelector('[data-cite-close]'),
  target: () => $('#rtext'),
});

// The diff, computed here so you see what you are proposing before you propose
// it. The same computation runs at build time for the measure's own page.
document.querySelector('[data-preview]').onclick = async () => {
  const { diffLines, pairEdits, summarise, locate, hunks } = await import('./core/diff.js');
  const after = renumber($('#rtext').value);
  $('#rtext').value = after;
  const d = pairEdits(diffLines(DATA.text, after));
  const n = summarise(d);
  const where = locate(after), was = locate(DATA.text);
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const p = $('#preview');
  p.hidden = false;
  if (!d.some((x) => x.kind !== 'same')) { p.innerHTML = '<p class="quiet">Nothing has changed yet.</p>'; return; }

  p.innerHTML = `<p class="quiet">${n.added} added, ${n.altered} altered, ${n.removed} struck.</p><div class="diff">` +
    hunks(d, 2).map((x) => {
      if (x.kind === 'gap') return '<div class="gap">⋯</div>';
      const w = x.after ? where[x.after - 1] : x.before ? was[x.before - 1] : null;
      const at = w && w.section ? `§${w.section}${w.paragraph ? '/¶' + w.paragraph : ''}` : '';
      if (x.kind === 'altered') {
        return `<div class="line was"><span class="at">${at}</span><span class="sign">−</span><span class="t">${esc(x.from)}</span></div>` +
               `<div class="line now"><span class="at"></span><span class="sign">+</span><span class="t">${esc(x.text)}</span></div>`;
      }
      const cls = { same: 'same', added: 'now', removed: 'was' }[x.kind];
      const sign = { same: ' ', added: '+', removed: '−' }[x.kind];
      return `<div class="line ${cls}"><span class="at">${at}</span><span class="sign">${sign}</span><span class="t">${esc(x.text)}</span></div>`;
    }).join('') + '</div>';
};

$('#rprepare').onclick = async () => {
  try {
    if (!who()) throw new Error('load a key that is on the register');
    const text = renumber($('#rtext').value).trim();
    if (!text) throw new Error('the revision is empty');
    if (text === DATA.text.trim()) throw new Error('nothing has changed');

    const cites = $('#rcites').value.split('\n').map((c) => c.trim()).filter(Boolean);
    if (!cites.length) throw new Error('a measure that cites nothing is not received — art-08/§1/¶3');

    const cls = $('#rclass').value;
    const spec = DATA.classes[cls];
    const now = new Date();
    const closes = new Date(now.getTime() + spec.window * 86400000).toISOString().slice(0, 10);
    const id = DATA.next;

    const md = ['---', `id: ${id}`, `title: ${$('#rtitle').value.trim() || DATA.statute}`,
      `sponsor: ${who()}`, `class: ${cls}`, `revises: ${DATA.statute}`,
      'cites:', ...cites.map((c) => `  - ${c}`),
      `opened: ${now.toISOString().slice(0, 10)}`, `closes: ${closes}`,
      '---', '', text, ''].join('\n');

    const slug = ($('#rtitle').value.trim() || DATA.statute).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    offerCommit(`proposals/${id}-${slug}.md`, md, `revise stat.${DATA.statute}`);
    say(`Prepared as ${id}, a revision of stat.${DATA.statute}. Commit it and it goes to the Assembly, closing ${closes}.`);
  } catch (e) { problem('could not prepare', e); }
};
