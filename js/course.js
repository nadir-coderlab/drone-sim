// الدورة التدريبية (مدرسة طيران): 15 وحدة، كل وحدة 3-5 دروس قصيرة + اختبار الوحدة (Check-ride)
// كل درس: شرح بسيط → خطوات موجهة (ظل العصا + صوت المدرب) → تمرين صغير → نجاح
// منطق بس: ما يلمس THREE ولا document ولا الصوت وقت التحميل (يشتغل في الفحص الذاتي بدون شاشة)
(function () {
  'use strict';
  const DS = window.DS, U = DS && DS.U;
  if (!DS || !U) return;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, PI = Math.PI;
  const clamp = U.clamp;
  const AXES = ['thr', 'yaw', 'pitch', 'roll'];
  const ZC = { thr: 0, yaw: 0, pitch: 0, roll: 0, throttle01: undefined, press: {} };
  const NOLOCK = { thr: false, yaw: false, pitch: false, roll: false };

  // ---------------- أسماء العصي (Mode 2 الافتراضي، و Mode 1) ----------------
  // {T} عصا الارتفاع/الثروتل، {P} قدام/ورا، {Y} اللف، {R} الجنب، {M} عصا الحركة (قدام/ورا/جنب)
  const NM = {
    2: { T: 'العصا اليسار', P: 'العصا اليمين', Y: 'العصا اليسار', R: 'العصا اليمين', M: 'العصا اليمين' },
    1: { T: 'العصا اليمين', P: 'العصا اليسار', Y: 'العصا اليسار', R: 'العصا اليمين', M: 'العصاتين (اليسار قدام/ورا واليمين جنب)' }
  };
  const smode = () => (DS.settings && DS.settings.stickMode === 1 ? 1 : 2);
  const TXC = {};
  // نص ثابت فيه {T}/{P}/{Y}/{R} → أسماء العصي (مع ذاكرة عشان ما نبني نص كل فريم)
  const tx = s => {
    if (!s) return '';
    if (s.indexOf('{') < 0) return s;
    const m = smode(), k = m + '|' + s;
    let r = TXC[k];
    if (r === undefined) { const N = NM[m]; r = TXC[k] = s.replace(/\{([TPYRM])\}/g, (_, c) => N[c]); }
    return r;
  };
  DS.courseText = tx;

  const MODE_LBL = { C: 'C', P: 'N', S: 'S', A: 'ATTI', M: 'M', ANGLE: 'Angle', HORIZON: 'Horizon', ACRO: 'Acro' };
  const modeOrder = d => (DS.modeOrder ? DS.modeOrder(d.airframe) : (d.airframe === 'fpv' ? ['ANGLE', 'HORIZON', 'ACRO'] : ['C', 'P', 'S']));
  function modeHow(d, want) {
    if (want === 'A' || d.mode === 'A') return 'اضغط السهم اليسار ◀';
    const o = modeOrder(d), i = o.indexOf(d.mode), j = o.indexOf(want);
    return j > i ? 'اضغط السهم فوق ▲' : 'اضغط السهم تحت ▼';
  }

  // ---------------- توجيهات الطيار الآلي (نفس مفردات autopilot.js) — كائنات ثابتة ما تنبني كل فريم ----------------
  const GN = { none: true }, GD = { descend: true }, GA = { holdA: true }, GR0 = { raw: {} };
  const RAW_CSC = { raw: { thr: -1, pitch: -1, yaw: 1, roll: -1 } };
  const RAW_THRDN = { raw: { thr: -1 } };
  const PRESS = {}, HOLD = {};
  const press = b => PRESS[b] || (PRESS[b] = { press: { [b]: true } });
  const holdBtn = (b, sec) => { const k = b + sec; return HOLD[k] || (HOLD[k] = { hold: { [b]: sec } }); };
  // روح لنقطة (يعاد استخدام نفس الكائن)
  function gpos(st, x, z, alt, speed, yaw, vdown) {
    const g = st._g || (st._g = { x: 0, z: 0, alt: 0, speed: 3, yaw: null, vdown: null });
    g.x = x; g.z = z; g.alt = alt; g.speed = speed || 3; g.yaw = yaw == null ? null : yaw; g.vdown = vdown || null;
    return g;
  }
  function graw(st) {
    const g = st._r || (st._r = { raw: { thr: 0, yaw: 0, pitch: 0, roll: 0, lt: 0, rt: 0 }, shutter: false });
    const r = g.raw; r.thr = 0; r.yaw = 0; r.pitch = 0; r.roll = 0; r.lt = 0; r.rt = 0; g.shutter = false;
    return g;
  }
  function modeGuide(d, want) {
    if (d.mode === want) return null;
    if (want === 'A' || d.mode === 'A') return press('LEFT');
    const o = modeOrder(d), i = o.indexOf(d.mode), j = o.indexOf(want);
    return press(j > i ? 'UP' : 'DOWN');
  }
  // لف ناعم: الهدف ما يبعد أكثر من lim عن الاتجاه الحالي (عشان المحترف ما يدف العصا للآخر)
  const carrot = (d, yaw, lim) => { lim = lim || 0.3; return U.wrap(d.yaw + clamp(U.wrap(yaw - d.yaw), -lim, lim)); };

  // ---------------- أدوات الفحص ----------------
  const ctl = ctx => ctx.controls || ZC;
  const C = DS.CourseCheck = {
    air: (d, h) => !d.onGround && d.motors && d.p.y >= (h || 0.3),
    hd: (d, x, z) => U.dist2(d.p.x, d.p.z, x, z),
    hs: d => Math.hypot(d.v.x, d.v.z),
    centred: (c, tol) => Math.abs(c.thr || 0) < tol && Math.abs(c.yaw || 0) < tol && Math.abs(c.pitch || 0) < tol && Math.abs(c.roll || 0) < tol,
    rightCentred: (c, tol) => Math.abs(c.pitch || 0) < tol && Math.abs(c.roll || 0) < tol,
    altIn: (d, alt, tol) => !d.onGround && Math.abs(d.p.y - alt) <= tol,
    at: (d, x, z, alt, r, vtol) => !d.onGround && U.dist2(d.p.x, d.p.z, x, z) <= r && Math.abs(d.p.y - alt) <= vtol,
    headErr: (d, yaw) => Math.abs(U.wrap(yaw - d.yaw)),
    toPilot: d => U.bearing(d.p.x, d.p.z, DS.PILOT.x, DS.PILOT.z),
    fromPilot: d => U.bearing(DS.PILOT.x, DS.PILOT.z, d.p.x, d.p.z),
    up: d => 1 - 2 * (d.q.x * d.q.x + d.q.z * d.q.z),         // مركّبة "فوق" حق الدرون في العالم (1 = مستوي، -1 = مقلوب)
    noseIn: (d, tolDeg) => Math.abs(U.wrap(U.bearing(d.p.x, d.p.z, DS.PILOT.x, DS.PILOT.z) - d.yaw)) < (tolDeg || 50) * D2R,
    fpv: d => !!(d.profile && d.profile.kind === 'fpv')
  };
  // اتجاه التصحيح: بالنسبة لوجه الدرون (للعصا) وبالنسبة لعينك
  function dirWords(cx, cz, d) {
    const yaw = d.yaw, f = cx * Math.sin(yaw) - cz * Math.cos(yaw), r = cx * Math.cos(yaw) + cz * Math.sin(yaw);
    const N = NM[smode()];
    const fb = Math.abs(f) >= Math.abs(r);
    const stick = fb ? N.P + ' ' + (f > 0 ? 'لقدام' : 'لورا') : N.R + ' ' + (r > 0 ? 'يمين' : 'يسار');
    const P = DS.PILOT;
    const b = U.dist2(P.x, P.z, d.p.x, d.p.z) < 2 ? 0 : U.bearing(P.x, P.z, d.p.x, d.p.z);
    const pf = cx * Math.sin(b) - cz * Math.cos(b), pr = cx * Math.cos(b) + cz * Math.sin(b);
    const view = Math.abs(pf) >= Math.abs(pr) ? (pf > 0 ? 'بعيد عنك' : 'صوبك') : (pr > 0 ? 'على يمينك' : 'على يسارك');
    return { stick, view };
  }

  // ======================================================================
  // المدرب (Coach): يراقب يدك والدرون ويعطيك نصيحة وحدة كل شوي (مع فترات انتظار)
  // update(dt, ctx, opts?) → يكتب session.coach = {text, kind, t, spoken:false, rule}
  // opts: {rules[], gentle, beginner, alt, altTol, target:{x,z}, wantMode, lock, drift, combo, ghostR}
  // ======================================================================
  const CT = {
    overcorrect: ['لا تلاحق الدرون! حركات صغيرة وخله يهدأ', 'تصحيحك كثير رايح جاي — حرّك شوي واستنى ثانية', 'هدّي يدك: التصحيح القوي يزيد التمايل'],
    slam: ['بشويش على العصا! حركة صغيرة تكفي', 'لا تدف العصا للآخر — ربع أو نص الطريق بس', 'الحركة القوية المفاجئة خطر — خلها ناعمة'],
    multistick: ['حرّك عصا وحدة بس في هالمرحلة', 'وحدة وحدة: لا تحرك العصاتين مع بعض الحين'],
    nosein: ['انتبه: وجهه لك — يمين ويسار معكوسة!', 'الدرون رايح بعكس اللي تبيه: وجهه لك، فالعصا يمين = يروح يسارك', 'وجهه لك: تخيل نفسك راكب فيه — يمينه هو يسارك'],
    fastdescent: ['بشويش! قريب من الأرض — خفف النزول', 'نزولك سريع وأنت قريب من الأرض! خفف'],
    thrdown: ['لا تخلي {T} تحت للآخر وهو طاير — نزّل بهدوء', 'العصا تحت للآخر في الجو = نزول سريع. خففها'],
    thrdownF: ['الثروتل تحت للآخر! الدرون يطيح — ارفعه شوي', 'لا تقطع الثروتل وأنت قريب من الأرض'],
    vrs: ['الدرون يرتج! هذي دوامة المراوح — دفه لقدام أو جنب عشان يطلع منها', 'دوامة المراوح (VRS)! لا تنزل عمودي بسرعة — حركه لجنب'],
    wind: ['الريح قوية هنا! نزّل لارتفاع أقل (الريح تحت أخف)', 'ريح قوية: خلك قريب ونزّل الارتفاع، ولو ما يتقدم حوّل S'],
    far: ['بعدت كثير! رجّعه قريب عشان تشوفه زين', 'خل الدرون قريب منك — المبتدئ يطير قريب'],
    obstacle: ['انتبه! فيه شي قريب من الدرون', 'عائق قريب! وقّف وابعد عنه'],
    b30: 'البطارية 30%: وقت الرجوع للبيت', b15: 'البطارية حرجة! نزّل الحين', bF: 'البطارية ضعيفة — نزّل الحين وطفّ المحركات (DISARM)'
  };
  const STYLE = { overcorrect: 1, slam: 1, multistick: 1, nosein: 1, altitude: 1, drift: 1 };
  const DEF_RULES = ['overcorrect', 'slam', 'drift', 'altitude', 'nosein', 'fastdescent', 'thrdown', 'mode', 'wind', 'battery', 'vrs', 'obstacle', 'far'];
  const CHECK_RULES = ['fastdescent', 'battery', 'wind', 'vrs'];
  const DEF_OPTS = { rules: DEF_RULES, gentle: true, beginner: false };
  const pickV = (a, n) => tx(a[(n || 0) % a.length]);
  const hasR = (R, k) => R.indexOf(k) >= 0;
  const snap = v => (Math.abs(v || 0) < 0.06 ? 0 : clamp(v || 0, -1, 1));
  const mkFl = () => ({ s: 0, i: 0, ts: new Float64Array([-99, -99, -99, -99, -99, -99]) });

  class Coach {
    constructor(opts) { this.opts = opts || null; this.reset(); }
    reset() {
      this.cool = {}; this.cnt = {}; this.tm = {}; this.once = {};
      this.lastT = -99; this.sayT = -99; this.styleCount = 0; this.total = 0;
      this.fl = { thr: mkFl(), yaw: mkFl(), pitch: mkFl(), roll: mkFl() };
      this.lowT = { thr: 0, yaw: 0, pitch: 0, roll: 0 };   // آخر وقت كانت العصا تحت النص (لكشف الضربة المفاجئة)
    }
    quiet(t) { this.sayT = t; }   // المدرب يسكت شوي بعد ما يتكلم الدرس
    _flip(a, v, t) {
      const F = this.fl[a], sg = v > 0.18 ? 1 : v < -0.18 ? -1 : 0;
      if (sg && F.s && sg !== F.s) { F.ts[F.i] = t; F.i = (F.i + 1) % 6; }
      if (sg) F.s = sg;
      let n = 0; for (let i = 0; i < 6; i++) if (t - F.ts[i] < 1.2) n++;
      if (n >= 4) { for (let i = 0; i < 6; i++) F.ts[i] = -99; return true; }
      return false;
    }
    _t(k, on, dt) { const v = on ? (this.tm[k] || 0) + dt : 0; this.tm[k] = v; return v; }
    emit(s, rule, text, kind, cool, t) {
      const last = this.cool[rule] != null ? this.cool[rule] : -99;
      if (t - last < cool) return false;
      const urgent = kind === 'bad';
      if (!urgent && (t - this.lastT < 3.5 || t - this.sayT < 2.5)) return false;
      this.cool[rule] = t; this.lastT = t; this.cnt[rule] = (this.cnt[rule] || 0) + 1; this.total++;
      if (STYLE[rule]) this.styleCount++;
      s.coach = { text, kind: kind || 'warn', t, spoken: false, rule };
      return true;
    }
    update(dt, ctx, opts) {
      const s = ctx && ctx.session, d = ctx && ctx.drone;
      if (!s || !d || d.crashed) return null;
      opts = opts || this.opts || (s.task && s.task.coachOpts) || DEF_OPTS;
      const R = opts.rules || DEF_RULES, c = ctx.controls || ZC, t = s.t, lk = opts.lock || NOLOCK;
      const air = d.motors && !d.onGround, fpv = C.fpv(d), N = NM[smode()];
      // 1) تصحيح زايد: العصا تقلب إشارتها أكثر من 3 مرات بالثانية
      if (air && hasR(R, 'overcorrect')) {
        let hit = false;
        for (let i = 0; i < 4; i++) { const a = AXES[i]; if (!lk[a] && this._flip(a, +c[a] || 0, t)) hit = true; }
        if (hit) this.emit(s, 'overcorrect', pickV(CT.overcorrect, this.cnt.overcorrect), 'warn', 10, t);
      }
      // 2) ضرب العصا للآخر فجأة في درس يبي نعومة: من أقل من النص لآخرها خلال 0.15 ث (الدفة الكاملة بنعومة عادي)
      if (hasR(R, 'slam')) {
        const lo = this.lowT;
        let hit = false;
        for (let i = 0; i < 4; i++) {
          const a = AXES[i], v = Math.abs(+c[a] || 0);
          if (v < 0.5) lo[a] = t;
          else if (v > 0.95 && !lk[a] && t - lo[a] <= 0.15) { hit = true; lo[a] = -99; }   // مرة وحدة لكل دفة
        }
        if (hit && air && opts.gentle) this.emit(s, 'slam', pickV(CT.slam, this.cnt.slam), 'warn', 10, t);
      }
      // 3) مبتدئ يحرك أكثر من عصا
      if (air && opts.beginner && !opts.combo && hasR(R, 'multistick')) {
        let n = 0; for (let i = 0; i < 4; i++) { const a = AXES[i]; if (!lk[a] && Math.abs(+c[a] || 0) > 0.3) n++; }
        if (this._t('multi', n >= 2, dt) > 0.6) this.emit(s, 'multistick', pickV(CT.multistick, this.cnt.multistick), 'warn', 12, t);
      }
      // 4) انجراف ما انصحح (ATTI أو اضطراب): وين تدف العصا — بالنسبة لوجه الدرون ولعينك
      if (air && !d.auto && hasR(R, 'drift')) {
        const atti = d.effMode && d.effMode() === 'A', hs = C.hs(d);
        const on = (atti || opts.drift) && C.rightCentred(c, 0.08) && hs > (atti ? 0.5 : fpv ? 0.8 : 0.35);
        if (this._t('drift', on, dt) > 1.0) {
          const w = dirWords(-d.v.x, -d.v.z, d);
          this.emit(s, 'drift', 'الدرون ينجرف! ادفع ' + w.stick + ' شوي (يعني يروح ' + w.view + ')', 'warn', 8, t);
        }
      }
      // 5) الارتفاع يتغير وما أحد يصححه
      if (air && opts.alt != null && !d.auto && !lk.thr && hasR(R, 'altitude')) {   // عصا الارتفاع مقفولة = ما يقدر يصححه
        const e = d.p.y - opts.alt, tol = opts.altTol || 1;
        const wander = (e > tol && d.v.y > -0.2) || (e < -tol && d.v.y < 0.2);
        if (this._t('alt', wander, dt) > 2) {
          this.emit(s, 'altitude', (e < 0 ? 'الارتفاع نازل! ارفع ' : 'الارتفاع زايد! نزّل ') + N.T + ' شوي لين ' + Math.round(opts.alt) + ' م', 'warn', 9, t);
        }
      }
      // 6) الوجه لك وتحرك بالعكس (الدرون يبعد عن الهدف)
      if (air && opts.target && hasR(R, 'nosein')) {
        const T = opts.target, dx = T.x - d.p.x, dz = T.z - d.p.z, dist = Math.hypot(dx, dz);
        let rev = false;
        if (C.noseIn(d, 50) && dist > 2) {
          const act = (!lk.roll && Math.abs(c.roll || 0) > 0.25) || (!lk.pitch && Math.abs(c.pitch || 0) > 0.25);
          const vt = (d.v.x * dx + d.v.z * dz) / dist;
          rev = act && vt < -0.4;
          const G = opts.ghostR;   // ظل المدرب: العصا عكس اللي يبيه المدرب
          if (!rev && G && Math.abs(G.x) > 0.25 && Math.abs(c.roll || 0) > 0.25 && Math.sign(G.x) !== Math.sign(c.roll)) rev = true;
        }
        if (this._t('nosein', rev, dt) > 0.7) this.emit(s, 'nosein', pickV(CT.nosein, this.cnt.nosein), 'warn', 10, t);
      }
      // 7) نزول سريع قرب الأرض
      if (air && !d.auto && hasR(R, 'fastdescent')) {
        const y = d.p.y;
        if ((y < 5 && d.v.y < -2.4) || (y < 1.3 && d.v.y < -0.85)) this.emit(s, 'fastdescent', pickV(CT.fastdescent, this.cnt.fastdescent), 'bad', 5, t);
      }
      // 8) العصا (الثروتل) تحت للآخر وهو طاير
      if (air && !d.auto && hasR(R, 'thrdown')) {
        const t01 = c.throttle01 != null ? c.throttle01 : d.throttle;
        const low = fpv ? (t01 != null && t01 < 0.06 && d.p.y > 2) : ((c.thr || 0) < -0.8 && d.p.y > 1.5);
        if (this._t('thr', low, dt) > (fpv ? 1.2 : 2.5)) this.emit(s, 'thrdown', pickV(fpv ? CT.thrdownF : CT.thrdown, this.cnt.thrdown), 'warn', 8, t);
      }
      // 9) الوضع غلط للمهمة
      if (opts.wantMode && hasR(R, 'mode')) {
        const bad = air && d.mode !== opts.wantMode;
        if (this._t('mode', bad, dt) > 3) this.emit(s, 'mode', 'هنا نحتاج وضع ' + (MODE_LBL[opts.wantMode] || opts.wantMode) + ' — ' + modeHow(d, opts.wantMode), 'warn', 10, t);
      }
      // 10) الريح قوية (نفحص مرة بالثانية)
      if (air && hasR(R, 'wind') && ctx.env && ctx.env.wind && ctx.env.wind.info) {
        this.tm.windT = (this.tm.windT || 0) + dt;
        if (this.tm.windT > 1) {
          this.tm.windT = 0;
          const wi = ctx.env.wind.info(d.p.y), lim = ((d.profile && d.profile.windMax) || 14) * 0.75;
          if (wi && wi.speed > lim) this.emit(s, 'wind', pickV(CT.wind, this.cnt.wind), 'warn', 30, t);
        }
      }
      // 11) البطارية
      if (d.motors && hasR(R, 'battery')) {
        const b = d.battery != null ? d.battery : 100;
        if (fpv) { if (b <= 22 && !this.once.bF) { this.once.bF = 1; this.emit(s, 'battery', CT.bF, 'bad', 0, t); } }
        else if (b <= 15 && !this.once.b15) { this.once.b15 = 1; this.once.b30 = 1; this.emit(s, 'battery', CT.b15, 'bad', 0, t); }
        else if (b <= 30 && !this.once.b30) { this.once.b30 = 1; this.emit(s, 'battery', CT.b30, 'bad', 0, t); }
      }
      // 12) دوامة المراوح / عائق / بعيد
      if (air && d.vrs && hasR(R, 'vrs')) this.emit(s, 'vrs', pickV(CT.vrs, this.cnt.vrs), 'bad', 6, t);
      if (air && hasR(R, 'obstacle') && d.obstacle && d.obstacle.dist < 4) this.emit(s, 'obstacle', pickV(CT.obstacle, this.cnt.obstacle), 'bad', 8, t);
      if (air && opts.beginner && hasR(R, 'far') && U.dist2(d.p.x, d.p.z, DS.PILOT.x, DS.PILOT.z) > 70) this.emit(s, 'far', pickV(CT.far, this.cnt.far), 'warn', 20, t);
      return s.coach;
    }
    // نصايح آخر الدرس من اللي تكرر
    tips() {
      const n = this.cnt, out = [];
      if ((n.overcorrect || 0) >= 2) out.push('كثرت التصحيحات: حركات أصغر واستنى الدرون يستجيب');
      if ((n.slam || 0) >= 2) out.push('خل حركة العصي ناعمة: نص الطريق أو أقل');
      if ((n.nosein || 0) >= 1) out.push('تدرب أكثر على "وجهه لك": اليمين واليسار معكوسة');
      if ((n.drift || 0) >= 2) out.push('صحح الانجراف بدري: أول ما تشوفه يتحرك ادفع العصا عكسه شوي');
      if ((n.altitude || 0) >= 2) out.push('انتبه للارتفاع (H) وأنت تتحرك');
      if ((n.fastdescent || 0) >= 1) out.push('آخر مترين قبل الأرض: نزول بطيء جداً');
      return out;
    }
  }
  DS.Coach = Coach;

  // ---------------- مدير أخطاء احتياطي (لو scoring.js مو موجود) — نفس قواعد GVC 7/3/1 ----------------
  function localFM() {
    return {
      minor: 0, major: 0, safety: 0, log: [], local: true,
      add(cls, code, t) { if (this[cls] == null) return; this[cls]++; this.log.push({ cls, code, t }); },
      get failed() { return this.safety > 0 || this.minor >= 7 || this.major >= 3; },
      toJSON() { return { minor: this.minor, major: this.major, safety: this.safety, log: this.log.slice() }; }
    };
  }
  // مراقبة حدود الاختبار: أقصر طلعة تنحسب (ث) + كم لازم يرجع داخل عشان تنقفل الطلعة (ث)
  const EX_MIN_T = 1.0, EX_REARM = 1.0;
  const FT = {
    band: 'طلعت عن الحدود', slow: 'تأخرت', wrong: 'حركت العصا الغلط', land: 'الهبوط بعيد عن النص', hard: 'هبوط قوي',
    bounce: 'الدرون نطّ وهو يهبط', mode: 'الوضع غلط', gate: 'فاتتك بوابة', keepout: 'قربت كثير من الهدف', vrs: 'دخلت دوامة المراوح',
    photo: 'الصورة مو في النص', side: 'لمس الأرض وهو ماشي على جنب', decide: 'قرار غلط', late: 'تأخرت في التصرف', low: 'نزلت واطي كثير', head: 'اتجاه الوجه غلط', alt: 'الارتفاع طلع عن الحد'
  };

  // ---------------- الأساس ----------------
  const Base = DS.Task || class {
    constructor(o) { this.o = o; this.title = o.title; this.short = o.short || o.title; this.desc = ''; this.t = 0; this.state = 'run'; this.failReason = ''; this.hint = ''; this.progress = 0; this.tl = o.timeLimit || 240; this.decision = null; }
    begin() { this.t = 0; }
    score() { return 0; } guide() { return null; } map() { return []; } feedback() { return []; }
    end(ctx) { ctx.R.clear(this); }
    fail(r) { if (this.state === 'run') { this.state = 'fail'; this.failReason = r; } }
  };
  function mkDecision(dc, ctx) {
    const n = dc.a.length, idx = [];
    for (let i = 0; i < n; i++) idx.push(i);
    const rnd = (ctx && ctx.rng) || Math.random;
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), k = idx[i]; idx[i] = idx[j]; idx[j] = k; }
    return { q: dc.q, a: idx.map(i => dc.a[i]), c: idx.indexOf(0), ex: dc.ex || '', lang: 'ar', chosen: -1 };
  }

  // ======================================================================
  // LessonTask: يشغل خطوات الدرس
  // step = {say, text, live(ctx,st), hint:{L,R}|fn, check(ctx,st), hold, accumulate, tick(ctx,st,dt,T), guide(ctx,st,T),
  //         coach:[], lock:[], groundLock, gentle, combo, alt, altTol, target, wantMode, drift, band, decide, embed, pause,
  //         enter, exit, limit, failMsg, onCallout, onShutter, reticle, short}
  // ======================================================================
  class LessonTask extends Base {
    constructor(L, opts) {
      super({ title: L.title, short: L.short || L.title, timeLimit: L.timeLimit || (L.check ? 900 : 99999) });
      this.L = L; this.opts = opts || {}; this.demoMode = !!this.opts.demo; this.isCheck = !!L.check;
      this.kind = 'course'; this.lessonId = L.id;
      this.coachRef = new Coach();
      this.coachOpts = { rules: DEF_RULES, gentle: true, beginner: false, alt: null, altTol: 1, target: null, wantMode: null, lock: null, drift: false, combo: false, ghostR: null };
      this._hint = { L: null, R: null, text: '' };
      this._lock = { thr: false, yaw: false, pitch: false, roll: false };
      this._gl = { x: 0, y: 0 }; this._gr = { x: 0, y: 0 }; this._gT = 0; this._gOk = false; this._inst = null;
      this._gdec = { decide: null };
      this._mapAll = []; this.reticle = null;
    }
    begin(ctx) {
      super.begin(ctx);
      const L = this.L;
      this.steps = typeof L.steps === 'function' ? L.steps(ctx) : L.steps;
      this.st = {
        t: 0, k: 0, stepT: 0, held: 0, pen: 0, dec: [], map: [], pmap: [], vis: [], data: {}, tips: [], sub: null, subScores: [],
        demoWait: 0, bandIn: false, ex: { t: 0, max: 0, counted: null, inT: 0, code: null }, p0: { x: 0, y: 0, z: 0 }, text: '', textT: 0, cd: -1, colN: 0
      };
      this.fm = ctx.faults || (this.isCheck ? localFM() : null);
      this.ownFm = !ctx.faults;
      this.coachRef.reset();
      const sess = ctx.session;
      // وقفات الشرح في العرض: لو الدرس مبني بـ {demo:true} أو الجلسة عرض حقيقي (مو فحص ذاتي)
      this.demoMode = !!this.opts.demo || !!(sess && sess.demo && !sess.headless);
      this.useGhost = L.ghost !== false && !this.isCheck && !!DS.Autopilot && !(sess && (sess.headless || sess.demo));
      if (L.pads) L.pads.forEach(p => { this.vis(ctx, { type: 'pad', x: p.x, z: p.z, r: p.r || 1, label: p.label || '' }, true); this.mapAdd({ kind: 'pad', x: p.x, z: p.z, r: p.r || 1, label: p.label || 'H', state: 'next' }, true); });
      if (L.setup) L.setup(ctx, this.st, this);
      this.enter(ctx);
    }
    // ---- رسومات ونقاط الخريطة: الخطوة (تنمسح بعدها) أو الدرس كله (persist)
    vis(ctx, spec, persist) { const h = ctx.R.add(this, spec); if (!persist) this.st.vis.push(h); return h; }
    mapAdd(item, persist) { (persist ? this.st.pmap : this.st.map).push(item); this._mapDirty = true; return item; }
    clearStep() {
      const st = this.st;
      for (let i = 0; i < st.vis.length; i++) { try { st.vis[i].remove(); } catch (e) { /* */ } }
      st.vis.length = 0; st.map.length = 0; this._mapDirty = true; this.reticle = null;
    }
    tip(t) { const a = this.st.tips; if (a.indexOf(t) < 0) a.push(t); }
    say(ctx, text, kind) {
      const s = ctx.session; if (!s || !text) return;
      s.coach = { text, kind: kind || 'say', t: s.t, spoken: false, rule: 'step' };
      this.coachRef.quiet(s.t);
    }
    fault(ctx, cls, code) {
      if (!this.fm) return;
      const t = ctx.session ? ctx.session.t : this.t;
      try { this.fm.add(cls, code, t, FT[code] || code); } catch (e) { /* */ }
      if (ctx.msg) ctx.msg('⚠️ ' + (FT[code] || code) + ' — ' + (cls === 'minor' ? 'خطأ بسيط' : cls === 'major' ? 'خطأ كبير' : 'خطأ أمان'), 'bad');
    }
    get step() { return this.steps[this.st.k]; }
    enter(ctx) {
      const st = this.st, s = this.steps[st.k], d = ctx.drone;
      if (this.isCheck && st.ex.t > 0 && st.ex.inT > 0) this.closeEx(ctx, st.ex.code);   // طلعة رجعت داخل قبل ما تخلص الخطوة: تنحسب
      st.stepT = 0; st.runT = 0; st.held = 0; st.bandIn = false; st.ex.t = 0; st.ex.max = 0; st.ex.counted = null; st.ex.inT = 0; st.cd = -1; st.textT = 99;
      st.p0.x = d.p.x; st.p0.y = Math.max(d.p.y, 1.5); st.p0.z = d.p.z;
      if (!s) return;
      st.colN = ctx.env && ctx.env.taskColliders ? ctx.env.taskColliders.length : 0;
      if (s.enter) s.enter(ctx, st, this);
      if (s.embed) { st.sub = s.embed(ctx, st, this); st.sub.begin(ctx); }
      if (s.decide) this.decision = mkDecision(s.decide, ctx);
      if (s.reticle != null) this.reticle = s.reticle;
      st.demoWait = this.demoMode && !s.decide ? (s.pause != null ? s.pause : 2.2) : 0;
      const say = typeof s.say === 'function' ? s.say(ctx, st, this) : s.say;   // say ممكن يكون دالة (حسب الدرون)
      st.text = tx(typeof s.text === 'string' ? s.text : (say || ''));
      st.stickTxt = s.short ? tx(s.short) : '';
      if (say) this.say(ctx, tx(say), s.kind || 'say');
      this.hint = st.text;
    }
    next(ctx) {
      const st = this.st, s = this.steps[st.k];
      if (st.sub) {
        try { st.sub.end(ctx); } catch (e) { /* */ }
        st.sub = null;
        // نشيل عوائق المهمة المضمّنة (بوابات/عواميد) عشان ما تصدم فيها بعدين
        const tc = ctx.env && ctx.env.taskColliders; if (tc && s && s.embed && !s.keepColliders && tc.length > st.colN) tc.length = st.colN;
      }
      if (s && s.exit) s.exit(ctx, st, this);
      this.clearStep();
      st.k++;
      if (st.k >= this.steps.length) { this.state = 'done'; this.progress = 1; this.releaseLock(ctx); return; }
      if (s && !s.decide && ctx.stepDone) ctx.stepDone();
      this.enter(ctx);
    }
    answer(k) {
      const dc = this.decision;
      if (!dc || dc.chosen >= 0) return;
      dc.chosen = k; this.st.dec.push(k === dc.c);
      if (this.isCheck && k !== dc.c && this._ctx0) this.fault(this._ctx0, 'major', 'decide');
      if (DS.Audio) { try { if (k === dc.c) DS.Audio.ok(); else DS.Audio.fail(); } catch (e) { /* */ } }
    }
    ack(ctx) { if (this.decision && this.decision.chosen >= 0) { this.decision = null; this.next(ctx); } }
    onCallout(ctx) { const st = this.st, s = this.steps[st.k]; st.data.ack = true; if (s && s.onCallout) s.onCallout(ctx, st, this); if (st.sub && st.sub.onCallout) st.sub.onCallout(ctx); }
    onShutter(ctx) { const st = this.st, s = this.steps[st.k]; if (st.sub && st.sub.onShutter) st.sub.onShutter(ctx); if (s && s.onShutter) s.onShutter(ctx, st, this); }
    // ---- قفل العصي اللي ما نتعلمها الحين (session.axisLock — CORE2)
    applyLock(ctx, s) {
      const sess = ctx.session, d = ctx.drone, lk = this._lock;
      const list = s && s.lock !== undefined ? s.lock : this.L.lock;
      let any = false;
      for (let i = 0; i < 4; i++) {
        const a = AXES[i];
        let on = !!(list && list.indexOf(a) >= 0);
        // على الأرض: نفك القفل عشان تقدر تشغل المحركات (CSC) وتقلع — إلا تمارين العصي (groundLock)
        if (on && d.onGround && !(s && s.groundLock)) { if (!d.motors || a === 'thr') on = false; }
        if (on && d.auto) on = false;
        lk[a] = on; if (on) any = true;
      }
      if (sess) sess.axisLock = any ? lk : null;
    }
    releaseLock(ctx) { const s = ctx.session; if (s) { if (s.axisLock === this._lock) s.axisLock = null; if (s.stickHint === this._hint) s.stickHint = null; } }
    update(dt, ctx) {
      this._ctx0 = ctx;
      if (this.decision || this.state !== 'run') return;
      const st = this.st, s = this.steps[st.k];
      this.t += dt; st.t += dt; st.stepT += dt;
      if (!s) { this.state = 'done'; return; }
      this.applyLock(ctx, s);
      if (this.L.always) { const r = this.L.always(ctx, st, dt, this); if (r && r.indexOf && r.indexOf('fail:') === 0) return this.fail(r.slice(5)); }
      this.coachUpdate(dt, ctx, s);
      if (this.isCheck && s.band) this.monitor(dt, ctx, s);
      if (this.fm && this.ownFm && this.fm.failed) return this.fail('تعديت حد الأخطاء المسموح');
      if (this.state !== 'run') return;
      this.hintUpdate(dt, ctx, s);
      // FPV انقلب على ظهره (CRASH FLIP): نوقف الخطوة لين يرجع
      const dr = ctx.drone;
      if (dr.turtle) {
        if (!st.data.turtleSaid) { st.data.turtleSaid = true; this.say(ctx, 'الدرون انقلب على ظهره! اضغط A مطوّل عشان يرجع على رجوله (Turtle)', 'bad'); }
        this.hint = 'انقلب: اضغط A مطوّل (CRASH FLIP)'; return;
      } else st.data.turtleSaid = false;
      if (st.demoWait > 0) { st.demoWait -= dt; this.textUpdate(dt, ctx, s); return; }
      st.runT += dt;   // وقت الخطوة بعد وقفة الشرح
      let res = null;
      if (st.sub) {
        st.sub.update(dt, ctx);
        if (st.sub.state === 'done') { st.subScores.push(st.sub.score()); const fb = st.sub.feedback() || []; for (let i = 0; i < fb.length; i++) this.tip(fb[i]); res = 'next'; }
        else if (st.sub.state === 'fail') return this.fail(st.sub.failReason || 'ما خلصت');
      }
      if (!res && s.tick) res = s.tick(ctx, st, dt, this);
      if (!res && s.check) {
        if (s.check(ctx, st, this)) { st.held += dt; if (st.held >= (s.hold || 0)) res = 'next'; }
        else if (!s.accumulate) st.held = 0;
      }
      if (res === 'next') return this.next(ctx);
      if (res && res.indexOf('fail:') === 0) return this.fail(res.slice(5));
      if (s.limit && st.stepT > s.limit) return this.fail(s.failMsg || 'خلص الوقت');
      this.textUpdate(dt, ctx, s);
      if (this.t > this.tl) this.fail('خلص الوقت');
    }
    textUpdate(dt, ctx, s) {
      const st = this.st, n = this.steps.length;
      const pr = st.sub ? clamp(st.sub.progress || 0, 0, 1) : s.hold ? Math.min(1, st.held / s.hold) : 0;
      this.progress = (st.k + pr) / n;
      st.textT += dt;
      if (st.textT < 0.12) return;
      st.textT = 0;
      if (st.sub) { this.hint = st.sub.hint || st.text; return; }
      let h = typeof s.text === 'function' ? s.text(ctx, st, this) : st.text;
      if (s.live) { const lv = s.live(ctx, st, this); if (lv) h = h + ' — ' + lv; }
      if (s.hold && s.hold >= 1.5 && st.held > 0) h += ' (' + Math.max(0, Math.ceil(s.hold - st.held)) + ')';
      this.hint = h;
    }
    coachUpdate(dt, ctx, s) {
      const o = this.coachOpts, L = this.L;
      o.rules = s.coach || L.coach || (this.isCheck ? CHECK_RULES : DEF_RULES);
      o.gentle = s.gentle != null ? s.gentle : L.gentle !== false;
      o.beginner = !!L.beginner; o.combo = !!s.combo; o.drift = !!s.drift;
      o.alt = s.alt != null ? s.alt : null; o.altTol = s.altTol || 1.0;
      o.target = s.target || null; o.wantMode = s.wantMode || null; o.lock = this._lock;
      o.ghostR = this._gOk && this.useGhost ? this._gr : null;
      this.coachRef.update(dt, ctx, o);
    }
    // ---- الظل: من الخطوة نفسها، أو من "يد المدرب" (طيار آلي ثاني يحسب العصي المثالية)
    hintUpdate(dt, ctx, s) {
      const sess = ctx.session; if (!sess) return;
      const h = this._hint, st = this.st, lk = this._lock;
      let L = null, R = null;
      const sh = typeof s.hint === 'function' ? s.hint(ctx, st, this) : s.hint;
      if (sh) { L = sh.L || null; R = sh.R || null; }
      else if (sh !== null && this.useGhost && s.ghost !== false && this.ghost(dt, ctx)) { L = this._gl; R = this._gr; }
      if (L && lk.thr && lk.yaw) L = null;
      if (R && lk.pitch && lk.roll) R = null;
      h.L = L; h.R = R; h.text = st.stickTxt || '';
      sess.stickHint = (L || R || h.text) ? h : null;
    }
    ghost(dt, ctx) {
      this._gT += dt;
      if (this._gOk && this._gT < 1 / 30) return true;
      const dtg = Math.min(0.2, this._gT); this._gT = 0;
      if (!this._inst) { try { this._inst = new DS.Autopilot(true); } catch (e) { this.useGhost = false; return false; } }
      let o;
      try { o = this._inst.compute(dtg, ctx.session); } catch (e) { this.useGhost = false; return false; }
      if (!o) return false;
      const k = 1 - Math.exp(-dtg * 10), sn = snap;
      const gl = this._gl, gr = this._gr;
      gl.x += (sn(o.yaw) - gl.x) * k; gl.y += (sn(o.thr) - gl.y) * k;
      gr.x += (sn(o.roll) - gr.x) * k; gr.y += (sn(o.pitch) - gr.y) * k;
      this._gOk = true;
      return true;
    }
    // ---- أخطاء الاختبار: برا الحدود ثانيتين أو ضعف الحد = كبير، ثانية أو أكثر = بسيط، والهزة الأقصر من ثانية ما تنحسب.
    // طلعة ثانية خلال ثانية من الرجوع = نفس الطلعة (ما تنحسب مرتين)
    monitor(dt, ctx, s) {
      const b = typeof s.band === 'function' ? s.band(ctx, this.st) : s.band;
      const d = ctx.drone, st = this.st, ex = st.ex;
      if (!b || d.onGround || d.auto) return;
      let ratio = 0;
      if (b.alt != null) ratio = Math.max(ratio, Math.abs(d.p.y - b.alt) / (b.vtol || 1));
      if (b.x != null) ratio = Math.max(ratio, U.dist2(d.p.x, d.p.z, b.x, b.z) / (b.r || 1));
      if (b.yaw != null) ratio = Math.max(ratio, Math.abs(U.wrap(b.yaw - d.yaw)) / ((b.htol || 20) * D2R));
      if (b.minAlt != null && d.p.y < b.minAlt) ratio = Math.max(ratio, 2.5);
      if (!st.bandIn) { if (ratio <= 1) st.bandIn = true; return; }
      if (ratio > 1) {
        ex.t += dt; ex.inT = 0; ex.code = b.code || 'band'; if (ratio > ex.max) ex.max = ratio;
        if (!ex.counted && (ex.t >= 2 || ex.max > 2)) { ex.counted = 'major'; this.fault(ctx, 'major', b.code || 'band'); }
      } else if (ex.t > 0) {
        ex.inT = (ex.inT || 0) + dt;
        if (ex.inT >= EX_REARM) this.closeEx(ctx, b.code || 'band');
      }
    }
    closeEx(ctx, code) {
      const ex = this.st.ex;
      if (ex.t > 0 && !ex.counted && ex.t >= EX_MIN_T) this.fault(ctx, 'minor', code || ex.code || 'band');
      ex.t = 0; ex.max = 0; ex.counted = null; ex.inT = 0;
    }
    score() {
      if (this.state !== 'done') return 0;
      const st = this.st, L = this.L;
      if (L.score) return L.score(st, this);
      let base = 100;
      if (st.subScores.length) { let a = 0; for (let i = 0; i < st.subScores.length; i++) a += st.subScores[i]; base = a / st.subScores.length; }
      if (st.dec.length) base = 0.7 * base + 0.3 * (100 * st.dec.filter(Boolean).length / st.dec.length);
      let sc = base - st.pen;
      if (this.isCheck) { const f = this.fm || { minor: 0, major: 0, safety: 0 }; sc -= 5 * (f.minor || 0) + 15 * (f.major || 0); if ((f.safety || 0) > 0) sc = 0; }
      else sc -= Math.min(20, 3 * this.coachRef.styleCount);
      return clamp(Math.round(sc), 0, 100);
    }
    feedback() {
      const out = (this.st && this.st.tips || []).slice(), ct = this.coachRef.tips();
      for (let i = 0; i < ct.length; i++) if (out.indexOf(ct[i]) < 0) out.push(ct[i]);
      if (this.L.intro && this.L.intro.realWorld && this.state === 'done') out.push('🚁 في الدرون الحقيقي: ' + tx(this.L.intro.realWorld));
      return out.slice(0, 5);
    }
    guide(ctx) {
      if (this.decision) { this._gdec.decide = this.decision; return this._gdec; }
      const st = this.st, s = this.steps[st.k], d = ctx.drone;
      if (!s || this.state !== 'run') return null;
      if (st.demoWait > 0) {   // وقت الشرح في العرض: يثبت مكانه
        if (d.onGround || !C.fpv(d)) return GN;
        return gpos(st, st.p0.x, st.p0.z, st.p0.y, 2);
      }
      if (st.sub) { const g = st.sub.guide(ctx); if (g && s.guideMod) s.guideMod(ctx, st, g); return g; }
      return s.guide ? s.guide(ctx, st, this) : null;
    }
    map() {
      const st = this.st; if (!st) return this._mapAll;
      if (st.sub) return st.sub.map();
      if (this._mapDirty) { this._mapDirty = false; const a = this._mapAll; a.length = 0; for (let i = 0; i < st.pmap.length; i++) a.push(st.pmap[i]); for (let i = 0; i < st.map.length; i++) a.push(st.map[i]); }
      return this._mapAll;
    }
    end(ctx) {
      const st = this.st;
      if (st && st.sub) { try { st.sub.end(ctx); } catch (e) { /* */ } st.sub = null; }
      if (st && this.L.cleanup) { try { this.L.cleanup(ctx, st, this); } catch (e) { /* */ } }
      this.releaseLock(ctx);
      super.end(ctx);
    }
  }
  DS.LessonTask = LessonTask;

  // ======================================================================
  // خطوات جاهزة (B)
  // ======================================================================
  const B = DS.CourseSteps = {};
  const ext = (o, base) => Object.assign(base, o || {});
  // ---- مكان الإبهام الحقيقي ↔ الأمر بعد المنحنى (نفس اللي يسويه input.js: المنطقة الميتة + EXP حق DJI؛ FPV بدون منحنى)
  // الدروس تقول "نص الطريق" = نص حركة الإبهام. الأمر بعد EXP أصغر (نص الإبهام ≈ 0.29 للارتفاع)، فنفحص مكان الإبهام
  // ونرسم الدائرة على الأمر (نقطة العصا في الـ HUD = الأمر) عشان النقطة والدائرة يتقابلون
  const DZ_OUT = 0.03, EXP_DEF = { thr: 0.3, yaw: 0.2, rp: 0.25 };
  const dzIn = () => { const v = DS.settings ? +DS.settings.deadzone : NaN; return v >= 0 ? clamp(v, 0, 0.4) : 0.05; };
  function expFor(d) {
    let m = 'P';
    try { m = d && d.effMode ? d.effMode() : (d && d.mode) || 'P'; } catch (e) { m = (d && d.mode) || 'P'; }
    const t = (DS.settings && DS.settings.djiExp) || {};
    return t[m] || (m === 'A' ? t.P : null) || t.P || EXP_DEF;
  }
  const expK = (e, a) => (a === 'thr' ? e.thr : a === 'yaw' ? e.yaw : e.rp);
  // أمر → مكان الإبهام (−1..1)
  function thumbOf(d, a, v) {
    v = +v || 0; if (!v) return 0;
    const fpv = C.fpv(d);
    if (!fpv && U.djiExpInv) v = U.djiExpInv(v, expK(expFor(d), a));
    const din = dzIn();
    return Math.sign(v) * Math.min(1, din + Math.abs(v) * (1 - din - DZ_OUT));
  }
  // مكان الإبهام → أمر
  function cmdOf(d, a, p) {
    p = +p || 0; if (!p) return 0;
    const din = dzIn(), ap = Math.abs(p);
    let v = ap <= din ? 0 : Math.sign(p) * Math.min(1, (ap - din) / (1 - din - DZ_OUT));
    if (v && !C.fpv(d) && U.djiExp) v = U.djiExp(v, expK(expFor(d), a));
    return v;
  }
  // الهدف صفر: نفحص الأمر نفسه (العصا ترجع للنص لحالها). غيره: نفحص مكان الإبهام
  const nearAx = (d, a, v, T, tol) => (T ? Math.abs(thumbOf(d, a, v) - T) <= tol : Math.abs(+v || 0) <= tol);
  DS.CourseStick = { thumbOf, cmdOf };
  // الكيبورد ما يقدر "شوي" (Shift = نص العصا بس): في الدروس العادية (مو الاختبار) نقبل الخطوة بعد 3 ثواني ونقول له
  const KB_SKIP = 'هذي الخطوة تحتاج يد تحكم — الكيبورد ما يقدر "شوي" (Shift مع الزر = نص العصا). نكمل';
  function kbSkip(ctx, st, T) {
    const I = DS.Input, sess = ctx.session, D = st.data;
    if (!I || T.isCheck || !sess || sess.headless || sess.demo) return false;
    if (D.kbK !== st.k) { D.kbK = st.k; D.kbUsed = false; D.kbSaid = -1; }
    const kb = I.kb;
    if (kb && Math.max(Math.abs(kb.thr || 0), Math.abs(kb.yaw || 0), Math.abs(kb.pitch || 0), Math.abs(kb.roll || 0)) > 0.05) D.kbUsed = true;
    if (!D.kbUsed || I.axisSource !== 'keyboard' || st.runT < 3) return false;
    if (D.kbSaid < 0) { D.kbSaid = st.runT; T.say(ctx, KB_SKIP, 'info'); T.tip(KB_SKIP); if (ctx.msg) ctx.msg('⌨️ ' + KB_SKIP, 'info'); return false; }
    return st.runT - D.kbSaid >= 2.5;
  }
  const isPartial = t => !!t && Math.abs(t) > 0.05 && Math.abs(t) < 0.9;
  // حط العصا على الظل (L/R بصيغة Mode 2: L.x = لف، L.y = ارتفاع، R.x = جنب، R.y = قدام/ورا) — الأهداف = مكان الإبهام
  B.stick = (L, R, say, o) => {
    o = o || {};
    const zero = (!L || (!L.x && !L.y)) && (!R || (!R.x && !R.y));
    const tol = o.tol || (zero ? 0.1 : 0.22);
    const raw = { raw: { thr: 0, yaw: 0, pitch: 0, roll: 0 } }, rw = raw.raw;
    const hL = L ? { x: L.x, y: L.y } : null, hR = R ? { x: R.x, y: R.y } : null, hint = { L: hL, R: hR };
    const toCmd = d => {   // الظل والطيار الآلي على الأمر اللي يطلع من هالإبهام
      rw.yaw = L ? cmdOf(d, 'yaw', L.x) : 0; rw.thr = L ? cmdOf(d, 'thr', L.y) : 0;
      rw.roll = R ? cmdOf(d, 'roll', R.x) : 0; rw.pitch = R ? cmdOf(d, 'pitch', R.y) : 0;
      if (hL) { hL.x = rw.yaw; hL.y = rw.thr; } if (hR) { hR.x = rw.roll; hR.y = rw.pitch; }
    };
    const base = {
      say, hint: ctx => { toCmd(ctx.drone); return hint; }, hold: o.hold != null ? o.hold : 0.4, groundLock: true, gentle: false, short: o.short,
      check: ctx => {
        const c = ctl(ctx), d = ctx.drone;
        return (!L || (nearAx(d, 'yaw', c.yaw, L.x, tol) && nearAx(d, 'thr', c.thr, L.y, tol))) && (!R || (nearAx(d, 'roll', c.roll, R.x, tol) && nearAx(d, 'pitch', c.pitch, R.y, tol)));
      },
      guide: ctx => { toCmd(ctx.drone); return raw; }
    };
    if (!o.exam && ((L && (isPartial(L.x) || isPartial(L.y))) || (R && (isPartial(R.x) || isPartial(R.y))))) base.tick = (ctx, st, dt, T) => (kbSkip(ctx, st, T) ? 'next' : null);
    if (o.exam) {   // في الاختبار: بطيء = خطأ، تحريك العصا الثانية = خطأ
      base.tick = (ctx, st, dt, T) => {
        const c = ctl(ctx), D = st.data;
        if (st.stepT < 0.05) { D.f1 = D.f2 = D.fw = false; }
        if (st.stepT > 4 && !D.f1) { D.f1 = true; T.fault(ctx, 'minor', 'slow'); }
        if (st.stepT > 9 && !D.f2) { D.f2 = true; T.fault(ctx, 'major', 'slow'); }
        const wrong = (!L && (Math.abs(c.thr || 0) > 0.5 || Math.abs(c.yaw || 0) > 0.5)) || (!R && (Math.abs(c.pitch || 0) > 0.5 || Math.abs(c.roll || 0) > 0.5));
        if (wrong && !D.fw) { D.fw = true; T.fault(ctx, 'minor', 'wrong'); }
        return null;
      };
    }
    return ext(o.extra, base);
  };
  B.centre = (say, o) => B.stick({ x: 0, y: 0 }, { x: 0, y: 0 }, say || 'اترك العصي ترجع للنص', o);
  // تأكيد بالسهم اليمين ▶ (فحص قبل الطيران)
  B.ack = (say, o) => ext(o, {
    say, text: say, hint: null,
    enter(ctx, st) { st.data.ack = false; },
    check: (ctx, st) => !!st.data.ack, guide: () => press('RIGHT'), coach: []
  });
  B.motorsOn = (say, o) => ext(o, {
    say: say || 'شغّل المحركات (CSC): العصاتين لتحت ولداخل مع بعض', short: 'CSC',
    hint: (ctx) => ctx.drone.motors ? null : HINT_CSC,
    check: ctx => ctx.drone.motors, guide: (ctx, st) => st.stepT < 0.7 ? GR0 : RAW_CSC, coach: []
  });
  const HINT_CSC = { L: { x: 1, y: -1 }, R: { x: -1, y: -1 } };
  const HINT_THRDN = { L: { x: 0, y: -1 }, R: null };
  B.motorsOff = (how, say, o) => ext(o, {
    say: say || (how === 'csc' ? 'طفّ المحركات بنفس الحركة (CSC)' : 'خل {T} تحت للآخر 3 ثواني — المحركات تطفي'),
    hint: ctx => (!ctx.drone.motors ? null : how === 'csc' ? HINT_CSC : HINT_THRDN),
    check: ctx => !ctx.drone.motors && ctx.drone.onGround,
    guide: (ctx, st) => (st.stepT < 0.7 ? GR0 : how === 'csc' ? RAW_CSC : RAW_THRDN), coach: []
  });
  B.takeoff = (alt, say, o) => ext(o, {
    say: say || 'أقلع لين ' + alt + ' متر: اضغط A مطوّل، أو شغّل المحركات (CSC) وارفع {T} بشويش', lock: null,
    enter(ctx, st) { st.hx = ctx.drone.p.x; st.hz = ctx.drone.p.z; },
    check: ctx => { const d = ctx.drone; return C.air(d) && d.p.y >= alt - 0.35 && d.auto !== 'takeoff'; },
    hold: 0.3, guide: (ctx, st) => gpos(st, st.hx, st.hz, alt, 2), coach: ['slam', 'fastdescent', 'battery'],
    live: ctx => 'H ' + U.fmt(ctx.drone.p.y, 1) + ' م'
  });
  // اثبت على ارتفاع (فوق نفس المكان)
  B.alt = (alt, tol, hold, say, o) => {
    o = o || {};
    return ext(o.extra, {
      say, alt, altTol: tol * 2.5, hold: hold || 0, lock: o.lock, hint: o.hint, short: o.short,
      enter(ctx, st) { st.hx = o.x != null ? o.x : ctx.drone.p.x; st.hz = o.z != null ? o.z : ctx.drone.p.z; },
      check: (ctx) => { const d = ctx.drone; return C.altIn(d, alt, tol) && (!o.still || Math.abs(d.v.y) < 0.3); },
      guide: (ctx, st) => gpos(st, st.hx, st.hz, alt, 2, null, o.vdown),
      live: ctx => 'H ' + U.fmt(ctx.drone.p.y, 1) + ' م (المطلوب ' + alt + ')',
      coach: o.coach, band: o.band
    });
  };
  // وصلت؟ مع القفل نفحص بس اللي تقدر تغيره العصا المسموحة (مثلاً جنب بس = نفحص المسافة الجانبية)
  function reach(d, x, z, alt, r, vtol, lock) {
    if (d.onGround) return false;
    const lp = !!(lock && lock.indexOf('pitch') >= 0), lr = !!(lock && lock.indexOf('roll') >= 0), lt = !!(lock && lock.indexOf('thr') >= 0);
    const dx = x - d.p.x, dz = z - d.p.z, sy = Math.sin(d.yaw), cy = Math.cos(d.yaw);
    const h = lp && lr ? 0 : lr ? Math.abs(dx * sy - dz * cy) : lp ? Math.abs(dx * cy + dz * sy) : Math.hypot(dx, dz);
    return h <= r && (lt || Math.abs(d.p.y - alt) <= vtol);
  }
  // روح لعلامة (beacon)
  B.goTo = (x, z, alt, r, say, o) => {
    o = o || {};
    const vtol = o.vtol || Math.max(1.2, r);
    const yawFn = typeof o.yaw === 'function' ? o.yaw : null;
    return ext(o.extra, {
      say, alt: o.noAlt ? null : alt, altTol: Math.max(1.2, vtol), target: { x, z }, hold: o.hold || 0, lock: o.lock, wantMode: o.wantMode,
      coach: o.coach, hint: o.hint, short: o.short, band: o.band, combo: o.combo, gentle: o.gentle, reticle: o.reticle, exit: o.exit, drift: o.drift,
      enter(ctx, st, T) {
        const h = T.vis(ctx, { type: 'beacon', x, z, alt, r, label: o.label || '' }); h.set('next');
        T.mapAdd({ kind: 'beacon', x, z, r, label: o.label || '', state: 'next' });
        if (o.enter) o.enter(ctx, st, T);
      },
      check: (ctx, st) => reach(ctx.drone, x, z, alt, r, vtol, o.lock) && (!o.still || C.hs(ctx.drone) < o.still) && (!o.cond || o.cond(ctx, st)),
      tick: o.tick,
      guide: (ctx, st) => gpos(st, x, z, alt, o.speed || 3, yawFn ? yawFn(ctx.drone) : (o.yaw != null ? o.yaw : null)),
      live: ctx => { const d = ctx.drone; return (d.onGround ? '' : U.relDir(d.yaw, U.bearing(d.p.x, d.p.z, x, z)) + ' ' + Math.round(C.hd(d, x, z)) + ' م'); }
    });
  };
  // اثبت داخل عمود (zone) — accumulate: الوقت يتجمع حتى لو طلعت
  B.hover = (x, z, alt, r, vtol, hold, say, o) => {
    o = o || {};
    return ext(o.extra, {
      say, alt, altTol: vtol * 2, target: { x, z }, hold, accumulate: !!o.accumulate, lock: o.lock, coach: o.coach, drift: o.drift,
      band: o.band, wantMode: o.wantMode, short: o.short,
      enter(ctx, st, T) {
        st.zone = T.vis(ctx, { type: 'zone', x, z, y: alt, r, h: 2 * vtol }); st.zs = '';
        T.mapAdd({ kind: 'zone', x, z, r, state: 'next' });
        if (o.enter) o.enter(ctx, st, T);
      },
      exit: o.exit,
      check(ctx, st) {
        const ok = C.at(ctx.drone, x, z, alt, r, vtol) && (!o.cond || o.cond(ctx, st));
        const zs = ok ? 'in' : 'out'; if (st.zone && st.zs !== zs) { st.zs = zs; st.zone.set(zs); }
        return ok;
      },
      tick: o.tick,
      guide: (ctx, st) => o.guide ? o.guide(ctx, st) : gpos(st, x, z, alt, o.speed || 2),
      live: (ctx, st) => {
        const d = ctx.drone, eh = C.hd(d, x, z);
        if (eh > r) return 'رجّعه للعمود (' + U.relDir(d.yaw, U.bearing(d.p.x, d.p.z, x, z)) + ' ' + U.fmt(eh, 1) + ' م)';
        if (Math.abs(d.p.y - alt) > vtol) return d.p.y < alt ? 'ارفع شوي' : 'نزّل شوي';
        return 'ممتاز، كذا!';
      }
    });
  };
  // اترك العصي: الدرون يوقف (DJI يفرمل لحاله، FPV/ATTI لازم توقفه بيدك)
  // FPV: "مستوي وبطيء" يكفي (أقل من 1.2 م/ث، ونص ثانية) — الحركات تبدأ من طيران بطيء مو وقفة تامة.
  // وبعد 25 ث نكمل: الدرس بنصيحة، والاختبار بخطأ بسيط (تأخرت) — ما يعلق لين تخلص البطارية
  const STOP_FPV_LIMIT = 25;
  B.stop = (say, o) => {
    o = o || {};
    const hold = o.hold || 1;
    return ext(o.extra, {
      say: say || 'اترك العصي: شوف كيف يوقف لحاله', hold, lock: o.lock, drift: o.drift, coach: o.coach, band: o.band,
      check: ctx => {
        const d = ctx.drone, fpv = C.fpv(d), atti = !fpv && d.effMode() === 'A';
        if (!C.air(d)) return false;
        if (fpv) return C.hs(d) < 1.2 && Math.abs(d.v.y) < 0.8 && C.up(d) > 0.8;
        return C.hs(d) < (atti ? 0.6 : 0.3) && Math.abs(d.v.y) < 0.4 && (atti || C.rightCentred(ctl(ctx), 0.1));
      },
      tick(ctx, st, dt, T) {
        const d = ctx.drone;
        if (!C.fpv(d)) return null;
        // FPV: نص ثانية تكفي
        if (st.held >= Math.min(hold, 0.5) && C.air(d) && C.hs(d) < 1.2 && Math.abs(d.v.y) < 0.8 && C.up(d) > 0.8) return 'next';
        if (st.runT > STOP_FPV_LIMIT && C.air(d)) {
          if (T.isCheck) T.fault(ctx, 'minor', 'slow');
          else { T.tip('في الـ FPV مو لازم يوقف تماماً — بس مستوي وبطيء'); T.say(ctx, 'مو لازم يوقف تماماً — بس مستوي وبطيء. نكمل', 'info'); }
          return 'next';
        }
        return null;
      },
      guide: (ctx, st) => { const d = ctx.drone; return (C.fpv(d) || d.effMode() === 'A') ? gpos(st, st.p0.x, st.p0.z, st.p0.y, 2) : GN; },
      live: ctx => 'السرعة ' + U.fmt(C.hs(ctx.drone), 1) + ' م/ث'
    });
  };
  // وجّه الدرون: target رقم (راديان) أو 'pilot' (وجهه لك) أو 'away' (ظهره لك) أو 'right'/'left' (وجهه على يمينك/يسارك)
  const yawFnOf = tgt => typeof tgt === 'function' ? tgt : tgt === 'pilot' ? d => C.toPilot(d) : tgt === 'away' ? d => C.fromPilot(d)
    : tgt === 'right' ? d => U.wrap(C.fromPilot(d) + PI / 2) : tgt === 'left' ? d => U.wrap(C.fromPilot(d) - PI / 2) : () => tgt;
  B.yaw = (tgt, tolDeg, hold, say, o) => {
    o = o || {};
    const fn = yawFnOf(tgt);
    return ext(o.extra, {
      say, hold: hold || 1, lock: o.lock !== undefined ? o.lock : ['thr', 'pitch', 'roll'], coach: o.coach, short: o.short,
      enter(ctx, st) { st.hx = ctx.drone.p.x; st.hz = ctx.drone.p.z; st.hy = Math.max(ctx.drone.p.y, 2); },
      check: ctx => C.air(ctx.drone) && C.headErr(ctx.drone, fn(ctx.drone)) <= tolDeg * D2R,
      guide: (ctx, st) => gpos(st, st.hx, st.hz, st.hy, 2, carrot(ctx.drone, fn(ctx.drone), 0.35)),
      live: ctx => 'باقي ' + Math.round(C.headErr(ctx.drone, fn(ctx.drone)) * R2D) + '°'
    });
  };
  // لف بزاوية (يمين +، يسار −) — نجمع اللف الحقيقي
  B.turn = (deg, say, o) => {
    o = o || {};
    const sg = deg >= 0 ? 1 : -1, need = Math.abs(deg) * D2R * 0.95;
    return ext(o.extra, {
      say, lock: o.lock !== undefined ? o.lock : ['thr', 'pitch', 'roll'], coach: o.coach, short: o.short,
      enter(ctx, st) { st.acc = 0; st.last = ctx.drone.yaw; st.hx = ctx.drone.p.x; st.hz = ctx.drone.p.z; st.hy = Math.max(ctx.drone.p.y, 2); },
      tick(ctx, st) { const d = ctx.drone; st.acc += U.wrap(d.yaw - st.last); st.last = d.yaw; return sg * st.acc >= need ? 'next' : null; },
      guide: (ctx, st) => gpos(st, st.hx, st.hz, st.hy, 2, U.wrap(ctx.drone.yaw + sg * 0.35)),
      live: (ctx, st) => Math.round(clamp(sg * st.acc / (Math.abs(deg) * D2R), 0, 1) * 100) + '%'
    });
  };
  // هبوط على منصة: يوقف فوقها → ينزل ببطء → يطفي المحركات
  function landGuide(ctx, st, x, z, r) {
    const d = ctx.drone, lc = st.lc, eh = C.hd(d, x, z);
    if (d.onGround) return lc.wasAir ? GD : gpos(st, x, z, 3, 3);
    if (eh < Math.max(0.3, 0.2 * r)) lc.desc = true; else if (eh > Math.max(0.8, 0.45 * r)) lc.desc = false;
    if (!lc.desc) return gpos(st, x, z, Math.max(3, Math.min(d.p.y, 15)), Math.min(5, 1 + eh * 0.6));
    const fpv = C.fpv(d), vd = d.p.y > 4 ? 2 : d.p.y > 1.5 ? 0.9 : fpv ? 0.4 : 0.42;
    return gpos(st, x, z, -1, 2, null, vd);   // الهدف تحت الأرض = نزول ثابت لين يلمس
  }
  B.land = (x, z, r, maxVs, say, o) => {
    o = o || {};
    maxVs = maxVs || 0.8;
    return ext(o.extra, {
      say: say || (ctx => C.fpv(ctx.drone) ? 'روح فوق المنصة ووقف، بعدين نزّل بهدوء لين يلمس — وبعد ما يلمس: طفّ المحركات (DISARM) بـ A مطوّل أو CSC' : 'روح فوق المنصة ووقف، بعدين نزّل بهدوء لين يلمس — وخل {T} تحت لين تطفي المحركات'),
      coach: o.coach || ['fastdescent', 'overcorrect', 'slam', 'drift', 'nosein', 'battery', 'vrs'], target: { x, z }, lock: o.lock, drift: o.drift,
      enter(ctx, st, T) {
        st.lc = new DS.LandCheck(x, z, r, maxVs);
        if (!o.home) T.vis(ctx, { type: 'pad', x, z, r, label: o.label || '' });
        T.mapAdd({ kind: 'pad', x, z, r, label: o.label || 'H', state: 'next' });
        if (o.enter) o.enter(ctx, st, T);
      },
      tick(ctx, st, dt, T) {
        const lc = st.lc;
        if (lc.update(ctx.drone) !== 'done') return null;
        const td = lc.td, sc = lc.score();
        if (T.isCheck) {
          if (td.dist > r * 2) T.fault(ctx, 'major', 'land'); else if (td.dist > r) T.fault(ctx, 'minor', 'land');
          if (td.vs > maxVs * 1.6) T.fault(ctx, 'major', 'hard'); else if (td.vs > maxVs) T.fault(ctx, 'minor', 'hard');
          if (lc.bounces > 0) T.fault(ctx, 'minor', 'bounce');
          if (td.hs > 1) T.fault(ctx, 'minor', 'side');
        } else {
          st.pen += Math.round((100 - sc) * (o.weight != null ? o.weight : 0.25));
          if (td.vs > maxVs) T.tip('آخر متر قبل الأرض: نزول أبطأ (' + U.fmt(td.vs, 1) + ' م/ث كان سريع)');
          if (td.dist > r) T.tip('وقّف فوق المنصة بالضبط قبل ما تبدأ تنزل');
          if (td.hs > 0.5) T.tip('وقف الحركة الجانبية قبل لا تلمس');
        }
        st.lastLand = td;
        if (td.dist > r * 4 && !o.anywhere) return 'fail:هبطت بعيد عن المنصة';
        return 'next';
      },
      text: (ctx, st) => st.lc ? st.lc.hint(ctx.drone, o.label || 'H') : '',
      guide: (ctx, st) => st.lc ? landGuide(ctx, st, x, z, r) : null
    });
  };
  B.mode = (m, say, o) => ext(o, {
    say: say || ('حوّل لوضع ' + (MODE_LBL[m] || m)), hint: null, coach: [],
    check: ctx => ctx.drone.mode === m,
    guide: (ctx, st) => modeGuide(ctx.drone, m) || GN,
    live: ctx => 'الحين: ' + (MODE_LBL[ctx.drone.mode] || ctx.drone.mode)
  });
  B.decide = (q, a, ex, o) => ext(o, { decide: { q, a, ex }, hint: null });
  B.embed = (factory, say, o) => ext(o, { say, embed: () => factory(), guideMod: lerpAlt });
  // المسار بارتفاعات مختلفة: المدرب يغير الارتفاع بالتدريج على طول الضلع (مو يطلع مرة وحدة)
  function lerpAlt(ctx, st, g) {
    const T = st.sub; if (!T || !T.o || !T.o.pts || g.x == null || g.alt == null || !(T.i >= 1)) return;
    const P = T.o.pts[T.i], Q = T.o.pts[T.i - 1]; if (!P || !Q || P.gate || P.alt === Q.alt) return;
    const d = ctx.drone, L = Math.max(1, U.dist2(Q.x, Q.z, P.x, P.z));
    const f = clamp(1 - U.dist2(d.p.x, d.p.z, P.x, P.z) / L + 2 / L, 0, 1);
    g.alt = U.lerp(Q.alt, P.alt, f);
  }
  B.wait = (sec, say, guide, o) => ext(o, { say, check: () => true, hold: sec, guide: guide ? (typeof guide === 'function' ? guide : () => guide) : null });
  B.cond = (fn, say, o) => ext(o, { say, check: fn });

  // ---- بوابة (raceGate): لازم تعدي من نصها وبالاتجاه الصح
  function gateFrame(spec) {
    if (DS.gateFrame) return DS.gateFrame(spec);
    const w = spec.w || 1.52, h = spec.h || 1.52, bottom = spec.y != null ? spec.y - h / 2 : 0.18;
    return { w, h, t: 0.16, bottom, top: bottom + h, cy: bottom + h / 2, floating: bottom > 0.5 };
  }
  // يحط البوابات أول الدرس (تبقى ظاهرة) — gs: [{x,z,yaw,w,h,y}]
  function setupGates(ctx, st, T, gs) {
    st.gates = gs.map((g, i) => {
      const GF = gateFrame(g), h = T.vis(ctx, { type: 'raceGate', x: g.x, z: g.z, yaw: g.yaw || 0, w: g.w, h: g.h, y: g.y, label: String(i + 1) }, true);
      if (DS.gateColliders && ctx.env && ctx.env.taskColliders) { const cs = DS.gateColliders(g, 'البوابة'); for (let k = 0; k < cs.length; k++) ctx.env.taskColliders.push(cs[k]); }
      T.mapAdd({ kind: 'gate', x: g.x, z: g.z, r: (g.w || 1.5) / 2, label: i + 1, state: 'idle' }, true);
      return { g, GF, h };
    });
  }
  B.gate = (i, say, o) => {
    o = o || {};
    return ext(o.extra, {
      say, coach: o.coach, band: o.band, short: o.short,
      enter(ctx, st) { const G = st.gates[i]; G.h.set('next'); st.prevA = null; st.miss = 0; st.ar = null; },
      exit(ctx, st) { st.gates[i].h.set('done'); },
      tick(ctx, st, dt, T) {
        const G = st.gates[i], g = G.g, GF = G.GF, d = ctx.drone, yaw = g.yaw || 0;
        const nx = Math.sin(yaw), nz = -Math.cos(yaw), rx = Math.cos(yaw), rz = Math.sin(yaw);
        const dx = d.p.x - g.x, dz = d.p.z - g.z, along = dx * nx + dz * nz, lat = dx * rx + dz * rz;
        st.along = along; st.lat = lat;
        let res = null;
        if (st.prevA != null && st.prevA < 0 && along >= 0) {
          const inside = Math.abs(lat) < GF.w / 2 - 0.12 && d.p.y > GF.bottom + 0.08 && d.p.y < GF.top - 0.08;
          if (inside) res = 'next';
          else if (T.isCheck) { T.fault(ctx, 'minor', 'gate'); res = 'next'; }
          else { st.miss++; T.say(ctx, 'فاتتك البوابة ' + (i + 1) + '! لف وارجع لها من قدام وادخل من نصها', 'warn'); }
        }
        st.prevA = along;
        return res;
      },
      guide(ctx, st) {
        const G = st.gates[i], g = G.g, d = ctx.drone, yaw = g.yaw || 0, cy = G.GF.cy;
        const nx = Math.sin(yaw), nz = -Math.cos(yaw), rx = Math.cos(yaw), rz = Math.sin(yaw);
        const dx = d.p.x - g.x, dz = d.p.z - g.z, along = dx * nx + dz * nz, lat = dx * rx + dz * rz;
        if (st.ar == null) st.ar = along > -0.5;
        if (st.ar && along < -4) st.ar = false;
        if (st.ar) {   // ورا البوابة: لف من جنبها
          const side = lat >= 0 ? 1 : -1, off = G.GF.w / 2 + 3, k = Math.abs(lat) < off - 0.5 ? Math.max(along, 2) : -7;
          return gpos(st, g.x + nx * k + rx * side * off, g.z + nz * k + rz * side * off, cy, 3, U.bearing(d.p.x, d.p.z, g.x - nx * 6, g.z - nz * 6));
        }
        const a = Math.min(along + 3.5, 3.5), tx_ = g.x + nx * a, tz_ = g.z + nz * a;
        return gpos(st, tx_, tz_, cy, o.speed || 4, along < -1.5 ? U.bearing(d.p.x, d.p.z, g.x + nx * 2, g.z + nz * 2) : yaw);
      },
      live: (ctx, st) => {
        const G = st.gates[i], d = ctx.drone;
        if (st.along != null && st.along > 0.5) return 'أنت ورا البوابة — لف وارجع لها من قدام';
        return U.relDir(d.yaw, U.bearing(d.p.x, d.p.z, G.g.x, G.g.z)) + ' ' + Math.round(C.hd(d, G.g.x, G.g.z)) + ' م';
      }
    });
  };

  // ---- حركات FPV (Acro): نكشفها من سرعات الدوران المتجمعة (fpv.md §8)
  const TRICK_TXT = { flip: 'Flip', roll: 'Roll', splitS: 'Split-S', powerLoop: 'Power Loop' };
  function trickDone(type, D) {
    const ap = Math.abs(D.rp), aq = Math.abs(D.rq);
    if (type === 'flip') return aq >= 320 && ap < 70;
    if (type === 'roll') return ap >= 320 && aq < 70;
    if (type === 'splitS') return ap >= 140 && aq >= 110 && D.rev;
    if (type === 'powerLoop') return aq >= 300 && D.minUp < -0.5 && D.vIn >= 4;   // لفة لورا كاملة وهو ماشي لقدام (مو قلبة بمكانه)
    return false;
  }
  B.trick = (type, dir, say, o) => {
    o = o || {};
    return ext(o.extra, {
      say, coach: ['vrs', 'battery'], band: o.band, short: TRICK_TXT[type],
      enter(ctx, st) { const D = st.data; D.tr = { type, dir: dir || 1, turns: 1 }; D.g = { trick: D.tr }; D.done = false; D.doneT = 0; D.base = false; D.calmT = 0; D.rot = false; D.rp = D.rq = D.ry = 0; },
      tick(ctx, st, dt) {
        const d = ctx.drone, D = st.data, up = C.up(d), w = Math.hypot(d.w.x, d.w.y, d.w.z) * R2D;
        if (!D.base) { D.base = true; D.rp = D.rq = D.ry = 0; D.y0 = D.yMax = D.yMin = d.p.y; D.v0x = d.v.x; D.v0z = d.v.z; D.vIn = 0; D.minUp = 1; D.rev = false; }
        D.rp += -d.w.z * dt * R2D; D.rq += -d.w.x * dt * R2D; D.ry += -d.w.y * dt * R2D;
        // قبل ما يدور كثير (ميلان عادي للتسارع): نحفظ سرعة وارتفاع الدخول
        D.rot = Math.abs(D.rp) > 45 || Math.abs(D.rq) > 75;
        if (!D.rot && up > 0.3) { D.v0x = d.v.x; D.v0z = d.v.z; D.vIn = Math.max(D.vIn, C.hs(d)); D.y0 = D.yMax = D.yMin = d.p.y; D.minUp = up; }
        if (up < D.minUp) D.minUp = up;
        if (d.p.y > D.yMax) D.yMax = d.p.y; if (d.p.y < D.yMin) D.yMin = d.p.y;
        const v0 = Math.hypot(D.v0x, D.v0z), v1 = C.hs(d);
        if (D.rot && v0 > 3 && v1 > 2 && (D.v0x * d.v.x + D.v0z * d.v.z) / (v0 * v1) < -0.6) D.rev = true;
        if (!D.done && trickDone(type, D)) D.done = true;
        // هادي ومستوي 0.8 ث بدون ما يكمل الحركة = محاولة جديدة (نصفّر العد)
        D.calmT = up > 0.6 && w < 60 ? D.calmT + dt : 0;
        if (!D.done && D.calmT > 0.8) { D.rp = D.rq = D.ry = 0; D.y0 = D.yMax = D.yMin = d.p.y; D.minUp = up; D.vIn = 0; D.rev = false; D.rot = false; }
        if (D.done && up > 0.85 && w < 90) { D.doneT += dt; if (D.doneT > 0.35) return 'next'; }
        return null;
      },
      guide: (ctx, st) => (ctx.drone.mode !== 'ACRO' ? (modeGuide(ctx.drone, 'ACRO') || GN) : st.data.g),
      live: (ctx, st) => { const D = st.data; return D.done ? 'تمام ✓ رجّعه مستوي' : (ctx.drone.mode !== 'ACRO' ? 'لازم وضع Acro' : 'لف: ' + Math.round(Math.max(Math.abs(D.rp || 0), Math.abs(D.rq || 0))) + '°'); }
    });
  };

  // ---- تصوير هدف: خله في نص الكادر واضغط RB
  function frameGuide(ctx, st, X, Y, Z, shoot, tol) {
    const d = ctx.drone, s = ctx.session, cam = ctx.camera();
    const ey = U.wrap(U.bearing(d.p.x, d.p.z, X, Z) - d.yaw);
    const hd = Math.max(0.5, U.dist2(cam.pos.x, cam.pos.z, X, Z)), need = Math.atan2(Y - cam.pos.y, hd) * R2D;
    const eg = need - (s.gimbal || 0);
    const g = graw(st), r = g.raw;
    r.yaw = clamp(ey * 2.2, -0.6, 0.6); r.lt = clamp(-eg / 12, 0, 1); r.rt = clamp(eg / 12, 0, 1);
    if (shoot) { const iv = ctx.inView(X, Y, Z); g.shutter = iv.angle < tol * 0.6 && Math.abs(ey) < tol * 0.5 * D2R + 0.02; }
    return g;
  }
  B.photo = (tg, tol, say, o) => {
    o = o || {};
    return ext(o.extra, {
      say, reticle: tol, coach: o.coach || ['fastdescent', 'battery'], hint: o.hint, band: o.band,
      enter(ctx, st, T) { st.data.got = false; if (tg.h) tg.h.set('next'); },
      exit(ctx, st) { if (tg.h) tg.h.set('done'); },
      onShutter(ctx, st, T) {
        if (st.data.got) return;
        const iv = ctx.inView(tg.x, tg.y, tg.z);
        if (iv.angle <= tol) {
          if (o.minDist && iv.dist < o.minDist) { T.say(ctx, 'قريب كثير! ابعد شوي وصوّر من مسافة آمنة', 'warn'); return; }
          st.data.got = true; T.say(ctx, '📸 صورة حلوة ✓', 'good');
        } else { if (T.isCheck) T.fault(ctx, 'minor', 'photo'); else T.say(ctx, 'الهدف مو في نص الشاشة — خله داخل المربع وعيد', 'warn'); }
      },
      check: (ctx, st) => !!st.data.got,
      tick: o.tick,
      guide: (ctx, st) => frameGuide(ctx, st, tg.x, tg.y, tg.z, true, tol),
      live: ctx => { const iv = ctx.inView(tg.x, tg.y, tg.z); return 'بعيد عن النص ' + Math.round(iv.angle) + '°'; }
    });
  };

  // ======================================================================
  // محتوى الدورة: 15 وحدة
  // ======================================================================
  const CALM = { s: 0, g: 0 }, LIGHT = { s: 1.5, g: 0.5 };
  const sq = arr => arr.map(([x, z, alt, r]) => ({ x, z, alt, r }));
  const circle = (cx, cz, R, n, alt, r, cw) => { const out = []; for (let k = 0; k <= n; k++) { const a = PI + (cw === false ? -1 : 1) * k * 2 * PI / n; out.push({ x: cx + Math.sin(a) * R, z: cz - Math.cos(a) * R, alt, r }); } return out; };
  const CT_ = o => () => new DS.CourseTask(o);
  const HT_ = o => () => new DS.HoverTask(o);
  const OT_ = o => () => new DS.OrbitTask(o);
  const landHome = (r, maxVs, say, o) => B.land(0, 0, r || 1.5, maxVs || 0.8, say, Object.assign({ home: true }, o || {}));
  const homeLand = (say, o) => landHome(1.5, 0.8, say || 'ارجع للبيت (H) وهبّط بهدوء — خل {T} تحت لين تطفي المحركات', o);
  // اضطراب (كأن الـ GPS يغلط): يدف الدرون ببطء في اتجاه عشوائي (ثابت مع البذرة)
  const driftOn = (ms) => (ctx, st) => { const a = (ctx.rng ? ctx.rng() : 0.3) * 2 * PI; st.data.dx = Math.sin(a) * ms; st.data.dz = -Math.cos(a) * ms; ctx.drone.dist = { x: st.data.dx, z: st.data.dz }; };
  const driftOff = ctx => { ctx.drone.dist = { x: 0, z: 0 }; };

  const UNITS = [];
  const unit = (n, icon, title, desc, airframe, lessons, check) => UNITS.push({ unit: n, icon, title, desc, airframe, lessons, check });

  // ---------------- 1) الريموت والعصي (على الأرض — المحركات طافية) ----------------
  unit(1, '🕹️', 'الريموت والعصي', 'تعرف على العصاتين قبل لا تطير: وش تسوي كل عصا، والحركة الناعمة، وتشغيل المحركات.', 'mini', [
    {
      id: 'u1l1', icon: '⬆️', title: 'الارتفاع واللف', lock: ['pitch', 'roll'], gentle: false, beginner: true, wind: CALM,
      intro: {
        text: 'الريموت فيه عصاتين. {T} للارتفاع و{Y} للف حول النفس. الدرون طافي — بس نتعلم وين تروح يدك.',
        bullets: ['فوق = يصعد', 'تحت = ينزل', 'يمين/يسار = يلف حول نفسه (مثل ما تلف راسك)', 'تتركها بالنص = يثبت على ارتفاعه'],
        diagram: { L: 'up', R: null },
        realWorld: 'ريموت DJI الحقيقي نفس الشي: العصا ترجع للنص لحالها، والنص يعني ثبات.',
        tips: ['امسك اليد بالإبهامين بس', 'تابع الدائرة الصفرا في رسمة العصي تحت', 'تبي توقف؟ ☰ (Start) أو Esc = إيقاف وقائمة']
      },
      steps: [
        B.stick({ x: 0, y: 1 }, null, 'ادفع {T} لفوق للآخر — هذا يعني الدرون يصعد', { short: 'فوق = يصعد' }),
        B.stick({ x: 0, y: 0 }, null, 'رجّعها للنص. النص يعني: يثبت على ارتفاعه', { short: 'النص = ثبات' }),
        B.stick({ x: 0, y: -1 }, null, 'الحين لتحت للآخر — الدرون ينزل', { short: 'تحت = ينزل' }),
        B.stick({ x: 0, y: 0.5 }, null, 'نص الطريق بس لفوق: صعود بشويش. حط النقطة البيضا على الدائرة الصفرا', { tol: 0.2, hold: 0.8, short: 'شوي = صعود بطيء' }),
        B.stick({ x: 0, y: 0 }, null, 'رجّعها للنص'),
        B.stick({ x: 1, y: 0 }, null, '{Y} يمين: الدرون يلف حول نفسه لليمين (مع عقارب الساعة)', { short: 'يمين = يلف يمين' }),
        B.stick({ x: -1, y: 0 }, null, 'والحين يسار: يلف لليسار', { short: 'يسار = يلف يسار' }),
        B.stick({ x: 0, y: 0 }, null, 'ممتاز! اتركها ترجع للنص', { hold: 0.8 })
      ]
    },
    {
      id: 'u1l2', icon: '➡️', title: 'عصا الحركة: قدام وورا وجنب', lock: ['thr', 'yaw'], gentle: false, beginner: true, wind: CALM,
      intro: {
        text: '{M} تحرك الدرون بدون ما يلف: قدام وورا ويمين ويسار — دايم بالنسبة لوجه الدرون مو لوجهك.',
        bullets: ['فوق = قدام (وين ما وجهه)', 'تحت = ورا', 'يمين/يسار = يمشي على جنبه', 'تتركها = في وضع N يفرمل ويوقف'],
        diagram: { L: null, R: 'up' },
        realWorld: 'في DJI: تترك العصي = الدرون يفرمل ويوقف. هذي أهم حركة أمان: إذا تلخبطت اترك العصي.',
        tips: ['قدام = اتجاه وجه الدرون (النور الأحمر قدام)']
      },
      steps: [
        B.stick(null, { x: 0, y: 1 }, '{P} لفوق = الدرون يمشي لقدام (على اتجاه وجهه)', { short: 'فوق = قدام' }),
        B.stick(null, { x: 0, y: -1 }, 'لتحت = يرجع ورا', { short: 'تحت = ورا' }),
        B.stick(null, { x: 1, y: 0 }, '{R} يمين = يمشي على جنبه لليمين (ما يلف)', { short: 'يمين = جنب يمين' }),
        B.stick(null, { x: -1, y: 0 }, 'يسار = على جنبه لليسار', { short: 'يسار = جنب يسار' }),
        B.stick(null, { x: 0.7, y: 0.7 }, 'الزاوية فوق-يمين = قدام ويمين مع بعض (حركة مايلة)', { tol: 0.25, short: 'مايل' }),
        B.stick(null, { x: 0, y: 0 }, 'اتركها ترجع للنص: في وضع N الدرون يفرمل ويوقف مكانه', { hold: 0.8, short: 'النص = يوقف' })
      ]
    },
    {
      id: 'u1l3', icon: '🪶', title: 'حركات صغيرة وناعمة', gentle: false, beginner: false, wind: CALM,
      intro: {
        text: 'سر الطيار الشاطر: حركات صغيرة وهادية. الدرون يستجيب لأي حركة، فالحركة الكبيرة المفاجئة تخليه يطير بقوة.',
        bullets: ['ربع الطريق = حركة بطيئة', 'ادفع العصا ببطء، لا تضربها', 'رجّعها للنص بهدوء'],
        diagram: { L: 'up', R: 'up' },
        realWorld: 'الدرون الحقيقي حساس: المحترف يحرك العصا مليمترات. الحركة القوية المفاجئة سبب أغلب طيحات المبتدئين.',
        tips: ['ريّح يدك وخل الإبهام خفيف']
      },
      steps: [
        B.stick({ x: 0, y: 0.3 }, null, 'حط {T} شوي بس لفوق — ربع الطريق', { tol: 0.12, hold: 1, short: 'شوي بس' }),
        B.centre('رجّعها للنص'),
        B.stick(null, { x: 0, y: 0.3 }, '{P} شوي لقدام — حركة صغيرة', { tol: 0.12, hold: 1, short: 'شوي لقدام' }),
        B.stick(null, { x: -0.3, y: 0 }, '{R} شوي لليسار', { tol: 0.12, hold: 1, short: 'شوي يسار' }),
        B.centre('رجّعها للنص'),
        {
          say: 'ادفع {P} لقدام ببطء — خذ ثانيتين لين توصل الدائرة الصفرا', hint: { L: null, R: { x: 0, y: 0.8 } }, groundLock: true, gentle: false, short: 'ببطء',
          tick(ctx, st, dt, T) {
            const p = ctl(ctx).pitch || 0, D = st.data;
            if (st.runT < dt * 1.5) { D.s0 = -1; D.fast = false; D.r0 = 0; }
            if (kbSkip(ctx, st, T)) return 'next';
            if (Math.abs(p) < 0.08) { if (D.fast) D.r0 = st.runT; D.s0 = st.runT; D.fast = false; }
            if (p > 0.7 && D.s0 >= 0 && !D.fast) {
              if (st.runT - D.s0 >= 1.0) return 'next';
              D.fast = true; T.say(ctx, 'بسرعة! رجّعها للنص وعيدها أبطأ', 'warn');
            }
            return null;
          },
          guide: (ctx, st) => { const g = graw(st), D = st.data; g.raw.pitch = D.fast ? 0 : clamp((st.runT - (D.r0 || 0) - 0.5) * 0.4, 0, 0.85); return g; }
        },
        B.centre('ورجّعها للنص بهدوء'),
        B.stick({ x: 0.4, y: 0 }, { x: 0, y: 0.4 }, 'الحين العصاتين مع بعض: لف يمين شوي + قدام شوي — هذي حركة المحترفين', { tol: 0.15, hold: 1, short: 'مع بعض' }),
        B.centre('ممتاز! اترك العصي', { hold: 0.8 })
      ]
    },
    {
      id: 'u1l4', icon: '⚙️', title: 'تشغيل وإطفاء المحركات', gentle: false, beginner: true, wind: CALM,
      intro: {
        text: 'المحركات تشتغل بحركة اسمها CSC: العصاتين لتحت ولداخل مع بعض. وتطفي بنفس الحركة، أو بالعصا اليسار تحت لين تطفي.',
        bullets: ['CSC = اليسار تحت-يمين + اليمين تحت-يسار', 'أول ما تشتغل فك العصي', 'إطفاء: CSC أو {T} تحت 3 ثواني', 'A مطوّل = إقلاع/هبوط تلقائي'],
        diagram: { L: 'down-right', R: 'down-left' },
        realWorld: 'في DJI الحقيقي نفس حركة CSC. وفي FPV الحقيقي التشغيل (ARM) يكون بسويتش في الريموت.',
        tips: ['لا تشغل المحركات وأحد قريب من الدرون']
      },
      steps: [
        B.motorsOn('شغّل المحركات (CSC): العصاتين لتحت ولداخل مع بعض — اليسار تحت-يمين، واليمين تحت-يسار'),
        B.cond(ctx => ctx.drone.motors && C.centred(ctl(ctx), 0.1), 'اشتغلت ✓ فك العصي واسمع صوت المحركات', { hold: 1.5, hint: { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } }, guide: () => GR0 }),
        B.motorsOff('csc', 'طفّها بنفس الحركة (CSC)'),
        B.motorsOn('شغّلها مرة ثانية'),
        B.motorsOff('thr', 'الطريقة الثانية: {T} لتحت للآخر وخلها 3 ثواني — المحركات تطفي لحالها'),
        B.cond(ctx => C.air(ctx.drone, 1.0) && ctx.drone.auto !== 'takeoff', 'جرّب الإقلاع التلقائي: اضغط A مطوّل (ثانية) — يصعد متر ويثبت', { hint: null, guide: () => GA, coach: [] }),
        B.cond(ctx => ctx.drone.onGround && !ctx.drone.motors, 'وهو طاير اضغط A مطوّل مرة ثانية: هبوط تلقائي. خله ينزل لين تطفي المحركات', { hint: null, coach: [], guide: ctx => (!ctx.drone.onGround && ctx.drone.auto !== 'land') ? GA : GN })
      ]
    }
  ], {
    id: 'u1check', icon: '🏅', title: 'اختبار الوحدة 1: الريموت', check: true, wind: CALM, gentle: false,
    intro: {
      text: 'اختبار سريع: تطلع لك أهداف للعصي، حط العصا الصح بسرعة وبدون ما تحرك العصا الثانية. وبعدين شغّل وطفّ المحركات.',
      bullets: ['كل هدف خلال 4 ثواني', 'لا تحرك العصا الغلط', 'النجاح 80 وفوق'], diagram: null,
      realWorld: 'الطيار لازم يعرف العصي بدون ما يفكر — هذا اللي يخليك هادي وقت الطوارئ.'
    },
    steps: ctx => {
      const pool = [
        [{ x: 0, y: 1 }, null, 'ارفع: {T} لفوق'], [{ x: 0, y: -1 }, null, 'نزّل: {T} لتحت'], [{ x: 1, y: 0 }, null, 'لف يمين: {Y} يمين'],
        [{ x: -1, y: 0 }, null, 'لف يسار: {Y} يسار'], [null, { x: 0, y: 1 }, 'قدام: {P} لفوق'], [null, { x: 0, y: -1 }, 'ورا: {P} لتحت'],
        [null, { x: 1, y: 0 }, 'جنب يمين: {R} يمين'], [null, { x: -1, y: 0 }, 'جنب يسار: {R} يسار'],
        [{ x: 0, y: 0.5 }, null, 'صعود بطيء: {T} نص الطريق'], [null, { x: 0.5, y: 0 }, 'جنب يمين ببطء: {R} نص الطريق']
      ];
      const pick = U.pick(pool, 6, ctx.rng || Math.random), out = [];
      pick.forEach(p => { out.push(B.stick(p[0], p[1], p[2], { exam: true, tol: p[0] && p[0].y === 0.5 || p[1] && p[1].x === 0.5 ? 0.2 : 0.22 })); out.push(B.centre('رجّع العصي للنص', { exam: true })); });
      out.push(B.motorsOn('شغّل المحركات (CSC)', { tick: examSlow(8) }));
      out.push(B.motorsOff('csc', 'طفّها (CSC)', { tick: examSlow(8) }));
      return out;
    }
  });
  function examSlow(sec) { return (ctx, st, dt, T) => { if (st.stepT > sec && !st.data.sl) { st.data.sl = true; T.fault(ctx, 'minor', 'slow'); } return null; }; }

  // ---------------- 2) التشغيل والإقلاع والهبوط ----------------
  unit(2, '🛫', 'التشغيل والإقلاع والهبوط', 'الفحص قبل الطيران، الإقلاع بيدك، الهبوط الصح، والأزرار الذكية.', 'mini', [
    {
      id: 'u2l1', icon: '🧾', title: 'قبل ما تطير: الفحص', beginner: true, wind: LIGHT,
      intro: {
        text: 'كل طيار محترف يفحص قبل الإقلاع. نشيك على البطارية والأقمار والريح والمكان، وبعدين نشغل المحركات ونسمعها.',
        bullets: ['البطارية 95% أو أكثر', 'GPS: 10 أقمار أو أكثر', 'الريح أقل من 8 م/ث للمبتدئ (حد الدرون 10.7)', 'المكان فاضي: ما فيه ناس ولا أسلاك'],
        diagram: null,
        realWorld: 'في DJI Fly الحقيقي تسمع "Home point updated" لما ينحفظ مكان البيت — لا تقلع قبلها.',
        tips: ['اضغط السهم اليمين ▶ عشان تأكد كل نقطة']
      },
      steps: [
        B.ack('شوف البطارية فوق: لازم تكون مشحونة (95% أو أكثر). إذا تمام اضغط السهم اليمين ▶'),
        B.ack('شوف الأقمار (GPS) فوق: لازم 10 أو أكثر. بدونها الدرون ما يثبت ولا يعرف يرجع. تمام؟ ▶'),
        B.ack('شوف الريح 💨 فوق: وأنت مبتدئ إذا أقوى من 8 م/ث لا تطير (حد الدرون نفسه 10.7). تمام؟ ▶'),
        B.ack('تأكد المكان فاضي: ما فيه ناس قريب ولا أسلاك ولا شجر فوقك. ▶'),
        B.decide('ليش لازم تستنى الـ GPS قبل الإقلاع؟', ['عشان الدرون يحفظ مكان البيت (H) ويقدر يرجع له ويثبت مكانه', 'عشان يصير أسرع', 'عشان الكاميرا تشتغل', 'ما يحتاج تستنى'], 'الدرون يحفظ نقطة البيت وقت الإقلاع. بدون GPS ما فيه رجوع للبيت ولا تثبيت مكان.'),
        B.motorsOn('شغّل المحركات (CSC)'),
        B.cond(ctx => ctx.drone.motors, 'خلها تدور 3 ثواني واسمع: صوت غريب أو رجّة = مروحة فيها مشكلة', { hold: 3, hint: { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } }, guide: () => GR0 }),
        B.motorsOff('thr', 'طفّها: {T} لتحت للآخر 3 ثواني')
      ]
    },
    {
      id: 'u2l2', icon: '🛫', title: 'الإقلاع بيدك', lock: ['yaw', 'pitch', 'roll'], gentle: true, beginner: true, wind: LIGHT,
      intro: {
        text: 'نقلع بالعصا اليسار بس. ادفعها بهدوء لين يرتفع، وبعدين اتركها بالنص: الدرون (DJI) يثبت على ارتفاعه لحاله.',
        bullets: ['ارفع بهدوء — مو ضربة', 'اطلع فوق مترين بسرعة (هواء المراوح يرتد من الأرض تحت)', 'النص = ثبات الارتفاع'],
        diagram: { L: 'up', R: null },
        realWorld: 'في الواقع الإقلاع اليدوي نفسه. وأول مترين الدرون يتمايل شوي بسبب هواء المراوح اللي يرتد من الأرض (Ground effect).'
      },
      steps: [
        B.motorsOn('شغّل المحركات (CSC)', { lock: null }),
        B.cond(ctx => C.air(ctx.drone, 0.8), 'ادفع {T} لفوق بشويش (نص الطريق) — الدرون يقلع', { hint: { L: { x: 0, y: 0.5 }, R: null }, guide: (ctx, st) => gpos(st, 0, 0, 2.5, 2), coach: ['slam', 'fastdescent'] }),
        B.alt(3, 0.45, 0, 'كمّل لين 3 متر (شوف الرقم H تحت يسار الشاشة)', { hint: { L: { x: 0, y: 0.4 }, R: null } }),
        B.cond(ctx => { const d = ctx.drone, c = ctl(ctx); return C.air(d) && Math.abs(c.thr || 0) < 0.1 && Math.abs(d.v.y) < 0.3 && d.p.y > 2 && d.p.y < 4.5; }, 'اترك {T} ترجع للنص: شوف كيف الدرون يثبت على ارتفاعه لحاله', { hold: 3, hint: { L: { x: 0, y: 0 }, R: null }, guide: (ctx, st) => gpos(st, 0, 0, 3, 2) }),
        B.alt(5, 0.5, 2, 'ارفع لين 5 متر واثبت', { still: true }),
        B.alt(2, 0.4, 2, 'نزّل لين 2 متر واثبت', { still: true }),
        landHome(1.5, 0.8, 'هبّط: {T} لتحت شوي شوي لين يلمس الأرض — وخلها تحت لين تطفي المحركات')
      ]
    },
    {
      id: 'u2l3', icon: '🛬', title: 'الهبوط الصح (وقفة المتر)', lock: ['yaw', 'pitch', 'roll'], gentle: true, beginner: true, wind: LIGHT,
      intro: {
        text: 'الهبوط الصح: تنزل لين متر وتوقف (تتأكد إن تحته فاضي ومستوي)، وبعدين نزول بطيء جداً لين يلمس، وتخلي العصا تحت لين تطفي المحركات.',
        bullets: ['وقفة على متر', 'آخر متر: أبطأ من نص متر بالثانية', 'العصا تحت لين تطفي'],
        diagram: { L: 'down', R: null },
        realWorld: 'DJI فيه حماية هبوط تبطّئه قرب الأرض، بس لا تعتمد عليها: الأرض المايلة أو العشب الطويل يقلب الدرون.'
      },
      steps: [
        B.takeoff(4),
        B.alt(1, 0.3, 1.5, 'نزّل لين متر واحد ووقف — هذي "وقفة الأمان": تتأكد إن المكان تحته فاضي', { still: true, coach: ['fastdescent', 'slam'] }),
        landHome(1.2, 0.6, 'الحين نزول بطيء جداً لين يلمس (أبطأ من نص متر بالثانية) — وخل {T} تحت لين تطفي المحركات', { weight: 0.5 })
      ]
    },
    {
      id: 'u2l4', icon: '🤖', title: 'الإقلاع والهبوط التلقائي (A)', beginner: true, wind: LIGHT,
      intro: {
        text: 'زر A مطوّل يقلع الدرون لحاله (يثبت على متر تقريباً)، ومطوّل وهو طاير يهبطه لحاله. ولو رفعت العصا اليسار أثناء الهبوط ينلغي.',
        bullets: ['A مطوّل على الأرض = إقلاع', 'A مطوّل في الجو = هبوط', '{T} لفوق = إلغاء الهبوط'], diagram: null,
        realWorld: 'في DJI Fly الحقيقي الإقلاع والهبوط التلقائي من زر في الشاشة (تسحبه). نفس الفكرة.'
      },
      steps: [
        B.cond(ctx => C.air(ctx.drone, 1.0) && ctx.drone.auto !== 'takeoff', 'اضغط A مطوّل (ثانية): إقلاع تلقائي', { hint: null, guide: () => GA, coach: [] }),
        B.alt(4, 0.6, 1, 'ارفع بيدك لين 4 متر', { lock: ['yaw', 'pitch', 'roll'] }),
        B.cond(ctx => ctx.drone.auto === 'land', 'اضغط A مطوّل: هبوط تلقائي', { hint: null, guide: () => GA, coach: [] }),
        B.cond(ctx => ctx.drone.auto !== 'land' && C.air(ctx.drone, 0.8), 'ألغِ الهبوط: ادفع {T} لفوق', { hint: { L: { x: 0, y: 0.8 }, R: null }, guide: (ctx, st) => gpos(st, ctx.drone.p.x, ctx.drone.p.z, ctx.drone.p.y + 3, 2), coach: [] }),
        B.cond(ctx => ctx.drone.onGround && !ctx.drone.motors, 'زين ✓ الحين اضغط A مطوّل مرة ثانية وخله ينزل لين تطفي المحركات', { hint: null, coach: [], guide: ctx => (!ctx.drone.onGround && ctx.drone.auto !== 'land') ? GA : GN })
      ]
    }
  ], {
    id: 'u2check', icon: '🏅', title: 'اختبار الوحدة 2: الإقلاع والهبوط', check: true, wind: LIGHT, fence: true, maxAlt: 60,
    intro: {
      text: 'أقلع بيدك لين 3 متر، اثبت فوق المنصة 8 ثواني، انزل لين متر، وهبّط على المنصة بهدوء.',
      bullets: ['الارتفاع ±0.5 م', 'لا تبعد عن المنصة أكثر من متر', 'الهبوط بطيء'], diagram: null,
      realWorld: 'هذا أول تمرين في أي اختبار عملي حقيقي (مثل CASA و NIST).'
    },
    steps: [
      B.takeoff(3, 'شغّل وأقلع بيدك لين 3 متر'),
      B.hover(0, 0, 3, 1.0, 0.5, 8, 'اثبت فوق المنصة 8 ثواني', { band: { x: 0, z: 0, r: 1.2, alt: 3, vtol: 0.6 } }),
      B.alt(1, 0.3, 1, 'نزّل لين متر ووقف', { still: true, x: 0, z: 0 }),
      landHome(0.8, 0.7, 'هبّط على المنصة بهدوء وطفّ المحركات')
    ]
  });

  // ---------------- 3) الثبات ----------------
  unit(3, '🎯', 'الثبات', 'تعلم كيف تخلي الدرون ثابت: اترك العصي، صحح الانجراف، وتحكم بالارتفاع بالضبط.', 'mini', [
    {
      id: 'u3l1', icon: '✋', title: 'اترك العصي = يوقف', gentle: true, beginner: true, wind: LIGHT,
      intro: {
        text: 'في وضع N الدرون يثبت مكانه لحاله (GPS + كاميرا تحت). تترك العصي = يفرمل ويوقف. هذي أهم عادة أمان.',
        bullets: ['تلخبطت؟ اترك العصي', 'الدرون يحتاج ثانية أو ثنتين عشان يوقف', 'في ATTI ما يوقف لحاله (بعدين نتعلمه)'],
        diagram: { L: null, R: 'center' },
        realWorld: 'في DJI الحقيقي: إذا خفت أو تلخبطت — اترك العصي. الدرون يوقف بمكانه. (إلا في ATTI أو لو راح الـ GPS)'
      },
      steps: [
        B.takeoff(3),
        B.cond(ctx => C.air(ctx.drone) && C.centred(ctl(ctx), 0.08), 'اترك كل العصي 4 ثواني: شوف كيف الدرون ثابت لحاله', { hold: 4, hint: { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } }, guide: () => GN }),
        B.goTo(0, -5, 3, 1.5, 'ادفع {P} لقدام شوي (ربع) لين يوصل العلامة 1', { lock: ['thr', 'yaw', 'roll'], label: '1', speed: 2 }),
        B.stop('اتركها! شوف كيف يفرمل ويوقف لحاله', { lock: ['thr', 'yaw', 'roll'] }),
        B.goTo(0, 0, 3, 1.2, 'الحين {P} لتحت شوي: يرجع لين فوق المنصة', { lock: ['thr', 'yaw', 'roll'], speed: 2 }),
        B.stop('اترك العصي ووقف فوق المنصة'),
        landHome()
      ]
    },
    {
      id: 'u3l2', icon: '🧲', title: 'صحح الانجراف', gentle: true, beginner: true, wind: LIGHT,
      intro: {
        text: 'أحياناً الدرون ينزاح لحاله (ريح أو GPS يغلط). شغلك: تلاحظ بدري وتدف العصا اليمين شوي عكس الانزياح.',
        bullets: ['شوف الدرون مو الشاشة', 'تصحيح صغير وبدري أحسن من كبير ومتأخر', 'عكس الانزياح = يرجع'],
        diagram: { L: null, R: 'center' },
        realWorld: 'قرب المباني والحديد الـ GPS يغلط والدرون يمشي شوي — الطيار الشاطر يصحح بهدوء أو يحول ATTI.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -8, 3, 1.5, 'روح قدام للعمود (8 متر)', { lock: ['thr', 'yaw'] }),
        B.hover(0, -8, 3, 1.5, 0.8, 10, 'الدرون صار ينجرف لحاله! خله داخل العمود: صحح بـ {M} عكس الانجراف (10 ثواني)', {
          accumulate: true, drift: true, lock: ['yaw'], coach: ['drift', 'overcorrect', 'slam', 'altitude', 'fastdescent'],
          enter: driftOn(0.45), exit: driftOff
        }),
        landHome()
      ],
      cleanup: driftOff
    },
    {
      id: 'u3l3', icon: '📏', title: 'الارتفاع بالضبط', lock: ['yaw', 'pitch', 'roll'], gentle: true, beginner: true, wind: LIGHT,
      intro: {
        text: 'نتمرن على العصا اليسار بس: تطلع وتنزل لارتفاعات محددة وتثبت عليها. شوف رقم H تحت.',
        bullets: ['حركة صغيرة = تغيير بطيء', 'وقّف قبل الرقم بشوي', 'النص = ثبات'], diagram: { L: 'up', R: null },
        realWorld: 'في التصوير والتفتيش تحتاج ارتفاع ثابت بالضبط — والقانون يحدد أقصى ارتفاع (120 م).'
      },
      steps: [
        B.takeoff(2, null, { lock: null }),
        B.alt(4, 0.3, 2.5, 'ارفع لين 4 متر بالضبط واثبت', { still: true }),
        B.alt(6, 0.3, 2.5, 'ارفع لين 6 متر واثبت', { still: true }),
        B.alt(3, 0.3, 2.5, 'نزّل لين 3 متر واثبت', { still: true }),
        B.alt(1.5, 0.3, 2.5, 'نزّل لين متر ونص واثبت', { still: true }),
        landHome(1.5, 0.7)
      ]
    },
    {
      id: 'u3l4', icon: '🌬️', title: 'الثبات مع الريح', gentle: true, beginner: true, wind: { s: 4, g: 1.2 },
      intro: {
        text: 'الحين فيه ريح وهبات. الدرون يقاوم لحاله بس ينزاح شوي — ساعده بتصحيحات صغيرة وخله داخل العمود.',
        bullets: ['لا تلاحق كل هزة', 'صحح لما يبدأ يطلع', 'العصا اليسار بالنص'], diagram: { L: 'center', R: 'center' },
        realWorld: 'Mini 4 Pro يتحمل ريح لين 10.7 م/ث. فوق كذا لا تطير.'
      },
      steps: [
        B.takeoff(3),
        B.hover(0, -8, 3, 1.2, 0.6, 12, 'اثبت داخل العمود 12 ثانية والريح تدفه — صحح بدري وبحركات صغيرة', {
          accumulate: true, drift: true, enter: driftOn(0.25), exit: driftOff, coach: ['drift', 'overcorrect', 'slam', 'altitude', 'fastdescent', 'multistick']
        }),
        landHome()
      ],
      cleanup: driftOff
    }
  ], {
    id: 'u3check', icon: '🏅', title: 'اختبار الوحدة 3: الثبات', check: true, wind: { s: 2.5, g: 0.8 }, fence: true, maxAlt: 60,
    intro: {
      text: 'أقلع لين 2 متر، اثبت 10 ثواني داخل العمود والدرون ينجرف شوي، وبعدين هبّط على المنصة.',
      bullets: ['±0.8 م جنب و ±0.35 م ارتفاع', 'لا تطلع من العمود', 'هبوط بطيء ودقيق'], diagram: null,
      realWorld: 'نفس تمرين B1 في المناهج العالمية: ثبات مترين 10 ثواني.'
    },
    steps: [
      B.takeoff(2),
      B.goTo(0, -6, 2, 1.0, 'روح للعمود قدامك', { vtol: 0.5 }),
      B.hover(0, -6, 2, 0.8, 0.35, 10, 'اثبت 10 ثواني داخل العمود', { band: { x: 0, z: -6, r: 1.1, alt: 2, vtol: 0.5 }, enter: driftOn(0.3), exit: driftOff }),
      landHome(0.8, 0.7)
    ],
    cleanup: driftOff
  });

  // ---------------- 4) قدام وورا وجنب ----------------
  unit(4, '↔️', 'قدام وورا وجنب', 'تحرك بالعصا اليمين والدرون ظهره لك: قدام وورا ويمين ويسار، والوقوف بالضبط.', 'mini', [
    {
      id: 'u4l1', icon: '⬆️', title: 'قدام وورا', gentle: true, beginner: true, wind: LIGHT,
      intro: {
        text: 'الدرون ظهره لك (وجهه لقدام مثلك)، فالحركات طبيعية: {P} لفوق = يبعد عنك، لتحت = يقرب.',
        bullets: ['حركة صغيرة', 'اترك العصا قبل العلامة بشوي', 'يوقف لحاله في N'], diagram: { L: null, R: 'up' },
        realWorld: 'ابدأ دايم والدرون ظهره لك — أسهل وضع لأن يمينه يمينك.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -12, 3, 1.5, 'ادفع {P} لقدام شوي: الدرون يبعد عنك للعلامة 1', { lock: ['thr', 'yaw', 'roll'], label: '1' }),
        B.stop(null, { lock: ['thr', 'yaw', 'roll'] }),
        B.goTo(0, -2, 3, 1.5, 'الحين {P} لتحت شوي: يرجع صوبك للعلامة 2', { lock: ['thr', 'yaw', 'roll'], label: '2' }),
        B.stop(null, { lock: ['thr', 'yaw', 'roll'] }),
        landHome()
      ]
    },
    {
      id: 'u4l2', icon: '↔️', title: 'جنب يمين ويسار', gentle: true, beginner: true, wind: LIGHT,
      intro: {
        text: '{R} يمين ويسار = الدرون يمشي على جنبه بدون ما يلف. وجهه يبقى لقدام.',
        bullets: ['الجنب ما يلف الدرون', 'وقّف على كل علامة'], diagram: { L: null, R: 'right' },
        realWorld: 'الحركة الجانبية مهمة في التصوير والتفتيش: تمشي جنب الشي ووجه الكاميرا عليه.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -6, 3, 1.5, 'روح قدام شوي للعلامة 1', { lock: ['thr', 'yaw', 'roll'], label: '1' }),
        B.goTo(8, -6, 3, 1.5, '{R} يمين: يمشي على جنبه لليمين للعلامة 2', { lock: ['thr', 'yaw', 'pitch'], label: '2' }),
        B.stop(null, { lock: ['thr', 'yaw', 'pitch'] }),
        B.goTo(-8, -6, 3, 1.5, 'الحين {R} يسار: للعلامة 3 (16 متر)', { lock: ['thr', 'yaw', 'pitch'], label: '3' }),
        B.stop(null, { lock: ['thr', 'yaw', 'pitch'] }),
        B.goTo(0, -6, 3, 1.5, 'رجّعه للنص (العلامة 4)', { lock: ['thr', 'yaw', 'pitch'], label: '4' }),
        landHome()
      ]
    },
    {
      id: 'u4l3', icon: '🛑', title: 'وقّف بالضبط (مسافة الفرملة)', gentle: true, wind: LIGHT,
      intro: {
        text: 'الدرون ما يوقف فوراً: يحتاج مسافة عشان يفرمل (أكثر كل ما كان أسرع). اترك العصا قبل العلامة بشوي عشان يوقف عليها.',
        bullets: ['سرعة 6 م/ث تحتاج تقريباً 3-4 متر', 'اترك بدري', 'لا تتعدى العلامة'], diagram: { L: null, R: 'up' },
        realWorld: 'DJI Mini في N يحتاج 12-14 متر عشان يوقف من 12 م/ث. هذا سبب أغلب الصدمات بالجدران.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -25, 3, 1.5, 'روح للعلامة 1 (25 متر) بسرعة متوسطة — واترك العصا قبلها بشوي عشان يوقف عليها بالضبط', {
          label: '1', speed: 6, still: 0.3, hold: 1, lock: ['thr', 'yaw', 'roll'],
          tick: (ctx, st, dt, T) => { if (!st.data.o1 && ctx.drone.p.z < -28) { st.data.o1 = true; st.pen += 8; T.say(ctx, 'تعديت العلامة! المرة الجاية اترك العصا قبلها بـ 3-4 متر', 'warn'); } return null; }
        }),
        B.goTo(0, -4, 3, 1.5, 'ارجع للعلامة 2 ووقّف عليها بالضبط', {
          label: '2', speed: 6, still: 0.3, hold: 1, lock: ['thr', 'yaw', 'roll'],
          tick: (ctx, st, dt, T) => { if (!st.data.o2 && ctx.drone.p.z > -1) { st.data.o2 = true; st.pen += 8; T.say(ctx, 'تعديت! اترك العصا بدري', 'warn'); } return null; }
        }),
        landHome()
      ]
    },
    {
      id: 'u4l4', icon: '⬛', title: 'المربع ووجهه لقدام', lock: ['yaw'], gentle: true, wind: LIGHT,
      intro: {
        text: 'نطير مربع والدرون وجهه ثابت لقدام: قدام، يمين، ورا، يسار. كل الحركة بالعصا اليمين.',
        bullets: ['لا تلف الدرون', 'وقّف عند كل زاوية', 'الارتفاع ثابت'], diagram: { L: null, R: 'up' },
        realWorld: 'هذا تمرين أساسي في كل الاختبارات (Box) — يعلمك تتحرك بكل الاتجاهات بدون لف.'
      },
      steps: [
        B.takeoff(3, null, { lock: null }),
        B.embed(CT_({ title: 'المربع', short: 'المربع', pts: sq([[-5, -5, 3, 1.5], [-5, -15, 3, 1.5], [5, -15, 3, 1.5], [5, -5, 3, 1.5], [-5, -5, 3, 1.5]]), altTol: 1.2, nose: 'fixed', fixedYaw: 0, headTol: 25, par: 70, timeLimit: 900, speed: 3 }),
          'طر مربع 10×10: كل الحركة بـ {M}، ووجه الدرون ثابت لقدام', { alt: 3 }),
        landHome()
      ]
    }
  ], {
    id: 'u4check', icon: '🏅', title: 'اختبار الوحدة 4: المربع', check: true, wind: { s: 2, g: 0.6 }, fence: true, maxAlt: 60,
    intro: {
      text: 'مربع 16 متر والدرون وجهه ثابت لقدام، والارتفاع 4 متر. وبعدين هبوط على H.',
      bullets: ['الارتفاع ±1 م', 'لا تلف الدرون أكثر من 25°', 'هبوط دقيق'], diagram: null,
      realWorld: 'نفس تمرين المربع في اختبار الطيار.'
    },
    steps: [
      B.takeoff(4),
      B.embed(CT_({ title: 'المربع 16 م', short: 'المربع', pts: sq([[-8, -6, 4, 1.5], [-8, -22, 4, 1.5], [8, -22, 4, 1.5], [8, -6, 4, 1.5], [-8, -6, 4, 1.5]]), altTol: 1.0, nose: 'fixed', fixedYaw: 0, headTol: 20, par: 60, timeLimit: 300, speed: 3.5 }),
        'طر المربع ووجهه ثابت لقدام', { band: { alt: 4, vtol: 1.2, yaw: 0, htol: 25 } }),
      landHome(1.0, 0.8)
    ]
  });

  // ---------------- 5) اللف والاتجاهات ----------------
  unit(5, '🧭', 'اللف والاتجاهات', 'اللف حول النفس، و"قدام = وين ما وجهه"، والأصعب: الدرون وجهه لك.', 'mini', [
    {
      id: 'u5l1', icon: '🔄', title: 'اللف حول نفسه', gentle: true, beginner: true, wind: LIGHT,
      intro: {
        text: '{Y} يمين ويسار يلف الدرون حول نفسه وهو بمكانه. شوف الأنوار: الأحمر قدام والأخضر ورا — كذا تعرف وين وجهه.',
        bullets: ['لف بشويش', 'شوف النور الأحمر = وجهه', 'الدرون ما يتحرك من مكانه'], diagram: { L: 'right', R: null },
        realWorld: 'في الواقع من بعيد صعب تعرف وين وجهه — الأنوار والخريطة الصغيرة هي اللي تساعدك.'
      },
      steps: [
        B.takeoff(3),
        B.turn(90, 'لف يمين ربع لفة: {Y} يمين شوي. شوف النور الأحمر وين يروح'),
        B.turn(-180, 'الحين لف يسار نص لفة'),
        B.turn(90, 'رجّعه لقدام: ربع لفة يمين'),
        B.turn(360, 'لفة كاملة يمين — بشويش وثابت'),
        landHome()
      ]
    },
    {
      id: 'u5l2', icon: '🧭', title: 'قدام = وين ما وجهه', gentle: true, beginner: true, wind: LIGHT,
      intro: {
        text: 'أهم قاعدة: {P} لقدام يمشي الدرون على اتجاه وجهه هو — مو اتجاهك. لو وجهه على يمينك، قدام = يروح يمينك.',
        bullets: ['قدام = اتجاه النور الأحمر', 'غيّر الاتجاه → تتغير الحركة', 'الخريطة الصغيرة توريك وين وجهه'], diagram: { L: null, R: 'up' },
        realWorld: 'هذا اللي يلخبط المبتدئين في الواقع. تمرّن عليه لين يصير طبيعي.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -8, 3, 1.5, 'روح قدام للعلامة 1', { label: '1', lock: ['thr', 'yaw', 'roll'] }),
        B.yaw(PI / 2, 15, 1, 'لف الدرون لين يصير وجهه على يمينك (ربع لفة يمين)'),
        B.goTo(10, -8, 3, 1.5, 'الحين ادفع {P} لقدام: شوف! الدرون يروح يمينك — لأن قدام = وين ما وجهه', { label: '2', lock: ['thr', 'yaw', 'roll'] }),
        B.yaw(-PI / 2, 15, 1, 'لف لين يصير وجهه على يسارك (نص لفة)'),
        B.goTo(-2, -8, 3, 1.5, 'ادفع {P} لقدام مرة ثانية: يروح يسارك', { label: '3', lock: ['thr', 'yaw', 'roll'] }),
        B.yaw(0, 15, 1, 'رجّع وجهه لقدام (ظهره لك)'),
        landHome()
      ]
    },
    {
      id: 'u5l3', icon: '🙃', title: 'وجهه لك (الحركات معكوسة)', gentle: true, beginner: true, wind: LIGHT,
      coach: ['nosein', 'overcorrect', 'slam', 'altitude', 'fastdescent', 'drift'],
      intro: {
        text: 'لما وجه الدرون لك، يمين ويسار ينعكسون: {R} يمين = يروح يسارك. وقدام = يجي صوبك. تخيل نفسك راكب فيه.',
        bullets: ['وجهه لك = معكوس', 'تلخبطت؟ اترك العصي', 'تمرن ببطء'], diagram: { L: null, R: 'right' },
        realWorld: 'الرجوع والدرون وجهه لك يصير كثير في الواقع (وقت التصوير). هذا من أهم مهارات الاختبار.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -12, 3, 1.5, 'روح قدام للعلامة 1', { label: '1', lock: ['thr', 'yaw', 'roll'] }),
        B.yaw('pilot', 15, 1, 'لف نص لفة لين يصير وجهه لك (النور الأحمر صوبك)'),
        B.goTo(-6, -12, 3, 1.5, 'روح للعلامة 2 على يسارك. انتبه: وجهه لك، فيسارك = يمينه → ادفع {R} يمين!', { label: '2', lock: ['thr', 'yaw', 'pitch'] }),
        B.goTo(6, -12, 3, 1.5, 'الحين للعلامة 3 على يمينك: {R} يسار (معكوس)', { label: '3', lock: ['thr', 'yaw', 'pitch'] }),
        B.goTo(6, -5, 3, 1.5, 'قرّبه صوبك للعلامة 4: {P} لقدام (لأن قدامه = صوبك)', { label: '4', lock: ['thr', 'yaw', 'roll'] }),
        B.yaw('away', 15, 1, 'رجّعه ظهره لك: نص لفة'),
        landHome()
      ]
    },
    {
      id: 'u5l4', icon: '✳️', title: 'الاتجاهات الأربعة', gentle: true, wind: LIGHT,
      intro: {
        text: 'اثبت في العمود والدرون بأربع اتجاهات: ظهره لك، وجهه يمين، وجهه لك، وجهه يسار. كل واحد 5 ثواني.',
        bullets: ['الاتجاه يتغير بالعصا اليسار', 'المكان تصححه باليمين', 'كل اتجاه له تصحيح مختلف'], diagram: null,
        realWorld: 'تمرين B2 في المناهج العالمية — يبني خريطة العصي في راسك لكل اتجاه.'
      },
      steps: [
        B.takeoff(3),
        B.embed(HT_({ title: 'الاتجاهات الأربعة', short: 'الاتجاهات', x: 0, z: -10, r: 1.5, rv: 0.7, headTol: 25, timeLimit: 900, steps: ['tail', 'right', 'nose', 'left'].map(h => ({ alt: 3, hold: 5, head: h })) }),
          'روح للعمود واثبت فيه بكل اتجاه (شوف السهم الأحمر فوق العمود)'),
        landHome()
      ]
    }
  ], {
    id: 'u5check', icon: '🏅', title: 'اختبار الوحدة 5: الاتجاهات', check: true, wind: { s: 2, g: 0.6 }, fence: true, maxAlt: 60,
    intro: {
      text: 'اثبت بالأربع اتجاهات، وبعدين رجّع الدرون صوبك ووجهه لك بخط متعرج، وهبّط.',
      bullets: ['الاتجاه ±20°', 'الارتفاع ثابت', 'الوجه لك طول الرجعة'], diagram: null,
      realWorld: 'الوجه لك (Nose-in) جزء أساسي في أغلب اختبارات الطيارين.'
    },
    steps: [
      B.takeoff(3),
      B.embed(HT_({ title: 'الاتجاهات', short: 'الاتجاهات', x: 0, z: -10, r: 1.2, rv: 0.6, headTol: 20, timeLimit: 300, steps: ['tail', 'right', 'nose', 'left'].map(h => ({ alt: 3, hold: 4, head: h })) }),
        'اثبت بالأربع اتجاهات', { band: { alt: 3, vtol: 1.0 } }),
      B.embed(CT_({ title: 'الوجه لك', short: 'الوجه لك', pts: sq([[0, -30, 4, 2], [-8, -24, 4, 2], [8, -18, 4, 2], [-8, -12, 4, 2], [0, -6, 4, 2]]), altTol: 1.2, nose: 'noseIn', headTol: 30, par: 60, timeLimit: 300, speed: 3 }),
        'روح بعيد وارجع صوبك ووجهه لك طول الوقت', { band: { alt: 4, vtol: 1.4 } }),
      landHome(1.0, 0.8)
    ]
  });

  // ---------------- 6) الحركات المركبة ----------------
  unit(6, '🌀', 'الحركات المركبة', 'تخلط عصاتين مع بعض: لفة السيارة، المربع مع اللف، الدوران حول نقطة، ورقم 8.', 'mini', [
    {
      id: 'u6l1', icon: '🚗', title: 'قدام مع لف (لفة السيارة)', gentle: true, wind: LIGHT,
      intro: {
        text: 'مثل السيارة: {P} لقدام شوي و{Y} لف بنفس الوقت = الدرون يمشي بقوس ووجهه يتبع الطريق.',
        bullets: ['قدام خفيف + لف خفيف', 'لا توقف وتلف بمكانك', 'خل الحركة ناعمة'], diagram: { L: 'right', R: 'up' },
        realWorld: 'هذي طريقة الطيران الطبيعية لما تتبع شي أو تصور لقطة متحركة.'
      },
      steps: [
        B.takeoff(3),
        B.embed(CT_({ title: 'لفة حول العمود', short: 'لفة السيارة', pts: circle(0, -18, 7, 8, 3, 2.2), altTol: 1.2, nose: 'forward', headTol: 45, par: 80, timeLimit: 900, speed: 3, pylons: [{ x: 0, z: -18, h: 6 }] }),
          'لف حول العمود مثل السيارة: {P} لقدام شوي + {Y} لف بنفس الوقت', { combo: true }),
        landHome()
      ]
    },
    {
      id: 'u6l2', icon: '🔄', title: 'المربع مع اللف', gentle: true, wind: LIGHT,
      intro: {
        text: 'نفس المربع، بس وجه الدرون يلف مع الطريق في كل زاوية. يعني دايم تمشي لقدام.',
        bullets: ['عند الزاوية: لف ربع لفة', 'بعدين قدام', 'الوجه على الطريق'], diagram: { L: 'right', R: 'up' },
        realWorld: 'هذا اللي تسويه في المسح والتصوير: الكاميرا دايم على الطريق اللي قدامك.'
      },
      steps: [
        B.takeoff(4),
        B.embed(CT_({ title: 'المربع مع اللف', short: 'المربع مع اللف', pts: sq([[-10, -10, 4, 2], [-10, -30, 4, 2], [10, -30, 4, 2], [10, -10, 4, 2], [-10, -10, 4, 2]]), altTol: 1.5, nose: 'forward', headTol: 40, par: 90, timeLimit: 900, speed: 3.5 }),
          'طر المربع ووجه الدرون على الطريق: عند كل زاوية لف وبعدين قدام', { combo: true }),
        landHome()
      ]
    },
    {
      id: 'u6l3', icon: '🎡', title: 'الدوران حول نقطة (Orbit)', gentle: true, wind: LIGHT,
      intro: {
        text: 'تلف حول التمثال ووجه الدرون عليه: {R} جنب + {Y} لف عكسها بنفس الوقت. هذي لقطة المصورين المشهورة.',
        bullets: ['جنب يمين + لف يسار (أو العكس)', 'المسافة ثابتة', 'الوجه على التمثال'], diagram: { L: 'left', R: 'right' },
        realWorld: 'المحترفين يسوونها يدوي بدون Intelligent Flight — لقطة ناعمة وثابتة.'
      },
      steps: [
        B.takeoff(4),
        B.embed(OT_({ title: 'الدوران حول التمثال', short: 'الدوران', x: 0, z: -22, R: 8, band: 2, alt: 4, altTol: 1.2, headTol: 30, deg: 270, timeLimit: 900 }),
          'لف حول التمثال ووجهه عليه: {R} جنب + {Y} لف عكسها بنفس الوقت (ثلاث أرباع لفة)', { combo: true }),
        landHome()
      ]
    },
    {
      id: 'u6l4', icon: '♾️', title: 'رقم 8', gentle: true, wind: LIGHT,
      intro: {
        text: 'شكل رقم 8 حول عمودين: لفة يمين ولفة يسار ورا بعض، والوجه على الطريق. تمرين التنسيق الأشهر.',
        bullets: ['السرعة ثابتة', 'لا تلمس العواميد', 'الوجه لقدام'], diagram: { L: 'right', R: 'up' },
        realWorld: 'رقم 8 جزء من اختبار BMFA و CASA للطيارين.'
      },
      steps: [
        B.takeoff(4),
        B.embed(CT_({ title: 'رقم 8', short: 'رقم 8', pts: sq([[0, -28, 4, 2.4], [9, -37, 4, 2.4], [18, -28, 4, 2.4], [9, -19, 4, 2.4], [0, -28, 4, 2.4], [-9, -37, 4, 2.4], [-18, -28, 4, 2.4], [-9, -19, 4, 2.4], [0, -28, 4, 2.4]]), altTol: 1.5, nose: 'forward', headTol: 50, par: 95, timeLimit: 900, speed: 3.5, pylons: [{ x: -9, z: -28, h: 7 }, { x: 9, z: -28, h: 7 }] }),
          'طر رقم 8 حول العمودين ووجهه على الطريق', { combo: true }),
        landHome()
      ]
    }
  ], {
    id: 'u6check', icon: '🏅', title: 'اختبار الوحدة 6: الحركات المركبة', check: true, wind: { s: 2.5, g: 0.8 }, fence: true, maxAlt: 60,
    intro: {
      text: 'سلالوم بين العواميد، وبعدها رقم 8 كامل، وهبوط على H.',
      bullets: ['لا تلمس العواميد', 'الارتفاع ثابت', 'الوجه على الطريق'], diagram: null,
      realWorld: 'التنسيق بين العصاتين هو اللي يفرق الطيار المتمكن.'
    },
    steps: [
      B.takeoff(3),
      B.embed(CT_({ title: 'سلالوم', short: 'سلالوم', pts: [[-5, -15], [5, -27], [-5, -39], [5, -51], [0, -62]].map(([x, z]) => ({ x, z, alt: 3, r: 2.6 })), altTol: 1.5, nose: 'forward', headTol: 55, par: 60, timeLimit: 300, speed: 3.5, pylons: [-15, -27, -39, -51].map(z => ({ x: 0, z, h: 7 })) }),
        'طر بين العواميد يمين ويسار', { band: { alt: 3, vtol: 1.5 } }),
      B.embed(CT_({ title: 'رقم 8', short: 'رقم 8', pts: sq([[0, -28, 4, 2.4], [9, -37, 4, 2.4], [18, -28, 4, 2.4], [9, -19, 4, 2.4], [0, -28, 4, 2.4], [-9, -37, 4, 2.4], [-18, -28, 4, 2.4], [-9, -19, 4, 2.4], [0, -28, 4, 2.4]]), altTol: 1.5, nose: 'forward', headTol: 50, par: 95, timeLimit: 300, speed: 3.5, pylons: [{ x: -9, z: -28, h: 7 }, { x: 9, z: -28, h: 7 }] }),
        'الحين رقم 8 حول العمودين', { band: { alt: 4, vtol: 1.5 } }),
      landHome(1.0, 0.8)
    ]
  });

  // ---------------- 7) الارتفاع مع الحركة ----------------
  unit(7, '📈', 'الارتفاع مع الحركة', 'تطلع وتنزل وأنت ماشي: الطلعة المايلة، النزول الآمن (بدون دوامة)، والمستطيل العمودي.', 'mini', [
    {
      id: 'u7l1', icon: '↗️', title: 'اطلع وأنت ماشي', gentle: true, wind: LIGHT,
      intro: {
        text: '{P} لقدام و{T} لفوق مع بعض = طلعة مايلة مثل الطيارة. خل الطلعة ناعمة ومستمرة.',
        bullets: ['قدام + فوق بنفس الوقت', 'شوف H يزيد شوي شوي', 'لا توقف بين العلامات'], diagram: { L: 'up', R: 'up' },
        realWorld: 'الطلعة المايلة تستخدم في لقطات الكشف (Reveal) وفي الطيران فوق العوائق.'
      },
      steps: [
        B.takeoff(3),
        B.embed(CT_({ title: 'الطلعة المايلة', short: 'طلعة مايلة', pts: [{ x: 0, z: -8, alt: 3, r: 2 }, { x: 0, z: -18, alt: 7, r: 2 }, { x: 0, z: -28, alt: 11, r: 2 }, { x: 0, z: -38, alt: 15, r: 2 }], altTol: 1.5, nose: 'fixed', fixedYaw: 0, headTol: 30, par: 50, timeLimit: 900, speed: 3 }),
          'ادفع {P} لقدام و{T} لفوق مع بعض: طلعة مايلة للعلامات', { combo: true }),
        landHome()
      ]
    },
    {
      id: 'u7l2', icon: '↘️', title: 'انزل مايل (مو عمودي)', gentle: true, wind: LIGHT,
      always: (ctx, st, dt, T) => { if (ctx.drone.vrs && !st.data.vrs) { st.data.vrs = true; st.pen += 15; T.tip('دخلت دوامة المراوح: انزل مايل أو أبطأ'); } },
      intro: {
        text: 'النزول العمودي السريع يدخل الدرون في هواء مراوحه نفسه (دوامة VRS) فيرتج ويطيح. الحل: انزل وأنت ماشي (مايل) أو ببطء.',
        bullets: ['نزول مايل = آمن', 'لو ارتج: دفه لقدام أو جنب', 'لا تنزل عمودي بأقصى سرعة'], diagram: { L: 'down', R: 'down' },
        realWorld: 'الدوامة تصير فعلاً للدرونات الصغيرة لما تنزل أسرع من 1-2 م/ث عمودي.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -35, 15, 3, 'اطلع لين 15 متر وروح للعلامة 1 (35 متر قدام)', { label: '1', speed: 4, vtol: 2 }),
        B.decide('أنت على 15 متر وتبي تنزل. وش أأمن طريقة؟', ['تنزل وأنت ماشي (مايل) أو ببطء', 'تنزل عمودي بأقصى سرعة', 'تطفي المحركات وتخليه يطيح', 'تنزل وأنت تلف بسرعة'], 'النزول العمودي السريع يدخل الدرون في دوامة مراوحه (VRS). النزول المايل يخليه يطلع من هواه.'),
        B.embed(CT_({ title: 'النزول المايل', short: 'نزول مايل', pts: [{ x: 0, z: -35, alt: 15, r: 3 }, { x: 0, z: -25, alt: 11, r: 2 }, { x: 0, z: -15, alt: 7, r: 2 }, { x: 0, z: -5, alt: 3, r: 2 }], altTol: 1.6, nose: 'fixed', fixedYaw: 0, headTol: 30, par: 50, timeLimit: 900, speed: 3 }),
          'ارجع صوبك وانزل بنفس الوقت: {P} لتحت + {T} لتحت شوي', { combo: true }),
        landHome()
      ]
    },
    {
      id: 'u7l3', icon: '⬜', title: 'المستطيل العمودي', gentle: true, beginner: true, wind: LIGHT,
      intro: {
        text: 'نرسم مستطيل في الهوا قدامك: جنب يمين، فوق، جنب يسار، تحت. كل حركة بعصا وحدة ووقف بين كل حركة.',
        bullets: ['حركة وحدة كل مرة', 'وقّف بين كل حركة', 'وجهه لقدام'], diagram: { L: 'up', R: 'right' },
        realWorld: 'تمرين CASA للتفتيش: تمشي على وجه مبنى أو برج بخطوط مستقيمة.'
      },
      steps: [
        B.takeoff(2),
        B.goTo(-5, -10, 2, 1.2, 'روح للعلامة 1', { label: '1', vtol: 0.8, lock: ['yaw'] }),
        B.goTo(5, -10, 2, 1.2, '{R} يمين: جنب للعلامة 2', { label: '2', vtol: 0.8, lock: ['thr', 'yaw', 'pitch'], still: 0.4 }),
        B.goTo(5, -10, 8, 1.2, '{T} لفوق: اطلع عمودي للعلامة 3 (8 متر)', { label: '3', vtol: 0.8, lock: ['yaw', 'pitch', 'roll'], still: 0.4 }),
        B.goTo(-5, -10, 8, 1.2, '{R} يسار: جنب للعلامة 4', { label: '4', vtol: 0.8, lock: ['thr', 'yaw', 'pitch'], still: 0.4 }),
        B.goTo(-5, -10, 2, 1.2, '{T} لتحت: انزل بهدوء للعلامة 5', { label: '5', vtol: 0.8, lock: ['yaw', 'pitch', 'roll'], still: 0.4 }),
        landHome()
      ]
    },
    {
      id: 'u7l4', icon: '🏁', title: 'بوابات بارتفاعات مختلفة', gentle: true, wind: LIGHT,
      intro: {
        text: 'ادخل من نص البوابات وكل وحدة على ارتفاع مختلف: لازم تغير الارتفاع وأنت تقرب منها.',
        bullets: ['جهّز الارتفاع قبل البوابة', 'ادخل من النص', 'مع اتجاه السهم'], diagram: { L: 'up', R: 'up' },
        realWorld: 'نفس مهارة الطيران بين الشجر أو تحت الجسور.'
      },
      steps: [
        B.takeoff(3),
        B.embed(CT_({ title: 'البوابات', short: 'البوابات', pts: (() => { let px = 0, pz = 0; return [[0, -18, 4], [-14, -38, 6], [0, -58, 8], [18, -42, 5], [10, -20, 3]].map(([x, z, alt]) => { const yaw = U.bearing(px, pz, x, z); px = x; pz = z; return { x, z, alt, gate: true, R: 1.9, yaw }; }); })(), altTol: 3, nose: 'any', headTol: 60, par: 80, timeLimit: 900, speed: 3 }),
          'ادخل من نص البوابات بالترتيب (مع اتجاه السهم)'),
        landHome()
      ]
    }
  ], {
    id: 'u7check', icon: '🏅', title: 'اختبار الوحدة 7: الارتفاع مع الحركة', check: true, wind: { s: 2.5, g: 0.8 }, fence: true, maxAlt: 60,
    always: (ctx, st, dt, T) => { if (ctx.drone.vrs && !st.data.vrs) { st.data.vrs = true; T.fault(ctx, 'major', 'vrs'); } },
    intro: {
      text: 'مسار بخمس علامات على ارتفاعات مختلفة ووجهه على الطريق، بدون دوامة مراوح، وهبوط.',
      bullets: ['غيّر الارتفاع وأنت ماشي', 'لا تنزل عمودي بسرعة', 'هبوط دقيق'], diagram: null,
      realWorld: 'الطيار الشاطر يغير الارتفاع بنعومة وهو ماشي.'
    },
    steps: [
      B.takeoff(3),
      B.embed(CT_({ title: 'مسار الارتفاعات', short: 'الارتفاعات', pts: [{ x: 0, z: -10, alt: 3, r: 2.2 }, { x: 10, z: -25, alt: 8, r: 2.2 }, { x: 0, z: -40, alt: 12, r: 2.2 }, { x: -10, z: -25, alt: 6, r: 2.2 }, { x: 0, z: -12, alt: 3, r: 2.2 }], altTol: 1.5, nose: 'forward', headTol: 50, par: 70, timeLimit: 300, speed: 3.5 }),
        'طر المسار: كل علامة على ارتفاع مختلف'),
      landHome(1.0, 0.8)
    ]
  });

  // ---------------- 8) أوضاع الطيران C/N/S/ATTI ----------------
  unit(8, '🎛️', 'أوضاع الطيران C/N/S/ATTI', 'C ناعم للتصوير، N العادي، S السريع، و ATTI بدون تثبيت — متى تستخدم كل واحد.', 'mini', [
    {
      id: 'u8l1', icon: '🎬', title: 'وضع C (سينمائي)', gentle: false, wind: LIGHT, modeCycle: ['C', 'P', 'S'],
      intro: {
        text: 'وضع C بطيء وناعم (أقصى 6 م/ث ولف بطيء) — للتصوير الناعم وللأماكن الضيقة. السهم تحت ▼ يحوله C.',
        bullets: ['C = بطيء وناعم', 'العصا للآخر = 6 م/ث بس', 'الفرامل ناعمة وأطول'], diagram: null,
        realWorld: 'في DJI الحقيقي سويتش C/N/S على الريموت. C ممتاز للمبتدئ في مكان ضيق.'
      },
      steps: [
        B.takeoff(3),
        B.mode('C', 'اضغط السهم تحت ▼ لين يصير الوضع C (شوف فوق يسار)'),
        B.goTo(0, -30, 3, 2, 'ادفع {P} لقدام للآخر: شوف السرعة ما تتعدى 6 م/ث — بطيء وناعم للتصوير', { label: '1', speed: 6, wantMode: 'C', coach: ['mode', 'fastdescent'], lock: ['thr', 'yaw', 'roll'] }),
        B.stop('اترك العصا: يفرمل بنعومة (ياخذ وقت)'),
        B.goTo(0, -4, 3, 2, 'ارجع صوبك للعلامة 2', { label: '2', speed: 6, wantMode: 'C', coach: ['mode', 'fastdescent'], lock: ['thr', 'yaw', 'roll'] }),
        B.mode('P', 'رجّعه N: السهم فوق ▲'),
        landHome()
      ]
    },
    {
      id: 'u8l2', icon: '🏎️', title: 'وضع S (رياضي)', gentle: false, wind: LIGHT, modeCycle: ['C', 'P', 'S'],
      intro: {
        text: 'وضع S سريع (16 م/ث)، وعلى هالسرعة يحتاج مسافة أطول بكثير عشان يوقف، وحساسات العوائق تطفي! استخدمه للريح القوية أو الرجعة السريعة بس.',
        bullets: ['S = سريع', 'على السرعة العالية يحتاج مسافة كبيرة يوقف', 'ما فيه حساسات عوائق'], diagram: null,
        realWorld: 'في الواقع S يفيدك لما الريح أقوى من الدرون. وعلى سرعة S العالية DJI ينصح تخلي 30 متر فاضية قدامك على الأقل عشان يوقف. غير كذا خلك على N.'
      },
      steps: [
        B.takeoff(5),
        B.mode('S', 'اضغط السهم فوق ▲ لين يصير S. انتبه: سريع ويحتاج مسافة أطول يوقف'),
        B.goTo(0, -60, 5, 3, 'روح للعلامة البعيدة (60 متر) بسرعة', { label: '1', speed: 14, wantMode: 'S', coach: ['mode', 'fastdescent'], lock: ['thr', 'yaw', 'roll'] }),
        B.stop('اترك العصا: شوف كم مشى قبل ما يوقف!'),
        B.goTo(0, -8, 5, 3, 'ارجع — واترك العصا بدري (قبل العلامة بـ 15 متر)', { label: '2', speed: 12, wantMode: 'S', coach: ['mode'], lock: ['thr', 'yaw', 'roll'] }),
        B.stop(),
        B.mode('P', 'رجّعه N: السهم تحت ▼'),
        landHome()
      ]
    },
    {
      id: 'u8l3', icon: '🎈', title: 'ATTI: الدرون ما يثبت لحاله', gentle: true, wind: { s: 3, g: 0.4, dir: 90 },
      coach: ['drift', 'overcorrect', 'slam', 'altitude', 'fastdescent', 'wind'],
      intro: {
        text: 'في ATTI ما فيه GPS يثبت المكان ولا فرامل: تترك العصي = الدرون يمشي مع الريح. لازم تصحح بيدك طول الوقت.',
        bullets: ['ATTI = السهم اليسار ◀', 'الارتفاع يثبت، المكان لا', 'ادفع عكس الانجراف شوي'], diagram: { L: null, R: 'right' },
        realWorld: 'الدرون الحقيقي يدخل ATTI لحاله لو راح الـ GPS (قرب المباني، داخل، أو تشويش) — هذي المهارة اللي تنقذه.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -8, 3, 1.5, 'روح للعلامة', { label: '1' }),
        B.mode('A', 'اضغط السهم اليسار ◀: وضع ATTI (بدون تثبيت مكان)'),
        B.wait(4, 'اترك العصي 4 ثواني وشوف: الدرون ينجرف مع الريح! ما فيه فرامل', GR0, { hint: { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } }, coach: [] }),
        B.goTo(0, -8, 3, 2, 'رجّعه للعلامة بيدك: ادفع العصا عكس الانجراف', { label: '1' }),
        B.hover(0, -8, 3, 2.5, 1.0, 8, 'اثبت قريب من العلامة 8 ثواني — لازم تخلي العصا مدفوعة شوي ضد الريح', { accumulate: true }),
        B.mode('P', 'رجّعه N: السهم اليسار ◀ مرة ثانية'),
        landHome()
      ]
    },
    {
      id: 'u8l4', icon: '🖐️', title: 'ATTI: وقّفه بيدك', gentle: true, wind: LIGHT,
      coach: ['drift', 'overcorrect', 'slam', 'altitude', 'fastdescent'],
      intro: {
        text: 'في ATTI إذا تركت العصا الدرون يكمل ماشي (ما يفرمل). عشان يوقف: قبل العلامة ادفع العصا عكس الحركة شوي لين يوقف.',
        bullets: ['ما فيه فرامل', 'العكس شوي = فرامل', 'ابدأ تفرمل بدري'], diagram: { L: null, R: 'down' },
        realWorld: 'هذا الفرق بين DJI العادي و ATTI والـ FPV: لازم أنت اللي توقفه.'
      },
      steps: [
        B.takeoff(3),
        B.mode('A', 'حوّله ATTI: السهم اليسار ◀'),
        B.goTo(0, -25, 3, 2, 'روح للعلامة (25 متر) ووقّفه عليها: قبلها ادف {P} لورا شوي عشان يفرمل', { label: '1', still: 0.5, hold: 1.5, speed: 4 }),
        B.goTo(0, -5, 3, 2, 'ارجعه للعلامة 2 ووقّفه بيدك', { label: '2', still: 0.5, hold: 1.5, speed: 4 }),
        B.mode('P', 'رجّعه N: السهم اليسار ◀'),
        landHome()
      ]
    }
  ], {
    id: 'u8check', icon: '🏅', title: 'اختبار الوحدة 8: الأوضاع', check: true, wind: { s: 2.5, g: 0.6 }, fence: true, maxAlt: 60, modeCycle: ['C', 'P', 'S'],
    intro: {
      text: 'استخدم الوضع الصح لكل مهمة: C للقطة الناعمة، S للرجعة السريعة، ATTI ثبات بيدك، وN للهبوط.',
      bullets: ['الوضع الغلط = خطأ', 'ATTI: داخل 3.5 متر', 'هبوط على H'], diagram: null,
      realWorld: 'اختيار الوضع الصح جزء من قرار الطيار في كل رحلة.'
    },
    always: (ctx, st, dt, T) => {
      const s = T.step; if (!s || !s.wantMode) return;
      const bad = !ctx.drone.onGround && ctx.drone.mode !== s.wantMode;
      st.data.mt = bad ? (st.data.mt || 0) + dt : 0;
      if (st.data.mt > 8 && st.data.mk !== st.k) { st.data.mk = st.k; T.fault(ctx, 'minor', 'mode'); }
    },
    steps: [
      B.takeoff(3),
      B.mode('C', 'لقطة ناعمة: حوّل C (السهم تحت ▼)', { wantMode: 'C' }),
      B.goTo(0, -30, 4, 2.5, 'روح للعلامة 1 بوضع C', { label: '1', speed: 5.5, wantMode: 'C' }),
      B.mode('S', 'رجعة سريعة: حوّل S (السهم فوق ▲ مرتين)', { wantMode: 'S' }),
      B.goTo(0, -6, 4, 3, 'ارجع بسرعة للعلامة 2 بوضع S', { label: '2', speed: 10, wantMode: 'S' }),
      B.mode('P', 'رجّعه N (السهم تحت ▼)', { wantMode: 'P' }),
      B.mode('A', 'تدريب: حوّل ATTI (السهم اليسار ◀)', { wantMode: 'A' }),
      B.hover(0, -6, 4, 3.5, 1.2, 8, 'اثبت بيدك داخل الدائرة 8 ثواني', { wantMode: 'A', accumulate: true, band: { x: 0, z: -6, r: 4.5, alt: 4, vtol: 1.5 } }),
      B.mode('P', 'رجّعه N (السهم اليسار ◀)', { wantMode: 'P' }),
      landHome(1.0, 0.8)
    ]
  });

  // ---------------- 9) الطيران في الريح ----------------
  unit(9, '💨', 'الطيران في الريح', 'تقرأ الريح، تعرف إنها أقوى فوق، تصحح لها في ATTI، وتتعامل مع الهبات.', 'mini', [
    {
      id: 'u9l1', icon: '🧭', title: 'اقرأ الريح', gentle: true, wind: { s: 5, g: 0.8, dir: 0 },
      intro: {
        text: 'قبل وأثناء الطيران اعرف الريح: من وين جاية وقد إيش. ضد الريح الدرون أبطأ، ومع الريح أسرع والفرامل أطول.',
        bullets: ['شوف 💨 فوق: السرعة ومن وين', 'الدرون يميل ضد الريح عشان يثبت', 'مع الريح: وقّف بدري'], diagram: null,
        realWorld: 'ابدأ رحلتك دايم ضد الريح، عشان الرجعة (والبطارية أضعف) تكون مع الريح.'
      },
      steps: [
        B.takeoff(3),
        B.ack('شوف مؤشر الريح 💨 فوق: الريح جاية من الشمال (من قدامك)، والدرون مايل شوي ضدها عشان يثبت. فهمت؟ ▶'),
        B.goTo(0, -30, 4, 2, 'روح لقدام ضد الريح للعلامة 1: لاحظ إنه أبطأ ويميل أكثر', { label: '1', speed: 6 }),
        B.goTo(0, -6, 4, 2, 'ارجع مع الريح للعلامة 2: أسرع! اترك العصا بدري', { label: '2', speed: 6, still: 0.4, hold: 1 }),
        landHome()
      ]
    },
    {
      id: 'u9l2', icon: '🏔️', title: 'الريح فوق أقوى', gentle: true, wind: { s: 3, g: 0.8, dir: 270 },
      always: (ctx, st, dt) => {   // الريح تزيد مع الارتفاع (مضخمة شوي عشان تحسها)
        st.data.wT = (st.data.wT || 0) + dt; if (st.data.wT < 0.5) return; st.data.wT = 0;
        const y = ctx.drone.p.y, s = 3 + 5 * U.smoothstep(8, 30, y);
        if (Math.abs((st.data.ws || 3) - s) > 0.2) { st.data.ws = s; ctx.env.wind.set(s, 270, 0.8 + 0.6 * U.smoothstep(8, 30, y)); }
      },
      cleanup: ctx => { ctx.env.wind.set(3, 270, 0.8); },
      intro: {
        text: 'الريح تحت أخف بسبب الأرض والشجر، وكل ما ارتفعت تقوى. إذا الريح تتعبك فوق — انزل.',
        bullets: ['فوق = ريح أقوى', 'تحذير الريح = انزل', 'الرجعة ضد الريح؟ انزل واطي'], diagram: null,
        realWorld: 'ممكن تكون الريح 4 م/ث عندك و 9 م/ث على 100 متر. الدرون ينسحب بعيد وما يقدر يرجع.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -10, 32, 3, 'اطلع لين 32 متر (فوق العلامة): الريح فوق أقوى — شوف الدرون كيف يميل', { label: '1', speed: 3, vtol: 3 }),
        B.wait(4, 'شوف كيف يتعب عشان يثبت مكانه، وشوف الريح 💨 فوق كم صارت', null, { coach: [] }),
        B.goTo(0, -10, 8, 2.5, 'نزّل لين 8 متر: الريح تحت أخف بكثير', { label: '2', speed: 3, vtol: 1.5 }),
        landHome()
      ]
    },
    {
      id: 'u9l3', icon: '🎈', title: 'ATTI ضد الريح', gentle: true, wind: { s: 4, g: 0.6, dir: 90 }, coach: ['drift', 'overcorrect', 'slam', 'altitude', 'fastdescent'],
      intro: {
        text: 'في ATTI مع ريح ثابتة: عشان يثبت لازم تخلي العصا مدفوعة ضد الريح بشكل ثابت (مو ضربات). وعشان تمشي: زيد أو نقص هالدفة.',
        bullets: ['دفة ثابتة ضد الريح', 'لا ضربات', 'شوف الدرون مو العصا'], diagram: { L: null, R: 'right' },
        realWorld: 'نفس اللي يسويه طيار الـ FPV والطيار اليدوي دايم — تعويض الريح.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -8, 3, 1.5, 'روح للعلامة', { label: '1' }),
        B.mode('A', 'حوّله ATTI: السهم اليسار ◀'),
        B.hover(0, -8, 3, 2.5, 1.0, 10, 'اثبت داخل الدائرة 10 ثواني: دف العصا ضد الريح بشكل ثابت', { accumulate: true }),
        B.goTo(10, -8, 3, 2.5, 'روح على جنب للعلامة 2 (ضد الريح — بتحتاج دفة أقوى)', { label: '2', speed: 3 }),
        B.goTo(-6, -8, 3, 2.5, 'ارجع مع الريح للعلامة 3 — وقّفه بدري', { label: '3', speed: 3 }),
        B.mode('P', 'رجّعه N: السهم اليسار ◀'),
        landHome()
      ]
    },
    {
      id: 'u9l4', icon: '🌪️', title: 'الهبات المفاجئة', gentle: true, wind: { s: 3, g: 1.5 },
      always: (ctx, st, dt) => {
        if (st.k < 1) return;
        st.data.gT = (st.data.gT || 0) + dt;
        if (st.data.gT > 7) { st.data.gT = 0; if (ctx.env.wind.gustEvent) ctx.env.wind.gustEvent(Math.floor((ctx.rng ? ctx.rng() : 0.5) * 8) * 45, 4.5, 2); }
      },
      intro: {
        text: 'الهبة: ريح قوية فجأة لثانيتين. الدرون ينزاح ويرجع. لا تخاف ولا تضرب العصا — صحح بهدوء.',
        bullets: ['الهبة تجي وتروح', 'تصحيح هادي', 'قريب من مباني = هبات أكثر'], diagram: null,
        realWorld: 'جنب المباني والجدران الهبات قوية ومفاجئة — خل مسافة.'
      },
      steps: [
        B.takeoff(3),
        B.hover(0, -8, 3, 1.5, 0.7, 15, 'اثبت داخل العمود 15 ثانية — بتجيك هبات قوية فجأة: صحح بهدوء وبدري', { accumulate: true, drift: true }),
        landHome()
      ]
    }
  ], {
    id: 'u9check', icon: '🏅', title: 'اختبار الوحدة 9: الريح', check: true, wind: { s: 4.5, g: 1.2, dir: 0 }, fence: true, maxAlt: 60,
    intro: {
      text: 'في ATTI والريح 4.5 م/ث: روح ضد الريح للعلامة، اثبت 6 ثواني، ارجع مع الريح ووقّفه بيدك، وهبّط بوضع N.',
      bullets: ['ATTI = بيدك', 'داخل 4 متر', 'هبوط داخل 1.5 متر'], diagram: null,
      realWorld: 'الريح أكثر شي يطيّح الدرونات الصغيرة — هالاختبار يثبت إنك تقدر عليها.'
    },
    steps: [
      B.takeoff(3),
      B.mode('A', 'حوّله ATTI (السهم اليسار ◀)'),
      B.goTo(0, -25, 4, 3, 'روح ضد الريح للعلامة 1', { label: '1', speed: 3.5 }),
      B.hover(0, -25, 4, 3, 1.2, 6, 'اثبت 6 ثواني', { accumulate: true, band: { x: 0, z: -25, r: 4.5, alt: 4, vtol: 1.6 } }),
      B.goTo(0, -8, 4, 3, 'ارجع مع الريح للعلامة 2 ووقّفه بيدك', { label: '2', speed: 3.5, still: 0.8, hold: 1 }),
      B.mode('P', 'رجّعه N (السهم اليسار ◀)'),
      landHome(1.5, 0.8)
    ]
  });

  // ---------------- 10) الهبوط الدقيق ----------------
  unit(10, '🛬', 'الهبوط الدقيق', 'الهبوط على منصة بعيدة، والدرون جاي صوبك، وإلغاء الهبوط، والهبوط مع ريح جانبية.', 'mini', [
    {
      id: 'u10l1', icon: '🎯', title: 'الهبوط على منصة بعيدة', gentle: true, wind: LIGHT, pads: [{ x: 10, z: -15, r: 0.8, label: '1' }],
      intro: {
        text: 'الطريقة: روح فوق المنصة على 5 متر → وقف فوقها بالضبط → نزّل لين متر ووقف → نزول بطيء جداً لين يلمس.',
        bullets: ['وقف فوقها أول', 'وقفة المتر', 'آخر متر أقل من نص متر بالثانية'], diagram: { L: 'down', R: 'center' },
        realWorld: 'نفس طريقة الهبوط في اختبار NIST — هناك الدائرة أصغر (قطرها 60 سم بس)، فهنا تتدرب على الطريقة وبعدين تصغّر.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(10, -15, 5, 1.5, 'روح فوق المنصة 1 على 5 متر', { label: '' }),
        B.hover(10, -15, 5, 0.6, 0.6, 2, 'وقف فوقها بالضبط — ثانيتين'),
        B.alt(1, 0.3, 1, 'نزّل لين متر ووقف (وقفة الأمان)', { still: true, x: 10, z: -15 }),
        B.land(10, -15, 0.8, 0.5, 'نزول بطيء جداً لين يلمس، وخل {T} تحت لين تطفي المحركات', { home: true, label: '1', weight: 0.6 })
      ]
    },
    {
      id: 'u10l2', icon: '🙃', title: 'الهبوط وهو جاي صوبك', gentle: true, wind: LIGHT, pads: [{ x: 0, z: -5, r: 0.8, label: '2' }],
      coach: ['nosein', 'overcorrect', 'slam', 'fastdescent', 'drift'],
      intro: {
        text: 'ترجع الدرون صوبك ووجهه لك وتهبطه على منصة قدامك. انتبه: يمين ويسار معكوسة.',
        bullets: ['وجهه لك = معكوس', 'بطيء وأنت قريب', 'وقف فوق المنصة قبل النزول'], diagram: null,
        realWorld: 'أغلب الهبوطات في الواقع تكون والدرون جاي صوبك.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -30, 4, 2, 'روح بعيد للعلامة 1', { label: '1' }),
        B.yaw('pilot', 15, 1, 'لف لين يصير وجهه لك'),
        B.goTo(0, -5, 3, 1, 'رجّعه صوبك فوق المنصة 2 — وجهه لك: يمين ويسار معكوسة!', { label: '', speed: 2.5, still: 0.4 }),
        B.land(0, -5, 0.8, 0.6, 'نزّله عليها بهدوء', { home: true, label: '2', weight: 0.5 })
      ]
    },
    {
      id: 'u10l3', icon: '↩️', title: 'إلغاء الهبوط (Go-around)', gentle: true, wind: LIGHT,
      pads: [{ x: 0, z: -12, r: 1, label: 'A' }, { x: 10, z: -12, r: 1, label: 'B' }],
      always: (ctx, st, dt, T) => {
        const P = st.data.pp; if (!P) return;
        const dx = 0 - P.x; if (Math.abs(dx) > 0.05) { P.x += Math.sign(dx) * Math.min(Math.abs(dx), 1.6 * dt); if (P.h) P.h.move(P.x, 0, -12, PI / 2); P.m.x = P.x; }
        const d = ctx.drone;
        if (d.onGround && st.data.armed && U.dist2(d.p.x, d.p.z, 0, -12) < 1.6) return 'fail:نزلت والشخص على المنصة!';
      },
      intro: {
        text: 'لو صار شي وأنت تهبط (أحد دخل، ريح، المكان مو مستوي) — لا تكمل! ارفع (Go-around) وروح لمكان ثاني. هذا قرار المحترف مو خطأ.',
        bullets: ['شفت خطر؟ ارفع فوراً', 'روح لمنصة ثانية', 'لا تنزل على ناس'], diagram: { L: 'up', R: null },
        realWorld: 'في الاختبارات الحقيقية إلغاء الهبوط مهارة مطلوبة — وتنحسب لك مو عليك.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -12, 5, 1.2, 'روح فوق المنصة A على 5 متر', { label: '' }),
        B.cond(ctx => C.air(ctx.drone) && ctx.drone.p.y < 2.3, 'نزّل بهدوء على المنصة A…', { guide: (ctx, st) => gpos(st, 0, -12, 1.8, 2, null, 0.8), lock: ['yaw', 'pitch', 'roll'] }),
        {
          say: 'وقّف! فيه أحد دخل على المنصة — ارفع فوراً لين 5 متر (Go-around)', kind: 'bad', lock: ['yaw', 'pitch', 'roll'], hint: { L: { x: 0, y: 0.8 }, R: null },
          enter(ctx, st, T) { st.data.armed = true; const h = T.vis(ctx, { type: 'person', x: -7, z: -12, yaw: PI / 2, color: 0x2563eb }, true); st.data.pp = { x: -7, h, m: T.mapAdd({ kind: 'people', x: -7, z: -12 }, true) }; },
          check: ctx => ctx.drone.p.y >= 4.5,
          tick: (ctx, st, dt, T) => { if (st.stepT > 4 && !st.data.slowUp) { st.data.slowUp = true; st.pen += 10; T.tip('لما تشوف خطر وأنت تهبط: ارفع فوراً بدون تفكير'); } return null; },
          guide: (ctx, st) => gpos(st, 0, -12, 5.5, 1)
        },
        B.goTo(10, -12, 5, 1.2, 'روح للمنصة B على جنب', { label: '' }),
        B.land(10, -12, 1, 0.7, 'هبّط على المنصة B', { home: true, label: 'B' })
      ]
    },
    {
      id: 'u10l4', icon: '🌬️', title: 'الهبوط مع ريح جانبية', gentle: true, wind: { s: 5, g: 1, dir: 90 }, pads: [{ x: 0, z: -10, r: 0.8, label: 'W' }],
      intro: {
        text: 'الريح من الجنب تدف الدرون وهو نازل. خل عينك على المنصة وصحح بـ {R} شوي ضد الريح لين يلمس.',
        bullets: ['الريح تدفه للجنب', 'صحح ضدها بهدوء', 'لا تنزل بسرعة'], diagram: { L: 'down', R: 'right' },
        realWorld: 'الريح قرب الأرض تتقلب — آخر مترين أصعب جزء.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -10, 4, 1, 'روح فوق المنصة — الريح من الجنب تدفه', { label: '' }),
        B.alt(1, 0.3, 1, 'نزّل لين متر ووقف — وصحح الانجراف', { still: true, x: 0, z: -10 }),
        B.land(0, -10, 0.8, 0.6, 'نزّل بهدوء لين يلمس وصحح ضد الريح', { home: true, label: 'W' })
      ]
    }
  ], {
    id: 'u10check', icon: '🏅', title: 'اختبار الوحدة 10: الهبوط الدقيق', check: true, wind: { s: 2.5, g: 0.8 }, fence: true, maxAlt: 60,
    pads: [{ x: 12, z: -10, r: 0.7, label: '1' }, { x: -12, z: -20, r: 0.7, label: '2' }],
    intro: {
      text: 'ثلاث هبوطات: المنصة 1، المنصة 2، وبعدين البيت H. كل هبوط داخل الدائرة وبطيء.',
      bullets: ['داخل الدائرة', 'أقل من 0.7 م/ث', 'بدون نطّة'], diagram: null,
      realWorld: 'الهبوط الدقيق مطلوب في كل اختبارات الطيارين (NIST/CASA).'
    },
    steps: [
      B.takeoff(3),
      B.land(12, -10, 0.7, 0.7, 'هبّط على المنصة 1', { home: true, label: '1' }),
      B.takeoff(3, 'أقلع مرة ثانية'),
      B.land(-12, -20, 0.7, 0.7, 'هبّط على المنصة 2', { home: true, label: '2' }),
      B.takeoff(3, 'أقلع مرة ثانية'),
      landHome(0.8, 0.7, 'ارجع وهبّط على البيت H')
    ]
  });

  // ---------------- 11) الرجوع للبيت والطوارئ ----------------
  const RTH_PH = { brake: 'أول شي يفرمل ويوقف', climb: 'يصعد لارتفاع الرجوع لأنه أبعد من 50 متر', turn: 'يلف وجهه للبيت', cruise: 'يرجع بخط مستقيم — لازم الطريق فاضي', descend: 'وصل فوق البيت وينزل' };
  const smartAware = (ctx) => { const s = ctx.session, d = ctx.drone; if (d.auto === 'rth') return GN; if (s && s.smartRth && s.smartRth.active) return GN; return holdBtn('B', 1.2); };
  unit(11, '🏠', 'الرجوع للبيت والطوارئ', 'RTH وكيف يرجع، إلغاؤه، ارتفاع الرجوع والعوائق، البطارية الضعيفة، وضياع الـ GPS.', 'mini', [
    {
      id: 'u11l1', icon: '🏠', title: 'الرجوع للبيت (RTH): كيف يشتغل', gentle: true, wind: LIGHT,
      intro: {
        text: 'B مطوّل = الدرون يرجع للبيت لحاله: يفرمل، ولو أبعد من 50 م يصعد لارتفاع الرجوع، يلف للبيت، يرجع بخط مستقيم، وينزل.',
        bullets: ['أقل من 5 م: ينزل مكانه', '5-50 م: يرجع على نفس ارتفاعه', 'أكثر من 50 م: يصعد لارتفاع الرجوع (هنا 20 م)'], diagram: null,
        realWorld: 'في DJI الحقيقي ارتفاع الرجوع الافتراضي 100 م. وفي Mini 4 Pro بالنهار الوضع الافتراضي (Optimal) يخطط طريقه وارتفاعه بنفسه، لكن بالليل أو لو اخترت Preset يرجع بخط مستقيم على ارتفاع الرجوع — عشان كذا اضبطه دايم أعلى من أطول عائق.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -60, 10, 4, 'روح بعيد للعلامة 1 (60 متر)', { label: '1', speed: 8 }),
        B.cond(ctx => ctx.drone.auto === 'rth', 'اضغط B مطوّل (ثانية): الرجوع للبيت', { hint: null, guide: () => holdBtn('B', 1.2), coach: [] }),
        {
          say: 'شوف وش يسوي…', hint: null, coach: [],
          tick(ctx, st, dt, T) {
            const d = ctx.drone, ph = d.rthPhase;
            if (ph && ph !== st.data.ph) { st.data.ph = ph; if (RTH_PH[ph]) T.say(ctx, RTH_PH[ph], 'info'); }
            return d.onGround && !d.motors ? 'next' : null;
          },
          guide: () => GN, live: ctx => 'H ' + Math.round(ctx.drone.p.y) + ' م • D ' + Math.round(C.hd(ctx.drone, 0, 0)) + ' م'
        },
        B.decide('الدرون على 30 متر من البيت وضغطت الرجوع. على أي ارتفاع يرجع؟', ['على نفس ارتفاعه الحالي (لأنه بين 5 و 50 متر)', 'يصعد لـ 120 متر', 'ينزل مكانه فوراً', 'يطفي المحركات'], 'من 5 لـ 50 متر يرجع على نفس ارتفاعه. أبعد من 50 يصعد لارتفاع الرجوع. أقل من 5 ينزل مكانه.')
      ]
    },
    {
      id: 'u11l2', icon: '✋', title: 'ألغِ الرجوع واستلم التحكم', gentle: true, wind: LIGHT,
      intro: {
        text: 'تقدر توقف الرجوع بأي وقت: ضغطة B وحدة، أو تسحب العصا اليمين لورا للآخر. الدرون يوقف والتحكم يرجع لك.',
        bullets: ['ضغطة B = إلغاء', '{P} لورا للآخر = فرامل وإلغاء', 'بعدها فك العصي'], diagram: { L: null, R: 'down' },
        realWorld: 'لو شفت شي في طريق الرجوع (شجرة، سلك) ألغه فوراً وتحكم بيدك.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(15, -45, 10, 3, 'روح للعلامة 1', { label: '1', speed: 6 }),
        B.cond(ctx => ctx.drone.auto === 'rth', 'اضغط B مطوّل: الرجوع للبيت', { hint: null, guide: () => holdBtn('B', 1.2), coach: [] }),
        B.cond(ctx => ctx.drone.auto === 'rth' && ctx.drone.rthPhase === 'cruise', 'خله يمشي شوي…', { hint: null, guide: () => GN, coach: [] }),
        B.cond(ctx => ctx.drone.auto !== 'rth' && C.air(ctx.drone), 'الحين ألغه: اضغط B ضغطة وحدة — يوقف والتحكم يرجع لك', { hint: null, guide: () => press('B'), coach: [] }),
        B.cond(ctx => ctx.drone.auto === 'rth', 'شغّل الرجوع مرة ثانية: B مطوّل', { hint: null, guide: () => holdBtn('B', 1.2), coach: [] }),
        B.cond(ctx => ctx.drone.auto !== 'rth' && C.air(ctx.drone), 'طريقة ثانية للإلغاء: اسحب {P} لورا للآخر (وهو راجع)', {
          hint: { L: null, R: { x: 0, y: -1 } }, coach: [],
          guide: (ctx, st) => { const d = ctx.drone; if (d.auto === 'rth' && d.rthPhase === 'cruise') { const g = graw(st); g.raw.pitch = -1; return g; } return GN; }
        }),
        B.cond(ctx => C.centred(ctl(ctx), 0.08), 'زين ✓ فك العصي عشان يرجع لك التحكم', { hold: 0.6, hint: { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } }, guide: () => GR0, coach: [] }),
        homeLand('رجّعه بيدك وهبّط على H')
      ]
    },
    {
      id: 'u11l3', icon: '🏢', title: 'ارتفاع الرجوع والعوائق', gentle: true, wind: LIGHT, timeLimit: 600,
      setup(ctx, st, T) {
        ctx.drone.rthSetting = 20;
        T.vis(ctx, { type: 'tower', x: 0, z: -40, w: 10, d: 10, h: 32 }, true);
        ctx.env.taskColliders.push({ type: 'box', x: 0, z: -40, w: 10, d: 10, h: 32, name: 'المبنى' });
        T.mapAdd({ kind: 'tower', x: 0, z: -40, r: 5 }, true);
      },
      cleanup: ctx => { ctx.drone.rthSetting = 20; },
      intro: {
        text: 'الرجوع يمشي بخط مستقيم على ارتفاع الرجوع. لو فيه مبنى أطول في الطريق — ممكن يخبط (بالليل، أو الحساسات طافية، أو أسلاك/زجاج ما تشوفها الحساسات). لازم ارتفاع الرجوع أعلى من أطول عائق بـ 10 متر.',
        bullets: ['ارتفاع الرجوع > أطول عائق + 10 م', 'شوف طريق الرجوع', 'خطر؟ ألغِ (B) وتحكم'], diagram: null,
        realWorld: 'أشهر سبب لطيحات الرجوع التلقائي: ارتفاع رجوع أقل من الشجر أو المباني. في Mini 4 Pro بالنهار الوضع الافتراضي (Optimal) يخطط طريقه بنفسه، لكن بالليل أو في Preset يرجع بخط مستقيم على ارتفاع الرجوع مثل هنا.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(-16, -40, 12, 4, 'روح للعلامة 1 جنب المبنى (لا تقرب منه)', { label: '1', speed: 5 }),
        B.goTo(0, -75, 12, 5, 'روح للعلامة 2 ورا المبنى', { label: '2', speed: 5 }),
        B.cond(ctx => ctx.drone.auto === 'rth', 'اضغط B مطوّل: الرجوع للبيت (ارتفاع الرجوع مضبوط على 20 متر)', { hint: null, guide: () => holdBtn('B', 1.2), coach: [] }),
        B.cond(ctx => ctx.drone.auto === 'rth' && ctx.drone.rthPhase === 'cruise', 'الدرون يرجع لحاله… انتبه وش قدامه!', { hint: null, guide: () => GN, coach: [] }),
        B.decide('الدرون راجع على 20 متر وقدامه مبنى طوله 32 متر! وش تسوي؟', ['تلغي الرجوع (ضغطة B) وترفعه فوق المبنى أو تلف حوله', 'تتركه يكمل لحاله', 'تطفي الريموت', 'تنزله فوق المبنى'], 'الرجوع يمشي بخط مستقيم على الارتفاع المضبوط. اضبطه دايم أعلى من أطول عائق.'),
        B.cond(ctx => ctx.drone.auto !== 'rth', 'بسرعة! اضغط B ضغطة وحدة عشان تلغي الرجوع', { hint: null, guide: () => press('B'), coach: [], limit: 12, failMsg: 'ما ألغيت الرجوع' }),
        B.cond(ctx => ctx.drone.p.z > -28 && ctx.drone.p.y > 3, 'ارفعه فوق المبنى (أعلى من 35 متر) وارجع صوبك', {
          guide: (ctx, st) => { const d = ctx.drone; return d.p.y < 36 ? gpos(st, d.p.x, Math.min(d.p.z, -52), 38, 2) : gpos(st, 0, -20, 38, 6); }
        }),
        homeLand()
      ]
    },
    {
      id: 'u11l4', icon: '🪫', title: 'البطارية الضعيفة', gentle: true, wind: LIGHT, smartRth: true,
      cleanup: ctx => { const d = ctx.drone; d.battery = Math.max(d.battery, 60); d.batWarned = {}; d.drain = 1; },
      intro: {
        text: 'لما البطارية تكفي بس للرجعة، الدرون يقول لك ويعد 10 ثواني وبعدها يرجع لحاله (Smart RTH). لا تلغيه إلا وأنت متأكد.',
        bullets: ['30% = ارجع', '15% = نزّل فوراً', 'الريح ضدك في الرجعة؟ ارجع بدري'], diagram: null,
        realWorld: 'لو ألغيت الرجوع الذكي، الدرون بينزل لحاله لما البطارية تخلص — وين ما كان (حتى فوق موية).'
      },
      steps: [
        B.takeoff(3),
        B.goTo(0, -80, 15, 5, 'روح بعيد للعلامة 1 (80 متر)', { label: '1', speed: 8 }),
        Object.assign(B.decide('جاك تحذير: البطارية 22% وأنت بعيد. وش الصح؟', ['ترجع الحين (أو تخلي الرجوع الذكي يرجعه)', 'تكمل شوي وبعدين ترجع', 'تصعد أعلى عشان تشوف أبعد', 'تطفي الريموت'], 'البطارية تخلص أسرع مما تتوقع (خصوصاً مع الريح). ارجع فوراً.'),
          { enter(ctx) { const d = ctx.drone; d.battery = 22; d.batWarned = { 30: 1 }; d.emit('warn', 'بطارية ضعيفة (22%) — ارجع للبيت الحين'); } }),
        B.cond(ctx => ctx.drone.auto === 'rth' || C.hd(ctx.drone, 0, 0) < 8, 'ارجع للبيت: اضغط B مطوّل — أو خل العداد يخلص ويرجع لحاله', { hint: null, guide: smartAware, coach: [] }),
        B.cond(ctx => ctx.drone.onGround && !ctx.drone.motors, 'خله يرجع ويهبط… (لو احتجت تقدر تتحكم بالسرعة بالعصا اليمين)', {
          hint: null, coach: [],
          guide: (ctx, st) => { const d = ctx.drone; if (d.auto) return GN; return landGuide(ctx, st, 0, 0, 2); },
          enter(ctx, st) { st.lc = new DS.LandCheck(0, 0, 2, 1); st.lc.wasAir = true; }
        })
      ]
    },
    {
      id: 'u11l5', icon: '📡', title: 'ضاع الـ GPS', gentle: true, wind: { s: 3, g: 0.8 },
      cleanup: ctx => { ctx.drone.setGnss(true); },
      intro: {
        text: 'لو راح الـ GPS وقريب من الأرض بالنهار، الحساسات اللي تحت تثبته شوي. بس لو عالي (فوق 30 م) أو بالليل أو فوق موية، يصير ATTI لحاله: ما يثبت مكانه ولا يقدر يرجع للبيت. هنا نجرب أصعب حالة: راح الـ GPS والحساسات مع بعض. خلك هادي، صحح الانجراف بيدك، ورجّعه وهبّط.',
        bullets: ['بدون GPS: عالي أو بالليل أو فوق موية = ATTI', 'الرجوع للبيت ما يشتغل', 'رجّعه بيدك وهبّط بأقرب وقت — وآخر 3 متر بشويش (في ATTI ما فيه حماية هبوط)'], diagram: null,
        realWorld: 'يصير قرب المباني العالية، تحت الجسور، ومع التشويش. DJI ينصح: نزّل بأسرع وقت.'
      },
      steps: [
        B.takeoff(3),
        B.goTo(-15, -40, 8, 3, 'روح للعلامة 1', { label: '1', speed: 4 }),
        Object.assign(B.decide('ضاع الـ GPS والدرون صار ينجرف مع الريح. وش الصح؟', ['تتحكم فيه بيدك وتصحح الانجراف وترجعه وتنزل بأمان', 'تترك العصي وتنتظر يوقف لحاله', 'تضغط الرجوع للبيت', 'تصعد عالي'], 'الدرون صار ATTI: ما يثبت مكانه، والرجوع للبيت يحتاج GPS.'),
          { enter(ctx) { ctx.drone.loseGnss(); ctx.msg('⚠️ راح الـ GPS والحساسات تحت ما تشوف الأرض — ATTI', 'bad'); } }),
        landHome(2.5, 1.0, 'رجّعه بيدك وصحح الانجراف — وهبّط على H', { coach: ['drift', 'overcorrect', 'fastdescent', 'battery', 'vrs'] })
      ]
    }
  ], {
    id: 'u11check', icon: '🏅', title: 'اختبار الوحدة 11: الطوارئ', check: true, wind: { s: 2.5, g: 0.8 }, fence: true, maxAlt: 60, timeLimit: 600,
    cleanup: ctx => { ctx.drone.link = true; ctx.drone.setGnss(true); },
    intro: {
      text: 'رحلة فيها طارئين: انقطاع الإشارة (انتظر الرجوع واستلم التحكم لما ترجع)، وضياع الـ GPS (رجّعه بيدك وهبّط).',
      bullets: ['القرار الصح', 'التصرف بسرعة', 'هبوط داخل 2.5 متر'], diagram: null,
      realWorld: 'الطوارئ تصير فعلاً — والتدريب عليها هنا يخليك هادي في الواقع.'
    },
    steps: [
      B.takeoff(3),
      B.goTo(0, -50, 15, 4, 'روح للعلامة 1', { label: '1', speed: 6 }),
      Object.assign(B.decide('انقطعت الإشارة بين الريموت والدرون! وش تسوي؟', ['لا تطفي الريموت: وجّه الأنتينا للدرون وانتظر الرجوع التلقائي', 'تطفي الريموت وتشغله', 'تركض وراه', 'تعتبره طاح'], 'الدرون يرجع لحاله (Failsafe). وأول ما ترجع الإشارة استلم التحكم.'),
        { enter(ctx) { const d = ctx.drone; d.link = false; d.toggleRTH(true); ctx.msg('📵 انقطعت الإشارة!', 'bad'); } }),
      {
        say: 'الإشارة مقطوعة… الدرون يرجع لحاله. انتظر', hint: null, coach: [],
        tick(ctx, st) { const d = ctx.drone; if (!d.link && st.stepT > 4) { d.link = true; ctx.msg('📶 رجعت الإشارة', 'good'); } return d.link ? 'next' : null; },
        guide: () => GN
      },
      {
        say: 'رجعت الإشارة! ألغِ الرجوع (ضغطة B) واستلم التحكم', hint: null, coach: [],
        check: ctx => ctx.drone.auto !== 'rth' && C.air(ctx.drone),
        tick: (ctx, st, dt, T) => { if (st.stepT > 8 && !st.data.lt) { st.data.lt = true; T.fault(ctx, 'major', 'late'); } if (ctx.drone.onGround) return 'next'; return null; },
        guide: ctx => ctx.drone.auto === 'rth' ? press('B') : GN
      },
      B.goTo(15, -30, 10, 4, 'روح للعلامة 2', { label: '2', speed: 5 }),
      Object.assign(B.decide('ضاع الـ GPS والدرون صار ATTI. وش الصح؟', ['تتحكم فيه بيدك وترجعه وتهبط بأسرع وقت', 'تضغط الرجوع للبيت', 'تترك العصي', 'تصعد عالي'], 'بدون GPS ما فيه رجوع ولا تثبيت. رجّعه بيدك.'),
        { enter(ctx) { ctx.drone.loseGnss(); ctx.msg('⚠️ راح الـ GPS والحساسات تحت ما تشوف الأرض — ATTI', 'bad'); } }),
      landHome(2.5, 1.0, 'رجّعه بيدك وهبّط على H')
    ]
  });

  // ---------------- 12) الطيران بالكاميرا ----------------
  const tgt = (x, y, z) => ({ x, y, z, h: null });
  unit(12, '🎥', 'الطيران بالكاميرا', 'تحريك الكاميرا (Gimbal)، تأطير الهدف في النص، التصوير، واللقطة السينمائية.', 'mini', [
    {
      id: 'u12l1', icon: '🎥', title: 'الكاميرا والعرض', gentle: true, wind: LIGHT,
      intro: {
        text: 'Y يغير العرض (كاميرا الدرون = اللي يشوفه الدرون). LT ينزّل الكاميرا وRT يرفعها. في الطيران الحقيقي بتشوف الشاشة أغلب الوقت.',
        bullets: ['Y = تغيير العرض', 'LT = الكاميرا لتحت', 'RT = الكاميرا لفوق', '-90° = تشوف تحت بالضبط'], diagram: null,
        realWorld: 'في ريموت DJI عجلة الكاميرا على اليسار فوق — نفس LT/RT هنا.'
      },
      steps: [
        B.takeoff(5),
        B.cond(ctx => ctx.session.view === 'fpv', 'اضغط Y لين تشوف كاميرا الدرون', { hint: null, guide: () => press('Y'), coach: [] }),
        B.cond(ctx => ctx.session.gimbal <= -80, 'اضغط LT (الزناد اليسار) لين تنزل الكاميرا لتحت للآخر — تشوف المنصة', { hint: null, coach: [], guide: (ctx, st) => { const g = graw(st); g.raw.lt = 1; return g; } }),
        B.cond(ctx => ctx.session.gimbal >= -3 && ctx.session.gimbal <= 15, 'اضغط RT (الزناد اليمين) لين ترجع الكاميرا مستوية (0°)', { hint: null, coach: [], guide: (ctx, st) => { const g = graw(st); if (ctx.session.gimbal < -3) g.raw.rt = 0.8; return g; } }),
        B.cond(ctx => ctx.session.gimbal >= -35 && ctx.session.gimbal <= -25, 'خل الكاميرا على -30 درجة تقريباً (شوي لتحت)', { hold: 0.6, hint: null, coach: [], guide: (ctx, st) => { const g = graw(st), e = -30 - ctx.session.gimbal; g.raw.lt = clamp(-e / 10, 0, 0.6); g.raw.rt = clamp(e / 10, 0, 0.6); return g; }, live: ctx => 'الكاميرا ' + Math.round(ctx.session.gimbal) + '°' }),
        B.cond(ctx => ctx.session.view === 'pilot', 'كمّل Y لين ترجع لعين الطيار', { hint: null, guide: () => press('Y'), coach: [] }),
        landHome()
      ]
    },
    {
      id: 'u12l2', icon: '🖼️', title: 'خل الهدف في النص (Framing)', gentle: true, wind: LIGHT,
      setup(ctx, st, T) { st.data.car = tgt(0, 0.8, -35); st.data.car.h = T.vis(ctx, { type: 'vehicle', x: 0, z: -35, yaw: PI / 2, kind: 'car', color: 0xdc2626 }, true); T.mapAdd({ kind: 'vehicle', x: 0, z: -35 }, true); },
      intro: {
        text: 'المصور الشاطر يخلي الهدف في نص الكادر طول الوقت: يلف الدرون ({Y}) يمين ويسار، ويحرك الكاميرا (LT/RT) فوق وتحت.',
        bullets: ['يمين/يسار = لف الدرون', 'فوق/تحت = الكاميرا', 'حركات بطيئة = فيديو حلو'], diagram: { L: 'right', R: null },
        realWorld: 'في تصوير الأحداث والتفتيش: الهدف في النص والحركة ناعمة.'
      },
      steps: [
        B.takeoff(6),
        B.cond(ctx => ctx.session.view === 'fpv', 'اضغط Y لين كاميرا الدرون', { hint: null, guide: () => press('Y'), coach: [] }),
        B.cond((ctx, st) => ctx.inView(st.data.car.x, st.data.car.y, st.data.car.z, 7).ok, 'خل السيارة الحمرا في نص الشاشة 4 ثواني: لف بـ {Y} ونزّل الكاميرا بـ LT', {
          hold: 4, reticle: 7, coach: ['slam', 'overcorrect'], guide: (ctx, st) => frameGuide(ctx, st, st.data.car.x, st.data.car.y, st.data.car.z, false, 7),
          live: (ctx, st) => 'بعيد عن النص ' + Math.round(ctx.inView(st.data.car.x, st.data.car.y, st.data.car.z).angle) + '°'
        }),
        B.goTo(12, -14, 6, 2, 'الحين روح جنب للعلامة وخل السيارة في الكادر طول الوقت (لف وأنت ماشي)', {
          label: '1', speed: 2, combo: true, yaw: d => U.bearing(d.p.x, d.p.z, 0, -35), reticle: 10,
          tick: (ctx, st) => { const c = st.data.car; st.data.fT = (st.data.fT || 0) + 1; if (ctx.inView(c.x, c.y, c.z, 12).ok) st.data.fIn = (st.data.fIn || 0) + 1; return null; },
          exit: (ctx, st, T) => { const f = (st.data.fIn || 0) / Math.max(1, st.data.fT || 1); if (f < 0.6) { st.pen += Math.round((0.6 - f) * 50); T.tip('خل الهدف في الكادر وأنت تتحرك: لف شوي شوي مع الحركة'); } }
        }),
        B.cond(ctx => ctx.session.view === 'pilot', 'رجّع العرض لعين الطيار (Y)', { hint: null, guide: () => press('Y'), coach: [] }),
        landHome()
      ]
    },
    {
      id: 'u12l3', icon: '📸', title: 'التصوير (RB)', gentle: true, wind: LIGHT,
      setup(ctx, st, T) {
        const D = st.data;
        D.t1 = tgt(-12, 1.0, -30); D.t1.h = T.vis(ctx, { type: 'person', x: -12, z: -30, color: 0x16a34a }, true);
        D.t2 = tgt(12, 0.8, -32); D.t2.h = T.vis(ctx, { type: 'vehicle', x: 12, z: -32, yaw: 0, kind: 'truck', color: 0x2563eb }, true);
        D.t3 = tgt(0, 2.6, -45); D.t3.h = T.vis(ctx, { type: 'flag', x: 0, z: -45, color: 0xf59e0b }, true);
        T.mapAdd({ kind: 'people', x: -12, z: -30 }, true); T.mapAdd({ kind: 'vehicle', x: 12, z: -32 }, true); T.mapAdd({ kind: 'beacon', x: 0, z: -45, r: 1, label: '🚩' }, true);
      },
      intro: {
        text: 'نصور 3 أهداف: خل كل هدف في نص الشاشة (داخل المربع) واضغط RB. الصورة تنحسب إذا الهدف في النص.',
        bullets: ['RB = تصوير', 'الهدف داخل المربع', 'ثبّت قبل ما تصور'], diagram: null,
        realWorld: 'في التفتيش والبحث والإنقاذ: الصورة الواضحة في النص هي اللي تنفع التقرير.'
      },
      steps: (ctx) => [
        B.takeoff(6),
        B.cond(c => c.session.view === 'fpv', 'اضغط Y لين كاميرا الدرون', { hint: null, guide: () => press('Y'), coach: [] }),
        photoStep('t1', 6, 'صوّر الشخص اللابس أخضر (يسار): خله في النص واضغط RB'),
        photoStep('t2', 6, 'صوّر الشاحنة الزرقا (يمين)'),
        photoStep('t3', 6, 'صوّر العلم البرتقالي (قدام)'),
        B.cond(c => c.session.view === 'pilot', 'رجّع العرض لعين الطيار (Y)', { hint: null, guide: () => press('Y'), coach: [] }),
        landHome()
      ]
    },
    {
      id: 'u12l4', icon: '🎞️', title: 'لقطة Orbit سينمائية (وضع C)', gentle: true, wind: LIGHT, mode: 'C', modeLocked: true,
      intro: {
        text: 'في وضع C (ناعم) لف حول التمثال ووجه الكاميرا عليه طول الوقت. السر: سرعة ثابتة وحركات صغيرة جداً.',
        bullets: ['وضع C', 'جنب + لف عكسها', 'السرعة ثابتة'], diagram: { L: 'left', R: 'right' },
        realWorld: 'المصورين المحترفين يسوونها يدوي لأن التحكم أنعم من الوضع التلقائي.'
      },
      steps: [
        B.takeoff(5),
        B.embed(OT_({ title: 'Orbit سينمائي', short: 'Orbit', x: 0, z: -25, R: 9, band: 2, alt: 5, altTol: 1.2, headTol: 22, deg: 180, timeLimit: 900 }),
          'لف حول التمثال ووجهه عليه بنعومة (نص لفة)', { combo: true }),
        landHome()
      ]
    }
  ], {
    id: 'u12check', icon: '🏅', title: 'اختبار الوحدة 12: مهمة تصوير', check: true, wind: { s: 2, g: 0.6 }, fence: true, maxAlt: 60,
    setup(ctx, st, T) {
      const D = st.data;
      D.t1 = tgt(-15, 1.0, -25); D.t1.h = T.vis(ctx, { type: 'person', x: -15, z: -25, color: 0xdc2626 }, true);
      D.t2 = tgt(15, 0.8, -28); D.t2.h = T.vis(ctx, { type: 'vehicle', x: 15, z: -28, yaw: PI / 2, kind: 'car', color: 0xfacc15 }, true);
      D.t3 = tgt(0, 2.6, -48); D.t3.h = T.vis(ctx, { type: 'flag', x: 0, z: -48, color: 0x22d3ee }, true);
      D.t4 = tgt(-6, 1.0, -60); D.t4.h = T.vis(ctx, { type: 'person', x: -6, z: -60, color: 0x7c3aed }, true);
    },
    always: (ctx, st, dt, T) => {   // مسافة أمان من الناس والأهداف (4 م)
      const d = ctx.drone, D = st.data; if (d.onGround || !D.t1) return;
      for (const k of ['t1', 't2', 't3', 't4']) { const t = D[k]; if (Math.hypot(d.p.x - t.x, d.p.y - t.y, d.p.z - t.z) < 4) { if (!D['k' + k]) { D['k' + k] = true; T.fault(ctx, 'major', 'keepout'); } } }
    },
    intro: {
      text: 'صوّر 4 أهداف من مسافة آمنة (أبعد من 4 متر): كل هدف في نص الكادر. وبعدين هبّط.',
      bullets: ['لا تقرب أقل من 4 م', 'الصورة في النص', 'هبوط على H'], diagram: null,
      realWorld: 'مسافة الأمان من الناس والممتلكات قانون في الطيران الحقيقي.'
    },
    steps: ctx => [
      B.takeoff(6),
      B.cond(c => c.session.view === 'fpv', 'اضغط Y لين كاميرا الدرون', { hint: null, guide: () => press('Y'), coach: [] }),
      B.goTo(-6, -14, 6, 2.5, 'روح للعلامة 1', { label: '1', speed: 4 }),
      photoStep('t1', 5, 'صوّر الشخص الأحمر', { minDist: 4 }),
      B.goTo(6, -16, 6, 2.5, 'روح للعلامة 2', { label: '2', speed: 4 }),
      photoStep('t2', 5, 'صوّر السيارة الصفرا', { minDist: 4 }),
      B.goTo(0, -34, 7, 2.5, 'روح للعلامة 3', { label: '3', speed: 4 }),
      photoStep('t3', 5, 'صوّر العلم', { minDist: 4 }),
      photoStep('t4', 5, 'صوّر الشخص البنفسجي (ورا العلم)', { minDist: 4 }),
      B.cond(c => c.session.view === 'pilot', 'رجّع العرض لعين الطيار (Y)', { hint: null, guide: () => press('Y'), coach: [] }),
      landHome(1.0, 0.8)
    ]
  });
  // خطوة تصوير لهدف محفوظ في st.data[key]
  function photoStep(key, tol, say, o) {
    const proxy = { x: 0, y: 0, z: 0, h: null };
    const s = B.photo(proxy, tol, say, o);
    const en = s.enter;
    s.enter = (ctx, st, T) => { const t = st.data[key]; proxy.x = t.x; proxy.y = t.y; proxy.z = t.z; proxy.h = null; en(ctx, st, T); };
    return s;
  }

  // ---------------- 13) FPV: Angle ----------------
  const FPV = { airframe: 'fpv', mode: 'ANGLE', modeLocked: true };
  unit(13, '🥽', 'FPV: وضع Angle', 'درون FPV ما يثبت لحاله: الثروتل بيدك، والميلان = حركة بدون فرامل. نبدأ بوضع Angle الآمن.', 'fpv', [
    Object.assign({
      id: 'u13l1', icon: '🎚️', title: 'الثروتل في FPV', lock: ['yaw', 'pitch', 'roll'], gentle: true, beginner: true, wind: CALM,
      coach: ['overcorrect', 'slam', 'altitude', 'fastdescent', 'thrdown', 'battery'],
      intro: {
        text: 'الـ FPV ما فيه تثبيت ارتفاع: {T} هي قوة المحركات (الثروتل). هنا نص العصا = تقريباً ثبات، بس لازم تصحح دايم بحركات صغيرة.',
        bullets: ['ما فيه GPS ولا تثبيت', 'الثروتل = قوة المحركات', 'حركات صغيرة جداً', 'تشغيل (ARM) = CSC والثروتل تحت للآخر', 'الإطفاء (DISARM) = A مطوّل أو CSC'], diagram: { L: 'up', R: null },
        realWorld: 'ريموت FPV الحقيقي الثروتل ما يرجع للنص (ما فيه سبرنق) — لازم تثبّت إبهامك على نقطة الثبات بنفسك.',
        tips: ['شوف رقم الثروتل % في الشاشة', 'الثبات تقريباً 22%']
      },
      steps: [
        B.motorsOn('شغّل المحركات (ARM): نفس حركة CSC — العصاتين لتحت ولداخل', { lock: null }),
        B.cond(ctx => C.air(ctx.drone, 0.8), 'ارفع الثروتل ({T}) شوي فوق النص: يطير. ما فيه تثبيت — أنت اللي تثبته', { hint: { L: { x: 0, y: 0.35 }, R: null }, guide: (ctx, st) => gpos(st, 0, 0, 2, 2) }),
        B.alt(2, 0.6, 5, 'ثبّته على 2 متر خمس ثواني: حركات صغيرة جداً بالثروتل', { x: 0, z: 0 }),
        B.alt(4, 0.6, 3, 'ارفع لين 4 متر وثبّت', { x: 0, z: 0 }),
        B.alt(1.5, 0.5, 3, 'نزّل لين متر ونص وثبّت', { x: 0, z: 0 }),
        landHome(1.5, 1.0, 'نزّل الثروتل شوي شوي لين يلمس. بعد ما يلمس: طفّ المحركات (DISARM) بـ A مطوّل أو CSC', { coach: ['fastdescent', 'thrdown', 'overcorrect'] })
      ]
    }, FPV),
    Object.assign({
      id: 'u13l2', icon: '📐', title: 'الميلان = حركة (وما يفرمل)', gentle: true, wind: CALM, coach: ['overcorrect', 'slam', 'drift', 'fastdescent', 'thrdown', 'battery'],
      intro: {
        text: 'في Angle {P} يميل الدرون فيمشي. تتركها يرجع مستوي — بس يكمل ماشي! عشان يوقف لازم تميله عكس الحركة شوي.',
        bullets: ['ميلان = سرعة', 'مستوي ≠ واقف', 'الفرامل بيدك (عكس الحركة)', 'ميلان أكثر = ثروتل أكثر'], diagram: { L: null, R: 'up' },
        realWorld: 'هذا أكبر فرق بين DJI والـ FPV. لو نسيته في الواقع الدرون يكمل لين يخبط.'
      },
      steps: [
        B.takeoff(2.5, 'شغّل المحركات (CSC) وارفع الثروتل لين 2.5 متر'),
        B.goTo(0, -20, 2.5, 2, 'ادفع {P} لقدام شوي: يميل ويمشي. لاحظ: تتركها يرجع مستوي بس يكمل ماشي!', { label: '1', speed: 4 }),
        B.stop('وقّفه: ميّله لورا شوي ({P} لتحت) لين يوقف — ما فيه فرامل لحاله', { drift: true, hold: 1.5 }),
        B.goTo(0, -5, 2.5, 2, 'رجّعه صوبك للعلامة 2', { label: '2', speed: 4 }),
        B.stop('ووقّفه فوقها بيدك', { drift: true, hold: 1.5 }),
        landHome(2, 1.0, 'نزّل بهدوء وطفّ المحركات (DISARM): A مطوّل أو CSC')
      ]
    }, FPV),
    Object.assign({
      id: 'u13l3', icon: '🏍️', title: 'اللف مع الميلان', gentle: true, wind: CALM,
      intro: {
        text: 'لفة الـ FPV مثل الدباب: ميّله لجنب ({R}) ولف ({Y}) بنفس الاتجاه، وزيد الثروتل شوي عشان ما ينزل في اللفة.',
        bullets: ['جنب + لف بنفس الاتجاه', 'ثروتل شوي أكثر في اللفة', 'لفة ناعمة'], diagram: { L: 'right', R: 'right' },
        realWorld: 'هذي "اللفة المنسقة" (Coordinated turn) — أساس كل طيران FPV.'
      },
      steps: [
        B.takeoff(2.5, 'شغّل المحركات وارفع لين 2.5 متر'),
        B.embed(CT_({ title: 'لفة حول العمود', short: 'اللفة', pts: circle(0, -18, 8, 8, 2.5, 2.4), altTol: 1.3, nose: 'forward', headTol: 50, par: 60, timeLimit: 900, speed: 4, pylons: [{ x: 0, z: -18, h: 5 }] }),
          'لف حول العمود: ميّله وفّه بنفس الاتجاه، وزيد الثروتل شوي', { combo: true }),
        landHome(2, 1.0, 'ارجع ونزّل وطفّ المحركات (DISARM): A مطوّل أو CSC')
      ]
    }, FPV),
    Object.assign({
      id: 'u13l4', icon: '🥽', title: 'الطيران من الكاميرا', gentle: true, wind: CALM, pads: [{ x: 0, z: -62, r: 1.5, label: 'L' }],
      setup(ctx, st, T) { setupGates(ctx, st, T, [{ x: 0, z: -15, yaw: 0, w: 3, h: 2.4 }, { x: 6, z: -32, yaw: 25 * D2R, w: 3, h: 2.4 }, { x: 0, z: -48, yaw: -25 * D2R, w: 3, h: 2.4 }]); },
      intro: {
        text: 'الحين تطير من كاميرا الدرون (مثل النظارة). الكاميرا مايلة لفوق، فلما يمشي لقدام تشوف الطريق مستوي. عدّي من البوابات.',
        bullets: ['Y = كاميرا الدرون', 'شوف الأفق', 'ادخل من نص البوابة'], diagram: null,
        realWorld: 'في نظارة FPV الحقيقية ما تشوف الدرون نفسه — كل شي من الكاميرا.'
      },
      steps: [
        B.takeoff(1.5, 'شغّل المحركات وارفع لين متر ونص'),
        B.cond(ctx => ctx.session.view === 'fpv', 'اضغط Y لين تصير كاميرا الدرون (مثل النظارة)', { hint: null, guide: () => press('Y'), coach: [] }),
        B.gate(0, 'عدّي من البوابة 1'),
        B.gate(1, 'البوابة 2: يمين شوي'),
        B.gate(2, 'البوابة 3: يسار شوي'),
        B.land(0, -62, 1.5, 1.0, 'هبّط على المنصة L قدامك وطفّ المحركات (DISARM): A مطوّل أو CSC', { home: true, label: 'L' })
      ]
    }, FPV)
  ], Object.assign({
    id: 'u13check', icon: '🏅', title: 'اختبار الوحدة 13: FPV Angle', check: true, wind: LIGHT, pads: [{ x: 0, z: -66, r: 1.4, label: 'L' }],
    setup(ctx, st, T) { setupGates(ctx, st, T, [{ x: 0, z: -14, yaw: 0, w: 3, h: 2.4 }, { x: -8, z: -30, yaw: -30 * D2R, w: 3, h: 2.4 }, { x: 4, z: -44, yaw: 35 * D2R, w: 3, h: 2.4 }, { x: 0, z: -56, yaw: -20 * D2R, w: 3, h: 2.4 }]); },
    intro: {
      text: '4 بوابات بوضع Angle وبعدين هبوط على المنصة L.',
      bullets: ['كل بوابة من نصها', 'لا تخبط', 'هبوط داخل الدائرة'], diagram: null,
      realWorld: 'هذا مستوى طيار FPV مبتدئ متمكن.'
    },
    steps: [
      B.takeoff(1.5),
      B.gate(0, 'البوابة 1'), B.gate(1, 'البوابة 2'), B.gate(2, 'البوابة 3'), B.gate(3, 'البوابة 4'),
      B.land(0, -66, 1.4, 1.2, 'هبّط على المنصة L وطفّ المحركات (DISARM): A مطوّل أو CSC', { home: true, label: 'L' })
    ]
  }, FPV));

  // ---------------- 14) FPV: Acro والثروتل ----------------
  const ACRO = { airframe: 'fpv', mode: 'ACRO', modeLocked: true };
  unit(14, '🌀', 'FPV: Acro والثروتل', 'Horizon خطوة بين الوضعين، وAcro الحقيقي: الدرون يبقى على ميلانه، والثروتل يتغير مع السرعة.', 'fpv', [
    Object.assign({
      id: 'u14l1', icon: '🌅', title: 'وضع Horizon', gentle: true, wind: CALM, airframe: 'fpv', mode: 'HORIZON', modeLocked: true,
      intro: {
        text: 'Horizon نص ونص: العصا قريبة من النص = يرجع مستوي مثل Angle، والعصا للآخر = يقلب مثل Acro. خطوة قبل الـ Acro.',
        bullets: ['حركات صغيرة = Angle', 'للآخر = يقلب', 'جربه بهدوء'], diagram: null,
        realWorld: 'كثير من المبتدئين يستخدمون Horizon أول أسبوع وبعدين ينتقلون للـ Acro.'
      },
      steps: [
        B.takeoff(2.5, 'شغّل المحركات وارفع لين 2.5 متر'),
        B.goTo(0, -20, 3, 2.5, 'روح للعلامة 1', { label: '1', speed: 4 }),
        B.goTo(10, -20, 3, 2.5, 'جنب للعلامة 2', { label: '2', speed: 4 }),
        B.goTo(0, -5, 3, 2.5, 'ارجع للعلامة 3', { label: '3', speed: 4 }),
        landHome(2, 1.0, 'نزّل وطفّ المحركات (DISARM): A مطوّل أو CSC')
      ]
    }),
    Object.assign({
      id: 'u14l2', icon: '🧘', title: 'Acro: يبقى على ميلانه', gentle: true, wind: CALM, coach: ['overcorrect', 'slam', 'fastdescent', 'thrdown', 'battery'],
      intro: {
        text: 'في Acro الدرون ما يرجع مستوي لحاله أبداً: العصا = سرعة دوران. تميله وتترك = يبقى مايل! لازم ترجعه مستوي بيدك.',
        bullets: ['العصا = يدور، النص = يوقف الدوران', 'ميّل ← ترك ← رجّعه', 'هذا وضع المحترفين'], diagram: { L: null, R: 'up' },
        realWorld: 'كل طياري FPV المحترفين يطيرون Acro — يعطيك حرية كاملة (قلبات ولفات) بس يبيله تمرين كثير.'
      },
      steps: [
        B.takeoff(2.5, 'شغّل المحركات وارفع لين 2.5 متر — بحذر'),
        B.hover(0, -5, 3, 3, 1.2, 5, 'اثبت قريب من العلامة 5 ثواني — كل ميلان رجّعه بيدك', { accumulate: true }),
        B.goTo(0, -25, 3, 2.5, 'روح للعلامة: ميّله لقدام شوي وبعدين رجّعه مستوي', { label: '1', speed: 4 }),
        B.stop('وقّفه: ميّله لورا شوي وبعدين مستوي', { drift: true, hold: 1.2 }),
        B.goTo(0, -5, 3, 2.5, 'ارجع للعلامة 2', { label: '2', speed: 4 }),
        landHome(2, 1.0, 'نزّل وطفّ المحركات (DISARM): A مطوّل أو CSC')
      ]
    }, ACRO),
    Object.assign({
      id: 'u14l3', icon: '⚡', title: 'الثروتل مع السرعة', gentle: false, wind: CALM, pads: [{ x: 0, z: -82, r: 1.5, label: 'L' }],
      intro: {
        text: 'كل ما ميلت الدرون أكثر عشان يسرع، الدفع يروح لقدام فينزل — لازم ترفع الثروتل أكثر. السرعة والثروتل يمشون مع بعض.',
        bullets: ['ميلان أكثر = ثروتل أكثر', 'شوف الارتفاع', 'الكاميرا المايلة تساعدك تشوف الطريق'], diagram: { L: 'up', R: 'up' },
        realWorld: 'هذي "إدارة الثروتل" — أهم مهارة في سباقات الـ FPV.'
      },
      steps: [
        B.takeoff(3, 'شغّل المحركات وارفع لين 3 متر'),
        B.embed(CT_({ title: 'خط سريع', short: 'سرعة', pts: [{ x: 0, z: -10, alt: 4, r: 3 }, { x: 0, z: -40, alt: 4, r: 3 }, { x: 0, z: -70, alt: 4, r: 3 }], altTol: 1.5, nose: 'fixed', fixedYaw: 0, headTol: 30, par: 30, timeLimit: 900, speed: 9 }),
          'طر لقدام بسرعة والارتفاع ثابت: كل ما ميلته أكثر ارفع الثروتل أكثر'),
        B.land(0, -82, 1.5, 1.0, 'خفف ووقّفه، وهبّط على المنصة L', { home: true, label: 'L' })
      ]
    }, ACRO),
    Object.assign({
      id: 'u14l4', icon: '🎿', title: 'Carving: لفات ناعمة', gentle: true, wind: CALM,
      intro: {
        text: 'رقم 8 بالـ Acro: ميلان + لف + ثروتل بنفس الوقت، بدون ما توقف. هذا اسمه Carving.',
        bullets: ['لا توقف', 'ميلان + لف + ثروتل', 'خل الارتفاع ثابت'], diagram: { L: 'right', R: 'right' },
        realWorld: 'الـ Carving الناعم هو اللي يخلي فيديو الـ FPV حلو.'
      },
      steps: [
        B.takeoff(3, 'شغّل المحركات وارفع لين 3 متر'),
        B.embed(CT_({ title: 'رقم 8 (Acro)', short: 'Carving', pts: sq([[0, -28, 3, 2.6], [9, -37, 3, 2.6], [18, -28, 3, 2.6], [9, -19, 3, 2.6], [0, -28, 3, 2.6], [-9, -37, 3, 2.6], [-18, -28, 3, 2.6], [-9, -19, 3, 2.6], [0, -28, 3, 2.6]]), altTol: 1.5, nose: 'forward', headTol: 55, par: 60, timeLimit: 900, speed: 4.5, pylons: [{ x: -9, z: -28, h: 6 }, { x: 9, z: -28, h: 6 }] }),
          'رقم 8 حول العمودين بدون ما توقف', { combo: true }),
        landHome(2, 1.0, 'ارجع ونزّل وطفّ المحركات (DISARM): A مطوّل أو CSC')
      ]
    }, ACRO)
  ], Object.assign({
    id: 'u14check', icon: '🏅', title: 'اختبار الوحدة 14: FPV Acro', check: true, wind: LIGHT, pads: [{ x: 0, z: -70, r: 1.5, label: 'L' }],
    setup(ctx, st, T) { setupGates(ctx, st, T, [{ x: 0, z: -14, yaw: 0, w: 3, h: 2.4 }, { x: 10, z: -28, yaw: 40 * D2R, w: 3, h: 2.4 }, { x: 4, z: -44, yaw: -30 * D2R, w: 3, h: 2.4 }, { x: -8, z: -54, yaw: -40 * D2R, w: 3, h: 2.4 }, { x: 0, z: -62, yaw: 30 * D2R, w: 3, h: 2.4 }]); },
    intro: {
      text: '5 بوابات بوضع Acro وبعدين هبوط على المنصة L.',
      bullets: ['Acro كامل', 'كل بوابة من نصها', 'هبوط داخل الدائرة'], diagram: null,
      realWorld: 'إذا تقدر على هذا، أنت جاهز تتمرن على درون FPV حقيقي (بحذر وفي مكان فاضي).'
    },
    steps: [
      B.takeoff(1.5),
      B.gate(0, 'البوابة 1'), B.gate(1, 'البوابة 2'), B.gate(2, 'البوابة 3'), B.gate(3, 'البوابة 4'), B.gate(4, 'البوابة 5'),
      B.land(0, -70, 1.5, 1.2, 'هبّط على المنصة L وطفّ المحركات (DISARM): A مطوّل أو CSC', { home: true, label: 'L' })
    ]
  }, ACRO));

  // ---------------- 15) FPV: الحركات ----------------
  const trickLesson = (id, icon, title, type, startAlt, say, intro) => Object.assign({
    id, icon, title, gentle: false, wind: CALM, timeLimit: 99999,
    intro,
    steps: [
      B.takeoff(3, 'شغّل المحركات وارفع'),
      B.goTo(0, -30, startAlt, 3, 'اطلع لين ' + startAlt + ' متر — الحركات دايم على ارتفاع عالي (أمان)', { label: '1', speed: 5, vtol: 2 }),
      B.stop('ثبّته مستوي قبل الحركة', { hold: 0.8, drift: true }),
      B.trick(type, 1, say),
      B.stop('رجّعه مستوي وثبّته', { hold: 0.8, drift: true }),
      landHome(2, 1.2, 'ارجع ونزّل بهدوء وطفّ المحركات (DISARM): A مطوّل أو CSC')
    ]
  }, ACRO);
  unit(15, '🤸', 'FPV: الحركات', 'حركات المحترفين: Flip و Roll و Split-S و Power Loop — على ارتفاع آمن.', 'fpv', [
    trickLesson('u15l1', '🔃', 'Flip (قلبة لقدام)', 'flip', 18, 'دفعة ثروتل صغيرة، بعدين نزّل الثروتل وادفع {P} لقدام للآخر — يقلب لفة كاملة — وأول ما يرجع مستوي ارفع الثروتل', {
      text: 'الـ Flip: الدرون يقلب لقدام لفة كاملة حول نفسه. السر: الثروتل تحت وأنت تقلب (عشان ما ينطلق للأرض)، وترفعه أول ما يرجع مستوي.',
      bullets: ['ارتفاع 15+ متر', 'دفعة صغيرة لفوق', 'ثروتل تحت + {P} للآخر', 'مستوي = ثروتل'], diagram: { L: 'down', R: 'up' },
      realWorld: 'أول حركة يتعلمها طيار الفري ستايل. في الواقع جربها فوق عشب وعلى ارتفاع عالي.'
    }),
    trickLesson('u15l2', '↪️', 'Roll (لفة جنب)', 'roll', 18, 'دفعة ثروتل صغيرة، بعدين ثروتل تحت و{R} يمين للآخر — يلف على جنبه لفة كاملة — وارفع الثروتل لما يرجع', {
      text: 'الـ Roll: نفس الـ Flip بس على الجنب ({R}). أسهل شوي لأن الكاميرا تشوف الأفق يدور.',
      bullets: ['{R} للآخر', 'ثروتل تحت وقت اللفة', 'رجّعه مستوي'], diagram: { L: 'down', R: 'right' },
      realWorld: 'الـ Roll يستخدم في الفري ستايل وفي تغيير الاتجاه السريع.'
    }),
    trickLesson('u15l3', '⤵️', 'Split-S', 'splitS', 25, 'وأنت ماشي لقدام: لفه نص لفة على جنبه (يصير مقلوب)، بعدين اسحب {P} لورا — يرجع بعكس اتجاهك وأوطى', {
      text: 'الـ Split-S: تمشي لقدام، تقلب على ظهرك (نص Roll)، وتسحب لورا نص Flip — فترجع بالاتجاه المعاكس وأوطى. حركة لتغيير الاتجاه بسرعة.',
      bullets: ['سرعة لقدام', 'نص لفة جنب', 'سحب لورا', 'تنزل كثير: ارتفاع 20+'], diagram: { L: 'down', R: 'down' },
      realWorld: 'حركة مشهورة في الفري ستايل للنزول من فوق مبنى ورجوعك.'
    }),
    trickLesson('u15l4', '➰', 'Power Loop', 'powerLoop', 15, 'وأنت ماشي لقدام: اسحب {P} لورا وارفع الثروتل — يطلع ويدور لفة كاملة لورا. خفف الثروتل فوق وزيده وهو نازل', {
      text: 'الـ Power Loop: لفة كاملة لورا وأنت ماشي (مثل الدائرة). الثروتل: قوي وهو طالع، خفيف وهو مقلوب فوق، قوي وهو طالع من اللفة.',
      bullets: ['سرعة لقدام', '{P} لورا', 'الثروتل: قوي ← خفيف ← قوي'], diagram: { L: 'up', R: 'down' },
      realWorld: 'الـ Power Loop فوق شجرة أو بوابة من أجمل لقطات الـ FPV.'
    })
  ], Object.assign({
    id: 'u15check', icon: '🏆', title: 'اختبار الوحدة 15: حركات المحترفين', check: true, wind: CALM,
    intro: {
      text: 'Flip ثم Roll ثم Split-S على ارتفاع آمن (فوق 4 متر طول الوقت)، وبعدين هبوط.',
      bullets: ['لا تنزل تحت 4 م', 'كل حركة كاملة', 'هبوط هادي'], diagram: null,
      realWorld: 'خلصت الدورة! الحين تتمرن على الدرون الحقيقي بنفس الترتيب: من الأسهل للأصعب.'
    },
    steps: [
      B.takeoff(3, 'شغّل المحركات وارفع'),
      B.goTo(0, -30, 22, 3, 'اطلع لين 22 متر', { label: '1', speed: 5, vtol: 2 }),
      B.stop('ثبّته', { hold: 0.8 }),
      B.trick('flip', 1, 'Flip', { band: { minAlt: 4, code: 'low' } }),
      B.stop('ثبّته', { hold: 0.8, band: { minAlt: 4, code: 'low' } }),
      B.trick('roll', 1, 'Roll', { band: { minAlt: 4, code: 'low' } }),
      B.stop('ثبّته', { hold: 0.8 }),
      B.goTo(0, -25, 25, 3, 'اطلع لين 25 متر للـ Split-S', { label: '2', speed: 5, vtol: 2 }),
      B.trick('splitS', 1, 'Split-S', { band: { minAlt: 4, code: 'low' } }),
      B.stop('ثبّته', { hold: 0.8 }),
      landHome(2, 1.2, 'ارجع ونزّل وطفّ المحركات (DISARM): A مطوّل أو CSC')
    ]
  }, ACRO));

  // ======================================================================
  // السجل + التقدم + الواجهة البرمجية للـ UI
  // ======================================================================
  DS.LESSONS2 = {};
  DS.COURSE = [];
  const ORDER = [];
  UNITS.forEach(u => {
    const ids = [];
    u.lessons.forEach((L, i) => {
      L.unit = u.unit; L.n = i + 1; L.airframe = L.airframe || u.airframe || 'mini'; L.demo = true;
      DS.LESSONS2[L.id] = L; ids.push(L.id); ORDER.push(L.id);
    });
    const K = u.check; K.unit = u.unit; K.n = ids.length + 1; K.airframe = K.airframe || u.airframe || 'mini'; K.demo = true; K.check = true;
    DS.LESSONS2[K.id] = K; ORDER.push(K.id);
    DS.COURSE.push({ unit: u.unit, icon: u.icon, title: u.title, desc: u.desc, airframe: u.airframe, lessons: ids, check: K.id });
  });
  DS.COURSE_ORDER = ORDER;

  // نصوص الشرح بأسماء العصي حسب Mode 1/2 (نسخة جاهزة للواجهة)
  const introText = I => ({ text: tx(I.text), bullets: (I.bullets || []).map(tx), diagram: I.diagram || null, realWorld: tx(I.realWorld || ''), tips: (I.tips || []).map(tx) });
  DS.courseDef = function (id, opts) {
    const L = DS.LESSONS2[id]; if (!L) return null;
    opts = opts || {};
    const demo = !!opts.demo, fpv = L.airframe === 'fpv';
    return {
      kind: 'course', id, key: 'course:' + id, lessonId: id, unit: L.unit, n: L.n, check: !!L.check,
      title: (demo ? '🎬 ' : '') + L.title, icon: L.icon,
      sub: L.check ? 'اختبار الوحدة ' + L.unit : 'الوحدة ' + L.unit + ' • الدرس ' + L.n,
      desc: tx(L.intro.text), intro: introText(L.intro),
      airframe: L.airframe, mode: L.mode || (fpv ? 'ANGLE' : 'P'), modeLocked: !!L.modeLocked, modeCycle: L.modeCycle,
      wind: L.wind || LIGHT, timeOfDay: L.timeOfDay || 'day', thermal: !!L.thermal, zone: L.zone || 'field',
      fence: L.fence != null ? L.fence : false, maxAlt: L.maxAlt || 120, spawn: L.spawn,
      lessonLock: Array.isArray(L.lock) ? L.lock.slice() : null,   // معلومة بس — القفل الفعلي يتحدث كل فريم (session.axisLock)
      faults: L.check ? true : undefined, aids: L.check ? 'none' : 'full',
      pass: { total: L.check ? 80 : 0 }, demo, seed: opts.seed, smartRth: L.smartRth,
      tasks: [() => new LessonTask(L, { demo })]
    };
  };
  const rec = id => { const P = DS.progress && DS.progress.course; return (P && P[id]) || null; };
  const isDone = id => { const r = rec(id); if (!r || !r.done) return false; return !DS.LESSONS2[id].check || (r.best || 0) >= 80; };
  DS.courseState = function () {
    const all = !!(DS.settings && DS.settings.unlockAll);
    let prevPassed = true;
    return DS.COURSE.map((u, ui) => {
      const ulocked = !all && ui > 0 && !prevPassed;
      let prevDone = true, anyDone = false, nDone = 0;
      const lessons = u.lessons.map(id => {
        const L = DS.LESSONS2[id], r = rec(id), dn = isDone(id);
        const locked = !dn && (ulocked || (!all && !prevDone));
        prevDone = dn; if (dn) { anyDone = true; nDone++; }
        return { id, key: 'course:' + id, title: L.title, icon: L.icon, n: L.n, airframe: L.airframe, done: dn, best: r ? (r.best || 0) : 0, locked };
      });
      const K = DS.LESSONS2[u.check], cr = rec(u.check), cdone = isDone(u.check);
      const check = { id: u.check, key: 'course:' + u.check, title: K.title, icon: K.icon, done: cdone, best: cr ? (cr.best || 0) : 0, locked: !cdone && (ulocked || (!all && nDone < lessons.length)) };
      prevPassed = cdone;
      return { unit: u.unit, title: u.title, icon: u.icon, desc: u.desc, airframe: u.airframe, locked: ulocked && !anyDone && !cdone, done: cdone, nDone, nTotal: lessons.length, lessons, check };
    });
  };
  DS.courseNext = function () {
    const S = DS.courseState();
    for (const u of S) {
      for (const l of u.lessons) if (!l.done && !l.locked) return l.id;
      if (!u.check.done && !u.check.locked) return u.check.id;
    }
    return null;
  };
  // الدرس اللي بعده بالترتيب (لزر "التالي" في النتيجة)
  DS.courseAfter = function (id) { const i = ORDER.indexOf(id); return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null; };
  DS.courseProgress = function () { let done = 0; ORDER.forEach(id => { if (isDone(id)) done++; }); return { done, total: ORDER.length }; };

  // الفحص الذاتي يطير كل الدروس والاختبارات بالطيار الآلي
  if (DS.registerDefs) DS.registerDefs(() => ORDER.map(id => DS.courseDef(id)));
  else { DS._defFns = DS._defFns || []; DS._defFns.push(() => ORDER.map(id => DS.courseDef(id))); }
})();
