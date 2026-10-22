# Sunday Strategist: data model

All content lives in `scenarios.js` and `schema.js` enforces it. Coordinates are in yards: `x` from the left sideline (0 to 53.3) and `y` from the line of scrimmage, positive downfield. Times are seconds after the snap.

## Top level
`version`, `concepts{}`, `defenses{}`, `tags{}` (skill labels for the read report), `confidence[]`, `scenarios[]`.

## Concept (offense, shared across scenarios)
`name`, `family`, `plain`, `stresses`, `strongVs[]`, `weakVs[]`, `timing`, `failure[]`.

## Defensive call (shared)
`name`, `plain`, `vulnerable[]`, `counters[]`.

## Scenario

| Field | Meaning |
|---|---|
| `id`, `title`, `module`, `order`, `version` | Identity |
| `type` | `verified` · `reconstructed` · `adapted` · `synthetic` (spec section 16, types A to D) |
| `status` | `draft` · `review` · `approved` · `published` · `deprecated`. Only `published` is played. |
| `provenance` | `type` (must match), `label` (shown on screen), `sources[]`, `fieldConfidence{field: verified/derived/expert-charted/inferred/synthetic/unknown}`, `reviewer`, `notes`. A non-synthetic scenario must have sources and a `historical` block. A synthetic one must not. |
| `historical` | (Real plays only) `season`, `week`, `gameId`, `playId` (nflverse IDs), `offense`, `defense`, `description`, `result` |
| `context` | `quarter`, `clock` (M:SS), `score{you, opp}`, `down`, `distance`, `yardLine` + `side` (own/opp), `hash`, `objective`, `scouting` |
| `offense` / `defense` | `personnel`, `personnelText`, formation/front/shell/boxCount/disguise, and `players[]` (11 each): `id`, `label`, `role`, `x`, `y` |
| `actual` | What the defense really did: `call` (a defense id), `pressure`, `rushers[]`, `droppers[]`, `coverage`, `rotation`, `post{id: {x, y, zone?}}` for all 11, and `events[]` (`t`, `text`) for the timeline |
| `diagnosis.questions[]` | `kind: single`: `options[]` and `credit{option: 0-100}`, with one option at 100. `kind: rushers`: `answer[]` and `critical`. Every question has `prompt`, `explain`, and `error` (a taxonomy id). |
| `motions[]` | Must include `none`. Each has `path{from, to, back?}`, `moves{defender: [x, y]}` (the defense's reaction), `text` (the reveal) and `clue` |
| `protections[]` | `hold` (seconds of protection against the actual pressure), `grade`, `category`, `why`, `hotPlan?`, and `assignments[]`. The first assignment is the weak point. |
| `plays[]` | `concept`, `label`, `detail`, `kind?: run`, `need` (seconds), `window` (0-1), `yards`/`spread`, `failYards`/`failSpread` (runs), `intRisk`, `luck`, `hot?{window, yards, spread, text}`, `grade`, `category`, `conflict`, `why`, `key{answer, partial{id: note}}`, `routes[]{from, path[[x, y]]}`, `assignments[]` |
| assignment | `player`, `assignment`, `key` (a defender), `win`, `fail`, `p`, `critical?`, `keyBonus?` |
| `contingencies[]` | `onPressure`: `hot`, `sight` (needs `throw{}`), `throwaway` or `none`. `grades{play: 0-100}` for every play, and `why`. |
| `interactions[]` | `when{motion?, protection?, play?, contingency?}`, plus optional `hold`, `window`, `need`, `play`, `protection` adjustments and a required `note` |
| `recommended` | `{motion, protection, play, contingency}`, used to compare alternatives on equal terms |
| `clues[]` | `text`, `kind`: `meaningful` · `deceptive` · `uncertain` |
| `next`, `takeaway` | The next-call implication and the one reusable principle |
| `learning` | `objectives[]`, `tags[]` (keys of `data.tags`), `misconceptions[]`, `difficulty`, `transfer[]`, `revisitDays` |

## Lesson fit (for real snaps)
`fit: { downs[], distance: [min, max], coverage: [nflverse coverage codes], rushers: [min, max], blitz }`. This says which real snaps a lesson can stand in for.

## Real snaps (`real-plays.js`, written by `tools/strategist_real.py`)
`{ updated, seasons, source, teams{abbr: nickname}, plays[] }`. Each play has:
- **Game:** `lesson`, `id`, `season`, `week`, `round`, `gameId`, `playId`, `off`, `def`, `home`, scores, `qtr`, `clock`, `down`, `dist`, `yl100`, `wp`.
- **Result (verified, play-by-play):** `desc`, `yards`, `epa`, `first`, `td`, `result`.
- **The throw (charted):** `passer`, `target`, `route`, `ttt`, `playAction`, `motion`.
- **The defense (charted):** `coverage`, `manZone`, `rushers`, `blitzers`, `box`, `pressure`.
- **Players (verified, participation):** `qb`, `rb`, `te`, `wr[]`, `defNames[]`.
- **Scouting (derived):** `tendency{n, blitz, coverage}`, the defense's third-down habits that season.

`engine.catalog()` turns each one into a playable scenario with `type: "adapted"`. It takes the real context, teams and provenance, and borrows the lesson's drawing and option grades. Every fact is labeled as verified, charted or reconstructed.

## Saved progress (localStorage `ss-record-v1`)
`{ v: 1, tags: {tag: {seen, total, last}}, scenarios: {id: {plays, best, last}}, errors: {type: count} }`. Process scores only, never results.

## Adding a scenario
Copy a scenario block and change it, then run `node --test sunday-strategist/engine.test.cjs`. The schema test reports every broken reference by its path. For a real play, set `type` and `provenance.type` to `verified`, `reconstructed` or `adapted`, list the sources, add `historical`, and mark each field's confidence. Never present an inferred alignment as fact.
