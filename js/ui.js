// القوائم والشاشات v2: الكورس التعليمي، التدريب الاحترافي، الطيران الحر، الإعدادات، شرح الأزرار، النتيجة
// تشتغل بيد التحكم (إكس بوكس/بلايستيشن) وريموت التلفزيون (الأسهم + OK + رجوع) والكيبورد والماوس
(function () {
  const DS = window.DS, U = DS.U;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  DS.esc = esc;
  const has = v => v !== undefined && v !== null;
  const isFn = f => typeof f === 'function';
  const tryf = (f, d) => { try { return f(); } catch (e) { console.warn('UI:', e); return d; } };
  const stars = n => '★'.repeat(n) + '<span class="dim">' + '★'.repeat(3 - n) + '</span>';
  const MEDAL = { gold: ['🥇', 'ذهبية'], silver: ['🥈', 'فضية'], bronze: ['🥉', 'برونزية'] };
  const toast = (t, k) => { if (DS.HUD && DS.HUD.toast) DS.HUD.toast(t, k); };
  const click = () => { if (DS.Audio && DS.Audio.click) DS.Audio.click(); };
  const DIRS = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
  const KEYDIR = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT' };
  const CODEDIR = { 38: 'UP', 40: 'DOWN', 37: 'LEFT', 39: 'RIGHT' };
  // الشاشات اللي ترجع للزر اللي كنت عليه لما ترجع لها
  const MEMO = { main: 1, course: 1, unit: 1, pro: 1, proLevel: 1, legacy: 1, lessons: 1, missions: 1, scenarios: 1, exams: 1, settings: 1, free: 1, records: 1 };

  const UI = DS.UI = {
    cur: null, focused: null, screens: {}, mem: {},
    init() {
      this.root = $('ui');
      document.addEventListener('keydown', e => this.onKey(e));
      this.root.addEventListener('mousemove', e => { const b = e.target.closest('.btn'); if (b && b !== this.focused && !b.disabled) this.focus(b, true); });
    },
    show(name, arg) {
      let mk = this.screens[name];
      if (!mk) { console.warn('UI: ما فيه شاشة ' + name); name = 'main'; mk = this.screens.main; }
      const prev = this.cur ? this.cur.name : null;
      if (prev && prev !== name && this.focused && this.focused.dataset.act && this.focused.dataset.act !== 'back') this.mem[prev] = this.focused.dataset.act + '|' + (this.focused.dataset.arg || '');
      let sc;
      try { sc = mk(arg); } catch (e) { console.error('UI.' + name, e); sc = errScreen(e); }
      this.root.className = 'ui ' + (sc.overlay ? 'overlay' : 'full');
      this.root.innerHTML = '<div class="screen ' + (sc.cls || '') + '">' + (U.bidiHtml ? U.bidiHtml(sc.html) : sc.html) + '</div>';   // كلمات إنجليزية وسط العربي ما تتلخبط
      this.cur = Object.assign({ name, arg }, sc);
      this.focused = null;
      this.root.querySelectorAll('[data-act]').forEach(b => {
        b.addEventListener('click', () => {
          if (document.activeElement === b) b.blur();   // ما نخلي الزر ماسك فوكس المتصفح (Space ما يضغطه مرتين)
          click();
          const f = sc.acts && sc.acts[b.dataset.act];
          if (f) { try { f(b.dataset.arg, b); } catch (e) { console.error(e); toast('صار خطأ: ' + (e.message || e), 'bad'); } }
        });
      });
      if (sc.bind) tryf(() => sc.bind(this.root));
      this.root.scrollTop = 0;
      let first = null;
      const key = prev !== name && MEMO[name] ? this.mem[name] : null;
      if (key) {
        const i = key.indexOf('|'), a = key.slice(0, i), g = key.slice(i + 1);
        first = this.focusables().find(b => b.dataset.act === a && (b.dataset.arg || '') === g) || null;
      }
      first = first || this.root.querySelector('.btn.default:not([disabled])') || this.focusables()[0];
      if (first) this.focus(first, !!sc.keepTop && !key);
    },
    hide() { this.root.className = 'ui hidden'; this.root.innerHTML = ''; this.cur = null; this.focused = null; },
    refresh() {
      if (!this.cur) return;
      const f = this.focusables().indexOf(this.focused), st = this.root.scrollTop;
      this.show(this.cur.name, this.cur.arg);
      const fs = this.focusables();
      this.root.scrollTop = st;
      if (fs[f]) this.focus(fs[f]);
    },
    focusables() { return Array.from(this.root.querySelectorAll('.btn')).filter(b => !b.disabled && b.offsetParent !== null); },
    focus(el, noScroll) {
      if (this.focused) this.focused.classList.remove('focus');
      this.focused = el; el.classList.add('focus');
      if (!noScroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
    move(dir) {
      const fs = this.focusables(); if (!fs.length) return;
      if (!this.focused || !fs.includes(this.focused)) return this.focus(fs[0]);
      const a = this.focused.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
      let best = null, bs = 1e9;
      for (const b of fs) {
        if (b === this.focused) continue;
        const r = b.getBoundingClientRect(), bx = r.left + r.width / 2, by = r.top + r.height / 2;
        const dx = bx - ax, dy = by - ay;
        let main, side;
        if (dir === 'UP') { if (dy > -4) continue; main = -dy; side = Math.abs(dx); }
        else if (dir === 'DOWN') { if (dy < 4) continue; main = dy; side = Math.abs(dx); }
        else if (dir === 'LEFT') { if (dx > -4) continue; main = -dx; side = Math.abs(dy); }
        else { if (dx < 4) continue; main = dx; side = Math.abs(dy); }
        const sc = main + side * 2.2;
        if (sc < bs) { bs = sc; best = b; }
      }
      if (best) { this.focus(best); click(); return; }
      // ما فيه زر بهالاتجاه: نمرر الصفحة (للشاشات الطويلة مثل الشرح)
      const sc = this.cur && this.cur.overlay ? this.root.querySelector('.screen') : this.root;
      if (sc && (dir === 'UP' || dir === 'DOWN')) sc.scrollTop += (dir === 'UP' ? -1 : 1) * Math.round(sc.clientHeight * 0.4);
    },
    activate() { if (this.focused) this.focused.click(); },
    back() { if (this.cur && this.cur.back) { click(); this.cur.back(); } },
    // زر الرجوع حق التلفزيون: true = تصرفنا • false = القائمة الرئيسية (التطبيق يطلع)
    backAction() {
      const c = this.cur;
      if (!c) return false;
      if (c.name === 'main' || c.name === 'title') return false;
      this.back();
      return true;
    },
    poll(I) {
      const c = this.cur;
      if (!c || c.capture) return;
      if (!c.noNav) for (const d of DIRS) if (I.nav[d]) this.move(d);
      const p = I.pressed;
      if (p.A) this.activate();
      else if (p.B) this.back();
      for (const k of ['X', 'Y', 'LB', 'RB', 'START', 'VIEW']) if (p[k] && this.cur && this.cur.onButton) this.cur.onButton(k);
    },
    // كل فريم (للشاشات الحية: المعايرة والتوزيع وحالة اليد)
    tick(dt) {
      const c = this.cur;
      if (c && c.tick) { try { c.tick(dt); } catch (e) { if (!c._te) { c._te = 1; console.warn('UI.tick', e); } } }
    },
    onKey(e) {
      const c = this.cur;
      if (!c) return;
      const tg = e.target;
      if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName || ''))) return;   // تكتب بخانة نص: الأسهم و Backspace للنص مو للقائمة
      const k = e.code, key = e.key;
      const isBack = k === 'Escape' || k === 'Backspace' || key === 'GoBack' || key === 'BrowserBack' || e.keyCode === 10009;
      if (c.capture && !isBack) return;
      const dir = KEYDIR[k] || KEYDIR[key] || (!k ? CODEDIR[e.keyCode] : null);
      if (dir) { e.preventDefault(); if (!c.noNav) this.move(dir); }
      else if (k === 'Enter' || k === 'NumpadEnter' || key === 'Enter' || (!k && e.keyCode === 13)) { e.preventDefault(); if (!e.repeat) this.activate(); }
      else if (isBack) { e.preventDefault(); if (!e.repeat) this.back(); }
      else if (/^Digit[1-4]$/.test(k) && c.onDigit) c.onDigit(+k.slice(5) - 1);
      else if (k === 'KeyF' && c.onButton) c.onButton('Y');
      else if ((k === 'PageUp' || k === 'Comma') && c.onButton) c.onButton('LB');
      else if ((k === 'PageDown' || k === 'Period') && c.onButton) c.onButton('RB');
    }
  };

  // ---------------- قطع مشتركة ----------------
  const card = (act, arg, icon, title, desc, extra, cls) =>
    '<button class="btn card ' + (cls || '') + '" data-act="' + act + '" data-arg="' + esc(arg) + '"><span class="ic">' + icon + '</span><span class="tt">' + esc(title) + '</span><span class="ds">' + esc(desc || '') + '</span>' + (extra || '') + '</button>';
  const head = (title, sub) => '<div class="head"><h2>' + title + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>';
  const backBtn = (label) => '<div class="row"><button class="btn" data-act="back">' + (label || '↩ رجوع (B)') + '</button></div>';
  // جوال/تابلت بدون يد: نشرح اللمس بدل أزرار اليد
  const touchDev = () => !!(DS.Touch && DS.Touch.dev);
  const touchNoPad = () => touchDev() && !(DS.Input && DS.Input.connected);
  const navHint = () => touchNoPad() ? '<p class="navhint">👆 المس أي زر عشان تختاره • اسحب الصفحة لفوق وتحت عشان تشوف الباقي</p>'
    : '<p class="navhint">🎮 العصا أو الأسهم = تتنقل • A أو OK أو Enter = اختيار • B أو رجوع أو Esc = رجوع</p>';
  // قبل الطيران: B بالطيران مو "رجوع" — الإيقاف بزر ☰
  const isTv = () => !!(document.body && document.body.classList.contains('tv'));
  const flyHint = () => touchNoPad() ? '<p class="navhint">⏸ وقت الطيران: زر ☰ فوق يسار الشاشة = إيقاف وقائمة • B مطوّل = الدرون يرجع للبيت (مو رجوع)</p>'
    : '<p class="navhint">⏸ وقت الطيران: ☰ (Start)' + (isTv() ? ' أو رجوع بالريموت' : '') + ' أو Esc = إيقاف وقائمة • B مطوّل هناك = الدرون يرجع للبيت (مو رجوع)</p>';
  const pbar = f => '<span class="pbar"><i style="width:' + Math.round(U.clamp(+f || 0, 0, 1) * 100) + '%"></i></span>';
  const medalTxt = m => (MEDAL[m] ? MEDAL[m][0] : '');
  const listHtml = (arr, tag, cls) => (Array.isArray(arr) && arr.length) ? '<' + tag + ' class="' + (cls || 'rules') + '">' + arr.map(x => '<li>' + esc(x) + '</li>').join('') + '</' + tag + '>' : '';
  // أسماء العصي في نصوص الدروس: {T} الارتفاع، {P} قدام/ورا، {Y} اللف، {R} الجنب، {M} الحركة (Mode 1/2)
  const SNM = { 2: { T: 'العصا اليسار', P: 'العصا اليمين', Y: 'العصا اليسار', R: 'العصا اليمين', M: 'العصا اليمين' }, 1: { T: 'العصا اليمين', P: 'العصا اليسار', Y: 'العصا اليسار', R: 'العصا اليمين', M: 'العصاتين' } };
  const ct = v => {
    if (!has(v)) return '';
    const s = String(v);
    if (s.indexOf('{') < 0) return s;
    if (isFn(DS.courseText)) { try { return DS.courseText(s); } catch (e) { /* */ } }
    const N = SNM[DS.settings && DS.settings.stickMode === 1 ? 1 : 2];
    return s.replace(/\{([TPYRM])\}/g, (_, c) => N[c]);
  };
  const ctl = arr => (Array.isArray(arr) ? arr.map(ct) : arr);
  const fmtT = s => { if (!(s >= 0)) return '—'; if (s < 60) return s.toFixed(1) + ' ث'; const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); };
  const nativeCount = () => { try { const NP = window.NativePad; return NP && isFn(NP.count) ? +NP.count() : -1; } catch (e) { return -1; } };
  const canExit = () => !!((window.DS_NATIVE && isFn(window.DS_NATIVE.exit)) || (window.NativePad && isFn(window.NativePad.exit)));
  const PAIR_HTML = '<div class="tipbox warnbox"><b>🔗 طريقة ربط اليد بالتلفزيون:</b><br>إعدادات التلفزيون ← <bdi>Remotes &amp; Accessories</bdi> ← <bdi>Add accessory</bdi><br>' +
    '• إكس بوكس: شغّلها بزر Xbox، وبعدين اضغط زر الربط الصغير فوق 3 ثواني لين يرمش بسرعة<br>• بلايستيشن 5: اضغط <bdi>Create</bdi> + زر <bdi>PS</bdi> مع بعض لين يرمش النور • بلايستيشن 4: <bdi>Share + PS</bdi></div>';
  DS.PAIR_TEXT = '🎮 ما فيه يد متصلة: إعدادات التلفزيون ← ⁨Remotes & Accessories⁩ ← ⁨Add accessory⁩ • إكس بوكس: زر الربط 3 ثواني • بلايستيشن: ⁨Create + PS⁩';

  const padLine = () => {
    const I = DS.Input;
    if (I.connected) {
      let s = '<span class="ok">🎮 اليد متصلة: ' + esc(String(I.name || '').slice(0, 40)) + '</span>';
      if (I.needsRemap) s += ' <span class="warn">• اليد مو قياسية: سوّ «توزيع الأزرار» من الإعدادات</span>';
      else if (I.driftWarn) s += ' <span class="warn">• العصا تتحرك لحالها: سوّ «معايرة العصي» من الإعدادات</span>';
      if (I.padCount > 1) s += ' <span class="warn">• فيه أكثر من يد — اضغط زر في اليد اللي تبيها</span>';
      return s;
    }
    if (nativeCount() === 0) return '<span class="warn">🎮 ما فيه يد متصلة بالتلفزيون — شوف طريقة الربط</span>';
    if (window.NativePad || document.body.classList.contains('tv')) return '<span class="warn">🎮 اضغط أي زر في اليد عشان يشوفها التطبيق</span>';
    if (touchDev()) return '<span class="ok">📱 تطير بالعصي اللي على الشاشة</span> <small>(أو وصّل يد إكس بوكس / بلايستيشن بالبلوتوث واضغط أي زر فيها)</small>';
    return '<span class="warn">🎮 اضغط أي زر في اليد عشان يشوفها المتصفح</span> <small>(الكيبورد يمشي للقوائم والطيران الحر، بس الدروس أحسن بيد تحكم — Shift مع الزر = نص العصا)</small>';
  };
  // الجوال: اليد تشتغل مع المتصفح على طول (Gamepad API في كروم أندرويد وسفاري آيفون)
  const PHONE_PAD = '<div class="tipbox phonepad">🎮 <b>عندك يد إكس بوكس أو بلايستيشن؟</b> وصّلها بالجوال بالبلوتوث (كروم بالأندرويد أو سفاري بالآيفون) واضغط أي زر فيها — تشتغل على طول، وأزرار اللمس تختفي لحالها.</div>';
  // 🔇 كروم ما يشغّل الصوت لين تضغط كيبورد أو ماوس مرة (أزرار اليد ما تكفي)
  const needSnd = () => !!((DS.Audio && typeof DS.Audio.needsGesture === 'function' && tryf(() => DS.Audio.needsGesture(), false)) ||
    (DS.Voice && typeof DS.Voice.needsGesture === 'function' && DS.settings && DS.settings.voice !== false && tryf(() => DS.Voice.needsGesture(), false)));
  const SND_TXT0 = '🔇 للصوت: اضغط Enter أو انقر بالماوس مرة وحدة';
  const SND_TV = '🔇 للصوت: اضغط OK في الريموت أو A في اليد';
  const SND_TOUCH = '🔇 للصوت: المس الشاشة مرة وحدة';
  let SND_TXT = SND_TXT0;
  const sndLine = () => { SND_TXT = (window.NativePad || document.body.classList.contains('tv')) ? SND_TV : touchDev() ? SND_TOUCH : SND_TXT0; return '<p class="hint snd" id="sndHint"' + (needSnd() ? '>' + SND_TXT : ' style="display:none">') + '</p>'; };
  // 📲 التثبيت على الجوال (PWA): زر في أندرويد (beforeinstallprompt) • شرح في الآيفون
  const installHtml = () => {
    const P = DS.PWA;
    if (!P) return '';
    if (tryf(() => P.canInstall(), false)) return '<button class="btn inst" data-act="install">📲 ثبّت على الجوال <small>(يصير مثل التطبيق ويشتغل بدون نت)</small></button>';
    if (tryf(() => P.iosHint(), false)) return '<p class="hint inst">📲 تبي تثبّته على الآيفون؟ اضغط <b>شارك</b> <bdi>⬆️</bdi> ← <b>أضف للشاشة الرئيسية</b></p>';
    return '';
  };
  const doInstall = () => { if (!(DS.PWA && DS.PWA.install && DS.PWA.install())) toast('التثبيت مو متاح هنا — افتح الموقع بكروم في الجوال', 'info'); };
  // 📍 أكاديمية طويق — خريطة حقيقية ثلاثية الأبعاد (geo3d.js + config.js). إذا لسا ما جهزت: «قريب»
  const TW_TITLE = 'أكاديمية طويق — خريطة حقيقية <bdi dir="ltr">3D</bdi>';   // HTML («3D» ما ينقلب D3 وسط العربي)
  const twOk = () => !!DS.TUWAIQ && !DS.app.no3d;
  const geoStatus = () => {
    const G = DS.Geo3D;
    if (!G) return '';
    if (!G.status && isFn(G.available)) tryf(() => G.available(), false);   // يكتب السبب (مثلاً: يحتاج رابط مو ملف) قبل لا تطير
    let s = tryf(() => (isFn(G.status) ? G.status() : G.status), '');
    if (s && typeof s === 'object') s = s.text || s.msg || s.label || s.state || '';
    return s ? String(s).slice(0, 160) : '';
  };
  const geoTick = (o, dt) => {
    o._g = (o._g || 0) + dt; if (o._g < 0.5) return; o._g = 0;
    const el = $('geoSt'); if (!el) return;
    const t = geoStatus(); if (t !== el.textContent) { el.textContent = t; el.style.display = t ? '' : 'none'; }
  };
  const startTuwaiq = () => {
    if (!twOk()) { toast('خريطة أكاديمية طويق قريب — لسا قاعدين نجهزها', 'info'); return; }
    const S0 = DS.settings, o = S0.freeOpts || {};
    DS.app.startFree({ airframe: o.airframe || S0.airframe || 'mini', zone: 'tuwaiq', timeOfDay: o.timeOfDay || 'day', wind: o.wind || 'light' });
  };
  const sndTick = () => { const el = $('sndHint'); if (!el) return; const on = needSnd(); if (on !== (el.style.display !== 'none')) { el.style.display = on ? '' : 'none'; el.textContent = on ? SND_TXT : ''; } };
  function errScreen(e) {
    return {
      cls: 'menu', html: head('⚠️ صار خطأ في هالشاشة', esc(String(e && e.message || e))) + '<p class="desc">جرّب ترجع وتفتحها مرة ثانية. لو تكرر، هذا الجزء لسا قاعد يتجهز.</p>' + backBtn('🏠 القائمة الرئيسية'),
      acts: { back: () => UI.show('main') }, back: () => UI.show('main')
    };
  }
  const soon = (title, back, text) => ({
    cls: 'menu',
    html: head(title, '') + '<div class="soon"><div class="ic">🛠️</div><p>' + esc(text || 'هذا القسم قاعد يتجهز… ارجع له بعد التحديث الجاي') + '</p></div>' + backBtn(),
    acts: { back: () => UI.show(back || 'main') }, back: () => UI.show(back || 'main')
  });

  // ---------------- الكورس والاحترافي (من course.js و content_pro.js) ----------------
  const hasCourse = () => isFn(DS.courseState) && isFn(DS.courseDef);
  const hasPro = () => isFn(DS.proState) && isFn(DS.proDef);
  function courseSum() {
    if (!hasCourse()) return null;
    const st = tryf(() => DS.courseState(), null);
    if (!Array.isArray(st) || !st.length) return null;
    let done = 0, total = 0;
    const seq = [];
    st.forEach(u => {
      (u.lessons || []).forEach(l => { total++; if (l.done) done++; seq.push({ u, l }); });
      if (u.check) { total++; if (u.check.done) done++; seq.push({ u, l: u.check, check: true }); }
    });
    let next = tryf(() => (isFn(DS.courseNext) ? DS.courseNext() : null), null);
    if (!next) { const f = seq.find(x => !x.l.done && !x.l.locked); next = f ? f.l.id : null; }
    const find = id => seq.find(x => x.l.id === id) || null;
    const nf = next ? find(next) : null;
    return { st, seq, done, total, next, nextTitle: nf ? ct(nf.l.title) : '', nextUnit: nf ? nf.u : null, find };
  }
  const unlockAll = () => !!(DS.settings && DS.settings.unlockAll);
  function proSum() {
    if (!hasPro()) return null;
    const st = tryf(() => DS.proState(), null);
    if (!Array.isArray(st) || !st.length) return null;
    const seq = [], med = { gold: 0, silver: 0, bronze: 0 };
    st.forEach(L => (L.exercises || []).forEach(e => { seq.push({ L, e }); if (med[e.medal] !== undefined) med[e.medal]++; }));
    return { st, seq, med, find: id => seq.find(x => x.e.id === id) || null };
  }
  const medTxt = m => (m.gold ? '🥇' + m.gold + ' ' : '') + (m.silver ? '🥈' + m.silver + ' ' : '') + (m.bronze ? '🥉' + m.bronze : '');
  // مساعدات التنقل (main.js يستخدمها للزر "الجاي")
  UI.course = {
    sum: courseSum,
    after(id) {
      const cs = courseSum(); if (!cs) return null;
      const i = cs.seq.findIndex(x => x.l.id === id), n = cs.seq[i + 1];
      return i >= 0 && n && (!n.l.locked || unlockAll()) ? n.l.id : null;
    },
    open(id) {
      const cs = courseSum(), f = cs && cs.find(id);
      if (f && f.l.locked && !unlockAll()) { toast('🔒 هذا مقفول: خلّص اللي قبله أول (أو «افتح كل شي» من الإعدادات)', 'info'); return; }
      UI.show('lesson', id);
    }
  };
  UI.pro = {
    sum: proSum,
    after(id) {
      const ps = proSum(); if (!ps) return null;
      const i = ps.seq.findIndex(x => x.e.id === id), n = ps.seq[i + 1];
      return i >= 0 && n && (!n.e.locked || unlockAll()) ? n.e.id : null;
    },
    open(id) {
      const ps = proSum(), f = ps && ps.find(id);
      if (f && f.e.locked && !unlockAll()) { toast('🔒 هذا التمرين مقفول: خلّص اللي قبله', 'info'); return; }
      UI.show('proBrief', id);
    }
  };

  // ---------------- رسمة العصاتين مع الأسهم (Mode 2؛ تنقلب تلقائياً لـ Mode 1) ----------------
  const AXL = { thr: ['يطلع', 'ينزل', 'الارتفاع'], yaw: ['يلف يسار', 'يلف يمين', 'اللف حول نفسها'], pitch: ['قدام', 'ورا', 'قدام وورا'], roll: ['يسار', 'يمين', 'يمين ويسار'] };
  let dgN = 0;
  function parseStick(s) {
    const o = { h: [], v: [], d: [], c: false, o: false };
    if (!has(s) || s === false) return o;
    (Array.isArray(s) ? s : [s]).forEach(it => {
      if (it && typeof it === 'object') {
        const x = +it.x || 0, y = +it.y || 0, ax = Math.abs(x), ay = Math.abs(y);
        if (ax < 0.15 && ay < 0.15) o.c = true;
        else if (ax < 0.15) o.v.push(y > 0 ? 'up' : 'down');
        else if (ay < 0.15) o.h.push(x > 0 ? 'right' : 'left');
        else o.d.push({ x: x > 0 ? 1 : -1, y: y > 0 ? 1 : -1 });
        return;
      }
      const t = String(it).toLowerCase().replace(/[\s_]/g, '-');
      if (/^(center|centre|none|hold|neutral|mid|still)$/.test(t)) o.c = true;
      else if (/circle|round|any|all|rotate|spin/.test(t)) o.o = true;
      else if (/^(updown|up-down|vertical|ud)$/.test(t)) o.v.push('up', 'down');
      else if (/^(leftright|left-right|horizontal|lr)$/.test(t)) o.h.push('left', 'right');
      else {
        const u = /up/.test(t), dn = /down/.test(t), l = /left/.test(t), r = /right/.test(t);
        if ((u || dn) && (l || r)) o.d.push({ x: r ? 1 : -1, y: u ? 1 : -1 });
        else if (u) o.v.push('up'); else if (dn) o.v.push('down'); else if (l) o.h.push('left'); else if (r) o.h.push('right');
      }
    });
    return o;
  }
  function diagram(dg) {
    const m1 = DS.settings && +DS.settings.stickMode === 1;
    const L = parseStick(dg && dg.L), R = parseStick(dg && dg.R);
    if (m1) {   // Mode 1: قدام/ورا يسار والارتفاع يمين
      [L, R].forEach(s => { s.d.forEach(d => { s.h.push(d.x > 0 ? 'right' : 'left'); s.v.push(d.y > 0 ? 'up' : 'down'); }); s.d = []; });
      const lv = L.v; L.v = R.v; R.v = lv;
      const anyC = L.c || R.c;
      L.c = anyC && !L.h.length && !L.v.length && !L.o; R.c = anyC && !R.h.length && !R.v.length && !R.o;
    }
    const n = ++dgN, mk = 'ah' + n;
    return '<svg class="sdg" viewBox="0 0 540 250" role="img" aria-label="رسمة العصي"><defs><marker id="' + mk + '" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#38bdf8"/></marker></defs>' +
      stickSvg(140, L, 'العصا اليسار', m1 ? 'pitch' : 'thr', 'yaw', mk) + stickSvg(400, R, 'العصا اليمين', m1 ? 'thr' : 'pitch', 'roll', mk) + '</svg>';
  }
  function stickSvg(cx, s, name, va, ha, mk) {
    const cy = 100, R = 60, f = v => Math.round(v * 10) / 10;
    const onD = d => (s.v.indexOf(d) >= 0 || s.h.indexOf(d) >= 0 || s.d.some(q => (d === 'up' && q.y > 0) || (d === 'down' && q.y < 0) || (d === 'left' && q.x < 0) || (d === 'right' && q.x > 0))) ? ' on' : '';
    let g = '<circle class="gb" cx="' + cx + '" cy="' + cy + '" r="' + R + '"/><line class="gx" x1="' + cx + '" y1="' + (cy - R + 6) + '" x2="' + cx + '" y2="' + (cy + R - 6) + '"/><line class="gx" x1="' + (cx - R + 6) + '" y1="' + cy + '" x2="' + (cx + R - 6) + '" y2="' + cy + '"/>';
    g += '<text class="' + onD('up').trim() + '" x="' + cx + '" y="' + (cy - R - 10) + '" text-anchor="middle">' + AXL[va][0] + '</text>';
    g += '<text class="' + onD('down').trim() + '" x="' + cx + '" y="' + (cy + R + 22) + '" text-anchor="middle">' + AXL[va][1] + '</text>';
    g += '<text class="' + onD('left').trim() + '" x="' + (cx - R - 9) + '" y="' + (cy + 5) + '" text-anchor="end">' + AXL[ha][0] + '</text>';
    g += '<text class="' + onD('right').trim() + '" x="' + (cx + R + 9) + '" y="' + (cy + 5) + '" text-anchor="start">' + AXL[ha][1] + '</text>';
    const vec = [];
    s.v.forEach(d => vec.push([0, d === 'up' ? -1 : 1]));
    s.h.forEach(d => vec.push([d === 'right' ? 1 : -1, 0]));
    s.d.forEach(d => vec.push([d.x * 0.7071, -d.y * 0.7071]));
    vec.forEach(v => { g += '<line class="ar" x1="' + cx + '" y1="' + cy + '" x2="' + f(cx + v[0] * R * 0.74) + '" y2="' + f(cy + v[1] * R * 0.74) + '" marker-end="url(#' + mk + ')"/>'; });
    if (s.o) g += '<path class="ar" d="M' + f(cx + R * 0.7) + ',' + cy + ' A' + f(R * 0.7) + ',' + f(R * 0.7) + ' 0 1,1 ' + f(cx + R * 0.7 * Math.cos(-0.5)) + ',' + f(cy + R * 0.7 * Math.sin(-0.5)) + '" marker-end="url(#' + mk + ')"/>';
    if (vec.length === 1) g += '<circle class="kg" cx="' + f(cx + vec[0][0] * R * 0.62) + '" cy="' + f(cy + vec[0][1] * R * 0.62) + '" r="15"/>';
    g += '<circle class="' + (s.c ? 'kc' : 'kn') + '" cx="' + cx + '" cy="' + cy + '" r="' + (s.c ? 17 : 13) + '"/>';
    if (s.c) g += '<text class="mid" x="' + cx + '" y="' + (cy + 36) + '" text-anchor="middle">خلها بالنص</text>';
    g += '<text class="cap" x="' + cx + '" y="' + (cy + R + 50) + '" text-anchor="middle">' + name + '</text>';
    g += '<text class="axn" direction="rtl" x="' + cx + '" y="' + (cy + R + 72) + '" text-anchor="middle">↕ ' + AXL[va][2] + '   ↔ ' + AXL[ha][2] + '</text>';
    return g;
  }
  DS.stickDiagram = diagram;

  const S = UI.screens;

  // ---------------- البداية ----------------
  S.title = () => ({
    cls: 'title',
    html: '<div class="logo">🚁</div><h1>محاكي الدرون</h1><p class="lead">كورس يعلّمك الطيران خطوة بخطوة • تدريب احترافي • مهام • طوارئ • اختبار نظري</p>' +
      '<p id="padStatus">' + padLine() + '</p><button class="btn big default" data-act="go">ابدأ ▶ <small>' + (touchNoPad() ? '' : '(A أو OK أو Enter)') + '</small></button>' +
      '<div id="instRow" class="instrow">' + installHtml() + '</div>' +
      (nativeCount() === 0 ? PAIR_HTML : '') + (touchDev() ? PHONE_PAD : '') +
      sndLine() + (DS.app.no3d ? '<p class="bad">⚠️ الرسم ثلاثي الأبعاد ما اشتغل (يحتاج نت أول مرة أو ملف lib/three.min.js). الاختبار النظري يشتغل عادي.</p>' : ''),
    acts: { go: () => UI.show('main'), install: doInstall },
    tick(dt) { this._t = (this._t || 0) + dt; if (this._t > 0.5) { this._t = 0; const el = $('padStatus'); if (el) el.innerHTML = padLine(); sndTick(); } }
  });

  // ---------------- القائمة الرئيسية ----------------
  S.main = () => {
    const no3d = DS.app.no3d, cs = courseSum(), ps = proSum(), th = (DS.theoryStats && tryf(() => DS.theoryStats(), '')) || '';
    let hero;
    if (cs) {
      const lbl = cs.next ? (cs.done ? '▶ كمّل: ' : '▶ ابدأ أول درس: ') + cs.nextTitle : '🗺️ خلّصت الكورس 🎉 — عيد أي درس';
      hero = '<div class="hero"><div class="htx"><span class="tag">⭐ ابدأ من هنا</span><h3>🎓 الكورس التعليمي</h3>' +
        '<p>من الصفر: وش يسوي كل زر، كيف تقلع وتثبت وتلف وتمشي، لين تطير زي المحترفين. كل درس: شرح ← المدرب يوريك ← أنت تطير.</p>' +
        pbar(cs.done / Math.max(1, cs.total)) + '<small>' + cs.done + ' من ' + cs.total + ' درس واختبار</small></div>' +
        '<div class="hbtns"><button class="btn big default" data-act="cnext">' + esc(lbl) + '</button><button class="btn" data-act="go" data-arg="course">🗺️ خريطة الكورس (كل الوحدات)</button></div></div>';
    } else {
      hero = '<div class="hero"><div class="htx"><span class="tag">⭐ ابدأ من هنا</span><h3>🎓 الكورس التعليمي</h3><p>الكورس الجديد قاعد يتجهز… لين يجهز ابدأ بـ «دروس المبتدئ».</p></div>' +
        '<div class="hbtns"><button class="btn big default" data-act="go" data-arg="lessons">🎓 دروس المبتدئ</button><button class="btn" data-act="go" data-arg="course">🗺️ خريطة الكورس</button></div></div>';
    }
    const off = no3d ? 'off' : '';
    return {
      cls: 'menu',
      html: head('القائمة الرئيسية', padLine()) + sndLine() + hero + '<div class="grid">' +
        card('go', 'pro', '🏅', 'التدريب الاحترافي', 'خمس مستويات: مبتدئ ← متوسط ← متقدم ← محترف ← خبير (FPV)', ps && (ps.med.gold + ps.med.silver + ps.med.bronze) ? '<span class="badge">' + medTxt(ps.med) + '</span>' : '', off) +
        card('go', 'legacy', '🎯', 'المهام والدروس القديمة', 'دروس المبتدئ + 12 مهمة بأربع درجات', '', off) +
        card('go', 'scenarios', '⚠️', 'سيناريوهات الطوارئ', 'وش تسوي لو صار كذا؟ عيشها بنفسك', '', off) +
        card('go', 'exams', '🏆', 'اختبارات عملية', 'أساسي • متقدم • احترافي — مثل اختبار الطيران', '', off) +
        card('go', 'free', '🕊️', 'الطيران الحر', 'Mini أو FPV • الساحة، المدينة، الحلبة، الصحراء • نهار أو ليل', '', off) +
        twCard() +
        card('theory', '', '📘', 'الاختبار النظري', '60 سؤال في 60 دقيقة مثل الحقيقي + تدريب ومصطلحات', th ? '<span class="badge">' + esc(th) + '</span>' : '') +
        card('go', 'help', '🎮', 'شرح اليد والأزرار', 'وش يسوي كل زر: إكس بوكس، بلايستيشن، كيبورد') +
        card('go', 'settings', '⚙️', 'الإعدادات', 'التحكم والمعايرة • الطيران • الشاشة • الصوت') +
        card('go', 'records', '📊', 'سجلي', 'نتايجك وتقدمك ووقت الطيران') +
        (tryf(() => DS.PWA && DS.PWA.canInstall(), false) ? card('install', '', '📲', 'ثبّت على الجوال', 'يصير مثل التطبيق: أيقونة بالشاشة وملء الشاشة ويشتغل بدون نت') : '') +
        (canExit() ? card('exit', '', '🚪', 'خروج', 'سكّر التطبيق') : '') +
        '</div>' + navHint(),
      acts: {
        cnext: () => { const c = courseSum(); if (c && c.next) UI.course.open(c.next); else UI.show('course'); },
        theory: () => UI.show('theoryHome'),
        go: a => UI.show(a, a === 'settings' ? { from: 'main' } : undefined),
        tuwaiq: startTuwaiq, install: doInstall,
        exit: () => DS.app.exit && DS.app.exit()
      },
      back: () => UI.show('title'),
      tick(dt) { this._t = (this._t || 0) + dt; if (this._t > 1) { this._t = 0; const p = UI.root.querySelector('.head p'); if (p) p.innerHTML = padLine(); } if (((this._s = (this._s || 0) + dt)) > 0.5) { this._s = 0; sndTick(); } geoTick(this, dt); }
    };
  };
  // بطاقة أكاديمية طويق بالقائمة الرئيسية (مقفولة «قريب» لين تجهز الخريطة)
  function twCard() {
    const st = geoStatus();
    if (!twOk()) {
      return '<button class="btn card tw off" disabled><span class="ic">📍</span><span class="tt">' + TW_TITLE + '</span><span class="ds">' +
        (DS.app.no3d ? 'يحتاج الرسم ثلاثي الأبعاد' : 'طِر فوق المكان الحقيقي — قاعدين نجهزه') + '</span><span class="badge">قريب</span></button>';
    }
    return '<button class="btn card tw" data-act="tuwaiq" data-arg=""><span class="ic">📍</span><span class="tt">' + TW_TITLE + '</span>' +
      '<span class="ds">طيران حر فوق مكان الأكاديمية الحقيقي (خرائط قوقل ثلاثية الأبعاد) — يحتاج نت</span>' +
      '<span class="ds geo" id="geoSt"' + (st ? '' : ' style="display:none"') + '>' + esc(st) + '</span><span class="badge">جديد</span></button>';
  }

  // ---------------- خريطة الكورس ----------------
  S.course = () => {
    const cs = courseSum();
    if (!cs) return soon('🎓 الكورس التعليمي', 'main', 'الكورس قاعد يتجهز… لين يجهز جرّب «المهام والدروس القديمة» من القائمة.');
    const units = cs.st.map(u => {
      const ls = u.lessons || [], n = ls.length + (u.check ? 1 : 0), d = ls.filter(l => l.done).length + (u.check && u.check.done ? 1 : 0);
      const lock = u.locked && !unlockAll();
      const badge = lock ? '<span class="badge">🔒</span>' : u.done ? '<span class="badge ok">✓ خلصت</span>' : (d ? '<span class="badge">' + d + '/' + n + '</span>' : '');
      return card('unit', u.unit, u.icon || '📘', 'الوحدة ' + u.unit + ': ' + ct(u.title), ct(u.desc), badge + pbar(n ? d / n : 0),
        'unit' + (lock ? ' locked' : u.done ? ' done' : '') + (cs.nextUnit === u ? ' cur' : ''));
    }).join('');
    return {
      cls: 'menu',
      html: head('🎓 الكورس التعليمي', 'كل وحدة فيها دروس قصيرة، وفي آخرها اختبار. تحتاج 80 أو أكثر عشان تفتح الوحدة اللي بعدها • ' + cs.done + '/' + cs.total) +
        '<div class="row top">' + (cs.next ? '<button class="btn big default" data-act="next">▶ ' + (cs.done ? 'كمّل' : 'ابدأ') + ': ' + esc(cs.nextTitle) + '</button>' : '') + '<button class="btn" data-act="back">↩ رجوع</button></div>' +
        '<div class="grid units">' + units + '</div>' + navHint(),
      acts: {
        next: () => UI.course.open(cs.next),
        unit: n => { const u = cs.st.find(x => String(x.unit) === String(n)); if (u && u.locked && !unlockAll()) { toast('🔒 الوحدة مقفولة: انجح في اختبار الوحدة اللي قبلها (80 أو أكثر)', 'info'); return; } UI.show('unit', u ? u.unit : n); },
        back: () => UI.show('main')
      },
      back: () => UI.show('main')
    };
  };

  // دروس وحدة وحدة
  S.unit = (n) => {
    const cs = courseSum(), u = cs && cs.st.find(x => String(x.unit) === String(n));
    if (!u) return soon('🎓 الكورس التعليمي', 'course', 'ما لقينا هالوحدة.');
    const ls = u.lessons || [];
    const L = ls.map((l, i) => {
      const lock = l.locked && !unlockAll();
      const badge = lock ? '<span class="badge">🔒</span>' : l.done ? '<span class="badge ok">✓' + (has(l.best) ? ' ' + l.best : '') + '</span>' : '';
      return card('les', l.id, l.icon || '📘', (i + 1) + '. ' + ct(l.title), lock ? 'خلّص الدرس اللي قبله أول' : l.done ? 'خلصته — تقدر تعيده متى ما بغيت' : 'شرح ← المدرب يوريك ← أنت تطير', badge,
        'les' + (lock ? ' locked' : l.done ? ' done' : '') + (l.id === cs.next ? ' cur default' : ''));
    }).join('');
    const c = u.check, clock = c && c.locked && !unlockAll();
    const ck = c ? card('les', c.id, c.icon || '🏁', ct(c.title) || 'اختبار الوحدة', clock ? 'خلّص دروس الوحدة أول' : c.done ? 'نجحت ✓ أفضل نتيجة ' + (has(c.best) ? c.best : '') : 'تحتاج 80 أو أكثر عشان تفتح الوحدة الجاية',
      clock ? '<span class="badge">🔒</span>' : c.done ? '<span class="badge ok">✓ ' + (has(c.best) ? c.best : '') + '</span>' : '', 'check' + (clock ? ' locked' : c.done ? ' done' : '') + (c.id === cs.next ? ' cur default' : '')) : '';
    const d = ls.filter(l => l.done).length + (c && c.done ? 1 : 0), tot = ls.length + (c ? 1 : 0);
    return {
      cls: 'menu',
      html: head((u.icon || '📘') + ' الوحدة ' + u.unit + ': ' + esc(ct(u.title)), esc(ct(u.desc)) + ' • ' + d + '/' + tot) + pbar(tot ? d / tot : 0) +
        '<div class="grid lessons" style="margin-top:14px">' + L + ck + '</div>' + backBtn('↩ كل الوحدات (B)') + navHint(),
      acts: { les: id => UI.course.open(id), back: () => UI.show('course') },
      back: () => UI.show('course')
    };
  };

  // بطاقة الدرس: شرح + رسمة العصي + وش يقابلها في الدرون الحقيقي
  S.lesson = (id) => {
    const def = hasCourse() ? tryf(() => DS.courseDef(id), null) : null;
    if (!def) return soon('🎓 الدرس', 'course', 'الدرس هذا لسا ما جهز.');
    const it = def.intro || {}, cs = courseSum(), f = cs && cs.find(id), isCheck = !!(f && f.check);
    const unit = has(def.unit) ? def.unit : (f ? f.u.unit : null);
    const sub = (has(unit) ? 'الوحدة ' + unit : '') + (isCheck ? ' • 🏁 اختبار الوحدة' : ' • درس') + (def.airframe === 'fpv' ? ' • درون FPV' : ' • درون تصوير (Mini)') +
      (f && f.l.done ? ' • ✓ خلصته' + (has(f.l.best) ? ' (أفضل: ' + f.l.best + ')' : '') : '');
    const dg = it.diagram ? '<div class="idg">' + diagram(it.diagram) + '</div>' : '';
    return {
      cls: 'menu brief lesson',
      html: head((def.icon || '📘') + ' ' + esc(ct(def.title)), esc(sub)) +
        sndLine() + '<div class="intro"><div class="itx">' + (it.text ? '<p class="desc">' + esc(ct(it.text)) + '</p>' : (def.desc ? '<p class="desc">' + esc(ct(def.desc)) + '</p>' : '')) + listHtml(ctl(it.bullets), 'ul') + '</div>' + dg + '</div>' +
        (it.realWorld ? '<div class="realw"><b>🚁 في الدرون الحقيقي:</b> ' + esc(ct(it.realWorld)) + '</div>' : '') +
        (Array.isArray(it.tips) && it.tips.length ? '<div class="tipbox"><b>💡 نصايح:</b>' + listHtml(ctl(it.tips), 'ul', 'tips') + '</div>' : '') +
        (isCheck ? '<div class="tipbox warnbox"><b>🏁 هذا اختبار:</b> لازم تجيب 80 أو أكثر. 7 أخطاء بسيطة أو 3 كبيرة أو خطأ أمان واحد = رسوب (مثل اختبار الطيران الحقيقي).</div>' : '') +
        '<div class="row"><button class="btn big default" data-act="start">▶ ' + (isCheck ? 'ابدأ الاختبار' : 'ابدأ الدرس') + '</button>' +
        (!(DS.LESSONS2 && DS.LESSONS2[id] && DS.LESSONS2[id].demo === false) ? '<button class="btn" data-act="demo">🎬 شوف المدرب</button>' : '') + '<button class="btn" data-act="back">↩ رجوع</button></div>' + flyHint() + navHint(),
      acts: { start: () => DS.app.startCourse(id, false), demo: () => DS.app.startCourse(id, true), back: () => (has(unit) ? UI.show('unit', unit) : UI.show('course')) },
      back: () => (has(unit) ? UI.show('unit', unit) : UI.show('course')),
      tick(dt) { this._s = (this._s || 0) + dt; if (this._s > 0.5) { this._s = 0; sndTick(); } }
    };
  };

  // ---------------- التدريب الاحترافي ----------------
  const LV_IC = { B: '🟢', I: '🔵', A: '🟣', P: '🟠', E: '🔴' };
  S.pro = () => {
    const ps = proSum();
    if (!ps) return soon('🏅 التدريب الاحترافي', 'main', 'التمارين الاحترافية قاعدة تتجهز… ارجع لها بعد التحديث الجاي.');
    const cards = ps.st.map(L => {
      const ex = L.exercises || [], d = ex.filter(e => e.done).length, lock = L.locked && !unlockAll();
      const m = { gold: 0, silver: 0, bronze: 0 }; ex.forEach(e => { if (m[e.medal] !== undefined) m[e.medal]++; });
      const badge = lock ? '<span class="badge">🔒</span>' : L.done ? '<span class="badge ok">✓ خلصت</span>' : '<span class="badge">' + d + '/' + ex.length + '</span>';
      return card('lvl', L.id, LV_IC[L.id] || '🏅', (L.name || L.id) + ' (' + L.id + ')', L.desc || '', badge + '<span class="meds">' + medTxt(m) + '</span>' + pbar(ex.length ? d / ex.length : 0), 'lvl lv' + L.id + (lock ? ' locked' : ''));
    }).join('');
    return {
      cls: 'menu',
      html: head('🏅 التدريب الاحترافي', 'تمارين مأخوذة من اختبارات الطيارين الحقيقية (NIST • CASA • BMFA). كل تمرين له ميدالية: 🥉 70 • 🥈 80 • 🥇 90') +
        '<div class="grid g3">' + cards + '</div>' + backBtn() + navHint(),
      acts: {
        lvl: id => { const L = ps.st.find(x => x.id === id); if (L && L.locked && !unlockAll()) { toast('🔒 المستوى مقفول: خلّص المستوى اللي قبله بـ 80 أو أكثر', 'info'); return; } UI.show('proLevel', id); },
        back: () => UI.show('main')
      },
      back: () => UI.show('main')
    };
  };
  S.proLevel = (lv) => {
    const ps = proSum(), L = ps && ps.st.find(x => x.id === lv);
    if (!L) return soon('🏅 التدريب الاحترافي', 'pro', 'ما لقينا هالمستوى.');
    let first = true;
    const cards = (L.exercises || []).map(e => {
      const lock = e.locked && !unlockAll(), md = MEDAL[e.medal];
      const isCur = !lock && !e.done && first; if (isCur) first = false;
      const badge = lock ? '<span class="badge">🔒</span>' : md ? '<span class="badge gold">' + md[0] + (has(e.best) ? ' ' + e.best : '') + '</span>' : e.done ? '<span class="badge ok">✓ ' + (has(e.best) ? e.best : '') + '</span>' : (has(e.best) && e.best > 0 ? '<span class="badge">' + e.best + '</span>' : '');
      return card('ex', e.id, e.icon || '🎯', e.id + ' — ' + ct(e.title), ct(e.sub), badge + '<span class="tagaf">' + (e.airframe === 'fpv' ? 'FPV' : 'DJI Mini') + '</span>',
        (lock ? 'locked' : e.done ? 'done' : '') + (isCur ? ' cur default' : ''));
    }).join('');
    return {
      cls: 'menu',
      html: head((LV_IC[L.id] || '🏅') + ' ' + esc(L.name || L.id) + ' (' + L.id + ')', esc(L.desc || '')) + '<div class="grid">' + cards + '</div>' + backBtn('↩ كل المستويات (B)') + navHint(),
      acts: { ex: id => UI.pro.open(id), back: () => UI.show('pro') },
      back: () => UI.show('pro')
    };
  };
  S.proBrief = (exId) => {
    const def = hasPro() ? tryf(() => DS.proDef(exId), null) : null;
    if (!def) return soon('🏅 التمرين', 'pro', 'التمرين هذا لسا ما جهز.');
    const b = def.brief || {}, ps = proSum(), f = ps && ps.find(exId), lv = def.level || (f && f.L.id);
    const L = ps && ps.st.find(x => x.id === lv), e = f && f.e;
    const pass = typeof b.pass === 'string' ? b.pass : (b.pass && b.pass.total ? 'المعدل ' + b.pass.total + ' أو أكثر' : (def.pass && def.pass.total ? 'المعدل ' + def.pass.total + ' أو أكثر' : ''));
    const wind = def.wind && def.wind.s ? 'الريح ' + def.wind.s + ' م/ث' : 'بدون ريح تقريباً';
    const sub = (L ? (L.name || L.id) + ' • ' : '') + (def.airframe === 'fpv' ? 'درون FPV' : 'DJI Mini') + ' • ' + wind + (def.mode && DS.MODES && DS.MODES[def.mode] ? ' • الوضع: ' + (DS.MODES[def.mode].label || def.mode) : '') +
      (e && has(e.best) && e.best > 0 ? ' • أفضل: ' + e.best + ' ' + medalTxt(e.medal) : '');
    return {
      cls: 'menu brief',
      html: head((def.icon || '🎯') + ' ' + esc(exId) + ' — ' + esc(ct(def.title)), esc(sub)) +
        (b.goal ? '<p class="desc"><b>🎯 الهدف:</b> ' + esc(ct(b.goal)) + '</p>' : (def.desc ? '<p class="desc">' + esc(ct(def.desc)) + '</p>' : '')) +
        (Array.isArray(b.steps) && b.steps.length ? '<b>📋 الخطوات:</b>' + listHtml(ctl(b.steps), 'ol', 'steps') : '') +
        (b.realWorld ? '<div class="realw"><b>🚁 في الدرون الحقيقي:</b> ' + esc(ct(b.realWorld)) + '</div>' : '') +
        (pass ? '<div class="tipbox"><b>✅ النجاح:</b> ' + esc(ct(pass)) + ' • 🥉 70 • 🥈 80 • 🥇 90</div>' : '') +
        '<div class="row"><button class="btn big default" data-act="start">▶ ابدأ التمرين</button><button class="btn" data-act="demo">🎬 شوف العرض</button><button class="btn" data-act="back">↩ رجوع</button></div>' + flyHint() + navHint(),
      acts: { start: () => DS.app.startPro(exId, false), demo: () => DS.app.startPro(exId, true), back: () => (lv ? UI.show('proLevel', lv) : UI.show('pro')) },
      back: () => (lv ? UI.show('proLevel', lv) : UI.show('pro'))
    };
  };

  // ---------------- المهام والدروس القديمة (v1) ----------------
  S.legacy = () => {
    const P = DS.progress, les = DS.LESSONS.filter(l => P.lessons[l.id]).length;
    return {
      cls: 'menu',
      html: head('🎯 المهام والدروس القديمة', 'من النسخة الأولى — تمارين زينة للمراجعة') + '<div class="grid g3">' +
        card('go', 'lessons', '🎓', 'دروس المبتدئ', 'العصي، المحركات، الإقلاع، الأوضاع، الكاميرات', '<span class="badge">' + les + '/' + DS.LESSONS.length + '</span>') +
        card('go', 'missions', '🎯', 'مهام الطيران', '12 مهمة × 4 درجات: سهل • متوسط • صعب • محترف') +
        '</div>' + backBtn() + navHint(),
      acts: { go: a => UI.show(a), back: () => UI.show('main') },
      back: () => UI.show('main')
    };
  };
  S.lessons = () => ({
    cls: 'menu',
    html: head('🎓 دروس المبتدئ', 'سوها بالترتيب. كل درس فيه خطوات وتلميحات') + '<div class="grid">' +
      DS.LESSONS.map((l, i) => card('pick', l.id, l.icon, (i + 1) + '. ' + l.title, l.desc, DS.progress.lessons[l.id] ? '<span class="badge ok">✓ خلصته</span>' : '')).join('') + '</div>' + backBtn() + navHint(),
    acts: { pick: id => UI.show('brief', DS.lessonDef(DS.LESSONS.find(l => l.id === id))), back: () => UI.show('legacy') },
    back: () => UI.show('legacy')
  });
  S.missions = () => ({
    cls: 'menu',
    html: head('🎯 مهام الطيران', 'اختار مهمة وبعدين الدرجة. النقاط الملونة = الدرجات اللي نجحت فيها') + '<div class="grid">' +
      DS.MISSIONS.map(m => {
        const dots = DS.DIFF_ORDER.map(k => { const b = DS.progress.best[m.id + ':' + k]; return '<i title="' + DS.DIFF[k].name + '" style="color:' + (b && b.passed ? DS.DIFF[k].color : '#475569') + '">●</i>'; }).join('');
        return card('pick', m.id, m.icon, m.title, m.desc, '<span class="dots">' + dots + '</span>');
      }).join('') + '</div>' + backBtn() + navHint(),
    acts: { pick: id => UI.show('diff', id), back: () => UI.show('legacy') },
    back: () => UI.show('legacy')
  });
  S.diff = (id) => {
    const m = DS.MISSIONS.find(x => x.id === id) || DS.MISSIONS[0];
    return {
      cls: 'menu',
      html: head(m.icon + ' ' + esc(m.title), esc(m.desc)) + '<div class="grid g4">' +
        DS.DIFF_ORDER.map(k => {
          const D = DS.DIFF[k], b = DS.progress.best[m.id + ':' + k];
          return card('pick', k, '<b style="color:' + D.color + '">●</b>', D.name, D.note, b ? '<span class="badge">' + stars(b.stars || 0) + ' ' + b.total + '</span>' : '');
        }).join('') + '</div>' + backBtn(),
      acts: { pick: k => UI.show('brief', DS.missionDef(m, k)), back: () => UI.show('missions') },
      back: () => UI.show('missions')
    };
  };
  S.scenarios = () => ({
    cls: 'menu',
    html: head('⚠️ سيناريوهات الطوارئ', 'تطير، وفجأة يصير شي. تختار التصرف الصح، وبعدين تنفذه بيدك') + '<div class="grid">' +
      DS.SCENARIOS.map(s => { const b = DS.progress.best['scn:' + s.id]; return card('pick', s.id, s.icon, s.title, s.desc, b ? '<span class="badge">' + stars(b.stars || 0) + '</span>' : ''); }).join('') + '</div>' + backBtn() + navHint(),
    acts: { pick: id => UI.show('brief', DS.scenarioDef(DS.SCENARIOS.find(s => s.id === id))), back: () => UI.show('main') },
    back: () => UI.show('main')
  });
  S.exams = () => ({
    cls: 'menu',
    html: head('🏆 الاختبارات العملية', 'مثل اختبارات الطيران العملية: سلسلة مهام، ونسبة نجاح، وأي طيحة أو طلعة برا الساحة = رسوب') + '<div class="grid g3">' +
      DS.FLIGHT_EXAMS.map(e => { const b = DS.progress.best['exam:' + e.id]; return card('pick', e.id, e.icon, e.title, e.desc, '<span class="badge">النجاح: ' + e.pass.total + '%' + (b ? ' • أفضل: ' + b.total + (b.passed ? ' ✓' : '') : '') + '</span>'); }).join('') + '</div>' + backBtn() + navHint(),
    acts: { pick: id => UI.show('brief', DS.examDef(DS.FLIGHT_EXAMS.find(e => e.id === id))), back: () => UI.show('main') },
    back: () => UI.show('main')
  });

  // ---------------- الطيران الحر ----------------
  const FREE = {
    airframe: [['mini', '📷 DJI Mini (تصوير)'], ['fpv', '🏎️ FPV (سباق وحركات)']],
    zone: [['field', '🌿 ساحة التدريب'], ['city', '🏙️ المدينة'], ['race', '🏁 حلبة FPV'], ['desert', '🏜️ الصحراء']],
    timeOfDay: [['day', '☀️ نهار'], ['sunset', '🌇 غروب'], ['night', '🌙 ليل']],
    wind: [['calm', '🍃 هادي'], ['light', '🌬️ خفيف'], ['strong', '💨 قوي']]
  };
  const FREE_LBL = { airframe: 'الدرون', zone: 'المكان', timeOfDay: 'الوقت', wind: 'الريح' };
  S.free = () => {
    const S0 = DS.settings, o = S0.freeOpts || (S0.freeOpts = { airframe: S0.airframe || 'mini', zone: 'field', timeOfDay: 'day', wind: 'light' });
    const rows = Object.keys(FREE).map(k => '<div class="opt"><b>' + FREE_LBL[k] + ':</b>' + FREE[k].map(([v, n]) => '<button class="btn chip ' + (o[k] === v ? 'on' : '') + '" data-act="set" data-arg="' + k + ':' + v + '">' + n + '</button>').join('') + '</div>').join('');
    const note = o.airframe === 'fpv' ? '🏎️ FPV: الثروتل ' + ({ center: 'بالنص = تحويم', trigger: 'بالزناد RT', stick: 'بالعصا كاملة' }[S0.fpvThrottle] || '') + ' • D-pad ▲▼ = Angle / Horizon / Acro' + (o.zone === 'race' ? ' • بتطلع لك بوابات السباق 🏁' : '') : '📷 Mini: ▲▼ = الأوضاع C / N / S • ◀ = ATTI • B مطوّل = يرجع للبيت';
    const st = geoStatus();
    const tw = twOk()
      ? '<div class="twbox"><button class="btn tw" data-act="tuwaiq">📍 ' + TW_TITLE + ' ▶</button><small class="geo" id="geoSt"' + (st ? '>' + esc(st) : ' style="display:none">') + '</small>' +
        '<small>نفس اختيارك فوق (الدرون والوقت والريح) بس المكان: أكاديمية طويق الحقيقية — يحتاج نت</small></div>'
      : '<div class="twbox"><button class="btn tw off" disabled>📍 ' + TW_TITLE + ' <span class="badge soonb">قريب</span></button></div>';
    return {
      cls: 'menu',
      html: head('🕊️ الطيران الحر', 'طِر براحتك بدون مهمة ولا نتيجة. تطلع منه من قائمة الإيقاف (' + (touchNoPad() ? 'زر ☰' : 'START') + ')') + '<div class="opts">' + rows + '</div>' +
        '<div class="tipbox">' + note + '</div>' +
        '<div class="row"><button class="btn big default" data-act="start">طِر ▶</button><button class="btn" data-act="back">↩ رجوع</button></div>' + tw + flyHint() + navHint(),
      acts: {
        set: a => { const i = a.indexOf(':'); o[a.slice(0, i)] = a.slice(i + 1); DS.saveSettings(); UI.refresh(); },
        start: () => DS.app.startFree(Object.assign({}, o)),
        tuwaiq: startTuwaiq,
        back: () => UI.show('main')
      },
      back: () => UI.show('main'),
      tick(dt) { geoTick(this, dt); }
    };
  };

  // ---------------- قبل المهمة (النسخة الأولى) ----------------
  S.brief = (def) => {
    const rules = [];
    const mname = m => (DS.MODES && DS.MODES[m] ? DS.MODES[m].name || m : m);
    if (def.kind === 'exam') rules.push('النجاح: المعدل ' + def.pass.total + '% وما تقل أي مهمة عن ' + def.pass.each + '%', 'أي طيحة أو طلعة برا السياج = رسوب', 'الوضع: ' + mname(def.mode) + (def.modeLocked ? ' (مقفول)' : ''));
    else if (def.kind === 'mission') rules.push(DS.DIFF[def.diff].note, 'لا تطلع برا السياج ولا تتعدى ' + def.maxAlt + ' متر');
    else if (def.kind === 'scenario') rules.push('بيطلع لك سؤال "وش تسوي؟" والوقت يوقف لين تجاوب', 'بعدها نفّذ التصرف الصح بيدك');
    else if (def.kind === 'lesson') rules.push('اتبع التعليمات اللي تطلع فوق، وخذ وقتك');
    rules.push('الريح: ' + (def.wind ? def.wind.s : 0) + ' م/ث');
    const m1 = DS.settings.stickMode === 1;
    return {
      cls: 'menu brief',
      html: head((def.icon || '') + ' ' + esc(def.title), esc(def.sub || '')) + '<p class="desc">' + esc(def.desc || '') + '</p>' +
        '<ul class="rules">' + rules.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>' +
        '<div class="tipbox">🕹️ Mode ' + DS.settings.stickMode + ': العصا اليسار = ' + (m1 ? 'قدام/ورا + لف' : 'ارتفاع + لف') + ' • العصا اليمين = ' + (m1 ? 'ارتفاع + جنب' : 'قدام/ورا + جنب') +
        '<br>A مطوّل = إقلاع/هبوط تلقائي • B مطوّل = رجوع للبيت • X = وقوف بالجو • ▲▼ = الوضع C/N/S • ◀ = ATTI • Y = الكاميرا • START = إيقاف</div>' +
        '<div class="row"><button class="btn big default" data-act="start">ابدأ ▶</button><button class="btn" data-act="demo">🎬 شوف المحترف</button><button class="btn" data-act="back">↩ رجوع</button></div>',
      acts: { start: () => DS.app.start(def, false), demo: () => DS.app.start(def, true), back: () => UI.show.apply(UI, DS.app.backFor(def)) },
      back: () => UI.show.apply(UI, DS.app.backFor(def))
    };
  };

  // ---------------- الإيقاف وقت الطيران ----------------
  // تنبيه اليد بشاشة الإيقاف (لو انفصلت وقت الطيران)
  const padWarnHtml = () => {
    const A = DS.app, I = DS.Input;
    if (!A || !A.padLost) return '';
    return I && I.connected ? '<span class="ok">✅ اليد رجعت — اضغط «كمّل الطيران»</span>'
      : '<span class="warn">🎮 اليد انفصلت — وصّلها واضغط أي زر فيها، وبعدين كمّل (أو كمّل ' + (touchDev() ? 'بأزرار الشاشة' : 'بالكيبورد') + ')</span>';
  };
  S.pause = () => {
    const s = DS.app.session, def = (s && s.def) || {};
    const hasInfo = (def.kind === 'course' && def.intro) || (def.kind === 'pro' && def.brief);
    const quitLbl = def.kind === 'course' ? '↩ رجوع للدروس' : def.kind === 'pro' ? '↩ رجوع للتمارين' : '🏠 اطلع للقائمة';
    return {
      overlay: true, cls: 'menu small',
      html: head('⏸ موقّف', esc(def.title || '')) + '<p class="padwarn" id="padWarn">' + padWarnHtml() + '</p><div class="col">' +
        '<button class="btn big default" data-act="resume">▶ كمّل الطيران</button>' +
        '<button class="btn" data-act="restart">🔄 عيد من البداية</button>' +
        (def.kind !== 'free' ? '<button class="btn" data-act="demo">🎬 خلّ ' + (def.kind === 'course' ? 'المدرب' : 'المحترف') + ' يوريك من البداية</button>' : '') +
        (hasInfo ? '<button class="btn" data-act="info">📖 ' + (def.kind === 'pro' ? 'شرح التمرين' : 'شرح الدرس') + '</button>' : '') +
        '<button class="btn" data-act="settings">⚙️ الإعدادات</button>' +
        '<button class="btn" data-act="help">🎮 الأزرار</button>' +
        '<button class="btn" data-act="quit">' + quitLbl + '</button></div>',
      acts: {
        resume: () => DS.app.resume(), restart: () => DS.app.restart(false), demo: () => DS.app.restart(true),
        info: () => UI.show('lessonInfo'), settings: () => UI.show('settings', { from: 'pause' }),
        help: () => UI.show('help', 'pause'),
        quit: () => DS.app.quit.apply(DS.app, isFn(DS.app.backFor) ? DS.app.backFor(def) : ['main'])   // نفس مكان شاشة النتيجة (الوحدة/المستوى)
      },
      back: () => DS.app.resume(), onButton: k => { if (k === 'START') DS.app.resume(); },
      tick(dt) {
        this._t = (this._t || 0) + dt; if (this._t < 0.25) return; this._t = 0;
        const el = $('padWarn'), h = padWarnHtml();
        if (el && h !== this._h) { this._h = h; el.innerHTML = U.bidiHtml ? U.bidiHtml(h) : h; }
      }
    };
  };
  // شرح الدرس الحالي (من قائمة الإيقاف)
  S.lessonInfo = () => {
    const s = DS.app.session, def = (s && s.def) || {}, it = def.intro || {}, b = def.brief || {};
    return {
      overlay: true, cls: 'menu', keepTop: true,
      html: head('📖 ' + esc(ct(def.title)), '') +
        (it.text ? '<p class="desc">' + esc(ct(it.text)) + '</p>' : '') + listHtml(ctl(it.bullets), 'ul') +
        (b.goal ? '<p class="desc"><b>🎯 الهدف:</b> ' + esc(ct(b.goal)) + '</p>' : '') + listHtml(ctl(b.steps), 'ol', 'steps') +
        (it.diagram ? '<div class="idg">' + diagram(it.diagram) + '</div>' : '') +
        ((it.realWorld || b.realWorld) ? '<div class="realw"><b>🚁 في الدرون الحقيقي:</b> ' + esc(ct(it.realWorld || b.realWorld)) + '</div>' : '') +
        '<div class="row"><button class="btn default" data-act="back">↩ رجوع</button></div>',
      acts: { back: () => UI.show('pause') }, back: () => UI.show('pause')
    };
  };

  // ---------------- النتيجة ----------------
  const CLS_AR = { minor: 'بسيط', major: 'كبير', safety: 'أمان' };
  const cnt = v => (Array.isArray(v) ? v.length : (+v || 0));
  function logLine(e) {
    if (typeof e === 'string') return '<li>' + esc(e) + '</li>';
    if (!e || typeof e !== 'object') return '';
    const cls = e.cls || e.kind || e.type || e.c || '', t = typeof e.t === 'number' ? U.mmss(e.t) : '';
    const txt = e.text || e.msg || e.ar || e.reason || e.label || e.code || '';
    return '<li class="fl-' + esc(cls) + '"><b>' + esc(CLS_AR[cls] || cls) + '</b>' + (t ? ' <small>' + t + '</small>' : '') + ' ' + esc(txt) + '</li>';
  }
  function faultsHtml(f) {
    if (!f || typeof f !== 'object') return '';
    const mi = cnt(f.minor), ma = cnt(f.major), sa = cnt(f.safety), log = Array.isArray(f.log) ? f.log : [];
    const lim = f.limits || {};
    const box = (cls, label, v, l) => '<div class="fbox ' + cls + (v ? ' on' : '') + '"><b>' + v + '<small> / ' + l + '</small></b><span>' + label + '</span></div>';
    return '<h3>📋 الأخطاء</h3><div class="faults">' + box('minor', 'أخطاء بسيطة', mi, lim.minor || 7) + box('major', 'أخطاء كبيرة', ma, lim.major || 3) + box('safety', 'أخطاء أمان', sa, lim.safety || 1) + '</div>' +
      (log.length ? '<ul class="flog">' + log.slice(0, 10).map(logLine).join('') + (log.length > 10 ? '<li>… و' + (log.length - 10) + ' غيرها</li>' : '') + '</ul>' : (mi + ma + sa === 0 ? '<p class="ok">✓ ولا خطأ — طيران نظيف</p>' : ''));
  }
  function feedback(sm) {
    const def = sm.def || {}, f = sm.faults || {}, out = [];
    if (sm.demo) return '<p class="fbk">🎬 هذا طيران ' + (def.kind === 'course' ? 'المدرب' : 'المحترف') + ' عشان تشوف الطريقة — الحين دورك! اضغط «جرّب بنفسك».</p>';
    if (sm.kind === 'crash') out.push('💥 طحت. بالدرون الحقيقي: طفّ المحركات على طول، وافحص المراوح والبطارية قبل أي طيران ثاني. عيد بهدوء — السرعة الزايدة هي أكثر سبب للطيحات.');
    else if (sm.kind === 'fence') out.push('🚧 طلعت برا الحدود. راقب الخريطة الصغيرة وخلك داخل المنطقة — بالواقع الطلعة برا المنطقة المسموحة مخالفة.');
    else if (sm.kind === 'fail' && f.failed) out.push('📋 الأخطاء كثرت لين وصلت حد الرسوب. ركّز على الأخطاء المكتوبة فوق وعيد بهدوء — الدقة أهم من السرعة.');
    else if (def.kind === 'free') out.push('🕊️ طيران حر — ما فيه درجة. كل دقيقة طيران تفرق!');
    else if (sm.passed) {
      if (sm.medal === 'gold') out.push('🥇 ممتاز! طيرانك نظيف ودقيق. كذا تطير الدرون الحقيقي بثقة.');
      else if (sm.medal === 'silver') out.push('🥈 زين جداً! باقي شوية دقة وتوصل للذهبية — عيدها مرة.');
      else if (sm.medal === 'bronze') out.push('🥉 نجحت 👍 عيدها كم مرة عشان تثبت الحركة في يدك وتوصل للفضية.');
      else out.push('✅ نجحت! عيدها لين تصير الحركة سهلة عليك وما تفكر فيها.');
    } else out.push('عادي، كل الطيارين كذا بدوا 💪 شوف المدرب يسويها، وبعدين جرّب مرة ثانية بهدوء.');
    if (cnt(f.safety)) out.push('⛔ عندك خطأ أمان — هذا لحاله يرسّبك في الاختبار الحقيقي.');
    else if (cnt(f.major)) out.push('⚠️ عندك ' + cnt(f.major) + ' خطأ كبير (3 = رسوب).');
    if (sm.newBest) out.push('🎉 رقم قياسي جديد!');
    return out.map(t => '<p class="fbk">' + esc(t) + '</p>').join('');
  }
  S.result = (sm) => {
    const def = sm.def || {}, ok = !!sm.passed, kind = def.kind, results = sm.results || [];
    let big;
    if (sm.kind === 'crash') big = '<div class="res bad">💥 ' + esc(sm.reason) + '</div>';
    else if (sm.kind === 'fence') big = '<div class="res bad">🚧 ' + esc(sm.reason) + '</div>';
    else if (kind === 'free') big = '<div class="res">انتهى الطيران</div>';
    else {
      const ck = kind === 'course' && !!def.check;   // اختبار آخر الوحدة
      const t = ok ? (kind === 'exam' ? '🎉 نجحت في الاختبار!' : ck ? '🎉 نجحت في اختبار الوحدة' + (!sm.demo && has(def.unit) && def.unit < 15 ? ' — انفتحت الوحدة الجاية!' : '!') : kind === 'course' ? '✅ خلّصت الدرس!' : '✅ ممتاز! نجحت') :
        (kind === 'exam' ? '❌ ما نجحت هالمرة' : ck ? '❌ ما نجحت في الاختبار (تحتاج 80)' : '❌ ما نجحت');
      big = '<div class="res ' + (ok ? 'ok' : 'bad') + '">' + t + (sm.kind === 'fail' && sm.reason ? '<small> — ' + esc(sm.reason) + '</small>' : '') + '</div>';
    }
    const md = MEDAL[sm.medal];
    const tinfo = '<div class="tinfo">' + (has(sm.time) ? '⏱ الوقت: <b>' + U.mmss(sm.time) + '</b><br>' : '') +
      (has(sm.bestTime) ? '🏁 أفضل لفة: <b>' + fmtT(sm.bestTime) + '</b>' + (has(sm.prevBest) ? ' • رقمك القديم: ' + fmtT(sm.prevBest) : '') + '<br>' : '') +
      (has(sm.shots) && sm.shots ? '📸 الصور: <b>' + sm.shots + '</b>' : '') + '</div>';
    const scoreBox = kind !== 'free' && results.length ? '<div class="scorebox"><div class="score">' + sm.total + '<small>/100</small></div>' +
      (md ? '<div class="medalBig ' + sm.medal + '">' + md[0] + '<small>ميدالية ' + md[1] + '</small></div>' : (kind !== 'lesson' && kind !== 'course' && kind !== 'pro' ? '<span class="stars">' + stars(sm.stars || 0) + '</span>' : '')) + tinfo + '</div>' : tinfo;
    const rows = results.map(r => '<tr><td>' + esc(r.title) + '</td><td class="' + (r.ok ? 'ok' : 'bad') + '">' + (r.ok ? r.score + '/100' : '✗') + '</td><td>' + esc(r.reason || '') + '</td></tr>').join('');
    const showRows = results.length > 1 || (results.length === 1 && kind !== 'course');
    const tips = [].concat(...results.map(r => r.tips || []));
    if (sm.kind === 'crash') tips.unshift('بعد أي طيحة في الواقع: طفّ المحركات فوراً وافحص البطارية والمراوح');
    const nx = DS.app.nextFor(def, sm), retryDef = !!sm.demo || !(ok && nx);
    const isCourse = kind === 'course';
    return {
      cls: 'menu result',
      html: head((def.icon || '') + ' ' + esc(def.title), esc(def.sub || '') + (sm.demo ? ' • 🎬 عرض ' + (isCourse ? 'المدرب' : 'المحترف') + ' (ما ينحسب)' : '')) + big + scoreBox +
        faultsHtml(sm.faults) + feedback(sm) +
        (showRows ? '<table class="tbl"><tr><th>المهمة</th><th>الدرجة</th><th>ملاحظة</th></tr>' + rows + '</table>' : '') +
        (tips.length ? '<div class="tipbox"><b>💡 نصايح:</b><ul>' + Array.from(new Set(tips)).slice(0, 5).map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></div>' : '') +
        '<div class="row">' + (nx ? '<button class="btn big ' + (retryDef ? '' : 'default') + '" data-act="next">' + esc(nx.label) + '</button>' : '') +
        '<button class="btn ' + (retryDef ? 'big default' : '') + '" data-act="retry">' + (sm.demo ? '▶ جرّب بنفسك' : '🔄 عيد') + '</button>' +
        (kind !== 'free' ? '<button class="btn" data-act="demo">🎬 ' + (isCourse ? 'شوف المدرب' : 'شوف المحترف') + '</button>' : '') +
        '<button class="btn" data-act="menu">🏠 القائمة</button></div>' + navHint(),
      acts: {
        next: () => { if (nx) nx.go(); }, retry: () => DS.app.restart(false), demo: () => DS.app.restart(true),
        menu: () => DS.app.quit.apply(DS.app, DS.app.backFor(def))
      },
      back: () => DS.app.quit.apply(DS.app, DS.app.backFor(def))
    };
  };
  // نتيجة تجريبية (للشاشة #screen=results)
  S.resultSample = () => S.result({
    def: { kind: 'course', title: 'الثبات في الهوا', icon: '🎯', sub: 'الوحدة 3 • درس', unit: 3, lessonId: 'u3l1' },
    kind: 'done', passed: true, total: 86, stars: 2, medal: 'silver', time: 74.2, bestTime: null, demo: false, shots: 0,
    results: [{ title: 'الثبات في الهوا', score: 86, ok: true, tips: ['لا تحرك العصا كثير — حركات صغيرة وبس'] }],
    faults: { minor: 2, major: 1, safety: 0, failed: false, log: [{ cls: 'minor', t: 12.4, text: 'طلعت عن الدائرة شوي' }, { cls: 'minor', t: 31, text: 'الارتفاع تغير أكثر من نص متر' }, { cls: 'major', t: 48.8, text: 'تحركت عكس الاتجاه المطلوب' }] }
  });

  // ---------------- سؤال "وش تسوي؟" وقت الطيران ----------------
  S.decision = () => {
    const t = DS.app.session && DS.app.session.task, d = t && t.decision;
    if (!d) return { overlay: true, html: '' };
    const L = ['أ', 'ب', 'ج', 'د'], en = d.lang === 'en';
    const answered = d.chosen >= 0;
    const opts = d.a.map((a, i) => {
      let cls = '';
      if (answered) cls = i === d.c ? 'right' : (i === d.chosen ? 'wrong' : 'dim');
      return '<button class="btn opt ' + cls + '" data-act="ans" data-arg="' + i + '" ' + (answered ? 'disabled' : '') + ' dir="' + (en ? 'ltr' : 'rtl') + '"><b>' + (en ? 'ABCD'[i] : L[i]) + '</b> ' + esc(a) + '</button>';
    }).join('');
    const quiz = t.o && t.o.quiz;
    const fb = answered ? '<div class="fb ' + (d.chosen === d.c ? 'ok' : 'bad') + '">' + (d.chosen === d.c ? '✅ صح!' : '❌ غلط. الصح: ' + esc(d.a[d.c])) + '<p>' + esc(d.ex || '') + '</p>' + (d.tr ? '<p class="tr">المعنى: ' + esc(d.tr) + '</p>' : '') + '</div>' +
      '<div class="row"><button class="btn big default" data-act="ack">كمّل ▶ (A)</button></div>' : '';
    return {
      overlay: true, cls: 'menu decision',
      html: '<div class="qhead">' + (quiz ? '📝 ' + esc(t.title) + ' <small>(' + (t.st.k + 1) + '/' + t.o.steps.length + ')</small>' : '⚠️ وش تسوي؟ <small>(الوقت واقف)</small>') + '</div>' +
        '<div class="q" dir="' + (en ? 'ltr' : 'rtl') + '">' + esc(d.q) + '</div><div class="opts1">' + opts + '</div>' + fb,
      acts: {
        ans: i => { t.answer(+i); UI.show('decision'); },
        ack: () => { t.ack(DS.app.session.ctx()); UI.hide(); }
      },
      onDigit: i => { if (!answered) { t.answer(i); UI.show('decision'); } },
      back: () => {}
    };
  };

  // ---------------- شرح اليد والأزرار ----------------
  const pb = (t, c) => '<i class="pb ' + (c || '') + '">' + t + '</i>';
  const kb = (...ks) => ks.map(k => '<kbd>' + k + '</kbd>').join(' ');
  S.help = (from) => {
    const m1 = DS.settings.stickMode === 1;
    const rows = [
      [pb('A', 'a') + ' مطوّل', pb('✕', 'ps-x') + ' مطوّل', 'إقلاع تلقائي (على الأرض) • هبوط تلقائي (وهو طاير). FPV مقلوب على الأرض: مطوّل = يقلبه (Turtle)', kb('Space')],
      [pb('B', 'b') + ' مطوّل ثانية', pb('○', 'ps-o') + ' مطوّل', 'الرجوع للبيت RTH • ضغطة وحدة وقت الرجوع = إلغاء', kb('R') + ' أو ' + kb('B')],
      [pb('X', 'x'), pb('□', 'ps-s'), 'وقوف بالجو (Flight Pause): يفرمل ويثبت لين تحرك العصا', kb('M') + ' أو ' + kb('X')],
      [pb('Y', 'y'), pb('△', 'ps-t'), 'تغيير الكاميرا (عين الطيار، من ورا، كاميرا الدرون، من فوق) • مطوّل = الكاميرا الحرارية (إذا المهمة تسمح)', kb('C')],
      [pb('▲') + pb('▼'), pb('▲') + pb('▼'), 'الأوضاع: C (هادي للتصوير) • N (عادي) • S (سريع). FPV: Angle • Horizon • Acro', kb('I') + ' / ' + kb('K')],
      [pb('◀'), pb('◀'), 'ATTI (تدريب: بدون GPS — الدرون يمشي مع الريح)', kb('J')],
      [pb('▶'), pb('▶'), 'بلاغ / تأكيد (لما المهمة تطلب تبلّغ)', kb('L')],
      [pb('LB'), pb('L1'), 'ضغطة = الشاشة الصغيرة (كاميرا الدرون) • مطوّل + LT/RT = زوم', kb('U')],
      [pb('RB'), pb('R1'), 'تصوير (Shutter)', kb('O')],
      [pb('LT') + ' / ' + pb('RT'), pb('L2') + ' / ' + pb('R2'), 'الكاميرا لتحت / لفوق (Gimbal). FPV بوضع الزناد: RT = الثروتل', kb('Q') + ' / ' + kb('E')],
      [pb('VIEW ⧉'), pb('Create / Share'), 'القياسات الفنية • مطوّل ثانية = الأنوار الوامضة (Strobe) للطيران بالليل', kb('V')],
      [pb('START ☰'), pb('Options'), 'إيقاف وقائمة', kb('P') + ' أو ' + kb('Esc')],
      ['العصاتين لتحت وللداخل', 'نفسها', 'CSC: تشغيل / إطفاء المحركات على الأرض', kb('S') + kb('D') + kb('↓') + kb('←') + ' مع بعض']
    ];
    return {
      cls: 'menu help', keepTop: true,
      html: head('🎮 شرح اليد والأزرار', 'Mode ' + DS.settings.stickMode + (m1 ? ' — الارتفاع على العصا اليمين' : ' — الارتفاع على العصا اليسار (مثل أغلب ريموتات DJI)')) +
        '<div class="idg wide">' + diagram(null) + '</div>' +
        (touchDev() ? '<div class="tipbox touchhelp"><b>📱 بالجوال (اللمس):</b> العصا اليسار تحت يسار = ' + (m1 ? 'قدام/ورا + لف' : 'ارتفاع + لف') + ' • العصا اليمين تحت يمين = ' + (m1 ? 'ارتفاع + جنب' : 'قدام/ورا + جنب') +
          '. حط إبهامك بأي مكان تحت وحرّكه، وإذا فكيته يرجع للنص (Mini يثبت مكانه). الدائرة الصفرا المتقطعة = وين المدرب يبي إبهامك.<br>الأزرار نفس اليد: ' +
          pb('A', 'a') + ' مطوّل = إقلاع/هبوط • ' + pb('B', 'b') + ' مطوّل = رجوع للبيت • ' + pb('X', 'x') + ' = وقوف • ' + pb('Y', 'y') + ' = الكاميرا • ▲▼ = الوضع • ◀ = ATTI • ▶ = بلاغ • ' +
          pb('LB') + ' = الشاشة الصغيرة • ' + pb('RB') + ' = صورة • ' + pb('LT') + '/' + pb('RT') + ' = الكاميرا تحت/فوق • 📊 = القياسات • ☰ = إيقاف.<br>' +
          '🎮 وتقدر توصل يد إكس بوكس أو بلايستيشن بالبلوتوث: تشتغل على طول وأزرار الشاشة تختفي.</div>' : '') +
        '<table class="tbl ctl"><tr><th>إكس بوكس</th><th>بلايستيشن</th><th>وش يسوي</th><th>الكيبورد</th></tr>' +
        rows.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>').join('') + '</table>' +
        '<div class="tipbox">⌨️ العصي بالكيبورد: ' + kb('W') + '/' + kb('S') + ' ارتفاع • ' + kb('A') + '/' + kb('D') + ' لف • الأسهم = قدام/ورا/جنب • ' + kb('I') + kb('J') + kb('K') + kb('L') + ' = أسهم اليد • ' + kb('U') + '/' + kb('O') + ' = LB/RB • ' + kb('V') + ' = VIEW<br>' +
        '📺 ريموت التلفزيون: الأسهم = تتنقل بالقوائم • OK = اختيار • رجوع = رجوع (ووقت الطيران = إيقاف) • وقت الطيران: OK = زر B (ضغطة تلغي الرجوع للبيت، مطوّل = رجوع للبيت)</div>' + backBtn() + navHint(),
      acts: { back: () => (from === 'pause' ? UI.show('pause') : UI.show('main')) },
      back: () => (from === 'pause' ? UI.show('pause') : UI.show('main'))
    };
  };

  // ---------------- الإعدادات (بأقسام) ----------------
  const TABS = [['ctl', '🎮 التحكم'], ['fly', '🚁 الطيران'], ['scr', '🖥️ الشاشة'], ['snd', '🔊 الصوت'], ['prog', '📊 التقدم']];
  const EXP = {
    C: { soft: { thr: 0.25, yaw: 0.15, rp: 0.18 }, def: { thr: 0.30, yaw: 0.20, rp: 0.25 }, sharp: { thr: 0.40, yaw: 0.30, rp: 0.35 } },
    P: { soft: { thr: 0.25, yaw: 0.15, rp: 0.18 }, def: { thr: 0.30, yaw: 0.20, rp: 0.25 }, sharp: { thr: 0.40, yaw: 0.30, rp: 0.40 } },
    S: { soft: { thr: 0.30, yaw: 0.22, rp: 0.30 }, def: { thr: 0.40, yaw: 0.30, rp: 0.40 }, sharp: { thr: 0.50, yaw: 0.40, rp: 0.50 } }
  };
  const expIs = (e, p) => !!e && Math.abs(e.thr - p.thr) < 0.006 && Math.abs(e.yaw - p.yaw) < 0.006 && Math.abs(e.rp - p.rp) < 0.006;
  function padStatus() {
    const I = DS.Input;
    if (!I.connected) return (nativeCount() === 0 ? '⚠️ ما فيه يد متصلة بالتلفزيون.' + PAIR_HTML : touchDev() ? '📱 ما فيه يد متصلة — تطير بعصي اللمس اللي على الشاشة. عندك يد إكس بوكس أو بلايستيشن؟ وصّلها بالجوال بالبلوتوث واضغط أي زر فيها.' : '⚠️ ما فيه يد متصلة — اضغط أي زر في اليد. (الكيبورد شغال)');
    const dv = isFn(I.device) ? I.device() : {};
    let s = '🎮 <b>' + esc(String(I.name || dv.id || '').slice(0, 50)) + '</b> • ' + (dv.mapping === 'standard' ? '<span class="ok">قياسية (standard)</span>' : '<span class="warn">غير قياسية</span>') + (isFn(I.getRemap) && I.getRemap() ? ' • <span class="ok">عليها توزيع خاص ✓</span>' : '');
    if (I.needsRemap) s += '<br><span class="warn">⚠️ اليد مو قياسية: سوّ «توزيع الأزرار» عشان العصي تشتغل صح</span>';
    if (I.badAxes && I.badAxes.length) s += '<br><span class="bad">⚠️ فيه محور واقف على الطرف (' + esc(I.badAxes.join(', ')) + ') — غالباً زناد. سوّ «توزيع الأزرار»</span>';
    if (I.driftWarn) { const d = I.drift || {}; s += '<br><span class="warn">⚠️ العصا تنحرف لحالها (lx ' + U.fmt(d.lx || 0, 2) + ' ly ' + U.fmt(d.ly || 0, 2) + ' rx ' + U.fmt(d.rx || 0, 2) + ' ry ' + U.fmt(d.ry || 0, 2) + ') — سوّ «معايرة العصي» أو كبّر المنطقة الميتة</span>'; }
    return s;
  }
  S.settings = (arg) => {
    arg = arg || {};
    const st = DS.settings, I = DS.Input;
    const tab = arg.tab || UI._setTab || 'ctl'; UI._setTab = tab;
    const from = arg.from || UI._setFrom || 'main'; UI._setFrom = from;
    const row = (key, label, vals, names, note) => '<div class="opt"><b>' + label + ':</b>' + vals.map((v, i) => '<button class="btn chip ' + (st[key] === v ? 'on' : '') + '" data-act="set" data-arg="' + esc(key + '|' + JSON.stringify(v)) + '">' + names[i] + '</button>').join('') + (note ? '<span class="note">' + note + '</span>' : '') + '</div>';
    let body = '';
    if (tab === 'ctl') {
      const ex = st.djiExp || {};
      const expRow = (m, label) => '<div class="opt"><b>' + label + ':</b>' + [['soft', 'ناعمة'], ['def', 'افتراضي DJI'], ['sharp', 'حادة']].map(([k, n]) => '<button class="btn chip ' + (expIs(ex[m], EXP[m][k]) ? 'on' : '') + '" data-act="exp" data-arg="' + m + ':' + k + '">' + n + '</button>').join('') + '</div>';
      const r = st.rates || {};
      body = '<div class="padst" id="padSt">' + padStatus() + '</div>' +
        '<div class="row top"><button class="btn" data-act="calib">🎯 معايرة العصي</button><button class="btn" data-act="remap">🔀 توزيع الأزرار</button><button class="btn" data-act="unmap">↺ رجّع توزيع اليد الافتراضي</button></div>' +
        '<div class="opts">' +
        row('stickMode', 'وضع الريموت', [2, 1], ['Mode 2 (الأشهر)', 'Mode 1'], 'Mode 2: الارتفاع واللف يسار، والحركة يمين. لا تغيّره إذا بتتدرب على ريموت DJI عادي.') +
        (window.NativePad || isTv() ? '' : row('touch', 'أزرار اللمس على الشاشة', ['auto', 'on', 'off'], ['تلقائي (الجوال والتابلت)', 'دايم تطلع', 'طافية'],
          'عصاتين وأزرار على الشاشة وقت الطيران (للجوال). تختفي لحالها أول ما توصل يد تحكم.')) +
        row('deadzone', 'المنطقة الميتة', [0.03, 0.05, 0.08, 0.12], ['صغيرة جداً', 'صغيرة (افتراضي)', 'متوسطة', 'كبيرة'], 'إذا الدرون يتحرك لحاله وأنت ما لمست العصي، كبّرها شوي.') +
        expRow('C', 'نعومة العصي — C') + expRow('P', 'نعومة العصي — N') + expRow('S', 'نعومة العصي — S') +
        '<div class="opt"><b>سرعة الدوران FPV:</b>' + [['beginner', 'مبتدئ'], ['gamepad', 'يد التحكم (افتراضي)'], ['freestyle', 'فري ستايل'], ['betaflight', 'Betaflight الأصلي']].map(([k, n]) => '<button class="btn chip ' + (st.ratePreset === k ? 'on' : '') + '" data-act="rates" data-arg="' + k + '">' + n + '</button>').join('') +
        '<span class="note">الحين: النص ' + (r.center || 0) + '°/ث • آخر العصا ' + (r.max || 0) + '°/ث. ثبّت وحدة وخلك عليها — تغييرها يخرب تعودك.</span></div>' +
        row('fpvThrottle', 'ثروتل FPV', ['center', 'trigger', 'stick'], ['النص = تحويم (أسهل)', 'الزناد RT', 'العصا كاملة (مثل الريموت الحقيقي)'], 'الريموت الحقيقي حق FPV ما يرجع للنص — «العصا كاملة» أقرب له.') +
        '</div>';
    } else if (tab === 'fly') {
      body = '<div class="opts">' +
        row('airframe', 'الدرون الافتراضي', ['mini', 'fpv'], ['📷 DJI Mini', '🏎️ FPV']) +
        row('camera', 'الكاميرا أول ما تبدأ', ['pilot', 'chase', 'fpv'], ['عين الطيار', 'من ورا', 'كاميرا الدرون'], 'بالاختبارات الحقيقية تطير وأنت تشوف الدرون بعينك — عين الطيار أقرب للواقع.') +
        row('sensors', 'حساسات العوائق', [true, false], ['شغالة', 'طافية'], 'تشتغل بـ Mini في C و N بس (مثل DJI). في S و ATTI ما فيه حساسات.') +
        row('brakeSens', 'قوة الفرامل', [50, 75, 100], ['ناعمة', 'متوسطة', 'قوية (مثل DJI)']) +
        row('smartRth', 'رجوع ذكي لما البطارية تخلص', [true, false], ['شغال', 'طافي'], 'مثل DJI: يعد تنازلي ويرجع للبيت. B = إلغاء.') +
        row('airmode', 'Airmode (FPV)', [true, false], ['شغال', 'طافي'], 'يخلي التحكم شغال حتى والثروتل تحت (للحركات).') +
        row('aids', 'المساعدات', ['auto', 'off'], ['تلقائي (تختفي بالاختبارات)', 'بدون مساعدات']) +
        row('visualAid', 'دائرة حول الدرون إذا بعد', [true, false], ['تطلع', 'ما تطلع']) +
        row('showSticks', 'رسمة العصي تحت', [true, false], ['تطلع', 'ما تطلع'], 'زينة للتعلم: تشوف حركة يدك وحركة المدرب.') +
        '</div>';
    } else if (tab === 'scr') {
      const R = DS.app.R, qo = R && R.qOverride;
      body = '<div class="opts">' +
        row('quality', 'جودة الرسم', ['auto', 'high', 'medium', 'low', 'tv'], ['تلقائي', 'عالية', 'متوسطة', 'منخفضة', 'تلفزيون'], (qo ? '⚠️ الجودة الحين مقفولة على «' + esc(qo) + '» (ذاكرة الجهاز قليلة) لين تعيد فتح التطبيق. ' : '') + 'إذا الحركة تقطّع خلها أقل.') +
        row('tvMode', 'وضع التلفزيون', [false, true], ['طافي', 'شغال'], 'كل شي أكبر + هوامش آمنة لشاشة التلفزيون.') +
        row('osd', 'شاشة الطيران (OSD)', [true, false], ['تطلع', 'ما تطلع']) +
        row('eyeFov', 'عين الطيار', ['real', 'zoom'], ['حقيقية 40° (مثل عينك)', 'زوم تلقائي (أسهل)'], 'الحقيقية تعلّمك تقدّر المسافة صح: الدرون يصغر كل ما بعد.') +
        row('fpvFov', 'زاوية كاميرا FPV', [90, 100, 120, 140], ['90°', '100° (افتراضي)', '120°', '140°']) +
        row('fpvUptilt', 'ميلان كاميرا FPV', [15, 25, 35, 45], ['15°', '25° (افتراضي)', '35°', '45°'], 'كل ما زاد الميلان لازم تطير أسرع لقدام عشان تشوف قدامك.') +
        row('videoLatency', 'تأخير الفيديو', ['real', 'off'], ['حقيقي (FPV بدون تأخير إضافي • Mini حوالي 0.12 ث)', 'بدون تأخير'], 'الحقيقي يعوّدك على الدرون الحقيقي.') +
        row('pip', 'الشاشة الصغيرة (كاميرا الدرون)', [true, false], ['تطلع', 'ما تطلع']) +
        gkRow(st) +
        '</div>';
    } else if (tab === 'snd') {
      body = '<div class="opts">' +
        row('sound', 'الأصوات', [true, false], ['شغالة', 'طافية']) +
        row('voice', 'صوت المدرب (يتكلم)', [true, false], ['شغال', 'طافي']) +
        row('rumble', touchDev() ? 'الاهتزاز (اليد أو الجوال)' : 'اهتزاز اليد', [true, false], ['شغال', 'طافي'], 'تهتز مع الإقلاع والهبوط والصدمات وتحذير البطارية' + (touchDev() ? ' (الآيفون ما يدعم اهتزاز المواقع).' : '.')) +
        '</div><div class="row"><button class="btn" data-act="testRumble">📳 جرّب الاهتزاز</button><button class="btn" data-act="testVoice">🗣️ جرّب صوت المدرب</button></div>';
    } else {
      body = '<div class="opts">' + row('unlockAll', 'فتح الدروس', [false, true], ['بالترتيب (أنصح فيه)', 'افتح كل شي']) + '</div>' +
        '<div class="row"><button class="btn bad" data-act="reset">🗑 مسح تقدمي</button><button class="btn" data-act="resetSet">↺ رجّع الإعدادات الافتراضية</button></div>';
    }
    const tabs = '<div class="tabs">' + TABS.map(([k, n]) => '<button class="btn chip tab ' + (k === tab ? 'on default' : '') + '" data-act="tab" data-arg="' + k + '">' + n + '</button>').join('') + (touchNoPad() ? '' : '<small class="note">LB / RB = تتنقل بين الأقسام</small>') + '</div>';
    const goBack = () => { UI._setTab = null; UI._setFrom = null; if (from === 'pause') UI.show('pause'); else UI.show('main'); };
    const setTab = k => { UI._setTab = k; UI.show('settings', { tab: k, from }); const b = UI.root.querySelector('.tab.on'); if (b) UI.focus(b); };
    const gkChanged = () => { const G = DS.Geo3D; if (G) tryf(() => { if (isFn(G.setKey)) G.setKey(st.googleKey || ''); else if (isFn(G.reload)) G.reload(); }); };
    const acts = {
        // مفتاح خرائط قوقل: نخزنه بعد التنظيف، وما نطبعه بأي مكان (يطلع مخفي)
        gkSave: () => {
          const el = $('gkIn'), v = U.cleanKey(el ? String(el.value || '').trim() : '');
          if (el) el.value = '';
          if (!v || v.length < 20) { toast('المفتاح مو صحيح — انسخه كامل (حروف وأرقام بس)', 'bad'); return; }
          st.googleKey = v; DS.saveSettings(); gkChanged(); toast('انحفظ مفتاحك ✓', 'good'); UI.refresh();
        },
        gkClear: () => { st.googleKey = ''; DS.saveSettings(); gkChanged(); toast('انمسح مفتاحك — نرجع لمفتاح الموقع', 'info'); UI.refresh(); },
        tab: k => setTab(k),
        set: a => {
          const i = a.indexOf('|'), k = a.slice(0, i), v = JSON.parse(a.slice(i + 1));
          DS.settings[k] = v; DS.saveSettings();
          if (k === 'sound' && !v && DS.Audio) DS.Audio.motor(false, 0, 0);
          if (k === 'voice' && !v && DS.Voice && DS.Voice.stop) DS.Voice.stop();
          if (k === 'tvMode' && DS.applyTvMode) DS.applyTvMode();
          if (k === 'quality' && DS.app.R && DS.app.R.setQuality && !DS.app.R.qOverride) tryf(() => DS.app.R.setQuality(v));
          UI.refresh();
        },
        exp: a => { const [m, k] = a.split(':'); st.djiExp = st.djiExp || {}; st.djiExp[m] = Object.assign({}, EXP[m][k]); DS.saveSettings(); UI.refresh(); },
        rates: k => { if (DS.Rates && DS.Rates.applyPreset) DS.Rates.applyPreset(k); else { st.ratePreset = k; DS.saveSettings(); } UI.refresh(); },
        calib: () => { UI._cal = null; UI.show('calib', { from }); },
        remap: () => { if (!I.connected) { toast('وصّل اليد واضغط أي زر أول', 'bad'); return; } UI._rm = null; UI.show('remap', { from }); },
        unmap: () => { if (isFn(I.resetRemap) && I.resetRemap()) toast('رجّعنا التوزيع الافتراضي ✓', 'good'); else toast('ما فيه توزيع خاص لهاليد', 'info'); UI.refresh(); },
        testRumble: () => { const ok = (isFn(I.rumble) && I.rumble(1, 0.6, 450)) || (!I.connected && st.rumble !== false && DS.Touch && isFn(DS.Touch.vibrate) && DS.Touch.vibrate(300, true)); if (!ok) toast(st.rumble === false ? 'الاهتزاز طافي من الإعدادات' : 'اليد ما تدعم الاهتزاز أو مو متصلة', 'info'); },
        testVoice: () => { const ok = DS.Voice && DS.Voice.say && DS.Voice.say('هلا! أنا المدرب، بعلمك الطيران خطوة بخطوة', { priority: 'high' }); if (!ok) toast(st.voice === false ? 'صوت المدرب طافي من الإعدادات' : (DS.Voice && typeof DS.Voice.needsGesture === 'function' && tryf(() => DS.Voice.needsGesture(), false)) ? 'انقر بالماوس أو اضغط Enter مرة وحدة وبعدين جرّب' : 'الصوت الناطق مو مدعوم هنا', 'info'); },
        reset: () => UI.show('confirm', {
          q: 'متأكد تبي تمسح كل نتايجك وتقدمك؟ (الكورس، الميداليات، المهام، الاختبارات)',
          yes: () => { DS.progress = DS.defaultProgress ? DS.defaultProgress() : { best: {}, exams: [], lessons: {}, flightTime: 0, course: {} }; DS.saveProgress(); if (DS.Theory) DS.Theory.resetStats(); toast('انمسح التقدم', 'info'); UI.show('settings', { tab: 'prog', from }); },
          no: () => UI.show('settings', { tab: 'prog', from })
        }),
        resetSet: () => UI.show('confirm', {
          q: 'ترجع كل الإعدادات للافتراضي؟ (توزيع ومعايرة اليد يبقون)',
          yes: () => { if (DS.resetSettings) DS.resetSettings(false); if (DS.applyTvMode) DS.applyTvMode(); UI.show('settings', { tab: 'prog', from }); },
          no: () => UI.show('settings', { tab: 'prog', from })
        }),
        back: goBack
      };
    return {
      cls: 'menu settings',
      html: head('⚙️ الإعدادات', 'تنحفظ تلقائياً') + tabs + body + '<div class="row"><button class="btn" data-act="back">↩ رجوع (B)</button></div>' + navHint(),
      acts,
      back: goBack,
      // خانة المفتاح: Enter = حفظ • Esc = تطلع من الخانة (الأسهم و Backspace للكتابة مو للقائمة)
      bind(root) {
        const el = root.querySelector('#gkIn');
        if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); acts.gkSave(); } else if (e.key === 'Escape') { e.preventDefault(); el.blur(); } });
      },
      onButton: k => { if (k === 'LB' || k === 'RB') { const i = TABS.findIndex(t => t[0] === tab); setTab(TABS[(i + (k === 'RB' ? 1 : TABS.length - 1)) % TABS.length][0]); } },
      tick(dt) { if (tab !== 'ctl') return; this._t = (this._t || 0) + dt; if (this._t > 0.5) { this._t = 0; const el = $('padSt'); if (el) { const h = padStatus(); if (h !== this._h) { this._h = h; el.innerHTML = h; } } } }
    };
  };
  // مفتاح خرائط قوقل (اختياري): خانة مخفية الحروف + الحالي مخفي (آخر 4 حروف بس)
  function gkRow(st) {
    const k = U.cleanKey(st.googleKey || '');
    return '<div class="opt gk"><b>مفتاح خرائط قوقل (اختياري):</b>' +
      '<input id="gkIn" class="gkin" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="100" dir="ltr" placeholder="AIza…">' +
      '<button class="btn chip" data-act="gkSave">💾 حفظ</button>' + (k ? '<button class="btn chip" data-act="gkClear">🗑 مسح</button>' : '') +
      '<span class="note">الحالي: <bdi class="gkcur">' + (k ? '••••••••' + esc(k.slice(-4)) : 'مفتاح الموقع') + '</bdi> • الموقع فيه مفتاح جاهز، ما تحتاج تحط شي إلا إذا عندك مفتاحك الخاص (لخريطة أكاديمية طويق <bdi dir="ltr">3D</bdi>). ينحفظ بجهازك بس.</span></div>';
  }

  // ---------------- معايرة العصي ----------------
  const liveSticks = () => '<div class="live"><div class="gim"><i class="dot" id="dL"></i><label>العصا اليسار</label></div><div class="gim"><i class="dot" id="dR"></i><label>العصا اليمين</label></div></div><pre class="axv" id="axV"></pre>';
  function drawLive(useCal) {
    const I = DS.Input, v = useCal ? I.cal : I.raw, dl = $('dL'), dr = $('dR'), t = $('axV');
    if (!dl || !v) return;
    const r = 64;
    dl.style.transform = 'translate(' + (U.clamp(v.lx, -1.2, 1.2) * r).toFixed(1) + 'px,' + (U.clamp(v.ly, -1.2, 1.2) * r).toFixed(1) + 'px)';
    dr.style.transform = 'translate(' + (U.clamp(v.rx, -1.2, 1.2) * r).toFixed(1) + 'px,' + (U.clamp(v.ry, -1.2, 1.2) * r).toFixed(1) + 'px)';
    if (t) t.textContent = 'LX ' + U.fmt(v.lx, 2) + '  LY ' + U.fmt(v.ly, 2) + '   RX ' + U.fmt(v.rx, 2) + '  RY ' + U.fmt(v.ry, 2) + '   LT ' + U.fmt(I.raw.lt || 0, 2) + '  RT ' + U.fmt(I.raw.rt || 0, 2);
  }
  S.calib = (arg) => {
    const I = DS.Input, from = (arg && arg.from) || 'main';
    const st = UI._cal || (UI._cal = { phase: 'idle', msg: '', ok: null });
    const conn = I.connected && isFn(I.startCalibration);
    let msg, btns;
    if (!conn) { msg = 'وصّل اليد واضغط أي زر فيها<small>المعايرة تحتاج يد تحكم (مو الكيبورد)</small>'; btns = '<button class="btn default" data-act="back">↩ رجوع</button>'; }
    else if (st.phase === 'centre') { msg = '✋ اترك العصاتين بالنص ولا تلمسها…<small>ثانية وحدة</small>'; btns = '<button class="btn" data-act="cancel">إلغاء</button>'; }
    else if (st.phase === 'range') { msg = '🔄 دوّر العصاتين دواير كاملة للآخر (3 مرات)<small>وبعدين اضغط A أو «خلصت»</small>'; btns = '<button class="btn big default" data-act="finish">✓ خلصت</button><button class="btn" data-act="cancel">إلغاء</button>'; }
    else {
      msg = st.msg ? (st.ok ? '✅ ' : '⚠️ ') + esc(st.msg) : 'المعايرة تخلي النص نص بالضبط والآخر آخر<small>سوّ الخطوة 1 وبعدين 2</small>';
      btns = '<button class="btn big default" data-act="centre">1) معايرة النص</button><button class="btn" data-act="range">2) معايرة المدى</button><button class="btn" data-act="reset">مسح المعايرة</button><button class="btn" data-act="back">↩ رجوع</button>';
    }
    const acts = {
        centre: () => { if (I.startCalibration('centre')) { st.phase = 'centre'; UI.show('calib', arg); } },
        range: () => { if (I.startCalibration('range')) { st.phase = 'range'; UI.show('calib', arg); } },
        finish: () => { const r = I.finishCalibration(); st.phase = 'idle'; st.ok = !!(r && r.ok); st.msg = (r && r.msg) || ''; UI.show('calib', arg); },
        cancel: () => { if (isFn(I.cancelCalibration)) I.cancelCalibration(); st.phase = 'idle'; st.msg = ''; UI.show('calib', arg); },
        reset: () => { const ok = isFn(I.resetCalibration) && I.resetCalibration(); st.ok = ok; st.msg = ok ? 'انمسحت المعايرة' : 'ما فيه معايرة محفوظة'; UI.show('calib', arg); },
        back: () => { if (I.calibration && I.calibration.active && isFn(I.cancelCalibration)) I.cancelCalibration(); UI._cal = null; UI.show('settings', { tab: 'ctl', from }); }
    };
    return {
      cls: 'menu calib', noNav: st.phase === 'range' || st.phase === 'centre',
      html: head('🎯 معايرة العصي', conn ? esc(I.name) : '') + liveSticks() + '<div class="wiz">' + msg + '</div>' +
        '<p class="note" id="calNote" style="text-align:center"></p><div class="row" style="justify-content:center">' + btns + '</div>' + navHint(),
      acts,
      back: acts.back,
      tick(dt) {
        drawLive(true);
        if (st.phase === 'centre' && !(I.calibration && I.calibration.active)) {
          const r = I.calibration && I.calibration.result; st.phase = 'idle'; st.ok = !!(r && r.ok); st.msg = (r && r.msg) || '';
          UI.show('calib', arg);
        } else if (st.phase === 'range' && !(I.calibration && I.calibration.active)) {
          const r = I.calibration && I.calibration.result; st.phase = 'idle'; st.ok = !!(r && r.ok); st.msg = (r && r.msg) || 'انتهى الوقت';
          UI.show('calib', arg);
        }
        if (!conn && I.connected) UI.show('calib', arg);
        this._t = (this._t || 0) + dt;
        if (this._t > 0.4) {
          this._t = 0; const n = $('calNote');
          if (n) n.innerHTML = I.driftWarn ? '<span class="warn">⚠️ العصا تنحرف لحالها وهي مرتاحة — سوّ معايرة النص</span>' : (I.badAxes && I.badAxes.length ? '<span class="bad">⚠️ محور واقف على الطرف: ' + esc(I.badAxes.join(', ')) + ' — سوّ توزيع الأزرار</span>' : '');
        }
      }
    };
  };

  // ---------------- توزيع الأزرار (لليد غير القياسية) ----------------
  const RM = [
    ['lx', 'axis', 'حرّك العصا اليسار لليمين ➡ للآخر'], ['ly', 'axis', 'حرّك العصا اليسار لتحت ⬇ للآخر'],
    ['rx', 'axis', 'حرّك العصا اليمين لليمين ➡ للآخر'], ['ry', 'axis', 'حرّك العصا اليمين لتحت ⬇ للآخر'],
    ['lt', 'trig', 'اضغط الزناد اليسار LT (L2) للآخر'], ['rt', 'trig', 'اضغط الزناد اليمين RT (R2) للآخر'],
    ['A', 'btn', 'اضغط زر A (في بلايستيشن ✕)'], ['B', 'btn', 'اضغط زر B (○)'], ['X', 'btn', 'اضغط زر X (□)'], ['Y', 'btn', 'اضغط زر Y (△)'],
    ['LB', 'btn', 'اضغط LB (L1) — الزر اللي فوق الزناد اليسار'], ['RB', 'btn', 'اضغط RB (R1) — الزر اللي فوق الزناد اليمين'],
    ['VIEW', 'btn', 'اضغط زر VIEW ⧉ (في بلايستيشن Create أو Share)'], ['START', 'btn', 'اضغط زر START ☰ (في بلايستيشن Options)'],
    ['UP', 'btn', 'اضغط السهم فوق ▲'], ['DOWN', 'btn', 'اضغط السهم تحت ▼'], ['LEFT', 'btn', 'اضغط السهم يسار ◀'], ['RIGHT', 'btn', 'اضغط السهم يمين ▶']
  ];
  const RM_SHORT = { lx: 'L↔', ly: 'L↕', rx: 'R↔', ry: 'R↕', lt: 'LT', rt: 'RT' };
  function rmFinish(st) {
    const map = st.map, b = map.buttons;
    // D-pad على محور واحد = POV hat
    const cnt = {};
    ['UP', 'DOWN', 'LEFT', 'RIGHT'].forEach(k => { const e = b[k]; if (e && typeof e === 'object') cnt[e.a] = (cnt[e.a] || 0) + 1; });
    for (const a in cnt) if (cnt[a] >= 2) { map.hat = +a; ['UP', 'DOWN', 'LEFT', 'RIGHT'].forEach(k => { const e = b[k]; if (e && typeof e === 'object' && e.a === +a) b[k] = -1; }); }
    map.gate = 'round';
    const ok = DS.Input.setRemap(map);
    st.done = true; st.saved = ok;
  }
  S.remap = (arg) => {
    const I = DS.Input, from = (arg && arg.from) || 'main';
    const st = UI._rm || (UI._rm = { i: 0, phase: 'wait', t: 0, snap: null, map: { axes: {}, buttons: {} }, got: {}, done: false });
    if (st.done) {
      const rows = RM.map(([k]) => { const g = st.got[k]; return '<i class="' + (g ? 'ok' : 'skip') + '">' + (RM_SHORT[k] || k) + ' ' + (g || '—') + '</i>'; }).join('');
      return {
        cls: 'menu remap',
        html: head('🔀 توزيع الأزرار', esc(I.name)) + '<div class="wiz">' + (st.saved ? '✅ تم الحفظ — جرّب العصي والأزرار' : '⚠️ ما انحفظ (اليد انفصلت؟)') + '</div>' + liveSticks() + '<div class="steps2">' + rows + '</div>' +
          '<div class="row" style="justify-content:center"><button class="btn big default" data-act="ok">✓ تمام</button><button class="btn" data-act="again">🔁 عيد التوزيع</button><button class="btn" data-act="reset">↺ رجّع الافتراضي</button></div>' + navHint(),
        acts: {
          ok: () => { UI._rm = null; UI.show('settings', { tab: 'ctl', from }); },
          again: () => { UI._rm = null; UI.show('remap', arg); },
          reset: () => { if (isFn(I.resetRemap)) I.resetRemap(); UI._rm = null; toast('رجّعنا التوزيع الافتراضي', 'info'); UI.show('settings', { tab: 'ctl', from }); }
        },
        back: () => { UI._rm = null; UI.show('settings', { tab: 'ctl', from }); },
        tick() { drawLive(false); }
      };
    }
    const step = RM[st.i];
    const chips = RM.map(([k], j) => '<i class="' + (j < st.i ? (st.got[k] ? 'ok' : 'skip') : j === st.i ? 'cur' : '') + '">' + (RM_SHORT[k] || k) + '</i>').join('');
    const cancel = () => { UI._rm = null; UI.show('settings', { tab: 'ctl', from }); };
    return {
      cls: 'menu remap', capture: true, keepTop: true,
      html: head('🔀 توزيع الأزرار', 'الخطوة ' + (st.i + 1) + ' من ' + RM.length + ' • ' + esc(I.name)) +
        '<div class="wiz" id="rmMsg">' + (st.phase === 'release' ? '✓ تمام — فكّ يدك' : esc(step[2])) + '<small id="rmSub">' + (st.phase === 'wait' ? 'لا تلمس شي…' : 'تتخطى لحالها بعد 12 ثانية إذا ما عندك هالزر') + '</small></div>' +
        liveSticks() + '<div class="steps2">' + chips + '</div>' +
        '<div class="row" style="justify-content:center"><button class="btn" data-act="cancel">إلغاء (Esc)</button></div>',
      acts: { cancel },
      back: cancel,
      tick(dt) {
        drawLive(false);
        if (!I.connected) return;
        st.t += dt;
        const k = step[0], kind = step[1], map = st.map;
        if (st.phase === 'wait') {
          if (st.t > 0.6) { st.snap = I.snapshot(); st.phase = 'listen'; st.t = 0; const s = $('rmSub'); if (s) s.textContent = 'تتخطى لحالها بعد 12 ثانية إذا ما عندك هالزر'; }
          return;
        }
        if (st.phase === 'listen') {
          const m = I.findMoved(st.snap, 0.5);
          const usedAx = new Set(['lx', 'ly', 'rx', 'ry', 'lt', 'rt'].map(a => map.axes[a] && map.axes[a].i).filter(v => v !== undefined));
          const usedBt = new Set(Object.keys(map.buttons).map(b => map.buttons[b]).filter(v => typeof v === 'number'));
          ['lt', 'rt'].forEach(a => { if (map.axes[a] && typeof map.axes[a].b === 'number') usedBt.add(map.axes[a].b); });
          let got = null;
          if (m) {
            if (kind === 'axis' && m.kind === 'axis' && !usedAx.has(m.i)) { map.axes[k] = { i: m.i, inv: m.dir < 0 }; got = 'محور ' + m.i; }
            else if (kind === 'trig' && m.kind === 'axis' && !usedAx.has(m.i)) { map.axes[k] = { i: m.i, range: m.from < -0.5 || m.from > 0.5 ? 'full' : 'half', inv: m.dir < 0 }; got = 'محور ' + m.i; }
            else if (kind === 'trig' && m.kind === 'button' && !usedBt.has(m.i)) { map.axes[k] = { b: m.i }; got = 'زر ' + m.i; }
            else if (kind === 'btn' && m.kind === 'button' && !usedBt.has(m.i)) { map.buttons[k] = m.i; got = 'زر ' + m.i; }
            else if (kind === 'btn' && m.kind === 'axis' && !usedAx.has(m.i)) { map.buttons[k] = { a: m.i, dir: m.dir }; got = 'محور ' + m.i + (m.dir > 0 ? '+' : '−'); }
          }
          if (got) { st.got[k] = got; st.phase = 'release'; st.t = 0; if (DS.Audio) DS.Audio.ok(); const el = $('rmMsg'); if (el) el.innerHTML = '✓ ' + esc(got) + ' — فكّ يدك<small></small>'; }
          else if (st.t > 12) { st.phase = 'release'; st.t = 0; }
          else { const s = $('rmSub'); if (s) s.textContent = 'تتخطى لحالها بعد ' + Math.ceil(12 - st.t) + ' ثانية إذا ما عندك هالزر'; }
          return;
        }
        // release: ننتظر لين يرجع كل شي مثل ما كان
        if (!I.findMoved(st.snap, 0.3) || st.t > 5) {
          st.i++; st.phase = 'wait'; st.t = 0;
          if (st.i >= RM.length) rmFinish(st);
          UI.show('remap', arg);
        }
      }
    };
  };

  // ---------------- تأكيد ----------------
  S.confirm = (o) => ({
    overlay: true, cls: 'menu small',
    html: '<div class="q">' + esc(o.q) + '</div><div class="row"><button class="btn" data-act="yes">نعم</button><button class="btn default" data-act="no">لا</button></div>',
    acts: { yes: () => o.yes(), no: () => o.no() }, back: () => o.no()
  });

  // ---------------- سجلي ----------------
  S.records = () => {
    const P = DS.progress, cs = courseSum(), ps = proSum();
    const mrows = DS.MISSIONS.map(m => '<tr><td>' + m.icon + ' ' + esc(m.title) + '</td>' + DS.DIFF_ORDER.map(k => { const b = P.best[m.id + ':' + k]; return '<td>' + (b ? (b.passed ? '<span class="ok">' + b.total + '</span>' : '<span class="bad">' + b.total + '</span>') : '—') + '</td>'; }).join('') + '</tr>').join('');
    const ex = (P.exams || []).slice(0, 8).map(e => '<tr><td>' + esc(e.title) + '</td><td class="' + (e.passed ? 'ok' : 'bad') + '">' + e.total + (e.passed ? ' ✓' : ' ✗') + '</td><td>' + new Date(e.date).toLocaleDateString('ar-SA') + '</td></tr>').join('');
    const th = DS.Theory ? DS.Theory.historyRows() : '';
    const crow = cs ? '<h3>🎓 الكورس التعليمي</h3>' + pbar(cs.done / Math.max(1, cs.total)) + '<p>' + cs.done + ' من ' + cs.total + ' درس واختبار' + (cs.next ? ' • الجاي: ' + esc(cs.nextTitle) : ' 🎉') + '</p>' : '';
    const prow = ps ? '<h3>🏅 التدريب الاحترافي</h3><table class="tbl"><tr><th>المستوى</th><th>خلصت</th><th>الميداليات</th></tr>' + ps.st.map(L => { const e = L.exercises || [], m = { gold: 0, silver: 0, bronze: 0 }; e.forEach(x => { if (m[x.medal] !== undefined) m[x.medal]++; }); return '<tr><td>' + (LV_IC[L.id] || '') + ' ' + esc(L.name || L.id) + '</td><td>' + e.filter(x => x.done).length + '/' + e.length + '</td><td>' + (medTxt(m) || '—') + '</td></tr>'; }).join('') + '</table>' : '';
    return {
      cls: 'menu', keepTop: true,
      html: head('📊 سجلي', '⏱ وقت الطيران: ' + Math.round((P.flightTime || 0) / 60) + ' دقيقة • 🎓 دروس المبتدئ: ' + DS.LESSONS.filter(l => P.lessons[l.id]).length + '/' + DS.LESSONS.length) +
        crow + prow + (th ? '<h3>📘 الاختبار النظري</h3>' + th : '') +
        '<h3>🎯 المهام</h3><table class="tbl"><tr><th>المهمة</th>' + DS.DIFF_ORDER.map(k => '<th>' + DS.DIFF[k].name + '</th>').join('') + '</tr>' + mrows + '</table>' +
        (ex ? '<h3>🏆 الاختبارات العملية</h3><table class="tbl"><tr><th>الاختبار</th><th>النتيجة</th><th>التاريخ</th></tr>' + ex + '</table>' : '') + backBtn() + navHint(),
      acts: { back: () => UI.show('main') }, back: () => UI.show('main')
    };
  };
})();
