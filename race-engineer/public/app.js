const S = {
  live: [],
  stints: [],
  drivers: [],
  teams: [],
  pits: [],
  events: [],

  activeView: "live",

  loaded: {
    stints: false,
    drivers: false,
    teams: false,
    pits: false,
    events: false
  },

  liveMeta: null,
  timer: null,

  mode: "live",
  selectedRaceId: null
};


const $ = id => document.getElementById(id);


const esc = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char])
  );


// ============================================================
// BASIC HELPERS
// ============================================================

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}


function time(value) {
  const seconds = number(value);

  if (seconds === null) {
    return "—";
  }

  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);

    const rest = (seconds - minutes * 60)
      .toFixed(3)
      .padStart(6, "0");

    return `${minutes}:${rest}`;
  }

  return seconds.toFixed(3);
}


function pick(object, ...keys) {
  for (const key of keys) {
    if (
      object &&
      object[key] !== undefined &&
      object[key] !== null &&
      object[key] !== ""
    ) {
      return object[key];
    }
  }

  return null;
}


function sum(rows, getter) {
  return rows.reduce(
    (total, row) => total + (number(getter(row)) || 0),
    0
  );
}


function average(values) {
  const clean = values
    .map(number)
    .filter(value => value !== null);

  if (!clean.length) {
    return null;
  }

  return clean.reduce((a, b) => a + b, 0) / clean.length;
}


// ============================================================
// API
// ============================================================

