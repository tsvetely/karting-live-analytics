const VERSION = "2026-08-30-race-engineer-v8-current-session-scope";
const PAGE_SIZE = 1000;
const BACKFILL_BATCH = 2;
const LIVE_PACKET_TTL_MS = 180000;
const CURRENT_ENTRY_WINDOW_MS = 10 * 60 * 1000;

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
  const raw = url?.searchParams.get("race_id") || env.DEFAULT_RACE_ID || "1";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
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

async function sbGet(env, table, params = {}, range = null) {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = sbHeaders(env, { accept: "application/json" });

  if (range) {
    headers.Range = `${range.from}-${range.to}`;
    headers["Range-Unit"] = "items";
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(
      `Supabase GET ${table}: ${response.status} ${await response.text()}`
    );
  }

  return response.json();
}

async function sbGetAll(env, table, params = {}) {
  const result = [];
  let from = 0;

  while (true) {
    const rows = await sbGet(env, table, params, {
      from,
      to: from + PAGE_SIZE - 1
    });

    result.push(...rows);

    if (rows.length < PAGE_SIZE) {
      break;
    }

    from += rows.length;
  }

  return result;
}

async function sbWrite(
  env,
  table,
  method,
  body,
  params = {},
  prefer = "return=minimal"
) {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    headers: sbHeaders(env, {
      Prefer: prefer
    }),
    body:
      body === undefined
        ? undefined
        : JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(
      `Supabase ${method} ${table}: ${response.status} ${await response.text()}`
    );
  }
}

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
      on_conflict: conflict
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
  return String(value ?? "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDriver(value) {
  return stripHtml(value)
    .replace(/\s*\[[^\]]+\]\s*$/, "")
    .trim();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? n
    : null;
}

function parseNumber(value) {
  const n = Number(
    String(value ?? "")
      .replace(/[^\d.-]/g, "")
  );

  return Number.isFinite(n)
    ? n
    : null;
}

function parseLapTime(value) {
  const text = stripHtml(value);

  if (!text || text === "-") {
    return null;
  }

  if (text.includes(":")) {
    const parts = text.split(":");

    if (parts.length !== 2) {
      return null;
    }

    const m = Number(parts[0]);
    const s = Number(parts[1]);

    return (
      Number.isFinite(m) &&
      Number.isFinite(s)
    )
      ? m * 60 + s
      : null;
  }

  const n = Number(text);

  return Number.isFinite(n)
    ? n
    : null;
}

function formatLapTime(value) {
  const seconds = Number(value);

  if (
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return "";
  }

  if (seconds < 60) {
    return seconds.toFixed(3);
  }

  const minutes = Math.floor(
    seconds / 60
  );

  const rest = (
    seconds -
    minutes * 60
  )
    .toFixed(3)
    .padStart(6, "0");

  return `${minutes}:${rest}`;
}

function validApexId(value) {
  const text = String(
    value ?? ""
  ).trim();

  return (
    /^\d+$/.test(text) &&
    Number(text) > 0
  );
}

function badTeamName(
  team,
  driver = null
) {
  const value = stripHtml(team);

  if (!value) {
    return true;
  }

  return (
    !!driver &&
    value.toUpperCase() ===
      String(driver)
        .trim()
        .toUpperCase()
  );
}

function parseProtocolLine(line) {
  const parts = String(
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
          match[2] ||
          null
      }
    : null;
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

  let match;

  const headerRegex =
    /<td\b([^>]*)>/gi;

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
      !validApexId(
        apexId
      )
    ) {
      continue;
    }

    const attrs =
      `${match[1]} ${match[3]}`;

    const positionMatch =
      /data-pos=["'](\d+)["']/i
        .exec(
          attrs
        );

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

    let cellMatch;

    const cellRegex =
      /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;

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

function msToTime(ms) {
  const value = Number(ms);

  if (
    !Number.isFinite(value)
  ) {
    return null;
  }

  const total =
    Math.floor(
      value / 1000
    );

  const h =
    Math.floor(
      total / 3600
    );

  const m =
    Math.floor(
      (
        total %
        3600
      ) / 60
    );

  const s =
    total % 60;

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
  apexId = null,
  ids = null
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
  } else {
    const filter =
      apexIdsFilter(ids);

    if (filter) {
      params.apex_id =
        filter;
    }
  }

  return sbGetAll(
    env,
    "apex_pit_stints",
    params
  );
}

function loadCompletedStints(
  env,
  rid,
  ids = null
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
        "apex_id.asc,start_lap_count.asc",

      apex_id:
        apexIdsFilter(ids)
    }
  )
    .catch(
      () => []
    );
}

function loadLiveStints(
  env,
  rid,
  ids = null
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
        "apex_id.asc,start_lap_count.asc",

      apex_id:
        apexIdsFilter(ids)
    }
  )
    .catch(
      () => []
    );
}

function loadExclusions(
  env,
  rid,
  ids = null
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
        "apex_id.asc,lap_number.asc",

      apex_id:
        apexIdsFilter(ids)
    }
  )
    .catch(
      () => []
    );
}

function loadLapEventsForApex(
  env,
  rid,
  apexId
) {
  return sbGetAll(
    env,
    "apex_lap_events",
    {
      select:
        "apex_id,lap_number,lap_time",

      race_id:
        `eq.${rid}`,

      apex_id:
        `eq.${apexId}`,

      order:
        "lap_number.asc"
    }
  );
}

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

    if (
      !validApexId(id)
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
      stripHtml(value);

    if (clean) {
      return clean;
    }
  }

  return null;
}

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
      LIVE_PACKET_TTL_MS
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
      validApexId(
        value
      )
    ) {
      result.add(
        String(
          value
        ).trim()
      );
    }
  }

  if (
    !result.size &&
    snapshot?.positions
  ) {
    for (
      const value
      of Object.keys(
        snapshot.positions
      )
    ) {
      if (
        validApexId(
          value
        )
      ) {
        result.add(
          String(
            value
          ).trim()
        );
      }
    }
  }

  return result;
}

function idsFromEntries(
  entries
) {
  return new Set(
    entries
      .map(
        row =>
          String(
            row.apex_id ??
            ""
          )
      )
      .filter(
        validApexId
      )
  );
}

function recentEntryIds(
  entries,
  windowMs = CURRENT_ENTRY_WINDOW_MS
) {
  let newest = 0;

  for (
    const row
    of entries || []
  ) {
    if (
      !validApexId(
        row.apex_id
      )
    ) {
      continue;
    }

    const timestamp =
      Date.parse(
        row.updated_at ||
        row.received_at ||
        ""
      ) ||
      0;

    if (timestamp > newest) {
      newest = timestamp;
    }
  }

  if (!newest) {
    return new Set();
  }

  const cutoff =
    newest -
    windowMs;

  return new Set(
    (entries || [])
      .filter(
        row => {
          const id =
            String(
              row.apex_id ??
              ""
            );

          const timestamp =
            Date.parse(
              row.updated_at ||
              row.received_at ||
              ""
            ) ||
            0;

          return (
            validApexId(id) &&
            timestamp >= cutoff
          );
        }
      )
      .map(
        row =>
          String(
            row.apex_id
          )
      )
  );
}

function currentScopeIds(
  entries,
  snapshot
) {
  const recent =
    recentEntryIds(
      entries
    );

  const live =
    currentFieldIds(
      snapshot
    );

  if (
    recent.size &&
    live.size
  ) {
    /*
     * A stale Durable Object could still contain hundreds of IDs
     * from older sessions that shared race_id=1.  Recent database
     * entries identify the field currently receiving live updates.
     * When the live set is of comparable size, keep any legitimate
     * live IDs that have not updated in the last few minutes yet.
     */
    if (
      live.size <=
      recent.size * 1.5 + 10
    ) {
      return new Set([
        ...recent,
        ...live
      ]);
    }

    return recent;
  }

  return recent.size
    ? recent
    : live;
}

function apexIdsFilter(ids) {
  const values =
    [
      ...(ids || [])
    ]
      .map(
        value =>
          String(value).trim()
      )
      .filter(
        validApexId
      );

  return values.length
    ? `in.(${values.join(",")})`
    : null;
}

