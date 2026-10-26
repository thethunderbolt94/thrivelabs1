/* Home hero v4 (#hero), "Centre stage". The load sequence itself is CSS (01-hero.css) and starts at first paint,
   so it never waits for this file. This file does three small things and never throws:
     1. Failsafe: .is-done about 2 s after it runs (animations off, finished state on), and any animation still
        running inside the hero is finished, so a paused or frozen clock can not strand the copy.
     2. Scroll-out: --p = how far the hero has scrolled out (0..1). "Vahan" slides left, "Bedros" right, the figure
        lifts slower than the page, the light dims, the copy fades up (all in CSS, transforms and opacity only).
        Once the hero is wholly off screen --p goes back to 0, so nothing is left half-faded out of sight.
     3. Depth: on a fine pointer, --mx / --my (-1..1) follow the cursor, lerped; the spot and the layers drift a few px.
   Reduced motion: only the failsafe runs. */
(function () {
  'use strict';
  var hero = document.getElementById('hero');
  if (!hero) return;
  var win = window;
  var VB = win.VB || {};

  var reduced = !!VB.reduced;
  if (!win.VB) {
    try { reduced = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }
  }

  // ---- 1. failsafe
  function finish() {
    try {
      hero.classList.add('is-done');
      if (typeof hero.getAnimations === 'function') {
        hero.getAnimations({ subtree: true }).forEach(function (a) { try { a.finish(); } catch (e) { /* infinite: can not finish */ } });
      }
    } catch (e) { /* ignore */ }
  }
  try { win.setTimeout(finish, (reduced ? 0 : 2000) * (VB.slow ? 1.8 : 1)); } catch (e) { finish(); }

  if (reduced) return;

  var raf = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : function (f) { return win.setTimeout(f, 16); };
  var setVar = function (name, v) { try { hero.style.setProperty(name, v); } catch (e) { /* ignore */ } };

  // ---- 2. scroll-out
  var lastP = '0.000', scrollQueued = false, inView = true;
  function onScrollFrame() {
    scrollQueued = false;
    try {
      var r = hero.getBoundingClientRect();
      var vh = win.innerHeight || document.documentElement.clientHeight || 1;
      var p = 0;
      inView = r.bottom > 0 && r.top < vh;
      if (inView && r.height > 0) p = Math.min(1, Math.max(0, -r.top / r.height));
      var s = p.toFixed(3);
      if (s !== lastP) { lastP = s; setVar('--p', s); }
    } catch (e) { /* ignore */ }
  }
  function queueScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    raf(onScrollFrame);
  }
  try {
    win.addEventListener('scroll', queueScroll, { passive: true });
    win.addEventListener('resize', queueScroll);
    queueScroll();
  } catch (e) { /* ignore */ }

  // ---- 3. depth on a fine pointer
  var fine = false;
  try { fine = !!(win.matchMedia && win.matchMedia('(hover: hover) and (pointer: fine)').matches); } catch (e) { /* ignore */ }
  if (!fine) return;

  var tx = 0, ty = 0, mx = 0, my = 0, moving = false;
  function step() {
    try {
      mx += (tx - mx) * 0.07;
      my += (ty - my) * 0.07;
      if (Math.abs(tx - mx) < 0.002 && Math.abs(ty - my) < 0.002) { mx = tx; my = ty; moving = false; }
      setVar('--mx', mx.toFixed(3));
      setVar('--my', my.toFixed(3));
      if (moving) raf(step);
    } catch (e) { moving = false; }
  }
  function aim(x, y) {
    tx = x; ty = y;
    if (!moving) { moving = true; raf(step); }
  }
  try {
    win.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      if (!inView) return;                                          // hero out of sight: leave it be
      var w = win.innerWidth || 1, h = win.innerHeight || 1;
      aim(Math.max(-1, Math.min(1, (e.clientX / w - 0.5) * 2)), Math.max(-1, Math.min(1, (e.clientY / h - 0.5) * 2)));
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', function () { aim(0, 0); });
  } catch (e) { /* ignore */ }
})();
;
/* Room 2: Four Rooms. Two ways of lighting a word, chosen by the device:
     mouse + wide screen : a pool of light travels to the hovered / focused row and the others dim
     touch or phone      : the row nearest the middle of the screen lights as you scroll
   Pure enhancement: without this file every word simply stays lit. Needs no GSAP. */
