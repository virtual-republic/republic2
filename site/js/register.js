import { DATA, $, say, problem, ready, onIdentity, who, offerCommit } from './common.js';
await ready;

onIdentity(() => { $('#form').disabled = !who(); });

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
