import { DATA, $, $$, say, problem, ready, onIdentity, who, key, sign, rand, canonical, offerCommit, getJSON, citizens } from './common.js';
import { tally, ballotMessage } from './tally.js';
await ready;

let choice = null;
let ranking = [];

const refresh = () => {
  const b = $('#sign');
  if (b) b.disabled = !(key() && who() && choice && (!Array.isArray(choice) || choice.length));
};

if (DATA.election) {
  const paint = () => {
    for (const b of $$('[data-cand]')) {
      const i = ranking.indexOf(b.dataset.cand);
      b.setAttribute('aria-pressed', String(i !== -1));
      b.textContent = (i !== -1 ? `${i + 1}. ` : '') + b.dataset.cand;
    }
    const r = $('[data-rank]');
    if (r) r.textContent = ranking.length ? 'Your ranking: ' + ranking.join(', ') : 'Nothing ranked yet.';
    choice = ranking.length ? ranking.slice() : null;
    refresh();
  };
  for (const b of $$('[data-cand]')) b.onclick = () => {
    const i = ranking.indexOf(b.dataset.cand);
    if (i === -1) ranking.push(b.dataset.cand); else ranking.splice(i, 1);
    paint();
  };
  paint();
} else {
  for (const b of $$('[data-choice]')) b.onclick = () => {
    choice = b.dataset.choice;
    for (const x of $$('[data-choice]')) x.setAttribute('aria-pressed', String(x === b));
    refresh();
  };
}

onIdentity(refresh);

if ($('#sign')) $('#sign').onclick = async () => {
  try {
    if (!who()) throw new Error('load a key that is on the register — see Your key');
    if (!choice) throw new Error(DATA.election ? 'rank at least one candidate' : 'choose yes, no, or abstain');
    const b = { measure: DATA.measure, choice, at: new Date().toISOString(), salt: rand(8) };
    b.signature = await sign(ballotMessage(b));
    offerCommit(`ballots/${DATA.measure}/${who()}.json`, b, `ballot ${DATA.measure}`);
    say('Signed. Commit it on GitHub to cast it.');
  } catch (e) { problem('could not sign', e); }
};

// The count, run in this browser from the published ballots — art-08/§4/¶4.
try {
  const ballots = await getJSON(`/data/ballots/${DATA.measure}.json`);
  const t = await tally({
    measure: DATA.measure, spec: DATA.spec, ballots, roll: citizens(),
    closes: DATA.closes, closeRules: DATA.closeRules,
  });

  const state = $('[data-state]');
  state.textContent = DATA.election
    ? `${t.cast} of ${t.electorate} cast, ${t.quorumNeeded} needed — ` +
      (t.open ? 'open' + (t.winner ? `, leading: ${t.winner}` : '')
        : t.carried ? `elected ${t.winner}` : t.winner ? 'no quorum' : 'no result')
    : `${t.yes} yes, ${t.no} no, ${t.abstain} abstain — ${t.cast} of ${t.electorate} cast, ${t.quorumNeeded} needed — ` +
      (t.open ? 'open' : (t.closedEarly ? `closed early, ${t.closedEarly} — ` : '') + (t.carried ? 'carried' : 'not carried'));
  if (!t.open) state.classList.add(t.carried ? 'carried' : 'failed');

  if (DATA.election && t.rounds.length) {
    $('[data-rounds]').innerHTML = '<h2>Rounds</h2><table><thead><tr><th>Round</th><th>Counts</th><th>Eliminated</th></tr></thead><tbody>' +
      t.rounds.map((r, i) => `<tr><td>${i + 1}</td><td>${r.counts.map((c) => `${c[0]}: ${c[1]}`).join(' · ')}</td><td class="q">${r.eliminated || '—'}</td></tr>`).join('') +
      '</tbody></table>';
  }

  $('[data-rows]').innerHTML = Object.entries(ballots).map(([id, b]) =>
    `<tr><td>${id}</td><td>${Array.isArray(b.choice) ? b.choice.join(', ') : b.choice}</td><td class="q">${(b.at || '').slice(0, 10)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="q">None yet.</td></tr>';

  for (const r of t.rejected) console.warn('[republic] not counted:', r.id, r.why);
} catch (e) {
  const state = $('[data-state]');
  state.textContent = 'could not count: ' + e.message;
  state.classList.add('failed');
  console.error(e);
}
