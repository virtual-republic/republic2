import { DATA, $, $$, say, problem, ready, onIdentity, who, key } from './common.js';
import { offer, num } from './acts.js';
await ready;

const mine = () => DATA.accounts.filter((a) =>
  a.id === who() || (a.organs || []).some((o) => (o.held_by || []).includes(who())) || a.officer === who());

const mayIssue = () => DATA.offices.some((o) => o.holder === who() && (o.powers || []).includes('value.issue'));

function render() {
  const rows = mine();
  const t = $('[data-mine]');
  if (!rows.length) {
    t.hidden = true;
    say(who() ? `${who()} holds no account.` : 'Load a key to see what you hold.');
  } else {
    t.hidden = false;
    say('');
    t.querySelector('tbody').innerHTML = rows.map((a) =>
      `<tr><td>${a.id}</td><td class="q">${a.kind}</td><td>${a.balance}</td><td class="q">${
        (a.holdings || []).map((h) => `${h.quantity} × ${h.instrument}`).join('<br>') || '—'}</td></tr>`).join('');
  }

  $('[data-issue-head]').hidden = !mayIssue();
  $('[data-issue]').hidden = !mayIssue();

  $('#tfrom').innerHTML = rows.map((a) => `<option>${a.id}</option>`).join('') || '<option value="">no account</option>';
  $('[data-act="transfer"]').disabled = !(key() && who() && rows.length);
}
onIdentity(render);

$('[data-act="issue"]')?.addEventListener('click', async () => {
  try {
    const resolution = $('#ires').value;
    if (!resolution) throw new Error('an issue must cite the resolution that authorises it — art-10/§2/¶1');
    await offer({ kind: 'value.issue', amount: num($('#iamt'), 'amount'), to: $('#ito2').value, resolution },
      `issue ${$('#iamt').value} under ${resolution}`);
  } catch (e) { problem('could not sign', e); }
});

$('[data-act="transfer"]').addEventListener('click', async () => {
  try {
    const from = $('#tfrom').value, to = $('#tto').value;
    if (from === to) throw new Error('from and to are the same account');
    const what = $('#twhat').value;
    const n = num($('#tamt'), 'amount');
    await offer(what === 'unit'
      ? { kind: 'value.transfer', from, to, amount: n, note: $('#tnote').value || undefined }
      : { kind: 'instrument.transfer', from, to, instrument: what, quantity: n },
      `transfer from ${from} to ${to}`);
  } catch (e) { problem('could not sign', e); }
});
