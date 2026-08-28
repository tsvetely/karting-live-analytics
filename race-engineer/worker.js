function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function safeRaceId(url, env) {
  const raw =
    url.searchParams.get("race_id") ||
    env.DEFAULT_RACE_ID ||
    "1";

  const n = Number(raw);

  return Number.isFinite(n) && n > 0
    ? String(Math.trunc(n))
    : "1";
}

async function supabase(env, path, params = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_KEY Worker secret"
    );
  }

  const url = new URL(
    `/rest/v1/${path}`,
    env.SUPABASE_URL
  );

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_KEY,
      authorization: `Bearer ${env.SUPABASE_KEY}`,
      accept: "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();

    throw new Error(
      `Supabase ${path}: ${res.status} ${text}`
    );
  }

  return res.json();
}


// ============================================================
// LIVE
// ============================================================
//
// IMPORTANT:
//
// We DO NOT read driver_stint_lap_stats_clean here anymore.
//
// LIVE reads:
//
//   apex_entries
//   live_stint_stats
//
// live_stint_stats contains only the CURRENT stint state.
// Therefore the amount of data does not grow with race length.
//
// ============================================================

async function livePayload(env, raceId) {

  const entries = await supabase(env, "apex_entries", {
    select: "*",
    race_id: `eq.${raceId}`,
    order: "updated_at.desc"
  });

  // ==========================================================
  // IS THERE ACTUALLY A LIVE SESSION RIGHT NOW?
  // ==========================================================

  const now = Date.now();

  const newestTimestamp = entries.reduce((latest, entry) => {
    const t = Date.parse(entry.updated_at || "");
    return Number.isFinite(t) ? Math.max(latest, t) : latest;
  }, 0);

  /*
   * If NOTHING from Apex has been updated for 3 minutes,
   * there is no active live session.
   *
   * Important:
   * We return NO live teams.
   * We do NOT display historical apex_entries as LIVE.
   */
  const LIVE_TIMEOUT_MS = 3 * 60 * 1000;

  if (
    !newestTimestamp ||
    now - newestTimestamp > LIVE_TIMEOUT_MS
  ) {
    return {
      race_id: Number(raceId),
      generated_at: new Date().toISOString(),
      active: false,
      current: [],
      entries: []
    };
  }


  // ==========================================================
  // CURRENT ACTIVE FIELD
  // ==========================================================
  //
  // During an active session we only accept entries belonging
  // to the current wave of Apex updates.
  //
  // This removes stale karts left from previous sessions.
  // ==========================================================

  const CURRENT_FIELD_WINDOW_MS = 3 * 60 * 1000;

  const activeEntries = entries.filter(entry => {

    const t =
      Date.parse(entry.updated_at || "");

    if (!Number.isFinite(t)) {
      return false;
    }

    return (
      newestTimestamp - t <= CURRENT_FIELD_WINDOW_MS
    );
  });


  // ==========================================================
  // LIVE STINT SNAPSHOTS
  // ==========================================================

  const liveStints = await supabase(
    env,
    "live_stint_stats",
    {
      select: "*",
      race_id: `eq.${raceId}`,
      order: "team_name.asc"
    }
  );


  const activeApexIds =
    new Set(
      activeEntries.map(
        entry => String(entry.apex_id)
      )
    );


  /*
   * live_stint_stats can itself contain a row left from a
   * previous session.
   *
   * Keep ONLY Apex IDs currently active in Apex timing.
   */
  const activeLiveStints =
    liveStints.filter(
      stint =>
        activeApexIds.has(
          String(stint.apex_id)
        )
    );


  const entryMap =
    new Map(
      activeEntries.map(
        entry => [
          String(entry.apex_id),
          entry
        ]
      )
    );


  const current =
    activeLiveStints.map(stint => {

      const entry =
        entryMap.get(
          String(stint.apex_id)
        ) || {};

      return {

        race_id:
          stint.race_id,

        apex_id:
          stint.apex_id,

        team_name:
          stint.team_name ??
          entry.team_name ??
          null,

        driver_name:
          stint.driver_name ??
          entry.current_driver ??
          null,

        current_driver:
          stint.driver_name ??
          entry.current_driver ??
          null,

        start_lap_count:
          stint.start_lap_count ??
          null,

        end_lap_count:
          null,

        lap_count:
          stint.valid_laps ??
          stint.total_laps ??
          0,

        avg_lap_time:
          stint.avg_lap ??
          null,

        best_lap_time:
          stint.best_lap ??
          null,

        best_lap_number:
          stint.best_lap_number ??
          null,

        worst_lap_time:
          stint.worst_lap ??
          null,

        worst_lap_number:
          stint.worst_lap_number ??
          null,

        consistency:
          stint.consistency ??
          null,

        live_last_lap:
          stint.last_lap ??
          entry.last_lap ??
          null,

        live_best_lap:
          stint.best_lap ??
          entry.best_lap ??
          null,

        live_lap_count:
          entry.lap_count ??
          stint.current_lap_count ??
          null,

        updated_at:
          stint.updated_at ??
          entry.updated_at ??
          null
      };
    });


  // ==========================================================
  // ENTRY EXISTS BUT LIVE STINT HAS NOT STARTED YET
  // ==========================================================

  const seen =
    new Set(
      current.map(
        row => String(row.apex_id)
      )
    );


  for (const entry of activeEntries) {

    if (
      seen.has(
        String(entry.apex_id)
      )
    ) {
      continue;
    }

    current.push({

      race_id:
        entry.race_id,

      apex_id:
        entry.apex_id,

      team_name:
        entry.team_name ??
        null,

      driver_name:
        entry.current_driver ??
        null,

      current_driver:
        entry.current_driver ??
        null,

      start_lap_count:
        null,

      end_lap_count:
        null,

      lap_count:
        0,

      avg_lap_time:
        null,

      best_lap_time:
        null,

      best_lap_number:
        null,

      worst_lap_time:
        null,

      worst_lap_number:
        null,

      consistency:
        null,

      live_last_lap:
        entry.last_lap ??
        null,

      live_best_lap:
        entry.best_lap ??
        null,

      live_lap_count:
        entry.lap_count ??
        null,

      updated_at:
        entry.updated_at ??
        null
    });
  }


  return {
    race_id: Number(raceId),
    generated_at: new Date().toISOString(),
    active: true,
    current,
    entries: activeEntries
  };
}


