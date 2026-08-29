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

  const fetchOptions = {
    method:
      options.method || "GET",

    cache:
      "no-store",

    headers: {
      ...(options.headers || {})
    }
  };


  if (
    options.body !== undefined
  ) {
    fetchOptions.headers[
      "content-type"
    ] =
      "application/json";

    fetchOptions.body =
      JSON.stringify(
        options.body
      );
  }


  const response =
    await fetch(
      url,
      fetchOptions
    );


  if (!response.ok) {
    const message =
      await response.text();

    throw new Error(
      message ||
      `${response.status} ${response.statusText}`
    );
  }


  const contentType =
    response.headers.get(
      "content-type"
    ) || "";


  if (
    contentType.includes(
      "application/json"
    )
  ) {
    return response.json();
  }


  return response.text();
}


// ============================================================
// URL / DOWNLOAD HELPERS
// ============================================================

function apiUrl(
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


  if (options.apexId) {
    url.searchParams.set(
      "apex_id",
      String(
        options.apexId
      )
    );
  }


  if (options.team) {
    url.searchParams.set(
      "team",
      String(
        options.team
      )
    );
  }


  return url;
}


function selectedReportTeam() {
  return (
    dropdownValue(
      "teamDropdown"
    ) || null
  );
}


function openReportWindow(path) {
  const url =
    apiUrl(
      path,
      {
        team:
          selectedReportTeam()
      }
    );


  const win =
    window.open(
      url.toString(),
      "_blank"
    );


  if (!win) {
    alert(
      "The browser blocked the report window."
    );
  }
}


function downloadFromEndpoint(path) {
  const url =
    apiUrl(
      path,
      {
        team:
          selectedReportTeam()
      }
    );


  const link =
    document.createElement(
      "a"
    );


  link.href =
    url.toString();

  link.style.display =
    "none";


  document.body.appendChild(
    link
  );


  link.click();
  link.remove();
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
          row.kart_number,
          row.lap_number,
          row.reason,
          row.type
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


// ============================================================
// SEARCHABLE CUSTOM DROPDOWNS
// ============================================================

function normalizeSearchText(value) {
  return String(
    value ?? ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}


function optionLabel(option) {
  return (
    option
      ?.querySelector(
        "span:nth-child(2)"
      )
      ?.textContent
      ?.trim() ||
    option
      ?.textContent
      ?.trim() ||
    ""
  );
}


function searchableDropdown(
  dropdownId,
  menuId
) {
  const dropdown =
    $(dropdownId);

  const menu =
    $(menuId);


  if (
    !dropdown ||
    !menu
  ) {
    return;
  }


  let search =
    dropdown.querySelector(
      ".dropdownSearch"
    );


  if (!search) {
    search =
      document.createElement(
        "input"
      );

    search.type =
      "text";

    search.className =
      "dropdownSearch";

    search.placeholder =
      "Type to search…";

    search.autocomplete =
      "off";

    search.spellcheck =
      false;

    menu.prepend(
      search
    );
  }


  const filter =
    () => {

      const query =
        normalizeSearchText(
          search.value
        );


      menu
        .querySelectorAll(
          ".dropdownOption[data-value]"
        )
        .forEach(
          option => {

            const label =
              normalizeSearchText(
                optionLabel(
                  option
                )
              );


            option.hidden =
              !!query &&
              !label.includes(
                query
              );
          }
        );
    };


  search.addEventListener(
    "input",
    filter
  );


  search.addEventListener(
    "click",
    event =>
      event.stopPropagation()
  );


  search.addEventListener(
    "keydown",
    event => {

      const visible =
        [
          ...menu.querySelectorAll(
            ".dropdownOption[data-value]:not([hidden])"
          )
        ];


      if (!visible.length) {
        return;
      }


      const current =
        visible.findIndex(
          option =>
            option.classList.contains(
              "keyboardActive"
            )
        );


      if (
        event.key ===
        "ArrowDown"
      ) {
        event.preventDefault();

        visible.forEach(
          option =>
            option.classList.remove(
              "keyboardActive"
            )
        );


        const next =
          visible[
            current < 0
              ? 0
              : (
                  current + 1
                ) %
                visible.length
          ];


        next.classList.add(
          "keyboardActive"
        );

        next.scrollIntoView({
          block:
            "nearest"
        });

        return;
      }


      if (
        event.key ===
        "ArrowUp"
      ) {
        event.preventDefault();

        visible.forEach(
          option =>
            option.classList.remove(
              "keyboardActive"
            )
        );


        const next =
          visible[
            current < 0
              ? visible.length - 1
              : (
                  current -
                  1 +
                  visible.length
                ) %
                visible.length
          ];


        next.classList.add(
          "keyboardActive"
        );

        next.scrollIntoView({
          block:
            "nearest"
        });

        return;
      }


      if (
        event.key ===
        "Enter"
      ) {
        const active =
          visible.find(
            option =>
              option.classList.contains(
                "keyboardActive"
              )
          ) ||
          visible[0];


        if (active) {
          event.preventDefault();
          active.click();
        }

        return;
      }


      if (
        event.key ===
        "Escape"
      ) {
        event.preventDefault();

        dropdown.classList.remove(
          "open"
        );

        search.value =
          "";

        filter();
      }
    }
  );


  const observer =
    new MutationObserver(
      () => {
        if (
          !menu.contains(
            search
          )
        ) {
          menu.prepend(
            search
          );
        }

        filter();
      }
    );


  observer.observe(
    menu,
    {
      childList:
        true
    }
  );


  const trigger =
    dropdown.querySelector(
      ".dropdownTrigger"
    );


  trigger?.addEventListener(
    "click",
    () => {
      setTimeout(
        () => {

          if (
            dropdown.classList.contains(
              "open"
            )
          ) {
            search.value =
              "";

            filter();

            search.focus();
          }
        },
        0
      );
    }
  );
}


// ============================================================
// FILTER MENUS
// ============================================================

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
      .sort(
        (a, b) =>
          String(a)
            .localeCompare(
              String(b)
            )
      );


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
      .sort(
        (a, b) =>
          String(a)
            .localeCompare(
              String(b)
            )
      );


  const teamMenu =
    $("teamDropdownMenu");

  const driverMenu =
    $("driverDropdownMenu");


  const teamSearch =
    teamMenu.querySelector(
      ".dropdownSearch"
    );


  const driverSearch =
    driverMenu.querySelector(
      ".dropdownSearch"
    );


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


  if (teamSearch) {
    teamMenu.prepend(
      teamSearch
    );
  }


  if (driverSearch) {
    driverMenu.prepend(
      driverSearch
    );
  }


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


    const search =
      menu.querySelector(
        ".dropdownSearch"
      );


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
                race.label ||
                race.name ||
                race.session_name ||
                race.title ||
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


    if (search) {
      menu.prepend(
        search
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
            )?.label ||

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

            `Race ${S.raceId}`
          )
    );


    return races;

  } catch (error) {
    console.warn(
      "Historical race list unavailable:",
      error
    );


    const search =
      menu.querySelector(
        ".dropdownSearch"
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


    if (search) {
      menu.prepend(
        search
      );
    }


    setDropdownValue(
      "raceDropdown",
      "raceDropdownLabel",
      "raceDropdownMenu",
      "live",
      "Current race"
    );


    return [];
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
    filterRows(S.overview)
      .slice()
      .sort((a, b) => {

        const pa =
          number(
            a.position
          );

        const pb =
          number(
            b.position
          );


        if (
          pa !== null &&
          pb !== null &&
          pa !== pb
        ) {
          return pa - pb;
        }


        if (
          pa !== null &&
          pb === null
        ) {
          return -1;
        }


        if (
          pa === null &&
          pb !== null
        ) {
          return 1;
        }


        const la =
          number(
            pick(
              a,
              "race_lap",
              "live_lap_count"
            )
          ) || 0;


        const lb =
          number(
            pick(
              b,
              "race_lap",
              "live_lap_count"
            )
          ) || 0;


        return lb - la;
      });


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

<td class="position">
  ${esc(row.position ?? "—")}
</td>

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
  ${esc(
    pick(
      row,
      "race_lap",
      "live_lap_count"
    ) ?? "—"
  )}
</td>

<td>
  ${esc(
    row.pit_count ??
    "—"
  )}
</td>

<td>
  #${esc(
    row.stint_number ??
    stintNumber(row)
  )}
</td>

<td>
  ${esc(
    pick(
      row,
      "total_stint_laps",
      "stint_laps",
      "total_laps"
    ) ?? "—"
  )}
</td>

<td>
  ${esc(
    row.valid_laps ??
    "—"
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
  <td colspan="16">
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
      row.is_live
        ? "LIVE"
        : "—"
    )
  )}
</td>

