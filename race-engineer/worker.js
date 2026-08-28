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
  const raw = url.searchParams.get("race_id") || env.DEFAULT_RACE_ID || "1";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : "1";
}

async function supabase(env, path, params = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_KEY Worker secret");
  }

  const url = new URL(`/rest/v1/${path}`, env.SUPABASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
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
    throw new Error(`Supabase ${path}: ${res.status} ${text}`);
  }
  return res.json();
}

function latestStints(rows) {
  const byTeam = new Map();
  for (const row of rows) {
    const key = String(row.apex_id ?? row.team_name ?? Math.random());
    const prev = byTeam.get(key);
    const start = Number(row.start_lap_count ?? -1);
    const prevStart = Number(prev?.start_lap_count ?? -1);
    if (!prev || start >= prevStart) byTeam.set(key, row);
  }
  return [...byTeam.values()];
}

async function livePayload(env, raceId) {
  const [entries, stints] = await Promise.all([
    supabase(env, "apex_entries", {
      select: "*",
      race_id: `eq.${raceId}`,
      order: "updated_at.desc"
    }),
    supabase(env, "driver_stint_lap_stats_clean", {
      select: "*",
      race_id: `eq.${raceId}`,
      order: "start_lap_count.asc"
    })
  ]);

  const entryMap = new Map(entries.map(x => [String(x.apex_id), x]));
  const current = latestStints(stints).map(s => {
    const e = entryMap.get(String(s.apex_id)) || {};
    return {
      ...s,
      live_last_lap: e.last_lap ?? null,
      live_best_lap: e.best_lap ?? null,
      live_lap_count: e.lap_count ?? null,
      current_driver: e.current_driver ?? s.driver_name ?? null,
      updated_at: e.updated_at ?? null
    };
  });

  const seen = new Set(current.map(x => String(x.apex_id)));
  for (const e of entries) {
    if (!seen.has(String(e.apex_id))) {
      current.push({
        race_id: e.race_id,
        apex_id: e.apex_id,
        team_name: e.team_name,
        driver_name: e.current_driver,
        current_driver: e.current_driver,
        lap_count: e.lap_count,
        live_lap_count: e.lap_count,
        live_last_lap: e.last_lap,
        live_best_lap: e.best_lap,
        updated_at: e.updated_at
      });
    }
  }

  return { race_id: Number(raceId), generated_at: new Date().toISOString(), current, entries };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "race-engineer", now: new Date().toISOString() });
      }

      const raceId = safeRaceId(url, env);

      if (url.pathname === "/api/live") {
        return json(await livePayload(env, raceId));
      }

      if (url.pathname === "/api/stints") {
        const rows = await supabase(env, "driver_stint_lap_stats_clean", {
          select: "*",
          race_id: `eq.${raceId}`,
          order: "team_name.asc,start_lap_count.asc"
        });
        return json({ race_id: Number(raceId), rows });
      }

      if (url.pathname === "/api/drivers") {
        const rows = await supabase(env, "driver_lap_totals_clean", {
          select: "*",
          race_id: `eq.${raceId}`,
          order: "team_name.asc,driver_name.asc"
        });
        return json({ race_id: Number(raceId), rows });
      }

      if (url.pathname === "/api/pits") {
        const rows = await supabase(env, "apex_pit_stints", {
          select: "*",
          race_id: `eq.${raceId}`,
          order: "apex_id.asc,pit_number.asc"
        });
        return json({ race_id: Number(raceId), rows });
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error?.message || String(error) }, 500);
    }
  }
};
