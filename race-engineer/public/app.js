const S = {
  source: "live",
  raceId: null,
  currentRaceId: null,
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

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function time(value) {
  const seconds = number(value);

  if (seconds === null || seconds < 0) {
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
    (total, row) =>
      total + (number(getter(row)) || 0),
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

  return (
    clean.reduce((a, b) => a + b, 0) /
    clean.length
  );
}

function racePosition(row) {
  return number(
    pick(
      row,
      "position",
      "rank",
      "race_position"
    )
  );
}

function sortByRacePosition(rows) {
  return rows
    .slice()
    .sort((a, b) => {
      const pa = racePosition(a);
      const pb = racePosition(b);

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

      const lapsA =
        number(
          pick(
            a,
            "race_lap",
            "live_lap_count",
            "lap_count",
            "total_laps"
          )
        ) || 0;

      const lapsB =
        number(
          pick(
            b,
            "race_lap",
            "live_lap_count",
            "lap_count",
            "total_laps"
          )
        ) || 0;

      if (lapsA !== lapsB) {
        return lapsB - lapsA;
      }

      return String(
        a.team_name || ""
      ).localeCompare(
        String(
          b.team_name || ""
        )
      );
    });
}


// ============================================================
// CUSTOM DROPDOWNS
// ============================================================

function dropdownValue(id) {
  return $(id)?.dataset.value ?? "";
}

function setDropdownValue(
  dropdownId,
  labelId,
  menuId,
  value,
  label
) {
  const dropdown = $(dropdownId);
  const labelNode = $(labelId);
  const menu = $(menuId);

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
      .forEach(option => {
        const selected =
          String(
            option.dataset.value ?? ""
          ) ===
          String(value ?? "");

        option.classList.toggle(
          "selected",
          selected
        );
      });
  }
}

function closeAllDropdowns(
  except = null
) {
  document
    .querySelectorAll(
      ".dropdown.open"
    )
    .forEach(dropdown => {
      if (dropdown !== except) {
        dropdown.classList.remove(
          "open"
        );
      }
    });
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
  () => closeAllDropdowns()
);


// ============================================================
// RACE CONTEXT
// ============================================================

function isLiveRace() {
  return S.source === "live";
}

function selectedRaceId() {
  return isLiveRace()
    ? null
    : S.raceId;
}

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

  if (options.query) {
    for (
      const [key, value]
      of Object.entries(
        options.query
      )
    ) {
      if (
        value !== null &&
        value !== undefined &&
        value !== ""
      ) {
        url.searchParams.set(
          key,
          String(value)
        );
      }
    }
  }

  const response =
    await fetch(
      url,
      {
        method:
          options.method || "GET",

        cache:
          "no-store",

        headers:
          options.body
            ? {
                "content-type":
                  "application/json"
              }
            : undefined,

        body:
          options.body
            ? JSON.stringify(
                options.body
              )
            : undefined
      }
    );

  if (!response.ok) {
    let message;

    try {
      const data =
        await response.json();

      message =
        data.error ||
        JSON.stringify(data);
    } catch {
      message =
        await response.text();
    }

    throw new Error(
      message ||
      `HTTP ${response.status}`
    );
  }

  return response.json();
}

function setStatus(
  ok,
  message,
  detail = null
) {
  const status =
    $("status");

  const dot =
    $("liveDot");

  const updated =
    $("updated");

  if (status) {
    status.textContent =
      message;
  }

  if (dot) {
    dot.className =
      `dot ${ok ? "ok" : "bad"}`;
  }

  if (
    detail !== null &&
    updated
  ) {
    updated.textContent =
      detail;
  }
}

function updateRaceContext() {
  const badge =
    $("raceModeBadge");

  const autoControl =
    $("autoRefreshControl");

  if (isLiveRace()) {
    if (badge) {
      badge.className =
        "raceModeBadge live";

      badge.textContent =
        "LIVE";
    }

    autoControl?.classList.remove(
      "hidden"
    );

    if ($("overviewTitle")) {
      $("overviewTitle").textContent =
        "Current race overview";
    }

    if ($("overviewSubtitle")) {
      $("overviewSubtitle").textContent =
        "Race order, current driver, current stint and live performance.";
    }

    return;
  }

  if (badge) {
    badge.className =
      "raceModeBadge history";

    badge.textContent =
      "HISTORY";
  }

  autoControl?.classList.add(
    "hidden"
  );

  const raceName =
    $("raceDropdownLabel")
      ?.textContent ||
    "Selected race";

  if ($("overviewTitle")) {
    $("overviewTitle").textContent =
      raceName;
  }

  if ($("overviewSubtitle")) {
    $("overviewSubtitle").textContent =
      "Stored race overview and completed race analytics.";
  }
}


