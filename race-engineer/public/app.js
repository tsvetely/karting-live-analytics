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

function number(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function time(value) {
  const seconds =
    number(value);

  if (
    seconds === null ||
    seconds < 0
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
      (
        number(
          getter(row)
        ) || 0
      ),
    0
  );
}


// ============================================================
// SEARCHABLE DROPDOWNS
// ============================================================

const DROPDOWNS =
  new Map();

function normalizeSearch(
  value
) {
  return String(
    value ?? ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function dropdownValue(id) {
  return (
    $(id)?.dataset.value ??
    ""
  );
}

function dropdownInputId(
  dropdownId
) {
  if (
    dropdownId ===
    "raceDropdown"
  ) {
    return "raceDropdownSearch";
  }

  if (
    dropdownId ===
    "teamDropdown"
  ) {
    return "teamDropdownSearch";
  }

  if (
    dropdownId ===
    "driverDropdown"
  ) {
    return "driverDropdownSearch";
  }

  return null;
}

function dropdownDefaultLabel(
  dropdownId
) {
  if (
    dropdownId ===
    "raceDropdown"
  ) {
    return "Current race";
  }

  if (
    dropdownId ===
    "teamDropdown"
  ) {
    return "All teams";
  }

  if (
    dropdownId ===
    "driverDropdown"
  ) {
    return "All drivers";
  }

  return "";
}

function getDropdownInput(
  dropdownId
) {
  const id =
    dropdownInputId(
      dropdownId
    );

  return id
    ? $(id)
    : null;
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

  const input =
    getDropdownInput(
      dropdownId
    );

  if (!dropdown) {
    return;
  }

  const finalLabel =
    label ??
    dropdownDefaultLabel(
      dropdownId
    );

  dropdown.dataset.value =
    value ?? "";

  dropdown.dataset.label =
    finalLabel;

  if (labelNode) {
    labelNode.textContent =
      finalLabel;
  }

  if (input) {
    input.value =
      finalLabel;
  }

  if (menu) {
    menu
      .querySelectorAll(
        ".dropdownOption[data-value]"
      )
      .forEach(option => {
        const selected =
          String(
            option.dataset.value ??
            ""
          ) ===
          String(
            value ??
            ""
          );

        option.classList.toggle(
          "selected",
          selected
        );
      });
  }
}

function visibleDropdownOptions(
  menu
) {
  return [
    ...menu.querySelectorAll(
      ".dropdownOption[data-value]"
    )
  ].filter(
    option =>
      !option.classList.contains(
        "searchHidden"
      )
  );
}

function clearKeyboardHighlight(
  menu
) {
  menu
    .querySelectorAll(
      ".dropdownOption.keyboardActive"
    )
    .forEach(
      option =>
        option.classList.remove(
          "keyboardActive"
        )
    );
}

function highlightDropdownOption(
  menu,
  option
) {
  clearKeyboardHighlight(
    menu
  );

  if (!option) {
    return;
  }

  option.classList.add(
    "keyboardActive"
  );

  option.scrollIntoView({
    block:
      "nearest"
  });
}

function optionSearchText(
  option
) {
  return normalizeSearch(
    option
      .querySelector(
        "span:nth-child(2)"
      )
      ?.textContent ||
    option.textContent
  );
}

function filterDropdownOptions(
  dropdownId,
  query
) {
  const state =
    DROPDOWNS.get(
      dropdownId
    );

  if (!state) {
    return;
  }

  const search =
    normalizeSearch(
      query
    );

  const options =
    [
      ...state.menu.querySelectorAll(
        ".dropdownOption[data-value]"
      )
    ];

  let visibleCount =
    0;

  for (
    const option
    of options
  ) {
    const matches =
      !search ||
      optionSearchText(
        option
      ).includes(
        search
      );

    option.classList.toggle(
      "searchHidden",
      !matches
    );

    if (matches) {
      visibleCount += 1;
    }
  }

  let noResults =
    state.menu.querySelector(
      ".dropdownNoResults"
    );

  if (
    visibleCount === 0
  ) {
    if (!noResults) {
      noResults =
        document.createElement(
          "div"
        );

      noResults.className =
        "dropdownNoResults";

      state.menu.appendChild(
        noResults
      );
    }

    if (
      dropdownId ===
      "teamDropdown"
    ) {
      noResults.textContent =
        "No matching teams";
    } else if (
      dropdownId ===
      "driverDropdown"
    ) {
      noResults.textContent =
        "No matching drivers";
    } else {
      noResults.textContent =
        "No matching races";
    }

  } else {
    noResults?.remove();
  }

  clearKeyboardHighlight(
    state.menu
  );

  if (search) {
    highlightDropdownOption(
      state.menu,
      visibleDropdownOptions(
        state.menu
      )[0]
    );
  }
}

function closeDropdown(
  dropdownId,
  restore = true
) {
  const state =
    DROPDOWNS.get(
      dropdownId
    );

  if (!state) {
    return;
  }

  state.dropdown.classList.remove(
    "open"
  );

  clearKeyboardHighlight(
    state.menu
  );

  filterDropdownOptions(
    dropdownId,
    ""
  );

  if (restore) {
    state.input.value =
      state.dropdown.dataset.label ||
      dropdownDefaultLabel(
        dropdownId
      );
  }
}

function closeAllDropdowns(
  except = null
) {
  for (
    const [
      id,
      state
    ]
    of DROPDOWNS
  ) {
    if (
      state.dropdown !== except &&
      state.dropdown.classList.contains(
        "open"
      )
    ) {
      closeDropdown(id);
    }
  }
}

function openDropdown(
  dropdownId,
  selectText = true
) {
  const state =
    DROPDOWNS.get(
      dropdownId
    );

  if (!state) {
    return;
  }

  closeAllDropdowns(
    state.dropdown
  );

  state.dropdown.classList.add(
    "open"
  );

  filterDropdownOptions(
    dropdownId,
    ""
  );

  state.input.value =
    state.dropdown.dataset.label ||
    dropdownDefaultLabel(
      dropdownId
    );

  state.input.focus({
    preventScroll:
      true
  });

  if (selectText) {
    state.input.select();
  }
}

function moveDropdownSelection(
  dropdownId,
  direction
) {
  const state =
    DROPDOWNS.get(
      dropdownId
    );

  if (!state) {
    return;
  }

  const options =
    visibleDropdownOptions(
      state.menu
    );

  if (!options.length) {
    return;
  }

  let index =
    options.findIndex(
      option =>
        option.classList.contains(
          "keyboardActive"
        )
    );

  if (index < 0) {
    index =
      direction > 0
        ? -1
        : 0;
  }

  index =
    (
      index +
      direction +
      options.length
    ) %
    options.length;

  highlightDropdownOption(
    state.menu,
    options[index]
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

  const input =
    getDropdownInput(
      dropdownId
    );

  if (
    !dropdown ||
    !trigger ||
    !menu ||
    !input
  ) {
    return;
  }

  const state = {
    dropdown,
    trigger,
    menu,
    input,

    async select(option) {
      if (!option) {
        return;
      }

      const value =
        option.dataset.value ??
        "";

      const label =
        option
          .querySelector(
            "span:nth-child(2)"
          )
          ?.textContent
          ?.trim() ||
        option.textContent
          ?.trim() ||
        dropdownDefaultLabel(
          dropdownId
        );

      closeDropdown(
        dropdownId,
        false
      );

      await onChange(
        value,
        option,
        label
      );

      input.value =
        dropdown.dataset.label ||
        label;
    }
  };

  DROPDOWNS.set(
    dropdownId,
    state
  );

  trigger.addEventListener(
    "click",
    event => {
      event.stopPropagation();

      if (
        event.target === input &&
        dropdown.classList.contains(
          "open"
        )
      ) {
        return;
      }

      if (
        dropdown.classList.contains(
          "open"
        )
      ) {
        closeDropdown(
          dropdownId
        );
      } else {
        openDropdown(
          dropdownId,
          true
        );
      }
    }
  );

  input.addEventListener(
    "focus",
    event => {
      event.stopPropagation();

      if (
        !dropdown.classList.contains(
          "open"
        )
      ) {
        openDropdown(
          dropdownId,
          true
        );
      }
    }
  );

  input.addEventListener(
    "click",
    event => {
      event.stopPropagation();

      if (
        !dropdown.classList.contains(
          "open"
        )
      ) {
        openDropdown(
          dropdownId,
          false
        );
      }
    }
  );

  input.addEventListener(
    "input",
    event => {
      event.stopPropagation();

      if (
        !dropdown.classList.contains(
          "open"
        )
      ) {
        closeAllDropdowns(
          dropdown
        );

        dropdown.classList.add(
          "open"
        );
      }

      filterDropdownOptions(
        dropdownId,
        input.value
      );
    }
  );

  input.addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
        "ArrowDown"
      ) {
        event.preventDefault();

        moveDropdownSelection(
          dropdownId,
          1
        );

        return;
      }

      if (
        event.key ===
        "ArrowUp"
      ) {
        event.preventDefault();

        moveDropdownSelection(
          dropdownId,
          -1
        );

        return;
      }

      if (
        event.key ===
        "Enter"
      ) {
        const option =
          menu.querySelector(
            ".dropdownOption.keyboardActive:not(.searchHidden)"
          ) ||
          visibleDropdownOptions(
            menu
          )[0];

        if (option) {
          event.preventDefault();

          state.select(
            option
          );
        }

        return;
      }

      if (
        event.key ===
        "Escape"
      ) {
        event.preventDefault();

        closeDropdown(
          dropdownId
        );

        input.blur();

        return;
      }

      if (
        event.key ===
        "Tab"
      ) {
        closeDropdown(
          dropdownId
        );
      }
    }
  );

  menu.addEventListener(
    "mousedown",
    event => {
      event.preventDefault();
    }
  );

  menu.addEventListener(
    "click",
    event => {
      const option =
        event.target.closest(
          ".dropdownOption[data-value]"
        );

      if (!option) {
        return;
      }

      event.stopPropagation();

      state.select(
        option
      );
    }
  );

  menu.addEventListener(
    "mousemove",
    event => {
      const option =
        event.target.closest(
          ".dropdownOption[data-value]:not(.searchHidden)"
        );

      if (option) {
        highlightDropdownOption(
          menu,
          option
        );
      }
    }
  );
}

document.addEventListener(
  "click",
  () =>
    closeAllDropdowns()
);


// ============================================================
// API / RACE CONTEXT
// ============================================================

function isLiveRace() {
  return (
    S.source ===
    "live"
  );
}

function selectedRaceId() {
  if (isLiveRace()) {
    return (
      S.liveMeta?.active ===
      true
        ? (
            S.liveMeta.race_id ??
            null
          )
        : null
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

  if (options.query) {
    for (
      const [
        key,
        value
      ]
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
          options.method ||
          "GET",

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
    throw new Error(
      await response.text()
    );
  }

  return response.json();
}

function setStatus(
  ok,
  message,
  detail = null
) {
  if ($("status")) {
    $("status").textContent =
      message;
  }

  if ($("liveDot")) {
    $("liveDot").className =
      `dot ${ok ? "ok" : "bad"}`;
  }

  if (
    detail !== null &&
    $("updated")
  ) {
    $("updated").textContent =
      detail;
  }
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

    autoControl?.classList.remove(
      "hidden"
    );

    $("overviewTitle").textContent =
      "Current race overview";

    $("overviewSubtitle").textContent =
      "Race order, current driver, current stint and live performance.";

    return;
  }

  badge.className =
    "raceModeBadge history";

  badge.textContent =
    "HISTORY";

  autoControl?.classList.add(
    "hidden"
  );

  $("overviewTitle").textContent =
    $("raceDropdownLabel")
      ?.textContent ||
    `Race ${S.raceId}`;

  $("overviewSubtitle").textContent =
    "Stored race overview and statistics.";
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

function rowsForCurrentView() {
  return (
    S[S.activeView] ||
    []
  );
}


// ============================================================
// FILTERS
// ============================================================

function filterRows(rows) {
  const search =
    normalizeSearch(
      $("search")?.value
    );

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
      normalizeSearch(
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
              value !== null &&
              value !== undefined
          )
          .join(" ")
      );

    return (
      (
        !selectedTeam ||
        team === selectedTeam
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

  $("teamDropdownMenu").innerHTML =
    `
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

  $("driverDropdownMenu").innerHTML =
    `
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
      previousTeam
    )
      ? previousTeam
      : "",
    teams.includes(
      previousTeam
    )
      ? previousTeam
      : "All teams"
  );

  setDropdownValue(
    "driverDropdown",
    "driverDropdownLabel",
    "driverDropdownMenu",
    drivers.includes(
      previousDriver
    )
      ? previousDriver
      : "",
    drivers.includes(
      previousDriver
    )
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
    $("search").value =
      "";
  }

  if (render) {
    renderActiveView();
  }
}


// ============================================================
// RACE LIST
// ============================================================

function raceIdOf(race) {
  return (
    race?.id ??
    race?.race_id ??
    null
  );
}

function raceLabelOf(race) {
  return (
    race?.label ||
    race?.name ||
    race?.session_name ||
    race?.title ||
    (
      raceIdOf(race) !== null
        ? `Race ${raceIdOf(race)}`
        : "Selected race"
    )
  );
}

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

    const races =
      (
        data.rows ||
        []
      ).filter(
        race =>
          raceIdOf(race) !==
          null
      );

    menu.innerHTML =
      `
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

${races
  .map(
    race => `
<button
  type="button"
  class="dropdownOption"
  data-value="race:${esc(
    raceIdOf(race)
  )}"
>
  <span class="dropdownStatusDot history"></span>
  <span>${esc(
    raceLabelOf(race)
  )}</span>
  <span class="dropdownCheck">✓</span>
</button>
`
  )
  .join("")}
`
      );
    }

    const selected =
      races.find(
        race =>
          String(
            raceIdOf(race)
          ) ===
          String(
            S.raceId
          )
      );

    setDropdownValue(
      "raceDropdown",
      "raceDropdownLabel",
      "raceDropdownMenu",
      isLiveRace()
        ? "live"
        : `race:${S.raceId}`,
      isLiveRace()
        ? "Current race"
        : raceLabelOf(
            selected
          )
    );

    return races;

  } catch (error) {
    console.warn(
      "Historical race list unavailable",
      error
    );

    menu.innerHTML =
      `
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
// SORT
// ============================================================

function sortByPosition(rows) {
  return rows
    .slice()
    .sort(
      (a, b) => {
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

        return (
          (
            number(
              pick(
                b,
                "race_lap",
                "live_lap_count",
                "lap_count"
              )
            ) || 0
          ) -
          (
            number(
              pick(
                a,
                "race_lap",
                "live_lap_count",
                "lap_count"
              )
            ) || 0
          )
        );
      }
    );
}


// ============================================================
// OVERVIEW
// ============================================================

function renderOverview() {
  const rows =
    sortByPosition(
      filterRows(
        S.overview
      )
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
      pick(
        row,
        "race_lap",
        "live_lap_count",
        "lap_count"
      ) ??
      "—"
    )}
  </td>

  <td>
    ${esc(
      row.pit_count ??
      "—"
    )}
  </td>

  <td>
    ${
      row.stint_number !==
      null &&
      row.stint_number !==
      undefined
        ? `#${esc(
            row.stint_number
          )}`
        : "—"
    }
  </td>

  <td>
    ${esc(
      pick(
        row,
        "stint_laps",
        "total_stint_laps",
        "valid_laps"
      ) ??
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
      row.consistency
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
  <td colspan="15">
    ${
      isLiveRace()
        ? (
            S.liveMeta?.active ===
            false
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
      .sort(
        (a, b) => {
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

          const teamCompare =
            String(
              a.team_name ||
              ""
            ).localeCompare(
              String(
                b.team_name ||
                ""
              )
            );

          if (teamCompare) {
            return teamCompare;
          }

          return (
            (
              number(
                a.stint_number
              ) || 0
            ) -
            (
              number(
                b.stint_number
              ) || 0
            )
          );
        }
      );

  $("stintsBody").innerHTML =
    rows
      .map(
        row => {
          const isLive =
            row.is_live ===
              true ||
            row.end_lap_count ===
              null;

          return `
