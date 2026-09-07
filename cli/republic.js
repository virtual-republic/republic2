#!/usr/bin/env node
// The Republic, from the command line.
//
// One entrypoint. Each subcommand is a thin wrapper over core/ — no command
// carries a rule of its own, because a rule in two places is a rule that will
// eventually disagree with itself.
//
//   republic <command> [options]
//   republic help

import { commands } from './commands/index.js';

const [, , name, ...rest] = process.argv;
const arg = (n, d) => { const i = rest.indexOf(`--${n}`); return i === -1 ? d : rest[i + 1]; };
const flag = (n) => rest.includes(`--${n}`);
const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));

function usage() {
  console.log(`The Republic\n`);
  const groups = {};
  for (const [k, c] of Object.entries(commands)) (groups[c.group] ||= []).push([k, c.summary]);
  for (const [g, list] of Object.entries(groups)) {
    console.log(`  ${g}`);
    for (const [k, s] of list) console.log(`    ${k.padEnd(12)} ${s}`);
    console.log('');
  }
  console.log('  republic <command> --help   for the options of one command');
}

if (!name || name === 'help' || name === '--help') {
  if (positional[0] && commands[positional[0]]) {
    const c = commands[positional[0]];
    console.log(`republic ${positional[0]} — ${c.summary}\n`);
    console.log(c.help || '(no further options)');
  } else usage();
  process.exit(0);
}

const command = commands[name];
if (!command) {
  console.error(`Unknown command "${name}".\n`);
  usage();
  process.exit(2);
}

if (flag('help')) {
  console.log(`republic ${name} — ${command.summary}\n`);
  console.log(command.help || '(no further options)');
  process.exit(0);
}

try {
  const code = await command.run({ root: process.cwd(), arg, flag, positional, rest });
  process.exit(code || 0);
} catch (e) {
  if (e && e.friendly) { console.error(e.message); process.exit(2); }
  console.error(`\n${name} failed: ${e.message}\n`);
  if (flag('trace')) console.error(e.stack);
  else console.error('Run with --trace for the stack.');
  process.exit(1);
}
