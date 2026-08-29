function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function raceIdFromEnv(env) {
  const n = Number(env.DEFAULT_RACE_ID || 1);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
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

function supabaseHeaders(env, extra = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_KEY");
  }

  return {
    apikey: env.SUPABASE_KEY,
    authorization: `Bearer ${env.SUPABASE_KEY}`,
    "content-type": "application/json",
    ...extra
  };
}

async function supabase(env, path, params = {}) {
  const url = new URL(`/rest/v1/${path}`, env.SUPABASE_URL);

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
    headers: supabaseHeaders(env, {
      accept: "application/json"
    })
  });

  if (!res.ok) {
    throw new Error(
      `Supabase ${path}: ${res.status} ${await res.text()}`
    );
  }

  return res.json();
}

async function supabaseInsert(env, table, row) {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);

  const res = await fetch(url, {
    method: "POST",
    headers: supabaseHeaders(env, {
      Prefer: "return=minimal"
    }),
    body: JSON.stringify(row)
  });

  if (!res.ok) {
    throw new Error(
      `Supabase INSERT ${table}: ${res.status} ${await res.text()}`
    );
  }
}

async function supabaseUpsert(
  env,
  table,
  row,
  conflict
) {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);

  if (conflict) {
    url.searchParams.set("on_conflict", conflict);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: supabaseHeaders(env, {
      Prefer:
        "resolution=merge-duplicates,return=minimal,missing=default"
    }),
    body: JSON.stringify(row)
  });

  if (!res.ok) {
    throw new Error(
      `Supabase UPSERT ${table}: ${res.status} ${await res.text()}`
    );
  }
}


// ============================================================
// APEX PARSING
// ============================================================

function parseApexLine(line) {
  const match =
    line.match(/^r(\d+)(?:c(\d+))?\|([^|]+)\|(.*)$/);

  if (!match) return null;

  return {
    apexId: match[1],
    column: match[2] || null,
    field: match[3],
    value: match[4] || ""
  };
}

