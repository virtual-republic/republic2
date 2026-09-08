# Operating the Republic

Every feature, twice: how to do it on the website, and how to do it from the
terminal. The two are equivalent — the site signs in your browser and hands the
result to GitHub; the terminal signs on your machine and you commit it yourself.

---

## Before anything

**Your key is your citizenship.** Article 2 § 6 ³ — each citizenship holds a key
no other holds. Lose it and you have lost standing, not just access.

Save `private/c-0001.pem` somewhere that is not the same disk. Register a second
key as Article 3 § 3 ³ recommends. `private/` is gitignored and never leaves
your machine.

**The rhythm.** Sign locally or in the browser, commit the *act*, and let the
workflows settle it. Do not settle locally as well — two writers appending to an
append-only ledger is what causes the damage `doctor` exists to repair.

```
you sign  →  you commit  →  settle records it  →  publish rebuilds the site
```

Always `git pull` before you start. The Republic commits on its own now.

---

## Citizenship

### Join

**Site.** Open **Your key** (top right). *Create a citizenship* makes a keypair
in your browser and downloads it. The page then offers an *Apply for
citizenship* button, which opens GitHub prefilled with your register entry.
Commit it and you are a citizen — Article 3 § 2 ³ makes admission take effect on
recording. Nobody has to approve it.

**Terminal.**
```bash
republic key new c-0002
republic join private/c-0002.pem c-0002
git add register/ ledger/ && git commit -m "admit c-0002" && git push
```

### Load a key you already have

**Site.** **Your key** → *Load a key* → choose the file, or paste it.

**Terminal.** `republic key find` searches Downloads, Desktop, your home
directory and the repository for anything containing a private key, and says
which citizenship each belongs to. `republic key import` installs the one it
finds. Filenames do not matter; it identifies keys by content.

### Delegate your vote

**Site.** **Register** → *Your citizenship* → enter who it goes to → *Prepare*.
Blank revokes it.

Article 8 § 3 ⁴ — the delegation is used only where you have not voted yourself,
is exercised openly, and is recorded as delegated. You may revoke it before the
close.

### Depart

**Site.** **Register** → *Your citizenship* → *Depart the Republic*.

**Terminal.** `republic depart c-0002`

Article 3 § 4 — you may leave at any time and return by the procedure for
admission. Departure alters no record already made, so you are marked departed
rather than deleted. A departed citizenship counts toward no quorum, casts no
ballot and holds no office.

---

## The Assembly

### Lay a measure

**Site.** **Assembly** → *Lay a measure*. Title, class, and the provisions it is
made under, one per line. Each must resolve or it is not received — Article 8
§ 1 ³. Two optional fields matter:

* **authorises** — a pull request or commit (`#12`). The measure then enacts
  that change and no other (Article 8 § 1 ⁵).
* **amends** — the slug of a statute this replaces, producing a new version of
  it rather than a second statute.

**Terminal.**
```bash
republic propose --title "Statute on Meetings" --by c-0001 \
  --class policy --cites art-01/§4/¶2 \
  --text '## § 1  Calling

¹ The Assembly meets when a citizen calls it.
'
```

Classes and what they need are in `republic.yml`: policy and ordinary (20%
quorum, simple majority), organic (33%, two thirds), amendment (50%, two thirds,
twice), entrenched (60%, three quarters, twice), election (instant runoff).

### Vote

**Site.** Open the measure from **Assembly**. Choose yes, no or abstain — or for
an election, click candidates in order of preference. *Sign ballot*, then *Open
on GitHub* and commit.

**Terminal.**
```bash
republic vote P-0001 yes --by c-0001
republic vote P-0003 c-0002,c-0001 --by c-0001     # an election: ranked
git add ballots/ && git commit -m "vote on P-0001" && git push
```

One ballot per citizenship. Voting again replaces the earlier one; an earlier
one never replaces a later — Article 8 § 3 ³.

### What happens next

Nothing you need to do. Committing a ballot fires the **close** workflow, which
counts and, if the measure is decided, enacts it: publishes the Journal issue,
writes the statute, installs an election's winner.

Article 8 § 3 ⁵ closes voting at the earlier of the end of the period or the
moment the outcome can no longer change — when everyone has voted, or when the
remaining ballots could not alter it either way. Small republics therefore decide
in minutes rather than waiting out a week.

