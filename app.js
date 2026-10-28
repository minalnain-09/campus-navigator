// LPU Campus Navigator
// Plain JavaScript + Leaflet. No backend, no API keys.

// ---------- Version check ----------
// If the browser mixes an old cached page with new scripts (or the other way round),
// features break in odd ways. Spot it and ask for a refresh instead.
const APP_VERSION = "2026-10-28.1";
const PAGE_VERSION = document.querySelector('meta[name="app-version"]')?.content;
if (PAGE_VERSION !== APP_VERSION) {
  console.warn("Page version", PAGE_VERSION, "≠ script version", APP_VERSION, "— stale cached files");
  window.addEventListener("load", () => {
    const msg = document.createElement("div");
    msg.className = "update-banner";
    msg.innerHTML = 'The app was updated. <button type="button">Refresh</button>';
    msg.querySelector("button").addEventListener("click", () => location.reload());
    document.body.appendChild(msg);
  });
}

// ---------- Settings ----------
const CAMPUS_CENTER = [31.2534, 75.7035]; // middle of all places; used until places.json loads
const CAMPUS_ZOOM = 16;

// One colour per category — keep in sync with the CSS variables in style.css
const CATEGORY_COLORS = {
  academic: "#2563eb",
  food: "#f59e0b",
  hostel: "#8b5cf6",
  admin: "#0f766e",
  sports: "#16a34a",
  help: "#dc2626",
};

// ---------- Icons ----------
// Lucide-style line icons (24×24, drawn with the current text colour).
// Used on map badges, legend chips and the place card so they always match.
const ICON_PATHS = {
  gate: '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.56v16.16a1 1 0 0 1-1.24.97L5 20V5.56a2 2 0 0 1 1.52-1.94l4-1A2 2 0 0 1 13 4.56Z"/>',
  library: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  academic: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/><path d="M22 10v6"/>',
  auditorium: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  food: '<path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3Zm0 0v7"/>',
  hostel: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
  health: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  admin: '<path d="M3 22h18"/><path d="M6 18v-7"/><path d="M10 18v-7"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M12 2l8 5H4z"/>',
  mall: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  sports: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  park: '<path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z"/><path d="M12 22v-3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  pin: '<path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M12 6h.01"/><path d="M16 6h.01"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/>',
};

// Icon to use when a place has no "icon" field, and for legend chips
const CATEGORY_ICONS = {
  academic: "academic",
  food: "food",
  hostel: "hostel",
  admin: "admin",
  sports: "sports",
  help: "health",
};

// Returns an inline <svg> string; size comes from CSS
function iconSvg(type) {
  const paths = ICON_PATHS[type] || ICON_PATHS.building;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function placeIcon(place) {
  return place.icon || CATEGORY_ICONS[place.category] || "building";
}

// Static icons in the page
document.getElementById("searchIcon").innerHTML = iconSvg("search");
document.getElementById("gearIcon").innerHTML = iconSvg("gear");

// ---------- Grab page elements ----------
const toastEl = document.getElementById("toast");
const adminToggle = document.getElementById("adminToggle");
const locateBtn = document.getElementById("locateBtn");

// ---------- Create the map ----------
const map = L.map("map", {
  zoomControl: false, // we hide +/- buttons; pinch-zoom still works
  minZoom: 14, // tightened to "the whole campus" once places load (fitCampus)
  // Whole zoom steps only: in-between zooms leave hairline gaps between map tiles in Chrome
  maxBoundsViscosity: 1.0, // panning stops firmly at the edge (bounds set once places load)
}).setView(CAMPUS_CENTER, CAMPUS_ZOOM);

// People who ask their phone for less motion get instant jumps instead of flights
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const fly = map.flyTo.bind(map);
  const flyBounds = map.flyToBounds.bind(map);
  map.flyTo = (c, z, o = {}) => fly(c, z, { ...o, animate: false });
  map.flyToBounds = (b, o = {}) => flyBounds(b, { ...o, animate: false });
}

// Draw name pills *under* the badges (Leaflet's default is above), so a long
// pill never hides the next badge when places are close together
map.getPane("tooltipPane").style.zIndex = 550;