<td>
  ${esc(
    row.total_laps ??
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
  <td colspan="13">
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
    [
      ...groups.entries()
    ]
      .map(
        (
          [
            teamName,
            drivers
          ]
        ) => {

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
              (
                total,
                row
              ) => {

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
                  pace *
                  laps
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
        (a, b) => {

          if (
            b.total_laps !==
            a.total_laps
          ) {
            return (
              b.total_laps -
              a.total_laps
            );
          }


          const aa =
            number(
              a.avg_lap_time
            ) ??
            Number.POSITIVE_INFINITY;


          const bb =
            number(
              b.avg_lap_time
            ) ??
            Number.POSITIVE_INFINITY;


          return aa - bb;
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

function pitDurationSeconds(row) {
  const direct =
    number(
      pick(
        row,
        "pit_duration",
        "pit_duration_seconds",
        "duration_seconds"
      )
    );

  if (direct !== null) {
    return direct;
  }


  const value =
    pick(
      row,
      "pit_time",
      "duration"
    );


  if (
    typeof value === "number"
  ) {
    return value;
  }


  const text =
    String(
      value ?? ""
    ).trim();


  if (!text) {
    return null;
  }


  const match =
    /^(\d+):(\d{2})(?:\.(\d{1,3}))?$/
      .exec(text);


  if (!match) {
    return number(text);
  }


  const minutes =
    Number(match[1]);

  const seconds =
    Number(match[2]);

  const millis =
    match[3]
      ? Number(
          match[3].padEnd(
            3,
            "0"
          )
        )
      : 0;


  return (
    minutes * 60 +
    seconds +
    millis / 1000
  );
}


function formatPitDuration(row) {
  const original =
    pick(
      row,
      "pit_time",
      "duration"
    );


  if (
    typeof original === "string" &&
    original.trim()
  ) {
    return original;
  }


  const seconds =
    pitDurationSeconds(row);


  if (seconds === null) {
    return "—";
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


  return `${minutes}:${rest}`;
}


function pitStintNumber(row) {
  const explicit =
    pick(
      row,
      "stint_number",
      "stint_no",
      "stint_index"
    );


  if (
    explicit !== null
  ) {
    return explicit;
  }


  const pitNumber =
    number(
      row.pit_number
    );


  return pitNumber !== null
    ? pitNumber
    : "—";
}


function renderPits() {
  const rows =
    filterRows(
      S.pits
    );


  $("pitsBody").innerHTML =
    rows
      .map(
        row => {

          const lap =
            pick(
              row,
              "pit_lap",
              "lap_number",
              "lap"
            );


          const driver =
            pick(
              row,
              "driver_name",
              "driver"
            );


          return `
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
    driver ||
    "—"
  )}
</td>

<td>
  #${esc(
    pitStintNumber(row)
  )}
</td>

<td>
  ${esc(
    lap ?? "—"
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
  ${formatPitDuration(row)}
</td>

<td>
  ${esc(
    row.total_time ??
    "—"
  )}
</td>

</tr>
`;
        }
      )
      .join("") ||

`
<tr class="empty">
  <td colspan="8">
    No pit-stop data for the selected race.
  </td>
</tr>
`;
}


// ============================================================
// EVENTS
// ============================================================

function eventType(row) {
  return (
    row.type ||
    row.event_type ||
    "MANUAL EXCLUSION"
  );
}


function eventLap(row) {
  return pick(
    row,
    "lap_number",
    "lap",
    "start_lap"
  );
}


function eventReason(row) {
  return (
    row.reason ||
    row.description ||
    "—"
  );
}


function renderEvents() {
  const rows =
    filterRows(
      S.events
    );


  $("eventsBody").innerHTML =
    rows
      .map(
        row => {

          const apexId =
            String(
              row.apex_id ??
              ""
            );


          const lap =
            eventLap(row);


          const canRemove =
            apexId &&
            lap !== null &&
            lap !== undefined &&
            String(
              eventType(row)
            )
              .toUpperCase()
              .includes(
                "MANUAL"
              );


          return `
<tr>

<td>
  ${esc(
    row.time
      ? new Date(
          row.time
        ).toLocaleTimeString()
      : (
          row.created_at
            ? new Date(
                row.created_at
              ).toLocaleTimeString()
            : "—"
        )
  )}
</td>

<td>
  ${esc(
    eventType(row)
  )}
</td>

<td class="team">
  ${esc(
    row.team_name ||
    (
      apexId
        ? `APEX ${apexId}`
        : "—"
    )
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
    lap ?? "—"
  )}
</td>

<td>
  ${esc(
    eventReason(row)
  )}
</td>

<td>
  ${esc(
    row.status ||
    "ACTIVE"
  )}
</td>

<td>
  ${
    canRemove
      ? `
<button
  type="button"
  class="eventRemoveButton"
  data-remove-exclusion="1"
  data-apex-id="${esc(apexId)}"
  data-lap-number="${esc(lap)}"
>
  Include
</button>
`
      : "—"
  }
</td>

</tr>
`;
        }
      )
      .join("") ||

`
<tr class="empty">
  <td colspan="8">
    No recorded events for the selected race.
  </td>
</tr>
`;
}


// ============================================================
// REPORTS
// ============================================================

function renderReports() {
  const raceReady =
    selectedRaceId() !== null &&
    selectedRaceId() !== undefined;


  const liveUnavailable =
    isLiveRace() &&
    S.liveMeta?.active === false;


  const disabled =
    !raceReady ||
    liveUnavailable;


  const buttons = [
    $("downloadRaceCsv"),
    $("downloadRacePdf"),
    $("organiserReport1Csv"),
    $("organiserReport1Pdf"),
    $("organiserReport2Csv"),
    $("organiserReport2Pdf")
  ]
    .filter(Boolean);


  for (const button of buttons) {
    button.disabled =
      disabled;

    button.classList.toggle(
      "disabled",
      disabled
    );
  }


  const report1Csv =
    $("organiserReport1Csv");


  if (report1Csv) {
    report1Csv.disabled =
      disabled;

    report1Csv.title =
      disabled
        ? "No race selected"
        : "Download Apex-style Lap Time Records CSV";
  }


  const report1Pdf =
    $("organiserReport1Pdf");


  if (report1Pdf) {
    /*
     * Mandatory organiser report #1 is CSV.
     * There is no fake PDF version of the Lap Time Records
     * source report.
     */
    report1Pdf.disabled =
      true;

    report1Pdf.classList.add(
      "disabled"
    );

    report1Pdf.title =
      "Lap Time Records is a CSV report.";
  }


  const report2Pdf =
    $("organiserReport2Pdf");


  if (report2Pdf) {
    report2Pdf.disabled =
      disabled;

    report2Pdf.title =
      disabled
        ? "No race selected"
        : "Open Apex-style Pit Stops report for Print / Save PDF";
  }


  const report2Csv =
    $("organiserReport2Csv");


  if (report2Csv) {
    /*
     * Mandatory organiser report #2 is PDF.
     */
    report2Csv.disabled =
      true;

    report2Csv.classList.add(
      "disabled"
    );

    report2Csv.title =
      "Pit Stops is a PDF report.";
  }
}


// ============================================================
// ACTIVE VIEW
// ============================================================

function renderActiveView() {
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


  $(
    `view-${S.activeView}`
  )
    ?.classList.add(
      "active"
    );


  document
    .querySelectorAll(
      ".nav button"
    )
    .forEach(
      button =>
        button.classList.toggle(
          "active",
          button.dataset.view ===
          S.activeView
        )
    );


  if (
    S.activeView ===
    "overview"
  ) {
    renderOverview();

  } else if (
    S.activeView ===
    "stints"
  ) {
    renderStints();

  } else if (
    S.activeView ===
    "drivers"
  ) {
    renderDrivers();

  } else if (
    S.activeView ===
    "teams"
  ) {
    renderTeams();

  } else if (
    S.activeView ===
    "pits"
  ) {
    renderPits();

  } else if (
    S.activeView ===
    "events"
  ) {
    renderEvents();

  } else if (
    S.activeView ===
    "reports"
  ) {
    renderReports();
  }


  if (
    S.activeView !==
    "reports"
  ) {
    rebuildFilters();
  }
}


// ============================================================
// API PAYLOAD NORMALIZATION
// ============================================================

function payloadRows(payload) {
  if (
    Array.isArray(payload)
  ) {
    return payload;
  }


  if (
    Array.isArray(
      payload?.rows
    )
  ) {
    return payload.rows;
  }


  if (
    Array.isArray(
      payload?.current
    )
  ) {
    return payload.current;
  }


  return [];
}


// ============================================================
// LOAD OVERVIEW
// ============================================================

async function loadOverview() {
  if (
    isLiveRace()
  ) {
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
      data.active === false
    ) {
      S.overview = [];

      S.loaded.overview =
        true;

      setStatus(
        false,
        "NO LIVE SESSION"
      );

      updateRaceContext();
      renderOverview();
      renderReports();

      return;
    }


    S.overview =
      data.current ||
      [];


    S.raceId =
      data.race_id ??
      S.raceId;


    S.loaded.overview =
      true;


    setStatus(
      true,
      "LIVE"
    );


    updateRaceContext();
    renderOverview();
    renderReports();

    return;
  }


  const data =
    await api(
      "/api/overview"
    );


  S.overview =
    payloadRows(data);


  S.loaded.overview =
    true;


  setStatus(
    true,
    "HISTORY"
  );


  updateRaceContext();
  renderOverview();
  renderReports();
}


// ============================================================
// LOAD STINTS
// ============================================================

async function loadStints(
  force = false
) {
  if (
    S.loaded.stints &&
    !force
  ) {
    return;
  }


  if (
    !liveDataAvailable()
  ) {
    S.stints = [];

    S.loaded.stints =
      true;

    return;
  }


  const data =
    await api(
      "/api/stints"
    );


  S.stints =
    payloadRows(data);


  S.loaded.stints =
    true;
}


// ============================================================
// LOAD DRIVERS
// ============================================================

async function loadDrivers(
  force = false
) {
  if (
    S.loaded.drivers &&
    !force
  ) {
    return;
  }


  if (
    !liveDataAvailable()
  ) {
    S.drivers = [];

    S.loaded.drivers =
      true;

    return;
  }


  const data =
    await api(
      "/api/drivers"
    );


  S.drivers =
    payloadRows(data);


  S.loaded.drivers =
    true;


  /*
   * Prefer backend team aggregation when available.
   * buildTeams() remains a fallback.
   */
  try {
    const teamData =
      await api(
        "/api/teams"
      );


    const backendTeams =
      payloadRows(
        teamData
      );


    if (
      backendTeams.length
    ) {
      S.teams =
        backendTeams;

    } else {
      buildTeams();
    }

  } catch {
    buildTeams();
  }


  S.loaded.teams =
    true;
}


// ============================================================
// LOAD TEAMS
// ============================================================

async function loadTeams(
  force = false
) {
  if (
    S.loaded.teams &&
    !force
  ) {
    return;
  }


  if (
    !liveDataAvailable()
  ) {
    S.teams = [];

    S.loaded.teams =
      true;

    return;
  }


  try {
    const data =
      await api(
        "/api/teams"
      );


    S.teams =
      payloadRows(data);


    if (
      !S.teams.length
    ) {
      await loadDrivers(
        force
      );

      buildTeams();
    }

  } catch {
    await loadDrivers(
      force
    );

    buildTeams();
  }


  S.loaded.teams =
    true;
}


// ============================================================
// LOAD PITS
// ============================================================

async function loadPits(
  force = false
) {
  if (
    S.loaded.pits &&
    !force
  ) {
    return;
  }


  if (
    !liveDataAvailable()
  ) {
    S.pits = [];

    S.loaded.pits =
      true;

    return;
  }


  const data =
    await api(
      "/api/pits"
    );


  S.pits =
    payloadRows(data);


  S.loaded.pits =
    true;
}


// ============================================================
// LOAD EVENTS
// ============================================================

async function loadEvents(
  force = false
) {
  if (
    S.loaded.events &&
    !force
  ) {
    return;
  }


  if (
    !liveDataAvailable()
  ) {
    S.events = [];

    S.loaded.events =
      true;

    return;
  }


  const data =
    await api(
      "/api/events"
    );


  S.events =
    payloadRows(data);


  S.loaded.events =
    true;
}


// ============================================================
// LOAD CURRENT VIEW
// ============================================================

async function loadCurrentView(
  force = false
) {
  try {

    if (
      S.activeView ===
      "overview"
    ) {
      await loadOverview();

    } else if (
      S.activeView ===
      "stints"
    ) {
      await loadStints(
        force
      );

    } else if (
      S.activeView ===
      "drivers"
    ) {
      await loadDrivers(
        force
      );

    } else if (
      S.activeView ===
      "teams"
    ) {
      await loadTeams(
        force
      );

    } else if (
      S.activeView ===
      "pits"
    ) {
      await loadPits(
        force
      );

    } else if (
      S.activeView ===
      "events"
    ) {
      await loadEvents(
        force
      );
    }


    renderActiveView();

  } catch (error) {
    console.error(
      error
    );


    setStatus(
      false,
      "ERROR"
    );


    const activeBody =
      $(
        `${S.activeView}Body`
      );


    if (activeBody) {
      const colspan = {
        overview: 16,
        stints: 13,
        drivers: 9,
        teams: 9,
        pits: 8,
        events: 8
      }[
        S.activeView
      ] || 1;


      activeBody.innerHTML = `
<tr class="empty">
  <td colspan="${colspan}">
    ${esc(
      error.message ||
      "Unable to load data."
    )}
  </td>
</tr>
`;
    }
  }
}


// ============================================================
// LIVE REFRESH
// ============================================================

async function refreshLive() {
  if (
    !isLiveRace()
  ) {
    return;
  }


  try {
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
      data.active === false
    ) {
      S.overview = [];

      setStatus(
        false,
        "NO LIVE SESSION"
      );

      updateRaceContext();


      if (
        S.activeView ===
        "overview"
      ) {
        renderOverview();
      }


      renderReports();

      return;
    }


    const oldRaceId =
      S.raceId;


    S.raceId =
      data.race_id ??
      S.raceId;


    S.overview =
      data.current ||
      [];


    S.loaded.overview =
      true;


    /*
     * New live race/session:
     * discard cached historical detail data.
     */
    if (
      oldRaceId !== null &&
      S.raceId !== null &&
      String(oldRaceId) !==
      String(S.raceId)
    ) {
      S.stints = [];
      S.drivers = [];
      S.teams = [];
      S.pits = [];
      S.events = [];

      S.loaded.stints =
        false;

      S.loaded.drivers =
        false;

      S.loaded.teams =
        false;

      S.loaded.pits =
        false;

      S.loaded.events =
        false;
    }


    setStatus(
      true,
      "LIVE"
    );


    updateRaceContext();


    if (
      S.activeView ===
      "overview"
    ) {
      renderOverview();
      rebuildFilters();
    }


    /*
     * Current detailed tab can also refresh while LIVE.
     * Only the active dataset is refreshed.
     */
    if (
      S.activeView ===
      "stints"
    ) {
      await loadStints(
        true
      );

      renderStints();
      rebuildFilters();

    } else if (
      S.activeView ===
      "drivers"
    ) {
      await loadDrivers(
        true
      );

      renderDrivers();
      rebuildFilters();

    } else if (
      S.activeView ===
      "teams"
    ) {
      await loadTeams(
        true
      );

      renderTeams();
      rebuildFilters();

    } else if (
      S.activeView ===
      "pits"
    ) {
      await loadPits(
        true
      );

      renderPits();
      rebuildFilters();

    } else if (
      S.activeView ===
      "events"
    ) {
      await loadEvents(
        true
      );

      renderEvents();
      rebuildFilters();
    }


    renderReports();

  } catch (error) {
    console.error(
      error
    );

    setStatus(
      false,
      "CONNECTION ERROR"
    );
  }
}


// ============================================================
// REFRESH TIMER
// ============================================================

function updateRefreshTimer() {
  if (S.timer) {
    clearInterval(
      S.timer
    );

    S.timer =
      null;
  }


  if (
    !isLiveRace() ||
    !$("autoRefresh").checked
  ) {
    return;
  }


  S.timer =
    setInterval(
      refreshLive,
      3000
    );
}


// ============================================================
// RACE CHANGE
// ============================================================

async function selectRaceOption(
  value,
  option
) {
  if (
    value === "live"
  ) {
    S.source =
      "live";

    S.raceId =
      null;


    setDropdownValue(
      "raceDropdown",
      "raceDropdownLabel",
      "raceDropdownMenu",
      "live",
      "Current race"
    );

  } else if (
    value.startsWith(
      "race:"
    )
  ) {
    S.source =
      "history";

    S.raceId =
      value.slice(
        5
      );


    setDropdownValue(
      "raceDropdown",
      "raceDropdownLabel",
      "raceDropdownMenu",
      value,
      optionLabel(option)
    );

  } else {
    return;
  }


  clearRaceData();
  resetFilters();

  updateRaceContext();
  updateRefreshTimer();


  await loadCurrentView(
    true
  );
}


// ============================================================
// VIEW CHANGE
// ============================================================

async function switchView(view) {
  if (!view) {
    return;
  }


  S.activeView =
    view;


  renderActiveView();


  await loadCurrentView();
}


// ============================================================
// CSV HELPERS FOR ANALYTICS REPORT
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


function downloadText(
  filename,
  content,
  contentType =
    "text/plain;charset=utf-8"
) {
  const blob =
    new Blob(
      [
        "\uFEFF",
        content
      ],
      {
        type:
          contentType
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

  link.style.display =
    "none";


  document.body.appendChild(
    link
  );


  link.click();
  link.remove();


  setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    1000
  );
}


function reportBaseName() {
  const raceLabel =
    $("raceDropdownLabel")
      ?.textContent
      ?.trim() ||
    "Race";


  return raceLabel
    .replace(
      /[\\/:*?"<>|]+/g,
      "-"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


// ============================================================
// RACE ANALYTICS CSV
// ============================================================

async function buildRaceAnalyticsCsv() {
  await Promise.all([
    loadStints(),
    loadDrivers(),
    loadTeams(),
    loadPits(),
    loadEvents()
  ]);


  const lines = [];


  lines.push(
    "Race Engineer Analytics"
  );


  lines.push(
    `Race,${csvEscape(
      $("raceDropdownLabel")
        ?.textContent ||
      ""
    )}`
  );


  lines.push(
    `Generated,${csvEscape(
      new Date()
        .toISOString()
    )}`
  );


  lines.push("");
  lines.push("STINTS");


  lines.push(
    [
      "Team",
      "Driver",
      "Stint",
      "Start Lap",
      "End Lap",
      "Total Laps",
      "Valid Laps",
      "Average",
      "Best",
      "Best Lap",
      "Worst",
      "Worst Lap",
      "Consistency"
    ]
      .join(",")
  );


  for (
    const row
    of S.stints
  ) {
    lines.push(
      [
        row.team_name,
        row.driver_name,
        row.stint_number ||
          stintNumber(row),
        row.start_lap_count,
        row.end_lap_count ??
          (
            row.is_live
              ? "LIVE"
              : ""
          ),
        row.total_laps,
        row.valid_laps,
        pick(
          row,
          "avg_lap_time",
          "avg_lap"
        ),
        pick(
          row,
          "best_lap_time",
          "best_lap"
        ),
        row.best_lap_number,
        pick(
          row,
          "worst_lap_time",
          "worst_lap",
          "max_lap_time"
        ),
        row.worst_lap_number,
        pick(
          row,
          "consistency",
          "consistency_time",
          "lap_consistency"
        )
      ]
        .map(
          csvEscape
        )
        .join(",")
    );
  }


  lines.push("");
  lines.push("DRIVERS");


  lines.push(
    [
      "Team",
      "Driver",
      "Stints",
      "Short Stints",
      "Valid Laps",
      "Total Laps",
      "Average",
      "Best",
      "Consistency"
    ]
      .join(",")
  );


  for (
    const row
    of S.drivers
  ) {
    lines.push(
      [
        row.team_name,
        row.driver_name,
        row.valid_stint_count,
        row.short_stint_count,
        row.valid_laps,
        row.total_laps,
        row.avg_lap_time,
        row.best_lap_time,
        row.avg_consistency
      ]
        .map(
          csvEscape
        )
        .join(",")
    );
  }


  lines.push("");
  lines.push("TEAMS");


  lines.push(
    [
      "Team",
      "Drivers",
      "Stints",
      "Valid Laps",
      "Total Laps",
      "Average",
      "Best",
      "Consistency",
      "Driver Spread"
    ]
      .join(",")
  );


  for (
    const row
    of S.teams
  ) {
    lines.push(
      [
        row.team_name,
        row.driver_count,
        row.valid_stint_count ??
          row.stint_count,
        row.valid_laps,
        row.total_laps,
        row.avg_lap_time,
        row.best_lap_time,
        row.avg_consistency,
        row.driver_spread
      ]
        .map(
          csvEscape
        )
        .join(",")
    );
  }


  lines.push("");
  lines.push("PIT STOPS");


  lines.push(
    [
      "Team",
      "Driver",
      "Pit",
      "Lap",
      "Hour",
      "On Track",
      "Pit Time",
      "Total"
    ]
      .join(",")
  );


  for (
    const row
    of S.pits
  ) {
    lines.push(
      [
        row.team_name,
        row.driver_name,
        row.pit_number,
        row.pit_lap,
        row.pit_hour,
        row.on_track,
        row.pit_time,
        row.total_time
      ]
        .map(
          csvEscape
        )
        .join(",")
    );
  }


  return lines.join(
    "\n"
  );
}


// ============================================================
// RACE ANALYTICS PRINTABLE PDF SOURCE
// ============================================================

function printableAnalyticsHtml() {
  const teamRows =
    S.teams
      .map(
        row => `
<tr>
  <td>${esc(row.team_name)}</td>
  <td>${esc(row.driver_count ?? "—")}</td>
  <td>${esc(row.valid_stint_count ?? row.stint_count ?? "—")}</td>
  <td>${esc(row.valid_laps ?? "—")}</td>
  <td>${esc(row.total_laps ?? "—")}</td>
  <td>${time(row.avg_lap_time)}</td>
  <td>${time(row.best_lap_time)}</td>
  <td>${time(row.avg_consistency)}</td>
  <td>${time(row.driver_spread)}</td>
</tr>
`
      )
      .join("");


  const driverRows =
    S.drivers
      .map(
        row => `
<tr>
  <td>${esc(row.team_name)}</td>
  <td>${esc(row.driver_name)}</td>
  <td>${esc(row.valid_stint_count ?? "—")}</td>
  <td>${esc(row.valid_laps ?? "—")}</td>
  <td>${esc(row.total_laps ?? "—")}</td>
  <td>${time(row.avg_lap_time)}</td>
  <td>${time(row.best_lap_time)}</td>
  <td>${time(row.avg_consistency)}</td>
</tr>
`
      )
      .join("");


  const stintRows =
    S.stints
      .map(
        row => `
<tr>
  <td>${esc(row.team_name)}</td>
  <td>${esc(row.driver_name)}</td>
  <td>${esc(row.stint_number || stintNumber(row))}</td>
  <td>${esc(row.start_lap_count ?? "—")}</td>
  <td>${esc(row.end_lap_count ?? (row.is_live ? "LIVE" : "—"))}</td>
  <td>${esc(row.total_laps ?? "—")}</td>
  <td>${esc(row.valid_laps ?? "—")}</td>
  <td>${time(pick(row, "avg_lap_time", "avg_lap"))}</td>
  <td>${time(pick(row, "best_lap_time", "best_lap"))}</td>
  <td>${esc(row.best_lap_number ?? "—")}</td>
  <td>${time(pick(row, "worst_lap_time", "worst_lap", "max_lap_time"))}</td>
  <td>${esc(row.worst_lap_number ?? "—")}</td>
  <td>${time(pick(row, "consistency", "consistency_time", "lap_consistency"))}</td>
</tr>
`
      )
      .join("");


  return `<!doctype html>

<html>

<head>

<meta charset="utf-8">

<title>
${esc(reportBaseName())} - Race analytics
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

  color: #111;
  margin: 0;
  font-size: 9px;
}

h1 {
  margin: 0 0 4px;
  font-size: 18px;
}

.meta {
  color: #555;
  margin-bottom: 16px;
}

h2 {
  margin:
    18px 0
    6px;

  font-size: 13px;
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
  background: #e9e9e9;
  text-align: left;
}

tr:nth-child(even) td {
  background: #f8f8f8;
}

.print {
  position: fixed;
  right: 12px;
  top: 12px;
  padding: 8px 12px;
}

@media print {
  .print {
    display: none;
  }
}

</style>

</head>

<body>

<button
  class="print"
  onclick="window.print()"
>
  Print / Save PDF
</button>

<h1>
  ${esc(reportBaseName())}
</h1>

<div class="meta">
  Race Engineer Analytics —
  generated
  ${esc(
    new Date()
      .toLocaleString()
  )}
</div>


<h2>
  Teams
</h2>

<table>

<thead>
<tr>
  <th>Team</th>
  <th>Drivers</th>
  <th>Stints</th>
  <th>Valid laps</th>
  <th>Total laps</th>
  <th>Average</th>
  <th>Best</th>
  <th>Consistency</th>
  <th>Driver spread</th>
</tr>
</thead>

<tbody>
${teamRows}
</tbody>

</table>


<h2>
  Drivers
</h2>

<table>

<thead>
<tr>
  <th>Team</th>
  <th>Driver</th>
  <th>Stints</th>
  <th>Valid laps</th>
  <th>Total laps</th>
  <th>Average</th>
  <th>Best</th>
  <th>Consistency</th>
</tr>
</thead>

<tbody>
${driverRows}
</tbody>

</table>


<h2>
  Stints
</h2>

<table>

<thead>
<tr>
  <th>Team</th>
  <th>Driver</th>
  <th>Stint</th>
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
</tr>
</thead>

<tbody>
${stintRows}
</tbody>

</table>

</body>

</html>`;
}


// ============================================================
// OPEN PRINTABLE ANALYTICS
// ============================================================

async function openAnalyticsPdf() {
  await Promise.all([
    loadStints(),
    loadDrivers(),
    loadTeams()
  ]);


  const win =
    window.open(
      "",
      "_blank"
    );


  if (!win) {
    alert(
      "The browser blocked the report window."
    );

    return;
  }


  win.document.open();

  win.document.write(
    printableAnalyticsHtml()
  );

  win.document.close();
}


// ============================================================
// MANUAL EXCLUSION
// ============================================================

async function addManualExclusion({
  apexId,
  lapNumber,
  reason
}) {
  await api(
    "/api/events",
    {
      method:
        "POST",

      body: {
        apex_id:
          apexId,

        lap_number:
          Number(
            lapNumber
          ),

        reason:
          reason ||
          "Manual exclusion"
      }
    }
  );


  /*
   * Worker immediately rebuilds the affected kart.
   * Clear local caches so all views receive the new stats.
   */
  S.loaded.overview =
    false;

  S.loaded.stints =
    false;

  S.loaded.drivers =
    false;

  S.loaded.teams =
    false;

  S.loaded.events =
    false;


  await Promise.all([
    loadStints(true),
    loadDrivers(true),
    loadEvents(true)
  ]);


  if (
    isLiveRace()
  ) {
    await refreshLive();

  } else {
    await loadOverview();
  }


  renderActiveView();
}


// ============================================================
// REMOVE MANUAL EXCLUSION
// ============================================================

async function removeManualExclusion(
  apexId,
  lapNumber
) {
  const url =
    apiUrl(
      "/api/events"
    );


  url.searchParams.set(
    "apex_id",
    String(
      apexId
    )
  );


  url.searchParams.set(
    "lap_number",
    String(
      lapNumber
    )
  );


  const response =
    await fetch(
      url,
      {
        method:
          "DELETE",

        cache:
          "no-store"
      }
    );


  if (!response.ok) {
    throw new Error(
      await response.text()
    );
  }


  S.loaded.overview =
    false;

  S.loaded.stints =
    false;

  S.loaded.drivers =
    false;

  S.loaded.teams =
    false;

  S.loaded.events =
    false;


  await Promise.all([
    loadStints(true),
    loadDrivers(true),
    loadEvents(true)
  ]);


  if (
    isLiveRace()
  ) {
    await refreshLive();

  } else {
    await loadOverview();
  }


  renderActiveView();
}


// ============================================================
// DETAIL PANEL DATA
// ============================================================

function teamStints(
  apexId,
  teamName
) {
  return S.stints
    .filter(
      row => {

        if (
          apexId &&
          String(
            row.apex_id
          ) ===
          String(
            apexId
          )
        ) {
          return true;
        }


        return (
          teamName &&
          row.team_name ===
          teamName
        );
      }
    )
    .sort(
      (a, b) =>
        Number(
          a.stint_number ||
          0
        ) -
        Number(
          b.stint_number ||
          0
        )
    );
}


function teamPitRows(
  apexId,
  teamName
) {
  return S.pits
    .filter(
      row => {

        if (
          apexId &&
          String(
            row.apex_id
          ) ===
          String(
            apexId
          )
        ) {
          return true;
        }


        return (
          teamName &&
          row.team_name ===
          teamName
        );
      }
    )
    .sort(
      (a, b) =>
        Number(
          a.pit_number ||
          0
        ) -
        Number(
          b.pit_number ||
          0
        )
    );
}


// ============================================================
// DETAIL PANEL
// ============================================================

async function openTeamDetail(
  teamName,
  apexId
) {
  const panel =
    $("detailPanel");

  const backdrop =
    $("detailBackdrop");


  if (
    !panel ||
    !backdrop
  ) {
    /*
     * Older HTML versions do not yet have detail panel markup.
     * In that case use the team filter instead of failing.
     */
    setDropdownValue(
      "teamDropdown",
      "teamDropdownLabel",
      "teamDropdownMenu",
      teamName || "",
      teamName ||
      "All teams"
    );


    renderActiveView();

    return;
  }


  try {
    await Promise.all([
      loadStints(),
      loadPits()
    ]);


    const stints =
      teamStints(
        apexId,
        teamName
      );


    const pits =
      teamPitRows(
        apexId,
        teamName
      );


    const title =
      teamName ||
      `APEX ${apexId}`;


    const titleNode =
      $("detailTitle");


    const subtitleNode =
      $("detailSubtitle");


    const bodyNode =
      $("detailBody");


    if (titleNode) {
      titleNode.textContent =
        title;
    }


    if (subtitleNode) {
      subtitleNode.textContent =
        `${stints.length} stints · ${pits.length} pit stops`;
    }


    if (bodyNode) {
      bodyNode.innerHTML = `
<div class="detailSection">

  <div class="detailSectionTitle">
    STINTS
  </div>

  <div class="detailTableWrap">

    <table class="detailTable">

      <thead>
        <tr>
          <th>#</th>
          <th>Driver</th>
          <th>Start</th>
          <th>End</th>
          <th>Total</th>
          <th>Valid</th>
          <th>Average</th>
          <th>Best</th>
          <th>Best lap</th>
          <th>Worst</th>
          <th>Worst lap</th>
          <th>Consistency</th>
        </tr>
      </thead>

      <tbody>

        ${
          stints
            .map(
              row => `
<tr>
  <td>#${esc(row.stint_number || stintNumber(row))}</td>
  <td>${esc(row.driver_name || "—")}</td>
  <td>${esc(row.start_lap_count ?? "—")}</td>
  <td>${esc(row.end_lap_count ?? (row.is_live ? "LIVE" : "—"))}</td>
  <td>${esc(row.total_laps ?? "—")}</td>
  <td>${esc(row.valid_laps ?? "—")}</td>
  <td>${time(pick(row, "avg_lap_time", "avg_lap"))}</td>
  <td>${time(pick(row, "best_lap_time", "best_lap"))}</td>
  <td>${esc(row.best_lap_number ?? "—")}</td>
  <td>${time(pick(row, "worst_lap_time", "worst_lap", "max_lap_time"))}</td>
  <td>${esc(row.worst_lap_number ?? "—")}</td>
  <td>${time(pick(row, "consistency", "consistency_time", "lap_consistency"))}</td>
</tr>
`
            )
            .join("") ||

          `
<tr>
  <td colspan="12">
    No stint data.
  </td>
</tr>
`
        }

      </tbody>

    </table>

  </div>

</div>


<div class="detailSection">

  <div class="detailSectionTitle">
    PIT STOPS
  </div>

  <div class="detailTableWrap">

    <table class="detailTable">

      <thead>
        <tr>
          <th>#</th>
          <th>Lap</th>
          <th>Driver</th>
          <th>Hour</th>
          <th>On track</th>
          <th>Pit time</th>
          <th>Total</th>
        </tr>
      </thead>

      <tbody>

        ${
          pits
            .map(
              row => `
<tr>
  <td>#${esc(row.pit_number ?? "—")}</td>
  <td>${esc(row.pit_lap ?? "—")}</td>
  <td>${esc(row.driver_name || "—")}</td>
  <td>${esc(row.pit_hour || "—")}</td>
  <td>${esc(row.on_track || "—")}</td>
  <td>${esc(row.pit_time || "—")}</td>
  <td>${esc(row.total_time || "—")}</td>
</tr>
`
            )
            .join("") ||

          `
<tr>
  <td colspan="7">
    No pit-stop data.
  </td>
</tr>
`
        }

      </tbody>

    </table>

  </div>

</div>
`;
    }


    backdrop.classList.add(
      "open"
    );

    panel.classList.add(
      "open"
    );

  } catch (error) {
    console.error(
      error
    );

    alert(
      error.message ||
      "Unable to load team detail."
    );
  }
}


function closeDetailPanel() {
  $("detailBackdrop")
    ?.classList.remove(
      "open"
    );

  $("detailPanel")
    ?.classList.remove(
      "open"
    );
}


// ============================================================
// DRIVER DETAIL
// ============================================================

async function openDriverDetail(
  teamName,
  driverName
) {
  /*
   * Keep the same single dashboard architecture.
   * Driver detail is expressed by the global filters.
   */
  setDropdownValue(
    "teamDropdown",
    "teamDropdownLabel",
    "teamDropdownMenu",
    teamName || "",
    teamName ||
    "All teams"
  );


  setDropdownValue(
    "driverDropdown",
    "driverDropdownLabel",
    "driverDropdownMenu",
    driverName || "",
    driverName ||
    "All drivers"
  );


  renderActiveView();
}


// ============================================================
// ROW CLICK HANDLER
// ============================================================

document.addEventListener(
  "click",
  async event => {

    const row =
      event.target.closest(
        "[data-detail-type]"
      );


    if (!row) {
      return;
    }


    if (
      event.target.closest(
        "button,a,input"
      )
    ) {
      return;
    }


    const type =
      row.dataset.detailType;


    if (
      type ===
      "team"
    ) {
      await openTeamDetail(
        row.dataset.team ||
        "",
        row.dataset.apexId ||
        ""
      );

    } else if (
      type ===
      "driver"
    ) {
      await openDriverDetail(
        row.dataset.team ||
        "",
        row.dataset.driver ||
        ""
      );
    }
  }
);


// ============================================================
// EVENT REMOVE HANDLER
// ============================================================

document.addEventListener(
  "click",
  async event => {

    const button =
      event.target.closest(
        "[data-remove-exclusion]"
      );


    if (!button) {
      return;
    }


    event.preventDefault();
    event.stopPropagation();


    const apexId =
      button.dataset.apexId;


    const lap =
      Number(
        button.dataset.lapNumber
      );


    if (
      !apexId ||
      !Number.isFinite(lap)
    ) {
      return;
    }


    const oldText =
      button.textContent;


    button.disabled =
      true;

    button.textContent =
      "Updating…";


    try {
      await removeManualExclusion(
        apexId,
        lap
      );

    } catch (error) {
      console.error(
        error
      );

      alert(
        error.message ||
        "Unable to include the lap."
      );


      button.disabled =
        false;

      button.textContent =
        oldText;
    }
  }
);


// ============================================================
// MANUAL EXCLUSION FORM SUPPORT
// ============================================================

function manualExclusionElements() {
  return {
    apexId:
      $("manualExclusionApexId"),

    lap:
      $("manualExclusionLap"),

    reason:
      $("manualExclusionReason"),

    submit:
      $("manualExclusionSubmit")
  };
}


async function submitManualExclusion() {
  const elements =
    manualExclusionElements();


  if (
    !elements.apexId ||
    !elements.lap
  ) {
    return;
  }


  const apexId =
    elements.apexId
      .value
      .trim();


  const lap =
    Number(
      elements.lap.value
    );


  const reason =
    elements.reason
      ?.value
      ?.trim() ||
    "Manual exclusion";


  if (!apexId) {
    alert(
      "Select or enter the kart/team Apex ID."
    );

    return;
  }


  if (
    !Number.isFinite(lap) ||
    lap <= 0
  ) {
    alert(
      "Enter a valid race lap number."
    );

    return;
  }


  if (elements.submit) {
    elements.submit.disabled =
      true;

    elements.submit.textContent =
      "Updating…";
  }


  try {
    await addManualExclusion({
      apexId,
      lapNumber:
        lap,
      reason
    });


    elements.lap.value =
      "";


    if (elements.reason) {
      elements.reason.value =
        "";
    }


  } catch (error) {
    console.error(
      error
    );

    alert(
      error.message ||
      "Unable to exclude the lap."
    );

  } finally {
    if (elements.submit) {
      elements.submit.disabled =
        false;

      elements.submit.textContent =
        "Exclude lap";
    }
  }
}

// ============================================================
// MANUAL EXCLUSION — OPEN / CLOSE UI
// ============================================================

function openManualExclusionForm(
  apexId = "",
  lapNumber = ""
) {
  const modal =
    $("manualExclusionModal");

  const backdrop =
    $("manualExclusionBackdrop");

  const elements =
    manualExclusionElements();


  if (!modal) {
    /*
     * Compatibility with an older HTML version:
     * if there is no modal, use the existing inline fields.
     */
    if (elements.apexId) {
      elements.apexId.value =
        apexId || "";
    }


    if (elements.lap) {
      elements.lap.value =
        lapNumber || "";

      elements.lap.focus();
    }


    return;
  }


  if (elements.apexId) {
    elements.apexId.value =
      apexId || "";
  }


  if (elements.lap) {
    elements.lap.value =
      lapNumber || "";
  }


  if (elements.reason) {
    elements.reason.value =
      "";
  }


  backdrop
    ?.classList.add(
      "open"
    );


  modal.classList.add(
    "open"
  );


  setTimeout(
    () => {

      if (
        elements.lap &&
        !lapNumber
      ) {
        elements.lap.focus();

      } else {
        elements.reason
          ?.focus();
      }
    },
    0
  );
}


function closeManualExclusionForm() {
  $("manualExclusionBackdrop")
    ?.classList.remove(
      "open"
    );


  $("manualExclusionModal")
    ?.classList.remove(
      "open"
    );
}


// ============================================================
// EXCLUSION BUTTON FROM LAP / EVENT UI
// ============================================================

document.addEventListener(
  "click",
  event => {

    const button =
      event.target.closest(
        "[data-exclude-lap]"
      );


    if (!button) {
      return;
    }


    event.preventDefault();
    event.stopPropagation();


    openManualExclusionForm(
      button.dataset.apexId ||
      "",
      button.dataset.lapNumber ||
      ""
    );
  }
);


// ============================================================
// REPORT ACTIONS
// ============================================================

async function downloadRaceAnalyticsCsv() {
  try {
    const content =
      await buildRaceAnalyticsCsv();


    downloadText(
      `${reportBaseName()} - Race Analytics.csv`,
      content,
      "text/csv;charset=utf-8"
    );

  } catch (error) {
    console.error(
      error
    );


    alert(
      error.message ||
      "Unable to generate Race Analytics CSV."
    );
  }
}


async function openRaceAnalyticsPdf() {
  try {
    await openAnalyticsPdf();

  } catch (error) {
    console.error(
      error
    );


    alert(
      error.message ||
      "Unable to generate Race Analytics PDF."
    );
  }
}


/*
 * ============================================================
 * MANDATORY APEX-STYLE REPORT #1
 *
 * LAP TIME RECORDS CSV
 *
 * This MUST come from raw race lap data.
 * It must NOT use the filtered pace/statistics lap set.
 *
 * Long pit / transition / SC laps remain in this report.
 * ============================================================
 */

function downloadLapTimeRecordsCsv() {
  if (
    selectedRaceId() === null ||
    selectedRaceId() === undefined
  ) {
    alert(
      "No race selected."
    );

    return;
  }


  downloadFromEndpoint(
    "/api/reports/lap-time-records.csv"
  );
}


/*
 * ============================================================
 * MANDATORY APEX-STYLE REPORT #2
 *
 * PIT STOPS PDF
 *
 * Worker returns printable HTML matching the Apex pit-stop
 * structure. Browser Print / Save PDF creates the PDF.
 *
 * Required columns:
 * Lap
 * Hour
 * Total
 * On track
 * Laps
 * Driver
 * driver Total
 * Best lap
 * Avg
 * Pits
 * Out
 * ============================================================
 */

function openPitStopsPdf() {
  if (
    selectedRaceId() === null ||
    selectedRaceId() === undefined
  ) {
    alert(
      "No race selected."
    );

    return;
  }


  openReportWindow(
    "/api/reports/pit-stops.html"
  );
}


// ============================================================
// REPORT BUTTON STATE / BUSY STATE
// ============================================================

function setButtonBusy(
  button,
  busy,
  busyText = "Generating…"
) {
  if (!button) {
    return;
  }


  if (busy) {
    button.dataset.originalText =
      button.textContent;

    button.disabled =
      true;

    button.textContent =
      busyText;

    return;
  }


  button.disabled =
    false;


  if (
    button.dataset.originalText
  ) {
    button.textContent =
      button.dataset.originalText;

    delete button.dataset.originalText;
  }


  renderReports();
}


// ============================================================
// REPORT BUTTON HANDLERS
// ============================================================

function initReportButtons() {
  const raceCsv =
    $("downloadRaceCsv");

  const racePdf =
    $("downloadRacePdf");

  const lapCsv =
    $("organiserReport1Csv");

  const lapPdf =
    $("organiserReport1Pdf");

  const pitCsv =
    $("organiserReport2Csv");

  const pitPdf =
    $("organiserReport2Pdf");


  raceCsv
    ?.addEventListener(
      "click",
      async () => {

        if (
          raceCsv.disabled
        ) {
          return;
        }


        setButtonBusy(
          raceCsv,
          true
        );


        try {
          await downloadRaceAnalyticsCsv();

        } finally {
          setButtonBusy(
            raceCsv,
            false
          );
        }
      }
    );


  racePdf
    ?.addEventListener(
      "click",
      async () => {

        if (
          racePdf.disabled
        ) {
          return;
        }


        setButtonBusy(
          racePdf,
          true,
          "Opening…"
        );


        try {
          await openRaceAnalyticsPdf();

        } finally {
          setButtonBusy(
            racePdf,
            false
          );
        }
      }
    );


  lapCsv
    ?.addEventListener(
      "click",
      () => {

        if (
          lapCsv.disabled
        ) {
          return;
        }


        downloadLapTimeRecordsCsv();
      }
    );


  /*
   * There is intentionally no PDF implementation for
   * Apex Lap Time Records.
   *
   * The required source-format report is CSV.
   */
  lapPdf
    ?.addEventListener(
      "click",
      event => {

        event.preventDefault();
      }
    );


  /*
   * There is intentionally no CSV implementation for
   * Apex Pit Stops.
   *
   * The required source-format report is PDF.
   */
  pitCsv
    ?.addEventListener(
      "click",
      event => {

        event.preventDefault();
      }
    );


  pitPdf
    ?.addEventListener(
      "click",
      () => {

        if (
          pitPdf.disabled
        ) {
          return;
        }


        openPitStopsPdf();
      }
    );
}


// ============================================================
// MANUAL EXCLUSION UI INITIALIZATION
// ============================================================

function initManualExclusionUi() {
  const submit =
    $("manualExclusionSubmit");

  const cancel =
    $("manualExclusionCancel");

  const close =
    $("manualExclusionClose");

  const open =
    $("manualExclusionOpen");

  const backdrop =
    $("manualExclusionBackdrop");


  submit
    ?.addEventListener(
      "click",
      async event => {

        event.preventDefault();

        await submitManualExclusion();

        closeManualExclusionForm();
      }
    );


  cancel
    ?.addEventListener(
      "click",
      event => {

        event.preventDefault();

        closeManualExclusionForm();
      }
    );


  close
    ?.addEventListener(
      "click",
      event => {

        event.preventDefault();

        closeManualExclusionForm();
      }
    );


  open
    ?.addEventListener(
      "click",
      event => {

        event.preventDefault();

        openManualExclusionForm();
      }
    );


  backdrop
    ?.addEventListener(
      "click",
      closeManualExclusionForm
    );


  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Escape"
      ) {
        closeManualExclusionForm();
        closeDetailPanel();
      }
    }
  );
}


// ============================================================
// DETAIL PANEL INITIALIZATION
// ============================================================

function initDetailPanel() {
  $("detailClose")
    ?.addEventListener(
      "click",
      closeDetailPanel
    );


  $("detailBackdrop")
    ?.addEventListener(
      "click",
      closeDetailPanel
    );
}


// ============================================================
// GLOBAL FILTER INITIALIZATION
// ============================================================

function initFilters() {
  initDropdown(
    "teamDropdown",
    "teamDropdownTrigger",
    "teamDropdownMenu",
    async (
      value,
      option
    ) => {

      setDropdownValue(
        "teamDropdown",
        "teamDropdownLabel",
        "teamDropdownMenu",
        value,
        optionLabel(option)
      );


      /*
       * Driver choices depend on the active data set,
       * but the selected driver is retained only if
       * still valid.
       */
      renderActiveView();
    }
  );


  initDropdown(
    "driverDropdown",
    "driverDropdownTrigger",
    "driverDropdownMenu",
    async (
      value,
      option
    ) => {

      setDropdownValue(
        "driverDropdown",
        "driverDropdownLabel",
        "driverDropdownMenu",
        value,
        optionLabel(option)
      );


      renderActiveView();
    }
  );


  searchableDropdown(
    "teamDropdown",
    "teamDropdownMenu"
  );


  searchableDropdown(
    "driverDropdown",
    "driverDropdownMenu"
  );


  $("search")
    ?.addEventListener(
      "input",
      renderActiveView
    );


  $("resetFilters")
    ?.addEventListener(
      "click",
      resetFilters
    );
}


// ============================================================
// RACE DROPDOWN INITIALIZATION
// ============================================================

function initRaceDropdown() {
  initDropdown(
    "raceDropdown",
    "raceDropdownTrigger",
    "raceDropdownMenu",
    selectRaceOption
  );


  searchableDropdown(
    "raceDropdown",
    "raceDropdownMenu"
  );
}


// ============================================================
// NAVIGATION INITIALIZATION
// ============================================================

function initNavigation() {
  document
    .querySelectorAll(
      ".nav button[data-view]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          async () => {

            const view =
              button.dataset.view;


            if (
              !view ||
              view ===
              S.activeView
            ) {
              return;
            }


            await switchView(
              view
            );
          }
        );
      }
    );
}


// ============================================================
// AUTO REFRESH INITIALIZATION
// ============================================================

function initAutoRefresh() {
  $("autoRefresh")
    ?.addEventListener(
      "change",
      updateRefreshTimer
    );
}


// ============================================================
// MANUAL REFRESH BUTTON
// ============================================================

function initRefreshButton() {
  const button =
    $("refreshButton") ||
    $("refresh");


  button
    ?.addEventListener(
      "click",
      async () => {

        const original =
          button.textContent;


        button.disabled =
          true;

        button.textContent =
          "Refreshing…";


        try {
          if (
            isLiveRace()
          ) {
            /*
             * Force refresh the active detailed data too.
             */
            S.loaded.stints =
              false;

            S.loaded.drivers =
              false;

            S.loaded.teams =
              false;

            S.loaded.pits =
              false;

            S.loaded.events =
              false;


            await refreshLive();

          } else {
            if (
              S.activeView ===
              "overview"
            ) {
              await loadOverview();

            } else {
              await loadCurrentView(
                true
              );
            }
          }

        } catch (error) {
          console.error(
            error
          );


          alert(
            error.message ||
            "Refresh failed."
          );

        } finally {
          button.disabled =
            false;

          button.textContent =
            original;
        }
      }
    );
}


// ============================================================
// OPTIONAL COLLECTOR CONTROLS
// ============================================================

async function collectorAction(
  action
) {
  const path =
    action === "reconnect"
      ? "/api/collector/reconnect"
      : "/api/collector/start";


  try {
    await api(
      path,
      {
        method:
          "POST",

        raceId:
          null
      }
    );


    setTimeout(
      refreshLive,
      500
    );

  } catch (error) {
    console.error(
      error
    );


    alert(
      error.message ||
      "Collector action failed."
    );
  }
}


function initCollectorControls() {
  $("collectorStart")
    ?.addEventListener(
      "click",
      () =>
        collectorAction(
          "start"
        )
    );


  $("collectorReconnect")
    ?.addEventListener(
      "click",
      () =>
        collectorAction(
          "reconnect"
        )
    );
}


// ============================================================
// COLLECTOR STATUS
// ============================================================

async function loadCollectorStatus() {
  const node =
    $("collectorStatus");


  if (!node) {
    return;
  }


  try {
    const data =
      await api(
        "/api/collector/status",
        {
          raceId:
            null
        }
      );


    const connected =
      data.connected === true ||
      data.ws_connected === true;


    node.textContent =
      connected
        ? "Collector connected"
        : "Collector disconnected";


    node.classList.toggle(
      "ok",
      connected
    );


    node.classList.toggle(
      "bad",
      !connected
    );

  } catch {
    node.textContent =
      "Collector status unavailable";

    node.classList.remove(
      "ok"
    );

    node.classList.add(
      "bad"
    );
  }
}


// ============================================================
// RACE LAP DETAIL / MANUAL EXCLUSION SUPPORT
// ============================================================

async function loadRaceLapEvents(
  apexId
) {
  if (!apexId) {
    return [];
  }


  try {
    const data =
      await api(
        "/api/events",
        {
          /*
           * /api/events may include both disruption and
           * manual state rows.
           *
           * Detailed raw lap retrieval is optional here.
           */
        }
      );


    return payloadRows(data)
      .filter(
        row =>
          String(
            row.apex_id ??
            ""
          ) ===
          String(apexId)
      );

  } catch {
    return [];
  }
}


// ============================================================
// EXCLUSION REASON DISPLAY
// ============================================================

function exclusionReasonLabel(
  row
) {
  const reason =
    String(
      row.reason ||
      row.event_type ||
      row.type ||
      ""
    )
      .trim();


  if (!reason) {
    return "Excluded";
  }


  const normalized =
    reason.toLowerCase();


  if (
    normalized.includes(
      "pit"
    )
  ) {
    return "Pit In / Out";
  }


  if (
    normalized.includes(
      "direction"
    ) ||
    normalized.includes(
      "safety car"
    ) ||
    normalized === "sc"
  ) {
    return "Safety Car / Direction Change";
  }


  if (
    normalized.includes(
      "global"
    ) ||
    normalized.includes(
      "disruption"
    )
  ) {
    return "Global Disruption";
  }


  if (
    normalized.includes(
      "manual"
    )
  ) {
    return "Manual";
  }


  return reason;
}


// ============================================================
// RACE / SESSION LABEL HELPERS
// ============================================================

function currentRaceLabel() {
  if (
    isLiveRace()
  ) {
    return (
      S.liveMeta?.session_name ||
      S.liveMeta?.race_name ||
      S.liveMeta?.name ||
      "Current race"
    );
  }


  return (
    $("raceDropdownLabel")
      ?.textContent ||
    "Historical race"
  );
}


// ============================================================
// HEADER META
// ============================================================

function renderHeaderMeta() {
  const node =
    $("raceMeta");


  if (!node) {
    return;
  }


  if (
    isLiveRace()
  ) {
    if (
      S.liveMeta?.active === false
    ) {
      node.textContent =
        "Waiting for live timing";

      return;
    }


    const teamCount =
      S.overview.length;


    const leader =
      S.overview
        .slice()
        .sort(
          (a, b) =>
            (
              number(
                a.position
              ) ??
              Number.POSITIVE_INFINITY
            ) -
            (
              number(
                b.position
              ) ??
              Number.POSITIVE_INFINITY
            )
        )[0];


    const lap =
      leader
        ? pick(
            leader,
            "race_lap",
            "live_lap_count"
          )
        : null;


    node.textContent =
      [
        currentRaceLabel(),
        teamCount
          ? `${teamCount} teams`
          : null,
        lap !== null
          ? `Lap ${lap}`
          : null
      ]
        .filter(Boolean)
        .join(" · ");


    return;
  }


  node.textContent =
    currentRaceLabel();
}


// ============================================================
// WRAP RENDER ACTIVE VIEW TO UPDATE HEADER META
// ============================================================

const originalRenderActiveView =
  renderActiveView;


renderActiveView =
  function () {
    originalRenderActiveView();
    renderHeaderMeta();
  };


// ============================================================
// VISIBILITY REFRESH
// ============================================================

function initVisibilityRefresh() {
  document.addEventListener(
    "visibilitychange",
    () => {

      if (
        document.visibilityState !==
        "visible"
      ) {
        return;
      }


      if (
        isLiveRace() &&
        $("autoRefresh")?.checked
      ) {
        refreshLive();
      }


      loadCollectorStatus();
    }
  );
}


// ============================================================
// WINDOW FOCUS REFRESH
// ============================================================

function initWindowFocusRefresh() {
  let lastRefresh =
    0;


  window.addEventListener(
    "focus",
    () => {

      const now =
        Date.now();


      if (
        now -
        lastRefresh <
        3000
      ) {
        return;
      }


      lastRefresh =
        now;


      if (
        isLiveRace() &&
        $("autoRefresh")?.checked
      ) {
        refreshLive();
      }
    }
  );
}


// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================

function initKeyboardShortcuts() {
  document.addEventListener(
    "keydown",
    async event => {

      const target =
        event.target;


      const typing =
        target instanceof
          HTMLInputElement ||
        target instanceof
          HTMLTextAreaElement;


      if (typing) {
        return;
      }


      if (
        event.key === "/"
      ) {
        event.preventDefault();

        $("search")
          ?.focus();

        return;
      }


      if (
        event.key.toLowerCase() ===
        "r" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();


        if (
          isLiveRace()
        ) {
          await refreshLive();

        } else {
          await loadCurrentView(
            true
          );
        }
      }
    }
  );
}


// ============================================================
// REPORT FILTER NOTE
// ============================================================

function updateReportFilterNote() {
  const node =
    $("reportFilterNote");


  if (!node) {
    return;
  }


  const team =
    selectedReportTeam();


  node.textContent =
    team
      ? `Report filter: ${team}`
      : "Report scope: all teams";
}


// ============================================================
// KEEP REPORT FILTER NOTE UPDATED
// ============================================================

document.addEventListener(
  "click",
  event => {

    if (
      event.target.closest(
        "#teamDropdownMenu .dropdownOption"
      )
    ) {
      setTimeout(
        updateReportFilterNote,
        0
      );
    }
  }
);


// ============================================================
// EMPTY / ERROR STATE HELPERS
// ============================================================

function setTableMessage(
  bodyId,
  colspan,
  message
) {
  const body =
    $(bodyId);


  if (!body) {
    return;
  }


  body.innerHTML = `
<tr class="empty">
  <td colspan="${colspan}">
    ${esc(message)}
  </td>
</tr>
`;
}


// ============================================================
// LIVE SESSION SAFETY
// ============================================================

function ensureRaceSelected() {
  const raceId =
    selectedRaceId();


  if (
    raceId === null ||
    raceId === undefined ||
    raceId === ""
  ) {
    if (
      isLiveRace() &&
      S.liveMeta?.active === false
    ) {
      throw new Error(
        "There is no active live timing session."
      );
    }


    throw new Error(
      "No race selected."
    );
  }


  return raceId;
}


// ============================================================
// REPORT ENDPOINT HEALTH CHECK
// ============================================================

async function reportEndpointAvailable(
  path
) {
  try {
    const url =
      apiUrl(path);


    const response =
      await fetch(
        url,
        {
          method:
            "HEAD",

          cache:
            "no-store"
        }
      );


    /*
     * Some Worker routes do not implement HEAD and return 405.
     * 405 still means the route exists.
     */
    return (
      response.ok ||
      response.status === 405
    );

  } catch {
    return false;
  }
}


// ============================================================
// REPORT STATUS
// ============================================================

async function updateReportStatus() {
  const node =
    $("reportStatus");


  if (!node) {
    return;
  }


  if (
    selectedRaceId() === null ||
    selectedRaceId() === undefined
  ) {
    node.textContent =
      "No race selected";

    return;
  }


  const [
    lapCsv,
    pitPdf
  ] =
    await Promise.all([
      reportEndpointAvailable(
        "/api/reports/lap-time-records.csv"
      ),

      reportEndpointAvailable(
        "/api/reports/pit-stops.html"
      )
    ]);


  if (
    lapCsv &&
    pitPdf
  ) {
    node.textContent =
      "Apex-format reports ready";

    node.classList.add(
      "ok"
    );

    node.classList.remove(
      "bad"
    );

  } else {
    node.textContent =
      "One or more report endpoints unavailable";

    node.classList.remove(
      "ok"
    );

    node.classList.add(
      "bad"
    );
  }
}


// ============================================================
// REPORT VIEW ENTER
// ============================================================

async function enterReportsView() {
  renderReports();

  updateReportFilterNote();

  await updateReportStatus();
}


// ============================================================
// PATCH VIEW SWITCH FOR REPORT INITIALIZATION
// ============================================================

const originalSwitchView =
  switchView;


switchView =
  async function (view) {
    await originalSwitchView(
      view
    );


    if (
      view ===
      "reports"
    ) {
      await enterReportsView();
    }
  };


// ============================================================
// TEAM FILTER REPORT SCOPE
// ============================================================

function reportScopeLabel() {
  const team =
    selectedReportTeam();


  return team ||
    "All teams";
}


// ============================================================
// FORMAT PERCENT
// ============================================================

function percent(
  value,
  digits = 1
) {
  const n =
    number(value);


  if (n === null) {
    return "—";
  }


  return `${n.toFixed(digits)}%`;
}


// ============================================================
// FORMAT INTEGER
// ============================================================

function integer(value) {
  const n =
    number(value);


  return n === null
    ? "—"
    : String(
        Math.round(n)
      );
}


// ============================================================
// LIVE DATA AGE
// ============================================================

function latestOverviewTimestamp() {
  const values =
    S.overview
      .map(
        row => {

          const value =
            row.updated_at ||
            row.received_at;


          if (!value) {
            return null;
          }


          const timestamp =
            new Date(
              value
            ).getTime();


          return Number.isFinite(
            timestamp
          )
            ? timestamp
            : null;
        }
      )
      .filter(
        value =>
          value !== null
      );


  return values.length
    ? Math.max(
        ...values
      )
    : null;
}


function renderDataAge() {
  const node =
    $("dataAge");


  if (!node) {
    return;
  }


  if (
    !isLiveRace()
  ) {
    node.textContent =
      "Stored race";

    return;
  }


  const timestamp =
    latestOverviewTimestamp();


  if (!timestamp) {
    node.textContent =
      "Waiting for data";

    return;
  }


  const seconds =
    Math.max(
      0,
      Math.round(
        (
          Date.now() -
          timestamp
        ) /
        1000
      )
    );


  if (
    seconds < 5
  ) {
    node.textContent =
      "Updated now";

  } else if (
    seconds < 60
  ) {
    node.textContent =
      `Updated ${seconds}s ago`;

  } else {
    node.textContent =
      `Updated ${Math.floor(
        seconds / 60
      )}m ago`;
  }
}


// ============================================================
// DATA AGE TIMER
// ============================================================

let dataAgeTimer =
  null;


function startDataAgeTimer() {
  if (
    dataAgeTimer
  ) {
    clearInterval(
      dataAgeTimer
    );
  }


  renderDataAge();


  dataAgeTimer =
    setInterval(
      renderDataAge,
      1000
    );
}


// ============================================================
// OVERVIEW SUMMARY
// ============================================================

function renderOverviewSummary() {
  const rows =
    S.overview;


  const teamsNode =
    $("summaryTeams");

  const lapNode =
    $("summaryRaceLap");

  const pitsNode =
    $("summaryPits");

  const bestNode =
    $("summaryBestLap");


  if (teamsNode) {
    teamsNode.textContent =
      rows.length;
  }


  const maxLap =
    rows.reduce(
      (
        current,
        row
      ) => {

        const lap =
          number(
            pick(
              row,
              "race_lap",
              "live_lap_count"
            )
          );


        return lap !== null
          ? Math.max(
              current,
              lap
            )
          : current;
      },
      0
    );


  if (lapNode) {
    lapNode.textContent =
      maxLap || "—";
  }


  const totalPits =
    rows.reduce(
      (
        total,
        row
      ) =>
        total +
        (
          number(
            row.pit_count
          ) || 0
        ),
      0
    );


  if (pitsNode) {
    pitsNode.textContent =
      totalPits;
  }


  const bestValues =
    rows
      .map(
        row =>
          number(
            pick(
              row,
              "best_lap_time",
              "best_lap",
              "live_best_lap"
            )
          )
      )
      .filter(
        value =>
          value !== null &&
          value > 0
      );


  if (bestNode) {
    bestNode.textContent =
      bestValues.length
        ? time(
            Math.min(
              ...bestValues
            )
          )
        : "—";
  }
}


// ============================================================
// WRAP OVERVIEW RENDER FOR SUMMARY
// ============================================================

const originalRenderOverview =
  renderOverview;


renderOverview =
  function () {
    originalRenderOverview();

    renderOverviewSummary();
    renderDataAge();
  };


// ============================================================
// SESSION CHANGE DETECTION
// ============================================================

function liveSessionKey(
  data
) {
  return String(
    data?.session_key ??
    data?.race_id ??
    ""
  );
}


let lastLiveSessionKey =
  "";


function detectLiveSessionChange(
  data
) {
  const key =
    liveSessionKey(
      data
    );


  if (!key) {
    return false;
  }


  if (
    !lastLiveSessionKey
  ) {
    lastLiveSessionKey =
      key;

    return false;
  }


  if (
    lastLiveSessionKey !==
    key
  ) {
    lastLiveSessionKey =
      key;

    return true;
  }


  return false;
}


// ============================================================
// CACHE INVALIDATION
// ============================================================

function invalidateDetailCaches() {
  S.loaded.stints =
    false;

  S.loaded.drivers =
    false;

  S.loaded.teams =
    false;

  S.loaded.pits =
    false;

  S.loaded.events =
    false;
}


// ============================================================
// NETWORK ONLINE / OFFLINE
// ============================================================

function initNetworkStatus() {
  window.addEventListener(
    "offline",
    () => {
      setStatus(
        false,
        "OFFLINE"
      );
    }
  );


  window.addEventListener(
    "online",
    async () => {
      if (
        isLiveRace()
      ) {
        await refreshLive();

      } else {
        await loadCurrentView(
          true
        );
      }
    }
  );
}


// ============================================================
// TABLE HORIZONTAL SCROLL WITH SHIFT + WHEEL
// ============================================================

function initTableScroll() {
  document
    .querySelectorAll(
      ".tableWrap"
    )
    .forEach(
      wrapper => {

        wrapper.addEventListener(
          "wheel",
          event => {

            if (
              !event.shiftKey
            ) {
              return;
            }


            event.preventDefault();


            wrapper.scrollLeft +=
              event.deltaY;
          },
          {
            passive:
              false
          }
        );
      }
    );
}


// ============================================================
// DOUBLE CLICK TEAM ROW -> TEAM FILTER
// ============================================================

function initRowDoubleClick() {
  document.addEventListener(
    "dblclick",
    event => {

      const row =
        event.target.closest(
          "[data-team]"
        );


      if (!row) {
        return;
      }


      const team =
        row.dataset.team;


      if (!team) {
        return;
      }


      setDropdownValue(
        "teamDropdown",
        "teamDropdownLabel",
        "teamDropdownMenu",
        team,
        team
      );


      renderActiveView();
    }
  );
}


// ============================================================
// RESET FILTERS WITH ESCAPE WHEN NO MODAL IS OPEN
// ============================================================

function initFilterEscape() {
  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key !==
        "Escape"
      ) {
        return;
      }


      const detailOpen =
        $("detailPanel")
          ?.classList.contains(
            "open"
          );


      const exclusionOpen =
        $("manualExclusionModal")
          ?.classList.contains(
            "open"
          );


      const dropdownOpen =
        document.querySelector(
          ".dropdown.open"
        );


      if (
        detailOpen ||
        exclusionOpen ||
        dropdownOpen
      ) {
        return;
      }


      if (
        dropdownValue(
          "teamDropdown"
        ) ||
        dropdownValue(
          "driverDropdown"
        ) ||
        $("search")?.value
      ) {
        resetFilters();
      }
    }
  );
}


