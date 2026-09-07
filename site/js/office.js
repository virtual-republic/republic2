import { DATA, $, say, problem, ready, onIdentity, who, key, offerCommit, citizens } from './common.js';
await ready;

function render() {
  const live = new Set(citizens().filter((c) => c.status === 'active').map((c) => c.id));
  const behind = DATA.elections.filter((e) => e.carried && e.winner && DATA.offices.find((o) => o.id === e.office)?.holder !== e.winner);
  const stranded = DATA.offices.filter((o) => !live.has(o.holder));

  const pend = $('[data-pending]');
  if (behind.length) {
    pend.innerHTML = `${behind.length} carried election${behind.length === 1 ? '' : 's'} not yet given effect: ` +
      behind.map((e) => `${e.id} → ${e.winner} as ${e.office}`).join('; ') +
      `<pre class="cmd">republic office install --all</pre>`;
  } else {
    pend.textContent = 'Every carried election has taken effect.';
  }

  const box = $('[data-powers]');
  if (!who()) { box.innerHTML = ''; $('#stand').disabled = true; return; }
  $('#stand').disabled = false;

  const mine = DATA.offices.filter((o) => o.holder === who());
  if (!mine.length) {
    say(`${who()} holds no office.`);
    box.innerHTML = '<ul class="list">' + DATA.offices.map((o) =>
      `<li>${o.title}<span class="meta">${o.holder}${live.has(o.holder) ? '' : ' — not an active citizenship'}</span></li>`).join('') + '</ul>' +
      (stranded.length ? `<p class="note">${stranded.length} office${stranded.length === 1 ? ' is' : 's are'} recorded to a citizenship that is not active, so ${stranded.length === 1 ? 'it is' : 'they are'} vacant in fact — art-06/§3/¶5.</p><pre class="cmd">republic office vacant --fill ${who()}</pre>` : '');
    return;
  }

  say(`${who()} holds ${mine.map((o) => o.title).join(', ')}.`);
  const powers = [...new Set(mine.flatMap((o) => o.powers || []))];
  box.innerHTML = '<ul class="list">' + powers.map((p) => {
    const a = DATA.powers[p] || [p, '', ''];
    return `<li>${a[0]}<span class="meta">${a[2]}</span></li>`;
  }).join('') + '</ul>';
}

onIdentity(render);

$('#stand').onclick = () => {
  try {
    if (!who()) throw new Error('load a key that is on the register');
    const o = DATA.offices.find((x) => x.id === $('#office').value);
    const spec = DATA.classes.election;
    const now = new Date();
    const closes = new Date(now.getTime() + spec.window * 86400000).toISOString().slice(0, 10);
    const md = ['---', `id: ${DATA.next}`, `title: Election — ${o.title}`, `sponsor: ${who()}`,
      'class: election', `office: ${o.id}`, `candidates: [${who()}]`,
      'cites:', '  - art-06/§3/¶1', '  - art-08/§6/¶1',
      `opened: ${now.toISOString().slice(0, 10)}`, `closes: ${closes}`,
      '---', '', '## § 1  The office', '',
      `¹ The office of ${o.title} is filled under Article 8 § 6 ¹.`, '',
      '² The vote is by the single transferable vote in its instant-runoff form.', ''].join('\n');
    offerCommit(`proposals/${DATA.next}-election-${o.id}.md`, md, `election ${DATA.next}`);
    say(`Prepared. ${DATA.next} — election for ${o.title}, closing ${closes}.`);
  } catch (e) { problem('could not prepare', e); }
};
