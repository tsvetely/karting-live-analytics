const S = {
  source: "live",
  raceId: null,

  activeView: "overview",

  liveMeta: null,

  overview: [],
  stints: [],
  drivers: [],
  teams: [],
  pits: [],
  events: [],

  loaded: {
    overview: false,
    stints: false,
    drivers: false,
    teams: false,
    pits: false,
    events: false
  },

  timer: null
};


const $ = id =>
  document.getElementById(id);


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
// HELPERS
// ============================================================

function number(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function time(value) {
  const seconds =
    number(value);

  if (seconds === null) {
    return "—";
  }

  if (seconds >= 60) {
    const minutes =
      Math.floor(seconds / 60);

    const rest =
      (seconds - minutes * 60)
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
    (total, row) =>
      total +
      (number(getter(row)) || 0),
    0
  );
}


function average(values) {
  const clean =
    values
      .map(number)
      .filter(
        value =>
          value !== null
      );

  if (!clean.length) {
    return null;
  }

  return (
    clean.reduce(
      (a, b) => a + b,
      0
    ) /
    clean.length
  );
}


// ============================================================
// SELECTED RACE
// ============================================================

function isLiveRace() {
  return S.source === "live";
}


function selectedRaceId() {
  return isLiveRace()
    ? null
    : S.raceId;
}


// ============================================================
// API
// ============================================================

async function api(
  path,
  options = {}
) {
  const url =
    new URL(
      path,
      window.location.origin
    );

  const raceId =
    options.raceId !== undefined
      ? options.raceId
      : selectedRaceId();

  if (
    raceId !== null &&
    raceId !== undefined &&
    raceId !== ""
  ) {
    url.searchParams.set(
      "race_id",
      String(raceId)
    );
  }

  const response =
    await fetch(
      url,
      {
        cache: "no-store"
      }
    );

  if (!response.ok) {
    throw new Error(
      await response.text()
    );
  }

  return response.json();
}


// ============================================================
// STATUS
// ============================================================

function setStatus(
  ok,
  message
) {
  $("status").textContent =
    message;

  $("liveDot").className =
    `dot ${ok ? "ok" : "bad"}`;
}


// ============================================================
// RACE CONTEXT
// ============================================================

function updateRaceContext() {
  const badge =
    $("raceModeBadge");

  const auto =
    $("autoRefreshControl");

  if (isLiveRace()) {

    badge.className =
      "raceModeBadge live";

    badge.textContent =
      "LIVE";

    auto.classList.remove(
      "hidden"
    );

    $("overviewTitle").textContent =
      "Current race overview";

    $("overviewSubtitle").textContent =
      "Current driver and stint performance updated from live timing.";

  } else {

    badge.className =
      "raceModeBadge history";

    badge.textContent =
      "HISTORY";

    auto.classList.add(
      "hidden"
    );

    const selected =
      $("raceSelector")
        .selectedOptions[0];

    const raceName =
      selected?.textContent ||
      `Race ${S.raceId}`;

    $("overviewTitle").textContent =
      raceName;

    $("overviewSubtitle").textContent =
      "Stored race overview and statistics.";
  }
}


// ============================================================
// FILTER SOURCE
// ============================================================

function rowsForCurrentView() {
  switch (S.activeView) {

    case "overview":
      return S.overview;

    case "stints":
      return S.stints;

    case "drivers":
      return S.drivers;

    case "teams":
      return S.teams;

    case "pits":
      return S.pits;

    case "events":
      return S.events;

    default:
      return [];
  }
}


// ============================================================
// FILTERING
// ============================================================

function filterRows(rows) {
  const search =
    $("search")
      .value
      .trim()
      .toLowerCase();

  const selectedTeam =
    $("teamFilter").value;

  const selectedDriver =
    $("driverFilter").value;


  return rows.filter(row => {

    const team =
      String(
        row.team_name || ""
      );

    const driver =
      String(
        row.driver_name ||
        row.current_driver ||
        ""
      );

    const searchable =
      [
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


    return (
      (
        !selectedTeam ||
        team === selectedTeam
      ) &&
      (
        !selectedDriver ||
        driver === selectedDriver
      ) &&
      (
        !search ||
        searchable.includes(search)
      )
    );
  });
}


function rebuildFilters() {
  const rows =
    rowsForCurrentView();

  const teamSelect =
    $("teamFilter");

  const driverSelect =
    $("driverFilter");

  const currentTeam =
    teamSelect.value;

  const currentDriver =
    driverSelect.value;


  const teams =
    [
      ...new Set(
        rows
          .map(
            row =>
              row.team_name
          )
          .filter(Boolean)
      )
    ]
      .sort();


  const drivers =
    [
      ...new Set(
        rows
          .map(
            row =>
              row.driver_name ||
              row.current_driver
          )
          .filter(Boolean)
      )
    ]
      .sort();


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


  if (
    teams.includes(
      currentTeam
    )
  ) {
    teamSelect.value =
      currentTeam;
  }


  if (
    drivers.includes(
      currentDriver
    )
  ) {
    driverSelect.value =
      currentDriver;
  }
}


function resetFilters() {
  $("teamFilter").value = "";
  $("driverFilter").value = "";
  $("search").value = "";

  renderActiveView();
}


// ============================================================
// CLEAR CURRENT RACE DATA
// ============================================================

function clearRaceData() {
  S.overview = [];
  S.stints = [];
  S.drivers = [];
  S.teams = [];
  S.pits = [];
  S.events = [];

  Object.keys(
    S.loaded
  ).forEach(
    key =>
      S.loaded[key] = false
  );
}


// ============================================================
// RACE LIST
// ============================================================

async function loadRaceList() {
  const select =
    $("raceSelector");

  try {

    const data =
      await api(
        "/api/races",
        {
          raceId: null
        }
      );

    const races =
      data.rows || [];


    select.innerHTML = `
<option value="live">
  ● LIVE — Current race
</option>
` +
      races
        .map(
          race => {

            const id =
              race.id ??
              race.race_id;

            const label =
              race.name ||
              race.session_name ||
              race.title ||
              race.label ||
              `Race ${id}`;

            return `
<option value="race:${esc(id)}">
  ${esc(label)}
</option>
`;
          }
        )
        .join("");


  } catch (error) {

    console.error(error);

    /*
     * LIVE remains usable even if history list
     * cannot currently be loaded.
     */

    select.innerHTML = `
<option value="live">
  ● LIVE — Current race
</option>
`;

  }
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


  const stints =
    S.stints
      .filter(
        item =>
          String(item.apex_id) ===
          String(row.apex_id)
      )
      .sort(
        (a, b) =>
          Number(
            a.start_lap_count || 0
          ) -
          Number(
            b.start_lap_count || 0
          )
      );


  const index =
    stints.findIndex(
      item =>
        String(
          item.start_lap_count
        ) ===
        String(
          row.start_lap_count
        )
    );


  return index >= 0
    ? index + 1
    : "—";
}


// ============================================================
// OVERVIEW
// ============================================================

function renderOverview() {
  const rows =
    filterRows(
      S.overview
    );

  $("teamCount").textContent =
    rows.length;

  $("overviewBody").innerHTML =
    rows
      .map(
        row => `
<tr
  class="clickableRow"
  data-detail-type="team"
  data-team="${esc(row.team_name || "")}"
  data-apex-id="${esc(row.apex_id || "")}"
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
  #${esc(
    stintNumber(row)
  )}
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
    row.best_lap_number ??
    "—"
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
    row.worst_lap_number ??
    "—"
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
    isLiveRace()
      ? (
          S.liveMeta?.active === false
            ? "No active live timing session."
            : "No race data."
        )
      : "No stored overview data for this race."
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
    filterRows(
      S.stints
    );

  $("stintsBody").innerHTML =
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
    row.driver_name ||
    "—"
  )}
</td>

<td>
  #${esc(
    row.stint_number ||
    stintNumber(row)
  )}
</td>

<td>
  ${esc(
    row.start_lap_count ??
    "—"
  )}
</td>

<td>
  ${esc(
    row.end_lap_count ??
    "LIVE"
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
    row.best_lap_number ??
    "—"
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
    row.worst_lap_number ??
    "—"
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
    No stint data.
  </td>
</tr>
`;
}


// ============================================================
// DRIVERS
// ============================================================

function renderDrivers() {
  const rows =
    filterRows(
      S.drivers
    );

  $("driversBody").innerHTML =
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
    row.driver_name ||
    "—"
  )}
</td>

<td>
  ${esc(
    row.valid_stint_count ??
    "—"
  )}
</td>

<td>
  ${esc(
    row.short_stint_count ??
    "—"
  )}
</td>

<td>
  ${esc(
    row.valid_laps ??
    "—"
  )}
</td>

<td>
  ${esc(
    row.total_laps ??
    "—"
  )}
</td>

<td>
  ${time(
    row.avg_lap_time
  )}
</td>

<td class="good">
  ${time(
    row.best_lap_time
  )}
</td>

<td>
  ${time(
    row.avg_consistency
  )}
</td>

</tr>
`
      )
      .join("") ||

`
<tr class="empty">
  <td colspan="9">
    No driver data.
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


  for (
    const driver
    of S.drivers
  ) {

    const key =
      driver.team_name ||
      `APEX ${driver.apex_id}`;


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
      .push(driver);
  }


  S.teams =
    [...groups.entries()]
      .map(
        ([teamName, drivers]) => {

          const validLaps =
            sum(
              drivers,
              row =>
                row.valid_laps
            );


          const totalLaps =
            sum(
              drivers,
              row =>
                row.total_laps
            );


          const validStints =
            sum(
              drivers,
              row =>
                row.valid_stint_count
            );


          const weighted =
            drivers.reduce(
              (total, row) => {

                const laps =
                  number(
                    row.valid_laps
                  ) || 0;

                const pace =
                  number(
                    row.avg_lap_time
                  );

                if (
                  !laps ||
                  pace === null
                ) {
                  return total;
                }

                return (
                  total +
                  pace * laps
                );
              },
              0
            );


          const avgLap =
            validLaps
              ? weighted /
                validLaps
              : null;


          const bestValues =
            drivers
              .map(
                row =>
                  number(
                    row.best_lap_time
                  )
              )
              .filter(
                value =>
                  value !== null &&
                  value > 0
              );


          const bestLap =
            bestValues.length
              ? Math.min(
                  ...bestValues
                )
              : null;


          const consistency =
            average(
              drivers.map(
                row =>
                  row.avg_consistency
              )
            );


          const driverAverages =
            drivers
              .map(
                row =>
                  number(
                    row.avg_lap_time
                  )
              )
              .filter(
                value =>
                  value !== null &&
                  value > 0
              );


          const spread =
            driverAverages.length > 1
              ? (
                  Math.max(
                    ...driverAverages
                  ) -
                  Math.min(
                    ...driverAverages
                  )
                )
              : 0;


          return {
            team_name:
              teamName,

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
              spread
          };
        }
      );
}


// ============================================================
// TEAMS
// ============================================================

function renderTeams() {
  const rows =
    filterRows(
      S.teams
    );

  $("teamsBody").innerHTML =
    rows
      .map(
        row => `
<tr>

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
    No team data.
  </td>
</tr>
`;
}


// ============================================================
// PITS
// ============================================================

function renderPits() {
  const rows =
    filterRows(
      S.pits
    );

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
    row.pit_number ??
    row.pit_no ??
    "—"
  )}
</td>

<td>
  ${esc(
    row.driver_name ||
    "—"
  )}
</td>

<td>
  ${esc(
    row.pit_lap ??
    "—"
  )}
</td>

<td>
  ${esc(
    row.pit_hour ??
    "—"
  )}
</td>

<td>
  ${esc(
    row.on_track ??
    "—"
  )}
</td>

<td>
  ${esc(
    row.pit_time ??
    "—"
  )}
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
    No pit data.
  </td>
</tr>
`;
}


// ============================================================
// EVENTS
// ============================================================

function renderEvents() {
  const rows =
    filterRows(
      S.events
    );

  $("eventsBody").innerHTML =
    rows
      .map(
        row => `
<tr>

<td>
  ${esc(
    row.time ||
    "—"
  )}
</td>

<td class="team">
  ${esc(
    row.team_name ||
    "—"
  )}
</td>

<td>
  ${esc(
    row.lap_number ??
    "—"
  )}
</td>

<td>
  ${esc(
    row.type ||
    "—"
  )}
</td>

<td>
  ${esc(
    row.reason ||
    "—"
  )}
</td>

<td>
  ${esc(
    row.status ||
    "—"
  )}
</td>

<td>
  —
</td>

</tr>
`
      )
      .join("") ||

`
<tr class="empty">
  <td colspan="7">
    No race events.
  </td>
</tr>
`;
}


// ============================================================
// ACTIVE VIEW RENDER
// ============================================================

function renderActiveView() {
  switch (S.activeView) {

    case "overview":
      renderOverview();
      break;

    case "stints":
      renderStints();
      break;

    case "drivers":
      renderDrivers();
      break;

    case "teams":
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
// OVERVIEW LOAD
// ============================================================

async function loadOverview(
  force = false
) {
  if (
    S.loaded.overview &&
    !force
  ) {
    renderOverview();
    return;
  }


  try {

    if (isLiveRace()) {

      const data =
        await api(
          "/api/live"
        );

      S.liveMeta =
        data;

      S.overview =
        data.current || [];

      $("sessionName").textContent =
        data.session_name ||
        data.session ||
        "Apex Timing";

      $("sessionStatus").textContent =
        data.active === true
          ? "LIVE"
          : "NO LIVE SESSION";

      $("headerTeamCount").textContent =
        S.overview.length;


      if (
        data.active === false
      ) {

        S.overview = [];

        setStatus(
          true,
          "NO LIVE SESSION"
        );

        $("updated").textContent =
          "No active Apex timing session";

      } else {

        setStatus(
          true,
          "LIVE"
        );

        $("updated").textContent =
          `Updated ${new Date().toLocaleTimeString()}`;
      }

    } else {

      /*
       * Historical overview is built from
       * stored race statistics.
       */

      await Promise.all([
        loadStints(),
        loadDrivers()
      ]);

      buildTeams();

      S.overview =
        S.teams.map(
          team => ({
            ...team,
            driver_name: null,
            current_driver: null,
            updated_at: null
          })
        );


      const selected =
        $("raceSelector")
          .selectedOptions[0];

      $("sessionName").textContent =
        selected?.textContent ||
        `Race ${S.raceId}`;

      $("sessionStatus").textContent =
        "FINISHED";

      $("headerTeamCount").textContent =
        S.teams.length;

      setStatus(
        true,
        "HISTORY"
      );

      $("updated").textContent =
        "Stored race data";
    }


    S.loaded.overview =
      true;

    rebuildFilters();

    renderOverview();


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
// STINTS LOAD
// ============================================================

async function loadStints(
  force = false
) {
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
        "/api/stints"
      );

    S.stints =
      data.rows || [];

    S.loaded.stints =
      true;

    rebuildFilters();

    renderStints();

  } catch (error) {

    showLoadError(
      error
    );
  }
}


// ============================================================
// DRIVERS LOAD
// ============================================================

async function loadDrivers(
  force = false
) {
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
        "/api/drivers"
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

    showLoadError(
      error
    );
  }
}


// ============================================================
// TEAMS LOAD
// ============================================================

async function loadTeams(
  force = false
) {
  if (
    !S.loaded.drivers ||
    force
  ) {
    await loadDrivers(
      force
    );
  }

  buildTeams();

  S.loaded.teams =
    true;

  rebuildFilters();

  renderTeams();
}


// ============================================================
// PITS LOAD
// ============================================================

async function loadPits(
  force = false
) {
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
        "/api/pits"
      );

    S.pits =
      data.rows || [];

    S.loaded.pits =
      true;

    rebuildFilters();

    renderPits();

  } catch (error) {

    showLoadError(
      error
    );
  }
}


// ============================================================
// EVENTS LOAD
// ============================================================

async function loadEvents() {
  renderEvents();
}


// ============================================================
// VIEW LOAD
// ============================================================

async function loadActiveView(
  force = false
) {
  switch (S.activeView) {

    case "overview":
      await loadOverview(force);
      break;

    case "stints":
      await loadStints(force);
      break;

    case "drivers":
      await loadDrivers(force);
      break;

    case "teams":
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
// ERROR
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
// RACE SELECTION
// ============================================================

$("raceSelector")
  .addEventListener(
    "change",
    async event => {

      const value =
        event.target.value;


      if (value === "live") {

        S.source =
          "live";

        S.raceId =
          null;

      } else if (
        value.startsWith(
          "race:"
        )
      ) {

        S.source =
          "history";

        S.raceId =
          value.substring(
            5
          );
      }


      clearRaceData();

      resetFilters();

      updateRaceContext();

      await loadActiveView(
        true
      );
    }
  );


// ============================================================
// FILTER EVENTS
// ============================================================

$("search")
  .addEventListener(
    "input",
    renderActiveView
  );


$("teamFilter")
  .addEventListener(
    "change",
    renderActiveView
  );


$("driverFilter")
  .addEventListener(
    "change",
    renderActiveView
  );


$("resetFilters")
  .addEventListener(
    "click",
    resetFilters
  );


// ============================================================
// REFRESH
// ============================================================

$("refresh")
  .addEventListener(
    "click",
    async () => {

      clearRaceData();

      await loadActiveView(
        true
      );
    }
  );


// ============================================================
// TABS
// ============================================================

document
  .querySelectorAll(
    ".tab"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        async () => {

          document
            .querySelectorAll(
              ".tab"
            )
            .forEach(
              tab =>
                tab.classList.remove(
                  "active"
                )
            );


          document
            .querySelectorAll(
              ".view"
            )
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


          $(view)
            .classList.add(
              "active"
            );


          S.activeView =
            view;


          resetFilters();


          if (
            view !== "reports"
          ) {
            await loadActiveView();
          }
        }
      );
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
    [
      ...new Set(
        rows.flatMap(
          row =>
            Object.keys(row)
        )
      )
    ];


  const csv =
    [
      columns
        .map(csvValue)
        .join(","),

      ...rows.map(
        row =>
          columns
            .map(
              column =>
                csvValue(
                  row[column]
                )
            )
            .join(",")
      )
    ]
      .join("\n");


  const blob =
    new Blob(
      [csv],
      {
        type:
          "text/csv;charset=utf-8"
      }
    );


  const url =
    URL.createObjectURL(
      blob
    );


  const link =
    document.createElement(
      "a"
    );


  link.href =
    url;

  link.download =
    filename;


  document.body
    .appendChild(
      link
    );


  link.click();

  link.remove();

  URL.revokeObjectURL(
    url
  );
}


// ============================================================
// REPORT DATA
// ============================================================

async function ensureReportData() {
  await Promise.all([
    loadStints(),
    loadDrivers(),
    loadPits()
  ]);

  buildTeams();
}


function raceReportRows() {
  const rows = [];


  S.stints.forEach(
    row =>
      rows.push({
        dataset:
          "stints",
        ...row
      })
  );


  S.drivers.forEach(
    row =>
      rows.push({
        dataset:
          "drivers",
        ...row
      })
  );


  S.teams.forEach(
    row =>
      rows.push({
        dataset:
          "teams",
        ...row
      })
  );


  S.pits.forEach(
    row =>
      rows.push({
        dataset:
          "pits",
        ...row
      })
  );


  return rows;
}


// ============================================================
// PDF PRINT
// ============================================================

function printPdf(
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
    [
      ...new Set(
        rows.flatMap(
          row =>
            Object.keys(row)
        )
      )
    ];


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

${columns
  .map(
    column =>
      `<th>${esc(column)}</th>`
  )
  .join("")}

</tr>

</thead>

<tbody>

${rows
  .map(
    row => `
<tr>

${columns
  .map(
    column =>
      `<td>${esc(row[column] ?? "")}</td>`
  )
  .join("")}

</tr>
`
  )
  .join("")}

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
  margin: 20px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 8px;
}

th,
td {
  border: 1px solid #aaa;
  padding: 4px;
}

th {
  background: #eee;
}

@page {
  size: landscape;
  margin: 8mm;
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
    () =>
      win.print(),
    250
  );
}


// ============================================================
// REPORT BUTTONS
// ============================================================

$("downloadRaceCsv")
  .addEventListener(
    "click",
    async () => {

      await ensureReportData();

      downloadCsv(
        isLiveRace()
          ? "live-race-analytics.csv"
          : `race-${S.raceId}-analytics.csv`,

        raceReportRows()
      );
    }
  );


$("downloadRacePdf")
  .addEventListener(
    "click",
    async () => {

      await ensureReportData();

      printPdf(
        isLiveRace()
          ? "Live Race Analytics"
          : `Race ${S.raceId} Analytics`,

        raceReportRows()
      );
    }
  );


// Organiser reports require their exact generators.

[
  "organiserReport1Csv",
  "organiserReport1Pdf",
  "organiserReport2Csv",
  "organiserReport2Pdf"
]
  .forEach(
    id => {

      const button =
        $(id);

      button.disabled =
        true;

      button.title =
        "Organiser report generator not connected yet";
    }
  );


// ============================================================
// DETAIL DRAWER
// ============================================================

function closeDrawer() {
  $("detailDrawer")
    .classList.remove(
      "open"
    );
}


$("closeDetail")
  .addEventListener(
    "click",
    closeDrawer
  );


document
  .addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Escape"
      ) {
        closeDrawer();
      }
    }
  );


// ============================================================
// AUTO REFRESH
// ============================================================

S.timer =
  setInterval(
    () => {

      if (
        isLiveRace() &&
        $("auto").checked
      ) {

        /*
         * Refresh only the selected view.
         * STINTS/DRIVERS/etc therefore work LIVE too.
         */

        clearRaceData();

        loadActiveView(
          true
        );
      }
    },
    1500
  );


// ============================================================
// INITIAL
// ============================================================

updateRaceContext();

loadRaceList();

loadOverview(true);