function teamNameMapFromRows(
  ...groups
) {
  const result =
    new Map();

  for (
    const row
    of groups.flat()
  ) {
    const id =
      String(
        row?.apex_id ??
        ""
      );

    if (
      !validApexId(id)
    ) {
      continue;
    }

    const team =
      stripHtml(
        row?.team_name
      );

    const driver =
      row?.driver_name ||
      row?.current_driver ||
      null;

    if (
      !result.has(id) &&
      !badTeamName(
        team,
        driver
      )
    ) {
      result.set(
        id,
        team
      );
    }
  }

  return result;
}

function filterByIds(
  rows,
  ids
) {
  if (!ids?.size) {
    return [];
  }

  return rows.filter(
    row => {
      const id =
        String(
          row.apex_id ??
          ""
        );

      return (
        validApexId(id) &&
        ids.has(id)
      );
    }
  );
}

function newestEntryMap(
  entries
) {
  const result =
    new Map();

  for (
    const row
    of entries
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

    const previous =
      result.get(id);

    if (!previous) {
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
      ) ||
      0;

    const previousTime =
      Date.parse(
        previous.updated_at ||
        previous.received_at ||
        ""
      ) ||
      0;

    if (
      rowTime >=
      previousTime
    ) {
      result.set(
        id,
        row
      );
    }
  }

  return result;
}
function uniquePits(rows) {
  const result =
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

    const pitNumber =
      Number(
        row.pit_number
      );

    if (
      !validApexId(id) ||
      !Number.isFinite(
        pitNumber
      )
    ) {
      continue;
    }

    const key =
      `${id}:${Math.trunc(
        pitNumber
      )}`;

    const previous =
      result.get(key);

    if (!previous) {
      result.set(
        key,
        row
      );

      continue;
    }

    const rowTime =
      Date.parse(
        row.updated_at ||
        ""
      ) ||
      0;

    const previousTime =
      Date.parse(
        previous.updated_at ||
        ""
      ) ||
      0;

    if (
      rowTime >=
      previousTime
    ) {
      result.set(
        key,
        row
      );
    }
  }

  return [
    ...result.values()
  ];
}

function exclusionSet(rows) {
  const result =
    new Set();

  for (
    const row
    of rows
  ) {
    const id =
      String(
        row.apex_id ??
        ""
      );

    const lap =
      Number(
        row.lap_number
      );

    if (
      validApexId(id) &&
      Number.isFinite(lap)
    ) {
      result.add(
        `${id}:${Math.trunc(
          lap
        )}`
      );
    }
  }

  return result;
}