To do it yourself: `republic close`, or `republic count P-0001` to see where a
measure stands without closing it.

### Revise a law

**Site.** Open the statute under **Journal → Law** and press *Propose a
revision*. You get an editor holding the text in force, and:

* **new §** inserts the next section, numbered for you.
* **new ¶** inserts the next paragraph mark in the section your cursor is in.
  Marks are renumbered when you preview, so pasting and reordering cannot leave
  gaps — every paragraph stays separately addressable under Article 2 § 4 ¹.
* **insert a citation** opens the picker described below.
* **see the changes** shows the diff before you propose it.

*Prepare the measure* produces a revision — a measure like any other, which goes
to a vote. Until it carries, the text in force is unchanged.

Its page renders the change **line by line**, each located by § and ¶: struck
lines in red with a rule through them, new lines in green, an alteration shown
as both. Unchanged text is elided.

**Terminal.**
```bash
republic propose --title "Statute on Meetings" --by c-0001 --class policy \
  --revises statute-on-meetings --cites art-01/§4/¶2 --text "$(cat revised.md)"
```

### Citing something

Type a citation and it links itself. `const.art-05/§2/¶4`, `stat.obol-issuance/§1/¶2`,
`stat.one`, `deed.river-mill` — all resolve, in a measure, a case, a charter or
a Journal issue.

If you would rather not remember whether the Assembly is Article 6 § 2 or § 3,
use **insert a citation**: choose the body of law, then the text, then the § and
the ¶. It reads the same index that resolves citations, so anything it offers is
guaranteed to resolve. A whole statute, a section, or a single paragraph.

> Notwithstanding stat.obol-issuance/§1/¶2, stat.updates-new/§5, stat.one, and
> const.art-05/§2/¶4, …

### Reading the law

**Journal** holds four things, matching the directories on disk: the
**Constitution**, the **Law** in force, the **Court**, and the **Issues**.

Every provision is separately addressable. Click the § or the paragraph mark on
any provision to copy its citation — `const.art-08/§3/¶5`, `stat.some-statute/§2`.
Those resolve everywhere: in a measure, in a case, in a record.

---

## Office

**Site.** **Office** shows every office, who holds it, until when, under what,
and what each may do. Load your key and it tells you what *your* key may do.

*Stand for office* prepares an election. Commit it and it goes to the Assembly.

**Terminal.**
```bash
republic office                                    # who holds what
republic office install --all                      # give effect to a carried election
republic office appoint --office judge --holder c-0001
republic office vacant --fill c-0001               # fill offices held by nobody
```

Article 6 § 3 ⁵ — an office recorded to a citizenship that is not active is
vacant in fact. `republic office` flags those and tells you the command.

Article 6 § 4 ¹ — every office holds an enumerated set of powers and no others.
The Registrar admits and registers; the Keeper publishes, signs checkpoints and
approves changes to the code; the Treasurer issues and disburses; the Auditor
reports; the Judge halts, voids and gives judgment. The Court has no Treasury
power at all — Article 7 § 3 ⁴.

---

## Entities

### Form one

**Site.** **Register** → *Form an entity*. Name, type, and — if the type
requires it — the measure that established it.

**Terminal.**
```bash
republic entity form --name "Schoonover Holdings" --type company \
  --by c-0001 --organ director=c-0001
```

| Type | Formed |
|---|---|
| association, company, foundation | by any citizen as of right — Article 4 § 1 ¹ |
| commune, organ of the Republic | only on a carried measure, entered by the Registrar — Article 4 § 1 ² |

Only a **company** may issue instruments (Article 4 § 2 ³).

### Its charter

Every entity must have one — Article 4 § 3 ¹. An entity formed on the site
starts without one, because one commit creates one file.

```bash
republic entity charter --entity e-0001 --by c-0001    # writes a default
# edit charters/e-0001.md, then:
republic entity charter --entity e-0001 --by c-0001    # signs the amendment
```

The entity's own page shows the charter and offers to create one if missing.

### What its charter allows

```bash
republic entity powers --entity e-0001
```

The charter is **operative**, not decoration. Its front matter is read by the
tools: who votes, how their votes are weighed, what carries, how long an officer
serves, and whether the entity's instruments may be traded at all.

A charter may **narrow** what its type allows and never widen it — Article 4
§ 3 ³. A company may decide not to list; an association cannot grant itself the
power to issue shares.

