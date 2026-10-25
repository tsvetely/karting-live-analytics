const VERSION = "2026-08-30-race-datasets-v6.23-apex-sync";

const PAGE_SIZE = 1000;

let directSnapshotCache = null;
let directSnapshotCacheAt = 0;
let directSnapshotPending = null;
let lapAnalysisReadCache = null;


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
    const cellRegex = /<(?:td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)>/gi;
    while ((cellMatch = cellRegex.exec(match[4])) !== null) {
      const id = /data-id=["']r\d+c(\d+)["']/i.exec(cellMatch[1]);
      if (!id) continue;
      const column = id[1];
      const explicitType = /data-type=["']([^"']+)["']/i.exec(cellMatch[1]);
      const type = explicitType?.[1] || columnTypes.get(`c${column}`) || "";
      // Apex can encode kart/flag data in element attributes rather than text.
      const innerHtml = cellMatch[2];
      const image = /<img\b([^>]*)>/i.exec(innerHtml);
      const imageAttrs = image?.[1] || "";
      const attr = (markup, name) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const m = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, "i").exec(markup);
        return m?.[1] || m?.[2] || "";
      };
      const embedded = /<(?:span|div|svg|use)\b([^>]*)>/i.exec(innerHtml)?.[1] || "";
      const textValue = stripHtml(innerHtml).trim();
      const explicitValue = attr(cellMatch[1], "data-value") || attr(embedded, "data-value") ||
        attr(innerHtml, "data-number") || attr(innerHtml, "data-kart") || "";
      fields[`c${column}`] = {
        column, type,
        value: textValue || explicitValue,
        image_alt: attr(imageAttrs, "alt") || attr(imageAttrs, "title") || null,
        image_src: attr(imageAttrs, "src") || attr(imageAttrs, "data-src") || null,
        cell_title: attr(cellMatch[1], "title") || attr(embedded, "title") || null,
        data_value: explicitValue || null,
        cell_class: attr(cellMatch[1], "class") || null,
        cell_style: attr(cellMatch[1], "style") || null,
        image_class: attr(imageAttrs, "class") || null
      };
    }
    // Some timing layouts render the kart number outside a TD/TH data-id cell.
    // Inspect only this row's markup; never infer a kart number from the Apex ID.
    if (!fields.c3) {
      const rowAttrs = attrs;
      const attrValue = (name) => {
        const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const m = new RegExp(`(?:^|\\s)${safe}\\s*=\\s*(?:["']([^"']+)["']|([^\\s>]+))`, "i").exec(rowAttrs);
        return m?.[1] || m?.[2] || "";
      };
      const explicitKart = ["data-kart", "data-kart-number", "data-number", "data-no"]
        .map(attrValue).find(v => /^\d{1,3}$/.test(String(v).trim()));
      const embeddedKart = /<[^>]+\bdata-id=["']r\d+c3["'][^>]*>([\s\S]*?)<\/[^>]+>/i.exec(match[4]);
      const embeddedValue = embeddedKart ? stripHtml(embeddedKart[1]).trim() : "";
      const kart = explicitKart || (/^\d{1,3}$/.test(embeddedValue) ? embeddedValue : "");
      if (kart) fields.c3 = { column: "3", type: "no", value: kart };
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


// Quota-independent ingestion path. No Durable Object access or storage writes.
async function directApexDetail(env, apexId, lapCount = 800) {
  const count = Math.max(1, Math.min(800, Number(lapCount) || 800));
  const request = `D#-${count}#D${apexId}.L#-${count}#D${apexId}.P#-999#D${apexId}.B#1#D${apexId}.INF`;
  const response = await fetch("https://live-data.apex-timing.com/live-timing/commonv2/functions/request.php", {
    method: "POST",
    headers: {"content-type": "application/x-www-form-urlencoded; charset=UTF-8"},
    body: new URLSearchParams({port: env.APEX_DETAIL_PORT || "8910", request})
  });
  if (!response.ok) throw new Error(`Apex detail HTTP ${response.status}`);
  return response.text();
}

async function directSyncKart(env, apexId, snapshot = null) {
  const id = String(apexId);
  if (!validApexId(id)) throw new Error("Invalid apex_id");
  const rid = Number(env.DEFAULT_RACE_ID || 1);
  const before = await sbGet(env, "apex_lap_events", {
    select: "lap_number", race_id: `eq.${rid}`, apex_id: `eq.${id}`,
    order: "lap_number.desc", limit: "1"
  });
  const entryRows = await sbGet(env, "apex_entries", {
    select: "team_name,lap_count", race_id: `eq.${rid}`, apex_id: `eq.${id}`, limit: "1"
  });
  const entry = entryRows[0] || {};
  const expected = Number(snapshot?.lapCounts?.[id] || entry.lap_count || 800);
  const raw = await directApexDetail(env, id, expected);
  const laps = parseLapRows(raw, rid).filter(row => String(row.apex_id) === id);
  const pits = parsePitRows(raw, snapshot?.teamNames?.[id] || entry.team_name || "", rid)
    .filter(row => String(row.apex_id) === id && Number(row.pit_number) > 0);
  if (!laps.length && !pits.length) throw new Error(`Apex returned no detail rows for ${id}`);
  for (let i = 0; i < laps.length; i += 150) {
    await sbUpsert(env, "apex_lap_events", laps.slice(i, i + 150), "race_id,apex_id,lap_number");
  }
  for (let i = 0; i < pits.length; i += 150) {
    await sbUpsert(env, "apex_pit_stints", pits.slice(i, i + 150), "race_id,apex_id,pit_number");
  }
  const updates = {
    race_id: rid, apex_id: id,
    team_name: snapshot?.teamNames?.[id] || entry.team_name || null,
    current_driver: snapshot?.drivers?.[id] || null,
    lap_count: Math.max(Number(entry.lap_count) || 0, Number(snapshot?.lapCounts?.[id]) || 0,
      ...laps.map(row => Number(row.lap_number) || 0)),
    updated_at: new Date().toISOString()
  };
  // Preserve existing driver name unless Apex supplies a fresh one.
  if (!updates.current_driver) delete updates.current_driver;
  if (!updates.team_name) delete updates.team_name;
  await sbUpsert(env, "apex_entries", updates, "race_id,apex_id");
  const after = await sbGet(env, "apex_lap_events", {
    select: "lap_number", race_id: `eq.${rid}`, apex_id: `eq.${id}`,
    order: "lap_number.desc", limit: "1"
  });
  return {ok: true, apex_id: id, before_max_lap: before[0]?.lap_number ?? null,
    after_max_lap: after[0]?.lap_number ?? null, apex_laps: laps.length,
    apex_pits: pits.length, source: "direct-worker-no-durable-object"};
}

async function directCronSync(env) {
  let snapshot = null;
  let ids = [];
  try {
    snapshot = await directApexSnapshot(env);
    ids = [...currentFieldIds(snapshot)].sort((a, b) => Number(a) - Number(b));
  } catch (error) {
    console.warn("DIRECT_APEX_GRID_UNAVAILABLE", String(error));
  }
  if (!ids.length) {
    const rows = await sbGet(env, "apex_entries", {
      select: "apex_id", race_id: `eq.${Number(env.DEFAULT_RACE_ID || 1)}`,
      order: "updated_at.desc", limit: "100"
    });
    ids = [...new Set(rows.map(row => String(row.apex_id)).filter(validApexId))].slice(0, 66).sort((a,b)=>Number(a)-Number(b));
  }
  if (!ids.length) throw new Error("No Apex kart IDs available for direct sync");
  // Deterministic rotation; no Durable Object cursor and no database cursor writes.
  const minute = Math.floor(Date.now() / 60000);
  const start = (minute * 3) % ids.length;
  const selected = [0, 1, 2].map(i => ids[(start + i) % ids.length]);
  const results = [];
  for (const id of [...new Set(selected)]) {
    try { results.push(await directSyncKart(env, id, snapshot)); }
    catch (error) { console.error("DIRECT_SYNC_KART_FAILED", id, String(error)); }
  }
  console.log("DIRECT_SYNC_CRON", JSON.stringify({selected, results}));
  if (!results.length) throw new Error("All direct sync attempts failed");
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
  // The collector snapshot is the last raw Apex field state we actually
  // received.  Its age determines LIVE/FINISHED status, but it must NEVER
  // invalidate the data itself.  When timing stops at the end of a race the
  // last packet naturally becomes old; throwing that snapshot away was the
  // reason the UI lost teams/laps/pits and replaced real Apex values with
  // dashes.
  try {
    if (env?.APEX_COLLECTOR) {
      const response = await collectorStub(env).fetch("https://collector/snapshot");
      if (response.ok) {
        const snapshot = await response.json();
        const ids = currentFieldIds(snapshot);
        if (ids.size > 0) {
          return snapshot;
        }
      }
    }
  } catch (error) {
    console.warn("COLLECTOR SNAPSHOT FALLBACK:", error?.message || error);
  }

  // Only reconnect directly to Apex when we genuinely have no collected
  // field at all, not merely because the last valid packet is old.
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
  // Preserve the original Apex grid cells for Live Field rendering.
  // This is an in-memory snapshot only: no Durable Object storage writes.
  const rawRows = {};
  const knownColumnTypes = {
    "1": "sta", "2": "rk", "3": "no", "4": "nat", "5": "dr",
    "6": "s1", "7": "s2", "8": "s3", "9": "llp", "10": "gap",
    "11": "int", "12": "blp", "13": "tlp", "14": "otr", "15": "pit",
    "16": "pt", "17": "pen"
  };

  for (const [rawId, fields] of grid?.rows || []) {
    const id = String(rawId);
    if (!validApexId(id)) continue;
    fieldApexIds.push(id);
    rawRows[id] = {};
    for (const [key, cell] of Object.entries(fields || {})) {
      const column = String(cell?.column || key.replace(/^c/, ""));
      rawRows[id][key] = {
        ...cell,
        type: cell?.type || grid?.columnTypes?.get(`c${column}`) || knownColumnTypes[column] || ""
      };
    }

    for (const cell of Object.values(rawRows[id])) {
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
    rawRows,
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
  // Keep the read path bounded and share the same in-flight query between
  // Overview and Teams. Never disguise a failed database request as zero laps.
  const key = `${rid}:${ids.slice().sort().join(",")}`;
  const now = Date.now();
  if (lapAnalysisReadCache?.key === key && now - lapAnalysisReadCache.at < 20000) {
    return lapAnalysisReadCache.promise;
  }
  const promise = sbGetAll(env, "apex_lap_events", {
    select: "apex_id,lap_number,lap_time",
    race_id: `eq.${rid}`,
    apex_id: `in.(${ids.join(",")})`,
    order: "apex_id.asc,lap_number.asc"
  });
  lapAnalysisReadCache = {key, at: now, promise};
  try { return await promise; }
  catch (error) {
    if (lapAnalysisReadCache?.promise === promise) lapAnalysisReadCache = null;
    throw error;
  }
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

async function stintsPayload(env, rid, snapshot = null, preloaded = null) {
  const isCurrentRace = Number(rid) === Number(raceId(env));
  const realSnapshot = isCurrentRace ? (snapshot || await collectorSnapshot(env).catch(() => null)) : null;

  const [pitsRaw, entriesRaw, exclusionsRaw, teamMap] = preloaded
    ? [preloaded.pits, preloaded.entries, preloaded.exclusions,
       new Map([...preloaded.entries, ...preloaded.pits]
         .filter(row => !badTeamName(stripHtml(row.team_name), row.driver_name || row.current_driver || null))
         .reverse().map(row => [String(row.apex_id), stripHtml(row.team_name)]))]
    : await Promise.all([
        loadPits(env, rid),
        loadEntries(env, rid),
        loadExclusions(env, rid),
        stableTeamNameMap(env, rid)
      ]);

  const fieldIds = preloaded?.reportFieldIds
    ? new Set(preloaded.reportFieldIds.map(String).filter(validApexId))
    : isCurrentRace
      ? currentFieldIds(realSnapshot)
      : new Set(entriesRaw.map(row => String(row.apex_id ?? "").trim()).filter(validApexId));

  if (!fieldIds.size) return [];

  const lapRaw = preloaded ? preloaded.laps : await loadLapEventsForApexIds(env, rid, [...fieldIds]);
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
      // A finished race has no closing pit event. Reconstruct its final
      // on-track interval from the complete original lap durations only.
      // Never invent a finish time when any recorded lap is missing.
      let finishOnTrack = null;
      let finishHour = null;
      if (isCurrentRace && currentLap > start && teamPits.length) {
        const byLap = new Map(laps.map(row => [Number(row.lap_number), Number(row.lap_time)]));
        let seconds = 0;
        let complete = true;
        for (let lap = start + 1; lap <= currentLap; lap++) {
          const t = byLap.get(lap);
          if (!Number.isFinite(t) || t <= 0) { complete = false; break; }
          seconds += t;
        }
        if (complete) {
          const asClock = n => {
            const rounded = Math.round(n);
            return `${String(Math.floor(rounded / 3600)).padStart(2,'0')}:${String(Math.floor(rounded % 3600 / 60)).padStart(2,'0')}:${String(rounded % 60).padStart(2,'0')}`;
          };
          finishOnTrack = asClock(seconds);
          const lastPit = teamPits[teamPits.length - 1];
          const pitClock = hmsSeconds(lastPit.pit_hour);
          const pitDuration = /^([0-9]+):([0-9]{2})(?:\.([0-9]+))?$/.exec(String(lastPit.pit_time || ''));
          if (Number.isFinite(pitClock) && pitDuration) {
            const pitSeconds = Number(pitDuration[1]) * 60 + Number(pitDuration[2]) + Number(`0.${pitDuration[3] || '0'}`);
            finishHour = asClock(pitClock + pitSeconds + seconds);
          }
        }
      }
      result.push({
        race_id:Number(rid), apex_id:id,
        team_name:resolveTeam(id,teamMap,entry.team_name),
        driver_name:entry.current_driver||null,
        stint_number:liveStintNumber, start_lap_count:start,
        end_lap_count:isCurrentRace?null:currentLap,
        current_lap_count:currentLap, total_laps:Math.max(0,currentLap-start), ...stats,
        pit_hour:finishHour,on_track:finishOnTrack,pit_time:null,total_time:null,
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

// Read-only statistics from persisted lap events. Do not infer valid laps
// from the live timing counter or overwrite any stored race data.
function lapAnalysisByKart(lapRows, pitRows, exclusionRows, ids) {
  const allowed = new Set([...ids].map(String));
  const blocked = manualExclusionSet(exclusionRows);
  const pitBoundaries = new Map();
  for (const pit of pitRows || []) {
    const id = String(pit.apex_id);
    const lap = Number(pit.pit_lap);
    if (!allowed.has(id) || !Number.isInteger(lap) || lap <= 0) continue;
    if (!pitBoundaries.has(id)) pitBoundaries.set(id, new Set());
    pitBoundaries.get(id).add(lap);
    pitBoundaries.get(id).add(lap + 1);
  }
  const groups = new Map();
  for (const row of lapRows || []) {
    const id = String(row.apex_id);
    const lap = Number(row.lap_number);
    const time = Number(row.lap_time);
    if (!allowed.has(id) || !Number.isInteger(lap) || lap <= 0 ||
        !Number.isFinite(time) || time <= 0 || blocked.has(`${id}:${lap}`) ||
        pitBoundaries.get(id)?.has(lap)) continue;
    if (!groups.has(id)) groups.set(id, new Map());
    groups.get(id).set(lap, {lap, time});
  }
  const result = new Map();
  for (const id of allowed) result.set(id, lapStats([...(groups.get(id)?.values() || [])]));
  return result;
}

async function livePayload(env, rid, suppliedSnapshot = null) {
  const isCurrentRace = Number(rid) === Number(raceId(env));
  // The live endpoint must remain bounded: no Durable Object calls and no
  // historical lap/stint scans. One grid request plus small database reads.
  const [entriesRaw, snapshot] = await Promise.all([
    loadEntries(env, rid),
    isCurrentRace ? (suppliedSnapshot ? Promise.resolve(suppliedSnapshot) : directApexSnapshot(env).catch(error => {
      console.warn("LIVE GRID UNAVAILABLE:", error?.message || error);
      // A finished race may stop broadcasting its grid. Keep the last
      // successfully received field instead of clearing the entire overview.
      return directSnapshotCache;
    })) : Promise.resolve(null)
  ]);
  const teamMap = new Map();
  for (const entry of entriesRaw) {
    const id = String(entry.apex_id || "");
    const name = stripHtml(entry.team_name);
    if (id && name && !badTeamName(name, entry.current_driver)) teamMap.set(id, name);
  }

  const persistedFieldIds = new Set(entriesRaw.map(row => String(row.apex_id ?? "").trim()).filter(validApexId));
  const liveFieldIds = isCurrentRace ? currentFieldIds(snapshot) : new Set();
  // Never return an empty race just because the timing WebSocket is unavailable.
  // The persisted entry list is the fallback, not a new collector or DB write.
  const fieldIds = liveFieldIds.size ? liveFieldIds : persistedFieldIds;

  if (!fieldIds.size) return {
    race_id:Number(rid), session_name:"Apex Timing", active:false, data_available:false,
    is_live:false, session_status:isCurrentRace?"WAITING FOR APEX GRID":"FINISHED", team_count:0, race_lap:0, pit_count:0, best_lap:null, current:[]
  };

  const entries=filterCurrentField(entriesRaw,fieldIds);
  const entryById=new Map(entries.map(r=>[String(r.apex_id),r]));
  // The full lap history is > 100k rows and cannot be read in one
  // Cloudflare Worker invocation (subrequest limit). Keep live data available.
  // Do not display zero valid laps when analytics have not been calculated.
  const pits = await loadPits(env, rid);
  const kartAnalysis = new Map();
  const finalStintById = new Map();
  const pitCountById = new Map();
  for (const pit of pits) {
    const id = String(pit.apex_id || "");
    if (!fieldIds.has(id)) continue;
    const n = Number(pit.pit_number) || 0;
    if (n > (pitCountById.get(id) || 0)) {
      pitCountById.set(id, n);
      finalStintById.set(id, pit);
    }
    if (!teamMap.has(id)) {
      const name = stripHtml(pit.team_name);
      if (name && !badTeamName(name, pit.driver_name)) teamMap.set(id, name);
    }
  }

  // Race-wide pit time and penalties are live-grid fields, not the
  // duration of the most recent pit stop or an entry-level fallback.
  const gridValue = (id, types, columns) => {
    const cells = snapshot?.rawRows?.[id] || {};
    const accepted = new Set(types);
    for (const cell of Object.values(cells)) {
      if (accepted.has(String(cell?.type || "").toLowerCase())) {
        const value = String(cell?.value ?? cell?.data_value ?? "").trim();
        if (value && value !== "—" && value !== "-") return value;
      }
    }
    for (const column of columns) {
      const cell = cells[`c${column}`];
      const value = String(cell?.value ?? cell?.data_value ?? "").trim();
      if (value && value !== "—" && value !== "-") return value;
    }
    return null;
  };

  const current=[];
  let raceLap=0,pitTotal=0,raceBest=null;

  for (const value of fieldIds) {
    const id=String(value), entry=entryById.get(id)||{}, stint=finalStintById.get(id)||{};
    const stats = kartAnalysis.get(id) || {valid_laps:null,avg_lap_time:null,best_lap_time:null,best_lap_number:null,worst_lap_time:null,worst_lap_number:null,consistency:null};
    const snapshotLap=Number(snapshot?.lapCounts?.[id]);
    const entryLap=Number(entry.lap_count);
    const recordedLap=0;
    const lap=isCurrentRace && Number.isFinite(snapshotLap) ? snapshotLap : (Number.isFinite(entryLap)?entryLap:recordedLap);
    const snapshotPits=Number(snapshot?.pitCounts?.[id]);
    const pitCount=isCurrentRace && Number.isFinite(snapshotPits)
      ? Math.max(0,Math.trunc(snapshotPits))
      : (pitCountById.get(id) || 0);
    raceLap=Math.max(raceLap,Number(lap)||0);
    pitTotal+=pitCount;
    const apexBest = isCurrentRace ? number(snapshot?.bestLaps?.[id]) : number(entry.best_lap);
    if (apexBest !== null && apexBest > 0 && (raceBest === null || apexBest < raceBest)) raceBest = apexBest;
    const pos=Number(snapshot?.positions?.[id]);

    const lastPitLap = pits.filter(p => String(p.apex_id) === id)
      .map(p => Number(p.pit_lap))
      .filter(n => Number.isFinite(n) && n >= 0 && n < (Number(lap) || 0))
      .reduce((max,n) => Math.max(max,n), 0);

    current.push({
      race_id:Number(rid),apex_id:id,position:isCurrentRace&&Number.isFinite(pos)?pos:null,
      team_name:resolveTeam(id,teamMap,entry.team_name,stint.team_name),
      driver_name:(isCurrentRace?snapshot?.drivers?.[id]:null)||stint.driver_name||entry.current_driver||null,
      current_driver:(isCurrentRace?snapshot?.drivers?.[id]:null)||stint.driver_name||entry.current_driver||null,
      race_lap:Number(lap)||0,live_lap_count:Number(lap)||0,pit_count:pitCount,
      stint_number:pitCount+1,start_lap_count:lastPitLap,
      stint_laps:Math.max(0,(Number(lap)||0)-lastPitLap),total_stint_laps:Math.max(0,(Number(lap)||0)-lastPitLap),
      valid_laps:stats.valid_laps,
      stint_status:stint.status||null,data_complete:stint.data_complete!==false,expected_pit_count:number(stint.expected_pit_count),stored_pit_count:number(stint.stored_pit_count),
      live_last_lap:isCurrentRace?(number(snapshot?.lastLaps?.[id]) ?? number(entry.last_lap)):number(entry.last_lap),
      apex_best_lap:isCurrentRace?(number(snapshot?.bestLaps?.[id]) ?? number(entry.best_lap)):number(entry.best_lap),
      apex_fields:isCurrentRace?(snapshot?.rawRows?.[id] || null):null,
      pit_time:isCurrentRace ? gridValue(id,["pt","pittime","pit_time"],[16]) : (entry.pit_time ?? null),
      penalty:isCurrentRace ? gridValue(id,["pen","penalty","penaltime"],[17]) : (entry.penalty ?? entry.penalty_time ?? null),
      avg_lap_time:stats.avg_lap_time,best_lap_time:stats.best_lap_time,
      best_lap_number:stats.best_lap_number,worst_lap_time:stats.worst_lap_time,
      worst_lap_number:stats.worst_lap_number,consistency:stats.consistency,updated_at:entry.updated_at||null
    });
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


async function rawApexPayload(env, rid, snapshot = null, limit = 200) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 2000));
  const [entries, laps, pits, packets] = await Promise.all([
    sbGetAll(env, "apex_entries", {select:"*", race_id:`eq.${rid}`, order:"apex_id.asc"}),
    sbGetAll(env, "apex_lap_events", {select:"*", race_id:`eq.${rid}`, order:"apex_id.asc,lap_number.asc"}),
    sbGetAll(env, "apex_pit_stints", {select:"*", race_id:`eq.${rid}`, order:"apex_id.asc,pit_number.asc"}),
    sbGet(env, "apex_raw_packets", {select:"*", race_id:`eq.${rid}`, order:"id.desc", limit:String(safeLimit)})
  ]);
  return {
    race_id:Number(rid),
    snapshot:snapshot || null,
    counts:{entries:entries.length,laps:laps.length,pits:pits.length,raw_packets_returned:packets.length},
    entries,laps,pits,raw_packets:packets
  };
}

async function createRawApexJsonResponse(env, rid, snapshot) {
  const data = await rawApexPayload(env, rid, snapshot, 2000);
  return new Response(JSON.stringify(data, null, 2), {headers:{
    "content-type":"application/json; charset=utf-8",
    "content-disposition":`attachment; filename="race-${rid}-apex-raw.json"`,
    "cache-control":"no-store"
  }});
}

async function createRawApexTextResponse(env, rid) {
  const packets = await sbGetAll(env, "apex_raw_packets", {select:"*", race_id:`eq.${rid}`, order:"id.asc"});
  const body = packets.map(row => String(row.payload ?? "")).join("\n");
  return new Response(body, {headers:{
    "content-type":"text/plain; charset=utf-8",
    "content-disposition":`attachment; filename="race-${rid}-apex-raw.txt"`,
    "cache-control":"no-store"
  }});
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

// Embedded subset Unicode font (Latin and Cyrillic); no external network dependency.
const PIT_UNICODE_FONT_B64 = 'AAEAAAASAQAABAAgR0RFRggDByMAANsgAAAAQEdQT1OlhXYKAADbYAAAEMRHU1VCCOIj9AAA7CQAAAIETUFUSI662DMAAO4oAAACkE9TLzJsBRAhAAABqAAAAFZjbWFwKJFEOgAACRQAAABUY3Z0IABpHTkAAA98AAAB/mZwZ21xNHZqAAAJaAAAAKtnYXNwAAcABwAA2xQAAAAMZ2x5ZlHcCr4AABUIAADEFmhlYWQoJHXoAAABLAAAADZoaGVhCGIJKAAAAWQAAAAkaG10eHQmss0AAAIAAAAHFGxvY2H7LS3PAAARfAAAA4xtYXhwBgQDZwAAAYgAAAAgbmFtZSftPb4AANkgAAAB1HBvc3T/2wBaAADa9AAAACBwcmVwOwfxAAAAChQAAAVoAAEAAAACXriUzlPQXw889QAfCAAAAAAA4PrROQAAAADnAvsK99b9wwkcCC0AAAAIAAIAAAAAAAAAAQAAB23+HQAACXD31v/VCRwAAQAAAAAAAAAAAAAAAAAAAcUAAQAAAcUAaAAIAEwABgACABAAmQAIAAAEFQIWAAMAAgABBA4BkAAFAAAFMwWZAAABHgUzBZkAAAPXAGYCEgAAAgsGAwMIBAICBIAAAgEAAAAIAAAAAAAAAABQZkVkAEAAICEWBhT+FAGaB20B4wAAAAQAAAAAAAAEzQBmAosAAAM1ATUDrgDFBrQAngUXAKoHmgBxBj0AgQIzAMUDHwCwAx8ApAQAAD0GtADZAosAngLjAGQCiwDbArIAAAUXAIcFFwDhBRcAlgUXAJwFFwBkBRcAngUXAI8FFwCoBRcAiwUXAIECsgDwArIAnga0ANkGtADZBrQA2QQ/AJMIAACHBXkAEAV9AMkFlgBzBikAyQUOAMkEmgDJBjMAcwYEAMkCXADJAlz/lgU/AMkEdQDJBucAyQX8AMkGTABzBNMAyQZMAHMFjwDJBRQAhwTj//oF2wCyBXkAEAfpAEQFewA9BOP//AV7AFwDHwCwArIAAAMfAMcGtADZBAD/7AQAAKoE5wB7BRQAugRmAHEFFABxBOwAcQLRAC8FFABxBRIAugI5AMECOf/bBKIAugI5AMEHywC6BRIAugTlAHEFFAC6BRQAcQNKALoEKwBvAyMANwUSAK4EvAA9BosAVgS8ADsEvAA9BDMAWAUXAQACsgEEBRcBAAa0ANkEAADXBAAA1QQAAXMEAAEjB8sACAJcAAYH2wB7Ajn/9AI5AMEGTAB1BOoApAZMAHMFVACgCOcAyQI5/9sE7ABxBOUAcQSfAFgEAADHBAAA8AAA/F0EUwCFBrMAhwUOAMkFDgDJBkr/+gThAMkFlgBzBRQAhwJcAMkCXAAGAlz/lgjAAFQIXADJBkr/+gWuAMkF/ADJBOAAIwYEAMkFeQAQBX0AyQV9AMkE4QDJBkAAZQUOAMkIngAoBSEAhwX8AMkF/ADJBa4AyQYEAFQG5wDJBgQAyQZMAHMGBADJBNMAyQWWAHME4//6BOAAIwbjAHkFewA9BjYAyQV8AK8IjgDJCMAAyQapADwHDwDJBX0AyQWWAG8IowDTBY8AiATnAHsE7wBwBLcAugQ0ALoFiABrBOwAcQc1AEYEQQCFBTMAugUzALoE1QC6BR0ATAYJALoFOwC6BOUAcQU7ALoFFAC6BGYAcQSpADwEvAA9BtcAcAS8ADsFcgC6BLoAlgdSALoHiQC6BacAPgZRALoEtwC6BGQAcQa8AMEE0AB0BOwAcQTsAHEFAAAvBDQAugRkAHEEKwBvAjkAwQI5//QCOf/bBzgATAcwALoFNwAvBNUAugUzALoEvAA9BTsAugd4AHMGswCHBioAHgVgAB4HigDTBf4AwQcJABAGRAAzCUcAyQgDAMEGTABzBOUAawg3AMkGmADBBRcAcwRTAFsG2gAQBwMAMgZMAHME5QBxBkAAEAVSADIGQAAQBVIAMgfwAHMHPABxB6AAcwYRAHEJcAB2CDkAmAd4AHMGswCHBZYAcwRmAHEEBQA7AAD72gAA/QcAAP2zAAD9swAA+coDWPfWA1j4WAYuAMkFagDBBX0AIQS3ACYE0wDJBRQAugThAMkENAC6BWYARwS5ADgE/gDJBD0AugieACgHNQBGBSEAhwRBAIUFrgDJBNUAugWuAMkE1QC6Ba4AIQTVAD0G2gAyBqcAKgYEAMkFSQDBCB0AyQcEAMEIpgDJB1MAwQcGAHMFiwBxBZYAcwRmAHEE4//6BKkAPATj//wEvAA9BOP//AS8AD0FewA9BLwAOwd5//oGdAAFBXwArwS6AJYFfACvBLoAlgV8AK8FEgC6B4cAFAXTAA8HhwAUBdMADwJcAMkIngAoBzUARgU/AMkE1QC/BjUANgVdAC4GBADJBUkAwQY2AMkFcgDB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AwZkAwQBEAUE/gNAFQMCLQUD/gMCARAFAi0DARADAP4DAbgBZIWNASsrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKwArKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrHQE1ALgAywDLAMEAqgCcAaYAuABmAAAAcQDLAKACsgCFAHUAuADDAcsBiQItAMsApgDwANMAqgCHAMsDqgQAAUoAMwDLAAAA2QUCAPQBVAC0AJwBOQEUATkHBgQABE4EtARSBLgE5wTNADcEcwTNBGAEcwEzA6IFVgWmBVYFOQPFAhIAyQAfALgB3wBzALoD6QMzA7wERAQOAN8DzQOqAOUDqgQEAAAAywCPAKQAewC4ABQBbwB/AnsCUgCPAMcFzQCaAJoAbwDLAM0BngHTAPAAugGDANUAmAMEAkgAngHVAMEAywD2AIMDVAJ/AAADMwJmANMAxwCkAM0AjwCaAHMEAAXVAQoA/gIrAKQAtACcAAAAYgCcAAAAHQMtBdUF1QXVBfAAfwB7AFQApAa4BhQHIwHTALgAywCmAcMB7AaTAKAA0wNcA3ED2wGFBCMEqARIAI8BOQEUATkDYACPBdUBmgYUByMGZgF5BGAEYARgBHsAnAAAAncEYAGqAOkEYAdiAHsAxQB/AnsAAAC0AlIFzQBmALwAZgB3BhAAzQE7AYUDiQCPAHsAAAAdAM0HSgQvAJwAnAAAB30AbwAAAG8DNQBqAG8AewCuALIALQOWAI8CewD2AIMDVAY3BfYAjwCcBOECZgCPAY0C9gDNA0QAKQBmBO4AcwAAFAAAlgAAAAAAAAAAADEAZgDSAX0CEANEA20DpQPQBB0ERwRjBHkEjQSyBPQFKwWqBh4GewbaB0UHigfzCF0IfAikCOAJAQk8CacKZwrkCzwLhwvGC/UMHwxyDKAMxAz7DY4NsA4tDoEOxg8GD2wP9hByEKoQ7BFcEjkSixLsE0sTehOgE8oT7BQBFCkUvxULFVYVohYMFlgWvBb4FyAXXRfVF/MYVBiQGOEZLxl+GbUaZBqhGuMbdByGHUgeLR6THwEfGB+OH9AgLCBRIHggqCETISQiASISIjgijiLqIzsjqyP2JCgkeiTDJUwlkSXHJf4mZiawJrwnDCdRJ10nsye7J8MnyyfTKB8oZyifKKsotyjDKO8o9yk2KT4pWimgKagqISp9KtIq8Ss7K2srcyt7K4MrpiuuK7Yrviv/LFksYSyNLLss6C0eLV0taS2jLfkuWC6lLq0vES9eL3ovvS/FMDwwnjDVMPQxPDFrMa8x2jHiMgUyDTIVMjYyPjKyMroy5TMiM08zhTPCM840BTRWNKg08DT7NUs1nDWoNfo2AjYKNhI2GjZnNrE2+TcENw83GjdGN7I3ujgJOFI4mDjQOPI5ETk/OWo53jpQOo06yTs/O6073zwRPBk8ITxHPG48ejyGPNg9Gj2VPgs+Gz4rPjc+Qj6QPtw/Aj9OP2g/ez+OP61ATkCsQLhAxEERQWFBkEHTQfNCFEJDQnNCuUMBQzNDY0NuQ3lDm0O8Q+FEBUQrRFBEoETvRSdFXEWNRb1GCEZURs1HOkdGR1JHf0eqR7JIAEgjSEVIaUiNSMVI/Ek2SXxJo0nISfdJ/0psSulLNkuCS4pLlkuiS9BMAUwnTE1MiUzFTONNAU08TYNNqU3OTdZN7E38ThNOL043Tj9OUE5hTmlOcU59TohOlE6gTqxOt06/TsdO007fTutO908OTyRPLE80T0BPS09XT2JPbk95T4VPkE+cT6dPs0++T+RQClAWUCJQZ1CtUNxRC1EyUVpRllHTUjpSn1MPU4BT2lQ3VIhU11TfVShVb1WzVfRWN1Y/VkdWh1bGVvdXKldaV5VXylgWWB5YJlguWDZYYFiGWNxZNFmHWd1Z9VoNWiJaN1pUW6hbxFvRW+1cCVwXXDNcQ1xQXGFcclx/XI9cqVzVXPBc/V0YXURdXl3MXiNeXF60XwZfRV+0YBNgeGDFYRhhZ2GFYZth0GHuYgsAAgE1AAACAAXVAAMACQA1QA8HAIMEgQIIBwUBAwQAAAoQ/EuwC1RYuQAA/8A4WTzsMjk5MQAv5PzMMAG2AAsgC1ALA10lMxUjETMRAyMDATXLy8sUohX+/gXV/XH+mwFlAAACAMUDqgLpBdUAAwAHAEJADwUBhAQAgQgEBQYABQIECBD8S7ASVEuwE1RbWLkAAv/AOFn83OwxABD0POwyMAFADzAJQAlQCWAJcAmgCb8JB10BESMRIREjEQFvqgIkqgXV/dUCK/3VAisAAgCeAAAGFwW+AAMAHwBgQDEbCwCHBwQdCQUZDQKHFxMPFREfHhwbGhcWFRQTEhEQDg0MCQgHBgUEAwIBABoKGAYgEPzMFzkxAC881Dw8/Dw81Dw8xDLsMjIwQBELAQsCCwwLDRQEGhEaEhQfCAFdASEDIQMDIRMzAyEVIQMhFSEDIxMhAyMTITUhEyE1IRMEF/7dVAElRGgBJGmgZwE4/qFSAT7+m2igZ/7bZ6Fo/sUBYFT+vgFpZgOF/rIDh/5hAZ/+YZr+spn+YgGe/mIBnpkBTpoBnwAAAwCq/tMEbQYUACEAKAAvAL1AVSICCgsKJwEmKAILCwodAR4cAi8pLxsCKSkvQhMRECIKGykEFwYJKiEFAheGFgaGBREjGooWiRAAKooFiQItCBYKHgcpGhIDAAkiEAkDAQcmCA0FBjAQ/EuwCVRYuQAF/8A4WUuwDFRLsBBUW0uwD1RbWLkABQBAOFk87PQXPPwXPPTk7DEAL+TsxNTk7DLEEO4Q7hESORE5ERIXORESOTBLU1gHEATtBxAO7REXOQcQDu0RFzkHEATtWSIBIwMmJic1FhYXESYmNTQ2NzUzFRYWFxUmJicRFhYVFAYHAxEGBhUUFhcRNjY1NCYCtGQBadJqZtFv3cnazGRdrlNTr1zj1uPWZHR6ceF/gXv+0wEtAi0ttEBBAQHIJKyWo7wO6+gEHxuvKi4E/lUjtJypww8DAAGaDWpYVmDV/k8RblpYaAAABQBx/+MHKQXwAAsAFwAjACcAMwCJQDYkDyUmJSYPJyQnQgCSDB6SLo0YkiQGkgyNJhKMKCSRNCchGyUJAw0VDgkNDyENKw4bDQ8xCzQQ/EuwCVRLsAtUW0uwDFRbS7AUVFtLsA5UW0uwDVRbWLkAMf/AOFnE7PTsEO727hE5ERI5MQAQ5DL0POTsEO727hDuMEtTWAcQBe0HEAXtWSIBIgYVFBYzMjY1NCYnMhYVFAYjIiY1NDYBIgYVFBYzMjY1NCYlMwEjEzIWFRQGIyImNTQ2BdFXY2NXVWNjVZ66u52gurv8l1ZjYldXY2QDMaD8WqAfnry7n5+5ugKRlISClZWCg5V/3Lu729u7vNsCYZWChJSUhIGWf/nzBg3bu73a27y63AAAAgCB/+MF/gXwAAkAMAHNQJYNAQ4MhhESEQuGCgsSEhEJhgAJFRYVBwEGCIYWFhUCAQMBhh0eHQCGCQAeHh0gHwIhHhEKEwoXFhUDGBQREwoHCAIGCRETEwoCAQIDABEKEwoXFgIYFRETChQRExMKQhILCQMGAAoeAygVDgYoJwaVGCuVJ5QkkRiMDhMKLgsOCQAuEhUnDh4DLhInIQ4RDxMhAxIbEDEQ/OzE1NTsEMbuETkREjk5ETk5ETkROTEAL8bk9ubuEO4QxhESOREXOREXOTBLU1gHEAXtBwXtERc5BxAF7REXOQcQBe0RFzkHBe0RFzkHEAXtERc5BxAI7QcQDu0RFzkHEA7tERc5BxAI7QcQCO0HEA7tERc5WSKyDzIBAV1AsgcLBSIJKRwAHAEfAhcLKgAqASYSOgA0EkQLXgBZAVoKVRJaGlofWTBnHnsAmwCaAZkClwiVC5MVlRaVIpktHwkLCQwIEQwnDCgYAhsJGQsZDBkRHBQcFRYdHzInACcBKQkjEioTKhQoFS8yOwk0EjkTPzJKCUwUSxVGGU8yVgFaCVkMVRJZE1wfXzJqDGkRYDJ1AXkMehGTAJMBlwKVBZwHnAifCJoJmwuaDJAyoDKwMjldAF0BBgYVFBYzMjY3AQE2NjczBgIHASMnBgYjIgA1NDY3JiY1NDYzMhYXFSYmIyIGFRQWAfJbVdSgX6ZJ/nsB/DtCBroMaF0BF/yPaOSD8f7OhoYwMt64U6VVV55EaYM7AyNRoViSwj9AAo/9+FnLcoT+/n7+45NZVwET14DhYz99PKLFJCS2LzFvWDNnAAEAxQOqAW8F1QADADdACgGEAIEEAAUCBAQQ/EuwElRLsBNUW1i5AAL/wDhZ7DEAEPTsMAFADUAFUAVgBXAFkAWgBQZdAREjEQFvqgXV/dUCKwABALD+8gJ7BhIADQA3QA8GmACXDg0HAAMSBgATCg4Q3EuwE1RYuQAK/8A4WUuwD1RYuQAKAEA4WeQy7BE5OTEAEPzsMAEGAhUUEhcjJgI1NBI3AnuGgoOFoJaVlJcGEub+Pufn/jvl6wHG4N8BxOwAAQCk/vICbwYSAA0AH0APB5gAlw4HAQALEgQTCAAOENw89OwROTkxABD87DATMxYSFRQCByM2EjU0AqSglpWVlqCFg4MGEuz+PN/g/jrr5QHF5+cBwgABAD0CSgPDBfAAEQBOQCwQDQsABAwJBwQCBAgDmQURDJkKAQ6REggMCgMJBhEDAQMCABQPBAsJFA0GEhDUPOQy3DzkMhc5ERIXOTEAEPTUPOwyxOwyFzkSFzkwAQUFByURIxEFJyUlNwURMxElA8P+mQFnOv6wcv6wOgFn/pk6AVByAVAE38LDYsv+hwF5y2LDwmPLAXn+h8sAAQDZAAAF2wUEAAsAI0ARAAkBnAcDBQIVBAAXCgYVCAwQ3Pw8/DzsMQAv1Dz8PMQwAREhFSERIxEhNSERA64CLf3TqP3TAi0FBP3Tqv3TAi2qAi0AAQCe/xIBwwD+AAUAGUAMA54AgwYDBAEZABgGEPzs1MwxABD87DA3MxUDIxPw06SBUv6s/sABQAABAGQB3wJ/AoMAAwARtgCcAgQBAAQQ3MwxABDU7DATIRUhZAIb/eUCg6QAAAEA2wAAAa4A/gADABG3AIMCARkAGAQQ/OwxAC/sMDczFSPb09P+/gABAAD/QgKyBdUAAwAtQBQAGgECAQIaAwADQgKfAIEEAgABAy/EOTkxABD07DBLU1gHEAXtBxAF7VkiATMBIwIIqv34qgXV+W0AAAIAh//jBI8F8AALABcAI0ATBqASAKAMkRKMGAkcDx4DHBUbGBD87PTsMQAQ5PTsEO4wASICERASMzISERACJzIAERAAIyIAERAAAoucnZ2cnZ2dnfsBCf73+/v+9wEJBVD+zf7M/s3+zQEzATMBNAEzoP5z/ob+h/5zAY0BeQF6AY0AAAEA4QAABFoF1QAKAEBAFUIDoAQCoAWBBwCgCQgfBhwDAB8BCxDUS7APVFi5AAEAQDhZ7MT87DEAL+wy9OzU7DBLU1hZIgG0DwMPBAJdNyERBTUlMxEhFSH+AUr+mQFlygFK/KSqBHNIuEj61aoAAQCWAAAESgXwABwAnkAnGRobAxgcEQUEABEFBQRCEKERlA2gFJEEAKACABAKAgEKHBcQAwYdEPxLsBVUS7AWVFtLsBRUW1i5AAP/wDhZxNTswMAREjkxAC/sMvTs9OwwS1NYBxAF7QcF7QGwHBARFzlZIgFAMlUEVgVWB3oEegV2G4cZBwQABBkEGgQbBRx0AHYGdRpzG3QcggCGGYIaghuCHKgAqBsRXQBdJSEVITU2ADc2NjU0JiMiBgc1NjYzMgQVFAYHBgABiQLB/ExzAY0zYU2nhl/TeHrUWOgBFEVbGf70qqqqdwGROm2XSXeWQkPMMTLowlylcB3+6wABAJz/4wRzBfAAKABwQC4AFRMKhgkfhiAToBUNoAmTBhygIJMjkQaMFaMpFhwTAAMUGRwmIBAcAxQfCQYpEPxLsBZUS7AUVFtYuQAJ/8A4WcTE1Oz07BEXOTkxABDs5PTk7BDm7hDuEO4Q7hESOTABQAlkHmEfYSBkIQQAXQEWFhUUBCEiJic1FhYzMjY1NCYjIzUzMjY1NCYjIgYHNTY2MzIEFRQGAz+Ro/7Q/uhex2pUyG2+x7mlrraVnqOYU75yc8lZ5gEMjgMlH8SQ3fIlJcMxMpaPhJWmd3BzeyQmtCAg0bJ8qwAAAgBkAAAEpAXVAAIADQCBQB0BDQMNAAMDDUIAAwsHoAUBA4EJAQwKABwGCAQMDhDcS7ALVEuwDVRbWLkADP/AOFnUPMTsMhE5MQAv5NQ87DISOTBLU1gHEATJBxAFyVkiAUAqCwAqAEgAWQBpAHcAigAHFgErACYBKwM2AU4BTwxPDVYBZgF1AXoDhQENXQBdAQEhAzMRMxUjESMRITUDBv4CAf41/tXVyf1eBSX84wPN/DOo/qABYMMAAQCe/+MEZAXVAB0AXkAjBBoHEYYQHRqgBxSgEIkNAqAAgQ2MB6QeFxwBCgMcAAoQBh4Q/AFLsBZUS7AUVFtYuQAQ/8A4WUuwD1RYuQAQAEA4WcTU7BDE7jEAEOTk9OwQ5u4Q/sQQ7hESOTATIRUhETY2MzIAFRQAISImJzUWFjMyNjU0JiMiBgfdAxn9oCxYLPoBJP7U/u9ew2hawGutysqtUaFUBdWq/pIPD/7u6vH+9SAgyzEwtpyctiQmAAIAj//jBJYF8AALACQAWEAkEwYADYYMAKAWBqAcFqUQoAyJIpEcjCUMIgkcGR4THAMhHxslEPzs7PTs5DEAEOT05PzkEO4Q7hDuERI5MEAUywDLAc0CzQPNBMsFywYHpB6yHgJdAV0BIgYVFBYzMjY1NCYBFSYmIyICAzY2MzIAFRQAIyAAERAAITIWAqSIn5+IiJ+fAQlMm0zI0w87smvhAQX+8OL+/f7uAVABG0ybAzu6oqG7u6GiugJ5uCQm/vL+71dd/u/r5v7qAY0BeQFiAaUeAAABAKgAAARoBdUABgBjQBgFEQIDAgMRBAUEQgWgAIEDBQMBBAEABgcQ/MzEETk5MQAv9OwwS1NYBxAF7QcQBe1ZIgFLsBZUWL0ABwBAAAEABwAH/8A4ETc4WUASWAIBBgMaBTkFSAVnA7AAsAYHXQBdEyEVASMBIagDwP3i0wH+/TMF1Vb6gQUrAAADAIv/4wSLBfAACwAjAC8AQ0AlGAwAoCcGoB4toBKRHownozAYDCQqHBUkHA8JHBUbHgMcDyEbMBD8xOz0xOwQ7hDuETk5MQAQ7OT07BDuEO45OTABIgYVFBYzMjY1NCYlJiY1NDYzMhYVFAYHFhYVFAQjIiQ1NDYTFBYzMjY1NCYjIgYCi5ClpZCQpqX+pYKR/97f/pGBkqP+9/f3/vekSJGDgpOTgoORAsWah4eam4aHmlYgsoCz0NCzgLIgIsaP2ejo2Y/GAWF0goJ0dIKCAAACAIH/4wSHBfAAGAAkAFhAIwcfGQGGABmgCqUEoACJFh+gEJEWjCUHHBwhEx4AIiIcDRslEPzs5PTs7DEAEOT07BDm/vXuEO4REjkwQBbEGcIawBvAHMAdwh7EHweqErwS6RIDXQFdNzUWFjMyEhMGBiMiADU0ADMgABEQACEiJgEyNjU0JiMiBhUUFuFMnEvI0w86smzg/vsBEOIBAwER/rH+5UycAT6In5+IiJ+fH7gkJgENARJWXAEP6+YBFv5z/ob+n/5bHgKXuqKhu7uhoroAAAIA8AAAAcMEIwADAAcAHEAOBoMEpgCDAgUBAwQAGAgQ/DzsMjEAL+z07DA3MxUjETMVI/DT09PT/v4EI/4AAgCe/xIBwwQjAAMACQAlQBMCgwAHngSDAKYKBwgFARkEABgKEPw87DLUzDEAEOT87BDuMBMzFSMRMxUDIxPw09PTpIFSBCP+/dms/sABQAABANkAXgXbBKYABgBNQCoCnAMEAwGcAAEEBAMBnAIBBQYFAJwGBUIFBAIBAAUDqAanBwECACQEIwcQ/OwyOTEAEPTsFzkwS1NYBwTtBxAI7QcQCO0HEATtWSIJAhUBNQEF2/v4BAj6/gUCA/D+kf6TtgHRpgHRAAACANkBYAXbA6IAAwAHABxADQCcAgacBAgFAQQAIwgQ/DzEMjEAENTs1OwwEyEVIRUhFSHZBQL6/gUC+v4DoqjwqgABANkAXgXbBKYABgBPQCsGnAAGAwQDBZwEBAMAnAECAQacBQYCAgFCBgUDAgAFBKgBpwcGAiQEACMHEPw87DkxABD07Bc5MEtTWAcQCO0HEATtBxAE7QcQCO1ZIhM1ARUBNQHZBQL6/gQGA/C2/i+m/i+2AW0AAgCTAAADsAXwAAMAJABlQCskHgkGBAodEwQAFIYTiBCVF5EAgwIdGg0JBQQKHgENHBoEHAUBAwAmGhMlENxLsAxUWLkAE//AOFnE/OzU7BDuETk5ERI5ERI5MQAv7vb+9O4QzRE5ORc5MAG2eQl6CnogA10lMxUjEyM1NDY3NzY2NTQmIyIGBzU2NjMyFhUUBgcHBgYHBgYVAYfLy8W/OFpaOTODbE+zYV7BZ7jfSFpYLycIBgb+/gGRmmWCVlk1XjFZbkZDvDk4wp9MiVZWLzUZFTw0AAIAh/6cB3EFogALAEwAlUAyGAwDCakZFRsDqUwPNDMPrDCpNxWsJKk3Q00zNB4aACgSBhgMKBorHihJEisqKEksPU0Q3Oz87BD+/f48xhDuERI5OTEAENTE/OwQ/u3UxhDF7jIQxO4ROTkwAEuwCVRLsAxUW0uwEFRbS7ATVFtLsBRUW1i9AE3/wAABAE0ATQBAOBE3OFlACQ9OH04vTj9OBAFdARQWMzI2NTQmIyIGAQYGIyImNTQ2MzIWFzUzETY2NTQmJyYkIyIGBwYCFRQSFxYEMzI2NxcGBCMiJCcmAjU0Ejc2JDMyBBcWFhUQAAUC+o58e42QenmPAiE8m2es19irZ5w7j5KlP0Bo/tWwe+JgnbFzbWkBFJ2B+Whaff7ZmLn+uICAhoh+gQFSvdQBa3tLT/7C/ugCGY+jpI6MpaT+SE1J+cjI+ktMg/0gFt+xa7xQg4tBQGb+tcGf/upqaG1XUW9hZ4N9fQFJvbYBSn1/h66gYuZ7/vn+0AYAAAIAEAAABWgF1QACAAoAwkBBABEBAAQFBAIRBQUEAREKAwoAEQIAAwMKBxEFBAYRBQUECREDCggRCgMKQgADB5UBA4EJBQkIBwYEAwIBAAkFCgsQ1MQXOTEALzzk1OwSOTBLU1gHEAXtBwXtBxAF7QcF7QcQCO0HEAXtBxAF7QcQCO1ZIrIgDAEBXUBCDwEPAg8HDwgPAFgAdgBwAIwACQcBCAIGAwkEFgEZAlYBWAJQDGcBaAJ4AXYCfANyBHcHeAiHAYgCgAyYApkDlgQXXQBdAQEhATMBIwMhAyMCvP7uAiX+e+UCOdKI/V+I1QUO/RkDrvorAX/+gQADAMkAAATsBdUACAARACAAQ0AjGQCVCgmVEoEBlQqtHxELCAITGR8FAA4cFgUZHC4JABwSBCEQ/Owy/OzU7BEXOTk5MQAv7Oz07BDuOTCyDyIBAV0BESEyNjU0JiMBESEyNjU0JiMlITIWFRQGBxYWFRQEIyEBkwFEo52do/68ASuUkZGU/gsCBOf6gHyVpf7w+/3oAsn93YeLjIUCZv4+b3JxcKbAsYmiFCDLmMjaAAEAc//jBScF8AAZADZAGg2hDq4KlREBoQCuBJUXkRGMGgcZDQAwFBAaEPzsMuwxABDk9Oz07BDu9u4wtA8bHxsCAV0BFSYmIyAAERAAITI2NxUGBiMgABEQACEyFgUnZueC/wD+8AEQAQCC52Zq7YT+rf56AYYBU4btBWLVX17+x/7Y/tn+x15f00hIAZ8BZwFoAZ9HAAIAyQAABbAF1QAIABEALkAVAJUJgQGVEAgCEAoABRkNMgAcCQQSEPzs9OwROTk5OTEAL+z07DCyYBMBAV0BETMgABEQACElISAAERAAISEBk/QBNQEf/uH+y/5CAZ8BsgGW/mj+UP5hBS/7dwEYAS4BLAEXpv6X/oD+fv6WAAEAyQAABIsF1QALAC5AFQaVBAKVAIEIlQStCgUBCQcDHAAEDBD87DLUxMQxAC/s7PTsEO4wsh8NAQFdEyEVIREhFSERIRUhyQOw/RoCx/05Avj8PgXVqv5Gqv3jqgABAMkAAAQjBdUACQApQBIGlQQClQCBBK0IBQEHAxwABAoQ/Owy1MQxAC/s9OwQ7jCyDwsBAV0TIRUhESEVIREjyQNa/XACUP2wygXVqv5Iqv03AAABAHP/4wWLBfAAHQA5QCAABRsBlQMblQgSoRGuFZUOkQiMHgIAHBE0BDMYGQsQHhD87Pzk/MQxABDk9Oz07BD+1O4ROTkwJREhNSERBgQjIAAREAAhMgQXFSYmIyAAERAAITI2BMP+tgISdf7moP6i/nUBiwFekgEHb3D8i/7u/u0BEwESa6jVAZGm/X9TVQGZAW0BbgGZSEbXX2D+zv7R/tL+ziUAAQDJAAAFOwXVAAsALEAUCJUCrQQAgQoGBwMcBTgJARwABAwQ/Owy/OwyMQAvPOQy/OwwslANAQFdEzMRIREzESMRIREjycoC3srK/SLKBdX9nAJk+isCx/05AAABAMkAAAGTBdUAAwAutwCvAgEcAAQEEPxLsBBUWLkAAABAOFnsMQAv7DABQA0wBUAFUAVgBY8FnwUGXRMzESPJysoF1forAAAB/5b+ZgGTBdUACwBCQBMLAgAHlQWwAIEMBQgGOQEcAAQMEPxLsBBUWLkAAABAOFns5Dk5MQAQ5PzsETk5MAFADTANQA1QDWANjw2fDQZdEzMREAYjIzUzMjY1ycrN400/hm4F1fqT/vL0qpbCAAEAyQAABWoF1QAKAO9AKAgRBQYFBxEGBgUDEQQFBAIRBQUEQggFAgMDAK8JBgUBBAYIARwABAsQ/Owy1MQROTEALzzsMhc5MEtTWAcQBO0HEAXtBxAF7QcQBO1ZIrIIAwEBXUCSFAIBBAIJCBYCKAUoCDcCNgU0CEcCRgVDCFUCZwJ2AncFgwKIBY8IlAKbCOcCFQYDCQUJBhsDGQcFCgMKBxgDKAUrBioHNgQ2BTYGNQcwDEEDQARFBUAGQAdADGIDYARoBWcHdwVwDIsDiwWOBo8HjwyaA50GnQe2A7UHxQPFB9cD1gfoA+kE6AXqBvcD+AX5BixdcQBdcRMzEQEhAQEhAREjycoCngEE/RsDGv72/TPKBdX9iQJ3/Uj84wLP/TEAAAEAyQAABGoF1QAFACVADAKVAIEEARwDOgAEBhD87OwxAC/k7DBACTAHUAeAA4AEBAFdEzMRIRUhycoC1/xfBdX61aoAAQDJAAAGHwXVAAwAv0A0AxEHCAcCEQECCAgHAhEDAgkKCQERCgoJQgoHAgMIAwCvCAsFCQgDAgEFCgYcBD4KHAAEDRD87PzsERc5MQAvPMTsMhEXOTBLU1gHEAXtBxAI7QcQCO0HEAXtWSKycA4BAV1AVgMHDwgPCQIKFQIUBxMKJgImByAHJgogCjQHNQppAnwCewd5CoACggeCCpACFgQBCwMTARsDIwEsAycIKAk0ATwDVghZCWUIagl2CHkJgQGNA5UBmwMUXQBdEyEBASERIxEBIwERI8kBLQF9AX8BLcX+f8v+f8QF1fwIA/j6KwUf/AAEAPrhAAEAyQAABTMF1QAJAHlAHgcRAQIBAhEGBwZCBwIDAK8IBQYBBwIcBDYHHAAEChD87PzsETk5MQAvPOwyOTkwS1NYBxAE7QcQBO1ZIrIfCwEBXUAwNgI4B0gCRwdpAmYHgAIHBgEJBhUBGgZGAUkGVwFYBmUBaQZ5BoUBigaVAZoGnwsQXQBdEyEBETMRIQERI8kBEAKWxP7w/WrEBdX7HwTh+isE4fsfAAIAc//jBdkF8AALABcAI0ATBpUSAJUMkRKMGAkZDzMDGRUQGBD87PzsMQAQ5PTsEO4wASIAERAAMzIAERAAJyAAERAAISAAERAAAyfc/v0BA9zcAQH+/9wBOgF4/oj+xv7F/ocBeQVM/rj+5f7m/rgBSAEaARsBSKT+W/6e/p/+WwGkAWIBYgGlAAIAyQAABI0F1QAIABMAOkAYAZUQAJUJgRIQCggCBAAFGQ0/EQAcCQQUEPzsMvzsERc5MQAv9OzU7DBACw8VHxU/FV8VrxUFAV0BETMyNjU0JiMlITIEFRQEIyMRIwGT/o2amo3+OAHI+wEB/v/7/soFL/3PkoeGkqbj293i/agAAgBz/vgF2QXwAAsAHQBSQCoREAIPAQwNDA4BDQ0MQg8eDAaVEgCVGJESjA0eDRsPDAMJGRszAxkVEB4Q/Oz87BE5ORE5MQAQxOT07BDuORI5MEtTWAcQBe0HEAXtFzlZIgEiABEQADMyABEQABMBIycGBiMgABEQACEgABEQAgMn3P79AQPc3AEB/v8/AQr03SEjEP7F/ocBeQE7AToBeNEFTP64/uX+5v64AUgBGgEbAUj6z/7d7wICAaUBYQFiAaX+W/6e/vz+jgAAAgDJAAAFVAXVABMAHACxQDUJCAcDCgYRAwQDBREEBANCBgQAFQMEFZUJFJUNgQsEBQYDEQkAHBYOBQoZGQQRPxQKHAwEHRD87DL8xOwRFzkROTk5MQAvPPTs1OwSORI5EjkwS1NYBxAF7QcQBe0RFzlZIrJAHgEBXUBCehMBBQAFAQUCBgMHBBUAFQEUAhYDFwQlACUBJQImAycGJgcmCCYJIB42ATYCRgFGAmgFdQR1BXcTiAaIB5gGmAcfXQBdARYWFxMjAyYmIyMRIxEhIBYVFAYBETMyNjU0JiMDjUF7Ps3Zv0qLeNzKAcgBAPyD/Yn+kpWVkgK8FpB+/mgBf5Zi/YkF1dbYjboCT/3uh4ODhQAAAQCH/+MEogXwACcAfkA8DQwCDgsCHh8eCAkCBwoCHx8eQgoLHh8EFQEAFaEUlBiVEQSVAJQlkRGMKB4KCx8bBwAiGxkOLQcZFCIoENzE7Pzs5BESOTk5OTEAEOT05OwQ7vbuEMYRFzkwS1NYBxAO7REXOQcQDu0RFzlZIrIPKQEBXbYfKS8pTykDXQEVJiYjIgYVFBYXFxYWFRQEISImJzUWFjMyNjU0JicnJiY1NCQzMhYESHPMX6Wzd6Z64tf+3f7nau+Ae+xyrbyHmnviygEX9WnaBaTFNzaAdmNlHxkr2bbZ4DAv0EVGiH5ufB8YLcCrxuQmAAAB//oAAATpBdUABwBKQA4GApUAgQQBQAMcAEAFCBDU5PzkMQAv9OwyMAFLsApUWL0ACABAAAEACAAI/8A4ETc4WUATAAkfABABEAIfBxAJQAlwCZ8JCV0DIRUhESMRIQYE7/3uy/3uBdWq+tUFKwAAAQCy/+MFKQXVABEAQEAWCAIRCwAFlQ6MCQCBEggcCjgBHABBEhD8S7AQVFi5AAD/wDhZ7PzsMQAQ5DL07BE5OTk5MAG2HxOPE58TA10TMxEUFjMyNjURMxEQACEgABGyy67Dwq7L/t/+5v7l/t8F1fx18NPT8AOL/Fz+3P7WASoBJAAAAQAQAAAFaAXVAAYAt0AnBBEFBgUDEQIDBgYFAxEEAwABAAIRAQEAQgMEAa8ABgQDAgAFBQEHENTEFzkxAC/sMjkwS1NYBxAF7QcQCO0HEAjtBxAF7VkislAIAQFdQGIAAyoDRwRHBVoDfQODAwcGAAcCCAQJBhUBFAIaBBoFKgAmASYCKQQpBSUGIAg4ADMBMwI8BDwFNwZIAEUBRQJJBEkFRwZZAFYGZgJpBGkFegB2AXYCeQR5BXUGgAiYAJcGKV0AXSEBMwEBMwECSv3G0wHZAdrS/ccF1fsXBOn6KwABAEQAAAemBdUADAF7QEkFGgYFCQoJBBoKCQMaCgsKAhoBAgsLCgYRBwgHBREEBQgIBwIRAwIMAAwBEQAADEIKBQIDBgMArwsIDAsKCQgGBQQDAgELBwANENTMFzkxAC887DIyFzkwS1NYBxAF7QcQCO0HEAjtBxAF7QcQCO0HEAXtBwXtBxAI7VkisgAOAQFdQPIGAgYFAgoACgAKEgooBSQKIAo+Aj4FNAowCkwCTQVCCkAKWQJqAmsFZwpgCnsCfwJ8BX8FgAqWApUFHQcACQIIAwAEBgUABQAGAQcECAAIBwkACQQKCgwADhoDFQQVCBkMEA4gBCEFIAYgByAIIwkkCiULIA4gDjwCOgM1BDMFMAg2CTkLPwwwDkYARgFKAkAERQVABUIGQgdCCEAIQAlECk0MQA5ADlgCVghZDFAOZgJnA2EEYgVgBmAHYAhkCWQKZAt3AHYBewJ4A3cEdAV5BnkHdwhwCHgMfwx/DoYChwOIBIkFhQmKC48OlwSfDq8OW10AXRMzAQEzAQEzASMBASNEzAE6ATnjAToBOc3+if7+xf7C/gXV+xIE7vsSBO76KwUQ+vAAAQA9AAAFOwXVAAsAZkAGDQQGAAoMENTE3MTEMbSAAH8KAl0AQAUDAK8JBi887DIwS7BCUFhAFAcRBgYFCREKCwoDEQQFBAERAAsABQcQ7AcQ7AcQ7AcQ7EAUCwoDBwAICQQHAAUJBAYBAgoDBgEPDw8PWRMzAQEzAQEjAQEjAYHZAXMBddn+IAIA2f5c/lnaAhUF1f3VAiv9M/z4Anv9hQMdAAAB//wAAATnBdUACACUQCgDEQQFBAIRAQIFBQQCEQMCCAAIAREAAAhCAgMArwYCBwRABRwAQAcJENTk/OQSOTEAL+wyOTBLU1gHEAXtBxAI7QcQCO0HEAXtWSKyAAoBAV1APAUCFAI1AjACMAUwCEYCQAJABUAIUQJRBVEIZQKEApMCEBYBGgMfCiYBKQM3ATgDQApnAWgDeANwCp8KDV0AXQMzAQEzAREjEQTZAZ4Bm9n98MsF1f2aAmb88v05AscAAAEAXAAABR8F1QAJAJBAGwMRBwgHCBECAwJCCJUAgQOVBQgDAAFCBAAGChDcS7AJVEuwClRbWLkABv/AOFnE1OQROTkxAC/s9OwwS1NYBxAF7QcQBe1ZIgFAQAUCCgcYBykCJgc4B0gCRwdICAkFAwsIAAsWAxoIEAsvCzUDOQg/C0cDSghPC1UDWQhmA2kIbwt3A3gIfwufCxZdAF0TIRUBIRUhNQEhcwSV/FADx/s9A7D8ZwXVmvtvqpoEkQABALD+8gJYBhQABwA7QA8EqQayAqkAsQgFAQNDAAgQ3EuwDFRYuQAAAEA4WUuwElRLsBNUW1i5AAD/wDhZ/MwyMQAQ/Oz07DATIRUjETMVIbABqPDw/lgGFI/5/I8AAQAA/0ICsgXVAAMALUAUAhoBAQAAGgMDAkIBnwCBBAIAAQMvxDk5MQAQ9OwwS1NYBxAF7QcQBe1ZIhMBIwGqAgiq/fgF1fltBpMAAAEAx/7yAm8GFAAHADBAEAOpAbIFqQCxCABDBAYCBAgQ/EuwD1RLsBBUW1i5AAIAQDhZPNzsMQAQ/Oz07DABESE1MxEjNQJv/ljv7wYU+N6PBgSPAAEA2QOoBdsF1QAGABhACgMEAQCBBwMBBQcQ3Mw5MQAQ9MwyOTABASMBASMBA7wCH8n+SP5IyQIfBdX90wGL/nUCLQAAAf/s/h0EFP6sAAMAD7UAqQEAAgQQxMQxANTsMAEVITUEFPvY/qyPjwAAAQCqBPACiQZmAAMAMUAJAbQAswQDRAEEENzsMQAQ9OwwAEuwCVRLsA5UW1i9AAT/wAABAAQABABAOBE3OFkBASMBAW8BGpn+ugZm/ooBdgACAHv/4wQtBHsACgAlALxAJxkfCxcJDgCpFwa5DhEghh+6HLkjuBGMFwwAFwMYDQkICx8DCBRFJhD87MzU7DIyETk5MQAvxOT0/PTsEMbuEO4RORE5EjkwQG4wHTAeMB8wIDAhMCI/J0AdQB5AH0AgQCFAIlAdUB5QH1AgUCFQIlAncCeFHYcehx+HIIchhSKQJ6An8CceMB4wHzAgMCFAHkAfQCBAIVAeUB9QIFAhYB5gH2AgYCFwHnAfcCBwIYAegB+AIIAhGF0BXQEiBhUUFjMyNjU1NxEjNQYGIyImNTQ2MyE1NCYjIgYHNTY2MzIWAr7frIFvmbm4uD+8iKzL/fsBAqeXYLZUZb5a8/ACM2Z7YnPZtClM/YGqZmHBor3AEn+LLi6qJyf8AAACALr/4wSkBhQACwAcADhAGQO5DA8JuRgVjA+4G5cZABISRxgMBggaRh0Q/OwyMvTsMQAv7OT0xOwQxu4wtmAegB6gHgMBXQE0JiMiBhUUFjMyNgE2NjMyEhEQAiMiJicVIxEzA+WnkpKnp5KSp/2OOrF7zP//zHuxOrm5Ai/L5+fLy+fnAlJkYf68/vj++P68YWSoBhQAAAEAcf/jA+cEewAZAD9AGwCGAYgEDoYNiAq5EQS5F7gRjBoHEg0ASBRFGhD85DLsMQAQ5PTsEP707hD17jBACw8bEBuAG5AboBsFAV0BFSYmIyIGFRQWMzI2NxUGBiMiABEQACEyFgPnTp1Qs8bGs1CdTk2lXf3+1gEtAQZVogQ1rCsr483N4ysrqiQkAT4BDgESATojAAIAcf/jBFoGFAAQABwAOEAZGrkADhS5BQiMDrgBlwMXBAAIAkcREgtFHRD87PTsMjIxAC/s5PTE7BDE7jC2YB6AHqAeAwFdAREzESM1BgYjIgIREBIzMhYBFBYzMjY1NCYjIgYDori4OrF8y///y3yx/cenkpKoqJKSpwO2Al757KhkYQFEAQgBCAFEYf4Vy+fny8vn5wAAAgBx/+MEfwR7ABQAGwBwQCQAFQEJhgiIBRWpAQW5DAG7GLkSuAyMHBsVAggVCABLAhIPRRwQ/Oz07MQREjkxABDk9OzkEO4Q7hD07hESOTBAKT8dcB2gHdAd8B0FPwA/AT8CPxU/GwUsBy8ILwksCm8AbwFvAm8VbxsJXXEBXQEVIRYWMzI2NxUGBiMgABEQADMyAAcmJiMiBgcEf/yyDM23asdiY9Br/vT+xwEp/OIBB7gCpYiauQ4CXlq+xzQ0riosATgBCgETAUP+3cSXtK6eAAABAC8AAAL4BhQAEwBZQBwFEAEMCKkGAYcAlw4GvAoCEwcABwkFCA0PC0wUEPxLsApUWLkACwBAOFlLsA5UWLkAC//AOFk8xPw8xMQSOTkxAC/kMvzsEO4yEjk5MAG2QBVQFaAVA10BFSMiBhUVIRUhESMRIzUzNTQ2MwL4sGNNAS/+0bmwsK69BhSZUGhjj/wvA9GPTrurAAIAcf5WBFoEewALACgASkAjGQwdCRKGExa5DwO5JiO4J7wJuQ+9Gh0mGQAIDEcGEhIgRSkQ/MTs9OwyMjEAL8Tk7OT0xOwQ/tXuERI5OTC2YCqAKqAqAwFdATQmIyIGFRQWMzI2FxACISImJzUWFjMyNjU1BgYjIgIREBIzMhYXNTMDoqWVlKWllJWluP7++mGsUVGeUrW0ObJ8zvz8znyyObgCPcjc3MjH3Nzr/uL+6R0esywqvb9bY2IBOgEDAQQBOmJjqgAAAQC6AAAEZAYUABMANEAZAwkAAw4BBocOEbgMlwoBAggATg0JCAtGFBD87DL07DEALzzs9MTsERIXOTCyYBUBAV0BESMRNCYjIgYVESMRMxE2NjMyFgRkuHx8lay5uUKzdcHGAqT9XAKen56+pP2HBhT9nmVk7wAAAgDBAAABeQYUAAMABwArQA4GvgSxALwCBQEIBABGCBD8POwyMQAv5PzsMEALEAlACVAJYAlwCQUBXRMzESMRMxUjwbi4uLgEYPugBhTpAAAC/9v+VgF5BhQACwAPAERAHAsCBwAOvgwHhwW9ALwMsRAIEAUGTw0BCAwARhAQ/DzsMuQ5EjkxABDs5PTsEO4REjk5MEALEBFAEVARYBFwEQUBXRMzERQGIyM1MzI2NREzFSPBuKO1RjFpTLi4BGD7jNbAnGGZBijpAAEAugAABJwGFAAKALxAKQgRBQYFBxEGBgUDEQQFBAIRBQUEQggFAgMDvACXCQYFAQQGCAEIAEYLEPzsMtTEETkxAC887OQXOTBLU1gHEATtBxAF7QcQBe0HEATtWSKyEAwBAV1AXwQCCggWAicCKQUrCFYCZgJnCHMCdwWCAokFjgiTApYFlwijAhIJBQkGAgsDCgcoAycEKAUrBisHQAxoA2AMiQOFBIkFjQaPB5oDlweqA6cFtgfFB9YH9wPwA/cE8AQaXXEAXRMzEQEzAQEjAREjurkCJev9rgJr8P3HuQYU/GkB4/30/awCI/3dAAEAwQAAAXkGFAADACK3AJcCAQgARgQQ/OwxAC/sMEANEAVABVAFYAVwBfAFBgFdEzMRI8G4uAYU+ewAAAEAugAABx0EewAiAFpAJgYSCRgPAAYdBxUMhx0gA7gbvBkQBwARDwgIBlARCA9QHBgIGkYjEPzsMvz8/OwREjkxAC88POT0PMTsMhESFzkwQBMwJFAkcCSQJKAkoCS/JN8k/yQJAV0BNjYzMhYVESMRNCYjIgYVESMRNCYjIgYVESMRMxU2NjMyFgQpRcCCr765cnWPprlyd42mubk/sHl6qwOJfHb14v1cAp6hnL6k/YcCnqKbv6P9hwRgrmdifAAAAQC6AAAEZAR7ABMANkAZAwkAAw4BBocOEbgMvAoBAggATg0JCAtGFBD87DL07DEALzzk9MTsERIXOTC0YBXPFQIBXQERIxE0JiMiBhURIxEzFTY2MzIWBGS4fHyVrLm5QrN1wcYCpP1cAp6fnr6k/YcEYK5lZO8AAgBx/+MEdQR7AAsAFwBKQBMGuRIAuQy4EowYCRIPUQMSFUUYEPzs9OwxABDk9OwQ7jBAIz8ZewB7Bn8Hfwh/CX8Kfwt7DH8Nfw5/D38QfxF7EqAZ8BkRAV0BIgYVFBYzMjY1NCYnMgAREAAjIgAREAACc5Ssq5WTrKyT8AES/u7w8f7vARED3+fJyefoyMfpnP7I/uz+7f7HATkBEwEUATgAAgC6/lYEpAR7ABAAHAA+QBsauQAOFLkFCLgOjAG9A7wdERILRxcEAAgCRh0Q/OwyMvTsMQAQ5OTk9MTsEMTuMEAJYB6AHqAe4B4EAV0lESMRMxU2NjMyEhEQAiMiJgE0JiMiBhUUFjMyNgFzubk6sXvM///Me7ECOKeSkqenkpKnqP2uBgqqZGH+vP74/vj+vGEB68vn58vL5+cAAgBx/lYEWgR7AAsAHAA+QBsDuQwPCbkYFbgPjBu9GbwdGAwGCBpHABISRR0Q/Oz07DIyMQAQ5OTk9MTsEMbuMEAJYB6AHqAe4B4EAV0BFBYzMjY1NCYjIgYBBgYjIgIREBIzMhYXNTMRIwEvp5KSqKiSkqcCczqxfMv//8t8sTq4uAIvy+fny8vn5/2uZGEBRAEIAQgBRGFkqvn2AAABALoAAANKBHsAEQAwQBQGCwcAEQsDhw64CbwHCgYIAAhGEhD8xOwyMQAv5PTsxNTMERI5MLRQE58TAgFdASYmIyIGFREjETMVNjYzMhYXA0ofSSycp7m5OrqFEy4cA7QSEcu+/bIEYK5mYwUFAAEAb//jA8cEewAnAOdAPA0MAg4LUx8eCAkCBwpTHx8eQgoLHh8EFQCGAYkEFIYViRi5EQS5JbgRjCgeCgsfGwcAUhsIDgcIFCJFKBD8xOzU7OQREjk5OTkxABDk9OwQ/vXuEPXuEhc5MEtTWAcQDu0RFzkHDu0RFzlZIrIAJwEBXUBtHAocCxwMLgksCiwLLAw7CTsKOws7DAsgACABJAIoCigLKhMvFC8VKhYoHigfKSApISQnhgqGC4YMhg0SAAAAAQICBgoGCwMMAw0DDgMPAxADGQMaAxsDHAQdCScvKT8pXyl/KYApkCmgKfApGF0AXXEBFSYmIyIGFRQWFxcWFhUUBiMiJic1FhYzMjY1NCYnJyYmNTQ2MzIWA4tOqFqJiWKUP8Sl99haw2xmxmGCjGWrQKuY4M5mtAQ/rigoVFRASSEOKpmJnLYjI741NVlRS1AlDySVgp6sHgAAAQA3AAAC8gWeABMAOEAZDgUIDwOpABEBvAiHCgsICQIEAAgQEg5GFBD8PMT8PMQyOTkxAC/s9DzE7DIROTkwsq8VAQFdAREhFSERFBYzMxUjIiY1ESM1MxEBdwF7/oVLc7291aKHhwWe/sKP/aCJTpqf0gJgjwE+AAACAK7/4wRYBHsAEwAUADtAHAMJAAMOAQaHDhGMCgG8FLgMDQkIFAtOAggARhUQ/Oz0OewyMQAv5OQy9MTsERIXOTC0bxXAFQIBXRMRMxEUFjMyNjURMxEjNQYGIyImAa64fHyVrbi4Q7F1wcgBzwG6Aqb9YZ+fvqQCe/ugrGZj8AOoAAABAD0AAAR/BGAABgD7QCcDEQQFBAIRAQIFBQQCEQMCBgAGAREAAAZCAgMAvwUGBQMCAQUEAAcQ1EuwClRYuQAAAEA4WUuwFFRLsBVUW1i5AAD/wDhZxBc5MQAv7DI5MEtTWAcQBe0HEAjtBxAI7QcQBe1ZIgFAjkgCagJ7An8ChgKAApECpAIIBgAGAQkDCQQVABUBGgMaBCYAJgEpAykEIAg1ADUBOgM6BDAIRgBGAUkDSQRGBUgGQAhWAFYBWQNZBFAIZgBmAWkDaQRnBWgGYAh1AHQBewN7BHUFegaFAIUBiQOJBIkFhgaWAJYBlwKaA5gEmAWXBqgFpwawCMAI3wj/CD5dAF0TMwEBMwEjPcMBXgFew/5c+gRg/FQDrPugAAEAVgAABjUEYAAMAetASQVVBgUJCgkEVQoJA1UKCwoCVQECCwsKBhEHCAcFEQQFCAgHAhEDAgwADAERAAAMQgoFAgMGAwC/CwgMCwoJCAYFBAMCAQsHAA0Q1EuwClRLsBFUW0uwElRbS7ATVFtLsAtUW1i5AAAAQDhZAUuwDFRLsA1UW0uwEFRbWLkAAP/AOFnMFzkxAC887DIyFzkwS1NYBxAF7QcQCO0HEAjtBxAF7QcQCO0HEAXtBwXtBxAI7VkiAUD/BQIWAhYFIgo1CkkCSQVGCkAKWwJbBVUKUApuAm4FZgp5An8CeQV/BYcCmQKYBZQKvAK8Bc4CxwPPBR0FAgkDBgQLBQoICwkECwUMFQIZAxYEGgUbCBsJFAsVDCUAJQEjAicDIQQlBSIGIgclCCcJJAohCyMMOQM2BDYIOQwwDkYCSANGBEAEQgVABkAHQAhECUQKRAtADkAOVgBWAVYCUARRBVIGUgdQCFMJVApVC2MAZAFlAmoDZQRqBWoGagduCWELZwxvDnUAdQF5An0DeAR9BXoGfwZ6B38HeAh5CX8Jewp2C30MhwKIBY8OlwCXAZQCkwOcBJsFmAaYB5kIQC+WDJ8OpgCmAaQCpAOrBKsFqQapB6sIpAyvDrUCsQO9BLsFuAm/DsQCwwPMBMoFeV0AXRMzExMzExMzASMDAyNWuObl2ebluP7b2fHy2QRg/JYDavyWA2r7oAOW/GoAAQA7AAAEeQRgAAsBQ0BGBREGBwYEEQMEBwcGBBEFBAECAQMRAgIBCxEAAQAKEQkKAQEAChELCgcIBwkRCAgHQgoHBAEECAC/BQIKBwQBBAgAAggGDBDUS7AKVEuwD1RbS7AQVFtLsBFUW1i5AAYAQDhZS7AUVFi5AAb/wDhZxNTEERc5MQAvPOwyFzkwS1NYBxAF7QcQCO0HEAjtBxAF7QcQBe0HEAjtBxAI7QcQBe1ZIgFAmAoEBAoaBBUKJgo9BDEKVQRXB1gKZgp2AXoEdgd0Co0EggqZBJ8ElweSCpAKpgGpBK8EpQejCqAKHAoDBAUFCQoLGgMVBRUJGgspAyYFJQkqCyANOgE5AzcFNAc2CTkLMA1JA0YFRQlKC0ANWQBWAVkCWQNXBVYGWQdWCFYJWQtQDW8NeAF/DZsBlAerAaQHsA3PDd8N/w0vXQBdCQIjAQEjAQEzAQEEZP5rAarZ/rr+utkBs/5y2QEpASkEYP3f/cEBuP5IAkoCFv5xAY8AAAEAPf5WBH8EYAAPAYtAQwcIAgkRAA8KEQsKAAAPDhEPAA8NEQwNAAAPDREODQoLCgwRCwsKQg0LCRAACwWHA70OC7wQDg0MCgkGAwAIDwQPCxAQ1EuwClRLsAhUW1i5AAsAQDhZS7AUVFi5AAv/wDhZxMQRFzkxABDkMvTsETkRORI5MEtTWAcQBe0HEAjtBxAI7QcQBe0HEAjtBwXtFzJZIgFA8AYABQgGCQMNFgoXDRANIw01DUkKTwpODVoJWgpqCocNgA2TDRIKAAoJBgsFDAsOCw8XARUCEAQQBRcKFAsUDBoOGg8nACQBJAIgBCAFKQgoCSUKJAskDCcNKg4qDyARNwA1ATUCMAQwBTgKNgs2DDgNOQ45DzARQQBAAUACQANABEAFQAZAB0AIQglFCkcNSQ5JD0ARVABRAVECVQNQBFAFVgZVB1YIVwlXClULVQxZDlkPUBFmAWYCaAppDmkPYBF7CHgOeA+JAIoJhQuFDIkNiQ6JD5kJlQuVDJoOmg+kC6QMqw6rD7ARzxHfEf8RZV0AXQUGBiMjNTMyNjc3ATMBATMCk06UfJNsTFQzIf47wwFeAV7DaMh6mkiGVARO/JQDbAAAAQBYAAAD2wRgAAkAnUAaCBECAwIDEQcIB0IIqQC8A6kFCAMBAAQBBgoQ3EuwC1RLsAxUW1i5AAb/wDhZS7ATVFi5AAYAQDhZxDLEETk5MQAv7PTsMEtTWAcQBe0HEAXtWSIBQEIFAhYCJgJHAkkHBQsIDwsYAxsIKwggCzYDOQgwC0ABQAJFA0AEQAVDCFcDWQhfC2ABYAJmA2AEYAViCH8LgAuvCxtdAF0TIRUBIRUhNQEhcQNq/UwCtPx9ArT9ZQRgqPzbk6gDJQAAAQEA/rIEFwYUACQAd0A0GQ8VCwYlCRoQFR0LBSAhAwALqQkAqQHACRWpE7ElDAkKBSQWGQAdCgUTAhQAIBlDCg8FJRDUS7AMVFi5AAUAQDhZPMT8PMQyOTkREjkREjk5ERI5OTEAEPzsxPTsEO4SFzkSORE5ORESORESOTkwAbIAJgFdBRUjIiY1NTQmIyM1MzI2NTU0NjMzFSMiBhUVFAYHFhYVFRQWMwQXPvmpbI49PY9rqfk+RI1WW25vWlaNvpCU3e+XdI9zlfDdk49Yjfidjhkbjpz4jVgAAAEBBP4dAa4GHQADABK3AQCxBAAFAgQQ1OwxABD8zDABESMRAa6qBh34AAgAAAABAQD+sgQXBhQAJACHQDYfJRsWDA8IGwsVGQ8EBSADABmpGwCpI8AbD6kRsSUcGRoVDwEEAAgaFSMSBAAaHxVDEAALBCUQ1EuwClRYuQAE/8A4WUuwDlRYuQAEAEA4WTzEMvw8xBESOTkREjkREjk5ERI5OTEAEPzsxPTsEO4SFzkREjk5ETkROTkREjkwAbIAJgFdBTMyNjU1NDY3JiY1NTQmIyM1MzIWFRUUFjMzFSMiBhUVFAYjIwEARoxVWm9vWlWMRj/5p2yOPj6ObKf5P75Wj/icjhsZjp34jlePk93wlXOPdJfv3ZQAAAEA2QHTBdsDMQAdACNAEAEQGwwAEwScGxOcDB4ADx4Q1MQxABDU/NTsEMAREjk5MAEVBgYjIicmJyYnJiMiBgc1NjYzMhcWFxYXFjMyNgXbabNhbpILBQcPm15YrGJps2FukwoFCA6bXlapAzGyT0Q7BAIDBT5NU7JPRTwEAgMFPkwAAAIA1wVGAykGEAADAAcAkkAOBgLOBADNCAFkAAVkBAgQ3PzU7DEAEPw87DIwAEuwClRLsA1UW1i9AAgAQAABAAgACP/AOBE3OFkBS7AMVEuwDVRbS7AOVFtLsBdUW1i9AAj/wAABAAgACABAOBE3OFkBS7APVEuwGVRbWL0ACABAAAEACAAI/8A4ETc4WUARYAFgAmAFYAZwAXACcAVwBghdATMVIyUzFSMCXsvL/nnLywYQysrKAAABANUFYgMrBfYAAwAvtwLvAO4EAQAEENTMMQAQ/OwwAEuwCVRLsA5UW1i9AAT/wAABAAQABABAOBE3OFkTIRUh1QJW/aoF9pQAAAEBcwTuA1IGZgADADFACQK0ALMEA0QBBBDU7DEAEPTsMABLsAlUS7AOVFtYvQAE/8AAAQAEAAQAQDgRNzhZATMBIwKLx/66mQZm/ogAAAEBI/51AsEAAAATAB9ADgkGCg3zBgATABAnAwkUENzU7NTMMQAv1PzEEjkwIRYWFRQGIyImJzUWFjMyNjU0JicCVDc2eHYuVysiSi87PCstPmkwWVsMDIMRDzAuHlc9AAIACAAAB0gF1QAPABMAh0A5EREODw4QEQ8PDg0RDw4MEQ4PDkIFlQMLlREBlRCVAIERB5UDrQ0JERAPDQwFDgoABAgGAhwSCg4UENTUPOwy1MTEERIXOTEALzzs7MT07OwQ7hDuMEtTWAcQBe0HBe0HEAXtBxAF7VkisoAVAQFdQBNnEXcQdxGGDIUQlhGQFaAVvxUJXQEVIREhFSERIRUhESEDIwEXASERBzX9GwLH/TkC+Pw9/fCgzQJxi/62AcsF1ar+Rqr946oBf/6BBdWe/PADEP//AAYAAAJYB04SJgAqAAARBwG8Ay8BdQAItAAKBwEHKzEAAwB7/+MHbwR7AAYAMwA+AQNAQyctJT0ODQA0qSUWhhWIEgCpDjoSuRwZLoYtuioDuQ67BzEKuB8ZjCU/NDcmBg8AJTccByYPFQAIDT0mCA8tNwgiRT8Q/OzM1Pw81OzEERI5ORE5ERI5ERI5MQAQxOQy9DzE5Pw89OwQxO4yEO4Q9O4Q7hE5ETkREjkwQIEwKzAsMC0wLjAvMDBAK0AsQC1ALkAvQDBQK1AsUC1QLlAvUDCFK4UwgECQQKBAsEDAQNBA4EDgQPBAHT8APwY/DT8OPw8FMCwwLTAuMC9ALEAtQC5AL1AsUC1QLlAvbwBvBm8Nbw5vD2AsYC1gLmAvcCxwLXAucC+ALIAtgC6ALx1dcQFdASYmIyIGBwM2NjMyABUVIRYWMzI2NxUGBiMiJicGBiMiJjU0NjMhNTQmIyIGBzU2NjMyFgMiBhUUFjMyNjU1BrYBpYmZuQ5EStSE4gEI/LIMzLdoyGRk0Gqn+E1J2I+90v37AQKnl2C2VGW+Wo7V79+sgW+ZuQKUl7SungEwWl7+3fpav8g1Na4qLHl3eHi7qL3AEn+LLi6qJydg/hhme2Jz2bQp////9AAAAkYGEBImAGgAABEHAGD/HQAAAAi0AAsIAQcrMQACAMEAAAF5BHsAAwAEACxACwS4AL8CBAEIAEYFEPzsOTEAL+zkMEARBAQ0BEQEEAZABlAGYAZwBggBXRMzESMTwbi4XARg+6AEewAAAgB1/+MF2QXwABMAGgBEQCYBFAAIoQeuBACVFBeVEQCVFK0ElQuREYwbARQaGhkPMxQZBwAQGxD8xOz07BESOTEAEOT07PTkEO4Q7hD07hESOTATIRAAISIGBzU2JDMgABEQACEgADcWEjMyEjd1BI/+7f7ui/xwbwEHkgFeAYv+iP7G/rf+l9wN/8rK/w0DDAEMATJgX9dGSP5n/pL+n/5bAbfMw/7kARzDAAEApP/jBHsF8AAoAEBAJAqGCYgNlQaRKQAWlROtKR+GIIgclSOMKSoUCR8QGQMZGSYQKRD87NTs1MTEzDEAEPTs9OwQ9Ow5EPTs9OwwASYmNTQkMzIWFxUmJiMiBhUUFjMzFSMiBhUUFjMyNjcVBgYjICQ1NDYB2IOOAQzmWclzcr5TmKOelbaupbnHvm3IVGrHXv7o/tCjAyUhq3yy0SAgtCYke3Nwd6aVhI+WMjHDJSXy3ZDEAAADAHP/4wXZBfAACwASABkAMUALGRAZBjMPExkAEBoQ/Owy9OwyMQBADxaVCROVD60aDJUDkQmMGhDk9OwQ9OwQ7DATEAAhIAAREAAhIAABIgAHISYCARISMzISE3MBeQE6ATsBeP6I/sX+xv6HArXK/wAMA6wO/v1WCPvc3PgIAukBYgGl/lv+n/6e/lsBpAPF/uTDwwEc/Xr+//7CAT0BAgABAKD/wQT4BdUAIgBwQA4LDg0ICgQZDhAWCg0eIxDcxMTUOcTsEjm0Pw5PDgJdERI5MQBAEwoJlRAPC5UNgSMfoR6uAJUajCMQ9Oz07BD07DnU7DkwQAoQEQoLCgsRDxAPBxAF7AcQBexADgkKNw8CBRALCxUQOwsEAV0AXSUyNzY1NCcmIyM1ASE1IRUBMhcWFxYVFAcGISInJic1FhcWAqjAY2RcXaWuAYH8/AQA/mVqgGJWUZiY/uh3fX6Gan9+a0tLj4ZJSpgB6qqa/hY4Km1oitx6eRMSJcMxGRkAAAEAyf/jCC0F1QAdADVADg4cERkDHAY4GwEcAAQeEPzsMvzsMtTsMQBADg8alQKtBACBHAqVFYwcL+TsEOQy/OzEMBMzESERMxEUFxYXMjc2NREzERQHBiEgJyY1ESERI8nKAt7KPj2ZlEI+ymRg/ub+7Wdk/SLKBdX9nAJk++yfUE4BT0ukAp/9Wt+AeHh26QEN/TkAAAH/2/5WAXkEYAALADhAFQsCBwAHhwW9ALwMCAwFBk8BCABGDBD87OQ5EjkxABDk9OwREjk5MEALEA1ADVANYA1wDQUBXRMzERQGIyM1MzI2NcG4o7VGMWlMBGD7jNbAnGGZAAACAHH/4wR/BHsAFAAbAEFAJAAVAQmGCIgFAakVGLkSFbsFuQy4EowcAhUbGwgPSxUSCAFFHBD8xOz07BESOTEAEOT07OQQ7hDuEPTuERI5MBM1ISYmIyIGBzU2NjMgABEQACMiADcWFjMyNjdxA04Mzbdqx2Jj0GsBDAE5/tf84v75uAKliJq5DgIAWr7HNDSuKiz+yP72/u3+vQEjxJe0rp4AAAMAcf/jBHUEewAGAA0AGQAsQBgEqQsHuRQAuQ64FIwaCgQSEVELAxIXRRoQ/Owy9OwyMQAQ5PTsEO7c7DABIgYHISYmAzI2NSEUFhMyABEQACMiABEQAAJxk5USAnQSlZKVqP2GqJbwARL+7vDx/u8BEQPfwX9/wfyg6JSU6AP8/sj+7P7t/scBOQETARQBOAAAAQBY/kwELwRgACAAqUAKGx8VEiIGHh8OIRDc1MTUxOwQzLIAHxsREjkxQBYbQgCpGhoeIR2pHg6GDZMRuQm9HrwhABDk/Oz07BDsERI5L+zssxUGAAkREjk5MEAIGxEAHBEgGh8HBRDsBBDsQBsMHAoAGxwZACocKgA4ADscSQBMHFQAWxxxAA0BXUAbBBsEIBQbFCAlGyQgNSA3G0UgRhtUIFwbfxsNAF1ACQcLBgwaDBoPBF0BMhcWFxYVFAQhIicmJzUWFjMyNzY1NCcmIyM1ASE1IRUCPGqAYlZR/tD+6F5jZGpUyG2+Y2RcXaWuAa79ZQNqAdw4Km1oit3yEhMlwzEyS0uPhEtKpgHzk6gAAAEAxwUpAzkGSAANAFdADgvwBAcAsw4HVggBVgAOENzs1OwxABD0PNTsMABLsAlUWL0ADv/AAAEADgAOAEA4ETc4WQBLsA9US7AQVFtLsBFUW1i9AA4AQAABAA4ADv/AOBE3OFkTMxYWMzI2NzMGBiMiJsd2C2FXVmANdgqekZGeBkhLS0pMj5CQAAIA8ATuA64GZgADAAcAQkARBgK0BACzCAQHAwAFAQMFBwgQ1NzUzBE5ERI5MQAQ9DzsMjAAS7AJVEuwDlRbWL0ACP/AAAEACAAIAEA4ETc4WQEzAyMDMwMjAvyy+IeBqt+JBmb+iAF4/ogAAAL8XQTu/xsGZgADAAcAQkARBgK0BACzCAQFAQAHAwEHBQgQ1NzUzBE5ERI5MQAQ9DzsMjAAS7AJVEuwDlRbWL0ACP/AAAEACAAIAEA4ETc4WQETIwMhEyMD/Q/Nh/gCAL6J3wZm/ogBeP6IAXgAAQCF/+MDyAR8ADIAPUAiDIYLiBC5CLgzG6kYMyeGKIgjuSyMMzQZCycUCAQfCDBFMxD87NTs1MTExDEAEPTs9OwQ1OwQ9Oz07DABJicmNTQ3NjMyFhcVJicmIyIHBhUUFxYzMxUjIgcGFRQXFjMyNzY3FQYHBiMiJyY1NDYBi3A8PHJxxEyqYmFQUUd3RUZEQ3SblIlITlRVl11VVUdaVFVQ7oGBigJcGEFAXY1PThgYpx0NDS4uQEYtLJgzOFhaODgSEyWrHA4OW1utbJIAAAEAh//jBicEYAAaADhAFBISExxFEBIVCwgMBxICBRIEAkUbEPzc7BDs1PzU7Ozc7DEAQAkLEgS8DgmHFwAvPOwy9DzEMAUgETQTMwIVEDMyETMQMzIRNAMzEhUQISADAgIm/mGbxo/ey6rL3o/Gm/5h/vAhKR0CUusBQP7A8P5PAhr95gGx8AFA/sDr/a4BK/7VAP//AMkAAASLB2sSJgCMAAAQBwG+BO4Bdf//AMkAAASLB04SJgCMAAARBwG8BJ0BdQCFsZKXQrCTsJhCsYAEQrGBAEJ8sACwASNJsBOwDiNJYbCAYmiwE0ZhsABGYLCSQ7ABYCNCsJJDsAFgQ7AAVViwDrCSQ7ABYEM4sA4RsAE1WbGAAEKxgQBCGLAAELATsA6wASNJaDuwExGwAjUAsACwEyNJsEBQWLATsEA4sBMRsAI1sAE1WQAAAf/6/mYFrAXVABsANEALBQocGxQOFhwTERwQ1Mz8PMzc/MwxAEAPBZUEsBAOlRcQFhGVE4EQL/TsMhDU7BD07DAlEAYjIzUzMjY1ETQmIyERIxEhNSEVIREhMhYVBazM5Ew+hm98fP6Iy/5SBIv97gGhut5o/vL0qpbCASKfnv05BSuqqv5G6e7//wDJAAAEagdrEiYAigAAEAcBvQSuAXUAAQBz/+MFJwXwABgATkAJGhILABEUGQYZENzsMtQ8zMwxAEAXE5USrRkMoQuuDpUJkRkAoQGuF5UDjBkQ9Oz07BD07PTsEPTssRIOSbEXE0lQWLMSE0ACFzhZMAEVBiEgABEQACEgFxUmISACByEVIRYSISAFJ9T+9f6x/noBhgFPAQ/Q0/8A/vjuFgMe/OIW7gEIAQABRtOQAZ8BaAFnAZ+O1b3+4++q7/7k//8Ah//jBKIF8BIGADQAAP//AMkAAAGTBdUSBgAqAAD//wAGAAACWAdOEAYAZQAA////lv5mAZMF1RIGACsAAAACAFQAAAgvBdUAFAAcADNADBcZEAAcGwsBHAoGHRDU1OzUPOzc7DEAQA4blQytFAGVCoEcBpUFFC887DL07BD87DABIRUQAgU1NhIRNSERMzIEFRQEIyElIBE0JiMjEQRw/hvI/pHZlQN46vsBEP7w+/5MAaoBQJ2j4AUruP3K/fs4qi8BpgJY/v2a2t3e2qYBEYuH/d0AAAIAyQAAB8wF1QASABsANUAOExkPCAAcFwoHAhwFBBwQ/Owy3DzsMtzsMQBADRcBlQsHrQkFgRiVAAQvPOzkMvw87DIwIREhESMRMxEhETMRMzIEFRQEIwE0JiMjETMyNgQN/YbKygJ6yur7ARD+8PsBNp2j4OChnwLH/TkF1f2cAmT9mtre3doBt4uH/d2HAAH/+gAABawF1QATACxACgYcAxAKEhwODRQQ1Mz8PMzc7DEAQAsKlRMMEg2VD4EFDC889OwyENTsMAEyFhURIxE0JiMhESMRITUhFSERBBS63sl8fP6Iy/5SBIv97gNx6e7+ZgGKn579OQUrqqr+Rv//AMkAAAWGB2sSJgCRAAAQBwG9BO4Bdf//AMkAAAUzB2sSJgCPAAAQBwG+BOUBdf//ACMAAAS9B20QJwG/BHIBdRIGAJoAAAABAMn+vwU7BdUACwApQA0NBAYcBwuVCQMcAgQMEPzs1PzU7OwxALcLBJUGAoEJAS885DLszDAhIREzESERMxEhESMCrf4cygLeyv4cqgXV+tUFK/or/r///wAQAAAFaAXVEgYAIgAAAAIAyQAABOwF1QAIABUALkAMFwkAGRAuBAscFQQWEPzsMvTsxMwxAEAMC5UVgRQElQytBZUUL+z07BD07DABNCYjIREhMjYTFSERITIEFRQEISERBBedo/68AUSjnWz9EAFO+wEQ/vn+/P3oAbeLh/3dhwSopv5A2t7d2gXV//8AyQAABOwF1RIGACMAAAABAMkAAARqBdUABQAZQAwElQGBAAcCBBwBBAYQ/PzMxDEAL/TsMDMRIRUhEckDof0pBdWq+tUAAAIAZf6/BdsF1QAHABcANEAPAhwOE5UZEBcDHA0UlRcYENzs1OwQ1Mz8POwxAEALA5UNgRIWDwAXlRQv7DIyzDL07DAlIREhFRADBgU2NxIRESERMxEjESERIxEB0wKU/htwF/6xhiZhA3iqqvveqqoEgdT+Df61RCs/eAE0AiYBGvrV/hUBQf6/Aev//wDJAAAEiwXVEgYAJgAAAAEAKAAACHYF1QATAJhACwgFAQQGCQEcDAAUENw87DLUxBE5OTEAQBFCDQwQEwgJBQIIEgMArw8KBi88POwyMhc5MEtTWEAWBxEGCBEFCQQGBQMRBAIRBQgJCQQJBAkHEDw8BO0QBe0HCBDtBRDtWQFAEw0BCA4BBw8BBhABBREBBBIBAwAQSTpJOkk6STpJOkk6AEAIEwIQBQ0IDAkQPBA8EDwQPAEzEQEzAQEjAQERIxEBASMBATMBA+rKAqr1/d8CRNP+E/7+yv7+/hPTAkT93/UCqgXV/R4C4v2z/HgDAf7p/hYB6gEX/P8DiAJN/R4AAQCH/+MEmgXwACgAP0AMGx8ZAyoWGQklEAYpEPwy1OzM1PzMMQBAFhqVGwwQoQ+uE5UMJaEmriKVAJEMjCkQ5PTs9OwQ7PTsENTsMAEyBBUUBgcWFhUUBCMiJCc1FhYzMjY1NCYjIzUzMjY1NCYjIgYHNTY2Akn2ATiOg5Gj/p3uev7kLJmpfLzQucPM1LOeo8aGXM1x7AXw0bJ8qyEfxJDm6UIc0FkrkJWElaZ3cHN7GE3FKCIAAAEAyQAABTMF1QAJAHlAHgMRCQkICBEEBANCCAMJBq8CBQkEBwMcADYHHAYEChD87PzsETk5MQAvPOwyOTkwS1NYBxAE7QcQBO1ZIrIfCwEBXUAwNgg4A0gIRwNpCGYDgAgHBgQJCRUEGglGBEkJVwRYCWUEaQl5CYUEigmVBJoJnwsQXQBdAREjEQEhETMRAQUzxP1q/vDEApYF1forBOH7HwXV+x8E4QD//wDJAAAFMwdtEiYAjwAAEQcBvwT1AXUAI7QGChIAByuwCktUsAtLVFuwEEtUW1i7ABIAQAAK/8A4OFkxAAABAMkAAAWGBdUACwBZQAsIBQEEBgkBHAAEDBD87DLUxBE5OTEAQAtCCAkFAgQDAK8KBi887DIXOTBLU1hAFgcRBggRBQkEBgUDEQQCEQUICQkECQQJBxA8PATtEAXtBwgQ7QUQ7VkTMxEBIQEBIwEBESPJygLSAQP9vwJf3P36/u/KBdX9HgLi/bL8eQMB/un+FgAAAQBUAAAFOgXVAA8AJUAKEQQKHAcLHAYBEBDU1OzU7OwxAEAIC5UGgQGVAAkvPOz07DAzNTY3EhE1IREjESEVEAMGVNk+VwN4yv4bZmKqL6QBAgJY/vorBSu4/cr++P3//wDJAAAGHwXVEgYALgAA//8AyQAABTsF1RIGACkAAP//AHP/4wXZBfASBgAwAAAAAQDJAAAFOwXVAAcAH0AQBJUHgQIGCQQDHAAEHAcECBD87NTs7DEALzz07DABESMRIREjEQU7yv0iygXV+isFK/rVBdUA//8AyQAABI0F1RIGADEAAP//AHP/4wUnBfASBgAkAAD////6AAAE6QXVEgYANQAAAAEAIwAABL0F1QARAD60ExEGDRIQ1MTUxDEAtkIQDYEGlQUv7OwyMEtTWEASDxEADQwQERERAA8RDA4RDQ0MBQcQ7BDsBxDsCBDsWSUGBwYjIzUzMjc2NzcBMwEBMwKPFSBP+00/dy4cEi3+IdkBcwF12bUyJl2qGxEqagRr/JQDbAADAHkAAAZqBdUABgANAB8APUARIRAKGRoOABUcHQ0WAxkRECAQ/OzUPDz8PDzU7OwxAEAODQCVFxQVgR8HBZUdDh8v3DzsMhD03DzsMjABBgYVFBYXMzY2NTQmJwMkABEQACU1MxUEABEQAAUVIwMN2ebm2cvZ5OTZy/7D/qkBVwE9ywE9AVX+q/7DywSiFMzFxcsUFMvFxcwU/BAXASsBCQEJAS0Xi4sX/tX+9f73/tUXsv//AD0AAAU7BdUSBgA5AAAAAQDJ/r8F5QXVAAsAKUAMDQmVAAYcBwMcAgQMEPzs1Ow8/MwxAEAIBgKBCwgElQEv7DLM9DwwISERMxEhETMRMxEjBTv7jsoC3sqqqgXV+tUFK/rV/hUAAAEArwAABLMF1QAPACRAChEEAQ0cDgccBhAQ3OzU7DLsMQC3ApULrQ0GgQAv5DL07DAhESEiJjURMxEUFjMhETMRA+j+X7reyXx8AXjLAmTp7gGa/nafngLH+isAAQDJAAAHxQXVAAsAKkANDQQCHAMKHAsHHAYEDBD87NT81OzsMQBACAoCBoEACJUFL+wy9Dw8MCUhETMRIREzESERMwSsAk/K+QTKAk/KqgUr+isF1frVBSsAAQDJ/r8IbwXVAA8AMkAPEQ2VAAocCwYcBwMcAgQQEPzs1PzU7Dz8zDEAQAoGCgKBDwwIBJUBL+wyMsz0PDwwISERMxEhETMRIREzETMRIwfF+QTKAk/KAk/KqqoF1frVBSv61QUr+tX+FQAAAgA8AAAGGAXVAAwAFwAqQBYClQOBABKVBa0TlQAQDRkJEgQcAQMYEMzc7DLU7MwxAC/s9OwQ9OwwIREhNSERITIEFRQEIwE0JyYjIREhMjc2AfX+RwKDAU77ARD+8PsBNk9Oo/68AUShUE8FK6r9mtre3doBt4tEQ/3dREP//wDJAAAGRgXVECYAowAAEAcAKgSzAAAAAgDJAAAE7AXVAAoAFQAkQBMFlQ2tC4EGlRUXABkRBQwcCwQWEPzsMtTszDEAL+zk9OwwATQnJiMhESEyNzYBMxEhMgQVFAQjIQQXT06j/rwBRKNOT/yyygFO+wEQ/vD7/egBt4tEQ/3dREMEqP2a2t7d2gABAG//4wUjBfAAGABOQAkaBQgZEwcADhkQ3DzM1OwyzDEAQBcGlQetGQ2hDq4LlRCRGQChGK4ClRaMGRD07PTsEPTs9OwQ9OyxBwtJsQIGSVBYswcGQAIXOFkwExYhIBI3ITUhJgIhIAc1NiEgABEQACEgJ2/TAQABCO4W/OIDHhbu/vj/ANPQAQ8BTwGG/nr+sf711AFGvQEc76rvAR291Y7+Yf6Z/pj+YZAAAgDT/+MIMAXwAA8AJgA4QB8AlRSRJwiVHIwnIZUmrSSBIygMGRgEGSAQISUcJAQnEPzsMtQ87NTszDEAL+T07BD07BD07DABIgcGERAXFjMyNzYRECcmARI3NiEgFxYREAcGISAnJgMhESMRMxEFftyCgYGC3NyAgYGA/HMOtLQBOwE6vLy8vP7G/sW0tA7+0MrKBUykpP7l/uakpKSkARoBG6Sk/fMBGM3M0tP+nv6f0tPNzQEY/WsF1f1qAAIAiAAABMYF1QAIABYAQEALGAQUBRwRABkJDRcQ1MTs1Owy7DEAQAxCBpUQgQkVlQOtEwkvPPTsEPTsMEtTWLcVEQoWEQkKCQUHEOwQ7FkBFBYzIREhIgYBASYkNTQkISERIxEhAQGblZIBOv7GkpX+7QGYZP8AAQQBAgIEyv7y/nYEJ4OHAhKF+1YCjRqp187g+isCd/2JAP//AHv/4wQtBHsSBgBCAAAAAgBw/+MEfwY3AB0AKQA6QA4TFCtFJxIDURwhEglFKhD87DL07OzUxDEAQBEWqRGXKiS5Bh65CRwAuAaMKhDk9Dk57BDuEPTsMAEyABEQACMiAAMnJjU0NzYkJTY3FwYHBwYHBgcHNhciBhUUFjMyNjU0JgJ98AES/u7w8f72BwYFOlsBOwEIejYzMS36fkzHEweC05Ssq5WTrKwEe/7I/uz+7f7HATABHOV3KaB2uaACARGSFAERCSx1mTh3nOfJyefoyMfpAAADALoAAAQ+BGAACAARACAAL0ANDhIWIgUSHAAJCBJGIRD87DLU7MzU7DEAQAsAqQogCakSvAGpIC/s9OwQ1OwwAREhMjY1NCYjAREzMjY1NCYjJSEyFhUUBgcWFhUUBiMhAXIBBn6EhH7++vJohIRo/lYBtsXUbGp/jOfW/jkCBP6PX1paXgHJ/spTSkpPk5CFZ3kPGJhylqQAAQC6AAAD0ARgAAUAGbYHAgQIAUYGEPz83MwxALQEqQG8AC/07DAzESEVIRG6Axb9owRgk/wzAAACAGv+5QUdBGAABgAWADRADwIIDRKpGA8WAwgME6kWFxDc7NTsENTE/DzsMQBACwOpDLwRFQ4AFqkTL+wyMswy9OwwJSERIRUQBwU2NzYRNSERMxEjESERIxEBuwIW/n12/thbKGIC9ZOT/HSTkwM6jP5k3DYoVdMBqdT8M/5SARv+5QGu//8Acf/jBH8EexIGAEYAAAABAEYAAAbvBGAAEwCYQAsIBQEEBgkBCAwAFBDcPOwy1MQROTkxAEARQg0MEBMICQUCCBIDALwPCgYvPDzsMjIXOTBLU1hAFgcRBggRBQkEBgUDEQQCEQUICQkECQQJBxA8PATtEAXtBwgQ7QUQ7VkBQBMNAQgOAQcPAQYQAQURAQQSAQMAEEk6STpJOkk6STpJOgBACBMCEAUNCAwJEDwQPBA8EDwBMxEBMwEBIwEHESMRJwEjAQEzAQM/twHp1v5uAczF/oe7t7v+h8UBzP5u1gHpBGD98gIO/lH9TwI2yf6TAW3J/coCsQGv/fIAAQCF/+MDyAR8ACgATkALGRImKhASAxUgCikQ3MTE1OzM1OwxAEAWIIYfiBy5I7gpFKkVKQmGCogNuQaMKRD0/LAMS1FY/Bv0WewQ1OwQ9PywDEtRWPwb9FnsMAEWFhUUBCMiJic1FhYzMjY1NCYjIzUzMjY1NCYjIgYHNTY2MzIWFRQGAsJ8iv7+7lCpWkeqXZeplomUm3SHi3dHoWFiqkzE43gCXBiSbK22HByrJSVwWlhrmFlGQFwaHacYGJ2NXYEAAAEAugAABHkEYAAJAD9AFUIIAwkGvAIFC0YJBAcDCAAHCAZGChD87NTsETk57DEALzzkMjk5MEtTWEAKAxEJCQgIEQQEAwcQ7AcQ7FkBESMRASMRMxEBBHm3/eTstwIbBGD7oAOD/H0EYPx/A4H//wC6AAAEeQYUEiYArwAAEQcAcgCa/8wAI7QHChIDByuwDktUsBBLVFuwFUtUW1i7ABIAQAAK/8A4OFkxAAABALoAAASRBGAACwBZQAsIBQEEBgkBCABGDBD87DLUxBE5OTEAQAtCCAkFAgQDALwKBi887DIXOTBLU1hAFgcRBggRBQkEBgUDEQQCEQUICQkECQQJBxA8PATtEAXtBwgQ7QUQ7VkTMxEBMwEBIwEHESO6twIH4v5UAePO/nPFtwRg/fICDv5P/VECNcj+kwABAEwAAARzBGAADwAkQAoRRgoIBwsIBgEQENTU7NTs7DEAtwupBrwBqQAJLzzs9OwwMzU2NzYRNSERIxEhFRAHBky2OEQC9bj+e1hemRx+sQHFt/ugA81v/lDCzwAAAQC6AAAFTwRgAAwATUAWQgoHAgMIAwC8CQYMDkYHCAQKCABGDRD87Nzs7DEALzzE7DIRFzkwS1NYQBICEQgKCQMRBwgHAhEJAREKCgkFBxDtEO0HEO0IEO1ZEyEBASERIxEBIwERI7oBDQE+AT8BC7n+y7j+yrkEYP0SAu77oAOw/ScC2fxQAAEAugAABIEEYAALACdAFAmpAgQAvAcLDUYIBAgFCQEIAEYMEPzsMtzsMuwxAC885DLc7DATMxEhETMRIxEhESO6uQJVubn9q7kEYP43Acn7oAIE/fz//wBx/+MEdQR7EgYAUAAAAAEAugAABIEEYAAHAB9AEASpB7wCBgMICUYABAgHRggQ/OzU7OwxAC889OwwAREjESERIxEEgbn9q7kEYPugA838MwRgAP//ALr+VgSkBHsSBgBRAAD//wBx/+MD5wR7EgYARAAAAAEAPAAABG0EYAAHABy2CQEDCAYACBDc1PzczDEAtQMHqQC8BS/07DIwEyEVIREjESE8BDH+QrX+QgRgk/wzA80A//8APf5WBH8EYBIGAFoAAAADAHD+VgZnBdUACgAoADMAQkARNUUpEiEMBhkIJy4aABISRTQQ/OzUPDz8PDzU7OwxAEASLAi5HhW4GZc0MQO5JA+MC700EOz0POwyEOT0POwyMAEUFjMyNxEmIyIGAREGBiMiAhEQEjMyFhcRMxE2NjMyEhEQAiMiJicRATQmIyIHERYzMjYBL5F7YnJyYnuRAeA5g1On6emnU4M5uTmDU6fp6adTgzkB4JF7YnJyYnuRAi/rx6gCFKjH+zwCOV5OATUBEwETAT1MXgIE/fxeTP7D/u3+7f7LTl79xwPZ68eo/eyoxwD//wA7AAAEeQRgEgYAWQAAAAEAuv7lBRQEYAALAChADA0JqQYIAAcDCAJGDBD87NQ87PzMMQC3BgK8CwgEqQEv7DLM9DwwISERMxEhETMRMxEjBIH8ObkCVbmTkwRg/DMDzfwz/lIAAQCWAAAEAARgABEAO0ARAqkNDwe8ABNGAQ8IEAgIBxIQ3OzU7DLsMQAv5DLU7LAAsAIjSbANsA8jSVJYsQINuP/AsAIXOFkwIREhIicmNREzERQXFjMhETMRA0j+qZlmXLg0NWgBKbgB119WuAEc/vV1OzsB9vugAAABALoAAAaYBGAACwApQA0NRgIIAwoICwcIBkYMEPzs1PzU7OwxALcKAga8AAipBS/sMvQ8PDAlIREzESERMxEhETMEBQHaufoiuQHZuZMDzfugBGD8MwPNAAABALr+5QcrBGAADwAyQA8RDakKCAALBggHAwgCRhAQ/OzU/NQ87PzMMQBACgYKArwPDAgEqQEv7DIyzPQ8PDAhIREzESERMxEhETMRMxEjBpj6IrkB2bkB2rmTkwRg/DMDzfwzA838M/5SAAACAD4AAAUuBGAADAAVACxACxdFExIDDgsICAoWEMTc7DLU7OwxAEALCKkLvAcOqQwPqQcv7NTsEPTsMAEyFhUUBiMhESE1IREFIREhMjY1NCYDcdbn59b+OP6VAiQBB/75AQd+g4MCl6OoqKQDzZP+N5P+j19aWl4A//8AugAABZsEexAnAGgEIgAAEAYAwwAAAAIAugAABD4EYAAIABMAJUALFUUAEg8FCwgJRhQQ/Owy1OzsMQC3BKkLCbwFqRMv7OTU7DABNCYjIREhMjYBMxEhMhYVFAYjIQN6g37++gEGfoP9QLkBDtbn59b+OQFMWl7+j18Dbv43o6iopAAAAQBx/+MD5wR7ABgATUAJBQgSE0gHDgAZENw8zPTsMjEAQBcOhg2ICxiGAIgCuRYHqQa7C7kQuBaMGRDk9Oz07hD+9O4Q9e6xBwtJsQIGSVBYswcGQAIXOFkwNxYzMjY3ITUhJiYjIgc1NjMgABEQACEiJ3GenZPSE/3IAjIMn8eaoZ2mAQYBLf7b/v+9k9VWq9qTad9WrEb+w/7x/vL+wkgAAgDB/+MGTAR7AAsAHgA6QA8gRQkSEgMSGAwZHQgcRh8Q/Owy1Dzs1OzsMQBAEAC5D7gbBrkVjBsZqR4cvBsv5NTsEPTsEPTsMAEiBhUUFjMyNjU0JgE2EjMyABEQACMiACcjESMRMxEESpSsq5WTrKz9cRP58PABEv7u8PH++QnQuLgD3+fJyefoyMfp/sK+ARz+yP7s/u3+xwEu+P33BGD+QQACAHQAAAQiBGAACAAWADxACRQFCBEAEgkNFxDUxOzU7DIxAEALQgapELwJFakDEwkvPNTsEPTsMEtTWLcVEQoWEQkKCQUHEOwQ7FkBFBYzMxEjIgYBASYmNTQ2MyERIxEjAQF6gHf4+HeA/voBVnSa19kBtrnl/rYDHVNeAWFc/I8B6xqJj6Kh+6AB2f4nAP//AHH/4wR/BmsSJgCsAAAQBgBBWgX//wBx/+MEfwYQEiYArAAAEQcAYACWAAAAhbGSl0Kwk7CYQrGABEKxgQBCfLAPsAEjSbAjsB4jSWGwgGJosCNGYbAPRmCwkkOwAWAjQrCSQ7ABYEOwAFVYsB6wkkOwAWBDOLAeEbACNVmxgABCsYEAQhiwDxCwI7AesAEjSWg7sCMRsAM1ALASsCMjSbBAUFiwI7BAOLAjEbADNbACNVkAAAEAL/5WBJAGFAAfAD9ADxQXCBBOCB0JBQgBAwBGIBD8PMzsMjLM9PzMMQBAERSpEx8IAakHAgQahwoNBJceL+zUxOwQ3DzsMhDU7DATIzUzETMRIRUhETY2MzIWERQABzU2EjU0JiMiBhURI9+wsLkCHf3jQrJ2ttj+qdd69Xx8mqe5A9GPAbT+TI/+bWVk6f7q4v5ZKYwWAS7S0J/Env77//8AugAAA9gGbRImAKoAABAHAGIAhgAHAAEAcf/jA+cEewAYAE5ACgoLCBIQAkgWRRkQ/OQy/DLMMQBAFwKGA4gFEYYQiA65EwmpCrsFuQC4E4wZEOT07PTuEP707hD17rEJBUmxDgpJUFizCQpAAhc4WTABMhcVJiMiBgchFSEWFjMyNxUGIyAAERAAAqSmnaGax58MAjL9yBPSk52ek73+//7bAS0Ee0asVt9pk9qrVqpIAT4BDgEPAT3//wBv/+MDxwR7EgYAVAAA//8AwQAAAXkGFBIGAEoAAP////QAAAJGBhAQBgBnAAD////b/lYBeQYUEgYASwAAAAIATAAABr8EYAAWAB8ANkAOIUUaEgwRCB4HEggGASAQ1NTs1Dzs1OzsMQBADh6pCR+pEBKpBrwBqQAQLzzs9OwQ7NTsMDM1Njc2ETUhETMyFhUUBiMhESEVEAcGJTI2NTQmIyMRTLY4RALYq9bo59b+m/6aWF4DeH6EhH6jmRx+sQHFt/43o6iopAPNb/5Qws92X1paXv6PAAACALoAAAa3BGAAEgAbADhAEB1FFhIFChIIGgALDwgNRhwQ/Owy3DzsMtTsMQBADROpCRoLqQEQEg68CQ0vPOQy3DzsMhDsMAERMzIWFRQGIyERIREjETMRIREBMjY1NCYjIxEETqvW6OfW/pv93rm5AiIBXH6EhH6jBGD+N6OoqKQCBP38BGD+NwHJ/DNfWlpe/o8AAQAvAAAEiQYUABsAOkAPCBkTCBBOGQkFCAEDAEYcEPw8zOwyMvTsEMwxAEAOCAGpBwIEFocKDQSXEhovPOzUxOwQ3DzsMjATIzUzETMRIRUhETY2MzIWFREjETQmIyIGFREj37CwuQId/eNCs3W9yrh8fJipuQPRjwG0/kyP/m1lZOrt/tABKp+ewaH++wD//wC6AAAEkQZtEiYAsQAAEAYAYm8H//8AugAABHkGaxImAK8AABAGAEFdBf//AD3+VgR/BhQSJgC6AAAQBgByXswAAQC6/uUEgQRgAAsAKUANDUYGCAcLqQkDCAJGDBD87NT81OzsMQC3CwSpBgK8CQEvPOQy7MwwISERMxEhETMRIREjAlT+ZrkCVbn+ZpMEYPwzA837oP7lAAEAc//jBwUF1QA0ADhAFCQSJTYQIBwpFhwXDRwECRIIBBA1EPzc7BDs1PzU7Ozc7DEAQAkWJAiBERyVLQAvPOwy9DzMMAUiJyYRNBM2NzMGAwYVEBcWMzI3NjU1MxUUFxYzMjc2ETQnAiczFhcSFRAHBiMiJyYnBgcGAjrTeXtkO135VIdDSEl9ckhHx0ZGdIZBR0OHVPpfOGR7e9GSZWQnJ2RlHbG0AZjJAQ6ff0b+v5+3/s1rbWloxvHxxmhpbXcBJ7efAUFGgpz+577+ZrKxXl6trV5e//8Ah//jBicEYBAGAHYAAAACAB4AAAWxBdUAEgAdADpADh8TGQUNERkPABwLCQ0eENw8zPw8PMwQ1OzMMQBADwoSlQwQDoEJGJUBrRmVCS/s9OwQ9NQ87DIwARUhMgQVFAQjIREhNSE1MxUhFQE0JyYjIREhMjc2AlgBTvsBEP7w+/3o/pABcMoBcQETT06j/rwBRKNOTwRR4tre3doEUaTg4KT9ZotEQ/3dREMAAAIAHgAABOcGFAAHABkAOkAPG0UAEhcJEQUTDxwLCQ0aENw8zPw8PMwQ1OzsMQBADgkRqQsPDQSpEw2XBakIL+zk1OwQ1DzsMjAkNCYjIREhMgURITUhETMRIRUhESEyFhAGIwQjg37++gEGfv3D/rsBRbkBqf5XAQ7W5+fW8rRe/o+TA82TAbT+TJP+yqP+sKQAAQDT/+MHGwXwACsAAAERIxEzETMSNzYhMhcWFxUmJyYjIAcGByEVIRIXFjMyNzY3FQYHBiMgJyYDAZ3KytIencMBU4Z2d2hmc3SC/wCIZxkCsv1GB4GJ/4J0c2Zqd3aE/q3DugkCx/05BdX9nAEIp9AkI0fVXy8vnHfGqv7zlJ0vL1/TSCQkz8YBTwABAMH/4wWBBHsAIwAAATIXFSYjIgcGByEVIRYXFjMyNxUGIyAnJicjESMRMxEzNjc2BD6mnaGa5lwiDAHM/iwNnlV4nZ6TvP7zlHsKk7i4mBd6lwR7RqxWtEFXj/ReM1aqSK2Q5P38BGD+M8qAngAAAgAQAAAG+AXVAAsADgAAISMBIREjESEBIwEzEwEBBvjh/ur+6cr+5/7q4QMC5bH+3P7cAhv95QIb/eUF1fzzAjf9yQACADMAAAYRBGAACwAOAAAhIwMjESMRIwMjATMTAwMGEcPs47jl7MMCjsOR8/MBlf5rAZX+awRg/bkBof5fAAIAyQAACRQF1QATABYAACEjASERIxEhASMBIREjETMRIQEzEwEBCRTh/ur+6cr+5/7q4QFv/fjKygJfATzlsf7c/twCG/3lAhv95QLH/TkF1f2cAmT88wI3/ckAAgDBAAAH0ARgABMAFgAAISMDIxEjESMDIwEhESMRMxEhATMTAwMH0MPs47jl7MMBHP5ruLgB6QEew5Hz8wGV/msBlf5rAef+GQRg/hcB6f25AaH+XwACAHMAAAXZBdUAFwAaAIJAFBkaDg0UHA8TDgAHHAwIDRgAHAMbENzsOczctA8ITwgCXTnsEMzctgATQA5AEwNdOewREjk5MQBADkIMDxEAAxmVGA2BFAgCLzw89Dns1DzsMjBLU1hAFBgRDxoYGREODw4YEQwZGBoRDQwNBwUQ7QgQ7QcFEO0IEO1ZskAcAQFdAREjEQYHBhEjEDc2NwEhARYXFhEjECcmJwEhA4vKk2SC1b14qv5RBRL+UKR0vNWAYPgBPv2DAln9pwJZHH6k/uUBYtKGMQLq/RMygtL+ngEeoXrKAigAAgBrAAAEewRgAAIAGgB+QBQAAQMaCRwECAMNFBwZFRoCDRwQGxDc7DnM3LKAFQFdOewQzNyyMAMBXTnsERI5OTEAQA5CGQQRDRAAlQIavAkVDy88PPQ57NQ87DIwS1NYQBQCEQQBAgARAwQDAhEZAAIBERoZGgcFEO0IEO0HBRDtCBDtWbRwHI8cAgFdASETAQEWFxYRIzQnJicRIxEGBwYVIxA3NjcBA0X+XdECCP67a0uJw1Y6VrhTOFbCiUps/rsDtv6WAhT9zCZWnP7sx3RPGv5cAaIaS3TJARScVScCNAAAAgDJAAAHxAXVAB4AIQAAAQEhARYXFhEjECcmJxEjEQYHBhEjEDc2NyERIxEzEQUBIQPv/p8FEv5QpHS81YBgmcqTZILVvVVu/bXKygOEAT79gwNxAmT9EzKC0v6eAR6heiD9pwJZHH6k/uUBYtJfNP05BdX9nG4CKAACAMEAAAYuBGAAHgAhAAABASEBFhcWESM0JyYnESMRBgcGFSMQNzY3IREjETMRASETAzf+5wQQ/rtrS4nDVjpWuFM4VsKJGx/+kri4A3/+XdECdwHp/cwmVpz+7Md0Txr+XAGiGkt0yQEUnB8Y/hkEYP4XAT/+lgABAHP+VgRzB3oAUwAAARQHBiMiJiMiFRQzMjc2FxYXFSYjIgYjIicmNTQ3NjMhMjc2NTQnJiM1MhYzMjc2NTQhIgc1NjcDMxM3Njc2NzYzMhcVJyYjIgcHFhcWFRAFFhcWBHNzmMZEuiNg3EGAdCBiVER0O/w8fUqjNT91AV9oRkG7WPkSVhejUnX+xaXeoIGfc6BqHg8XFyNCGiMnCw8iMlqmYnL+741SVQG+z2eICIJyDAsCByWnJxssYZJ6UV5YUmq9NxmmAiY2je5KtC0NAYP+g95AGCcSGwpXBQJvyhhXZKf+/UUeXGAAAAEAW/50A8gGBgBPAAABFAcGIyImIyIVFBcWMzI2MzIXFSYjIgYjIicmNRAzITI2NTQnJiciIzUyFzIzIDU0JyYjIgc1NjcDMxM3Njc2MzIXFSYjIgcHBBUUBxYXFgPIdm2iRKgZUGIhJyyyLWNYO2Ix0jJpP4nEASxabk48cgWyCyEgFQE1Xkhckbh+Zp9zoGovFStRGiMyDyIyWwEw6G9HUAFSnl5WCIFhGwkkJ4siFyVSlwEMYFlMOCsImAGgUSohN6cfCwGD/oPeYxcyClcHb8ov8sQyFkBJAAABABAAAAbBBdUAHAAAAScmIyIHBgcBIxEjESMBMwEzETMRMxM2NzYzMhcGwToZICUdQjz+5PrK+v5cwwFefcp96E5oQoEzOAUUBwMZOKH9Cv7KATYEYPxUA+v8EwJy1FAzEAAAAQAy/lYG0AYeABwAAAEnJiMiBwYHASMRIxEjATMBMxEzETMTNjc2MzIXBtA6GSAlHUI8/uT6t/r+XMMBXn23fehOaEKBMzgD3gcDGTih/Qr+VgGqBGD8VAVq+pQCctRQMxAA//8Ac//jBdkF8BIGAGsAAP//AHH/4wR1BHsSBgBwAAAAAQAQAAAGJwXwABIAAAEyFxUnJiMiBwYHASMBMwEBEjYFqT8/RBYZSSJHVP6B5f3G0wHZAThzrgXwFbsKBCJD3fwUBdX7FwM9ATKVAAEAMgAABR8EewATAAABMhcVJyYjIgcGBwEjATMBEzY3NgS0Mzg6EyYlHUE9/uT6/lzDAV7oUGZCBHsQjQcDGTei/QoEYPxUAnDVTzMA//8AEAAABicHcBAnAcEE5AF6EgYA6wAA//8AMgAABR8GZhAnAHQEwgAAEgYA7AAAAAMAc/5WB7MF8AARAB4ALAAAAQEGBwYjIzUzMjc2NxMBMxMTARAHAiADJhA3EiATFgMQJyYgBwYREBcWIDc2B7P+FFJGSnyTbEwqJjd8/qLD/f39P19+/gB/YGB/AgB+X9UcOP6YOhwdOQFoORsEYPs4yzo9miQhiQE3A2v9igJ2/or+3dD+7AET0QJE0QEU/u3R/t4BBnLq6nT++/78dOrqcgAAAwBx/lYG/wR7ABEAHwAlAAABAQYHBiMjNTMyNzY3EwEzExMAEAcGIyInJhA3NjMyFwIQIyIQMwb//hRSRkp8k2xMKiY3fP6iw/39/XVfc8zOdGBgdM7Mc2Tb4OAEYPs4yzo9miQhiQE3A2v9igJ2/qv+SKfJyKYBvKbIyfzNA2D8oAAAAgBz/+MHLQXwACkAUgAAJTMyNzY1NCcmIyMGBwYHBiInJicmJyMiBwYVFBcWMzM2NzY3NjIXFhcWByMgJyYQNzYhMzY3Njc2MhcWFxYXMyAXFhEQBwYhIwYHBgcGIicmJyYEXR7rcoCAcuseCw8WGxo+GhsWEAou63KCgnLrLgoQFhsaPhobFhD+Lv6hmL29mAFfLQsQFhsaPhofEhALHQFemLy8mP6iHQoRFhsaPhofEhDCkaTy86SRFA4VDAsLDBUQEpGk8/KkkRIQFQwLCwwVEKGq0gJ006oVDxUMCwsOExETqtP+xv7H0qsTERUMCwsOExEAAgBx/+MFoQR7ACYAUAAAJTMyNzY1NCcmIyMGBwYGIiYnJicjIgcGFRQXFjMzNjc2NjIXFhcWByMgJyY1NDc2ITM2NzY3NjIXFhcWFzMgFxYVFAcGISMGBwYHBiInJicmA3ItoUhWVj+qLQcKEiw0LBIKBy2jR1ZVSKMtBwoSLDQWGw0JyS7+/3iJiXQBBS4HCQ0bFjQWGw0JBy4BAneJiXT++y4HCQ0bFjQWGw0JpGB0t6eDYQsKERQUEQoLX3S4vHBfCwoRFAoMDwqTiZzu6aKICgoPDAoKDA8KCoic7+iiiQoKDwwKCgwPCv//AHb/4wj6B3QQJgG0AAAQJwD9BpcAABAHAPsGMAEn//8AmP/jB6EGEBAmAbUAABAnAP0F/P6cEAcA+wWV/8P//wBz/+MHBQczECcBwgBjAVMQBgDXAAD//wCH/+MGJwXgECYBwgAAEAYA2AAAAAEAc/5WBScF8AAdADlACgAcGw0wFhkFEB4Q/Oz81LQvGz8bAl3sMQBADA6hDa4SlQmRHBqVAC/szPTs9OwwtA8fHx8CAV0hIyAnJhEQNzYhMhcWFxUmJyYjIAcGERAXFjMhESMD+q7+pbvDw8MBU4Z2d2hmc3SC/wCIiIiY8AFrycbQAVMBaM/QJCNH1V8vL5yd/tj+04KU/bAAAAEAcf5WA+cEewAdADlACh0SGgxIFRIERR4Q/Oz01OwxAEAMDIYNiBG5CLgcGakAL+zM9Pz17jBACw8fEB+AH5AfoB8FAV0hICcmNRA3NiEyFxYXFSYnJiMiBwYVFBcWMzMRIxECmP77jZWXlgEGVVFRTE5PTlCzY2NjY7P1yZaf+gESnZ0REiOsKxYVcXLNuXJx/cMBqgAAAQA7/6UDygOnABMAAAEHJwcXBycHJzcnNxc3JzcXNxcHA8pk2GnYZNh9rn3YZNhp2GTYaa5pAhGufbV9rn3YZNh9rn21fa59tWS1AAH72gTe/0IGegAvAAABIRQHBgcGBwYiJyYnJicmNTQ3Njc2NzYzITQ3Njc2NzYyFxYXFhcWFRQHBgcGBwb+uf4zCgsTFBkYOBgZFBMLCgoLExQZGBwBzQoLExQZGDgYGRQUCgoKCxMUGRgFZxsZGxITCwoKCxMSGxkbHBkbEhMLChsZGxITCwoKCxMVGBkcGxkbEhMLCgAAAf0HBSkACQZNAA0AABMjJiMiBwYHNTY3NjMgCXYXol1bk4iLSnd9ASQFKZsvSxeGJypDAAH9swTC/qUGYQAIAAABIhE1MxUjFDf+pfLxhYYEwgELlJ6dAwAAAf2zBML+pQZhAAgAAAEQIzUWNSM1M/6l8oaF8QXN/vVnA52eAAAB+coE2QAJBk0ADQAAARIhMgUEJRUkJyQnJgf5yocBr3IBRQEyASD+X+/+2WbdmAUBAUx7dAGGF1xxBwzPAAj31v6QA0YHYAAMABkAJgAzAEAATQBaAGcAAAEjJiYjIgYHIzY2IBYBIyYmIyIGByM2NiAWBSMmJiMiBgcjNjYgFgEjJiYjIgYHIzY2IBYFIyYmIyIGByM2NiAWASMmJiMiBgcjNjYgFgUjJiYjIgYHIzY2IBYBIyYmIyIGByM2NiAW/sd2C2FXVmANdgqeASKeAzh2C2FXVmANdgqeASKe+a52C2FXVmANdgqeASKeBmZ2C2FXVmANdgqeASKe+a52C2FXVmANdgqeASKeB7d2C2FXVmANdgqeASKe9wx2C2FXVmANdgqeASKeBIl2C2FXVmANdgqeASKeBkFLS0pMj5CQ/lFLS0pMj5CQj0tLSkyPkJD6AUtLSkyPkJCPS0tKTI+QkAIpS0tKTI+QkI9LS0pMj5CQ+5hLS0pMj5CQAAAI+Fj9wwLCCC0ABQALABEAFwAdACMAKQAvAAAnNxcTBwMBBycDNxMBJzclFwUBFwcFJyUBNTMFFSUlFSMlNQUBIzUTMwMDMxUDIxNrlnlvXKn7d5Z5b1ypBR+WegFWXP7j+kyVef6pWwEcBmCsAUD+wPjCrP7AAUAEX9OkgVLT06SBUlqWef6pXAEdBbWWeQFXXP7j/vGVem5bqft3lnlvXKgCGNSkglLU1KSCUgLfrAFA/sD4wqz+wAFA//8Ayf5WBfwHbRAmAcMAABAHAb8E9QF1//8Awf5WBTgGFBAmAcQAABAHAHIAoP/MAAIAIQAABOwF1QASAB0AOkAOHxMZBQ0RGQ8AHAsJDR4Q3DzM/Dw8zBDU7MwxAEAPChKVDBAOgQkYlQGtGZUJL+z07BD01DzsMjABFSEyBBUUBCMhESM1MzUzFTMVATQnJiMhESEyNzYBkwFO+wEQ/vD7/eioqMqoAdxPTqP+vAFEo05PBFHi2t7d2gRRpODgpP1mi0RD/d1EQwACACYAAARFBZ4ACgAeADlADyBFABIRFh4GDBwcGBYaHxDcPMz8PDzMENTs7DEAQA0WHqkYHBoFqQwaBqkVL+zE1OwQ1DzsMjABNCcmIyERITI3NgERITIXFhAHBiMhESM1MxEzETMVA4E+Q4D++QEHgUI+/fgBD9B5dHRz1v45m5u4nQFMXiou/pcuKwLf/spVUv6wUlID0Y8BPv7CjwAAAgDJAAAE4QXVAA8AHAAAARcHJwYjIxEjESEyFxYVFCc2NzQmIyMRMzI3JzcEVYxqkn7W/soByPuAgeIMAZqN/v5yR9dqAyN1fntT/agF1XFy25ItLDmGkv3PL7R+AAIAuv5WBKQEewAQACkAACUnNxc2NTQnJiAHBhAXFjMyBRcHJwYjIicmJxEjETMVNjc2MzIXFhAHBgMqjG6KT1NU/txUU1NUkkYBG5NvlVdse1hZOrm5OllYe8x/gIAMmKddpXPFy3RzdHP+anRzFK5dsy4wMWT9rgYKqmQwMaKi/fCiDwAAAQDJAAAEagcHAAcAG0ANAwaVAYEAAwQGHAEECBD8/NzMMQAv9OzMMDMRIREzESERyQL3qv0pBdUBMv4k+tUAAAEAugAAA9AFmgAHAB23CQMEBggBRggQ/PzczMwxALUDBqkBvAAv9OzMMDMRIREzESERugKDk/2iBGABOv4z/DMAAAEARwAABO8F1QANAClAFAEMlQkECJUFgQAPBgoMCRwCBAEOENw8zPw8zMzEMQAv9PzcPOwyMCERITUhESEVIREhFSERAU7++QEHA6H9KQIj/d0ClKoCl6r+E6r9bAABADgAAARVBGAADQArQAoPBgoMCQgCBAEOENw8zPw8zNzMMQBACgEMqQkECKkFvAAv9PzcPOwyMCERITUhESEVIREhFSERAT/++QEHAxb9ogGg/mAB9KoBwp3+26r+DAABAMn+ZgTMBdUAGwAzQAwSGBwEHQwABhwDBBwQ/Pw83MzE/MwxAEAOEpURsAIAlQcCBpUDgQIv9OwQ1OwQ9OwwAREjESEVIREhMhcWFREQBiMjNTMyNzY1ETQmIwGTygOh/SkBobpxbczkTD6GODd8fALH/TkF1ar+Rndy7v7O/vL0qktLwgEin54AAAEAuv5WBAsEYAAdADNADBMZCAQfDAAGCANGHhD8/DzczMT8zDEAQA4TqRK9AQCpBwEGqQO8AS/07BDU7BD87DABESMRIRUhETMgFxYVERQHBiMjNTMyNzY1ETQnJiMBcrgDFv2i+gEHRlJSUbXBrG4hJiYxhgHn/hkEYKr+wUdR5f7y1mBgnDA3kwEIqiApAAEAKP6/CJEF1QAXAAABMxEBMwEBMxEjESMBAREjEQEBIwEBMwED6soCqvX93wHXiMUp/hP+/sr+/v4T0wJE/d/1AqoF1f0eAuL9s/0i/hUBQQMB/un+FgHqARf8/wOIAk39HgABAEb+5QcDBGAAFwAAATMRATMBATMRIxEjAQcRIxEnASMBATMBAz+3AenW/m4BZnq4If6Hu7e7/ofFAcz+btYB6QRg/fICDv5R/ej+TAEbAjbJ/pMBbcn9ygKxAa/98v//AIf+dQSaBfAQJgBjOQASBgCOAAD//wCF/nUDyAR8ECYAY84AEgYArgAAAAEAyf6/BbQF1QAPAAATMxEBIQEBMxEjESMBAREjycoC0gED/b8B7aDFRf36/u/KBdX9HgLi/bL9I/4VAUEDAf7p/hYAAQC6/uUEswRgAA8AABMzEQEzAQEzESMRIwEHESO6twIH4v5UAXeOuDj+c8W3BGD98gIO/k/96v5MARsCNcj+kwAAAQDJAAAFhgXVABIAABMzETcRMxUBIQEBIwERIxEHESPJyq1kAcEBA/2/Al/c/fpkrcoF1f0esQFU7gHL/bL8eQMB/iUBdbH+FgABALoAAASRBGAAEgAAEzMRNzUzFQEzAQEjAREjNQcRI7q3YGUBQuL+VAHjzv5zZWC3BGD98mHddgFG/k/9UQI1/sXUYf6TAAABACEAAAWGBdUAEwAAEzMVMxUjEQEhAQEjAQERIxEjNTPJyqioAtIBA/2/Al/c/fr+78qoqAXV4JD+jgLi/bL8eQMB/un+FgRlkAAAAQA9AAAEkQYUABMAABMzFSEVIREBMwEBIwEHESMRIzUzurcBZP6cAgfi/lQB487+c8W3fX0GFHp9/TUCDv5P/VECNcj+kwUdfQABADIAAAayBdUADQBfQAsIBQEEBgkBHAwADhDU3Owy1MQROTkxAEAOQg2gAAgJBQIEAwCvCgYvPOwyFzkQ7DBLU1hAFgcRBggRBQkEBgUDEQQCEQUICQkECQQJBxA8PATtEAXtBwgQ7QUQ7VkTIREBIQEBIwEBESMRITICjQLSAQP9vwJf3P36/u/K/j0F1f0eAuL9svx5AwH+6f4WBSsAAQAqAAAFggRgAA0AX0ALCAUBBAYJAQgLAA4Q1NzsMtTEETk5MQBADkINoAAICQUCBAMAvAoGLzzsMhc5EOwwS1NYQBYHEQYIEQUJBAYFAxEEAhEFCAkJBAkECQcQPDwE7RAF7QcIEO0FEO1ZEyERATMBASMBBxEjESEqAjgCB+L+VAHjzv5zxbf+fwRg/fICDv5P/VECNcj+kwPGAAABAMn+vwYEBdUADwA2QBoMlQKtBACBBpUJDgoHlQoLAxwFOA0BHAAEEBD87DL87DI87DEALzzM7OQy/OwwslARAQFdEzMRIREzETMRIxEjESERI8nKAt7KycnK/SLKBdX9nAJk+tX+FQFBAsf9OQAAAQDB/uUFQARgAA8AMUAaDakCBAC8BqkJCw8RRgwECAepCgUNAQgARhAQ/Owy3Dzs7DLsMQAvPMzs5DLc7DATMxEhETMRMxEjESMRIREjwbgCV7i4uLj9qbgEYP4zAc38Of5MARsCBP38AAEAyQAACBIF1QANAC1AGAaVBAqVAq0EAIEMCAUJAxwHOAsBHAAEDhD87DL87DLEMQAvPOQy/OwQ7DATMxEhESEVIREjESERI8nKAt4Dof0pyv0iygXV/ZwCZKr61QLH/TkAAQDBAAAG5gRgAA0AK0AWBqkEC6kCBAC8CQ0FCgQIBwsBCABGDhD87DLc7DLEMQAvPOQy3OwQ7DATMxEhESEVIREjESERI8G4AlcDFv2iuP2puARg/jMBzar8SgIE/fwAAQDJ/mYIdAXVAB0AOEAOHw8cExoDHAAIBBwHBB4Q/OzUPOzczPzMMQBADx2VCq0CA5UHgQYTlRQGAi883OwQ9OwQ9OwwAREjESERIxEhESEyFxYVERAGIyM1MzI3NjURNCYjBTvK/SLKBHIBobpxbczkTD6GODd8fALH/TkFK/rVBdX9nHdy7v7O/vL0qktLwgEin54AAQDB/lYHIQRgAB8AM0AOIQ8IFBsDCAAIBAgHRiAQ/OzUPOzczPzMMQBACx8JA6kHvAITFQIGLzzczBD07NzMMAERIxEhESMRIREzIBcWFREUBwYjIzUzMjc2NRE0JyYHBIi4/am4A8f6AQdGUlJRtcGsbiEmJjGGAef+GQPG/DoEYP4XR1Hl/vLWYGCcMDeTAQikJi4FAAACAHP/4wb3BfEAQQBZAAAlLgM1ND4EMzIeBBUUDgIHFhYzMjY3FQYGIyIuAicGBiMiJCYCNTQSNjY3FQ4DFRQeAjMyNjc+AzU0LgQjIg4EFRQeAgQrOWxSMhMqRGGBU059YUYtFRo/alEmaDs+ZTMueD0mUVVXK0LDear+9LxjW6z3nXOrcDg8e76BUoCxP1MwFAsXJDA+JjFIMyESByhCVK4xiarEa0KKg3RXMjJUcHt/OlO0sqpKGhUTGqgXEggUIxsmNHTPAR2ooAEQy30OpxZmms18fd6nYhltOoaOkUUvZmNZQygrR1tgXyZiq45uAAIAcf/jBXgEegA/AFAAABM0PgI3FQ4DFRQeAjMyNjcuAzU0PgIzMh4CFRQGBxYWMzI+AjcVDgMjIiYnDgMjIi4CBT4DNTQuAiMiDgIVFHFLj9GGXYpbLTJgilgnVhwkPy8bKFB0TUJwUC1cXyNEHhstKSoYESUtOCU3gkMeRklHH4fUkUwDViItGgsWISgSGiwhEwIog9icWAObBkZymFhioHI+CxElZ3iCQF2fc0E5aJJZm/FeEwoEChMPnQoRDAccLBIbEglUmda4Jl5kYytLaUIfJkhpQ/f//wBz/nUFJwXwECcAYwEtAAASBgCYAAD//wBx/nUD5wR7ECcAYwCPAAASBgC4AAAAAf/6/r8E6QXVAAsALEANDQpAARwECxwIQAUIDBDE3Oz8POz8xDEAQAkKBpUJgQGVAwUvzOz07DIwJTMRIxEjESE1IRUhAtfJycv97gTv/e6q/hUBQQUrqqoAAQA8/uUEbQRgAAsAKEAKDQkBCAQLCAYIDBDc3Pw87NzMMQBACQsHqQi8AKkDBS/M7PTsMjAlMxEjESMRITUhFSECr7i4tf5CBDH+Qpn+TAEbA7aqqv////wAAATnBdUSBgA6AAAAAQA9/lYEfwRgAAgAb0AQBAi8AgkGAwAIAwQACAMECRDUS7AKVEuwCFRbWLkACwBAOFlLsBRUWLkAC//AOFnU/Ek6ERI5MQAQzOQyMEAZBxEIAAgGEQUGAAgABhEGBwMDBAURBAQDQktTWAcQBe0HEAjtBxAI7QcQBe1ZIiURIxEBMwEBMwLFw/47wwFeAV7DEv5EAbwETvyUA2wAAf/8AAAE5wXVABAAAAEhESMRITUhNQEzAQEzARUhA9/++Mv++QEH/fDZAZ4Bm9n98AEIAXP+jQFzqqoDDv2aAmb88qoAAAEAPf5WBH8EYAAQAAABARUhFSEVIzUhNSE1ATMBAQR//kYBBv76w/7vARH+O8MBXgFeBGD7sliqurqqWARO/JQDbAAAAQA9/r8FOwXVAA8AACUzESMRIwEBIwEBMwEBMwEEy3DFFP5c/lnaAhX+L9kBcwF12f4gqv4VAUECe/2FAx0CuP3VAiv9MwAAAQA7/uUEeQRgAA8AACUzESMRIwEBIwEBMwEBMwEECHG4If66/rrZAbP+ctkBKQEp2f5rmf5MARsBuP5IAkoCFv5xAY/93wAAAf/6/r8HRwXVAA8ANUAQEQWVCAIcAwoNQA8cDEAKEBDU5PzkENTsPPzMMQBACw8KlQIMgQcEAJUJL+wyzPQ87DIwJSERMxEzESMRIREhNSEVIQLWAt7Kycn7jv3uBO/97qoFK/rV/hUBQQUrqqoAAAEABf7lBkIEYAAPADNADhEFqQIICAMKDQ8IDAoQENzE/MQQ1Dzs/MwxAEALDwupAgy8BwQAqQkv7DLM9DzsMjAlIREzETMRIxEhESE1IRUhAngCWri4uPw5/kIEMf5CmQPH/Dn+TAEbA7aqqgAAAQCv/r8FfAXVABQALkAMARYEBhMcBBQNHAwVENzs1DzsMuwyMQBACweVEa0TDIEAlQMFL8zs5DL07DAlMxEjESMRISInJjURMxEUFjMhETMEs8nJy/5funFtyXx8AXjLqv4VAUECx3dy7gE3/tmfngJkAAABAJb+5QS4BGAAFQBGQAwBF0YGFAgEFQ0IDBYQ3OzUPOwy7DIxAEAKB6kSFAy8AKkDBS/M7OQy1OywBbAHI0mwErAUI0lSWLEHErj/wLACFzhZMCUzESMRIxEhIicmNTUzFRQXFjMhETMEALi4uP6pmWZcuDQ1aAEpuJn+TAEbAglfVrjq03U7OwG+AAEArwAABLMF1QAYAAABIyInJjURMxEUFjMzETMRMxEzESMRIxEjAoI7unFtyXx8EpDWy8vWkALHd3LuATf+2Z+eATn+xwJk+isCx/7PAAEAlgAABAAEYAAYAAABNTMVMxEzESMRIxUjNSMiJyY1NTMVFBcWAfmgr7i4r6AImWZcuDQrAqTCxAG++6ACCcTEX1a46tN1OzAAAQCvAAAEswXVAA8AJEAKEQgcBgwAHA8EEBD87DLU7MwxALcClQutD4EHDi889PTsMAERITIWFREjETQmIyERIxEBegGhut7JfHz+iMsF1f2c6e7+ZgGKn579OQXV//8AugAABGQGFBIGAEkAAAACABT/4wcUBfAAIgAqAElAESMkCQ8kGQgzCRkYHhIdABgrENwy3OwQ7PTsxBESOTEAQBYQoQ+uDB4YCJUAJK0MlRQolQSRFIwrEOT07BDs9DzsMswQ9OwwARI3NiEgFxYTIRAAITI2NxUGBwYjICcmAwYnJjU1MxUUFxYlISYnJiAHBgGyIpa8AToBQ7W7AftwARIBEov8cG+DhJL+osW8Cqp2eqpLQgFAA60YYoL+SIBhA20BCqfS0tv+hP70/s5gX9dGJCTNwgFVAWdr30w+oEE5Ar98pKR8AAIAD//jBWYEewAlAC4AaUARLiYVHSYIE0sABhIFFRILAC8Q3DLs3EALAAVwMH8FsDDPMAVd7BD07MQREjkxAEAaEyYUHoYdiBkGCyapFBm5IgAUuyq5D7gijC8Q5PTs5LJvFAFdMhDsEPw8zBD0si8dAV3sERI5MAEiJyY1NTMVFBcWMzY3NjMyFxYVFSEWFxYzMjc2NxUGBwYjICcmASYnJiMiBwYHAViQWWCcMDlKGnSS/+KDhPyyDGZnt2pkY2JoY25l/vOclANOAlJTiJpdXA4CBFJarEYxlyEmxYKhkZL6Wr5kYxoaNK4sFBaclAGBl1paV1eeAAACABT+hwcUBfAABwAtAAABISYnJiAHBgcSNzYhIBcWEyEQACEyNjcVBgcGBxEjESQnJgMGJyY1NTMVFBcWAosDrRhigv5IgGHxIpa8AToBQ7W7AftwARIBEov8cG+DbXey/v2gvAqqdnqqS0IDbb98pKR8vwEKp9LS2/6E/vT+zmBf10YkHgX+owFjIKbDAVQBZ2vfTD6gQTkAAgAP/rcFZgR7AAgAMQAAASYnJiMiBwYHByInJjU1MxUUFxYzNjc2MzIXFhUVIRYXFjMyNzY3FQYHBgcRIxEmJyYErgJSU4iaXVwOxpBZYJwwOUoadJL/4oOE/LIMZme3amRjYmhjT0qmwnuUApSXWlpXV56PUlqsRjGXISbFgqGRkvpavmRjGho0riwUEAT+0gEzGnuUAP//AMkAAAGTBdUSBgAqAAD//wAoAAAIdgdtECcBvwZbAXUSBgCNAAD//wBGAAAG7wZIECcAcgGoAAASBgCtAAAAAQDJ/mYFNQXVABwAAAEzMhcWFREQBiMjNTMyNzY1ETQmIyERIxEzEQEhAqmLunFtzORMPoY4N3x8/ojKygKeAQQDcXdy7v7O/vL0qktLwgEin579OQXV/YkCdwABAL/+VgSIBGAAHgAAATMgFxYVERQHBiMjNTMyNzY1ETQnJiMhESMRMxEBMwJeFAEFSFJSUbXBrG4hJiYsi/78ubkCJesCd0dR5f7y1mBgnDA3kwEIpiQp/hkEYP4dAeMAAAEANv5WBgMF1QAUAAAhIxEhFRADBgU1NjcSEREhETMVASMFOsr+G4Ri/pHUQ3UDeMn+koYFK9T+GP6q/TinLqgBJQI1ARr61ar+VgABAC7+VgUrBGAAFAAAJTMVASMTIxEhFRADBgU1Njc2ETUhBHO4/t575bj+e3Ze/syzO2IC9ZmZ/lYBqgPHhv6S/vzPHZkbf88Bp9QAAQDJ/mYFOwXVABQAMUAODwgAHBYECjgHAxwFBBUQ/Owy/Oz8PMwxAEALDhAEApUIrQkGgQQv5DL87BDczDAlESERIxEzESERMxEQBiMjNTMyNzYEcf0iysoC3srO40w+hjg3aAJf/TkF1f2cAmT6k/7y9KpLSwAAAQDB/lYEiARgABUAL0ANEAgACBdGCgcDCAVGFhD87DLc7Pw8zDEAQAoPEQQCqQgJBrwEL/Q83OwQ3MwwBREhESMRMxEhETMRFAcGIyM1MzI3NgPQ/am4uAJXuFJRtcGsbiEmFAIY/fwEYP4zAc37jNZgYJwwNwAAAQDJ/lYGBAXVABAAACEjESERIxEzESERMxEzFQEjBTvK/SLKygLeysn+koYCx/05BdX9nAJk+tWq/lYAAQDB/lYFQARgABAAACEjESERIxEzESERMxEzFQEjBIi4/am4uAJXuLj+3nsCBP38BGD+MwHN/DmZ/lYAAQCv/r8EswXVABQAL0ANFBwRAQ4cFgQPCBwHFRDc7NTs/DIy7DEAQAsClQytDgeBAJUTES/M7OQy9OwwJREhIicmNREzERQWMyERMxEjESMRA+j+X7pxbcl8fAF4y8vJqgIdd3LuATf+2Z+eAmT6K/6/AesAAAEAlv7lBAAEYAAVAEdADRUIEgEPCBdGEAgIBxYQ3OzU7PwyMuwxAEAKAqkNDwe8AKkUEi/M7OQy1OywErACI0mwDbAPI0lSWLECDbj/wLACFzhZMCURISInJjU1MxUUFxYzIREzESMRIxEDSP6pmWZcuDQ1aAEpuLi4mQFwX1a46tN1OzsBvvug/uUBtAABAMn+VgboBdUAEQAAJTMVASMBIxEBIwERIxEhAQEhBh/J/pKGASvF/n/L/n/EAS0BfQF/AS2qqv5WAaoFH/wABAD64QXV/AgD+AAAAQDB/lYGAARgABEAACUzFQEjEyMRASMBESMRIQEBIQVIuP7ee+Wy/su4/sqyAQYBPgE/AQSZmf5WAaoDsP0nAtn8UARg/RIC7v//AMEAAAF5BhQSBgBNAAD//wAQAAAFaAeSECcAcgDOAUoTBgCHAAAAErQYAAgTBysxAEAFbwBvCAJdMP//AHv/4wQtBh8QJgByT9cTBgCnAAAACLQiAAgZBysx//8AEAAABWgHThImAIcAABEHAbwEvAF1ABS0ChINBQcrQAkwEj8NABIPDQRdMf//AHv/4wQtBhASJgCnAAARBgBgUgAAILQULSgLBytAFX8obyhQLV8oQC1PKDAtPygALQ8oCl0x//8ACAAAB0gF1RIGAGQAAP//AHv/4wdvBHsSBgBmAAD//wDJAAAEiwdtECcBvwShAXUTBgCMAAAAB0ADQAABXTEA//8Acf/jBH8GSBAnAHIAlgAAEwYArAAAAAdAA3AAAV0xAP//AHX/4wXZBfASBgBpAAD//wBx/+MEfwR7EgYAbwAA//8Adf/jBdkHThAnAbwFIAF1EgYBTwAA//8Acf/jBH8GEBAmAGBUABIGAVAAAP//ACgAAAh2B04QJwG8BlEBdRIGAI0AAP//AEYAAAbvBhAQJwBgAZ4AABIGAK0AAP//AIf/4wSaB04QJwG8BIcBdRIGAI4AAP//AIX/4wPIBhAQJgBgOgASBgCuAAD//wCg/8EE+AXVEgYAbAAA//8AWP5MBC8EYBIGAHEAAP//AMkAAAUzBzEQJwBhAPUBOxIGAI8AAP//ALoAAAR5BfUQJwBhAJL//xIGAK8AAP//AMkAAAUzB04QJwG8BPUBdRIGAI8AAP//ALoAAAR5BhAQJwBgAJIAABIGAK8AAP//AHP/4wXZB04SJgCVAAARBwG8BScBdQAUtAMfGgkHK0AJQB9PGhAfHxoEXTH//wBx/+MEdQYQEiYAtQAAEQYAYHMAABS0Ax8aCQcrQAlAH08aMB8/GgRdMf//AHP/4wXZBfASBgBrAAD//wBx/+MEdQR7EgYAcAAA//8Ac//jBdkHThImAV8AABAHAbwFJwF1//8Acf/jBHUGEBImAWAAABAGAGBzAP//AG//4wUjB04QJwG8BGcBdRIGAKQAAP//AHH/4wPnBhAQJgBg4gASBgDEAAD//wAjAAAEvQcxECcAYQByATsSBgCaAAD//wA9/lYEfwX1ECYAYV7/EgYAugAA//8AIwAABL0HThAnAbwEcgF1EgYAmgAA//8APf5WBH8GEBAmAGBeABIGALoAAP//ACMAAAS9B2sQJwHABHIBdRIGAJoAAP//AD3+VgR/BmYQJgBzXgASBgC6AAD//wCvAAAEswdOECcBvATMAXUSBgCeAAD//wCWAAAEAAYQECYAYF4AEgYAvgAAAAEAyf6/BGoF1QAJACNACgsCBpUJBBwBBAoQ/Pw87MzEMQC2BJUBgQYIAC/MzPTsMDMRIRUhETMRIxHJA6H9KcnJBdWq+3/+FQFBAAABALr+5QPQBGAACQAjQAoLAgapCQQIAUYKEPz8POzczDEAtgSpAbwGCAAvzMz07DAzESEVIREzESMRugMW/aK4uARgqvzj/kwBGwD//wDJAAAGRgdOEiYAogAAEAcBvAW3AXX//wC6AAAFmwYQEiYAwgAAEAcAYAEIAAAAAQBH/lYE7wXVABkAOUANGQ4bBgoMCRwCFQQBGhDcPDzM/DzMzMTczDEAQA4UFQ4AAQyVCQQIlQWBAC/0/Nw87DIQzNzMMCERITUhESEVIREhFSERIRUUBwYjIzUzMjY1AU7++QEHA6H9KQIj/d0BaUdSv/7paUwClKoCl6r+E6r97JTIYG6cYa0AAQA4/lYEVQRgABkAO0AOGwYJGQ4KDAkIAhUEARoQ3DzEzPw8zNzMENzMMQBADhQVDgABDKkJBAipBbwAL/Ts3Dz8PBDM3MwwIREhNSERIRUhESEVIREhFRQHBiMjNTMyNjUBP/75AQcDFv2iAaD+YAFuRlLA/ulqSwH0qgHCnf7bqv6MlMhgbpxhrQABAD3+ZgUrBdUAFwAAJRYHBgcGIyM1MzI3NjcBASMBATMBATMBBSoBAg9TZuRMPoc3KAv+Xv5Z2gIV/i/ZAXMBddn+IBoCGL5ieqpLNXMCeP2FAx0CuP3VAiv9MwAAAQA7/lYEZARgABcAAAkCFhUUBwYjIzUyNzY2NQEBIwEBMwEBBGT+awFrG0NRxMHEGU81/r3+utkBs/5y2QEpASkEYP3f/hcmOc1hc5wDCm2YAbT+SAJKAhb+cQGPAAEAPQAABTsF1QARAAATMwEBMwEhFSEBIwEBIwEhNSGB2QFzAXXZ/k4BdP6QAc7Z/lz+WdoB1P6MAZYF1f3VAiv9d5D9RAJ7/YUCvJAAAAEAOwAABHkEYAARAAABATMBATMBIRUhASMBASMBITUBt/6p2QEpASnZ/qoBDf7gAX7Z/rr+utkBf/7fApQBzP5xAY/+NJD9/AG4/kgCBJAAAgCRAAAEtAXVAAoAFQAmQAoXBAUUHAsAGRAWENzs1Owy7DEAQAkGlRStC4EFlQwv7OT07DABFBcWMyERISIHBgERISIkNTQkMyERAWZPTqMBRP68o05PA0796Pv+8AEQ+wFOAbeKQ0QCI0NEA5P6K9rd3toCZgAAAgBxAAAD9QRgAAoAFgAlQAsYRgUVCAsAEhFFFxD87NTsMuwxALcGqRULvAWpDC/s5NTsMAEUFxYzIREhIgcGAREhIicmEDc2MyERATU+QoEBB/75gEM+AsD+OdZzdHR50AEPAUxaKy4BaS4qArb7oFJSAVBSVQHFAAACAJH/4wdDBdUADAAwADlADjIEJhwpDRsMHB0FGRcxENzs1OwyOdTs7DEAQBAiCJUTAZUarS0TjCi8HYExEOzs5DL07BDsMjABISIHBhAXFjMyNzY1EwYHBgcGIyInJjU0JDMhETMRFBcWMzI3NjURMxEUBwYjIicmA+r+vKNOT09fgbRLViEMDjNqXm7ugYgBEPsBTsk/NHBpOz/KbmjX2WYxAslDRP7qUF9tfZ/+3R0cYDYxgYnK3toCZvvsj1tKSk+bAp/9WuB/eHg5AAIAcf/jBnMEYAANADAAOEAPMkYmCCkODRsIHgUSFkUxEPzs1OwyOdTs7DEAQA4iCakxAakaLRKMKB28MRDszOQy1OwQ7DIwASEiBwYVFBcWMzI3NjUTBgcGIyInJjU0NzYzIREzERQXFjMyNzY1ETMRFAcGIyInJgM9/vmAQz5BQGqUXC0xQ11eiKxmZXR50AEPuD48amg8PrhkaM7TZB8CAi4qXlw6OW00nP72bDAxYWCmqlJVAcX9YZ9QT09SnQFB/rjsc3h4JQABAMn/4wcDBfAANwBAQA85LhwsBgsZGywAGSMSBjgQ/NTszNT8zBDszDEAQBMfBZUGJ5UyEqETrg+VF5EtMow4EOTM9Oz07BDs1Ow5MAE0JyYjIzUzMjc2NTQnJiMiBgc1Njc2MzIXFhUUBwYHFhcWFRQXFjMyNzY1ETMRFAcGIyInJicmA6pcXaWutpVPT1FSmFO+cnNkZVnmhoZHR4ORUlE/NHBpOz/KbmjX2WYwHCEBsoRKS6Y7PHBzPT4kJrQgEBBoabJ8VVYhH2JikIBbSkpPmwKf/Vrgf3h4OFBhAAEAq//jBkYEfAA1AEdADjcuEiwLEhssABIjBhQ2ENzE1OzM1OwQ7MwxAEATFIYTiA+5F7g2BakGNie5MowsNhDM9OwQ1OwQ9PywDEtRWPwb9FnsMAE0JyYjIzUzMjc2NTQnJiMiBwYHNTY2MzIXFhUUBwYHFhcWFRQXFjMyNzY1ETMRFAcGIyInJgMTTkiJlJt0Q0RGRXdHUVBhYqpMxHFyPDxwgUBFPj1paDw+uGRozsdwYgE4ZjgzmCwtRkAuLg0NHacYGE5PjV1AQRgZSE9IWERFT1KdAUH+uOxzeHVlAAABAMn+VgU8BfAAKQA6QA0IDRkdJxwrAhklFAYqEPzU7Mzs1PzMMQBAEiEHlQgAFKEVrhGVGZEnlSi9AC/s7PTs9OwQ1Ow5MCEjETQnJiMjNTMyNzY1NCcmIyIGBzU2NzYzMhcWFRQHBgcWFxYVETMRIwRzyVxdpa62lU9PUVKYU75yc2RlWeaGhkdHg5FSUcnJAbGFSkumOzxwcz0+JCa0IBAQaGmyfFVWIR9iYZL++f2sAAABAKv+VgSDBHwAKQA/QAwREiEBEisGEikMGioQ3MTU7Mzs1OwxAEARGoYZiBW5HbgEC6kMAKkCvQQv7OzU7BD0/LAMS1FY/Bv0WewwJTMRIxEjETQnJiMjNTMyNzY1NCcmIyIHBgc1NjYzMhcWFRQHBgcWFxYVA8i7uLhOSImUm3RDREZFd0dRUGFiqkzEcXI8PHB+Q0WZ/b0BqgFGWDgzmCwtRkAuLg0NHacYGE5PjV1AQRgYSUtqAAABADb/4wfKBdUAIQA0QA0jBAscChUcABYcIRwiENTU7NTs1PzsMQBADhaVIYEiBZUQjByVGwoiEMw87PTsEPTsMAERFBcWMzI3NjURMxEUBwYjIicmNREhFRADBgU1NjcSEREFOj80cGk7P8puaNfWaW7+G4Ri/pHUQ3UF1fvsj1tKSk+bAp/9WuB/eHh94gNx1P4Y/qr9OKcuqAElAjUBGgABAC7/4wbuBGAAIAA0QA0iRgoICRQIABUIIBshENTU7NTs1PzsMQBADhWpILwhBKkPjBupGgkhEMw87PTsEPTsMAERFBYzMjc2NREzERQHBiMiJyY1ESEVEAMGBTU2NzYRNQRzemdoPD64ZGjOx3Bi/nt2Xv7MsztiBGD9BFeKT1KdAUH+uOxzeHVlewKPhv6S/vzPHZkbf88Bp9QA//8Ayf/jCC0F1RIGAG0AAAABAMH/4wcDBGAAHAA2QA8eRgoICRQcCAAVGQgYRh0Q/Owy3Owy1PzsMQBADRWpGhwYvBcEqQ+MCRcvzPTsEOQy3OwwAREUFjMyNzY1ETMRFAcGIyInJjU1IREjETMRIREEiHpnaDw+uGRozsdwYv2puLgCVwRg/QRXik9SnQFB/rjsc3h1ZXvM/fwEYP4zAc0AAAEAc//jBYkF8AAbADBACx0EEBkcGxQcChAcEPzs3OzE7DEAQA4WlQYaEJUPEpUNkQaMHBDk9OzU/MwQ7DABFAcGBwYjICcmEDc2ISAXFSYhIBEQITI2NREzBYlkLYl8l/6bxMC/xQFlASfh4f7q/dsCJdd7ygG64H85IR7SzALQzdKO17/9n/2glKQB8AABAHH/4wRGBHsAGwAwQAsdRQYSEhQNEgBFHBD87NTsxOwxAEAOELkYEwe5Bgm5BLgYjBwQ5PTs1PzMEOwwExA3NiEyFxUmIyIHBhAXFjMyETUzFRQGIyAnJnGSlgEL0Lq+xL1iWlpiveK4yeX+/JWOAi8BDp2hbqp8fHL+fHJ8AT6+xeznpp4AAf/6/+MFZgXVABkAL0AMCRwLGxhAABwXQBQaENTk/OTM3OwxAEAMBZUQFQCVF4EQjAoaEMzk9OwyEOwwAREUFxYzMjc2NREzERQHBiMiJyY1ESE1IRUC1z80b2k7P8puaNfWaW797gTvBSv8lo9bSkpPmwKf/Vrgf3h4feIDcaqqAAEABf/jBPYEYAAZADJACgoICxsYAAgVFxoQ1Nz8zMzc7DEAQAwFqRCMGgAWqRe8ChoQzPTsMhD07LIQCgFdMAERFBcWMzI3NjURMxEUBwYjIicmNREhNSEVAng+PWloPD64ZGjOx3Bi/kIEMQO2/a5WRkVPUp0BQf647HN4dWV7An6qqgD//wCk/+MEewXwEgYAagAA//8Ahf/jA8gEfBIGAHUAAAABAFT+ZgU6BdUAGAAvQAsNGgQTHAcUHAYBGRDU1OzU7OzMMQBADQ2VDL0ZFJUGgQGVABkQMuz07BD07DAzNTY3NhE1IREQBiMjNTMyNzY1ESEVEAMGVN06VwN4zeNNP4Y3N/4bZmKqMKP2AmT++pP+8vSqS0zBBMO4/cr++P0AAAEATP5WBHMEYAAYAC9ACw0aRhMIBxQIBgEZENTU7NTs7MwxAEANDakMvRkUqQa8AakAGRAy7PTsEPTsMDM1Njc2ETUhERQGIyM1MzI3NjURIRUQBwZMuzNEAvWjtUYxYS4m/ntYXpkdfaYB0Lf7jNbAnDApoQPhb/5Qws8AAAEAVAAACRwF1QAXAAAzNTY3EhE1IQEBMwEBIwEBIwEBIRUQAwZU2T5XA3kBcwF12f4gAgDZ/lz+WdoCFf6g/bhmYqovpAECAlj+/dUCK/0z/PgCe/2FAx0CDrj9yv74/QAAAQBMAAAHsgRgABgAAAkCIwEBIwEBIRUQBwYFNTY3NhE1IRcBAQed/msBqtn+uv662QGz/t/+MFhe/sy2OEQC9QEBJwEpBGD93/3BAbj+SAJKAYNv/lDCzx2ZHH6xAcW3A/50AY8AAgDJAAAG6AXVAAgAGgAAAREzMjY1NCYjAQYhIxEjESEyBBUUBwEzAQEjAZP+jZqajQGVf/7q/soByPsBAQYBaNn+IAIA2QUv/c+Sh4aS/bOK/agF1ePbMCoCGP0z/PgAAgC6/lYGqAR7ABgAIAAACQIjAQYHBiMiJicRIxEzFTY2MzIXFhcBABAmIAYQFiAGk/5rAarZ/ssaXH/Me7E6ubk6sXvMf1QdASX+K6f+3KenASQEYP3f/cEBoah0omFk/a4GCqpkYaJrlwGJ/QQBlufn/mrnAAIAiAAAB7wF1QAVAB0AADMBJiQ1NCQhIRUhESEVIREhFSERIQESEBYzIREhIogBmGT/AAEEAQIE6P0cAsX9OwL2/D7+9P52N5WSATj+yJICjRqp187gqv5Gqv3jqgJ3/YkEqv76hwISAAADAHT/4wd3BHsAHwAmAC8AAAEVIRYWMzI2NxUGBiMgJyYnIwEjASYmNTQ2MyE2MzIAByYmIyIGByUUFjMzESMiBgd3/LIMzbdqx2Jj0Gv+9J2YBOX+tsYBVnSa19kCZVZn4gEHuAKliJq5Dv1LgHf4+HeAAl5avsc0NK4qLJyYwv4nAesaiY+ioRv+3cSXtK6eilNeAWFc//8Ac/74BdkF8BAGADIAAP//AHH+VgRaBHsQBgBSAAD//wBEAAAHpgXVEAYAOAAA//8AVgAABjUEYBAGAFgAAAABAMkAAAWGBdUAFAAAATMXNyEBFyMnBwEjAQERIxEzEQEnAmqHl90BA/6jyI6AngJf3P36/u/KygGv2wWKl+L+m8iAofx5AwH+6f4WBdX9HgG43AABALoAAASRBGAAEwAAATMXNzMHFyMnBwEjAQcRIxEzEQECNYxBduLmk45MfwHjzv5zxbe3AUsEKUB36ZNMgf1RAjXI/pMEYP3yAVAAAQBU/mYIcwXVACUAOUAODhwnExkgHB0HIRwGASYQ1NTs1Dzs3MTM7DEAQA8TlRIdlQghlQaBEr0IAB8vPMzs9OwQ7BDsMDM1NjcSETUhESEyFxYVERAGIyM1MzI3NjURNCYjIREjESEVEAMGVNk+VwN4AaG6cW3M5Ew+hjg3fHz+iMr+G2Ziqi+kAQICWP79nHdy7v7O/vL0qktLwgEin579OQUruP3K/vj9AAEATP5WBwwEYAAnADlADg4IKRQaIggfByMIBgEoENTU7NQ87NzEzOwxAEAPFKkTH6kII6kGvBO9CAAhLzzM7PTsEOwQ7DAzNTY3NhE1IREzIBcWFREUBwYjIzUzMjc2NRE0JyYjIREjESEVEAcGTLY4RAL1+gEHRlJSUbXBrG4hJiYsi/78uP57WF6ZHH6xAcW3/hdHUeX+8tVhYJwwN5MBCKYkKf4ZA81v/lDCzwAAAQDJ/mYIdAXVACEAP0AREAwcIxcdAxwbBTgfARwABCIQ/Owy/DzsMtTM7MwxAEAQEpUQvRwbHpUGAq0EAIEgHC885DL8POwyEPzsMBMzESERMxEhMhcWFREQBiMjNTMyNzY1ETQmIyERIxEhESPJygLeygGhunFtzORMPoY4N3x8/ojK/SLKBdX9nAJk/Zx3cu7+zv7y9KpLS8IBIp+e/TkCx/05AAEAuv5WBxoEYAAjAEBAEAwIJRIYIAQIHQUhAQgARiQQ/Owy3DzsMtzEzOwxAEAREqkRHakGIakCBAC8HxG9BiMvzOw85DLc7BDsEOwwEzMRIREzETMgFxYVERQHBiMjNTMyNzY1ETQnJiMhESMRIREjurkCVbn6AQdGUlJRtcGsbiEmJiyL/vy5/au5BGD+NwHJ/hdHUeX+8tVhYJwwN5MBCKYkKf4ZAgT9/AABAMn+vwYEBdUACwAAIREhESMRIREzESMRBHH9IsoEcsnJBSv61QXV+tX+FQFBAAABALr+5QU5BGAACwAAAREzESMRIxEhESMRBIG4uLn9q7kEYPw5/kwBGwPN/DMEYAABAGQB6QOcAnkAAwAQtgKpAOkEAQAvxjEAEPzsMBMhFSFkAzj8yAJ5kAABAGQB6QecAnkAAwAPtQKpAAQBAC/MMQAQ1OwwEyEVIWQHOPjIAnmQAAABALID/gHXBdUABQAYQAsDngCBBgMEARkABhDc7NTMMQAQ9OwwATMVAyMTAQTTpIFSBdWY/sEBPwAABAA2AAAHwQXVABMAHwArAC8CFrGSl0Kwk7CYQgCwAC+zDg8sL7AEFzyxAZXtsACwLd2wLjywLbAd3rAjzRAQsQSBP7EFCrACFzyxC5XtsCMRsAsSsBc5sBcgRmhIsBcQsCmwI7AdI0lpO7GAAkKxgQBCPbAdsBcjSbCAYmmwHUZgsBRGYbCSQ7ABYCNCsJJDsAFgQ7AAVViwFLCSQ7ABYEM4WbAUELIaJiCwAxc8sYAAQrGBAEIYMAGwMBCxAwT+sAQ8sADEsAOxERz9sBA8ELADsQ02/LAOPLANsQYc/bAHPLAPObAPIEZoSBCwDbAKsACwAyNJaDuwCzwQsA2wFNawFLAg3bAsObAsIEZoSLAgsCbWsCawGrAUsCAjSWk7sC+wLLAUI0loOhAQEBAQsBqwMSNJsJJDsAFgI0KwkkOwAWBDsABQWLUmGhQgLC+wkkOwAWBDsAYXOEuwClJYsA2wFCNJsJJDsAFgI0KwkkOwAWBDsEBQWLCSQ7ABYEOwQGGwkkOwAWAjQrQGBw0OD7CSQ7ABYEOwBRc4WVlZsYACQrGBAEI9sBSwGiNJsIBiabAURmCwF0ZhsJJDsAFgI0KwkkOwAWBDsABVWLAXsJJDsAFgQzhZsBcQsh0jKbADFzyxgABCsYEAQhgxsASwByNJsABSWAyxEA8HsA8QsQYR7bAQELEFEf0KDAINsQUGCLAEELAFPAsKDAMNsQUGCLAHELAGPAsKWTM1MjURIQERNDYzFSIVESEBERQGATQ2MzIWFRQGIyImNxQWMzI2NTQmIyIGAzUhFTaTARAClp26k/7w/WqdBOOQZ2eQkGdnkIw5MjI5OTIyOYwB7qprBMD7HwPMgJWqa/tABOH8NICVAm6Kv7+Kir+/ik5nZ05OZ2f9RHt7AAABALD9/ANQB5IACwAAASM1EBMSEzMAAwIRAXPDoLqmoP78Wn/9/OoDlwHiAjABA/3z/ob97vztAAEAsP38AXMHiQADAAATMxEjsMPDB4n2cwAAAQCw/hQDUAeJAAsAAAEVEBMSEyMCAwIRNQFzf5PLoNCQoAeJ6vyl/lf+FP5lAUUB7gImAzLqAAABALD9/ANQB5IACwAAATUQAwIBMxITEhEVAo1/Wv78oKa6oP386gMTAhIBeQIO/v390P4e/GnqAAECjf38A1AHiQAEAAABESMRMANQwweJ9nMJjQABALD+FANQB4kACwAAATMVEAMCAyMSExIRAo3DoJDQoMuTfweJ6vzN/dv+Ev67AZsB7AGpA1sAAAEAsP38A1AHbQAFAAABIxEhFSEBc8MCoP4j/fwJccMAAQCw/fwBcweJAAMAABMzESOww8MHifZzAAABALD+FANQB4kABQAAAREhFSERAXMB3f1gB4n3TsMJdQAAAQCw/fwDUAdtAAUAAAERITUhEQKN/iMCoP38CK7D9o8AAAECjf38A1AHegADAAABMxEjAo3Dwwd69oIAAQCw/hQDUAd6AAUAAAEzESE1IQKNw/1gAd0HevaawwABAqP96gVYB20ADQAAASMRNDc2MyEVISIHBhUDXbpveboBE/7nZUQ5/eoHdd+RnrBmV5kAAQCo/fwDXQeGABgAAAEWFxYRESMRECcmJSc1MyA3NhERMxEQBwYClDoqZbpuS/77PT0BA01uumUoAsEgPZP+Q/3oAgwBt19BBAG7RWMBswIM/ej+SJg8AAECo/4UBVgHhgANAAABERQXFjMhFSEiJyY1EQNdOURlARn+7bh7bweG+JSaVmawno/hB2QAAAECo/30A10HjAADAAABIxEzA126uv30CZgAAQCo/eoDXQdtAA0AAAERNCcmIyE1ITIXFhURAqM5RGX+5wETunlv/eoHfZlXZrCekd/4iwAAAQKj/fwFWAeGABgAAAEmJyYRETMREBcWITMVBwQHBhERIxEQNzYDbDwoZbpuTQEDPT3++0tuumUqAsEhPJgBuAIY/fT+TWNFuwEEQV/+Sf30AhgBvZM9AAEAqP4UA10HhgANAAABMxEUBwYjITUhMjc2NQKjum97uP7tARllRDkHhvic4Y+esGZWmgABAHb/4wj6BSkANAA+QBUwMSwcABgXBAoPKiQeBgA2HBwTRTUQ/OzMzBc51MwQ7NTMMQBADCSVCioelQQPjDAXNRDMMvQy7DLc7DABFAcGIyInJicmIyIHBwYjIicmNTQ3NjczBgcGFRAhMjc2NzYzMhcWFxYzIBE0JyYnMxYXFgj6ZnTqW25hYHp4envCblvqdGZDR2/5fltVAQCKXUxLZp2bZEtKXYoBAFVbfvpvRkMB/vKLnkRAQEREgESdi/LG4uyYa/Pitv66NjMzNjYzMzYBRrbi82uY7OIAAQCY/+MHoQPFACEAPEATIQAfCAIODQQJHRIEAiMQCAtFIhD87MzMFznUzBDs1MwxAEAMF6kHHRKpBAmMIQ0iEMwy9DLsMtzsMAESERAhIiQiBCMgERATMwIVEDMyNzY3NjIXFhcWMzIRNAMHF4r+clT+1fD+1FL+corGktA+SXgVZPxkFHlJP9CSA8X+4/7r/lDi4gGxARQBHf65+v77OFsMNzcMWzgBB/gBRwAAAgBx/+MEdQYUAAkAIAAAASIGEBYgNjU0JgEQNyYmNTQ2MyEVISIVFBYzMgAQACAAAnKTrKsBKKys/WvDT0HCngH8/ii8dZLtARX+7f4g/u8D3+f+bufox8jp/lABTZsvjTF8lJOJSTT+yP3a/sYBOQAAAQAvAAAFqgYUACQASEATJgAHCQUIDCEYDR4IEQwhEBRMJRD8PMQyxPw8xBA8/DzExMQxAEARCQ0RqRICGocAGJcGHxK8Cw8vPOYyMv487jIQ7jIyMAEVIyIGFRUhFSERIxEhESMRIzUzNTQ2MzMVIyIHBhUVITU0NjMFqrBjTQEv/tG5/ge5sLCuva6wYycmAfmuvQYUmVBoY4/8LwPR/C8D0Y9Ou6uZKChoY067qwACAC8AAARKBhQAFQAZAFJAERtGABcIFg8UBAgIAxYKBkwaEPw8xDLE/DzEEP487DEAQBIIA6kAEIcOGL4WsQ6XCQC8BQEvPOYy7v7uEO4Q7jIwQAv/G6AbkBuAGxAbBQFdAREjESERIxEjNTM1NDYzMxUjIgYVFQEzFSMESrn+B7mwsK2zubBjTQH5ubkEYPugA9H8LwPRj063r5lQaGMBsukAAAEALwAABEoGFAAVADdADxdGAQgECgwICBAEEg5MFhD8PMTE/DzEEP7sMQBADQ8LqQkEhwCXEQm8DQIvPOYy/u4Q7jIwASERIxEhIgYVFSEVIREjESM1MzU0NgJKAgC5/rdjTQEv/tG5sLCuBhT57AV7UGhjj/wvA9GPTrurAAIALwAABvwGFAApAC0AWkAYL0YXKwgqEBsVCBoqCQAfBggkHgkiJkwuEPw8xDLE/DzEEMQy/DzEEPw87DEAQBcbHyOpJBEBhwAtviqxEACXFgckvBkdIS88POQyMuQy9OwQ7DIQ7DIyMAEVIyIHBhUVITU0NzY3NjMzFSMiBhUVIREjESERIxEhESMRIzUzNTQ2MwUzFSMC+LBjJyYB+VccJ06DrrBjTQKyuf4Huf4HubCwrr0D+bm5BhSZKChoY067VRwTJ5lQaGP7oAPR/C8D0fwvA9GPTrurAukAAAEALwAABvwGFAAmAE5AFihGDQgQFhgUCBAJABwGCCEbCR8jTCcQ/DzEMsT8PMQQxPw8xBD87DEAQBIYHCCpIREChwwmlxUHIbwPGh4vPDzkMjL0POwyEOwyMjABFSMiBwYVFSE1NDYzIREjESEiBhUVIRUhESMRIREjESM1MzU0NjMC+LBjJyYB+a69AgC5/rdjTQEv/tG5/ge5sLCuvQYUmSgoaGNOu6v57AV7UGhjj/wvA9H8LwPRj067qwAC/NcFDv8pBdkAAwAHAKVADQQAzgYCCAFkAAVkBAgQ1Pzc7DEAENQ87DIwAEuwDlRLsBFUW1i9AAgAQAABAAgACP/AOBE3OFkBS7AOVEuwDVRbS7AXVFtYvQAI/8AAAQAIAAgAQDgRNzhZAUuwEVRLsBlUW1i9AAgAQAABAAgACP/AOBE3OFkAS7AYVFi9AAj/wAABAAgACABAOBE3OFlAEWABYAJgBWAGcAFwAnAFcAYIAV0BMxUjJTMVI/5ey8v+ecvLBdnLy8sAAf1zBO7+8AX2AAMAf0ARAgMAAwEAAANCAAL6BAEDAwQQxBDAMQAQ9MwwS1NYBxAFyQcQBclZIgBLsAxUWL0ABP/AAAEABAAEAEA4ETc4WQBLsA5UWL0ABABAAAEABAAE/8A4ETc4WUAgBgIVAiUBJQI2AkYCVgJqAWcCCQ8ADwEfAB8BLwAvAQZdAV0BMwMj/je55JkF9v74AAH9DATu/osF9gADAIlAEQECAwIAAwMCQgAB+gQBAwMEEMQQwDEAEPTMMEtTWAcQBckHEAXJWSIAS7AMVFi9AAT/wAABAAQABABAOBE3OFkAS7AOVFi9AAQAQAABAAQABP/AOBE3OFlAKgYABgEWABIBJAAkATUBQwFVAFUBnwCfAa8ArwEODwAPAx8AHwMvAC8DBl0BXQETIwP9x8SZ5gX2/vgBCAAB/McFBv85BfgADQBqQA4HAATDC/oOB1YIAVYADhDU7NTsMQAQ9PzMMjAAS7AMVFi9AA7/wAABAA4ADgBAOBE3OFkAS7AOVFi9AA4AQAABAA4ADv/AOBE3OFkBS7AOVEuwD1RbWL0ADv/AAAEADgAOAEA4ETc4WQEzFhYzMjY3MwYGIyIm/Md2DWNTUmEQdgqgj5CfBfg2OTc4d3t6AAL85gTu/7IF9gADAAcAE0AHAAQDBwgABBDMMQAQ1DzMMjABMwMjAzMDI/75ueSZi7nkmQX2/vgBCP74AAL8TgTu/xoF9gADAAcAAAETIwMhEyMD/QfEmeQCCMSZ5AX2/vgBCP74AQgAAQGXBRgFGwXgAAsAOkANAgEAAwYFBAcKCQgLDBDUQAk/C28LjwuQCwRd3Dk51Nw5OdTMOTkxALYFBAcBCgsMENTMMtw8zDABByMnIwcjJyMHIycFG2QyMq8yMjKvMjJkBeDIZGRkZMgAAAEAyf5WBfwF1QAOAAAhIxEBIREzEQEhETMVASMFM8T9av7wxAKWARDJ/pKGBOH7HwXV+x8E4frVqv5WAAEAwf5WBTgEYAAOAAAhIxEBIxEzEQEzETMVASMEgLf95Oy3AhvtuP7eewOD/H0EYPx/A4H8OZn+VgAAAAAABwBaAAMAAQQJAAABMAAAAAMAAQQJAAEAFgEwAAMAAQQJAAIACAFGAAMAAQQJAAMAFgEwAAMAAQQJAAQAFgEwAAMAAQQJAAUAGAFOAAMAAQQJAAYAFAFmAEMAbwBwAHkAcgBpAGcAaAB0ACAAKABjACkAIAAyADAAMAAzACAAYgB5ACAAQgBpAHQAcwB0AHIAZQBhAG0ALAAgAEkAbgBjAC4AIABBAGwAbAAgAFIAaQBnAGgAdABzACAAUgBlAHMAZQByAHYAZQBkAC4ACgBDAG8AcAB5AHIAaQBnAGgAdAAgACgAYwApACAAMgAwADAANgAgAGIAeQAgAFQAYQB2AG0AagBvAG4AZwAgAEIAYQBoAC4AIABBAGwAbAAgAFIAaQBnAGgAdABzACAAUgBlAHMAZQByAHYAZQBkAC4ACgBEAGUAagBhAFYAdQAgAGMAaABhAG4AZwBlAHMAIABhAHIAZQAgAGkAbgAgAHAAdQBiAGwAaQBjACAAZABvAG0AYQBpAG4ACgBEAGUAagBhAFYAdQAgAFMAYQBuAHMAQgBvAG8AawBWAGUAcgBzAGkAbwBuACAAMgAuADMANwBEAGUAagBhAFYAdQBTAGEAbgBzAAMAAAAAAAD/2ABaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAgAAv//AAMAAQAAAAwAAAAAAAAAAgAIAAEAXwABAGgAaAABAG4AbgABAHcA+QABAPoA/gADAP8BswABAbYBtgABAbcBuwACAAEAAAAKAE4AaAAFREZMVAAgY3lybAA4Z3JlawA4bGF0bgAqdGZuZwA4AAQAAAAA//8AAAAEAAAAAP//AAIAAAABAAQAAAAA//8AAQABAAJrZXJuAA5tYXJrABQAAAABAAEAAAABAAAAAgAGBN4ABAAEAAEACAABAAwAFgABAMIA9gACAAEA+gD+AAAAAgAcABEAGgAAACIAOwAKAEIAWwAkAGgAaAA+AG4AbgA/AHsAfQBAAIAAgQBDAIYAjwBFAJEArwBPALEAxgBuAMsA0gCEANYA5ACMAOcA7ACbAQUBBgChAQ0BDgCjAREBGQClASMBIwCuATABMACvATsBOwCwAUEBQQCxAUUBRQCyAV8BYACzAW4BbgC1AXUBdgC2AYoBigC4AZUBlgC5AZgBmAC7AZoBmgC8AAUAAAAWAAAAHAAAACIAAAAoAAAALgAB/Y4EewAB/n8EewAB/kEEewAB/hcEewAB/OoEewC9AXwBfAF8AXwBfAF8AXwBfAF8AXwCfgJ+AlQBggNWA1YBiAOAAioBjgNWAZQDFAJIA6QDVgOkAZoCJAOGA8ICfgGgA7YBpgGsAbIDbgG6AcIByAHQAdYDbgLeAt4DbgNuAdwDmAHiA1wB6gIKAtgB8AH2Af4CBAO8Aq4CCgIQAhgCHgIkAioCMAI2A4ACfgJ+An4CPAJCA1YDYgOGAkgDwgJOAxQDgAOkA4ADVgJUA4YCWgJgA7YDgAJmAmwCbAJyAngCfgKEAxQCigKoApAClgOwAxoCnANoAqID1APIA84DngPUA6oC9gNcA1wCqAKuArQDvAL2A4wCugK6AsACxgLMAtIDGgPIA1wC2ALeAt4C3gLkAuoC8AL2AvwDAgMIAw4DFAMaAyADJgNiAzgDLAMyA2IDOAM+A0QDpAOqA0oDUANWA1wDYgNoA8IDyAPCA8gDwgNuA3QDegOAA4YDjAOSA5gDngOkA6oDsAO2A7wDzgPCA8gDzgPUAAECiwXwAAEC7AXwAAEDXAXwAAEBLgXwAAEBKgXwAAECfQXwAAED9QXwAAECcgXwAAECvgXwAAICSgR7ACMAAgKkBHsAFwABA/4F8AACApYEewASAAEB4AXwAAECagR7AAED6QR7AAICcwR7AAwAAQJvBHsAAQEaBfAAAgJ9BHsAFAABAl4EewABA0cEewABAhcEewACAR0EewAEAAEBHwR7AAEDSAXwAAECkwXwAAEBLwXwAAEE1QXwAAEEcgXwAAECmQXwAAEDdAXwAAEC9QXwAAEDfQXwAAEDTAXwAAECbwXwAAEDcQXwAAECsgXwAAEERwXwAAECWQXwAAEDhwXwAAECvAXwAAECTgXwAAEC4AXwAAECmwXwAAECYQR7AAECjQR7AAECQAR7AAECVAR7AAECYAR7AAEDawXwAAEDqQR7AAECBgR7AAEDHQR7AAEBFgR7AAEBsgR7AAECJwR7AAEBHwYvAAED+gR7AAED8wR7AAEBNAXwAAECnQR7AAEDvAXwAAEDXgR7AAEB8wXwAAEDYwR7AAEDcwXwAAEC9gR7AAEDhAXwAAEDIgR7AAEDLAXwAAECcwR7AAEDlgR7AAEDFAXwAAEDJQX6AAEDHwXwAAEClQR7AAECngXwAAECpgR7AAEETwXwAAEDmwR7AAEBFgXwAAEEGgXwAAEDZQR7AAEDAgXwAAECcwXwAAECSwR7AAECowR7AAECiQR7AAEDBQR7AAEDJwXwAAECfQR7AAECRQR7AAECzQXwAAECYgR7AAEC7gXwAAECdAR7AAEC+AR7AAECggR7AAIAAAABAAgAAgoeAAQAAApeCtYAIQAnAAAAAAAAAAD/0/+3AAAAAAAAAEsAcgA5AEsAAP9EAAD/iP+t/5r/DQAAAAAAAAAAAAAAAAAAAAAAAAAAACYAAAAAAAAAAP/JAAAAAP/cAAD/0//c/9wAOQAA/9wAAAAA/9wAAP/c/9wAAP9hAAD/ff+QAAD/YQAAAAD/3P/c/9z/twAAAAAAAAAA/9wAAAAA/9wAAP+I/60AAP91AAAAAAAAAAAAAAAA/9wAAAAA/9wAAP/cAAD/3AAAAAD/wf+3AAD/kAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/3AAAAAD/kAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP63/2H/RAAAAAAAAAAAAAAAAAAAAAD/3P/cAAAAAAAAAAAAAAAA/0QAAAAA/5AAAAAA/2sAAAAA/7f/awAAAAD/kAAAAAAAAP9EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+3AAAAAAAAAAD/mgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/twAAAAD/3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/KQAAAAD/3AAA/5AAAAAAAAAAAP+QAAAAAP9h/8kAAP+3AAD/twAA/9wAAAAA/5oAAAAAAAAAAAAA/5oAAAAAAAD/mgAAAAAAAP9rAAD/3AAAAAAALwAAAAAAAAAAAAAAAP+3AAAAAP7m/5r/H/9EAAD+8AAAAAAAAAAA/9wAAAAAAAAAAAAA/9wAAAAAAAD/3AAAAAAAAP9EAAAAOf+t/9z/3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/3AAA/33/kAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/0/7BAAD/fQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/0wAA/6QAAAAA/7cAAAAA/9MAAP/c/7f/3P/cAAD/3AAAAAAAAAAAAAAAOQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/rf+3/8H/rQAA/5oAAAAAAAAAAAAAAAAAAP9rAAD/kP+tAAD/fQAA/9MAAAAA/6QAAAAAAAAAAAAA/6QAAAAAAAD/pAAAAAAAAP+QAAAAAAAAAAAAJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/RP8N/x//YQAA/4gAAAAAAAAAAAAAAAAAAP/cAAAAAAAAAAAAAAAA/q3+pAAA/qQAAAAA/8EAAAAA/qT+0/6tAAD+yQAA/q0AAP7BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/iP74/1n/fQAAAAAAAAAAAAAAAP/cAAAAAAAAAAAAAAAAAAAAAAAA/2EAAAAA/2EAAAAA/9MAAAAA/2EAAAAAAAD/dQAAAAAAAP/JAAD/rf8V/4j/kAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/30AAAAA/4gAAAAA/9MAAAAA/4j/pAAAAAD/twAAAAAAAP/cAAD/mgAAAAAAAAAA/2sAAAAAAAAAAP99AAAAAP/cAAAAAAAAAAAAAAAAAAAAAAAA/6QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/Df5h/vD/YQAA/5AAAAAAAAAAAP+QAAAAAAAAAAAAAAAAAAAAAAAA/uYAAAAA/vAAAAAA/7cAAAAA/vAAAAAAAAD/FQAAAAAAAAAAAAD/3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/3AAAAAD/kP9r/7cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9wAAAAA/9wAAP/cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/9wAAAAA/7cAAAAAAAAAAAAA/7cAAAAAAAD/wQAAAAAAAP+3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJv/cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/wQAAAAD/ff9E/9wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/0//c/9MAAP/cAAAAAP/c/9P/3AAAAAAAAAAAAAD/yQAAAAD/yf9h/5AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP9E/5AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/3AAA/8EAAAAAAAAAAAAA/8EAAAAAAAAAAAAAAAAAAAAAAAD/3P7c/2sAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIACgAOAA4AAAAiACUAAQAnACkABQArAC0ACAAwADsACwBGAEcAFwBMAEwAGQBPAFAAGgBTAFMAHABXAFoAHQABACIAOQABAAIAAwAEAAAABQAGAAcAAAAIAAkACgAAAAAACwAMAA0ADgAPABAAEQASABMAFAAVABYAAAAAAAAAAAAAAAAAAAAAAAAAAAAXABgAAAAAAAAAAAAZAAAAAAAaABsAAAAAABwAAAAAAAAAHQAeAB8AIAABAA4ATQABAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAABAAFAAYABwAAAAgACQAIAAAACgAIAAgAAAAAAAsACAAMAAgADQAOAA8AEAARABIAEwAUAAAAAAAAAAAAAAAAABUAAAAWABcAGAAZABoAGgAbAAAAAAAcABoAHQAeAAAAFwAfACAAIQAiACMAJAAlACYAAQAAAAoAxgDsABRERkxUAHphcmFiALhhcm1uALhicmFpALhjYW5zALhjaGVyALhjeXJsAIRnZW9yALhncmVrAJ5oYW5pALhoZWJyALhrYW5hALhsYW8gALhsYXRuAKptYXRoALhua28gALhvZ2FtALhydW5yALh0Zm5nALh0aGFpALgABAAAAAD//wAAAB4AAk1LRCAAEFNSQiAAEAAA//8AAgAAAAIABAAAAAD//wABAAAABAAAAAD//wACAAAAAQAAAAAAA2NjbXAAFGxpZ2EAGmxvY2wAIAAAAAEAAAAAAAEAAgAAAAEAAQAEAAoAngCyAPYABgAAAAEACAACABIAJgAmACYAAwAAAGwAfgABAAgASgBLAM0AzwD6APsA/AD9AAIACwAiADsAAwBDAEMAAwBFAEUAAwBHAEcAAwBJAEkAAwBKAEsAAQBMAE0AAwBVAFUAAwDNAM0AAQDPAM8AAQD6AP0AAgABAAQAAAABAAEAAgABAAAAAwABAAQAAQADAAEAAAAAAAEAAAABAAgAAQAGAQ4AAQABAKgABAAAAAEACAABADYAAQAIAAUADAAUABwAIgAoAbsAAwBHAE0BugADAEcASgG5AAIATQG4AAIASgG3AAIARwABAAEARwABAAAAAQAIAAIADgAEAGgAbgBoAG4AAQAEAEoASwDNAM8AAQAAAAoA4ADoAFAAPAwAB90AAAAAAoIAAARgAAAF1QAAAAAAAARgAAAAAAAAAAAAAAAAAAAEYAAAAAAAAAFoAAAEYAAAAFUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ4AAAJ2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABaAAABDgAAAFoAAABaAAABDgAAAAAAAAAAAAABDgAAAFoAAABaAAABDgAAAFoAAABaAAAAWgAAAXIAAABaAAAAWgAAAjgAAPuPAAAAPAAAAAAAAAAAACgAHAAuAAcAAgA2AF4AhgCuANYBEgEwAWwBigABAAcACQAKADwAPgBcAF0AXgABAAIAHgBAAAQAAAAAAAAAAwGjAAAAKAl1AAABogAoACgJjQABAaEAKAAACZYAAAAEAAAAAAAAAAMBpgAAACgJdQAAAaUAKAAoCY0AAQGkACgAAAmWAAAABAAAAAAAAAADAakAAAAoCXUAAAGoACgAKAmNAAEBpwAoAAAJcQAAAAQAAAAAAAAAAwGsAAAAKAlmAAABqwAoACgJfgABAaoAKAAACXEAAAAEAAAAAAAAAAUBrwAAACgJcgAAAbAAKAAoCZgAAQGuACgAKAmKAAABsAAoACgJmAABAa0AKAAACYMAAAAEAAAAAAAAAAIAXQAAACgIAAAAAF0AKAAACAAAAQAEAAAAAAAAAAUBswAAACgJcgAAAbAAKAAoCZgAAQGyACgAKAmKAAABsAAoACgJmAABAbEAKAAACYMAAAAEAAAAAAAAAAIAHgAAACgFAgAAAB4AKAAABQIAAQAEAAAAAAAAAAIAQAAAACgEKAAAAEAAKAAABCgAAQ==';
const PIT_CID_GID_B64 = 'eNrt01WXEAQYhOH3pbu7u7u7YenuVMFAEBCV7m5YYJcOizDABFsQDLADCZVSsSklbO/8A57jDd9zNddzZuA/khSkJBWpSUNa0pGeDGQkE5nJQlaykZ0c5CQXuclDXvKRnwIUpBCFKUJRilGcEpSkFKUpQ1nKUZ4KVKQSlalCVapRnRrUpBa1qUNd6lGfBjSkEY1pQlOa0ZwWtKQVrWlDAm1pR3s60JFOdKYLXelGd3rQk170pg996Ud/BjCQQQxmCCGEEMKNaTwTmMgkJjOFqUxjOjOYySxmM4e5zGM+C1jIIhazhKUsYzkrSGQlq1hNEsmsYS3rWM8GNrKJzWxhK/fzAA/yEA+zje3sYCeP8CiP8Ti72M0TPMlTPM0zPMse9vIcz/MCL/ISL/MKr7KP/bzGAQ7yOm/wJm9xiMO8zTu8y3u8zwd8yEd8zCcc4VOOcozjnOAzPucLTnKK05zhLF/yFV9zjm/4lu/4nh/4kZ84zwUuconL/MwvXOEq17jOr/zG7/zBn/zF36KmMKWpTG0a05rO9GYwo5nMbBazms3s5jCnucxtHvOaz/wWsKCFLGwRi1rM4pawpKUsbRnLWs7yVrCilaxsFatazerWsKa1rG0d61rP+jawoY1sbBOb2szmtrClrWxtGxNsazvb28GOdrKzXexqN7vbw572srd97Gs/+zvAgQ5ysEO8yZu9xaEO81Zv83bvcLh3OsKR3uUoRzvGux3rPd7rfY5zvBOc6CQnO8WpTnO6M5zpLGc7x7nOc74LXOgiF7vEpS5zuStMdKWrXG2Sya5xretc7wY3xplCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCOH/5iY3/5u3RB836Aq2/gNX2KjV';
// Pit report: preserve the tabular organiser layout rather than flattening rows into text.
function buildFormattedPitPdf(stints, rid) {
  const grouped = new Map();
  for (const row of stints || []) {
    const id = String(row.apex_id || '').trim();
    if (!id) continue;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  const objects = [null];
  const add = body => { objects.push(body); return objects.length - 1; };
  const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const fontData = decode(PIT_UNICODE_FONT_B64);
  const mapData = decode(PIT_CID_GID_B64);
  const fontStreamId = add(null);
  const gidMapId = add(null);
  const descriptorId = add(null);
  const descendantId = add(null);
  const regular = add(null);
  const bold = regular;
  const pageIds = [];
  const contents = [];
  const width = 842, height = 595;
  const columns = [31, 34, 58, 60, 65, 36, 154, 61, 55, 47, 61, 69];
  const headers = ['#', 'Lap', 'Hour', 'Total', 'On track', 'Laps', 'Driver', 'Total', 'Best lap', 'Avg', 'Pits', 'Out'];
  const x = [16]; for (const w of columns) x.push(x[x.length - 1] + w);
  const enc = new TextEncoder();
  const fmt = v => v == null ? '' : String(v);
  const time = v => { const n=Number(v); return Number.isFinite(n)&&n>0?n.toFixed(3):''; };
  const drawText = (parts, value, px, py, size=8, heavy=false) => {
    const hex = Array.from(fmt(value), ch => {
      const cp = ch.codePointAt(0);
      return (cp <= 0xffff ? cp : 0x003f).toString(16).padStart(4, '0');
    }).join('');
    parts.push(`BT /F1 ${size} Tf 1 0 0 1 ${px.toFixed(2)} ${py.toFixed(2)} Tm <${hex}> Tj ET`);
  };
  const fill = (parts, x0, y0, w, h, shade) => parts.push(`${shade} g ${x0} ${y0} ${w} ${h} re f 0 g`);
  const line = (parts, x0, y0, x1, y1) => parts.push(`0.65 G 0.35 w ${x0} ${y0} m ${x1} ${y1} l S 0 G`);
  const ordered = [...grouped.values()]; // Input order is the current finishing order.
  for (const teamRows of ordered) {
    const rows = [...teamRows].sort((a,b) => Number(a.stint_number)-Number(b.stint_number));
    const team = rows[0]?.team_name || `Team ${rows[0]?.apex_id || ''}`;
    const kart = rows[0]?.kart_number || rows[0]?.kart || rows[0]?.kart_no || '';
    const displayName = `${kart ? `${kart} - ` : ''}${team}`;
    // Both Total columns have different meanings in the source report:
    // accumulated pit time and accumulated on-track time respectively.
    const durationSeconds = value => {
      const text = String(value ?? '').trim();
      // Pit duration is MM:SS.mmm; on-track duration is HH:MM:SS.
      const match = /^(\d+):(\d{2})(?::(\d{2}))?(?:\.(\d+))?$/.exec(text);
      if (!match) return null;
      const fraction = Number(`0.${match[4] || '0'}`);
      return match[3] !== undefined
        ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + fraction
        : Number(match[1]) * 60 + Number(match[2]) + fraction;
    };
    const asHms = seconds => {
      if (!Number.isFinite(seconds)) return '';
      const n = Math.round(seconds);
      return `${String(Math.floor(n / 3600)).padStart(2, '0')}:${String(Math.floor(n % 3600 / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
    };
    let cumulativePit = 0;
    const trackByDriver = new Map();
    const calculated = rows.map((r, index) => {
      const pitSeconds = durationSeconds(r.pit_time);
      const trackSeconds = durationSeconds(r.on_track);
      const driver = String(cleanDriver(r.driver_name) || '').trim().toLocaleLowerCase();
      const isFinal = index === rows.length - 1 && !r.pit_time;
      if (pitSeconds !== null) cumulativePit += pitSeconds;
      if (driver && trackSeconds !== null) {
        trackByDriver.set(driver, (trackByDriver.get(driver) || 0) + trackSeconds);
      }
      return {
        ...r,
        // The organiser leaves cumulative pit time empty on the finish row.
        report_pit_total: isFinal ? '' : (pitSeconds !== null ? asHms(cumulativePit) : ''),
        // This is cumulative ON-TRACK time for the individual driver, not the team.
        report_track_total: driver && trackByDriver.has(driver) ? asHms(trackByDriver.get(driver)) : '',
        report_finish: isFinal
      };
    });
    const pageSize = 28;
    for (let start=0; start<calculated.length; start+=pageSize) {
      const segment = calculated.slice(start,start+pageSize);
      const c=[];
      drawText(c, 'KARTING EVENTS BULGARIA', 20, 557, 18, true);
      drawText(c, `Race ${rid} - Pit stops`, 20, 531, 14, true);
      line(c, 18, 521, 824, 521);
      drawText(c, displayName, 20, 500, 15, true);
      const top=485, rowHeight=14;
      fill(c, 16, top-rowHeight, 806, rowHeight, '0.82');
      headers.forEach((h,i)=>drawText(c,h,x[i]+3,top-10,7,true));
      for (let i=0;i<segment.length;i++) {
        const r=segment[i], y=top-rowHeight*(i+2);
        if (i%2===1) fill(c,16,y,806,rowHeight,'0.94');
        const cells=[r.stint_number,r.end_lap_count??r.current_lap_count,r.pit_hour,r.report_pit_total,r.on_track,r.total_laps,
          cleanDriver(r.driver_name)||'',r.report_track_total,time(r.best_lap_time),time(r.avg_lap_time),r.pit_time,r.report_finish?'(Finish)':r.pit_hour];
        cells.forEach((v,j)=>drawText(c,fmt(v).slice(0,j===6?29:15),x[j]+3,y+4,7,j===4||j===6));
      }
      const bottom=top-rowHeight*(segment.length+1);
      for (let i=0;i<=columns.length;i++) line(c,x[i],bottom,x[i],top);
      for (let i=0;i<=segment.length+1;i++) line(c,16,top-i*rowHeight,822,top-i*rowHeight);
      drawText(c,`Race ${rid} | ${displayName} | ${Math.floor(start/pageSize)+1}`,20,20,7);
      const stream=c.join('\n');
      const length=enc.encode(stream).length;
      const contentId=add(`<< /Length ${length} >>\nstream\n${stream}\nendstream`);
      contents.push(contentId);
      pageIds.push(add('PENDING_PAGE'));
    }
  }
  if (!pageIds.length) throw new Error('No pit stop rows for PDF report');
  const pagesId=add('PENDING_PAGES');
  for(let i=0;i<pageIds.length;i++) objects[pageIds[i]]=`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${contents[i]} 0 R >>`;
  objects[pagesId]=`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] >>`;
  const catalog=add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[fontStreamId] = {header:`<< /Length ${fontData.length} /Length1 ${fontData.length} >>`, bytes:fontData};
  objects[gidMapId] = {header:`<< /Length ${mapData.length} /Filter /FlateDecode >>`, bytes:mapData};
  objects[descriptorId] = `<< /Type /FontDescriptor /FontName /PitUnicode /Flags 32 /FontBBox [-1021 -463 1793 1232] /ItalicAngle 0 /Ascent 928 /Descent -236 /CapHeight 729 /StemV 80 /FontFile2 ${fontStreamId} 0 R >>`;
  objects[descendantId] = `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /PitUnicode /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /DW 600 /CIDToGIDMap ${gidMapId} 0 R >>`;
  objects[regular] = `<< /Type /Font /Subtype /Type0 /BaseFont /PitUnicode /Encoding /Identity-H /DescendantFonts [${descendantId} 0 R] >>`;
  const chunks=[enc.encode('%PDF-1.4\n')]; const offsets=[0]; let length=chunks[0].length;
  const append = bytes => { chunks.push(bytes); length += bytes.length; };
  for(let i=1;i<objects.length;i++) {
    offsets[i]=length;
    append(enc.encode(`${i} 0 obj\n`));
    const obj=objects[i];
    if (obj && typeof obj === 'object' && obj.bytes) {
      append(enc.encode(`${obj.header}\nstream\n`));
      append(obj.bytes);
      append(enc.encode('\nendstream'));
    } else append(enc.encode(String(obj)));
    append(enc.encode('\nendobj\n'));
  }
  const xref=length;
  let trailer=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let i=1;i<objects.length;i++)trailer+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  trailer+=`trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  append(enc.encode(trailer));
  const output=new Uint8Array(length); let offset=0;
  for (const chunk of chunks) { output.set(chunk,offset); offset+=chunk.length; }
  return output;
}

function createPitStopsPdfResponse(rid, stints) {
  const bytes=buildFormattedPitPdf(stints,rid);
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

    // Exact latest Apex grid cells, kept for direct/raw display.
    // No completeness/freshness/analytics rules are applied to this map.
    this.rawRows = new Map();

    this.fullDetailRefreshRunning = false;
    this.lastFullDetailRefreshAt = 0;
    this.sessionResetting = false;

    this.detailRunning =
      new Set();

    this.lastDetailFetch =
      new Map();

    this.entryWriteCache = new Map();
    this.pendingEntryChanges = new Map();
    this.collectorErrors = [];
    this.lastEntryWrite = new Map();


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
        this.rawRows = new Map(Object.entries(await state.storage.get("rawRows") || {}));


        if (
          this.fieldApexIds.size === 0 &&
          this.positions.size > 0
        ) {
          this.fieldApexIds =
            new Set(
              this.positions.keys()
            );
        }


        // Free-tier DO write quota may already be exhausted. Do not write an alarm
        // during construction: that prevents the object from serving requests.

      }
    );
  }


  async persist() {
    // Durable Object writes are intentionally disabled while the account's
    // daily write quota is exhausted. Supabase remains the durable data store.
    // Never allow DO bookkeeping to stop Apex -> Supabase ingestion.
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
        ),

      rawRows:
        Object.fromEntries(
          this.rawRows
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
      this.state.waitUntil(this.alarm().catch(error => console.error("CRON BACKFILL", error)));

      // Startup must not launch a full-field historical refresh.
      // History is synchronized by the bounded alarm, one kart at a time.
      // No DO alarm write: the free-tier write quota is exhausted.

      return json(
        await this.snapshot()
      );
    }


    if (path === "/sync-check") {
      const id = new URL(request.url).searchParams.get("apex_id");
      if (!validApexId(id)) return json({ok:false,error:"Provide a valid apex_id"},400);
      try {
        const before = await sbGet(this.env,"apex_lap_events",{
          select:"lap_number",race_id:`eq.${this.rid}`,apex_id:`eq.${id}`,
          order:"lap_number.desc",limit:"1"
        });
        await this.refreshDetail(id,true);
        await this.flushEntryWrites();
        const after = await sbGet(this.env,"apex_lap_events",{
          select:"lap_number",race_id:`eq.${this.rid}`,apex_id:`eq.${id}`,
          order:"lap_number.desc",limit:"1"
        });
        return json({ok:true,apex_id:id,before_max_lap:before[0]?.lap_number ?? null,
          after_max_lap:after[0]?.lap_number ?? null,
          note:"Apex detail fetched, Supabase upsert and verification GET completed"});
      } catch(error) {
        this.recordSyncError("sync-check",id,error);
        return json({ok:false,apex_id:id,error:String(error)},502);
      }
    }

    if (
      path === "/status" ||
      path === "/snapshot"
    ) {
      return json({...(await this.snapshot()),sync_errors:this.collectorErrors,pending_entries:this.pendingEntryChanges.size});
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

      // No DO alarm write: the free-tier write quota is exhausted.

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


    // Recover missing historical lap/pit rows incrementally, one kart per alarm.
    // Never clear or overwrite the existing race history.
    try {
      const ids = [...this.fieldApexIds].map(String).filter(validApexId);
      if (ids.length) {
        const cursor = this.historyBackfillCursor || 0;
        const id = ids[cursor % ids.length];
        this.historyBackfillCursor = (cursor + 1) % ids.length;
        await this.refreshDetail(id, true);
      }
    } catch (error) {
      console.error("HISTORY BACKFILL:", error);
    } finally {
      // Backfill is driven by the existing cron -> /start route instead.
    }
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
                  (console.error("PACKET ERROR", error), this.recordSyncError("packet", "", error))
              );
        }
      );


      const disconnected =
        () => {
          this.ws =
            null;

          this.connecting =
            false;


          // Cron reconnects; do not attempt a DO storage write.
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


  // Buffer live-grid changes so one Apex packet does not issue hundreds of
  // serial GET/POST calls. A failed flush retains its pending changes.
  async upsertEntry(apexId, changes) {
    const id = String(apexId);
    this.pendingEntryChanges.set(id, {
      ...(this.pendingEntryChanges.get(id) || {}), ...changes
    });
  }

  async flushEntryWrites() {
    for (const [id, changes] of [...this.pendingEntryChanges]) {
      try {
        const cached = this.entryWriteCache.get(id);
        const old = cached || await this.getEntry(id) || {};
        const keys = ["team_name", "current_driver", "last_lap", "best_lap", "lap_count"];
        const next = Object.fromEntries(keys.map(key => [key,
          changes[key] !== undefined ? changes[key] : old[key] ?? null
        ]));
        if (!cached || !keys.every(key => cached[key] === next[key])) {
          await sbUpsert(this.env, "apex_entries", {
            race_id: this.rid, apex_id: id, ...next,
            updated_at: new Date().toISOString()
          }, "race_id,apex_id");
          this.entryWriteCache.set(id, next);
        }
        // Remove only changes that have actually been persisted. Changes may
        // have arrived during the awaited request.
        const latest = this.pendingEntryChanges.get(id);
        if (latest === changes) this.pendingEntryChanges.delete(id);
        else if (latest) {
          for (const [key, value] of Object.entries(changes)) {
            if (latest[key] === value) delete latest[key];
          }
          if (!Object.keys(latest).length) this.pendingEntryChanges.delete(id);
        }
      } catch (error) {
        console.error("APEX_ENTRY_WRITE_FAILED", { id, error: String(error) });
        this.recordSyncError("entry", id, error);
      }
    }
  }

  recordSyncError(stage, id, error) {
    this.collectorErrors.push({ at: new Date().toISOString(), stage, apex_id: id, error: String(error) });
    if (this.collectorErrors.length > 15) this.collectorErrors.shift();
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
    if(!force && now-(this.lastDetailFetch.get(id)||0)<60000)return;

    let entry = null;
    try { entry = await this.getEntry(id); }
    catch (error) { console.error("APEX_ENTRY_READ_FAILED", {id, error: String(error)}); }
    const snapshotLap=Number(this.lapCounts.get(id));
    const lapCount=Number.isFinite(snapshotLap) && snapshotLap > 0 ? snapshotLap : Number(entry?.lap_count);
    const requestedLapCount = Number.isFinite(lapCount) && lapCount > 0 ? lapCount : 800;

    this.lastDetailFetch.set(id,now);
    this.detailRunning.add(id);
    try {
      const raw=await this.requestDetail(id,requestedLapCount);
      const laps=parseLapRows(raw,this.rid).filter(r=>String(r.apex_id)===id);
      const pits=parsePitRows(raw,entry?.team_name || this.rawRows.get(id)?.c5?.value || "",this.rid).filter(r=>String(r.apex_id)===id && Number(r.pit_number)>0);
      // PRESERVE-FIRST: never reject real Apex detail rows because our own
      // expectation says the reply is "incomplete". Persist every lap/pit row
      // Apex actually returned. Do not delete older rows before merging.
      for(let i=0;i<laps.length;i+=250){
        await sbUpsert(this.env,"apex_lap_events",laps.slice(i,i+250),"race_id,apex_id,lap_number");
      }
      if(pits.length){
        await sbUpsert(this.env,"apex_pit_stints",pits,"race_id,apex_id,pit_number");
      }

      console.log("APEX_DETAIL_SAVED", {id, laps: laps.length, pits: pits.length, max_lap: Math.max(0,...laps.map(x=>Number(x.lap_number)||0))});
      await this.persist();
    } catch(error) {
      console.error("APEX_DETAIL_WRITE_FAILED", {id, error: String(error)});
      this.recordSyncError("detail", id, error);
      this.lastDetailFetch.delete(id);
      throw error;
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

    // Preserve the exact latest Apex cell before doing any interpretation.
    const raw = { ...(this.rawRows.get(id) || {}) };
    const rawKey = col || t || c || `field_${Object.keys(raw).length}`;
    raw[rawKey] = { column: col || null, type: t || c || null, cls: c || null, value };
    this.rawRows.set(id, raw);

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
          this.state.waitUntil(this.refreshDetail(id,false).catch(e=>console.error(`PIT DETAIL REFRESH ${id}:`,e)));
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
        // Apex is the source of truth: store exactly the latest BLP it sends.
        this.bestLaps.set(id,v);
        await this.upsertEntry(id,{best_lap:v});
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
        this.state.waitUntil(this.refreshDetail(id,false).catch(e=>console.error(`LAP DETAIL REFRESH ${id}:`,e)));
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

          // Do not infer or clear a session from grid values here.
          // The grid is display data and is preserved exactly as received.


          this.lastGridAt =
            new Date()
              .toISOString();


          for (const [apexId, fields] of grid.rows) {
            for (const cell of Object.values(fields)) {
              await this.applyField(apexId, cell.type, cell.type, cell.value, cell.column);
            }
          }

          await this.flushEntryWrites();
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
    await this.flushEntryWrites();
  }


  async handlePacket(payload) {
    const now = new Date();
    const previousPacketAt = this.lastPacketAt ? Date.parse(this.lastPacketAt) : NaN;
    const maxPreviousLap = Math.max(0, ...[...this.lapCounts.values()].map(value => Number(value) || 0));

    // Never archive/clear active race data based only on a websocket silence.

    this.packetCount +=
      1;


    this.lastPacketAt = now.toISOString();


    // Raw packet audit sampling: reduce write amplification while retaining
    // periodic evidence of the incoming Apex stream.
    if (this.packetCount % 20 === 0) {
      try {
        await sbInsert(this.env, "apex_raw_packets", { race_id: this.rid, payload });
      } catch (error) {
        console.warn("RAW PACKET SAVE:", error);
      }
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


      if (url.pathname === "/api/collector/sync-check") {
        const id = url.searchParams.get("apex_id");
        if (!validApexId(id)) return json({ok:false,error:"Invalid apex_id"},400);
        try { return json(await directSyncKart(env, id)); }
        catch (error) { return json({ok:false,apex_id:id,error:String(error),source:"direct-worker-no-durable-object"},502); }
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


      // Read-only inspection of actual Apex cells; no Supabase or DO writes.
      if (url.pathname === "/api/collector/grid-cells") {
        const id = String(url.searchParams.get("apex_id") || "");
        if (!validApexId(id)) return json({ error: "Invalid apex_id" }, 400);
        const snapshot = await directApexSnapshot(env);
        const cells = snapshot?.rawRows?.[id] || null;
        return json({ ok: !!cells, apex_id: id,
          source: "direct-apex-grid", field_count: snapshot?.field_count || 0,
          column_types: snapshot?.columnTypes || {},
          kart: cells?.c3 || null, nation: cells?.c4 || null,
          available_columns: cells ? Object.keys(cells) : [],
          kart_source: cells?.c3 ? "grid-cell-or-row-attribute" : "not-present-in-grid" });
      }

      // Read-only diagnostic of the actual timing detail response. This lets us
      // verify the upstream record layout before changing BEST LAP parsing.
      if (url.pathname === "/api/collector/lap-detail-inspect") {
        const id = String(url.searchParams.get("apex_id") || "").trim();
        if (!validApexId(id)) return json({error:"Invalid apex_id"}, 400);
        const raw = await directApexDetail(env, id, 800);
        const lines = String(raw).split(/\r?\n/).filter(Boolean);
        const relevant = lines.filter(line =>
          line.includes(`D${id}.L`) || line.includes(`D${id}.B`) ||
          /(?:^|[#\s])(?:L|B)\d*[#=]/.test(line));
        const parsed = parseLapRows(raw, rid).filter(row => String(row.apex_id) === id);
        const official = Number(url.searchParams.get("official_best"));
        const matching = Number.isFinite(official) && official > 0
          ? parsed.filter(row => Math.round(Number(row.lap_time)*1000) === Math.round(official*1000))
          : [];
        return json({apex_id:id, raw_length:raw.length, line_count:lines.length,
          relevant_line_count:relevant.length, parsed_lap_count:parsed.length,
          parsed_first:parsed.slice(0,3).map(row=>({lap_number:row.lap_number,lap_time:row.lap_time})),
          parsed_last:parsed.slice(-3).map(row=>({lap_number:row.lap_number,lap_time:row.lap_time})),
          official_best:Number.isFinite(official)?official:null,
          matched_laps:matching.map(row=>row.lap_number),
          // Include only a small number of raw timing records for parser inspection.
          raw_samples:relevant.slice(0,5).concat(relevant.slice(-5)).map(line=>line.slice(0,350))});
      }

      // Read-only, complete timing history for a single current-race entry.
      // Keep status-prefixed laps, which the analytics parser intentionally omits.
      if (url.pathname === "/api/reports/raw-entry-laps") {
        const id = String(url.searchParams.get("apex_id") || "").trim();
        const officialMillis = Math.round(Number(url.searchParams.get("official_best")) * 1000);
        if (!validApexId(id) || !Number.isSafeInteger(officialMillis) || officialMillis <= 0) {
          return json({error:"Invalid entry or official best"}, 400);
        }
        const livePort = (() => {
          try { return new URL(env.APEX_WS_URL || "wss://live-data.apex-timing.com:8913/").port || "8913"; }
          catch { return "8913"; }
        })();
        const ports = [...new Set([livePort, env.APEX_DETAIL_PORT || "8910"])];
        for (const port of ports) {
          const request = `D#-800#D${id}.L#-800#D${id}.P#-999#D${id}.B#1#D${id}.INF`;
          try {
            const response = await fetch("https://live-data.apex-timing.com/live-timing/commonv2/functions/request.php", {
              method:"POST", headers:{"content-type":"application/x-www-form-urlencoded; charset=UTF-8"},
              body:new URLSearchParams({port,request})
            });
            if (!response.ok) continue;
            const raw = await response.text();
            const lines = raw.split(/\r?\n/);
            const best = lines.find(line => line.startsWith(`D${id}.BL#`));
            const bestCell = best?.split("#")[1]?.split("|")[3] || "";
            const bestMatch = /^[a-zA-Z]*(\d+)$/.exec(bestCell.trim());
            if (!bestMatch || Number(bestMatch[1]) !== officialMillis) continue;
            const pattern = new RegExp(`^D${id}\\.L0*(\\d+)#(.+)$`);
            const laps = [];
            for (const line of lines) {
              const match = pattern.exec(line.trim());
              if (!match) continue;
              const cells = match[2].split("|");
              const timeCell = (cells[3] || "").trim();
              const numeric = /^[a-zA-Z]*(\d+)$/.exec(timeCell);
              laps.push({lap_number:Number(match[1]), raw_time:timeCell,
                lap_time:numeric ? Number(numeric[1])/1000 : null});
            }
            if (!laps.length) continue;
            return json({apex_id:id, port, official_best:officialMillis/1000, laps});
          } catch (error) { console.warn("Raw entry history unavailable", id, port, String(error)); }
        }
        return json({error:"No matching official timing history for this entry"}, 409);
      }

      // Per-kart read: one small, indexed lap history instead of a race-wide
      // scan that exceeds the Worker subrequest budget.
      if (url.pathname === "/api/overview/lap-stats") {
        const id = String(url.searchParams.get("apex_id") || "").trim();
        if (!validApexId(id)) return json({error:"Invalid apex_id"}, 400);
        const [laps, pits, exclusions] = await Promise.all([
          sbGetAll(env, "apex_lap_events", {
            select:"apex_id,lap_number,lap_time", race_id:`eq.${rid}`,
            apex_id:`eq.${id}`, order:"lap_number.asc"
          }),
          loadPits(env, rid, id),
          sbGetAll(env, "manual_lap_exclusions", {
            select:"apex_id,lap_number", race_id:`eq.${rid}`, apex_id:`eq.${id}`
          })
        ]);
        const stats = lapAnalysisByKart(laps, pits, exclusions, [id]).get(id);
        // Keep the timing identity intact: all records must carry the exact
        // same entry id. The BL record is the source of the official best,
        // and L records are the source of its lap number.
        const officialBest = Number(url.searchParams.get("official_best"));
        let officialLapNumber = null;
        let officialLapSource = null;
        if (url.searchParams.has("official_best") &&
            Number.isFinite(officialBest) && officialBest > 0) {
          const millis = Math.round(officialBest * 1000);
          const sameTime = value => Number.isFinite(Number(value)) &&
            Math.round(Number(value) * 1000) === millis;
          // The live grid uses port 8913 by default. The historical detail
          // endpoint previously used 8910, which can refer to a different
          // session even when the numeric entry id happens to exist there.
          // Accept a lap only if this entry's own BL agrees with the grid BEST.
          const livePort = (() => {
            try { return new URL(env.APEX_WS_URL || "wss://live-data.apex-timing.com:8913/").port || "8913"; }
            catch { return "8913"; }
          })();
          const ports = [...new Set([livePort, env.APEX_DETAIL_PORT || "8910"])];
          for (const port of ports) {
            try {
              const count = 800;
              const request = `D#-${count}#D${id}.L#-${count}#D${id}.P#-999#D${id}.B#1#D${id}.INF`;
              const response = await fetch("https://live-data.apex-timing.com/live-timing/commonv2/functions/request.php", {
                method: "POST",
                headers: {"content-type": "application/x-www-form-urlencoded; charset=UTF-8"},
                body: new URLSearchParams({port, request})
              });
              if (!response.ok) continue;
              const raw = await response.text();
              const bl = String(raw).split(/\r?\n/).find(line =>
                line.startsWith(`D${id}.BL#`));
              const blMillis = bl ? Number(bl.slice(bl.indexOf("#") + 1).split("|")[3]) : NaN;
              if (blMillis !== millis) continue;
              // Detail cells can carry timing status prefixes (e.g. g52452).
              // parseLapRows intentionally skips those records for analytics;
              // read the official lap number from the raw record instead.
              const lapPattern = new RegExp(`^D${id}\\.L0*(\\d+)#(.+)$`);
              for (const line of raw.split(/\r?\n/)) {
                const lap = lapPattern.exec(line.trim());
                if (!lap) continue;
                const timeCell = lap[2].split("|")[3]?.trim() || "";
                const value = /^(?:[a-zA-Z]*)(\d+)$/.exec(timeCell);
                if (!value || Number(value[1]) !== millis) continue;
                officialLapNumber = Number(lap[1]);
                officialLapSource = `timing-detail:${port}`;
                break;
              }
              if (officialLapNumber !== null) break;
            } catch (error) {
              console.warn("Official lap detail unavailable", id, port, String(error));
            }
          }
          // Persisted original timing laps are safe only when they match
          // this exact entry and official time. Never use analytical best.
          if (officialLapNumber === null) {
            const matches = laps.filter(row => String(row.apex_id) === id &&
              sameTime(row.lap_time) && Number.isInteger(Number(row.lap_number)) &&
              Number(row.lap_number) > 0);
            if (matches.length) {
              officialLapNumber = Number(matches[0].lap_number);
              officialLapSource = "persisted-timing-record";
            }
          }
        }
        return json({race_id:rid, apex_id:id, ...stats,
          best_lap_number: officialLapNumber, best_lap_source: officialLapSource});
      }

      if (url.pathname === "/api/live") {
        return json(await livePayload(env, raceId(env)));
      }


      if (
        url.pathname ===
        "/api/overview"
      ) {
        const snapshot = null;
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


      if (url.pathname === "/api/raw/apex") {
        const rawSnapshot = Number(rid) === Number(raceId(env)) ? await collectorSnapshot(env).catch(() => null) : null;
        return json(await rawApexPayload(env, rid, rawSnapshot, url.searchParams.get("limit") || 200));
      }

      // Report-only bounded calculation: one team per invocation, no all-race scan.
      if (url.pathname === "/api/reports/pit-stops.stints-part" && request.method === "POST") {
        const body = await request.json();
        const sourceId = Number(body?.race_id);
        const id = String(body?.apex_id || "");
        const keys = ["entries", "pits", "exclusions", "laps"];
        if (!Number.isSafeInteger(sourceId) || sourceId <= 0 || sourceId !== Number(rid) ||
            !validApexId(id) || !keys.every(k => Array.isArray(body[k])) ||
            body.entries.length > 20 || body.pits.length > 200 ||
            body.exclusions.length > 1000 || body.laps.length > 3000 ||
            keys.some(k => body[k].some(row => Number(row.race_id) !== sourceId || String(row.apex_id) !== id))) {
          return json({error: "Invalid bounded pit stint data"}, 400);
        }
        const snapshot = sourceId === Number(raceId(env))
          ? await collectorSnapshot(env).catch(() => null) : null;
        const rows = await stintsPayload(env, sourceId, snapshot, {...body, reportFieldIds: [id]});
        return json({race_id: sourceId, apex_id: id, rows});
      }

      // Assemble already calculated report rows without loading the race again.
      if (url.pathname === "/api/reports/pit-stops.pdf-from-stints" && request.method === "POST") {
        const body = await request.json();
        const sourceId = Number(body?.race_id);
        if (!Number.isSafeInteger(sourceId) || sourceId <= 0 || sourceId !== Number(rid) ||
            !Array.isArray(body.rows) || body.rows.length > 5000 ||
            body.rows.some(row => Number(row.race_id) !== sourceId || !validApexId(String(row.apex_id)))) {
          return json({error: "Invalid pit report rows"}, 400);
        }
        // The client sends the official finishing order explicitly; rows arrive
        // asynchronously from parallel per-team calculations.
        const order = body.finishing_order;
        if (!Array.isArray(order) || !order.length || order.length > 1000 ||
            order.some(id => !validApexId(String(id))) ||
            new Set(order.map(String)).size !== order.length ||
            body.rows.some(row => !order.map(String).includes(String(row.apex_id)))) {
          return json({error: "Invalid finishing order for pit report"}, 400);
        }
        const rank = new Map(order.map((id, i) => [String(id), i]));
        const sortedRows = [...body.rows].sort((a,b) =>
          rank.get(String(a.apex_id)) - rank.get(String(b.apex_id)) ||
          Number(a.stint_number) - Number(b.stint_number));
        return createPitStopsPdfResponse(sourceId, sortedRows);
      }

      // Generate the existing pit report from bounded pages supplied by the client.
      // No all-race Supabase scan is performed in this Worker invocation.
      if (url.pathname === "/api/reports/pit-stops.pdf-bounded" && request.method === "POST") {
        const body = await request.json();
        const sourceId = Number(body?.race_id);
        if (!Number.isSafeInteger(sourceId) || sourceId <= 0 || sourceId !== Number(rid) ||
            !["entries", "pits", "exclusions", "laps"].every(k => Array.isArray(body[k]))) {
          return json({error: "Invalid bounded pit report data"}, 400);
        }
        if (body.entries.length > 1000 || body.pits.length > 10000 ||
            body.exclusions.length > 10000 || body.laps.length > 300000 ||
            [...body.entries, ...body.pits, ...body.exclusions, ...body.laps]
              .some(row => Number(row.race_id) !== sourceId)) {
          return json({error: "Invalid race records for bounded pit report"}, 400);
        }
        const snapshot = sourceId === Number(raceId(env))
          ? await collectorSnapshot(env).catch(() => null) : null;
        const stints = await stintsPayload(env, sourceId, snapshot, body);
        return createPitStopsPdfResponse(sourceId, stints);
      }

      // Bounded, read-only archive export. Each page uses ONE Supabase request.
      // Export pages BEFORE changing DEFAULT_RACE_ID. Never silently omit failures.
      if (url.pathname === "/api/archive/export-page") {
        const table = String(url.searchParams.get("table") || "");
        const allowed = new Set([
          "apex_entries", "apex_lap_events", "apex_pit_stints",
          "manual_lap_exclusions"
        ]);
        if (!allowed.has(table)) return json({ error: "Unsupported archive table" }, 400);
        const sourceId = Number(url.searchParams.get("race_id"));
        const page = Number(url.searchParams.get("page") || 0);
        if (!Number.isSafeInteger(sourceId) || sourceId <= 0 ||
            !Number.isSafeInteger(page) || page < 0 || page > 100000) {
          return json({ error: "Invalid race_id or page" }, 400);
        }
        const pageSize = 500;
        const ordering = table === "apex_lap_events" ? "apex_id.asc,lap_number.asc" :
          table === "apex_pit_stints" ? "apex_id.asc,pit_number.asc" :
          table === "manual_lap_exclusions" ? "apex_id.asc,lap_number.asc" : "apex_id.asc";
        const rows = await sbGet(env, table, {
          select: "*", race_id: `eq.${sourceId}`, order: ordering
        }, { from: page * pageSize, to: (page + 1) * pageSize - 1 });
        return json({ race_id: sourceId, table, page, page_size: pageSize,
          count: rows.length, has_more: rows.length === pageSize, rows });
      }

      if (url.pathname === "/api/reports/apex-raw.json") {
        const rawSnapshot = Number(rid) === Number(raceId(env)) ? await collectorSnapshot(env).catch(() => null) : null;
        return createRawApexJsonResponse(env, rid, rawSnapshot);
      }

      if (url.pathname === "/api/reports/apex-raw.txt") {
        return createRawApexTextResponse(env, rid);
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
          // A team listing must not recompute every lap/stint of the race.
          // The old path fetched the entire lap history and exceeded the
          // per-invocation subrequest budget once the race grew.
          // Obtain actual team labels from the live timing grid. Stored
          // historical entry names may contain driver names instead.
          const gridSnapshot = Number(rid) === Number(raceId(env))
            ? await directApexSnapshot(env).catch(() => null)
            : null;
          const [entriesRaw, pitsRaw] = await Promise.all([
            loadEntries(env, rid),
            loadPits(env, rid)
          ]);
          const activeIds = currentFieldIds(gridSnapshot).size
            ? currentFieldIds(gridSnapshot)
            : (fieldIds.size ? fieldIds : new Set(
                entriesRaw.map(row => String(row.apex_id ?? "")).filter(validApexId)
              ));
          const entries = filterCurrentField(entriesRaw, activeIds);
          const pits = filterCurrentField(pitsRaw, activeIds);
          // Avoid loading the entire race history for a team listing.
          // Analytics are unavailable until server-side aggregation is installed.
          const teamAnalysis = new Map();
          const pitGroups = new Map();
          for (const pit of pits) {
            const id = String(pit.apex_id);
            if (!pitGroups.has(id)) pitGroups.set(id, []);
            pitGroups.get(id).push(pit);
          }
          const entryById = new Map();
          for (const entry of entries) {
            const id = String(entry.apex_id);
            if (!entryById.has(id)) entryById.set(id, entry);
          }
          const rows = [];
          for (const id of activeIds) {
            const entry = entryById.get(String(id)) || {};
            const teamPits = pitGroups.get(String(id)) || [];
            const drivers = new Set(teamPits.map(p => cleanDriver(p.driver_name)).filter(Boolean));
            const currentDriver = cleanDriver(snapshot?.drivers?.[id] || entry.current_driver);
            if (currentDriver) drivers.add(currentDriver);
            const position = Number(snapshot?.positions?.[id]);
            const lapCount = Number(snapshot?.lapCounts?.[id] ?? entry.lap_count);
            const stats = teamAnalysis.get(String(id)) || {valid_laps:null,avg_lap_time:null,best_lap_time:null,best_lap_number:null,worst_lap_time:null,worst_lap_number:null,consistency:null};
            rows.push({
              race_id: rid, apex_id: String(id),
              position: Number.isFinite(position) && position > 0 ? position : null,
              team_name: gridSnapshot?.teamNames?.[id]
                || (gridSnapshot?.rawRows?.[id]?.c5?.value ? stripHtml(gridSnapshot.rawRows[id].c5.value) : null)
                || teamPits.find(p => p.team_name && cleanDriver(p.team_name) !== cleanDriver(p.driver_name))?.team_name
                || entry.team_name || `Team ${id}`,
              driver_count: drivers.size, drivers: drivers.size,
              stint_count: teamPits.length + 1,
              valid_stint_count: null, valid_laps: stats.valid_laps,
              total_laps: Number.isFinite(lapCount) ? lapCount : null,
              avg_lap_time: stats.avg_lap_time,
              best_lap_time: stats.best_lap_time,
              best_lap_number: stats.best_lap_number,
              worst_lap_time: stats.worst_lap_time,
              worst_lap_number: stats.worst_lap_number,
              avg_consistency: stats.consistency, consistency: stats.consistency,
              driver_spread: null
            });
          }
          rows.sort((a, b) => {
            if (a.position !== null && b.position !== null) return a.position - b.position;
            if (a.position !== null) return -1;
            if (b.position !== null) return 1;
            return Number(a.apex_id) - Number(b.apex_id);
          });

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


  async scheduled(controller, env, ctx) {
    ctx.waitUntil(directCronSync(env).catch(error => console.error("DIRECT_SYNC_CRON_FAILED", String(error))));
  }
};