// ---------- Base layers: Map (OpenStreetMap) and Satellite (Esri) ----------
// Leaflet swaps the attribution text automatically when a layer is added/removed
const streetLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors",
});

const satelliteLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution:
      "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  }
);

const mapLayerBtn = document.getElementById("mapLayerBtn");
const satLayerBtn = document.getElementById("satLayerBtn");

function setBaseLayer(name) {
  const satellite = name === "satellite";
  map.removeLayer(satellite ? streetLayer : satelliteLayer);
  (satellite ? satelliteLayer : streetLayer).addTo(map);

  mapLayerBtn.classList.toggle("active", !satellite);
  satLayerBtn.classList.toggle("active", satellite);
  mapLayerBtn.setAttribute("aria-pressed", String(!satellite));
  satLayerBtn.setAttribute("aria-pressed", String(satellite));
  document.body.classList.toggle("satellite-on", satellite);
  styleAccuracyCircle();

  // Remember the choice for next visit (ignore if storage is blocked)
  try { localStorage.setItem("baseLayer", name); } catch (e) {}
}

mapLayerBtn.addEventListener("click", () => setBaseLayer("map"));
satLayerBtn.addEventListener("click", () => setBaseLayer("satellite"));

// ---------- Small helper: make text safe to put inside HTML ----------
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------- Small helper: show a message for a few seconds ----------
let toastTimer;
function showToast(html, ms = 3000) {
  toastEl.innerHTML = html;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

// ---------- Legend = category filters ----------
// Each chip shows/hides one category. On phones the chips fold into a "Filters" button.
const legend = document.getElementById("legend");
const legendChips = document.getElementById("legendChips");
const filtersBtn = document.getElementById("filtersBtn");
const hiddenCats = new Set(); // categories switched off

for (const [cat, color] of Object.entries(CATEGORY_COLORS)) {
  legendChips.insertAdjacentHTML(
    "beforeend",
    `<button class="legend-item" data-cat="${cat}" aria-pressed="true"><span class="mini-badge" style="--c:${color}">${iconSvg(CATEGORY_ICONS[cat])}</span>${cat}</button>`
  );
}

legendChips.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-cat]");
  if (!chip) return;
  const cat = chip.dataset.cat;
  if (hiddenCats.has(cat)) hiddenCats.delete(cat);
  else hiddenCats.add(cat);
  chip.setAttribute("aria-pressed", String(!hiddenCats.has(cat)));
  const count = document.getElementById("filtersCount");
  count.hidden = !hiddenCats.size;
  count.textContent = `${hiddenCats.size} off`;
  updateTiers();
});

filtersBtn.addEventListener("click", () => {
  const open = !legend.classList.contains("open");
  legend.classList.toggle("open", open);
  filtersBtn.setAttribute("aria-expanded", String(open));
});

// "All places" switch: show every pin whatever the zoom (off by default)
legendChips.insertAdjacentHTML(
  "beforeend",
  `<label class="legend-item legend-toggle"><input type="checkbox" id="allPlacesToggle" />All places</label>`
);
let showAll = false;
document.getElementById("allPlacesToggle").addEventListener("change", (e) => {
  showAll = e.target.checked;
  updateTiers();
});

// ---------- Pin tiers ----------
// Priority 1 always shows, priority 2 from zoom 17, priority 3 from 18
const TIER_MIN_ZOOM = { 1: 0, 2: 17, 3: 18 };
const BLOCKS_ZOOM = 18; // below this, block groups collapse into one group pin

// Places in these groups are replaced by a single group pin when zoomed out
const GROUP_PINS = {
  "CSE Blocks": "CSE Blocks",
  "Biotech / Agriculture Blocks": "Biotech Blocks",
};

const placeEntries = []; // { place, marker }
const groupEntries = []; // { marker }
let selectedId = null;
const pinnedIds = new Set(); // places that must stay visible (e.g. a route's start and end)
let helpPinId = null; // help point shown by "I'm lost" (help.js), also kept visible
const routeEndIds = new Set(); // directions' start + destination: drawn as Start/End markers, so their pins hide