// ============================================================
// SAFE INITIAL VIEW
// ============================================================

function detectInitialView() {
  const active =
    document.querySelector(
      ".nav button.active[data-view]"
    );


  const view =
    active?.dataset.view;


  if (
    [
      "overview",
      "stints",
      "drivers",
      "teams",
      "pits",
      "events",
      "reports"
    ].includes(view)
  ) {
    S.activeView =
      view;
  }
}


// ============================================================
// INITIAL LIVE META
// ============================================================

async function initializeLiveState() {
  try {
    const data =
      await api(
        "/api/live",
        {
          raceId:
            null
        }
      );


    S.liveMeta =
      data;


    if (
      data.active !== false
    ) {
      S.raceId =
        data.race_id ??
        null;


      S.overview =
        data.current ||
        [];


      S.loaded.overview =
        true;


      lastLiveSessionKey =
        liveSessionKey(
          data
        );


      setStatus(
        true,
        "LIVE"
      );

    } else {
      S.raceId =
        null;

      S.overview =
        [];

      S.loaded.overview =
        true;


      setStatus(
        false,
        "NO LIVE SESSION"
      );
    }


  } catch (error) {
    console.error(
      error
    );


    S.liveMeta = {
      active:
        false
    };


    setStatus(
      false,
      "CONNECTION ERROR"
    );
  }
}

