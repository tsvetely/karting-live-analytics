const S = {
  raceId: Number(localStorage.getItem("raceId") || 1),

  live: [],
  stints: [],
  drivers: [],
  pits: [],

  activeView: "live",
  loaded: {
    stints: false,
    drivers: false,
    pits: false
  },

  timer: null
};


const $ = id => document.getElementById(id);


const esc = v =>
  String(v ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c])
  );


function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}


function tm(v) {

  const x = n(v);

  if (x === null) {
    return "—";
  }

  if (x >= 60) {

    const m = Math.floor(x / 60);

    const s = (x - m * 60)
      .toFixed(3)
      .padStart(6, "0");

    return `${m}:${s}`;
  }

  return x.toFixed(3);
}


function pick(o, ...ks) {

  for (const k of ks) {

    if (
      o &&
      o[k] !== undefined &&
      o[k] !== null &&
      o[k] !== ""
    ) {
      return o[k];
    }

  }

  return null;
}


// ============================================================
// STINT NUMBER
// ============================================================

function stintNo(row) {

  // If the backend already gives us a current stint number,
  // use it immediately.
  if (
    row.stint_number !== undefined &&
    row.stint_number !== null
  ) {
    return row.stint_number;
  }

  // Otherwise derive it from loaded completed stints.
  const completed = S.stints.filter(
    x =>
      String(x.apex_id) === String(row.apex_id)
  );

  if (!completed.length) {
    return "—";
  }

  return completed.length + 1;
}


// ============================================================
// API
// ============================================================

async function api(path) {

  const r = await fetch(
    `${path}?race_id=${encodeURIComponent(S.raceId)}`,
    {
      cache: "no-store"
    }
  );

  if (!r.ok) {
    throw new Error(await r.text());
  }

  return r.json();
}


// ============================================================
// STATUS
// ============================================================

function setStatus(ok, msg) {

  $("status").textContent = msg;

  $("liveDot").className =
    `dot ${ok ? "ok" : "bad"}`;
}


// ============================================================
// FILTER
// ============================================================

function filter(rows) {

  const q =
    $("search")
      .value
      .trim()
      .toLowerCase();

  const team =
    $("teamFilter").value;

  return rows.filter(r => {

    const haystack =
      `${r.team_name || ""} ` +
      `${r.driver_name || r.current_driver || ""} ` +
      `${r.apex_id || ""}`
        .toLowerCase();

    return (
      (!q || haystack.includes(q)) &&
      (!team ||
        String(r.team_name || "") === team)
    );

  });
}


// ============================================================
// TEAM FILTER
// ============================================================

function teams() {

  const select = $("teamFilter");

  const currentValue =
    select.value;

  const values = [
    ...new Set(
      S.live
        .map(x => x.team_name)
        .filter(Boolean)
    )
  ].sort();

  select.innerHTML =
    '<option value="">All teams</option>' +
    values
      .map(
        t =>
          `<option value="${esc(t)}">${esc(t)}</option>`
      )
      .join("");

  if (values.includes(currentValue)) {
    select.value = currentValue;
  }
}


// ============================================================
// RENDER LIVE
// ============================================================

