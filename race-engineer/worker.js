const BOOTSTRAP_VERSION = "2026-08-29-current-apex-field-v5";
const PAGE_SIZE = 1000;


// ============================================================
// RESPONSE HELPERS
// ============================================================

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


function textResponse(
  text,
  contentType,
  filename = null
) {
  const headers = {
    "content-type": `${contentType}; charset=utf-8`,
    "cache-control": "no-store"
  };

  if (filename) {
    headers["content-disposition"] =
      `attachment; filename="${filename}"`;
  }

  return new Response(
    text,
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
    url?.searchParams.get("race_id") ||
    env.DEFAULT_RACE_ID ||
    "1";

  const value = Number(raw);

  return (
    Number.isFinite(value) &&
    value > 0
  )
    ? Math.trunc(value)
    : 1;
}


// ============================================================
// SUPABASE
// ============================================================

function sbHeaders(env, extra = {}) {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_KEY
  ) {
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
  params = {},
  range = null
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
      { headers }
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
  params = {},
  pageSize = PAGE_SIZE
) {
  const result = [];
  let from = 0;

  while (true) {
    const page =
      await sbGet(
        env,
        table,
        params,
        {
          from,
          to:
            from +
            pageSize -
            1
        }
      );

    result.push(...page);

    if (
      page.length <
      pageSize
    ) {
      break;
    }

    from += pageSize;
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


const sbInsert =
  (
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


const sbUpsert =
  (
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


const sbDelete =
  (
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


// ============================================================
// GENERAL PARSING
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
      )
        .replace(
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


function formatLapTime(value) {
  const seconds =
    Number(value);

  if (
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return "";
  }

  if (
    seconds >= 60
  ) {
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

  return seconds.toFixed(3);
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


  const headerCell =
    /<td\b([^>]*)>/gi;

  let headerMatch;


  while (
    (
      headerMatch =
        headerCell.exec(source)
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
        rowRegex.exec(source)
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


// ============================================================
// APEX DETAIL
// ============================================================

function msToTime(ms) {
  const value =
    Number(ms);

  if (
    !Number.isFinite(value)
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
      ) / 60
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
      ) / 1000
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
      Number(match[1]),
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
      !Number.isFinite(milliseconds) ||
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
      !Number.isFinite(pitNumber) ||
      !Number.isFinite(pitLap)
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


// ============================================================
// STATISTICS
// ============================================================

function calculateStats(rows) {
  const laps =
    rows
      .filter(
        row =>
          Number.isFinite(
            Number(
              row.lap_time
            )
          ) &&
          Number(
            row.lap_time
          ) > 0
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


  if (!laps.length) {
    return {
      validLaps: 0,
      sum: 0,
      squares: 0,
      avg: null,
      best: null,
      bestLap: null,
      worst: null,
      worstLap: null,
      consistency: null
    };
  }


  let sum = 0;
  let squares = 0;

  let bestRow = null;
  let worstRow = null;


  for (
    const row
    of laps
  ) {
    const value =
      Number(
        row.lap_time
      );

    sum += value;

    squares +=
      value * value;


    if (
      !bestRow ||
      value <
        Number(
          bestRow.lap_time
        )
    ) {
      bestRow =
        row;
    }


    if (
      !worstRow ||
      value >
        Number(
          worstRow.lap_time
        )
    ) {
      worstRow =
        row;
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

    best:
      Number(
        bestRow.lap_time
      ),

    bestLap:
      Number(
        bestRow.lap_number
      ),

    worst:
      Number(
        worstRow.lap_time
      ),

    worstLap:
      Number(
        worstRow.lap_number
      ),

    consistency:
      Math.sqrt(
        Math.max(
          0,
          squares /
            laps.length -
            avg * avg
        )
      )
  };
}


// ============================================================
// TEAM NAMES
// ============================================================

async function stableTeamNameMap(
  env,
  rid
) {
  const [
    pits,
    completed
  ] =
    await Promise.all([
      sbGetAll(
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
      )
        .catch(
          () => []
        ),


      sbGetAll(
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
      )
        .catch(
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


// ============================================================
// DATABASE LOADERS
// ============================================================

async function loadEntries(
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


async function loadPits(
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


async function loadLaps(
  env,
  rid,
  apexId = null
) {
  const params = {
    select:
      "race_id,apex_id,lap_number,lap_time,received_at",

    race_id:
      `eq.${rid}`,

    order:
      "apex_id.asc,lap_number.asc"
  };


  if (apexId) {
    params.apex_id =
      `eq.${apexId}`;
  }


  return sbGetAll(
    env,
    "apex_lap_events",
    params
  );
}


async function loadManualExclusions(
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
      "apex_id.asc,lap_number.asc"
  };


  if (apexId) {
    params.apex_id =
      `eq.${apexId}`;
  }


  try {
    return await sbGetAll(
      env,
      "manual_lap_exclusions",
      params
    );

  } catch {
    return [];
  }
}


// ============================================================
// LAP DEDUPE
// ============================================================

function dedupeLapRows(rows) {
  const map =
    new Map();


  for (
    const row
    of rows
  ) {
    const lap =
      Number(
        row.lap_number
      );

    const time =
      Number(
        row.lap_time
      );


    if (
      !Number.isFinite(lap) ||
      !Number.isFinite(time) ||
      time <= 0
    ) {
      continue;
    }


    map.set(
      lap,
      {
        ...row,

        lap_number:
          lap,

        lap_time:
          time
      }
    );
  }


  return [
    ...map.values()
  ]
    .sort(
      (a, b) =>
        a.lap_number -
        b.lap_number
    );
}


// ============================================================
// STINTS
// ============================================================

function buildStintsForApex({
  rid,
  apexId,
  teamName,
  currentDriver,
  currentLap,
  laps,
  pits,
  manualExclusions
}) {
  const lapRows =
    dedupeLapRows(
      laps
    );


  const manualByLap =
    new Map();


  for (
    const row
    of manualExclusions
  ) {
    const lap =
      Number(
        row.lap_number
      );

    if (
      Number.isFinite(lap)
    ) {
      manualByLap.set(
        lap,
        row.reason ||
        "Manual exclusion"
      );
    }
  }


  const sortedPits =
    [
      ...pits
    ]
      .filter(
        row =>
          Number.isFinite(
            Number(
              row.pit_lap
            )
          ) &&
          Number(
            row.pit_lap
          ) > 0
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


  const result = [];

  let previousBoundary =
    0;


  for (
    let index = 0;
    index <
      sortedPits.length;
    index += 1
  ) {
    const stop =
      sortedPits[index];

    const endBoundary =
      Number(
        stop.pit_lap
      );


    if (
      endBoundary <=
      previousBoundary
    ) {
      continue;
    }


    const raw =
      lapRows.filter(
        row =>
          Number(
            row.lap_number
          ) >
            previousBoundary &&
          Number(
            row.lap_number
          ) <=
            endBoundary
      );


    const excluded =
      new Map();


    /*
     * First stint:
     * lap 1 remains valid.
     *
     * Later stints:
     * the first lap after the previous pit boundary
     * is the pit transition lap.
     */
    if (
      previousBoundary > 0 &&
      raw.length
    ) {
      excluded.set(
        Number(
          raw[0].lap_number
        ),
        "Pit In / Out"
      );
    }


    for (
      const row
      of raw
    ) {
      const lap =
        Number(
          row.lap_number
        );

      if (
        manualByLap.has(lap)
      ) {
        excluded.set(
          lap,
          manualByLap.get(
            lap
          )
        );
      }
    }


    const counted =
      raw.filter(
        row =>
          !excluded.has(
            Number(
              row.lap_number
            )
          )
      );


    const stats =
      calculateStats(
        counted
      );


    result.push({
      race_id:
        Number(rid),

      apex_id:
        String(apexId),

      team_name:
        teamName,

      driver_name:
        stop.driver_name ||
        null,

      stint_number:
        index + 1,

      start_lap_count:
        previousBoundary,

      end_lap_count:
        endBoundary,

      total_laps:
        raw.length,

      valid_laps:
        stats.validLaps,

      avg_lap:
        stats.avg,

      avg_lap_time:
        stats.avg,

      best_lap:
        stats.best,

      best_lap_time:
        stats.best,

      best_lap_number:
        stats.bestLap,

      worst_lap:
        stats.worst,

      worst_lap_time:
        stats.worst,

      worst_lap_number:
        stats.worstLap,

      consistency:
        stats.consistency,

      pit_hour:
        stop.pit_hour ??
        null,

      on_track:
        stop.on_track ??
        null,

      pit_time:
        stop.pit_time ??
        null,

      out_time:
        stop.out_time ??
        null,

      total_time:
        stop.total_time ??
        null,

      excluded_laps:
        [
          ...excluded.entries()
        ]
          .map(
            (
              [
                lap_number,
                reason
              ]
            ) => ({
              lap_number,
              reason
            })
          ),

      is_live:
        false,

      status:
        "COMPLETED"
    });


    previousBoundary =
      endBoundary;
  }


  const maxLap =
    Math.max(
      Number(
        currentLap ||
        0
      ),

      lapRows.length
        ? Number(
            lapRows[
              lapRows.length -
              1
            ].lap_number
          )
        : 0
    );


  if (
    maxLap >
      previousBoundary &&
    currentDriver
  ) {
    const raw =
      lapRows.filter(
        row =>
          Number(
            row.lap_number
          ) >
            previousBoundary &&
          Number(
            row.lap_number
          ) <=
            maxLap
      );


    const excluded =
      new Map();


    if (
      previousBoundary > 0 &&
      raw.length
    ) {
      excluded.set(
        Number(
          raw[0].lap_number
        ),
        "Pit In / Out"
      );
    }


    for (
      const row
      of raw
    ) {
      const lap =
        Number(
          row.lap_number
        );

      if (
        manualByLap.has(lap)
      ) {
        excluded.set(
          lap,
          manualByLap.get(
            lap
          )
        );
      }
    }


    const counted =
      raw.filter(
        row =>
          !excluded.has(
            Number(
              row.lap_number
            )
          )
      );


    const stats =
      calculateStats(
        counted
      );


    result.push({
      race_id:
        Number(rid),

      apex_id:
        String(apexId),

      team_name:
        teamName,

      driver_name:
        currentDriver,

      stint_number:
        result.length + 1,

      start_lap_count:
        previousBoundary,

      end_lap_count:
        null,

      current_lap_count:
        maxLap,

      total_laps:
        raw.length,

      valid_laps:
        stats.validLaps,

      avg_lap:
        stats.avg,

      avg_lap_time:
        stats.avg,

      best_lap:
        stats.best,

      best_lap_time:
        stats.best,

      best_lap_number:
        stats.bestLap,

      worst_lap:
        stats.worst,

      worst_lap_time:
        stats.worst,

      worst_lap_number:
        stats.worstLap,

      consistency:
        stats.consistency,

      excluded_laps:
        [
          ...excluded.entries()
        ]
          .map(
            (
              [
                lap_number,
                reason
              ]
            ) => ({
              lap_number,
              reason
            })
          ),

      is_live:
        true,

      status:
        "LIVE"
    });
  }


  return result;
}


// ============================================================
// COMPUTED STINT PAYLOAD
// ============================================================

async function computedStintsPayload(
  env,
  rid,
  filters = {}
) {
  const entries =
    await loadEntries(
      env,
      rid
    );


  const teamMap =
    await stableTeamNameMap(
      env,
      rid
    );


  let selectedEntries =
    entries;


  /*
   * CRITICAL:
   * when no explicit team/apex filter exists,
   * stints must also be limited to the current Apex field.
   */
  if (
    !filters.apexId &&
    !filters.team
  ) {
    const snapshot =
      await collectorSnapshot(
        env
      )
        .catch(
          () => null
        );


    const fieldIds =
      currentFieldIdsFromSnapshot(
        snapshot
      );


    if (fieldIds.size) {
      selectedEntries =
        entries.filter(
          row =>
            fieldIds.has(
              String(
                row.apex_id
              )
            )
        );
    }
  }


  if (
    filters.apexId
  ) {
    selectedEntries =
      entries.filter(
        row =>
          String(
            row.apex_id
          ) ===
          String(
            filters.apexId
          )
      );

  } else if (
    filters.team
  ) {
    const wanted =
      stripHtml(
        filters.team
      )
        .toUpperCase();


    selectedEntries =
      selectedEntries.filter(
        row => {
          const id =
            String(
              row.apex_id
            );

          const driver =
            row.current_driver ||
            null;

          const name =
            resolveTeam(
              id,
              teamMap,
              driver,
              row.team_name
            );


          return (
            String(
              name ||
              ""
            )
              .toUpperCase() ===
            wanted
          );
        }
      );
  }


  const ids =
    [
      ...new Set(
        selectedEntries
          .map(
            row =>
              String(
                row.apex_id
              )
          )
      )
    ];


  if (!ids.length) {
    return [];
  }


  const singleId =
    ids.length === 1
      ? ids[0]
      : null;


  const [
    allPits,
    allLaps,
    allManual
  ] =
    await Promise.all([
      loadPits(
        env,
        rid,
        singleId
      ),

      loadLaps(
        env,
        rid,
        singleId
      ),

      loadManualExclusions(
        env,
        rid,
        singleId
      )
    ]);


  const idSet =
    new Set(ids);

  const pitsById =
    new Map();

  const lapsById =
    new Map();

  const manualById =
    new Map();


  for (
    const row
    of allPits
  ) {
    const id =
      String(
        row.apex_id
      );

    if (
      !idSet.has(id)
    ) {
      continue;
    }

    if (
      !pitsById.has(id)
    ) {
      pitsById.set(
        id,
        []
      );
    }

    pitsById
      .get(id)
      .push(row);
  }


  for (
    const row
    of allLaps
  ) {
    const id =
      String(
        row.apex_id
      );

    if (
      !idSet.has(id)
    ) {
      continue;
    }

    if (
      !lapsById.has(id)
    ) {
      lapsById.set(
        id,
        []
      );
    }

    lapsById
      .get(id)
      .push(row);
  }


  for (
    const row
    of allManual
  ) {
    const id =
      String(
        row.apex_id
      );

    if (
      !idSet.has(id)
    ) {
      continue;
    }

    if (
      !manualById.has(id)
    ) {
      manualById.set(
        id,
        []
      );
    }

    manualById
      .get(id)
      .push(row);
  }


  const result = [];


  for (
    const entry
    of selectedEntries
  ) {
    const id =
      String(
        entry.apex_id
      );


    const teamName =
      resolveTeam(
        id,
        teamMap,
        entry.current_driver,
        entry.team_name
      );


    result.push(
      ...buildStintsForApex({
        rid,

        apexId:
          id,

        teamName,

        currentDriver:
          entry.current_driver ||
          null,

        currentLap:
          Number(
            entry.lap_count ||
            0
          ),

        laps:
          lapsById.get(id) ||
          [],

        pits:
          pitsById.get(id) ||
          [],

        manualExclusions:
          manualById.get(id) ||
          []
      })
    );
  }


  return result.sort(
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
        Number(
          a.stint_number
        ) -
        Number(
          b.stint_number
        )
      );
    }
  );
}


// ============================================================
// PERSIST STATS
// ============================================================

async function persistComputedStintsForApex(
  env,
  rid,
  apexId
) {
  const rows =
    await computedStintsPayload(
      env,
      rid,
      {
        apexId
      }
    );


  const completed =
    rows.filter(
      row =>
        !row.is_live
    );


  const live =
    rows.find(
      row =>
        row.is_live
    ) ||
    null;


  await sbDelete(
    env,
    "completed_stint_stats",
    {
      race_id:
        `eq.${rid}`,

      apex_id:
        `eq.${apexId}`
    }
  );


  if (
    completed.length
  ) {
    const payload =
      completed.map(
        row => ({
          race_id:
            rid,

          apex_id:
            String(
              apexId
            ),

          team_name:
            row.team_name,

          driver_name:
            row.driver_name,

          start_lap_count:
            row.start_lap_count,

          end_lap_count:
            row.end_lap_count,

          total_laps:
            row.total_laps,

          valid_laps:
            row.valid_laps,

          avg_lap:
            row.avg_lap,

          best_lap:
            row.best_lap,

          best_lap_number:
            row.best_lap_number,

          worst_lap:
            row.worst_lap,

          worst_lap_number:
            row.worst_lap_number,

          consistency:
            row.consistency,

          stint_started_at:
            new Date()
              .toISOString(),

          stint_ended_at:
            new Date()
              .toISOString()
        })
      );


    await sbInsert(
      env,
      "completed_stint_stats",
      payload
    );
  }


  await sbDelete(
    env,
    "live_stint_stats",
    {
      race_id:
        `eq.${rid}`,

      apex_id:
        `eq.${apexId}`
    }
  );


  if (live) {
    await sbUpsert(
      env,
      "live_stint_stats",
      {
        race_id:
          rid,

        apex_id:
          String(
            apexId
          ),

        team_name:
          live.team_name,

        driver_name:
          live.driver_name,

        start_lap_count:
          live.start_lap_count,

        current_lap_count:
          live.current_lap_count,

        total_laps:
          live.total_laps,

        valid_laps:
          live.valid_laps,

        lap_sum:
          null,

        lap_sum_squares:
          null,

        last_lap:
          null,

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
          new Date()
            .toISOString(),

        updated_at:
          new Date()
            .toISOString()
      },

      "race_id,apex_id"
    );
  }
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

    this.positions =
      new Map();

    this.columnTypes =
      new Map();

    this.pitCounts =
      new Map();

    /*
     * CRITICAL FIX:
     * exact set of Apex IDs present in the LAST FULL GRID.
     *
     * This is the current race field.
     *
     * It survives race finish and Worker requests.
     */
    this.fieldApexIds =
      new Set();

    this.lastGridAt =
      null;

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


        this.lastGridAt =
          await state.storage.get(
            "lastGridAt"
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


        this.fieldApexIds =
          new Set(
            (
              await state.storage.get(
                "fieldApexIds"
              )
            ) || []
          );


        /*
         * Compatibility with the previous collector state.
         *
         * Before fieldApexIds existed, positions came from the
         * same full Apex grid. We may use those IDs as a safe
         * one-time fallback until the next full grid arrives.
         *
         * We DO NOT use all apex_entries.
         */
        if (
          this.fieldApexIds.size ===
            0 &&
          this.positions.size >
            0
        ) {
          this.fieldApexIds =
            new Set(
              this.positions.keys()
            );
        }


        const storedVersion =
          await state.storage.get(
            "bootstrapVersion"
          );


        if (
          storedVersion ===
          BOOTSTRAP_VERSION
        ) {
          this.bootstrapped =
            new Set(
              await state.storage.get(
                "bootstrapped"
              ) || []
            );

        } else {
          this.bootstrapped =
            new Set();


          await state.storage.put(
            "bootstrapVersion",
            BOOTSTRAP_VERSION
          );


          await state.storage.put(
            "bootstrapped",
            []
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
        status: 404
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


  async persist() {
    await this.state.storage.put({
      packetCount:
        this.packetCount,

      lastPacketAt:
        this.lastPacketAt,

      lastGridAt:
        this.lastGridAt,

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

      bootstrapped:
        [
          ...this.bootstrapped
        ],

      bootstrapVersion:
        BOOTSTRAP_VERSION
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


  async refreshTeam(
    apexId,
    force = false
  ) {
    const id =
      String(
        apexId
      );


    /*
     * Never fetch detail for an old competitor which is not
     * part of the current Apex grid.
     */
    if (
      this.fieldApexIds.size &&
      !this.fieldApexIds.has(id)
    ) {
      return;
    }


    if (
      this.detailRunning.has(id)
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
        index <
          laps.length;
        index += 250
      ) {
        await sbUpsert(
          this.env,
          "apex_lap_events",

          laps.slice(
            index,
            index + 250
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


      await persistComputedStintsForApex(
        this.env,
        this.rid,
        id
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
        !badTeamName(team)
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
          String(apexId),
          Math.trunc(position)
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
          String(apexId),
          Math.trunc(pitCount)
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
        lapTime !== null
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
        bestLap !== null
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
        lapCount !== null &&
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


        /*
         * CRITICAL FIX:
         *
         * A full grid REPLACES the previous field.
         * It is not merged with historical competitors.
         */
        if (
          grid.rows.size
        ) {
          this.fieldApexIds =
            new Set(
              grid.rows.keys()
            );


          this.lastGridAt =
            new Date()
              .toISOString();


          /*
           * Positions belong to exactly the same grid.
           * Replace them too.
           */
          this.positions =
            new Map(
              grid.positions
            );


          /*
           * Remove stale pit counts belonging to IDs that are
           * no longer part of the current field.
           */
          this.pitCounts =
            new Map(
              [
                ...this.pitCounts.entries()
              ]
                .filter(
                  ([id]) =>
                    this.fieldApexIds.has(
                      String(id)
                    )
                )
            );
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
            of Object.entries(fields)
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


      /*
       * Once we know the current full field, ignore row updates
       * which refer to stale competitors from an older session.
       */
      if (
        this.fieldApexIds.size &&
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
    this.packetCount += 1;


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
      `Collector snapshot failed: ${response.status}`
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
      `Collector start failed: ${response.status}`
    );
  }


  return response.json();
}


// ============================================================
// CURRENT FIELD
// ============================================================

function currentFieldIdsFromSnapshot(
  snapshot
) {
  const ids =
    new Set(
      (
        snapshot?.fieldApexIds ||
        []
      )
        .map(
          value =>
            String(value)
        )
        .filter(Boolean)
    );


  /*
   * Compatibility fallback only.
   *
   * positions are also replaced on every full Apex grid,
   * so they represent the same race field.
   */
  if (
    ids.size ===
      0 &&
    snapshot?.positions
  ) {
    for (
      const id
      of Object.keys(
        snapshot.positions
      )
    ) {
      ids.add(
        String(id)
      );
    }
  }


  return ids;
}


// ============================================================
// LIVE PAYLOAD
//
// RULE:
//   Current race = EXACT IDs from latest Apex grid.
//
// NEVER:
//   all apex_entries
//   updated_at cohort
//   alphabetical selection
//
// The grid survives the finish, therefore finished race data
// remains visible exactly while Apex still exposes that grid.
// ============================================================

async function livePayload(
  env,
  rid
) {
  const [
    entries,
    persistedLive,
    pits,
    snapshot,
    teamMap
  ] =
    await Promise.all([
      loadEntries(
        env,
        rid
      ),


      sbGetAll(
        env,
        "live_stint_stats",
        {
          select:
            "*",

          race_id:
            `eq.${rid}`
        }
      )
        .catch(
          () => []
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
    currentFieldIdsFromSnapshot(
      snapshot
    );


  /*
   * IMPORTANT:
   *
   * We do NOT fall back to all 540 database rows.
   *
   * Until we have a real Apex grid we would rather show
   * "waiting for Apex grid" than display false historical data.
   */
  if (
    fieldIds.size ===
    0
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

      data_available:
        false,

      session_status:
        "WAITING FOR APEX GRID",

      collector_connected:
        snapshot?.connected ===
        true,

      last_packet_at:
        snapshot?.last_packet_at ||
        null,

      last_grid_at:
        snapshot?.last_grid_at ||
        null,

      team_count:
        0,

      current:
        [],

      entries:
        []
    };
  }


  /*
   * MAIN FIX:
   *
   * EXACTLY the competitors present in the last Apex grid.
   *
   * If Apex grid has 72 teams => we can never return 540.
   */
  const activeEntries =
    entries.filter(
      entry =>
        fieldIds.has(
          String(
            entry.apex_id
          )
        )
    );


  const liveMap =
    new Map(
      persistedLive
        .filter(
          row =>
            fieldIds.has(
              String(
                row.apex_id
              )
            )
        )
        .map(
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


    /*
     * Old race/session pits must not affect current overview.
     */
    if (
      !fieldIds.has(id)
    ) {
      continue;
    }


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
      Number.isFinite(lap)
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
      snapshot?.pitCounts ||
      {}
    )
  ) {
    if (
      !fieldIds.has(
        String(id)
      )
    ) {
      continue;
    }


    const count =
      Number(value);


    if (
      Number.isFinite(count) &&
      count >= 0
    ) {
      pitCount.set(
        String(id),
        Math.max(
          pitCount.get(
            String(id)
          ) || 0,

          Math.trunc(count)
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
          liveMap.get(id) ||
          {};


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
            lastPit.get(id) ??
            0
          ) || 0;


        const driver =
          stint.driver_name ??
          entry.current_driver ??
          null;


        const apexPosition =
          Number(
            snapshot?.positions?.[
              id
            ]
          );


        return {
          race_id:
            Number(rid),

          apex_id:
            entry.apex_id,

          position:
            (
              Number.isFinite(
                apexPosition
              ) &&
              apexPosition > 0
            )
              ? apexPosition
              : null,

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
            pitsNow + 1,

          start_lap_count:
            start,

          stint_laps:
            Number(
              stint.total_laps ??
              Math.max(
                0,
                raceLap -
                start
              )
            ) || 0,

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


  /*
   * Apex race position only.
   *
   * Missing position falls behind positioned entries and
   * falls back to race lap — NEVER alphabetically.
   */
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


      const hasPa =
        Number.isFinite(pa) &&
        pa > 0;


      const hasPb =
        Number.isFinite(pb) &&
        pb > 0;


      if (
        hasPa &&
        hasPb &&
        pa !== pb
      ) {
        return pa - pb;
      }


      if (
        hasPa &&
        !hasPb
      ) {
        return -1;
      }


      if (
        !hasPa &&
        hasPb
      ) {
        return 1;
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


  /*
   * Session status is separate from data availability.
   *
   * Old row timestamps can NEVER delete competitors.
   */
  const lastSignal =
    Math.max(
      Date.parse(
        snapshot?.last_packet_at ||
        ""
      ) || 0,

      Date.parse(
        snapshot?.last_grid_at ||
        ""
      ) || 0
    );


  const sessionLive =
    !!lastSignal &&
    Date.now() -
      lastSignal <=
      180000;


  return {
    race_id:
      Number(rid),

    session_name:
      "Apex Timing",

    generated_at:
      new Date()
        .toISOString(),

    /*
     * active means:
     * current Apex race data exists.
     *
     * Finished race remains available.
     */
    active:
      current.length > 0,

    data_available:
      current.length > 0,

    session_status:
      sessionLive
        ? "LIVE"
        : "FINISHED",

    is_live:
      sessionLive,

    collector_connected:
      snapshot?.connected ===
      true,

    last_packet_at:
      snapshot?.last_packet_at ||
      null,

    last_grid_at:
      snapshot?.last_grid_at ||
      null,

    apex_field_count:
      fieldIds.size,

    team_count:
      current.length,

    current,

    entries:
      activeEntries
  };
}


// ============================================================
// OVERVIEW
// ============================================================

async function overviewPayload(
  env,
  rid
) {
  const live =
    await livePayload(
      env,
      rid
    );

  return live.current;
}


// ============================================================
// STINTS
// ============================================================

async function stintsPayload(
  env,
  rid,
  url
) {
  const apexId =
    url?.searchParams.get(
      "apex_id"
    ) ||
    null;


  const team =
    url?.searchParams.get(
      "team"
    ) ||
    null;


  return computedStintsPayload(
    env,
    rid,
    {
      apexId,
      team
    }
  );
}


// ============================================================
// DRIVERS
// ============================================================

async function driversPayload(
  env,
  rid,
  url
) {
  const stints =
    await stintsPayload(
      env,
      rid,
      url
    );


  const groups =
    new Map();


  for (
    const stint
    of stints
  ) {
    const driver =
      stint.driver_name;


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
          row.valid_laps ||
          0
        );


      const total =
        Number(
          row.total_laps ||
          0
        );


      const avg =
        Number(
          row.avg_lap_time
        );


      const bestLap =
        Number(
          row.best_lap_time
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


      validLaps += valid;
      totalLaps += total;


      if (
        Number.isFinite(avg) &&
        valid > 0
      ) {
        weighted +=
          avg * valid;

        weight += valid;
      }


      if (
        Number.isFinite(bestLap) &&
        bestLap > 0 &&
        (
          best === null ||
          bestLap < best
        )
      ) {
        best = bestLap;
      }


      if (
        Number.isFinite(consistency) &&
        valid > 0
      ) {
        consistencySum +=
          consistency * valid;

        consistencyWeight +=
          valid;
      }
    }


    rows.push({
      race_id:
        Number(rid),

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


// ============================================================
// TEAMS
// ============================================================

async function teamsPayload(
  env,
  rid,
  url
) {
  const drivers =
    await driversPayload(
      env,
      rid,
      url
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
      !groups.has(key)
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
                Number.isFinite(value) &&
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
                Number.isFinite(value) &&
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


// ============================================================
// RACES
// ============================================================

async function racesPayload(env) {
  try {
    const rows =
      await sbGetAll(
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
            new Date(rawDate);


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

  } catch {
    return [];
  }
}


// ============================================================
// EVENTS
// ============================================================

async function eventsPayload(
  env,
  rid,
  url
) {
  const apexId =
    url?.searchParams.get(
      "apex_id"
    ) ||
    null;


  const rows =
    await loadManualExclusions(
      env,
      rid,
      apexId
    );


  const snapshot =
    await collectorSnapshot(
      env
    )
      .catch(
        () => null
      );


  const fieldIds =
    currentFieldIdsFromSnapshot(
      snapshot
    );


  return rows
    .filter(
      row =>
        !fieldIds.size ||
        fieldIds.has(
          String(
            row.apex_id
          )
        )
    )
    .map(
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
}


// ============================================================
// CSV HELPERS
// ============================================================

function csvEscape(value) {
  const text =
    String(
      value ??
      ""
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


async function raceMeta(
  env,
  rid
) {
  try {
    const rows =
      await sbGet(
        env,
        "races",
        {
          select:
            "*",

          id:
            `eq.${rid}`,

          limit:
            "1"
        }
      );


    return rows[0] ||
      {
        id: rid
      };

  } catch {
    return {
      id: rid
    };
  }
}


function reportRaceTitle(
  meta,
  rid
) {
  return (
    meta?.name ||
    meta?.session_name ||
    meta?.title ||
    `Race ${rid}`
  );
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
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


// ============================================================
// LAP TIME RECORDS CSV
// ============================================================

async function buildApexLapTimesCsv(
  env,
  rid
) {
  const [
    laps,
    entries,
    teamMap,
    meta,
    snapshot
  ] =
    await Promise.all([
      loadLaps(
        env,
        rid
      ),

      loadEntries(
        env,
        rid
      ),

      stableTeamNameMap(
        env,
        rid
      ),

      raceMeta(
        env,
        rid
      ),

      collectorSnapshot(
        env
      )
        .catch(
          () => null
        )
    ]);


  const fieldIds =
    currentFieldIdsFromSnapshot(
      snapshot
    );


  const currentEntries =
    entries.filter(
      row =>
        fieldIds.has(
          String(
            row.apex_id
          )
        )
    );


  const entryMap =
    new Map(
      currentEntries.map(
        row => [
          String(
            row.apex_id
          ),
          row
        ]
      )
    );


  const groups =
    new Map();


  for (
    const row
    of laps
  ) {
    const id =
      String(
        row.apex_id
      );


    /*
     * Mandatory report must also contain THIS race only.
     */
    if (
      !fieldIds.has(id)
    ) {
      continue;
    }


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


  const teamRows =
    [
      ...groups.entries()
    ]
      .map(
        (
          [
            id,
            rows
          ]
        ) => {

          const entry =
            entryMap.get(id) ||
            {};


          const teamName =
            resolveTeam(
              id,
              teamMap,
              entry.current_driver,
              entry.team_name
            ) ||
            `APEX ${id}`;


          return {
            id,
            teamName,
            rows:
              dedupeLapRows(
                rows
              )
          };
        }
      );


  teamRows.sort(
    (a, b) => {

      const pa =
        Number(
          snapshot?.positions?.[
            a.id
          ]
        );

      const pb =
        Number(
          snapshot?.positions?.[
            b.id
          ]
        );


      if (
        Number.isFinite(pa) &&
        Number.isFinite(pb)
      ) {
        return pa - pb;
      }


      return a.teamName
        .localeCompare(
          b.teamName
        );
    }
  );


  const lines = [
    "Apex Timing - drive your success https://www.apex-timing.com/",
    "",
    "",
    "Karting Events Bulgaria - Karting Track",
    "",
    "",
    new Date()
      .toLocaleDateString(
        "en-GB",
        {
          timeZone:
            "Europe/Sofia"
        }
      ) +
      " - Race Engineer / Apex Timing data",
    "",
    "",
    ""
  ];


  for (
    const team
    of teamRows
  ) {
    lines.push(
      `${csvEscape(team.id)} - ${csvEscape(team.teamName)}`
    );


    lines.push(
      "Laps,1,2,3,4,5,6,7,8,9,10"
    );


    const lapMap =
      new Map(
        team.rows.map(
          row => [
            Number(
              row.lap_number
            ),

            Number(
              row.lap_time
            )
          ]
        )
      );


    const maxLap =
      team.rows.length
        ? Math.max(
            ...team.rows.map(
              row =>
                Number(
                  row.lap_number
                )
            )
          )
        : 0;


    for (
      let start = 1;
      start <= maxLap;
      start += 10
    ) {
      const label =
        start === 1
          ? ""
          : String(
              start - 1
            );


      const values = [];


      for (
        let lap = start;
        lap < start + 10;
        lap += 1
      ) {
        if (
          lap > maxLap
        ) {
          values.push("");

        } else if (
          lapMap.has(lap)
        ) {
          values.push(
            Number(
              lapMap.get(lap)
            )
              .toFixed(3)
          );

        } else {
          values.push("-");
        }
      }


      lines.push(
        [
          label,
          ...values
        ].join(",")
      );
    }


    lines.push("");
  }


  const title =
    reportRaceTitle(
      meta,
      rid
    );


  return {
    title,

    filename:
      `${safeFilename(title)} - Race - Lap time records.csv`,

    csv:
      lines.join("\n")
  };
}


// ============================================================
// PIT REPORT
// ============================================================

async function pitReportPayload(
  env,
  rid,
  url = null
) {
  const apexId =
    url?.searchParams.get(
      "apex_id"
    ) ||
    null;


  const team =
    url?.searchParams.get(
      "team"
    ) ||
    null;


  const stints =
    await computedStintsPayload(
      env,
      rid,
      {
        apexId,
        team
      }
    );


  const meta =
    await raceMeta(
      env,
      rid
    );


  const groups =
    new Map();


  for (
    const stint
    of stints
  ) {
    const key =
      String(
        stint.apex_id
      );


    if (
      !groups.has(key)
    ) {
      groups.set(
        key,
        {
          apex_id:
            stint.apex_id,

          team_name:
            stint.team_name,

          rows:
            []
        }
      );
    }


    groups
      .get(key)
      .rows
      .push({
        pit_number:
          stint.stint_number,

        lap:
          stint.is_live
            ? stint.current_lap_count
            : stint.end_lap_count,

        hour:
          stint.pit_hour ||
          "",

        total:
          stint.total_time ||
          "",

        on_track:
          stint.on_track ||
          "",

        laps:
          stint.total_laps,

        driver:
          stint.driver_name,

        driver_total:
          stint.total_time ||
          "",

        best_lap:
          stint.best_lap_time,

        best_lap_number:
          stint.best_lap_number,

        avg:
          stint.avg_lap_time,

        pits:
          stint.pit_time ||
          "",

        out:
          stint.is_live
            ? "(Current)"
            : (
                stint.out_time ||
                ""
              ),

        status:
          stint.status
      });
  }


  const title =
    reportRaceTitle(
      meta,
      rid
    );


  return {
    race_id:
      Number(rid),

    title,

    filename:
      `${safeFilename(title)} - Race - Pit stops.pdf`,

    teams:
      [
        ...groups.values()
      ]
  };
}


// ============================================================
// HTML
// ============================================================

function escapeHtml(value) {
  return String(
    value ??
    ""
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
  report
) {
  const teamSections =
    report.teams.map(
      team => {

        const rows =
          team.rows.map(
            row => `
<tr>
  <td>${escapeHtml(row.pit_number)}</td>
  <td>${escapeHtml(row.lap)}</td>
  <td>${escapeHtml(row.hour)}</td>
  <td>${escapeHtml(row.total)}</td>
  <td>${escapeHtml(row.on_track)}</td>
  <td>${escapeHtml(row.laps)}</td>
  <td>${escapeHtml(row.driver)}</td>
  <td>${escapeHtml(row.driver_total)}</td>
  <td>${escapeHtml(formatLapTime(row.best_lap))}</td>
  <td>${escapeHtml(formatLapTime(row.avg))}</td>
  <td>${escapeHtml(row.pits)}</td>
  <td>${escapeHtml(row.out)}</td>
</tr>`
          )
            .join("");


        return `
<section class="team">

  <h2>
    ${escapeHtml(team.apex_id)}
    -
    ${escapeHtml(team.team_name)}
  </h2>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Lap</th>
        <th>Hour</th>
        <th>Total</th>
        <th>On track</th>
        <th>Laps</th>
        <th>Driver</th>
        <th>Total</th>
        <th>Best lap</th>
        <th>Avg</th>
        <th>Pits</th>
        <th>Out</th>
      </tr>
    </thead>

    <tbody>
      ${rows}
    </tbody>
  </table>

</section>`;
      }
    )
      .join("");


  return `<!doctype html>

<html>

<head>

<meta charset="utf-8">

<title>
${escapeHtml(report.title)} - Pit stops
</title>

<style>

@page {
  size: A4 landscape;
  margin: 10mm;
}

body {
  font-family: Arial, Helvetica, sans-serif;
  color: #111;
  margin: 0;
  font-size: 9px;
}

.head {
  margin-bottom: 12px;
}

.head h1 {
  font-size: 18px;
  margin: 0 0 3px;
}

.head p {
  margin: 0;
  color: #555;
}

.team {
  break-inside: avoid;
  margin: 0 0 14px;
}

.team h2 {
  font-size: 12px;
  margin: 0 0 5px;
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
}

th,
td {
  border: 1px solid #bbb;
  padding: 3px 4px;
  white-space: nowrap;
}

th {
  background: #e9e9e9;
  text-align: left;
}

tr:nth-child(even) td {
  background: #f8f8f8;
}

.print {
  position: fixed;
  right: 12px;
  top: 12px;
  padding: 8px 12px;
}

@media print {
  .print {
    display: none;
  }
}

</style>

</head>

<body>

<button
  class="print"
  onclick="window.print()"
>
  Print / Save PDF
</button>

<div class="head">

  <h1>
    ${escapeHtml(report.title)} - Pit stops
  </h1>

  <p>
    Apex Timing data reconstructed by Race Engineer
  </p>

</div>

${
  teamSections ||
  "<p>No pit-stop data.</p>"
}

</body>

</html>`;
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
      new URL(
        request.url
      );


    const rid =
      raceId(
        env,
        url
      );


    try {

      // --------------------------------------------------------
      // HEALTH
      // --------------------------------------------------------

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
            BOOTSTRAP_VERSION,

          now:
            new Date()
              .toISOString()
        });
      }


      // --------------------------------------------------------
      // COLLECTOR
      // --------------------------------------------------------

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


      // --------------------------------------------------------
      // LIVE
      // --------------------------------------------------------

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


        return json(
          await livePayload(
            env,
            raceId(env)
          )
        );
      }


      // --------------------------------------------------------
      // RACES
      // --------------------------------------------------------

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


      // --------------------------------------------------------
      // OVERVIEW
      // --------------------------------------------------------

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


      // --------------------------------------------------------
      // STINTS
      // --------------------------------------------------------

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
              rid,
              url
            )
        });
      }


      // --------------------------------------------------------
      // DRIVERS
      // --------------------------------------------------------

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
              rid,
              url
            )
        });
      }


      // --------------------------------------------------------
      // TEAMS
      // --------------------------------------------------------

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
              rid,
              url
            )
        });
      }


      // --------------------------------------------------------
      // RAW LAPS
      // --------------------------------------------------------

      if (
        url.pathname ===
        "/api/laps"
      ) {
        const apexId =
          url.searchParams.get(
            "apex_id"
          ) ||
          null;


        const snapshot =
          await collectorSnapshot(
            env
          )
            .catch(
              () => null
            );


        const fieldIds =
          currentFieldIdsFromSnapshot(
            snapshot
          );


        const rows =
          await loadLaps(
            env,
            rid,
            apexId
          );


        return json({
          race_id:
            rid,

          rows:
            rows.filter(
              row =>
                !fieldIds.size ||
                fieldIds.has(
                  String(
                    row.apex_id
                  )
                )
            )
        });
      }


      // --------------------------------------------------------
      // PITS
      // --------------------------------------------------------

      if (
        url.pathname ===
        "/api/pits"
      ) {
        const apexId =
          url.searchParams.get(
            "apex_id"
          ) ||
          null;


        const [
          teamMap,
          snapshot
        ] =
          await Promise.all([
            stableTeamNameMap(
              env,
              rid
            ),

            collectorSnapshot(
              env
            )
              .catch(
                () => null
              )
          ]);


        const fieldIds =
          currentFieldIdsFromSnapshot(
            snapshot
          );


        const rows =
          await loadPits(
            env,
            rid,
            apexId
          );


        return json({
          race_id:
            rid,

          rows:
            rows
              .filter(
                row =>
                  !fieldIds.size ||
                  fieldIds.has(
                    String(
                      row.apex_id
                    )
                  )
              )
              .map(
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


      // --------------------------------------------------------
      // LAP TIME RECORDS
      // --------------------------------------------------------

      if (
        url.pathname ===
        "/api/reports/lap-time-records.csv"
      ) {
        const report =
          await buildApexLapTimesCsv(
            env,
            rid
          );


        return textResponse(
          "\uFEFF" +
          report.csv,

          "text/csv",

          report.filename
        );
      }


      // --------------------------------------------------------
      // PIT REPORT DATA
      // --------------------------------------------------------

      if (
        url.pathname ===
        "/api/reports/pit-stops"
      ) {
        return json(
          await pitReportPayload(
            env,
            rid,
            url
          )
        );
      }


      // --------------------------------------------------------
      // PIT REPORT HTML
      // --------------------------------------------------------

      if (
        url.pathname ===
        "/api/reports/pit-stops.html"
      ) {
        const report =
          await pitReportPayload(
            env,
            rid,
            url
          );


        return textResponse(
          buildPitReportHtml(
            report
          ),

          "text/html"
        );
      }


      // --------------------------------------------------------
      // EVENTS
      // --------------------------------------------------------

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
                url
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
            !Number.isFinite(lap) ||
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


          /*
           * Do not allow a stale historical competitor to be
           * modified through Current race.
           */
          const snapshot =
            await collectorSnapshot(
              env
            )
              .catch(
                () => null
              );


          const fieldIds =
            currentFieldIdsFromSnapshot(
              snapshot
            );


          if (
            fieldIds.size &&
            !fieldIds.has(
              apexId
            )
          ) {
            return json(
              {
                error:
                  "The selected Apex ID is not part of the current race field."
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
                Math.trunc(lap),

              reason:
                body.reason ||
                null
            }
          );


          await persistComputedStintsForApex(
            env,
            rid,
            apexId
          )
            .catch(
              console.error
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
            !Number.isFinite(lap)
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
                `eq.${Math.trunc(lap)}`
            }
          );


          await persistComputedStintsForApex(
            env,
            rid,
            apexId
          )
            .catch(
              console.error
            );


          return json({
            ok: true
          });
        }
      }


      // --------------------------------------------------------
      // ASSETS
      // --------------------------------------------------------

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
      )
        .catch(
          console.error
        )
    );
  }
};