// ============================================================
// CURRENT VIEW / FILTERS
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

function filterRows(rows) {
  const search =
    $("search")
      ?.value
      ?.trim()
      ?.toLowerCase() || "";

  const selectedTeam =
    dropdownValue(
      "teamDropdown"
    );

  const selectedDriver =
    dropdownValue(
      "driverDropdown"
    );

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
        row.position,
        team,
        driver,
        row.apex_id,
        row.kart,
        row.kart_number,
        row.race_lap,
        row.lap_number,
        row.pit_number
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
    ].sort(
      (a, b) =>
        a.localeCompare(b)
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
    ].sort(
      (a, b) =>
        a.localeCompare(b)
    );

  const teamMenu =
    $("teamDropdownMenu");

  const driverMenu =
    $("driverDropdownMenu");

  if (teamMenu) {
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
  }

  if (driverMenu) {
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

function resetFilters(
  render = true
) {
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

  if ($("search")) {
    $("search").value = "";
  }

  if (render) {
    renderActiveView();
  }
}

function clearRaceData() {
  S.overview = [];
  S.stints = [];
  S.drivers = [];
  S.teams = [];
  S.pits = [];
  S.events = [];

  Object
    .keys(S.loaded)
    .forEach(
      key =>
        S.loaded[key] = false
    );
}


// ============================================================
// RACE LIST
// ============================================================

function raceIdOf(race) {
  return (
    race.id ??
    race.race_id ??
    null
  );
}

function raceLabelOf(race) {
  const id =
    raceIdOf(race);

  return (
    race.label ||
    race.name ||
    race.session_name ||
    race.title ||
    (
      race.date
        ? `Race — ${race.date}`
        : `Race ${id}`
    )
  );
}

async function loadRaceList() {
  const menu =
    $("raceDropdownMenu");

  if (!menu) {
    return [];
  }

  try {
    const data =
      await api(
        "/api/races",
        {
          raceId: null
        }
      );

    S.currentRaceId =
      data.current_race_id ??
      null;

    const races =
      (data.rows || [])
        .filter(
          race =>
            raceIdOf(race) !== null
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
          .map(race => {
            const id =
              raceIdOf(race);

            const label =
              raceLabelOf(race);

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
          })
          .join("")
      );
    }

    const selectedLabel =
      isLiveRace()
        ? "Current race"
        : (
            raceLabelOf(
              races.find(
                race =>
                  String(
                    raceIdOf(race)
                  ) ===
                  String(S.raceId)
              ) || {}
            ) ||
            "Selected race"
          );

    setDropdownValue(
      "raceDropdown",
      "raceDropdownLabel",
      "raceDropdownMenu",
      isLiveRace()
        ? "live"
        : `race:${S.raceId}`,
      selectedLabel
    );

    return races;

  } catch (error) {
    console.error(
      "Race list error:",
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
`;

    return [];
  }
}


// ============================================================
// STINT HELPERS
// ============================================================

function stintNumber(row) {
  const direct =
    pick(
      row,
      "stint_number",
      "stint_no",
      "stint_index"
    );

  if (direct !== null) {
    return number(direct) ?? direct;
  }

  const apexId =
    String(
      row.apex_id ?? ""
    );

  const startLap =
    number(
      row.start_lap_count
    );

  if (
    !apexId ||
    startLap === null
  ) {
    return null;
  }

  const stints =
    S.stints
      .filter(
        item =>
          String(
            item.apex_id ?? ""
          ) === apexId
      )
      .slice()
      .sort(
        (a, b) =>
          (
            number(
              a.start_lap_count
            ) || 0
          ) -
          (
            number(
              b.start_lap_count
            ) || 0
          )
      );

  const index =
    stints.findIndex(
      item =>
        number(
          item.start_lap_count
        ) === startLap
    );

  return index >= 0
    ? index + 1
    : null;
}

function currentStintLaps(row) {
  const direct =
    pick(
      row,
      "stint_laps",
      "total_stint_laps",
      "total_laps"
    );

  if (direct !== null) {
    return direct;
  }

  const raceLap =
    number(
      pick(
        row,
        "race_lap",
        "live_lap_count",
        "current_lap_count"
      )
    );

  const startLap =
    number(
      row.start_lap_count
    );

  if (
    raceLap !== null &&
    startLap !== null
  ) {
    return Math.max(
      0,
      raceLap - startLap
    );
  }

  return (
    row.valid_laps ??
    row.lap_count ??
    null
  );
}


// ============================================================
// OVERVIEW
// ============================================================

function renderOverview() {
  const rows =
    sortByRacePosition(
      filterRows(
        S.overview
      )
    );

  if ($("teamCount")) {
    $("teamCount").textContent =
      rows.length;
  }

  const body =
    $("overviewBody");

  if (!body) {
    return;
  }

  body.innerHTML =
    rows
      .map(row => {
        const stint =
          stintNumber(row);

        return `
<tr
  class="clickableRow"
  data-detail-type="team"
  data-team="${esc(row.team_name || "")}"
  data-apex-id="${esc(row.apex_id || "")}"
>

<td class="position">
  ${esc(
    racePosition(row) ??
    "—"
  )}
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
      "live_lap_count",
      "lap_count"
    ) ?? "—"
  )}
