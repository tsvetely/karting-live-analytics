const VERSION = "2026-08-30-race-datasets-v6.23-apex-sync";

const PAGE_SIZE = 1000;

let directSnapshotCache = null;
let directSnapshotCacheAt = 0;
let directSnapshotPending = null;


// ============================================================
// RESPONSE
// ============================================================

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


function textResponse(
  value,
  contentType,
  filename = null
) {
  const headers = {
    "content-type":
      `${contentType}; charset=utf-8`,

    "cache-control":
      "no-store"
  };


  if (filename) {
    headers[
      "content-disposition"
    ] =
      `attachment; filename="${filename}"`;
  }


  return new Response(
    value,
    {
      status: 200,
      headers
    }
  );
}


// ============================================================
// RACE ID
// ============================================================

function raceId(env, url = null) {
  const raw =
    url?.searchParams.get(
      "race_id"
    ) ||
    env.DEFAULT_RACE_ID ||
    "1";


  const value =
    Number(raw);


  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return 1;
  }


  return Math.trunc(value);
}


// ============================================================
// SUPABASE
// ============================================================

function sbHeaders(
  env,
  extra = {}
) {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_KEY
  ) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_KEY"
    );
  }


  return {
    apikey:
      env.SUPABASE_KEY,

    authorization:
      `Bearer ${env.SUPABASE_KEY}`,

    "content-type":
      "application/json",

    ...extra
  };
}


async function sbGet(
  env,
  table,
  params = {},
  range = null
) {
  const url =
    new URL(
      `/rest/v1/${table}`,
      env.SUPABASE_URL
    );


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      params
    )
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


  const headers =
    sbHeaders(
      env,
      {
        accept:
          "application/json"
      }
    );


  if (range) {
    headers.Range =
      `${range.from}-${range.to}`;

    headers["Range-Unit"] =
      "items";
  }


  const response =
    await fetch(
      url,
      {
        headers
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


async function sbGetAll(
  env,
  table,
  params = {}
) {
  const result = [];

  let from = 0;


  while (true) {
    const rows =
      await sbGet(
        env,
        table,
        params,
        {
          from,
          to:
            from +
            PAGE_SIZE -
            1
        }
      );


    result.push(
      ...rows
    );


    if (
      rows.length <
      PAGE_SIZE
    ) {
      break;
    }


    from +=
      PAGE_SIZE;
  }


  return result;
}


async function sbWrite(
  env,
  table,
  method,
  body,
  params = {},
  prefer =
    "return=minimal"
) {
  const url =
    new URL(
      `/rest/v1/${table}`,
      env.SUPABASE_URL
    );


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      params
    )
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
            : JSON.stringify(
                body
              )
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


function sbInsert(
  env,
  table,
  body
) {
  return sbWrite(
    env,
    table,
    "POST",
    body
  );
}


function sbUpsert(
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
      on_conflict:
        conflict
    },
    "resolution=merge-duplicates,return=minimal,missing=default"
  );
}


function sbDelete(
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
// TEXT / NUMBER HELPERS
// ============================================================

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


function cleanDriver(value) {
  return stripHtml(
    value
  )
    .replace(
      /\s*\[[^\]]+\]\s*$/,
      ""
    )
    .trim();
}


function number(value) {
  const parsed =
    Number(value);

  return Number.isFinite(
    parsed
  )
    ? parsed
    : null;
}


