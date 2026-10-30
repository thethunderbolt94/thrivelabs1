/* Hunter Express v2 · hero 2, "one city to three countries"
   The map (build/v2/net/net.py) is static by itself. This script pins the section and drives it with scroll:
   p 0 -> .06  the map fades in, Brampton alone
   p .05 -> .16 Canada lights (service-area tint, roads, fleet, terminals)   caption "2005"
   p .3  -> .42 the United States                                               caption "2006 -> 2017"
   p .57 -> .67 Mexico                                                          caption "2021"
   p .8  -> 1   closing caption + the numbers
   The fleet: the real road mesh (assets/v2/map/roads.json, build/map/build-roads.mjs) and 500+ dots routing across it,
   drawn on two canvases above the SVG; each country's roads and trucks appear with that country.
   Reduced motion / no JS: one static screen, everything lit. QA: window.HunterNet. */
(function () {
  'use strict';
  var doc = document, win = window, root = doc.documentElement;
  var reduce = root.classList.contains('rm');
  var sec = doc.getElementById('growth'), stage = doc.getElementById('growthStage'), mapEl = doc.getElementById('netMap');
  var svg = doc.getElementById('heroNet');
  if (!sec || !stage || !svg) return;
  var fine = win.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var now = function () { return (win.performance && performance.now) ? performance.now() : Date.now(); };
  var caps = [].slice.call(sec.querySelectorAll('.growth__cap'));
  var terms = [].slice.call(svg.querySelectorAll('.hn-term'));
  var termBeat = terms.map(function (t) { return +t.getAttribute('data-beat'); });

  /* ---- per-country coverage: clip the one tint shape with each country's land ---- */
  (function splitCoverage() {
    var NS = 'http://www.w3.org/2000/svg', cov = doc.getElementById('hnCov'); if (!cov) return;
    var defs = doc.createElementNS(NS, 'defs');
    ['ca', 'us', 'mx'].forEach(function (c) {
      var land = svg.querySelector('.hn-land__' + c); if (!land) return;
      var cp = doc.createElementNS(NS, 'clipPath'); cp.setAttribute('id', 'hnClip-' + c);
      var u = doc.createElementNS(NS, 'path'); u.setAttribute('d', land.getAttribute('d')); cp.appendChild(u); defs.appendChild(cp);
      var p = doc.createElementNS(NS, 'path'); p.setAttribute('class', 'hn-cov hn-cov--' + c); p.setAttribute('d', cov.getAttribute('d'));
      p.setAttribute('clip-path', 'url(#hnClip-' + c + ')'); cov.parentNode.insertBefore(p, cov);
    });
    svg.insertBefore(defs, svg.firstChild); cov.parentNode.removeChild(cov);
  })();

  /* ---- scroll progress -> beats ---- */
  var p = reduce ? 1 : 0, top = 0, span = 1, vh = 0, lastBeat = -1;
  var A = [reduce ? 1 : 0, reduce ? 1 : 0, reduce ? 1 : 0];   // country activation 0..1 (CA, US, MX)
  var WIN = [[.05, .16], [.3, .42], [.57, .67]];   // each country lights early in its own caption
  function smooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function measure() {
    vh = win.innerHeight; var r = sec.getBoundingClientRect(); top = r.top + win.scrollY; span = Math.max(1, sec.offsetHeight - vh);
    fleetResize();
  }
  function beatOf(x) { return x < .28 ? 0 : x < .56 ? 1 : x < .8 ? 2 : 3; }
  function applyScroll() {
    if (reduce) return;
    var y = win.scrollY || 0; p = Math.max(0, Math.min(1, (y - top) / span));
    for (var c = 0; c < 3; c++) A[c] = smooth(WIN[c][0], WIN[c][1], p);
    svg.style.setProperty('--a0', A[0].toFixed(3)); svg.style.setProperty('--a1', A[1].toFixed(3)); svg.style.setProperty('--a2', A[2].toFixed(3));
    mapEl.style.opacity = smooth(0, .06, p).toFixed(3);
    var b = beatOf(p);
    if (b !== lastBeat) {
      lastBeat = b; sec.setAttribute('data-beat', String(b)); sec.classList.toggle('is-end', b === 3);
      caps.forEach(function (el, i) { el.classList.toggle('is-on', i === b); });
    }
    terms.forEach(function (t, i) { t.classList.toggle('is-on', A[termBeat[i]] > .55); });
  }

  /* ---- the fleet (canvas) ---- */
  var fleet = { ok: false, on: false, trucks: [], N: fine ? 520 : 220, dpr: Math.min(2, win.devicePixelRatio || 1) };
  var roadsC = doc.createElement('canvas'), fleetC = doc.createElement('canvas');
  roadsC.className = 'net__roads'; fleetC.className = 'net__fleet';
  roadsC.setAttribute('aria-hidden', 'true'); fleetC.setAttribute('aria-hidden', 'true');
  mapEl.appendChild(roadsC); mapEl.appendChild(fleetC);
  var rctx = roadsC.getContext('2d'), fctx = fleetC.getContext('2d');
  var VB = (svg.getAttribute('viewBox') || '0 0 1000 796').split(/\s+/).map(Number);
  var fit = { s: 1, ox: 0, oy: 0, w: 0, h: 0 };
  function fleetResize() {
    var w = mapEl.clientWidth, h = mapEl.clientHeight; if (!w || !h) return;
    fit.w = w; fit.h = h; fit.s = Math.min(w / VB[2], h / VB[3]);
    fit.ox = (w - VB[2] * fit.s) / 2 - VB[0] * fit.s; fit.oy = (h - VB[3] * fit.s) / 2 - VB[1] * fit.s;
    [roadsC, fleetC].forEach(function (c) { c.width = Math.round(w * fleet.dpr); c.height = Math.round(h * fleet.dpr); c.style.width = w + 'px'; c.style.height = h + 'px'; });
    if (fleet.ok) { paths = null; lastA = null; drawRoads(); drawFleet(); }
  }
  function X(x) { return fit.ox + x * fit.s; }
  function Y(y) { return fit.oy + y * fit.s; }
  var G = null, paths = null;   // graph; Path2D per [country][major] for the mesh
  function buildGraph(d) {
    var nodes = new Float32Array(d.n), edges = [], adj = [];
    for (var i = 0; i < d.n.length / 2; i++) adj.push([]);
    d.e.forEach(function (e, idx) {
      var a = e[0], b = e[1], pts = [nodes[a * 2], nodes[a * 2 + 1]];
      for (var k = 5; k < e.length; k++) pts.push(e[k]);
      pts.push(nodes[b * 2], nodes[b * 2 + 1]);
      var cum = [0]; for (k = 2; k < pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]));
      edges.push({ a: a, b: b, m: e[2], c: e[3], len: cum[cum.length - 1] || .1, pts: new Float32Array(pts), cum: new Float32Array(cum) });
      adj[a].push(idx); adj[b].push(idx);
    });
    G = { nodes: nodes, edges: edges, adj: adj };
  }
  function buildPaths() {
    paths = [[], [], []];
    for (var c = 0; c < 3; c++) for (var m = 0; m < 2; m++) paths[c][m] = new Path2D();
    for (var i = 0; i < G.edges.length; i++) {
      var e = G.edges[i], P = paths[e.c][e.m];
      P.moveTo(X(e.pts[0]), Y(e.pts[1]));
      for (var k = 2; k < e.pts.length; k += 2) P.lineTo(X(e.pts[k]), Y(e.pts[k + 1]));
    }
  }
  function edgePoint(e, d, out) {
    var cum = e.cum, n = cum.length - 1, lo = 0, hi = n;
    if (d <= 0) { out[0] = e.pts[0]; out[1] = e.pts[1]; return; }
    if (d >= e.len) { out[0] = e.pts[n * 2]; out[1] = e.pts[n * 2 + 1]; return; }
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    var f = (d - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
    out[0] = e.pts[lo * 2] + (e.pts[hi * 2] - e.pts[lo * 2]) * f; out[1] = e.pts[lo * 2 + 1] + (e.pts[hi * 2 + 1] - e.pts[lo * 2 + 1]) * f;
  }
  function seedFleet() {
    var total = 0; G.edges.forEach(function (e) { total += e.len * (e.m ? 2.2 : 1); });
    fleet.trucks = [];
    for (var i = 0; i < fleet.N; i++) {
      var r = Math.random() * total, acc = 0, ei = 0;
      for (var k = 0; k < G.edges.length; k++) { acc += G.edges[k].len * (G.edges[k].m ? 2.2 : 1); if (acc >= r) { ei = k; break; } }
      var e = G.edges[ei];
      fleet.trucks.push({ e: ei, d: Math.random() * e.len, dir: Math.random() < .5 ? 1 : -1, v: 5.5 + Math.random() * 4.5, x: 0, y: 0, px: 0, py: 0, w: .8 + Math.random() * .5 });
    }
    var o = [0, 0];
    fleet.trucks.forEach(function (t) { edgePoint(G.edges[t.e], t.d, o); t.x = t.px = o[0]; t.y = t.py = o[1]; });
  }
  function nextEdge(node, from) {
    var list = G.adj[node]; if (list.length === 1) return from;
    var best = -1, bw = -1;
    for (var i = 0; i < list.length; i++) { var ei = list[i]; if (ei === from) continue; var w = (G.edges[ei].m ? 3 : 1) * (.4 + Math.random()); if (w > bw) { bw = w; best = ei; } }
    return best < 0 ? from : best;
  }
  var _o = [0, 0];
  function stepFleet(dt) {
    for (var i = 0; i < fleet.trucks.length; i++) {
      var t = fleet.trucks[i], e = G.edges[t.e];
      if (A[e.c] <= 0) continue;
      t.d += t.v * t.dir * dt;
      if (t.d > e.len || t.d < 0) {
        var node = t.d > e.len ? e.b : e.a, ne = nextEdge(node, t.e), e2 = G.edges[ne];
        t.e = ne; t.dir = (e2.a === node) ? 1 : -1; t.d = t.dir === 1 ? 0 : e2.len;
      }
      t.px = t.x; t.py = t.y; edgePoint(G.edges[t.e], t.d, _o); t.x = _o[0]; t.y = _o[1];
    }
  }
  var lastA = null;
  function drawRoads() {
    if (!paths) buildPaths();
    var c = rctx, k = fleet.dpr; c.setTransform(k, 0, 0, k, 0, 0); c.clearRect(0, 0, fit.w, fit.h);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (var cc = 0; cc < 3; cc++) {
      if (A[cc] <= 0) continue;
      c.strokeStyle = 'rgba(243, 239, 231, ' + (.085 * A[cc]).toFixed(3) + ')'; c.lineWidth = Math.max(.5, .6 * fit.s); c.stroke(paths[cc][0]);
      c.strokeStyle = 'rgba(243, 239, 231, ' + (.17 * A[cc]).toFixed(3) + ')'; c.lineWidth = Math.max(.7, .9 * fit.s); c.stroke(paths[cc][1]);
    }
    lastA = A.slice();
  }
  function drawFleet() {
    var c = fctx, k = fleet.dpr; c.setTransform(k, 0, 0, k, 0, 0); c.clearRect(0, 0, fit.w, fit.h);
    var r = Math.max(1.1, 1.3 * fit.s * (fine ? 1 : 1.5));
    c.lineCap = 'round';
    for (var cc = 0; cc < 3; cc++) {
      var a = A[cc]; if (a <= 0) continue;
      c.beginPath();
      for (var i = 0; i < fleet.trucks.length; i++) {
        var t = fleet.trucks[i]; if (G.edges[t.e].c !== cc) continue;
        var dx = t.x - t.px, dy = t.y - t.py;
        c.moveTo(X(t.x - dx * 6), Y(t.y - dy * 6)); c.lineTo(X(t.x), Y(t.y));
      }
      c.strokeStyle = 'rgba(255, 226, 184, ' + (.5 * a).toFixed(3) + ')'; c.lineWidth = r * .9; c.stroke();
      c.fillStyle = 'rgba(255, 226, 184, ' + (.18 * a).toFixed(3) + ')'; c.beginPath();
      for (i = 0; i < fleet.trucks.length; i++) { t = fleet.trucks[i]; if (G.edges[t.e].c !== cc) continue; c.moveTo(X(t.x) + r * 2.6, Y(t.y)); c.arc(X(t.x), Y(t.y), r * 2.6, 0, 6.2832); }
      c.fill();
      c.fillStyle = 'rgba(255, 246, 228, ' + (.95 * a).toFixed(3) + ')'; c.beginPath();
      for (i = 0; i < fleet.trucks.length; i++) { t = fleet.trucks[i]; if (G.edges[t.e].c !== cc) continue; c.moveTo(X(t.x) + r * t.w, Y(t.y)); c.arc(X(t.x), Y(t.y), r * t.w, 0, 6.2832); }
      c.fill();
    }
  }
  function loadFleet() {
    if (!win.fetch || !win.Path2D) return;
    fetch('assets/v2/map/roads.json').then(function (r) { return r.json(); }).then(function (d) {
      buildGraph(d); fleet.ok = true; fleetResize(); seedFleet(); drawRoads(); drawFleet();
      fleet.on = true; sec.classList.add('is-fleet'); kick();
    }).catch(function () {});
  }

  /* ---- tilt (pointer) + the frame loop ---- */
  var tx = 0, ty = 0, cx = 0, cy = 0, visible = true, raf = 0, lastT = 0;
  if (fine && !reduce) {
    sec.addEventListener('pointermove', function (e) { var r = stage.getBoundingClientRect(); tx = (e.clientX - r.left) / r.width - .5; ty = (e.clientY - r.top) / r.height - .5; });
    sec.addEventListener('pointerleave', function () { tx = 0; ty = 0; });
  }
  function frame() {
    raf = 0;
    if (!visible || doc.hidden) return;
    var t = now(), dt = Math.min(.05, (t - lastT) / 1000); lastT = t;
    if (!reduce) {
      applyScroll();
      cx += (tx - cx) * .075; cy += (ty - cy) * .075;
      mapEl.style.transform = 'translate3d(' + (cx * 20).toFixed(2) + 'px,' + (cy * 14).toFixed(2) + 'px,0) rotateX(' + (-cy * 5).toFixed(2) + 'deg) rotateY(' + (cx * 7).toFixed(2) + 'deg)';
    }
    if (fleet.on) {
      if (!lastA || lastA[0] !== A[0] || lastA[1] !== A[1] || lastA[2] !== A[2]) drawRoads();
      if (!reduce) stepFleet(dt);
      drawFleet();
    }
    if (!reduce || fleet.on) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) { lastT = now(); raf = requestAnimationFrame(frame); } }

  if ('IntersectionObserver' in win) {
    new IntersectionObserver(function (es) { es.forEach(function (e) { visible = e.isIntersecting; if (visible) kick(); }); }, { threshold: 0 }).observe(sec);
  }
  doc.addEventListener('visibilitychange', function () { if (!doc.hidden) kick(); });
  win.addEventListener('resize', measure);
  win.addEventListener('scroll', function () { if (visible) kick(); }, { passive: true });

  if (!reduce) { sec.classList.add('is-live'); measure(); applyScroll(); }
  else { measure(); }
  loadFleet();
  kick();

  win.HunterNet = {
    p: function () { return p; }, A: function () { return A.slice(); },
    state: function () { return { live: sec.classList.contains('is-live'), beat: sec.getAttribute('data-beat'), p: +p.toFixed(3), A: A.map(function (v) { return +v.toFixed(2); }), fleet: fleet.on, trucks: fleet.trucks.length, edges: G ? G.edges.length : 0, visible: visible }; },
    scrollTo: function (x) { win.scrollTo(0, Math.round(top + x * span)); }
  };
})();
