// "المحترف": طيار آلي يحرك العصي نفسها (للعرض والاختبار الذاتي) — للدرون العادي (DJI) والـ FPV
// التوجيه من المهمة task.guide(ctx):
//   {x,z,alt,yaw,speed,vdown,vff:{x,z}}  روح لنقطة/ارتفاع/اتجاه      {descend:true}  انزل
//   {raw:{thr,yaw,pitch,roll,throttle01,lt,rt}}  عصي مباشرة            {press:{BTN:true}}  ضغطة
//   {hold:{BTN:sec}}  اضغط مطوّل   {holdA:true}   {none:true}   {decide}   {shutter:true}
//   {trick:{type:'flip'|'roll'|'splitS'|'powerLoop'|'yawSpin', dir, turns}}  حركات FPV (Acro)
//   الكاميرا (v2):
//   {gimbal:deg, gimbalFF}            زاوية الجيمبل (LT/RT) — الدرون العادي بس
//   {zoom:z}                          زوم (LB مطوّل + LT/RT)
//   {aim:{x,y,z}}                     يوجّه الكاميرا على نقطة (اللف + الجيمبل) إلا إذا yaw/gimbal محددين
//   {yawFF:rad/s}                     تغذية أمامية للف (تتبع هدف يتحرك)
//   {orbit:{x,z,R,dir,speed,alt?,aimY?,aim?}}  دوران حول نقطة والكاميرا عليها (dir 1 = مع عقارب الساعة)
//   {shutter:true, shotGap}           تصوير (أقل فرق بين الصور shotGap ث، الافتراضي 0.8)
//   ملاحظة: الطيار الآلي يطلع عصي وأزرار بس — ما يغيّر حالة الدرون أبداً
(function () {
  const DS = window.DS, U = DS.U, G = 9.81, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const Q = DS.Q;

  class Autopilot {
    constructor(headless) {
      this.headless = headless; this.t = 0; this.lastPress = -10; this.lastShot = -10; this.decT = 0; this.hold = null; this.aT = 0;
      this.out = { thr: 0, yaw: 0, pitch: 0, roll: 0, throttle01: undefined, press: {}, held: undefined, holdA: false, lt: 0, rt: 0 };
      this._held = {}; this._btn = {}; this._w = { x: 0, y: 0, z: 0, gx: 0, gz: 0 };
      this._A = {}; this._qd = { x: 0, y: 0, z: 0, w: 1 }; this._qe = { x: 0, y: 0, z: 0, w: 1 };
      this.trk = null; this.trickState = null; this.trickDone = false;
      this._gx = { x: null, z: null, alt: null, yaw: null, yawFF: 0, speed: 3, vdown: null, vff: { x: 0, z: 0 }, gimbal: null, zoom: null, descend: false };
      this._lb = false; this._lbRel = 0;
    }
    _reset() {
      const o = this.out;
      o.thr = 0; o.yaw = 0; o.pitch = 0; o.roll = 0; o.throttle01 = undefined; o.holdA = false; o.lt = 0; o.rt = 0; o.held = undefined;
      for (const k in o.press) delete o.press[k];
      for (const k in this._held) delete this._held[k];
      return o;
    }

    compute(dt, s) {
      this.t += dt;
      const out = this._reset();
      if (s.ended) return out;
      const d = s.drone, task = s.task, ctx = s.ctx(), fpv = d.profile.kind === 'fpv';
      let g = (!task || s.wait > 0) ? null : task.guide(ctx);

      // سؤال "وش تسوي؟": يجاوب الصح وبعدين يكمل
      if (g && g.decide) {
        this.decT += dt;
        const delay = this.headless ? 0 : (g.decide.chosen < 0 ? 1.8 : 3);
        if (this.decT >= delay) {
          this.decT = 0;
          if (g.decide.chosen < 0) task.answer(g.decide.c); else task.ack(ctx);
        }
        return out;
      }
      this.decT = 0;

      // فك LB بعد الزوم (لازم الجلسة تشوف LB مفكوك وهي مو واقفة)
      if (this._lbRel > 0 && !s.frozen) { this._lbRel--; out.held = this._held; }
      if (!g) {
        if (this._lb) this._lbOff(out);
        if (d.onGround) { this._btnReset(); return out; }
        if (!this.hold) this.hold = { x: d.p.x, z: d.p.z, alt: Math.max(d.p.y, 1.5) };
        g = this.hold;
      } else if (g !== this.hold) this.hold = null;
      if (g.aim || g.orbit) g = this._expand(d, g, fpv);

      // أزرار مطوّلة / تصوير / الكاميرا
      this._buttons(dt, g, out);
      this._camera(d, s, g, out, fpv);
      if (g.shutter && this.t - this.lastShot > (g.shotGap || 0.8)) { this.lastShot = this.t; out.press.RB = true; }
      if (g.raw) {
        const r = g.raw;
        for (const k in r) { if (k === 'press') Object.assign(out.press, r.press); else out[k] = r[k]; }
        return out;
      }
      if (g.press) {
        if (this.t - this.lastPress > 1.2) { this.lastPress = this.t; Object.assign(out.press, g.press); }
      }
      if (g.holdA) {   // يضغط A ثانية ويفك شوي (مثل الإنسان)
        this.aT += dt;
        if (this.aT > 1.1) { if (this.aT > 1.5) this.aT = 0; return out; }
        out.holdA = true; return out;
      }
      this.aT = 0;
      if (g.none) return out;
      const flies = g.x != null || g.alt != null || g.descend || g.yaw != null || g.vff || g.trick;
      if (!flies) {
        if (!fpv || d.onGround) return out;   // الدرون العادي يثبت لحاله
        if (!this.hold) this.hold = { x: d.p.x, z: d.p.z, alt: Math.max(d.p.y, 1.5) };
        g = this.hold;
      }

      // تشغيل المحركات (CSC) والإقلاع
      if (!d.motors && d.onGround) {
        if (g.descend || (g.alt != null && g.alt < 0.3)) return out;
        out.thr = -1; out.pitch = -1; out.yaw = 1; out.roll = -1; if (fpv) out.throttle01 = 0;
        return out;
      }
      if (d.onGround && d.motors) {
        if (g.descend || (g.alt != null && g.alt < 0.3)) {
          out.thr = -1;
          if (fpv) { out.throttle01 = 0; out.holdA = true; }   // FPV ما يطفي لحاله: يطفيه (DISARM) بـ A مطوّل
          return out;
        }
        if (fpv) { out.throttle01 = U.clamp(d.hoverThr + 0.18, 0, 1); out.thr = DS.PhysRates.invThrottle(out.throttle01, d.hoverThr, 0.45); }
        else out.thr = 0.8;
        return out;
      }
      if (fpv) {
        if (g.trick && this.trick(dt, d, s, g, out)) return out;
        return this.flyFpv(dt, d, s, g, out);
      }
      return this.fly(d, s, g, out);
    }

    // أزرار مطوّلة: hold:{B:1.2} → يضغط مطوّل، يفك، ويعيد إذا لزم
    _buttons(dt, g, out) {
      const H = g.hold;
      if (!H) { this._btnReset(); return; }
      for (const k in this._btn) if (!(k in H)) delete this._btn[k];
      for (const k in H) {
        const b = this._btn[k] || (this._btn[k] = { t: 0, cool: 0 });
        if (b.cool > 0) { b.cool -= dt; continue; }
        if (b.t === 0) out.press[k] = true;
        b.t += dt;
        if (b.t <= (+H[k] || 1)) { this._held[k] = true; out.held = this._held; if (k === 'A') out.holdA = true; }
        else { b.t = 0; b.cool = 0.8; }
      }
    }
    _btnReset() { for (const k in this._btn) delete this._btn[k]; }

    // aim / orbit → مكان + سرعة + اتجاه + جيمبل (في كائن ثابت بدون إنشاء)
    _expand(d, g, fpv) {
      const x = this._gx, o = g.orbit;
      x.x = g.x != null ? g.x : null; x.z = g.z != null ? g.z : null; x.alt = g.alt != null ? g.alt : null;
      x.yaw = g.yaw != null ? g.yaw : null; x.yawFF = g.yawFF || 0; x.speed = g.speed || 3; x.vdown = g.vdown || null;
      x.descend = !!g.descend; x.gimbal = g.gimbal != null ? g.gimbal : null; x.zoom = g.zoom != null ? g.zoom : null;
      x.vff.x = g.vff ? g.vff.x || 0 : 0; x.vff.z = g.vff ? g.vff.z || 0 : 0;
      x.shutter = !!g.shutter; x.shotGap = g.shotGap; x.hold = g.hold; x.press = g.press; x.gimbalFF = g.gimbalFF || 0;
      x.raw = g.raw; x.none = g.none; x.holdA = g.holdA; x.trick = g.trick;
      let ax = null, ay = 0, az = 0;
      if (o) {
        const R = Math.max(1, o.R || 10), dir = o.dir < 0 ? -1 : 1, sp = o.speed != null ? o.speed : 2.5;
        const a = U.bearing(o.x, o.z, d.p.x, d.p.z), sa = Math.sin(a), ca = Math.cos(a);
        x.x = o.x + sa * R; x.z = o.z - ca * R;                      // أقرب نقطة على الدائرة
        x.vff.x += ca * dir * sp; x.vff.z += sa * dir * sp;            // المماس (مع عقارب الساعة = الزاوية تزيد)
        if (o.alt != null) x.alt = o.alt;
        if (g.speed == null) x.speed = 2.5;
        if (o.aim !== false) { ax = o.x; ay = o.aimY != null ? o.aimY : 1; az = o.z; if (g.yawFF == null) x.yawFF = dir * sp / R; }
      }
      if (g.aim) { ax = g.aim.x; ay = g.aim.y != null ? g.aim.y : 0; az = g.aim.z; }
      if (ax != null) {
        const dx = ax - d.p.x, dz = az - d.p.z, dh = Math.hypot(dx, dz), dy = ay - (d.p.y - 0.03);
        if (x.yaw == null && dh > 0.4) x.yaw = Math.atan2(dx, -dz);
        if (x.yaw == null) x.yaw = d.yaw;
        if (x.gimbal == null && !fpv) x.gimbal = Math.atan2(dy, Math.max(dh, 1e-3)) * R2D;
      }
      return x;
    }
    // الجيمبل والزوم (LT/RT، و LB مطوّل للزوم). الـ FPV كاميرته ثابتة
    _camera(d, s, g, out, fpv) {
      const C = d.profile.cam;
      if (fpv || !C) { if (this._lb) this._lbOff(out); return; }
      if (g.zoom != null && (C.maxZoom || 1) > 1) {
        const zt = U.clamp(g.zoom, 1, C.maxZoom), e = Math.log(zt / Math.max(1, s.zoom || 1));
        if (Math.abs(e) > 0.02) {
          if (!this._lb) { this._lb = true; out.press.LB = true; }
          this._held.LB = true; out.held = this._held;
          const u = U.clamp(e / (1.2 * 0.12), -1, 1);
          out.rt = u > 0 ? u : 0; out.lt = u < 0 ? -u : 0;
          return;   // ما نحرك الجيمبل وقت الزوم
        }
      }
      if (this._lb) { this._lbOff(out); return; }
      if (g.gimbal != null) {
        const gt = U.clamp(g.gimbal, C.gMin != null ? C.gMin : -90, C.gMax != null ? C.gMax : 60), e = gt - (s.gimbal || 0);
        const u = U.clamp(e / 12 + (g.gimbalFF || 0) / 100, -1, 1);
        out.rt = u > 0 ? u : 0; out.lt = u < 0 ? -u : 0;
      }
    }
    _lbOff(out) { this._lb = false; delete this._held.LB; out.held = this._held; this._lbRel = 3; }

    // ---------- الدرون العادي (DJI): العصي = سرعة (C/N/S) أو ميلان (ATTI) ----------
    fly(d, s, g, o) {
      const mode = d.effMode(), M = DS.MODES[mode] || DS.MODES.P, P = d.profile;
      const W = s.env.wind.at(d.p.y, this._w);
      if (g.descend) {
        const vy = d.p.y > 3 ? -2 : d.p.y > 1.2 ? -1.2 : -0.7;
        o.thr = U.clamp(vy / (M.maxDown || 3), -1, 1);
      } else if (g.alt != null) {
        const e = g.alt - d.p.y;
        if (mode === 'M') o.thr = U.clamp(0.9 * e - 0.8 * d.v.y, -1, 1);
        else {
          // ننزل بهدوء إذا ما فيه سرعة أفقية (عشان ما يدخل VRS)
          const hAir = Math.hypot(d.v.x - W.x, d.v.z - W.z);
          const cap = g.vdown || (hAir > 2.5 ? M.maxDown * 0.85 : Math.min(M.maxDown * 0.85, 2.8));
          const vy = U.clamp(1.4 * e, -cap, M.maxUp * 0.85);
          o.thr = vy >= 0 ? vy / M.maxUp : vy / M.maxDown;
        }
      }
      if (g.yaw != null) { const e = U.wrap(g.yaw - d.yaw), mr = M.yawRate * D2R; o.yaw = U.clamp(3 * e + (g.yawFF || 0), -mr, mr) / mr; }
      if (g.x != null || g.vff) {
        let vx = 0, vz = 0;
        if (g.x != null) {
          const ex = g.x - d.p.x, ez = g.z - d.p.z, sp = g.speed || 5;
          vx = ex * 0.8; vz = ez * 0.8;
          const vm = Math.hypot(vx, vz); if (vm > sp) { vx *= sp / vm; vz *= sp / vm; }
        }
        if (g.vff) { vx += g.vff.x || 0; vz += g.vff.z || 0; }
        const sy = Math.sin(d.yaw), cy = Math.cos(d.yaw);   // قدام = (sin, -cos)، يمين = (cos, sin)
        if (mode === 'C' || mode === 'P' || mode === 'S') {   // effMode = ATTI إذا راح الـ GPS والحساسات مع بعض
          o.pitch = U.clamp((vx * sy - vz * cy) / M.maxH, -1, 1);
          o.roll = U.clamp((vx * cy + vz * sy) / M.maxH, -1, 1);
        } else {
          // ATTI: التسارع المطلوب + تعويض سحب الهواء → زاوية ميلان
          const dr = P.drag, vax = d.v.x - W.x, vaz = d.v.z - W.z, vh = Math.hypot(vax, vaz);
          const k = dr.lin + 0.5 * 1.225 * dr.cda / d.mass * vh;
          const tx = 1.6 * (vx - d.v.x) + k * vax, tz = 1.6 * (vz - d.v.z) + k * vaz;
          const mt = M.tilt * D2R;
          o.pitch = U.clamp(Math.atan((tx * sy - tz * cy) / G) / mt, -1, 1);
          o.roll = U.clamp(Math.atan((tx * cy + tz * sy) / G) / mt, -1, 1);
        }
      }
      return o;
    }

    // ---------- FPV: تسارع → اتجاه الدفع → الوضعية → سرعات الدوران → العصي (fpv.md §9) ----------
    flyFpv(dt, d, s, g, o) {
      const P = d.profile, W = s.env.wind.at(d.p.y, this._w), m = d.mass;
      const mode = d.mode, angle = mode !== 'ACRO';
      // 1) المكان → السرعة → التسارع المطلوب
      let vx = 0, vz = 0, vy = 0;
      if (g.x != null) {
        const ex = g.x - d.p.x, ez = g.z - d.p.z, sp = g.speed || 6;
        vx = 0.9 * ex; vz = 0.9 * ez;
        const vm = Math.hypot(vx, vz); if (vm > sp) { vx *= sp / vm; vz *= sp / vm; }
      }
      if (g.vff) { vx += g.vff.x || 0; vz += g.vff.z || 0; }
      if (g.descend) vy = d.p.y > 3 ? -1.5 : d.p.y > 1 ? -0.8 : -0.45;
      else if (g.alt != null) vy = U.clamp(1.5 * (g.alt - d.p.y), -(g.vdown || 2.5), 5);
      const vax = d.v.x - W.x, vay = d.v.y - W.y, vaz = d.v.z - W.z, va = Math.hypot(vax, vay, vaz);
      const kd = (0.5 * 1.225 * 0.012 * va + P.drag.krd * 0.35) / m;   // سحب تقريبي
      let ax = 2.2 * (vx - d.v.x) + kd * vax, az = 2.2 * (vz - d.v.z) + kd * vaz, ay = 3 * (vy - d.v.y) + kd * vay;
      // 2) متجه الدفع (حد الميلان)
      let fx = ax, fy = Math.max(1.5, ay + G), fz = az;
      const tilt = (angle ? Math.min(P.angle.limit - 5, 50) : 60) * D2R, hm = Math.hypot(fx, fz), hmax = fy * Math.tan(tilt);
      if (hm > hmax) { fx *= hmax / hm; fz *= hmax / hm; }
      const fn = Math.hypot(fx, fy, fz), b3x = fx / fn, b3y = fy / fn, b3z = fz / fn;
      // 3) الوضعية المطلوبة (b3 + الاتجاه)
      // الاتجاه: المطلوب، وإلا نثبت الاتجاه الحالي
      if (g.yaw != null) this._psiHold = null; else if (this._psiHold == null) this._psiHold = d.yaw;
      const psi = g.yaw != null ? g.yaw : this._psiHold;
      const hx = Math.sin(psi), hz = -Math.cos(psi);
      let rx = -hz * b3y, ry = hz * b3x - hx * b3z, rz = hx * b3y;
      const rn = 1 / (Math.hypot(rx, ry, rz) || 1); rx *= rn; ry *= rn; rz *= rn;
      const bkx = ry * b3z - rz * b3y, bky = rz * b3x - rx * b3z, bkz = rx * b3y - ry * b3x;
      // 4) الثروتل: المركّبة اللي يقدر عليها الدفع الحالي (مع تعويض وسادة الأرض)
      const A = Q.axes(d.q, this._A);
      const agl = d.p.y - (d._groundY || 0), ge = d._geFactor ? d._geFactor(agl) : 1;
      const Tdes = m * fn * Math.max(0.2, b3x * A.ux + b3y * A.uy + b3z * A.uz) / ge;
      const vs = U.clamp(d.voltage / P.vRef, 0.3, 1.05), fc = Tdes / (4 * P.tMax * vs * vs);
      o.throttle01 = U.clamp((Math.pow(Math.max(fc, 0), 1 / P.gamma) - P.idle) / (1 - P.idle), 0, 1);
      o.thr = DS.PhysRates.invThrottle(o.throttle01, d.hoverThr, 0.45);
      // 5) الوضعية → العصي
      if (mode === 'HORIZON') {
        Q.fromBasis(rx, ry, rz, b3x, b3y, b3z, bkx, bky, bkz, this._qd);
        this._horizonSticks(d, this._qd, o);
      } else if (angle) {
        // زاوية Angle المطلوبة من متجه الجاذبية في الجسم المطلوب
        const rollT = Math.atan2(-ry, b3y) * R2D, pitchT = Math.atan2(bky, Math.hypot(ry, b3y)) * R2D;
        const R = DS.PhysRates.get(), rMax = DS.PhysRates.axis(1, false, R), lim = P.angle.limit;
        o.roll = DS.PhysRates.inv(U.clamp(rollT / lim, -1, 1) * rMax, false, R);
        o.pitch = DS.PhysRates.inv(U.clamp(pitchT / lim, -1, 1) * rMax, false, R);
        const yr = U.clamp(2.5 * U.wrap(psi - d.yaw) + (g.yaw != null ? g.yawFF || 0 : 0), -4, 4) * R2D;
        o.yaw = DS.PhysRates.inv(yr, true, R);
      } else {
        Q.fromBasis(rx, ry, rz, b3x, b3y, b3z, bkx, bky, bkz, this._qd);
        this._rateSticks(d, this._qd, o);
      }
      return o;
    }
    // خطأ الوضعية → سرعة دوران → عصي Acro (عكس منحنى Betaflight)
    _rateSticks(d, qd, o) {
      const q = d.q, qe = this._qe;
      qe.x = -q.x; qe.y = -q.y; qe.z = -q.z; qe.w = q.w; Q.mul(qe, qd, qe);
      if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; }
      const wx = 2 * qe.x / 0.10, wy = 2 * qe.y / 0.25, wz = 2 * qe.z / 0.10;
      const R = DS.PhysRates.get();
      o.roll = DS.PhysRates.inv(-wz * R2D, false, R);
      o.pitch = DS.PhysRates.inv(-wx * R2D, false, R);
      o.yaw = DS.PhysRates.inv(-wy * R2D, true, R);
    }
    // Horizon: سرعة الدوران = خليط Acro و Angle حسب العصا → نعكسها بالتنصيف لكل محور
    _horizonSticks(d, qd, o) {
      const q = d.q, qe = this._qe, P = d.profile, AN = P.angle, R = DS.PhysRates.get();
      qe.x = -q.x; qe.y = -q.y; qe.z = -q.z; qe.w = q.w; Q.mul(qe, qd, qe);
      if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; }
      const wpDes = -2 * qe.z / 0.10 * R2D, wqDes = -2 * qe.x / 0.10 * R2D, wr = -2 * qe.y / 0.25 * R2D;
      const A = Q.axes(q, this._A);
      const roll = Math.atan2(-A.ry, A.uy) * R2D, pitch = Math.atan2(A.by, Math.hypot(A.ry, A.uy)) * R2D;
      const rMax = Math.max(1, DS.PhysRates.axis(1, false, R)), sInc = Math.max(0, (AN.hzLimit - Math.max(Math.abs(roll), Math.abs(pitch))) / AN.hzLimit);
      let sr = this._hzSolve(wpDes, 0, roll, sInc, rMax, R, P);
      const sp = this._hzSolve(wqDes, sr, pitch, sInc, rMax, R, P);
      sr = this._hzSolve(wpDes, sp, roll, sInc, rMax, R, P);
      o.roll = sr; o.pitch = sp; o.yaw = DS.PhysRates.inv(wr, true, R);
    }
    // نفس معادلة Horizon في physics.js (بدون تأخير الـ PT1)
    _hzRate(st, other, cur, sInc, rMax, R, P) {
      const AN = P.angle, ac = DS.PhysRates.axis(st, false, R), sStick = Math.max(0, 1 - Math.max(Math.abs(st), Math.abs(other)) / AN.hzSticks);
      const s = Math.min(sInc, sStick) * AN.hzGain, ar = U.clamp(AN.gain * (AN.limit * ac / rMax - cur), -P.maxRate, P.maxRate);
      return ac * (1 - s) + ar * s;
    }
    _hzSolve(want, other, cur, sInc, rMax, R, P) {
      let lo = -1, hi = 1;
      for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (this._hzRate(mid, other, cur, sInc, rMax, R, P) < want) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    }
    // ---------- حركات FPV (Acro): flip / roll / split-S / power loop / inverted yaw spin ----------
    // مساعدات الحركات (بدون إنشاء دوال كل إطار)
    _tPhase(T, ph, d) {
      if (T.ph === 'run' || (T.ph === 'punch' && T.vx0 == null)) { T.vx0 = d.v.x; T.vz0 = d.v.z; T.y0 = d.p.y; }   // بداية الحركة
      if (ph === 'catch') {                                                                                          // نهايتها
        T.vxE = d.v.x; T.vzE = d.v.z; T.yE = d.p.y;
        if (T.type === 'splitS' || T.type === 'yawSpin') T.psi = d.yaw;   // بعد Split-S الاتجاه انعكس: نثبت عليه (ما نلف نرجع)
      }
      T.ph = ph; T.t = 0; T.a = 0;
    }
    _tHold(d, T, o, thr01) {   // يثبت مستوي على اتجاه الحركة بالمعدلات
      const hx = Math.sin(T.psi), hz = -Math.cos(T.psi);
      Q.fromBasis(-hz, 0, hx, 0, 1, 0, -hx, 0, -hz, this._qd);   // يمين، فوق، ورا = يمين × فوق
      this._rateSticks(d, this._qd, o);
      o.throttle01 = thr01; o.thr = DS.PhysRates.invThrottle(thr01, d.hoverThr, 0.45);
    }
    _tRate(d, o, axis, deg, thr01, R) {   // axis: 'p' roll / 'q' pitch / 'r' yaw
      o.roll = axis === 'p' ? DS.PhysRates.inv(deg, false, R) : 0;
      o.pitch = axis === 'q' ? DS.PhysRates.inv(deg, false, R) : 0;
      o.yaw = axis === 'r' ? DS.PhysRates.inv(deg, true, R) : 0;
      o.throttle01 = thr01; o.thr = DS.PhysRates.invThrottle(thr01, d.hoverThr, 0.45);
    }
    // تتبع دائرة عمودية: المركز فوق نقطة البداية بـ R، المستوى = اتجاه الحركة. يرجع true لما تكمل 360°
    _loopFly(dt, d, s, T, o) {
      const TK = Autopilot.TRICK, P = d.profile, m = d.mass;
      let L = T.lc;
      if (!L) {
        const hx = Math.sin(T.psi), hz = -Math.cos(T.psi), V = U.clamp(d.v.x * hx + d.v.z * hz, 7, 12), R = TK.loopR || 4.5;
        L = T.lc = { cx: d.p.x, cy: d.p.y + R, cz: d.p.z, hx, hz, rx: Math.cos(T.psi), rz: Math.sin(T.psi), R, V, last: 0, acc: 0 };
      }
      const ex = d.p.x - L.cx, ey = d.p.y - L.cy, ez = d.p.z - L.cz;
      const u = ex * L.hx + ez * L.hz, w = ey, lat = ex * L.rx + ez * L.rz;   // إحداثيات في مستوى اللوب + الجنب
      const phi = Math.atan2(u, -w), dphi = U.wrap(phi - L.last); L.last = phi; L.acc += dphi;
      if (L.acc >= 2 * Math.PI - 0.2) return true;
      const r = Math.hypot(u, w) || 1e-3, eu = u / r, ew = w / r;               // للخارج (من المركز)
      const tu = -ew, tw = eu;                                                   // المماس (اتجاه الحركة)
      const vu = d.v.x * L.hx + d.v.z * L.hz, vw = d.v.y, vl = d.v.x * L.rx + d.v.z * L.rz;
      const vt = vu * tu + vw * tw, vr = vu * eu + vw * ew;
      const V = L.V, kr = 6, kd = 3.5, kv = 2;
      const ar = -V * V / L.R + kr * (L.R - r) - kd * vr, at = kv * (V - vt), al = -4 * lat - 3 * vl;
      let fu = ar * eu + at * tu, fw = ar * ew + at * tw + DS.G;                 // القوة النوعية = التسارع − الجاذبية
      const fx = fu * L.hx + al * L.rx, fy = fw, fz = fu * L.hz + al * L.rz, fn = Math.hypot(fx, fy, fz) || 1;
      const b3x = fx / fn, b3y = fy / fn, b3z = fz / fn;
      // الإطار المطلوب: اليمين ثابت (عمودي على المستوى)، فوق = اتجاه الدفع
      let rx = L.rx, ry = 0, rz = L.rz; const k = rx * b3x + rz * b3z; rx -= k * b3x; ry -= k * b3y; rz -= k * b3z;
      const rn = 1 / (Math.hypot(rx, ry, rz) || 1); rx *= rn; ry *= rn; rz *= rn;
      const bkx = ry * b3z - rz * b3y, bky = rz * b3x - rx * b3z, bkz = rx * b3y - ry * b3x;
      Q.fromBasis(rx, ry, rz, b3x, b3y, b3z, bkx, bky, bkz, this._qd);
      // خطأ الوضعية → سرعات + تغذية أمامية (رجوع لورا بسرعة V/R)
      const q = d.q, qe = this._qe;
      qe.x = -q.x; qe.y = -q.y; qe.z = -q.z; qe.w = q.w; Q.mul(qe, this._qd, qe);
      if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; }
      const wx = 2 * qe.x / 0.08 + V / L.R, wy = 2 * qe.y / 0.25, wz = 2 * qe.z / 0.08;
      const RT = DS.PhysRates.get();
      o.roll = DS.PhysRates.inv(-wz * R2D, false, RT); o.pitch = DS.PhysRates.inv(-wx * R2D, false, RT); o.yaw = DS.PhysRates.inv(-wy * R2D, true, RT);
      // الثروتل: الدفع اللي يقدر عليه المحور الحالي
      const A = Q.axes(q, this._A), Tdes = m * fn * Math.max(0.15, b3x * A.ux + b3y * A.uy + b3z * A.uz);
      const vs = U.clamp(d.voltage / P.vRef, 0.3, 1.05), fc = Tdes / (4 * P.tMax * vs * vs);
      o.throttle01 = U.clamp((Math.pow(Math.max(fc, 0), 1 / P.gamma) - P.idle) / (1 - P.idle), 0, 1);
      o.thr = DS.PhysRates.invThrottle(o.throttle01, d.hoverThr, 0.45);
      return false;
    }
    trick(dt, d, s, g, o) {
      const tr = g.trick;
      if (d.mode !== 'ACRO') return false;
      let T = this.trk;
      if (!T || T.src !== tr) {
        const ty = tr.type || 'flip';
        T = this.trk = { src: tr, type: ty, dir: tr.dir || 1, turns: tr.turns || 1, ph: ty === 'powerLoop' || ty === 'splitS' ? 'run' : 'punch', t: 0, a: 0, b: 0, done: false, x: d.p.x, z: d.p.z, y: d.p.y, psi: d.yaw };
        this.trickDone = false;
      }
      T.t += dt;
      const R = DS.PhysRates.get(), H = d.hoverThr, TK = Autopilot.TRICK;
      const p = -d.w.z * R2D, qd = -d.w.x * R2D, r = -d.w.y * R2D;   // اصطلاح الطيار (درجة/ث)
      const maxR = DS.PhysRates.axis(1, false, R);
      this.trickState = T.ph;
      const type = T.type;
      switch (T.ph) {
        case 'run': {   // power loop و split-S يبدون من طيران لقدام (~10 م/ث)
          const rg = this._runG || (this._runG = { vff: { x: 0, z: 0 }, alt: 0, yaw: 0 });
          rg.vff.x = Math.sin(T.psi) * 11; rg.vff.z = -Math.cos(T.psi) * 11; rg.alt = T.y; rg.yaw = T.psi;
          this.flyFpv(dt, d, s, rg, o);
          if ((Math.hypot(d.v.x, d.v.z) > 9.5 && Math.abs(d.v.y) < 1) || T.t > 5) this._tPhase(T, type === 'powerLoop' ? 'loop' : 'half', d);
          break;
        }
        case 'punch': {
          const big = type === 'yawSpin';
          this._tHold(d, T, o, U.clamp(H + (big ? 0.55 : 0.38), 0, 1));
          if (T.t > (big ? 0.35 : 0.12)) this._tPhase(T, big ? 'half' : 'rot', d);
          break;
        }
        case 'rot': {   // flip/roll: 360°
          const ax = type === 'roll' ? 'p' : 'q', w = ax === 'p' ? p : qd;
          T.a += w * dt;
          const left = 360 - Math.abs(T.a);
          this._tRate(d, o, ax, T.dir * U.clamp(12 * left, 0, maxR), 0);
          if (Math.abs(T.a) > 345 && Math.abs(w) < 60) this._tPhase(T, 'catch', d);
          else if (T.t > 2) this._tPhase(T, 'catch', d);
          break;
        }
        case 'half': {   // split-S و yawSpin: نص لفة roll (مقلوب)
          T.a += p * dt;
          const left = 180 - Math.abs(T.a);
          this._tRate(d, o, 'p', T.dir * U.clamp(10 * left, 0, maxR), type === 'yawSpin' ? 0.05 : 0.15);
          if (Math.abs(T.a) > 170 && Math.abs(p) < 60) this._tPhase(T, type === 'yawSpin' ? 'spin' : 'pull', d);
          else if (T.t > 1.5) this._tPhase(T, type === 'yawSpin' ? 'spin' : 'pull', d);
          break;
        }
        case 'pull': {   // split-S: سحب لورا 180° (يطلع عكس الاتجاه وأوطى)
          T.a += qd * dt;
          const left = 180 - Math.abs(T.a);
          this._tRate(d, o, 'q', -U.clamp(6 * left + 120, 0, Math.min(maxR, TK.pullRate)), U.clamp(TK.pullThr, 0, 1));
          if (Math.abs(T.a) > 176) this._tPhase(T, 'catch', d);
          else if (T.t > 2.5) this._tPhase(T, 'catch', d);
          break;
        }
        case 'loop': {   // power loop: دائرة عمودية مغلقة (نتبع الدائرة بالدفع + تغذية أمامية لسرعة الدوران)
          T.a += qd * dt;
          if (TK.loopMode === 'open') {   // الطريقة القديمة (جدول ثروتل ثابت)
            const th = Math.abs(T.a), thr01 = th < TK.loopA ? TK.loopThr[0] : th < TK.loopB ? TK.loopThr[1] : TK.loopThr[2];
            this._tRate(d, o, 'q', -U.clamp(3 * (360 - th) + 90, 0, TK.loopRate), thr01);
            if (th > 350 || T.t > 4) this._tPhase(T, 'catch', d);
            break;
          }
          if (this._loopFly(dt, d, s, T, o) || T.t > 5) this._tPhase(T, 'catch', d);
          break;
        }
        case 'spin': {   // دوران حول نفسه وهو مقلوب (الثروتل على الخفيف عشان ما يطيح بسرعة)
          T.b += r * dt;
          this._tRate(d, o, 'r', 600 * T.dir, 0.02);
          if (Math.abs(T.b) >= 360 * T.turns) { this._tPhase(T, 'half2', d); T.a = 0; }
          else if (T.t > 3) this._tPhase(T, 'half2', d);
          break;
        }
        case 'half2': {   // يرجع مستوي
          T.a += p * dt;
          const left = 180 - Math.abs(T.a);
          this._tRate(d, o, 'p', T.dir * U.clamp(10 * left, 0, maxR), 0.1);
          if (Math.abs(T.a) > 170 && Math.abs(p) < 60) this._tPhase(T, 'catch', d);
          else if (T.t > 1.5) this._tPhase(T, 'catch', d);
          break;
        }
        case 'catch': {
          if (type === 'splitS' || type === 'powerLoop') {   // بعد Split-S/اللوب: يكمّل طيران لقدام بنفس السرعة (بدون ما يتعدل فجأة)
            const cg = this._catchG || (this._catchG = { vff: { x: 0, z: 0 }, alt: 0, yaw: 0 });
            if (T.t <= dt * 1.5) { T.cvx = d.v.x; T.cvz = d.v.z; T.cy = d.p.y; }
            cg.vff.x = T.cvx; cg.vff.z = T.cvz; cg.alt = T.cy; cg.yaw = T.psi;
            this.flyFpv(dt, d, s, cg, o);
          } else this._tHold(d, T, o, U.clamp(H + 0.3, 0, 1));
          if (T.t > 0.25) { this._tPhase(T, 'done', d); T.done = true; this.trickDone = true; T.x = d.p.x; T.z = d.p.z; T.y = Math.max(d.p.y, 2); T.psi = d.yaw; }
          break;
        }
        default: {   // خلص: يهدّي السرعة بنعومة (بدون فرملة قوية) وبعدين يثبت مكانه
          this.trickState = 'done';
          const hg = this._trickHold || (this._trickHold = { vff: { x: 0, z: 0 } });
          const keep = T.type === 'splitS' || T.type === 'powerLoop' ? 0.8 : 0;   // بعد Split-S/اللوب يكمّل طيران لقدام شوي (مثل الطيار)
          if (T.t < 1.6 + keep) {
            if (T.t <= dt * 1.5) { T.svx = d.v.x; T.svz = d.v.z; }
            const k = T.t < keep ? 1 : Math.max(0, 1 - (T.t - keep) / 1.4);
            hg.x = null; hg.z = null; hg.vff.x = T.svx * k; hg.vff.z = T.svz * k;
            T.x = d.p.x; T.z = d.p.z;
          } else { hg.x = T.x; hg.z = T.z; hg.vff.x = 0; hg.vff.z = 0; }
          hg.alt = T.y; hg.yaw = T.psi; hg.speed = 4;
          this.flyFpv(dt, d, s, hg, o);
        }
      }
      return true;
    }
  }
  // ضبط الحركات (درجة/ث، ثروتل 0..1)
  Autopilot.TRICK = { pullRate: 300, pullThr: 0.75, loopMode: 'track', loopR: 4.5, loopRate: 150, loopA: 120, loopB: 240, loopThr: [0.6, 0.2, 0.5] };   // loopMode 'track' = دائرة مغلقة (v2)
  DS.Autopilot = Autopilot;
})();
