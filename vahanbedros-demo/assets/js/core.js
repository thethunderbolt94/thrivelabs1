/*!
 * Vahan Bedros shared runtime  ->  window.VB
 *
 * Loaded with `defer` after GSAP. Works when window.gsap is missing (CDN blocked) and never throws:
 * every auto behaviour runs inside its own try/catch.
 *
 * API
 *   VB.reduced                          prefers-reduced-motion: reduce
 *   VB.slow                             "Slow down" is on (also html.slow)
 *   VB.cover(boxW, boxH, W, H, fx, fy)  -> {sc, dw, dh, dx, dy}  cover-fit of a WxH source in a box,
 *                                          keeping the source point (fx, fy) (0..1) as close to the middle as possible
 *   VB.scene(el, fn)                    register fn(p, el) for a .scene element; p = sticky-stage progress 0..1.
 *                                          Core sets --p (3 decimals) on the scene on every scroll/resize, adds
 *                                          .on when 20% of it is visible and .done 5.6 s later. Every .scene on the
 *                                          page gets this automatically, VB.scene only adds a callback.
 *   VB.spot(container, x, y)            sets --sx / --sy (px) on container
 *   VB.frames({canvas, urls, fx, fy})   -> {draw(i), layout(), count, geo}  canvas film scrubber. The canvas must be
 *                                          sized by CSS (position:absolute; inset:0; width:100%; height:100%).
 *   VB.clamp(v, a, b), VB.smooth(a, b, v), VB.refresh()          small helpers
 *   VB.notes.on() / .off() / .count                              the Open questions layer
 *   VB.menu.open() / .close() / .isOpen                          the full-screen menu overlay (below 1024px)
 *
 * Rolling banners: [data-marquee] > .marquee__track > .marquee__group (see initMarquee for the data- options).
 *
 * Auto behaviours (on DOMContentLoaded)
 *   [data-reveal]   below-the-fold elements get .below (hidden by CSS only under html.js); .is-in reveals them.
 *                   .done is added 2.4 s later and any still-running transition is finished, so a paused animation
 *                   clock can not strand them.
 *   [data-deliver]  Delivered Type. Text is split into .w word spans (children with [data-fx] stay whole and get the
 *                   class fx-<name>, wrapped in a .w). --d = delay in seconds. .on when in view, .done at total + 1 s.
 *   .scene          --p, .on, .done (see VB.scene).
 *   [data-spot]     .on when 20% visible, .done 5.6 s later (the lamp and Delivered Type play off the nearest
 *                   .scene or [data-spot] ancestor). No --p.
 *   [data-tbc]      numbered (data-tbc-n); #notes-toggle pill and #notes-panel drawer injected; #notes in the URL turns
 *                   the layer on (html.notes-on).
 *   [data-slowdown] toggles html.slow + aria-pressed, remembered in localStorage, GSAP timeScale 0.55.
 *   [data-menu-open] opens #site-menu (the overlay behind the header's Menu button): html.menu-open locks page scroll,
 *                   aria-expanded follows, focus moves in and is trapped (everything else is made inert), Escape / the
 *                   [data-menu-close] button / any link inside close it and give focus back. It closes itself at 1024px+.
 *   .site-header.is-solid after 40px of scroll; .bottom-bar.is-shown after the first scene (or 70vh) has gone by.
 *
 * Failsafes: everything above or inside the viewport is snapped to its finished state 0.9 s, 2.5 s and 6 s after
 * load, on every scroll, and every 2 s while something is still pending.
 */