| | Association, commune, organ | Company | Foundation |
|---|---|---|---|
| Decides by | members, one vote each | shares, by holding | members |
| May issue instruments | no | yes | no |
| Listed | — | **not by default** | — |

**Coequal membership.** In an association every member has one vote however much
they hold. Joining makes you the equal of everyone already there. That is what
`vote: members` means, and it is the default for every type but a company.

**A private company.** A company is **private unless its charter lists it**. Its
shares exist, are recorded, and transfer directly between accounts — but no
order for them is accepted on the exchange. An attempt is refused by name:

> e-0001 is not listed — its charter does not permit its instruments to be
> traded. They may still be transferred directly.

To list it, the holders amend the charter by resolution.

### Resolutions

An entity decides by its own charter, not the Republic's rules.

```bash
republic entity resolve --entity e-0001 --title "Meet on Thursdays" --by c-0002
republic entity vote --entity e-0001 --resolution R-0001 yes --by c-0002
republic entity resolutions --entity e-0001
```

Three kinds:

**policy** — a decision of the entity. Yes, no or abstain.

**officer** — fills an organ. `--kind officer --organ director`. Whoever wins
takes the organ, and thereby the authority the charter confers on it — Article 4
§ 3 ². Vote by naming a candidate rather than yes or no.

**charter** — replaces the charter itself. Pass the whole new text. This is how
a company lists itself, or an association changes its threshold.

Quorum and threshold come from the charter. A resolution closes early when
everyone entitled has voted. Somebody who is neither a member nor a holder is
refused by name.

**On the site**, all of this is on the entity's own page: *Who decides* lists
every voter and their weight, *Resolutions* shows what has been decided, and the
management console proposes and votes.

### Manage it

**Site.** The entity's page under **Register** has a *Manage* section, visible
only when your key is an organ of it. Issue shares, transfer, trade, admit and
remove members, set organs, amend the charter, dissolve.

**Terminal.**
```bash
republic entity members --entity e-0001 --admit c-0002 --by c-0001
republic entity organs  --entity e-0001 --set director=c-0001,secretary=c-0002 --by c-0001
republic entity dissolve --entity e-0001 --by c-0001
```

Article 4 § 3 ⁴ — an entity acts only through an organ of it. A non-organ is
refused by name, both in the browser and at settlement.

---

## Value

### Issue the unit

Article 10 § 2 ¹ — only the Treasurer, only under a resolution that has carried,
and only in the amount it states. So it is two steps.

First carry a resolution:
```bash
republic propose --title "First Issue" --by c-0001 --class ordinary \
  --cites art-10/§2/¶1 --text '## § 1

¹ The Treasurer is authorised to issue 50000 obols.
'
republic vote P-0001 yes --by c-0001
git add -A && git commit -m "the first issue" && git push
```

Then issue under it:

**Site.** **Value** → an *Issue* section appears if your key holds `value.issue`.
Pick the resolution from the list of measures that actually carried.

**Terminal.** `republic issue --unit 50000 --under P-0001 --by c-0001`

### Transfer

**Site.** **Value** → *Transfer*. The *From* list holds only accounts your key
may act for.

**Terminal.**
```bash
republic pay --from treasury --to c-0001 --amount 10000 --by c-0001
republic pay --from c-0001 --to c-0002 --instrument e-0001:ordinary --quantity 50 --by c-0001
```

Article 2 § 5 ³ — no account is debited except by its holder. You act for an
entity through an organ of it, and for the Treasury by holding
`treasury.disburse`.

**Value shows only your own accounts.** The ledger is public; what you hold is
not printed on a page anyone may open. `republic value` shows everything
locally; `republic value c-0001` shows one account and every record that touched
it.

---

## Shares and the exchange

### Issue shares

Issuing *is* listing. There is no separate step.

**Site.** Either the entity's page, or **Exchange** → *Issue a share*, which
appears for any company you are an organ of.

**Terminal.**
```bash
republic issue --instrument e-0001 --quantity 1000 --class ordinary --by c-0001 --to e-0001
```

`--to e-0001` keeps them in the company to sell. `--to c-0001` puts them in your
hands.

### Trade

**Site.** **Exchange** → *Place an order*. Side, instrument, account, quantity,
price.

**Terminal.**
```bash
republic order --side sell --instrument e-0001:ordinary --quantity 200 --price 20 --by c-0001 --account e-0001
republic order --side buy  --instrument e-0001:ordinary --quantity 150 --price 25 --by c-0002
```