function parseNumber(value) {
  const parsed =
    Number(
      String(
        value ?? ""
      )
        .replace(
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
      Number(
        parts[0]
      );

    const seconds =
      Number(
        parts[1]
      );


    if (
      !Number.isFinite(
        minutes
      ) ||
      !Number.isFinite(
        seconds
      )
    ) {
      return null;
    }


    return (
      minutes * 60 +
      seconds
    );
  }


  const parsed =
    Number(text);


  return Number.isFinite(
    parsed
  )
    ? parsed
    : null;
}


function formatLapTime(value) {
  const seconds =
    Number(value);


  if (
    !Number.isFinite(
      seconds
    ) ||
    seconds <= 0
  ) {
    return "";
  }


  if (
    seconds < 60
  ) {
    return seconds
      .toFixed(3);
  }


  const minutes =
    Math.floor(
      seconds / 60
    );


  const rest =
    (
      seconds -
      minutes * 60
    )
      .toFixed(3)
      .padStart(
        6,
        "0"
      );


  return (
    `${minutes}:${rest}`
  );
}


function badTeamName(
  team,
  driver = null
) {
  const value =
    stripHtml(team);


  if (!value) {
    return true;
  }


  if (
    driver &&
    value.toUpperCase() ===
      String(driver)
        .trim()
        .toUpperCase()
  ) {
    return true;
  }


  return false;
}


// ============================================================
// PROTOCOL
// ============================================================

function parseProtocolLine(line) {
  const parts =
    String(
      line || ""
    )
      .split("|");


  return {
    id:
      parts[0] ||
      "",

    cls:
      parts[1] ||
      "",

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
      match[2] ||
      null
  };
}


// ============================================================
// GRID
// ============================================================

function parseGridData(html) {
  const source = String(html || "");
  const columnTypes = new Map();
  const positions = new Map();
  const rows = new Map();

  let match;
  const headerRegex = /<td\b([^>]*)>/gi;
  while ((match = headerRegex.exec(source)) !== null) {
    const id = /data-id=["'](c\d+)["']/i.exec(match[1]);
    const type = /data-type=["']([^"']+)["']/i.exec(match[1]);
    if (id && type) columnTypes.set(id[1], type[1]);
  }

  const rowRegex = /<tr\b([^>]*)data-id=["']r(\d+)["']([^>]*)>([\s\S]*?)<\/tr>/gi;
  while ((match = rowRegex.exec(source)) !== null) {
    const apexId = String(match[2]);
    if (!validApexId(apexId)) continue;

    const attrs = `${match[1]} ${match[3]}`;
    const positionMatch = /data-pos=["'](\d+)["']/i.exec(attrs);
    if (positionMatch) positions.set(apexId, Number(positionMatch[1]));

    const fields = {};
    let cellMatch;
    const cellRegex = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
    while ((cellMatch = cellRegex.exec(match[4])) !== null) {
      const id = /data-id=["']r\d+c(\d+)["']/i.exec(cellMatch[1]);
      if (!id) continue;
      const column = id[1];
      const explicitType = /data-type=["']([^"']+)["']/i.exec(cellMatch[1]);
      const type = explicitType?.[1] || columnTypes.get(`c${column}`) || "";
      fields[`c${column}`] = {
        column,
        type,
        value: stripHtml(cellMatch[2])
      };
    }
    rows.set(apexId, fields);
  }

  return { columnTypes, positions, rows };
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


  const seconds =
    Math.floor(
      value / 1000
    );


  const h =
    Math.floor(
      seconds / 3600
    );


  const m =
    Math.floor(
      (
        seconds %
        3600
      ) / 60
    );


  const s =
    seconds % 60;


  return (
    `${String(h).padStart(2, "0")}:` +
    `${String(m).padStart(2, "0")}:` +
    `${String(s).padStart(2, "0")}`
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
          )
            .toFixed(3)
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
        String(
          match[1]
        ),

      team_name:
        teamName ||
        null,

      pit_number:
        pitNumber,

      pit_lap:
        pitLap,

      pit_hour:
        msToTime(
          parts[2]
        ),

      pit_time:
        msToPitTime(
          parts[4]
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
        ) ||
        null,

      total_time:
        msToTime(
          parts[8]
        ),

      updated_at:
        new Date()
          .toISOString()
    });
  }


  return rows;
}


// ============================================================
// LOADERS
// ============================================================

function loadEntries(
  env,
  rid
) {
  return sbGetAll(
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
  );
}


function loadPits(
  env,
  rid,
  apexId = null
) {
  const params = {
    select:
      "*",

    race_id:
      `eq.${rid}`,

    order:
      "apex_id.asc,pit_number.asc"
  };


  if (apexId) {
    params.apex_id =
      `eq.${apexId}`;
  }


  return sbGetAll(
    env,
    "apex_pit_stints",
    params
  );
}


function loadCompletedStints(
  env,
  rid
) {
  return sbGetAll(
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
  )
    .catch(
      () => []
    );
}


function loadLiveStints(
  env,
  rid
) {
  return sbGetAll(
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
  )
    .catch(
      () => []
    );
}


function loadExclusions(
  env,
  rid
) {
  return sbGetAll(
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
  )
    .catch(
      () => []
    );
}


// ============================================================
// TEAM NAME MAP
// ============================================================

async function stableTeamNameMap(
  env,
  rid
) {
  const [
    entries,
    pits,
    completed,
    live
  ] =
    await Promise.all([
      loadEntries(
        env,
        rid
      )
        .catch(
          () => []
        ),

      loadPits(
        env,
        rid
      )
        .catch(
          () => []
        ),

      loadCompletedStints(
        env,
        rid
      ),

      loadLiveStints(
        env,
        rid
      )
    ]);


  const result =
    new Map();


  for (
    const row
    of [
      ...entries,
      ...pits,
      ...completed,
      ...live
    ]
  ) {
    const id =
      String(
        row.apex_id ??
        ""
      );


    if (!id) {
      continue;
    }


    const team =
      stripHtml(
        row.team_name
      );


    const driver =
      row.driver_name ||
      row.current_driver ||
      null;


    if (
      !badTeamName(
        team,
        driver
      )
    ) {
      if (
        !result.has(id)
      ) {
        result.set(
          id,
          team
        );
      }
    }
  }


  return result;
}


function resolveTeam(
  apexId,
  teamMap,
  ...candidates
) {
  const stable =
    teamMap.get(
      String(
        apexId
      )
    );


  if (stable) {
    return stable;
  }


  for (
    const value
    of candidates
  ) {
    const clean =
      stripHtml(
        value
      );


    if (clean) {
      return clean;
    }
  }


  return null;
}


// ============================================================
// COLLECTOR STUB
// ============================================================

function collectorStub(env) {
  return env
    .APEX_COLLECTOR
    .get(
      env
        .APEX_COLLECTOR
        .idFromName(
          "primary"
        )
    );
}


async function collectorSnapshot(env) {
  // Use the durable collector only when its snapshot is fresh.  When the DO
  // is unavailable/stale, obtain the current Apex full grid directly instead
  // of inventing a field from old database rows.
  try {
    if (env?.APEX_COLLECTOR) {
      const response = await collectorStub(env).fetch("https://collector/snapshot");
      if (response.ok) {
        const snapshot = await response.json();
        const last = Date.parse(snapshot?.last_packet_at || "") || 0;
        const ids = currentFieldIds(snapshot);
        if (ids.size > 0 && last > 0 && Date.now() - last < 90000) {
          return snapshot;
        }
      }
    }
  } catch (error) {
    console.warn("COLLECTOR SNAPSHOT FALLBACK:", error?.message || error);
  }

  return directApexSnapshot(env);
}


async function startCollector(env) {
  const response =
    await collectorStub(
      env
    )
      .fetch(
        "https://collector/start"
      );


  if (!response.ok) {
    throw new Error(
      "Collector start failed"
    );
  }


  return response.json();
}


// ============================================================
// CURRENT FIELD
// ============================================================

function validApexId(value) {
  const text =
    String(value ?? "")
      .trim();

  if (!text) {
    return false;
  }

  const numeric =
    Number(text);

  return (
    Number.isFinite(numeric) &&
    numeric > 0
  );
}


function currentFieldIds(
  snapshot
) {
  const result =
    new Set();


  for (
    const value
    of snapshot?.fieldApexIds ||
    []
  ) {
    if (
      validApexId(value)
    ) {
      result.add(
        String(value).trim()
      );
    }
  }


  /*
   * Compatibility with collector state created before
   * fieldApexIds existed.
   *
   * IMPORTANT: r0 / apex_id 0 is a protocol/service row,
   * not a kart. It must never become a 73rd team.
   */
  if (
    result.size === 0 &&
    snapshot?.positions
  ) {
    for (
      const value
      of Object.keys(
        snapshot.positions
      )
    ) {
      if (
        validApexId(value)
      ) {
        result.add(
          String(value).trim()
        );
      }
    }
  }


  return result;
}


function snapshotFromGrid(grid) {
  const fieldApexIds = [];
  const positions = Object.fromEntries(grid?.positions || []);
  const pitCounts = {};
  const lapCounts = {};
  const bestLaps = {};
  const lastLaps = {};
  const teamNames = {};
  const drivers = {};

  for (const [rawId, fields] of grid?.rows || []) {
    const id = String(rawId);
    if (!validApexId(id)) continue;
    fieldApexIds.push(id);

    for (const cell of Object.values(fields || {})) {
      const type = String(cell?.type || "").toLowerCase();
      const column = String(cell?.column || "");
      const value = cell?.value;

      if (type === "drteam") {
        const driver = cleanDriver(value);
        if (driver) drivers[id] = driver;
        continue;
      }
      if (type === "dr") {
        const team = stripHtml(value);
        if (team) teamNames[id] = team;
        continue;
      }
      if (type === "pit" || (type === "" && column === "15")) {
        const n = parseNumber(value);
        if (n !== null && n >= 0) pitCounts[id] = Math.trunc(n);
        continue;
      }
      if (type === "tlp" || (type === "" && column === "13")) {
        const n = parseNumber(value);
        if (n !== null && n >= 0) lapCounts[id] = Math.trunc(n);
        continue;
      }
      if (type === "llp" || (type === "" && column === "9")) {
        const n = parseLapTime(value);
        if (n !== null && n > 0) lastLaps[id] = n;
        continue;
      }
      // Overall race best is accepted only from Apex's semantic BLP field.
      // No guessed column index and no current-stint best fallback.
      if (type === "blp") {
        const n = parseLapTime(value);
        if (n !== null && n > 0) bestLaps[id] = n;
      }
    }
  }

  const stamp = new Date().toISOString();
  return {
    connected: true,
    direct_live: true,
    data_source: "apex-live-grid",
    packet_count: 1,
    last_packet_at: stamp,
    last_grid_at: stamp,
    field_count: fieldApexIds.length,
    fieldApexIds,
    positions,
    columnTypes: Object.fromEntries(grid?.columnTypes || []),
    pitCounts,
    lapCounts,
    bestLaps,
    lastLaps,
    teamNames,
    drivers
  };
}

function gridFromApexPayload(payload) {
  const text = String(payload || "");
  let best = null;

  if (text.includes("<tr") && text.includes("data-id=")) {
    const grid = parseGridData(text);
    if (grid.rows.size) best = grid;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const update = parseProtocolLine(line);
    if (update.id !== "grid") continue;
    const grid = parseGridData(update.value);
    if (!best || grid.rows.size > best.rows.size) best = grid;
  }

  return best;
}

async function directApexSnapshot(env) {
  const now = Date.now();
  if (directSnapshotCache && now - directSnapshotCacheAt < 2500) {
    return directSnapshotCache;
  }
  if (directSnapshotPending) return directSnapshotPending;

  directSnapshotPending = new Promise((resolve, reject) => {
    let settled = false;
    let ws = null;
    let timer = null;

    const finish = (error, snapshot) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { ws?.close(1000, "snapshot complete"); } catch {}
      if (error) reject(error);
      else resolve(snapshot);
    };

    timer = setTimeout(() => finish(new Error("Apex live grid timeout")), 7000);

    try {
      ws = new WebSocket(env.APEX_WS_URL || "wss://live-data.apex-timing.com:8913/");
      ws.addEventListener("message", async event => {
        try {
          let payload;
          if (typeof event.data === "string") payload = event.data;
          else if (event.data && typeof event.data.text === "function") payload = await event.data.text();
          else payload = new TextDecoder().decode(event.data);

          const grid = gridFromApexPayload(payload);
          if (!grid || grid.rows.size < 10) return;
          const snapshot = snapshotFromGrid(grid);
          if (!snapshot.field_count) return;

          directSnapshotCache = snapshot;
          directSnapshotCacheAt = Date.now();
          finish(null, snapshot);
        } catch (error) {
          console.warn("DIRECT GRID PACKET:", error?.message || error);
        }
      });
      ws.addEventListener("error", () => finish(new Error("Apex live websocket error")));
      ws.addEventListener("close", () => {
        if (!settled) finish(new Error("Apex live websocket closed before grid"));
      });
    } catch (error) {
      finish(error);
    }
  }).finally(() => {
    directSnapshotPending = null;
  });

  return directSnapshotPending;
}


function filterCurrentField(
  rows,
  fieldIds
) {
  if (
    !fieldIds ||
    fieldIds.size === 0
  ) {
    return [];
  }


  return rows.filter(
    row => {
      const id =
        String(
          row.apex_id ?? ""
        )
          .trim();

      return (
        validApexId(id) &&
        fieldIds.has(id)
      );
    }
  );
}


// ============================================================
// NORMALIZE STINT
// ============================================================

function normalizeStintRow(
  row,
  teamMap,
  status
) {
  return {
    race_id:
      Number(
        row.race_id
      ),

    apex_id:
      String(
        row.apex_id
      ),

    team_name:
      resolveTeam(
        row.apex_id,
        teamMap,
        row.team_name
      ),

    driver_name:
      row.driver_name ||
      null,

    stint_number:
      number(
        row.stint_number
      ),

    start_lap_count:
      number(
        row.start_lap_count
      ) ??
      0,

    end_lap_count:
      status === "LIVE"
        ? null
        : number(
            row.end_lap_count
          ),

    current_lap_count:
      number(
        row.current_lap_count
      ),

    total_laps:
      number(
        row.total_laps
      ) ??
      0,

    valid_laps:
      number(
        row.valid_laps
      ) ??
      0,

    avg_lap_time:
      number(
        row.avg_lap_time ??
        row.avg_lap
      ),

    best_lap_time:
      number(
        row.best_lap_time ??
        row.best_lap
      ),

    best_lap_number:
      number(
        row.best_lap_number
      ),

    worst_lap_time:
      number(
        row.worst_lap_time ??
        row.worst_lap
      ),

    worst_lap_number:
      number(
        row.worst_lap_number
      ),

    consistency:
      number(
        row.consistency
      ),

    pit_hour:
      row.pit_hour ||
      null,

    on_track:
      row.on_track ||
      null,

    pit_time:
      row.pit_time ||
      null,

    total_time:
      row.total_time ||
      null,

    is_live:
      status === "LIVE",

    status
  };
}


// ============================================================
// FALLBACK STINTS FROM PIT DATA
//
// IMPORTANT:
// This does NOT invent lap statistics.
// It only reconstructs stint boundaries when a completed
// statistics row is missing.
//
// Driver in apex_pit_stints belongs to the stint that ENDS at
// that pit stop.
// ============================================================

function fallbackStintsFromPits(
  pits,
  entries,
  teamMap
) {
  const entriesById =
    new Map(
      entries.map(
        row => [
          String(
            row.apex_id
          ),
          row
        ]
      )
    );


  const grouped =
    new Map();


  for (
    const pit
    of pits
  ) {
    const id =
      String(
        pit.apex_id
      );


    if (
      !grouped.has(id)
    ) {
      grouped.set(
        id,
        []
      );
    }


    grouped
      .get(id)
      .push(pit);
  }


  const result = [];


  for (
    const [
      id,
      teamPits
    ]
    of grouped
  ) {
    teamPits.sort(
      (a, b) =>
        Number(
          a.pit_number
        ) -
        Number(
          b.pit_number
        )
    );


    let previous =
      0;


    for (
      let i = 0;
      i <
        teamPits.length;
      i++
    ) {
      const pit =
        teamPits[i];


      const end =
        Number(
          pit.pit_lap
        );


      if (
        !Number.isFinite(end) ||
        end <= previous
      ) {
        continue;
      }


      result.push({
        race_id:
          Number(
            pit.race_id
          ),

        apex_id:
          id,

        team_name:
          resolveTeam(
            id,
            teamMap,
            pit.team_name
          ),

        driver_name:
          pit.driver_name ||
          null,

        stint_number:
          i + 1,

        start_lap_count:
          previous,

        end_lap_count:
          end,

        current_lap_count:
          null,

        total_laps:
          Math.max(
            0,
            end -
            previous
          ),

        valid_laps:
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

        pit_hour:
          pit.pit_hour ||
          null,

        on_track:
          pit.on_track ||
          null,

        pit_time:
          pit.pit_time ||
          null,

        total_time:
          pit.total_time ||
          null,

        is_live:
          false,

        status:
          "COMPLETED"
      });


      previous =
        end;
    }


    const entry =
      entriesById.get(id);


    const currentLap =
      Number(
        entry?.lap_count
      );


    if (
      Number.isFinite(
        currentLap
      ) &&
      currentLap >
        previous
    ) {
      result.push({
        race_id:
          Number(
            entry.race_id
          ),

        apex_id:
          id,

        team_name:
          resolveTeam(
            id,
            teamMap,
            entry.team_name
          ),

        driver_name:
          entry.current_driver ||
          null,

        stint_number:
          teamPits.length +
          1,

        start_lap_count:
          previous,

        end_lap_count:
          null,

        current_lap_count:
          currentLap,

        total_laps:
          Math.max(
            0,
            currentLap -
            previous
          ),

        valid_laps:
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

        is_live:
          true,

        status:
          "LIVE"
      });
    }
  }


  return result;
}


// ============================================================
// CURRENT SESSION PIT CHAIN + RAW ANALYTICS
// ============================================================

function currentPitChain(pits, snapshot) {
  const counts = snapshot?.pitCounts || {};
  const grouped = new Map();

  for (const row of pits || []) {
    const id = String(row.apex_id ?? "").trim();
    const pitNumber = Number(row.pit_number);
    const pitLap = Number(row.pit_lap);
    if (!validApexId(id) || !Number.isFinite(pitNumber) || pitNumber <= 0 || !Number.isFinite(pitLap) || pitLap <= 0) continue;
    if (!grouped.has(id)) grouped.set(id, new Map());
    const byNumber = grouped.get(id);
    const n = Math.trunc(pitNumber);
    const prev = byNumber.get(n);
    const t = Date.parse(row.updated_at || "") || 0;
    const pt = Date.parse(prev?.updated_at || "") || 0;
    if (!prev || t >= pt) byNumber.set(n, row);
  }

  const result = [];
  for (const [id, byNumber] of grouped) {
    const currentCount = Number(counts[id]);
    let rows = [...byNumber.entries()]
      .sort((a,b) => a[0]-b[0]);
    if (Number.isFinite(currentCount) && currentCount >= 0) {
      const n = Math.trunc(currentCount);
      rows = rows.filter(([pitNumber]) => pitNumber >= 1 && pitNumber <= n);
    }
    result.push(...rows.map(([,row]) => row));
  }
  return result;
}

async function loadLapEventsForApexIds(env, rid, fieldIds) {
  const ids = [...(fieldIds || [])].map(String).filter(validApexId);
  if (!ids.length) return [];
  return sbGetAll(env, "apex_lap_events", {
    select: "apex_id,lap_number,lap_time",
    race_id: `eq.${rid}`,
    apex_id: `in.(${ids.join(",")})`,
    order: "apex_id.asc,lap_number.asc"
  }).catch(() => []);
}

function manualExclusionSet(rows) {
  const out = new Set();
  for (const row of rows || []) {
    const id = String(row.apex_id ?? "").trim();
    const lap = Number(row.lap_number);
    if (validApexId(id) && Number.isFinite(lap)) out.add(`${id}:${Math.trunc(lap)}`);
  }
  return out;
}

function lapStats(items) {
  const valid = (items || [])
    .filter(r => Number.isFinite(Number(r.lap)) && Number.isFinite(Number(r.time)) && Number(r.time) > 0)
    .map(r => ({ lap: Math.trunc(Number(r.lap)), time: Number(r.time) }))
    .sort((a,b)=>a.lap-b.lap);

  if (!valid.length) {
    return {
      valid_laps: 0,
      avg_lap_time: null,
      best_lap_time: null,
      best_lap_number: null,
      worst_lap_time: null,
      worst_lap_number: null,
      consistency: null
    };
  }

  let best=valid[0], worst=valid[0];
  for (const r of valid) {
    if (r.time < best.time) best=r;
    if (r.time > worst.time) worst=r;
  }

  // KartingNumbersXlsx: an average is only valid with at least 3 laps.
  const avg = valid.length >= 3
    ? valid.reduce((sum,r)=>sum+r.time,0)/valid.length
    : null;

  return {
    valid_laps: valid.length,
    avg_lap_time: avg,
    best_lap_time: best.time,
    best_lap_number: best.lap,
    worst_lap_time: worst.time,
    worst_lap_number: worst.lap,
    // Keep LIVE consistent with the macOS analysis: consistency = average - best.
    consistency: avg !== null ? avg - best.time : null
  };
}

function median(values) {
  const sorted=(values||[]).filter(Number.isFinite).sort((a,b)=>a-b);
  return sorted.length ? sorted[Math.floor(sorted.length/2)] : null;
}

function directionSplitRangeForLaps(lapRows, directionSplitLap) {
  const split=Number(directionSplitLap);
  if (!Number.isFinite(split)) return {straightEndLap:null,reverseStartLap:null,transitionLaps:new Set()};

  const nearby=(lapRows||[])
    .map(r=>({lap:Number(r.lap_number ?? r.lap),time:Number(r.lap_time ?? r.time)}))
    .filter(r=>Number.isFinite(r.lap)&&Number.isFinite(r.time)&&Math.abs(r.lap-split)<=20)
    .sort((a,b)=>a.lap-b.lap);

  const normalTimes=nearby.map(r=>r.time).filter(t=>t>0&&t<67).sort((a,b)=>a-b);
  const normalMedian=normalTimes.length ? normalTimes[Math.floor(normalTimes.length/2)] : 61.0;
  const safetyThreshold=Math.max(68.0,normalMedian*1.10);
  const slow=nearby.filter(r=>r.time>=safetyThreshold).map(r=>Math.trunc(r.lap)).sort((a,b)=>a-b);
  const blocks=[];
  for (const lap of slow) {
    const last=blocks.length ? blocks[blocks.length-1] : null;
    if (last && last[last.length-1]+1===lap) last.push(lap); else blocks.push([lap]);
  }
  const valid=blocks.filter(b=>b.length>=3);
  if (!valid.length) {
    return {straightEndLap:Math.trunc(split),reverseStartLap:Math.trunc(split)+1,transitionLaps:new Set()};
  }
  valid.sort((a,b)=>Math.abs(a[a.length-1]-split)-Math.abs(b[b.length-1]-split));
  const block=valid[0], first=block[0], last=block[block.length-1];
  return {straightEndLap:first-1,reverseStartLap:last+1,transitionLaps:new Set(block)};
}

function hmsSeconds(value) {
  const m=/^(\d+):(\d{2}):(\d{2})$/.exec(String(value||'').trim());
  if (!m) return null;
  return Number(m[1])*3600+Number(m[2])*60+Number(m[3]);
}

function automaticDirectionSplitLapFromPits(pits) {
  const timed=(pits||[]).map(p=>({lap:Number(p.pit_lap),seconds:hmsSeconds(p.pit_hour)}))
    .filter(r=>Number.isFinite(r.lap)&&Number.isFinite(r.seconds));
  if (!timed.length) return null;
  const maxSeconds=Math.max(...timed.map(r=>r.seconds));
  const middle=maxSeconds/2;
  const candidates=timed.filter(r=>r.seconds>=middle).map(r=>r.lap);
  return candidates.length ? Math.min(...candidates) : null;
}

function detectGlobalDisruptionLaps(lapsById) {
  const minimumSlowRatio=0.50, slowdownMultiplier=1.12, recoveryMultiplier=1.04, baselineWindow=5;
  const ids=[...lapsById.keys()];
  const byId=new Map();
  const allLapNumbers=new Set();
  for (const id of ids) {
    const rows=(lapsById.get(id)||[]).map(r=>({lap:Number(r.lap_number),time:Number(r.lap_time)}))
      .filter(r=>Number.isFinite(r.lap)&&Number.isFinite(r.time)&&r.time>0).sort((a,b)=>a.lap-b.lap);
    byId.set(id,rows);
    rows.forEach(r=>allLapNumbers.add(r.lap));
  }
  const slow=new Set();
  for (const lap of [...allLapNumbers].sort((a,b)=>a-b)) {
    let comparable=0, slowdown=0;
    for (const id of ids) {
      const rows=byId.get(id)||[];
      const current=rows.find(r=>r.lap===lap); if (!current) continue;
      const prev=rows.filter(r=>r.lap<lap&&r.lap>=lap-baselineWindow);
      if (prev.length<2) continue;
      const baseline=prev.reduce((sum,r)=>sum+r.time,0)/prev.length;
      comparable++; if (current.time>=baseline*slowdownMultiplier) slowdown++;
    }
    if (comparable>0 && slowdown/comparable>minimumSlowRatio) slow.add(lap);
  }
  const excluded=new Set(), sorted=[...slow].sort((a,b)=>a-b);
  let i=0;
  while(i<sorted.length){
    const begin=sorted[i]; let finish=begin;
    while(i+1<sorted.length&&sorted[i+1]===finish+1){i++;finish=sorted[i];}
    let recovered=0;
    for(const id of ids){
      const rows=byId.get(id)||[];
      const before=rows.filter(r=>r.lap<begin&&r.lap>=begin-baselineWindow);
      if(!before.length) continue;
      const baseline=before.reduce((sum,r)=>sum+r.time,0)/before.length;
      if(rows.some(r=>r.lap>finish&&r.time<=baseline*recoveryMultiplier)) recovered++;
    }
    if(recovered/Math.max(ids.length,1)>minimumSlowRatio){for(let lap=begin;lap<=finish;lap++)excluded.add(lap);}
    i++;
  }
  return excluded;
}

function detectGlobalRainTransitionLap(lapsById, globalExcluded) {
  const byLap=new Map();
  for(const rows of lapsById.values()) for(const row of rows||[]){
    const lap=Number(row.lap_number),time=Number(row.lap_time);
    if(!Number.isFinite(lap)||!Number.isFinite(time)||time<=0||globalExcluded.has(lap))continue;
    if(!byLap.has(lap))byLap.set(lap,[]); byLap.get(lap).push(time);
  }
  const maxParticipation=Math.max(0,...[...byLap.values()].map(v=>v.length));
  if(!maxParticipation)return null;
  const minimumParticipation=Math.max(3,Math.trunc(maxParticipation*0.35));
  const series=[...byLap.entries()].filter(([,v])=>v.length>=minimumParticipation)
    .map(([lap,v])=>({lap:Number(lap),median:median(v)})).sort((a,b)=>a.lap-b.lap);
  if(series.length<10)return null;
  const refCount=Math.max(3,Math.trunc(series.length/20));
  const dry=median(series.slice(0,Math.trunc(series.length/2)).map(r=>r.median));
  const final=median(series.slice(-refCount).map(r=>r.median));
  if(!Number.isFinite(dry)||!Number.isFinite(final)||final<=dry)return null;
  const level=dry+(final-dry)*0.20;
  for(const item of series){
    if(item.median<level)continue;
    const remaining=series.filter(r=>r.lap>=item.lap);
    if(remaining.filter(r=>r.median>=level).length/remaining.length>=0.75)return item.lap;
  }
  return null;
}

function detectRainStartLapsById(lapsById, globalTransitionLap, globalExcluded) {
  const result=new Map();
  if(!Number.isFinite(globalTransitionLap))return result;
  for(const [id,raw] of lapsById){
    const laps=(raw||[]).map(r=>({lap:Number(r.lap_number),time:Number(r.lap_time)}))
      .filter(r=>Number.isFinite(r.lap)&&Number.isFinite(r.time)&&r.time>0&&!globalExcluded.has(r.lap)).sort((a,b)=>a.lap-b.lap);
    const dryMedian=median(laps.filter(r=>r.lap<globalTransitionLap).map(r=>r.time));
    if(!Number.isFinite(dryMedian))continue;
    const threshold=dryMedian*1.10;
    for(const candidate of laps){
      if(candidate.time<threshold)continue;
      const remaining=laps.filter(r=>r.lap>=candidate.lap);
      const remainingMedian=median(remaining.map(r=>r.time));
      if(Number.isFinite(remainingMedian)&&remainingMedian>=threshold){result.set(String(id),candidate.lap);break;}
    }
  }
  return result;
}

function calculateRawStintStats(apexId, lapRows, startLap, endLap, exclusions, options = {}) {
  const start = Number(startLap) || 0;
  const end = Number(endLap);
  if (!Number.isFinite(end) || end <= start) return null;

  const byLap = new Map();
  for (const row of lapRows || []) {
    const lap = Number(row.lap_number);
    const time = Number(row.lap_time);
    if (Number.isFinite(lap) && lap > 0 && Number.isFinite(time) && time > 0) byLap.set(Math.trunc(lap), time);
  }

  const pitOut = start > 0 ? start + 1 : null;
  const globalExcluded=options.globalExcluded || new Set();
  const splitRange=options.splitRange || {straightEndLap:null,reverseStartLap:null,transitionLaps:new Set()};
  const rainStartLap=Number(options.rainStartLap);
  const counted=[];
  for (const [lap,time] of byLap) {
    if (lap <= start || lap > end) continue;
    if (pitOut !== null && lap === pitOut) continue;
    if (exclusions.has(`${apexId}:${lap}`)) continue;
    if (globalExcluded.has(lap)) continue;
    if (splitRange.transitionLaps?.has(lap)) continue;
    counted.push({lap,time});
  }

  const overall=lapStats(counted);
  const isRain=lap=>Number.isFinite(rainStartLap)&&lap>=rainStartLap;
  const straight=counted.filter(r=>!isRain(r.lap)&&Number.isFinite(splitRange.straightEndLap)&&r.lap<=splitRange.straightEndLap);
  const reverse=counted.filter(r=>!isRain(r.lap)&&Number.isFinite(splitRange.reverseStartLap)&&r.lap>=splitRange.reverseStartLap);
  const rain=counted.filter(r=>isRain(r.lap));
  const ss=lapStats(straight), rs=lapStats(reverse), rainStats=lapStats(rain);

  return {
    ...overall,
    straight_valid_laps:ss.valid_laps, straight_avg_lap_time:ss.avg_lap_time, straight_best_lap_time:ss.best_lap_time,
    straight_best_lap_number:ss.best_lap_number, straight_worst_lap_time:ss.worst_lap_time, straight_worst_lap_number:ss.worst_lap_number,
    reverse_valid_laps:rs.valid_laps, reverse_avg_lap_time:rs.avg_lap_time, reverse_best_lap_time:rs.best_lap_time,
    reverse_best_lap_number:rs.best_lap_number, reverse_worst_lap_time:rs.worst_lap_time, reverse_worst_lap_number:rs.worst_lap_number,
    rain_valid_laps:rainStats.valid_laps, rain_avg_lap_time:rainStats.avg_lap_time, rain_best_lap_time:rainStats.best_lap_time,
    rain_best_lap_number:rainStats.best_lap_number, rain_worst_lap_time:rainStats.worst_lap_time, rain_worst_lap_number:rainStats.worst_lap_number,
    direction_transition_laps:[...(splitRange.transitionLaps||[])].sort((a,b)=>a-b), rain_start_lap:Number.isFinite(rainStartLap)?rainStartLap:null
  };
}

// ============================================================
// STINT DATASET
// ============================================================

async function stintsPayload(env, rid, snapshot = null) {
  const isCurrentRace = Number(rid) === Number(raceId(env));
  const realSnapshot = isCurrentRace ? (snapshot || await collectorSnapshot(env).catch(() => null)) : null;

  const [pitsRaw, entriesRaw, exclusionsRaw, teamMap] = await Promise.all([
    loadPits(env, rid),
    loadEntries(env, rid),
    loadExclusions(env, rid),
    stableTeamNameMap(env, rid)
  ]);

  const fieldIds = isCurrentRace
    ? currentFieldIds(realSnapshot)
    : new Set(entriesRaw.map(row => String(row.apex_id ?? "").trim()).filter(validApexId));

  if (!fieldIds.size) return [];

  const lapRaw = await loadLapEventsForApexIds(env, rid, [...fieldIds]);
  const entries = filterCurrentField(entriesRaw, fieldIds);
  const pits = isCurrentRace
    ? currentPitChain(filterCurrentField(pitsRaw, fieldIds), realSnapshot)
    : filterCurrentField(pitsRaw, fieldIds);
  const exclusions = manualExclusionSet(filterCurrentField(exclusionsRaw, fieldIds));

  const entriesById = new Map(entries.map(r => [String(r.apex_id), r]));
  const pitsById = new Map();
  const lapsById = new Map();
  for (const row of pits) {
    const id=String(row.apex_id);
    if (!pitsById.has(id)) pitsById.set(id,[]);
    pitsById.get(id).push(row);
  }
  for (const row of lapRaw) {
    const id=String(row.apex_id);
    if (!fieldIds.has(id)) continue;
    if (!lapsById.has(id)) lapsById.set(id,[]);
    lapsById.get(id).push(row);
  }

  const globalExcluded = detectGlobalDisruptionLaps(lapsById);
  const directionSplitLap = automaticDirectionSplitLapFromPits(pits);
  const globalRainTransitionLap = detectGlobalRainTransitionLap(lapsById, globalExcluded);
  const rainStartById = detectRainStartLapsById(lapsById, globalRainTransitionLap, globalExcluded);
  const splitById = new Map();
  for (const id of fieldIds) {
    splitById.set(String(id), directionSplitRangeForLaps(lapsById.get(String(id)) || [], directionSplitLap));
  }

  const result=[];
  for (const value of fieldIds) {
    const id=String(value);
    const entry=entriesById.get(id) || {};
    const teamPits=[...(pitsById.get(id)||[])].sort((a,b)=>Number(a.pit_number)-Number(b.pit_number));
    const laps=lapsById.get(id)||[];
    let start=0;
    let stintNumber=1;

    for (const pit of teamPits) {
      const end=Number(pit.pit_lap);
      if (!Number.isFinite(end) || end<=start) continue;
      const stats=calculateRawStintStats(id,laps,start,end,exclusions,{globalExcluded,splitRange:splitById.get(id),rainStartLap:rainStartById.get(id)}) || {
        valid_laps:0, avg_lap_time:null, best_lap_time:null, best_lap_number:null,
        worst_lap_time:null, worst_lap_number:null, consistency:null
      };
      result.push({
        race_id:Number(rid), apex_id:id,
        team_name:resolveTeam(id,teamMap,entry.team_name,pit.team_name),
        driver_name:pit.driver_name || null,
        stint_number:stintNumber++, start_lap_count:start, end_lap_count:end,
        current_lap_count:end, total_laps:end-start, ...stats,
        pit_hour:pit.pit_hour||null, on_track:pit.on_track||null,
        pit_time:pit.pit_time||null, total_time:pit.total_time||null,
        is_live:false, status:"COMPLETED", direction_split_lap:directionSplitLap, global_rain_transition_lap:globalRainTransitionLap
      });
      start=end;
    }

    const snapshotLap=Number(realSnapshot?.lapCounts?.[id]);
    const entryLap=Number(entry.lap_count);
    const lastRecordedLap = laps.reduce((max,row)=>Math.max(max,Number(row.lap_number)||0),0);
    const currentLap=isCurrentRace && Number.isFinite(snapshotLap) ? snapshotLap : (Number.isFinite(entryLap) ? entryLap : lastRecordedLap);
    const expectedPitCount=isCurrentRace ? Number(realSnapshot?.pitCounts?.[id]) : teamPits.length;
    if (Number.isFinite(currentLap) && currentLap>=start) {
      const emptyStats={
        valid_laps:0, avg_lap_time:null, best_lap_time:null, best_lap_number:null,
        worst_lap_time:null, worst_lap_number:null, consistency:null,
        straight_valid_laps:0,straight_avg_lap_time:null,straight_best_lap_time:null,straight_best_lap_number:null,straight_worst_lap_time:null,straight_worst_lap_number:null,
        reverse_valid_laps:0,reverse_avg_lap_time:null,reverse_best_lap_time:null,reverse_best_lap_number:null,reverse_worst_lap_time:null,reverse_worst_lap_number:null,
        rain_valid_laps:0,rain_avg_lap_time:null,rain_best_lap_time:null,rain_best_lap_number:null,rain_worst_lap_time:null,rain_worst_lap_number:null
      };
      const stats=currentLap>start
        ? (calculateRawStintStats(id,laps,start,currentLap,exclusions,{globalExcluded,splitRange:splitById.get(id),rainStartLap:rainStartById.get(id)}) || emptyStats)
        : emptyStats;
      const liveStintNumber=isCurrentRace && Number.isFinite(expectedPitCount)
        ? Math.max(1,Math.trunc(expectedPitCount)+1)
        : stintNumber;
      result.push({
        race_id:Number(rid), apex_id:id,
        team_name:resolveTeam(id,teamMap,entry.team_name),
        driver_name:entry.current_driver||null,
        stint_number:liveStintNumber, start_lap_count:start,
        end_lap_count:isCurrentRace?null:currentLap,
        current_lap_count:currentLap, total_laps:Math.max(0,currentLap-start), ...stats,
        pit_hour:null,on_track:null,pit_time:null,total_time:null,
        is_live:isCurrentRace,status:isCurrentRace?"LIVE":"COMPLETED",
        data_complete:true, expected_pit_count:Number.isFinite(expectedPitCount)?Math.trunc(expectedPitCount):null, stored_pit_count:teamPits.length,
        direction_split_lap:directionSplitLap, global_rain_transition_lap:globalRainTransitionLap
      });
    }
  }

  result.sort((a,b)=>{
    if (isCurrentRace) {
      const pa=Number(realSnapshot?.positions?.[String(a.apex_id)]), pb=Number(realSnapshot?.positions?.[String(b.apex_id)]);
      if (Number.isFinite(pa)&&Number.isFinite(pb)&&pa!==pb) return pa-pb;
      if (Number.isFinite(pa)) return -1;
      if (Number.isFinite(pb)) return 1;
    }
    const c=Number(a.apex_id)-Number(b.apex_id);
    return c || Number(a.stint_number)-Number(b.stint_number);
  });
  return result;
}

// ============================================================
// DRIVER DATASET
// ============================================================

function driversFromStints(stints) {
  const groups =
    new Map();


  for (
    const stint
    of stints
  ) {
    const driver =
      stripHtml(
        stint.driver_name
      );


    if (!driver) {
      continue;
    }


    const key =
      `${stint.apex_id}::${driver}`;


    if (
      !groups.has(key)
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

    let weightedAverage = 0;
    let weightedCount = 0;

    let best = null;

    let consistencyTotal = 0;
    let consistencyCount = 0;


    for (
      const row
      of group
    ) {
      const valid =
        Number(
          row.valid_laps
        ) ||
        0;


      const total =
        Number(
          row.total_laps
        ) ||
        0;


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


      const avg =
        Number(
          row.avg_lap_time
        );


      if (
        Number.isFinite(avg) &&
        avg > 0 &&
        valid > 0
      ) {
        weightedAverage +=
          avg * valid;

        weightedCount +=
          valid;
      }


      const rowBest =
        Number(
          row.best_lap_time
        );


      if (
        Number.isFinite(
          rowBest
        ) &&
        rowBest > 0 &&
        (
          best === null ||
          rowBest < best
        )
      ) {
        best =
          rowBest;
      }


      const consistency =
        Number(
          row.consistency
        );


      if (
        Number.isFinite(
          consistency
        ) &&
        valid > 0
      ) {
        consistencyTotal +=
          consistency *
          valid;

        consistencyCount +=
          valid;
      }
    }


    rows.push({
      race_id:
        first.race_id,

      apex_id:
        first.apex_id,

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
        weightedCount > 0
          ? weightedAverage /
            weightedCount
          : null,

      best_lap_time:
        best,

      avg_consistency:
        consistencyCount > 0
          ? consistencyTotal /
            consistencyCount
          : null
    });
  }


  return rows;
}


// ============================================================
// TEAM DATASET
// ============================================================

function aggregateStintStats(rows, prefix = "") {
  const validKey=`${prefix}valid_laps`;
  const avgKey=`${prefix}avg_lap_time`;
  const bestKey=`${prefix}best_lap_time`;
  const bestLapKey=`${prefix}best_lap_number`;
  const worstKey=`${prefix}worst_lap_time`;
  const worstLapKey=`${prefix}worst_lap_number`;
  let count=0, weighted=0, best=null, bestLap=null, worst=null, worstLap=null;
  for(const row of rows||[]){
    const n=Number(row[validKey])||0, avg=Number(row[avgKey]);
    count+=n;
    if(n>=3&&Number.isFinite(avg)&&avg>0) weighted+=avg*n;
    const b=Number(row[bestKey]); if(Number.isFinite(b)&&b>0&&(best===null||b<best)){best=b;bestLap=number(row[bestLapKey]);}
    const w=Number(row[worstKey]); if(Number.isFinite(w)&&w>0&&(worst===null||w>worst)){worst=w;worstLap=number(row[worstLapKey]);}
  }
  const avg=count>=3 ? weighted/count : null;
  return {valid_laps:count,avg_lap_time:avg,best_lap_time:best,best_lap_number:bestLap,worst_lap_time:worst,worst_lap_number:worstLap,consistency:avg!==null&&best!==null?avg-best:null};
}

function teamsFromStints(stints, snapshot) {
  const grouped=new Map();
  for(const row of stints||[]){const id=String(row.apex_id);if(!grouped.has(id))grouped.set(id,[]);grouped.get(id).push(row);}
  const out=[];
  for(const [id,rows] of grouped){
    const overall=aggregateStintStats(rows,''), straight=aggregateStintStats(rows,'straight_'), reverse=aggregateStintStats(rows,'reverse_'), rain=aggregateStintStats(rows,'rain_');
    const drivers=[...new Set(rows.map(r=>cleanDriver(r.driver_name)).filter(Boolean))];
    const byDriver=new Map();
    for(const r of rows){const d=cleanDriver(r.driver_name);if(!d)continue;if(!byDriver.has(d))byDriver.set(d,[]);byDriver.get(d).push(r);}
    const driverAvgs=[...byDriver.values()].map(g=>aggregateStintStats(g,'').avg_lap_time).filter(Number.isFinite);
    const pos=Number(snapshot?.positions?.[id]);
    out.push({
      race_id:rows[0]?.race_id,apex_id:id,position:Number.isFinite(pos)?pos:null,team_name:rows[0]?.team_name||`APEX ${id}`,
      driver_count:drivers.length,drivers:drivers.length,stint_count:rows.length,valid_stint_count:rows.filter(r=>(Number(r.valid_laps)||0)>=3).length,
      valid_laps:overall.valid_laps,total_laps:rows.reduce((s,r)=>s+(Number(r.total_laps)||0),0),
      avg_lap_time:overall.avg_lap_time,best_lap_time:overall.best_lap_time,best_lap_number:overall.best_lap_number,worst_lap_time:overall.worst_lap_time,worst_lap_number:overall.worst_lap_number,
      avg_consistency:overall.consistency,consistency:overall.consistency,
      driver_spread:driverAvgs.length>=2?Math.max(...driverAvgs)-Math.min(...driverAvgs):null,
      straight_valid_laps:straight.valid_laps,straight_avg_lap_time:straight.avg_lap_time,straight_best_lap_time:straight.best_lap_time,straight_best_lap_number:straight.best_lap_number,straight_worst_lap_time:straight.worst_lap_time,straight_worst_lap_number:straight.worst_lap_number,
      reverse_valid_laps:reverse.valid_laps,reverse_avg_lap_time:reverse.avg_lap_time,reverse_best_lap_time:reverse.best_lap_time,reverse_best_lap_number:reverse.best_lap_number,reverse_worst_lap_time:reverse.worst_lap_time,reverse_worst_lap_number:reverse.worst_lap_number,
      rain_valid_laps:rain.valid_laps,rain_avg_lap_time:rain.avg_lap_time,rain_best_lap_time:rain.best_lap_time,rain_best_lap_number:rain.best_lap_number,rain_worst_lap_time:rain.worst_lap_time,rain_worst_lap_number:rain.worst_lap_number,
      direction_split_lap:rows.find(r=>Number.isFinite(Number(r.direction_split_lap)))?.direction_split_lap??null,
      rain_start_lap:rows.find(r=>Number.isFinite(Number(r.rain_start_lap)))?.rain_start_lap??null
    });
  }
  out.sort((a,b)=>{if(Number.isFinite(a.position)&&Number.isFinite(b.position))return a.position-b.position;if(Number.isFinite(a.position))return -1;if(Number.isFinite(b.position))return 1;return Number(a.apex_id)-Number(b.apex_id);});
  return out;
}

function teamsFromDrivers(
  drivers,
  snapshot
) {
  const grouped =
    new Map();


  for (
    const row
    of drivers
  ) {
    const id =
      String(
        row.apex_id
      );


    if (
      !grouped.has(id)
    ) {
      grouped.set(
        id,
        []
      );
    }


    grouped
      .get(id)
      .push(row);
  }


  const rows = [];


  for (
    const [
      apexId,
      group
    ]
    of grouped
  ) {
    const first =
      group[0];


    let validLaps = 0;
    let totalLaps = 0;
    let stintCount = 0;

    let weightedAverage = 0;
    let weightedCount = 0;

    let best = null;

    let consistencySum = 0;
    let consistencyCount = 0;

    const driverAverages = [];


    for (
      const row
      of group
    ) {
      const valid =
        Number(
          row.valid_laps
        ) ||
        0;


      validLaps +=
        valid;


      totalLaps +=
        Number(
          row.total_laps
        ) ||
        0;


      stintCount +=
        Number(
          row.stint_count
        ) ||
        0;


      const avg =
        Number(
          row.avg_lap_time
        );


      if (
        Number.isFinite(avg) &&
        avg > 0
      ) {
        driverAverages.push(
          avg
        );


        if (
          valid > 0
        ) {
          weightedAverage +=
            avg * valid;

          weightedCount +=
            valid;
        }
      }


      const rowBest =
        Number(
          row.best_lap_time
        );


      if (
        Number.isFinite(
          rowBest
        ) &&
        rowBest > 0 &&
        (
          best === null ||
          rowBest < best
        )
      ) {
        best =
          rowBest;
      }


      const consistency =
        Number(
          row.avg_consistency
        );


      if (
        Number.isFinite(
          consistency
        )
      ) {
        consistencySum +=
          consistency;

        consistencyCount +=
          1;
      }
    }


    const position =
      Number(
        snapshot
          ?.positions?.[
            apexId
          ]
      );


    rows.push({
      race_id:
        first.race_id,

      apex_id:
        apexId,

      position:
        Number.isFinite(
          position
        )
          ? position
          : null,

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
        weightedCount > 0
          ? weightedAverage /
            weightedCount
          : null,

      best_lap_time:
        best,

      avg_consistency:
        consistencyCount > 0
          ? consistencySum /
            consistencyCount
          : null,

      driver_spread:
        driverAverages.length > 1
          ? Math.max(
              ...driverAverages
            ) -
            Math.min(
              ...driverAverages
            )
          : 0
    });
  }


  rows.sort(
    (a, b) => {
      const pa =
        Number(
          a.position
        );

      const pb =
        Number(
          b.position
        );


      if (
        Number.isFinite(pa) &&
        Number.isFinite(pb)
      ) {
        return pa - pb;
      }


      if (
        Number.isFinite(pa)
      ) {
        return -1;
      }


      if (
        Number.isFinite(pb)
      ) {
        return 1;
      }


      return (
        Number(
          a.apex_id
        ) -
        Number(
          b.apex_id
        )
      );
    }
  );


  return rows;
}


// ============================================================
// LIVE OVERVIEW
// ============================================================

async function livePayload(env, rid, suppliedSnapshot = null) {
  const isCurrentRace = Number(rid) === Number(raceId(env));
  const [entriesRaw, snapshot, teamMap] = await Promise.all([
    loadEntries(env, rid),
    isCurrentRace ? (suppliedSnapshot ? Promise.resolve(suppliedSnapshot) : collectorSnapshot(env).catch(() => null)) : Promise.resolve(null),
    stableTeamNameMap(env, rid)
  ]);

  const fieldIds = isCurrentRace
    ? currentFieldIds(snapshot)
    : new Set(entriesRaw.map(row => String(row.apex_id ?? "").trim()).filter(validApexId));

  if (!fieldIds.size) return {
    race_id:Number(rid), session_name:"Apex Timing", active:false, data_available:false,
    is_live:false, session_status:isCurrentRace?"WAITING FOR APEX GRID":"FINISHED", team_count:0, race_lap:0, pit_count:0, best_lap:null, current:[]
  };

  const entries=filterCurrentField(entriesRaw,fieldIds);
  const entryById=new Map(entries.map(r=>[String(r.apex_id),r]));
  const [stints, lapEvents, pits] = await Promise.all([
    stintsPayload(env,rid,snapshot),
    loadLapEventsForApexIds(env,rid,[...fieldIds]),
    loadPits(env,rid)
  ]);

  const finalStintById=new Map();
  for (const stint of stints) {
    const id=String(stint.apex_id);
    const previous=finalStintById.get(id);
    if (!previous || Number(stint.stint_number)>Number(previous.stint_number)) finalStintById.set(id,stint);
  }
  const current=[];
  let raceLap=0,pitTotal=0,raceBest=null;

  for (const value of fieldIds) {
    const id=String(value), entry=entryById.get(id)||{}, stint=finalStintById.get(id)||{};
    const snapshotLap=Number(snapshot?.lapCounts?.[id]);
    const entryLap=Number(entry.lap_count);
    const recordedLap=lapEvents.filter(row=>String(row.apex_id)===id).reduce((max,row)=>Math.max(max,Number(row.lap_number)||0),0);
    const lap=isCurrentRace && Number.isFinite(snapshotLap) ? snapshotLap : (Number.isFinite(entryLap)?entryLap:recordedLap);
    const snapshotPits=Number(snapshot?.pitCounts?.[id]);
    const pitCount=isCurrentRace && Number.isFinite(snapshotPits)
      ? Math.max(0,Math.trunc(snapshotPits))
      : pits.filter(row=>String(row.apex_id)===id).reduce((max,row)=>Math.max(max,Number(row.pit_number)||0),0);
    raceLap=Math.max(raceLap,Number(lap)||0);
    pitTotal+=pitCount;
    const pos=Number(snapshot?.positions?.[id]);

    current.push({
      race_id:Number(rid),apex_id:id,position:isCurrentRace&&Number.isFinite(pos)?pos:null,
      team_name:resolveTeam(id,teamMap,entry.team_name,stint.team_name),
      driver_name:(isCurrentRace?snapshot?.drivers?.[id]:null)||stint.driver_name||entry.current_driver||null,
      current_driver:(isCurrentRace?snapshot?.drivers?.[id]:null)||stint.driver_name||entry.current_driver||null,
      race_lap:Number(lap)||0,live_lap_count:Number(lap)||0,pit_count:pitCount,
      stint_number:number(stint.stint_number)||pitCount+1,start_lap_count:number(stint.start_lap_count)||0,
      stint_laps:number(stint.total_laps),total_stint_laps:number(stint.total_laps),
      valid_laps:number(stint.valid_laps) ?? 0,
      stint_status:stint.status||null,data_complete:stint.data_complete!==false,expected_pit_count:number(stint.expected_pit_count),stored_pit_count:number(stint.stored_pit_count),
      live_last_lap:isCurrentRace?(number(snapshot?.lastLaps?.[id]) ?? number(entry.last_lap)):number(entry.last_lap),
      avg_lap_time:number(stint.avg_lap_time),best_lap_time:number(stint.best_lap_time),
      best_lap_number:number(stint.best_lap_number),worst_lap_time:number(stint.worst_lap_time),
      worst_lap_number:number(stint.worst_lap_number),consistency:number(stint.consistency),updated_at:entry.updated_at||null
    });
  }

  for (const lapRow of lapEvents || []) {
    const id = String(lapRow.apex_id ?? "").trim();
    if (!fieldIds.has(id)) continue;
    const lapNo = Number(lapRow.lap_number);
    const currentCount = isCurrentRace ? Number(snapshot?.lapCounts?.[id]) : Infinity;
    if (!Number.isFinite(lapNo) || lapNo <= 0) continue;
    if (Number.isFinite(currentCount) && currentCount >= 0 && lapNo > currentCount) continue;
    const t = Number(lapRow.lap_time);
    if (Number.isFinite(t) && t > 0 && (raceBest === null || t < raceBest)) raceBest = t;
  }

  current.sort((a,b)=>{
    if(isCurrentRace&&Number.isFinite(a.position)&&Number.isFinite(b.position)&&a.position!==b.position)return a.position-b.position;
    if(isCurrentRace&&Number.isFinite(a.position))return -1;
    if(isCurrentRace&&Number.isFinite(b.position))return 1;
    return b.race_lap-a.race_lap || Number(a.apex_id)-Number(b.apex_id);
  });

  const lastPacket=Date.parse(snapshot?.last_packet_at||"");
  const isLive=isCurrentRace&&Number.isFinite(lastPacket)&&Date.now()-lastPacket<180000;
  return {race_id:Number(rid),session_name:`Race ${rid}`,active:current.length>0,data_available:current.length>0,
    is_live:isLive,session_status:isLive?"LIVE":"FINISHED",collector_connected:isCurrentRace&&snapshot?.connected===true,
    team_count:current.length,race_lap:raceLap,pit_count:pitTotal,best_lap:raceBest,race_best_lap:raceBest,current};
}

// ============================================================
// EVENTS
// ============================================================

async function eventsPayload(
  env,
  rid,
  snapshot
) {
  const fieldIds =
    currentFieldIds(
      snapshot
    );


  const rows =
    await loadExclusions(
      env,
      rid
    );


  return filterCurrentField(
    rows,
    fieldIds
  )
    .map(
      row => ({
        ...row,

        type:
          "MANUAL EXCLUSION",

        reason:
          row.reason ||
          "Manual exclusion",

        status:
          "ACTIVE",

        time:
          row.created_at ||
          row.updated_at ||
          null
      })
    );
}


// ============================================================
// SESSION ARCHIVE
// ============================================================

function stripDatabaseIdentity(row, targetRaceId) {
  const copy = { ...row, race_id: targetRaceId };
  delete copy.id;
  return copy;
}

async function nextArchiveRaceId(env, currentRid) {
  const rows = await sbGetAll(env, "apex_entries", {
    select: "race_id",
    order: "race_id.desc"
  }).catch(() => []);

  let maxId = Number(currentRid) || 1;
  for (const row of rows) {
    const id = Number(row.race_id);
    if (Number.isFinite(id)) maxId = Math.max(maxId, Math.trunc(id));
  }
  return maxId + 1;
}

async function archiveCurrentRace(env, sourceRid) {
  const entries = await loadEntries(env, sourceRid).catch(() => []);
  const laps = await sbGetAll(env, "apex_lap_events", {
    select: "*",
    race_id: `eq.${sourceRid}`,
    order: "apex_id.asc,lap_number.asc"
  }).catch(() => []);
  const pits = await loadPits(env, sourceRid).catch(() => []);

  // Do not create empty history entries.
  if (!entries.length && !laps.length && !pits.length) return null;

  const targetRid = await nextArchiveRaceId(env, sourceRid);

  if (entries.length) {
    const rows = entries.map(row => stripDatabaseIdentity(row, targetRid));
    for (let i = 0; i < rows.length; i += 250) {
      await sbUpsert(env, "apex_entries", rows.slice(i, i + 250), "race_id,apex_id");
    }
  }

  if (laps.length) {
    const rows = laps.map(row => stripDatabaseIdentity(row, targetRid));
    for (let i = 0; i < rows.length; i += 250) {
      await sbUpsert(env, "apex_lap_events", rows.slice(i, i + 250), "race_id,apex_id,lap_number");
    }
  }

  if (pits.length) {
    const rows = pits.map(row => stripDatabaseIdentity(row, targetRid));
    for (let i = 0; i < rows.length; i += 250) {
      await sbUpsert(env, "apex_pit_stints", rows.slice(i, i + 250), "race_id,apex_id,pit_number");
    }
  }

  return targetRid;
}

async function clearCurrentRaceData(env, rid) {
  // Raw packet history is intentionally retained for diagnostics/recovery.
  await Promise.all([
    sbDelete(env, "apex_lap_events", { race_id: `eq.${rid}` }),
    sbDelete(env, "apex_pit_stints", { race_id: `eq.${rid}` }),
    sbDelete(env, "apex_entries", { race_id: `eq.${rid}` })
  ]);
}

// ============================================================
// RACES
// ============================================================

async function racesPayload(env) {
  const rows =
    await sbGetAll(
      env,
      "apex_entries",
      {
        select:
          "race_id,updated_at",

        order:
          "updated_at.desc"
      }
    )
      .catch(
        () => []
      );


  const races =
    new Map();


  for (
    const row
    of rows
  ) {
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
        row.updated_at ||
        ""
      );


    const previous =
      races.get(id);


    if (
      !previous ||
      timestamp >
        previous.timestamp
    ) {
      races.set(
        id,
        {
          timestamp:
            Number.isFinite(
              timestamp
            )
              ? timestamp
              : 0
        }
      );
    }
  }


  return [
    ...races.entries()
  ]
    .map(
      (
        [
          id,
          value
        ]
      ) => {
        const date =
          value.timestamp
            ? new Date(
                value.timestamp
              )
            : null;


        return {
          id,

          race_id:
            id,

          label:
            date
              ? (
                  `Race ${id} — ` +
                  date.toLocaleDateString(
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
                  )
                )
              : `Race ${id}`
        };
      }
    )
    .sort(
      (a, b) =>
        Number(
          b.race_id
        ) -
        Number(
          a.race_id
        )
    );
}


// ============================================================
// REPORT - LAP RECORDS CSV
// ============================================================

function csvEscape(value) {
  const text =
    String(
      value ?? ""
    );


  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return (
      `"${text.replace(
        /"/g,
        '""'
      )}"`
    );
  }


  return text;
}


