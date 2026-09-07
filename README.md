# The Republic

A working digital republic: a constitution, a register, an assembly, a court,
entities, a unit of account, an exchange, and contracts — in one git repository
that anyone can verify, fork, or leave with.

## The idea

A git repository is a hash-linked append-only log that anyone may copy in full.
That is most of what a chain gives you, minus consensus — and consensus is the
part you do not need when the whole point is that a disagreement resolves by
**forking**, not by outvoting. So:

* the **repository is authoritative**; the website is a client of it;
* every act is a **signed record** citing the provision it is made under;
* the **tools are the procedure** — changing them changes what the Republic
  does, so they are governed like law;
* verification needs **no permission and no account**: clone it and run
  `republic verify`.

Running cost: a domain name. Everything else is a static site and CI minutes.

## Start

```bash
npm install
node cli/republic.js init --id c-0001 --name "Your name"
node cli/republic.js verify
node cli/republic.js build
```

`init` makes your key, writes the register, takes the offices under Article 6
§ 3 ⁴, and publishes the first issue of the Journal. Your key lands in
`private/`, which is never committed. Save it — it *is* your citizenship.

## Doing things

```bash
republic propose --title "Statute on Meetings" --by c-0001 --cites art-01/§4/¶2
republic vote P-0001 yes --by c-0001
republic close                    # counts, and enacts what carried
republic office                   # who holds what, and what is outstanding
republic entity form --name "A Company" --type company --by c-0001
republic issue --unit 50000 --under P-0002 --by c-0001
republic pay --from treasury --to c-0001 --amount 1000 --by c-0001
republic settle                   # verifies and records every pending act
republic court file --against P-0001 --by c-0001 --ground "..."
republic verify                   # the whole register, from nothing
republic doctor                   # what is wrong, and how to repair it
republic help                     # everything
```

Anything the command line can do, the site can do too: it signs in the browser
and hands the result to GitHub's "create a file" form. No server anywhere.

## How it is put together

```
republic.yml        every setting: paths, classes, quorums, offices, types
core/               the rules, once each
  config canonical hash sshsig keys
  ledger registry corpus rules tally value acts
cli/republic.js     one entrypoint, thin wrappers over core/
site/               build.js generates HTML; js/*.js are static and copied
journal/            constitution · statutes · judgments · issues
register/           citizens · entities · offices
ledger/             the hash-chained record
acts/               signed instruments awaiting settlement
test/selftest.js    every feature, end to end
```

Three decisions do most of the work:

**One core.** Every rule lives in exactly one module. The command line and the
browser both import `core/tally.js`, so a count on a page and a count in the
register cannot disagree.

**No generated JavaScript.** The builder writes HTML and a
`<script type="application/json">` island. Page scripts are static files copied
verbatim. A page therefore cannot carry a syntax error the builder introduced.

**One settlement pipeline.** Every act — a transfer, a trade, a charter
amendment, a contract signature — is a signed file in `acts/`, verified and
applied by `core/acts.js`. Nothing else writes value into the ledger.

## Governance of the code

`core/rules.js` maps every path to the class of measure that may change it:
the Constitution needs an amendment, an entrenched Article more, the tools and
the settings an organic measure, statute a policy measure. Records need nothing,
because requiring a vote to record a vote would deadlock the Republic on its
first measure.

A measure may name the change it authorises (`authorises: "#12"`), and then
enacts that change and no other. The **enact** workflow refuses a merge without
the carried measure and the Keeper's approval; the **audit** workflow judges
every direct push to `main` afterwards and raises an issue if something landed
ungated. Prevention where it is possible, detection where it is not.

## Verifying it

```bash
git clone <this repository> && cd republic
npm install
node cli/republic.js verify
```

That checks the hash chain, every checkpoint against the register, the Keeper's
signature on each, and an inclusion proof. It talks to nothing. Anyone who runs
it is a monitor within the meaning of Article 5 § 4 ².

## Leaving

`git clone` is the exit. Article 9 § 9 and Article 11 guarantee it, and Article
12 § 2 ³ forbids amending either so as to impede it. A disagreement that cannot
be resolved inside the Republic is meant to end in a fork, and the Constitution
says in advance how that works.

## Testing

```bash
npm test        # 81 checks, end to end, in a scratch Republic
```

It founds a Republic from nothing and exercises every feature: admission and
departure, measures, statutes and amendment with versioning, elections and
office, entities and charters, value, shares, the auction, contracts, the Court,
every path in the gate, tamper detection, merge repair, and the site build.
It runs in CI on every push.

## Licence

CC0. Take it, fork it, run your own.
