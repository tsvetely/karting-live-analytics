function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function defaultRaceId(env) {
  const value = Number(env.DEFAULT_RACE_ID || 1);

  return Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 1;
}

function requestedRaceId(url, env) {
  const raw =
    url.searchParams.get("race_id") ||
    env.DEFAULT_RACE_ID ||
    "1";

  const value = Number(raw);

  return Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 1;
}

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

async function sbGet(
  env,
  table,
  params = {}
) {
  const url = new URL(
    `/rest/v1/${table}`,
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

  const response =
    await fetch(
      url,
      {
        headers:
          supabaseHeaders(
            env,
            {
              accept:
                "application/json"
            }
          )
      }
    );

  if (!response.ok) {
    throw new Error(
      `Supabase GET ${table}: ` +
      `${response.status} ` +
      `${await response.text()}`
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

  const response =
    await fetch(
      url,
      {
        method,

        headers:
          supabaseHeaders(
            env,
            {
              Prefer:
                prefer
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
      `Supabase ${method} ${table}: ` +
      `${response.status} ` +
      `${await response.text()}`
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
      on_conflict:
        conflict
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

function parseProtocolLine(line) {
  const parts =
    String(line || "")
      .split("|");

  return {
    id:
      parts[0] || "",

    cls:
      parts[1] || "",

    value:
      parts
        .slice(2)
        .join("|")
  };
}

function parseRowId(id) {
  const match =
    /^r(\d+)(?:c(\d+))?$/
      .exec(id);

  if (!match) {
    return null;
  }

  return {
    apexId:
      match[1],

    column:
      match[2] || null
  };
}

function parseGridData(html) {
  const source =
    String(html || "");

  const positions =
    new Map();

  const columnTypes =
    new Map();

  const cellRegex =
    /<td\b[^>]*>/gi;

  let cellMatch;

  while (
    (
      cellMatch =
        cellRegex.exec(source)
    ) !== null
  ) {
    const tag =
      cellMatch[0];

    const idMatch =
      /data-id=["'](c\d+)["']/i
        .exec(tag);

    const typeMatch =
      /data-type=["']([^"']+)["']/i
        .exec(tag);

    if (
      idMatch &&
      typeMatch
    ) {
      columnTypes.set(
        idMatch[1],
        typeMatch[1]
      );
    }
  }

  const rowRegex =
    /<tr\b[^>]*>/gi;

  let rowMatch;

  while (
    (
      rowMatch =
        rowRegex.exec(source)
    ) !== null
  ) {
    const tag =
      rowMatch[0];

    const idMatch =
      /data-id=["']r(\d+)["']/i
        .exec(tag);

    const positionMatch =
      /data-pos=["'](\d+)["']/i
        .exec(tag);

    if (
      !idMatch ||
      !positionMatch
    ) {
      continue;
    }

    const position =
      Number(
        positionMatch[1]
      );

    if (
      !Number.isFinite(position) ||
      position <= 0
    ) {
      continue;
    }

    positions.set(
      String(idMatch[1]),
      position
    );
  }

  return {
    positions,
    columnTypes
  };
}

function parseLapTime(value) {
  if (!value) {
    return null;
  }

  if (value.includes(":")) {
    const parts =
      value.split(":");

    if (
      parts.length !== 2
    ) {
      return null;
    }

    const minutes =
      Number(parts[0]);

    const seconds =
      Number(parts[1]);

    return (
      Number.isFinite(minutes) &&
      Number.isFinite(seconds)
    )
      ? minutes * 60 + seconds
      : null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function msToTime(ms) {
  const value =
    Number(ms);

  if (
    !Number.isFinite(value)
  ) {
    return null;
  }

  const totalSeconds =
    Math.floor(
      value / 1000
    );

  const hours =
    Math.floor(
      totalSeconds / 3600
    );

  const minutes =
    Math.floor(
      (
        totalSeconds %
        3600
      ) /
      60
    );

  const seconds =
    totalSeconds %
    60;

  return (
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}`
  );
}

function msToPitTime(ms) {
  const value =
    Number(ms);

  if (
    !Number.isFinite(value)
  ) {
    return null;
  }

  const minutes =
    Math.floor(
      value / 60000
    );

  const seconds =
    Math.floor(
      (
        value %
        60000
      ) /
      1000
    );

  const millis =
    Math.floor(
      value % 1000
    );

  return (
    `${minutes}:` +
    `${String(seconds).padStart(2, "0")}.` +
    `${String(millis).padStart(3, "0")}`
  );
}

function parseDrivers(raw) {
  const drivers =
    new Map();

  const regex =
    /<driver\s+[^>]*id="(\d+)"[^>]*name="([^"]+)"/g;

  let match;

  while (
    (
      match =
        regex.exec(
          String(raw || "")
        )
    ) !== null
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
  raceId
) {
  const rows = [];

  for (
    const rawLine
    of String(raw || "")
      .split("\n")
  ) {
    const line =
      rawLine.trim();

    const match =
      /^D(\d+)\.L0*(\d+)#(.+)$/
        .exec(line);

    if (!match) {
      continue;
    }

    const parts =
      match[3]
        .split("|");

    const milliseconds =
      Number(parts[3]);

    if (
      !Number.isFinite(
        milliseconds
      ) ||
      milliseconds <= 0
    ) {
      continue;
    }

    rows.push({
      race_id:
        raceId,

      apex_id:
        String(match[1]),

      lap_number:
        Number(match[2]),

      lap_time:
        Number(
          (
            milliseconds /
            1000
          ).toFixed(3)
        ),

      received_at:
        new Date()
          .toISOString()
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

  for (
    const rawLine
    of String(raw || "")
      .split("\n")
  ) {
    const line =
      rawLine.trim();

    const match =
      /^D(\d+)\.P\d+#(.+)$/
        .exec(line);

    if (!match) {
      continue;
    }

    const parts =
      match[2]
        .split("|");

    const pitNumber =
      Number(parts[0]);

    const pitLap =
      Number(parts[1]);

    if (
      !Number.isFinite(
        pitNumber
      ) ||
      !Number.isFinite(
        pitLap
      )
    ) {
      continue;
    }

    rows.push({
      race_id:
        raceId,

      apex_id:
        Number(match[1]),

      team_name:
        teamName || null,

      pit_number:
        pitNumber,

      pit_lap:
        pitLap,

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
    });
  }

  return rows;
}

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

  let validLaps = 0;

  for (const lap of laps) {
    const time =
      Number(
        lap.lap_time
      );

    if (
      !Number.isFinite(time) ||
      time <= 0
    ) {
      continue;
    }

    validLaps += 1;

    sum += time;

    sumSquares +=
      time * time;

    if (
      best === null ||
      time < best
    ) {
      best =
        time;

      bestLapNumber =
        Number(
          lap.lap_number
        );
    }

    if (
      worst === null ||
      time > worst
    ) {
      worst =
        time;

      worstLapNumber =
        Number(
          lap.lap_number
        );
    }
  }

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
    sum /
    validLaps;

  const variance =
    Math.max(
      0,
      sumSquares /
        validLaps -
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
      Math.sqrt(
        variance
      )
  };
}

export class ApexCollector {
  constructor(state, env) {
    this.state =
      state;

    this.env =
      env;

    this.raceId =
      defaultRaceId(env);

    this.ws =
      null;

    this.connecting =
      false;

    this.queue =
      Promise.resolve();

    this.packetCount =
      0;

    this.lastPacketAt =
      null;

    this.positions =
      new Map();

    this.columnTypes =
      new Map();

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

        const storedPositions =
          await state.storage.get(
            "positions"
          ) || {};

        this.positions =
          new Map(
            Object.entries(
              storedPositions
            )
              .map(
                (
                  [
                    apexId,
                    value
                  ]
                ) => [
                  String(apexId),
                  Number(value)
                ]
              )
              .filter(
                (
                  [
                    ,
                    value
                  ]
                ) =>
                  Number.isFinite(
                    value
                  ) &&
                  value > 0
              )
          );

        const storedColumnTypes =
          await state.storage.get(
            "columnTypes"
          ) || {};

        this.columnTypes =
          new Map(
            Object.entries(
              storedColumnTypes
            )
          );

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
    const pathname =
      new URL(
        request.url
      ).pathname;

    if (
      pathname ===
      "/start"
    ) {
      await this.connect();

      return json(
        await this.status()
      );
    }

    if (
      pathname ===
      "/status"
    ) {
      return json(
        await this.status()
      );
    }

    if (
      pathname ===
      "/snapshot"
    ) {
      return json({
        ...(await this.status()),

        positions:
          Object.fromEntries(
            this.positions
          ),

        columnTypes:
          Object.fromEntries(
            this.columnTypes
          )
      });
    }

    if (
      pathname ===
      "/reconnect"
    ) {
      try {
        this.ws?.close(
          1000,
          "manual reconnect"
        );
      } catch {}

      this.ws =
        null;

      this.connecting =
        false;

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
        this.raceId,

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

  async persistState() {
    await this.state.storage.put({
      packetCount:
        this.packetCount,

      lastPacketAt:
        this.lastPacketAt,

      positions:
        Object.fromEntries(
          this.positions
        ),

      columnTypes:
        Object.fromEntries(
          this.columnTypes
        )
    });
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

      this.connecting =
        false;

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
                  this.handlePacket(
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

          this.state.storage
            .setAlarm(
              Date.now() +
              5000
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

          this.ws =
            null;

          this.connecting =
            false;

          this.state.storage
            .setAlarm(
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

      await this.state.storage
        .setAlarm(
          Date.now() +
          5000
        );

      throw error;
    }
  }

  async getEntry(apexId) {
    const rows =
      await sbGet(
        this.env,
        "apex_entries",
        {
          select:
            "*",

          race_id:
            `eq.${this.raceId}`,

          apex_id:
            `eq.${apexId}`,

          limit:
            "1"
        }
      );

    return rows[0] || null;
  }

  async upsertEntry(update) {
    const existing =
      await this.getEntry(
        update.apex_id
      );

    await sbUpsert(
      this.env,
      "apex_entries",
      {
        race_id:
          this.raceId,

        apex_id:
          String(
            update.apex_id
          ),

        team_name:
          update.team_name !==
          undefined
            ? update.team_name
            : existing
                ?.team_name ??
              null,

        current_driver:
          update.current_driver !==
          undefined
            ? update.current_driver
            : existing
                ?.current_driver ??
              null,

        last_lap:
          update.last_lap !==
          undefined
            ? update.last_lap
            : existing
                ?.last_lap ??
              null,

        best_lap:
          update.best_lap !==
          undefined
            ? update.best_lap
            : existing
                ?.best_lap ??
              null,

        lap_count:
          update.lap_count !==
          undefined
            ? update.lap_count
            : existing
                ?.lap_count ??
              null,

        updated_at:
          new Date()
            .toISOString()
      },
      "race_id,apex_id"
    );
  }

  async requestDetails(
    apexId,
    currentLapCount
  ) {
    const configured =
      Number(
        this.env
          .APEX_DETAIL_LAPS ||
        120
      );

    const historyCount =
      Math.max(
        1,
        Math.min(
          currentLapCount,
          (
            Number.isFinite(
              configured
            ) &&
            configured > 0
          )
            ? Math.trunc(
                configured
              )
            : 120
        )
      );

    const request =
      `D#-${historyCount}` +
      `#D${apexId}.L#-${historyCount}` +
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
        `Apex detail request failed: ${response.status}`
      );
    }

    return response.text();
  }

  async saveLapRows(rows) {
    const chunkSize =
      250;

    for (
      let index = 0;
      index < rows.length;
      index += chunkSize
    ) {
      await sbUpsert(
        this.env,
        "apex_lap_events",
        rows.slice(
          index,
          index +
          chunkSize
        ),
        "race_id,apex_id,lap_number"
      );
    }
  }

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
              Number.isFinite(
                lap
              ) &&
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

  async getValidatedRows(
    apexId,
    driverName,
    startLap,
    endLap
  ) {
    try {
      const rows =
        await sbGet(
          this.env,
          "valid_driver_laps",
          {
            select:
              "*",

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

      return rows.filter(
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
            !Number.isFinite(
              lap
            ) ||
            lap > endLap
          ) {
            return false;
          }

          if (
            !Number.isFinite(
              time
            ) ||
            time <= 0
          ) {
            return false;
          }

          if (
            row.driver_name &&
            driverName &&
            row.driver_name !==
              driverName
          ) {
            return false;
          }

          return true;
        }
      );
    } catch (error) {
      console.error(
        "VALID LAP VIEW READ ERROR:",
        error
      );

      return null;
    }
  }

  async syncDriverStints(
    apexId,
    entry,
    pitRows
  ) {
    const sortedPits =
      [...pitRows]
        .filter(
          pit =>
            Number.isFinite(
              Number(
                pit.pit_lap
              )
            )
        )
        .sort(
          (a, b) =>
            Number(
              a.pit_number
            ) -
            Number(
              b.pit_number
            )
        );

    const stints = [];

    let startLap = 0;

    for (
      const pit
      of sortedPits
    ) {
      const pitLap =
        Number(
          pit.pit_lap
        );

      if (
        pit.driver_name
      ) {
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
            new Date()
              .toISOString(),

          stint_end_at:
            new Date()
              .toISOString(),

          start_lap_count:
            startLap,

          end_lap_count:
            pitLap
        });
      }

      startLap =
        pitLap;
    }

    if (
      entry.current_driver
    ) {
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
          new Date()
            .toISOString(),

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
        sortedPits.length +
        1
    };
  }

  async rebuildCurrentLiveStint(
    apexId,
    entry,
    lapRows,
    pitRows
  ) {
    if (
      !entry
        ?.current_driver
    ) {
      return;
    }

    const currentLapCount =
      Number(
        entry.lap_count
      );

    if (
      !Number.isFinite(
        currentLapCount
      ) ||
      currentLapCount <= 0
    ) {
      return;
    }

    const stintInfo =
      await this.syncDriverStints(
        apexId,
        entry,
        pitRows
      );

    const startLap =
      Number(
        stintInfo
          .startLap ||
        0
      );

    const currentStintLaps =
      lapRows
        .filter(
          row => {
            const lap =
              Number(
                row.lap_number
              );

            return (
              Number.isFinite(
                lap
              ) &&
              lap > startLap &&
              lap <=
                currentLapCount
            );
          }
        )
        .sort(
          (a, b) =>
            Number(
              a.lap_number
            ) -
            Number(
              b.lap_number
            )
        );

    const validatedRows =
      await this.getValidatedRows(
        apexId,
        entry.current_driver,
        startLap,
        currentLapCount
      );

    let validLaps;

    if (
      validatedRows &&
      validatedRows.length
    ) {
      validLaps =
        validatedRows;
    } else {
      const manualExclusions =
        await this.getManualExclusions(
          apexId,
          startLap,
          currentLapCount
        );

      const excludedPitLaps =
        new Set();

      for (
        const pit
        of pitRows
      ) {
        const lap =
          Number(
            pit.pit_lap
          );

        if (
          !Number.isFinite(
            lap
          )
        ) {
          continue;
        }

        excludedPitLaps
          .add(lap);

        excludedPitLaps
          .add(
            lap + 1
          );
      }

      const maxLapSeconds =
        Number(
          this.env
            .MAX_VALID_LAP_SECONDS ||
          90
        );

      const hardMaximum =
        (
          Number.isFinite(
            maxLapSeconds
          ) &&
          maxLapSeconds > 0
        )
          ? maxLapSeconds
          : 90;

      validLaps =
        currentStintLaps
          .filter(
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
                !Number.isFinite(
                  time
                ) ||
                time <= 0 ||
                time >
                  hardMaximum
              ) {
                return false;
              }

              if (
                manualExclusions
                  .has(lap)
              ) {
                return false;
              }

              if (
                excludedPitLaps
                  .has(lap)
              ) {
                return false;
              }

              return true;
            }
          );
    }

    const stats =
      calculateStats(
        validLaps
      );

    const now =
      new Date()
        .toISOString();

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
          currentStintLaps
            .length,

        valid_laps:
          stats.validLaps,

        lap_sum:
          stats.sum,

        lap_sum_squares:
          stats.sumSquares,

        last_lap:
          Number.isFinite(
            Number(
              entry.last_lap
            )
          )
            ? Number(
                entry.last_lap
              )
            : (
                currentStintLaps
                  .length
                  ? Number(
                      currentStintLaps[
                        currentStintLaps
                          .length -
                        1
                      ].lap_time
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
  }

  async refreshTeam(
    apexId,
    force = false
  ) {
    const key =
      String(apexId);

    if (
      this.detailRunning
        .has(key)
    ) {
      return;
    }

    const entry =
      await this.getEntry(
        apexId
      );

    const currentLapCount =
      Number(
        entry?.lap_count ||
        0
      );

    if (
      !entry ||
      !Number.isFinite(
        currentLapCount
      ) ||
      currentLapCount <= 0
    ) {
      return;
    }

    const now =
      Date.now();

    const previous =
      this.lastDetailFetch
        .get(key) || 0;

    if (
      !force &&
      now - previous <
        1500
    ) {
      return;
    }

    this.detailRunning
      .add(key);

    this.lastDetailFetch
      .set(
        key,
        now
      );

    try {
      const raw =
        await this.requestDetails(
          apexId,
          currentLapCount
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

      if (
        lapRows.length
      ) {
        await this.saveLapRows(
          lapRows
        );
      }

      if (
        pitRows.length
      ) {
        await sbUpsert(
          this.env,
          "apex_pit_stints",
          pitRows,
          "race_id,apex_id,pit_number"
        );
      }

      await this
        .rebuildCurrentLiveStint(
          apexId,
          (
            await this.getEntry(
              apexId
            )
          ) || entry,
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
      this.detailRunning
        .delete(key);
    }
  }

  async closeLiveStint(
    apexId,
    newDriver
  ) {
    const rows =
      await sbGet(
        this.env,
        "live_stint_stats",
        {
          select:
            "*",

          race_id:
            `eq.${this.raceId}`,

          apex_id:
            `eq.${apexId}`,

          limit:
            "1"
        }
      );

    const live =
      rows[0];

    if (
      !live
        ?.driver_name ||
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
          new Date()
            .toISOString()
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

    if (
      Number(
        before.lap_count
      ) > 0
    ) {
      await this.refreshTeam(
        apexId,
        true
      );
    }

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

    await this.refreshTeam(
      apexId,
      true
    );
  }

  async handleLapCount(
    apexId,
    newLapCount
  ) {
    if (
      !Number.isFinite(
        Number(
          newLapCount
        )
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
        entry?.lap_count ??
        -1
      );

    await this.upsertEntry({
      apex_id:
        apexId,

      lap_count:
        Number(
          newLapCount
        )
    });

    if (
      oldLapCount !==
      Number(
        newLapCount
      )
    ) {
      await this.refreshTeam(
        apexId,
        true
      );
    }
  }

  updatePosition(
    apexId,
    value
  ) {
    const position =
      Number(
        String(
          value || ""
        ).replace(
          /[^\d.-]/g,
          ""
        )
      );

    if (
      Number.isFinite(
        position
      ) &&
      position > 0
    ) {
      this.positions.set(
        String(apexId),
        position
      );
    }
  }

  async parseAndSave(payload) {
    for (
      const rawLine
      of String(
        payload || ""
      ).split("\n")
    ) {
      const update =
        parseProtocolLine(
          rawLine.trim()
        );

      if (!update.id) {
        continue;
      }

      if (
        update.id ===
        "grid"
      ) {
        const grid =
          parseGridData(
            update.value
          );

        if (
          grid.positions.size
        ) {
          this.positions =
            grid.positions;
        }

        if (
          grid.columnTypes.size
        ) {
          this.columnTypes =
            grid.columnTypes;
        }

        await this.state.storage.put({
          positions:
            Object.fromEntries(
              this.positions
            ),

          columnTypes:
            Object.fromEntries(
              this.columnTypes
            )
        });

        continue;
      }

      const row =
        parseRowId(
          update.id
        );

      if (!row) {
        continue;
      }

      const {
        apexId,
        column
      } = row;

      const {
        cls,
        value
      } = update;

      const type =
        this.columnTypes.get(
          `c${column}`
        ) || cls;

      if (
        type === "rk" ||
        cls === "rk"
      ) {
        this.updatePosition(
          apexId,
          value
        );

        continue;
      }

      if (
        type === "dr" ||
        cls === "dr"
      ) {
        await this.upsertEntry({
          apex_id:
            apexId,

          team_name:
            value
        });

        continue;
      }

      if (
        cls ===
        "drteam"
      ) {
        const driverName =
          value
            .replace(
              /\s*\[[^\]]+\]\s*$/,
              ""
            )
            .trim();

        await this
          .handleDriverChange(
            apexId,
            driverName
          );

        continue;
      }

      if (
        type === "llp" ||
        (
          cls === "tn" &&
          column === "9"
        ) ||
        cls === "llp"
      ) {
        const lapTime =
          parseLapTime(
            value
          );

        if (
          lapTime !==
          null
        ) {
          await this.upsertEntry({
            apex_id:
              apexId,

            last_lap:
              lapTime
          });
        }

        continue;
      }

      if (
        (
          type === "tlp" ||
          (
            cls === "in" &&
            column === "13"
          ) ||
          cls === "tlp"
        ) &&
        /^\d+$/.test(
          value
        )
      ) {
        await this.handleLapCount(
          apexId,
          Number(value)
        );
      }
    }
  }

  async handlePacket(payload) {
    this.packetCount +=
      1;

    this.lastPacketAt =
      new Date()
        .toISOString();

    await sbInsert(
      this.env,
      "apex_raw_packets",
      {
        race_id:
          this.raceId,

        payload
      }
    );

    await this.parseAndSave(
      payload
    );

    if (
      this.packetCount %
      20 === 0
    ) {
      await this.persistState();
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
  const response =
    await collectorStub(env)
      .fetch(
        "https://collector/start"
      );

  if (!response.ok) {
    throw new Error(
      `Collector start failed: ${response.status}`
    );
  }

  return response.json();
}

async function collectorSnapshot(env) {
  const response =
    await collectorStub(env)
      .fetch(
        "https://collector/snapshot"
      );

  if (!response.ok) {
    throw new Error(
      `Collector snapshot failed: ${response.status}`
    );
  }

  return response.json();
}

async function racesPayload(env) {
  const entries =
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

  const byRace =
    new Map();

  for (const row of entries) {
    const id =
      Number(
        row.race_id
      );

    if (
      !Number.isFinite(id) ||
      id <= 0
    ) {
      continue;
    }

    const timestamp =
      row.updated_at
        ? Date.parse(
            row.updated_at
          )
        : 0;

    const previous =
      byRace.get(id);

    if (
      !previous ||
      timestamp >
        previous.timestamp
    ) {
      byRace.set(
        id,
        {
          id,
          timestamp,

          updated_at:
            row.updated_at ||
            null
        }
      );
    }
  }

  const rows =
    [...byRace.values()]
      .sort(
        (a, b) =>
          (
            b.timestamp ||
            0
          ) -
          (
            a.timestamp ||
            0
          ) ||
          b.id -
          a.id
      )
      .map(
        item => {
          let dateLabel =
            "";

          if (
            item.updated_at
          ) {
            const date =
              new Date(
                item.updated_at
              );

            if (
              !Number.isNaN(
                date.getTime()
              )
            ) {
              dateLabel =
                date
                  .toLocaleDateString(
                    "en-GB",
                    {
                      day:
                        "2-digit",

                      month:
                        "2-digit",

                      year:
                        "numeric"
                    }
                  );
            }
          }

          return {
            id:
              item.id,

            race_id:
              item.id,

            name:
              dateLabel
                ? `Race ${item.id} — ${dateLabel}`
                : `Race ${item.id}`,

            updated_at:
              item.updated_at
          };
        }
      );

  return {
    rows
  };
}

async function livePayload(
  env,
  raceId
) {
  const [
    entries,
    liveStints,
    pits,
    snapshot
  ] =
    await Promise.all([
      sbGet(
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
      ),

      sbGet(
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
      ),

      sbGet(
        env,
        "apex_pit_stints",
        {
          select:
            "apex_id,pit_number,pit_lap",

          race_id:
            `eq.${raceId}`,

          order:
            "apex_id.asc,pit_number.asc"
        }
      ),

      collectorSnapshot(
        env
      ).catch(
        () => ({
          positions: {}
        })
      )
    ]);

  const newestTimestamp =
    entries.reduce(
      (
        latest,
        entry
      ) => {
        const timestamp =
          Date.parse(
            entry.updated_at ||
            ""
          );

        return Number.isFinite(
          timestamp
        )
          ? Math.max(
              latest,
              timestamp
            )
          : latest;
      },
      0
    );

  if (
    !newestTimestamp ||
    Date.now() -
      newestTimestamp >
      180000
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

  const activeEntries =
    entries.filter(
      entry => {
        const timestamp =
          Date.parse(
            entry.updated_at ||
            ""
          );

        return (
          Number.isFinite(
            timestamp
          ) &&
          newestTimestamp -
            timestamp <=
            180000
        );
      }
    );

  const positionMap =
    new Map(
      Object.entries(
        snapshot.positions ||
        {}
      )
        .map(
          (
            [
              apexId,
              value
            ]
          ) => [
            String(apexId),
            Number(value)
          ]
        )
        .filter(
          (
            [
              ,
              value
            ]
          ) =>
            Number.isFinite(
              value
            ) &&
            value > 0
        )
    );

  const pitCountByApex =
    new Map();

  for (const pit of pits) {
    const apexId =
      String(
        pit.apex_id
      );

    const pitNumber =
      Number(
        pit.pit_number
      );

    if (
      !Number.isFinite(
        pitNumber
      )
    ) {
      continue;
    }

    pitCountByApex.set(
      apexId,
      Math.max(
        pitCountByApex
          .get(apexId) ||
        0,
        pitNumber
      )
    );
  }

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

  const current = [];

  for (
    const stint
    of liveStints
  ) {
    const apexId =
      String(
        stint.apex_id
      );

    if (
      !activeIds.has(
        apexId
      )
    ) {
      continue;
    }

    const entry =
      entryMap.get(
        apexId
      ) || {};

    current.push({
      race_id:
        stint.race_id,

      apex_id:
        stint.apex_id,

      position:
        positionMap.get(
          apexId
        ) ?? null,

      stint_number:
        (
          pitCountByApex
            .get(apexId) ||
          0
        ) + 1,

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
          String(
            row.apex_id
          )
      )
    );

  for (
    const entry
    of activeEntries
  ) {
    const apexId =
      String(
        entry.apex_id
      );

    if (
      seen.has(
        apexId
      )
    ) {
      continue;
    }

    current.push({
      race_id:
        entry.race_id,

      apex_id:
        entry.apex_id,

      position:
        positionMap.get(
          apexId
        ) ?? null,

      stint_number:
        (
          pitCountByApex
            .get(apexId) ||
          0
        ) + 1,

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
    (a, b) => {
      const positionA =
        Number.isFinite(
          Number(
            a.position
          )
        )
          ? Number(
              a.position
            )
          : 999999;

      const positionB =
        Number.isFinite(
          Number(
            b.position
          )
        )
          ? Number(
              b.position
            )
          : 999999;

      if (
        positionA !==
        positionB
      ) {
        return (
          positionA -
          positionB
        );
      }

      const lapsA =
        Number(
          a.live_lap_count ||
          0
        );

      const lapsB =
        Number(
          b.live_lap_count ||
          0
        );

      if (
        lapsA !==
        lapsB
      ) {
        return (
          lapsB -
          lapsA
        );
      }

      return (
        Number(
          a.apex_id ||
          0
        ) -
        Number(
          b.apex_id ||
          0
        )
      );
    }
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

async function stintsPayload(
  env,
  raceId
) {
  const [
    completed,
    live,
    pits
  ] =
    await Promise.all([
      sbGet(
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
      ),

      sbGet(
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
      ),

      sbGet(
        env,
        "apex_pit_stints",
        {
          select:
            "apex_id,pit_number",

          race_id:
            `eq.${raceId}`,

          order:
            "apex_id.asc,pit_number.asc"
        }
      )
    ]);

  const maxPitByApex =
    new Map();

  for (const pit of pits) {
    const apexId =
      String(
        pit.apex_id
      );

    const pitNumber =
      Number(
        pit.pit_number
      );

    if (
      !Number.isFinite(
        pitNumber
      )
    ) {
      continue;
    }

    maxPitByApex.set(
      apexId,
      Math.max(
        maxPitByApex
          .get(apexId) ||
        0,
        pitNumber
      )
    );
  }

  return [
    ...completed,

    ...live.map(
      row => ({
        ...row,

        stint_number:
          (
            maxPitByApex
              .get(
                String(
                  row.apex_id
                )
              ) ||
            0
          ) + 1,

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
      })
    )
  ];
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
            console.error
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
            status:
              response.status,

            headers: {
              "content-type":
                "application/json; charset=utf-8"
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
            status:
              response.status,

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

      if (
        url.pathname ===
        "/api/live"
      ) {
        ctx.waitUntil(
          startCollector(
            env
          ).catch(
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

      if (
        url.pathname ===
        "/api/stints"
      ) {
        return json({
          race_id:
            Number(
              raceId
            ),

          rows:
            await stintsPayload(
              env,
              raceId
            )
        });
      }

      if (
        url.pathname ===
        "/api/drivers"
      ) {
        return json({
          race_id:
            Number(
              raceId
            ),

          rows:
            await sbGet(
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
              raceId
            ),

          rows:
            await sbGet(
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
            )
        });
      }

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

  async scheduled(
    controller,
    env,
    ctx
  ) {
    ctx.waitUntil(
      startCollector(
        env
      ).catch(
        console.error
      )
    );
  }
};