(function () {
  'use strict';

  var list = document.querySelector('#rooms .rooms__list');
  var stack = document.querySelector('#rooms .rooms__stack');
  var spot = document.querySelector('#rooms .rooms__spot');
  if (!list || !stack) return;

  var rows = Array.prototype.slice.call(list.querySelectorAll('.rooms__row'));
  if (!rows.length) return;

  var mq = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 760px)') : null;
  var hoverMode = !!(mq && mq.matches);
  var current = null;
  var raf = 0;
  var spotPlaced = false;

  function setActive(row) {
    if (row === current) return;
    current = row;
    rows.forEach(function (r) { r.classList.toggle('is-active', r === row); });
    if (hoverMode) {
      if (row) list.setAttribute('data-dim', ''); else list.removeAttribute('data-dim');
      placeSpot(row);
    }
  }

  /* ---- hover mode ---- */
  function placeSpot(row) {
    if (!spot) return;
    if (!row) { spot.classList.remove('is-on'); return; }
    var top = row.parentNode.offsetTop, h = row.parentNode.offsetHeight;
    // the first time, appear where the row is instead of sliding in from the top
    spot.classList.toggle('is-jump', !spotPlaced);
    spot.style.height = h + 'px';
    spot.style.transform = 'translateY(' + top + 'px)';
    spotPlaced = true;
    spot.classList.add('is-on');
  }

  function onMove(e) {
    if (!hoverMode || !spot) return;
    var r = stack.getBoundingClientRect();
    var x = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    if (raf) return;
    raf = window.requestAnimationFrame(function () {
      raf = 0;
      spot.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
    });
  }

  rows.forEach(function (row) {
    row.addEventListener('pointerenter', function (e) { if (hoverMode && e.pointerType !== 'touch') setActive(row); });
    row.addEventListener('focus', function () { if (hoverMode) setActive(row); });
    row.addEventListener('blur', function () { if (hoverMode && !list.matches(':hover')) setActive(null); });
  });
  list.addEventListener('pointerleave', function () { if (hoverMode && !list.contains(document.activeElement)) setActive(null); });
  list.addEventListener('pointermove', onMove, { passive: true });

  /* ---- scroll mode (touch, phones) ---- */
  function lightByScroll() {
    if (hoverMode) return;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var mid = vh * 0.5, best = null, bd = Infinity;
    rows.forEach(function (r) {
      var b = r.getBoundingClientRect();
      var d = Math.abs((b.top + b.bottom) / 2 - mid);
      if (d < bd) { bd = d; best = r; }
    });
    setActive(best && bd < vh * 0.32 ? best : null);
  }

  var ticking = false;
  function onScroll() {
    if (hoverMode || ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () { ticking = false; lightByScroll(); });
  }

  function setMode() {
    hoverMode = !!(mq && mq.matches);
    current = null;
    rows.forEach(function (r) { r.classList.remove('is-active'); });
    if (spot) spot.classList.remove('is-on');
    spotPlaced = false;
    if (hoverMode) {
      list.removeAttribute('data-dim');
    } else {
      list.setAttribute('data-dim', '');     // scroll mode: dim until a word reaches the middle
      lightByScroll();
    }
  }

  setMode();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { if (hoverMode) { if (current) { spotPlaced = true; placeSpot(current); } } else { lightByScroll(); } });
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', setMode);
    else if (mq.addListener) mq.addListener(setMode);
  }
})();
;
/* Room 3: The Mirror. Performance / Expression.
   The toggle sets data-mode on .play; CSS holds both finished states (rows and circle, rigid
   caps and expressive Fraunces). GSAP Flip carries the 34 desks and the speaker's mark from one
   layout to the other. Without Flip the browser animates the same move with CSS transitions
   (.is-native); with reduced motion it just switches. The room plays once by itself when it
   scrolls into view; after that the toggle is his. Everything is readable in either state. */
