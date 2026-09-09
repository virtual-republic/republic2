// Deeds, folded from the ledger.
//
// art-05/§1/¶2 — the repository is authoritative. The RECORD is authoritative
// within it, and the files under journal/deeds/ are its published form.
//
// Everything else in this system folds its state from the ledger: balances,
// holdings, membership, offices. Deeds did not, and read files instead — so a
// request could be recorded and still be invisible if the file went astray.
// This fixes that. The ledger decides; the files are read only for the text.

import fs from 'node:fs';
import path from 'node:path';
import { at } from './config.js';
import { records } from './ledger.js';
import { frontmatter } from './corpus.js';
import { offices } from './registry.js';

const textOf = (root, id, sub = null) => {
  const f = path.join(at(root, 'deeds'), ...(sub ? [sub] : []), `${id}.md`);
  if (!fs.existsSync(f)) return null;
  const [meta, body] = frontmatter(fs.readFileSync(f, 'utf8'));
  return { ...meta, body: body.trim() };
};

// The state of every deed the Republic has ever heard of, in order of what
// happened to it.
export function deedState(root) {
  const byId = new Map();

  for (const e of records(root)) {
    const p = e.payload || {};
    const id = p.deed;
    if (!id) continue;

    switch (e.kind) {
      case 'deed.requested':
        byId.set(id, {
          id, status: 'requested',
          title: p.title, holder: p.holder, transferable: !!p.transferable,
          requested_by: e.author, requested: e.at.slice(0, 10),
        });
        break;
      case 'deed.recognised': {
        const was = byId.get(id) || { id };
        byId.set(id, {
          ...was, status: 'valid',
          title: p.title || was.title, holder: p.holder,
          transferable: !!p.transferable, journal: p.journal,
          recognised_by: e.author, recognised: e.at.slice(0, 10),
        });
        break;
      }
      case 'deed.refused': {
        const was = byId.get(id) || { id };
        byId.set(id, { ...was, status: 'refused', reasons: p.reasons, refused: e.at.slice(0, 10) });
        break;
      }
      case 'deed.transferred': {
        const was = byId.get(id) || { id, status: 'valid' };
        byId.set(id, { ...was, holder: p.to, previously: [...(was.previously || []), p.from] });
        break;
      }
    }
  }

  // The published text, where there is one. The record governs the status; the
  // file only supplies the words.
  const out = [...byId.values()].map((d) => {
    const t = d.status === 'valid' ? textOf(root, d.id) : textOf(root, d.id, 'requested');
    return { ...d, body: t?.body || '', kind: t?.kind || d.kind || 'property' };
  });

  out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    all: out,
    valid: out.filter((d) => d.status === 'valid'),
    requested: out.filter((d) => d.status === 'requested'),
    refused: out.filter((d) => d.status === 'refused'),
  };
}

// Who may recognise one, and whether anybody can.
export function recogniser(root) {
  const o = offices(root).find((x) => (x.powers || []).includes('deed.recognise'));
  return o ? { id: o.id, title: o.title, holder: o.holder } : null;
}
