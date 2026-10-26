// LPU Campus Navigator — Stage 4: "I'm lost" help, problem reports and test mode.
// Loaded after app.js and routes.js and uses their helpers
// (map, dir, allPlaces, placesById, nearestOnPath, bearing, compassWord, $, ...).

// ---------- Settings ----------
const HELP_POINT_IDS = ["uni-health-center", "division-of-admission-block", "entry-gate", "main-gate-entry"];
const RESUME_MAX_M = 150; // further than this from the route = suggest a landmark first
const FEEDBACK_KEY = "campus_feedback";
const LOG_KEY = "campus_testlog";
const TEST_STATE_KEY = "campus_test_state";
const MAX_LOG_EVENTS = 5000;

// ---------- Safe localStorage (private windows can block it) ----------
function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch (e) {
    return fallback;
  }
}
function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- Distances in words ----------
function nearestPlaces(latlng, count, excludeId) {
  return allPlaces
    .filter((p) => p.id !== excludeId)
    .map((p) => ({ place: p, dist: map.distance(latlng, [p.lat, p.lng]) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count);
}

function nearestHelpPoint(latlng) {
  const points = HELP_POINT_IDS.map((id) => placesById[id]).filter(Boolean);
  let best = null;
  for (const p of points) {
    const d = map.distance(latlng, [p.lat, p.lng]);
    if (!best || d < best.dist) best = { place: p, dist: d };
  }
  return best;
}

// "about 60 m north-west" (from → to)
function describeWay(from, to) {
  const d = map.distance(from, to);
  if (d < 15) return "right here";
  return `about ${Math.round(d / 10) * 10} m ${compassWord(bearing(from, to))}`;
}

function badgeHtml(place) {
  const color = CATEGORY_COLORS[place.category] || "#6b7280";
  return `<span class="mini-badge" style="--c:${color}">${iconSvg(placeIcon(place))}</span>`;
}

// ---------- Sheets (bottom sheet on phones, panel on desktop) ----------
const helpSheet = $("helpSheet");
const helpBody = $("helpBody");
const reportSheet = $("reportSheet");
const backdrop = $("sheetBackdrop");
const lostBtn = $("lostBtn");

$("lostIcon").innerHTML = iconSvg("help");

function syncSheets() {
  const anyOpen = !helpSheet.hidden || !reportSheet.hidden;
  backdrop.hidden = !anyOpen;
  document.body.classList.toggle("sheet-open", anyOpen);
}

// ---------- "I'm lost" ----------
const help = {
  pos: null, // { latlng, source: "gps" | "landmark" | "last" | "centre", place? }
  layer: L.layerGroup().addTo(map), // dashed line to the help point + "you are here"
};

function openLostSheet() {
  // Log only the nearest place id, never raw coordinates
  const near = lastKnownPos ? nearestPlaces(lastKnownPos, 1)[0] : null;
  logEvent("lost_tapped", { place_id: near ? near.place.id : "unknown" });

  closeCard(); // ui.js: leaves the place sheet if it's open
  clearHelp();
  renderMenu();
  helpSheet.hidden = false;
  syncSheets();
}

function closeLostSheet() {
  helpSheet.hidden = true;
  syncSheets();
}

// Remove the help line/pin from the map
function clearHelp() {
  help.layer.clearLayers();
  help.pos = null;
  if (helpPinId) {
    helpPinId = null;
    updateTiers();
  }
}

lostBtn.addEventListener("click", openLostSheet);
$("helpClose").addEventListener("click", closeLostSheet);

// Step 1: three big choices
function renderMenu() {
  const heading = dir.active
    ? `<p class="sheet-sub">You were heading to <strong>${escapeHtml(dir.to.name)}</strong>.</p>`
    : "";
  helpBody.innerHTML = `
    <h2 class="sheet-title">Where are you right now?</h2>
    ${heading}
    <div class="big-options">
      <button class="big-option" data-act="gps">
        <span class="big-icon" style="--c:#2563eb">${iconSvg("pin")}</span>
        <span><strong>Use my location</strong><small>Find places near you with GPS</small></span>
      </button>
      <button class="big-option" data-act="landmark">
        <span class="big-icon" style="--c:#0f766e">${iconSvg("eye")}</span>
        <span><strong>I can see a landmark</strong><small>Pick a building, gate or food court</small></span>
      </button>
      <button class="big-option" data-act="unknown">
        <span class="big-icon" style="--c:#dc2626">${iconSvg("help")}</span>
        <span><strong>I don't know</strong><small>We'll point you to the nearest help point</small></span>
      </button>
    </div>
    ${reportLinkHtml()}`;
}

function renderLoading(text) {
  helpBody.innerHTML = `<h2 class="sheet-title">${escapeHtml(text)}</h2><div class="sheet-spinner" aria-hidden="true"></div>`;
}

// Option a: GPS → 3 nearest places. Falls back to the landmark picker kindly.
function useGps() {
  if (!("geolocation" in navigator)) {
    renderLandmark("Your phone can't share its location here. No problem: pick something you can see instead.");
    return;
  }
  renderLoading("Finding you…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
      showMyPosition(ll, pos.coords.accuracy);
      if (!isOnCampus(ll)) {
        renderLandmark("It looks like you're outside the campus area, so GPS can't help here. Pick something you can see instead.");
        return;
      }
      setPosition({ latlng: ll, source: "gps" });
    },
    () => renderLandmark("We couldn't get your location. No problem: pick something you can see instead."),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
  );
}

// Option b: search-as-you-type + priority-1 quick buttons
function renderLandmark(message) {
  const quick = allPlaces
    .filter((p) => p.priority === 1)
    .map((p) => `<button class="quick-btn" data-act="pick" data-id="${p.id}">${badgeHtml(p)}<span>${escapeHtml(p.name)}</span></button>`)
    .join("");
  helpBody.innerHTML = `
    <button class="back-link" data-act="menu">‹ Back</button>
    <h2 class="sheet-title">What can you see?</h2>
    ${message ? `<p class="sheet-msg">${escapeHtml(message)}</p>` : ""}
    <input id="lmSearch" class="sheet-search" type="search" placeholder="Search a building, gate, food court…" autocomplete="off" aria-label="Search places" />
    <ul id="lmList" class="place-list" hidden></ul>
    <p class="sheet-label">Popular landmarks</p>
    <div class="quick-grid">${quick}</div>`;

  const input = $("lmSearch");
  input.addEventListener("input", () => {
    renderLandmarkList(input.value);
    logSearch(input.value);
  });
}

function renderLandmarkList(q) {
  const list = $("lmList");
  if (!q.trim()) {
    list.hidden = true;
    return;
  }
  const items = allPlaces.filter((p) => matchesQuery(p, q)).slice(0, 30);
  list.innerHTML = items.length
    ? items.map((p) => `<li><button data-act="pick" data-id="${p.id}">${badgeHtml(p)}<span>${escapeHtml(p.name)}</span></button></li>`).join("")
    : `<li class="empty">${EMPTY_SEARCH}</li>`;
  list.hidden = false;
}

// Option c: no idea → last known GPS position, or the campus centre
function useUnknown() {
  if (lastKnownPos) setPosition({ latlng: L.latLng(lastKnownPos), source: "last" });
  else setPosition({ latlng: L.latLng(CAMPUS_CENTER), source: "centre" });
}

// A position is known: draw the help point line and show the result
function setPosition(pos) {
  help.pos = pos;
  const hp = nearestHelpPoint(pos.latlng);
  help.layer.clearLayers();

  // "You are here" ring for a picked landmark or last position (GPS already has the blue dot)
  if (pos.source === "landmark" || pos.source === "last") {
    L.marker(pos.latlng, {
      icon: L.divIcon({ className: "you-here", html: "<span></span>", iconSize: [26, 26], iconAnchor: [13, 13] }),
      interactive: false,
      zIndexOffset: 900,
    }).addTo(help.layer);
  }
  // Dashed line to the help point (not when we're only guessing the centre)
  if (hp && pos.source !== "centre") {
    L.polyline([pos.latlng, [hp.place.lat, hp.place.lng]], {
      color: "#dc2626", weight: 4, dashArray: "4 10", lineCap: "round", interactive: false,
    }).addTo(help.layer);
  }
  helpPinId = hp ? hp.place.id : null;
  updateTiers();
  renderResult(hp);
}

function renderResult(hp) {
  const pos = help.pos;
  const where = {
    gps: "Here's what's around you, based on GPS.",
    landmark: `You're at ${escapeHtml(pos.place?.name || "")}.`,
    last: "Based on where your phone last found you.",
    centre: "We don't know where you are, so here's a help point near the middle of campus. Any staff member or guard can help too.",
  }[pos.source];

  const helpCard = hp
    ? `<div class="help-card">
         ${badgeHtml(hp.place)}
         <div><small>Nearest help point</small><strong>${escapeHtml(hp.place.name)}</strong>
         <span>${pos.source === "centre" ? "Near the centre of campus" : escapeHtml(describeWay(pos.latlng, [hp.place.lat, hp.place.lng]))}</span></div>
       </div>`
    : "";

  // 3 nearest places when we actually know where you are
  let nearby = "";
  if (pos.source === "gps" || pos.source === "landmark") {
    const items = nearestPlaces(pos.latlng, 3, pos.place?.id);
    nearby = `<p class="sheet-label">Places near you</p><ul class="near-list">${items
      .map(({ place }) => `<li>${badgeHtml(place)}<div><strong>${escapeHtml(place.name)}</strong><span>${escapeHtml(describeWay(pos.latlng, [place.lat, place.lng]))}</span></div></li>`)
      .join("")}</ul>`;
  }

  const resume = resumeHtml();
  helpBody.innerHTML = `
    <button class="back-link" data-act="menu">‹ Back</button>
    <h2 class="sheet-title">Here's help nearby</h2>
    <p class="sheet-sub">${where}</p>
    ${resume}
    ${helpCard}
    ${nearby}
    <div class="sheet-actions">
      <button class="btn ${resume ? "btn-ghost" : "btn-primary"} btn-block" data-act="showmap">Show on map</button>
      <button class="btn btn-ghost btn-block" data-act="done">Done</button>
    </div>
    ${reportLinkHtml()}`;
}

// "Continue to X from here" when directions were running
function resumeHtml() {
  if (!dir.active || !help.pos || help.pos.source === "centre") return "";
  const name = escapeHtml(dir.to.name);
  if (dir.hasRoute) {
    const near = nearestOnPath(help.pos.latlng, dir.path);
    if (near.lineDist > RESUME_MAX_M) {
      return `<p class="sheet-warn">You're quite far from this route. Go to the nearest landmark first?</p>
        <button class="btn btn-primary btn-block" data-act="straight">Show a straight line to ${name} instead</button>`;
    }
  }
  return `<button class="btn btn-primary btn-block" data-act="resume">Continue to ${name} from here</button>`;
}

// Where directions should start from for the current position
function fromForPosition(pos) {
  return pos.source === "landmark" ? pos.place : { gps: true, lat: pos.latlng.lat, lng: pos.latlng.lng };
}

// Pick up the active route at the step nearest to you
function resumeDirections() {
  const pos = help.pos;
  closeLostSheet();
  clearHelp();
  if (dir.hasRoute) {
    const near = nearestOnPath(pos.latlng, dir.path);
    let idx = 0;
    dir.steps.forEach((s, i) => { if (s.at <= near.index) idx = i; });
    dir.step = idx;
    renderStep(true);
    showToast(`Picking up at step ${idx + 1} of ${dir.steps.length}.`);
  } else {
    setFrom(fromForPosition(pos)); // straight-line mode: redraw from here
  }
}

// Too far from the route: straight line from here instead of a wrong step
function straightFromHere() {
  const pos = help.pos;
  closeLostSheet();
  clearHelp();
  dir.forceStraight = true;
  setFrom(fromForPosition(pos));
}

// Close the sheet and fit the map to you + the help point
function showHelpOnMap() {
  const pos = help.pos;
  closeLostSheet();
  if (!pos || !helpPinId) return;
  const hp = placesById[helpPinId];
  if (pos.source === "centre") {
    flyToVisible(L.latLng(hp.lat, hp.lng), 17);
    return;
  }
  const p = coveredPadding();
  map.flyToBounds(L.latLngBounds([pos.latlng, [hp.lat, hp.lng]]), {
    paddingTopLeft: p.tl, paddingBottomRight: p.br, maxZoom: 18, duration: 0.8,
  });
}

// One click handler for everything inside the sheet
helpBody.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "gps") useGps();
  else if (act === "landmark") renderLandmark("");
  else if (act === "unknown") useUnknown();
  else if (act === "menu") { clearHelp(); renderMenu(); }
  else if (act === "pick") {
    const p = placesById[btn.dataset.id];
    if (p) setPosition({ latlng: L.latLng(p.lat, p.lng), source: "landmark", place: p });
  }
  else if (act === "resume") resumeDirections();
  else if (act === "straight") straightFromHere();
  else if (act === "showmap") showHelpOnMap();
  else if (act === "done") { closeLostSheet(); clearHelp(); }
  else if (act === "report") openReport(helpReportContext());
});