(function () {
  'use strict';

  var play = document.getElementById('mirror-play');
  if (!play) return;

  var field = play.querySelector('.field');
  var buttons = Array.prototype.slice.call(play.querySelectorAll('[data-mode-set]'));
  var status = document.getElementById('mirror-status');
  var desks = Array.prototype.slice.call(play.querySelectorAll('.desk'));
  var teach = play.querySelector('.teach');
  if (!field || !buttons.length) return;

  var reduced = !!(window.VB && window.VB.reduced);
  var mode = play.getAttribute('data-mode') === 'expression' ? 'expression' : 'performance';
  var touched = false;     // he used the toggle himself: never auto-play after that
  var played = false;      // the one automatic play has happened (or been skipped)
  var autoTimer = 0;

  var LABEL = {
    performance: '34 desks in rigid rows, facing the front: performance mode',
    expression: '34 desks in a circle around the speaker: expression mode'
  };

  // Chairs are carried in the order they light around the circle, so the Flip stagger travels with it.
  var items = desks.slice().sort(function (a, b) {
    return (+a.style.getPropertyValue('--k') || 0) - (+b.style.getPropertyValue('--k') || 0);
  });
  if (teach) items.unshift(teach);

  var flipReady = false;
  if (!reduced && window.gsap && window.Flip) {
    try { window.gsap.registerPlugin(window.Flip); flipReady = true; } catch (e) { flipReady = false; }
  }
  if (!flipReady) play.classList.add('is-native');

  function reflect(announce) {
    buttons.forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-mode-set') === mode ? 'true' : 'false');
    });
    field.setAttribute('aria-label', LABEL[mode]);
    if (status && announce) status.textContent = mode === 'expression' ? 'Expression mode: the desks are in a circle.' : 'Performance mode: the desks are in rows.';
  }

  function setMode(next) {
    if (next === mode) return;
    var state = null;
    if (flipReady) {
      try {
        window.Flip.killFlipsOf(items);
        state = window.Flip.getState(items);
      } catch (e) { state = null; }
    }
    mode = next;
    play.setAttribute('data-mode', mode);
    reflect(true);
    if (state) {
      try {
        window.Flip.from(state, {
          duration: 2,
          ease: 'power3.inOut',
          stagger: { each: 0.018 },
          overwrite: true,
          onComplete: function () { items.forEach(function (el) { el.style.transform = ''; }); }
        });
      } catch (e) { /* the final layout is already in place */ }
    }
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      touched = true;
      played = true;
      window.clearTimeout(autoTimer);
      setMode(b.getAttribute('data-mode-set') === 'expression' ? 'expression' : 'performance');
    });
  });

  reflect();

  // Play once, by itself, when the field is mostly on screen.
  function visibleEnough() {
    var r = field.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var seen = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    return seen >= Math.min(r.height, vh) * 0.6;
  }
  function arm() {
    if (played || touched || mode !== 'performance') return;
    played = true;
    autoTimer = window.setTimeout(function () {
      if (touched) return;
      if (!visibleEnough()) { played = false; return; }   // scrolled away first: wait for the next time it is in view
      setMode('expression');
    }, 900);
  }

  if (reduced) { played = true; return; }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) arm(); });
    }, { threshold: 0.6 });
    io.observe(field);
  } else {
    var onScroll = function () { if (visibleEnough()) { arm(); window.removeEventListener('scroll', onScroll); } };
    window.addEventListener('scroll', onScroll, { passive: true });
  }
})();
;
/* Room 5 (#temple): the logo's rays draw on once, when the door scrolls into view.
   DrawSVG when GSAP has loaded; a plain CSS transition when it has not. Never throws, and
   the rays are always left fully drawn (also with reduced motion, and if anything stalls). */
