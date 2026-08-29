const S = {
  source: "live",
  raceId: null,
  currentRaceId: null,

  activeView:
    "overview",

  liveMeta:
    null,

  overview:
    [],

  stints:
    [],

  drivers:
    [],

  teams:
    [],

  pits:
    [],

  events:
    [],

  loaded: {
    overview:
      false,

    stints:
      false,

    drivers:
      false,

    teams:
      false,

    pits:
      false,

    events:
      false
  },

  timer:
    null
};


const $ =
  id =>
    document.getElementById(
      id
    );


const esc =
  value =>
    String(
      value ?? ""
    ).replace(
      /[&<>"']/g,
      char => ({
        "&":
          "&amp;",

        "<":
          "&lt;",

        ">":
          "&gt;",

        '"':
          "&quot;",

        "'":
          "&#39;"
      })[char]
    );


function num(value) {
  const parsed =
    Number(
      value
    );

  return Number.isFinite(
    parsed
  )
    ? parsed
    : null;
}


function fmtTime(value) {
  const seconds =
    num(
      value
    );

  if (
    seconds === null ||
    seconds <= 0
  ) {
    return "—";
  }


  if (
    seconds >= 60
  ) {
    const minutes =
      Math.floor(
        seconds /
        60
      );

    const rest =
      (
        seconds -
        minutes *
        60
      )
        .toFixed(3)
        .padStart(
          6,
          "0"
        );

    return (
      `${minutes}:` +
      rest
    );
  }


  return seconds
    .toFixed(3);
}


function fmtDateTime(value) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(
      value
    );

  return Number.isNaN(
    date.getTime()
  )
    ? String(
        value
      )
    : date
        .toLocaleString();
}


function isLiveRace() {
  return (
    S.source ===
    "live"
  );
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
      String(
        raceId
      )
    );
  }


  if (
    options.query
  ) {
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
          value
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
  detail = ""
) {
  $("status")
    .textContent =
      message;

  $("liveDot")
    .className =
      `dot ${ok ? "ok" : "bad"}`;

  $("updated")
    .textContent =
      detail;
}


function clearRaceData() {
  S.liveMeta =
    null;

  S.overview =
    [];

  S.stints =
    [];

  S.drivers =
    [];

  S.teams =
    [];

  S.pits =
    [];

  S.events =
    [];


  Object.keys(
    S.loaded
  ).forEach(
    key =>
      S.loaded[key] =
        false
  );
}


function updateRaceContext() {
  const badge =
    $("raceModeBadge");


  if (
    isLiveRace()
  ) {
    badge.className =
      "raceModeBadge live";

    badge.textContent =
      "LIVE";

    $("autoRefreshControl")
      .classList.remove(
        "hidden"
      );

    $("overviewTitle")
      .textContent =
        "Current race overview";

    $("overviewSubtitle")
      .textContent =
        "Live race order, current driver, current stint and live performance.";

  } else {

    badge.className =
      "raceModeBadge history";

    badge.textContent =
      "HISTORY";

    $("autoRefreshControl")
      .classList.add(
        "hidden"
      );


    const label =
      $("raceSelector")
        .selectedOptions[0]
        ?.textContent
        ?.trim() ||
      `Race ${S.raceId}`;


    $("overviewTitle")
      .textContent =
        label;

    $("overviewSubtitle")
      .textContent =
        "Stored race data and completed analytics.";
  }
}


function rowsForCurrentView() {
  return ({
    overview:
      S.overview,

    stints:
      S.stints,

    drivers:
      S.drivers,

    teams:
      S.teams,

    pits:
      S.pits,

    events:
      S.events
  })[
    S.activeView
  ] || [];
}