function reportLinkHtml() {
  return `<button class="link-btn" data-act="report">Report a problem</button>`;
}

function helpReportContext() {
  return {
    place_id: help.pos?.place?.id || dir.to?.id || null,
    route_id: dir.active ? dir.routeId : null,
    step_index: dir.active && dir.hasRoute ? dir.step : null,
  };
}

// ---------- Report a problem ----------
const reportForm = $("reportForm");
const reportNote = $("reportNote");
let reportCtx = {};

// ctx: { place_id, route_id, step_index } — whatever is known
function openReport(ctx) {
  reportCtx = ctx || {};
  reportForm.reset();
  $("reportSubmit").disabled = true;
  $("reportCount").textContent = `0 / ${reportNote.maxLength}`;

  // Show what will be attached, so testers can see nothing personal is sent
  const bits = [];
  if (reportCtx.place_id && placesById[reportCtx.place_id]) bits.push(placesById[reportCtx.place_id].name);
  if (reportCtx.route_id) bits.push("this route");
  if (reportCtx.step_index != null) bits.push(`step ${reportCtx.step_index + 1}`);
  $("reportContext").textContent = bits.length ? `Attached: ${bits.join(" · ")}` : "";

  reportSheet.hidden = false;
  syncSheets();
}

function closeReport() {
  reportSheet.hidden = true;
  syncSheets();
}

