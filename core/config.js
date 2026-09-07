// The one place settings come from. Everything else reads this.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

let cache = null;
let cachedRoot = null;

export function config(root = process.cwd()) {
  if (cache && cachedRoot === root) return cache;
  const file = path.join(root, 'republic.yml');
  if (!fs.existsSync(file)) throw new Error('republic.yml is missing — this is not a Republic');
  cache = yaml.load(fs.readFileSync(file, 'utf8'));
  cachedRoot = root;
  return cache;
}

// Resolve a configured path. Nothing hardcodes a directory name.
export function at(root, key, ...rest) {
  const p = config(root).paths[key];
  if (!p) throw new Error(`no path configured for "${key}"`);
  return path.join(root, p, ...rest);
}

export const classOf = (root, name) => {
  const c = config(root).classes[name];
  if (!c) throw new Error(`unknown class "${name}" — expected one of ${Object.keys(config(root).classes).join(', ')}`);
  return c;
};

export const reload = () => { cache = null; cachedRoot = null; };
