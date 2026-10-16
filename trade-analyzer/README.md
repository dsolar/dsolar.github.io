# League-aware trade analyzer

Build an offer from two connected ESPN rosters, compare projected starting
lineups before and after, and inspect keeper portfolio changes under your
league’s rules. The tool is read only at ESPN.

## Use

1. Open https://davidsolar.dev/trade-analyzer/ in desktop Chrome or Edge.
2. Download the extension ZIP, extract it, and load the folder containing
   `manifest.json` with Developer mode → Load unpacked in the browser's extensions page.
3. Sign into ESPN in the same browser and open the league to connect.
4. Refresh the connection page and choose Connect ESPN. The extension can select
   a league from open ESPN tabs, or accept an ESPN football league link/ID.
5. Check the league format and keeper count, then select players on both sides
   under Analyze a trade. Rohan is the initial suggested league, ID `270405`.
6. Under Keeper rules, confirm annual price changes, waiver keeper costs and
   traded-player eligibility. Auction & player values shows imported prices,
   the full draft, and per-player cost/projection/value overrides.

Existing installations work with this update. Refresh the analyzer page and
choose Refresh ESPN; reinstalling the extension is not required.

The first release is distributed as an unpacked extension, not a Chrome Web
Store listing. No ESPN cookies or passwords need to be pasted anywhere.

## Data and authentication

- The extension requests ESPN cookie access, its own local storage, and access
  to the project's connection service. It does not request browser history or
  access to unrelated sites. The bridge runs only on the analyzer's pages.
- A 256-bit device token is generated in the extension. The backend stores only
  its SHA-256 hash. Tokens and ESPN cookies are never sent through page messaging.
- Connecting reads `SWID` and `espn_s2` inside the extension and sends them over
  HTTPS to the Edge Function. It never reads or asks for the ESPN password.
- The session is encrypted with AES-256-GCM and a random IV before database
  storage. The encryption key is derived with HKDF from the server-only
  `ESPN_SYNC_ENCRYPTION_KEY` secret when set, otherwise from the Edge Function's
  server-only service key. Rotating that key requires reconnecting ESPN.
- Every backend league read, refresh, and disconnect checks the device token.
  RLS is enabled on all connector tables; `anon` and `authenticated` have no
  table grants or policies. Private rosters, tokens, and cookies are never
  committed to this repository or published as static JSON.
- This release pairs access to the installed extension/browser. Cross-device
  account login is not implemented. Losing the device token requires reconnecting.
- Disconnect deletes the connection and its league snapshots. Connections expire
  after 90 days without user access; the scheduler deletes expired rows.

## Import contract

`lib/espn.mjs` is the canonical parser. The build copies the identical module
into the extension and Edge Function. It retains ESPN category IDs, fractional
and negative points, bonus parameters, roster limits, waiver/trade rules,
matchup-period mappings, draft picks/prices when returned, per-player
eligibility/injury/acquisition fields, and current-season actual/projected stats.
Keeper house rules are explicitly marked for review rather than inferred.

League metadata and rosters are read with `mSettings`, `mTeam`, `mRoster`,
`mMatchup`, `mStatus`, and `mDraftDetail`. The `kona_player_info` request filters
`FREEAGENT` and `WAIVERS` and pages through the available pool. Player IDs are
deduplicated, rostered players are excluded, and incomplete or repeated pages
are flagged. A failed refresh keeps the previous successful snapshot and its
timestamp. Source completeness is separate from freshness.

ESPN's endpoints are undocumented and can change. The implementation references
the community-maintained [espn-api documentation](https://github.com/cwendt94/espn-api/wiki)
and [FantasyPros' description of its ESPN session-based sync](https://support.fantasypros.com/hc/en-us/articles/360051313453).
No affiliation or official ESPN API agreement is implied.

## Analysis model

- Weekly starting lineups use exact positional assignment, including FLEX, with
  one player per slot. Current locked starters retain their actual points.
- Current-week forecasts use ESPN’s league-scored weekly projections. Future
  weeks distribute its in-season remaining-season projections (source 1, split 0)
  over scheduled games. NFL schedules/byes come from `proTeamSchedules_wl`.
  Future-week allocations are not opponent-specific forecasts. Preseason split 2
  projections are never substituted for missing in-season data.
- Required drops and open roster spots are explicit. The same shared replacement
  pool is considered in the before and after worlds, so an already-available
  waiver upgrade is not falsely credited to a trade. Candidates screen the top
  five per position, with up to two optional upgrades per team. Waiver claims
  require a separate explicit assumption. FAAB, position caps, future transactions
  and future IR activations are not modeled.
- IR/reserve players do not silently join starting lineups. A player whose game
  has started cannot be traded into this week’s comparison or suggested as a
  current-week add/drop. Trades involving locked players start next week.
- Redraft, keeper count and dynasty change keeper treatment. The keeper optimizer
  selects the best eligible portfolio under the keeper count, auction budget and
  remaining minimum-bid reserve. Original auction prices, next-year keeper costs,
  planning market dollars and fantasy points remain separate. Missing costs block
  an overall keeper verdict until the relevant house rule or override is supplied.
- Market planning dollars are a current-projection value-above-replacement budget
  allocation. They are editable estimates, not predictions of next year’s auction.
  Keeper house rules/overrides persist locally per league and season.
- The ±10/20/30% sensitivity test changes traded players’ projections in both
  worlds. It is not a calibrated probability interval. ESPN is currently the only
  forecast source. Championship odds and multi-source consensus are not claimed.

## Backend

Project: `baxrczyufqbzrogftmyn`. Function: `espn-sync`.

The Edge Function uses its own device-token authentication; gateway JWT checks
are disabled so the opaque connection token can reach that handler. This does
not expose an unauthenticated league-data endpoint. The only unauthenticated
read is a health response with version and refresh interval.

`tools/espn-sync-schema.sql` creates the connector-only tables and a 20-minute
pg_cron/pg_net job. It generates a private scheduler credential inside Postgres;
the Edge Function checks its hash before processing due leagues. The job can
refresh while the browser is closed. ESPN session expiry is surfaced as a
reconnect requirement. Initial connections and refreshes are read-only at ESPN.

Source files live under `supabase/functions/espn-sync/`. Include both shared
`.mjs` modules when deploying `index.ts`. The project service key is provided by
the function runtime and must never be put in this repository or browser files.

## Build and verify

```sh
python3 tools/build-espn-connector.py
node --test tests/espn-connector.test.mjs tests/trade-analyzer.test.mjs
```

Tests cover custom scoring, full-pool pagination, data completeness, session
encryption, private access isolation, failure preservation, scheduler auth, and
the extension's page/credential boundary. Analysis tests cover bench promotion,
replacement fairness, shared waivers, flex assignment, byes, locks, negative
projections, IR exclusion, keeper cost/budget/count rules, and sensitivity.
Live private-league verification
requires installing the extension in a browser signed into that league; a
passing fixture test does not establish a successful live ESPN sync.
