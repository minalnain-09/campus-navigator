// LPU Campus Navigator — the bottom sheet: home, category lists, place details, directions.
// Loaded last; uses helpers from app.js, routes.js and help.js
// (map, focusPlace, startDirections, dir, placesById, nearestPlaces, saveFeedback, ...).

// ---------- Settings ----------
const SHEET_PEEK = 104; // px: handle + the search field
const RECENT_KEY = "campus_recent";
const RECENT_MAX = 5;
const POPULAR_IDS = ["main-gate-entry", "central-library", "cc-food-court", "division-of-admission-block", "uni-health-center", "uni-mall"];

// Category chips → which places they list (and show on the map)
const CATEGORY_TILES = [
  { id: "gates", label: "Gates", icon: "gate", cat: "admin", match: (p) => p.icon === "gate" },
  { id: "food", label: "Food", icon: "food", cat: "food", match: (p) => p.category === "food" },
  { id: "hostels", label: "Hostels", icon: "hostel", cat: "hostel", match: (p) => p.category === "hostel" },
  { id: "academic", label: "Academic", icon: "academic", cat: "academic", match: (p) => p.category === "academic" },
  { id: "help", label: "Health", icon: "health", cat: "help", match: (p) => p.category === "help" || HELP_POINT_IDS.includes(p.id) },
  { id: "sports", label: "Sports", icon: "sports", cat: "sports", match: (p) => p.category === "sports" },
];

// Friendly names for the category chip on the place sheet
const CATEGORY_LABELS = {
  academic: "Academic", food: "Food", hostel: "Hostel", admin: "Campus services", sports: "Sports", help: "Health & help",
};

const sheet = $("sheet");
const sheetScroll = $("sheetScroll");
const grab = $("sheetGrab");

document.getElementById("filtersIcon").innerHTML = iconSvg("eye");
$("arrivedTick").innerHTML = iconSvg("check");

// ---------- Sheet heights: peek / half / full (phones only) ----------
let sheetState = "half";
let sheetH = 0; // the height the sheet is at (or heading to)

function sheetHeights() {
  const vh = window.innerHeight;
  const topRoom = dir.active ? topInset() + 8 : 72; // keep the top controls visible
  return {
    peek: SHEET_PEEK,
    half: Math.round(vh * 0.5),
    full: Math.max(vh - topRoom, SHEET_PEEK),
  };
}

// How much map the sheet covers at the bottom (0 on desktop, where it's a side panel)
function sheetVisibleHeight() {
  if (desktopMQ.matches || document.body.classList.contains("admin-on")) return 0;
  return sheetH;
}

function setSheet(state) {
  sheetState = state;
  applySheetHeight(sheetHeights()[state], false);
}

function applySheetHeight(h, dragging) {
  sheetH = h;
  sheet.style.height = desktopMQ.matches ? "" : `${h}px`;
  sheet.classList.toggle("dragging", dragging);
  sheet.dataset.state = dragging ? sheet.dataset.state : sheetState;
  document.body.classList.toggle("sheet-full", !dragging && sheetState === "full");
  updateInsets(); // routes.js: moves the floating buttons with the sheet
}

// Drag the handle to resize; let go to snap to the nearest height. A quick flick goes one step further.
let drag = null;
grab.addEventListener("pointerdown", (e) => {
  if (desktopMQ.matches) return;
  drag = { y: e.clientY, h: sheetH, t: performance.now(), moved: false };
  grab.setPointerCapture(e.pointerId);
});
grab.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y;
  if (Math.abs(dy) > 6) drag.moved = true;
  if (!drag.moved) return;
  const { peek, full } = sheetHeights();
  applySheetHeight(Math.min(full, Math.max(peek, drag.h - dy)), true);
});
function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) {
    // A tap on the handle steps up: peek → half → full → peek
    setSheet({ peek: "half", half: "full", full: "peek" }[sheetState]);
    return;
  }
  const order = ["peek", "half", "full"];
  const hs = sheetHeights();
  let target = order.reduce((best, s) => (Math.abs(hs[s] - sheetH) < Math.abs(hs[best] - sheetH) ? s : best), "half");
  const speed = (e.clientY - d.y) / Math.max(1, performance.now() - d.t); // px per ms, + = down
  const i = order.indexOf(target);
  if (speed > 0.5 && hs[target] >= sheetH) target = order[Math.max(0, i - 1)];
  if (speed < -0.5 && hs[target] <= sheetH) target = order[Math.min(2, i + 1)];
  setSheet(target);
}
grab.addEventListener("pointerup", endDrag);
grab.addEventListener("pointercancel", endDrag);
// Keyboard: Enter/Space on the handle steps through the heights too
grab.addEventListener("click", (e) => {
  if (e.detail === 0) setSheet({ peek: "half", half: "full", full: "peek" }[sheetState]);
});