</td>

<td>
  ${esc(
    pick(
      row,
      "pit_count",
      "pits"
    ) ?? "—"
  )}
</td>

<td>
  ${
    stint !== null
      ? `#${esc(stint)}`
      : "—"
  }
</td>

<td>
  ${esc(
    currentStintLaps(row) ??
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
`;
      })
      .join("") ||
    `
<tr class="empty">
  <td colspan="15">
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
    )
      .slice()
      .sort((a, b) => {
        const pa =
          racePosition(a);

        const pb =
          racePosition(b);

        if (
          pa !== null &&
          pb !== null &&
          pa !== pb
        ) {
          return pa - pb;
        }

        const team =
          String(
            a.team_name || ""
          ).localeCompare(
            String(
              b.team_name || ""
            )
          );

        if (team) {
          return team;
        }

        return (
          (stintNumber(a) || 0) -
          (stintNumber(b) || 0)
        );
      });

  const body =
    $("stintsBody");

  if (!body) {
    return;
  }

  body.innerHTML =
    rows
      .map(row => {
        const stint =
          stintNumber(row);

        const isLive =
          row.is_live === true ||
          (
            isLiveRace() &&
            row.end_lap_count === null
          );

        return `
<tr
  class="clickableRow"
  data-detail-type="team"
  data-team="${esc(row.team_name || "")}"
  data-apex-id="${esc(row.apex_id || "")}"
>

<td class="position">
  ${esc(
    racePosition(row) ??
    "—"
  )}
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
    "—"
  )}
</td>

<td>
  ${
    stint !== null
      ? `#${esc(stint)}`
      : "—"
  }
</td>

<td>
  ${esc(
    row.start_lap_count ??
    "—"
  )}
</td>

<td>
  ${
    isLive
      ? '<span class="liveText">LIVE</span>'
      : esc(
          row.end_lap_count ??
          "—"
        )
  }
</td>

<td>
  ${esc(
    pick(
      row,
      "total_laps",
      "lap_count"
    ) ??
    (
      number(
        row.end_lap_count
      ) !== null &&
      number(
        row.start_lap_count
      ) !== null
        ? Math.max(
            0,
            number(
              row.end_lap_count
            ) -
            number(
              row.start_lap_count
            )
          )
        : "—"
    )
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

<td>
  ${
    isLive
      ? '<span class="liveText">LIVE</span>'
      : "COMPLETED"
  }
</td>

</tr>
`;
      })
      .join("") ||
    `
<tr class="empty">
  <td colspan="15">
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
    )
      .slice()
      .sort((a, b) => {
        const pa =
          racePosition(a);

        const pb =
          racePosition(b);

        if (
          pa !== null &&
          pb !== null &&
          pa !== pb
        ) {
          return pa - pb;
        }

        const team =
          String(
            a.team_name || ""
          ).localeCompare(
            String(
              b.team_name || ""
            )
          );

        if (team) {
          return team;
        }

        return String(
          a.driver_name || ""
        ).localeCompare(
          String(
            b.driver_name || ""
          )
        );
      });

  const body =
    $("driversBody");

  if (!body) {
    return;
  }

  body.innerHTML =
    rows
      .map(row => `
<tr
  class="clickableRow"
  data-detail-type="driver"
  data-team="${esc(row.team_name || "")}"
  data-driver="${esc(row.driver_name || "")}"
  data-apex-id="${esc(row.apex_id || "")}"
>

<td class="position">
  ${esc(
    racePosition(row) ??
    "—"
  )}
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
    "—"
  )}
</td>

<td>
  ${esc(
    pick(
      row,
      "stint_count",
      "total_stint_count"
    ) ?? "—"
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
    pick(
      row,
      "avg_consistency",
      "consistency"
    )
  )}
</td>

</tr>
`)
      .join("") ||
    `
<tr class="empty">
  <td colspan="11">
    No driver data for the selected race.
  </td>
</tr>
`;
}


// ============================================================
// TEAM AGGREGATION FALLBACK
// ============================================================

function buildTeamsFromDrivers() {
  const groups =
    new Map();

  for (
    const driver
    of S.drivers
  ) {
    const key =
      String(
        driver.apex_id ??
        driver.team_name ??
        ""
      );

    if (!key) {
      continue;
    }

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

  return [
    ...groups.values()
  ]
    .map(drivers => {
      const first =
        drivers[0];

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

      const stintCount =
        sum(
          drivers,
          row =>
            pick(
              row,
              "stint_count",
              "valid_stint_count"
            )
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

      const consistencyWeighted =
        drivers.reduce(
          (total, row) => {
            const laps =
              number(
                row.valid_laps
              ) || 0;

            const consistency =
              number(
                pick(
                  row,
                  "avg_consistency",
                  "consistency"
                )
              );

            if (
              !laps ||
              consistency === null
            ) {
              return total;
            }

            return (
              total +
              consistency * laps
            );
          },
          0
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

      return {
        race_id:
          first.race_id,

        apex_id:
          first.apex_id,

        position:
          first.position ??
          null,

        team_name:
          first.team_name,

        driver_count:
          drivers.length,

        stint_count:
          stintCount,

        valid_laps:
          validLaps,

        total_laps:
          totalLaps,

        avg_lap_time:
          avgLap,

        best_lap_time:
          bestValues.length
            ? Math.min(
                ...bestValues
              )
            : null,

        avg_consistency:
          validLaps
            ? consistencyWeighted /
              validLaps
            : null,

        driver_spread:
          driverAverages.length > 1
            ? (
                Math.max(
                  ...driverAverages
                ) -
                Math.min(
                  ...driverAverages
                )
              )
            : 0
      };
    });
}


// ============================================================
// TEAMS
// ============================================================

function renderTeams() {
  const rows =
    sortByRacePosition(
      filterRows(
        S.teams
      )
    );

  const body =
    $("teamsBody");

  if (!body) {
    return;
  }

  body.innerHTML =
    rows
      .map(row => `
<tr
  class="clickableRow"
  data-detail-type="team"
  data-team="${esc(row.team_name || "")}"
  data-apex-id="${esc(row.apex_id || "")}"
>

<td class="position">
  ${esc(
    racePosition(row) ??
    "—"
  )}
</td>

<td class="team">
  ${esc(
    row.team_name ||
    `APEX ${row.apex_id}`
  )}
</td>

<td>
  ${esc(
    row.driver_count ??
    "—"
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
    pick(
      row,
      "avg_consistency",
      "consistency"
    )
  )}
</td>

<td>
  ${time(
    row.driver_spread
  )}
</td>

</tr>
`)
      .join("") ||
    `
<tr class="empty">
  <td colspan="10">
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
    )
      .slice()
      .sort((a, b) => {
        const pa =
          racePosition(a);

        const pb =
          racePosition(b);

        if (
          pa !== null &&
          pb !== null &&
          pa !== pb
        ) {
          return pa - pb;
        }

        const team =
          String(
            a.team_name || ""
          ).localeCompare(
            String(
              b.team_name || ""
            )
          );

        if (team) {
          return team;
        }

        return (
          (
            number(
              a.pit_number
            ) || 0
          ) -
          (
            number(
              b.pit_number
            ) || 0
          )
        );
      });

  const body =
    $("pitsBody");

  if (!body) {
    return;
  }

  body.innerHTML =
    rows
      .map(row => `
<tr>

<td class="position">
  ${esc(
    racePosition(row) ??
    "—"
  )}
</td>

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
`)
      .join("") ||
    `
<tr class="empty">
  <td colspan="9">
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

  const body =
    $("eventsBody");

  if (!body) {
    return;
  }

  body.innerHTML =
    rows
      .map(row => `
<tr>

<td>
  ${
    row.time ||
    row.created_at ||
    row.updated_at
      ? esc(
          new Date(
            row.time ||
            row.created_at ||
            row.updated_at
          ).toLocaleString()
        )
      : "—"
  }
</td>

<td class="team">
  ${esc(
    row.team_name ||
    row.apex_id ||
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
  ${
    row.type ===
      "MANUAL EXCLUSION"
      ? `
<button
  type="button"
  class="secondary eventDelete"
  data-apex-id="${esc(row.apex_id)}"
  data-lap-number="${esc(row.lap_number)}"
>
  Remove
</button>
`
      : "—"
  }
</td>

</tr>
`)
      .join("") ||
    `
<tr class="empty">
  <td colspan="7">
    No race events.
  </td>
</tr>
`;

  body
    .querySelectorAll(
      ".eventDelete"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        async () => {
          try {
            await api(
              "/api/events",
              {
                method:
                  "DELETE",

                query: {
                  apex_id:
                    button.dataset.apexId,

                  lap_number:
                    button.dataset.lapNumber
                }
              }
            );

            S.loaded.events =
              false;

            await loadEvents(
              true
            );

            S.loaded.overview =
              false;

            S.loaded.stints =
              false;

          } catch (error) {
            showLoadError(error);
          }
        }
      );
    });
}


// ============================================================
// RENDER ACTIVE VIEW
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
// LOAD OVERVIEW
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
        data.race_id !== undefined &&
        data.race_id !== null
      ) {
        S.currentRaceId =
          data.race_id;
      }

      if (
        data.active === true
      ) {
        S.overview =
          data.current ||
          data.rows ||
          [];

        if ($("sessionStatus")) {
          $("sessionStatus")
            .textContent =
              "LIVE";
        }

        if ($("sessionName")) {
          $("sessionName")
            .textContent =
              data.session_name ||
              data.session ||
              "Apex Timing";
        }

        if ($("headerTeamCount")) {
          $("headerTeamCount")
            .textContent =
              S.overview.length;
        }

        setStatus(
          true,
          "LIVE",
          `Updated ${new Date().toLocaleTimeString()}`
        );

      } else {
        S.overview = [];

        if ($("headerTeamCount")) {
          $("headerTeamCount")
            .textContent =
              "0";
        }

        if ($("sessionStatus")) {
          $("sessionStatus")
            .textContent =
              "FINISHED";
        }

        if ($("sessionName")) {
          $("sessionName")
            .textContent =
              data.session_name ||
              data.session ||
              "Apex Timing";
        }

        setStatus(
          true,
          "NO LIVE SESSION",
          "Live timing has finished"
        );
      }

    } else {
      const data =
        await api(
          "/api/overview"
        );

      S.overview =
        data.rows ||
        data.current ||
        [];

      if ($("sessionName")) {
        $("sessionName")
          .textContent =
            $("raceDropdownLabel")
              ?.textContent ||
            "Selected race";
      }

      if ($("sessionStatus")) {
        $("sessionStatus")
          .textContent =
            "FINISHED";
      }

      if ($("headerTeamCount")) {
        $("headerTeamCount")
          .textContent =
            S.overview.length;
      }

      setStatus(
        true,
        "HISTORY",
        "Stored race data"
      );
    }

    S.loaded.overview =
      true;

    rebuildFilters();
    renderOverview();

  } catch (error) {
    showLoadError(error);
  }
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
    showLoadError(error);
  }
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

    rebuildFilters();
    renderDrivers();

  } catch (error) {
    showLoadError(error);
  }
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
    renderTeams();
    return;
  }

  try {
    const data =
      await api(
        "/api/teams"
      );

    S.teams =
      data.rows || [];

    if (
      !S.teams.length
    ) {
      if (!S.loaded.drivers) {
        const drivers =
          await api(
            "/api/drivers"
          );

        S.drivers =
          drivers.rows || [];

        S.loaded.drivers =
          true;
      }

      S.teams =
        buildTeamsFromDrivers();
    }

    S.loaded.teams =
      true;

    rebuildFilters();
    renderTeams();

  } catch (error) {
    showLoadError(error);
  }
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
    showLoadError(error);
  }
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
    renderEvents();
    return;
  }

  try {
    const data =
      await api(
        "/api/events"
      );

    S.events =
      data.rows || [];

    S.loaded.events =
      true;

    rebuildFilters();
    renderEvents();

  } catch (error) {
    S.events = [];
    S.loaded.events = true;

    console.warn(
      "Events unavailable:",
      error
    );

    renderEvents();
  }
}


