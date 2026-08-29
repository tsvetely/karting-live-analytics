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
// BASIC HELPERS
// ============================================================

function number(value) {
  const n =
    Number(value);

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


function pick(
  object,
  ...keys
) {
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


function sum(
  rows,
  getter
) {
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
      (a, b) =>
        a + b,
      0
    ) /
    clean.length
  );
}


// ============================================================
// CUSTOM DROPDOWNS
// ============================================================

function dropdownValue(id) {
  return (
    $(id)?.dataset.value ??
    ""
  );
}


function setDropdownValue(
  dropdownId,
  labelId,
  menuId,
  value,
  label
) {
  const dropdown =
    $(dropdownId);

  const labelNode =
    $(labelId);

  const menu =
    $(menuId);

  if (!dropdown) {
    return;
  }

  dropdown.dataset.value =
    value ?? "";

  if (labelNode) {
    labelNode.textContent =
      label ?? "";
  }

  if (menu) {
    menu
      .querySelectorAll(
        ".dropdownOption[data-value]"
      )
      .forEach(
        option => {

          const selected =
            String(
              option.dataset.value ?? ""
            ) ===
            String(
              value ?? ""
            );

          option.classList.toggle(
            "selected",
            selected
          );
        }
      );
  }
}


function closeAllDropdowns(
  except = null
) {
  document
    .querySelectorAll(
      ".dropdown.open"
    )
    .forEach(
      dropdown => {

        if (
          dropdown !== except
        ) {
          dropdown.classList.remove(
            "open"
          );
        }
      }
    );
}


function initDropdown(
  dropdownId,
  triggerId,
  menuId,
  onChange
) {
  const dropdown =
    $(dropdownId);

  const trigger =
    $(triggerId);

  const menu =
    $(menuId);

  if (
    !dropdown ||
    !trigger ||
    !menu
  ) {
    return;
  }

  trigger.addEventListener(
    "click",
    event => {

      event.stopPropagation();

      const shouldOpen =
        !dropdown.classList.contains(
          "open"
        );

      closeAllDropdowns();

      if (shouldOpen) {
        dropdown.classList.add(
          "open"
        );
      }
    }
  );


  menu.addEventListener(
    "click",
    async event => {

      const option =
        event.target.closest(
          ".dropdownOption[data-value]"
        );

      if (!option) {
        return;
      }

      event.stopPropagation();

      dropdown.classList.remove(
        "open"
      );

      await onChange(
        option.dataset.value ?? "",
        option
      );
    }
  );
}


document.addEventListener(
  "click",
  () =>
    closeAllDropdowns()
);


// ============================================================
// SELECTED RACE
// ============================================================

function isLiveRace() {
  return (
    S.source === "live"
  );
}


function selectedRaceId() {
  if (isLiveRace()) {
    return (
      S.liveMeta?.active === true
        ? (
            S.liveMeta?.race_id ??
            null
          )
        : null
    );
  }

  return S.raceId;
}


function liveDataAvailable() {
  return (
    !isLiveRace() ||
    S.liveMeta?.active === true
  );
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

  const autoControl =
    $("autoRefreshControl");

  if (isLiveRace()) {
    badge.className =
      "raceModeBadge live";

    badge.textContent =
      "LIVE";

    autoControl.classList.remove(
      "hidden"
    );

    $("overviewTitle").textContent =
      "Current race overview";

    $("overviewSubtitle").textContent =
      "Current driver and stint performance updated from live timing.";

    return;
  }


  badge.className =
    "raceModeBadge history";

  badge.textContent =
    "HISTORY";

  autoControl.classList.add(
    "hidden"
  );

  const raceName =
    $("raceDropdownLabel")
      ?.textContent ||
    `Race ${S.raceId}`;

  $("overviewTitle").textContent =
    raceName;

  $("overviewSubtitle").textContent =
    "Stored race overview and statistics.";
}


// ============================================================
// CURRENT VIEW DATA
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
    dropdownValue(
      "teamDropdown"
    );

  const selectedDriver =
    dropdownValue(
      "driverDropdown"
    );


  return rows.filter(
    row => {

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
          searchable.includes(
            search
          )
        )
      );
    }
  );
}


