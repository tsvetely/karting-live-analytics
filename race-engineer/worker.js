// ============================================================
// RACE ENGINEER — CLOUDFLARE WORKER + APEX CLOUD COLLECTOR
// ============================================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}


// ============================================================
// CONFIG
// ============================================================

function defaultRaceId(env) {
  const n = Number(env.DEFAULT_RACE_ID || 1);

  return Number.isFinite(n) && n > 0
    ? Math.trunc(n)
    : 1;
}

function requestedRaceId(url, env) {
  const raw =
    url.searchParams.get("race_id") ||
    env.DEFAULT_RACE_ID ||
    "1";

  const n = Number(raw);

  return Number.isFinite(n) && n > 0
    ? Math.trunc(n)
    : 1;
}


// ============================================================
// SUPABASE REST
// ============================================================

function supabaseHeaders(env, extra = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_KEY"
    );
  }

  return {
    apikey: env.SUPABASE_KEY,
    authorization: `Bearer ${env.SUPABASE_KEY}`,
    "content-type": "application/json",
    ...extra
  };
}


async function sbGet(env, table, params = {}) {
  const url = new URL(
    `/rest/v1/${table}`,
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

  const response = await fetch(url, {
    headers: supabaseHeaders(env, {
      accept: "application/json"
    })
  });

  if (!response.ok) {
    throw new Error(
      `Supabase GET ${table}: ${response.status} ${await response.text()}`
    );
  }

  return response.json();
}


async function sbWrite(
  env,
  table,
  method,
  body,
  params = {},
  prefer = "return=minimal"
) {
  const url = new URL(
    `/rest/v1/${table}`,
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

  const response = await fetch(url, {
    method,
    headers: supabaseHeaders(env, {
      Prefer: prefer
    }),
    body:
      body === undefined
        ? undefined
        : JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(
      `Supabase ${method} ${table}: ${response.status} ${await response.text()}`
    );
  }

  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}


async function sbInsert(env, table, body) {
  return sbWrite(
    env,
    table,
    "POST",
    body
  );
}


async function sbUpsert(
  env,
  table,
  body,
  conflict
) {
  return sbWrite(
    env,
    table,
    "POST",
    body,
    {
      on_conflict: conflict
    },
    "resolution=merge-duplicates,return=minimal,missing=default"
  );
}


async function sbPatch(
  env,
  table,
  body,
  filters
) {
  return sbWrite(
    env,
    table,
    "PATCH",
    body,
    filters
  );
}


async function sbDelete(
  env,
  table,
  filters
) {
  return sbWrite(
    env,
    table,
    "DELETE",
    undefined,
    filters
  );
}


// ============================================================
// APEX PARSING
// ============================================================

function parseApexLine(line) {
  const match =
    line.match(
      /^r(\d+)(?:c(\d+))?\|([^|]+)\|(.*)$/
    );

  if (!match) {
    return null;
  }

  return {
    apexId: match[1],
    column: match[2] || null,
    field: match[3],
    value: match[4] || ""
  };
}


function parseLapTime(value) {
  if (!value) {
    return null;
  }

  if (value.includes(":")) {
    const parts = value.split(":");

    if (parts.length !== 2) {
      return null;
    }

    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);

    if (
      !Number.isFinite(minutes) ||
      !Number.isFinite(seconds)
    ) {
      return null;
    }

    return minutes * 60 + seconds;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function msToTime(ms) {
  ms = Number(ms);

  if (!Number.isFinite(ms)) {
    return null;
  }

  const totalSeconds =
    Math.floor(ms / 1000);

  const hours =
    Math.floor(totalSeconds / 3600);

  const minutes =
    Math.floor(
      (totalSeconds % 3600) / 60
    );

  const seconds =
    totalSeconds % 60;

  return (
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}`
  );
}


function msToPitTime(ms) {
  ms = Number(ms);

  if (!Number.isFinite(ms)) {
    return null;
  }

  const minutes =
    Math.floor(ms / 60000);

  const seconds =
    Math.floor(
      (ms % 60000) / 1000
    );

  const millis =
    Math.floor(ms % 1000);

  return (
    `${minutes}:` +
    `${String(seconds).padStart(2, "0")}.` +
    `${String(millis).padStart(3, "0")}`
  );
}


function parseDrivers(raw) {
  const drivers = new Map();

  const regex =
    /<driver\s+[^>]*id="(\d+)"[^>]*name="([^"]+)"/g;

  let match;

  while (
    (match = regex.exec(raw)) !== null
  ) {
    drivers.set(
      Number(match[1]),
      match[2]
    );
  }

  return drivers;
}


function parseLapRows(raw, raceId) {
  const rows = [];

  for (const lineRaw of raw.split("\n")) {
    const line = lineRaw.trim();

    const match =
      line.match(
        /^D(\d+)\.L0*(\d+)#(.+)$/
      );

    if (!match) {
      continue;
    }

    const parts =
      match[3].split("|");

    const milliseconds =
      Number(parts[3]);

    if (
      !Number.isFinite(milliseconds) ||
      milliseconds <= 0
    ) {
      continue;
    }

    rows.push({
      race_id: raceId,
      apex_id: String(match[1]),
      lap_number: Number(match[2]),
      lap_time: Number(
        (milliseconds / 1000).toFixed(3)
      ),
      received_at:
        new Date().toISOString()
    });
  }

  return rows;
}


function parsePitRows(
  raw,
  teamName,
  raceId
) {
  const drivers =
    parseDrivers(raw);

  const rows = [];

  for (const lineRaw of raw.split("\n")) {
    const line =
      lineRaw.trim();

    const match =
      line.match(
        /^D(\d+)\.P\d+#(.+)$/
      );

    if (!match) {
      continue;
    }

    const parts =
      match[2].split("|");

    const pitNumber =
      Number(parts[0]);

    const pitLap =
      Number(parts[1]);

    if (
      !Number.isFinite(pitNumber) ||
      !Number.isFinite(pitLap)
    ) {
      continue;
    }

    rows.push({
      race_id: raceId,
      apex_id: Number(match[1]),
      team_name: teamName || null,
      pit_number: pitNumber,
      pit_lap: pitLap,
      pit_hour: msToTime(parts[2]),
      on_track: msToTime(parts[5]),
      driver_name:
        drivers.get(
          Number(parts[7])
        ) || null,
      total_time: msToTime(parts[8]),
      pit_time: msToPitTime(parts[4]),
      updated_at:
        new Date().toISOString()
    });
  }

  return rows;
}


// ============================================================
// STATS
// ============================================================

function calculateStats(laps) {
  if (!laps.length) {
    return {
      validLaps: 0,
      sum: 0,
      sumSquares: 0,
      avg: null,
      best: null,
      bestLapNumber: null,
      worst: null,
      worstLapNumber: null,
      consistency: null
    };
  }

  let sum = 0;
  let sumSquares = 0;

  let best = null;
  let bestLapNumber = null;

  let worst = null;
  let worstLapNumber = null;

  for (const lap of laps) {
    const time =
      Number(lap.lap_time);

    if (
      !Number.isFinite(time) ||
      time <= 0
    ) {
      continue;
    }

    sum += time;
    sumSquares += time * time;

    if (
      best === null ||
      time < best
    ) {
      best = time;
      bestLapNumber =
        Number(lap.lap_number);
    }

    if (
      worst === null ||
      time > worst
    ) {
      worst = time;
      worstLapNumber =
        Number(lap.lap_number);
    }
  }

  const validLaps =
    laps.filter(
      lap =>
        Number.isFinite(
          Number(lap.lap_time)
        ) &&
        Number(lap.lap_time) > 0
    ).length;

  if (!validLaps) {
    return {
      validLaps: 0,
      sum: 0,
      sumSquares: 0,
      avg: null,
      best: null,
      bestLapNumber: null,
      worst: null,
      worstLapNumber: null,
      consistency: null
    };
  }

  const avg =
    sum / validLaps;

  const variance =
    Math.max(
      0,
      sumSquares / validLaps -
      avg * avg
    );

  return {
    validLaps,
    sum,
    sumSquares,
    avg,
    best,
    bestLapNumber,
    worst,
    worstLapNumber,
    consistency:
      Math.sqrt(variance)
  };
}


// ============================================================
// DURABLE OBJECT
// ============================================================

export class ApexCollector {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.raceId =
      defaultRaceId(env);

    this.ws = null;
    this.connecting = false;

    this.packetCount = 0;
    this.lastPacketAt = null;

    this.queue =
      Promise.resolve();

    this.detailRunning =
      new Set();

    this.lastDetailFetch =
      new Map();

    state.blockConcurrencyWhile(
      async () => {
        this.packetCount =
          await state.storage.get(
            "packetCount"
          ) || 0;

        this.lastPacketAt =
          await state.storage.get(
            "lastPacketAt"
          ) || null;

        if (
          await state.storage.getAlarm() ===
          null
        ) {
          await state.storage.setAlarm(
            Date.now() + 60000
          );
        }
      }
    );
  }


  // ==========================================================
  // DO HTTP
  // ==========================================================

  async fetch(request) {
    const url =
      new URL(request.url);

    if (
      url.pathname === "/start"
    ) {
      await this.connect();

      return json(
        await this.status()
      );
    }

    if (
      url.pathname === "/status"
    ) {
      return json(
        await this.status()
      );
    }

    if (
      url.pathname === "/reconnect"
    ) {
      try {
        this.ws?.close(
          1000,
          "manual reconnect"
        );
      } catch {}

      this.ws = null;
      this.connecting = false;

      await this.connect();

      return json(
        await this.status()
      );
    }

    return new Response(
      "Not found",
      {
        status: 404
      }
    );
  }


  async status() {
    return {
      race_id: this.raceId,

      connected:
        !!this.ws &&
        this.ws.readyState ===
          WebSocket.OPEN,

      connecting:
        this.connecting,

      packet_count:
        this.packetCount,

      last_packet_at:
        this.lastPacketAt
    };
  }


  // ==========================================================
  // WATCHDOG
  // ==========================================================

  async alarm() {
    const stale =
      !this.lastPacketAt ||
      Date.now() -
        Date.parse(this.lastPacketAt) >
        120000;

    if (
      !this.ws ||
      this.ws.readyState !==
        WebSocket.OPEN ||
      stale
    ) {
      try {
        this.ws?.close();
      } catch {}

      this.ws = null;
      this.connecting = false;

      await this.connect();
    }

    await this.state.storage.setAlarm(
      Date.now() + 60000
    );
  }


  // ==========================================================
  // WEBSOCKET
  // ==========================================================

  async connect() {
    if (
      this.connecting ||
      (
        this.ws &&
        (
          this.ws.readyState ===
            WebSocket.OPEN ||
          this.ws.readyState ===
            WebSocket.CONNECTING
        )
      )
    ) {
      return;
    }

    this.connecting = true;

    try {
      const ws =
        new WebSocket(
          this.env.APEX_WS_URL ||
          "wss://live-data.apex-timing.com:8913/"
        );

      this.ws = ws;

      ws.addEventListener(
        "open",
        () => {
          this.connecting = false;
        }
      );

      ws.addEventListener(
        "message",
        event => {
          const payload =
            typeof event.data === "string"
              ? event.data
              : new TextDecoder().decode(
                  event.data
                );

          this.queue =
            this.queue
              .then(
                () =>
                  this.handlePacket(
                    payload
                  )
              )
              .catch(error => {
                console.error(
                  "PACKET ERROR:",
                  error
                );
              });
        }
      );

      ws.addEventListener(
        "close",
        () => {
          this.ws = null;
          this.connecting = false;

          this.state.storage.setAlarm(
            Date.now() + 5000
          );
        }
      );

      ws.addEventListener(
        "error",
        error => {
          console.error(
            "APEX WS ERROR:",
            error
          );

          this.ws = null;
          this.connecting = false;

          this.state.storage.setAlarm(
            Date.now() + 5000
          );
        }
      );
    } catch (error) {
      this.ws = null;
      this.connecting = false;

      await this.state.storage.setAlarm(
        Date.now() + 5000
      );

      throw error;
    }
  }


  // ==========================================================
  // DB HELPERS
  // ==========================================================

  async getEntry(apexId) {
    const rows =
      await sbGet(
        this.env,
        "apex_entries",
        {
          select: "*",
          race_id:
            `eq.${this.raceId}`,
          apex_id:
            `eq.${apexId}`,
          limit: "1"
        }
      );

    return rows[0] || null;
  }


  async upsertEntry(update) {
    const existing =
      await this.getEntry(
        update.apex_id
      );

    const row = {
      race_id:
        this.raceId,

      apex_id:
        String(update.apex_id),

      team_name:
        update.team_name !== undefined
          ? update.team_name
          : existing?.team_name ?? null,

      current_driver:
        update.current_driver !== undefined
          ? update.current_driver
          : existing?.current_driver ?? null,

      last_lap:
        update.last_lap !== undefined
          ? update.last_lap
          : existing?.last_lap ?? null,

      best_lap:
        update.best_lap !== undefined
          ? update.best_lap
          : existing?.best_lap ?? null,

      lap_count:
        update.lap_count !== undefined
          ? update.lap_count
          : existing?.lap_count ?? null,

      updated_at:
        new Date().toISOString()
    };

    await sbUpsert(
      this.env,
      "apex_entries",
      row,
      "race_id,apex_id"
    );
  }


  // ==========================================================
  // RAW PACKET
  // ==========================================================

  async saveRaw(payload) {
    await sbInsert(
      this.env,
      "apex_raw_packets",
      {
        race_id:
          this.raceId,
        payload
      }
    );
  }


  // ==========================================================
  // APEX DETAIL REQUEST 8910
  // ==========================================================

  async requestDetails(
    apexId,
    lapCount
  ) {
    const request =
      `D#-${lapCount}` +
      `#D${apexId}.L#-${lapCount}` +
      `#D${apexId}.P#-999` +
      `#D${apexId}.B#1` +
      `#D${apexId}.INF`;

    const response =
      await fetch(
        "https://live-data.apex-timing.com/live-timing/commonv2/functions/request.php",
        {
          method: "POST",

          headers: {
            "content-type":
              "application/x-www-form-urlencoded; charset=UTF-8"
          },

          body:
            new URLSearchParams({
              port:
                this.env.APEX_DETAIL_PORT ||
                "8910",

              request
            })
        }
      );

    if (!response.ok) {
      throw new Error(
        `Apex detail request failed: ${response.status}`
      );
    }

    return response.text();
  }


  // ==========================================================
  // SAVE FULL LAP HISTORY
  // ==========================================================

  async saveLapRows(rows) {
    if (!rows.length) {
      return;
    }

    const CHUNK = 250;

    for (
      let i = 0;
      i < rows.length;
      i += CHUNK
    ) {
      await sbUpsert(
        this.env,
        "apex_lap_events",
        rows.slice(
          i,
          i + CHUNK
        ),
        "race_id,apex_id,lap_number"
      );
    }
  }


  // ==========================================================
  // SAVE PITS
  // ==========================================================

  async savePitRows(rows) {
    if (!rows.length) {
      return;
    }

    await sbUpsert(
      this.env,
      "apex_pit_stints",
      rows,
      "race_id,apex_id,pit_number"
    );
  }


  // ==========================================================
  // REBUILD DRIVER STINTS FROM REAL APEX PITS
  // ==========================================================

  async rebuildDriverStints(
    apexId,
    entry,
    pits
  ) {
    if (!entry) {
      return null;
    }

    const sortedPits =
      [...pits]
        .filter(
          pit =>
            Number.isFinite(
              Number(pit.pit_lap)
            )
        )
        .sort(
          (a, b) =>
            Number(a.pit_number) -
            Number(b.pit_number)
        );

    const stints = [];

    let startLap = 0;

    for (const pit of sortedPits) {
      const pitLap =
        Number(pit.pit_lap);

      if (
        !Number.isFinite(pitLap)
      ) {
        continue;
      }

      if (pit.driver_name) {
        stints.push({
          race_id:
            this.raceId,

          apex_id:
            String(apexId),

          team_name:
            entry.team_name,

          driver_name:
            pit.driver_name,

          stint_start_at:
            new Date().toISOString(),

          stint_end_at:
            new Date().toISOString(),

          start_lap_count:
            startLap,

          end_lap_count:
            pitLap
        });
      }

      startLap =
        pitLap;
    }

    if (entry.current_driver) {
      stints.push({
        race_id:
          this.raceId,

        apex_id:
          String(apexId),

        team_name:
          entry.team_name,

        driver_name:
          entry.current_driver,

        stint_start_at:
          new Date().toISOString(),

        stint_end_at:
          null,

        start_lap_count:
          startLap,

        end_lap_count:
          null
      });
    }

    if (stints.length) {
      await sbDelete(
        this.env,
        "driver_stints",
        {
          race_id:
            `eq.${this.raceId}`,

          apex_id:
            `eq.${apexId}`
        }
      );

      await sbInsert(
        this.env,
        "driver_stints",
        stints
      );
    }

    return {
      startLap,
      stintNumber:
        sortedPits.length + 1
    };
  }


  // ==========================================================
  // MANUAL EXCLUSIONS
  // ==========================================================

  async getManualExclusions(
    apexId,
    startLap,
    endLap
  ) {
    try {
      const rows =
        await sbGet(
          this.env,
          "manual_lap_exclusions",
          {
            select:
              "lap_number",

            race_id:
              `eq.${this.raceId}`,

            apex_id:
              `eq.${apexId}`,

            lap_number:
              `gt.${startLap}`,

            order:
              "lap_number.asc"
          }
        );

      return new Set(
        rows
          .map(
            row =>
              Number(
                row.lap_number
              )
          )
          .filter(
            lap =>
              Number.isFinite(lap) &&
              lap <= endLap
          )
      );
    } catch (error) {
      console.error(
        "MANUAL EXCLUSION READ ERROR:",
        error
      );

      return new Set();
    }
  }


  // ==========================================================
  // CURRENT STINT — FULL REBUILD
  //
  // IMPORTANT:
  // This does NOT start counting at Worker deployment.
  //
  // Every refresh uses:
  //   1. real Apex pit history
  //   2. real Apex lap history
  //   3. current driver
  //   4. current lap count
  //
  // ==========================================================

  async rebuildCurrentLiveStint(
    apexId,
    entry,
    lapRows,
    pitRows
  ) {
    if (
      !entry ||
      !entry.current_driver
    ) {
      return;
    }

    const currentLapCount =
      Number(entry.lap_count);

    if (
      !Number.isFinite(
        currentLapCount
      ) ||
      currentLapCount <= 0
    ) {
      return;
    }

    const stintInfo =
      await this.rebuildDriverStints(
        apexId,
        entry,
        pitRows
      );

    const startLap =
      Number(
        stintInfo?.startLap || 0
      );

    const stintNumber =
      Number(
        stintInfo?.stintNumber || 1
      );

    const manualExclusions =
      await this.getManualExclusions(
        apexId,
        startLap,
        currentLapCount
      );

    const pitLapSet =
      new Set();

    for (const pit of pitRows) {
      const lap =
        Number(pit.pit_lap);

      if (!Number.isFinite(lap)) {
        continue;
      }

      // Pit-in lap.
      pitLapSet.add(lap);

      // Pit-out / first lap after pit.
      pitLapSet.add(lap + 1);
    }

    const currentStintLaps =
      lapRows
        .filter(row => {
          const lap =
            Number(
              row.lap_number
            );

          return (
            Number.isFinite(lap) &&
            lap > startLap &&
            lap <= currentLapCount
          );
        })
        .sort(
          (a, b) =>
            Number(a.lap_number) -
            Number(b.lap_number)
        );

    const validLaps =
      currentStintLaps.filter(
        row => {
          const lap =
            Number(
              row.lap_number
            );

          const time =
            Number(
              row.lap_time
            );

          if (
            !Number.isFinite(time) ||
            time <= 0
          ) {
            return false;
          }

          if (
            manualExclusions.has(lap)
          ) {
            return false;
          }

          if (
            pitLapSet.has(lap)
          ) {
            return false;
          }

          return true;
        }
      );

    const stats =
      calculateStats(
        validLaps
      );

    const lastLapRow =
      currentStintLaps.length
        ? currentStintLaps[
            currentStintLaps.length - 1
          ]
        : null;

    const now =
      new Date().toISOString();

    await sbUpsert(
      this.env,
      "live_stint_stats",
      {
        race_id:
          this.raceId,

        apex_id:
          String(apexId),

        team_name:
          entry.team_name,

        driver_name:
          entry.current_driver,

        start_lap_count:
          startLap,

        current_lap_count:
          currentLapCount,

        total_laps:
          currentStintLaps.length,

        valid_laps:
          stats.validLaps,

        lap_sum:
          stats.sum,

        lap_sum_squares:
          stats.sumSquares,

        last_lap:
          lastLapRow
            ? Number(
                lastLapRow.lap_time
              )
            : (
                Number.isFinite(
                  Number(entry.last_lap)
                )
                  ? Number(
                      entry.last_lap
                    )
                  : null
              ),

        avg_lap:
          stats.avg,

        best_lap:
          stats.best,

        best_lap_number:
          stats.bestLapNumber,

        worst_lap:
          stats.worst,

        worst_lap_number:
          stats.worstLapNumber,

        consistency:
          stats.consistency,

        stint_started_at:
          now,

        updated_at:
          now
      },
      "race_id,apex_id"
    );

    await this.state.storage.put(
      `stint:${apexId}`,
      {
        stintNumber,
        startLap,
        driver:
          entry.current_driver
      }
    );
  }


  // ==========================================================
  // DETAIL REFRESH
  // ==========================================================

  async refreshTeam(
    apexId,
    force = false
  ) {
    if (
      this.detailRunning.has(
        String(apexId)
      )
    ) {
      return;
    }

    const entry =
      await this.getEntry(
        apexId
      );

    if (!entry) {
      return;
    }

    const lapCount =
      Number(
        entry.lap_count || 0
      );

    if (
      !Number.isFinite(lapCount) ||
      lapCount <= 0
    ) {
      return;
    }

    const now =
      Date.now();

    const previous =
      this.lastDetailFetch.get(
        String(apexId)
      ) || 0;

    if (
      !force &&
      now - previous < 1500
    ) {
      return;
    }

    this.detailRunning.add(
      String(apexId)
    );

    this.lastDetailFetch.set(
      String(apexId),
      now
    );

    try {
      const raw =
        await this.requestDetails(
          apexId,
          lapCount
        );

      const lapRows =
        parseLapRows(
          raw,
          this.raceId
        );

      const pitRows =
        parsePitRows(
          raw,
          entry.team_name,
          this.raceId
        );

      await this.saveLapRows(
        lapRows
      );

      await this.savePitRows(
        pitRows
      );

      const refreshedEntry =
        await this.getEntry(
          apexId
        );

      await this.rebuildCurrentLiveStint(
        apexId,
        refreshedEntry || entry,
        lapRows,
        pitRows
      );
    } catch (error) {
      console.error(
        "DETAIL REFRESH ERROR:",
        apexId,
        error
      );
    } finally {
      this.detailRunning.delete(
        String(apexId)
      );
    }
  }


  // ==========================================================
  // CLOSE LIVE STINT
  // ==========================================================

  async closeLiveStint(
    apexId,
    newDriver
  ) {
    const rows =
      await sbGet(
        this.env,
        "live_stint_stats",
        {
          select: "*",

          race_id:
            `eq.${this.raceId}`,

          apex_id:
            `eq.${apexId}`,

          limit: "1"
        }
      );

    const live =
      rows[0];

    if (
      !live ||
      !live.driver_name ||
      live.driver_name ===
        newDriver
    ) {
      return;
    }

    await sbInsert(
      this.env,
      "completed_stint_stats",
      {
        race_id:
          this.raceId,

        apex_id:
          String(apexId),

        team_name:
          live.team_name,

        driver_name:
          live.driver_name,

        start_lap_count:
          live.start_lap_count,

        end_lap_count:
          live.current_lap_count,

        total_laps:
          live.total_laps,

        valid_laps:
          live.valid_laps,

        avg_lap:
          live.avg_lap,

        best_lap:
          live.best_lap,

        best_lap_number:
          live.best_lap_number,

        worst_lap:
          live.worst_lap,

        worst_lap_number:
          live.worst_lap_number,

        consistency:
          live.consistency,

        stint_started_at:
          live.stint_started_at,

        stint_ended_at:
          new Date().toISOString()
      }
    );

    await sbDelete(
      this.env,
      "live_stint_stats",
      {
        race_id:
          `eq.${this.raceId}`,

        apex_id:
          `eq.${apexId}`
      }
    );
  }


  // ==========================================================
  // DRIVER CHANGE
  // ==========================================================

  async handleDriverChange(
    apexId,
    driverName
  ) {
    if (!driverName) {
      return;
    }

    const before =
      await this.getEntry(
        apexId
      );

    if (!before) {
      await this.upsertEntry({
        apex_id:
          apexId,

        current_driver:
          driverName
      });

      return;
    }

    if (
      before.current_driver ===
      driverName
    ) {
      return;
    }

    // First make sure the OLD stint is fully rebuilt from Apex.
    if (
      Number(before.lap_count) > 0
    ) {
      await this.refreshTeam(
        apexId,
        true
      );
    }

    // Snapshot old driver before changing current_driver.
    await this.closeLiveStint(
      apexId,
      driverName
    );

    await this.upsertEntry({
      apex_id:
        apexId,

      current_driver:
        driverName
    });

    // Re-fetch Apex detail after the driver change so the new
    // current stint boundary comes from the real pit history.
    await this.refreshTeam(
      apexId,
      true
    );
  }


  // ==========================================================
  // LAP COUNT UPDATE
  // ==========================================================

  async handleLapCount(
    apexId,
    newLapCount
  ) {
    if (
      !Number.isFinite(
        Number(newLapCount)
      )
    ) {
      return;
    }

    const entry =
      await this.getEntry(
        apexId
      );

    const oldLapCount =
      Number(
        entry?.lap_count ?? -1
      );

    await this.upsertEntry({
      apex_id:
        apexId,

      lap_count:
        Number(newLapCount)
    });

    /*
     * IMPORTANT:
     *
     * We DO NOT calculate the stint from entry.last_lap.
     *
     * A real Apex detail refresh is performed instead.
     * That rebuilds the current stint from full .L + .P data.
     */

    if (
      oldLapCount !==
      Number(newLapCount)
    ) {
      await this.refreshTeam(
        apexId,
        true
      );
    }
  }


  // ==========================================================
  // LIVE PACKET PARSER
  // ==========================================================

  async parseAndSave(payload) {
    const lines =
      payload.split("\n");

    for (const rawLine of lines) {
      const parsed =
        parseApexLine(
          rawLine.trim()
        );

      if (!parsed) {
        continue;
      }

      const {
        apexId,
        field,
        value,
        column
      } = parsed;


      // --------------------------------------------------------
      // TEAM NAME
      // --------------------------------------------------------

      if (field === "dr") {
        await this.upsertEntry({
          apex_id:
            apexId,

          team_name:
            value
        });

        continue;
      }


      // --------------------------------------------------------
      // CURRENT DRIVER
      // --------------------------------------------------------

      if (field === "drteam") {
        const driverName =
          value
            .replace(
              /\s*\[[^\]]+\]\s*$/,
              ""
            )
            .trim();

        await this.handleDriverChange(
          apexId,
          driverName
        );

        continue;
      }


      // --------------------------------------------------------
      // LAST LAP
      // --------------------------------------------------------

      if (
        field === "tn" &&
        column === "9"
      ) {
        const lapTime =
          parseLapTime(
            value
          );

        if (lapTime !== null) {
          await this.upsertEntry({
            apex_id:
              apexId,

            last_lap:
              lapTime
          });
        }

        continue;
      }


      // --------------------------------------------------------
      // LAP COUNT
      // --------------------------------------------------------

      if (
        field === "in" &&
        column === "13" &&
        /^\d+$/.test(value)
      ) {
        await this.handleLapCount(
          apexId,
          Number(value)
        );

        continue;
      }
    }
  }


  // ==========================================================
  // PACKET
  // ==========================================================

  async handlePacket(payload) {
    this.packetCount += 1;

    this.lastPacketAt =
      new Date().toISOString();

    await this.saveRaw(
      payload
    );

    await this.parseAndSave(
      payload
    );

    if (
      this.packetCount % 20 ===
      0
    ) {
      await this.state.storage.put({
        packetCount:
          this.packetCount,

        lastPacketAt:
          this.lastPacketAt
      });
    }
  }
}


// ============================================================
// COLLECTOR ACCESS
// ============================================================

function collectorStub(env) {
  const id =
    env.APEX_COLLECTOR.idFromName(
      "primary"
    );

  return env.APEX_COLLECTOR.get(
    id
  );
}


async function startCollector(env) {
  const response =
    await collectorStub(env).fetch(
      "https://collector/start"
    );

  return response.json();
}


// ============================================================
// LIVE API
// ============================================================

async function livePayload(
  env,
  raceId
) {
  const entries =
    await sbGet(
      env,
      "apex_entries",
      {
        select: "*",

        race_id:
          `eq.${raceId}`,

        order:
          "updated_at.desc"
      }
    );

  const newestTimestamp =
    entries.reduce(
      (latest, entry) => {
        const t =
          Date.parse(
            entry.updated_at || ""
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

  const LIVE_TIMEOUT_MS =
    3 * 60 * 1000;

  if (
    !newestTimestamp ||
    Date.now() -
      newestTimestamp >
      LIVE_TIMEOUT_MS
  ) {
    return {
      race_id:
        Number(raceId),

      generated_at:
        new Date().toISOString(),

      active:
        false,

      current:
        [],

      entries:
        []
    };
  }

  const CURRENT_FIELD_WINDOW_MS =
    3 * 60 * 1000;

  const activeEntries =
    entries.filter(entry => {
      const t =
        Date.parse(
          entry.updated_at || ""
        );

      return (
        Number.isFinite(t) &&
        newestTimestamp - t <=
          CURRENT_FIELD_WINDOW_MS
      );
    });

  const activeIds =
    new Set(
      activeEntries.map(
        entry =>
          String(entry.apex_id)
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

  const liveStints =
    await sbGet(
      env,
      "live_stint_stats",
      {
        select: "*",

        race_id:
          `eq.${raceId}`,

        order:
          "team_name.asc"
      }
    );

  const current = [];

  for (const stint of liveStints) {
    const apexId =
      String(
        stint.apex_id
      );

    if (
      !activeIds.has(apexId)
    ) {
      continue;
    }

    const entry =
      entryMap.get(apexId) || {};

    current.push({
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

      /*
       * This is CURRENT STINT lap count.
       * NOT the team's total race laps.
       */
      lap_count:
        stint.valid_laps ??
        0,

      total_stint_laps:
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
        entry.last_lap ??
        stint.last_lap ??
        null,

      live_best_lap:
        stint.best_lap ??
        entry.best_lap ??
        null,

      /*
       * Team's real current Apex lap number.
       */
      live_lap_count:
        entry.lap_count ??
        stint.current_lap_count ??
        null,

      updated_at:
        stint.updated_at ??
        entry.updated_at ??
        null
    });
  }

  const seen =
    new Set(
      current.map(
        row =>
          String(row.apex_id)
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

      total_stint_laps:
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
      new Date().toISOString(),

    active:
      true,

    current,

    entries:
      activeEntries
  };
}


// ============================================================
// STINTS API
// ============================================================

async function stintsPayload(
  env,
  raceId
) {
  const completed =
    await sbGet(
      env,
      "completed_stint_stats",
      {
        select: "*",

        race_id:
          `eq.${raceId}`,

        order:
          "stint_ended_at.asc"
      }
    );

  const live =
    await sbGet(
      env,
      "live_stint_stats",
      {
        select: "*",

        race_id:
          `eq.${raceId}`,

        order:
          "team_name.asc"
      }
    );

  return [
    ...completed,

    ...live.map(row => ({
      ...row,

      is_live:
        true,

      end_lap_count:
        null,

      lap_count:
        row.valid_laps ??
        0,

      avg_lap_time:
        row.avg_lap ??
        null,

      best_lap_time:
        row.best_lap ??
        null,

      worst_lap_time:
        row.worst_lap ??
        null
    }))
  ];
}


// ============================================================
// RACES API
// ============================================================

async function racesPayload(env) {
  const rows =
    await sbGet(
      env,
      "apex_entries",
      {
        select:
          "race_id,updated_at",

        order:
          "updated_at.desc"
      }
    );

  const map =
    new Map();

  for (const row of rows) {
    const id =
      Number(
        row.race_id
      );

    if (
      !Number.isFinite(id)
    ) {
      continue;
    }

    const timestamp =
      Date.parse(
        row.updated_at || ""
      );

    const previous =
      map.get(id);

    if (
      !previous ||
      timestamp >
        previous.timestamp
    ) {
      map.set(
        id,
        {
          timestamp,
          updated_at:
            row.updated_at
        }
      );
    }
  }

  return {
    rows:
      [...map.entries()]
        .map(
          ([id, data]) => ({
            id,
            race_id:
              id,

            name:
              `Race ${id}`,

            updated_at:
              data.updated_at
          })
        )
        .sort(
          (a, b) =>
            Date.parse(
              b.updated_at || ""
            ) -
            Date.parse(
              a.updated_at || ""
            )
        )
  };
}


// ============================================================
// WORKER
// ============================================================

export default {
  async fetch(
    request,
    env,
    ctx
  ) {
    const url =
      new URL(request.url);

    try {
      // ------------------------------------------------------
      // HEALTH
      // ------------------------------------------------------

      if (
        url.pathname ===
        "/api/health"
      ) {
        ctx.waitUntil(
          startCollector(env)
            .catch(
              console.error
            )
        );

        return json({
          ok: true,

          service:
            "race-engineer",

          now:
            new Date().toISOString()
        });
      }


      // ------------------------------------------------------
      // COLLECTOR START
      // ------------------------------------------------------

      if (
        url.pathname ===
        "/api/collector/start"
      ) {
        return json(
          await startCollector(
            env
          )
        );
      }


      // ------------------------------------------------------
      // COLLECTOR STATUS
      // ------------------------------------------------------

      if (
        url.pathname ===
        "/api/collector/status"
      ) {
        const response =
          await collectorStub(env)
            .fetch(
              "https://collector/status"
            );

        return new Response(
          await response.text(),
          {
            headers: {
              "content-type":
                "application/json; charset=utf-8"
            }
          }
        );
      }


      // ------------------------------------------------------
      // COLLECTOR RECONNECT
      // ------------------------------------------------------

      if (
        url.pathname ===
        "/api/collector/reconnect"
      ) {
        const response =
          await collectorStub(env)
            .fetch(
              "https://collector/reconnect"
            );

        return new Response(
          await response.text(),
          {
            headers: {
              "content-type":
                "application/json; charset=utf-8"
            }
          }
        );
      }


      const raceId =
        requestedRaceId(
          url,
          env
        );


      // ------------------------------------------------------
      // LIVE
      // ------------------------------------------------------

      if (
        url.pathname ===
        "/api/live"
      ) {
        ctx.waitUntil(
          startCollector(env)
            .catch(
              console.error
            )
        );

        return json(
          await livePayload(
            env,
            raceId
          )
        );
      }


      // ------------------------------------------------------
      // RACES
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


      // ------------------------------------------------------
      // STINTS
      // ------------------------------------------------------

      if (
        url.pathname ===
        "/api/stints"
      ) {
        return json({
          race_id:
            Number(raceId),

          rows:
            await stintsPayload(
              env,
              raceId
            )
        });
      }


      // ------------------------------------------------------
      // DRIVERS
      // ------------------------------------------------------

      if (
        url.pathname ===
        "/api/drivers"
      ) {
        return json({
          race_id:
            Number(raceId),

          rows:
            await sbGet(
              env,
              "driver_lap_totals_clean",
              {
                select: "*",

                race_id:
                  `eq.${raceId}`,

                order:
                  "team_name.asc,driver_name.asc"
              }
            )
        });
      }


      // ------------------------------------------------------
      // PITS
      // ------------------------------------------------------

      if (
        url.pathname ===
        "/api/pits"
      ) {
        return json({
          race_id:
            Number(raceId),

          rows:
            await sbGet(
              env,
              "apex_pit_stints",
              {
                select: "*",

                race_id:
                  `eq.${raceId}`,

                order:
                  "apex_id.asc,pit_number.asc"
              }
            )
        });
      }


      // ------------------------------------------------------
      // STATIC FRONTEND
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
  },


  // ==========================================================
  // CLOUDFLARE CRON
  // ==========================================================

  async scheduled(
    controller,
    env,
    ctx
  ) {
    ctx.waitUntil(
      startCollector(env)
        .catch(
          console.error
        )
    );
  }
};
