function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}

function raceId(env) {
  const n = Number(env.DEFAULT_RACE_ID || 1);

  return Number.isFinite(n) && n > 0
    ? Math.trunc(n)
    : 1;
}

function sbHeaders(env, extra = {}) {
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

async function sbGet(
  env,
  table,
  params = {}
) {
  const url =
    new URL(
      `/rest/v1/${table}`,
      env.SUPABASE_URL
    );

  for (const [key, value] of Object.entries(params)) {
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

  const response =
    await fetch(
      url,
      {
        headers:
          sbHeaders(
            env,
            {
              accept: "application/json"
            }
          )
      }
    );

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
  const url =
    new URL(
      `/rest/v1/${table}`,
      env.SUPABASE_URL
    );

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(
      key,
      value
    );
  }

  const response =
    await fetch(
      url,
      {
        method,
        headers:
          sbHeaders(
            env,
            {
              Prefer: prefer
            }
          ),
        body:
          body === undefined
            ? undefined
            : JSON.stringify(body)
      }
    );

  if (!response.ok) {
    throw new Error(
      `Supabase ${method} ${table}: ${response.status} ${await response.text()}`
    );
  }
}

const sbInsert = (
  env,
  table,
  body
) =>
  sbWrite(
    env,
    table,
    "POST",
    body,
    {},
    "return=minimal"
  );

const sbUpsert = (
  env,
  table,
  body,
  conflict
) =>
  sbWrite(
    env,
    table,
    "POST",
    body,
    {
      on_conflict: conflict
    },
    "resolution=merge-duplicates,return=minimal,missing=default"
  );

const sbPatch = (
  env,
  table,
  body,
  filters
) =>
  sbWrite(
    env,
    table,
    "PATCH",
    body,
    filters,
    "return=minimal"
  );

const sbDelete = (
  env,
  table,
  filters
) =>
  sbWrite(
    env,
    table,
    "DELETE",
    undefined,
    filters,
    "return=minimal"
  );


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
    const [minutes, seconds] =
      value.split(":");

    const result =
      Number(minutes) * 60 +
      Number(seconds);

    return Number.isFinite(result)
      ? result
      : null;
  }

  const result =
    Number(value);

  return Number.isFinite(result)
    ? result
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
    Math.floor(
      totalSeconds / 3600
    );

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

  const totalSeconds =
    Math.floor(ms / 1000);

  const minutes =
    Math.floor(
      totalSeconds / 60
    );

  const seconds =
    String(
      totalSeconds % 60
    ).padStart(
      2,
      "0"
    );

  const milliseconds =
    String(
      ms % 1000
    ).padStart(
      3,
      "0"
    );

  return `${minutes}:${seconds}.${milliseconds}`;
}


