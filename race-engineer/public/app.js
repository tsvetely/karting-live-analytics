"use strict";


// ============================================================
// STATE
// ============================================================

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

  refreshing: false,

  autoRefreshTimer: null,
  raceListTimer: null,
  dataAgeTimer: null
};


const $ = id =>
  document.getElementById(id);


// ============================================================
// BASIC HELPERS
// ============================================================

function esc(value) {
  return String(
    value ?? ""
  ).replace(
    /[&<>"']/g,
    char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char])
  );
}


function number(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function integer(value) {
  const n =
    number(value);

  return n === null
    ? "—"
    : String(
        Math.round(n)
      );
}


function time(value) {
  const seconds =
    number(value);

  if (
    seconds === null ||
    seconds <= 0
  ) {
    return "—";
  }

  if (seconds >= 60) {
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

  return seconds.toFixed(3);
}


function pick(
  object,
  ...keys
) {
  for (
    const key
    of keys
  ) {
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


function formatUpdated(value) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(value);
  }

  return date.toLocaleTimeString();
}


function normalizeText(value) {
  return String(
    value ?? ""
  )
    .trim()
    .toLocaleLowerCase();
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


// ============================================================
// RACE
// ============================================================

function isLiveRace() {
  return (
    S.source === "live"
  );
}


function selectedRaceId() {
  if (
    isLiveRace()
  ) {
    return (
      S.liveMeta?.race_id ??
      S.raceId ??
      null
    );
  }

  return S.raceId;
}


function raceHasData() {
  if (
    !isLiveRace()
  ) {
    return (
      S.raceId !== null &&
      S.raceId !== undefined
    );
  }

  return (
    S.liveMeta?.data_available === true ||
    S.liveMeta?.active === true ||
    (
      Array.isArray(
        S.liveMeta?.current
      ) &&
      S.liveMeta.current.length > 0
    )
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

  const useRaceId =
    options.raceId !== undefined
      ? options.raceId
      : selectedRaceId();

  if (
    useRaceId !== null &&
    useRaceId !== undefined &&
    useRaceId !== ""
  ) {
    url.searchParams.set(
      "race_id",
      String(useRaceId)
    );
  }


  const fetchOptions = {
    method:
      options.method ||
      "GET",

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
      typeof options.body ===
      "string"
        ? options.body
        : JSON.stringify(
            options.body
          );
  }


  const response =
    await fetch(
      url,
      fetchOptions
    );


  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      body ||
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


function apiUrl(path) {
  const url =
    new URL(
      path,
      window.location.origin
    );

  const id =
    selectedRaceId();

  if (
    id !== null &&
    id !== undefined &&
    id !== ""
  ) {
    url.searchParams.set(
      "race_id",
      String(id)
    );
  }

  return url.toString();
}


// ============================================================
// FILE DOWNLOAD
//
// IMPORTANT:
// We no longer navigate the browser directly to the endpoint.
// We fetch the file, inspect HTTP errors and only then trigger
// the browser download.
// ============================================================

async function downloadFileFromEndpoint(
  path,
  fallbackFilename =
    "download"
) {
  const response =
    await fetch(
      apiUrl(path),
      {
        method: "GET",
        cache: "no-store"
      }
    );


  if (!response.ok) {
    let message = "";

    try {
      message =
        await response.text();
    } catch {
      message = "";
    }

    throw new Error(
      message ||
      `Download failed: HTTP ${response.status}`
    );
  }


  const blob =
    await response.blob();


  if (
    !blob ||
    blob.size === 0
  ) {
    throw new Error(
      "The server returned an empty file."
    );
  }


  const disposition =
    response.headers.get(
      "content-disposition"
    ) || "";


  let filename =
    fallbackFilename;


  const utf8Match =
    /filename\*=UTF-8''([^;]+)/i
      .exec(disposition);


  const normalMatch =
    /filename="([^"]+)"/i
      .exec(disposition);


  if (
    utf8Match?.[1]
  ) {
    try {
      filename =
        decodeURIComponent(
          utf8Match[1]
        );
    } catch {
      filename =
        utf8Match[1];
    }

  } else if (
    normalMatch?.[1]
  ) {
    filename =
      normalMatch[1];
  }


  const objectUrl =
    URL.createObjectURL(
      blob
    );


  try {
    const link =
      document.createElement(
        "a"
      );

    link.href =
      objectUrl;

    link.download =
      filename;

    link.style.display =
      "none";


    document.body
      .appendChild(
        link
      );


    link.click();
    link.remove();

  } finally {
    window.setTimeout(
      () =>
        URL.revokeObjectURL(
          objectUrl
        ),
      1000
    );
  }


  return {
    filename,
    size:
      blob.size
  };
}


// ============================================================
// STATUS
// ============================================================

function setStatus(
  ok,
  text
) {
  const status =
    $("status");

  const dot =
    $("liveDot");

  if (status) {
    status.textContent =
      text;
  }

  if (dot) {
    dot.className =
      `dot ${ok ? "ok" : "bad"}`;
  }
}


function setSessionStatus() {
  const sessionName =
    $("sessionName");

  const sessionStatus =
    $("sessionStatus");

  const headerTeamCount =
    $("headerTeamCount");


  if (sessionName) {
    sessionName.textContent =
      S.liveMeta?.session_name ||
      S.liveMeta?.session ||
      (
        isLiveRace()
          ? "Apex Timing"
          : (
              $("raceDropdownLabel")
                ?.textContent ||
              `Race ${S.raceId}`
            )
      );
  }


  if (sessionStatus) {
    sessionStatus.textContent =
      isLiveRace()
        ? (
            S.liveMeta
              ?.session_status ||
            (
              S.liveMeta
                ?.is_live
                ? "LIVE"
                : "FINISHED"
            )
          )
        : "FINISHED";
  }


  if (headerTeamCount) {
    headerTeamCount.textContent =
      S.overview.length;
  }
}


// ============================================================
// DROPDOWNS
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


  menu
    ?.querySelectorAll(
      ".dropdownOption[data-value]"
    )
    .forEach(
      option => {
        option.classList.toggle(
          "selected",
          String(
            option.dataset.value ??
            ""
          ) ===
          String(
            value ??
            ""
          )
        );
      }
    );
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
          dropdown !==
          except
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

      const open =
        !dropdown
          .classList
          .contains(
            "open"
          );

      closeAllDropdowns();

      if (open) {
        dropdown
          .classList
          .add(
            "open"
          );

        setTimeout(
          () =>
            menu
              .querySelector(
                ".dropdownSearch"
              )
              ?.focus(),
          0
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

      dropdown
        .classList
        .remove(
          "open"
        );

      await onChange(
        option.dataset.value ??
        "",
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
// SEARCHABLE DROPDOWNS
// ============================================================

function makeDropdownSearchable(
  menuId,
  placeholder
) {
  const menu =
    $(menuId);

  if (!menu) {
    return;
  }


  function ensureSearch() {
    let input =
      menu.querySelector(
        ".dropdownSearch"
      );

    if (input) {
      return input;
    }


    input =
      document.createElement(
        "input"
      );

    input.type =
      "search";

    input.className =
      "dropdownSearch";

    input.placeholder =
      placeholder;

    input.autocomplete =
      "off";


    input.addEventListener(
      "click",
      event =>
        event.stopPropagation()
    );


    input.addEventListener(
      "input",
      () => {
        const query =
          normalizeText(
            input.value
          );

        let visible =
          0;


        menu
          .querySelectorAll(
            ".dropdownOption[data-value]"
          )
          .forEach(
            option => {
              const text =
                normalizeText(
                  optionLabel(
                    option
                  )
                );

              const show =
                !query ||
                text.includes(
                  query
                );

              option.hidden =
                !show;

              if (show) {
                visible += 1;
              }
            }
          );


        let empty =
          menu.querySelector(
            ".dropdownNoResults"
          );


        if (
          query &&
          visible === 0
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


    menu.prepend(
      input
    );

    return input;
  }


  const observer =
    new MutationObserver(
      () => {
        ensureSearch();
      }
    );


  observer.observe(
    menu,
    {
      childList: true
    }
  );


  ensureSearch();
}


// ============================================================
// FILTERING
// ============================================================

function rowsForCurrentView() {
  switch (
    S.activeView
  ) {
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


function filterRows(rows) {
  const query =
    normalizeText(
      $("search")?.value
    );

  const team =
    dropdownValue(
      "teamDropdown"
    );

  const driver =
    dropdownValue(
      "driverDropdown"
    );


  return rows.filter(
    row => {
      const rowTeam =
        String(
          row.team_name ||
          ""
        );

      const rowDriver =
        String(
          row.driver_name ||
          row.current_driver ||
          ""
        );


      const searchable =
        normalizeText(
          [
            row.position,
            rowTeam,
            rowDriver,
            row.apex_id,
            row.kart,
            row.kart_number,
            row.race_lap,
            row.lap_number,
            row.pit_lap
          ]
            .filter(
              value =>
                value !== null &&
                value !== undefined
            )
            .join(" ")
        );


      return (
        (
          !team ||
          rowTeam === team
        ) &&
        (
          !driver ||
          rowDriver === driver
        ) &&
        (
          !query ||
          searchable.includes(
            query
          )
        )
      );
    }
  );
}


// ============================================================
// FILTER DROPDOWN CONTENT
// ============================================================

function allRaceRows() {
  return [
    ...S.overview,
    ...S.stints,
    ...S.drivers,
    ...S.pits
  ];
}


function rebuildFilters() {
  const previousTeam =
    dropdownValue(
      "teamDropdown"
    );

  const previousDriver =
    dropdownValue(
      "driverDropdown"
    );


  const rows =
    allRaceRows();


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
        (
          a,
          b
        ) =>
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
        (
          a,
          b
        ) =>
          String(a)
            .localeCompare(
              String(b)
            )
      );


  rebuildDropdownMenu(
    "teamDropdownMenu",
    "All teams",
    teams
  );


  rebuildDropdownMenu(
    "driverDropdownMenu",
    "All drivers",
    drivers
  );


  const validTeam =
    teams.includes(
      previousTeam
    );


  const validDriver =
    drivers.includes(
      previousDriver
    );


  setDropdownValue(
    "teamDropdown",
    "teamDropdownLabel",
    "teamDropdownMenu",
    validTeam
      ? previousTeam
      : "",
    validTeam
      ? previousTeam
      : "All teams"
  );


  setDropdownValue(
    "driverDropdown",
    "driverDropdownLabel",
    "driverDropdownMenu",
    validDriver
      ? previousDriver
      : "",
    validDriver
      ? previousDriver
      : "All drivers"
  );
}


function rebuildDropdownMenu(
  menuId,
  allLabel,
  values
) {
  const menu =
    $(menuId);

  if (!menu) {
    return;
  }


  const oldSearch =
    menu
      .querySelector(
        ".dropdownSearch"
      )
      ?.value ||
    "";


  menu.innerHTML = `
<button
  type="button"
  class="dropdownOption"
  data-value=""
>
  <span></span>
  <span>${esc(allLabel)}</span>
  <span class="dropdownCheck">✓</span>
</button>

${values
  .map(
    value => `
<button
  type="button"
  class="dropdownOption"
  data-value="${esc(value)}"
>
  <span></span>
  <span>${esc(value)}</span>
  <span class="dropdownCheck">✓</span>
</button>
`
  )
  .join("")}
`;


  makeDropdownSearchable(
    menuId,
    `Search ${allLabel
      .replace(
        /^All\s+/i,
        ""
      )}...`
  );


  const input =
    menu.querySelector(
      ".dropdownSearch"
    );

  if (
    input &&
    oldSearch
  ) {
    input.value =
      oldSearch;

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


  if (
    $("search")
  ) {
    $("search").value =
      "";
  }


  renderActiveView();
}


// ============================================================
// COUNTERS
// ============================================================

function renderDatasetCounts() {
  const values = {
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
      name,
      value
    ]
    of Object.entries(
      values
    )
  ) {
    const node =
      $(
        `${name}Count`
      );

    if (node) {
      node.textContent =
        value;
    }
  }


  if (
    $("headerTeamCount")
  ) {
    $("headerTeamCount")
      .textContent =
        S.overview.length;
  }
}


// ============================================================
// FILTER SUMMARY
// ============================================================

function renderFilterSummary() {
  const node =
    $("filterSummary");

  const count =
    $("filteredCount");


  const team =
    dropdownValue(
      "teamDropdown"
    );

  const driver =
    dropdownValue(
      "driverDropdown"
    );

  const query =
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


  if (query) {
    parts.push(
      `Search: ${query}`
    );
  }


  if (node) {
    node.textContent =
      parts.length
        ? parts.join(" · ")
        : "No filters";
  }


  if (
    count &&
    S.activeView !==
    "reports"
  ) {
    const all =
      rowsForCurrentView();

    const visible =
      filterRows(all);

    count.textContent =
      all.length ===
      visible.length
        ? String(all.length)
        : `${visible.length} / ${all.length}`;
  }
}


// ============================================================
// CLEAR DATA
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
      key => {
        S.loaded[key] =
          false;
      }
    );


  renderDatasetCounts();
}


// ============================================================
// RACE LIST
// ============================================================

async function loadRaceList() {
  const menu =
    $("raceDropdownMenu");

  if (!menu) {
    return;
  }


  try {
    const data =
      await api(
        "/api/races",
        {
          raceId:
            null
        }
      );


    const races =
      data.rows ||
      [];


    menu.innerHTML = `
<div class="dropdownGroupLabel">
  CURRENT
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


    if (
      races.length
    ) {
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


    makeDropdownSearchable(
      "raceDropdownMenu",
      "Search race..."
    );


    syncRaceDropdown();

  } catch (error) {
    console.warn(
      "Race list:",
      error
    );
  }
}


function syncRaceDropdown() {
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
      ...document
        .querySelectorAll(
          "#raceDropdownMenu .dropdownOption[data-value]"
        )
    ]
      .find(
        row =>
          row.dataset.value ===
          `race:${S.raceId}`
      );


  setDropdownValue(
    "raceDropdown",
    "raceDropdownLabel",
    "raceDropdownMenu",
    `race:${S.raceId}`,
    optionLabel(
      option
    ) ||
    `Race ${S.raceId}`
  );
}


// ============================================================
// RACE CONTEXT
// ============================================================

function updateRaceContext() {
  const badge =
    $("raceModeBadge");

  const liveBadge =
    $("liveBadge");


  if (
    isLiveRace()
  ) {
    const status =
      S.liveMeta
        ?.session_status ||
      (
        S.liveMeta
          ?.is_live
          ? "LIVE"
          : "FINISHED"
      );


    if (badge) {
      badge.textContent =
        status;

      badge.className =
        status === "LIVE"
          ? "raceModeBadge live"
          : "raceModeBadge history";
    }


    if (liveBadge) {
      liveBadge.textContent =
        status;

      liveBadge.className =
        status === "LIVE"
          ? "liveBadge live"
          : "liveBadge history";
    }


    if (
      $("overviewTitle")
    ) {
      $("overviewTitle")
        .textContent =
          status === "LIVE"
            ? "Current race overview"
            : "Race overview";
    }


    if (
      $("overviewSubtitle")
    ) {
      $("overviewSubtitle")
        .textContent =
          status === "LIVE"
            ? "Current driver and stint performance updated from Apex Timing."
            : "Final race data retained from Apex Timing.";
    }

  } else {
    if (badge) {
      badge.textContent =
        "HISTORY";

      badge.className =
        "raceModeBadge history";
    }


    if (liveBadge) {
      liveBadge.textContent =
        "HISTORY";

      liveBadge.className =
        "liveBadge history";
    }


    if (
      $("overviewTitle")
    ) {
      $("overviewTitle")
        .textContent =
          $("raceDropdownLabel")
            ?.textContent ||
          `Race ${S.raceId}`;
    }


    if (
      $("overviewSubtitle")
    ) {
      $("overviewSubtitle")
        .textContent =
          "Stored race overview and statistics.";
    }
  }


  setSessionStatus();
}


// ============================================================
// OVERVIEW
// ============================================================

// Read a value from the unmodified Apex grid row. Prefer Apex semantic
// data-type names and use the current grid column only as a compatibility
// fallback. This is display-only: no analytics are reconstructed here.
function apexField(row, types = [], fallbackColumns = []) {
  const fields = row?.apex_fields;
  if (!fields || typeof fields !== "object") return null;

  const wanted = new Set(types.map(value => String(value || "").toLowerCase()));
  for (const cell of Object.values(fields)) {
    const type = String(cell?.type || "").toLowerCase();
    if (wanted.has(type)) {
      const value = cell?.value;
      if (value !== null && value !== undefined && String(value).trim() !== "") return value;
    }
  }

  for (const column of fallbackColumns) {
    const cell = fields[`c${column}`];
    const value = cell?.value;
    if (value !== null && value !== undefined && String(value).trim() !== "") return value;
  }

  return null;
}

function renderOverview() {
  const body =
    $("overviewBody");

  if (!body) {
    return;
  }


  const rows =
    filterRows(
      S.overview
    );


  if (
    $("teamCount")
  ) {
    $("teamCount")
      .textContent =
        rows.length;
  }


  body.innerHTML =
    rows
      .map(
        row => `
<tr
  class="clickableRow"
  data-team="${esc(row.team_name || "")}"
  data-apex-id="${esc(row.apex_id || "")}"
>

<td class="position">
  ${esc(row.position ?? "—")}
</td>

<td>
  ${esc(apexField(row, ["kart", "no", "num", "number", "kartnumber"], [2]) ?? "—")}
</td>

<td>
  ${esc(apexField(row, ["nation", "nat", "country", "flag"], [3]) ?? "—")}
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
  ${esc(apexField(row, ["s1", "sector1", "sector_1"], [5]) ?? "—")}
</td>

<td>
  ${esc(apexField(row, ["s2", "sector2", "sector_2"], [6]) ?? "—")}
</td>

<td>
  ${esc(apexField(row, ["s3", "sector3", "sector_3"], [7]) ?? "—")}
</td>

<td>
  ${esc(apexField(row, ["gap", "gapleader", "gap_leader"], [10]) ?? "—")}
</td>

<td>
  ${esc(apexField(row, ["interval", "interv", "gapnext", "gap_next"], [11]) ?? "—")}
</td>

<td>
  ${esc(
    pick(
      row,
      "race_lap",
      "live_lap_count",
      "lap_count"
    ) ?? "—"
  )}
</td>

<td>
  ${esc(apexField(row, ["ontrack", "on_track", "tracktime", "trk"], [14]) ?? "—")}
</td>

<td>
  ${esc(row.pit_count ?? "—")}
</td>

<td>
  ${esc(apexField(row, ["pittime", "pit_time", "pt"], [16]) ?? "—")}
</td>

<td>
  ${esc(apexField(row, ["penalty", "pen", "penaltime"], [17]) ?? "—")}
</td>

<td>
  #${esc(row.stint_number ?? "—")}
</td>

<td>
  ${esc(
    pick(
      row,
      "stint_laps",
      "total_stint_laps",
      "total_laps"
    ) ?? "—"
  )}
</td>

<td>
  ${esc(row.valid_laps ?? "—")}
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

<td class="good">
  ${time(row.apex_best_lap)}
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
      "worst_lap"
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
    row.consistency
  )}
</td>

<td class="muted">
  ${formatUpdated(
    row.updated_at
  )}
</td>

</tr>
`
      )
      .join("") ||
    `
<tr class="empty">
  <td colspan="29">
    ${
      isLiveRace()
        ? "Waiting for current Apex race data."
        : "No stored overview data."
    }
  </td>
</tr>
`;
}


function renderOverviewSummary() {
  const rows =
    S.overview;


  const raceLap =
    rows.reduce(
      (
        max,
        row
      ) =>
        Math.max(
          max,
          number(
            pick(
              row,
              "race_lap",
              "live_lap_count",
              "lap_count"
            )
          ) || 0
        ),
      0
    );


  const pitStops =
    rows.reduce(
      (
        total,
        row
      ) =>
        total +
        (
          number(
            row.pit_count
          ) ||
          0
        ),
      0
    );


  const best =
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


  const liveSummary = isLiveRace() ? S.liveMeta : null;
  const authoritativeTeams = number(liveSummary?.team_count);
  const authoritativeLap = number(liveSummary?.race_lap);
  const authoritativePits = number(liveSummary?.pit_count);
  const authoritativeBest = number(liveSummary?.race_best_lap ?? liveSummary?.best_lap);

  if ($("summaryTeams")) {
    const value = authoritativeTeams !== null && authoritativeTeams > 0 ? authoritativeTeams : rows.length;
    $("summaryTeams").textContent = value > 0 ? value : "—";
  }

  if ($("summaryRaceLap")) {
    const value = authoritativeLap !== null && authoritativeLap > 0 ? authoritativeLap : raceLap;
    $("summaryRaceLap").textContent = value > 0 ? value : "—";
  }

  if ($("summaryPits")) {
    const value = authoritativePits !== null && authoritativePits > 0 ? authoritativePits : pitStops;
    $("summaryPits").textContent = value > 0 ? value : (rows.length ? 0 : "—");
  }

  if ($("summaryBestLap")) {
    const fallbackBest = best.length ? Math.min(...best) : null;
    const value = authoritativeBest !== null && authoritativeBest > 0
      ? authoritativeBest
      : fallbackBest;

    $("summaryBestLap").textContent =
      value !== null && value > 0
        ? time(value)
        : "—";
  }
}


// ============================================================
// STINTS
// ============================================================

function renderStints() {
  const body =
    $("stintsBody");

  if (!body) {
    return;
  }


  const rows =
    filterRows(
      S.stints
    );


  body.innerHTML =
    rows
      .map(
        row => `
<tr
  class="clickableRow"
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
  ${esc(row.driver_name || "—")}
</td>

<td>
  #${esc(row.stint_number ?? "—")}
</td>

<td>
  ${esc(row.start_lap_count ?? "—")}
</td>

<td>
  ${
    row.end_lap_count !== null &&
    row.end_lap_count !== undefined
      ? esc(row.end_lap_count)
      : (
          row.is_live
            ? '<span class="good">LIVE</span>'
            : "—"
        )
  }
</td>

<td>
  ${esc(row.total_laps ?? "—")}
</td>

<td>
  ${esc(row.valid_laps ?? "—")}
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
  ${esc(row.best_lap_number ?? "—")}
</td>

<td class="bad">
  ${time(
    pick(
      row,
      "worst_lap_time",
      "worst_lap"
    )
  )}
</td>

<td>
  ${esc(row.worst_lap_number ?? "—")}
</td>

<td>${time(row.consistency)}</td>
<td>${time(row.straight_avg_lap_time)}</td>
<td class="good">${time(row.straight_best_lap_time)}</td>
<td class="bad">${time(row.straight_worst_lap_time)}</td>
<td>${time(row.reverse_avg_lap_time)}</td>
<td class="good">${time(row.reverse_best_lap_time)}</td>
<td class="bad">${time(row.reverse_worst_lap_time)}</td>
<td>${time(row.rain_avg_lap_time)}</td>
<td class="good">${time(row.rain_best_lap_time)}</td>
<td class="bad">${time(row.rain_worst_lap_time)}</td>

</tr>
`
      )
      .join("") ||
    `
<tr class="empty">
  <td colspan="22">
    No stint data for this race.
  </td>
</tr>
`;
}


// ============================================================
// DRIVERS
// ============================================================

function renderDrivers() {
  const body =
    $("driversBody");

  if (!body) {
    return;
  }


  const rows =
    filterRows(
      S.drivers
    );


  body.innerHTML =
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
  ${esc(row.driver_name || "—")}
</td>

<td>
  ${esc(
    pick(
      row,
      "valid_stint_count",
      "stint_count"
    ) ?? "—"
  )}
</td>

<td>
  ${esc(row.short_stint_count ?? 0)}
</td>

<td>
  ${esc(row.valid_laps ?? "—")}
</td>

<td>
  ${esc(row.total_laps ?? "—")}
</td>

<td>
  ${time(row.avg_lap_time)}
</td>

<td class="good">
  ${time(row.best_lap_time)}
</td>

<td>
  ${time(
    pick(
      row,
      "avg_consistency",
      "consistency"
    )
  )}
</td>

</tr>
`
      )
      .join("") ||
    `
<tr class="empty">
  <td colspan="9">
    No driver data for this race.
  </td>
</tr>
`;
}


// ============================================================
// TEAMS
// ============================================================

function renderTeams() {
  const body =
    $("teamsBody");

  if (!body) {
    return;
  }


  const rows =
    filterRows(
      S.teams
    );


  body.innerHTML =
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
      "driver_count",
      "drivers"
    ) ?? "—"
  )}
</td>

<td>
  ${esc(
    pick(
      row,
      "stint_count",
      "valid_stint_count"
    ) ?? "—"
  )}
</td>

<td>
  ${esc(row.valid_laps ?? "—")}
</td>

<td>
  ${esc(row.total_laps ?? "—")}
</td>

<td>${time(row.avg_lap_time)}</td>
<td class="good">${time(row.best_lap_time)}</td>
<td>${esc(row.best_lap_number ?? "—")}</td>
<td class="bad">${time(row.worst_lap_time)}</td>
<td>${esc(row.worst_lap_number ?? "—")}</td>
<td>${time(pick(row,"avg_consistency","consistency"))}</td>
<td>${time(row.straight_avg_lap_time)}</td>
<td class="good">${time(row.straight_best_lap_time)}</td>
<td class="bad">${time(row.straight_worst_lap_time)}</td>
<td>${time(row.reverse_avg_lap_time)}</td>
<td class="good">${time(row.reverse_best_lap_time)}</td>
<td class="bad">${time(row.reverse_worst_lap_time)}</td>
<td>${time(row.rain_avg_lap_time)}</td>
<td class="good">${time(row.rain_best_lap_time)}</td>
<td class="bad">${time(row.rain_worst_lap_time)}</td>

</tr>
`
      )
      .join("") ||
    `
<tr class="empty">
  <td colspan="20">
    No team data for this race.
  </td>
</tr>
`;
}


// ============================================================
// PITS
// ============================================================

function renderPits() {
  const body =
    $("pitsBody");

  if (!body) {
    return;
  }


  const rows =
    filterRows(
      S.pits
    );


  body.innerHTML =
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
  ${esc(row.driver_name || "—")}
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
    row.total_time ??
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
    No pit data for this race.
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

  if (!body) {
    return;
  }


  const rows =
    filterRows(
      S.events
    );


  body.innerHTML =
    rows
      .map(
        row => `
<tr>

<td>
  ${esc(
    formatUpdated(
      row.time ||
      row.created_at
    )
  )}
</td>

<td>
  ${esc(row.type || "—")}
</td>

<td class="team">
  ${esc(
    row.team_name ||
    (
      row.apex_id
        ? `APEX ${row.apex_id}`
        : "—"
    )
  )}
</td>

<td>
  ${esc(row.driver_name || "—")}
</td>

<td>
  ${esc(row.lap_number ?? "—")}
</td>

<td>
  ${esc(row.reason || "—")}
</td>

<td>
  ${esc(row.status || "—")}
</td>

<td>
  ${
    row.apex_id &&
    row.lap_number
      ? `
<button
  type="button"
  class="eventRemoveButton"
  data-remove-exclusion
  data-apex-id="${esc(row.apex_id)}"
  data-lap-number="${esc(row.lap_number)}"
>
  REMOVE
</button>
`
      : "—"
  }
</td>

</tr>
`
      )
      .join("") ||
    `
<tr class="empty">
  <td colspan="8">
    No race events or manual exclusions.
  </td>
</tr>
`;
}


// ============================================================
// ACTIVE RENDER
// ============================================================

function renderActiveView() {
  switch (
    S.activeView
  ) {
    case "overview":
      renderOverview();
      renderOverviewSummary();
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

    case "reports":
      renderReports();
      break;
  }


  renderDatasetCounts();
  renderFilterSummary();
  renderDataAge();
}


// ============================================================
// LOAD LIVE
// ============================================================

async function loadLiveOverview() {
  const data =
    await api(
      "/api/live",
      {
        raceId: null
      }
    );


  S.liveMeta =
    data;


  S.raceId =
    data.race_id ??
    S.raceId;


  S.overview =
    Array.isArray(
      data.current
    )
      ? data.current
      : [];


  S.loaded.overview =
    true;


  const status =
    data.session_status ||
    (
      data.is_live
        ? "LIVE"
        : (
            S.overview.length
              ? "FINISHED"
              : "WAITING"
          )
    );


  setStatus(
    S.overview.length > 0,
    status
  );


  updateRaceContext();
}


// ============================================================
// LOAD DATASETS
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
    isLiveRace() &&
    !raceHasData()
  ) {
    S.stints = [];
    S.loaded.stints = true;
    return;
  }


  const data =
    await api(
      "/api/stints"
    );


  S.stints =
    data.rows || [];

  S.loaded.stints =
    true;
}


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
    isLiveRace() &&
    !raceHasData()
  ) {
    S.drivers = [];
    S.loaded.drivers = true;
    return;
  }


  const data =
    await api(
      "/api/drivers"
    );


  S.drivers =
    data.rows || [];

  S.loaded.drivers =
    true;
}


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
    isLiveRace() &&
    !raceHasData()
  ) {
    S.teams = [];
    S.loaded.teams = true;
    return;
  }


  const data =
    await api(
      "/api/teams"
    );


  S.teams =
    data.rows || [];

  S.loaded.teams =
    true;
}


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
    isLiveRace() &&
    !raceHasData()
  ) {
    S.pits = [];
    S.loaded.pits = true;
    return;
  }


  const data =
    await api(
      "/api/pits"
    );


  S.pits =
    data.rows || [];

  S.loaded.pits =
    true;
}


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
    isLiveRace() &&
    !raceHasData()
  ) {
    S.events = [];
    S.loaded.events = true;
    return;
  }


  const data =
    await api(
      "/api/events"
    );


  S.events =
    data.rows || [];

  S.loaded.events =
    true;
}


// ============================================================
// HISTORY OVERVIEW
// ============================================================

function buildHistoricalOverview() {
  const latest =
    new Map();


  for (
    const row
    of S.stints
  ) {
    const key =
      String(
        row.apex_id ??
        row.team_name ??
        ""
      );


    const previous =
      latest.get(key);


    const currentStart =
      number(
        row.start_lap_count
      ) || 0;


    const previousStart =
      number(
        previous
          ?.start_lap_count
      ) || -1;


    if (
      !previous ||
      currentStart >=
        previousStart
    ) {
      latest.set(
        key,
        row
      );
    }
  }


  S.overview =
    [
      ...latest.values()
    ]
      .map(
        row => ({
          ...row,

          race_lap:
            row.end_lap_count ??
            row.current_lap_count ??
            row.start_lap_count ??
            null,

          stint_laps:
            row.total_laps,

          position:
            null
        })
      );


  S.loaded.overview =
    true;
}


// ============================================================
// FULL RACE LOAD
// ============================================================

async function loadFullRace(
  force = true
) {
  if (
    S.refreshing
  ) {
    return;
  }


  S.refreshing =
    true;


  try {

    if (
      isLiveRace()
    ) {
      await loadLiveOverview();


      if (
        !raceHasData()
      ) {
        S.stints = [];
        S.drivers = [];
        S.teams = [];
        S.pits = [];
        S.events = [];


        S.loaded.stints = true;
        S.loaded.drivers = true;
        S.loaded.teams = true;
        S.loaded.pits = true;
        S.loaded.events = true;


        rebuildFilters();
        renderActiveView();

        return;
      }


      const results =
        await Promise.allSettled([
          loadStints(force),
          loadDrivers(force),
          loadTeams(force),
          loadPits(force),
          loadEvents(force)
        ]);


      results.forEach(
        result => {
          if (
            result.status ===
            "rejected"
          ) {
            console.error(
              result.reason
            );
          }
        }
      );


    } else {
      const results =
        await Promise.allSettled([
          loadStints(force),
          loadDrivers(force),
          loadTeams(force),
          loadPits(force),
          loadEvents(force)
        ]);


      results.forEach(
        result => {
          if (
            result.status ===
            "rejected"
          ) {
            console.error(
              result.reason
            );
          }
        }
      );


      buildHistoricalOverview();

      setStatus(
        true,
        "HISTORY"
      );

      updateRaceContext();
    }


    rebuildFilters();
    renderActiveView();


  } catch (error) {
    console.error(
      "Race load failed:",
      error
    );

    setStatus(
      false,
      "ERROR"
    );

  } finally {
    S.refreshing =
      false;
  }
}


// ============================================================
// VIEW FALLBACK LOAD
// ============================================================

async function loadCurrentView(
  force = false
) {
  switch (
    S.activeView
  ) {
    case "overview":
      if (
        isLiveRace()
      ) {
        await loadLiveOverview();

      } else if (
        !S.loaded.overview
      ) {
        buildHistoricalOverview();
      }
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
      await loadEvents(force);
      break;

    case "reports":
      renderReports();
      break;
  }


  rebuildFilters();
  renderActiveView();
}


// ============================================================
// NAVIGATION
// ============================================================

async function switchView(view) {
  if (!view) {
    return;
  }


  S.activeView =
    view;


  document
    .querySelectorAll(
      ".nav button[data-view]"
    )
    .forEach(
      button => {
        button.classList.toggle(
          "active",
          button.dataset.view ===
          view
        );
      }
    );


  document
    .querySelectorAll(
      ".view"
    )
    .forEach(
      section => {
        section.classList.remove(
          "active"
        );
      }
    );


  $(
    `view-${view}`
  )
    ?.classList
    .add(
      "active"
    );


  if (
    view !== "reports"
  ) {
    await loadCurrentView(
      false
    );

  } else {
    renderReports();
  }
}


function initNavigation() {
  document
    .querySelectorAll(
      ".nav button[data-view]"
    )
    .forEach(
      button => {
        button.addEventListener(
          "click",
          () =>
            switchView(
              button.dataset.view
            )
        );
      }
    );
}


// ============================================================
// RACE SELECT
// ============================================================

function initRaceDropdown() {
  initDropdown(
    "raceDropdown",
    "raceDropdownTrigger",
    "raceDropdownMenu",
    async (
      value,
      option
    ) => {
      const label =
        optionLabel(
          option
        );


      if (
        value === "live"
      ) {
        S.source =
          "live";

        S.raceId =
          null;

        S.liveMeta =
          null;

      } else if (
        value.startsWith(
          "race:"
        )
      ) {
        S.source =
          "history";

        S.raceId =
          value.substring(5);

        S.liveMeta =
          null;
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


      await loadFullRace(
        true
      );
    }
  );


  makeDropdownSearchable(
    "raceDropdownMenu",
    "Search race..."
  );
}


// ============================================================
// FILTER INIT
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


  makeDropdownSearchable(
    "teamDropdownMenu",
    "Search team..."
  );


  makeDropdownSearchable(
    "driverDropdownMenu",
    "Search driver..."
  );


  $("search")
    ?.addEventListener(
      "input",
      renderActiveView
    );


  $("searchClear")
    ?.addEventListener(
      "click",
      () => {
        if (
          $("search")
        ) {
          $("search").value =
            "";

          $("search").focus();
        }

        renderActiveView();
      }
    );


  $("resetFilters")
    ?.addEventListener(
      "click",
      resetFilters
    );
}


// ============================================================
// REFRESH
// ============================================================

function setRefreshBusy(
  busy
) {
  const button =
    $("refreshButton");

  if (!button) {
    return;
  }

  button.disabled =
    busy;

  button.textContent =
    busy
      ? "…"
      : "↻";
}


async function manualRefresh() {
  if (
    S.refreshing
  ) {
    return;
  }


  setRefreshBusy(
    true
  );


  try {
    Object
      .keys(
        S.loaded
      )
      .forEach(
        key => {
          S.loaded[key] =
            false;
        }
      );


    if (
      isLiveRace()
    ) {
      S.liveMeta =
        null;
    }


    await loadFullRace(
      true
    );

  } finally {
    setRefreshBusy(
      false
    );
  }
}


function initRefresh() {
  $("refreshButton")
    ?.addEventListener(
      "click",
      manualRefresh
    );
}


// ============================================================
// AUTO REFRESH
// ============================================================

function startAutoRefresh() {
  if (
    S.autoRefreshTimer
  ) {
    clearInterval(
      S.autoRefreshTimer
    );
  }


  let fullCounter =
    0;


  S.autoRefreshTimer =
    setInterval(
      async () => {
        if (
          !isLiveRace() ||
          !$("autoRefresh")?.checked ||
          S.refreshing
        ) {
          return;
        }


        try {
          await loadLiveOverview();

          fullCounter += 1;


          if (
            fullCounter >= 5
          ) {
            fullCounter = 0;

            await Promise.allSettled([
              loadStints(true),
              loadDrivers(true),
              loadTeams(true),
              loadPits(true),
              loadEvents(true)
            ]);

            rebuildFilters();
          }


          renderActiveView();

        } catch (error) {
          console.warn(
            "Auto refresh:",
            error
          );
        }
      },
      3000
    );
}


// ============================================================
// DATA AGE
// ============================================================

function latestUpdateTime() {
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
    latestUpdateTime();


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
        ) / 1000
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


function startDataAgeTimer() {
  if (
    S.dataAgeTimer
  ) {
    clearInterval(
      S.dataAgeTimer
    );
  }


  S.dataAgeTimer =
    setInterval(
      renderDataAge,
      1000
    );
}


// ============================================================
// MANUAL EXCLUSION
// ============================================================

function openManualExclusion(
  apexId = "",
  lap = ""
) {
  if ($("manualExclusionApexId")) {
    $("manualExclusionApexId").value =
      apexId;
  }


  if ($("manualExclusionLap")) {
    $("manualExclusionLap").value =
      lap;
  }


  if ($("manualExclusionReason")) {
    $("manualExclusionReason").value =
      "";
  }


  $("manualExclusionBackdrop")
    ?.classList
    .add(
      "open"
    );


  $("manualExclusionModal")
    ?.classList
    .add(
      "open"
    );
}


function closeManualExclusion() {
  $("manualExclusionBackdrop")
    ?.classList
    .remove(
      "open"
    );


  $("manualExclusionModal")
    ?.classList
    .remove(
      "open"
    );
}


async function submitManualExclusion() {
  const apexId =
    $("manualExclusionApexId")
      ?.value
      ?.trim();

  const lap =
    Number(
      $("manualExclusionLap")
        ?.value
    );

  const reason =
    $("manualExclusionReason")
      ?.value
      ?.trim();


  if (
    !apexId ||
    !Number.isFinite(lap) ||
    lap <= 0
  ) {
    alert(
      "APEX ID and lap number are required."
    );

    return;
  }


  await api(
    "/api/events",
    {
      method:
        "POST",

      body: {
        apex_id:
          apexId,

        lap_number:
          Math.trunc(lap),

        reason:
          reason ||
          "Manual exclusion"
      }
    }
  );


  closeManualExclusion();


  await Promise.allSettled([
    loadStints(true),
    loadDrivers(true),
    loadTeams(true),
    loadEvents(true)
  ]);


  rebuildFilters();
  renderActiveView();
}


async function removeManualExclusion(
  apexId,
  lap
) {
  const url =
    new URL(
      "/api/events",
      window.location.origin
    );


  const raceId =
    selectedRaceId();


  if (
    raceId !== null &&
    raceId !== undefined
  ) {
    url.searchParams.set(
      "race_id",
      String(raceId)
    );
  }


  url.searchParams.set(
    "apex_id",
    String(apexId)
  );


  url.searchParams.set(
    "lap_number",
    String(lap)
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


  await Promise.allSettled([
    loadStints(true),
    loadDrivers(true),
    loadTeams(true),
    loadEvents(true)
  ]);


  rebuildFilters();
  renderActiveView();
}


function initManualExclusion() {
  $("manualExclusionOpen")
    ?.addEventListener(
      "click",
      () =>
        openManualExclusion()
    );


  $("manualExclusionClose")
    ?.addEventListener(
      "click",
      closeManualExclusion
    );


  $("manualExclusionCancel")
    ?.addEventListener(
      "click",
      closeManualExclusion
    );


  $("manualExclusionBackdrop")
    ?.addEventListener(
      "click",
      closeManualExclusion
    );


  $("manualExclusionSubmit")
    ?.addEventListener(
      "click",
      async () => {
        try {
          await submitManualExclusion();

        } catch (error) {
          console.error(error);

          alert(
            error.message
          );
        }
      }
    );


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


      try {
        await removeManualExclusion(
          button.dataset.apexId,
          button.dataset.lapNumber
        );

      } catch (error) {
        console.error(error);

        alert(
          error.message
        );
      }
    }
  );
}


// ============================================================
// DETAIL PANEL
// ============================================================

function closeDetailPanel() {
  $("detailBackdrop")
    ?.classList
    .remove(
      "open"
    );


  $("detailPanel")
    ?.classList
    .remove(
      "open"
    );
}


function openTeamDetail(
  team,
  apexId
) {
  const title =
    $("detailTitle");

  const subtitle =
    $("detailSubtitle");

  const body =
    $("detailBody");


  if (
    !title ||
    !body
  ) {
    return;
  }


  title.textContent =
    team ||
    `APEX ${apexId}`;


  const stints =
    S.stints.filter(
      row =>
        String(
          row.apex_id
        ) ===
        String(
          apexId
        )
    );


  const drivers =
    S.drivers.filter(
      row =>
        String(
          row.apex_id
        ) ===
        String(
          apexId
        )
    );


  if (subtitle) {
    subtitle.textContent =
      `${drivers.length} drivers · ${stints.length} stints`;
  }


  body.innerHTML = `
<div class="detailSection">

  <div class="detailSectionTitle">
    DRIVERS
  </div>

  <div class="detailTableWrap">

    <table class="detailTable">

      <thead>
        <tr>
          <th>DRIVER</th>
          <th>STINTS</th>
          <th>VALID LAPS</th>
          <th>TOTAL LAPS</th>
          <th>AVERAGE</th>
          <th>BEST</th>
          <th>CONSISTENCY</th>
        </tr>
      </thead>

      <tbody>

        ${
          drivers
            .map(
              row => `
<tr>
<td>${esc(row.driver_name)}</td>
<td>${esc(row.stint_count ?? row.valid_stint_count ?? "—")}</td>
<td>${esc(row.valid_laps ?? "—")}</td>
<td>${esc(row.total_laps ?? "—")}</td>
<td>${time(row.avg_lap_time)}</td>
<td class="good">${time(row.best_lap_time)}</td>
<td>${time(row.avg_consistency)}</td>
</tr>
`
            )
            .join("") ||
          `
<tr class="empty">
<td colspan="7">No driver data.</td>
</tr>
`
        }

      </tbody>

    </table>

  </div>

</div>


<div class="detailSection">

  <div class="detailSectionTitle">
    STINTS
  </div>

  <div class="detailTableWrap">

    <table class="detailTable">

      <thead>
        <tr>
          <th>#</th>
          <th>DRIVER</th>
          <th>START</th>
          <th>END</th>
          <th>TOTAL</th>
          <th>VALID</th>
          <th>AVERAGE</th>
          <th>BEST</th>
          <th>WORST</th>
        </tr>
      </thead>

      <tbody>

        ${
          stints
            .map(
              row => `
<tr>
<td>#${esc(row.stint_number ?? "—")}</td>
<td>${esc(row.driver_name || "—")}</td>
<td>${esc(row.start_lap_count ?? "—")}</td>
<td>${esc(row.end_lap_count ?? "LIVE")}</td>
<td>${esc(row.total_laps ?? "—")}</td>
<td>${esc(row.valid_laps ?? "—")}</td>
<td>${time(row.avg_lap_time ?? row.avg_lap)}</td>
<td class="good">${time(row.best_lap_time ?? row.best_lap)}</td>
<td class="bad">${time(row.worst_lap_time ?? row.worst_lap)}</td>
</tr>
`
            )
            .join("") ||
          `
<tr class="empty">
<td colspan="9">No stint data.</td>
</tr>
`
        }

      </tbody>

    </table>

  </div>

</div>
`;


  $("detailBackdrop")
    ?.classList
    .add(
      "open"
    );


  $("detailPanel")
    ?.classList
    .add(
      "open"
    );
}


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


  document.addEventListener(
    "dblclick",
    event => {
      const row =
        event.target.closest(
          ".clickableRow[data-apex-id]"
        );

      if (!row) {
        return;
      }


      openTeamDetail(
        row.dataset.team,
        row.dataset.apexId
      );
    }
  );
}


// ============================================================
// LOCAL CSV HELPERS
// ============================================================

function downloadText(
  filename,
  content,
  mime
) {
  const blob =
    new Blob(
      [content],
      {
        type: mime
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


  setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    1000
  );
}


function csvValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }


  const text =
    String(value);


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


function raceAnalyticsRows() {
  const rows = [];


  for (
    const row
    of S.stints
  ) {
    rows.push({
      dataset:
        "stint",
      ...row
    });
  }


  for (
    const row
    of S.drivers
  ) {
    rows.push({
      dataset:
        "driver",
      ...row
    });
  }


  for (
    const row
    of S.teams
  ) {
    rows.push({
      dataset:
        "team",
      ...row
    });
  }


  for (
    const row
    of S.pits
  ) {
    rows.push({
      dataset:
        "pit",
      ...row
    });
  }


  return rows;
}


function buildRaceAnalyticsCsv() {
  const rows =
    raceAnalyticsRows();


  if (!rows.length) {
    throw new Error(
      "No race analytics data."
    );
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


  return [
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
}


function reportBaseName() {
  return (
    $("raceDropdownLabel")
      ?.textContent
      ?.trim() ||
    "Race"
  )
    .replace(
      /[\\/:*?"<>|]/g,
      "-"
    );
}


function openReportWindow(path) {
  window.open(
    apiUrl(path),
    "_blank",
    "noopener"
  );
}


// ============================================================
// ANALYTICS PDF
// ============================================================

function openAnalyticsPdf() {
  const rows =
    raceAnalyticsRows();


  if (!rows.length) {
    throw new Error(
      "No race analytics data."
    );
  }


  const win =
    window.open(
      "",
      "_blank"
    );


  if (!win) {
    throw new Error(
      "The browser blocked the report window."
    );
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


  win.document.write(`
<!doctype html>

<html>

<head>

<meta charset="utf-8">

<title>${esc(reportBaseName())} - Race Analytics</title>

<style>

@page {
  size: A4 landscape;
  margin: 8mm;
}

body {
  font-family: Arial, Helvetica, sans-serif;
  margin: 12px;
  color: #111;
  font-size: 8px;
}

h1 {
  font-size: 18px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  border: 1px solid #bbb;
  padding: 3px;
  white-space: nowrap;
}

th {
  background: #eee;
}

</style>

</head>

<body>

<h1>
${esc(reportBaseName())} - Race Analytics
</h1>

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

<script>
window.onload = () => window.print();
<\/script>

</body>

</html>
`);


  win.document.close();
}


// ============================================================
// REPORTS
// ============================================================

function renderReports() {
  const hasRace =
    raceHasData() ||
    (
      !isLiveRace() &&
      S.raceId
    );


  [
    "downloadRaceCsv",
    "downloadRacePdf",
    "organiserReport1Csv",
    "organiserReport1Pdf",
    "organiserReport2Csv",
    "organiserReport2Pdf",
    "viewRawApex",
    "downloadRawApexJson",
    "downloadRawApexTxt"
  ]
    .forEach(
      id => {
        const button =
          $(id);

        if (button) {
          button.disabled =
            !hasRace;
        }
      }
    );



  const note =
    $("reportFilterNote");


  if (note) {
    const team =
      dropdownValue(
        "teamDropdown"
      );

    note.textContent =
      team
        ? `Report filter: ${team}`
        : "Report scope: all teams";
  }


  const status =
    $("reportStatus");


  if (status) {
    status.textContent =
      hasRace
        ? "Race data ready"
        : "No race selected";
  }
}


function setReportButtonBusy(
  button,
  busy,
  idleText
) {
  if (!button) {
    return;
  }

  button.disabled =
    busy;

  button.dataset.idleText =
    idleText ||
    button.dataset.idleText ||
    button.textContent;

  button.textContent =
    busy
      ? "GENERATING..."
      : button.dataset.idleText;
}


function initReports() {
  $("viewRawApex")
    ?.addEventListener("click", () => {
      const params = new URLSearchParams();
      if (S.raceId) params.set("race_id", String(S.raceId));
      params.set("limit", "500");
      window.open(`/api/raw/apex?${params.toString()}`, "_blank", "noopener");
    });

  $("downloadRawApexJson")
    ?.addEventListener("click", async event => {
      const button = event.currentTarget;
      setReportButtonBusy(button, true, "JSON");
      try {
        await downloadFileFromEndpoint(
          "/api/reports/apex-raw.json",
          `${reportBaseName()} - Apex raw data.json`
        );
      } catch (error) {
        alert(`Raw Apex JSON download failed:\n\n${error.message}`);
      } finally {
        setReportButtonBusy(button, false, "JSON");
        renderReports();
      }
    });

  $("downloadRawApexTxt")
    ?.addEventListener("click", async event => {
      const button = event.currentTarget;
      setReportButtonBusy(button, true, "RAW TXT");
      try {
        await downloadFileFromEndpoint(
          "/api/reports/apex-raw.txt",
          `${reportBaseName()} - Apex raw packets.txt`
        );
      } catch (error) {
        alert(`Raw Apex TXT download failed:\n\n${error.message}`);
      } finally {
        setReportButtonBusy(button, false, "RAW TXT");
        renderReports();
      }
    });

  $("downloadRaceCsv")
    ?.addEventListener(
      "click",
      () => {
        try {
          downloadText(
            `${reportBaseName()} - Race Analytics.csv`,
            buildRaceAnalyticsCsv(),
            "text/csv;charset=utf-8"
          );

        } catch (error) {
          alert(
            error.message
          );
        }
      }
    );


  $("downloadRacePdf")
    ?.addEventListener(
      "click",
      () => {
        try {
          openAnalyticsPdf();

        } catch (error) {
          alert(
            error.message
          );
        }
      }
    );


  /*
   * REQUIRED RAW APEX LAP CSV.
   *
   * IMPORTANT:
   * This now uses fetch + Blob instead of window.location.href.
   */
  $("organiserReport1Csv")
    ?.addEventListener(
      "click",
      async event => {
        const button =
          event.currentTarget;


        setReportButtonBusy(
          button,
          true,
          "CSV"
        );


        try {
          const result =
            await downloadFileFromEndpoint(
              "/api/reports/lap-time-records.csv",
              `${reportBaseName()} - Lap time records.csv`
            );


          console.log(
            "CSV downloaded:",
            result
          );


        } catch (error) {
          console.error(
            "CSV DOWNLOAD ERROR",
            error
          );


          alert(
            `CSV download failed:\n\n${error.message}`
          );


        } finally {
          setReportButtonBusy(
            button,
            false,
            "CSV"
          );


          renderReports();
        }
      }
    );


  $("organiserReport1Pdf")
    ?.addEventListener(
      "click",
      async event => {
        const button = event.currentTarget;
        setReportButtonBusy(button, true, "PDF");
        try {
          await downloadFileFromEndpoint(
            "/api/reports/lap-time-records.pdf",
            `${reportBaseName()} - Lap time records.pdf`
          );
        } catch (error) {
          console.error("LAP PDF DOWNLOAD ERROR", error);
          alert(`Lap Time Records PDF download failed:\n\n${error.message}`);
        } finally {
          setReportButtonBusy(button, false, "PDF");
          renderReports();
        }
      }
    );


  $("organiserReport2Csv")
    ?.addEventListener(
      "click",
      async event => {
        const button = event.currentTarget;
        setReportButtonBusy(button, true, "CSV");
        try {
          await downloadFileFromEndpoint(
            "/api/reports/pit-stops.csv",
            `${reportBaseName()} - Pit stops.csv`
          );
        } catch (error) {
          console.error("PIT CSV DOWNLOAD ERROR", error);
          alert(`Pit Stops CSV download failed:\n\n${error.message}`);
        } finally {
          setReportButtonBusy(button, false, "CSV");
          renderReports();
        }
      }
    );


  $("organiserReport2Pdf")
    ?.addEventListener(
      "click",
      async event => {
        const button = event.currentTarget;
        setReportButtonBusy(button, true, "PDF");
        try {
          await downloadFileFromEndpoint(
            "/api/reports/pit-stops.pdf",
            `${reportBaseName()} - Pit stops.pdf`
          );
        } catch (error) {
          console.error("PIT PDF DOWNLOAD ERROR", error);
          alert(`Pit Stops PDF download failed:\n\n${error.message}`);
        } finally {
          setReportButtonBusy(button, false, "PDF");
          renderReports();
        }
      }
    );
}


// ============================================================
// COLLECTOR
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


    node.textContent =
      data.direct_live
        ? `Apex live grid · field ${data.field_count ?? "—"}`
        : (data.connected
            ? `Collector connected · field ${data.field_count ?? "—"}`
            : "Collector disconnected");


    node.classList.toggle(
      "ok",
      data.connected ===
      true || data.direct_live === true
    );


    node.classList.toggle(
      "bad",
      data.connected !==
      true && data.direct_live !== true
    );

  } catch {
    node.textContent =
      "Collector unavailable";

    node.classList.add(
      "bad"
    );
  }
}


async function collectorAction(
  path
) {
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


    await loadCollectorStatus();

    await loadFullRace(
      true
    );

  } catch (error) {
    console.error(error);

    alert(
      error.message
    );
  }
}


function initCollector() {
  $("collectorStart")
    ?.addEventListener(
      "click",
      () =>
        collectorAction(
          "/api/collector/start"
        )
    );


  $("collectorReconnect")
    ?.addEventListener(
      "click",
      () =>
        collectorAction(
          "/api/collector/reconnect"
        )
    );
}


// ============================================================
// KEYBOARD
// ============================================================

function initKeyboard() {
  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
        "Escape"
      ) {
        closeAllDropdowns();
        closeDetailPanel();
        closeManualExclusion();

        return;
      }


      const typing =
        event.target instanceof
          HTMLInputElement ||
        event.target instanceof
          HTMLTextAreaElement;


      if (typing) {
        return;
      }


      if (
        event.key ===
        "/"
      ) {
        event.preventDefault();

        $("search")
          ?.focus();
      }
    }
  );
}


// ============================================================
// VISIBILITY
// ============================================================

function initVisibility() {
  document.addEventListener(
    "visibilitychange",
    async () => {
      if (
        document.visibilityState !==
        "visible"
      ) {
        return;
      }


      if (
        isLiveRace() &&
        $("autoRefresh")
          ?.checked
      ) {
        await loadFullRace(
          true
        );
      }


      loadCollectorStatus();
    }
  );
}


// ============================================================
// INITIAL VIEW
// ============================================================

function detectInitialView() {
  const active =
    document.querySelector(
      ".nav button.active[data-view]"
    );


  if (
    active?.dataset.view
  ) {
    S.activeView =
      active.dataset.view;
  }
}


// ============================================================
// START
// ============================================================

async function init() {
  try {

    detectInitialView();


    initRaceDropdown();
    initFilters();
    initNavigation();
    initRefresh();
    initManualExclusion();
    initDetailPanel();
    initReports();
    initCollector();
    initKeyboard();
    initVisibility();


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


    loadRaceList()
      .catch(
        console.warn
      );


    loadCollectorStatus()
      .catch(
        console.warn
      );


    await loadFullRace(
      true
    );


    startAutoRefresh();
    startDataAgeTimer();


    setInterval(
      loadCollectorStatus,
      15000
    );


  } catch (error) {
    console.error(
      "Startup failed:",
      error
    );


    setStatus(
      false,
      "STARTUP ERROR"
    );
  }
}


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