function parseLapTime(value) {
  if (!value) return null;

  if (value.includes(":")) {
    const [minutes, seconds] = value.split(":");

    const total =
      Number(minutes) * 60 +
      Number(seconds);

    return Number.isFinite(total)
      ? total
      : null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


// ============================================================
// DURABLE OBJECT — APEX COLLECTOR
// ============================================================

export class ApexCollector {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.ws = null;
    this.connecting = false;

    this.packetCount = 0;
    this.lastPacketAt = null;
    this.connectedAt = null;
    this.lastError = null;

    this.raceId = raceIdFromEnv(env);

    this.queue = Promise.resolve();

    this.state.blockConcurrencyWhile(async () => {
      this.packetCount =
        (await this.state.storage.get("packetCount")) || 0;

      this.lastPacketAt =
        (await this.state.storage.get("lastPacketAt")) || null;

      this.connectedAt =
        (await this.state.storage.get("connectedAt")) || null;

      this.lastError =
        (await this.state.storage.get("lastError")) || null;

      const alarm =
        await this.state.storage.getAlarm();

      if (alarm === null) {
        await this.state.storage.setAlarm(
          Date.now() + 60 * 1000
        );
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/start") {
      await this.ensureConnected();

      return json({
        ok: true,
        collector: await this.status()
      });
    }

    if (url.pathname === "/reconnect") {
      try {
        this.ws?.close(1000, "manual reconnect");
      } catch {}

      this.ws = null;

      await this.ensureConnected();

      return json({
        ok: true,
        collector: await this.status()
      });
    }

    if (url.pathname === "/status") {
      return json(await this.status());
    }

    return new Response("Not found", {
      status: 404
    });
  }

  async status() {
    return {
      race_id: this.raceId,

      connected:
        this.ws !== null &&
        this.ws.readyState === WebSocket.OPEN,

      connecting:
        this.connecting,

      packet_count:
        this.packetCount,

      connected_at:
        this.connectedAt,

      last_packet_at:
        this.lastPacketAt,

      last_error:
        this.lastError,

      apex_ws:
        this.env.APEX_WS_URL ||
        "wss://live-data.apex-timing.com:8913/"
    };
  }

  async alarm() {
    try {
      const stale =
        !this.lastPacketAt ||
        Date.now() -
          Date.parse(this.lastPacketAt) >
          2 * 60 * 1000;

      if (
        !this.ws ||
        this.ws.readyState !== WebSocket.OPEN ||
        stale
      ) {
        try {
          this.ws?.close(
            1000,
            "collector watchdog reconnect"
          );
        } catch {}

        this.ws = null;

        await this.ensureConnected();
      }
    } catch (error) {
      await this.recordError(
        `ALARM: ${error?.message || String(error)}`
      );
    } finally {
      await this.state.storage.setAlarm(
        Date.now() + 60 * 1000
      );
    }
  }

  async ensureConnected() {
    if (
      this.ws &&
      (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      )
    ) {
      return;
    }

    if (this.connecting) {
      return;
    }

    this.connecting = true;

    const apexUrl =
      this.env.APEX_WS_URL ||
      "wss://live-data.apex-timing.com:8913/";

    try {
      console.log(
        "APEX COLLECTOR CONNECTING:",
        apexUrl
      );

      const ws =
        new WebSocket(apexUrl);

      this.ws = ws;

      ws.addEventListener("open", () => {
        this.connectedAt =
          new Date().toISOString();

        this.lastError = null;
        this.connecting = false;

        this.state.storage.put(
          "connectedAt",
          this.connectedAt
        );

        this.state.storage.put(
          "lastError",
          null
        );

        console.log(
          "APEX COLLECTOR CONNECTED:",
          apexUrl
        );
      });

      ws.addEventListener("message", event => {
        const payload =
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data);

        /*
         * IMPORTANT:
         *
         * Messages are serialized deliberately.
         *
         * We do NOT allow 100 Apex packets to mutate the same
         * apex_entries rows concurrently.
         */
        this.queue = this.queue
          .then(() => this.processPacket(payload))
          .catch(async error => {
            await this.recordError(
              `PACKET: ${
                error?.message || String(error)
              }`
            );
          });
      });

      ws.addEventListener("close", event => {
        console.log(
          "APEX COLLECTOR CLOSED:",
          event.code,
          event.reason
        );

        this.ws = null;
        this.connecting = false;

        this.state.storage.setAlarm(
          Date.now() + 5000
        );
      });

      ws.addEventListener("error", () => {
        console.error(
          "APEX COLLECTOR WEBSOCKET ERROR"
        );

        this.ws = null;
        this.connecting = false;

        this.state.storage.setAlarm(
          Date.now() + 5000
        );
      });

    } catch (error) {
      this.ws = null;
      this.connecting = false;

      await this.recordError(
        `CONNECT: ${error?.message || String(error)}`
      );

      await this.state.storage.setAlarm(
        Date.now() + 5000
      );
    }
  }

  async recordError(message) {
    this.lastError = message;

    console.error(message);

    await this.state.storage.put(
      "lastError",
      message
    );
  }

  async processPacket(payload) {
    const now =
      new Date().toISOString();

    this.packetCount += 1;
    this.lastPacketAt = now;

    /*
     * First preserve the ORIGINAL Apex packet.
     *
     * Nothing in this stage modifies the payload.
     */
    await supabaseInsert(
      this.env,
      "apex_raw_packets",
      {
        race_id: this.raceId,
        payload
      }
    );

    /*
     * Then update current operational state.
     */
    await this.parseAndSave(payload, now);

    if (
      this.packetCount % 25 === 0
    ) {
      await this.state.storage.put({
        packetCount: this.packetCount,
        lastPacketAt: this.lastPacketAt
      });
    }
  }

  async parseAndSave(payload, now) {
    const lines =
      payload.split("\n");

    for (const rawLine of lines) {
      const line =
        rawLine.trim();

      if (!line) continue;

      const parsed =
        parseApexLine(line);

      if (!parsed) continue;

      const {
        apexId,
        field,
        value,
        column
      } = parsed;

      /*
       * TEAM NAME
       */
      if (field === "dr") {
        await this.upsertEntry({
          apex_id: apexId,
          team_name: value,
          updated_at: now
        });

        continue;
      }

      /*
       * CURRENT DRIVER
       */
      if (field === "drteam") {
        const driverName =
          value
            .replace(
              /\s*\[[^\]]+\]\s*$/,
              ""
            )
            .trim();

        await this.upsertEntry({
          apex_id: apexId,
          current_driver:
            driverName || null,
          updated_at: now
        });

        continue;
      }

      /*
       * ENDURANCE LAST LAP
       *
       * Keep the already validated mapping:
       * tn / c9.
       */
      if (
        field === "tn" &&
        column === "9"
      ) {
        const lapTime =
          parseLapTime(value);

        if (lapTime !== null) {
          await this.upsertEntry({
            apex_id: apexId,
            last_lap: lapTime,
            updated_at: now
          });
        }

        continue;
      }

      /*
       * LAP COUNT
       *
       * Keep the already validated mapping:
       * in / c13.
       *
       * IMPORTANT:
       * We do NOT reject a lower lap count here.
       *
       * race_id=1 has historically been reused and an old
       * apex_entries row can contain yesterday's final lap count.
       * Rejecting today's smaller value would leave the dashboard
       * stuck on yesterday forever.
       */
      if (
        field === "in" &&
        column === "13" &&
        /^\d+$/.test(value)
      ) {
        await this.upsertEntry({
          apex_id: apexId,
          lap_count: Number(value),
          updated_at: now
        });

        continue;
      }
    }
  }

  async upsertEntry(update) {
    await supabaseUpsert(
      this.env,
      "apex_entries",
      {
        race_id: this.raceId,
        ...update
      },
      "race_id,apex_id"
    );
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

  return env.APEX_COLLECTOR.get(id);
}

async function startCollector(env) {
  const stub =
    collectorStub(env);

  const response =
    await stub.fetch(
      "https://collector.internal/start"
    );

  if (!response.ok) {
    throw new Error(
      `Collector start failed: ${response.status}`
    );
  }

  return response.json();
}

async function collectorStatus(env) {
  const stub =
    collectorStub(env);

  const response =
    await stub.fetch(
      "https://collector.internal/status"
    );

  if (!response.ok) {
    throw new Error(
      `Collector status failed: ${response.status}`
    );
  }

  return response.json();
}


// ============================================================
// LIVE PAYLOAD
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
        select: "*",
        race_id: `eq.${raceId}`,
        order: "updated_at.desc"
      }
    );

  const now =
    Date.now();

  const newestTimestamp =
    entries.reduce(
      (latest, entry) => {
        const t =
          Date.parse(
            entry.updated_at || ""
          );

        return Number.isFinite(t)
          ? Math.max(latest, t)
          : latest;
      },
      0
    );

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
        new Date().toISOString(),

      active: false,
      current: [],
      entries: []
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

      if (!Number.isFinite(t)) {
        return false;
      }

      return (
        newestTimestamp - t <=
        CURRENT_FIELD_WINDOW_MS
      );
    });

  /*
   * live_stint_stats is optional for the first phase of
   * the cloud collector.
   *
   * The dashboard must still show Apex entries even when no
   * live stint snapshot has been generated yet.
   */
  let liveStints = [];

  try {
    liveStints =
      await supabase(
        env,
        "live_stint_stats",
        {
          select: "*",
          race_id: `eq.${raceId}`,
          order: "team_name.asc"
        }
      );
  } catch (error) {
    console.error(
      "LIVE STINT READ ERROR:",
      error
    );

    liveStints = [];
  }

  const activeApexIds =
    new Set(
      activeEntries.map(
        entry =>
          String(entry.apex_id)
      )
    );

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
    activeLiveStints.map(
      stint => {
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
            entry.last_lap ??
            stint.last_lap ??
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
            entry.updated_at ??
            stint.updated_at ??
            null
        };
      }
    );

  const seen =
    new Set(
      current.map(
        row =>
          String(row.apex_id)
      )
    );

  for (
    const entry
    of activeEntries
  ) {
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
    race_id:
      Number(raceId),

    generated_at:
      new Date().toISOString(),

    active: true,

    current,

    entries:
      activeEntries
  };
}


