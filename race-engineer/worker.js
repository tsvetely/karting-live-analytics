function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

const toRaceId = value => {
  const n = Number(value);

  return Number.isFinite(n) && n > 0
    ? Math.trunc(n)
    : 1;
};

const raceIdFrom = (url, env) =>
  toRaceId(
    url.searchParams.get("race_id") ||
    env.DEFAULT_RACE_ID ||
    1
  );


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
  params = {}
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
        value
      );
    }
  }

  const response =
    await fetch(
      url,
      {
        headers:
          sbHeaders(
            env,
            {
              accept:
                "application/json"
            }
          )
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


async function sbWrite(
  env,
  table,
  method,
  body,
  params = {},
  prefer = "return=minimal"
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
        value
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


const sbInsert = (
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
      on_conflict:
        conflict
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


// ============================================================
// APEX PARSING
// ============================================================

function parseApexLine(line) {
  const match =
    line.match(
      /^r(\d+)(?:c(\d+))?\|([^|]+)\|(.*)$/
    );

  if (!match) {
    return null;
  }

  return {
    apexId:
      match[1],

    column:
      match[2] || null,

    field:
      match[3],

    value:
      match[4] || ""
  };
}


function parseLapTime(value) {
  if (!value) {
    return null;
  }

  if (
    value.includes(":")
  ) {
    const [
      minutes,
      seconds
    ] =
      value
        .split(":")
        .map(Number);

    return (
      Number.isFinite(minutes) &&
      Number.isFinite(seconds)
    )
      ? minutes * 60 + seconds
      : null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function msToTime(ms) {
  const number =
    Number(ms);

  if (
    !Number.isFinite(number)
  ) {
    return null;
  }

  const totalSeconds =
    Math.floor(
      number / 1000
    );

  const hours =
    Math.floor(
      totalSeconds / 3600
    );

  const minutes =
    Math.floor(
      (
        totalSeconds %
        3600
      ) /
      60
    );

  const seconds =
    totalSeconds % 60;

  return (
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}`
  );
}


function msToPitTime(ms) {
  const number =
    Number(ms);

  if (
    !Number.isFinite(number)
  ) {
    return null;
  }

  const totalSeconds =
    Math.floor(
      number / 1000
    );

  return (
    `${Math.floor(totalSeconds / 60)}:` +
    `${String(totalSeconds % 60).padStart(2, "0")}.` +
    `${String(number % 1000).padStart(3, "0")}`
  );
}


function parseDrivers(raw) {
  const drivers =
    new Map();

  const regex =
    /<driver\s+[^>]*id="(\d+)"[^>]*name="([^"]+)"/g;

  let match;

  while (
    (
      match =
        regex.exec(raw)
    ) !== null
  ) {
    drivers.set(
      Number(match[1]),
      match[2]
    );
  }

  return drivers;
}


function parseLapRows(
  raw,
  raceId
) {
  const now =
    new Date()
      .toISOString();

  return raw
    .split("\n")
    .map(
      line =>
        line.trim()
    )
    .map(
      line => {
        const match =
          line.match(
            /^D(\d+)\.L0*(\d+)#(.+)$/
          );

        if (!match) {
          return null;
        }

        const parts =
          match[3]
            .split("|");

        const milliseconds =
          Number(parts[3]);

        if (
          !Number.isFinite(
            milliseconds
          ) ||
          milliseconds <= 0
        ) {
          return null;
        }

        return {
          race_id:
            raceId,

          apex_id:
            String(match[1]),

          lap_number:
            Number(match[2]),

          lap_time:
            Number(
              (
                milliseconds /
                1000
              ).toFixed(3)
            ),

          received_at:
            now
        };
      }
    )
    .filter(Boolean);
}


function parsePitRows(
  raw,
  teamName,
  raceId
) {
  const drivers =
    parseDrivers(raw);

  const now =
    new Date()
      .toISOString();

  return raw
    .split("\n")
    .map(
      line =>
        line.trim()
    )
    .map(
      line => {
        const match =
          line.match(
            /^D(\d+)\.P\d+#(.+)$/
          );

        if (!match) {
          return null;
        }

        const parts =
          match[2]
            .split("|");

        const pitNumber =
          Number(parts[0]);

        const pitLap =
          Number(parts[1]);

        if (
          !Number.isFinite(
            pitNumber
          ) ||
          !Number.isFinite(
            pitLap
          )
        ) {
          return null;
        }

        return {
          race_id:
            raceId,

          apex_id:
            Number(match[1]),

          team_name:
            teamName || null,

          pit_number:
            pitNumber,

          pit_lap:
            pitLap,

          pit_hour:
            msToTime(parts[2]),

          on_track:
            msToTime(parts[5]),

          driver_name:
            drivers.get(
              Number(parts[7])
            ) || null,

          total_time:
            msToTime(parts[8]),

          pit_time:
            msToPitTime(parts[4]),

          updated_at:
            now
        };
      }
    )
    .filter(Boolean);
}


// ============================================================
// MATH
// ============================================================

function median(values) {
  const data =
    values
      .map(Number)
      .filter(
        Number.isFinite
      )
      .sort(
        (a, b) =>
          a - b
      );

  if (!data.length) {
    return null;
  }

  const index =
    Math.floor(
      data.length /
      2
    );

  return data.length % 2
    ? data[index]
    : (
        data[index - 1] +
        data[index]
      ) /
      2;
}


function percentile(
  values,
  ratio
) {
  const data =
    values
      .map(Number)
      .filter(
        Number.isFinite
      )
      .sort(
        (a, b) =>
          a - b
      );

  if (!data.length) {
    return null;
  }

  return data[
    Math.floor(
      (
        data.length -
        1
      ) *
      ratio
    )
  ];
}


function calculateStats(rows) {
  let count = 0;
  let sum = 0;
  let sumSquares = 0;

  let best = null;
  let bestLap = null;

  let worst = null;
  let worstLap = null;

  for (const row of rows) {
    const time =
      Number(
        row.lap_time
      );

    if (
      !Number.isFinite(time) ||
      time <= 0
    ) {
      continue;
    }

    count += 1;
    sum += time;
    sumSquares +=
      time * time;

    if (
      best === null ||
      time < best
    ) {
      best =
        time;

      bestLap =
        Number(
          row.lap_number
        );
    }

    if (
      worst === null ||
      time > worst
    ) {
      worst =
        time;

      worstLap =
        Number(
          row.lap_number
        );
    }
  }

  if (!count) {
    return {
      count: 0,
      sum: 0,
      sumSquares: 0,
      average: null,
      best: null,
      bestLap: null,
      worst: null,
      worstLap: null,
      consistency: null
    };
  }

  const average =
    sum / count;

  const variance =
    Math.max(
      0,
      sumSquares /
        count -
        average *
        average
    );

  return {
    count,
    sum,
    sumSquares,
    average,
    best,
    bestLap,
    worst,
    worstLap,

    consistency:
      Math.sqrt(
        variance
      )
  };
}


async function concurrent(
  items,
  limit,
  worker
) {
  let index = 0;

  async function run() {
    while (
      index <
      items.length
    ) {
      const current =
        index++;

      await worker(
        items[current]
      );
    }
  }

  await Promise.all(
    Array.from(
      {
        length:
          Math.min(
            limit,
            items.length
          )
      },
      () => run()
    )
  );
}


// ============================================================
// COLLECTOR
// ============================================================

export class ApexCollector {
  constructor(state, env) {
    this.state =
      state;

    this.env =
      env;

    this.raceId =
      toRaceId(
        env.DEFAULT_RACE_ID ||
        1
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

    this.entries =
      new Map();

    this.details =
      new Map();

    this.running =
      new Set();

    this.globalExcluded =
      new Map();

    this.globalHash =
      "";

    this.syncing =
      false;

    this.lastSync =
      0;

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

        if (
          await state.storage
            .getAlarm() ===
          null
        ) {
          await state.storage
            .setAlarm(
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
        await this.status()
      );
    }

    if (
      path ===
      "/status"
    ) {
      return json(
        await this.status()
      );
    }

    if (
      path ===
      "/sync"
    ) {
      await this.sync(
        false
      );

      return json(
        await this.status()
      );
    }

    if (
      path ===
      "/reconnect"
    ) {
      try {
        this.ws?.close(
          1000,
          "manual reconnect"
        );
      } catch {}

      this.ws =
        null;

      this.connecting =
        false;

      await this.connect();

      await this.sync(
        true
      );

      return json(
        await this.status()
      );
    }

    return new Response(
      "Not found",
      {
        status: 404
      }
    );
  }


  async status() {
    return {
      race_id:
        this.raceId,

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

      cached_teams:
        this.details.size,

      global_excluded_laps:
        [
          ...this
            .globalExcluded
            .values()
        ]
          .reduce(
            (
              total,
              set
            ) =>
              total +
              set.size,
            0
          )
    };
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

    await this.sync(
      false
    );

    await this.state.storage
      .setAlarm(
        Date.now() +
        60000
      );
  }


  async connect() {
    if (
      this.connecting
    ) {
      return;
    }

    if (
      this.ws &&
      (
        this.ws.readyState ===
          WebSocket.OPEN ||
        this.ws.readyState ===
          WebSocket.CONNECTING
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

          this.queue =
            this.queue
              .then(
                () =>
                  this.sync(
                    true
                  )
              )
              .catch(
                error =>
                  console.error(
                    "INITIAL SYNC ERROR:",
                    error
                  )
              );
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
                error =>
                  console.error(
                    "PACKET ERROR:",
                    error
                  )
              );
        }
      );

      ws.addEventListener(
        "close",
        () => {
          this.ws =
            null;

          this.connecting =
            false;

          this.state.storage
            .setAlarm(
              Date.now() +
              5000
            );
        }
      );

      ws.addEventListener(
        "error",
        error => {
          console.error(
            "APEX WS ERROR:",
            error
          );

          this.ws =
            null;

          this.connecting =
            false;

          this.state.storage
            .setAlarm(
              Date.now() +
              5000
            );
        }
      );
    } catch (error) {
      this.ws =
        null;

      this.connecting =
        false;

      await this.state.storage
        .setAlarm(
          Date.now() +
          5000
        );

      throw error;
    }
  }


  async getEntry(
    apexId,
    force = false
  ) {
    const key =
      String(apexId);

    if (
      !force &&
      this.entries.has(key)
    ) {
      return this.entries.get(
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
            `eq.${this.raceId}`,

          apex_id:
            `eq.${key}`,

          limit:
            "1"
        }
      );

    const row =
      rows[0] || null;

    if (row) {
      this.entries.set(
        key,
        row
      );
    }

    return row;
  }


  async activeEntries() {
    const rows =
      await sbGet(
        this.env,
        "apex_entries",
        {
          select:
            "*",

          race_id:
            `eq.${this.raceId}`,

          order:
            "updated_at.desc"
        }
      );

    const newest =
      rows.reduce(
        (
          latest,
          row
        ) => {
          const time =
            Date.parse(
              row.updated_at ||
              ""
            );

          return Number.isFinite(
            time
          )
            ? Math.max(
                latest,
                time
              )
            : latest;
        },
        0
      );

    return rows.filter(
      row => {
        const time =
          Date.parse(
            row.updated_at ||
            ""
          );

        return (
          Number.isFinite(time) &&
          newest - time <=
            180000
        );
      }
    );
  }


  async upsertEntry(change) {
    const key =
      String(
        change.apex_id
      );

    const old =
      await this.getEntry(
        key
      ) || {};

    const row = {
      race_id:
        this.raceId,

      apex_id:
        key,

      team_name:
        change.team_name !==
        undefined
          ? change.team_name
          : old.team_name ??
            null,

      current_driver:
        change.current_driver !==
        undefined
          ? change.current_driver
          : old.current_driver ??
            null,

      last_lap:
        change.last_lap !==
        undefined
          ? change.last_lap
          : old.last_lap ??
            null,

      best_lap:
        change.best_lap !==
        undefined
          ? change.best_lap
          : old.best_lap ??
            null,

      lap_count:
        change.lap_count !==
        undefined
          ? change.lap_count
          : old.lap_count ??
            null,

      updated_at:
        new Date()
          .toISOString()
    };

    await sbUpsert(
      this.env,
      "apex_entries",
      row,
      "race_id,apex_id"
    );

    this.entries.set(
      key,
      row
    );
  }


  async requestDetail(
    apexId,
    lapCount
  ) {
    const request =
      `D#-${lapCount}` +
      `#D${apexId}.L#-${lapCount}` +
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


  async saveLaps(rows) {
    for (
      let index = 0;
      index < rows.length;
      index += 250
    ) {
      await sbUpsert(
        this.env,
        "apex_lap_events",
        rows.slice(
          index,
          index + 250
        ),
        "race_id,apex_id,lap_number"
      );
    }
  }


  async loadDetails(entry) {
    const key =
      String(
        entry.apex_id
      );

    const lapCount =
      Number(
        entry.lap_count ||
        0
      );

    if (!lapCount) {
      return null;
    }

    const raw =
      await this.requestDetail(
        key,
        lapCount
      );

    const laps =
      parseLapRows(
        raw,
        this.raceId
      );

    const pits =
      parsePitRows(
        raw,
        entry.team_name,
        this.raceId
      );

    if (laps.length) {
      await this.saveLaps(
        laps
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

    const previous =
      this.details.get(
        key
      );

    const pitSignature =
      pits
        .map(
          pit =>
            `${pit.pit_number}:` +
            `${pit.pit_lap}:` +
            `${pit.driver_name || ""}`
        )
        .join("|");

    const value = {
      entry,
      laps,
      pits,
      lapCount,

      driver:
        entry.current_driver,

      pitSignature,

      pitsChanged:
        !previous ||
        previous.pitSignature !==
          pitSignature
    };

    this.details.set(
      key,
      value
    );

    return value;
  }


  globalDisruptions() {
    const allTimes = [];

    for (
      const detail
      of this.details.values()
    ) {
      for (
        const lap
        of detail.laps.slice(-60)
      ) {
        const time =
          Number(
            lap.lap_time
          );

        if (
          Number.isFinite(time) &&
          time > 0
        ) {
          allTimes.push(
            time
          );
        }
      }
    }

    const sessionBaseline =
      percentile(
        allTimes,
        0.4
      );

    if (
      !sessionBaseline ||
      this.entries.size < 3
    ) {
      const changed =
        this.globalHash !== "";

      this.globalExcluded =
        new Map();

      this.globalHash =
        "";

      return changed;
    }

    const candidates = [];

    const buckets =
      new Map();

    for (
      const [
        apexId,
        detail
      ]
      of this.details.entries()
    ) {
      const currentLap =
        Number(
          detail.entry
            .lap_count ||
          0
        );

      const recent =
        detail.laps
          .filter(
            lap => {
              const number =
                Number(
                  lap.lap_number
                );

              return (
                Number.isFinite(
                  number
                ) &&
                currentLap -
                  number >=
                  0 &&
                currentLap -
                  number <=
                  60
              );
            }
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

      const normal =
        recent
          .map(
            lap =>
              Number(
                lap.lap_time
              )
          )
          .filter(
            time =>
              Number.isFinite(
                time
              ) &&
              time >=
                sessionBaseline *
                  0.78 &&
              time <=
                sessionBaseline *
                  1.28
          );

      const local =
        median(normal) ||
        sessionBaseline;

      const slowThreshold =
        Math.max(
          local * 1.5,
          local + 25
        );

      const normalThreshold =
        local * 1.3;

      let index = 0;

      while (
        index <
        recent.length
      ) {
        if (
          Number(
            recent[index]
              .lap_time
          ) <
          slowThreshold
        ) {
          index += 1;
          continue;
        }

        const blockStart =
          index;

        while (
          index + 1 <
            recent.length &&
          Number(
            recent[index + 1]
              .lap_number
          ) ===
            Number(
              recent[index]
                .lap_number
            ) +
              1 &&
          Number(
            recent[index + 1]
              .lap_time
          ) >=
            slowThreshold
        ) {
          index += 1;
        }

        const blockEnd =
          index;

        const before =
          recent[
            blockStart - 1
          ];

        const after =
          recent[
            blockEnd + 1
          ];

        if (
          blockEnd -
            blockStart +
            1 <=
            6 &&
          before &&
          after &&
          Number(
            before.lap_time
          ) <=
            normalThreshold &&
          Number(
            after.lap_time
          ) <=
            normalThreshold
        ) {
          const middle =
            Number(
              recent[
                Math.floor(
                  (
                    blockStart +
                    blockEnd
                  ) /
                  2
                )
              ].lap_number
            );

          const bucket =
            Math.floor(
              (
                currentLap -
                middle
              ) /
              5
            );

          const block =
            recent
              .slice(
                blockStart,
                blockEnd + 1
              )
              .map(
                lap =>
                  Number(
                    lap.lap_number
                  )
              );

          candidates.push({
            apexId,
            bucket,
            block
          });

          if (
            !buckets.has(
              bucket
            )
          ) {
            buckets.set(
              bucket,
              new Set()
            );
          }

          buckets
            .get(bucket)
            .add(apexId);
        }

        index += 1;
      }
    }

    const required =
      Math.floor(
        this.entries.size /
        2
      ) +
      1;

    const accepted =
      new Set();

    for (
      const bucket
      of buckets.keys()
    ) {
      const teams =
        new Set();

      for (
        let neighbour =
          bucket - 1;
        neighbour <=
          bucket + 1;
        neighbour += 1
      ) {
        for (
          const apexId
          of buckets.get(
            neighbour
          ) || []
        ) {
          teams.add(
            apexId
          );
        }
      }

      if (
        teams.size >=
        required
      ) {
        accepted.add(
          bucket - 1
        );

        accepted.add(
          bucket
        );

        accepted.add(
          bucket + 1
        );
      }
    }

    const map =
      new Map();

    for (
      const candidate
      of candidates
    ) {
      if (
        !accepted.has(
          candidate.bucket
        )
      ) {
        continue;
      }

      if (
        !map.has(
          candidate.apexId
        )
      ) {
        map.set(
          candidate.apexId,
          new Set()
        );
      }

      for (
        const lap
        of candidate.block
      ) {
        map
          .get(
            candidate.apexId
          )
          .add(lap);
      }
    }

    const hash =
      [...map.entries()]
        .sort(
          ([a], [b]) =>
            a.localeCompare(b)
        )
        .map(
          ([id, laps]) =>
            `${id}:` +
            `${
              [...laps]
                .sort(
                  (a, b) =>
                    a - b
                )
                .join(",")
            }`
        )
        .join("|");

    const changed =
      hash !==
      this.globalHash;

    this.globalExcluded =
      map;

    this.globalHash =
      hash;

    return changed;
  }


  async manualExclusions(
    apexId,
    startLap,
    endLap
  ) {
    try {
      const rows =
        await sbGet(
          this.env,
          "manual_lap_exclusions",
          {
            select:
              "lap_number",

            race_id:
              `eq.${this.raceId}`,

            apex_id:
              `eq.${apexId}`,

            lap_number:
              `gt.${startLap}`,

            order:
              "lap_number.asc"
          }
        );

      return new Set(
        rows
          .map(
            row =>
              Number(
                row.lap_number
              )
          )
          .filter(
            lap =>
              Number.isFinite(
                lap
              ) &&
              lap <= endLap
          )
      );
    } catch (error) {
      console.error(
        "MANUAL EXCLUSION READ ERROR:",
        error
      );

      return new Set();
    }
  }


  boundary(pits) {
    const sorted =
      [...pits]
        .filter(
          pit =>
            Number.isFinite(
              Number(
                pit.pit_lap
              )
            )
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

    const last =
      sorted[
        sorted.length - 1
      ];

    return {
      startLap:
        last
          ? Number(
              last.pit_lap
            )
          : 0,

      stintNumber:
        sorted.length + 1,

      sorted
    };
  }


  async rebuild(detail) {
    const entry =
      detail?.entry;

    if (
      !entry?.current_driver
    ) {
      return;
    }

    const apexId =
      String(
        entry.apex_id
      );

    const currentLap =
      Number(
        entry.lap_count ||
        0
      );

    if (!currentLap) {
      return;
    }

    const {
      startLap,
      sorted
    } =
      this.boundary(
        detail.pits
      );

    const manual =
      await this
        .manualExclusions(
          apexId,
          startLap,
          currentLap
        );

    const global =
      this.globalExcluded
        .get(apexId) ||
      new Set();

    const pitExcluded =
      new Set();

    for (
      const pit
      of sorted
    ) {
      const lap =
        Number(
          pit.pit_lap
        );

      pitExcluded.add(
        lap - 1
      );

      pitExcluded.add(
        lap
      );

      pitExcluded.add(
        lap + 1
      );
    }

    const stintLaps =
      detail.laps
        .filter(
          lap => {
            const number =
              Number(
                lap.lap_number
              );

            return (
              Number.isFinite(
                number
              ) &&
              number >
                startLap &&
              number <=
                currentLap
            );
          }
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

    const valid =
      stintLaps.filter(
        lap => {
          const number =
            Number(
              lap.lap_number
            );

          const time =
            Number(
              lap.lap_time
            );

          return (
            Number.isFinite(
              time
            ) &&
            time > 0 &&
            !manual.has(
              number
            ) &&
            !pitExcluded.has(
              number
            ) &&
            !global.has(
              number
            )
          );
        }
      );

    const result =
      calculateStats(
        valid
      );

    const last =
      stintLaps[
        stintLaps.length -
        1
      ];

    const oldRows =
      await sbGet(
        this.env,
        "live_stint_stats",
        {
          select:
            "*",

          race_id:
            `eq.${this.raceId}`,

          apex_id:
            `eq.${apexId}`,

          limit:
            "1"
        }
      );

    const old =
      oldRows[0];

    const sameStint =
      old &&
      old.driver_name ===
        entry.current_driver &&
      Number(
        old.start_lap_count
      ) ===
        startLap;

    const totalLaps =
      sorted.length
        ? Math.max(
            0,
            currentLap -
              startLap
          )
        : stintLaps.length;

    await sbUpsert(
      this.env,
      "live_stint_stats",
      {
        race_id:
          this.raceId,

        apex_id:
          apexId,

        team_name:
          entry.team_name,

        driver_name:
          entry.current_driver,

        start_lap_count:
          startLap,

        current_lap_count:
          currentLap,

        total_laps:
          totalLaps,

        valid_laps:
          result.count,

        lap_sum:
          result.sum,

        lap_sum_squares:
          result.sumSquares,

        last_lap:
          last
            ? Number(
                last.lap_time
              )
            : Number(
                entry.last_lap
              ) || null,

        avg_lap:
          result.average,

        best_lap:
          result.best,

        best_lap_number:
          result.bestLap,

        worst_lap:
          result.worst,

        worst_lap_number:
          result.worstLap,

        consistency:
          result.consistency,

        stint_started_at:
          sameStint
            ? old.stint_started_at
            : new Date()
                .toISOString(),

        updated_at:
          new Date()
            .toISOString()
      },
      "race_id,apex_id"
    );
  }


  async closeStint(
    apexId,
    newDriver
  ) {
    const rows =
      await sbGet(
        this.env,
        "live_stint_stats",
        {
          select:
            "*",

          race_id:
            `eq.${this.raceId}`,

          apex_id:
            `eq.${apexId}`,

          limit:
            "1"
        }
      );

    const live =
      rows[0];

    if (
      !live ||
      !live.driver_name ||
      live.driver_name ===
        newDriver
    ) {
      return;
    }

    await sbInsert(
      this.env,
      "completed_stint_stats",
      {
        race_id:
          this.raceId,

        apex_id:
          String(apexId),

        team_name:
          live.team_name,

        driver_name:
          live.driver_name,

        start_lap_count:
          live.start_lap_count,

        end_lap_count:
          live.current_lap_count,

        total_laps:
          live.total_laps,

        valid_laps:
          live.valid_laps,

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
          live.stint_started_at,

        stint_ended_at:
          new Date()
            .toISOString()
      }
    );

    await sbDelete(
      this.env,
      "live_stint_stats",
      {
        race_id:
          `eq.${this.raceId}`,

        apex_id:
          `eq.${apexId}`
      }
    );
  }


  async refresh(
    apexId,
    force = false
  ) {
    const key =
      String(apexId);

    if (
      this.running.has(key)
    ) {
      return;
    }

    const entry =
      await this.getEntry(
        key
      );

    if (
      !entry ||
      !Number(
        entry.lap_count
      )
    ) {
      return;
    }

    const cached =
      this.details.get(
        key
      );

    if (
      !force &&
      cached &&
      cached.lapCount ===
        Number(
          entry.lap_count
        ) &&
      cached.driver ===
        entry.current_driver
    ) {
      return;
    }

    this.running.add(
      key
    );

    try {
      const detail =
        await this.loadDetails(
          entry
        );

      if (!detail) {
        return;
      }

      this.entries.set(
        key,
        entry
      );

      const changed =
        this.globalDisruptions();

      if (changed) {
        await concurrent(
          [...this.details.values()]
            .filter(
              item =>
                this.entries.has(
                  String(
                    item.entry
                      .apex_id
                  )
                )
            ),
          4,
          item =>
            this.rebuild(item)
        );
      } else {
        await this.rebuild(
          detail
        );
      }
    } finally {
      this.running.delete(
        key
      );
    }
  }


  async sync(force = false) {
    const now =
      Date.now();

    if (
      this.syncing ||
      (
        !force &&
        now -
          this.lastSync <
          15000
      )
    ) {
      return;
    }

    this.syncing =
      true;

    this.lastSync =
      now;

    try {
      const active =
        await this.activeEntries();

      this.entries =
        new Map(
          active.map(
            entry => [
              String(
                entry.apex_id
              ),
              entry
            ]
          )
        );

      const needed =
        active.filter(
          entry => {
            const cached =
              this.details.get(
                String(
                  entry.apex_id
                )
              );

            return (
              force ||
              !cached ||
              cached.lapCount !==
                Number(
                  entry.lap_count
                ) ||
              cached.driver !==
                entry.current_driver
            );
          }
        );

      await concurrent(
        needed,
        4,
        async entry => {
          try {
            await this.loadDetails(
              entry
            );
          } catch (error) {
            console.error(
              "TEAM SYNC ERROR:",
              entry.apex_id,
              error
            );
          }
        }
      );

      const changed =
        this.globalDisruptions();

      const rebuildItems =
        changed ||
        force
          ? [...this.details.values()]
              .filter(
                item =>
                  this.entries.has(
                    String(
                      item.entry
                        .apex_id
                    )
                  )
              )
          : needed
              .map(
                entry =>
                  this.details.get(
                    String(
                      entry.apex_id
                    )
                  )
              )
              .filter(Boolean);

      await concurrent(
        rebuildItems,
        4,
        item =>
          this.rebuild(item)
      );
    } finally {
      this.syncing =
        false;
    }
  }


  async driverChange(
    apexId,
    driver
  ) {
    if (!driver) {
      return;
    }

    const old =
      await this.getEntry(
        apexId
      );

    if (
      old?.current_driver ===
      driver
    ) {
      await this.refresh(
        apexId,
        false
      );

      return;
    }

    await this.closeStint(
      apexId,
      driver
    );

    await this.upsertEntry({
      apex_id:
        apexId,

      current_driver:
        driver
    });

    await this.refresh(
      apexId,
      true
    );
  }


  async lapCount(
    apexId,
    count
  ) {
    const old =
      await this.getEntry(
        apexId
      );

    const previous =
      Number(
        old?.lap_count ??
        -1
      );

    await this.upsertEntry({
      apex_id:
        apexId,

      lap_count:
        Number(count)
    });

    if (
      previous !==
      Number(count)
    ) {
      await this.refresh(
        apexId,
        true
      );
    }
  }


  async parse(payload) {
    for (
      const source
      of payload.split("\n")
    ) {
      const row =
        parseApexLine(
          source.trim()
        );

      if (!row) {
        continue;
      }

      if (
        row.field ===
        "dr"
      ) {
        await this.upsertEntry({
          apex_id:
            row.apexId,

          team_name:
            row.value
        });
      } else if (
        row.field ===
        "drteam"
      ) {
        await this.driverChange(
          row.apexId,

          row.value
            .replace(
              /\s*\[[^\]]+\]\s*$/,
              ""
            )
            .trim()
        );
      } else if (
        row.field ===
          "tn" &&
        row.column ===
          "9"
      ) {
        const time =
          parseLapTime(
            row.value
          );

        if (
          time !==
          null
        ) {
          await this.upsertEntry({
            apex_id:
              row.apexId,

            last_lap:
              time
          });
        }
      } else if (
        row.field ===
          "in" &&
        row.column ===
          "13" &&
        /^\d+$/.test(
          row.value
        )
      ) {
        await this.lapCount(
          row.apexId,
          Number(
            row.value
          )
        );
      }
    }
  }


  async packet(payload) {
    this.packetCount +=
      1;

    this.lastPacketAt =
      new Date()
        .toISOString();

    await sbInsert(
      this.env,
      "apex_raw_packets",
      {
        race_id:
          this.raceId,

        payload
      }
    );

    await this.parse(
      payload
    );

    if (
      this.packetCount %
        20 ===
      0
    ) {
      await this.state.storage.put({
        packetCount:
          this.packetCount,

        lastPacketAt:
          this.lastPacketAt
      });
    }
  }
}


// ============================================================
// COLLECTOR ROUTING
// ============================================================

function collector(env) {
  return env.APEX_COLLECTOR
    .get(
      env.APEX_COLLECTOR
        .idFromName(
          "primary"
        )
    );
}


async function callCollector(
  env,
  path
) {
  const response =
    await collector(env)
      .fetch(
        `https://collector${path}`
      );

  if (!response.ok) {
    throw new Error(
      `Collector ${path}: ` +
      `${response.status}`
    );
  }

  return response.json();
}


// ============================================================
// LIVE API
// ============================================================

async function livePayload(
  env,
  raceId
) {
  const entries =
    await sbGet(
      env,
      "apex_entries",
      {
        select:
          "*",

        race_id:
          `eq.${raceId}`,

        order:
          "updated_at.desc"
      }
    );

  const newest =
    entries.reduce(
      (
        latest,
        entry
      ) => {
        const time =
          Date.parse(
            entry.updated_at ||
            ""
          );

        return Number.isFinite(
          time
        )
          ? Math.max(
              latest,
              time
            )
          : latest;
      },
      0
    );

  if (
    !newest ||
    Date.now() -
      newest >
      180000
  ) {
    return {
      race_id:
        Number(raceId),

      generated_at:
        new Date()
          .toISOString(),

      active:
        false,

      current:
        [],

      entries:
        []
    };
  }

  const active =
    entries.filter(
      entry => {
        const time =
          Date.parse(
            entry.updated_at ||
            ""
          );

        return (
          Number.isFinite(
            time
          ) &&
          newest -
            time <=
            180000
        );
      }
    );

  const activeIds =
    new Set(
      active.map(
        entry =>
          String(
            entry.apex_id
          )
      )
    );

  const entryMap =
    new Map(
      active.map(
        entry => [
          String(
            entry.apex_id
          ),
          entry
        ]
      )
    );

  const [
    stints,
    pits
  ] =
    await Promise.all([
      sbGet(
        env,
        "live_stint_stats",
        {
          select:
            "*",

          race_id:
            `eq.${raceId}`,

          order:
            "team_name.asc"
        }
      ),

      sbGet(
        env,
        "apex_pit_stints",
        {
          select:
            "apex_id,pit_number",

          race_id:
            `eq.${raceId}`,

          order:
            "apex_id.asc,pit_number.asc"
        }
      )
    ]);

  const pitCount =
    new Map();

  for (const pit of pits) {
    const apexId =
      String(
        pit.apex_id
      );

    pitCount.set(
      apexId,

      Math.max(
        pitCount.get(
          apexId
        ) || 0,

        Number(
          pit.pit_number ||
          0
        )
      )
    );
  }

  const current = [];

  for (const stint of stints) {
    const apexId =
      String(
        stint.apex_id
      );

    if (
      !activeIds.has(
        apexId
      )
    ) {
      continue;
    }

    const entry =
      entryMap.get(
        apexId
      ) || {};

    current.push({
      race_id:
        stint.race_id,

      apex_id:
        stint.apex_id,

      team_name:
        stint.team_name ??
        entry.team_name ??
        null,

      driver_name:
        stint.driver_name ??
        entry.current_driver ??
        null,

      current_driver:
        stint.driver_name ??
        entry.current_driver ??
        null,

      stint_number:
        (
          pitCount.get(
            apexId
          ) || 0
        ) +
        1,

      start_lap_count:
        stint.start_lap_count ??
        null,

      end_lap_count:
        null,

      /*
       * Всички обиколки в текущия stint.
       */
      lap_count:
        stint.total_laps ??
        0,

      valid_laps:
        stint.valid_laps ??
        0,

      avg_lap_time:
        stint.avg_lap ??
        null,

      best_lap_time:
        stint.best_lap ??
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

      live_last_lap:
        entry.last_lap ??
        stint.last_lap ??
        null,

      live_best_lap:
        stint.best_lap ??
        entry.best_lap ??
        null,

      /*
       * Общата текуща Apex обиколка на отбора.
       */
      live_lap_count:
        entry.lap_count ??
        stint.current_lap_count ??
        null,

      updated_at:
        stint.updated_at ??
        entry.updated_at ??
        null
    });
  }

  const seen =
    new Set(
      current.map(
        row =>
          String(
            row.apex_id
          )
      )
    );

  for (const entry of active) {
    const apexId =
      String(
        entry.apex_id
      );

    if (
      seen.has(
        apexId
      )
    ) {
      continue;
    }

    current.push({
      race_id:
        entry.race_id,

      apex_id:
        entry.apex_id,

      team_name:
        entry.team_name ??
        null,

      driver_name:
        entry.current_driver ??
        null,

      current_driver:
        entry.current_driver ??
        null,

      stint_number:
        (
          pitCount.get(
            apexId
          ) || 0
        ) +
        1,

      start_lap_count:
        null,

      end_lap_count:
        null,

      lap_count:
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

      live_last_lap:
        entry.last_lap ??
        null,

      live_best_lap:
        entry.best_lap ??
        null,

      live_lap_count:
        entry.lap_count ??
        null,

      updated_at:
        entry.updated_at ??
        null
    });
  }

  current.sort(
    (a, b) =>
      String(
        a.team_name ||
        ""
      ).localeCompare(
        String(
          b.team_name ||
          ""
        )
      )
  );

  return {
    race_id:
      Number(raceId),

    generated_at:
      new Date()
        .toISOString(),

    active:
      true,

    current,

    entries:
      active
  };
}


// ============================================================
// STINTS API
// ============================================================

function numberStints(rows) {
  const groups =
    new Map();

  for (const row of rows) {
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

  const result = [];

  for (
    const group
    of groups.values()
  ) {
    group.sort(
      (a, b) =>
        Number(
          a.start_lap_count ||
          0
        ) -
        Number(
          b.start_lap_count ||
          0
        )
    );

    group.forEach(
      (
        row,
        index
      ) =>
        result.push({
          ...row,

          stint_number:
            index + 1
        })
    );
  }

  return result;
}


async function stintsPayload(
  env,
  raceId
) {
  const [
    completed,
    live
  ] =
    await Promise.all([
      sbGet(
        env,
        "completed_stint_stats",
        {
          select:
            "*",

          race_id:
            `eq.${raceId}`,

          order:
            "stint_ended_at.asc"
        }
      ),

      sbGet(
        env,
        "live_stint_stats",
        {
          select:
            "*",

          race_id:
            `eq.${raceId}`,

          order:
            "team_name.asc"
        }
      )
    ]);

  return numberStints([
    ...completed,

    ...live.map(
      row => ({
        ...row,

        is_live:
          true,

        end_lap_count:
          null,

        lap_count:
          row.total_laps ??
          0,

        avg_lap_time:
          row.avg_lap ??
          null,

        best_lap_time:
          row.best_lap ??
          null,

        worst_lap_time:
          row.worst_lap ??
          null
      })
    )
  ]);
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

    try {
      if (
        url.pathname ===
        "/api/health"
      ) {
        ctx.waitUntil(
          Promise.all([
            callCollector(
              env,
              "/start"
            ),

            callCollector(
              env,
              "/sync"
            )
          ])
            .catch(
              console.error
            )
        );

        return json({
          ok:
            true,

          service:
            "race-engineer",

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
          await callCollector(
            env,
            "/start"
          )
        );
      }


      if (
        url.pathname ===
        "/api/collector/sync"
      ) {
        return json(
          await callCollector(
            env,
            "/sync"
          )
        );
      }


      if (
        url.pathname ===
        "/api/collector/status"
      ) {
        return json(
          await callCollector(
            env,
            "/status"
          )
        );
      }


      if (
        url.pathname ===
        "/api/collector/reconnect"
      ) {
        return json(
          await callCollector(
            env,
            "/reconnect"
          )
        );
      }


      const raceId =
        raceIdFrom(
          url,
          env
        );


      if (
        url.pathname ===
        "/api/live"
      ) {
        ctx.waitUntil(
          Promise.all([
            callCollector(
              env,
              "/start"
            ),

            callCollector(
              env,
              "/sync"
            )
          ])
            .catch(
              console.error
            )
        );

        return json(
          await livePayload(
            env,
            raceId
          )
        );
      }


      if (
        url.pathname ===
        "/api/races"
      ) {
        /*
         * Историческите Apex sessions ще бъдат разделени
         * по Start/Finish, а не фалшиво по използвания race_id=1.
         */
        return json({
          rows: []
        });
      }


      if (
        url.pathname ===
        "/api/stints"
      ) {
        return json({
          race_id:
            raceId,

          rows:
            await stintsPayload(
              env,
              raceId
            )
        });
      }


      if (
        url.pathname ===
        "/api/drivers"
      ) {
        return json({
          race_id:
            raceId,

          rows:
            await sbGet(
              env,
              "driver_lap_totals_clean",
              {
                select:
                  "*",

                race_id:
                  `eq.${raceId}`,

                order:
                  "team_name.asc,driver_name.asc"
              }
            )
        });
      }


      if (
        url.pathname ===
        "/api/pits"
      ) {
        return json({
          race_id:
            raceId,

          rows:
            await sbGet(
              env,
              "apex_pit_stints",
              {
                select:
                  "*",

                race_id:
                  `eq.${raceId}`,

                order:
                  "apex_id.asc,pit_number.asc"
              }
            )
        });
      }


      return env.ASSETS.fetch(
        request
      );
    } catch (error) {
      console.error(
        "WORKER ERROR:",
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
      Promise.all([
        callCollector(
          env,
          "/start"
        ),

        callCollector(
          env,
          "/sync"
        )
      ])
        .catch(
          console.error
        )
    );
  }
};
