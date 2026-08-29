function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function raceId(env, url = null) {
  const raw =
    url?.searchParams.get("race_id") ||
    env.DEFAULT_RACE_ID ||
    "1";

  const value = Number(raw);

  return Number.isFinite(value) && value > 0
    ? Math.trunc(value)
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
        String(value)
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
        String(value)
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
    body
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
    filters
  );

function stripHtml(value) {
  return String(
    value ?? ""
  )
    .replace(
      /<br\s*\/?\s*>/gi,
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

function parseProtocolLine(line) {
  const parts =
    String(
      line || ""
    ).split("|");

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

function parseNumber(value) {
  const n =
    Number(
      String(
        value ?? ""
      ).replace(
        /[^\d.-]/g,
        ""
      )
    );

  return Number.isFinite(n)
    ? n
    : null;
}

function parseLapTime(value) {
  const text =
    stripHtml(value);

  if (
    !text ||
    text === "-"
  ) {
    return null;
  }

  if (
    text.includes(":")
  ) {
    const parts =
      text.split(":");

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
      ? minutes * 60 +
        seconds
      : null;
  }

  const n =
    Number(text);

  return Number.isFinite(n)
    ? n
    : null;
}

function cleanDriver(value) {
  return stripHtml(value)
    .replace(
      /\s*\[[^\]]+\]\s*$/,
      ""
    )
    .trim();
}

function badTeamName(
  value,
  driver = null
) {
  const text =
    stripHtml(value);

  if (!text) {
    return true;
  }

  if (
    /\[[0-9]+:[0-9]{2}(?::[0-9]{2})?\]\s*$/
      .test(text)
  ) {
    return true;
  }

  if (
    driver &&
    text.toUpperCase() ===
      String(driver)
        .trim()
        .toUpperCase()
  ) {
    return true;
  }

  return false;
}

function parseGridData(html) {
  const source =
    String(
      html || ""
    );

  const columnTypes =
    new Map();

  const positions =
    new Map();

  const rows =
    new Map();

  const headerCell =
    /<td\b([^>]*)>/gi;

  let headerMatch;

  while (
    (
      headerMatch =
        headerCell.exec(
          source
        )
    ) !== null
  ) {
    const id =
      /data-id=["'](c\d+)["']/i
        .exec(
          headerMatch[1]
        );

    const type =
      /data-type=["']([^"']+)["']/i
        .exec(
          headerMatch[1]
        );

    if (
      id &&
      type
    ) {
      columnTypes.set(
        id[1],
        type[1]
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
    const apexId =
      String(
        rowMatch[2]
      );

    const attrs =
      `${rowMatch[1]} ${rowMatch[3]}`;

    const positionMatch =
      /data-pos=["'](\d+)["']/i
        .exec(attrs);

    if (positionMatch) {
      positions.set(
        apexId,
        Number(
          positionMatch[1]
        )
      );
    }

    const fields = {};

    const cellRegex =
      /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;

    let cellMatch;

    while (
      (
        cellMatch =
          cellRegex.exec(
            rowMatch[4]
          )
      ) !== null
    ) {
      const id =
        /data-id=["']r\d+c(\d+)["']/i
          .exec(
            cellMatch[1]
          );

      const explicitType =
        /data-type=["']([^"']+)["']/i
          .exec(
            cellMatch[1]
          );

      if (!id) {
        continue;
      }

      const type =
        explicitType?.[1] ||
        columnTypes.get(
          `c${id[1]}`
        );

      if (type) {
        fields[type] =
          stripHtml(
            cellMatch[2]
          );
      }
    }

    rows.set(
      apexId,
      fields
    );
  }

  return {
    columnTypes,
    positions,
    rows
  };
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
      value /
      1000
    );

  const hours =
    Math.floor(
      total /
      3600
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
    total %
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
    !Number.isFinite(
      value
    )
  ) {
    return null;
  }

  const minutes =
    Math.floor(
      value /
      60000
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
      value %
      1000
    );

  return (
    `${minutes}:` +
    `${String(seconds).padStart(2, "0")}.` +
    `${String(millis).padStart(3, "0")}`
  );
}

function parseDrivers(raw) {
  const result =
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
    result.set(
      Number(
        match[1]
      ),
      match[2]
    );
  }

  return result;
}

function parseLapRows(
  raw,
  rid
) {
  const rows = [];

  for (
    const line
    of String(
      raw || ""
    ).split("\n")
  ) {
    const match =
      /^D(\d+)\.L0*(\d+)#(.+)$/
        .exec(
          line.trim()
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
        rid,

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
  rid
) {
  const drivers =
    parseDrivers(raw);

  const rows = [];

  for (
    const line
    of String(
      raw || ""
    ).split("\n")
  ) {
    const match =
      /^D(\d+)\.P\d+#(.+)$/
        .exec(
          line.trim()
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
        rid,

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

function stats(rows) {
  const laps =
    rows.filter(
      row =>
        Number.isFinite(
          Number(
            row.lap_time
          )
        ) &&
        Number(
          row.lap_time
        ) > 0
    );

  if (!laps.length) {
    return {
      validLaps:
        0,

      sum:
        0,

      squares:
        0,

      avg:
        null,

      best:
        null,

      bestLap:
        null,

      worst:
        null,

      worstLap:
        null,

      consistency:
        null
    };
  }

  let sum = 0;
  let squares = 0;

  let best = null;
  let bestLap = null;

  let worst = null;
  let worstLap = null;

  for (
    const row
    of laps
  ) {
    const value =
      Number(
        row.lap_time
      );

    sum +=
      value;

    squares +=
      value *
      value;

    if (
      best === null ||
      value < best
    ) {
      best =
        value;

      bestLap =
        Number(
          row.lap_number
        );
    }

    if (
      worst === null ||
      value > worst
    ) {
      worst =
        value;

      worstLap =
        Number(
          row.lap_number
        );
    }
  }

  const avg =
    sum /
    laps.length;

  return {
    validLaps:
      laps.length,

    sum,

    squares,

    avg,

    best,

    bestLap,

    worst,

    worstLap,

    consistency:
      Math.sqrt(
        Math.max(
          0,
          squares /
            laps.length -
            avg *
            avg
        )
      )
  };
}

async function stableTeamNameMap(
  env,
  rid
) {
  const [
    pits,
    completed
  ] =
    await Promise.all([
      sbGet(
        env,
        "apex_pit_stints",
        {
          select:
            "apex_id,team_name,driver_name,pit_number",

          race_id:
            `eq.${rid}`,

          order:
            "apex_id.asc,pit_number.asc"
        }
      ).catch(
        () => []
      ),

      sbGet(
        env,
        "completed_stint_stats",
        {
          select:
            "apex_id,team_name,driver_name,stint_ended_at",

          race_id:
            `eq.${rid}`,

          order:
            "stint_ended_at.asc"
        }
      ).catch(
        () => []
      )
    ]);

  const votes =
    new Map();

  for (
    const row
    of [
      ...pits,
      ...completed
    ]
  ) {
    const id =
      String(
        row.apex_id ??
        ""
      );

    const team =
      stripHtml(
        row.team_name
      );

    if (
      !id ||
      badTeamName(
        team,
        row.driver_name
      )
    ) {
      continue;
    }

    if (
      !votes.has(id)
    ) {
      votes.set(
        id,
        new Map()
      );
    }

    const bucket =
      votes.get(id);

    bucket.set(
      team,
      (
        bucket.get(team) ||
        0
      ) + 1
    );
  }

  const result =
    new Map();

  for (
    const [
      id,
      bucket
    ]
    of votes
  ) {
    const winner =
      [
        ...bucket.entries()
      ]
        .sort(
          (a, b) =>
            b[1] -
            a[1]
        )[0];

    if (winner) {
      result.set(
        id,
        winner[0]
      );
    }
  }

  return result;
}

function resolveTeam(
  id,
  map,
  driver,
  ...candidates
) {
  const stable =
    map.get(
      String(id)
    );

  if (stable) {
    return stable;
  }

  for (
    const value
    of candidates
  ) {
    const text =
      stripHtml(value);

    if (
      !badTeamName(
        text,
        driver
      )
    ) {
      return text;
    }
  }

  return null;
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

    this.packetCount =
      0;

    this.lastPacketAt =
      null;

    this.positions =
      new Map();

    this.columnTypes =
      new Map();

    this.pitCounts =
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
          await state.storage.get(
            "packetCount"
          ) || 0;

        this.lastPacketAt =
          await state.storage.get(
            "lastPacketAt"
          ) || null;

        this.positions =
          new Map(
            Object.entries(
              await state.storage.get(
                "positions"
              ) || {}
            )
          );

        this.columnTypes =
          new Map(
            Object.entries(
              await state.storage.get(
                "columnTypes"
              ) || {}
            )
          );

        this.pitCounts =
          new Map(
            Object.entries(
              await state.storage.get(
                "pitCounts"
              ) || {}
            )
              .map(
                (
                  [
                    key,
                    value
                  ]
                ) => [
                  key,
                  Number(value)
                ]
              )
          );

        this.bootstrapped =
          new Set(
            await state.storage.get(
              "bootstrapped"
            ) || []
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
    const path =
      new URL(
        request.url
      ).pathname;

    if (
      path ===
      "/start"
    ) {
      await this.connect();

      return json(
        await this.snapshot()
      );
    }

    if (
      path ===
        "/status" ||
      path ===
        "/snapshot"
    ) {
      return json(
        await this.snapshot()
      );
    }

    if (
      path ===
      "/reconnect"
    ) {
      try {
        this.ws?.close(
          1000,
          "reconnect"
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
        this.lastPacketAt,

      positions:
        Object.fromEntries(
          this.positions
        ),

      columnTypes:
        Object.fromEntries(
          this.columnTypes
        ),

      pitCounts:
        Object.fromEntries(
          this.pitCounts
        )
    };
  }

  async persist() {
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
        ),

      pitCounts:
        Object.fromEntries(
          this.pitCounts
        ),

      bootstrapped:
        [
          ...this.bootstrapped
        ]
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
                    "PACKET ERROR",
                    error
                  )
              );
        }
      );

      const disconnected =
        () => {
          this.ws =
            null;

          this.connecting =
            false;

          this.state.storage.setAlarm(
            Date.now() +
            5000
          );
        };

      ws.addEventListener(
        "close",
        disconnected
      );

      ws.addEventListener(
        "error",
        disconnected
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

  async getEntry(apexId) {
    const rows =
      await sbGet(
        this.env,
        "apex_entries",
        {
          select:
            "*",

          race_id:
            `eq.${this.rid}`,

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
    const old =
      await this.getEntry(
        update.apex_id
      );

    await sbUpsert(
      this.env,
      "apex_entries",
      {
        race_id:
          this.rid,

        apex_id:
          String(
            update.apex_id
          ),

        team_name:
          update.team_name !==
            undefined
            ? update.team_name
            : old?.team_name ??
              null,

        current_driver:
          update.current_driver !==
            undefined
            ? update.current_driver
            : old?.current_driver ??
              null,

        last_lap:
          update.last_lap !==
            undefined
            ? update.last_lap
            : old?.last_lap ??
              null,

        best_lap:
          update.best_lap !==
            undefined
            ? update.best_lap
            : old?.best_lap ??
              null,

        lap_count:
          update.lap_count !==
            undefined
            ? update.lap_count
            : old?.lap_count ??
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
    currentLap,
    full = false
  ) {
    const count =
      full
        ? Math.max(
            1,
            currentLap
          )
        : Math.max(
            1,
            Math.min(
              currentLap,
              180
            )
          );

    const request =
      `D#-${count}` +
      `#D${apexId}.L#-${count}` +
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

  async exclusions(
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
              `eq.${this.rid}`,

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
            lap =>
              Number.isFinite(
                lap
              ) &&
              lap > startLap &&
              lap <= endLap
          )
      );

    } catch {
      return new Set();
    }
  }

  async rebuildStints(
    apexId,
    entry,
    lapRows,
    pitRows,
    full
  ) {
    const currentLap =
      Number(
        entry?.lap_count ||
        0
      );

    if (!currentLap) {
      return;
    }

    const pits =
      [
        ...pitRows
      ]
        .filter(
          pit =>
            Number(
              pit.pit_lap
            ) > 0 &&
            Number(
              pit.pit_lap
            ) <= currentLap
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

    const manual =
      await this.exclusions(
        apexId,
        0,
        currentLap
      );

    const pitLaps =
      new Set();

    for (
      const pit
      of pits
    ) {
      const lap =
        Number(
          pit.pit_lap
        );

      pitLaps.add(lap);
      pitLaps.add(
        lap + 1
      );
    }

    const valid =
      (
        start,
        end
      ) =>
        lapRows.filter(
          row => {
            const lap =
              Number(
                row.lap_number
              );

            const lapTime =
              Number(
                row.lap_time
              );

            return (
              Number.isFinite(
                lap
              ) &&
              lap > start &&
              lap <= end &&
              Number.isFinite(
                lapTime
              ) &&
              lapTime > 0 &&
              lapTime <= 90 &&
              !manual.has(
                lap
              ) &&
              !pitLaps.has(
                lap
              )
            );
          }
        );

    if (full) {
      await sbDelete(
        this.env,
        "completed_stint_stats",
        {
          race_id:
            `eq.${this.rid}`,

          apex_id:
            `eq.${apexId}`
        }
      );

      const completed = [];

      let start = 0;

      for (
        const pit
        of pits
      ) {
        const end =
          Number(
            pit.pit_lap
          );

        const calculated =
          stats(
            valid(
              start,
              end
            )
          );

        if (
          pit.driver_name
        ) {
          completed.push({
            race_id:
              this.rid,

            apex_id:
              String(
                apexId
              ),

            team_name:
              entry.team_name,

            driver_name:
              pit.driver_name,

            start_lap_count:
              start,

            end_lap_count:
              end,

            total_laps:
              Math.max(
                0,
                end -
                start
              ),

            valid_laps:
              calculated.validLaps,

            avg_lap:
              calculated.avg,

            best_lap:
              calculated.best,

            best_lap_number:
              calculated.bestLap,

            worst_lap:
              calculated.worst,

            worst_lap_number:
              calculated.worstLap,

            consistency:
              calculated.consistency,

            stint_started_at:
              new Date()
                .toISOString(),

            stint_ended_at:
              new Date()
                .toISOString()
          });
        }

        start =
          end;
      }

      if (
        completed.length
      ) {
        await sbInsert(
          this.env,
          "completed_stint_stats",
          completed
        );
      }
    }

    const start =
      pits.length
        ? Number(
            pits[
              pits.length -
              1
            ].pit_lap
          )
        : 0;

    if (
      !entry.current_driver
    ) {
      return;
    }

    const currentRows =
      valid(
        start,
        currentLap
      );

    const calculated =
      stats(
        currentRows
      );

    await sbUpsert(
      this.env,
      "live_stint_stats",
      {
        race_id:
          this.rid,

        apex_id:
          String(
            apexId
          ),

        team_name:
          entry.team_name,

        driver_name:
          entry.current_driver,

        start_lap_count:
          start,

        current_lap_count:
          currentLap,

        total_laps:
          Math.max(
            0,
            currentLap -
            start
          ),

        valid_laps:
          calculated.validLaps,

        lap_sum:
          calculated.sum,

        lap_sum_squares:
          calculated.squares,

        last_lap:
          Number(
            entry.last_lap
          ) || null,

        avg_lap:
          calculated.avg,

        best_lap:
          calculated.best,

        best_lap_number:
          calculated.bestLap,

        worst_lap:
          calculated.worst,

        worst_lap_number:
          calculated.worstLap,

        consistency:
          calculated.consistency,

        stint_started_at:
          new Date()
            .toISOString(),

        updated_at:
          new Date()
            .toISOString()
      },
      "race_id,apex_id"
    );
  }

  async refreshTeam(
    apexId,
    force = false
  ) {
    const id =
      String(
        apexId
      );

    if (
      this.detailRunning
        .has(id)
    ) {
      return;
    }

    const entry =
      await this.getEntry(
        apexId
      );

    const currentLap =
      Number(
        entry?.lap_count ||
        0
      );

    if (
      !entry ||
      currentLap <= 0
    ) {
      return;
    }

    const now =
      Date.now();

    if (
      !force &&
      now -
        (
          this.lastDetailFetch
            .get(id) ||
          0
        ) <
        1500
    ) {
      return;
    }

    this.lastDetailFetch.set(
      id,
      now
    );

    this.detailRunning.add(
      id
    );

    try {
      const full =
        !this.bootstrapped.has(
          id
        );

      const raw =
        await this.requestDetails(
          apexId,
          currentLap,
          full
        );

      const laps =
        parseLapRows(
          raw,
          this.rid
        );

      const pits =
        parsePitRows(
          raw,
          entry.team_name,
          this.rid
        );

      for (
        let index = 0;
        index < laps.length;
        index += 250
      ) {
        await sbUpsert(
          this.env,
          "apex_lap_events",
          laps.slice(
            index,
            index +
            250
          ),
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

        this.pitCounts.set(
          id,
          Math.max(
            ...pits.map(
              pit =>
                Number(
                  pit.pit_number
                ) || 0
            )
          )
        );
      }

      await this.rebuildStints(
        apexId,
        (
          await this.getEntry(
            apexId
          )
        ) ||
        entry,
        laps,
        pits,
        full
      );

      if (full) {
        this.bootstrapped.add(
          id
        );

        await this.persist();
      }

    } catch (error) {
      console.error(
        "DETAIL REFRESH ERROR",
        apexId,
        error
      );

    } finally {
      this.detailRunning.delete(
        id
      );
    }
  }

  async driverChange(
    apexId,
    driverName
  ) {
    if (!driverName) {
      return;
    }

    const old =
      await this.getEntry(
        apexId
      );

    if (
      old?.current_driver ===
      driverName
    ) {
      return;
    }

    if (
      old &&
      Number(
        old.lap_count
      ) > 0
    ) {
      await this.refreshTeam(
        apexId,
        true
      );
    }

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

  async lapCount(
    apexId,
    value
  ) {
    const lapCount =
      Number(value);

    if (
      !Number.isFinite(
        lapCount
      )
    ) {
      return;
    }

    const old =
      await this.getEntry(
        apexId
      );

    await this.upsertEntry({
      apex_id:
        apexId,

      lap_count:
        lapCount
    });

    if (
      Number(
        old?.lap_count ??
        -1
      ) !==
      lapCount
    ) {
      await this.refreshTeam(
        apexId,
        true
      );
    }
  }

  async applyField(
    apexId,
    type,
    cls,
    value,
    column = null
  ) {

    /*
     * IMPORTANT:
     *
     * DRIVER FIRST.
     *
     * Apex can send drteam inside a column whose
     * configured data-type is "dr".
     *
     * The old code tested type === "dr" first,
     * so:
     *
     * ADRIAN ANACHKOV [4:39]
     *
     * was written into team_name.
     */

    if (
      cls ===
        "drteam" ||
      type ===
        "drteam"
    ) {
      const driver =
        cleanDriver(
          value
        );

      if (driver) {
        await this.driverChange(
          apexId,
          driver
        );
      }

      return;
    }

    /*
     * Only an ACTUAL dr packet is allowed
     * to modify team_name.
     */

    if (
      cls ===
      "dr"
    ) {
      const team =
        stripHtml(
          value
        );

      if (
        team &&
        !badTeamName(
          team
        )
      ) {
        await this.upsertEntry({
          apex_id:
            apexId,

          team_name:
            team
        });
      }

      return;
    }

    if (
      type ===
        "rk" ||
      cls ===
        "rk"
    ) {
      const position =
        parseNumber(
          value
        );

      if (
        position !== null &&
        position > 0
      ) {
        this.positions.set(
          String(
            apexId
          ),
          Math.trunc(
            position
          )
        );
      }

      return;
    }

    if (
      type ===
        "pit" ||
      cls ===
        "pit"
    ) {
      const pitCount =
        parseNumber(
          value
        );

      if (
        pitCount !== null &&
        pitCount >= 0
      ) {
        this.pitCounts.set(
          String(
            apexId
          ),
          Math.trunc(
            pitCount
          )
        );
      }

      return;
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

      return;
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

      return;
    }

    if (
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
    ) {
      const lapCount =
        parseNumber(
          value
        );

      if (
        lapCount !==
          null &&
        Number.isInteger(
          lapCount
        ) &&
        lapCount >= 0
      ) {
        await this.lapCount(
          apexId,
          lapCount
        );
      }
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

      if (
        !update.id
      ) {
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
          grid.columnTypes.size
        ) {
          this.columnTypes =
            grid.columnTypes;
        }

        if (
          grid.positions.size
        ) {
          this.positions =
            grid.positions;
        }

        for (
          const [
            apexId,
            fields
          ]
          of grid.rows
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
            await this.applyField(
              apexId,
              type,
              type,
              value,
              null
            );
          }
        }

        await this.persist();

        continue;
      }

      const row =
        parseRowId(
          update.id
        );

      if (!row) {
        continue;
      }

      const type =
        this.columnTypes.get(
          `c${row.column}`
        ) ||
        update.cls;

      await this.applyField(
        row.apexId,
        type,
        update.cls,
        update.value,
        row.column
      );
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
      await this.persist();
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

async function stintsPayload(
  env,
  rid
) {
  const [
    completed,
    live,
    teamMap
  ] =
    await Promise.all([
      sbGet(
        env,
        "completed_stint_stats",
        {
          select:
            "*",

          race_id:
            `eq.${rid}`,

          order:
            "apex_id.asc,start_lap_count.asc"
        }
      ),

      sbGet(
        env,
        "live_stint_stats",
        {
          select:
            "*",

          race_id:
            `eq.${rid}`,

          order:
            "apex_id.asc,start_lap_count.asc"
        }
      ),

      stableTeamNameMap(
        env,
        rid
      )
    ]);

  const rows = [
    ...completed.map(
      row => ({
        ...row,

        is_live:
          false,

        team_name:
          resolveTeam(
            row.apex_id,
            teamMap,
            row.driver_name,
            row.team_name
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
    ),

    ...live.map(
      row => ({
        ...row,

        is_live:
          true,

        end_lap_count:
          null,

        team_name:
          resolveTeam(
            row.apex_id,
            teamMap,
            row.driver_name,
            row.team_name
          ),

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

  const groups =
    new Map();

  for (
    const row
    of rows
  ) {
    const id =
      String(
        row.apex_id ??
        ""
      );

    if (
      !groups.has(id)
    ) {
      groups.set(
        id,
        []
      );
    }

    groups
      .get(id)
      .push(row);
  }

  const result = [];

  for (
    const group
    of groups.values()
  ) {
    group.sort(
      (a, b) =>
        Number(
          a.start_lap_count ??
          0
        ) -
        Number(
          b.start_lap_count ??
          0
        )
    );

    group.forEach(
      (
        row,
        index
      ) =>
        result.push({
          ...row,

          stint_number:
            index + 1
        })
    );
  }

  return result;
}

async function livePayload(
  env,
  rid
) {
  const [
    entries,
    stints,
    pits,
    snapshot,
    teamMap
  ] =
    await Promise.all([
      sbGet(
        env,
        "apex_entries",
        {
          select:
            "*",

          race_id:
            `eq.${rid}`,

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
            `eq.${rid}`
        }
      ),

      sbGet(
        env,
        "apex_pit_stints",
        {
          select:
            "apex_id,pit_number,pit_lap,team_name,driver_name",

          race_id:
            `eq.${rid}`,

          order:
            "apex_id.asc,pit_number.asc"
        }
      ),

      collectorSnapshot(
        env
      ).catch(
        () => ({
          positions:
            {},

          pitCounts:
            {}
        })
      ),

      stableTeamNameMap(
        env,
        rid
      )
    ]);

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
        Number(rid),

      session_name:
        "Apex Timing",

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

  const stintMap =
    new Map(
      stints.map(
        row => [
          String(
            row.apex_id
          ),
          row
        ]
      )
    );

  const pitCount =
    new Map();

  const lastPitLap =
    new Map();

  for (
    const pit
    of pits
  ) {
    const id =
      String(
        pit.apex_id
      );

    const number =
      Number(
        pit.pit_number
      );

    const lap =
      Number(
        pit.pit_lap
      );

    if (
      Number.isFinite(
        number
      )
    ) {
      pitCount.set(
        id,
        Math.max(
          pitCount.get(id) ||
          0,
          number
        )
      );
    }

    if (
      Number.isFinite(
        lap
      )
    ) {
      lastPitLap.set(
        id,
        Math.max(
          lastPitLap.get(id) ||
          0,
          lap
        )
      );
    }
  }

  for (
    const [
      id,
      value
    ]
    of Object.entries(
      snapshot.pitCounts ||
      {}
    )
  ) {
    const count =
      Number(value);

    if (
      Number.isFinite(
        count
      ) &&
      count >= 0
    ) {
      pitCount.set(
        id,
        Math.max(
          pitCount.get(id) ||
          0,
          Math.trunc(
            count
          )
        )
      );
    }
  }

  const current =
    activeEntries.map(
      entry => {
        const id =
          String(
            entry.apex_id
          );

        const stint =
          stintMap.get(
            id
          ) || {};

        const raceLap =
          Number(
            entry.lap_count ??
            stint.current_lap_count ??
            0
          ) || 0;

        const pitsNow =
          pitCount.get(id) ||
          0;

        const start =
          Number(
            stint.start_lap_count ??
            lastPitLap.get(id) ??
            0
          ) || 0;

        const driver =
          stint.driver_name ??
          entry.current_driver ??
          null;

        return {
          race_id:
            Number(rid),

          apex_id:
            entry.apex_id,

          position:
            Number(
              snapshot.positions?.[
                id
              ]
            ) || null,

          team_name:
            resolveTeam(
              id,
              teamMap,
              driver,
              stint.team_name,
              entry.team_name
            ),

          driver_name:
            driver,

          current_driver:
            driver,

          race_lap:
            raceLap,

          live_lap_count:
            raceLap,

          pit_count:
            pitsNow,

          stint_number:
            pitsNow +
            1,

          start_lap_count:
            start,

          stint_laps:
            Math.max(
              0,
              raceLap -
              start
            ),

          total_stint_laps:
            Number(
              stint.total_laps ??
              Math.max(
                0,
                raceLap -
                start
              )
            ) || 0,

          valid_laps:
            Number(
              stint.valid_laps ??
              0
            ) || 0,

          live_last_lap:
            entry.last_lap ??
            stint.last_lap ??
            null,

          avg_lap_time:
            stint.avg_lap ??
            null,

          best_lap_time:
            stint.best_lap ??
            entry.best_lap ??
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

          updated_at:
            entry.updated_at ??
            stint.updated_at ??
            null
        };
      }
    );

  current.sort(
    (a, b) => {
      const positionA =
        Number(
          a.position
        ) || 999999;

      const positionB =
        Number(
          b.position
        ) || 999999;

      if (
        positionA !==
        positionB
      ) {
        return (
          positionA -
          positionB
        );
      }

      if (
        a.race_lap !==
        b.race_lap
      ) {
        return (
          b.race_lap -
          a.race_lap
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
      Number(rid),

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

async function overviewPayload(
  env,
  rid
) {
  const [
    entries,
    stints,
    pits,
    snapshot,
    teamMap
  ] =
    await Promise.all([
      sbGet(
        env,
        "apex_entries",
        {
          select:
            "*",

          race_id:
            `eq.${rid}`,

          order:
            "updated_at.desc"
        }
      ),

      stintsPayload(
        env,
        rid
      ),

      sbGet(
        env,
        "apex_pit_stints",
        {
          select:
            "apex_id,pit_number,pit_lap",

          race_id:
            `eq.${rid}`,

          order:
            "apex_id.asc,pit_number.asc"
        }
      ),

      collectorSnapshot(
        env
      ).catch(
        () => ({
          positions:
            {},

          pitCounts:
            {}
        })
      ),

      stableTeamNameMap(
        env,
        rid
      )
    ]);

  const entryMap =
    new Map();

  for (
    const entry
    of entries
  ) {
    const id =
      String(
        entry.apex_id
      );

    if (
      !entryMap.has(
        id
      )
    ) {
      entryMap.set(
        id,
        entry
      );
    }
  }

  const latestStint =
    new Map();

  for (
    const stint
    of stints
  ) {
    const id =
      String(
        stint.apex_id
      );

    const old =
      latestStint.get(
        id
      );

    if (
      !old ||
      Number(
        stint.start_lap_count ??
        0
      ) >=
        Number(
          old.start_lap_count ??
          0
        )
    ) {
      latestStint.set(
        id,
        stint
      );
    }
  }

  const pitCount =
    new Map();

  const lastPit =
    new Map();

  for (
    const pit
    of pits
  ) {
    const id =
      String(
        pit.apex_id
      );

    const number =
      Number(
        pit.pit_number
      );

    const lap =
      Number(
        pit.pit_lap
      );

    if (
      Number.isFinite(
        number
      )
    ) {
      pitCount.set(
        id,
        Math.max(
          pitCount.get(id) ||
          0,
          number
        )
      );
    }

    if (
      Number.isFinite(
        lap
      )
    ) {
      lastPit.set(
        id,
        Math.max(
          lastPit.get(id) ||
          0,
          lap
        )
      );
    }
  }

  for (
    const [
      id,
      value
    ]
    of Object.entries(
      snapshot.pitCounts ||
      {}
    )
  ) {
    const count =
      Number(value);

    if (
      Number.isFinite(
        count
      ) &&
      count >= 0
    ) {
      pitCount.set(
        id,
        Math.max(
          pitCount.get(id) ||
          0,
          Math.trunc(
            count
          )
        )
      );
    }
  }

  const ids =
    new Set([
      ...entryMap.keys(),
      ...latestStint.keys()
    ]);

  const rows = [];

  for (
    const id
    of ids
  ) {
    const entry =
      entryMap.get(
        id
      ) || {};

    const stint =
      latestStint.get(
        id
      ) || {};

    const raceLap =
      Number(
        entry.lap_count ??
        stint.current_lap_count ??
        stint.end_lap_count ??
        0
      ) || 0;

    const pitsNow =
      pitCount.get(id) ||
      0;

    const start =
      Number(
        stint.start_lap_count ??
        lastPit.get(id) ??
        0
      ) || 0;

    const driver =
      stint.driver_name ??
      entry.current_driver ??
      null;

    rows.push({
      race_id:
        Number(rid),

      apex_id:
        entry.apex_id ??
        stint.apex_id ??
        id,

      position:
        Number(
          snapshot.positions?.[
            id
          ]
        ) || null,

      team_name:
        resolveTeam(
          id,
          teamMap,
          driver,
          stint.team_name,
          entry.team_name
        ),

      driver_name:
        driver,

      current_driver:
        driver,

      race_lap:
        raceLap,

      pit_count:
        pitsNow,

      stint_number:
        stint.stint_number ??
        (
          pitsNow +
          1
        ),

      start_lap_count:
        start,

      stint_laps:
        Math.max(
          0,
          raceLap -
          start
        ),

      total_stint_laps:
        Number(
          stint.total_laps ??
          Math.max(
            0,
            raceLap -
            start
          )
        ) || 0,

      valid_laps:
        Number(
          stint.valid_laps ??
          0
        ) || 0,

      live_last_lap:
        entry.last_lap ??
        stint.last_lap ??
        null,

      avg_lap_time:
        stint.avg_lap_time ??
        stint.avg_lap ??
        null,

      best_lap_time:
        stint.best_lap_time ??
        stint.best_lap ??
        entry.best_lap ??
        null,

      best_lap_number:
        stint.best_lap_number ??
        null,

      worst_lap_time:
        stint.worst_lap_time ??
        stint.worst_lap ??
        null,

      worst_lap_number:
        stint.worst_lap_number ??
        null,

      consistency:
        stint.consistency ??
        null,

      updated_at:
        entry.updated_at ??
        stint.updated_at ??
        stint.stint_ended_at ??
        null
    });
  }

  rows.sort(
    (a, b) => {
      const positionA =
        Number(
          a.position
        ) || 999999;

      const positionB =
        Number(
          b.position
        ) || 999999;

      if (
        positionA !==
        positionB
      ) {
        return (
          positionA -
          positionB
        );
      }

      if (
        a.race_lap !==
        b.race_lap
      ) {
        return (
          b.race_lap -
          a.race_lap
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

  rows.forEach(
    (
      row,
      index
    ) => {
      if (!row.position) {
        row.position =
          index + 1;
      }
    }
  );

  return rows;
}

async function driversPayload(
  env,
  rid
) {
  const stints =
    await stintsPayload(
      env,
      rid
    );

  const groups =
    new Map();

  for (
    const stint
    of stints
  ) {
    const driver =
      stint.driver_name ??
      stint.current_driver;

    if (!driver) {
      continue;
    }

    const key =
      `${stint.apex_id}::${driver}`;

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
      .get(key)
      .push(stint);
  }

  const rows = [];

  for (
    const group
    of groups.values()
  ) {
    const first =
      group[0];

    let validStints = 0;
    let shortStints = 0;

    let validLaps = 0;
    let totalLaps = 0;

    let weighted = 0;
    let weight = 0;

    let best = null;

    let consistencySum = 0;
    let consistencyWeight = 0;

    for (
      const row
      of group
    ) {
      const valid =
        Number(
          row.valid_laps ??
          0
        ) || 0;

      const total =
        Number(
          row.total_laps ??
          row.total_stint_laps ??
          valid
        ) || 0;

      const avg =
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

      if (
        valid >= 3
      ) {
        validStints += 1;

      } else if (
        valid > 0
      ) {
        shortStints += 1;
      }

      validLaps +=
        valid;

      totalLaps +=
        total;

      if (
        Number.isFinite(
          avg
        ) &&
        valid > 0
      ) {
        weighted +=
          avg *
          valid;

        weight +=
          valid;
      }

      if (
        Number.isFinite(
          bestLap
        ) &&
        bestLap > 0 &&
        (
          best === null ||
          bestLap < best
        )
      ) {
        best =
          bestLap;
      }

      if (
        Number.isFinite(
          consistency
        ) &&
        valid > 0
      ) {
        consistencySum +=
          consistency *
          valid;

        consistencyWeight +=
          valid;
      }
    }

    rows.push({
      race_id:
        Number(rid),

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
        validStints +
        shortStints,

      valid_stint_count:
        validStints,

      short_stint_count:
        shortStints,

      valid_laps:
        validLaps,

      total_laps:
        totalLaps,

      avg_lap_time:
        weight
          ? weighted /
            weight
          : null,

      best_lap_time:
        best,

      avg_consistency:
        consistencyWeight
          ? consistencySum /
            consistencyWeight
          : null
    });
  }

  return rows;
}

async function teamsPayload(
  env,
  rid
) {
  const drivers =
    await driversPayload(
      env,
      rid
    );

  const groups =
    new Map();

  for (
    const row
    of drivers
  ) {
    const key =
      String(
        row.apex_id ??
        row.team_name ??
        ""
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
      .get(key)
      .push(row);
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
              sum,
              row
            ) =>
              sum +
              Number(
                row.valid_laps ||
                0
              ),
            0
          );

        const totalLaps =
          group.reduce(
            (
              sum,
              row
            ) =>
              sum +
              Number(
                row.total_laps ||
                0
              ),
            0
          );

        const stintCount =
          group.reduce(
            (
              sum,
              row
            ) =>
              sum +
              Number(
                row.stint_count ||
                0
              ),
            0
          );

        const weighted =
          group.reduce(
            (
              sum,
              row
            ) =>
              sum +
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

        const best =
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
                value > 0
            );

        const averages =
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
                value > 0
            );

        const consistencies =
          group
            .map(
              row =>
                Number(
                  row.avg_consistency
                )
            )
            .filter(
              Number.isFinite
            );

        return {
          race_id:
            Number(rid),

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
            best.length
              ? Math.min(
                  ...best
                )
              : null,

          avg_consistency:
            consistencies.length
              ? consistencies.reduce(
                  (
                    a,
                    b
                  ) =>
                    a + b,
                  0
                ) /
                consistencies.length
              : null,

          driver_spread:
            averages.length > 1
              ? Math.max(
                  ...averages
                ) -
                Math.min(
                  ...averages
                )
              : 0
        };
      }
    );
}

async function racesPayload(env) {
  const rows =
    await sbGet(
      env,
      "races",
      {
        select:
          "*",

        order:
          "id.desc"
      }
    );

  return rows.map(
    row => {
      const id =
        row.id ??
        row.race_id;

      const rawDate =
        row.started_at ??
        row.start_time ??
        row.created_at ??
        row.race_date ??
        row.date ??
        null;

      let date = "";

      if (rawDate) {
        const parsedDate =
          new Date(
            rawDate
          );

        if (
          !Number.isNaN(
            parsedDate.getTime()
          )
        ) {
          date =
            parsedDate
              .toLocaleDateString(
                "en-GB",
                {
                  day:
                    "2-digit",

                  month:
                    "2-digit",

                  year:
                    "numeric",

                  timeZone:
                    "Europe/Sofia"
                }
              );
        }
      }

      return {
        ...row,

        id,

        race_id:
          id,

        label:
          row.name ??
          row.session_name ??
          row.title ??
          (
            date
              ? `Race ${id} — ${date}`
              : `Race ${id}`
          )
      };
    }
  );
}

async function eventsPayload(
  env,
  rid
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
            `eq.${rid}`,

          order:
            "apex_id.asc,lap_number.asc"
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

    const rid =
      raceId(
        env,
        url
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
            raceId(env)
          )
        );
      }


      if (
        url.pathname ===
        "/api/races"
      ) {
        return json({
          current_race_id:
            raceId(env),

          rows:
            await racesPayload(
              env
            )
        });
      }


      if (
        url.pathname ===
        "/api/overview"
      ) {
        return json({
          race_id:
            rid,

          rows:
            await overviewPayload(
              env,
              rid
            )
        });
      }


      if (
        url.pathname ===
        "/api/stints"
      ) {
        return json({
          race_id:
            rid,

          rows:
            await stintsPayload(
              env,
              rid
            )
        });
      }


      if (
        url.pathname ===
        "/api/drivers"
      ) {
        return json({
          race_id:
            rid,

          rows:
            await driversPayload(
              env,
              rid
            )
        });
      }


      if (
        url.pathname ===
        "/api/teams"
      ) {
        return json({
          race_id:
            rid,

          rows:
            await teamsPayload(
              env,
              rid
            )
        });
      }


      if (
        url.pathname ===
        "/api/pits"
      ) {
        const teamMap =
          await stableTeamNameMap(
            env,
            rid
          );

        const rows =
          await sbGet(
            env,
            "apex_pit_stints",
            {
              select:
                "*",

              race_id:
                `eq.${rid}`,

              order:
                "apex_id.asc,pit_number.asc"
            }
          );

        return json({
          race_id:
            rid,

          rows:
            rows.map(
              row => ({
                ...row,

                team_name:
                  resolveTeam(
                    row.apex_id,
                    teamMap,
                    row.driver_name,
                    row.team_name
                  )
              })
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
              rid,

            rows:
              await eventsPayload(
                env,
                rid
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

          const lap =
            Number(
              body.lap_number
            );

          if (
            !apexId ||
            !Number.isFinite(
              lap
            ) ||
            lap <= 0
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
                rid,

              apex_id:
                apexId,

              lap_number:
                Math.trunc(
                  lap
                ),

              reason:
                body.reason ||
                null
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

          const lap =
            Number(
              url.searchParams.get(
                "lap_number"
              )
            );

          if (
            !apexId ||
            !Number.isFinite(
              lap
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
                `eq.${rid}`,

              apex_id:
                `eq.${apexId}`,

              lap_number:
                `eq.${Math.trunc(
                  lap
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
        console.error
      )
    );
  }
};
