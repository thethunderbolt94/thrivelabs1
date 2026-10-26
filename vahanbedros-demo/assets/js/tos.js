/* Temple of Speak, room 1: The projector comes on.
   The intro (the screen lights, then the room, then the copy) and the projector's breathing light are plain CSS.
   One photo, held still. This file does four small things:
     1. marks the hero live, which starts the slow push-in and the breathing light;
     2. pauses all of it while the hero is off screen or the tab is hidden;
     3. trails the photo behind the page a little as it scrolls out, and lets a fine pointer move the room a few
        px (transform only, no pin);
     4. the failsafe: ~2 s in it marks the intro done (.done), which snaps the finished state with no animation
        and finishes any intro animation still running, so a stalled animation clock can not strand anything.
   Reduced motion: none of the motion. Does not use GSAP, so a blocked CDN changes nothing. Never throws. */
(function () {
  'use strict';

  try {
    var win = window, doc = document;
    var hero = doc.getElementById('hero');
    if (!hero) return;

    var VB = win.VB;
    var reduced = false;
    try {
      reduced = VB ? !!VB.reduced : !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { reduced = false; }

    var copy = hero.querySelector('.hero__copy');
    var line = hero.querySelector('.hero__line');
    var shift = hero.querySelector('.hero__shift');
    var slowK = function () { return VB && VB.slow ? 1.82 : 1; };

    // ---- 4. failsafe: the finished state, whatever the animation clock is doing
    function settleIntro() {
      [copy, line].forEach(function (el) { if (el) el.classList.add('done'); });
      hero.classList.add('done');
      var intro = Array.prototype.slice.call(hero.querySelectorAll('.hero__copy, .hero__copy *, .hero__meta, .slide__veil, .slide__bloom'));
      intro.forEach(function (el) {
        if (typeof el.getAnimations !== 'function') return;
        try { el.getAnimations().forEach(function (a) { try { a.finish(); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
      });
    }
    win.setTimeout(settleIntro, 2000 * slowK());

    // ---- 1. live
    hero.classList.add('is-live');
    if (reduced) return;

    // ---- 2. hold still while nobody is looking
    var onScreen = true;
    function sync() { hero.classList.toggle('is-paused', !onScreen || doc.hidden); }
    if ('IntersectionObserver' in win) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[entries.length - 1].isIntersecting;
        sync();
      }, { threshold: 0.05 }).observe(hero);
    }
    doc.addEventListener('visibilitychange', sync);
    sync();

    // ---- 3. parallax on the way out, and a little depth under a fine pointer
    if (shift) {
      var pending = false;
      var run = function () {
        pending = false;
        var y = win.pageYOffset || doc.documentElement.scrollTop || 0;
        if (y > hero.offsetHeight * 1.1) return;
        shift.style.setProperty('--py', (y * 0.16).toFixed(1) + 'px');
      };
      win.addEventListener('scroll', function () {
        if (pending) return;
        pending = true;
        if (win.requestAnimationFrame) win.requestAnimationFrame(run); else win.setTimeout(run, 16);
      }, { passive: true });
      run();
    }

    var fine = false;
    try { fine = win.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) { fine = false; }
    if (fine && win.requestAnimationFrame) {
      var tx = 0, ty = 0, mx = 0, my = 0, raf = 0;
      var step = function () {
        mx += (tx - mx) * 0.08;
        my += (ty - my) * 0.08;
        hero.style.setProperty('--mx', mx.toFixed(3));
        hero.style.setProperty('--my', my.toFixed(3));
        raf = (Math.abs(tx - mx) > 0.002 || Math.abs(ty - my) > 0.002) ? win.requestAnimationFrame(step) : 0;
      };
      hero.addEventListener('pointermove', function (e) {
        var r = hero.getBoundingClientRect();
        tx = Math.max(-1, Math.min(1, (e.clientX - r.left) / r.width * 2 - 1));
        ty = Math.max(-1, Math.min(1, (e.clientY - r.top) / r.height * 2 - 1));
        if (!raf) raf = win.requestAnimationFrame(step);
      }, { passive: true });
      hero.addEventListener('pointerleave', function () { tx = 0; ty = 0; if (!raf) raf = win.requestAnimationFrame(step); });
    }
  } catch (err) {
    try { console.error('[tos hero]', err); } catch (e) { /* ignore */ }
  }
})();
;
/* Room 4: The Circle of Ten.
   Drives the ring from VB.scene progress (desktop: sticky stage) or from the week rows crossing a line
   under the sticky ring (phones). One step per chair: the ring turns a tenth, the chair that reaches the
   lamp lights gold and stays lit, a gold arc (DrawSVG when GSAP is there, plain dashes when it is not)
   joins the lit chairs, the panel switches at week 8, and at ten the arc closes and the ring breathes once.
   Without this script (or under reduced motion) the markup is already the finished state. */
(function () {
  'use strict';

  var win = window, doc = document;
  var VB = win.VB;
  var root = doc.getElementById('circle-of-ten');
  if (!VB || !root || VB.reduced) return;

  try { run(); } catch (e) { try { console.error('[circle-of-ten]', e); } catch (_) { /* ignore */ } }

  function run() {
    var $ = function (s) { return root.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };

    var turn = $('[data-turn]'), arc = $('[data-arc]'), closeArc = $('[data-close]'), ring = $('[data-ring]'), ringcol = $('.cot__ringcol');
    var numEl = $('[data-n]'), panel = $('.cot__panel');
    var chairs = $$('.cot__chair'), cells = $$('.cot__cells i'), rows = $$('.cot__row');
    if (!turn || !arc || chairs.length !== 10) return;

    var TURN = 0.45;                  // share of each step the ring spends turning; the rest it dwells
    var CLOSE_AT = 0.8;               // desktop: scroll progress at which chair ten has arrived
    var phone = win.matchMedia ? win.matchMedia('(max-width: 759.98px)') : null;
    var cur = { rot: NaN, lit: -1, arc: NaN, phase: '', ten: null, n: 0 };
    var swapTimer = 0, tenTimer = 0;

    // Gold arc: DrawSVG if GSAP and the plugin loaded, otherwise stroke-dasharray on the measured length.
    var drawsvg = false, arcLen = 0;
    try {
      if (win.gsap && win.DrawSVGPlugin) { win.gsap.registerPlugin(win.DrawSVGPlugin); drawsvg = true; }
    } catch (e) { drawsvg = false; }
    if (!drawsvg) {
      try { arcLen = arc.getTotalLength(); } catch (e) { arcLen = 0; }
      if (arcLen) arc.style.strokeDasharray = arcLen.toFixed(1);
    }
    function setArc(frac) {
      if (Math.abs(frac - cur.arc) < 0.0005) return;
      cur.arc = frac;
      arc.style.opacity = frac > 0.004 ? '1' : '0';
      if (drawsvg) win.gsap.set(arc, { drawSVG: '0% ' + (frac * 100).toFixed(2) + '%' });
      else if (arcLen) arc.style.strokeDashoffset = (arcLen * (1 - frac)).toFixed(1);
    }

    var slowK = function () { return VB.slow ? 1.82 : 1; };

    // A CSS transition that is still running keeps running when its class is removed (its end value is
    // unchanged), and a stalled animation clock would freeze it half way: finish it by hand.
    function finish(el) {
      if (!el || typeof el.getAnimations !== 'function') return;
      try {
        el.getAnimations({ subtree: true }).forEach(function (a) {
          try { if (a.effect && a.effect.getTiming().iterations !== Infinity) a.finish(); } catch (e) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }
    }

    function swapPhase(phase) {
      cur.phase = phase;
      panel.setAttribute('data-phase', phase);
      root.classList.add('is-swapping');
      win.clearTimeout(swapTimer);
      swapTimer = win.setTimeout(function () { root.classList.remove('is-swapping'); finish(panel); }, 1500 * slowK());
    }

    function setTen(on) {
      if (cur.ten === on) return;
      cur.ten = on;
      win.clearTimeout(tenTimer);
      root.classList.toggle('is-ten', on);
      ring.classList.toggle('is-breathing', on);
      if (on) tenTimer = win.setTimeout(function () { root.classList.add('ten-done'); finish(closeArc); }, 1700 * slowK());
      else root.classList.remove('ten-done');
    }

    function apply(rot, lit) {
      if (Math.abs(rot - cur.rot) > 0.001 || cur.rot !== cur.rot) {
        cur.rot = rot;
        turn.setAttribute('transform', 'rotate(' + (-rot * 36).toFixed(2) + ' 320 320)');
        setArc(Math.min(rot / 10, 0.9));
      }
      if (lit !== cur.lit) {
        cur.lit = lit;
        chairs.forEach(function (c, i) {
          c.classList.toggle('is-lit', i < lit);
          c.classList.toggle('is-top', i === lit - 1);
        });
        cells.forEach(function (c, i) { c.classList.toggle('is-lit', i < lit); });
        rows.forEach(function (r, i) {
          r.classList.toggle('is-past', i < lit - 1);
          r.classList.toggle('is-cur', i === lit - 1);
        });
        if (numEl) {
          numEl.textContent = String(lit);
          numEl.classList.remove('is-new');
          void numEl.offsetWidth;            // restart the little settle animation
          numEl.classList.add('is-new');
        }
        var phase = lit >= 8 ? 'b' : 'a';
        if (phase !== cur.phase) swapPhase(phase);
        setTen(lit === 10);
      }
    }

    /** u: 0..10. Unit i (i >= 1) first turns the ring from chair i-1 to chair i, then dwells with chair i lit. */
    function render(u) {
      u = VB.clamp(u, 0, 10);
      var i = Math.min(9, Math.floor(u)), f = u - i, rot, lit;
      if (i === 0) { rot = 0; lit = 1; }
      else {
        var t = VB.clamp(f / TURN, 0, 1);
        rot = (i - 1) + VB.smooth(0, 1, t);
        lit = t > 0.999 ? i + 1 : i;         // (not t >= 1: 9.45 - 9 is 0.44999...)
      }
      apply(rot, lit);
      root.classList.toggle('is-moved', u > 0.03);
    }

    function phoneU() {
      var line = ringcol.getBoundingClientRect().bottom + 112, idx = -1, f = 0;   // a row counts once it is below the ring's fade
      for (var k = 0; k < rows.length; k++) {
        var r = rows[k].getBoundingClientRect();
        if (r.top > line) break;
        idx = k;
        f = VB.clamp((line - r.top) / Math.max(r.height, 1), 0, 1);
      }
      return idx < 0 ? 0 : idx + f;
    }

    function update(p) {
      if (phone && phone.matches && rows.length) render(phoneU());
      else render(VB.clamp(p / CLOSE_AT, 0, 1) * (9 + TURN));
    }

    root.classList.add('is-live');
    render(0);
    VB.scene(root, update);
  }
})();
;
/* Room 5: Come experience it. The Performance / Expression toggle (a sentence, not a form).
   Markup is the finished state (Expression mode, no toggle). Here the toggle appears; unless the visitor
   asked for reduced motion the sentence starts in Performance mode and turns to Expression once, when
   core.js reports the room in view (#workshops carries data-spot, so core.js adds .on, then .done).
   If the room is already past (.done at once, e.g. a jump to the bottom) it just sits in Expression mode. */
(function () {
  'use strict';

  var win = window, doc = document;
  var VB = win.VB;
  var root = doc.getElementById('workshops');
  if (!root) return;

  try { run(); } catch (e) { try { console.error('[workshops]', e); } catch (_) { /* ignore */ } }

  function run() {
    var stage = root.querySelector('.ws__stage');
    var btns = Array.prototype.slice.call(root.querySelectorAll('[data-mode-btn]'));
    if (!stage || btns.length !== 2) return;

    var reduced = !!(VB && VB.reduced);
    var touched = false, auto = 0, settle = 0;

    // finish what is still running when .is-swapping goes (a stalled animation clock would freeze it half way)
    function finish() {
      if (typeof stage.getAnimations !== 'function') return;
      try {
        stage.getAnimations({ subtree: true }).forEach(function (a) {
          try { if (a.effect && a.effect.getTiming().iterations !== Infinity) a.finish(); } catch (e) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }
    }

    function setMode(mode, animate) {
      stage.setAttribute('data-mode', mode);
      btns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-mode-btn') === mode ? 'true' : 'false'); });
      if (!animate || reduced) { stage.classList.remove('is-swapping'); return; }
      stage.classList.add('is-swapping');
      win.clearTimeout(settle);
      settle = win.setTimeout(function () { stage.classList.remove('is-swapping'); finish(); }, 2600 * (VB && VB.slow ? 1.82 : 1));
    }

    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        touched = true;
        win.clearTimeout(auto);
        setMode(b.getAttribute('data-mode-btn'), true);
      });
    });

    root.classList.add('is-live');            // reveals the toggle
    if (reduced) return;                       // reduced motion: stay in Expression mode, the toggle still works

    setMode('performance', false);

    function turnToExpression() {
      if (touched || stage.getAttribute('data-mode') !== 'performance') return;
      if (root.classList.contains('done')) { setMode('expression', false); return; }   // past already: no show
      auto = win.setTimeout(function () { if (!touched) setMode('expression', true); }, 900);
    }

    if (root.classList.contains('on')) { turnToExpression(); return; }
    if (typeof win.MutationObserver !== 'function') { setMode('expression', false); return; }
    var mo = new win.MutationObserver(function () {
      if (!root.classList.contains('on')) return;
      mo.disconnect();
      turnToExpression();
    });
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });

    // last resort: whatever core.js does, the sentence must not stay in Performance mode for ever
    win.setTimeout(function () { if (!touched && stage.getAttribute('data-mode') === 'performance' && root.getBoundingClientRect().top < (win.innerHeight || 800)) setMode('expression', true); }, 9000);
  }
})();
;
/* Room 6: Voices from the room.
   Each voice lights its chair in the ring as it comes into view and the chair stays lit. Desktop: the voices
   stack and the active one is the last whose top has passed 62% of the screen. Phones: the voices are a
   scroll-snap row and the active one is the card nearest the middle of the row.
   Markup without this script is the finished state (every voice chair lit). */