function rebuildFilters() {
  const rows =
    rowsForCurrentView();

  const previousTeam =
    dropdownValue(
      "teamDropdown"
    );

  const previousDriver =
    dropdownValue(
      "driverDropdown"
    );


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


  const teamMenu =
    $("teamDropdownMenu");

  const driverMenu =
    $("driverDropdownMenu");


  teamMenu.innerHTML = `
<button
  type="button"
  class="dropdownOption"
  data-value=""
>
  <span></span>
  <span>All teams</span>
  <span class="dropdownCheck">✓</span>
</button>
` +
    teams
      .map(
        team => `
<button
  type="button"
  class="dropdownOption"
  data-value="${esc(team)}"
>
  <span></span>
  <span>${esc(team)}</span>
  <span class="dropdownCheck">✓</span>
</button>
`
      )
      .join("");


  driverMenu.innerHTML = `
<button
  type="button"
  class="dropdownOption"
  data-value=""
>
  <span></span>
  <span>All drivers</span>
  <span class="dropdownCheck">✓</span>
</button>
` +
    drivers
      .map(
        driver => `
<button
  type="button"
  class="dropdownOption"
  data-value="${esc(driver)}"
>
  <span></span>
  <span>${esc(driver)}</span>
  <span class="dropdownCheck">✓</span>
</button>
`
      )
      .join("");


  const teamStillValid =
    teams.includes(
      previousTeam
    );

  const driverStillValid =
    drivers.includes(
      previousDriver
    );


  setDropdownValue(
    "teamDropdown",
    "teamDropdownLabel",
    "teamDropdownMenu",
    teamStillValid
      ? previousTeam
      : "",
    teamStillValid
      ? previousTeam
      : "All teams"
  );


  setDropdownValue(
    "driverDropdown",
    "driverDropdownLabel",
    "driverDropdownMenu",
    driverStillValid
      ? previousDriver
      : "",
    driverStillValid
      ? previousDriver
      : "All drivers"
  );
}


function resetFilters() {
  setDropdownValue(
    "teamDropdown",
    "teamDropdownLabel",
    "teamDropdownMenu",
    "",
    "All teams"
  );

  setDropdownValue(
    "driverDropdown",
    "driverDropdownLabel",
    "driverDropdownMenu",
    "",
    "All drivers"
  );

  $("search").value =
    "";

  renderActiveView();
}


// ============================================================
// CLEAR SELECTED RACE DATA
// ============================================================

function clearRaceData() {
  S.overview = [];
  S.stints = [];
  S.drivers = [];
  S.teams = [];
  S.pits = [];
  S.events = [];

  Object
    .keys(
      S.loaded
    )
    .forEach(
      key =>
        S.loaded[key] = false
    );
}


// ============================================================
// RACE / SESSION LIST
// ============================================================

