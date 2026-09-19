# ShootScript — one plain-text file, one crew's paperwork

Content Production (Division 4). Jason hosts and edits, Cari runs camera. One source file
produces her shooting copy and the editor's copy, so the two can never drift apart and the
editor's notes can never end up on her paper.

## Write the source in Fountain

[Fountain](https://fountain.io) is the open plain-text screenplay standard. Nothing about it is
ours. Write it in any editor and save it as `NAME.fountain`.

```fountain
Title: EP6 · THE TELFORD HISTORY TALK
Shoot: SHOOT SCRIPT · 10 setups, shot in this order · Jason to lens
Episode: EP6
Shoot-Type: A
Shoot-Date: 2026-09-19
Interviewer: Cari

EXT. DRY SLOPE, IN THE SUN — DAY

Jason walks the slope. He finds a rock and turns it over in his hands.

!ON CAMERA: the hand picking the rock up off the ground.

JASON
(first words, exactly)
Same rock. Different hand. Scottish Borders, seventeen fifty-seven.
(then, in his own words)
Who Thomas Telford was, and why I went looking for him.

= Cari and Jason up on the pad in the rain, working out whether the tarp went over the sand.

INTERVIEWER
You told me the sand had to stay dry. Where were you coming from on that?

[[Editor: this is the weld to the Jul 31 tape, clip 0067_D. Notes never print on her copy.]]

/* Boneyard. Deleted outright, never printed anywhere. */
```

| you write | you get |
|---|---|
| `INT.` / `EXT.` line | a setup, numbered in shooting order with a tick box |
| a plain line | action |
| `CAPS NAME` on its own line | a character cue; the lines under it are dialogue |
| `(something)` under the name | a parenthetical |
| `= words` | a plain synopsis of earlier footage — **this prints**, as `EARLIER, ON TAPE:` |
| `[[words]]` | a note: editor's copy only, stripped from Cari's copy |
| `/* words */` | boneyard: gone from everything |
| `.FORCED HEADING` / `!forced action` / `@FORCED NAME` | force the type when the guess would be wrong |

**An all-caps action line must start with `!`**, or Fountain reads it as a character cue.

## The two house conventions

1. **`!ON CAMERA:`** — an action line beginning `ON CAMERA:` is the load-bearing direction. It
   prints in a box: the one thing the setup fails without. Every setup should have one.
2. **`(exactly)` / `(in his own words)`** — a parenthetical containing *exactly* means the line
   under it is said word for word. One containing *in his own words* means the line under it is a
   **briefing**: he absorbs it and restates it in the moment. That is the absorb-and-restate law —
   only fully-his words go on camera.

Interview questions are dialogue by a character called `INTERVIEWER`. They do not have to look
like screenplay; they print as numbered question cards in large type.

## The two voice rules (Cari + Jason, Sep 19 2026)

1. **His lines are written in the first person** — written lines and briefings both, because she
   is handing him words he will say. *"I can't afford the crusher. The rock and the hands, I
   already have."* Never *"the crusher is what he cannot afford."* Action stays third person
   present, the way screenplays are written: *"Jason kneels and sets the rock down."* If a "he" in
   his mouth is somebody else — Telford, McAdam — name that person in the same setup, or the lint
   cannot tell and errors.
2. **Questions are written the way Cari asks them** — second person, to Jason, with a question
   mark. *"You told me X while we were working on the pad. Where were you coming from?"* Not a
   topic: *"his thoughts on the tarp"* is an error.

## The command

```
python C:\Users\18054\kre8r\scripts\shoot-script\shootscript.py <file.fountain> [--out DIR]
```

Options: `--layout classic|gutter|large`, `--index` (trailing tick-off list of every setup),
`--corner TEXT` (page-corner label), `--no-pdf`, `--lint-only`.

## What comes out, in `<out>/<SLUG>/`

| file | what it is |
|---|---|
| `SHOOT-SCRIPT-CARI.pdf` | her copy. Courier 12, numbered setups with tick boxes, notes stripped, at most two lines of title and **nothing** before setup 1 |
| `EDITORS-COPY.pdf` | the same script with every `[[note]]` shown inline in red |
| `lines-JASON.md` | all of one person's lines, in shooting order — one file per character who speaks |
| `QUESTION-CARD.pdf` | the INTERVIEWER's questions, big type, numbered, one per block |
| `LINT.txt` | the rules that protect her copy. **Exit code 1 if it holds one ERROR** |
| `manifest.json` | what this folder is, so the Division 4 script library in OrgΩr can take it in later |
| `*.html` | the source of each PDF, if anybody wants it on a phone |

`manifest.json` carries: title, episode, shoot type (A–D) and its label, shoot date, the source
filename with its sha256, setup count, characters, the lint result, every produced file with its
role (`cari_script`, `editor_copy`, `question_card`, `lines:<CHARACTER>`, `lint_report`), the tool
version and when it ran. Episode / Shoot-Type / Shoot-Date come off the title page.

## The lint

ERROR (nobody prints her copy until it is zero):

* anything printed before setup 1 that is not the title block
* a forward reference — `see page`, `see below`, `later in the script`, `as described in scene N`
  where N is ahead
* an editor's word outside `[[notes]]` — in/out, weld, bridge, attach, THEREFORE/BUT joint,
  serving, spine, beat ids, clip ids (`0067_D`, `C012`, `A018_090302`), timecode
* his line written about him in the third person, or with his own name in it
* an interview question not addressed to him, or not asked as a question

WARN (worth a look, does not block): two-to-eight words in quotes used as a reference with no
`= synopsis` near it · a house word that has an industry word or is not defined yet · a setup with
no `!ON CAMERA` line.

### Adding a banned word

Open `lint-rules.json`. Add an object to `banned` (ERROR) or `house_jargon` (WARN):

```json
{ "id": "my-word", "pattern": "\\bmy word\\b", "why": "one sentence Cari would understand" }
```

`pattern` is a Python regex, `case_sensitive` defaults to false, and `why` is printed straight
into the report. Make it match the paper, not the idea — `bridge` catches a real bridge on the
property too, and that is the trade.

## The rest of the folder

| script | writes |
|---|---|
| `make_conventions.py` | `H:\edit-staging\SHOOT-DOCS\HOW-TO-WRITE-A-SHOOT-SCRIPT.md` + `.pdf` (one page) |
| `make_glossary.py` | `GLOSSARY.md` + `GLOSSARY.pdf` — industry words first, house words as KEEP/RETIRE proposals |
| `make_samples.py` | `SHOOT-DOCS\SAMPLES\` — the same content in two or three layouts per shoot type, for Cari to choose |
| `make_survey.py` | `CARI-SURVEY.pdf` — two printable pages of tick boxes |
| `test_fountain.py` | the parser and lint tests. `python test_fountain.py` |
| `samples\BAD-EXAMPLE.fountain` | every rule broken on purpose. Linting it must fail |

PDFs are printed by headless Edge — no dependencies, standard library only, on purpose.