function safeFilename(value) {
  return String(
    value ||
    "Race"
  )
    .replace(
      /[\\/:*?"<>|]+/g,
      "-"
    )
    .trim();
}


async function reportFieldIds(env, rid, snapshot) {
  if (Number(rid) === Number(raceId(env))) return currentFieldIds(snapshot);
  const entries = await loadEntries(env, rid).catch(() => []);
  return new Set(entries.map(row => String(row.apex_id ?? "").trim()).filter(validApexId));
}

async function createLapRecordsCsvResponse(env, rid, snapshot) {
  const fieldIds=await reportFieldIds(env,rid,snapshot);
  if(!fieldIds.size)return json({error:`No Apex field found for race ${rid}.`},404);

  const teamMap=await stableTeamNameMap(env,rid);
  const rows=await loadLapEventsForApexIds(env,rid,[...fieldIds]);
  if(!rows.length)return json({error:`No lap records found for race ${rid}.`},404);

  const grouped=new Map();
  for(const row of rows){
    const id=String(row.apex_id??'').trim(), lap=Math.trunc(Number(row.lap_number)), time=Number(row.lap_time);
    if(!fieldIds.has(id)||!validApexId(id)||!Number.isFinite(lap)||lap<=0||!Number.isFinite(time)||time<=0)continue;
    if(!grouped.has(id))grouped.set(id,new Map());
    grouped.get(id).set(lap,time);
  }

  // KartingNumbersXlsx/RaceParser.parseLapTimeCSV expects the official Apex matrix:
  // first cell = base lap, following cells = base+1, base+2 ...
  // A block size of 50 keeps the file readable and preserves every raw lap.
  const blockSize=50;
  const out=["\uFEFFApex Timing - drive your success https://www.apex-timing.com/","","Karting Events Bulgaria - Karting Track","",`Race ${rid} - Lap time records`,""];
  const ordered=[...fieldIds].map(String).sort((a,b)=>Number(a)-Number(b));
  for(const id of ordered){
    const laps=grouped.get(id); if(!laps||!laps.size)continue;
    const team=resolveTeam(id,teamMap)||`APEX ${id}`;
    out.push(`${id} - ${team}`);
    out.push(["Laps",...Array.from({length:blockSize},(_,i)=>i+1)].join(','));
    const maxLap=Math.max(...laps.keys());
    for(let base=0;base<maxLap;base+=blockSize){
      const cells=[String(base)];
      for(let i=1;i<=blockSize;i++){
        const value=laps.get(base+i);
        cells.push(Number.isFinite(value)?Number(value).toFixed(3):"-");
      }
      out.push(cells.join(','));
    }
    out.push("");
  }

  const filename=safeFilename(`Race ${rid} - Lap time records.csv`);
  return new Response(out.join("\r\n"),{status:200,headers:{
    "content-type":"text/csv; charset=utf-8",
    "content-disposition":`attachment; filename="${filename}"`,
    "cache-control":"no-store, no-cache, must-revalidate",pragma:"no-cache",expires:"0","x-content-type-options":"nosniff"
  }});
}

function createLapRecordsPdfResponse(env, rid, snapshot) {
  return (async () => {
    const fieldIds = await reportFieldIds(env, rid, snapshot);
    if (!fieldIds.size) return json({ error: `No Apex field found for race ${rid}.` }, 404);

    const teamMap = await stableTeamNameMap(env, rid);
    const rows = await loadLapEventsForApexIds(env, rid, [...fieldIds]);
    if (!rows.length) return json({ error: `No lap records found for race ${rid}.` }, 404);

    const grouped = new Map();
    for (const row of rows) {
      const id = String(row.apex_id ?? "").trim();
      const lap = Math.trunc(Number(row.lap_number));
      const time = Number(row.lap_time);
      if (!fieldIds.has(id) || !validApexId(id) || !Number.isFinite(lap) || lap <= 0 || !Number.isFinite(time) || time <= 0) continue;
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push({ lap, time });
    }

    const pages = [];
    for (const id of [...grouped.keys()].sort((a, b) => Number(a) - Number(b))) {
      const team = resolveTeam(id, teamMap) || `APEX ${id}`;
      const values = grouped.get(id).sort((a, b) => a.lap - b.lap);
      const lines = [`${id} - ${team}`, "Lap  Time"];
      for (const value of values) lines.push(`${String(value.lap).padStart(4, " ")}  ${value.time.toFixed(3)}`);
      for (let i = 0; i < lines.length; i += 65) pages.push(lines.slice(i, i + 65));
    }

    const bytes = buildTextPdf(pages);
    const filename = safeFilename(`Race ${rid} - Lap time records.pdf`);
    return new Response(bytes, { status: 200, headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store, no-cache, must-revalidate",
      "x-content-type-options": "nosniff"
    }});
  })();
}