$("reportClose").addEventListener("click", closeReport);
reportForm.addEventListener("change", () => {
  $("reportSubmit").disabled = !reportForm.category.value;
});
reportNote.addEventListener("input", () => {
  $("reportCount").textContent = `${reportNote.value.length} / ${reportNote.maxLength}`;
});

reportForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const category = reportForm.category.value;
  if (!category) return;
  const saved = saveFeedback({
    category,
    note: reportNote.value.trim().slice(0, 200),
    place_id: reportCtx.place_id || "",
    route_id: reportCtx.route_id || "",
    step_index: reportCtx.step_index ?? "",
  });
  if (!saved) {
    showToast("Sorry, this browser won't let us save the report.");
    return;
  }
  closeReport();
  showToast("Thanks, this helps us fix it.");
});

// Add one entry to the feedback log (also used by "Request this route")
function saveFeedback(entry) {
  const list = loadJson(FEEDBACK_KEY, []);
  list.push({ time: new Date().toISOString(), tester: testState.session?.code || "", ...entry });
  if (!saveJson(FEEDBACK_KEY, list)) return false;
  logEvent("feedback_submitted", { category: entry.category });
  return true;
}

// Tapping the dim background or pressing Escape closes the top sheet
backdrop.addEventListener("click", () => {
  if (!reportSheet.hidden) closeReport();
  else closeLostSheet();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!reportSheet.hidden) closeReport();
  else if (!helpSheet.hidden) closeLostSheet();
});

