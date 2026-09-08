# Laws to pass

Fourteen drafts. Most give effect to a provision the Constitution leaves to
statute and which the Republic currently lacks — until they are carried, those
provisions are inoperative. The rest are ordinary policy, there to be argued
about.

| | Gives effect to | Class |
|---|---|---|
| `01-exchange` | art-10/§5/¶2 — how orders are matched | organic |
| `02-succession` | art-03/§3/¶4 — restoring a citizen who lost every key | organic |
| `03-enactment-window` | art-08/§5/¶2 — the window in which the Court may halt | organic |
| `04-withholding` | art-05/§3/¶2 — when a record may be withheld | organic |
| `05-officers` | art-06/§4/¶3 — annual re-approval of office powers | ordinary |
| `06-deeds` | art-05/§2/¶2 — recognised title | organic |
| `07-civility` | art-09/§3/¶3 — the limits of free expression | policy |
| `08-admission` | art-03/§2/¶4 — the Registrar's power to object | organic |
| `09-removal` | art-03/§4/¶2, art-06/§3/¶3 — removal and recall | organic |
| `10-appeals` | art-07/§4/¶4 — where an appeal lies | organic |
| `11-erasure` | art-09/§8, art-09/§6/¶3 — erasure and access | organic |
| `12-treasury` | art-10/§6/¶2, art-02/§5/¶3 — appropriations and assessments | organic |
| `13-communes` | art-04/§1/¶2 — what a commune is | ordinary |
| `14-entities` | art-04/§3 — charters, organs and listing | organic |

**Start with `03-enactment-window`.** Without it the Court's power to halt an act
under Article 7 § 3 ¹ has no window to operate in, and is dead letter.

Then `12-treasury`, because until it carries nothing may leave the Treasury at
all, and `10-appeals`, because until it carries a judgment is final in fact
whatever Article 7 § 4 ⁴ says.

## Laying one

```bash
republic propose --title "Statute on the Enactment Window" --by c-0001 \
  --class organic --cites art-08/§5/¶2,art-07/§3/¶1 \
  --text "$(cat samples/laws/03-enactment-window.md)"
```

Or paste the text into **Assembly → Lay a measure**, where the citation helper
will insert the provisions for you.

## Charters

`samples/charters/` holds two worked examples:

**`company.md`** — a private company. Shares vote by holding; the director may
contract and trade but may not issue, amend, dissolve, or move more than a tenth
of the holdings without the holders; and listing is closed until the holders open
it by amending the charter.

**`commune.md`** — a commune formed under law. Every member is coequal, the
quorum is deliberately low, no member has a share in its property, and it dies
with the measure that made it.

Both have working front matter. Copy one over `charters/<your entity>.md`,
change the identifiers, and sign it:

```bash
republic entity charter --entity e-0001 --by c-0001
```