function filterRows(rows) {
  const search =
    $("search")
      .value
      .trim()
      .toLowerCase();

  const team =
    $("teamFilter")
      .value;

  const driver =
    $("driverFilter")
      .value;


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
        [
          row.position,
          rowTeam,
          rowDriver,
          row.apex_id,
          row.kart,
          row.kart_number,
          row.lap_number,
          row.pit_number
        ]
          .filter(
            value =>
              value !==
                null &&
              value !==
                undefined
          )
          .join(" ")
          .toLowerCase();


      return (
        (
          !team ||
          rowTeam ===
            team
        ) &&
        (
          !driver ||
          rowDriver ===
            driver
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


  const currentTeam =
    $("teamFilter")
      .value;

  const currentDriver =
    $("driverFilter")
      .value;


  const teams =
    [
      ...new Set(
        rows
          .map(
            row =>
              row.team_name
          )
          .filter(
            Boolean
          )
      )
    ]
      .sort(
        (a, b) =>
          a.localeCompare(
            b
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
          .filter(
            Boolean
          )
      )
    ]
      .sort(
        (a, b) =>
          a.localeCompare(
            b
          )
      );


  $("teamFilter")
    .innerHTML =
      '<option value="">All teams</option>' +
      teams
        .map(
          value =>
            `<option value="${esc(value)}">${esc(value)}</option>`
        )
        .join("");


  $("driverFilter")
    .innerHTML =
      '<option value="">All drivers</option>' +
      drivers
        .map(
          value =>
            `<option value="${esc(value)}">${esc(value)}</option>`
        )
        .join("");


  if (
    teams.includes(
      currentTeam
    )
  ) {
    $("teamFilter")
      .value =
        currentTeam;
  }


  if (
    drivers.includes(
      currentDriver
    )
  ) {
    $("driverFilter")
      .value =
        currentDriver;
  }
}


function resetFilters() {
  $("teamFilter")
    .value =
      "";

  $("driverFilter")
    .value =
      "";

  $("search")
    .value =
      "";

  renderActiveView();
}


async function loadRaceList() {
  try {
    const data =
      await api(
        "/api/races",
        {
          raceId:
            null
        }
      );


    S.currentRaceId =
      data.current_race_id ??
      null;


    const history =
      (
        data.rows ||
        []
      )
        .filter(
          race =>
            !race.is_live
        );


    $("raceSelector")
      .innerHTML =
        `
<option value="live">
  ● Current race
</option>
` +
        history
          .map(
            race =>
              `
<option value="race:${esc(race.race_id)}">
  ${esc(
    race.label ||
    `Race ${race.race_id}`
  )}
</option>
`
          )
          .join("");


  } catch (error) {

    console.error(
      error
    );


    $("raceSelector")
      .innerHTML =
        '<option value="live">● Current race</option>';
  }
}


function renderOverview() {
  const rows =
    filterRows(
      S.overview
    );


  $("teamCount")
    .textContent =
      rows.length;


  $("overviewBody")
    .innerHTML =
      rows
        .map(
          row =>
            `
<tr
  class="clickableRow"
  data-detail-type="team"
  data-team="${esc(row.team_name || "")}"
  data-apex-id="${esc(row.apex_id || "")}"
>

  <td>
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
      row.race_lap ??
      row.live_lap_count ??
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
      row.stint_number
        ? `#${esc(row.stint_number)}`
        : "—"
    }
  </td>

  <td>
    ${esc(
      row.stint_laps ??
      row.total_stint_laps ??
      "—"
    )}
  </td>

  <td>
    ${fmtTime(
      row.live_last_lap
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
    ${esc(
      row.best_lap_number ??
      "—"
    )}
  </td>

  <td class="bad">
    ${fmtTime(
      row.worst_lap_time
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
            S.liveMeta
              ?.active ===
              false
              ? "No active live timing session."
              : "No live race data yet."
          )
        : "No stored overview data for this race."
    }
  </td>
</tr>
`;
}


function renderStints() {
  const rows =
    filterRows(
      S.stints
    );


  $("stintsBody")
    .innerHTML =
      rows
        .map(
          row =>
            `
<tr>

  <td>
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
      row.stint_number
        ? `#${esc(row.stint_number)}`
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
      row.is_live
        ? "LIVE"
        : esc(
            row.end_lap_count ??
            "—"
          )
    }
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
    ${fmtTime(
      row.avg_lap_time ??
      row.avg_lap
    )}
  </td>

  <td class="good">
    ${fmtTime(
      row.best_lap_time ??
      row.best_lap
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
      row.worst_lap_time ??
      row.worst_lap
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
      row.consistency
    )}
  </td>

  <td>
    ${
      row.is_live
        ? '<span class="liveText">LIVE</span>'
        : "COMPLETED"
    }
  </td>

</tr>
`
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


function renderDrivers() {
  const rows =
    filterRows(
      S.drivers
    );


  $("driversBody")
    .innerHTML =
      rows
        .map(
          row =>
            `
<tr>

  <td>
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
  <td colspan="11">
    No driver data for the selected race.
  </td>
</tr>
`;
}


function renderTeams() {
  const rows =
    filterRows(
      S.teams
    );


  $("teamsBody")
    .innerHTML =
      rows
        .map(
          row =>
            `
<tr>

  <td>
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
  <td colspan="10">
    No team data for the selected race.
  </td>
</tr>
`;
}


function renderPits() {
  const rows =
    filterRows(
      S.pits
    );


  $("pitsBody")
    .innerHTML =
      rows
        .map(
          row =>
            `
<tr>

  <td>
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


function renderEvents() {
  const rows =
    filterRows(
      S.events
    );


  $("eventsBody")
    .innerHTML =
      rows
        .map(
          row =>
            `
<tr>

  <td>
    ${fmtDateTime(
      row.time
    )}
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
  class="secondary eventDelete"
  data-apex-id="${esc(row.apex_id)}"
  data-lap="${esc(row.lap_number)}"
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
    No race events or manual exclusions.
  </td>
</tr>
`;


  document
    .querySelectorAll(
      ".eventDelete"
    )
    .forEach(
      button => {
        button.addEventListener(
          "click",
          async () => {

            await api(
              "/api/events",
              {
                method:
                  "DELETE",

                query: {
                  apex_id:
                    button.dataset.apexId,

                  lap_number:
                    button.dataset.lap
                }
              }
            );


            await loadEvents(
              true
            );
          }
        );
      }
    );
}


function renderActiveView() {
  const renderer = ({
    overview:
      renderOverview,

    stints:
      renderStints,

    drivers:
      renderDrivers,

    teams:
      renderTeams,

    pits:
      renderPits,

    events:
      renderEvents
  })[
    S.activeView
  ];


  if (renderer) {
    renderer();
  }
}


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

    if (
      isLiveRace()
    ) {
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

      S.currentRaceId =
        data.race_id ??
        S.currentRaceId;

      S.overview =
        data.active
          ? (
              data.current ||
              []
            )
          : [];


      $("sessionName")
        .textContent =
          data.session_name ||
          "Apex Timing";

      $("sessionStatus")
        .textContent =
          data.active
            ? "LIVE"
            : "NO LIVE SESSION";

      $("headerTeamCount")
        .textContent =
          S.overview.length;


      setStatus(
        true,
        data.active
          ? "LIVE"
          : "NO LIVE SESSION",
        data.active
          ? `Updated ${new Date().toLocaleTimeString()}`
          : "No active Apex timing session"
      );

    } else {

      const data =
        await api(
          "/api/teams"
        );


      S.teams =
        data.rows ||
        [];

      S.loaded.teams =
        true;


      S.overview =
        S.teams.map(
          team => ({
            ...team,

            driver_name:
              null,

            race_lap:
              team.total_laps,

            pit_count:
              null,

            stint_number:
              null,

            stint_laps:
              null
          })
        );


      $("sessionName")
        .textContent =
          $("raceSelector")
            .selectedOptions[0]
            ?.textContent
            ?.trim() ||
          `Race ${S.raceId}`;

      $("sessionStatus")
        .textContent =
          "FINISHED";

      $("headerTeamCount")
        .textContent =
          S.teams.length;


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
    const data =
      await api(
        "/api/stints"
      );

    S.stints =
      data.rows ||
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
    const data =
      await api(
        "/api/drivers"
      );

    S.drivers =
      data.rows ||
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
    const data =
      await api(
        "/api/teams"
      );

    S.teams =
      data.rows ||
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
    const data =
      await api(
        "/api/pits"
      );

    S.pits =
      data.rows ||
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
    const data =
      await api(
        "/api/events"
      );

    S.events =
      data.rows ||
      [];

    S.loaded.events =
      true;

    rebuildFilters();

    renderEvents();

  } catch (error) {

    showLoadError(
      error
    );
  }
}


async function loadActiveView(
  force = false
) {
  if (
    S.activeView ===
    "overview"
  ) {
    return loadOverview(
      force
    );
  }


  if (
    S.activeView ===
    "stints"
  ) {
    return loadStints(
      force
    );
  }


  if (
    S.activeView ===
    "drivers"
  ) {
    return loadDrivers(
      force
    );
  }


  if (
    S.activeView ===
    "teams"
  ) {
    return loadTeams(
      force
    );
  }


  if (
    S.activeView ===
    "pits"
  ) {
    return loadPits(
      force
    );
  }


  if (
    S.activeView ===
    "events"
  ) {
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
    error.message ||
    String(
      error
    )
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
    String(
      value
    );


  return /[",\n]/.test(
    text
  )
    ? `"${text.replace(/"/g, '""')}"`
    : text;
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
            Object.keys(
              row
            )
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
    ]
      .join("\n");


  const blob =
    new Blob(
      [
        "\uFEFF" +
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


function downloadPdf(
  filename,
  title,
  sections
) {
  if (
    !window.jspdf
      ?.jsPDF
  ) {
    alert(
      "PDF library is not loaded."
    );

    return;
  }


  const doc =
    new window.jspdf
      .jsPDF({
        orientation:
          "landscape",

        unit:
          "mm",

        format:
          "a4"
      });


  doc.setFontSize(
    15
  );

  doc.text(
    title,
    10,
    10
  );


  let y = 16;


  for (
    const section
    of sections
  ) {
    if (
      !section.rows
        .length
    ) {
      continue;
    }


    const columns =
      section.columns ||
      [
        ...new Set(
          section.rows
            .flatMap(
              row =>
                Object.keys(
                  row
                )
            )
        )
      ];


    doc.setFontSize(
      11
    );

    doc.text(
      section.title,
      10,
      y
    );

    y +=
      3;


    doc.autoTable({
      startY:
        y,

      head: [
        columns
      ],

      body:
        section.rows.map(
          row =>
            columns.map(
              column =>
                row[column] ??
                ""
            )
        ),

      styles: {
        fontSize:
          6,

        cellPadding:
          1
      },

      headStyles: {
        fontSize:
          6
      },

      margin: {
        left:
          8,

        right:
          8
      }
    });


    y =
      doc.lastAutoTable
        .finalY +
      7;


    if (
      y > 180
    ) {
      doc.addPage();

      y =
        12;
    }
  }


  doc.save(
    filename
  );
}


async function ensureReportData() {
  const [
    stints,
    drivers,
    teams,
    pits,
    events
  ] =
    await Promise.all([
      api(
        "/api/stints"
      ),

      api(
        "/api/drivers"
      ),

      api(
        "/api/teams"
      ),

      api(
        "/api/pits"
      ),

      api(
        "/api/events"
      )
    ]);


  S.stints =
    stints.rows ||
    [];

  S.drivers =
    drivers.rows ||
    [];

  S.teams =
    teams.rows ||
    [];

  S.pits =
    pits.rows ||
    [];

  S.events =
    events.rows ||
    [];
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
  return isLiveRace()
    ? `race-${S.currentRaceId || "live"}`
    : `race-${S.raceId}`;
}


$("raceSelector")
  .addEventListener(
    "change",
    async event => {

      const value =
        event.target.value;


      if (
        value ===
        "live"
      ) {
        S.source =
          "live";

        S.raceId =
          null;

      } else {

        S.source =
          "history";

        S.raceId =
          value.replace(
            /^race:/,
            ""
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


$("addManualExclusion")
  .addEventListener(
    "click",
    async () => {

      const team =
        prompt(
          "Team name exactly as shown in Race Engineer:"
        );


      if (!team) {
        return;
      }


      const sourceRows =
        S.overview.length
          ? S.overview
          : (
              (
                await api(
                  "/api/live",
                  {
                    raceId:
                      null
                  }
                )
              ).current ||
              []
            );


      const match =
        sourceRows.find(
          row =>
            String(
              row.team_name ||
              ""
            )
              .toLowerCase() ===
            team
              .trim()
              .toLowerCase()
        );


      if (!match) {
        alert(
          "Team not found in the current race."
        );

        return;
      }


      const lap =
        Number(
          prompt(
            `Lap to exclude for ${match.team_name}:`
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
              match.apex_id,

            lap_number:
              Math.trunc(
                lap
              )
          }
        }
      );


      S.loaded.events =
        false;


      if (
        S.activeView ===
        "events"
      ) {
        await loadEvents(
          true
        );
      }


      alert(
        `Lap ${Math.trunc(lap)} excluded for ${match.team_name}.`
      );
    }
  );


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
            view !==
            "reports"
          ) {
            await loadActiveView(
              false
            );
          }
        }
      );
    }
  );


$("downloadRaceCsv")
  .addEventListener(
    "click",
    async () => {

      await ensureReportData();


      downloadCsv(
        `${reportBaseName()}-analytics.csv`,
        raceReportRows()
      );
    }
  );


$("downloadRacePdf")
  .addEventListener(
    "click",
    async () => {

      await ensureReportData();


      downloadPdf(
        `${reportBaseName()}-analytics.pdf`,
        "Race Engineer — Race Analytics",
        [
          {
            title:
              "Teams",

            rows:
              S.teams
          },

          {
            title:
              "Drivers",

            rows:
              S.drivers
          },

          {
            title:
              "Stints",

            rows:
              S.stints
          },

          {
            title:
              "Pit stops",

            rows:
              S.pits
          },

          {
            title:
              "Events / exclusions",

            rows:
              S.events
          }
        ]
      );
    }
  );


$("organiserReport1Csv")
  .addEventListener(
    "click",
    async () => {

      await ensureReportData();


      downloadCsv(
        `${reportBaseName()}-organiser-stints-pits.csv`,
        [
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
          )
        ]
      );
    }
  );


$("organiserReport1Pdf")
  .addEventListener(
    "click",
    async () => {

      await ensureReportData();


      downloadPdf(
        `${reportBaseName()}-organiser-stints-pits.pdf`,
        "Organiser Report — Stints & Pit Stops",
        [
          {
            title:
              "Stints",

            rows:
              S.stints
          },

          {
            title:
              "Pit stops",

            rows:
              S.pits
          }
        ]
      );
    }
  );


$("organiserReport2Csv")
  .addEventListener(
    "click",
    async () => {

      await ensureReportData();


      downloadCsv(
        `${reportBaseName()}-organiser-drivers-teams.csv`,
        [
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
          )
        ]
      );
    }
  );


$("organiserReport2Pdf")
  .addEventListener(
    "click",
    async () => {

      await ensureReportData();


      downloadPdf(
        `${reportBaseName()}-organiser-drivers-teams.pdf`,
        "Organiser Report — Teams & Drivers",
        [
          {
            title:
              "Teams",

            rows:
              S.teams
          },

          {
            title:
              "Drivers",

            rows:
              S.drivers
          }
        ]
      );
    }
  );


$("closeDetail")
  .addEventListener(
    "click",
    () =>
      $("detailDrawer")
        .classList.remove(
          "open"
        )
  );


document
  .addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
        "Escape"
      ) {
        $("detailDrawer")
          .classList.remove(
            "open"
          );
      }
    }
  );


S.timer =
  setInterval(
    () => {

      if (
        isLiveRace() &&
        $("auto").checked &&
        S.activeView !==
          "reports"
      ) {
        S.loaded[
          S.activeView
        ] =
          false;

        loadActiveView(
          true
        );
      }
    },
    2000
  );


(
  async function init() {

    updateRaceContext();

    await loadRaceList();

    await loadOverview(
      true
    );

  }
)();