// ============================================================
// INITIALIZE RACE DROPDOWN SELECTION
// ============================================================

function syncRaceDropdownSelection() {
  if (
    isLiveRace()
  ) {
    setDropdownValue(
      "raceDropdown",
      "raceDropdownLabel",
      "raceDropdownMenu",
      "live",
      "Current race"
    );

    return;
  }


  const option =
    [
      ...document.querySelectorAll(
        "#raceDropdownMenu .dropdownOption[data-value]"
      )
    ]
      .find(
        item =>
          item.dataset.value ===
          `race:${S.raceId}`
      );


  setDropdownValue(
    "raceDropdown",
    "raceDropdownLabel",
    "raceDropdownMenu",
    `race:${S.raceId}`,
    option
      ? optionLabel(option)
      : `Race ${S.raceId}`
  );
}


// ============================================================
// SEARCHABLE DROPDOWN REFOCUS
// ============================================================

function initSearchableDropdownFocus() {
  document
    .querySelectorAll(
      ".dropdown"
    )
    .forEach(
      dropdown => {

        const trigger =
          dropdown.querySelector(
            ".dropdownTrigger"
          );


        trigger
          ?.addEventListener(
            "click",
            () => {

              if (
                !dropdown.classList.contains(
                  "open"
                )
              ) {
                return;
              }


              setTimeout(
                () => {
                  const input =
                    dropdown.querySelector(
                      ".dropdownSearch"
                    );


                  input?.focus();
                },
                0
              );
            }
          );
      }
    );
}