window.addEventListener("resize", () => setSheet(sheetState));
desktopMQ.addEventListener("change", () => setSheet(sheetState));

// ---------- Views inside the sheet ----------
const VIEWS = { home: $("viewHome"), category: $("viewCategory"), place: $("viewPlace"), dir: $("dirPanel") };
let currentView = "home";

function showView(name, state) {
  if (name !== "category" && name !== "place" && mapFocus) {
    mapFocus = null; // the map shows every category again
    updateTiers();
  }
  for (const [key, el] of Object.entries(VIEWS)) el.hidden = key !== name;
  currentView = name;
  sheetScroll.scrollTop = 0;
  if (state) setSheet(state);
  else updateInsets();
}

// "‹ Back" buttons
sheet.addEventListener("click", (e) => {
  if (e.target.closest("[data-back]")) {
    if (currentView === "place") clearSelection();
    showView("home", "half");
  }
});

// Small HTML helpers
function badge(place, iconName) {
  const color = CATEGORY_COLORS[place.category] || "#6b7280";
  return `<span class="mini-badge" style="--c:${color}">${iconSvg(iconName || placeIcon(place))}</span>`;
}
function friendlyDistance(m) {
  if (m < 15) return "Right here";
  return m < 1000 ? `${Math.round(m / 10) * 10} m away` : `${(m / 1000).toFixed(1)} km away`;
}
function placeRowHtml(place, sub) {
  return `<li class="row" data-place="${place.id}" tabindex="0" role="button">${badge(place)}<span class="row-text"><strong>${escapeHtml(place.name)}</strong><span>${escapeHtml(sub || "")}</span></span></li>`;
}

// Any element with data-place opens that place (tiles, rows)
sheet.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go-to]");
  if (go) {
    startDirections(placesById[go.dataset.goTo], placesById[go.dataset.goFrom]);
    return;
  }
  const dirBtn = e.target.closest("[data-directions]");
  if (dirBtn) {
    const place = placesById[dirBtn.dataset.directions];
    if (place) startDirections(place);
    return;
  }
  const el = e.target.closest("[data-place]");
  if (el && placesById[el.dataset.place]) focusPlace(placesById[el.dataset.place]);
});
// Rows are focusable: Enter opens them too
sheet.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches(".row[data-place]")) e.target.click();
});

// ---------- Home ----------
const searchInput = $("searchInput");
// Typing needs room: open the sheet fully while searching
searchInput.addEventListener("focus", () => setSheet("full"));

function renderHome() {
  $("categoryChips").innerHTML = CATEGORY_TILES.map((t) =>
    `<button class="cat-chip" data-tile="${t.id}"><span class="mini-badge" style="--c:${CATEGORY_COLORS[t.cat]}">${iconSvg(t.icon)}</span>${t.label}</button>`
  ).join("");

  const popular = POPULAR_IDS.map((id) => placesById[id]).filter(Boolean);
  $("popularList").innerHTML = popular.length
    ? popular.map((p) => placeRowHtml(p, p.group || CATEGORY_LABELS[p.category])).join("")
    : `<li class="row-empty">Popular places will show here once the map has loaded.</li>`;
  $("popularList").removeAttribute("aria-busy");

  renderRecent();
}

$("categoryChips").addEventListener("click", (e) => {
  const tile = CATEGORY_TILES.find((t) => t.id === e.target.closest("[data-tile]")?.dataset.tile);
  if (tile) openCategory(tile);
});
$("footReport").addEventListener("click", () => openReport({}));

// "Popular routes": every recorded route (connectors are only used inside stitched routes),
// plus Main Gate Entry routes that work by joining the Entry Gate walkway
const STITCHED_CARDS = [["main-gate-entry", "division-of-admission-block"], ["main-gate-entry", "uni-mall"]];

