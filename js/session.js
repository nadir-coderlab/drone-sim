// الجلسة: تدير المهام والأزرار (مثل ريموت DJI) والنتيجة والحفظ + الاختبار الذاتي
(function () {
  const DS = window.DS, U = DS.U;
  const STEP = DS.STEP = 1 / 120;                  // خطوة ثابتة في كل مكان (حتى الاختبار الذاتي)
  const VIEWS = DS.VIEWS = ['pilot', 'chase', 'fpv', 'top'];
  DS.VIEW_NAMES = { pilot: 'عين الطيار', chase: 'من ورا الدرون', fpv: 'كاميرا الدرون', top: 'من فوق' };
  const NH = { set() {}, setArrow() {}, update() {}, move() {}, remove() {} };
  DS.NullR = { add() { return NH; }, clear() {}, clearAll() {} };
  const NOP = {};
  const Y_HOLD = 0.7, VIEW_HOLD = 1.0;              // Y مطوّل = الحراري، VIEW مطوّل = ضوء الوميض
  const SMART = { dur: 10, margin: 0.02, minDist: 20 }; // رجوع ذكي للبيت لما البطارية تكفي للرجعة بس (DJI)

  // تسجيل مهام إضافية (content_pro.js و course.js) — لو tasks.js ما عرّفها
  if (!DS._defFns) DS._defFns = [];
  if (!DS.registerDefs) DS.registerDefs = fn => { if (typeof fn === 'function') DS._defFns.push(fn); };
  if (!DS.extraDefs) DS.extraDefs = () => { const out = []; DS._defFns.forEach(f => { try { const r = f(); if (r) out.push.apply(out, r); } catch (e) { console.warn(e); } }); return out; };

  const medalOf = sc => (DS.Score && DS.Score.medal) ? DS.Score.medal(sc) : sc >= 90 ? 'gold' : sc >= 80 ? 'silver' : sc >= 70 ? 'bronze' : null;
  const hashKey = k => { let h = 2166136261; for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619); return h >>> 0; };

  class Session {
    constructor(def, opts = {}) {
      this.def = def; this.demo = !!opts.demo; this.headless = !!opts.headless; this.seedOpt = opts.seed;
      this.R = opts.R || DS.NullR; this.onEnd = opts.onEnd || null; this.onMsg = opts.onMsg || null;
    }
    start() {
      const def = this.def, S = DS.settings || {};
      const seed = def.seed != null ? def.seed : this.seedOpt != null ? this.seedOpt : (Math.random() * 4294967296) >>> 0;
      this.seed = seed; this.rng = U.rng(seed);
      // مكان الإقلاع والطيار
      const sp = def.spawn || {}, sx = sp.x || 0, sz = sp.z || 0, syaw = sp.yaw || 0;
      const pil = sp.pilot || { x: sx, z: sz + 6 };
      if (!DS.PILOT) DS.PILOT = { x: 0, z: 6 };
      DS.PILOT.x = pil.x; DS.PILOT.z = pil.z;
      if (!DS.HOME) DS.HOME = { x: 0, z: 0 };
      DS.HOME.x = sx; DS.HOME.z = sz;
      this.spawn = { x: sx, z: sz, yaw: syaw, y: 0 };
      const d = this.drone = new DS.Drone(def.airframe || 'mini');
      d.reset(sx, sz, syaw);
      d.mode = (def.mode && DS.MODES[def.mode] && DS.MODES[def.mode].af === d.airframe) ? def.mode : d.profile.defaultMode;
      d.maxAlt = def.maxAlt || 120; d.home = { x: sx, z: sz, y: d.p.y };   // y = ارتفاع نقطة الإقلاع (لو على كثيب)
      this.spawn.y = d.p.y;
      const w = def.wind || { s: 0, g: 0 };
      this.windBase = { s: w.s || 0, g: w.g || 0, dir: w.dir != null ? w.dir : Math.floor(this.rng() * 8) * 45 };
      this.env = {
        wind: new DS.Wind(U.rng((seed ^ 0x5bd1e995) >>> 0)), colliders: (DS.World && DS.World.colliders) || [], taskColliders: [],
        isWater: null, blockers: [], rng: this.rng, timeOfDay: def.timeOfDay || 'day', dark: def.timeOfDay === 'night', thermal: !!def.thermal
      };
      this.env.wind.set(this.windBase.s, this.windBase.dir, this.windBase.g);
      // أكاديمية طويق (خريطة حقيقية): مكان ثاني بعيد عن عالم المحاكي — الأرض والمباني من الخريطة (أو المجسم التقريبي)
      // + منطقة حظر مطار الملك خالد (مثل DJI GEO). الخريطة الحقيقية (geo3d.js) تبدّل env.geo لما تجهز
      const TW = DS.TUWAIQ;
      if (TW && (def.zone === 'tuwaiq' || def.geo === 'tuwaiq')) {
        const E = this.env;
        E.colliders = []; E.terrain = false; E.compass = false; E.wake = false; E.worldLos = false;
        E.geo = (DS.Geo3D && DS.Geo3D.surface && DS.Geo3D.surface()) || TW.surface();
        E.fence = TW.fence; E.zone = 'tuwaiq';
      }
      this.faults =(def.faults && DS.Score && DS.Score.FaultManager) ? new DS.Score.FaultManager(def.faults === true ? undefined : def.faults) : null;
      this.tasks = (def.tasks || []).map(f => f());
      this.idx = -1; this.results = []; this.t = 0; this.wait = 0; this.ended = false; this.summary = null;
      this.view = VIEWS.includes(S.camera) ? S.camera : 'pilot'; this.viewsSeen = new Set([this.view]); this.viewCount = 0;
      this.pip = S.pip !== false; this.pipToggles = 0; this.gimbal = -12; this.zoom = 1; this.mapOffset = null;
      this.shots = 0; this.showTelem = false; this.stickHint = null; this.coach = null;
      // قفل العصي (الدروس): true = العصا هذي ما تشتغل. def.lockAxes = ['yaw', ...] من البداية
      const la = Array.isArray(def.lockAxes) ? def.lockAxes : [];
      this.axisLock = { thr: la.includes('thr') || la.includes('throttle'), yaw: la.includes('yaw'), pitch: la.includes('pitch'), roll: la.includes('roll') };
      this._lc = { thr: 0, yaw: 0, pitch: 0, roll: 0, throttle01: undefined, press: NOP, held: undefined, holdA: false, lt: 0, rt: 0 };
      this._lockAlt = null;
      this.thermalView = false; this.turtles = 0;
      // الرجوع الذكي: ما يشتغل في الاختبار الذاتي ولا العرض إلا إذا المهمة طلبته (def.smartRth === true)
      this.smartRth = { t: 0, dur: SMART.dur, active: false, done: false, fired: false, cancelled: false, socMin: 1,
        enabled: def.smartRth === true || (def.smartRth !== false && S.smartRth !== false && !this.headless && !this.demo) };
      this.yDown = false; this.yT = 0; this.yFired = false; this.vDown = false; this.vT = 0; this.vFired = false;
      this.pose0 = { x: d.p.x, y: d.p.y, z: d.p.z, qx: d.q.x, qy: d.q.y, qz: d.q.z, qw: d.q.w };
      this.aHold = 0; this.aFired = false; this.aNeedRelease = false; this.bHold = 0; this.bLatch = false;
      this.lbDown = false; this.lbZoomed = false; this._preAtti = null;
      this.controls = { thr: 0, yaw: 0, pitch: 0, roll: 0, press: {} };
      this.msgs = []; this.flightTime = 0;
      this.next();
    }
    get task() { return this.tasks[this.idx]; }
    get frozen() { const t = this.task; return !this.ended && !!(t && t.decision) && this.wait <= 0; }
    ctx() {
      if (!this._ctx) {
        this._cam = { pos: { x: 0, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 }, vfovDeg: 43 };
        this._iv = { angle: 180, dist: 0, ok: false };
        this._ctx = {
          session: this, R: this.R,
          msg: (t, k) => this.msg(t, k),
          say: (t, k) => this.say(t, k),
          camera: () => this.camera(),
          inView: (x, y, z, a) => this.inView(x, y, z, a),
          stepDone: () => { if (!this.headless && DS.Audio) DS.Audio.step(); }
        };
      }
      const c = this._ctx; c.drone = this.drone; c.env = this.env; c.controls = this.controls; c.rng = this.rng; c.faults = this.faults;
      return c;
    }
    // كاميرا الحمولة (مع الزوم). الكائن يتكرر استخدامه — لا تخزنه
    camera() {
      const d = this.drone, P = d.profile, o = this._cam || (this.ctx(), this._cam);
      d.cameraPose(this.gimbal, o);
      const base = P.kind === 'fpv' ? (+(DS.settings || {}).fpvFov || P.cam.vfov) : P.cam.vfov;
      o.vfovDeg = 2 * Math.atan(Math.tan(base * Math.PI / 360) / Math.max(1, this.zoom)) * 180 / Math.PI;
      return o;
    }
    // هل النقطة في الكادر؟ angle = الزاوية عن نص الكاميرا (درجات)
    inView(x, y, z, maxDeg) {
      const c = this.camera(), o = this._iv;
      const dx = x - c.pos.x, dy = y - c.pos.y, dz = z - c.pos.z, dist = Math.hypot(dx, dy, dz);
      const cs = dist > 1e-6 ? (dx * c.fwd.x + dy * c.fwd.y + dz * c.fwd.z) / dist : 1;
      o.dist = dist; o.angle = Math.acos(U.clamp(cs, -1, 1)) * 180 / Math.PI;
      o.ok = o.angle <= (maxDeg != null ? maxDeg : c.vfovDeg / 2);
      return o;
    }
    msg(text, kind) { this.msgs.push({ text, kind: kind || 'info', t: this.t }); if (this.msgs.length > 60) this.msgs.shift(); if (this.onMsg) this.onMsg(text, kind || 'info'); }
    // كلام المدرب: يطلع في الشاشة وبالصوت
    say(text, kind) {
      if (!text) return;
      const c = this.coach = { text, kind: kind || 'say', t: this.t, spoken: false };
      if (!this.headless && DS.Voice && DS.Voice.say) { try { DS.Voice.say(text, { priority: kind === 'bad' ? 'high' : 'normal' }); c.spoken = true; } catch (e) { /* الصوت اختياري */ } }
    }
    next() {
      const prev = this.task;
      if (prev) {
        prev.end(this.ctx());
        const d = this.drone, sp = this.spawn;   // نرجع كل شي طبيعي بين المهام
        d.setGnss(true); d.link = true; d.dist = { x: 0, z: 0 }; d.drain = 1; d.home = { x: sp.x, z: sp.z, y: sp.y || 0 }; d.rthSetting = 20;
        d.injectHeadingError(0); d.paused = false;
        if (d.battery < 50) { d.battery = 95; d.batWarned = {}; this.msg('🔋 بدّلنا البطارية', 'info'); }
        this.env.taskColliders = []; this.env.isWater = null; this.env.blockers = []; this.mapOffset = null; this.stickHint = null;
        this.env.wind.set(this.windBase.s, this.windBase.dir, this.windBase.g);
      }
      this.idx++;
      if (this.idx >= this.tasks.length) { if (this.def.kind !== 'free') this.finish(); return; }
      this.task.begin(this.ctx());
      this.msg('المهمة: ' + this.task.title, 'task');
    }
    step(dt, c) {
      if (this.ended) return;
      const d = this.drone, p0 = this.pose0;
      p0.x = d.p.x; p0.y = d.p.y; p0.z = d.p.z; p0.qx = d.q.x; p0.qy = d.q.y; p0.qz = d.q.z; p0.qw = d.q.w;
      c = c || this.controls;
      this.controls = c;
      this.handleButtons(dt, c);
      if (this.frozen) return;
      this.t += dt;
      this.env.wind.step(dt);
      d.step(dt, this.lockedControls(c), this.env);
      if (d.flying) this.flightTime += dt;
      this.smartTick(dt);
      if (d.turtleCount > this.turtles) {   // انقلب (FPV): خطأ كبير في الاختبارات
        this.turtles = d.turtleCount;
        if (this.faults && this.faults.add) { try { this.faults.add('major', 'turtle', this.t, 'انقلب الدرون على الأرض (CRASH FLIP)'); } catch (e) { /* اختياري */ } }
      }
      // FPV: بعد الخبطة وقف على الأرض وهو لسا مسلّح أكثر من 1.5 ث = خطأ بسيط (الطيار الحقيقي يطفيه على طول)
      if (d.crashRest != null) {
        if (!d.motors || !d.onGround) d.crashRest = null;
        else if (d.t - d.crashRest > 1.5) {
          d.crashRest = null;
          if (this.faults && this.faults.add) { try { this.faults.add('minor', 'nodisarm', this.t, 'ما طفيت المحركات بسرعة بعد الخبطة'); } catch (e) { /* اختياري */ } }
          this.say('بعد أي خبطة طفّ المحركات على طول (DISARM): A مطوّل', 'bad');
        }
      }
      this.update(dt);
    }
    // العصي بعد القفل (نفس الكائن كل مرة). FPV + ثروتل مقفول = يثبت الارتفاع لحاله
    lockedControls(c) {
      const L = this.axisLock;
      const d = this.drone;
      // بدون قفل: أو الدرون طافي على الأرض (عشان حركة تشغيل المحركات CSC تشتغل دايماً)
      if (!L || !(L.thr || L.yaw || L.pitch || L.roll) || (d.onGround && !d.motors)) { this._lockAlt = null; return c; }
      const o = this._lc;
      o.thr = L.thr ? 0 : c.thr; o.yaw = L.yaw ? 0 : c.yaw; o.pitch = L.pitch ? 0 : c.pitch; o.roll = L.roll ? 0 : c.roll;
      o.throttle01 = c.throttle01; o.press = c.press || NOP; o.held = c.held; o.holdA = c.holdA; o.lt = c.lt; o.rt = c.rt;
      if (L.thr) {
        if (this._lockAlt == null) this._lockAlt = d.p.y;
        if (d.profile.kind === 'fpv') o.throttle01 = (d.onGround || !d.motors) ? 0 : d.holdThrottle(U.clamp(1.5 * (this._lockAlt - d.p.y), -2, 2));
      } else this._lockAlt = null;
      return o;
    }
    isLocked(axis) { const L = this.axisLock; return !!(L && L[axis]); }
    // ---- الرجوع الذكي (DJI Mini): البطارية وصلت علامة H وأنت بعيد → عد تنازلي 10 ث ثم يرجع لحاله (B يلغي)
    smartTick(dt) {
      const sr = this.smartRth, d = this.drone;
      if (!sr || !sr.enabled || d.profile.kind !== 'dji') return;
      if (d.soc < sr.socMin) sr.socMin = d.soc;
      else if (d.soc > sr.socMin + 0.05) { sr.socMin = d.soc; sr.done = false; sr.cancelled = false; sr.fired = false; }   // بدّلنا البطارية
      if (sr.active) {
        if (!d.flying || d.crashed || d.auto || !d.link || !d.gps) { sr.active = false; return; }   // شي ثاني استلم
        sr.t -= dt;
        if (sr.t <= 0) {
          sr.t = 0; sr.active = false; sr.fired = true;
          d.toggleRTH();
          this.msg('🔋 الدرون رجع للبيت لحاله (البطارية تكفي للرجعة بس)', 'bad');
        }
        return;
      }
      if (sr.done || !d.flying || d.auto || !d.link || !d.gps || this.frozen) return;
      const h = d.home || DS.HOME || { x: 0, z: 0 };
      if (Math.hypot(d.p.x - h.x, d.p.z - h.z) < SMART.minDist) return;
      if (d.soc <= (d.rthSoc || 0) + SMART.margin) {
        sr.active = true; sr.done = true; sr.t = sr.dur;
        d.emit('warn', 'البطارية تكفي للرجوع بس — الدرون بيرجع للبيت لحاله (B يلغي)');
        this.say('البطارية على قد الرجعة. الدرون بيرجع للبيت لحاله بعد عشر ثواني، وإذا تبي تلغي اضغط B', 'bad');
      }
    }
    cancelSmartRth() {
      const sr = this.smartRth; if (!sr || !sr.active) return;
      sr.active = false; sr.cancelled = true;
      this.msg('انلغى الرجوع الذكي — انتبه للبطارية وارجع بنفسك', 'info');
    }
    // الأزرار مثل ريموت DJI. أوامر الدرون تنلغى إذا الإشارة مقطوعة (B2)
    handleButtons(dt, c) {
      const d = this.drone, p = c.press || NOP, held = c.held, S = DS.settings || {}, P = d.profile;
      const holdA = !!(c.holdA || (held && held.A));
      // وقت السؤال: لازم تفك A مرة بعد ما يتسكر (B17)
      if (this.frozen) { this.aNeedRelease = true; this.aHold = 0; this.aFired = false; this.yDown = false; this.vDown = false; return; }
      const up = d.link;
      // ---- محلي (ما يحتاج إشارة): الكاميرا، الشاشة الصغيرة، القياسات
      // Y: ضغطة = تبديل الكاميرا. Y مطوّل 0.7 ث = الحراري (إذا المهمة تسمح) — الضغطة تنحسب لما تفك عشان ما يصير الاثنين
      if (p.Y) {
        if (!this.def.thermal || !held) this.cycleView();
        else { this.yDown = true; this.yT = 0; this.yFired = false; }
      }
      if (this.yDown) {
        if (held && held.Y) {
          this.yT += dt;
          if (this.yT >= Y_HOLD && !this.yFired) { this.yFired = true; this.toggleThermal(); }
        } else { this.yDown = false; if (!this.yFired) this.cycleView(); }
      }
      // VIEW: ضغطة = القياسات، مطوّل ثانية = ضوء الوميض (Strobe)
      if (p.VIEW) {
        if (!held) this.showTelem = !this.showTelem;
        else { this.vDown = true; this.vT = 0; this.vFired = false; }
      }
      if (this.vDown) {
        if (held && held.VIEW) {
          this.vT += dt;
          if (this.vT >= VIEW_HOLD && !this.vFired) { this.vFired = true; this.toggleStrobe(); }
        } else { this.vDown = false; if (!this.vFired) this.showTelem = !this.showTelem; }
      }
      const lbHeld = held ? !!held.LB : null;
      if (p.LB) { if (lbHeld === null) this.togglePip(); else { this.lbDown = true; this.lbZoomed = false; } }
      if (this.lbDown && lbHeld === false) { this.lbDown = false; if (!this.lbZoomed) this.togglePip(); }
      // ---- A مطوّل: إقلاع/هبوط تلقائي
      if (this.aNeedRelease) { if (!holdA) this.aNeedRelease = false; this.aHold = 0; }
      else if (holdA && up) {
        this.aHold += dt;
        if (this.aHold > 0.8 && !this.aFired) {
          this.aFired = true;
          if (d.turtle) d.flipOver();
          else if (d.onGround && P.kind === 'fpv') { if (d.motors) d.stopMotors(); else d.startMotors(); }   // FPV: A مطوّل = سويتش التسليح (ARM/DISARM)
          else if (d.onGround) d.autoTakeoff(); else d.autoLand();
        }
      } else { this.aHold = 0; this.aFired = false; }
      // ---- B: مطوّل ثانية = رجوع للبيت، ضغطة وقت الرجوع = إلغاء
      const holdB = held ? !!held.B : false;
      if (up) {
        if (p.B && this.smartRth && this.smartRth.active) { this.cancelSmartRth(); this.bLatch = true; }
        else if (p.B && d.auto === 'rth') { d.toggleRTH(); this.bLatch = true; }
        else if (held) {
          if (holdB && !this.bLatch) {
            this.bHold += dt;
            if (this.bHold >= 1.0) { this.bLatch = true; if (d.auto !== 'rth') d.toggleRTH(); }
          }
        } else if (p.B) d.toggleRTH();   // يد قديمة بدون "held": ضغطة = تبديل
      }
      if (!holdB) { this.bHold = 0; this.bLatch = false; }
      if (!up) return;
      // ---- X: توقف (Flight Pause)
      if (p.X) d.pause();
      // ---- الأسهم: فوق/تحت = الوضع، يسار = ATTI (تدريب)، يمين = بلاغ
      if (p.UP || p.DOWN) this.cycleMode(p.UP ? 1 : -1);
      if (p.LEFT) this.toggleAtti();
      if (p.RIGHT) { const t = this.task; if (t && t.onCallout) t.onCallout(this.ctx()); }
      // ---- RB: تصوير
      if (p.RB) { this.shots++; d.emit('shutter', ''); const t = this.task; if (t && t.onShutter) t.onShutter(this.ctx()); }
      // ---- LT/RT: الكاميرا لتحت/فوق (100°/ث). LB مطوّل + LT/RT = زوم
      const lt = c.lt || 0, rt = c.rt || 0;
      if (this.lbDown && (lt > 0.05 || rt > 0.05)) {
        this.lbZoomed = true;
        this.zoom = U.clamp(this.zoom * Math.exp((rt - lt) * 1.2 * dt), 1, (P.cam && P.cam.maxZoom) || 1);
      } else if (!(P.kind === 'fpv' && S.fpvThrottle === 'trigger')) {
        const gMin = P.cam ? P.cam.gMin : -90, gMax = P.cam ? P.cam.gMax : 60;
        this.gimbal = U.clamp(this.gimbal + (rt - lt) * 100 * dt, gMin != null ? gMin : -90, gMax != null ? gMax : 60);
      }
    }
    togglePip() { this.pip = !this.pip; this.pipToggles++; }
    cycleView() { this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length]; this.viewsSeen.add(this.view); this.viewCount++; }
    toggleThermal() {
      if (!this.def.thermal) { this.msg('الكاميرا الحرارية مو متوفرة في هالمهمة', 'info'); return; }
      this.thermalView = !this.thermalView;
      this.msg(this.thermalView ? '🌡️ الكاميرا الحرارية شغالة (تشوفها في كاميرا الدرون) — Y مطوّل يطفيها' : 'الكاميرا الحرارية طفت — رجعت الصورة العادية', 'info');
    }
    toggleStrobe() {
      const d = this.drone;
      if (!d.link) { this.msg('ما فيه إشارة — ما تقدر تشغّل الضوء', 'info'); return; }
      const cur = d.strobe != null ? !!d.strobe : this.env.timeOfDay === 'night';
      d.strobe = !cur;
      this.msg(d.strobe ? '💡 ضوء الوميض (Strobe) اشتغل — يبان الدرون من بعيد بالليل' : 'ضوء الوميض (Strobe) طفى', 'info');
    }
    cycleMode(dir) {
      const d = this.drone, def = this.def;
      if (def.modeLocked) { this.msg('الوضع مقفول هنا (' + DS.MODES[d.mode].name + ')', 'info'); return; }
      const order = def.modeCycle || DS.modeOrder(d.airframe);
      let i = order.indexOf(d.mode);
      if (i < 0) i = Math.max(0, order.indexOf(this._preAtti || d.profile.defaultMode));
      const j = U.clamp(i + dir, 0, order.length - 1);
      if (order[j] === d.mode) { this.msg('هذا ' + (dir > 0 ? 'آخر' : 'أول') + ' وضع: ' + DS.MODES[d.mode].name, 'info'); return; }
      d.setMode(order[j]);
    }
    toggleAtti() {
      const d = this.drone, def = this.def;
      if (d.airframe !== 'mini') { this.msg('ATTI للدرون العادي بس', 'info'); return; }
      if (def.modeLocked) { this.msg('الوضع مقفول هنا (' + DS.MODES[d.mode].name + ')', 'info'); return; }
      if (d.mode === 'A') d.setMode(this._preAtti && this._preAtti !== 'A' ? this._preAtti : 'P');
      else { this._preAtti = d.mode; d.setMode('A'); }
    }
    inFence(x, z) {
      const f = this.def.fence;
      if (f && typeof f === 'object') return x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1;
      return DS.inField(x, z);
    }
    update(dt) {
      if (this.ended) return;
      const d = this.drone, def = this.def;
      if (d.crashed) return this.finish('crash', d.crashReason);
      // الاختبار الذاتي: إذا انقلب الـ FPV وما قلبه المحترف خلال 6 ث = طيحة (عشان ما يعلق الاختبار)
      if (d.turtle && this.headless) { this._turtleT = (this._turtleT || 0) + dt; if (this._turtleT > 6) return this.finish('crash', 'الدرون انقلب (CRASH FLIP) وما انقلب'); }
      else this._turtleT = 0;
      if (def.fence && !d.onGround) {
        if (!this.inFence(d.p.x, d.p.z)) return this.finish('fence', 'طلعت برا ساحة الاختبار');
        if (d.p.y > (def.maxAlt || 60) + 1) return this.finish('fence', 'تعديت أقصى ارتفاع مسموح (' + (def.maxAlt || 60) + ' م)');
      }
      if (this.faults && this.faults.failed && def.kind !== 'free') return this.finish('fail', 'تعديت حد الأخطاء المسموح');
      if (def.kind === 'free') { const ft = this.task; if (ft && ft.freeUpdate) ft.freeUpdate(dt, this.ctx()); return; }   // الطيران الحر ما يخلص
      if (this.wait > 0) { this.wait -= dt; if (this.wait <= 0) this.next(); return; }
      const task = this.task; if (!task) return;
      task.update(dt, this.ctx());
      if (task.state === 'done') {
        const sc = task.score();
        this.results.push({ task, title: task.short, score: sc, ok: true, tips: task.feedback() });
        if (!this.headless && DS.Audio) DS.Audio.ok();
        this.msg('✓ ' + task.short + ': ' + sc + '/100', 'good');
        this.wait = this.headless ? 0.05 : 1.8;
      } else if (task.state === 'fail') {
        this.results.push({ task, title: task.short, score: 0, ok: false, reason: task.failReason, tips: task.feedback() });
        if (!this.headless && DS.Audio) DS.Audio.fail();
        this.msg('✗ ' + task.short + ': ' + task.failReason, 'bad');
        if (def.kind === 'exam') this.wait = this.headless ? 0.05 : 2.2;
        else this.finish('fail', task.failReason);
      }
    }
    finish(kind, reason) {
      if (this.ended) return;
      const def = this.def, t = this.task;
      if ((kind === 'crash' || kind === 'fence' || kind === 'fail') && t && !this.results.find(r => r.task === t)) {
        this.results.push({ task: t, title: t.short, score: 0, ok: false, reason });
      }
      this.ended = true;
      const all = this.tasks.map(tk => this.results.find(r => r.task === tk) || { title: tk.short, score: 0, ok: false, reason: 'ما وصلت لها' });
      const total = all.length ? Math.round(all.reduce((a, r) => a + r.score, 0) / all.length) : 0;
      const pass = def.pass || { total: 60 };
      const critical = kind === 'crash' || kind === 'fence';
      const passed = all.length > 0 && !critical && kind !== 'fail' && total >= (pass.total || 0) && all.every(r => r.ok && r.score >= (pass.each || 0));
      const stars = passed ? (total >= 92 ? 3 : total >= 80 ? 2 : 1) : 0;
      // أفضل زمن (سباقات): المهام اللي فيها bestTime
      let bestTime = null;
      this.tasks.forEach(tk => { const b = tk.bestTime; if (typeof b === 'number' && isFinite(b) && b > 0 && (bestTime == null || b < bestTime)) bestTime = b; });
      const prev = DS.progress && DS.progress.best && def.key ? DS.progress.best[def.key] : null;
      const prevBest = prev && typeof prev.bestTime === 'number' ? prev.bestTime : null;
      this.summary = {
        def, kind: kind || 'done', reason: reason || '', results: all, total, passed, stars, time: this.t, demo: this.demo,
        bestTime, prevBest, newBest: !!(passed && bestTime != null && (prevBest == null || bestTime < prevBest)),
        faults: this.faults && this.faults.toJSON ? this.faults.toJSON() : null,
        medal: passed ? medalOf(total) : null, seed: this.seed, shots: this.shots, flightTime: this.flightTime
      };
      if (!this.demo && !this.headless) this.saveProgress();
      if (this.onEnd) this.onEnd(this.summary);
    }
    saveProgress() {
      const s = this.summary, P = DS.progress, def = this.def;
      if (!P) return;
      P.best = P.best || {}; P.lessons = P.lessons || {}; P.exams = P.exams || [];
      P.flightTime = (P.flightTime || 0) + this.flightTime;
      if (def.key && def.kind !== 'free') {
        const prev = P.best[def.key];
        let rec = prev;
        if (!prev || s.total > prev.total || (s.passed && !prev.passed)) rec = { total: s.total, passed: s.passed, stars: s.stars, medal: s.medal, date: Date.now() };
        if (prev && prev.bestTime != null && rec !== prev) rec.bestTime = prev.bestTime;
        if (s.passed && s.bestTime != null && (!rec || rec.bestTime == null || s.bestTime < rec.bestTime)) {
          if (rec === prev) rec = Object.assign({}, prev);
          rec.bestTime = s.bestTime;
        }
        P.best[def.key] = rec;
      }
      if (def.kind === 'lesson' && s.passed) P.lessons[def.id] = true;
      if (def.kind === 'course') {
        const id = def.lessonId || def.id; P.course = P.course || {};
        const r = P.course[id] || {}; r.done = !!(r.done || s.passed); r.best = Math.max(r.best || 0, s.total); P.course[id] = r;
      }
      if (def.kind === 'exam') { P.exams.unshift({ id: def.id, title: def.title, total: s.total, passed: s.passed, date: Date.now() }); P.exams = P.exams.slice(0, 20); }
      if (DS.saveProgress) DS.saveProgress();
    }
  }
  DS.Session = Session;

  // ---------------- اختبار ذاتي: المحترف يطير كل شي ----------------
  DS.allDefs = function () {
    const defs = [];
    DS.LESSONS.forEach(l => defs.push(DS.lessonDef(l)));
    DS.MISSIONS.forEach(m => DS.DIFF_ORDER.forEach(k => defs.push(DS.missionDef(m, k))));
    DS.SCENARIOS.forEach(s => defs.push(DS.scenarioDef(s)));
    DS.FLIGHT_EXAMS.forEach(e => defs.push(DS.examDef(e)));
    if (DS.extraDefs) { try { const x = DS.extraDefs(); if (x && x.length) defs.push.apply(defs, x); } catch (e) { console.warn('extraDefs', e); } }
    return defs;
  };
  DS.runSelfTest = function (filter, dt) {
    dt = dt || STEP;
    const out = [];
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    for (const def of DS.allDefs()) {
      if (filter && !def.key.includes(filter)) continue;
      const s = new Session(def, { headless: true, demo: true, seed: def.seed != null ? def.seed : hashKey(def.key) });
      const ap = new DS.Autopilot(true);
      const t0 = now();
      let err = null;
      try {
        s.start();
        let t = 0;
        while (!s.ended && t < 1500) { s.step(dt, ap.compute(dt, s)); t += dt; }
      } catch (e) { err = String(e && e.stack || e).slice(0, 400); }
      const sm = s.summary;
      out.push({
        key: def.key, ended: s.ended, err, passed: sm ? sm.passed : false, total: sm ? sm.total : null, kind: sm ? sm.kind : 'timeout',
        reason: sm ? sm.reason : '', simT: Math.round(s.t), ms: Math.round(now() - t0),
        tasks: sm ? sm.results.map(r => r.title + '=' + r.score + (r.reason ? '(' + r.reason + ')' : '')) : (s.task ? ['stuck@' + s.task.short + ': ' + s.task.hint] : [])
      });
    }
    return out;
  };
  DS.validateQB = function () {
    const bad = [];
    DS.QB.forEach((q, i) => {
      if (!q.q || !Array.isArray(q.a) || q.a.length !== 4 || new Set(q.a).size !== 4 || q.c !== 0 || !DS.TOPICS[q.t] || !q.ex) bad.push(i + ':' + q.q);
    });
    for (let i = 0; i < 400; i++) {
      const q = DS.genCalc();
      if (!q || q.a.length !== 4 || new Set(q.a).size !== 4) bad.push('gen:' + (q ? q.q + ' ' + q.a.join('|') : 'null'));
    }
    const byTopic = {}; DS.QB.forEach(q => { const k = q.t + ':' + q.lang; byTopic[k] = (byTopic[k] || 0) + 1; });
    return { total: DS.QB.length, gloss: DS.GLOSS.length, bad, byTopic };
  };
})();