<tr
  class="clickableRow"
  data-detail-type="team"
  data-team="${esc(
    row.team_name ||
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
      "—"
    )}
  </td>

  <td>
    ${
      row.stint_number !==
      null &&
      row.stint_number !==
      undefined
        ? `#${esc(
            row.stint_number
          )}`
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
      row.total_laps ??
      row.total_stint_laps ??
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

  <td>
    ${
      isLive
        ? '<span class="liveText">LIVE</span>'
        : "COMPLETED"
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
  data-team="${esc(
    row.team_name ||
    ""
  )}"
  data-driver="${esc(
    row.driver_name ||
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
      "—"
    )}
  </td>

  <td>
    ${esc(
      row.stint_count ??
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
  <td colspan="11">
    No driver data for the selected race.
  </td>
</tr>
`;
}


// ============================================================
// TEAMS
// ============================================================

function renderTeams() {
  const rows =
    sortByPosition(
      filterRows(
        S.teams
      )
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
      row.driver_count ??
      "—"
    )}
  </td>

  <td>
    ${esc(
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
`
      )
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
    );

  $("pitsBody").innerHTML =
    rows
      .map(
        row => `
<tr>
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
      row.pit_number ??
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

  $("eventsBody").innerHTML =
    rows
      .map(
        row => `
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
  data-apex-id="${esc(
    row.apex_id
  )}"
  data-lap-number="${esc(
    row.lap_number
  )}"