function onRoutesLoaded() {
  const cards = [];
  for (const r of routes) {
    if (isUsable(r) && placesById[r.from] && placesById[r.to]) cards.push({ from: placesById[r.from], to: placesById[r.to], route: asRoute(r) });
  }
  for (const [fromId, toId] of STITCHED_CARDS) {
    const stitched = placesById[fromId] && placesById[toId] && findStitched(fromId, toId);
    if (stitched) cards.push({ from: placesById[fromId], to: placesById[toId], route: stitched });
  }

  const list = $("routeList");
  list.innerHTML = cards.length
    ? cards.map(({ from, to, route }) => {
        const metres = pathLength(route.path); // worked out from the path points
        return `<li class="route-card">${badge(to)}
          <span class="row-text"><strong>${escapeHtml(from.name)} to ${escapeHtml(to.name)}</strong>
          <span>${fmtDistance(metres)} · ${fmtWalk(metres)}</span></span>
          <button class="btn btn-small btn-primary go-btn" data-go-from="${from.id}" data-go-to="${to.id}" aria-label="Go from ${escapeHtml(from.name)} to ${escapeHtml(to.name)}">Go</button></li>`;
      }).join("")
    : `<li class="row-empty">No walking routes recorded yet. Search for a place and we'll point you in the right direction.</li>`;
  list.removeAttribute("aria-busy");
}

// Recently viewed (last 5, newest first)
function loadRecent() {
  try {
    const ids = JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
    return Array.isArray(ids) ? ids.filter((id) => placesById[id]) : [];
  } catch (e) {
    return [];
  }
}
function addRecent(id) {
  const ids = [id, ...loadRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids)); } catch (e) {}
  renderRecent();
}
function renderRecent() {
  const ids = loadRecent();
  $("recentWrap").hidden = !ids.length;
  $("recentList").innerHTML = ids.map((id) => {
    const p = placesById[id];
    return placeRowHtml(p, p.group);
  }).join("");
}

// ---------- Category list ----------
let openTile = null;

function openCategory(tile) {
  openTile = tile;
  $("catTitle").textContent = tile.label;
  const fresh = lastKnownPos && Date.now() - lastKnownTime < 5 * 60 * 1000 && isOnCampus(lastKnownPos);
  renderCategory(fresh ? lastKnownPos : null);
  showView("category", "half");

  // Show only this category on the map and bring it into view
  mapFocus = tile.match;
  updateTiers();
  const matches = allPlaces.filter(tile.match);
  if (matches.length) fitTo(L.latLngBounds(matches.map((p) => [p.lat, p.lng])));

  // No recent location: ask quietly, re-sort if it arrives
  if (!fresh && "geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
        showMyPosition(ll, pos.coords.accuracy);
        if (openTile === tile && currentView === "category" && isOnCampus(ll)) renderCategory(ll);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }
}

// Closest first if we know where you are, otherwise A–Z
function renderCategory(here) {
  const places = allPlaces.filter(openTile.match).map((p) => ({ p, d: here ? map.distance(here, [p.lat, p.lng]) : null }));
  if (here) places.sort((a, b) => a.d - b.d);
  $("catHint").textContent = here
    ? `${places.length} places · closest to you first`
    : `${places.length} places · A to Z. Turn on location to see the closest first.`;
  $("catList").innerHTML = places.length
    ? places.map(({ p, d }) =>
        `<li class="row" data-place="${p.id}">${badge(p)}
          <span class="row-text"><strong>${escapeHtml(p.name)}</strong><span>${d != null ? friendlyDistance(d) : escapeHtml(p.group || "")}</span></span>
          <button class="btn btn-small btn-primary" data-directions="${p.id}">Directions</button></li>`).join("")
    : `<li class="row-empty">Nothing here yet. Try searching for the place instead.</li>`;
}

// ---------- Place sheet (app.js calls openCard via focusPlace) ----------
let cardPlace = null;

