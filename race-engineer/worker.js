const VERSION =
  "2026-08-30-race-datasets-v6.7-current-grid-authoritative-rehydrate";

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
  const realSnapshot = snapshot || await collectorSnapshot(env).catch(() => null);
  const fieldIds = currentFieldIds(realSnapshot);
  if (!fieldIds.size) return [];

  const [pitsRaw, entriesRaw, exclusionsRaw, lapRaw, teamMap] = await Promise.all([
    loadPits(env, rid),
    loadEntries(env, rid),
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
// LIVE OVERVIEW
// ============================================================

async function livePayload(env, rid) {
  const [entriesRaw, snapshot, teamMap] = await Promise.all([
    loadEntries(env, rid), collectorSnapshot(env).catch(() => null), stableTeamNameMap(env, rid)
  ]);
  const fieldIds=currentFieldIds(snapshot);
  if (!fieldIds.size) return {
    race_id:Number(rid), session_name:"Apex Timing", active:false, data_available:false,
    is_live:false, session_status:"WAITING FOR APEX GRID", team_count:0, race_lap:0, pit_count:0, best_lap:null, current:[]
  };

  const entries=filterCurrentField(entriesRaw,fieldIds);
  const entryById=new Map(entries.map(r=>[String(r.apex_id),r]));
  const stints=await stintsPayload(env,rid,snapshot);
  const liveById=new Map(stints.filter(r=>r.is_live).map(r=>[String(r.apex_id),r]));
  const current=[];
  let raceLap=0,pitTotal=0,raceBest=null;

  for (const value of fieldIds) {
    const id=String(value), entry=entryById.get(id)||{}, live=liveById.get(id)||{};
    const sl=Number(snapshot?.lapCounts?.[id]);
    const lap=Number.isFinite(sl)?sl:(Number(entry.lap_count)||0);
    raceLap=Math.max(raceLap,lap);
    const sp=Number(snapshot?.pitCounts?.[id]);
    const pitCount=Number.isFinite(sp)?Math.max(0,Math.trunc(sp)):Math.max(0,(Number(live.stint_number)||1)-1);
    pitTotal+=pitCount;
    const sb=Number(snapshot?.bestLaps?.[id]);
    const eb=number(entry.best_lap);
    const best=Number.isFinite(sb)&&sb>0?sb:eb;
    if (Number.isFinite(best)&&best>0&&(raceBest===null||best<raceBest)) raceBest=best;
    const pos=Number(snapshot?.positions?.[id]);

    current.push({
      race_id:Number(rid),apex_id:id,position:Number.isFinite(pos)?pos:null,
      team_name:resolveTeam(id,teamMap,entry.team_name,live.team_name),
      driver_name:live.driver_name||entry.current_driver||null,current_driver:live.driver_name||entry.current_driver||null,
      race_lap:lap,live_lap_count:lap,pit_count:pitCount,
      stint_number:number(live.stint_number)||pitCount+1,start_lap_count:number(live.start_lap_count)||0,
      stint_laps:number(live.total_laps)||0,total_stint_laps:number(live.total_laps)||0,
      valid_laps:number(live.valid_laps)||0,live_last_lap:number(entry.last_lap),
      avg_lap_time:number(live.avg_lap_time),best_lap_time:number(live.best_lap_time)||best,
      best_lap_number:number(live.best_lap_number),worst_lap_time:number(live.worst_lap_time),
      worst_lap_number:number(live.worst_lap_number),consistency:number(live.consistency),updated_at:entry.updated_at||null
    });
  }
  current.sort((a,b)=>{
    if(Number.isFinite(a.position)&&Number.isFinite(b.position)&&a.position!==b.position)return a.position-b.position;
    if(Number.isFinite(a.position))return -1;if(Number.isFinite(b.position))return 1;return b.race_lap-a.race_lap;
  });
  const lastPacket=Date.parse(snapshot?.last_packet_at||"");
  const isLive=Number.isFinite(lastPacket)&&Date.now()-lastPacket<180000;
  return {race_id:Number(rid),session_name:"Apex Timing",active:current.length>0,data_available:current.length>0,
    is_live:isLive,session_status:isLive?"LIVE":"FINISHED",collector_connected:snapshot?.connected===true,
    team_count:current.length,race_lap:raceLap,pit_count:pitTotal,best_lap:raceBest,current};
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


  const numericIds =
    [
      ...fieldIds
    ]
      .filter(
        validApexId
      )
      .map(
        value =>
          String(
            Number(value)
          )
      );


  if (
    numericIds.length === 0
  ) {
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
    `in.(${numericIds.join(",")})`;


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
    firstPage.length === 0
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
                )
                  .trim();


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


          while (
            firstPage.length ===
            PAGE_SIZE
          ) {
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


          write("\r\n");

          controller.close();

        } catch (error) {
          console.error(
            "CSV STREAM ERROR",
            error
          );

          controller.error(error);
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
      lastLaps: Object.fromEntries(this.lastLaps),

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
      this.state.waitUntil(this.refreshAllFieldDetails(false));

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

      // race_id=1 is reused. Once a complete CURRENT detail response is in hand,
      // replace this kart's contaminated raw history with the current session.
      await sbDelete(this.env,"apex_lap_events",{race_id:`eq.${this.rid}`,apex_id:`eq.${id}`});
      for(let i=0;i<laps.length;i+=250){
        await sbUpsert(this.env,"apex_lap_events",laps.slice(i,i+250),"race_id,apex_id,lap_number");
      }

      await sbDelete(this.env,"apex_pit_stints",{race_id:`eq.${this.rid}`,apex_id:`eq.${id}`});
      if(pits.length) await sbUpsert(this.env,"apex_pit_stints",pits,"race_id,apex_id,pit_number");

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
      const p=parseNumber(value);if(p!==null&&p>=0)this.pitCounts.set(id,Math.trunc(p));return;
    }
    if(t==="llp"||c==="llp"||col==="9"){
      const v=parseLapTime(value);if(v!==null){this.lastLaps.set(id,v);await this.upsertEntry(id,{last_lap:v});}return;
    }
    if(t==="blp"||c==="blp"||col==="12"){
      const v=parseLapTime(value);if(v!==null){this.bestLaps.set(id,v);await this.upsertEntry(id,{best_lap:v});}return;
    }
    if(t==="tlp"||c==="tlp"||col==="13"){
      const n=parseNumber(value);if(n!==null&&n>=0){
        this.lapCounts.set(id,Math.trunc(n));
        await this.upsertEntry(id,{lap_count:Math.trunc(n)});
        this.state.waitUntil(this.refreshDetail(id));
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


          this.lastGridAt =
            new Date()
              .toISOString();


          for (const [apexId, fields] of grid.rows) {
            for (const cell of Object.values(fields)) {
              await this.applyField(apexId, cell.type, cell.type, cell.value, cell.column);
            }
          }

          await this.persist();
          this.state.waitUntil(this.refreshAllFieldDetails(false));
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
            teamsFromDrivers(
              drivers,
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
