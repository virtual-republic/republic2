// Value.
//
// Nothing here writes. Balances and holdings are folded from the register every
// time they are asked for, so there is no second copy to fall out of step with
// the ledger.
//
//   art-02/§5  value is created only by the issuing organ; a transfer neither
//              creates nor destroys it; no account is debited but by its holder
//   art-10/§5  the exchange clears by periodic auction at a uniform price

import { config } from './config.js';
import { records } from './ledger.js';
import { active, entities, entity, offices, mayExercise } from './registry.js';

export const TREASURY = 'treasury';

export function state(root) {
  const balances = new Map();
  const holdings = new Map();
  const instruments = new Map();
  let issued = 0;

  const move = (who, d) => balances.set(who, (balances.get(who) || 0) + d);
  const shares = (who, inst, d) => {
    if (!holdings.has(who)) holdings.set(who, new Map());
    const h = holdings.get(who);
    h.set(inst, (h.get(inst) || 0) + d);
  };

  for (const e of records(root)) {
    const p = e.payload || {};
    switch (e.kind) {
      case 'value.issued': issued += p.amount; move(p.to, p.amount); break;
      case 'value.transferred': move(p.from, -p.amount); move(p.to, p.amount); break;
      case 'instrument.issued':
        instruments.set(p.instrument, { issuer: p.issuer, class: p.class, issued: (instruments.get(p.instrument)?.issued || 0) + p.quantity });
        shares(p.to, p.instrument, p.quantity); break;
      case 'instrument.transferred': shares(p.from, p.instrument, -p.quantity); shares(p.to, p.instrument, p.quantity); break;
      case 'order.matched':
        shares(p.seller, p.instrument, -p.quantity); shares(p.buyer, p.instrument, p.quantity);
        move(p.buyer, -p.quantity * p.price); move(p.seller, p.quantity * p.price); break;
    }
  }
  return { balances, holdings, instruments, issued };
}

export const balanceOf = (root, id) => state(root).balances.get(id) || 0;
export const heldBy = (root, id) => [...(state(root).holdings.get(id) || new Map())].filter(([, q]) => q > 0);

// art-10/§3/¶1 — a citizen, and an entity whose type allows it.
export function accounts(root) {
  const cfg = config(root);
  const out = new Map();
  for (const c of active(root)) out.set(c.id, { kind: 'citizen' });
  for (const e of entities(root)) {
    if (e.status !== 'active') continue;
    if (cfg.entities[e.type]?.account) out.set(e.id, { kind: 'entity', type: e.type, organs: e.organs || [] });
  }
  out.set(TREASURY, { kind: 'treasury' });
  return out;
}

// art-02/§5/¶3 and art-04/§3/¶4 — a citizen acts for an entity only through an
// organ of it, and for the Treasury only by holding the power to disburse.
export function mayActFor(root, citizenId, account) {
  if (citizenId === account) return true;
  if (account === TREASURY) return mayExercise(root, citizenId, 'treasury.disburse');
  const e = entity(root, account);
  return !!e && (e.organs || []).some((o) => (o.held_by || []).includes(citizenId));
}

// art-10/§5/¶2 — the price that trades the most, and everyone trades at it.
export function clearingPrice(orders) {
  const bids = orders.filter((o) => o.side === 'buy').sort((a, b) => b.price - a.price);
  const asks = orders.filter((o) => o.side === 'sell').sort((a, b) => a.price - b.price);
  if (!bids.length || !asks.length) return null;

  let best = null;
  for (const p of [...new Set(orders.map((o) => o.price))].sort((a, b) => a - b)) {
    const demand = bids.filter((o) => o.price >= p).reduce((s, o) => s + o.quantity, 0);
    const supply = asks.filter((o) => o.price <= p).reduce((s, o) => s + o.quantity, 0);
    const volume = Math.min(demand, supply);
    if (!best || volume > best.volume) best = { price: p, volume };
  }
  return best && best.volume ? best : null;
}

export function matchAuction(orders) {
  const cleared = clearingPrice(orders);
  if (!cleared) return { cleared: null, fills: [] };

  const buyers = orders.filter((o) => o.side === 'buy' && o.price >= cleared.price).sort((a, b) => b.price - a.price);
  const sellers = orders.filter((o) => o.side === 'sell' && o.price <= cleared.price).sort((a, b) => a.price - b.price);

  const fills = [];
  const taken = new Map();
  const left = (o) => o.quantity - (taken.get(o) || 0);
  let remaining = cleared.volume, bi = 0, si = 0;

  while (remaining > 0 && bi < buyers.length && si < sellers.length) {
    const b = buyers[bi], s = sellers[si];
    const q = Math.min(left(b), left(s), remaining);
    if (q <= 0) break;
    fills.push({ buyer: b.account, seller: s.account, quantity: q, price: cleared.price });
    taken.set(b, (taken.get(b) || 0) + q);
    taken.set(s, (taken.get(s) || 0) + q);
    remaining -= q;
    if (!left(b)) bi++;
    if (!left(s)) si++;
  }
  return { cleared, fills };
}