// ============================================================
// WORKER
// ============================================================

export default {

  async fetch(request, env) {

    const url = new URL(request.url);

    try {

      // ------------------------------------------------------
      // HEALTH
      // ------------------------------------------------------

      if (url.pathname === "/api/health") {

        return json({
          ok: true,
          service: "race-engineer",
          now: new Date().toISOString()
        });

      }


      const raceId =
        safeRaceId(url, env);


      // ------------------------------------------------------
      // LIVE
      // ------------------------------------------------------
      //
      // ONLY current race state.
      //
      // No driver_stint_lap_stats_clean.
      // No complete race aggregation.
      //
      // ------------------------------------------------------

      if (url.pathname === "/api/live") {

        return json(
          await livePayload(
            env,
            raceId
          )
        );

      }


      // ------------------------------------------------------
      // STINTS
      // ------------------------------------------------------
      //
      // Finished stint snapshots.
      //
      // This endpoint is called by the STINTS tab.
      //
      // ------------------------------------------------------

      if (url.pathname === "/api/stints") {

        const rows = await supabase(
          env,
          "completed_stint_stats",
          {
            select: "*",
            race_id: `eq.${raceId}`,
            order: "stint_ended_at.asc"
          }
        );

        return json({
          race_id: Number(raceId),
          rows
        });

      }


      // ------------------------------------------------------
      // DRIVERS
      // ------------------------------------------------------
      //
      // Existing aggregate remains here.
      //
      // IMPORTANT:
      // It is NOT queried by /api/live anymore.
      //
      // ------------------------------------------------------

      if (url.pathname === "/api/drivers") {

        const rows = await supabase(
          env,
          "driver_lap_totals_clean",
          {
            select: "*",
            race_id: `eq.${raceId}`,
            order: "team_name.asc,driver_name.asc"
          }
        );

        return json({
          race_id: Number(raceId),
          rows
        });

      }


      // ------------------------------------------------------
      // PITS
      // ------------------------------------------------------

      if (url.pathname === "/api/pits") {

        const rows = await supabase(
          env,
          "apex_pit_stints",
          {
            select: "*",
            race_id: `eq.${raceId}`,
            order: "apex_id.asc,pit_number.asc"
          }
        );

        return json({
          race_id: Number(raceId),
          rows
        });

      }


      // ------------------------------------------------------
      // STATIC UI
      // ------------------------------------------------------

      return env.ASSETS.fetch(request);


    } catch (error) {

      console.error(
        "WORKER ERROR:",
        error
      );

      return json(
        {
          error:
            error?.message ||
            String(error)
        },
        500
      );

    }

  }

};
