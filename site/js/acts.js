// Signing an act in the browser, and handing it to GitHub.
//
// The same shape core/acts.js verifies. The message signed is the act minus its
// signature, canonically ordered — identical to actMessage() there.

import { canonical, rand, sign, who, offerCommit, say } from './common.js';

export async function offer(body, message) {
  const act = { ...body, by: who(), at: new Date().toISOString(), salt: rand(8) };
  act.signature = await sign(canonical(act));
  const name = `${act.at.replace(/[:.]/g, '-')}-${act.kind.replace(/\./g, '-')}.json`;
  offerCommit(`acts/${name}`, act, message);
  say('Signed. Commit it; the settle workflow applies it.');
  return act;
}

export const num = (el, what) => {
  const v = Number(el.value);
  if (!v || v <= 0) throw new Error(`give a positive ${what}`);
  return v;
};
