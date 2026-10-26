// LPU Campus Navigator — Stage 3: walking routes, step cards and the admin route recorder.
// Loaded after app.js and uses its helpers (map, showToast, iconSvg, placeIcon, updateTiers, ...).

// ---------- Settings ----------
const USE_PLACE_GRAPH = true; // estimated routes: also chain ALL recorded routes (set false to use only the Entry Gate branch method)
const WALK_M_PER_MIN = 80; // average walking speed
const OFF_ROUTE_M = 40; // further than this from the line = "off the route"
const JOIN_MAX_M = 60; // from GPS, join a recorded route only if it's this close

// Look up a page element. If it's missing (e.g. an old cached page), hand back a spare
// detached element so the code carries on (the route still draws) and say so once.
const missingWarned = new Set();
const $ = (id) => {
  const el = document.getElementById(id);
  if (el) return el;
  if (!missingWarned.has(id)) {
    missingWarned.add(id);
    console.warn(`Page element #${id} is missing — is the browser using an old cached index.html?`);
  }
  return document.createElement(id === "fromInput" || id === "toInput" ? "input" : "div");
};

let allPlaces = []; // sorted by name, for dropdowns and the start chooser
const placesById = {};
let routes = []; // from routes.json

// Called by app.js once places.json has loaded
function onPlacesLoaded(places) {
  allPlaces = places.slice().sort((a, b) => a.name.localeCompare(b.name));
  for (const p of places) placesById[p.id] = p;
  fillRecSelects();

  // "no-cache": always check the server for a newer routes.json, so edits show up on the next
  // refresh (the local server doesn't tell the browser not to keep an old copy)
  fetch("routes.json", { cache: "no-cache" })
    .then((res) => (res.ok ? res.json() : []))
    .then((data) => { routes = Array.isArray(data) ? data : []; })
    .catch((err) => {
      // Usually a typo in routes.json (e.g. a missing comma). Say so instead of quietly
      // falling back to straight lines everywhere.
      console.error("routes.json couldn't be read. Check it for a JSON typo:", err);
      showToast("We couldn't read the walking routes, so you'll only see straight-line directions for now.", 8000);
      routes = [];
    })
    .finally(() => onRoutesLoaded()); // ui.js: "Popular routes" list
}

// ---------- Small geometry helpers ----------
function toLL(p) {
  return Array.isArray(p) ? L.latLng(p[0], p[1]) : L.latLng(p.lat, p.lng);
}

function pathLength(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += map.distance(path[i - 1], path[i]);
  return total;
}

// Compass bearing in degrees: 0 = north, 90 = east
function bearing(a, b) {
  a = toLL(a);
  b = toLL(b);
  const east = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180);
  const north = b.lat - a.lat;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
function compassWord(deg) {
  return COMPASS[Math.round(deg / 45) % 8];
}

// Metres from point p to the segment a–b (a flat map is accurate enough on campus)
function distToSegment(p, a, b) {
  const kx = Math.cos((p.lat * Math.PI) / 180) * 111320;
  const ky = 110540;
  const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
  const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

// Closest path point (index + distance) and distance to the line itself
function nearestOnPath(p, path) {
  p = toLL(p);
  let index = 0, pointDist = Infinity, lineDist = Infinity;
  path.forEach((q, i) => {
    const d = map.distance(p, q);
    if (d < pointDist) { pointDist = d; index = i; }
    if (i > 0) lineDist = Math.min(lineDist, distToSegment(p, toLL(path[i - 1]), toLL(q)));
  });
  if (path.length === 1) lineDist = pointDist;
  return { index, pointDist, lineDist };
}

function fmtDistance(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}
function fmtWalk(m) {
  return `${Math.max(1, Math.round(m / WALK_M_PER_MIN))} min walk`;
}

// ---------- Finding routes ----------
// Two kinds of entries in routes.json:
//  - normal routes: { from, to, path, steps }
//  - connectors: { type: "connector", from, joins, path, steps } — a short path from a place
//    that merges into the middle of another place's routes. Never shown or offered on their own.
const isConnector = (r) => r && r.type === "connector";

// Normal routes with at least 2 points (placeholders have none yet)
function isUsable(r) {
  return r && !isConnector(r) && Array.isArray(r.path) && r.path.length >= 2;
}
function usableConnectors() {
  return routes.filter((r) => isConnector(r) && r.from && r.joins && Array.isArray(r.path) && r.path.length >= 2);
}

// As a plain { id, path, steps } object
const asRoute = (r) => ({ id: r.id, path: r.path, steps: r.steps || [], reversed: false });

// Closest point on a path to p: which segment (i → i+1), the exact point, and how far away (m)
function projectOnPath(p, path) {
  p = toLL(p);
  const kx = Math.cos((p.lat * Math.PI) / 180) * 111320;
  const ky = 110540;
  let best = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = toLL(path[i]), b = toLL(path[i + 1]);
    const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
    const dx = (b.lng - a.lng) * kx, dy = (b.lat - a.lat) * ky;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const dist = Math.hypot(ax + t * dx, ay + t * dy);
    if (!best || dist < best.dist) {
      best = { seg: i, dist, point: [a.lat + t * (b.lat - a.lat), a.lng + t * (b.lng - a.lng)] };
    }
  }
  return best;
}

// Cut a route so it starts at a point projected onto segment `seg`.
// `lead` = points to put before it (e.g. a connector's path or your GPS position).
// Steps at or before the cut are dropped; later steps are re-indexed to the new path.
function joinRoute(route, proj, lead) {
  const tail = [proj.point, ...route.path.slice(proj.seg + 1)];
  // Avoid a zero-length step if the projected point sits exactly on the next recorded point
  if (tail.length > 2 && map.distance(tail[0], tail[1]) < 0.5) tail.splice(1, 1);
  const offset = lead.length; // index of the projected point in the new path
  const dropped = route.path.length - (tail.length - 1); // recorded points before the cut
  const steps = route.steps
    .filter((s) => s.at >= proj.seg + 1)
    .map((s) => ({ ...s, at: offset + s.at - dropped + 1 }));
  return { path: lead.concat(tail), steps };
}

// Connector + normal route = one stitched route. The join point is where the
// connector's last point meets the normal route (projected onto its nearest segment).
function stitch(connector, normal) {
  const proj = projectOnPath(connector.path[connector.path.length - 1], normal.path);
  const joined = joinRoute(asRoute(normal), proj, connector.path.slice());
  return {
    id: `${connector.id}+${normal.id}`,
    path: joined.path,
    steps: (connector.steps || []).concat(joined.steps),
    reversed: false,
  };
}

// The stitched route from → to, if a connector starts at `from` and its "joins" place has a route to `to`
function findStitched(fromId, toId) {
  for (const c of usableConnectors()) {
    if (c.from !== fromId) continue;
    const normal = routes.find((r) => isUsable(r) && r.from === c.joins && r.to === toId);
    if (normal) return stitch(c, normal);
  }
  return null;
}

// Route from → to: a direct route (either way round) first, then a stitched one (either way round)
function findRoute(fromId, toId) {
  const fwd = routes.find((r) => isUsable(r) && r.from === fromId && r.to === toId);
  if (fwd) return asRoute(fwd);
  const rev = routes.find((r) => isUsable(r) && r.from === toId && r.to === fromId);
  if (rev) return reverseRoute(rev);
  const stitched = findStitched(fromId, toId);
  if (stitched) return stitched;
  const stitchedBack = findStitched(toId, fromId);
  return stitchedBack ? reverseRoute(stitchedBack) : null;
}

// Flip a route. Uses "reverse_steps" if you've written them, otherwise mirrors the
// original steps: same spots, landmarks and photos, shown in reverse order.
function reverseRoute(r) {
  const n = r.path.length;
  const path = r.path.slice().reverse();
  const id = `${r.id}:reverse`; // how reversed routes appear in logs and reports
  if (Array.isArray(r.reverse_steps) && r.reverse_steps.length) {
    return { id, path, steps: r.reverse_steps, reversed: true, mirrored: false };
  }
  const steps = (r.steps || [])
    // Drop the old start (now the arrival point) and the old "arrived" step
    // (now the start); buildSteps adds a fresh start and arrival for this direction
    .filter((s) => s.at > 0 && s.at < n - 1)
    .map((s) => ({ ...s, at: n - 1 - s.at }))
    .sort((a, b) => a.at - b.at);
  return { id, path, steps, reversed: true, mirrored: true };
}

// Every route (direct, reversed or stitched) that ends at this place
function routesEndingAt(toId) {
  const out = [];
  for (const r of routes) {
    if (!isUsable(r)) continue;
    if (r.to === toId) out.push(asRoute(r));
    else if (r.from === toId) out.push(reverseRoute(r));
  }
  for (const c of usableConnectors()) {
    for (const r of routes) {
      if (!isUsable(r) || r.from !== c.joins) continue;
      if (r.to === toId) out.push(stitch(c, r)); // connector → walkway → destination
    }
    if (c.from === toId) {
      // Going *to* the connector's start: any stitched route through it, reversed
      for (const r of routes) if (isUsable(r) && r.from === c.joins) out.push(reverseRoute(stitch(c, r)));
    }
  }
  return out;
}

// From a GPS position: if you're within 60 m of a route that ends at the destination,
// join it at the nearest point on the path (projected, so no jump) and keep only the later steps
function routeFromPoint(latlng, toId) {
  let best = null;
  for (const r of routesEndingAt(toId)) {
    const proj = projectOnPath(latlng, r.path);
    if (!best || proj.dist < best.proj.dist) best = { r, proj };
  }
  if (!best || best.proj.dist > JOIN_MAX_M) return null;

  const { r, proj } = best;
  const needsLink = proj.dist > 8; // a short first leg from your dot to the path
  const joined = joinRoute(r, proj, needsLink ? [[latlng.lat, latlng.lng]] : []);
  if (needsLink) {
    joined.steps.unshift({ text: "Walk to the start of the blue line, then follow it.", at: 0, landmark: "", photo: "" });
  }
  return { id: r.id, path: joined.path, steps: joined.steps, reversed: r.reversed, mirrored: r.mirrored };
}