function createPitStopsCsvResponse(rid, stints) {
  const rows = [
    ["Apex ID","Team","Stint","Driver","Start lap","End lap","Total laps","Valid laps","Hour","On track","Pit time","Total","Average","Best","Best lap","Worst","Worst lap","Status"]
  ];

  for (const row of stints || []) {
    rows.push([
      row.apex_id,
      row.team_name,
      row.stint_number,
      row.driver_name,
      row.start_lap_count,
      row.end_lap_count ?? "LIVE",
      row.total_laps,
      row.valid_laps,
      row.pit_hour,
      row.on_track,
      row.pit_time,
      row.total_time,
      Number.isFinite(Number(row.avg_lap_time)) ? Number(row.avg_lap_time).toFixed(3) : "",
      Number.isFinite(Number(row.best_lap_time)) ? Number(row.best_lap_time).toFixed(3) : "",
      row.best_lap_number ?? "",
      Number.isFinite(Number(row.worst_lap_time)) ? Number(row.worst_lap_time).toFixed(3) : "",
      row.worst_lap_number ?? "",
      row.status
    ]);
  }

  const csv = "\uFEFF" + rows.map(row => row.map(csvEscape).join(",")).join("\r\n");
  const filename = safeFilename(`Race ${rid} - Pit stops.csv`);
  return new Response(csv, { status: 200, headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store, no-cache, must-revalidate",
    "x-content-type-options": "nosniff"
  }});
}

