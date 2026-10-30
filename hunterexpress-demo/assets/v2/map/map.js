/*!
 * HunterMap - behaviour layer for the pre-rendered Hunter Express coverage map (map.svg / map-inline.html).
 * Plain IIFE, no dependencies. API: HunterMap.init(svg, opts), .focusLeg(from,to), .hoverTerminal(id|null),
 * .getLegInfo(from,to), .replay(), .pause(), .play(), .destroy().
 * The Vancouver lane (#lane-vancouver, data-lane-* attributes) is a secondary lane that joins the corridor at Brampton;
 * 'vancouver' is accepted as a leg id: km = corridor km (Brampton to the other end) + data-lane-km.
 */
(function (global) {
  'use strict';

  var TRUCK_KM_PER_DAY_TEAM = 1000;
  var TRUCK_KM_PER_DAY_SOLO = 800;
  var current = null; // most recently initialised instance (static helpers delegate to it)

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var smooth = function (x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  var easeInOutCubic = function (x) { return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

  function init(svg, opts) {
    if (!svg || !svg.querySelector) throw new Error('HunterMap.init: pass the <svg> element');
    if (svg.__hunterMap) svg.__hunterMap.destroy();

    var o = {
      loopSeconds: 14,      // Brampton -> Saltillo truck run
      drawSeconds: 2.4,     // corridor reveal
      gapSeconds: 1.1,      // rest between truck runs
      slowZone: 0.022,      // half-width (fraction of path) of the slow-down around each terminal
      minSpeed: 0.2,        // relative truck speed right at a terminal
      threshold: 0.15,      // IntersectionObserver visibility ratio
      autoplay: true,
      onHover: null,        // function (terminalId|null)
      onSelect: null        // function (terminalId)
    };
    for (var k in (opts || {})) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];

    var NS = 'http://www.w3.org/2000/svg';
    var path = svg.querySelector('#corridorPath');
    if (!path) throw new Error('HunterMap.init: #corridorPath not found');
    var glow = svg.querySelector('#corridorGlow');
    var truck = svg.querySelector('#truck');
    var truckBody = truck && truck.querySelector('.truck-body');
    var drawEls = [].slice.call(svg.querySelectorAll('#corridor .corridor-line, #corridor .corridor-glow, #corridor .corridor-casing'));
    var terminalEls = [].slice.call(svg.querySelectorAll('#terminals .terminal'));
    var stopEls = [].slice.call(svg.querySelectorAll('#stops .stop'));
    var total = path.getTotalLength();
    var legs = [];
    try { legs = JSON.parse(path.getAttribute('data-legs') || '[]'); } catch (e) { legs = []; }
    var legById = {}; legs.forEach(function (l) { legById[l.id] = l; });
    // secondary lane that hangs off the corridor (Vancouver). Everything comes from the build's data-lane-* attributes.
    var lanePath = svg.querySelector('#lane-vancouver'), lane = null;
    if (lanePath) {
      var lvia = []; try { lvia = JSON.parse(lanePath.getAttribute('data-lane-via') || '[]'); } catch (e) { lvia = []; }
      lane = {
        id: lanePath.getAttribute('data-lane-to'),                       // leg id of the far end ('vancouver')
        name: (lanePath.getAttribute('data-lane-to-name') || '').split(',')[0],
        full: lanePath.getAttribute('data-lane-to-name') || '',
        join: lanePath.getAttribute('data-lane-from'),                  // corridor leg where it joins ('brampton')
        km: parseFloat(lanePath.getAttribute('data-lane-km')) || 0,
        via: lvia.sort(function (a, b) { return a.f - b.f; }).map(function (v) { return v.name; }) // join -> far end
      };
      if (!lane.id || !lane.join || !lane.km) lane = null;
    }
    var mql = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    var reduce = !!mql.matches;

    var terminals = {};
    terminalEls.forEach(function (el, i) {
      var id = el.getAttribute('data-id');
      terminals[id] = el;
      el.style.setProperty('--hx-delay', (i * 0.42).toFixed(2) + 's');
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', (el.getAttribute('data-name') || id) + ' - ' + (el.getAttribute('data-sub') || ''));
    });

    /* ---------- truck speed profile: slow near every terminal, then normalise to one loop ---------- */
    var stopT = [];
    legs.forEach(function (l) { if (l.terminal && stopT.indexOf(l.t) < 0) stopT.push(l.t); });
    var N = 720, tau = new Float32Array(N + 1);
    (function () {
      var acc = 0; tau[0] = 0;
      for (var i = 1; i <= N; i++) {
        var s = (i - 0.5) / N, d = 1;
        for (var j = 0; j < stopT.length; j++) d = Math.min(d, Math.abs(s - stopT[j]));
        var v = o.minSpeed + (1 - o.minSpeed) * smooth(d / o.slowZone);
        acc += 1 / (N * v);
        tau[i] = acc;
      }
      for (var q = 0; q <= N; q++) tau[q] /= acc; // 0..1 over the whole path
    })();
    function sOfTau(u) { // inverse lookup: normalised time -> path fraction
      var lo = 0, hi = N;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (tau[mid] <= u) lo = mid; else hi = mid; }
      var span = tau[hi] - tau[lo] || 1e-9;
      return (lo + (u - tau[lo]) / span) / N;
    }
    function tauOfS(s) {
      var f = clamp(s, 0, 1) * N, i = Math.min(N - 1, Math.floor(f));
      return tau[i] + (tau[i + 1] - tau[i]) * (f - i);
    }

    /* ---------- state ---------- */
    var raf = 0, visible = false, started = false, drawn = false, destroyed = false, paused = false;
    var drawStart = 0, runStart = 0, lastAngle = null;
    var range = [0, 1];           // truck sub-range (focusLeg narrows this)
    var focusEl = null, laneFocusEl = null, hoverId = null, io = null, noTruck = false;

    function setAnimClass() {
      var on = visible && !reduce && !paused && !document.hidden;
      svg.classList.toggle('is-animated', on);
    }

    /* ---------- reveal ---------- */
    function setDraw(p) {
      var L = total.toFixed(1);
      drawEls.forEach(function (el) { el.style.strokeDasharray = L + ' ' + L; el.style.strokeDashoffset = (total * (1 - p)).toFixed(1); });
      terminalEls.forEach(function (el) {
        var t = parseFloat(el.getAttribute('data-t')) || 0;
        el.style.opacity = clamp((p - t) / 0.05 + (t === 0 ? 1 : 0), 0, 1).toFixed(2);
      });
      stopEls.forEach(function (el) {
        var l = legById[el.getAttribute('data-id')];
        el.style.opacity = l ? clamp((p - l.t) / 0.04, 0, 1).toFixed(2) : 1;
      });
    }
    function finishDraw() {
      drawEls.forEach(function (el) { el.style.strokeDasharray = ''; el.style.strokeDashoffset = ''; });
      terminalEls.forEach(function (el) { el.style.opacity = ''; });
      stopEls.forEach(function (el) { el.style.opacity = ''; });
      drawn = true;
    }
    function placeTruck(s, snap) {
      if (!truck) return;
      var len = s * total, p = path.getPointAtLength(len);
      var a = path.getPointAtLength(clamp(len - 2.5, 0, total)), b = path.getPointAtLength(clamp(len + 2.5, 0, total));
      var ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if (lastAngle === null || snap) lastAngle = ang;
      var diff = ((ang - lastAngle + 540) % 360) - 180;
      lastAngle += diff * 0.18;
      truck.setAttribute('transform', 'translate(' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + ')');
      if (truckBody) truckBody.setAttribute('transform', 'rotate(' + lastAngle.toFixed(1) + ')');
    }
    function truckVisible(v) { if (truck) truck.style.opacity = v; }

    /* ---------- frame loop ---------- */
    function frame(now) {
      raf = 0;
      if (destroyed || !visible || paused || document.hidden) return;
      if (!drawn) {
        var p = clamp((now - drawStart) / (o.drawSeconds * 1000), 0, 1);
        setDraw(easeInOutCubic(p));
        if (p >= 1) { finishDraw(); runStart = now; lastAngle = null; }
        else { raf = requestAnimationFrame(frame); return; }
      }
      if (!reduce) {
        if (noTruck) { truckVisible(0); raf = requestAnimationFrame(frame); return; } // lane-only focus: the truck stays on the corridor
        var dur = Math.max(3, o.loopSeconds * (range[1] - range[0])) * 1000;
        var cyc = dur + o.gapSeconds * 1000;
        var el = (now - runStart) % cyc;
        if (el > dur) { truckVisible(0); }
        else {
          var u = el / dur;
          var tau0 = tauOfS(range[0]), tau1 = tauOfS(range[1]);
          var s = sOfTau(tau0 + (tau1 - tau0) * u);
          placeTruck(s, el < 40);
          truckVisible(clamp(Math.min(u / 0.04, (1 - u) / 0.035), 0, 1).toFixed(2));
        }
        raf = requestAnimationFrame(frame);
      }
    }
    function kick() {
      if (raf || destroyed) return;
      raf = requestAnimationFrame(function (now) {
        if (!started) { started = true; drawStart = now; }
        frame(now);
      });
    }
    function begin() {
      if (reduce) { // static: corridor complete, no truck motion
        finishDraw(); if (truck) truck.style.display = 'none'; setAnimClass(); return;
      }
      if (truck) { truck.style.display = ''; truckVisible(0); }
      if (!drawn) { setDraw(0); started = false; }
      setAnimClass(); kick();
    }

    function onVis(entries) {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) { if (o.autoplay !== false && !paused) begin(); else { setAnimClass(); } }
      else { setAnimClass(); if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    }
    if ('IntersectionObserver' in global) {
      io = new IntersectionObserver(onVis, { threshold: o.threshold });
      io.observe(svg);
    } else { visible = true; begin(); }

    function onVisibility() { setAnimClass(); if (!document.hidden && visible && !paused) { if (drawn) runStart = runStart || performance.now(); kick(); } }
    document.addEventListener('visibilitychange', onVisibility);
    function onMq() {
      reduce = !!mql.matches;
      if (reduce) { if (raf) cancelAnimationFrame(raf), raf = 0; finishDraw(); if (truck) truck.style.display = 'none'; setAnimClass(); }
      else if (visible) { drawn = true; if (truck) truck.style.display = ''; runStart = performance.now(); setAnimClass(); kick(); }
    }
    if (mql.addEventListener) mql.addEventListener('change', onMq); else if (mql.addListener) mql.addListener(onMq);

    /* ---------- terminals: hover / focus / click ---------- */
    function hoverTerminal(id) {
      if (hoverId && terminals[hoverId]) terminals[hoverId].classList.remove('is-hover');
      hoverId = (id && terminals[id]) ? id : null;
      if (hoverId) terminals[hoverId].classList.add('is-hover');
      svg.classList.toggle('has-hover', !!hoverId);
    }
    var handlers = [];
    terminalEls.forEach(function (el) {
      var id = el.getAttribute('data-id');
      var enter = function () { hoverTerminal(id); if (o.onHover) o.onHover(id); };
      var leave = function () { hoverTerminal(null); if (o.onHover) o.onHover(null); };
      var click = function () { if (o.onSelect) o.onSelect(id); };
      var key = function (e) { if ((e.key === 'Enter' || e.key === ' ') && o.onSelect) { e.preventDefault(); o.onSelect(id); } };
      el.addEventListener('mouseenter', enter); el.addEventListener('mouseleave', leave);
      el.addEventListener('focus', enter); el.addEventListener('blur', leave);
      el.addEventListener('click', click); el.addEventListener('keydown', key);
      handlers.push([el, enter, leave, click, key]);
    });

    /* ---------- legs ---------- */
    function daysFor(km) {
      return {
        days: { team: Math.max(1, Math.ceil(km / TRUCK_KM_PER_DAY_TEAM)), solo: Math.max(1, Math.ceil(km / TRUCK_KM_PER_DAY_SOLO)) },
        daysRaw: { team: +(km / TRUCK_KM_PER_DAY_TEAM).toFixed(2), solo: +(km / TRUCK_KM_PER_DAY_SOLO).toFixed(2) }
      };
    }
    function getLegInfo(from, to) {
      var isLane = function (id) { return !!lane && id === lane.id; };
      var a = isLane(from) ? null : legById[from], b = isLane(to) ? null : legById[to];
      if ((!a && !isLane(from)) || (!b && !isLane(to))) return null;
      if (isLane(from) || isLane(to)) {
        if (isLane(from) && isLane(to)) {
          return { from: from, to: to, fromName: lane.name, toName: lane.name, km: 0, miles: 0, days: { team: 1, solo: 1 }, daysRaw: { team: 0, solo: 0 }, t: [0, 0], corridorKm: 0, corridorT: null, laneKm: 0, laneFirst: true, laneVia: [] };
        }
        var laneFirst = isLane(from);
        var other = laneFirst ? b : a, join = legById[lane.join];
        if (!join) return null;
        var corrKm = Math.abs(other.km - join.km);
        var km = corrKm + lane.km, d = daysFor(km);
        var t = [Math.min(join.t, other.t), Math.max(join.t, other.t)];
        return {
          from: from, to: to, fromName: laneFirst ? lane.name : a.name, toName: laneFirst ? b.name : lane.name,
          km: km, miles: Math.round(km * 0.621371), days: d.days, daysRaw: d.daysRaw,
          t: t,                                   // corridor part of the leg (zero-length when the other end is the join)
          corridorKm: corrKm, corridorT: corrKm > 0 ? t : null,
          laneKm: lane.km, laneFirst: laneFirst,
          laneVia: laneFirst ? lane.via.slice().reverse() : lane.via.slice()   // in travel order
        };
      }
      var km2 = Math.abs(b.km - a.km), d2 = daysFor(km2);
      return {
        from: from, to: to, fromName: a.name, toName: b.name,
        km: km2, miles: Math.round(km2 * 0.621371),
        days: d2.days, daysRaw: d2.daysRaw,
        t: [Math.min(a.t, b.t), Math.max(a.t, b.t)]
      };
    }
    function clearFocus() {
      svg.classList.remove('is-focus', 'is-focus-lane');
      terminalEls.forEach(function (el) { el.classList.remove('out-leg'); });
      if (focusEl) { focusEl.style.strokeDasharray = ''; focusEl.style.opacity = ''; }
      if (laneFocusEl) { laneFocusEl.style.strokeDasharray = ''; laneFocusEl.style.strokeDashoffset = ''; }
      noTruck = false;
      range = [0, 1];
      runStart = performance.now();
    }
    function cloneFocus(id, cls) { // a clone of a path, shown as a bright dash window above it
      var el = svg.querySelector('#' + id);
      if (el) return el;
      var src = id === 'laneFocus' ? lanePath : path;
      el = src.cloneNode(false);
      ['data-legs', 'data-total', 'data-lane-via', 'data-lane-from', 'data-lane-to', 'data-lane-to-name', 'data-lane-km', 'data-lane-km-raw', 'data-name'].forEach(function (a) { el.removeAttribute(a); });
      el.id = id; el.setAttribute('class', cls);
      el.style.transition = 'stroke-dasharray .7s cubic-bezier(.2,.7,.2,1), stroke-dashoffset .7s cubic-bezier(.2,.7,.2,1)';
      var host = (focusEl && focusEl.parentNode) || path.parentNode;
      host.insertBefore(el, path.nextSibling);
      return el;
    }
    function focusLeg(from, to) {
      if (!from) { clearFocus(); return null; }
      var info = getLegInfo(from, to || from);
      if (!info) { clearFocus(); return null; }
      var t0 = info.t[0], t1 = info.t[1];
      var onLane = info.laneKm !== undefined && info.laneKm > 0;      // the leg includes the Vancouver lane
      var hasCorridor = onLane ? info.corridorT !== null : true;       // ...and/or a stretch of the main corridor
      if (hasCorridor) {
        if (focusEl) focusEl.style.opacity = '';
        var len = Math.max((t1 - t0) * total, 6);
        if (!focusEl) focusEl = cloneFocus('corridorFocus', 'corridor-focus');
        focusEl.style.strokeDasharray = '0.01 ' + (total * 2).toFixed(1);
        focusEl.style.strokeDashoffset = (-t0 * total).toFixed(1);
        void focusEl.getBoundingClientRect(); // commit start state so the dash window animates open
        focusEl.style.strokeDasharray = len.toFixed(1) + ' ' + (total * 2).toFixed(1);
      } else if (focusEl) { focusEl.style.opacity = '0'; }
      if (onLane && lanePath) {
        var lt = lanePath.getTotalLength();
        if (!laneFocusEl) laneFocusEl = cloneFocus('laneFocus', 'lane-focus');
        laneFocusEl.style.strokeDashoffset = '0';
        laneFocusEl.style.strokeDasharray = '0.01 ' + (lt * 2).toFixed(1);
        void laneFocusEl.getBoundingClientRect();
        laneFocusEl.style.strokeDasharray = lt.toFixed(1) + ' ' + (lt * 2).toFixed(1);   // drawn outward from the join at Brampton
        svg.classList.add('is-focus-lane');
      } else { svg.classList.remove('is-focus-lane'); if (laneFocusEl) laneFocusEl.style.strokeDasharray = ''; }
      svg.classList.add('is-focus');
      terminalEls.forEach(function (el) {
        var t = parseFloat(el.getAttribute('data-t'));
        el.classList.toggle('out-leg', !(t >= t0 - 0.012 && t <= t1 + 0.012));
      });
      noTruck = !hasCorridor;
      range = [t0, t1 > t0 ? t1 : Math.min(1, t0 + 0.02)];
      runStart = performance.now();
      return info;
    }

    function destroy() {
      destroyed = true; if (raf) cancelAnimationFrame(raf);
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      if (mql.removeEventListener) mql.removeEventListener('change', onMq);
      handlers.forEach(function (h) { var el = h[0]; el.removeEventListener('mouseenter', h[1]); el.removeEventListener('mouseleave', h[2]); el.removeEventListener('focus', h[1]); el.removeEventListener('blur', h[2]); el.removeEventListener('click', h[3]); el.removeEventListener('keydown', h[4]); });
      svg.classList.remove('is-animated', 'is-focus', 'is-focus-lane', 'has-hover'); svg.__hunterMap = null;
      if (current === inst) current = null;
    }

    var inst = {
      svg: svg,
      legs: legs,
      lane: lane,
      focusLeg: focusLeg,
      hoverTerminal: hoverTerminal,
      getLegInfo: getLegInfo,
      replay: function () { drawn = false; started = false; lastAngle = null; focusLeg(null); if (visible) begin(); },
      pause: function () { paused = true; setAnimClass(); if (raf) { cancelAnimationFrame(raf); raf = 0; } },
      play: function () { paused = false; setAnimClass(); if (visible) { if (!drawn) begin(); else { runStart = performance.now(); kick(); } } },
      destroy: destroy,
      /* test hook: jump straight to a state without waiting for IntersectionObserver */
      _debug: { total: total, setTruck: function (s) { finishDraw(); truck.style.opacity = 1; truck.style.display = ''; placeTruck(s, true); }, finish: finishDraw }
    };
    svg.__hunterMap = inst;
    current = inst;
    return inst;
  }

  function delegate(name) { return function () { if (!current) return null; return current[name].apply(current, arguments); }; }

  global.HunterMap = {
    init: init,
    focusLeg: delegate('focusLeg'),
    hoverTerminal: delegate('hoverTerminal'),
    getLegInfo: delegate('getLegInfo'),
    replay: delegate('replay'),
    pause: delegate('pause'),
    play: delegate('play'),
    destroy: delegate('destroy')
  };
})(typeof window !== 'undefined' ? window : this);