(function () {
  'use strict';
  try {
    var svg = document.querySelector('#temple .tmp-rays');
    if (!svg || !svg.querySelectorAll) return;
    var paths = Array.prototype.slice.call(svg.querySelectorAll('path'));
    if (!paths.length) return;

    var reduced = false;
    try { reduced = window.VB ? !!window.VB.reduced : !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }
    if (reduced) return;

    var g = window.gsap;
    var useDraw = false;
    try {
      if (g && window.DrawSVGPlugin && g.registerPlugin) { g.registerPlugin(window.DrawSVGPlugin); useDraw = true; }
    } catch (e) { useDraw = false; }

    var started = false;
    var finished = false;
    var failsafe = 0;
    var io = null;

    function finish() {
      if (finished) return;
      finished = true;
      if (failsafe) { window.clearTimeout(failsafe); failsafe = 0; }
      try { if (g && g.killTweensOf) g.killTweensOf(paths); } catch (e) { /* ignore */ }
      svg.classList.remove('is-armed', 'is-drawing');
      paths.forEach(function (p) {
        p.style.strokeDasharray = '';
        p.style.strokeDashoffset = '';
      });
      if (io) { try { io.disconnect(); } catch (e) { /* ignore */ } io = null; }
      window.removeEventListener('scroll', check);
    }

    function play() {
      if (started) return;
      started = true;
      // whatever happens, the rays end up complete
      failsafe = window.setTimeout(finish, 9000);
      try {
        if (useDraw) {
          g.fromTo(paths, { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.25, ease: 'power2.out', stagger: 0.11, onComplete: finish });
        } else {
          // CSS path: armed -> next frame -> drawing
          svg.classList.add('is-armed');
          void svg.getBoundingClientRect();
          (window.requestAnimationFrame || window.setTimeout)(function () {
            svg.classList.add('is-drawing');
            window.setTimeout(finish, 2600);
          }, 16);
        }
      } catch (e) { finish(); }
    }

    function check() {
      if (started) return;
      var r = svg.getBoundingClientRect(), h = window.innerHeight || document.documentElement.clientHeight || 0;
      if (r.bottom <= 0) { finish(); return; }          // already scrolled past: nothing to watch
      if (r.top < h * 0.8 && r.bottom > 0) play();
    }

    // Arm: hide the rays only if they have not been seen yet and something will bring them back
    var r0 = svg.getBoundingClientRect(), h0 = window.innerHeight || document.documentElement.clientHeight || 0;
    if (r0.bottom <= 0) return;                       // above the viewport on load: leave drawn
    if (useDraw) { g.set(paths, { drawSVG: '0%' }); }
    else { svg.classList.add('is-armed'); }

    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) play(); });
      }, { threshold: 0.35 });
      io.observe(svg);
    }
    window.addEventListener('scroll', check, { passive: true });
    window.setTimeout(check, 400);

    // Nothing ever brought the rays in (no observer, no scroll): show them complete rather than leave them hidden
    window.setTimeout(function () { if (!started && r0.top < h0) play(); }, 1500);
  } catch (e) {
    try { console.error('[temple]', e); } catch (_) { /* ignore */ }
  }
})();
;
/* Room 6 (#speaking): the talk list.
   One talk is active at a time. On desktop (1200px and up) hovering or focusing a row makes it active: the soft
   spot moves to it (--active on the list) and its photograph crossfades in (CSS keys off .is-active). Below that
   the rows are a tap accordion, and a second tap closes the open row.
   No GSAP needed, so this room is complete without the CDN. Never throws. Until this script has run the markup
   is the finished accordion with every panel open (CSS only collapses under #speaking.is-enhanced). */