// ---------- Test mode ----------
// State survives a page reload so a session isn't lost mid-test
const testState = loadJson(TEST_STATE_KEY, { session: null, task: null });
// session: { code, started }   task: { label, started }

function saveTestState() {
  saveJson(TEST_STATE_KEY, testState);
}

// Record one event. Only ids, step numbers, categories and search text: no coordinates.
function logEvent(event, data = {}) {
  if (!testState.session) return;
  const log = loadJson(LOG_KEY, []);
  log.push({
    time: new Date().toISOString(),
    tester: testState.session.code,
    event,
    task: testState.task?.label || "",
    ...data,
  });
  saveJson(LOG_KEY, log.slice(-MAX_LOG_EVENTS));
}

// Searches are logged once typing pauses, so "a", "ad", "adm"… don't all appear
let searchTimer = null;
function logSearch(query) {
  clearTimeout(searchTimer);
  const q = String(query || "").trim();
  if (q.length < 2 || !testState.session) return;
  searchTimer = setTimeout(() => logEvent("search", { query: q }), 1000);
}

const testerCode = $("testerCode");
const taskLabel = $("taskLabel");

$("testToggle").addEventListener("click", () => {
  const open = $("testBody").hidden;
  $("testBody").hidden = !open;
  $("testToggle").setAttribute("aria-expanded", String(open));
});