// ============================================================
// SEARCHABLE DROPDOWN EMPTY STATE
// ============================================================

function initDropdownEmptyState() {
  document
    .querySelectorAll(
      ".dropdownMenu"
    )
    .forEach(
      menu => {

        const observer =
          new MutationObserver(
            () => {

              const query =
                normalizeSearchText(
                  menu.querySelector(
                    ".dropdownSearch"
                  )?.value
                );


              const options =
                [
                  ...menu.querySelectorAll(
                    ".dropdownOption[data-value]"
                  )
                ];


              const visible =
                options.filter(
                  option =>
                    !option.hidden
                );


              let empty =
                menu.querySelector(
                  ".dropdownNoResults"
                );


              if (
                query &&
                visible.length === 0
              ) {
                if (!empty) {
                  empty =
                    document.createElement(
                      "div"
                    );


                  empty.className =
                    "dropdownNoResults";


                  empty.textContent =
                    "No matches";


                  menu.appendChild(
                    empty
                  );
                }

              } else {
                empty?.remove();
              }
            }
          );


        observer.observe(
          menu,
          {
            attributes:
              true,

            childList:
              true,

            subtree:
              true,

            attributeFilter: [
              "hidden"
            ]
          }
        );
      }
    );
}


// ============================================================
// REFRESH RACE LIST
// ============================================================