async function api(path, raceId = null) {
  const url = new URL(path, window.location.origin);

  if (raceId !== null && raceId !== undefined && raceId !== "") {
    url.searchParams.set("race_id", String(raceId));
  }

  const response = await fetch(url, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}


// ============================================================
// STATUS / HEADER / MODE
// ============================================================

function setStatus(ok, message) {
  $("status").textContent = message;
  $("liveDot").className = `dot ${ok ? "ok" : "bad"}`;
}


function updateHeader(meta = S.liveMeta) {
  const active = meta?.active === true;

  $("sessionName").textContent =
    meta?.session_name ||
    meta?.session ||
    "Apex Timing";

  $("sessionStatus").textContent =
    active
      ? "LIVE"
      : "NO LIVE SESSION";

  $("headerTeamCount").textContent =
    S.mode === "live" && active
      ? S.live.length
      : 0;

  $("teamCount").textContent =
    S.mode === "live" && active
      ? filterRows(S.live).length
      : 0;

  const banner = $("modeBanner");
  const label = $("modeLabel");
  const title = $("modeTitle");

  if (banner && label && title) {
    banner.classList.remove(
      "live",
      "noLive",
      "history"
    );

    if (S.mode === "history") {
      banner.classList.add("history");

      label.textContent = "HISTORY";

      const selected =
        $("historyRace")?.selectedOptions?.[0];

      title.textContent =
        selected?.value
          ? selected.textContent
          : "Select race / session";

    } else if (active) {
      banner.classList.add("live");

      label.textContent = "LIVE";

      title.textContent =
        meta?.session_name ||
        meta?.session ||
        "Active Apex Timing session";

    } else {
      banner.classList.add("noLive");

      label.textContent = "NO LIVE";

      title.textContent =
        "No active timing session";
    }
  }

  const historySelector =
    $("historySelector");

  if (historySelector) {
    historySelector.classList.toggle(
      "hidden",
      S.mode !== "history"
    );
  }

  const auto = $("auto");

  if (auto) {
    auto.disabled =
      S.mode !== "live";
  }
}


// ============================================================
// FILTERS
// ============================================================

function currentRowsForFilters() {
  switch (S.activeView) {
    case "live":
      return S.live;

    case "stints":
      return S.stints;

    case "drivers":
      return S.drivers;

    case "teamsView":
      return S.teams;

    case "pits":
      return S.pits;

    case "events":
      return S.events;

    default:
      return [];
  }
}


function filterRows(rows) {
  const search =
    $("search").value
      .trim()
      .toLowerCase();

  const selectedTeam =
    $("teamFilter").value;

  const selectedDriver =
    $("driverFilter").value;

  return rows.filter(row => {
    const team =
      String(row.team_name || "");

    const driver =
      String(
        row.driver_name ||
        row.current_driver ||
        ""
      );

    const searchable = [
      team,
      driver,
      row.apex_id,
      row.kart,
      row.kart_number
    ]
      .filter(
        value =>
          value !== undefined &&
          value !== null
      )
      .join(" ")
      .toLowerCase();

    const teamOk =
      !selectedTeam ||
      team === selectedTeam;

    const driverOk =
      !selectedDriver ||
      driver === selectedDriver;

    const searchOk =
      !search ||
      searchable.includes(search);

    return (
      teamOk &&
      driverOk &&
      searchOk
    );
  });
}


function rebuildFilters() {
  const rows =
    currentRowsForFilters();

  const teamSelect =
    $("teamFilter");

  const driverSelect =
    $("driverFilter");

  const oldTeam =
    teamSelect.value;

  const oldDriver =
    driverSelect.value;

  const teams = [
    ...new Set(
      rows
        .map(row => row.team_name)
        .filter(Boolean)
    )
  ].sort();

  const drivers = [
    ...new Set(
      rows
        .map(
          row =>
            row.driver_name ||
            row.current_driver
        )
        .filter(Boolean)
    )
  ].sort();

  teamSelect.innerHTML =
    '<option value="">All teams</option>' +
    teams
      .map(
        team =>
          `<option value="${esc(team)}">${esc(team)}</option>`
      )
      .join("");

  driverSelect.innerHTML =
    '<option value="">All drivers</option>' +
    drivers
      .map(
        driver =>
          `<option value="${esc(driver)}">${esc(driver)}</option>`
      )
      .join("");

  if (teams.includes(oldTeam)) {
    teamSelect.value = oldTeam;
  }

  if (drivers.includes(oldDriver)) {
    driverSelect.value = oldDriver;
  }
}


function resetFilters() {
  $("teamFilter").value = "";
  $("driverFilter").value = "";
  $("search").value = "";

  renderActiveView();
}


// ============================================================
// STINT NUMBER
// ============================================================

function stintNumber(row) {
  if (
    row.stint_number !== undefined &&
    row.stint_number !== null
  ) {
    return row.stint_number;
  }

  if (
    row.start_lap_count === undefined ||
    row.start_lap_count === null
  ) {
    return "—";
  }

  const teamStints =
    S.stints
      .filter(
        stint =>
          String(stint.apex_id) ===
          String(row.apex_id)
      )
      .sort(
        (a, b) =>
          Number(a.start_lap_count || 0) -
          Number(b.start_lap_count || 0)
      );

  const index =
    teamStints.findIndex(
      stint =>
        String(stint.start_lap_count) ===
        String(row.start_lap_count)
    );

  return index >= 0
    ? index + 1
    : teamStints.length
      ? teamStints.length + 1
      : "—";
}


// ============================================================
// LIVE
// ============================================================

function renderLive() {
  const rows =
    filterRows(S.live);

  $("teamCount").textContent =
    rows.length;

  $("headerTeamCount").textContent =
    S.live.length;

  $("liveBody").innerHTML =
    rows
      .map(
        row => `
<tr
  class="clickableRow"
  data-detail-type="team"
  data-team="${esc(row.team_name || "")}"
  data-apex-id="${esc(row.apex_id)}"
>

  <td class="team">
    ${esc(
      row.team_name ||
      `APEX ${row.apex_id}`
    )}
  </td>

  <td>
    ${esc(
      row.driver_name ||
      row.current_driver ||
      "—"
    )}
  </td>

  <td>
    #${esc(stintNumber(row))}
  </td>

  <td>
    ${esc(
      pick(
        row,
        "valid_laps",
        "lap_count",
        "live_lap_count",
        "total_laps"
      ) ?? "—"
    )}
  </td>

  <td>
    ${time(
      pick(
        row,
        "live_last_lap",
        "last_lap"
      )
    )}
  </td>

  <td>
    ${time(
      pick(
        row,
        "avg_lap_time",
        "avg_lap"
      )
    )}
  </td>

  <td class="good">
    ${time(
      pick(
        row,
        "best_lap_time",
        "best_lap",
        "live_best_lap"
      )
    )}
  </td>

  <td>
    ${esc(
      pick(
        row,
        "best_lap_number"
      ) ?? "—"
    )}
  </td>

  <td class="bad">
    ${time(
      pick(
        row,
        "worst_lap_time",
        "worst_lap",
        "max_lap_time"
      )
    )}
  </td>

  <td>
    ${esc(
      pick(
        row,
        "worst_lap_number"
      ) ?? "—"
    )}
  </td>

  <td>
    ${time(
      pick(
        row,
        "consistency",
        "consistency_time",
        "lap_consistency"
      )
    )}
  </td>

  <td class="muted">
    ${
      row.updated_at
        ? new Date(
            row.updated_at
          ).toLocaleTimeString()
        : "—"
    }
  </td>

</tr>
`
      )
      .join("") ||

    `
<tr class="empty">
  <td colspan="12">
    ${
      S.liveMeta?.active === false
        ? "No active live timing session."
        : "No live race data."
    }
  </td>
</tr>
`;
}


// ============================================================
// STINTS
// ============================================================

function renderStints() {
  const rows =
    filterRows(S.stints);

  $("stintsBody").innerHTML =
    rows
      .map(
        row => `
<tr
  class="clickableRow"
  data-detail-type="team"
  data-team="${esc(row.team_name || "")}"
  data-apex-id="${esc(row.apex_id)}"
>

  <td class="team">
    ${esc(
      row.team_name ||
      `APEX ${row.apex_id}`
    )}
  </td>

  <td>
    ${esc(row.driver_name || "—")}
  </td>

  <td>
    #${esc(
      row.stint_number ||
      stintNumber(row)
    )}
  </td>

  <td>
    ${esc(
      row.start_lap_count ?? "—"
    )}
  </td>

  <td>
    ${esc(
      row.end_lap_count ?? "—"
    )}
  </td>

  <td>
    ${esc(
      pick(
        row,
        "valid_laps",
        "lap_count",
        "total_laps"
      ) ?? "—"
    )}
  </td>

  <td>
    ${time(
      pick(
        row,
        "avg_lap_time",
        "avg_lap"
      )
    )}
  </td>

  <td class="good">
    ${time(
      pick(
        row,
        "best_lap_time",
        "best_lap"
      )
    )}
  </td>

  <td>
    ${esc(
      row.best_lap_number ?? "—"
    )}
  </td>

  <td class="bad">
    ${time(
      pick(
        row,
        "worst_lap_time",
        "worst_lap",
        "max_lap_time"
      )
    )}
  </td>

  <td>
    ${esc(
      row.worst_lap_number ?? "—"
    )}
  </td>

  <td>
    ${time(
      pick(
        row,
        "consistency",
        "consistency_time",
        "lap_consistency"
      )
    )}
  </td>

</tr>
`
      )
      .join("") ||

    `
<tr class="empty">
  <td colspan="12">
    ${
      S.selectedRaceId
        ? "No stint data for this race."
        : "Select a race / session."
    }
  </td>
</tr>
`;
}


// ============================================================
// DRIVERS
// ============================================================

function renderDrivers() {
  const rows =
    filterRows(S.drivers);

  $("driversBody").innerHTML =
    rows
      .map(
        row => `
<tr
  class="clickableRow"
  data-detail-type="driver"
  data-team="${esc(row.team_name)}"
  data-driver="${esc(row.driver_name)}"
>

  <td class="team">
    ${esc(
      row.team_name ||
      `APEX ${row.apex_id}`
    )}
  </td>

  <td>
    ${esc(row.driver_name || "—")}
  </td>

  <td>
    ${esc(
      row.valid_stint_count ?? "—"
    )}
  </td>

  <td>
    ${esc(
      row.short_stint_count ?? "—"
    )}
  </td>

  <td>
    ${esc(
      row.valid_laps ?? "—"
    )}
  </td>

  <td>
    ${esc(
      row.total_laps ?? "—"
    )}
  </td>

  <td>
    ${time(row.avg_lap_time)}
  </td>

  <td class="good">
    ${time(row.best_lap_time)}
  </td>

  <td>
    ${time(row.avg_consistency)}
  </td>

</tr>
`
      )
      .join("") ||

    `
<tr class="empty">
  <td colspan="9">
    ${
      S.selectedRaceId
        ? "No driver data for this race."
        : "Select a race / session."
    }
  </td>
</tr>
`;
}


// ============================================================
// TEAM AGGREGATION
// ============================================================

function buildTeams() {
  const groups =
    new Map();

  for (const driver of S.drivers) {
    const key =
      driver.team_name ||
      `APEX ${driver.apex_id}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups
      .get(key)
      .push(driver);
  }

  S.teams =
    [...groups.entries()]
      .map(([teamName, drivers]) => {

        const validLaps =
          sum(
            drivers,
            row => row.valid_laps
          );

        const totalLaps =
          sum(
            drivers,
            row => row.total_laps
          );

        const validStints =
          sum(
            drivers,
            row => row.valid_stint_count
          );

        const weightedAverageNumerator =
          drivers.reduce(
            (total, row) => {
              const laps =
                number(row.valid_laps) || 0;

              const pace =
                number(row.avg_lap_time);

              if (
                !laps ||
                pace === null
              ) {
                return total;
              }

              return total + pace * laps;
            },
            0
          );

        const avgLap =
          validLaps > 0
            ? weightedAverageNumerator /
              validLaps
            : null;

        const bestValues =
          drivers
            .map(
              row =>
                number(row.best_lap_time)
            )
            .filter(
              value =>
                value !== null &&
                value > 0
            );

        const bestLap =
          bestValues.length
            ? Math.min(...bestValues)
            : null;

        const consistency =
          average(
            drivers.map(
              row =>
                row.avg_consistency
            )
          );

        const driverPaces =
          drivers
            .map(
              row =>
                number(row.avg_lap_time)
            )
            .filter(
              value =>
                value !== null &&
                value > 0
            );

        const driverSpread =
          driverPaces.length > 1
            ? Math.max(...driverPaces) -
              Math.min(...driverPaces)
            : 0;

        return {
          team_name: teamName,

          apex_id:
            drivers[0]?.apex_id,

          driver_count:
            drivers.length,

          valid_stint_count:
            validStints,

          valid_laps:
            validLaps,

          total_laps:
            totalLaps,

          avg_lap_time:
            avgLap,

          best_lap_time:
            bestLap,

          avg_consistency:
            consistency,

          driver_spread:
            driverSpread,

          drivers
        };
      })
      .sort(
        (a, b) =>
          a.team_name.localeCompare(
            b.team_name
          )
      );
}


// ============================================================
// TEAMS
// ============================================================

function renderTeams() {
  const rows =
    filterRows(S.teams);

  $("teamsBody").innerHTML =
    rows
      .map(
        row => `
<tr
  class="clickableRow"
  data-detail-type="team"
  data-team="${esc(row.team_name)}"
  data-apex-id="${esc(row.apex_id)}"
>

  <td class="team">
    ${esc(row.team_name)}
  </td>

  <td>
    ${esc(row.driver_count)}
  </td>

  <td>
    ${esc(row.valid_stint_count)}
  </td>

  <td>
    ${esc(row.valid_laps)}
  </td>

  <td>
    ${esc(row.total_laps)}
  </td>

  <td>
    ${time(row.avg_lap_time)}
  </td>

  <td class="good">
    ${time(row.best_lap_time)}
  </td>

  <td>
    ${time(row.avg_consistency)}
  </td>

  <td>
    ${time(row.driver_spread)}
  </td>

</tr>
`
      )
      .join("") ||

    `
<tr class="empty">
  <td colspan="9">
    ${
      S.selectedRaceId
        ? "No team data for this race."
        : "Select a race / session."
    }
  </td>
</tr>
`;
}


// ============================================================
// PITS
// ============================================================

function renderPits() {
  const rows =
    filterRows(S.pits);

  $("pitsBody").innerHTML =
    rows
      .map(
        row => `
<tr>

  <td class="team">
    ${esc(
      row.team_name ||
      `APEX ${row.apex_id}`
    )}
  </td>

  <td>
    ${esc(
      pick(
        row,
        "pit_number",
        "pit_no"
      ) ?? "—"
    )}
  </td>

  <td>
    ${esc(row.driver_name || "—")}
  </td>

  <td>
    ${esc(row.pit_lap ?? "—")}
  </td>

  <td>
    ${esc(row.pit_hour ?? "—")}
  </td>

  <td>
    ${esc(row.on_track ?? "—")}
  </td>

  <td>
    ${esc(row.pit_time ?? "—")}
  </td>

  <td>
    ${esc(
      row.out_time ??
      row.out ??
      "—"
    )}
  </td>

</tr>
`
      )
      .join("") ||

    `
<tr class="empty">
  <td colspan="8">
    ${
      S.selectedRaceId
        ? "No pit data for this race."
        : "Select a race / session."
    }
  </td>
</tr>
`;
}


// ============================================================
// EVENTS
// ============================================================

function renderEvents() {
  const body =
    $("eventsBody");

  if (!S.events.length) {
    body.innerHTML = `
<tr class="empty">
  <td colspan="7">
    ${
      S.selectedRaceId
        ? "No race events loaded."
        : "Select a race / session."
    }
  </td>
</tr>
`;
    return;
  }

  body.innerHTML =
    S.events
      .map(
        row => `
<tr>

  <td>
    ${esc(row.time || "—")}
  </td>

  <td class="team">
    ${esc(row.team_name || "—")}
  </td>

  <td>
    ${esc(row.lap_number ?? "—")}
  </td>

  <td>
    ${esc(row.type || "—")}
  </td>

  <td>
    ${esc(row.reason || "—")}
  </td>

  <td>
    ${esc(row.status || "—")}
  </td>

  <td>
    —
  </td>

</tr>
`
      )
      .join("");
}


// ============================================================
// RENDER ACTIVE VIEW
// ============================================================

function renderActiveView() {
  switch (S.activeView) {
    case "live":
      renderLive();
      break;

    case "stints":
      renderStints();
      break;

    case "drivers":
      renderDrivers();
      break;

    case "teamsView":
      renderTeams();
      break;

    case "pits":
      renderPits();
      break;

    case "events":
      renderEvents();
      break;
  }
}


// ============================================================
// LIVE
// ============================================================

async function refreshLive() {
  try {
    const data =
      await api("/api/live");

    S.liveMeta =
      data;

    S.mode =
      "live";

    // IMPORTANT:
    // LIVE NEVER SHOWS HISTORICAL / STALE ROWS.
    S.live =
      data.active === true
        ? (data.current || [])
        : [];

    rebuildFilters();

    renderLive();

    updateHeader(data);

    if (data.active === false) {
      setStatus(
        true,
        "NO LIVE SESSION"
      );

      $("updated").textContent =
        "No active Apex timing session";

      return;
    }

    setStatus(
      true,
      "LIVE"
    );

    $("updated").textContent =
      `Updated ${new Date().toLocaleTimeString()}`;

  } catch (error) {
    console.error(error);

    setStatus(
      false,
      "ERROR"
    );

    $("updated").textContent =
      error.message;
  }
}


// ============================================================
// HISTORY DATA
// ============================================================

function clearHistoryData() {
  S.stints = [];
  S.drivers = [];
  S.teams = [];
  S.pits = [];
  S.events = [];

  S.loaded.stints = false;
  S.loaded.drivers = false;
  S.loaded.teams = false;
  S.loaded.pits = false;
  S.loaded.events = false;
}


async function loadHistoryRaces() {
  try {
    const data =
      await api("/api/races");

    const races =
      data.rows || [];

    const select =
      $("historyRace");

    const current =
      String(S.selectedRaceId || "");

    select.innerHTML =
      '<option value="">Select race / session</option>' +
      races
        .map(race => {
          const id =
            race.id ??
            race.race_id;

          const label =
            race.name ||
            race.session_name ||
            race.title ||
            `Race ${id}`;

          return `
<option value="${esc(id)}">
  ${esc(label)}
</option>
`;
        })
        .join("");

    if (
      current &&
      races.some(
        race =>
          String(
            race.id ??
            race.race_id
          ) === current
      )
    ) {
      select.value =
        current;
    }

  } catch (error) {
    console.error(error);

    const select =
      $("historyRace");

    select.innerHTML = `
<option value="">
  Historical race list unavailable
</option>
`;

    setStatus(
      false,
      "ERROR"
    );

    $("updated").textContent =
      error.message;
  }
}


// ============================================================
// STINTS
// ============================================================

async function loadStints(force = false) {
  if (!S.selectedRaceId) {
    S.stints = [];
    renderStints();
    return;
  }

  if (
    S.loaded.stints &&
    !force
  ) {
    renderStints();
    return;
  }

  try {
    const data =
      await api(
        "/api/stints",
        S.selectedRaceId
      );

    S.stints =
      data.rows || [];

    S.loaded.stints =
      true;

    rebuildFilters();

    renderStints();

  } catch (error) {
    showLoadError(error);
  }
}


// ============================================================
// DRIVERS
// ============================================================

async function loadDrivers(force = false) {
  if (!S.selectedRaceId) {
    S.drivers = [];
    S.teams = [];

    renderDrivers();

    return;
  }

  if (
    S.loaded.drivers &&
    !force
  ) {
    renderDrivers();
    return;
  }

  try {
    const data =
      await api(
        "/api/drivers",
        S.selectedRaceId
      );

    S.drivers =
      data.rows || [];

    S.loaded.drivers =
      true;

    buildTeams();

    S.loaded.teams =
      true;

    rebuildFilters();

    renderDrivers();

  } catch (error) {
    showLoadError(error);
  }
}


// ============================================================
// TEAMS
// ============================================================

async function loadTeams(force = false) {
  if (!S.selectedRaceId) {
    S.teams = [];
    renderTeams();
    return;
  }

  if (
    !S.loaded.drivers ||
    force
  ) {
    await loadDrivers(force);
  }

  buildTeams();

  S.loaded.teams =
    true;

  rebuildFilters();

  renderTeams();
}


// ============================================================
// PITS
// ============================================================

async function loadPits(force = false) {
  if (!S.selectedRaceId) {
    S.pits = [];
    renderPits();
    return;
  }

  if (
    S.loaded.pits &&
    !force
  ) {
    renderPits();
    return;
  }

  try {
    const data =
      await api(
        "/api/pits",
        S.selectedRaceId
      );

    S.pits =
      data.rows || [];

    S.loaded.pits =
      true;

    rebuildFilters();

    renderPits();

  } catch (error) {
    showLoadError(error);
  }
}


// ============================================================
// EVENTS
// ============================================================

async function loadEvents() {
  renderEvents();
}


// ============================================================
// LOAD ACTIVE TAB
// ============================================================

async function loadActiveView(force = false) {
  switch (S.activeView) {
    case "live":
      await refreshLive();
      break;

    case "stints":
      await loadStints(force);
      break;

    case "drivers":
      await loadDrivers(force);
      break;

    case "teamsView":
      await loadTeams(force);
      break;

    case "pits":
      await loadPits(force);
      break;

    case "events":
      await loadEvents();
      break;
  }
}


// ============================================================
// ERRORS
// ============================================================

function showLoadError(error) {
  console.error(error);

  setStatus(
    false,
    "ERROR"
  );

  $("updated").textContent =
    error.message;
}


// ============================================================
// DETAIL DRAWER
// ============================================================

function openDrawer(title, html) {
  $("detailTitle").textContent =
    title;

  $("detailContent").innerHTML =
    html;

  $("detailDrawer").classList.add(
    "open"
  );
}


function closeDrawer() {
  $("detailDrawer").classList.remove(
    "open"
  );
}


async function showTeamDetail(teamName, apexId) {
  if (
    S.mode === "history" &&
    !S.selectedRaceId
  ) {
    return;
  }

  if (!S.loaded.drivers) {
    await loadDrivers();
  }

  if (!S.loaded.stints) {
    await loadStints();
  }

  const drivers =
    S.drivers.filter(
      row =>
        (
          teamName &&
          row.team_name === teamName
        ) ||
        (
          apexId &&
          String(row.apex_id) ===
          String(apexId)
        )
    );

  const stints =
    S.stints.filter(
      row =>
        (
          teamName &&
          row.team_name === teamName
        ) ||
        (
          apexId &&
          String(row.apex_id) ===
          String(apexId)
        )
    );

  const name =
    teamName ||
    drivers[0]?.team_name ||
    stints[0]?.team_name ||
    `APEX ${apexId}`;

  openDrawer(
    name,
    `
<div class="detailGrid">

  <div class="metricCard">
    <span>Drivers</span>
    <strong>${drivers.length}</strong>
  </div>

  <div class="metricCard">
    <span>Stints</span>
    <strong>${stints.length}</strong>
  </div>

  <div class="metricCard">
    <span>Total laps</span>
    <strong>
      ${sum(drivers, row => row.total_laps)}
    </strong>
  </div>

  <div class="metricCard">
    <span>Valid laps</span>
    <strong>
      ${sum(drivers, row => row.valid_laps)}
    </strong>
  </div>

</div>

<h3>Drivers</h3>

<div class="detailList">
  ${
    drivers.length
      ? drivers
          .map(
            row => `
<div class="detailListRow">
  <strong>${esc(row.driver_name)}</strong>

  <span>
    Avg ${time(row.avg_lap_time)}
    · Best ${time(row.best_lap_time)}
  </span>
</div>
`
          )
          .join("")
      : '<p class="muted">No driver statistics loaded.</p>'
  }
</div>

<h3>Stints</h3>

<div class="detailList">
  ${
    stints.length
      ? stints
          .map(
            row => `
<div class="detailListRow">

  <strong>
    #${esc(stintNumber(row))}
    ${esc(row.driver_name || "")}
  </strong>

  <span>
    ${esc(
      pick(
        row,
        "valid_laps",
        "lap_count",
        "total_laps"
      ) ?? "—"
    )} laps

    · Avg ${time(
      pick(
        row,
        "avg_lap_time",
        "avg_lap"
      )
    )}

    · Best ${time(
      pick(
        row,
        "best_lap_time",
        "best_lap"
      )
    )}
  </span>

</div>
`
          )
          .join("")
      : '<p class="muted">No stint history loaded.</p>'
  }
</div>
`
  );
}


async function showDriverDetail(
  teamName,
  driverName
) {
  if (!S.selectedRaceId) {
    return;
  }

  if (!S.loaded.stints) {
    await loadStints();
  }

  const driver =
    S.drivers.find(
      row =>
        row.team_name === teamName &&
        row.driver_name === driverName
    );

  const stints =
    S.stints.filter(
      row =>
        row.team_name === teamName &&
        row.driver_name === driverName
    );

  openDrawer(
    driverName || "Driver",
    `
<p class="drawerSubtitle">
  ${esc(teamName || "")}
</p>

<div class="detailGrid">

  <div class="metricCard">
    <span>Total laps</span>
    <strong>
      ${esc(driver?.total_laps ?? "—")}
    </strong>
  </div>

  <div class="metricCard">
    <span>Valid laps</span>
    <strong>
      ${esc(driver?.valid_laps ?? "—")}
    </strong>
  </div>

  <div class="metricCard">
    <span>Average</span>
    <strong>
      ${time(driver?.avg_lap_time)}
    </strong>
  </div>

  <div class="metricCard">
    <span>Best</span>
    <strong>
      ${time(driver?.best_lap_time)}
    </strong>
  </div>

  <div class="metricCard">
    <span>Consistency</span>
    <strong>
      ${time(driver?.avg_consistency)}
    </strong>
  </div>

  <div class="metricCard">
    <span>Stints</span>
    <strong>
      ${stints.length}
    </strong>
  </div>

</div>

<h3>Stint history</h3>

<div class="detailList">

  ${
    stints.length
      ? stints
          .map(
            row => `
<div class="detailListRow">

  <strong>
    #${esc(stintNumber(row))}
  </strong>

  <span>
    ${esc(
      pick(
        row,
        "valid_laps",
        "lap_count",
        "total_laps"
      ) ?? "—"
    )} laps

    · Avg ${time(
      pick(
        row,
        "avg_lap_time",
        "avg_lap"
      )
    )}

    · Best ${time(
      pick(
        row,
        "best_lap_time",
        "best_lap"
      )
    )}
  </span>

</div>
`
          )
          .join("")
      : '<p class="muted">No stint history loaded.</p>'
  }

</div>
`
  );
}


// ============================================================
// CLICKABLE ROWS
// ============================================================

document.addEventListener(
  "click",
  async event => {
    const row =
      event.target.closest(
        ".clickableRow"
      );

    if (!row) {
      return;
    }

    const type =
      row.dataset.detailType;

    if (type === "team") {
      await showTeamDetail(
        row.dataset.team || null,
        row.dataset.apexId || null
      );

      return;
    }

    if (type === "driver") {
      await showDriverDetail(
        row.dataset.team,
        row.dataset.driver
      );
    }
  }
);


// ============================================================
// CSV
// ============================================================

function csvValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  const string =
    String(value);

  if (
    string.includes(",") ||
    string.includes('"') ||
    string.includes("\n")
  ) {
    return `"${string.replace(
      /"/g,
      '""'
    )}"`;
  }

  return string;
}


