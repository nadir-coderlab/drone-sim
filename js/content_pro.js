// التدريب الاحترافي: 5 مستويات (B مبتدئ → I متوسط → A متقدم → P محترف → E خبير FPV) + الطيران الحر
// التمارين مأخوذة من اختبارات طيارين حقيقية (NIST • CASA • BMFA • UK GVC) ومبسّطة للتدريب
// منطق بس: ما يلمس THREE ولا document ولا الصوت وقت التحميل (يشتغل في الاختبار الذاتي بدون شاشة)
(function () {
  'use strict';
  const DS = window.DS, U = DS && DS.U;
  if (!DS || !U || !DS.ScenarioTask || !DS.Task) return;
  const PI = Math.PI, D2R = PI / 180, R2D = 180 / PI;
  const clamp = U.clamp;
  const SCO = () => DS.Score;
  const MK = () => DS.mk2;

  // أسماء العصي حسب Mode 1/2 ({T} الارتفاع، {P} قدام/ورا، {Y} اللف، {R} الجنب) — نفس رموز الكورس
  const NM2 = { T: 'العصا اليسار', P: 'العصا اليمين', Y: 'العصا اليسار', R: 'العصا اليمين', M: 'العصا اليمين' };
  const tx = s => {
    if (typeof s !== 'string' || s.indexOf('{') < 0) return s || '';
    if (DS.courseText) return DS.courseText(s);
    return s.replace(/\{([TPYRM])\}/g, (_, c) => NM2[c]);
  };
  const txa = a => (a || []).map(tx);

  const HEAD_OFF = { tail: 0, nose: PI, left: -PI / 2, right: PI / 2 };
  const HEAD_AR = { tail: 'ظهره لك', nose: 'وجهه لك', left: 'وجهه على يسارك', right: 'وجهه على يمينك' };
  const altAdv = (y, alt, tol) => (y < alt - tol ? ' — ارفع لين ' + Math.round(alt) + ' م' : y > alt + tol ? ' — نزّل لين ' + Math.round(alt) + ' م' : '');
  const goHint = (d, x, z, what) => what + ' ' + U.relDir(d.yaw, U.bearing(d.p.x, d.p.z, x, z)) + ' (' + Math.round(U.dist2(d.p.x, d.p.z, x, z)) + ' م)';
  const hSpeed = d => Math.hypot(d.v.x, d.v.z);
  const tilt = d => { const q = d.q; return Math.acos(clamp(1 - 2 * (q.x * q.x + q.z * q.z), -1, 1)) * R2D; };   // ميلان الجسم عن المستوي (درجة)
  const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const tip = (st, t) => { st.tips = st.tips || []; if (!st.tips.includes(t)) st.tips.push(t); };

  // ======================================================================
  // Drill: مهمة خطوات (مثل ScenarioTask) + قياس دقيق + أخطاء (FaultManager) + درجة من أجزاء
  // كل خطوة ممكن يكون فيها measure(ctx, st, dt, task) — يشتغل والدرون طاير
  // st.m = تراكمات القياس، st.data.parts = أجزاء إضافية (0..1)
  // ======================================================================
  const mkMeas = () => ({ holdT: 0, holdE: 0, legT: 0, xtE: 0, altE: 0, headT: 0, headBad: 0, spd: null, lands: [], revN: 0 });
  class Drill extends DS.ScenarioTask {
    constructor(o) {
      const su = o.setup;
      super(Object.assign({ timeLimit: 600 }, o, {
        setup(ctx, st, task) {
          st.m = mkMeas(); st.m.spd = SCO() ? new (SCO().Stat)() : null; st.data.parts = {};
          if (su) su(ctx, st, task);
        }
      }));
    }
    // الأخطاء: التمرين يقيس نفس الخطأ في الأجزاء (track/alt/head/hold)، فالطلعة القصيرة ما تنحسب مرتين:
    // ثانية على الأقل، وطلعة ثانية خلال ثانية = نفس الطلعة، والكبير بعد 3 ث أو 2.5× الحد.
    // اختبار (faults:true = ctx.faults): نفس التهدئة بس الكبير على قواعد GVC (2 ث أو 2×)
    begin(ctx) { this.initFaults(ctx, ctx && ctx.faults ? { minT: 1.0, rearm: 1.0 } : { minT: 1.0, majorT: 3, k2: 2.5, rearm: 1.0 }); super.begin(ctx); }
    enter(ctx) {
      super.enter(ctx);
      const s = this.o.steps[this.st.k];
      if (s && s.say && ctx.say) ctx.say(tx(typeof s.say === 'function' ? s.say(ctx, this.st) : s.say));
    }
    update(dt, ctx) {
      const st = this.st;
      if (this.state === 'run' && !this.decision && st) {
        const s = this.o.steps[st.k], d = ctx.drone;
        if (s && s.measure && !d.onGround) s.measure(ctx, st, dt, this);
        if (this.o.measure) this.o.measure(ctx, st, dt, this);
      }
      super.update(dt, ctx);
    }
    onCallout(ctx) {
      const s = this.o.steps[this.st.k];
      if (s && s.onCallout) s.onCallout(ctx, this.st, this); else this.st.data.co = (this.st.data.co || 0) + 1;
    }
    onShutter(ctx) { const s = this.o.steps[this.st.k]; if (s && s.onShutter) s.onShutter(ctx, this.st, this); }
    // أجزاء الدرجة (0..1) من القياسات
    parts() {
      const st = this.st, m = st.m, P = Object.assign({}, st.data.parts);
      if (m.holdT > 0.5 && P.hold == null) P.hold = 1 - clamp(m.holdE / m.holdT, 0, 1);
      if (m.legT > 1) {
        if (P.track == null) P.track = 1 - clamp(Math.sqrt(m.xtE / m.legT), 0, 1);
        if (P.alt == null) P.alt = 1 - clamp(Math.sqrt(m.altE / m.legT), 0, 1);
      }
      if (m.headT > 1 && P.head == null) P.head = 1 - clamp(2 * m.headBad / m.headT, 0, 1);
      if (m.lands.length && P.land == null) P.land = mean(m.lands) / 100;
      if (st.dec.length && P.dec == null) P.dec = st.dec.filter(Boolean).length / st.dec.length;
      if (this.o.par && P.time == null) P.time = SCO() ? SCO().band(this.t - this.o.par, 0, this.o.par) : 1;
      return P;
    }
    score() {
      if (this.state !== 'done') return 0;
      if (this.o.score) return this.o.score(this.st, this);
      const W = this.o.w || { hold: 30, track: 20, alt: 15, head: 15, land: 20, dec: 20, time: 10, extra: 20 };
      const P = this.parts();
      const w = Object.assign({}, W);
      for (const k in P) if (w[k] == null && k !== 'time') w[k] = W.extra || 20;   // أجزاء خاصة بالتمرين
      if (!SCO()) return 100;
      return clamp(Math.round(SCO().combine(P, w, this.fm) - (this.st.pen || 0)), 0, 100);
    }
    feedback() {
      const t = ((this.st && this.st.tips) || []).slice();
      if (!this.st || this.state !== 'done') return t;
      const P = this.parts();
      if (P.hold != null && P.hold < 0.75) t.push('الثبات يبي شغل: صحّح بحركات صغيرة وبدري قبل ما يبعد الدرون');
      if (P.track != null && P.track < 0.75) t.push('خلك على الخط المستقيم بين العلامات (شوف الدرون والعلامة اللي بعدها)');
      if (P.alt != null && P.alt < 0.75) t.push('الارتفاع يتغير وأنت تمشي: لا تحرك {T} لفوق وتحت بدون قصد');
      if (P.head != null && P.head < 0.75) t.push('انتبه لاتجاه وجه الدرون (الأنوار الحمرا قدام)');
      if (P.land != null && P.land < 0.75) t.push('الهبوط: وقّف فوق النقطة بالضبط وبعدين انزل بشويش');
      if (this.st.m.revN) t.push('حركت العصا بالعكس ' + this.st.m.revN + ' مرة: لما وجهه لك، يمين ويسار وقدام وورا كلها معكوسة');
      return t.map(tx);
    }
  }
  DS.ProDrill = Drill;

  // ---------------- أدوات الخطوات ----------------
  const mark = (ctx, st, task, x, z, alt, r, label) => {
    st.vis = ctx.R.add(task, { type: 'beacon', x, z, alt, r, label: label || '' }); st.vis.set('next');
    st.map.push(st.mi = { kind: 'beacon', x, z, r, label: label || '', state: 'next' });
  };
  const unmark = st => {
    if (st.vis) { st.vis.remove(); st.vis = null; }
    if (st.mi) { const i = st.map.indexOf(st.mi); if (i >= 0) st.map.splice(i, 1); st.mi = null; }
  };
  // الاتجاه المطلوب: رقم (راديان) أو tail/nose/left/right (بالنسبة لك وأنت واقف) أو noseIn/tailIn أو دالة
  function yawOf(rule, ctx, st, px, pz) {
    if (rule == null || rule === 'any' || rule === 'forward') return null;
    if (typeof rule === 'number') return rule;
    if (typeof rule === 'function') return rule(ctx, st);
    const d = ctx.drone, P = DS.PILOT || { x: 0, z: 6 };
    if (HEAD_OFF[rule] != null) return U.wrap(U.bearing(P.x, P.z, px, pz) + HEAD_OFF[rule]);
    if (rule === 'noseIn') return U.bearing(d.p.x, d.p.z, P.x, P.z);
    if (rule === 'tailIn') return U.bearing(P.x, P.z, d.p.x, d.p.z);
    if (rule === 'leg') return st.data.legYaw != null ? st.data.legYaw : null;
    return null;
  }
  const headName = rule => (HEAD_AR[rule] || (rule === 'noseIn' ? 'وجهه لك' : rule === 'tailIn' ? 'ظهره لك' : rule === 'leg' ? 'وجهه على طريقه' : 'على الاتجاه المطلوب'));
  // كائن توجيه للطيار الآلي (واحد لكل خطوة — ما ننشئ كل فريم)
  const G = (st, k) => { const key = '_g' + k; return st[key] || (st[key] = { x: 0, z: 0, alt: 0, yaw: null, speed: 3 }); };
  // عصا قدام/جنب بالعالم (للكشف عن الحركة المعكوسة)
  const stickWorld = (d, c, out) => {
    const sy = Math.sin(d.yaw), cy = Math.cos(d.yaw), p = c.pitch || 0, r = c.roll || 0;
    out.x = p * sy + r * cy; out.z = -p * cy + r * sy; return out;
  };

  const B = {
    // إقلاع لين ارتفاع
    takeoff(alt, o) {
      o = o || {};
      return {
        base: true, say: o.say,
        enter(ctx, st) { const d = ctx.drone; st.data.hx = d.p.x; st.data.hz = d.p.z; },
        exit(ctx, st) { st.data.wp = { x: st.data.hx, z: st.data.hz, alt }; },
        cond: ctx => { const d = ctx.drone; return !d.onGround && d.p.y >= alt - 0.4; }, hold: 0.3,
        hint: () => tx(o.hint || ('أقلع لين ' + alt + ' م (A مطوّل، أو شغّل المحركات وارفع {T})')),
        guide(ctx, st) { const g = G(st, 't'); g.x = st.data.hx; g.z = st.data.hz; g.alt = alt; g.speed = 2; g.yaw = null; return g; },
        measure: o.measure
      };
    },
    // روح لنقطة. o: {r, label, speed, nose:'forward'|'noseIn'|'tailIn'|yaw|..., xtTol, altTol, headTol, pass, rev, hint, say, from}
    go(x, z, alt, o) {
      o = o || {};
      const r = o.r || 2, speed = o.speed || 4, xtTol = o.xtTol || 2, altTol = o.altTol || 1, headTol = (o.headTol || 20) * D2R;
      const altReach = o.altReach || Math.max(1.5, 2 * altTol);
      const what = o.label ? 'روح للعلامة ' + o.label : o.noMark ? 'كمّل على الطريق للنقطة الجاية' : 'روح للنقطة الجاية';
      return {
        base: true, say: o.say, limit: o.limit, failMsg: o.failMsg,
        enter(ctx, st, task) {
          const d = ctx.drone, wp = st.data.wp;
          const f = o.from || wp;
          const L = st.leg || (st.leg = {});
          L.x0 = f ? f.x : d.p.x; L.z0 = f ? f.z : d.p.z; L.a0 = f && f.alt != null ? f.alt : d.p.y;
          L.x1 = x; L.z1 = z; L.a1 = alt; L.len = Math.max(0.1, U.dist2(L.x0, L.z0, x, z));
          L.ux = (x - L.x0) / L.len; L.uz = (z - L.z0) / L.len; L.yaw = U.bearing(L.x0, L.z0, x, z);
          L.dist0 = U.dist2(d.p.x, d.p.z, x, z); L.revT = 0; L.revD = 0; L.minV = 99; L.age = 0;
          st.data.legYaw = L.yaw;
          if (!o.noMark) mark(ctx, st, task, x, z, alt, r, o.label);
          else if (o.next) st.map.push(st.mi = { kind: 'beacon', x, z, r, label: '', state: 'next' });   // نقطة بدون علامة بالجو: تبان بالخريطة بس
        },
        exit(ctx, st) { unmark(st); st.data.wp = { x, z, alt }; if (o.minSpeed && st.leg.minV < o.minSpeed) st.data.slowCorners = (st.data.slowCorners || 0) + 1; },
        cond: (ctx, st) => {
          const d = ctx.drone; if (d.onGround) return false;
          if (Math.abs(d.p.y - alt) > altReach) return false;
          if (U.dist2(d.p.x, d.p.z, x, z) <= r) return true;
          // مسار متصل: عدّى النقطة (قص الزاوية بنعومة) وهو قريب منها (2×r) = وصل — ما نخليه يرجع لنقطة ما تنشاف.
          // "عدّى" = تعدى الخط اللي ينصّف الزاوية بين الضلع هذا واللي بعده
          const L = st && st.leg, N = o.next; if (!N || !L) return false;
          const dx = d.p.x - x, dz = d.p.z - z; if (dx * dx + dz * dz > 4 * r * r) return false;
          const nl = U.dist2(x, z, N.x, N.z) || 1; let bx = L.ux + (N.x - x) / nl, bz = L.uz + (N.z - z) / nl;
          if (bx * bx + bz * bz < 0.04) { bx = L.ux; bz = L.uz; }   // رجعة 180°: نستخدم اتجاه الضلع
          return dx * bx + dz * bz >= 0;
        },
        hold: o.hold || 0,
        hint: o.hint ? (c, st) => tx(typeof o.hint === 'function' ? o.hint(c, st) : o.hint) :
          ((c, st) => {
            const d = c.drone, L = st && st.leg;
            // الارتفاع: الهدف النهائي (تقدر تطلع أول وبعدين تمشي) — إلا الخط المايل: الارتفاع على الخط
            const aT = o.slant && L ? U.lerp(L.a0, L.a1, clamp(((d.p.x - L.x0) * L.ux + (d.p.z - L.z0) * L.uz) / L.len, 0, 1)) : alt;
            return goHint(d, x, z, what) + altAdv(d.p.y, aT, altTol);
          }),
        measure(ctx, st, dt, T) {
          const d = ctx.drone, L = st.leg, m = st.m;
          L.age += dt;
          // بعد الخط + الارتفاع: الخط المايل (slant) = ارتفاع متوقع على طول الخط، غيره = أي ارتفاع بين البداية والنهاية (±الحد)
          const ex = d.p.x - L.x0, ez = d.p.z - L.z0, s = clamp(ex * L.ux + ez * L.uz, 0, L.len);
          const lo = L.a0 < L.a1 ? L.a0 : L.a1, hi = L.a0 < L.a1 ? L.a1 : L.a0, y = d.p.y;
          const xt = Math.abs(ex * L.uz - ez * L.ux), aE = o.slant ? Math.abs(y - U.lerp(L.a0, L.a1, s / L.len)) : (y < lo ? lo - y : y > hi ? y - hi : 0);
          if (!o.noTrack) {
            m.legT += dt; m.xtE += dt * Math.pow(Math.min(xt / (2 * xtTol), 1.5), 2); m.altE += dt * Math.pow(Math.min(aE / (2 * altTol), 1.5), 2);
            if (L.len > 6 && s > 1.5 && L.len - s > 1.5) T.trackF('pos', xt, xtTol);
            T.trackF('alt', aE, altTol);
          }
          // الاتجاه: forward = الوجه على اتجاه الحركة
          const sp = hSpeed(d); if (sp < L.minV && s > 1 && L.len - s > r) L.minV = sp;
          // الاتجاه ينحسب بعد ما يبدأ الخط وقبل آخره (وقت اللف بالزوايا ما ينحسب).
          // forward: بعد 1.5 ث من بداية الخط (أو بعد ما يمشي r+2 م) — يعطيه وقت يكمل لفة الزاوية
          const fwdOk = o.nose !== 'forward' || L.age >= 1.5 || s > r + 2;
          if (o.nose && o.nose !== 'any' && fwdOk && (L.len < 6 || (s > Math.max(2.5, r) && L.len - s > r))) {
            let want = null;
            if (o.nose === 'forward') { if (sp > 1.2) want = Math.atan2(d.v.x, -d.v.z); }
            else want = yawOf(o.nose, ctx, st, d.p.x, d.p.z);
            if (want != null) {
              const e = Math.abs(U.wrap(want - d.yaw));
              m.headT += dt; if (e > headTol) m.headBad += dt;
              T.trackF('head', e * R2D, headTol * R2D);
            }
          }
          if (m.spd && o.speedStat && sp > 0.5) m.spd.add(sp);
          // الحركة المعكوسة (العصا تودّي الدرون بعيد عن الهدف)
          if (o.rev) {
            const w = stickWorld(d, ctx.controls, st._sw || (st._sw = { x: 0, z: 0 })), mg = Math.hypot(w.x, w.z), dd = U.dist2(d.p.x, d.p.z, x, z);
            if (mg > 0.3 && dd > 1.5) {
              const cs = (w.x * (x - d.p.x) + w.z * (z - d.p.z)) / (mg * dd);
              if (cs < -0.5) { if (L.revT === 0) L.revD = dd; L.revT += dt; if (L.revT > 0.5 && dd - L.revD > 0.5) { m.revN++; T.fault('major', 'reversal'); L.revT = -9; } }
              else if (L.revT > 0) L.revT = 0;
            } else if (L.revT > 0) L.revT = 0;
            if (L.revT < 0) L.revT = Math.min(0, L.revT + dt);
          }
        },
        // الطيار الآلي: يلحق نقطة قدامه على الخط (جزرة) — يمشي بسرعة ثابتة ويقص الزوايا بنعومة
        guide(ctx, st) {
          const d = ctx.drone, L = st.leg, g = G(st, 'g');
          const ex = d.p.x - L.x0, ez = d.p.z - L.z0, s = clamp(ex * L.ux + ez * L.uz, 0, L.len);
          const k = d.profile.kind === 'fpv' ? 0.9 : 0.8, la = s + (o.look || speed / k), look = Math.min(L.len, la), N = o.next;
          g.x = L.x0 + L.ux * look; g.z = L.z0 + L.uz * look; g.alt = U.lerp(L.a0, L.a1, look / L.len); g.speed = speed;
          if (N && la > L.len) {   // الجزرة تكمل على الخط اللي بعده (لف ناعم بدون ما يهدّي)
            const nl = Math.max(0.1, U.dist2(x, z, N.x, N.z)), e2 = Math.min(nl, la - L.len);
            g.x = x + (N.x - x) / nl * e2; g.z = z + (N.z - z) / nl * e2; g.alt = U.lerp(alt, N.alt != null ? N.alt : alt, e2 / nl);
          }
          if (o.nose === 'forward') g.yaw = U.dist2(d.p.x, d.p.z, g.x, g.z) > 1 ? U.bearing(d.p.x, d.p.z, g.x, g.z) : L.yaw;
          else g.yaw = yawOf(o.nose, ctx, st, d.p.x, d.p.z);
          return g;
        }
      };
    },
    // ثبات داخل أسطوانة (الوقت يتجمع وأنت داخلها). o: {r, rv, hold, head, headTol, label, say, mark}
    hover(x, z, alt, o) {
      o = o || {};
      const r = o.r || 1, rv = o.rv || 0.5, hold = o.hold || 5, headTol = (o.headTol || 12) * D2R;
      return {
        base: true, say: o.say,
        enter(ctx, st, task) {
          st.hv = { held: 0, inside: false, entered: false, inT: 0, settled: false };
          if (o.mark !== false) { st.zv = ctx.R.add(task, { type: 'zone', x, z, y: alt, r, h: 2 * rv }); st.zv.set('idle'); }
          st.map.push(st.zm = { kind: 'zone', x, z, r, state: 'next' });
        },
        exit(ctx, st) {
          if (st.zv) { st.zv.remove(); st.zv = null; }
          const i = st.map.indexOf(st.zm); if (i >= 0) st.map.splice(i, 1);
          st.data.wp = { x, z, alt };
        },
        tick(ctx, st, dt, T) {
          const d = ctx.drone, h = st.hv, want = yawOf(o.head, ctx, st, x, z);
          const eh = U.dist2(d.p.x, d.p.z, x, z), ev = Math.abs(d.p.y - alt), ey = want == null ? 0 : Math.abs(U.wrap(want - d.yaw));
          const inside = !d.onGround && eh <= r && ev <= rv && ey <= headTol;
          if (inside) { h.entered = true; h.held += dt; }
          // الأخطاء تبدأ بعد ما يثبت داخل 0.5 ث متواصلة (التجاوز وقت الوصول/اللف طبيعي — دقته تنحسب في جزء الثبات)
          h.inT = inside ? h.inT + dt : 0;
          if (h.inT >= 0.5) h.settled = true;
          if (h.entered && !d.onGround) {
            const m = st.m; m.holdT += dt;
            m.holdE += dt * clamp(0.5 * eh / r + 0.3 * ev / rv + (want == null ? 0 : 0.2 * ey / headTol), 0, 1.5);
            if (h.settled) { T.trackF('pos', eh, r); T.trackF('alt', ev, rv); if (want != null) T.trackF('head', ey * R2D, headTol * R2D); }
          }
          h.inside = inside;
          if (st.zv) { st.zv.set(inside ? 'in' : h.entered ? 'out' : 'idle'); st.zv.setArrow(want); }
          if (o.onTick) { const r2 = o.onTick(ctx, st, dt, T); if (r2) return r2; }
          return h.held >= hold ? 'next' : null;
        },
        hint(ctx, st) {
          const d = ctx.drone, h = st.hv, want = yawOf(o.head, ctx, st, x, z);
          const eh = U.dist2(d.p.x, d.p.z, x, z);
          const pre = o.label ? o.label + ': ' : '';
          if (eh > r) return pre + goHint(d, x, z, 'روح للعمود الملوّن');
          if (Math.abs(d.p.y - alt) > rv) return pre + (d.p.y < alt ? 'ارفع شوي لين ' + alt + ' م' : 'نزّل شوي لين ' + alt + ' م');
          if (want != null && Math.abs(U.wrap(want - d.yaw)) > headTol) return pre + tx('لف الدرون لين يصير ' + headName(o.head) + ' ({Y} يمين/يسار)');
          return pre + 'ممتاز! اثبت كذا… باقي ' + Math.max(0, Math.ceil(hold - h.held)) + ' ث';
        },
        guide(ctx, st) {
          const g = G(st, 'h'); g.x = x; g.z = z; g.alt = alt; g.speed = o.speed || 3; g.yaw = yawOf(o.head, ctx, st, x, z);
          return g;
        }
      };
    },
    // هبوط على نقطة (LandCheck). o: {home, label, maxVs, weight, hint, anywhere}
    land(x, z, r, o) {
      o = o || {};
      return {
        limit: o.limit, failMsg: o.failMsg, say: o.say,
        enter(ctx, st, task) {
          st.lc = new DS.LandCheck(x, z, r, o.maxVs || 1.0);
          if (!o.home) st.ph = ctx.R.add(task, { type: 'pad', x, z, r, label: o.label || '' });
          st.map.push(st.lm = { kind: 'pad', x, z, r, label: o.label || 'H', state: 'next' });
        },
        exit(ctx, st) { if (st.ph) st.ph.remove(); st.ph = null; const i = st.map.indexOf(st.lm); if (i >= 0) st.map.splice(i, 1); st.data.wp = { x, z, alt: 0 }; },
        tick(ctx, st, dt, T) {
          if (o.onTick) { const r2 = o.onTick(ctx, st, dt, T); if (r2) return r2; }
          if (st.lc.update(ctx.drone) !== 'done') return null;
          const sc = st.lc.score(); st.m.lands.push(sc); st.data.lastLand = { score: sc, dist: st.lc.td.dist, vs: st.lc.td.vs, hs: st.lc.td.hs };
          if (st.lc.td.dist > r * 3 && !o.anywhere) { T.fault('major', 'landPos'); tip(st, 'هبطت بعيد عن المنصة — وقّف فوقها أول وبعدين انزل'); }
          else if (st.lc.td.dist > r) T.fault('minor', 'landPos');
          if (st.lc.td.vs > (o.maxVs || 1.0) * 1.5) T.fault('minor', 'vs');
          if (st.lc.td.hs > 1) T.fault('minor', 'side', 'لمس الأرض وهو ماشي على جنب');
          if (st.lc.td.hs > 0.5) tip(st, 'وقف الحركة الجانبية قبل لا تلمس');
          return 'next';
        },
        hint: (ctx, st) => tx(o.hint ? (typeof o.hint === 'function' ? o.hint(ctx, st) : o.hint) + (st.lc ? ' — ' + st.lc.hint(ctx.drone, o.label || 'H') : '') : (st.lc ? st.lc.hint(ctx.drone, o.label || 'H') : '')),
        guide: (ctx, st) => st.lc.guide(ctx.drone)
      };
    },
    // تغيير الوضع (▲▼ للأوضاع، ◀ للـ ATTI)
    mode(want, o) {
      o = o || {};
      const how = d => {
        if (want === 'A' || d.mode === 'A') return { b: 'LEFT', t: 'اضغط السهم اليسار ◀' };
        const ord = DS.modeOrder ? DS.modeOrder(d.airframe) : ['C', 'P', 'S'];
        return ord.indexOf(want) > ord.indexOf(d.mode) ? { b: 'UP', t: 'اضغط السهم فوق ▲' } : { b: 'DOWN', t: 'اضغط السهم تحت ▼' };
      };
      const lbl = m => (DS.MODES && DS.MODES[m] ? DS.MODES[m].label || m : m);
      return {
        say: o.say, cond: ctx => ctx.drone.mode === want, hold: 0.3,
        hint: ctx => tx(o.hint || (how(ctx.drone).t + ' لين يصير الوضع ' + lbl(want) + ' (الحين ' + lbl(ctx.drone.mode) + ')')),
        guide(ctx, st) { const h = how(ctx.drone), g = st['_m' + h.b] || (st['_m' + h.b] = { press: { [h.b]: true } }); return g; }
      };
    },
    // بلاغ: اضغط ▶ (السهم اليمين)
    callout(text, o) {
      o = o || {};
      return {
        say: o.say || text,
        enter(ctx, st) { st.data.co = 0; st.data.coT = 0; if (o.enter) o.enter(ctx, st); },
        tick(ctx, st, dt) { st.data.coT += dt; if (o.tick) { const r2 = o.tick(ctx, st, dt); if (r2) return r2; } return st.data.co > 0 ? 'next' : null; },
        onCallout(ctx, st) { if (!o.ready || o.ready(ctx, st)) st.data.co = 1; else if (o.notReady) ctx.msg(tx(o.notReady), 'info'); },
        hint: (ctx, st) => tx((typeof text === 'function' ? text(ctx, st) : text) + ' — اضغط ▶ (السهم اليمين)'),
        guide: (ctx, st) => (!o.ready || o.ready(ctx, st) ? (st._co || (st._co = { press: { RIGHT: true } })) : (st._cw || (st._cw = { none: true })))
      };
    },
    // سؤال "وش تسوي؟" (الصح أول خيار — ينخلط)
    decide(q, opts, ex, o) {
      const idx = U.pick(opts.map((_, i) => i), opts.length);
      return Object.assign({ decide: { q, a: idx.map(i => opts[i]), c: idx.indexOf(0), ex: ex || '', lang: 'ar' } }, o || {});
    },
    // لف بالمكان لين اتجاه (يثبت hold ث)
    yawTo(rule, o) {
      o = o || {};
      const tol = (o.tol || 15) * D2R;
      return {
        say: o.say, base: true,
        enter(ctx, st) { const d = ctx.drone; st.data.yx = d.p.x; st.data.yz = d.p.z; st.data.ya = Math.max(d.p.y, 1.5); },
        cond: (ctx, st) => { const w = yawOf(rule, ctx, st, ctx.drone.p.x, ctx.drone.p.z); return !ctx.drone.onGround && w != null && Math.abs(U.wrap(w - ctx.drone.yaw)) <= tol; },
        hold: o.hold || 1,
        hint: () => tx(o.hint || ('لف الدرون بمكانه لين يصير ' + headName(rule) + ' ({Y} يمين/يسار)')),
        guide(ctx, st) { const g = G(st, 'y'); g.x = st.data.yx; g.z = st.data.yz; g.alt = st.data.ya; g.speed = 2; g.yaw = yawOf(rule, ctx, st, ctx.drone.p.x, ctx.drone.p.z); return g; }
      };
    },
    // لفة كاملة بالمكان (deg موجب = يمين). يقيس الانجراف عن نقطة البداية
    spin(deg, o) {
      o = o || {};
      const dir = deg >= 0 ? 1 : -1, need = Math.abs(deg) * D2R * 0.95;
      return {
        say: o.say, base: true,
        enter(ctx, st) { const d = ctx.drone; st.data.sp = { acc: 0, last: d.yaw, x: d.p.x, z: d.p.z, y: d.p.y, maxD: 0, rate: SCO() ? new (SCO().Stat)() : null }; },
        tick(ctx, st, dt, T) {
          const d = ctx.drone, S = st.data.sp, dy = U.wrap(d.yaw - S.last); S.last = d.yaw; S.acc += dy;
          const dr = U.dist2(d.p.x, d.p.z, S.x, S.z); if (dr > S.maxD) S.maxD = dr;
          if (S.rate && dt > 0 && Math.abs(dy / dt) > 0.05) S.rate.add(Math.abs(dy / dt));
          if (o.drift) T.trackF('drift', dr, o.drift);
          if (dir * S.acc >= need) {
            if (o.drift) st.data.parts.spin = clamp(1 - S.maxD / (2 * o.drift), 0, 1) * (S.rate && S.rate.n > 10 ? clamp(1.25 - S.rate.cv, 0, 1) : 1);
            return 'next';
          }
          return null;
        },
        hint: (ctx, st) => tx((o.hint || ('لف لفة كاملة ' + (dir > 0 ? 'لليمين ({Y} يمين)' : 'لليسار ({Y} يسار)') + ' وخل الدرون بمكانه')) + ' — ' + Math.round(clamp(dir * st.data.sp.acc / need, 0, 1) * 100) + '%'),
        guide(ctx, st) { const S = st.data.sp, g = G(st, 's'); g.x = S.x; g.z = S.z; g.alt = Math.max(S.y, 1.5); g.speed = 2; g.yaw = U.wrap(ctx.drone.yaw + dir * (o.lead || 0.6)); return g; }
      };
    },
    // مسار نقاط [[x,z,alt],...] بدون وقوف (كل نقطة تعرف اللي بعدها)
    path(pts, o) {
      o = o || {};
      return pts.map((p, i) => {
        const n = pts[i + 1] || (o.loopTo ? o.loopTo : null);
        return B.go(p[0], p[1], p[2], Object.assign({}, o, { next: n ? { x: n[0], z: n[1], alt: n[2] } : null, label: o.labels ? o.labels(i) : '', noMark: o.marks === false || (o.markEvery && i % o.markEvery !== 0) }, i === 0 ? { say: o.say } : { say: null }));
      });
    },
    wait(sec, hint, guide) { return { cond: () => true, hold: sec, hint: () => tx(hint), guide: guide || (() => null) }; },
    cond(fn, hint, extra) { return Object.assign({ cond: fn, hint: typeof hint === 'function' ? (c, s) => tx(hint(c, s)) : () => tx(hint) }, extra || {}); }
  };
  DS.ProSteps = B;

  // تلف مهمة جاهزة بخطافات (قبل/بعد) — للريح المتقطعة والأعطال في اختبار E8
  function hook(factory, h) {
    return () => {
      const t = factory();
      const b0 = t.begin.bind(t), u0 = t.update.bind(t), g0 = t.guide.bind(t), e0 = t.end.bind(t);
      const c0 = t.onCallout ? t.onCallout.bind(t) : null;
      t.begin = ctx => { b0(ctx); t._hk = {}; if (h.begin) h.begin(ctx, t, t._hk); };
      t.update = (dt, ctx) => { if (h.update && t.state === 'run' && !t.decision) h.update(dt, ctx, t, t._hk); if (t.state === 'run') u0(dt, ctx); };
      t.guide = ctx => { const g = g0(ctx); return h.guide ? h.guide(ctx, t, t._hk, g) : g; };
      t.onCallout = ctx => { if (h.onCallout && h.onCallout(ctx, t, t._hk)) return; if (c0) c0(ctx); };
      t.end = ctx => { if (h.end) h.end(ctx, t, t._hk); e0(ctx); };
      if (h.title) { t.title = h.title; t.short = h.short || h.title; }
      return t;
    };
  }
  DS.proHook = hook;
  // يقول الهدف أول ما تبدأ المهمة
  const sayStart = (factory, text) => hook(factory, { begin(ctx) { if (text && ctx.say) ctx.say(tx(text)); } });
  // هبات ريح كل كم ثانية (Wind.gustEvent)
  const gusty = (amp, every) => ({
    begin(ctx, t, k) { k.gT = 3 + (ctx.rng ? ctx.rng() : 0.5) * every; },
    update(dt, ctx, t, k) {
      k.gT -= dt;
      if (k.gT <= 0) {
        const r = ctx.rng || Math.random, w = ctx.env.wind;
        k.gT = every * (0.6 + 0.8 * r());
        if (w.gustEvent) w.gustEvent(r() * 360, amp * (0.7 + 0.6 * r()), 1.5 + r() * 1.5);
      }
    }
  });

  // ======================================================================
  // التمارين
  // ======================================================================
  const WINDS = { calm: { s: 0, g: 0 }, light: { s: 3, g: 0.8 }, strong: { s: 8, g: 2.5 } };
  const HOME = { x: 0, z: 0 };
  const W = (s, g, dir) => (dir != null ? { s, g, dir } : { s, g });
  const EX = {};
  const VARIANTS = [];   // نسخ إضافية للاختبار الذاتي (E8)
  const RACE_SPAWN = { x: 200, z: -28, yaw: -PI / 2, pilot: { x: 200, z: -22 } };   // ورا البوابة 1 في حلبة السباق
  const add = e => { EX[e.id] = e; return e; };

  // ---------------- B: مبتدئ ----------------
  add({
    id: 'B1', level: 'B', icon: '🧾', title: 'التشغيل والفحص والثبات', sub: 'فحص قبل الطيران • ثبات مترين 10 ث • هبوط في الدائرة',
    airframe: 'mini', mode: 'P', wind: W(1.5, 0.5), fence: true, maxAlt: 30, aids: 'full', pass: 70,
    brief: {
      goal: 'تسوي الفحص قبل الإقلاع مثل الطيار الحقيقي، تثبت الدرون على مترين 10 ثواني فوق المنصة، وتهبط في نص الدائرة.',
      steps: ['افحص البطارية والأقمار ونقطة البيت وارتفاع الرجوع والريح — كل وحدة تأكدها بـ ▶', 'لا تقلع قبل ما يلقط الـ GPS (الأقمار 10 أو أكثر)', 'أقلع واثبت على 2 م فوق المنصة 10 ثواني وظهره لك', 'انزل بشويش وهبط داخل الدائرة الصغيرة'],
      realWorld: 'في الدرون الحقيقي (DJI Fly) هذا نفس الفحص: البطارية، GPS، نقطة البيت (Home Point)، ارتفاع RTH، والريح. الإقلاع قبل GPS أكثر غلطة تسبب طيحات.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [
      () => new Drill({
        title: 'الفحص قبل الإقلاع', short: 'الفحص',
        setup(ctx, st) { ctx.drone.setGnss(false); st.data.gT = 0; },
        always(ctx, st, dt, T) {
          const d = ctx.drone;
          if (!d.gps) { st.data.gT += dt; if (st.data.gT > 7) { d.setGnss(true); ctx.msg('🛰️ لقط الأقمار ✓ (GPS جاهز)', 'good'); } }
          if (!d.onGround && !d.gps && !st.data.noG) { st.data.noG = true; T.fault('safety', 'noGnss', 'أقلعت قبل ما يثبت الـ GPS — في الحقيقة ممكن يطير لحاله ويطيح'); }
        },
        steps: [
          B.callout(c => '١) البطارية ' + Math.round(c.drone.battery) + '% (لازم 95% أو أكثر)', { say: 'نبدأ الفحص. أول شي البطارية، لازم تكون خمسة وتسعين بالمية أو أكثر. إذا تمام اضغط السهم اليمين' }),
          B.callout(c => c.drone.gps ? '٢) الأقمار ' + (c.drone.sats || 0) + ' ✓ جاهز' : '٢) استنى… الدرون يدور على الأقمار (' + (c.drone.sats || 0) + ') — لا تقلع!',
            { ready: c => c.drone.gps, notReady: 'لسا ما لقط الأقمار — استنى لين تصير 10 أو أكثر', say: 'ثاني شي الأقمار. استنى لين يلقط الجي بي اس. لا تقلع قبل' }),
          B.callout('٣) نقطة البيت (Home Point) انحفظت ✓', { say: 'نقطة البيت انحفظت. هذي اللي يرجع لها الدرون' }),
          B.callout('٤) ارتفاع الرجوع RTH = 30 م (أعلى من الأشجار والأعمدة حولك)', { enter(c) { c.drone.rthSetting = 30; }, say: 'ارتفاع الرجوع ثلاثين متر، أعلى من الأشجار والأعمدة' }),
          B.callout(c => '٥) الريح ' + (c.env.wind.info ? c.env.wind.info(10).speed.toFixed(1) : '?') + ' م/ث — أقل من 8 ✓ تقدر تطير (للمبتدئ أقل من 8، وحد الدرون 10.7)', { say: 'آخر شي الريح. أقل من ثمانية متر بالثانية، تقدر تطير' })
        ],
        score: (st) => (st.data.noG ? 0 : 100)
      }),
      () => new DS.HoverTask({ title: 'ثبات على مترين فوق المنصة', short: 'الثبات 2 م', x: 0, z: 0, r: 0.6, rv: 0.35, headTol: 15, steps: [{ alt: 2, hold: 10, head: 'tail' }], timeLimit: 180 }),
      () => new DS.LandingTask({ title: 'الهبوط في الدائرة', short: 'الهبوط', x: 0, z: 0, r: 0.3, maxVs: 0.7, home: true, timeLimit: 150 })
    ]
  });

  add({
    id: 'B2', level: 'B', icon: '🧭', title: 'الاتجاهات الأربعة (N ثم ATTI)', sub: 'ظهره لك • يسار • يمين • وجهه لك — وبعدين بدون GPS',
    airframe: 'mini', mode: 'P', wind: W(2, 0.6), fence: true, maxAlt: 30, aids: 'full', pass: 70,
    brief: {
      goal: 'تحفظ العصي في كل اتجاه: لما ظهره لك، لما وجهه يمين أو يسار، ولما وجهه لك (الحركات تنعكس). وبعدين نفس الشي في ATTI.',
      steps: ['أقلع لـ 5 م فوق العمود الملوّن', 'اثبت وظهره لك، ثم وجهه يسار، ثم يمين، ثم وجهه لك (6 ث كل وحدة)', 'حوّل ATTI بالسهم اليسار ◀ — الدرون ما يثبت لحاله ويمشي مع الريح', 'اثبت مرتين في ATTI وصحح الانجراف بيدك', 'ارجع وهبط على H'],
      realWorld: 'الدرون الحقيقي يدخل ATTI لحاله إذا ضاع الـ GPS (قرب مباني، تحت جسر، تشويش). اللي يتدرب عليه هنا ما يرتبك وقتها.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [() => new Drill({
      title: 'الاتجاهات الأربعة', short: 'الاتجاهات',
      steps: [
        B.takeoff(5),
        B.hover(0, -6, 5, { head: 'tail', hold: 6, r: 0.9, rv: 0.5, label: 'ظهره لك', say: 'اثبت وظهره لك. هذا أسهل اتجاه' }),
        B.hover(0, -6, 5, { head: 'left', hold: 6, r: 0.9, rv: 0.5, label: 'وجهه يسار', say: 'لف الدرون لين يصير وجهه على يسارك واثبت' }),
        B.hover(0, -6, 5, { head: 'right', hold: 6, r: 0.9, rv: 0.5, label: 'وجهه يمين', say: 'الحين وجهه على يمينك' }),
        B.hover(0, -6, 5, { head: 'nose', hold: 6, r: 0.9, rv: 0.5, label: 'وجهه لك', say: 'وجهه لك. انتبه، يمين ويسار صاروا معكوسين' }),
        B.mode('A', { say: 'الحين حوّل ATTI بالسهم اليسار. الدرون بيمشي مع الريح وأنت تصححه' }),
        B.hover(0, -6, 5, { head: 'tail', hold: 6, r: 2, rv: 0.7, headTol: 15, label: 'ATTI ظهره لك', say: 'في ATTI صحّح الانجراف بحركات صغيرة' }),
        B.hover(0, -6, 5, { head: 'nose', hold: 6, r: 2, rv: 0.7, headTol: 15, label: 'ATTI وجهه لك' }),
        B.land(0, 0, 0.6, { home: true, say: 'ارجع وهبط على المنصة. تقدر ترجع N بالسهم اليسار لو تبي' })
      ],
      w: { hold: 60, land: 25, extra: 15 }
    })]
  });

  add({
    id: 'B3', level: 'B', icon: '📍', title: 'من نقطة لنقطة', sub: '3 علامات بعيدة • ثبات عند كل وحدة • الوجه على الطريق',
    airframe: 'mini', mode: 'P', wind: W(2, 0.6), fence: true, maxAlt: 30, aids: 'full', pass: 70,
    brief: {
      goal: 'تطير بخط مستقيم لثلاث علامات (يسار، نص، يمين) ووجه الدرون على طريقه، وتثبت عند كل علامة 5 ثواني، وترجع.',
      steps: ['أقلع لـ 4 م واثبت فوق المنصة', 'لف الدرون صوب العلامة 1 وروح لها بخط مستقيم', 'اثبت عندها 5 ث، وبعدين نفس الشي للعلامة 2 و 3', 'ارجع، خل ظهره لك واثبت 5 ث، وهبط'],
      realWorld: 'هذا من اختبار BMFA البريطاني للدرونات: تطير لنقاط وتثبت عندها — نفس اللي تسويه لما تصوّر أو تفتش مكان.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [() => new Drill({
      title: 'من نقطة لنقطة', short: 'النقاط', par: 120,
      steps: [
        B.takeoff(4),
        B.hover(0, -2, 4, { head: 'tail', hold: 4, r: 1.2, rv: 0.6, label: 'البداية' }),
        B.go(-20, -26, 5, { label: '1', nose: 'forward', xtTol: 2, speed: 4, say: 'لف الدرون صوب العلامة واحد وروح لها بخط مستقيم' }),
        B.hover(-20, -26, 5, { head: 'leg', hold: 5, r: 1.2, rv: 0.6, headTol: 20, label: 'العلامة 1' }),
        B.go(0, -34, 5, { label: '2', nose: 'forward', xtTol: 2, speed: 4 }),
        B.hover(0, -34, 5, { head: 'leg', hold: 5, r: 1.2, rv: 0.6, headTol: 20, label: 'العلامة 2' }),
        B.go(20, -26, 5, { label: '3', nose: 'forward', xtTol: 2, speed: 4 }),
        B.hover(20, -26, 5, { head: 'leg', hold: 5, r: 1.2, rv: 0.6, headTol: 20, label: 'العلامة 3' }),
        B.go(0, -4, 4, { label: 'H', nose: 'forward', xtTol: 2, speed: 4, say: 'ارجع للبيت' }),
        B.hover(0, -4, 4, { head: 'tail', hold: 5, r: 1.2, rv: 0.6, label: 'ظهره لك', say: 'خل ظهره لك واثبت' }),
        B.land(0, 0, 0.5, { home: true })
      ],
      w: { hold: 30, track: 25, alt: 15, head: 15, land: 15 }
    })]
  });

  // مستطيل 56×30 م: مع عقارب الساعة ثم عكسها، بدون وقوف بالزوايا (لف + جنب مع بعض)
  const RECT = [[0, -16], [-28, -16], [-28, -46], [28, -46], [28, -16], [0, -16]];
  add({
    id: 'B4', level: 'B', icon: '🔲', title: 'الدورة المستطيلة', sub: 'مستطيل 56×30 م على 10 م • الوجه لقدام • زوايا بدون وقوف',
    airframe: 'mini', mode: 'P', wind: W(3, 1), fence: true, maxAlt: 30, aids: 'full', pass: 70,
    brief: {
      goal: 'تطير مستطيل كبير على ارتفاع 10 م ووجه الدرون دايم لقدام، وفي الزوايا تلف بنعومة بدون ما توقف — مرة مع عقارب الساعة ومرة عكسها.',
      steps: ['أقلع واطلع مايل 45° (قدام وفوق مع بعض) لين 10 م', 'لف المستطيل مع عقارب الساعة: في كل زاوية اخلط اللف ({Y}) مع الحركة ({M})', 'لفه مرة ثانية بالعكس', 'انزل مايل وهبط على H'],
      realWorld: 'الطيار الحقيقي ما يوقف ويلف بالزوايا — يلف بنعومة وهو ماشي. هذا يخلي التصوير ناعم والبطارية تكفي أكثر.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => {
      const steps = [B.takeoff(2), B.go(0, -12, 10, { label: '↗', nose: 'forward', xtTol: 2.5, altTol: 2, speed: 3, slant: true, say: 'اطلع مايل: قدام وفوق مع بعض لين عشرة متر' })];
      // مبتدئ: 3.5 م/ث ودائرة الزاوية 5 م والوجه ±35° — يكفي يلف بنعومة وهو ماشي (مو لف 60°/ث بكل زاوية)
      const lap = (pts, tag) => pts.slice(1).forEach(([x, z], i) => steps.push(B.go(x, z, 10, { label: tag + (i + 1), nose: 'forward', r: 5, xtTol: 3, altTol: 1, headTol: 35, speed: 3.5, minSpeed: 1.5, speedStat: true })));
      steps.push(B.go(0, -16, 10, { label: '●', r: 3, nose: 'forward', speed: 4 }));
      lap(RECT, '');
      steps.push(B.yawTo(PI / 2, { say: 'الحين بالعكس: لف الدرون لين يصير وجهه للشرق', hint: 'لف الدرون 180° بمكانه ({Y}) — الحين نلف المستطيل بالعكس' }));
      lap(RECT.slice().reverse(), '');
      steps.push(B.go(0, -4, 3, { label: '↘', nose: 'any', xtTol: 3, altTol: 2, speed: 3, slant: true, say: 'انزل مايل للبيت' }));
      steps.push(B.land(0, 0, 0.6, { home: true }));
      return [() => new Drill({
        title: 'الدورة المستطيلة', short: 'المستطيل', steps, par: 150,
        score(st, T) {
          const P = T.parts(), m = st.m;
          P.speed = m.spd && m.spd.n > 20 ? SCO().band(m.spd.cv, 0.15, 0.5) : null;
          P.corners = 1 - clamp((st.data.slowCorners || 0) / 6, 0, 1);
          return SCO().combine(P, { track: 25, alt: 20, head: 20, speed: 10, corners: 10, land: 15 }, T.fm);
        }
      })];
    }
  });

  // B5: هبوطات مختلفة + إلغاء الهبوط لما يدخل شخص المنصة
  add({
    id: 'B5', level: 'B', icon: '🛬', title: 'مجموعة الهبوط', sub: '3 هبوطات دقيقة + إلغاء هبوط (شخص يدخل المنصة)',
    airframe: 'mini', mode: 'P', wind: W(3.5, 1.2), fence: true, maxAlt: 30, aids: 'full', pass: 70,
    brief: {
      goal: 'تهبط بدقة على منصات مختلفة: وأنت جاي صوبك، ومن الجنب، وفي هبوط ثالث يدخل شخص المنصة وأنت نازل — لازم تلغي الهبوط فوراً وتطلع.',
      steps: ['روح للعلامة 1 وارجع صوبك واهبط على المنصة 1', 'أقلع، وانزل مايل من الجنب على المنصة 2', 'في المنصة 3: أول ما يدخل الشخص — وقّف النزول واطلع ({T} لفوق) وروح لنقطة الانتظار', 'لما يطلع الشخص، اهبط على المنصة 3', 'آخر شي ارجع للبيت H'],
      realWorld: 'إلغاء الهبوط (Go-around) مهارة أمان مهمة: لو دخل شخص أو حيوان تحت الدرون ارفعه فوراً. ما فيه عيب تعيد الهبوط.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [() => new Drill({
      title: 'مجموعة الهبوط', short: 'الهبوطات', timeLimit: 600,
      setup(ctx, st, T) { st.data.ab = { on: false, t: 0, stopT: null, reach: false, done: false, px: 18, pz: -22 }; },
      always(ctx, st, dt, T) {
        const A = st.data.ab, d = ctx.drone;
        if (!A.h) return;
        // الشخص يمشي للمنصة، يوقف، وبعدين يطلع
        const tx0 = A.leave ? 18 : 10, tz0 = -22, dx = tx0 - A.px, dz = tz0 - A.pz, dd = Math.hypot(dx, dz);
        if (dd > 0.05) { const s = Math.min(dd, 1.4 * dt); A.px += dx / dd * s; A.pz += dz / dd * s; A.h.move(A.px, 0, A.pz, Math.atan2(dx, -dz)); if (A.mm) { A.mm.x = A.px; A.mm.z = A.pz; } }
      },
      steps: [
        B.takeoff(4),
        B.go(0, -40, 8, { label: '1', speed: 5, say: 'روح للعلامة واحد' }),
        B.land(0, -12, 0.4, { label: '1', say: 'الحين ارجع صوبك واهبط على المنصة واحد' }),
        B.takeoff(3),
        B.go(-16, -26, 6, { label: '2', speed: 4, say: 'أقلع وروح جنب المنصة الثانية' }),
        B.land(-6, -26, 0.4, { label: '2', say: 'انزل مايل من الجنب على المنصة اثنين' }),
        B.takeoff(3),
        B.go(10, -34, 6, { label: '3', speed: 4, say: 'روح ورا المنصة الثالثة' }),
        { // نزول على المنصة 3 — الشخص يدخل لما توصل 2 م
          base: true, say: 'انزل على المنصة ثلاثة بشويش… وانتبه',
          enter(ctx, st, T) { st.ph3 = ctx.R.add(T, { type: 'pad', x: 10, z: -22, r: 0.4, label: '3' }); st.map.push(st.pm3 = { kind: 'pad', x: 10, z: -22, r: 0.4, label: '3', state: 'next' }); },
          tick(ctx, st, dt, T) {
            const d = ctx.drone, A = st.data.ab;
            if (!d.onGround && d.p.y < 2.3 && U.dist2(d.p.x, d.p.z, 10, -22) < 2.5) {
              A.on = true; A.t = 0;
              A.h = ctx.R.add(T, { type: 'person', x: A.px, z: A.pz, pose: 'stand', color: 0x2563eb });
              st.map.push(A.mm = { kind: 'people', x: A.px, z: A.pz });
              ctx.msg('🚶 شخص دخل المنصة! ألغِ الهبوط واطلع', 'bad'); if (ctx.say) ctx.say('وقف! فيه شخص دخل المنصة. اطلع فوق وروح لنقطة الانتظار');
              return 'next';
            }
            return null;
          },
          hint: ctx => goHint(ctx.drone, 10, -22, 'انزل بشويش على المنصة 3'),
          guide(ctx, st) { const d = ctx.drone, g = G(st, 'a'), eh = U.dist2(d.p.x, d.p.z, 10, -22); g.x = 10; g.z = -22; g.alt = eh < 0.8 ? 1.2 : 4; g.speed = 2; g.yaw = null; g.vdown = 0.8; return g; }
        },
        { // الإلغاء: يوقف النزول خلال ثانية ويوصل نقطة الانتظار خلال 10 ث
          base: true, limit: 40, failMsg: 'ما ألغيت الهبوط وتركت الشخص تحت الدرون',
          enter(ctx, st, T) { mark(ctx, st, T, 18, -12, 5, 1.5, 'انتظار'); },
          exit(ctx, st) { unmark(st); },
          tick(ctx, st, dt, T) {
            const d = ctx.drone, A = st.data.ab; A.t += dt;
            if (A.stopT == null && d.v.y > -0.1) A.stopT = A.t;
            if (d.onGround && !A.hit) { A.hit = true; T.fault('safety', 'abort'); }
            if (!d.onGround && U.dist2(d.p.x, d.p.z, 18, -12) < 1.6 && Math.abs(d.p.y - 5) < 1.5) {
              A.reach = A.t; A.leave = true;
              st.data.parts.abort = (A.stopT != null && A.stopT <= 1.2 ? 0.5 : 0.5 * clamp(1 - (A.stopT - 1.2) / 2, 0, 1)) + (A.t <= 10 ? 0.5 : 0.5 * clamp(1 - (A.t - 10) / 10, 0, 1));
              if (A.t > 10) T.fault('minor', 'hesitate');
              return 'next';
            }
            return null;
          },
          hint: ctx => tx('اطلع ({T} لفوق) وروح لنقطة الانتظار — ') + goHint(ctx.drone, 18, -12, 'نقطة الانتظار'),
          guide(ctx, st) { const g = G(st, 'b'); g.x = 18; g.z = -12; g.alt = 5; g.speed = 3; g.yaw = null; return g; }
        },
        B.cond((c, st) => { const A = st.data.ab; return A.px >= 17.5; }, 'استنى لين يطلع الشخص من المنصة…', { guide: (c, st) => { const g = G(st, 'w'); g.x = 18; g.z = -12; g.alt = 5; g.speed = 2; g.yaw = null; return g; } }),
        Object.assign(B.land(10, -22, 0.4, { label: '3', say: 'الحين المنصة فاضية. اهبط عليها' }), {
          exit(ctx, st) { if (st.ph3) { st.ph3.remove(); st.ph3 = null; } const i = st.map.indexOf(st.pm3); if (i >= 0) st.map.splice(i, 1); st.data.wp = { x: 10, z: -22, alt: 0 }; }
        }),
        B.takeoff(3),
        B.go(0, -6, 4, { label: 'H', speed: 4 }),
        B.land(0, 0, 0.4, { home: true, say: 'آخر هبوط على البيت' })
      ],
      w: { land: 70, abort: 30 }
    })]
  });

  add({
    id: 'B6', level: 'B', icon: '🪣', title: 'اختبار NIST للسطول', sub: 'الاختبار الأمريكي الرسمي: 30 خطوة • 40 نقطة • 10 دقايق',
    airframe: 'mini', mode: 'P', wind: W(1.5, 0.5), fence: true, maxAlt: 30, aids: 'full', pass: 80,
    brief: {
      goal: 'هذا اختبار NIST الحقيقي: 3 ستاندات فيها سطول، وفي كل خطوة تصوّر السطل اللي تطالعه بحيث تشوف الحلقة اللي جواه كاملة. 40 نقطة، والنجاح 32 (80%).',
      steps: ['اختبار المكان: فوق الستاند 1، لف 360 يسار ويمين، اطلع وانزل، روح للستاند 2 وارجع — وصوّر بـ RB', 'اختبار اللف من اليسار: لف حول الستانات وصوّر الجوانب B و C و D', 'اختبار اللف من اليمين: نفس الشي من الجهة الثانية', 'اهبط في الدائرة بعد كل جزء', 'الكاميرا: LT/RT تحرك الكاميرا فوق وتحت، وLB مطوّل + LT/RT زوم'],
      realWorld: 'NIST يستخدم هالاختبار للشرطة والدفاع المدني في أمريكا، وتقدر تسويه بسطول حقيقية في أي ساحة. اللي يجيب 32 من 40 هنا يتحكم بالدرون والكاميرا مع بعض.',
      pass: '32 من 40 (80%)'
    },
    tasks: () => [sayStart(MK().capture(DS.NIST.bperp({ part: 'all' })), 'اختبار نيست. صوّر كل سطل بحيث الحلقة اللي جواه كاملة. زر آر بي للتصوير')]
  });

  add({
    id: 'B7', level: 'B', icon: '🏠', title: 'الرجوع للبيت والمبنى', sub: 'اضبط ارتفاع RTH • شغله من بعيد • استلم التحكم قبل البيت',
    airframe: 'mini', mode: 'P', wind: W(4, 1.2), fence: true, maxAlt: 60, aids: 'full', pass: 70,
    brief: {
      goal: 'فيه مبنى طوله 25 م بينك وبين النقطة البعيدة. تضبط ارتفاع الرجوع صح، تطير ورا المبنى، تشغّل الرجوع للبيت (B مطوّل)، وتلغيه قبل البيت بـ 15 م (ضغطة B) وتهبط بيدك.',
      steps: ['اختار ارتفاع الرجوع الصح (أعلى من المبنى بـ 10 م)', 'أقلع وروح من جنب المبنى للعلامة 1 ثم للعلامة 2 البعيدة', 'اضغط B مطوّل — الدرون يطلع لارتفاع الرجوع ويرجع بخط مستقيم', 'لما يقرب 15 م من البيت: ضغطة B وحدة = إلغاء، وبعدين هبّطه بيدك'],
      realWorld: 'RTH في DJI (بالليل، أو لو اخترت Preset) يمشي بخط مستقيم على الارتفاع اللي ضبطته. لو الارتفاع أقل من مبنى أو برج في الطريق ممكن يخبط — عشان كذا تضبطه قبل كل طيرة. في Mini 4 Pro بالنهار الوضع الافتراضي (Optimal) يخطط طريقه بنفسه، بس لا تعتمد عليه.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [() => new Drill({
      title: 'الرجوع للبيت والمبنى', short: 'RTH', timeLimit: 420,
      setup(ctx, st, T) {
        ctx.R.add(T, { type: 'building', x: 0, z: -60, w: 26, d: 8, h: 25 });
        ctx.env.taskColliders.push({ type: 'box', x: 0, z: -60, w: 26, d: 8, h: 25, name: 'المبنى' });
        st.map.push({ kind: 'tower', x: 0, z: -60, r: 13 });
        ctx.drone.rthSetting = 20;
      },
      steps: [
        Object.assign(B.decide('بينك وبين مكان الطيران مبنى طوله 25 م، وارتفاع الرجوع (RTH) الحين 20 م. كم تضبطه؟',
          ['35 م (أعلى من المبنى بـ 10)', '20 م (خله مثل ما هو)', '25 م (نفس طول المبنى)', '15 م (أوطى عشان يرجع أسرع)'],
          'ارتفاع الرجوع لازم يكون أعلى من أطول شي في الطريق بـ 10 م على الأقل. الرجوع يمشي بخط مستقيم.'),
        { exit(ctx, st) { ctx.drone.rthSetting = 35; ctx.msg('🏠 ارتفاع الرجوع صار 35 م', 'info'); } }),
        B.takeoff(5),
        B.go(26, -60, 14, { label: '1', speed: 5, say: 'روح من جنب المبنى للعلامة واحد. لا تقرب منه' }),
        B.go(0, -100, 14, { label: '2', speed: 5 }),
        B.cond(c => c.drone.auto === 'rth', 'الحين اضغط B مطوّل (ثانية) — الرجوع للبيت', { say: 'اضغط بي مطول عشان يرجع للبيت', guide: (c, st) => st._b || (st._b = { hold: { B: 1.2 } }) }),
        B.cond(c => c.drone.p.z > -50 && c.drone.auto === 'rth', 'شوف: يطلع لـ 35 م ويعدي فوق المبنى… خله', {
          guide: (c, st) => st._n || (st._n = { none: true }),
          tick(ctx, st) { const d = ctx.drone; if (d.auto !== 'rth' && !st.data.early) { st.data.early = true; tip(st, 'لغيت الرجوع بدري — خله يعدي المبنى أول'); } if (d.auto !== 'rth') return 'next'; return null; }
        }),
        {
          say: 'الحين لما يقرب خمسطعش متر من البيت، ألغه بضغطة بي وحدة',
          tick(ctx, st, dt, T) {
            const d = ctx.drone, dist = U.dist2(d.p.x, d.p.z, 0, 0);
            if (d.auto !== 'rth') {
              const e = Math.abs(dist - 15);
              st.data.parts.takeover = st.data.early ? 0.3 : clamp(1 - Math.max(0, e - 5) / 15, 0, 1);
              return 'next';
            }
            if (d.onGround) { st.data.parts.takeover = 0.2; tip(st, 'كان المفروض تلغي الرجوع وتهبط بيدك'); return 'next'; }
            return null;
          },
          hint: ctx => { const dd = Math.round(U.dist2(ctx.drone.p.x, ctx.drone.p.z, 0, 0)); return dd > 22 ? 'استنى… باقي ' + dd + ' م للبيت' : 'الحين! ضغطة B وحدة = إلغاء الرجوع (باقي ' + dd + ' م)'; },
          guide: (ctx, st) => (U.dist2(ctx.drone.p.x, ctx.drone.p.z, 0, 0) < 17 ? (st._p || (st._p = { press: { B: true } })) : (st._n || (st._n = { none: true })))
        },
        B.land(0, 0, 0.5, { home: true, say: 'التحكم معك. نزّله بيدك على المنصة' })
      ],
      w: { dec: 40, takeover: 30, land: 30 }
    })]
  });
  // ---------------- I: متوسط ----------------
  add({
    id: 'I1', level: 'I', icon: '🙃', title: 'الوجه لك (Nose-in)', sub: 'ثبات ووجهه لك • مربع ووجهه عليك • رجعة من 40 م',
    airframe: 'mini', mode: 'P', wind: W(3, 1), fence: true, maxAlt: 30, aids: 'rings', pass: 70,
    brief: {
      goal: 'تطير والدرون وجهه لك طول الوقت — هنا يمين ويسار وقدام وورا كلها معكوسة. ممنوع تحرك العصا بالعكس (كل مرة = خطأ كبير).',
      steps: ['روح للعلامة 1 ولف الدرون لين يصير وجهه لك، واثبت 12 ث', 'لف المربع الصغير ووجهه عليك دايم (تلف شوي مع كل زاوية)', 'طر بعيد 40 م، لفه وجهه لك، وارجع صوبك بشويش', 'اهبط على H'],
      realWorld: 'لما الدرون راجع لك وجهه يكون لك — أغلب المبتدئين يتلخبطون هنا ويحركون بالعكس. الحل: تخيل نفسك داخل الدرون، أو حرك العصا صوب الجهة اللي تبي الدرون يروحها "من شوفك".',
      pass: 'المعدل 70 أو أكثر بدون حركات معكوسة كثيرة'
    },
    tasks: () => [() => new Drill({
      title: 'الوجه لك', short: 'الوجه لك',
      steps: [
        B.takeoff(5),
        B.go(0, -12, 5, { label: '1', speed: 4 }),
        B.yawTo('noseIn', { say: 'لف الدرون بمكانه لين يصير وجهه لك' }),
        B.hover(0, -12, 5, { head: 'nose', hold: 12, r: 1.0, rv: 0.5, headTol: 12, label: 'وجهه لك', say: 'اثبت ووجهه لك. انتبه يمين ويسار معكوسين' }),
        ...B.path([[-5, -7, 5], [-5, -17, 5], [5, -17, 5], [5, -7, 5], [-5, -7, 5]], { nose: 'noseIn', rev: true, r: 1.3, speed: 2.5, xtTol: 1.5, headTol: 15, labels: i => String.fromCharCode(0x41 + i % 4), say: 'لف المربع ووجهه عليك دايم' }),
        B.go(0, -40, 8, { label: '2', speed: 5, say: 'طر بعيد للعلامة اثنين' }),
        B.yawTo('noseIn', { say: 'لفه لين يصير وجهه لك' }),
        B.go(0, -8, 5, { label: 'H', nose: 'noseIn', rev: true, speed: 3, xtTol: 2, headTol: 15, say: 'ارجع صوبك بشويش ووجهه لك' }),
        B.land(0, 0, 0.6, { home: true })
      ],
      w: { hold: 25, track: 20, alt: 10, head: 25, land: 20 }
    })]
  });

  // رقم 8 (Gerono): نقطة التقاطع قدامك بـ 22 م، والدرون رايح لقدام وقت التقاطع
  const eight = (cx, cz, A, Bz, alt, n, laps) => {
    const P = [];
    for (let l = 0; l < laps; l++) for (let i = 1; i <= n; i++) { const t = 2 * PI * i / n; P.push([cx + A * Math.sin(t), cz - Bz * Math.sin(t) * Math.cos(t), alt]); }
    return P;
  };
  add({
    id: 'I2', level: 'I', icon: '♾️', title: 'رقم 8', sub: 'رقم 8 مرتين حول عمودين • الوجه على الطريق • سرعة ثابتة',
    airframe: 'mini', mode: 'P', wind: W(3, 1), fence: true, maxAlt: 30, aids: 'rings', pass: 70,
    brief: {
      goal: 'تطير رقم 8 حول العمودين مرتين بدون ما توقف: الوجه على الطريق، نفس الارتفاع، ونفس السرعة. التقاطع يكون قدامك والدرون رايح بعيد.',
      steps: ['أقلع لـ 5 م وروح لنقطة التقاطع', 'لف الدايرة اليمين (مع عقارب الساعة) وبعدين اليسار (عكسها)', 'اخلط اللف ({Y}) مع الحركة لقدام ({P}) — لا توقف وتلف', 'سوّها مرتين وبعدين ارجع وهبط'],
      realWorld: 'رقم 8 موجود في اختبار CASA الأسترالي وBMFA البريطاني. هو اللي يعلّمك تنسّق العصاتين مع بعض — نفس اللي تحتاجه في أي تصوير ناعم.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => {
      const P = eight(0, -16, 12, 16, 5, 16, 2);
      return [() => new Drill({
        title: 'رقم 8', short: 'رقم 8', par: 75,
        setup(ctx, st, T) {
          [[-7, -16], [7, -16]].forEach(([x, z]) => { ctx.R.add(T, { type: 'pylon', x, z, h: 8 }); ctx.env.taskColliders.push({ type: 'cyl', x, z, r: 0.35, h: 8, name: 'العمود' }); st.map.push({ kind: 'pylon', x, z }); });
          st.data.cross = [];
        },
        measure(ctx, st) {   // التقاطع: لما يعدّي x=0 وهو رايح لقدام
          const d = ctx.drone, k = st.data.lx;
          if (k != null && (k < 0) !== (d.p.x < 0) && d.v.z < 0 && Math.abs(d.p.z + 16) < 6) st.data.cross.push(Math.abs(d.p.z + 16));
          st.data.lx = d.p.x;
        },
        steps: [
          B.takeoff(5),
          B.go(0, -10, 5, { label: '●', speed: 3 }),
          B.go(0, -16, 5, { label: '✕', speed: 3, nose: 'any' }),
          ...B.path(P, { nose: 'forward', r: 2.5, speed: 4, xtTol: 2, altTol: 0.75, headTol: 35, speedStat: true, markEvery: 4, say: 'يلا رقم ثمانية. لا توقف، اخلط اللف مع الحركة' }),
          B.go(0, -6, 4, { label: 'H', speed: 3 }),
          B.land(0, 0, 0.6, { home: true })
        ],
        score(st, T) {
          const P2 = T.parts(), m = st.m, cr = st.data.cross;
          P2.speed = m.spd && m.spd.n > 20 ? SCO().band(m.spd.cv, 0.15, 0.5) : null;
          P2.cross = cr.length ? SCO().band(mean(cr), 2, 5) : 0.5;
          return SCO().combine(P2, { alt: 25, track: 15, head: 15, speed: 20, cross: 10, land: 15 }, T.fm);
        }
      })];
    }
  });

  add({
    id: 'I3', level: 'I', icon: '🌬️', title: 'أساسيات ATTI', sub: 'بدون GPS: ثبات • نقطة بعيدة • رجعة بالظهر • لفة كاملة',
    airframe: 'mini', mode: 'P', wind: W(3, 1.5), fence: true, maxAlt: 30, aids: 'rings', pass: 70,
    brief: {
      goal: 'في ATTI الدرون ما يثبت مكانه ولا يفرمل — الريح تسحبه وأنت تصححه. تثبت، تروح لعلامة، ترجع بظهره، وتلف لفة كاملة بدون ما يبعد.',
      steps: ['أقلع لمترين وحوّل ATTI (◀)', 'اثبت داخل الأسطوانة 10 ث — صحح الانجراف قبل لا يبعد', 'روح للعلامة 1 (10 م) واثبت 5 ث، وارجع وظهره لك (بدون لف)', 'لف لفة كاملة بمكانك وخله ما يبعد أكثر من مترين', 'اهبط على H'],
      realWorld: 'هذا من اختبار CASA (رخصة الطيار في أستراليا): الطيران بدون مساعدة GPS. لو فهمت ATTI هنا ما تخاف إذا ضاع الـ GPS في الحقيقة.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [() => new Drill({
      title: 'أساسيات ATTI', short: 'ATTI',
      measure(ctx, st, dt) {   // سرعة ردة الفعل: من بداية الانجراف (والعصي بالنص) لين تحرك العصا عكسه
        const d = ctx.drone; if (d.effMode() !== 'A') return;
        const c = ctx.controls, sp = hSpeed(d), R = st.data.rx || (st.data.rx = { on: false, t: 0, list: [] });
        const stick = Math.hypot(c.pitch || 0, c.roll || 0);
        if (!R.on) { if (sp > 0.5 && stick < 0.1) { R.on = true; R.t = 0; } return; }
        R.t += dt;
        const w = stickWorld(d, c, st._sw2 || (st._sw2 = { x: 0, z: 0 }));
        if (stick > 0.1 && w.x * d.v.x + w.z * d.v.z < 0) { R.list.push(R.t); R.on = false; }
        else if (sp < 0.3 || R.t > 5) { if (R.t > 5) R.list.push(5); R.on = false; }
      },
      steps: [
        B.takeoff(2),
        B.mode('A', { say: 'حوّل ATTI بالسهم اليسار. من الحين الريح تسحب الدرون' }),
        B.hover(0, -4, 2, { head: 'tail', hold: 10, r: 1.5, rv: 0.5, headTol: 15, label: 'ATTI', say: 'اثبت داخل الأسطوانة. صحح بدري بحركات صغيرة' }),
        B.go(0, -14, 2, { label: '1', speed: 2, xtTol: 1.5, altTol: 0.6 }),
        B.hover(0, -14, 2, { head: 'tail', hold: 5, r: 1.0, rv: 0.5, headTol: 15, label: 'العلامة 1' }),
        B.go(0, -4, 2, { label: 'H', speed: 2, xtTol: 1.5, altTol: 0.6, nose: 'tailIn', headTol: 15, say: 'ارجع لورا وظهره لك. لا تلف الدرون' }),
        Object.assign(B.spin(360, { drift: 2, say: 'لف لفة كاملة بمكانك. خل عينك على الانجراف', lead: 0.5 }), { enter(ctx, st) { const d = ctx.drone; st.data.sp = { acc: 0, last: d.yaw, x: 0, z: -4, y: Math.max(d.p.y, 2.5), maxD: 0, rate: SCO() ? new (SCO().Stat)() : null }; } }),
        B.land(0, 0, 1.0, { home: true, say: 'اهبط على المنصة وأنت في ATTI' })
      ],
      score(st, T) {
        const P2 = T.parts(), R = st.data.rx;
        P2.react = R && R.list.length ? SCO().band(mean(R.list), 0.8, 3) : null;
        return SCO().combine(P2, { hold: 35, track: 15, alt: 10, head: 5, spin: 15, react: 10, land: 10 }, T.fm);
      }
    })]
  });

  add({
    id: 'I4', level: 'I', icon: '🧿', title: 'الدوران 8 نقاط', sub: 'ATTI • 8 لفات كل وحدة 45° • ثبت كل نقطة ثانيتين',
    airframe: 'mini', mode: 'A', modeLocked: true, wind: W(2.5, 0.8), fence: true, maxAlt: 30, aids: 'rings', pass: 70,
    brief: {
      goal: 'على بعد 30 م منك وفي ATTI: لف الدرون 8 مرات، كل مرة 45° بالضبط، واثبت ثانيتين عند كل اتجاه — والدرون ما يبعد عن مكانه.',
      steps: ['أقلع وروح للعلامة (30 م قدامك)', 'ابدأ وظهره لك، ولف 45° يمين واثبت', 'كمّل لين يرجع ظهره لك (8 نقاط)', 'مع كل لفة تتغير العصي: صحح الانجراف حسب وجه الدرون الحين', 'ارجع وهبط'],
      realWorld: 'هذا "Pirouette" من اختبار CASA. يدرّب عقلك يقلب العصي حسب اتجاه الدرون — الشي اللي يخلي الطيار الحقيقي يطير بثقة بأي اتجاه.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => {
      const steps = [B.takeoff(5), B.go(0, -24, 5, { label: '●', speed: 3, say: 'روح للعلامة ثلاثين متر قدامك' })];
      for (let k = 0; k <= 8; k++) steps.push(B.hover(0, -24, 5, { head: U.wrap(k * PI / 4), hold: 2.5, r: 1.5, rv: 0.5, headTol: 12, label: 'النقطة ' + Math.min(k, 8) + '/8', say: k === 0 ? 'اثبت وظهره لك. بعدين لف خمسة وأربعين درجة يمين كل مرة' : null }));
      steps.push(B.land(0, 0, 1.0, { home: true }));
      return [() => new Drill({ title: 'الدوران 8 نقاط', short: 'الدوران', steps, par: 110, w: { hold: 65, land: 15, time: 20 } })];
    }
  });

  add({
    id: 'I8', level: 'I', icon: '🎯', title: 'الدوران حول سيارة والكاميرا عليها', sub: 'يدوي بدون وضع ذكي • نص قطر 15 م • لفة يمين ولفة يسار',
    airframe: 'mini', mode: 'P', wind: W(2, 0.6), fence: true, maxAlt: 40, aids: 'rings', pass: 70,
    brief: {
      goal: 'تلف حول السيارة على بعد 15 م وارتفاع 10 م، والسيارة في نص الكاميرا طول الوقت. لفة مع عقارب الساعة ولفة عكسها، كل وحدة 40–60 ثانية.',
      steps: ['أقلع لـ 10 م وروح للدايرة (الأعلام كل 45°)', 'نزّل الكاميرا (LT) لين تصير السيارة بالنص', 'اخلط: {R} جنب + {Y} لف بنفس الوقت، وصحح المسافة بـ {P} شوي', 'كمّل لفة، وبعدين لف بالعكس'],
      realWorld: 'هذا "Orbit" اليدوي. في DJI فيه وضع ذكي يسويها (POI)، لكن الطيار المحترف يسويها بيده لأنها تمشي في أي مكان وفي أي ريح.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [sayStart(MK().orbitCam({ x: 0, z: -40, subject: { type: 'vehicle', kind: 'car', color: 0x2563eb, yaw: PI / 2 }, R: 15, alt: 10, laps: [{ dir: 1, deg: 360 }, { dir: -1, deg: 360 }], period: [40, 60] }),
      'لف حول السيارة والكاميرا عليها. جنب ولف مع بعض')]
  });

  // ---------------- A: متقدم ----------------
  add({
    id: 'A2', level: 'A', icon: '😵', title: 'ضاع اتجاه الدرون', sub: 'الدرون بعيد 140 م واتجاهه ما تعرفه • رجّعه بنظرك',
    airframe: 'mini', mode: 'P', wind: W(3, 1), fence: false, maxAlt: 60, aids: 'none', pass: 70,
    prep: rng => ({ spawn: { x: 25, z: -135, yaw: U.wrap(rng() * 2 * PI), pilot: { x: 0, z: 6 } } }),
    brief: {
      goal: 'زميلك حط الدرون بعيد (140 م) ووجهه لجهة ما تعرفها. أقلع لـ 30 م، اعرف اتجاهه بسرعة، ورجّعه لك — أول 10 ثواني بعينك بس (بدون كاميرا).',
      steps: ['أقلع واطلع لين 30 م (فوق الأشجار)', 'لا تلف عشوائي: حرك {P} لقدام ثانية وحدة وشوف وين يروح الدرون', 'أو شوف سهم الدرون في الخريطة الصغيرة', 'لفه لين ظهره لك، وطيّره صوبك', 'اهبط على H جنبك'],
      realWorld: 'الدرون الصغير على 150 م يصير نقطة وما تعرف وين وجهه. الطريقة الصح: وقّف، حرك قدام شوي وشوف وين يروح — أو استخدم سهم الخريطة. وإذا ما عرفت خلال 15 ث استخدم RTH.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [() => new Drill({
      title: 'ضاع الاتجاه', short: 'الاتجاه الضايع', timeLimit: 300,
      setup(ctx, st) {
        const d = ctx.drone; d.home = { x: 0, z: 0, y: 0 };
        if (DS.HOME) { DS.HOME.x = 0; DS.HOME.z = 0; }
        if (ctx.session) { ctx.session.pip = false; ctx.session.view = 'pilot'; }   // أول شي بعينك بس
        st.data.lo = { t: 0, d0: 0, tc: null, th: null, minY: 99, cam: false };
      },
      steps: [
        B.takeoff(30, { say: 'أقلع واطلع لين ثلاثين متر. الدرون بعيد وما تعرف وين وجهه', hint: 'أقلع (A مطوّل) وارفع {T} لين 30 م' }),
        {
          say: 'الحين رجّعه لك. حرك قدام شوي وشوف وين يروح',
          enter(ctx, st) { const d = ctx.drone, L = st.data.lo; L.t = 0; L.d0 = U.dist2(d.p.x, d.p.z, DS.PILOT.x, DS.PILOT.z); L.y0 = d.p.y; },
          tick(ctx, st, dt, T) {
            const d = ctx.drone, L = st.data.lo, s = ctx.session; L.t += dt;
            const dx = DS.PILOT.x - d.p.x, dz = DS.PILOT.z - d.p.z, dist = Math.hypot(dx, dz), sp = hSpeed(d);
            if (L.tc == null && sp > 1.5 && (d.v.x * dx + d.v.z * dz) / (sp * dist) > 0.7) L.tc = L.t;
            if (d.p.y < L.minY) L.minY = d.p.y;
            if (L.t < 10 && s && (s.view !== 'pilot' || s.pip) && !L.cam) { L.cam = true; tip(st, 'أول 10 ثواني حاول بعينك بس — الكاميرا تجي بعدين'); }
            if (dist <= L.d0 / 2) {
              L.th = L.t;
              const sc = 100 - 5 * Math.max(0, (L.tc != null ? L.tc : L.t) - 3) - (L.th > 30 ? 20 : 0) - (L.cam ? 10 : 0) - 2 * Math.max(0, L.y0 - L.minY - 10);
              st.data.parts.orient = clamp(sc / 100, 0, 1);
              return 'next';
            }
            if (L.t > 60 && !L.slow) { L.slow = true; T.fault('major', 'hesitate'); }
            return null;
          },
          hint: (ctx, st) => {
            const L = st.data.lo;
            if (L.tc == null) return tx(L.t < 6 ? 'اعرف وين وجهه: حرك {P} لقدام ثانية وحدة وشوف وين يروح الدرون' : 'شوف السهم في الخريطة الصغيرة: هذا وجه الدرون. لفه لين ظهره لك');
            return 'تمام! الحين جيبه صوبك (' + Math.round(U.dist2(ctx.drone.p.x, ctx.drone.p.z, DS.PILOT.x, DS.PILOT.z)) + ' م)';
          },
          guide(ctx, st) { const g = G(st, 'r'); g.x = 0; g.z = -10; g.alt = 30; g.speed = 8; g.yaw = U.bearing(DS.PILOT.x, DS.PILOT.z, ctx.drone.p.x, ctx.drone.p.z); return g; }
        },
        B.go(0, -10, 15, { label: 'H', speed: 7, noTrack: true, say: 'ممتاز. جيبه فوق البيت ونزّله' }),
        B.land(0, 0, 1.0, { home: true })
      ],
      w: { orient: 75, land: 25 }
    })]
  });

  add({
    id: 'A4', level: 'A', icon: '💨', title: 'ATTI مع هبات قوية', sub: 'ريح 5.5 م/ث + هبات • أسطوانة 1 م • NIST في ATTI',
    airframe: 'mini', mode: 'A', modeLocked: true, wind: W(5.5, 1.6), fence: true, maxAlt: 30, aids: 'none', faults: true, pass: 70,
    brief: {
      goal: 'في ATTI وريح قوية وهبات مفاجئة: تثبت داخل أسطوانة 1 م أغلب الوقت، وبعدين تسوي اختبار المكان حق NIST وتهبط في الدائرة.',
      steps: ['أقلع لـ 5 م وادخل الأسطوانة', 'اثبت 20 ث (80% من الوقت داخلها على الأقل) — الهبة تجي فجأة، صححها بسرعة', 'سو اختبار NIST (المكان): صوّر السطول وأنت تصحح الريح', 'اهبط في الدائرة'],
      realWorld: 'الهبات تجي فجأة جنب المباني والأشجار. في ATTI الدرون ما يقاومها لحاله — يدك هي اللي تقاوم. ممنوع تجرب ATTI بالحقيقة إلا مع مدرب وعلى ارتفاع.',
      pass: 'المعدل 70 أو أكثر بدون تعدي حد الأخطاء'
    },
    tasks: () => [
      hook(() => new Drill({
        title: 'الأسطوانة في الهبات', short: 'الأسطوانة',
        steps: [
          B.takeoff(5),
          B.hover(0, -14, 5, { head: 'tail', hold: 20, r: 1.0, rv: 0.6, headTol: 20, label: 'الأسطوانة', say: 'اثبت داخل الأسطوانة. الهبات بتجي فجأة' })
        ],
        score(st, T) {
          const P2 = T.parts(), m = st.m;
          P2.inside = m.holdT > 0 ? SCO().band(1 - 20 / m.holdT, 0.2, 0.6) : 0;
          return SCO().combine(P2, { hold: 50, inside: 50 }, T.fm);
        }
      }), gusty(3, 6)),
      hook(MK().capture(DS.NIST.bperp({ part: 'position' })), Object.assign({ title: 'NIST في ATTI', short: 'NIST ATTI' }, gusty(2.5, 7)))
    ]
  });

  add({
    id: 'A5', level: 'A', icon: '🗼', title: 'تفتيش برج الاتصالات', sub: 'برج 60 م • 24 علامة • مسافة 6.5–9.5 م • ممنوع أقرب من 5 م',
    airframe: 'mini', mode: 'P', zone: 'city', wind: W(4, 1.2), fence: false, maxAlt: 90, aids: 'none', faults: true, pass: 70,
    spawn: { x: -140, z: 6, yaw: 0, pilot: { x: -140, z: 12 } },
    brief: {
      goal: 'تفتش برج اتصالات 60 م: تصوّر 24 علامة على أوجهه الثلاثة والكتابة واضحة، وأنت على مسافة 6.5–9.5 م من الحديد. أقرب من 5 م = خطأ أمان.',
      steps: ['أقلع وروح للبرج من جهة الريح', 'اطلع وجه وجه (عمود عمود) — العلامة في نص الكاميرا وكبيرة (زوم LB + RT لو تحتاج)', 'صوّر بـ RB والكاميرا ثابتة (لا تلف وأنت تصور)', 'جنب الحديد البوصلة تتلخبط: لو انجرف الدرون ابعد شوي', 'ارجع وهبط وفيه 25% بطارية على الأقل'],
      realWorld: 'تفتيش الأبراج شغل حقيقي للدرونات. القاعدة: مسافة ثابتة، كاميرا ثابتة، وتبعد عن الحديد لأن البوصلة تتأثر وممكن يصير Toilet Bowl.',
      pass: '22 علامة من 24 والمعدل 70 أو أكثر'
    },
    tasks: () => [sayStart(MK().inspect(Object.assign({ title: 'تفتيش البرج', short: 'البرج' }, DS.Inspect.towerTags({ perFace: 8, y0: 6, y1: 52 }),
      { standoff: [6.5, 9.5], keepOut: 5, landHome: true, need: 22, timeLimit: 900 })), 'تفتيش البرج. خلك بين ستة ونص وتسعة ونص متر من الحديد')]
  });

  add({
    id: 'A6', level: 'A', icon: '⚡', title: 'دورية خط الكهرباء', sub: '6 عوازل • عيبين • جنب الخط على 15 م • ممنوع أقرب من 4 م',
    airframe: 'mini', mode: 'P', wind: W(3, 1), fence: false, maxAlt: 60, aids: 'none', faults: true, pass: 70,
    spawn: { x: -50, z: -120, yaw: 0, pilot: { x: -50, z: -114 } },
    brief: {
      goal: 'تمشي جنب خط الكهرباء (مو تحته ولا بين الأسلاك)، وعند كل برج تقرّب الكاميرا على العوازل وتقول: سليم ولا فيه عيب؟',
      steps: ['أقلع وروح جنب الخط على 15 م تقريباً (الجهة الجنوبية)', 'عند كل برج: زوم (LB + RT) على العازل وصوّر بـ RB', 'جاوب: سليم ولا فيه عيب (محروق أو مكسور)', 'ممنوع تقرب من الأسلاك أقل من 4 م وممنوع تعدي بينها'],
      realWorld: 'شركات الكهرباء تستخدم الدرون للتفتيش بدل ما يطلع العامل. المسافة عن الأسلاك مهمة: المجال المغناطيسي يلخبط البوصلة والسلك ما تشوفه زين.',
      pass: 'العيبين صح والمعدل 70 أو أكثر'
    },
    tasks: () => [sayStart(MK().inspect(Object.assign({ title: 'تفتيش خط الكهرباء', short: 'خط الكهرباء' }, DS.Inspect.insulatorTags({ pylons: [2, 3, 4], side: 1, defects: [5, 8] }),
      { standoff: [11, 19], keepOut: 4, askDefects: true, zoomPx: 20, order: 'seq', timeLimit: 720 })), 'دورية خط الكهرباء. خلك جنب الخط ولا تقرب من الأسلاك')]
  });

  add({
    id: 'A8', level: 'A', icon: '🛟', title: 'بحث وإنقاذ بالحراري', sub: 'الصحراء وقت الغروب • مربع يكبر • شخصين مفقودين',
    airframe: 'mini', mode: 'P', zone: 'desert', wind: W(3, 1, 0), timeOfDay: 'sunset', thermal: true, fence: false, maxAlt: 120, aids: 'none', faults: true, pass: 70,
    spawn: { x: 0, z: -232, yaw: 0, pilot: { x: 0, z: -226 } },
    brief: {
      goal: 'فيه شخصين ضايعين قريب من آخر مكان شافوهم فيه. تطير نمط "المربع اللي يكبر" على 50 م، وتعلّم كل شخص تلقاه وتبلّغ عن مكانه.',
      steps: ['روح لآخر مكان معروف (العلامة)', 'شغّل الحراري: Y مطوّل — الناس يطلعون أبيض', 'طر المربع: ضلعين، وبعدين كل ضلعين أطول، كل اللفات 90°', 'لما تشوف شخص: خله في نص الكاميرا واضغط RB', 'جاوب كم شخص لقيت'],
      realWorld: 'هذا نفس نمط البحث (Expanding Square) اللي يستخدمه خفر السواحل والدفاع المدني. الكاميرا الحرارية تطلع حرارة الجسم حتى بالليل.',
      pass: 'تلقى الكل والمعدل 70 أو أكثر'
    },
    tasks: () => [sayStart(MK().search({ datum: { x: 0, z: -420 }, n: 2, radius: 150, alt: 50, report: [{ q: 'كم شخص لقيت؟', a: ['2', '1', '3', '0'], c: 0 }] }),
      'بحث وانقاذ. روح لآخر مكان معروف وابدأ المربع. الحراري بزر واي مطول')]
  });

  add({
    id: 'A10', level: 'A', icon: '🚚', title: 'الهبوط على شاحنة تمشي', sub: 'منصة 1.5 م على شاحنة 10 → 20 كم/س',
    airframe: 'mini', mode: 'P', wind: W(2, 0.6), fence: false, maxAlt: 60, aids: 'none', faults: true, pass: 70,
    brief: {
      goal: 'تهبط على منصة فوق شاحنة ماشية. تجي من وراها، تمشي بنفس سرعتها، وتنزل بشويش — ولو ما ضبطت، اطلع وعيد (عادي).',
      steps: ['أقلع وروح ورا الشاحنة', 'امشِ بنفس سرعتها وخلك فوق المنصة على 2–3 م', 'انزل أقل من نص متر بالثانية', 'لو بعدت عن المنصة: اطلع وعيد (Go-around) — مسموح مرتين'],
      realWorld: 'الهبوط على قارب أو سيارة ماشية يستخدم في الإنقاذ البحري والدوريات. السر: تطابق السرعة أول، وبعدين تنزل.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [sayStart(MK().movingLand({ speed: [2.8, 5.6], ramp: 40 }), 'روح ورا الشاحنة وطابق سرعتها قبل لا تنزل')]
  });

  // ---------------- P: محترف ----------------
  // أدوات الكاميرا للقطات السينمائية
  const LOW3 = Math.atan(Math.tan(21.5 * D2R) / 3) * R2D;   // ~7.5°: زاوية خط الثلث السفلي عن نص الصورة
  const elevTo = (d, x, y, z) => Math.atan2(y - (d.p.y - 0.03), Math.max(0.5, U.dist2(d.p.x, d.p.z, x, z))) * R2D;
  const newRec = () => (SCO() ? new (SCO().Recorder)(50, 2400) : null);
  const recTick = (ctx, R, dt) => { if (R) R.update(dt, ctx.drone, ctx.session ? ctx.session.gimbal : 0, ctx.controls, ctx.camera()); };
  const smoothPart = (R, ch, i0, ref) => {
    if (!R || !SCO()) return null;
    const v = R.ldljWin(ch, i0, R.n, 6);
    return v == null ? null : SCO().smooth(v, ref, 8);
  };

  add({
    id: 'P1', level: 'P', icon: '🎬', title: 'لقطة الكشف (Reveal)', sub: 'وضع C • تطلع فوق الجدار والكاميرا تنزل • السيارة على الثلث السفلي',
    airframe: 'mini', mode: 'C', wind: W(1.5, 0.5), fence: true, maxAlt: 40, aids: 'none', pass: 70,
    brief: {
      goal: 'السيارة مخفية ورا جدار 12 م. تبدأ قدام الجدار على 5 م والكاميرا مستوية، وتطلع لقدام وفوق بنعومة وتنزّل الكاميرا لين تطلع السيارة على خط الثلث تحت. 8–12 ثانية.',
      steps: ['وضع C (السينمائي): بطيء وناعم', 'روح لنقطة البداية، وجهه للجدار، والكاميرا مستوية (LT/RT)', 'ابدأ: {P} لقدام شوي + {T} لفوق مع بعض — وخل 3 م بينك وبين الجدار', 'وأنت تعدي، نزّل الكاميرا بـ LT بشويش لين تصير السيارة تحت بالثلث', 'ثبّت آخر اللقطة ثانية'],
      realWorld: 'لقطة الكشف من أشهر لقطات الأفلام والإعلانات. السر: كل الحركات بطيئة وبنفس الوقت — وضع C في DJI مصمم لها.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [() => new Drill({
      title: 'لقطة الكشف', short: 'الكشف', timeLimit: 240,
      setup(ctx, st, T) {
        ctx.R.add(T, { type: 'wall', x: 0, z: -34, w: 30, h: 12, yaw: PI });
        ctx.env.taskColliders.push({ type: 'box', x: 0, z: -34, w: 30, d: 0.6, h: 12, name: 'الجدار' });
        ctx.R.add(T, { type: 'vehicle', kind: 'car', x: 0, z: -60, yaw: PI / 2, color: 0xdc2626 });
        ctx.env.taskColliders.push({ type: 'box', x: 0, z: -60, w: 4.6, d: 2, h: 1.5, name: 'السيارة' });
        st.map.push({ kind: 'tower', x: 0, z: -34, r: 2 }, { kind: 'zone', x: 0, z: -60, r: 3, state: 'next' });
        st.data.rec = newRec();
      },
      steps: [
        B.takeoff(3),
        B.go(0, -26, 5, { label: '🎬', speed: 2.5, noTrack: true, say: 'روح لنقطة البداية قدام الجدار' }),
        B.cond(c => { const d = c.drone; return !d.onGround && Math.abs(U.wrap(d.yaw)) < 8 * D2R && Math.abs(c.session.gimbal) < 6 && U.dist2(d.p.x, d.p.z, 0, -26) < 1.5; },
          'وجّه الدرون للجدار (شمال) والكاميرا مستوية (LT/RT) — وبعدين اثبت', {
            hold: 1, say: 'وجهه للجدار والكاميرا مستوية. استعد',
            guide: (c, st) => { const g = G(st, 'p'); g.x = 0; g.z = -26; g.alt = 5; g.speed = 1.5; g.yaw = 0; g.gimbal = 0; return g; }
          }),
        {
          say: 'أكشن! قدام وفوق مع بعض بشويش، ونزّل الكاميرا لين تطلع السيارة تحت',
          enter(ctx, st) { st.data.sh = { t: 0, on: false, t0: 0, clr: 99, okT: 0, fe: 1, i0: 0 }; },
          tick(ctx, st, dt, T) {
            const d = ctx.drone, S = st.data.sh, R = st.data.rec; S.t += dt;
            if (!S.on) { if (U.dist2(d.p.x, d.p.z, 0, -26) > 0.6 || d.p.y > 5.6) { S.on = true; S.t0 = S.t; S.i0 = R ? R.n : 0; } else return null; }
            recTick(ctx, R, dt);
            if (Math.abs(d.p.z + 34) < 1.6 && Math.abs(d.p.x) < 16) { const c = d.p.y - 12; if (c < S.clr) S.clr = c; }
            const pr = SCO().project(ctx.camera(), 0, 1, -60, st._pr || (st._pr = { x: 0, y: 0, depth: 0, dist: 0, ok: false, inFrame: false }));
            S.fe = SCO().framing(pr, 0, -1 / 3);
            T.reticle = T.reticle || { deg: 3, label: 'الثلث تحت', ok: false }; T.reticle.ok = S.fe < 0.08;
            if (d.p.z < -38 && S.fe < 0.08) S.okT += dt; else S.okT = 0;
            const dur = S.t - S.t0;
            if (S.okT >= 1 || dur > 40) {
              const D = dur - S.okT;
              const P = st.data.parts;
              P.smooth = smoothPart(R, 'cam', S.i0, -16);
              P.framing = SCO().band(S.fe, 0.03, 0.15);
              P.timing = SCO().band(Math.max(0, Math.abs(D - 10) - 2), 0, 6);
              P.clear = clamp(S.clr / 3, 0, 1);
              if (S.clr < 3) { T.fault('major', 'pos', 'قربت من الجدار (أقل من 3 م)'); tip(st, 'خل 3 م على الأقل فوق الجدار'); }
              if (D > 14) tip(st, 'اللقطة طويلة: حاول تخلصها بين 8 و 12 ثانية'); else if (D < 7) tip(st, 'اللقطة سريعة: هدّي الحركة');
              T.reticle = null;
              return 'next';
            }
            return null;
          },
          hint: (ctx, st) => { const S = st.data.sh; return !S.on ? tx('ابدأ: {P} لقدام + {T} لفوق بشويش') : ctx.drone.p.z > -36 ? 'كمّل لفوق — خل 3 م فوق الجدار' : (S.fe < 0.08 ? 'ممتاز! ثبّت كذا…' : 'نزّل الكاميرا (LT) لين تصير السيارة على الخط تحت'); },
          guide(ctx, st) {
            const d = ctx.drone, g = G(st, 's');
            g.x = 0; g.z = d.p.y < 15.5 ? -26 - 8 * clamp((d.p.y - 5) / 10.5, 0, 1) : -42; g.alt = 16.5; g.speed = 2.5; g.yaw = 0;
            g.gimbal = elevTo(d, 0, 1, -60) + LOW3;
            return g;
          }
        }
      ],
      w: { smooth: 35, framing: 35, timing: 15, clear: 15 }
    })]
  });

  add({
    id: 'P2', level: 'P', icon: '🌀', title: 'الدوران السينمائي واللولب', sub: 'وضع C • نص قطر 20 م • 30–40 ث للفة • وبعدين لفة وهو يطلع',
    airframe: 'mini', mode: 'C', wind: W(1.5, 0.5), fence: true, maxAlt: 40, aids: 'none', pass: 70,
    brief: {
      goal: 'تلف حول الشخص على 20 م والكاميرا عليه بالضبط (±3%)، بسرعة ثابتة (30–40 ث للفة). وبعدين لفة ثانية وأنت تطلع 10 م (لولب Helix).',
      steps: ['وضع C — كل العصي ناعمة', 'لفة كاملة مع عقارب الساعة: {R} + {Y} مع بعض بنفس النسبة طول اللفة', 'لفة بالعكس وأنت ترفع {T} شوي شوي (10 م باللفة)', 'لا توقف ولا تسرّع فجأة'],
      realWorld: 'هذا الـ Orbit السينمائي اللي تشوفه في الإعلانات. الفرق بين الهاوي والمحترف: السرعة الثابتة والهدف بالنص بالضبط.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [
      sayStart(MK().orbitCam({ title: 'الدوران السينمائي', short: 'الدوران', x: 0, z: -40, subject: { type: 'person' }, R: 20, alt: 8, laps: [{ dir: 1, deg: 360 }], period: [30, 40], frameTol: 0.03 }), 'لفة سينمائية حول الشخص. سرعة ثابتة والكاميرا عليه'),
      MK().orbitCam({ title: 'اللولب (يطلع وهو يلف)', short: 'اللولب', x: 0, z: -40, subject: { type: 'person' }, R: 20, alt: 8, climb: 10, laps: [{ dir: -1, deg: 360 }], period: [30, 40], frameTol: 0.03 })
    ]
  });

  add({
    id: 'P3', level: 'P', icon: '🚗', title: 'تتبع سيارة ماشية', sub: 'اختار الوضع الصح • السيارة 20–33 كم/س • بالنص والمسافة ثابتة',
    airframe: 'mini', mode: 'C', wind: W(2, 0.6), fence: false, maxAlt: 60, aids: 'none', faults: true, pass: 70,
    brief: {
      goal: 'تصوّر سيارة تمشي على الطريق الدائري وتخليها في نص الكاميرا والمسافة ثابتة (12–30 م) دقيقة كاملة — حتى لما تسرّع وتلف.',
      steps: ['أنت في وضع C — هل يلحق السيارة؟ اختار الوضع الصح', 'حوّل N بالسهم فوق ▲', 'أقلع لـ 20 م (فوق الأشجار والأعمدة) وروح جنب الطريق', 'لما تتحرك السيارة: امشِ معها، ولف ({Y}) عشان تبقى بالنص'],
      realWorld: 'C أقصى سرعته 6 م/ث تقريباً — ما يلحق سيارة على 30 كم/س. الطيار المحترف يعرف حدود كل وضع قبل اللقطة.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => {
      const r = DS.World && DS.World.roads && DS.World.roads[0];
      return [
        () => new Drill({
          title: 'اختيار الوضع', short: 'الوضع',
          steps: [
            B.decide('السيارة بتمشي من 20 إلى 33 كم/س وأنت في وضع C. وش تسوي؟',
              ['تحوّل N — وضع C بطيء (أقصاه 6 م/ث تقريباً) ما يلحقها', 'تخليه C عشان اللقطة أنعم', 'تحوّل ATTI عشان أسرع', 'تطفي حساسات العوائق'],
              'كل وضع له حد سرعة: C بطيء للتصوير الهادي، N للشغل العادي (12 م/ث)، S للسرعة.'),
            B.mode('P', { say: 'حوّل الوضع إن بالسهم فوق' })
          ],
          w: { dec: 100 }
        }),
        sayStart(MK().track({ road: 'loop', s0: r ? r.len - 140 : 585, speed: [[0, 6], [20, 9], [40, 7]], duration: 60, offset: { side: -9, back: 0, alt: 20 }, dist: [12, 30], vehicle: { kind: 'car', color: 0xdc2626 } }),
          'روح جنب الطريق على عشرين متر. لما تتحرك السيارة امش معها')
      ];
    }
  });

  add({
    id: 'P4', level: 'P', icon: '🤳', title: 'الدروني واللقطة من فوق', sub: 'تشيك وراك • ترجع وتطلع بخط 30° • وبعدين من فوق وتلف 90°',
    airframe: 'mini', mode: 'P', wind: W(1.5, 0.5), fence: true, maxAlt: 80, aids: 'none', pass: 70,
    brief: {
      goal: 'لقطتين: "الدروني" — تبدأ قريب من الشخص وترجع لورا وفوق بخط مستقيم 30° لين 50 م في 15 ث. وبعدين من فوق: الكاميرا لتحت وتطلع من 10 لـ 60 م وأنت تلف 90° بسرعة ثابتة.',
      steps: ['روح قدام الشخص (3 م) على ارتفاع الوجه، وجهه عليه', 'قبل ما ترجع لورا: لف وشوف وراك بالكاميرا — فيه عمود!', 'ارجع وجهه للشخص، وابدأ: {P} لورا + {T} لفوق بنفس النسبة، والكاميرا تتبع الشخص', 'بعدين: فوق الشخص على 10 م، الكاميرا لتحت (LT للآخر)', 'اطلع لـ 60 م وأنت تلف 90° ({Y}) بسرعة ثابتة'],
      realWorld: 'لما ترجع لورا ما تشوف وراك — الحساسات الخلفية ما تكفي دايم. الطيار المحترف يلف ويشيك الطريق قبل أي حركة لورا.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [() => new Drill({
      title: 'الدروني واللقطة من فوق', short: 'الدروني', timeLimit: 420,
      setup(ctx, st, T) {
        ctx.R.add(T, { type: 'person', x: -15, z: -40, yaw: PI / 2, pose: 'stand', color: 0xf59e0b });
        ctx.R.add(T, { type: 'pylon', x: -3, z: -37.6, h: 9 });
        ctx.env.taskColliders.push({ type: 'cyl', x: -3, z: -37.6, r: 0.35, h: 9, name: 'العمود' });
        st.map.push({ kind: 'people', x: -15, z: -40 }, { kind: 'pylon', x: -3, z: -37.6 });
        st.data.rec = newRec();
      },
      steps: [
        B.takeoff(2),
        B.go(-12, -40, 1.8, { label: '1', speed: 3, noTrack: true, altReach: 0.8, say: 'روح قدام الشخص بثلاثة متر على ارتفاع الوجه' }),
        B.yawTo(-PI / 2, { say: 'وجّه الدرون على الشخص', tol: 10, hint: 'لف الدرون بمكانه لين يصير وجهه على الشخص ({Y} يمين/يسار)' }),
        B.cond(c => c.inView(-3, 7, -37.6, 22).ok, 'قبل ما ترجع لورا: لف الدرون وشوف وراك بالكاميرا — وش فيه؟', {
          hold: 0.5, say: 'قبل ما ترجع لورا، لف وشوف وراك',
          guide: (c, st) => { const g = G(st, 'c'); g.x = -12; g.z = -40; g.alt = 1.8; g.speed = 1.5; g.yaw = U.bearing(-12, -40, -3, -37.6); g.gimbal = 12; return g; },
          exit(ctx, st) { st.data.parts.check = 1; ctx.msg('👀 شفت العمود؟ طريقك يعدي جنبه — خلك على الخط', 'info'); }
        }),
        B.cond(c => { const d = c.drone; return Math.abs(U.wrap(-PI / 2 - d.yaw)) < 8 * D2R && U.dist2(d.p.x, d.p.z, -12, -40) < 1.2; }, 'رجّع وجهه على الشخص — وبعدين ابدأ الدروني', {
          hold: 1, say: 'رجع وجهه على الشخص',
          guide: (c, st) => { const g = G(st, 'f'); g.x = -12; g.z = -40; g.alt = 1.8; g.speed = 1.5; g.yaw = -PI / 2; g.gimbal = elevTo(c.drone, -15, 1.3, -40); return g; }
        }),
        { // الدروني: خط 30° لورا وفوق
          say: 'أكشن! ارجع لورا واطلع بنفس النسبة، والكاميرا على الشخص',
          enter(ctx, st) { st.data.dr = { on: false, t: 0, t0: 0, i0: 0, xt: SCO() ? new (SCO().Stat)() : null, v: SCO() ? new (SCO().Stat)() : null, fr: 0, fT: 0 }; },
          tick(ctx, st, dt, T) {
            const d = ctx.drone, S = st.data.dr, R = st.data.rec, c30 = Math.cos(30 * D2R), s30 = Math.sin(30 * D2R);
            S.t += dt;
            const ax = d.p.x + 12, ay = d.p.y - 1.8, a = ax * c30 + ay * s30;   // المسافة على الخط
            if (!S.on) { if (a > 0.8) { S.on = true; S.t0 = S.t; S.i0 = R ? R.n : 0; } else return null; }
            recTick(ctx, R, dt);
            const xt = Math.hypot(-ax * s30 + ay * c30, d.p.z + 40); if (S.xt) S.xt.add(xt);
            const va = d.v.x * c30 + d.v.y * s30; if (S.v && a > 3 && a < 43) S.v.add(va);
            const pr = SCO().project(ctx.camera(), -15, 1.3, -40, st._pr || (st._pr = { x: 0, y: 0, depth: 0, dist: 0, ok: false, inFrame: false }));
            S.fT += dt; if (SCO().framing(pr, 0, 0) < 0.1) S.fr += dt;
            T.trackF('pos', xt, 2);
            if (a >= 46) {
              const D = S.t - S.t0, P = st.data.parts;
              P.line = S.xt ? SCO().band(S.xt.rms, 0.7, 3) : null;
              P.dspeed = S.v && S.v.n > 20 ? SCO().band(S.v.cv, 0.1, 0.4) : null;
              P.dframe = SCO().band(1 - S.fr / Math.max(S.fT, 0.1), 0.1, 0.5);
              P.dtime = SCO().band(Math.max(0, Math.abs(D - 15) - 3), 0, 8);
              P.dsmooth = smoothPart(R, 'p', S.i0, -15);
              return 'next';
            }
            if (S.t - S.t0 > 60) return 'fail:الدروني طوّل كثير';
            return null;
          },
          hint: (ctx, st) => { const S = st.data.dr; return !S.on ? tx('ابدأ: {P} لورا + {T} لفوق بنفس الوقت') : 'كمّل نفس الخط والسرعة… والشخص بنص الكاميرا (LT/RT)'; },
          guide(ctx, st) {
            const d = ctx.drone, g = G(st, 'd'), c30 = Math.cos(30 * D2R), s30 = Math.sin(30 * D2R);
            const a = Math.max(0, (d.p.x + 12) * c30 + (d.p.y - 1.8) * s30), t = Math.min(48, a + 3.8);
            g.x = -12 + t * c30; g.z = -40; g.alt = 1.8 + t * s30; g.speed = 3; g.yaw = -PI / 2; g.gimbal = elevTo(d, -15, 1.3, -40);
            return g;
          }
        },
        B.go(-15, -40, 10, { label: '⬇', speed: 4, noTrack: true, say: 'الحين روح فوق الشخص على عشرة متر' }),
        B.cond(c => c.session.gimbal < -85 && U.dist2(c.drone.p.x, c.drone.p.z, -15, -40) < 1.5, 'نزّل الكاميرا لتحت للآخر (LT) — تشوف الشخص من فوق', {
          hold: 0.5, guide: (c, st) => { const g = G(st, 'v'); g.x = -15; g.z = -40; g.alt = 10; g.speed = 1.5; g.yaw = -PI / 2; g.gimbal = -90; return g; }
        }),
        { // من فوق: يطلع 10 → 60 م ويلف 90° بسرعة ثابتة
          say: 'اطلع لفوق وأنت تلف شوي شوي. نفس السرعة طول الوقت',
          enter(ctx, st) { const d = ctx.drone; st.data.td = { on: false, t: 0, y0: d.yaw, acc: 0, last: d.yaw, vs: SCO() ? new (SCO().Stat)() : null, yr: SCO() ? new (SCO().Stat)() : null }; },
          tick(ctx, st, dt) {
            const d = ctx.drone, S = st.data.td;
            if (!S.on) { if (d.p.y > 10.6) { S.on = true; S.last = d.yaw; } else return null; }
            S.t += dt;
            const dy = U.wrap(d.yaw - S.last); S.last = d.yaw; S.acc += dy;
            if (d.p.y > 13 && d.p.y < 57) { if (S.vs) S.vs.add(d.v.y); if (S.yr && dt > 0) S.yr.add(Math.abs(dy) / dt); }
            if (d.p.y >= 59) {
              const P = st.data.parts;
              P.vcv = S.vs && S.vs.n > 20 ? SCO().band(S.vs.cv, 0.1, 0.4) : null;
              P.ycv = S.yr && S.yr.n > 20 ? SCO().band(S.yr.cv, 0.1, 0.5) : null;
              P.yaw90 = SCO().band(Math.abs(Math.abs(S.acc) * R2D - 90), 15, 60);
              P.ttime = SCO().band(Math.max(0, Math.abs(S.t - 20) - 5), 0, 15);
              return 'next';
            }
            if (S.t > 90) return 'fail:طوّلت كثير';
            return null;
          },
          hint: (ctx, st) => { const S = st.data.td; return !S.on ? tx('ارفع {T} شوي (2–3 م/ث) والكاميرا لتحت') : 'كمّل: لفيت ' + Math.round(Math.abs(S.acc) * R2D) + '° من 90 • الارتفاع ' + Math.round(ctx.drone.p.y) + ' من 60 م'; },
          guide(ctx, st) {
            const d = ctx.drone, S = st.data.td, g = G(st, 'u'), k = clamp(S.t / 20, 0, 1);
            g.x = -15; g.z = -40; g.alt = Math.min(61, 10 + 50 * k + 2); g.speed = 1.5; g.yaw = U.wrap(S.y0 + (PI / 2) * k + 0.04); g.yawFF = S.t < 20 ? (PI / 2) / 20 : 0; g.gimbal = -90; g.vdown = null;
            return g;
          }
        },
        B.land(0, 0, 1.0, { home: true, say: 'ممتاز. ارجع ونزّل على البيت' })
      ],
      w: { check: 10, line: 10, dspeed: 10, dframe: 10, dtime: 10, dsmooth: 10, vcv: 10, ycv: 10, yaw90: 5, ttime: 5, land: 10 }
    })]
  });

  add({
    id: 'P5', level: 'P', icon: '🔭', title: 'المراقبة من بعيد (ISR)', sub: '300 م أو أكثر • 100 م ارتفاع • زوم • عدّ الناس ولون الشاحنة',
    airframe: 'mini', mode: 'P', wind: W(5, 1.5), fence: false, maxAlt: 120, aids: 'none', faults: true, pass: 70,
    spawn: { x: -200, z: 268, yaw: 0, pilot: { x: -200, z: 274 } },
    brief: {
      goal: 'تراقب ساحة فيها شاحنة وناس من بعيد (300 م أو أكثر) وعلى 100 م ارتفاع — بدون ما تقرب. تخلي الشاحنة بنص الكاميرا بالزوم، وتبلّغ: كم شخص؟ ووش لون الشاحنة؟',
      steps: ['أقلع واطلع لـ 100 م وروح للعلامة (أبعد من 300 م عن الهدف)', 'زوم: LB مطوّل + RT لين ×4', 'خل الشاحنة في النص 30 ث والريح تهز الكاميرا', 'كل ثانية أقرب من 300 م = خطأ كبير', 'جاوب الأسئلة'],
      realWorld: 'المراقبة (ISR) = تشوف وتعرف وتبلّغ من مسافة آمنة بدون ما ينتبهون لك. صوت الدرون يتسمع لين 150 م تقريباً، عشان كذا المسافة مهمة.',
      pass: 'الأجوبة صح والمعدل 70 أو أكثر'
    },
    tasks: () => [hook(MK().track({
      title: 'المراقبة من بعيد', short: 'ISR', static: true, x: -200, z: -77, yaw: 0, vehicle: { kind: 'truck', color: 0xffffff }, view: { x: -200, z: 256, alt: 100 }, dist: [300, 2000],
      keepOut: { r: 300, cls: 'major', every: 1 }, zoom: 4, frame: { tol: 0.1 }, duration: 30, maxDist: 600,
      report: [{ q: 'كم شخص شفت عند الشاحنة؟', a: ['3', '2', '4', '1'], c: 0, ex: 'كانوا 3: اثنين ورا الشاحنة وواحد قدامها.' }, { q: 'وش لون الشاحنة؟', a: ['أبيض', 'أحمر', 'أزرق', 'أسود'], c: 0 }]
    }), {
      begin(ctx, t) {
        [[-196, -74, 0xdc2626], [-194, -79, 0x16a34a], [-205, -75, 0x2563eb]].forEach(([x, z, c]) => ctx.R.add(t, { type: 'person', x, z, yaw: PI, pose: 'stand', color: c }));
        if (ctx.say) ctx.say('مراقبة من بعيد. لا تقرب أقل من ثلاثمية متر. استخدم الزوم');
      }
    })]
  });

  add({
    id: 'P6', level: 'P', icon: '🌙', title: 'الطيران بالليل', sub: 'ضوء الوميض قبل الإقلاع • اتجاه الدرون من أنواره • NIST بسطول منورة',
    airframe: 'mini', mode: 'P', wind: W(1.5, 0.5), timeOfDay: 'night', thermal: true, fence: true, maxAlt: 40, aids: 'none', faults: true, pass: 70,
    brief: {
      goal: 'بالليل: تشغّل ضوء الوميض قبل الإقلاع، تعرف اتجاه الدرون من أنواره وهو بعيد 80 م، وتسوي اختبار المكان حق NIST بسطول منورة وتهبط.',
      steps: ['قبل الإقلاع: VIEW مطوّل ثانية = ضوء الوميض (Strobe)', 'أقلع وروح للعلامة البعيدة (80 م)', 'لف الدرون لين يصير وجهه لك — الأنوار الحمرا قدام', 'ارجع وسو اختبار NIST (المكان) واهبط في الدائرة'],
      realWorld: 'الطيران بالليل يحتاج ضوء وميض يتشاف من بعيد. وأنوار DJI: الأحمر قدام والأخضر/الأصفر ورا — كذا تعرف وين وجهه بالظلام.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [
      () => new Drill({
        title: 'الضوء والاتجاه بالليل', short: 'الليل',
        setup(ctx) { ctx.drone.strobe = false; },
        always(ctx, st, dt, T) { const d = ctx.drone; if (!d.onGround && d.strobe !== true && !st.data.noS) { st.data.noS = true; T.fault('safety', 'sight', 'أقلعت بالليل بدون ضوء الوميض!'); } },
        steps: [
          B.cond(c => c.drone.strobe === true, 'قبل الإقلاع: شغّل ضوء الوميض — VIEW مطوّل ثانية', { say: 'قبل ما تقلع شغل ضوء الوميض. زر فيو مطول ثانية', guide: (c, st) => st._v || (st._v = { hold: { VIEW: 1.2 } }) }),
          B.takeoff(5),
          B.go(0, -74, 15, { label: '1', speed: 6, noTrack: true, say: 'روح للعلامة البعيدة. شوف أنوار الدرون' }),
          B.yawTo('noseIn', { tol: 20, hold: 2, say: 'لف الدرون لين يصير وجهه لك. تعرف من الأنوار الحمرا', hint: 'لف الدرون لين يصير وجهه لك — تشوف الأنوار الحمرا قدام ({Y})' }),
          B.go(0, -5, 4, { label: 'H', speed: 6, noTrack: true, say: 'ارجع للمنصة' }),
          B.land(0, 0, 0.6, { home: true })
        ],
        w: { land: 100 }
      }),
      sayStart(MK().capture(DS.NIST.bperp({ part: 'position', lit: true })), 'الحين اختبار نيست بالليل. السطول منورة')
    ]
  });

  // ---------------- E: خبير (FPV) ----------------
  add({
    id: 'E1', level: 'E', icon: '🎚️', title: 'الثروتل في Acro', sub: 'ثبات 3 م • طلعة لـ 30 م ووقفة • ركضة 165 م على 15 م/ث',
    airframe: 'fpv', mode: 'ACRO', zone: 'race', wind: W(1.5, 0.5), fence: false, maxAlt: 120, aids: 'none', pass: 70,
    spawn: { x: 160, z: 30, yaw: 0, pilot: { x: 160, z: 36 } },
    brief: {
      goal: 'في Acro ما فيه شي يثبت الارتفاع غير يدك. تثبت على 3 م، تطلع لـ 30 م وتوقف خلال 3 ث، وتركض 165 م بسرعة 15 م/ث على نفس الارتفاع.',
      steps: ['شغّل (ARM) وارفع الثروتل بشويش لين 3 م — واثبت 20 ث داخل الدايرة', 'اطلع بقوة لين 30 م، وبعدين رجّعه مستوي ووقّف بسرعة', 'انزل لـ 6 م وروح لخط البداية', 'اركض لقدام: الكاميرا مايلة لفوق (Uptilt) فلازم تميّل الدرون لقدام وتزيد الثروتل مع بعض', 'وقّف عند العلامة وانزل'],
      realWorld: 'في FPV الحقيقي (Acro) الثروتل هو أصعب شي: كل ما ميّلت تحتاج ثروتل أكثر، وكل ما وقفت تحتاج أقل. هذا التمرين يبني الإحساس هذا.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => {
      const run = B.go(160, -140, 6, { label: '■', speed: 15, xtTol: 3, altTol: 1, say: 'اركض لقدام بسرعة. خل الارتفاع ثابت' });
      const e0 = run.enter, x0 = run.exit;
      run.enter = (ctx, st, T) => { e0(ctx, st, T); st.data.runT0 = T.t; };
      run.exit = (ctx, st, T) => { x0(ctx, st, T); const dur = Math.max(0.1, T.t - st.data.runT0); st.data.parts.run = SCO().band(15 - 165 / dur, 2, 7); };
      return [() => new Drill({
        title: 'الثروتل في Acro', short: 'الثروتل', timeLimit: 400,
        steps: [
          B.takeoff(3, { hint: 'شغّل المحركات (ARM) وارفع الثروتل بشويش لين 3 م', say: 'شغل وارفع الثروتل بشويش لين ثلاثة متر' }),
          B.hover(160, 22, 3, { hold: 20, r: 4, rv: 0.5, label: 'ثبات 3 م', say: 'اثبت على ثلاثة متر. الثروتل بيدك' }),
          {
            say: 'الحين اطلع بقوة لين ثلاثين متر',
            enter(ctx, st, T) { st.data.pT0 = T.t; },
            cond: ctx => ctx.drone.p.y >= 28,
            exit(ctx, st, T) { st.data.parts.punch = SCO().band(T.t - st.data.pT0 - 4, 0, 8); },
            hint: ctx => 'ارفع الثروتل قوي — لين 30 م (الحين ' + Math.round(ctx.drone.p.y) + ' م)',
            guide(ctx, st) { const g = G(st, 'k'); g.x = 160; g.z = 22; g.alt = 31; g.speed = 3; g.yaw = 0; return g; }
          },
          {
            say: 'رجعه مستوي ووقف بسرعة',
            enter(ctx, st, T) { st.data.sT0 = T.t; const d = ctx.drone; st.data.sx = d.p.x; st.data.sz = d.p.z; st.data.sy = d.p.y; },
            cond: ctx => { const d = ctx.drone; return Math.hypot(d.v.x, d.v.y, d.v.z) < 1.5 && tilt(d) < 15; }, hold: 0.3,
            exit(ctx, st, T) { st.data.parts.stop = SCO().band(T.t - st.data.sT0 - 3, 0, 4); },
            hint: () => 'رجّعه مستوي ووقّفه (السرعة تحت 1.5 م/ث) خلال 3 ث',
            guide(ctx, st) { const g = G(st, 'q'); g.x = st.data.sx; g.z = st.data.sz; g.alt = st.data.sy; g.speed = 2; g.yaw = 0; return g; }
          },
          B.go(160, 26, 6, { label: '▶', speed: 5, noTrack: true, say: 'انزل لستة متر وروح لخط البداية' }),
          run,
          B.land(160, -140, 1.2, { label: '■', say: 'وقف وانزل على العلامة وطفّ المحركات (DISARM): A مطوّل أو CSC' })
        ],
        w: { hold: 25, punch: 10, stop: 15, run: 15, alt: 15, track: 10, land: 10 }
      })];
    }
  });

  add({
    id: 'E2', level: 'E', icon: '🏎️', title: 'اللف الناعم (Carving)', sub: 'رقم 8 حول عمودين بينهم 30 م • على 3 م • بدون وقوف',
    airframe: 'fpv', mode: 'ACRO', zone: 'race', wind: W(1.5, 0.5), fence: false, maxAlt: 120, aids: 'none', pass: 70,
    spawn: { x: 190, z: -40, yaw: 0, pilot: { x: 190, z: -34 } },
    brief: {
      goal: 'تلف رقم 8 حول عمودين مرتين على ارتفاع 3 م بدون ما توقف. اللفة الناعمة = تميّل (Roll) وتلف (Yaw) وترفع (Pitch) مع بعض، والثروتل ثابت تقريباً.',
      steps: ['أقلع لـ 3 م وروح لنص المسافة بين العمودين', 'لف حول العمود اليمين مع عقارب الساعة، وبعدين اليسار عكسها', 'في اللفة: ميّل جنب + شوي لف + شد لورا شوي — لا تلف بالـ Yaw بس', 'مرتين بدون وقوف، وبعدين انزل'],
      realWorld: 'الطيارين في FPV يسمونها Carving: لفات ناعمة مثل الطيارة. هي أساس السباقات والفري ستايل وأي لقطة FPV حلوة.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => {
      const P = eight(190, -60, 26, 20, 3, 24, 2);
      return [() => new Drill({
        title: 'اللف الناعم', short: 'Carving', par: 45,
        setup(ctx, st, T) { [[175, -60], [205, -60]].forEach(([x, z]) => { ctx.R.add(T, { type: 'pylon', x, z, h: 7 }); ctx.env.taskColliders.push({ type: 'cyl', x, z, r: 0.35, h: 7, name: 'العمود' }); st.map.push({ kind: 'pylon', x, z }); }); },
        steps: [
          B.takeoff(3),
          B.go(190, -54, 3, { label: '●', speed: 4, noTrack: true }),
          ...B.path(P, { nose: 'forward', r: 3, speed: 8, xtTol: 3, altTol: 1, headTol: 30, speedStat: true, markEvery: 6, say: 'يلا. لف ناعم بدون وقوف' }),
          B.go(190, -45, 3, { label: 'H', speed: 4, noTrack: true }),
          B.land(190, -40, 1.5, { label: 'H' })
        ],
        score(st, T) {
          const P2 = T.parts(), m = st.m;
          P2.speed = m.spd && m.spd.n > 20 ? SCO().band(m.spd.cv, 0.15, 0.5) * (m.spd.mean > 4 ? 1 : 0.5) : null;
          return SCO().combine(P2, { alt: 25, head: 20, speed: 15, time: 15, track: 15, land: 10 }, T.fm);
        }
      })];
    }
  });

  add({
    id: 'E3', level: 'E', icon: '🔄', title: 'Flip و Roll', sub: 'من 15 م أو أعلى: قلبة لقدام • لورا • لفة يمين • يسار',
    airframe: 'fpv', mode: 'ACRO', wind: W(1, 0.3), fence: false, maxAlt: 120, aids: 'none', pass: 70,
    brief: {
      goal: 'أربع حركات نظيفة من 15 م أو أعلى: Flip لقدام، Flip لورا، Roll يمين، Roll يسار — 360° بالضبط، والدرون ما ينزل أكثر من 3 م، ويرجع مستوي بسرعة.',
      steps: ['Acro بس (الحركات ما تشتغل في Angle)', 'اطلع لـ 20 م تقريباً وثبّت', 'ارفع الثروتل شوي، بعدين العصا اليمين للآخر (قدام = Flip، جنب = Roll)، ونزّل الثروتل وهو مقلوب', 'لما يكمل اللفة: رجّع العصا للنص وارفع الثروتل عشان تمسكه', 'الظل في رسمة العصي يوريك الحركة'],
      realWorld: 'Flip و Roll أول حركات الفري ستايل. السر في الثروتل: تقطعه وهو مقلوب عشان ما يطيح بسرعة، وترجعه أول ما يتعدل.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [sayStart(MK().trick({ tricks: [{ type: 'flip', dir: 1 }, { type: 'flip', dir: -1 }, { type: 'roll', dir: 1 }, { type: 'roll', dir: -1 }], minAlt: 15 }), 'اطلع لعشرين متر وسو الحركات بالترتيب')]
  });

  add({
    id: 'E4', level: 'E', icon: '🎢', title: 'Split-S و Power Loop', sub: 'من 20 م: نص لفة ونزلة لورا • لوب كامل يرجع لنفس المكان',
    airframe: 'fpv', mode: 'ACRO', wind: W(1, 0.3), fence: false, maxAlt: 120, aids: 'none', pass: 70,
    brief: {
      goal: 'Split-S: وأنت ماشي لقدام تقلب نص لفة وتشد لورا — تطلع عكس اتجاهك وأوطى. Power Loop: وأنت ماشي تشد لورا وترفع الثروتل وتسوي دايرة كاملة وترجع لنفس المكان.',
      steps: ['اطلع لـ 20 م أو أكثر وامشِ لقدام', 'Split-S: Roll 180° (مقلوب) ← شد العصا لورا ← تطلع عكس الاتجاه (لا تنزل تحت 3 م)', 'Power Loop: وأنت ماشي شد لورا + ثروتل قوي فوق، وخفف الثروتل فوق، وكمّل الدايرة', 'خل الحركات على نفس الخط بدون ما يميل جنب'],
      realWorld: 'Split-S تستخدمه لما تبي ترجع بسرعة (تغوص ورا مبنى أو شجرة). Power Loop حول بوابة أو فوق شجرة من أشهر حركات الفري ستايل.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [sayStart(MK().trick({ tricks: [{ type: 'splitS' }, { type: 'powerLoop' }], minAlt: 20, at: { x: 0, z: -20, yaw: 0 } }), 'اطلع لعشرين متر. أول سبليت اس، وبعدين باور لوب')]
  });

  // E5: بوابات + فتحة ضيقة + "جسر" + بوابة البطولة (من نقطة لنقطة)
  const gatesE5 = () => {
    const P = [[165, 10], [171, -10, 3], [187, -25], [207, -29, 2.2, 2.0, 2.0, 'فتحة'], [225, -17, null, 6, 3, 'جسر'], [241, -3, 3.5, 2.13, 1.83, '7×6'], [259, -13], [271, -31, null, null, null, 'نهاية']];
    const S0 = { x: 165, z: 28 };
    const G2 = P.map(([x, z, y, w, h, label], i) => ({ x, z, y: y == null ? undefined : y, w: w || undefined, h: h || undefined, label: label || String(i + 1) }));
    G2.forEach((g, i) => {
      const A = i ? G2[i - 1] : S0, Bq = G2[i + 1] || { x: g.x + (g.x - A.x), z: g.z + (g.z - A.z) };
      g.yaw = Math.atan2(Bq.x - A.x, -(Bq.z - A.z));
    });
    return G2;
  };
  add({
    id: 'E5', level: 'E', icon: '🚪', title: 'البوابات والفتحات', sub: '8 بوابات • فتحة 2 م • جسر واطي • بوابة البطولة 7×6',
    airframe: 'fpv', mode: 'ACRO', zone: 'race', wind: W(1.5, 0.5), fence: false, maxAlt: 120, aids: 'none', pass: 70,
    spawn: { x: 165, z: 28, yaw: 0, pilot: { x: 165, z: 34 } },
    brief: {
      goal: 'تعدّي من 8 بوابات بالترتيب بدون ما تفوّت ولا وحدة: فيها فتحة ضيقة 2 م، و"جسر" واطي تعدي من تحته، وبوابة البطولة (7×6 قدم). الوقت محسوب.',
      steps: ['البوابة اللي عليها السهم هي اللي بعدها', 'قبل البوابة بشوي: صحح الارتفاع والاتجاه، وبعدين ادخل من نصها', 'الفتحة الضيقة: هدّي السرعة شوي', 'الجسر: انزل واطي (أقل من 3 م) قبله', 'فوّتت بوابة = +2 ث'],
      realWorld: 'هذا اللي يسويه طيارين الـ FPV في السباقات (MultiGP) وفي الفيديوهات: يدخلون فتحات بين الأشجار وتحت الجسور. الدقة أهم من السرعة.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [sayStart(MK().timeTrial({ title: 'البوابات والفتحات', short: 'البوابات', loop: false, gates: gatesE5(), speed: 9 }), 'ادخل البوابات بالترتيب. الدقة أهم من السرعة')]
  });

  add({
    id: 'E6', level: 'E', icon: '🏁', title: 'سباق 3 لفات', sub: 'حلبة 8 بوابات • 3 لفات • أفضل وقت محفوظ',
    airframe: 'fpv', mode: 'ACRO', zone: 'race', wind: W(1.5, 0.6), fence: false, maxAlt: 120, aids: 'none', pass: 70,
    spawn: RACE_SPAWN,
    brief: {
      goal: 'سباق ضد الوقت: 3 لفات على حلبة فيها 8 بوابات (وحدة منها بوابة البطولة). الوقت يبدأ من أول بوابة، وكل بوابة تفوّتها +2 ث. أفضل وقت ينحفظ.',
      steps: ['ابدأ ورا البوابة 1 ووجهك عليها', 'خل خطك ناعم: ادخل كل بوابة وعينك على اللي بعدها', 'لا تسرّع زيادة في اللفات — الثبات أهم', 'الميداليات: قريب من وقت المدرب = ذهبية'],
      realWorld: 'هذا شكل سباقات FPV الحقيقية. الطيارين المحترفين يفوزون بالخط النظيف واللفات المتساوية، مو بالسرعة المجنونة.',
      pass: 'المعدل 70 أو أكثر'
    },
    tasks: () => [sayStart(MK().timeTrial({ title: 'سباق 3 لفات', short: 'السباق', gates: ovalGates(), laps: 3 }), 'سباق ثلاث لفات. ادخل البوابة واحد وابدأ')]
  });

  // ---------------- E8: الاختبار النهائي (Check-ride) ----------------
  // مهمة عشوائية (تفتيش / بحث / تصوير / مراقبة) + عطلين عشوائيين + ريح 6–8 م/ث + أخطاء GVC (7/3/1)
  const FAILS = {
    gps: {
      name: 'ضاع الـ GPS', dur: 15, say: 'ضاع الجي بي اس والحساسات اللي تحت! الدرون صار ATTI. بلغ بالسهم اليمين وصحح الانجراف',
      start(ctx) { ctx.drone.loseGnss(); ctx.msg('⚠️ راح الـ GPS والحساسات تحت ما تشوف الأرض — ATTI (بلّغ ▶)', 'bad'); },
      end(ctx) { ctx.drone.setGnss(true); ctx.msg('🛰️ رجع الـ GPS', 'good'); }
    },
    compass: {
      name: 'خطأ البوصلة', dur: 14, mode: true, say: 'البوصلة تخربط والدرون صار يدور لحاله! بلغ وحول ATTI بالسهم اليسار',
      start(ctx) { ctx.drone.injectHeadingError(32 * D2R); ctx.msg('⚠️ خطأ بوصلة — الدرون يدور لحاله! (◀ ATTI)', 'bad'); },
      end(ctx) { ctx.drone.injectHeadingError(0); ctx.msg('🧭 البوصلة رجعت طبيعية — تقدر ترجع N (◀)', 'good'); }
    },
    gust: {
      name: 'هبة ريح قوية', dur: 15, say: 'هبة ريح قوية! بلغ وانتبه للمسافة',
      start(ctx, k) { const w = ctx.env.wind, b = ctx.session ? ctx.session.windBase : { s: 6, g: 1.5, dir: 0 }; w.set(Math.min(b.s + 3, 9.5), b.dir, 2.5); if (w.gustEvent) w.gustEvent(b.dir, 4, 2); ctx.msg('💨 هبة ريح قوية!', 'bad'); },
      end(ctx) { const b = ctx.session ? ctx.session.windBase : null; if (b) ctx.env.wind.set(b.s, b.dir, b.g); }
    },
    link: {
      name: 'انقطاع الإشارة', dur: 4, cancel: true, say: 'انقطعت الإشارة! لا تطفي الريموت',
      start(ctx) { const d = ctx.drone; d.link = false; d.toggleRTH(true); ctx.msg('📵 انقطعت الإشارة! الدرون يرجع لحاله', 'bad'); },
      end(ctx) { const d = ctx.drone; d.link = true; ctx.msg('📶 رجعت الإشارة — ألغِ الرجوع (ضغطة B) وكمّل', 'good'); if (ctx.say) ctx.say('رجعت الإشارة. اضغط بي ضغطة وحدة وكمل المهمة'); }
    },
    battery: {
      name: 'البطارية نزلت فجأة', dur: 0.2, say: 'البطارية نزلت فجأة لأربعين بالمية! بلغ وخلص بسرعة',
      start(ctx) { const d = ctx.drone; d.battery = Math.min(d.battery, 42); d.batWarned = {}; d.emit('warn', 'البطارية نزلت فجأة (42%)'); },
      end() {}
    }
  };
  const failHook = (ids, times) => ({
    begin(ctx, t, k) { k.air = 0; k.q = ids.map((id, i) => ({ id, at: times[i], on: false, done: false, t: 0, ack: false, acked: false, mode: false, cancel: false })); k.mg = {}; },
    update(dt, ctx, t, k) {
      const d = ctx.drone; if (d.flying) k.air += dt;
      for (const F of k.q) {
        const D = FAILS[F.id];
        if (!F.on && !F.done && k.air >= F.at && d.flying && !k.q.some(x => x.on)) {
          F.on = true; F.t = 0; D.start(ctx, k); if (ctx.say) ctx.say(D.say);
        }
        if (!F.on) continue;
        F.t += dt;
        if (!F.acked && F.t > 4 + (D.cancel ? D.dur : 0) && !F.late) { F.late = true; t.fault('minor', 'callout'); }   // انقطاع الإشارة: الأزرار ما توصل لين ترجع
        if (D.mode && !F.mode && F.t > 6 && !F.modeLate) { F.modeLate = true; t.fault('major', 'mode', 'ما حوّلت ATTI والبوصلة خربانة'); }
        if (D.mode && d.mode === 'A') F.mode = true;
        if (F.t >= D.dur && !F.ended) { F.ended = true; D.end(ctx, k); }
        if (F.ended) {
          if (D.cancel) {   // بعد رجوع الإشارة: لازم يلغي الرجوع خلال 6 ث
            if (d.auto !== 'rth') F.cancel = true;
            if (!F.cancel && F.t > D.dur + 6 && !F.cLate) { F.cLate = true; t.fault('minor', 'hesitate', 'تأخرت تلغي الرجوع وتكمل'); }
          }
          const modeOk = !D.mode || d.mode !== 'A' || F.t > D.dur + 10;   // بعد خطأ البوصلة يرجع N
          if ((!D.cancel || F.cancel || F.cLate) && (F.acked || F.late) && modeOk) { F.on = false; F.done = true; }
        }
      }
    },
    // ▶ وقت العطل = بلاغ (ما يوصل للمهمة)
    onCallout(ctx, t, k) { const F = k.q && k.q.find(x => x.on && !x.acked); if (!F) return false; F.acked = true; ctx.msg('✓ بلّغت: ' + FAILS[F.id].name, 'good'); return true; },
    guide(ctx, t, k, g) {
      const F = k.q && k.q.find(x => x.on), d = ctx.drone;
      if (!F || (g && g.decide)) return g;
      let press = null;
      if (!F.acked) press = 'RIGHT';
      else if (FAILS[F.id].mode && !F.ended && d.mode !== 'A') press = 'LEFT';
      else if (FAILS[F.id].mode && F.ended && d.mode === 'A') press = 'LEFT';
      else if (FAILS[F.id].cancel && F.ended && d.link && d.auto === 'rth') press = 'B';
      if (!press) return g;
      const m = k.mg; for (const key in m) delete m[key];
      if (g) Object.assign(m, g);
      m.press = k['p' + press] || (k['p' + press] = { [press]: true });
      return m;
    },
    end(ctx, t, k) { for (const F of k.q || []) if (F.on && !F.ended) FAILS[F.id].end(ctx, k); ctx.drone.injectHeadingError(0); }
  });
  const E8M = {
    inspect: {
      name: 'تفتيش برج الاتصالات', zone: 'city', obst: 'برج الاتصالات 60 م', rthO: ['70 م', '60 م', '40 م', '20 م'], rth: 70, selfLand: true, spawn: { x: -140, z: 6, yaw: 0, pilot: { x: -140, z: 12 } }, fails: ['gust', 'battery', 'gps'], wind: [5, 6.5],
      task: () => MK().inspect(Object.assign({ title: 'تفتيش البرج', short: 'التفتيش' }, DS.Inspect.towerTags({ perFace: 3, faces: 3, y0: 10, y1: 40 }), { standoff: [6.5, 10.5], keepOut: 5, landHome: true, timeLimit: 600 }))
    },
    sar: {
      name: 'بحث وإنقاذ', zone: 'desert', obst: 'الكثبان والصخور 10 م', rthO: ['30 م', '10 م', '5 م', 'ما يحتاج (0 م)'], rth: 30, spawn: { x: 0, z: -232, yaw: 0, pilot: { x: 0, z: -226 } }, timeOfDay: 'sunset', thermal: true, fails: ['gps', 'compass', 'gust', 'link', 'battery'], wind: [6, 8],
      task: () => MK().search({ title: 'البحث عن مفقود', short: 'البحث', datum: { x: 0, z: -380 }, n: 1, radius: 90, alt: 45, report: [{ q: 'كم شخص لقيت؟', a: ['1', '2', '0', '3'], c: 0 }] })
    },
    cine: {
      name: 'تصوير سينمائي', zone: 'field', obst: 'أعمدة الإنارة 16 م', rthO: ['30 م', '16 م', '10 م', '5 م'], rth: 30, fails: ['gps', 'gust', 'battery', 'compass'], wind: [6, 7.5],
      task: () => MK().orbitCam({ title: 'لفة سينمائية حول السيارة', short: 'التصوير', x: 0, z: -40, subject: { type: 'vehicle', kind: 'car', color: 0x16a34a, yaw: PI / 2 }, R: 15, alt: 10, laps: [{ dir: 1, deg: 360 }], period: [35, 70], band: 2.5 })
    },
    isr: {
      name: 'مراقبة من بعيد', zone: 'city', obst: 'مباني المدينة 60 م', rthO: ['70 م', '60 م', '40 م', '20 م'], rth: 70, spawn: { x: -200, z: 268, yaw: 0, pilot: { x: -200, z: 274 } }, fails: ['gps', 'gust', 'battery', 'compass'], wind: [6, 7.5],
      task: () => MK().track({ title: 'مراقبة الشاحنة', short: 'المراقبة', static: true, x: -200, z: -77, yaw: 0, vehicle: { kind: 'truck', color: 0x1d4ed8 }, view: { x: -200, z: 256, alt: 100 }, dist: [300, 2000],
        keepOut: { r: 300, cls: 'major', every: 1 }, zoom: 4, frame: { tol: 0.12 }, duration: 25, maxDist: 600, report: [{ q: 'وش لون الشاحنة؟', a: ['أزرق', 'أبيض', 'أحمر', 'أسود'], c: 0 }] })
    }
  };
  const E8_KEYS = ['inspect', 'sar', 'cine', 'isr'];
  add({
    id: 'E8', level: 'E', icon: '🎖️', title: 'الاختبار النهائي (Check-ride)', sub: 'مهمة عشوائية • عطلين مفاجئين • ريح قوية • 7 بسيطة / 3 كبيرة / 1 أمان',
    airframe: 'mini', mode: 'P', fence: false, maxAlt: 120, aids: 'none', faults: true, pass: 80, daily: true,
    prep(rng, opts) {
      const mk = E8M[opts.mission] ? opts.mission : E8_KEYS[Math.floor(rng() * E8_KEYS.length) % E8_KEYS.length];
      const M = E8M[mk], pool = M.fails.slice();
      let fs = Array.isArray(opts.failures) ? opts.failures.filter(f => FAILS[f]).slice(0, 2) : null;
      if (!fs || fs.length < 2) { fs = []; while (fs.length < 2 && pool.length) fs.push(pool.splice(Math.floor(rng() * pool.length) % pool.length, 1)[0]); }
      const ws = M.wind[0] + rng() * (M.wind[1] - M.wind[0]);
      return {
        mission: mk, M, fails: fs, variant: mk + ':' + fs.join('+'), zone: M.zone,
        wind: W(Math.round(ws * 10) / 10, 1.6), timeOfDay: M.timeOfDay || 'day', thermal: !!M.thermal, spawn: M.spawn,
        sub: M.name + ' • عطلين مفاجئين • ريح ' + Math.round(ws) + ' م/ث',
        goal: 'الاختبار النهائي: مهمتك اليوم "' + M.name + '" في ريح ' + Math.round(ws) + ' م/ث، وبيصير لك عطلين مفاجئين. بلّغ عن كل عطل (▶) وتصرّف صح، وكمّل المهمة، وارجع هبّط. حد الأخطاء: 7 بسيطة أو 3 كبيرة أو خطأ أمان واحد = رسوب.'
      };
    },
    brief: {
      steps: ['التخطيط قبل الطيران: الريح وارتفاع الرجوع (أسئلة)', 'أقلع وسو المهمة', 'أي عطل: بلّغ فوراً بالسهم اليمين ▶ وتصرّف (ATTI ◀ لو البوصلة، ضغطة B لو رجع لحاله بعد انقطاع الإشارة)', 'ارجع واهبط على البيت، وبعدين سجّل الطيرة (▶)'],
      realWorld: 'هذا شكل اختبار GVC البريطاني: تخطيط، إقلاع، طيران مع أعطال، هبوط وتسجيل. اللي ينجح هنا جاهز يطير درون حقيقي مع مشرف من أول يوم.',
      pass: 'المعدل 80 أو أكثر وبدون تعدي حد الأخطاء'
    },
    tasks(env) {
      const M = env.M, home = M.spawn || { x: 0, z: 0 };
      return [
        () => new Drill({
          title: 'التخطيط قبل الطيران', short: 'التخطيط',
          steps: [
            B.decide('الريح اليوم ' + env.wind.s + ' م/ث، وحد الدرون 10.7 م/ث. وش قرارك؟',
              ['أطير بحذر: أراقب البطارية، وأحسب الرجعة ضد الريح', 'ما أطير أبد', 'أطير عادي وأبعد قد ما أقدر', 'أطير في وضع S طول الوقت'],
              'تحت الحد تقدر تطير، بس الرجعة ضد الريح تاخذ بطارية أكثر. خل احتياط.'),
            Object.assign(B.decide('أطول شي في منطقة المهمة: ' + M.obst + '. كم تضبط ارتفاع الرجوع (RTH)؟', M.rthO,
              'ارتفاع الرجوع = أطول عائق + 10 م على الأقل، عشان الرجوع يمشي بخط مستقيم.'),
            { exit(ctx) { ctx.drone.rthSetting = M.rth; } }),
            B.callout('جاهز: البطارية، GPS، نقطة البيت، والريح — تمام', { say: 'تمام. إذا جاهز بلغ بالسهم اليمين وبعدين أقلع' })
          ],
          w: { dec: 100 }
        }),
        hook(M.task(), Object.assign({ title: M.name, short: 'المهمة' }, failHook(env.fails, [10, 26]))),
        () => new Drill({
          title: 'الهبوط والتسجيل', short: 'الهبوط',
          setup(ctx, st) {   // التفتيش يهبط لحاله على البيت (يلف حول البرج) — نقيّم مكان الهبوط ونروح للتسجيل
            const d = ctx.drone;
            if (d.onGround && !d.motors) { st.m.lands.push(clamp(Math.round(100 - 20 * U.dist2(d.p.x, d.p.z, home.x, home.z)), 0, 100)); st.k = 2; }
          },
          steps: [
            B.go(home.x, home.z - 6, 12, { label: 'H', speed: 6, noTrack: true, say: 'ارجع للبيت' }),
            B.land(home.x, home.z, 1.0, { home: true }),
            B.callout('طفّت المحركات ✓ سجّل الطيرة (Log): الوقت والأعطال', { say: 'سجل الطيرة. بلغ بالسهم اليمين' })
          ],
          w: { land: 100 }
        })
      ];
    }
  });
  E8_KEYS.forEach(m => VARIANTS.push({ id: 'E8', tag: m, opts: { mission: m } }));

  // @@MORE@@

  // ======================================================================
  // المستويات + الواجهة البرمجية (UI) + الطيران الحر
  // ======================================================================
  DS.PRO_LEVELS = [
    { id: 'B', name: 'مبتدئ', desc: 'الأساسيات بدقة الاختبارات: الفحص، الثبات، الاتجاهات، النقاط، الهبوط، NIST، والرجوع للبيت', exercises: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'] },
    { id: 'I', name: 'متوسط', desc: 'الوجه لك، رقم 8، ATTI بدون GPS، الدوران حول نفسه، والدوران حول هدف والكاميرا عليه', exercises: ['I1', 'I2', 'I3', 'I4', 'I8'] },
    { id: 'A', name: 'متقدم', desc: 'ضياع الاتجاه، ATTI مع هبات، تفتيش برج، خط كهرباء، بحث وإنقاذ بالحراري، وهبوط على شاحنة تمشي', exercises: ['A2', 'A4', 'A5', 'A6', 'A8', 'A10'] },
    { id: 'P', name: 'محترف', desc: 'لقطات سينمائية، تتبع سيارة، مراقبة من بعيد (ISR)، والطيران بالليل', exercises: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] },
    { id: 'E', name: 'خبير', desc: 'FPV: الثروتل في Acro، اللف السريع، الحركات، البوابات، السباق، والاختبار النهائي', exercises: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E8'] }
  ];
  const LV = {}; DS.PRO_LEVELS.forEach(L => { LV[L.id] = L; });
  const ORDER = [];
  DS.PRO_LEVELS.forEach(L => L.exercises.forEach(id => { if (EX[id]) ORDER.push(id); }));
  DS.PRO_ORDER = ORDER;
  // بذرة ثابتة من النص (للاختبار الذاتي)
  const hashSeed = k => { let h = 2166136261; for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619); return h >>> 0; };
  const AF_AR = { mini: 'DJI Mini', fpv: 'FPV' };

  DS.proDef = function (exId, opts) {
    const e = EX[exId]; if (!e) return null;
    opts = opts || {};
    // E8: "مهمة اليوم" (نفس المهمة طول اليوم عشان الشرح والطيران يتطابقون، وتعيدها لو رسبت)
    const day = () => { const D = new Date(); return D.getFullYear() + '-' + (D.getMonth() + 1) + '-' + D.getDate(); };
    const seed = opts.seed != null ? (opts.seed >>> 0) : e.daily ? hashSeed(exId + ':' + day()) : ((Math.random() * 4294967296) >>> 0);
    const rng = U.rng(seed);
    const env = (e.prep ? e.prep(rng, opts) : null) || {};
    const pick = k => (env[k] !== undefined ? env[k] : e[k]);
    const b = e.brief || {};
    const brief = { goal: tx(env.goal || b.goal || ''), steps: txa(b.steps).concat(txa(env.extraSteps)), realWorld: tx(b.realWorld || ''), pass: tx(b.pass || ('المعدل ' + (e.pass || 70) + ' أو أكثر')) };
    const fpv = e.airframe === 'fpv';
    return {
      kind: 'pro', id: exId, key: 'pro:' + exId, exId, level: e.level,
      title: tx(pick('title')), icon: e.icon, sub: tx(pick('sub') || ''), desc: brief.goal,
      airframe: e.airframe || 'mini', mode: e.mode || (fpv ? 'ANGLE' : 'P'), modeLocked: !!e.modeLocked, modeCycle: e.modeCycle,
      wind: pick('wind') || W(1, 0.3), timeOfDay: pick('timeOfDay') || 'day', thermal: !!pick('thermal'), zone: pick('zone') || 'field',
      fence: e.fence != null ? e.fence : false, maxAlt: e.maxAlt || 120, spawn: pick('spawn'), aids: e.aids || 'none',
      faults: e.faults ? e.faults : undefined, lockAxes: e.lockAxes,
      smartRth: e.smartRth, pass: { total: e.pass || 70 }, brief, seed, variant: env.variant,
      tasks: e.tasks(env, rng)
    };
  };

  // التقدم من DS.progress.best['pro:<id>'] (session.js يحفظه)
  const rec = id => { const P = DS.progress && DS.progress.best; return (P && P['pro:' + id]) || null; };
  const passed = id => { const r = rec(id); return !!(r && r.passed); };
  const best = id => { const r = rec(id); return r ? (r.total || 0) : 0; };
  const good = id => passed(id) && best(id) >= 80;   // يفتح المستوى اللي بعده
  const allGood = lv => LV[lv].exercises.every(id => !EX[id] || good(id));
  // قواعد الفتح (curriculum.md): I بعد كل B ≥ 80 • A بعد كل I • P بعد كل A • E1–E3 بعد I • E4–E6 بعد E3
  // • E8 (اختبار DJI النهائي) بعد كل تمارين B/I/A/P — ما يحتاج تمارين FPV (حركات وسباق) لأنه مهمة درون DJI
  function exLocked(id, lv) {
    if (DS.settings && DS.settings.unlockAll) return false;
    if (lv === 'B') return false;
    if (lv === 'I') return !allGood('B');
    if (lv === 'A') return !allGood('B') || !allGood('I');
    if (lv === 'P') return !allGood('B') || !allGood('I') || !allGood('A');
    if (lv === 'E') {
      const base = !allGood('B') || !allGood('I');
      if (id === 'E1' || id === 'E2' || id === 'E3') return base;
      if (id === 'E8') return ORDER.some(x => x !== 'E8' && EX[x].airframe !== 'fpv' && !passed(x));
      return base || !passed('E3');
    }
    return false;
  }
  DS.proState = function () {
    return DS.PRO_LEVELS.map(L => {
      const exercises = L.exercises.filter(id => EX[id]).map(id => {
        const e = EX[id], r = rec(id);
        return {
          id, key: 'pro:' + id, title: tx(e.title), icon: e.icon, sub: tx(e.sub || ''), airframe: e.airframe || 'mini',
          done: passed(id), best: best(id), medal: r && r.passed ? (r.medal || null) : null, bestTime: r && r.bestTime != null ? r.bestTime : null, locked: exLocked(id, L.id)
        };
      });
      return { id: L.id, name: L.name, desc: L.desc, locked: exercises.every(x => x.locked), done: exercises.length > 0 && exercises.every(x => x.done), exercises };
    });
  };
  DS.proNext = function () {
    for (const L of DS.proState()) for (const e of L.exercises) if (!e.done && !e.locked) return e.id;
    return null;
  };

  // ---------------- الطيران الحر ----------------
  // بوابات حلبة السباق (بيضاوي 8 بوابات حول وسط الحلبة) — نفس مسار E6
  function ovalGates() {
    const c = { x: 190, z: -60 }, N = 8, P = [];
    for (let k = 0; k < N; k++) {
      const a = PI + k * 2 * PI / N, rx = 45 + (k % 2 ? 8 : 0), rz = 32;
      P.push({ x: c.x + Math.sin(a) * rx, z: c.z - Math.cos(a) * rz, y: k % 3 === 1 ? 3.2 : undefined, label: String(k + 1) });
    }
    P.forEach((p, k) => { const A = P[(k + N - 1) % N], Bq = P[(k + 1) % N]; p.yaw = Math.atan2(Bq.x - A.x, -(Bq.z - A.z)); });
    P[4].w = 2.13; P[4].h = 1.83;   // بوابة البطولة 7×6 قدم
    return P;
  }
  DS.proOvalGates = ovalGates;
  const FREE_ZONE = {
    field: { spawn: null, tour: [[0, -15, 6], [12, -28, 8], [0, -8, 4]] },
    city: { spawn: null, tour: [[-128, 8, 10], [-112, 10, 10], [-132, 3, 6]] },
    race: { spawn: RACE_SPAWN, tour: [[192, -45, 6], [205, -45, 6], [200, -32, 4]] },
    desert: { spawn: null, tour: [[0, -250, 10], [12, -262, 12], [0, -240, 6]] },
    // أكاديمية طويق (خريطة حقيقية 3D): المنصة في الساحة اللي داخل المبنى — الجولة داخل الساحة وفوق السطح
    tuwaiq: { spawn: (DS.TUWAIQ && DS.TUWAIQ.spawn) || { x: 0, z: 8, yaw: 0, pilot: { x: 0, z: 16 } }, tour: [[0, -2, 8], [12, 20, 24], [0, 6, 4]] }
  };
  const ZONE_AR = { field: 'ساحة التدريب', city: 'المدينة', race: 'حلبة السباق', desert: 'الصحراء', tuwaiq: 'أكاديمية طويق (خريطة حقيقية)' };
  const TOD_AR = { day: 'نهار', sunset: 'غروب', night: 'ليل' };
  const WIND_AR = { calm: 'بدون ريح', light: 'ريح خفيفة', strong: 'ريح قوية' };
  // مهمة الطيران الحر: ما تخلص (الجلسة تنادي freeUpdate بس). في الاختبار الذاتي بس: جولة قصيرة وتخلص
  class FreeTask extends DS.Task {
    constructor(o) { super(Object.assign({ title: 'طيران حر', short: 'طيران حر', timeLimit: 300 }, o)); }
    begin(ctx) {
      super.begin(ctx);
      const s = ctx.session, o = this.o;
      this.test = !!(s && s.headless);
      if (this.test && s.def && s.def.kind === 'free') s.def = Object.assign({}, s.def, { kind: 'free-test', pass: { total: 60 } });
      this.k = 0; this.pts = o.tour || []; this._g = { x: 0, z: 0, alt: 0, speed: 4, yaw: null };
      this.items = [];
      this.tt = null;
      // حلبة السباق (مو في الاختبار الذاتي): سباق مفتوح بالوقت — كل لفة تنحسب وأفضل لفة تبان، بدون نهاية
      if (!this.test && o.gates && o.gates.length && DS.TimeTrialTask) {
        this.tt = new DS.TimeTrialTask({ gates: o.gates, laps: 999, timeLimit: 1e9, title: 'سباق حر', short: 'سباق حر', safetyFail: false, sayFaults: false });
        this.tt.begin(ctx);
      } else (o.gates || []).forEach((g, i) => {
        ctx.R.add(this, { type: 'raceGate', x: g.x, z: g.z, y: g.y, yaw: g.yaw, w: g.w, h: g.h, label: g.label || String(i + 1) });
        if (DS.gateColliders) { const cs = DS.gateColliders(g); if (cs) for (const c of cs) ctx.env.taskColliders.push(c); }
        this.items.push({ kind: 'gate', x: g.x, z: g.z, r: (g.w || 1.52) / 2, label: i + 1, state: 'idle' });
      });
      this.hint = o.hint || 'طيران حر — طر براحتك. START = القائمة (عيد، الإعدادات، اطلع)';
      if (!this.test && o.intro) ctx.msg(o.intro, 'info');
    }
    // الجلسة تناديها في الطيران الحر (ما يخلص أبد): وقت اللفات في الحلبة
    freeUpdate(dt, ctx) {
      const T = this.tt;
      this.t += dt;
      if (!T) return;
      T.update(dt, ctx);
      if (T.state !== 'run') { T.state = 'run'; T.lap = 1; }   // 999 لفة؟ نكمل عادي
      this.hint = T.race.running ? T.hint : 'حلبة السباق: ادخل البوابة 1 عشان يبدأ الوقت ⏱️ • بعدها 2 ← 8 وارجع للـ 1 = لفة';
    }
    get race() { return this.tt ? this.tt.race : null; }
    end(ctx) { if (this.tt) this.tt.end(ctx); super.end(ctx); }
    _adv(d) {
      const n = this.pts.length; if (!n) return;
      const P = this.pts[this.k % n];
      if (!d.onGround && U.dist2(d.p.x, d.p.z, P[0], P[1]) < 2.5 && Math.abs(d.p.y - P[2]) < 2) this.k++;
    }
    update(dt, ctx) {   // تشتغل في الاختبار الذاتي بس (kind 'free-test')
      this.t += dt; this._adv(ctx.drone);
      this.progress = this.pts.length ? Math.min(1, this.k / this.pts.length) : 1;
      if (this.k >= this.pts.length) { this.state = 'done'; return; }
      if (this.t > this.tl) this.fail('خلص الوقت');
    }
    score() { return this.state === 'done' ? 100 : 0; }
    guide(ctx) {
      const d = ctx.drone, n = this.pts.length;
      if (!n) return null;
      // العرض: البطارية قربت تخلص → يرجع للبيت وينزل (مثل الطيار الصح)
      if (this._rtb || (!this.test && d.soc != null && d.soc < 0.18)) {
        this._rtb = true;
        const h = d.home || DS.HOME || { x: 0, z: 0 }, eh = U.dist2(d.p.x, d.p.z, h.x, h.z), g = this._g;
        g.x = h.x; g.z = h.z; g.yaw = null; g.speed = Math.min(8, 1 + eh * 0.5); g.descend = false;
        if (eh < 0.6 || d.onGround) { g.alt = null; g.descend = true; }
        else if (eh > 3 && d.p.y < 7 && !this._rtbUp) { g.x = d.p.x; g.z = d.p.z; g.alt = 9; g.speed = 1; if (d.p.y > 8) this._rtbUp = true; }   // اطلع فوق البوابات أول
        else { this._rtbUp = true; g.alt = Math.max(8, Math.min(d.p.y, 20)); }
        return g;
      }
      if (this.tt) return this.tt.guide(ctx);   // العرض في الحلبة: المحترف يلف السباق
      if (!this.test) this._adv(d);   // العرض: يلف الجولة على طول
      const P = this.pts[this.k % n], g = this._g;
      g.x = P[0]; g.z = P[1]; g.alt = P[2]; g.speed = d.profile.kind === 'fpv' ? 6 : 4; g.yaw = null; g.descend = false;
      return g;
    }
    map() { return this.tt ? this.tt.map() : this.items; }
  }
  DS.FreeTask = FreeTask;
  DS.freeDef = function (o) {
    o = Object.assign({ airframe: 'mini', zone: 'field', timeOfDay: 'day', wind: 'light' }, o || {});
    if (o.airframe !== 'fpv') o.airframe = 'mini';
    if (!FREE_ZONE[o.zone]) o.zone = 'field';
    if (!TOD_AR[o.timeOfDay]) o.timeOfDay = 'day';
    if (!WINDS[o.wind]) o.wind = 'light';
    const fpv = o.airframe === 'fpv', Z = FREE_ZONE[o.zone], zw = DS.World && DS.World.zones && DS.World.zones[o.zone];
    const sp = Z.spawn || (zw && zw.spawn) || { x: 0, z: 0, yaw: 0, pilot: { x: 0, z: 6 } };
    const gates = o.zone === 'race' ? ovalGates() : null;
    if (o.zone === 'tuwaiq') return tuwaiqFree(o, fpv, sp, Z);
    return {
      kind: 'free', id: 'free', key: 'free:' + o.airframe + ':' + o.zone + ':' + o.timeOfDay + ':' + o.wind, title: 'طيران حر', icon: '🕊️',
      sub: AF_AR[o.airframe] + ' • ' + ZONE_AR[o.zone] + ' • ' + TOD_AR[o.timeOfDay] + ' • ' + WIND_AR[o.wind],
      desc: 'طر براحتك بدون مهمة ولا درجة. تطلع من قائمة الإيقاف (START).' + (gates ? ' فيه بوابات سباق تقدر تدخل منها.' : ''),
      airframe: o.airframe, mode: fpv ? 'ANGLE' : 'P', wind: Object.assign({}, WINDS[o.wind]), fence: false, maxAlt: 120,
      timeOfDay: o.timeOfDay, zone: o.zone, thermal: true, aids: 'full', free: Object.assign({}, o),
      spawn: { x: sp.x, z: sp.z, yaw: sp.yaw || 0, pilot: sp.pilot ? { x: sp.pilot.x, z: sp.pilot.z } : { x: sp.x, z: sp.z + 6 } },
      pass: { total: 0 },
      tasks: [() => new FreeTask({ tour: Z.tour, gates, hint: gates ? 'طيران حر — حلبة السباق: ادخل البوابات بالترتيب 1 → 8. START = القائمة' : null })]
    };
  };

  // طيران حر حول أكاديمية طويق (خريطة Google الحقيقية 3D لو فيه نت + مفتاح، وإلا مجسم تقريبي) + منطقة حظر المطار
  function tuwaiqFree(o, fpv, sp, Z) {
    const TW = DS.TUWAIQ || {}, real = TW.realWorld || 'في الواقع: لازم تلتزم بأنظمة الهيئة العامة للطيران المدني (تسجيل الدرون وأخذ التصاريح) — هذا محاكي للتدريب';
    return {
      kind: 'free', id: 'free', key: 'free:' + o.airframe + ':tuwaiq:' + o.timeOfDay + ':' + o.wind, title: 'طيران حر — أكاديمية طويق', icon: '📍',
      sub: AF_AR[o.airframe] + ' • ' + ZONE_AR.tuwaiq + ' • ' + TOD_AR[o.timeOfDay] + ' • ' + WIND_AR[o.wind],
      desc: 'طِر حول مبنى أكاديمية طويق الحقيقي (الرياض). الطيران عادي حول الأكاديمية، ولو قربت من مطار الملك خالد الدولي (شمال) يطلع لك تحذير ومنطقة حظر مثل DJI. الحد 120 م. ' + real,
      airframe: o.airframe, mode: fpv ? 'ANGLE' : 'P', wind: Object.assign({}, WINDS[o.wind]), fence: false, maxAlt: TW.maxAlt || 120,
      timeOfDay: o.timeOfDay, zone: 'tuwaiq', geo: 'tuwaiq', thermal: false, aids: 'full', free: Object.assign({}, o),
      spawn: { x: sp.x, z: sp.z, yaw: sp.yaw || 0, pilot: sp.pilot ? { x: sp.pilot.x, z: sp.pilot.z } : { x: sp.x, z: sp.z + 8 } },
      brief: {
        goal: 'طيران حر حول أكاديمية طويق على خريطة حقيقية',
        steps: ['اقلع من الساحة اللي داخل المبنى وارتفع فوق السطح (المبنى تقريباً 18 م)', 'لف حول المبنى وصوّره (RB)', 'جرّب تروح شمال باتجاه المطار وشوف التحذير ومنطقة الحظر', 'ارجع وهبّط على المنصة'],
        realWorld: real, pass: 'طيران حر (بدون درجة)'
      },
      pass: { total: 0 },
      tasks: [() => new FreeTask({ tour: Z.tour, hint: '📍 أكاديمية طويق — طِر حول المبنى. المطار شمالك: لا تقرب • الحد 120 م • ☰ للقائمة', intro: '📍 ' + real })]
    };
  }

  // ---------------- تسجيل كل التمارين للاختبار الذاتي (DS.allDefs) ----------------
  const FREE_TEST = [
    { airframe: 'mini', zone: 'field', timeOfDay: 'day', wind: 'light' }, { airframe: 'fpv', zone: 'field', timeOfDay: 'sunset', wind: 'calm' },
    { airframe: 'mini', zone: 'city', timeOfDay: 'sunset', wind: 'light' }, { airframe: 'fpv', zone: 'city', timeOfDay: 'day', wind: 'light' },
    { airframe: 'mini', zone: 'race', timeOfDay: 'day', wind: 'calm' }, { airframe: 'fpv', zone: 'race', timeOfDay: 'night', wind: 'light' },
    { airframe: 'mini', zone: 'desert', timeOfDay: 'night', wind: 'strong' }, { airframe: 'fpv', zone: 'desert', timeOfDay: 'day', wind: 'strong' },
    { airframe: 'mini', zone: 'tuwaiq', timeOfDay: 'day', wind: 'light' }, { airframe: 'fpv', zone: 'tuwaiq', timeOfDay: 'sunset', wind: 'calm' }
  ];
  DS.proTestDefs = function () {
    const out = [];
    ORDER.forEach(id => { const d = DS.proDef(id, { seed: hashSeed('pro:' + id) }); if (d) out.push(d); });
    VARIANTS.forEach(v => { const d = DS.proDef(v.id, Object.assign({ seed: hashSeed('pro:' + v.id + '/' + v.tag) }, v.opts)); if (d) { d.key = 'pro:' + v.id + '/' + v.tag; out.push(d); } });
    FREE_TEST.forEach(o => out.push(DS.freeDef(o)));
    return out;
  };
  if (DS.registerDefs) DS.registerDefs(() => DS.proTestDefs());
  else { DS._defFns = DS._defFns || []; DS._defFns.push(() => DS.proTestDefs()); }
})();