function openCard(place) {
  cardPlace = place;
  logEvent("place_opened", { place_id: place.id }); // test mode (help.js)
  addRecent(place.id);
  const color = CATEGORY_COLORS[place.category] || "#6b7280";

  // Photo, or a calm placeholder with the place's icon
  const wrap = $("photoWrap");
  const img = $("placePhoto");
  wrap.classList.toggle("no-photo", !place.photo);
  if (place.photo) {
    img.src = place.photo;
    img.alt = `Photo of ${place.name}`;
  } else {
    img.removeAttribute("src");
  }
  $("photoIcon").className = "photo-icon mini-badge";
  $("photoIcon").style.setProperty("--c", color);
  $("photoIcon").innerHTML = iconSvg(placeIcon(place));

  const catChip = $("placeCategory");
  catChip.textContent = CATEGORY_LABELS[place.category] || place.category;
  catChip.style.setProperty("--c", color);
  $("placeGroup").textContent = place.group || "";
  $("placeGroup").hidden = !place.group || place.group === catChip.textContent;

  $("placeName").textContent = place.name;
  const facts = [];
  // "Block 34", but skip blocks the name already says (e.g. "Law" for Law Block)
  const block = String(place.block || "").trim();
  if (block && !place.name.toLowerCase().includes(block.toLowerCase())) facts.push(`Block ${block}`);
  if (place.floor) facts.push(`Floor ${place.floor}`);
  $("placeFacts").textContent = facts.join(" · ");
  $("placeLandmark").textContent = place.landmark_note || "";

  // 3 closest places
  $("nearbyRow").innerHTML = nearestPlaces([place.lat, place.lng], 3, place.id)
    .map(({ place: p, dist }) => placeRowHtml(p, friendlyDistance(dist)))
    .join("");

  showView("place", "half");
}

function clearSelection() {
  if (selectedId) {
    selectedId = null;
    updateTiers();
  }
}

// Leave the place sheet (map tap, Escape, starting directions, I'm lost)
function closeCard() {
  clearSelection();
  if (dir.active) return;
  if (currentView === "place") showView("home", "peek");
  else if (currentView === "home" && sheetState !== "peek" && document.activeElement !== searchInput) setSheet("peek");
}

$("placePhoto").addEventListener("error", () => $("photoWrap").classList.add("no-photo"));
$("directionsBtn").addEventListener("click", () => cardPlace && startDirections(cardPlace));
$("cardReport").addEventListener("click", () => cardPlace && openReport({ place_id: cardPlace.id }));
$("shareBtn").addEventListener("click", () => cardPlace && sharePlace(cardPlace));

// Share: the phone's share menu if it has one, otherwise copy a link
async function sharePlace(place) {
  const url = `${location.origin}${location.pathname}#place=${place.id}`;
  if (navigator.share) {
    try { await navigator.share({ title: place.name, text: `${place.name} on the LPU campus map`, url }); } catch (e) {}
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link copied. Paste it in a chat to share this place.");
  } catch (e) {
    location.hash = `place=${place.id}`;
    showToast("We couldn't copy the link. You can copy it from the address bar instead.", 5000);
  }
}

// ---------- Arrival screen (routes.js calls showArrived) ----------
function showArrived(on) {
  $("arrivedBox").hidden = !on;
  $("stepCard").hidden = on;
  $("startWalkBtn").hidden = on;
  $("cancelDir").hidden = on;
  if (on) $("offRoute").hidden = true;
  if (!on || !dir.to) return;

  $("arrivedTitle").textContent = `You've arrived at ${dir.to.name}`;
  $("helpfulBtns").hidden = false;
  $("helpfulThanks").hidden = true;
  $("seeStepsBtn").hidden = !dir.hasRoute;
  if (dir.walking) stopWalking();
  setSheet("half");
}

// "Was this helpful?" goes to the feedback log
$("helpfulBtns").addEventListener("click", (e) => {
  const answer = e.target.closest("[data-helpful]")?.dataset.helpful;
  if (!answer) return;
  saveFeedback({
    category: answer === "yes" ? "Helpful: yes" : "Helpful: no",
    note: "",
    place_id: dir.to?.id || "",
    route_id: dir.routeId || "no route",
    step_index: "",
  });
  $("helpfulBtns").hidden = true;
  $("helpfulThanks").hidden = false;
});
$("backToMapBtn").addEventListener("click", () => cancelDirections());
$("seeStepsBtn").addEventListener("click", () => goStep(-1));

// Tapping anywhere else closes the Filters pop-up
document.addEventListener("click", (e) => {
  if (legend.classList.contains("open") && !legend.contains(e.target)) {
    legend.classList.remove("open");
    filtersBtn.setAttribute("aria-expanded", "false");
  }
});

// ---------- Keyboard ----------
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !helpSheet.hidden || !reportSheet.hidden) return;
  if (currentView === "place") closeCard();
  else if (currentView === "category") showView("home", "half");
});

// ---------- Start-up ----------
// Called by app.js once places.json has loaded
function onUiPlacesLoaded() {
  renderHome();
  // Shared link: #place=central-library opens that place
  const match = location.hash.match(/^#place=([\w-]+)/);
  if (match && placesById[match[1]]) setTimeout(() => focusPlace(placesById[match[1]]), 300);
}

setSheet("half");