**Exchange** is in the header.

### How the market behaves

**Price, then time. There are no market orders — every price is a limit.**

* An order that crosses nothing **rests** on the book until something does.
* Best price first; among equal prices, whoever arrived first.
* A trade happens at the **resting order's** price. The one who waited set the
  terms; the one who crossed the spread accepted them.
* **An order matched in part is cancelled for the remainder.** Nothing is left
  half-alive, and an order means what it says or nothing.
* An order is never matched against another order of the same account.

To behave like a market order, name a price far past where you expect to trade.
You pay the resting price, not yours: a buy at 1000 against a resting ask at 20
fills at 20.

The site publishes the book, the best bid and ask, the spread, and **what the
next settlement would do** — computed with the same code that will run it
(Article 10 § 5 ⁴). Cancellations are published too.

**Worked example.** Asks resting: `10 @ 19.9` from c-0001, then `200 @ 20` from
e-0001.

*Bid 10 @ 19.95* → trades **10 at 19.9**, the resting ask's price. You offered
19.95 and pay 19.9.

*Bid 15 @ 20.05* → trades **10 at 19.9** against the best ask — and then stops.
The remaining 5 is **cancelled**, not carried up to the 200 @ 20. A partial fill
ends the order.

That last case is the one to hold in mind: sizing an order larger than the best
resting order means the excess dies rather than walking the book.

---

## Contracts

**Site.** **Contracts** → *Draft a contract*: title, parties, terms. Commit it.
Each party then opens its page and signs.

**Terminal.**
```bash
republic contract draft --title "Supply of Records" --parties c-0001,c-0002 --by c-0001
# edit contracts/supply-of-records.md
republic contract sign --id supply-of-records --by c-0001
republic contract list
```

Article 9 § 7 — it takes effect when **every** party has signed, and not before.
A signature covers the SHA-256 of the text as it then stood, so altering it
afterwards voids every signature given. That is enforced at settlement, not
merely stated.

---

## Deeds

A deed is **recognised title** — to property, a claim, a right, a licence, a
membership. It is valid only when the Keeper of the Journal has recognised it
**and** it is published in the Journal. Recognition and publication are one act,
so neither happens without the other.

### Ask for one

**Site.** **Journal** → **Deeds** → *Ask for a deed*. Say what is claimed, its
kind, who is to hold it, and whether it may be passed on.

**Terminal.**
```bash
republic deed request --id river-mill --title "The mill at the river" \
  --by c-0002 --kind property --transferable
```

A request confers **nothing**. It is not a deed and does not appear among them;
it sits under *Requested* until the Keeper decides.

### Recognise or refuse

Only the holder of `deed.recognise` — the Keeper — and nobody else. Anyone else
signing a recognition is refused by name at settlement.

**Site.** The same page shows a *Recognise or refuse* console, but only when the
loaded key is the Keeper's.

**Terminal.**
```bash
republic deed recognise --id river-mill --by c-0001
republic deed refuse --id the-moon --by c-0001 --reasons "The Republic holds no territory."
```

The Keeper may also recognise title **directly**, with no request behind it:

```bash
republic deed recognise --id seat-of-office --title "A seat that cannot be sold" \
  --holder c-0002 --by c-0001
```

Recognition writes the deed **and** its Journal issue in the same act. The deed
records which issue published it, and that issue is what makes it valid.

### Transfer

```bash
republic deed transfer --id river-mill --to c-0001 --by c-0002
```

Only if the deed says it is transferable, and only by whoever currently holds
it. A non-transferable deed offers no transfer control at all — the page says
so instead. Every previous holder stays recorded on the deed.

### Where they live

`journal/deeds/` holds the recognised ones; `journal/deeds/requested/` holds
requests and refusals. Each is citable as `deed.<id>`, resolving like any other
citation.

The gate exempts `journal/deeds/` from requiring a measure — recognition is the
Keeper's act under Article 5 § 2, not the Assembly's. What constrains the Keeper
is that every recognition is a published, signed, permanent record naming them.

---

## The Court

**Site.** **Journal** → **Court** → *Bring a case*. Name the act complained of,
what you seek, the provisions to be construed, and the ground.

