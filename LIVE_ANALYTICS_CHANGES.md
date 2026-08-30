# LIVE_ANALYTICS_CHANGES

Base: uploaded `karting-live-analytics-main (3).zip`, checked against the repository layout at commit `1c315cc06a49e126adfcac3c775ec583320c47af`.

## race-engineer/worker.js

### LIVE lap persistence
- `ApexCollector.applyField()` now immediately upserts the newest live lap into `apex_lap_events` when the Apex total-lap (`tlp`) value advances and a valid last-lap time is available.
- The existing full `refreshDetail()` remains authoritative and still rebuilds complete current-session history.
- Purpose: remove the window where the UI already shows race lap N while the current stint still has zero persisted laps/statistics.

### Stint analytics
- Average is now only produced with at least 3 valid laps, matching KartingNumbersXlsx.
- Consistency is now `average - best`, matching KartingNumbersXlsx.
- Added race-wide global disruption detection using the same thresholds as the macOS implementation.
- Added automatic direction split seed from pit-stop race time and per-kart Safety Car / direction-change block detection using the current `DirectionSplitRange.swift` logic.
- Transition laps are excluded from analytical pace statistics.
- Added global rain transition detection and per-kart rain-start detection using the current `RaceExportService.swift` logic.
- Added per-stint Overall / Straight / Reverse / Rain average, best and worst fields.
- Rain remains independent from direction; rain laps are kept as rain and are not counted in dry Straight/Reverse pace statistics.

### Team analytics
- Added `teamsFromStints()` so team rows aggregate persisted stint statistics directly.
- Team rows now include Overall / Straight / Reverse / Rain averages, bests and worsts, plus Overall best/worst lap numbers.

### Lap Time Records export
- `/api/reports/lap-time-records.csv` now emits an Apex-style lap matrix compatible with `RaceParser.parseLapTimeCSV()`.
- Previous output was `Lap,Time` per row, which the macOS parser interpreted with an off-by-one lap number because it expects `base lap + matrix columns`.
- Raw laps are preserved, including analytically excluded laps.

### Pit Stops export
- Added `/api/reports/pit-stops.pdf` as a direct downloadable PDF.
- PDF text rows use the field order expected by `RaceParser.parsePitStopsText()`.
- Only completed stints are emitted in the source-compatible PDF; an unfinished LIVE stint is not given invented Hour/Out values.
- Existing HTML print report remains available at `/api/reports/pit-stops.html`.

## race-engineer/public/app.js
- Pit Stops PDF button now downloads `/api/reports/pit-stops.pdf` directly instead of opening a print-only HTML window.
- Stints and Teams render the new Overall / Straight / Reverse / Rain pace statistics.

## race-engineer/public/index.html
- Expanded Stints and Teams tables with Overall / Straight / Reverse / Rain columns.

## Tests run
- `node --check race-engineer/worker.js` -> PASS
- `node --check race-engineer/public/app.js` -> PASS
- No Supabase schema migration was added.
- Cloudflare deployment was not performed from this environment.

## 2026-08-30 v6.22 — history + complete report downloads

### History preservation
- Fixed the root cause of disappearing previous races: `DEFAULT_RACE_ID=1` was reused and current-session detail refresh deleted/replaced rows under the same `race_id`.
- The collector now archives the finished current dataset to a new `race_id` after a long session gap before new-session packets are applied.
- Archived races are read from their own stored Apex IDs, not filtered through the current live 72-kart field.
- Historical overview/stints are treated as FINISHED; the last stint is no longer shown as LIVE.
- No Supabase schema migration is required; the existing `race_id` columns are used.

### Reports / downloads
- Fixed `/api/reports/pit-stops.pdf` routing: the branch existed but was unreachable because the outer route allow-list did not include it.
- Added direct download endpoints:
  - `/api/reports/lap-time-records.csv`
  - `/api/reports/lap-time-records.pdf`
  - `/api/reports/pit-stops.csv`
  - `/api/reports/pit-stops.pdf`
- Enabled all four Apex-format report buttons in the UI and wired the previously inactive Lap Time PDF and Pit Stops CSV buttons.
- Historical race report exports now use the archived race field rather than the current live field.

### Important limitation for the already-missing 29/08 race
This patch prevents future finished sessions from being overwritten. If the 29/08 rows were already deleted/replaced under `race_id=1` before v6.22 is deployed, those normalized rows cannot be recreated from the current `apex_entries`, `apex_lap_events` and `apex_pit_stints` tables. Recovery is only possible if the older packets still exist in `apex_raw_packets` (or from an external backup/export); that recovery is a separate reconstruction task and is intentionally not guessed here.