$("sessionBtn").addEventListener("click", () => {
  if (testState.session) {
    if (testState.task) endTask();
    logEvent("session_end");
    testState.session = null;
    saveTestState();
    showToast("Session ended.");
  } else {
    // Short codes only (letters/numbers), never names
    const code = testerCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (!code) {
      showToast("Enter a tester code like S1 first.");
      return;
    }
    testerCode.value = code;
    testState.session = { code, started: Date.now() };
    saveTestState();
    logEvent("session_start");
    showToast(`Test session ${code} started.`);
  }
  renderTestUi();
});

$("taskStartBtn").addEventListener("click", () => {
  if (!testState.session) return showToast("Start a session first.");
  if (testState.task) return showToast("End the current task first.");
  const label = taskLabel.value.trim() || "Untitled task";
  testState.task = { label, started: Date.now() };
  saveTestState();
  logEvent("task_start");
  renderTestUi();
});

$("taskEndBtn").addEventListener("click", () => {
  if (!testState.task) return showToast("No task is running.");
  endTask();
  renderTestUi();
});

function endTask() {
  const elapsed = Math.round((Date.now() - testState.task.started) / 1000);
  logEvent("task_end", { elapsed_s: elapsed });
  showToast(`Task done in ${formatElapsed(elapsed)}.`);
  testState.task = null;
  saveTestState();
}

function formatElapsed(seconds) {
  seconds = Math.max(0, seconds); // the phone's clock can jump backwards
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Banner + panel status; ticks every second while a task runs
function renderTestUi() {
  const { session, task } = testState;
  const banner = $("testBanner");
  banner.hidden = !session;
  let timerText = "";
  if (task) timerText = `${task.label} · ${formatElapsed(Math.floor((Date.now() - task.started) / 1000))}`;
  if (session) banner.textContent = `Test mode: ${session.code}${timerText ? ` · ${timerText}` : ""}`;

  $("sessionBtn").textContent = session ? "End session" : "Start session";
  $("sessionBtn").classList.toggle("btn-primary", !session);
  testerCode.disabled = !!session;
  if (session) testerCode.value = session.code;
  $("testStatus").textContent = session ? `● ${session.code}` : "";
  $("taskTimer").hidden = !task;
  $("taskTimer").textContent = task ? `Running: ${timerText}` : "";
  $("taskStartBtn").disabled = !session || !!task;
  $("taskEndBtn").disabled = !task;
}
setInterval(() => { if (testState.task) renderTestUi(); }, 1000);

// ---------- CSV export ----------
const LOG_COLUMNS = ["time", "tester", "event", "task", "elapsed_s", "place_id", "route_id", "step_index", "query", "category"];
const FEEDBACK_COLUMNS = ["time", "tester", "category", "note", "place_id", "route_id", "step_index"];

function toCsv(rows, columns) {
  const cell = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // stop spreadsheets treating text as a formula
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n");
}

function downloadCsv(name, text) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }); // BOM so Excel reads UTF-8
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

$("exportLogBtn").addEventListener("click", () => {
  const rows = loadJson(LOG_KEY, []);
  if (!rows.length) return showToast("The test log is empty.");
  downloadCsv(`campus_test_log_${today()}.csv`, toCsv(rows, LOG_COLUMNS));
});

$("exportFbBtn").addEventListener("click", () => {
  const rows = loadJson(FEEDBACK_KEY, []);
  if (!rows.length) return showToast("No feedback yet.");
  downloadCsv(`campus_feedback_${today()}.csv`, toCsv(rows, FEEDBACK_COLUMNS));
});

$("clearTestBtn").addEventListener("click", () => {
  if (!confirm("Delete all test logs, feedback and the current session on this device? This can't be undone.")) return;
  try {
    localStorage.removeItem(LOG_KEY);
    localStorage.removeItem(FEEDBACK_KEY);
    localStorage.removeItem(TEST_STATE_KEY);
  } catch (e) {}
  testState.session = null;
  testState.task = null;
  testerCode.value = "";
  renderTestUi();
  showToast("All test data cleared.");
});

renderTestUi();
