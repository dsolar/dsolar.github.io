# Sunday Strategist: architecture

It's a static page on davidsolar.dev (GitHub Pages): plain JavaScript, no build step, no server, no database. The spec's suggested stack (Next.js, Postgres, Zod) doesn't fit a static site, so the same separation of concerns is kept with plain files:

| File | Job | Knows about |
|---|---|---|
| `scenarios.js` | All football content: concepts, defensive calls, scenarios, tag labels | Nothing else |
| `schema.js` | Validates content (references, ranges, provenance rules). The page refuses invalid data. | The data shape |
| `engine.js` | Pure rules: diagnosis scoring, snap resolution, grades, expected value, mastery and scheduling | Data, no DOM |
| `app.js` | Draws the field (SVG), runs the five steps, renders the review, and keeps progress in localStorage | Engine output |
| `gen.js` | Film room: builds a full scenario from one real snap (field from personnel and box count, coverage from charting, options graded by rules) | Data tables in `scenarios.js` |
| `real-plays.js` | Real snaps matched to lessons; generated, never edited by hand | Lesson ids |
| `../tools/strategist_real.py` | Builds `real-plays.js` from nflverse play-by-play, participation and FTN charting (standard library only) | Lesson `fit`s |
| `engine.test.cjs` | Unit tests: `node --test sunday-strategist/engine.test.cjs` | |
| `../tests/sunday-strategist.e2e.mjs` | A Playwright end-to-end run of a full snap, a phone layout check and reduced motion: `node tests/sunday-strategist.e2e.mjs` | |

Each file loads as a classic script in the browser (`window.SS_DATA`, `SS_SCHEMA`, `SS_ENGINE`) and as a CommonJS module in Node, so the tests use exactly the code the page runs.

## How a snap resolves (engine.resolve)

The model is explainable, not physics. Every number comes from the scenario, and every outcome carries its reason.

1. **Interactions.** A scenario's own rules for how two choices combine (max protection keeps your stick runner in; shifting the back shortens his trip to the nickel). Each one adjusts protection time, the window, or a grade, and adds a note to the review.
2. **Timing.** The protection's hold time is compared with the time the concept needs. If the rush wins, the contingency decides what happens: a built-in hot throw (only if the concept has one), a sight adjust, a throwaway, or a sack or hurried throw.
3. **Structure.** The concept's window against the defense that was actually called.
4. **Execution.** Each assignment that must hold up is rolled with its own probability. Naming the right key defender raises the quarterback's read.
5. **Variance.** Yards within a spread, interceptions on failed throws, and a small "luck" rate so that bad calls sometimes work. The review then calls it "Bad call, good result".

Rolls use a seeded generator (mulberry32), so a seed replays a rep exactly. `expected()` runs the same call 400 times. That figure is what the review reports and what ranks the alternatives, so a call's quality is separated from one outcome.

## Grades

- **Diagnosis:** the average credit across questions. Missing the critical rusher caps that item at 50. Confidence is used for calibration: a high-confidence miss is flagged as a misconception.
- **Call:** 80% the concept's grade (after interactions) and 20% the key-defender read.
- **Protection** and **Answer:** authored grades, adjusted by interactions.
- **Execution:** the share of must-hold-up assignments that held.
- **Result:** what happened, relative to the down and distance.

The process score is the average of the first four.

## Learning loop

`record()` stores the process score per skill tag and per scenario, plus a count per error type (the taxonomy in `engine.ERRORS`). `next()` serves unseen scenarios first, then the one whose skills are weakest and most overdue (`learning.revisitDays`).

## Accessibility

- Every field choice has a matching form control.
- Defenders on the field are keyboard-focusable checkboxes.
- The field has a text equivalent.
- Shapes as well as colors separate the offense (circles) from the defense (squares).
- Results are announced in a live region, and reduced motion is respected.
- No team colors are used.

## Film room grading (gen.js)

Every film-room option gets a **process grade** from what was knowable before the snap:
- **Passes:** the shell's usual coverages (two-high is roughly 40% quarters, 30% Cover 2 and so on), times the concept's window against each one (`data.matrix`, which also holds the reason), times protection timing against the rush the box can send.
- **Runs:** the window grows or shrinks with run blockers minus box defenders.
- **Success:** yards needed for the down: 40% of the distance on 1st down, 60% on 2nd, all of it on 3rd and 4th.

The best option earns the top grade, and the others are graded by how far behind it they are. The **rep** then resolves against what the defense actually did: the charted coverage and rush.
