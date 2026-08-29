function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store"
      }
    }
  );
}


// ============================================================
// SUPABASE
// ============================================================

async function supabase(
  env,
  path,
  params = {}
) {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_KEY
  ) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_KEY Worker secret"
    );
  }


  const url =
    new URL(
      `/rest/v1/${path}`,
      env.SUPABASE_URL
    );


  for (
    const [key, value]
    of Object.entries(params)
  ) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(
        key,
        value
      );
    }
  }


  const res =
    await fetch(
      url,
      {
        headers: {
          apikey:
            env.SUPABASE_KEY,

          authorization:
            `Bearer ${env.SUPABASE_KEY}`,

          accept:
            "application/json"
        }
      }
    );


  if (!res.ok) {
    const text =
      await res.text();

    throw new Error(
      `Supabase ${path}: ${res.status} ${text}`
    );
  }


  return res.json();
}


// ============================================================
// RACE ID
// ============================================================

function requestedRaceId(url) {
  const raw =
    url.searchParams.get(
      "race_id"
    );


  if (
    raw === null ||
    raw === ""
  ) {
    return null;
  }


  const n =
    Number(raw);


  if (
    !Number.isFinite(n) ||
    n <= 0
  ) {
    return null;
  }


  return String(
    Math.trunc(n)
  );
}


function defaultRaceId(env) {
  const n =
    Number(
      env.DEFAULT_RACE_ID ||
      1
    );


  return (
    Number.isFinite(n) &&
    n > 0
  )
    ? String(
        Math.trunc(n)
      )
    : "1";
}


// ============================================================
// DISTINCT RACE IDS
// ============================================================

function collectRaceIds(
  rows,
  target
) {
  for (const row of rows) {
    const value =
      Number(
        row.race_id
      );


    if (
      Number.isFinite(value) &&
      value > 0
    ) {
      target.add(
        Math.trunc(value)
      );
    }
  }
}


// ============================================================
// RACE / SESSION HISTORY
// ============================================================

async function racesPayload(env) {
  /*
   * There is currently no dedicated races table in the
   * Worker code we have.
   *
   * Therefore history is built from the actual race_id values
   * that already exist in the stored race data.
   *
   * We intentionally do NOT query the heavy aggregate views
   * here.
   */

  const [
    entries,
    completedStints,
    pits,
    lapEvents
  ] =
    await Promise.all([
      supabase(
        env,
        "apex_entries",
        {
          select:
            "race_id,updated_at",

          order:
            "updated_at.desc"
        }
      ),

      supabase(
        env,
        "completed_stint_stats",
        {
          select:
            "race_id,stint_started_at,stint_ended_at",

          order:
            "stint_ended_at.desc"
        }
      ),

      supabase(
        env,
        "apex_pit_stints",
        {
          select:
            "race_id",

          order:
            "race_id.desc"
        }
      ),

      supabase(
        env,
        "apex_lap_events",
        {
          select:
            "race_id,received_at",

          order:
            "received_at.desc"
        }
      )
    ]);


  const raceIds =
    new Set();


  collectRaceIds(
    entries,
    raceIds
  );

  collectRaceIds(
    completedStints,
    raceIds
  );

  collectRaceIds(
    pits,
    raceIds
  );

  collectRaceIds(
    lapEvents,
    raceIds
  );


  /*
   * Build useful timestamps per race.
   */

  const timestampByRace =
    new Map();


  function registerTimestamp(
    raceId,
    value
  ) {
    const id =
      Number(raceId);

    if (
      !Number.isFinite(id) ||
      !value
    ) {
      return;
    }


    const timestamp =
      Date.parse(value);


    if (
      !Number.isFinite(timestamp)
    ) {
      return;
    }


    const previous =
      timestampByRace.get(id) ||
      0;


    if (
      timestamp > previous
    ) {
      timestampByRace.set(
        id,
        timestamp
      );
    }
  }


  for (const row of entries) {
    registerTimestamp(
      row.race_id,
      row.updated_at
    );
  }


  for (
    const row
    of completedStints
  ) {
    registerTimestamp(
      row.race_id,
      row.stint_ended_at
    );

    registerTimestamp(
      row.race_id,
      row.stint_started_at
    );
  }


  for (const row of lapEvents) {
    registerTimestamp(
      row.race_id,
      row.received_at
    );
  }


  const rows =
    [...raceIds]
      .map(
        raceId => {

          const timestamp =
            timestampByRace.get(
              raceId
            ) || null;


          const date =
            timestamp
              ? new Date(
                  timestamp
                )
              : null;


          const dateLabel =
            date
              ? date.toLocaleDateString(
                  "en-GB",
                  {
                    year:
                      "numeric",

                    month:
                      "short",

                    day:
                      "2-digit"
                  }
                )
              : null;


          return {
            id:
              raceId,

            race_id:
              raceId,

            name:
              dateLabel
                ? `Race ${raceId} — ${dateLabel}`
                : `Race ${raceId}`,

            updated_at:
              date
                ? date.toISOString()
                : null
          };
        }
      )
      .sort(
        (a, b) => {

          const at =
            a.updated_at
              ? Date.parse(
                  a.updated_at
                )
              : 0;

          const bt =
            b.updated_at
              ? Date.parse(
                  b.updated_at
                )
              : 0;


          if (bt !== at) {
            return bt - at;
          }


          return (
            Number(b.race_id) -
            Number(a.race_id)
          );
        }
      );


  return {
    rows
  };
}