(function () {
  'use strict';

  var win = window, doc = document, root = doc.documentElement;
  try { root.classList.add('js'); } catch (e) { /* ignore */ }
  if (win.VB && win.VB.__core) return;

  var reduced = false;
  try { reduced = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }

  // ---------------------------------------------------------------- helpers
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var smooth = function (a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  var vh = function () { return win.innerHeight || root.clientHeight || 0; };
  var scrollY = function () { return win.pageYOffset || root.scrollTop || 0; };
  var safe = function (name, fn) {
    try { return fn(); } catch (e) { try { console.error('[VB] ' + name + ':', e); } catch (_) { /* ignore */ } }
  };
  var all = function (sel, scope) { return Array.prototype.slice.call((scope || doc).querySelectorAll(sel)); };

  /** Where a WxH source lands in a box when covering it, keeping source point (fx, fy) near the middle. */
  function cover(boxW, boxH, W, H, fx, fy) {
    var sc = Math.max(boxW / W, boxH / H), dw = W * sc, dh = H * sc;
    var dx = clamp(boxW / 2 - fx * dw, boxW - dw, 0), dy = clamp(boxH * 0.5 - fy * dh, boxH - dh, 0);
    return { sc: sc, dw: dw, dh: dh, dx: dx, dy: dy };
  }

  function spot(container, x, y) {
    if (!container || !container.style) return;
    var px = function (v) { return typeof v === 'number' ? (Math.round(v * 10) / 10) + 'px' : String(v); };
    container.style.setProperty('--sx', px(x));
    container.style.setProperty('--sy', px(y));
  }

  var VB = {
    __core: true,
    reduced: reduced,
    slow: false,
    cover: cover,
    spot: spot,
    clamp: clamp,
    smooth: smooth
  };
  win.VB = VB;

  // ---------------------------------------------------------------- finishing states
  // Seconds -> ms, longer while "Slow down" stretches the CSS animations.
  function slowFactor() {
    if (!VB.slow) return 1;
    var k = 0;
    try { k = parseFloat(getComputedStyle(root).getPropertyValue('--slow')); } catch (e) { /* ignore */ }
    return k >= 1 && k <= 4 ? k : 1.82;
  }

  /** Snap an element to its finished state: .done (CSS) plus finish any CSS transition/animation still running. */
  function settle(el, animations) {
    el.classList.add('done');
    if (!animations || typeof el.getAnimations !== 'function') return;
    try {
      el.getAnimations({ subtree: true }).forEach(function (a) { try { a.finish(); } catch (e) { /* infinite animations can not finish */ } });
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- watch list: reveal / deliver / scene
  var targets = [];
  var byEl = typeof WeakMap === 'function' ? new WeakMap() : null;
  var io = null;
  if ('IntersectionObserver' in win) {
    try {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var t = byEl && byEl.get(en.target);
          if (t && !t.fired) check(t, false);
        });
      }, { threshold: [0, 0.05, 0.2, 0.5], rootMargin: '0px 0px -8% 0px' });
    } catch (e) { io = null; }
  }

  function watch(el, kind, test, fire) {
    var t = { el: el, kind: kind, test: test, fire: fire, fired: false };
    targets.push(t);
    if (byEl) byEl.set(el, t);
    if (io) { try { io.observe(el); } catch (e) { /* ignore */ } }
    return t;
  }

  /** Test one target against its rect and fire it. `snap` = nobody can see the animation, so finish at once. */
  function check(t, failsafe) {
    if (t.fired) return;
    var r = t.el.getBoundingClientRect(), h = vh();
    if (!t.test(r, h, failsafe)) return;
    t.fired = true;
    t.fire(r.bottom <= 0 || reduced);
  }

  var sweepAgain = 0;
  /** Check everything pending. `failsafe` widens "in view" to "not below the viewport". */
  function sweep(failsafe) {
    var pending = 0;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (t.fired) continue;
      safe('sweep ' + t.kind, function () { check(t, failsafe); });
      if (!t.fired) pending++;
    }
    if (pending && !sweepAgain) {
      sweepAgain = win.setTimeout(function () { sweepAgain = 0; sweep(false); }, 2000);
    }
  }

  // ---- reveal
  function initReveal() {
    var els = all('[data-reveal]');
    if (!els.length) return;
    var h = vh();
    // Read every rect first, then write classes.
    var rects = els.map(function (el) { return el.getBoundingClientRect(); });
    els.forEach(function (el, i) {
      if (reduced) { el.classList.add('is-in', 'done'); return; }
      if (rects[i].top >= h) el.classList.add('below');          // only what the first screen does not show
      watch(el, 'reveal',
        function (r, hh, fs) { return r.top < hh * (fs ? 1 : 0.92); },
        function (snap) {
          el.classList.add('is-in');
          if (snap) settle(el, true);
          else win.setTimeout(function () { settle(el, true); }, 2400);
        });
    });
    if (reduced) return;
    // Elements that are already on the first screen are not hidden; mark them in so CSS variants can rely on it.
    targets.forEach(function (t) { if (t.kind === 'reveal' && !t.el.classList.contains('below')) check(t, false); });
  }

  // ---- Delivered Type
  var TAGS_SKIP = { SCRIPT: 1, STYLE: 1, SVG: 1, IMG: 1, CANVAS: 1, TEXTAREA: 1, SELECT: 1, NOSCRIPT: 1 };
  var PUNCT = /[.,;:\u2026][\u201D\u2019"')\]]*$/;
  var WORD_GAP = /([ \t\n\r\f]+)/;

  /** Split the text of el into .w spans with --d delays. Returns the delay of the last word, in seconds. */
  function splitDeliver(el) {
    if (el.__vbTotal !== undefined) return el.__vbTotal;
    var label = (el.textContent || '').replace(/\s+/g, ' ').trim();
    var d = 0, started = false, rowBreak = false, prevPunct = false;

    function stamp(w, text) {
      if (!started) { d = 0.45; started = true; }
      else d += 0.12 + (prevPunct ? 0.18 : 0) + (rowBreak ? 0.45 : 0);
      rowBreak = false;
      prevPunct = PUNCT.test(text);
      w.style.setProperty('--d', d.toFixed(2) + 's');
    }

    function walk(parent) {
      var kids = Array.prototype.slice.call(parent.childNodes);
      kids.forEach(function (n) {
        if (n.nodeType === 3) {
          var parts = n.nodeValue.split(WORD_GAP);
          if (parts.length === 1 && !parts[0].trim()) return;
          var frag = doc.createDocumentFragment();
          parts.forEach(function (part) {
            if (!part) return;
            if (!part.trim() && WORD_GAP.test(part)) { frag.appendChild(doc.createTextNode(' ')); return; }
            var w = doc.createElement('span');
            w.className = 'w';
            w.textContent = part;
            stamp(w, part);
            frag.appendChild(w);
          });
          parent.replaceChild(frag, n);
        } else if (n.nodeType === 1) {
          if (TAGS_SKIP[n.tagName.toUpperCase()]) return;
          if (n.classList.contains('w')) { // already split by hand: keep its own delay in the running total
            var own = parseFloat(n.style.getPropertyValue('--d'));
            if (own === own) { d = Math.max(d, own); started = true; }
            return;
          }
          if (n.tagName === 'BR') { rowBreak = true; return; }
          if (n.hasAttribute('data-fx')) {
            var wrap = doc.createElement('span');
            wrap.className = 'w';
            var fx = n.getAttribute('data-fx');
            if (/^[\w-]+$/.test(fx)) n.classList.add('fx-' + fx);
            parent.insertBefore(wrap, n);
            wrap.appendChild(n);
            stamp(wrap, n.textContent || '');
            return;
          }
          if (n.classList.contains('row') && started) rowBreak = true;
          walk(n);
        }
      });
    }

    walk(el);
    if (!el.hasAttribute('aria-label') && label) el.setAttribute('aria-label', label);
    el.__vbTotal = started ? d : 0;
    return el.__vbTotal;
  }

  function initDeliver() {
    all('[data-deliver]').forEach(function (el) {
      safe('deliver', function () {
        var last = splitDeliver(el);
        if (reduced) { el.classList.add('on', 'done'); return; }
        watch(el, 'deliver',
          function (r, hh, fs) { return r.top < hh * (fs ? 1 : 0.85); },
          function (snap) {
            el.classList.add('on');
            if (snap) { settle(el, true); return; }
            var ms = (last + 0.75 + 1) * 1000 * slowFactor();     // last word starts at `last`, runs ~0.75 s, +1 s for effects
            win.setTimeout(function () { settle(el, true); }, ms);
          });
      });
    });
  }

  // ---- scenes
  var scenes = [];

  function sceneProgress(el) {
    if (reduced) return 1;
    var r = el.getBoundingClientRect(), h = vh() || 1, span = r.height - h;
    if (span > 8) return clamp(-r.top / span, 0, 1);               // tall scene: sticky stage progress
    return clamp((h - r.top) / (h + r.height), 0, 1);               // short scene: viewport traversal
  }

  /** .on when 20% of the element is visible, .done 5.6 s later. Used for .scene and [data-spot] containers. */
  function watchState(el, kind) {
    watch(el, kind,
      function (r, hh, fs) {
        if (r.bottom <= 0) return true;                              // already scrolled past
        if (fs) return r.top < hh;
        var seen = Math.min(r.bottom, hh) - Math.max(r.top, 0);
        return seen >= 0.2 * Math.min(r.height, hh);
      },
      function (snap) {
        el.classList.add('on');
        if (snap) { el.classList.add('done'); return; }
        win.setTimeout(function () { el.classList.add('done'); }, 5600 * slowFactor());
      });
    if (reduced) el.classList.add('on', 'done');
  }

  function sceneRec(el) {
    for (var i = 0; i < scenes.length; i++) if (scenes[i].el === el) return scenes[i];
    var rec = { el: el, fns: [], p: -1 };
    scenes.push(rec);
    watchState(el, 'scene');
    return rec;
  }

  function runScene(fn, p, el) {
    try { fn(p, el); } catch (e) {
      if (!fn.__vbWarned) { fn.__vbWarned = true; try { console.error('[VB] scene callback:', e); } catch (_) { /* ignore */ } }
    }
  }

  /** Set --p and call the scene's functions when the progress changed (or `force`). `only` limits the call to one fn. */
  function stepScene(rec, force, only) {
    var p = Math.round(sceneProgress(rec.el) * 1000) / 1000;
    if (!force && p === rec.p) return;
    rec.p = p;
    rec.el.style.setProperty('--p', p.toFixed(3));
    var fns = only ? [only] : rec.fns;
    for (var k = 0; k < fns.length; k++) runScene(fns[k], p, rec.el);
  }

  function updateScenes(force) {
    for (var i = 0; i < scenes.length; i++) stepScene(scenes[i], force);
  }

  VB.scene = function (el, fn) {
    if (typeof el === 'string') el = doc.querySelector(el);
    if (!el || el.nodeType !== 1) return null;
    var rec = sceneRec(el);
    if (typeof fn === 'function') {
      rec.fns.push(fn);
      if (inited) stepScene(rec, true, fn);                          // registered late: give it its first value now
    }                                                                // (before DOMContentLoaded the first update does it)
    return { el: el, refresh: function () { updateScenes(true); } };
  };

  // ---------------------------------------------------------------- frames (canvas film scrubber)
  VB.frames = function (opts) {
    var o = opts || {}, canvas = o.canvas, urls = (o.urls || []).slice(), count = urls.length;
    var fx = o.fx == null ? 0.5 : o.fx, fy = o.fy == null ? 0.5 : o.fy;
    var api = { count: count, draw: function () {}, layout: function () {}, geo: null };
    var ctx = null;
    try { ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null; } catch (e) { ctx = null; }
    if (!ctx || !count) return api;

    var imgs = new Array(count), queue = [], active = 0, started = false;
    var W = 0, H = 0, geo = null, cur = 0, shown = -1;     // shown = frame currently on the canvas

    function ready(i) { var im = imgs[i]; return !!(im && im.complete && im.naturalWidth > 0); }

    function paint() {
      if (!geo) return;
      var j = cur;
      while (j >= 0 && !ready(j)) j--;                               // nearest loaded frame at or before the wanted one
      if (j < 0 || j === shown) return;                              // nothing yet (the CSS poster stays visible) or already drawn
      shown = j;
      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgs[j], geo.dx * geo.dpr, geo.dy * geo.dpr, geo.dw * geo.dpr, geo.dh * geo.dpr);
      } catch (e) { /* a broken frame must not stop the page */ }
    }

    function layout() {
      if (!W) return;
      var bw = canvas.offsetWidth, bh = canvas.offsetHeight;
      if ((!bw || !bh) && canvas.parentElement) { bw = canvas.parentElement.offsetWidth; bh = canvas.parentElement.offsetHeight; }
      if (!bw || !bh) return;
      var dpr = Math.min(win.devicePixelRatio || 1, 2);
      var pw = Math.round(bw * dpr), ph = Math.round(bh * dpr);
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      shown = -1;
      geo = cover(bw, bh, W, H, fx, fy);
      geo.dpr = dpr; geo.W = W; geo.H = H; geo.boxW = bw; geo.boxH = bh;
      api.geo = geo;
      paint();
    }

    function load(i, done) {
      if (imgs[i] !== undefined) { if (done) done(); return; }
      var im = new Image();
      im.decoding = 'async';
      imgs[i] = im;
      im.onload = function () {
        if (!W && im.naturalWidth) { W = im.naturalWidth; H = im.naturalHeight; layout(); }
        else if (i <= cur) paint();
        if (done) done();
      };
      im.onerror = function () { imgs[i] = null; if (done) done(); };
      im.src = urls[i];
    }

    function pump() {
      while (active < 4 && queue.length) {
        active++;
        load(queue.shift(), function () { active--; pump(); });
      }
    }

    // Phones and Save-Data load every second frame (plus the last, real photo): half the bytes, the same film.
    var lite = false;
    try { lite = !!(win.matchMedia && win.matchMedia('(max-width: 759.98px)').matches) || !!(win.navigator.connection && win.navigator.connection.saveData); } catch (e) { lite = false; }
    var step = lite ? 2 : 1;
    function want(i) { return (step === 1 || i === count - 1) ? i : i - (i % step); }

    function startRest() {
      if (started) return;
      started = true;
      if (reduced) { queue.push(count - 1); }                         // reduced motion only ever shows the last frame
      else for (var i = 1; i < count; i++) { if (i % step === 0 || i === count - 1) queue.push(i); }
      pump();
    }

    api.count = count;
    api.draw = function (i) {
      cur = clamp(Math.round(+i || 0), 0, count - 1);
      var w = want(cur);
      if (started && imgs[w] === undefined) { queue.unshift(w); pump(); }       // asked for a frame that is not queued yet
      paint();
    };
    api.layout = layout;

    load(0);
    if (reduced && count > 1) load(count - 1);
    // The rest of the film loads on the first sign of intent (scroll, touch, key), or 2.5 s after the page
    // has loaded, so a visitor who never scrolls does not pay for it up front.
    var kick = function () { startRest(); };
    ['scroll', 'wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (ev) {
      try { win.addEventListener(ev, kick, { once: true, passive: true }); } catch (e) { win.addEventListener(ev, kick); }
    });
    var later = function () { win.setTimeout(startRest, 2500); };
    if (win.document.readyState === 'complete') later(); else win.addEventListener('load', later);

    var pendingLayout = false;
    var relayout = function () {
      if (pendingLayout) return;
      pendingLayout = true;
      var run = function () { pendingLayout = false; layout(); };
      if (win.requestAnimationFrame) win.requestAnimationFrame(run); else win.setTimeout(run, 16);
    };
    if ('ResizeObserver' in win) { try { new ResizeObserver(relayout).observe(canvas); } catch (e) { win.addEventListener('resize', relayout); } }
    else win.addEventListener('resize', relayout);
    return api;
  };

  // ---------------------------------------------------------------- notes layer (Open questions)
  var notesApi = { count: 0, on: function () {}, off: function () {} };
  VB.notes = notesApi;

  function initNotes() {
    var items = all('[data-tbc]');
    items.forEach(function (el, i) { el.setAttribute('data-tbc-n', String(i + 1)); });
    notesApi.count = items.length;
    if (!items.length || !doc.body) return;

    var pill = doc.createElement('button');
    pill.type = 'button';
    pill.id = 'notes-toggle';
    pill.className = 'notes-toggle';
    pill.setAttribute('aria-expanded', 'false');
    pill.setAttribute('aria-controls', 'notes-panel');
    var label = doc.createElement('span');
    label.className = 'notes-label';
    label.textContent = 'Open questions ';
    pill.appendChild(label);
    var count = doc.createElement('span');
    count.className = 'notes-count';
    count.textContent = String(items.length);
    pill.appendChild(count);

    var panel = doc.createElement('aside');
    panel.id = 'notes-panel';
    panel.className = 'notes-panel';
    panel.setAttribute('hidden', '');
    var h = doc.createElement('h2');
    h.textContent = 'Questions for you';
    var ol = doc.createElement('ol');
    items.forEach(function (el, i) {
      var li = doc.createElement('li'), b = doc.createElement('button');
      b.type = 'button';
      b.setAttribute('data-goto', String(i + 1));
      b.textContent = el.getAttribute('data-note') || 'A question for you';
      li.appendChild(b);
      ol.appendChild(li);
    });
    panel.appendChild(h);
    panel.appendChild(ol);
    doc.body.appendChild(pill);
    doc.body.appendChild(panel);

    function set(on) {
      root.classList.toggle('notes-on', on);
      pill.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
    }
    notesApi.on = function () { set(true); };
    notesApi.off = function () { set(false); };

    pill.addEventListener('click', function () { set(panel.hasAttribute('hidden')); });
    panel.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-goto]') : null;
      if (!b) return;
      var target = doc.querySelector('[data-tbc-n="' + b.getAttribute('data-goto') + '"]');
      if (!target) return;
      try { target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' }); } catch (err) { target.scrollIntoView(); }
      if (!target.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) target.setAttribute('tabindex', '-1');
      try { target.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      if (win.innerWidth < 760) { panel.setAttribute('hidden', ''); pill.setAttribute('aria-expanded', 'false'); }   // keep the underlines, free the screen
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hasAttribute('hidden')) { set(false); try { pill.focus(); } catch (err) { /* ignore */ } }
    });

    var fromHash = function () { if (/^#notes(?:$|[?&=])/.test(win.location.hash)) set(true); };
    fromHash();
    win.addEventListener('hashchange', fromHash);
  }

  // ---------------------------------------------------------------- Slow down
  function gsapRate() {
    try { if (win.gsap && win.gsap.globalTimeline) win.gsap.globalTimeline.timeScale(VB.slow ? 0.55 : 1); } catch (e) { /* ignore */ }
  }
  function applySlow(on, persist) {
    VB.slow = on;
    root.classList.toggle('slow', on);
    all('[data-slowdown]').forEach(function (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    if (persist) { try { win.localStorage.setItem('vb-slow', on ? '1' : '0'); } catch (e) { /* ignore */ } }
    gsapRate();
  }
  function initSlow() {
    var on = false;
    try { on = win.localStorage.getItem('vb-slow') === '1'; } catch (e) { /* ignore */ }
    applySlow(on, false);
    doc.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-slowdown]') : null;
      if (b) applySlow(!VB.slow, true);
    });
    win.addEventListener('load', gsapRate);                          // GSAP may arrive after DOMContentLoaded
  }

  // ---------------------------------------------------------------- rolling banners
  // [data-marquee] > .marquee__track > .marquee__group. The group is copied (aria-hidden, nothing focusable, no notes)
  // until the track covers two screens, then the track drifts data-speed px/s (default 50) to the left, or to the
  // right with data-dir="1". Scrolling pushes it faster; data-skew also leans it with the scroll, data-react="flip"
  // turns it round while the page scrolls back up, data-hover="pause" lets it coast to a stop under the pointer.
  // It only moves while on screen. Reduced motion leaves it still (the CSS lets it scroll sideways instead).
  var marquees = [], mqRaf = 0, mqT = 0, mqY = 0, mqV = 0, mqHeading = 1;

  function marqueeFill(m) {
    all('.marquee__group[data-copy]', m.track).forEach(function (n) { m.track.removeChild(n); });
    m.w = m.group.getBoundingClientRect().width;
    if (!m.w) return;
    var copies = Math.max(1, Math.ceil(m.el.clientWidth * 2 / m.w));
    for (var i = 0; i < copies; i++) {
      var c = m.group.cloneNode(true);
      c.setAttribute('data-copy', '');
      c.setAttribute('aria-hidden', 'true');
      all('[id]', c).concat([c]).forEach(function (n) { n.removeAttribute('id'); });
      all('[data-tbc]', c).forEach(function (n) { n.removeAttribute('data-tbc'); n.removeAttribute('data-tbc-n'); n.removeAttribute('data-note'); });
      all('a, button, [tabindex]', c).forEach(function (n) { n.setAttribute('tabindex', '-1'); });
      m.track.appendChild(c);
    }
    m.x = m.x % m.w;
    if (m.x > 0) m.x -= m.w;
  }

  function marqueeFrame(t) {
    mqRaf = 0;
    var dt = mqT ? Math.min((t - mqT) / 1000, 0.05) : 0;
    mqT = t;
    var y = scrollY();
    mqV += ((y - mqY) - mqV) * 0.14;                                  // smoothed scroll speed, px per frame
    mqY = y;
    if (mqV > 0.6) mqHeading = 1; else if (mqV < -0.6) mqHeading = -1;
    var boost = clamp(Math.abs(mqV) * 0.2, 0, 7) * (VB.slow ? 0.5 : 1);
    var running = false;
    marquees.forEach(function (m) {
      if (!m.on || !m.w) return;
      running = true;
      m.k += ((m.hover ? 0 : 1) - m.k) * 0.08;
      var dir = m.dir * (m.flip ? mqHeading : 1);
      m.x += dir * m.speed * (VB.slow ? 0.5 : 1) * (m.k + boost) * dt;
      m.x = m.x % m.w;
      if (m.x > 0) m.x -= m.w;
      var lean = m.skew ? ' skewX(' + clamp(-mqV * 0.3, -9, 9).toFixed(2) + 'deg)' : '';
      m.track.style.transform = 'translate3d(' + m.x.toFixed(2) + 'px,0,0)' + lean;
    });
    if (running && win.requestAnimationFrame) mqRaf = win.requestAnimationFrame(marqueeFrame);
    else mqT = 0;
  }

  function marqueeKick() {
    if (!mqRaf && !reduced && win.requestAnimationFrame) { mqY = scrollY(); mqRaf = win.requestAnimationFrame(marqueeFrame); }
  }

  function initMarquee() {
    all('[data-marquee]').forEach(function (el) {
      safe('marquee', function () {
        var track = el.querySelector('.marquee__track');
        var group = track && track.querySelector('.marquee__group');
        if (!group) return;
        var m = {
          el: el, track: track, group: group, w: 0, x: 0, k: 1, on: false, hover: false,
          speed: parseFloat(el.getAttribute('data-speed')) || 50,
          dir: el.getAttribute('data-dir') === '1' ? 1 : -1,
          skew: el.hasAttribute('data-skew'),
          flip: el.getAttribute('data-react') === 'flip'
        };
        marqueeFill(m);
        marquees.push(m);
        el.classList.add('is-ready');
        if (el.getAttribute('data-hover') === 'pause') {
          el.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') m.hover = true; });
          el.addEventListener('pointerleave', function () { m.hover = false; });
        }
        var refill = function () { var w = group.getBoundingClientRect().width; if (Math.abs(w - m.w) > 1) marqueeFill(m); };
        if ('ResizeObserver' in win) { try { new ResizeObserver(refill).observe(group); } catch (e) { /* ignore */ } }
        win.addEventListener('resize', refill);
        if ('IntersectionObserver' in win) {
          new IntersectionObserver(function (en) { m.on = en[en.length - 1].isIntersecting; if (m.on) marqueeKick(); }, { rootMargin: '80px 0px' }).observe(el);
        } else { m.on = true; }
      });
    });
    if (marquees.length) marqueeKick();
  }

  // ---------------------------------------------------------------- Menu (full-screen overlay below 1024px)
  var menuApi = { isOpen: false, open: function () {}, close: function () {} };
  VB.menu = menuApi;

  function initMenu() {
    var menu = doc.getElementById('site-menu');
    var openers = all('[data-menu-open]');
    if (!menu || !openers.length) return;
    var closers = all('[data-menu-close]', menu);
    var wide = null;
    try { wide = win.matchMedia('(min-width: 1024px)'); } catch (e) { /* ignore */ }
    var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    var inerted = [], returnTo = null, settleTimer = 0;

    var isOpen = function () { return menu.classList.contains('is-open'); };
    function focusables() {
      return all(FOCUSABLE, menu).filter(function (el) { return el.getClientRects().length > 0; });
    }
    function setExpanded(on) {
      openers.forEach(function (b) { b.setAttribute('aria-expanded', on ? 'true' : 'false'); });
    }
    // Everything outside the overlay stops taking focus and clicks while it is open (aria-modal alone is not enough on every browser).
    function setInert(on) {
      if (!on) {
        inerted.forEach(function (el) { el.removeAttribute('inert'); });
        inerted = [];
        return;
      }
      Array.prototype.forEach.call(doc.body.children, function (el) {
        if (el === menu || el.hasAttribute('inert') || /^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(el.tagName)) return;
        el.setAttribute('inert', '');
        inerted.push(el);
      });
    }

    function open() {
      if (isOpen() || (wide && wide.matches)) return;
      returnTo = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : openers[0];
      menu.classList.add('is-open');
      root.classList.add('menu-open');
      setExpanded(true);
      menuApi.isOpen = true;
      var first = closers[0] || focusables()[0];
      try { if (first) first.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      setInert(true);                                                // after the focus move: inert on the focused element would blur it
      win.clearTimeout(settleTimer);
      settleTimer = win.setTimeout(function () { menu.classList.add('is-settled'); }, 1600 * slowFactor());
    }

    function close(restoreFocus) {
      if (!isOpen()) return;
      win.clearTimeout(settleTimer);
      menu.classList.remove('is-open', 'is-settled');
      root.classList.remove('menu-open');
      setExpanded(false);
      setInert(false);
      menuApi.isOpen = false;
      var back = returnTo;
      returnTo = null;
      if (restoreFocus === false) return;
      try { (back && doc.documentElement.contains(back) ? back : openers[0]).focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    menuApi.open = open;
    menuApi.close = function () { close(true); };

    openers.forEach(function (b) { b.addEventListener('click', open); });
    closers.forEach(function (b) { b.addEventListener('click', function () { close(true); }); });

    // A link inside the menu (another page, or an anchor on this one): unlock the page first, then let the browser navigate.
    menu.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (a && menu.contains(a)) close(false);
    });

    doc.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(true); return; }
      if (e.key !== 'Tab') return;
      var f = focusables();
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1], at = doc.activeElement;
      if (!menu.contains(at)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    });
    doc.addEventListener('focusin', function (e) {                   // focus that escaped anyway (browser UI, older engines without inert)
      if (!isOpen() || menu.contains(e.target)) return;
      var f = focusables();
      if (f.length) { try { f[0].focus(); } catch (err) { /* ignore */ } }
    });

    // The overlay only exists below 1024px: if the window grows past it (rotate, resize) there is nothing left to show.
    var onWide = function () { if (wide && wide.matches) close(false); };
    if (wide) {
      if (wide.addEventListener) wide.addEventListener('change', onWide);
      else if (wide.addListener) wide.addListener(onWide);
    } else win.addEventListener('resize', function () { if (win.innerWidth >= 1024) close(false); });
    win.addEventListener('pageshow', function () { if (isOpen()) close(false); });   // back/forward cache
  }

  // ---------------------------------------------------------------- header, bottom bar, scroll loop
  var header = null, bar = null, firstScene = null;

  function updateChrome() {
    var y = scrollY();
    if (header) header.classList.toggle('is-solid', y > 40);
    if (bar) {
      var shown;
      if (firstScene) shown = firstScene.getBoundingClientRect().bottom <= vh() * 0.35;
      else shown = y > vh() * 0.7;
      bar.classList.toggle('is-shown', shown);
    }
  }

  var ticking = 0, backup = 0;
  function tick() {
    if (win.cancelAnimationFrame && ticking) win.cancelAnimationFrame(ticking);
    win.clearTimeout(backup);
    ticking = 0; backup = 0;
    safe('chrome', updateChrome);
    safe('scenes', function () { updateScenes(false); });
    safe('sweep', function () { sweep(false); });
  }
  function schedule() {
    if (ticking || backup) return;
    if (win.requestAnimationFrame) ticking = win.requestAnimationFrame(tick);
    backup = win.setTimeout(tick, 120);                              // rAF does not run in hidden tabs
  }

  VB.refresh = function () {
    safe('refresh', function () { updateChrome(); updateScenes(true); sweep(false); });
  };

  // ---------------------------------------------------------------- init
  var inited = false;
  function init() {
    if (inited) return;
    inited = true;
    header = doc.querySelector('.site-header');
    bar = doc.querySelector('.bottom-bar');
    firstScene = doc.querySelector('.scene');

    safe('notes', initNotes);
    safe('slow', initSlow);
    safe('menu', initMenu);
    safe('deliver', initDeliver);
    safe('reveal', initReveal);
    safe('marquee', initMarquee);
    safe('scenes', function () { all('.scene').forEach(sceneRec); });
    safe('spots', function () { all('[data-spot]').forEach(function (el) { if (!el.classList.contains('scene')) watchState(el, 'spot'); }); });
    safe('first update', function () { updateChrome(); updateScenes(true); sweep(false); });

    win.addEventListener('scroll', schedule, { passive: true });
    win.addEventListener('resize', function () { safe('resize', function () { updateChrome(); updateScenes(true); sweep(false); }); });
    doc.addEventListener('visibilitychange', schedule);
    win.addEventListener('pageshow', schedule);

    // Timed failsafes, so paused or throttled animations (hidden tab, backgrounded pane) can not strand content.
    var passes = [[900, false], [2500, false], [6000, true]];
    var plan = function () {
      passes.forEach(function (p) { win.setTimeout(function () { safe('failsafe', function () { updateScenes(true); sweep(p[1]); }); }, p[0]); });
    };
    plan();
    if (doc.readyState !== 'complete') win.addEventListener('load', function () { plan(); VB.refresh(); });
    if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) doc.fonts.ready.then(function () { VB.refresh(); }, function () { /* ignore */ });
  }

  if (doc.readyState === 'complete') init();
  else {
    doc.addEventListener('DOMContentLoaded', init);
    win.addEventListener('load', init);
  }
})();
