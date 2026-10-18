// أدوات عامة + الإعدادات + الحفظ + الأصوات + الصوت الناطق + منحنيات العصي
// ملاحظة: هذا الملف ما يلمس THREE ولا document ولا speechSynthesis وقت التحميل (يشتغل بدون شاشة في الفحص الذاتي).
(function () {
  'use strict';
  const DS = window.DS = window.DS || {};
  const U = DS.U = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  U.deg = r => r * 180 / Math.PI;
  U.rad = d => d * Math.PI / 180;
  // الاتجاه من نقطة لنقطة: 0 = شمال (-z)، موجب = مع عقارب الساعة
  U.bearing = (x1, z1, x2, z2) => Math.atan2(x2 - x1, -(z2 - z1));
  U.dist2 = (x1, z1, x2, z2) => Math.hypot(x2 - x1, z2 - z1);
  U.fwd = yaw => ({ x: Math.sin(yaw), z: -Math.cos(yaw) });
  U.right = yaw => ({ x: Math.cos(yaw), z: Math.sin(yaw) });
  U.expo = (v, e) => (1 - e) * v + e * v * v * v;
  U.fmt = (v, d = 1) => (Math.abs(v) < 0.05 && d > 0 ? 0 : v).toFixed(d);
  U.mmss = s => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  U.rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  U.pick = (arr, n, rnd = Math.random) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
  // وين النقطة بالنسبة لوجه الدرون (قدامك/يمينك/وراك/يسارك)
  U.relDir = (yaw, brg) => {
    const r = U.deg(U.wrap(brg - yaw));
    if (Math.abs(r) <= 40) return 'قدامك';
    if (r > 40 && r < 140) return 'على يمينك';
    if (r < -40 && r > -140) return 'على يسارك';
    return 'وراك';
  };

  // نص عربي فيه كلمات إنجليزية (أزرار، أوضاع): نعزل كل كلمة لاتينية (FSI…PDI) عشان ما يتلخبط ترتيب الجملة
  const FSI = String.fromCharCode(0x2068), PDI = String.fromCharCode(0x2069), ISO = FSI + '$&' + PDI;
  const LAT = /[A-Za-z][A-Za-z0-9]*(?:[ ./+×-]+[A-Za-z0-9]+)*/g, AR = new RegExp('[' + String.fromCharCode(0x600) + '-' + String.fromCharCode(0x6FF) + ']'), LA = /[A-Za-z]/;
  const mixed = s => typeof s === 'string' && AR.test(s) && LA.test(s);
  U.bidi = s => (mixed(s) ? s.replace(LAT, ISO) : s);
  // نفسها لـ HTML: ما نلمس الوسوم (<...>) ولا الرموز (&amp;)
  U.bidiHtml = s => (mixed(s) ? s.split(/(<[^>]*>|&[#A-Za-z0-9]+;)/).map((p, i) => (i % 2 ? p : p.replace(LAT, ISO))).join('') : s);

  // ---------- أدوات رياضية صغيرة ----------
  U.sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
  U.angDiff = (a, b) => U.wrap(a - b);
  U.smoothstep = (a, b, x) => { const t = U.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  // تنعيم ما يعتمد على سرعة الإطارات: cur يقرب من tgt بمعدل lambda (1/ث)
  U.damp = (cur, tgt, lambda, dt) => tgt + (cur - tgt) * Math.exp(-lambda * dt);
  // يقرب بخطوة ما تزيد عن step
  U.approach = (cur, tgt, step) => (cur < tgt ? Math.min(tgt, cur + step) : Math.max(tgt, cur - step));
  U.now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  // ---------- المنطقة الميتة + دائرة→مربع ----------
  // منطقة ميتة دائرية (داخلية din + خارجية dout) مع إعادة تحجيم: ما فيه قفزة عند الحد
  U.radialDz = function (x, y, din, dout, out) {
    const m = Math.sqrt(x * x + y * y);
    if (!(m > din) || m < 1e-9) { out.x = 0; out.y = 0; return out; }
    const span = 1 - din - dout;
    const r = span > 1e-6 ? Math.min(1, (m - din) / span) : 1;
    const k = r / m;
    out.x = x * k; out.y = y * k;
    return out;
  };
  // منطقة ميتة لمحور واحد (للريموتات اللي بوابتها مربعة)
  U.axialDz = function (v, din, dout) {
    const a = v < 0 ? -v : v;
    if (!(a > din)) return 0;
    const span = 1 - din - dout;
    const r = span > 1e-6 ? Math.min(1, (a - din) / span) : 1;
    return v < 0 ? -r : r;
  };
  // تحويل Fong (elliptical grid): العصا الدائرية تعطي الزوايا كاملة (1,1) مثل ريموت حقيقي
  const SQ2x2 = 2 * Math.SQRT2;
  U.circleToSquare = function (u, v, out) {
    const u2 = u * u, v2 = v * v, a = 2 + u2 - v2, b = 2 - u2 + v2;
    const x = 0.5 * Math.sqrt(Math.max(0, a + SQ2x2 * u)) - 0.5 * Math.sqrt(Math.max(0, a - SQ2x2 * u));
    const y = 0.5 * Math.sqrt(Math.max(0, b + SQ2x2 * v)) - 0.5 * Math.sqrt(Math.max(0, b - SQ2x2 * v));
    out.x = x > 1 ? 1 : x < -1 ? -1 : x;
    out.y = y > 1 ? 1 : y < -1 ? -1 : y;
    return out;
  };
  // العكس (مربع→دائرة): لرسم مكان العصا الحقيقي على الشاشة
  U.squareToCircle = function (x, y, out) {
    out.x = x * Math.sqrt(Math.max(0, 1 - y * y / 2));
    out.y = y * Math.sqrt(Math.max(0, 1 - x * x / 2));
    return out;
  };

  // ---------- منحنى EXP حق DJI Fly (dji.md §2.3) ----------
  // e = 0.5 خطي؛ أقل من 0.5 = أنعم حول النص؛ آخر العصا دايم = 1. القيمة تقريباً = الناتج عند نص العصا.
  U.djiExp = function (x, e) {
    if (!x) return 0;
    const s = x < 0 ? -1 : 1;
    let ax = x < 0 ? -x : x;
    if (ax > 1) ax = 1;
    if (!(e >= 0)) e = 0.5;
    if (e <= 0.5) {
      if (e < 0.125) e = 0.125;           // تحت كذا المنحنى يصير غير متزايد
      const a = (e - 0.125) / 0.375;
      return s * (a * ax + (1 - a) * ax * ax * ax);
    }
    if (e > 0.95) e = 0.95;
    return s * Math.pow(ax, Math.log(e) / Math.log(0.5));
  };
  // العكس: وين لازم العصا تكون عشان يطلع أمر معيّن (لرسم العصا الشبح في الدروس)
  U.djiExpInv = function (y, e) {
    if (!y) return 0;
    const s = y < 0 ? -1 : 1;
    let ay = y < 0 ? -y : y;
    if (ay > 1) ay = 1;
    if (!(e >= 0)) e = 0.5;
    if (e <= 0.5) {
      if (e < 0.125) e = 0.125;
      const a = (e - 0.125) / 0.375;
      if (a > 1 - 1e-9) return s * ay;
      if (a < 1e-9) return s * Math.cbrt(ay);
      return s * cubicRoot(1 - a, a, ay);
    }
    if (e > 0.95) e = 0.95;
    return s * Math.pow(ay, Math.log(0.5) / Math.log(e));
  };
  // الجذر الحقيقي الوحيد لـ k3·x³ + k1·x = d (k3>0, k1>0) بطريقة Cardano
  function cubicRoot(k3, k1, d) {
    const p = k1 / k3, q = -d / k3, D = Math.sqrt(q * q / 4 + p * p * p / 27);
    return Math.cbrt(-q / 2 + D) + Math.cbrt(-q / 2 - D);
  }

  // ---------- LDLJ: سلاسة الحركة (log dimensionless jerk) ----------
  // samples: [{t, p:{x,y,z}}] بخطوة زمنية ثابتة تقريباً. opts: {key:'p', angle:false (للقيم الزاوية المفردة), lowpass:5 Hz}
  // الأعلى (الأقرب للصفر) = أنعم. حركة min-jerk مثالية ≈ −6.6. يرجع null إذا ما ينحسب.
  U.ldlj = function (samples, opts) {
    const n = samples ? samples.length : 0;
    if (n < 8) return null;
    const key = (opts && opts.key) || 'p', angle = !!(opts && opts.angle);
    const fc = opts && opts.lowpass !== undefined ? +opts.lowpass : 5;
    const T = samples[n - 1].t - samples[0].t;
    if (!(T > 0)) return null;
    const dt = T / (n - 1);
    const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const v = samples[i][key];
      if (typeof v === 'number') X[i] = v;
      else if (v) { X[i] = v.x || 0; Y[i] = v.y || 0; Z[i] = v.z || 0; }
    }
    if (angle) for (let i = 1; i < n; i++) X[i] = X[i - 1] + U.wrap(X[i] - X[i - 1]);
    if (fc > 0) {                       // تنعيم أمامي وخلفي (بدون تأخير)
      const a = 1 - Math.exp(-2 * Math.PI * fc * dt);
      lp(X, a); lp(Y, a); lp(Z, a);
    }
    let L = 0;
    for (let i = 1; i < n; i++) { const dx = X[i] - X[i - 1], dy = Y[i] - Y[i - 1], dz = Z[i] - Z[i - 1]; L += Math.sqrt(dx * dx + dy * dy + dz * dz); }
    if (!(L > 1e-6)) return null;
    let J = 0;
    const k = 1 / (dt * dt * dt);
    for (let i = 2; i < n - 2; i++) {
      const jx = (0.5 * X[i + 2] - X[i + 1] + X[i - 1] - 0.5 * X[i - 2]) * k;
      const jy = (0.5 * Y[i + 2] - Y[i + 1] + Y[i - 1] - 0.5 * Y[i - 2]) * k;
      const jz = (0.5 * Z[i + 2] - Z[i + 1] + Z[i - 1] - 0.5 * Z[i - 2]) * k;
      J += (jx * jx + jy * jy + jz * jz) * dt;
    }
    const dlj = Math.pow(T, 5) / (L * L) * Math.max(J, 1e-12);
    return U.clamp(-Math.log(dlj), -40, 0);
  };
  function lp(A, a) {
    const n = A.length;
    let y = A[0];
    for (let i = 0; i < n; i++) { y += a * (A[i] - y); A[i] = y; }
    y = A[n - 1];
    for (let i = n - 1; i >= 0; i--) { y += a * (A[i] - y); A[i] = y; }
  }

  // ---------- معدلات الدوران حق Betaflight (fpv.md §1) ----------
  const RATE_LIMIT = 1998;
  const R = DS.Rates = {
    LIMIT: RATE_LIMIT,
    // "Actual" (الافتراضي من 4.3): c العصا [-1..1] بعد المنطقة الميتة → درجة/ث
    actual(c, center, max, expo) {
      if (c > 1) c = 1; else if (c < -1) c = -1;
      const a = c < 0 ? -c : c, c5 = c * c * c * c * c;
      const ex = a * (c5 * expo + c * (1 - expo));
      const r = c * center + Math.max(0, max - center) * ex;
      return r > RATE_LIMIT ? RATE_LIMIT : r < -RATE_LIMIT ? -RATE_LIMIT : r;
    },
    // القديمة: RC Rate / Super Rate / RC Expo (الافتراضي 1.00 / 0.70 / 0)
    betaflight(c, rcRate, superRate, rcExpo) {
      if (rcRate === undefined) rcRate = 1; if (superRate === undefined) superRate = 0.7; if (rcExpo === undefined) rcExpo = 0;
      if (c > 1) c = 1; else if (c < -1) c = -1;
      const a = c < 0 ? -c : c;
      if (rcExpo) c = c * (a * a * a * rcExpo + (1 - rcExpo));
      let r = rcRate;
      if (r > 2) r += 14.54 * (r - 2);
      let rate = 200 * r * c;
      if (superRate) rate *= 1 / Math.min(1, Math.max(0.01, 1 - a * superRate));
      return rate > RATE_LIMIT ? RATE_LIMIT : rate < -RATE_LIMIT ? -RATE_LIMIT : rate;
    },
    // العكس: كم لازم العصا عشان نوصل rateDeg (للطيار الآلي). fn: عصا → درجة/ث (فردية ومتزايدة)
    inverse(rateDeg, fn) {
      const s = rateDeg < 0 ? -1 : 1, t = rateDeg < 0 ? -rateDeg : rateDeg;
      if (!(t > 0)) return 0;
      if (t >= fn(1)) return s;
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fn(m) < t) lo = m; else hi = m; }
      return s * (lo + hi) / 2;
    },
    // نفس العكس لكن بدون دالة (ما فيه تخصيص ذاكرة في الحلقات)
    inverseActual(rateDeg, center, max, expo) {
      const s = rateDeg < 0 ? -1 : 1, t = rateDeg < 0 ? -rateDeg : rateDeg;
      if (!(t > 0)) return 0;
      if (t >= R.actual(1, center, max, expo)) return s;
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (R.actual(m, center, max, expo) < t) lo = m; else hi = m; }
      return s * (lo + hi) / 2;
    },
    // حسب الإعدادات: ax = 'roll' | 'pitch' | 'yaw'
    axis(c, ax, r) {
      r = r || (DS.settings && DS.settings.rates) || R.PRESETS.gamepad;
      return ax === 'yaw' ? R.actual(c, r.yawCenter, r.yawMax, r.yawExpo) : R.actual(c, r.center, r.max, r.expo);
    },
    invAxis(rateDeg, ax, r) {
      r = r || (DS.settings && DS.settings.rates) || R.PRESETS.gamepad;
      return ax === 'yaw' ? R.inverseActual(rateDeg, r.yawCenter, r.yawMax, r.yawExpo) : R.inverseActual(rateDeg, r.center, r.max, r.expo);
    },
    maxRate(ax, r) { return Math.abs(R.axis(1, ax, r)); },
    // قوالب جاهزة (fpv.md §1.2 — قيم اليد تقديرية)
    PRESETS: {
      beginner:   { center: 70,  max: 500, expo: 0.30, yawCenter: 70,  yawMax: 400, yawExpo: 0.30 },
      gamepad:    { center: 120, max: 750, expo: 0.55, yawCenter: 120, yawMax: 550, yawExpo: 0.50 },
      freestyle:  { center: 150, max: 900, expo: 0.60, yawCenter: 150, yawMax: 650, yawExpo: 0.55 },
      betaflight: { center: 70,  max: 670, expo: 0.00, yawCenter: 70,  yawMax: 670, yawExpo: 0.00 }
    },
    applyPreset(name) {
      const p = R.PRESETS[name];
      if (!p || !DS.settings) return false;
      DS.settings.rates = Object.assign({}, p);
      DS.settings.ratePreset = name;
      if (DS.saveSettings) DS.saveSettings();
      return true;
    }
  };

  // ---------- الثروتل حق FPV (fpv.md §3.3) ----------
  // gp: العصا اليسار ترجع للنص = تحويم. sy∈[-1,1]، H = ثروتل التحويم
  // تحت النص: خطي (أقوى ميل ممكن = H). فوق النص: إكسبو upE(H) عشان الميل عند النص نفس اللي تحت
  // (مثل ريموت حقيقي: نزلة صغيرة = نزول بنفس قوة الصعود). تحت للآخر = 0، فوق للآخر = 1
  // E قديم: باقي في التوقيع للتوافق بس (المنحنى ما يستخدمه)
  const Th = DS.Throttle = {
    E: 0.45, HOVER: 0.22, TRIG_EXP: 1.4, UP_E_MAX: 0.85,
    // (1 − E)(1 − H) = H → نفس الميل فوق وتحت النص
    upE(H) {
      if (!(H > 0.01 && H < 0.99)) H = Th.HOVER;
      return H >= 0.5 ? 0 : Math.min(Th.UP_E_MAX, 1 - H / (1 - H));
    },
    gp(sy, H, E) {
      if (!(H > 0.01 && H < 0.99)) H = Th.HOVER;
      if (sy > 1) sy = 1; else if (sy < -1) sy = -1; else if (!(sy === sy)) sy = 0;
      if (sy <= 0) return H + sy * H;
      const e = Th.upE(H), d = sy * (1 - e + e * sy * sy);
      return H + d * (1 - H);
    },
    // العكس: وين العصا عشان نوصل ثروتل معيّن
    inv(thr, H, E) {
      if (!(H > 0.01 && H < 0.99)) H = Th.HOVER;
      if (thr > 1) thr = 1; else if (!(thr > 0)) thr = 0;
      if (thr <= H) return (thr - H) / H;
      const d = (thr - H) / (1 - H), e = Th.upE(H);
      if (e < 1e-6) return d;
      const s = cubicRoot(e, 1 - e, d);
      return s > 1 ? 1 : s < 0 ? 0 : s;
    },
    trigger(v) { return v > 0 ? Math.pow(v > 1 ? 1 : v, Th.TRIG_EXP) : 0; },
    invTrigger(t) { return t > 0 ? Math.pow(t > 1 ? 1 : t, 1 / Th.TRIG_EXP) : 0; },
    linear(sy) { return U.clamp((sy + 1) / 2, 0, 1); },
    invLinear(t) { return U.clamp(2 * t - 1, -1, 1); }
  };

  // ---------- الحفظ في المتصفح ----------
  U.load = (k, def) => { try { const v = localStorage.getItem('dsim.' + k); return v ? Object.assign(Array.isArray(def) ? [] : {}, def, JSON.parse(v)) : def; } catch (e) { return def; } };
  U.save = (k, v) => { try { localStorage.setItem('dsim.' + k, JSON.stringify(v)); } catch (e) { /* ممكن التخزين مقفول */ } };

  // يكمّل المفاتيح الناقصة ويصلّح الأنواع الغلط (يدخل جوا الكائنات العادية)
  const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
  function fill(dst, def, shallow) {
    for (const k in def) {
      const dv = def[k], v = dst[k];
      if (v === undefined || v === null || typeof v !== typeof dv || Array.isArray(dv) !== Array.isArray(v)) { dst[k] = dv; continue; }
      if (isObj(dv) && !(shallow && shallow[k])) fill(v, dv);
    }
    return dst;
  }

  // كل الإعدادات (V2_CONTRACT §5) — المفاتيح القديمة باقية عشان ما ينكسر شي
  DS.defaultSettings = () => ({
    v: 2,
    stickMode: 2,        // 2 = Mode 2 (الارتفاع يسار) ، 1 = Mode 1 (3 و 4 نادرة)
    deadzone: 0.05,      // المنطقة الميتة الدائرية (الخارجية ثابتة 0.03)
    djiExp: {            // EXP حق DJI لكل وضع (ATTI ياخذ قيم N)
      C: { thr: 0.30, yaw: 0.20, rp: 0.25 },
      P: { thr: 0.30, yaw: 0.20, rp: 0.25 },
      S: { thr: 0.40, yaw: 0.30, rp: 0.40 }
    },
    rates: { center: 120, max: 750, expo: 0.55, yawCenter: 120, yawMax: 550, yawExpo: 0.5 },   // FPV (قالب اليد)
    ratePreset: 'gamepad',
    fpvThrottle: 'center',   // 'center' النص = تحويم • 'trigger' الزناد RT • 'stick' خطي (ريموت حقيقي)
    fpvUptilt: 25,           // ميلان كاميرا FPV (درجة)
    fpvFov: 100,             // زاوية رؤية FPV العمودية (درجة)
    quality: 'auto',         // 'auto' | 'high' | 'medium' | 'low' | 'tv'
    tvMode: false,
    sensors: true,           // حساسات تفادي العوائق (Mini: C و N بس)
    osd: true,
    voice: true,             // المدرب يتكلم
    rumble: true,            // اهتزاز اليد
    videoLatency: 'real',    // 'real' (Mini +120ms، FPV بدون تأخير إضافي — المتصفح والشاشة يضيفون 30–50ms) | 'off'
    aids: 'auto',
    eyeFov: 'real',          // 'real' عين الطيار الحقيقية 40° | 'zoom' زوم تلقائي (مثل النسخة الأولى)
    showSticks: true,        // رسمة العصي تحت
    visualAid: true,         // دائرة حول الدرون إذا بعد
    pip: true,               // كاميرا الدرون الصغيرة
    sound: true,
    camera: 'pilot',
    airframe: 'mini',        // 'mini' | 'fpv'
    unlockAll: false,
    remap: {},               // {gamepadId: {...}} إعادة توزيع الأزرار لكل يد
    calib: {},               // {gamepadId: {c:[4], lo:[4], hi:[4]}} معايرة العصي لكل يد
    // إضافات المرحلة 2 (شاشة الإعدادات)
    brakeSens: 100,          // قوة الفرامل (Mini) 100 = مثل DJI
    airmode: true,           // FPV Airmode (التحكم يبقى والثروتل تحت)
    smartRth: true,          // رجوع ذكي لما البطارية تقرب تخلص (Mini)
    freeOpts: { airframe: 'mini', zone: 'field', timeOfDay: 'day', wind: 'light' },   // آخر اختيار بالطيران الحر
    // الموقع والجوال
    touch: 'auto',           // عصي وأزرار اللمس: 'auto' (أجهزة اللمس) | 'on' (دايم) | 'off'
    googleKey: '',           // مفتاح خرائط قوقل الخاص (اختياري — الموقع فيه مفتاح جاهز). ما يطلع بالسجل أبد
    // مفاتيح النسخة الأولى (باقية للتوافق)
    expo: 0.25, autoZoom: false, allowManual: false
  });
  const ENUMS = {
    fpvThrottle: ['center', 'trigger', 'stick'], airframe: ['mini', 'fpv'], eyeFov: ['real', 'zoom'],
    videoLatency: ['real', 'off'], quality: ['auto', 'high', 'medium', 'low', 'tv'],
    ratePreset: ['beginner', 'gamepad', 'freestyle', 'betaflight', 'custom'], touch: ['auto', 'on', 'off']
  };
  // مفتاح API: حروف وأرقام و _ - بس، 100 حرف بالكثير (مفاتيح قوقل 39 حرف)
  U.cleanKey = v => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100) : '');
  DS.sanitizeSettings = function (s) {
    const def = DS.defaultSettings();
    if (!isObj(s)) s = {};
    // من النسخة الأولى: كانت تحفظ كل القيم الافتراضية، فنحدّث اللي تغيّر افتراضيه
    if (!(s.v >= 2) && Object.keys(s).length) {
      if (s.deadzone === 0.08) s.deadzone = 0.05;
      s.eyeFov = 'real';
      s.autoZoom = false;
      s.v = 2;
    }
    fill(s, def, { remap: 1, calib: 1 });
    const num = (k, a, b) => { s[k] = Number.isFinite(s[k]) ? U.clamp(s[k], a, b) : def[k]; };
    num('deadzone', 0, 0.3); num('fpvUptilt', 0, 60); num('fpvFov', 60, 160); num('expo', 0, 1);
    if ([1, 2, 3, 4].indexOf(s.stickMode) < 0) s.stickMode = 2;
    for (const k in ENUMS) if (ENUMS[k].indexOf(s[k]) < 0) s[k] = def[k];
    for (const m in s.djiExp) {
      const e = s.djiExp[m];
      if (!isObj(e)) { delete s.djiExp[m]; continue; }
      for (const a of ['thr', 'yaw', 'rp']) e[a] = Number.isFinite(e[a]) ? U.clamp(e[a], 0.1, 0.9) : def.djiExp.P[a];
    }
    for (const k in def.rates) {
      const lim = /xpo/i.test(k) ? 1 : RATE_LIMIT;
      s.rates[k] = Number.isFinite(s.rates[k]) ? U.clamp(s.rates[k], 0, lim) : def.rates[k];
    }
    // إضافات المرحلة 2
    num('brakeSens', 30, 150);
    if (['auto', 'full', 'rings', 'none', 'off'].indexOf(s.aids) < 0) s.aids = def.aids;
    const FO = { airframe: ['mini', 'fpv'], zone: ['field', 'city', 'race', 'desert'], timeOfDay: ['day', 'sunset', 'night'], wind: ['calm', 'light', 'strong'] };
    for (const k in FO) if (FO[k].indexOf(s.freeOpts[k]) < 0) s.freeOpts[k] = def.freeOpts[k];
    s.googleKey = U.cleanKey(s.googleKey);
    return s;
  };

  let rawSettings = null;
  try { const v = localStorage.getItem('dsim.settings'); rawSettings = v ? JSON.parse(v) : null; } catch (e) { rawSettings = null; }
  DS.settings = DS.sanitizeSettings(rawSettings);
  DS.saveSettings = () => U.save('settings', DS.settings);
  // يرجّع الافتراضي (يخلي توزيع ومعايرة الأيادي إلا إذا all = true)
  DS.resetSettings = function (all) {
    const keep = DS.settings || {}, s = DS.defaultSettings();
    if (!all) { s.remap = keep.remap || {}; s.calib = keep.calib || {}; s.googleKey = U.cleanKey(keep.googleKey); }
    DS.settings = s; DS.saveSettings();
    return s;
  };

  DS.defaultProgress = () => ({ best: {}, exams: [], lessons: {}, flightTime: 0, course: {} });
  DS.progress = fill(U.load('progress', DS.defaultProgress()), DS.defaultProgress());
  DS.saveProgress = () => U.save('progress', DS.progress);

  // ---------- الأصوات ----------
  const curAirframe = () => { const s = DS.app && DS.app.session, d = s && s.drone; return (d && d.airframe) || 'mini'; };
  const A = DS.Audio = {
    ctx: null, _fpv: null, _sp: { vol: 1, pitch: 1 },
    init() {
      if (this.ctx) return;
      try {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return;
        const ctx = this.ctx = new C();
        // صوت الموتور: موجتين + فلتر، وفوقها نفخة المراوح (ضجيج مفلتر)
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
        o1.type = 'sawtooth'; o2.type = 'triangle';
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; f.Q.value = 0.7;
        const g = ctx.createGain(); g.gain.value = 0;
        o1.connect(f); o2.connect(f); f.connect(g); g.connect(ctx.destination);
        o1.start(); o2.start();
        this.o1 = o1; this.o2 = o2; this.mf = f; this.mg = g;
        try {
          const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), ch = nb.getChannelData(0);
          for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
          const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
          const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.9;
          const ng = ctx.createGain(); ng.gain.value = 0.2;
          ns.connect(nf); nf.connect(ng); ng.connect(g); ns.start();
          this.nf = nf; this.ng = ng;
        } catch (e) { this.nf = this.ng = null; }
      } catch (e) { this.ctx = null; }
    },
    resume() {
      if (!DS.settings.sound) return;
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') { try { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* */ } }
    },
    // ضغطة زر في اليد (Gamepad/NativePad): كروم ما يحسبها "تفاعل"، بس التلفزيون (WebView) يسمح.
    // نسوي الصوت ونحاول نشغّله، ونفك قفل الصوت الناطق بس إذا المتصفح شاف تفاعل حقيقي قبل
    padWake() {
      try {
        if (!this.ctx || this.ctx.state !== 'running') this.resume();
        const n = window.navigator, ua = n && n.userActivation;
        if (V.blocked && (!ua || ua.hasBeenActive)) V.blocked = false;
      } catch (e) { /* */ }
    },
    // يحتاج ضغطة كيبورد/ماوس عشان يطلع صوت؟ (للشاشات: «🔇 اضغط Enter أو انقر بالماوس مرة وحدة عشان يشتغل الصوت»)
    needsGesture() {
      try {
        if (!DS.settings || DS.settings.sound === false) return false;
        if (isHeadless() || nativeTTS()) return false;   // التلفزيون: أول ضغطة في اليد تشغّله (padWake)
        const n = window.navigator, ua = n && n.userActivation;
        if (ua && !ua.hasBeenActive) return true;
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return false;
        return !this.ctx || this.ctx.state !== 'running';
      } catch (e) { return false; }
    },
    // on: المحركات شغالة • load: الحمل 0..1 • vol: مستوى الصوت (مع البعد) • pitchMul: دوبلر • airframe اختياري
    motor(on, load, vol, pitchMul, airframe) {
      if (!this.ctx || !this.mg) return;
      const L = U.clamp(+load || 0, 0, 1.2), pm = pitchMul > 0 ? U.clamp(pitchMul, 0.5, 2) : 1;
      const v = vol === undefined || vol === null ? 1 : U.clamp(+vol || 0, 0, 1.5);
      const fpv = (airframe || curAirframe()) === 'fpv';
      if (fpv !== this._fpv) { this._fpv = fpv; this.o2.type = fpv ? 'square' : 'triangle'; }
      const t = this.ctx.currentTime;
      // Mini: صفير ناعم (نفس النسخة الأولى) • FPV: أعلى وأخشن ويتغير كثير مع الثروتل
      const fr = (fpv ? 240 + 1050 * L : 150 + 190 * L) * pm;
      this.o1.frequency.setTargetAtTime(fr, t, 0.05);
      this.o2.frequency.setTargetAtTime(fr * (fpv ? 1.51 : 2.02), t, 0.05);
      this.mf.frequency.setTargetAtTime(fpv ? 1500 + 2600 * L : 1000 + 500 * L, t, 0.08);
      if (this.nf) {
        this.nf.frequency.setTargetAtTime(fr * 2.6, t, 0.08);
        this.ng.gain.setTargetAtTime((fpv ? 0.32 : 0.2) * (0.3 + L), t, 0.1);
      }
      this.mg.gain.setTargetAtTime(on && DS.settings.sound ? (fpv ? 0.05 : 0.045) * v : 0, t, 0.08);
    },
    // البعد والدوبلر: dist (م) من السامع • vAway (م/ث) سرعة الابتعاد (+ يبعد). يرجع {vol, pitch}
    spatial(dist, vAway, out) {
      out = out || this._sp;
      const REF = 3, d = dist > REF ? dist : REF;
      out.vol = U.clamp(REF / d, 0.03, 1);
      out.pitch = U.clamp(343 / (343 + (+vAway || 0)), 0.85, 1.18);
      return out;
    },
    beep(freq = 880, dur = 0.12, type = 'sine', vol = 0.15, when = 0) {
      if (!this.ctx || !DS.settings.sound) return;
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.05);
    },
    ok() { this.beep(660, 0.1); this.beep(990, 0.18, 'sine', 0.15, 0.1); },
    step() { this.beep(880, 0.08, 'sine', 0.1); },
    fail() { this.beep(240, 0.25, 'sawtooth', 0.12); this.beep(180, 0.35, 'sawtooth', 0.12, 0.22); },
    warn() { this.beep(1250, 0.07, 'square', 0.07); this.beep(1250, 0.07, 'square', 0.07, 0.14); },
    click() { this.beep(1400, 0.03, 'sine', 0.06); },
    win() { [523, 659, 784, 1046].forEach((f, i) => this.beep(f, 0.22, 'sine', 0.14, i * 0.13)); }
  };

  // ---------- الصوت الناطق (المدرب يتكلم) ----------
  // say(text, {priority:'high'|'normal'|'low'}) • stop() • enabled
  // يختار صوت ar-SA وإلا أي عربي وإلا الافتراضي • سرعة 0.95 • ما يكرر نفس الجملة خلال 4 ث • طابور جملتين
  // ما يسوي شي إذا المتصفح بدون شاشة (الفحص الذاتي) أو ما فيه speechSynthesis
  let headlessFlag = null;
  const isHeadless = () => {
    if (headlessFlag === null) {
      try { const n = window.navigator; headlessFlag = !n || !!n.webdriver || /headless/i.test(n.userAgent || ''); } catch (e) { headlessFlag = true; }
    }
    return headlessFlag;
  };
  const nativeTTS = () => { const n = window.NativeTTS; return n && typeof n.speak === 'function' ? n : null; };
  // نشيل الإيموجي والرموز اللي المحرك يقراها بصوت (⚠️ ← •)
  const cleanText = t => String(t)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/[←-⇿➔-➿•·|]/g, '، ')
    .replace(/\s+/g, ' ').replace(/(،\s*)+/g, '، ').replace(/^[،\s]+|[،\s]+$/g, '');
  const PRIO = { high: 2, normal: 1, low: 0 };

  const V = DS.Voice = {
    enabled: true, rate: 0.95, lang: 'ar-SA', voice: null, blocked: false, maxQueue: 2, dedupMs: 4000,
    _q: [], _cur: null, _curText: '', _wd: 0, _seen: Object.create(null), _seenN: 0, _init: false, _bad: Object.create(null),
    supported() {
      if (isHeadless()) return false;
      if (nativeTTS()) return true;
      return typeof window.speechSynthesis === 'object' && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function';
    },
    get speaking() { return !!this._cur; },
    // المدرب ما يقدر يتكلم لين تضغط كيبورد/ماوس مرة (كروم ما يحسب أزرار اليد) — للشاشات: «انقر بالماوس أو اضغط Enter مرة وحدة وبعدين جرّب»
    needsGesture() {
      try {
        if (isHeadless() || nativeTTS()) return false;
        if (this.blocked) return true;
        const n = window.navigator, ua = n && n.userActivation;
        return !!(ua && !ua.hasBeenActive);
      } catch (e) { return false; }
    },
    say(text, opts) {
      if (!text || !this.enabled || this.blocked) return false;
      if (DS.settings && DS.settings.voice === false) return false;
      if (!this.supported()) return false;
      if (typeof document !== 'undefined' && document.hidden) return false;
      const t = cleanText(text);
      if (!t) return false;
      let pr = opts && opts.priority !== undefined ? opts.priority : 1;
      if (typeof pr === 'string') pr = PRIO[pr] !== undefined ? PRIO[pr] : 1;
      const now = U.now(), last = this._seen[t];
      if (last !== undefined && now - last < this.dedupMs) return false;
      if (this._curText === t || this._q.indexOf(t) >= 0) return false;
      if (pr <= 0 && this._cur) return false;              // المنخفض: بس إذا ساكت
      this._remember(t, now);
      this._ensureInit();
      const nat = nativeTTS();
      if (nat) {
        try { if (pr >= 2 && typeof nat.stop === 'function') nat.stop(); nat.speak(t, this.rate); } catch (e) { return false; }
        return true;
      }
      if (pr >= 2) { this._q.length = 0; this._cancel(); this._speak(t); return true; }
      if (!this._cur) { this._speak(t); return true; }
      if (this._q.length >= this.maxQueue) this._q.shift();  // الأحدث أهم
      this._q.push(t);
      return true;
    },
    stop() {
      this._q.length = 0;
      const nat = nativeTTS();
      if (nat && typeof nat.stop === 'function') { try { nat.stop(); } catch (e) { /* */ } }
      this._cancel();
    },
    _cancel() {
      clearTimeout(this._wd);
      this._cur = null; this._curText = '';
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* */ }
    },
    _remember(t, now) {
      this._seen[t] = now;
      if (++this._seenN > 40) {                             // تنظيف القديم
        const s = Object.create(null); let n = 0;
        for (const k in this._seen) if (now - this._seen[k] < this.dedupMs) { s[k] = this._seen[k]; n++; }
        this._seen = s; this._seenN = n;
      }
    },
    _ensureInit() {
      if (this._init) return;
      this._init = true;
      const ss = window.speechSynthesis;
      if (!ss) return;
      this._pick();
      try {
        const f = () => this._pick();
        if (typeof ss.addEventListener === 'function') ss.addEventListener('voiceschanged', f);
        else ss.onvoiceschanged = f;
      } catch (e) { /* */ }
    },
    _pick() {
      try {
        const list = window.speechSynthesis.getVoices() || [];
        let best = null, bs = 0;
        for (let i = 0; i < list.length; i++) {
          const v = list[i], lang = String(v.lang || '').toLowerCase().replace('_', '-'), nm = String(v.name || '');
          if (this._bad[nm]) continue;
          let s;
          if (lang === 'ar-sa') s = 10; else if (lang.indexOf('ar') === 0) s = 5; else continue;
          if (/natural|neural/i.test(nm)) s += 3;
          if (/google/i.test(nm)) s += 2;
          if (v.localService) s += 1;
          if (s > bs) { bs = s; best = v; }
        }
        this.voice = best;
      } catch (e) { this.voice = null; }
    },
    _speak(t) {
      const ss = window.speechSynthesis;
      if (!ss || typeof window.SpeechSynthesisUtterance !== 'function') return;
      let u;
      try {
        u = new window.SpeechSynthesisUtterance(t);
        u.lang = this.voice ? this.voice.lang : this.lang;
        if (this.voice) u.voice = this.voice;
        u.rate = this.rate; u.pitch = 1; u.volume = 1;
      } catch (e) { return; }
      const done = ev => {
        if (this._cur !== u) return;                        // جملة قديمة انقطعت
        clearTimeout(this._wd);
        this._cur = null; this._curText = '';
        const err = ev && ev.error;
        if (err === 'not-allowed') { this.blocked = true; this._q.length = 0; return; }   // يرجع بعد أول ضغطة
        if ((err === 'network' || err === 'synthesis-failed' || err === 'voice-unavailable') && this.voice) {
          this._bad[this.voice.name] = true; this._pick();   // صوت أونلاين وما فيه نت: جرّب غيره
        }
        this._next();
      };
      u.onend = done; u.onerror = done;
      this._cur = u; this._curText = t;                     // نخلي مرجع عشان ما ينحذف قبل ما يخلص
      try {
        if (ss.paused) ss.resume();
        ss.speak(u);
      } catch (e) { this._cur = null; this._curText = ''; return; }
      clearTimeout(this._wd);
      this._wd = setTimeout(() => done(null), 3000 + t.length * 140);   // احتياط إذا ما وصل onend
    },
    _next() { if (this._q.length) this._speak(this._q.shift()); }
  };

  // ما يشتغل الصوت إلا بعد أول ضغطة من المستخدم
  // الجوال: اللمس يحسب "تفاعل" عند الرفع (pointerup / touchend) مو عند النزول — فنسمع لهم بعد
  if (typeof window.addEventListener === 'function') {
    ['keydown', 'pointerdown', 'pointerup', 'touchend'].forEach(ev => window.addEventListener(ev, () => { A.resume(); V.blocked = false; }, { passive: true }));
    // آيفون/آيباد: الصوت الناطق ما يشتغل إلا إذا أول جملة طلعت من لمسة — نقول جملة فاضية مرة وحدة
    let spoke0 = false;
    window.addEventListener('touchend', () => {
      if (spoke0) return; spoke0 = true;
      try {
        const ss = window.speechSynthesis;
        if (nativeTTS() || isHeadless() || !ss || typeof window.SpeechSynthesisUtterance !== 'function' || !/iP(hone|ad|od)|Macintosh/.test(window.navigator.userAgent || '')) return;
        const u = new window.SpeechSynthesisUtterance(' '); u.volume = 0; ss.speak(u);
      } catch (e) { /* */ }
    }, { passive: true });
  }
})();
