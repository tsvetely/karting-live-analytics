const VERSION =
  "2026-08-31-race-engineer-v7.0-session-scoped-complete-reports";

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
// SESSION RACE ID
//
// DEFAULT_RACE_ID used to be reused for every race.  That made yesterday's
// entries, laps and pits indistinguishable from today's data.  Every live
// Apex session now gets its own numeric race_id, while old race_id values
// remain readable as history.
// ============================================================

function newSessionRaceId() {
  const epoch = Date.UTC(2026, 0, 1, 0, 0, 0);
  return Math.max(2, Math.floor((Date.now() - epoch) / 1000));
}

function idsFromEntries(rows) {
  const result = new Set();
  for (const row of rows || []) {
    const id = String(row?.apex_id ?? "").trim();
    if (validApexId(id)) result.add(id);
  }
  return result;
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

function calculateRawStintStats(apexId, lapRows, startLap, endLap, exclusions) {
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
  const valid = [];
  for (const [lap,time] of byLap) {
    if (lap <= start || lap > end) continue;
    if (pitOut !== null && lap === pitOut) continue;
    if (exclusions.has(`${apexId}:${lap}`)) continue;
    valid.push({lap,time});
  }
  if (!valid.length) return null;

  valid.sort((a,b)=>a.lap-b.lap);
  const avg = valid.reduce((s,r)=>s+r.time,0)/valid.length;
  let best=valid[0], worst=valid[0], variance=0;
  for (const r of valid) {
    if (r.time < best.time) best=r;
    if (r.time > worst.time) worst=r;
  }
  for (const r of valid) variance += (r.time-avg)**2;
  return {
    valid_laps: valid.length,
    avg_lap_time: avg,
    best_lap_time: best.time,
    best_lap_number: best.lap,
    worst_lap_time: worst.time,
    worst_lap_number: worst.lap,
    consistency: Math.sqrt(variance/valid.length)
  };
}

// ============================================================
// STINT DATASET
// ============================================================

async function stintsPayload(env, rid, snapshot = null) {
  const candidateSnapshot = snapshot || await collectorSnapshot(env).catch(() => null);
  const snapshotMatchesRace =
    Number(candidateSnapshot?.race_id) === Number(rid);
  const realSnapshot = snapshotMatchesRace ? candidateSnapshot : null;

  const entriesRaw = await loadEntries(env, rid).catch(() => []);
  const fieldIds = realSnapshot
    ? currentFieldIds(realSnapshot)
    : idsFromEntries(entriesRaw);
  if (!fieldIds.size) return [];

  const [pitsRaw, exclusionsRaw, lapRaw, teamMap] = await Promise.all([
    loadPits(env, rid),
    loadExclusions(env, rid),
    loadLapEventsForApexIds(env, rid, fieldIds),
    stableTeamNameMap(env, rid)
  ]);

  const entries = filterCurrentField(entriesRaw, fieldIds);
  const pits = currentPitChain(filterCurrentField(pitsRaw, fieldIds), realSnapshot);
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
      const stats=calculateRawStintStats(id,laps,start,end,exclusions) || {
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
        is_live:false, status:"COMPLETED"
      });
      start=end;
    }

    const snapshotLap=Number(realSnapshot?.lapCounts?.[id]);
    const entryLap=Number(entry.lap_count);
    const currentLap=Number.isFinite(snapshotLap) ? snapshotLap : entryLap;
    if (Number.isFinite(currentLap) && currentLap>=start) {
      const stats=currentLap>start ? (calculateRawStintStats(id,laps,start,currentLap,exclusions) || {
        valid_laps:0, avg_lap_time:null, best_lap_time:null, best_lap_number:null,
        worst_lap_time:null, worst_lap_number:null, consistency:null
      }) : {
        valid_laps:0, avg_lap_time:null, best_lap_time:null, best_lap_number:null,
        worst_lap_time:null, worst_lap_number:null, consistency:null
      };
      result.push({
        race_id:Number(rid), apex_id:id,
        team_name:resolveTeam(id,teamMap,entry.team_name),
        driver_name:entry.current_driver||null,
        stint_number:stintNumber, start_lap_count:start, end_lap_count:null,
        current_lap_count:currentLap, total_laps:Math.max(0,currentLap-start), ...stats,
        pit_hour:null,on_track:null,pit_time:null,total_time:null,
        is_live:true,status:"LIVE"
      });
    }
  }

  result.sort((a,b)=>{
    const pa=Number(realSnapshot?.positions?.[String(a.apex_id)]), pb=Number(realSnapshot?.positions?.[String(b.apex_id)]);
    if (Number.isFinite(pa)&&Number.isFinite(pb)&&pa!==pb) return pa-pb;
    if (Number.isFinite(pa)) return -1;
    if (Number.isFinite(pb)) return 1;
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
// LIGHTWEIGHT CURRENT STINTS
//
// Overview refreshes every few seconds.  It only needs the active stint, not
// every lap from the whole race.  Query laps from the earliest current-stint
// boundary so the live page stays complete without repeatedly loading tens of
// thousands of historical lap rows.
// ============================================================

async function liveStintsPayload(env, rid, snapshot) {
  const fieldIds = currentFieldIds(snapshot);
  if (!fieldIds.size) return [];

  const [entriesRaw, pitsRaw, exclusionsRaw, teamMap] = await Promise.all([
    loadEntries(env, rid).catch(() => []),
    loadPits(env, rid).catch(() => []),
    loadExclusions(env, rid).catch(() => []),
    stableTeamNameMap(env, rid).catch(() => new Map())
  ]);

  const entries = filterCurrentField(entriesRaw, fieldIds);
  const entriesById = new Map(entries.map(row => [String(row.apex_id), row]));
  const pits = currentPitChain(filterCurrentField(pitsRaw, fieldIds), snapshot);
  const exclusions = manualExclusionSet(filterCurrentField(exclusionsRaw, fieldIds));
  const lastPitById = new Map();

  for (const row of pits) {
    const id = String(row.apex_id);
    const lap = Number(row.pit_lap);
    if (!Number.isFinite(lap)) continue;
    const prev = lastPitById.get(id);
    if (!prev || lap > Number(prev.pit_lap)) lastPitById.set(id, row);
  }

  let minStart = Infinity;
  for (const id of fieldIds) {
    const start = Number(lastPitById.get(String(id))?.pit_lap) || 0;
    minStart = Math.min(minStart, start);
  }
  if (!Number.isFinite(minStart)) minStart = 0;

  const ids = [...fieldIds].map(String).filter(validApexId);
  const params = {
    select: "apex_id,lap_number,lap_time",
    race_id: `eq.${rid}`,
    apex_id: `in.(${ids.join(",")})`,
    order: "apex_id.asc,lap_number.asc"
  };
  if (minStart > 0) params.lap_number = `gte.${Math.max(1, Math.trunc(minStart))}`;
  const lapRaw = await sbGetAll(env, "apex_lap_events", params).catch(() => []);
  const lapsById = new Map();
  for (const row of lapRaw) {
    const id = String(row.apex_id);
    if (!fieldIds.has(id)) continue;
    if (!lapsById.has(id)) lapsById.set(id, []);
    lapsById.get(id).push(row);
  }

  const out = [];
  for (const value of fieldIds) {
    const id = String(value);
    const entry = entriesById.get(id) || {};
    const lastPit = lastPitById.get(id);
    const start = Number(lastPit?.pit_lap) || 0;
    const currentLap = Number(snapshot?.lapCounts?.[id]);
    const end = Number.isFinite(currentLap) ? Math.max(start, Math.trunc(currentLap)) : Math.max(start, Number(entry.lap_count) || start);
    const stats = end > start
      ? (calculateRawStintStats(id, lapsById.get(id) || [], start, end, exclusions) || {
          valid_laps: 0, avg_lap_time: null, best_lap_time: null, best_lap_number: null,
          worst_lap_time: null, worst_lap_number: null, consistency: null
        })
      : {
          valid_laps: 0, avg_lap_time: null, best_lap_time: null, best_lap_number: null,
          worst_lap_time: null, worst_lap_number: null, consistency: null
        };

    const pitCount = Number(snapshot?.pitCounts?.[id]);
    out.push({
      race_id: Number(rid),
      apex_id: id,
      team_name: resolveTeam(id, teamMap, entry.team_name, lastPit?.team_name),
      driver_name: entry.current_driver || lastPit?.driver_name || null,
      stint_number: Number.isFinite(pitCount) ? Math.trunc(pitCount) + 1 : (pits.filter(p => String(p.apex_id) === id).length + 1),
      start_lap_count: start,
      end_lap_count: null,
      current_lap_count: end,
      total_laps: Math.max(0, end - start),
      ...stats,
      is_live: true,
      status: "LIVE"
    });
  }
  return out;
}

// ============================================================
// CONSISTENT RACE DATASET BUNDLE
//
// The UI previously requested STINTS / DRIVERS / TEAMS / PITS / EVENTS in
// parallel.  STINTS loads the complete raw lap set, so this multiplied the
// same database work several times every 15 seconds.  Build it once and share
// the result across all tabs.
// ============================================================

async function datasetsPayload(env, rid, snapshot = null) {
  const snapshotForRace = Number(snapshot?.race_id) === Number(rid) ? snapshot : null;
  const entriesRaw = await loadEntries(env, rid).catch(() => []);
  const fieldIds = snapshotForRace ? currentFieldIds(snapshotForRace) : idsFromEntries(entriesRaw);
  if (!fieldIds.size) {
    return { race_id: Number(rid), stints: [], drivers: [], teams: [], pits: [], events: [] };
  }

  const stints = await stintsPayload(env, rid, snapshotForRace);
  const drivers = driversFromStints(stints);
  let teams = teamsFromDrivers(drivers, snapshotForRace);

  const teamMap = await stableTeamNameMap(env, rid).catch(() => new Map());
  const entries = filterCurrentField(entriesRaw, fieldIds);
  const seen = new Set(teams.map(row => String(row.apex_id)));

  for (const entry of entries) {
    const id = String(entry.apex_id);
    if (seen.has(id)) continue;
    const position = Number(snapshotForRace?.positions?.[id]);
    teams.push({
      race_id: Number(rid),
      apex_id: id,
      position: Number.isFinite(position) ? position : null,
      team_name: resolveTeam(id, teamMap, entry.team_name),
      driver_count: entry.current_driver ? 1 : 0,
      stint_count: 0,
      valid_laps: 0,
      total_laps: Number(entry.lap_count) || 0,
      avg_lap_time: null,
      best_lap_time: number(entry.best_lap),
      avg_consistency: null,
      driver_spread: 0
    });
  }

  teams.sort((a, b) => {
    const pa = Number(a.position), pb = Number(b.position);
    if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
    if (Number.isFinite(pa)) return -1;
    if (Number.isFinite(pb)) return 1;
    return Number(a.apex_id) - Number(b.apex_id);
  });

  const pitsRaw = await loadPits(env, rid).catch(() => []);
  const scopedPits = filterCurrentField(pitsRaw, fieldIds);
  const pits = (snapshotForRace ? currentPitChain(scopedPits, snapshotForRace) : scopedPits)
    .map(row => ({
      ...row,
      team_name: resolveTeam(row.apex_id, teamMap, row.team_name)
    }));

  const events = await eventsPayload(env, rid, snapshotForRace);
  return { race_id: Number(rid), stints, drivers, teams, pits, events };
}

// ============================================================
// LIVE OVERVIEW
// ============================================================

async function livePayload(env, rid = null) {
  const snapshot = await collectorSnapshot(env).catch(() => null);
  const effectiveRid = Number(snapshot?.race_id) > 0
    ? Number(snapshot.race_id)
    : Number(rid || raceId(env));

  const fieldIds = currentFieldIds(snapshot);
  if (!fieldIds.size) {
    return {
      race_id: effectiveRid,
      session_name: "Apex Timing",
      active: false,
      data_available: false,
      is_live: false,
      session_status: "WAITING FOR APEX GRID",
      team_count: 0,
      race_lap: 0,
      pit_count: 0,
      best_lap: null,
      current: []
    };
  }

  const [entriesRaw, teamMap] = await Promise.all([
    loadEntries(env, effectiveRid).catch(() => []),
    stableTeamNameMap(env, effectiveRid).catch(() => new Map())
  ]);
  const entries = filterCurrentField(entriesRaw, fieldIds);
  const entryById = new Map(entries.map(row => [String(row.apex_id), row]));
  const stints = await liveStintsPayload(env, effectiveRid, snapshot);
  const liveById = new Map(stints.filter(row => row.is_live).map(row => [String(row.apex_id), row]));

  const current = [];
  let raceLap = 0;
  let pitTotal = 0;
  let raceBest = null;

  for (const value of fieldIds) {
    const id = String(value);
    const entry = entryById.get(id) || {};
    const live = liveById.get(id) || {};

    const snapshotLap = Number(snapshot?.lapCounts?.[id]);
    const lap = Number.isFinite(snapshotLap)
      ? Math.max(0, Math.trunc(snapshotLap))
      : Math.max(0, Math.trunc(Number(entry.lap_count) || 0));
    raceLap = Math.max(raceLap, lap);

    const snapshotPits = Number(snapshot?.pitCounts?.[id]);
    const pitCount = Number.isFinite(snapshotPits)
      ? Math.max(0, Math.trunc(snapshotPits))
      : Math.max(0, (Number(live.stint_number) || 1) - 1);
    pitTotal += pitCount;

    const gridBest = Number(snapshot?.bestLaps?.[id]);
    const storedBest = Number(entry.best_lap);
    const best = Number.isFinite(gridBest) && gridBest > 0
      ? gridBest
      : (Number.isFinite(storedBest) && storedBest > 0 ? storedBest : null);
    if (best !== null && (raceBest === null || best < raceBest)) raceBest = best;

    const pos = Number(snapshot?.positions?.[id]);
    current.push({
      race_id: effectiveRid,
      apex_id: id,
      position: Number.isFinite(pos) ? pos : null,
      team_name: resolveTeam(id, teamMap, entry.team_name, live.team_name),
      driver_name: live.driver_name || entry.current_driver || null,
      current_driver: live.driver_name || entry.current_driver || null,
      race_lap: lap,
      live_lap_count: lap,
      pit_count: pitCount,
      stint_number: number(live.stint_number) || pitCount + 1,
      start_lap_count: number(live.start_lap_count) || 0,
      stint_laps: number(live.total_laps) || 0,
      total_stint_laps: number(live.total_laps) || 0,
      valid_laps: number(live.valid_laps) || 0,
      live_last_lap: Number(snapshot?.lastLaps?.[id]) || number(entry.last_lap),
      avg_lap_time: number(live.avg_lap_time),
      best_lap_time: number(live.best_lap_time),
      best_lap_number: number(live.best_lap_number),
      worst_lap_time: number(live.worst_lap_time),
      worst_lap_number: number(live.worst_lap_number),
      consistency: number(live.consistency),
      updated_at: entry.updated_at || snapshot?.last_packet_at || null
    });
  }

  current.sort((a, b) => {
    if (Number.isFinite(a.position) && Number.isFinite(b.position) && a.position !== b.position) return a.position - b.position;
    if (Number.isFinite(a.position)) return -1;
    if (Number.isFinite(b.position)) return 1;
    return b.race_lap - a.race_lap;
  });

  const lastPacket = Date.parse(snapshot?.last_packet_at || "");
  const isLive = Number.isFinite(lastPacket) && Date.now() - lastPacket < 180000;

  return {
    race_id: effectiveRid,
    session_name: "Apex Timing",
    active: current.length > 0,
    data_available: current.length > 0,
    is_live: isLive,
    session_status: isLive ? "LIVE" : "FINISHED",
    collector_connected: snapshot?.connected === true,
    team_count: current.length,
    race_lap: raceLap,
    pit_count: pitTotal,
    best_lap: raceBest,
    race_best_lap: raceBest,
    current
  };
}

// ============================================================
// EVENTS
// ============================================================

async function eventsPayload(env, rid, snapshot = null) {
  const snapshotMatches = Number(snapshot?.race_id) === Number(rid);
  const entries = snapshotMatches ? null : await loadEntries(env, rid).catch(() => []);
  const fieldIds = snapshotMatches ? currentFieldIds(snapshot) : idsFromEntries(entries);
  const rows = await loadExclusions(env, rid).catch(() => []);
  return filterCurrentField(rows, fieldIds).map(row => ({
    ...row,
    type: "MANUAL EXCLUSION",
    reason: row.reason || "Manual exclusion",
    status: "ACTIVE",
    time: row.created_at || row.updated_at || null
  }));
}

// ============================================================
// RACES
// ============================================================

async function racesPayload(env, currentRid = null) {
  const rows = await sbGetAll(env, "apex_entries", {
    select: "race_id,updated_at",
    order: "updated_at.desc"
  }).catch(() => []);

  const races = new Map();
  for (const row of rows) {
    const id = Number(row.race_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const timestamp = Date.parse(row.updated_at || "");
    const previous = races.get(id);
    if (!previous || timestamp > previous.timestamp) {
      races.set(id, { timestamp: Number.isFinite(timestamp) ? timestamp : 0 });
    }
  }

  return [...races.entries()]
    .filter(([id]) => Number(id) !== Number(currentRid))
    .map(([id, value]) => {
      const date = value.timestamp ? new Date(value.timestamp) : null;
      const label = date
        ? new Intl.DateTimeFormat("en-GB", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit", hour12: false,
            timeZone: "Europe/Sofia"
          }).format(date)
        : `Race ${id}`;
      return { id, race_id: id, label: `Race — ${label}` };
    })
    .sort((a, b) => Number(b.race_id) - Number(a.race_id));
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


async function lapRecordsPagePayload(env, rid, offset = 0, limit = PAGE_SIZE) {
  const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
  const safeLimit = Math.max(1, Math.min(PAGE_SIZE, Math.trunc(Number(limit) || PAGE_SIZE)));

  const rows = await sbGet(env, "apex_lap_events", {
    select: "apex_id,lap_number,lap_time",
    race_id: `eq.${rid}`,
    order: "apex_id.asc,lap_number.asc"
  }, {
    from: safeOffset,
    to: safeOffset + safeLimit - 1
  }).catch(() => []);

  return {
    race_id: Number(rid),
    offset: safeOffset,
    limit: safeLimit,
    has_more: rows.length === safeLimit,
    rows: rows
      .map(row => ({
        apex_id: String(row.apex_id ?? "").trim(),
        lap_number: Number(row.lap_number),
        lap_time: Number(row.lap_time)
      }))
      .filter(row => validApexId(row.apex_id) && Number.isFinite(row.lap_number) && row.lap_number > 0 && Number.isFinite(row.lap_time) && row.lap_time > 0)
  };
}

async function createLapRecordsCsvResponse(env, rid) {
  // Kept only for backwards compatibility.  The UI uses the paged endpoint
  // below so a 12h race never forces one Worker request to load 40k+ laps.
  const page = await lapRecordsPagePayload(env, rid, 0, PAGE_SIZE);
  if (!page.rows.length) return json({ error: `No lap records found for race ${rid}.` }, 404);
  if (page.has_more) {
    return json({
      error: "Large lap report must be downloaded through the paged report endpoint.",
      paged_endpoint: "/api/reports/lap-time-records-page"
    }, 409);
  }

  const entries = await loadEntries(env, rid).catch(() => []);
  const names = new Map(entries.map(row => [String(row.apex_id), stripHtml(row.team_name) || `APEX ${row.apex_id}`]));
  const byTeam = new Map();
  for (const row of page.rows) {
    if (!byTeam.has(row.apex_id)) byTeam.set(row.apex_id, []);
    byTeam.get(row.apex_id).push(row);
  }

  let csv = "\uFEFF";
  for (const [apexId, laps] of byTeam) {
    csv += `${csvEscape(apexId)} - ${csvEscape(names.get(apexId) || `APEX ${apexId}`)}\r\n`;
    csv += "Laps,1,2,3,4,5,6,7,8,9,10\r\n";
    const map = new Map(laps.map(row => [Math.trunc(row.lap_number), row.lap_time]));
    const maxLap = Math.max(...map.keys());
    for (let base = 0; base < maxLap; base += 10) {
      const cells = [base === 0 ? "" : String(base)];
      for (let n = 1; n <= 10; n++) {
        const value = map.get(base + n);
        cells.push(Number.isFinite(value) ? formatLap(value) : "");
      }
      csv += cells.map(csvEscape).join(",") + "\r\n";
    }
    csv += "\r\n";
  }
  return textResponse(csv, "text/csv", safeFilename(`Race ${rid} - Lap time records.csv`));
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

    this.sessionRaceId = null;
    this.sessionStartedAt = null;
    this.fullHydrated = new Set();

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

    this.detailRunning =
      new Set();

    this.lastDetailFetch =
      new Map();

    this.detailQueue = [];
    this.detailQueued = new Set();


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


        this.sessionRaceId =
          Number(await state.storage.get("sessionRaceId")) || null;

        this.sessionStartedAt =
          await state.storage.get("sessionStartedAt") || null;

        this.fullHydrated =
          new Set(await state.storage.get("fullHydrated") || []);


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


  currentRaceId() {
    return Number(this.sessionRaceId) > 0
      ? Number(this.sessionRaceId)
      : Number(this.rid);
  }

  async beginNewSession() {
    this.sessionRaceId = newSessionRaceId();
    this.sessionStartedAt = new Date().toISOString();
    this.pitCounts = new Map();
    this.lapCounts = new Map();
    this.bestLaps = new Map();
    this.lastLaps = new Map();
    this.fullHydrated = new Set();
    this.lastDetailFetch = new Map();
    this.detailQueue = [];
    this.detailQueued = new Set();
    await this.persist();
  }

  async persist() {
    await this.state.storage.put({
      packetCount:
        this.packetCount,

      lastPacketAt:
        this.lastPacketAt,

      lastGridAt:
        this.lastGridAt,

      sessionRaceId:
        this.sessionRaceId,

      sessionStartedAt:
        this.sessionStartedAt,

      fullHydrated:
        [...this.fullHydrated],

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
        this.currentRaceId(),

      session_started_at:
        this.sessionStartedAt,

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
      this.queueAllDetails(false);

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

      this.queueAllDetails(true);

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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      try { await this.connect(); } catch {}
    }

    await this.processDetailQueue();

    await this.state.storage.setAlarm(
      Date.now() + (this.detailQueue.length ? 1000 : 60000)
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
            `eq.${this.currentRaceId()}`,

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
          this.currentRaceId(),

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


  enqueueDetail(apexId, force = false) {
    const id = String(apexId);
    if (!validApexId(id)) return;
    if (force) this.fullHydrated.delete(id);
    if (this.detailQueued.has(id)) return;
    this.detailQueued.add(id);
    this.detailQueue.push(id);
  }

  queueAllDetails(force = false) {
    for (const id of this.fieldApexIds) this.enqueueDetail(id, force);
    if (this.detailQueue.length) {
      this.state.storage.setAlarm(Date.now() + 250).catch(() => {});
    }
  }

  async processDetailQueue() {
    if (!this.detailQueue.length) return;
    const batch = [];
    while (batch.length < 4 && this.detailQueue.length) {
      const id = this.detailQueue.shift();
      this.detailQueued.delete(id);
      if (id) batch.push(id);
    }
    await Promise.all(batch.map(id => this.refreshDetail(id, false).catch(error => {
      console.error(`DETAIL REFRESH ${id}:`, error);
      this.enqueueDetail(id, false);
    })));
  }

  async refreshDetail(apexId, force = false) {
    const id = String(apexId);
    if (this.fieldApexIds.size > 0 && !this.fieldApexIds.has(id)) return;
    if (this.detailRunning.has(id)) return;

    const now = Date.now();
    if (!force && now - (this.lastDetailFetch.get(id) || 0) < 5000) return;

    const entry = await this.getEntry(id);
    const snapshotLap = Number(this.lapCounts.get(id));
    const lapCount = Number.isFinite(snapshotLap) ? snapshotLap : Number(entry?.lap_count);
    if (!entry || !Number.isFinite(lapCount) || lapCount <= 0) return;

    this.lastDetailFetch.set(id, now);
    this.detailRunning.add(id);
    try {
      const activeRid = this.currentRaceId();
      const raw = await this.requestDetail(id, lapCount);
      const laps = parseLapRows(raw, activeRid).filter(row => String(row.apex_id) === id);
      const pits = parsePitRows(raw, entry.team_name, activeRid)
        .filter(row => String(row.apex_id) === id && Number(row.pit_number) > 0);
      const maxLap = laps.reduce((m, row) => Math.max(m, Number(row.lap_number) || 0), 0);

      if (!laps.length || maxLap < Math.max(1, lapCount - 2)) {
        throw new Error(`Incomplete Apex detail ${id}: ${laps.length} laps, max ${maxLap}, expected ${lapCount}`);
      }

      const needsFull = force || !this.fullHydrated.has(id);
      const lapRows = needsFull
        ? laps
        : laps.filter(row => Number(row.lap_number) >= Math.max(1, lapCount - 8));

      for (let i = 0; i < lapRows.length; i += 250) {
        await sbUpsert(this.env, "apex_lap_events", lapRows.slice(i, i + 250), "race_id,apex_id,lap_number");
      }

      if (pits.length) {
        await sbUpsert(this.env, "apex_pit_stints", pits, "race_id,apex_id,pit_number");
      }

      if (needsFull) this.fullHydrated.add(id);
      await this.persist();
    } finally {
      this.detailRunning.delete(id);
    }
  }

  async refreshAllFieldDetails(force = false) {
    const now=Date.now();
    if(this.fullDetailRefreshRunning)return;
    if(!force && now-this.lastFullDetailRefreshAt<120000)return;
    const ids=[...this.fieldApexIds].map(String).filter(validApexId);
    if(!ids.length)return;
    this.fullDetailRefreshRunning=true;
    this.lastFullDetailRefreshAt=now;
    try {
      for(let i=0;i<ids.length;i+=4){
        const batch=ids.slice(i,i+4);
        await Promise.all(batch.map(id=>this.refreshDetail(id,force).catch(e=>console.error(`DETAIL REFRESH ${id}:`,e))));
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
      const p=parseNumber(value);if(p!==null&&p>=0)this.pitCounts.set(id,Math.trunc(p));return;
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
        this.lapCounts.set(id,Math.trunc(n));
        await this.upsertEntry(id,{lap_count:Math.trunc(n)});
        this.enqueueDetail(id, false);
        this.state.storage.setAlarm(Date.now() + 250).catch(() => {});
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

          // On the first grid after this version, move the live race away from
          // the legacy shared race_id=1.  Later, a real lap-count reset starts
          // another unique race_id.  Previous rows are never deleted.
          if (!this.sessionRaceId || this.sessionRaceId === this.rid || newSession) {
            await this.beginNewSession();
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
          this.queueAllDetails(false);
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
    this.packetCount +=
      1;


    this.lastPacketAt =
      new Date()
        .toISOString();

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
        const snapshot = await collectorSnapshot(env).catch(() => null);
        const currentRid = Number(snapshot?.race_id) || raceId(env);
        return json({
          current_race_id: currentRid,
          rows: await racesPayload(env, currentRid)
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


        return json(
          await livePayload(
            env
          )
        );
      }


      if (
        url.pathname ===
        "/api/overview"
      ) {
        const payload =
          await livePayload(
            env,
            url.searchParams.has("race_id") ? rid : null
          );


        return json({
          race_id:
            payload.race_id,

          rows:
            payload.current
        });
      }


      if (
        url.pathname ===
        "/api/datasets"
      ) {
        const snapshot = await collectorSnapshot(env).catch(() => null);
        const dataRid = url.searchParams.has("race_id")
          ? rid
          : (Number(snapshot?.race_id) || rid);
        return json(await datasetsPayload(env, dataRid, snapshot));
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
          "/api/reports/lap-time-records-page" ||
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


        const dataRid = url.searchParams.has("race_id")
          ? rid
          : (Number(snapshot?.race_id) || rid);

        const snapshotForRace = Number(snapshot?.race_id) === Number(dataRid)
          ? snapshot
          : null;

        const historicalEntries = snapshotForRace
          ? null
          : await loadEntries(env, dataRid).catch(() => []);

        const fieldIds = snapshotForRace
          ? currentFieldIds(snapshotForRace)
          : idsFromEntries(historicalEntries);


        if (
          url.pathname ===
          "/api/stints"
        ) {
          const rows =
            await stintsPayload(
              env,
              dataRid,
              snapshotForRace
            );


          return json({
            race_id:
              dataRid,

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
              dataRid,
              snapshotForRace
            );


          const rows =
            driversFromStints(
              stints
            );


          return json({
            race_id:
              dataRid,

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
              dataRid,
              snapshotForRace
            );


          const drivers =
            driversFromStints(
              stints
            );


          let rows =
            teamsFromDrivers(
              drivers,
              snapshotForRace
            );


          const entries =
            filterCurrentField(
              await loadEntries(
                env,
                dataRid
              ),
              fieldIds
            );


          const teamMap =
            await stableTeamNameMap(
              env,
              dataRid
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
                snapshotForRace
                  ?.positions?.[
                    id
                  ]
              );


            rows.push({
              race_id:
                dataRid,

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
              dataRid,

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
                dataRid
              ),
              fieldIds
            );


          const teamMap =
            await stableTeamNameMap(
              env,
              dataRid
            );


          return json({
            race_id:
              dataRid,

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
                dataRid,

              rows:
                await eventsPayload(
                  env,
                  dataRid,
                  snapshotForRace
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
                  dataRid,

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
                  `eq.${dataRid}`,

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
          "/api/reports/lap-time-records-page"
        ) {
          return json(
            await lapRecordsPagePayload(
              env,
              dataRid,
              url.searchParams.get("offset"),
              url.searchParams.get("limit")
            )
          );
        }

        if (
          url.pathname ===
          "/api/reports/lap-time-records.csv"
        ) {
          return await createLapRecordsCsvResponse(
            env,
            dataRid
          );
        }


        if (
          url.pathname ===
          "/api/reports/pit-stops.html"
        ) {
          const stints =
            await stintsPayload(
              env,
              dataRid,
              snapshotForRace
            );


          return textResponse(
            buildPitReportHtml(
              dataRid,
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
