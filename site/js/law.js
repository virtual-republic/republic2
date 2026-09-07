import { $$ } from './common.js';

// Click a column to sort; click again to reverse.
let last = null, dir = 1;
for (const b of $$('[data-sort]')) b.onclick = () => {
  const k = b.dataset.sort;
  dir = k === last ? -dir : 1;
  last = k;
  const body = document.querySelector('#laws tbody');
  [...body.rows]
    .sort((a, x) => (a.dataset[k] || '').localeCompare(x.dataset[k] || '') * dir)
    .forEach((r) => body.appendChild(r));
  for (const o of $$('[data-sort]')) o.classList.toggle('on', o === b);
};