// ============================================================
// PIT REPORT HTML
// ============================================================

function escapeHtml(value) {
  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#39;"
    );
}


function buildPitReportHtml(
  rid,
  stints
) {
  const grouped =
    new Map();


  for (
    const row
    of stints
  ) {
    const id =
      String(
        row.apex_id
      );


    if (
      !grouped.has(id)
    ) {
      grouped.set(
        id,
        []
      );
    }


    grouped
      .get(id)
      .push(row);
  }


  const content =
    [
      ...grouped.entries()
    ]
      .map(
        (
          [
            apexId,
            rows
          ]
        ) => {
          const team =
            rows[0]
              ?.team_name ||
            `APEX ${apexId}`;


          return `
<section>

<h2>
${escapeHtml(apexId)}
-
${escapeHtml(team)}
</h2>

<table>

<thead>

<tr>
<th>Stint</th>
<th>Driver</th>
<th>Start lap</th>
<th>End lap</th>
<th>Total laps</th>
<th>Valid laps</th>
<th>Average</th>
<th>Best</th>
<th>Best lap</th>
<th>Worst</th>
<th>Worst lap</th>
<th>Status</th>
</tr>

</thead>

<tbody>

${rows
  .map(
    row => `
<tr>
<td>${escapeHtml(row.stint_number)}</td>
<td>${escapeHtml(row.driver_name)}</td>
<td>${escapeHtml(row.start_lap_count)}</td>
<td>${escapeHtml(row.end_lap_count ?? "LIVE")}</td>
<td>${escapeHtml(row.total_laps)}</td>
<td>${escapeHtml(row.valid_laps)}</td>
<td>${escapeHtml(formatLapTime(row.avg_lap_time))}</td>
<td>${escapeHtml(formatLapTime(row.best_lap_time))}</td>
<td>${escapeHtml(row.best_lap_number ?? "")}</td>
<td>${escapeHtml(formatLapTime(row.worst_lap_time))}</td>
<td>${escapeHtml(row.worst_lap_number ?? "")}</td>
<td>${escapeHtml(row.status)}</td>
</tr>
`
  )
  .join("")}

</tbody>

</table>

</section>
`;
        }
      )
      .join("");


  return `
<!doctype html>

<html>

<head>

<meta charset="utf-8">

<title>
Race ${rid} - Pit stops
</title>

<style>

@page {
  size: A4 landscape;
  margin: 10mm;
}

body {
  font-family:
    Arial,
    Helvetica,
    sans-serif;

  color:
    #111;

  font-size:
    9px;
}

h1 {
  font-size:
    18px;
}

h2 {
  font-size:
    12px;

  margin:
    15px 0 5px;
}

section {
  break-inside:
    avoid;
}

table {
  width:
    100%;

  border-collapse:
    collapse;
}

th,
td {
  border:
    1px solid #bbb;

  padding:
    3px 4px;

  white-space:
    nowrap;
}

th {
  background:
    #eee;
}

button {
  position:
    fixed;

  top:
    10px;

  right:
    10px;

  padding:
    8px 12px;
}

@media print {
  button {
    display:
      none;
  }
}

</style>

</head>

<body>

<button
  onclick="window.print()"
>
Print / Save PDF
</button>

<h1>
Race ${rid} - Stints & pit stops
</h1>

${content}

</body>

</html>
`;
}