// ---------- Estimated routes (built from recorded paths) ----------
// Used when there's no recorded or stitched route. Every normal route is a "branch" that
// starts at its root (the Entry Gate). Each end of the trip gets an anchor on a branch:
//  - a route's destination → the end of that route
//  - a root place (the "from" of a route) → the start of any route
//  - anything else (or a GPS position) → the nearest point on any route, plus a dashed "gap"
// Then: same branch → the part between the anchors; different branches → walk back along one
// to where the two branches last ran together (the split point), then out along the other.
// No shortcuts between unrelated paths are ever invented.
const SPLIT_TOLERANCE = 25; // m: branches closer than this count as "the same path"
const SPLIT_SUSTAIN = 25; // m of path they must stay together for
const SPLIT_SEARCH = "backward"; // "backward" = last place the branches share (skips early detours);
// "forward" = first place they separate (the original rule; picks up short detours, see notes)
const SNAP_GPS_MAX_M = 60; // a GPS position must be this close to a recorded path
const FAR_GAP_M = 150; // gaps longer than this get "The last stretch isn't recorded yet"
const TURN_MIN_DEG = 35; // smaller bends aren't announced as turns
const MERGE_POINTS_M = 8; // points closer than this are merged when finding turns
const LANDMARK_M = 40; // a turn's landmark must be this close

// The branch method needs every branch to share one root. The main root is the place most
// routes start from (the Entry Gate). Routes that start elsewhere (e.g. Block 25 → Law Gate)
// are still used as direct routes, just not as branches for estimates.
function mainRoot() {
  const counts = {};
  for (const r of routes) if (isUsable(r)) counts[r.from] = (counts[r.from] || 0) + 1;
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
}
const isRoot = (id) => id === mainRoot();
const normalRoutes = () => {
  const root = mainRoot();
  return routes.filter((r) => isUsable(r) && r.from === root);
};

// The route path up to a cut point { seg, point }
function cutPath(cut) {
  const path = cut.route.path.slice(0, cut.seg + 1);
  if (map.distance(path[path.length - 1], cut.point) > 0.3) path.push(cut.point);
  return path;
}

// Where an end of the trip sits on the recorded network
function anchorFor(end, maxGap = Infinity) {
  if (!end.gps) {
    const dest = normalRoutes().find((r) => r.to === end.id);
    if (dest) {
      const n = dest.path.length;
      return { type: "cut", route: dest, seg: n - 2, point: dest.path[n - 1], gap: 0, pin: dest.path[n - 1] };
    }
    if (isRoot(end.id)) return { type: "root", gap: 0 };
  }
  // Snap to the nearest point on any route; ties go to the shorter route
  const pin = [end.lat, end.lng];
  let best = null;
  for (const r of normalRoutes()) {
    const proj = projectOnPath(pin, r.path);
    const len = pathLength(r.path);
    if (!best || proj.dist < best.proj.dist - 0.5 || (Math.abs(proj.dist - best.proj.dist) <= 0.5 && len < best.len)) {
      best = { r, proj, len };
    }
  }
  if (!best || best.proj.dist > maxGap) return null;
  return { type: "cut", route: best.r, seg: best.proj.seg, point: best.proj.point, gap: best.proj.dist, pin };
}

// Same branch: the part of the route between two cut points (either direction)
function subPath(a, b) {
  const posA = pathLength(cutPath(a)), posB = pathLength(cutPath(b));
  if (posA > posB) return subPath(b, a).reverse();
  return [a.point, ...a.route.path.slice(a.seg + 1, b.seg + 1), b.point];
}

// Different branches: the split point on RA (as an index into RA), see SPLIT_SEARCH
function findSplit(RA, RB) {
  const near = RA.map((v) => projectOnPath(v, RB).dist <= SPLIT_TOLERANCE);
  if (near[RA.length - 1]) return RA.length - 1; // the anchor itself is on RB's path
  const cum = [0];
  for (let i = 1; i < RA.length; i++) cum.push(cum[i - 1] + map.distance(RA[i - 1], RA[i]));
  if (SPLIT_SEARCH === "forward") {
    // First vertex where RA leaves RB for a sustained stretch → the vertex before it
    for (let i = 0; i < RA.length; i++) {
      let away = true;
      for (let j = i; j < RA.length && cum[j] - cum[i] <= SPLIT_SUSTAIN; j++) if (near[j]) { away = false; break; }
      if (away) return Math.max(0, i - 1);
    }
    return RA.length - 1;
  }
  // Backward: from the anchor towards the root, the first vertex that has been with RB for a sustained stretch
  for (let i = RA.length - 1; i >= 0; i--) {
    let together = true;
    for (let j = i; j >= 0 && cum[i] - cum[j] <= SPLIT_SUSTAIN; j--) if (!near[j]) { together = false; break; }
    if (together) return i;
  }
  return 0;
}

// Path between two anchors (no gaps yet). Returns { path, caseNo, split }
function corePath(A, B) {
  if (A.type === "root" && B.type === "root") return null;
  if (A.type === "root") return { path: cutPath(B), caseNo: 1, split: "root" };
  if (B.type === "root") return { path: cutPath(A).reverse(), caseNo: 1, split: "root" };
  if (A.route === B.route) return { path: subPath(A, B), caseNo: 4, split: "same route" };
  const RA = cutPath(A), RB = cutPath(B);
  const k = findSplit(RA, RB);
  const proj = projectOnPath(RA[k], RB);
  const path = RA.slice(k).reverse().concat([proj.point], RB.slice(proj.seg + 1));
  return { path, caseNo: 3, split: `${A.route.id}[${k}] → ${B.route.id}[seg ${proj.seg}]` };
}

// Remove repeated points (keeps bearings and step distances sane)
function dedupe(path) {
  const out = [path[0]];
  for (const p of path.slice(1)) if (map.distance(out[out.length - 1], p) > 0.3) out.push(p);
  return out;
}

const endName = (end) => (end.gps ? "your location" : end.name);
const endKey = (end) => (end.gps ? "my-location" : end.id);

// Estimated route from → to, or null. `light` skips the step text (for suggestion badges).
function branchEstimate(from, to, light = false) {
  if (!from || !to || (!from.gps && !to.gps && from.id === to.id)) return null;

  // Going TO a connector's start (Main Gate Entry): build it the other way round and flip it
  const toConn = !to.gps && usableConnectors().find((c) => c.from === to.id);
  const fromConn = !from.gps && usableConnectors().find((c) => c.from === from.id);
  if (toConn && !fromConn) {
    const back = branchEstimate(to, from, true);
    if (!back) return null;
    const n = back.path.length;
    const flipped = {
      ...back,
      path: back.path.slice().reverse(),
      gapSegs: new Set([...back.gapSegs].map((i) => n - 2 - i)),
      id: `estimated:${endKey(from)}__${endKey(to)}`,
    };
    if (!light) flipped.steps = generateSteps(flipped.path, from, to);
    return flipped;
  }

  const A = fromConn
    ? anchorFor({ gps: true, lat: fromConn.path[fromConn.path.length - 1][0], lng: fromConn.path[fromConn.path.length - 1][1] })
    : anchorFor(from, from.gps ? SNAP_GPS_MAX_M : Infinity);
  const B = anchorFor(to);
  if (!A || !B) return null;
  const core = corePath(A, B);
  if (!core) return null;

  let path = dedupe(core.path);
  const gapSegs = new Set();
  let caseNo = core.caseNo;
  if (fromConn) {
    path = dedupe(fromConn.path.concat(path)); // Main Gate Entry: the recorded connector first
    caseNo = 5;
  } else if (A.gap > 0.5) {
    path.unshift(A.pin); // dashed gap from your pin/position to the path
    gapSegs.add(0);
  }
  if (B.gap > 0.5) {
    path.push(B.pin); // dashed gap from the path to the destination pin
    gapSegs.add(path.length - 2);
  }

  const route = {
    id: `estimated:${endKey(from)}__${endKey(to)}`,
    path,
    gapSegs,
    estimated: true,
    far: Math.max(fromConn ? 0 : A.gap, B.gap) > FAR_GAP_M,
    steps: light ? [] : generateSteps(path, from, to),
  };
  return route;
}

// ---------- Place graph: chains ALL recorded routes, not just Entry Gate branches ----------
// Every normal route (and the Main Gate connector) is an edge between its two end places,
// usable both ways. Each route's start point is also hooked onto any other route that
// passes within 60 m (a "junction"), so e.g. Block 25's routes join the main walkway.
// Only route ends are hooked — recorded points are never merged by distance, so no
// shortcuts between unrelated paths are invented.
const GRAPH_SNAP_M = 60; // pins/route ends snap to a route within this distance
const GRAPH_CANDIDATES = 3; // snap candidates tried for each end of a trip
const LOOP_TOLERANCE = 15; // m: a path that comes back this close to itself has a loop to erase
const SIBLING_TOLERANCE = 10; // m: two routes from the same place count as one shared path only this close
// (paths 20+ m apart are often different walkways; linking them would invent shortcuts)
const GAP_COST_FACTOR = 2; // when choosing, an unrecorded gap "costs" double (shown distance stays real),
// so a recorded path wins over a straight jump across ground nobody has walked

// Position along a path of a projected point
function posAlong(path, proj) {
  let d = 0;
  for (let i = 0; i < proj.seg; i++) d += map.distance(path[i], path[i + 1]);
  return d + map.distance(path[proj.seg], proj.point);
}

// The parts of the graph that don't depend on the trip (rebuilt only when routes change)
let graphBase = null;
function getGraphBase() {
  if (graphBase && graphBase.routes === routes) return graphBase;
  const edges = [];
  for (const r of routes) {
    if (isUsable(r)) edges.push({ id: r.id, from: r.from, to: r.to, path: r.path });
    else if (isConnector(r) && r.from && Array.isArray(r.path) && r.path.length >= 2) {
      edges.push({ id: r.id, from: r.from, to: `end:${r.id}`, path: r.path }); // connector ends mid-walkway
    }
  }
  const nodes = new Set();
  for (const e of edges) { nodes.add(e.from); nodes.add(e.to); }
  // Junctions: each route is hooked into the network where it STARTS (its start point snapped
  // onto other routes within 60 m). A connector is hooked at its far end, where it joins the walkway.
  // Route ends aren't hooked: they connect through the place they arrive at.
  const junctions = []; // { edge: index, proj, node, point }
  edges.forEach((e, i) => {
    const hooks = [[e.from, e.path[0]]];
    if (e.to.startsWith("end:")) hooks.push([e.to, e.path[e.path.length - 1]]);
    for (const [node, point] of hooks) {
      edges.forEach((o, j) => {
        if (j === i || o.from === node || o.to === node) return;
        const proj = projectOnPath(point, o.path);
        if (proj.dist <= GRAPH_SNAP_M) junctions.push({ edge: j, proj, node, point });
      });
    }
  });
  // Routes from the same start place (e.g. Block 25's two routes) run together for a while:
  // link them at both ends of every stretch where they're within SIBLING_TOLERANCE
  const siblings = []; // { a: { edge, proj }, b: { edge, proj }, len }
  edges.forEach((A, i) => {
    edges.forEach((B, j) => {
      if (j <= i || A.from !== B.from) return;
      const near = A.path.map((v) => projectOnPath(v, B.path).dist <= SIBLING_TOLERANCE);
      for (let k = 0; k < A.path.length; k++) {
        const edgeOfStretch = near[k] && (k === 0 || !near[k - 1] || k === A.path.length - 1 || !near[k + 1]);
        if (!edgeOfStretch || k === 0) continue; // k = 0 is the shared start place itself
        const seg = Math.min(k, A.path.length - 2);
        const onA = { seg, point: A.path[k], dist: 0 };
        const onB = projectOnPath(A.path[k], B.path);
        siblings.push({ a: { edge: i, proj: onA }, b: { edge: j, proj: onB }, len: onB.dist });
      }
    });
  });
  graphBase = { routes, edges, nodes, junctions, siblings };
  return graphBase;
}

