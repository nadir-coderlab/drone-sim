// محرك الطيران v2: جسم صلب (كواترنيون) + محركات + متحكم الطيران (DJI أو Betaflight) + الريح + البطارية + الإشارة
// المحاور: x = شرق، y = فوق، z = جنوب (الشمال = -z). الاتجاه yaw: 0 = شمال، موجب = مع عقارب الساعة
// إطار الجسم مثل three.js: قدام = -Z، يمين = +X، فوق = +Y. q = من الجسم للعالم
(function () {
  const DS = window.DS, U = DS.U;
  const G = 9.81, RHO = 1.225, HZ = 480;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, TAU = Math.PI * 2;
  DS.G = G; DS.KDRAG = 0.32;   // KDRAG قديم (v1) — ما عاد يستخدمه أحد، باقي للتوافق بس
  DS.PHYS_HZ = HZ;

  // ---------------- جداول البطارية (جهد الخلية حسب الشحن) ----------------
  const SOC_PTS = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const OCV_LIION = [3.00, 3.30, 3.40, 3.53, 3.62, 3.70, 3.78, 3.86, 3.95, 4.05, 4.15, 4.30];
  const OCV_LIPO = [3.27, 3.61, 3.69, 3.73, 3.77, 3.80, 3.84, 3.87, 3.95, 4.02, 4.11, 4.20];
  function ocv(tab, soc) {
    if (soc <= 0) return tab[0];
    if (soc >= 1) return tab[tab.length - 1];
    let i = 1; while (SOC_PTS[i] < soc) i++;
    const a = SOC_PTS[i - 1], b = SOC_PTS[i];
    return tab[i - 1] + (tab[i] - tab[i - 1]) * (soc - a) / (b - a);
  }

  // ---------------- الطيارات (الأرقام من البحث: dji.md و fpv.md) ----------------
  DS.AIRFRAMES = {
    mini: {
      id: 'mini', kind: 'dji', name: 'درون تصوير (فئة DJI Mini)', mass: 0.249, radius: 0.18, dims: { w: 0.30, l: 0.37, h: 0.10 },
      twr: 2.2, tauT: 0.04,                                   // أقصى دفع / الوزن، وتأخر المحركات
      drag: { lin: 0.17, cda: 0.0066, linV: 0.3, cdaV: 0.02 },   // معاير: S = 16 م/ث على ميلان 35°
      rotorR: 0.076, vh: 3.7,                                 // نصف قطر المروحة، سرعة الهواء تحت المراوح وقت الثبات
      att: { tauTilt: 0.12, tauYaw: 0.16, tauRate: 0.035, aRP: 34, aY: 9, wRP: 3.6, wY: 2.8 },
      kv: { C: 1.5, P: 2.4, S: 2.8, A: 2.0 }, kiV: 0.5, kpos: 1.0, kvz: 4, kiZ: 0.8, aVmax: 6,
      modes: ['C', 'P', 'S'], defaultMode: 'P',
      cam: { vfov: 43, gMin: -90, gMax: 60, maxZoom: 4, off: { x: 0, y: -0.03, z: -0.12 }, latency: 0.12 },
      bat: { chem: 'liion', cells: 2, mah: 2590, rCell: 0.025, wiring: 0, pHover: 33, pAux: 2, cutCell: 3.0, ocv: OCV_LIION },
      link: { range: 8000 }, sense: { F: 18, B: 15, L: 12, U: 15, D: 12, vmax: 12, standoff: 1.5 },
      hover: { vision: 0.1, gnss: 0.5 }, windMax: 10.7, rthSpeed: 10.5,
      tipHs: 1.5                                              // يلمس الأرض وهو ماشي أكثر من كذا (م/ث) = ينقلب (رجوله قصيرة)
    },
    fpv: {
      id: 'fpv', kind: 'fpv', name: 'FPV فري ستايل 5 إنش', mass: 0.65, radius: 0.16, dims: { w: 0.23, l: 0.23, h: 0.05 },
      arm: 0.080, tMax: 16, gamma: 1.725, idle: 0.055, tauUp: 0.030, tauDn: 0.045, wMax: 3300, vRef: 25.2, kq: 0.0122, Jr: 5e-6,
      J: { x: 2.2e-3, y: 4.0e-3, z: 2.2e-3 },                 // x = محور الـ pitch، y = الـ yaw، z = الـ roll
      drag: { cdaTop: 0.015, cdaSide: 0.010, krd: 0.35, ang: 2e-4 },   // معاير: 150 كم/س أفقي مع هبوط الجهد
      pid: { rp: { kp: 28, ki: 60, kff: 1, kd: 0.05, auth: 1100 }, y: { kp: 15, ki: 30, kff: 1, kd: 0, auth: 100 } },
      angle: { limit: 60, gain: 5, hzLimit: 135, hzGain: 0.75, hzSticks: 0.75, hzDelay: 0.5 },
      rotorR: 0.0648, propPitch: 0.1092, vpk: 1.25,                   // vpk: سرعة الدفع الصفري = 1.25 × خطوة المروحة
      modes: ['ANGLE', 'HORIZON', 'ACRO'], defaultMode: 'ANGLE',
      // latency 0: المتصفح والشاشة يضيفون 30–50ms لحالهم (مثل نظارة O3 الحقيقية تقريباً)
      cam: { vfov: 100, uptilt: 25, maxZoom: 1, off: { x: 0, y: 0.02, z: -0.07 }, latency: 0 },
      // warnCell: تحذير على الجهد المفلتر (lvTau ث) ويرجع يتسلح فوق warnClear — مثل Betaflight
      bat: { chem: 'lipo', cells: 6, mah: 1300, rCell: 0.004, wiring: 0.003, eta: 0.40, aux: 0.5, warnCell: 3.5, warnClear: 3.6, lvTau: 2.5, ocv: OCV_LIPO },
      // الخبطات (م/ث): أكثر من كذا = ينكسر. أقل = يرتد (وممكن تنكسر مروحة)
      crash: { obst: 12, vs: 11.5, hs: 14 },
      link: { range: 2500 }, maxRate: 1998
    }
  };

  // ---------------- أوضاع الطيران ----------------
  // P = وضع N (Normal) في DJI الجديدة — نخلي المعرّف P عشان المحتوى القديم
  DS.MODES = {
    C: { id: 'C', label: 'C', name: 'وضع C (سينمائي)', af: 'mini', maxH: 6, maxUp: 2, maxDown: 1.5, yawRate: 30, tilt: 20, smooth: 15, brake: 1 },
    P: { id: 'P', label: 'N', name: 'وضع N (عادي)', af: 'mini', maxH: 12, maxUp: 5, maxDown: 5, yawRate: 80, tilt: 30, smooth: 12, brake: 0.76 },
    S: { id: 'S', label: 'S', name: 'وضع S (رياضي)', af: 'mini', maxH: 16, maxUp: 5, maxDown: 5, yawRate: 130, tilt: 35, smooth: 10, brake: 0.9 },
    A: { id: 'A', label: 'ATTI', name: 'وضع ATTI (بدون تثبيت)', af: 'mini', maxUp: 5, maxDown: 5, yawRate: 80, tilt: 30, smooth: 12 },
    M: { id: 'M', label: 'M', name: 'الوضع اليدوي', af: 'mini', maxUp: 5, maxDown: 5, yawRate: 100, tilt: 40, smooth: 8 },
    ANGLE: { id: 'ANGLE', label: 'ANGLE', name: 'وضع Angle (يرجع مستوي لحاله)', af: 'fpv', yawRate: 550, tilt: 60 },
    HORIZON: { id: 'HORIZON', label: 'HORIZON', name: 'وضع Horizon (نص ونص)', af: 'fpv', yawRate: 550, tilt: 135 },
    ACRO: { id: 'ACRO', label: 'ACRO', name: 'وضع Acro (يدوي كامل)', af: 'fpv', yawRate: 550, tilt: 180 }
  };
  DS.modeOrder = af => (af === 'fpv' ? ['ANGLE', 'HORIZON', 'ACRO'] : ['C', 'P', 'S']);

  // ---------------- منحنيات Betaflight (للـ FPV والطيار الآلي) ----------------
  // DS.PhysRates (اسم خاص عشان ما نخرب DS.Rates حق util.js — نفس المعادلات)
  const DEF_RATES = { center: 120, max: 750, expo: 0.55, yawCenter: 120, yawMax: 550, yawExpo: 0.5 };
  const Rates = DS.PhysRates = {
    // Actual rates: c = العصا -1..1 → درجة/ثانية
    actual(c, center, max, expo) {
      const a = Math.abs(c), c5 = c * c * c * c * c;
      return c * center + Math.max(0, max - center) * a * (c5 * expo + c * (1 - expo));
    },
    get() { const r = DS.settings && DS.settings.rates; return r || DEF_RATES; },
    axis(c, yaw, R) {
      R = R || Rates.get();
      return yaw ? Rates.actual(c, R.yawCenter != null ? R.yawCenter : R.center, R.yawMax != null ? R.yawMax : R.max, R.yawExpo != null ? R.yawExpo : R.expo)
        : Rates.actual(c, R.center, R.max, R.expo);
    },
    // العكس: كم العصا عشان توصل هالسرعة (تنصيف)
    inv(rateDeg, yaw, R) {
      R = R || Rates.get();
      const s = rateDeg < 0 ? -1 : 1, t = Math.abs(rateDeg);
      if (t >= Rates.axis(1, yaw, R)) return s;
      let lo = 0, hi = 1;
      for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (Rates.axis(m, yaw, R) < t) lo = m; else hi = m; }
      return s * (lo + hi) / 2;
    },
    // ثروتل اليد: النص = الثبات (H)، تحت للآخر = 0، فوق للآخر = 1 (نستخدم DS.Throttle حق util.js إذا موجود)
    // احتياط بنفس معادلة util.js: تحت النص خطي، فوقه إكسبو يخلي الميل عند النص متساوي (E قديم ما يُستخدم)
    gpThrottle(sy, H, E) {
      if (DS.Throttle && DS.Throttle.gp) return DS.Throttle.gp(sy, H, E);
      if (!(H > 0.01 && H < 0.99)) H = 0.22;
      sy = U.clamp(+sy || 0, -1, 1);
      if (sy <= 0) return H + sy * H;
      const e = H >= 0.5 ? 0 : Math.min(0.85, 1 - H / (1 - H)), d = sy * (1 - e + e * sy * sy);
      return H + d * (1 - H);
    },
    invThrottle(t, H, E) {
      if (DS.Throttle && DS.Throttle.inv) return DS.Throttle.inv(t, H, E);
      if (!(H > 0.01 && H < 0.99)) H = 0.22;
      if (t <= 0) return -1; if (t >= 1) return 1;
      if (t <= H) return (t - H) / H;
      let lo = 0, hi = 1;
      for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (Rates.gpThrottle(m, H, E) < t) lo = m; else hi = m; }
      return (lo + hi) / 2;
    }
  };

  if (!DS.Rates) DS.Rates = Rates;   // احتياط لو util.js قديم

  // ---------------- العالم (احتياط: ينتقل لـ worlddata.js) ----------------
  // نعرّفه بس إذا worlddata.js ما عرّفه (عشان الاختبار يشتغل في الحالتين)
  if (!DS.PILOT) DS.PILOT = { x: 0, z: 6 };
  if (!DS.HOME) DS.HOME = { x: 0, z: 0 };
  if (!DS.FIELD) DS.FIELD = { x0: -60, x1: 60, z0: -115, z1: 25 };
  if (!DS.inField) DS.inField = (x, z) => x >= DS.FIELD.x0 && x <= DS.FIELD.x1 && z >= DS.FIELD.z0 && z <= DS.FIELD.z1;
  if (!DS.World) {
    DS.World = (function () {
      const rnd = U.rng(20261017);
      const F = DS.FIELD, M = 14;
      const trees = [], buildings = [], colliders = [];
      let tries = 0;
      while (trees.length < 240 && tries < 6000) {
        tries++;
        const a = rnd() * Math.PI * 2, r = 80 + Math.pow(rnd(), 0.7) * 420;
        const x = Math.sin(a) * r, z = -45 - Math.cos(a) * r;
        if (x > F.x0 - M && x < F.x1 + M && z > F.z0 - M && z < F.z1 + M) continue;
        const h = 5 + rnd() * 9, cr = 1.6 + rnd() * 2.2;
        trees.push({ x, z, h, cr, pine: rnd() < 0.35, hue: rnd() });
        if (r < 280) colliders.push({ type: 'cyl', x, z, r: cr * 0.75, h, name: 'شجرة' });
      }
      const B = [[-150, -260, 30, 22, 18], [140, -235, 26, 26, 24], [-215, -40, 24, 30, 12], [205, 10, 30, 18, 15],
        [-125, 150, 40, 20, 10], [115, 165, 22, 22, 28], [0, -340, 50, 24, 20], [265, -125, 20, 40, 14]];
      for (const [x, z, w, d, h] of B) {
        buildings.push({ x, z, w, d, h, c: rnd() });
        colliders.push({ type: 'box', x, z, w, d, h, name: 'مبنى', blocksSignal: true });
      }
      return { trees, buildings, colliders, zones: [], roads: [], powerlines: [], towers: [], lanes: [] };
    })();
  }
  // الريح فوق أقوى من تحت (قانون القوة 1/7، المرجع 10 متر)
  DS.windFactor = y => Math.pow(Math.min(Math.max(y, 0.5), 400) / 10, 1 / 7);

  // ---------------- الريح: متوسط + اضطراب (Dryden مبسط) + هبات ----------------
  class Wind {
    constructor(rng) {
      this.rng = rng || Math.random; this._gs = null; this.t = 0;
      this.u1 = 0; this.v1 = 0; this.u2 = 0; this.v2 = 0; this.w2 = 0;   // اضطراب بطيء وسريع
      this.ev = { on: false, t: 0, dur: 1, amp: 0, x: 0, z: 0 };
      this._info = { speed: 0, fromDeg: 0 }; this._tmp = { x: 0, y: 0, z: 0, gx: 0, gz: 0 };
      this.set(0, 0, 0);
    }
    gauss() {
      if (this._gs != null) { const g = this._gs; this._gs = null; return g; }
      let u = this.rng(); if (u < 1e-12) u = 1e-12;
      const r = Math.sqrt(-2 * Math.log(u)), a = TAU * this.rng();
      this._gs = r * Math.sin(a); return r * Math.cos(a);
    }
    // speed = سرعة الريح على 10 متر، fromDeg = من وين جاية، gust = قوة الهبات (م/ث)
    set(speed, fromDeg, gust) {
      this.speed = +speed || 0; this.fromDeg = +fromDeg || 0; this.from = this.fromDeg * D2R; this.gust = Math.max(0, +gust || 0);
      const to = this.from + Math.PI;
      this.bx = Math.sin(to) * this.speed; this.bz = -Math.cos(to) * this.speed;
      this.step(0);
    }
    // هبة مفاجئة بشكل (1 - cos): dir = من وين جاية (درجات)
    gustEvent(dirDeg, amp, dur) {
      const to = (+dirDeg || 0) * D2R + Math.PI, e = this.ev;
      e.on = true; e.t = 0; e.dur = Math.max(0.2, +dur || 2); e.amp = +amp || 0; e.x = Math.sin(to); e.z = -Math.cos(to);
    }
    step(dt) {
      this.t += dt;
      const sh = 0.5 * this.gust, sv = 0.15 * this.gust;
      if (dt > 0 && this.gust > 0) {
        const V = Math.max(2, this.speed), tauS = U.clamp(60 / V, 4, 30), tauF = 1.2, tauW = 1.0;
        const aS = Math.exp(-dt / tauS), aF = Math.exp(-dt / tauF), aW = Math.exp(-dt / tauW);
        const kS = 0.75 * sh * Math.sqrt(1 - aS * aS), kF = 0.66 * sh * Math.sqrt(1 - aF * aF), kW = sv * Math.sqrt(1 - aW * aW);
        this.u1 = aS * this.u1 + kS * this.gauss(); this.v1 = aS * this.v1 + kS * this.gauss();
        this.u2 = aF * this.u2 + kF * this.gauss(); this.v2 = aF * this.v2 + kF * this.gauss();
        this.w2 = aW * this.w2 + kW * this.gauss();
      } else if (this.gust <= 0) { this.u1 = this.v1 = this.u2 = this.v2 = this.w2 = 0; }
      let ex = 0, ez = 0;
      const e = this.ev;
      if (e.on) {
        e.t += dt;
        if (e.t >= e.dur) e.on = false;
        else { const g = e.amp * 0.5 * (1 - Math.cos(TAU * e.t / e.dur)); ex = e.x * g; ez = e.z * g; }
      }
      this.gx = this.u1 + this.u2 + ex; this.gz = this.v1 + this.v2 + ez; this.vy = this.w2;
      this.vx = this.bx + this.gx; this.vz = this.bz + this.gz;
    }
    // الريح على ارتفاع y (بدون إنشاء كائن جديد إذا عطيته out)
    at(y, out) {
      const f = DS.windFactor(y || 0);
      out = out || { x: 0, y: 0, z: 0, gx: 0, gz: 0 };
      out.x = this.vx * f; out.z = this.vz * f; out.y = this.vy * f; out.gx = this.gx * f; out.gz = this.gz * f;
      return out;
    }
    info(y) {
      const w = this.at(y == null ? 10 : y, this._tmp), o = this._info;
      o.speed = Math.hypot(w.x, w.z); o.fromDeg = (Math.atan2(-w.x, w.z) * R2D + 360) % 360;
      return o;
    }
  }
  DS.Wind = Wind;

  // ---------------- التصادم ----------------
  // contact: يرجع عمق التداخل (> 0 = لمس) ويكتب الاتجاه للخارج في out.nx/ny/nz
  const _ct = { d: 0, nx: 0, ny: 1, nz: 0 }, _ct2 = { d: 0, nx: 0, ny: 1, nz: 0 };
  // الخريطة الحقيقية / مجسم طويق (env.geo = سطح من شبكة ارتفاعات): فحص الخبط 30 مرة بالثانية
  const GEO_DT = 1 / 30, _gh = { nx: 0, nz: 0, top: 0 }, GEO_OBS = { name: 'مبنى' };
  function setN(o, x, y, z, d) { o.nx = x; o.ny = y; o.nz = z; o.d = d; return d; }
  DS.contact = function (c, p, R, out) {
    out = out || _ct; if (R == null) R = 0.3;
    switch (c.type) {
      case 'cyl': {
        const y0 = c.y0 || 0;
        if (p.y > c.h + R || p.y < y0 - R) return 0;
        const dx = p.x - c.x, dz = p.z - c.z, rr = Math.hypot(dx, dz), lim = c.r + R;
        if (rr >= lim) return 0;
        const dSide = lim - rr, dTop = c.h + R - p.y, dBot = y0 > 0 ? p.y - (y0 - R) : 1e9;
        if (dTop < dSide && dTop <= dBot) return setN(out, 0, 1, 0, dTop);
        if (dBot < dSide) return setN(out, 0, -1, 0, dBot);
        return rr > 1e-6 ? setN(out, dx / rr, 0, dz / rr, dSide) : setN(out, 1, 0, 0, dSide);
      }
      case 'box': {
        const y0 = c.y0 || 0;
        if (p.y > c.h + R || p.y < y0 - R) return 0;
        let dx = p.x - c.x, dz = p.z - c.z, cs = 1, sn = 0;
        if (c.yaw) { cs = Math.cos(c.yaw); sn = Math.sin(c.yaw); const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs; dx = lx; dz = lz; }
        const px = c.w / 2 + R - Math.abs(dx), pz = c.d / 2 + R - Math.abs(dz);
        if (px <= 0 || pz <= 0) return 0;
        const pt = c.h + R - p.y, pb = y0 > 0 ? p.y - (y0 - R) : 1e9;
        if (pt <= px && pt <= pz && pt <= pb) return setN(out, 0, 1, 0, pt);
        if (pb <= px && pb <= pz) return setN(out, 0, -1, 0, pb);
        let lnx = 0, lnz = 0, d;
        if (px < pz) { lnx = dx >= 0 ? 1 : -1; d = px; } else { lnz = dz >= 0 ? 1 : -1; d = pz; }
        return setN(out, lnx * cs - lnz * sn, 0, lnx * sn + lnz * cs, d);
      }
      case 'sphere': {
        const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z, r = Math.hypot(dx, dy, dz), lim = c.r + R;
        if (r >= lim) return 0;
        return r > 1e-6 ? setN(out, dx / r, dy / r, dz / r, lim - r) : setN(out, 0, 1, 0, lim);
      }
      case 'ring': {
        const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
        const nx = Math.sin(c.yaw), nz = -Math.cos(c.yaw), rx = Math.cos(c.yaw), rz = Math.sin(c.yaw);
        const along = dx * nx + dz * nz, lat = dx * rx + dz * rz, rho = Math.hypot(lat, dy);
        const k = rho > 1e-6 ? c.R / rho : 0;
        const ql = lat - lat * k, qy = dy - (rho > 1e-6 ? dy * k : -c.R), dist = Math.hypot(ql, qy, along), lim = c.r + R;
        if (dist >= lim) return 0;
        if (dist < 1e-6) return setN(out, nx, 0, nz, lim);
        return setN(out, (rx * ql + nx * along) / dist, qy / dist, (rz * ql + nz * along) / dist, lim - dist);
      }
      case 'wire': {
        const y1 = c.y1 != null ? c.y1 : c.y, y2 = c.y2 != null ? c.y2 : c.y;
        const ax = c.x2 - c.x1, ay = y2 - y1, az = c.z2 - c.z1, L2 = ax * ax + ay * ay + az * az;
        let t = L2 > 0 ? ((p.x - c.x1) * ax + (p.y - y1) * ay + (p.z - c.z1) * az) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = p.x - (c.x1 + ax * t), qy = p.y - (y1 + ay * t), qz = p.z - (c.z1 + az * t);
        const dist = Math.hypot(qx, qy, qz), lim = (c.r || 0.05) + R;
        if (dist >= lim) return 0;
        return dist > 1e-6 ? setN(out, qx / dist, qy / dist, qz / dist, lim - dist) : setN(out, 0, 1, 0, lim);
      }
    }
    return 0;
  };
  // هل الدرون صدم؟ (R = نصف قطر الدرون، الافتراضي 0.3 مثل v1)
  DS.hit = (c, p, R) => DS.contact(c, p, R == null ? 0.3 : R, _ct2) > 0;
  // تقريب سريع: هل العائق بعيد أكيد؟
  function farAway(c, p, reach) {
    let cx = c.x, cz = c.z, ext;
    switch (c.type) {
      case 'cyl': ext = c.r; break;
      case 'box': ext = (c.yaw ? 0.71 : 0.5) * (c.w > c.d ? c.w : c.d); break;
      case 'sphere': ext = c.r; break;
      case 'ring': ext = c.R + c.r; break;
      case 'wire': { cx = (c.x1 + c.x2) / 2; cz = (c.z1 + c.z2) / 2; ext = 0.5 * Math.hypot(c.x2 - c.x1, c.z2 - c.z1) + 0.1; break; }
      default: return true;
    }
    const L = ext + reach;
    return Math.abs(p.x - cx) > L || Math.abs(p.z - cz) > L;
  }

  // هل القطعة A→B تقطع الصندوق؟ (طريقة الشرائح، بدون إنشاء كائنات)
  function segBox(ax, ay, az, bx, by, bz, cx, cz, w, d, y0, y1, yaw) {
    let px = ax - cx, pz = az - cz, qx = bx - cx, qz = bz - cz;
    if (yaw) {
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      let t = px * cs + pz * sn; pz = -px * sn + pz * cs; px = t;
      t = qx * cs + qz * sn; qz = -qx * sn + qz * cs; qx = t;
    }
    let t0 = 0, t1 = 1;
    for (let k = 0; k < 3; k++) {
      const a = k === 0 ? px : k === 1 ? pz : ay, b = k === 0 ? qx : k === 1 ? qz : by;
      const lo = k === 0 ? -w / 2 : k === 1 ? -d / 2 : y0, hi = k === 0 ? w / 2 : k === 1 ? d / 2 : y1;
      const dd = b - a;
      if (Math.abs(dd) < 1e-9) { if (a < lo || a > hi) return false; continue; }
      let ta = (lo - a) / dd, tb = (hi - a) / dd;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
    return true;
  }
  DS.segBox = segBox;

  // الحساسات تشوف الأشياء الصلبة الكبيرة بس (مو الأسلاك ولا الأبراج الشبكية ولا البوابات الرفيعة)
  const sensible = c => !c.thin && !c.lattice && !c.landable && !c.noSense && (c.type === 'box' || c.type === 'cyl' || c.type === 'sphere');

  // ---------------- أدوات الكواترنيون (بدون إنشاء كائنات) ----------------
  function qmul(a, b, o) {
    const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
    o.x = x; o.y = y; o.z = z; o.w = w; return o;
  }
  function qrot(q, vx, vy, vz, o) {
    const tx = 2 * (q.y * vz - q.z * vy), ty = 2 * (q.z * vx - q.x * vz), tz = 2 * (q.x * vy - q.y * vx);
    o.x = vx + q.w * tx + (q.y * tz - q.z * ty); o.y = vy + q.w * ty + (q.z * tx - q.x * tz); o.z = vz + q.w * tz + (q.x * ty - q.y * tx);
    return o;
  }
  // محاور الجسم في العالم: يمين (r) وفوق (u) وورا (b)
  function axes(q, A) {
    const x = q.x, y = q.y, z = q.z, w = q.w;
    A.rx = 1 - 2 * (y * y + z * z); A.ry = 2 * (x * y + w * z); A.rz = 2 * (x * z - w * y);
    A.ux = 2 * (x * y - w * z); A.uy = 1 - 2 * (x * x + z * z); A.uz = 2 * (y * z + w * x);
    A.bx = 2 * (x * z + w * y); A.by = 2 * (y * z - w * x); A.bz = 1 - 2 * (x * x + y * y);
    return A;
  }
  function qFromBasis(rx, ry, rz, ux, uy, uz, bx, by, bz, o) {
    const tr = rx + uy + bz;
    if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); o.w = 0.25 / s; o.x = (uz - by) * s; o.y = (bx - rz) * s; o.z = (ry - ux) * s; }
    else if (rx > uy && rx > bz) { const s = 2 * Math.sqrt(1 + rx - uy - bz); o.w = (uz - by) / s; o.x = 0.25 * s; o.y = (ux + ry) / s; o.z = (bx + rz) / s; }
    else if (uy > bz) { const s = 2 * Math.sqrt(1 + uy - rx - bz); o.w = (bx - rz) / s; o.x = (ux + ry) / s; o.y = 0.25 * s; o.z = (by + uz) / s; }
    else { const s = 2 * Math.sqrt(1 + bz - rx - uy); o.w = (ry - ux) / s; o.x = (bx + rz) / s; o.y = (by + uz) / s; o.z = 0.25 * s; }
    return o;
  }
  function qYaw(psi, o) { o.x = 0; o.y = -Math.sin(psi / 2); o.z = 0; o.w = Math.cos(psi / 2); return o; }
  // q = q ⊗ exp(ω·h)
  function qIntegrate(q, wx, wy, wz, h, tmp) {
    const wm = Math.hypot(wx, wy, wz);
    if (wm < 1e-9) return;
    const half = wm * h * 0.5, s = Math.sin(half) / wm;
    tmp.x = wx * s; tmp.y = wy * s; tmp.z = wz * s; tmp.w = Math.cos(half);
    qmul(q, tmp, q);
    const n = 1 / Math.hypot(q.x, q.y, q.z, q.w); q.x *= n; q.y *= n; q.z *= n; q.w *= n;
  }
  // slerp بدون إنشاء كائنات (o ممكن يكون نفس a)
  function qSlerp(a, b, t, o) {
    let cs = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w, bx = b.x, by = b.y, bz = b.z, bw = b.w;
    if (cs < 0) { cs = -cs; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let k0 = 1 - t, k1 = t;
    if (cs < 0.9995) { const om = Math.acos(cs), so = Math.sin(om); k0 = Math.sin((1 - t) * om) / so; k1 = Math.sin(t * om) / so; }
    const x = k0 * a.x + k1 * bx, y = k0 * a.y + k1 * by, z = k0 * a.z + k1 * bz, w = k0 * a.w + k1 * bw, n = 1 / (Math.hypot(x, y, z, w) || 1);
    o.x = x * n; o.y = y * n; o.z = z * n; o.w = w * n; return o;
  }
  DS.Q = { mul: qmul, rot: qrot, axes, fromBasis: qFromBasis, yaw: qYaw, slerp: qSlerp };

  const NOC = { thr: 0, yaw: 0, pitch: 0, roll: 0 };
  const NOENV = { colliders: [], taskColliders: [] };
  const ZW = { x: 0, y: 0, z: 0, gx: 0, gz: 0 };
  const MOT_X = [1, 1, -1, -1], MOT_F = [-1, 1, -1, 1], MOT_DIR = [1, -1, -1, 1];   // ترتيب Betaflight: ورا يمين، قدام يمين، ورا يسار، قدام يسار

  // ---------------- الدرون ----------------
  class Drone {
    constructor(airframe) {
      this.q = { x: 0, y: 0, z: 0, w: 1 }; this.w = { x: 0, y: 0, z: 0 };
      this.A = {}; this._qd = { x: 0, y: 0, z: 0, w: 1 }; this._qt = { x: 0, y: 0, z: 0, w: 1 }; this._qe = { x: 0, y: 0, z: 0, w: 1 };
      this._cmd = { vx: null, vz: null, vy: null, yaw: null, level: false };
      this._obs = { dist: 0, dir: 0, up: 0, braking: false }; this._cp = { x: 0, y: 0, z: 0 };
      this._sp = new Float64Array(3); this._sf1 = new Float64Array(3); this._sf2 = new Float64Array(3); this._spPrev = new Float64Array(3);
      this._I = new Float64Array(3); this._wPrev = new Float64Array(3); this._pw = new Float64Array(4); this._eff = new Float64Array(4);
      this.setAirframe(airframe || 'mini', true);
      this.reset(0, 0, 0);
    }

    // تغيير نوع الطيارة ('mini' أو 'fpv')
    setAirframe(id, silent) {
      const P = DS.AIRFRAMES[id] || DS.AIRFRAMES.mini;
      this.airframe = P.id; this.profile = P;
      this.mass = P.mass;
      if (P.kind === 'dji') this.tMax = P.twr * P.mass * G;
      else this.tMax = 4 * P.tMax;
      if (!this.mode || !DS.MODES[this.mode] || DS.MODES[this.mode].af !== P.id) this.mode = P.defaultMode;
      this.cells = P.bat.cells;
      if (!silent && this.p) this.reset(this.p.x, this.p.z, this.yaw);
    }

    reset(x, z, yaw) {
      const P = this.profile;
      x = x || 0; z = z || 0; yaw = yaw || 0;
      this.p = { x, y: 0, z }; this.v = { x: 0, y: 0, z: 0 };
      qYaw(yaw, this.q); this.w.x = this.w.y = this.w.z = 0;
      this.yaw = yaw; this.yawRate = 0; this.tf = 0; this.tr = 0; this._psi = yaw;
      this.motors = false; this.motor = [0, 0, 0, 0]; this.throttle = 0; this.onGround = true;
      this.crashed = false; this.crashReason = ''; this.tumble = null;
      this.mode = P.defaultMode; this.gps = true; this.link = true; this.sats = 18; this.linkQ = 100; this.videoOK = true;
      this.vision = true; this.sensorsOn = false; this.obstacle = null; this.paused = false;
      // visionFail = الحساسات اللي تحت ما تشوف الأرض (موية/أرض ملساء/تمرين). _gnssOnly = راح الـ GPS بس والحساسات شغالة
      this.visionFail = false; this._gnssOnly = false; this._visState = 1;
      this.battery = 100; this.soc = 1; this.drain = 1; this.batWarned = {}; this.mah = 0; this.amps = 0;
      this.voltage = ocv(P.bat.ocv, 1) * P.bat.cells; this.timeLeft = 0; this.rthSoc = 0; this._batOut = 100; this._vrc = 0;
      this.vCellF = this.voltage / P.bat.cells; this._lvT = -99; this._vSnap = false;   // FPV: جهد الخلية المفلتر (للتحذير)
      this.auto = null; this.rthPhase = null; this.rthAlt = 20; this.rthSetting = 20; this.home = { x, z };
      this.rthBlocked = false; this._rthBlkT = -99;
      // FPV: التسليح (ARM) مثل Betaflight: ما يتسلح والثروتل فوق، وما يطفي لحاله بعد الهبوط
      this._armThr = 0; this._armWarnT = -99; this._armGT = 0; this._armRemind = false;
      this.lastImpact = null; this.crashRest = null;
      this.landT = 0; this.cscT = 0; this.cscLatch = false; this.airborne = false;
      this.touchdown = null; this.events = []; this.load = 0; this.t = 0; this.flightTime = 0;
      this.maxAlt = 120; this.thrust = 0; this.vrs = false; this.vrsT = 0; this.vrsK = 0; this.propwash = 0;
      this.dist = { x: 0, z: 0 }; this.headingErr = 0; this.posNoise = { x: 0, z: 0 }; this._ny = 0;
      this.ceilT = -10; this.lastWind = { x: 0, y: 0, z: 0, gx: 0, gz: 0 };
      this.hoverThr = P.kind === 'fpv' ? this.calcHover() : 0.5;
      // داخلي
      this._T = 0; this._Tcmd = 0; this._b3x = 0; this._b3y = 1; this._b3z = 0;
      this._latched = false; this._latchT = 0; this._lx = x; this._lz = z;
      this._altLatched = false; this._altT = 0; this._altL = 0;
      this._ivx = 0; this._ivz = 0; this._ivy = 0;
      this._lkT = 0; this._lowT = 0; this._lostT = 0; this._goodT = 0; this._linkModelLost = false; this._weakT = -99;
      this._windT = 0; this._windWarnT = -99; this._gs = null;
      this._dRP = 0; this._dRPz = 0; this._fsT = 0; this._tipT = 0; this._hzS = 0; this._pwT = -1;
      this._P = 0; this._Iavg = 0; this._groundRef = null; this._gOffX = 0; this._gOffZ = 0; this._groundY = 0;
      this._envT = 0; this._mag = 0; this._magSig = 0; this._magWarnT = -99; this._wakeSig = 0; this._wkx = 0; this._wky = 0; this._wkz = 0; this._gustR = false;
      this._rthT0 = 0; this._hovT = 0; this._needCentre = false; this._obsWarnT = -99; this._fallen = false; this._senseT = -99; this._senseEnv = null;
      // FPV: وضع السلحفاة (CRASH FLIP) + ضوء الوميض (null = تلقائي بالليل)
      this.turtle = false; this.turtleCount = 0; this._flipT = -1; this._impact = 0; this._fyaw = 0; this.strobe = null;
      if (!this._fq0) { this._fq0 = { x: 0, y: 0, z: 0, w: 1 }; this._fq1 = { x: 0, y: 0, z: 0, w: 1 }; this._fqr = { x: 0, y: 0, z: 0, w: 1 }; this._fside = [false, false, false, false]; }
      for (let i = 0; i < 3; i++) { this._sf1[i] = this._sf2[i] = this._spPrev[i] = this._I[i] = this._wPrev[i] = 0; }
      for (let i = 0; i < 4; i++) { this._pw[i] = 0; this._eff[i] = 1; }
      // الخريطة الحقيقية (env.geo) + منطقة الحظر (env.fence) — تنعبى وقت الطيران بس
      this._geoG = null; this._geoT = 0; this._gpx = x; this._gpy = 0; this._gpz = z;
      this.geoFence = null; this.fenceBrake = false; this._gfSt = 0; this._gfWarnT = -99; this._gfNfzT = -99; this._gfTkT = -99;
      if (!this._gfq) this._gfq = { state: 0, d: 0, dWarn: 0, nx: 0, nz: 0 };
      const Wd = DS.World;   // يبدأ فوق الرمل لو مكان الإقلاع على كثيب
      if (Wd && Wd.terrainAt) { const gy = Wd.terrainAt(x, z); if (gy > 0) { this.p.y = gy; this._groundY = gy; } }
      this._derive();
    }

    // events: type = motors motorsOff crash info warn mode touchdown shutter rumble
    emit(type, text, extra) {
      const e = { type, text: text || '' };
      if (extra) { if (type === 'rumble') e.rumble = extra; else Object.assign(e, extra); }
      this.events.push(e); if (this.events.length > 40) this.events.shift();
    }
    rumble(strong, weak, ms) { this.emit('rumble', '', { strong, weak, ms }); }
    // ATTI لحاله بس إذا راح الـ GPS والحساسات اللي تحت ما تشوف الأرض مع بعض (DJI: dji.md §1.2)
    effMode() {
      const m = this.mode;
      if (this.profile.kind === 'dji' && !this.gps && !this.vision && (m === 'C' || m === 'P' || m === 'S')) return 'A';
      return m;
    }
    get flying() { return this.motors && !this.onGround; }
    get flipping() { return this.turtle && this._flipT >= 0; }   // وضع السلحفاة: يتقلب الحين
    rnd() { const r = this._env && this._env.rng; return r ? r() : Math.random(); }
    gauss() {
      if (this._gs != null) { const g = this._gs; this._gs = null; return g; }
      let u = this.rnd(); if (u < 1e-12) u = 1e-12;
      const r = Math.sqrt(-2 * Math.log(u)), a = TAU * this.rnd();
      this._gs = r * Math.sin(a); return r * Math.cos(a);
    }
    // ثروتل الثبات (FPV) حسب جهد البطارية
    calcHover() {
      const P = this.profile; if (P.kind !== 'fpv') return 0.5;
      const vs = (this.voltage || P.vRef) / P.vRef, f = (this.mass * G / 4) / (P.tMax * vs * vs);
      return U.clamp((Math.pow(Math.max(f, 1e-4), 1 / P.gamma) - P.idle) / (1 - P.idle), 0.05, 0.95);
    }

    startMotors() {
      if (this.crashed || this.motors || !this.onGround) return;
      if (this.battery <= 2) { this.emit('warn', 'البطارية فاضية'); return; }
      // منطقة حظر طيران (مثل DJI GEO): ما يشتغل ولا يقلع داخلها
      const F = this._env && this._env.fence;
      if (F && F.query(this.p.x, this.p.z, this._gfq).state === 3) {
        if (this.t - this._gfTkT > 2) { this._gfTkT = this.t; this.emit('warn', '⛔ ممنوع الإقلاع هنا — أنت داخل منطقة حظر طيران (' + (F.name || 'مطار') + ')'); }
        return;
      }
      // Betaflight: ما يتسلح إلا والثروتل تحت للآخر (حماية: ما يطير فجأة)
      if (this.profile.kind === 'fpv' && this._armThr > 0.05) {
        const S = DS.settings || {}, sm = S.stickMode;
        const how = S.fpvThrottle === 'trigger' ? 'فك زناد الثروتل (RT)' : 'نزّل الثروتل (' + (sm === 1 || sm === 3 ? 'العصا اليمين' : 'العصا اليسار') + ') تحت للآخر';
        if (this.t - this._armWarnT > 1.5) { this._armWarnT = this.t; this.emit('warn', 'ARMING DISABLED — ' + how + ' وبعدين شغّل المحركات (ARM)'); }
        return;
      }
      this.motors = true; this.airborne = false; this.landT = 0; this._armGT = 0; this._armRemind = false; this.crashRest = null;
      for (let i = 0; i < 3; i++) this._I[i] = 0;
      this.emit('motors', this.profile.kind === 'fpv' ? 'المحركات شغالة (ARM)' : 'المحركات اشتغلت');
    }
    stopMotors() {
      if (!this.motors) return;
      this.motors = false; this.auto = null; this.rthPhase = null; this.paused = false; this.rthBlocked = false; this.crashRest = null;
      this.emit('motorsOff', this.profile.kind === 'fpv' ? 'المحركات طفت (DISARM)' : 'المحركات طفت');
    }
    crash(reason) {
      if (this.crashed) return;
      this.crashed = true; this.motors = false; this.auto = null; this.rthPhase = null; this.paused = false; this.crashReason = reason || 'طاح';
      this.tumble = { x: (this.rnd() - 0.5) * 9, z: (this.rnd() - 0.5) * 9 };
      this.w.x += this.tumble.x; this.w.z += this.tumble.z; this.w.y += (this.rnd() - 0.5) * 4;
      this.emit('crash', this.crashReason); this.rumble(1, 1, 400);
    }
    autoTakeoff() {
      if (this.crashed || !this.onGround) return;
      if (!this.motors) this.startMotors();
      if (!this.motors) return;
      if (this.profile.kind === 'fpv') { this.emit('info', 'FPV ما فيه إقلاع تلقائي — ارفع الثروتل بيدك'); return; }
      this.auto = 'takeoff'; this.paused = false; this.emit('info', 'إقلاع تلقائي…');
    }
    autoLand() {
      if (this.onGround || !this.motors || this.auto === 'forced') return;
      if (this.profile.kind === 'fpv') { this.emit('info', 'FPV ما فيه هبوط تلقائي — نزّله بيدك'); return; }
      this.auto = 'land'; this.rthPhase = null; this.paused = false; this.emit('info', 'هبوط تلقائي… (ارفع ' + (DS.settings && DS.settings.stickMode === 1 ? 'العصا اليمين' : 'العصا اليسار') + ' للإلغاء)');
    }
    // هبوط اضطراري (ما ينلغي)
    forceLand(text) {
      if (!this.motors || this.onGround || this.crashed) return;
      this.auto = 'forced'; this.rthPhase = null; this.paused = false;
      this.emit('warn', text || 'هبوط اضطراري! حرّكه لمكان آمن وهو نازل');
    }
    cancelAuto() { this.auto = null; this.rthPhase = null; this.rthBlocked = false; }
    injectHeadingError(rad) { this.headingErr = +rad || 0; }
    // setGnss(true) = يرجع الـ GPS والحساسات. setGnss(false) = (للتوافق مع التمارين القديمة) راح الـ GPS
    // والحساسات اللي تحت مع بعض → ATTI. setGnss(false, {vision:true}) = راح الـ GPS بس: الحساسات تثبته
    // (تحت 30 م، بالنهار، فوق أرض مو موية) ولو طلع فوق 30 م أو أظلم يصير ATTI
    // (d.gps = false مباشرة = نفس setGnss(false). visionFail = true لحاله = الحساسات بس راحت والـ GPS يثبته)
    setGnss(ok, opt) {
      this.gps = !!ok; this.sats = ok ? 18 : 0;
      if (ok) { this._gnssOnly = false; this.visionFail = false; return; }
      const keepVis = !!(opt && typeof opt === 'object' && opt.vision === true);
      this._gnssOnly = keepVis;
      if (!keepVis) this.vision = false;   // على طول (بدون ما ننتظر الخطوة الجاية)
      this._visState = -1;
    }
    // نفس setGnss(false, opts): loseGnss() أو loseGnss({vision:false}) = الاثنين راحوا (ATTI)، {vision:true} = الـ GPS بس
    loseGnss(opts) { this.setGnss(false, opts || { vision: false }); }
    toggleRTH(failsafe) {
      if (this.auto === 'rth') {
        if (!this.link) return;
        this.auto = null; this.rthPhase = null; this.rthBlocked = false; this.paused = true; this._latched = false;
        this.emit('info', 'انلغى الرجوع للبيت — التحكم معك');
        return;
      }
      if (this.profile.kind === 'fpv') { this.emit('warn', 'الـ FPV ما فيه رجوع للبيت — رجّعه بيدك'); return; }
      if (!this.motors || this.onGround) { this.emit('info', 'الدرون على الأرض'); return; }
      if (!this.gps) { this.emit('warn', 'الرجوع للبيت ما يشتغل بدون GPS!'); return; }
      if (this.auto === 'forced') return;
      this.auto = 'rth'; this.rthPhase = 'brake'; this._rthT0 = this.t; this.paused = false; this.rthBlocked = false;
      this.rthAlt = Math.max(this.p.y, this.rthSetting);
      this.emit('info', failsafe ? 'انقطعت الإشارة — الدرون يرجع للبيت لحاله' : 'الرجوع للبيت (RTH) بدأ — اضغط B مرة وحدة للإلغاء');
    }
    // زر الإيقاف المؤقت (Flight Pause): يفرمل ويثبت لين تحرك العصي
    pause() {
      if (this.profile.kind === 'fpv') { this.emit('info', 'الـ FPV ما فيه توقف تلقائي — ثبّته بيدك'); return false; }
      if (!this.flying || this.crashed) return false;
      if (this.auto === 'forced') return false;
      if (this.auto) { this.auto = null; this.rthPhase = null; }
      if (this.effMode() === 'A' || this.mode === 'M') { this.emit('warn', 'ما يقدر يثبت لحاله في ATTI — ثبّته بيدك'); return false; }
      this.paused = true; this._latched = false; this._latchT = 0;
      this.emit('info', 'توقف ⏸ الدرون يفرمل ويثبت مكانه');
      return true;
    }
    setMode(m) {
      const md = DS.MODES[m];
      if (!md || md.af !== this.airframe) return;
      if (this.mode !== m) { this.mode = m; this._latched = false; this.emit('mode', md.name); }
    }

    checkBattery() {
      const b = this.battery, P = this.profile;
      if (P.kind === 'fpv') {
        // مثل Betaflight: على الجهد المفلتر (ما يتأثر بهبوط الجهد لحظة الدفعة القوية) ويرجع يتسلح لما يرتفع
        const B = P.bat, cell = this.vCellF > 0 ? this.vCellF : this.voltage / B.cells;
        if (this.motors && cell < B.warnCell && !this.batWarned.lv && this.t - this._lvT > 20) { this.batWarned.lv = 1; this._lvT = this.t; this.emit('warn', 'LOW BATTERY — البطارية ضعيفة، نزّل الحين'); }
        else if (this.batWarned.lv && cell > (B.warnClear || B.warnCell + 0.1)) this.batWarned.lv = 0;
        if (b <= 0 && this.motors) { if (this.flying) this.crash('البطارية خلصت والمحركات طفت في الجو'); else this.stopMotors(); }
        return;
      }
      if (b <= 30 && !this.batWarned[30]) { this.batWarned[30] = 1; this.emit('warn', 'بطارية ضعيفة (30%) — ارجع للبيت الحين'); }
      if (b <= 15 && !this.batWarned[15]) { this.batWarned[15] = 1; this.emit('warn', 'بطارية حرجة (15%)! هبّط فوراً'); }
      if (b <= 6 && !this.batWarned[6] && this.flying) {
        this.batWarned[6] = 1; this.auto = 'forced'; this.rthPhase = null; this.paused = false;
        this.emit('warn', 'البطارية خلصت تقريباً — الدرون ينزل لحاله الحين. حركه لمكان آمن وهو نازل');
      }
      if (this.flying && this.auto !== 'forced' && this.voltage / P.bat.cells < P.bat.cutCell) {
        this.batWarned.v = 1; this.forceLand('جهد البطارية طاح (برد أو حمل قوي) — هبوط اضطراري!');
      }
      if (b <= 0 && this.motors) { if (this.flying) this.crash('البطارية خلصت والمحركات طفت في الجو'); else this.stopMotors(); }
    }

    // أوامر الطيران التلقائي (إقلاع/هبوط/رجوع) → سرعات مطلوبة
    autoCmd(thr, pin) {
      const a = this.auto;
      if (!a) return null;
      if (!this.motors) { this.auto = null; this.rthPhase = null; return null; }
      if (this.profile.kind === 'fpv') { this.auto = null; this.rthPhase = null; return null; }
      const p = this.p, C = this._cmd, agl = p.y - this._groundY;   // الارتفاع عن السطح تحت (أرض، كثيب، منصة)
      C.vx = null; C.vz = null; C.vy = null; C.yaw = null; C.level = false;
      if (a === 'takeoff') {
        if (!this.onGround && agl >= 1.2) { this.auto = null; this.emit('info', 'خلص الإقلاع التلقائي ✓'); return null; }
        if (this.gps || this.vision) { C.vx = 0; C.vz = 0; } else C.level = true;
        C.vy = 1.5; C.yaw = this.yaw; return C;
      }
      if (a === 'land' || a === 'forced') {
        if (a === 'land' && thr > 0.5) { this.auto = null; this.emit('info', 'انلغى الهبوط التلقائي'); return null; }
        let vy = agl > 3 ? -1.5 : -0.7;
        if (a === 'forced') {   // B15: العصا اليسار تتحكم بسرعة النزول (فوق = أبطأ، تحت = أسرع)
          const md = DS.MODES[this.effMode()] || DS.MODES.P;
          vy = thr > 0 ? vy * (1 - thr) : vy + thr * Math.max(0, (md.maxDown || 3) - Math.abs(vy));
        }
        C.vy = vy; return C;
      }
      if (a === 'rth') {
        if (!this.gps) { this.auto = null; this.rthPhase = null; this.emit('warn', 'انلغى الرجوع للبيت: راح الـ GPS'); return null; }
        const h = this.home, dx = h.x - p.x, dz = h.z - p.z, d = Math.hypot(dx, dz), brg = Math.atan2(dx, -dz);
        const hold = U.clamp(1.2 * (this.rthAlt - p.y), -3, 3);   // يثبت على ارتفاع الرجوع
        switch (this.rthPhase) {
          case 'brake':
            C.vx = 0; C.vz = 0; C.vy = 0; C.yaw = this.yaw;
            if (this.t - this._rthT0 > 1 && Math.hypot(this.v.x, this.v.z) < 1) {
              if (d < 5) this.rthPhase = 'descend';
              else {
                this.rthAlt = d > 50 ? Math.max(p.y, this.rthSetting) : Math.max(p.y, 2);
                this.rthPhase = p.y < this.rthAlt - 0.3 ? 'climb' : 'turn';
              }
            }
            return C;
          case 'climb':
            if (p.y >= this.rthAlt - 0.3) this.rthPhase = 'turn';
            C.vx = 0; C.vz = 0; C.vy = 4; C.yaw = this.yaw; return C;
          case 'turn':
            if (Math.abs(U.wrap(brg - this.yaw)) < 0.12 || d < 3) this.rthPhase = 'cruise';
            C.vx = 0; C.vz = 0; C.vy = hold; C.yaw = brg; return C;
          case 'cruise': {
            if (pin < -0.9) {   // العصا لورا للآخر = فرامل وخروج من الرجوع
              this.auto = null; this.rthPhase = null; this.rthBlocked = false; this.paused = true; this._latched = false; this._needCentre = true;
              this.emit('info', 'وقف الرجوع للبيت (العصا لورا) — فك العصي والتحكم يرجع لك'); return null;
            }
            // عائق قدام الرجوع: الحساسات فرملته → يوقف ويثبت مكانه (ما يصعد فوقه لحاله) لين تلغي وتتحكم
            const ob = this.obstacle;
            if (!this.rthBlocked && ob && ob.braking && ob.dist < (this.profile.sense ? this.profile.sense.standoff : 1.5) + 2.5 && Math.hypot(this.v.x, this.v.z) < 1.2) {
              this.rthBlocked = true; this._rbx = p.x; this._rbz = p.z;
              if (this.t - this._rthBlkT > 8) { this._rthBlkT = this.t; this.emit('warn', 'فيه عائق قدام الرجوع — الدرون وقف. ألغِ الرجوع (B) وتحكم بيدك'); this.rumble(0.5, 0.5, 300); }
            }
            if (this.rthBlocked) {   // يثبت على نقطة الوقوف
              C.vx = U.clamp(0.8 * (this._rbx - p.x), -2, 2); C.vz = U.clamp(0.8 * (this._rbz - p.z), -2, 2); C.vy = hold; C.yaw = this.yaw;
              return C;
            }
            if (d < 0.8) this.rthPhase = 'descend';
            const sp = U.clamp(U.clamp(0.6 * d, 0.5, this.profile.rthSpeed) + pin * 4, 0.5, 16);
            C.vx = Math.sin(brg) * sp; C.vz = -Math.cos(brg) * sp; C.vy = hold; C.yaw = d > 3 ? brg : this.yaw;
            return C;
          }
          default: {
            this.rthPhase = 'descend';
            C.vy = agl > 5 ? -2.5 : agl > 1.5 ? -1.2 : -0.6;
            C.vx = U.clamp(0.8 * dx, -2, 2); C.vz = U.clamp(0.8 * dz, -2, 2); C.yaw = this.yaw;
            return C;
          }
        }
      }
      return null;
    }

    // ---------- خطوة وحدة (عادة 1/120 ث) — داخلياً 480 هرتز ----------
    // c = {thr,yaw,pitch,roll} من -1 إلى 1 (+ throttle01 للـ FPV)، env = {wind, colliders, taskColliders, isWater, blockers, rng, dark}
    step(dt, c, env) {
      c = c || NOC; env = env || NOENV; this._env = env;
      this.t += dt;
      if (this.crashed) { this.fall(dt, env); this._derive(); return; }
      const fpv = this.profile.kind === 'fpv';
      let thr = +c.thr || 0, yin = +c.yaw || 0, pin = +c.pitch || 0, rin = +c.roll || 0;
      let t01 = c.throttle01;
      if (!this.link) { thr = yin = pin = rin = 0; t01 = null; }
      thr = U.clamp(thr, -1, 1); yin = U.clamp(yin, -1, 1); pin = U.clamp(pin, -1, 1); rin = U.clamp(rin, -1, 1);
      // FPV: الثروتل الحين (لفحص التسليح)
      if (fpv) this._armThr = (t01 == null || isNaN(t01)) ? Rates.gpThrottle(thr, this.hoverThr, 0.45) : U.clamp(+t01, 0, 1);
      if (this.auto !== 'rth') this.rthBlocked = false;

      // CSC: العصاتين لتحت وللداخل (أو للخارج) = تشغيل/إطفاء المحركات على الأرض
      const csc = thr < -0.55 && pin < -0.55 && Math.abs(yin) > 0.45 && Math.abs(rin) > 0.45 && Math.sign(yin) === -Math.sign(rin);
      if (csc) {
        this.cscT += dt;
        if (this.cscT > 0.35 && !this.cscLatch) {
          this.cscLatch = true;
          if (this.onGround) { if (this.motors) this.stopMotors(); else this.startMotors(); }
        }
      } else { this.cscT = 0; this.cscLatch = false; }

      const W = env.wind ? env.wind.at(Math.max(this.p.y, 0), this.lastWind) : ZW;
      if (W !== ZW && this._wakeSig > 0) { W.x += this._wkx; W.z += this._wkz; W.y += this._wky; }
      const gev = env.wind && env.wind.ev;   // هبة مفاجئة → رجّة في اليد
      if (gev && gev.on && gev.amp > 2.5 && !this._gustR && this.flying) { this._gustR = true; this.rumble(U.clamp(gev.amp / 8, 0.3, 1), 0.3, Math.min(600, gev.dur * 400)); }
      else if (!(gev && gev.on)) this._gustR = false;
      this._battery(dt);
      if (this.crashed) { this._derive(); return; }
      this._link(dt, env);
      this._sensors(dt, env);
      if (env.fence) this._fenceTick(env); else this.geoFence = null;
      if (this.turtle) { this._stepTurtle(dt, env); this._derive(); return; }
      // بعد الخروج من الرجوع بالعصا لورا: التحكم يرجع بعد ما تفك العصي
      if (this._needCentre) {
        if (Math.abs(pin) < 0.1 && Math.abs(rin) < 0.1 && Math.abs(yin) < 0.1 && Math.abs(thr) < 0.1) this._needCentre = false;
        else { thr = yin = pin = rin = 0; }
      }
      if (this.paused && (Math.abs(pin) > 0.15 || Math.abs(rin) > 0.15 || Math.abs(yin) > 0.15 || Math.abs(thr) > 0.15)) this.paused = false;

      if (fpv) this._stepFpv(dt, env, thr, yin, pin, rin, t01, W);
      else this._stepMini(dt, env, thr, yin, pin, rin, W);
      if (this.crashed) { this._derive(); return; }

      // طفي المحركات بعد الهبوط (DJI): خل العصا اليسار تحت
      // FPV (Betaflight): ما يطفي لحاله أبد — لازم تطفيه أنت (DISARM: A مطوّل أو CSC)
      if (this.onGround && this.motors) {
        const autoL = this.auto === 'land' || this.auto === 'forced' || this.auto === 'rth';
        if (fpv) {
          this.landT = 0;
          if (this.airborne) {
            this._armGT += dt;
            if (this._armGT > 2 && !this._armRemind) { this._armRemind = true; this.emit('info', 'المحركات لسا شغالة (ARMED) — طفّها (DISARM): A مطوّل أو CSC'); }
          }
        } else if (autoL) { this.landT += dt; if (this.landT > 1) this.stopMotors(); }
        else if (thr < -0.7 && !csc) { this.landT += dt; if (this.landT > (this.airborne ? 1 : 3)) this.stopMotors(); }
        else this.landT = 0;
      } else { this.landT = 0; this._armGT = 0; if (!this.onGround) this._armRemind = false; }
      if (!this.onGround) this.flightTime += dt;
      this._derive();
      // الحمل (للصوت ودوران المراوح)
      let ms = 0; for (let i = 0; i < 4; i++) ms += this.motor[i]; ms /= 4;
      const hs = this.profile.kind === 'fpv' ? Math.sqrt(0.25 * this.mass * G / this.profile.tMax) : Math.sqrt(1 / this.profile.twr);
      this.load = this.motors ? U.clamp(0.45 * Math.pow(ms / hs, 1.5), 0.2, 1) : 0;
      this.thrust = this._T / (this.mass * G);
    }

    // ---------- DJI: كاسكيد (مكان ← سرعة ← ميلان ← دوران ← محركات) ----------
    _stepMini(dt, env, thr, yin, pin, rin, W) {
      const P = this.profile, AT = P.att, S = DS.settings || {}, m = this.mass;
      const cmd = this.autoCmd(thr, pin);
      const mode = this.effMode(), M = DS.MODES[mode] || DS.MODES.P;
      const air = this.motors && !this.onGround;
      const p = this.p, v = this.v;
      this.fenceBrake = false;

      // ---- اللف (مع نعومة DJI)
      let yr;
      if (cmd && cmd.yaw != null) yr = U.clamp(2.2 * U.wrap(cmd.yaw - this.yaw), -1, 1) * Math.min(M.yawRate, 90) * D2R;
      else yr = yin * M.yawRate * D2R;
      if (!this.motors || this.onGround) yr = 0;
      const tauS = 0.05 + 0.01 * (M.smooth != null ? M.smooth : 12);
      this.yawRate += (yr - this.yawRate) * (1 - Math.exp(-dt / tauS));
      this._psi = U.wrap(this._psi + this.yawRate * dt);
      const pe = U.wrap(this._psi - this.yaw);
      if (pe > 0.5) this._psi = U.wrap(this.yaw + 0.5); else if (pe < -0.5) this._psi = U.wrap(this.yaw - 0.5);
      if (this.onGround) this._psi = this.yaw;

      // ---- السرعة العمودية المطلوبة
      const yEst = p.y + this._ny;
      let vys = 0;
      if (cmd && cmd.vy != null) { vys = cmd.vy; this._altLatched = false; this._altT = 0; }
      else if (mode === 'M') vys = 0;
      else if (Math.abs(thr) < 0.02) {
        this._altT += dt;
        if (!this._altLatched && this._altT > 0.3 && Math.abs(v.y) < 0.3) { this._altLatched = true; this._altL = yEst; }
        vys = this._altLatched ? U.clamp(1.2 * (this._altL - yEst), -1.5, 1.5) : 0;
      } else { this._altLatched = false; this._altT = 0; vys = thr >= 0 ? thr * M.maxUp : thr * M.maxDown; }
      // B1: يهدّي قبل السقف بدل ما يتعداه
      const room = this.maxAlt - 0.3 - p.y;
      if (vys > 1.2 * room) {
        vys = Math.max(-2, 1.2 * room);
        if (this._ivy > 0) this._ivy = 0;
        if (air && room < 1 && this.t - this.ceilT > 10) { this.ceilT = this.t; this.emit('warn', 'وصلت أقصى ارتفاع مسموح (' + this.maxAlt + ' م)'); }
      }
      // حماية الهبوط (حساسات تحت): يبطّي قرب الأرض
      const agl = p.y - this._groundY;
      if (this.vision && S.sensors !== false && mode !== 'A' && mode !== 'M') {
        if (agl < 1.5) vys = Math.max(vys, -0.8); else if (agl < 5) vys = Math.max(vys, -2.2);
      }

      // ---- الحركة الأفقية
      // تثبيت المكان: بالـ GPS، أو بالحساسات اللي تحت لحالها (بدون GPS: تحت 30 م بالنهار)
      const gpsCtl = (this.gps || this.vision) && ((cmd && cmd.vx != null) || mode === 'C' || mode === 'P' || mode === 'S');
      const tiltMax = M.tilt * D2R, gtan = G * Math.tan(tiltMax);
      let ax = 0, az = 0, attMode = false;
      if (air && gpsCtl) {
        const ex = p.x + this.posNoise.x, ez = p.z + this.posNoise.z;
        const psiHat = this.yaw + this.headingErr + this._mag, sh = Math.sin(psiHat), ch = Math.cos(psiHat);
        let vxs, vzs;
        const centred = Math.abs(pin) < 0.02 && Math.abs(rin) < 0.02;
        if (cmd && cmd.vx != null) { vxs = cmd.vx; vzs = cmd.vz; this._latched = false; this._latchT = 0; }
        else if (this.paused || centred) {
          this._latchT += dt;
          if (!this._latched && this._latchT > 0.3 && Math.hypot(v.x, v.z) < 0.5) { this._latched = true; this._lx = ex; this._lz = ez; }
          if (this._latched) {
            vxs = P.kpos * (this._lx - ex); vzs = P.kpos * (this._lz - ez);
            const vm = Math.hypot(vxs, vzs); if (vm > 3) { vxs *= 3 / vm; vzs *= 3 / vm; }
          } else { vxs = 0; vzs = 0; }
        } else {
          this._latched = false; this._latchT = 0;
          const f = pin * M.maxH, r = rin * M.maxH;
          vxs = sh * f + ch * r; vzs = -ch * f + sh * r;
          const vm = Math.hypot(vxs, vzs); if (vm > M.maxH) { vxs *= M.maxH / vm; vzs *= M.maxH / vm; }
        }
        // اضطراب خارجي (بوصلة/هروب) — المكان المثبّت يمشي معه
        vxs += this.dist.x; vzs += this.dist.z;
        if (this._latched) { this._lx += this.dist.x * dt; this._lz += this.dist.z * dt; }
        // منطقة حظر الطيران (DJI GEO): يفرمل قبل الحد وما يدخل (بالـ GPS)
        const gq = this.geoFence;
        if (gq && gq.d < 600) {
          const aF = 0.6 * gtan * (M.brake || 1), toward = -(vxs * gq.nx + vzs * gq.nz);
          const allow = gq.d > 25 ? Math.sqrt(2 * aF * (gq.d - 25)) : -Math.min(3, (25 - gq.d) * 0.25);   // داخل الهامش: يرجع لورا شوي شوي
          if (toward > allow) {
            const k = toward - allow; vxs += k * gq.nx; vzs += k * gq.nz; this.fenceBrake = true;
            if (this._latched) { this._lx = ex + vxs * 0.5; this._lz = ez + vzs * 0.5; }
          }
        }
        // حساسات العوائق: تفرمل قبل العائق
        if (this.sensorsOn) { const o = this._sense(env, vxs, vys, vzs, M); vxs = o.x; vys = o.y; vzs = o.z; }
        else this.obstacle = null;
        // حلقة السرعة (PI) + تعويض السحب المتوقع على السرعة الحالية (الريح يصححها التكامل)
        const kv = P.kv[mode] || 2, evx = vxs - v.x, evz = vzs - v.z;
        const dg = P.drag.lin + 0.5 * RHO * P.drag.cda / m * Math.hypot(v.x, v.z);
        ax = kv * evx + this._ivx + dg * v.x; az = kv * evz + this._ivz + dg * v.z;
        let am = Math.hypot(ax, az);
        const braking = ax * v.x + az * v.z < 0;
        // الفرملة: حد التباطؤ = g·tan(ميلان الفرملة) × حساسية الفرامل (N ≈ 26° → يوقف من 12 م/ث بـ 12–14 م)
        const lim = braking ? gtan * (M.brake || 1) * U.clamp((S.brakeSens || 100) / 100, 0.1, 1.5) : gtan * 1.2;
        if (am > lim) { ax *= lim / am; az *= lim / am; am = lim; }
        if (am < gtan * 0.95) {
          this._ivx += P.kiV * evx * dt; this._ivz += P.kiV * evz * dt;
          const im = Math.hypot(this._ivx, this._ivz), iml = 0.6 * gtan; if (im > iml) { this._ivx *= iml / im; this._ivz *= iml / im; }
        }
        // البوصلة الخربانة: الدرون يحسب اتجاهه غلط فالتسارع يطلع مدوّر
        const he = this.headingErr + this._mag;
        if (he) { const ce = Math.cos(-he), se = Math.sin(-he), tx = ax * ce - az * se; az = ax * se + az * ce; ax = tx; }
      } else {
        this.obstacle = null;
        this._ivx *= 0.98; this._ivz *= 0.98; this._latched = false;
        if (air) {   // ATTI/يدوي: العصا = زاوية ميلان، النص = مستوي (ينجرف مع الريح)
          attMode = true;
          let tp = Math.tan(pin * tiltMax), tr = Math.tan(rin * tiltMax);
          if (cmd && cmd.level) { tp = 0; tr = 0; }
          const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
          ax = G * (sy * tp + cy * tr); az = G * (-cy * tp + sy * tr);
          // ATTI عند حد منطقة الحظر: ما فيه GPS يوقفه — ندفه لورا شوي ونحذر (التصحيح عليك)
          const gq = this.geoFence;
          if (gq && gq.d < 60) {
            const k = U.clamp((60 - gq.d) / 60, 0, 1.5) * 0.7 * G * Math.tan(tiltMax);   // داخل الحد يقوى (ما يقدر يدخل بعيد)
            ax += gq.nx * k; az += gq.nz * k; this.fenceBrake = true;
          }
        }
      }

      // ---- الدفع العمودي
      const A = axes(this.q, this.A);
      let ayc = 0;
      if (mode !== 'M' || (cmd && cmd.vy != null)) {
        const evy = vys - v.y;
        ayc = U.clamp(P.kvz * evy + this._ivy, -P.aVmax, P.aVmax);
        if (air) this._ivy = U.clamp(this._ivy + P.kiZ * evy * dt, -2, 2); else this._ivy = 0;
      }
      // اتجاه الدفع المطلوب (b3) مع حد الميلان
      let b3x, b3y, b3z;
      if (attMode) { b3x = ax / G; b3y = 1; b3z = az / G; }
      else { b3x = ax; b3y = Math.max(1, G + ayc); b3z = az; }
      let hm = Math.hypot(b3x, b3z);
      const hmax = b3y * Math.tan(tiltMax);
      if (hm > hmax) { b3x *= hmax / hm; b3z *= hmax / hm; hm = hmax; }
      const bn = 1 / Math.hypot(b3x, b3y, b3z); b3x *= bn; b3y *= bn; b3z *= bn;
      this._b3x = b3x; this._b3y = b3y; this._b3z = b3z;
      // تحذير الهواء القوي: الميلان قريب من الحد وهو يحاول يثبت
      if (air && gpsCtl && Math.acos(U.clamp(b3y, -1, 1)) > 0.7 * tiltMax && Math.hypot(v.x, v.z) < 2.5) {
        this._windT += dt;
        if (this._windT > 2 && this.t - this._windWarnT > 40) { this._windWarnT = this.t; this.emit('warn', 'هواء قوي — طر بحذر، انزل لارتفاع أقل أو حوّل S'); }
      } else this._windT = 0;

      // الوضعية المطلوبة من b3 والاتجاه
      const hx = Math.sin(this._psi), hz = -Math.cos(this._psi);
      let rx = -hz * b3y, ry = hz * b3x - hx * b3z, rz = hx * b3y;   // h × b3
      const rn = 1 / (Math.hypot(rx, ry, rz) || 1); rx *= rn; ry *= rn; rz *= rn;
      const bkx = ry * b3z - rz * b3y, bky = rz * b3x - rx * b3z, bkz = rx * b3y - ry * b3x;   // right × b3
      qFromBasis(rx, ry, rz, b3x, b3y, b3z, bkx, bky, bkz, this._qd);

      // الدفع المطلوب
      const vScale = U.clamp(Math.pow(this.voltage / (P.bat.cells * 3.9), 2), 0.3, 1);
      const tMaxNow = this.tMax * vScale;
      let Tc;
      if (!this.motors) Tc = 0;
      else if (mode === 'M' && !(cmd && cmd.vy != null)) Tc = m * G * (1 + 0.6 * thr);
      else Tc = m * (G + ayc) / Math.max(0.5, A.uy);
      if (this.motors && this.onGround) {
        const lift = (cmd && cmd.vy != null) ? cmd.vy > 0.2 : (mode === 'M' ? thr > 0.08 : thr > 0.12);
        if (!lift || !this.link) Tc = 0.08 * this.tMax;
      }
      if (this.motors) Tc = U.clamp(Tc, 0.06 * this.tMax, tMaxNow);
      this._Tcmd = Tc;

      // اضطرابات (VRS + تأثير الأرض) على الدوران
      this._disturb(dt, agl, W);

      // ---- الخطوات الداخلية 480 هرتز
      const n = Math.max(1, Math.round(dt * HZ)), h = dt / n;
      const kT = 1 - Math.exp(-h / P.tauT), kR = h / AT.tauRate;
      const dr = P.drag, kq = 0.5 * RHO * dr.cda / m, kqv = 0.5 * RHO * dr.cdaV / m;
      const qe = this._qe, q = this.q, w = this.w;
      for (let i = 0; i < n; i++) {
        axes(q, A);
        if (this.onGround) {
          this._T += (this._Tcmd - this._T) * kT;
          if (this.motors && this._Tcmd > m * G && this._T * this._geFactor(0.02) > m * G * 1.01 && this.link) { this.onGround = false; this.airborne = true; this._groundRef = null; v.y = Math.max(v.y, 0.05); }
          else { this._holdGround(); continue; }
        }
        // خطأ الوضعية → سرعة الدوران المطلوبة
        qe.x = -q.x; qe.y = -q.y; qe.z = -q.z; qe.w = q.w; qmul(qe, this._qd, qe);
        if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; }
        const yff = this.yawRate;   // تغذية أمامية للف حول محور العالم
        let sx = 2 * qe.x / AT.tauTilt - yff * A.ry, sy = 2 * qe.y / AT.tauYaw - yff * A.uy, sz = 2 * qe.z / AT.tauTilt - yff * A.by;
        sx = U.clamp(sx, -AT.wRP, AT.wRP); sz = U.clamp(sz, -AT.wRP, AT.wRP); sy = U.clamp(sy, -AT.wY, AT.wY);
        w.x += U.clamp((sx - w.x) * kR / h, -AT.aRP, AT.aRP) * h + this._dRP * h;
        w.y += U.clamp((sy - w.y) * kR / h, -AT.aY, AT.aY) * h;
        w.z += U.clamp((sz - w.z) * kR / h, -AT.aRP, AT.aRP) * h + this._dRPz * h;
        qIntegrate(q, w.x, w.y, w.z, h, this._qt);
        axes(q, A);
        // المحركات (تأخر) والقوى
        this._T += (this._Tcmd - this._T) * kT;
        const vrsEff = 1 - 0.3 * this.vrsK;
        const Teff = this._T * vrsEff * this._geFactor(p.y - this._groundY);
        const vax = v.x - W.x, vay = v.y - W.y, vaz = v.z - W.z, vh = Math.hypot(vax, vaz);
        const fx = Teff * A.ux / m - (dr.lin + kq * vh) * vax;
        const fy = Teff * A.uy / m - G - (dr.linV + kqv * Math.abs(vay)) * vay;
        const fz = Teff * A.uz / m - (dr.lin + kq * vh) * vaz;
        v.x += fx * h; v.y += fy * h; v.z += fz * h;
        p.x += v.x * h; p.y += v.y * h; p.z += v.z * h;
        if (this._ground(env, A) || this.crashed) break;
        if (this._collide(env, h) || this.crashed) break;
      }
      // المحركات الأربع (شكلية): سرعة الدوران من الدفع + فرق بسيط حسب الدوران
      const base = Math.sqrt(U.clamp(this._T / this.tMax, 0, 1));
      for (let i = 0; i < 4; i++) this.motor[i] = this.motors ? U.clamp(base + 0.03 * (MOT_F[i] * w.x + MOT_X[i] * w.z), 0, 1) : 0;
      this.throttle = this.motors ? U.clamp(this._T / this.tMax, 0, 1) : 0;
      this._vrsUpdate(dt, W);
    }

    // تأثير الأرض: دفع زيادة قريب من الأرض
    _geFactor(z) {
      const R = this.profile.rotorR; if (z > 4 * R) return 1;
      const zz = Math.max(z + 0.03, R * 0.5), k = R / (4 * zz);
      return Math.min(1.3, 1 / (1 - k * k));
    }
    // اضطرابات الدوران: VRS (رجّة) + هوا قريب من الأرض
    _disturb(dt, agl, W) {
      const k = Math.exp(-dt / 0.3), ks = Math.sqrt(1 - k * k);
      let sig = 0;
      if (this.vrsK > 0) sig += 7 * this.vrsK;
      if (this.flying && agl < 4 * this.profile.rotorR * 2) sig += 2.5;
      if (sig > 0) { this._dRP = k * this._dRP + sig * ks * this.gauss(); this._dRPz = k * this._dRPz + sig * ks * this.gauss(); }
      else { this._dRP *= k; this._dRPz *= k; }
    }
    // دوامة المراوح (VRS): نزول عمودي سريع بدون حركة أفقية
    _vrsUpdate(dt, W) {
      const vh = this.profile.vh || 3.7;
      const hAir = Math.hypot(this.v.x - W.x, this.v.z - W.z), vd = -(this.v.y - W.y);
      const fl = this.flying;
      if (fl && vd > vh && hAir < 0.7 * vh) this.vrsT += dt; else this.vrsT = Math.max(0, this.vrsT - dt * 2);
      if (!this.vrs && this.vrsT > 0.7) { this.vrs = true; this.emit('warn', 'دخل في دوامة المراوح (VRS)! حركه لقدام أو للجنب عشان يطلع منها'); }
      if (this.vrs) {
        const sev = U.clamp((vd / vh - 0.6) / 0.6, 0, 1) * U.clamp(1 - hAir / (0.9 * vh), 0, 1);
        this.vrsK += (sev - this.vrsK) * Math.min(1, dt / 0.25);
        if (this.t - this._pwT > 0.25) { this._pwT = this.t; this.rumble(0.6 * Math.max(0.3, this.vrsK), 0.2, 150); }
        if (hAir > 0.9 * vh || vd < 0.5 * vh || !fl) {
          this.vrs = false; this.vrsT = 0;
          if (fl) this.emit('info', 'طلع من الدوامة ✓');
        }
      } else this.vrsK = Math.max(0, this.vrsK - dt * 3);
    }

    // ---------- FPV: Betaflight (Acro / Angle / Horizon) + خالط + محركات + جسم صلب ----------
    _stepFpv(dt, env, thr, yin, pin, rin, t01, W) {
      const P = this.profile, S = DS.settings || {}, RT = Rates.get(), m = this.mass;
      const mode = DS.MODES[this.mode] && DS.MODES[this.mode].af === 'fpv' ? this.mode : 'ANGLE';
      this.obstacle = null; this.sensorsOn = false;
      // الثبات يتغير مع البطارية → نحدثه كل ثانية
      this._hovT += dt;
      if (this._hovT > 1) { this._hovT = 0; this.hoverThr = this.calcHover(); if (DS.Input) DS.Input.hover = this.hoverThr; }
      let th = (t01 == null || isNaN(t01)) ? Rates.gpThrottle(thr, this.hoverThr, 0.45) : +t01;
      th = U.clamp(th, 0, 1);
      // فقدان الإشارة (Failsafe): ثانية مستوي ثم يطفي
      let fs = false;
      if (!this.link && this.motors) {
        this._fsT += dt; fs = true;
        th = this.hoverThr;
        if (this._fsT > 1 && !this.onGround) { this.emit('warn', 'FAILSAFE — انقطعت الإشارة والدرون طفى'); this.stopMotors(); }
      } else this._fsT = 0;
      if (!this.motors) th = 0;
      this.throttle = th;

      // سرعات العصي (درجة/ثانية، اصطلاح الطيار)
      const rRoll = Rates.axis(rin, false, RT), rPitch = Rates.axis(pin, false, RT), rYaw = Rates.axis(yin, true, RT);
      const rMax = Math.max(1, Rates.axis(1, false, RT)), AN = P.angle;
      const tRoll = fs ? 0 : AN.limit * rRoll / rMax, tPitch = fs ? 0 : AN.limit * rPitch / rMax;
      const sStick = Math.max(0, 1 - Math.max(Math.abs(rin), Math.abs(pin)) / AN.hzSticks);
      const lim = P.maxRate;

      const n = Math.max(1, Math.round(dt * HZ)), h = dt / n;
      const vs = U.clamp(this.voltage / P.vRef, 0.3, 1.05), teff = P.tMax * vs * vs;
      const fIdle = Math.pow(P.idle, P.gamma), u = P.idle + (1 - P.idle) * th, fc0 = this.motors ? Math.pow(u, P.gamma) : 0;
      const kUp = 1 - Math.exp(-h / P.tauUp), kDn = 1 - Math.exp(-h / P.tauDn), kPT = 1 - Math.exp(-TAU * 40 * h);
      const J = P.J, dr = P.drag, a4 = 4 * P.arm, rp = P.pid.rp, py = P.pid.y;
      const airmode = S.airmode !== false;
      const A = this.A, q = this.q, w = this.w, p = this.p, v = this.v, sp = this._sp;
      const pwOn = this.propwash > 0, vPitch = P.propPitch * P.wMax / TAU * (P.vpk || 1);
      let Pacc = 0;
      for (let i = 0; i < n; i++) {
        axes(q, A);
        // ---- السرعة المطلوبة للدوران (rad/s، محاور three.js)
        let sx, sy, sz;
        if (mode === 'ACRO' && !fs) { sx = -rPitch * D2R; sy = -rYaw * D2R; sz = -rRoll * D2R; }
        else {
          const roll = Math.atan2(-A.ry, A.uy) * R2D, pitch = Math.atan2(A.by, Math.hypot(A.ry, A.uy)) * R2D;
          const aR = U.clamp(AN.gain * (tRoll - roll), -lim, lim), aP = U.clamp(AN.gain * (tPitch - pitch), -lim, lim);
          if (mode === 'HORIZON' && !fs) {
            const sInc = Math.max(0, (AN.hzLimit - Math.max(Math.abs(roll), Math.abs(pitch))) / AN.hzLimit);
            const sT = Math.min(sInc, sStick) * AN.hzGain;
            this._hzS = sT < this._hzS ? sT : this._hzS + (sT - this._hzS) * (h / AN.hzDelay);
            const s = this._hzS, pr = rRoll * (1 - s) + aR * s, pq = rPitch * (1 - s) + aP * s;
            sx = -pq * D2R; sy = -rYaw * D2R; sz = -pr * D2R;
          } else {
            const ry = fs ? 0 : rYaw * D2R;   // اللف حول محور الأرض
            sx = -aP * D2R - ry * A.ry; sy = -ry * A.uy; sz = -aR * D2R - ry * A.by;
          }
        }
        sp[0] = sx; sp[1] = sy; sp[2] = sz;
        // ---- PID السرعة (في مجال العزم)
        let ax_ = 0, ay_ = 0, az_ = 0;
        const active = this.motors && !this.onGround;
        for (let k = 0; k < 3; k++) {
          const g = k === 1 ? py : rp, wk = k === 0 ? w.x : k === 1 ? w.y : w.z;
          this._sf1[k] += (sp[k] - this._sf1[k]) * kPT; this._sf2[k] += (this._sf1[k] - this._sf2[k]) * kPT;
          const dsp = (this._sf2[k] - this._spPrev[k]) / h; this._spPrev[k] = this._sf2[k];
          const dw = (wk - this._wPrev[k]) / h; this._wPrev[k] = wk;
          let out = 0;
          if (active) {
            const e = this._sf2[k] - wk;
            if (Math.abs(dsp) < 8.73) { this._I[k] += e * h; const il = 0.3 * g.auth / g.ki; if (this._I[k] > il) this._I[k] = il; else if (this._I[k] < -il) this._I[k] = -il; }
            out = g.kp * e + g.ki * this._I[k] + g.kff * dsp - g.kd * dw;
          } else this._I[k] = 0;
          if (k === 0) ax_ = out; else if (k === 1) ay_ = out; else az_ = out;
        }
        // ---- الخالط (X) + Airmode
        const tx = J.x * ax_, ty = J.y * ay_, tz = J.z * az_;
        let d0 = (MOT_F[0] * tx / a4 + MOT_X[0] * tz / a4 + MOT_DIR[0] * ty / (4 * P.kq)) / teff;
        let d1 = (MOT_F[1] * tx / a4 + MOT_X[1] * tz / a4 + MOT_DIR[1] * ty / (4 * P.kq)) / teff;
        let d2 = (MOT_F[2] * tx / a4 + MOT_X[2] * tz / a4 + MOT_DIR[2] * ty / (4 * P.kq)) / teff;
        let d3 = (MOT_F[3] * tx / a4 + MOT_X[3] * tz / a4 + MOT_DIR[3] * ty / (4 * P.kq)) / teff;
        let fc = fc0;
        if (active) {
          if (!airmode && th < 0.5) { const k = 0.5 + th; d0 *= k; d1 *= k; d2 *= k; d3 *= k; }
          let lo = Math.min(d0, d1, d2, d3), hi = Math.max(d0, d1, d2, d3);
          const span = hi - lo, roomF = 1 - fIdle;
          if (span > roomF) { const k = roomF / span; d0 *= k; d1 *= k; d2 *= k; d3 *= k; lo *= k; hi *= k; }
          if (airmode) fc = U.clamp(fc, fIdle - lo, 1 - hi);
        } else { d0 = d1 = d2 = d3 = 0; }
        // ---- المحركات (تأخر) والدفع
        const vax = v.x - W.x, vay = v.y - W.y, vaz = v.z - W.z;
        const vAx = vax * A.ux + vay * A.uy + vaz * A.uz;   // الهواء على محور الدفع
        const ge = this._geFactor(p.y - this._groundY);
        let Tsum = 0, tqx = 0, tqy = 0, tqz = 0, sbar = 0;
        for (let k = 0; k < 4; k++) {
          const dk = k === 0 ? d0 : k === 1 ? d1 : k === 2 ? d2 : d3;
          const f = this.motors ? U.clamp(fc + dk, 0, 1) : 0;
          const sc = vs * Math.sqrt(f), s0 = this.motor[k];
          const s = s0 + (sc - s0) * (sc > s0 ? kUp : kDn);
          this.motor[k] = s; sbar += s;
          const Vp = Math.max(1, vPitch * s), inflow = U.clamp(1 - vAx / Vp, 0, 1.15);
          let Ti = P.tMax * s * s * inflow * this._eff[k] * ge;
          if (pwOn) Ti *= 1 - 0.25 * this.propwash * (0.5 + 0.5 * this._pw[k]);
          Tsum += Ti;
          tqx += MOT_F[k] * Ti; tqz += MOT_X[k] * Ti;
          tqy += MOT_DIR[k] * (P.kq * Ti + P.Jr * P.wMax * (s - s0) / h);
          Pacc += Math.pow(P.tMax * s * s * this._eff[k], 1.5) * h;   // القدرة من سرعة المروحة
        }
        sbar /= 4;
        tqx *= P.arm; tqz *= P.arm;
        if (pwOn) { tqx += 0.25 * this.propwash * this._pw[0]; tqz += 0.25 * this.propwash * this._pw[3]; }
        this._T = Tsum;
        if (this.onGround) {
          if (this.motors && Tsum > m * G * 1.01 && this.link) { this.onGround = false; this.airborne = true; this._groundRef = null; v.y = Math.max(v.y, 0.05); }
          else { this._holdGround(); continue; }
        }
        // ---- الجسم الصلب
        tqx -= dr.ang * w.x * Math.abs(w.x); tqy -= dr.ang * w.y * Math.abs(w.y); tqz -= dr.ang * w.z * Math.abs(w.z);
        const gx = w.y * J.z * w.z - w.z * J.y * w.y, gy = w.z * J.x * w.x - w.x * J.z * w.z, gz = w.x * J.y * w.y - w.y * J.x * w.x;
        w.x += (tqx - gx) / J.x * h; w.y += (tqy - gy) / J.y * h; w.z += (tqz - gz) / J.z * h;
        qIntegrate(q, w.x, w.y, w.z, h, this._qt);
        axes(q, A);
        // السحب: محوري + جانبي + سحب المراوح
        const vip_x = vax - vAx * A.ux, vip_y = vay - vAx * A.uy, vip_z = vaz - vAx * A.uz;
        const vip = Math.hypot(vip_x, vip_y, vip_z);
        const kA = 0.5 * RHO * dr.cdaTop * vAx * Math.abs(vAx), kI = 0.5 * RHO * dr.cdaSide * vip + dr.krd * sbar;
        v.x += ((Tsum - kA) * A.ux / m - kI * vip_x / m) * h;
        v.y += ((Tsum - kA) * A.uy / m - kI * vip_y / m - G) * h;
        v.z += ((Tsum - kA) * A.uz / m - kI * vip_z / m) * h;
        p.x += v.x * h; p.y += v.y * h; p.z += v.z * h;
        if (this._ground(env, A) || this.crashed) break;
        if (this._collide(env, h) || this.crashed) break;
      }
      this._P = Pacc / dt / (Math.sqrt(2 * RHO * Math.PI * P.rotorR * P.rotorR) * P.bat.eta);
      if (this._impact > 0 && p.y - this._groundY > 1) this._impact = 0;
      this._propwash(dt, W);
    }
    // اهتزاز الـ Propwash: نزول في هوا المراوح بدون سرعة أفقية
    _propwash(dt, W) {
      const A = this.A, v = this.v;
      const vax = v.x - W.x, vay = v.y - W.y, vaz = v.z - W.z;
      const vAx = vax * A.ux + vay * A.uy + vaz * A.uz;
      const vip = Math.hypot(vax - vAx * A.ux, vay - vAx * A.uy, vaz - vAx * A.uz);
      const wsh = -vAx;
      const k = this.flying ? U.clamp((wsh - 2) / 4, 0, 1) * U.clamp(1 - vip / 4, 0, 1) : 0;
      this.propwash = k;
      if (k > 0) {
        const a = Math.exp(-dt / 0.02), s = Math.sqrt(1 - a * a);
        for (let i = 0; i < 4; i++) this._pw[i] = U.clamp(a * this._pw[i] + s * this.gauss(), -1, 1);
        if (k > 0.3 && this.t - this._pwT > 0.3) { this._pwT = this.t; this.rumble(0.4 * k, 0.3, 120); }
      }
    }

    // الأرض: يمسك الدرون ثابت
    _holdGround() {
      const p = this.p, v = this.v, g = this._groundRef;
      if (g) {   // منصة متحركة: يمشي معها
        const cs = g.yaw ? Math.cos(g.yaw) : 1, sn = g.yaw ? Math.sin(g.yaw) : 0;
        p.x = g.x + this._gOffX * cs - this._gOffZ * sn; p.z = g.z + this._gOffX * sn + this._gOffZ * cs; p.y = g.h;
        this._groundY = g.h;
      } else p.y = this._groundY;
      this._gpx = p.x; this._gpy = p.y; this._gpz = p.z;   // آخر مكان مفحوص (الخريطة الحقيقية)
      v.x = 0; v.y = 0; v.z = 0; this.w.x = this.w.y = this.w.z = 0;
      qYaw(this.yaw, this.q);
    }
    // سطح تحت الدرون (الأرض أو منصة قابلة للهبوط)
    _surfaceUnder(env) {
      let y = 0, ref = null;
      const Wd = DS.World, Gs = env.geo;   // الكثبان أرض مثل الأرض (مو عائق)
      if (Gs) {   // الخريطة الحقيقية / مجسم طويق: الأرض والسطوح من شبكة الارتفاعات (جدار أعلى من الدرون = null → نخلي آخر أرض)
        const g = Gs.groundAt(this.p.x, this.p.z, this.p.y);
        if (g != null) this._geoG = g;
        if (this._geoG != null) y = this._geoG;
      } else if (Wd && Wd.terrainAt && env.terrain !== false) { const t = Wd.terrainAt(this.p.x, this.p.z); if (t > 0) y = t; }
      const L = env.taskColliders;
      if (L) for (let i = 0; i < L.length; i++) {
        const c = L[i]; if (!c.landable || c.type !== 'box') continue;
        let dx = this.p.x - c.x, dz = this.p.z - c.z;
        if (c.yaw) { const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), lx = dx * cs + dz * sn; dz = -dx * sn + dz * cs; dx = lx; }
        if (Math.abs(dx) <= c.w / 2 && Math.abs(dz) <= c.d / 2 && c.h > y && this.p.y >= c.h - 0.3) { y = c.h; ref = c; }
      }
      this._groundY = y; return ref;
    }
    // لمس الأرض: هبوط أو طيحة
    _ground(env, A) {
      const p = this.p, v = this.v;
      const ref = this._surfaceUnder(env), gy = this._groundY;
      if (p.y > gy) { this._tipT = 0; return false; }
      const rvx = ref ? v.x - (ref.vx || 0) : v.x, rvz = ref ? v.z - (ref.vz || 0) : v.z;
      const vs = -v.y, hs = Math.hypot(rvx, rvz);
      if (env.isWater && !ref && env.isWater(p.x, p.z)) { p.y = gy; this.crash('نزل في الموية!'); return true; }
      if (this.profile.kind === 'fpv') {
        const CR = this.profile.crash || { vs: 11.5, hs: 14 };
        if (vs > CR.vs || hs > CR.hs) { p.y = gy; this.crash(vs > CR.vs ? 'نزل بقوة على الأرض وانكسر' : 'خبط في الأرض وهو مسرع'); return true; }
        if (vs > this._impact) this._impact = vs;
        if (A.uy > 0.6 && vs < 3.5 && hs < 3) return this._touch(ref, vs, hs);
        // ارتداد
        p.y = gy; v.y = Math.abs(v.y) * 0.25; v.x *= 0.6; v.z *= 0.6;
        this.w.x *= 0.5; this.w.z *= 0.5;
        if (vs > 2.5) this._damage(vs);
        if (Math.hypot(v.x, v.y, v.z) < 1 && A.uy < 0.5) {
          this._tipT += 1 / HZ;
          if (this._tipT > 0.8) {   // مقلوب وواقف: خبطة أقل من حد الكسر = وضع السلحفاة، أقوى = طيحة
            if (this._impact < CR.vs) this._enterTurtle(gy);
            else this.crash('انقلب الدرون على الأرض');
            return true;
          }
        }
        return false;
      }
      // Mini: رجوله قصيرة — يلمس وهو ماشي على الجنب (نسبة للمنصة) = ينقلب
      const tip = this.profile.tipHs || 1.5;
      if (vs > 3.2 || hs > tip) { p.y = gy; this.crash(vs > 3.2 ? 'نزل بقوة على الأرض وانكسر' : 'لمس الأرض وهو ماشي وانقلب'); return true; }
      return this._touch(ref, vs, hs);
    }
    _touch(ref, vs, hs) {
      const p = this.p;
      this.onGround = true; this.vrs = false; this.vrsK = 0; this.paused = false;
      this._groundRef = ref;
      if (ref) {
        const dx = p.x - ref.x, dz = p.z - ref.z, cs = ref.yaw ? Math.cos(ref.yaw) : 1, sn = ref.yaw ? Math.sin(ref.yaw) : 0;
        this._gOffX = dx * cs + dz * sn; this._gOffZ = -dx * sn + dz * cs;
      }
      this._holdGround();
      this.touchdown = { t: this.t, vs, hs, x: p.x, z: p.z, on: ref ? (ref.name || 'منصة') : null };
      // FPV: وقف على الأرض بعد خبطة (خلال 3 ث) → الجلسة تشوف إذا طفيته بسرعة (DISARM خلال 1.5 ث)
      const li = this.lastImpact;
      this.crashRest = (this.profile.kind === 'fpv' && this.motors && li && this.t - li.t < 3) ? this.t : null;
      this.emit('touchdown', '', { vs, hs });
      this._latched = false; this._altLatched = false; this._impact = 0; this._tipT = 0;
      return true;
    }
    // ---------- FPV: وضع السلحفاة (Betaflight "flip over after crash") ----------
    // انقلب على الأرض بعد خبطة خفيفة: تنطفي المحركات (DISARM) ويستنى. A مطوّل (من الجلسة) = flipOver()
    _enterTurtle(gy) {
      const p = this.p, v = this.v, w = this.w;
      p.y = gy; v.x = v.y = v.z = 0; w.x = w.y = w.z = 0;
      this.turtle = true; this.turtleCount++; this._flipT = -1; this._tipT = 0;
      this.onGround = false; this.auto = null; this.rthPhase = null; this.vrs = false; this.propwash = 0;
      if (this.motors) this.stopMotors();
      for (let k = 0; k < 4; k++) this.motor[k] = 0;
      this.emit('warn', 'CRASH FLIP — الدرون انقلب. اضغط A مطوّل عشان تقلبه (وضع السلحفاة)');
      this.rumble(0.6, 0.4, 250);
    }
    flipOver() {
      if (!this.turtle || this._flipT >= 0 || this.crashed) return false;
      if (!this.link) { this.emit('warn', 'ما فيه إشارة — ما يقدر يقلب الدرون'); return false; }
      const q = this.q, q0 = this._fq0, q1 = this._fq1, r = this._fqr;
      q0.x = q.x; q0.y = q.y; q0.z = q.z; q0.w = q.w;
      this._fyaw = this.yaw; qYaw(this._fyaw, q1);
      if (q0.x * q1.x + q0.y * q1.y + q0.z * q1.z + q0.w * q1.w < 0) { q1.x = -q1.x; q1.y = -q1.y; q1.z = -q1.z; q1.w = -q1.w; }
      // محور القلبة بإطار الجسم → أي محركات تلف (شكل بس)
      r.x = -q0.x; r.y = -q0.y; r.z = -q0.z; r.w = q0.w; qmul(r, q1, r);
      const roll = Math.abs(r.z) >= Math.abs(r.x), sg = (roll ? r.z : r.x) >= 0 ? 1 : -1;
      for (let k = 0; k < 4; k++) this._fside[k] = (roll ? MOT_X[k] : MOT_F[k]) === sg;
      this._flipT = 0;
      this.emit('info', 'وضع السلحفاة: المحركات تلف بالعكس وتقلب الدرون…');
      this.rumble(0.25, 0.6, 600);
      return true;
    }
    _stepTurtle(dt, env) {
      const p = this.p, v = this.v, w = this.w;
      this._surfaceUnder(env);
      v.x = v.y = v.z = 0; this.throttle = 0; this.thrust = 0; this._T = 0; this.load = 0;
      if (this._flipT < 0) { w.x = w.y = w.z = 0; p.y = this._groundY + this._restOff(); for (let k = 0; k < 4; k++) this.motor[k] = 0; return; }
      const T = 0.7;
      this._flipT += dt;
      const s = U.clamp(this._flipT / T, 0, 1), e = s * s * (3 - 2 * s);
      qSlerp(this._fq0, this._fq1, e, this.q);
      p.y = this._groundY + this._restOff() + 0.22 * Math.sin(Math.PI * s);   // نطّة صغيرة وهو يتقلب
      for (let k = 0; k < 4; k++) this.motor[k] = s < 0.85 ? (this._fside[k] ? 0.6 : 0.06) : 0;
      if (s >= 1) {
        this.turtle = false; this._flipT = -1; this._impact = 0; this._tipT = 0;
        this.onGround = true; this._groundRef = null; this.landT = 0; this.airborne = false;
        qYaw(this._fyaw, this.q); this._holdGround();
        for (let k = 0; k < 4; k++) this.motor[k] = 0;
        this.emit('info', 'رجع على رجوله ✓ — شغّل المحركات من جديد (ARM): A مطوّل أو CSC وكمّل');
      }
    }
    // كم يرتفع المركز عن الأرض وهو مقلوب/على جنبه (يرتكز على البطارية أو المراوح) — عشان ما يغوص في الأرض
    _restOff() {
      const A = axes(this.q, this.A);
      return Math.min(0.16, 0.14 * (Math.abs(A.ry) + Math.abs(A.by)) + (A.uy < 0 ? -0.067 * A.uy : 0));
    }
    // FPV: ثروتل يثبت الارتفاع (للعصا المقفولة): vyT = السرعة العمودية المطلوبة
    holdThrottle(vyT) {
      const P = this.profile;
      if (P.kind !== 'fpv') return 0.5;
      const A = axes(this.q, this._hA || (this._hA = {}));
      const uy = Math.max(0.35, A.uy), vs = U.clamp(this.voltage / P.vRef, 0.3, 1.05);
      const az = U.clamp(G + 2.5 * ((+vyT || 0) - this.v.y), 2, 2 * G);
      const f = U.clamp(this.mass * az / uy / (4 * P.tMax * vs * vs), 0, 1);
      return U.clamp((Math.pow(Math.max(f, 1e-4), 1 / P.gamma) - P.idle) / (1 - P.idle), 0, 1);
    }
    // ضرر المراوح (FPV) بعد خبطة: 2.5–6 م/ث = تضرر، 6–12 = ضرر أكبر وممكن تنكسر مروحة (fpv.md §7 ~30%)
    _damage(vn) {
      const k = Math.floor(this.rnd() * 4) % 4, loss = 0.1 + 0.3 * U.clamp((vn - 2.5) / 3.5, 0, 1);
      const li = this.lastImpact || (this.lastImpact = { t: 0, v: 0 }); li.t = this.t; li.v = vn;
      if (vn > 6 && this.rnd() < 0.15 + 0.35 * U.clamp((vn - 6) / 6, 0, 1)) {
        this._eff[k] = Math.min(this._eff[k], 0.1);
        this.emit('warn', 'مروحة انكسرت! الدرون ما يقدر يطير زين — نزّله وطفّ المحركات (DISARM)');
        this.rumble(1, 0.7, 300);
        return;
      }
      this._eff[k] = Math.max(vn > 6 ? 0.35 : 0.5, this._eff[k] - (vn > 6 ? loss + 0.1 : loss));
      this.emit('warn', 'مروحة تضررت من الخبطة — الدرون صار يهتز، نزّله');
      this.rumble(0.8, 0.5, 200);
    }
    // التصادم مع العوائق
    _collide(env, h) {
      const R = this.profile.radius, p = this.p, fpv = this.profile.kind === 'fpv';
      // المباني/الأرض من الخريطة الحقيقية (أو مجسم طويق): 30 مرة بالثانية على طول الطريق من آخر فحص
      const Gs = env.geo;
      if (Gs) { this._geoT += h; if (this._geoT >= GEO_DT) { this._geoT = 0; if (this._geoHit(Gs)) return true; } }
      const Wd = DS.World, grid = Wd && typeof Wd.near === 'function' && env.colliders === Wd.colliders;   // شبكة worlddata (أسرع)
      for (let L = 0; L < 2; L++) {
        const list = L === 0 ? (grid ? Wd.near(p.x, p.z) : env.colliders) : env.taskColliders;
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (c === this._groundRef || c.terrain || farAway(c, p, R + 0.5)) continue;
          const d = DS.contact(c, p, R, _ct);
          if (d <= 0) continue;
          if (c.landable && _ct.ny > 0.7) continue;   // فوق منصة الهبوط = أرض
          if (!fpv) { this.crash('خبط في ' + (c.name || 'عائق')); return true; }
          // FPV: ارتداد إذا الخبطة خفيفة
          const v = this.v, vn = -(v.x * _ct.nx + v.y * _ct.ny + v.z * _ct.nz);
          if (vn > (this.profile.crash ? this.profile.crash.obst : 12)) { this.crash('خبط في ' + (c.name || 'عائق')); return true; }
          if (vn > this._impact) this._impact = vn;
          p.x += _ct.nx * d; p.y += _ct.ny * d; p.z += _ct.nz * d;
          if (vn > 0) {
            v.x += 1.25 * vn * _ct.nx; v.y += 1.25 * vn * _ct.ny; v.z += 1.25 * vn * _ct.nz;
            v.x *= 0.7; v.y *= 0.7; v.z *= 0.7;
            this.w.x += (this.rnd() - 0.5) * vn * 6; this.w.z += (this.rnd() - 0.5) * vn * 6;
            if (vn > 2.5) this._damage(vn); else this.rumble(0.5, 0.3, 100);
          }
        }
      }
      return false;
    }

    // خبطة في سطح الخريطة الحقيقية (مبنى/شجرة/سيارة): نفحص نقاط على الخط من آخر فحص (عشان ما يعدّي جدار رفيع وهو مسرع)
    _geoHit(Gs) {
      const p = this.p, R = this.profile.radius, o = _gh;
      const ax = this._gpx, ay = this._gpy, az = this._gpz, dx = p.x - ax, dy = p.y - ay, dz = p.z - az, L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const n = L > 0.5 && L < 30 ? Math.min(10, Math.ceil(L / 0.5)) : 1;
      let hit = false, k = 1;
      for (; k <= n; k++) { const t = k / n; if (Gs.hit(ax + dx * t, ay + dy * t, az + dz * t, R, o)) { hit = true; break; } }
      if (hit && k < n) { const t = Math.max(0, (k - 1) / n); p.x = ax + dx * t; p.y = ay + dy * t; p.z = az + dz * t; }
      this._gpx = p.x; this._gpy = p.y; this._gpz = p.z;
      if (!hit) return false;
      const nm = Gs.name || 'مبنى';
      if (this.profile.kind !== 'fpv') { this.crash('خبط في ' + nm); return true; }
      // FPV: خبطة خفيفة = يرتد (مثل العوائق العادية)
      const v = this.v, nx = o.nx, nz = o.nz, vn = -(v.x * nx + v.z * nz);
      if (vn > (this.profile.crash ? this.profile.crash.obst : 12) || (!nx && !nz)) { this.crash('خبط في ' + nm); return true; }
      if (vn > this._impact) this._impact = vn;
      p.x += nx * 0.25; p.z += nz * 0.25; this._gpx = p.x; this._gpz = p.z;
      if (vn > 0) {
        v.x += 1.25 * vn * nx; v.z += 1.25 * vn * nz; v.x *= 0.7; v.y *= 0.7; v.z *= 0.7;
        this.w.x += (this.rnd() - 0.5) * vn * 6; this.w.z += (this.rnd() - 0.5) * vn * 6;
        if (vn > 2.5) this._damage(vn); else this.rumble(0.5, 0.3, 100);
      }
      return false;
    }
    // منطقة الحظر: وين أنا منها + تحذيرات (مرة وحدة لكل دخول)
    _fenceTick(env) {
      const F = env.fence, q = this.geoFence = F.query(this.p.x, this.p.z, this._gfq), st = q.state;
      if (this.flying) {
        const fpv = this.profile.kind === 'fpv', atti = this.effMode() === 'A';
        if (st >= 1 && this._gfSt < 1 && this.t - this._gfWarnT > 20) { this._gfWarnT = this.t; this.emit('warn', '⚠️ تقترب من منطقة ' + (F.short || F.name) + ' — ممنوع الطيران قدام'); }
        if (st >= 2 && this._gfSt < 2 && this.t - this._gfNfzT > 12) {
          this._gfNfzT = this.t;
          this.emit('warn', '⛔ منطقة حظر طيران (' + F.name + ') — ' + (fpv ? 'درون FPV ما عنده حماية GEO، ارجع الحين!' : atti ? 'ATTI ما يوقف لحاله، ارجع لورا!' : 'الدرون وقف عند الحد وما يقدر يدخل'));
          this.rumble(0.4, 0.6, 300);
        }
      }
      this._gfSt = st;
    }

    // حساسات العوائق (DJI في C و N، وفي الرجوع والهبوط التلقائي دايماً): تحد السرعة باتجاه العائق
    // ميزانية الفرملة: 60% من حد الفرامل في حلقة السرعة (نفس حساسية الفرامل) + مسافة لتأخر قلب
    // الوضعية وحلقة السرعة (السرعة الحقيقية × 0.45 ث) → يوقف قبل العائق بـ 1.5 م تقريباً
    _sense(env, vx, vy, vz, M) {
      const P = this.profile, SE = P.sense, R = P.radius, p = this.p, o = this._cp, v = this.v, S = DS.settings || {};
      const aLoop = G * Math.tan((M.tilt || 30) * D2R) * (M.brake || 1) * U.clamp((S.brakeSens || 100) / 100, 0.1, 1.5);
      const aBr = 0.6 * aLoop, TL = 0.45;
      let bestD = 1e9, bestC = null, bx = 0, by = 0, bz = 0, braking = false;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      // حد السرعة لكل جهة: يقدر يوقف داخل مدى الحساس (الجنب 12 م، الورا 15 م) — مثل حد "سرعة الحساسات" في DJI
      {
        const f = vx * sy - vz * cy, r = vx * cy + vz * sy;
        const capF = Math.sqrt(2 * aLoop * Math.max(0, SE.F - SE.standoff)), capB = Math.sqrt(2 * aLoop * Math.max(0, SE.B - SE.standoff));
        const capL = Math.sqrt(2 * aLoop * Math.max(0, SE.L - SE.standoff));
        const f2 = f > capF ? capF : f < -capB ? -capB : f, r2 = r > capL ? capL : r < -capL ? -capL : r;
        if (f2 !== f || r2 !== r) { vx = sy * f2 + cy * r2; vz = -cy * f2 + sy * r2; }
      }
      // قائمة المرشحين القريبين (تتحدث 4 مرات بالثانية، بدون إنشاء مصفوفات)
      const cand = this._senseList || (this._senseList = []);
      if (this.t - this._senseT > 0.25 || this._senseEnv !== env.colliders) {
        this._senseT = this.t; this._senseEnv = env.colliders; cand.length = 0;
        const all = env.colliders;
        if (all) for (let i = 0; i < all.length; i++) if (sensible(all[i]) && !farAway(all[i], p, SE.F + 14)) cand.push(all[i]);
      }
      for (let L = 0; L < 2; L++) {
        const list = L === 0 ? cand : env.taskColliders;
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (!sensible(c) || farAway(c, p, SE.F + 2)) continue;
          this._closest(c, p, o);
          const dx = o.x - p.x, dy = o.y - p.y, dz = o.z - p.z, dl = Math.hypot(dx, dy, dz);
          if (dl < 1e-6) continue;
          const clr = dl - R;
          if (clr > SE.F) continue;
          // مدى الحساس حسب الجهة
          const hd = Math.hypot(dx, dz);
          if (c.terrain && -dy > hd) continue;   // رمل تحته = هبوط عادي (حماية الهبوط تتكفل)
          let range;
          if (Math.abs(dy) > hd) range = dy > 0 ? SE.U : SE.D;
          else {
            const fw = (dx * sy - dz * cy) / (hd || 1);   // cos الزاوية مع القدام
            range = fw > 0.707 ? SE.F : fw < -0.707 ? SE.B : SE.L;
          }
          if (clr > range) continue;
          const ux = dx / dl, uy = dy / dl, uz = dz / dl;
          const vAct = Math.max(0, v.x * ux + v.y * uy + v.z * uz);
          const vt = vx * ux + vy * uy + vz * uz, allow = Math.sqrt(2 * aBr * Math.max(0, clr - SE.standoff - vAct * TL));
          if (vt > allow) { const k = vt - allow; vx -= k * ux; vy -= k * uy; vz -= k * uz; braking = true; }
          if (clr < bestD) { bestD = clr; bestC = c; bx = dx; by = dy; bz = dz; }
        }
      }
      // الخريطة الحقيقية: نشوف قدام باتجاه الحركة المطلوبة على شبكة الارتفاعات (المباني والشجر)
      const Gs = env.geo, hv = Math.hypot(vx, vz);
      if (Gs && Gs.sense && hv > 0.2) {
        const ux = vx / hv, uz = vz / hv, s = Gs.sense(p.x, p.y, p.z, ux, uz, SE.F + R);
        if (s >= 0) {
          const clr = Math.max(0, s - R), fw = ux * sy - uz * cy;
          const range = fw > 0.707 ? SE.F : fw < -0.707 ? SE.B : SE.L;
          if (clr <= range) {
            const vAct = Math.max(0, v.x * ux + v.z * uz);
            const vt = vx * ux + vz * uz, allow = Math.sqrt(2 * aBr * Math.max(0, clr - SE.standoff - vAct * TL));
            if (vt > allow) { const k = vt - allow; vx -= k * ux; vz -= k * uz; braking = true; }
            if (clr < bestD) { bestD = clr; bestC = GEO_OBS; bx = ux * s; by = 0; bz = uz * s; }
          }
        }
      }
      if (bestC) {
        const ob = this._obs;
        ob.dist = bestD; ob.dir = U.wrap(Math.atan2(bx, -bz) - this.yaw); ob.up = by / (Math.hypot(bx, by, bz) || 1); ob.braking = braking; ob.name = bestC.name || '';
        if (braking && this.t - this._obsWarnT > 6) { this._obsWarnT = this.t; this.emit('warn', 'عائق قريب! الدرون فرمل لحاله'); }
        this.obstacle = ob;
      } else this.obstacle = null;
      o.x = vx; o.y = vy; o.z = vz; return o;
    }
    // أقرب نقطة على العائق
    _closest(c, p, o) {
      if (c.type === 'cyl') {
        const dx = p.x - c.x, dz = p.z - c.z, r = Math.hypot(dx, dz), k = r > c.r ? c.r / r : 1;
        o.x = c.x + dx * k; o.z = c.z + dz * k; o.y = U.clamp(p.y, c.y0 || 0, c.h);
      } else if (c.type === 'box') {
        let dx = p.x - c.x, dz = p.z - c.z;
        if (c.yaw) {
          const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
          const lx = U.clamp(dx * cs + dz * sn, -c.w / 2, c.w / 2), lz = U.clamp(-dx * sn + dz * cs, -c.d / 2, c.d / 2);
          o.x = c.x + lx * cs - lz * sn; o.z = c.z + lx * sn + lz * cs;
        } else { o.x = c.x + U.clamp(dx, -c.w / 2, c.w / 2); o.z = c.z + U.clamp(dz, -c.d / 2, c.d / 2); }
        o.y = U.clamp(p.y, c.y0 || 0, c.h);
      } else {
        const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z, r = Math.hypot(dx, dy, dz) || 1, k = c.r / r;
        o.x = c.x + dx * k; o.y = c.y + dy * k; o.z = c.z + dz * k;
      }
      return o;
    }

    // ---------- البطارية: شحن، جهد، هبوط الجهد تحت الحمل ----------
    _battery(dt) {
      const P = this.profile, B = P.bat;
      if (this.battery !== this._batOut) { this.soc = U.clamp(this.battery / 100, 0, 1); this._vrc = 0; this._vSnap = true; }   // سيناريو غيّر النسبة
      let pw;
      if (!this.motors) pw = 0.4;
      else if (P.kind === 'fpv') pw = this._P + B.aux * this.voltage;
      else pw = B.pHover * Math.pow(Math.max(0, this._T / (this.mass * G)), 1.5) + B.pAux;
      const n = B.cells, oc = ocv(B.ocv, this.soc) * n;
      const Rn = P.kind === 'fpv' ? n * B.rCell * (1 + (1 - this.soc) * (1 - this.soc)) + B.wiring : n * B.rCell;
      // I = P / V مع V = oc - I·R (حل المعادلة)
      const disc = oc * oc - 4 * Rn * pw;
      const I = disc > 0 ? (oc - Math.sqrt(disc)) / (2 * Rn) : oc / (2 * Rn);
      if (P.kind === 'fpv') this._vrc += (I * 0.012 - this._vrc) * Math.min(1, dt / 20);
      this.voltage = Math.max(0, oc - I * Rn - this._vrc);
      this.amps = I;
      // جهد الخلية المفلتر (PT1) — مثل vbat_lpf في Betaflight
      const vc = this.voltage / n;
      if (this._vSnap || !(this.vCellF > 0)) { this.vCellF = vc; this._vSnap = false; }
      else this.vCellF += (vc - this.vCellF) * (1 - Math.exp(-dt / (B.lvTau || 2.5)));
      if (this.motors) {
        this.soc = Math.max(0, this.soc - I * dt / (3.6 * B.mah) * this.drain);
        this.mah += I * dt / 3.6;
      }
      this._Iavg += (I - this._Iavg) * Math.min(1, dt / (I > this._Iavg ? 1.5 : 12));   // يرتفع بسرعة وينزل ببطء
      this.timeLeft = this._Iavg > 0.05 ? this.soc * B.mah * 3.6 / this._Iavg / Math.max(this.drain, 0.1) : 0;
      // كم يحتاج يرجع للبيت (علامة H في شريط البطارية)
      const dh = Math.hypot(this.p.x - this.home.x, this.p.z - this.home.z);
      const tHome = dh / (P.rthSpeed || 10) + Math.max(this.p.y - (this.home.y || 0), 0) / 2.5 + 15;
      this.rthSoc = U.clamp(tHome * Math.max(this._Iavg, 1) / (3.6 * B.mah) + 0.1, 0, 1);
      this.battery = this.soc * 100; this._batOut = this.battery;
      this.checkBattery();
    }

    // ---------- الإشارة: المسافة + المباني بين الطيار والدرون ----------
    _link(dt, env) {
      this._lkT += dt;
      if (this._lkT >= 0.1) {
        const lt = this._lkT; this._lkT = 0;
        const P = this.profile, pil = DS.PILOT || { x: 0, z: 6 };
        const d = Math.hypot(this.p.x - pil.x, this.p.y - 1.5, this.p.z - pil.z);
        const nb = this._losBlocked(env, pil);
        const range = P.link.range * (nb === 0 ? 1 : nb === 1 ? 0.04 : 0.015);
        const r = d / range, target = 100 * U.clamp(1 - r * r, 0, 1);
        this.linkQ += (target - this.linkQ) * (1 - Math.exp(-lt / 0.6));
        if (this.linkQ < 10) { this._lowT += lt; this._goodT = 0; } else { this._lowT = 0; this._goodT = this.linkQ > 25 ? this._goodT + lt : 0; }
        if (this.link && this._lowT > 1) {
          this.link = false; this._linkModelLost = true; this._lostT = 0;
          this.emit('warn', 'انقطعت الإشارة! ' + (P.kind === 'fpv' ? 'RXLOSS' : 'إذا ما رجعت خلال 6 ثواني يرجع للبيت لحاله'));
        }
        if (!this.link && this._linkModelLost && this._goodT > 1) {
          this.link = true; this._linkModelLost = false; this.emit('info', 'رجعت الإشارة 📶');
        }
        if (this.link && this.linkQ < 35 && this.motors && this.t - this._weakT > 12) {
          this._weakT = this.t; this.emit('warn', 'الإشارة ضعيفة — لا تروح ورا المباني، ارفع الدرون أو قرّبه');
        }
      }
      // Failsafe (DJI): بعد 6 ثواني بدون إشارة يرجع للبيت
      if (!this.link) {
        this._lostT += dt;
        if (this._lostT > 6 && this.flying && !this.auto && this.profile.kind === 'dji' && this.gps) this.toggleRTH(true);
      } else this._lostT = 0;
      this.videoOK = this.link && this.linkQ > 12;
    }
    // كم مبنى/عائق يقطع الخط بين الريموت والدرون (نوقف عند 2)
    _losBlocked(env, pil) {
      let n = 0;
      const W = DS.World;
      if (env.worldLos === false) { /* مكان ثاني (طويق): مباني المحاكي مو هنا */ }
      else if (W && W.buildings) n = this._losList(W.buildings, false, pil, n);
      else if (W && W.colliders) n = this._losList(W.colliders, true, pil, n);
      if (env.geo && env.geo.los && n < 2) n = Math.min(2, n + env.geo.los(pil.x, 1.5, pil.z, this.p.x, this.p.y, this.p.z));
      if (env.blockers && n < 2) n = this._losList(env.blockers, false, pil, n);
      if (env.taskColliders && n < 2) n = this._losList(env.taskColliders, true, pil, n);
      return n;
    }
    _losList(list, onlyFlagged, pil, n) {
      for (let i = 0; i < list.length && n < 2; i++) {
        const c = list[i];
        if (onlyFlagged && !c.blocksSignal) continue;
        const cyl = c.type === 'cyl', w = cyl ? 2 * c.r : c.w, d = cyl ? 2 * c.r : c.d;
        if (w == null || d == null || c.h == null) continue;
        if (segBox(pil.x, 1.5, pil.z, this.p.x, this.p.y, this.p.z, c.x, c.z, w, d, c.y0 || 0, c.h, c.yaw || 0)) n++;
      }
      return n;
    }

    // ---------- الحساسات: GNSS/رؤية + ضجة المكان ----------
    _sensors(dt, env) {
      const P = this.profile, S = DS.settings || {};
      const dark = !!(env.dark || env.night);
      const water = !!(env.isWater && env.isWater(this.p.x, this.p.z));
      const agl = this.p.y - this._groundY;
      // الحساسات اللي تحت (Vision): 0.5–30 م، تحتاج نور وأرض فيها تفاصيل (مو موية).
      // بدون GPS: تشتغل بس إذا الـ GPS راح لحاله (setGnss(false,{vision:true}))، وإلا التمرين يبي ATTI
      const visOK = P.kind === 'dji' && !dark && !water && agl <= 30 && !this.visionFail;
      this.vision = visOK && (this.gps || this._gnssOnly);
      if (!this.gps) this.sats = 0;
      else if (this.sats < 8) this.sats = 18;
      if (P.kind === 'dji') {
        const sig = (this.vision ? P.hover.vision : P.hover.gnss) / 2;
        const a = Math.exp(-dt / 4), k = sig * Math.sqrt(1 - a * a);
        this.posNoise.x = a * this.posNoise.x + k * this.gauss();
        this.posNoise.z = a * this.posNoise.z + k * this.gauss();
        this._ny = a * this._ny + k * this.gauss();
        const m = this.effMode();
        // الرجوع والهبوط والإقلاع التلقائي: الحساسات شغالة دايم (حتى لو طفيتها بالإعدادات) — DJI
        const autoOA = this.auto === 'rth' || this.auto === 'land' || this.auto === 'takeoff';
        const sm = m === 'C' || m === 'P' || autoOA;
        this.sensorsOn = (S.sensors !== false || autoOA) && !dark && this.motors && sm && m !== 'A' && m !== 'M';
        // راح الـ GPS بس: نقول له إذا الحساسات ماسكته أو صار ATTI
        if (!this.gps && this._gnssOnly && this.flying) {
          const st = this.vision ? 1 : 0;
          if (st !== this._visState) {
            if (st) this.emit('info', 'ما فيه GPS — الدرون ماسك مكانه بالحساسات اللي تحت. خلك تحت 30 متر وارجع');
            else this.emit('warn', 'ما فيه GPS والحساسات ما تشوف الأرض (عالي/ظلام/موية) — صار ATTI! صحّح الانجراف بيدك');
            this._visState = st;
          }
        } else this._visState = this.gps ? 1 : -1;
      } else { this.posNoise.x = this.posNoise.z = 0; this.sensorsOn = false; }
      // 4 مرات بالثانية: تشويش البوصلة قرب الحديد + اضطراب الهوا ورا المباني
      this._envT += dt;
      if (this._envT >= 0.25) { this._envT = 0; this._steelAndWake(env); }
      const a = Math.exp(-dt / 2), k = Math.sqrt(1 - a * a);
      this._mag = this._magSig > 0 ? a * this._mag + this._magSig * k * this.gauss() : this._mag * a;
      const aw = Math.exp(-dt / 0.8), kw = this._wakeSig * Math.sqrt(1 - aw * aw);
      this._wkx = aw * this._wkx + kw * this.gauss(); this._wkz = aw * this._wkz + kw * this.gauss(); this._wky = aw * this._wky + 0.5 * kw * this.gauss();
    }
    _steelAndWake(env) {
      const p = this.p, Wd = DS.World;
      // البوصلة: قرب البرج أو أبراج الكهرباء (≤ 6 م) تتشوش (±20°)
      this._magSig = 0;
      if (this.profile.kind === 'dji' && this.flying && env.compass !== false && Wd && typeof Wd.distToSteel === 'function') {
        const d = Wd.distToSteel(p.x, p.y, p.z);
        if (d < 6) {
          this._magSig = 20 * D2R * (1 - d / 6);
          if (this.t - this._magWarnT > 15) { this._magWarnT = this.t; this.emit('warn', 'تشويش على البوصلة (حديد قريب) — ابعد عن البرج'); }
        }
      }
      // اضطراب الهوا ورا المباني (اتجاه الريح)
      this._wakeSig = 0;
      const B = env.wake !== false && Wd && Wd.buildings, w = this.lastWind, ws = Math.hypot(w.x, w.z);
      if (B && ws > 2.5 && this.flying) {
        const ux = w.x / ws, uz = w.z / ws;
        for (let i = 0; i < B.length; i++) {
          const b = B[i]; if (!b.h || p.y > b.h * 1.3) continue;
          const dx = p.x - b.x, dz = p.z - b.z, along = dx * ux + dz * uz, half = 0.5 * Math.max(b.w || 0, b.d || 0);
          if (along < half || along > half + 4 * b.h) continue;
          const cross = Math.abs(dx * uz - dz * ux);
          if (cross > half + 4) continue;
          const sev = (1 - (along - half) / (4 * b.h)) * 0.35 * ws;
          if (sev > this._wakeSig) this._wakeSig = sev;
        }
      }
    }

    // ---------- بعد الطيحة: يطيح مع الجاذبية (ويوقف على السطوح) ----------
    fall(dt, env) {
      const p = this.p, v = this.v;
      if (p.y <= this._groundY + 1e-3 && this._fallen) return;
      const k = 0.5 * RHO * 0.02 / this.mass, sp = Math.hypot(v.x, v.y, v.z);
      v.x -= k * sp * v.x * dt; v.y -= (G + k * sp * v.y) * dt; v.z -= k * sp * v.z * dt;
      const py0 = p.y;
      p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
      qIntegrate(this.q, this.w.x, this.w.y, this.w.z, dt, this._qt);
      // الخريطة الحقيقية: الأرض ممكن تكون تحت الصفر (أوطى من مكان الإقلاع) — نبدأ منها بدل 0
      const Gs = env && env.geo, g0 = Gs ? Gs.groundAt(p.x, p.z, py0) : null;
      let floor = !Gs ? 0 : g0 != null ? g0 : this._geoG != null ? Math.min(this._geoG, py0) : 0;
      const L = env && env.colliders, T = env && env.taskColliders;
      const roof = list => {
        if (!list) return;
        for (let i = 0; i < list.length; i++) {
          const c = list[i]; if (c.type !== 'box' || c.h > py0 + 0.01) continue;
          if (Math.abs(p.x - c.x) <= c.w / 2 && Math.abs(p.z - c.z) <= c.d / 2 && c.h > floor) floor = c.h;
        }
      };
      roof(L); roof(T);
      const Wd = DS.World;
      if (Gs) { /* الأرض والسطوح من فوق */ }
      else if (Wd && Wd.terrainAt && !(env && env.terrain === false)) { const tg = Wd.terrainAt(p.x, p.z); if (tg > floor) floor = tg; }
      if (p.y <= floor) {
        p.y = floor; v.x = 0; v.y = 0; v.z = 0; this.w.x = this.w.y = this.w.z = 0; this._groundY = floor; this._fallen = true;
      }
    }

    // ---------- كاميرا الحمولة ----------
    // mini: مثبتة (gimbal) — اتجاه الدرون + زاوية الكاميرا. fpv: مثبتة على الهيكل بزاوية uptilt
    cameraPose(gimbalDeg, out) {
      out = out || { pos: { x: 0, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } };
      const P = this.profile, off = P.cam.off, q = this.q, t = this._cp2 || (this._cp2 = { x: 0, y: 0, z: 0 });
      qrot(q, off.x, off.y, off.z, t);
      out.pos.x = this.p.x + t.x; out.pos.y = this.p.y + t.y; out.pos.z = this.p.z + t.z;
      if (P.kind === 'fpv') {
        const S = DS.settings || {}, u = (S.fpvUptilt != null ? +S.fpvUptilt : P.cam.uptilt) * D2R;
        qrot(q, 0, Math.sin(u), -Math.cos(u), out.fwd);
        qrot(q, 0, Math.cos(u), Math.sin(u), out.up);
      } else {
        const g = U.clamp(gimbalDeg == null ? 0 : gimbalDeg, P.cam.gMin, P.cam.gMax) * D2R, s = Math.sin(this.yaw), c = Math.cos(this.yaw);
        const cg = Math.cos(g), sg = Math.sin(g);
        out.fwd.x = cg * s; out.fwd.y = sg; out.fwd.z = -cg * c;
        out.up.x = -sg * s; out.up.y = cg; out.up.z = sg * c;
      }
      return out;
    }

    // ---------- قيم مشتقة للقرّاء القدام (tf/tr/yaw) ----------
    _derive() {
      const A = axes(this.q, this.A);
      // الأنف = -back
      const nx = -A.bx, ny = -A.by, nz = -A.bz;
      if (Math.abs(ny) < 0.99) this.yaw = Math.atan2(nx, -nz);
      else if (ny < 0) this.yaw = Math.atan2(A.ux, -A.uz);
      else this.yaw = Math.atan2(-A.ux, A.uz);
      this.tf = Math.asin(U.clamp(A.by, -1, 1));
      this.tr = -Math.asin(U.clamp(A.ry, -1, 1));
    }
  }
  DS.Drone = Drone;
})();