function pitReportSourcePages(stints) {
  const grouped=new Map();
  for(const row of stints||[]){
    if(row.is_live) continue; // Never invent Hour/Out values for an unfinished stint.
    const id=String(row.apex_id||'').trim(); if(!id)continue;
    if(!grouped.has(id))grouped.set(id,[]); grouped.get(id).push(row);
  }
  const pages=[];
  for(const [id,rows] of [...grouped.entries()].sort((a,b)=>Number(a[0])-Number(b[0]))){
    rows.sort((a,b)=>Number(a.stint_number)-Number(b.stint_number));
    const team=rows[0]?.team_name||`APEX ${id}`;
    const lines=[`${id} - ${team}`,'Stint Lap Hour Total On track Laps Driver Total Best lap Avg Pits Out'];
    for(const row of rows){
      const stint=Math.trunc(Number(row.stint_number)||0), lap=Math.trunc(Number(row.end_lap_count)||0);
      if(stint<=0||lap<=0)continue;
      const hour=/^\d{2}:\d{2}:\d{2}$/.test(String(row.pit_hour||''))?String(row.pit_hour):'00:00:00';
      const total=/^\d{2}:\d{2}:\d{2}$/.test(String(row.total_time||''))?String(row.total_time):'00:00:00';
      const onTrack=/^\d{2}:\d{2}:\d{2}$/.test(String(row.on_track||''))?String(row.on_track):'00:00:00';
      const driver=cleanDriver(row.driver_name)||'Unknown';
      const best=Number(row.best_lap_time), avg=Number(row.avg_lap_time);
      const bestText=Number.isFinite(best)&&best>0?best.toFixed(3):'';
      const avgText=Number.isFinite(avg)&&avg>0?avg.toFixed(3):'';
      const pit=String(row.pit_time||'0.000').replace(',', '.');
      // RaceParser accepts the final Out as HH:MM:SS. Apex detail does not expose it
      // separately in the current collector, so use the persisted pit hour rather than
      // fabricating a different time value.
      lines.push(`${stint} ${lap} ${hour} ${total} ${onTrack} ${Math.max(0,Math.trunc(Number(row.total_laps)||0))} ${driver} ${total} ${bestText} ${avgText} ${pit} ${hour}`.replace(/\s+/g,' ').trim());
    }
    pages.push(lines);
  }
  return pages;
}

