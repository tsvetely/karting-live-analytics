require("dotenv").config();

const WebSocket = require("ws");
const { createClient } = require("@supabase/supabase-js");

// const APEX_WS_URL = "wss://live-data.apex-timing.com:7653/";
const APEX_WS_URL = "wss://live-data.apex-timing.com:8913/";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const raceId = Number(process.env.RACE_ID || 1);
let packetCount = 0;

function parseApexLine(line) {
  const match = line.match(/^r(\d+)(?:c(\d+))?\|([^|]+)\|(.*)$/);
  if (!match) return null;

  return {
    apexId: match[1],
    column: match[2] || null,
    field: match[3],
    value: match[4] || ""
  };
}

async function saveRaw(payload) {
  const { error } = await supabase
    .from("apex_raw_packets")
    .insert({
      race_id: raceId,
      payload
    });

  if (error) {
    console.error("Raw insert error:", error.message);
  }
}

async function upsertEntry(update) {
  const { error } = await supabase
    .from("apex_entries")
    .upsert(
      {
        race_id: raceId,
        apex_id: update.apex_id,
        team_name: update.team_name,
        current_driver: update.current_driver,
        last_lap: update.last_lap,
        best_lap: update.best_lap,
        lap_count: update.lap_count,
        updated_at: new Date().toISOString()
      },
      { onConflict: "race_id,apex_id" }
    );

  if (error) {
    console.error("Entry upsert error:", error.message);
  }
}