async function refreshRaceList() {
  await loadRaceList();

  syncRaceDropdownSelection();
}


// ============================================================
// RACE DROPDOWN SEARCH RESET
// ============================================================

function resetRaceDropdownSearch() {
  const search =
    document.querySelector(
      "#raceDropdownMenu .dropdownSearch"
    );


  if (search) {
    search.value =
      "";


    search.dispatchEvent(
      new Event(
        "input",
        {
          bubbles:
            true
        }
      )
    );
  }
}


// ============================================================
// TEAM / DRIVER DROPDOWN SEARCH RESET
// ============================================================

function resetFilterDropdownSearches() {
  [
    "#teamDropdownMenu .dropdownSearch",
    "#driverDropdownMenu .dropdownSearch"
  ]
    .forEach(
      selector => {

        const input =
          document.querySelector(
            selector
          );


        if (!input) {
          return;
        }


        input.value =
          "";


        input.dispatchEvent(
          new Event(
            "input",
            {
              bubbles:
                true
            }
          )
        );
      }
    );
}


// ============================================================
// SAFE SELECT TEAM
// ============================================================

function chooseTeam(
  teamName
) {
  const team =
    String(
      teamName ||
      ""
    );


  setDropdownValue(
    "teamDropdown",
    "teamDropdownLabel",
    "teamDropdownMenu",
    team,
    team ||
    "All teams"
  );


  /*
   * If the selected driver does not belong to this team
   * after filtering, clear it.
   */
  const selectedDriver =
    dropdownValue(
      "driverDropdown"
    );


  if (selectedDriver) {
    const driverExists =
      rowsForCurrentView()
        .some(
          row =>
            (
              !team ||
              row.team_name === team
            ) &&
            (
              row.driver_name ===
                selectedDriver ||
              row.current_driver ===
                selectedDriver
            )
        );


    if (!driverExists) {
      setDropdownValue(
        "driverDropdown",
        "driverDropdownLabel",
        "driverDropdownMenu",
        "",
        "All drivers"
      );
    }
  }


  renderActiveView();
}


