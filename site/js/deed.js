import { DATA, $, say, problem, ready, onIdentity, who, key } from './common.js';
import { offer } from './acts.js';
await ready;

const b = document.querySelector('[data-act="transfer"]');
if (b) {
  onIdentity(() => {
    const mine = who() === DATA.holder;
    b.disabled = !(key() && mine && DATA.transferable);
    if (who() && !mine) say(`${DATA.holder} holds this deed, not you.`, true);
    else if (mine) say('');
  });

  b.onclick = async () => {
    try {
      if (who() !== DATA.holder) throw new Error(`${DATA.holder} holds this deed`);
      await offer({ kind: 'deed.transfer', deed: DATA.deed, to: $('#to').value }, `transfer deed.${DATA.deed}`);
    } catch (e) { problem('could not sign', e); }
  };
}
