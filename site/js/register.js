import { DATA, $, say, problem, ready, onIdentity, who, offerCommit } from './common.js';
await ready;

onIdentity(() => {
  $('#form').disabled = !who();

  const me = DATA.citizens.find((c) => c.id === who());
  $('[data-mine]').hidden = !me;
  $('[data-mymsg]').textContent = me
    ? `Acting as ${me.id}.${me.delegate_to ? ` Your vote is delegated to ${me.delegate_to}.` : ''}`
    : 'Load a key to act on your own citizenship.';
  if (me) $('#delegate').value = me.delegate_to || '';
});

// A change to your own citizenship is a file you already own, so it goes
// straight to the register rather than through settlement.
function ownCommit(fields, message) {
  const me = DATA.citizens.find((c) => c.id === who());
  const yml = [
    `id: ${me.id}`,
    `status: ${fields.status ?? me.status}`,
    `admitted: ${me.admitted}`,
    ...(fields.departed ? [`departed: ${fields.departed}`, 'departed_under: art-03/§4/¶1'] : []),
    ...(fields.delegate_to ? [`delegate_to: ${fields.delegate_to}`] : []),
    ...(me.github ? [`github: ${me.github}`] : []),
    'keys:',
    ...me.keys.map((k) => `  - ${k}`),
    '',
  ].join('\n');
  const out = $('[data-out2]'), link = $('[data-commit2]');
  out.hidden = false; out.textContent = yml;
  const q = new URLSearchParams({ filename: `register/citizens/${me.id}.yml`, value: yml, message });
  link.href = `https://github.com/${DATA.repo}/new/${DATA.branch}?${q}`;
  link.hidden = false;
}

document.querySelector('[data-act="delegate"]')?.addEventListener('click', () => {
  try {
    if (!who()) throw new Error('load a key that is on the register');
    const to = $('#delegate').value.trim();
    if (to && !DATA.citizens.some((c) => c.id === to && c.status === 'active')) throw new Error(`${to} is not an active citizenship`);
    if (to === who()) throw new Error('you cannot delegate to yourself');
    ownCommit({ delegate_to: to || null }, to ? `delegate to ${to}` : 'revoke the delegation');
    say(to ? `Prepared. Your vote goes to ${to} where you have not voted yourself — art-08/§3/¶4.`
           : 'Prepared. The delegation is revoked.');
  } catch (e) { problem('could not prepare', e); }
});

document.querySelector('[data-act="depart"]')?.addEventListener('click', () => {
  try {
    if (!who()) throw new Error('load a key that is on the register');
    if (!confirm('Depart the Republic? You may return by the procedure for admission, and no record already made is altered.')) return;
    ownCommit({ status: 'departed', departed: new Date().toISOString().slice(0, 10) }, `${who()} departs (art-03/§4/¶1)`);
    say('Prepared. Commit it to depart — art-03/§4/¶1. You may return at any time.');
  } catch (e) { problem('could not prepare', e); }
});

$('#form').onclick = () => {
  try {
    if (!who()) throw new Error('load a key that is on the register');
    const name = $('#name').value.trim();
    if (!name) throw new Error('give it a name');
    const type = $('#type').value;
    const rule = DATA.entities[type];
    const under = $('#under').value.trim();
    if (rule.formed_by === 'law' && !under) {
      throw new Error(`a ${type} is formed only on a carried measure, and only the Registrar may enter it — art-04/§1/¶2`);
    }
    const id = DATA.next;
    const yml = [
      `id: ${id}`, `type: ${type}`, `name: ${name}`,
      `formed: ${new Date().toISOString().slice(0, 10)}`, `formed_by: ${who()}`,
      `under: ${rule.formed_by === 'law' ? 'art-04/§1/¶2' : 'art-04/§1/¶1'}`,
      ...(under ? [`measure: ${under}`] : []),
      `charter: charters/${id}.md`,
      'organs:', '  - name: convenor', `    held_by: [${who()}]`,
      `members: [${who()}]`, 'status: active', '',
    ].join('\n');
    offerCommit(`register/entities/${id}.yml`, yml, `form ${id}`);
    say(rule.formed_by === 'law'
      ? `Prepared under ${under}. Only the Registrar may commit it — art-04/§1/¶2.`
      : 'Prepared. No permission is required — art-04/§1/¶1. Commit it, then write the charter.');
  } catch (e) { problem('could not form', e); }
};
