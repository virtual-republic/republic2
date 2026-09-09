import { DATA, $, u, say, problem, ready, onIdentity, who, key, getJSON } from './common.js';
import { offer } from './acts.js';
await ready;

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let state = { recogniser: null, deeds: [] };

// Read from the published record rather than from the page, so a request that
// settled a minute ago appears without waiting for a rebuild.
async function load() {
  try {
    state = await getJSON('/data/deeds.json');
    $('[data-loading]').hidden = true;
    $('[data-lists]').hidden = false;
    paint();
  } catch (e) {
    const el = $('[data-loading]');
    el.textContent = 'could not read the register: ' + e.message;
    el.classList.add('failed');
  }
}

const valid = () => state.deeds.filter((d) => d.status === 'valid');
const pending = () => state.deeds.filter((d) => d.status === 'requested');
const refused = () => state.deeds.filter((d) => d.status === 'refused');

function paint() {
  const v = valid();
  $('[data-valid]').hidden = !v.length;
  $('[data-no-valid]').hidden = !!v.length;
  $('[data-valid] tbody').innerHTML = v.map((d) => `<tr>
    <td><a href="${u(`/journal/deeds/${d.id}/`)}">${esc(d.title || d.id)}</a></td>
    <td>${esc(d.holder)}</td>
    <td class="q">${d.transferable ? 'yes' : 'no'}</td>
    <td class="q">${d.journal ? `<a href="${u(`/journal/issues/${d.journal}/`)}">Journal ${d.journal}</a>` : '—'}</td></tr>`).join('');

  const p = pending();
  $('[data-pending]').hidden = !p.length;
  $('[data-no-pending]').hidden = !!p.length;
  $('[data-pending] tbody').innerHTML = p.map((d) => `<tr>
    <td>${esc(d.title || d.id)}<span class="q"> · ${esc(d.id)}</span></td>
    <td class="q">${esc(d.requested_by)}</td>
    <td class="q">${esc(d.holder)}</td>
    <td class="q">${d.transferable ? 'yes' : 'no'}</td></tr>`).join('');

  const r = refused();
  $('[data-refused-box]').hidden = !r.length;
  if (r.length) $('[data-refused] tbody').innerHTML = r.map((d) =>
    `<tr><td>${esc(d.title || d.id)}</td><td class="q">${esc(d.reasons || '')}</td></tr>`).join('');

  paintKeeper();
}

// The console used to vanish silently when nobody held the power. Now it says so.
function paintKeeper() {
  const box = $('[data-keeper]');
  const msg = $('[data-keepermsg]');
  const rec = state.recogniser;

  if (!rec) {
    box.hidden = true;
    msg.innerHTML = 'No office on the register holds <code>deed.recognise</code>, so nobody may recognise anything. '
      + 'The settings grant it to the Keeper of the Journal, but the register governs — art-06/§4/¶1. '
      + 'Whoever holds the repository should run:<pre class="cmd">republic office sync --apply</pre>';
    msg.className = 'msg bad';
    return;
  }

  if (!who()) {
    box.hidden = true;
    msg.innerHTML = `${esc(rec.title)} is ${esc(rec.holder)}. <a href="${u('/key/')}">Load that key</a> to recognise or refuse.`;
    msg.className = 'quiet';
    return;
  }

  if (who() !== rec.holder) {
    box.hidden = true;
    msg.textContent = `Only the ${rec.title} may recognise a deed. That is ${rec.holder}, and you are ${who()}.`;
    msg.className = 'quiet';
    return;
  }

  box.hidden = false;
  const p = pending();
  msg.textContent = p.length
    ? `You are the ${rec.title}. ${p.length} request${p.length === 1 ? '' : 's'} outstanding.`
    : `You are the ${rec.title}. Nothing is outstanding, but you may recognise one directly below.`;
  msg.className = 'quiet';
  $('#rid').innerHTML = p.length
    ? p.map((d) => `<option value="${esc(d.id)}">${esc(d.title || d.id)} (${esc(d.id)})</option>`).join('')
    : '<option value="">nothing outstanding</option>';
}

onIdentity(() => {
  $('[data-act="request"]').disabled = !(key() && who());
  if (state.deeds.length || state.recogniser !== null) paintKeeper();
});

const slugify = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

document.querySelector('[data-act="request"]').onclick = async () => {
  try {
    if (!who()) throw new Error('load a key that is on the register — see Your key');
    const title = $('#dtitle').value.trim();
    if (!title) throw new Error('say what is claimed');
    const id = $('#did0').value.trim() || slugify(title);
    if (!id) throw new Error('that title makes no identifier — give one');
    if (state.deeds.some((d) => d.id === id && d.status !== 'refused')) {
      throw new Error(`there is already a deed or request called "${id}" — choose another identifier`);
    }
    await offer({
      kind: 'deed.request', deed: id, title,
      deedKind: $('#dkind').value,
      holder: $('#dholder').value,
      transferable: $('#dtransferable').value === 'yes',
      text: $('#dtext').value.trim() || undefined,
    }, `ask for deed.${id}`);
    say(`Signed as "${id}". Commit it below — nothing reaches the register until you do. `
      + `${state.recogniser ? `Then the ${state.recogniser.title} decides.` : ''} It confers nothing until recognised — art-05/§2/¶2.`);
  } catch (e) { problem('could not sign', e); }
};

document.querySelector('[data-act="recognise"]').onclick = async () => {
  try {
    const id = $('#rid').value;
    if (!id) throw new Error('there is nothing outstanding to recognise — use "recognise one directly" below');
    await offer({ kind: 'deed.recognise', deed: id }, `recognise deed.${id}`);
    say('Signed. Commit it; on settlement it is published in the Journal, and valid from then.');
  } catch (e) { problem('could not sign', e); }
};

document.querySelector('[data-act="refuse"]').onclick = async () => {
  try {
    const id = $('#rid').value;
    if (!id) throw new Error('there is nothing outstanding to refuse');
    const reasons = $('#rreasons').value.trim();
    if (!reasons) throw new Error('a refusal states its reasons');
    await offer({ kind: 'deed.refuse', deed: id, reasons }, `refuse deed.${id}`);
  } catch (e) { problem('could not sign', e); }
};

document.querySelector('[data-act="recognise-direct"]').onclick = async () => {
  try {
    const title = $('#dtitle2').value.trim();
    const id = $('#did').value.trim() || slugify(title);
    if (!id || !title) throw new Error('give an identifier and say what is recognised');
    if (state.deeds.some((d) => d.id === id && d.status === 'valid')) throw new Error(`deed.${id} is already recognised`);
    await offer({
      kind: 'deed.recognise', deed: id, title,
      holder: $('#dholder2').value,
      transferable: $('#dtransferable2').value === 'yes',
    }, `recognise deed.${id}`);
    say('Signed. Commit it; on settlement it is published in the Journal, and valid from then.');
  } catch (e) { problem('could not sign', e); }
};

await load();
