import { DATA, $, say, problem, ready, onIdentity, who, offerCommit, getJSON } from './common.js';
await ready;

const resolve = await getJSON('/data/resolve.json');
onIdentity(() => {});

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
      '---', '', '## § 1', '', '¹ ' + ($('#body').value.trim() || ''), ''].join('\n');

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'measure';
    offerCommit(`proposals/${id}-${slug}.md`, md, `propose ${id}`);
    say(`Received. ${id}, closing ${closes}. Quorum ${Math.ceil(spec.quorum * 1)} of the active citizenships.`);
  } catch (e) { problem('not received', e); }
};
