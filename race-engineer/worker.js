function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function sbHeaders(env, extra = {}) {
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
          sbHeaders(
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
          sbHeaders(
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

  if (
    prefer.includes(
      "return=representation"
    )
  ) {
    return response.json();
  }

  return null;
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

  return match
    ? {
        apexId:
          match[1],

        column:
          match[2] || null
      }
    : null;
}


function stripHtml(value) {
  return String(value || "")
    .replace(
      /<br\s*\/?>/gi,
      " "
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function parseGridData(html) {
  const source =
    String(html || "");

  const positions =
    new Map();

  const columnTypes =
    new Map();

  const fields =
    new Map();


  const headCellRegex =
    /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;

  let cellMatch;

  while (
    (
      cellMatch =
        headCellRegex.exec(
          source
        )
    ) !== null
  ) {
    const attrs =
      cellMatch[1];

    const idMatch =
      /data-id=["'](c\d+)["']/i
        .exec(attrs);

    const typeMatch =
      /data-type=["']([^"']+)["']/i
        .exec(attrs);

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
    /<tr\b([^>]*)data-id=["']r(\d+)["']([^>]*)>([\s\S]*?)<\/tr>/gi;

  let rowMatch;

  while (
    (
      rowMatch =
        rowRegex.exec(
          source
        )
    ) !== null
  ) {
    const attrs =
      `${rowMatch[1]} ${rowMatch[3]}`;

    const apexId =
      String(
        rowMatch[2]
      );

    const positionMatch =
      /data-pos=["'](\d+)["']/i
        .exec(attrs);

    if (positionMatch) {
      const position =
        Number(
          positionMatch[1]
        );

      if (
        Number.isFinite(
          position
        ) &&
        position > 0
      ) {
        positions.set(
          apexId,
          position
        );
      }
    }


    const rowFields = {};

    const cellRegex =
      /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;

    let match;

    while (
      (
        match =
          cellRegex.exec(
            rowMatch[4]
          )
      ) !== null
    ) {
      const idMatch =
        /data-id=["']r\d+c(\d+)["']/i
          .exec(
            match[1]
          );

      if (!idMatch) {
        continue;
      }

      const type =
        columnTypes.get(
          `c${idMatch[1]}`
        );

      if (!type) {
        continue;
      }

      rowFields[type] =
        stripHtml(
          match[2]
        );
    }

    fields.set(
      apexId,
      rowFields
    );
  }


  return {
    positions,
    columnTypes,
    fields
  };
}


function parseLapTime(value) {
  const raw =
    String(
      value ?? ""
    ).trim();

  if (!raw) {
    return null;
  }

  if (
    raw.includes(":")
  ) {
    const parts =
      raw.split(":");

    if (
      parts.length !== 2
    ) {
      return null;
    }

    const minutes =
      Number(
        parts[0]
      );

    const seconds =
      Number(
        parts[1]
      );

    return (
      Number.isFinite(
        minutes
      ) &&
      Number.isFinite(
        seconds
      )
    )
      ? minutes * 60 +
        seconds
      : null;
  }

  const parsed =
    Number(
      raw.replace(
        /[^\d.-]/g,
        ""
      )
    );

  return Number.isFinite(
    parsed
  )
    ? parsed
    : null;
}


function numericValue(value) {
  const parsed =
    Number(
      String(
        value ?? ""
      ).replace(
        /[^\d.-]/g,
        ""
      )
    );

  return Number.isFinite(
    parsed
  )
    ? parsed
    : null;
}


function msToTime(ms) {
  const value =
    Number(ms);

  if (
    !Number.isFinite(
      value
    )
  ) {
    return null;
  }

  const total =
    Math.floor(
      value / 1000
    );

  const hours =
    Math.floor(
      total / 3600
    );

  const minutes =
    Math.floor(
      (
        total %
        3600
      ) /
      60
    );

  const seconds =
    total % 60;

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
    !Number.isFinite(
      value
    )
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
          String(
            raw || ""
          )
        )
    ) !== null
  ) {
    drivers.set(
      Number(
        match[1]
      ),
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
    of String(
      raw || ""
    ).split("\n")
  ) {
    const match =
      /^D(\d+)\.L0*(\d+)#(.+)$/
        .exec(
          rawLine.trim()
        );

    if (!match) {
      continue;
    }

    const parts =
      match[3]
        .split("|");

    const milliseconds =
      Number(
        parts[3]
      );

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
        String(
          match[1]
        ),

      lap_number:
        Number(
          match[2]
        ),

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
    parseDrivers(
      raw
    );

  const rows = [];

  for (
    const rawLine
    of String(
      raw || ""
    ).split("\n")
  ) {
    const match =
      /^D(\d+)\.P\d+#(.+)$/
        .exec(
          rawLine.trim()
        );

    if (!match) {
      continue;
    }

    const parts =
      match[2]
        .split("|");

    const pitNumber =
      Number(
        parts[0]
      );

    const pitLap =
      Number(
        parts[1]
      );

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
        Number(
          match[1]
        ),

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
          Number(
            parts[7]
          )
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


function median(values) {
  const clean =
    values
      .filter(
        Number.isFinite
      )
      .sort(
        (a, b) =>
          a - b
      );

  if (!clean.length) {
    return null;
  }

  const middle =
    Math.floor(
      clean.length /
      2
    );

  return clean.length % 2
    ? clean[middle]
    : (
        clean[
          middle - 1
        ] +
        clean[middle]
      ) /
      2;
}


function calculateStats(
  laps,
  hardMax = 120
) {
  const raw =
    laps
      .map(
        row => ({
          lap_number:
            Number(
              row.lap_number
            ),

          lap_time:
            Number(
              row.lap_time
            )
        })
      )
      .filter(
        row =>
          Number.isFinite(
            row.lap_number
          ) &&
          Number.isFinite(
            row.lap_time
          ) &&
          row.lap_time > 0
      );

  if (!raw.length) {
    return {
      validLaps:
        0,

      totalLaps:
        0,

      sum:
        0,

      sumSquares:
        0,

      avg:
        null,

      best:
        null,

      bestLapNumber:
        null,

      worst:
        null,

      worstLapNumber:
        null,

      consistency:
        null
    };
  }

  const baseline =
    median(
      raw
        .map(
          row =>
            row.lap_time
        )
        .filter(
          value =>
            value <=
            hardMax
        )
    );

  const adaptiveMax =
    baseline
      ? Math.min(
          hardMax,
          baseline * 1.25
        )
      : hardMax;

  const clean =
    raw.filter(
      row =>
        row.lap_time <=
        adaptiveMax
    );

  if (!clean.length) {
    return {
      validLaps:
        0,

      totalLaps:
        raw.length,

      sum:
        0,

      sumSquares:
        0,

      avg:
        null,

      best:
        null,

      bestLapNumber:
        null,

      worst:
        null,

      worstLapNumber:
        null,

      consistency:
        null
    };
  }

  let sum = 0;
  let sumSquares = 0;

  let best = null;
  let bestLapNumber = null;

  let worst = null;
  let worstLapNumber = null;


  for (
    const lap
    of clean
  ) {
    sum +=
      lap.lap_time;

    sumSquares +=
      lap.lap_time *
      lap.lap_time;

    if (
      best === null ||
      lap.lap_time <
        best
    ) {
      best =
        lap.lap_time;

      bestLapNumber =
        lap.lap_number;
    }

    if (
      worst === null ||
      lap.lap_time >
        worst
    ) {
      worst =
        lap.lap_time;

      worstLapNumber =
        lap.lap_number;
    }
  }


  const avg =
    sum /
    clean.length;

  const variance =
    Math.max(
      0,
      sumSquares /
        clean.length -
        avg *
        avg
    );


  return {
    validLaps:
      clean.length,

    totalLaps:
      raw.length,

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


function makeLiveRaceId() {
  return Date.now();
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

    this.raceId =
      null;

    this.positions =
      new Map();

    this.columnTypes =
      new Map();

    this.liveFields =
      new Map();

    this.detailRunning =
      new Set();

    this.lastDetailFetch =
      new Map();

    this.bootstrapped =
      new Set();


    state.blockConcurrencyWhile(
      async () => {

        this.packetCount =
          (
            await state.storage.get(
              "packetCount"
            )
          ) || 0;

        this.lastPacketAt =
          (
            await state.storage.get(
              "lastPacketAt"
            )
          ) || null;

        this.raceId =
          (
            await state.storage.get(
              "liveRaceId"
            )
          ) ||
          makeLiveRaceId();

        this.positions =
          new Map(
            Object.entries(
              (
                await state.storage.get(
                  "positions"
                )
              ) || {}
            )
          );

        this.columnTypes =
          new Map(
            Object.entries(
              (
                await state.storage.get(
                  "columnTypes"
                )
              ) || {}
            )
          );

        this.liveFields =
          new Map(
            Object.entries(
              (
                await state.storage.get(
                  "liveFields"
                )
              ) || {}
            )
          );

        this.bootstrapped =
          new Set(
            (
              await state.storage.get(
                "bootstrapped"
              )
            ) || []
          );

        await state.storage.put(
          "liveRaceId",
          this.raceId
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
        await this.snapshot()
      );
    }


    if (
      pathname ===
        "/status" ||
      pathname ===
        "/snapshot"
    ) {
      return json(
        await this.snapshot()
      );
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
        await this.snapshot()
      );
    }


    return new Response(
      "Not found",
      {
        status:
          404
      }
    );
  }


  async snapshot() {
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
        this.lastPacketAt,

      positions:
        Object.fromEntries(
          this.positions
        ),

      fields:
        Object.fromEntries(
          this.liveFields
        )
    };
  }


  async persistState() {
    await this.state.storage.put({
      packetCount:
        this.packetCount,

      lastPacketAt:
        this.lastPacketAt,

      liveRaceId:
        this.raceId,

      positions:
        Object.fromEntries(
          this.positions
        ),

      columnTypes:
        Object.fromEntries(
          this.columnTypes
        ),

      liveFields:
        Object.fromEntries(
          this.liveFields
        ),

      bootstrapped:
        [
          ...this.bootstrapped
        ]
    });
  }


  async startNewRace() {
    this.raceId =
      makeLiveRaceId();

    this.positions.clear();

    this.liveFields.clear();

    this.bootstrapped.clear();

    this.lastDetailFetch.clear();

    await this.persistState();
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

    return rows[0] ||
      null;
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


  setLiveField(
    apexId,
    key,
    value
  ) {
    const id =
      String(apexId);

    const current =
      this.liveFields.get(
        id
      ) || {};

    current[key] =
      value;

    this.liveFields.set(
      id,
      current
    );
  }


  async requestDetails(
    apexId,
    currentLapCount,
    full = false
  ) {
    const historyCount =
      full
        ? Math.max(
            1,
            currentLapCount
          )
        : Math.max(
            1,
            Math.min(
              currentLapCount,
              Number(
                this.env
                  .APEX_DETAIL_LAPS ||
                150
              )
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
      index +=
        chunkSize
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


  async manualExclusions(
    apexId
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
            Number.isFinite
          )
      );

    } catch {
      return new Set();
    }
  }


  validSegmentLaps(
    lapRows,
    startLap,
    endLap,
    pitRows,
    exclusions
  ) {
    const excludedPitLaps =
      new Set(
        pitRows
          .map(
            pit =>
              Number(
                pit.pit_lap
              )
          )
          .filter(
            Number.isFinite
          )
      );


    return lapRows
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
            lap <= endLap &&
            !excludedPitLaps.has(
              lap
            ) &&
            !exclusions.has(
              lap
            )
          );
        }
      );
  }


  async rebuildAllStints(
    apexId,
    entry,
    lapRows,
    pitRows
  ) {
    const currentLap =
      Number(
        entry
          ?.lap_count ||
        0
      );

    const currentPitCount =
      Number(
        this.liveFields
          .get(
            String(
              apexId
            )
          )
          ?.pits
      );


    const filteredPits =
      pitRows
        .filter(
          pit =>
            Number(
              pit.pit_lap
            ) <=
            currentLap
        )
        .filter(
          pit =>
            !Number.isFinite(
              currentPitCount
            ) ||
            currentPitCount <
              0 ||
            Number(
              pit.pit_number
            ) <=
              currentPitCount
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


    const exclusions =
      await this.manualExclusions(
        apexId
      );

    const hardMax =
      Number(
        this.env
          .MAX_VALID_LAP_SECONDS ||
        120
      );

    const completed = [];

    let startLap = 0;


    for (
      const pit
      of filteredPits
    ) {
      const endLap =
        Number(
          pit.pit_lap
        );

      if (
        !Number.isFinite(
          endLap
        ) ||
        endLap <=
          startLap
      ) {
        continue;
      }


      const segment =
        this.validSegmentLaps(
          lapRows,
          startLap,
          endLap,
          filteredPits,
          exclusions
        );


      const stats =
        calculateStats(
          segment,
          Number.isFinite(
            hardMax
          )
            ? hardMax
            : 120
        );


      if (
        pit.driver_name
      ) {
        completed.push({
          race_id:
            this.raceId,

          apex_id:
            String(
              apexId
            ),

          team_name:
            entry.team_name,

          driver_name:
            pit.driver_name,

          start_lap_count:
            startLap,

          end_lap_count:
            endLap,

          total_laps:
            Math.max(
              0,
              endLap -
              startLap
            ),

          valid_laps:
            stats.validLaps,

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
            new Date()
              .toISOString(),

          stint_ended_at:
            new Date()
              .toISOString()
        });
      }

      startLap =
        endLap;
    }


    await sbDelete(
      this.env,
      "completed_stint_stats",
      {
        race_id:
          `eq.${this.raceId}`,

        apex_id:
          `eq.${apexId}`
      }
    );


    if (
      completed.length
    ) {
      await sbInsert(
        this.env,
        "completed_stint_stats",
        completed
      );
    }


    await this
      .rebuildCurrentLiveStint(
        apexId,
        entry,
        lapRows,
        filteredPits,
        startLap,
        exclusions
      );
  }


  async rebuildCurrentLiveStint(
    apexId,
    entry,
    lapRows,
    pitRows,
    suppliedStartLap = null,
    suppliedExclusions = null
  ) {
    if (
      !entry
        ?.current_driver
    ) {
      return;
    }


    const currentLap =
      Number(
        entry.lap_count ||
        0
      );

    if (
      !Number.isFinite(
        currentLap
      ) ||
      currentLap <= 0
    ) {
      return;
    }


    const sortedPits =
      [
        ...pitRows
      ]
        .filter(
          pit =>
            Number.isFinite(
              Number(
                pit.pit_lap
              )
            ) &&
            Number(
              pit.pit_lap
            ) <=
              currentLap
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


    const startLap =
      suppliedStartLap ??
      (
        sortedPits.length
          ? Number(
              sortedPits[
                sortedPits.length -
                1
              ].pit_lap
            )
          : 0
      );


    const exclusions =
      suppliedExclusions ||
      await this.manualExclusions(
        apexId
      );


    const currentRows =
      this.validSegmentLaps(
        lapRows,
        startLap,
        currentLap,
        sortedPits,
        exclusions
      );


    const hardMax =
      Number(
        this.env
          .MAX_VALID_LAP_SECONDS ||
        120
      );


    const stats =
      calculateStats(
        currentRows,
        Number.isFinite(
          hardMax
        )
          ? hardMax
          : 120
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
          String(
            apexId
          ),

        team_name:
          entry.team_name,

        driver_name:
          entry.current_driver,

        start_lap_count:
          startLap,

        current_lap_count:
          currentLap,

        total_laps:
          Math.max(
            0,
            currentLap -
            startLap
          ),

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
            : null,

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
      String(
        apexId
      );


    if (
      this.detailRunning
        .has(
          key
        )
    ) {
      return;
    }


    const entry =
      await this.getEntry(
        apexId
      );

    const currentLap =
      Number(
        entry
          ?.lap_count ||
        0
      );


    if (
      !entry ||
      !Number.isFinite(
        currentLap
      ) ||
      currentLap <= 0
    ) {
      return;
    }


    const now =
      Date.now();

    const previous =
      this.lastDetailFetch
        .get(
          key
        ) || 0;


    if (
      !force &&
      now - previous <
        1500
    ) {
      return;
    }


    this.detailRunning
      .add(
        key
      );

    this.lastDetailFetch
      .set(
        key,
        now
      );


    try {
      const full =
        !this.bootstrapped
          .has(
            key
          );


      const raw =
        await this.requestDetails(
          apexId,
          currentLap,
          full
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


      const freshEntry =
        (
          await this.getEntry(
            apexId
          )
        ) ||
        entry;


      if (full) {
        await this
          .rebuildAllStints(
            apexId,
            freshEntry,
            lapRows,
            pitRows
          );

        this.bootstrapped
          .add(
            key
          );

        await this.state.storage.put(
          "bootstrapped",
          [
            ...this.bootstrapped
          ]
        );

      } else {

        await this
          .rebuildCurrentLiveStint(
            apexId,
            freshEntry,
            lapRows,
            pitRows
          );
      }

    } catch (error) {
      console.error(
        "DETAIL REFRESH ERROR:",
        apexId,
        error
      );

    } finally {

      this.detailRunning
        .delete(
          key
        );
    }
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


    if (
      before
        ?.current_driver ===
      driverName
    ) {
      return;
    }


    await this.upsertEntry({
      apex_id:
        apexId,

      current_driver:
        driverName
    });


    if (
      Number(
        before
          ?.lap_count ||
        0
      ) > 0
    ) {
      await this.refreshTeam(
        apexId,
        true
      );
    }
  }


  async handleLapCount(
    apexId,
    newLapCount
  ) {
    const incoming =
      Number(
        newLapCount
      );


    if (
      !Number.isFinite(
        incoming
      )
    ) {
      return;
    }


    const entry =
      await this.getEntry(
        apexId
      );

    const old =
      Number(
        entry
          ?.lap_count ??
        -1
      );


    if (
      old > 50 &&
      incoming >= 0 &&
      incoming + 50 <
        old
    ) {
      await this
        .startNewRace();
    }


    await this.upsertEntry({
      apex_id:
        apexId,

      lap_count:
        incoming
    });


    this.setLiveField(
      apexId,
      "laps",
      incoming
    );


    if (
      old !==
      incoming
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
      numericValue(
        value
      );


    if (
      Number.isFinite(
        position
      ) &&
      position > 0
    ) {
      this.positions.set(
        String(
          apexId
        ),
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


        for (
          const [
            apexId,
            fields
          ]
          of grid.fields.entries()
        ) {
          for (
            const [
              type,
              value
            ]
            of Object.entries(
              fields
            )
          ) {
            if (
              type ===
              "rk"
            ) {
              this.updatePosition(
                apexId,
                value
              );
            }


            if (
              type ===
              "pit"
            ) {
              this.setLiveField(
                apexId,
                "pits",
                numericValue(
                  value
                )
              );
            }


            if (
              type ===
              "tlp"
            ) {
              this.setLiveField(
                apexId,
                "laps",
                numericValue(
                  value
                )
              );
            }
          }
        }


        await this.persistState();

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
        ) ||
        cls;


      if (
        type ===
          "rk" ||
        cls ===
          "rk"
      ) {
        this.updatePosition(
          apexId,
          value
        );

        continue;
      }


      if (
        type ===
          "pit" ||
        cls ===
          "pit"
      ) {
        this.setLiveField(
          apexId,
          "pits",
          numericValue(
            value
          )
        );

        continue;
      }


      if (
        type ===
          "dr" ||
        cls ===
          "dr"
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
        type ===
          "llp" ||
        cls ===
          "llp" ||
        (
          cls ===
            "tn" &&
          column ===
            "9"
        )
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
        type ===
          "blp" ||
        cls ===
          "blp"
      ) {
        const bestLap =
          parseLapTime(
            value
          );


        if (
          bestLap !==
          null
        ) {
          await this.upsertEntry({
            apex_id:
              apexId,

            best_lap:
              bestLap
          });
        }

        continue;
      }


      if (
        (
          type ===
            "tlp" ||
          cls ===
            "tlp" ||
          (
            cls ===
              "in" &&
            column ===
              "13"
          )
        ) &&
        /^\d+$/.test(
          value
        )
      ) {
        await this.handleLapCount(
          apexId,
          Number(
            value
          )
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
  return env.APEX_COLLECTOR
    .get(
      env.APEX_COLLECTOR
        .idFromName(
          "primary"
        )
    );
}


async function collectorSnapshot(env) {
  const response =
    await collectorStub(
      env
    ).fetch(
      "https://collector/snapshot"
    );


  if (!response.ok) {
    throw new Error(
      `Collector snapshot failed: ${response.status}`
    );
  }


  return response.json();
}


async function startCollector(env) {
  const response =
    await collectorStub(
      env
    ).fetch(
      "https://collector/start"
    );


  if (!response.ok) {
    throw new Error(
      `Collector start failed: ${response.status}`
    );
  }


  return response.json();
}


async function resolveRaceId(
  url,
  env
) {
  const explicit =
    url.searchParams.get(
      "race_id"
    );


  if (
    explicit &&
    Number.isFinite(
      Number(
        explicit
      )
    )
  ) {
    return Number(
      explicit
    );
  }


  const snapshot =
    await collectorSnapshot(
      env
    );


  return Number(
    snapshot.race_id
  );
}


async function livePayload(
  env,
  raceId,
  snapshot = null
) {
  snapshot =
    snapshot ||
    await collectorSnapshot(
      env
    );


  const entries =
    await sbGet(
      env,
      "apex_entries",
      {
        select:
          "*",

        race_id:
          `eq.${raceId}`,

        order:
          "updated_at.desc",

        limit:
          "500"
      }
    );


  const liveStints =
    await sbGet(
      env,
      "live_stint_stats",
      {
        select:
          "*",

        race_id:
          `eq.${raceId}`,

        limit:
          "500"
      }
    );


  const newest =
    entries.reduce(
      (
        maximum,
        row
      ) =>
        Math.max(
          maximum,
          Date.parse(
            row.updated_at ||
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
        raceId,

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
      row =>
        newest -
          (
            Date.parse(
              row.updated_at ||
              ""
            ) ||
            0
          ) <=
        180000
    );


  const liveMap =
    new Map(
      liveStints.map(
        row => [
          String(
            row.apex_id
          ),
          row
        ]
      )
    );


  const fields =
    snapshot.fields ||
    {};

  const positions =
    snapshot.positions ||
    {};


  const current =
    activeEntries
      .map(
        entry => {

          const id =
            String(
              entry.apex_id
            );

          const stint =
            liveMap.get(
              id
            ) || {};

          const liveField =
            fields[id] ||
            {};

          const pitCount =
            Number.isFinite(
              Number(
                liveField.pits
              )
            )
              ? Number(
                  liveField.pits
                )
              : null;

          const raceLap =
            Number.isFinite(
              Number(
                entry.lap_count
              )
            )
              ? Number(
                  entry.lap_count
                )
              : (
                  Number(
                    liveField.laps
                  ) ||
                  null
                );


          return {
            race_id:
              raceId,

            apex_id:
              entry.apex_id,

            position:
              Number(
                positions[id]
              ) ||
              null,

            team_name:
              entry.team_name,

            driver_name:
              entry.current_driver,

            current_driver:
              entry.current_driver,

            race_lap:
              raceLap,

            live_lap_count:
              raceLap,

            pit_count:
              pitCount,

            stint_number:
              pitCount !==
                null
                ? pitCount +
                  1
                : null,

            start_lap_count:
              stint
                .start_lap_count ??
              null,

            stint_laps:
              stint
                .total_laps ??
              (
                stint
                  .start_lap_count !=
                    null &&
                raceLap !=
                  null
                  ? Math.max(
                      0,
                      raceLap -
                      Number(
                        stint
                          .start_lap_count
                      )
                    )
                  : null
              ),

            total_stint_laps:
              stint
                .total_laps ??
              null,

            valid_laps:
              stint
                .valid_laps ??
              0,

            live_last_lap:
              entry
                .last_lap ??
              stint
                .last_lap ??
              null,

            avg_lap_time:
              stint
                .avg_lap ??
              null,

            best_lap_time:
              stint
                .best_lap ??
              entry
                .best_lap ??
              null,

            best_lap_number:
              stint
                .best_lap_number ??
              null,

            worst_lap_time:
              stint
                .worst_lap ??
              null,

            worst_lap_number:
              stint
                .worst_lap_number ??
              null,

            consistency:
              stint
                .consistency ??
              null,

            updated_at:
              entry.updated_at
          };
        }
      );


  current.sort(
    (a, b) => {

      const positionA =
        Number(
          a.position
        ) ||
        999999;

      const positionB =
        Number(
          b.position
        ) ||
        999999;


      if (
        positionA !==
        positionB
      ) {
        return (
          positionA -
          positionB
        );
      }


      return (
        (
          Number(
            b.race_lap
          ) ||
          0
        ) -
        (
          Number(
            a.race_lap
          ) ||
          0
        )
      );
    }
  );


  return {
    race_id:
      raceId,

    session_name:
      "Apex Timing",

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
  raceId,
  currentRaceId,
  snapshot
) {
  const completed =
    await sbGet(
      env,
      "completed_stint_stats",
      {
        select:
          "*",

        race_id:
          `eq.${raceId}`,

        order:
          "apex_id.asc,start_lap_count.asc",

        limit:
          "5000"
      }
    );


  const live =
    raceId ===
      currentRaceId
      ? await sbGet(
          env,
          "live_stint_stats",
          {
            select:
              "*",

            race_id:
              `eq.${raceId}`,

            limit:
              "500"
          }
        )
      : [];


  const rows = [
    ...completed.map(
      row => ({
        ...row,

        is_live:
          false
      })
    ),

    ...live.map(
      row => ({
        ...row,

        is_live:
          true,

        end_lap_count:
          row.current_lap_count,

        avg_lap_time:
          row.avg_lap,

        best_lap_time:
          row.best_lap,

        worst_lap_time:
          row.worst_lap
      })
    )
  ];


  const byApex =
    new Map();


  for (
    const row
    of rows
  ) {
    const id =
      String(
        row.apex_id
      );

    if (
      !byApex.has(
        id
      )
    ) {
      byApex.set(
        id,
        []
      );
    }

    byApex
      .get(
        id
      )
      .push(
        row
      );
  }


  const positions =
    snapshot
      ?.positions ||
    {};


  const output = [];


  for (
    const [
      id,
      group
    ]
    of byApex.entries()
  ) {
    group.sort(
      (a, b) =>
        Number(
          a.start_lap_count ||
          0
        ) -
        Number(
          b.start_lap_count ||
          0
        )
    );


    group.forEach(
      (
        row,
        index
      ) =>
        output.push({
          ...row,

          stint_number:
            index +
            1,

          position:
            Number(
              positions[id]
            ) ||
            null,

          total_laps:
            row.total_laps ??
            Math.max(
              0,
              Number(
                row.end_lap_count ||
                0
              ) -
              Number(
                row.start_lap_count ||
                0
              )
            ),

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
            null
        })
    );
  }


  output.sort(
    (a, b) => {

      const positionA =
        Number(
          a.position
        ) ||
        999999;

      const positionB =
        Number(
          b.position
        ) ||
        999999;


      if (
        positionA !==
        positionB
      ) {
        return (
          positionA -
          positionB
        );
      }


      const team =
        String(
          a.team_name ||
          ""
        ).localeCompare(
          String(
            b.team_name ||
            ""
          )
        );


      if (team) {
        return team;
      }


      return (
        Number(
          a.stint_number
        ) -
        Number(
          b.stint_number
        )
      );
    }
  );


  return output;
}


function aggregateDrivers(
  stints
) {
  const groups =
    new Map();


  for (
    const row
    of stints
  ) {
    if (
      !row.driver_name
    ) {
      continue;
    }

    const key =
      `${row.apex_id}|||${row.driver_name}`;

    if (
      !groups.has(
        key
      )
    ) {
      groups.set(
        key,
        []
      );
    }

    groups
      .get(
        key
      )
      .push(
        row
      );
  }


  return [
    ...groups.values()
  ]
    .map(
      group => {

        const first =
          group[0];

        let validLaps = 0;
        let totalLaps = 0;
        let weighted = 0;
        let best = null;
        let consistencyWeighted = 0;
        let consistencyLaps = 0;
        let validStints = 0;
        let shortStints = 0;


        for (
          const row
          of group
        ) {
          const valid =
            Number(
              row.valid_laps ||
              0
            );

          const total =
            Number(
              row.total_laps ||
              0
            );

          const average =
            Number(
              row.avg_lap_time ??
              row.avg_lap
            );

          const bestLap =
            Number(
              row.best_lap_time ??
              row.best_lap
            );

          const consistency =
            Number(
              row.consistency
            );


          validLaps +=
            valid;

          totalLaps +=
            total;


          if (
            valid >=
            3
          ) {
            validStints +=
              1;

          } else {

            shortStints +=
              1;
          }


          if (
            valid > 0 &&
            Number.isFinite(
              average
            )
          ) {
            weighted +=
              average *
              valid;
          }


          if (
            Number.isFinite(
              bestLap
            ) &&
            bestLap > 0 &&
            (
              best === null ||
              bestLap <
                best
            )
          ) {
            best =
              bestLap;
          }


          if (
            valid > 0 &&
            Number.isFinite(
              consistency
            )
          ) {
            consistencyWeighted +=
              consistency *
              valid;

            consistencyLaps +=
              valid;
          }
        }


        return {
          race_id:
            first.race_id,

          apex_id:
            first.apex_id,

          position:
            first.position ??
            null,

          team_name:
            first.team_name,

          driver_name:
            first.driver_name,

          stint_count:
            group.length,

          valid_stint_count:
            validStints,

          short_stint_count:
            shortStints,

          valid_laps:
            validLaps,

          total_laps:
            totalLaps,

          avg_lap_time:
            validLaps
              ? weighted /
                validLaps
              : null,

          best_lap_time:
            best,

          avg_consistency:
            consistencyLaps
              ? consistencyWeighted /
                consistencyLaps
              : null
        };
      }
    )
    .sort(
      (a, b) => {

        const positionA =
          Number(
            a.position
          ) ||
          999999;

        const positionB =
          Number(
            b.position
          ) ||
          999999;


        if (
          positionA !==
          positionB
        ) {
          return (
            positionA -
            positionB
          );
        }


        return (
          String(
            a.team_name ||
            ""
          ).localeCompare(
            String(
              b.team_name ||
              ""
            )
          ) ||
          String(
            a.driver_name ||
            ""
          ).localeCompare(
            String(
              b.driver_name ||
              ""
            )
          )
        );
      }
    );
}


function aggregateTeams(
  drivers
) {
  const groups =
    new Map();


  for (
    const row
    of drivers
  ) {
    const key =
      String(
        row.apex_id ??
        row.team_name
      );

    if (
      !groups.has(
        key
      )
    ) {
      groups.set(
        key,
        []
      );
    }

    groups
      .get(
        key
      )
      .push(
        row
      );
  }


  return [
    ...groups.values()
  ]
    .map(
      group => {

        const first =
          group[0];


        const validLaps =
          group.reduce(
            (
              total,
              row
            ) =>
              total +
              Number(
                row.valid_laps ||
                0
              ),
            0
          );


        const totalLaps =
          group.reduce(
            (
              total,
              row
            ) =>
              total +
              Number(
                row.total_laps ||
                0
              ),
            0
          );


        const stintCount =
          group.reduce(
            (
              total,
              row
            ) =>
              total +
              Number(
                row.stint_count ||
                0
              ),
            0
          );


        const weighted =
          group.reduce(
            (
              total,
              row
            ) =>
              total +
              (
                Number(
                  row.avg_lap_time
                ) ||
                0
              ) *
              Number(
                row.valid_laps ||
                0
              ),
            0
          );


        const bestValues =
          group
            .map(
              row =>
                Number(
                  row.best_lap_time
                )
            )
            .filter(
              value =>
                Number.isFinite(
                  value
                ) &&
                value >
                  0
            );


        const driverAverages =
          group
            .map(
              row =>
                Number(
                  row.avg_lap_time
                )
            )
            .filter(
              value =>
                Number.isFinite(
                  value
                ) &&
                value >
                  0
            );


        const consistencyWeighted =
          group.reduce(
            (
              total,
              row
            ) =>
              total +
              (
                Number(
                  row.avg_consistency
                ) ||
                0
              ) *
              Number(
                row.valid_laps ||
                0
              ),
            0
          );


        return {
          race_id:
            first.race_id,

          apex_id:
            first.apex_id,

          position:
            first.position ??
            null,

          team_name:
            first.team_name,

          driver_count:
            group.length,

          stint_count:
            stintCount,

          valid_laps:
            validLaps,

          total_laps:
            totalLaps,

          avg_lap_time:
            validLaps
              ? weighted /
                validLaps
              : null,

          best_lap_time:
            bestValues.length
              ? Math.min(
                  ...bestValues
                )
              : null,

          avg_consistency:
            validLaps
              ? consistencyWeighted /
                validLaps
              : null,

          driver_spread:
            driverAverages.length >
              1
              ? Math.max(
                  ...driverAverages
                ) -
                Math.min(
                  ...driverAverages
                )
              : 0
        };
      }
    )
    .sort(
      (a, b) => {

        const positionA =
          Number(
            a.position
          ) ||
          999999;

        const positionB =
          Number(
            b.position
          ) ||
          999999;


        if (
          positionA !==
          positionB
        ) {
          return (
            positionA -
            positionB
          );
        }


        return String(
          a.team_name ||
          ""
        ).localeCompare(
          String(
            b.team_name ||
            ""
          )
        );
      }
    );
}


async function pitsPayload(
  env,
  raceId,
  currentRaceId,
  snapshot
) {
  const rows =
    await sbGet(
      env,
      "apex_pit_stints",
      {
        select:
          "*",

        race_id:
          `eq.${raceId}`,

        order:
          "apex_id.asc,pit_number.asc",

        limit:
          "5000"
      }
    );


  if (
    raceId !==
    currentRaceId
  ) {
    return rows;
  }


  const entries =
    await sbGet(
      env,
      "apex_entries",
      {
        select:
          "apex_id,lap_count",

        race_id:
          `eq.${raceId}`,

        limit:
          "500"
      }
    );


  const lapById =
    new Map(
      entries.map(
        row => [
          String(
            row.apex_id
          ),
          Number(
            row.lap_count ||
            0
          )
        ]
      )
    );


  const fields =
    snapshot
      ?.fields ||
    {};

  const positions =
    snapshot
      ?.positions ||
    {};


  return rows
    .filter(
      row => {

        const id =
          String(
            row.apex_id
          );

        const currentLap =
          lapById.get(
            id
          ) || 0;

        const currentPits =
          Number(
            fields[id]
              ?.pits
          );


        if (
          Number(
            row.pit_lap
          ) >
          currentLap
        ) {
          return false;
        }


        if (
          Number.isFinite(
            currentPits
          ) &&
          Number(
            row.pit_number
          ) >
          currentPits
        ) {
          return false;
        }


        return true;
      }
    )
    .map(
      row => ({
        ...row,

        position:
          Number(
            positions[
              String(
                row.apex_id
              )
            ]
          ) ||
          null
      })
    )
    .sort(
      (a, b) =>
        (
          Number(
            a.position
          ) ||
          999999
        ) -
          (
            Number(
              b.position
            ) ||
            999999
          ) ||
        Number(
          a.pit_number
        ) -
          Number(
            b.pit_number
          )
    );
}


async function racesPayload(
  env,
  currentRaceId
) {
  const rows =
    await sbGet(
      env,
      "apex_entries",
      {
        select:
          "race_id,updated_at",

        order:
          "updated_at.desc",

        limit:
          "5000"
      }
    );


  const map =
    new Map();


  for (
    const row
    of rows
  ) {
    const id =
      Number(
        row.race_id
      );

    const timestamp =
      Date.parse(
        row.updated_at ||
        ""
      ) || 0;


    const current =
      map.get(
        id
      ) || {
        race_id:
          id,

        first_at:
          timestamp,

        last_at:
          timestamp
      };


    current.first_at =
      Math.min(
        current.first_at ||
          timestamp,
        timestamp
      );

    current.last_at =
      Math.max(
        current.last_at ||
          0,
        timestamp
      );


    map.set(
      id,
      current
    );
  }


  return [
    ...map.values()
  ]
    .sort(
      (a, b) =>
        b.last_at -
        a.last_at
    )
    .map(
      row => ({
        ...row,

        is_live:
          row.race_id ===
          currentRaceId,

        label:
          row.race_id ===
            currentRaceId
            ? "Current race"
            : (
                `Race ${row.race_id} — ` +
                new Date(
                  row.last_at
                ).toLocaleDateString(
                  "en-GB"
                )
              )
      })
    );
}


async function eventRows(
  env,
  raceId
) {
  try {
    const rows =
      await sbGet(
        env,
        "manual_lap_exclusions",
        {
          select:
            "*",

          race_id:
            `eq.${raceId}`,

          order:
            "apex_id.asc,lap_number.asc",

          limit:
            "5000"
        }
      );


    return rows.map(
      row => ({
        ...row,

        type:
          "MANUAL EXCLUSION",

        reason:
          row.reason ||
          "Excluded from analytics",

        status:
          "ACTIVE",

        time:
          row.created_at ||
          row.updated_at ||
          null
      })
    );

  } catch {
    return [];
  }
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
        return json(
          await collectorSnapshot(
            env
          )
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
                "application/json"
            }
          }
        );
      }


      const snapshot =
        await collectorSnapshot(
          env
        );

      const currentRaceId =
        Number(
          snapshot.race_id
        );

      const raceId =
        await resolveRaceId(
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
            currentRaceId,
            snapshot
          )
        );
      }


      if (
        url.pathname ===
        "/api/races"
      ) {
        return json({
          current_race_id:
            currentRaceId,

          rows:
            await racesPayload(
              env,
              currentRaceId
            )
        });
      }


      if (
        url.pathname ===
        "/api/stints"
      ) {
        return json({
          race_id:
            raceId,

          rows:
            await stintsPayload(
              env,
              raceId,
              currentRaceId,
              snapshot
            )
        });
      }


      if (
        url.pathname ===
        "/api/drivers"
      ) {
        const stints =
          await stintsPayload(
            env,
            raceId,
            currentRaceId,
            snapshot
          );


        return json({
          race_id:
            raceId,

          rows:
            aggregateDrivers(
              stints
            )
        });
      }


      if (
        url.pathname ===
        "/api/teams"
      ) {
        const stints =
          await stintsPayload(
            env,
            raceId,
            currentRaceId,
            snapshot
          );

        const drivers =
          aggregateDrivers(
            stints
          );


        return json({
          race_id:
            raceId,

          rows:
            aggregateTeams(
              drivers
            )
        });
      }


      if (
        url.pathname ===
        "/api/pits"
      ) {
        return json({
          race_id:
            raceId,

          rows:
            await pitsPayload(
              env,
              raceId,
              currentRaceId,
              snapshot
            )
        });
      }


      if (
        url.pathname ===
        "/api/events"
      ) {

        if (
          request.method ===
          "GET"
        ) {
          return json({
            race_id:
              raceId,

            rows:
              await eventRows(
                env,
                raceId
              )
          });
        }


        if (
          request.method ===
          "POST"
        ) {
          const body =
            await request.json();

          const apexId =
            String(
              body.apex_id ||
              ""
            ).trim();

          const lapNumber =
            Number(
              body.lap_number
            );


          if (
            !apexId ||
            !Number.isFinite(
              lapNumber
            ) ||
            lapNumber <= 0
          ) {
            return json(
              {
                error:
                  "apex_id and positive lap_number are required"
              },
              400
            );
          }


          await sbInsert(
            env,
            "manual_lap_exclusions",
            {
              race_id:
                raceId,

              apex_id:
                apexId,

              lap_number:
                Math.trunc(
                  lapNumber
                )
            }
          );


          return json({
            ok:
              true
          });
        }


        if (
          request.method ===
          "DELETE"
        ) {
          const apexId =
            url.searchParams.get(
              "apex_id"
            );

          const lapNumber =
            Number(
              url.searchParams.get(
                "lap_number"
              )
            );


          if (
            !apexId ||
            !Number.isFinite(
              lapNumber
            )
          ) {
            return json(
              {
                error:
                  "apex_id and lap_number are required"
              },
              400
            );
          }


          await sbDelete(
            env,
            "manual_lap_exclusions",
            {
              race_id:
                `eq.${raceId}`,

              apex_id:
                `eq.${apexId}`,

              lap_number:
                `eq.${Math.trunc(
                  lapNumber
                )}`
            }
          );


          return json({
            ok:
              true
          });
        }
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
            String(
              error
            )
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
