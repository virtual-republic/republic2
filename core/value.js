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

// Matching, by price then time.
//
//   art-10/§5/¶2  the method is fixed by statute, and treats every order alike
//                 according to its stated terms
//   art-10/§5/¶3  no order is given precedence on any other ground
//
// Best price first; among equal prices, whoever arrived first. A trade happens
// at the RESTING order's price — the one who waited set the terms, and the one
// who crossed the spread accepted them.
//
// An order partly filled is cancelled for the remainder. Nobody is left holding
// a position they did not choose to keep, and an order means what it says or
// nothing.

const byTime = (a, b) => String(a.at).localeCompare(String(b.at));

export function matchBook(orders, { tradeAt = 'resting', cancelRemainder = true } = {}) {
  const book = orders.map((o) => ({ ...o, filled: 0 }));
  const bids = book.filter((o) => o.side === 'buy').sort((a, b) => b.price - a.price || byTime(a, b));
  const asks = book.filter((o) => o.side === 'sell').sort((a, b) => a.price - b.price || byTime(a, b));

  const fills = [];
  const left = (o) => o.quantity - o.filled;

  let bi = 0, si = 0;
  while (bi < bids.length && si < asks.length) {
    const b = bids[bi], a = asks[si];
    if (b.price < a.price) break;                       // the spread has not crossed
    if (b.account === a.account) {                      // nobody trades with themselves
      if (left(b) <= left(a)) bi++; else si++;
      continue;
    }

    // The resting order is whichever arrived first, and its price is the price.
    const resting = byTime(a, b) <= 0 ? a : b;
    const price = tradeAt === 'resting' ? resting.price : (a.price + b.price) / 2;
    const quantity = Math.min(left(b), left(a));

    fills.push({ buyer: b.account, seller: a.account, quantity, price, instrument: a.instrument, resting: resting.side });
    b.filled += quantity;
    a.filled += quantity;

    if (!left(b)) bi++;
    if (!left(a)) si++;

    // A partial fill ends the order. Both sides are then done, whatever remains.
    if (cancelRemainder) {
      if (left(b) && b.filled) bi++;
      if (left(a) && a.filled) si++;
    }
  }

  const cancelled = book.filter((o) => o.filled > 0 && left(o) > 0 && cancelRemainder)
    .map((o) => ({ ...o, remainder: left(o) }));
  const filled = book.filter((o) => o.filled > 0 && !left(o));
  const resting = book.filter((o) => o.filled === 0);

  return { fills, cancelled, filled, resting };
}

// What the book looks like, for publication before it clears — art-10/§5/¶4.
export function bookOf(orders) {
  const bids = orders.filter((o) => o.side === 'buy').sort((a, b) => b.price - a.price || byTime(a, b));
  const asks = orders.filter((o) => o.side === 'sell').sort((a, b) => a.price - b.price || byTime(a, b));
  const spread = bids.length && asks.length ? asks[0].price - bids[0].price : null;
  return { bids, asks, best: { bid: bids[0]?.price ?? null, ask: asks[0]?.price ?? null }, spread };
}
