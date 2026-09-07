import { DATA, $, say, problem, ready, onIdentity, who, offerCommit, getJSON } from './common.js';
await ready;

const resolve = await getJSON('/data/resolve.json');
onIdentity(() => { $('#file').disabled = !who(); });

$('#file').onclick = () => {
  try {
    if (!who()) throw new Error('load a key that is on the register');
    const against = $('#against').value.trim();
    const ground = $('#ground').value.trim();
    if (!against) throw new Error('name the act complained of');
    if (!ground) throw new Error('state the ground');
    const construes = $('#construes').value.split(',').map((s) => s.trim()).filter(Boolean);
    const bad = construes.filter((c) => !resolve[c] && !resolve['const.' + c]);
    if (bad.length) throw new Error('does not resolve: ' + bad.join(', ') + ' — art-07/§4/¶2');

    const n = DATA.next;
    const md = ['---', `number: ${n}`, `title: ${who()} v ${against}`, `against: ${against}`,
      `applicant: ${who()}`, `seeking: ${$('#seeking').value}`,
      `filed: ${new Date().toISOString().slice(0, 10)}`,
      `construes: [${construes.join(', ')}]`, 'cites: [art-07/§2/¶1, art-09/§4/¶2]',
      '---', '', '## § 1  The application', '', `¹ ${who()} applies in respect of ${against}.`, '',
      '## § 2  Ground', '', `¹ ${ground}`, '',
      '## § 3  Answer', '', '¹ *To be completed by the respondent, or left blank.*', ''].join('\n');
    const slug = String(n).padStart(4, '0') + '-' + against.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    offerCommit(`journal/judgments/${slug}.md`, md, `case ${n}`);
    say('Prepared. Commit it to bring the case.');
  } catch (e) { problem('could not file', e); }
};