function pdfEscape(value){return String(value??'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');}

function buildTextPdf(pages) {
  const objects=[null];
  const add=body=>{objects.push(body);return objects.length-1;};
  const fontId=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds=[];
  const contentIds=[];
  for(const lines of pages.length?pages:[['No pit stop data available.']]){
    const commands=['BT','/F1 8 Tf','36 806 Td','10 TL'];
    for(let i=0;i<lines.length;i++){
      if(i>0)commands.push('T*');
      commands.push(`(${pdfEscape(lines[i])}) Tj`);
    }
    commands.push('ET');
    const stream=commands.join('\n');
    contentIds.push(add(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`));
    pageIds.push(add('PENDING_PAGE'));
  }
  const pagesId=add('PENDING_PAGES');
  for(let i=0;i<pageIds.length;i++){
    objects[pageIds[i]]=`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`;
  }
  objects[pagesId]=`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] >>`;
  const catalogId=add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out='%PDF-1.4\n'; const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets[i]=new TextEncoder().encode(out).length;out+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=new TextEncoder().encode(out).length;
  out+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let i=1;i<objects.length;i++)out+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  out+=`trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

function createPitStopsPdfResponse(rid, stints) {
  const bytes=buildTextPdf(pitReportSourcePages(stints));
  const filename=safeFilename(`Race ${rid} - Pit stops.pdf`);
  return new Response(bytes,{status:200,headers:{
    'content-type':'application/pdf','content-disposition':`attachment; filename="${filename}"`,
    'cache-control':'no-store, no-cache, must-revalidate','x-content-type-options':'nosniff'
  }});
}

// ============================================================
// DURABLE OBJECT
// ============================================================

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

    this.lastGridAt =
      null;

    this.positions =
      new Map();

    this.columnTypes =
      new Map();

    this.fieldApexIds =
      new Set();

    this.pitCounts =
      new Map();

    this.lapCounts =
      new Map();

    this.bestLaps =
      new Map();

    this.lastLaps =
      new Map();

    this.fullDetailRefreshRunning = false;
    this.lastFullDetailRefreshAt = 0;
    this.sessionResetting = false;

    this.detailRunning =
      new Set();

    this.lastDetailFetch =
      new Map();


    state.blockConcurrencyWhile(
      async () => {

        this.packetCount =
          await state.storage.get(
            "packetCount"
          ) ||
          0;


        this.lastPacketAt =
          await state.storage.get(
            "lastPacketAt"
          ) ||
          null;


        this.lastGridAt =
          await state.storage.get(
            "lastGridAt"
          ) ||
          null;


        this.positions =
          new Map(
            Object.entries(
              await state.storage.get(
                "positions"
              ) ||
              {}
            )
          );


        this.columnTypes =
          new Map(
            Object.entries(
              await state.storage.get(
                "columnTypes"
              ) ||
              {}
            )
          );


        this.fieldApexIds =
          new Set(
            await state.storage.get(
              "fieldApexIds"
            ) ||
            []
          );


        this.pitCounts =
          new Map(
            Object.entries(
              await state.storage.get(
                "pitCounts"
              ) ||
              {}
            )
          );

        this.lapCounts = new Map(Object.entries(await state.storage.get("lapCounts") || {}));
        this.bestLaps = new Map(Object.entries(await state.storage.get("bestLaps") || {}));
        this.lastLaps = new Map(Object.entries(await state.storage.get("lastLaps") || {}));


        if (
          this.fieldApexIds.size === 0 &&
          this.positions.size > 0
        ) {
          this.fieldApexIds =
            new Set(
              this.positions.keys()
            );
        }


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


  async persist() {
    await this.state.storage.put({
      packetCount:
        this.packetCount,

      lastPacketAt:
        this.lastPacketAt,

      lastGridAt:
        this.lastGridAt,

      positions:
        Object.fromEntries(
          this.positions
        ),

      columnTypes:
        Object.fromEntries(
          this.columnTypes
        ),

      fieldApexIds:
        [
          ...this.fieldApexIds
        ],

      pitCounts:
        Object.fromEntries(
          this.pitCounts
        ),

      lapCounts: Object.fromEntries(this.lapCounts),
      bestLaps: Object.fromEntries(this.bestLaps),
      lastLaps: Object.fromEntries(this.lastLaps)
    });
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

      last_grid_at:
        this.lastGridAt,

      field_count:
        this.fieldApexIds.size,

      fieldApexIds:
        [
          ...this.fieldApexIds
        ],

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

      lapCounts:
        Object.fromEntries(
          this.lapCounts
        ),

      bestLaps:
        Object.fromEntries(
          this.bestLaps
        ),

      lastLaps:
        Object.fromEntries(
          this.lastLaps
        )
    };
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

      // One-time repair for this deployment. race_id=1 is reused between
      // events, so rebuild all 72 current kart histories from Apex detail
      // exactly once instead of continuing to display old-session rows.
      const repairKey = "currentSessionRepairVersion";
      const repairVersion = "v6.25";
      const repaired = await this.state.storage.get(repairKey);
      if (repaired !== repairVersion) {
        await this.state.storage.put(repairKey, repairVersion);
        this.state.waitUntil(this.refreshAllFieldDetails(true));
      } else {
        this.state.waitUntil(this.refreshAllFieldDetails(false));
      }

      return json(
        await this.snapshot()
      );
    }


    if (
      path === "/status" ||
      path === "/snapshot"
    ) {
      return json(
        await this.snapshot()
      );
    }


    if (
      path === "/reconnect"
    ) {
      try {
        this.ws?.close();
      } catch {}


      this.ws =
        null;

      this.connecting =
        false;


      await this.connect();

      this.state.waitUntil(this.refreshAllFieldDetails(true));

      return json(
        await this.snapshot()
      );
    }


    return new Response(
      "Not found",
      {
        status: 404
      }
    );
  }


  async alarm() {
    if (
      !this.ws ||
      this.ws.readyState !==
        WebSocket.OPEN
    ) {
      try {
        await this.connect();
      } catch {}
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


  async upsertEntry(
    apexId,
    changes
  ) {
    const old =
      await this.getEntry(
        apexId
      );


    await sbUpsert(
      this.env,
      "apex_entries",
      {
        race_id:
          this.rid,

        apex_id:
          String(
            apexId
          ),

        team_name:
          changes.team_name !==
            undefined
            ? changes.team_name
            : old?.team_name ??
              null,

        current_driver:
          changes.current_driver !==
            undefined
            ? changes.current_driver
            : old?.current_driver ??
              null,

        last_lap:
          changes.last_lap !==
            undefined
            ? changes.last_lap
            : old?.last_lap ??
              null,

        best_lap:
          changes.best_lap !==
            undefined
            ? changes.best_lap
            : old?.best_lap ??
              null,

        lap_count:
          changes.lap_count !==
            undefined
            ? changes.lap_count
            : old?.lap_count ??
              null,

        updated_at:
          new Date()
            .toISOString()
      },
      "race_id,apex_id"
    );
  }


  async requestDetail(
    apexId,
    lapCount
  ) {
    const count =
      Math.max(
        1,
        Math.min(
          Number(
            lapCount
          ) ||
          1,
          800
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
        `Apex detail ${response.status}`
      );
    }


    return response.text();
  }


  async refreshDetail(apexId, force = false) {
    const id=String(apexId);
    if(this.fieldApexIds.size>0&&!this.fieldApexIds.has(id))return;
    if(this.detailRunning.has(id))return;
    const now=Date.now();
    if(!force && now-(this.lastDetailFetch.get(id)||0)<1500)return;

    const entry=await this.getEntry(id);
    const snapshotLap=Number(this.lapCounts.get(id));
    const lapCount=Number.isFinite(snapshotLap)?snapshotLap:Number(entry?.lap_count);
    if(!entry||!Number.isFinite(lapCount)||lapCount<=0)return;

    this.lastDetailFetch.set(id,now);
    this.detailRunning.add(id);
    try {
      const raw=await this.requestDetail(id,lapCount);
      const laps=parseLapRows(raw,this.rid).filter(r=>String(r.apex_id)===id);
      const pits=parsePitRows(raw,entry.team_name,this.rid).filter(r=>String(r.apex_id)===id && Number(r.pit_number)>0);
      const maxLap=laps.reduce((m,r)=>Math.max(m,Number(r.lap_number)||0),0);

      // Never destroy current data on an incomplete/failed Apex detail reply.
      if (!laps.length || maxLap < Math.max(1, lapCount - 2)) {
        throw new Error(`Incomplete Apex detail ${id}: ${laps.length} laps, max ${maxLap}, expected ${lapCount}`);
      }

      // Apex detail is authoritative for lap/time pairs. Merge the returned
      // complete chain into persistence; never delete an already-recorded lap
      // merely because a later response is shorter or temporarily inconsistent.
      for(let i=0;i<laps.length;i+=250){
        await sbUpsert(this.env,"apex_lap_events",laps.slice(i,i+250),"race_id,apex_id,lap_number");
      }

      const expectedPits=Number(this.pitCounts.get(id));
      const parsedPitNumbers=new Set(pits.map(p=>Number(p.pit_number)).filter(n=>Number.isFinite(n)&&n>0));
      const pitChainComplete=!Number.isFinite(expectedPits)||expectedPits<=0||parsedPitNumbers.size>=Math.trunc(expectedPits);
      if(pitChainComplete){
        await sbDelete(this.env,"apex_pit_stints",{race_id:`eq.${this.rid}`,apex_id:`eq.${id}`});
        if(pits.length) await sbUpsert(this.env,"apex_pit_stints",pits,"race_id,apex_id,pit_number");
      } else {
        console.warn(`Incomplete Apex pit detail ${id}: ${parsedPitNumbers.size} pits, expected ${expectedPits}; keeping existing pit chain and retrying`);
      }

      await this.persist();
    } finally {
      this.detailRunning.delete(id);
    }
  }

  async refreshAllFieldDetails(force = false) {
    const now=Date.now();
    if(this.fullDetailRefreshRunning)return;
    if(!force && now-this.lastFullDetailRefreshAt<300000)return;
    const ids=[...this.fieldApexIds].map(String).filter(validApexId);
    if(!ids.length)return;
    this.fullDetailRefreshRunning=true;
    this.lastFullDetailRefreshAt=now;
    try {
      for(let i=0;i<ids.length;i+=4){
        const batch=ids.slice(i,i+4);
        await Promise.all(batch.map(id=>this.refreshDetail(id,true).catch(e=>console.error(`DETAIL REFRESH ${id}:`,e))));
      }
    } finally {
      this.fullDetailRefreshRunning=false;
    }
  }

  async applyField(apexId, type, cls, value, column) {
    const id=String(apexId);
    const t=String(type||"").toLowerCase();
    const c=String(cls||"").toLowerCase();
    const col=String(column||"");

    if(c==="drteam"||t==="drteam"){
      const driver=cleanDriver(value);if(driver)await this.upsertEntry(id,{current_driver:driver});return;
    }
    if(c==="dr"){
      const team=stripHtml(value);if(team)await this.upsertEntry(id,{team_name:team});return;
    }
    if(t==="rk"||c==="rk"){
      const p=parseNumber(value);if(p!==null&&p>0)this.positions.set(id,Math.trunc(p));return;
    }
    if(t==="pit"||c==="pit"||col==="15"){
      const p=parseNumber(value);
      if(p!==null&&p>=0){
        const next=Math.trunc(p);
        const previous=Number(this.pitCounts.get(id));
        this.pitCounts.set(id,next);
        // A pit-count change changes the stint boundary immediately. Fetch the
        // Apex P/L detail now instead of waiting for the next lap or 5-minute sweep.
        if(!Number.isFinite(previous)||next!==previous){
          this.state.waitUntil(this.refreshDetail(id,true).catch(e=>console.error(`PIT DETAIL REFRESH ${id}:`,e)));
        }
      }
      return;
    }
    if(t==="llp"||c==="llp"||col==="9"){
      const v=parseLapTime(value);if(v!==null){this.lastLaps.set(id,v);await this.upsertEntry(id,{last_lap:v});}return;
    }
    if(t==="blp"||c==="blp"||col==="12"){
      const v=parseLapTime(value);
      if(v!==null&&v>0){
        const previous=Number(this.bestLaps.get(id));
        // A kart's race best can only improve during one session.  Some Apex
        // full-grid packets are partial/transitional; never replace a known
        // faster current-session best with a slower value from such a packet.
        if(!Number.isFinite(previous)||previous<=0||v<previous){
          this.bestLaps.set(id,v);
        }
        await this.upsertEntry(id,{best_lap:this.bestLaps.get(id)});
      }
      return;
    }
    if(t==="tlp"||c==="tlp"||col==="13"){
      const n=parseNumber(value);if(n!==null&&n>=0){
        const lapNumber=Math.trunc(n);
        const previousLap=Number(this.lapCounts.get(id));
        // Do not archive/clear an entire race from one kart's lap reset.
        // A single transient Apex field update is not a safe session boundary.
        this.lapCounts.set(id,lapNumber);
        await this.upsertEntry(id,{lap_count:lapNumber});

        // Do not manufacture a lap/time pair by combining independent live-grid
        // fields (TLP + the last cached LLP). Their update order is not guaranteed.
        // Fetch the kart detail and persist the exact lap-number/time pairs Apex returns.
        this.state.waitUntil(this.refreshDetail(id,true).catch(e=>console.error(`LAP DETAIL REFRESH ${id}:`,e)));
      }
    }
  }

  async parseAndSave(payload) {
    for (
      const rawLine
      of String(
        payload ||
        ""
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
          grid.columnTypes.size
        ) {
          this.columnTypes =
            grid.columnTypes;
        }


        if (
          grid.rows.size
        ) {
          this.fieldApexIds =
            new Set(
              grid.rows.keys()
            );


          this.positions =
            new Map(
              grid.positions
            );

          // Detect an actual NEW SESSION before clearing cumulative live
          // metrics.  Apex can emit partial/transitional full-grid packets
          // during the same race; clearing bestLaps on every such packet was
          // the reason the overall best jumped backwards (58.334 -> 58.712).
          let incomingMaxLap = 0;
          for (const fields of grid.rows.values()) {
            for (const cell of Object.values(fields)) {
              if (String(cell.column) === "13" || cell.type === "tlp") {
                const n = parseNumber(cell.value);
                if (n !== null && n >= 0) incomingMaxLap = Math.max(incomingMaxLap, Math.trunc(n));
              }
            }
          }
          let storedMaxLap = 0;
          for (const value of this.lapCounts.values()) {
            const n = Number(value);
            if (Number.isFinite(n)) storedMaxLap = Math.max(storedMaxLap, n);
          }
          const newSession =
            storedMaxLap >= 20 &&
            incomingMaxLap >= 0 &&
            incomingMaxLap + 15 < storedMaxLap;

          if (newSession) {
            this.pitCounts = new Map();
            this.lapCounts = new Map();
            this.bestLaps = new Map();
            this.lastLaps = new Map();
          }


          this.lastGridAt =
            new Date()
              .toISOString();


          for (const [apexId, fields] of grid.rows) {
            for (const cell of Object.values(fields)) {
              await this.applyField(apexId, cell.type, cell.type, cell.value, cell.column);
            }
          }

          await this.persist();
        }


        continue;
      }


      const row =
        parseRowId(
          update.id
        );


      if (
        !row ||
        !validApexId(row.apexId)
      ) {
        continue;
      }


      if (
        this.fieldApexIds.size > 0 &&
        !this.fieldApexIds.has(
          String(
            row.apexId
          )
        )
      ) {
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
    const now = new Date();
    const previousPacketAt = this.lastPacketAt ? Date.parse(this.lastPacketAt) : NaN;
    const maxPreviousLap = Math.max(0, ...[...this.lapCounts.values()].map(value => Number(value) || 0));

    // A long timing silence followed by new packets is the reliable boundary
    // between organiser sessions. Archive race_id=1 BEFORE current-session
    // detail refresh starts replacing its rows. This keeps every finished race
    // available in the HISTORY selector without requiring a new Supabase table.
    if (Number.isFinite(previousPacketAt) && now.getTime() - previousPacketAt >= 6 * 60 * 60 * 1000 && maxPreviousLap >= 10) {
      try {
        const archivedRid = await archiveCurrentRace(this.env, this.rid);
        if (archivedRid) {
          await clearCurrentRaceData(this.env, this.rid);
          this.positions.clear();
          this.fieldApexIds.clear();
          this.pitCounts.clear();
          this.lapCounts.clear();
          this.bestLaps.clear();
          this.lastLaps.clear();
          await this.state.storage.put("lastArchivedRaceId", archivedRid);
        }
      } catch (error) {
        console.error("SESSION ARCHIVE:", error);
      }
    }

    this.packetCount +=
      1;


    this.lastPacketAt = now.toISOString();


    try {
      await sbInsert(
        this.env,
        "apex_raw_packets",
        {
          race_id:
            this.rid,

          payload
        }
      );

    } catch (
      error
    ) {
      console.warn(
        "RAW PACKET SAVE:",
        error
      );
    }


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


// ============================================================
// WORKER ROUTER
// ============================================================

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
          )
            .catch(
              console.error
            )
        );


        return json({
          ok: true,

          service:
            "race-engineer",

          version:
            VERSION,

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
          )
            .fetch(
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
        "/api/live"
      ) {
        ctx.waitUntil(
          startCollector(
            env
          )
            .catch(
              console.error
            )
        );


        const snapshot = await collectorSnapshot(env).catch(() => null);
        return json(
          await livePayload(
            env,
            raceId(env),
            snapshot
          )
        );
      }


      if (
        url.pathname ===
        "/api/overview"
      ) {
        const snapshot = await collectorSnapshot(env).catch(() => null);
        const payload =
          await livePayload(
            env,
            rid,
            snapshot
          );


        return json({
          race_id:
            rid,

          rows:
            payload.current
        });
      }


      if (
        url.pathname ===
          "/api/stints" ||
        url.pathname ===
          "/api/drivers" ||
        url.pathname ===
          "/api/teams" ||
        url.pathname ===
          "/api/pits" ||
        url.pathname ===
          "/api/events" ||
        url.pathname ===
          "/api/reports/lap-time-records.csv" ||
        url.pathname ===
          "/api/reports/lap-time-records.pdf" ||
        url.pathname ===
          "/api/reports/pit-stops.csv" ||
        url.pathname ===
          "/api/reports/pit-stops.pdf" ||
        url.pathname ===
          "/api/reports/pit-stops.html"
      ) {

        const snapshot =
          await collectorSnapshot(
            env
          )
            .catch(
              () => null
            );


        const fieldIds =
          currentFieldIds(
            snapshot
          );


        if (
          url.pathname ===
          "/api/stints"
        ) {
          const rows =
            await stintsPayload(
              env,
              rid,
              snapshot
            );


          return json({
            race_id:
              rid,

            rows
          });
        }


        if (
          url.pathname ===
          "/api/drivers"
        ) {
          const stints =
            await stintsPayload(
              env,
              rid,
              snapshot
            );


          const rows =
            driversFromStints(
              stints
            );


          return json({
            race_id:
              rid,

            rows
          });
        }


        if (
          url.pathname ===
          "/api/teams"
        ) {
          const stints =
            await stintsPayload(
              env,
              rid,
              snapshot
            );


          const drivers =
            driversFromStints(
              stints
            );


          let rows =
            teamsFromStints(
              stints,
              snapshot
            );


          const entries =
            filterCurrentField(
              await loadEntries(
                env,
                rid
              ),
              fieldIds
            );


          const teamMap =
            await stableTeamNameMap(
              env,
              rid
            );


          const seen =
            new Set(
              rows.map(
                row =>
                  String(
                    row.apex_id
                  )
              )
            );


          for (
            const entry
            of entries
          ) {
            const id =
              String(
                entry.apex_id
              );


            if (
              seen.has(id)
            ) {
              continue;
            }


            const position =
              Number(
                snapshot
                  ?.positions?.[
                    id
                  ]
              );


            rows.push({
              race_id:
                rid,

              apex_id:
                id,

              position:
                Number.isFinite(
                  position
                )
                  ? position
                  : null,

              team_name:
                resolveTeam(
                  id,
                  teamMap,
                  entry.team_name
                ),

              driver_count:
                entry.current_driver
                  ? 1
                  : 0,

              stint_count:
                0,

              valid_laps:
                0,

              total_laps:
                Number(
                  entry.lap_count
                ) ||
                0,

              avg_lap_time:
                null,

              best_lap_time:
                number(
                  entry.best_lap
                ),

              avg_consistency:
                null,

              driver_spread:
                0
            });
          }


          rows.sort(
            (a, b) => {
              const pa =
                Number(
                  a.position
                );

              const pb =
                Number(
                  b.position
                );


              if (
                Number.isFinite(pa) &&
                Number.isFinite(pb)
              ) {
                return pa - pb;
              }


              if (
                Number.isFinite(pa)
              ) {
                return -1;
              }


              if (
                Number.isFinite(pb)
              ) {
                return 1;
              }


              return (
                Number(
                  a.apex_id
                ) -
                Number(
                  b.apex_id
                )
              );
            }
          );


          return json({
            race_id:
              rid,

            rows
          });
        }


        if (
          url.pathname ===
          "/api/pits"
        ) {
          const rows =
            filterCurrentField(
              await loadPits(
                env,
                rid
              ),
              fieldIds
            );


          const teamMap =
            await stableTeamNameMap(
              env,
              rid
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
                  rid,
                  snapshot
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
              )
                .trim();


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


            if (
              fieldIds.size &&
              !fieldIds.has(
                apexId
              )
            ) {
              return json(
                {
                  error:
                    "APEX ID is not part of the selected race field"
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
                  "Manual exclusion"
              }
            );


            return json({
              ok: true
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
              ok: true
            });
          }
        }


        if (
          url.pathname ===
          "/api/reports/lap-time-records.csv"
        ) {
          return await createLapRecordsCsvResponse(
            env,
            rid,
            snapshot
          );
        }


        if (
          url.pathname ===
          "/api/reports/lap-time-records.pdf"
        ) {
          return await createLapRecordsPdfResponse(env, rid, snapshot);
        }


        if (
          url.pathname ===
          "/api/reports/pit-stops.csv"
        ) {
          const stints = await stintsPayload(env, rid, snapshot);
          return createPitStopsCsvResponse(rid, stints);
        }


        if (
          url.pathname ===
          "/api/reports/pit-stops.pdf"
        ) {
          const stints = await stintsPayload(env, rid, snapshot);
          return createPitStopsPdfResponse(rid, stints);
        }


        if (
          url.pathname ===
          "/api/reports/pit-stops.html"
        ) {
          const stints =
            await stintsPayload(
              env,
              rid,
              snapshot
            );


          return textResponse(
            buildPitReportHtml(
              rid,
              stints
            ),

            "text/html"
          );
        }
      }


      return env
        .ASSETS
        .fetch(
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
            String(error),

          version:
            VERSION
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
      )
        .catch(
          console.error
        )
    );
  }
};