// Estimated route over the place graph, or null
function graphEstimate(from, to) {
  const base = getGraphBase();
  if (!base.edges.length) return null;
  const { edges, nodes } = base;
  const cuts = edges.map(() => []); // virtual nodes splitting each route
  const extra = []; // gap edges { a, b, path, len }
  let vid = 0;
  const addCut = (ei, proj) => {
    const id = `v${vid++}`;
    cuts[ei].push({ id, seg: proj.seg, point: proj.point, pos: posAlong(edges[ei].path, proj) });
    return id;
  };
  for (const j of base.junctions) {
    const v = addCut(j.edge, j.proj);
    extra.push({ a: j.node, b: v, path: [j.point, j.proj.point], len: j.proj.dist, gap: true, label: `junction ${j.node} ↔ ${edges[j.edge].id}` });
  }
  for (const sb of base.siblings) {
    // Two recordings of the same path: the link between them counts as recorded
    const va = addCut(sb.a.edge, sb.a.proj), vb = addCut(sb.b.edge, sb.b.proj);
    extra.push({ a: va, b: vb, path: [sb.a.proj.point, sb.b.proj.point], len: sb.len, gap: false, label: `shared stretch ${edges[sb.a.edge].id} ↔ ${edges[sb.b.edge].id}` });
  }

  // Each end of the trip: its own node if it's a route end, else up to 3 snap points within 60 m
  const endOptions = (end) => {
    if (!end.gps && nodes.has(end.id)) return [{ node: end.id, len: 0, path: null }];
    const pin = [end.lat, end.lng];
    const cands = edges.map((e, i) => ({ i, proj: projectOnPath(pin, e.path) })).sort((a, b) => a.proj.dist - b.proj.dist);
    let pick = cands.filter((c) => c.proj.dist <= GRAPH_SNAP_M).slice(0, GRAPH_CANDIDATES);
    if (!pick.length) {
      if (end.gps) return []; // GPS must be within 60 m of a recorded path
      pick = cands.slice(0, 1); // a far-away place still gets its nearest point (with a long gap)
    }
    return pick.map((c) => ({ node: addCut(c.i, c.proj), len: c.proj.dist, path: [pin, c.proj.point] }));
  };
  const starts = endOptions(from), ends = endOptions(to);
  if (!starts.length || !ends.length) return null;

  // Adjacency: route pieces between consecutive nodes (both directions) + gap edges
  const adj = new Map();
  const link = (a, b, path, len, gap, label) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, path, len, gap, label });
  };
  edges.forEach((e, i) => {
    const n = e.path.length;
    const seq = [{ id: e.from, seg: 0, point: e.path[0], pos: 0 }]
      .concat(cuts[i].slice().sort((a, b) => a.pos - b.pos))
      .concat([{ id: e.to, seg: n - 2, point: e.path[n - 1], pos: Infinity }]);
    for (let k = 0; k < seq.length - 1; k++) {
      const a = seq[k], b = seq[k + 1];
      const piece = dedupe([a.point, ...e.path.slice(a.seg + 1, b.seg + 1), b.point]);
      const len = pathLength(piece);
      link(a.id, b.id, piece, len, false, `${e.id} (forward)`);
      link(b.id, a.id, piece.slice().reverse(), len, false, `${e.id} (backward)`);
    }
  });
  for (const x of extra) {
    link(x.a, x.b, x.path, x.len, x.gap, x.label);
    link(x.b, x.a, x.path.slice().reverse(), x.len, x.gap, x.label);
  }
  const S = "__start", T = "__end";
  for (const s of starts) link(S, s.node, s.path, s.len, true, "from the start pin");
  for (const t of ends) link(t.node, T, t.path ? t.path.slice().reverse() : null, t.len, true, "to the destination pin");

  // Dijkstra from S to T
  const dist = new Map([[S, 0]]), prev = new Map(), done = new Set();
  while (true) {
    let u = null, best = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < best) { best = d; u = k; }
    if (u === null || u === T) break;
    done.add(u);
    for (const ed of adj.get(u) || []) {
      const nd = best + ed.len * (ed.gap ? GAP_COST_FACTOR : 1);
      if (nd < (dist.get(ed.to) ?? Infinity)) { dist.set(ed.to, nd); prev.set(ed.to, { from: u, ed }); }
    }
  }
  if (!prev.has(T)) return null;
  const chain = [];
  for (let k = T; k !== S; k = prev.get(k).from) chain.unshift(prev.get(k).ed);

  // Join the pieces; flags[i] says whether segment i → i+1 is an unrecorded gap
  let pts = [], flags = [];
  for (const ed of chain) {
    if (!ed.path || ed.path.length < 2) continue;
    ed.path.forEach((q, k) => {
      if (!pts.length) { pts.push(q); return; }
      if (map.distance(pts[pts.length - 1], q) <= 0.3) return; // same point twice
      // k === 0: the small step between two routes' end points (counted as recorded)
      flags.push(k === 0 ? false : ed.gap);
      pts.push(q);
    });
  }
  [pts, flags] = eraseLoops(pts, flags);
  if (pts.length < 2) return null;
  const gapSegs = new Set();
  flags.forEach((g, i) => { if (g && map.distance(pts[i], pts[i + 1]) > 0.5) gapSegs.add(i); });
  const longestGap = Math.max(0, ...[...gapSegs].map((i) => map.distance(pts[i], pts[i + 1])));
  const explain = chain.filter((ed) => ed.len > 0.5).map((ed) => `${ed.gap ? "GAP " : ""}${Math.round(ed.len)} m ${ed.label}`);
  return { path: pts, gapSegs, far: longestGap > FAR_GAP_M, explain };
}

// Cut out stretches where the path comes back within LOOP_TOLERANCE of an earlier point
// (e.g. walking out along a route and straight back again)
function eraseLoops(pts, flags) {
  pts = pts.slice(); flags = flags.slice();
  for (let i = 0; i < pts.length - 2; i++) {
    let along = 0, cut = -1;
    const arc = [0];
    for (let j = i + 1; j < pts.length; j++) arc.push(arc[arc.length - 1] + map.distance(pts[j - 1], pts[j]));
    for (let j = pts.length - 1; j > i + 1; j--) {
      along = arc[j - i];
      if (along > 3 * LOOP_TOLERANCE && map.distance(pts[i], pts[j]) < LOOP_TOLERANCE) { cut = j; break; }
    }
    if (cut > 0) {
      pts.splice(i + 1, cut - i - 1);
      flags.splice(i, cut - i, false); // the short join that replaces the loop
    }
  }
  return [pts, flags];
}

// Cost of a route: recorded metres + gap metres × GAP_COST_FACTOR
function routeCost(r) {
  let c = 0;
  for (let i = 0; i < r.path.length - 1; i++) {
    c += map.distance(r.path[i], r.path[i + 1]) * ((r.gapSegs || new Set()).has(i) ? GAP_COST_FACTOR : 1);
  }
  return c;
}

// Longest unrecorded gap in a route (m)
function longestGap(r) {
  return Math.max(0, ...[...(r.gapSegs || [])].map((i) => map.distance(r.path[i], r.path[i + 1])));
}

// Estimated route: whichever of the branch method and the place graph costs less.
// A branch result that needs a gap longer than the 60 m snap limit (a place far from any
// Entry Gate route, e.g. Girls Hostel 5/6) isn't trusted when the graph has an answer.
function estimateRoute(from, to, light = false) {
  const old = branchEstimate(from, to, light);
  if (light) return old || (USE_PLACE_GRAPH ? graphEstimate(from, to) : null);
  if (!USE_PLACE_GRAPH) return old && { ...old, method: "branch" };
  const g = graphEstimate(from, to);
  const oldTrusted = old && longestGap(old) <= GRAPH_SNAP_M;
  if (g && (!oldTrusted || routeCost(g) < routeCost(old) - 1)) {
    return {
      id: `estimated:${endKey(from)}__${endKey(to)}`,
      path: g.path,
      gapSegs: g.gapSegs,
      estimated: true,
      far: g.far,
      method: "graph",
      steps: generateSteps(g.path, from, to),
    };
  }
  return old && { ...old, method: "branch" };
}

// Steps from the shape of the path: merge points < 8 m apart, announce bends of 35° or more
function generateSteps(path, from, to) {
  const keep = [0];
  for (let i = 1; i < path.length - 1; i++) {
    if (map.distance(path[keep[keep.length - 1]], path[i]) >= MERGE_POINTS_M) keep.push(i);
  }
  keep.push(path.length - 1);

  const exclude = new Set([from.id, to.id]);
  const steps = [{
    text: `Start at ${from.gps ? "your location" : from.name} and head ${compassWord(bearing(path[0], path[keep[1]]))}.`,
    at: 0, landmark: "", photo: "",
  }];
  for (let k = 1; k < keep.length - 1; k++) {
    const prev = path[keep[k - 1]], here = path[keep[k]], next = path[keep[k + 1]];
    const turn = ((bearing(here, next) - bearing(prev, here) + 540) % 360) - 180; // + = right
    if (Math.abs(turn) < TURN_MIN_DEG) continue;
    const side = turn > 0 ? "right" : "left";
    const mark = turnLandmark(here, exclude);
    steps.push({
      text: `${Math.abs(turn) > 120 ? "Turn sharp" : "Turn"} ${side} and head ${compassWord(bearing(here, next))}${mark ? ` near ${mark.name}` : ""}.`,
      at: keep[k],
      landmark: "", // already in the text ("near …")
      photo: "",
    });
  }
  steps.push({ text: `You have arrived at ${to.gps ? "your location" : to.name}`, at: path.length - 1, landmark: "", photo: "" });
  return steps;
}

