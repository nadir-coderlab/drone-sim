// الشاشة فوق المحاكي: شاشة DJI Fly (درون التصوير) أو Betaflight (FPV) + المهمة + الخريطة + العصي + المدرب + التحذيرات
// كل الرسم بالكانفس بدون إنشاء كائنات جديدة كل فريم، والنصوص تتحدث ~14 مرة بالثانية بس.
(function () {
  const DS = window.DS, U = DS.U;
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const has = v => v !== undefined && v !== null;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const DIRS = ['الشمال', 'الشمال الشرقي', 'الشرق', 'الجنوب الشرقي', 'الجنوب', 'الجنوب الغربي', 'الغرب', 'الشمال الغربي'];
  const dirName = deg => DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  const kmTxt = m => (m >= 1000 ? (m / 1000).toFixed(1) + ' كم' : Math.max(0, Math.round(m / 10) * 10) + ' م');   // مسافة منطقة الحظر
  const PLATFORM_TV = /[?&]platform=tv(&|$)/.test(location.search);
  DS.platformTv = PLATFORM_TV;

  // كائنات نعيد استخدامها (بدون تخصيص ذاكرة كل فريم)
  const ATT = { pitch: 0, roll: 0, tilt: 0 };          // راديان: pitch موجب = الخشم فوق، roll موجب = اليمين تحت
  const WIND = { x: 0, y: 0, z: 0, gx: 0, gz: 0 };
  const SP = { vol: 1, pitch: 1 };
  const HL = { x: 0, y: 0 }, HR = { x: 0, y: 0 };   // ظل العصي بعد التحويل لـ Mode 1
  const ZERO_C = { thr: 0, yaw: 0, pitch: 0, roll: 0, throttle01: 0 };
  const NOLOCK = { thr: false, yaw: false, pitch: false, roll: false };
  const BIDI = { tpMission: 1, tpTask: 1, tpHint: 1, tpMeta: 1, warnBox: 1, stickTxt: 1, hStatus: 1, demoTag: 1 };   // نصوص عربية فيها كلمات إنجليزية
  // الوحدات ما تنقسم على سطرين («0.0 م/» وتحت «ث»): مسافة ما تنكسر + وصلات حول /
  const UNIT_RE = / ?(\u0645|\u0643\u0645)\/(\u062b|\u0633)/g, UNIT_TO = '\u00A0$1\u2060/\u2060$2';   // م/ث كم/س
  const nbu = v => (typeof v === 'string' && v.indexOf('/') >= 0 ? v.replace(UNIT_RE, UNIT_TO) : v);
  const DASH = [4, 3], AH_DASH = [12, 7], NODASH = [];
  const HINT_DIR = { up: { x: 0, y: 1 }, down: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, center: { x: 0, y: 0 } };
  const OB_DIR = { front: 0, f: 0, F: 0, forward: 0, right: Math.PI / 2, r: Math.PI / 2, R: Math.PI / 2, back: Math.PI, b: Math.PI, B: Math.PI, rear: Math.PI, left: -Math.PI / 2, l: -Math.PI / 2, L: -Math.PI / 2 };
  const CAM_VIEWS = { fpv: 1, cam: 1, camera: 1, gimbal: 1 };
  const BF_MODE = { ANGLE: 'ANGL', HORIZON: 'HOR', ACRO: 'ACRO' };
  const ZONE_AR = { race: 'حلبة FPV', city: 'المدينة', desert: 'الصحراء', nist: 'مسار NIST', road: 'الطريق' };
  const ZONE_COL = { race: 'rgba(56,189,248,0.14)', city: 'rgba(148,163,184,0.16)', desert: 'rgba(234,179,8,0.13)' };
  // جهد الخلية حسب الشحن (Li-ion للـ Mini و LiPo للـ FPV) من ملفات البحث
  const OCV_SOC = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const OCV_LIION = [3.0, 3.3, 3.4, 3.53, 3.62, 3.7, 3.78, 3.86, 3.95, 4.05, 4.15, 4.3];
  const OCV_LIPO = [3.27, 3.61, 3.69, 3.73, 3.77, 3.8, 3.84, 3.87, 3.95, 4.02, 4.11, 4.2];
  function ocv(tab, soc) {
    soc = clamp(soc, 0, 1);
    for (let i = 1; i < OCV_SOC.length; i++) {
      if (soc <= OCV_SOC[i]) { const a = OCV_SOC[i - 1], t = (soc - a) / (OCV_SOC[i] - a); return tab[i - 1] + (tab[i] - tab[i - 1]) * t; }
    }
    return tab[tab.length - 1];
  }

  // ---------- قراءة حقول الدرون (v2 مع رجوع لـ v1) ----------
  const airOf = d => (d.airframe === 'fpv' ? 'fpv' : 'mini');
  const profOf = d => d.profile || (DS.AIRFRAMES && DS.AIRFRAMES[airOf(d)]) || null;
  const socOf = d => clamp(has(d.soc) ? num(d.soc, 1) : num(d.battery, 100) / 100, 0, 1);
  const modeOf = d => (typeof d.effMode === 'function' ? d.effMode() : d.mode) || '';
  const homeOf = d => d.home || DS.HOME || ZERO_C;
  // رقم من بروفايل الدرون: يدور في البروفايل نفسه وفي bat / battery / cam
  const PROF_SUB = ['bat', 'battery', 'cam'];
  function profNum(p, keys, def) {
    if (!p) return def;
    for (let j = -1; j < PROF_SUB.length; j++) {
      const o = j < 0 ? p : p[PROF_SUB[j]];
      if (!o || typeof o !== 'object') continue;
      for (let i = 0; i < keys.length; i++) { const v = o[keys[i]]; if (typeof v === 'number' && isFinite(v)) return v; }
    }
    return def;
  }
  // الميلان من الـ quaternion (أو tf/tr القديمة)
  function attitude(d, out) {
    const q = d.q;
    if (q && typeof q.w === 'number') {
      const x = q.x, y = q.y, z = q.z, w = q.w;
      const fy = -2 * (y * z - w * x);          // y حق اتجاه الخشم
      const ry = 2 * (x * y + w * z);           // y حق الجناح اليمين
      const uy = 1 - 2 * (x * x + z * z);       // y حق فوق الدرون
      out.pitch = Math.asin(clamp(fy, -1, 1));
      out.roll = Math.atan2(-ry, uy);
      out.tilt = Math.acos(clamp(uy, -1, 1));
    } else {
      out.pitch = -num(d.tf, 0); out.roll = num(d.tr, 0);
      out.tilt = Math.sqrt(out.pitch * out.pitch + out.roll * out.roll);
    }
    return out;
  }
  // اتجاه العائق بالنسبة لخشم الدرون (0 قدام، موجب يمين)
  function obstacleRel(ob, d) {
    if (typeof ob.up === 'number' && Math.abs(ob.up) > 0.7) return null;   // فوق أو تحت
    let a = ob.dir;
    if (typeof a === 'string') return has(OB_DIR[a]) ? OB_DIR[a] : null;   // up/down = ما نرسمه كقوس
    if (typeof a === 'number') return ob.world ? U.wrap(a - d.yaw) : a;
    if (a && typeof a === 'object' && has(a.x)) return U.wrap(Math.atan2(a.x, -num(a.z, 0)) - d.yaw);
    if (has(ob.x) && has(ob.z)) return U.wrap(U.bearing(d.p.x, d.p.z, ob.x, ob.z) - d.yaw);
    return 0;
  }
  const relAr = r => (Math.abs(r) <= 0.7 ? 'قدامك' : Math.abs(r) >= 2.44 ? 'وراك' : r > 0 ? 'على يمينك' : 'على يسارك');

  // كانفس بدقة الشاشة (ما يغير المقاس إلا إذا تغير فعلاً)
  function fit(cv, w, h, kMax) {
    const k = Math.min(kMax, Math.max(1, (window.devicePixelRatio || 1) * HUD.hs));
    const bw = Math.round(w * k), bh = Math.round(h * k);
    if (cv.width !== bw) cv.width = bw;
    if (cv.height !== bh) cv.height = bh;
    return k;
  }

  // وين زر الإيقاف (يطلع دايم بلوحة المهمة — B بالطيران له شغل ثاني)
  const pauseTip = tv => {
    const src = DS.Input && DS.Input.source;
    return src === 'keyboard' && !tv ? ' • Esc = إيقاف' : tv ? ' • ☰ أو رجوع = إيقاف' : ' • ☰ (Start) = إيقاف';
  };
  const E = {};   // عناصر الصفحة
  const IDS = ['hud', 'dji', 'djiBatCrit', 'djiBatFill', 'djiBatH', 'hMode', 'hStatus', 'hOA', 'hVis', 'hGps', 'hSats', 'hSig', 'hSigBars', 'hBat', 'hBatIco', 'hBatPct', 'hBatTime', 'hBatV',
    'djiTel', 'att', 'tH', 'tD', 'tHS', 'tVS', 'bf', 'bfBar', 'bfTL', 'bfTC', 'bfWarn', 'bfL', 'bfR', 'bfHome', 'bfArrow', 'bfHomeD', 'osdC',
    'rightCol', 'taskPanel', 'tpMission', 'tpTask', 'tpHint', 'tpBar', 'tpMeta', 'hWind', 'hTime', 'hView', 'hShots', 'warnBox',
    'sticksBox', 'stickTxt', 'stL', 'stR', 'mini', 'pipFrame', 'pipLabel', 'pipRet', 'marker', 'zoomInd', 'zoomVal', 'zoomFill', 'telemO', 'coach', 'coachTxt',
    'toasts', 'bigmsg', 'demoTag', 'flash'];
  const DUMMY = () => { const el = document.createElement('div'); return el; };

  const HUD = DS.HUD = {
    t: 0, slowAcc: 1, clock: 0, last: {}, fl: {}, hs: 1, tv: false, vw: 1280, vh: 720, sx: 0, sy: 0,
    _pl: [0, 0, 0, 0, 0], _pp: [0, 0, 0, 0], _ppv: '', placeDirty: true, pipDirty: true,
    sess: null, demo: false, errs: {},

    init() {
      for (const id of IDS) E[id] = $(id) || DUMMY();
      this.g = {
        att: E.att.getContext ? E.att.getContext('2d') : null, stL: E.stL.getContext ? E.stL.getContext('2d') : null,
        stR: E.stR.getContext ? E.stR.getContext('2d') : null, mini: E.mini.getContext ? E.mini.getContext('2d') : null,
        osd: E.osdC.getContext ? E.osdC.getContext('2d') : null
      };
      this.mkBanner();
      this.capL = E.stL.parentNode && E.stL.parentNode.querySelector('figcaption');
      this.capR = E.stR.parentNode && E.stR.parentNode.querySelector('figcaption');
      this.applyTv();
      window.addEventListener('resize', () => this.applyTv());
    },

    // وضع التلفزيون: body.tv + تكبير ~1.35 (يصغر شوي إذا الشاشة صغيرة) + هوامش 5%
    applyTv() {
      const S = DS.settings || {}, on = PLATFORM_TV || !!S.tvMode, w = window.innerWidth || 1280, h = window.innerHeight || 720;
      document.body.classList.toggle('tv', on);
      const z = on ? clamp(1.35 * Math.min(1, w / 1600, h / 900), 0.75, 1.6) : 1;
      const st = document.documentElement.style;
      st.setProperty('--hs', String(Math.round(z * 1000) / 1000));
      st.setProperty('--uz', String(Math.round(z * 1000) / 1000));
      st.setProperty('--scrW', Math.round(Math.min(1100, 0.9 * w / z)) + 'px');
      st.setProperty('--ovW', Math.round(0.9 * w / z) + 'px');
      st.setProperty('--ovH', Math.round(0.9 * h / z) + 'px');
      this.tv = on; this.hs = z; this.vw = w; this.vh = h;
      this.sx = on ? 0.05 * w : 0; this.sy = on ? 0.05 * h : 0;
      this.miniCss = w <= 760 ? 130 : 190;
      st.setProperty('--miniW', this.miniCss + 'px');   // مكان الزوم جنب الخريطة (التلفزيون)
      this.placeDirty = true; this.pipDirty = true;
    },

    // شريط كبير فوق (الرجوع الذكي بالعد التنازلي، الدرون مقلوب) — نبنيه هنا عشان ما نلمس index.html
    mkBanner() {
      if (!document.getElementById('hBanCss')) {
        const st = document.createElement('style'); st.id = 'hBanCss';
        st.textContent = '#hBan{position:absolute;top:calc(var(--sy) + 27vh);left:44%;transform:translateX(-50%) scale(var(--hs));transform-origin:top center;' +
          'min-width:340px;max-width:min(640px,48vw);padding:12px 22px 10px;border-radius:14px;background:rgba(69,10,10,.93);border:2px solid #ef4444;color:#fff;' +
          'text-align:center;font-weight:800;display:none;box-shadow:0 6px 24px rgba(0,0,0,.55);z-index:4}' +
          '#hBan.on{display:block}#hBan.warn{background:rgba(66,32,6,.93);border-color:#f59e0b}#hBan.info{background:rgba(8,28,48,.93);border-color:#38bdf8}' +
          '#hBan .bt{font-size:23px;line-height:1.35}#hBan .bs{font-size:17px;color:#fde68a;margin-top:4px;font-weight:700}' +
          '#hBan .bb{height:7px;background:rgba(255,255,255,.18);border-radius:4px;margin-top:9px;overflow:hidden;display:none}#hBan .bb.on{display:block}' +
          '#hBan .bb i{display:block;height:100%;width:100%;background:#f87171;transition:width .1s linear}' +
          'body.tv #hBan .bt{font-size:26px}body.tv #hBan .bs{font-size:19px}';
        document.head.appendChild(st);
      }
      let b = document.getElementById('hBan');
      if (!b && E.hud.appendChild) {
        b = document.createElement('div'); b.id = 'hBan';
        b.innerHTML = '<div class="bt"></div><div class="bs"></div><div class="bb"><i></i></div>';
        E.hud.appendChild(b);
      }
      E.hBan = b || DUMMY();
      E.hBanT = (b && b.querySelector('.bt')) || DUMMY(); E.hBanS = (b && b.querySelector('.bs')) || DUMMY();
      E.hBanB = (b && b.querySelector('.bb')) || DUMMY(); E.hBanI = (b && b.querySelector('.bb i')) || DUMMY();
    },
    show(on) { E.hud.classList.toggle('hidden', !on); if (on) this.applyTv(); },
    toast(text, kind) {
      const box = E.toasts, el = document.createElement('div');
      el.className = 'toast ' + (kind || 'info'); el.textContent = U.bidi(text);
      box.prepend(el);
      while (box.children.length > 4) box.lastChild.remove();
      setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 600); }, kind === 'task' ? 3500 : 4200);
    },
    big(text, kind) {
      const el = E.bigmsg; el.textContent = U.bidi(text); el.className = 'show ' + (kind || '');
      clearTimeout(this._bt); this._bt = setTimeout(() => { el.className = ''; }, 2600);
    },
    reset() {
      E.toasts.innerHTML = ''; E.bigmsg.className = ''; this.last = {}; this.sess = null;
      E.coach.className = ''; this.placeDirty = true; this.pipDirty = true;
    },

    // جلسة جديدة: نصفر الحالة الداخلية
    bind(s) {
      this.sess = s; this.demo = !!s.demo; this.last = {};
      this.B = { prev: -1, rate: -1, tLeft: 0, hMark: 0.1, hDisp: 0.1, crit: 0.03, v: 0, vLp: -1, cellV: 0, mah: 0, lvl: 0 };
      this.armT = 0; this.armAt = -10;
      this.mapItems = null; this.mapT = 1; this.slowAcc = 1; this.mapRange = 130; this.rangeTxt = ''; this.rangeR = 0;
      this.cRef = null; this.cText = ''; this.cT = null; this.cUntil = 0; this.saidText = ''; this.saidAt = -99;
      this.vrsT = 0; this.gust = 0; this.gPrevX = 0; this.gPrevZ = 0; this.gustCd = 0; this.rq0 = -1;
      this.windLvl = 0; this.windHold = 0; this.tiltT = 0; this.zoomPrev = 1; this.zoomT = 0;
      this.fps = 60; this.telT = 1; this.lastWm = null;
      this.placeDirty = true; this.pipDirty = true; this.mk = { x: -1, y: -1, on: false, dm: -1 };
      this.obTxt = ''; this.obTxtV = -1; this.banBeep = -1;
      E.coach.className = '';
      if (E.hBan) E.hBan.className = '';
    },

    update(s, R, dt) {
      if (!s || !s.drone) return;
      if (!this.g) this.init();
      if (s !== this.sess) this.bind(s);
      const d = s.drone;
      this.clock += dt;
      if (dt > 0) this.fps += (1 / dt - this.fps) * Math.min(1, dt * 2);
      attitude(d, ATT);
      try { this.events(s, d); } catch (e) { this.err('events', e); }
      try { this.feel(s, d, dt); } catch (e) { this.err('feel', e); }
      try { this.battery(s, d, dt); } catch (e) { this.err('battery', e); }
      try { this.coachTick(s); } catch (e) { this.err('coach', e); }
      try { this.flags(s, d, R); } catch (e) { this.err('flags', e); }
      // الجهاز الضعيف (DS.lite): نرسم العدادات أقل مرات بالثانية — رسمها كل فريم كان ينزل السرعة للنص
      const lite = !!DS.lite;
      this.stAcc = (this.stAcc || 0) + dt;
      if (!lite || this.stAcc >= 0.1) {
        this.stAcc = 0;
        try { if (this.fl['sticks-on']) this.drawSticks(s, d); } catch (e) { this.err('sticks', e); }
      }
      // الخريطة وكرة الميلان 30 مرة بالثانية تكفي (أخف على التلفزيون)
      this.slowAcc += dt;
      if (this.slowAcc >= (lite ? 0.2 : 0.03)) {
        const sdt = this.slowAcc; this.slowAcc = 0;
        try { this.drawMap(s, d, sdt); } catch (e) { this.err('map', e); }
        try { if (this.fl['osd-dji']) this.drawAtt(s, d); } catch (e) { this.err('att', e); }
      }
      this.ctrAcc = (this.ctrAcc || 0) + dt;
      if (!lite || this.ctrAcc >= 0.066) {
        this.ctrAcc = 0;
        try { this.drawCenter(s, d, R); } catch (e) { this.err('center', e); }
        try { this.marker(s, d, R); this.pip(s, R); } catch (e) { this.err('marker', e); }
      }
      this.t += dt;
      if (this.t < (lite ? 0.25 : 0.07)) return;
      const tdt = this.t; this.t = 0;
      try { this.text(s, d, R, tdt); } catch (e) { this.err('text', e); }
      try {
        const A = DS.Audio, P = DS.PILOT || ZERO_C;
        if (A && A.motor) {
          const dx = d.p.x - num(P.x, 0), dy = d.p.y - 1.7, dz = d.p.z - num(P.z, 0), dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          let load = d.load;
          if (!has(load)) { const m = d.motor; load = m && m.length ? (m[0] + m[1] + m[2] + m[3]) / 4 : num(d.throttle, 0.5); }
          // الصوت يخف كل ما بعد الدرون عن الطيار (+ دوبلر إذا util يدعمه)
          let vol, pitch = 1;
          if (typeof A.spatial === 'function') {
            const vAway = dist > 0.1 ? (d.v.x * dx + d.v.y * dy + d.v.z * dz) / dist : 0;
            const o = A.spatial(dist, vAway, SP) || SP; vol = num(o.vol, 1); pitch = num(o.pitch, 1);
          } else vol = Math.max(0.05, 1 / (1 + Math.pow(dist / 14, 1.5)));
          A.motor(!!d.motors && !d.crashed, clamp(load, 0, 1), vol, pitch, this.air);
        }
      } catch (e) { this.err('audio', e); }
    },
    err(where, e) {
      if (this.errs[where]) return;
      this.errs[where] = 1; console.warn('HUD.' + where + ':', e);
    },
    flag(name, on) {
      on = !!on;
      if (this.fl[name] !== on) { this.fl[name] = on; E.hud.classList.toggle(name, on); }
    },

    // ---------- أحداث الدرون → رسائل + اهتزاز + أصوات ----------
    events(s, d) {
      const ev = d.events; if (!ev) return;
      while (ev.length) {
        const e = ev.shift();
        if (!e) continue;
        const ty = e.type;
        if (ty === 'rumble') { this.rumbleEv(e); continue; }
        if (ty === 'motors') { this.rumble(0, 0.3, 120); this.armAt = this.clock; }
        else if (ty === 'touchdown') {
          const td = d.touchdown, vs = Math.abs(num(e.vs, td ? num(td.vs, 0.5) : 0.5));
          this.rumble(0.15 + 0.45 * Math.min(1, vs / 2.5), 0, 80);
        } else if (ty === 'crash' && !this.physRumble(d)) this.rumble(1, 1, 400);
        else if (ty === 'shutter') this.flash();
        else if (ty === 'warn') this.rumble(0, 0.3, 90);
        if (!e.text || ty === 'shutter' || ty === 'touchdown') continue;
        if (ty === 'crash') { this.big('💥 ' + e.text, 'bad'); if (DS.Audio) DS.Audio.fail(); }
        else if (ty === 'warn') { this.toast('⚠️ ' + e.text, 'bad'); if (DS.Audio) DS.Audio.warn(); }
        else if (ty === 'mode') this.toast('الوضع: ' + e.text, 'info');
        else this.toast(e.text, 'info');
      }
    },
    // فيزياء v2 ترسل اهتزاز الصدمة والدوامة بنفسها (drone.rumble) فما نكررها
    physRumble(d) { return typeof d.rumble === 'function'; },
    rumbleEv(e) {
      let r = e.rumble || e;
      if (!has(r.strong) && !has(r.weak) && typeof e.text === 'string' && e.text.charAt(0) === '{') { try { r = JSON.parse(e.text); } catch (x) { return; } }
      this.rumble(num(r.strong, 0), num(r.weak, 0), num(r.ms, 120));
    },
    rumble(strong, weak, ms) {
      if (this.demo || DS.settings.rumble === false) return;
      const I = DS.Input;
      if (!I || typeof I.rumble !== 'function') return;
      try { I.rumble(clamp(strong, 0, 1), clamp(weak, 0, 1), ms); } catch (e) { /* اليد ما تدعم الاهتزاز */ }
    },
    flash() {
      const f = E.flash; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
      const A = DS.Audio;
      if (A && A.shutter) A.shutter();
      else if (A && A.beep) { A.beep(2400, 0.025, 'square', 0.05); A.beep(1700, 0.04, 'square', 0.05, 0.06); }
    },
    // اهتزازات مستمرة: دوامة المراوح، البطارية، هبات الريح
    feel(s, d, dt) {
      const c = this.clock;
      if (this.rq0 > 0 && c >= this.rq0) { this.rq0 = -1; this.rumble(0, 0.5, 120); }   // الرجّة الثانية حق البطارية
      if (d.vrs && d.motors && !this.physRumble(d)) { this.vrsT -= dt; if (this.vrsT <= 0) { this.vrsT = 0.25; this.rumble(0.6, 0, 120); } } else this.vrsT = 0;
      // هبة ريح قوية = رجّة على قد تسارعها
      const W = s.env && s.env.wind;
      if (W && W.at && d.motors && !d.onGround) {
        const w = W.at(Math.max(d.p.y, 1), WIND) || WIND;
        const gx = num(w.gx, 0), gz = num(w.gz, 0);
        if (dt > 0) {
          const acc = Math.hypot(gx - this.gPrevX, gz - this.gPrevZ) / dt;
          this.gust += (acc - this.gust) * Math.min(1, dt / 0.15);
        }
        this.gPrevX = gx; this.gPrevZ = gz; this.gustCd -= dt;
        if (this.gust > 4 && this.gustCd <= 0) { this.gustCd = 0.5; this.rumble(clamp(this.gust / 20, 0.1, 0.45), 0, 110); }
      }
    },

    // ---------- البطارية: الوقت الباقي + علامة H حق الرجوع ----------
    battery(s, d, dt) {
      const B = this.B, soc = socOf(d), p = profOf(d), fpv = airOf(d) === 'fpv';
      const cap = profNum(p, ['mah', 'mAh', 'capacity'], fpv ? 1300 : 2590);
      const cells = num(d.cells, profNum(p, ['cells', 'nCells'], fpv ? 6 : 2));
      const nominal = 1 / (fpv ? 300 : 1900);   // جزء من البطارية بالثانية وهو يحوم تقريباً
      let inst = -1;
      if (has(d.amps) && d.amps > 0 && cap > 0) inst = d.amps / (cap / 1000 * 3600);
      else if (B.prev >= 0 && dt > 0 && d.motors) inst = Math.max(0, (B.prev - soc) / dt);
      B.prev = soc;
      if (B.rate < 0) B.rate = inst > 0 ? inst : nominal;
      if (d.motors && inst >= 0) B.rate += (inst - B.rate) * Math.min(1, dt / 4);
      else B.rate += (nominal - B.rate) * Math.min(1, dt / 2);
      const r = Math.max(num(B.rate, nominal), nominal * 0.5);
      B.tLeft = d.motors && num(d.timeLeft, 0) > 0 ? d.timeLeft : soc / r;
      const h = homeOf(d), dist = Math.hypot(d.p.x - num(h.x, 0), d.p.z - num(h.z, 0)), alt = Math.max(0, d.p.y - num(h.y, 0));
      const rthAlt = num(d.rthSetting, 20);
      let tHome = 0;
      if (dist > 5) tHome = (dist > 50 && alt < rthAlt ? (rthAlt - alt) / 5 : 0) + dist / 10.5 + 3;
      const descend = Math.max(alt, dist > 50 ? rthAlt : 0) / 3;
      const hm = num(d.rthSoc, 0) > 0 ? clamp(d.rthSoc, 0.05, 1) : clamp((tHome + descend) * r * 1.15 + 0.1, 0.1, 1);
      B.hMark = hm; B.hDisp += (hm - B.hDisp) * Math.min(1, dt * 2);
      B.crit = clamp(alt / 3 * r * 1.2 + 0.03, 0.03, 0.6);
      B.soc = soc;
      B.v = has(d.voltage) ? num(d.voltage, 0) : cells * ocv(fpv ? OCV_LIPO : OCV_LIION, soc);
      B.vLp = B.vLp < 0 ? B.v : B.vLp + (B.v - B.vLp) * Math.min(1, dt / 1.0);
      B.cellV = B.vLp / Math.max(1, cells); B.cells = cells;
      B.mah = has(d.mah) ? num(d.mah, 0) : (1 - soc) * cap;
      if (d.motors) this.armT += dt;
      // رجّتين خفيفة لما تنزل البطارية لمستوى جديد
      B.warnV = d.vCellF > 0 ? d.vCellF : B.cellV;   // التحذير على الجهد المفلتر (نفس الفيزياء) — الضربة القصيرة ما تنذر
      const lvl = !d.motors ? 0 : (fpv ? (B.warnV < 3.5 ? 2 : 0) : (soc <= B.crit || soc <= 0.15 ? 2 : soc <= B.hMark || soc <= 0.3 ? 1 : 0));
      if (lvl > B.lvl) { this.rumble(0, 0.5, 120); this.rq0 = this.clock + 0.25; }
      B.lvl = lvl;
    },

    // ---------- المدرب ----------
    coachTick(s) {
      const c = s.coach;
      if (c && c.text && (c !== this.cRef || c.text !== this.cText || c.t !== this.cT)) {
        this.cRef = c; this.cText = c.text; this.cT = c.t;
        E.coachTxt.textContent = U.bidi(nbu(c.text));
        E.coach.className = 'show k-' + (c.kind || 'info');
        this.cUntil = this.clock + 5 + c.text.length * 0.07;
        // نقرأها بالصوت إذا محد قرأها (Voice نفسه يمنع التكرار خلال 4 ث)
        const V = DS.Voice;
        if (V && typeof V.say === 'function' && DS.settings.voice !== false && !c.spoken && !(c.text === this.saidText && this.clock - this.saidAt < 8)) {
          try { V.say(c.text, { priority: c.kind === 'bad' ? 'high' : 'normal' }); } catch (e) { /* ما فيه صوت */ }
          this.saidText = c.text; this.saidAt = this.clock;
        }
        c.spoken = true;
      }
      if (this.cUntil && this.clock > this.cUntil) { this.cUntil = 0; E.coach.classList.remove('show'); }
    },

    // ---------- أي شاشة تطلع ----------
    flags(s, d, R) {
      const S = DS.settings, air = airOf(d), osd = S.osd !== false;
      const cam = !!CAM_VIEWS[s.view];
      const h = s.stickHint, hint = !!(h && (h.L || h.R || h.text));
      this.air = air; this.cam = cam;
      this.flag('osd-dji', osd && air === 'mini');
      this.flag('osd-bf', osd && air === 'fpv');
      this.flag('cam', cam);
      const L = s.axisLock, locked = !!(L && (L.thr || L.yaw || L.pitch || L.roll));
      this.flag('sticks-on', S.showSticks !== false || hint || locked);
      this.flag('stick-txt', !!(h && h.text));
      this.place(s, R);
    },
    // أماكن تعتمد على الشاشة الصغيرة (PiP)
    place(s, R) {
      const pr = R && R.pipRect, hs = this.hs, so = this.fl['sticks-on'] ? 1 : 0, L = this._pl;
      const px = pr ? pr.x : -1, py = pr ? pr.y : -1, pw = pr ? pr.w : -1, ph = pr ? pr.h : -1;
      if (!this.placeDirty && L[0] === px && L[1] === py && L[2] === pw && L[3] === ph && L[4] === so) return;
      this.placeDirty = false; L[0] = px; L[1] = py; L[2] = pw; L[3] = ph; L[4] = so;
      const sx = this.sx, sy = this.sy, telW = 300 * hs;
      let tl = sx + 16, tb = sy + 16;
      if (pr) {
        const sticksL = this.fl['sticks-on'] ? this.vw / 2 - 130 * hs : this.vw - (this.miniCss + 40) * hs;
        if (pr.x + pr.w + 14 + telW < sticksL) { tl = pr.x + pr.w + 14; tb = Math.max(sy + 16, pr.y); }
        else { tl = pr.x; tb = pr.y + pr.h + 32; }
      }
      E.djiTel.style.left = Math.round(tl) + 'px'; E.djiTel.style.bottom = Math.round(tb) + 'px';
      E.bfL.style.bottom = Math.round(pr ? pr.y + pr.h + 40 : sy + 30 + 110 * hs) + 'px';
      E.bfR.style.bottom = Math.round(sy + 14 + (this.miniCss + 30) * hs) + 'px';
    },

    // ---------- النصوص (14 مرة بالثانية) ----------
    set(id, v) { if (this.last[id] !== v) { this.last[id] = v; E[id].innerHTML = BIDI[id] ? U.bidiHtml(nbu(v)) : v; } },
    setT(id, v) { if (this.last[id] !== v) { this.last[id] = v; E[id].textContent = BIDI[id] ? U.bidi(nbu(v)) : v; } },
    cls(id, v) { const k = '.' + id; if (this.last[k] !== v) { this.last[k] = v; E[id].className = v; } },
    sty(id, prop, v) { const k = id + '.' + prop; if (this.last[k] !== v) { this.last[k] = v; E[id].style[prop] = v; } },

    text(s, d, R, tdt) {
      const S = DS.settings, def = s.def || {}, task = s.task, B = this.B, air = this.air;
      const m = modeOf(d), md = (DS.MODES && DS.MODES[m]) || null, label = (md && md.label) || m;
      const h = homeOf(d), hx = num(h.x, 0), hz = num(h.z, 0);
      const dist = Math.hypot(d.p.x - hx, d.p.z - hz), alt = d.p.y - num(h.y, 0), hsp = Math.hypot(d.v.x, d.v.z);
      const lq = has(d.linkQ) ? clamp(num(d.linkQ, 0), 0, 100) : (d.link === false ? 0 : 99);
      const linkOk = d.link !== false;
      const ob = d.obstacle, obD = ob ? num(ob.dist, 99) : 99;
      const wi = s.env && s.env.wind && s.env.wind.info ? s.env.wind.info(Math.max(d.p.y, 2)) : null;
      const p = profOf(d), windLim = profNum(p, ['windLimit', 'maxWind', 'windMax'], air === 'fpv' ? 18 : 10.7);
      this.windCheck(s, d, md, wi, windLim, tdt);

      // --- DJI Fly ---
      if (this.fl['osd-dji']) {
        const st = this.djiStatus(d, m, lq, linkOk, obD);
        this.setT('hMode', label);
        this.cls('hMode', 'djiMode m' + m);
        this.setT('hStatus', st.t);
        this.cls('hStatus', 'djiStat s-' + st.k);
        const sats = has(d.sats) ? Math.round(num(d.sats, 0)) : (d.gps === false ? 0 : 18);
        this.setT('hSats', String(sats));
        this.cls('hGps', 'di' + (d.gps === false || sats < 6 ? ' red blink' : sats < 10 ? ' yel' : ''));
        const vis = has(d.vision) ? !!d.vision : true;
        this.cls('hVis', 'di' + (vis ? '' : ' red'));
        const oa = d.motors && has(d.sensorsOn) ? !!d.sensorsOn : S.sensors !== false && vis && (m === 'C' || m === 'P' || m === 'N');
        this.cls('hOA', 'di' + (!oa ? ' off' : obD < 3 ? ' red blink' : obD < 8 ? ' yel' : ''));
        const bars = linkOk ? Math.ceil(lq / 20) : 0;
        this.cls('hSigBars', 'sigb b' + bars + (lq < 30 ? ' weak' : ''));
        this.cls('hSig', 'di' + (linkOk ? (lq < 30 ? ' yel' : '') : ' red blink'));
        const pct = Math.round(B.soc * 100);
        this.setT('hBatPct', pct + '%');
        this.setT('hBatTime', U.mmss(B.tLeft));
        this.setT('hBatV', B.vLp.toFixed(2) + 'V');
        this.sty('hBatIco', 'width', pct + '%');
        const bk = B.soc <= B.crit ? ' red blink' : B.soc <= B.hMark ? ' yel' : '';
        this.cls('hBat', 'di' + bk);
        this.sty('djiBatFill', 'width', (B.soc * 100).toFixed(1) + '%');
        this.cls('djiBatFill', B.soc <= B.crit ? 'low' : B.soc <= B.hMark ? 'mid' : '');
        this.sty('djiBatCrit', 'width', (B.crit * 100).toFixed(1) + '%');
        this.sty('djiBatH', 'left', (B.hDisp * 100).toFixed(1) + '%');
        this.setT('tH', U.fmt(alt, 1)); this.setT('tD', String(Math.round(dist)));
        this.setT('tHS', U.fmt(hsp, 1)); this.setT('tVS', U.fmt(d.v.y, 1));
      }
      // --- Betaflight ---
      if (this.fl['osd-bf']) this.bfText(s, d, m, label, lq, linkOk, dist, alt, hsp, hx, hz);

      // --- لوحة المهمة ---
      this.set('tpMission', (def.icon || '') + ' ' + (def.title || '') + (def.sub ? ' <small>• ' + def.sub + '</small>' : ''));
      if (def.kind === 'free') {
        this.set('tpTask', 'طيران حر');
        const fh = task && (task.tt ? task.hint : task.o && task.o.hint);   // حلبة السباق: وقت اللفة من FreeTask
        this.set('tpHint', d.onGround && !d.motors ? 'شغّل المحركات (A مطوّل يقلع) وطِر براحتك. ☰ للقائمة'
          : fh ? fh : air === 'fpv' ? 'طِر براحتك. ⬆⬇ يغير الوضع (Angle / Horizon / Acro) • Y الكاميرا • لو انقلب: A مطوّل يقلبه'
            : 'طِر براحتك. X يوقف الدرون • ⬆⬇ يغير الوضع • Y الكاميرا' + (def.thermal ? ' (مطوّل = حراري)' : '') + ' • B مطوّل يرجع للبيت');
        this.sty('tpBar', 'width', '0%'); this.set('tpMeta', '');
      } else if (task) {
        const n = s.tasks ? s.tasks.length : 1;
        this.set('tpTask', (n > 1 ? '<small>(' + (s.idx + 1) + '/' + n + ')</small> ' : '') + (task.title || ''));
        this.set('tpHint', s.wait > 0 ? '✓ ممتاز…' : (task.decision ? '❓ جاوب على السؤال' : (task.hint || '')));
        this.sty('tpBar', 'width', Math.round(clamp(num(task.progress, 0), 0, 1) * 100) + '%');
        const rem = num(task.tl, 1e9) < 9000 ? ' • باقي ' + U.mmss(task.tl - num(task.t, 0)) : '';
        this.set('tpMeta', 'الوقت ' + U.mmss(num(task.t, 0)) + rem + (s.demo ? '' : pauseTip(this.tv)));
      }
      this.setT('hWind', wi ? '💨 ' + U.fmt(wi.speed, 1) + ' م/ث' + (wi.speed > 0.3 ? ' من ' + dirName(wi.fromDeg) : '') : '');
      this.setT('hTime', '⏱ ' + U.mmss(num(s.t, 0)));
      this.setT('hView', '👁 ' + ((DS.VIEW_NAMES && DS.VIEW_NAMES[s.view]) || s.view || ''));
      this.setT('hShots', s.shots ? '📸 ' + s.shots : '');
      this.warnings(s, d, def, m, lq, linkOk, obD, ob);
      this.banner(s, d);
      E.demoTag.classList.toggle('hidden', !s.demo);
      if (s.demo) this.setT('demoTag', def.kind === 'course' ? '🎬 عرض: المدرب يطير — شوف حركة العصي تحت • ☰ للإيقاف' : '🎬 عرض: المحترف يطير — اضغط ☰ للإيقاف');

      // --- العصي: الكلام + أسماء العصي ---
      const sh = s.stickHint;
      this.setT('stickTxt', (sh && sh.text) || '');
      const m1 = S.stickMode === 1, fpv = air === 'fpv';
      const AL = s.axisLock || NOLOCK;
      const lkL = !!(AL.yaw || (m1 ? AL.pitch : AL.thr)), lkR = !!(AL.roll || (m1 ? AL.thr : AL.pitch));
      const capL = (m1 ? 'يسار: قدام/ورا • لف' : fpv ? 'يسار: الثروتل • لف' : 'يسار: فوق/تحت • لف') + (lkL ? ' 🔒' : '');
      const capR = (m1 ? (fpv ? 'يمين: الثروتل • جنب' : 'يمين: فوق/تحت • جنب') : 'يمين: قدام/ورا • جنب') + (lkR ? ' 🔒' : '');
      if (this.capL && this.last.capL !== capL) { this.last.capL = capL; this.capL.textContent = capL; }
      if (this.capR && this.last.capR !== capR) { this.last.capR = capR; this.capR.textContent = capR; }

      // --- الزوم ---
      const zoom = num(s.zoom, 1), maxZ = Math.max(1.01, profNum(p, ['maxZoom', 'zoomMax'], air === 'fpv' ? 1 : 4));
      if (Math.abs(zoom - this.zoomPrev) > 0.01) { this.zoomPrev = zoom; this.zoomT = 2.5; } else this.zoomT -= tdt;
      const camSeen = this.cam || (R && R.pipRect);
      const zon = !!camSeen && (zoom > 1.02 || this.zoomT > 0) && air !== 'fpv';
      this.cls('zoomInd', zon ? 'on' : '');
      if (zon) { this.setT('zoomVal', zoom.toFixed(1) + '×'); this.sty('zoomFill', 'height', Math.round(clamp((zoom - 1) / (maxZ - 1), 0, 1) * 100) + '%'); }

      // --- القياسات الفنية (VIEW) ---
      this.telT += tdt;
      if (s.showTelem) {
        if (this.last['.telemO'] !== 'on') { this.last['.telemO'] = 'on'; E.telemO.classList.remove('hidden'); }
        if (this.telT > 0.2) { this.telT = 0; this.telem(s, d, R, m, lq, wi); }
      } else if (this.last['.telemO'] !== 'off') { this.last['.telemO'] = 'off'; E.telemO.classList.add('hidden'); }
    },

    // ريح قوية: من سرعة الريح أو لأن الدرون مايل كثير عشان يثبت
    windCheck(s, d, md, wi, lim, tdt) {
      const sp = wi ? wi.speed : 0;
      let lvl = !d.motors || d.onGround ? 0 : sp >= lim ? 2 : sp >= 0.75 * lim ? 1 : 0;
      const c = s.controls || ZERO_C, still = Math.abs(num(c.pitch, 0)) < 0.1 && Math.abs(num(c.roll, 0)) < 0.1;
      const tiltMax = md && md.tilt ? md.tilt * D2R : 0;
      if (tiltMax && still && d.motors && !d.onGround && ATT.tilt > 0.7 * tiltMax) this.tiltT += tdt; else this.tiltT = 0;
      if (this.tiltT > 1.5 && lvl < 1) lvl = 1;
      if (lvl >= this.windLvl) { this.windLvl = lvl; this.windHold = 3; }
      else { this.windHold -= tdt; if (this.windHold <= 0) this.windLvl = lvl; }
    },

    djiStatus(d, m, lq, linkOk, obD) {
      const o = this._st || (this._st = { t: '', k: 'ok' }), B = this.B;
      const atti = m === 'A', pos = atti ? 'ATTI' : (d.gps === false ? 'Vision' : 'GNSS');
      const air = d.motors && !d.onGround;
      const S = (t, k) => { o.t = t; o.k = k; return o; };
      if (d.crashed) return S('الدرون طاح!', 'bad');
      if (!linkOk) return S(d.auto === 'rth' ? 'الإشارة مقطوعة — يرجع للبيت لحاله' : 'الإشارة مقطوعة', 'bad');
      if (d.auto === 'forced') return S('هبوط اضطراري — البطارية خلصت', 'bad');
      if (d.vrs) return S('دوامة المراوح! حركه لقدام', 'bad');
      if (d.auto === 'rth' && d.rthBlocked) return S('الرجوع واقف — عائق قدامه. ألغِ (B) وتحكم', 'bad');
      if (air && obD < 3) return S('عائق قريب جداً!', 'bad');
      if (d.motors && B.soc <= B.crit) return S('البطارية حرجة — هبّط الحين', 'bad');
      if (this.windLvl >= 2 && air) return S('الريح أقوى من الدرون!', 'bad');
      if (d.auto === 'rth') return S('يرجع للبيت (RTH)', 'warn');
      if (air && obD < 8) return S((d.obstacle && d.obstacle.braking ? 'فرمل لحاله — عائق ' : 'فيه عائق — ') + obD.toFixed(1) + ' م', 'warn');
      if (this.windLvl >= 1 && air) return S('ريح قوية — طِر بحذر', 'warn');
      if (d.motors && B.soc <= B.hMark) return S('البطارية تكفي للرجوع بس — ارجع', 'warn');
      if (lq < 30) return S('الإشارة ضعيفة — وجّه الريموت للدرون', 'warn');
      if (d.gps === false && !atti && d.motors) return S('تثبيت بالحساسات (بدون GPS)', 'warn');
      if (d.paused) return S('واقف (Pause) — حرّك العصا تكمل', 'ok');
      if (d.auto === 'land') return S('هبوط تلقائي…', 'ok');
      if (d.auto === 'takeoff') return S('إقلاع تلقائي…', 'ok');
      if (air) return S('طاير (' + pos + ')', atti ? 'warn' : 'ok');
      if (d.motors) return S('المحركات شغالة (' + pos + ')', atti ? 'warn' : 'ok');
      return S('جاهز للطيران (' + pos + ')', atti ? 'warn' : 'ok');
    },

    bfText(s, d, m, label, lq, linkOk, dist, alt, hsp, hx, hz) {
      const B = this.B, c = s.controls || ZERO_C;
      const mode = BF_MODE[m] || String(label || m).toUpperCase().slice(0, 5);
      const thr = Math.round(clamp(has(d.throttle) ? num(d.throttle, 0) : has(c.throttle01) ? num(c.throttle01, 0) : (num(c.thr, 0) + 1) / 2, 0, 1) * 100);
      const v = B.vLp.toFixed(1) + 'V', cv = B.cellV.toFixed(2) + 'V', mah = Math.round(B.mah) + 'MAH';
      const lqs = 'LQ ' + (lq < 10 ? ' ' : '') + Math.round(lq), timer = U.mmss(Math.max(this.armT, num(d.flightTime, 0)));
      const kmh = Math.round(Math.hypot(hsp, d.v.y) * 3.6);
      const homeD = Math.round(dist) + 'M';
      if (this.cam) {
        this.setT('bfTL', lqs + '\n' + mode);
        this.setT('bfTC', timer);
        this.setT('bfL', v + '\n' + cv + '\n' + (has(d.amps) ? num(d.amps, 0).toFixed(1) + 'A\n' : '') + mah);
        this.setT('bfR', 'THR ' + thr + '%\nALT ' + alt.toFixed(1) + 'M\n' + kmh + ' KM/H\nVS ' + (d.v.y >= 0 ? '+' : '') + d.v.y.toFixed(1));
        this.setT('bfHomeD', homeD);
        // سهم البيت بالنسبة لخشم الدرون
        const rel = dist < 2 ? 0 : U.wrap(U.bearing(d.p.x, d.p.z, hx, hz) - d.yaw);
        this.sty('bfArrow', 'transform', 'rotate(' + Math.round(rel * R2D / 5) * 5 + 'deg)');
        // تحذيرات Betaflight (بالإنجليزي مثل الحقيقي)
        let w = '';
        const sinceArm = this.clock - this.armAt;
        if (!d.motors && !d.crashed) w = 'DISARMED';
        else if (d.motors && (sinceArm < 1.5 || d.onGround)) w = 'ARMED';
        if (d.motors && sinceArm < 3 && B.cellV < 4.1 && B.cellV > 0) w += (w ? '\n' : '') + 'BATT < FULL';
        if (!linkOk) w += (w ? '\n' : '') + 'FAILSAFE';
        else if (lq < 10) w += (w ? '\n' : '') + 'RXLOSS';
        const wv = B.warnV > 0 ? B.warnV : B.cellV;
        if (d.motors && wv > 0 && wv < 3.3) w += (w ? '\n' : '') + 'LAND NOW';
        else if (d.motors && wv > 0 && wv < 3.5) w += (w ? '\n' : '') + 'LOW BATTERY';
        if (d.turtle || (d.onGround && !d.crashed && ATT.tilt > 2.2)) w += (w ? '\n' : '') + 'CRASH FLIP';
        this.setT('bfWarn', w);
      } else {
        this.setT('bfBar', lqs + '  ' + mode + '  ' + v + ' ' + cv + '  ' + mah + '  THR ' + thr + '%  ALT ' + Math.round(alt) + 'M  ⌂ ' + homeD + '  ' + timer);
      }
    },

    // الشريط الكبير: عد الرجوع الذكي أو الدرون المقلوب (FPV)
    banner(s, d) {
      const sr = s.smartRth, gf = d.geoFence, F = s.env && s.env.fence;
      let k = '', t = '', sub = '', frac = -1;
      if (sr && sr.active && !d.crashed) {
        const n = Math.max(0, Math.ceil(num(sr.t, 0)));
        k = 'bad'; t = '🔋 البطارية تكفي للرجوع بس'; sub = 'الدرون بيرجع للبيت لحاله بعد ' + n + ' ث — اضغط B' + (this.tv ? ' (أو OK بالريموت)' : '') + ' عشان تلغي';
        frac = clamp(num(sr.t, 0) / Math.max(1, num(sr.dur, 10)), 0, 1);
        if (n !== this.banBeep) { this.banBeep = n; const A = DS.Audio; if (A && A.beep && !this.demo) A.beep(1500, 0.06, 'square', 0.06); }
      } else if (d.turtle && !d.crashed) {
        this.banBeep = -1;
        if (d.flipping) { k = 'info'; t = '🔄 المحركات تلف بالعكس وتقلب الدرون…'; }
        else { k = 'warn'; t = '🐢 الدرون مقلوب (CRASH FLIP)'; sub = 'اضغط A مطوّل عشان تقلبها'; }
      } else if (gf && F && !d.crashed && gf.state >= 2) {
        // منطقة حظر الطيران (مثل DJI GEO)
        this.banBeep = -1; k = 'bad'; t = '⛔ منطقة حظر طيران (' + F.name + ')';
        const fpv = this.air === 'fpv', atti = modeOf(d) === 'A';
        sub = !d.motors && d.onGround ? 'ممنوع الإقلاع هنا — شيل الدرون برا المنطقة'
          : gf.state === 3 ? 'أنت داخل منطقة الحظر — ارجع لورا (عكس المطار) الحين!'
            : fpv ? 'درون FPV ما يوقف لحاله — ارجع لورا!' : atti ? 'ATTI ما يوقف لحاله — ارجع لورا بنفسك' : 'الدرون وقف عند الحد وما يقدر يدخل — ارجع لورا';
      } else if (gf && F && !d.crashed && gf.state === 1 && d.motors) {
        this.banBeep = -1; k = 'warn'; t = '⚠️ تقترب من منطقة ' + (F.short || F.name) + ' — ممنوع الطيران قدام';
        sub = 'باقي ' + kmTxt(gf.d) + ' على منطقة الحظر';
      } else this.banBeep = -1;
      const key = k + '|' + t + '|' + sub;
      if (this.last.ban !== key) {
        this.last.ban = key;
        E.hBan.className = k ? 'on ' + k : '';
        E.hBanT.textContent = U.bidi(t); E.hBanS.textContent = U.bidi(sub); E.hBanS.style.display = sub ? '' : 'none';
        E.hBanB.className = frac >= 0 ? 'bb on' : 'bb';
      }
      if (frac >= 0) this.sty('hBanI', 'width', (frac * 100).toFixed(1) + '%');
    },

    warnings(s, d, def, m, lq, linkOk, obD, ob) {
      const w = this._w || (this._w = []), B = this.B, fpv = this.air === 'fpv';
      w.length = 0;
      if (d.auto === 'rth') w.push(d.rthBlocked ? '<div class="w bad">🧱 الرجوع وقف قدام عائق — الدرون واقف. ألغه (B) وتحكم بيدك: ارفعه أو لف حوله</div>'
        : '<div class="w info">🏠 الرجوع للبيت شغال… (B يلغيه، أو اسحب ' + ((DS.stickName && DS.stickName.pitch) ? DS.stickName.pitch() : 'العصا اليمين') + ' لورا)</div>');
      if (d.auto === 'forced') w.push('<div class="w bad">🪫 هبوط اضطراري — وجّهه لمكان آمن</div>');
      if (d.auto === 'land') w.push('<div class="w info">⬇ هبوط تلقائي…</div>');
      if (d.auto === 'takeoff') w.push('<div class="w info">⬆ إقلاع تلقائي…</div>');
      if (d.paused) w.push('<div class="w info">⏸ الدرون واقف — حرّك أي عصا تكمل</div>');
      if (!linkOk) w.push('<div class="w bad">📵 الإشارة مقطوعة</div>');
      else if (lq < 30) w.push('<div class="w warn">📶 الإشارة ضعيفة (' + Math.round(lq) + '%) — قرّب أو ارتفع</div>');
      if (!fpv && m !== 'A' && d.gps === false && d.motors) w.push('<div class="w warn">📡 ما فيه GPS — الحساسات اللي تحت ماسكته. خلك تحت 30 م وارجع</div>');
      if (!fpv && m === 'A') w.push(d.gps === false ? '<div class="w bad">📡 ما فيه GPS — الدرون ATTI وينجرف مع الريح</div>' : '<div class="w warn">🅰️ وضع ATTI: الدرون ما يثبت لحاله — صحّح أنت</div>');
      if (d.vrs) w.push('<div class="w bad">🌪️ دوامة المراوح! حركه لقدام أو للجنب</div>');
      if (d.motors && !fpv && (B.soc <= B.hMark || B.soc <= 0.3)) w.push('<div class="w ' + (B.soc <= B.crit || B.soc <= 0.15 ? 'bad' : 'warn') + '">🔋 البطارية ' + Math.round(B.soc * 100) + '% — ارجع للبيت</div>');
      if (d.motors && fpv && B.warnV > 0 && B.warnV < 3.5) w.push('<div class="w bad">🔋 البطارية ضعيفة (' + B.cellV.toFixed(2) + 'V للخلية) — نزّل</div>');
      if (ob && obD < 8 && !d.onGround) { const rel = obstacleRel(ob, d); w.push('<div class="w ' + (obD < 3 ? 'bad' : 'warn') + '">🧱 عائق ' + (rel === null ? (ob.dir === 'down' || num(ob.up, 1) < 0 ? 'تحتك' : 'فوقك') : relAr(rel)) + ' — ' + obD.toFixed(1) + ' م</div>'); }
      if (this.windLvl >= 1 && d.motors && !d.onGround) w.push(this.windLvl >= 2 ? '<div class="w bad">🌬️ الريح أقوى من الدرون! نزّل ارتفاعك وارجع</div>' : '<div class="w warn">🌬️ ريح قوية — نزّل شوي وطِر بحذر</div>');
      const F = def.fence === true ? DS.FIELD : (def.fence && has(def.fence.x0) ? def.fence : null);
      if (F && !d.onGround) {
        const m2 = Math.min(d.p.x - F.x0, F.x1 - d.p.x, d.p.z - F.z0, F.z1 - d.p.z);
        if (m2 < 10) w.push('<div class="w bad">🚧 قربت من حدود الساحة!</div>');
      }
      if (def.fence && !d.onGround && d.p.y > (def.maxAlt || 60) - 8) w.push('<div class="w warn">⬆ قربت من أقصى ارتفاع</div>');
      // أكاديمية طويق: حد الارتفاع 120 م + كم باقي على منطقة حظر المطار
      const gf = d.geoFence, GF = s.env && s.env.fence;
      if (gf && GF && d.motors && !d.onGround) {
        const cap = def.maxAlt || 120, alt = d.p.y - num(homeOf(d).y, 0);
        if (alt > cap - 10) w.push('<div class="w ' + (alt > cap - 1.5 ? 'bad' : 'warn') + '">⬆ الحد ' + cap + ' م — أنظمة الطيران المدني (فوق الأرض)</div>');
        if (gf.state === 0) w.push('<div class="w info">🛫 ' + (GF.short || GF.name) + ': منطقة الحظر بعد ' + kmTxt(gf.d) + ' (' + dirName(Math.atan2(-gf.nx, gf.nz) * R2D) + ')</div>');
      }
      if (s.thermalView) w.push('<div class="w info">🌡️ الكاميرا الحرارية شغالة — Y مطوّل يطفيها</div>');
      if (d.onGround && d.motors && !d.airborne && d.auto !== 'takeoff') w.push('<div class="w info">المحركات شغالة — ' + (fpv ? 'ارفع الثروتل' : 'ارفع ' + (DS.settings.stickMode === 1 ? 'العصا اليمين' : 'العصا اليسار')) + ' عشان تقلع</div>');
      if (w.length > 5) w.length = 5;
      this.set('warnBox', w.join(''));
    },

    telem(s, d, R, m, lq, wi) {
      const st = R && typeof R.stats === 'function' ? R.stats() : null;
      const info = R && R.renderer && R.renderer.info && R.renderer.info.render;
      const fps = st && has(st.fps) ? st.fps : this.fps, calls = st && has(st.calls) ? st.calls : info ? info.calls : '-';
      const tris = st && has(st.tris) ? st.tris : info ? info.triangles : 0;
      const f = (v, n) => (typeof v === 'number' ? v.toFixed(n) : '-');
      const w = d.w, mo = d.motor, B = this.B;
      let t = 'FPS ' + Math.round(fps) + '  calls ' + calls + '  tris ' + (typeof tris === 'number' ? (tris / 1000).toFixed(1) + 'k' : '-') + (st && has(st.ms) ? '  ' + f(st.ms, 1) + 'ms' : '') + '\n';
      t += 'POS  ' + f(d.p.x, 1) + ' ' + f(d.p.y, 1) + ' ' + f(d.p.z, 1) + '   yaw ' + Math.round(((d.yaw * R2D) % 360 + 360) % 360) + '°\n';
      t += 'VEL  hs ' + f(Math.hypot(d.v.x, d.v.z), 2) + '  vs ' + f(d.v.y, 2) + '\n';
      t += 'ATT  pitch ' + f(ATT.pitch * R2D, 1) + '  roll ' + f(ATT.roll * R2D, 1) + '  tilt ' + f(ATT.tilt * R2D, 1) + '\n';
      if (w) t += 'RATE ' + f(w.x * R2D, 0) + ' ' + f(w.y * R2D, 0) + ' ' + f(w.z * R2D, 0) + ' °/s\n';
      if (mo && mo.length) t += 'MOT  ' + f(mo[0], 2) + ' ' + f(mo[1], 2) + ' ' + f(mo[2], 2) + ' ' + f(mo[3], 2) + '  thr ' + f(d.throttle, 2) + '\n';
      t += 'BAT  ' + f(B.vLp, 2) + 'V ' + f(B.cellV, 2) + 'V/c ' + (has(d.amps) ? f(d.amps, 1) + 'A ' : '') + Math.round(B.mah) + 'mAh ' + Math.round(B.soc * 100) + '%  left ' + U.mmss(B.tLeft) + '  H ' + Math.round(B.hMark * 100) + '%\n';
      t += 'LINK ' + Math.round(lq) + '%  sats ' + (has(d.sats) ? d.sats : '-') + '  gps ' + (d.gps === false ? 'X' : 'ok') + '  vis ' + (d.vision === false ? 'X' : 'ok') + '\n';
      if (wi) t += 'WIND ' + f(wi.speed, 1) + ' m/s from ' + Math.round(wi.fromDeg) + '°  gust ' + f(this.gust, 1) + '\n';
      t += 'MODE ' + m + '  auto ' + (d.auto || '-') + (d.paused ? '  PAUSE' : '') + '  view ' + s.view + '  zoom ' + f(num(s.zoom, 1), 1);
      E.telemO.textContent = t;
    },

    // ---------- العصي + ظل الحركة المطلوبة ----------
    drawSticks(s, d) {
      const S = DS.settings, c = s.controls || ZERO_C, m1 = S.stickMode === 1;
      const thrY = this.air === 'fpv' && S.fpvThrottle === 'trigger' && has(c.throttle01) ? 2 * num(c.throttle01, 0) - 1 : num(c.thr, 0);
      const h = s.stickHint;
      let hL = h ? h.L : null, hR = h ? h.R : null;
      // الدروس تكتب الظل على Mode 2 (اليسار = الارتفاع). في Mode 1 نبدّل المحور الطولي بين العصاتين
      if (m1 && h && !h.physical && (hL || hR)) {
        const L = typeof hL === 'string' ? HINT_DIR[hL] || null : hL, R = typeof hR === 'string' ? HINT_DIR[hR] || null : hR;
        const lx = L ? num(L.x, 0) : 0, ly = L ? num(L.y, 0) : 0, rx = R ? num(R.x, 0) : 0, ry = R ? num(R.y, 0) : 0;
        HL.x = lx; HL.y = ry; HR.x = rx; HR.y = ly;
        const both = !!(L && R);
        hL = both || lx || ry ? HL : null; hR = both || rx || ly ? HR : null;
      }
      // العصي المقفولة (session.axisLock) تطلع رمادية
      const L = s.axisLock || NOLOCK;
      this.stick(E.stL, this.g.stL, num(c.yaw, 0), m1 ? num(c.pitch, 0) : thrY, hL, !!L.yaw, !!(m1 ? L.pitch : L.thr));
      this.stick(E.stR, this.g.stR, num(c.roll, 0), m1 ? thrY : num(c.pitch, 0), hR, !!L.roll, !!(m1 ? L.thr : L.pitch));
    },
    rrPath(g, C, r) {   // مربع بزوايا مدورة (إطار العصا)
      g.beginPath(); g.moveTo(C - r + 12, C - r); g.arcTo(C + r, C - r, C + r, C + r, 12); g.arcTo(C + r, C + r, C - r, C + r, 12);
      g.arcTo(C - r, C + r, C - r, C - r, 12); g.arcTo(C - r, C - r, C + r, C - r, 12); g.closePath();
    },
    // قفل صغير (مرسوم، بدون إيموجي عشان التلفزيون)
    lockIcon(g, x, y, s) {
      g.fillStyle = '#cbd5e1'; g.strokeStyle = '#cbd5e1'; g.lineWidth = 1.6 * s;
      g.beginPath(); g.arc(x, y - 2 * s, 3.2 * s, Math.PI, 0); g.stroke();
      g.fillRect(x - 4.6 * s, y - 2 * s, 9.2 * s, 7 * s);
    },
    stick(cv, g, x, y, hint, lockX, lockY) {
      if (!g) return;
      const k = fit(cv, 104, 104, 2.5), W = 104, C = 52, r = 46, tr = r * 0.82;
      g.setTransform(k, 0, 0, k, 0, 0);
      g.clearRect(0, 0, W, W);
      // مربع حركة العصا (العصي توصل للزوايا)
      g.fillStyle = 'rgba(10,16,24,0.6)'; g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1;
      this.rrPath(g, C, r); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(C, C - r + 6); g.lineTo(C, C + r - 6); g.moveTo(C - r + 6, C); g.lineTo(C + r - 6, C); g.stroke();
      const kx = C + clamp(x, -1, 1) * tr, ky = C - clamp(y, -1, 1) * tr;
      if (lockX || lockY) {   // المنطقة المقفولة رمادية: يبقى بس الممر اللي يشتغل
        const ch = 9, x0 = C - r, w = 2 * r;
        g.save(); this.rrPath(g, C, r); g.clip();
        g.fillStyle = 'rgba(71,85,105,0.82)';
        if (lockX && lockY) { g.fillRect(x0, x0, w, w); this.lockIcon(g, C, C - r + 16, 1.5); this.lockIcon(g, C, C + r - 14, 1.5); }
        else if (lockY) { g.fillRect(x0, x0, w, r - ch); g.fillRect(x0, C + ch, w, r - ch); this.lockIcon(g, C, C - r + 13, 1.1); this.lockIcon(g, C, C + r - 15, 1.1); }
        else { g.fillRect(x0, x0, r - ch, w); g.fillRect(C + ch, x0, r - ch, w); this.lockIcon(g, C - r + 13, C, 1.1); this.lockIcon(g, C + r - 13, C, 1.1); }
        g.restore();
      }
      if (hint) {
        if (typeof hint === 'string') hint = HINT_DIR[hint] || null;
        if (hint) {
          const tx = C + clamp(num(hint.x, 0), -1, 1) * tr, ty = C - clamp(num(hint.y, 0), -1, 1) * tr;
          const dx = tx - kx, dy = ty - ky, dd = Math.sqrt(dx * dx + dy * dy), near = dd < 0.15 * tr;
          const a = 0.55 + 0.35 * Math.sin(this.clock * 6);
          g.globalAlpha = near ? 0.95 : a;
          g.strokeStyle = near ? '#4ade80' : '#fde047'; g.lineWidth = 3;
          g.setLineDash(DASH); g.beginPath(); g.arc(tx, ty, 11, 0, TAU); g.stroke(); g.setLineDash(NODASH);
          if (!near && dd > 30) {   // سهم من العصا للمكان المطلوب
            const ux = dx / dd, uy = dy / dd, ex = tx - ux * 13, ey = ty - uy * 13;
            g.lineWidth = 2.5; g.beginPath(); g.moveTo(kx + ux * 10, ky + uy * 10); g.lineTo(ex, ey); g.stroke();
            g.fillStyle = '#fde047'; g.beginPath(); g.moveTo(ex + ux * 6, ey + uy * 6); g.lineTo(ex - uy * 5 - ux * 3, ey + ux * 5 - uy * 3); g.lineTo(ex + uy * 5 - ux * 3, ey - ux * 5 - uy * 3); g.closePath(); g.fill();
          }
          g.globalAlpha = 1;
        }
      }
      const dead = (lockX && Math.abs(x) > 0.1) || (lockY && Math.abs(y) > 0.1) || (lockX && lockY);
      g.fillStyle = dead ? '#94a3b8' : '#fff'; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2;
      g.beginPath(); g.arc(kx, ky, 8, 0, TAU); g.fill(); g.stroke();
    },

    // ---------- كرة الميلان (DJI): الأفق + البيت + الطيار + العوائق ----------
    drawAtt(s, d) {
      const g = this.g.att; if (!g) return;
      const k = fit(E.att, 84, 84, 2.5), W = 84, C = 42, r = 40;
      g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, W, W);
      g.save();
      g.beginPath(); g.arc(C, C, r, 0, TAU); g.clip();
      g.fillStyle = 'rgba(15,23,42,0.6)'; g.fillRect(0, 0, W, W);
      g.translate(C, C); g.rotate(-ATT.roll);
      const off = clamp(ATT.pitch / (Math.PI / 2), -1, 1) * r;
      g.fillStyle = 'rgba(56,189,248,0.38)'; g.fillRect(-2 * r, off, 4 * r, 3 * r);
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-r, off); g.lineTo(r, off); g.stroke();
      g.restore();
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.5; g.beginPath(); g.arc(C, C, r - 0.5, 0, TAU); g.stroke();
      // الشمال على الإطار
      let a = -d.yaw;
      g.fillStyle = '#fff'; g.font = 'bold 9px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('N', C + Math.sin(a) * (r - 7), C - Math.cos(a) * (r - 7));
      // البيت والطيار (الاتجاه بالنسبة لخشم الدرون، والمسافة لوغاريتمية)
      const h = homeOf(d), P = DS.PILOT || ZERO_C;
      this.attDot(g, C, r, d, num(h.x, 0), num(h.z, 0), 'H');
      this.attDot(g, C, r, d, num(P.x, 0), num(P.z, 6), null);
      // العائق
      const ob = d.obstacle;
      if (ob && num(ob.dist, 99) < 12) {
        const rel = obstacleRel(ob, d);
        if (rel !== null) {
          const od = num(ob.dist, 99);
          g.strokeStyle = od < 3 ? '#ef4444' : '#facc15'; g.lineWidth = 4;
          g.beginPath(); g.arc(C, C, r - 4, rel - Math.PI / 2 - 0.45, rel - Math.PI / 2 + 0.45); g.stroke();
        }
      }
      // الدرون (سهم أحمر لفوق = خشمه)
      g.fillStyle = '#ff4040'; g.strokeStyle = '#fff'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(C, C - 9); g.lineTo(C + 6, C + 6); g.lineTo(C, C + 2.5); g.lineTo(C - 6, C + 6); g.closePath(); g.fill(); g.stroke();
    },
    attDot(g, C, r, d, x, z, label) {
      const dx = x - d.p.x, dz = z - d.p.z, dist = Math.sqrt(dx * dx + dz * dz);
      const rel = Math.atan2(dx, -dz) - d.yaw, rr = r * 0.82 * Math.min(1, Math.log(1 + dist / 5) / Math.log(101));
      const px = C + Math.sin(rel) * rr, py = C - Math.cos(rel) * rr;
      if (label) { g.fillStyle = '#facc15'; g.font = 'bold 11px Arial'; g.fillText(label, px, py); }
      else { g.fillStyle = '#60a5fa'; g.beginPath(); g.arc(px, py, 3, 0, TAU); g.fill(); }
    },

    // ---------- الرسم في نص الشاشة: Betaflight + رادار العوائق + الهدف ----------
    drawCenter(s, d, R) {
      const g = this.g.osd, cam = this.cam, task = s.task;
      const bf = cam && this.fl['osd-bf'];
      const ob = d.obstacle, obD = ob ? num(ob.dist, 99) : 99;
      const radar = cam && this.fl['osd-dji'] && obD < 12 && !d.onGround;
      const ret = cam && task && task.reticle;
      const on = !!g && !!(bf || radar || ret);
      this.flag('cv', on);
      if (!on) return;
      const cw = this.vw * 0.64, ch = this.vh * 0.72;
      const k = fit(E.osdC, cw, ch, 1.5);
      g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, cw, ch);
      const cx = cw / 2, cy = ch / 2, S = DS.settings;
      const vfov = R && R.cam && R.cam.fov ? R.cam.fov : (this.air === 'fpv' ? num(S.fpvFov, 100) : 43 / Math.max(1, num(s.zoom, 1)));
      const f = (this.vh / 2) / Math.tan(vfov * D2R / 2);   // بكسل لكل راديان قرب النص
      g.lineCap = 'round';
      if (bf) {
        // المؤشر في النص
        g.beginPath();
        g.moveTo(cx - 20, cy); g.lineTo(cx - 7, cy); g.moveTo(cx + 7, cy); g.lineTo(cx + 20, cy); g.moveTo(cx, cy - 7); g.lineTo(cx, cy - 14);
        this.stroke2(g, 2);
        // الأفق الصناعي (ميلان الدرون نفسه، بدون زاوية الكاميرا)
        const L = Math.min(cw * 0.42, this.vw * 0.17), gap = 34;
        const off = clamp(f * Math.tan(clamp(ATT.pitch, -1.45, 1.45)), -ch * 0.42, ch * 0.42);
        g.save(); g.translate(cx, cy); g.rotate(-ATT.roll); g.translate(0, off);
        g.setLineDash(AH_DASH);
        g.beginPath(); g.moveTo(-L, 0); g.lineTo(-gap, 0); g.moveTo(gap, 0); g.lineTo(L, 0);
        this.stroke2(g, 2.5);
        g.setLineDash(NODASH);
        g.restore();
        // الأعمدة الجانبية
        const sb = Math.min(cw * 0.46, this.vw * 0.2), sh = 70;
        g.beginPath();
        g.moveTo(cx - sb + 8, cy - sh); g.lineTo(cx - sb, cy - sh); g.lineTo(cx - sb, cy + sh); g.lineTo(cx - sb + 8, cy + sh); g.moveTo(cx - sb, cy); g.lineTo(cx - sb + 12, cy);
        g.moveTo(cx + sb - 8, cy - sh); g.lineTo(cx + sb, cy - sh); g.lineTo(cx + sb, cy + sh); g.lineTo(cx + sb - 8, cy + sh); g.moveTo(cx + sb, cy); g.lineTo(cx + sb - 12, cy);
        this.stroke2(g, 2);
      }
      if (radar) {
        const rel = obstacleRel(ob, d);
        if (rel !== null) {
          const n = obD < 2.5 ? 3 : obD < 5 ? 2 : 1, col = obD < 3 ? '#ef4444' : obD < 6 ? '#f59e0b' : '#facc15';
          const base = Math.min(ch * 0.3, this.vh * 0.2), a0 = rel - Math.PI / 2;
          g.lineWidth = 6;
          for (let i = 0; i < 3; i++) {
            g.strokeStyle = i < n ? col : 'rgba(255,255,255,0.18)';
            g.beginPath(); g.arc(cx, cy, base - i * 11, a0 - 0.38 + i * 0.04, a0 + 0.38 - i * 0.04); g.stroke();
          }
          g.fillStyle = col; g.font = 'bold 18px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'ltr';
          const ov = Math.round(obD * 10);
          if (ov !== this.obTxtV) { this.obTxtV = ov; this.obTxt = (ov / 10).toFixed(1) + ' m'; }
          g.fillText(this.obTxt, cx + Math.cos(a0) * (base + 22), cy + Math.sin(a0) * (base + 22));
        }
      }
      if (ret) {
        const rt = task.reticle, deg = typeof rt === 'number' ? rt : num(rt.deg, num(rt.angle, 5));
        const rr = Math.max(10, f * Math.tan(clamp(deg, 0.2, 60) * D2R));
        const ok = typeof rt === 'object' && (rt.ok || rt.in);
        g.beginPath(); g.arc(cx, cy, rr, 0, TAU);
        g.moveTo(cx - rr - 12, cy); g.lineTo(cx - rr + 6, cy); g.moveTo(cx + rr - 6, cy); g.lineTo(cx + rr + 12, cy);
        g.moveTo(cx, cy - rr - 12); g.lineTo(cx, cy - rr + 6); g.moveTo(cx, cy + rr - 6); g.lineTo(cx, cy + rr + 12);
        this.stroke2(g, 2, ok ? '#4ade80' : '#fff');
        g.fillStyle = ok ? '#4ade80' : '#fff'; g.beginPath(); g.arc(cx, cy, 2, 0, TAU); g.fill();
        if (typeof rt === 'object' && rt.label) { g.font = 'bold 15px Tahoma'; g.textAlign = 'center'; g.textBaseline = 'top'; g.direction = 'rtl'; g.fillText(rt.label, cx, cy + rr + 16); }
      }
    },
    // خط أبيض بحد أسود (ستايل OSD)
    stroke2(g, w, col) {
      g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = w + 2.5; g.stroke();
      g.strokeStyle = col || '#fff'; g.lineWidth = w; g.stroke();
    },

    // ---------- الخريطة الصغيرة ----------
    worldMap() {
      const Wd = DS.World;
      if (!Wd || this.lastWm === Wd) return this.wm;
      this.lastWm = Wd;
      const wm = this.wm = { zones: [], roads: [], segs: [], pylons: [], towers: [], buildings: Wd.buildings || [] };
      const pt = (p, i) => (Array.isArray(p) ? p[i] : i === 0 ? p.x : p.z);
      const addZone = (z, key) => {
        if (!z || typeof z !== 'object') return;
        key = z.id || z.key || key || '';
        if (key === 'field') return;   // الساحة نرسمها من DS.FIELD
        const o = { key, name: z.name || z.title || ZONE_AR[key] || '', x0: 0, z0: 0, x1: 0, z1: 0, r: 0, cx: 0, cz: 0 };
        const q = z.rect && typeof z.rect === 'object' ? z.rect : z;
        if (has(q.x0) && has(q.x1)) { o.x0 = q.x0; o.x1 = q.x1; o.z0 = q.z0; o.z1 = q.z1; }
        else {
          const cx = num(q.cx, num(q.x, 0)), cz = num(q.cz, num(q.z, 0));
          const w = num(q.w, num(q.size, num(q.sx, num(q.width, 0)))), dd = num(q.d, num(q.sz, num(q.depth, num(q.size, w))));
          if (!w && q.r) o.r = q.r;
          o.x0 = cx - w / 2; o.x1 = cx + w / 2; o.z0 = cz - dd / 2; o.z1 = cz + dd / 2;
        }
        o.cx = (o.x0 + o.x1) / 2; o.cz = (o.z0 + o.z1) / 2;
        if (o.r) { o.x0 = o.cx - o.r; o.x1 = o.cx + o.r; o.z0 = o.cz - o.r; o.z1 = o.cz + o.r; }
        if (o.x1 > o.x0 || o.r) wm.zones.push(o);
      };
      try {
        const zs = Wd.zones;
        if (Array.isArray(zs)) zs.forEach(z => addZone(z));
        else if (zs && typeof zs === 'object') Object.keys(zs).forEach(k => addZone(zs[k], k));
        (Wd.roads || []).forEach(rd => {
          const pts = rd && (rd.pts || rd.points || (Array.isArray(rd) ? rd : null));
          if (!pts || pts.length < 2) return;
          const a = new Float32Array(pts.length * 2);
          for (let i = 0; i < pts.length; i++) { a[i * 2] = pt(pts[i], 0); a[i * 2 + 1] = pt(pts[i], 1); }
          wm.roads.push({ a, closed: !!(rd.closed || rd.loop), w: num(rd.w, num(rd.width, 7)) });
        });
        const segs = [], pyl = [];
        (Wd.powerlines || []).forEach(pl => {
          if (!pl) return;
          const pts = pl.pts || pl.points || pl.pylons;
          if (pts && pts.length) {
            for (let i = 0; i < pts.length; i++) {
              pyl.push(pt(pts[i], 0), pt(pts[i], 1));
              if (i > 0) segs.push(pt(pts[i - 1], 0), pt(pts[i - 1], 1), pt(pts[i], 0), pt(pts[i], 1));
            }
          } else if (has(pl.x1)) segs.push(pl.x1, pl.z1, pl.x2, pl.z2);
        });
        if (!segs.length) (Wd.colliders || []).forEach(c => { if (c && c.type === 'wire') segs.push(c.x1, c.z1, c.x2, c.z2); });
        wm.segs = new Float32Array(segs); wm.pylons = new Float32Array(pyl);
        const tw = [];
        (Wd.towers || []).forEach(t => { if (t && has(t.x)) tw.push(t.x, t.z); });
        wm.towers = new Float32Array(tw);
      } catch (e) { this.err('worldMap', e); }
      return wm;
    },

    drawMap(s, d, dt) {
      const g = this.g.mini; if (!g) return;
      const Wc = this.miniCss, k = fit(E.mini, Wc, Wc, 2.5), half = Wc / 2;
      const def = s.def || {}, h = homeOf(d), hx = num(h.x, 0), hz = num(h.z, 0);
      const dh = Math.hypot(d.p.x - hx, d.p.z - hz);
      const tgt = num(def.mapRange, clamp(Math.max(130, dh * 2.3), 130, 800));
      this.mapRange += (tgt - this.mapRange) * Math.min(1, dt * 1.5);
      const range = this.mapRange, sc = Wc / range, vr = range * 0.75;
      const off = s.mapOffset, cx = d.p.x + (off ? num(off.x, 0) : 0), cz = d.p.z + (off ? num(off.z, 0) : 0);
      const ox = half - cx * sc, oz = half - cz * sc;   // شاشة = o + عالم * sc
      g.setTransform(k, 0, 0, k, 0, 0);
      g.clearRect(0, 0, Wc, Wc);
      g.save(); g.beginPath(); g.arc(half, half, half - 2, 0, TAU); g.clip();
      g.fillStyle = 'rgba(16,28,22,0.84)'; g.fillRect(0, 0, Wc, Wc);
      // أكاديمية طويق: خريطتها الخاصة (المباني والطرق + منطقة حظر المطار) بدل عالم المحاكي
      const tw = (def.zone === 'tuwaiq' && DS.TUWAIQ) ? DS.TUWAIQ : null;
      if (tw) { try { this.drawTw(g, tw, s, d, ox, oz, sc, cx, cz, vr, half); } catch (e) { this.err('mapTw', e); } }
      const wm = tw ? null : this.worldMap();
      if (wm) {
        // المناطق
        g.lineWidth = 1;
        for (let i = 0; i < wm.zones.length; i++) {
          const z = wm.zones[i];
          if (z.x1 < cx - vr || z.x0 > cx + vr || z.z1 < cz - vr || z.z0 > cz + vr) continue;
          g.fillStyle = ZONE_COL[z.key] || 'rgba(255,255,255,0.07)'; g.strokeStyle = 'rgba(255,255,255,0.35)';
          if (z.r) { g.beginPath(); g.arc(ox + z.cx * sc, oz + z.cz * sc, z.r * sc, 0, TAU); g.fill(); g.stroke(); }
          else { g.fillRect(ox + z.x0 * sc, oz + z.z0 * sc, (z.x1 - z.x0) * sc, (z.z1 - z.z0) * sc); g.strokeRect(ox + z.x0 * sc, oz + z.z0 * sc, (z.x1 - z.x0) * sc, (z.z1 - z.z0) * sc); }
        }
      }
      // ساحة التدريب
      const F = tw ? null : DS.FIELD;
      if (F) {
        g.fillStyle = 'rgba(90,140,70,0.35)'; g.fillRect(ox + F.x0 * sc, oz + F.z0 * sc, (F.x1 - F.x0) * sc, (F.z1 - F.z0) * sc);
        g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5; g.strokeRect(ox + F.x0 * sc, oz + F.z0 * sc, (F.x1 - F.x0) * sc, (F.z1 - F.z0) * sc);
      }
      if (wm) {
        // الطرق
        g.strokeStyle = 'rgba(75,85,99,0.95)'; g.lineJoin = 'round';
        for (let i = 0; i < wm.roads.length; i++) {
          const rd = wm.roads[i], a = rd.a;
          g.lineWidth = Math.max(2, rd.w * sc);
          g.beginPath(); g.moveTo(ox + a[0] * sc, oz + a[1] * sc);
          for (let j = 2; j < a.length; j += 2) g.lineTo(ox + a[j] * sc, oz + a[j + 1] * sc);
          if (rd.closed) g.closePath();
          g.stroke();
        }
        // المباني
        g.fillStyle = 'rgba(148,163,184,0.75)';
        const bs = wm.buildings;
        for (let i = 0; i < bs.length; i++) {
          const b = bs[i];
          if (!b || Math.abs(b.x - cx) > vr + 40 || Math.abs(b.z - cz) > vr + 40) continue;
          const bw = num(b.w, 10) * sc, bd = num(b.d, 10) * sc, rot = num(b.yaw, num(b.rot, 0));
          if (rot) { g.save(); g.translate(ox + b.x * sc, oz + b.z * sc); g.rotate(rot); g.fillRect(-bw / 2, -bd / 2, bw, bd); g.restore(); }
          else g.fillRect(ox + b.x * sc - bw / 2, oz + b.z * sc - bd / 2, bw, bd);
        }
        // أسلاك الكهرباء والأبراج
        const sg = wm.segs;
        if (sg.length) {
          g.strokeStyle = 'rgba(249,115,22,0.85)'; g.lineWidth = 1.5; g.beginPath();
          for (let j = 0; j < sg.length; j += 4) { g.moveTo(ox + sg[j] * sc, oz + sg[j + 1] * sc); g.lineTo(ox + sg[j + 2] * sc, oz + sg[j + 3] * sc); }
          g.stroke();
        }
        const py = wm.pylons;
        g.fillStyle = '#fb923c';
        for (let j = 0; j < py.length; j += 2) {
          if (Math.abs(py[j] - cx) > vr || Math.abs(py[j + 1] - cz) > vr) continue;
          g.fillRect(ox + py[j] * sc - 2, oz + py[j + 1] * sc - 2, 4, 4);
        }
        const tw = wm.towers;
        g.fillStyle = '#ef4444';
        for (let j = 0; j < tw.length; j += 2) {
          if (Math.abs(tw[j] - cx) > vr || Math.abs(tw[j + 1] - cz) > vr) continue;
          const tx = ox + tw[j] * sc, ty = oz + tw[j + 1] * sc;
          g.beginPath(); g.moveTo(tx, ty - 6); g.lineTo(tx + 5, ty + 4); g.lineTo(tx - 5, ty + 4); g.closePath(); g.fill();
        }
      }
      // عناصر المهمة (نحدثها 20 مرة بالثانية بس)
      this.mapT += dt;
      if (this.mapT > 0.05) {
        this.mapT = 0;
        try { this.mapItems = s.task && typeof s.task.map === 'function' ? s.task.map() : null; } catch (e) { this.mapItems = null; this.err('task.map', e); }
      }
      const items = this.mapItems;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it || !has(it.x)) continue;
          const x = ox + it.x * sc, y = oz + num(it.z, 0) * sc, kd = it.kind;
          const c = it.state === 'done' || it.state === 'in' ? '#22c55e' : it.state === 'idle' ? '#94a3b8' : it.state === 'bad' ? '#ef4444' : '#22d3ee';
          g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 2;
          if (kd === 'pond') { g.globalAlpha = 0.6; g.fillStyle = '#2b7bb9'; g.beginPath(); g.arc(x, y, num(it.r, 5) * sc, 0, TAU); g.fill(); g.globalAlpha = 1; }
          else if (kd === 'tower') { const rr = num(it.r, 3) * sc; g.fillStyle = '#9aa3ad'; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
          else if (kd === 'zone' || kd === 'orbit' || kd === 'pad' || kd === 'area' || kd === 'circle') {
            if (has(it.w) && has(it.d)) g.strokeRect(x - it.w * sc / 2, y - it.d * sc / 2, it.w * sc, it.d * sc);
            else { g.beginPath(); g.arc(x, y, Math.max(3, num(it.r, 2) * sc), 0, TAU); g.stroke(); }
          } else if (kd === 'gate' && has(it.yaw)) {
            const hw = Math.max(3, num(it.w, 2) * sc / 2), ca = Math.cos(it.yaw), sa = Math.sin(it.yaw);
            g.lineWidth = 3; g.beginPath(); g.moveTo(x - ca * hw, y - sa * hw); g.lineTo(x + ca * hw, y + sa * hw); g.stroke();
          } else if (kd === 'heli' || kd === 'bird' || kd === 'people' || kd === 'person' || kd === 'vehicle' || kd === 'car' || kd === 'boat') {
            g.font = '15px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(kd === 'heli' ? '🚁' : kd === 'bird' ? '🦅' : kd === 'vehicle' || kd === 'car' ? '🚗' : kd === 'boat' ? '🚤' : '🚶', x, y);
          } else if (kd === 'pylon') { g.fillStyle = '#f97316'; g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill(); }
          else {
            g.beginPath(); g.arc(x, y, it.state === 'next' ? 6 : 4, 0, TAU); g.fill();
            if (has(it.label) && it.label !== '' && it.state === 'next') { g.fillStyle = '#fff'; g.font = 'bold 11px Tahoma'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(it.label, x, y - 10); }
          }
        }
      }
      // البيت والطيار
      g.fillStyle = '#facc15'; g.font = 'bold 13px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('H', ox + hx * sc, oz + hz * sc);
      const P = DS.PILOT;
      if (P) { g.fillStyle = '#60a5fa'; g.beginPath(); g.arc(ox + P.x * sc, oz + P.z * sc, 3.5, 0, TAU); g.fill(); }
      // الدرون (سهم وجهه)
      g.save(); g.translate(ox + d.p.x * sc, oz + d.p.z * sc); g.rotate(d.yaw);
      g.fillStyle = '#ff4040'; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 7); g.lineTo(0, 3); g.lineTo(-7, 7); g.closePath(); g.fill(); g.stroke();
      g.restore();
      g.restore();
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = 'bold 12px Arial'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText('N', half, 13);
      const rr = Math.round(range / 10) * 10;
      if (rr !== this.rangeR) { this.rangeR = rr; this.rangeTxt = rr + ' م'; }
      g.font = '10px Tahoma'; g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillText(this.rangeTxt, half, Wc - 8);
    },

    // خريطة طويق الصغيرة: منطقة التحذير (برتقالي) + الحظر (أحمر) + المدارج + الطرق + المباني (OSM) + سهم على الحافة لو المنطقة بعيدة
    drawTw(g, tw, s, d, ox, oz, sc, cx, cz, vr, half) {
      const Fz = tw.fence, gf = d.geoFence || (this._twq = Fz.query(cx, cz, this._twq));
      if (gf.dWarn < vr * 1.6) {
        this.twPath(g, Fz.outline('warn'), true, ox, oz, sc); g.fillStyle = 'rgba(249,115,22,0.22)'; g.fill();
        g.strokeStyle = 'rgba(251,146,60,0.95)'; g.lineWidth = 2; g.setLineDash(DASH); g.stroke(); g.setLineDash(NODASH);
      }
      if (gf.d < vr * 1.6) {
        this.twPath(g, Fz.outline('nfz'), true, ox, oz, sc); g.fillStyle = 'rgba(239,68,68,0.33)'; g.fill();
        g.strokeStyle = 'rgba(248,113,113,1)'; g.lineWidth = 2.5; g.stroke();
        g.strokeStyle = 'rgba(30,30,34,0.95)'; g.lineCap = 'butt';
        const RW = tw.runways;
        for (let i = 0; i < RW.length; i++) { const r = RW[i]; g.lineWidth = Math.max(2, r.w * sc); g.beginPath(); g.moveTo(ox + r.ax * sc, oz + r.az * sc); g.lineTo(ox + r.bx * sc, oz + r.bz * sc); g.stroke(); }
      }
      // الطرق والمباني (قريب بس)
      g.strokeStyle = 'rgba(75,85,99,0.95)'; g.lineJoin = 'round';
      const RD = tw.roads, BL = tw.buildings;
      for (let i = 0; i < RD.length; i++) { g.lineWidth = Math.max(2, RD[i].w * sc); this.twPath(g, RD[i].p, false, ox, oz, sc); g.stroke(); }
      const bx = cx - vr - 60, bX = cx + vr + 60, bz = cz - vr - 60, bZ = cz + vr + 60;
      for (let i = 0; i < BL.length; i++) {
        const b = BL[i], P = b.p; if (P[0] < bx || P[0] > bX || P[1] < bz || P[1] > bZ) continue;
        this.twPath(g, P, true, ox, oz, sc); g.fillStyle = b.academy ? 'rgba(56,189,248,0.85)' : 'rgba(148,163,184,0.75)'; g.fill();
      }
      const A = tw.academy;
      if (A && this.mapRange < 400) { g.fillStyle = '#e0f2fe'; g.font = 'bold 11px Tahoma'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('طويق', ox + A.cx * sc, oz + (A.cz + 38) * sc); }
      // منطقة الحظر برا الخريطة: سهم أحمر على الحافة + المسافة
      if (gf.d > vr * 0.85) {
        const ux = -gf.nx, uz = -gf.nz, rr = half - 13, x = half + ux * rr, y = half + uz * rr, a = Math.atan2(uz, ux);
        g.save(); g.translate(x, y); g.rotate(a);
        g.fillStyle = gf.dWarn > 0 ? '#ef4444' : '#f97316'; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(9, 0); g.lineTo(-5, -6); g.lineTo(-5, 6); g.closePath(); g.fill(); g.stroke();
        g.restore();
        g.font = 'bold 10px Tahoma'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fecaca';
        const dk = Math.round(gf.d / 100);
        if (dk !== this._twDk) { this._twDk = dk; this._twDt = '⛔ ' + kmTxt(gf.d); }
        g.fillText(this._twDt, half + ux * (rr - 22), half + uz * (rr - 22) + 1);
      }
    },

    twPath(g, P, close, ox, oz, sc) {
      g.beginPath(); g.moveTo(ox + P[0] * sc, oz + P[1] * sc);
      for (let k = 2; k < P.length; k += 2) g.lineTo(ox + P[k] * sc, oz + P[k + 1] * sc);
      if (close) g.closePath();
    },

    // ---------- دائرة المساعدة حول الدرون (عين الطيار) ----------
    marker(s, d, R) {
      const el = E.marker, S = DS.settings, def = s.def || {}, mk = this.mk;
      const aidsOn = S.visualAid !== false && def.aids !== 'none' && S.aids !== 'off' && S.aids !== 'none' &&
        !(def.kind === 'exam' && !has(def.aids) && (S.aids === 'auto' || !has(S.aids)));
      let p = null, dist = 0;
      if (aidsOn && R && R.project && s.view === 'pilot' && !d.crashed) {
        const P = DS.PILOT || ZERO_C;
        dist = Math.hypot(d.p.x - num(P.x, 0), d.p.y - 1.7, d.p.z - num(P.z, 6));
        if (dist >= 12) p = R.project(d);
      }
      if (!p) { if (mk.on) { mk.on = false; el.classList.add('hidden'); } return; }
      if (!mk.on) { mk.on = true; el.classList.remove('hidden'); }
      const x = Math.round(p.x - 22), y = Math.round(p.y - 22);
      if (x !== mk.x || y !== mk.y) { mk.x = x; mk.y = y; el.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }
      const dm = Math.round(dist);
      if (dm !== mk.dm) { mk.dm = dm; el.firstElementChild.textContent = dm + ' م'; }
    },

    // ---------- إطار الشاشة الصغيرة + الهدف داخلها ----------
    pip(s, R) {
      const pf = E.pipFrame, pr = R && R.pipRect, L = this._pp;
      const px = pr ? pr.x : -1, py = pr ? pr.y : -1, pw = pr ? pr.w : -1, ph = pr ? pr.h : -1;
      if (this.pipDirty || L[0] !== px || L[1] !== py || L[2] !== pw || L[3] !== ph || this._ppv !== s.view) {
        this.pipDirty = false; L[0] = px; L[1] = py; L[2] = pw; L[3] = ph; this._ppv = s.view;
        if (pr) {
          pf.classList.remove('hidden');
          pf.style.left = pr.x + 'px'; pf.style.bottom = pr.y + 'px'; pf.style.width = pr.w + 'px'; pf.style.height = pr.h + 'px';
          E.pipLabel.textContent = CAM_VIEWS[s.view] ? 'عين الطيار' : 'كاميرا الدرون';
        } else pf.classList.add('hidden');
      }
      // الهدف في الشاشة الصغيرة لما تكون هي اللي فيها كاميرا الدرون
      const rt = pr && !CAM_VIEWS[s.view] && s.task ? s.task.reticle : null;
      if (rt) {
        const fov = R.pipCam && R.pipCam.fov ? R.pipCam.fov : 43;
        const deg = typeof rt === 'number' ? rt : num(rt.deg, num(rt.angle, 5));
        const size = Math.round(2 * Math.max(5, (pr.h / 2) / Math.tan(fov * D2R / 2) * Math.tan(clamp(deg, 0.2, 60) * D2R)));
        this.cls('pipRet', typeof rt === 'object' && (rt.ok || rt.in) ? 'on in' : 'on');
        if (this.last.pipRetS !== size) {
          this.last.pipRetS = size; const st = E.pipRet.style;
          st.width = st.height = size + 'px'; st.marginLeft = st.marginTop = (-size / 2 - 2) + 'px';
        }
      } else this.cls('pipRet', '');
    }
  };

  HUD.init();
  DS.applyTvMode = () => HUD.applyTv();
})();
