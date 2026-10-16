# Dynasty Mode / Banner 19 comparison

Banner 19 is the deeper basketball and CBA simulation. Dynasty's distinct strengths are managing any team and continuing an expansion save. Keep the experiences separate, while sharing the underlying basketball model.

| System | Before this revision | This revision |
| --- | --- | --- |
| Ratings | Top-ten displayed overall average | Uses Banner 19 model.js directly: offense + defense impact, positional rotation, replacement minutes, overall display and aging |
| Injuries | None | Stationary availability with multi-game absences; depth replaces missing players; optional healthy mode; season games played visible |
| Transactions | Simplified salary matching and budgets | Corrected matching bands, transaction phase guards, pending-offer roster and hard-cap reservations, finite MLE pools, core-player AI guard and payroll previews |
| Contracts | Flat new deals and partially retained guarantees | Full source salary schedules retained on waivers, service-based modeled salary bounds, Bird terms, room/taxpayer/non-taxpayer MLE signing routes, slower market decay |
| Contract UX | Current salary and years | Per-player annual breakdown, guaranteed totals, five-season books, live eligibility and signing-method previews, explicit confirmation |

## Validation

Run `node franchise-mode/engine.test.cjs`. Covers failed-trade atomicity, apron rules, RFA reservation/matching, salary limits, expansion identity, balanced 30/31/32-team schedules, rollover, scheduled dead money, MLE pools, phase guards and 40-season injury calibration. Injury calibration is a model check, not validation against real-world injury forecasts. Browser visual QA was unavailable in the managed environment.

## Remaining work before calling it a complete dynasty game

- A sourced contract dataset with exact service years, options, guarantees, rookie status, extensions and current roster destinations. Existing 2027 snapshot remains projected and unknown salaries remain flat.
- Rookie draft, pick trading/conveyance, Stepien and frozen-pick rules; imported picks remain unspendable assets.
- Playoffs and championship progression; current results are regular season only.
- Exact Early Bird/QO/cap-hold rules, TPE carryover, sign-and-trades, stretch/set-off, trade kickers and full transaction calendars.
- In-season management and detailed game logs; current injury effects are reflected in the complete-season simulation.

Banner 19 already offers richer exception solving, contract options, pick checks, transaction timing and player details. Those are good candidates for a later unified league-state adapter; copying those modules wholesale would mix dollar-based 2026 contracts with Dynasty's million-dollar projected 2027 state.