function parseDrivers(raw) {
  const drivers =
    new Map();

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


function parseLapRows(
  raw,
  currentRaceId
) {
  return raw
    .split("\n")
    .map(
      line =>
        line.trim()
    )
    .map(
      line => {
        const match =
          line.match(
            /^D(\d+)\.L0*(\d+)#(.+)$/
          );

        if (!match) {
          return null;
        }

        const parts =
          match[3].split("|");

        const lapTimeMs =
          Number(parts[3]);

        if (
          !Number.isFinite(
            lapTimeMs
          )
        ) {
          return null;
        }

        return {
          race_id:
            currentRaceId,

          apex_id:
            String(match[1]),

          lap_number:
            Number(match[2]),

          lap_time:
            Number(
              (
                lapTimeMs /
                1000
              ).toFixed(3)
            ),

          received_at:
            new Date()
              .toISOString()
        };
      }
    )
    .filter(Boolean);
}


function parsePits(
  raw,
  teamName,
  currentRaceId
) {
  const drivers =
    parseDrivers(raw);

  return raw
    .split("\n")
    .map(
      line =>
        line.trim()
    )
    .map(
      line => {
        const match =
          line.match(
            /^D(\d+)\.P\d+#(.+)$/
          );

        if (!match) {
          return null;
        }

        const parts =
          match[2].split("|");

        return {
          race_id:
            currentRaceId,

          apex_id:
            Number(match[1]),

          team_name:
            teamName,

          pit_number:
            Number(parts[0]),

          pit_lap:
            Number(parts[1]),

          pit_hour:
            msToTime(
              parts[2]
            ),

          on_track:
            msToTime(
              parts[5]
            ),

          driver_name:
            drivers.get(
              Number(parts[7])
            ) || null,

          total_time:
            msToTime(
              parts[8]
            ),

          pit_time:
            msToPitTime(
              parts[4]
            ),

          updated_at:
            new Date()
              .toISOString()
        };
      }
    )
    .filter(Boolean);
}


export class ApexCollector {

  constructor(
    state,
    env
  ) {
    this.state =
      state;

    this.env =
      env;

    this.rid =
      raceId(env);

    this.ws =
      null;

    this.connecting =
      false;

    this.queue =
      Promise.resolve();

    this.lastPacketAt =
      null;

    this.packetCount =
      0;

    state.blockConcurrencyWhile(
      async () => {
        this.lastPacketAt =
          await state.storage.get(
            "lastPacketAt"
          ) || null;

        this.packetCount =
          await state.storage.get(
            "packetCount"
          ) || 0;

        if (
          await state.storage.getAlarm() ===
          null
        ) {
          await state.storage.setAlarm(
            Date.now() +
            60000
          );
        }
      }
    );
  }


  async fetch(request) {
    const path =
      new URL(
        request.url
      ).pathname;

    if (
      path === "/start"
    ) {
      await this.connect();

      return json(
        await this.status()
      );
    }

    if (
      path === "/status"
    ) {
      return json(
        await this.status()
      );
    }

    if (
      path === "/reconnect"
    ) {
      try {
        this.ws?.close(
          1000,
          "reconnect"
        );
      } catch {}

      this.ws =
        null;

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
      race_id:
        this.rid,

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


  async alarm() {
    const stale =
      !this.lastPacketAt ||
      Date.now() -
        Date.parse(
          this.lastPacketAt
        ) >
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

      this.ws =
        null;

      await this.connect();
    }

    await this.state.storage.setAlarm(
      Date.now() +
      60000
    );
  }


  async connect() {
    if (
      this.connecting ||
      (
        this.ws &&
        [
          WebSocket.OPEN,
          WebSocket.CONNECTING
        ].includes(
          this.ws.readyState
        )
      )
    ) {
      return;
    }

    this.connecting =
      true;

    try {
      const ws =
        new WebSocket(
          this.env.APEX_WS_URL ||
          "wss://live-data.apex-timing.com:8913/"
        );

      this.ws =
        ws;

      ws.addEventListener(
        "open",
        () => {
          this.connecting =
            false;
        }
      );

      ws.addEventListener(
        "message",
        event => {
          const payload =
            typeof event.data ===
              "string"
              ? event.data
              : new TextDecoder()
                  .decode(
                    event.data
                  );

          this.queue =
            this.queue
              .then(
                () =>
                  this.packet(
                    payload
                  )
              )
              .catch(
                error =>
                  console.error(
                    "PACKET ERROR:",
                    error
                  )
              );
        }
      );

      ws.addEventListener(
        "close",
        () => {
          this.ws =
            null;

          this.connecting =
            false;

          this.state.storage.setAlarm(
            Date.now() +
            5000
          );
        }
      );

      ws.addEventListener(
        "error",
        () => {
          this.ws =
            null;

          this.connecting =
            false;

          this.state.storage.setAlarm(
            Date.now() +
            5000
          );
        }
      );

    } catch (error) {
      this.ws =
        null;

      this.connecting =
        false;

      await this.state.storage.setAlarm(
        Date.now() +
        5000
      );

      throw error;
    }
  }


  async packet(payload) {
    this.packetCount++;

    this.lastPacketAt =
      new Date()
        .toISOString();

    await sbInsert(
      this.env,
      "apex_raw_packets",
      {
        race_id:
          this.rid,

        payload
      }
    );

    await this.parseAndSave(
      payload
    );

    if (
      this.packetCount %
        20 ===
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


  async entry(apexId) {
    const rows =
      await sbGet(
        this.env,
        "apex_entries",
        {
          select: "*",

          race_id:
            `eq.${this.rid}`,

          apex_id:
            `eq.${apexId}`,

          limit: "1"
        }
      );

    return rows[0] ||
      null;
  }


  async upsertEntry(update) {
    await sbUpsert(
      this.env,
      "apex_entries",
      {
        race_id:
          this.rid,

        ...update,

        updated_at:
          new Date()
            .toISOString()
      },
      "race_id,apex_id"
    );
  }


  async closeStint(stint) {
    await sbInsert(
      this.env,
      "completed_stint_stats",
      {
        race_id:
          this.rid,

        apex_id:
          String(
            stint.apex_id
          ),

        team_name:
          stint.team_name,

        driver_name:
          stint.driver_name,

        start_lap_count:
          stint.start_lap_count,

        end_lap_count:
          stint.current_lap_count,

        total_laps:
          stint.total_laps,

        valid_laps:
          stint.valid_laps,

        avg_lap:
          stint.avg_lap,

        best_lap:
          stint.best_lap,

        best_lap_number:
          stint.best_lap_number,

        worst_lap:
          stint.worst_lap,

        worst_lap_number:
          stint.worst_lap_number,

        consistency:
          stint.consistency,

        stint_started_at:
          stint.stint_started_at,

        stint_ended_at:
          new Date()
            .toISOString()
      }
    );

    await sbDelete(
      this.env,
      "live_stint_stats",
      {
        race_id:
          `eq.${this.rid}`,

        apex_id:
          `eq.${stint.apex_id}`
      }
    );
  }


  async driverChange(
    apexId,
    driverName
  ) {
    if (!driverName) {
      return;
    }

    const before =
      await this.entry(
        apexId
      );

    const live =
      await sbGet(
        this.env,
        "live_stint_stats",
        {
          select: "*",

          race_id:
            `eq.${this.rid}`,

          apex_id:
            `eq.${apexId}`,

          limit: "1"
        }
      );

    if (
      live[0] &&
      live[0].driver_name &&
      live[0].driver_name !==
        driverName
    ) {
      await this.closeStint(
        live[0]
      );
    }

    await this.upsertEntry({
      apex_id:
        apexId,

      current_driver:
        driverName
    });

    if (
      before?.lap_count
    ) {
      await this.fetchDetails(
        apexId,
        before.team_name
      );
    }
  }


  async processLap(
    apexId,
    lapNumber
  ) {
    const entry =
      await this.entry(
        apexId
      );

    if (!entry) {
      return;
    }

    const lapTime =
      Number(
        entry.last_lap
      );

    if (
      !Number.isFinite(
        lapTime
      )
    ) {
      return;
    }

    await sbUpsert(
      this.env,
      "apex_lap_events",
      {
        race_id:
          this.rid,

        apex_id:
          String(apexId),

        lap_number:
          Number(
            lapNumber
          ),

        lap_time:
          lapTime,

        received_at:
          new Date()
            .toISOString()
      },
      "race_id,apex_id,lap_number"
    );

    await this.liveStats(
      apexId,
      Number(lapNumber),
      lapTime,
      entry.team_name,
      entry.current_driver
    );
  }


  async liveStats(
    apexId,
    lapNumber,
    lapTime,
    teamName,
    driverName
  ) {
    if (!driverName) {
      return;
    }

    const rows =
      await sbGet(
        this.env,
        "live_stint_stats",
        {
          select: "*",

          race_id:
            `eq.${this.rid}`,

          apex_id:
            `eq.${apexId}`,

          limit: "1"
        }
      );

    const current =
      rows[0];

    const now =
      new Date()
        .toISOString();

    if (
      !current ||
      current.driver_name !==
        driverName
    ) {
      if (current) {
        await this.closeStint(
          current
        );
      }

      await sbUpsert(
        this.env,
        "live_stint_stats",
        {
          race_id:
            this.rid,

          apex_id:
            String(apexId),

          team_name:
            teamName,

          driver_name:
            driverName,

          start_lap_count:
            lapNumber,

          current_lap_count:
            lapNumber,

          total_laps:
            1,

          valid_laps:
            1,

          lap_sum:
            lapTime,

          lap_sum_squares:
            lapTime *
            lapTime,

          last_lap:
            lapTime,

          avg_lap:
            lapTime,

          best_lap:
            lapTime,

          best_lap_number:
            lapNumber,

          worst_lap:
            lapTime,

          worst_lap_number:
            lapNumber,

          consistency:
            0,

          stint_started_at:
            now,

          updated_at:
            now
        },
        "race_id,apex_id"
      );

      return;
    }

    if (
      current.current_lap_count !==
        null &&
      current.current_lap_count !==
        undefined &&
      lapNumber <=
        Number(
          current.current_lap_count
        )
    ) {
      return;
    }

    const validLaps =
      Number(
        current.valid_laps ||
        0
      ) + 1;

    const totalLaps =
      Number(
        current.total_laps ||
        0
      ) + 1;

    const lapSum =
      Number(
        current.lap_sum ||
        0
      ) +
      lapTime;

    const lapSumSquares =
      Number(
        current.lap_sum_squares ||
        0
      ) +
      lapTime *
      lapTime;

    const average =
      lapSum /
      validLaps;

    const consistency =
      Math.sqrt(
        Math.max(
          0,
          lapSumSquares /
            validLaps -
            average *
            average
        )
      );

    const isBest =
      current.best_lap ===
        null ||
      current.best_lap ===
        undefined ||
      lapTime <
        Number(
          current.best_lap
        );

    const isWorst =
      current.worst_lap ===
        null ||
      current.worst_lap ===
        undefined ||
      lapTime >
        Number(
          current.worst_lap
        );

    await sbPatch(
      this.env,
      "live_stint_stats",
      {
        team_name:
          teamName,

        driver_name:
          driverName,

        current_lap_count:
          lapNumber,

        total_laps:
          totalLaps,

        valid_laps:
          validLaps,

        lap_sum:
          lapSum,

        lap_sum_squares:
          lapSumSquares,

        last_lap:
          lapTime,

        avg_lap:
          average,

        best_lap:
          isBest
            ? lapTime
            : current.best_lap,

        best_lap_number:
          isBest
            ? lapNumber
            : current.best_lap_number,

        worst_lap:
          isWorst
            ? lapTime
            : current.worst_lap,

        worst_lap_number:
          isWorst
            ? lapNumber
            : current.worst_lap_number,

        consistency,

        updated_at:
          now
      },
      {
        race_id:
          `eq.${this.rid}`,

        apex_id:
          `eq.${apexId}`
      }
    );
  }


  async fetchDetails(
    apexId,
    teamName
  ) {
    const entry =
      await this.entry(
        apexId
      );

    const lapCount =
      Number(
        entry?.lap_count ||
        0
      );

    if (!lapCount) {
      return;
    }

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
          method:
            "POST",

          headers: {
            "content-type":
              "application/x-www-form-urlencoded; charset=UTF-8"
          },

          body:
            new URLSearchParams({
              port:
                this.env
                  .APEX_DETAIL_PORT ||
                "8910",

              request
            })
        }
      );

    if (!response.ok) {
      throw new Error(
        `Apex detail ${response.status}`
      );
    }

    const raw =
      await response.text();

    const laps =
      parseLapRows(
        raw,
        this.rid
      );

    const pits =
      parsePits(
        raw,
        teamName,
        this.rid
      );

    if (
      laps.length
    ) {
      await sbUpsert(
        this.env,
        "apex_lap_events",
        laps,
        "race_id,apex_id,lap_number"
      );
    }

    if (
      pits.length
    ) {
      await sbUpsert(
        this.env,
        "apex_pit_stints",
        pits,
        "race_id,apex_id,pit_number"
      );
    }
  }


  async parseAndSave(payload) {
    for (
      const rawLine
      of payload.split("\n")
    ) {
      const parsed =
        parseApexLine(
          rawLine.trim()
        );

      if (!parsed) {
        continue;
      }

      if (
        parsed.field ===
        "dr"
      ) {
        await this.upsertEntry({
          apex_id:
            parsed.apexId,

          team_name:
            parsed.value
        });

        continue;
      }

      if (
        parsed.field ===
        "drteam"
      ) {
        const driverName =
          parsed.value
            .replace(
              /\s*\[[^\]]+\]\s*$/,
              " "
            )
            .trim();

        await this.driverChange(
          parsed.apexId,
          driverName
        );

        continue;
      }

      if (
        parsed.field ===
          "tn" &&
        parsed.column ===
          "9"
      ) {
        const lapTime =
          parseLapTime(
            parsed.value
          );

        if (
          lapTime !== null
        ) {
          await this.upsertEntry({
            apex_id:
              parsed.apexId,

            last_lap:
              lapTime
          });
        }

        continue;
      }

      if (
        parsed.field ===
          "in" &&
        parsed.column ===
          "13" &&
        /^\d+$/.test(
          parsed.value
        )
      ) {
        const newLapCount =
          Number(
            parsed.value
          );

        const entry =
          await this.entry(
            parsed.apexId
          );

        const oldLapCount =
          Number(
            entry?.lap_count ??
            -1
          );

        await this.upsertEntry({
          apex_id:
            parsed.apexId,

          lap_count:
            newLapCount
        });

        if (
          newLapCount >
            oldLapCount ||
          oldLapCount <
            0
        ) {
          await this.processLap(
            parsed.apexId,
            newLapCount
          );
        }
      }
    }
  }
}


function collectorStub(env) {
  const id =
    env.APEX_COLLECTOR
      .idFromName(
        "primary"
      );

  return env.APEX_COLLECTOR
    .get(id);
}


async function startCollector(env) {
  return (
    await collectorStub(
      env
    ).fetch(
      "https://collector/start"
    )
  ).json();
}


async function livePayload(
  env,
  currentRaceId
) {
  const entries =
    await sbGet(
      env,
      "apex_entries",
      {
        select: "*",

        race_id:
          `eq.${currentRaceId}`,

        order:
          "updated_at.desc"
      }
    );

  const newest =
    entries.reduce(
      (
        latest,
        entry
      ) =>
        Math.max(
          latest,
          Date.parse(
            entry.updated_at ||
            ""
          ) || 0
        ),
      0
    );

  if (
    !newest ||
    Date.now() -
      newest >
      180000
  ) {
    return {
      race_id:
        Number(
          currentRaceId
        ),

      generated_at:
        new Date()
          .toISOString(),

      active:
        false,

      current: [],

      entries: []
    };
  }

  const activeEntries =
    entries.filter(
      entry =>
        newest -
          (
            Date.parse(
              entry.updated_at ||
              ""
            ) ||
            0
          ) <=
        180000
    );

  const activeIds =
    new Set(
      activeEntries.map(
        entry =>
          String(
            entry.apex_id
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

  const live =
    await sbGet(
      env,
      "live_stint_stats",
      {
        select: "*",

        race_id:
          `eq.${currentRaceId}`,

        order:
          "team_name.asc"
      }
    );

  const current =
    [];

  for (
    const stint
    of live.filter(
      row =>
        activeIds.has(
          String(
            row.apex_id
          )
        )
    )
  ) {
    const entry =
      entryMap.get(
        String(
          stint.apex_id
        )
      ) || {};

    current.push({
      race_id:
        stint.race_id,

      apex_id:
        stint.apex_id,

      team_name:
        stint.team_name ??
        entry.team_name,

      driver_name:
        stint.driver_name ??
        entry.current_driver,

      current_driver:
        stint.driver_name ??
        entry.current_driver,

      start_lap_count:
        stint.start_lap_count,

      end_lap_count:
        null,

      lap_count:
        stint.valid_laps ??
        stint.total_laps ??
        0,

      valid_laps:
        stint.valid_laps ??
        0,

      total_laps:
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
    });
  }

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
        entry.team_name,

      driver_name:
        entry.current_driver,

      current_driver:
        entry.current_driver,

      start_lap_count:
        null,

      end_lap_count:
        null,

      lap_count:
        0,

      valid_laps:
        0,

      total_laps:
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
        entry.last_lap,

      live_best_lap:
        entry.best_lap,

      live_lap_count:
        entry.lap_count,

      updated_at:
        entry.updated_at
    });
  }

  current.sort(
    (a, b) =>
      String(
        a.team_name ||
        ""
      ).localeCompare(
        String(
          b.team_name ||
          ""
        )
      )
  );

  return {
    race_id:
      Number(
        currentRaceId
      ),

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


export default {

  async fetch(
    request,
    env,
    ctx
  ) {
    const url =
      new URL(
        request.url
      );

    try {

      if (
        url.pathname ===
        "/api/health"
      ) {
        ctx.waitUntil(
          startCollector(
            env
          ).catch(
            error =>
              console.error(
                error
              )
          )
        );

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


      if (
        url.pathname ===
        "/api/collector/status"
      ) {
        const response =
          await collectorStub(
            env
          ).fetch(
            "https://collector/status"
          );

        return new Response(
          await response.text(),
          {
            headers: {
              "content-type":
                "application/json"
            }
          }
        );
      }


      if (
        url.pathname ===
        "/api/collector/reconnect"
      ) {
        const response =
          await collectorStub(
            env
          ).fetch(
            "https://collector/reconnect"
          );

        return new Response(
          await response.text(),
          {
            headers: {
              "content-type":
                "application/json"
            }
          }
        );
      }


      const explicitRaceId =
        url.searchParams.get(
          "race_id"
        );

      const currentRaceId =
        explicitRaceId &&
        Number(
          explicitRaceId
        ) >
        0
          ? String(
              Math.trunc(
                Number(
                  explicitRaceId
                )
              )
            )
          : String(
              raceId(env)
            );


      if (
        url.pathname ===
        "/api/live"
      ) {
        ctx.waitUntil(
          startCollector(
            env
          ).catch(
            error =>
              console.error(
                error
              )
          )
        );

        return json(
          await livePayload(
            env,
            currentRaceId
          )
        );
      }


      if (
        url.pathname ===
        "/api/races"
      ) {
        return json({
          rows: []
        });
      }


      if (
        url.pathname ===
        "/api/stints"
      ) {
        const completed =
          await sbGet(
            env,
            "completed_stint_stats",
            {
              select: "*",

              race_id:
                `eq.${currentRaceId}`,

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
                `eq.${currentRaceId}`,

              order:
                "team_name.asc"
            }
          );

        return json({
          race_id:
            Number(
              currentRaceId
            ),

          rows: [
            ...completed,

            ...live.map(
              row => ({
                ...row,

                is_live:
                  true,

                end_lap_count:
                  null,

                avg_lap_time:
                  row.avg_lap,

                best_lap_time:
                  row.best_lap,

                worst_lap_time:
                  row.worst_lap,

                lap_count:
                  row.valid_laps ??
                  row.total_laps ??
                  0
              })
            )
          ]
        });
      }


      if (
        url.pathname ===
        "/api/drivers"
      ) {
        return json({
          race_id:
            Number(
              currentRaceId
            ),

          rows:
            await sbGet(
              env,
              "driver_lap_totals_clean",
              {
                select: "*",

                race_id:
                  `eq.${currentRaceId}`,

                order:
                  "team_name.asc,driver_name.asc"
              }
            )
        });
      }


      if (
        url.pathname ===
        "/api/pits"
      ) {
        return json({
          race_id:
            Number(
              currentRaceId
            ),

          rows:
            await sbGet(
              env,
              "apex_pit_stints",
              {
                select: "*",

                race_id:
                  `eq.${currentRaceId}`,

                order:
                  "apex_id.asc,pit_number.asc"
              }
            )
        });
      }


      return env.ASSETS.fetch(
        request
      );

    } catch (error) {
      console.error(
        "WORKER ERROR",
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


  async scheduled(
    controller,
    env,
    ctx
  ) {
    ctx.waitUntil(
      startCollector(
        env
      ).catch(
        error =>
          console.error(
            error
          )
      )
    );
  }
};