// ============================================================
// SAFE SELECT DRIVER
// ============================================================

function chooseDriver(
  driverName
) {
  const driver =
    String(
      driverName ||
      ""
    );


  setDropdownValue(
    "driverDropdown",
    "driverDropdownLabel",
    "driverDropdownMenu",
    driver,
    driver ||
    "All drivers"
  );


  renderActiveView();
}


// ============================================================
// REBIND FILTER DROPDOWNS
//
// initDropdown() above attaches the dropdown click behavior.
// This function gives us one clean place for the final
// filter-change behavior.
// ============================================================

function initFilterSelectionObservers() {
  $("teamDropdownMenu")
    ?.addEventListener(
      "click",
      event => {

        const option =
          event.target.closest(
            ".dropdownOption[data-value]"
          );


        if (!option) {
          return;
        }


        const value =
          option.dataset.value ||
          "";


        /*
         * initDropdown's handler already sets the value,
         * this only handles dependent driver validity.
         */
        if (!value) {
          renderActiveView();

          return;
        }


        const selectedDriver =
          dropdownValue(
            "driverDropdown"
          );


        if (
          selectedDriver
        ) {
          const driverStillExists =
            rowsForCurrentView()
              .some(
                row =>
                  row.team_name ===
                    value &&
                  (
                    row.driver_name ===
                      selectedDriver ||
                    row.current_driver ===
                      selectedDriver
                  )
              );


          if (
            !driverStillExists
          ) {
            setDropdownValue(
              "driverDropdown",
              "driverDropdownLabel",
              "driverDropdownMenu",
              "",
              "All drivers"
            );
          }
        }
      }
    );
}


// ============================================================
// ACTIVE FILTER SUMMARY
// ============================================================

