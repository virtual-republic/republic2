// What things are called, and which parts are in use.
//
// The Constitution says "citizen" and "Assembly" because those are the words its
// provisions use, and a citation must keep resolving. But a club calls its
// people members and its meeting the Fellowship, and being made to call them
// citizens of a Republic is a good way to make a club feel absurd.
//
// So the LAW keeps its words and the INTERFACE takes yours. Nothing here changes
// a rule; it changes what is printed.

import { config } from './config.js';

const FALLBACK = {
  republic: 'Republic', citizen: 'citizen', citizens: 'citizens',
  assembly: 'Assembly', measure: 'measure', measures: 'measures',
  journal: 'Journal', register: 'register', court: 'Court',
  office: 'office', offices: 'offices', entity: 'entity', entities: 'entities',
  deed: 'deed', deeds: 'deeds',
};

export function words(root) {
  return { ...FALLBACK, ...(config(root).vocabulary || {}) };
}

// Capitalised where a sentence needs it.
export const Word = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);

// art-01/§2/¶2 — authority is exercised only where it is conferred.
export function using(root, part) {
  const u = config(root).using;
  if (!u) return true;                 // an older settings file: everything on
  return u[part] !== false;
}

export function inUse(root) {
  const u = config(root).using || {};
  return Object.fromEntries(Object.keys({
    assembly: 1, court: 1, offices: 1, entities: 1,
    value: 1, instruments: 1, exchange: 1, contracts: 1, deeds: 1,
  }).map((k) => [k, u[k] !== false]));
}

// A refusal that explains itself rather than looking like a fault.
export function refuseUnused(root, part, what) {
  if (using(root, part)) return null;
  return `${what} is not in use in this ${words(root).republic}. `
    + `The settings turn "${part}" off — art-01/§2/¶2, authority is exercised only where it is conferred. `
    + `Turn it on in republic.yml if the members decide to.`;
}