// Icon badge for a place. The outer box is a fixed 36px tap target that keeps
// the badge centred on its spot while CSS grows/shrinks the badge with zoom.
// --c holds the category colour for the badge background and pulse ring.
const PIN_BOX = 44;
function makeIcon(place) {
  const color = CATEGORY_COLORS[place.category] || "#6b7280";
  return L.divIcon({
    className: "pin-wrap", // replaces Leaflet's default white square
    html: `<div class="place-marker" style="--c:${color}">${iconSvg(placeIcon(place))}</div>`,
    iconSize: [PIN_BOX, PIN_BOX],
    iconAnchor: [PIN_BOX / 2, PIN_BOX / 2],
  });
}

// Name pill to the right of a badge. CSS shows it based on zoom + priority
// (p1 from zoom 16, everything from 18) and spaces it from the badge edge.
function bindNamePill(marker, text, priority) {
  marker.bindTooltip(text, {
    permanent: true,
    direction: "right",
    offset: [0, 0],
    className: `place-label p${priority}`,
  });
}

function addPlaceMarker(place) {
  const marker = L.marker([place.lat, place.lng], {
    icon: makeIcon(place),
    title: place.name,
    alt: place.name,
  });

  bindNamePill(marker, place.name, place.priority || 2);

  marker.on("click", (e) => {
    // In admin mode, pass the tap to the map's coordinate picker instead
    if (adminToggle.checked) {
      map.fire("click", { latlng: e.latlng });
      return;
    }
    // While directions are showing, don't open a second sheet on top
    if (document.body.classList.contains("directions-on")) {
      showToast(escapeHtml(place.name));
      return;
    }
    focusPlace(place);
  });

  placeEntries.push({ place, marker });
}

// One pin standing in for a whole group of blocks, e.g. "CSE Blocks (11)"
function addGroupPin(label, places) {
  const bounds = L.latLngBounds(places.map((p) => [p.lat, p.lng]));
  const avgLat = places.reduce((s, p) => s + p.lat, 0) / places.length;
  const avgLng = places.reduce((s, p) => s + p.lng, 0) / places.length;
  const color = CATEGORY_COLORS[places[0].category] || "#6b7280";

  const marker = L.marker([avgLat, avgLng], {
    // Building badge with the number of blocks in a small corner bubble
    icon: L.divIcon({
      className: "pin-wrap",
      html: `<div class="place-marker group-marker" style="--c:${color}">${iconSvg("building")}<span class="group-count">${places.length}</span></div>`,
      iconSize: [PIN_BOX, PIN_BOX],
      iconAnchor: [PIN_BOX / 2, PIN_BOX / 2],
    }),
    title: `${label} (${places.length})`,
    alt: `${label} (${places.length})`,
  });

  bindNamePill(marker, `${label} (${places.length})`, 1); // labelled like the most important pins

  // Tap: zoom in far enough (18+) that the individual blocks appear
  marker.on("click", (e) => {
    if (adminToggle.checked) {
      map.fire("click", { latlng: e.latlng });
      return;
    }
    const fitZoom = map.getBoundsZoom(bounds, false, L.point(60, 60));
    map.flyTo(bounds.getCenter(), Math.max(fitZoom, BLOCKS_ZOOM), { duration: 0.8 });
  });

  groupEntries.push({ marker, category: places[0].category });
}

// Places that must show whatever the zoom or filters (selected, route ends, help point)
let mapFocus = null; // a test like (place) => place.category === "food"; null = show everything.
// While set, every matching place shows whatever the zoom (the category list is open).

function isSpecial(place) {
  return place.id === selectedId || place.id === helpPinId || pinnedIds.has(place.id);
}

