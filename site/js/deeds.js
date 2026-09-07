import { DATA, $, say, problem, ready, onIdentity, who, key } from './common.js';
import { offer } from './acts.js';
await ready;

const isKeeper = () => !!DATA.keeper && DATA.keeper.holder === who();

onIdentity(() => {
  $('[data-act="request"]').disabled = !(key() && who());
  $('[data-keeper]').hidden = !isKeeper();
  if (isKeeper()) {
    $('#rid').innerHTML = DATA.pending.length
      ? DATA.pending.map((d) => `<option value="${d.id}">${d.title} (${d.id})</option>`).join('')
      : '<option value="">nothing outstanding</option>';
  }
});

const slugify = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

document.querySelector('[data-act="request"]').onclick = async () => {
  try {
    if (!who()) throw new Error('load a key that is on the register');
    const title = $('#dtitle').value.trim();
    if (!title) throw new Error('say what is claimed');
    const id = slugify(title);
    if (!id) throw new Error('that title makes no identifier');
    await offer({
      kind: 'deed.request', deed: id, title,
      deedKind: $('#dkind').value,
      holder: $('#dholder').value,
      transferable: $('#dtransferable').value === 'yes',
      text: $('#dtext').value.trim() || undefined,
    }, `ask for deed.${id}`);
    say(`Signed. Commit it, and the ${DATA.keeper ? DATA.keeper.title : 'Keeper'} decides. It confers nothing until recognised — art-05/§2/¶2.`);
  } catch (e) { problem('could not sign', e); }
};

document.querySelector('[data-act="recognise"]')?.addEventListener('click', async () => {
  try {
    const id = $('#rid').value;
    if (!id) throw new Error('there is nothing outstanding to recognise');
    await offer({ kind: 'deed.recognise', deed: id }, `recognise deed.${id}`);
    say('Signed. On settlement it is published in the Journal, and valid from then.');
  } catch (e) { problem('could not sign', e); }
});

document.querySelector('[data-act="refuse"]')?.addEventListener('click', async () => {
  try {
    const id = $('#rid').value;
    if (!id) throw new Error('there is nothing outstanding to refuse');
    const reasons = $('#rreasons').value.trim();
    if (!reasons) throw new Error('a refusal states its reasons');
    await offer({ kind: 'deed.refuse', deed: id, reasons }, `refuse deed.${id}`);
  } catch (e) { problem('could not sign', e); }
});

document.querySelector('[data-act="recognise-direct"]')?.addEventListener('click', async () => {
  try {
    const title = $('#dtitle2').value.trim();
    const id = ($('#did').value.trim() || slugify(title));
    if (!id || !title) throw new Error('give an identifier and say what is recognised');
    await offer({
      kind: 'deed.recognise', deed: id, title,
      holder: $('#dholder2').value,
      transferable: $('#dtransferable2').value === 'yes',
    }, `recognise deed.${id}`);
    say('Signed. On settlement it is published in the Journal, and valid from then.');
  } catch (e) { problem('could not sign', e); }
});
