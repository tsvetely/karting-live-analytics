const VERSION = "2026-08-30-race-datasets-v6.3-stable-rebuild";
const PAGE_SIZE = 1000;

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

  const headers = sbHeaders(env, {
    accept: "application/json"
  });

  if (range) {
    headers.Range = `${range.from}-${range.to}`;
    headers["Range-Unit"] = "items";
  }

  const response = await fetch(url, {
    headers
  });

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
    const rows = await sbGet(
      env,
      table,
      params,
      {
        from,
        to: from + PAGE_SIZE - 1
      }
    );

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

const sbInsert = (env, table, body) =>
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

    return Number.isFinite(m) &&
      Number.isFinite(s)
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

function parseApexLine(line) {
  const m = String(
    line || ""
  ).match(
    /^r(\d+)(?:c(\d+))?\|([^|]+)\|(.*)$/
  );

  return m
    ? {
        apexId: m[1],
        column: m[2] || null,
        field: m[3],
        value: m[4] || ""
      }
    : null;
}

function parseProtocolLine(line) {
  const parts = String(
    line || ""
  ).split("|");

  return {
    id: parts[0] || "",
    cls: parts[1] || "",
    value: parts
      .slice(2)
      .join("|")
  };
}

function parseRowId(id) {
  const m =
    /^r(\d+)(?:c(\d+))?$/
      .exec(id);

  return m
    ? {
        apexId: m[1],
        column: m[2] || null
      }
    : null;
}

