import { DATA, $, $$, say, problem, ready, onIdentity, who, key, u } from './common.js';
import { offer, num } from './acts.js';
await ready;

const isOrgan = () => (DATA.organs || []).some((o) => (o.held_by || []).includes(who()));

onIdentity(() => {
  const ok = key() && who() && isOrgan();
  $('[data-console]').hidden = !ok;
  say(ok ? `Acting for ${DATA.entity} as ${who()}.`
    : who() ? `${who()} is not an organ of ${DATA.entity} — art-04/§3/¶4.`
    : `Load a key that is an organ of ${DATA.entity} to act for it.`,
    !!(who() && !isOrgan()));
});

if (DATA.hasCharter) {
  try { $('#ctext').value = await (await fetch(u(`/data/charters/${DATA.entity}.md`))).text(); } catch {}
}

for (const b of $$('[data-act]')) b.onclick = async () => {
  try {
    if (!isOrgan()) throw new Error(`you are not an organ of ${DATA.entity}`);
    const E = DATA.entity;
    switch (b.dataset.act) {
      case 'issue':
        await offer({ kind: 'instrument.issue', issuer: E, class: ($('#icls').value || 'ordinary').trim(),
          quantity: num($('#iqty'), 'quantity'), to: ($('#ito').value || E).trim() }, `issue a share in ${E}`);
        break;
      case 'transfer': {
        const what = $('#twhat').value, n = num($('#tamt'), 'amount');
        await offer(what === 'unit'
          ? { kind: 'value.transfer', from: E, to: $('#tto').value, amount: n }
          : { kind: 'instrument.transfer', from: E, to: $('#tto').value, instrument: what, quantity: n },
          `transfer from ${E}`);
        break;
      }
      case 'order':
        await offer({ kind: 'order', side: $('#oside').value, instrument: $('#oinst').value,
          quantity: num($('#oqty'), 'quantity'), price: num($('#oprice'), 'price'), account: E },
          `${$('#oside').value} ${$('#oinst').value}`);
        break;
      case 'admit':
      case 'remove': {
        const members = $('#mwho').value.split(',').map((s) => s.trim()).filter(Boolean);
        if (!members.length) throw new Error('name at least one citizenship');
        await offer({ kind: 'entity.amend', entity: E, what: b.dataset.act === 'admit' ? 'members.admit' : 'members.remove', members },
          `${b.dataset.act} ${members.join(', ')}`);
        break;
      }
      case 'organs': {
        const organs = $('#oset').value.split(',').map((x) => {
          const [n, h] = x.split('=');
          return { name: (n || '').trim(), held_by: (h || '').split('/').map((y) => y.trim()).filter(Boolean) };
        }).filter((o) => o.name);
        if (!organs.length) throw new Error('give at least one organ');
        await offer({ kind: 'entity.amend', entity: E, what: 'organs', organs }, `organs of ${E}`);
        break;
      }
      case 'charter':
        await offer({ kind: 'entity.amend', entity: E, what: 'charter', text: $('#ctext').value }, `charter of ${E}`);
        break;
      case 'dissolve':
        if (!confirm(`Dissolve ${E}? Its holdings pass as the charter provides, and failing that to the Treasury.`)) return;
        await offer({ kind: 'entity.amend', entity: E, what: 'dissolve' }, `dissolve ${E}`);
        break;
    }
  } catch (e) { problem('could not sign', e); }
};
