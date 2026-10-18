// التقييم المشترك: درجة الخطأ s()، السلاسة LDLJ، الأخطاء (مثل اختبار GVC البريطاني: 7 بسيطة / 3 كبيرة / 1 أمان)،
// مسجّل الطيران 50 هرتز، الميداليات، وأدوات الكاميرا (إسقاط النقطة على الشاشة + محاذاة سطل NIST).
// منطق فقط: ما يلمس THREE ولا document (يشتغل في الاختبار الذاتي).
(function () {
  const DS = window.DS, U = DS.U;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // ---------------- أساسيات ----------------
  // الخطأ → 0..1 : صفر خطأ = 1، الخطأ = tol أو أكثر = 0
  const s = (e, tol) => (tol > 0 ? Math.max(0, 1 - Math.abs(e) / tol) : (e ? 0 : 1));
  // 1 لين good ثم ينزل خطي لين bad (= 0)
  const band = (e, good, bad) => (e <= good ? 1 : e >= bad ? 0 : 1 - (e - good) / (bad - good));
  // جدول نقاط [[x,y],...] متزايد في x → قيمة بالاستيفاء
  const table = (x, T) => {
    if (x <= T[0][0]) return T[0][1];
    for (let i = 1; i < T.length; i++) if (x <= T[i][0]) { const a = T[i - 1], b = T[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    return T[T.length - 1][1];
  };
  const medal = sc => (sc == null || !(sc >= 0)) ? null : sc >= 90 ? 'gold' : sc >= 80 ? 'silver' : sc >= 70 ? 'bronze' : null;
  const MEDAL_AR = { gold: 'ذهبية', silver: 'فضية', bronze: 'برونزية' };

  // ---------------- نصوص الأخطاء (عربي بسيط) ----------------
  const FAULT_TXT = {
    alt: 'الارتفاع طلع عن الحد المطلوب',
    pos: 'طلعت عن المكان المطلوب',
    head: 'اتجاه وجه الدرون مو صح',
    drift: 'الدرون انجرف وما صححته بسرعة',
    speed: 'السرعة مو ثابتة',
    standoff: 'المسافة عن الهدف مو مضبوطة',
    dist: 'المسافة عن الهدف طلعت عن المطلوب',
    keepout: 'دخلت المنطقة الممنوعة حول الهدف!',
    standoffISR: 'قربت أكثر من المسافة الآمنة عن الهدف',
    collision: 'خبطت في شي',
    ground: 'لمست الأرض بقوة',
    frame: 'الهدف طلع من الكادر',
    lost: 'ضيّعت الهدف',
    falseMark: 'علّمت على شي مو هدف',
    gateMiss: 'فوّت بوابة',
    gateWrong: 'دخلت البوابة من الجهة الغلط',
    missedCap: 'فوّت صورة مطلوبة',
    reversal: 'حرّكت العصا بالعكس (الدرون راح بعيد عن الهدف)',
    overPeople: 'طرت فوق ناس!',
    ceiling: 'تعديت الارتفاع المسموح (120 م)',
    noGnss: 'أقلعت قبل ما يثبت الـ GPS',
    vs: 'نزلت بقوة على المنصة',
    hs: 'لمست المنصة وأنت تتحرك جنب',
    landPos: 'الهبوط بعيد عن نص المنصة',
    goAround: 'كثرت محاولات الهبوط',
    trickAlt: 'نزلت كثير وأنت تسوي الحركة',
    lowAlt: 'بديت الحركة وأنت واطي — خطر!',
    trickBad: 'الحركة ما كانت نظيفة',
    battery: 'البطارية نزلت تحت الاحتياط',
    callout: 'ما بلّغت (السهم ▶) في وقته',
    mode: 'الوضع غلط لهالمهمة',
    sight: 'ضيّعت الدرون من عينك',
    timeout: 'خلص الوقت',
    hesitate: 'تأخرت وأنت متردد',
    abort: 'ما ألغيت الهبوط وقت الخطر'
  };
  const CLS_AR = { minor: 'خطأ بسيط', major: 'خطأ كبير', safety: 'خطأ أمان' };

  // ---------------- مدير الأخطاء (GVC: 7 بسيطة أو 3 كبيرة أو 1 أمان = رسوب) ----------------
  // opts: {minor:7, major:3, safety:1} أو {limits:{...}}، minT (أقصر طلعة تنحسب، ث)، majorT (2 ث)، k2 (2× الحد)
  //       rearm (ث، افتراضي 0): الطلعة ما تنقفل إلا بعد ما ترجع داخل الحد rearm ثانية — طلعة ثانية قبلها = نفس الطلعة (ما تنحسب مرتين)
  //       gap (ث، افتراضي 0 = طافي): لو track ما انطلب أكثر من gap ث (القياس وقف) نقفل الطلعة عند آخر قياس — ما تبقى مفتوحة وتصير "كبيرة" بعدين
  class FaultManager {
    constructor(opts) {
      opts = opts || {};
      const L = opts.limits || opts;
      this.lim = { minor: L.minor != null ? +L.minor : 7, major: L.major != null ? +L.major : 3, safety: L.safety != null ? +L.safety : 1 };
      this.minT = opts.minT != null ? opts.minT : 0.3;
      this.majorT = opts.majorT != null ? opts.majorT : 2;
      this.k2 = opts.k2 != null ? opts.k2 : 2;
      this.rearm = opts.rearm > 0 ? +opts.rearm : 0;
      this.gap = opts.gap > 0 ? +opts.gap : 0;
      this.minor = 0; this.major = 0; this.safety = 0; this.log = []; this.t = 0;
      this.onFault = typeof opts.onFault === 'function' ? opts.onFault : null;
      this._trk = {};
    }
    // cls: 'minor' | 'major' | 'safety' ، code من FAULT_TXT (أو أي نص)، t = الوقت، text اختياري
    add(cls, code, t, text) {
      if (cls !== 'minor' && cls !== 'major' && cls !== 'safety') cls = 'minor';
      this[cls]++;
      const e = { cls, code: code || cls, t: t != null && isFinite(t) ? Math.round(t * 10) / 10 : this.t, text: text || FAULT_TXT[code] || '' };
      this.log.push(e);
      if (this.log.length > 300) this.log.shift();
      if (this.onFault) { try { this.onFault(e, this); } catch (er) { /* المستمع اختياري */ } }
      return e;
    }
    get counts() { return { minor: this.minor, major: this.major, safety: this.safety }; }
    get failed() { return this.safety >= this.lim.safety || this.minor >= this.lim.minor || this.major >= this.lim.major; }
    // خصم الدرجة: 5 لكل بسيط و15 لكل كبير (الأمان = صفر)
    penalty() { return 5 * this.minor + 15 * this.major; }
    apply(score) { return this.safety > 0 ? 0 : U.clamp(Math.round(score - this.penalty()), 0, 100); }
    // مراقبة حد: err و tol بنفس الوحدة. طلعة أقصر من 2 ث وأقل من 2× الحد = بسيط، غير كذا = كبير (مرة وحدة لكل طلعة)
    // يرجع 0 داخل الحد، 1 برا، 2 برا وصار كبير
    // الطلعة = من أول ما يطلع لين يرجع داخل rearm ثانية. مدتها = مجموع الوقت برا (مو الوقت اللي رجع فيه داخل)
    track(code, err, tol, t, text) {
      let st = this._trk[code];
      if (!st) st = this._trk[code] = { out: false, open: false, t0: 0, s0: 0, acc: 0, inT: 0, lt: null, max: 0, big: false, txt: '' };
      if (t != null) this.t = t;
      const now = this.t;
      // القياس وقف فترة (مثلاً الاتجاه ما ينحسب وقت اللف بالزوايا): الطلعة تنتهي عند آخر قياس
      if (this.gap > 0 && st.out && st.lt != null && now - st.lt > this.gap) { st.acc += st.lt - st.s0; st.out = false; st.inT = st.lt; }
      st.lt = now;
      if (text) st.txt = text;
      if (err > tol) {
        if (st.open && !st.out && now - st.inT >= this.rearm) this._close(st, code, now);
        if (!st.open) { st.open = true; st.t0 = now; st.acc = 0; st.max = err; st.big = false; }
        if (!st.out) { st.out = true; st.s0 = now; }
        if (err > st.max) st.max = err;
        if (!st.big && (st.acc + now - st.s0 >= this.majorT || err > this.k2 * tol)) { st.big = true; this.add('major', code, now, st.txt || text); }
        return st.big ? 2 : 1;
      }
      if (st.out && err <= tol * 0.95) { st.out = false; st.acc += now - st.s0; st.inT = now; }
      if (st.open && !st.out && now - st.inT >= this.rearm) this._close(st, code, now);
      return st.out ? (st.big ? 2 : 1) : 0;
    }
    _close(st, code, now) {
      st.open = false;
      if (!st.big && st.acc >= this.minT) this.add('minor', code, now, st.txt);
    }
    // ينهي أي طلعة مفتوحة (آخر المهمة)
    flush(t) {
      const now = t != null ? t : this.t;
      for (const k in this._trk) {
        const st = this._trk[k];
        if (st.out) { st.acc += now - st.s0; st.out = false; st.inT = now; }
        if (st.open) { st.open = false; if (!st.big && st.acc >= this.minT) this.add('minor', k, t); }
      }
    }
    reset() { this.minor = this.major = this.safety = 0; this.log.length = 0; this._trk = {}; }
    summary() {
      const parts = [];
      if (this.safety) parts.push(this.safety + ' أمان');
      if (this.major) parts.push(this.major + ' كبيرة');
      if (this.minor) parts.push(this.minor + ' بسيطة');
      return parts.length ? 'الأخطاء: ' + parts.join('، ') : 'بدون أخطاء ✓';
    }
    toJSON() {
      return { minor: this.minor, major: this.major, safety: this.safety, failed: this.failed, limits: Object.assign({}, this.lim), log: this.log.slice() };
    }
  }
  FaultManager.text = code => FAULT_TXT[code] || '';

  // ---------------- LDLJ على مصفوفات (بدون إنشاء كائنات) ----------------
  // X,Y,Z: Float64Array (تتعدل: تنعيم)، n عدد العينات، dt الخطوة. نفس معادلة U.ldlj
  function lp(A, n, a) {
    let y = A[0];
    for (let i = 0; i < n; i++) { y += a * (A[i] - y); A[i] = y; }
    y = A[n - 1];
    for (let i = n - 1; i >= 0; i--) { y += a * (A[i] - y); A[i] = y; }
  }
  function ldljArr(X, Y, Z, n, dt, lowpass) {
    if (n < 8 || !(dt > 0)) return null;
    const fc = lowpass == null ? 5 : lowpass;
    if (fc > 0) { const a = 1 - Math.exp(-2 * Math.PI * fc * dt); lp(X, n, a); lp(Y, n, a); lp(Z, n, a); }
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
    const T = dt * (n - 1);
    return U.clamp(-Math.log(Math.pow(T, 5) / (L * L) * Math.max(J, 1e-12)), -40, 0);
  }

  // ---------------- مسجّل الطيران (50 هرتز) ----------------
  // القنوات: t, p(x,y,z), v(x,y,z), yaw, gimbal, sticks(thr,yaw,pitch,roll), cam (اتجاه الكاميرا fx,fy,fz)
  const CH = ['t', 'px', 'py', 'pz', 'vx', 'vy', 'vz', 'yaw', 'gim', 'sT', 'sY', 'sP', 'sR', 'fx', 'fy', 'fz'];
  class Recorder {
    constructor(hz, cap) {
      this.hz = hz || 50; this.dt = 1 / this.hz; this.cap = Math.max(64, cap || 3000);
      this.n = 0; this.acc = 0; this.t = 0; this.on = true; this.marks = [];
      this.a = {};
      for (const k of CH) this.a[k] = new Float64Array(this.cap);   // 64 بت: الـ jerk (فرق ثالث) حساس للدقة
      this._X = null; this._Y = null; this._Z = null;
    }
    reset() { this.n = 0; this.acc = 0; this.t = 0; this.marks.length = 0; }
    mark() { this.marks.push(this.n); return this.n; }
    _grow() {
      const nc = this.cap * 2;
      for (const k of CH) { const o = this.a[k], nn = new Float64Array(nc); nn.set(o); this.a[k] = nn; }
      this.cap = nc;
    }
    // كل خطوة: d = الدرون، gimbal (درجة)، sticks = العصي {thr,yaw,pitch,roll}، cam = {fwd} اختياري
    update(dt, d, gimbal, sticks, cam) {
      this.t += dt;
      if (!this.on) return;
      this.acc += dt;
      if (this.acc + 1e-9 < this.dt) return;
      this.acc -= this.dt; if (this.acc > this.dt) this.acc = 0;
      this.push(this.t, d, gimbal, sticks, cam);
    }
    push(t, d, gimbal, sticks, cam) {
      if (this.n >= this.cap) this._grow();
      const i = this.n++, a = this.a;
      a.t[i] = t; a.px[i] = d.p.x; a.py[i] = d.p.y; a.pz[i] = d.p.z; a.vx[i] = d.v.x; a.vy[i] = d.v.y; a.vz[i] = d.v.z;
      a.yaw[i] = d.yaw; a.gim[i] = gimbal || 0;
      if (sticks) { a.sT[i] = sticks.thr || 0; a.sY[i] = sticks.yaw || 0; a.sP[i] = sticks.pitch || 0; a.sR[i] = sticks.roll || 0; }
      if (cam && cam.fwd) { a.fx[i] = cam.fwd.x; a.fy[i] = cam.fwd.y; a.fz[i] = cam.fwd.z; }
    }
    // عينة وحدة بالشكل اللي يحتاجه U.ldlj (out اختياري عشان ما ننشئ)
    sample(i, out) {
      const a = this.a;
      out = out || { t: 0, p: { x: 0, y: 0, z: 0 }, v: { x: 0, y: 0, z: 0 }, yaw: 0, gimbal: 0, sticks: { thr: 0, yaw: 0, pitch: 0, roll: 0 } };
      out.t = a.t[i]; out.p.x = a.px[i]; out.p.y = a.py[i]; out.p.z = a.pz[i]; out.v.x = a.vx[i]; out.v.y = a.vy[i]; out.v.z = a.vz[i];
      out.yaw = a.yaw[i]; out.gimbal = a.gim[i];
      out.sticks.thr = a.sT[i]; out.sticks.yaw = a.sY[i]; out.sticks.pitch = a.sP[i]; out.sticks.roll = a.sR[i];
      return out;
    }
    toArray(i0, i1) { const r = []; i0 = i0 || 0; i1 = i1 == null ? this.n : i1; for (let i = i0; i < i1; i++) r.push(this.sample(i)); return r; }
    // LDLJ لقناة: 'p' المكان، 'cam' اتجاه الكاميرا، 'yaw' (زاوية)، 'gim' (درجة)
    ldlj(ch, i0, i1, lowpass) {
      i0 = Math.max(0, i0 || 0); i1 = Math.min(this.n, i1 == null ? this.n : i1);
      const n = i1 - i0;
      if (n < 8) return null;
      if (!this._X || this._X.length < n) { const c = Math.max(n, 512); this._X = new Float64Array(c); this._Y = new Float64Array(c); this._Z = new Float64Array(c); }
      const X = this._X, Y = this._Y, Z = this._Z, a = this.a;
      if (ch === 'cam') for (let i = 0; i < n; i++) { X[i] = a.fx[i0 + i]; Y[i] = a.fy[i0 + i]; Z[i] = a.fz[i0 + i]; }
      else if (ch === 'yaw') { X[0] = a.yaw[i0]; Y[0] = 0; Z[0] = 0; for (let i = 1; i < n; i++) { X[i] = X[i - 1] + U.wrap(a.yaw[i0 + i] - a.yaw[i0 + i - 1]); Y[i] = 0; Z[i] = 0; } }
      else if (ch === 'gim') for (let i = 0; i < n; i++) { X[i] = a.gim[i0 + i] * D2R; Y[i] = 0; Z[i] = 0; }
      else for (let i = 0; i < n; i++) { X[i] = a.px[i0 + i]; Y[i] = a.py[i0 + i]; Z[i] = a.pz[i0 + i]; }
      const dt = (a.t[i1 - 1] - a.t[i0]) / (n - 1);
      return ldljArr(X, Y, Z, n, dt, lowpass);
    }
    // متوسط LDLJ على نوافذ (win ثواني) — أثبت للمقاطع الطويلة
    ldljWin(ch, i0, i1, win) {
      i0 = Math.max(0, i0 || 0); i1 = Math.min(this.n, i1 == null ? this.n : i1);
      const m = Math.max(16, Math.round((win || 8) * this.hz));
      let sum = 0, k = 0;
      for (let a = i0; a + m <= i1; a += m) { const v = this.ldlj(ch, a, a + m); if (v != null) { sum += v; k++; } }
      if (!k) return this.ldlj(ch, i0, i1);
      return sum / k;
    }
    // متوسط/انحراف/CV لقناة رقمية
    stats(ch, i0, i1) {
      const A = this.a[ch]; i0 = Math.max(0, i0 || 0); i1 = Math.min(this.n, i1 == null ? this.n : i1);
      let m = 0, q = 0; const n = i1 - i0;
      if (!A || n < 1) return { mean: 0, sd: 0, cv: 0, n: 0 };
      for (let i = i0; i < i1; i++) m += A[i];
      m /= n;
      for (let i = i0; i < i1; i++) q += (A[i] - m) * (A[i] - m);
      const sd = Math.sqrt(q / n);
      return { mean: m, sd, cv: Math.abs(m) > 1e-6 ? sd / Math.abs(m) : 0, n };
    }
    // نسخة مضغوطة للمسار (للشبح): Float32Array [t,x,y,z,...]
    track(i0, i1) {
      i0 = Math.max(0, i0 || 0); i1 = Math.min(this.n, i1 == null ? this.n : i1);
      const out = new Float32Array(Math.max(0, i1 - i0) * 4), a = this.a, t0 = i1 > i0 ? a.t[i0] : 0;
      for (let i = i0, k = 0; i < i1; i++, k += 4) { out[k] = a.t[i] - t0; out[k + 1] = a.px[i]; out[k + 2] = a.py[i]; out[k + 3] = a.pz[i]; }
      return out;
    }
  }

  // ---------------- السلاسة: LDLJ → 0..1 مقارنة بالمرجع (طيران المدرب) ----------------
  // ref = قيمة المدرب (الأعلى أنعم)، span = كم أسوأ لين توصل صفر
  const smooth = (v, ref, span) => (v == null ? 0.7 : band(Math.max(0, (ref == null ? -8 : ref) - v), 0, span || 8));

  // ---------------- متوسط وانحراف (للـ CV) بدون مصفوفات ----------------
  class Stat {
    constructor() { this.n = 0; this.m = 0; this.q = 0; }
    add(x) { this.n++; const d = x - this.m; this.m += d / this.n; this.q += d * (x - this.m); }
    get mean() { return this.m; }
    get sd() { return this.n > 1 ? Math.sqrt(this.q / this.n) : 0; }
    get cv() { return Math.abs(this.m) > 1e-9 ? this.sd / Math.abs(this.m) : 0; }
    get rms() { return Math.sqrt(this.m * this.m + (this.n > 1 ? this.q / this.n : 0)); }
    reset() { this.n = 0; this.m = 0; this.q = 0; }
  }

  // ---------------- الكاميرا: إسقاط نقطة على الشاشة ----------------
  // cam = ctx.camera() → {pos, fwd, up, vfovDeg}. out = {x, y (NDC: -1..1)، depth، dist، ok (قدام الكاميرا)، inFrame}
  const ASPECT = 16 / 9;
  function project(cam, x, y, z, out, aspect) {
    out = out || { x: 0, y: 0, depth: 0, dist: 0, ok: false, inFrame: false };
    const f = cam.fwd, u = cam.up, P = cam.pos;
    const rx = f.y * u.z - f.z * u.y, ry = f.z * u.x - f.x * u.z, rz = f.x * u.y - f.y * u.x;   // يمين = قدام × فوق
    const dx = x - P.x, dy = y - P.y, dz = z - P.z;
    const zc = dx * f.x + dy * f.y + dz * f.z;
    const tv = Math.tan((cam.vfovDeg || 43) * D2R / 2), th = tv * (aspect || ASPECT);
    out.depth = zc; out.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    out.ok = zc > 0.05;
    if (out.ok) { out.x = (dx * rx + dy * ry + dz * rz) / (zc * th); out.y = (dx * u.x + dy * u.y + dz * u.z) / (zc * tv); }
    else { out.x = 9; out.y = 9; }
    out.inFrame = out.ok && Math.abs(out.x) <= 1 && Math.abs(out.y) <= 1;
    return out;
  }
  // خطأ الكادر: المسافة عن نقطة التكوين (tx,ty) كجزء من الصورة (0 = بالنص، 1 = برا)
  const framing = (pr, tx, ty) => (pr.ok ? Math.hypot(pr.x - (tx || 0), pr.y - (ty || 0)) / 2 : 1);
  // حجم شي على الشاشة بالبكسل (ارتفاع الصورة pxH، الافتراضي 1080)
  const pxSize = (size, dist, vfovDeg, pxH) => (size / Math.max(dist, 0.01)) * (pxH || 1080) / ((vfovDeg || 43) * D2R);
  // زاوية الكادر (درجات) اللي تقابل جزء tol من الصورة (للمؤشر في الـ HUD)
  const fracDeg = (tol, vfovDeg) => Math.atan(2 * tol * Math.tan((vfovDeg || 43) * D2R / 2)) * R2D;

  // ---------------- محاذاة سطل NIST ----------------
  // pose = DS.bucketPose(...) → {x,y,z (قاع السطل), ax,ay,az (اتجاه الفتحة)}. opts: {rRing, rTop, depth, minPx:20, frame:0.8}
  // يرجع out = {inFrame, px (حجم الحلقة)، theta (درجة عن المحور)، full (الحلقة كاملة)، part (جزء منها)، pts5 (5/1/0)، ok (ينحسب)}
  function bucketAlign(cam, pose, opts, out) {
    out = out || { inFrame: false, px: 0, theta: 180, full: false, part: false, pts5: 0, ok: false, ndcX: 9, ndcY: 9, dist: 0 };
    const BK = DS.BUCKET || { rTop: 0.13, rRing: 0.08, depth: 0.23 };
    const rRing = opts && opts.rRing || BK.rRing, rTop = opts && opts.rTop || BK.rTop, depth = opts && opts.depth || BK.depth;
    const minPx = opts && opts.minPx != null ? opts.minPx : 20, fr = opts && opts.frame != null ? opts.frame : 0.8;
    const P = cam.pos, vx = P.x - pose.x, vy = P.y - pose.y, vz = P.z - pose.z, dist = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1e-6;
    const c = (vx * pose.ax + vy * pose.ay + vz * pose.az) / dist;
    out.theta = Math.acos(U.clamp(c, -1, 1)) * R2D; out.dist = dist;
    const pr = project(cam, pose.x, pose.y, pose.z, _pr);
    out.ndcX = pr.x; out.ndcY = pr.y;
    out.inFrame = pr.ok && Math.abs(pr.x) <= fr && Math.abs(pr.y) <= fr;
    out.px = pxSize(2 * rRing, dist, cam.vfovDeg);
    const full = Math.atan((rTop - rRing) / depth) * R2D, part = Math.atan((rTop + rRing) / depth) * R2D;   // ≈12.3° و ≈42.4°
    out.ok = out.inFrame && out.px >= minPx;
    out.full = out.ok && out.theta <= full;
    out.part = out.ok && out.theta <= part;
    out.pts5 = out.full ? 5 : out.part ? 1 : 0;
    return out;
  }
  const _pr = { x: 0, y: 0, depth: 0, dist: 0, ok: false, inFrame: false };

  DS.Score = {
    s, band, table, medal, MEDAL_AR, FAULT_TXT, CLS_AR,
    ldlj: (samples, opts) => (U.ldlj ? U.ldlj(samples, opts) : null),
    ldljArr, smooth, Stat,
    FaultManager, Recorder,
    project, framing, pxSize, fracDeg, bucketAlign, ASPECT,
    // الدرجة النهائية: مجموع (وزن × جزء) − 5×بسيط − 15×كبير، والأمان = صفر
    combine(parts, weights, fm) {
      let w = 0, sum = 0;
      for (const k in weights) { const wk = +weights[k] || 0; if (!wk || parts[k] == null) continue; w += wk; sum += wk * U.clamp(parts[k], 0, 1); }
      let sc = w > 0 ? 100 * sum / w : 0;
      if (fm) { if (fm.safety > 0) return 0; sc -= 5 * fm.minor + 15 * fm.major; }
      return U.clamp(Math.round(sc), 0, 100);
    }
  };
})();
