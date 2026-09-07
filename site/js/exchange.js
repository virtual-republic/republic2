import { DATA, $, say, problem, ready, onIdentity, who, key } from './common.js';
import { offer, num } from './acts.js';
await ready;

const mine = () => DATA.accounts.filter((a) => a.id === who() || (a.organs || []).some((o) => (o.held_by || []).includes(who())));
// art-10/§4/¶1 — a company you are an organ of may issue a share in itself.
const myIssuers = () => (DATA.issuers || []).filter((e) => (e.organs || []).some((o) => (o.held_by || []).includes(who())));

onIdentity(() => {
  const sel = $('#oacct');
  if (sel) {
    const rows = mine();
    sel.innerHTML = rows.map((a) => `<option>${a.id}</option>`).join('') || '<option value="">no account</option>';
    $('[data-act="order"]').disabled = !(key() && who() && rows.length);
  }

  const issuers = myIssuers();
  $('[data-issue-head]').hidden = !issuers.length;
  $('[data-issue]').hidden = !issuers.length;
  if (issuers.length) {
    $('#ientity').innerHTML = issuers.map((e) => `<option value="${e.id}">${e.name} (${e.id})</option>`).join('');
    $('#ito').innerHTML = DATA.accounts.map((a) => `<option>${a.id}</option>`).join('');
  }
});

$('[data-act="issue"]')?.addEventListener('click', async () => {
  try {
    const issuer = $('#ientity').value;
    await offer({ kind: 'instrument.issue', issuer, class: ($('#icls').value || 'ordinary').trim(),
      quantity: num($('#iqty'), 'quantity'), to: $('#ito').value }, `issue a share in ${issuer}`);
  } catch (e) { problem('could not sign', e); }
});

$('[data-act="order"]')?.addEventListener('click', async () => {
  try {
    await offer({
      kind: 'order', side: $('#oside').value, instrument: $('#oinst').value,
      quantity: num($('#oqty'), 'quantity'), price: num($('#oprice'), 'price'),
      account: $('#oacct').value,
    }, `${$('#oside').value} ${$('#oinst').value}`);
  } catch (e) { problem('could not sign', e); }
});