**Terminal.**
```bash
republic court file --against P-0004 --by c-0001 \
  --seeking construe --ground "The measure cites no provision authorising a rate." \
  --construes art-08/§1/¶3
republic court judge --case 1 --by c-0001 --holding dismissed --reasons "..."
republic court list
```

What may be sought: **construe** a provision, **halt** an act within its window,
**void** it, or a **remedy** under Article 9.

Citations must resolve — Article 7 § 4 ². Where no Judge is elected, the
Assembly exercises the Court's functions — Article 7 § 1 ². Every judgment is
published with reasons.

---

## Integrity

```bash
republic verify     # the chain, the checkpoints, an inclusion proof
republic doctor     # what is wrong
republic doctor --repair
republic checkpoint # sign one (the Keeper)
```

`verify` talks to nothing and needs no account. Anyone who runs it is a monitor
within Article 5 § 4 ².

**If the register breaks.** It happens when two writers append at once — you
settling locally while the workflow settles the same acts. `doctor` reports it;
`--repair` keeps every record's content byte for byte, recomputes only the
sequence and the links, drops duplicates by content, and saves the old file
beside it. Then reissue a checkpoint and say in the commit message what you
repaired.

The one thing it will not do is guess. Conflict markers in the ledger it
resolves by keeping both sides, because an append-only log means both are real.
Anything it cannot read, it refuses to touch.

---

## Changing the code

**Nobody pushes to `main` — not you, not an administrator, not the workflows.**
Everything arrives as a pull request the gate has judged.

```bash
republic gate --base origin/main    # what does this change require?
```

`core/rules.js` maps every path to a class:

| What you touched | What it needs |
|---|---|
| the Constitution | an amendment |
| Articles 2, 9, 12 | an entrenched measure |
| statute | a policy measure |
| `core/`, `cli/`, `site/js/`, workflows, `republic.yml` | an organic measure |
| `register/offices.yml` | an ordinary measure |
| ballots, ledger, journal issues, judgments, entities, acts, `site/style.css` | nothing |

Records need nothing because requiring a vote to record a vote would deadlock
the Republic on its first measure. **That is also the whole exemption the
workflows get** — `close` and `settle` open pull requests like anyone else, and
the gate lets theirs through because records are exempt *by path*, not because a
workflow is privileged. A workflow that tried to change the Constitution would
be refused exactly as a person would.

So to change the code:

1. Carry an organic measure. Give it `authorises: "#12"` naming the pull request.
2. Open that pull request.
3. The **enact** check confirms the class, that the measure carried, that it
   named this change, and that the Keeper has approved it.

   It does not read the recorded result. It **counts the signed ballots itself**
   — Article 8 § 4 ⁵, the tally is performed by the published tool and the
   tool's result is the result. `ballots/` has to be exempt from the gate,
   because recording a vote cannot itself require a vote; so a pull request
   could otherwise carry both a change to the law and a result file claiming it
   carried. Counting closes that: a ballot not verified against a registered key
   is not counted, and forging one means forging a signature.
4. Merge.

The **audit** workflow judges every push to `main` afterwards and raises an issue
if anything landed ungated — prevention where it is possible, detection where it
is not.

---

## When something goes wrong

**The site shows old content.** `publish` failed or was never triggered. Actions
→ publish → Run workflow. Then hard-reload; Pages caches hard.

**A workflow is red.** Open it and read the last red step. `verify` failing means
the register is damaged — run `doctor`. Anything else is usually a setting.

**An act was refused.** Look in `refused/`. The reason is recorded inside the
file. Acts are set aside rather than retried, so fix what it names and sign a
fresh one.

**`git push` rejected.** The workflows have committed since you last pulled.
`git pull --rebase`, and if the ledger conflicts, `republic doctor --repair`.

Set these once:
```bash
git config pull.rebase true
git config rebase.autoStash true
```

**You have lost your key.** There is no recovery path. Article 3 § 3 ⁴ leaves
restoration to the Registrar on such proof as statute requires — and you have no
such statute until you pass one. Consider passing one before you need it.

---

## Leaving

`git clone` is the exit. Article 9 § 9 guarantees it, Article 11 provides for
division, and Article 12 § 2 ³ forbids amending either so as to impede them.

A disagreement that cannot be resolved inside the Republic is meant to end in a
fork, and the Constitution says in advance how that works: both Republics
succeed to the shared history, neither is the continuation of the other, and
neither may call the other illegitimate in its own Journal.