>
  Remove
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
  <td colspan="7">
    No race events.
  </td>
</tr>
`;

  $("eventsBody")
    .querySelectorAll(
      ".eventDelete"
    )
    .forEach(button => {
      button.onclick =
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

          } catch (error) {
            showLoadError(
              error
            );
          }
        };
    });
}

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
// LOADERS
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
            raceId:
              null
          }
        );

      S.liveMeta =
        data;

      S.overview =
        data.active === true
          ? (
              data.current ||
              data.rows ||
              []
            )
          : [];

      $("sessionStatus").textContent =
        data.active === true
          ? "LIVE"
          : "FINISHED";

      $("sessionName").textContent =
        data.session_name ||
        data.session ||
        "Apex Timing";

      $("headerTeamCount").textContent =
        S.overview.length;

      setStatus(
        true,
        data.active === true
          ? "LIVE"
          : "NO LIVE SESSION",
        data.active === true
          ? `Updated ${new Date().toLocaleTimeString()}`
          : "Live timing has finished"
      );

    } else {
      const data =
        await api(
          "/api/overview"
        );

      S.overview =
        data.rows ||
        [];

      $("sessionStatus").textContent =
        "FINISHED";

      $("sessionName").textContent =
        $("raceDropdownLabel")
          ?.textContent ||
        "Selected race";

      $("headerTeamCount").textContent =
        S.overview.length;

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
    showLoadError(
      error
    );
  }
}

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
    S.stints =
      (
        await api(
          "/api/stints"
        )
      ).rows ||
      [];

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
    S.drivers =
      (
        await api(
          "/api/drivers"
        )
      ).rows ||
      [];

    S.loaded.drivers =
      true;

    rebuildFilters();
    renderDrivers();

  } catch (error) {
    showLoadError(
      error
    );
  }
}

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
    S.teams =
      (
        await api(
          "/api/teams"
        )
      ).rows ||
      [];

    S.loaded.teams =
      true;

    rebuildFilters();
    renderTeams();

  } catch (error) {
    showLoadError(
      error
    );
  }
}

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
    S.pits =
      (
        await api(
          "/api/pits"
        )
      ).rows ||
      [];

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
    S.events =
      (
        await api(
          "/api/events"
        )
      ).rows ||
      [];

    S.loaded.events =
      true;

    rebuildFilters();
    renderEvents();

  } catch (error) {
    S.events =
      [];

    S.loaded.events =
      true;

    console.warn(
      error
    );

    renderEvents();
  }
}

async function loadActiveView(
  force = false
) {
  switch (S.activeView) {
    case "overview":
      return loadOverview(
        force
      );

    case "stints":
      return loadStints(
        force
      );

    case "drivers":
      return loadDrivers(
        force
      );

    case "teams":
      return loadTeams(
        force
      );

    case "pits":
      return loadPits(
        force
      );

    case "events":
      return loadEvents(
        force
      );
  }
}

function showLoadError(error) {
  console.error(
    error
  );

  setStatus(
    false,
    "ERROR",
    error?.message ||
    String(error)
  );
}


// ============================================================
// DROPDOWN CALLBACKS
// ============================================================

initDropdown(
  "raceDropdown",
  "raceDropdownTrigger",
  "raceDropdownMenu",
  async (
    value,
    option,
    label
  ) => {

    if (
      value ===
      "live"
    ) {
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
        value.slice(5);

      S.liveMeta =
        null;

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

    resetFilters(
      false
    );

    updateRaceContext();

    await loadActiveView(
      true
    );
  }
);

initDropdown(
  "teamDropdown",
  "teamDropdownTrigger",
  "teamDropdownMenu",
  async (
    value,
    option,
    label
  ) => {

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
    option,
    label
  ) => {

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
// UI
// ============================================================

$("search")
  ?.addEventListener(
    "input",
    renderActiveView
  );

$("resetFilters")
  ?.addEventListener(
    "click",
    () =>
      resetFilters(
        true
      )
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

        S.activeView =
          button.dataset.view;

        $(S.activeView)
          ?.classList.add(
            "active"
          );

        resetFilters(
          false
        );

        if (
          S.activeView !==
          "reports"
        ) {
          await loadActiveView(
            false
          );
        }
      }
    );
  });


// ============================================================
// MANUAL EXCLUSIONS
// ============================================================

$("addManualExclusion")
  ?.addEventListener(
    "click",
    async () => {
      try {
        if (
          !S.overview.length
        ) {
          await loadOverview(
            true
          );
        }

        const team =
          prompt(
            "Team name exactly as shown:"
          );

        if (!team) {
          return;
        }

        const row =
          S.overview.find(
            item =>
              String(
                item.team_name ||
                ""
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

        const lap =
          Number(
            prompt(
              `Lap to exclude for ${row.team_name}:`
            )
          );

        if (
          !Number.isFinite(
            lap
          ) ||
          lap <= 0
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
                  lap
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

        if (
          S.activeView ===
          "events"
        ) {
          await loadEvents(
            true
          );
        }

      } catch (error) {
        showLoadError(
          error
        );
      }
    }
  );


// ============================================================
// CSV / PDF
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

  return (
    /[",\n]/.test(
      string
    )
      ? `"${string.replace(
          /"/g,
          '""'
        )}"`
      : string
  );
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
        .map(
          csvValue
        )
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

