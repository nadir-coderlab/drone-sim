// قراءة يد التحكم (إكس بوكس / بلايستيشن / ريموت RC / جسر أندرويد NativePad) والكيبورد وعصي اللمس (الجوال)
//
// المسار: اختيار الجهاز (standard أولاً) ← إعادة التوزيع settings.remap[id] ← معايرة النص settings.calib[id]
//   ← منطقة ميتة دائرية (settings.deadzone) + خارجية 0.03 ← دائرة→مربع (Fong) ← Mode 1/2/3/4
//   ← المنحنيات: Mini = EXP حق DJI لكل وضع • FPV = خام (المعدلات بالفيزياء) + throttle01 حسب settings.fpvThrottle
//
// اللمس (js/touch.js → DS.Touch): إذا ما فيه يد متصلة ونحن نطير على جهاز لمس، العصي والأزرار اللي على الشاشة
//   تدخل هنا كأنها يد (I.source = 'touch'): منطقة ميتة صغيرة ثابتة ← دائرة→مربع ← نفس Mode 1/2 والمنحنيات.
//   ثروتل FPV باللمس دايم «النص = تحويم» (العصا ترجع للنص). أول ما تتصل يد، اللمس يختفي ويتجاهل.
//
// الكيبورد (بديل لليد):
//   W/S ارتفاع (ثروتل) • A/D لف (Yaw) • الأسهم: قدام/ورا/جنب • Shift مع أي منها = نص العصا بس
//   Space = A • R أو B = B • M أو X = X • C = Y • U = LB • O = RB • Q/E = LT/RT • V = VIEW • P = START
//   I/K/J/L (أو النمباد 8/2/4/6) = أسهم اليد (D-pad): فوق/تحت/يسار/يمين
//
// شكل settings.remap[id] (كل شي اختياري، الناقص = الترتيب القياسي W3C):
//   { axes: { lx:{i:0,inv:false}, ly:.., rx:.., ry:..,        // رقم المحور (اتجاه القياسي: يمين +، تحت +)
//             lt:{b:6} | {i:4, range:'full'|'half', inv}, rt:.. },  // الزناد: زر أو محور (full = −1..1، half = 0..1)
//     buttons: { A:0, B:1, ..., UP:12 | {a:axisIndex, dir:±1} },      // زر = رقم الزر، أو محور يشتغل كزر
//     hat: 9,               // محور POV hat للأسهم (بعض الأيادي غير القياسية)
//     gate: 'square' }      // ريموت RC بوابته مربعة: منطقة ميتة لكل محور وبدون دائرة→مربع
(function () {
  'use strict';
  const DS = window.DS, U = DS.U;
  const BTN = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'START', 'LS', 'RS', 'UP', 'DOWN', 'LEFT', 'RIGHT'];
  const NB = BTN.length, B_UP = 12, B_DOWN = 13, B_LEFT = 14, B_RIGHT = 15;
  const AX = ['lx', 'ly', 'rx', 'ry'];
  const OUTER_DZ = 0.03;
  const DEF_HOVER = 0.22;
  const UNSET = {};

  const I = DS.Input = {
    connected: false, name: '', source: 'keyboard',
    axes: { thr: 0, yaw: 0, pitch: 0, roll: 0 },     // بعد المنطقة الميتة والمنحنيات (اللي تروح للفيزياء)
    throttle01: DEF_HOVER,                          // ثروتل FPV 0..1
    raw: { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, axes: [], buttons: [] },   // lx..ry بعد التوزيع وقبل المعايرة؛ axes/buttons خام من الجهاز
    cal: { lx: 0, ly: 0, rx: 0, ry: 0 },            // بعد المعايرة وقبل المنطقة الميتة
    sticks: { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } },   // مكان العصي (فوق = +) بعد المنطقة الميتة وقبل المنحنى — للرسم
    held: {}, pressed: {}, nav: {}, lt: 0, rt: 0,
    keys: {}, kb: { thr: 0, yaw: 0, pitch: 0, roll: 0 },
    hover: DEF_HOVER,                               // ثروتل التحويم الحي (الفيزياء تحدثه)
    driftWarn: false, drift: { lx: 0, ly: 0, rx: 0, ry: 0 },   // انحراف النص وقت الراحة
    needsRemap: false, badAxes: [],                 // يد غير قياسية بدون توزيع / محاور واقفة على الطرف (غالباً زناد)
    atRest: true, anyPress: false, deviceSeq: 0,
    touch: false,                                   // عصي اللمس شغالة الحين (DS.Touch)
    axisSource: 'keyboard',                         // مين حرّك العصي آخر شي: 'keyboard' | 'gamepad' | 'native' | 'touch'
    curveCtx: { airframe: 'mini', mode: 'P' },
    calibration: { active: false, kind: '', t: 0, n: 0, id: '', result: null },
    _prev: {}, _navT: {}
  };
  for (let b = 0; b < NB; b++) { I.held[BTN[b]] = false; I.pressed[BTN[b]] = false; I._prev[BTN[b]] = false; }
  for (const d of ['UP', 'DOWN', 'LEFT', 'RIGHT']) { I.nav[d] = false; I._navT[d] = -1; }

  // ---------- الكيبورد ----------
  const KEYMAP = [
    ['Space', 'A'], ['KeyR', 'B'], ['KeyB', 'B'], ['KeyM', 'X'], ['KeyX', 'X'], ['KeyC', 'Y'],
    ['KeyU', 'LB'], ['KeyO', 'RB'], ['KeyV', 'VIEW'], ['KeyP', 'START'],
    ['KeyI', 'UP'], ['KeyK', 'DOWN'], ['KeyJ', 'LEFT'], ['KeyL', 'RIGHT'],
    ['Numpad8', 'UP'], ['Numpad2', 'DOWN'], ['Numpad4', 'LEFT'], ['Numpad6', 'RIGHT']
  ];
  const FLIGHT_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
  const editable = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('keydown', e => {
      if (editable(e.target)) return;
      I.keys[e.code || 'Kc' + e.keyCode] = true;   // بعض WebView (التلفزيون) ترسل code فاضي
      if (DS.app && DS.app.state === 'fly' && FLIGHT_KEYS.indexOf(e.code) >= 0) e.preventDefault();
    });
    window.addEventListener('keyup', e => { I.keys[e.code || 'Kc' + e.keyCode] = false; });
    window.addEventListener('blur', () => { for (const k in I.keys) I.keys[k] = false; });
  }

  // ---------- حالة الجهاز ----------
  const dev = { src: 'keyboard', id: '', name: '', mapping: '', nAx: 0, nBtn: 0, index: -1, age: 0, gp: null };
  const pAx = I.raw.axes, pBtn = I.raw.buttons, pPr = [];   // قيم خام (مصفوفات نعيد استخدامها)
  const NAT = new Float64Array(12);
  let lastIdx = -1, natIdT = 0, natTrigRaw = false, suspMask = 0;
  I.padCount = 0; I.lockDevice = false;   // lockDevice = true: لا تبدّل اليد (الشاشات تقدر تقفلها)

  // ---------- أكثر من يد: نختار اللي تستخدمها الحين ----------
  // لكل يد: قيم الراحة أول ما نشوفها + حالة الأزرار. نبدّل لها إذا ضغطت زر جديد فيها أو حرّكت عصا
  // أكثر من 0.5 عن راحتها مرتين ورا بعض (مو وقت المعايرة أو توزيع الأزرار)
  const PADS = [];
  function padRec(c) {
    let r = PADS[c.index];
    if (!r || r.id !== c.id) {
      const na = Math.min(c.axes.length, 8), nb = Math.min(c.buttons ? c.buttons.length : 0, 24);
      r = PADS[c.index] = { id: c.id, nAx: na, rest: new Float32Array(na), prev: new Uint8Array(nb), moveN: 0 };
      for (let i = 0; i < na; i++) { const v = +c.axes[i]; r.rest[i] = v === v ? v : 0; }
      for (let i = 0; i < nb; i++) { const b = c.buttons[i]; r.prev[i] = b && (b.pressed || b.value > 0.5) ? 1 : 0; }
    }
    return r;
  }
  function padActive(c, r) {
    let edge = false;
    const nb = c.buttons ? Math.min(c.buttons.length, r.prev.length) : 0;
    for (let i = 0; i < nb; i++) {
      const b = c.buttons[i], p = b && (b.pressed || b.value > 0.5) ? 1 : 0;
      if (p && !r.prev[i]) edge = true;
      r.prev[i] = p;
    }
    let mv = false;
    for (let i = 0; i < r.nAx && i < c.axes.length; i++) { const v = +c.axes[i]; if (v === v && Math.abs(v - r.rest[i]) > 0.5) { mv = true; break; } }
    r.moveN = mv ? r.moveN + 1 : 0;
    return edge || r.moveN >= 2;
  }
  function devLocked() {
    if (I.lockDevice || I.calibration.active) return true;
    const ui = DS.UI, cur = ui && ui.cur;
    return !!(cur && (cur.name === 'calib' || cur.name === 'remap'));
  }

  function setDev(src, id, mapping) {
    if (src === dev.src && id === dev.id) return;
    dev.src = src; dev.id = id; dev.mapping = mapping; dev.age = 0;
    dev.name = id ? id.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim() : '';
    natTrigRaw = false; suspMask = 15;
    I.badAxes = [];
    R.from = UNSET; C.from = UNSET;
    resetDrift();
    if (I.calibration.active) I.calibration.active = false;
    I.deviceSeq++;
  }

  function readDevice(S) {
    let g = null;
    I.padCount = 0;
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      let list = null;
      try { list = navigator.getGamepads(); } catch (e) { list = null; }
      if (list) {
        // أول مرة (أو اليد انفصلت): الأفضل حسب النوع. بعدين: نبقى على نفس اليد إلا إذا استخدمت يد ثانية
        let bs = -1, best = null, cur = null, act = null, n = 0;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (!c || !c.connected || !c.axes || c.axes.length < 2) continue;
          n++;
          const hit = padActive(c, padRec(c));
          if (c.index === lastIdx) cur = c;
          else if (hit && !act) act = c;
          const sc = (c.mapping === 'standard' ? 8 : 0) + (S.remap && S.remap[c.id] ? 8 : 0) + (c.axes.length >= 4 ? 2 : 0);
          if (sc > bs) { bs = sc; best = c; }
        }
        I.padCount = n;
        g = cur || best;
        if (act && cur && !devLocked()) g = act;
      }
    }
    dev.gp = g;
    if (g) {
      lastIdx = g.index;
      setDev('gamepad', String(g.id || 'gamepad'), g.mapping === 'standard' ? 'standard' : String(g.mapping || ''));
      const na = g.axes.length, nb = g.buttons ? g.buttons.length : 0;
      pAx.length = na; pBtn.length = nb; pPr.length = nb;
      for (let i = 0; i < na; i++) { const v = g.axes[i]; pAx[i] = v === v && v !== undefined ? +v : 0; }
      for (let i = 0; i < nb; i++) {
        const b = g.buttons[i];
        const v = b ? (+b.value || 0) : 0, p = b && b.pressed ? 1 : 0;
        pBtn[i] = v > 0 ? v : p; pPr[i] = p;
      }
      dev.nAx = na; dev.nBtn = nb;
      return;
    }
    // جسر أندرويد TV (tv.md §4): seq,buttons,lx,ly,rx,ry,lt,rt,hatX,hatY,rawRX,rawRY
    const NP = window.NativePad;
    if (NP && typeof NP.state === 'function') {
      let s = '';
      try { s = NP.state(); } catch (e) { s = ''; }
      if (s && parseNums(String(s), NAT) >= 10 && NAT[0] > 0) {
        let id = dev.src === 'native' ? dev.id : '';
        if (!id || (natIdT -= 1) <= 0) {
          natIdT = 120;
          try { id = String(NP.device ? NP.device() || '' : ''); } catch (e) { id = ''; }
        }
        setDev('native', id || 'NativePad', 'standard');
        const bits = NAT[1] | 0;
        pBtn.length = 20; pPr.length = 20; pAx.length = 10;
        for (let i = 0; i < 20; i++) pPr[i] = pBtn[i] = (bits >> i) & 1;
        if (NAT[8] <= -0.5) pPr[B_LEFT] = pBtn[B_LEFT] = 1; else if (NAT[8] >= 0.5) pPr[B_RIGHT] = pBtn[B_RIGHT] = 1;
        if (NAT[9] <= -0.5) pPr[B_UP] = pBtn[B_UP] = 1; else if (NAT[9] >= 0.5) pPr[B_DOWN] = pBtn[B_DOWN] = 1;
        let lt = U.clamp(NAT[6], 0, 1), rt = U.clamp(NAT[7], 0, 1);
        // DualSense على أندرويد قديم: الزنادات على RX/RY من −1 لـ 1 (نعرفه إذا شفنا −1 وهو مرتاح)
        if (!natTrigRaw && lt === 0 && rt === 0 && (NAT[10] <= -0.9 || NAT[11] <= -0.9)) natTrigRaw = true;
        if (natTrigRaw) { lt = Math.max(lt, (NAT[10] + 1) / 2); rt = Math.max(rt, (NAT[11] + 1) / 2); }
        if (lt > pBtn[6]) pBtn[6] = lt;
        if (rt > pBtn[7]) pBtn[7] = rt;
        for (let i = 0; i < 10; i++) pAx[i] = NAT[i + 2];
        dev.nAx = 10; dev.nBtn = 20;
        return;
      }
    }
    setDev('keyboard', '', '');
    pAx.length = 0; pBtn.length = 0; pPr.length = 0;
    dev.nAx = 0; dev.nBtn = 0;
  }

  // يقرا أرقام CSV بدون ما يسوي نصوص جديدة (يدعم 1.0E-4 حق جافا؛ NaN = 0)
  function parseNums(s, out) {
    const L = s.length;
    let n = 0, i = 0;
    while (n < out.length) {
      let sign = 1, val = 0, any = false, c;
      while (i < L && s.charCodeAt(i) === 32) i++;
      c = s.charCodeAt(i);
      if (c === 45) { sign = -1; i++; } else if (c === 43) i++;
      while (i < L) { c = s.charCodeAt(i); if (c < 48 || c > 57) break; val = val * 10 + (c - 48); i++; any = true; }
      if (c === 46) {
        i++;
        let f = 0, fd = 0;
        while (i < L) { c = s.charCodeAt(i); if (c < 48 || c > 57) break; f = f * 10 + (c - 48); fd++; i++; any = true; }
        if (fd) val += f / Math.pow(10, fd);
      }
      if (any && (c === 69 || c === 101)) {
        i++;
        let es = 1, ev = 0;
        c = s.charCodeAt(i);
        if (c === 45) { es = -1; i++; } else if (c === 43) i++;
        while (i < L) { c = s.charCodeAt(i); if (c < 48 || c > 57) break; ev = ev * 10 + (c - 48); i++; }
        val *= Math.pow(10, es * ev);
      }
      while (i < L && s.charCodeAt(i) !== 44) i++;
      out[n++] = any ? sign * val : 0;
      if (i >= L) break;
      i++;
    }
    return n;
  }
  I._parseNums = parseNums;   // للفحص

  // ---------- إعادة التوزيع (نحولها لجداول أرقام مرة وحدة) ----------
  const R = {
    from: UNSET,
    ax: new Int16Array(4), inv: new Int8Array(4),
    tk: new Int8Array(2), ti: new Int16Array(2), tinv: new Int8Array(2),   // نوع الزناد: 0 زر، 1 محور −1..1، 2 محور 0..1
    bk: new Int8Array(NB), bi: new Int16Array(NB), bd: new Int8Array(NB),  // نوع الزر: 0 زر، 1 محور
    hat: -1, square: false
  };
  function resolveRemap(m) {
    R.from = m;
    for (let k = 0; k < 4; k++) { R.ax[k] = k; R.inv[k] = 0; }
    R.tk[0] = 0; R.ti[0] = 6; R.tinv[0] = 0; R.tk[1] = 0; R.ti[1] = 7; R.tinv[1] = 0;
    for (let b = 0; b < NB; b++) { R.bk[b] = 0; R.bi[b] = b; R.bd[b] = 1; }
    R.hat = -1; R.square = false;
    if (!m || typeof m !== 'object') return;
    const a = m.axes || {};
    for (let k = 0; k < 4; k++) {
      const e = a[AX[k]];
      if (typeof e === 'number') R.ax[k] = e;
      else if (e && typeof e.i === 'number') { R.ax[k] = e.i; R.inv[k] = e.inv ? 1 : 0; }
    }
    ['lt', 'rt'].forEach((n, k) => {
      const e = a[n];
      if (!e || typeof e !== 'object') return;
      if (typeof e.b === 'number') { R.tk[k] = 0; R.ti[k] = e.b; }
      else if (typeof e.i === 'number') { R.tk[k] = e.range === 'half' ? 2 : 1; R.ti[k] = e.i; R.tinv[k] = e.inv ? 1 : 0; }
    });
    const bt = m.buttons || {};
    for (let b = 0; b < NB; b++) {
      const e = bt[BTN[b]];
      if (typeof e === 'number') R.bi[b] = e;
      else if (e && typeof e.a === 'number') { R.bk[b] = 1; R.bi[b] = e.a; R.bd[b] = e.dir < 0 ? -1 : 1; }
    }
    if (typeof m.hat === 'number') R.hat = m.hat;
    R.square = m.gate === 'square';
  }
  const axv = k => { const i = R.ax[k], v = i >= 0 && i < pAx.length ? pAx[i] : 0; return R.inv[k] ? -v : v; };
  function trig(k) {
    const i = R.ti[k];
    if (R.tk[k] === 0) return i >= 0 && i < pBtn.length ? U.clamp(pBtn[i], 0, 1) : 0;
    let v = i >= 0 && i < pAx.length ? pAx[i] : (R.tk[k] === 1 ? -1 : 0);
    if (R.tinv[k]) v = -v;
    return U.clamp(R.tk[k] === 1 ? (v + 1) / 2 : v, 0, 1);
  }
  function btnHeld(b) {
    const i = R.bi[b];
    if (R.bk[b] === 1) return i >= 0 && i < pAx.length && pAx[i] * R.bd[b] > 0.5;
    return i >= 0 && i < pBtn.length && (pPr[i] === 1 || pBtn[i] > 0.5);
  }
  // POV hat: −1 = فوق، والقيم تمشي مع الساعة بخطوات 2/7؛ أكبر من 1 = مافيه ضغط
  function hatDir(v, out) {
    out.u = out.d = out.l = out.r = false;
    if (!(v >= -1.05 && v <= 1.05) || (v > -0.07 && v < 0.07)) return out;   // 0 مو قيمة hat صحيحة (بعض الأيادي ترتاح عليه)
    const k = Math.round((v + 1) * 3.5) & 7;   // 0 فوق، 1 فوق-يمين، 2 يمين ... 7 فوق-يسار
    out.u = k === 7 || k === 0 || k === 1; out.r = k >= 1 && k <= 3; out.d = k >= 3 && k <= 5; out.l = k >= 5 && k <= 7;
    return out;
  }
  const HAT = { u: false, d: false, l: false, r: false };

  // ---------- المعايرة ----------
  const C = { from: UNSET, c: new Float32Array(4), lo: new Float32Array(4), hi: new Float32Array(4) };
  function resolveCalib(m) {
    C.from = m;
    for (let k = 0; k < 4; k++) {
      C.c[k] = 0; C.lo[k] = -1; C.hi[k] = 1;
      if (!m) continue;
      const c = m.c && Number.isFinite(m.c[k]) ? U.clamp(m.c[k], -0.5, 0.5) : 0;
      const lo = m.lo && Number.isFinite(m.lo[k]) ? m.lo[k] : -1, hi = m.hi && Number.isFinite(m.hi[k]) ? m.hi[k] : 1;
      C.c[k] = c;
      C.lo[k] = lo < c - 0.3 ? lo : -1;
      C.hi[k] = hi > c + 0.3 ? hi : 1;
    }
  }
  const applyCal = (v, k) => {
    const c = C.c[k];
    const r = v >= c ? (v - c) / (C.hi[k] - c) : (v - c) / (c - C.lo[k]);
    return r > 1 ? 1 : r < -1 ? -1 : r;
  };
  const cs = { sum: new Float64Array(4), mn: new Float64Array(4), mx: new Float64Array(4) };
  function sampleCalib(v, dt) {
    const c = I.calibration;
    c.t += dt; c.n++;
    for (let k = 0; k < 4; k++) {
      cs.sum[k] += v[k];
      if (v[k] < cs.mn[k]) cs.mn[k] = v[k];
      if (v[k] > cs.mx[k]) cs.mx[k] = v[k];
    }
    if (c.kind === 'centre' ? c.t >= 1.0 : c.t >= 30) I.finishCalibration();
  }

  // ---------- تحذير انحراف العصا (stick drift) ----------
  const dw = { mn: new Float32Array(4), mx: new Float32Array(4), t: new Float32Array(4) };
  function resetDrift() {
    for (let k = 0; k < 4; k++) { dw.mn[k] = 9; dw.mx[k] = -9; dw.t[k] = 0; I.drift[AX[k]] = 0; }
    I.driftWarn = false;
  }
  function driftCheck(v, dt) {
    // العصا "مرتاحة" إذا ثابتة (تذبذب < 0.02) وقريبة من النص (< 0.12) لمدة ثانيتين
    let warn = false;
    for (let k = 0; k < 4; k++) {
      const x = v[k];
      if (x < dw.mn[k]) dw.mn[k] = x;
      if (x > dw.mx[k]) dw.mx[k] = x;
      if (dw.mx[k] - dw.mn[k] > 0.02 || x > 0.12 || x < -0.12) { dw.mn[k] = dw.mx[k] = x; dw.t[k] = 0; }
      else if ((dw.t[k] += dt) >= 2) {
        const rest = (dw.mn[k] + dw.mx[k]) / 2;
        I.drift[AX[k]] = Math.round(rest * 1000) / 1000;
        dw.mn[k] = dw.mx[k] = x; dw.t[k] = 0;
      }
      const a = Math.abs(I.drift[AX[k]]);
      if (a > 0.02 || (I.driftWarn && a > 0.015)) warn = true;   // مع تخلف بسيط عشان ما يرمش
    }
    I.driftWarn = warn;
  }

  // ---------- قراءة كل إطار ----------
  const vRaw = new Float64Array(4), vCal = new Float64Array(4);
  const tmp = { x: 0, y: 0 }, sL = { x: 0, y: 0 }, sR = { x: 0, y: 0 };
  const DJI_DEF = { thr: 0.3, yaw: 0.2, rp: 0.25 };

  const ramp = (cur, tgt, dt) => {
    const r = 3.2 * dt;
    if (tgt === 0) return Math.abs(cur) <= r * 1.6 ? 0 : cur - Math.sign(cur) * r * 1.6;
    return U.clamp(cur + U.clamp(tgt - cur, -r, r), -1, 1);
  };

  function stickPair(x, yUp, din, out) {
    if (R.square) { out.x = U.axialDz(x, din, OUTER_DZ); out.y = U.axialDz(yUp, din, OUTER_DZ); return out; }
    U.radialDz(x, yUp, din, OUTER_DZ, tmp);
    return U.circleToSquare(tmp.x, tmp.y, out);
  }
  // عصا اللمس: منطقة ميتة ثابتة (الإبهام يرجف شوي) + دائرة→مربع عشان توصل للزوايا
  const TOUCH_DZ = 0.07;
  function touchPair(v, out) {
    U.radialDz(+v.x || 0, +v.y || 0, TOUCH_DZ, OUTER_DZ, tmp);
    return U.circleToSquare(tmp.x, tmp.y, out);
  }

  // الطائرة والوضع الحالي (عشان المنحنى): من الجلسة إذا موجودة، وإلا الإعدادات و P
  function curveContext(S) {
    const ctx = I.curveCtx;
    const s = DS.app && DS.app.session, d = s && s.drone;
    ctx.airframe = (d && d.airframe) || S.airframe || 'mini';
    let m = 'P';
    if (d) {
      if (typeof d.effMode === 'function') { try { m = d.effMode(); } catch (e) { m = d.mode || 'P'; } }
      else if (d.mode) m = d.mode;
    }
    ctx.mode = m || 'P';
    return ctx;
  }
  function djiExpFor(S, mode) {
    const t = S.djiExp || {};
    return t[mode] || (mode === 'A' || mode === 'ATTI' ? t.P : null) || t.P || DJI_DEF;
  }

  I.poll = function (dt) {
    dt = dt > 0 ? (dt > 0.1 ? 0.1 : dt) : 0;
    const S = DS.settings;
    readDevice(S);
    const hasPad = dev.src !== 'keyboard';
    // عصي اللمس (الجوال): بس إذا ما فيه يد — DS.Touch يخفيها لحاله إذا فيه يد
    const TT = DS.Touch;
    let tOn = false;
    if (TT && typeof TT.poll === 'function') { try { tOn = !!TT.poll(hasPad, dt) && !hasPad; } catch (e) { tOn = false; } }
    I.touch = tOn;
    dev.age += dt;
    I.connected = hasPad;
    I.name = dev.name;
    I.source = hasPad ? dev.src : tOn ? 'touch' : 'keyboard';

    // 1) التوزيع
    const map = hasPad && S.remap ? S.remap[dev.id] : undefined;
    if (map !== R.from) resolveRemap(map);
    let lt = 0, rt = 0;
    const held = I.held;
    if (hasPad) {
      for (let k = 0; k < 4; k++) vRaw[k] = axv(k);
      lt = trig(0); rt = trig(1);
      for (let b = 0; b < NB; b++) held[BTN[b]] = btnHeld(b);
      if (R.hat >= 0 && R.hat < pAx.length) {
        hatDir(pAx[R.hat], HAT);
        if (HAT.u) held.UP = true; if (HAT.d) held.DOWN = true; if (HAT.l) held.LEFT = true; if (HAT.r) held.RIGHT = true;
      }
      // يد غير قياسية بدون توزيع: أول ثانية نتأكد إن ما فيه محور واقف على الطرف (زناد مثلاً = عصا كاملة دايم)
      I.needsRemap = dev.mapping !== 'standard' && !map;
      if (I.needsRemap) {
        if (dev.age < 1) {
          for (let k = 0; k < 4; k++) { if (Math.abs(vRaw[k]) < 0.9) suspMask &= ~(1 << k); vRaw[k] = 0; }
        } else {
          if (suspMask && !I.badAxes.length) { const bad = []; for (let k = 0; k < 4; k++) if (suspMask & (1 << k)) bad.push(AX[k]); I.badAxes = bad; }
          for (let k = 0; k < 4; k++) if (suspMask & (1 << k)) vRaw[k] = 0;
        }
      } else if (I.badAxes.length) I.badAxes = [];
    } else {
      for (let k = 0; k < 4; k++) vRaw[k] = 0;
      for (let b = 0; b < NB; b++) held[BTN[b]] = false;
      I.needsRemap = false;
      if (tOn) {   // أزرار اللمس بنفس أسماء اليد
        const th = TT.held;
        for (let b = 0; b < NB; b++) if (th[BTN[b]]) held[BTN[b]] = true;
        const tg = TT.trig > 0 ? TT.trig : 1;
        if (th.LT) lt = tg;
        if (th.RT) rt = tg;
      }
    }
    const raw = I.raw;
    raw.lx = vRaw[0]; raw.ly = vRaw[1]; raw.rx = vRaw[2]; raw.ry = vRaw[3]; raw.lt = lt; raw.rt = rt;

    // 2) المعايرة
    if (I.calibration.active) { if (I.calibration.id === dev.id && hasPad) sampleCalib(vRaw, dt); else I.calibration.active = false; }
    const cm = hasPad && S.calib ? S.calib[dev.id] : undefined;
    if (cm !== C.from) resolveCalib(cm);
    for (let k = 0; k < 4; k++) vCal[k] = hasPad ? applyCal(vRaw[k], k) : 0;
    const cal = I.cal;
    cal.lx = vCal[0]; cal.ly = vCal[1]; cal.rx = vCal[2]; cal.ry = vCal[3];
    if (hasPad && !I.calibration.active) driftCheck(vCal, dt);

    // 3) المنطقة الميتة + دائرة→مربع (y فوق = +)
    const din = U.clamp(+S.deadzone >= 0 ? +S.deadzone : 0.05, 0, 0.4);
    stickPair(vCal[0], -vCal[1], din, sL);
    stickPair(vCal[2], -vCal[3], din, sR);
    if (tOn) { touchPair(TT.L, sL); touchPair(TT.R, sR); }

    // 4) Mode 1/2/3/4
    let thr, yaw, pit, rol;
    const mode = +S.stickMode || 2;
    if (mode === 1) { pit = sL.y; yaw = sL.x; thr = sR.y; rol = sR.x; }
    else if (mode === 3) { pit = sL.y; rol = sL.x; thr = sR.y; yaw = sR.x; }
    else if (mode === 4) { thr = sL.y; rol = sL.x; pit = sR.y; yaw = sR.x; }
    else { thr = sL.y; yaw = sL.x; pit = sR.y; rol = sR.x; }

    // 5) الكيبورد: W/S ارتفاع، A/D لف، الأسهم قدام/ورا/جنب + الأزرار (Shift مع الزر = نص العصا)
    const k = I.keys, kb = I.kb, kh = (k.ShiftLeft || k.ShiftRight) ? 0.5 : 1;
    const padMag = Math.max(Math.abs(thr), Math.abs(yaw), Math.abs(pit), Math.abs(rol));
    kb.thr = ramp(kb.thr, kh * ((k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0)), dt);
    kb.yaw = ramp(kb.yaw, kh * ((k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0)), dt);
    kb.pitch = ramp(kb.pitch, kh * ((k.ArrowUp ? 1 : 0) - (k.ArrowDown ? 1 : 0)), dt);
    kb.roll = ramp(kb.roll, kh * ((k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0)), dt);
    // مين حرّك العصي آخر شي (الدروس تعرف إذا تطير بالكيبورد حتى لو فيه يد متصلة)
    const kbMag = Math.max(Math.abs(kb.thr), Math.abs(kb.yaw), Math.abs(kb.pitch), Math.abs(kb.roll));
    if ((!hasPad && !tOn) || (kbMag > 0.05 && kbMag >= padMag)) I.axisSource = 'keyboard';
    else if (padMag > 0.1) I.axisSource = hasPad ? dev.src : 'touch';
    thr = U.clamp(thr + kb.thr, -1, 1); yaw = U.clamp(yaw + kb.yaw, -1, 1);
    pit = U.clamp(pit + kb.pitch, -1, 1); rol = U.clamp(rol + kb.roll, -1, 1);
    for (let i = 0; i < KEYMAP.length; i++) if (k[KEYMAP[i][0]]) held[KEYMAP[i][1]] = true;
    // ريموت التلفزيون وقت الطيران: OK = B (ضغطة تلغي الرجوع الذكي/الرجوع، مطوّل ثانية = رجوع للبيت)
    if ((k.Enter || k.NumpadEnter || k.Kc13) && DS.app && DS.app.state === 'fly') held.B = true;
    if (k.KeyQ) lt = 1;
    if (k.KeyE) rt = 1;
    if (lt > 0.5) held.LT = true;
    if (rt > 0.5) held.RT = true;
    I.lt = lt; I.rt = rt;

    // مكان العصي للرسم (يشمل الكيبورد)
    const L = I.sticks.L, Rr = I.sticks.R;
    if (mode === 1) { L.x = yaw; L.y = pit; Rr.x = rol; Rr.y = thr; }
    else if (mode === 3) { L.x = rol; L.y = pit; Rr.x = yaw; Rr.y = thr; }
    else if (mode === 4) { L.x = rol; L.y = thr; Rr.x = yaw; Rr.y = pit; }
    else { L.x = yaw; L.y = thr; Rr.x = rol; Rr.y = pit; }
    I.atRest = thr === 0 && yaw === 0 && pit === 0 && rol === 0;

    // 6) المنحنيات
    const cc = curveContext(S), ax = I.axes;
    if (cc.airframe === 'fpv') {
      ax.thr = thr; ax.yaw = yaw; ax.pitch = pit; ax.roll = rol;   // المعدلات تنطبق بالفيزياء (settings.rates)
    } else {
      const e = djiExpFor(S, cc.mode);
      ax.thr = U.djiExp(thr, e.thr); ax.yaw = U.djiExp(yaw, e.yaw);
      ax.pitch = U.djiExp(pit, e.rp); ax.roll = U.djiExp(rol, e.rp);
    }
    const H = U.clamp(I.hover > 0 ? I.hover : DEF_HOVER, 0.05, 0.9), ft = S.fpvThrottle;
    if (ft === 'trigger' && hasPad) I.throttle01 = Math.max(DS.Throttle.trigger(rt), kb.thr > 0 ? kb.thr : 0);
    else if (ft === 'stick' && hasPad) I.throttle01 = DS.Throttle.linear(thr);
    else I.throttle01 = DS.Throttle.gp(thr, H, DS.Throttle.E);

    // 7) الضغطات الجديدة (مو المستمرة)
    let any = false;
    for (let b = 0; b < NB; b++) {
      const n = BTN[b], h = held[n];
      const p = h && !I._prev[n];
      I.pressed[n] = p; I._prev[n] = h;
      if (p) any = true;
    }
    I.anyPress = any;
    // كروم ما يشغّل الصوت من أزرار اليد لحالها: نحاول (التلفزيون يسمح) ونفك قفل المدرب إذا فيه تفاعل قبل
    if (any && hasPad && DS.Audio && typeof DS.Audio.padWake === 'function') DS.Audio.padWake();

    // 8) التنقل في القوائم بالأسهم أو العصا اليسار (مع تكرار إذا ضغطت مطوّل)
    navDir('UP', held.UP || vCal[1] < -0.6, dt);
    navDir('DOWN', held.DOWN || vCal[1] > 0.6, dt);
    navDir('LEFT', held.LEFT || vCal[0] < -0.6, dt);
    navDir('RIGHT', held.RIGHT || vCal[0] > 0.6, dt);
  };
  function navDir(n, on, dt) {
    const T = I._navT;
    I.nav[n] = false;
    if (!on) { T[n] = -1; return; }
    if (T[n] < 0) { I.nav[n] = true; T[n] = 0.4; }
    else if ((T[n] -= dt) <= 0) { I.nav[n] = true; T[n] = 0.12; }
  }

  // اللي يروح للمحاكاة كل خطوة. out اختياري (نعبّيه بدل كائن جديد)
  I.controls = function (out) {
    const o = out || {};
    const ax = I.axes;
    o.thr = ax.thr; o.yaw = ax.yaw; o.pitch = ax.pitch; o.roll = ax.roll;
    o.throttle01 = I.throttle01;
    const pr = o.press && out ? o.press : {}, hd = o.held && out ? o.held : {};
    for (let b = 0; b < NB; b++) {
      const n = BTN[b];
      if (I.pressed[n]) pr[n] = true; else if (pr[n]) delete pr[n];
      hd[n] = !!I.held[n];
    }
    o.press = pr; o.held = hd;
    o.holdA = !!I.held.A; o.lt = I.lt; o.rt = I.rt;
    return o;
  };

  // وين لازم تكون العصا عشان يطلع أمر معيّن (للعصا الشبح): axis = 'thr'|'yaw'|'pitch'|'roll'
  I.stickFor = function (axis, cmd) {
    const S = DS.settings, cc = I.curveCtx;
    if (cc.airframe === 'fpv') return U.clamp(cmd, -1, 1);
    const e = djiExpFor(S, cc.mode);
    return U.djiExpInv(cmd, axis === 'thr' ? e.thr : axis === 'yaw' ? e.yaw : e.rp);
  };

  // ---------- اهتزاز اليد ----------
  let rumUntil = 0, rumMag = 0;
  I.rumble = function (strong, weak, ms) {
    try {
      const S = DS.settings;
      if (S && S.rumble === false) return false;
      strong = U.clamp(+strong || 0, 0, 1); weak = U.clamp(+weak || 0, 0, 1); ms = U.clamp(+ms || 0, 0, 5000) | 0;
      if (ms <= 0 || (strong <= 0 && weak <= 0)) return false;
      if (typeof document !== 'undefined' && document.hidden) return false;
      const now = U.now(), mag = Math.max(strong, weak);
      if (now < rumUntil && mag < rumMag * 0.5) return false;     // اهتزاز خفيف ما يقطع قوي شغال
      let ok = false;
      if (dev.src === 'gamepad' && dev.gp) {
        const g = dev.gp, va = g.vibrationActuator;
        if (va && typeof va.playEffect === 'function') {
          const p = va.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak });
          if (p && typeof p.catch === 'function') p.catch(() => {});
          ok = true;
        } else if (g.hapticActuators && g.hapticActuators[0] && typeof g.hapticActuators[0].pulse === 'function') {
          const p = g.hapticActuators[0].pulse(mag, ms);
          if (p && typeof p.catch === 'function') p.catch(() => {});
          ok = true;
        }
      } else if (dev.src === 'native' && window.NativePad && typeof window.NativePad.rumble === 'function') {
        window.NativePad.rumble(strong, weak, ms);
        ok = true;
      } else if (I.touch && DS.Touch && typeof DS.Touch.buzz === 'function') {
        return DS.Touch.buzz(strong, weak, ms);   // الجوال يهتز (بس الأحداث المهمة)
      }
      if (ok) { rumUntil = now + ms; rumMag = mag; }
      return ok;
    } catch (e) { return false; }
  };

  // ---------- معلومات الجهاز + معايرة + توزيع (لشاشة المعالج) ----------
  I.device = function () {
    return { id: dev.id, name: dev.name, mapping: dev.mapping, axesCount: dev.nAx, buttonsCount: dev.nBtn, source: dev.src };
  };
  // kind: 'centre' (اترك العصي ثانية — يخلص لحاله) أو 'range' (دوّر العصي لين الآخر ثم finishCalibration)
  I.startCalibration = function (kind) {
    if (dev.src === 'keyboard') return false;
    const c = I.calibration;
    c.active = true; c.kind = kind === 'range' ? 'range' : 'centre'; c.t = 0; c.n = 0; c.id = dev.id; c.result = null;
    for (let k = 0; k < 4; k++) { cs.sum[k] = 0; cs.mn[k] = 9; cs.mx[k] = -9; }
    return true;
  };
  const CAL_MSG = {
    ok: 'تمت المعايرة ✓',
    moved: 'العصا تحركت — اترك العصي بالنص وحاول مرة ثانية',
    offcentre: 'فيه محور بعيد عن النص كثير — جرّب تعيد توزيع الأزرار',
    norange: 'ما وصلت العصي للآخر — دوّرها دوائر كاملة وحاول مرة ثانية',
    nodata: 'ما وصلت قراءات من اليد'
  };
  I.finishCalibration = function () {
    const c = I.calibration;
    if (!c.active) return c.result;
    c.active = false;
    const fail = r => (c.result = { ok: false, reason: r, msg: CAL_MSG[r], kind: c.kind });
    if (c.id !== dev.id || c.n < 5) return fail('nodata');
    const S = DS.settings;
    if (!S.calib || typeof S.calib !== 'object') S.calib = {};
    const prev = S.calib[c.id] || {};
    const r4 = v => Math.round(v * 10000) / 10000;
    let entry, noise = 0;
    if (c.kind === 'centre') {
      const cen = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) { cen[k] = r4(cs.sum[k] / c.n); noise = Math.max(noise, cs.mx[k] - cs.mn[k]); }
      if (noise > 0.08) return fail('moved');
      if (Math.max(Math.abs(cen[0]), Math.abs(cen[1]), Math.abs(cen[2]), Math.abs(cen[3])) > 0.35) return fail('offcentre');
      entry = { c: cen, lo: Array.isArray(prev.lo) ? prev.lo : [-1, -1, -1, -1], hi: Array.isArray(prev.hi) ? prev.hi : [1, 1, 1, 1] };
    } else {
      const lo = [-1, -1, -1, -1], hi = [1, 1, 1, 1];
      let got = 0;
      for (let k = 0; k < 4; k++) {
        if (cs.mn[k] < -0.5) { lo[k] = r4(Math.max(-1.5, cs.mn[k])); got++; }
        if (cs.mx[k] > 0.5) { hi[k] = r4(Math.min(1.5, cs.mx[k])); got++; }
      }
      if (got < 4) return fail('norange');
      entry = { c: Array.isArray(prev.c) ? prev.c : [0, 0, 0, 0], lo, hi };
    }
    S.calib[c.id] = entry;
    if (DS.saveSettings) DS.saveSettings();
    C.from = UNSET; resetDrift();
    const e = entry.c;
    return (c.result = { ok: true, reason: 'ok', msg: CAL_MSG.ok, kind: c.kind, centre: { lx: e[0], ly: e[1], rx: e[2], ry: e[3] }, noise: r4(noise) });
  };
  I.cancelCalibration = function () { I.calibration.active = false; };
  I.resetCalibration = function (id) {
    id = id || dev.id;
    const S = DS.settings;
    if (!id || !S.calib || !S.calib[id]) return false;
    delete S.calib[id];
    if (DS.saveSettings) DS.saveSettings();
    C.from = UNSET; resetDrift();
    return true;
  };

  // map = null يمسح التوزيع. تغيير التوزيع يمسح المعايرة (المحاور تغيرت)
  I.setRemap = function (map, id) {
    id = id || dev.id;
    if (!id) return false;
    const S = DS.settings;
    if (!S.remap || typeof S.remap !== 'object') S.remap = {};
    if (map && typeof map === 'object') S.remap[id] = map; else delete S.remap[id];
    if (S.calib && S.calib[id]) delete S.calib[id];
    if (DS.saveSettings) DS.saveSettings();
    R.from = UNSET; C.from = UNSET;
    suspMask = 0; I.badAxes = []; resetDrift();
    return true;
  };
  I.resetRemap = function (id) { return I.setRemap(null, id); };
  I.getRemap = function (id) { const S = DS.settings; id = id || dev.id; return (S.remap && S.remap[id]) || null; };
  // توزيع W3C القياسي كامل (نقطة بداية للمعالج)
  I.defaultRemap = function () {
    const axes = {}, buttons = {};
    for (let k = 0; k < 4; k++) axes[AX[k]] = { i: k, inv: false };
    axes.lt = { b: 6 }; axes.rt = { b: 7 };
    for (let b = 0; b < NB; b++) buttons[BTN[b]] = b;
    return { axes, buttons, hat: -1, gate: 'round' };
  };
  // نسخة من القيم الخام الحين (المعالج ياخذها قبل ما يطلب "حرّك العصا...")
  I.snapshot = function () { return { axes: pAx.slice(), buttons: pBtn.slice() }; };
  // وش اللي تحرك من وقت snapshot؟ → {kind:'axis', i, dir, from, to} أو {kind:'button', i} أو null
  I.findMoved = function (snap, thr) {
    thr = thr > 0 ? thr : 0.5;
    if (!snap) return null;
    let best = null, bd = thr;
    for (let i = 0; i < pAx.length; i++) {
      const from = snap.axes && Number.isFinite(snap.axes[i]) ? snap.axes[i] : 0, d = pAx[i] - from;
      if (Math.abs(d) >= bd) { bd = Math.abs(d); best = { kind: 'axis', i, dir: d > 0 ? 1 : -1, from, to: pAx[i] }; }
    }
    if (best) return best;
    for (let i = 0; i < pBtn.length; i++) {
      const from = snap.buttons && Number.isFinite(snap.buttons[i]) ? snap.buttons[i] : 0;
      if (pBtn[i] - from >= thr) return { kind: 'button', i };
    }
    return null;
  };
  I.BUTTONS = BTN;
})();