// Nearest place within 40 m of a turn, preferring priority 1 and 2 places
function turnLandmark(point, exclude) {
  return allPlaces
    .filter((p) => !exclude.has(p.id))
    .map((p) => ({ p, d: map.distance(point, [p.lat, p.lng]) }))
    .filter((x) => x.d <= LANDMARK_M)
    .sort((a, b) => ((a.p.priority || 2) > 2) - ((b.p.priority || 2) > 2) || a.d - b.d)[0]?.p || null;
}

// Tidy steps: valid indexes, a start step if missing, and a final "arrived" step
function buildSteps(rawSteps, n, fromName, toName) {
  const steps = rawSteps
    .map((s) => ({
      text: String(s.text || "").trim() || "Keep following the blue line.",
      at: Math.min(Math.max(parseInt(s.at, 10) || 0, 0), n - 1),
      landmark: s.landmark || "",
      photo: s.photo || "",
    }))
    .sort((a, b) => a.at - b.at);
  if (!steps.length || steps[0].at > 0) {
    steps.unshift({ text: `Start at ${fromName} and follow the blue line.`, at: 0, landmark: "", photo: "" });
  }
  // If the route already ends with a step at the last point, that's the arrival
  // step (shown with a tick); otherwise add one
  const last = steps[steps.length - 1];
  if (last.at === n - 1 && steps.length > 1) last.arrival = true;
  else steps.push({ text: `You have arrived at ${toName}`, at: n - 1, landmark: "", photo: "", arrival: true });
  return steps;
}

// ---------- Directions UI ----------
const dirTop = $("dirTop");
const dirPanel = $("dirPanel");
const fromInput = $("fromInput");
const toInput = $("toInput");
const dirList = $("dirList"); // suggestion list shared by From and To
const stepCard = $("stepCard");
const stepPhoto = $("stepPhoto");

const dir = {
  active: false,
  to: null, // a place
  from: null, // a place, or { gps: true, lat, lng }
  path: [],
  steps: [],
  step: 0,
  hasRoute: false,
  routeId: null, // id of the route being shown (null = straight line)
  forceStraight: false, // set by "I'm lost" when you're too far from the route
  completed: false, // route_completed already logged
  layer: L.layerGroup(),
  stepMarker: null,
  straightLines: null, // straight-line fallback: its line layers (moved with GPS)
  drawPath: [], // smoothed points, for drawing only (progress, flow dot)
  walkedLine: null, // grey "already walked" line in Start walking mode
  turnDots: [], // numbered dots matching the step cards
  startMarker: null,
  flowToken: 0, // bumps to stop the flow-dot animation
  followPausedUntil: 0, // Start walking: don't re-centre until this time (after a manual drag)
  watchId: null,
  lastFix: null,
  walking: false, // "Start walking": follow the GPS dot and the current step
  autoFrom: false, // the start was picked for you (shows "Starting from … Change")
};

const OFF_CAMPUS_M = 1500; // further than this from the campus centre = "off campus"

// Fill a small icon badge for a place (or the blue GPS badge)
function setBadge(el, from) {
  const color = from.gps ? "#2563eb" : CATEGORY_COLORS[from.category] || "#6b7280";
  el.style.setProperty("--c", color);
  el.innerHTML = iconSvg(from.gps ? "pin" : placeIcon(from));
}

// fromPlace is optional; without it the start is Entry Gate (with a "Change" hint)
function startDirections(toPlace, fromPlace) {
  if (adminToggle.checked) {
    showToast("Turn off the admin tools (gear) to get directions.");
    return;
  }
  closeCard();
  dir.active = true;
  dir.walking = false;
  dir.to = toPlace;
  document.body.classList.add("directions-on");
  closeSuggestions();
  dirTop.hidden = false;
  showView("dir", "half"); // ui.js
  dir.layer.addTo(map);

  if (fromPlace) {
    setFrom(fromPlace);
    return;
  }
  setFrom(defaultFrom(toPlace));
  dir.autoFrom = true;
  syncEnds();
}

// Never leave From empty: Entry Gate, or Main Gate Entry when you're going to Entry Gate
function defaultFrom(toPlace) {
  const id = toPlace.id === "entry-gate" ? "main-gate-entry" : "entry-gate";
  return placesById[id] || allPlaces.find((p) => p.id !== toPlace.id);
}

function setFrom(from) {
  if (!from) return;
  if (!from.gps && !dir.walking) stopWatch();
  dir.from = from;
  dir.autoFrom = false;
  closeSuggestions();
  drawDirections();
}

// New destination: redraw from the current start (back to step 1)
function setTo(place) {
  if (!place) return;
  dir.to = place;
  closeSuggestions();
  drawDirections();
}

// Swap start and destination. Uses the reversed route (with the
// "steps are mirrored" note) if only the other direction is recorded.
function swapEnds() {
  if (dir.from.gps) {
    showToast("Your location can't be a destination. Pick a starting place first.");
    return;
  }
  const oldFrom = dir.from;
  const oldTo = dir.to;
  dir.to = oldFrom;
  setFrom(oldTo); // redraws, finding the route either way round
}

// Show the current From / To in the top inputs, with their icon badges
function syncEnds() {
  if (!dir.from || !dir.to) return;
  fromInput.value = dir.from.gps ? "My current location" : dir.from.name;
  toInput.value = dir.to.name;
  setBadge($("dirFromTopBadge"), dir.from);
  setBadge($("dirToBadge"), dir.to);
  $("fromHint").hidden = !dir.autoFrom;
  $("fromHintText").textContent = `Starting from ${dir.from.gps ? "your location" : dir.from.name}.`;
}
$("fromHintChange").addEventListener("click", () => fromInput.focus());

function drawDirections() {
  const { from, to } = dir;
  $("estBox").hidden = true;
  $("estRequest").disabled = false;
  $("estRequest").textContent = "Request a better route";
  dir.layer.clearLayers();
  dir.flowToken++; // stop any flow-dot animation
  dir.stepMarker = null;
  dir.straightLines = null;
  dir.walkedLine = null;
  dir.turnDots = [];
  dir.routeId = null;
  dir.progressValid = false;
  dir.showedWholeRoute = false;
  $("farFromRoute").hidden = true;
  $("simWalkBtn").hidden = !adminUsed();
  $("lineLegend").hidden = true;
  dir.completed = false;
  $("offRoute").hidden = true;
  showArrived(false); // ui.js
  const forceStraight = dir.forceStraight;
  dir.forceStraight = false;

  // Both ends get Start / End markers on the route, so hide their normal pins
  pinnedIds.clear();
  routeEndIds.clear();
  routeEndIds.add(to.id);
  if (!from.gps) routeEndIds.add(from.id);
  updateTiers();

  // Top inputs + summary header: [badge] From → [badge] To
  syncEnds();
  $("requestRouteBtn").hidden = true;
  setBadge($("dirFromBadge"), from);
  $("dirFromName").textContent = from.gps ? "My current location" : from.name;
  setBadge($("dirToBadge2"), to);
  $("dirToName2").textContent = to.name;

  if (!from.gps && from.id === to.id) {
    routeEndIds.clear(); // no route to draw: show the place's own pin
    updateTiers();
    showSimpleCard(`You're already at ${to.name}. Pick a different starting place above.`);
    $("dirStats").textContent = "";
    setNote("");
    updateInsets();
    return;
  }

  let route = from.gps ? routeFromPoint(toLL(from), to.id) : findRoute(from.id, to.id);
  if (!route) route = estimateRoute(from, to); // built from recorded paths
  if (forceStraight) route = null;
  // Log before drawing, so it comes before the first step_viewed
  logEvent("directions_started", { place_id: to.id, route_id: route?.id || "no route" });
  if (route) showRoute(route);
  else showStraight();
  $("notOnRoute").hidden = !(from.gps && !route);
  if (from.gps || dir.walking) startWatch();
  updateInsets(); // panel height may have changed (ResizeObserver also catches later changes)
}

// Log "route_completed" once per route, when the arrival step is reached
function markCompleted() {
  if (dir.completed || !dir.hasRoute) return;
  dir.completed = true;
  logEvent("route_completed", { place_id: dir.to.id, route_id: dir.routeId });
}

// A recorded route: bold line, moving dashes, arrowheads and step cards
function showRoute(route) {
  const path = route.path.map((p) => [p[0], p[1]]);
  dir.path = path;
  dir.hasRoute = true;
  dir.routeId = route.id || null;
  dir.steps = buildSteps(route.steps, path.length, dir.from.gps ? "your location" : dir.from.name, dir.to.name);

  drawRoute(path, route.gapSegs || new Set()); // line, arrows, markers, numbered turn dots

  // "Estimated route" pill + explanation + buttons
  $("estBox").hidden = !route.estimated;
  $("estFar").hidden = !route.far;
  $("estRecord").hidden = !route.estimated || !adminUsed();

  const len = pathLength(path);
  $("dirStats").textContent = `${fmtDistance(len)} · ${fmtWalk(len)}`;
  setNote(route.mirrored ? "Steps are mirrored. Reverse directions haven't been written yet." : "");

  dir.step = 0;
  renderStep(false);
  fitTo(L.latLngBounds(path));
  revealAfterCameraMove(); // draw the line in once the map has settled
}

