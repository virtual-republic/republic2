// Building the public site.

import { buildSite } from '../../site/build.js';

export const build = {
  group: 'Publication',
  summary: 'build the public site into dist/',
  help: `  republic build [--base /repo]

art-05/§1/¶2 — the repository is authoritative; the site is a client of it and
is not authoritative. BASE_PATH may also be set in the environment.`,
  async run({ root, arg }) {
    const base = arg('base', process.env.BASE_PATH || '');
    const { pages, citations } = await buildSite(root, { base });
    console.log(`Built ${pages} pages · ${citations} citations`);
    return 0;
  },
};
