// أنواع المهام: ثبات، مسار، دوران، هبوط، سيناريو/درس/أسئلة
(function () {
  const DS = window.DS, U = DS.U;
  // تسجيل مهام إضافية (content_pro.js و course.js يسجلون هنا لأنهم يتحملون قبل session.js)
  if (!DS._defFns) DS._defFns = [];
  if (!DS.registerDefs) DS.registerDefs = fn => { if (typeof fn === 'function') DS._defFns.push(fn); };
  if (!DS.extraDefs) DS.extraDefs = () => { const out = []; DS._defFns.forEach(f => { try { const r = f(); if (r) out.push.apply(out, r); } catch (e) { console.warn(e); } }); return out; };
  const HEAD_TXT ={ tail: 'ظهره لك (وجهه لقدام مثلك)', nose: 'وجهه لك', left: 'وجهه على يسارك', right: 'وجهه على يمينك' };
  const HEAD_OFF = { tail: 0, nose: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
  DS.HEAD_TXT = HEAD_TXT;
  // أسماء العصي حسب وضع الريموت (Mode 2 = الارتفاع يسار، Mode 1 = الارتفاع يمين والقدام/ورا يسار)
  const M1 = () => !!(DS.settings && DS.settings.stickMode === 1);
  const THR = () => (M1() ? 'العصا اليمين' : 'العصا اليسار'), PIT = () => (M1() ? 'العصا اليسار' : 'العصا اليمين');
  DS.stickName = { thr: THR, pitch: PIT };

  const altAdvice = (y, alt, tol) => {
    if (y < alt - tol) return ' — ارفع لين ' + Math.round(alt) + ' م';
    if (y > alt + tol) return ' — نزّل لين ' + Math.round(alt) + ' م';
    return '';
  };
  const goHint = (d, x, z, what) => what + ' ' + U.relDir(d.yaw, U.bearing(d.p.x, d.p.z, x, z)) + ' (' + Math.round(U.dist2(d.p.x, d.p.z, x, z)) + ' م)';

  // ---------------- الأساس ----------------
  class Task {
    constructor(o) {
      this.o = o; this.title = o.title; this.short = o.short || o.title; this.desc = o.desc || '';
      this.t = 0; this.state = 'run'; this.failReason = ''; this.hint = ''; this.progress = 0;
      this.tl = o.timeLimit || 240; this.decision = null;
    }
    begin(ctx) { this.t = 0; }
    update() {}
    score() { return this.state === 'done' ? 100 : 0; }
    guide() { return null; }
    map() { return []; }
    feedback() { return []; }
    end(ctx) { ctx.R.clear(this); }
    fail(r) { if (this.state === 'run') { this.state = 'fail'; this.failReason = r; } }
    baseHint(d) {
      if (d.onGround && !d.motors) return 'شغّل المحركات: نزّل العصاتين لتحت ولداخل مع بعض (أو اضغط A مطوّل للإقلاع التلقائي)';
      if (d.onGround) return 'ارفع ' + THR() + ' لفوق عشان تقلع';
      return null;
    }
    // ---- v2: الأخطاء (محلي للدرجة + يوصل لمدير الجلسة ctx.faults لو موجود) ----
    // opts: {minT, majorT, k2, rearm, gap} للمراقبة (track). الافتراضي: طلعة أقل من ثانية ما تنحسب، وطلعة ثانية خلال ثانية = نفس الطلعة
    // (هزة 0.3 ث مو خطأ GVC). الكبير: بعد 2 ث أو ضعف الحد (قواعد الاختبار)
    initFaults(ctx, opts) {
      this.ctx = ctx;
      const FM = DS.Score && DS.Score.FaultManager;
      const o = Object.assign({ minT: 1.0, rearm: 1.0, gap: 0.25 }, this.o && this.o.faultOpts, opts || {});
      this.fm = FM ? new FM({ minor: 1e9, major: 1e9, safety: 1e9, minT: o.minT, majorT: o.majorT, k2: o.k2, rearm: o.rearm, gap: o.gap, onFault: e => this._fwdFault(e) }) : null;
    }
    _fwdFault(e) {
      const c = this.ctx, F = c && c.faults;
      if (F && F !== this.fm && F.add) F.add(e.cls, e.code, c.session ? c.session.t : e.t, e.text);
      if (e.cls !== 'minor' && c && c.say && this.o.sayFaults !== false && e.text) c.say('⚠️ ' + e.text, e.cls === 'safety' ? 'bad' : 'warn');
    }
    fault(cls, code, text) {
      if (this.fm) this.fm.add(cls, code, this.t, text);
      if (cls === 'safety' && this.o.safetyFail !== false) this.fail(text || (DS.Score && DS.Score.FAULT_TXT[code]) || 'خطأ أمان');
    }
    trackF(code, err, tol, text) { return this.fm ? this.fm.track(code, err, tol, this.t, text) : (err > tol ? 1 : 0); }
    penalty() { return this.fm ? this.fm.penalty() : 0; }
    // ---- v2: سؤال/تقرير وقت الطيران (الوقت يوقف لين يجاوب) — main.js يقرا task.st.k ----
    ask(q) {
      if (!this.st) this.st = { k: 0 };
      this.st.k = (this.st.k || 0) + 1;
      this.decision = Object.assign({ chosen: -1, lang: 'ar' }, q);
    }
    answer(k) {
      const d = this.decision;
      if (!d || d.chosen >= 0) return;
      d.chosen = k;
      const ok = k === d.c;
      (this.answers || (this.answers = [])).push(ok);
      if (d.onAnswer) d.onAnswer(ok, k);
      if (DS.Audio && !(this.ctx && this.ctx.session && this.ctx.session.headless)) { if (ok) DS.Audio.ok(); else DS.Audio.fail(); }
    }
    ack(ctx) { const d = this.decision; if (d && d.chosen >= 0) { this.decision = null; if (d.onAck) d.onAck(ctx); } }
    // تقارير آخر المهمة: [{q, a:[4 خيارات], c (رقم الصح أو دالة (task)→رقم), ex}] — الخيارات تنخلط
    queueReports(list) {
      this._rq = [];
      (list || []).forEach(q => {
        const c = typeof q.c === 'function' ? q.c(this) : q.c;
        if (!q || !q.a || c == null || c < 0) return;
        let a = q.a.slice(), cc = c;
        if (q.shuffle !== false && this.ctx && this.ctx.rng) {
          const idx = a.map((_, i) => i), r = this.ctx.rng;
          for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
          a = idx.map(i => q.a[i]); cc = idx.indexOf(c);
        }
        this._rq.push({ q: q.q, a, c: cc, ex: q.ex || '', report: true });
      });
    }
    nextReport() { if (this.decision || !this._rq || !this._rq.length) return !!this.decision; this.ask(this._rq.shift()); return true; }
    reportScore() { const A = this.answers; return A && A.length ? A.filter(Boolean).length / A.length : null; }
  }
  DS.Task = Task;

  // ---------------- فحص الهبوط ----------------
  class LandCheck {
    constructor(x, z, r, maxVs) { this.x = x; this.z = z; this.r = r; this.maxVs = maxVs || 1.2; this.td = null; this.wasAir = false; this.bounces = 0; this.desc = false; }
    update(d) {
      if (!d.onGround) { this.wasAir = true; if (this.td) { this.td = null; this.bounces++; } }
      else if (this.wasAir && d.touchdown && !this.td) {
        this.td = { dist: U.dist2(d.touchdown.x, d.touchdown.z, this.x, this.z), vs: d.touchdown.vs, hs: d.touchdown.hs || 0 };
      }
      return this.td && !d.motors ? 'done' : null;
    }
    score() {
      const { dist, vs } = this.td, r = this.r;
      let s = dist <= r ? 100 - 25 * dist / r : 75 - 75 * (dist - r) / (2 * r);
      if (vs > this.maxVs) s -= Math.min(40, (vs - this.maxVs) * 40);
      const hs = this.td.hs || 0;   // لمس الأرض وهو ماشي على جنب
      if (hs > 0.5) s -= Math.min(30, (hs - 0.5) * 40);
      s -= 8 * this.bounces;
      return U.clamp(Math.round(s), 0, 100);
    }
    hint(d, label) {
      if (d.onGround && !this.wasAir) return d.motors ? 'ارفع ' + THR() + ' عشان تقلع' : 'شغّل المحركات (العصاتين لتحت ولداخل) وأقلع';
      if (this.td) return d.airframe === 'fpv' ? 'طفّ المحركات (DISARM): A مطوّل أو CSC' : 'خل ' + THR() + ' تحت للآخر لين تطفي المحركات';
      // نزول تلقائي: الطيار مو هو اللي ينزّل — لا نلومه على السرعة
      if (d.auto === 'rth') return 'الدرون راجع للبيت لحاله — خل العصي بالنص (ضغطة B تلغي)';
      if (d.auto === 'land') return 'هبوط تلقائي — خل العصي بالنص (ارفع ' + THR() + ' للإلغاء)';
      if (d.auto === 'forced') return 'هبوط اضطراري — ينزل غصب عنه، بس تقدر توجّهه فوق المنصة (' + (M1() ? 'العصا اليسار قدام/ورا واليمين جنب' : 'العصا اليمين') + ')';
      const eh = U.dist2(d.p.x, d.p.z, this.x, this.z);
      if (eh > this.r) return goHint(d, this.x, this.z, 'روح فوق المنصة ' + (label || ''));
      if (-d.v.y > this.maxVs) return 'بشويش! نزولك سريع — خفف ' + THR();
      return d.p.y > 3 ? 'أنت فوق المنصة ✓ نزّل بهدوء (' + THR() + ' شوي لتحت)' : 'آخر مترين: نزول بطيء جداً وثابت…';
    }
    guide(d) {
      const eh = U.dist2(d.p.x, d.p.z, this.x, this.z);
      if (d.onGround) return this.wasAir ? { x: this.x, z: this.z, descend: true } : { x: this.x, z: this.z, alt: 3 };
      // يبدأ ينزل إذا صار فوق المنصة (مع سماحية للهبات القوية على المنصات الكبيرة)
      if (eh < Math.max(0.35, 0.2 * this.r)) this.desc = true; else if (eh > Math.max(0.9, 0.45 * this.r)) this.desc = false;
      if (!this.desc) return { x: this.x, z: this.z, alt: Math.max(3, Math.min(d.p.y, 15)), speed: Math.min(5, 1 + eh * 0.6) };
      return { x: this.x, z: this.z, descend: true };
    }
  }
  DS.LandCheck = LandCheck;

  // ---------------- الثبات داخل منطقة ----------------
  // o: {x, z, r, rv, headTol, steps:[{alt, hold, head}]}
  class HoverTask extends Task {
    begin(ctx) {
      super.begin(ctx);
      this.step = 0; this.held = 0; this.inside = false; this.entered = false;
      this.exits = 0; this.eH = 0; this.eV = 0; this.n = 0; this.headBad = 0;
      this.zone = ctx.R.add(this, { type: 'zone', x: this.o.x, z: this.o.z, y: this.cur().alt, r: this.o.r, h: 2 * this.o.rv });
    }
    cur() { return this.o.steps[Math.min(this.step, this.o.steps.length - 1)]; }
    reqYaw() {
      const s = this.cur(); if (!s.head) return null;
      return U.wrap(U.bearing(DS.PILOT.x, DS.PILOT.z, this.o.x, this.o.z) + HEAD_OFF[s.head]);
    }
    update(dt, ctx) {
      const d = ctx.drone, o = this.o, s = this.cur();
      this.t += dt;
      const eh = U.dist2(d.p.x, d.p.z, o.x, o.z), ev = Math.abs(d.p.y - s.alt);
      const ry = this.reqYaw();
      const headOk = ry == null || Math.abs(U.wrap(ry - d.yaw)) <= U.rad(o.headTol || 30);
      const inside = !d.onGround && eh <= o.r && ev <= o.rv && headOk;
      if (inside) { this.entered = true; this.held += dt; }
      else if (this.inside && this.entered) this.exits++;
      if (this.entered) { this.eH += eh * dt; this.eV += ev * dt; this.n += dt; if (!headOk) this.headBad += dt; }
      this.inside = inside;
      this.zone.set(inside ? 'in' : this.entered ? 'out' : 'idle');
      this.zone.setArrow(ry);

      const b = this.baseHint(d);
      if (b) this.hint = b;
      else if (eh > o.r) this.hint = goHint(d, o.x, o.z, 'روح للعمود الملوّن');
      else if (ev > o.rv) this.hint = d.p.y < s.alt ? 'ارفع شوي (' + THR() + ' لفوق) لين ' + s.alt + ' م' : 'نزّل شوي (' + THR() + ' لتحت) لين ' + s.alt + ' م';
      else if (!headOk) this.hint = 'لف الدرون لين يصير ' + HEAD_TXT[s.head] + ' — بالعصا اليسار يمين/يسار';
      else this.hint = 'ممتاز! اثبت كذا… باقي ' + Math.ceil(s.hold - this.held) + ' ثانية';
      this.progress = (this.step + Math.min(1, this.held / s.hold)) / o.steps.length;

      if (this.held >= s.hold) {
        this.step++; this.held = 0; this.inside = false; this.entered = false;
        if (this.step >= o.steps.length) { this.state = 'done'; return; }
        ctx.stepDone();
        this.zone.update({ y: this.cur().alt });
      }
      if (this.t > this.tl) this.fail('خلص الوقت');
    }
    score() {
      if (this.state !== 'done') return 0;
      const n = Math.max(this.n, 1e-3), o = this.o;
      const s = 100 - 6 * this.exits - 30 * (this.eH / n) / o.r - 15 * (this.eV / n) / o.rv - 25 * this.headBad / n;
      return U.clamp(Math.round(s), 0, 100);
    }
    feedback() {
      const t = [], n = Math.max(this.n, 1e-3);
      if (this.exits > 2) t.push('كثير تطلع من المنطقة: صحّح بحركات صغيرة وبدري قبل لا يبعد');
      if (this.eV / n > this.o.rv * 0.5) t.push('الارتفاع يتغير: لا تلمس ' + THR() + ' وأنت تصحح المكان');
      if (this.headBad / n > 0.15) t.push('انتبه لاتجاه وجه الدرون (النور الأحمر قدام)');
      return t;
    }
    guide() { const s = this.cur(); return { x: this.o.x, z: this.o.z, alt: s.alt, yaw: this.reqYaw(), speed: 4 }; }
    map() { return [{ kind: 'zone', x: this.o.x, z: this.o.z, r: this.o.r, state: this.inside ? 'in' : 'next' }]; }
  }
  DS.HoverTask = HoverTask;

  // ---------------- مسار بنقاط أو بوابات ----------------
  // o: {pts:[{x,z,alt,r} | {x,z,alt,gate:true,R,yaw}], altTol, nose:'any'|'forward'|'fixed'|'noseIn'|'tail', fixedYaw, headTol, par, pylons:[{x,z,h}], speed}
  class CourseTask extends Task {
    begin(ctx) {
      super.begin(ctx);
      const o = this.o;
      this.i = 0; this.legT = 0; this.altBad = 0; this.headBad = 0; this.headOkNow = true; this.altOkNow = true;
      this.vis = o.pts.map((p, k) => {
        if (p.gate) {
          ctx.env.taskColliders.push({ type: 'ring', x: p.x, y: p.alt, z: p.z, yaw: p.yaw, R: p.R, r: 0.12, name: 'البوابة', thin: true });
          ctx.env.taskColliders.push({ type: 'cyl', x: p.x, z: p.z, r: 0.12, h: p.alt - p.R - 0.15, name: 'عمود البوابة', thin: true });
          return ctx.R.add(this, { type: 'gate', x: p.x, y: p.alt, z: p.z, yaw: p.yaw, R: p.R, label: k + 1 });
        }
        return ctx.R.add(this, { type: 'beacon', x: p.x, z: p.z, alt: p.alt, r: p.r, label: k + 1 });
      });
      (o.pylons || []).forEach(py => {
        ctx.R.add(this, { type: 'pylon', x: py.x, z: py.z, h: py.h || 7 });
        ctx.env.taskColliders.push({ type: 'cyl', x: py.x, z: py.z, r: 0.35, h: py.h || 7, name: 'العمود' });
      });
      this.vis[0].set('next');
    }
    reqYaw(d) {
      const o = this.o, P = o.pts[this.i];
      switch (o.nose) {
        case 'forward': return U.dist2(d.p.x, d.p.z, P.x, P.z) > Math.max(3, P.r || 2) ? U.bearing(d.p.x, d.p.z, P.x, P.z) : null;
        case 'fixed': return o.fixedYaw;
        case 'noseIn': return U.bearing(d.p.x, d.p.z, DS.PILOT.x, DS.PILOT.z);
        case 'tail': return U.bearing(DS.PILOT.x, DS.PILOT.z, d.p.x, d.p.z);
      }
      return null;
    }
    update(dt, ctx) {
      const d = ctx.drone, o = this.o, P = o.pts[this.i];
      this.t += dt;
      let reached = false;
      if (P.gate) {
        // البوابة تنحسب بس إذا عديت من نصها (قطعت مستوى البوابة وأنت داخل الحلقة)
        const n = U.fwd(P.yaw), rr = U.right(P.yaw);
        const dx = d.p.x - P.x, dy = d.p.y - P.alt, dz = d.p.z - P.z;
        const along = dx * n.x + dz * n.z, rad = Math.hypot(dx * rr.x + dz * rr.z, dy);
        if (this.prevAlong != null && this.prevAlong < 0 && along >= 0 && rad < P.R - 0.25) reached = true;
        this.prevAlong = along; this.gAlong = along;
      } else reached = !d.onGround && U.dist2(d.p.x, d.p.z, P.x, P.z) <= P.r && Math.abs(d.p.y - P.alt) <= Math.max(o.altTol, 1.5) * 1.2;

      if (this.i > 0 && !d.onGround) {
        this.legT += dt;
        const Q = o.pts[this.i - 1];
        const L = Math.max(1, U.dist2(Q.x, Q.z, P.x, P.z));
        const f = U.clamp(1 - U.dist2(d.p.x, d.p.z, P.x, P.z) / L, 0, 1);
        this.altOkNow = Math.abs(d.p.y - U.lerp(Q.alt, P.alt, f)) <= o.altTol;
        if (!this.altOkNow) this.altBad += dt;
        const ry = this.reqYaw(d);
        this.headOkNow = ry == null || Math.abs(U.wrap(ry - d.yaw)) <= U.rad(o.headTol || 35);
        if (!this.headOkNow) this.headBad += dt;
      }
      if (reached) {
        this.vis[this.i].set('done');
        if (P.gate) this.lastGate = { P, t: this.t };
        this.prevAlong = null;
        this.i++;
        if (this.i >= o.pts.length) { this.state = 'done'; return; }
        ctx.stepDone();
        this.vis[this.i].set('next');
      }
      const b = this.baseHint(d), N = o.pts[this.i];
      if (b) this.hint = b;
      else {
        let h = goHint(d, N.x, N.z, (N.gate ? 'ادخل من نص البوابة ' : 'روح للعلامة ') + (this.i + 1));
        if (N.gate && this.gAlong > 0.5) h = 'أنت ورا البوابة ' + (this.i + 1) + ' — لف من جنبها وادخل من الجهة الثانية (مع اتجاه السهم)';
        else if (!this.headOkNow) {
          h = o.nose === 'noseIn' ? 'خل وجه الدرون لك (انتبه: الحركات معكوسة)' :
            o.nose === 'fixed' ? 'لا تلف الدرون — خل وجهه لقدام وتحرك بالعصا اليمين بس' :
              o.nose === 'tail' ? 'خل ظهر الدرون لك' : 'لف الدرون عشان وجهه يكون على طريقه';
        } else if (!this.altOkNow) h += altAdvice(d.p.y, N.alt, 0);
        this.hint = h;
      }
      this.progress = this.i / o.pts.length;
      if (this.t > this.tl) this.fail('خلص الوقت');
    }
    score() {
      if (this.state !== 'done') return 0;
      const T = Math.max(this.legT, 1e-3), par = this.o.par || 60;
      const timePen = U.clamp((this.legT - par) / par, 0, 1) * 20;
      return U.clamp(Math.round(100 - 45 * this.altBad / T - 45 * this.headBad / T - timePen), 0, 100);
    }
    feedback() {
      const t = [], T = Math.max(this.legT, 1e-3);
      if (this.altBad / T > 0.2) t.push('حافظ على نفس الارتفاع بين العلامات');
      if (this.headBad / T > 0.2) t.push(this.o.nose === 'noseIn' ? 'تدرّب أكثر على الوجه لك: الحركات معكوسة يمين ويسار' : 'خل وجه الدرون على الاتجاه المطلوب');
      if (this.legT > (this.o.par || 60)) t.push('حاول تكون أسرع شوي بعد ما تتقن الدقة');
      return t;
    }
    guide(ctx) {
      const d = ctx.drone, o = this.o, P = o.pts[this.i];
      const sp = o.speed || 4;
      let yaw = this.reqYaw(d);
      if (o.nose === 'forward' && yaw == null) {
        const N2 = o.pts[this.i + 1]; yaw = N2 ? U.bearing(d.p.x, d.p.z, N2.x, N2.z) : null;
      }
      const LG = this.lastGate;
      if (LG && this.t - LG.t < 1.2) {   // كمّل شوي بعد البوابة قبل ما تلف
        const n0 = U.fwd(LG.P.yaw);
        return { x: LG.P.x + n0.x * 4, z: LG.P.z + n0.z * 4, alt: LG.P.alt, yaw, speed: 3 };
      }
      if (P.gate) {
        const n = U.fwd(P.yaw), rr = U.right(P.yaw), dx = d.p.x - P.x, dz = d.p.z - P.z;
        const along = dx * n.x + dz * n.z, lat = dx * rr.x + dz * rr.z;
        if (this.aroundFor !== this.i) { this.aroundFor = this.i; this.around = along > -0.5; }
        if (this.around && along < -3) this.around = false;
        if (this.around) {   // ورا البوابة: لف من جنبها للجهة الصح
          const side = lat >= 0 ? 1 : -1, off = P.R + 3;
          const k = Math.abs(lat) < off - 0.5 ? Math.max(along, 2) : -6;
          return { x: P.x + n.x * k + rr.x * side * off, z: P.z + n.z * k + rr.z * side * off, alt: P.alt, yaw, speed: 3 };
        }
        const a = Math.min(along + 3, 3);
        return { x: P.x + n.x * a, z: P.z + n.z * a, alt: P.alt, yaw, speed: Math.min(sp, 3) };
      }
      return { x: P.x, z: P.z, alt: P.alt, yaw, speed: sp };
    }
    map() {
      return this.o.pts.map((p, k) => ({ kind: p.gate ? 'gate' : 'beacon', x: p.x, z: p.z, r: p.r || p.R, label: k + 1, state: k < this.i ? 'done' : k === this.i ? 'next' : 'idle' }))
        .concat((this.o.pylons || []).map(p => ({ kind: 'pylon', x: p.x, z: p.z })));
    }
  }
  DS.CourseTask = CourseTask;

  // ---------------- الدوران حول نقطة ووجهه عليها ----------------
  // o: {x, z, R, band, alt, altTol, headTol, deg, dir}
  class OrbitTask extends Task {
    begin(ctx) {
      super.begin(ctx);
      const o = this.o;
      this.sum = 0; this.last = null; this.on = false; this.bad = 0; this.tot = 0; this.okNow = false;
      this.ring = ctx.R.add(this, { type: 'orbit', x: o.x, z: o.z, R: o.R, band: o.band });
      ctx.env.taskColliders.push({ type: 'cyl', x: o.x, z: o.z, r: 1.3, h: 4.5, name: 'التمثال' });
    }
    update(dt, ctx) {
      const d = ctx.drone, o = this.o;
      this.t += dt;
      const ang = U.bearing(o.x, o.z, d.p.x, d.p.z), rad = U.dist2(d.p.x, d.p.z, o.x, o.z);
      const ry = U.bearing(d.p.x, d.p.z, o.x, o.z);
      const headOk = Math.abs(U.wrap(ry - d.yaw)) <= U.rad(o.headTol);
      const radOk = Math.abs(rad - o.R) <= o.band, altOk = Math.abs(d.p.y - o.alt) <= o.altTol;
      const ok = !d.onGround && radOk && altOk && headOk;
      this.okNow = ok;
      if (!this.on) { if (ok) { this.on = true; this.last = ang; } }
      else {
        const dA = U.wrap(ang - this.last); this.last = ang;
        this.tot += dt;
        if (ok) this.sum += dA; else this.bad += dt;
      }
      this.ring.set(ok ? 'in' : 'out');
      this.progress = U.clamp(Math.abs(this.sum) / U.rad(o.deg), 0, 1);
      const b = this.baseHint(d);
      if (b) this.hint = b;
      else if (!radOk) this.hint = rad > o.R ? 'قرّب من التمثال لين تصير على الدائرة' : 'ابعد شوي عن التمثال لين تصير على الدائرة';
      else if (!altOk) this.hint = altAdvice(d.p.y, o.alt, 0).replace(' — ', '');
      else if (!headOk) this.hint = 'لف الدرون لين يصير وجهه على التمثال';
      else this.hint = 'ممتاز! كمّل اللفة: العصا اليمين جنب + العصا اليسار لف بشويش مع بعض (' + Math.round(this.progress * 100) + '%)';
      if (this.progress >= 1) { this.state = 'done'; return; }
      if (this.t > this.tl) this.fail('خلص الوقت');
    }
    score() {
      if (this.state !== 'done') return 0;
      const o = this.o, par = (o.deg / 360) * 2 * Math.PI * o.R / 1.8 + 10;
      const timePen = U.clamp((this.tot - par) / par, 0, 1) * 15;
      return U.clamp(Math.round(100 - 70 * this.bad / Math.max(this.tot, 1e-3) - timePen), 0, 100);
    }
    feedback() { return this.bad / Math.max(this.tot, 1e-3) > 0.2 ? ['خل المسافة ثابتة ووجهه على التمثال: اخلط حركة الجنب مع اللف بهدوء'] : []; }
    guide(ctx) {
      const d = ctx.drone, o = this.o;
      const ang = U.bearing(o.x, o.z, d.p.x, d.p.z);
      const a = this.on ? ang + (o.dir || 1) * 0.35 : ang;
      return { x: o.x + Math.sin(a) * o.R, z: o.z - Math.cos(a) * o.R, alt: o.alt, yaw: U.bearing(d.p.x, d.p.z, o.x, o.z), speed: 3 };
    }
    map() { return [{ kind: 'orbit', x: this.o.x, z: this.o.z, r: this.o.R, state: this.okNow ? 'in' : 'next' }]; }
  }
  DS.OrbitTask = OrbitTask;

  // ---------------- الهبوط الدقيق ----------------
  // o: {x, z, r, maxVs, label, home}
  class LandingTask extends Task {
    begin(ctx) {
      super.begin(ctx);
      const o = this.o;
      this.lc = new LandCheck(o.x, o.z, o.r, o.maxVs);
      if (!o.home) this.pad = ctx.R.add(this, { type: 'pad', x: o.x, z: o.z, r: o.r, label: o.label || '' });
    }
    update(dt, ctx) {
      const d = ctx.drone; this.t += dt;
      const r = this.lc.update(d);
      this.hint = this.lc.hint(d, this.o.label || 'H');
      this.progress = this.lc.td ? 0.9 : d.onGround ? 0 : 0.5;
      if (r === 'done') {
        if (this.lc.td.dist > this.o.r * 3) return this.fail('هبطت بعيد عن المنصة');
        this.state = 'done'; return;
      }
      if (this.t > this.tl) this.fail('خلص الوقت');
    }
    score() { return this.state === 'done' ? this.lc.score() : 0; }
    feedback() {
      const t = []; if (!this.lc.td) return t;
      if (this.lc.td.dist > this.o.r * 0.5) t.push('وقّف فوق المنصة بالضبط قبل ما تبدأ تنزل');
      if (this.lc.td.vs > this.lc.maxVs) t.push('نزولك كان قوي: آخر مترين خلها بطيئة');
      if (this.lc.td.hs > 0.5) t.push('وقف الحركة الجانبية قبل لا تلمس');
      return t;
    }
    guide(ctx) { return this.lc.guide(ctx.drone); }
    map() { return [{ kind: 'pad', x: this.o.x, z: this.o.z, r: this.o.r, label: this.o.label || 'H', state: 'next' }]; }
  }
  DS.LandingTask = LandingTask;

  // ---------------- سيناريو / درس / أسئلة ----------------
  // o: {steps:[step], setup, always, cleanup, quiz, score}
  // step: {hint, base, enter, exit, tick, cond, hold, limit, failMsg, guide, decide:{q,a,c,ex,lang}}
  class ScenarioTask extends Task {
    begin(ctx) {
      super.begin(ctx);
      this.st = { t: 0, k: 0, stepT: 0, held: 0, pen: 0, dec: [], map: [], data: {} };
      if (this.o.setup) this.o.setup(ctx, this.st, this);
      this.enter(ctx);
    }
    enter(ctx) {
      const s = this.o.steps[this.st.k];
      this.st.stepT = 0; this.st.held = 0;
      if (!s) return;
      if (s.enter) s.enter(ctx, this.st, this);
      if (s.decide) this.decision = Object.assign({ chosen: -1 }, s.decide);
    }
    next(ctx) {
      const s = this.o.steps[this.st.k];
      if (s && s.exit) s.exit(ctx, this.st, this);
      this.st.k++;
      if (this.st.k >= this.o.steps.length) { this.state = 'done'; return; }
      if (!s.decide) ctx.stepDone();
      this.enter(ctx);
    }
    answer(k) {
      const d = this.decision;
      if (!d || d.chosen >= 0) return;
      d.chosen = k; this.st.dec.push(k === d.c);
      if (k === d.c) DS.Audio.ok(); else DS.Audio.fail();
    }
    ack(ctx) { if (this.decision && this.decision.chosen >= 0) { this.decision = null; this.next(ctx); } }
    update(dt, ctx) {
      if (this.decision || this.state !== 'run') return;
      this.t += dt; this.st.t += dt; this.st.stepT += dt;
      const s = this.o.steps[this.st.k];
      if (!s) { this.state = 'done'; return; }
      if (this.o.always) { const r = this.o.always(ctx, this.st, dt, this); if (r && r.startsWith('fail:')) return this.fail(r.slice(5)); }
      let res = s.tick ? s.tick(ctx, this.st, dt, this) : null;
      if (!res && s.cond) {
        if (s.cond(ctx, this.st, this)) { this.st.held += dt; if (this.st.held >= (s.hold || 0)) res = 'next'; }
        else this.st.held = 0;
      }
      if (res === 'next') return this.next(ctx);
      if (res && res.startsWith('fail:')) return this.fail(res.slice(5));
      if (s.limit && this.st.stepT > s.limit) return this.fail(s.failMsg || 'خلص الوقت');
      const h = typeof s.hint === 'function' ? s.hint(ctx, this.st, this) : (s.hint || '');
      const b = s.base ? this.baseHint(ctx.drone) : null;
      this.hint = b || h;
      if (s.hold && s.cond && this.st.held > 0) this.hint += ' (' + Math.ceil(s.hold - this.st.held) + ')';
      this.progress = (this.st.k + (s.hold ? Math.min(1, this.st.held / s.hold) : 0)) / this.o.steps.length;
      if (this.t > this.tl) this.fail('خلص الوقت');
    }
    score() {
      if (this.state !== 'done') return 0;
      if (this.o.score) return this.o.score(this.st, this);
      const dec = this.st.dec, exec = U.clamp(100 - this.st.pen, 0, 100);
      if (!dec.length) return Math.round(exec);
      const dp = 100 * dec.filter(Boolean).length / dec.length;
      return Math.round(this.o.quiz ? dp : 0.5 * dp + 0.5 * exec);
    }
    feedback() { return (this.st && this.st.tips) || []; }
    guide(ctx) {
      if (this.decision) return { decide: this.decision };
      const s = this.o.steps[this.st.k];
      return s && s.guide ? s.guide(ctx, this.st, this) : null;
    }
    map() { return this.st ? this.st.map : []; }
    end(ctx) { if (this.o.cleanup) this.o.cleanup(ctx, this.st, this); super.end(ctx); }
  }
  DS.ScenarioTask = ScenarioTask;

  // ---------------- خطوات جاهزة للسيناريوهات ----------------
  const removeMap = (st, item) => { const i = st.map.indexOf(item); if (i >= 0) st.map.splice(i, 1); };
  DS.SC = {
    // روح لعلامة
    flyTo(o) {
      const r = o.r || 3, tol = o.altTol || 3;
      return {
        base: true, limit: o.limit, failMsg: o.failMsg,
        enter(ctx, st, task) {
          st.fh = ctx.R.add(task, { type: 'beacon', x: o.x, z: o.z, alt: o.alt, r, label: o.label || '' });
          st.fh.set('next');
          st.map.push(st.fm = { kind: 'beacon', x: o.x, z: o.z, r, label: o.label || '', state: 'next' });
        },
        exit(ctx, st) { st.fh.remove(); removeMap(st, st.fm); },
        cond(ctx) { const d = ctx.drone; return !d.onGround && U.dist2(d.p.x, d.p.z, o.x, o.z) <= r && Math.abs(d.p.y - o.alt) <= tol; },
        hint: o.hint || (ctx => { const d = ctx.drone; return goHint(d, o.x, o.z, 'روح للعلامة ' + (o.label || '')) + altAdvice(d.p.y, o.alt, tol); }),
        guide: () => ({ x: o.x, z: o.z, alt: o.alt, speed: o.speed || 5 })
      };
    },
    // اهبط على منصة
    land(o) {
      return {
        limit: o.limit, failMsg: o.failMsg,
        enter(ctx, st, task) {
          st.lc = new LandCheck(o.x, o.z, o.r, o.maxVs || 1.2);
          if (!o.home) st.ph = ctx.R.add(task, { type: 'pad', x: o.x, z: o.z, r: o.r, label: o.label || '' });
          st.map.push(st.lm = { kind: 'pad', x: o.x, z: o.z, r: o.r, label: o.label || 'H', state: 'next' });
        },
        exit(ctx, st) { if (st.ph) st.ph.remove(); st.ph = null; removeMap(st, st.lm); },
        tick(ctx, st) {
          if (st.lc.update(ctx.drone) !== 'done') return null;
          st.landScore = st.lc.score();
          st.pen += (100 - st.landScore) * (o.weight || 1);
          if (st.lc.td.dist > o.r * 3 && !o.anywhere) return 'fail:هبطت بعيد عن المنصة';
          return 'next';
        },
        hint: o.hint || ((ctx, st) => st.lc ? st.lc.hint(ctx.drone, o.label || 'H') : ''),
        guide: (ctx, st) => st.lc.guide(ctx.drone)
      };
    },
    // سؤال وش تسوي؟
    decide(q, a, c, ex, lang) { return { decide: { q, a, c, ex, lang: lang || 'ar' } }; },
    // شرط لازم يتحقق (اختياري يستمر hold ثواني)
    cond(fn, hint, extra) { return Object.assign({ cond: fn, hint }, extra || {}); },
    wait(sec, hint, guide) { return { cond: () => true, hold: sec, hint, guide }; }
  };

  // =====================================================================================
  // v2: مهام احترافية (التقييم من scoring.js — يتحمل بعد هالملف، فنستخدمه وقت التشغيل بس)
  // كل مهمة: guide() للطيار الآلي، map() للخريطة، reticle للـ HUD، والأخطاء توصل لـ ctx.faults
  // =====================================================================================
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const SCO = () => DS.Score;
  const PR = { x: 0, y: 0, depth: 0, dist: 0, ok: false, inFrame: false };   // إسقاط مؤقت (بدون إنشاء)
  const PR2 = { x: 0, y: 0, depth: 0, dist: 0, ok: false, inFrame: false };
  const mmss = t => (U.mmss ? U.mmss(t) : Math.round(t) + ' ث');
  const sec1 = t => (Math.round(t * 10) / 10).toFixed(1) + ' ث';
  // مسافة نقطة عن قطعة مستقيمة (أفقي)
  const segDist = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
    let t = l > 0 ? ((px - ax) * dx + (pz - az) * dz) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(ax + dx * t - px, az + dz * t - pz);
  };
  // معدل لف الكاميرا (درجة/ث) — اللف + الجيمبل، منعّم
  class TurnMeter {
    constructor() { this.y = null; this.g = 0; this.v = 0; }
    update(dt, yaw, gim) {
      if (this.y == null || dt <= 0) { this.y = yaw; this.g = gim; return this.v; }
      const r = Math.hypot(U.wrap(yaw - this.y) * R2D, gim - this.g) / dt;
      this.y = yaw; this.g = gim;
      this.v += (r - this.v) * Math.min(1, dt / 0.2);
      return this.v;
    }
  }
  // طريق: نص ('loop') أو كائن {pts, closed}
  const getRoad = r => {
    const W = DS.World || {};
    if (!r || typeof r === 'string') return (W.roads || []).find(x => x.id === (r || 'loop')) || (W.roads || [])[0];
    if (!r.cum) {   // نحسب الأطوال مرة وحدة
      const p = r.pts, cum = [0];
      for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
      r.cum = cum; r.len = cum[cum.length - 1] + (r.closed ? Math.hypot(p[0].x - p[p.length - 1].x, p[0].z - p[p.length - 1].z) : 0);
    }
    return r;
  };
  // جدول سرعة: رقم، [v0, v1] (يتدرج خلال ramp ث)، أو [[t, v], ...]
  const speedAt = (sp, t, ramp) => {
    if (typeof sp === 'number') return sp;
    if (!Array.isArray(sp) || !sp.length) return 0;
    if (typeof sp[0] === 'number') return sp.length < 2 ? sp[0] : U.lerp(sp[0], sp[1], U.clamp(t / (ramp || 30), 0, 1));
    let v = sp[0][1];
    for (const [tt, vv] of sp) if (t >= tt) v = vv;
    return v;
  };
  // سيارة/شاحنة تمشي على الطريق: pos, yaw, v, vel{x,z}
  class Mover {
    constructor(o, ctx, task) {
      this.o = o; this.road = o.static ? null : getRoad(o.road);
      this.dir = o.dir < 0 ? -1 : 1; this.s = o.s0 != null ? o.s0 : 0; this.v = 0; this.t = 0; this.on = false;
      this.p = { x: o.x || 0, z: o.z || 0, yaw: o.yaw || 0 }; this.vel = { x: 0, z: 0 }; this.yawRate = 0;
      this._rp = { x: 0, z: 0, yaw: 0 };
      this.place();
      const V = o.vehicle || {};
      this.vis = ctx.R.add(task, { type: 'vehicle', x: this.p.x, z: this.p.z, yaw: this.p.yaw, kind: V.kind || 'car', color: V.color != null ? V.color : 0xe5e7eb });
    }
    place() {
      if (!this.road) return;
      DS.roadPoint(this.road, this.s, this._rp);
      this.p.x = this._rp.x; this.p.z = this._rp.z; this.p.yaw = this.dir > 0 ? this._rp.yaw : U.wrap(this._rp.yaw + Math.PI);
    }
    update(dt) {
      const o = this.o;
      if (this.on && this.road) {
        this.t += dt;
        const tgt = speedAt(o.speed != null ? o.speed : 6, this.t, o.ramp), a = o.accel || 1.5;
        this.v = U.approach(this.v, tgt, a * dt);
        const y0 = this.p.yaw;
        this.s += this.dir * this.v * dt;
        this.place();
        this.yawRate = dt > 0 ? U.wrap(this.p.yaw - y0) / dt : 0;
      } else this.yawRate = 0;
      const sp = this.on ? this.v : 0;
      this.vel.x = Math.sin(this.p.yaw) * sp; this.vel.z = -Math.cos(this.p.yaw) * sp;
      this.vis.move(this.p.x, 0, this.p.z, this.p.yaw);
    }
  }

  // ---------------- 1) التصوير الدقيق — مسار NIST (السطول) ----------------
  // o: {stands:[{id,x,z,h,aYaw}], pad:{x,z,r,R}, steps:[step], points:'bperp'|'l2', retry:true, timeoutDone:true, lit, labels:false, minPx:20, timeLimit:600}
  // step: {x,z,alt, yaw?, caps:['1','2A','L'], rotate?:±deg (− يسار)، around?:{x,z}، land?:{pts}، hint?, say?}
  class CaptureTask extends Task {
    constructor(o) { super(Object.assign({ title: 'التصوير الدقيق (NIST)', short: 'NIST', timeLimit: 600 }, o)); }
    begin(ctx) {
      super.begin(ctx); this.initFaults(ctx); this.st = { k: 0 };
      const o = this.o, lane = DS.World && DS.World.lanes && DS.World.lanes.nist;
      const def = lane ? lane.stands.slice(0, 3) : [{ id: 1, x: 0, z: -3, h: 1 }, { id: 2, x: 0, z: -6, h: 1 }, { id: 3, x: 0, z: -9, h: 1 }];
      this.stands = (o.stands || def).map(s => ({ id: s.id, x: s.x, z: s.z, h: s.h != null ? s.h : 1, aYaw: s.aYaw != null ? s.aYaw : (lane ? lane.aYaw : Math.PI) }));
      this.pad = Object.assign({ x: 0, z: 0, r: 0.3, R: 0.6 }, (lane && lane.pad) || {}, o.pad || {});
      this.l2 = o.points === 'l2'; this.retry = o.retry !== false;
      this.vis = {}; this.poses = {};
      for (const st of this.stands) {
        this.vis[st.id] = ctx.R.add(this, { type: 'bucketStand', x: st.x, z: st.z, h: st.h, aYaw: st.aYaw, label: o.labels ? String(st.id) : '', lit: !!o.lit });   // الأرقام تغطي السطول في الكاميرا → اختيارية
        ctx.env.taskColliders.push({ type: 'cyl', x: st.x, z: st.z, r: 0.32, y0: 0, h: st.h + 0.26, name: 'ستاند السطول' });
        for (const dir of ['top', 'A', 'B', 'C', 'D']) this.poses[st.id + (dir === 'top' ? '' : dir)] = DS.bucketPose(st, dir);
      }
      const P = this.pad;
      this.poses.L = { x: P.x, y: 0.02, z: P.z, ax: 0, ay: 1, az: 0 };
      if (!DS.HOME || Math.hypot(P.x - DS.HOME.x, P.z - DS.HOME.z) > 0.5) ctx.R.add(this, { type: 'pad', x: P.x, z: P.z, r: P.R, label: 'L' });
      this.steps = o.steps || [];
      this.maxPts = 0;
      for (const s of this.steps) this.maxPts += s.land ? (s.land.pts || 1) : (s.caps || []).length * (this.l2 ? 5 : 1);
      this.maxPts = Math.max(1, this.maxPts);
      this.k = 0; this.points = 0; this.log = []; this.al = null; this.flashT = -9; this.flashTxt = '';
      this._g = { x: 0, z: 0, alt: 0, yaw: null, speed: 1.5, gimbal: null, shutter: false };
      this._mapPad = { kind: 'pad', x: P.x, z: P.z, r: P.R, label: 'L', state: 'idle' };
      this._mapTgt = { kind: 'zone', x: 0, z: 0, r: 0.8, state: 'next' };
      this._map = this.stands.map(s => ({ kind: 'beacon', x: s.x, z: s.z, label: String(s.id), state: 'idle' })).concat([this._mapPad, this._mapTgt]);
      this.reticle = null; this._ret = { deg: 3, label: '', ok: false };
      this.enterStep(ctx);
    }
    cur() { return this.steps[Math.min(this.k, this.steps.length - 1)]; }
    _visAll(state) { for (const id in this.vis) this.vis[id].set(state); }
    _visCap(id, state) {
      if (id === 'L') return;
      const m = /^(\d+)([ABCD]?)$/.exec(id); if (!m) return;
      const v = this.vis[m[1]]; if (v) v.set(state, m[2] || 'top');
    }
    enterStep(ctx) {
      const s = this.cur();
      if (!s) return;
      this.slots = (s.caps || []).map(id => ({ id, pose: this.poses[id], best: 0, tries: 0, done: !this.poses[id] }));
      this.rotAcc = 0; this.prevYaw = null; this.rotDone = !s.rotate;
      this.lc = s.land ? new LandCheck(this.pad.x, this.pad.z, this.pad.R, 1.0) : null;
      this._visAll('idle');
      this.slots.forEach(sl => this._visCap(sl.id, 'next'));
      this._mapTgt.x = s.x; this._mapTgt.z = s.z;
      if (s.say && ctx.say) ctx.say(s.say);
    }
    _alignOpts() { return this._ao || (this._ao = { minPx: this.o.minPx != null ? this.o.minPx : 20 }); }
    _slotPts(al) { return this.l2 ? al.pts5 : (al.full ? 1 : 0); }
    finishStep(ctx) {
      const s = this.cur();
      let got = 0;
      if (s.land) got = this.landPts || 0;
      else for (const sl of this.slots) { got += sl.best; this._visCap(sl.id, sl.best >= (this.l2 ? 5 : 1) ? 'done' : 'fail'); if (!sl.best) this.missed = (this.missed || 0) + 1; }   // الصورة الفايتة = نقاط ناقصة بس (مو خطأ GVC)
      this.points += got;
      this.log.push({ step: this.k + 1, pts: got, t: Math.round(this.t) });
      this.k++;
      if (this.k >= this.steps.length) { this.state = 'done'; return; }
      ctx.stepDone();
      this.enterStep(ctx);
    }
    flash(t) { this.flashTxt = t; this.flashT = this.t; }
    update(dt, ctx) {
      const d = ctx.drone, s = this.cur();
      this.t += dt;
      if (!s) { this.state = 'done'; return; }
      let nd = 0; for (let i = 0; i < this.slots.length; i++) if (this.slots[i].done) nd++;
      this.progress = (this.k + (this.slots.length ? nd / this.slots.length : 0)) / Math.max(1, this.steps.length);
      if (s.land) {
        const r = this.lc.update(d);
        this.hint = this.lc.hint(d, 'L');
        this.reticle = null;
        if (r === 'done') {
          const td = this.lc.td, full = s.land.pts || 1;
          this.landPts = td.dist <= this.pad.r + 0.15 ? full : td.dist <= this.pad.R ? Math.ceil(full / 2) : 0;
          this.flash('هبوط: ' + this.landPts + '/' + full);
          this.finishStep(ctx);
          return;
        }
      } else {
        const eh = U.dist2(d.p.x, d.p.z, s.x, s.z), ev = Math.abs(d.p.y - s.alt);
        const inPos = !d.onGround && eh < 1.0 && ev < 0.8;
        if (!this.rotDone && inPos) {
          if (this.prevYaw != null) this.rotAcc += U.wrap(d.yaw - this.prevYaw);
          if (Math.sign(s.rotate) * this.rotAcc * R2D >= Math.abs(s.rotate) - 25) { this.rotDone = true; this.flash('✓ اللفة تمت — الحين صوّر'); }
        }
        this.prevYaw = d.yaw;
        // المؤشر: أول سطل باقي
        const sl = this.slots.find(x => !x.done);
        if (sl) {
          this.al = SCO().bucketAlign(ctx.camera(), sl.pose, this._alignOpts(), this.al);
          this._ret.label = sl.id; this._ret.ok = this.al.full; this.reticle = this._ret;
        } else this.reticle = null;
        const b = this.baseHint(d);
        let h;
        if (b) h = b;
        else if (this.t - this.flashT < 2.5) h = this.flashTxt;
        else if (!inPos) h = goHint(d, s.x, s.z, s.hint || 'روح للمكان المحدد') + altAdvice(d.p.y, s.alt, 0.8);
        else if (!this.rotDone) h = 'لف الدرون لفة كاملة ' + (s.rotate < 0 ? 'لليسار' : 'لليمين') + ' وهو ثابت فوق الستاند (' + Math.round(Math.abs(this.rotAcc) * R2D) + '°)';
        else if (sl) {
          const al = this.al;
          h = !al.inFrame ? 'وجّه الكاميرا على السطل ' + sl.id + (sl.id.length === 1 || sl.id === 'L' ? ' (الكاميرا لتحت: LT)' : ' (الجيمبل LT/RT + لف الدرون)')
            : al.px < 20 ? 'السطل بعيد/صغير — قرّب شوي'
              : al.full ? 'الحلقة كاملة ✓ صوّر الحين (RB)' : 'الحلقة مو كاملة — عدّل مكانك وارتفاعك لين تشوفها كاملة';
          if (this.retry) h += ' • ▶ = تخطي';
        } else h = 'تمام ✓';
        this.hint = (this.k + 1) + '/' + this.steps.length + ' • ' + h;
      }
      if (this.t > this.tl) { if (this.o.timeoutDone !== false && this.points > 0) { this.state = 'done'; this.timedOut = true; } else this.fail('خلص الوقت'); }
    }
    onShutter(ctx) {
      const s = this.cur();
      if (!s || s.land || this.state !== 'run') return;
      if (!this.rotDone) { this.flash('كمّل اللفة قبل لا تصوّر'); return; }
      const cam = ctx.camera(), mx = this.l2 ? 5 : 1;
      let any = false, txt = '';
      for (const sl of this.slots) {
        if (sl.done) continue;
        const al = SCO().bucketAlign(cam, sl.pose, this._alignOpts(), this._al2 || (this._al2 = {}));
        if (!al.ok) continue;
        any = true; sl.tries++;
        const p = this._slotPts(al);
        if (p > sl.best) sl.best = p;
        if (p >= mx || !this.retry) { sl.done = true; this._visCap(sl.id, p >= mx ? 'done' : 'fail'); }
        txt += (txt ? ' • ' : '') + sl.id + (al.full ? ' ✓ كاملة' : al.part ? ' — نص الحلقة' : ' ✗');
      }
      this.flash(any ? '📸 ' + txt : '📸 ما فيه سطل واضح في الصورة');
      if (this.slots.every(x => x.done)) this.finishStep(ctx);
    }
    onCallout(ctx) { const s = this.cur(); if (s && !s.land && this.state === 'run') { this.flash('تخطيت الخطوة'); this.finishStep(ctx); } }
    score() { return this.state === 'done' ? U.clamp(Math.round(100 * this.points / this.maxPts) - this.penaltyNoMiss(), 0, 100) : 0; }
    penaltyNoMiss() { return 0; }   // الصور الفايتة تنقص النقاط أصلاً
    feedback() {
      const t = [];
      t.push('النقاط: ' + this.points + '/' + this.maxPts + ' في ' + mmss(this.t) + (this.timedOut ? ' (خلص الوقت)' : ''));
      if (this.points < this.maxPts * 0.8) t.push('ثبّت فوق الستاند بالضبط قبل التصوير، والحلقة لازم تبان كاملة');
      return t;
    }
    get result() { return this.stats(); }
    stats() { return { points: this.points, max: this.maxPts, time: Math.round(this.t), missed: this.missed || 0, timedOut: !!this.timedOut }; }
    guide(ctx) {
      const d = ctx.drone, s = this.cur(), g = this._g;
      if (!s) return null;
      if (s.land) return this.lc.guide(d);
      g.shutter = false; g.gimbal = null; g.yaw = s.yaw != null ? s.yaw : null; g.speed = 1.5;
      g.x = s.x; g.z = s.z; g.alt = s.alt;
      const sl = this.slots.find(x => !x.done);
      const aimSlot = () => {
        if (!sl) return;
        const P = sl.pose, cam = ctx.camera(), dx = P.x - cam.pos.x, dz = P.z - cam.pos.z, dh = Math.hypot(dx, dz);
        if (P.ay < 0.9 && dh > 0.5) g.yaw = Math.atan2(dx, -dz);
        g.gimbal = Math.atan2(P.y - cam.pos.y, Math.max(dh, 1e-3)) * R2D;
      };
      if (d.onGround && !d.motors) return g;
      const eh = U.dist2(d.p.x, d.p.z, s.x, s.z), ev = Math.abs(d.p.y - s.alt), vh = Math.hypot(d.v.x, d.v.z);
      if (eh > 0.35 || ev > 0.35) {
        if (s.around && eh > 1.2) {   // مسار دائري حول الستاند (Orbit)
          const C = s.around, R = Math.max(1.5, U.dist2(s.x, s.z, C.x, C.z)), a0 = U.bearing(C.x, C.z, d.p.x, d.p.z), a1 = U.bearing(C.x, C.z, s.x, s.z);
          const da = U.wrap(a1 - a0);
          if (Math.abs(da) > 0.3) { const a = a0 + U.clamp(da, -0.5, 0.5); g.x = C.x + Math.sin(a) * R; g.z = C.z - Math.cos(a) * R; g.yaw = U.bearing(d.p.x, d.p.z, C.x, C.z); }
        }
        aimSlot();
        return g;
      }
      if (!this.rotDone) { g.yaw = d.yaw + Math.sign(s.rotate) * 0.9; g.gimbal = -30; return g; }
      aimSlot();
      if (sl) {
        const al = SCO().bucketAlign(ctx.camera(), sl.pose, this._alignOpts(), this._al3 || (this._al3 = {}));
        const gE = Math.abs((g.gimbal != null ? U.clamp(g.gimbal, -90, 60) : ctx.session.gimbal) - ctx.session.gimbal);
        const yE = g.yaw != null ? Math.abs(U.wrap(g.yaw - d.yaw)) * R2D : 0;
        g.shutter = al.full && vh < 0.25 && gE < 2 && yE < 4;
      }
      return g;
    }
    map() { this._mapTgt.state = this.cur() && this.cur().land ? 'idle' : 'next'; this._mapPad.state = this.cur() && this.cur().land ? 'next' : 'idle'; return this._map; }
  }
  DS.CaptureTask = CaptureTask;

  // NIST BPERP جاهز: DS.NIST.bperp({part:'all'|'position'|'traverseL'|'traverseR', S:3, lane}) → مواصفات CaptureTask
  DS.NIST = {
    lane() {
      const L = DS.World && DS.World.lanes && DS.World.lanes.nist;
      return { stands: (L ? L.stands.slice(0, 3) : [{ id: 1, x: 0, z: -3, h: 1 }, { id: 2, x: 0, z: -6, h: 1 }, { id: 3, x: 0, z: -9, h: 1 }]), pad: L ? L.pad : { x: 0, z: 0 }, aYaw: L ? L.aYaw : Math.PI };
    },
    steps(part, opts) {
      opts = opts || {};
      const ln = opts.lane || DS.NIST.lane(), S = opts.S || 3, st = ln.stands, pad = ln.pad, H = st[0].h != null ? st[0].h : 1;
      const A1 = H + S, A2 = H + 2 * S, N = 0, SO = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;
      const at = (k, alt, yaw, caps, extra) => Object.assign({ x: st[k - 1].x, z: st[k - 1].z, alt, yaw, caps }, extra || {});
      const off = (k, dx, dz, yaw, caps, extra) => Object.assign({ x: st[k - 1].x + dx * S, z: st[k - 1].z + dz * S, alt: A1, yaw, caps }, extra || {});
      const P = (yaw, caps, extra) => Object.assign({ x: pad.x, z: pad.z, alt: A1, yaw, caps }, extra || {});
      const around = k => ({ x: st[k - 1].x, z: st[k - 1].z });
      const out = [];
      if (part === 'all' || part === 'position') {
        out.push(
          at(1, A1, N, ['1', '2A'], { hint: 'روح فوق الستاند 1', say: 'اثبت فوق الستاند الأول وصوّر السطل اللي تحتك والسطل 2A قدامك' }),
          at(1, A1, N, ['1', '2A'], { rotate: -360, hint: 'لف 360 لليسار فوق الستاند 1' }),
          at(1, A1, N, ['1', '2A'], { rotate: 360, hint: 'لف 360 لليمين فوق الستاند 1' }),
          at(1, A2, N, ['1', '3A'], { hint: 'اطلع لضعف الارتفاع فوق الستاند 1' }),
          at(1, A1, N, ['1', '2A'], { hint: 'انزل للارتفاع الأول فوق الستاند 1' }),
          at(2, A1, N, ['2', '3A'], { hint: 'قدّم (' + PIT() + ' لقدام) للستاند 2' }),
          at(1, A1, N, ['1', '2A'], { hint: 'ارجع لورا للستاند 1' }),
          at(2, A1, SO, ['2', '1C'], { rotate: -180, hint: 'قدّم للستاند 2 ولف 180 لليسار' }),
          P(N, ['L', '1A'], { rotate: 180, hint: 'روح فوق منصة الهبوط ولف 180 لليمين' }),
          { x: pad.x, z: pad.z, alt: 0, land: { pts: 2 }, hint: 'اهبط في الدائرة' });
      }
      const trav = (sgn) => {   // sgn = 1 يسار، -1 يمين
        const L = sgn > 0;
        out.push(
          P(N, ['1A'], { hint: 'أقلع واثبت فوق المنصة', say: L ? 'الحين نلف على الستاندات من اليسار' : 'الحين نلف على الستاندات من اليمين' }),
          off(1, L ? -1 : 1, 0, L ? E : W, [L ? '1B' : '1D'], { around: around(1), hint: 'لف 90° ' + (L ? 'لليسار' : 'لليمين') + ' حول الستاند 1' }),
          off(2, L ? -1 : 1, 0, L ? E : W, [L ? '2B' : '2D'], { hint: 'تزحلق ' + (L ? 'لليسار' : 'لليمين') + ' (العصا اليمين جنب) للستاند 2' }),
          off(3, L ? -1 : 1, 0, L ? E : W, [L ? '3B' : '3D'], { hint: 'كمّل للستاند 3' }),
          off(3, 0, -1, SO, ['3C'], { around: around(3), hint: 'لف 90° حول الستاند 3' }),
          off(3, L ? 1 : -1, 0, L ? W : E, [L ? '3D' : '3B'], { around: around(3), hint: 'كمّل اللف حول الستاند 3' }),
          off(2, L ? 1 : -1, 0, L ? W : E, [L ? '2D' : '2B'], { hint: 'تزحلق للستاند 2' }),
          off(1, L ? 1 : -1, 0, L ? W : E, [L ? '1D' : '1B'], { hint: 'تزحلق للستاند 1' }),
          P(N, ['1A'], { around: around(1), hint: 'لف 90° وارجع فوق المنصة' }),
          { x: pad.x, z: pad.z, alt: 0, land: { pts: 1 }, hint: 'اهبط' });
      };
      if (part === 'all' || part === 'traverseL') trav(1);
      if (part === 'all' || part === 'traverseR') trav(-1);
      return out;
    },
    bperp(opts) {
      opts = opts || {};
      const ln = opts.lane || DS.NIST.lane();
      return Object.assign({ title: 'اختبار NIST (السطول)', short: 'NIST', stands: ln.stands, pad: ln.pad, timeLimit: 600, retry: true },
        opts, { steps: DS.NIST.steps(opts.part || 'all', Object.assign({ lane: ln }, opts)) });
    }
  };

  // ---------------- 2) سباق ضد الوقت (بوابات) ----------------
  // o: {gates:[{x,z,y?,yaw,w?,h?,label?}], laps:1, loop:true, missPenalty:2, par (ث للفة — زمن المدرب)، speed (للطيار الآلي)، timeLimit}
  class TimeTrialTask extends Task {
    constructor(o) { super(Object.assign({ title: 'سباق ضد الوقت', short: 'السباق', timeLimit: 120 + 60 * ((o && o.laps) || 1) }, o)); }
    begin(ctx) {
      super.begin(ctx); this.initFaults(ctx);
      const o = this.o, fpv = ctx.drone.profile.kind === 'fpv';
      this.fpv = fpv;
      this.G = (o.gates || []).map((g, k) => {
        const F = DS.gateFrame(g), yaw = g.yaw || 0, n = U.fwd(yaw), r = U.right(yaw);
        DS.gateColliders(g, 'بوابة ' + (k + 1)).forEach(c => { c.thin = true; ctx.env.taskColliders.push(c); });   // thin: حساسات DJI ما تفرمل عند البوابة
        const vis = ctx.R.add(this, { type: 'raceGate', x: g.x, y: g.y, z: g.z, yaw, w: F.w, h: F.h, label: g.label != null ? g.label : k + 1, color: g.color });
        return { x: g.x, z: g.z, yaw, w: F.w, h: F.h, cy: F.cy, nx: n.x, nz: n.z, rx: r.x, rz: r.z, pa: null, vis,
          m: { kind: 'gate', x: g.x, z: g.z, yaw, w: F.w, label: k + 1, state: 'idle' } };
      });
      this.N = this.G.length;
      this.loop = o.loop !== false && this.N > 0;
      this.laps = this.loop ? Math.max(1, o.laps || 1) : 1;
      this.exp = 0; this.running = false; this.lap = 0; this.lapStart = 0; this.startT = 0; this.lapTimes = [];
      this.penT = 0; this.missed = 0; this.passT = -10; this.lastG = -1; this.total = null; this.bestLap = null; this.bestTime = null;
      this.px = ctx.drone.p.x; this.py = ctx.drone.p.y; this.pz = ctx.drone.p.z;
      this.dE = fpv ? 5 : 4; this.dX = 3;
      this.rec = SCO() ? new (SCO().Recorder)(20, 2400) : null; this.ghost = null; this.lapMark = 0;
      this.race = { running: false, t: 0, lap: 0, laps: this.laps, gate: 1, gates: this.N, last: null, best: null, penalty: 0 };
      // طول المسار (للزمن المتوقع)
      let L = 0;
      for (let i = 0; i < this.N; i++) { const a = this.G[i], b = this.G[(i + 1) % this.N]; if (i + 1 < this.N || this.loop) L += Math.hypot(b.x - a.x, b.z - a.z, b.cy - a.cy); }
      this.pathLen = L;
      this.par = o.par || Math.max(3, L / (fpv ? 8.5 : 7.5) + (fpv ? 0.25 : 0.4) * this.N);   // زمن المدرب التقريبي للفة (الأفضل المحتوى يحدده من وقت الطيار الآلي)
      this._map = this.G.map(g => g.m);
      this.passed = new Uint8Array(this.N);
      this._ch = new Float64Array(30); this._pl = new Float64Array(36); this._pln = 0; this._plFor = -1; this._plLap = 0; this._seg = 1; this._cIdx = 1;
      this._g = { vff: { x: 0, z: 0 }, alt: 1, yaw: 0, speed: 0 };
      this._setVis();
    }
    _setVis() { for (let i = 0; i < this.N; i++) { const g = this.G[i], st = i === this.exp ? 'next' : this.passed[i] ? 'done' : 'idle'; g.vis.set(st); g.m.state = st; } }
    update(dt, ctx) {
      const d = ctx.drone, p = d.p;
      const t0 = this.t; this.t += dt;
      // قطع مستوى البوابة (مع الاستيفاء بين الخطوتين)
      for (let i = 0; i < this.N; i++) {
        const g = this.G[i], a = (p.x - g.x) * g.nx + (p.z - g.z) * g.nz;
        if (g.pa != null && (g.pa < 0) !== (a < 0)) {
          const f = g.pa / (g.pa - a), cx = this.px + (p.x - this.px) * f, cy = this.py + (p.y - this.py) * f, cz = this.pz + (p.z - this.pz) * f;
          const lat = (cx - g.x) * g.rx + (cz - g.z) * g.rz, ver = cy - g.cy;
          const inside = Math.abs(lat) <= g.w / 2 - 0.06 && Math.abs(ver) <= g.h / 2 - 0.06;
          if (inside) {
            if (g.pa < 0) this.onGate(i, t0 + dt * f, ctx);
            else if (this.running) { this.fault('minor', 'gateWrong'); this.flash = 'دخلت البوابة ' + (i + 1) + ' بالعكس!'; this.flashT = this.t; }
          }
        }
        g.pa = a;
      }
      this.px = p.x; this.py = p.y; this.pz = p.z;
      if (this.state !== 'run') return;
      if (this.rec && this.running) this.rec.update(dt, d, 0, null, null);
      const R = this.race;
      R.running = this.running; R.t = this.running ? this.t - this.startT + this.penT : 0; R.lap = this.lap; R.gate = this.exp + 1;
      R.last = this.lapTimes.length ? this.lapTimes[this.lapTimes.length - 1] : null; R.best = this.bestLap; R.penalty = this.penT;
      this.progress = this.running ? ((this.lap - 1) + (this.exp === 0 && this.loop ? (this.N > 1 ? (this.N - 1) / this.N : 0) : this.exp / this.N)) / this.laps : 0;
      const b = this.baseHint(d);
      if (b) this.hint = b;
      else if (this.flash && this.t - this.flashT < 2.5) this.hint = this.flash;
      else if (!this.running) this.hint = 'ادخل من البوابة 1 عشان يبدأ الوقت ⏱️';
      else this.hint = '⏱️ ' + sec1(R.t) + ' • البوابة ' + (this.exp + 1) + '/' + this.N + (this.laps > 1 ? ' • اللفة ' + this.lap + (this.laps < 100 ? '/' + this.laps : '') : '') + (this.bestLap ? ' • أفضل لفة ' + sec1(this.bestLap) : '');
      if (this.t > this.tl) this.fail('خلص الوقت');
    }
    onGate(i, tc, ctx) {
      if (!this.running) {
        if (i !== 0) return;
        this.running = true; this.lap = 1; this.lapStart = tc; this.startT = tc; this.exp = this.N > 1 ? 1 : 0; this.passed.fill(0); this.passed[0] = 1;
        if (this.rec) { this.rec.reset(); this.lapMark = 0; }
        if (ctx.say) ctx.say('انطلق! ⏱️');
        if (!this.loop && this.N === 1) return this._finish(tc, ctx);
        this._setVis(); ctx.stepDone(); return;
      }
      if (i !== this.exp) {
        if (this.N > 2 && i === (this.exp + 1) % this.N) {   // فوّت البوابة المطلوبة
          this.missed++; this.penT += this.o.missPenalty != null ? this.o.missPenalty : 2;
          this.fault('minor', 'gateMiss'); this.flash = 'فوّت البوابة ' + (this.exp + 1) + ' (+' + (this.o.missPenalty != null ? this.o.missPenalty : 2) + ' ث)'; this.flashT = this.t;
          this.exp = i;
        } else return;
      }
      this.passT = this.t; this.lastG = i; this.passed[i] = 1;
      if (this.loop) {
        if (i === 0) {
          const lt = tc - this.lapStart;
          this.lapTimes.push(lt);
          if (this.bestLap == null || lt < this.bestLap) { this.bestLap = lt; if (this.rec) this.ghost = { hz: 20, data: this.rec.track(this.lapMark, this.rec.n) }; }
          if (this.rec) this.lapMark = this.rec.n;
          if (ctx.say) ctx.say('اللفة ' + this.lap + ': ' + sec1(lt));
          if (this.lap >= this.laps) return this._finish(tc, ctx);
          this.lap++; this.lapStart = tc; this.exp = this.N > 1 ? 1 : 0; this.passed.fill(0); this.passed[0] = 1;
        } else this.exp = (i + 1) % this.N;
      } else {
        if (i >= this.N - 1) return this._finish(tc, ctx);
        this.exp = i + 1;
      }
      this._setVis(); ctx.stepDone();
    }
    _finish(tc, ctx) {
      this.total = tc - this.startT + this.penT;
      if (!this.loop) { this.lapTimes.push(tc - this.startT); this.bestLap = tc - this.startT; if (this.rec) this.ghost = { hz: 20, data: this.rec.track(0, this.rec.n) }; }
      this.bestTime = this.o.timeMode === 'lap' ? this.bestLap : this.total;
      this.G.forEach(g => { g.vis.set('done'); g.m.state = 'done'; });
      if (ctx.say) ctx.say('خلصت! الوقت ' + sec1(this.total));
      this.state = 'done';
    }
    score() {
      if (this.state !== 'done' || this.total == null) return 0;
      const r = this.total / (this.par * this.laps);
      const sc = SCO().table(r, [[1.0, 100], [1.05, 90], [1.15, 80], [1.3, 70], [2.0, 40], [3.0, 0]]);
      return U.clamp(Math.round(sc - 15 * (this.fm ? this.fm.major : 0)), 0, 100);
    }
    feedback() {
      const t = [];
      if (this.total != null) t.push('وقتك ' + sec1(this.total) + ' (المدرب ' + sec1(this.par * this.laps) + ')' + (this.missed ? ' • فوّت ' + this.missed + ' بوابة' : ''));
      if (this.lapTimes.length > 1) {
        const m = this.lapTimes.reduce((a, b) => a + b, 0) / this.lapTimes.length, sd = Math.sqrt(this.lapTimes.reduce((a, b) => a + (b - m) * (b - m), 0) / this.lapTimes.length);
        if (sd / m > 0.03) t.push('أوقات اللفات متفاوتة — المحترف لفاته متقاربة (أقل من 3%)');
      }
      if (this.total != null && this.total > this.par * this.laps * 1.3) t.push('خط سيرك: ادخل البوابة وأنت مستقيم عليها، وابدأ اللفة للبوابة الجاية قبل لا توصلها');
      return t;
    }
    // الطيار الآلي: قمع دخول على خط البوابة (قريب ومتوازي) + مطاردة نقطة على مسار للمدخل (بعيد) + تخطيط السرعة قبل اللفات
    guide(ctx) {
      const d = ctx.drone, g = this._g, C = this._ch, o = this.o;
      if (!this.N) return null;
      const M = DS.MODES[d.effMode ? d.effMode() : d.mode] || {};
      const vmax = o.speed || (this.fpv ? 12 : Math.min(9, (M.maxH || 12) * 0.8)), vmin = this.fpv ? 3.5 : 2.5, aDec = this.fpv ? 7 : 3;
      const G = this.G[this.exp], v = Math.hypot(d.v.x, d.v.z);
      const dx = d.p.x - G.x, dz = d.p.z - G.z, along = dx * G.nx + dz * G.nz, lat = dx * G.rx + dz * G.rz;
      const dApp = U.clamp(v * 0.9, 6, 12);
      // اللفة بعد البوابة: الزاوية بين اتجاه البوابة واتجاه مدخل البوابة الجاية
      let vGate = vmax;
      const ni = this.loop ? (this.exp + 1) % this.N : this.exp + 1;
      if (ni < this.N && ni !== this.exp) {
        const H = this.G[ni], ex = H.x - H.nx * dApp - G.x, ez = H.z - H.nz * dApp - G.z, el = Math.hypot(ex, ez) || 1;
        const c = U.clamp((ex * G.nx + ez * G.nz) / el, -1, 1);
        vGate = vmin + (vmax - vmin) * Math.pow((1 + c) / 2, 0.8);
      }
      let tx, ty, tz, sp;
      if (d.onGround) { g.x = G.x - G.nx * dApp; g.z = G.z - G.nz * dApp; g.alt = Math.max(1.5, G.cy); g.vff.x = 0; g.vff.z = 0; g.yaw = G.yaw; return g; }
      g.x = undefined; g.z = undefined;
      const L0 = this.G[this.lastG];
      const exitA = L0 ? (d.p.x - L0.x) * L0.nx + (d.p.z - L0.z) * L0.nz : 99;
      if (L0 && this.t - this.passT < 1.2 && exitA < this.dX) {   // كمّل شوي بعد البوابة قبل لا تلف (عشان ما تلمس العمود)
        tx = L0.x + L0.nx * (exitA + 3); tz = L0.z + L0.nz * (exitA + 3); ty = L0.cy; sp = Math.max(vmin, Math.min(v, vmax));
      } else if (along > -dApp - 3 && along < 0.4 && Math.abs(lat) < Math.max(0.7, -along * 0.45)) {
        // القمع: احنا تقريباً على خط البوابة → نمشي عليه بدقة
        const Lp = U.clamp(-along * 0.5, 1.2, 6), vlat = d.v.x * G.rx + d.v.z * G.rz;
        tx = G.x + G.nx * (along + Lp) - G.rx * 0.35 * vlat; tz = G.z + G.nz * (along + Lp) - G.rz * 0.35 * vlat; ty = G.cy;   // تخميد الحركة الجانبية
        const mis = U.clamp(1 - (Math.abs(lat) - 0.2) / 1.2, 0.3, 1) * U.clamp(1 - (Math.abs(d.p.y - G.cy) - 0.2) / 1.2, 0.4, 1);
        sp = Math.max(vmin * 0.8, Math.min(vmax, Math.sqrt(vGate * vGate + 2 * aDec * Math.max(0, -along))) * mis);
      } else {
        // بعيد أو مو متوازي: مسار (الدرون ← لف من جنب البوابة لو احنا جنبها/وراها ← مدخل القمع ← النص)
        let n = 0;
        n = this._add(C, n, d.p.x, d.p.y, d.p.z);
        if (along > -1.5) {
          const sd = lat >= 0 ? 1 : -1, off = G.w / 2 + 3;
          if (Math.abs(lat) < off) n = this._add(C, n, G.x + G.rx * sd * off + G.nx * Math.max(along, 1.5), Math.max(G.cy, 1.5), G.z + G.rz * sd * off + G.nz * Math.max(along, 1.5));
          n = this._add(C, n, G.x + G.rx * sd * off * 0.6 - G.nx * dApp, G.cy, G.z + G.rz * sd * off * 0.6 - G.nz * dApp);
        }
        n = this._add(C, n, G.x - G.nx * dApp, G.cy, G.z - G.nz * dApp);
        n = this._add(C, n, G.x, G.cy, G.z);
        const look = U.clamp(0.45 * v + 3, 4, 9);
        let rem = look; tx = C[3]; ty = C[4]; tz = C[5];
        for (let i = 1; i < n; i++) {
          const ax = C[(i - 1) * 3], ay = C[(i - 1) * 3 + 1], az = C[(i - 1) * 3 + 2], bx = C[i * 3], by = C[i * 3 + 1], bz = C[i * 3 + 2];
          const l = Math.hypot(bx - ax, bz - az);
          if (l >= rem || i === n - 1) { const f = l > 1e-6 ? Math.min(1, rem / l) : 1; tx = ax + (bx - ax) * f; ty = ay + (by - ay) * f; tz = az + (bz - az) * f; break; }
          rem -= l;
        }
        // السرعة: نبطّي قبل مدخل القمع حسب زاوية اللفة هناك
        const Ex = G.x - G.nx * dApp, Ez = G.z - G.nz * dApp, el = Math.hypot(Ex - d.p.x, Ez - d.p.z) || 1;
        const c = U.clamp(((Ex - d.p.x) * G.nx + (Ez - d.p.z) * G.nz) / el, -1, 1);
        const vE = vmin + (vmax - vmin) * Math.pow((1 + c) / 2, 1.2);
        sp = Math.min(vmax, Math.sqrt(vE * vE + 2 * aDec * Math.max(0, el - 2)));
        if (el > 3) ty = Math.max(ty, Math.min(1.3, G.cy + 0.5));   // بعيد عن البوابة: لا تطير لاصق بالأرض
      }
      const ddx = tx - d.p.x, ddz = tz - d.p.z, dl = Math.hypot(ddx, ddz) || 1;
      g.vff.x = ddx / dl * sp; g.vff.z = ddz / dl * sp; g.alt = ty; g.yaw = Math.atan2(ddx, -ddz); g.speed = 0;
      return g;
    }
    stats() { return { total: this.total, laps: this.lapTimes.slice(), bestLap: this.bestLap, par: this.par, parTotal: this.par * this.laps, missed: this.missed, penalty: this.penT }; }
    _add(C, n, x, y, z) { C[n * 3] = x; C[n * 3 + 1] = y; C[n * 3 + 2] = z; return n + 1; }
    map() { return this._map; }
  }
  DS.TimeTrialTask = TimeTrialTask;

  // ---------------- 3) التفتيش / التصوير (علامات + مسافة أمان + منطقة ممنوعة) ----------------
  // o: {tags:[{x,y,z,label,yaw?,size?,textH?,defect?,from?:{x,y,z}}], structures:[{type:'cyl'|'box'|'wire'|'point'|'powerline',...}],
  //     standoff:[lo,hi]|null, viewDist, keepOut: r | {r, cls:'safety'|'major', every}, zoomPx:20, maxTurn:10, center:0.85,
  //     order:'seq'|'near', need, askDefects, report:[q], landHome, par, battMin:25, w:{tags,standoff,time,battery,smooth,report}, smoothRef}
  class InspectTask extends Task {
    constructor(o) { super(Object.assign({ title: 'التفتيش', short: 'التفتيش', timeLimit: 900 }, o)); }
    defaults() { return { standoff: [6.5, 9.5], keepOut: 5, w: { tags: 40, standoff: 25, time: 15, battery: 10, smooth: 10, report: 20 }, center: 0.85 }; }
    begin(ctx) {
      super.begin(ctx); this.initFaults(ctx); this.st = { k: 0 };
      const o = this.o, D = this.defaults();
      this.band = o.standoff !== undefined ? o.standoff : D.standoff;
      const ko = o.keepOut !== undefined ? o.keepOut : D.keepOut;
      this.ko = typeof ko === 'number' ? { r: ko, cls: 'safety', every: 0 } : Object.assign({ r: 0, cls: 'safety', every: 0 }, ko || {});
      this.W = Object.assign({}, D.w, o.w || {});
      this.center = o.center != null ? o.center : D.center;
      this.zoomPx = o.zoomPx != null ? o.zoomPx : 20; this.maxTurn = o.maxTurn != null ? o.maxTurn : 10;
      this.mid = this.band ? (this.band[0] + this.band[1]) / 2 : (o.viewDist || 8);
      this.half = this.band ? (this.band[1] - this.band[0]) / 2 : 0;
      this.S = (o.structures || []).map(s => Object.assign({}, s));
      this.S.forEach(s => {
        if (s.type === 'tower') {   // برج من العالم
          const T = (DS.World.towers || []).find(t => t.id === (s.id || 'telecom')) || (DS.World.towers || [])[0];
          if (T) Object.assign(s, { type: 'cyl', x: T.x, z: T.z, r: s.r || 2.5, y0: 0, h: T.h + 4 });
        }
        if (s.visual) ctx.R.add(this, s.visual);
        if (s.collider) ctx.env.taskColliders.push(Object.assign({ type: s.type, name: s.name || 'الهدف' }, s.collider === true ? s : s.collider));
      });
      this.cyl = this.S.find(s => s.type === 'cyl') || null;
      this.ctr = this.S.find(s => s.type === 'cyl' || s.type === 'point' || s.type === 'box') || null;
      this.tags = (o.tags || []).map((t, i) => {
        const size = t.size || 0.3, vis = ctx.R.add(this, Object.assign({ type: 'tag', x: t.x, y: t.y, z: t.z, label: t.label != null ? t.label : String(i + 1), size }, t.yaw != null ? { yaw: t.yaw } : {}));
        if (t.kind === 'insulator') ctx.R.add(this, { type: 'insulator', x: t.ix != null ? t.ix : t.x, y: t.iy != null ? t.iy : t.y, z: t.iz != null ? t.iz : t.z, defect: !!t.defect });
        return Object.assign({}, t, { i, size, textH: t.textH || size * 0.6, label: t.label != null ? String(t.label) : String(i + 1), got: false, vis, m: { kind: 'beacon', x: t.x, z: t.z, label: t.label != null ? String(t.label) : String(i + 1), state: 'idle' } });
      });
      this.need = o.need || this.tags.length;
      this.got = 0; this.phase = 'insp'; this.target = null; this.turn = new TurnMeter(); this.turnV = 0;
      this.kIn = false; this.kT = 0; this.sd = SCO() ? new (SCO().Stat)() : null; this.dist = 99;
      this.rec = SCO() ? new (SCO().Recorder)(25, 4000) : null; this.segs = [];
      this.flashT = -9; this.flashTxt = ''; this.reticle = null; this._ret = { deg: 4, label: '', ok: false };
      this._g = { x: 0, z: 0, alt: 0, yaw: null, aim: { x: 0, y: 0, z: 0 }, gimbal: null, zoom: 1, speed: 3, shutter: false };
      this._gd = { decide: null };
      this._map = this.tags.map(t => t.m);
      this.S.forEach(s => { if (s.type === 'cyl') this._map.push({ kind: 'tower', x: s.x, z: s.z, r: s.r }); });
      if (o.landHome) this._map.push({ kind: 'pad', x: DS.HOME.x, z: DS.HOME.z, r: 1.5, label: 'H', state: 'idle' });
      this.par = o.par || 40 + 25 * this.tags.length;
      this.pickTarget(ctx.drone);
    }
    // أقرب مسافة لسطح الهدف
    structDist(x, y, z) {
      let best = Infinity;
      for (const s of this.S) {
        let dd = Infinity;
        if (s.type === 'cyl') {
          const y0 = s.y0 || 0, dh = Math.max(0, Math.hypot(x - s.x, z - s.z) - s.r), dv = y < y0 ? y0 - y : y > s.h ? y - s.h : 0;
          dd = Math.hypot(dh, dv);
        } else if (s.type === 'point') dd = Math.hypot(x - s.x, y - (s.y || 0), z - s.z);
        else if (s.type === 'box') {
          const ex = Math.max(0, Math.abs(x - s.x) - s.w / 2), ez = Math.max(0, Math.abs(z - s.z) - s.d / 2), y0 = s.y0 || 0, ey = y < y0 ? y0 - y : y > s.h ? y - s.h : 0;
          dd = Math.hypot(ex, ey, ez);
        } else if (s.type === 'wire') {
          const y1 = s.y1 != null ? s.y1 : s.y, y2 = s.y2 != null ? s.y2 : s.y, ax = s.x2 - s.x1, ay = y2 - y1, az = s.z2 - s.z1, L2 = ax * ax + ay * ay + az * az;
          let t = L2 > 0 ? ((x - s.x1) * ax + (y - y1) * ay + (z - s.z1) * az) / L2 : 0; t = U.clamp(t, 0, 1);
          dd = Math.hypot(x - s.x1 - ax * t, y - y1 - ay * t, z - s.z1 - az * t);
        } else if (s.type === 'powerline' && DS.World.distToWire) dd = DS.World.distToWire(x, y, z);
        if (dd < best) best = dd;
      }
      return best;
    }
    viewPos(t, out) {   // مكان التصوير المقترح لعلامة
      if (t.from) { out.x = t.from.x; out.z = t.from.z; out.y = t.from.y != null ? t.from.y : t.y; return out; }
      let nx, nz;
      if (t.yaw != null) { nx = Math.sin(t.yaw); nz = -Math.cos(t.yaw); }
      else {
        const c = this.ctr;
        const dx = c ? t.x - c.x : 0, dz = c ? t.z - c.z : 1, l = Math.hypot(dx, dz) || 1; nx = dx / l; nz = dz / l;
      }
      let dd = this.o.viewDist || this.mid;
      const C = this.cyl;
      if (C && !this.o.viewDist) {   // المسافة تنقاس من سطح الاسطوانة (مو من العلامة)
        const wx = t.x - C.x, wz = t.z - C.z, wn = wx * nx + wz * nz, R = C.r + this.mid, disc = wn * wn - (wx * wx + wz * wz) + R * R;
        if (disc > 0) dd = Math.max(1, -wn + Math.sqrt(disc));
      }
      out.x = t.x + nx * dd; out.z = t.z + nz * dd; out.y = t.y;
      return out;
    }
    pickTarget(d) {
      const left = this.tags.filter(t => !t.got);
      if (!left.length) { this.target = null; return; }
      if (this.o.order === 'near') {
        let best = null, bd = Infinity;
        for (const t of left) { const e = Math.hypot(t.x - d.p.x, (t.y - d.p.y) * 1.5, t.z - d.p.z); if (e < bd) { bd = e; best = t; } }
        this.target = best;
      } else this.target = left[0];
      this.stIn = false;
      this.tags.forEach(t => { const st = t.got ? 'done' : t === this.target ? 'next' : 'idle'; t.vis.set(st); t.m.state = st; });
    }
    // هل تنفع صورة لهالعلامة الحين؟ يرجع 'ok' أو سبب
    capCheck(t, cam) {
      const pr = SCO().project(cam, t.x, t.y, t.z, PR);
      if (!pr.ok || Math.abs(pr.x) > this.center || Math.abs(pr.y) > this.center) return 'frame';
      if (SCO().pxSize(t.textH, pr.dist, cam.vfovDeg) < this.zoomPx) return 'small';
      if (t.yaw != null) {
        const nx = Math.sin(t.yaw), nz = -Math.cos(t.yaw), c = ((cam.pos.x - t.x) * nx + (cam.pos.z - t.z) * nz) / Math.max(pr.dist, 1e-3);
        if (c < 0.34) return 'angle';
      }
      if (this.turnV > this.maxTurn) return 'moving';
      if (this.ko.r > 0 && this.dist < this.ko.r) return 'close';
      return 'ok';
    }
    flash(t) { this.flashTxt = t; this.flashT = this.t; }
    update(dt, ctx) {
      const d = ctx.drone, o = this.o, cam = ctx.camera();
      this.t += dt;
      if (this.decision) return;
      this.turnV = this.turn.update(dt, d.yaw, ctx.session.gimbal);
      this.dist = this.S.length ? this.structDist(cam.pos.x, cam.pos.y, cam.pos.z) : 99;
      // المنطقة الممنوعة
      if (this.ko.r > 0 && !d.onGround) {
        const inK = this.dist < this.ko.r;
        if (inK) {
          this.kT += dt;
          if (!this.kIn || (this.ko.every > 0 && this.kT >= this.ko.every)) { this.kT = 0; this.fault(this.ko.cls, this.ko.cls === 'safety' ? 'keepout' : 'standoffISR'); }
        }
        this.kIn = inK;
        if (this.state !== 'run') return;
      }
      // مسافة التفتيش: تنحسب وأنت "على الهدف" (العلامة في الكادر وقريب). وقت التنقل: بس لو قربت أكثر من اللازم
      if (this.band && !d.onGround && this.phase === 'insp') {
        const T0 = this.target, inFr = !!T0 && SCO().project(cam, T0.x, T0.y, T0.z, PR2).inFrame;
        if (inFr && Math.abs(this.dist - this.mid) <= this.half) this.stIn = true;   // دخل المسافة الصح لهالعلامة
        // "على الهدف" = قريب من مكان تصويرها (8 م أفقي) — وهو رايح لعلامة بعيدة (حتى لو تنشاف) بس "القرب الزايد" ينحسب
        let onSt = inFr && this.stIn;
        if (onSt) { const vp = this.viewPos(T0, this._vpS || (this._vpS = { x: 0, y: 0, z: 0 })); onSt = U.dist2(d.p.x, d.p.z, vp.x, vp.z) < 8; }
        if (onSt && this.sd) this.sd.add(this.dist - this.mid);
        this.trackF('standoff', onSt ? Math.abs(this.dist - this.mid) : Math.max(0, this.mid - this.dist), this.half + 0.01);
      }
      if (this.rec && this.phase === 'insp' && !d.onGround) this.rec.update(dt, d, ctx.session.gimbal, ctx.controls, cam);
      // المؤشر
      const T = this.target;
      if (T && this.phase === 'insp') { this._ret.label = T.label; this._ret.ok = this.capCheck(T, cam) === 'ok'; this.reticle = this._ret; }
      else this.reticle = null;
      // المراحل
      if (this.phase === 'insp' && (this.got >= this.tags.length)) this.endInsp(ctx);
      if (this.phase === 'report') { if (!this.nextReport()) this.phase = o.landHome ? 'land' : 'done'; }
      if (this.phase === 'land') {
        if (!this.lc) this.lc = new LandCheck(DS.HOME.x, DS.HOME.z, 1.5, 1.2);
        if (this.lc.update(d) === 'done') this.phase = 'done';
      }
      if (this.phase === 'done') { this.battEnd = d.battery; this.state = 'done'; return; }
      this.progress = (this.got + (this.phase !== 'insp' ? 0.5 : 0)) / Math.max(1, this.tags.length);
      // التلميح
      const b = this.baseHint(d);
      if (this.phase === 'land') this.hint = this.lc.hint(d, 'H');
      else if (b) this.hint = b;
      else if (this.t - this.flashT < 2.5) this.hint = this.flashTxt;
      else if (this.kIn) this.hint = '⛔ ابعد! أنت داخل المنطقة الممنوعة (' + this.ko.r + ' م)';
      else if (T) {
        const vp = this.viewPos(T, this._vp || (this._vp = { x: 0, y: 0, z: 0 })), e = U.dist2(d.p.x, d.p.z, vp.x, vp.z);
        const why = this.capCheck(T, cam);
        let h = 'العلامة ' + T.label + ' (' + this.got + '/' + this.tags.length + '): ';
        if ((e > 6 || Math.abs(d.p.y - vp.y) > 2.5) && why !== 'ok') h += goHint(d, vp.x, vp.z, 'روح لمكان التصوير') + altAdvice(d.p.y, vp.y, 2);
        else if (this.band && Math.abs(this.dist - this.mid) > this.half) h += this.dist < this.mid ? 'ابعد شوي عن الهدف (' + Math.round(this.dist) + ' م)' : 'قرّب شوي (' + Math.round(this.dist) + ' م)';
        else h += why === 'ok' ? 'جاهز ✓ صوّر (RB)' : why === 'frame' ? 'خل العلامة في نص الكاميرا (لف + الجيمبل)' : why === 'small' ? 'الكتابة صغيرة — زوّم (LB مطوّل + RT) أو قرّب' :
          why === 'angle' ? 'صوّرها من قدام مو من الجنب' : why === 'moving' ? 'اثبت — الكاميرا تتحرك' : 'ابعد عن الهدف';
        this.hint = h;
      } else this.hint = 'خلصت العلامات ✓';
      if (this.t > this.tl) this.fail('خلص الوقت');
    }
    endInsp(ctx) {
      if (this.phase !== 'insp') return;
      if (this.fm) this.fm.flush(this.t);
      this.phase = 'report';
      this.queueReports((this._defQ || []).concat(this.o.report || []));
      this.target = null; this.reticle = null;
    }
    onShutter(ctx) {
      if (this.phase !== 'insp' || this.state !== 'run') return;
      const cam = ctx.camera();
      let n = 0, why = null;
      for (const t of this.tags) {
        if (t.got) continue;
        const r = this.capCheck(t, cam);
        if (r === 'ok') {
          t.got = true; n++; this.got++; t.vis.set('done'); t.m.state = 'done';
          if (this.rec) this.segs.push(this.rec.n);
          if (this.o.askDefects && t.defect != null) (this._defQ || (this._defQ = [])).push({ q: 'شوف صورة ' + (t.kind === 'insulator' ? 'العازل ' : 'العلامة ') + t.label + ': سليم ولا فيه عيب؟', a: ['سليم', 'فيه عيب (محروق أو مكسور)'], c: t.defect ? 1 : 0, shuffle: false, ex: t.defect ? 'فيه حروق/قطعة مكسورة — لازم تبلّغ عنه' : 'العازل سليم' });
        } else if (t === this.target) why = r;
      }
      if (n) { this.flash('📸 ✓ ' + n + ' صورة (' + this.got + '/' + this.tags.length + ')'); this.pickTarget(ctx.drone); }
      else this.flash('📸 الصورة ما تنفع: ' + ({ frame: 'العلامة مو في النص', small: 'الكتابة صغيرة', angle: 'من الجنب', moving: 'الكاميرا تتحرك', close: 'قريب مرة من الهدف' }[why] || 'ما فيه علامة'));
    }
    onCallout(ctx) { if (this.phase === 'insp' && this.got >= this.need) { this.flash('أنهيت التفتيش'); this.endInsp(ctx); } }
    score() {
      if (this.state !== 'done') return 0;
      const W = this.W, sc = SCO(), parts = {};
      parts.tags = this.got / Math.max(1, this.tags.length);
      parts.standoff = this.band ? (this.sd && this.sd.n ? sc.s(this.sd.rms, 2 * Math.max(0.5, this.half)) : 1) : null;
      parts.time = sc.band(this.t - this.par, 0, this.par);
      const bm = this.o.battMin != null ? this.o.battMin : 25;
      parts.battery = this.battEnd == null ? 1 : this.battEnd >= bm ? 1 : this.battEnd / bm;
      parts.smooth = this.smoothPart();
      parts.report = this.reportScore();
      const w = Object.assign({}, W);
      if (parts.report == null) delete w.report;
      return sc.combine(parts, w, this.fm);
    }
    stats() { return { got: this.got, total: this.tags.length, standoffRms: this.sd && this.sd.n ? Math.round(this.sd.rms * 10) / 10 : null, battery: this.battEnd != null ? Math.round(this.battEnd) : null, reports: this.reportScore(), ldlj: this.ldlj != null ? Math.round(this.ldlj * 10) / 10 : null, time: Math.round(this.t) }; }
    smoothPart() {
      if (!this.rec || this.rec.n < 40) return 1;
      const v = this.rec.ldljWin('p', 0, this.rec.n, 6);
      this.ldlj = v;
      return SCO().smooth(v, this.o.smoothRef != null ? this.o.smoothRef : -14, 8);
    }
    feedback() {
      const t = [];
      t.push('العلامات: ' + this.got + '/' + this.tags.length + (this.band && this.sd && this.sd.n ? ' • المسافة (RMS) ±' + this.sd.rms.toFixed(1) + ' م' : ''));
      if (this.fm && this.fm.safety) t.push('أهم شي المسافة الآمنة: لا تدخل المنطقة الممنوعة أبد');
      if (this.band && this.sd && this.sd.rms > this.half * 1.5) t.push('خل المسافة عن الهدف ثابتة (' + this.band[0] + '–' + this.band[1] + ' م)');
      const r = this.reportScore(); if (r != null && r < 1) t.push('ركز في الصور قبل التقرير');
      return t;
    }
    guide(ctx) {
      const d = ctx.drone, g = this._g;
      if (this.decision) { this._gd.decide = this.decision; return this._gd; }
      if (this.phase === 'land' && this.lc) return this.lc.guide(d);
      if (this.phase !== 'insp') return null;
      const T = this.target; if (!T) return null;
      const vp = this.viewPos(T, this._vp2 || (this._vp2 = { x: 0, y: 0, z: 0 })), cam = ctx.camera();
      g.aim.x = T.x; g.aim.y = T.y; g.aim.z = T.z; g.yaw = null; g.gimbal = null; g.shutter = false;
      g.x = vp.x; g.z = vp.z; g.alt = Math.max(2, vp.y + 0.03);
      const eh = U.dist2(d.p.x, d.p.z, vp.x, vp.z), ev = Math.abs(d.p.y - g.alt), vh = Math.hypot(d.v.x, d.v.z);
      g.speed = eh > 20 ? 7 : eh > 6 ? 4 : 1.5;
      // حول الاسطوانة: نمشي على قوس عشان ما ندخل المنطقة الممنوعة
      const C = this.cyl;
      if (C && eh > 2) {
        const a0 = U.bearing(C.x, C.z, d.p.x, d.p.z), a1 = U.bearing(C.x, C.z, vp.x, vp.z), da = U.wrap(a1 - a0);
        const r0 = U.dist2(C.x, C.z, d.p.x, d.p.z), r1 = U.dist2(C.x, C.z, vp.x, vp.z);
        if (Math.abs(da) > 0.3 && r0 < r1 + 12) {
          const a = a0 + U.clamp(da, -0.35, 0.35), rr = Math.max(r1, Math.min(r0, r1 + 4));
          g.x = C.x + Math.sin(a) * rr; g.z = C.z - Math.cos(a) * rr; g.speed = 3;
          if (Math.abs(d.p.y - g.alt) > 4) g.alt = d.p.y + U.clamp(g.alt - d.p.y, -4, 4);
        }
      }
      // زوم لو الكتابة صغيرة
      const base = d.profile.cam ? d.profile.cam.vfov : 43, pr = SCO().project(cam, T.x, T.y, T.z, PR2);
      const px1 = SCO().pxSize(T.textH, pr.dist, base), mz = (d.profile.cam && d.profile.cam.maxZoom) || 1;
      g.zoom = eh < 2 && ev < 1 ? U.clamp(this.zoomPx * 1.35 / Math.max(px1, 1e-3), 1, mz) : 1;
      if (eh < 0.8 && ev < 0.6 && vh < 0.3) g.shutter = this.capCheck(T, cam) === 'ok';
      return g;
    }
    map() { return this._map; }
  }
  DS.InspectTask = InspectTask;
  // تصوير بسيط: بدون مسافة أمان، العلامة لازم في نص الصورة
  class PhotoTask extends InspectTask {
    constructor(o) { super(Object.assign({ title: 'التصوير', short: 'التصوير', timeLimit: 300 }, o)); }
    defaults() { return { standoff: null, keepOut: 0, w: { tags: 60, time: 20, smooth: 20, report: 20 }, center: 0.5 }; }
  }
  DS.PhotoTask = PhotoTask;

  // علامات جاهزة: DS.Inspect.towerTags({id:'telecom', perFace:4, y0:12, y1:52}) و DS.Inspect.insulatorTags({pylons:[1,2], side:1, defects:[ids]})
  DS.Inspect = {
    towerTags(o) {
      o = o || {};
      const T = (DS.World.towers || []).find(t => t.id === (o.id || 'telecom')) || (DS.World.towers || [])[0];
      if (!T) return { tags: [], structures: [] };
      const faces = o.faces || 3, per = o.perFace || 4, y0 = o.y0 != null ? o.y0 : 8, y1 = o.y1 != null ? o.y1 : 38, out = [], L = 'ABC';
      // اتجاه وجوه البرج نفس الرسم في world.js (الأرجل على 0.3 + k·120°) — الوجه الأول يطالع جنوب-غرب (جهة البيت)
      const yaw0 = o.yaw0 != null ? o.yaw0 : 0.3 + Math.PI / 3 + 2 * Math.PI / 3, fr = (T.face || 3) / (2 * Math.sqrt(3));
      for (let f = 0; f < faces; f++) {
        const a = yaw0 + f * 2 * Math.PI / faces;
        for (let k = 0; k < per; k++) {
          const y = per > 1 ? y0 + (y1 - y0) * k / (per - 1) : (y0 + y1) / 2, rr = (y >= T.panels.y0 - 1.5 && y <= T.panels.y1 + 1.5) ? 1.95 : fr + 0.12;   // على وجه البرج (وقدام الألواح)
          out.push({ x: T.x + Math.sin(a) * rr, y, z: T.z - Math.cos(a) * rr, yaw: U.wrap(a), label: (L[f] || 'F' + f) + (k + 1), size: o.size || 0.3 });
        }
      }
      return { tags: out, structures: [{ type: 'cyl', x: T.x, z: T.z, r: 2.0, y0: 0, h: T.h + 4 }] };
    },
    insulatorTags(o) {
      o = o || {};
      const PL = (DS.World.powerlines || [])[0];
      if (!PL) return { tags: [], structures: [] };
      const side = o.side < 0 ? -1 : 1, defects = o.defects || [], tags = [];
      for (const ins of PL.insulators) {
        if (o.pylons && o.pylons.indexOf(ins.pylon) < 0) continue;
        if (o.wire != null && ins.wire !== o.wire) continue;
        const w = PL.wires[ins.wire];
        if (Math.sign(w.dz) !== side) continue;   // بس العوازل اللي على جهتنا
        tags.push({ kind: 'insulator', x: ins.x, y: ins.y, z: ins.z + side * 0.4, ix: ins.x, iy: ins.y, iz: ins.z, yaw: side > 0 ? Math.PI : 0, label: 'I' + ins.id, size: 0.22,
          defect: defects.indexOf(ins.id) >= 0, from: { x: ins.x, y: ins.y + 1, z: ins.z + side * (o.offset || 15) } });
      }
      return { tags, structures: [{ type: 'powerline' }] };
    }
  };

  // ---------------- 4) البحث والإنقاذ (ناس في منطقة — علّمهم بالكاميرا) ----------------
  // o: {datum:{x,z}, people:[{x,z,pose,hot}] | n:2, radius:150, minR:25, alt:50, spacing:null (من عرض الكاميرا)، pattern:'expanding'|'parallel'|'none',
  //     area:{x0,x1,z0,z1} (للمتوازي)، firstYaw (الافتراضي ضد الريح)، markDeg:5, maxRange:250, reportTol:10, falsePenalty:5, report:[q], landHome, par,
  //     w:{found:40, report:20, pattern:20, time:10, alt:10}}
  class SearchTask extends Task {
    constructor(o) { super(Object.assign({ title: 'البحث والإنقاذ', short: 'البحث', timeLimit: 1200 }, o)); }
    begin(ctx) {
      super.begin(ctx); this.initFaults(ctx); this.st = { k: 0 };
      const o = this.o, rng = ctx.rng || Math.random, Dm = o.datum || { x: 0, z: -420 };
      this.datum = { x: Dm.x, z: Dm.z }; this.alt = o.alt || 50; this.markDeg = o.markDeg || 5; this.maxRange = o.maxRange || 250;
      this.W = Object.assign({ found: 40, report: 20, pattern: 20, time: 10, alt: 10 }, o.w || {});
      // الناس
      let P = o.people;
      if (!P) {
        P = []; const n = o.n || 2, R = o.radius || 150, r0 = o.minR != null ? o.minR : 25, Wd = DS.World || {};
        for (let k = 0, tries = 0; k < n && tries < 400; tries++) {
          const a = rng() * Math.PI * 2, r = r0 + Math.sqrt(rng()) * (R - r0), x = this.datum.x + Math.sin(a) * r, z = this.datum.z - Math.cos(a) * r;
          if ((Wd.dunes || []).some(du => Math.hypot(du.x - x, du.z - z) < du.a + 3)) continue;
          if ((Wd.rocks || []).some(rk => Math.hypot(rk.x - x, rk.z - z) < rk.s + 2)) continue;
          if (P.some(q => Math.hypot(q.x - x, q.z - z) < 30)) continue;
          P.push({ x, z, pose: 'lie' }); k++;
        }
      }
      this.people = P.map((p, i) => ({ x: p.x, z: p.z, y: p.pose === 'stand' ? 1.0 : 0.25, pose: p.pose || 'lie', found: false, err: null,
        vis: ctx.R.add(this, { type: 'person', x: p.x, z: p.z, pose: p.pose || 'lie', hot: p.hot !== false, color: p.color != null ? p.color : [0xdc2626, 0x2563eb, 0xf59e0b][i % 3], yaw: rng() * 6.28 }),
        m: { kind: 'person', x: p.x, z: p.z, state: 'done' } }));
      ctx.R.add(this, { type: 'flag', x: this.datum.x, z: this.datum.z, color: 0xfacc15, h: 3.5 });
      // عرض الكاميرا على الأرض → المسافة بين المسارات
      const cam = d0 => d0.profile.cam || { vfov: 43 };
      const vf = (cam(ctx.drone).vfov || 43) * D2R, hf = 2 * Math.atan(Math.tan(vf / 2) * 16 / 9);
      this.swath = 2 * this.alt * Math.tan(hf / 2);
      this.S = o.spacing || Math.round(this.swath * 0.8);
      const wind = ctx.session && ctx.session.windBase ? ctx.session.windBase.dir : 0;
      this.h0 = o.firstYaw != null ? o.firstYaw : wind * D2R;
      this.buildPattern(o);
      this.phase = 'search'; this.reached = false; this.seg = 1; this.spot = null; this.falseN = 0; this.foundN = 0;
      this.xt = SCO() ? new (SCO().Stat)() : null; this.at = SCO() ? new (SCO().Stat)() : null; this.sT = 0;
      this.flashT = -9; this.flashTxt = ''; this.reticle = null; this._ret = { deg: this.markDeg, label: 'علّم الشخص', ok: false };
      this._g = { x: 0, z: 0, alt: this.alt, yaw: null, gimbal: -80, speed: 8, shutter: false };
      this._gd = { decide: null };
      this._mapD = { kind: 'beacon', x: this.datum.x, z: this.datum.z, label: 'D', state: 'next' };
      this._map = [o.area ? { kind: 'area', x: (o.area.x0 + o.area.x1) / 2, z: (o.area.z0 + o.area.z1) / 2, w: o.area.x1 - o.area.x0, d: o.area.z1 - o.area.z0, state: 'idle' } : { kind: 'area', x: this.datum.x, z: this.datum.z, r: o.radius || 150, state: 'idle' }, this._mapD];
      this.par = o.par || (this.patLen / 7 + 60);
    }
    buildPattern(o) {
      const pts = [];
      const R = (o.radius || 150) + this.S * 0.5, kind = o.pattern || 'expanding';
      if (kind === 'parallel' && o.area) {
        const A = o.area, long = (A.x1 - A.x0) >= (A.z1 - A.z0);
        const n = Math.max(1, Math.ceil((long ? A.z1 - A.z0 : A.x1 - A.x0) / this.S));
        for (let i = 0; i < n; i++) {
          const c = (long ? A.z0 : A.x0) + this.S * (i + 0.5), a = i % 2 === 0;
          if (long) { pts.push(a ? A.x0 : A.x1, c, a ? A.x1 : A.x0, c); } else { pts.push(c, a ? A.z0 : A.z1, c, a ? A.z1 : A.z0); }
        }
        const P = [];
        for (let i = 0; i < pts.length; i += 2) P.push(pts[i], pts[i + 1]);
        this.pat = new Float64Array(P);
      } else if (kind === 'none') this.pat = new Float64Array([this.datum.x, this.datum.z]);
      else {   // مربع يكبر: الضلعين 1-2 = S، 3-4 = 2S ... ولفات 90°
        let x = this.datum.x, z = this.datum.z, h = this.h0;
        pts.push(x, z);
        for (let k = 0; k < 40; k++) {
          const len = this.S * (Math.floor(k / 2) + 1);
          x += Math.sin(h) * len; z += -Math.cos(h) * len; pts.push(x, z);
          h += Math.PI / 2;
          if (Math.floor(k / 2) * this.S / 2 >= R && k % 2 === 1) break;
        }
        this.pat = new Float64Array(pts);
      }
      let L = 0; const P = this.pat;
      for (let i = 2; i < P.length; i += 2) L += Math.hypot(P[i] - P[i - 2], P[i + 1] - P[i - 1]);
      this.patLen = L;
      if (kind !== 'none' && P.length >= 2) { this.datum.x = P[0]; this.datum.z = P[1]; }
    }
    xtDist(x, z) {
      const P = this.pat; let best = Infinity;
      for (let i = 2; i < P.length; i += 2) { const e = segDist(x, z, P[i - 2], P[i - 1], P[i], P[i + 1]); if (e < best) best = e; }
      return best;
    }
    flash(t) { this.flashTxt = t; this.flashT = this.t; }
    nearestInView(ctx, deg) {   // أقرب شخص (ما انلقى) للنص
      let best = null, ba = 999;
      for (const p of this.people) {
        if (p.found) continue;
        const iv = ctx.inView(p.x, p.y, p.z, deg);
        if (iv.dist <= this.maxRange && iv.angle < ba) { ba = iv.angle; best = p; }
      }
      this._ba = ba; return best;
    }
    update(dt, ctx) {
      const d = ctx.drone, o = this.o;
      this.t += dt;
      if (this.decision) return;
      if (this.phase === 'search') {
        if (!this.reached && !d.onGround && U.dist2(d.p.x, d.p.z, this.datum.x, this.datum.z) < Math.max(10, this.S * 0.4)) { this.reached = true; this.flash('وصلت نقطة البداية — ابدأ البحث بالنمط'); }
        this.sT += dt;
        if (this.reached && !d.onGround && this.sT >= 0.2) {
          this.sT = 0;
          if (this.xt && o.pattern !== 'none') this.xt.add(this.xtDist(d.p.x, d.p.z));
          if (this.at) this.at.add(d.p.y - this.alt);
        }
        const p = this.nearestInView(ctx, 180);
        this._ret.ok = !!p && this._ba <= this.markDeg; this.reticle = this._ret;
        if (this.foundN >= this.people.length) this.endSearch();
      }
      if (this.phase === 'report') { this.reticle = null; if (!this.nextReport()) this.phase = o.landHome ? 'land' : 'done'; }
      if (this.phase === 'land') {
        if (!this.lc) this.lc = new LandCheck(DS.HOME.x, DS.HOME.z, 2, 1.2);
        if (this.lc.update(d) === 'done') this.phase = 'done';
      }
      if (this.phase === 'done') { this.state = 'done'; return; }
      this.progress = this.foundN / Math.max(1, this.people.length);
      const b = this.baseHint(d);
      if (this.phase === 'land') this.hint = this.lc.hint(d, 'H');
      else if (b) this.hint = b;
      else if (this.t - this.flashT < 3) this.hint = this.flashTxt;
      else if (!this.reached) this.hint = goHint(d, this.datum.x, this.datum.z, 'روح لنقطة البداية D') + altAdvice(d.p.y, this.alt, 8);
      else this.hint = 'دوّر على الناس (' + this.foundN + '/' + this.people.length + ') — حط الشخص في الدائرة واضغط RB' + (ctx.env.thermal ? ' • الحراري أسهل (Y مطوّل)' : '') + ' • ▶ = خلصت البحث';
      if (this.t > this.tl) { if (this.foundN > 0) this.endSearch(); else this.fail('خلص الوقت'); }
    }
    endSearch() {
      if (this.phase !== 'search') return;
      if (this.fm) this.fm.flush(this.t);
      this.phase = 'report';
      this.queueReports(this.o.report || []);
    }
    onShutter(ctx) {
      if (this.phase !== 'search' || this.state !== 'run') return;
      const p = this.nearestInView(ctx, 180);
      if (p && this._ba <= this.markDeg) {
        const cam = ctx.camera(), f = cam.fwd;
        let hx = p.x, hz = p.z;
        if (f.y < -0.02) { const t = (p.y - cam.pos.y) / f.y; hx = cam.pos.x + f.x * t; hz = cam.pos.z + f.z * t; }
        p.err = Math.hypot(hx - p.x, hz - p.z); p.found = true; this.foundN++;
        p.rep = { x: hx, z: hz };
        this._map.push(p.m);
        this.flash('✓ لقيت شخص! الموقع: ' + Math.round(hx) + '، ' + Math.round(hz) + ' (' + this.foundN + '/' + this.people.length + ')');
        if (ctx.say) ctx.say('لقيت شخص! بلّغ عن موقعه');
        if (this.spot === p) this.spot = null;
      } else if (!p || this._ba > 15) {
        this.falseN++; this.fault('minor', 'falseMark'); this.flash('✗ ما فيه أحد هنا — بلاغ غلط');
      } else this.flash('قرّب الشخص لنص الدائرة أكثر');
    }
    onCallout(ctx) { if (this.phase === 'search' && this.reached) { this.flash('أنهيت البحث'); this.endSearch(); } }
    stats() { return { found: this.foundN, total: this.people.length, errors: this.people.map(p => (p.err == null ? null : Math.round(p.err * 10) / 10)), reported: this.people.filter(p => p.rep).map(p => ({ x: Math.round(p.rep.x), z: Math.round(p.rep.z) })), falseMarks: this.falseN, spacing: this.S, xtRms: this.xt && this.xt.n ? Math.round(this.xt.rms * 10) / 10 : null, time: Math.round(this.t) }; }
    score() {
      if (this.state !== 'done') return 0;
      const sc = SCO(), parts = {}, F = this.people.filter(p => p.found);
      parts.found = this.foundN / Math.max(1, this.people.length);
      parts.report = F.length ? F.reduce((a, p) => a + sc.s(p.err, 2 * (this.o.reportTol || 10)), 0) / F.length : 0;
      const rq = this.reportScore();
      if (rq != null) parts.report = 0.5 * parts.report + 0.5 * rq;
      parts.pattern = this.o.pattern === 'none' ? null : this.xt && this.xt.n ? sc.s(this.xt.rms, 0.5 * this.S) : 0;
      parts.time = sc.band(this.t - this.par, 0, this.par);
      parts.alt = this.at && this.at.n ? sc.s(this.at.rms, 10) : 1;
      const w = Object.assign({}, this.W); if (parts.pattern == null) delete w.pattern;
      // combine يخصم 5 لكل بلاغ غلط (خطأ بسيط) — falsePenalty يغيّرها
      return U.clamp(sc.combine(parts, w, this.fm) - Math.max(0, (this.o.falsePenalty != null ? this.o.falsePenalty : 5) - 5) * this.falseN, 0, 100);
    }
    feedback() {
      const t = ['لقيت ' + this.foundN + '/' + this.people.length + (this.falseN ? ' • بلاغات غلط: ' + this.falseN : '')];
      if (this.xt && this.xt.n && this.xt.rms > 0.25 * this.S) t.push('التزم بخطوط النمط (المربع اللي يكبر): المسافة بين الخطوط ' + this.S + ' م');
      const F = this.people.filter(p => p.found && p.err > (this.o.reportTol || 10));
      if (F.length) t.push('الموقع اللي بلّغت عنه بعيد — خل الشخص في نص الدائرة والكاميرا لتحت قبل التصوير');
      return t;
    }
    guide(ctx) {
      const d = ctx.drone, g = this._g, o = this.o;
      if (this.decision) { this._gd.decide = this.decision; return this._gd; }
      if (this.phase === 'land' && this.lc) return this.lc.guide(d);
      if (this.phase !== 'search') return null;
      g.shutter = false; g.alt = this.alt; g.yaw = null; g.gimbal = -80; g.speed = 8;
      // شفت أحد في الصورة؟ (المدرب يشوف بعينه — الكادر كامل)
      if (!this.spot && this.reached) {
        const cam = ctx.camera();
        for (const p of this.people) {
          if (p.found) continue;
          const pr = SCO().project(cam, p.x, p.y, p.z, PR2);
          if (pr.inFrame && Math.abs(pr.x) < 0.95 && Math.abs(pr.y) < 0.95 && pr.dist < this.maxRange * 0.8) { this.spot = p; break; }
        }
      }
      if (this.spot) {
        const p = this.spot, eh = U.dist2(d.p.x, d.p.z, p.x, p.z);
        g.x = p.x; g.z = p.z; g.gimbal = -90; g.speed = eh > 15 ? 8 : 3;
        const iv = ctx.inView(p.x, p.y, p.z, this.markDeg);
        g.shutter = iv.angle < this.markDeg * 0.5 && Math.hypot(d.v.x, d.v.z) < 0.8 && Math.abs(ctx.session.gimbal + 90) < 3;
        return g;
      }
      if (!this.reached) { g.x = this.datum.x; g.z = this.datum.z; g.speed = 10; g.gimbal = -60; return g; }
      // نمشي على النمط: النقطة اللي قدام 18 م
      const P = this.pat, nSeg = P.length / 2;
      if (nSeg < 2) return { press: { RIGHT: true } };
      let i = Math.max(1, this.seg);
      for (;;) {
        const ax = P[(i - 1) * 2], az = P[(i - 1) * 2 + 1], bx = P[i * 2], bz = P[i * 2 + 1];
        const l = Math.hypot(bx - ax, bz - az), tt = l > 0 ? ((d.p.x - ax) * (bx - ax) + (d.p.z - az) * (bz - az)) / (l * l) : 1;
        if ((tt > 1 || Math.hypot(bx - d.p.x, bz - d.p.z) < 6) && i < nSeg - 1) { i++; continue; }
        this.seg = i;
        if (i >= nSeg - 1 && Math.hypot(bx - d.p.x, bz - d.p.z) < 8) return { press: { RIGHT: true } };   // خلص النمط → بلاغ
        const f = U.clamp(tt + 18 / Math.max(l, 1), 0, 1);
        g.x = ax + (bx - ax) * f; g.z = az + (bz - az) * f; g.yaw = Math.atan2(bx - ax, -(bz - az));
        return g;
      }
    }
    map() { return this._map; }
  }
  DS.SearchTask = SearchTask;

  // ---------------- 5) تتبع هدف يتحرك (سيارة على الطريق) والكاميرا عليه ----------------
  // o: {road:'loop', s0, dir:1, speed:6 | [v0,v1] | [[t,v],...], ramp, accel:1.5, static:false, x,z,yaw (لو ثابت), vehicle:{kind,color},
  //     startR:40, aimY:1, offset:{side:-15, back:0, alt:8}, view:{x,z,alt} (للهدف الثابت), dist:[10,25], frame:{x:0,y:0,tol:0.05},
  //     duration:60, lostMax:5, maxDist:150, keepOut: r | {r, cls:'major', every:1}, zoom, report:[q], w:{frame:35, dist:25, keep:25, smooth:15}, smoothRef}
  class TrackTask extends Task {
    constructor(o) { super(Object.assign({ title: 'تتبع الهدف بالكاميرا', short: 'التتبع', timeLimit: ((o && o.duration) || 60) + 240 }, o)); }
    begin(ctx) {
      super.begin(ctx); this.initFaults(ctx); this.st = { k: 0 };
      const o = this.o;
      this.mv = new Mover(Object.assign({ static: !!o.static || o.speed === 0 }, o), ctx, this);
      this.fr = Object.assign({ x: 0, y: 0, tol: 0.05 }, o.frame || {});
      this.band = o.dist || [10, 25]; this.off = Object.assign({ side: -15, back: 0, alt: 8 }, o.offset || {});
      this.W = Object.assign({ frame: 35, dist: 25, keep: 25, smooth: 15 }, o.w || {});
      this.dur = o.duration || 60; this.phase = 'wait'; this.trT = 0; this.outT = 0;
      const ko = o.keepOut || 0;
      this.ko = typeof ko === 'number' ? { r: ko, cls: 'safety', every: 0 } : Object.assign({ r: 0, cls: 'major', every: 1 }, ko);
      this.kIn = false; this.kT = 0;
      this.tIn = 0; this.tOk = 0; this.tBand = 0; this.fs = SCO() ? new (SCO().Stat)() : null;
      this.rec = SCO() ? new (SCO().Recorder)(25, 3000) : null;
      this.reticle = null; this._ret = { deg: 5, label: 'الهدف', ok: false };
      this._g = { x: 0, z: 0, alt: 8, aim: { x: 0, y: 1, z: 0 }, vff: { x: 0, z: 0 }, yawFF: 0, speed: 5 };
      this._gd = { decide: null };
      this._mapV = { kind: o.vehicle && o.vehicle.kind === 'boat' ? 'boat' : 'vehicle', x: this.mv.p.x, z: this.mv.p.z, state: 'next' };
      this._map = [this._mapV];
      this.ferr = 1; this.dNow = 0;
    }
    update(dt, ctx) {
      const d = ctx.drone, o = this.o, mv = this.mv;
      this.t += dt;
      if (this.decision) return;
      mv.update(this.phase === 'track' ? dt : 0);
      this._mapV.x = mv.p.x; this._mapV.z = mv.p.z;
      const cam = ctx.camera(), ay = o.aimY != null ? o.aimY : 1;
      const pr = SCO().project(cam, mv.p.x, ay, mv.p.z, PR);
      this.ferr = SCO().framing(pr, this.fr.x, this.fr.y); this.dNow = pr.dist;
      const framed = pr.inFrame && this.ferr <= this.fr.tol;
      this._ret.deg = SCO().fracDeg(this.fr.tol, cam.vfovDeg); this._ret.ok = framed; this.reticle = this.phase === 'track' ? this._ret : null;
      // منطقة ممنوعة حول الهدف (مثلاً مراقبة ISR: لا تقرب أقل من 300 م)
      if (this.ko.r > 0 && !d.onGround) {
        const inK = U.dist2(d.p.x, d.p.z, mv.p.x, mv.p.z) < this.ko.r;
        if (inK) { this.kT += dt; if (!this.kIn || (this.ko.every > 0 && this.kT >= this.ko.every)) { this.kT = 0; this.fault(this.ko.cls, this.ko.cls === 'safety' ? 'keepout' : 'standoffISR'); } }
        this.kIn = inK;
        if (this.state !== 'run') return;
      }
      if (this.phase === 'wait') {
        const V = o.view;
        const near = !d.onGround && d.p.y > 2 && (V ? U.dist2(d.p.x, d.p.z, V.x, V.z) < (o.startR || 15) && Math.abs(d.p.y - (V.alt != null ? V.alt : this.off.alt)) < 8
          : U.dist2(d.p.x, d.p.z, mv.p.x, mv.p.z) < (o.startR || Math.min(40, this.band[1] * 0.9)));
        this.hint = this.baseHint(d) || (near ? '' : V ? goHint(d, V.x, V.z, 'روح لمكان المراقبة') + altAdvice(d.p.y, V.alt != null ? V.alt : this.off.alt, 8) : goHint(d, mv.p.x, mv.p.z, 'روح جنب الهدف'));
        if (near) { this.phase = 'track'; mv.on = !mv.o.static; if (ctx.say) ctx.say(mv.o.static ? 'خل الهدف في نص الكاميرا' : 'السيارة بدت تمشي — خلها في نص الكاميرا'); ctx.stepDone(); }
      } else if (this.phase === 'track') {
        this.trT += dt;
        if (pr.inFrame) { this.tIn += dt; this.outT = 0; if (this.fs) this.fs.add(this.ferr); } else this.outT += dt;
        if (framed) this.tOk += dt;
        const inBand = pr.dist >= this.band[0] && pr.dist <= this.band[1];
        if (inBand) this.tBand += dt;
        this.trackF('frame', pr.inFrame ? 0 : 1, 0.5);
        const mid = (this.band[0] + this.band[1]) / 2, half = (this.band[1] - this.band[0]) / 2;
        if (this.trT > 3) this.trackF('dist', Math.abs(pr.dist - mid), half);   // أول 3 ث سماح
        if (this.rec) this.rec.update(dt, d, ctx.session.gimbal, ctx.controls, cam);
        this.progress = this.trT / this.dur;
        const b = this.baseHint(d);
        this.hint = b || (this.kIn ? '⛔ قريب مرة من الهدف — ابعد (' + this.ko.r + ' م)' : !pr.inFrame ? '⚠️ الهدف طلع من الكاميرا! لف عليه' : pr.dist < this.band[0] ? 'قريب مرة — ابعد شوي' : pr.dist > this.band[1] ? 'بعيد — قرّب شوي' :
          framed ? 'ممتاز ✓ كمّل كذا (' + Math.ceil(this.dur - this.trT) + ')' : 'خل الهدف في نص الدائرة (لف بشويش + الجيمبل)');
        if (this.outT > (o.lostMax || 5)) return this.fail('ضيّعت الهدف');
        if (pr.dist > (o.maxDist || 150)) return this.fail('بعدت كثير عن الهدف');
        if (this.trT >= this.dur) { if (this.fm) this.fm.flush(this.t); this.phase = 'report'; this.queueReports(o.report || []); mv.on = false; }
      }
      if (this.phase === 'report') { this.reticle = null; if (!this.nextReport()) { this.state = 'done'; return; } }
      if (this.t > this.tl) this.fail('خلص الوقت');
    }
    score() {
      if (this.state !== 'done') return 0;
      const sc = SCO(), T = Math.max(this.trT, 1e-3), parts = {};
      parts.frame = 0.6 * (this.tOk / T) + 0.4 * (this.fs && this.fs.n ? sc.s(this.fs.rms, this.fr.tol * 3) : 0);
      parts.dist = this.tBand / T; parts.keep = this.tIn / T;
      parts.smooth = this.mv.o.static ? null : this.smoothPart();   // الهدف الثابت: السلاسة ما لها معنى
      const rq = this.reportScore(), w = Object.assign({}, this.W);
      if (parts.smooth == null) delete w.smooth;
      if (rq != null) { parts.report = rq; w.report = w.report || 20; }
      return sc.combine(parts, w, this.fm);
    }
    stats() { const T = Math.max(this.trT, 1e-3); return { framed: Math.round(100 * this.tOk / T), inFrame: Math.round(100 * this.tIn / T), inBand: Math.round(100 * this.tBand / T), time: Math.round(this.trT), reports: this.reportScore() }; }
    smoothPart() {
      if (!this.rec || this.rec.n < 40) return 1;
      const v = this.rec.ldljWin('cam', 0, this.rec.n, 6); this.ldlj = v;
      return SCO().smooth(v, this.o.smoothRef != null ? this.o.smoothRef : -16, 8);
    }
    feedback() {
      const T = Math.max(this.trT, 1e-3), t = ['الهدف في النص ' + Math.round(100 * this.tOk / T) + '% • في الكادر ' + Math.round(100 * this.tIn / T) + '% • المسافة الصح ' + Math.round(100 * this.tBand / T) + '%'];
      if (this.tOk / T < 0.6) t.push('اللف (العصا اليسار) يحرك الكادر يمين ويسار، والجيمبل (LT/RT) فوق وتحت — حركات صغيرة وناعمة');
      if (this.tBand / T < 0.7) t.push('حافظ على نفس المسافة: لو السيارة سرّعت سرّع معها');
      return t;
    }
    guide(ctx) {
      const d = ctx.drone, g = this._g, o = this.o, mv = this.mv;
      if (this.decision) { this._gd.decide = this.decision; return this._gd; }
      if (this.phase === 'report') return null;
      const ay = o.aimY != null ? o.aimY : 1;
      g.aim.x = mv.p.x; g.aim.y = ay; g.aim.z = mv.p.z;
      if (mv.o.static || !this.mv.road) {
        const V = o.view || { x: mv.p.x - this.off.side, z: mv.p.z + 20, alt: this.off.alt };
        g.x = V.x; g.z = V.z; g.alt = V.alt != null ? V.alt : this.off.alt; g.vff.x = 0; g.vff.z = 0; g.yawFF = 0; g.speed = 10;
      } else {
        const fx = Math.sin(mv.p.yaw), fz = -Math.cos(mv.p.yaw), rx = Math.cos(mv.p.yaw), rz = Math.sin(mv.p.yaw);
        g.x = mv.p.x + rx * this.off.side - fx * this.off.back; g.z = mv.p.z + rz * this.off.side - fz * this.off.back; g.alt = this.off.alt;
        const on = this.phase === 'track';
        g.vff.x = on ? mv.vel.x : 0; g.vff.z = on ? mv.vel.z : 0; g.speed = on ? 5 : 8;
        const dx = mv.p.x - d.p.x, dz = mv.p.z - d.p.z, r2 = Math.max(dx * dx + dz * dz, 4), vrx = g.vff.x - d.v.x, vrz = g.vff.z - d.v.z;
        g.yawFF = (dx * vrz - dz * vrx) / r2;
      }
      g.zoom = o.zoom && this.phase === 'track' ? o.zoom : null;
      return g;
    }
    map() { return this._map; }
  }
  DS.TrackTask = TrackTask;

  // ---------------- 6) الدوران حول هدف والكاميرا عليه (Orbit) + لولبي (Helix) ----------------
  // o: {x, z, subject:{type:'vehicle'|'person'|'statue', kind, color, yaw}|null, aimY:1, R:15, band:2, alt:10, altTol:1, climb:0 (م لكل لفة),
  //     laps:[{dir:1,deg:360},{dir:-1,deg:360}] | dir+deg, period:[40,60] (ث لكل 360°), frameTol:0.05, markers:true, w:{frame:30,radius:25,alt:15,speed:15,smooth:15}, smoothRef}
  class OrbitCamTask extends Task {
    constructor(o) { super(Object.assign({ title: 'الدوران والكاميرا على الهدف', short: 'الدوران بالكاميرا', timeLimit: 120 + 90 * ((o && o.laps && o.laps.length) || 1) }, o)); }
    begin(ctx) {
      super.begin(ctx); this.initFaults(ctx);
      const o = this.o, S = o.subject;
      this.R = o.R || 15; this.bandR = o.band || 2; this.alt0 = o.alt || 10; this.altTol = o.altTol || 1; this.climb = o.climb || 0;
      this.aimY = o.aimY != null ? o.aimY : 1; this.ft = o.frameTol || 0.05;
      this.lapsDef = o.laps || [{ dir: o.dir || 1, deg: o.deg || 360 }];
      this.per = o.period || [40, 60];
      this.W = Object.assign({ frame: 30, radius: 25, alt: 15, speed: 15, smooth: 15 }, o.w || {});
      if (S) {
        if (S.type === 'vehicle') { ctx.R.add(this, { type: 'vehicle', x: o.x, z: o.z, yaw: S.yaw || 0, kind: S.kind || 'car', color: S.color != null ? S.color : 0xdc2626 }); ctx.env.taskColliders.push({ type: 'box', x: o.x, z: o.z, w: 2.4, d: 7.6, h: 2.8, yaw: S.yaw || 0, name: 'الهدف' }); }
        else if (S.type === 'person') ctx.R.add(this, { type: 'person', x: o.x, z: o.z, pose: 'stand' });
        else ctx.env.taskColliders.push({ type: 'cyl', x: o.x, z: o.z, r: 1.3, h: 4.5, name: 'التمثال' });
      }
      // شكل 'orbit' فيه تمثال بالنص → نستخدمه بس لما الهدف تمثال. غير كذا: أعلام كل 45° على الدائرة (مثل الأقماع)
      if (!S || S.type === 'statue') this.ring = ctx.R.add(this, { type: 'orbit', x: o.x, z: o.z, R: this.R, band: this.bandR });
      else {
        this.ring = { set() {} };
        if (o.markers !== false) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; ctx.R.add(this, { type: 'flag', x: o.x + Math.sin(a) * this.R, z: o.z - Math.cos(a) * this.R, color: k % 2 ? 0x22d3ee : 0xf97316, h: 2.2 }); }
      }
      this.li = 0; this.lapRes = []; this.startLap();
      this.rec = SCO() ? new (SCO().Recorder)(25, 4000) : null;
      this.fOk = 0; this.fT = 0; this.rS = SCO() ? new (SCO().Stat)() : null; this.aS = SCO() ? new (SCO().Stat)() : null;
      this.reticle = null; this._ret = { deg: 3, label: 'الهدف', ok: false };
      this._g = { orbit: { x: o.x, z: o.z, R: this.R, dir: 1, speed: 2, alt: this.alt0, aimY: this.aimY }, speed: 3 };
      this._map = [{ kind: 'orbit', x: o.x, z: o.z, r: this.R, state: 'next' }, S && S.type === 'vehicle' ? { kind: 'vehicle', x: o.x, z: o.z, state: 'next' } : { kind: 'beacon', x: o.x, z: o.z, state: 'next' }];
    }
    startLap() {
      const L = this.lapsDef[this.li];
      this.dir = L.dir < 0 ? -1 : 1; this.deg = L.deg || 360; this.on = false; this.sum = 0; this.last = null; this.lapT = 0;
      this.wS = SCO() ? new (SCO().Stat)() : null; this.wAcc = 0; this.wA0 = null; this.wT = 0;
    }
    altT() { return this.alt0 + this.climb * Math.abs(this.sum) * R2D / 360; }
    update(dt, ctx) {
      const d = ctx.drone, o = this.o;
      this.t += dt;
      const ang = U.bearing(o.x, o.z, d.p.x, d.p.z), rad = U.dist2(d.p.x, d.p.z, o.x, o.z), aT = this.altT();
      const radOk = Math.abs(rad - this.R) <= this.bandR, altOk = Math.abs(d.p.y - aT) <= this.altTol;
      const cam = ctx.camera(), pr = SCO().project(cam, o.x, this.aimY, o.z, PR), fe = SCO().framing(pr, 0, 0), framed = pr.inFrame && fe <= this.ft;
      this._ret.deg = SCO().fracDeg(this.ft, cam.vfovDeg); this._ret.ok = framed; this.reticle = this._ret;
      if (!this.on) {
        if (!d.onGround && radOk && altOk) { this.on = true; this.last = ang; this.wA0 = ang; this.wT = 0; }
      } else {
        const dA = U.wrap(ang - this.last); this.last = ang; this.lapT += dt;
        this.sum += dA;
        this.fT += dt; if (framed) this.fOk += dt;
        if (this.rS) this.rS.add(rad - this.R); if (this.aS) this.aS.add(d.p.y - aT);
        this.wT += dt;
        if (this.wT >= 0.5) { const w = U.wrap(ang - this.wA0) * R2D / this.wT; if (w * this.dir > 0 && this.wS) this.wS.add(Math.abs(w)); this.wA0 = ang; this.wT = 0; }
        this.trackF('pos', Math.abs(rad - this.R), this.bandR);
        this.trackF('alt', Math.abs(d.p.y - aT), this.altTol);
        this.trackF('frame', pr.inFrame ? 0 : 1, 0.5);
        if (this.rec) this.rec.update(dt, d, ctx.session.gimbal, ctx.controls, cam);
        if (this.sum * this.dir * R2D >= this.deg) {
          const per = this.lapT * 360 / this.deg;
          this.lapRes.push({ dir: this.dir, time: this.lapT, period: per, cv: this.wS ? this.wS.cv : 0 });
          if (ctx.say) ctx.say('لفة ' + (this.li + 1) + ' تمت (' + Math.round(per) + ' ث)');
          this.li++;
          if (this.li >= this.lapsDef.length) { if (this.fm) this.fm.flush(this.t); this.state = 'done'; return; }
          this.startLap(); ctx.stepDone();
        }
      }
      this.ring.set(radOk && altOk ? 'in' : 'out');
      this.progress = (this.li + U.clamp(this.sum * this.dir * R2D / this.deg, 0, 1)) / this.lapsDef.length;
      const b = this.baseHint(d), dirTxt = this.dir > 0 ? 'مع عقارب الساعة' : 'عكس عقارب الساعة';
      if (b) this.hint = b;
      else if (!radOk) this.hint = rad > this.R ? 'قرّب للدائرة (' + this.R + ' م)' : 'ابعد للدائرة (' + this.R + ' م)';
      else if (!altOk) this.hint = altAdvice(d.p.y, aT, 0).replace(' — ', '');
      else if (!framed) this.hint = 'خل الهدف في نص الكاميرا: اخلط الجنب (العصا اليمين) مع اللف (العصا اليسار)';
      else this.hint = 'ممتاز ✓ لف ' + dirTxt + ' بسرعة ثابتة (' + Math.round(this.progress * 100) + '%)';
      if (this.t > this.tl) this.fail('خلص الوقت');
    }
    score() {
      if (this.state !== 'done') return 0;
      const sc = SCO(), parts = {}, fr = this.fT > 0 ? this.fOk / this.fT : 0;
      parts.frame = sc.band(0.9 - fr, 0, 0.5);
      parts.radius = this.rS && this.rS.n ? sc.band(this.rS.rms, 0.5, 3) : 0;
      parts.alt = this.aS && this.aS.n ? sc.band(this.aS.rms, 0.25, 1.5) : 0;
      let sp = 0;
      for (const L of this.lapRes) {
        const p0 = this.per[0], p1 = this.per[1], ex = L.period < p0 ? (p0 - L.period) / p0 : L.period > p1 ? (L.period - p1) / p1 : 0;
        sp += 0.6 * sc.band(L.cv, 0.05, 0.3) + 0.4 * sc.band(ex, 0, 0.5);
      }
      parts.speed = this.lapRes.length ? sp / this.lapRes.length : 0;
      parts.smooth = this.smoothPart();
      return sc.combine(parts, this.W, this.fm);
    }
    smoothPart() {
      if (!this.rec || this.rec.n < 40) return 1;
      const v = this.rec.ldljWin('cam', 0, this.rec.n, 6); this.ldlj = v;
      return SCO().smooth(v, this.o.smoothRef != null ? this.o.smoothRef : -16, 8);
    }
    stats() { return { framed: Math.round(100 * (this.fT > 0 ? this.fOk / this.fT : 0)), radiusRms: this.rS && this.rS.n ? Math.round(this.rS.rms * 100) / 100 : null, altRms: this.aS && this.aS.n ? Math.round(this.aS.rms * 100) / 100 : null, laps: this.lapRes.map(L => ({ dir: L.dir, period: Math.round(L.period), cv: Math.round(L.cv * 1000) / 1000 })) }; }
    feedback() {
      const t = [], fr = this.fT > 0 ? this.fOk / this.fT : 0;
      t.push('الهدف في النص ' + Math.round(fr * 100) + '%' + (this.rS && this.rS.n ? ' • خطأ نص القطر ±' + this.rS.rms.toFixed(1) + ' م' : '') + this.lapRes.map(L => ' • لفة ' + Math.round(L.period) + ' ث').join(''));
      if (fr < 0.9) t.push('السر: العصا اليمين جنب + العصا اليسار لف بنفس الوقت وبكمية ثابتة');
      if (this.lapRes.some(L => L.cv > 0.15)) t.push('خل سرعة اللف ثابتة — لا تسرّع وتبطّي');
      return t;
    }
    guide(ctx) {
      const d = ctx.drone, g = this._g, O = g.orbit, rad = U.dist2(d.p.x, d.p.z, this.o.x, this.o.z);
      O.dir = this.dir; O.alt = this.altT(); O.R = this.R;
      const per = (this.per[0] + this.per[1]) / 2, sp = 2 * Math.PI * this.R / per;
      const ready = Math.abs(rad - this.R) <= this.bandR * 0.6 && Math.abs(d.p.y - O.alt) <= this.altTol * 0.6;
      O.speed = ready || this.on ? sp : 0;
      g.speed = 3;
      return g;
    }
    map() { return this._map; }
  }
  DS.OrbitCamTask = OrbitCamTask;

  // ---------------- 7) الهبوط على منصة تتحرك (شاحنة على الطريق) ----------------
  // o: {road:'loop', s0 (الافتراضي بداية الخط الجنوبي)، dir:1, speed:[2.8,5.6] | v, ramp:40, vehicle:{kind:'truck', color}, pad:{w:1.5, d:1.5, off:-1.1},
  //     tol:{pos:0.4, hs:0.5, vs:0.7}, maxGo:2, startR:30, label:'H'}
  class MovingLandingTask extends Task {
    constructor(o) { super(Object.assign({ title: 'الهبوط على منصة تتحرك', short: 'الهبوط المتحرك', timeLimit: 300 }, o)); }
    begin(ctx) {
      super.begin(ctx); this.initFaults(ctx);
      const o = this.o, road = getRoad(o.road), V = o.vehicle || { kind: 'truck' }, truck = (V.kind || 'truck') === 'truck';
      const s0 = o.s0 != null ? o.s0 : (road && road.id === 'loop' ? road.len - 135 : 0);
      this.mv = new Mover(Object.assign({}, o, { s0, vehicle: { kind: V.kind || 'truck', color: V.color != null ? V.color : 0x2563eb }, speed: o.speed != null ? o.speed : [2.8, 5.6], ramp: o.ramp || 40 }), ctx, this);
      this.padC = Object.assign({ w: 1.5, d: 1.5, off: truck ? -1.1 : 0 }, o.pad || {});
      this.top = (truck ? 1.33 : 1.55) + 0.12;
      this.tol = Object.assign({ pos: 0.4, hs: 0.5, vs: 0.7 }, o.tol || {});
      // noSense: حساسات العوائق ما تفرمل على الشاحنة المتحركة (وإلا ما يقدر يلحقها)
      this.bed = { type: 'box', landable: true, x: 0, z: 0, w: truck ? 2.3 : 1.8, d: truck ? 5.2 : 2.4, h: this.top, yaw: 0, vx: 0, vz: 0, name: 'منصة الهبوط المتحركة', noSense: true };
      this.cab = truck ? { type: 'box', x: 0, z: 0, w: 2.4, d: 2.2, h: 2.7, yaw: 0, name: 'كابينة الشاحنة', noSense: true } : null;
      ctx.env.taskColliders.push(this.bed); if (this.cab) ctx.env.taskColliders.push(this.cab);
      this.pc = { x: 0, z: 0 }; this.pcPrev = { x: 0, z: 0 };
      this.plat = ctx.R.add(this, { type: 'platform', x: 0, y: this.top, z: 0, w: this.padC.w, d: this.padC.d, yaw: 0, label: o.label || 'H' });
      this.phase = 'wait'; this.go = 0; this.near = false; this.td = null; this.res = null; this.desc = false;
      this._g = { x: 0, z: 0, alt: 3, vff: { x: 0, z: 0 }, yaw: null, speed: 5, vdown: null };
      this._gL = { descend: true };
      this._mapV = { kind: 'vehicle', x: 0, z: 0, state: 'next' }; this._map = [this._mapV];
      this.place(0);
    }
    place(dt) {
      const mv = this.mv, p = mv.p, fx = Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      this.pcPrev.x = this.pc.x; this.pcPrev.z = this.pc.z;
      this.pc.x = p.x + fx * this.padC.off; this.pc.z = p.z + fz * this.padC.off;
      const bo = this.cab ? -1.1 : 0;
      this.bed.x = p.x + fx * bo; this.bed.z = p.z + fz * bo; this.bed.yaw = p.yaw; this.bed.vx = mv.vel.x; this.bed.vz = mv.vel.z;
      if (this.cab) { this.cab.x = p.x + fx * 2.7; this.cab.z = p.z + fz * 2.7; this.cab.yaw = p.yaw; }
      this.plat.move(this.pc.x, this.top, this.pc.z, p.yaw);
      this._mapV.x = p.x; this._mapV.z = p.z;
    }
    update(dt, ctx) {
      const d = ctx.drone, o = this.o, mv = this.mv;
      this.t += dt;
      if (this.phase === 'wait' && !d.onGround && d.p.y > 2 && U.dist2(d.p.x, d.p.z, mv.p.x, mv.p.z) < (o.startR || 30)) {
        this.phase = 'chase'; mv.on = true; if (ctx.say) ctx.say('الشاحنة بدت تمشي — تعال من وراها وطابق سرعتك'); ctx.stepDone();
      }
      mv.update(dt); this.place(dt);
      const rx = d.p.x - this.pc.x, rz = d.p.z - this.pc.z, eh = Math.hypot(rx, rz), hr = d.p.y - this.top;
      const rvx = d.v.x - mv.vel.x, rvz = d.v.z - mv.vel.z, rv = Math.hypot(rvx, rvz);
      // محاولة هبوط ثم رجوع لفوق = Go-around
      if (!d.onGround) {
        if (hr < 2.2 && eh < 2) this.near = true;
        else if (this.near && hr > 4) { this.near = false; this.go++; if (this.go > (o.maxGo != null ? o.maxGo : 2)) this.fault('minor', 'goAround'); if (ctx.say) ctx.say('إعادة محاولة (Go-around) — زين إنك ما غامرت'); }
      }
      // اللمس
      const T = d.touchdown;
      if (d.onGround && T && !this.td && (this.phase === 'chase')) {
        this.td = T;
        if (T.on !== this.bed.name) return this.fail('نزلت على الأرض مو على المنصة');
        const pe = Math.hypot(T.x - this.pcPrev.x, T.z - this.pcPrev.z);
        this.res = { pos: pe, hs: T.hs, vs: T.vs };
        if (pe > this.tol.pos) this.fault('minor', 'landPos');
        if (T.hs > this.tol.hs) this.fault('major', 'hs');
        if (T.vs > this.tol.vs) this.fault('major', 'vs');
        this.phase = 'landed';
      }
      if (this.phase === 'landed' && d.onGround && !d.motors) { this.state = 'done'; return; }
      if (this.phase === 'landed' && !d.onGround) { this.phase = 'chase'; this.td = null; }
      this.progress = this.phase === 'wait' ? 0 : this.phase === 'chase' ? U.clamp(1 - eh / 30, 0, 0.8) : 0.95;
      const b = this.baseHint(d);
      if (b && this.phase !== 'landed') this.hint = b;
      else if (this.phase === 'wait') this.hint = goHint(d, mv.p.x, mv.p.z, 'روح ورا الشاحنة');
      else if (this.phase === 'landed') this.hint = 'خل ' + THR() + ' تحت لين تطفي المحركات';
      else if (eh > 2.5) this.hint = 'الحق الشاحنة: تعال من وراها وطابق سرعتها (' + Math.round(eh) + ' م)';
      else if (rv > 0.6) this.hint = 'طابق سرعتك مع الشاحنة أول (الفرق ' + rv.toFixed(1) + ' م/ث)';
      else this.hint = hr > 0.5 ? 'أنت فوق المنصة ✓ نزّل بهدوء (أقل من 0.5 م/ث)' : 'آخر شوي… ثابت';
      if (this.t > this.tl) this.fail('خلص الوقت');
    }
    score() {
      if (this.state !== 'done' || !this.res) return 0;
      const sc = SCO(), r = this.res, parts = {
        pos: sc.band(r.pos, 0.2, 0.9), hs: sc.band(r.hs, 0.25, 1.2), vs: sc.band(r.vs, 0.35, 1.3),
        go: this.go <= (this.o.maxGo != null ? this.o.maxGo : 2) ? 1 : 0.5
      };
      return sc.combine(parts, { pos: 45, hs: 25, vs: 20, go: 10 }, this.fm);
    }
    stats() { const r = this.res; return { pos: r ? Math.round(r.pos * 100) / 100 : null, hs: r ? Math.round(r.hs * 100) / 100 : null, vs: r ? Math.round(r.vs * 100) / 100 : null, goArounds: this.go, time: Math.round(this.t) }; }
    feedback() {
      const t = []; if (!this.res) return t;
      t.push('البعد عن النص ' + this.res.pos.toFixed(2) + ' م • السرعة الجانبية ' + this.res.hs.toFixed(2) + ' م/ث • النزول ' + this.res.vs.toFixed(2) + ' م/ث');
      if (this.res.hs > this.tol.hs) t.push('طابق سرعة الشاحنة تماماً قبل لا تنزل');
      if (this.res.vs > this.tol.vs) t.push('آخر متر انزل أبطأ');
      return t;
    }
    guide(ctx) {
      const d = ctx.drone, g = this._g, mv = this.mv;
      if (this.phase === 'landed' || (d.onGround && this.td)) return this._gL;
      const fx = Math.sin(mv.p.yaw), fz = -Math.cos(mv.p.yaw);
      const rx = d.p.x - this.pc.x, rz = d.p.z - this.pc.z, eh = Math.hypot(rx, rz);
      const rv = Math.hypot(d.v.x - mv.vel.x, d.v.z - mv.vel.z);
      const straight = Math.abs(mv.yawRate) < 0.03;
      g.vff.x = mv.vel.x; g.vff.z = mv.vel.z; g.yaw = mv.p.yaw; g.vdown = null;
      if (this.phase === 'wait') { g.x = this.pc.x - fx * 8; g.z = this.pc.z - fz * 8; g.alt = this.top + 4; g.speed = 6; g.vff.x = 0; g.vff.z = 0; return g; }
      if (this.desc && (eh > 0.9 || !straight)) this.desc = false;
      else if (!this.desc && eh < 0.45 && rv < 0.35 && straight) this.desc = true;
      const lead = 0;
      g.x = this.pc.x + mv.vel.x * lead; g.z = this.pc.z + mv.vel.z * lead; g.speed = eh > 4 ? 5 : 2;
      if (!this.desc) {
        if (eh > 3) { g.x -= fx * 3; g.z -= fz * 3; }   // من ورا
        g.alt = this.top + 2.5;
      } else { g.alt = this.top - 0.6; g.vdown = 0.45; }
      return g;
    }
    map() { return this._map; }
  }
  DS.MovingLandingTask = MovingLandingTask;

  // ---------------- 8) حركات FPV (فليب، رول، Split-S، Power loop، دوران مقلوب) ----------------
  // الكشف من سرعات الدوران (fpv.md §8): نجمع زوايا الدوران (roll/pitch/yaw) باستمرار، ونحط "مراسي" وقت الهدوء (الدوران < 60°/ث).
  // أول ما يهدأ بعد دوران: ندوّر ورا على أقرب مرساة تخلّي الفرق = حركة كاملة (فليب 360، Split-S = 180+180، ...). كذا الرجّات والتوقف القصير ما يخربون الكشف
  // o: {tricks:[{type:'flip'|'roll'|'splitS'|'powerLoop'|'yawSpin', dir?:1|-1, n:1}], minAlt:10, order:'seq'|'any', at:{x,z,yaw}, altLoss:3, passScore:50, stickHints:true}
  const TRICK_AR = { flip: 'فليب', roll: 'رول', splitS: 'Split-S', powerLoop: 'باور لوب', yawSpin: 'دوران مقلوب', messy: 'حركة مو نظيفة' };
  const trickName = (ty, dir) => TRICK_AR[ty] + (ty === 'flip' ? (dir < 0 ? ' لورا' : dir > 0 ? ' لقدام' : '') : ty === 'roll' ? (dir < 0 ? ' لليسار' : dir > 0 ? ' لليمين' : '') : '');
  class TrickTask extends Task {
    constructor(o) { super(Object.assign({ title: 'حركات FPV', short: 'الحركات', timeLimit: 120 + 45 * ((o && o.tricks && o.tricks.reduce((a, r) => a + (r.n || 1), 0)) || 1) }, o)); }
    begin(ctx) {
      super.begin(ctx); this.initFaults(ctx);
      const o = this.o, d = ctx.drone;
      this.req = (o.tricks || [{ type: 'flip' }]).map(r => ({ type: r.type, dir: r.dir || 0, n: r.n || 1, done: 0, best: 0, scores: [] }));
      this.minAlt = o.minAlt != null ? o.minAlt : 10; this.altLoss = o.altLoss || 3;
      this.at = Object.assign({ x: d.p.x, z: d.p.z - 15, yaw: d.yaw }, o.at || {});
      this.TH = { p: 0, q: 0, r: 0, inv: 0 };                    // زوايا تراكمية (درجات)
      this.anc = []; for (let i = 0; i < 120; i++) this.anc.push({ t: 0, p: 0, q: 0, r: 0, inv: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, ux: 0, uy: 1, uz: 0, tilt: 0 });
      this.na = 0; this.ai = 0; this.lastAnc = -9;
      this.hy = new Float32Array(240); this.ht = new Float64Array(240); this.hw = new Float32Array(240); this.hn = 0; this.hi = 0; this.hT = 0;   // ارتفاع + سرعة الدوران 20 هرتز (12 ث)
      this.qs = { t: 0, p: 0, q: 0, r: 0, inv: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, tilt: 0, ux: 0, uy: 1, uz: 0 }; this.qT = 0; this.evalA = false; this.evalB = false;
      this.win = { open: false };   // للتوافق (تلميح: هل فيه دوران الحين)
      this._A = {}; this.last = null; this.phase = 'climb'; this.phT = 0; this.trk = null; this.attempts = 0;
      this._g = { x: 0, z: 0, alt: 0, yaw: 0, speed: 4 };
      this._sh = { L: null, R: { x: 0, y: 0 }, text: '' };
      this._map = [{ kind: 'zone', x: this.at.x, z: this.at.z, r: 3, state: 'next' }];
    }
    curReq() { for (let i = 0; i < this.req.length; i++) if (this.req[i].done < this.req[i].n) return this.req[i]; return null; }
    update(dt, ctx) {
      const d = ctx.drone, W = this.win;
      this.t += dt; this.phT += dt;
      const p = -d.w.z * R2D, q = -d.w.x * R2D, r = -d.w.y * R2D;
      const A = DS.Q ? DS.Q.axes(d.q, this._A) : null, uy = A ? A.uy : 1;
      const pq = Math.max(Math.abs(p), Math.abs(q)), TH = this.TH;
      TH.p += p * dt; TH.q += q * dt; TH.r += r * dt; if (uy < -0.85) TH.inv += r * dt;
      this.hT += dt;
      if (this.hT >= 0.05) { this.hT = 0; this.hy[this.hi] = d.p.y; this.ht[this.hi] = this.t; this.hw[this.hi] = pq; this.hi = (this.hi + 1) % this.hy.length; if (this.hn < this.hy.length) this.hn++; }
      if (d.onGround) { this.na = 0; this.qT = 0; }
      else {
        const quiet = pq < 60 && (Math.abs(r) < 120 || uy > -0.5);
        if (quiet) {
          if (this.qT === 0) {   // بداية الهدوء = نهاية الحركة
            const Q = this.qs; Q.t = this.t; Q.p = TH.p; Q.q = TH.q; Q.r = TH.r; Q.inv = TH.inv; Q.x = d.p.x; Q.y = d.p.y; Q.z = d.p.z; Q.vx = d.v.x; Q.vz = d.v.z;
            Q.tilt = 999; this.evalA = false; this.evalB = false;
          }
          this.qT += dt;
          const tl = Math.acos(U.clamp(uy, -1, 1)) * R2D;
          if (tl < this.qs.tilt && A) { const Q = this.qs; Q.tilt = tl; Q.ux = A.ux; Q.uy = A.uy; Q.uz = A.uz; }   // أقل ميلان وقت الهدوء
          if (!this.evalA && this.qT >= 0.15) { this.evalA = true; if (this.evaluate(d, ctx, false)) this.evalB = true; }
          if (!this.evalB && this.qT >= 0.6) { this.evalB = true; this.evaluate(d, ctx, true); }
          if (this.t - this.lastAnc >= 0.1) {   // مرساة جديدة
            this.lastAnc = this.t;
            const a = this.anc[this.ai]; this.ai = (this.ai + 1) % this.anc.length; if (this.na < this.anc.length) this.na++;
            a.t = this.t; a.p = TH.p; a.q = TH.q; a.r = TH.r; a.inv = TH.inv; a.x = d.p.x; a.y = d.p.y; a.z = d.p.z; a.vx = d.v.x; a.vz = d.v.z;
            if (A) { a.ux = A.ux; a.uy = A.uy; a.uz = A.uz; } a.tilt = tl;
          }
        } else this.qT = 0;
      }
      W.open = !d.onGround && this.qT === 0;
      // المراحل (للتلميح وللطيار الآلي)
      const R = this.curReq();
      if (!R) { this.state = 'done'; return; }
      let pd = 0, pn = 0; for (let i = 0; i < this.req.length; i++) { pd += Math.min(this.req[i].done, this.req[i].n); pn += this.req[i].n; }
      this.progress = pn ? pd / pn : 1;
      const calm = Math.hypot(d.v.x, d.v.z) < 2 && Math.abs(d.v.y) < 1;   // يبدأ من طيران بطيء ومستوي (مو لازم وقفة تامة في Acro)
      if (this.phase === 'climb' && !d.onGround && d.p.y > this.minAlt + 3 && this.phT > 1.5 && calm && !W.open) { this.phase = 'ready'; this.phT = 0; }
      if (this.phase === 'recover' && this.phT > 1.5 && d.p.y > this.minAlt + 2 && calm && !W.open) { this.phase = 'ready'; this.phT = 0; }
      if (this.phase === 'ready' && this.phT > 7 && !W.open) { this.phase = 'recover'; this.phT = 0; this.trk = null; }   // ما صارت: نعيد
      const b = this.baseHint(d), nm = trickName(R.type, R.dir);
      if (b) this.hint = b;
      else if (this.flashT != null && this.t - this.flashT < 3) this.hint = this.flash;
      else if (d.mode !== 'ACRO' && (R.type !== 'yawSpin')) this.hint = 'حوّل لوضع ACRO (السهم فوق/تحت) عشان تقدر تسوي ' + nm;
      else if (d.p.y < this.minAlt) this.hint = 'اطلع فوق ' + this.minAlt + ' م قبل الحركة (الأمان أول)';
      else this.hint = 'سوّ ' + nm + ' (' + (R.done + 1) + '/' + R.n + ') — ' + this.howTo(R);
      if (this.o.stickHints !== false && ctx.session) { this.setSticks(R); ctx.session.stickHint = this._sh; }
      if (this.t > this.tl) this.fail('خلص الوقت');
    }
    howTo(R) {
      switch (R.type) {
        case 'flip': return 'دفعة ثروتل صغيرة، بعدين ' + PIT() + ' ' + (R.dir < 0 ? 'لورا' : 'لقدام') + ' للآخر والثروتل تحت، وارجع ثروتل لما يكمّل';
        case 'roll': return 'دفعة ثروتل، العصا اليمين ' + (R.dir < 0 ? 'يسار' : 'يمين') + ' للآخر، وثروتل لما يرجع مستوي';
        case 'splitS': return 'وأنت ماشي لقدام: نص رول لين ينقلب، بعدين اسحب العصا لورا لين يرجع مستوي بالاتجاه المعاكس';
        case 'powerLoop': return 'وأنت مسرع لقدام: اسحب العصا لورا بثبات مع ثروتل قوي، خفف الثروتل فوق، وارجع قوي بالطلعة';
        case 'yawSpin': return 'اقلبه (نص رول)، لف بالعصا اليسار وهو مقلوب، وبعدين رجّعه';
      }
      return '';
    }
    setSticks(R) {
      const s = this._sh; s.L = null; s.R.x = 0; s.R.y = 0;
      if (R.type === 'flip') s.R.y = R.dir < 0 ? -1 : 1;
      else if (R.type === 'roll') s.R.x = R.dir < 0 ? -1 : 1;
      else if (R.type === 'splitS') { s.R.x = 1; s.R.y = -0.6; }
      else if (R.type === 'powerLoop') s.R.y = -0.8;
      else if (R.type === 'yawSpin') s.R.x = 1;
      s.text = trickName(R.type, R.dir);
    }
    // ندوّر ورا على مرساة تبدأ منها حركة كاملة. final = بعد 0.6 ث هدوء (لو ما لقينا شي ودورنا كثير = حركة مو نظيفة)
    evaluate(d, ctx, final) {
      const Q = this.qs, N = this.anc.length;
      let oldest = null, best = null, bestA = null;
      for (let k = 1; k <= this.na; k++) {
        const a = this.anc[(this.ai - k + N * 2) % N];
        if (a.t >= Q.t - 0.02) continue;                // مراسي الهدوء الحالي
        if (Q.t - a.t > 7) break;
        oldest = a;
        const res = this.classify(a, Q);
        if (res && (!best || res.score > best.score || (res.score === best.score && res.clean && !best.clean))) { best = res; bestA = a; }
      }
      // نختار البداية اللي تعطي أنظف حركة. بدري (0.15 ث) نقبل بس النظيفة — غيرها ننتظر يمكن الدوران يكمّل (مثل آخر اللوب البطيء)
      if (best && (final || (best.score >= 60 && best.clean))) { this.accept(best, bestA, Q, d, ctx); this.na = 0; return true; }
      if (final && oldest && Math.max(Math.abs(Q.p - oldest.p), Math.abs(Q.q - oldest.q)) > 270) {
        this.accept({ type: 'messy', dir: 0, score: 0, why: '', count: 1, ap: Math.abs(Q.p - oldest.p), aq: Math.abs(Q.q - oldest.q), inv: 0, loss: 0, dur: Q.t - oldest.t, vrev: 1, endErr: Q.tilt, close: 0, rise: 0 }, oldest, Q, d, ctx);
        this.na = 0; return true;
      }
      return false;
    }
    // تصنيف مقطع (من المرساة a لبداية الهدوء Q) → {type, dir, score, why, count, ...} أو null
    classify(a, Q) {
      const dP = Q.p - a.p, dQ = Q.q - a.q, dInv = Q.inv - a.inv, ap = Math.abs(dP), aq = Math.abs(dQ), ainv = Math.abs(dInv);
      let ymin = Math.min(a.y, Q.y), ymax = Math.max(a.y, Q.y), w0 = Q.t, w1 = a.t;
      for (let k = 0; k < this.hn; k++) {
        const tt = this.ht[k];
        if (tt >= a.t && tt <= Q.t) { const y = this.hy[k]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; if (this.hw[k] > 150) { if (tt < w0) w0 = tt; if (tt > w1) w1 = tt; } }
      }
      const dur = w1 > w0 ? w1 - w0 + 0.1 : Q.t - a.t;   // وقت الدوران الفعلي (فوق 150°/ث)
      const loss = Math.max(0, a.y - ymin), rise = ymax - a.y;
      const v0 = Math.hypot(a.vx, a.vz), v1 = Math.hypot(Q.vx, Q.vz);
      const vrev = v0 > 3 && v1 > 2 ? (a.vx * Q.vx + a.vz * Q.vz) / (v0 * v1) : 1;
      const close = Math.hypot(Q.x - a.x, Q.y - a.y, Q.z - a.z);
      // ميلان النهاية مقارنة بالبداية (في الهواء القوي الدرون أصلاً مايل) — للـ Split-S/اللوب: فرق الميلان بس (الاتجاه يتغير)
      const relUp = Math.acos(U.clamp(a.ux * Q.ux + a.uy * Q.uy + a.uz * Q.uz, -1, 1)) * R2D, relTilt = Math.abs((Q.tilt > 180 ? a.tilt : Q.tilt) - a.tilt);
      let endErr = relUp;
      const near = (x, nom, tol) => Math.abs(x - nom) <= tol;
      let type = null, dir = 0, sc = 0, why = '', count = 1;
      const gen = (main, nom, off, tNom) => 100 - 0.6 * Math.abs(main - nom) - 0.8 * off - 20 * Math.max(0, loss - 1) - 40 * Math.max(0, dur - tNom) - Math.max(0, endErr - 15);
      if (ainv >= 300 && near(ap, 360, 60) && aq < 80) {
        type = 'yawSpin'; dir = Math.sign(dInv); count = Math.max(1, Math.round(ainv / 360));
        sc = 100 - 0.3 * Math.abs(ainv - 360 * count) - 20 * Math.max(0, loss - 3) - Math.max(0, endErr - 15);
        count = 1;
      } else if (near(ap, 180, 40) && near(aq, 180, 45) && dQ < 0 && vrev < 0) {
        type = 'splitS'; dir = Math.sign(dP); endErr = relTilt;
        // Split-S: نزول الارتفاع طبيعي فيه — المهم الاتجاه ينعكس وما تقرب من الأرض (أقل من 3 م)
        sc = 100 - 0.6 * Math.max(0, Math.abs(ap - 180) - 20) - 0.6 * Math.max(0, Math.abs(aq - 180) - 25) - 40 * Math.max(0, dur - 2.5) - (vrev < -0.8 ? 0 : 30) - Math.max(0, endErr - 20) - (ymin < 3 ? 40 : 0);
        if (vrev >= -0.8) why = 'ما رجعت بالاتجاه المعاكس كامل';
        if (ymin < 3) why = 'قربت من الأرض!';
      } else if (aq >= 310 && near(aq, 360 * Math.round(aq / 360), 50) && ap < 70) {
        count = Math.round(aq / 360);
        if (dQ < 0 && count === 1 && (rise > 2.5 || dur > 1.4)) {
          type = 'powerLoop'; dir = -1; endErr = relTilt;
          sc = 100 - 0.6 * Math.max(0, Math.abs(aq - 360) - 10) - 0.5 * Math.max(0, ap - 15) - 10 * Math.max(0, close - 3) - 20 * Math.max(0, loss - 2) - 30 * Math.max(0, dur - 4) - Math.max(0, endErr - 15);
          if (close > 3) why = 'النهاية بعيدة عن البداية (' + close.toFixed(1) + ' م)';
        } else { type = 'flip'; dir = Math.sign(dQ); sc = gen(aq, 360 * count, ap, 1.0 * count); }
      } else if (ap >= 310 && near(ap, 360 * Math.round(ap / 360), 50) && aq < 70) { count = Math.round(ap / 360); type = 'roll'; dir = Math.sign(dP); sc = gen(ap, 360 * count, aq, 1.0 * count); }
      if (!type) return null;
      const main = type === 'roll' ? ap : type === 'yawSpin' ? ainv : type === 'splitS' ? (ap + aq) / 2 : aq, nom = type === 'splitS' ? 180 : 360 * Math.max(1, Math.round(main / 360));
      return { type, dir, score: U.clamp(Math.round(sc), 0, 100), why, count, ap, aq, inv: ainv, loss, dur, vrev, endErr, close, rise, clean: Math.abs(main - nom) <= 25 };
    }
    accept(res, a, Q, d, ctx) {
      const type = res.type, dir = res.dir, sc = res.score;
      let why = res.why;
      if (res.loss > this.altLoss && type !== 'splitS' && type !== 'messy') { why = why || 'نزلت ' + res.loss.toFixed(1) + ' م'; this.fault('minor', 'trickAlt'); }
      this.last = res;
      this.attempts++;
      const tooLow = a.y < this.minAlt;
      if (tooLow) this.fault('minor', 'lowAlt');
      const R = this.curReq();
      const pass = sc >= (this.o.passScore || 50) && !tooLow;
      let matched = null;
      for (let c = 0; c < res.count; c++) {   // فليب مزدوج = اثنين
        const R2 = this.curReq();
        const match = this.o.order === 'any' ? this.req.find(x => x.done < x.n && x.type === type && (!x.dir || x.dir === dir)) : (R2 && R2.type === type && (!R2.dir || R2.dir === dir) ? R2 : null);
        if (!match) break;
        matched = match;
        if (pass) { match.done++; match.scores.push(sc); if (sc > match.best) match.best = sc; } else { match.scores.push(sc); break; }
      }
      this.flash = (type === 'messy' ? '✗ ' + TRICK_AR.messy : (pass && matched ? '✓ ' : '') + (res.count > 1 ? res.count + '× ' : '') + trickName(type, dir) + ' — ' + sc + '/100') + (why ? ' (' + why + ')' : '') + (tooLow ? ' ⚠️ واطي!' : '') + (!matched && type !== 'messy' && R ? ' • المطلوب: ' + trickName(R.type, R.dir) : '');
      this.flashT = this.t;
      if (ctx.say && type !== 'messy') ctx.say(pass && matched ? trickName(type, dir) + ' نظيف! ' + sc : this.flash);
      this.phase = 'recover'; this.phT = 0; this.trk = null;
    }
    score() {
      if (this.state !== 'done') return 0;
      let s = 0, n = 0;
      for (const r of this.req) { const sc = r.scores.filter(x => x >= 0).sort((a, b) => b - a).slice(0, r.n); s += sc.reduce((a, b) => a + b, 0); n += r.n; }
      return U.clamp(Math.round((n ? s / n : 0) - this.penalty()), 0, 100);
    }
    stats() { return { req: this.req.map(r => ({ type: r.type, dir: r.dir, done: r.done, n: r.n, best: r.best })), attempts: this.attempts, last: this.last ? { type: this.last.type, dir: this.last.dir, score: this.last.score } : null }; }
    feedback() {
      const t = [this.req.map(r => trickName(r.type, r.dir) + ' ' + r.done + '/' + r.n + (r.best ? ' (أفضل ' + r.best + ')' : '')).join(' • ')];
      if (this.attempts > this.req.reduce((a, r) => a + r.n, 0) * 2) t.push('خذ وقتك: ارجع مستوي واطلع ارتفاع قبل كل محاولة');
      if (this.fm && this.fm.minor) t.push('الحركات تبدأ من ارتفاع آمن، والثروتل يرجع بسرعة بعد اللفة عشان ما ينزل');
      return t;
    }
    guide(ctx) {
      const d = ctx.drone, g = this._g, R = this.curReq();
      if (!R) return null;
      const hold = () => {
        const c = this.phase === 'climb';
        g.x = c ? this.at.x : (this._hx != null ? this._hx : d.p.x); g.z = c ? this.at.z : (this._hz != null ? this._hz : d.p.z);
        g.alt = Math.max(this.minAlt + 8, 15); g.yaw = c || this._hy == null ? this.at.yaw : this._hy; g.speed = 4; return g;
      };
      if (this.phase === 'ready' && d.mode !== 'ACRO' && R.type !== 'yawSpin' && d.profile.kind === 'fpv') { hold(); g.press = this._pUp || (this._pUp = { UP: true }); return g; }
      g.press = null;
      if (this.phase !== 'ready') {
        if (this.phase === 'recover' && this.phT < 0.05) { this._hx = d.p.x; this._hz = d.p.z; this._hy = d.yaw; }
        return hold();
      }
      if (!this.trk) this.trk = { trick: { type: R.type, dir: R.dir || (R.type === 'flip' || R.type === 'roll' || R.type === 'splitS' || R.type === 'yawSpin' ? 1 : -1), turns: 1 } };
      return this.trk;
    }
    map() { return this._map; }
  }
  DS.TrickTask = TrickTask;

  // مصانع مختصرة للمحتوى: DS.mk2.capture(o) → () => new CaptureTask(o)
  DS.mk2 = {
    capture: o => () => new CaptureTask(o), timeTrial: o => () => new TimeTrialTask(o), inspect: o => () => new InspectTask(o), photo: o => () => new PhotoTask(o),
    search: o => () => new SearchTask(o), track: o => () => new TrackTask(o), orbitCam: o => () => new OrbitCamTask(o), movingLand: o => () => new MovingLandingTask(o),
    trick: o => () => new TrickTask(o)
  };
})();