function normalizeLapRows(rows) {
  const byLap =
    new Map();

  for (
    const row
    of rows ||
    []
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
      lap <= 0 ||
      time <= 0
    ) {
      continue;
    }

    byLap.set(
      Math.trunc(lap),
      {
        lap_number:
          Math.trunc(lap),

        lap_time:
          time
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

function hasLapCoverageThrough(
  rows,
  endLap
) {
  const end =
    Number(endLap);

  if (
    !Number.isFinite(end) ||
    end <= 0
  ) {
    return false;
  }

  let maxLap = 0;

  for (
    const row
    of rows || []
  ) {
    const lap =
      Number(
        row.lap_number
      );

    if (
      Number.isFinite(lap) &&
      lap > maxLap
    ) {
      maxLap = lap;
    }
  }

  return maxLap >= end;
}

function calculateRawStats(
  apexId,
  lapRows,
  startLap,
  endLap,
  exclusions,
  isLive
) {
  const start =
    Number(
      startLap
    ) ||
    0;

  const end =
    Number(
      endLap
    );

  if (
    !Number.isFinite(end) ||
    end <= start
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

  /*
   * Valid pace range is always:
   *
   *   start < lap <= end
   *
   * Exclude only the first lap after a previous pit boundary
   * (start + 1 when start > 0) plus explicit manual exclusions.
   * The end lap remains valid; a slow lap is not invalid by itself.
   */
  const pitOutLap =
    start > 0
      ? start + 1
      : null;

  const valid = [];

  for (
    const row
    of normalizeLapRows(
      lapRows
    )
  ) {
    const lap =
      row.lap_number;

    if (
      lap <= start ||
      lap > end
    ) {
      continue;
    }

    if (
      pitOutLap !== null &&
      lap === pitOutLap
    ) {
      continue;
    }

    if (
      exclusions.has(
        `${apexId}:${lap}`
      )
    ) {
      continue;
    }

    valid.push(row);
  }

  if (
    !valid.length
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

  let sum = 0;

  let best =
    valid[0];

  let worst =
    valid[0];

  for (
    const row
    of valid
  ) {
    sum +=
      row.lap_time;

    if (
      row.lap_time <
      best.lap_time
    ) {
      best =
        row;
    }

    if (
      row.lap_time >
      worst.lap_time
    ) {
      worst =
        row;
    }
  }

  const average =
    sum /
    valid.length;

  let variance =
    0;

  for (
    const row
    of valid
  ) {
    variance +=
      (
        row.lap_time -
        average
      ) ** 2;
  }

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

    consistency:
      Math.sqrt(
        variance /
        valid.length
      )
  };
}

function savedCompletedStats(
  row,
  expectedEnd
) {
  if (!row) {
    return null;
  }

  const end =
    Number(
      row.end_lap_count ??
      row.current_lap_count
    );

  const valid =
    Number(
      row.valid_laps
    );

  const average =
    Number(
      row.avg_lap_time ??
      row.avg_lap
    );

  const best =
    Number(
      row.best_lap_time ??
      row.best_lap
    );

  const worst =
    Number(
      row.worst_lap_time ??
      row.worst_lap
    );

  if (
    !Number.isFinite(end) ||
    end !==
      Number(
        expectedEnd
      )
  ) {
    return null;
  }

  if (
    !Number.isFinite(valid) ||
    valid <= 0
  ) {
    return null;
  }

  if (
    !Number.isFinite(average) ||
    average <= 0
  ) {
    return null;
  }

  if (
    !Number.isFinite(best) ||
    best <= 0
  ) {
    return null;
  }

  if (
    !Number.isFinite(worst) ||
    worst <= 0
  ) {
    return null;
  }

  return {
    valid_laps:
      valid,

    avg_lap_time:
      average,

    best_lap_time:
      best,

    best_lap_number:
      num(
        row.best_lap_number
      ),

    worst_lap_time:
      worst,

    worst_lap_number:
      num(
        row.worst_lap_number
      ),

    consistency:
      num(
        row.consistency
      )
  };
}

function savedLiveStats(
  row,
  expectedStart
) {
  if (!row) {
    return null;
  }

  const start =
    Number(
      row.start_lap_count
    );

  const valid =
    Number(
      row.valid_laps
    );

  const average =
    Number(
      row.avg_lap_time ??
      row.avg_lap
    );

  if (
    !Number.isFinite(start) ||
    start !==
      Number(
        expectedStart
      )
  ) {
    return null;
  }

  if (
    !Number.isFinite(valid) ||
    valid <= 0
  ) {
    return null;
  }

  if (
    !Number.isFinite(average) ||
    average <= 0
  ) {
    return null;
  }

  return {
    valid_laps:
      valid,

    avg_lap_time:
      average,

    best_lap_time:
      num(
        row.best_lap_time ??
        row.best_lap
      ),

    best_lap_number:
      num(
        row.best_lap_number
      ),

    worst_lap_time:
      num(
        row.worst_lap_time ??
        row.worst_lap
      ),

    worst_lap_number:
      num(
        row.worst_lap_number
      ),

    consistency:
      num(
        row.consistency
      )
  };
}

async function buildStintsForTeam({
  env,
  rid,
  apexId,
  entry,
  pits,
  completed,
  liveRows,
  teamMap,
  exclusions,
  sessionIsLive
}) {
  const id =
    String(
      apexId
    );

  const team =
    resolveTeam(
      id,
      teamMap,
      entry?.team_name,
      pits[0]?.team_name,
      completed[0]?.team_name,
      liveRows[0]?.team_name
    );

  const sortedPits =
    uniquePits(
      pits
    )
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
            a.pit_lap
          ) -
          Number(
            b.pit_lap
          )
      );

  const boundaries = [];

  const seenBoundary =
    new Set();

  for (
    const pit
    of sortedPits
  ) {
    const lap =
      Math.trunc(
        Number(
          pit.pit_lap
        )
      );

    if (
      seenBoundary.has(
        lap
      )
    ) {
      continue;
    }

    seenBoundary.add(
      lap
    );

    boundaries.push({
      lap,
      pit
    });
  }

  const completedByStart =
    new Map();

  for (
    const row
    of completed
  ) {
    const start =
      Number(
        row.start_lap_count
      );

    if (
      Number.isFinite(start)
    ) {
      completedByStart.set(
        Math.trunc(start),
        row
      );
    }
  }

  const liveByStart =
    new Map();

  for (
    const row
    of liveRows
  ) {
    const start =
      Number(
        row.start_lap_count
      );

    if (
      Number.isFinite(start)
    ) {
      liveByStart.set(
        Math.trunc(start),
        row
      );
    }
  }

  const lapRows =
    await loadLapEventsForApex(
      env,
      rid,
      id
    )
      .catch(
        () => []
      );

  const rows = [];

  let start = 0;

  for (
    const {
      lap: end,
      pit
    }
    of boundaries
  ) {
    if (
      end <= start
    ) {
      continue;
    }

    /*
     * Existing good completed statistics remain authoritative
     * when their start/end boundary exactly matches the pit
     * history.
     *
     * If they are missing, raw lap data is used.
     */
    const saved =
      savedCompletedStats(
        completedByStart.get(
          start
        ),
        end
      );

    const stats =
      hasLapCoverageThrough(
        lapRows,
        end
      )
        ? calculateRawStats(
            id,
            lapRows,
            start,
            end,
            exclusions,
            false
          )
        : (
            saved ||
            calculateRawStats(
              id,
              lapRows,
              start,
              end,
              exclusions,
              false
            )
          );

    rows.push({
      race_id:
        rid,

      apex_id:
        id,

      team_name:
        team,

      driver_name:
        pit.driver_name ||
        completedByStart
          .get(start)
          ?.driver_name ||
        null,

      stint_number:
        rows.length +
        1,

      start_lap_count:
        start,

      end_lap_count:
        end,

      current_lap_count:
        end,

      total_laps:
        end -
        start,

      ...stats,

      pit_hour:
        pit.pit_hour ||
        null,

      pit_time:
        pit.pit_time ||
        null,

      on_track:
        pit.on_track ||
        null,

      total_time:
        pit.total_time ||
        null,

      is_live:
        false,

      status:
        "COMPLETED"
    });

    start =
      end;
  }

  const currentLap =
    Number(
      entry?.lap_count
    );

  /*
   * Final/open stint starts only AFTER the final known pit
   * boundary.
   *
   * A stale live_stint_stats row can therefore never create a
   * duplicate old LIVE stint.
   */
  if (
    Number.isFinite(
      currentLap
    ) &&
    currentLap >
      start
  ) {
    const isLive =
      !!sessionIsLive;

    const saved =
      isLive
        ? savedLiveStats(
            liveByStart.get(
              start
            ),
            start
          )
        : savedCompletedStats(
            completedByStart.get(
              start
            ),
            currentLap
          );

    const stats =
      hasLapCoverageThrough(
        lapRows,
        currentLap
      )
        ? calculateRawStats(
            id,
            lapRows,
            start,
            currentLap,
            exclusions,
            isLive
          )
        : (
            saved ||
            calculateRawStats(
              id,
              lapRows,
              start,
              currentLap,
              exclusions,
              isLive
            )
          );

    rows.push({
      race_id:
        rid,

      apex_id:
        id,

      team_name:
        team,

      driver_name:
        entry?.current_driver ||
        liveByStart
          .get(start)
          ?.driver_name ||
        completedByStart
          .get(start)
          ?.driver_name ||
        null,

      stint_number:
        rows.length +
        1,

      start_lap_count:
        start,

      end_lap_count:
        isLive
          ? null
          : currentLap,

      current_lap_count:
        currentLap,

      total_laps:
        currentLap -
        start,

      ...stats,

      is_live:
        isLive,

      status:
        isLive
          ? "LIVE"
          : "COMPLETED"
    });
  }

  /*
   * Historical fallback for races where pit history itself was
   * never captured.
   */
  if (
    !rows.length &&
    completed.length
  ) {
    const sorted =
      [
        ...completed
      ]
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
      const savedRow
      of sorted
    ) {
      const s =
        Number(
          savedRow
            .start_lap_count
        ) ||
        0;

      const e =
        Number(
          savedRow
            .end_lap_count ??
          savedRow
            .current_lap_count
        );

      if (
        !Number.isFinite(e) ||
        e <= s
      ) {
        continue;
      }

      const saved =
        savedCompletedStats(
          savedRow,
          e
        );

      const stats =
        hasLapCoverageThrough(
          lapRows,
          e
        )
          ? calculateRawStats(
              id,
              lapRows,
              s,
              e,
              exclusions,
              false
            )
          : (
              saved ||
              calculateRawStats(
                id,
                lapRows,
                s,
                e,
                exclusions,
                false
              )
            );

      rows.push({
        race_id:
          rid,

        apex_id:
          id,

        team_name:
          team,

        driver_name:
          savedRow.driver_name ||
          null,

        stint_number:
          rows.length +
          1,

        start_lap_count:
          s,

        end_lap_count:
          e,

        current_lap_count:
          e,

        total_laps:
          e -
          s,

        ...stats,

        is_live:
          false,

        status:
          "COMPLETED"
      });
    }
  }

  return rows;
}

async function stintsPayload(
  env,
  rid,
  snapshot = null
) {
  const entriesRaw =
    await loadEntries(
      env,
      rid
    )
      .catch(
        () => []
      );

  const entriesMap =
    newestEntryMap(
      entriesRaw
    );

  const currentRid =
    raceId(env);

  const isCurrentRace =
    Number(rid) ===
    Number(
      currentRid
    );

  const fieldIds =
    isCurrentRace
      ? currentScopeIds(
          entriesRaw,
          snapshot
        )
      : idsFromEntries(
          [
            ...entriesMap
              .values()
          ]
        );

  if (!fieldIds.size) {
    return {
      race_id:
        Number(rid),

      version:
        VERSION,

      session_live:
        false,

      field_count:
        0,

      count:
        0,

      rows:
        []
    };
  }

  /*
   * Scope the expensive tables BEFORE loading them.  race_id=1 may
   * contain old sessions, so current analytics must never pull the
   * entire historical pit/stint universe and filter only afterwards.
   */
  const [
    pitsRaw,
    completedRaw,
    liveRaw,
    exclusionsRaw
  ] =
    await Promise.all([
      loadPits(
        env,
        rid,
        null,
        fieldIds
      )
        .catch(
          () => []
        ),

      loadCompletedStints(
        env,
        rid,
        fieldIds
      ),

      loadLiveStints(
        env,
        rid,
        fieldIds
      ),

      loadExclusions(
        env,
        rid,
        fieldIds
      )
    ]);

  const scopedEntries =
    filterByIds(
      [
        ...entriesMap
          .values()
      ],
      fieldIds
    );

  const pits =
    uniquePits(
      filterByIds(
        pitsRaw,
        fieldIds
      )
    );

  const completed =
    filterByIds(
      completedRaw,
      fieldIds
    );

  const liveRows =
    filterByIds(
      liveRaw,
      fieldIds
    );

  const exclusions =
    exclusionSet(
      filterByIds(
        exclusionsRaw,
        fieldIds
      )
    );

  const teamMap =
    teamNameMapFromRows(
      scopedEntries,
      pits,
      completed,
      liveRows
    );

  const sessionIsLive =
    isCurrentRace &&
    sessionCurrentlyLive(
      snapshot
    );

  const pitsById =
    new Map();

  const completedById =
    new Map();

  const liveById =
    new Map();

  for (
    const row
    of pits
  ) {
    const id =
      String(
        row.apex_id
      );

    if (
      !pitsById.has(
        id
      )
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
    of completed
  ) {
    const id =
      String(
        row.apex_id
      );

    if (
      !completedById.has(
        id
      )
    ) {
      completedById.set(
        id,
        []
      );
    }
        completedById
      .get(id)
      .push(row);
  }

  for (
    const row
    of liveRows
  ) {
    const id =
      String(
        row.apex_id
      );

    if (
      !liveById.has(
        id
      )
    ) {
      liveById.set(
        id,
        []
      );
    }

    liveById
      .get(id)
      .push(row);
  }

  const positionMap =
    snapshot?.positions ||
    {};

  const ids =
    [
      ...fieldIds
    ]
      .filter(
        validApexId
      );

  ids.sort(
    (a, b) => {
      const pa =
        Number(
          positionMap[a]
        );

      const pb =
        Number(
          positionMap[b]
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
        Number(a) -
        Number(b)
      );
    }
  );

  const rows = [];

  /*
   * Process one kart at a time so raw lap pagination stays bounded.
   */
  for (
    const id
    of ids
  ) {
    const teamRows =
      await buildStintsForTeam({
        env,

        rid,

        apexId:
          id,

        entry:
          entriesMap.get(id) ||
          null,

        pits:
          pitsById.get(id) ||
          [],

        completed:
          completedById.get(id) ||
          [],

        liveRows:
          liveById.get(id) ||
          [],

        teamMap,

        exclusions,

        sessionIsLive
      });

    rows.push(
      ...teamRows
    );
  }

  return {
    race_id:
      Number(rid),

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

function weightedAverage(
  a,
  aCount,
  b,
  bCount
) {
  const av =
    Number(a);

  const ac =
    Number(
      aCount
    );

  const bv =
    Number(b);

  const bc =
    Number(
      bCount
    );

  if (
    !Number.isFinite(bv) ||
    !Number.isFinite(bc) ||
    bc <= 0
  ) {
    return Number.isFinite(
      av
    )
      ? av
      : null;
  }

  if (
    !Number.isFinite(av) ||
    !Number.isFinite(ac) ||
    ac <= 0
  ) {
    return bv;
  }

  return (
    av * ac +
    bv * bc
  ) / (
    ac +
    bc
  );
}

function buildDriversFromStints(
  stints
) {
  const map =
    new Map();

  for (
    const stint
    of stints
  ) {
    const driver =
      cleanDriver(
        stint.driver_name
      );

    if (!driver) {
      continue;
    }

    const key =
      `${stint.apex_id}::${driver}`;

    if (
      !map.has(key)
    ) {
      map.set(
        key,
        {
          race_id:
            stint.race_id,

          apex_id:
            String(
              stint.apex_id
            ),

          team_name:
            stint.team_name,

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

          worst_lap_time:
            null,

          worst_lap_number:
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

    const oldValid =
      target.valid_laps;

    const nextValid =
      Number(
        stint.valid_laps
      ) ||
      0;

    target.avg_lap_time =
      weightedAverage(
        target.avg_lap_time,
        oldValid,
        stint.avg_lap_time,
        nextValid
      );

    target.consistency =
      weightedAverage(
        target.consistency,
        oldValid,
        stint.consistency,
        nextValid
      );

    target.valid_laps +=
      nextValid;

    target.total_laps +=
      Number(
        stint.total_laps
      ) ||
      0;

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
        num(
          stint.best_lap_number
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
        num(
          stint.worst_lap_number
        );
    }
  }

  return [
    ...map.values()
  ]
    .sort(
      (a, b) =>
        String(
          a.team_name ||
          ""
        )
          .localeCompare(
            String(
              b.team_name ||
              ""
            )
          ) ||
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

function buildTeamsFromStints(
  stints,
  positions = {}
) {
  const map =
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
            stint.race_id,

          apex_id:
            id,

          position:
            Number.isFinite(
              Number(
                positions[id]
              )
            )
              ? Number(
                  positions[id]
                )
              : null,

          team_name:
            stint.team_name,

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

          worst_lap_time:
            null,

          worst_lap_number:
            null,

          consistency:
            null,

          is_live:
            false,

          drivers:
            new Set()
        }
      );
    }

    const target =
      map.get(id);

    const oldValid =
      target.valid_laps;

    const nextValid =
      Number(
        stint.valid_laps
      ) ||
      0;

    target.avg_lap_time =
      weightedAverage(
        target.avg_lap_time,
        oldValid,
        stint.avg_lap_time,
        nextValid
      );

    target.consistency =
      weightedAverage(
        target.consistency,
        oldValid,
        stint.consistency,
        nextValid
      );

    target.valid_laps +=
      nextValid;

    target.total_laps +=
      Number(
        stint.total_laps
      ) ||
      0;

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

    if (
      stint.driver_name
    ) {
      target.drivers.add(
        stint.driver_name
      );
    }

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
        num(
          stint.best_lap_number
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
        num(
          stint.worst_lap_number
        );
    }
  }

  return [
    ...map.values()
  ]
    .map(
      row => ({
        ...row,

        driver_count:
          row.drivers.size,

        drivers:
          undefined
      })
    )
    .sort(
      (a, b) => {
        if (
          Number.isFinite(
            a.position
          ) &&
          Number.isFinite(
            b.position
          ) &&
          a.position !==
            b.position
        ) {
          return (
            a.position -
            b.position
          );
        }

        if (
          Number.isFinite(
            a.position
          )
        ) {
          return -1;
        }

        if (
          Number.isFinite(
            b.position
          )
        ) {
          return 1;
        }

        return String(
          a.team_name ||
          ""
        )
          .localeCompare(
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
  rid,
  snapshot = null
) {
  const entries =
    await loadEntries(
      env,
      rid
    )
      .catch(
        () => []
      );
    const isCurrent =
    Number(rid) ===
    Number(
      raceId(env)
    );

  const ids =
    isCurrent
      ? currentScopeIds(
          entries,
          snapshot
        )
      : idsFromEntries(
          entries
        );

  if (!ids.size) {
    return {
      race_id:
        Number(rid),

      version:
        VERSION,

      count:
        0,

      rows:
        []
    };
  }

  const scopedEntries =
    filterByIds(
      entries,
      ids
    );

  const raw =
    await loadPits(
      env,
      rid,
      null,
      ids
    )
      .catch(
        () => []
      );

  const teamMap =
    teamNameMapFromRows(
      scopedEntries,
      raw
    );

  const rows =
    uniquePits(
      filterByIds(
        raw,
        ids
      )
    )
      .map(
        row => ({
          ...row,

          apex_id:
            String(
              row.apex_id
            ),

          team_name:
            resolveTeam(
              row.apex_id,
              teamMap,
              row.team_name
            )
        })
      )
      .sort(
        (a, b) =>
          String(
            a.team_name ||
            ""
          )
            .localeCompare(
              String(
                b.team_name ||
                ""
              )
            ) ||
          Number(
            a.pit_number
          ) -
          Number(
            b.pit_number
          )
      );

  return {
    race_id:
      Number(rid),

    version:
      VERSION,

    count:
      rows.length,

    rows
  };
}

async function livePayload(
  env,
  rid
) {
  const snapshot =
    await collectorSnapshot(
      env
    )
      .catch(
        () => null
      );

  const entriesRaw =
    await loadEntries(
      env,
      rid
    )
      .catch(
        () => []
      );

  const isCurrentRace =
    Number(rid) ===
    Number(
      raceId(env)
    );

  const fieldIds =
    isCurrentRace
      ? currentScopeIds(
          entriesRaw,
          snapshot
        )
      : idsFromEntries(
          entriesRaw
        );

  const [
    stintData,
    pitData
  ] =
    await Promise.all([
      stintsPayload(
        env,
        rid,
        snapshot
      ),

      pitsPayload(
        env,
        rid,
        snapshot
      )
    ]);

  const entries =
    newestEntryMap(
      filterByIds(
        entriesRaw,
        fieldIds
      )
    );

  const latestStint =
    new Map();

  let bestLap =
    null;

  for (
    const row
    of stintData.rows
  ) {
    const id =
      String(
        row.apex_id
      );

    if (
      !fieldIds.has(id)
    ) {
      continue;
    }

    const previous =
      latestStint.get(
        id
      );

    if (
      !previous ||
      Number(
        row.stint_number
      ) >
      Number(
        previous.stint_number
      )
    ) {
      latestStint.set(
        id,
        row
      );
    }

    const candidate =
      Number(
        row.best_lap_time
      );

    if (
      Number.isFinite(candidate) &&
      candidate > 0 &&
      (
        bestLap === null ||
        candidate < bestLap
      )
    ) {
      bestLap =
        candidate;
    }
  }

  const pitCountById =
    new Map();

  for (
    const row
    of pitData.rows
  ) {
    const id =
      String(
        row.apex_id
      );

    if (
      !fieldIds.has(id)
    ) {
      continue;
    }

    pitCountById.set(
      id,
      (
        pitCountById.get(
          id
        ) ||
        0
      ) +
      1
    );
  }

  const ids =
    [
      ...fieldIds
    ]
      .filter(
        validApexId
      );

  const current = [];

  let raceLap = 0;

  for (
    const id
    of ids
  ) {
    const entry =
      entries.get(id) ||
      {};

    const stint =
      latestStint.get(id) ||
      {};

    const lapCount =
      Number(
        entry.lap_count
      ) ||
      Number(
        stint.current_lap_count
      ) ||
      Number(
        stint.end_lap_count
      ) ||
      0;

    raceLap =
      Math.max(
        raceLap,
        lapCount
      );

    const position =
      Number(
        snapshot
          ?.positions?.[
            id
          ]
      );

    current.push({
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
        stint.team_name ||
        entry.team_name ||
        null,

      driver_name:
        stint.driver_name ||
        entry.current_driver ||
        null,

      current_driver:
        stint.driver_name ||
        entry.current_driver ||
        null,

      race_lap:
        lapCount,

      live_lap_count:
        lapCount,

      pit_count:
        pitCountById.get(
          id
        ) ||
        0,

      stint_number:
        num(
          stint.stint_number
        ) ||
        (
          (
            pitCountById.get(
              id
            ) ||
            0
          ) +
          1
        ),

      start_lap_count:
        num(
          stint.start_lap_count
        ) ||
        0,

      stint_laps:
        num(
          stint.total_laps
        ) ||
        0,

      total_stint_laps:
        num(
          stint.total_laps
        ) ||
        0,

      valid_laps:
        num(
          stint.valid_laps
        ) ||
        0,

      live_last_lap:
        num(
          entry.last_lap
        ),

      avg_lap_time:
        num(
          stint.avg_lap_time
        ),

      best_lap_time:
        num(
          stint.best_lap_time
        ),

      best_lap_number:
        num(
          stint.best_lap_number
        ),

      worst_lap_time:
        num(
          stint.worst_lap_time
        ),

      worst_lap_number:
        num(
          stint.worst_lap_number
        ),

      consistency:
        num(
          stint.consistency
        ),

      updated_at:
        entry.updated_at ||
        null
    });
  }

  current.sort(
    (a, b) => {
      if (
        Number.isFinite(
          a.position
        ) &&
        Number.isFinite(
          b.position
        ) &&
        a.position !==
        b.position
      ) {
        return (
          a.position -
          b.position
        );
      }

      if (
        Number.isFinite(
          a.position
        )
      ) {
        return -1;
      }

      if (
        Number.isFinite(
          b.position
        )
      ) {
        return 1;
      }

      return (
        b.race_lap -
        a.race_lap
      );
    }
  );

  const isLive =
    isCurrentRace &&
    sessionCurrentlyLive(
      snapshot
    );

  return {
    race_id:
      Number(rid),

    version:
      VERSION,

    generated_at:
      new Date()
        .toISOString(),

    active:
      current.length >
      0,

    data_available:
      current.length >
      0,

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
      raceLap,

    pit_count:
      pitData.count,

    best_lap:
      bestLap,

    current
  };
}

async function eventsPayload(
  env,
  rid,
  snapshot = null
) {
  const entries =
    await loadEntries(
      env,
      rid
    )
      .catch(
        () => []
      );

  const isCurrent =
    Number(rid) ===
    Number(
      raceId(env)
    );

  const ids =
    isCurrent
      ? currentScopeIds(
          entries,
          snapshot
        )
      : idsFromEntries(
          entries
        );

  return filterByIds(
    await loadExclusions(
      env,
      rid,
      ids
    ),
    ids
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

    if (
      !Number.isFinite(id)
    ) {
      continue;
    }

    const timestamp =
      Date.parse(
        row.updated_at ||
        ""
      ) ||
      0;

    if (
      !map.has(id) ||
      timestamp >
      map.get(id)
    ) {
      map.set(
        id,
        timestamp
      );
    }
  }

  return [
    ...map.entries()
  ]
    .map(
      (
        [
          id,
          timestamp
        ]
      ) => ({
        id,

        race_id:
          id,

        label:
          timestamp
            ? (
                `Race ${id} - ` +
                new Date(
                  timestamp
                )
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
                  )
              )
            : `Race ${id}`
      })
    )
    .sort(
      (a, b) =>
        b.race_id -
        a.race_id
    );
}

function csvEscape(value) {
  const text =
    String(
      value ??
      ""
    );

  return /[",\n]/
    .test(
            text
    )
      ? `"${text.replace(
          /"/g,
          '""'
        )}"`
      : text;
}

async function createLapRecordsCsvResponse(
  env,
  rid,
  snapshot = null
) {
  const entries =
    await loadEntries(
      env,
      rid
    )
      .catch(
        () => []
      );

  const isCurrent =
    Number(rid) ===
    Number(
      raceId(env)
    );

  const ids =
    isCurrent
      ? currentScopeIds(
          entries,
          snapshot
        )
      : idsFromEntries(
          entries
        );

  const teamMap =
    teamNameMapFromRows(
      filterByIds(
        entries,
        ids
      )
    );

  const idList =
    [
      ...ids
    ]
      .filter(
        validApexId
      )
      .sort(
        (a, b) =>
          Number(a) -
          Number(b)
      );

  const encoder =
    new TextEncoder();

  /*
   * Streaming CSV:
   * no complete 40k+ lap matrix is kept in Worker memory.
   */
  const stream =
    new ReadableStream({
      async start(
        controller
      ) {
        const write =
          value =>
            controller.enqueue(
              encoder.encode(
                value
              )
            );

        try {
          write(
            "\uFEFF"
          );

          write(
            "Apex Timing - drive your success https://www.apex-timing.com/\r\n\r\n"
          );

          write(
            `Race ${rid} - Lap time records\r\n`
          );

          for (
            const id
            of idList
          ) {
            const team =
              resolveTeam(
                id,
                teamMap
              ) ||
              `APEX ${id}`;

            write(
              `\r\n${csvEscape(id)} - ${csvEscape(team)}\r\n`
            );

            write(
              "Lap,Time\r\n"
            );

            const laps =
              normalizeLapRows(
                await loadLapEventsForApex(
                  env,
                  rid,
                  id
                )
              );

            for (
              const row
              of laps
            ) {
              write(
                `${row.lap_number},${row.lap_time.toFixed(3)}\r\n`
              );
            }
          }

          controller.close();

        } catch (
          error
        ) {
          controller.error(
            error
          );
        }
      }
    });

  return new Response(
    stream,
    {
      status:
        200,

      headers: {
        "content-type":
          "text/csv; charset=utf-8",

        "content-disposition":
          `attachment; filename="Race ${rid} - Lap time records.csv"`,

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
  rid,
  rows
) {
  const grouped =
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
      !grouped.has(
        id
      )
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
            id,
            stints
          ]
        ) => {
          const team =
            stints[0]
              ?.team_name ||
            `APEX ${id}`;

          return `
<section>
  <h2>${escapeHtml(id)} - ${escapeHtml(team)}</h2>
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
${stints
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
      </tr>`
  )
  .join("")}
    </tbody>
  </table>
</section>`;
        }
      )
      .join("");

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Race ${escapeHtml(rid)} - Stints & Pit Stops</title>
<style>
@page {
  size: A4 landscape;
  margin: 10mm;
}

body {
  font-family: Arial, Helvetica, sans-serif;
  color: #111;
  font-size: 9px;
}

h1 {
  font-size: 18px;
}

h2 {
  font-size: 12px;
  margin: 15px 0 5px;
}

section {
  break-inside: avoid;
  margin-bottom: 15px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  border: 1px solid #bbb;
  padding: 3px 4px;
  white-space: nowrap;
}

th {
  background: #eee;
}

button {
  position: fixed;
  top: 10px;
  right: 10px;
  padding: 8px 12px;
}

@media print {
  button {
    display: none;
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

${sections}

</body>
</html>`;
}

async function addManualExclusion(
  env,
  rid,
  request
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
    !validApexId(
      apexId
    ) ||
    !Number.isFinite(
      lap
    ) ||
    lap <= 0
  ) {
    return json(
      {
        error:
          "Valid apex_id and lap_number are required"
      },
      400
    );
  }

  await sbUpsert(
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
    },
    "race_id,apex_id,lap_number"
  );

  return json({
    ok:
      true
  });
}

async function deleteManualExclusion(
  env,
  rid,
  url
) {
  const apexId =
    String(
      url.searchParams.get(
        "apex_id"
      ) ||
      ""
    )
      .trim();

  const lap =
    Number(
      url.searchParams.get(
        "lap_number"
      )
    );

  if (
    !validApexId(
      apexId
    ) ||
    !Number.isFinite(
      lap
    )
  ) {
    return json(
      {
        error:
          "Valid apex_id and lap_number are required"
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

    this.packetQueue =
      Promise.resolve();

    this.lastPacketAt =
      null;

    this.packetCount =
      0;

    this.positions =
      new Map();

    this.columnTypes =
      new Map();

    this.fieldApexIds =
      new Set();

    this.entryCache =
      new Map();

    this.backfillQueue =
      [];

    this.backfillQueued =
      new Set();

    this.backfilledLapCount =
      new Map();

    this.backfillRunning =
      false;

    this.lastBackfillScanAt =
      0;

    state.blockConcurrencyWhile(
      async () => {

        this.lastPacketAt =
          await state.storage.get(
            "lastPacketAt"
          ) ||
          null;

        this.packetCount =
          await state.storage.get(
            "packetCount"
          ) ||
          0;

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
                String
              )
              .filter(
                validApexId
              )
          );

        /*
         * Versioned backfill state:
         * every new Worker version can force one clean full
         * backfill without deleting archived race data.
         */
        const storedVersion =
          await state.storage.get(
            "backfillVersion"
          );

        if (
          storedVersion ===
          VERSION
        ) {
          this.backfilledLapCount =
            new Map(
              Object.entries(
                await state.storage.get(
                  "backfilledLapCount"
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
                .map(
                  (
                    [
                      id,
                      count
                    ]
                  ) => [
                    id,
                    Number(count) ||
                    0
                  ]
                )
            );

        } else {
          /*
           * A new worker version must not inherit a polluted live
           * field from an older race/session that reused race_id=1.
           * Database history is kept; only Durable Object live scope
           * and backfill progress are reset.
           */
          this.backfilledLapCount =
            new Map();

          this.fieldApexIds =
            new Set();

          this.positions =
            new Map();

          await state.storage.put({
            backfillVersion:
              VERSION,

            backfilledLapCount:
              {},

            fieldApexIds:
              [],

            positions:
              {}
          });
        }

        if (
          !this.fieldApexIds.size &&
          this.positions.size
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
            1000
          );
        }
      }
    );
  }

  async persistState() {
    await this.state.storage.put({
      lastPacketAt:
        this.lastPacketAt,

      packetCount:
        this.packetCount,

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

      fieldApexIds:
        [
          ...this.fieldApexIds
        ]
          .filter(
            validApexId
          ),

      backfillVersion:
        VERSION,

      backfilledLapCount:
        Object.fromEntries(
          this.backfilledLapCount
        )
    });
  }

  snapshot() {
    return {
      version:
        VERSION,

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

      backfill_pending:
        this.backfillQueue
          .length,

      backfill_completed:
        this.backfilledLapCount
          .size,

      backfill_running:
        this.backfillRunning
    };
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
      await this.ensureStarted();

      await this.scanAndQueueBackfill();

      return json(
        this.snapshot()
      );
    }

    if (
      path ===
        "/snapshot" ||
      path ===
        "/status"
    ) {
      return json(
        this.snapshot()
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

      await this.scanAndQueueBackfill(
        true
      );

      return json(
        this.snapshot()
      );
    }

    if (
      path ===
      "/backfill"
    ) {
      await this.scanAndQueueBackfill(
        true
      );

      await this.state.storage.setAlarm(
        Date.now() +
        100
      );

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

  async alarm() {
    try {
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

        await this.connect()
          .catch(
            () => {}
          );
      }

      await this.scanAndQueueBackfill();

      await this.processBackfillBatch();

      await this.persistState();

    } finally {
      const delay =
        this.backfillQueue.length
          ? 1000
          : 60000;

      await this.state.storage.setAlarm(
        Date.now() +
        delay
      );
    }
  }

  async ensureStarted() {
    if (
      !this.fieldApexIds.size
    ) {
      await this.restoreFieldFromDatabase();
    }

    if (
      !this.ws ||
      this.ws.readyState !==
        WebSocket.OPEN
    ) {
      await this.connect()
        .catch(
          () => {}
        );
    }
  }

  async restoreFieldFromDatabase() {
    const entries =
      await loadEntries(
        this.env,
        this.rid
      )
        .catch(
          () => []
        );

    const ids =
      recentEntryIds(
        entries
      );

    if (
      ids.size
    ) {
      this.fieldApexIds =
        ids;

      await this.persistState();
    }
  }

  async connect() {
    if (
      this.connecting ||
      (
        this.ws &&
        [
          WebSocket.OPEN,
          WebSocket.CONNECTING
        ]
          .includes(
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

          this.packetQueue =
            this.packetQueue
              .then(
                () =>
                  this.handlePacket(
                    payload
                  )
              )
              .catch(
                error =>
                  console.error(
                    "APEX PACKET ERROR",
                    error
                  )
              );
        }
      );

      const closed =
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
        closed
      );

      ws.addEventListener(
        "error",
        closed
      );

    } catch (
      error
    ) {
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
    async getEntry(id) {
    const key =
      String(id);

    if (
      this.entryCache.has(
        key
      )
    ) {
      return this.entryCache.get(
        key
      );
    }

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
            `eq.${key}`,

          limit:
            "1"
        }
      )
        .catch(
          () => []
        );

    const entry =
      rows[0] ||
      {
        race_id:
          this.rid,

        apex_id:
          key
      };

    this.entryCache.set(
      key,
      entry
    );

    return entry;
  }

  async upsertEntry(
    id,
    patch
  ) {
    const key =
      String(id);

    const previous =
      await this.getEntry(
        key
      );

    const next = {
      race_id:
        this.rid,

      apex_id:
        key,

      team_name:
        patch.team_name !==
        undefined
          ? patch.team_name
          : previous.team_name ??
            null,

      current_driver:
        patch.current_driver !==
        undefined
          ? patch.current_driver
          : previous.current_driver ??
            null,

      last_lap:
        patch.last_lap !==
        undefined
          ? patch.last_lap
          : previous.last_lap ??
            null,

      best_lap:
        patch.best_lap !==
        undefined
          ? patch.best_lap
          : previous.best_lap ??
            null,

      lap_count:
        patch.lap_count !==
        undefined
          ? patch.lap_count
          : previous.lap_count ??
            null,

      updated_at:
        new Date()
          .toISOString()
    };

    this.entryCache.set(
      key,
      next
    );

    await sbUpsert(
      this.env,
      "apex_entries",
      next,
      "race_id,apex_id"
    );

    return next;
  }

  patchFromField(
    type,
    value,
    column = null
  ) {
    const t =
      String(
        type ||
        ""
      )
        .toLowerCase();

    if (
      [
        "drteam",
        "driver",
        "drivername",
        "current_driver"
      ]
        .includes(t)
    ) {
      const driver =
        cleanDriver(
          value
        );

      return driver
        ? {
            current_driver:
              driver
          }
        : null;
    }

    if (
      [
        "dr",
        "team",
        "teamname"
      ]
        .includes(t)
    ) {
      const team =
        stripHtml(
          value
        );

      return team
        ? {
            team_name:
              team
          }
        : null;
    }

    if (
      [
        "laps",
        "tlp",
        "lapcount",
        "lap_count"
      ]
        .includes(t) ||
      (
        t === "in" &&
        column === "13"
      )
    ) {
      const lap =
        parseNumber(
          value
        );

      return (
        lap !== null &&
        lap >= 0
      )
        ? {
            lap_count:
              Math.trunc(
                lap
              )
          }
        : null;
    }

    if (
      [
        "last",
        "llp",
        "lastlap",
        "last_lap"
      ]
        .includes(t)
    ) {
      const lap =
        parseLapTime(
          value
        );

      return lap !==
        null
        ? {
            last_lap:
              lap
          }
        : null;
    }

    if (
      [
        "best",
        "blp",
        "bestlap",
        "best_lap"
      ]
        .includes(t)
    ) {
      const lap =
        parseLapTime(
          value
        );

      return lap !==
        null
        ? {
            best_lap:
              lap
          }
        : null;
    }

    return null;
  }

  async applyGrid(grid) {
    if (
      grid.columnTypes.size
    ) {
      this.columnTypes =
        grid.columnTypes;
    }

    if (
      !grid.rows.size
    ) {
      return;
    }

    /*
     * The currently visible Apex grid defines the live field.
     * Old IDs are replaced, not merged.
     */
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

      const patch = {};

      for (
        const [
          type,
          value
        ]
        of Object.entries(
          fields
        )
      ) {
        const partial =
          this.patchFromField(
            type,
            value,
            null
          );

        if (partial) {
          Object.assign(
            patch,
            partial
          );
        }
      }

      if (
        Object.keys(
          patch
        ).length
      ) {
        await this.upsertEntry(
          id,
          patch
        );
      }
    }

    await this.persistState();

    /*
     * Grid alone is enough to trigger full race backfill.
     * We do not wait for another new lap.
     */
    await this.scanAndQueueBackfill(
      true
    );
  }
    async applyProtocolUpdate(parsed) {
    const row =
      parseRowId(
        parsed.id
      );

    if (
      !row ||
      !validApexId(
        row.apexId
      )
    ) {
      return;
    }

    const id =
      String(
        row.apexId
      );

    /*
     * Every valid row update coming from the live Apex websocket is
     * evidence that the kart belongs to the current field.  Do not
     * reject a new current kart just because a restored field already
     * contains some IDs.
     */
    this.fieldApexIds.add(
      id
    );

    const type =
      row.column
        ? (
            this.columnTypes.get(
              `c${row.column}`
            ) ||
            parsed.cls
          )
        : parsed.cls;

    const normalizedType =
      String(
        type ||
        ""
      )
        .toLowerCase();

    if (
      [
        "rk",
        "rank",
        "pos",
        "position"
      ]
        .includes(
          normalizedType
        )
    ) {
      const position =
        parseNumber(
          parsed.value
        );

      if (
        position !==
          null &&
        position >
          0
      ) {
        this.positions.set(
          id,
          Math.trunc(
            position
          )
        );
      }

      return;
    }

    const patch =
      this.patchFromField(
        type,
        parsed.value,
        row.column
      );

    if (!patch) {
      return;
    }

    const previous =
      await this.getEntry(
        id
      );

    const previousLap =
      Number(
        previous
          ?.lap_count
      ) ||
      0;

    const next =
      await this.upsertEntry(
        id,
        patch
      );

    const nextLap =
      Number(
        next
          ?.lap_count
      ) ||
      0;

    /*
     * Live incremental update:
     * queue a detail refresh for this kart.
     */
    if (
      nextLap >
      previousLap
    ) {
      this.enqueueBackfill(
        id
      );

      await this.state.storage.setAlarm(
        Date.now() +
        100
      );
    }
  }

  async handlePacket(payload) {
    this.packetCount +=
      1;

    this.lastPacketAt =
      new Date()
        .toISOString();

    const text =
      String(
        payload ||
        ""
      );

    /*
     * Support complete HTML grid payloads.
     */
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
        grid.rows.size
      ) {
        await this.applyGrid(
          grid
        );
      }
    }

    /*
     * Support normal Apex protocol update lines.
     */
    for (
      const rawLine
      of text.split(
        /\r?\n/
      )
    ) {
      const line =
        rawLine.trim();

      if (!line) {
        continue;
      }

      const parsed =
        parseProtocolLine(
          line
        );

      if (
        parsed.id ===
        "grid"
      ) {
        const grid =
          parseGridData(
            parsed.value
          );

        if (
          grid.rows.size
        ) {
          await this.applyGrid(
            grid
          );
        }

        continue;
      }

      await this.applyProtocolUpdate(
        parsed
      );
    }

    if (
      this.packetCount %
        20 ===
      0
    ) {
      await this.persistState();
    }
  }

  enqueueBackfill(id) {
    const key =
      String(id);

    if (
      !validApexId(key) ||
      this.backfillQueued.has(
        key
      )
    ) {
      return;
    }

    this.backfillQueued.add(
      key
    );

    this.backfillQueue.push(
      key
    );
  }

  async scanAndQueueBackfill(
    force = false
  ) {
    const now =
      Date.now();

    if (
      !force &&
      now -
        this.lastBackfillScanAt <
        30000
    ) {
      return;
    }

    this.lastBackfillScanAt =
      now;

    if (
      !this.fieldApexIds.size
    ) {
      await this.restoreFieldFromDatabase();
    }

    if (this.fieldApexIds.size) {
      this.backfillQueue =
        this.backfillQueue.filter(
          id =>
            this.fieldApexIds.has(
              String(id)
            )
        );

      this.backfillQueued =
        new Set(
          this.backfillQueue
        );
    }

    const entries =
      newestEntryMap(
        await loadEntries(
          this.env,
          this.rid
        )
          .catch(
            () => []
          )
      );

    for (
      const id
      of this.fieldApexIds
    ) {
      const entry =
        entries.get(
          String(id)
        );

      const currentLap =
        Number(
          entry
            ?.lap_count
        ) ||
        0;

      const backfilledLap =
        Number(
          this.backfilledLapCount.get(
            String(id)
          )
        ) ||
        0;

      /*
       * Full refresh:
       * - new Worker version
       * - no previous successful backfill
       * - race progressed since last backfill
       */
      if (
        force ||
        currentLap >
          backfilledLap ||
        backfilledLap ===
          0
      ) {
        this.enqueueBackfill(
          id
        );
      }
    }

    if (
      this.backfillQueue.length
    ) {
      await this.state.storage.setAlarm(
        Date.now() +
        100
      );
    }
  }

  async processBackfillBatch() {
    if (
      this.backfillRunning ||
      !this.backfillQueue.length
    ) {
      return;
    }

    this.backfillRunning =
      true;

    try {
      /*
       * Two teams per alarm.
       * Full 72-team history is therefore fetched gradually
       * instead of hammering Apex / Cloudflare in one request.
       */
      for (
        let i = 0;
        i <
          BACKFILL_BATCH &&
        this.backfillQueue.length;
        i++
      ) {
        const id =
          this.backfillQueue.shift();

        this.backfillQueued.delete(
          id
        );

        try {
          const lapCount =
            await this.backfillOne(
              id
            );

          if (
            lapCount >
            0
          ) {
            this.backfilledLapCount.set(
              String(id),
              lapCount
            );
          }

        } catch (
          error
        ) {
          console.error(
            `BACKFILL ${id} ERROR`,
            error
          );

          /*
           * Do not lose the team.
           * Retry on a later alarm.
           */
          this.enqueueBackfill(
            id
          );
        }
      }

    } finally {
      this.backfillRunning =
        false;
    }
  }

  async backfillOne(id) {
    const entry =
      await this.getEntry(
        id
      );

    const lapCount =
      Number(
        entry
          ?.lap_count
      ) ||
      0;

    if (
      lapCount <= 0
    ) {
      return 0;
    }

    /*
     * Request the ENTIRE lap and pit history for this kart,
     * not only the newest lap.
     */
    const requestText =
      `D#-${lapCount}` +
      `#D${id}.L#-${lapCount}` +
      `#D${id}.P#-999` +
      `#D${id}.B#1` +
      `#D${id}.INF`;

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
                requestText
            })
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `Apex detail ${id}: ${response.status}`
      );
    }

    const raw =
      await response.text();

    if (!raw) {
      throw new Error(
        `Apex detail ${id}: empty response`
      );
    }

    const lapRows =
      parseLapRows(
        raw,
        this.rid
      )
        .filter(
          row =>
            String(
              row.apex_id
            ) ===
            String(id)
        );

    const pitRows =
      parsePitRows(
        raw,
        entry
          ?.team_name ||
        null,
        this.rid
      )
        .filter(
          row =>
            String(
              row.apex_id
            ) ===
            String(id)
        );

    /*
     * RAW laps are never analytically filtered before storage.
     * Current detail data overwrites laps 1..lapCount.  Anything above
     * the current lap can only be stale data from an older session that
     * reused the same race_id/apex_id and must not leak into reports.
     */
    await sbDelete(
      this.env,
      "apex_lap_events",
      {
        race_id:
          `eq.${this.rid}`,

        apex_id:
          `eq.${id}`,

        lap_number:
          `gt.${lapCount}`
      }
    );

    if (
      lapRows.length
    ) {
      await sbUpsert(
        this.env,
        "apex_lap_events",
        lapRows,
        "race_id,apex_id,lap_number"
      );
    }

    /*
     * The detail response contains the full current pit history.  Remove
     * stale pit numbers left behind by an older session before keeping
     * the authoritative current chain.
     */
    const currentPitMax =
      pitRows.reduce(
        (max, row) =>
          Math.max(
            max,
            Number(
              row.pit_number
            ) ||
            0
          ),
        0
      );

    if (currentPitMax > 0) {
      await sbDelete(
        this.env,
        "apex_pit_stints",
        {
          race_id:
            `eq.${this.rid}`,

          apex_id:
            `eq.${id}`,

          pit_number:
            `gt.${currentPitMax}`
        }
      );
    } else {
      await sbDelete(
        this.env,
        "apex_pit_stints",
        {
          race_id:
            `eq.${this.rid}`,

          apex_id:
            `eq.${id}`
        }
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

    return lapCount;
  }
}
async function handleApi(
  request,
  env,
  url
) {
  const rid =
    raceId(
      env,
      url
    );

  const path =
    url.pathname;

  if (
    path ===
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
    path ===
    "/api/health"
  ) {
    const snapshot =
      await collectorSnapshot(
        env
      )
        .catch(
          () => null
        );

    const healthEntries =
      await loadEntries(
        env,
        rid
      )
        .catch(
          () => []
        );

    const healthFieldIds =
      Number(rid) ===
      Number(
        raceId(env)
      )
        ? currentScopeIds(
            healthEntries,
            snapshot
          )
        : idsFromEntries(
            healthEntries
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
        healthFieldIds.size,

      backfill_pending:
        snapshot
          ?.backfill_pending ??
        null,

      backfill_completed:
        snapshot
          ?.backfill_completed ??
        null,

      now:
        new Date()
          .toISOString()
    });
  }

  if (
    path ===
    "/api/collector/start"
  ) {
    return json(
      await startCollector(
        env
      )
    );
  }

  if (
    path ===
      "/api/collector/status" ||
    path ===
      "/api/collector/snapshot"
  ) {
    return json(
      await collectorSnapshot(
        env
      )
    );
  }

  if (
    path ===
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

  /*
   * Manual full-race backfill endpoint.
   *
   * Useful immediately after deploying this version:
   *
   * /api/collector/backfill
   */
  if (
    path ===
    "/api/collector/backfill"
  ) {
    const response =
      await collectorStub(
        env
      )
        .fetch(
          "https://collector/backfill"
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

  if (
    path ===
    "/api/races"
  ) {
    const rows =
      await racesPayload(
        env
      );

    return json({
      current_race_id:
        raceId(env),

      version:
        VERSION,

      count:
        rows.length,

      rows
    });
  }

  if (
    path ===
    "/api/live"
  ) {
    return json(
      await livePayload(
        env,
        rid
      )
    );
  }

  if (
    path ===
    "/api/overview"
  ) {
    const payload =
      await livePayload(
        env,
        rid
      );

    return json({
      ...payload,

      rows:
        payload.current
    });
  }

  const snapshot =
    await collectorSnapshot(
      env
    )
      .catch(
        () => null
      );

  if (
    path ===
    "/api/stints"
  ) {
    return json(
      await stintsPayload(
        env,
        rid,
        snapshot
      )
    );
  }

  if (
    path ===
    "/api/drivers"
  ) {
    const stints =
      await stintsPayload(
        env,
        rid,
        snapshot
      );

    const rows =
      buildDriversFromStints(
        stints.rows
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
    path ===
    "/api/teams"
  ) {
    const stints =
      await stintsPayload(
        env,
        rid,
        snapshot
      );

    const rows =
      buildTeamsFromStints(
        stints.rows,
        snapshot?.positions ||
        {}
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
    path ===
    "/api/pits"
  ) {
    return json(
      await pitsPayload(
        env,
        rid,
        snapshot
      )
    );
  }

  if (
    path ===
      "/api/events" &&
    request.method ===
      "GET"
  ) {
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
    path ===
      "/api/events" &&
    request.method ===
      "POST"
  ) {
    return addManualExclusion(
      env,
      rid,
      request
    );
  }

  if (
    path ===
      "/api/events" &&
    request.method ===
      "DELETE"
  ) {
    return deleteManualExclusion(
      env,
      rid,
      url
    );
  }

  if (
    path ===
      "/api/reports/lap-time-records.csv" ||
    path ===
      "/api/reports/lap-records.csv"
  ) {
    return createLapRecordsCsvResponse(
      env,
      rid,
      snapshot
    );
  }

  if (
    path ===
      "/api/reports/pit-stops.html" ||
    path ===
      "/api/reports/pit-stops"
  ) {
    const stints =
      await stintsPayload(
        env,
        rid,
        snapshot
      );

    return new Response(
      buildPitReportHtml(
        rid,
        stints.rows
      ),
      {
        status:
          200,

        headers: {
          "content-type":
            "text/html; charset=utf-8",

          "cache-control":
            "no-store"
        }
      }
    );
  }

  return json(
    {
      error:
        "API endpoint not found",

      path,

      version:
        VERSION
    },
    404
  );
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

    /*
     * Normal application traffic keeps the collector started.
     * It does not block rendering while backfill runs.
     */
    if (
      env.APEX_COLLECTOR
    ) {
      ctx.waitUntil(
        startCollector(
          env
        )
          .catch(
            error =>
              console.error(
                "COLLECTOR START ERROR",
                error
              )
          )
      );
    }

    if (
      url.pathname.startsWith(
        "/api/"
      )
    ) {
      try {
        return await handleApi(
          request,
          env,
          url
        );

      } catch (
        error
      ) {
        console.error(
          "WORKER ERROR",
          error
        );

        return json(
          {
            error:
              error
                ?.message ||
              String(
                error
              ),

            version:
              VERSION
          },
          500
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
        headers: {
          "content-type":
            "text/plain; charset=utf-8"
        }
      }
    );
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
          error =>
            console.error(
              "SCHEDULED COLLECTOR ERROR",
              error
            )
        )
    );
  }
};