// Add or remove pins and set label classes for the current zoom
function updateTiers() {
  const zoom = map.getZoom();

  for (const { place, marker } of placeEntries) {
    const minZoom = TIER_MIN_ZOOM[place.priority] ?? TIER_MIN_ZOOM[2];
    const focused = !mapFocus || mapFocus(place);
    const visible = !routeEndIds.has(place.id) &&
      (isSpecial(place) || (focused && !hiddenCats.has(place.category) && (showAll || !!mapFocus || zoom >= minZoom)));
    if (visible && !map.hasLayer(marker)) marker.addTo(map);
    if (!visible && map.hasLayer(marker)) map.removeLayer(marker);
  }

  // Group pins only when zoomed out, not showing everything, and their category is on
  const groupsVisible = !showAll && zoom < BLOCKS_ZOOM;
  for (const { marker, category } of groupEntries) {
    const visible = groupsVisible && !hiddenCats.has(category) && (!mapFocus || mapFocus({ category }));
    if (visible && !map.hasLayer(marker)) marker.addTo(map);
    if (!visible && map.hasLayer(marker)) map.removeLayer(marker);
  }

  // Container classes drive badge size and which name pills CSS shows
  const el = map.getContainer();
  el.classList.toggle("pins-small", zoom < 16); // 24px when the whole campus is in view
  el.classList.toggle("pins-large", zoom >= 17); // 36px (28px in between)
  el.classList.toggle("labels-p1", zoom >= 16); // names: priority 1 from 16,
  el.classList.toggle("labels-p2", zoom >= 17); // priority 2 from 17,
  el.classList.toggle("labels-all", zoom >= 18); // everything from 18

  refreshSelected(); // re-added pins get a fresh element, so re-apply the highlight
  requestAnimationFrame(declutterLabels);
}
map.on("zoomend", updateTiers);

// ---------- Label collisions ----------
// When two name pills overlap, keep only the more important one.
// Order: selected/route ends/help point, then priority 1, then group pins, then 2, then 3.
function labelRank(place) {
  if (!place) return 1.5; // group pin: after priority-1 places, before priority 2
  if (isSpecial(place)) return 0;
  return place.priority || 2;
}

function declutterLabels() {
  const labels = [];
  for (const { place, marker } of placeEntries) labels.push({ el: marker.getTooltip()?.getElement(), rank: labelRank(place) });
  for (const { marker } of groupEntries) labels.push({ el: marker.getTooltip()?.getElement(), rank: labelRank(null) });

  // Measure every pill that CSS currently shows
  const shown = [];
  for (const l of labels) {
    if (!l.el || !l.el.isConnected) continue;
    l.el.classList.remove("label-hidden");
    const r = l.el.getBoundingClientRect();
    if (r.width && r.height) shown.push({ ...l, r });
  }

  // Greedy: most important first; hide anything that touches a pill already kept
  shown.sort((a, b) => a.rank - b.rank);
  const kept = [];
  const GAP = 2;
  for (const l of shown) {
    const hit = kept.some((k) =>
      l.r.left < k.r.right + GAP && l.r.right + GAP > k.r.left && l.r.top < k.r.bottom + GAP && l.r.bottom + GAP > k.r.top);
    if (hit) l.el.classList.add("label-hidden");
    else kept.push(l);
  }
}

// Highlight the selected pin (bigger + pulse) and keep it on top
function refreshSelected() {
  for (const { place, marker } of placeEntries) {
    const isSelected = place.id === selectedId;
    marker.setZIndexOffset(isSelected ? 1000 : 0);
    const badge = marker.getElement()?.querySelector(".place-marker");
    if (badge) badge.classList.toggle("selected", isSelected);
    // Push its name pill out to clear the bigger badge
    const pill = marker.getTooltip()?.getElement();
    if (pill) pill.classList.toggle("label-selected", isSelected);
  }
}

// Select a place: open its card, fly to it (zoom 18+ so hidden pins appear) and highlight it.
// Used by marker taps and the search bar.
function focusPlace(place) {
  selectedId = place.id;
  openCard(place);
  updateTiers(); // shows the pin straight away, even before zooming in
  flyToPlace(place);
}

// Handy for testing in the browser console: focusPlaceById("block-28")
window.focusPlaceById = (id) => {
  const entry = placeEntries.find((e) => e.place.id === id);
  if (entry) focusPlace(entry.place);
  else console.warn("No place with id", id);
};

// Fly to a place so it lands in the part of the map not covered by the sheet
function flyToPlace(place) {
  flyToVisible(L.latLng(place.lat, place.lng), Math.max(map.getZoom(), 18));
}

