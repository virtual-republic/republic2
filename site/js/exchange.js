import { DATA, $, say, problem, ready, onIdentity, who, key } from './common.js';
import { offer, num } from './acts.js';
await ready;

const mine = () => DATA.accounts.filter((a) => a.id === who() || (a.organs || []).some((o) => (o.held_by || []).includes(who())));

onIdentity(() => {
  const sel = $('#oacct');
  if (!sel) return;
  const rows = mine();
  sel.innerHTML = rows.map((a) => `<option>${a.id}</option>`).join('') || '<option value="">no account</option>';
  $('[data-act="order"]').disabled = !(key() && who() && rows.length);
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