(function () {
  'use strict';
  try {
    var root = document.getElementById('speaking');
    if (!root) return;
    var list = root.querySelector('.stg-talks');
    var rows = Array.prototype.slice.call(root.querySelectorAll('.talk'));
    if (!list || !rows.length) return;

    var mqWide = null, mqHover = null;
    try {
      mqWide = window.matchMedia('(min-width: 1200px)');
      mqHover = window.matchMedia('(hover: hover) and (pointer: fine)');
    } catch (e) { /* no matchMedia: behave as the accordion */ }

    function isWide() { return !!(mqWide && mqWide.matches); }
    function canHover() { return !!(mqHover && mqHover.matches); }

    function btnOf(li) { return li.querySelector('.talk__btn'); }

    function setActive(index) {
      rows.forEach(function (li, k) {
        var on = k === index;
        li.classList.toggle('is-active', on);
        var b = btnOf(li);
        if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false');
      });
      if (index >= 0) list.style.setProperty('--active', String(index));
    }

    function activeIndex() {
      for (var k = 0; k < rows.length; k++) if (rows[k].classList.contains('is-active')) return k;
      return -1;
    }

    // Take over: from here the CSS may collapse the inactive accordion panels
    root.classList.add('is-enhanced');
    if (activeIndex() < 0 && isWide()) setActive(0);

    rows.forEach(function (li, k) {
      var b = btnOf(li);
      if (!b) return;

      b.addEventListener('click', function () {
        if (!isWide() && li.classList.contains('is-active')) { setActive(-1); return; }   // accordion: tap again to close
        setActive(k);
      });

      b.addEventListener('focus', function () { if (isWide() && !li.classList.contains('is-active')) setActive(k); });

      li.addEventListener('pointerenter', function (e) {
        if (!isWide() || !canHover()) return;
        if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        if (!li.classList.contains('is-active')) setActive(k);
      });

      b.addEventListener('keydown', function (e) {
        var to = -1;
        if (e.key === 'ArrowDown') to = (k + 1) % rows.length;
        else if (e.key === 'ArrowUp') to = (k - 1 + rows.length) % rows.length;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = rows.length - 1;
        if (to < 0) return;
        e.preventDefault();
        var nb = btnOf(rows[to]);
        if (nb) nb.focus();
      });
    });

    // Crossing the breakpoint: the letterbox always shows one talk
    var onResize = function () { if (isWide() && activeIndex() < 0) setActive(0); };
    if (mqWide) {
      if (mqWide.addEventListener) mqWide.addEventListener('change', onResize);
      else if (mqWide.addListener) mqWide.addListener(onResize);
    }
  } catch (e) {
    try { console.error('[stage]', e); } catch (_) { /* ignore */ }
  }
})();
;
/* The Circle (#circle): the chair that belongs to the card in view, or under the pointer,
   glows. Pure class toggling, no GSAP, and the room is complete without it. */
