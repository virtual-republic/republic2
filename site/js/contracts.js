import { DATA, $, say, problem, ready, onIdentity, who, offerCommit } from './common.js';
await ready;

onIdentity(() => { $('#draft').disabled = !who(); });

$('#draft').onclick = () => {
  try {
    if (!who()) throw new Error('load a key that is on the register');
    const title = $('#ctitle').value.trim();
    if (!title) throw new Error('give it a title');
    const parties = $('#cparties').value.split(',').map((s) => s.trim()).filter(Boolean);
    if (parties.length < 2) throw new Error('a contract needs at least two parties');
    const unknown = parties.filter((p) => !DATA.accounts.includes(p));
    if (unknown.length) throw new Error('not an account: ' + unknown.join(', '));
    if (!parties.includes(who())) throw new Error('you must be one of the parties, or act for one');

    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    const today = new Date().toISOString().slice(0, 10);
    const expires = new Date(Date.now() + DATA.expiry * 86400000).toISOString().slice(0, 10);

    const md = ['---', `id: ${id}`, `title: ${title}`, `parties: [${parties.join(', ')}]`,
      `drafted_by: ${who()}`, `drafted: ${today}`, `expires: ${expires}`, '---', '',
      '## § 1  Parties', '', `¹ This contract is between ${parties.join(' and ')}.`, '',
      '## § 2  Terms', '', '¹ ' + ($('#cterms').value.trim() || 'The terms are as the parties agree and as set out below.'), '',
      '## § 3  Effect', '',
      '¹ This contract takes effect when every party has signed it — Article 9 § 7 ².', '',
      '² A signature covers the text as it then stands; an alteration afterwards voids every signature given — Article 9 § 7 ³.', ''].join('\n');

    offerCommit(`contracts/${id}.md`, md, `draft ${id}`);
    say(`Prepared. Commit it, then each party signs on its own page. Expires ${expires} if unsigned.`);
  } catch (e) { problem('could not draft', e); }
};