function downloadCsv(
  filename,
  rows
) {
  if (!rows.length) {
    alert(
      "No data available for export."
    );

    return;
  }

  const columns =
    [...new Set(
      rows.flatMap(
        row => Object.keys(row)
      )
    )];

  const csv = [
    columns
      .map(csvValue)
      .join(","),

    ...rows.map(
      row =>
        columns
          .map(
            column =>
              csvValue(row[column])
          )
          .join(",")
    )
  ].join("\n");

  const blob =
    new Blob(
      [csv],
      {
        type:
          "text/csv;charset=utf-8"
      }
    );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href =
    url;

  link.download =
    filename;

  document.body.appendChild(
    link
  );

  link.click();

  link.remove();

  URL.revokeObjectURL(url);
}


// ============================================================
// RACE ANALYTICS REPORT DATA
// ============================================================

async function ensureRaceDatasetsLoaded() {
  if (!S.selectedRaceId) {
    alert(
      "Select a historical race / session first."
    );

    return false;
  }

  await Promise.all([
    loadStints(),
    loadDrivers(),
    loadPits()
  ]);

  buildTeams();

  return true;
}


function completeRaceRows() {
  const rows = [];

  S.stints.forEach(
    row =>
      rows.push({
        dataset: "stints",
        ...row
      })
  );

  S.drivers.forEach(
    row =>
      rows.push({
        dataset: "drivers",
        ...row
      })
  );

  S.teams.forEach(row => {
    const {
      drivers,
      ...team
    } = row;

    rows.push({
      dataset: "teams",
      ...team
    });
  });

  S.pits.forEach(
    row =>
      rows.push({
        dataset: "pits",
        ...row
      })
  );

  return rows;
}