// ---------- Route drawing (looks only: distances, steps and snapping use the recorded points) ----------
const LINE_ORANGE = "#f97316"; // main line
const LINE_EDGE = "#c2410c"; // thin darker edge on the light map
const SMOOTH_CUT_M = 4; // Chaikin cuts at most this far back from each corner…
const SMOOTH_MAX_DEV_M = 3; // …and the smoothed line must stay this close to the recorded points
const CHEVRON_SPACING_M = 40;
const CHEVRON_MIN_ROUTE_M = 120; // very short routes don't need arrows
const DETAIL_MIN_ZOOM = 16; // arrows and numbered dots only from this zoom
const REVEAL_MS = 800; // line drawing-in time
const FLOW_EVERY_MS = 4000, FLOW_DURATION_MS = 2400; // light dot travelling along the line
const FOLLOW_PAUSE_MS = 10000; // after you drag the map while walking
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const lerpLL = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// One Chaikin pass, cutting each corner at most SMOOTH_CUT_M from the original point
function chaikinPass(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = map.distance(a, b);
    const t = len ? Math.min(0.25, SMOOTH_CUT_M / len) : 0;
    if (i > 0) out.push(lerpLL(a, b, t));
    if (i < pts.length - 2) out.push(lerpLL(a, b, 1 - t));
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Two passes if the result stays within 3 m of the recorded line, else one, else none
function smoothForDrawing(pts) {
  if (pts.length < 3) return pts;
  for (const passes of [2, 1]) {
    let sm = pts;
    for (let i = 0; i < passes; i++) sm = chaikinPass(sm);
    if (Math.max(...sm.map((p) => projectOnPath(p, pts).dist)) <= SMOOTH_MAX_DEV_M) return sm;
  }
  return pts;
}

// Draw a route: white casing, (map only) darker edge, orange line; gaps dashed and lighter.
// Returns the line layers of a single-gap (straight) route so GPS can move them.
function drawRoute(path, gapSegs) {
  // Split into recorded runs (smoothed) and estimated gaps (straight)
  const runs = [];
  let cur = [path[0]];
  for (let i = 0; i < path.length - 1; i++) {
    if (gapSegs.has(i)) {
      if (cur.length > 1) runs.push({ pts: smoothForDrawing(cur), gap: false });
      runs.push({ pts: [path[i], path[i + 1]], gap: true });
      cur = [path[i + 1]];
    } else {
      cur.push(path[i + 1]);
    }
  }
  if (cur.length > 1) runs.push({ pts: smoothForDrawing(cur), gap: false });
  dir.drawPath = runs.reduce((all, r) => all.concat(all.length ? r.pts.slice(1) : r.pts), []);

  const opt = (o) => ({ interactive: false, lineCap: "round", lineJoin: "round", ...o });
  const layers = [];
  // Layer order: all casings, then edges, then the orange lines (so joins stay clean)
  for (const r of runs) {
    const l = L.polyline(r.pts, opt({ color: "#fff", weight: 9, opacity: 0.9, className: "route-casing" })).addTo(dir.layer);
    layers.push({ l, run: r });
  }
  for (const r of runs) {
    if (!r.gap) layers.push({ l: L.polyline(r.pts, opt({ color: LINE_EDGE, weight: 6.5, className: "route-edge" })).addTo(dir.layer), run: r });
  }
  for (const r of runs) {
    const l = r.gap
      ? L.polyline(r.pts, opt({ color: LINE_ORANGE, weight: 3.5, opacity: 0.6, dashArray: "1 8", className: "route-gap" }))
      : L.polyline(r.pts, opt({ color: LINE_ORANGE, weight: 5, className: "route-main" }));
    layers.push({ l: l.addTo(dir.layer), run: r });
  }
  // Start walking: the part already walked, in grey, on top
  dir.walkedLine = L.polyline([], opt({ color: "#a8a29e", weight: 5, className: "route-walked" })).addTo(dir.layer);

  addChevrons(path);
  addRouteEnds(path);
  addTurnDots();
  updateRouteDetail();
  $("lineLegend").hidden = !runs.some((r) => r.gap); // only explain dashes when there are some

  // The route itself is visible straight away; the draw-in animation is a separate sweep on top
  dir.pendingReveal = { runs };
  return runs.length === 1 && runs[0].gap ? layers.map((x) => x.l) : null;
}

// Wait for the camera to settle (fitTo flies the map), then draw the line in
function revealAfterCameraMove() {
  const token = dir.flowToken;
  let done = false;
  const go = () => {
    if (done || token !== dir.flowToken) return;
    done = true;
    revealRoute();
  };
  map.once("moveend", go);
  setTimeout(go, 1000);
}

// Draw-in: a light line sweeps from start to end over REVEAL_MS on top of the (already
// visible) route, then fades away. If it never runs, the route is still fully shown.
function revealRoute() {
  const pending = dir.pendingReveal;
  dir.pendingReveal = null;
  if (!pending) return;
  if (!REDUCED_MOTION) {
    const solid = pending.runs.filter((r) => !r.gap);
    const lens = solid.map((r) => pathLength(r.pts));
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    solid.forEach((run, i) => {
      const delay = (acc / total) * REVEAL_MS;
      const dur = Math.max(60, (lens[i] / total) * REVEAL_MS);
      acc += lens[i];
      const sweep = L.polyline(run.pts, { color: "#fff7ed", weight: 3, opacity: 0.95, lineCap: "round", lineJoin: "round", interactive: false, className: "route-sweep" }).addTo(dir.layer);
      const el = sweep.getElement();
      if (!el) return;
      const len = el.getTotalLength();
      el.style.strokeDasharray = `${len} ${len}`;
      el.style.strokeDashoffset = `${len}`;
      el.getBoundingClientRect(); // apply before animating
      el.style.transition = `stroke-dashoffset ${dur}ms linear ${delay}ms, opacity 400ms ease ${REVEAL_MS + 150}ms`;
      el.style.strokeDashoffset = "0";
      el.style.opacity = "0";
      setTimeout(() => dir.layer.removeLayer(sweep), REVEAL_MS + 700);
    });
  }
  setTimeout(startFlow, REDUCED_MOTION ? 0 : REVEAL_MS + 100);
}

// Every few seconds a soft light dot glides along the line
function startFlow() {
  if (REDUCED_MOTION || dir.drawPath.length < 2 || !dir.active) return;
  const token = dir.flowToken;
  const pts = dir.drawPath;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + map.distance(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  if (total < 20) return;
  const dot = L.circleMarker(pts[0], {
    radius: 4, color: "#fff", weight: 2, fillColor: "#fed7aa", fillOpacity: 0, opacity: 0,
    interactive: false, className: "flow-dot",
  }).addTo(dir.layer);
  const pointAt = (d) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    return lerpLL(pts[i - 1], pts[i], Math.min(1, Math.max(0, (d - cum[i - 1]) / seg)));
  };
  const runOnce = () => {
    if (token !== dir.flowToken || !dir.active) return;
    if (document.hidden) { setTimeout(runOnce, FLOW_EVERY_MS); return; }
    const t0 = performance.now();
    const frame = (now) => {
      if (token !== dir.flowToken || !dir.active) return;
      const k = Math.min(1, (now - t0) / FLOW_DURATION_MS);
      dot.setLatLng(pointAt(k * total));
      const o = Math.sin(Math.PI * k) * 0.95; // fade in, then out
      dot.setStyle({ opacity: o, fillOpacity: o });
      if (k < 1) requestAnimationFrame(frame);
      else setTimeout(runOnce, FLOW_EVERY_MS - FLOW_DURATION_MS);
    };
    requestAnimationFrame(frame);
  };
  runOnce();
}

// Small white chevrons with an orange outline, every 40 m, pointing the way you walk
function addChevrons(path) {
  if (pathLength(path) < CHEVRON_MIN_ROUTE_M) return;
  let next = CHEVRON_SPACING_M / 2;
  for (let i = 1; i < path.length; i++) {
    const a = toLL(path[i - 1]), b = toLL(path[i]);
    const seg = map.distance(a, b);
    const deg = bearing(a, b);
    while (next < seg) {
      const t = next / seg;
      L.marker([a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t], {
        icon: L.divIcon({
          className: "route-chevron",
          html: `<svg viewBox="0 0 24 24" style="transform:rotate(${deg}deg)"><path class="cv-edge" d="M6 15 12 9 18 15"/><path class="cv-fill" d="M6 15 12 9 18 15"/></svg>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(dir.layer);
      next += CHEVRON_SPACING_M;
    }
    next -= seg;
  }
}

// "Start" ring and the destination pin (with its icon and name), above the line
function addRouteEnds(path) {
  dir.startMarker = L.marker(path[0], {
    icon: L.divIcon({
      className: "route-start",
      html: `<span class="rs-dot"></span><span class="route-label">Start</span>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    }),
    interactive: false,
    keyboard: false,
    zIndexOffset: 2000,
  }).addTo(dir.layer);
  L.marker(path[path.length - 1], {
    icon: L.divIcon({
      className: "route-end",
      html: `<span class="re-pin"><span class="re-icon">${iconSvg(placeIcon(dir.to))}</span></span><span class="route-label">${escapeHtml(dir.to.name)}</span>`,
      iconSize: [36, 46],
      iconAnchor: [18, 44],
    }),
    interactive: false,
    keyboard: false,
    zIndexOffset: 2100,
  }).addTo(dir.layer);
}

// Numbered dots at each turn (same numbers as the step cards). Tap one to jump to that step.
function addTurnDots() {
  dir.turnDots = [];
  if (!dir.hasRoute) return;
  dir.steps.forEach((s, i) => {
    if (i === 0 || s.arrival) return; // Start and End have their own markers
    const m = L.marker(dir.path[s.at], {
      icon: L.divIcon({ className: "turn-dot-wrap", html: `<span class="turn-dot">${i + 1}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
      title: `Step ${i + 1}`,
      keyboard: false,
      zIndexOffset: 1500,
    }).addTo(dir.layer);
    m.on("click", () => { dir.step = i; renderStep(true); });
    dir.turnDots[i] = m;
  });
}

// Arrows and numbered dots only when zoomed in enough to read them
function updateRouteDetail() {
  map.getContainer().classList.toggle("route-detail-hidden", map.getZoom() < DETAIL_MIN_ZOOM);
}
map.on("zoomend", updateRouteDetail);

// Start walking: grey for the part already walked (only this line changes per GPS fix)
function updateWalkedProgress(ll) {
  if (!dir.walkedLine || dir.drawPath.length < 2) return;
  const proj = projectOnPath(ll, dir.drawPath);
  dir.walkedLine.setLatLngs(dir.drawPath.slice(0, proj.seg + 1).concat([proj.point]));
}

// Keep a point centred in the visible part of the map, with a smooth pan
function panToVisible(latlng) {
  const p = coveredPadding();
  const size = map.getSize(), z = map.getZoom();
  const cx = (p.tl.x + size.x - p.br.x) / 2, cy = (p.tl.y + size.y - p.br.y) / 2;
  const target = map.unproject(map.project(latlng, z).add([size.x / 2 - cx, size.y / 2 - cy]), z);
  map.panTo(target, { animate: !REDUCED_MOTION, duration: 0.6 });
}

// Dragging the map while walking pauses the follow for 10 seconds
map.on("dragstart", () => { if (dir.walking) dir.followPausedUntil = Date.now() + FOLLOW_PAUSE_MS; });

// No recorded route: dashed straight line + compass direction. Never a blank screen.
function showStraight() {
  dir.hasRoute = false;
  dir.steps = [];
  const a = toLL(dir.from), b = toLL(dir.to);
  dir.path = [[a.lat, a.lng], [b.lat, b.lng]];
  dir.straightLines = drawRoute(dir.path, new Set([0])); // the whole line is an estimated stretch

  showSimpleCard("");
  updateStraightText(a);
  setNote("Detailed route not recorded yet");

  // Let people ask for this route (saved in the feedback log)
  const btn = $("requestRouteBtn");
  btn.hidden = false;
  btn.disabled = false;
  btn.textContent = "Request this route";
  fitTo(L.latLngBounds(dir.path));
  revealAfterCameraMove();
}

// "Request this route" → feedback log entry, category "Route request"
$("requestRouteBtn").addEventListener("click", () => {
  const fromId = dir.from.gps ? "my-location" : dir.from.id;
  const saved = saveFeedback({
    category: "Route request",
    note: "",
    place_id: dir.to.id,
    route_id: `${fromId}__${dir.to.id}`,
    step_index: "",
  });
  if (!saved) {
    showToast("Sorry, this browser won't let us save the request.");
    return;
  }
  $("requestRouteBtn").disabled = true;
  $("requestRouteBtn").textContent = "Route requested ✓";
  showToast("Thanks! We'll add this route.");
});

function updateStraightText(a) {
  const d = map.distance(a, toLL(dir.to));
  $("dirStats").textContent = `${Math.round(d)} m in a straight line`;
  $("stepText").textContent = `Head roughly ${compassWord(bearing(a, dir.to))} for about ${Math.round(d)} m.`;
}

// A card with just a message (no progress bar or Back/Next)
function showSimpleCard(text) {
  $("stepDistance").hidden = true;
  $("stepProgress").hidden = true;
  $("stepNav").hidden = true;
  $("stepLandmark").hidden = true;
  stepPhoto.hidden = true;
  $("stepText").classList.remove("arrived");
  $("stepText").textContent = text;
}

function setNote(text) {
  $("dirNote").textContent = text;
  $("dirNote").hidden = !text;
}

// Show the current step card and highlight its point on the map
function renderStep(fly = true) {
  if (!dir.steps.length) return;
  if (!dir.steps[dir.step]) dir.step = 0; // no valid step → step 1, never a blank card
  const s = dir.steps[dir.step];
  const total = dir.steps.length;
  $("stepProgress").hidden = false;
  $("stepNav").hidden = false;
  $("stepCount").textContent = `Step ${dir.step + 1} of ${total}`;
  // One dot per step: filled = done, wide = current
  $("stepDots").innerHTML = dir.steps
    .map((_, i) => `<span class="dot${i < dir.step ? " done" : ""}${i === dir.step ? " current" : ""}"></span>`)
    .join("");

  const text = $("stepText");
  text.innerHTML = s.arrival
    ? `<span class="tick">${iconSvg("check")}</span><span>${escapeHtml(s.text)}</span>`
    : escapeHtml(s.text);
  text.classList.toggle("arrived", !!s.arrival);

  // "about 150 m to the next turn" (along the path, nearest 5 m); nothing on the last step
  const next = dir.steps[dir.step + 1];
  let distText = "";
  if (next) {
    const metres = Math.round(pathLength(dir.path.slice(s.at, next.at + 1)) / 5) * 5;
    if (metres >= 5) distText = `About ${metres} m ${next.arrival ? "to go" : "to the next turn"}`;
  }
  $("stepDistance").textContent = distText;
  $("stepDistance").hidden = !distText;

  $("stepLandmark").hidden = !s.landmark;
  $("stepLandmark").textContent = s.landmark ? `Landmark: ${s.landmark}` : "";

  if (s.photo) {
    stepPhoto.src = s.photo;
    stepPhoto.alt = s.landmark || "Landmark photo";
    stepPhoto.hidden = false;
  } else {
    stepPhoto.hidden = true;
    stepPhoto.removeAttribute("src");
  }

  $("stepBack").disabled = dir.step === 0;
  logEvent("step_viewed", { route_id: dir.routeId, step_index: dir.step });
  if (s.arrival) markCompleted();
  showArrived(!!s.arrival); // ui.js: the "You've arrived" screen replaces the card
  updateInsets(); // longer or shorter step text changes the panel height

  const pt = dir.path[s.at];
  if (!dir.stepMarker) {
    // Current step: a larger pulsing dot on the line (CSS .step-dot)
    dir.stepMarker = L.circleMarker(pt, {
      radius: 10, color: "#fff", weight: 3, fillColor: LINE_ORANGE, fillOpacity: 1,
      className: "step-dot", interactive: false,
    }).addTo(dir.layer);
  } else {
    dir.stepMarker.setLatLng(pt);
  }
  dir.turnDots.forEach((m, i) => m?.getElement()?.querySelector(".turn-dot")?.classList.toggle("current", i === dir.step));
  if (fly) flyToVisible(toLL(pt), Math.max(map.getZoom(), 18));
}

function goStep(delta) {
  if (!dir.hasRoute) return;
  const next = dir.step + delta;
  if (next < 0 || next >= dir.steps.length) return;
  dir.step = next;
  renderStep(true);
}

stepPhoto.addEventListener("error", () => { stepPhoto.hidden = true; });
$("stepBack").addEventListener("click", () => goStep(-1));
$("stepNext").addEventListener("click", () => goStep(1));

// Swipe left/right on the step card (phones)
let touchStart = null;
stepCard.addEventListener("touchstart", (e) => {
  const t = e.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });
stepCard.addEventListener("touchend", (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) goStep(dx < 0 ? 1 : -1);
});

function cancelDirections() {
  if (!dir.active) return;
  dir.active = false;
  stopWalking();
  stopWatch();
  dir.layer.clearLayers();
  dir.flowToken++;
  map.removeLayer(dir.layer);
  dir.stepMarker = null;
  dirTop.hidden = true;
  showArrived(false);
  showView("home", "peek"); // ui.js: back to the home sheet
  closeSuggestions();
  document.body.classList.remove("directions-on");
  pinnedIds.clear();
  routeEndIds.clear();
  updateTiers();
  updateInsets();
}
$("cancelDir").addEventListener("click", cancelDirections);

// "Report a problem" on the step card, with the route and step attached
$("stepReport").addEventListener("click", () => {
  openReport({
    place_id: dir.to?.id,
    route_id: dir.routeId,
    step_index: dir.hasRoute ? dir.step : null,
  });
});

// ---------- Keeping the route clear of the panels ----------
const desktopMQ = window.matchMedia("(min-width: 768px)");

// Space covered by panels/buttons, as Leaflet padding
function coveredPadding() {
  if (desktopMQ.matches) return { tl: L.point(388, 72), br: L.point(80, 24) }; // 340px panel on the left
  const top = topInset() + 60; // + the Filters / gear / Map-Satellite row
  const bottom = bottomCovered();
  return { tl: L.point(24, top + 12), br: L.point(80, bottom + 16) };
}

// Height covered at the bottom: the admin panel, or the visible part of the sheet
function bottomCovered() {
  if (!recPanel.hidden) return recPanel.offsetHeight;
  return sheetVisibleHeight(); // ui.js
}

function fitTo(bounds) {
  const p = coveredPadding();
  map.flyToBounds(bounds, { paddingTopLeft: p.tl, paddingBottomRight: p.br, maxZoom: 18, duration: 0.8 });
}

// Fly so a point lands in the middle of the part of the map you can actually see
function flyToVisible(latlng, zoom) {
  const p = coveredPadding();
  const size = map.getSize();
  const cx = (p.tl.x + size.x - p.br.x) / 2;
  const cy = (p.tl.y + size.y - p.br.y) / 2;
  const target = map.unproject(map.project(latlng, zoom).add([size.x / 2 - cx, size.y / 2 - cy]), zoom);
  map.flyTo(target, zoom, { duration: 0.7 });
}

// Bottom edge of the From/To bar during directions (0 otherwise)
function topInset() {
  return dirTop.hidden ? 0 : dirTop.getBoundingClientRect().bottom;
}

// CSS variables so the round buttons sit above the bottom panel and the
// gear / Map-Satellite row sits below the top card
function updateInsets() {
  const bottom = desktopMQ.matches ? 0 : bottomCovered();
  document.body.style.setProperty("--bottom-inset", `${Math.round(bottom)}px`);
  document.body.style.setProperty("--top-inset", `${Math.round(topInset())}px`);
}

// ---------- Searching places (search bar, From and To) ----------
function matchesQuery(place, q) {
  q = q.trim().toLowerCase();
  if (!q) return true;
  return (
    place.name.toLowerCase().includes(q) ||
    (place.aliases || []).some((a) => a.toLowerCase().includes(q)) ||
    (place.group || "").toLowerCase().includes(q) ||
    place.block === q
  );
}

// Best matches first: name starts with the text, then name contains it, then aliases/group
function searchPlaces(q, excludeId) {
  const s = q.trim().toLowerCase();
  const score = (p) => {
    const n = p.name.toLowerCase();
    if (n.startsWith(s)) return 0;
    if (n.includes(s)) return 1;
    return 2;
  };
  return allPlaces
    .filter((p) => p.id !== excludeId && matchesQuery(p, q))
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

// Is there a recorded route (either direction) between these two ends?
function hasRecordedRoute(from, to) {
  if (!from || !to || (!from.gps && from.id === to.id)) return false;
  return from.gps ? !!routeFromPoint(toLL(from), to.id) : !!findRoute(from.id, to.id);
}

// One suggestion row: icon, name, group, and an optional small badge on the right
function suggestionHtml(place, tag) {
  const color = CATEGORY_COLORS[place.category] || "#6b7280";
  return `<li role="option" data-id="${place.id}">
    <span class="mini-badge" style="--c:${color}">${iconSvg(placeIcon(place))}</span>
    <span class="sugg-text"><span class="sugg-name">${escapeHtml(place.name)}</span><span class="sugg-group">${escapeHtml(place.group || place.category)}</span></span>
    ${tag || ""}</li>`;
}

function routeTag(from, to) {
  if (!hasRecordedRoute(from, to) && estimateRoute(from, to, true)) return `<span class="route-tag est">Estimated route</span>`;
  return hasRecordedRoute(from, to)
    ? `<span class="route-tag yes">Route available</span>`
    : `<span class="route-tag no">Straight line only</span>`;
}

// Wire a search input to a suggestion list.
// suggest(q) returns list HTML; pick(place) runs when a row is chosen.
const pickers = [];
function attachPicker(input, list, { suggest, pick, restore }) {
  const render = (q) => {
    const html = suggest(q);
    list.innerHTML = html;
    list.hidden = !html; // nothing to suggest → no list
    list.scrollTop = 0;
    list._owner = input;
  };
  input.addEventListener("focus", () => {
    input.select();
    render(""); // empty → quick options / popular places
  });
  input.addEventListener("input", () => {
    render(input.value);
    logSearch(input.value); // test mode (help.js)
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = list.querySelector("li[data-id]");
      if (first) pick(placesById[first.dataset.id]);
      input.blur();
    } else if (e.key === "Escape") {
      closeSuggestions();
      input.blur();
    }
  });
  pickers.push({ input, list, pick, restore });
}

// Close every open list and put the inputs back to their current values
function closeSuggestions() {
  for (const p of pickers) {
    p.list.hidden = true;
    p.restore?.();
  }
}

// Clicks on a suggestion row (lists are shared, so route by the input that opened them)
for (const list of [dirList, $("searchList")]) {
  list.addEventListener("click", (e) => {
    const owner = pickers.find((p) => p.input === list._owner);
    if (e.target.closest("li[data-gps]")) { // "My current location" row in From
      owner?.input.blur();
      closeSuggestions();
      startFromGps(false);
      return;
    }
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    owner?.pick(placesById[li.dataset.id]);
    owner?.input.blur();
  });
}
// Tapping anywhere else closes the lists
document.addEventListener("click", (e) => {
  if (!dirTop.contains(e.target) && !$("sheet").contains(e.target)) closeSuggestions();
});

const EMPTY_SEARCH = "No place found. Try a block number like 34, or a nearby landmark.";
const listOrEmpty = (rows) => rows || `<li class="empty">${EMPTY_SEARCH}</li>`;

// Home search: results replace the home tiles while you type; picking opens the place sheet
attachPicker($("searchInput"), $("searchList"), {
  suggest: (q) => {
    $("viewHome").classList.toggle("searching", !!q.trim());
    if (!q.trim()) return ""; // the home tiles and popular places show instead
    return listOrEmpty(searchPlaces(q).slice(0, 40).map((p) => suggestionHtml(p)).join(""));
  },
  pick: (place) => {
    $("searchInput").value = "";
    closeSuggestions();
    focusPlace(place);
  },
  restore: () => $("viewHome").classList.toggle("searching", !!$("searchInput").value.trim()),
});

// "My current location" row: always the first option in the From list
function gpsRowHtml() {
  return `<li role="option" data-gps="1"><span class="mini-badge" style="--c:#2563eb">${iconSvg("pin")}</span>
    <span class="sugg-text"><span class="sugg-name">My current location</span><span class="sugg-group">Use GPS to start from where you are</span></span></li>`;
}

// From: My location + quick gates first, then everything; badge says if a route to the destination exists
attachPicker(fromInput, dirList, {
  suggest: (q) => {
    const tag = (p) => routeTag(p, dir.to);
    if (!q.trim()) {
      const quick = ["entry-gate", "main-gate-entry"].map((id) => placesById[id]).filter((p) => p && p.id !== dir.to?.id);
      const rest = allPlaces.filter((p) => p.id !== dir.to?.id && !quick.includes(p));
      return `<li class="list-head">Quick options</li>${gpsRowHtml()}${quick.map((p) => suggestionHtml(p, tag(p))).join("")}` +
        `<li class="list-head">All places</li>${rest.map((p) => suggestionHtml(p, tag(p))).join("")}`;
    }
    return gpsRowHtml() + listOrEmpty(searchPlaces(q, dir.to?.id).slice(0, 40).map((p) => suggestionHtml(p, tag(p))).join(""));
  },
  pick: (place) => setFrom(place),
  restore: syncEnds,
});

// To: same, with route badges measured from the current start
attachPicker(toInput, dirList, {
  suggest: (q) => {
    const fromId = dir.from?.gps ? null : dir.from?.id;
    const items = q.trim() ? searchPlaces(q, fromId).slice(0, 40) : allPlaces.filter((p) => p.id !== fromId);
    return listOrEmpty(items.map((p) => suggestionHtml(p, routeTag(dir.from, p))).join(""));
  },
  pick: (place) => setTo(place),
  restore: syncEnds,
});

$("swapBtn").addEventListener("click", swapEnds);

function startFromGps(isRestart) {
  const locationOff = () => showToast("Location is off. Choose where you are from the list.", 5000);
  if (!("geolocation" in navigator)) {
    locationOff();
    return;
  }
  showToast("Finding you…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
      showMyPosition(ll, pos.coords.accuracy); // blue dot + accuracy circle
      if (pos.coords.accuracy > 100) showToast("Your location is not very accurate, so the route may start a little off.", 5000);
      if (map.distance(ll, CAMPUS_CENTER) > OFF_CAMPUS_M) {
        showToast("You seem to be off campus. Choose where you'll start from the list.", 5000);
        return;
      }
      dir.lastFix = ll;
      setFrom({ gps: true, lat: ll.lat, lng: ll.lng });
    },
    () => {
      // Restart fallback: use the last position we had
      if (isRestart && dir.lastFix) setFrom({ gps: true, lat: dir.lastFix.lat, lng: dir.lastFix.lng });
      else locationOff(); // From stays on whatever was picked from the list
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  );
}

// Estimated route buttons
$("estReport").addEventListener("click", () => openReport({ place_id: dir.to?.id, route_id: dir.routeId, step_index: dir.step }));
$("estRequest").addEventListener("click", () => {
  const saved = saveFeedback({
    category: "Route request",
    note: "Better route wanted (currently estimated)",
    place_id: dir.to.id,
    route_id: `${endKey(dir.from)}__${dir.to.id}`,
    step_index: "",
  });
  if (saved) {
    $("estRequest").disabled = true;
    $("estRequest").textContent = "Requested ✓";
    showToast("Thanks! We'll record this route properly.");
  }
});

// Admin: "Record this route" opens the recorder with From and To filled in
const ADMIN_USED_KEY = "campus_admin_used";
function adminUsed() {
  try { return localStorage.getItem(ADMIN_USED_KEY) === "1"; } catch (e) { return false; }
}
$("estRecord").addEventListener("click", () => {
  const fromId = dir.from.gps ? "" : dir.from.id;
  const toId = dir.to.id;
  cancelDirections();
  adminToggle.checked = true;
  adminToggle.dispatchEvent(new Event("change"));
  if (!rec.open) $("recToggle").click();
  recFrom.value = fromId;
  recTo.value = toId;
  showToast("Tap along the footpath to record this route.");
});

// "Walk to Entry Gate / Main Gate Entry first?" buttons
$("notOnRoute").addEventListener("click", (e) => {
  const place = placesById[e.target.closest("[data-gate]")?.dataset.gate];
  if (place) setFrom(place);
});

$("restartBtn").addEventListener("click", () => startFromGps(true));

// ---------- Live GPS while walking ----------
function startWatch() {
  if (dir.watchId !== null || !("geolocation" in navigator)) return;
  dir.watchId = navigator.geolocation.watchPosition(onFix, onWatchError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
  });
}

function onWatchError(err) {
  if (!dir.walking) return;
  stopWalking();
  showToast(`${gpsErrorMessage(err)} You can still tap Next as you walk.`, 6000);
}

function stopWatch() {
  if (dir.watchId !== null) navigator.geolocation.clearWatch(dir.watchId);
  dir.watchId = null;
}

// "Start walking": the blue dot follows you and the current step updates as you move
function startWalking() {
  if (!("geolocation" in navigator)) {
    showToast("This phone can't share its location here. Tap Next as you walk.");
    return;
  }
  dir.walking = true;
  dir.followPausedUntil = 0;
  dir.showedWholeRoute = false;
  startWatch();
  $("startWalkBtn").textContent = "Stop following me";
  $("startWalkBtn").classList.add("on");
  dirPanel.classList.add("walking"); // CSS moves the step card to the top
  setSheet("half"); // ui.js
  showToast("Walking mode on. Your blue dot will follow you.");
}

function stopWalking() {
  dir.walking = false;
  dir.simulating = false;
  clearTimeout(dir.simTimer);
  $("farFromRoute").hidden = true;
  resetProgressDisplay(); // full route, full distance
  if (dir.active && dir.hasRoute && !dir.steps[dir.step]?.arrival) renderStep(false);
  if (!dir.from?.gps) stopWatch();
  $("startWalkBtn").textContent = "Start walking";
  $("startWalkBtn").classList.remove("on");
  dirPanel.classList.remove("walking");
}

$("startWalkBtn").addEventListener("click", () => (dir.walking ? stopWalking() : startWalking()));

// Each new GPS fix (real or simulated). Rules:
//  - the full route line is never removed or redrawn here, only the grey "walked" overlay
//  - progress (grey part, current step, distances) only moves for a TRUSTED fix:
//    within PROGRESS_MAX_OFF_M of the route and accuracy better than PROGRESS_MAX_ACC_M
//  - the map follows you only in Start walking mode and within FOLLOW_MAX_OFF_M of the route
const PROGRESS_MAX_OFF_M = 40;
const PROGRESS_MAX_ACC_M = 50;
const FOLLOW_MAX_OFF_M = 100;

function onFix(pos) {
  if (!dir.active || !(dir.from?.gps || dir.walking)) return;
  const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
  const accuracy = pos.coords.accuracy ?? Infinity;
  dir.lastFix = ll;
  showMyPosition(ll, accuracy);
  if (!map.hasLayer(dir.layer)) dir.layer.addTo(map); // the route must always be on the map

  if (!dir.hasRoute) {
    // Straight-line mode: keep the line and distance up to date
    if (dir.straightLines) {
      if (dir.from.gps) {
        dir.path[0] = [ll.lat, ll.lng];
        dir.drawPath = dir.path;
        dir.straightLines.forEach((l) => l.setLatLngs(dir.path));
        dir.startMarker?.setLatLng(dir.path[0]);
      }
      updateStraightText(ll);
      if (accuracy < PROGRESS_MAX_ACC_M && map.distance(ll, toLL(dir.to)) < 20) showArrived(true);
    }
    if (dir.walking && Date.now() > dir.followPausedUntil) panToVisible(ll);
    return;
  }

  const proj = projectOnPath(ll, dir.path); // nearest point ON the route (original points)
  const offBy = proj.dist;
  const trusted = offBy <= PROGRESS_MAX_OFF_M && accuracy < PROGRESS_MAX_ACC_M;

  // Far away: show the whole route and say where to go; don't follow
  const farAway = offBy > FOLLOW_MAX_OFF_M;
  if (dir.walking) {
    $("farFromRoute").hidden = !farAway;
    $("farFromRoute").textContent = `You're not near the route yet. Walk to the start (${dir.from.gps ? "the start of the orange line" : dir.from.name}).`;
    if (farAway && !dir.showedWholeRoute) {
      dir.showedWholeRoute = true;
      fitTo(L.latLngBounds(dir.path));
    }
    if (!farAway && Date.now() > dir.followPausedUntil) panToVisible(ll);
  }
  // "Off the route" only once you've actually been on it, and with a good fix
  $("offRoute").hidden = !(dir.progressValid && accuracy < PROGRESS_MAX_ACC_M && offBy > OFF_ROUTE_M);

  if (!trusted) return; // a poor or distant fix changes nothing on the line or the card

  dir.progressValid = true;
  if (dir.walking) updateWalkedProgress(ll);

  // Current step = the last step at or before your point on the route
  let idx = 0;
  dir.steps.forEach((st, i) => { if (st.at <= proj.seg) idx = i; });
  if (idx !== dir.step) {
    dir.step = idx;
    renderStep(false);
  }
  updateLiveNumbers(proj);
}

// While walking with a trusted fix: distance left and distance to the next turn count down
function updateLiveNumbers(proj) {
  if (dir.steps[dir.step]?.arrival) return;
  const fromHere = (endIndex) => pathLength([proj.point, ...dir.path.slice(proj.seg + 1, endIndex + 1)]);
  const left = fromHere(dir.path.length - 1);
  $("dirStats").textContent = `${fmtDistance(left)} to go · ${fmtWalk(left)}`;
  const next = dir.steps[dir.step + 1];
  if (next) {
    const metres = Math.max(0, Math.round(fromHere(next.at) / 5) * 5);
    $("stepDistance").textContent = metres >= 5 ? `About ${metres} m ${next.arrival ? "to go" : "to the next turn"}` : "Almost there";
    $("stepDistance").hidden = false;
  }
}

// Back to the full route's numbers (no valid progress)
function resetProgressDisplay() {
  dir.progressValid = false;
  dir.walkedLine?.setLatLngs([]);
  if (dir.hasRoute) {
    const len = pathLength(dir.path);
    $("dirStats").textContent = `${fmtDistance(len)} · ${fmtWalk(len)}`;
  }
}

// ---------- Admin: Simulate walking (testing only) ----------
// Feeds fake, accurate GPS fixes along the route through the same onFix code as real GPS.
const SIM_STEP_M = 12, SIM_EVERY_MS = 700;
function startSimulatedWalk() {
  if (!dir.hasRoute) {
    showToast("Simulate walking needs a route with steps.");
    return;
  }
  stopWalking();
  stopWatch();
  dir.walking = true;
  dir.simulating = true;
  dir.followPausedUntil = 0;
  dir.showedWholeRoute = false;
  $("startWalkBtn").textContent = "Stop simulation";
  $("startWalkBtn").classList.add("on");
  dirPanel.classList.add("walking");
  const pts = dir.path;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + map.distance(pts[i - 1], pts[i]));
  let d = 0;
  const tick = () => {
    if (!dir.active || !dir.simulating) return;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const t = Math.min(1, Math.max(0, (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)));
    const p = lerpLL(pts[i - 1], pts[i], t);
    onFix({ coords: { latitude: p[0], longitude: p[1], accuracy: 8 } });
    if (d >= cum[cum.length - 1]) { dir.simulating = false; return; }
    d = Math.min(cum[cum.length - 1], d + SIM_STEP_M);
    dir.simTimer = setTimeout(tick, SIM_EVERY_MS);
  };
  tick();
}
$("simWalkBtn").addEventListener("click", startSimulatedWalk);

// ---------- Admin: route recorder ----------
const recPanel = $("recPanel");
const recBody = $("recBody");
const recFrom = $("recFrom");
const recTo = $("recTo");
const recOut = $("recOut");

const rec = {
  open: false,
  points: [], // L.LatLng
  line: null,
  layer: L.layerGroup(),
  loadedSteps: null, // steps kept from "Load saved", so re-copying doesn't lose them
  loadedReverse: null,
};

// app.js asks this before treating a map tap as "copy coordinates"
function isRecording() {
  return adminToggle.checked && rec.open;
}

function onAdminChange(on) {
  recPanel.hidden = !on;
  if (on) { try { localStorage.setItem(ADMIN_USED_KEY, "1"); } catch (e) {} } // shows "Record this route" later
  if (on) {
    cancelDirections();
    rec.layer.addTo(map);
  } else {
    map.removeLayer(rec.layer);
  }
  updateInsets();
}

function fillRecSelects() {
  const options = allPlaces.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  recFrom.innerHTML = `<option value="">Choose…</option>${options}`;
  recTo.innerHTML = `<option value="">Choose…</option>${options}`;
}

$("recToggle").addEventListener("click", () => {
  rec.open = !rec.open;
  recBody.hidden = !rec.open;
  $("recToggle").setAttribute("aria-expanded", String(rec.open));
  recPanel.classList.toggle("open", rec.open);
  if (rec.open) showToast("Recording: tap along the footpath to add points.");
});

function addRecPoint(latlng) {
  rec.points.push(L.latLng(latlng));
  redrawRec();
}

// Orange line + numbered, draggable dots (numbers = the "at" index)
function redrawRec() {
  rec.layer.clearLayers();
  rec.line = L.polyline(rec.points, { color: "#ff6b00", weight: 4, interactive: false }).addTo(rec.layer);
  rec.points.forEach((ll, i) => {
    const m = L.marker(ll, {
      draggable: true,
      zIndexOffset: 2000,
      icon: L.divIcon({ className: "rec-pt", html: `<span>${i}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
    });
    m.on("drag", (e) => {
      rec.points[i] = e.target.getLatLng();
      rec.line.setLatLngs(rec.points);
    });
    m.addTo(rec.layer);
  });
  $("recCount").textContent = rec.points.length ? `${rec.points.length} points` : "";
}

$("recUndo").addEventListener("click", () => {
  rec.points.pop();
  redrawRec();
});

$("recClear").addEventListener("click", () => {
  if (rec.points.length > 3 && !confirm("Clear all points?")) return;
  rec.points = [];
  rec.loadedSteps = null;
  rec.loadedReverse = null;
  recOut.hidden = true;
  redrawRec();
});

// Load an existing route to fine-tune it
$("recLoad").addEventListener("click", () => {
  const r = routes.find((x) => x.from === recFrom.value && x.to === recTo.value && isUsable(x));
  if (!r) {
    showToast("No saved route for this From → To yet.");
    return;
  }
  rec.points = r.path.map((p) => L.latLng(p[0], p[1]));
  rec.loadedSteps = r.steps || null;
  rec.loadedReverse = r.reverse_steps || null;
  redrawRec();
  map.flyToBounds(L.latLngBounds(rec.points), { padding: [40, 40], duration: 0.8 });
});

$("recCopy").addEventListener("click", () => {
  const from = recFrom.value, to = recTo.value;
  if (!from || !to) return showToast("Choose a From and a To place first.");
  if (from === to) return showToast("From and To must be different places.");
  if (rec.points.length < 2) return showToast("Add at least 2 points along the path.");

  const json = formatRoute({
    id: `${from}__${to}`,
    from,
    to,
    path: rec.points.map((p) => [+p.lat.toFixed(6), +p.lng.toFixed(6)]),
    steps: rec.loadedSteps || [{ text: "", at: 0, landmark: "", photo: "" }],
    reverse_steps: rec.loadedReverse,
  });

  // Always show it in the box too, in case copying is blocked (e.g. on http)
  recOut.value = json;
  recOut.hidden = false;
  if (navigator.clipboard) {
    navigator.clipboard
      .writeText(json)
      .then(() => showToast("Route JSON copied. Paste it into routes.json."))
      .catch(() => showToast("Couldn't copy automatically. Copy it from the box."));
  } else {
    showToast("Copy the route JSON from the box.");
  }
});

// Quick test: leave Admin mode and open the sample route straight away
const SAMPLE_ROUTE_ID = "entry-gate__division-of-admission-block";
$("sampleRouteBtn").addEventListener("click", () => {
  const r = routes.find((x) => x.id === SAMPLE_ROUTE_ID);
  const from = r && placesById[r.from];
  const to = r && placesById[r.to];
  if (!r || !isUsable(r) || !from || !to) {
    showToast("The sample route isn't in routes.json yet.");
    return;
  }
  adminToggle.checked = false;
  adminToggle.dispatchEvent(new Event("change")); // hides the recorder, clears the admin pin
  startDirections(to, from);
});

// Same layout as routes.json: one path point and one step per line
function formatRoute(r) {
  const J = JSON.stringify;
  const stepLine = (s) =>
    `    {"text": ${J(s.text || "")}, "at": ${parseInt(s.at, 10) || 0}, "landmark": ${J(s.landmark || "")}, "photo": ${J(s.photo || "")}}`;
  let out =
    `{\n  "id": ${J(r.id)},\n  "from": ${J(r.from)},\n  "to": ${J(r.to)},\n` +
    `  "path": [\n${r.path.map((p) => `    [${p[0]}, ${p[1]}]`).join(",\n")}\n  ],\n` +
    `  "steps": [\n${r.steps.map(stepLine).join(",\n")}\n  ]`;
  if (r.reverse_steps) out += `,\n  "reverse_steps": [\n${r.reverse_steps.map(stepLine).join(",\n")}\n  ]`;
  return out + "\n}";
}

// ---------- Start-up ----------
new ResizeObserver(updateInsets).observe($("sheet"));
new ResizeObserver(updateInsets).observe(dirTop);
new ResizeObserver(updateInsets).observe(dirPanel);
new ResizeObserver(updateInsets).observe(recPanel);
window.addEventListener("resize", updateInsets);