async function reportRows() {
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

  return [
    ...(teams.rows || [])
      .map(
        row => ({
          dataset:
            "teams",
          ...row
        })
      ),

    ...(drivers.rows || [])
      .map(
        row => ({
          dataset:
            "drivers",
          ...row
        })
      ),

    ...(stints.rows || [])
      .map(
        row => ({
          dataset:
            "stints",
          ...row
        })
      ),

    ...(pits.rows || [])
      .map(
        row => ({
          dataset:
            "pits",
          ...row
        })
      ),

    ...(events.rows || [])
      .map(
        row => ({
          dataset:
            "events",
          ...row
        })
      )
  ];
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

  win.document.write(`
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
body{
  font-family:Arial,sans-serif;
  margin:18px;
  color:#111;
}
h1{
  font-size:20px;
}
table{
  width:100%;
  border-collapse:collapse;
  font-size:8px;
}
th,td{
  border:1px solid #aaa;
  padding:4px;
  text-align:left;
}
th{
  background:#eee;
}
@page{
  size:landscape;
  margin:8mm;
}
</style>
</head>
<body>
<h1>${esc(title)}</h1>
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
      `<td>${esc(
        row[column] ??
        ""
      )}</td>`
  )
  .join("")}
</tr>
`
  )
  .join("")}