(function () {
  'use strict';

  try {
    var root = document.getElementById('circle');
    if (!root) return;
    var ring = root.querySelector('.circle-ring');
    var list = root.querySelector('.circle__list');
    var cards = Array.prototype.slice.call(root.querySelectorAll('.c-card'));
    var chairs = Array.prototype.slice.call(root.querySelectorAll('.circle-ring .chair'));
    if (!ring || !list || !cards.length) return;

    var current = -2;      // -1 = nobody is active
    var hovered = -1;      // card under a mouse pointer
    var queued = false;

    function set(i) {
      if (i === current) return;
      current = i;
      cards.forEach(function (c, k) { c.classList.toggle('is-active', k === i); });
      chairs.forEach(function (c, k) { c.classList.toggle('is-active', k === i); });
      if (i < 0) ring.removeAttribute('data-active');
      else ring.setAttribute('data-active', String(i));
    }

    // The card nearest the middle of the screen while the list is on it. Distance, not containment:
    // reveals nudge cards by a few pixels, which can leave a hairline gap at the middle line.
    function byScroll() {
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      var mid = vh * 0.46;
      var lr = list.getBoundingClientRect();
      if (lr.bottom < mid * 0.6 || lr.top > vh - mid * 0.4) return -1;
      var best = -1, bestD = Infinity;
      for (var i = 0; i < cards.length; i++) {
        var r = cards[i].getBoundingClientRect();
        var d = mid < r.top ? r.top - mid : (mid > r.bottom ? mid - r.bottom : 0);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    function update() {
      queued = false;
      set(hovered >= 0 ? hovered : byScroll());
    }
    function schedule() {
      if (queued) return;
      queued = true;
      if (window.requestAnimationFrame) window.requestAnimationFrame(update);
      else window.setTimeout(update, 16);
    }

    cards.forEach(function (card, i) {
      card.addEventListener('mouseenter', function () { hovered = i; schedule(); });
      card.addEventListener('mouseleave', function () { hovered = -1; schedule(); });
      card.addEventListener('focusin', function () { hovered = i; schedule(); });
      card.addEventListener('focusout', function () { hovered = -1; schedule(); });
    });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
  } catch (e) {
    try { console.error('[circle]', e); } catch (_) { /* ignore */ }
  }
})();
;
/* Sign-off (#signoff): fits the 30:00 ring to the booking button and draws it once when it
   comes into view (core.js puts .on on the [data-spot] box). GSAP DrawSVG draws it when
   it is loaded; otherwise the CSS in 09-signoff.css does. Either way the finished ring is a
   complete stadium outline, and nothing here can throw. */
(function () {
  'use strict';

  try {
    var box = document.querySelector('#signoff .so-ring-box');
    if (!box) return;
    var svg = box.querySelector('.so-ring');
    var arc = svg && svg.querySelector('.so-ring__arc');
    if (!svg || !arc) return;

    var gsap = window.gsap;
    var useGsap = !!(gsap && gsap.fromTo && window.DrawSVGPlugin);
    var tween = null, started = false, finished = false;

    function fit() {
      var w = box.offsetWidth, h = box.offsetHeight;
      if (!w || !h) return false;
      var r = (h - 1) / 2, o = 0.5;
      // top centre -> clockwise around the stadium -> back to the top centre
      var d = 'M' + (w / 2) + ' ' + o +
        ' H' + (w - o - r) + ' A' + r + ' ' + r + ' 0 0 1 ' + (w - o - r) + ' ' + (h - o) +
        ' H' + (o + r) + ' A' + r + ' ' + r + ' 0 0 1 ' + (o + r) + ' ' + o +
        ' H' + (w / 2);
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      arc.setAttribute('d', d);
      return true;
    }

    function finish() {
      finished = true;
      if (tween) { try { tween.progress(1); tween.kill(); } catch (e) { /* ignore */ } }
      arc.style.strokeDasharray = '';
      arc.style.strokeDashoffset = '';
    }

    function play() {
      if (started) return;
      started = true;
      if (!tween) return;
      tween.play();
      // failsafe: whatever happens to the animation clock, the ring is complete soon after
      window.setTimeout(function () { if (!finished) finish(); }, 9000);
    }

    fit();
    if (!arc.getAttribute('pathLength') && !useGsap) arc.setAttribute('pathLength', '100');

    if (useGsap) {
      try {
        gsap.registerPlugin(window.DrawSVGPlugin);
        box.setAttribute('data-draw', 'gsap');
        gsap.set(arc, { drawSVG: '0%' });
        tween = gsap.fromTo(arc, { drawSVG: '0%' }, {
          drawSVG: '100%',
          duration: 2.8,
          delay: 0.2,
          ease: 'power2.inOut',
          paused: true,
          onComplete: finish
        });
      } catch (e) {
        useGsap = false;
        tween = null;
        box.removeAttribute('data-draw');
        arc.style.strokeDasharray = '';
        arc.style.strokeDashoffset = '';
        arc.setAttribute('pathLength', '100');
      }
    }

    function check() {
      if (box.classList.contains('on') || box.classList.contains('done')) {
        if (tween) {
          if (box.classList.contains('done')) finish(); else play();
        }
        return true;
      }
      return false;
    }

    if (window.MutationObserver) {
      new MutationObserver(function () { if (check()) { /* keep watching for .done */ } })
        .observe(box, { attributes: true, attributeFilter: ['class'] });
    }
    check();

    // keep the outline glued to the button when its size changes
    var refit = function () {
      if (!fit()) return;
      if (tween && !finished) { try { gsap.set(arc, { drawSVG: started ? '100%' : '0%' }); } catch (e) { /* ignore */ } }
    };
    if (window.ResizeObserver) new ResizeObserver(refit).observe(box);
    else window.addEventListener('resize', refit);
  } catch (e) {
    try { console.error('[signoff]', e); } catch (_) { /* ignore */ }
  }
})();
