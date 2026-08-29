const VERSION =
  "2026-08-30-race-datasets-v6.2-fallback-analytics";

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


    if (
      !validApexId(apexId)
    ) {
      continue;
    }


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
// APEX DETAIL RESPONSE
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
// RAW LAP LOADERS FOR FALLBACK ANALYTICS
//
// These queries are deliberately scoped to ONE Apex kart.
// We do not load the whole race lap table into memory.
// ============================================================

async function loadLapEventsForApex(
  env,
  rid,
  apexId
) {
  return sbGetAll(
    env,
    "apex_lap_events",
    {
      select:
        "race_id,apex_id,lap_number,lap_time,received_at",

      race_id:
        `eq.${rid}`,

      apex_id:
        `eq.${apexId}`,

      order:
        "lap_number.asc"
    }
  );
}


async function loadExclusionsForApex(
  env,
  rid,
  apexId
) {
  return sbGetAll(
    env,
    "manual_lap_exclusions",
    {
      select:
        "*",

      race_id:
        `eq.${rid}`,

      apex_id:
        `eq.${apexId}`,

      order:
        "lap_number.asc"
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
   * r0 / apex_id 0 is an Apex protocol/service row,
   * not a kart.
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
// ANALYTICS HELPERS
// ============================================================

function arithmeticAverage(values) {
  if (
    !values ||
    values.length === 0
  ) {
    return null;
  }


  let sum = 0;


  for (
    const value
    of values
  ) {
    sum +=
      Number(value);
  }


  return (
    sum /
    values.length
  );
}


function populationStdDev(values) {
  if (
    !values ||
    values.length === 0
  ) {
    return null;
  }


  if (
    values.length === 1
  ) {
    return 0;
  }


  const avg =
    arithmeticAverage(
      values
    );


  let squaredDifferenceSum =
    0;


  for (
    const value
    of values
  ) {
    const difference =
      Number(value) -
      avg;


    squaredDifferenceSum +=
      difference *
      difference;
  }


  return Math.sqrt(
    squaredDifferenceSum /
    values.length
  );
}


function exclusionLapSet(rows) {
  const result =
    new Set();


  for (
    const row
    of rows ||
    []
  ) {
    const lap =
      Number(
        row.lap_number
      );


    if (
      !Number.isFinite(lap)
    ) {
      continue;
    }


    /*
     * The current manual_lap_exclusions table is an exclusion
     * table. A stored row therefore means the lap is excluded.
     *
     * If a future schema adds an explicit included=false/true
     * flag, respect the obvious "included=true" case.
     */
    if (
      row.included === true ||
      row.is_included === true
    ) {
      continue;
    }


    result.add(
      Math.trunc(lap)
    );
  }


  return result;
}


function normalizeLapEvents(rows) {
  const byLap =
    new Map();


  for (
    const row
    of rows ||
    []
  ) {
    const lapNumber =
      Number(
        row.lap_number
      );


    const lapTime =
      Number(
        row.lap_time
      );


    if (
      !Number.isFinite(
        lapNumber
      ) ||
      !Number.isFinite(
        lapTime
      ) ||
      lapNumber <= 0 ||
      lapTime <= 0
    ) {
      continue;
    }


    /*
     * apex_lap_events is expected to be unique by
     * race_id/apex_id/lap_number. Keeping the last row here
     * also makes the analytics safe if an old duplicate exists.
     */
    byLap.set(
      Math.trunc(
        lapNumber
      ),
      {
        lap_number:
          Math.trunc(
            lapNumber
          ),

        lap_time:
          lapTime
      }
    );
  }


  return [
    ...byLap.values()
  ]
    .sort(
      (a, b) =>
        a.lap_number -
        b.lap_number
    );
}


// ============================================================
// PIT BOUNDARY MODEL
//
// Existing UI semantics:
//   start_lap_count = previous pit boundary
//   end_lap_count   = next pit boundary
//
// Actual race laps belonging to a completed stint are:
//
//   start_lap_count < lap_number <= end_lap_count
//
// The first recorded lap AFTER a pit boundary is the pit-out /
// transition lap and is excluded from pace analytics.
//
// The end boundary itself is NOT automatically removed. It is a
// real completed lap unless another explicit exclusion removes it.
// ============================================================

function pitOutLapForStint(
  startLapCount
) {
  const start =
    Number(
      startLapCount
    );


  if (
    !Number.isFinite(start) ||
    start <= 0
  ) {
    return null;
  }


  return (
    Math.trunc(start) +
    1
  );
}


function lapBelongsToCompletedStint(
  lapNumber,
  startLapCount,
  endLapCount
) {
  const lap =
    Number(
      lapNumber
    );


  const start =
    Number(
      startLapCount
    );


  const end =
    Number(
      endLapCount
    );


  if (
    !Number.isFinite(lap) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return false;
  }


  return (
    lap > start &&
    lap <= end
  );
}


function lapBelongsToLiveStint(
  lapNumber,
  startLapCount,
  currentLapCount
) {
  const lap =
    Number(
      lapNumber
    );


  const start =
    Number(
      startLapCount
    );


  const current =
    Number(
      currentLapCount
    );


  if (
    !Number.isFinite(lap) ||
    !Number.isFinite(start) ||
    !Number.isFinite(current)
  ) {
    return false;
  }


  return (
    lap > start &&
    lap <= current
  );
}


// ============================================================
// FALLBACK STINT ANALYTICS
//
// IMPORTANT:
// - No arbitrary lap-time threshold is used.
// - Raw long laps are preserved in apex_lap_events and CSV.
// - Pace analytics remove only known exclusions here:
//     1. pit-out transition lap
//     2. manual exclusions
//
// Existing completed_stint_stats remain authoritative when they
// exist. This calculation is used to fill missing pit-defined
// stints instead of returning valid_laps=0.
// ============================================================

function calculateStintAnalytics({
  lapEvents,
  manualExclusions,
  startLapCount,
  endLapCount = null,
  currentLapCount = null,
  isLive = false
}) {
  const start =
    Number(
      startLapCount
    );


  const end =
    isLive
      ? Number(
          currentLapCount
        )
      : Number(
          endLapCount
        );


  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  ) {
    return {
      total_laps:
        0,

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


  const totalLaps =
    Math.max(
      0,
      Math.trunc(end) -
      Math.trunc(start)
    );


  const excluded =
    exclusionLapSet(
      manualExclusions
    );


  const pitOutLap =
    pitOutLapForStint(
      start
    );


  if (
    pitOutLap !== null
  ) {
    excluded.add(
      pitOutLap
    );
  }


  const validRows = [];


  for (
    const row
    of lapEvents
  ) {
    const lap =
      Number(
        row.lap_number
      );


    const belongs =
      isLive
        ? lapBelongsToLiveStint(
            lap,
            start,
            end
          )
        : lapBelongsToCompletedStint(
            lap,
            start,
            end
          );


    if (!belongs) {
      continue;
    }


    if (
      excluded.has(
        Math.trunc(lap)
      )
    ) {
      continue;
    }


    const lapTime =
      Number(
        row.lap_time
      );


    if (
      !Number.isFinite(
        lapTime
      ) ||
      lapTime <= 0
    ) {
      continue;
    }


    validRows.push({
      lap_number:
        Math.trunc(lap),

      lap_time:
        lapTime
    });
  }


  if (
    validRows.length === 0
  ) {
    return {
      total_laps:
        totalLaps,

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


  const times =
    validRows.map(
      row =>
        row.lap_time
    );


  const average =
    arithmeticAverage(
      times
    );


  let bestRow =
    validRows[0];


  let worstRow =
    validRows[0];


  for (
    const row
    of validRows
  ) {
    if (
      row.lap_time <
      bestRow.lap_time
    ) {
      bestRow =
        row;
    }


    if (
      row.lap_time >
      worstRow.lap_time
    ) {
      worstRow =
        row;
    }
  }


  return {
    total_laps:
      totalLaps,

    valid_laps:
      validRows.length,

    avg_lap_time:
      average,

    best_lap_time:
      bestRow.lap_time,

    best_lap_number:
      bestRow.lap_number,

    worst_lap_time:
      worstRow.lap_time,

    worst_lap_number:
      worstRow.lap_number,

    consistency:
      populationStdDev(
        times
      )
  };
}


// ============================================================
// PIT CHAIN HELPERS
// ============================================================

function groupPitsByApex(
  pits
) {
  const result =
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
      !result.has(id)
    ) {
      result.set(
        id,
        []
      );
    }


    result
      .get(id)
      .push(pit);
  }


  for (
    const rows
    of result.values()
  ) {
    rows.sort(
      (a, b) => {
        const lapA =
          Number(
            a.pit_lap
          );


        const lapB =
          Number(
            b.pit_lap
          );


        if (
          Number.isFinite(lapA) &&
          Number.isFinite(lapB) &&
          lapA !== lapB
        ) {
          return (
            lapA -
            lapB
          );
        }


        return (
          Number(
            a.pit_number
          ) -
          Number(
            b.pit_number
          )
        );
      }
    );
  }


  return result;
}


function uniquePitBoundaries(
  pits
) {
  const result = [];

  const seen =
    new Set();


  for (
    const pit
    of pits ||
    []
  ) {
    const lap =
      Number(
        pit.pit_lap
      );


    if (
      !Number.isFinite(lap) ||
      lap <= 0
    ) {
      continue;
    }


    const integerLap =
      Math.trunc(lap);


    if (
      seen.has(
        integerLap
      )
    ) {
      continue;
    }


    seen.add(
      integerLap
    );


    result.push({
      ...pit,

      pit_lap:
        integerLap
    });
  }


  result.sort(
    (a, b) =>
      Number(
        a.pit_lap
      ) -
      Number(
        b.pit_lap
      )
  );


  return result;
}


function completedStintMapByStart(
  rows
) {
  const result =
    new Map();


  for (
    const row
    of rows ||
    []
  ) {
    const start =
      Number(
        row.start_lap_count
      );


    if (
      !Number.isFinite(start)
    ) {
      continue;
    }


    result.set(
      Math.trunc(start),
      row
    );
  }


  return result;
}


function liveStintMapByStart(
  rows
) {
  const result =
    new Map();


  for (
    const row
    of rows ||
    []
  ) {
    const start =
      Number(
        row.start_lap_count
      );


    if (
      !Number.isFinite(start)
    ) {
      continue;
    }


    result.set(
      Math.trunc(start),
      row
    );
  }


  return result;
}


function findPitEndingAt(
  pits,
  endLap
) {
  const target =
    Number(
      endLap
    );


  if (
    !Number.isFinite(target)
  ) {
    return null;
  }


  return (
    pits.find(
      pit =>
        Number(
          pit.pit_lap
        ) ===
        target
    ) ||
    null
  );
}


// ============================================================
// BUILD COMPLETE STINT CHAIN FOR ONE TEAM
//
// apex_pit_stints defines the authoritative boundary chain.
// completed_stint_stats enriches matching completed boundaries.
// Missing analytics are rebuilt from apex_lap_events.
//
// A live row is appended ONLY after the final known pit boundary.
// Therefore a stale live row at 639 cannot appear before the
// historical 491->546 ... 637->639 chain.
// ============================================================

async function buildCompleteStintChainForTeam({
  env,
  rid,
  apexId,
  pits,
  completedRows,
  liveRows,
  entry,
  teamMap,
  sessionIsLive
}) {
  const id =
    String(
      apexId
    );


  const boundaries =
    uniquePitBoundaries(
      pits
    );


  const completedByStart =
    completedStintMapByStart(
      completedRows
    );


  const liveByStart =
    liveStintMapByStart(
      liveRows
    );


  const needsRawAnalytics =
    boundaries.some(
      (
        pit,
        index
      ) => {
        const start =
          index === 0
            ? 0
            : Number(
                boundaries[
                  index - 1
                ].pit_lap
              );


        const completed =
          completedByStart.get(
            start
          );


        if (!completed) {
          return true;
        }


        const valid =
          Number(
            completed.valid_laps
          );


        const average =
          Number(
            completed.avg_lap_time ??
            completed.avg_lap
          );


        return (
          !Number.isFinite(valid) ||
          valid <= 0 ||
          !Number.isFinite(average) ||
          average <= 0
        );
      }
    );


  let lapEvents = [];

  let manualExclusions = [];


  if (
    needsRawAnalytics
  ) {
    [
      lapEvents,
      manualExclusions
    ] =
      await Promise.all([
        loadLapEventsForApex(
          env,
          rid,
          id
        )
          .then(
            normalizeLapEvents
          )
          .catch(
            () => []
          ),

        loadExclusionsForApex(
          env,
          rid,
          id
        )
          .catch(
            () => []
          )
      ]);
  }


  const result = [];

  let previousBoundary =
    0;


  for (
    let index = 0;
    index <
      boundaries.length;
    index++
  ) {
    const pit =
      boundaries[index];


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


    const completed =
      completedByStart.get(
        previousBoundary
      );


    const normalizedCompleted =
      completed
        ? normalizeStintRow(
            completed,
            teamMap,
            "COMPLETED"
          )
        : null;


    const analyticsMissing =
      !normalizedCompleted ||
      !Number.isFinite(
        Number(
          normalizedCompleted
            .avg_lap_time
        )
      ) ||
      Number(
        normalizedCompleted
          .valid_laps
      ) <= 0;


    let analytics =
      null;


    if (
      analyticsMissing
    ) {
      if (
        lapEvents.length === 0
      ) {
        lapEvents =
          await loadLapEventsForApex(
            env,
            rid,
            id
          )
            .then(
              normalizeLapEvents
            )
            .catch(
              () => []
            );
      }


      if (
        manualExclusions.length ===
        0
      ) {
        manualExclusions =
          await loadExclusionsForApex(
            env,
            rid,
            id
          )
            .catch(
              () => []
            );
      }


      analytics =
        calculateStintAnalytics({
          lapEvents,

          manualExclusions,

          startLapCount:
            previousBoundary,

          endLapCount:
            endBoundary,

          isLive:
            false
        });
    }


    const row =
      normalizedCompleted
        ? {
            ...normalizedCompleted
          }
        : {
            race_id:
              rid,

            apex_id:
              id,

            team_name:
              resolveTeam(
                id,
                teamMap,
                pit.team_name,
                entry?.team_name
              ),

            driver_name:
              pit.driver_name ||
              null,

            stint_number:
              index + 1,

            start_lap_count:
              previousBoundary,

            end_lap_count:
              endBoundary,

            current_lap_count:
              null,

            total_laps:
              Math.max(
                0,
                endBoundary -
                previousBoundary
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
          };


    /*
     * The pit chain controls numbering and boundaries even when
     * an old completed statistics row contains stale numbering.
     */
    row.stint_number =
      index + 1;

    row.start_lap_count =
      previousBoundary;

    row.end_lap_count =
      endBoundary;

    row.total_laps =
      Math.max(
        0,
        endBoundary -
        previousBoundary
      );

    row.is_live =
      false;

    row.status =
      "COMPLETED";


    if (
      !row.driver_name
    ) {
      row.driver_name =
        pit.driver_name ||
        null;
    }


    row.team_name =
      resolveTeam(
        id,
        teamMap,
        row.team_name,
        pit.team_name,
        entry?.team_name
      );


    if (
      analytics
    ) {
      row.total_laps =
        analytics.total_laps;

      row.valid_laps =
        analytics.valid_laps;

      row.avg_lap_time =
        analytics.avg_lap_time;

      row.best_lap_time =
        analytics.best_lap_time;

      row.best_lap_number =
        analytics.best_lap_number;

      row.worst_lap_time =
        analytics.worst_lap_time;

      row.worst_lap_number =
        analytics.worst_lap_number;

      row.consistency =
        analytics.consistency;
    }


    result.push(row);


    previousBoundary =
      endBoundary;
  }


  const currentLap =
    Number(
      entry?.lap_count
    );


  /*
   * A stale live_stint_stats row is not enough to create a LIVE
   * stint after the race has stopped. We append a live stint only
   * while the collector is genuinely receiving timing AND the
   * entry lap count is beyond the final pit boundary.
   */
  if (
    sessionIsLive &&
    Number.isFinite(
      currentLap
    ) &&
    currentLap >
      previousBoundary
  ) {
    const storedLive =
      liveByStart.get(
        previousBoundary
      ) ||
      null;


    const normalizedLive =
      storedLive
        ? normalizeStintRow(
            storedLive,
            teamMap,
            "LIVE"
          )
        : null;


    let liveAnalytics =
      null;


    if (
      !normalizedLive ||
      Number(
        normalizedLive
          .valid_laps
      ) <= 0 ||
      !Number.isFinite(
        Number(
          normalizedLive
            .avg_lap_time
        )
      )
    ) {
      if (
        lapEvents.length === 0
      ) {
        lapEvents =
          await loadLapEventsForApex(
            env,
            rid,
            id
          )
            .then(
              normalizeLapEvents
            )
            .catch(
              () => []
            );
      }


      if (
        manualExclusions.length ===
        0
      ) {
        manualExclusions =
          await loadExclusionsForApex(
            env,
            rid,
            id
          )
            .catch(
              () => []
            );
      }


      liveAnalytics =
        calculateStintAnalytics({
          lapEvents,

          manualExclusions,

          startLapCount:
            previousBoundary,

          currentLapCount:
            currentLap,

          isLive:
            true
        });
    }


    const liveRow =
      normalizedLive
        ? {
            ...normalizedLive
          }
        : {
            race_id:
              rid,

            apex_id:
              id,

            team_name:
              resolveTeam(
                id,
                teamMap,
                entry?.team_name
              ),

            driver_name:
              entry?.current_driver ||
              null,

            stint_number:
              result.length + 1,

            start_lap_count:
              previousBoundary,

            end_lap_count:
              null,

            current_lap_count:
              currentLap,

            total_laps:
              Math.max(
                0,
                currentLap -
                previousBoundary
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
          };


    liveRow.stint_number =
      result.length + 1;

    liveRow.start_lap_count =
      previousBoundary;

    liveRow.end_lap_count =
      null;

    liveRow.current_lap_count =
      currentLap;

    liveRow.total_laps =
      Math.max(
        0,
        currentLap -
        previousBoundary
      );

    liveRow.is_live =
      true;

    liveRow.status =
      "LIVE";


    liveRow.team_name =
      resolveTeam(
        id,
        teamMap,
        liveRow.team_name,
        entry?.team_name
      );


    if (
      !liveRow.driver_name
    ) {
      liveRow.driver_name =
        entry?.current_driver ||
        null;
    }


    if (
      liveAnalytics
    ) {
      liveRow.total_laps =
        liveAnalytics.total_laps;

      liveRow.valid_laps =
        liveAnalytics.valid_laps;

      liveRow.avg_lap_time =
        liveAnalytics.avg_lap_time;

      liveRow.best_lap_time =
        liveAnalytics.best_lap_time;

      liveRow.best_lap_number =
        liveAnalytics.best_lap_number;

      liveRow.worst_lap_time =
        liveAnalytics.worst_lap_time;

      liveRow.worst_lap_number =
        liveAnalytics.worst_lap_number;

      liveRow.consistency =
        liveAnalytics.consistency;
    }


    result.push(
      liveRow
    );
  }


  /*
   * If there are no pit rows at all, preserve the existing
   * analytical data instead of returning an empty team.
   */
  if (
    boundaries.length === 0
  ) {
    const completedOnly =
      completedRows
        .map(
          row =>
            normalizeStintRow(
              row,
              teamMap,
              "COMPLETED"
            )
        )
        .sort(
          (a, b) =>
            Number(
              a.start_lap_count
            ) -
            Number(
              b.start_lap_count
            )
        );


    for (
      let i = 0;
      i <
        completedOnly.length;
      i++
    ) {
      completedOnly[
        i
      ].stint_number =
        i + 1;
    }


    result.push(
      ...completedOnly
    );


    if (
      sessionIsLive &&
      liveRows.length > 0
    ) {
      const newestLive =
        [
          ...liveRows
        ]
          .sort(
            (a, b) =>
              Number(
                b.start_lap_count
              ) -
              Number(
                a.start_lap_count
              )
          )[0];


      const liveRow =
        normalizeStintRow(
          newestLive,
          teamMap,
          "LIVE"
        );


      const duplicate =
        result.some(
          row =>
            Number(
              row.start_lap_count
            ) ===
            Number(
              liveRow.start_lap_count
            )
        );


      if (!duplicate) {
        liveRow.stint_number =
          result.length + 1;

        result.push(
          liveRow
        );
      }
    }
  }


  return result;
}

// ============================================================
// STINT DATASET
// ============================================================

async function stintsPayload(
  env,
  rid,
  snapshot = null
) {
  const liveSnapshot =
    snapshot ||
    await collectorSnapshot(
      env
    )
      .catch(
        () => ({
          connected: false,
          last_packet_at: null,
          fieldApexIds: [],
          positions: {}
        })
      );


  const fieldIds =
    currentFieldIds(
      liveSnapshot
    );


  const [
    completed,
    live,
    pits,
    entries,
    teamMap
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
      )
        .catch(
          () => []
        ),

      loadEntries(
        env,
        rid
      )
        .catch(
          () => []
        ),

      stableTeamNameMap(
        env,
        rid
      )
    ]);


  const currentCompleted =
    filterCurrentField(
      completed,
      fieldIds
    );


  const currentLive =
    filterCurrentField(
      live,
      fieldIds
    );


  const currentPits =
    filterCurrentField(
      pits,
      fieldIds
    );


  const currentEntries =
    filterCurrentField(
      entries,
      fieldIds
    );


  const newestEntryByApex =
    new Map();


  for (
    const row
    of currentEntries
  ) {
    const id =
      String(
        row.apex_id
      );


    const existing =
      newestEntryByApex.get(
        id
      );


    if (!existing) {
      newestEntryByApex.set(
        id,
        row
      );

      continue;
    }


    const currentTime =
      Date.parse(
        row.updated_at ||
        row.received_at ||
        0
      );


    const existingTime =
      Date.parse(
        existing.updated_at ||
        existing.received_at ||
        0
      );


    if (
      Number.isFinite(
        currentTime
      ) &&
      (
        !Number.isFinite(
          existingTime
        ) ||
        currentTime >
        existingTime
      )
    ) {
      newestEntryByApex.set(
        id,
        row
      );
    }
  }


  const completedByApex =
    new Map();


  for (
    const row
    of currentCompleted
  ) {
    const id =
      String(
        row.apex_id
      );


    if (
      !completedByApex.has(
        id
      )
    ) {
      completedByApex.set(
        id,
        []
      );
    }


    completedByApex
      .get(id)
      .push(row);
  }


  const liveByApex =
    new Map();


  for (
    const row
    of currentLive
  ) {
    const id =
      String(
        row.apex_id
      );


    if (
      !liveByApex.has(
        id
      )
    ) {
      liveByApex.set(
        id,
        []
      );
    }


    liveByApex
      .get(id)
      .push(row);
  }


  const pitsByApex =
    groupPitsByApex(
      currentPits
    );


  const lastPacketTime =
    Date.parse(
      liveSnapshot
        ?.last_packet_at ||
      ""
    );


  const sessionIsLive =
    Boolean(
      liveSnapshot
        ?.connected
    ) &&
    Number.isFinite(
      lastPacketTime
    ) &&
    (
      Date.now() -
      lastPacketTime
    ) <
      180000;


  const ids = [];


  if (
    fieldIds.size > 0
  ) {
    for (
      const id
      of fieldIds
    ) {
      if (
        validApexId(id)
      ) {
        ids.push(
          String(id)
        );
      }
    }
  }


  /*
   * Normally fieldApexIds is authoritative.
   *
   * The fallback below is only for old collector state where
   * fieldApexIds has not yet been populated. It still rejects
   * Apex ID 0.
   */
  if (
    ids.length === 0
  ) {
    const fallbackIds =
      new Set();


    for (
      const source
      of [
        currentCompleted,
        currentLive,
        currentPits,
        currentEntries
      ]
    ) {
      for (
        const row
        of source
      ) {
        const id =
          String(
            row.apex_id ??
            ""
          );


        if (
          validApexId(id)
        ) {
          fallbackIds.add(
            id
          );
        }
      }
    }


    ids.push(
      ...fallbackIds
    );
  }


  const positionMap =
    new Map();


  for (
    const [
      id,
      position
    ]
    of Object.entries(
      liveSnapshot
        ?.positions ||
      {}
    )
  ) {
    if (
      validApexId(id)
    ) {
      positionMap.set(
        String(id),
        Number(position)
      );
    }
  }


  ids.sort(
    (a, b) => {
      const posA =
        positionMap.get(a);

      const posB =
        positionMap.get(b);


      if (
        Number.isFinite(
          posA
        ) &&
        Number.isFinite(
          posB
        ) &&
        posA !== posB
      ) {
        return (
          posA -
          posB
        );
      }


      if (
        Number.isFinite(
          posA
        )
      ) {
        return -1;
      }


      if (
        Number.isFinite(
          posB
        )
      ) {
        return 1;
      }


      return (
        Number(a) -
        Number(b)
      );
    }
  );


  const rows = [];


  /*
   * Process one kart at a time.
   *
   * This is intentional. A 25h race can contain well over
   * 100,000 lap records. We never load all raw lap events for
   * all teams in one query.
   */
  for (
    const id
    of ids
  ) {
    const teamRows =
      await buildCompleteStintChainForTeam({
        env,

        rid,

        apexId:
          id,

        pits:
          pitsByApex.get(id) ||
          [],

        completedRows:
          completedByApex.get(id) ||
          [],

        liveRows:
          liveByApex.get(id) ||
          [],

        entry:
          newestEntryByApex.get(id) ||
          null,

        teamMap,

        sessionIsLive
      });


    rows.push(
      ...teamRows
    );
  }


  rows.sort(
    (a, b) => {
      const posA =
        positionMap.get(
          String(
            a.apex_id
          )
        );

      const posB =
        positionMap.get(
          String(
            b.apex_id
          )
        );


      if (
        Number.isFinite(
          posA
        ) &&
        Number.isFinite(
          posB
        ) &&
        posA !== posB
      ) {
        return (
          posA -
          posB
        );
      }


      if (
        Number.isFinite(
          posA
        )
      ) {
        return -1;
      }


      if (
        Number.isFinite(
          posB
        )
      ) {
        return 1;
      }


      const teamCompare =
        String(
          a.team_name ||
          ""
        )
          .localeCompare(
            String(
              b.team_name ||
              ""
            )
          );


      if (
        teamCompare !== 0
      ) {
        return teamCompare;
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


  return {
    race_id:
      rid,

    version:
      VERSION,

    session_live:
      sessionIsLive,

    field_count:
      fieldIds.size,

    count:
      rows.length,

    rows
  };
}


// ============================================================
// DRIVER DATASET
// ============================================================

function driverKey(
  apexId,
  driverName
) {
  return (
    `${String(apexId)}::` +
    `${String(driverName || "")}`
  );
}


function weightedAverage(
  currentAverage,
  currentCount,
  nextAverage,
  nextCount
) {
  const a =
    Number(
      currentAverage
    );

  const ac =
    Number(
      currentCount
    );

  const b =
    Number(
      nextAverage
    );

  const bc =
    Number(
      nextCount
    );


  if (
    !Number.isFinite(b) ||
    !Number.isFinite(bc) ||
    bc <= 0
  ) {
    return (
      Number.isFinite(a)
        ? a
        : null
    );
  }


  if (
    !Number.isFinite(a) ||
    !Number.isFinite(ac) ||
    ac <= 0
  ) {
    return b;
  }


  return (
    (
      a * ac +
      b * bc
    ) /
    (
      ac +
      bc
    )
  );
}


function buildDriversFromStints(
  stintRows
) {
  const map =
    new Map();


  for (
    const stint
    of stintRows
  ) {
    const driver =
      cleanDriver(
        stint.driver_name
      );


    if (!driver) {
      continue;
    }


    const key =
      driverKey(
        stint.apex_id,
        driver
      );


    if (
      !map.has(key)
    ) {
      map.set(
        key,
        {
          race_id:
            Number(
              stint.race_id
            ),

          apex_id:
            String(
              stint.apex_id
            ),

          team_name:
            stint.team_name ||
            null,

          driver_name:
            driver,

          stint_count:
            0,

          completed_stints:
            0,

          live_stints:
            0,

          total_laps:
            0,

          valid_laps:
            0,

          avg_lap_time:
            null,

          best_lap_time:
            null,

          best_lap_number:
            null,

          best_stint_number:
            null,

          worst_lap_time:
            null,

          worst_lap_number:
            null,

          worst_stint_number:
            null,

          consistency:
            null,

          is_live:
            false
        }
      );
    }


    const target =
      map.get(key);


    const previousValid =
      Number(
        target.valid_laps
      ) ||
      0;


    const nextValid =
      Number(
        stint.valid_laps
      ) ||
      0;


    target.avg_lap_time =
      weightedAverage(
        target.avg_lap_time,
        previousValid,
        stint.avg_lap_time,
        nextValid
      );


    target.consistency =
      weightedAverage(
        target.consistency,
        previousValid,
        stint.consistency,
        nextValid
      );


    target.stint_count +=
      1;


    if (
      stint.is_live
    ) {
      target.live_stints +=
        1;

      target.is_live =
        true;
    } else {
      target.completed_stints +=
        1;
    }


    target.total_laps +=
      Number(
        stint.total_laps
      ) ||
      0;


    target.valid_laps +=
      nextValid;


    const best =
      Number(
        stint.best_lap_time
      );


    if (
      Number.isFinite(best) &&
      (
        !Number.isFinite(
          Number(
            target.best_lap_time
          )
        ) ||
        best <
        Number(
          target.best_lap_time
        )
      )
    ) {
      target.best_lap_time =
        best;

      target.best_lap_number =
        number(
          stint.best_lap_number
        );

      target.best_stint_number =
        number(
          stint.stint_number
        );
    }


    const worst =
      Number(
        stint.worst_lap_time
      );


    if (
      Number.isFinite(worst) &&
      (
        !Number.isFinite(
          Number(
            target.worst_lap_time
          )
        ) ||
        worst >
        Number(
          target.worst_lap_time
        )
      )
    ) {
      target.worst_lap_time =
        worst;

      target.worst_lap_number =
        number(
          stint.worst_lap_number
        );

      target.worst_stint_number =
        number(
          stint.stint_number
        );
    }
  }


  return [
    ...map.values()
  ]
    .sort(
      (a, b) => {
        const teamCompare =
          String(
            a.team_name ||
            ""
          )
            .localeCompare(
              String(
                b.team_name ||
                ""
              )
            );


        if (
          teamCompare !== 0
        ) {
          return teamCompare;
        }


        return (
          String(
            a.driver_name ||
            ""
          )
            .localeCompare(
              String(
                b.driver_name ||
                ""
              )
            )
        );
      }
    );
}


async function driversPayload(
  env,
  rid,
  snapshot = null,
  stintData = null
) {
  const stints =
    stintData ||
    await stintsPayload(
      env,
      rid,
      snapshot
    );


  const rows =
    buildDriversFromStints(
      stints.rows
    );


  return {
    race_id:
      rid,

    version:
      VERSION,

    session_live:
      stints.session_live,

    count:
      rows.length,

    rows
  };
}


// ============================================================
// TEAM DATASET
// ============================================================

function buildTeamsFromStints(
  stintRows
) {
  const map =
    new Map();


  for (
    const stint
    of stintRows
  ) {
    const id =
      String(
        stint.apex_id
      );


    if (
      !validApexId(id)
    ) {
      continue;
    }


    if (
      !map.has(id)
    ) {
      map.set(
        id,
        {
          race_id:
            Number(
              stint.race_id
            ),

          apex_id:
            id,

          team_name:
            stint.team_name ||
            null,

          stint_count:
            0,

          completed_stints:
            0,

          live_stints:
            0,

          total_laps:
            0,

          valid_laps:
            0,

          avg_lap_time:
            null,

          best_lap_time:
            null,

          best_lap_number:
            null,

          best_driver:
            null,

          best_stint_number:
            null,

          worst_lap_time:
            null,

          worst_lap_number:
            null,

          worst_driver:
            null,

          worst_stint_number:
            null,

          consistency:
            null,

          is_live:
            false
        }
      );
    }


    const target =
      map.get(id);


    if (
      !target.team_name &&
      stint.team_name
    ) {
      target.team_name =
        stint.team_name;
    }


    const previousValid =
      Number(
        target.valid_laps
      ) ||
      0;


    const nextValid =
      Number(
        stint.valid_laps
      ) ||
      0;


    target.avg_lap_time =
      weightedAverage(
        target.avg_lap_time,
        previousValid,
        stint.avg_lap_time,
        nextValid
      );


    target.consistency =
      weightedAverage(
        target.consistency,
        previousValid,
        stint.consistency,
        nextValid
      );


    target.stint_count +=
      1;


    if (
      stint.is_live
    ) {
      target.live_stints +=
        1;

      target.is_live =
        true;
    } else {
      target.completed_stints +=
        1;
    }


    target.total_laps +=
      Number(
        stint.total_laps
      ) ||
      0;


    target.valid_laps +=
      nextValid;


    const best =
      Number(
        stint.best_lap_time
      );


    if (
      Number.isFinite(best) &&
      (
        !Number.isFinite(
          Number(
            target.best_lap_time
          )
        ) ||
        best <
        Number(
          target.best_lap_time
        )
      )
    ) {
      target.best_lap_time =
        best;

      target.best_lap_number =
        number(
          stint.best_lap_number
        );

      target.best_driver =
        stint.driver_name ||
        null;

      target.best_stint_number =
        number(
          stint.stint_number
        );
    }


    const worst =
      Number(
        stint.worst_lap_time
      );


    if (
      Number.isFinite(worst) &&
      (
        !Number.isFinite(
          Number(
            target.worst_lap_time
          )
        ) ||
        worst >
        Number(
          target.worst_lap_time
        )
      )
    ) {
      target.worst_lap_time =
        worst;

      target.worst_lap_number =
        number(
          stint.worst_lap_number
        );

      target.worst_driver =
        stint.driver_name ||
        null;

      target.worst_stint_number =
        number(
          stint.stint_number
        );
    }
  }


  return [
    ...map.values()
  ];
}


async function teamsPayload(
  env,
  rid,
  snapshot = null,
  stintData = null
) {
  const liveSnapshot =
    snapshot ||
    await collectorSnapshot(
      env
    )
      .catch(
        () => ({
          fieldApexIds: [],
          positions: {}
        })
      );


  const stints =
    stintData ||
    await stintsPayload(
      env,
      rid,
      liveSnapshot
    );


  const rows =
    buildTeamsFromStints(
      stints.rows
    );


  const positionMap =
    new Map();


  for (
    const [
      id,
      position
    ]
    of Object.entries(
      liveSnapshot
        ?.positions ||
      {}
    )
  ) {
    if (
      validApexId(id)
    ) {
      positionMap.set(
        String(id),
        Number(position)
      );
    }
  }


  rows.sort(
    (a, b) => {
      const posA =
        positionMap.get(
          String(
            a.apex_id
          )
        );

      const posB =
        positionMap.get(
          String(
            b.apex_id
          )
        );


      if (
        Number.isFinite(
          posA
        ) &&
        Number.isFinite(
          posB
        ) &&
        posA !== posB
      ) {
        return (
          posA -
          posB
        );
      }


      if (
        Number.isFinite(
          posA
        )
      ) {
        return -1;
      }


      if (
        Number.isFinite(
          posB
        )
      ) {
        return 1;
      }


      return (
        String(
          a.team_name ||
          ""
        )
          .localeCompare(
            String(
              b.team_name ||
              ""
            )
          )
      );
    }
  );


  return {
    race_id:
      rid,

    version:
      VERSION,

    session_live:
      stints.session_live,

    count:
      rows.length,

    rows
  };
}


// ============================================================
// PIT DATASET
// ============================================================

function normalizePitRow(
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

    pit_number:
      number(
        row.pit_number
      ),

    pit_lap:
      number(
        row.pit_lap
      ),

    pit_hour:
      row.pit_hour ||
      null,

    pit_time:
      row.pit_time ||
      null,

    on_track:
      row.on_track ||
      null,

    driver_name:
      row.driver_name ||
      null,

    total_time:
      row.total_time ||
      null,

    updated_at:
      row.updated_at ||
      null
  };
}


async function pitsPayload(
  env,
  rid,
  snapshot = null
) {
  const liveSnapshot =
    snapshot ||
    await collectorSnapshot(
      env
    )
      .catch(
        () => ({
          fieldApexIds: [],
          positions: {}
        })
      );


  const fieldIds =
    currentFieldIds(
      liveSnapshot
    );


  const [
    pits,
    teamMap
  ] =
    await Promise.all([
      loadPits(
        env,
        rid
      )
        .catch(
          () => []
        ),

      stableTeamNameMap(
        env,
        rid
      )
    ]);


  const current =
    filterCurrentField(
      pits,
      fieldIds
    );


  const rows =
    current
      .filter(
        row =>
          validApexId(
            row.apex_id
          )
      )
      .map(
        row =>
          normalizePitRow(
            row,
            teamMap
          )
      );


  const positionMap =
    new Map();


  for (
    const [
      id,
      position
    ]
    of Object.entries(
      liveSnapshot
        ?.positions ||
      {}
    )
  ) {
    if (
      validApexId(id)
    ) {
      positionMap.set(
        String(id),
        Number(position)
      );
    }
  }


  rows.sort(
    (a, b) => {
      const posA =
        positionMap.get(
          String(
            a.apex_id
          )
        );

      const posB =
        positionMap.get(
          String(
            b.apex_id
          )
        );


      if (
        Number.isFinite(
          posA
        ) &&
        Number.isFinite(
          posB
        ) &&
        posA !== posB
      ) {
        return (
          posA -
          posB
        );
      }


      if (
        Number.isFinite(
          posA
        )
      ) {
        return -1;
      }


      if (
        Number.isFinite(
          posB
        )
      ) {
        return 1;
      }


      const teamCompare =
        String(
          a.team_name ||
          ""
        )
          .localeCompare(
            String(
              b.team_name ||
              ""
            )
          );


      if (
        teamCompare !== 0
      ) {
        return teamCompare;
      }


      return (
        Number(
          a.pit_number
        ) -
        Number(
          b.pit_number
        )
      );
    }
  );


  return {
    race_id:
      rid,

    version:
      VERSION,

    count:
      rows.length,

    rows
  };
}


// ============================================================
// LIVE OVERVIEW HELPERS
// ============================================================

function newestEntriesByApex(
  rows
) {
  const result =
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
      !validApexId(id)
    ) {
      continue;
    }


    const existing =
      result.get(id);


    if (!existing) {
      result.set(
        id,
        row
      );

      continue;
    }


    const rowTime =
      Date.parse(
        row.updated_at ||
        row.received_at ||
        0
      );


    const existingTime =
      Date.parse(
        existing.updated_at ||
        existing.received_at ||
        0
      );


    if (
      Number.isFinite(
        rowTime
      ) &&
      (
        !Number.isFinite(
          existingTime
        ) ||
        rowTime >
        existingTime
      )
    ) {
      result.set(
        id,
        row
      );
    }
  }


  return result;
}


function bestLapFromEntries(
  entries
) {
  let best = null;


  for (
    const row
    of entries
  ) {
    const value =
      number(
        row.best_lap_time ??
        row.best_lap
      );


    if (
      !Number.isFinite(value) ||
      value <= 0
    ) {
      continue;
    }


    if (
      best === null ||
      value < best
    ) {
      best = value;
    }
  }


  return best;
}


function raceLapFromEntries(
  entries
) {
  let maximum = 0;


  for (
    const row
    of entries
  ) {
    const value =
      number(
        row.lap_count ??
        row.laps ??
        row.lap
      );


    if (
      Number.isFinite(value) &&
      value > maximum
    ) {
      maximum =
        value;
    }
  }


  return maximum;
}

// ============================================================
// LIVE OVERVIEW
// ============================================================

async function livePayload(
  env,
  rid
) {
  const [
    entriesRaw,
    liveStintsRaw,
    pitsRaw,
    snapshot,
    teamMap
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
      ),

      collectorSnapshot(
        env
      )
        .catch(
          () => null
        ),

      stableTeamNameMap(
        env,
        rid
      )
    ]);


  const fieldIds =
    currentFieldIds(
      snapshot
    );


  if (
    fieldIds.size === 0
  ) {
    return {
      race_id:
        Number(rid),

      session_name:
        "Apex Timing",

      active:
        false,

      data_available:
        false,

      is_live:
        false,

      session_status:
        "WAITING FOR APEX GRID",

      team_count:
        0,

      current:
        []
    };
  }


  const entries =
    filterCurrentField(
      entriesRaw,
      fieldIds
    );


  const liveStints =
    filterCurrentField(
      liveStintsRaw,
      fieldIds
    );


  const pits =
    filterCurrentField(
      pitsRaw,
      fieldIds
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


    const number =
      Number(
        pit.pit_number
      );


    const lap =
      Number(
        pit.pit_lap
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


    if (
      Number.isFinite(lap)
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


  const current =
    entries.map(
      entry => {
        const id =
          String(
            entry.apex_id
          );


        const live =
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


        const start =
          Number(
            live.start_lap_count
          );


        const realStart =
          Number.isFinite(start)
            ? start
            : (
                lastPitLap.get(
                  id
                ) ||
                0
              );


        const position =
          Number(
            snapshot
              ?.positions?.[
                id
              ]
          );


        return {
          race_id:
            Number(rid),

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
              live.team_name
            ),

          driver_name:
            live.driver_name ||
            entry.current_driver ||
            null,

          current_driver:
            live.driver_name ||
            entry.current_driver ||
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
            realStart,

          stint_laps:
            Number(
              live.total_laps
            ) ||
            Math.max(
              0,
              raceLap -
              realStart
            ),

          total_stint_laps:
            Number(
              live.total_laps
            ) ||
            Math.max(
              0,
              raceLap -
              realStart
            ),

          valid_laps:
            Number(
              live.valid_laps
            ) ||
            0,

          live_last_lap:
            number(
              entry.last_lap
            ),

          avg_lap_time:
            number(
              live.avg_lap_time ??
              live.avg_lap
            ),

          best_lap_time:
            number(
              live.best_lap_time ??
              live.best_lap ??
              entry.best_lap
            ),

          best_lap_number:
            number(
              live.best_lap_number
            ),

          worst_lap_time:
            number(
              live.worst_lap_time ??
              live.worst_lap
            ),

          worst_lap_number:
            number(
              live.worst_lap_number
            ),

          consistency:
            number(
              live.consistency
            ),

          updated_at:
            entry.updated_at ||
            live.updated_at ||
            null
        };
      }
    );


  current.sort(
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


  const lastPacket =
    Date.parse(
      snapshot
        ?.last_packet_at ||
      ""
    );


  const isLive =
    Number.isFinite(
      lastPacket
    ) &&
    (
      Date.now() -
      lastPacket
    ) <
      180000;


  return {
    race_id:
      Number(rid),

    session_name:
      "Apex Timing",

    active:
      current.length > 0,

    data_available:
      current.length > 0,

    is_live:
      isLive,

    session_status:
      isLive
        ? "LIVE"
        : "FINISHED",

    collector_connected:
      snapshot?.connected ===
      true,

    team_count:
      current.length,

    current
  };
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


async function createLapRecordsCsvResponse(
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
    return json(
      {
        error:
          "No current Apex field."
      },
      404
    );
  }


  const ids =
    [
      ...fieldIds
    ]
      .filter(validApexId)
      .sort(
        (a, b) =>
          Number(a) -
          Number(b)
      );


  if (!ids.length) {
    return json(
      {
        error:
          "No valid Apex IDs for CSV export."
      },
      404
    );
  }


  const teamMap =
    await stableTeamNameMap(
      env,
      rid
    );


  const idFilter =
    `in.(${ids.join(",")})`;


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
          PAGE_SIZE - 1
      }
    );


  if (
    !Array.isArray(firstPage) ||
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
        const write =
          value =>
            controller.enqueue(
              encoder.encode(value)
            );


        let activeApexId =
          null;


        const writeTeamHeader =
          apexId => {
            const team =
              resolveTeam(
                apexId,
                teamMap
              ) ||
              `APEX ${apexId}`;


            write("\r\n");

            write(
              `${csvEscape(apexId)} - ${csvEscape(team)}\r\n`
            );

            write(
              "Lap,Time\r\n"
            );
          };


        const processPage =
          page => {
            for (
              const row
              of page
            ) {
              const apexId =
                String(
                  row.apex_id ??
                  ""
                ).trim();


              const lap =
                Number(
                  row.lap_number
                );


              const lapTime =
                Number(
                  row.lap_time
                );


              if (
                !validApexId(apexId) ||
                !fieldIds.has(apexId) ||
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
               * RAW report:
               * analytical exclusions are NOT applied here.
               */
              write(
                `${Math.trunc(lap)},${lapTime.toFixed(3)}\r\n`
              );
            }
          };


        try {
          write("\uFEFF");

          write(
            "Apex Timing - drive your success https://www.apex-timing.com/\r\n"
          );

          write("\r\n");

          write(
            "Karting Events Bulgaria - Karting Track\r\n"
          );

          write("\r\n");

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


          write("\r\n");

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


  return new Response(
    stream,
    {
      status: 200,

      headers: {
        "content-type":
          "text/csv; charset=utf-8",

        "content-disposition":
          `attachment; filename="${safeFilename(
            `Race ${rid} - Lap time records.csv`
          )}"`,

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

<button onclick="window.print()">
Print / Save PDF
</button>

<h1>
Race ${escapeHtml(rid)} - Pit stops
</h1>

${content}

</body>

</html>
`;
}


// ============================================================
// REPORT PAYLOAD
// ============================================================

async function pitReportResponse(
  env,
  rid,
  snapshot = null
) {
  const liveSnapshot =
    snapshot ||
    await collectorSnapshot(
      env
    )
      .catch(
        () => ({
          connected: false,
          last_packet_at: null,
          fieldApexIds: [],
          positions: {}
        })
      );


  const stintData =
    await stintsPayload(
      env,
      rid,
      liveSnapshot
    );


  const html =
    buildPitReportHtml(
      rid,
      stintData.rows
    );


  return new Response(
    html,
    {
      status: 200,

      headers: {
        "content-type":
          "text/html; charset=utf-8",

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
// MANUAL LAP EXCLUSION
// ============================================================

async function addManualExclusion(
  env,
  rid,
  payload
) {
  const apexId =
    String(
      payload?.apex_id ??
      ""
    )
      .trim();


  const lapNumber =
    Number(
      payload?.lap_number
    );


  const reason =
    stripHtml(
      payload?.reason ||
      "Manual exclusion"
    );


  if (
    !validApexId(
      apexId
    )
  ) {
    return json(
      {
        error:
          "Invalid apex_id"
      },
      400
    );
  }


  if (
    !Number.isFinite(
      lapNumber
    ) ||
    lapNumber <= 0
  ) {
    return json(
      {
        error:
          "Invalid lap_number"
      },
      400
    );
  }


  const row = {
    race_id:
      rid,

    apex_id:
      apexId,

    lap_number:
      Math.trunc(
        lapNumber
      ),

    reason,

    created_at:
      new Date()
        .toISOString()
  };


  await sbUpsert(
    env,
    "manual_lap_exclusions",
    row,
    "race_id,apex_id,lap_number"
  );


  return json({
    ok:
      true,

    row
  });
}


async function removeManualExclusion(
  env,
  rid,
  payload
) {
  const apexId =
    String(
      payload?.apex_id ??
      ""
    )
      .trim();


  const lapNumber =
    Number(
      payload?.lap_number
    );


  if (
    !validApexId(
      apexId
    )
  ) {
    return json(
      {
        error:
          "Invalid apex_id"
      },
      400
    );
  }


  if (
    !Number.isFinite(
      lapNumber
    ) ||
    lapNumber <= 0
  ) {
    return json(
      {
        error:
          "Invalid lap_number"
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
          lapNumber
        )}`
    }
  );


  return json({
    ok:
      true,

    race_id:
      rid,

    apex_id:
      apexId,

    lap_number:
      Math.trunc(
        lapNumber
      )
  });
}


// ============================================================
// HTTP HELPERS
// ============================================================

async function readJsonBody(
  request
) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}


function corsHeaders() {
  return {
    "access-control-allow-origin":
      "*",

    "access-control-allow-methods":
      "GET,POST,DELETE,OPTIONS",

    "access-control-allow-headers":
      "Content-Type"
  };
}


function withCors(response) {
  const headers =
    new Headers(
      response.headers
    );


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      corsHeaders()
    )
  ) {
    headers.set(
      key,
      value
    );
  }


  return new Response(
    response.body,
    {
      status:
        response.status,

      statusText:
        response.statusText,

      headers
    }
  );
}


// ============================================================
// API ROUTER
// ============================================================

async function handleApi(
  request,
  env,
  url
) {
  const pathname =
    url.pathname;


  const rid =
    raceId(
      env,
      url
    );


  if (
    request.method ===
    "OPTIONS"
  ) {
    return new Response(
      null,
      {
        status:
          204,

        headers:
          corsHeaders()
      }
    );
  }


  if (
    pathname ===
    "/api/version"
  ) {
    return json({
      version:
        VERSION,

      race_id:
        rid
    });
  }


  if (
    pathname ===
    "/api/collector/start"
  ) {
    const result =
      await startCollector(
        env
      );


    return json(
      result
    );
  }


  if (
    pathname ===
    "/api/collector/snapshot"
  ) {
    const result =
      await collectorSnapshot(
        env
      );


    return json(
      result
    );
  }


  if (
    pathname ===
    "/api/live"
  ) {
    const result =
      await livePayload(
        env,
        rid
      );


    return json(
      result
    );
  }


  if (
    pathname ===
    "/api/stints"
  ) {
    const snapshot =
      await collectorSnapshot(
        env
      )
        .catch(
          () => null
        );


    const result =
      await stintsPayload(
        env,
        rid,
        snapshot
      );


    return json(
      result
    );
  }


  if (
    pathname ===
    "/api/drivers"
  ) {
    const snapshot =
      await collectorSnapshot(
        env
      )
        .catch(
          () => null
        );


    const stintData =
      await stintsPayload(
        env,
        rid,
        snapshot
      );


    const result =
      await driversPayload(
        env,
        rid,
        snapshot,
        stintData
      );


    return json(
      result
    );
  }


  if (
    pathname ===
    "/api/teams"
  ) {
    const snapshot =
      await collectorSnapshot(
        env
      )
        .catch(
          () => null
        );


    const stintData =
      await stintsPayload(
        env,
        rid,
        snapshot
      );


    const result =
      await teamsPayload(
        env,
        rid,
        snapshot,
        stintData
      );


    return json(
      result
    );
  }


  if (
    pathname ===
    "/api/pits"
  ) {
    const snapshot =
      await collectorSnapshot(
        env
      )
        .catch(
          () => null
        );


    const result =
      await pitsPayload(
        env,
        rid,
        snapshot
      );


    return json(
      result
    );
  }


  if (
    pathname ===
    "/api/events"
  ) {
    const snapshot =
      await collectorSnapshot(
        env
      )
        .catch(
          () => null
        );


    const result =
      await eventsPayload(
        env,
        rid,
        snapshot
      );


    return json({
      race_id:
        rid,

      version:
        VERSION,

      count:
        result.length,

      rows:
        result
    });
  }


  if (
    pathname ===
    "/api/races"
  ) {
    const result =
      await racesPayload(
        env
      );


    return json({
      version:
        VERSION,

      count:
        result.length,

      rows:
        result
    });
  }


  if (
    pathname ===
      "/api/reports/lap-time-records.csv" ||
    pathname ===
      "/api/reports/lap-records.csv"
  ) {
    const snapshot =
      await collectorSnapshot(
        env
      )
        .catch(
          () => null
        );


    return createLapRecordsCsvResponse(
      env,
      rid,
      snapshot
    );
  }


  if (
    pathname ===
      "/api/reports/pit-stops" ||
    pathname ===
      "/api/reports/pit-stops.html"
  ) {
    const snapshot =
      await collectorSnapshot(
        env
      )
        .catch(
          () => null
        );


    return pitReportResponse(
      env,
      rid,
      snapshot
    );
  }


  if (
    pathname ===
      "/api/manual-exclusions" &&
    request.method ===
      "POST"
  ) {
    const payload =
      await readJsonBody(
        request
      );


    return addManualExclusion(
      env,
      rid,
      payload
    );
  }


  if (
    pathname ===
      "/api/manual-exclusions" &&
    request.method ===
      "DELETE"
  ) {
    const payload =
      await readJsonBody(
        request
      );


    return removeManualExclusion(
      env,
      rid,
      payload
    );
  }


  return json(
    {
      error:
        "API endpoint not found",

      path:
        pathname
    },
    404
  );
}


// ============================================================
// APEX COLLECTOR DURABLE OBJECT
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


    this.socket =
      null;


    this.connected =
      false;


    this.connecting =
      false;


    this.started =
      false;


    this.lastPacketAt =
      null;


    this.lastError =
      null;


    this.reconnectTimer =
      null;


    this.columnTypes =
      new Map();


    this.entries =
      new Map();


    this.positions =
      new Map();


    this.fieldApexIds =
      new Set();


    this.pendingDetail =
      new Set();


    this.lastDetailFetch =
      new Map();


    this.persistQueue =
      Promise.resolve();


    this.rid =
      Number(
        env.DEFAULT_RACE_ID ||
        1
      );


    this.state
      .blockConcurrencyWhile(
        async () => {
          const saved =
            await this.state
              .storage
              .get(
                [
                  "lastPacketAt",
                  "fieldApexIds",
                  "positions"
                ]
              );


          this.lastPacketAt =
            saved.get(
              "lastPacketAt"
            ) ||
            null;


          const savedField =
            saved.get(
              "fieldApexIds"
            );


          if (
            Array.isArray(
              savedField
            )
          ) {
            this.fieldApexIds =
              new Set(
                savedField
                  .map(
                    value =>
                      String(
                        value
                      )
                  )
                  .filter(
                    validApexId
                  )
              );
          }


          const savedPositions =
            saved.get(
              "positions"
            );


          if (
            savedPositions &&
            typeof savedPositions ===
              "object"
          ) {
            this.positions =
              new Map(
                Object.entries(
                  savedPositions
                )
                  .filter(
                    (
                      [
                        id
                      ]
                    ) =>
                      validApexId(
                        id
                      )
                  )
                  .map(
                    (
                      [
                        id,
                        position
                      ]
                    ) => [
                      String(id),
                      Number(position)
                    ]
                  )
              );
          }
        }
      );
  }


  async fetch(request) {
    const url =
      new URL(
        request.url
      );


    if (
      url.pathname ===
      "/start"
    ) {
      await this.ensureStarted();


      return json({
        ok:
          true,

        started:
          this.started,

        connected:
          this.connected
      });
    }


    if (
      url.pathname ===
      "/snapshot"
    ) {
      await this.ensureStarted();


      return json(
        this.snapshot()
      );
    }


    if (
      url.pathname ===
      "/health"
    ) {
      return json(
        this.snapshot()
      );
    }


    return json(
      {
        error:
          "Collector endpoint not found"
      },
      404
    );
  }


  snapshot() {
    return {
      version:
        VERSION,

      race_id:
        this.rid,

      started:
        this.started,

      connecting:
        this.connecting,

      connected:
        this.connected,

      last_packet_at:
        this.lastPacketAt,

      last_error:
        this.lastError,

      fieldApexIds:
        [
          ...this.fieldApexIds
        ]
          .filter(
            validApexId
          ),

      positions:
        Object.fromEntries(
          [
            ...this.positions
          ]
            .filter(
              (
                [
                  id
                ]
              ) =>
                validApexId(
                  id
                )
            )
        ),

      entries:
        Object.fromEntries(
          [
            ...this.entries
          ]
            .filter(
              (
                [
                  id
                ]
              ) =>
                validApexId(
                  id
                )
            )
        )
    };
  }


  async ensureStarted() {
    if (
      this.started &&
      (
        this.connected ||
        this.connecting
      )
    ) {
      return;
    }


    this.started =
      true;


    await this.connect();
  }


  async connect() {
    if (
      this.connecting ||
      this.connected
    ) {
      return;
    }


    this.connecting =
      true;


    this.lastError =
      null;


    try {
      const websocketUrl =
        this.env
          .APEX_WS_URL ||
        "wss://live-data.apex-timing.com:8913/";


      const response =
        await fetch(
          websocketUrl,
          {
            headers: {
              Upgrade:
                "websocket"
            }
          }
        );


      const socket =
        response.webSocket;


      if (!socket) {
        throw new Error(
          "Apex WebSocket upgrade failed"
        );
      }


      socket.accept();


      this.socket =
        socket;


      this.connected =
        true;


      this.connecting =
        false;


      socket.addEventListener(
        "message",
        event => {
          this.onMessage(
            event.data
          )
            .catch(
              error => {
                console.error(
                  "APEX MESSAGE ERROR",
                  error
                );


                this.lastError =
                  String(
                    error?.stack ||
                    error
                  );
              }
            );
        }
      );


      socket.addEventListener(
        "close",
        () => {
          this.onSocketClosed(
            "closed"
          );
        }
      );


      socket.addEventListener(
        "error",
        () => {
          this.onSocketClosed(
            "error"
          );
        }
      );

    } catch (error) {
      this.connected =
        false;


      this.connecting =
        false;


      this.lastError =
        String(
          error?.stack ||
          error
        );


      this.scheduleReconnect();


      throw error;
    }
  }


  onSocketClosed(reason) {
    this.connected =
      false;


    this.connecting =
      false;


    this.socket =
      null;


    this.lastError =
      reason;


    this.scheduleReconnect();
  }


  scheduleReconnect() {
    if (
      this.reconnectTimer
    ) {
      return;
    }


    this.reconnectTimer =
      setTimeout(
        () => {
          this.reconnectTimer =
            null;


          this.connect()
            .catch(
              error => {
                console.error(
                  "APEX RECONNECT ERROR",
                  error
                );
              }
            );
        },
        5000
      );
  }


  async onMessage(data) {
    const text =
      typeof data ===
      "string"
        ? data
        : new TextDecoder()
            .decode(data);


    if (!text) {
      return;
    }


    this.lastPacketAt =
      new Date()
        .toISOString();


    await this.state
      .storage
      .put(
        "lastPacketAt",
        this.lastPacketAt
      );


    if (
      text.includes(
        "<tr"
      ) &&
      text.includes(
        "data-id="
      )
    ) {
      const grid =
        parseGridData(
          text
        );


      if (
        grid.rows.size >
        0
      ) {
        this.columnTypes =
          grid.columnTypes;


        this.fieldApexIds =
          new Set(
            [
              ...grid.rows.keys()
            ]
              .filter(
                validApexId
              )
          );


        this.positions =
          new Map(
            [
              ...grid.positions
            ]
              .filter(
                (
                  [
                    id
                  ]
                ) =>
                  validApexId(
                    id
                  )
              )
          );


        for (
          const [
            id,
            fields
          ]
          of grid.rows
        ) {
          if (
            !validApexId(id)
          ) {
            continue;
          }


          const current =
            this.entries.get(
              id
            ) ||
            {};


          const next = {
            ...current
          };


          if (
            fields.drteam
          ) {
            const driver =
              cleanDriver(
                fields.drteam
              );


            if (driver) {
              next.current_driver =
                driver;
            }
          }


          if (
            fields.dr
          ) {
            const team =
              stripHtml(
                fields.dr
              );


            if (
              !badTeamName(
                team,
                next.current_driver
              )
            ) {
              next.team_name =
                team;
            }
          }


          if (
            fields.laps
          ) {
            const value =
              parseNumber(
                fields.laps
              );


            if (
              Number.isFinite(
                value
              )
            ) {
              next.lap_count =
                value;
            }
          }


          if (
            fields.last
          ) {
            const value =
              parseLapTime(
                fields.last
              );


            if (
              Number.isFinite(
                value
              )
            ) {
              next.last_lap =
                value;
            }
          }


          if (
            fields.best
          ) {
            const value =
              parseLapTime(
                fields.best
              );


            if (
              Number.isFinite(
                value
              )
            ) {
              next.best_lap =
                value;
            }
          }


          this.entries.set(
            id,
            next
          );
        }


        await this.state
          .storage
          .put(
            {
              fieldApexIds:
                [
                  ...this
                    .fieldApexIds
                ],

              positions:
                Object.fromEntries(
                  this.positions
                )
            }
          );


        this.queuePersistEntries();


        for (
          const id
          of this.fieldApexIds
        ) {
          this.scheduleDetailFetch(
            id
          );
        }


        return;
      }
    }


    const lines =
      text.split(
        /\r?\n/
      );


    let changed =
      false;


    for (
      const line
      of lines
    ) {
      const parsed =
        parseProtocolLine(
          line
        );


      if (!parsed.id) {
        continue;
      }


      const rowId =
        parseRowId(
          parsed.id
        );


      if (!rowId) {
        continue;
      }


      const apexId =
        String(
          rowId.apexId
        );


      if (
        !validApexId(
          apexId
        )
      ) {
        continue;
      }


      if (
        !this.fieldApexIds
          .has(
            apexId
          )
      ) {
        continue;
      }


      const current =
        this.entries.get(
          apexId
        ) ||
        {};


      const next = {
        ...current
      };


      const columnType =
        rowId.column
          ? this.columnTypes.get(
              `c${rowId.column}`
            )
          : null;


      const cls =
        parsed.cls;


      const value =
        parsed.value;


      /*
       * IMPORTANT:
       * drteam must be processed before generic dr handling.
       * A drteam update is a DRIVER update, not a team rename.
       */
      if (
        cls ===
        "drteam"
      ) {
        const driver =
          cleanDriver(
            value
          );


        if (driver) {
          next.current_driver =
            driver;
        }


        changed =
          true;

      } else if (
        cls ===
        "dr"
      ) {
        const team =
          stripHtml(
            value
          );


        if (
          !badTeamName(
            team,
            next.current_driver
          )
        ) {
          next.team_name =
            team;
        }


        changed =
          true;

      } else if (
        columnType ===
        "laps" ||
        cls ===
        "laps"
      ) {
        const lap =
          parseNumber(
            value
          );


        if (
          Number.isFinite(
            lap
          )
        ) {
          const previousLap =
            Number(
              current.lap_count
            ) ||
            0;


          next.lap_count =
            lap;


          if (
            lap >
            previousLap
          ) {
            this.scheduleDetailFetch(
              apexId
            );
          }
        }


        changed =
          true;

      } else if (
        columnType ===
        "last" ||
        cls ===
        "last"
      ) {
        const lapTime =
          parseLapTime(
            value
          );


        if (
          Number.isFinite(
            lapTime
          )
        ) {
          next.last_lap =
            lapTime;
        }


        changed =
          true;

      } else if (
        columnType ===
        "best" ||
        cls ===
        "best"
      ) {
        const lapTime =
          parseLapTime(
            value
          );


        if (
          Number.isFinite(
            lapTime
          )
        ) {
          next.best_lap =
            lapTime;
        }


        changed =
          true;

      } else if (
        cls ===
        "rk"
      ) {
        const rank =
          parseNumber(
            value
          );


        if (
          Number.isFinite(
            rank
          )
        ) {
          this.positions.set(
            apexId,
            rank
          );


          await this.state
            .storage
            .put(
              "positions",
              Object.fromEntries(
                this.positions
              )
            );
        }
      }


      if (changed) {
        this.entries.set(
          apexId,
          next
        );
      }
    }


    if (changed) {
      this.queuePersistEntries();
    }
  }

  queuePersistEntries() {
    this.persistQueue =
      this.persistQueue
        .then(
          () =>
            this.persistEntries()
        )
        .catch(
          error => {
            console.error(
              "PERSIST ENTRIES ERROR",
              error
            );


            this.lastError =
              String(
                error?.stack ||
                error
              );
          }
        );
  }


  async persistEntries() {
    const now =
      new Date()
        .toISOString();


    const rows = [];


    for (
      const [
        apexId,
        entry
      ]
      of this.entries
    ) {
      if (
        !validApexId(
          apexId
        )
      ) {
        continue;
      }


      if (
        !this.fieldApexIds
          .has(
            String(
              apexId
            )
          )
      ) {
        continue;
      }


      const teamName =
        stripHtml(
          entry.team_name
        );


      const driverName =
        cleanDriver(
          entry.current_driver
        );


      const row = {
        race_id:
          this.rid,

        apex_id:
          String(
            apexId
          ),

        updated_at:
          now
      };


      if (
        teamName &&
        !badTeamName(
          teamName,
          driverName
        )
      ) {
        row.team_name =
          teamName;
      }


      if (driverName) {
        row.current_driver =
          driverName;
      }


      const lapCount =
        Number(
          entry.lap_count
        );


      if (
        Number.isFinite(
          lapCount
        )
      ) {
        row.lap_count =
          Math.trunc(
            lapCount
          );
      }


      const lastLap =
        Number(
          entry.last_lap
        );


      if (
        Number.isFinite(
          lastLap
        ) &&
        lastLap > 0
      ) {
        row.last_lap =
          lastLap;
      }


      const bestLap =
        Number(
          entry.best_lap
        );


      if (
        Number.isFinite(
          bestLap
        ) &&
        bestLap > 0
      ) {
        row.best_lap =
          bestLap;
      }


      rows.push(row);
    }


    if (
      rows.length === 0
    ) {
      return;
    }


    await sbUpsert(
      this.env,
      "apex_entries",
      rows,
      "race_id,apex_id"
    );
  }


  scheduleDetailFetch(
    apexId
  ) {
    const id =
      String(
        apexId
      );


    if (
      !validApexId(id)
    ) {
      return;
    }


    if (
      !this.fieldApexIds
        .has(id)
    ) {
      return;
    }


    if (
      this.pendingDetail
        .has(id)
    ) {
      return;
    }


    const now =
      Date.now();


    const last =
      this.lastDetailFetch
        .get(id) ||
      0;


    /*
     * Prevent duplicate detail requests when Apex sends several
     * updates for the same completed lap.
     */
    if (
      now - last <
      1200
    ) {
      return;
    }


    this.pendingDetail.add(
      id
    );


    this.lastDetailFetch.set(
      id,
      now
    );


    this.fetchAndPersistDetail(
      id
    )
      .catch(
        error => {
          console.error(
            `DETAIL FETCH ERROR ${id}`,
            error
          );


          this.lastError =
            String(
              error?.stack ||
              error
            );
        }
      )
      .finally(
        () => {
          this.pendingDetail.delete(
            id
          );
        }
      );
  }


  async fetchAndPersistDetail(
    apexId
  ) {
    const id =
      String(
        apexId
      );


    if (
      !validApexId(id)
    ) {
      return;
    }


    const entry =
      this.entries.get(id) ||
      {};


    const currentLap =
      Number(
        entry.lap_count
      ) ||
      0;


    /*
     * We request enough history for the current kart instead of
     * relying on a tiny fixed recent-lap window.
     *
     * The request remains per kart, so it does not pull the
     * entire race into Worker memory.
     */
    const lapLimit =
      Math.max(
        50,
        Math.ceil(
          currentLap +
          10
        )
      );


    const requestText =
      `D#-${lapLimit}` +
      `#D${id}.L#-${lapLimit}` +
      `#D${id}.P#-999` +
      `#D${id}.B#1` +
      `#D${id}.INF`;


    const detailUrl =
      this.env
        .APEX_DETAIL_URL ||
      "https://live-data.apex-timing.com:8910/";


    const response =
      await fetch(
        detailUrl,
        {
          method:
            "POST",

          headers: {
            "content-type":
              "text/plain;charset=UTF-8",

            accept:
              "text/plain,*/*"
          },

          body:
            requestText
        }
      );


    if (!response.ok) {
      throw new Error(
        `Apex detail ${id}: ` +
        `${response.status}`
      );
    }


    const raw =
      await response.text();


    if (!raw) {
      return;
    }


    const teamName =
      stripHtml(
        entry.team_name
      ) ||
      null;


    const [
      lapRows,
      pitRows
    ] = [
      parseLapRows(
        raw,
        this.rid
      ),

      parsePitRows(
        raw,
        teamName,
        this.rid
      )
    ];


    const filteredLapRows =
      lapRows.filter(
        row =>
          String(
            row.apex_id
          ) ===
          id
      );


    const filteredPitRows =
      pitRows.filter(
        row =>
          String(
            row.apex_id
          ) ===
          id
      );


    /*
     * Store every real Apex lap.
     *
     * No lap-time threshold is applied here. Long pit laps,
     * safety-car laps and disruption laps remain in the raw
     * source and therefore remain available for reports and
     * later analysis.
     */
    if (
      filteredLapRows.length >
      0
    ) {
      await sbUpsert(
        this.env,
        "apex_lap_events",
        filteredLapRows,
        "race_id,apex_id,lap_number"
      );
    }


    /*
     * Apex pit history is authoritative for stint boundaries.
     */
    if (
      filteredPitRows.length >
      0
    ) {
      await sbUpsert(
        this.env,
        "apex_pit_stints",
        filteredPitRows,
        "race_id,apex_id,pit_number"
      );
    }


    await this.rebuildLiveStintForApex(
      id,
      filteredLapRows,
      filteredPitRows
    );
  }


  async rebuildLiveStintForApex(
    apexId,
    detailLapRows = [],
    detailPitRows = []
  ) {
    const id =
      String(
        apexId
      );


    const entry =
      this.entries.get(id) ||
      {};


    const currentLap =
      Number(
        entry.lap_count
      );


    if (
      !Number.isFinite(
        currentLap
      ) ||
      currentLap <= 0
    ) {
      return;
    }


    let pits =
      detailPitRows;


    if (
      !Array.isArray(pits) ||
      pits.length === 0
    ) {
      pits =
        await loadPits(
          this.env,
          this.rid,
          id
        )
          .catch(
            () => []
          );
    }


    const boundaries =
      uniquePitBoundaries(
        pits
      );


    const lastBoundary =
      boundaries.length > 0
        ? Number(
            boundaries[
              boundaries.length -
              1
            ].pit_lap
          )
        : 0;


    /*
     * If the latest Apex pit boundary is already equal to or
     * beyond the current lap, there is no open live stint.
     *
     * Delete an old live row so it cannot later appear as a
     * false "639 -> LIVE" row.
     */
    if (
      Number.isFinite(
        lastBoundary
      ) &&
      lastBoundary >=
        currentLap
    ) {
      await sbDelete(
        this.env,
        "live_stint_stats",
        {
          race_id:
            `eq.${this.rid}`,

          apex_id:
            `eq.${id}`
        }
      )
        .catch(
          () => {}
        );


      return;
    }


    let lapEvents =
      normalizeLapEvents(
        detailLapRows
      );


    /*
     * The detail response can be shorter than the complete open
     * stint after a reconnect. In that case use the persisted
     * raw lap source for this kart.
     */
    const firstRequiredLap =
      lastBoundary +
      1;


    const hasStart =
      lapEvents.some(
        row =>
          Number(
            row.lap_number
          ) <=
          firstRequiredLap
      );


    const hasCurrent =
      lapEvents.some(
        row =>
          Number(
            row.lap_number
          ) ===
          Math.trunc(
            currentLap
          )
      );


    if (
      !hasStart ||
      !hasCurrent
    ) {
      lapEvents =
        await loadLapEventsForApex(
          this.env,
          this.rid,
          id
        )
          .then(
            normalizeLapEvents
          )
          .catch(
            () =>
              lapEvents
          );
    }


    const exclusions =
      await loadExclusionsForApex(
        this.env,
        this.rid,
        id
      )
        .catch(
          () => []
        );


    const analytics =
      calculateStintAnalytics({
        lapEvents,

        manualExclusions:
          exclusions,

        startLapCount:
          lastBoundary,

        currentLapCount:
          currentLap,

        isLive:
          true
      });


    const teamName =
      stripHtml(
        entry.team_name
      ) ||
      (
        boundaries.length > 0
          ? stripHtml(
              boundaries[
                boundaries.length -
                1
              ].team_name
            )
          : null
      ) ||
      null;


    let driverName =
      cleanDriver(
        entry.current_driver
      ) ||
      null;


    /*
     * If the live grid has not yet sent the current driver after
     * reconnect, keep the latest available driver rather than
     * inventing one.
     */
    if (
      !driverName &&
      boundaries.length > 0
    ) {
      driverName =
        cleanDriver(
          boundaries[
            boundaries.length -
            1
          ].driver_name
        ) ||
        null;
    }


    const row = {
      race_id:
        this.rid,

      apex_id:
        id,

      team_name:
        teamName,

      driver_name:
        driverName,

      stint_number:
        boundaries.length +
        1,

      start_lap_count:
        lastBoundary,

      current_lap_count:
        Math.trunc(
          currentLap
        ),

      total_laps:
        analytics.total_laps,

      valid_laps:
        analytics.valid_laps,

      avg_lap_time:
        analytics.avg_lap_time,

      best_lap_time:
        analytics.best_lap_time,

      best_lap_number:
        analytics.best_lap_number,

      worst_lap_time:
        analytics.worst_lap_time,

      worst_lap_number:
        analytics.worst_lap_number,

      consistency:
        analytics.consistency,

      updated_at:
        new Date()
          .toISOString()
    };


    await sbUpsert(
      this.env,
      "live_stint_stats",
      row,
      "race_id,apex_id"
    )
      .catch(
        error => {
          /*
           * Some older live_stint_stats schemas are views or
           * expose fewer writable columns. The raw Apex data has
           * already been persisted above, so a live-view write
           * failure must not destroy collection.
           */
          console.error(
            "LIVE STINT UPSERT ERROR",
            error
          );
        }
      );
  }
}


// ============================================================
// ASSET / APPLICATION ROUTER
// ============================================================

async function handleRequest(
  request,
  env
) {
  const url =
    new URL(
      request.url
    );


  if (
    url.pathname.startsWith(
      "/api/"
    )
  ) {
    try {
      const response =
        await handleApi(
          request,
          env,
          url
        );


      return withCors(
        response
      );

    } catch (error) {
      console.error(
        "API ERROR",
        error
      );


      return withCors(
        json(
          {
            error:
              String(
                error?.message ||
                error
              ),

            version:
              VERSION
          },
          500
        )
      );
    }
  }


  if (
    env.ASSETS
  ) {
    return env
      .ASSETS
      .fetch(
        request
      );
  }


  return new Response(
    "Race Engineer",
    {
      status:
        200,

      headers: {
        "content-type":
          "text/plain; charset=utf-8"
      }
    }
  );
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
    /*
     * Start / reconnect the collector on normal traffic without
     * making the page wait for collection to finish.
     */
    if (
      env.APEX_COLLECTOR
    ) {
      ctx.waitUntil(
        startCollector(
          env
        )
          .catch(
            error => {
              console.error(
                "COLLECTOR START ERROR",
                error
              );
            }
          )
      );
    }


    return handleRequest(
      request,
      env
    );
  },


  async scheduled(
    controller,
    env,
    ctx
  ) {
    /*
     * Cron keeps the Durable Object alive/reconnected even when
     * nobody currently has the dashboard open.
     */
    ctx.waitUntil(
      startCollector(
        env
      )
        .catch(
          error => {
            console.error(
              "SCHEDULED COLLECTOR ERROR",
              error
            );
          }
        )
    );
  }
};
