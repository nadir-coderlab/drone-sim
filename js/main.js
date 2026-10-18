// تشغيل التطبيق: الحلقة الرئيسية (خطوة ثابتة 1/120 + تنعيم الرسم بين الخطوات) والتنقل بين القوائم والطيران + جسر التلفزيون
(function () {
  const DS = window.DS, U = DS.U, UI = DS.UI, HUD = DS.HUD, I = DS.Input;
  const H = DS.STEP || 1 / 120, MAXN = 24;
  const app = DS.app = {
    state: 'menu', session: null, demo: false, R: null, no3d: false, autopilot: null, lastDef: null,
    acc: 0, alpha: 1, endT: 0, esc: false, decKey: null, native: null, rErr: false,
    ready: false,      // true بعد ما يخلص init (فحص الصحة حق التلفزيون يعتمد عليه)
    padLost: false,    // اليد انفصلت وقت الطيران (يطلع تنبيه بشاشة الإيقاف)
    bGuard: false      // B (أو OK بالريموت) ماسكها من القائمة: نتجاهلها لين تفكها
  };
  const isFn = f => typeof f === 'function';
  const tryf = (f, d) => { try { return f(); } catch (e) { console.warn(e); return d; } };

  // أوامر اليد: كائنات نعيد استخدامها (بدون تخصيص ذاكرة كل خطوة)
  const CTL = { thr: 0, yaw: 0, pitch: 0, roll: 0, throttle01: 0, press: {}, held: {}, holdA: false, lt: 0, rt: 0 };
  const CTL2 = { thr: 0, yaw: 0, pitch: 0, roll: 0, throttle01: 0, press: Object.freeze({}), held: CTL.held, holdA: false, lt: 0, rt: 0 };
  const PEND = {};   // ضغطات فريم ما صار فيه ولا خطوة (شاشات 144 هرتز) — تنتقل للفريم الجاي
  const NOHELD = {};

  // ---------------- بدء الطيران ----------------
  app.start = function (def, demo) {
    if (!def) { HUD.toast('هذا الجزء لسا ما جهز — ارجع له بعدين', 'bad'); return false; }
    if (app.no3d) { HUD.toast('الرسم ثلاثي الأبعاد ما اشتغل. شيك على النت وحدّث الصفحة', 'bad'); return false; }
    UI.hide(); HUD.reset();
    if (app.R) app.R.clearAll();
    app.lastDef = def; app.demo = !!demo; app.endT = 0; app.acc = 0; app.alpha = 1; app.decKey = null; app.padLost = false; app.bGuard = !app.demo;
    for (const k in PEND) PEND[k] = false;
    let s;
    try {
      s = new DS.Session(def, { R: app.R || DS.NullR, demo: app.demo, onMsg: (t, k) => HUD.toast(t, k) });
      s.start();
    } catch (e) {
      console.error(e);
      app.session = null; app.state = 'menu'; HUD.show(false);
      if (app.R) app.R.clearAll();
      UI.show.apply(UI, app.backFor(def));
      HUD.toast('ما قدرنا نشغل هذا: ' + (e && e.message || e), 'bad');
      return false;
    }
    app.session = s;
    // لو A ماسكها من القائمة لا تقلع لحالها
    if (!app.demo && I.held && I.held.A && 'aNeedRelease' in s) s.aNeedRelease = true;
    app.autopilot = app.demo ? new DS.Autopilot(false) : null;
    app.state = 'fly'; HUD.show(true);
    if (app.demo) HUD.big(def.kind === 'course' ? '🎬 المدرب يطير — شوف حركة العصي تحت' : '🎬 عرض — شوف حركة العصي تحت', '');
    return true;
  };
  // تعريف جديد لنفس الدرس (الكورس عنده نسخة خاصة للعرض)
  app.freshDef = function (def, demo) {
    if (!def) return def;
    if (def.kind === 'course' && isFn(DS.courseDef)) return tryf(() => DS.courseDef(def.lessonId || def.id, demo ? { demo: true } : undefined), null) || def;
    if (def.kind === 'pro' && isFn(DS.proDef)) return tryf(() => DS.proDef(def.exId || def.id), null) || def;
    return def;
  };
  app.courseDef = function (id, demo) {
    if (!isFn(DS.courseDef)) return null;
    return (demo ? tryf(() => DS.courseDef(id, { demo: true }), null) : null) || tryf(() => DS.courseDef(id), null);
  };
  app.startCourse = function (id, demo) {
    if (!isFn(DS.courseDef)) { HUD.toast('الكورس لسا ما جهز', 'bad'); return false; }
    return app.start(app.courseDef(id, demo), demo);
  };
  app.startPro = function (id, demo) {
    if (!isFn(DS.proDef)) { HUD.toast('التدريب الاحترافي لسا ما جهز', 'bad'); return false; }
    return app.start(tryf(() => DS.proDef(id), null), demo);
  };
  // الطيران الحر: من content_pro.js، وإذا ما جهز نسوي واحد بسيط
  const FREE_WIND = { calm: { s: 0, g: 0 }, light: { s: 3, g: 0.8 }, strong: { s: 8, g: 2.5 } };
  const ZONE_AR = { field: 'ساحة التدريب', city: 'المدينة', race: 'حلبة FPV', desert: 'الصحراء' };
  app.freeDef = function (o) {
    o = Object.assign({ airframe: 'mini', zone: 'field', timeOfDay: 'day', wind: 'light' }, o || {});
    if (isFn(DS.freeDef)) { const d = tryf(() => DS.freeDef(o), null); if (d) return d; }
    const fpv = o.airframe === 'fpv', z = DS.World && DS.World.zones && DS.World.zones[o.zone];
    const sp = z && z.spawn ? z.spawn : null;
    return {
      kind: 'free', id: 'free', key: 'free:' + o.airframe + ':' + o.zone + ':' + o.timeOfDay + ':' + o.wind, title: 'طيران حر', icon: '🕊️',
      sub: (fpv ? 'FPV' : 'DJI Mini') + ' • ' + (ZONE_AR[o.zone] || o.zone), airframe: fpv ? 'fpv' : 'mini',
      wind: FREE_WIND[o.wind] || FREE_WIND.light, fence: false, maxAlt: 120, timeOfDay: o.timeOfDay, zone: o.zone, thermal: true,
      spawn: sp ? { x: sp.x, z: sp.z, yaw: sp.yaw || 0, pilot: sp.pilot } : undefined, tasks: []
    };
  };
  app.startFree = function (o) { return app.start(app.freeDef(o), false); };

  // الإيقاف: بس وقت الطيران. إذا الرحلة خلصت (طاح/خلص) نخلي شاشة النتيجة تطلع بوقتها بدل ما نعلق
  app.pause = function () {
    const s = app.session;
    if (app.state !== 'fly' || !s || s.ended) return false;
    app.state = 'pause'; DS.Audio.motor(false, 0, 0); UI.show('pause');
    return true;
  };
  app.resume = function () {
    const s = app.session;
    if (!s) { app.quit(); return; }
    if (s.ended) { app.showResult(); return; }   // ما نرجع لطيران خلص (كانت تعلق اللعبة)
    UI.hide(); app.decKey = null; app.padLost = false;
    app.state = 'fly';
    if (!app.demo) {
      if (I.held && I.held.A && 'aNeedRelease' in s) s.aNeedRelease = true;
      app.bGuard = true;   // B اللي سكّرت فيه الإيقاف (أو OK بالريموت) ما يشغّل/يلغي الرجوع للبيت
    }
  };
  app.restart = function (demo) { if (app.lastDef) app.start(app.freshDef(app.lastDef, demo), demo); };
  app.quit = function (screen, arg) {
    const s = app.session;
    // الطيران الحر ما يخلص لحاله: نحسب وقت الطيران هنا
    if (s && !s.ended && !s.demo && DS.progress && s.flightTime > 0) { DS.progress.flightTime = (DS.progress.flightTime || 0) + s.flightTime; DS.saveProgress(); }
    app.session = null; app.state = 'menu'; HUD.show(false); DS.Audio.motor(false, 0, 0); clearToasts();
    if (DS.Voice && DS.Voice.stop) DS.Voice.stop();
    if (app.R) app.R.clearAll();
    UI.show(screen || 'main', arg);
  };
  const clearToasts = () => { const tb = document.getElementById('toasts'); if (tb) tb.innerHTML = ''; };   // رسايل الطيران ما تغطي شاشة النتيجة/القائمة
  app.showResult = function () {
    const sm = app.session.summary;
    app.state = 'menu'; HUD.show(false); DS.Audio.motor(false, 0, 0); clearToasts();
    if (sm.passed && !sm.demo) DS.Audio.win();
    UI.show('result', sm);
  };
  app.exit = function () {
    try { if (window.DS_NATIVE && isFn(window.DS_NATIVE.exit)) window.DS_NATIVE.exit(); else if (window.NativePad && isFn(window.NativePad.exit)) window.NativePad.exit(); } catch (e) { /* */ }
  };
  // وين نرجع بعد الطيران: [الشاشة، المعطى]
  app.backFor = function (def) {
    switch (def && def.kind) {
      case 'course': return def.unit != null ? ['unit', def.unit] : ['course'];
      case 'pro': return def.level ? ['proLevel', def.level] : ['pro'];
      case 'free': return ['free'];
      case 'lesson': return ['lessons'];
      case 'mission': return ['missions'];
      case 'scenario': return ['scenarios'];
      case 'exam': return ['exams'];
    }
    return ['main'];
  };
  // زر "الجاي" في شاشة النتيجة → {label, go} أو null
  app.nextFor = function (def, sm) {
    const brief = d => (d ? { label: 'التالي ⏭', go: () => UI.show('brief', d) } : null);
    if (def.kind === 'course') {
      const id = UI.course && UI.course.after(def.lessonId || def.id);
      if (!id) return null;
      const f = UI.course.sum(), x = f && f.find(id);
      return { label: x && x.u.unit !== def.unit ? '⏭ الوحدة الجاية' : (x && x.check ? '⏭ اختبار الوحدة' : '⏭ الدرس الجاي'), go: () => UI.course.open(id) };
    }
    if (def.kind === 'pro') { const id = UI.pro && UI.pro.after(def.exId || def.id); return id ? { label: '⏭ التمرين الجاي', go: () => UI.pro.open(id) } : null; }
    if (def.kind === 'lesson') { const i = DS.LESSONS.findIndex(l => l.id === def.id); return brief(DS.LESSONS[i + 1] ? DS.lessonDef(DS.LESSONS[i + 1]) : null); }
    if (def.kind === 'mission') {
      const m = DS.MISSIONS.find(x => x.id === def.id), di = DS.DIFF_ORDER.indexOf(def.diff);
      if (sm.passed && di < 3) return brief(DS.missionDef(m, DS.DIFF_ORDER[di + 1]));
      const mi = DS.MISSIONS.indexOf(m); return brief(DS.MISSIONS[mi + 1] ? DS.missionDef(DS.MISSIONS[mi + 1], def.diff) : null);
    }
    if (def.kind === 'scenario') { const i = DS.SCENARIOS.findIndex(x => x.id === def.id); return brief(DS.SCENARIOS[i + 1] ? DS.scenarioDef(DS.SCENARIOS[i + 1]) : null); }
    if (def.kind === 'exam' && sm.passed) { const i = DS.FLIGHT_EXAMS.findIndex(x => x.id === def.id); return brief(DS.FLIGHT_EXAMS[i + 1] ? DS.examDef(DS.FLIGHT_EXAMS[i + 1]) : null); }
    return null;
  };

  // Esc وقت الطيران = إيقاف (إلا إذا القائمة استخدمته)
  window.addEventListener('keydown', e => { if (e.code === 'Escape' && app.state === 'fly' && !e.defaultPrevented) app.esc = true; });
  document.addEventListener('visibilitychange', () => { if (document.hidden && app.state === 'fly' && !app.demo) app.pause(); });

  // ---------------- التلفزيون (أندرويد) ----------------
  // زر الرجوع في الريموت: true = تصرفنا • false = القائمة الرئيسية (التطبيق يطلع بضغطتين)
  window.onNativeBack = function () {
    try {
      const s = app.session;
      if (app.state === 'fly') { if (s && (s.frozen || s.ended)) return true; app.pause(); return true; }   // خلصت: النتيجة جاية
      // احتياط: ما فيه شاشة وإحنا مو بالقائمة = لا نعلق
      if (app.state !== 'menu' && !UI.cur) { if (s && s.ended) app.showResult(); else if (s) app.resume(); else app.quit(); return true; }
      if (UI.cur) return UI.backAction();
      return false;
    } catch (e) { console.warn(e); return true; }
  };
  window.onNativeLowMemory = function () {
    const R = app.R;
    if (R && R.tier !== 'tv') { R.qOverride = 'tv'; tryf(() => R.setQuality('tv')); HUD.toast('ذاكرة الجهاز قليلة — خففنا الرسم', 'info'); }
  };
  function nativeInfo() {
    try {
      const N = window.DS_NATIVE;
      if (N && N.info && typeof N.info === 'object') return N.info;
      const NP = window.NativePad;
      if (NP && isFn(NP.info)) return JSON.parse(NP.info() || '{}') || {};
    } catch (e) { /* */ }
    return null;
  }
  const padCount = () => { try { const NP = window.NativePad; return NP && isFn(NP.count) ? +NP.count() : -1; } catch (e) { return -1; } };
  function nativeSetup() {
    const info = app.native = nativeInfo();
    // جودة "تلقائي" على التلفزيون أو جهاز ذاكرته قليلة = مستوى التلفزيون
    if (info && app.R && (info.tv || info.lowRam) && (DS.settings.quality || 'auto') === 'auto') { app.R.platformTV = true; tryf(() => app.R.setQuality('auto')); }
    if (padCount() === 0) setTimeout(() => { if (!I.connected) HUD.toast(DS.PAIR_TEXT || 'وصّل يد التحكم بالبلوتوث', 'info'); }, 600);
  }

  // ---------------- اليد انفصلت ----------------
  // اليد (أو يد التلفزيون) راحت وصرنا على الكيبورد (أو عصي اللمس بالجوال) وقت الطيران = إيقاف + تنبيه (مثل أي محاكي).
  // ما نقفل "كمّل": يقدر يكمل بالكيبورد أو باللمس
  let prevSrc = I.source || 'keyboard';
  function padWatch() {
    const src = I.source || 'keyboard';
    if (src === prevSrc) return false;
    const lost = (src === 'keyboard' || src === 'touch') && (prevSrc === 'gamepad' || prevSrc === 'native');
    prevSrc = src;
    const s = app.session;
    if (!lost || app.demo || !s || s.ended) return false;
    if (app.state === 'pause') { app.padLost = true; return false; }
    if (app.state !== 'fly') return false;
    app.padLost = true;
    if (!app.pause()) return false;
    HUD.toast(src === 'touch' ? '🎮 اليد انفصلت — وصّلها واضغط أي زر، أو كمّل بأزرار الشاشة' : '🎮 اليد انفصلت — وصّلها واضغط أي زر، وبعدين كمّل', 'bad');
    return true;
  }
  // ضغطة B قصيرة والدرون واقف على الأرض: يمكن يبي يطلع → نعلمه وين زر الإيقاف (B نفسه له شغل بالطيران)
  let bT = -1, bHintT = 0;
  const pauseKeyText = () => (I.source === 'touch' ? 'تبي توقف؟ اضغط زر ☰ فوق يسار الشاشة'
    : I.source === 'keyboard' ? 'تبي توقف؟ اضغط Esc أو P'
    : (HUD.tv || app.native) ? 'تبي توقف؟ اضغط ☰ (Start) أو زر الرجوع بالريموت' : 'تبي توقف؟ اضغط ☰ (Start)');
  function bTapHint(s, dt, held) {
    bHintT -= dt;
    if (held) { bT = (bT < 0 ? 0 : bT) + dt; return; }
    if (bT < 0) return;
    const tap = bT < 0.5, d = s.drone; bT = -1;
    if (tap && bHintT <= 0 && d && d.onGround && !d.motors && !s.frozen && !s.ended) { bHintT = 6; HUD.toast(pauseKeyText(), 'info'); }
  }

  // ---------------- الجوال بالطول وقت الطيران: «لفّ الجوال بالعرض» + نوقف الرحلة ----------------
  let rotOn = false;
  function rotateCheck() {
    const T = DS.Touch;
    const need = !!(T && T.dev && !T.isTvApp() && app.session && (app.state === 'fly' || app.state === 'pause') &&
      (window.innerHeight || 0) > (window.innerWidth || 0) * 1.05);
    if (need !== rotOn) { rotOn = need; document.body.classList.toggle('rotate', need); }
    return need && app.state === 'fly' && app.pause();
  }

  // ---------------- الموقع (PWA): يشتغل بدون نت + التثبيت على الجوال ----------------
  // ملف sw.js يتسجل بس على https أو localhost (مو file:// ولا داخل تطبيق التلفزيون)
  const mmq = q => { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } };
  const PWA = DS.PWA = { evt: null, sw: false, updated: false };
  PWA.web = () => {
    if (window.NativePad) return false;
    const p = location.protocol, h = location.hostname;
    return p === 'https:' || (p === 'http:' && (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || /\.localhost$/.test(h)));
  };
  PWA.standalone = () => mmq('(display-mode: fullscreen)') || mmq('(display-mode: standalone)') || window.navigator.standalone === true;
  PWA.ios = () => { const n = window.navigator; return /iPhone|iPad|iPod/.test(n.userAgent || '') || (n.platform === 'MacIntel' && n.maxTouchPoints > 1); };
  PWA.canInstall = () => !!PWA.evt && !PWA.standalone();
  PWA.iosHint = () => PWA.web() && PWA.ios() && !PWA.standalone();
  PWA.install = function () {
    const e = PWA.evt;
    if (!e) return false;
    PWA.evt = null;
    try {
      const p = e.prompt();
      if (p && p.catch) p.catch(() => {});
      if (e.userChoice && e.userChoice.then) e.userChoice.then(c => { if (c && c.outcome === 'accepted') HUD.toast('📲 تم — تلقى المحاكي بشاشة الجوال', 'good'); }, () => {});
    } catch (x) { /* المتصفح رفض */ }
    if (UI.cur && (UI.cur.name === 'title' || UI.cur.name === 'main')) UI.refresh();
    return true;
  };
  window.addEventListener('beforeinstallprompt', e => {
    if (!PWA.web() || PWA.standalone()) return;
    e.preventDefault(); PWA.evt = e;
    if (UI.cur && (UI.cur.name === 'title' || UI.cur.name === 'main')) UI.refresh();
  });
  window.addEventListener('appinstalled', () => { PWA.evt = null; });
  function registerSW() {
    if (!PWA.web() || !('serviceWorker' in navigator)) return;
    const sw = navigator.serviceWorker, had = !!sw.controller;
    sw.register('sw.js', { scope: './' }).then(() => { PWA.sw = true; }, () => { PWA.sw = false; });
    sw.addEventListener('controllerchange', () => {
      if (!had || PWA.updated) return;
      PWA.updated = true;
      HUD.toast('✅ نزل تحديث للمحاكي — سكّر الصفحة وافتحها عشان تاخذه', 'info');
    });
  }
  if (document.readyState === 'complete') setTimeout(registerSW, 0); else window.addEventListener('load', registerSW);

  // ---------------- الحلقة ----------------
  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
    I.poll(dt);
    const ss = app.session;
    let justPaused = padWatch();
    if (rotateCheck()) justPaused = true;
    if (app.state === 'fly' && ss && (I.pressed.START || app.esc)) { app.esc = false; if (app.pause()) justPaused = true; }
    if (app.state === 'fly' && ss) {
      // سؤال "وش تسوي؟": الوقت واقف لين تجاوب
      if (ss.frozen) {
        const d = ss.task.decision, key = ss.idx + ':' + ss.task.st.k + ':' + d.chosen;
        if (app.decKey !== key) { app.decKey = key; UI.show('decision'); }
        if (!app.demo) UI.poll(I);
      } else if (app.decKey) { app.decKey = null; if (UI.cur && UI.cur.name === 'decision') UI.hide(); }

      app.acc += dt;
      let n = 0;
      if (!app.demo) {
        I.controls(CTL);
        for (const k in PEND) if (PEND[k]) CTL.press[k] = true;
        const hd = CTL.held || NOHELD;
        if (app.bGuard) { bT = -1; if (hd.B) { hd.B = false; delete CTL.press.B; } else app.bGuard = false; }   // لين يفك B اللي جا من القائمة
        else bTapHint(ss, dt, !!hd.B);
        for (const k in CTL) if (k !== 'press') CTL2[k] = CTL[k];
      }
      while (app.acc >= H && n < MAXN && !ss.ended) {
        const c = app.demo ? app.autopilot.compute(H, ss) : (n === 0 ? CTL : CTL2);
        ss.step(H, c); app.acc -= H; n++;
      }
      if (n >= MAXN) app.acc = 0;
      if (!app.demo) {
        if (n > 0) { for (const k in PEND) PEND[k] = false; }
        else for (const k in CTL.press) if (CTL.press[k]) PEND[k] = true;
      }
      app.alpha = U.clamp(app.acc / H, 0, 1);
      if (ss.ended) {
        app.endT += dt;
        if (app.endT > (ss.summary && ss.summary.kind === 'crash' ? 2 : 1)) app.showResult();
      }
    } else if (UI.cur && !justPaused) UI.poll(I);
    else if (app.state === 'pause' && !UI.cur && ss) { if (ss.ended) app.showResult(); else app.resume(); }   // احتياط: إيقاف بدون شاشة = لا نعلق
    UI.tick(dt);

    // الرسم
    const R = app.R, cs = app.session;
    if (!R) return;
    try {
      if (cs) { R.update(dt, cs, app.alpha); R.render(cs); if (app.state === 'fly') HUD.update(cs, R, dt); }
      else if (isFn(R.renderIdle)) R.renderIdle(dt);
      else idleV1(R, dt);
    } catch (e) { if (!app.rErr) { app.rErr = true; console.error('render:', e); } }
  }
  let idleT = 0;
  function idleV1(R, dt) {
    idleT += dt;
    const t = idleT * 0.06;
    R.cam.up.set(0, 1, 0); R.cam.position.set(Math.sin(t) * 55, 16, -38 + Math.cos(t) * 55); R.cam.lookAt(0, 2, -38);
    R.cam.fov = 55; R.cam.updateProjectionMatrix();
    if (R.world && R.world.sky) R.world.sky.position.copy(R.cam.position);
    R.renderer.setScissorTest(false); R.renderer.setViewport(0, 0, R.w, R.h);
    R.renderer.render(R.scene, R.cam);
  }

  // ---------------- روابط تجربة (#...) ----------------
  // #demo=hover:easy&ff=12&view=fpv(&pause)(&result) • #play=key • #screen=main|course|pro|free|settings|controls|results(&tab=scr&arg=3)
  // #theory=15(&auto)(&review) • #course=<lessonId>(&demo|&play)(&ff=N) • #pro=<exId>(&demo|&play) • #free=mini:field(&tod=night&wind=strong)
  // &keys=D,D,E (تجربة التنقل: U/D/L/R أسهم، E = Enter، B = رجوع، A = زر A، NB = رجوع التلفزيون، w5 = انتظر 0.5 ث)
  function parseHash() {
    const h = location.hash.replace(/^#/, '');
    if (!h) return null;
    const o = {}, keys = [];
    h.split('&').forEach(p => { if (!p) return; const i = p.indexOf('='), k = i < 0 ? p : p.slice(0, i); o[k] = i < 0 ? true : decodeURIComponent(p.slice(i + 1)); keys.push(k); });
    o._first = keys[0];
    return o;
  }
  function findDef(key) {
    const d = tryf(() => DS.allDefs().find(x => x.key === key), null);
    if (d) return d;
    if (/^course:/.test(key) && isFn(DS.courseDef)) return tryf(() => DS.courseDef(key.slice(7)), null);
    if (/^pro:/.test(key) && isFn(DS.proDef)) return tryf(() => DS.proDef(key.slice(4)), null);
    if (/^free:/.test(key)) { const p = key.split(':'); return app.freeDef({ airframe: p[1], zone: p[2], timeOfDay: p[3], wind: p[4] }); }
    return null;
  }
  function startFF(def, demo, h) {
    if (!def) { HUD.toast('ما لقيت هالرابط', 'bad'); return; }
    if (!app.start(def, demo)) return;
    const s = app.session;
    if (h.view) s.view = h.view;
    if (h.thermal) s.thermalView = true;
    const ff = +(h.ff || 0), ap = app.autopilot || new DS.Autopilot(true);
    for (let t = 0; t < ff && !s.ended; t += H) s.step(H, ap.compute(H, s));
    if (h.result && s.ended) app.showResult();
    else if (h.pause) app.pause();
  }
  const KEYS = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight', E: 'Enter', B: 'Escape', A: 'Space', S: 'KeyP', LB: 'PageUp', RB: 'PageDown' };
  function uiState(tag) {
    const f = UI.focused, s = app.session;
    console.log('[ui] ' + tag + ' screen=' + (UI.cur ? UI.cur.name : '-') + ' state=' + app.state + (s ? ' t=' + s.t.toFixed(1) + ' ended=' + s.ended : '') +
      ' focus=' + (f ? (f.dataset.act + ':' + (f.dataset.arg || '') + ' "' + f.textContent.trim().slice(0, 40) + '"') : '-'));
  }
  function runKeys(seq) {
    let t = 900;
    const fire = (code, type) => document.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }));
    String(seq).split(',').filter(Boolean).forEach(tok => {
      const w = /^w(\d+)$/.exec(tok);
      if (w) { t += +w[1] * 100; return; }
      if (tok === 'NB') setTimeout(() => { const r = window.onNativeBack(); uiState('NB->' + r); }, t);
      else { const code = KEYS[tok] || tok; setTimeout(() => fire(code, 'keydown'), t); setTimeout(() => { fire(code, 'keyup'); uiState(tok); }, t + 120); }
      t += 300;
    });
    setTimeout(() => uiState('end'), t + 200);
  }
  function handleHash() {
    const h = parseHash();
    if (!h) return;
    const first = h._first;
    if (first === 'theory') {
      const v = String(h.theory);
      if (v === 'flash') DS.Theory.startFlash(''); else DS.Theory.startExam(+v || 60, +v || 60);
      if (h.auto) {
        const c = DS.Theory.cur; c.ans = c.qs.map((q, i) => i % 4 ? q.c : (q.c + 1) % 4); DS.Theory.submit();
        if (h.review) { c.ri = 0; c.onlyWrong = true; UI.show('thReview'); }
      }
    } else if (first === 'screen') {
      const ALIAS = { controls: 'help', results: 'resultSample', result: 'resultSample' };
      const v = String(h.screen), name = ALIAS[v] || v;
      let arg = h.arg === true ? undefined : h.arg;
      if (name === 'settings') arg = { tab: h.tab || 'ctl', from: 'main' };
      else if (typeof arg === 'string' && /^\d+$/.test(arg)) arg = +arg;
      UI.show(name, arg);
    } else if (first === 'demo' || first === 'play') startFF(findDef(String(h[first])), first === 'demo', h);
    else if (first === 'course') {
      const id = String(h.course);
      if (h.demo || h.play) startFF(app.courseDef(id, !!h.demo), !!h.demo, h); else UI.show('lesson', id);
    } else if (first === 'pro') {
      const id = String(h.pro);
      if (h.demo || h.play) startFF(isFn(DS.proDef) ? tryf(() => DS.proDef(id), null) : null, !!h.demo, h); else UI.show('proBrief', id);
    } else if (first === 'free') {
      const p = String(h.free).split(':');
      startFF(app.freeDef({ airframe: p[0], zone: p[1] || 'field', timeOfDay: h.tod || p[2] || 'day', wind: h.wind || p[3] || 'light' }), !!h.demo, h);
    }
    if (h.keys) runKeys(h.keys);
  }
  function init() {
    UI.init();
    try {
      if (!window.THREE) throw new Error('three.js ما تحمل');
      app.R = new DS.Render(document.getElementById('c'));
    } catch (e) { app.no3d = true; console.warn(e); document.body.classList.add('no3d'); }
    nativeSetup();
    UI.show('title');
    try { handleHash(); } catch (e) { console.error('hash:', e); }
    requestAnimationFrame(loop);
    app.ready = true;   // التطبيق اشتغل فعلاً (القائمة طلعت) — فحص الصحة حق التلفزيون يشيك عليه
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
