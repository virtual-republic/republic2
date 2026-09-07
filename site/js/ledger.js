import { $, u } from './common.js';

// The register, verified in this browser. Nothing is trusted that is not checked
// here — art-05/§4/¶2.
const GENESIS = '0'.repeat(64);

function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

const el = $('[data-verify]');
try {
  const text = await (await fetch(u('/data/events.jsonl'))).text();
  const lines = text.split('\n').filter((l) => l.trim());
  let prev = GENESIS;
  const problems = [];

  for (const [i, line] of lines.entries()) {
    let e;
    try { e = JSON.parse(line); } catch { problems.push(`line ${i + 1} is not valid JSON`); break; }
    const { hash, ...body } = e;
    if (body.prev !== prev) problems.push(`record ${body.seq}: broken link`);
    else if (await sha(prev + canonical(body)) !== hash) problems.push(`record ${body.seq}: hash does not match`);
    prev = hash;
  }

  el.textContent = problems.length
    ? problems.slice(0, 3).join('; ')
    : `${lines.length} records verified in this browser — head ${prev.slice(0, 16)}…`;
  if (problems.length) el.classList.add('failed');
} catch (e) {
  el.textContent = 'could not verify: ' + e.message;
  el.classList.add('failed');
}