</tbody>
</table>
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

$("downloadRaceCsv")
  ?.addEventListener(
    "click",
    async () => {
      try {
        downloadCsv(
          `${
            isLiveRace()
              ? "current-race"
              : `race-${S.raceId}`
          }-analytics.csv`,
          await reportRows()
        );
      } catch (error) {
        showLoadError(
          error
        );
      }
    }
  );

$("downloadRacePdf")
  ?.addEventListener(
    "click",
    async () => {
      try {
        printPdf(
          `${
            $("raceDropdownLabel")
              ?.textContent ||
            "Race"
          } Analytics`,
          await reportRows()
        );
      } catch (error) {
        showLoadError(
          error
        );
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
    !$("detailDrawer")
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

    const driver =
      row.dataset.driver ||
      "";

    const rows =
      S.stints.filter(
        stint =>
          String(
            stint.team_name ||
            ""
          ) ===
          team &&
          (
            !driver ||
            String(
              stint.driver_name ||
              ""
            ) ===
            driver
          )
      );

    openDrawer(
      driver ||
      team,
      `
<p class="drawerSubtitle">
  ${
    driver
      ? esc(team)
      : ""
  }
</p>

<div class="drawerMetricGrid">

  <div class="drawerMetric">
    <span>Stints</span>
    <strong>${rows.length}</strong>
  </div>

  <div class="drawerMetric">
    <span>Valid laps</span>
    <strong>${sum(
      rows,
      item =>
        item.valid_laps
    )}</strong>
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
      event.key ===
      "Escape"
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
        console.error(
          error
        );
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
// INIT
// ============================================================

async function initialize() {
  updateRaceContext();

  const races =
    await loadRaceList();

  await loadOverview(
    true
  );

  if (
    isLiveRace() &&
    S.liveMeta?.active !==
      true &&
    races.length
  ) {
    const latest =
      races[0];

    const id =
      raceIdOf(
        latest
      );

    if (
      id !== null
    ) {
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
        raceLabelOf(
          latest
        )
      );

      $("raceDropdownStatusDot").className =
        "dropdownStatusDot history";

      clearRaceData();

      resetFilters(
        false
      );

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
