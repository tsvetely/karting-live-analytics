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
  const text = String(value ?? "").trim();

  if (!/^\d+$/.test(text)) {
    return false;
  }

  return Number(text) > 0;
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
    if (validApexId(value)) {
      result.add(
        String(value).trim()
      );
    }
  }


  /*
   * Compatibility with collector state created before
   * fieldApexIds existed.
   *
   * Apex/protocol row 0 is not a competitor and must never
   * become an extra team.
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
      if (validApexId(value)) {
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
          row.apex_id ??
          ""
        ).trim();

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
  teamMap,
  sessionIsLive
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
          end,

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
          "COMPLETED",

        _fallback:
          true
      });


      previous =
        end;
    }


    /*
     * Final stint.  Apex pit_lap is the completed lap BEFORE
     * the long pit-transition lap.  Therefore the final stint
     * starts at the last pit boundary and its first recorded
     * lap (start + 1) is excluded analytically.
     */
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
          sessionIsLive
            ? null
            : currentLap,

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
          sessionIsLive,

        status:
          sessionIsLive
            ? "LIVE"
            : "COMPLETED",

        _fallback:
          true
      });
    }
  }


  return result;
}


function sessionCurrentlyLive(
  snapshot
) {
  const lastPacket =
    Date.parse(
      snapshot
        ?.last_packet_at ||
      ""
    );


  return (
    Number.isFinite(
      lastPacket
    ) &&
    Date.now() -
      lastPacket <
      180000
  );
}


async function loadLapEventsForApexIds(
  env,
  rid,
  apexIds,
  minimumLap
) {
  const ids =
    [
      ...new Set(
        apexIds
          .map(
            value =>
              String(value).trim()
          )
          .filter(validApexId)
      )
    ];


  if (!ids.length) {
    return [];
  }


  const params = {
    select:
      "apex_id,lap_number,lap_time",

    race_id:
      `eq.${rid}`,

    apex_id:
      `in.(${ids.join(",")})`,

    order:
      "apex_id.asc,lap_number.asc"
  };


  if (
    Number.isFinite(
      Number(minimumLap)
    )
  ) {
    params.lap_number =
      `gte.${Math.max(
        1,
        Math.trunc(
          Number(minimumLap)
        )
      )}`;
  }


  return sbGetAll(
    env,
    "apex_lap_events",
    params
  );
}


function exclusionKey(
  apexId,
  lapNumber
) {
  return (
    `${String(apexId)}:` +
    `${Math.trunc(Number(lapNumber))}`
  );
}


function fallbackLapIsValid(
  stint,
  lapNumber,
  excluded
) {
  const lap =
    Number(lapNumber);


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


  /*
   * A stint with boundaries 491 -> 546 contains race laps
   * 492..546.  Apex's long pit-transition lap is 492, i.e.
   * the first lap AFTER the previous pit boundary.
   *
   * The end boundary itself (546) is a normal completed lap;
   * the next lap (547) belongs to the next stint and is the
   * transition lap.  Therefore DO NOT remove end_lap_count.
   */
  if (
    lap <= start ||
    lap > end
  ) {
    return false;
  }


  if (
    start > 0 &&
    lap === start + 1
  ) {
    return false;
  }


  if (
    excluded.has(
      exclusionKey(
        stint.apex_id,
        lap
      )
    )
  ) {
    return false;
  }


  return true;
}


function calculateFallbackStats(
  stint,
  laps,
  excluded
) {
  const valid = [];


  for (
    const row
    of laps
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
      lapTime <= 0
    ) {
      continue;
    }


    if (
      !fallbackLapIsValid(
        stint,
        lapNumber,
        excluded
      )
    ) {
      continue;
    }


    valid.push({
      lap_number:
        Math.trunc(
          lapNumber
        ),

      lap_time:
        lapTime
    });
  }


  if (!valid.length) {
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


  let total = 0;

  let best =
    valid[0];

  let worst =
    valid[0];


  for (
    const row
    of valid
  ) {
    total +=
      row.lap_time;


    if (
      row.lap_time <
      best.lap_time
    ) {
      best = row;
    }


    if (
      row.lap_time >
      worst.lap_time
    ) {
      worst = row;
    }
  }


  const average =
    total /
    valid.length;


  let varianceTotal =
    0;


  for (
    const row
    of valid
  ) {
    const difference =
      row.lap_time -
      average;


    varianceTotal +=
      difference *
      difference;
  }


  const consistency =
    Math.sqrt(
      varianceTotal /
      valid.length
    );


  return {
    valid_laps:
      valid.length,

    avg_lap_time:
      average,

    best_lap_time:
      best.lap_time,

    best_lap_number:
      best.lap_number,

    worst_lap_time:
      worst.lap_time,

    worst_lap_number:
      worst.lap_number,

    consistency
  };
}