function renderFilterSummary() {
  const node =
    $("filterSummary");


  if (!node) {
    return;
  }


  const team =
    dropdownValue(
      "teamDropdown"
    );


  const driver =
    dropdownValue(
      "driverDropdown"
    );


  const search =
    $("search")
      ?.value
      ?.trim() ||
    "";


  const parts = [];


  if (team) {
    parts.push(
      `Team: ${team}`
    );
  }


  if (driver) {
    parts.push(
      `Driver: ${driver}`
    );
  }


  if (search) {
    parts.push(
      `Search: ${search}`
    );
  }


  node.textContent =
    parts.length
      ? parts.join(" · ")
      : "No filters";
}


// ============================================================
// WRAP ACTIVE VIEW AGAIN FOR FILTER SUMMARY
// ============================================================

const renderActiveViewBeforeFilterSummary =
  renderActiveView;


renderActiveView =
  function () {
    renderActiveViewBeforeFilterSummary();

    renderFilterSummary();
    updateReportFilterNote();
  };


// ============================================================
// HISTORY / LIVE DATA LOADING
// ============================================================

async function loadSelectedRace() {
  clearRaceData();


  if (
    isLiveRace()
  ) {
    await initializeLiveState();

  } else {
    await loadOverview();
  }


  await loadCurrentView(
    true
  );


  renderActiveView();
}


// ============================================================
// INITIAL VIEW LOAD
// ============================================================

async function loadInitialView() {
  if (
    S.activeView ===
    "overview"
  ) {
    if (
      !S.loaded.overview
    ) {
      await loadOverview();
    }


    renderOverview();

  } else {
    await loadCurrentView(
      true
    );
  }


  rebuildFilters();
  renderActiveView();
}


// ============================================================
// LIVE SESSION CHANGE CHECK
// ============================================================

async function checkForLiveRaceChange() {
  if (
    !isLiveRace()
  ) {
    return;
  }


  try {
    const data =
      await api(
        "/api/live",
        {
          raceId:
            null
        }
      );


    const changed =
      detectLiveSessionChange(
        data
      );


    S.liveMeta =
      data;


    if (
      changed
    ) {
      S.raceId =
        data.race_id ??
        null;


      clearRaceData();


      S.overview =
        data.current ||
        [];


      S.loaded.overview =
        true;


      resetFilters();


      await refreshRaceList();


      await loadCurrentView(
        true
      );


      renderActiveView();


      return;
    }


    S.raceId =
      data.race_id ??
      S.raceId;


    S.overview =
      data.current ||
      [];


    S.loaded.overview =
      true;


  } catch (error) {
    console.warn(
      "Live race change check failed:",
      error
    );
  }
}


// ============================================================
// PERIODIC RACE LIST REFRESH
// ============================================================

let raceListTimer =
  null;


function startRaceListTimer() {
  if (
    raceListTimer
  ) {
    clearInterval(
      raceListTimer
    );
  }


  raceListTimer =
    setInterval(
      async () => {

        try {
          await refreshRaceList();


          if (
            isLiveRace()
          ) {
            await checkForLiveRaceChange();
          }

        } catch (error) {
          console.warn(
            "Race list refresh failed:",
            error
          );
        }
      },
      30000
    );
}


// ============================================================
// ACTIVE VIEW REFRESH AFTER MANUAL EXCLUSION
// ============================================================

async function reloadStatisticsAfterExclusion() {
  invalidateDetailCaches();


  await Promise.all([
    loadStints(true),
    loadDrivers(true),
    loadTeams(true),
    loadEvents(true)
  ]);


  if (
    isLiveRace()
  ) {
    await refreshLive();

  } else {
    await loadOverview();
  }


  renderActiveView();
}


// ============================================================
// DATASET COUNTS
// ============================================================

function renderDatasetCounts() {
  const map = {
    overview:
      S.overview.length,

    stints:
      S.stints.length,

    drivers:
      S.drivers.length,

    teams:
      S.teams.length,

    pits:
      S.pits.length,

    events:
      S.events.length
  };


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      map
    )
  ) {
    const node =
      $(
        `${key}Count`
      );


    if (node) {
      node.textContent =
        value;
    }
  }
}


// ============================================================
// WRAP ACTIVE VIEW FOR DATA COUNTS
// ============================================================

const renderActiveViewBeforeCounts =
  renderActiveView;


renderActiveView =
  function () {
    renderActiveViewBeforeCounts();

    renderDatasetCounts();
  };


// ============================================================
// TABLE COLUMN SAFETY
// ============================================================

function normalizeTableColspans() {
  const definitions = {
    overviewBody: 16,
    stintsBody: 13,
    driversBody: 9,
    teamsBody: 9,
    pitsBody: 8,
    eventsBody: 8
  };


  for (
    const [
      id,
      count
    ]
    of Object.entries(
      definitions
    )
  ) {
    const body =
      $(id);


    if (!body) {
      continue;
    }


    body
      .querySelectorAll(
        "tr.empty td"
      )
      .forEach(
        td =>
          td.colSpan =
            count
      );
  }
}


// ============================================================
// WRAP ACTIVE VIEW FOR COLSPAN NORMALIZATION
// ============================================================

const renderActiveViewBeforeColspans =
  renderActiveView;


renderActiveView =
  function () {
    renderActiveViewBeforeColspans();

    normalizeTableColspans();
  };


// ============================================================
// TOOLTIP HELPERS
// ============================================================

function initTooltips() {
  document
    .querySelectorAll(
      "[data-tooltip]"
    )
    .forEach(
      node => {

        if (
          !node.title
        ) {
          node.title =
            node.dataset.tooltip ||
            "";
        }
      }
    );
}


// ============================================================
// REPORT CARDS — TEXT NORMALIZATION
// ============================================================

function normalizeReportLabels() {
  const report1 =
    $("organiserReport1Csv")
      ?.closest(
        ".reportCard"
      );


  if (report1) {
    const heading =
      report1.querySelector(
        "h3"
      );


    const description =
      report1.querySelector(
        "p"
      );


    if (heading) {
      heading.textContent =
        "Lap Time Records";
    }


    if (description) {
      description.textContent =
        "Apex-style CSV with every recorded race lap for every team.";
    }
  }


  const report2 =
    $("organiserReport2Pdf")
      ?.closest(
        ".reportCard"
      );


  if (report2) {
    const heading =
      report2.querySelector(
        "h3"
      );


    const description =
      report2.querySelector(
        "p"
      );


    if (heading) {
      heading.textContent =
        "Pit Stops";
    }


    if (description) {
      description.textContent =
        "Apex-style pit-stop and stint report, ready for Print / Save PDF.";
    }
  }
}


// ============================================================
// REPORT CARD VISIBILITY
// ============================================================

function normalizeReportButtons() {
  const report1Csv =
    $("organiserReport1Csv");

  const report1Pdf =
    $("organiserReport1Pdf");

  const report2Csv =
    $("organiserReport2Csv");

  const report2Pdf =
    $("organiserReport2Pdf");


  if (report1Csv) {
    report1Csv.textContent =
      "CSV";
  }


  if (report1Pdf) {
    report1Pdf.style.display =
      "none";
  }


  if (report2Csv) {
    report2Csv.style.display =
      "none";
  }


  if (report2Pdf) {
    report2Pdf.textContent =
      "PDF";
  }
}


// ============================================================
// REPORT UI NORMALIZATION
// ============================================================

function normalizeReportsUi() {
  normalizeReportLabels();
  normalizeReportButtons();
  renderReports();
}


// ============================================================
// OPTIONAL LIVE BADGE
// ============================================================

function renderLiveBadge() {
  const badge =
    $("liveBadge");


  if (!badge) {
    return;
  }


  if (
    !isLiveRace()
  ) {
    badge.textContent =
      "HISTORY";

    badge.classList.remove(
      "live"
    );

    badge.classList.add(
      "history"
    );

    return;
  }


  if (
    S.liveMeta?.active === false
  ) {
    badge.textContent =
      "NO LIVE SESSION";

    badge.classList.remove(
      "live"
    );

    badge.classList.add(
      "history"
    );

    return;
  }


  badge.textContent =
    "LIVE";

  badge.classList.add(
    "live"
  );

  badge.classList.remove(
    "history"
  );
}


// ============================================================
// WRAP ACTIVE VIEW FOR BADGE
// ============================================================

const renderActiveViewBeforeBadge =
  renderActiveView;


renderActiveView =
  function () {
    renderActiveViewBeforeBadge();

    renderLiveBadge();
  };


// ============================================================
// SEARCH CLEAR BUTTON
// ============================================================

function initSearchClear() {
  const clear =
    $("searchClear");


  if (!clear) {
    return;
  }


  clear.addEventListener(
    "click",
    () => {

      $("search").value =
        "";

      renderActiveView();

      $("search").focus();
    }
  );
}


// ============================================================
// FILTER COUNT
// ============================================================

function renderFilteredCount() {
  const node =
    $("filteredCount");


  if (!node) {
    return;
  }


  if (
    S.activeView ===
    "reports"
  ) {
    node.textContent =
      "";

    return;
  }


  const all =
    rowsForCurrentView();


  const visible =
    filterRows(
      all
    );


  if (
    all.length ===
    visible.length
  ) {
    node.textContent =
      `${all.length}`;

  } else {
    node.textContent =
      `${visible.length} / ${all.length}`;
  }
}


// ============================================================
// WRAP ACTIVE VIEW FOR FILTER COUNT
// ============================================================

const renderActiveViewBeforeFilteredCount =
  renderActiveView;


renderActiveView =
  function () {
    renderActiveViewBeforeFilteredCount();

    renderFilteredCount();
  };


// ============================================================
// STARTUP ERRORS
// ============================================================

function showStartupError(error) {
  console.error(
    error
  );


  setStatus(
    false,
    "STARTUP ERROR"
  );


  setTableMessage(
    "overviewBody",
    16,
    error?.message ||
    "Unable to initialize Race Engineer."
  );
}


// ============================================================
// INITIALIZE
// ============================================================

async function init() {
  try {

    detectInitialView();


    // --------------------------------------------------------
    // UI BEHAVIOR
    // --------------------------------------------------------

    initRaceDropdown();

    initFilters();

    initFilterSelectionObservers();

    initNavigation();

    initAutoRefresh();

    initRefreshButton();

    initCollectorControls();

    initReportButtons();

    initManualExclusionUi();

    initDetailPanel();

    initVisibilityRefresh();

    initWindowFocusRefresh();

    initNetworkStatus();

    initKeyboardShortcuts();

    initTableScroll();

    initRowDoubleClick();

    initFilterEscape();

    initSearchClear();

    initSearchableDropdownFocus();

    initDropdownEmptyState();

    initTooltips();


    // --------------------------------------------------------
    // REPORT UI
    // --------------------------------------------------------

    normalizeReportsUi();


    // --------------------------------------------------------
    // RACE LIST
    // --------------------------------------------------------

    await refreshRaceList();


    // --------------------------------------------------------
    // LIVE STATE
    // --------------------------------------------------------

    if (
      isLiveRace()
    ) {
      await initializeLiveState();
    }


    syncRaceDropdownSelection();

    updateRaceContext();


    // --------------------------------------------------------
    // INITIAL DATA
    // --------------------------------------------------------

    await loadInitialView();


    // --------------------------------------------------------
    // TIMERS
    // --------------------------------------------------------

    updateRefreshTimer();

    startRaceListTimer();

    startDataAgeTimer();


    // --------------------------------------------------------
    // COLLECTOR
    // --------------------------------------------------------

    loadCollectorStatus();


    setInterval(
      loadCollectorStatus,
      15000
    );


    // --------------------------------------------------------
    // FINAL UI
    // --------------------------------------------------------

    renderActiveView();

    renderReports();

    updateReportFilterNote();


    if (
      S.activeView ===
      "reports"
    ) {
      await updateReportStatus();
    }

  } catch (error) {
    showStartupError(
      error
    );
  }
}


// ============================================================
// START
// ============================================================

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    init
  );

} else {
  init();
}