// ============================================================
// ACTIVE VIEW LOAD
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
      await loadEvents(force);
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
    "ERROR",
    error?.message ||
    String(error)
  );
}


// ============================================================
// DROPDOWN EVENTS
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

      const dot =
        $("raceDropdownStatusDot");

      if (dot) {
        dot.className =
          "dropdownStatusDot live";
      }

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

      const dot =
        $("raceDropdownStatusDot");

      if (dot) {
        dot.className =
          "dropdownStatusDot history";
      }
    }

    setDropdownValue(
      "raceDropdown",
      "raceDropdownLabel",
      "raceDropdownMenu",
      value,
      label
    );

    clearRaceData();
    resetFilters(false);
    updateRaceContext();

    await loadActiveView(true);
  }
);

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
// FILTER / REFRESH EVENTS
// ============================================================

$("search")
  ?.addEventListener(
    "input",
    renderActiveView
  );

$("resetFilters")
  ?.addEventListener(
    "click",
    () => resetFilters(true)
  );

$("refresh")
  ?.addEventListener(
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
  .forEach(button => {
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
          ?.classList.add(
            "active"
          );

        S.activeView =
          view;

        resetFilters(false);

        if (
          view !== "reports"
        ) {
          await loadActiveView(
            false
          );
        }
      }
    );
  });