// The place sheet (openCard / closeCard) lives in ui.js

// ---------- Fit the map to all places ----------
let placesBounds = null; // set once places.json has loaded

function fitCampus(animate) {
  // Before places load, fall back to the fixed campus centre
  if (!placesBounds) {
    map.flyTo(CAMPUS_CENTER, CAMPUS_ZOOM, { duration: 0.8 });
    return;
  }
  // Keep the campus clear of the sheet and the floating buttons (routes.js)
  const p = coveredPadding();
  const opts = { paddingTopLeft: p.tl, paddingBottomRight: p.br };
  if (animate) {
    map.flyToBounds(placesBounds, { ...opts, duration: 0.8 });
    return;
  }
  // Work out the zoom that fits the campus into the visible area first (the zoom a
  // fit animates to isn't readable until it finishes); you can't zoom out past it
  map.setMinZoom(13);
  const fitZoom = map.getBoundsZoom(placesBounds, false, p.tl.add(p.br));
  map.setMinZoom(Math.max(13, Math.min(16, fitZoom)));
  map.fitBounds(placesBounds, { ...opts, animate: false });
}

// Soft campus outline: a rounded shape around all places (each place gets a 60 m
// circle; the outline is the convex hull of those circles), drawn under everything else
function drawCampusBoundary(places) {
  const R = 60; // metres of breathing room around the outermost places
  const lat0 = CAMPUS_CENTER[0];
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, ky = 110540;
  const pts = [];
  for (const p of places) {
    for (let a = 0; a < 360; a += 20) {
      const r = (a * Math.PI) / 180;
      pts.push([p.lng * kx + R * Math.cos(r), p.lat * ky + R * Math.sin(r)]);
    }
  }
  // Convex hull (monotone chain) in metres
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const h = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  const hull = half(pts).concat(half(pts.slice().reverse()));
  L.polygon(hull.map(([x, y]) => [y / ky, x / kx]), {
    color: "#ea580c",
    weight: 1.5,
    opacity: 0.6,
    fillColor: "#f97316",
    fillOpacity: 0.08,
    interactive: false,
  }).addTo(map);
}

// ---------- Load places.json ----------
fetch("places.json", { cache: "no-cache" }) // always check for a newer copy
  .then((res) => {
    if (!res.ok) throw new Error(res.status);
    return res.json();
  })
  .then((places) => {
    places.forEach(addPlaceMarker);

    // Build one group pin per block group
    for (const [group, label] of Object.entries(GROUP_PINS)) {
      const members = places.filter((p) => p.group === group);
      if (members.length) addGroupPin(label, members);
    }

    if (places.length) {
      placesBounds = L.latLngBounds(places.map((p) => [p.lat, p.lng]));
      drawCampusBoundary(places);
      // Keep panning inside a box a little bigger than the campus
      map.setMaxBounds(placesBounds.pad(0.2));
      fitCampus(false);
    }
    updateTiers();
    onPlacesLoaded(places); // routes.js: fills dropdowns and loads routes.json
    onUiPlacesLoaded(places); // ui.js: home panel lists, shared links
  })
  .catch((err) => {
    console.warn("places.json didn't load. Is the app running from a local server? (see README)", err);
    showToast("We couldn't load the campus places. Please check your internet and refresh the page.", 8000);
  });

// ---------- Locate me ----------
let meMarker = null;
let accuracyCircle = null;

// Brighter outline on satellite so the circle stands out on dark imagery
function styleAccuracyCircle() {
  if (!accuracyCircle) return;
  const satellite = map.hasLayer(satelliteLayer);
  accuracyCircle.setStyle({
    color: satellite ? "#93c5fd" : "#2563eb",
    fillOpacity: satellite ? 0.25 : 0.15,
  });
}

// Friendly messages for GPS errors (shared with directions in routes.js)
function gpsErrorMessage(err) {
  const messages = {
    1: "No worries! Location access is off. You can turn it on in your browser settings to see where you are.",
    2: "We couldn't find your location right now. Try stepping outside or checking your GPS.",
    3: "Finding your location took too long. Please try again.",
  };
  return messages[err.code] || "Couldn't get your location.";
}

