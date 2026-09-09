// The command map. One place that says what `republic` can do.

import { init, key, join, depart, office } from './founding.js';
import { propose, vote, count_, enact, close, court } from './assembly.js';
import { entityCmd, issue, pay, order, contract, deed, foreign, settle, value, checkpoint, verifyCmd, doctor, gate, approve } from './republic-ops.js';
import { build } from './site.js';

export const commands = {
  init,
  key,
  join,
  depart,
  office,

  propose,
  vote,
  count: count_,
  enact,
  close,
  court,

  entity: entityCmd,
  issue,
  pay,
  order,
  contract,
  deed,
  foreign,
  settle,
  value,

  build,
  checkpoint,
  verify: verifyCmd,
  doctor,
  gate,
  approve,
};