// ============================================================
// PDF
// ============================================================

function printTablePdf(
  title,
  rows
) {
  if (!rows.length) {
    alert(
      "No data available for PDF."
    );

    return;
  }

  const columns =
    [...new Set(
      rows.flatMap(
        row => Object.keys(row)
      )
    )];

  const win =
    window.open(
      "",
      "_blank"
    );

  if (!win) {
    alert(
      "The browser blocked the PDF window."
    );

    return;
  }

  const table = `
<table>

  <thead>

    <tr>
      ${
        columns
          .map(
            column =>
              `<th>${esc(column)}</th>`
          )
          .join("")
      }
    </tr>

  </thead>

  <tbody>

    ${
      rows
        .map(
          row => `
<tr>

  ${
    columns
      .map(
        column =>
          `<td>${esc(row[column] ?? "")}</td>`
      )
      .join("")
  }

</tr>
`
        )
        .join("")
    }

  </tbody>

</table>
`;

  win.document.write(`
<!doctype html>

<html>

<head>

<meta charset="utf-8">

<title>
  ${esc(title)}
</title>

<style>

body {
  font-family: Arial, sans-serif;
  margin: 24px;
  color: #111;
}

h1 {
  font-size: 20px;
  margin-bottom: 16px;
}

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 9px;
}

th,
td {
  border: 1px solid #bbb;
  padding: 4px 5px;
  text-align: left;
}

th {
  background: #eee;
}

@page {
  size: landscape;
  margin: 10mm;
}

</style>

</head>

<body>

<h1>
  ${esc(title)}
</h1>

${table}

</body>

</html>
`);

  win.document.close();

  win.focus();

  setTimeout(
    () => win.print(),
    250
  );
}


