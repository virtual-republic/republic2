import { DATA, $, $$, say, problem, ready, onIdentity, who, key, u } from './common.js';
import { offer, num } from './acts.js';
await ready;

const isOrgan = () => (DATA.organs || []).some((o) => (o.held_by || []).includes(who()));

const mayVote = () => (DATA.electorate || []).some((v) => v.id === who());

onIdentity(() => {
  // Voting is for the members or the holders; managing is for the organs.
  const box = document.querySelector('[data-vote]');
  if (box) {
    const open = DATA.resolutions || [];
    box.hidden = !(key() && who() && mayVote() && open.length);
    if (!box.hidden) {
      $('#rpick').innerHTML = open.map((r) => `<option value="${r.id}">${r.title} (${r.kind})</option>`).join('');
      paintChoices();
    }
  }

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

let entityChoice = null;
function paintChoices() {
  const r = (DATA.resolutions || []).find((x) => x.id === $('#rpick').value);
  const box = document.querySelector('[data-choices]');
  if (!r || !box) return;
  const options = r.kind === 'officer' ? (DATA.candidates || []) : ['yes', 'no', 'abstain'];
  box.innerHTML = options.map((o) => `<button data-choice="${o}">${o}</button>`).join('');
  entityChoice = null;
  document.querySelector('[data-act="entityvote"]').disabled = true;
  for (const b of box.querySelectorAll('[data-choice]')) b.onclick = () => {
    entityChoice = b.dataset.choice;
    for (const x of box.querySelectorAll('[data-choice]')) x.setAttribute('aria-pressed', String(x === b));
    document.querySelector('[data-act="entityvote"]').disabled = false;
  };
}
if ($('#rpick')) $('#rpick').onchange = paintChoices;

for (const b of $$('[data-act]')) b.onclick = async () => {
  try {
    if (b.dataset.act === 'entityvote') {
      if (!mayVote()) throw new Error(DATA.powers.vote === 'members' ? `you are not a member of ${DATA.entity}` : `you hold no share in ${DATA.entity}`);
    } else if (!isOrgan()) throw new Error(`you are not an organ of ${DATA.entity}`);
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
      case 'resolve': {
        const title = $('#rtitle').value.trim();
        if (!title) throw new Error('say what is decided');
        const kind = $('#rkind').value;
        if (kind === 'officer' && !$('#rorgan').value.trim()) throw new Error('an officer resolution names the organ to be filled');
        await offer({ kind: 'entity.resolve', entity: E, resolution: DATA.next, title,
          resolutionKind: kind,
          ...(kind === 'officer' ? { organ: $('#rorgan').value.trim() } : {}),
          text: $('#rtext').value.trim() || undefined }, `${E}: ${title}`);
        break;
      }
      case 'entityvote':
        if (!entityChoice) throw new Error('choose first');
        await offer({ kind: 'entity.vote', entity: E, resolution: $('#rpick').value, choice: entityChoice },
          `vote on ${$('#rpick').value} of ${E}`);
        break;
      case 'dissolve':
        if (!confirm(`Dissolve ${E}? Its holdings pass as the charter provides, and failing that to the Treasury.`)) return;
        await offer({ kind: 'entity.amend', entity: E, what: 'dissolve' }, `dissolve ${E}`);
        break;
    }
  } catch (e) { problem('could not sign', e); }
};