function parseLapTime(value) {
  if (!value) return null;

  if (value.includes(":")) {
    const [minutes, seconds] = value.split(":");
    const total = Number(minutes) * 60 + Number(seconds);
    return Number.isNaN(total) ? null : total;
  }

  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

async function saveLapEvent(apexId, lapNumber, lapTime) {
  if (!apexId) return;
  if (!Number.isFinite(Number(lapNumber))) return;
  if (!Number.isFinite(Number(lapTime))) return;

  const { error } = await supabase
    .from("apex_lap_events")
    .upsert(
      {
        race_id: raceId,
        apex_id: String(apexId),
        lap_number: Number(lapNumber),
        lap_time: Number(lapTime),
        received_at: new Date().toISOString()
      },
      {
        onConflict: "race_id,apex_id,lap_number"
      }
    );

  if (error) {
    console.error("LAP EVENT UPSERT ERROR:", error.message, {
      apexId,
      lapNumber,
      lapTime
    });
  }
}

// async function handleDriverChange(apexId, driverName) {
//   const { data: entry } = await supabase
//     .from("apex_entries")
//     .select("team_name,current_driver,lap_count")
//     .eq("race_id", raceId)
//     .eq("apex_id", apexId)
//     .maybeSingle();

//   if (!entry) return;
//   if (!driverName) return;
//   if (entry.current_driver === driverName) return;

//   const safeLapCount = await getSafeLapCount(apexId);

//   if (!safeLapCount || safeLapCount < 100) {
//     console.log("Skipping driver stint because lap_count is unsafe", {
//       apexId,
//       driverName,
//       safeLapCount
//     });
//     return;
//   }

//   if (entry.current_driver) {
//     await supabase
//       .from("driver_stints")
//       .update({
//         stint_end_at: new Date().toISOString(),
//         end_lap_count: safeLapCount
//       })
//       .eq("race_id", raceId)
//       .eq("apex_id", apexId)
//       .is("stint_end_at", null);
//   }

//   if (!entry.lap_count || entry.lap_count < 100) {
//     console.log("Skip driver change, unsafe lap count", {
//         apexId,
//         driverName,
//         lapCount: entry.lap_count
//     });
//     return;
//   }

//   const { error } = await supabase
//     .from("driver_stints")
//     .insert({
//       race_id: raceId,
//       apex_id: apexId,
//       team_name: entry.team_name,
//       driver_name: driverName,
//       stint_start_at: new Date().toISOString(),
//       start_lap_count: entry.lap_count
//     });

//   if (error) {
//     console.error("Driver stint insert error:", error.message);
//   }
// }

async function handleDriverChange(apexId, driverName) {

  if (!driverName) return;

  const { data: before } = await supabase
    .from("apex_entries")
    .select("team_name,current_driver,lap_count")
    .eq("race_id", raceId)
    .eq("apex_id", apexId)
    .maybeSingle();

  if (!before) return;

  console.log("DRIVER PACKET:", {
    apexId,
    team: before.team_name,
    oldDriver: before.current_driver,
    newDriver: driverName,
    lapCount: before.lap_count
  });


  // ============================================================
  // CLOSE THE CURRENT LIVE STINT BEFORE CHANGING THE DRIVER
  // ============================================================

  const { data: liveStint, error: liveStintError } = await supabase
    .from("live_stint_stats")
    .select("*")
    .eq("race_id", raceId)
    .eq("apex_id", String(apexId))
    .maybeSingle();

  if (liveStintError) {
    console.error(
      "LIVE STINT READ ERROR:",
      apexId,
      liveStintError.message
    );
  }

  if (
    liveStint &&
    liveStint.driver_name &&
    liveStint.driver_name !== driverName
  ) {

    const { error: completedStintError } = await supabase
      .from("completed_stint_stats")
      .insert({
        race_id: raceId,
        apex_id: String(apexId),

        team_name: liveStint.team_name,
        driver_name: liveStint.driver_name,

        start_lap_count: liveStint.start_lap_count,
        end_lap_count: liveStint.current_lap_count,

        total_laps: liveStint.total_laps,
        valid_laps: liveStint.valid_laps,

        avg_lap: liveStint.avg_lap,

        best_lap: liveStint.best_lap,
        best_lap_number: liveStint.best_lap_number,

        worst_lap: liveStint.worst_lap,
        worst_lap_number: liveStint.worst_lap_number,

        consistency: liveStint.consistency,

        stint_started_at: liveStint.stint_started_at,
        stint_ended_at: new Date().toISOString()
      });

    if (completedStintError) {
      console.error(
        "COMPLETED STINT INSERT ERROR:",
        apexId,
        completedStintError.message
      );
    } else {

      console.log("LIVE STINT CLOSED:", {
        apexId,
        driver: liveStint.driver_name,
        startLap: liveStint.start_lap_count,
        endLap: liveStint.current_lap_count,
        laps: liveStint.total_laps
      });

      const { error: deleteLiveStintError } = await supabase
        .from("live_stint_stats")
        .delete()
        .eq("race_id", raceId)
        .eq("apex_id", String(apexId));

      if (deleteLiveStintError) {
        console.error(
          "LIVE STINT DELETE ERROR:",
          apexId,
          deleteLiveStintError.message
        );
      }
    }
  }


  // ============================================================
  // NOW CHANGE THE CURRENT DRIVER
  // ============================================================

  await supabase
    .from("apex_entries")
    .update({
      current_driver: driverName,
      updated_at: new Date().toISOString()
    })
    .eq("race_id", raceId)
    .eq("apex_id", apexId);


  // ============================================================
  // EXISTING PIT/STINT LOGIC
  // ============================================================

  await fetchAndSavePits(apexId, before.team_name);
}

function msToTime(ms) {
  if (!Number.isFinite(ms)) return null;

  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function msToPitTime(ms) {
  if (!Number.isFinite(ms)) return null;

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const millis = String(ms % 1000).padStart(3, "0");

  return `${minutes}:${seconds}.${millis}`;
}

function parseDriverNamesFromInf(infLine) {
  const drivers = new Map();

  const regex = /<driver\s+[^>]*id="(\d+)"[^>]*name="([^"]+)"/g;
  let match;

  while ((match = regex.exec(infLine)) !== null) {
    drivers.set(Number(match[1]), match[2]);
  }

  return drivers;
}

