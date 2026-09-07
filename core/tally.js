// Counting a vote.
//
// One implementation. The command line and the browser both call this, so the
// count a citizen sees on a page and the count recorded in the register cannot
// disagree.
//
//   art-08/§3/¶2  a ballot not verified against a registered key is not counted
//   art-08/§3/¶3  one ballot per citizenship; a later ballot replaces an earlier
//   art-08/§3/¶5  voting closes when the outcome can no longer change
//   art-08/§4/¶1  a measure carries on quorum and threshold
//   art-08/§6/¶1  offices are filled by instant runoff

import { canonical } from './canonical.js';
import { verify } from './sshsig.js';

// Web Crypto, so this module runs unchanged in Node and in a browser. It must,
// because the count on a page and the count in the register have to agree.
const digest = async (text) => {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// The message a ballot signs. Changing this invalidates every ballot ever cast,
// so it lives in one place and is quoted nowhere else.
export const ballotMessage = (b) => canonical({ measure: b.measure, choice: b.choice, at: b.at, salt: b.salt });
export const receiptOf = async (b) => (await digest(ballotMessage(b))).slice(0, 16);

export function closesAt(measure, spec) {
  if (measure.closes) return new Date(measure.closes + 'T23:59:59Z');
  if (measure.opened) return new Date(new Date(measure.opened + 'T00:00:00Z').getTime() + spec.window * 86400000);
  return null;
}

// art-08/§3/¶6 — three limbs, each a reason waiting can change nothing.
function earlyClose({ cast, electorate, yes, no, quorumNeeded, threshold, rules, election }) {
  const ec = rules || {};
  const remaining = electorate - cast;
  if (!electorate) return null;
  if (cast / electorate < (ec.minimum_participation ?? 1)) return null;

  if (ec.on_full_participation && remaining <= 0) return 'every citizenship has voted';
  if (!ec.on_determined_outcome || election) return null;

  if (cast + remaining < quorumNeeded) return 'the quorum can no longer be reached';
  const carries = (y, n) => (cast + remaining) >= quorumNeeded && (y + n) > 0 && y / (y + n) >= threshold;
  const best = carries(yes + remaining, no);
  const worst = carries(yes, no + remaining);
  if (best === worst) return best ? 'it carries however the remaining ballots are cast' : 'it fails however the remaining ballots are cast';
  return null;
}

export function instantRunoff(ballots, candidates) {
  const live = new Set(candidates && candidates.length ? candidates : ballots.flatMap((b) => [].concat(b.choice)));
  const rounds = [];
  while (live.size > 1) {
    const counts = new Map([...live].map((c) => [c, 0]));
    let total = 0;
    for (const b of ballots) {
      const top = [].concat(b.choice).find((c) => live.has(c));
      if (top) { counts.set(top, counts.get(top) + (b.weight || 1)); total += (b.weight || 1); }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (!total) return { rounds, winner: null };
    if (sorted[0][1] > total / 2) { rounds.push({ counts: sorted, eliminated: null }); return { rounds, winner: sorted[0][0] }; }
    const last = sorted[sorted.length - 1][0];
    rounds.push({ counts: sorted, eliminated: last });
    live.delete(last);
  }
  return { rounds, winner: [...live][0] ?? null };
}

// roll: [{ id, status, keys }]   ballots: { citizenId: ballot }
export async function tally({ measure, spec, ballots, roll, closes, closeRules, delegations = {} }) {
  const electorate = roll.filter((c) => c.status === 'active');
  const byId = new Map(electorate.map((c) => [c.id, c]));

  const accepted = [];
  const rejected = [];

  for (const [id, b] of Object.entries(ballots)) {
    const c = byId.get(id);
    if (!c) { rejected.push({ id, why: 'not an active citizenship' }); continue; }
    if (b.measure !== measure) { rejected.push({ id, why: `the ballot is for ${b.measure}` }); continue; }
    if (!b.at) { rejected.push({ id, why: 'no timestamp' }); continue; }
    if (closes && new Date(b.at) > new Date(closes)) { rejected.push({ id, why: `cast after the close (${b.at})` }); continue; }

    const v = await verify(ballotMessage(b), b.signature, c.keys || [], 'republic');
    if (!v.ok) { rejected.push({ id, why: v.error }); continue; }
    accepted.push({ id, choice: b.choice, at: b.at, receipt: await receiptOf(b) });
  }

  // art-08/§3/¶3 — the later of two ballots stands.
  const counted = new Map();
  for (const b of accepted) {
    const held = counted.get(b.id);
    if (!held || new Date(b.at) > new Date(held.at)) counted.set(b.id, b);
  }

  // art-08/§3/¶4 — a delegate's weight is used only where the delegator has not voted.
  const voted = new Set(counted.keys());
  const delegated = [];
  for (const c of electorate) {
    const to = delegations[c.id];
    if (!to || voted.has(c.id)) continue;
    const seen = new Set([c.id]);
    let target = to;
    while (target && !voted.has(target) && delegations[target] && !seen.has(target)) { seen.add(target); target = delegations[target]; }
    if (target && voted.has(target)) {
      const b = counted.get(target);
      b.weight = (b.weight || 1) + 1;
      delegated.push({ from: c.id, to: target });
    }
  }

  const list = [...counted.values()];
  const cast = list.reduce((n, b) => n + (b.weight || 1), 0);
  const quorumNeeded = Math.ceil(spec.quorum * electorate.length);
  const quorumMet = cast >= quorumNeeded;
  const byCalendar = closes ? new Date() < new Date(closes) : true;
  const election = spec.method === 'irv';

  let yes = 0, no = 0, abstain = 0, winner = null, rounds = [];
  if (election) {
    ({ winner, rounds } = instantRunoff(list, null));
  } else {
    for (const b of list) {
      const w = b.weight || 1;
      if (b.choice === 'yes') yes += w; else if (b.choice === 'no') no += w; else if (b.choice === 'abstain') abstain += w;
    }
  }

  const decisive = yes + no;
  const share = decisive ? yes / decisive : 0;
  const thresholdMet = election ? !!winner : share >= (spec.threshold ?? 1);

  const closedEarly = earlyClose({
    cast, electorate: electorate.length, yes, no, quorumNeeded,
    threshold: spec.threshold ?? 1, rules: closeRules, election,
  });
  const open = byCalendar && !closedEarly;

  return {
    measure, election,
    yes, no, abstain, winner, rounds,
    cast, electorate: electorate.length,
    quorumNeeded, quorumMet,
    share, threshold: spec.threshold ?? null, thresholdMet,
    open, closedEarly, closes: closes || null,
    carried: !open && quorumMet && thresholdMet,
    counted: list, rejected, delegated,
  };
}
