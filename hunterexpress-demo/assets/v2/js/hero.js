/* Hunter Express v2 · hero: "The Drive"
   One continuous, scroll-driven shot from Brampton to Saltillo. No canvas, no video, no frames.

   - The markup is a complete static page without this file: opening frame, the lit route (SVG),
     the five stops stacked, the end CTAs. That is also what reduced motion (.rm) gets; this file then does nothing.
   - This file adds .drive-on (CSS pins the section with position: sticky) and renders every frame from
     one number, p (0..1 through the pinned scroll):
       km(p)   monotone cubic through the stop keyframes (so the truck eases into stops and never reverses)
       t(km)   piecewise linear over the corridor's data-legs (km at each waypoint, t = fraction of path length),
               so the odometer reads 308 at Belle River, 362 at Romulus, 2,822 at Laredo, 3,121 at Saltillo
       camera  follows the truck (a little behind it), then eases out to frame the whole route
   - p comes from ScrollTrigger (scrub .3) when GSAP is present, else straight from the scroll position.
     A settle timer snaps p to the raw scroll position once scrolling stops, so no state waits on GSAP's ticker.
   - Any error puts the section back to the static page. */
(function () {
  'use strict';

  var doc = document, root = doc.documentElement, win = window;
  var hero = doc.getElementById('top'), svg = doc.getElementById('driveMap');
  if (!hero || !svg || root.classList.contains('rm') || !win.requestAnimationFrame || !svg.getBBox) return;

  var STATIC_VB = svg.getAttribute('viewBox');
  var touched = [];   // elements whose inline style/transform we write, cleared if we fall back
  var dead = false;

  /* ---------------- timeline (p = progress through the pinned scroll) ---------------- */
  // [p, km]: dwell = two keys with the same km
  var KM_KEYS = [[0, 0], [.15, 0], [.27, 308], [.30, 339], [.325, 362], [.345, 362], [.47, 1150], [.49, 1150],
                 [.65, 2822], [.68, 2828], [.755, 3047], [.79, 3121], [1, 3121]];
  // [p, zoom as a multiple of the whole-route fit]
  var ZOOM_KEYS = [[0, 3.9], [.14, 3.2], [.27, 3.0], [.33, 2.9], [.40, 2.1], [.47, 1.85], [.56, 1.7], [.63, 2.4],
                   [.70, 2.8], [.79, 3.0], [.845, 2.8], [.95, 1], [1, 1]];
  var LAG = .02;                       // camera trails the truck by this much p (the truck leads in motion, camera settles at stops)
  var OPEN_OUT = [.035, .085];          // opening copy leaves
  var PHOTO_OUT = [.05, .135];          // yard photo dissolves into the map
  var HUD_IN = [.085, .13];             // odometer, rail, grid
  var FIT = [.83, .95];                 // camera eases out to the whole route
  var END_IN = [.885, .915];            // end headline + CTAs
  var CO = [
    { id: 'brampton', at: 'brampton', w: [.105, .125, .215, .235], go: .17 },
    { id: 'windsor-detroit', at: 'windsor-detroit', w: [.245, .265, .375, .395], go: .30 },
    { id: 'nashville', at: 'nashville', w: [.425, .445, .53, .55], go: .48 },
    { id: 'laredo', at: 'laredo', w: [.60, .62, .705, .725], go: .655 },
    { id: 'saltillo', at: 'saltillo', w: [.735, .755, .86, .88], go: .80 }
  ];
  var RAIL_P = [0, .30, .47, .65, .79];  // when the truck reaches each rail stop
  var PLACE = {
    brampton: 'Brampton, ON', london: 'London, ON', 'belle-river': 'Belle River, ON', windsor: 'Windsor, ON',
    detroit: 'Detroit, MI', romulus: 'Romulus, MI', toledo: 'Toledo, OH', dayton: 'Dayton, OH', cincinnati: 'Cincinnati, OH',
    louisville: 'Louisville, KY', nashville: 'Nashville, TN', memphis: 'Memphis, TN', 'little-rock': 'Little Rock, AR',
    texarkana: 'Texarkana, AR', dallas: 'Dallas, TX', austin: 'Austin, TX', 'san-antonio': 'San Antonio, TX',
    laredo: 'Laredo, TX', 'nuevo-laredo': 'Nuevo Laredo, MX', monterrey: 'Monterrey, MX', saltillo: 'Saltillo, MX'
  };

  /* ---------------- helpers ---------------- */
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  var fmt = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  function win4(p, w) { return Math.min(smooth(w[0], w[1], p), 1 - smooth(w[2], w[3], p)); }

  // Fritsch–Carlson monotone cubic: no overshoot, flat keys give zero slope (eases into and out of dwells)
  function monotone(keys) {
    var n = keys.length, xs = [], ys = [], d = [], m = [], i;
    for (i = 0; i < n; i++) { xs.push(keys[i][0]); ys.push(keys[i][1]); }
    for (i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
      if (h > 9) { var k = 3 / Math.sqrt(h); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
    }
    return function (x) {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      var j = 0; while (x > xs[j + 1]) j++;
      var hh = xs[j + 1] - xs[j], t = (x - xs[j]) / hh, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[j] + (t3 - 2 * t2 + t) * hh * m[j] + (-2 * t3 + 3 * t2) * ys[j + 1] + (t3 - t2) * hh * m[j + 1];
    };
  }
  var KM = monotone(KM_KEYS), ZOOM = monotone(ZOOM_KEYS);

  /* ---------------- DOM ---------------- */
  var $ = function (s, c) { return (c || hero).querySelector(s); };
  var $$ = function (s, c) { return [].slice.call((c || hero).querySelectorAll(s)); };
  var stage = $('.drive__sticky'), world = $('#dmWorld'), hud = $('#dmHud');
  var photo = $('.drive__photo'), open = $('.drive__open'), grid = $('.drive__grid');
  var endEl = $('.drive__end'), odo = $('.drive__odo'), rail = $('.drive__rail'), hint = $('.drive__hint');
  var kmEl = $('#driveKm'), placeEl = $('#drivePlace'), railFill = $('#driveRailFill');
  var railItems = $$('.drive__rail li');
  var line = $('.dm-line'), glows = $$('.dm-glow'), ghost = $('.dm-ghost');
  var land = $('.dm-land'), lakes = $('.dm-lakes'), borders = $('.dm-borders'), bounds = $$('.dm-bound');
  var truck = $('#dmTruck'), truckR = $('.dm-truck__r'), leadersG = $('#dmLeaders');
  var legs = JSON.parse(svg.getAttribute('data-legs'));
  var crossings = JSON.parse(svg.getAttribute('data-cross'));
  var xlabels = $$('.dm-xlabel').map(function (el) {
    var id = el.getAttribute('data-id'), c = crossings.filter(function (x) { return x.id === id; })[0];
    return { el: el, t: c.t, km: c.km, on: -1 };
  });

  /* path lookup table (hero units) */
  var N = 1200, LUT = [];
  var stops, co = [];

  function tOfKm(km) {
    for (var i = 0; i < legs.length - 1; i++) {
      var a = legs[i], b = legs[i + 1];
      if (km <= b.km) return b.km === a.km ? a.t : lerp(a.t, b.t, clamp((km - a.km) / (b.km - a.km), 0, 1));
    }
    return 1;
  }
  function placeOfKm(km) {
    var id = legs[0].id;
    for (var i = 0; i < legs.length; i++) if (km >= legs[i].km - .5) id = legs[i].id;
    return PLACE[id] || id;
  }
  function posAt(t) {
    var f = clamp(t, 0, 1) * N, i = Math.min(N - 1, Math.floor(f)), u = f - i, a = LUT[i], b = LUT[i + 1];
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  }
  function angleAt(t) {
    var a = posAt(Math.max(0, t - .004)), b = posAt(Math.min(1, t + .004));
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  }

  /* ---------------- layout ---------------- */
  var odoUnderEnd = false, W = 0, H = 0, mode = 'd', navH = 76, gutter = 20, F = 1, Afit, Mfit, Adrive, RB, railBox, railLabelX = 0, odoBox, endH = 0, maxCoH = 0;

  function cam(p) {
    var b = smooth(FIT[0], FIT[1], p);
    var z = ZOOM(p) * F;
    var M = posAt(tOfKm(KM(Math.max(0, p - LAG))));
    var mx = lerp(M.x, Mfit.x, b), my = lerp(M.y, Mfit.y, b);
    var ax = lerp(Adrive.x, Afit.x, b), ay = lerp(Adrive.y, Afit.y, b);
    return { s: z, tx: ax - mx * z, ty: ay - my * z };
  }
  function scr(c, pt) { return { x: c.tx + pt.x * c.s, y: c.ty + pt.y * c.s }; }

  function rectOf(el) {
    var r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
  }

  function layout() {
    W = stage.clientWidth; H = stage.clientHeight;
    if (!W || !H) return false;
    var newMode = (W < 900 && H >= 520) || W / H < .9 ? 'm' : 'd';
    var modeChanged = newMode !== mode || !hero.hasAttribute('data-mode');
    mode = newMode; hero.setAttribute('data-mode', mode);
    navH = parseFloat(getComputedStyle(root).getPropertyValue('--nav-h')) || 64;
    gutter = clamp(W * .04, 20, 56);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    // fixed UI boxes (they are positioned by CSS; opacity does not affect layout)
    railBox = rectOf(rail); odoBox = rectOf(odo);
    railLabelX = railBox.x;
    $$('button > span', rail).forEach(function (sp) { railLabelX = Math.min(railLabelX, rectOf(sp).x); });
    // label boxes (hud units are px): used to keep callouts off the stop names
    stops.forEach(function (st) {
      var tx = st.el.querySelector('text'), w = tx.getComputedTextLength(), x = +tx.getAttribute('x'), y = +tx.getAttribute('y');
      st.lab = { x: tx.getAttribute('text-anchor') === 'end' ? x - w : x, y: y - 11, w: w, h: 14 };
    });
    endH = endEl.offsetHeight;
    maxCoH = 0;
    co.forEach(function (c) { c.w = c.el.offsetWidth; c.h = c.el.offsetHeight; maxCoH = Math.max(maxCoH, c.h); });

    var fit;
    if (mode === 'd') {
      fit = { x0: Math.max(W * .5, endEl.getBoundingClientRect().right + 40) + 40, x1: railLabelX - 40, y0: navH + 56, y1: H - 64 };
      Adrive = { x: W * .4, y: navH + (H - navH) * .5 };
    } else {
      var top = odoBox.y + odoBox.h + 16;
      fit = { x0: gutter + 50, x1: W - gutter - 10, y0: top + 10, y1: H - endH - 48 };
      var bottom = H - maxCoH - 36;
      Adrive = { x: W * .5, y: top + (bottom - top) * .5 };
    }
    F = Math.min((fit.x1 - fit.x0) / RB.w, (fit.y1 - fit.y0) / RB.h);
    Afit = { x: (fit.x0 + fit.x1) / 2, y: (fit.y0 + fit.y1) / 2 };
    Mfit = { x: RB.x + RB.w / 2, y: RB.y + RB.h / 2 };
    // where the end panel and the odometer would touch (short landscape screens), the odometer bows out
    var er = rectOf(endEl);   // desktop: vertically centred by the render transform, so derive the bottom from the height
    odoUnderEnd = mode === 'd' && H / 2 + endH / 2 + 12 > odoBox.y && er.x < odoBox.x + odoBox.w;
    if (mode === 'd') placeCallouts();
    return modeChanged;
  }

  /* desktop: choose, once per layout, where each callout sits relative to its stop so it never covers
     the drawn line or the line just ahead, the nav, the rail or the odometer */
  function placeCallouts() {
    var safe = { x0: gutter, x1: railLabelX - 18, y0: navH + 14, y1: H - 18 };
    co.forEach(function (c) {
      var w = c.w, h = c.h, G = 30;
      var cands = [[G, -24], [G, -h + 24], [-G - w, -24], [-G - w, -h + 24], [G, -h / 2], [-G - w, -h / 2],
                   [-w / 2, 46], [-w / 2, -h - 46], [G + 70, -24], [-G - 70 - w, -24], [G + 70, -h + 24], [-G - 70 - w, -h + 24]];
      var samples = [c.win[1], (c.win[1] + c.win[2]) / 2, c.win[2]];
      var cams = samples.map(function (p) { return { c: cam(p), t: tOfKm(KM(p)) }; });
      var best = null;
      cands.forEach(function (o, ci) {
        var score = ci * .01;
        cams.forEach(function (k) {
          var S = scr(k.c, c.anchor), x = S.x + o[0], y = S.y + o[1];
          score += 40 * (Math.max(0, safe.x0 - x) + Math.max(0, x + w - safe.x1) + Math.max(0, safe.y0 - y) + Math.max(0, y + h - safe.y1));
          if (x < odoBox.x + odoBox.w + 16 && x + w > odoBox.x - 16 && y + h > odoBox.y - 16) score += 400;
          for (var t = Math.max(0, k.t - .3); t <= Math.min(1, k.t + .07); t += .0035) {
            var q = scr(k.c, posAt(t));
            if (q.x > x - 16 && q.x < x + w + 16 && q.y > y - 16 && q.y < y + h + 16) score += 12;
          }
          stops.forEach(function (st) {
            var q = scr(k.c, st.pos);
            if (q.x > x - 10 && q.x < x + w + 10 && q.y > y - 10 && q.y < y + h + 10) score += 30;
            var shown = k.c.s >= st.minz && (!st.maxz || k.c.s < st.maxz), L = st.lab;
            if (shown && L && q.x + L.x < x + w + 8 && q.x + L.x + L.w > x - 8 && q.y + L.y < y + h + 8 && q.y + L.y + L.h > y - 8) score += 60;
          });
          xlabels.forEach(function (xl) {
            if (Math.abs(k.t - xl.t) > .05) return;
            var q = scr(k.c, posAt(xl.t)), bx = q.x - 16 - 150, by = q.y - 34 - 12;
            if (bx < x + w + 8 && bx + 150 > x - 8 && by < y + h + 8 && by + 30 > y - 8) score += 80;
          });
        });
        if (!best || score < best.score) best = { score: score, o: o };
      });
      c.off = best.o;
    });
  }

  /* ---------------- render ---------------- */
  var lastS = -1, lastKmTxt = '', lastPlace = '', lastRail = -1, curP = 0;

  function setStroke(el, px) { el.style.strokeWidth = px; }

  function draw(p) {
    if (dead) return;
    try { render(p); } catch (err) { fail(err); }
  }

  function render(p) {
    curP = p;
    var km = KM(p), t = tOfKm(km), c = cam(p), s = c.s;
    world.setAttribute('transform', 'translate(' + c.tx.toFixed(2) + ' ' + c.ty.toFixed(2) + ') scale(' + s.toFixed(4) + ')');

    // constant on-screen stroke widths whatever the zoom
    if (Math.abs(s - lastS) > 1e-4) {
      lastS = s;
      var u = 1 / s;
      setStroke(land, u); setStroke(lakes, u);
      setStroke(borders, u); borders.style.strokeDasharray = (1 * u) + ' ' + (3.5 * u);
      bounds.forEach(function (b) { setStroke(b, 1.6 * u); b.style.strokeDasharray = (4 * u) + ' ' + (3 * u); });
      setStroke(ghost, 1.3 * u);
      setStroke(glows[0], 18 * u); setStroke(glows[1], 7 * u);
      setStroke(line, 2.6 * u);
    }
    var off = (1000 * (1 - t)).toFixed(2);
    line.style.strokeDashoffset = off; glows[0].style.strokeDashoffset = off; glows[1].style.strokeDashoffset = off;

    // dot grid drifts at half the camera's speed: depth without moving the geography
    grid.style.backgroundPosition = ((c.tx * .5) % 34).toFixed(1) + 'px ' + ((c.ty * .5) % 34).toFixed(1) + 'px';

    // truck: on the line, nose along the tangent
    var P = scr(c, posAt(t));
    truck.setAttribute('transform', 'translate(' + P.x.toFixed(1) + ' ' + P.y.toFixed(1) + ')');
    var parked = km >= 3120.5;
    if (parked !== truck.classList.contains('is-parked')) truck.classList.toggle('is-parked', parked);
    truckR.setAttribute('transform', 'rotate(' + angleAt(t).toFixed(1) + ')' + (mode === 'm' ? ' scale(.85)' : ''));

    // stops
    stops.forEach(function (st) {
      var q = scr(c, st.pos);
      st.el.setAttribute('transform', 'translate(' + q.x.toFixed(1) + ' ' + q.y.toFixed(1) + ')');
      var reached = t >= st.t - 1e-5;
      if (reached !== st.reached) { st.reached = reached; st.el.classList.toggle('is-reached', reached); st.el.classList.toggle('is-ahead', !reached); }
      var show = s >= st.minz && (!st.maxz || s < st.maxz);
      if (show && st.lab && (q.x + st.lab.x < 4 || q.x + st.lab.x + st.lab.w > W - 4)) show = false;   // never a clipped name
      if (show !== st.show) { st.show = show; st.el.classList.toggle('is-nolabel', !show); }
    });

    // border labels: only while the truck is crossing, close up
    xlabels.forEach(function (x) {
      var a = Math.min(smooth(x.km - 70, x.km - 25, km), 1 - smooth(x.km + 40, x.km + 110, km)) * smooth(1.6, 2.2, s);
      var q = scr(c, posAt(x.t));
      x.el.setAttribute('transform', 'translate(' + (q.x - 16).toFixed(1) + ' ' + (q.y - 34).toFixed(1) + ')');
      if (Math.abs(a - x.on) > .005) { x.on = a; x.el.style.opacity = a.toFixed(3); }
    });

    // callouts (+ leaders on desktop)
    co.forEach(function (k) {
      var a = win4(p, k.win);
      var mid = (k.win[1] + k.win[2]) / 2, dy = (1 - a) * (p < mid ? 14 : -14);
      if (a <= .001) {
        if (k.a !== 0) { k.a = 0; k.el.style.opacity = '0'; k.leader.style.opacity = '0'; k.el.classList.remove('is-live'); }
        return;
      }
      k.a = a;
      k.el.style.opacity = a.toFixed(3);
      k.el.classList.toggle('is-live', a > .5);
      if (mode === 'd') {
        var S = scr(c, k.anchor), x = S.x + k.off[0], y = S.y + k.off[1];
        k.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + (y + dy).toFixed(1) + 'px,0)';
        // leader: stop dot to the nearest point of the card
        var lx = clamp(S.x, x, x + k.w), ly = clamp(S.y, y + dy, y + dy + k.h);
        var dx = lx - S.x, dd = ly - S.y, len = Math.sqrt(dx * dx + dd * dd) || 1;
        k.leader.setAttribute('x1', (S.x + dx / len * 9).toFixed(1)); k.leader.setAttribute('y1', (S.y + dd / len * 9).toFixed(1));
        k.leader.setAttribute('x2', lx.toFixed(1)); k.leader.setAttribute('y2', ly.toFixed(1));
        k.leader.style.opacity = (a * .9).toFixed(3);
      } else {
        k.el.style.transform = 'translate3d(0,' + dy.toFixed(1) + 'px,0)';
        k.leader.style.opacity = '0';
      }
    });

    // opening -> map
    var o = 1 - smooth(OPEN_OUT[0], OPEN_OUT[1], p);
    open.style.opacity = o.toFixed(3);
    open.style.transform = 'translate3d(0,' + (-(1 - o) * 28).toFixed(1) + 'px,0)';
    open.style.visibility = o < .01 ? 'hidden' : '';
    var ph = 1 - smooth(PHOTO_OUT[0], PHOTO_OUT[1], p);
    photo.style.opacity = ph.toFixed(3);
    photo.style.transform = 'scale(' + (1.02 + .1 * smooth(0, PHOTO_OUT[1], p)).toFixed(4) + ')';
    photo.style.visibility = ph < .01 ? 'hidden' : '';
    var hudA = smooth(HUD_IN[0], HUD_IN[1], p);
    rail.style.opacity = hudA.toFixed(3);
    grid.style.opacity = hudA.toFixed(3);
    stage.style.setProperty('--hud', hudA.toFixed(3));

    // end frame
    var e = smooth(END_IN[0], END_IN[1], p);
    odo.style.opacity = (hudA * (odoUnderEnd ? 1 - e : 1)).toFixed(3);
    endEl.style.opacity = e.toFixed(3);
    endEl.style.transform = mode === 'd' ? 'translate3d(0,calc(-50% + ' + ((1 - e) * 18).toFixed(1) + 'px),0)' : 'translate3d(0,' + ((1 - e) * 18).toFixed(1) + 'px,0)';
    endEl.classList.toggle('is-live', e > .5);

    // odometer + rail
    var kmR = Math.round(km), txt = fmt(kmR);
    if (txt !== lastKmTxt) { kmEl.textContent = txt; lastKmTxt = txt; }
    var place = placeOfKm(km);
    if (place !== lastPlace) { placeEl.textContent = place; lastPlace = place; }
    var seg = 0;
    for (var i = 0; i < RAIL_P.length; i++) if (p >= RAIL_P[i] - 1e-4) seg = i;
    var frac = seg >= RAIL_P.length - 1 ? 1 : (seg + clamp((p - RAIL_P[seg]) / (RAIL_P[seg + 1] - RAIL_P[seg]), 0, 1)) / (RAIL_P.length - 1);
    railFill.style.transform = (mode === 'd' ? 'scaleY(' : 'scaleX(') + frac.toFixed(4) + ')';
    if (seg !== lastRail) {
      lastRail = seg;
      railItems.forEach(function (li, j) { li.classList.toggle('is-on', j <= seg); li.classList.toggle('is-now', j === seg); if (j === seg) li.querySelector('button').setAttribute('aria-current', 'step'); else li.querySelector('button').removeAttribute('aria-current'); });
    }
  }

  /* ---------------- scroll plumbing ---------------- */
  var heroTop = 0, range = 1, st = null, state = { p: 0 }, settleTimer = 0;
  function measure() {
    var r = hero.getBoundingClientRect();
    heroTop = r.top + win.scrollY;
    range = Math.max(1, hero.offsetHeight - H);
  }
  function rawP() { return clamp((win.scrollY - heroTop) / range, 0, 1); }
  function pToY(p) { return Math.round(heroTop + p * range); }

  function settle() {
    var raw = rawP();
    if (st && st.getTween) { var tw = st.getTween(); if (tw) tw.progress(1); }
    if (Math.abs(curP - raw) > .0015) { state.p = raw; draw(raw); }
  }

  function onScroll() {
    hero.classList.toggle('is-scrolled', win.scrollY > 8);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 240);
  }

  /* ---------------- fallback ---------------- */
  function fail(err) {
    dead = true;
    if (st) st.kill();
    hero.classList.remove('drive-on', 'is-scrolled');
    hero.removeAttribute('data-mode');
    svg.setAttribute('viewBox', STATIC_VB);
    touched.forEach(function (el) { el.removeAttribute('style'); });
    if (world) world.removeAttribute('transform');
    if (stops) stops.forEach(function (s) { s.el.setAttribute('transform', s.staticT); s.el.classList.remove('is-reached', 'is-ahead', 'is-nolabel'); });
    xlabels.forEach(function (x) { x.el.setAttribute('transform', x.staticT); });
    if (win.console && console.error) console.error('[drive] fell back to the static hero:', err);
  }

  /* ---------------- init ---------------- */
  function init() {
    // LUT along the route, in hero units
    var len = line.getTotalLength();
    for (var i = 0; i <= N; i++) { var q = line.getPointAtLength(len * i / N); LUT.push({ x: q.x, y: q.y }); }
    var xs = LUT.map(function (q) { return q.x; }), ys = LUT.map(function (q) { return q.y; });
    RB = { x: Math.min.apply(0, xs), y: Math.min.apply(0, ys) };
    RB.w = Math.max.apply(0, xs) - RB.x; RB.h = Math.max.apply(0, ys) - RB.y;

    stops = $$('.dm-stop').map(function (el) {
      var t = +el.getAttribute('data-t');
      return { el: el, id: el.getAttribute('data-id'), t: t, pos: posAt(t), staticT: el.getAttribute('transform'),
               minz: +(el.getAttribute('data-minz') || 0), maxz: +(el.getAttribute('data-maxz') || 0), reached: null, show: null };
    });
    xlabels.forEach(function (x) { x.staticT = x.el.getAttribute('transform'); });
    var byId = {}; stops.forEach(function (s) { byId[s.id] = s; });
    var SVGNS = 'http://www.w3.org/2000/svg';
    CO.forEach(function (d) {
      var el = $('.co[data-co="' + d.id + '"]');
      if (!el) return;
      var ln = doc.createElementNS(SVGNS, 'line');
      ln.setAttribute('class', 'dm-leader'); ln.style.opacity = '0';
      leadersG.appendChild(ln);
      co.push({ id: d.id, el: el, win: d.w, go: d.go, anchor: byId[d.at].pos, leader: ln, off: [30, -24], a: -1, w: 0, h: 0 });
      touched.push(el);
    });
    touched.push(stage, photo, open, endEl, odo, rail, grid, line, ghost, land, lakes, borders, railFill);
    touched = touched.concat(glows, bounds, xlabels.map(function (x) { return x.el; }));

    hero.classList.add('drive-on');
    layout();
    measure();
    draw(rawP());

    var hasGSAP = !!(win.gsap && win.ScrollTrigger);
    if (hasGSAP) {
      gsap.registerPlugin(ScrollTrigger);
      state.p = rawP();
      var tween = gsap.fromTo(state, { p: 0 }, {
        p: 1, ease: 'none', immediateRender: false,
        onUpdate: function () { draw(state.p); },
        scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom bottom', scrub: .3, invalidateOnRefresh: true }
      });
      st = tween.scrollTrigger;
      ScrollTrigger.addEventListener('refresh', function () { measure(); });
    } else {
      var ticking = false;
      win.addEventListener('scroll', function () {
        if (ticking) return; ticking = true;
        requestAnimationFrame(function () { ticking = false; draw(rawP()); });
      }, { passive: true });
    }
    win.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    var relayout = function () {
      if (dead) return;
      var changed = layout();
      measure();
      if (changed && hasGSAP) ScrollTrigger.refresh();
      lastS = -1;
      draw(curP);
    };
    var rT = 0;
    var queue = function () { clearTimeout(rT); rT = setTimeout(relayout, 60); };
    if (win.ResizeObserver) new ResizeObserver(queue).observe(stage); else win.addEventListener('resize', queue);
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(queue);
    win.addEventListener('load', queue);

    // rail: jump to a stop
    hero.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.drive__rail button');
      if (!b) return;
      var d = CO.filter(function (x) { return x.id === b.getAttribute('data-go'); })[0];
      if (d) win.scrollTo({ top: pToY(b.getAttribute('data-go') === 'saltillo' ? 1 : d.go), behavior: 'smooth' });
    });
    // keyboard focus on the end CTAs brings the end frame into view
    endEl.addEventListener('focusin', function () { if (curP < END_IN[1]) win.scrollTo(0, pToY(1)); });

    // read-only hook for QA (Playwright): state at the current or a given p
    win.HunterDrive = {
      p: function () { return curP; },
      at: function (p) { var km = KM(p), t = tOfKm(km), c = cam(p), P = scr(c, posAt(t)); return { p: p, km: Math.round(km), t: t, truck: P, s: c.s }; },
      stops: function () { var c = cam(curP); return stops.map(function (s) { var q = scr(c, s.pos); return { id: s.id, t: s.t, x: q.x, y: q.y }; }); },
      yFor: pToY
    };
  }

  hero.classList.add('drive-on');
  try { init(); } catch (err) { fail(err); }
})();
