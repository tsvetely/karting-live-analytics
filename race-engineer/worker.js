const VERSION =
  "2026-08-30-race-engineer-v12-current-archive-separated";

const PAGE_SIZE = 1000;


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
// RACE / MODE
// ============================================================

function configuredRaceId(env) {
  const value =
    Number(
      env.DEFAULT_RACE_ID ||
      1
    );


  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return 1;
  }


  return Math.trunc(value);
}


function requestedRaceId(
  env,
  url
) {
  if (
    url &&
    url.searchParams.has(
      "race_id"
    )
  ) {
    const value =
      Number(
        url.searchParams.get(
          "race_id"
        )
      );


    if (
      Number.isFinite(value) &&
      value > 0
    ) {
      return Math.trunc(value);
    }
  }


  return configuredRaceId(env);
}


/*
 * IMPORTANT
 *
 * No race_id query parameter:
 *
 *   CURRENT LIVE RACE
 *
 * Explicit race_id:
 *
 *   ARCHIVE / STORED RACE
 *
 * This separation is intentional.
 */
function isArchiveRequest(url) {
  return url.searchParams.has(
    "race_id"
  );
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

    headers[
      "Range-Unit"
    ] =
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


  if (
    prefer.includes(
      "return=representation"
    )
  ) {
    return response.json();
  }


  return null;
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
// UTILITIES
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
    return seconds.toFixed(3);
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


  return `${minutes}:${rest}`;
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


  const headerRegex =
    /<td\b([^>]*)>/gi;


  let match;


  while (
    (
      match =
        headerRegex.exec(
          source
        )
    ) !== null
  ) {
    const id =
      /data-id=["'](c\d+)["']/i
        .exec(
          match[1]
        );


    const type =
      /data-type=["']([^"']+)["']/i
        .exec(
          match[1]
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


  while (
    (
      match =
        rowRegex.exec(
          source
        )
    ) !== null
  ) {
    const apexId =
      String(
        match[2]
      );


    const attrs =
      `${match[1]} ${match[3]}`;


    const positionMatch =
      /data-pos=["'](\d+)["']/i
        .exec(attrs);


    if (
      positionMatch
    ) {
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
            match[4]
          )
      ) !== null
    ) {
      const id =
        /data-id=["']r\d+c(\d+)["']/i
          .exec(
            cellMatch[1]
          );


      if (!id) {
        continue;
      }


      const explicitType =
        /data-type=["']([^"']+)["']/i
          .exec(
            cellMatch[1]
          );


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


// ============================================================
// APEX DETAIL
// ============================================================

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
    )
      .split("\n")
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
    )
      .split("\n")
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
  rid
) {
  return sbGetAll(
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
// COLLECTOR
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
  const response =
    await collectorStub(
      env
    )
      .fetch(
        "https://collector/snapshot"
      );


  if (!response.ok) {
    throw new Error(
      "Collector snapshot failed"
    );
  }


  return response.json();
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
    result.add(
      String(value)
    );
  }


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
      result.add(
        String(value)
      );
    }
  }


  return result;
}


function filterByField(
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
    row =>
      fieldIds.has(
        String(
          row.apex_id
        )
      )
  );
}


// ============================================================
// ARCHIVE FIELD
//
// IMPORTANT:
//
// Archive roster comes ONLY from apex_entries.
//
// Pits / laps / old stats are NOT allowed to create teams.
// ============================================================

async function archiveFieldIds(
  env,
  rid
) {
  const entries =
    await loadEntries(
      env,
      rid
    );


  return new Set(
    entries
      .map(
        row =>
          String(
            row.apex_id ??
            ""
          )
            .trim()
      )
      .filter(Boolean)
  );
}


// ============================================================
// TEAM NAMES
// ============================================================