function parseGridData(html) {
  const source = String(
    html || ""
  );

  const columnTypes =
    new Map();

  const positions =
    new Map();

  const rows =
    new Map();

  let m;

  const headerRegex =
    /<td\b([^>]*)>/gi;

  while (
    (m = headerRegex.exec(source)) !==
    null
  ) {
    const id =
      /data-id=["'](c\d+)["']/i
        .exec(m[1]);

    const type =
      /data-type=["']([^"']+)["']/i
        .exec(m[1]);

    if (id && type) {
      columnTypes.set(
        id[1],
        type[1]
      );
    }
  }

  const rowRegex =
    /<tr\b([^>]*)data-id=["']r(\d+)["']([^>]*)>([\s\S]*?)<\/tr>/gi;

  while (
    (m = rowRegex.exec(source)) !==
    null
  ) {
    const apexId =
      String(m[2]);

    if (!validApexId(apexId)) {
      continue;
    }

    const attrs =
      `${m[1]} ${m[3]}`;

    const positionMatch =
      /data-pos=["'](\d+)["']/i
        .exec(attrs);

    if (positionMatch) {
      positions.set(
        apexId,
        Number(positionMatch[1])
      );
    }

    const fields = {};

    let c;

    const cellRegex =
      /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;

    while (
      (c = cellRegex.exec(m[4])) !==
      null
    ) {
      const id =
        /data-id=["']r\d+c(\d+)["']/i
          .exec(c[1]);

      if (!id) {
        continue;
      }

      const explicitType =
        /data-type=["']([^"']+)["']/i
          .exec(c[1]);

      const type =
        explicitType?.[1] ||
        columnTypes.get(
          `c${id[1]}`
        );

      if (type) {
        fields[type] =
          stripHtml(c[2]);
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

  if (!Number.isFinite(value)) {
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
      (total % 3600) / 60
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
  const value = Number(ms);

  if (!Number.isFinite(value)) {
    return null;
  }

  const minutes =
    Math.floor(
      value / 60000
    );

  const seconds =
    Math.floor(
      (value % 60000) /
      1000
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
  const map = new Map();

  const re =
    /<driver\s+[^>]*id="(\d+)"[^>]*name="([^"]+)"/g;

  let m;

  while (
    (m = re.exec(
      String(raw || "")
    )) !== null
  ) {
    map.set(
      Number(m[1]),
      m[2]
    );
  }

  return map;
}

function parseLapRows(
  raw,
  rid
) {
  const rows = [];

  for (
    const line of String(
      raw || ""
    ).split("\n")
  ) {
    const m =
      /^D(\d+)\.L0*(\d+)#(.+)$/
        .exec(line.trim());

    if (!m) {
      continue;
    }

    const p =
      m[3].split("|");

    const ms =
      Number(p[3]);

    if (
      !Number.isFinite(ms) ||
      ms <= 0
    ) {
      continue;
    }

    rows.push({
      race_id: rid,
      apex_id: String(m[1]),
      lap_number: Number(m[2]),
      lap_time: Number(
        (ms / 1000)
          .toFixed(3)
      ),
      received_at:
        new Date()
          .toISOString()
    });
  }

  return rows;
}

function parsePits(
  raw,
  team,
  rid
) {
  const drivers =
    parseDrivers(raw);

  const rows = [];

  for (
    const line of String(
      raw || ""
    ).split("\n")
  ) {
    const m =
      /^D(\d+)\.P\d+#(.+)$/
        .exec(line.trim());

    if (!m) {
      continue;
    }

    const p =
      m[2].split("|");

    const pitNumber =
      Number(p[0]);

    const pitLap =
      Number(p[1]);

    if (
      !Number.isFinite(pitNumber) ||
      !Number.isFinite(pitLap)
    ) {
      continue;
    }

    rows.push({
      race_id: rid,
      apex_id: String(m[1]),
      team_name: team || null,
      pit_number: pitNumber,
      pit_lap: pitLap,
      pit_hour: msToTime(p[2]),
      pit_time: msToPitTime(p[4]),
      on_track: msToTime(p[5]),
      driver_name:
        drivers.get(
          Number(p[7])
        ) || null,
      total_time: msToTime(p[8]),
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
      select: "*",
      race_id: `eq.${rid}`,
      order: "updated_at.desc"
    }
  );
}

function loadPits(
  env,
  rid,
  apexId = null
) {
  const params = {
    select: "*",
    race_id: `eq.${rid}`,
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
      select: "*",
      race_id: `eq.${rid}`,
      order:
        "apex_id.asc,start_lap_count.asc"
    }
  ).catch(() => []);
}

function loadLiveStints(
  env,
  rid
) {
  return sbGetAll(
    env,
    "live_stint_stats",
    {
      select: "*",
      race_id: `eq.${rid}`,
      order:
        "apex_id.asc,start_lap_count.asc"
    }
  ).catch(() => []);
}

function loadExclusions(
  env,
  rid
) {
  return sbGetAll(
    env,
    "manual_lap_exclusions",
    {
      select: "*",
      race_id: `eq.${rid}`,
      order:
        "apex_id.asc,lap_number.asc"
    }
  ).catch(() => []);
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
      race_id: `eq.${rid}`,
      apex_id: `eq.${apexId}`,
      order: "lap_number.asc"
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
      ).catch(() => []),

      loadPits(
        env,
        rid
      ).catch(() => []),

      loadCompletedStints(
        env,
        rid
      ),

      loadLiveStints(
        env,
        rid
      )
    ]);

  const map =
    new Map();

  for (
    const row of [
      ...entries,
      ...pits,
      ...completed,
      ...live
    ]
  ) {
    const id =
      String(
        row.apex_id ?? ""
      );

    if (!validApexId(id)) {
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
      !map.has(id)
    ) {
      map.set(
        id,
        team
      );
    }
  }

  return map;
}

function resolveTeam(
  apexId,
  teamMap,
  ...candidates
) {
  const stable =
    teamMap.get(
      String(apexId)
    );

  if (stable) {
    return stable;
  }

  for (
    const value of candidates
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
  return env.APEX_COLLECTOR.get(
    env.APEX_COLLECTOR
      .idFromName("primary")
  );
}

async function collectorSnapshot(
  env
) {
  const response =
    await collectorStub(env)
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
    await collectorStub(env)
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
      snapshot?.last_packet_at ||
      ""
    );

  return (
    Number.isFinite(lastPacket) &&
    Date.now() - lastPacket <
      180000
  );
}

function currentFieldIds(
  snapshot
) {
  const result =
    new Set();

  for (
    const id of
      snapshot?.fieldApexIds ||
      []
  ) {
    if (validApexId(id)) {
      result.add(
        String(id)
      );
    }
  }

  if (
    !result.size &&
    snapshot?.positions
  ) {
    for (
      const id of Object.keys(
        snapshot.positions
      )
    ) {
      if (validApexId(id)) {
        result.add(
          String(id)
        );
      }
    }
  }

  return result;
}

function idsFromEntries(entries) {
  return new Set(
    entries
      .map(
        row =>
          String(
            row.apex_id ?? ""
          )
      )
      .filter(validApexId)
  );
}

function filterByIds(
  rows,
  ids
) {
  if (!ids?.size) {
    return [];
  }

  return rows.filter(
    row =>
      ids.has(
        String(
          row.apex_id ?? ""
        )
      ) &&
      validApexId(
        row.apex_id
      )
  );
}

function newestEntryMap(entries) {
  const map =
    new Map();

  for (
    const row of entries
  ) {
    const id =
      String(
        row.apex_id ?? ""
      );

    if (!validApexId(id)) {
      continue;
    }

    const previous =
      map.get(id);

    if (
      !previous ||
      Date.parse(
        row.updated_at || ""
      ) >
        Date.parse(
          previous.updated_at ||
          ""
        )
    ) {
      map.set(
        id,
        row
      );
    }
  }

  return map;
}

function uniquePits(rows) {
  const map =
    new Map();

  for (
    const row of rows
  ) {
    const id =
      String(
        row.apex_id ?? ""
      );

    const pitNo =
      Number(
        row.pit_number
      );

    if (
      !validApexId(id) ||
      !Number.isFinite(pitNo)
    ) {
      continue;
    }

    const key =
      `${id}:${Math.trunc(
        pitNo
      )}`;

    const previous =
      map.get(key);

    if (
      !previous ||
      Date.parse(
        row.updated_at || ""
      ) >=
        Date.parse(
          previous.updated_at ||
          ""
        )
    ) {
      map.set(
        key,
        row
      );
    }
  }

  return [
    ...map.values()
  ];
}

function exclusionSet(rows) {
  const set =
    new Set();

  for (
    const row of rows
  ) {
    const id =
      String(
        row.apex_id ?? ""
      );

    const lap =
      Number(
        row.lap_number
      );

    if (
      validApexId(id) &&
      Number.isFinite(lap)
    ) {
      set.add(
        `${id}:${Math.trunc(lap)}`
      );
    }
  }

  return set;
}

function calculateStats(
  apexId,
  lapRows,
  startLap,
  endLap,
  exclusions
) {
  const start =
    Number(startLap) || 0;

  const end =
    Number(endLap);

  if (
    !Number.isFinite(end) ||
    end <= start
  ) {
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

  const transitionLap =
    start > 0
      ? start + 1
      : null;

  const valid = [];
  const seen = new Set();
    for (
    const row of lapRows
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

    const n =
      Math.trunc(lap);

    if (
      n <= start ||
      n > end
    ) {
      continue;
    }

    if (
      transitionLap !== null &&
      n === transitionLap
    ) {
      continue;
    }

    if (
      exclusions.has(
        `${apexId}:${n}`
      )
    ) {
      continue;
    }

    if (seen.has(n)) {
      continue;
    }

    seen.add(n);

    valid.push({
      lap_number: n,
      lap_time: time
    });
  }

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

  let sum = 0;

  let best =
    valid[0];

  let worst =
    valid[0];

  for (
    const row of valid
  ) {
    sum += row.lap_time;

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
    sum / valid.length;

  let variance = 0;

  for (
    const row of valid
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

async function buildStintsForTeam(
  env,
  rid,
  apexId,
  entry,
  pits,
  completed,
  teamMap,
  exclusions,
  isLive
) {
  const id =
    String(apexId);

  const team =
    resolveTeam(
      id,
      teamMap,
      entry?.team_name,
      pits[0]?.team_name,
      completed[0]?.team_name
    );

  const sortedPits =
    [...pits]
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
    const pit of sortedPits
  ) {
    const lap =
      Math.trunc(
        Number(
          pit.pit_lap
        )
      );

    if (
      !seenBoundary.has(lap)
    ) {
      seenBoundary.add(lap);

      boundaries.push({
        lap,
        pit
      });
    }
  }

  const completedByStart =
    new Map();

  for (
    const row of completed
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

  const lapRows =
    await loadLapEventsForApex(
      env,
      rid,
      id
    ).catch(() => []);

  const rows = [];

  let start = 0;

  for (
    let i = 0;
    i < boundaries.length;
    i++
  ) {
    const {
      lap: end,
      pit
    } =
      boundaries[i];

    if (end <= start) {
      continue;
    }

    const saved =
      completedByStart.get(
        start
      );

    const stats =
      calculateStats(
        id,
        lapRows,
        start,
        end,
        exclusions
      );

    rows.push({
      race_id: rid,
      apex_id: id,
      team_name: team,

      driver_name:
        pit.driver_name ||
        saved?.driver_name ||
        null,

      stint_number:
        rows.length + 1,

      start_lap_count:
        start,

      end_lap_count:
        end,

      current_lap_count:
        end,

      total_laps:
        end - start,

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

      is_live: false,
      status: "COMPLETED"
    });

    start = end;
  }

  const currentLap =
    Number(
      entry?.lap_count
    );

  if (
    Number.isFinite(
      currentLap
    ) &&
    currentLap > start
  ) {
    const stats =
      calculateStats(
        id,
        lapRows,
        start,
        currentLap,
        exclusions
      );

    rows.push({
      race_id: rid,
      apex_id: id,
      team_name: team,

      driver_name:
        entry?.current_driver ||
        null,

      stint_number:
        rows.length + 1,

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

  if (
    !rows.length &&
    completed.length
  ) {
    for (
      const saved of
        [...completed]
          .sort(
            (a, b) =>
              Number(
                a.start_lap_count
              ) -
              Number(
                b.start_lap_count
              )
          )
    ) {
      const s =
        Number(
          saved.start_lap_count
        ) || 0;

      const e =
        Number(
          saved.end_lap_count ??
          saved.current_lap_count
        );

      if (
        !Number.isFinite(e) ||
        e <= s
      ) {
        continue;
      }

      const stats =
        calculateStats(
          id,
          lapRows,
          s,
          e,
          exclusions
        );

      rows.push({
        race_id: rid,
        apex_id: id,
        team_name: team,

        driver_name:
          saved.driver_name ||
          null,

        stint_number:
          rows.length + 1,

        start_lap_count:
          s,

        end_lap_count:
          e,

        current_lap_count:
          e,

        total_laps:
          e - s,

        ...stats,

        is_live: false,
        status: "COMPLETED"
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
  const [
    entriesRaw,
    pitsRaw,
    completedRaw,
    exclusionsRaw,
    teamMap
  ] =
    await Promise.all([
      loadEntries(
        env,
        rid
      ).catch(() => []),

      loadPits(
        env,
        rid
      ).catch(() => []),

      loadCompletedStints(
        env,
        rid
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

  const entriesMap =
    newestEntryMap(
      entriesRaw
    );

  const currentRid =
    raceId(env);

  const isCurrentRace =
    Number(rid) ===
    Number(currentRid);

  const snapshotIds =
    isCurrentRace
      ? currentFieldIds(
          snapshot
        )
      : new Set();

  const fieldIds =
    snapshotIds.size
      ? snapshotIds
      : idsFromEntries(
          [
            ...entriesMap
              .values()
          ]
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

  const exclusions =
    exclusionSet(
      filterByIds(
        exclusionsRaw,
        fieldIds
      )
    );

  const isLive =
    isCurrentRace &&
    sessionCurrentlyLive(
      snapshot
    );

  const pitsById =
    new Map();

  const completedById =
    new Map();

  for (
    const row of pits
  ) {
    const id =
      String(
        row.apex_id
      );

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
    const row of completed
  ) {
    const id =
      String(
        row.apex_id
      );

    if (
      !completedById.has(id)
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

  const ids =
    [...fieldIds]
      .filter(
        validApexId
      );

  ids.sort(
    (a, b) => {
      const pa =
        Number(
          snapshot
            ?.positions?.[a]
        );

      const pb =
        Number(
          snapshot
            ?.positions?.[b]
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

  for (
    const id of ids
  ) {
    const teamRows =
      await buildStintsForTeam(
        env,
        rid,
        id,

        entriesMap.get(id) ||
          null,

        pitsById.get(id) ||
          [],

        completedById.get(id) ||
          [],

        teamMap,
        exclusions,
        isLive
      );

    rows.push(
      ...teamRows
    );
  }

  return {
    race_id: Number(rid),
    version: VERSION,
    session_live: isLive,
    field_count: fieldIds.size,
    count: rows.length,
    rows
  };
}

function weightedAverage(
  a,
  aCount,
  b,
  bCount
) {
  const av = Number(a);
  const ac = Number(aCount);
  const bv = Number(b);
  const bc = Number(bCount);

  if (
    !Number.isFinite(bv) ||
    !Number.isFinite(bc) ||
    bc <= 0
  ) {
    return Number.isFinite(av)
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
    ac + bc
  );
}

function buildDriversFromStints(
  stints
) {
  const map =
    new Map();

  for (
    const stint of stints
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

    if (!map.has(key)) {
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

          stint_count: 0,
          total_laps: 0,
          valid_laps: 0,

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
      ) || 0;

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
      ) || 0;

    target.stint_count += 1;

    target.is_live ||=
      !!stint.is_live;

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
  ].sort(
    (a, b) =>
      String(
        a.team_name || ""
      ).localeCompare(
        String(
          b.team_name || ""
        )
      ) ||
      String(
        a.driver_name
      ).localeCompare(
        String(
          b.driver_name
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
    const stint of stints
  ) {
    const id =
      String(
        stint.apex_id
      );

    if (!validApexId(id)) {
      continue;
    }

    if (!map.has(id)) {
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

          stint_count: 0,
          total_laps: 0,
          valid_laps: 0,

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
      ) || 0;

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
      ) || 0;

    target.stint_count += 1;

    target.is_live ||=
      !!stint.is_live;

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
          )
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
          a.team_name || ""
        ).localeCompare(
          String(
            b.team_name || ""
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
    ).catch(() => []);

  const currentRid =
    raceId(env);

  const isCurrent =
    Number(rid) ===
    Number(currentRid);

  const snapshotIds =
    isCurrent
      ? currentFieldIds(
          snapshot
        )
      : new Set();

  const ids =
    snapshotIds.size
      ? snapshotIds
      : idsFromEntries(
          entries
        );

  const teamMap =
    await stableTeamNameMap(
      env,
      rid
    );

  const rows =
    uniquePits(
      filterByIds(
        await loadPits(
          env,
          rid
        ).catch(() => []),
        ids
      )
    ).map(
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
    ).catch(() => null);

  const stintData =
    await stintsPayload(
      env,
      rid,
      snapshot
    );

  const pitData =
    await pitsPayload(
      env,
      rid,
      snapshot
    );

  const entries =
    newestEntryMap(
      await loadEntries(
        env,
        rid
      ).catch(() => [])
    );

  const latestStint =
    new Map();

  for (
    const row of
      stintData.rows
  ) {
    const id =
      String(
        row.apex_id
      );

    const prev =
      latestStint.get(id);

    if (
      !prev ||
      Number(
        row.stint_number
      ) >
        Number(
          prev.stint_number
        )
    ) {
      latestStint.set(
        id,
        row
      );
    }
  }

  const pitCount =
    new Map();

  for (
    const row of pitData.rows
  ) {
    pitCount.set(
      String(
        row.apex_id
      ),
      (
        pitCount.get(
          String(
            row.apex_id
          )
        ) || 0
      ) + 1
    );
  }

  const ids =
    new Set([
      ...entries.keys(),
      ...latestStint.keys()
    ]);

  const current = [];

  let raceLap = 0;
  let bestLap = null;

  for (
    const id of ids
  ) {
    if (!validApexId(id)) {
      continue;
    }

    const entry =
      entries.get(id) || {};

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

    const entryBest =
      Number(
        entry.best_lap
      );

    if (
      Number.isFinite(
        entryBest
      ) &&
      entryBest > 0 &&
      (
        bestLap === null ||
        entryBest < bestLap
      )
    ) {
      bestLap =
        entryBest;
    }

    const position =
      Number(
        snapshot
          ?.positions?.[id]
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
        pitCount.get(id) ||
        0,

      stint_number:
        num(
          stint.stint_number
        ) ||
        (
          pitCount.get(id) ||
          0
        ) + 1,

      start_lap_count:
        num(
          stint.start_lap_count
        ) || 0,

      stint_laps:
        num(
          stint.total_laps
        ) || 0,

      total_stint_laps:
        num(
          stint.total_laps
        ) || 0,

      valid_laps:
        num(
          stint.valid_laps
        ) || 0,

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
        ) ??
        num(
          entry.best_lap
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
        )
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
    Number(rid) ===
      Number(
        raceId(env)
      ) &&
    sessionCurrentlyLive(
      snapshot
    );

  return {
    race_id:
      Number(rid),

    generated_at:
      new Date()
        .toISOString(),

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
      raceLap,

    pit_count:
      pitData.count,

    best_lap:
      bestLap,

    current,

    entries:
      [...entries.values()]
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
    ).catch(() => []);

  const ids =
    Number(rid) ===
      Number(
        raceId(env)
      ) &&
    currentFieldIds(
      snapshot
    ).size
      ? currentFieldIds(
          snapshot
        )
      : idsFromEntries(
          entries
        );

  const rows =
    filterByIds(
      await loadExclusions(
        env,
        rid
      ),
      ids
    );

  return rows.map(
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
    ).catch(() => []);

  const map =
    new Map();

  for (
    const row of rows
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

    const ts =
      Date.parse(
        row.updated_at || ""
      ) || 0;

    if (
      !map.has(id) ||
      ts > map.get(id)
    ) {
      map.set(
        id,
        ts
      );
    }
  }

  return [
    ...map.entries()
  ]
    .map(
      ([id, ts]) => ({
        id,
        race_id: id,

        label:
          `Race ${id} - ${
            ts
              ? new Date(ts)
                  .toLocaleDateString(
                    "en-GB",
                    {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      timeZone:
                        "Europe/Sofia"
                    }
                  )
              : "archive"
          }`
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
      value ?? ""
    );

  return /[",\n]/.test(text)
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
    ).catch(() => []);

  const ids =
    Number(rid) ===
      Number(
        raceId(env)
      ) &&
    currentFieldIds(
      snapshot
    ).size
      ? currentFieldIds(
          snapshot
        )
      : idsFromEntries(
          entries
        );

  const teamMap =
    await stableTeamNameMap(
      env,
      rid
    );

  const encoder =
    new TextEncoder();

  const idList =
    [...ids]
      .filter(
        validApexId
      )
      .sort(
        (a, b) =>
          Number(a) -
          Number(b)
      );

  const stream =
    new ReadableStream({
      async start(
        controller
      ) {
        const write =
          text =>
            controller.enqueue(
              encoder.encode(
                text
              )
            );

        try {
          write("\uFEFF");

          write(
            "Apex Timing - drive your success https://www.apex-timing.com/\r\n\r\n"
          );

          write(
            `Race ${rid} - Lap time records\r\n`
          );

          for (
            const id of idList
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
              await loadLapEventsForApex(
                env,
                rid,
                id
              );

            const seen =
              new Set();
                        for (
              const row of laps
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

              const n =
                Math.trunc(lap);

              if (
                seen.has(n)
              ) {
                continue;
              }

              seen.add(n);

              write(
                `${n},${time.toFixed(3)}\r\n`
              );
            }
          }

          controller.close();

        } catch (error) {
          controller.error(
            error
          );
        }
      }
    });

  return new Response(
    stream,
    {
      headers: {
        "content-type":
          "text/csv; charset=utf-8",

        "content-disposition":
          `attachment; filename="Race ${rid} - Lap time records.csv"`,

        "cache-control":
          "no-store"
      }
    }
  );
}

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
    const row of stints
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
    [...grouped.entries()]
      .map(
        ([id, rows]) => `
<section>
<h2>${escapeHtml(id)} - ${escapeHtml(
          rows[0]?.team_name ||
          `APEX ${id}`
        )}</h2>
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
${rows.map(
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
).join("")}
</tbody>
</table>
</section>`
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

    this.detailRunning =
      new Set();

    this.lastDetailFetch =
      new Map();

    state.blockConcurrencyWhile(
      async () => {
        this.lastPacketAt =
          await state.storage.get(
            "lastPacketAt"
          ) || null;

        this.packetCount =
          await state.storage.get(
            "packetCount"
          ) || 0;

        this.positions =
          new Map(
            Object.entries(
              await state.storage.get(
                "positions"
              ) || {}
            ).filter(
              ([id]) =>
                validApexId(id)
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

        this.fieldApexIds =
          new Set(
            (
              await state.storage.get(
                "fieldApexIds"
              ) || []
            )
              .map(String)
              .filter(
                validApexId
              )
          );

        if (
          !this.fieldApexIds.size &&
          this.positions.size
        ) {
          this.fieldApexIds =
            new Set(
              [...this.positions.keys()]
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
    await this.state.storage.put({
      lastPacketAt:
        this.lastPacketAt,

      packetCount:
        this.packetCount,

      positions:
        Object.fromEntries(
          [...this.positions]
            .filter(
              ([id]) =>
                validApexId(id)
            )
        ),

      columnTypes:
        Object.fromEntries(
          this.columnTypes
        ),

      fieldApexIds:
        [...this.fieldApexIds]
          .filter(
            validApexId
          )
    });
  }

  snapshot() {
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

      field_count:
        [...this.fieldApexIds]
          .filter(
            validApexId
          ).length,

      fieldApexIds:
        [...this.fieldApexIds]
          .filter(
            validApexId
          ),

      positions:
        Object.fromEntries(
          [...this.positions]
            .filter(
              ([id]) =>
                validApexId(id)
            )
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
        this.snapshot()
      );
    }

    if (
      path === "/status" ||
      path === "/snapshot"
    ) {
      return json(
        this.snapshot()
      );
    }

    if (
      path === "/reconnect"
    ) {
      try {
        this.ws?.close(
          1000,
          "reconnect"
        );
      } catch {}

      this.ws = null;
      this.connecting = false;

      await this.connect();

      return json(
        this.snapshot()
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

      this.ws = null;

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

    this.connecting = true;

    try {
      const ws =
        new WebSocket(
          this.env.APEX_WS_URL ||
          "wss://live-data.apex-timing.com:8913/"
        );

      this.ws = ws;

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
                  this.packet(
                    payload
                  )
              )
              .catch(
                console.error
              );
        }
      );

      const closed =
        () => {
          this.ws = null;
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

    } catch (error) {
      this.ws = null;
      this.connecting =
        false;

      await this.state.storage.setAlarm(
        Date.now() +
        5000
      );

      throw error;
    }
  }

  async entry(id) {
    const rows =
      await sbGet(
        this.env,
        "apex_entries",
        {
          select: "*",
          race_id:
            `eq.${this.rid}`,
          apex_id:
            `eq.${id}`,
          limit: "1"
        }
      );

    return rows[0] ||
      null;
  }

  async upsertEntry(
    id,
    changes
  ) {
    const old =
      await this.entry(id);

    await sbUpsert(
      this.env,
      "apex_entries",
      {
        race_id:
          this.rid,

        apex_id:
          String(id),

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

  async fetchDetails(
    id,
    team
  ) {
    const entry =
      await this.entry(id);

    const n =
      Number(
        entry?.lap_count ||
        0
      );

    if (
      !n ||
      this.detailRunning.has(
        String(id)
      )
    ) {
      return;
    }

    const now =
      Date.now();

    if (
      now -
        (
          this.lastDetailFetch.get(
            String(id)
          ) || 0
        ) <
      1500
    ) {
      return;
    }

    this.lastDetailFetch.set(
      String(id),
      now
    );

    this.detailRunning.add(
      String(id)
    );

    try {
      const request =
        `D#-${n}` +
        `#D${id}.L#-${n}` +
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

                request
              })
          }
        );

      if (!response.ok) {
        throw new Error(
          `Apex detail ${response.status}`
        );
      }

      const raw =
        await response.text();

      const laps =
        parseLapRows(
          raw,
          this.rid
        ).filter(
          row =>
            String(
              row.apex_id
            ) ===
            String(id)
        );

      const pits =
        parsePits(
          raw,
          team,
          this.rid
        ).filter(
          row =>
            String(
              row.apex_id
            ) ===
            String(id)
        );

      if (laps.length) {
        await sbUpsert(
          this.env,
          "apex_lap_events",
          laps,
          "race_id,apex_id,lap_number"
        );
      }

      if (pits.length) {
        await sbUpsert(
          this.env,
          "apex_pit_stints",
          pits,
          "race_id,apex_id,pit_number"
        );
      }

    } finally {
      this.detailRunning.delete(
        String(id)
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
    const id =
      String(apexId);

    if (!validApexId(id)) {
      return;
    }

    if (
      cls === "drteam" ||
      type === "drteam"
    ) {
      const driver =
        cleanDriver(value);

      if (driver) {
        await this.upsertEntry(
          id,
          {
            current_driver:
              driver
          }
        );
      }

      return;
    }

    if (
      cls === "dr" ||
      type === "dr"
    ) {
      const team =
        stripHtml(value);

      if (team) {
        await this.upsertEntry(
          id,
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
        parseNumber(value);

      if (
        position !== null &&
        position > 0
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

    if (
      type === "llp" ||
      cls === "llp" ||
      (
        cls === "tn" &&
        column === "9"
      )
    ) {
      const lap =
        parseLapTime(value);

      if (lap !== null) {
        await this.upsertEntry(
          id,
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
        parseLapTime(value);

      if (lap !== null) {
        await this.upsertEntry(
          id,
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
        parseNumber(value);

      if (
        lapCount !== null &&
        lapCount >= 0
      ) {
        await this.upsertEntry(
          id,
          {
            lap_count:
              Math.trunc(
                lapCount
              )
          }
        );

        this.state.waitUntil(
          this.fetchDetails(
            id,
            (
              await this.entry(
                id
              )
            )?.team_name
          )
        );
      }
    }
  }

  async parseAndSave(
    payload
  ) {
    for (
      const rawLine of String(
        payload || ""
      ).split("\n")
    ) {
      const line =
        rawLine.trim();

      if (!line) {
        continue;
      }

      const protocol =
        parseProtocolLine(
          line
        );

      if (
        protocol.id ===
        "grid"
      ) {
        const grid =
          parseGridData(
            protocol.value
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
              [...grid.rows.keys()]
                .filter(
                  validApexId
                )
            );

          this.positions =
            new Map(
              [...grid.positions]
                .filter(
                  ([id]) =>
                    validApexId(
                      id
                    )
                )
            );

          for (
            const [
              id,
              fields
            ] of grid.rows
          ) {
            for (
              const [
                type,
                value
              ] of Object.entries(
                fields
              )
            ) {
              await this.applyField(
                id,
                type,
                type,
                value,
                null
              );
            }
          }

          await this.persist();
        }

        continue;
      }

      const parsed =
        parseApexLine(
          line
        );

      if (
        !parsed ||
        !validApexId(
          parsed.apexId
        )
      ) {
        continue;
      }

      if (
        this.fieldApexIds.size &&
        !this.fieldApexIds.has(
          String(
            parsed.apexId
          )
        )
      ) {
        continue;
      }

      const type =
        parsed.column
          ? this.columnTypes.get(
              `c${parsed.column}`
            ) ||
            parsed.field
          : parsed.field;

      await this.applyField(
        parsed.apexId,
        type,
        parsed.field,
        parsed.value,
        parsed.column
      );
    }
  }

  async packet(payload) {
    this.packetCount += 1;

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
    );

  const lap =
    Number(
      body.lap_number
    );

  if (
    !validApexId(apexId) ||
    !Number.isFinite(lap) ||
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
        Math.trunc(lap),

      reason:
        body.reason ||
        "Manual exclusion"
    },

    "race_id,apex_id,lap_number"
  );

  return json({
    ok: true
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
      ) || ""
    );

  const lap =
    Number(
      url.searchParams.get(
        "lap_number"
      )
    );

  if (
    !validApexId(apexId) ||
    !Number.isFinite(lap)
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
        `eq.${Math.trunc(lap)}`
    }
  );

  return json({
    ok: true
  });
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
          "/api/collector/status" ||
        url.pathname ===
          "/api/collector/snapshot"
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
        "/api/races"
      ) {
        return json({
          current_race_id:
            raceId(env),

          version:
            VERSION,

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
          ).catch(
            console.error
          )
        );

        return json(
          await livePayload(
            env,
            rid
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
          ...payload,
          rows:
            payload.current
        });
      }

      const snapshot =
        await collectorSnapshot(
          env
        ).catch(
          () => null
        );

      if (
        url.pathname ===
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
          buildDriversFromStints(
            stints.rows
          );

        return json({
          race_id:
            Number(rid),

          version:
            VERSION,

          count:
            rows.length,

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

        const rows =
          buildTeamsFromStints(
            stints.rows,
            snapshot?.positions ||
            {}
          );

        return json({
          race_id:
            Number(rid),

          version:
            VERSION,

          count:
            rows.length,

          rows
        });
      }

      if (
        url.pathname ===
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
        url.pathname ===
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
            Number(rid),

          version:
            VERSION,

          count:
            rows.length,

          rows
        });
      }

      if (
        url.pathname ===
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
        url.pathname ===
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
        url.pathname ===
        "/api/reports/lap-time-records.csv"
      ) {
        return createLapRecordsCsvResponse(
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

        return new Response(
          buildPitReportHtml(
            rid,
            stints.rows
          ),
          {
            headers: {
              "content-type":
                "text/html; charset=utf-8",

              "cache-control":
                "no-store"
            }
          }
        );
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
      ).catch(
        console.error
      )
    );
  }
};
