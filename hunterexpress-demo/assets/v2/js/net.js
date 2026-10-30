/* Hunter Express v2 · "The living continent" (hero)
   The network SVG (build/v2/net/net.py) is fully drawn by CSS alone. This script adds, in order:
   the draw-on cascade from Brampton, trucks running every lane, pointer tilt with depth, lane hover
   with a tag ("from → to · ≈ km · days", "Quote this lane" prefills #quote), an idle spotlight that
   cycles the lanes, and a light scroll-out. Reduced motion: nothing moves, hover and tap still work.
   QA: window.HunterNet = { lanes, trucks, hot, state() }. */
(function () {
  'use strict';
  var doc = document, win = window, root = doc.documentElement;
  var reduce = root.classList.contains('rm');
  var hero = doc.getElementById('top'), stage = doc.getElementById('netStage'), mapEl = doc.getElementById('netMap');
  var svg = doc.getElementById('heroNet');
  if (!hero || !stage || !svg || !svg.createSVGPoint) return;
  var NS = 'http://www.w3.org/2000/svg';
  var copy = hero.querySelector('.net__copy'), hint = doc.getElementById('netHint');
  var tag = doc.getElementById('netTag'), tagLane = doc.getElementById('netTagLane'), tagKm = doc.getElementById('netTagKm');
  var tagVia = doc.getElementById('netTagVia'), tagCta = doc.getElementById('netTagCta');
  var citiesG = doc.getElementById('hnCities'), worldG = doc.getElementById('hnWorld'), trucksG = doc.getElementById('hnTrucks');
  var fine = win.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  var now = function () { return (win.performance && performance.now) ? performance.now() : Date.now(); };

  /* ---- lanes: metadata + sampled geometry (map units) ---- */
  var lanes = [].map.call(svg.querySelectorAll('.hn-lane'), function (g) {
    var line = g.querySelector('.hn-lane__line'), len = line.getTotalLength();
    var n = Math.max(24, Math.round(len / 3)), pts = new Float32Array((n + 1) * 2);
    for (var i = 0; i <= n; i++) { var p = line.getPointAtLength(len * i / n); pts[i * 2] = p.x; pts[i * 2 + 1] = p.y; }
    var via = g.getAttribute('data-via') || '';
    return {
      id: g.getAttribute('data-id'), el: g, hit: g.querySelector('.hn-lane__hit'), len: len, n: n, pts: pts,
      km: +g.getAttribute('data-km'), km0: g.hasAttribute('data-km0') ? +g.getAttribute('data-km0') : null,
      from: g.getAttribute('data-from'), to: g.getAttribute('data-to'), via: via ? via.split(', ') : [],
      kind: g.classList.contains('hn-lane--corr') ? 'corr' : g.classList.contains('hn-lane--van') ? 'van' : 'lane'
    };
  });
  var byId = {}; lanes.forEach(function (l) { byId[l.id] = l; });
  function at(l, u) {
    var s = Math.max(0, Math.min(1, u)) * l.n, i = Math.floor(s), f = s - i;
    if (i >= l.n) return { x: l.pts[l.n * 2], y: l.pts[l.n * 2 + 1] };
    var p = l.pts;
    return { x: p[i * 2] + (p[i * 2 + 2] - p[i * 2]) * f, y: p[i * 2 + 1] + (p[i * 2 + 3] - p[i * 2 + 1]) * f };
  }
  var cityEls = [].slice.call(svg.querySelectorAll('.hn-city, .hn-term'));
  var cityLanes = cityEls.map(function (c) { return (c.getAttribute('data-lanes') || '').split(','); });

  /* ---- draw-on cascade: the spine first, each branch as the spine reaches it, then the West ---- */
  var drawn = !reduce ? false : true;
  function delayOf(l) {
    if (l.id === 'corridor') return 0;
    if (l.id === 'vancouver') return .2;
    if (l.km0 != null) return .18 + (l.km0 / 3121) * 1.35 + (l.id === 'quebec' || l.id === 'florida' ? .45 : 0);
    return l.id === 'oakland' ? 2.1 : l.id === 'jacksonville' ? 2.05 : 1.75;   // West Coast + spurs
  }
  function cascade() {
    if (reduce) { svg.classList.add('is-drawn'); return; }
    var maxD = 0;
    lanes.forEach(function (l) { var d = delayOf(l); l.delay = d; maxD = Math.max(maxD, d); l.el.style.setProperty('--d', d.toFixed(2) + 's'); });
    cityEls.forEach(function (c, i) {
      var d = maxD + .6;
      cityLanes[i].forEach(function (id) { if (byId[id]) d = Math.min(d, byId[id].delay + (byId[id].kind === 'corr' ? .5 : 1.0)); });
      if (c.classList.contains('hn-term--hq')) d = 0;
      c.style.setProperty('--d', d.toFixed(2) + 's');
    });
    svg.classList.add('is-live');
    svg.style.setProperty('--dc', (maxD + .4).toFixed(2) + 's');
    void svg.getBoundingClientRect();
    svg.classList.add('is-drawn');
    setTimeout(function () { drawn = true; startTrucks(); }, (maxD + 1.1) * 1000);
    // once everything is on, drop the per-element delays so hover dimming reacts at once
    setTimeout(function () { lanes.forEach(function (l) { l.el.style.setProperty('--d', '0s'); }); cityEls.forEach(function (c) { c.style.setProperty('--d', '0s'); }); }, (maxD + 1.7) * 1000);
    setTimeout(function () { spotNext(); }, (maxD + 2.6) * 1000);
  }

  /* ---- trucks: a few per lane, both directions, bounce at the ends ---- */
  var trucks = [], running = false, lastT = 0;
  function startTrucks() {
    if (reduce || trucks.length) return;
    lanes.forEach(function (l) {
      var count = l.kind === 'corr' ? 5 : l.kind === 'van' ? 3 : l.len > 380 ? 2 : 1;
      for (var k = 0; k < count; k++) {
        var g = doc.createElementNS(NS, 'g'); g.setAttribute('class', 'hn-truck' + (l.kind === 'corr' ? ' hn-truck--corr' : ''));
        var tail = doc.createElementNS(NS, 'polyline'); tail.setAttribute('class', 'hn-truck__tail');
        var glow = doc.createElementNS(NS, 'circle'); glow.setAttribute('class', 'hn-truck__glow'); glow.setAttribute('r', '5');
        var dot = doc.createElementNS(NS, 'circle'); dot.setAttribute('class', 'hn-truck__dot'); dot.setAttribute('r', '2.2');
        g.appendChild(tail); g.appendChild(glow); g.appendChild(dot); trucksG.appendChild(g);
        trucks.push({ lane: l, el: g, tail: tail, dot: dot, glow: glow, u: (k + .15 + Math.random() * .7) / count, dir: k % 2 ? -1 : 1, v: (7.5 + Math.random() * 5) / l.len });
      }
    });
    running = true;
  }
  function moveTrucks(dt) {
    for (var i = 0; i < trucks.length; i++) {
      var t = trucks[i], l = t.lane;
      t.u += t.v * t.dir * dt;
      if (t.u >= 1) { t.u = 1; t.dir = -1; } else if (t.u <= 0) { t.u = 0; t.dir = 1; }
      var p = at(l, t.u);
      var px = p.x.toFixed(1), py = p.y.toFixed(1);
      t.dot.setAttribute('cx', px); t.dot.setAttribute('cy', py); t.glow.setAttribute('cx', px); t.glow.setAttribute('cy', py);
      var s = '', step = 2.6 / l.len;
      for (var k = 0; k < 9; k++) { var q = at(l, t.u - t.dir * step * k); s += q.x.toFixed(1) + ',' + q.y.toFixed(1) + ' '; }
      t.tail.setAttribute('points', s);
    }
  }

  /* ---- tilt (pointer), depth, scroll-out ---- */
  var tx = 0, ty = 0, cx = 0, cy = 0, lastMove = -1e9, visible = true, raf = 0;
  if (fine && !reduce) {
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - .5; ty = (e.clientY - r.top) / r.height - .5; lastMove = now();
    });
    hero.addEventListener('pointerleave', function () { tx = 0; ty = 0; });
  }
  var H = 0;
  function frame() {
    raf = 0;
    if (!visible || doc.hidden) { running = running && true; return; }
    var t = now(), dt = Math.min(.05, (t - lastT) / 1000); lastT = t;
    if (!reduce) {
      cx += (tx - cx) * .075; cy += (ty - cy) * .075;
      var y = win.scrollY || 0, sh = Math.min(y, H) * .22;
      mapEl.style.transform = 'translate3d(' + (cx * 20).toFixed(2) + 'px,' + (cy * 14 + sh).toFixed(2) + 'px,0) rotateX(' + (-cy * 5).toFixed(2) + 'deg) rotateY(' + (cx * 7).toFixed(2) + 'deg)';
      citiesG.style.transform = 'translate(' + (cx * -8).toFixed(2) + 'px,' + (cy * -6).toFixed(2) + 'px)';
      worldG.style.transform = 'translate(' + (cx * 4).toFixed(2) + 'px,' + (cy * 3).toFixed(2) + 'px)';
      if (copy) {
        var k = H ? Math.min(1, y / (H * .55)) : 0;
        copy.style.opacity = (1 - k).toFixed(3); copy.style.transform = 'translate3d(0,' + (y * .12).toFixed(1) + 'px,0)';
      }
      if (running) moveTrucks(dt);
    }
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) { lastT = now(); raf = requestAnimationFrame(frame); } }
  function measure() { H = hero.offsetHeight || win.innerHeight; }

  /* ---- hot lane + tag ---- */
  var hot = null, hoverLane = null, overTag = false, pinned = false;
  function fillTag(l) {
    tagLane.textContent = l.from + ' → ' + l.to;
    var team = Math.max(1, Math.ceil(l.km / 1000)), solo = Math.max(1, Math.ceil(l.km / 800));
    tagKm.textContent = '≈ ' + fmt(l.km) + ' km · ' + team + (team > 1 ? ' days' : ' day') + ' team · ' + solo + ' solo';
    var via = l.via.length ? 'via ' + l.via.join(', ') : '';
    var hq = l.km0 ? '≈ ' + fmt(l.km0 + l.km) + ' km from Brampton' : '';
    tagVia.textContent = via && hq ? via + ' · ' + hq : (via || hq);
    tagCta.setAttribute('data-from', l.from); tagCta.setAttribute('data-to', l.to);
  }
  function setHot(l) {
    if (hot === l) return;
    if (hot) { hot.el.classList.remove('is-hot'); }
    hot = l;
    cityEls.forEach(function (c, i) { c.classList.toggle('is-hot', !!l && cityLanes[i].indexOf(l.id) >= 0); });
    trucks.forEach(function (t) { t.el.classList.toggle('is-hot', !!l && t.lane === l); });
    svg.classList.toggle('is-hot', !!l);
    if (l) { l.el.classList.add('is-hot'); fillTag(l); tag.hidden = false; tag.classList.add('is-on'); }
    else { tag.classList.remove('is-on'); }
  }
  function placeTag(x, y) {
    var r = stage.getBoundingClientRect(), w = tag.offsetWidth || 210, h = tag.offsetHeight || 96;
    var px = x + 18, py = y + 18;
    if (px + w > r.width - 12) px = x - w - 18;
    if (py + h > r.height - 12) py = y - h - 18;
    px = Math.max(8, px); py = Math.max(8, py);
    tag.style.transform = 'translate(' + px.toFixed(0) + 'px,' + py.toFixed(0) + 'px)';
  }
  function rel(e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function svgToStage(p) {
    var pt = svg.createSVGPoint(); pt.x = p.x; pt.y = p.y;
    var m = svg.getScreenCTM(); if (!m) return { x: 0, y: 0 };
    var q = pt.matrixTransform(m), r = stage.getBoundingClientRect();
    return { x: q.x - r.left, y: q.y - r.top };
  }
  function quoteLane(l) {
    var f = doc.getElementById('q-from'), t = doc.getElementById('q-to');
    if (f) f.value = l.from; if (t) t.value = l.to;
  }
  lanes.forEach(function (l) {
    l.hit.addEventListener('pointerenter', function (e) {
      if (!fine) return;
      hoverLane = l; pinned = false; setHot(l); var p = rel(e); placeTag(p.x, p.y); lastMove = now();
      if (hint) hint.classList.add('is-used');
    });
    l.hit.addEventListener('pointermove', function (e) { if (fine && hoverLane === l && !overTag) { var p = rel(e); placeTag(p.x, p.y); } });
    l.hit.addEventListener('pointerleave', function () {
      if (!fine) return;
      hoverLane = null;
      setTimeout(function () { if (!hoverLane && !overTag && hot === l) setHot(null); }, 140);
    });
    l.hit.addEventListener('click', function (e) {
      if (!fine) {   // touch: a tap shows the lane and its tag; a second tap on the same lane opens the quote
        if (hot === l && pinned) { quoteLane(l); return; }
        e.preventDefault(); pinned = true; setHot(l); var p = rel(e); placeTag(p.x, p.y); lastMove = now() + 9000;
        if (hint) hint.classList.add('is-used');
        return;
      }
      quoteLane(l);
      var q = doc.getElementById('quote'); if (q) q.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    });
  });
  tag.addEventListener('pointerenter', function () { overTag = true; });
  tag.addEventListener('pointerleave', function () { overTag = false; if (!hoverLane && !pinned) setHot(null); });
  tagCta.addEventListener('click', function () { if (hot) quoteLane(hot); });
  stage.addEventListener('click', function (e) { if (!fine && pinned && !e.target.closest('.hn-lane__hit, .net__tag')) { pinned = false; setHot(null); } });

  /* ---- idle spotlight: cycles the lanes while nobody is pointing ---- */
  var ORDER = ['corridor', 'vancouver', 'newyork', 'montreal', 'chicago', 'atlanta', 'florida', 'west', 'houston', 'mx-south', 'quebec', 'charlotte', 'torreon', 'indy', 'oakland', 'jacksonville'];
  var spotI = 0, spotTimer = 0, spotLane = null;
  function spotNext() {
    clearTimeout(spotTimer);
    if (reduce) return;
    var idle = now() - lastMove > 2600;
    if (visible && !doc.hidden && !hoverLane && !overTag && !pinned && idle && (win.scrollY || 0) < H * .5) {
      var l = byId[ORDER[spotI++ % ORDER.length]];
      if (l) { spotLane = l; setHot(l); var p = svgToStage(at(l, l.kind === 'corr' ? .56 : .5)); placeTag(p.x, p.y); }
      spotTimer = setTimeout(function () { if (hot === spotLane && !hoverLane && !overTag && !pinned) setHot(null); spotLane = null; spotTimer = setTimeout(spotNext, 700); }, 2900);
    } else {
      spotTimer = setTimeout(spotNext, 900);
    }
  }

  /* ---- visibility: everything pauses off-screen or in a hidden tab ---- */
  if ('IntersectionObserver' in win) {
    new IntersectionObserver(function (es) { es.forEach(function (e) { visible = e.isIntersecting; if (visible) kick(); }); }, { threshold: .05 }).observe(hero);
  }
  doc.addEventListener('visibilitychange', function () { if (!doc.hidden) kick(); });
  win.addEventListener('resize', measure);
  win.addEventListener('scroll', function () { if (visible) kick(); }, { passive: true });

  measure();
  // after the first paint: a transition needs a painted "before" state (the CSS keeps the lanes hidden until then, so nothing flashes)
  requestAnimationFrame(function () { requestAnimationFrame(cascade); });
  kick();

  win.HunterNet = {
    lanes: lanes, trucks: trucks, at: at,
    hot: function () { return hot ? hot.id : null; },
    state: function () { return { drawn: svg.classList.contains('is-drawn'), live: svg.classList.contains('is-live'), trucks: trucks.length, running: running, visible: visible, hot: hot ? hot.id : null, tag: tag.classList.contains('is-on') }; },
    spot: spotNext, setHot: function (id) { setHot(byId[id] || null); if (byId[id]) { var p = svgToStage(at(byId[id], .5)); placeTag(p.x, p.y); } }
  };
})();