async function stableTeamNameMap(
  env,
  rid,
  allowedIds = null
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


    if (
      allowedIds &&
      !allowedIds.has(id)
    ) {
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
      ) &&
      !result.has(id)
    ) {
      result.set(
        id,
        team
      );
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
// SESSION LIVE STATE
// ============================================================

function sessionCurrentlyLive(
  snapshot
) {
  const lastPacket =
    Date.parse(
      snapshot
        ?.last_packet_at ||
      ""
    );


  if (
    !Number.isFinite(
      lastPacket
    )
  ) {
    return false;
  }


  return (
    Date.now() -
    lastPacket
  ) <
    180000;
}


// ============================================================
// NORMALIZE OLD STINT
// ============================================================

function normalizeAnalyticalStint(
  row,
  teamMap
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

    start_lap_count:
      number(
        row.start_lap_count
      ) ??
      0,

    end_lap_count:
      number(
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
      0
  };
}


// ============================================================
// BUILD STINT CHAIN
// ============================================================

function buildCompleteStintChainForTeam({
  rid,
  apexId,
  teamName,
  entry,
  pits,
  completed,
  live,
  teamMap,
  sessionIsLive
}) {
  const id =
    String(
      apexId
    );


  const sortedPits =
    pits
      .filter(
        row =>
          String(
            row.apex_id
          ) === id
      )
      .slice()
      .sort(
        (a, b) => {
          const pa =
            Number(
              a.pit_number
            );


          const pb =
            Number(
              b.pit_number
            );


          if (
            Number.isFinite(pa) &&
            Number.isFinite(pb) &&
            pa !== pb
          ) {
            return pa - pb;
          }


          return (
            Number(
              a.pit_lap
            ) -
            Number(
              b.pit_lap
            )
          );
        }
      );


  const completedRows =
    completed
      .filter(
        row =>
          String(
            row.apex_id
          ) === id
      )
      .map(
        row =>
          normalizeAnalyticalStint(
            row,
            teamMap
          )
      );


  const liveRows =
    live
      .filter(
        row =>
          String(
            row.apex_id
          ) === id
      )
      .map(
        row =>
          normalizeAnalyticalStint(
            row,
            teamMap
          )
      );


  const analyticalByStart =
    new Map();


  for (
    const row
    of completedRows
  ) {
    analyticalByStart.set(
      Number(
        row.start_lap_count
      ),
      row
    );
  }


  for (
    const row
    of liveRows
  ) {
    const start =
      Number(
        row.start_lap_count
      );


    if (
      !analyticalByStart.has(
        start
      )
    ) {
      analyticalByStart.set(
        start,
        row
      );
    }
  }


  const result = [];

  let previousBoundary = 0;


  for (
    const pit
    of sortedPits
  ) {
    const endBoundary =
      Number(
        pit.pit_lap
      );


    if (
      !Number.isFinite(
        endBoundary
      ) ||
      endBoundary <=
        previousBoundary
    ) {
      continue;
    }


    const analytical =
      analyticalByStart.get(
        previousBoundary
      ) ||
      null;


    result.push({
      race_id:
        rid,

      apex_id:
        id,

      team_name:
        resolveTeam(
          id,
          teamMap,
          teamName,
          pit.team_name,
          analytical?.team_name
        ),

      driver_name:
        pit.driver_name ||
        analytical?.driver_name ||
        null,

      stint_number:
        result.length + 1,

      start_lap_count:
        previousBoundary,

      end_lap_count:
        endBoundary,

      current_lap_count:
        endBoundary,

      total_laps:
        endBoundary -
        previousBoundary,

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

      ended_by_pit:
        true,

      is_live:
        false,

      status:
        "COMPLETED"
    });


    previousBoundary =
      endBoundary;
  }


  const raceLap =
    Number(
      entry?.lap_count
    );


  if (
    Number.isFinite(
      raceLap
    ) &&
    raceLap >
      previousBoundary
  ) {
    const analytical =
      analyticalByStart.get(
        previousBoundary
      ) ||
      null;


    result.push({
      race_id:
        rid,

      apex_id:
        id,

      team_name:
        resolveTeam(
          id,
          teamMap,
          teamName,
          entry?.team_name,
          analytical?.team_name
        ),

      driver_name:
        analytical?.driver_name ||
        entry?.current_driver ||
        null,

      stint_number:
        result.length + 1,

      start_lap_count:
        previousBoundary,

      end_lap_count:
        sessionIsLive
          ? null
          : raceLap,

      current_lap_count:
        raceLap,

      total_laps:
        raceLap -
        previousBoundary,

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
        null,

      on_track:
        null,

      pit_time:
        null,

      total_time:
        null,

      ended_by_pit:
        false,

      is_live:
        sessionIsLive,

      status:
        sessionIsLive
          ? "LIVE"
          : "COMPLETED"
    });
  }


  if (
    result.length === 0 &&
    Number.isFinite(
      raceLap
    ) &&
    raceLap > 0
  ) {
    result.push({
      race_id:
        rid,

      apex_id:
        id,

      team_name:
        resolveTeam(
          id,
          teamMap,
          teamName,
          entry?.team_name
        ),

      driver_name:
        entry?.current_driver ||
        completedRows[0]
          ?.driver_name ||
        liveRows[0]
          ?.driver_name ||
        null,

      stint_number:
        1,

      start_lap_count:
        0,

      end_lap_count:
        sessionIsLive
          ? null
          : raceLap,

      current_lap_count:
        raceLap,

      total_laps:
        raceLap,

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
        null,

      on_track:
        null,

      pit_time:
        null,

      total_time:
        null,

      ended_by_pit:
        false,

      is_live:
        sessionIsLive,

      status:
        sessionIsLive
          ? "LIVE"
          : "COMPLETED"
    });
  }


  return result;
}


// ============================================================
// EXCLUSIONS
// ============================================================

function buildExclusionSet(
  exclusions
) {
  const result =
    new Set();


  for (
    const row
    of exclusions
  ) {
    const apexId =
      String(
        row.apex_id ??
        ""
      );


    const lap =
      Number(
        row.lap_number
      );


    if (
      !apexId ||
      !Number.isFinite(
        lap
      )
    ) {
      continue;
    }


    result.add(
      `${apexId}:${Math.trunc(lap)}`
    );
  }


  return result;
}


// ============================================================
// STATS
// ============================================================

function createStatAccumulator() {
  return {
    count: 0,

    sum: 0,

    sumSquares: 0,

    bestTime:
      null,

    bestLap:
      null,

    worstTime:
      null,

    worstLap:
      null
  };
}


function addLapToAccumulator(
  accumulator,
  lap,
  lapTime
) {
  accumulator.count += 1;

  accumulator.sum +=
    lapTime;

  accumulator.sumSquares +=
    lapTime *
    lapTime;


  if (
    accumulator.bestTime ===
      null ||
    lapTime <
      accumulator.bestTime
  ) {
    accumulator.bestTime =
      lapTime;

    accumulator.bestLap =
      lap;
  }


  if (
    accumulator.worstTime ===
      null ||
    lapTime >
      accumulator.worstTime
  ) {
    accumulator.worstTime =
      lapTime;

    accumulator.worstLap =
      lap;
  }
}


function finishAccumulator(
  accumulator
) {
  if (
    accumulator.count <= 0
  ) {
    return {
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
        null
    };
  }


  const average =
    accumulator.sum /
    accumulator.count;


  const variance =
    Math.max(
      0,

      (
        accumulator.sumSquares /
        accumulator.count
      ) -
      (
        average *
        average
      )
    );


  return {
    valid_laps:
      accumulator.count,

    avg_lap_time:
      Number(
        average.toFixed(3)
      ),

    best_lap_time:
      Number(
        accumulator.bestTime
          .toFixed(3)
      ),

    best_lap_number:
      accumulator.bestLap,

    worst_lap_time:
      Number(
        accumulator.worstTime
          .toFixed(3)
      ),

    worst_lap_number:
      accumulator.worstLap,

    consistency:
      Number(
        Math.sqrt(
          variance
        )
          .toFixed(3)
      )
  };
}


// ============================================================
// VALID STINT LAP
// ============================================================

function isValidStintLap(
  stint,
  lap,
  exclusionSet
) {
  const start =
    Number(
      stint.start_lap_count
    ) ||
    0;


  const end =
    stint.end_lap_count !==
      null &&
    stint.end_lap_count !==
      undefined
      ? Number(
          stint.end_lap_count
        )
      : Number(
          stint.current_lap_count
        );


  if (
    !Number.isFinite(lap) ||
    !Number.isFinite(end)
  ) {
    return false;
  }


  if (
    lap <= start ||
    lap > end
  ) {
    return false;
  }


  /*
   * PIT OUT
   *
   * First stint has no previous pit,
   * therefore lap 1 remains valid.
   */
  if (
    start > 0 &&
    lap ===
      start + 1
  ) {
    return false;
  }


  /*
   * PIT IN
   */
  if (
    stint.ended_by_pit ===
      true &&
    lap === end
  ) {
    return false;
  }


  /*
   * Manual analytical exclusion
   */
  if (
    exclusionSet.has(
      `${stint.apex_id}:${lap}`
    )
  ) {
    return false;
  }


  return true;
}


// ============================================================
// FIND STINT
// ============================================================

function findStintForLap(
  teamStints,
  lap,
  startIndex = 0
) {
  let index =
    Math.max(
      0,
      startIndex
    );


  while (
    index <
    teamStints.length
  ) {
    const stint =
      teamStints[index];


    const start =
      Number(
        stint.start_lap_count
      ) ||
      0;


    const end =
      stint.end_lap_count !==
        null &&
      stint.end_lap_count !==
        undefined
        ? Number(
            stint.end_lap_count
          )
        : Number(
            stint.current_lap_count
          );


    if (
      !Number.isFinite(
        end
      )
    ) {
      index += 1;

      continue;
    }


    if (
      lap <= start
    ) {
      return {
        stint:
          null,

        index
      };
    }


    if (
      lap <= end
    ) {
      return {
        stint,

        index
      };
    }


    index += 1;
  }


  return {
    stint:
      null,

    index:
      teamStints.length
  };
}


// ============================================================
// APPLY RAW LAP STATISTICS
// ============================================================

async function applyRawLapStatistics(
  env,
  rid,
  stints,
  fieldIds,
  exclusions
) {
  if (
    !stints.length ||
    !fieldIds.size
  ) {
    return stints;
  }


  const exclusionSet =
    buildExclusionSet(
      exclusions
    );


  const stintsByTeam =
    new Map();


  const accumulators =
    new Map();


  for (
    const stint
    of stints
  ) {
    const id =
      String(
        stint.apex_id
      );


    if (
      !stintsByTeam.has(id)
    ) {
      stintsByTeam.set(
        id,
        []
      );
    }


    stintsByTeam
      .get(id)
      .push(stint);


    accumulators.set(
      stint,
      createStatAccumulator()
    );
  }


  for (
    const teamStints
    of stintsByTeam.values()
  ) {
    teamStints.sort(
      (a, b) =>
        Number(
          a.start_lap_count
        ) -
        Number(
          b.start_lap_count
        )
    );
  }


  const numericIds =
    [
      ...fieldIds
    ]
      .map(
        value =>
          String(value)
            .trim()
      )
      .filter(
        value =>
          /^\d+$/.test(
            value
          )
      );


  if (
    numericIds.length === 0
  ) {
    return stints;
  }


  const idFilter =
    `in.(${numericIds.join(",")})`;


  const teamCursor =
    new Map();


  let from = 0;


  while (true) {
    const page =
      await sbGet(
        env,
        "apex_lap_events",
        {
          select:
            "apex_id,lap_number,lap_time",

          race_id:
            `eq.${rid}`,

          apex_id:
            idFilter,

          order:
            "apex_id.asc,lap_number.asc"
        },
        {
          from,

          to:
            from +
            PAGE_SIZE -
            1
        }
      );


    for (
      const row
      of page
    ) {
      const id =
        String(
          row.apex_id
        );


      const lap =
        Number(
          row.lap_number
        );


      const lapTime =
        Number(
          row.lap_time
        );


      if (
        !Number.isFinite(lap) ||
        !Number.isFinite(lapTime) ||
        lapTime <= 0
      ) {
        continue;
      }


      const teamStints =
        stintsByTeam.get(id);


      if (
        !teamStints ||
        teamStints.length === 0
      ) {
        continue;
      }


      const previousCursor =
        teamCursor.get(id) ||
        0;


      const found =
        findStintForLap(
          teamStints,
          lap,
          previousCursor
        );


      teamCursor.set(
        id,
        found.index
      );


      if (
        !found.stint
      ) {
        continue;
      }


      if (
        !isValidStintLap(
          found.stint,
          lap,
          exclusionSet
        )
      ) {
        continue;
      }


      addLapToAccumulator(
        accumulators.get(
          found.stint
        ),
        lap,
        lapTime
      );
    }


    if (
      page.length <
      PAGE_SIZE
    ) {
      break;
    }


    from +=
      PAGE_SIZE;
  }


  for (
    const stint
    of stints
  ) {
    const calculated =
      finishAccumulator(
        accumulators.get(
          stint
        )
      );


    Object.assign(
      stint,
      calculated
    );
  }


  return stints;
}


// ============================================================
// BUILD STINT DATASET
//
// THIS FUNCTION RECEIVES ITS FIELD EXPLICITLY.
//
// Current:
//   collector field
//
// Archive:
//   apex_entries field
//
// They are NOT mixed.
// ============================================================

async function buildStintsPayload(
  env,
  rid,
  fieldIds,
  sessionIsLive,
  snapshot = null
) {
  if (
    !fieldIds ||
    fieldIds.size === 0
  ) {
    return [];
  }


  const [
    completedRaw,
    liveRaw,
    pitsRaw,
    entriesRaw,
    exclusionsRaw
  ] =
    await Promise.all([
      loadCompletedStints(
        env,
        rid
      ),

      loadLiveStints(
        env,
        rid
      ),

      loadPits(
        env,
        rid
      ),

      loadEntries(
        env,
        rid
      ),

      loadExclusions(
        env,
        rid
      )
    ]);


  const completed =
    filterByField(
      completedRaw,
      fieldIds
    );


  const live =
    filterByField(
      liveRaw,
      fieldIds
    );


  const pits =
    filterByField(
      pitsRaw,
      fieldIds
    );


  const entries =
    filterByField(
      entriesRaw,
      fieldIds
    );


  const exclusions =
    filterByField(
      exclusionsRaw,
      fieldIds
    );


  const teamMap =
    await stableTeamNameMap(
      env,
      rid,
      fieldIds
    );


  const entryMap =
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


  const rows = [];


  for (
    const apexId
    of fieldIds
  ) {
    const id =
      String(
        apexId
      );


    const entry =
      entryMap.get(id) ||
      null;


    const teamName =
      resolveTeam(
        id,
        teamMap,
        entry?.team_name
      );


    rows.push(
      ...buildCompleteStintChainForTeam({
        rid,

        apexId:
          id,

        teamName,

        entry,

        pits,

        completed,

        live,

        teamMap,

        sessionIsLive
      })
    );
  }


  await applyRawLapStatistics(
    env,
    rid,
    rows,
    fieldIds,
    exclusions
  );


  /*
   * CURRENT:
   *
   * sort by real race position from collector.
   *
   * ARCHIVE:
   *
   * no fake race position is invented.
   * Keep same team together using numeric Apex ID.
   */
  rows.sort(
    (a, b) => {
      if (snapshot) {
        const pa =
          Number(
            snapshot
              ?.positions?.[
                String(
                  a.apex_id
                )
              ]
          );


        const pb =
          Number(
            snapshot
              ?.positions?.[
                String(
                  b.apex_id
                )
              ]
          );


        if (
          Number.isFinite(pa) &&
          Number.isFinite(pb) &&
          pa !== pb
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
      }


      const ai =
        Number(
          a.apex_id
        );


      const bi =
        Number(
          b.apex_id
        );


      if (
        Number.isFinite(ai) &&
        Number.isFinite(bi) &&
        ai !== bi
      ) {
        return ai - bi;
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


  return rows;
}


// ============================================================
// CURRENT STINTS
// ============================================================

async function currentStintsPayload(
  env,
  rid,
  snapshot
) {
  const fieldIds =
    currentFieldIds(
      snapshot
    );


  return buildStintsPayload(
    env,
    rid,
    fieldIds,
    sessionCurrentlyLive(
      snapshot
    ),
    snapshot
  );
}


// ============================================================
// ARCHIVE STINTS
// ============================================================

async function archiveStintsPayload(
  env,
  rid
) {
  const fieldIds =
    await archiveFieldIds(
      env,
      rid
    );


  return buildStintsPayload(
    env,
    rid,
    fieldIds,
    false,
    null
  );
}


// ============================================================
// DRIVERS
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
          avg *
          valid;


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
// TEAMS
// ============================================================

function teamsFromDrivers(
  drivers,
  snapshot = null
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
            avg *
            valid;


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


        consistencyCount += 1;
      }
    }


    const position =
      snapshot
        ? Number(
            snapshot
              ?.positions?.[
                apexId
              ]
          )
        : null;


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
      /*
       * Current race:
       * real Apex position.
       */
      if (snapshot) {
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
      }


      /*
       * Archive:
       * no fake alphabetical "race ranking".
       * Apex ID only gives deterministic grouping.
       */
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
// CURRENT OVERVIEW
//
// THIS RESTORES THE OLD WORKING CURRENT LOGIC.
// ============================================================

async function currentOverviewPayload(
  env,
  rid,
  snapshot
) {
  const fieldIds =
    currentFieldIds(
      snapshot
    );


  if (
    fieldIds.size === 0
  ) {
    return {
      race_id:
        rid,

      mode:
        "current",

      session_name:
        "Apex Timing",

      active:
        false,

      data_available:
        false,

      is_live:
        false,

      session_status:
        "WAITING",

      team_count:
        0,

      current:
        []
    };
  }


  const [
    entriesRaw,
    liveRaw,
    pitsRaw
  ] =
    await Promise.all([
      loadEntries(
        env,
        rid
      ),

      loadLiveStints(
        env,
        rid
      ),

      loadPits(
        env,
        rid
      )
    ]);


  const entries =
    filterByField(
      entriesRaw,
      fieldIds
    );


  const live =
    filterByField(
      liveRaw,
      fieldIds
    );


  const pits =
    filterByField(
      pitsRaw,
      fieldIds
    );


  const teamMap =
    await stableTeamNameMap(
      env,
      rid,
      fieldIds
    );


  const liveMap =
    new Map(
      live.map(
        row => [
          String(
            row.apex_id
          ),
          row
        ]
      )
    );


  const entryMap =
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


  const pitCounts =
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


    const pitNumber =
      Number(
        pit.pit_number
      );


    const pitLap =
      Number(
        pit.pit_lap
      );


    if (
      Number.isFinite(
        pitNumber
      )
    ) {
      pitCounts.set(
        id,
        Math.max(
          pitCounts.get(id) ||
          0,
          pitNumber
        )
      );
    }


    if (
      Number.isFinite(
        pitLap
      )
    ) {
      lastPitLap.set(
        id,
        Math.max(
          lastPitLap.get(id) ||
          0,
          pitLap
        )
      );
    }
  }


  const rows = [];


  for (
    const apexId
    of fieldIds
  ) {
    const id =
      String(
        apexId
      );


    const entry =
      entryMap.get(id) ||
      {};


    const liveRow =
      liveMap.get(id) ||
      {};


    const raceLap =
      Number(
        entry.lap_count
      ) ||
      0;


    const pitCount =
      pitCounts.get(id) ||
      0;


    const startLap =
      lastPitLap.get(id) ||
      Number(
        liveRow.start_lap_count
      ) ||
      0;


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
          entry.team_name,
          liveRow.team_name
        ),

      driver_name:
        entry.current_driver ||
        liveRow.driver_name ||
        null,

      current_driver:
        entry.current_driver ||
        liveRow.driver_name ||
        null,

      race_lap:
        raceLap,

      live_lap_count:
        raceLap,

      pit_count:
        pitCount,

      stint_number:
        pitCount + 1,

      start_lap_count:
        startLap,

      stint_laps:
        Math.max(
          0,
          raceLap -
          startLap
        ),

      total_stint_laps:
        Math.max(
          0,
          raceLap -
          startLap
        ),

      valid_laps:
        Number(
          liveRow.valid_laps
        ) ||
        0,

      live_last_lap:
        number(
          entry.last_lap
        ),

      avg_lap_time:
        number(
          liveRow.avg_lap_time ??
          liveRow.avg_lap
        ),

      best_lap_time:
        number(
          liveRow.best_lap_time ??
          liveRow.best_lap ??
          entry.best_lap
        ),

      best_lap_number:
        number(
          liveRow.best_lap_number
        ),

      worst_lap_time:
        number(
          liveRow.worst_lap_time ??
          liveRow.worst_lap
        ),

      worst_lap_number:
        number(
          liveRow.worst_lap_number
        ),

      consistency:
        number(
          liveRow.consistency
        ),

      updated_at:
        entry.updated_at ||
        liveRow.updated_at ||
        null
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
        Number.isFinite(pb) &&
        pa !== pb
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


  const liveState =
    sessionCurrentlyLive(
      snapshot
    );


  return {
    race_id:
      rid,

    mode:
      "current",

    session_name:
      "Apex Timing",

    active:
      rows.length > 0,

    data_available:
      rows.length > 0,

    is_live:
      liveState,

    session_status:
      liveState
        ? "LIVE"
        : "FINISHED",

    collector_connected:
      snapshot?.connected ===
      true,

    team_count:
      rows.length,

    current:
      rows
  };
}


// ============================================================
// ARCHIVE OVERVIEW
// ============================================================

async function archiveOverviewPayload(
  env,
  rid
) {
  const fieldIds =
    await archiveFieldIds(
      env,
      rid
    );


  if (
    fieldIds.size === 0
  ) {
    return {
      race_id:
        rid,

      mode:
        "archive",

      session_name:
        `Race ${rid}`,

      active:
        false,

      data_available:
        false,

      is_live:
        false,

      session_status:
        "ARCHIVED",

      team_count:
        0,

      current:
        []
    };
  }


  const [
    entriesRaw,
    pitsRaw,
    stints
  ] =
    await Promise.all([
      loadEntries(
        env,
        rid
      ),

      loadPits(
        env,
        rid
      ),

      archiveStintsPayload(
        env,
        rid
      )
    ]);


  const entries =
    filterByField(
      entriesRaw,
      fieldIds
    );


  const pits =
    filterByField(
      pitsRaw,
      fieldIds
    );


  const teamMap =
    await stableTeamNameMap(
      env,
      rid,
      fieldIds
    );


  const entryMap =
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


  const pitCounts =
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


    if (
      Number.isFinite(number)
    ) {
      pitCounts.set(
        id,
        Math.max(
          pitCounts.get(id) ||
          0,
          number
        )
      );
    }
  }


  const lastStintByTeam =
    new Map();


  for (
    const stint
    of stints
  ) {
    const id =
      String(
        stint.apex_id
      );


    const previous =
      lastStintByTeam.get(id);


    if (
      !previous ||
      Number(
        stint.stint_number
      ) >
      Number(
        previous.stint_number
      )
    ) {
      lastStintByTeam.set(
        id,
        stint
      );
    }
  }


  const rows = [];


  for (
    const apexId
    of fieldIds
  ) {
    const id =
      String(
        apexId
      );


    const entry =
      entryMap.get(id) ||
      {};


    const lastStint =
      lastStintByTeam.get(id) ||
      {};


    const raceLap =
      Number(
        entry.lap_count
      ) ||
      Number(
        lastStint.current_lap_count
      ) ||
      0;


    rows.push({
      race_id:
        rid,

      apex_id:
        id,

      /*
       * We have not stored final ranking persistently yet.
       * Do not fake it.
       */
      position:
        null,

      team_name:
        resolveTeam(
          id,
          teamMap,
          entry.team_name,
          lastStint.team_name
        ),

      driver_name:
        lastStint.driver_name ||
        entry.current_driver ||
        null,

      current_driver:
        lastStint.driver_name ||
        entry.current_driver ||
        null,

      race_lap:
        raceLap,

      live_lap_count:
        raceLap,

      pit_count:
        pitCounts.get(id) ||
        0,

      stint_number:
        Number(
          lastStint.stint_number
        ) ||
        (
          (
            pitCounts.get(id) ||
            0
          ) +
          1
        ),

      start_lap_count:
        Number(
          lastStint.start_lap_count
        ) ||
        0,

      stint_laps:
        Number(
          lastStint.total_laps
        ) ||
        0,

      total_stint_laps:
        Number(
          lastStint.total_laps
        ) ||
        0,

      valid_laps:
        Number(
          lastStint.valid_laps
        ) ||
        0,

      live_last_lap:
        number(
          entry.last_lap
        ),

      avg_lap_time:
        number(
          lastStint.avg_lap_time
        ),

      best_lap_time:
        number(
          lastStint.best_lap_time ??
          entry.best_lap
        ),

      best_lap_number:
        number(
          lastStint.best_lap_number
        ),

      worst_lap_time:
        number(
          lastStint.worst_lap_time
        ),

      worst_lap_number:
        number(
          lastStint.worst_lap_number
        ),

      consistency:
        number(
          lastStint.consistency
        ),

      updated_at:
        entry.updated_at ||
        null
    });
  }


  /*
   * Do NOT alphabetical-sort archive as race classification.
   *
   * Since final position was not persistently stored yet,
   * use completed lap count first and Apex ID second.
   *
   * This is deterministic but is NOT exposed as a fake Pos.
   */
  rows.sort(
    (a, b) => {
      if (
        b.race_lap !==
        a.race_lap
      ) {
        return (
          b.race_lap -
          a.race_lap
        );
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


  return {
    race_id:
      rid,

    mode:
      "archive",

    session_name:
      `Race ${rid}`,

    active:
      rows.length > 0,

    data_available:
      rows.length > 0,

    is_live:
      false,

    session_status:
      "FINISHED",

    collector_connected:
      false,

    team_count:
      rows.length,

    current:
      rows
  };
}


// ============================================================
// EVENTS
// ============================================================

async function eventsPayload(
  env,
  rid,
  fieldIds
) {
  const rows =
    await loadExclusions(
      env,
      rid
    );


  return filterByField(
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
// HISTORY
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
// CSV
// ============================================================

function csvEscape(value) {
  const text =
    String(
      value ?? ""
    );


  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r")
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


// ============================================================
// STREAMING CSV
// ============================================================

async function createLapRecordsCsvResponse(
  env,
  rid,
  fieldIds
) {
  if (
    !fieldIds ||
    fieldIds.size === 0
  ) {
    return json(
      {
        error:
          "No race field available for CSV export."
      },
      404
    );
  }


  const teamMap =
    await stableTeamNameMap(
      env,
      rid,
      fieldIds
    );


  const numericIds =
    [
      ...fieldIds
    ]
      .map(
        value =>
          String(value)
            .trim()
      )
      .filter(
        value =>
          /^\d+$/.test(
            value
          )
      );


  if (
    numericIds.length === 0
  ) {
    return json(
      {
        error:
          "No valid Apex IDs available for CSV export."
      },
      404
    );
  }


  const idFilter =
    `in.(${numericIds.join(",")})`;


  /*
   * PRE-FLIGHT.
   *
   * If Supabase fails here the browser gets a proper
   * JSON error instead of an HTML / broken stream.
   */
  const firstPage =
    await sbGet(
      env,
      "apex_lap_events",
      {
        select:
          "apex_id,lap_number,lap_time",

        race_id:
          `eq.${rid}`,

        apex_id:
          idFilter,

        order:
          "apex_id.asc,lap_number.asc"
      },
      {
        from:
          0,

        to:
          PAGE_SIZE -
          1
      }
    );


  if (
    !firstPage.length
  ) {
    return json(
      {
        error:
          `No lap records found for race ${rid}.`
      },
      404
    );
  }


  const encoder =
    new TextEncoder();


  const stream =
    new ReadableStream({

      async start(controller) {

        function write(value) {
          controller.enqueue(
            encoder.encode(
              value
            )
          );
        }


        let activeApexId =
          null;


        function writeTeamHeader(
          apexId
        ) {
          const team =
            teamMap.get(
              String(
                apexId
              )
            ) ||
            `APEX ${apexId}`;


          write(
            "\r\n"
          );


          write(
            `${csvEscape(apexId)} - ${csvEscape(team)}\r\n`
          );


          write(
            "Lap,Time\r\n"
          );
        }


        function processPage(page) {
          for (
            const row
            of page
          ) {
            const apexId =
              String(
                row.apex_id
              );


            const lap =
              Number(
                row.lap_number
              );


            const lapTime =
              Number(
                row.lap_time
              );


            if (
              !apexId ||
              !Number.isFinite(lap) ||
              !Number.isFinite(lapTime) ||
              lapTime <= 0
            ) {
              continue;
            }


            if (
              apexId !==
              activeApexId
            ) {
              activeApexId =
                apexId;


              writeTeamHeader(
                apexId
              );
            }


            /*
             * RAW REPORT.
             *
             * Nothing removed.
             */
            write(
              `${Math.trunc(lap)},${lapTime.toFixed(3)}\r\n`
            );
          }
        }


        try {
          write(
            "\uFEFF"
          );


          write(
            "Apex Timing - drive your success https://www.apex-timing.com/\r\n"
          );


          write(
            "\r\n"
          );


          write(
            "Karting Events Bulgaria - Karting Track\r\n"
          );


          write(
            "\r\n"
          );


          write(
            `Race ${rid} - Lap time records\r\n`
          );


          processPage(
            firstPage
          );


          let from =
            firstPage.length;


          if (
            firstPage.length ===
            PAGE_SIZE
          ) {
            while (true) {
              const page =
                await sbGet(
                  env,
                  "apex_lap_events",
                  {
                    select:
                      "apex_id,lap_number,lap_time",

                    race_id:
                      `eq.${rid}`,

                    apex_id:
                      idFilter,

                    order:
                      "apex_id.asc,lap_number.asc"
                  },
                  {
                    from,

                    to:
                      from +
                      PAGE_SIZE -
                      1
                  }
                );


              processPage(
                page
              );


              if (
                page.length <
                PAGE_SIZE
              ) {
                break;
              }


              from +=
                page.length;
            }
          }


          write(
            "\r\n"
          );


          controller.close();

        } catch (error) {
          console.error(
            "CSV STREAM ERROR",
            error
          );


          controller.error(
            error
          );
        }
      }
    });


  const filename =
    safeFilename(
      `Race ${rid} - Lap time records.csv`
    );


  return new Response(
    stream,
    {
      status: 200,

      headers: {
        "content-type":
          "text/csv; charset=utf-8",

        "content-disposition":
          `attachment; filename="${filename}"`,

        "cache-control":
          "no-store, no-cache, must-revalidate",

        pragma:
          "no-cache",

        expires:
          "0",

        "x-content-type-options":
          "nosniff"
      }
    }
  );
}


// ============================================================
// PIT REPORT
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


  const sections =
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

<h2>${escapeHtml(apexId)} - ${escapeHtml(team)}</h2>

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
<th>Consistency</th>
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
<td>${escapeHtml(row.consistency ?? "")}</td>
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
Race ${rid} - Stints & Pit Stops
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

<button onclick="window.print()">
Print / Save PDF
</button>

<h1>
Race ${rid} - Stints & Pit Stops
</h1>

${sections}

</body>

</html>
`;
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

    /*
     * Collector ALWAYS writes to configured CURRENT race.
     *
     * Archive query parameters must NEVER change the collector.
     */
    this.rid =
      configuredRaceId(
        env
      );


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
        )
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


    const detailRequest =
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

              request:
                detailRequest
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


  async refreshDetail(
    apexId
  ) {
    const id =
      String(
        apexId
      );


    if (
      this.fieldApexIds.size > 0 &&
      !this.fieldApexIds.has(id)
    ) {
      return;
    }


    if (
      this.detailRunning.has(id)
    ) {
      return;
    }


    const now =
      Date.now();


    if (
      now -
      (
        this.lastDetailFetch.get(
          id
        ) ||
        0
      ) <
      1500
    ) {
      return;
    }


    const entry =
      await this.getEntry(
        id
      );


    const lapCount =
      Number(
        entry?.lap_count
      );


    if (
      !entry ||
      !Number.isFinite(
        lapCount
      ) ||
      lapCount <= 0
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
      const raw =
        await this.requestDetail(
          id,
          lapCount
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
        let i = 0;
        i <
          laps.length;
        i += 250
      ) {
        await sbUpsert(
          this.env,
          "apex_lap_events",
          laps.slice(
            i,
            i + 250
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
              row =>
                Number(
                  row.pit_number
                ) ||
                0
            )
          )
        );
      }


      await this.persist();

    } finally {
      this.detailRunning.delete(
        id
      );
    }
  }


  async applyField(
    apexId,
    type,
    cls,
    value,
    column
  ) {
    if (
      cls === "drteam" ||
      type === "drteam"
    ) {
      const driver =
        cleanDriver(
          value
        );


      if (driver) {
        await this.upsertEntry(
          apexId,
          {
            current_driver:
              driver
          }
        );
      }


      return;
    }


    if (
      cls === "dr"
    ) {
      const team =
        stripHtml(
          value
        );


      if (team) {
        await this.upsertEntry(
          apexId,
          {
            team_name:
              team
          }
        );
      }


      return;
    }


    if (
      type === "rk" ||
      cls === "rk"
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
      type === "pit" ||
      cls === "pit"
    ) {
      const pits =
        parseNumber(
          value
        );


      if (
        pits !== null &&
        pits >= 0
      ) {
        this.pitCounts.set(
          String(
            apexId
          ),
          Math.trunc(
            pits
          )
        );
      }


      return;
    }


    if (
      type === "llp" ||
      cls === "llp" ||
      (
        cls === "tn" &&
        column === "9"
      )
    ) {
      const lap =
        parseLapTime(
          value
        );


      if (
        lap !== null
      ) {
        await this.upsertEntry(
          apexId,
          {
            last_lap:
              lap
          }
        );
      }


      return;
    }


    if (
      type === "blp" ||
      cls === "blp"
    ) {
      const lap =
        parseLapTime(
          value
        );


      if (
        lap !== null
      ) {
        await this.upsertEntry(
          apexId,
          {
            best_lap:
              lap
          }
        );
      }


      return;
    }


    if (
      type === "tlp" ||
      cls === "tlp" ||
      (
        cls === "in" &&
        column === "13"
      )
    ) {
      const lapCount =
        parseNumber(
          value
        );


      if (
        lapCount !== null &&
        lapCount >= 0
      ) {
        await this.upsertEntry(
          apexId,
          {
            lap_count:
              Math.trunc(
                lapCount
              )
          }
        );


        this.state.waitUntil(
          this.refreshDetail(
            apexId
          )
        );
      }
    }
  }


  async parseAndSave(payload) {
    for (
      const rawLine
      of String(
        payload ||
        ""
      )
        .split("\n")
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


          this.lastGridAt =
            new Date()
              .toISOString();


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
                fieldValue
              ]
              of Object.entries(
                fields
              )
            ) {
              await this.applyField(
                apexId,
                type,
                type,
                fieldValue,
                null
              );
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


      if (!row) {
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
    this.packetCount +=
      1;


    this.lastPacketAt =
      new Date()
        .toISOString();


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

    } catch (error) {
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
// ROUTER
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


    const archiveMode =
      isArchiveRequest(
        url
      );


    const rid =
      requestedRaceId(
        env,
        url
      );


    try {

      // ========================================================
      // HEALTH
      // ========================================================

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

          current_race_id:
            configuredRaceId(
              env
            ),

          now:
            new Date()
              .toISOString()
        });
      }


      // ========================================================
      // COLLECTOR
      // ========================================================

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
                "application/json; charset=utf-8"
            }
          }
        );
      }


      // ========================================================
      // RACES
      // ========================================================

      if (
        url.pathname ===
        "/api/races"
      ) {
        return json({
          current_race_id:
            configuredRaceId(
              env
            ),

          rows:
            await racesPayload(
              env
            )
        });
      }


      // ========================================================
      // RESOLVE FIELD
      // ========================================================

      let snapshot =
        null;


      let fieldIds =
        null;


      if (archiveMode) {
        fieldIds =
          await archiveFieldIds(
            env,
            rid
          );

      } else {
        snapshot =
          await collectorSnapshot(
            env
          )
            .catch(
              () => null
            );


        fieldIds =
          currentFieldIds(
            snapshot
          );
      }


      // ========================================================
      // OVERVIEW
      // ========================================================

      if (
        url.pathname ===
          "/api/live" ||
        url.pathname ===
          "/api/overview"
      ) {
        if (!archiveMode) {
          ctx.waitUntil(
            startCollector(
              env
            )
              .catch(
                console.error
              )
          );
        }


        const payload =
          archiveMode
            ? await archiveOverviewPayload(
                env,
                rid
              )
            : await currentOverviewPayload(
                env,
                rid,
                snapshot
              );


        if (
          url.pathname ===
          "/api/live"
        ) {
          return json(
            payload
          );
        }


        return json({
          race_id:
            rid,

          mode:
            payload.mode,

          active:
            payload.active,

          data_available:
            payload.data_available,

          is_live:
            payload.is_live,

          session_status:
            payload.session_status,

          team_count:
            payload.team_count,

          rows:
            payload.current
        });
      }


      // ========================================================
      // STINTS
      // ========================================================

      if (
        url.pathname ===
        "/api/stints"
      ) {
        const rows =
          archiveMode
            ? await archiveStintsPayload(
                env,
                rid
              )
            : await currentStintsPayload(
                env,
                rid,
                snapshot
              );


        return json({
          race_id:
            rid,

          mode:
            archiveMode
              ? "archive"
              : "current",

          rows
        });
      }


      // ========================================================
      // DRIVERS
      // ========================================================

      if (
        url.pathname ===
        "/api/drivers"
      ) {
        const stints =
          archiveMode
            ? await archiveStintsPayload(
                env,
                rid
              )
            : await currentStintsPayload(
                env,
                rid,
                snapshot
              );


        return json({
          race_id:
            rid,

          mode:
            archiveMode
              ? "archive"
              : "current",

          rows:
            driversFromStints(
              stints
            )
        });
      }


      // ========================================================
      // TEAMS
      // ========================================================

      if (
        url.pathname ===
        "/api/teams"
      ) {
        const stints =
          archiveMode
            ? await archiveStintsPayload(
                env,
                rid
              )
            : await currentStintsPayload(
                env,
                rid,
                snapshot
              );


        const drivers =
          driversFromStints(
            stints
          );


        const rows =
          teamsFromDrivers(
            drivers,
            archiveMode
              ? null
              : snapshot
          );


        return json({
          race_id:
            rid,

          mode:
            archiveMode
              ? "archive"
              : "current",

          rows
        });
      }


      // ========================================================
      // PITS
      // ========================================================

      if (
        url.pathname ===
        "/api/pits"
      ) {
        const rows =
          filterByField(
            await loadPits(
              env,
              rid
            ),
            fieldIds
          );


        const teamMap =
          await stableTeamNameMap(
            env,
            rid,
            fieldIds
          );


        return json({
          race_id:
            rid,

          mode:
            archiveMode
              ? "archive"
              : "current",

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


      // ========================================================
      // EVENTS
      // ========================================================

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

            mode:
              archiveMode
                ? "archive"
                : "current",

            rows:
              await eventsPayload(
                env,
                rid,
                fieldIds
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
                  "APEX ID is not part of the selected race"
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


      // ========================================================
      // RAW LAP CSV
      // ========================================================

      if (
        url.pathname ===
        "/api/reports/lap-time-records.csv"
      ) {
        return await createLapRecordsCsvResponse(
          env,
          rid,
          fieldIds
        );
      }


      // ========================================================
      // PIT / STINT PDF SOURCE
      // ========================================================

      if (
        url.pathname ===
        "/api/reports/pit-stops.html"
      ) {
        const stints =
          archiveMode
            ? await archiveStintsPayload(
                env,
                rid
              )
            : await currentStintsPayload(
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


      // ========================================================
      // UNKNOWN API
      // ========================================================

      if (
        url.pathname.startsWith(
          "/api/"
        )
      ) {
        return json(
          {
            error:
              `API route not found: ${url.pathname}`,

            version:
              VERSION
          },
          404
        );
      }


      // ========================================================
      // STATIC FILES
      // ========================================================

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
            VERSION,

          race_id:
            rid,

          mode:
            archiveMode
              ? "archive"
              : "current"
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