async function hydrateFallbackAnalytics(
  env,
  rid,
  rows,
  exclusions
) {
  const fallbackRows =
    rows.filter(
      row =>
        row._fallback ===
        true
    );


  if (!fallbackRows.length) {
    return;
  }


  const excluded =
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


    const lapNumber =
      Number(
        row.lap_number
      );


    if (
      !validApexId(
        apexId
      ) ||
      !Number.isFinite(
        lapNumber
      )
    ) {
      continue;
    }


    excluded.add(
      exclusionKey(
        apexId,
        lapNumber
      )
    );
  }


  const ids =
    [
      ...new Set(
        fallbackRows
          .map(
            row =>
              String(
                row.apex_id
              )
          )
          .filter(
            validApexId
          )
      )
    ];


  let minimumLap =
    Infinity;


  for (
    const row
    of fallbackRows
  ) {
    const start =
      Number(
        row.start_lap_count
      );


    if (
      Number.isFinite(start)
    ) {
      minimumLap =
        Math.min(
          minimumLap,
          Math.max(
            1,
            Math.trunc(start)
          )
        );
    }
  }


  const laps =
    await loadLapEventsForApexIds(
      env,
      rid,
      ids,
      Number.isFinite(
        minimumLap
      )
        ? minimumLap
        : 1
    )
      .catch(
        () => []
      );


  const lapsById =
    new Map();


  for (
    const row
    of laps
  ) {
    const id =
      String(
        row.apex_id ??
        ""
      );


    if (
      !validApexId(id)
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
    of fallbackRows
  ) {
    const stats =
      calculateFallbackStats(
        row,
        lapsById.get(
          String(
            row.apex_id
          )
        ) ||
        [],
        excluded
      );


    row.valid_laps =
      stats.valid_laps;

    row.avg_lap_time =
      stats.avg_lap_time;

    row.best_lap_time =
      stats.best_lap_time;

    row.best_lap_number =
      stats.best_lap_number;

    row.worst_lap_time =
      stats.worst_lap_time;

    row.worst_lap_number =
      stats.worst_lap_number;

    row.consistency =
      stats.consistency;
  }
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
          connected:
            false,

          last_packet_at:
            null,

          fieldApexIds:
            [],

          positions:
            {}
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
    exclusions,
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

      loadExclusions(
        env,
        rid
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


  const currentExclusions =
    filterCurrentField(
      exclusions,
      fieldIds
    );


  const sessionIsLive =
    sessionCurrentlyLive(
      liveSnapshot
    );


  /*
   * Pit history is the authoritative stint-boundary chain.
   * It gives us every completed stint even if the old
   * completed_stint_stats view stopped producing rows.
   */
  const fallback =
    fallbackStintsFromPits(
      currentPits,
      currentEntries,
      teamMap,
      sessionIsLive
    );


  const rowsByKey =
    new Map();


  /*
   * Start with the pit-defined chain.
   */
  for (
    const row
    of fallback
  ) {
    const key =
      `${row.apex_id}:` +
      `${row.start_lap_count}`;


    rowsByKey.set(
      key,
      row
    );
  }


  /*
   * completed_stint_stats enriches an EXACT matching boundary.
   *
   * We deliberately keep the boundary from Apex pit history
   * rather than allowing an old statistics row to replace it
   * with stale start/end values.
   */
  for (
    const source
    of currentCompleted
  ) {
    const normalized =
      normalizeStintRow(
        source,
        teamMap,
        "COMPLETED"
      );


    const key =
      `${normalized.apex_id}:` +
      `${normalized.start_lap_count}`;


    const fallbackRow =
      rowsByKey.get(key);


    if (fallbackRow) {
      rowsByKey.set(
        key,
        {
          ...fallbackRow,

          driver_name:
            normalized.driver_name ||
            fallbackRow.driver_name,

          valid_laps:
            normalized.valid_laps,

          avg_lap_time:
            normalized.avg_lap_time,

          best_lap_time:
            normalized.best_lap_time,

          best_lap_number:
            normalized.best_lap_number,

          worst_lap_time:
            normalized.worst_lap_time,

          worst_lap_number:
            normalized.worst_lap_number,

          consistency:
            normalized.consistency,

          _fallback:
            false
        }
      );


      continue;
    }


    /*
     * Keep completed statistics that do not have a pit row.
     * This covers old sessions or teams where pit history was
     * incomplete.
     */
    rowsByKey.set(
      key,
      {
        ...normalized,

        _fallback:
          false
      }
    );
  }


  /*
   * Determine the latest authoritative pit boundary per kart.
   * A stored live_stint_stats row starting BEFORE this boundary
   * is stale and must not be shown.
   */
  const maxPitByTeam =
    new Map();


  for (
    const pit
    of currentPits
  ) {
    const id =
      String(
        pit.apex_id
      );


    const lap =
      Number(
        pit.pit_lap
      );


    if (
      !validApexId(id) ||
      !Number.isFinite(lap)
    ) {
      continue;
    }


    maxPitByTeam.set(
      id,
      Math.max(
        maxPitByTeam.get(id) ||
        0,
        lap
      )
    );
  }


  for (
    const source
    of currentLive
  ) {
    const normalized =
      normalizeStintRow(
        source,
        teamMap,
        "LIVE"
      );


    const id =
      String(
        normalized.apex_id
      );


    const start =
      Number(
        normalized.start_lap_count
      ) ||
      0;


    const maxPit =
      maxPitByTeam.get(id) ||
      0;


    /*
     * Example:
     *
     * pit history already reaches lap 639 but an old live row
     * says 491 -> LIVE.  That row is stale and is rejected.
     */
    if (
      start < maxPit
    ) {
      continue;
    }


    /*
     * Once timing is no longer live, do not keep an old LIVE
     * row merely because it remains in the table.
     */
    if (!sessionIsLive) {
      continue;
    }


    const key =
      `${id}:${start}`;


    const existing =
      rowsByKey.get(key);


    if (
      existing &&
      existing.is_live
    ) {
      rowsByKey.set(
        key,
        {
          ...existing,

          driver_name:
            normalized.driver_name ||
            existing.driver_name,

          valid_laps:
            normalized.valid_laps,

          avg_lap_time:
            normalized.avg_lap_time,

          best_lap_time:
            normalized.best_lap_time,

          best_lap_number:
            normalized.best_lap_number,

          worst_lap_time:
            normalized.worst_lap_time,

          worst_lap_number:
            normalized.worst_lap_number,

          consistency:
            normalized.consistency,

          current_lap_count:
            normalized.current_lap_count ??
            existing.current_lap_count,

          total_laps:
            normalized.total_laps ??
            existing.total_laps,

          _fallback:
            false
        }
      );
    } else if (!existing) {
      rowsByKey.set(
        key,
        {
          ...normalized,

          _fallback:
            false
        }
      );
    }
  }


  const rows =
    [
      ...rowsByKey.values()
    ];


  /*
   * Calculate analytics only for rows that still depend on the
   * pit fallback.  The raw lap query is scoped to the affected
   * Apex IDs and to the minimum missing lap range.
   */
  await hydrateFallbackAnalytics(
    env,
    rid,
    rows,
    currentExclusions
  );


  for (
    const row
    of rows
  ) {
    delete row._fallback;
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


      const idA =
        Number(
          a.apex_id
        );


      const idB =
        Number(
          b.apex_id
        );


      if (
        Number.isFinite(idA) &&
        Number.isFinite(idB) &&
        idA !== idB
      ) {
        return (
          idA -
          idB
        );
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
          fieldApexIds:
            [],

          positions:
            {}
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
          fieldApexIds:
            [],

          positions:
            {}
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


  /*
   * The raw table can contain an old duplicate row left from
   * previous collector versions.
   *
   * For the UI/report count we keep exactly one pit record per:
   *
   *   race_id + apex_id + pit_number
   *
   * If duplicate rows exist, keep the newest one.
   */
  const unique =
    new Map();


  for (
    const row
    of current
  ) {
    if (
      !validApexId(
        row.apex_id
      )
    ) {
      continue;
    }


    const pitNumber =
      Number(
        row.pit_number
      );


    if (
      !Number.isFinite(
        pitNumber
      )
    ) {
      continue;
    }


    const key =
      `${String(
        row.apex_id
      )}:${Math.trunc(
        pitNumber
      )}`;


    const existing =
      unique.get(key);


    if (!existing) {
      unique.set(
        key,
        row
      );

      continue;
    }


    const currentUpdated =
      Date.parse(
        row.updated_at ||
        ""
      );


    const existingUpdated =
      Date.parse(
        existing.updated_at ||
        ""
      );


    if (
      Number.isFinite(
        currentUpdated
      ) &&
      (
        !Number.isFinite(
          existingUpdated
        ) ||
        currentUpdated >
        existingUpdated
      )
    ) {
      unique.set(
        key,
        row
      );
    }
  }


  const rows =
    [
      ...unique.values()
    ]
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
        ""
      );


    const existingTime =
      Date.parse(
        existing.updated_at ||
        existing.received_at ||
        ""
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
  let best =
    null;


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
      !Number.isFinite(
        value
      ) ||
      value <= 0
    ) {
      continue;
    }


    if (
      best === null ||
      value < best
    ) {
      best =
        value;
    }
  }


  return best;
}


function raceLapFromEntries(
  entries
) {
  let maximum =
    0;


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
      Number.isFinite(
        value
      ) &&
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
    pitsData,
    snapshot,
    teamMap
  ] =
    await Promise.all([
      loadEntries(
        env,
        rid
      )
        .catch(
          () => []
        ),

      pitsPayload(
        env,
        rid
      )
        .catch(
          () => ({
            count:
              0,

            rows:
              []
          })
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
        Number(
          rid
        ),

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

      pit_count:
        0,

      race_lap:
        0,

      best_lap:
        null,

      current:
        []
    };
  }


  const entries =
    filterCurrentField(
      entriesRaw,
      fieldIds
    );


  const newestEntries =
    newestEntriesByApex(
      entries
    );


  /*
   * IMPORTANT:
   *
   * Overview uses the SAME stint dataset as the Stints tab.
   * It must not separately trust stale live_stint_stats.
   *
   * This fixes the situation where:
   *
   *   Stints tab = correct historical chain
   *   Overview   = old "639 -> LIVE"
   */
  const stintData =
    await stintsPayload(
      env,
      rid,
      snapshot
    );


  const latestStintByApex =
    new Map();


  for (
    const stint
    of stintData.rows
  ) {
    const id =
      String(
        stint.apex_id
      );


    const existing =
      latestStintByApex.get(
        id
      );


    if (!existing) {
      latestStintByApex.set(
        id,
        stint
      );

      continue;
    }


    const existingNumber =
      Number(
        existing.stint_number
      ) ||
      0;


    const nextNumber =
      Number(
        stint.stint_number
      ) ||
      0;


    if (
      nextNumber >
      existingNumber
    ) {
      latestStintByApex.set(
        id,
        stint
      );
    }
  }


  const pitCountByApex =
    new Map();


  for (
    const pit
    of pitsData.rows
  ) {
    const id =
      String(
        pit.apex_id
      );


    pitCountByApex.set(
      id,
      (
        pitCountByApex.get(
          id
        ) ||
        0
      ) +
      1
    );
  }


  const current = [];


  for (
    const id
    of fieldIds
  ) {
    const entry =
      newestEntries.get(
        id
      );


    if (!entry) {
      continue;
    }


    const stint =
      latestStintByApex.get(
        id
      ) ||
      null;


    const position =
      Number(
        snapshot
          ?.positions?.[
            id
          ]
      );


    const raceLap =
      Number(
        entry.lap_count
      ) ||
      0;


    const startLap =
      Number(
        stint
          ?.start_lap_count
      );


    const stintLaps =
      stint
        ? (
            Number(
              stint.total_laps
            ) ||
            Math.max(
              0,
              raceLap -
              (
                Number.isFinite(
                  startLap
                )
                  ? startLap
                  : 0
              )
            )
          )
        : 0;


    current.push({
      race_id:
        Number(
          rid
        ),

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
          stint?.team_name
        ),

      driver_name:
        stint?.driver_name ||
        entry.current_driver ||
        null,

      current_driver:
        stint?.driver_name ||
        entry.current_driver ||
        null,

      race_lap:
        raceLap,

      live_lap_count:
        raceLap,

      pit_count:
        pitCountByApex.get(
          id
        ) ||
        0,

      stint_number:
        number(
          stint?.stint_number
        ) ||
        (
          (
            pitCountByApex.get(
              id
            ) ||
            0
          ) +
          1
        ),

      start_lap_count:
        number(
          stint
            ?.start_lap_count
        ) ||
        0,

      stint_laps:
        stintLaps,

      total_stint_laps:
        stintLaps,

      valid_laps:
        number(
          stint?.valid_laps
        ) ||
        0,

      live_last_lap:
        number(
          entry.last_lap
        ),

      avg_lap_time:
        number(
          stint?.avg_lap_time
        ),

      best_lap_time:
        number(
          stint?.best_lap_time ??
          entry.best_lap
        ),

      best_lap_number:
        number(
          stint
            ?.best_lap_number
        ),

      worst_lap_time:
        number(
          stint
            ?.worst_lap_time
        ),

      worst_lap_number:
        number(
          stint
            ?.worst_lap_number
        ),

      consistency:
        number(
          stint?.consistency
        ),

      updated_at:
        entry.updated_at ||
        null
    });
  }


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
        Number.isFinite(
          pa
        ) &&
        Number.isFinite(
          pb
        ) &&
        pa !== pb
      ) {
        return pa - pb;
      }


      if (
        Number.isFinite(
          pa
        )
      ) {
        return -1;
      }


      if (
        Number.isFinite(
          pb
        )
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


  const isLive =
    sessionCurrentlyLive(
      snapshot
    );


  return {
    race_id:
      Number(
        rid
      ),

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

    race_lap:
      raceLapFromEntries(
        [
          ...newestEntries
            .values()
        ]
      ),

    pit_count:
      pitsData.count,

    best_lap:
      bestLapFromEntries(
        [
          ...newestEntries
            .values()
        ]
      ),

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

async function racesPayload(
  env
) {
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
      !Number.isFinite(
        id
      )
    ) {
      continue;
    }


    const timestamp =
      Date.parse(
        row.updated_at ||
        ""
      );


    const previous =
      races.get(
        id
      );


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
  /*
   * We deliberately use the light apex_entries table.
   * No expensive driver aggregate view.
   */
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
               * RAW APEX-STYLE REPORT:
               * no analytical exclusions are applied here.
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


              processPage(page);


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
<td>${escapeHtml(
  Number.isFinite(
    Number(
      row.consistency
    )
  )
    ? Number(
        row.consistency
      ).toFixed(3)
    : ""
)}</td>
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
Race ${escapeHtml(rid)} - Stints & Pit Stops
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

  margin-bottom:
    15px;
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

  cursor:
    pointer;
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
Race ${escapeHtml(rid)} - Stints & Pit Stops
</h1>

${content}

</body>

</html>
`;
}


// ============================================================
// PIT REPORT RESPONSE
// ============================================================

async function pitReportResponse(
  env,
  rid,
  snapshot = null
) {
  const stintData =
    await stintsPayload(
      env,
      rid,
      snapshot
    );


  const html =
    buildPitReportHtml(
      rid,
      stintData.rows
    );


  return new Response(
    html,
    {
      status:
        200,

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
// MANUAL EXCLUSIONS
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
// BODY / CORS
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
    "/api/health"
  ) {
    const snapshot =
      await collectorSnapshot(
        env
      )
        .catch(
          () => null
        );


    return json({
      ok:
        true,

      service:
        "race-engineer",

      version:
        VERSION,

      race_id:
        rid,

      collector_connected:
        snapshot?.connected ===
        true,

      field_count:
        currentFieldIds(
          snapshot
        ).size,

      now:
        new Date()
          .toISOString()
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
      "/api/collector/status" ||
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
    "/api/overview"
  ) {
    const result =
      await livePayload(
        env,
        rid
      );


    return json({
      race_id:
        rid,

      version:
        VERSION,

      active:
        result.active,

      data_available:
        result.data_available,

      is_live:
        result.is_live,

      session_status:
        result.session_status,

      team_count:
        result.team_count,

      pit_count:
        result.pit_count,

      race_lap:
        result.race_lap,

      best_lap:
        result.best_lap,

      rows:
        result.current
    });
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


    const rows =
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
        rows.length,

      rows
    });
  }


  if (
    pathname ===
    "/api/races"
  ) {
    const rows =
      await racesPayload(
        env
      );


    return json({
      current_race_id:
        raceId(
          env
        ),

      version:
        VERSION,

      count:
        rows.length,

      rows
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
        pathname,

      version:
        VERSION
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

    this.rid =
      raceId(
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
            (
              await state.storage.get(
                "fieldApexIds"
              ) ||
              []
            )
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


        this.pitCounts =
          new Map(
            Object.entries(
              await state.storage.get(
                "pitCounts"
              ) ||
              {}
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
          );


        /*
         * Clean old r0/APEX 0 state immediately.
         */
        this.positions.delete(
          "0"
        );

        this.fieldApexIds.delete(
          "0"
        );

        this.pitCounts.delete(
          "0"
        );


        if (
          this.fieldApexIds.size === 0 &&
          this.positions.size > 0
        ) {
          this.fieldApexIds =
            new Set(
              [
                ...this.positions.keys()
              ]
                .filter(
                  validApexId
                )
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
    /*
     * Persist only valid racing IDs.
     * This also permanently removes an old APEX 0 from the DO.
     */
    const positions =
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
      );


    const fieldApexIds =
      [
        ...this.fieldApexIds
      ]
        .filter(
          validApexId
        );


    const pitCounts =
      Object.fromEntries(
        [
          ...this.pitCounts
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


    await this.state.storage.put({
      packetCount:
        this.packetCount,

      lastPacketAt:
        this.lastPacketAt,

      lastGridAt:
        this.lastGridAt,

      positions,

      columnTypes:
        Object.fromEntries(
          this.columnTypes
        ),

      fieldApexIds,

      pitCounts
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
        [
          ...this.fieldApexIds
        ]
          .filter(
            validApexId
          )
          .length,

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

      columnTypes:
        Object.fromEntries(
          this.columnTypes
        ),

      pitCounts:
        Object.fromEntries(
          [
            ...this.pitCounts
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
          /*
           * THIS IS THE CURRENT RACE FIELD.
           * REPLACE, NEVER MERGE WITH HISTORY.
           */
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


      if (
        !row ||
        !validApexId(
          row.apexId
        )
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


    /*
     * Raw packet logging must never stop the actual collector.
     */
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
                "application/json"
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
            raceId(env),

          rows:
            await racesPayload(
              env
            )
        });
      }


      // ========================================================
      // LIVE / OVERVIEW
      // ========================================================

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


      if (
        url.pathname ===
        "/api/overview"
      ) {
        const payload =
          await livePayload(
            env,
            rid
          );


        return json({
          race_id:
            rid,

          rows:
            payload.current
        });
      }


      // ========================================================
      // SHARED SNAPSHOT FOR ANALYTICAL ENDPOINTS
      // ========================================================

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


        // ======================================================
        // STINTS
        // ======================================================

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


        // ======================================================
        // DRIVERS
        // ======================================================

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


        // ======================================================
        // TEAMS
        // ======================================================

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
            teamsFromDrivers(
              drivers,
              snapshot
            );


          /*
           * IMPORTANT:
           * Even if a team somehow has no persisted stint row,
           * it still belongs to the race and must exist in TEAMS.
           */
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


        // ======================================================
        // PITS
        // ======================================================

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


        // ======================================================
        // EVENTS
        // ======================================================

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


        // ======================================================
        // LAP RECORDS CSV
        // ======================================================

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


        // ======================================================
        // PIT / STINT REPORT
        // ======================================================

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


      // ========================================================
      // ASSETS
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
