// عصي وأزرار اللمس للجوال والتابلت (المصدر 'touch' في DS.Input)
//
// - تطلع وقت الطيران بس، على جهاز لمس (أو settings.touch = 'on')، وما فيه يد تحكم متصلة.
//   ما تطلع أبد في تطبيق التلفزيون (window.NativePad أو ?platform=tv).
// - العصا اليسار تحت يسار، واليمين تحت يمين. تلمس قريب من الدائرة = العصا من مكانها، تلمس بعيد = الدائرة تنتقل
//   تحت إبهامك (عايمة). تفكها = ترجع للنص (Mini: النص = يثبت الارتفاع • FPV: نفس ثروتل «النص = تحويم»).
// - الأزرار بنفس أسماء يد التحكم: A مطوّل = إقلاع/هبوط، B مطوّل = رجوع للبيت (ضغطة = إلغاء)، X = وقوف،
//   Y = الكاميرا (مطوّل = حراري)، LB = الشاشة الصغيرة، RB = تصوير، LT/RT = الكاميرا تحت/فوق، ▲▼ = الوضع،
//   ◀ = ATTI، ▶ = بلاغ، 📊 = VIEW، ☰ = إيقاف. كل شي يمشي من DS.Input مثل اليد بالضبط (الدروس والمدرب والعصا الشبح).
// - DS.Touch.poll(hasPad, dt) يناديه DS.Input.poll كل فريم ويرجّع true إذا اللمس شغال الحين.
// ملاحظة: هذا الملف ما يلمس document وقت التحميل (يشتغل بدون شاشة في الفحص الذاتي).
(function () {
  'use strict';
  const DS = window.DS, U = DS.U;
  const BTNS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'START', 'UP', 'DOWN', 'LEFT', 'RIGHT'];
  const HINT_DIR = { up: { x: 0, y: 1 }, down: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, center: { x: 0, y: 0 } };
  const HAS_DOC = typeof document !== 'undefined' && typeof document.createElement === 'function' && !!document.documentElement;
  const PLATFORM_TV = typeof location !== 'undefined' && /[?&]platform=tv(&|$)/.test(String(location.search || ''));
  const TRIG = 0.7;   // الزناد من زر اللمس = 70% (الكاميرا 70°/ث — أسهل تضبطها)
  const KNOB = 0.78;  // كم تتحرك الدائرة الصغيرة من نص القاعدة (نسبة من نصف القطر)

  const T = DS.Touch = {
    L: { x: 0, y: 0 }, R: { x: 0, y: 0 },   // مكان العصي (−1..1، فوق = +) قبل المنطقة الميتة
    held: {},                               // الأزرار بأسماء يد التحكم
    trig: TRIG,
    on: false,       // الأزرار ظاهرة الحين (طيران + لمس + بدون يد)
    seen: false,     // شفنا لمس حقيقي (pointerType 'touch') في هالجلسة
    used: false,     // استخدم اللمس للطيران
    dev: false,      // جهاز لمس (body.touchdev)
    phone: false,    // جوال (أصغر ضلع ≤ 600) — body.phone
    fsTried: null    // آخر جلسة طلبنا فيها ملء الشاشة
  };
  for (const b of BTNS) T.held[b] = false;

  // ---------- الجهاز ----------
  const mm = q => { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } };
  T.isTvApp = () => !!window.NativePad || PLATFORM_TV;
  let coarse = null;   // (pointer: coarse) — نحسبها مرة وعند تغيير المقاس (مو كل فريم)
  T.coarse = () => (coarse === null ? (coarse = mm('(pointer: coarse)')) : coarse);
  T.standalone = () => mm('(display-mode: fullscreen)') || mm('(display-mode: standalone)') || window.navigator.standalone === true;
  // تطلع؟ (قبل شرط الطيران واليد)
  T.available = function () {
    const S = DS.settings || {}, m = S.touch || 'auto';
    if (m === 'off' || T.isTvApp() || !HAS_DOC) return false;
    if (m === 'on') return true;
    return T.dev || T.coarse() || T.seen;
  };
  function devClasses() {
    if (!HAS_DOC || !document.body) return;
    const b = document.body, tv = T.isTvApp();
    coarse = mm('(pointer: coarse)');
    T.dev = !tv && (T.coarse() || T.seen || b.classList.contains('touchdev'));
    const w = window.innerWidth || 0, h = window.innerHeight || 0;
    T.phone = T.dev && Math.min(w, h) <= 600;
    b.classList.toggle('touchdev', T.dev);
    b.classList.toggle('phone', T.phone);
  }
  T.refreshDevice = devClasses;

  // اهتزاز الجوال (navigator.vibrate — آيفون ما يدعمه)
  let vibUntil = 0;
  T.vibrate = function (ms, force) {
    try {
      const S = DS.settings || {};
      if (S.rumble === false || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
      const ua = navigator.userActivation;
      if (ua && !ua.hasBeenActive) return false;   // كروم يرفض الاهتزاز قبل أول لمسة كاملة
      const now = U.now();
      if (!force && now < vibUntil) return false;
      ms = U.clamp(Math.round(+ms || 0), 5, 600);
      vibUntil = now + ms + 120;
      return !!navigator.vibrate(ms);
    } catch (e) { return false; }
  };
  // اهتزاز من أحداث الطيران (DS.Input.rumble لما ما فيه يد): بس القوي والمهم، مو كل هبة ريح
  let buzzAt = 0;
  T.buzz = function (strong, weak, ms) {
    if (!(strong >= 0.5 || weak >= 0.3)) return false;
    const now = U.now(), mag = Math.max(strong, weak);
    if (now - buzzAt < 600 && mag < 0.9) return false;
    buzzAt = now;
    return T.vibrate(U.clamp(ms * (0.4 + 0.6 * mag), 15, 400), mag >= 0.9);
  };

  // ---------- العناصر ----------
  let root = null, built = false, dirty = true, vw = 0, vh = 0, insL = 0, insR = 0, insT = 0, insB = 0, probe = null;
  const mkStick = side => ({ side, pid: -1, cx: 0, cy: 0, ax: 0, ay: 0, r: 64, zone: null, base: null, knob: null, ghost: null, cap: null,
    kx: 1e9, ky: 1e9, bx: 1e9, by: 1e9, gx: 1e9, gy: 1e9, gOn: false, gNear: false, lockCls: '', capTxt: '' });
  const SL = mkStick('L'), SR = mkStick('R');
  const BEL = {}, BPID = {};
  // [الاسم، الحرف/الرمز، الكلمة تحته، المجموعة]
  const BDEF = [
    ['START', '☰', 'إيقاف', 'sys'], ['VIEW', '📊', 'قياسات', 'sys'],
    ['LT', 'LT', 'كاميرا⬇', 'sh'], ['LB', 'LB', 'شاشة', 'sh'], ['RB', 'RB', 'صورة', 'sh'], ['RT', 'RT', 'كاميرا⬆', 'sh'],
    ['UP', '▲', 'الوضع', 'dp'], ['DOWN', '▼', 'الوضع', 'dp'], ['LEFT', '◀', 'ATTI', 'dp'], ['RIGHT', '▶', 'بلاغ', 'dp'],
    ['Y', 'Y', 'كاميرا', 'face'], ['X', 'X', 'وقوف', 'face'], ['B', 'B', 'رجوع', 'face'], ['A', 'A', 'إقلاع', 'face']
  ];

  function build() {
    if (built || !HAS_DOC || !document.body) return;
    built = true;
    root = document.createElement('div');
    root.id = 'touchUI';
    let h = '<div class="tz tzL"></div><div class="tz tzR"></div>';
    for (const s of ['L', 'R']) h += '<div class="tst tst' + s + '"><div class="tbase"><i class="tlock"></i></div><div class="tghost"></div><div class="tknob"></div><div class="tcap"></div></div>';
    for (const d of BDEF) h += '<div class="tb tb-' + d[3] + ' b-' + d[0] + '" data-b="' + d[0] + '"><b>' + d[1] + '</b><small>' + d[2] + '</small></div>';
    root.innerHTML = h;
    document.body.appendChild(root);
    SL.zone = root.querySelector('.tzL'); SR.zone = root.querySelector('.tzR');
    for (const s of [SL, SR]) {
      const w = root.querySelector('.tst' + s.side);
      s.wrap = w; s.base = w.querySelector('.tbase'); s.knob = w.querySelector('.tknob'); s.ghost = w.querySelector('.tghost'); s.cap = w.querySelector('.tcap'); s.lock = w.querySelector('.tlock');
      bindZone(s);
    }
    root.querySelectorAll('.tb').forEach(el => { BEL[el.dataset.b] = el; BPID[el.dataset.b] = -1; bindBtn(el, el.dataset.b); });
    root.addEventListener('contextmenu', e => e.preventDefault());
    // الهوامش الآمنة (النوتش) نقراها من عنصر مخفي
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
  }

  function readInsets() {
    insL = insR = insT = insB = 0;
    if (!probe || !window.getComputedStyle) return;
    try {
      const cs = window.getComputedStyle(probe);
      insT = parseFloat(cs.paddingTop) || 0; insR = parseFloat(cs.paddingRight) || 0; insB = parseFloat(cs.paddingBottom) || 0; insL = parseFloat(cs.paddingLeft) || 0;
    } catch (e) { /* */ }
  }

  // أماكن العصي والأزرار حسب حجم الشاشة (عند التغيير بس)
  function place(el, x, y, w, h) { const st = el.style; st.left = Math.round(x - w / 2) + 'px'; st.top = Math.round(y - h / 2) + 'px'; st.width = Math.round(w) + 'px'; st.height = Math.round(h) + 'px'; }
  function layout() {
    dirty = false;
    vw = window.innerWidth || 800; vh = window.innerHeight || 400;
    readInsets();
    const m = Math.min(vw, vh);
    const R = Math.round(U.clamp(m * 0.19, 52, 86)), B = Math.round(U.clamp(m * 0.112, 38, 54)), g = Math.round(B * 0.14);
    const st = root.style;
    st.setProperty('--tbs', B + 'px');
    // العصاتين تحت بالزوايا
    const y = vh - insB - 10 - R;
    SL.ax = insL + 14 + R; SR.ax = vw - insR - 14 - R; SL.ay = SR.ay = y;
    for (const s of [SL, SR]) {
      s.r = R;
      const d = 2 * R;
      s.base.style.width = s.base.style.height = d + 'px'; s.base.style.margin = (-R) + 'px 0 0 ' + (-R) + 'px';
      const k = Math.round(R * 0.84);
      s.knob.style.width = s.knob.style.height = k + 'px'; s.knob.style.margin = (-k / 2) + 'px 0 0 ' + (-k / 2) + 'px';
      const gk = Math.round(R * 0.62);
      s.ghost.style.width = s.ghost.style.height = gk + 'px'; s.ghost.style.margin = (-gk / 2) + 'px 0 0 ' + (-gk / 2) + 'px';
      s.cap.style.width = (d + 40) + 'px'; s.cap.style.marginLeft = (-(d + 40) / 2) + 'px'; s.cap.style.marginTop = (-R - 17) + 'px';
      if (s.pid === -1) { s.cx = s.ax; s.cy = s.ay; }
      s.bx = s.kx = s.gx = 1e9;   // نعيد الرسم
    }
    // مناطق اللمس: كل نص من تحت (نخلي فوق والنص فاضي)
    const zt = Math.round(vh * 0.26), half = vw / 2 - Math.max(40, B);
    place(SL.zone, half / 2, (zt + vh) / 2, half, vh - zt);
    place(SR.zone, vw - half / 2, (zt + vh) / 2, half, vh - zt);
    // أسهم اليد (يمين العصا اليسار) وأزرار A B X Y (يسار العصا اليمين): شكل معيّن
    const off = R + 10 + B * 1.5 + g;
    diamond(SL.ax + off, y, B, g, 'UP', 'DOWN', 'LEFT', 'RIGHT');
    diamond(SR.ax - off, y, B, g, 'Y', 'A', 'X', 'B');
    // الأكتاف فوق العصي: LT LB يسار • RB RT يمين
    const sy = y - R - 24 - B * 0.4, sw = B * 1.25, sh = B * 0.8;
    place(BEL.LT, SL.ax - sw / 2 - g / 2, sy, sw, sh); place(BEL.LB, SL.ax + sw / 2 + g / 2, sy, sw, sh);
    place(BEL.RB, SR.ax - sw / 2 - g / 2, sy, sw, sh); place(BEL.RT, SR.ax + sw / 2 + g / 2, sy, sw, sh);
    // ☰ و 📊 فوق يسار (شريط DJI ينزاح يمين بالـ CSS)
    const tb = Math.round(B * 0.86), ty = insT + 4 + tb / 2;
    place(BEL.START, insL + 8 + tb / 2, ty, tb * 1.15, tb); place(BEL.VIEW, insL + 8 + tb * 1.15 + g + tb / 2, ty, tb, tb);
    const ds = document.documentElement.style;
    ds.setProperty('--tbx', Math.round(insL + 16 + tb * 2.15 + g) + 'px');   // عرض زر الإيقاف (شريط DJI ينزاح بعده)
    ds.setProperty('--tsy', Math.round(vh - (y - R - 24 - B * 0.8)) + 'px'); // ارتفاع منطقة العصي من تحت
    const dpR = SL.ax + off + B + g + B / 2, fcL = SR.ax - off - B - g - B / 2;
    ds.setProperty('--tcw', Math.max(150, Math.round(fcL - dpR - 14)) + 'px');   // العرض الفاضي تحت بالنص (المدرب)
    caps(true);
  }
  function diamond(cx, cy, B, g, up, down, left, right) {
    const d = B + g;
    place(BEL[up], cx, cy - d, B, B); place(BEL[down], cx, cy + d, B, B);
    place(BEL[left], cx - d, cy, B, B); place(BEL[right], cx + d, cy, B, B);
  }
  // اسم كل عصا (Mode 1/2)
  let capMode = 0;
  function caps(force) {
    const S = DS.settings || {}, m1 = +S.stickMode === 1;
    if (!force && capMode === (m1 ? 1 : 2)) return;
    capMode = m1 ? 1 : 2;
    SL.cap.textContent = m1 ? '↕ قدام/ورا • ↔ لف' : '↕ ارتفاع • ↔ لف';
    SR.cap.textContent = m1 ? '↕ ارتفاع • ↔ جنب' : '↕ قدام/ورا • ↔ جنب';
  }

  // ---------- اللمس ----------
  function grab(s, x, y) {
    const r = s.r, dx = x - s.ax, dy = y - s.ay;
    if (dx * dx + dy * dy <= r * r * 1.3) { s.cx = s.ax; s.cy = s.ay; }   // قريب من الدائرة: العصا من مكانها
    else { s.cx = U.clamp(x, r + 4, vw - r - 4); s.cy = U.clamp(y, r + 4, vh - r - 4); }   // بعيد: الدائرة تجي تحت إبهامك
    s.wrap.classList.add('act');
  }
  function drag(s, x, y) {
    const v = s.side === 'L' ? T.L : T.R;
    let ux = (x - s.cx) / s.r, uy = (s.cy - y) / s.r;
    const m = ux * ux + uy * uy;
    if (m > 1) { const k = 1 / Math.sqrt(m); ux *= k; uy *= k; }
    v.x = ux; v.y = uy;
  }
  function release(s) {
    s.pid = -1;
    const v = s.side === 'L' ? T.L : T.R;
    v.x = 0; v.y = 0;
    s.cx = s.ax; s.cy = s.ay;
    if (s.wrap) s.wrap.classList.remove('act');
  }
  function bindZone(s) {
    const z = s.zone;
    z.addEventListener('pointerdown', e => {
      if (s.pid !== -1 || !T.on) return;
      e.preventDefault();
      s.pid = e.pointerId;
      try { z.setPointerCapture(e.pointerId); } catch (x) { /* */ }
      if (e.pointerType === 'touch') T.seen = true;
      T.used = true;
      grab(s, e.clientX, e.clientY); drag(s, e.clientX, e.clientY);
    }, { passive: false });
    z.addEventListener('pointermove', e => { if (e.pointerId === s.pid) drag(s, e.clientX, e.clientY); });
    const end = e => { if (e.pointerId !== s.pid) return; release(s); fsTry(); };
    z.addEventListener('pointerup', end); z.addEventListener('pointercancel', end); z.addEventListener('lostpointercapture', end);
  }
  function bindBtn(el, b) {
    el.addEventListener('pointerdown', e => {
      if (!T.on) return;
      e.preventDefault();
      if (BPID[b] !== -1) return;
      BPID[b] = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* */ }
      if (e.pointerType === 'touch') T.seen = true;
      T.held[b] = true; el.classList.add('on');
      T.vibrate(b === 'START' ? 18 : 10, true);
    }, { passive: false });
    const end = e => {
      if (e.pointerId !== BPID[b]) return;
      BPID[b] = -1; T.held[b] = false; el.classList.remove('on');
      if (b !== 'START') fsTry();
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  }
  function releaseAll() {
    release(SL); release(SR);
    for (const b of BTNS) { T.held[b] = false; if (BEL[b]) { BEL[b].classList.remove('on'); BPID[b] = -1; } }
  }
  T.releaseAll = releaseAll;

  // ملء الشاشة أول لمسة بالطيران (إذا المتصفح يسمح؛ آيفون ما يدعمه للصفحات) + نقفل الشاشة بالعرض
  function fsTry() {
    try {
      const A = DS.app, s = A && A.session;
      if (!s || T.fsTried === s || T.standalone()) return;
      T.fsTried = s;
      const d = document, el = d.documentElement;
      if (d.fullscreenElement || d.webkitFullscreenElement) return;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req || !(d.fullscreenEnabled || d.webkitFullscreenEnabled)) return;
      const p = req.call(el, { navigationUI: 'hide' });
      const lock = () => { try { const o = screen.orientation; if (o && typeof o.lock === 'function') { const q = o.lock('landscape'); if (q && q.catch) q.catch(() => {}); } } catch (e) { /* */ } };
      if (p && typeof p.then === 'function') p.then(lock, () => {}); else lock();
    } catch (e) { /* */ }
  }

  // ---------- كل فريم ----------
  function show(on) {
    if (on === T.on) return;
    T.on = on;
    if (!on) releaseAll();
    if (root) root.classList.toggle('on', on);
    if (on) { dirty = true; }
  }
  // ترتيب شاشة الطيران للمس يبقى وقت الإيقاف بعد (عشان ما تتنطط العناصر ورا القائمة):
  // body.touchbar = زر ☰ فوق يسار (الشريط ينزاح) • body.touchui = العصي والأزرار كاملة (مو وقت عرض المدرب)
  let lay = 0;
  function setLayout(v) {
    if (v === lay || !HAS_DOC || !document.body) return;
    lay = v;
    const c = document.body.classList;
    c.toggle('touchbar', v > 0); c.toggle('touchui', v > 1);
  }
  const NOLOCK = { thr: false, yaw: false, pitch: false, roll: false };
  const HL = { x: 0, y: 0 }, HR = { x: 0, y: 0 };
  function hintOf(h) { return typeof h === 'string' ? HINT_DIR[h] || null : (h && typeof h === 'object' ? h : null); }
  function drawStick(s, v, hint, lockX, lockY) {
    // القاعدة (تتحرك إذا العصا عايمة)
    if (s.bx !== s.cx || s.by !== s.cy) {
      s.bx = s.cx; s.by = s.cy;
      s.wrap.style.transform = 'translate3d(' + Math.round(s.cx) + 'px,' + Math.round(s.cy) + 'px,0)';
    }
    const tr = s.r * KNOB;
    const kx = Math.round(v.x * tr), ky = Math.round(-v.y * tr);
    if (kx !== s.kx || ky !== s.ky) { s.kx = kx; s.ky = ky; s.knob.style.transform = 'translate3d(' + kx + 'px,' + ky + 'px,0)'; }
    // العصا الشبح (وين لازم تكون)
    const hx = hint ? U.clamp(+hint.x || 0, -1, 1) : 0, hy = hint ? U.clamp(+hint.y || 0, -1, 1) : 0;
    const gOn = !!hint;
    if (gOn !== s.gOn) { s.gOn = gOn; s.ghost.classList.toggle('on', gOn); }
    if (gOn) {
      const gx = Math.round(hx * tr), gy = Math.round(-hy * tr);
      if (gx !== s.gx || gy !== s.gy) { s.gx = gx; s.gy = gy; s.ghost.style.transform = 'translate3d(' + gx + 'px,' + gy + 'px,0)'; }
      const dx = hx - v.x, dy = hy - v.y, near = dx * dx + dy * dy < 0.0225;
      if (near !== s.gNear) { s.gNear = near; s.ghost.classList.toggle('near', near); }
    }
    const lc = lockX && lockY ? 'lxy' : lockX ? 'lx' : lockY ? 'ly' : '';
    if (lc !== s.lockCls) { s.lockCls = lc; s.lock.className = 'tlock ' + lc; }
  }
  function draw() {
    const A = DS.app, s = A && A.session;
    if (!s) return;
    const S = DS.settings || {}, m1 = +S.stickMode === 1;
    caps(false);
    const h = s.stickHint;
    let hL = h ? hintOf(h.L) : null, hR = h ? hintOf(h.R) : null;
    if (m1 && h && !h.physical && (hL || hR)) {   // الدروس تكتب الظل على Mode 2: في Mode 1 نبدّل المحور الطولي (مثل HUD)
      const lx = hL ? +hL.x || 0 : 0, ly = hL ? +hL.y || 0 : 0, rx = hR ? +hR.x || 0 : 0, ry = hR ? +hR.y || 0 : 0;
      HL.x = lx; HL.y = ry; HR.x = rx; HR.y = ly;
      const both = !!(hL && hR);
      hL = both || lx || ry ? HL : null; hR = both || rx || ly ? HR : null;
    }
    const L = s.axisLock || NOLOCK;
    drawStick(SL, T.L, hL, !!L.yaw, !!(m1 ? L.pitch : L.thr));
    drawStick(SR, T.R, hR, !!L.roll, !!(m1 ? L.thr : L.pitch));
  }

  // يناديه DS.Input.poll: hasPad = فيه يد متصلة → نخفي اللمس. يرجّع true إذا اللمس شغال
  T.poll = function (hasPad) {
    if (!HAS_DOC) return false;
    const A = DS.app, s = A && A.session;
    const flying = !!(A && A.state === 'fly' && s);
    const avail = !hasPad && !!s && T.available();
    const want = flying && avail;
    if (want && !built) build();
    if (!root) return false;
    show(want);
    const demo = !!A.demo;
    setLayout(avail && (flying || A.state === 'pause') ? (demo ? 1 : 2) : 0);
    if (!want) return false;
    if (demo !== root.classList.contains('demo')) { root.classList.toggle('demo', demo); if (demo) releaseAll(); }
    if (dirty || (window.innerWidth || 0) !== vw || (window.innerHeight || 0) !== vh) layout();
    draw();
    return true;
  };

  // ---------- عام: نعرف إذا الجهاز لمس + نمنع الزوم بالقرصة (آيفون) ----------
  if (HAS_DOC && typeof window.addEventListener === 'function') {
    window.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' && !T.seen && !T.isTvApp()) { T.seen = true; devClasses(); }
    }, { capture: true, passive: true });
    window.addEventListener('resize', () => { dirty = true; devClasses(); });
    window.addEventListener('orientationchange', () => { dirty = true; });
    document.addEventListener('gesturestart', e => { if (T.dev) e.preventDefault(); });   // سفاري: القرصة ما تكبّر الصفحة
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', devClasses); else devClasses();
  }
})();
