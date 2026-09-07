import { DATA, $, say, problem, ready, useKey, forgetKey, key, privatePem, who, offerCommit, citizens } from './common.js';
await ready;

const S = await import('./core/sshsig.js');

function show() {
  $('#shown').hidden = false;
  $('#privout').textContent = privatePem().trim();
  $('#pubout').textContent = S.publicKeyLine(key().raw, who() || '');
  say(who() ? `Signed in as ${who()}, on the register.` : 'Key loaded. Not yet on the register.');
  if (!who()) {
    const id = DATA.next;
    const yml = [
      `id: ${id}`, 'status: active',
      `admitted: ${new Date().toISOString().slice(0, 10)}`,
      'under: art-03/§2/¶3', 'keys:',
      `  - ${S.publicKeyLine(key().raw, id)}`, '',
    ].join('\n');
    offerCommit(`register/citizens/${id}.yml`, yml, `admit ${id}`);
  }
}

$('#make').onclick = async () => {
  try {
    const kp = await S.generate('');
    await useKey(kp.privateKey);
    show();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([kp.privateKey], { type: 'application/x-pem-file' }));
    a.download = 'citizenship.pem';
    a.click();
  } catch (e) { problem('could not create a key', e); }
};

$('#pick').onclick = () => { $('#loader').hidden = !$('#loader').hidden; };
$('#file').onchange = async (e) => { const f = e.target.files[0]; if (f) load(await f.text()); };
$('#go').onclick = () => load($('#paste').value);
$('#drop').onclick = () => { forgetKey(); location.reload(); };
$('#dl').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([privatePem()]));
  a.download = (who() || 'citizenship') + '.pem';
  a.click();
};
$('#copy').onclick = () => navigator.clipboard.writeText(privatePem());

async function load(text) {
  try { await useKey(text); $('#loader').hidden = true; show(); }
  catch (e) { problem('that key could not be read', e); }
}

if (key()) show();