(function () {
  'use strict';

  var win = window, doc = document;
  var root = doc.getElementById('voices');
  if (!root) return;

  try { run(); } catch (e) { try { console.error('[voices]', e); } catch (_) { /* ignore */ } }

  function run() {
    var list = root.querySelector('[data-vlist]');
    var cards = Array.prototype.slice.call(root.querySelectorAll('.vc__card'));
    var chairs = Array.prototype.slice.call(root.querySelectorAll('.vc__chair'));
    if (!list || !cards.length || !chairs.length) return;

    var phone = win.matchMedia ? win.matchMedia('(max-width: 759.98px)') : null;
    var shown = -2, queued = 0;

    function chairFor(v) {
      for (var i = 0; i < chairs.length; i++) if (chairs[i].getAttribute('data-voice') === String(v)) return chairs[i];
      return null;
    }
    var byVoice = cards.map(function (c) { return chairFor(c.getAttribute('data-voice')); });

    function show(n) {
      if (n === shown) return;
      shown = n;
      cards.forEach(function (c, i) {
        c.classList.toggle('is-active', i === n);
        var ch = byVoice[i];
        if (!ch) return;
        ch.classList.toggle('is-lit', i <= n);
        ch.classList.toggle('is-active', i === n);
      });
    }

    function activeDesktop() {
      var h = win.innerHeight || doc.documentElement.clientHeight || 800, n = -1;
      for (var i = 0; i < cards.length; i++) {
        var r = cards[i].getBoundingClientRect();
        if (r.top < h * 0.62) n = i;
      }
      return n;
    }

    function activeTrack() {
      var box = list.getBoundingClientRect(), mid = box.left + box.width / 2, best = 0, bestD = Infinity;
      // the first card sits at the left edge, so a track that has not moved is "card 0"
      if (list.scrollLeft < 8) return 0;
      for (var i = 0; i < cards.length; i++) {
        var r = cards[i].getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - mid);
        if (d < bestD) { bestD = d; best = i; }
      }
      // at the far end the last card can never reach the middle
      if (list.scrollLeft + list.clientWidth >= list.scrollWidth - 8) best = cards.length - 1;
      return best;
    }

    // On phones the row of voices scrolls sideways: let keyboard users reach it and say what it is
    function sync() {
      var on = !!(phone && phone.matches);
      if (on) { list.setAttribute('tabindex', '0'); list.setAttribute('role', 'region'); list.setAttribute('aria-label', 'Voices from the room'); }
      else { list.removeAttribute('tabindex'); list.removeAttribute('role'); list.removeAttribute('aria-label'); }
    }

    // reduced motion: the finished state stays (every voice chair lit); only the keyboard help below runs
    if (win.VB && win.VB.reduced) {
      sync();
      win.addEventListener('resize', sync);
      return;
    }

    function update() {
      queued = 0;
      sync();
      show(phone && phone.matches ? activeTrack() : activeDesktop());
    }
    function schedule() {
      if (queued) return;
      queued = win.requestAnimationFrame ? win.requestAnimationFrame(update) : win.setTimeout(update, 16);
      if (!win.requestAnimationFrame) return;
      win.setTimeout(function () { if (queued) { queued = 0; update(); } }, 140);   // rAF is paused in hidden tabs
    }

    win.addEventListener('scroll', schedule, { passive: true });
    win.addEventListener('resize', schedule);
    win.addEventListener('load', schedule);
    list.addEventListener('scroll', schedule, { passive: true });
    if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) doc.fonts.ready.then(schedule, function () { /* ignore */ });
    win.setTimeout(schedule, 900);
    win.setTimeout(schedule, 2500);

    update();
  }
})();