// ============================================================
// LIVE
// ============================================================

async function livePayload(
  env,
  raceId
) {
  const entries =
    await supabase(
      env,
      "apex_entries",
      {
        select:
          "*",

        race_id:
          `eq.${raceId}`,

        order:
          "updated_at.desc"
      }
    );


  // ==========================================================
  // IS THERE ACTUALLY A LIVE SESSION RIGHT NOW?
  // ==========================================================

  const now =
    Date.now();


  const newestTimestamp =
    entries.reduce(
      (
        latest,
        entry
      ) => {

        const t =
          Date.parse(
            entry.updated_at ||
            ""
          );


        return Number.isFinite(t)
          ? Math.max(
              latest,
              t
            )
          : latest;
      },
      0
    );


  /*
   * If nothing from Apex has been updated for 3 minutes,
   * this race is not currently live.
   */

  const LIVE_TIMEOUT_MS =
    3 * 60 * 1000;


  if (
    !newestTimestamp ||
    now - newestTimestamp >
      LIVE_TIMEOUT_MS
  ) {
    return {
      race_id:
        Number(raceId),

      generated_at:
        new Date()
          .toISOString(),

      active:
        false,

      current:
        [],

      entries:
        []
    };
  }


  // ==========================================================
  // CURRENT ACTIVE FIELD
  // ==========================================================

  const CURRENT_FIELD_WINDOW_MS =
    3 * 60 * 1000;


  const activeEntries =
    entries.filter(
      entry => {

        const t =
          Date.parse(
            entry.updated_at ||
            ""
          );


        if (
          !Number.isFinite(t)
        ) {
          return false;
        }


        return (
          newestTimestamp - t <=
          CURRENT_FIELD_WINDOW_MS
        );
      }
    );


  // ==========================================================
  // LIVE STINT SNAPSHOTS
  // ==========================================================

  const liveStints =
    await supabase(
      env,
      "live_stint_stats",
      {
        select:
          "*",

        race_id:
          `eq.${raceId}`,

        order:
          "team_name.asc"
      }
    );


  const activeApexIds =
    new Set(
      activeEntries.map(
        entry =>
          String(
            entry.apex_id
          )
      )
    );


  /*
   * live_stint_stats can contain stale rows from an older
   * session. Only keep Apex IDs currently active.
   */

  const activeLiveStints =
    liveStints.filter(
      stint =>
        activeApexIds.has(
          String(
            stint.apex_id
          )
        )
    );


  const entryMap =
    new Map(
      activeEntries.map(
        entry => [
          String(
            entry.apex_id
          ),
          entry
        ]
      )
    );


  const current =
    activeLiveStints.map(
      stint => {

        const entry =
          entryMap.get(
            String(
              stint.apex_id
            )
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
      }
    );


  // ==========================================================
  // ACTIVE ENTRY WITHOUT LIVE STINT YET
  // ==========================================================

  const seen =
    new Set(
      current.map(
        row =>
          String(
            row.apex_id
          )
      )
    );


  for (
    const entry
    of activeEntries
  ) {
    if (
      seen.has(
        String(
          entry.apex_id
        )
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


  current.sort(
    (a, b) =>
      String(
        a.team_name || ""
      ).localeCompare(
        String(
          b.team_name || ""
        )
      )
  );


  return {
    race_id:
      Number(raceId),

    generated_at:
      new Date()
        .toISOString(),

    active:
      true,

    current,

    entries:
      activeEntries
  };
}


// ============================================================
// STINTS
// ============================================================

async function stintsPayload(
  env,
  raceId,
  includeLive
) {
  const completed =
    await supabase(
      env,
      "completed_stint_stats",
      {
        select:
          "*",

        race_id:
          `eq.${raceId}`,

        order:
          "stint_ended_at.asc"
      }
    );


  if (!includeLive) {
    return completed;
  }


  const live =
    await supabase(
      env,
      "live_stint_stats",
      {
        select:
          "*",

        race_id:
          `eq.${raceId}`,

        order:
          "team_name.asc"
      }
    );


  const liveRows =
    live.map(
      row => ({
        ...row,

        end_lap_count:
          null,

        is_live:
          true,

        avg_lap_time:
          row.avg_lap_time ??
          row.avg_lap ??
          null,

        best_lap_time:
          row.best_lap_time ??
          row.best_lap ??
          null,

        worst_lap_time:
          row.worst_lap_time ??
          row.worst_lap ??
          null,

        lap_count:
          row.valid_laps ??
          row.total_laps ??
          row.current_lap_count ??
          0
      })
    );


  return [
    ...completed,
    ...liveRows
  ];
}


// ============================================================
// WORKER
// ============================================================

export default {

  async fetch(
    request,
    env
  ) {
    const url =
      new URL(
        request.url
      );


    try {

      // ------------------------------------------------------
      // HEALTH
      // ------------------------------------------------------

      if (
        url.pathname ===
        "/api/health"
      ) {
        return json({
          ok:
            true,

          service:
            "race-engineer",

          now:
            new Date()
              .toISOString()
        });
      }


      // ------------------------------------------------------
      // RACES / SESSIONS
      // ------------------------------------------------------

      if (
        url.pathname ===
        "/api/races"
      ) {
        return json(
          await racesPayload(
            env
          )
        );
      }


      /*
       * Explicit race_id means HISTORY or a request for the
       * currently active race after /api/live has identified it.
       *
       * No race_id means use the configured current collector
       * race.
       */

      const explicitRaceId =
        requestedRaceId(
          url
        );


      const raceId =
        explicitRaceId ??
        defaultRaceId(
          env
        );


      // ------------------------------------------------------
      // LIVE
      // ------------------------------------------------------

      if (
        url.pathname ===
        "/api/live"
      ) {
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

      if (
        url.pathname ===
        "/api/stints"
      ) {
        /*
         * When the frontend explicitly sends race_id we return
         * that selected race.
         *
         * For the current LIVE race we include both completed
         * stints and the currently running stint snapshots.
         */

        const includeLive =
          explicitRaceId === null ||
          String(
            explicitRaceId
          ) ===
          String(
            defaultRaceId(env)
          );


        const rows =
          await stintsPayload(
            env,
            raceId,
            includeLive
          );


        return json({
          race_id:
            Number(raceId),

          rows
        });
      }


      // ------------------------------------------------------
      // DRIVERS
      // ------------------------------------------------------

      if (
        url.pathname ===
        "/api/drivers"
      ) {
        const rows =
          await supabase(
            env,
            "driver_lap_totals_clean",
            {
              select:
                "*",

              race_id:
                `eq.${raceId}`,

              order:
                "team_name.asc,driver_name.asc"
            }
          );


        return json({
          race_id:
            Number(raceId),

          rows
        });
      }


      // ------------------------------------------------------
      // PITS
      // ------------------------------------------------------

      if (
        url.pathname ===
        "/api/pits"
      ) {
        const rows =
          await supabase(
            env,
            "apex_pit_stints",
            {
              select:
                "*",

              race_id:
                `eq.${raceId}`,

              order:
                "apex_id.asc,pit_number.asc"
            }
          );


        return json({
          race_id:
            Number(raceId),

          rows
        });
      }


      // ------------------------------------------------------
      // STATIC UI
      // ------------------------------------------------------

      return env.ASSETS.fetch(
        request
      );


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