async function loadRaceList() {
  const menu =
    $("raceDropdownMenu");

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


    menu.innerHTML = `
<div class="dropdownGroupLabel">
  LIVE
</div>

<button
  type="button"
  class="dropdownOption"
  data-value="live"
>
  <span class="dropdownStatusDot live"></span>
  <span>Current race</span>
  <span class="dropdownCheck">✓</span>
</button>
`;


    if (races.length) {
      menu.insertAdjacentHTML(
        "beforeend",
        `
<div class="dropdownDivider"></div>

<div class="dropdownGroupLabel">
  HISTORY
</div>
`
      );


      menu.insertAdjacentHTML(
        "beforeend",
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
<button
  type="button"
  class="dropdownOption"
  data-value="race:${esc(id)}"
>
  <span class="dropdownStatusDot history"></span>
  <span>${esc(label)}</span>
  <span class="dropdownCheck">✓</span>
</button>
`;
            }
          )
          .join("")
      );
    }


    setDropdownValue(
      "raceDropdown",
      "raceDropdownLabel",
      "raceDropdownMenu",
      isLiveRace()
        ? "live"
        : `race:${S.raceId}`,
      isLiveRace()
        ? "Current race"
        : (
            races.find(
              race =>
                String(
                  race.id ??
                  race.race_id
                ) ===
                String(S.raceId)
            )?.name ||

            races.find(
              race =>
                String(
                  race.id ??
                  race.race_id
                ) ===
                String(S.raceId)
            )?.session_name ||

            races.find(
              race =>
                String(
                  race.id ??
                  race.race_id
                ) ===
                String(S.raceId)
            )?.title ||

            races.find(
              race =>
                String(
                  race.id ??
                  race.race_id
                ) ===
                String(S.raceId)
            )?.label ||

            `Race ${S.raceId}`
          )
    );

  } catch (error) {
    console.warn(
      "Historical race list unavailable:",
      error
    );


    menu.innerHTML = `
<div class="dropdownGroupLabel">
  LIVE
</div>

<button
  type="button"
  class="dropdownOption selected"
  data-value="live"
>
  <span class="dropdownStatusDot live"></span>
  <span>Current race</span>
  <span class="dropdownCheck">✓</span>
</button>

<div class="dropdownDivider"></div>

<div class="dropdownGroupLabel">
  HISTORY
</div>

<div
  class="dropdownOption"
  style="cursor:default;opacity:.5"
>
  <span></span>
  <span>Historical races unavailable</span>
  <span></span>
</div>
`;


    setDropdownValue(
      "raceDropdown",
      "raceDropdownLabel",
      "raceDropdownMenu",
      "live",
      "Current race"
    );
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
    (
      isLiveRace()
        ? "LIVE"
        : "—"
    )
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
    No stint data for the selected race.
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
<tr
  class="clickableRow"
  data-detail-type="driver"
  data-team="${esc(row.team_name || "")}"
  data-driver="${esc(row.driver_name || "")}"
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
    No driver data for the selected race.
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
      )
      .sort(
        (a, b) =>
          String(
            a.team_name
          ).localeCompare(
            String(
              b.team_name
            )
          )
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
<tr
  class="clickableRow"
  data-detail-type="team"
  data-team="${esc(row.team_name || "")}"
  data-apex-id="${esc(row.apex_id || "")}"
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
    No team data for the selected race.
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
    No pit data for the selected race.
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
// ACTIVE VIEW
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
// LIVE CONTEXT
// ============================================================

async function ensureLiveContext() {
  if (!isLiveRace()) {
    return;
  }

  if (S.liveMeta) {
    return;
  }

  const data =
    await api(
      "/api/live",
      {
        raceId: null
      }
    );

  S.liveMeta =
    data;
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
          "/api/live",
          {
            raceId: null
          }
        );

      S.liveMeta =
        data;


      if (
        data.active === true
      ) {
        S.overview =
          data.current || [];

        $("headerTeamCount").textContent =
          S.overview.length;

        $("sessionStatus").textContent =
          "LIVE";

        setStatus(
          true,
          "LIVE"
        );

        $("updated").textContent =
          `Updated ${new Date().toLocaleTimeString()}`;

      } else {
        S.overview = [];

        $("headerTeamCount").textContent =
          0;

        $("sessionStatus").textContent =
          "NO LIVE SESSION";

        setStatus(
          true,
          "NO LIVE SESSION"
        );

        $("updated").textContent =
          "No active Apex timing session";
      }


      $("sessionName").textContent =
        data.session_name ||
        data.session ||
        "Apex Timing";

    } else {
      await Promise.all([
        loadStints(),
        loadDrivers()
      ]);

      buildTeams();


      const latest =
        new Map();


      for (
        const stint
        of S.stints
      ) {
        const key =
          String(
            stint.apex_id ??
            stint.team_name
          );

        const previous =
          latest.get(key);

        const start =
          Number(
            stint.start_lap_count ??
            -1
          );

        const previousStart =
          Number(
            previous?.start_lap_count ??
            -1
          );

        if (
          !previous ||
          start >= previousStart
        ) {
          latest.set(
            key,
            stint
          );
        }
      }


      S.overview =
        [...latest.values()];


      $("sessionName").textContent =
        $("raceDropdownLabel")
          ?.textContent ||
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
    showLoadError(
      error
    );
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
    if (isLiveRace()) {
      await ensureLiveContext();

      if (!liveDataAvailable()) {
        S.stints = [];

        S.loaded.stints =
          true;

        rebuildFilters();

        renderStints();

        return;
      }
    }


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
    if (isLiveRace()) {
      await ensureLiveContext();

      if (!liveDataAvailable()) {
        S.drivers = [];
        S.teams = [];

        S.loaded.drivers =
          true;

        S.loaded.teams =
          true;

        rebuildFilters();

        renderDrivers();

        return;
      }
    }


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
    if (isLiveRace()) {
      await ensureLiveContext();

      if (!liveDataAvailable()) {
        S.pits = [];

        S.loaded.pits =
          true;

        rebuildFilters();

        renderPits();

        return;
      }
    }


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
  /*
   * Backend endpoint for race events / exclusions
   * is still to be connected.
   */

  renderEvents();
}


// ============================================================
// ACTIVE VIEW LOAD
// ============================================================

async function loadActiveView(
  force = false
) {
  switch (S.activeView) {
    case "overview":
      await loadOverview(
        force
      );
      break;

    case "stints":
      await loadStints(
        force
      );
      break;

    case "drivers":
      await loadDrivers(
        force
      );
      break;

    case "teams":
      await loadTeams(
        force
      );
      break;

    case "pits":
      await loadPits(
        force
      );
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
// RACE DROPDOWN
// ============================================================

initDropdown(
  "raceDropdown",
  "raceDropdownTrigger",
  "raceDropdownMenu",

  async (
    value,
    option
  ) => {

    const label =
      option
        .querySelector(
          "span:nth-child(2)"
        )
        ?.textContent
        ?.trim() ||
      "Current race";


    if (value === "live") {
      S.source =
        "live";

      S.raceId =
        null;

      S.liveMeta =
        null;

      $("raceDropdownStatusDot").className =
        "dropdownStatusDot live";

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

      $("raceDropdownStatusDot").className =
        "dropdownStatusDot history";
    }


    setDropdownValue(
      "raceDropdown",
      "raceDropdownLabel",
      "raceDropdownMenu",
      value,
      label
    );


    clearRaceData();

    resetFilters();

    updateRaceContext();

    await loadActiveView(
      true
    );
  }
);


// ============================================================
// TEAM DROPDOWN
// ============================================================

initDropdown(
  "teamDropdown",
  "teamDropdownTrigger",
  "teamDropdownMenu",

  async (
    value,
    option
  ) => {

    const label =
      option
        .querySelector(
          "span:nth-child(2)"
        )
        ?.textContent
        ?.trim() ||
      "All teams";


    setDropdownValue(
      "teamDropdown",
      "teamDropdownLabel",
      "teamDropdownMenu",
      value,
      label
    );


    renderActiveView();
  }
);


// ============================================================
// DRIVER DROPDOWN
// ============================================================

initDropdown(
  "driverDropdown",
  "driverDropdownTrigger",
  "driverDropdownMenu",

  async (
    value,
    option
  ) => {

    const label =
      option
        .querySelector(
          "span:nth-child(2)"
        )
        ?.textContent
        ?.trim() ||
      "All drivers";


    setDropdownValue(
      "driverDropdown",
      "driverDropdownLabel",
      "driverDropdownMenu",
      value,
      label
    );


    renderActiveView();
  }
);


// ============================================================
// SEARCH / FILTERS
// ============================================================

$("search")
  .addEventListener(
    "input",
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

      if (isLiveRace()) {
        S.liveMeta =
          null;
      }

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
// PDF
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
  color: #111;
}

h1 {
  font-size: 20px;
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
  text-align: left;
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


// ============================================================
// ORGANISER REPORTS
// ============================================================

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

      if (!button) {
        return;
      }

      button.disabled =
        true;

      button.title =
        "Organiser report generator not connected yet";
    }
  );


// ============================================================
// MANUAL EXCLUSION
// ============================================================

$("addManualExclusion")
  ?.addEventListener(
    "click",
    () => {

      alert(
        "Manual lap exclusion backend is not connected yet."
      );
    }
  );


// ============================================================
// DETAIL DRAWER
// ============================================================

function openDrawer(
  title,
  html
) {
  $("detailTitle").textContent =
    title;

  $("detailContent").innerHTML =
    html;

  $("detailDrawer")
    .classList.add(
      "open"
    );
}


function closeDrawer() {
  $("detailDrawer")
    .classList.remove(
      "open"
    );
}


document.addEventListener(
  "click",
  event => {

    const row =
      event.target.closest(
        ".clickableRow"
      );

    if (!row) {
      return;
    }


    const team =
      row.dataset.team ||
      "Team";


    if (
      row.dataset.detailType ===
      "driver"
    ) {
      const driver =
        row.dataset.driver ||
        "Driver";

      openDrawer(
        driver,
        `
<p class="drawerSubtitle">
  ${esc(team)}
</p>

<p class="muted">
  Detailed driver analysis will use the selected race dataset.
</p>
`
      );

      return;
    }


    openDrawer(
      team,
      `
<p class="muted">
  Detailed team analysis will use the selected race dataset.
</p>
`
    );
  }
);


$("closeDetail")
  .addEventListener(
    "click",
    closeDrawer
  );


document.addEventListener(
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
    async () => {

      if (
        !isLiveRace() ||
        !$("auto").checked
      ) {
        return;
      }


      /*
       * Refresh ONLY the currently selected live view.
       *
       * OVERVIEW → live endpoint
       * STINTS   → live race stints
       * DRIVERS  → live race driver stats
       * TEAMS    → live race teams
       * PITS     → live race pits
       */

      clearRaceData();

      S.liveMeta =
        null;

      await loadActiveView(
        true
      );
    },
    1500
  );


// ============================================================
// INITIAL STATE
// ============================================================

setDropdownValue(
  "raceDropdown",
  "raceDropdownLabel",
  "raceDropdownMenu",
  "live",
  "Current race"
);


setDropdownValue(
  "teamDropdown",
  "teamDropdownLabel",
  "teamDropdownMenu",
  "",
  "All teams"
);


setDropdownValue(
  "driverDropdown",
  "driverDropdownLabel",
  "driverDropdownMenu",
  "",
  "All drivers"
);


updateRaceContext();

loadRaceList();

loadOverview(
  true
);