// ============================================================
// MAIN WORKER
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

      // ======================================================
      // HEALTH + COLLECTOR
      // ======================================================

      if (
        url.pathname ===
        "/api/health"
      ) {
        /*
         * Calling health also makes sure the singleton
         * collector has been started.
         */
        let collector = null;

        try {
          await startCollector(env);
          collector =
            await collectorStatus(env);
        } catch (error) {
          collector = {
            connected: false,
            error:
              error?.message ||
              String(error)
          };
        }

        return json({
          ok: true,
          service:
            "race-engineer",
          now:
            new Date().toISOString(),
          collector
        });
      }


      if (
        url.pathname ===
        "/api/collector/start"
      ) {
        return json(
          await startCollector(env)
        );
      }


      if (
        url.pathname ===
        "/api/collector/status"
      ) {
        return json(
          await collectorStatus(env)
        );
      }


      if (
        url.pathname ===
        "/api/collector/reconnect"
      ) {
        const stub =
          collectorStub(env);

        const response =
          await stub.fetch(
            "https://collector.internal/reconnect"
          );

        return new Response(
          await response.text(),
          {
            status:
              response.status,

            headers: {
              "content-type":
                "application/json; charset=utf-8",
              "cache-control":
                "no-store"
            }
          }
        );
      }


      const raceId =
        safeRaceId(
          url,
          env
        );


      // ======================================================
      // LIVE
      // ======================================================

      if (
        url.pathname ===
        "/api/live"
      ) {
        /*
         * A request for LIVE also wakes/starts the collector.
         * Do not wait for it before returning database state.
         */
        ctx.waitUntil(
          startCollector(env)
            .catch(error =>
              console.error(
                "COLLECTOR START ERROR:",
                error
              )
            )
        );

        return json(
          await livePayload(
            env,
            raceId
          )
        );
      }


      // ======================================================
      // RACES
      // ======================================================
      //
      // Keep this endpoint deliberately conservative for now.
      //
      // race_id has historically been reused as 1, so returning
      // fake separate races from distinct race_id values would
      // be incorrect.
      //
      // Real historical session separation will be based on
      // Start/Finish timestamps from apex_raw_packets.
      // ======================================================

      if (
        url.pathname ===
        "/api/races"
      ) {
        return json({
          races: [],
          warning:
            "Historical session indexing is not enabled yet."
        });
      }


      // ======================================================
      // STINTS
      // ======================================================

      if (
        url.pathname ===
        "/api/stints"
      ) {
        const rows =
          await supabase(
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

        return json({
          race_id:
            Number(raceId),
          rows
        });
      }


      // ======================================================
      // DRIVERS
      // ======================================================

      if (
        url.pathname ===
        "/api/drivers"
      ) {
        const rows =
          await supabase(
            env,
            "driver_lap_totals_clean",
            {
              select: "*",
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


      // ======================================================
      // PITS
      // ======================================================

      if (
        url.pathname ===
        "/api/pits"
      ) {
        const rows =
          await supabase(
            env,
            "apex_pit_stints",
            {
              select: "*",
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


      // ======================================================
      // STATIC UI
      // ======================================================

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
  // CRON WATCHDOG
  // ==========================================================

  async scheduled(
    controller,
    env,
    ctx
  ) {
    ctx.waitUntil(
      startCollector(env)
        .catch(error =>
          console.error(
            "SCHEDULED COLLECTOR ERROR:",
            error
          )
        )
    );
  }
};