function parseApexPitLines(rawText, teamName) {
  const lines = rawText.split("\n").map(x => x.trim()).filter(Boolean);

  const infLine = lines.find(line => line.includes(".INF#"));
  const driverNames = infLine ? parseDriverNamesFromInf(infLine) : new Map();

  return lines
    .filter(line => /\.P\d+#/.test(line))
    .map(line => {
      const [, apexId, pitCode, body] = line.match(/^D(\d+)\.P(\d+)#(.+)$/) || [];
      if (!apexId || !body) return null;

      const parts = body.split("|");

      const pitNumber = Number(parts[0]);
      const pitLap = Number(parts[1]);
      const pitInMs = Number(parts[2]);
      const pitOutMs = Number(parts[3]);
      const pitTimeMs = Number(parts[4]);
      const onTrackMs = Number(parts[5]);
      const onTrackLaps = Number(parts[6]);
      const driverId = Number(parts[7]);
      const driverTotalMs = Number(parts[8]);

      return {
        race_id: raceId,
        apex_id: Number(apexId),
        team_name: teamName,
        pit_number: pitNumber,
        pit_lap: pitLap,
        pit_hour: msToTime(pitInMs),
        on_track: msToTime(onTrackMs),
        driver_name: driverNames.get(driverId) || null,
        total_time: msToTime(driverTotalMs),
        pit_time: msToPitTime(pitTimeMs),
        updated_at: new Date().toISOString()
      };
    })
    .filter(Boolean);
}

async function saveApexPitLines(rawText, teamName) {
  const rows = parseApexPitLines(rawText, teamName);

  console.log("PITS PARSED:", rows.length, rows.slice(0, 3));

  if (!rows.length) return;

  const { error } = await supabase
    .from("apex_pit_stints")
    .upsert(rows, {
      onConflict: "race_id,apex_id,pit_number"
    });

  if (error) {
    console.error("PIT UPSERT ERROR:", error.message);
    return;
  }

  console.log("PITS SAVED:", teamName, rows.length);

  await rebuildDriverStintsFromPits(apexId);
}

async function upsertPitStints(apexId, teamName, pitRows) {
  if (!pitRows?.length) return;

  const rows = pitRows.map(row => ({
    race_id: raceId,
    apex_id: Number(apexId),
    team_name: teamName,
    pit_number: Number(row.pitNumber),
    pit_lap: Number(row.pitLap),
    pit_hour: row.hour || null,
    on_track: row.onTrack || null,
    driver_name: row.driverName || null,
    total_time: row.totalTime || null,
    pit_time: row.pitTime || null,
    updated_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from("apex_pit_stints")
    .upsert(rows, {
      onConflict: "race_id,apex_id,pit_number"
    });

  if (error) {
    console.error("PIT STINT UPSERT ERROR:", error.message);
    return;
  }

  console.log("PIT STINTS SAVED:", {
    apexId,
    teamName,
    count: rows.length,
    latestPit: rows[0]
  });

  await rebuildDriverStintsFromPits(apexId);
}

async function rebuildDriverStintsFromPits(apexId) {
  const apexIdText = String(apexId);
  const now = new Date().toISOString();

  console.log("REBUILD START:", { apexId: apexIdText });

  const { data: entry, error: entryError } = await supabase
    .from("apex_entries")
    .select("team_name,current_driver,lap_count")
    .eq("race_id", raceId)
    .eq("apex_id", apexIdText)
    .maybeSingle();

  if (entryError || !entry) {
    console.error("REBUILD ENTRY ERROR:", {
      apexId: apexIdText,
      error: entryError?.message
    });
    return;
  }

  const { data: pits, error: pitsError } = await supabase
    .from("apex_pit_stints")
    .select("pit_number,pit_lap,driver_name")
    .eq("race_id", raceId)
    .eq("apex_id", Number(apexId))
    .order("pit_number", { ascending: true });

  if (pitsError) {
    console.error("REBUILD PITS ERROR:", pitsError.message);
    return;
  }

  if (!pits?.length) {
    console.log("REBUILD NO PITS:", { apexId: apexIdText });
    return;
  }

  const stints = [];
  let startLap = 0;

  for (const pit of pits) {
    if (!pit.driver_name || !Number.isFinite(Number(pit.pit_lap))) continue;

    stints.push({
      race_id: raceId,
      apex_id: apexIdText,
      team_name: entry.team_name,
      driver_name: pit.driver_name,
      stint_start_at: now,
      stint_end_at: now,
      start_lap_count: startLap,
      end_lap_count: Number(pit.pit_lap)
    });

    startLap = Number(pit.pit_lap);
  }

  if (entry.current_driver) {
    stints.push({
      race_id: raceId,
      apex_id: apexIdText,
      team_name: entry.team_name,
      driver_name: entry.current_driver,
      stint_start_at: now,
      stint_end_at: null,
      start_lap_count: startLap,
      end_lap_count: null
    });
  }

  if (!stints.length) {
    console.log("REBUILD NO STINTS:", { apexId: apexIdText });
    return;
  }

  console.log("REBUILD DELETE:", {
    apexId: apexIdText,
    newCount: stints.length,
    first: stints[0],
    last: stints[stints.length - 1]
  });

  const { error: deleteError } = await supabase
    .from("driver_stints")
    .delete()
    .eq("race_id", raceId)
    .eq("apex_id", apexIdText);

  if (deleteError) {
    console.error("REBUILD DELETE ERROR:", deleteError.message);
    return;
  }

  const { error: insertError } = await supabase
    .from("driver_stints")
    .insert(stints);

  if (insertError) {
    console.error("REBUILD INSERT ERROR:", insertError.message);
    return;
  }

  console.log("DRIVER STINTS REBUILT:", {
    apexId: apexIdText,
    team: entry.team_name,
    count: stints.length
  });
}

async function getSafeLapCount(apexId) {
  const { data: entry } = await supabase
    .from("apex_entries")
    .select("lap_count")
    .eq("race_id", raceId)
    .eq("apex_id", apexId)
    .maybeSingle();

  return entry?.lap_count ?? null;
}

async function updateLapCount(apexId, newLapCount) {
  const { data: entry } = await supabase
    .from("apex_entries")
    .select("lap_count")
    .eq("race_id", raceId)
    .eq("apex_id", apexId)
    .maybeSingle();

  const currentLapCount = entry?.lap_count ?? 0;

  if (newLapCount <= currentLapCount) {
    return;
  }

  await upsertEntry({
    apex_id: apexId,
    lap_count: newLapCount
  });

  await processLiveLap(apexId, newLapCount);
}

async function processLiveLap(apexId, lapNumber) {
  const { data: entry, error } = await supabase
    .from("apex_entries")
    .select("team_name,current_driver,last_lap,lap_count")
    .eq("race_id", raceId)
    .eq("apex_id", apexId)
    .maybeSingle();

  if (error || !entry) return;

  const lapTime = Number(entry.last_lap);

  if (!Number.isFinite(lapTime)) return;
  if (!Number.isFinite(Number(lapNumber))) return;

  // persistent lap history
  await saveLapEvent(apexId, lapNumber, lapTime);

  // current stint state
  await updateLiveStintStats({
    apexId,
    lapNumber: Number(lapNumber),
    lapTime,
    teamName: entry.team_name,
    driverName: entry.current_driver
  });
}

async function handlePitEvent({ apexId, pitNo, pitLap, driverName, totalTime, pitTime }) {
  const { data: entry } = await supabase
    .from("apex_entries")
    .select("team_name,current_driver,lap_count")
    .eq("race_id", raceId)
    .eq("apex_id", apexId)
    .maybeSingle();

  if (!entry) return;

  await supabase.from("apex_pit_events").insert({
    race_id: raceId,
    apex_id: apexId,
    pit_no: pitNo,
    pit_lap: pitLap,
    driver_name: driverName,
    total_time: totalTime,
    pit_time: pitTime
  });

  await supabase
    .from("driver_stints")
    .update({
      stint_end_at: new Date().toISOString(),
      end_lap_count: pitLap
    })
    .eq("race_id", raceId)
    .eq("apex_id", apexId)
    .is("stint_end_at", null);

  await supabase.from("driver_stints").insert({
    race_id: raceId,
    apex_id: apexId,
    team_name: entry.team_name,
    driver_name: driverName,
    stint_start_at: new Date().toISOString(),
    start_lap_count: pitLap
  });
}

async function updateLiveStintStats({
  apexId,
  lapNumber,
  lapTime,
  teamName,
  driverName
}) {
  const { data: current } = await supabase
    .from("live_stint_stats")
    .select("*")
    .eq("race_id", raceId)
    .eq("apex_id", String(apexId))
    .maybeSingle();

  const now = new Date().toISOString();

  // first lap of live state / new stint
  if (!current || current.driver_name !== driverName) {
    await supabase
      .from("live_stint_stats")
      .upsert({
        race_id: raceId,
        apex_id: String(apexId),
        team_name: teamName,
        driver_name: driverName,

        start_lap_count: lapNumber,
        current_lap_count: lapNumber,

        total_laps: 1,
        valid_laps: 1,

        lap_sum: lapTime,
        lap_sum_squares: lapTime * lapTime,

        last_lap: lapTime,
        avg_lap: lapTime,

        best_lap: lapTime,
        best_lap_number: lapNumber,

        worst_lap: lapTime,
        worst_lap_number: lapNumber,

        consistency: 0,

        stint_started_at: now,
        updated_at: now
      }, {
        onConflict: "race_id,apex_id"
      });

    return;
  }

  // idempotency: do not count the same lap twice
  if (
    current.current_lap_count !== null &&
    Number(lapNumber) <= Number(current.current_lap_count)
  ) {
    return;
  }

  const validLaps = Number(current.valid_laps || 0) + 1;
  const totalLaps = Number(current.total_laps || 0) + 1;

  const sum =
    Number(current.lap_sum || 0) +
    lapTime;

  const sumSquares =
    Number(current.lap_sum_squares || 0) +
    lapTime * lapTime;

  const avg = sum / validLaps;

  const variance =
    Math.max(0, sumSquares / validLaps - avg * avg);

  const consistency = Math.sqrt(variance);

  const isBest =
    current.best_lap === null ||
    lapTime < Number(current.best_lap);

  const isWorst =
    current.worst_lap === null ||
    lapTime > Number(current.worst_lap);

  await supabase
    .from("live_stint_stats")
    .update({
      team_name: teamName,
      driver_name: driverName,

      current_lap_count: lapNumber,

      total_laps: totalLaps,
      valid_laps: validLaps,

      lap_sum: sum,
      lap_sum_squares: sumSquares,

      last_lap: lapTime,
      avg_lap: avg,

      best_lap: isBest ? lapTime : current.best_lap,
      best_lap_number: isBest
        ? lapNumber
        : current.best_lap_number,

      worst_lap: isWorst
        ? lapTime
        : current.worst_lap,

      worst_lap_number: isWorst
        ? lapNumber
        : current.worst_lap_number,

      consistency,
      updated_at: now
    })
    .eq("race_id", raceId)
    .eq("apex_id", String(apexId));
}

async function parseAndSave(payload) {
  const lines = payload.split("\n");

  for (const line of lines) {
    const parsed = parseApexLine(line.trim());
    if (!parsed) continue;

    const { apexId, field, value } = parsed;

    if (field === "dr") {
      await upsertEntry({
        apex_id: apexId,
        team_name: value
      });
    }

    if (field === "drteam") {
        const driverName = value.replace(/\s*\[[^\]]+\]\s*$/, "").trim();

        await handleDriverChange(apexId, driverName);

        await upsertEntry({
            apex_id: apexId,
            current_driver: driverName
        });
    }

    if (field === "tn" && parsed.column === "9") {
        const lapTime = parseLapTime(value);

        if (lapTime !== null) {
            await upsertEntry({
            apex_id: apexId,
            last_lap: lapTime
            });
        }
    }

    if (field === "in" && parsed.column === "13" && /^\d+$/.test(value)) {
        await updateLapCount(apexId, Number(value));
    }   
  }
}

function parseLapRows(raw) {
  return raw
    .split("\n")
    .map(x => x.trim())
    .filter(line => line.includes(".L"))
    .map(line => {
      const match = line.match(/^D(\d+)\.L0*(\d+)#(.+)$/);

      if (!match) {
        console.log("LAP REJECT NO MATCH:", line);
        return null;
      }

      const apexId = match[1];
      const lapNumber = Number(match[2]);
      const parts = match[3].split("|");

      const lapTimeMs = Number(parts[3]);

      if (!Number.isFinite(lapTimeMs)) {
        console.log("LAP REJECT BAD TIME:", {
          lapNumber,
          line,
          parts
        });
        return null;
      }

      return {
        race_id: raceId,
        apex_id: String(apexId),
        lap_number: lapNumber,
        lap_time: Number((lapTimeMs / 1000).toFixed(3)),
        received_at: new Date().toISOString()
      };
    })
    .filter(Boolean);
}

async function upsertLapEventsFromRaw(raw) {
  const rows = parseLapRows(raw);

  const found = new Set(rows.map(r => r.lap_number));
  const maxLap = Math.max(...rows.map(r => r.lap_number));

  const missing = [];
  for (let i = 1; i <= maxLap; i++) {
    if (!found.has(i)) missing.push(i);
  }

  console.log("LAP GAP CHECK:", {
    count: rows.length,
    min: Math.min(...rows.map(r => r.lap_number)),
    max: maxLap,
    missingCount: missing.length,
    firstMissing: missing.slice(0, 30)
  });

  if (!rows.length) {
    console.log("LAP ROWS: none");
    return;
  }

  const { error } = await supabase
    .from("apex_lap_events")
    .upsert(rows, {
      onConflict: "race_id,apex_id,lap_number"
    });

  if (error) {
    console.error("LAP EVENTS UPSERT ERROR:", error.message);
    return;
  }

  console.log("LAP EVENTS SAVED:", {
    apexId: rows[0].apex_id,
    count: rows.length,
    first: rows[0],
    last: rows[rows.length - 1]
  });
}

console.log("Starting Apex live collector...");
console.log("Race ID:", raceId);
console.log("Connecting to:", APEX_WS_URL);

const ws = new WebSocket(APEX_WS_URL);

ws.on("open", () => {
  console.log("Connected to Apex WebSocket");
});

function msToTime(ms) {
  const totalSeconds = Math.floor(Number(ms) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function msToPitTime(ms) {
  ms = Number(ms);
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = String(totalSeconds % 60).padStart(2, "0");
  const milli = String(ms % 1000).padStart(3, "0");

  return `${m}:${s}.${milli}`;
}

function parseDriversFromInf(raw) {
  const drivers = new Map();
  const regex = /<driver\s+[^>]*id="(\d+)"[^>]*name="([^"]+)"/g;
  let match;

  while ((match = regex.exec(raw)) !== null) {
    drivers.set(Number(match[1]), match[2]);
  }

  return drivers;
}

function parsePitResponse(raw, teamName) {
  const drivers = parseDriversFromInf(raw);

  return raw
    .split("\n")
    .map((x) => x.trim())
    .filter((line) => /^D\d+\.P\d+#/.test(line))
    .map((line) => {
      const match = line.match(/^D(\d+)\.P\d+#(.+)$/);
      if (!match) return null;

      const apexId = Number(match[1]);
      const p = match[2].split("|");

      return {
        race_id: raceId,
        apex_id: apexId,
        team_name: teamName,
        pit_number: Number(p[0]),
        pit_lap: Number(p[1]),
        pit_hour: msToTime(p[2]),
        on_track: msToTime(p[5]),
        driver_name: drivers.get(Number(p[7])) || null,
        total_time: msToTime(p[8]),
        pit_time: msToPitTime(p[4]),
        updated_at: new Date().toISOString()
      };
    })
    .filter(Boolean);
}

async function fetchAndSavePits(apexId, teamName) {
  const { data: entry } = await supabase
    .from("apex_entries")
    .select("lap_count")
    .eq("race_id", raceId)
    .eq("apex_id", apexId)
    .maybeSingle();

  const lapCount = Number(entry?.lap_count || 0);

  if (!lapCount) {
    console.log("SKIP FETCH PITS/LAPS: missing lap_count", { apexId, teamName });
    return;
  }

  const lapLimit = Math.max(Number(entry?.lap_count || 0), 1);

    const request =
    `D#-${lapLimit}` +
    `#D${apexId}.L#-${lapLimit}` +
    `#D${apexId}.P#-999` +
    `#D${apexId}.B#1` +
    `#D${apexId}.INF`;

    console.log("DETAIL REQUEST:", { apexId, lapLimit, request });

  const res = await fetch(
    "https://live-data.apex-timing.com/live-timing/commonv2/functions/request.php",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      body: new URLSearchParams({
        port: "8910",
        request
      })
    }
  );

  const raw = await res.text();

  for (const line of raw.split("\n")) {
    if (
        line.includes("D24584.L0523") ||
        line.includes("D24584.L523") ||
        line.includes("L0523")
    ) {
        console.log("RAW LAP 523:", line);
    }
  }

  const lapRows = parseLapRows(raw);

  console.log("LAP ROWS PARSED:", {
    apexId,
    count: lapRows.length,
    min: Math.min(...lapRows.map(x => x.lap_number)),
    max: Math.max(...lapRows.map(x => x.lap_number))
  });

  await upsertLapEventsFromRaw(raw);

  await upsertLapEventsFromRaw(raw);
  await rebuildDriverStintsFromPits(apexId);

  const rows = parsePitResponse(raw, teamName);

  console.log("PITS PARSED:", {
    apexId,
    teamName,
    count: rows.length,
    first: rows[0]
  });

  if (!rows.length) return;

  const { error } = await supabase
    .from("apex_pit_stints")
    .upsert(rows, {
      onConflict: "race_id,apex_id,pit_number"
    });

  if (error) {
    console.error("PITS SAVE ERROR:", error.message);
    return;
  }

  console.log("PITS SAVED:", teamName, rows.length);

  await rebuildDriverStintsFromPits(apexId);
}

ws.on("message", async (data) => {
  const payload = data.toString();
  
  packetCount += 1;

  console.log(`Packet #${packetCount}`);

  await saveRaw(payload);
  await parseAndSave(payload);
});

ws.on("close", () => {
  console.log("Apex WebSocket closed");
});

ws.on("error", (error) => {
  console.error("Apex WebSocket error:", error.message);
});