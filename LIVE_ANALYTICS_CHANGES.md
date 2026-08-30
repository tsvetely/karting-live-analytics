# LIVE_ANALYTICS_CHANGES — v6.23 Apex sync

This build fixes the current LIVE screen using stale/incomplete Apex detail history.

- Current race lap, pit count, driver and position continue to come from the live Apex grid.
- Current stint number is now derived from the authoritative live Apex pit count (`pits + 1`).
- A stored pit chain is accepted for stint analytics only when it contains every pit reported by the live grid and has been refreshed recently from Apex detail.
- If pit detail is incomplete/stale, the UI no longer invents a huge stint from an old pit boundary. The row remains on the correct current stint number while stint laps/AVG/BEST/WORST wait for synchronized Apex detail.
- Any pit-count change now triggers an immediate detail refresh.
- Full field detail refresh runs every minute instead of every five minutes.
- The deployment repair version is bumped to v6.23 so all current kart details are force-refreshed once after deployment.
- A race/session boundary is also detected when lap counters reset sharply, so a new race no longer depends on a six-hour silence before the previous race is archived.
- Complete Apex lap detail replaces the current kart lap history atomically; incomplete detail never destroys the existing chain.
- Incomplete pit detail never overwrites a known pit chain and is retried on subsequent refreshes.


## v6.25 — Apex source-of-truth lap persistence

- Removed race archive/clear triggered by a single kart lap-counter reset.
- Removed synthetic lap event creation from cached LLP + TLP fields.
- Lap-number/time pairs now come only from Apex P/L detail parsing.
- `refreshDetail()` no longer deletes the existing lap chain before writing a newer Apex detail response; it merges authoritative rows with upsert.
- Deployment repair version bumped to `v6.25` so the current field is rebuilt from Apex detail once after deployment.


## v6.26 — Preserve raw Apex snapshot after timing stops

- Fixed `collectorSnapshot()` so a valid collected Apex field is not discarded only because `last_packet_at` is older than 90 seconds.
- Snapshot age now affects only `is_live` / session status; it does not erase teams, race laps, pit counts, drivers, last laps or the field itself.
- Direct Apex reconnect is now only a fallback when there is genuinely no collected field.
- This removes the path that turned an ended/paused race with real Apex data into `—` summary values.

## v6.28 — raw Apex field is authoritative
- Preserve every latest Apex grid cell per kart in collector `rawRows` before any parsing/analytics.
- Expose `rawRows` in collector snapshots and `apex_fields` per `/api/live` row.
- Store exactly the latest Apex BLP value; removed the inferred monotonic-best rule.
- Removed inferred full-grid session reset/clearing from collector grid parsing.
- `/api/live` now exposes `apex_best_lap` separately from derived stint `best_lap_time`.
- Race BEST summary uses current Apex BLP values first; recorded lap events are only a fallback.
- Overview now shows an explicit APEX BEST column so raw Apex race best is never confused with current-stint best.
- Overview summary cards no longer let a stale/empty `0` liveMeta overwrite the non-empty 72-row field already displayed.