// ============================================================
// RACE ANALYTICS CSV / PDF BUTTONS
// ============================================================

$("downloadRaceCsv")
  ?.addEventListener(
    "click",
    async () => {
      const ready =
        await ensureRaceDatasetsLoaded();

      if (!ready) {
        return;
      }

      downloadCsv(
        `race-${S.selectedRaceId}-analytics.csv`,
        completeRaceRows()
      );
    }
  );


$("downloadRacePdf")
  ?.addEventListener(
    "click",
    async () => {
      const ready =
        await ensureRaceDatasetsLoaded();

      if (!ready) {
        return;
      }

      printTablePdf(
        `Race ${S.selectedRaceId} Analytics`,
        completeRaceRows()
      );
    }
  );


// ============================================================
// ORGANISER REPORT BUTTONS
// ============================================================
//
// IMPORTANT:
// These remain disabled until worker.js has the exact generators.
// We do NOT generate a random table and call it the organiser report.
// ============================================================

[
  "organiserReport1Csv",
  "organiserReport1Pdf",
  "organiserReport2Csv",
  "organiserReport2Pdf"
].forEach(id => {
  const button =
    $(id);

  if (!button) {
    return;
  }

  button.disabled =
    true;

  button.title =
    "Organiser report generator not connected yet";
});


