import { DATA, $, say, problem, ready, onIdentity, who, key, sha256, u } from './common.js';
import { offer } from './acts.js';
await ready;

onIdentity(() => {
  $('[data-act="sign"]').disabled = !(key() && who() && DATA.parties.includes(who()));
});

$('[data-act="sign"]').onclick = async () => {
  try {
    if (!DATA.parties.includes(who())) throw new Error('you are not a party to this contract');
    const text = await (await fetch(u(`/data/contracts/${DATA.contract}.txt`))).text();
    await offer({ kind: 'contract.sign', contract: DATA.contract, party: who(), document: await sha256(text) },
      `sign ${DATA.contract}`);
  } catch (e) { problem('could not sign', e); }
};
