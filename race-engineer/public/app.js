const S = {
  source: "live",
  raceId: null,
  activeView: "overview",

  liveMeta: null,
  races: [],

  overview: [],
  stints: [],
  drivers: [],
  teams: [],
  pits: [],

  loaded: {
    overview: false,
    stints: false,
    drivers: false,
    teams: false,
    pits: false
  },

  timer: null
};

const $ = id =>
  document.getElementById(id);

const esc = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c])
  );

function num(value) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function fmtTime(value) {
  const seconds =
    num(value);

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
  for (const key of keys) {
    if (
      object &&
      object[key] !==
        undefined &&
      object[key] !==
        null &&
      object[key] !==
        ""
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
      (
        num(
          getter(row)
        ) || 0
      ),
    0
  );
}

function average(values) {
  const clean =
    values
      .map(num)
      .filter(
        value =>
          value !== null &&
          value > 0
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

function isLiveRace() {
  return (
    S.source === "live"
  );
}

function selectedRaceId() {
  if (isLiveRace()) {
    return (
      S.liveMeta?.race_id ??
      null
    );
  }

  return S.raceId;
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
    options.raceId !==
    undefined
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
        cache:
          "no-store"
      }
    );

  if (!response.ok) {
    throw new Error(
      await response.text()
    );
  }

  return response.json();
}

function setStatus(
  ok,
  message,
  detail = ""
) {
  $("status").textContent =
    message;

  $("liveDot").className =
    `dot ${ok ? "ok" : "bad"}`;

  $("updated").textContent =
    detail;
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

  if (!dropdown) {
    return;
  }

  dropdown.dataset.value =
    value ?? "";

  if ($(labelId)) {
    $(labelId).textContent =
      label ?? "";
  }

  const menu =
    $(menuId);

  if (menu) {
    menu
      .querySelectorAll(
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

      const shouldOpen =
        !dropdown
          .classList
          .contains(
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
// RACE CONTEXT
// ============================================================

function clearRaceData() {
  S.overview = [];
  S.stints = [];
  S.drivers = [];
  S.teams = [];
  S.pits = [];

  Object
    .keys(
      S.loaded
    )
    .forEach(
      key =>
        S.loaded[key] =
          false
    );
}

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

    $("raceDropdownStatusDot")
      .className =
      "dropdownStatusDot live";

    autoControl
      .classList
      .remove(
        "hidden"
      );

    $("overviewTitle")
      .textContent =
      "Current race overview";

    $("overviewSubtitle")
      .textContent =
      "Live race order, current driver, current stint and performance.";

    return;
  }

  badge.className =
    "raceModeBadge history";

  badge.textContent =
    "HISTORY";

  $("raceDropdownStatusDot")
    .className =
    "dropdownStatusDot history";

  autoControl
    .classList
    .add(
      "hidden"
    );

  $("overviewTitle")
    .textContent =
    $("raceDropdownLabel")
      .textContent ||
    `Race ${S.raceId}`;

  $("overviewSubtitle")
    .textContent =
    "Stored race data and analytics.";
}


// ============================================================
// HISTORY LIST
// ============================================================

async function loadRaceList() {
  const menu =
    $("raceDropdownMenu");

  try {
    const data =
      await api(
        "/api/races",
        {
          raceId:
            null
        }
      );

    S.races =
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

    if (S.races.length) {
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
        S.races
          .map(
            race => {
              const id =
                race.id ??
                race.race_id;

              const label =
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
    } else {
      menu.insertAdjacentHTML(
        "beforeend",
        `
<div class="dropdownDivider"></div>
<div class="dropdownGroupLabel">
  HISTORY
</div>
<div class="dropdownGroupLabel">
  No stored races found
</div>
`
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
            $("raceDropdownLabel")
              .textContent ||
            `Race ${S.raceId}`
          )
    );

  } catch (error) {
    console.error(error);

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
  HISTORY UNAVAILABLE
</div>
`;
  }
}


// ============================================================
// FILTERS
// ============================================================

function rowsForFilters() {
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

    default:
      return [];
  }
}

function rebuildFilters() {
  const rows =
    rowsForFilters();

  const oldTeam =
    dropdownValue(
      "teamDropdown"
    );

  const oldDriver =
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

  $("teamDropdownMenu")
    .innerHTML = `
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

  $("driverDropdownMenu")
    .innerHTML = `
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

  setDropdownValue(
    "teamDropdown",
    "teamDropdownLabel",
    "teamDropdownMenu",
    teams.includes(
      oldTeam
    )
      ? oldTeam
      : "",
    teams.includes(
      oldTeam
    )
      ? oldTeam
      : "All teams"
  );

  setDropdownValue(
    "driverDropdown",
    "driverDropdownLabel",
    "driverDropdownMenu",
    drivers.includes(
      oldDriver
    )
      ? oldDriver
      : "",
    drivers.includes(
      oldDriver
    )
      ? oldDriver
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

function filterRows(rows) {
  const selectedTeam =
    dropdownValue(
      "teamDropdown"
    );

  const selectedDriver =
    dropdownValue(
      "driverDropdown"
    );

  const search =
    $("search")
      .value
      .trim()
      .toLowerCase();

  return rows.filter(
    row => {
      const team =
        String(
          row.team_name ||
          ""
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
          row.live_lap_count,
          row.end_lap_count,
          row.pit_lap
        ]
          .filter(
            value =>
              value !== null &&
              value !== undefined
          )
          .join(" ")
          .toLowerCase();

      return (
        (
          !selectedTeam ||
          team ===
            selectedTeam
        ) &&
        (
          !selectedDriver ||
          driver ===
            selectedDriver
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
// STINT NUMBER
// ============================================================

function stintNumber(row) {
  const explicit =
    num(
      row.stint_number
    );

  if (
    explicit !== null &&
    explicit > 0
  ) {
    return explicit;
  }

  const apex =
    String(
      row.apex_id ??
      row.team_name ??
      ""
    );

  const stints =
    S.stints
      .filter(
        stint =>
          String(
            stint.apex_id ??
            stint.team_name ??
            ""
          ) === apex
      )
      .slice()
      .sort(
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

  const index =
    stints.findIndex(
      stint =>
        String(
          stint.start_lap_count
        ) ===
          String(
            row.start_lap_count
          ) &&
        String(
          stint.driver_name ||
          ""
        ) ===
          String(
            row.driver_name ||
            row.current_driver ||
            ""
          )
    );

  return index >= 0
    ? index + 1
    : "—";
}


// ============================================================
// OVERVIEW
// ============================================================

function sortOverview(rows) {
  return rows
    .slice()
    .sort(
      (a, b) => {
        if (isLiveRace()) {
          const positionA =
            num(
              a.position
            ) ??
            999999;

          const positionB =
            num(
              b.position
            ) ??
            999999;

          if (
            positionA !==
            positionB
          ) {
            return (
              positionA -
              positionB
            );
          }
        }

        const lapsA =
          num(
            pick(
              a,
              "live_lap_count",
              "end_lap_count",
              "current_lap_count",
              "lap_count"
            )
          ) || 0;

        const lapsB =
          num(
            pick(
              b,
              "live_lap_count",
              "end_lap_count",
              "current_lap_count",
              "lap_count"
            )
          ) || 0;

        if (
          lapsA !==
          lapsB
        ) {
          return (
            lapsB -
            lapsA
          );
        }

        return String(
          a.team_name ||
          ""
        ).localeCompare(
          String(
            b.team_name ||
            ""
          )
        );
      }
    );
}

function renderOverview() {
  const rows =
    sortOverview(
      filterRows(
        S.overview
      )
    );

  $("teamCount").textContent =
    rows.length;

  $("overviewBody").innerHTML =
    rows
      .map(
        row => {
          const stint =
            stintNumber(row);

          const pits =
            num(
              row.pit_count
            ) ??
            (
              num(stint) !==
              null
                ? Math.max(
                    0,
                    Number(stint) -
                    1
                  )
                : "—"
            );

          const raceLap =
            pick(
              row,
              "live_lap_count",
              "race_lap",
              "end_lap_count",
              "current_lap_count"
            );

          const stintLaps =
            pick(
              row,
              "lap_count",
              "valid_laps",
              "total_stint_laps",
              "total_laps"
            );

          return `
<tr
  class="clickableRow"
  data-detail-type="team"
  data-team="${esc(
    row.team_name ||
    ""
  )}"
  data-apex-id="${esc(
    row.apex_id ||
    ""
  )}"
>
  <td class="position">
    ${esc(
      row.position ??
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
      raceLap ??
      "—"
    )}
  </td>

  <td>
    ${esc(pits)}
  </td>

  <td>
    ${
      stint === "—"
        ? "—"
        : `#${esc(stint)}`
    }
  </td>

  <td>
    ${esc(
      stintLaps ??
      "—"
    )}
  </td>

  <td>
    ${fmtTime(
      pick(
        row,
        "live_last_lap",
        "last_lap"
      )
    )}
  </td>

  <td>
    ${fmtTime(
      pick(
        row,
        "avg_lap_time",
        "avg_lap"
      )
    )}
  </td>

  <td class="good">
    ${fmtTime(
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
    ${fmtTime(
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
    ${fmtTime(
      pick(
        row,
        "consistency",
        "consistency_time",
        "avg_consistency"
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
        }
      )
      .join("") ||
    `
<tr class="empty">
  <td colspan="15">
    ${
      isLiveRace()
        ? (
            S.liveMeta?.active === false
              ? "No active live timing session. Select the finished race from RACE / SESSION → HISTORY."
              : "No live race data."
          )
        : "No stored data for this race."
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
      .sort(
        (a, b) => {
          const teamA =
            String(
              a.team_name ||
              ""
            );

          const teamB =
            String(
              b.team_name ||
              ""
            );

          if (
            teamA !==
            teamB
          ) {
            return teamA
              .localeCompare(
                teamB
              );
          }

          return (
            (
              num(
                stintNumber(a)
              ) || 0
            ) -
            (
              num(
                stintNumber(b)
              ) || 0
            )
          );
        }
      );

  $("stintsBody").innerHTML =
    rows
      .map(
        row => `
<tr
  class="clickableRow"
  data-detail-type="team"
  data-team="${esc(
    row.team_name ||
    ""
  )}"
  data-apex-id="${esc(
    row.apex_id ||
    ""
  )}"
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
    ${
      row.end_lap_count === null ||
      row.end_lap_count === undefined
        ? (
            isLiveRace() &&
            row.is_live
              ? '<span class="liveTag">LIVE</span>'
              : esc(
                  row.current_lap_count ??
                  "—"
                )
          )
        : esc(
            row.end_lap_count
          )
    }
  </td>

  <td>
    ${esc(
      pick(
        row,
        "valid_laps",
        "lap_count",
        "total_laps"
      ) ??
      "—"
    )}
  </td>

  <td>
    ${fmtTime(
      pick(
        row,
        "avg_lap_time",
        "avg_lap"
      )
    )}
  </td>

  <td class="good">
    ${fmtTime(
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
    ${fmtTime(
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
    ${fmtTime(
      pick(
        row,
        "consistency",
        "avg_consistency"
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
// DRIVER FALLBACK
// ============================================================

function aggregateDriversFromStints(
  stints
) {
  const groups =
    new Map();

  for (const row of stints) {
    const driver =
      row.driver_name;

    if (!driver) {
      continue;
    }

    const key =
      `${
        row.team_name ||
        row.apex_id
      }|||${driver}`;

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

  return [
    ...groups.values()
  ].map(
    rows => {
      const validLaps =
        sum(
          rows,
          row =>
            pick(
              row,
              "valid_laps",
              "lap_count",
              "total_laps"
            )
        );

      const totalLaps =
        sum(
          rows,
          row =>
            pick(
              row,
              "total_laps",
              "lap_count",
              "valid_laps"
            )
        );

      let weighted =
        0;

      let weight =
        0;

      for (const row of rows) {
        const laps =
          num(
            pick(
              row,
              "valid_laps",
              "lap_count",
              "total_laps"
            )
          ) || 0;

        const avg =
          num(
            pick(
              row,
              "avg_lap_time",
              "avg_lap"
            )
          );

        if (
          laps &&
          avg
        ) {
          weighted +=
            laps * avg;

          weight +=
            laps;
        }
      }

      const bests =
        rows
          .map(
            row =>
              num(
                pick(
                  row,
                  "best_lap_time",
                  "best_lap"
                )
              )
          )
          .filter(
            value =>
              value &&
              value > 0
          );

      return {
        apex_id:
          rows[0]
            .apex_id,

        team_name:
          rows[0]
            .team_name,

        driver_name:
          rows[0]
            .driver_name,

        valid_stint_count:
          rows.length,

        valid_laps:
          validLaps,

        total_laps:
          totalLaps,

        avg_lap_time:
          weight
            ? weighted /
              weight
            : null,

        best_lap_time:
          bests.length
            ? Math.min(
                ...bests
              )
            : null,

        avg_consistency:
          average(
            rows.map(
              row =>
                pick(
                  row,
                  "consistency",
                  "avg_consistency"
                )
            )
          )
      };
    }
  );
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
      .sort(
        (a, b) =>
          (
            num(
              b.total_laps
            ) || 0
          ) -
          (
            num(
              a.total_laps
            ) || 0
          ) ||
          (
            num(
              a.avg_lap_time
            ) || 9999
          ) -
          (
            num(
              b.avg_lap_time
            ) || 9999
          )
      );

  $("driversBody").innerHTML =
    rows
      .map(
        row => `
<tr
  class="clickableRow"
  data-detail-type="driver"
  data-team="${esc(
    row.team_name ||
    ""
  )}"
  data-driver="${esc(
    row.driver_name ||
    ""
  )}"
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
      row.stint_count ??
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
    ${fmtTime(
      row.avg_lap_time
    )}
  </td>

  <td class="good">
    ${fmtTime(
      row.best_lap_time
    )}
  </td>

  <td>
    ${fmtTime(
      row.avg_consistency
    )}
  </td>
</tr>
`
      )
      .join("") ||
    `
<tr class="empty">
  <td colspan="8">
    No driver data for the selected race.
  </td>
</tr>
`;
}


// ============================================================
// TEAMS
// ============================================================

function buildTeams() {
  const groups =
    new Map();

  for (const driver of S.drivers) {
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
        (
          [
            team,
            drivers
          ]
        ) => {
          const validLaps =
            sum(
              drivers,
              driver =>
                driver.valid_laps
            );

          const totalLaps =
            sum(
              drivers,
              driver =>
                driver.total_laps
            );

          const stints =
            sum(
              drivers,
              driver =>
                (
                  driver.valid_stint_count ??
                  driver.stint_count
                )
            );

          let weighted =
            0;

          let weight =
            0;

          for (
            const driver
            of drivers
          ) {
            const laps =
              num(
                driver.valid_laps
              ) || 0;

            const avg =
              num(
                driver.avg_lap_time
              );

            if (
              laps &&
              avg
            ) {
              weighted +=
                laps * avg;

              weight +=
                laps;
            }
          }

          const bests =
            drivers
              .map(
                driver =>
                  num(
                    driver.best_lap_time
                  )
              )
              .filter(
                value =>
                  value &&
                  value > 0
              );

          const paces =
            drivers
              .map(
                driver =>
                  num(
                    driver.avg_lap_time
                  )
              )
              .filter(
                value =>
                  value &&
                  value > 0
              );

          return {
            team_name:
              team,

            apex_id:
              drivers[0]
                ?.apex_id,

            driver_count:
              drivers.length,

            valid_stint_count:
              stints,

            valid_laps:
              validLaps,

            total_laps:
              totalLaps,

            avg_lap_time:
              weight
                ? weighted /
                  weight
                : null,

            best_lap_time:
              bests.length
                ? Math.min(
                    ...bests
                  )
                : null,

            avg_consistency:
              average(
                drivers.map(
                  driver =>
                    driver.avg_consistency
                )
              ),

            driver_spread:
              paces.length > 1
                ? (
                    Math.max(
                      ...paces
                    ) -
                    Math.min(
                      ...paces
                    )
                  )
                : 0
          };
        }
      )
      .sort(
        (a, b) =>
          (
            num(
              b.total_laps
            ) || 0
          ) -
          (
            num(
              a.total_laps
            ) || 0
          ) ||
          (
            num(
              a.best_lap_time
            ) || 9999
          ) -
          (
            num(
              b.best_lap_time
            ) || 9999
          )
      );
}

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
  data-team="${esc(
    row.team_name ||
    ""
  )}"
  data-apex-id="${esc(
    row.apex_id ||
    ""
  )}"
>
  <td class="team">
    ${esc(row.team_name)}
  </td>

  <td>
    ${esc(row.driver_count)}
  </td>

  <td>
    ${esc(
      row.valid_stint_count
    )}
  </td>

  <td>
    ${esc(row.valid_laps)}
  </td>

  <td>
    ${esc(row.total_laps)}
  </td>

  <td>
    ${fmtTime(
      row.avg_lap_time
    )}
  </td>

  <td class="good">
    ${fmtTime(
      row.best_lap_time
    )}
  </td>

  <td>
    ${fmtTime(
      row.avg_consistency
    )}
  </td>

  <td>
    ${fmtTime(
      row.driver_spread
    )}
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
    )
      .slice()
      .sort(
        (a, b) =>
          String(
            a.team_name ||
            ""
          ).localeCompare(
            String(
              b.team_name ||
              ""
            )
          ) ||
          (
            num(
              a.pit_number
            ) || 0
          ) -
          (
            num(
              b.pit_number
            ) || 0
          )
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
      row.total_time ??
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
// VIEW RENDERING
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
  }
}


// ============================================================
// LOAD LIVE CONTEXT
// ============================================================

async function ensureLiveContext(
  force = false
) {
  if (!isLiveRace()) {
    return;
  }

  if (
    S.liveMeta &&
    !force
  ) {
    return;
  }

  S.liveMeta =
    await api(
      "/api/live",
      {
        raceId:
          null
      }
    );
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
      await ensureLiveContext(
        true
      );

      const data =
        S.liveMeta;

      S.overview =
        data.active === true
          ? (
              data.current ||
              []
            )
          : [];

      $("sessionName").textContent =
        data.session_name ||
        data.session ||
        "Apex Timing";

      $("sessionStatus").textContent =
        data.active === true
          ? "LIVE"
          : "NO LIVE SESSION";

      $("headerTeamCount")
        .textContent =
        S.overview.length;

      if (
        data.active === true
      ) {
        setStatus(
          true,
          "LIVE",
          `Updated ${
            new Date()
              .toLocaleTimeString()
          }`
        );
      } else {
        setStatus(
          true,
          "NO LIVE SESSION",
          "Select the finished race from HISTORY"
        );
      }

    } else {
      await loadStints(
        true
      );

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

        const score =
          num(
            row.end_lap_count
          ) ??
          num(
            row.current_lap_count
          ) ??
          num(
            row.start_lap_count
          ) ??
          0;

        const previous =
          latest.get(key);

        const previousScore =
          previous
            ? (
                num(
                  previous.end_lap_count
                ) ??
                num(
                  previous.current_lap_count
                ) ??
                num(
                  previous.start_lap_count
                ) ??
                0
              )
            : -1;

        if (
          !previous ||
          score >=
            previousScore
        ) {
          latest.set(
            key,
            row
          );
        }
      }

      S.overview =
        [...latest.values()]
          .map(
            row => ({
              ...row,

              position:
                null,

              live_lap_count:
                row.end_lap_count ??
                row.current_lap_count ??
                row.start_lap_count,

              live_last_lap:
                null
            })
          );

      $("sessionName").textContent =
        $("raceDropdownLabel")
          .textContent ||
        `Race ${S.raceId}`;

      $("sessionStatus").textContent =
        "FINISHED";

      $("headerTeamCount")
        .textContent =
        S.over