function renderLive() {

  const rows =
    filter(S.live);

  $("teamCount").textContent =
    rows.length;

  $("liveBody").innerHTML =
    rows
      .map(
        r => `
<tr>

  <td class="team">
    ${esc(r.team_name || `APEX ${r.apex_id}`)}
  </td>

  <td>
    ${esc(r.driver_name || r.current_driver || "—")}
  </td>

  <td>
    #${esc(stintNo(r))}
  </td>

  <td>
    ${esc(
      pick(
        r,
        "lap_count",
        "live_lap_count"
      ) ?? "—"
    )}
  </td>

  <td>
    ${tm(r.live_last_lap)}
  </td>

  <td>
    ${tm(r.avg_lap_time)}
  </td>

  <td class="good">
    ${tm(
      pick(
        r,
        "best_lap_time",
        "live_best_lap"
      )
    )}
  </td>

  <td class="bad">
    ${tm(
      pick(
        r,
        "worst_lap_time",
        "max_lap_time"
      )
    )}
  </td>

  <td>
    ${tm(
      pick(
        r,
        "consistency",
        "consistency_time",
        "lap_consistency"
      )
    )}
  </td>

  <td class="muted">
    ${
      r.updated_at
        ? new Date(
            r.updated_at
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
  <td colspan="10">
    No data for this race/filter.
  </td>
</tr>
`;

}


// ============================================================
// RENDER STINTS
// ============================================================

function renderStints() {

  const rows =
    filter(S.stints);

  $("stintsBody").innerHTML =
    rows
      .map(
        r => `
<tr>

  <td class="team">
    ${esc(r.team_name || `APEX ${r.apex_id}`)}
  </td>

  <td>
    ${esc(r.driver_name || "—")}
  </td>

  <td>
    ${esc(r.start_lap_count ?? "—")}
  </td>

  <td>
    ${esc(r.end_lap_count ?? "LIVE")}
  </td>

  <td>
    ${esc(
      pick(
        r,
        "lap_count",
        "valid_laps",
        "total_laps"
      ) ?? "—"
    )}
  </td>

  <td>
    ${tm(
      pick(
        r,
        "avg_lap_time",
        "avg_lap"
      )
    )}
  </td>

  <td class="good">
    ${tm(
      pick(
        r,
        "best_lap_time",
        "best_lap"
      )
    )}
  </td>

  <td class="bad">
    ${tm(
      pick(
        r,
        "worst_lap_time",
        "worst_lap",
        "max_lap_time"
      )
    )}
  </td>

  <td>
    ${tm(
      pick(
        r,
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
  <td colspan="9">
    No stint data.
  </td>
</tr>
`;

}


// ============================================================
// RENDER DRIVERS
// ============================================================

function renderDrivers() {

  const rows =
    filter(S.drivers);

  $("driversBody").innerHTML =
    rows
      .map(
        r => `
<tr>

  <td class="team">
    ${esc(r.team_name || `APEX ${r.apex_id}`)}
  </td>

  <td>
    ${esc(r.driver_name || "—")}
  </td>

  <td>
    ${esc(r.valid_stint_count ?? "—")}
  </td>

  <td>
    ${esc(r.short_stint_count ?? "—")}
  </td>

  <td>
    ${esc(r.valid_laps ?? "—")}
  </td>

  <td>
    ${esc(r.total_laps ?? "—")}
  </td>

  <td>
    ${tm(r.avg_lap_time)}
  </td>

  <td class="good">
    ${tm(r.best_lap_time)}
  </td>

  <td>
    ${tm(r.avg_consistency)}
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
// RENDER PITS
// ============================================================

function renderPits() {

  const rows =
    filter(S.pits);

  $("pitsBody").innerHTML =
    rows
      .map(
        r => `
<tr>

  <td class="team">
    ${esc(r.team_name || `APEX ${r.apex_id}`)}
  </td>

  <td>
    ${esc(
      pick(
        r,
        "pit_number",
        "pit_no"
      ) ?? "—"
    )}
  </td>

  <td>
    ${esc(r.driver_name || "—")}
  </td>

  <td>
    ${esc(r.pit_lap ?? "—")}
  </td>

  <td>
    ${esc(r.pit_hour ?? "—")}
  </td>

  <td>
    ${esc(r.on_track ?? "—")}
  </td>

  <td>
    ${esc(r.pit_time ?? "—")}
  </td>

  <td>
    ${esc(r.out_time ?? r.out ?? "—")}
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
// LOAD LIVE
// ============================================================
//
// THIS is the only thing called every 1.5 sec.
//
// ============================================================

async function refreshLive() {

  try {

    const live =
      await api("/api/live");

    S.live =
  live.current || [];

teams();

renderLive();

if (live.active === false) {

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

    $("updated").textContent =
      `Updated ${new Date().toLocaleTimeString()}`;

  } catch (e) {

    console.error(e);

    setStatus(
      false,
      "ERROR"
    );

    $("updated").textContent =
      e.message;
  }
}


// ============================================================
// LOAD STINTS
// ============================================================

async function loadStints(force = false) {

  if (
    S.loaded.stints &&
    !force
  ) {
    renderStints();
    return;
  }

  try {

    const data =
      await api("/api/stints");

    S.stints =
      data.rows || [];

    S.loaded.stints = true;

    renderStints();

    // stintNo() on LIVE can now use completed stint history
    renderLive();

  } catch (e) {

    console.error(e);

    setStatus(
      false,
      "ERROR"
    );

    $("updated").textContent =
      e.message;
  }
}


// ============================================================
// LOAD DRIVERS
// ============================================================

async function loadDrivers(force = false) {

  if (
    S.loaded.drivers &&
    !force
  ) {
    renderDrivers();
    return;
  }

  try {

    const data =
      await api("/api/drivers");

    S.drivers =
      data.rows || [];

    S.loaded.drivers = true;

    renderDrivers();

  } catch (e) {

    console.error(e);

    setStatus(
      false,
      "ERROR"
    );

    $("updated").textContent =
      e.message;
  }
}


// ============================================================
// LOAD PITS
// ============================================================

async function loadPits(force = false) {

  if (
    S.loaded.pits &&
    !force
  ) {
    renderPits();
    return;
  }

  try {

    const data =
      await api("/api/pits");

    S.pits =
      data.rows || [];

    S.loaded.pits = true;

    renderPits();

  } catch (e) {

    console.error(e);

    setStatus(
      false,
      "ERROR"
    );

    $("updated").textContent =
      e.message;
  }
}


// ============================================================
// ACTIVE VIEW LOADER
// ============================================================

async function loadActiveView(force = false) {

  if (S.activeView === "live") {

    await refreshLive();
    return;

  }

  if (S.activeView === "stints") {

    await loadStints(force);
    return;

  }

  if (S.activeView === "drivers") {

    await loadDrivers(force);
    return;

  }

  if (S.activeView === "pits") {

    await loadPits(force);
  }
}


// ============================================================
// RACE ID
// ============================================================

$("raceId").value =
  S.raceId;


$("raceId").addEventListener(
  "change",
  async () => {

    S.raceId =
      Number(
        $("raceId").value || 1
      );

    localStorage.setItem(
      "raceId",
      S.raceId
    );


    // Clear all old race data
    S.live = [];
    S.stints = [];
    S.drivers = [];
    S.pits = [];

    S.loaded.stints = false;
    S.loaded.drivers = false;
    S.loaded.pits = false;


    teams();

    renderLive();
    renderStints();
    renderDrivers();
    renderPits();


    // Always establish the LIVE state of the new race.
    await refreshLive();


    // If another tab is currently selected,
    // load that race's corresponding data too.
    if (S.activeView !== "live") {
      await loadActiveView(true);
    }
  }
);


// ============================================================
// SEARCH / TEAM FILTER
// ============================================================

$("search").addEventListener(
  "input",
  () => {

    renderLive();
    renderStints();
    renderDrivers();
    renderPits();

  }
);


$("teamFilter").addEventListener(
  "change",
  () => {

    renderLive();
    renderStints();
    renderDrivers();
    renderPits();

  }
);


// ============================================================
// REFRESH BUTTON
// ============================================================

$("refresh").addEventListener(
  "click",
  async () => {

    if (S.activeView === "live") {

      await refreshLive();

    } else {

      await loadActiveView(true);

    }

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
            x =>
              x.classList.remove("active")
          );

        document
          .querySelectorAll(".view")
          .forEach(
            x =>
              x.classList.remove("active")
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


        // NOW, and only now, load the selected dataset.
        await loadActiveView();

      }
    );

  });


// ============================================================
// AUTO LIVE REFRESH
// ============================================================
//
// IMPORTANT:
//
// Auto refresh NEVER executes:
//   /api/drivers
//   /api/stints
//   /api/pits
//
// It updates only LIVE.
//
// ============================================================

S.timer =
  setInterval(
    () => {

      if (
        $("auto").checked &&
        S.activeView === "live"
      ) {
        refreshLive();
      }

    },
    1500
  );


// ============================================================
// INITIAL LOAD
// ============================================================

refreshLive();
