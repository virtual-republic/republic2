// Which changes need what, and who may approve them.
//
// One table. Order matters: the first pattern that matches decides. Records —
// the outputs of procedure — come first and need nothing, because requiring a
// vote to record a vote would deadlock the Republic on its first measure.

export const RULES = [
  // Records and instruments
  { re: /^ballots\//,                    need: null, why: 'ballots are how voting happens' },
  { re: /^proposals\//,                  need: null, why: 'proposing is not enacting (art-08/§1)' },
  { re: /^ledger\//,                     need: null, why: 'the register (art-05/§1)' },
  { re: /^checkpoints\//,                need: null, why: 'checkpoints (art-02/§3)' },
  { re: /^journal\/issues\//,            need: null, why: 'publication is promulgation (art-05/§2)' },
  { re: /^journal\/judgments\//,         need: null, why: 'the Court decides; the Assembly does not vote on judgments (art-07)' },
  { re: /^journal\/deeds\//,             need: null, why: 'the Keeper recognises a deed; the Assembly does not vote on it' },
  { re: /^register\/citizens\//,         need: null, why: 'admission takes effect on recording (art-03/§3)' },
  { re: /^register\/entities\//,         need: null, why: 'formation as of right, or by measure (art-04)' },
  { re: /^(acts|settled|refused)\//,     need: null, why: 'signed instruments and their settlement' },
  { re: /^(charters|contracts)\//,       need: null, why: 'instruments of an entity or between parties' },
  { re: /^(README|SETUP|samples|test)/,  need: null, why: 'documentation and tests' },
  { re: /^private\//,                    need: null, why: 'never committed' },

  // Law
  { re: /^journal\/constitution\/.*(02|07|12)-/, need: 'entrenched', why: 'an entrenched Article (art-12/§2)' },
  { re: /^journal\/constitution\//,      need: 'amendment', why: 'the Constitution (art-12/§1)' },
  { re: /^journal\/statutes\//,          need: 'policy',    why: 'statute (art-01/§4)' },

  // Code — the tools are the procedure. Whoever can edit the tally can redefine
  // what "carried" means.
  { re: /^core\//,                       need: 'organic', why: 'the core of the Republic (art-05/§4)' },
  { re: /^cli\//,                        need: 'organic', why: 'the published tools (art-05/§4)' },
  { re: /^site\/js\//,                   need: 'organic', why: 'the browser signs ballots with this (art-08/§3)' },
  { re: /^site\/build\.js$/,             need: 'organic', why: 'what the site is built from' },
  { re: /^site\//,                       need: null,      why: 'presentation, not law' },
  { re: /^\.github\/workflows\//,        need: 'organic', why: 'procedure executing' },
  { re: /^republic\.yml$/,               need: 'organic', why: 'every setting the tools read (art-01/§4)' },
  { re: /^package\.json$/,               need: 'organic', why: 'what the tools run as' },

  // Offices
  { re: /^register\/offices\.yml$/,      need: 'ordinary', why: 'offices and their powers (art-06/§4)' },
  { re: /^register\/keepers\.txt$/,      need: 'ordinary', why: 'the Keeper\u2019s signing key' },

  // Anything else under journal/ is published record.
  { re: /^journal\//,                    need: null, why: 'published record (art-05/§2)' },
];

export const ORDER = ['policy', 'ordinary', 'organic', 'amendment', 'entrenched'];

export function classify(paths) {
  const governed = [];
  let need = null;
  for (const p of paths) {
    const rule = RULES.find((r) => r.re.test(p));
    if (!rule || !rule.need) continue;
    governed.push({ path: p, ...rule });
    if (!need || ORDER.indexOf(rule.need) > ORDER.indexOf(need)) need = rule.need;
  }
  return { need, governed };
}

// The power that approves a change to the code. art-05/§2 — the Keeper
// publishes, so the Keeper checks that what is merged is what carried.
export const APPROVAL_POWER = 'code.approve';