// ============================================================
// FILTER EVENTS
// ============================================================

$("search").addEventListener(
  "input",
  renderActiveView
);


$("teamFilter").addEventListener(
  "change",
  renderActiveView
);


$("driverFilter").addEventListener(
  "change",
  renderActiveView
);


$("resetFilters").addEventListener(
  "click",
  resetFilters
);


// ============================================================
// HISTORY RACE SELECTOR
// ============================================================

$("historyRace")
  ?.addEventListener(
    "change",
    async event => {
      const value =
        event.target.value;

      S.selectedRaceId =
        value || null;

      clearHistoryData();

      $("teamFilter").value = "";
      $("driverFilter").value = "";
      $("search").value = "";

      updateHeader();

      rebuildFilters();

      if (!S.selectedRaceId) {
        renderActiveView();
        return;
      }

      await loadActiveView(true);

      rebuildFilters();
    }
  );


// ============================================================
// MANUAL REFRESH
// ============================================================

$("refresh").addEventListener(
  "click",
  async () => {
    await loadActiveView(true);
  }
);


// ============================================================
// TABS
// ============================================================

document
  .querySelectorAll(".tab")
  .forEach(button => {

    button.addEventListener(
      "click",
      async () => {

        document
          .querySelectorAll(".tab")
          .forEach(
            tab =>
              tab.classList.remove(
                "active"
              )
          );

        document
          .querySelectorAll(".view")
          .forEach(
            view =>
              view.classList.remove(
                "active"
              )
          );

        button.classList.add(
          "active"
        );

        const view =
          button.dataset.view;

        $(view).classList.add(
          "active"
        );

        S.activeView =
          view;

        $("teamFilter").value = "";
        $("driverFilter").value = "";
        $("search").value = "";

        closeDrawer();

        if (view === "live") {
          S.mode =
            "live";

          updateHeader();

          await refreshLive();

          rebuildFilters();

          return;
        }

        // Every non-LIVE tab is explicitly historical.
        S.mode =
          "history";

        updateHeader();

        if (
          !$("historyRace").options.length ||
          $("historyRace").options.length <= 1
        ) {
          await loadHistoryRaces();
        }

        if (view !== "reports") {
          await loadActiveView();
        }

        rebuildFilters();
      }
    );
  });


// ============================================================
// DRAWER
// ============================================================

$("closeDetail").addEventListener(
  "click",
  closeDrawer
);


document.addEventListener(
  "keydown",
  event => {
    if (event.key === "Escape") {
      closeDrawer();
    }
  }
);


// ============================================================
// AUTO REFRESH
// ============================================================
//
// ONLY LIVE is refreshed automatically.
// HISTORY is never refreshed every 1.5 seconds.
// ============================================================

S.timer =
  setInterval(
    () => {
      if (
        $("auto").checked &&
        S.activeView === "live" &&
        S.mode === "live"
      ) {
        refreshLive();
      }
    },
    1500
  );


// ============================================================
// INITIAL LOAD
// ============================================================

updateHeader();

refreshLive();
