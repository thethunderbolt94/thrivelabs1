/* Hunter Express v2 · site behaviour.
   Vanilla JS; GSAP + ScrollTrigger (local vendor copies) add motion when present.
   Everything degrades to readable static content without JS or under reduced motion. */
(function () {
  'use strict';

  var doc = document, root = doc.documentElement, win = window;
  var reduce = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = win.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var hasGSAP = !!(win.gsap && win.ScrollTrigger);
  if (hasGSAP) gsap.registerPlugin(ScrollTrigger);
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  /* ------------------------------------------------------------------
     Terminals (corridor order) + countries
     ------------------------------------------------------------------ */
  var TERMINALS = [
    { id: 'vancouver', name: 'Vancouver, BC', cc: 'CA', lane: true },   // lane endpoint only (no terminal); routes via Brampton
    { id: 'brampton', name: 'Brampton, ON', cc: 'CA' },
    { id: 'belle-river', name: 'Belle River, ON', cc: 'CA' },
    { id: 'romulus', name: 'Romulus, MI', cc: 'US' },
    { id: 'laredo', name: 'Laredo, TX', cc: 'US' },
    { id: 'nuevo-laredo', name: 'Nuevo Laredo, MX', cc: 'MX' },
    { id: 'monterrey', name: 'Monterrey, MX', cc: 'MX' },
    { id: 'saltillo', name: 'Saltillo, MX', cc: 'MX' }
  ];
  var byId = {}; TERMINALS.forEach(function (t, i) { t.i = i; byId[t.id] = t; });
  var CC_ORDER = { CA: 0, US: 1, MX: 2 };

  /* ------------------------------------------------------------------
     NAV: compact, progress, active section, mobile overlay
     ------------------------------------------------------------------ */
  var nav = $('#nav'), progress = $('.nav__progress span');
  var menu = $('#menu'), toggle = $('#menuToggle');
  var track = null, trackBottom = 0;

  function measureWorld() {
    track = $('#growthStage') || $('#top');   // the pinned map (net.js); past-hero / world-done key off its bottom edge
    trackBottom = track ? track.getBoundingClientRect().bottom + win.scrollY : 0;
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = win.scrollY, vh = win.innerHeight;
      nav.classList.toggle('is-compact', y > 40);
      var max = doc.documentElement.scrollHeight - vh;
      if (progress) progress.style.transform = 'scaleX(' + clamp(y / (max || 1), 0, 1).toFixed(4) + ')';
      var past = trackBottom ? y > trackBottom - vh * 0.6 : y > vh * 0.6;
      root.classList.toggle('past-hero', past);
      root.classList.toggle('world-done', !!trackBottom && y >= trackBottom + 2);
      updateKmRail(y, vh);
    });
  }

  function initNav() {
    var links = $$('.nav__primary a[data-nav]');
    var map = {}; links.forEach(function (a) { map[a.getAttribute('data-nav')] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var a = map[e.target.id]; if (!a) return;
        if (e.isIntersecting) { links.forEach(function (l) { l.classList.remove('is-active'); l.removeAttribute('aria-current'); }); a.classList.add('is-active'); a.setAttribute('aria-current', 'true'); }
        else if (a.classList.contains('is-active')) { a.classList.remove('is-active'); a.removeAttribute('aria-current'); }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(map).forEach(function (id) { var s = doc.getElementById(id); if (s) io.observe(s); });

    function setMenu(open) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('.nav__toggle-label').textContent = open ? 'Close' : 'Menu';
      menu.hidden = !open;
      doc.body.style.overflow = open ? 'hidden' : '';
      if (open) { var f = $('a', menu); if (f) f.focus(); }
    }
    toggle.addEventListener('click', function () { setMenu(toggle.getAttribute('aria-expanded') !== 'true'); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) { setMenu(false); toggle.focus(); }
    });
    win.matchMedia('(min-width: 960px)').addEventListener('change', function (m) { if (m.matches) setMenu(false); });
  }

  /* ------------------------------------------------------------------
     KM rail: the page as a drive down the corridor
     ------------------------------------------------------------------ */
  var kmStops = [], kmFill = $('.kmrail__line i'), kmKm = $('#kmrailKm'), kmPlace = $('#kmrailPlace');
  function collectKm() {
    kmStops = $$('[data-km]').map(function (el) {
      return { el: el, km: +el.getAttribute('data-km'), place: el.getAttribute('data-place'), top: el.getBoundingClientRect().top + win.scrollY };
    });
  }
  var lastKmText = '';
  function updateKmRail(y, vh) {
    if (!kmStops.length || !kmKm) return;
    var probe = y + vh * 0.5, cur = 0;
    for (var i = 0; i < kmStops.length; i++) if (probe >= kmStops[i].top) cur = i;
    var a = kmStops[cur], b = kmStops[cur + 1];
    var km = a.km;
    if (b && probe >= a.top) km = a.km + (b.km - a.km) * clamp((probe - a.top) / (b.top - a.top), 0, 1);
    var t = 'KM ' + String(Math.round(km)).padStart(4, '0');
    if (t !== lastKmText) { kmKm.textContent = t; lastKmText = t; }
    if (kmPlace.textContent !== a.place) kmPlace.textContent = a.place;
    if (kmFill) kmFill.style.transform = 'scaleY(' + (km / 3121).toFixed(4) + ')';
  }

  /* ------------------------------------------------------------------
     Reveals + parallax (GSAP)
     ------------------------------------------------------------------ */
  function initMotion() {
    if (!hasGSAP || reduce) return;
    $$('[data-reveal]').forEach(function (el) {
      var isHead = el.classList.contains('display');
      gsap.from(el, {
        y: isHead ? 36 : 24, opacity: 0, duration: isHead ? 1.15 : .9, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 90%', once: true }
      });
    });
    $$('.parallax-host').forEach(function (host) {
      var img = $('[data-parallax]', host); if (!img) return;
      var amt = parseFloat(img.getAttribute('data-parallax')) || .1;
      gsap.fromTo(img, { yPercent: -amt * 50 }, {
        yPercent: amt * 50, ease: 'none',
        scrollTrigger: { trigger: host, start: 'top bottom', end: 'bottom top', scrub: true }
      });
    });
  }

  /* ------------------------------------------------------------------
     Odometer counters
     ------------------------------------------------------------------ */
  function initOdometers() {
    var odos = $$('.odo[data-odo]');
    if (reduce || !('IntersectionObserver' in win)) return;
    odos.forEach(function (el) {
      var suffix = el.getAttribute('data-suffix') || '';
      var text = fmt(+el.getAttribute('data-odo'));
      var sr = doc.createElement('span'); sr.className = 'sr-only'; sr.textContent = text + suffix;
      var roll = doc.createElement('span'); roll.className = 'odo__roll'; roll.setAttribute('aria-hidden', 'true');
      var strips = [];
      text.split('').forEach(function (ch) {
        if (!/\d/.test(ch)) { var s = doc.createElement('span'); s.className = 'odo__sep'; s.textContent = ch; roll.appendChild(s); return; }
        var d = doc.createElement('span'); d.className = 'odo__d';
        var strip = doc.createElement('span'); strip.className = 'odo__strip';
        var html = ''; for (var k = 0; k < 30; k++) html += '<span>' + (k % 10) + '</span>';
        strip.innerHTML = html; d.appendChild(strip); roll.appendChild(d);
        strips.push({ strip: strip, target: 20 + (+ch) });
      });
      if (suffix) { var sf = doc.createElement('span'); sf.className = 'odo__suf'; sf.textContent = suffix; roll.appendChild(sf); }
      el.textContent = ''; el.appendChild(sr); el.appendChild(roll); el.classList.add('is-built');
      el._strips = strips;
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var strips = e.target._strips || [], n = strips.length;
        strips.forEach(function (s, i) {
          s.strip.style.transitionDelay = (420 + (n - 1 - i) * 70) + 'ms';
          s.strip.style.transitionDuration = (1.25 + i * 0.12) + 's';
          requestAnimationFrame(function () { s.strip.style.transform = 'translateY(' + (-s.target * 1.1) + 'em)'; });
        });
      });
    }, { threshold: .35 });
    odos.forEach(function (el) { io.observe(el); });
  }

  function initOnce(sel, cls, threshold) {
    var el = $(sel); if (!el) return;
    if (reduce || !('IntersectionObserver' in win)) { el.classList.add(cls); return; }
    var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { el.classList.add(cls); io.disconnect(); } }, { threshold: threshold });
    io.observe(el);
  }

  /* ------------------------------------------------------------------
     Lane planner + terminal directory (data from the hero map: data-legs, data-van on #heroNet)
     ------------------------------------------------------------------ */
  var netSvg = $('#heroNet');
  var LEGS = [], VAN = null;
  try { LEGS = JSON.parse(netSvg.getAttribute('data-legs')); } catch (e) { LEGS = []; }
  try { VAN = JSON.parse(netSvg.getAttribute('data-van')); } catch (e) { VAN = null; }
  var byLeg = {}; LEGS.forEach(function (l) { byLeg[l.id] = l; });
  var fromSel = $('#laneFrom'), toSel = $('#laneTo');
  var kmOut = $('#laneKm'), miOut = $('#laneMi'), bOut = $('#laneBorders'), routeOut = $('#laneRoute');
  var shownKm = 3121;

  // Road distance along the corridor (the map build's leg km); a Vancouver end adds the Trans-Canada lane via Brampton.
  function legInfo(from, to) {
    if (from === to) return { km: 0, miles: 0, t: [0, 0], via: [] };
    var onLane = VAN && (from === VAN.to || to === VAN.to);
    var a = byLeg[from], b = byLeg[to], km, t, extra = {};
    if (onLane) {
      var other = byLeg[from === VAN.to ? to : from], join = byLeg[VAN.frm]; if (!other || !join) return null;
      var corr = Math.abs(other.km - join.km);
      km = corr + VAN.km; t = [Math.min(join.t, other.t), Math.max(join.t, other.t)];
      extra = { corridorKm: corr, corridorT: corr > 0 ? t : null, laneKm: VAN.km, laneFirst: from === VAN.to, laneVia: from === VAN.to ? VAN.via.slice().reverse() : VAN.via.slice() };
    } else {
      if (!a || !b) return null;
      km = Math.abs(b.km - a.km); t = [Math.min(a.t, b.t), Math.max(a.t, b.t)];
    }
    var info = { km: km, miles: Math.round(km * .621371), t: t };
    for (var k in extra) info[k] = extra[k];
    return info;
  }
  // Cities named under the route, in travel order.
  function viaCities(info) {
    var onLane = info.laneKm > 0, fromLane = onLane && info.laneFirst, out = [], mids = [];
    if (!onLane || info.corridorT) {
      var t0 = onLane ? info.corridorT[0] : info.t[0], t1 = onLane ? info.corridorT[1] : info.t[1];
      mids = LEGS.filter(function (l) { return !l.terminal && l.t > t0 + .001 && l.t < t1 - .001 && l.id !== 'windsor'; }).map(function (l) { return l.name; });
      var cap = onLane ? 2 : 3;
      if (mids.length > cap) {
        var n = mids.length, pick = cap === 3 ? [0, Math.floor(n / 2), n - 1] : [Math.floor(n / 3), Math.floor(2 * n / 3)];
        mids = pick.map(function (i) { return mids[i]; });
      }
    }
    if (!onLane) return mids;
    if (fromLane) out = info.laneVia.concat(info.corridorT ? ['Brampton'] : [], mids);
    else out = mids.reverse().concat(info.corridorT ? ['Brampton'] : [], info.laneVia);
    return out;
  }
  function tweenKm(to) {
    var from = shownKm; shownKm = to;
    if (reduce) { kmOut.textContent = fmt(to); return; }
    var t0 = performance.now(), dur = 650;
    (function step(now) {
      var p = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 3);
      kmOut.textContent = fmt(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
  function hotTerminals(ids) {
    $$('.hn-term', netSvg || doc).forEach(function (t) { t.classList.toggle('is-hover', ids.indexOf(t.getAttribute('data-id')) >= 0); });
  }
  function setLane(from, to, fromForm) {
    if (!fromSel || !toSel) return;
    if (from) fromSel.value = from;
    if (to) toSel.value = to;
    var f = fromSel.value, t = toSel.value;
    var info = legInfo(f, t);
    if (!info) return;
    var A = byId[f], B = byId[t];
    var borders = Math.abs(CC_ORDER[A.cc] - CC_ORDER[B.cc]);
    tweenKm(info.km);
    miOut.textContent = fmt(info.miles);
    var same = f === t;
    bOut.textContent = String(borders);
    var via = same ? [] : viaCities(info);
    routeOut.innerHTML = same ? 'Same terminal. Pick a different destination.'
      : '<b>' + A.name.split(',')[0] + '</b> → <b>' + B.name.split(',')[0] + '</b>' + (via.length ? '<br>via ' + via.join(' · ') : '');
    hotTerminals(same ? [] : [f, t]);
    if (!fromForm) syncQuoteLane();
  }
  function pickTerminal(id) {
    if (id === fromSel.value) setLane(id, id === 'saltillo' ? 'brampton' : 'saltillo');
    else setLane(null, id);
  }
  function highlightDir(id) {
    $$('.dir__item').forEach(function (li) { li.classList.toggle('is-hover', li.getAttribute('data-terminal') === id); });
  }
  function initMap() {
    if (!fromSel || !toSel) return;
    [fromSel, toSel].forEach(function (sel) {
      TERMINALS.forEach(function (t) { var o = doc.createElement('option'); o.value = t.id; o.textContent = t.name; sel.appendChild(o); });
    });
    fromSel.value = 'brampton'; toSel.value = 'saltillo';
    fromSel.addEventListener('change', function () { setLane(); });
    toSel.addEventListener('change', function () { setLane(); });
    $('#laneSwap').addEventListener('click', function () { setLane(toSel.value, fromSel.value); });
    $('#laneForm').addEventListener('submit', function (e) { e.preventDefault(); });
    // Carry the planner's lane into the quote form before the hash jump happens.
    $('#laneQuote').addEventListener('click', function () {
      var qf = $('#q-from'), qt = $('#q-to');
      if (qf) { qf.value = byId[fromSel.value].name; qf.removeAttribute('aria-invalid'); }
      if (qt) { qt.value = byId[toSel.value].name; qt.removeAttribute('aria-invalid'); }
      [qf, qt].forEach(function (el) { var m = el && doc.getElementById(el.id + '-err'); if (m) m.remove(); });
      syncQuoteLane();
    });
    $$('.dir__item').forEach(function (li) {
      var id = li.getAttribute('data-terminal');
      var on = function () { highlightDir(id); };
      var off = function () { highlightDir(null); };
      li.addEventListener('mouseenter', on); li.addEventListener('mouseleave', off);
      li.addEventListener('focusin', on); li.addEventListener('focusout', off);
      li.addEventListener('click', function (e) { if (!e.target.closest('a')) pickTerminal(id); });
      li.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target === li) { e.preventDefault(); li.click(); } });
    });
    setLane();
  }

  /* ------------------------------------------------------------------
     Services sticky index
     ------------------------------------------------------------------ */
  function initServices() {
    var tabs = $$('.sidx [role="tab"]'), panels = $$('.svc');
    if (!tabs.length) return;
    function show(i, focus) {
      tabs.forEach(function (t, k) { var on = k === i; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
      panels.forEach(function (p, k) { var on = k === i; p.hidden = !on; p.classList.toggle('is-active', on); });
      if (hasGSAP) ScrollTrigger.refresh();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { show(i); });
      t.addEventListener('keydown', function (e) {
        var n = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
        if (n === null) return; e.preventDefault(); show((n + tabs.length) % tabs.length, true);
      });
    });
    show(0);
  }

  /* ------------------------------------------------------------------
     Fleet: 3D tilt + magnetic buttons
     ------------------------------------------------------------------ */
  function initTilt() {
    if (reduce || !finePointer) return;
    $$('.tilt').forEach(function (card) {
      var raf = 0;
      card.addEventListener('pointermove', function (e) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          var r = card.getBoundingClientRect();
          var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
          card.style.setProperty('--ry', ((px - .5) * 7).toFixed(2) + 'deg');
          card.style.setProperty('--rx', ((.5 - py) * 5).toFixed(2) + 'deg');
          card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
          card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
          card.style.transitionDuration = '.15s';
        });
      });
      card.addEventListener('pointerleave', function () {
        card.style.transitionDuration = '';
        card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg');
      });
    });
  }
  function initMagnetic() {
    if (reduce || !finePointer) return;
    $$('.magnetic').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        el.style.setProperty('--bx', (dx * .22).toFixed(1) + 'px');
        el.style.setProperty('--by', (dy * .32).toFixed(1) + 'px');
      });
      el.addEventListener('pointerleave', function () { el.style.setProperty('--bx', '0px'); el.style.setProperty('--by', '0px'); });
    });
  }

  /* ------------------------------------------------------------------
     Testimonial deck: snap, arrows, drag, keys
     ------------------------------------------------------------------ */
  function initDeck() {
    var vp = $('#deckViewport'); if (!vp) return;
    var cards = $$('.quote-card', vp), now = $('#deckNow'), bar = $('#deckBar');
    var prev = $('#deckPrev'), next = $('#deckNext'), idx = 0;
    function cardLeft(i) { return cards[i].offsetLeft - cards[0].offsetLeft; }
    function go(i) { i = clamp(i, 0, cards.length - 1); vp.scrollTo({ left: cardLeft(i), behavior: reduce ? 'auto' : 'smooth' }); }
    function sync() {
      var x = vp.scrollLeft, best = 0, bd = Infinity;
      cards.forEach(function (c, i) { var d = Math.abs(cardLeft(i) - x); if (d < bd) { bd = d; best = i; } });
      if (vp.scrollLeft + vp.clientWidth >= vp.scrollWidth - 4) best = cards.length - 1;
      idx = best;
      cards.forEach(function (c, i) { c.classList.toggle('is-active', i === idx); c.setAttribute('aria-hidden', i === idx ? 'false' : 'true'); });
      now.textContent = String(idx + 1).padStart(2, '0');
      bar.style.transform = 'translateX(' + (idx * 100) + '%)';
      prev.disabled = idx === 0; next.disabled = idx === cards.length - 1;
    }
    var st = 0;
    vp.addEventListener('scroll', function () { cancelAnimationFrame(st); st = requestAnimationFrame(sync); }, { passive: true });
    prev.addEventListener('click', function () { go(idx - 1); });
    next.addEventListener('click', function () { go(idx + 1); });
    vp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1); }
    });
    // mouse drag
    var down = false, sx = 0, sl = 0, moved = false, startIdx = 0;
    vp.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = true; moved = false; sx = e.clientX; sl = vp.scrollLeft; startIdx = idx;
    });
    win.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - sx;
      if (!moved && Math.abs(dx) > 4) { moved = true; vp.classList.add('is-drag'); }
      if (moved) vp.scrollLeft = sl - dx;
    });
    win.addEventListener('pointerup', function (e) {
      if (!down) return; down = false;
      if (!moved) return;
      vp.classList.remove('is-drag');
      var dx = e.clientX - sx;
      go(Math.abs(dx) > 60 ? startIdx + (dx < 0 ? 1 : -1) : startIdx);
    });
    sync();
  }

  /* ------------------------------------------------------------------
     Story: pinned horizontal timeline (desktop) / vertical elsewhere
     ------------------------------------------------------------------ */
  function initStory() {
    var trackEl = $('#storyTrack'); if (!trackEl) return;
    var items = $$('.tl', trackEl);
    var horizontal = hasGSAP && !reduce;
    if (horizontal) {
      var mm = gsap.matchMedia();
      mm.add('(min-width: 1024px)', function () {
        var pin = $('#storyPin'), bar = $('#storyProgress');
        var dist = function () { return Math.max(0, trackEl.scrollWidth - win.innerWidth); };
        var tween = gsap.to(trackEl, {
          x: function () { return -dist(); }, ease: 'none',
          scrollTrigger: {
            trigger: pin, start: 'top top', end: function () { return '+=' + dist(); },
            pin: true, scrub: .6, invalidateOnRefresh: true, anticipatePin: 1,
            onUpdate: function (self) {
              bar.style.transform = 'scaleX(' + self.progress.toFixed(4) + ')';
              var lim = win.innerWidth * .66;
              var all = self.progress > .96;
              items.forEach(function (it) { it.classList.toggle('is-on', all || it.getBoundingClientRect().left < lim); });
            }
          }
        });
        items.forEach(function (it, i) { it.classList.toggle('is-on', i === 0); });
        return function () { tween.kill(); items.forEach(function (it) { it.classList.remove('is-on'); }); };
      });
      mm.add('(max-width: 1023px)', function () { return verticalObserve(); });
    } else {
      verticalObserve();
    }
    function verticalObserve() {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) e.target.classList.add('is-on'); });
      }, { rootMargin: '0px 0px -35% 0px' });
      items.forEach(function (it) { io.observe(it); });
      return function () { io.disconnect(); };
    }
  }

  /* ------------------------------------------------------------------
     Quote form: validation + mailto composer
     ------------------------------------------------------------------ */
  function matchTerminal(v) {
    v = (v || '').trim().toLowerCase(); if (!v) return null;
    for (var i = 0; i < TERMINALS.length; i++) {
      var city = TERMINALS[i].name.split(',')[0].toLowerCase();
      if (v === TERMINALS[i].name.toLowerCase() || v === city || v.indexOf(city + ',') === 0) return TERMINALS[i].id;
    }
    return null;
  }
  var qLane = $('#qLane');
  function syncQuoteLane() {
    if (!qLane) return;
    var a = matchTerminal(($('#q-from') || {}).value), b = matchTerminal(($('#q-to') || {}).value);
    if (!a || !b || a === b) { qLane.textContent = ''; return ''; }
    var info = legInfo(a, b); if (!info) { qLane.textContent = ''; return ''; }
    var s = '≈ ' + fmt(info.km) + ' km by road (estimate)';
    qLane.textContent = s;
    return s;
  }
  function initQuote() {
    var form = $('#quoteForm'); if (!form) return;
    var done = $('#quoteDone'), err = $('#qError'), again = $('#qMailAgain');
    var dateEl = $('#q-date');
    if (dateEl) { var d = new Date(); dateEl.min = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
    ['#q-from', '#q-to'].forEach(function (s) {
      var el = $(s); if (!el) return;
      el.addEventListener('input', function () {
        syncQuoteLane();
        var a = matchTerminal($('#q-from').value), b = matchTerminal($('#q-to').value);
        if (a && b && a !== b) setLane(a, b, true);
      });
    });
    form.addEventListener('input', function (e) { if (e.target.getAttribute('aria-invalid') === 'true') { e.target.removeAttribute('aria-invalid'); var m = e.target.parentNode.querySelector('.field__err'); if (m) m.remove(); e.target.removeAttribute('aria-describedby'); refreshSummary(); } });
    form.addEventListener('change', function (e) { if (e.target.tagName === 'SELECT' && e.target.value) { e.target.removeAttribute('aria-invalid'); var m = e.target.parentNode.querySelector('.field__err'); if (m) m.remove(); } });

    function refreshSummary() {
      if (!err.textContent) return;
      var n = $$('[aria-invalid="true"]', form).length;
      err.textContent = n ? 'Please complete the ' + n + ' highlighted field' + (n === 1 ? '' : 's') + '.' : '';
    }
    function fieldError(el, msg) {
      el.setAttribute('aria-invalid', 'true');
      var id = el.id + '-err', m = doc.getElementById(id);
      if (!m) { m = doc.createElement('span'); m.className = 'field__err'; m.id = id; el.parentNode.appendChild(m); }
      m.textContent = msg;
      el.setAttribute('aria-describedby', id);
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var bad = [];
      $$('[required]', form).forEach(function (el) {
        var v = (el.value || '').trim(), label = form.querySelector('label[for="' + el.id + '"]').childNodes[0].textContent.trim();
        var msg = '';
        if (!v) msg = 'Required';
        else if (el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) msg = 'Enter a valid email';
        else if (el.type === 'tel' && v.replace(/\D/g, '').length < 7) msg = 'Enter a phone number (7+ digits)';
        if (msg) { fieldError(el, msg); bad.push(msg); }
      });
      if (bad.length) {
        err.textContent = 'Please complete the ' + bad.length + ' highlighted field' + (bad.length === 1 ? '' : 's') + '.';
        var first = $('[aria-invalid="true"]', form);
        if (first) {
          first.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
          first.focus({ preventScroll: true });
        }
        return;
      }
      err.textContent = '';
      var v = function (n) { return (form.elements[n].value || '').trim(); };
      var est = syncQuoteLane();
      var lines = [
        'Quote request (hunterexpress.ca)',
        '',
        'Company:    ' + v('company'),
        'Name:       ' + v('name'),
        'Email:      ' + v('email'),
        'Phone:      ' + v('phone'),
        '',
        'From:       ' + v('from'),
        'To:         ' + v('to'),
        est ? 'Estimate:   ' + est : null,
        'Equipment:  ' + v('equipment'),
        'Weight:     ' + v('weight'),
        'Ready date: ' + v('date'),
        '',
        'Notes:',
        v('notes') || '(none)'
      ].filter(function (l) { return l !== null; });
      var subject = 'Quote request: ' + v('from') + ' to ' + v('to') + ' (' + v('company') + ')';
      var href = 'mailto:info@hunterexpress.ca?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
      again.setAttribute('href', href);
      form.hidden = true; done.hidden = false; done.focus();
      win.location.href = href;
    });
    $('#qReset').addEventListener('click', function () { form.reset(); syncQuoteLane(); done.hidden = true; form.hidden = false; $('#q-company').focus(); });
  }

  /* ------------------------------------------------------------------
     boot
     ------------------------------------------------------------------ */
  function boot() {
    measureWorld();
    initNav();
    initMap();
    initMotion();
    initOdometers();
    initOnce('.odo-grid', 'is-drawn', .2);
    initServices();
    initTilt();
    initMagnetic();
    initDeck();
    initStory();
    initQuote();
    collectKm();
    onScroll();
    win.addEventListener('scroll', onScroll, { passive: true });
    var relayout = function () { measureWorld(); collectKm(); onScroll(); };
    win.addEventListener('resize', relayout);
    win.addEventListener('load', function () {
      if (hasGSAP) ScrollTrigger.refresh();
      relayout();
    });
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { if (hasGSAP) ScrollTrigger.refresh(); relayout(); });
    if (hasGSAP) ScrollTrigger.addEventListener('refresh', function () { measureWorld(); collectKm(); });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})();
