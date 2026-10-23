/* Brotherhood hero: slow rising embers on a canvas behind the hero. The page's one signature moment.

   - at most 50 particles (46 on wide screens, 28 on phones), additive soft dots with a hot core
   - they start low, near where the portrait stands, rise slowly, sway, flicker and fade out
   - the loop only runs while the hero is on screen and the tab is visible
   - "Slow down" (VB.slow) takes the whole thing to about half speed
   - reduced motion: one still frame of embers, no loop
   Never throws: any failure just leaves the canvas empty (it is decoration). */
(function () {
  'use strict';

  try {
    var hero = document.getElementById('hero');
    var cv = hero && hero.querySelector('canvas.embers');
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d');
    if (!ctx) return;

    var win = window;
    var reduced = false;
    try {
      reduced = win.VB ? !!win.VB.reduced : !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { reduced = false; }

    var MAX = 50;
    var KINDS = ['200,105,58', '212,168,75', '246,217,166'];      // Ember, Stage Gold, Tungsten
    var sprites = [];
    var parts = [];
    var W = 0, H = 0, dpr = 1;
    var fireX = 0.74, fireY = 0.82;                                // where the embers gather, 0..1 of the hero
    var running = false, onScreen = true, raf = 0, last = 0, clock = 0;

    function sprite(rgb) {
      var s = 64, c = document.createElement('canvas');
      c.width = c.height = s;
      var g = c.getContext('2d');
      if (!g) return c;
      var grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, 'rgba(255,244,224,1)');
      grd.addColorStop(0.12, 'rgba(' + rgb + ',1)');
      grd.addColorStop(0.38, 'rgba(' + rgb + ',0.42)');
      grd.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
      return c;
    }

    function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }   // about -1..1, bell shaped

    function respawn(p, scatter) {
      var k = Math.random();
      p.kind = k < 0.58 ? 0 : (k < 0.88 ? 1 : 2);
      p.size = 1.4 + Math.pow(Math.random(), 2) * 3.2;                // mostly small, a few bigger
      p.life = 13 + Math.random() * 16;                            // seconds
      p.age = scatter ? Math.random() * p.life : 0;
      p.x = (fireX + gauss() * 0.24) * W;
      p.y = fireY * H + Math.random() * 70 - 14;
      p.rise = (16 + Math.random() * 26) * Math.max(0.65, Math.min(1.3, (win.innerHeight || 900) / 900));   // px per second
      p.sway = 6 + Math.random() * 16;
      p.swayF = 0.22 + Math.random() * 0.4;
      p.drift = (Math.random() - 0.45) * 7;
      p.phase = Math.random() * 6.283;
      p.flF = 1.3 + Math.random() * 2.2;
      p.flP = Math.random() * 6.283;
      p.gain = 0.65 + Math.random() * 0.35;
      p.x0 = p.x;
      p.y0 = p.y;
    }

    function place(p) {
      var t = p.age;
      p.cx = p.x0 + p.drift * t + Math.sin(t * p.swayF + p.phase) * p.sway;
      p.cy = p.y0 - p.rise * t;
    }

    function layout() {
      var r = hero.getBoundingClientRect();
      var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      dpr = Math.min(win.devicePixelRatio || 1, 2);
      var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (cv.width !== pw) cv.width = pw;
      if (cv.height !== ph) cv.height = ph;
      var changed = Math.abs(w - W) > 40 || !parts.length;      // a height-only change (fonts, reflow) keeps the embers where they are
      W = w; H = h;

      // gather the embers at the foot of the portrait
      var frame = hero.querySelector('.hero__frame');
      if (frame) {
        var f = frame.getBoundingClientRect();
        if (f.width) {
          fireX = Math.max(0.1, Math.min(0.9, (f.left + f.width / 2 - r.left) / W));
          fireY = Math.max(0.3, Math.min(1, (f.bottom - r.top) / H));
        }
      }

      var want = Math.min(MAX, W < 760 ? 28 : 46);
      while (parts.length < want) parts.push({});
      parts.length = want;
      parts.forEach(function (p) { if (changed || !p.life) respawn(p, true); });
      if (!running) draw();                                        // still frame (reduced motion) or first paint
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        place(p);
        var t = p.age / p.life;
        var env = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.9);    // fade in, fade out
        var top = p.cy < 230 ? Math.max(0, (p.cy - 70) / 160) : 1;                   // gone before the header
        var fl = 0.72 + 0.28 * Math.sin(clock * p.flF + p.flP);
        var a = (reduced ? 0.8 : 1) * p.gain * env * top * fl * 1.5;
        if (a < 0.015) continue;
        var d = p.size * 10;
        ctx.globalAlpha = a > 1 ? 1 : a;
        ctx.drawImage(sprites[p.kind], p.cx - d / 2, p.cy - d / 2, d, d);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    function frame(ts) {
      raf = 0;
      if (!running) return;
      try {
        var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016;
        last = ts;
        var k = win.VB && win.VB.slow ? 0.55 : 1;
        dt *= k;
        clock += dt;
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i];
          p.age += dt;
          if (p.age >= p.life) respawn(p, false);
        }
        draw();
        raf = win.requestAnimationFrame(frame);
      } catch (e) { running = false; }
    }

    function start() {
      if (running || reduced || !onScreen || document.hidden || !win.requestAnimationFrame) return;
      running = true;
      last = 0;
      raf = win.requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      if (raf && win.cancelAnimationFrame) win.cancelAnimationFrame(raf);
      raf = 0;
    }

    KINDS.forEach(function (rgb) { sprites.push(sprite(rgb)); });
    layout();
    if (reduced) {
      // one still frame; redraw if the box changes
      if ('ResizeObserver' in win) new ResizeObserver(function () { layout(); }).observe(hero);
      else win.addEventListener('resize', layout);
      return;
    }

    if ('ResizeObserver' in win) {
      var pend = false;
      new ResizeObserver(function () {
        if (pend) return;
        pend = true;
        win.requestAnimationFrame(function () { pend = false; try { layout(); } catch (e) { /* ignore */ } });
      }).observe(hero);
    } else {
      win.addEventListener('resize', function () { try { layout(); } catch (e) { /* ignore */ } });
    }

    if ('IntersectionObserver' in win) {
      new IntersectionObserver(function (entries) {
        onScreen = entries.some(function (en) { return en.isIntersecting; });
        if (onScreen) start(); else stop();
      }, { threshold: 0 }).observe(hero);
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
    start();
  } catch (e) {
    try { console.error('[brotherhood embers]', e); } catch (_) { /* ignore */ }
  }
})();