// ============================================================
// MANUAL EXCLUSION
// ============================================================

$("addManualExclusion")
  ?.addEventListener(
    "click",
    async () => {
      try {
        let sourceRows =
          S.overview;

        if (!sourceRows.length) {
          await loadOverview(true);
          sourceRows =
            S.overview;
        }

        const team =
          prompt(
            "Team name exactly as shown:"
          );

        if (!team) {
          return;
        }

        const row =
          sourceRows.find(
            item =>
              String(
                item.team_name || ""
              )
                .trim()
                .toLowerCase() ===
              team
                .trim()
                .toLowerCase()
          );

        if (!row) {
          alert(
            "Team not found."
          );

          return;
        }

        const lapNumber =
          Number(
            prompt(
              `Lap to exclude for ${row.team_name}:`
            )
          );

        if (
          !Number.isFinite(
            lapNumber
          ) ||
          lapNumber <= 0
        ) {
          alert(
            "Invalid lap number."
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
                row.apex_id,

              lap_number:
                Math.trunc(
                  lapNumber
                )
            }
          }
        );

        S.loaded.events =
          false;

        S.loaded.overview =
          false;

        S.loaded.stints =
          false;

        alert(
          `Lap ${Math.trunc(lapNumber)} excluded for ${row.team_name}.`
        );

        if (
          S.activeView ===
          "events"
        ) {
          await loadEvents(
            true
          );
        }

      } catch (error) {
        showLoadError(error);
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
    ].join("\n");

  const blob =
    new Blob(
      [
        "\uFEFF",
        csv
      ],
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

  document.body.appendChild(
    link
  );

  link.click();
  link.remove();

  URL.revokeObjectURL(
    url
  );
}


// ============================================================
// REPORTS
// ============================================================

async function ensureReportData() {
  const [
    stints,
    drivers,
    teams,
    pits,
    events
  ] =
    await Promise.all([
      api("/api/stints"),
      api("/api/drivers"),
      api("/api/teams"),
      api("/api/pits"),
      api("/api/events")
        .catch(
          () => ({
            rows: []
          })
        )
    ]);

  S.stints =
    stints.rows || [];

  S.drivers =
    drivers.rows || [];

  S.teams =
    teams.rows || [];

  if (!S.teams.length) {
    S.teams =
      buildTeamsFromDrivers();
  }

  S.pits =
    pits.rows || [];

  S.events =
    events.rows || [];

  S.loaded.stints = true;
  S.loaded.drivers = true;
  S.loaded.teams = true;
  S.loaded.pits = true;
  S.loaded.events = true;
}

function raceReportRows() {
  return [
    ...S.teams.map(
      row => ({
        dataset:
          "teams",
        ...row
      })
    ),

    ...S.drivers.map(
      row => ({
        dataset:
          "drivers",
        ...row
      })
    ),

    ...S.stints.map(
      row => ({
        dataset:
          "stints",
        ...row
      })
    ),

    ...S.pits.map(
      row => ({
        dataset:
          "pits",
        ...row
      })
    ),

    ...S.events.map(
      row => ({
        dataset:
          "events",
        ...row
      })
    )
  ];
}

function reportBaseName() {
  if (isLiveRace()) {
    return "current-race";
  }

  return `race-${S.raceId}`;
}

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

<title>${esc(title)}</title>

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

<h1>${esc(title)}</h1>

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

$("downloadRaceCsv")
  ?.addEventListener(
    "click",
    async () => {
      try {
        await ensureReportData();

        downloadCsv(
          `${reportBaseName()}-analytics.csv`,
          raceReportRows()
        );

      } catch (error) {
        showLoadError(error);
      }
    }
  );

$("downloadRacePdf")
  ?.addEventListener(
    "click",
    async () => {
      try {
        await ensureReportData();

        printPdf(
          isLiveRace()
            ? "Current Race Analytics"
            : `${$("raceDropdownLabel")?.textContent || "Race"} Analytics`,
          raceReportRows()
        );

      } catch (error) {
        showLoadError(error);
      }
    }
  );


// ============================================================
// DETAIL DRAWER
// ============================================================

function openDrawer(
  title,
  html
) {
  if (
    !$("detailDrawer") ||
    !$("detailTitle") ||
    !$("detailContent")
  ) {
    return;
  }

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
    ?.classList.remove(
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

      const driverRows =
        S.stints.filter(
          stint =>
            String(
              stint.team_name || ""
            ) === team &&
            String(
              stint.driver_name || ""
            ) === driver
        );

      openDrawer(
        driver,
        `
<p class="drawerSubtitle">
  ${esc(team)}
</p>

<div class="drawerMetricGrid">

  <div class="drawerMetric">
    <span>Stints</span>
    <strong>${esc(driverRows.length)}</strong>
  </div>

  <div class="drawerMetric">
    <span>Valid laps</span>
    <strong>${esc(sum(driverRows, row => row.valid_laps))}</strong>
  </div>

</div>
`
      );

      return;
    }

    const teamRows =
      S.stints.filter(
        stint =>
          String(
            stint.team_name || ""
          ) === team
      );

    openDrawer(
      team,
      `
<div class="drawerMetricGrid">

  <div class="drawerMetric">
    <span>Stints</span>
    <strong>${esc(teamRows.length)}</strong>
  </div>

  <div class="drawerMetric">
    <span>Valid laps</span>
    <strong>${esc(sum(teamRows, row => row.valid_laps))}</strong>
  </div>

</div>
`
    );
  }
);

