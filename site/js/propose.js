import { DATA, $, say, problem, ready, onIdentity, who, offerCommit, getJSON } from './common.js';
import { attachPicker, insertSection, insertParagraph, renumber } from './cite.js';
await ready;

const resolve = await getJSON('/data/resolve.json');
onIdentity(() => {});

for (const b of document.querySelectorAll('[data-ins]')) b.onclick = () => {
  const el = $('#body');
  if (b.dataset.ins === 'section') insertSection(el); else insertParagraph(el);
};

await attachPicker({
  box: $('#citepicker'),
  body: $('#cbody'), doc: $('#cdoc'), sec: $('#csec'), par: $('#cpar'),
  preview: document.querySelector('[data-citepreview]'),
  insert: document.querySelector('[data-cite-insert]'),
  open: document.querySelector('[data-cite-open]'),
  close: document.querySelector('[data-cite-close]'),
  target: () => $('#body'),
});

$('#prepare').onclick = () => {
  try {
    const title = $('#title').value.trim();
    if (!title) throw new Error('give it a title');
    const cites = $('#cites').value.split('\n').map((c) => c.trim()).filter(Boolean);
    if (!cites.length) throw new Error('a measure that cites nothing is not received — art-08/§1/¶3');
    const bad = cites.filter((c) => !resolve[c] && !resolve['const.' + c]);
    if (bad.length) throw new Error('does not resolve: ' + bad.join(', '));

    const cls = $('#cls').value;
    const spec = DATA.classes[cls];
    const now = new Date();
    const closes = new Date(now.getTime() + spec.window * 86400000).toISOString().slice(0, 10);
    const id = DATA.next;

    const md = ['---', `id: ${id}`, `title: ${title}`, `sponsor: ${who() || 'c-0001'}`, `class: ${cls}`,
      ...($('#authorises').value.trim() ? [`authorises: "${$('#authorises').value.trim()}"`] : []),
      ...($('#amends').value.trim() ? [`amends: ${$('#amends').value.trim()}`] : []),
      'cites:', ...cites.map((c) => `  - ${c}`),
      `opened: ${now.toISOString().slice(0, 10)}`, `closes: ${closes}`,
      '---', '', renumber($('#body').value).trim() || '## § 1\n\n¹ ', ''].join('\n');

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'measure';
    offerCommit(`proposals/${id}-${slug}.md`, md, `propose ${id}`);
    say(`Received. ${id}, closing ${closes}. Quorum ${Math.ceil(spec.quorum * 1)} of the active citizenships.`);
  } catch (e) { problem('not received', e); }
};