// True if a point is inside the area the map is allowed to show
function isOnCampus(latlng) {
  const limits = map.options.maxBounds;
  return !limits || limits.contains(latlng);
}

let lastKnownPos = null; // last GPS position, used by "I'm lost" → "I don't know"
let lastKnownAccuracy = Infinity; // metres
let lastKnownTime = 0; // when it was taken (ms)

// Draw (or move) the blue dot and its accuracy circle
function showMyPosition(latlng, accuracy) {
  lastKnownPos = L.latLng(latlng);
  lastKnownAccuracy = accuracy;
  lastKnownTime = Date.now();
  // Light-blue circle showing how accurate the GPS fix is (in metres)
  if (!accuracyCircle) {
    accuracyCircle = L.circle(latlng, {
      radius: accuracy,
      weight: 2,
      fillColor: "#3b82f6",
      interactive: false, // so admin-mode taps still reach the map
    }).addTo(map);
    styleAccuracyCircle();
  } else {
    accuracyCircle.setLatLng(latlng).setRadius(accuracy);
  }

  if (!meMarker) {
    meMarker = L.marker(latlng, {
      icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      interactive: false,
      zIndexOffset: 1000, // always on top of place markers
    }).addTo(map);
  } else {
    meMarker.setLatLng(latlng);
  }
  locateBtn.classList.add("active");
}

locateBtn.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    showToast("This browser can't share your location. Try searching for a place you can see instead.");
    return;
  }

  showToast("Finding you…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const latlng = [pos.coords.latitude, pos.coords.longitude];
      showMyPosition(latlng, pos.coords.accuracy);

      // Panning is locked to campus, so don't try to fly somewhere outside it
      if (!isOnCampus(latlng)) {
        showToast("You seem to be outside the campus. Your blue dot will appear once you're here.", 5000);
        return;
      }
      map.flyTo(latlng, Math.max(map.getZoom(), 17), { duration: 0.8 });
      showToast("You are here 👋");
    },
    (err) => showToast(gpsErrorMessage(err), 6000),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
});

// ---------- Recentre campus ----------
document.getElementById("recentreBtn").addEventListener("click", () => fitCampus(true));

// ---------- Admin mode: tap map to copy coordinates ----------
let adminPin = null;

adminToggle.addEventListener("change", () => {
  document.body.classList.toggle("admin-on", adminToggle.checked);
  if (adminToggle.checked) {
    closeCard();
    showToast("Admin mode on — tap the map to copy coordinates.");
  } else if (adminPin) {
    map.removeLayer(adminPin);
    adminPin = null;
  }
  onAdminChange(adminToggle.checked); // routes.js: show/hide the route recorder
});

map.on("click", (e) => {
  if (!adminToggle.checked) {
    closeCard(); // tapping empty map closes the card
    return;
  }

  // Route recorder open: taps add points to the route instead
  if (isRecording()) {
    addRecPoint(e.latlng);
    return;
  }

  const lat = e.latlng.lat.toFixed(6);
  const lng = e.latlng.lng.toFixed(6);
  const text = `"lat": ${lat}, "lng": ${lng}`;

  // Drop a small pin where you tapped
  if (adminPin) map.removeLayer(adminPin);
  // White ring keeps the pin visible on both map and satellite
  adminPin = L.circleMarker(e.latlng, { radius: 7, color: "#fff", weight: 3, fillColor: "#ff6b00", fillOpacity: 1 })
    .addTo(map)
    .bindPopup(`<code>${text}</code>`)
    .openPopup();

  // Copy to clipboard (works on https or localhost)
  if (navigator.clipboard) {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(`Copied! <code>${text}</code>`, 4000))
      .catch(() => showToast(`<code>${text}</code> (copy manually)`, 6000));
  } else {
    showToast(`<code>${text}</code> (copy manually)`, 6000);
  }
});

// ---------- Start-up: use the layer chosen last time (default: Map) ----------
let savedLayer = "map";
try { savedLayer = localStorage.getItem("baseLayer") || "map"; } catch (e) {}
setBaseLayer(savedLayer);