$("closeDetail")
  ?.addEventListener(
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
        !$("auto")?.checked ||
        S.activeView ===
          "reports"
      ) {
        return;
      }

      try {
        S.loaded[
          S.activeView
        ] = false;

        if (
          S.activeView ===
          "overview"
        ) {
          S.liveMeta =
            null;
        }

        await loadActiveView(
          true
        );

      } catch (error) {
        console.error(error);
      }
    },
    2000
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


// ============================================================
// INITIALIZE
// ============================================================

async function initialize() {
  updateRaceContext();

  const races =
    await loadRaceList();

  await loadOverview(
    true
  );

  /*
   * If Apex is no longer live, automatically open the newest
   * stored race instead of leaving the user on an empty LIVE page.
   */
  if (
    isLiveRace() &&
    S.liveMeta?.active !== true &&
    races.length
  ) {
    const latest =
      races[0];

    const id =
      raceIdOf(latest);

    if (id !== null) {
      const label =
        raceLabelOf(latest);

      S.source =
        "history";

      S.raceId =
        String(id);

      S.liveMeta =
        null;

      setDropdownValue(
        "raceDropdown",
        "raceDropdownLabel",
        "raceDropdownMenu",
        `race:${id}`,
        label
      );

      const dot =
        $("raceDropdownStatusDot");

      if (dot) {
        dot.className =
          "dropdownStatusDot history";
      }

      clearRaceData();
      resetFilters(false);
      updateRaceContext();

      await loadOverview(
        true
      );
    }
  }
}

initialize()
  .catch(
    showLoadError
  );
