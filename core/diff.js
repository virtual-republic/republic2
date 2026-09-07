// Comparing one text with another, line by line.
//
// A revision to a law should be readable as what it does — this line added,
// that one struck, this one altered — rather than as a wall of replacement
// text. So a revision carries the whole new text, and the diff is computed
// from it. The record stays simple; the reading is the part that gets richer.
//
// Plain longest-common-subsequence. The texts here are laws, not repositories:
// a few hundred lines at most, so the quadratic table is nothing.

const norm = (s) => String(s).replace(/\r\n/g, '\n').replace(/\s+$/gm, '');

export function lines(text) {
  return norm(text).split('\n');
}

function lcs(a, b) {
  const m = a.length, n = b.length;
  const table = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

// [{ kind: 'same' | 'added' | 'removed', text, before, after }]
export function diffLines(before, after) {
  const a = lines(before), b = lines(after);
  const table = lcs(a, b);
  const out = [];
  let i = 0, j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i], before: i + 1, after: j + 1 }); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) { out.push({ kind: 'removed', text: a[i], before: i + 1 }); i++; }
    else { out.push({ kind: 'added', text: b[j], after: j + 1 }); j++; }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i], before: ++i });
  while (j < b.length) out.push({ kind: 'added', text: b[j], after: ++j });

  return out;
}

// A line removed and immediately replaced reads better as one alteration than
// as a deletion followed by an insertion.
export function pairEdits(diff) {
  const out = [];
  for (let k = 0; k < diff.length; k++) {
    const removed = [];
    let i = k;
    while (i < diff.length && diff[i].kind === 'removed') removed.push(diff[i++]);
    const added = [];
    let j = i;
    while (j < diff.length && diff[j].kind === 'added') added.push(diff[j++]);

    if (removed.length && added.length) {
      const n = Math.min(removed.length, added.length);
      for (let x = 0; x < n; x++) out.push({ kind: 'altered', from: removed[x].text, text: added[x].text, before: removed[x].before, after: added[x].after });
      for (let x = n; x < removed.length; x++) out.push(removed[x]);
      for (let x = n; x < added.length; x++) out.push(added[x]);
      k = j - 1;
      continue;
    }
    if (removed.length || added.length) { out.push(...removed, ...added); k = j - 1; continue; }
    out.push(diff[k]);
  }
  return out;
}

export function summarise(diff) {
  const n = { added: 0, removed: 0, altered: 0 };
  for (const d of diff) if (d.kind !== 'same') n[d.kind]++;
  return n;
}

// Only the parts that changed, with a little of the text around them.
export function hunks(diff, context = 2) {
  const keep = new Set();
  diff.forEach((d, i) => {
    if (d.kind === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) keep.add(k);
  });
  const out = [];
  let last = -2;
  diff.forEach((d, i) => {
    if (!keep.has(i)) return;
    if (i > last + 1) out.push({ kind: 'gap' });
    out.push(d);
    last = i;
  });
  return out;
}

// Which § and ¶ a line sits in, so a change can be described where it happened
// rather than by line number — art-02/§4/¶1.
export function locate(text) {
  const MARKS = '¹²³⁴⁵⁶⁷⁸⁹';
  const out = [];
  let section = null, paragraph = 0;
  for (const line of lines(text)) {
    const h = line.match(/^##\s+§\s*(\d+)/);
    if (h) { section = Number(h[1]); paragraph = 0; out.push({ section, paragraph: null }); continue; }
    const p = line.match(new RegExp(`^([${MARKS}])\\s`));
    if (p) { paragraph = MARKS.indexOf(p[1]) + 1; out.push({ section, paragraph }); continue; }
    out.push({ section, paragraph: paragraph || null });
  }
  return out;
}
