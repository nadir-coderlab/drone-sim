// الرسم: الدرون بحجمه الحقيقي + الكاميرات (عين الطيار / ورا / كاميرا الدرون / فوق) + الشاشة الصغيرة (PiP)
// + الجودة (high/medium/low/tv/auto) + الوقت (نهار/غروب/ليل) + الكاميرا الحرارية + المطر/الغبار.
// قاعدة: ما ننشئ أي شي جديد داخل update/render (كل المتغيرات محجوزة مسبقاً).
(function () {
  const DS = window.DS, U = DS.U;

  // مستويات الجودة (pr = أقصى كثافة بكسل، fog/far بالمتر، pipEvery = نرسم الشاشة الصغيرة كل كم فريم)
  const QUALITY = {
    high:   { pr: 2,   shadows: true,  pipEvery: 1, pipMax: 560, fog: 1700, far: 2400, hills: true,  drops: 2400 },
    medium: { pr: 1.5, shadows: false, pipEvery: 1, pipMax: 480, fog: 1500, far: 2000, hills: true,  drops: 2000 },
    low:    { pr: 1,   shadows: false, pipEvery: 2, pipMax: 400, fog: 1100, far: 1500, hills: true,  drops: 1400 },
    tv:     { pr: 1,   shadows: false, pipEvery: 2, pipMax: 480, fog: 900,  far: 1200, hills: false, drops: 1000 }
  };
  // الوقت: ألوان السما/الضباب/الشمس (az = اتجاه الشمس من الشمال مع عقارب الساعة، el = ارتفاعها)
  const TOD = {
    day:    { top: 0x2f6fbf, mid: 0xa9cdeb, bot: 0xd9cfb8, fog: 0xc9dbe8, sun: 0xfff0d8, sunI: 1.25, hs: 0xd6eaff, hg: 0x5f7a38, hI: 0.85, az: 165, el: 58, exp: 1.05, win: 0, lights: 0, stars: 0, glow: 0.3, fogNear: 260, fogK: 1 },
    sunset: { top: 0x23365f, mid: 0xf0a868, bot: 0x6e5a4c, fog: 0xd6a07a, sun: 0xffa458, sunI: 1.05, hs: 0xffc8a0, hg: 0x4a3e2e, hI: 0.5, az: 255, el: 6, exp: 1.0, win: 0.4, lights: 0.65, stars: 0, glow: 1, fogNear: 200, fogK: 0.85 },
    night:  { top: 0x02050c, mid: 0x0b1628, bot: 0x05070b, fog: 0x0a121e, sun: 0x9fb4ff, sunI: 0.14, hs: 0x41517a, hg: 0x0c0e13, hI: 0.17, az: 200, el: 38, exp: 1.25, win: 1, lights: 1, stars: 1, glow: 0, fogNear: 120, fogK: 0.7 }
  };
  const VIEW_OK = { pilot: 1, chase: 1, fpv: 1, top: 1 };
  const RING = 128;            // سجل وضعيات الدرون (لتأخير الفيديو)
  const LAT = { mini: 0.12, fpv: 0 };   // احتياط بس: القيمة من profile.cam.latency (FPV = بدون تأخير إضافي)

  class Render {
    constructor(canvas) {
      const THREE = this.THREE = window.THREE;
      const qs = (typeof location !== 'undefined' && location.search) || '';
      const S = DS.settings || {};
      this.platformTV = /[?&]platform=tv\b/.test(qs) || !!S.tvMode;
      this.qOverride = (qs.match(/[?&]quality=(high|medium|low|tv|auto)\b/) || [])[1] || null;
      this.debug = /[?&]debug=render\b/.test(qs);
      const pref = this.qOverride || S.quality || 'auto', tier0 = this.resolveTier(pref);
      const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !(tier0 === 'tv' || tier0 === 'low'), powerPreference: 'high-performance' });
      r.outputEncoding = THREE.sRGBEncoding;
      r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
      r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false; r.shadowMap.enabled = false;
      r.info.autoReset = false;
      this.isGL2 = !!r.capabilities.isWebGL2;
      // جهاز ضعيف (مثل Mi Box S القديم: Mali-450 و WebGL1): وضع خفيف للعدادات والشاشة الصغيرة
      let gpu = '';
      try { const gl = r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || ''); } catch (e) { }
      this.gpu = gpu;
      this.lite = /[?&]lite=1\b/.test(qs) || (this.platformTV && (!this.isGL2 || /Mali-(4|T[67])|Adreno \(TM\) [34]\d\d|PowerVR SGX/i.test(gpu)));
      DS.lite = this.lite;
      this.scene = new THREE.Scene();
      this.cam = new THREE.PerspectiveCamera(40, 1, 0.1, 2400);
      this.pipCam = new THREE.PerspectiveCamera(43, 16 / 9, 0.1, 2400);
      this.world = DS.buildWorld(this.scene, r);
      // بعض الأجهزة (Mali-450 / WebGL1 بدون ANGLE_instanced_arrays) ما ترسم InstancedMesh أبد:
      // الشجر والنخل والكثبان تختفي. نحولها لشكل واحد مدموج يرسمه أي جهاز.
      let instOK = this.isGL2;
      try { instOK = instOK || !!r.getContext().getExtension('ANGLE_instanced_arrays'); } catch (e) { }
      if (/[?&]noinst=1\b/.test(qs)) instOK = false;   // للاختبار في الكمبيوتر
      this.instOK = instOK;
      if (!instOK) this.bakeAllInstanced(this.scene, this.world);
      this.worldObjs = this.scene.children.slice();   // مناظر العالم (geo3d.js يخفيها في أكاديمية طويق)
      this.vis = new Map(); this.tickList = [];
      this.ticks = { add: h => this.addTick(h), delete: h => this.untick(h) };   // توافق مع v1

      // متغيرات مؤقتة (بدل الإنشاء كل فريم)
      this.ip = new THREE.Vector3(); this.iq = new THREE.Quaternion(); this.qa = new THREE.Quaternion(); this.qb = new THREE.Quaternion();
      this.dp = new THREE.Vector3(); this.dq = new THREE.Quaternion(); this.dg = -12;
      this.tv = new THREE.Vector3(); this.tv2 = new THREE.Vector3(); this.tq = new THREE.Quaternion(); this.tq2 = new THREE.Quaternion();
      this.te = new THREE.Euler(0, 0, 0, 'YXZ'); this.tm = new THREE.Matrix4(); this.tc = new THREE.Color(); this.tc2 = new THREE.Color();
      this.lookMain = new THREE.Vector3(0, 2, -5); this.lookPip = new THREE.Vector3(0, 2, -5);
      this.chasePos = new THREE.Vector3(0, 3, 8); this.chaseLook = new THREE.Vector3(0, 1, 0);
      this.sunDir = new THREE.Vector3(0, 1, 0); this.fogCol = new THREE.Color(); this.wcol = new THREE.Color();
      this.v2 = new THREE.Vector2(); this.wout = { x: 0, y: 0, z: 0, gx: 0, gz: 0 };
      this.ring = new Float32Array(RING * 9); this.ri = 0; this.rn = 0;
      this.qUp = new THREE.Quaternion(); this.upDeg = NaN;
      this.proj = { x: 0, y: 0 }; this.pipRectObj = { x: 16, y: 16, w: 0, h: 0 }; this.pipRect = null;
      this._stats = { fps: 0, calls: 0, tris: 0, ms: 0, cpu: 0, pr: 1, tier: '', pip: 0 };

      this.clock = 0; this.frame = 0; this.wt = 0;
      this.tod = 'day'; this.weather = 'clear'; this.thermal = false; this.isDark = false; this.winGlow = 0;
      this.sess = null; this.af = null;
      this.therm = []; this.thermHide = []; this.thermOn = false;

      this.drones = { mini: this.buildMini(), fpv: this.buildFpv() };
      for (const k in this.drones) { this.drones[k].root.visible = false; this.scene.add(this.drones[k].root); }
      this.setAirframe('mini');
      this.blob = this.buildBlob(); this.scene.add(this.blob);
      this.wx = this.buildWeather(); this.scene.add(this.wx.lines);
      this.buildBlit();
      this.thermAdd([this.scene]);

      // الأداء التلقائي
      this.emaDt = 1 / 60; this.adaptT = 0; this.dyn = 1; this.goodN = 0; this.dbgT = 0;
      this.qPref = null;
      this.setQuality(pref);
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    // ---------------- واجهة المهام ----------------
    add(task, spec) {
      const h = DS.Vis.make(this, spec);
      if (!this.vis.has(task)) this.vis.set(task, []);
      this.vis.get(task).push(h);
      return h;
    }
    clear(task) { const hs = this.vis.get(task); if (hs) hs.forEach(h => h.remove()); this.vis.delete(task); }
    clearAll() { for (const t of Array.from(this.vis.keys())) this.clear(t); this.setWeather('clear'); this.setThermal(false); }
    addTick(h) { if (this.tickList.indexOf(h) < 0) this.tickList.push(h); }
    untick(h) { const i = this.tickList.indexOf(h); if (i >= 0) this.tickList.splice(i, 1); }

    // ---------------- الجودة ----------------
    resolveTier(q) {
      if (QUALITY[q]) return q;
      if (this.platformTV) return 'tv';
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      return /Android|iPhone|iPad|Mobile|CrKey|AFT|BRAVIA|SmartTV/i.test(ua) ? 'medium' : 'high';
    }
    setQuality(q) {
      this.qPref = q || 'auto';
      this.auto = this.qPref === 'auto';
      this.dyn = 1; this.goodN = 0; this.adaptT = 0;
      this.applyTier(this.resolveTier(this.qPref));
    }
    applyTier(tier) {
      let Q = QUALITY[tier];
      if (this.lite && (tier === 'tv' || tier === 'low')) Q = Object.assign({}, Q, { pipEvery: 4, pipMax: 320 });
      this.T = Q;
      const r = this.renderer, W = this.world;
      const changedShadow = this.tier && QUALITY[this.tier].shadows !== Q.shadows;
      this.tier = tier;
      r.shadowMap.enabled = Q.shadows;
      W.sun.castShadow = Q.shadows && this.tod !== 'night';
      this.cam.far = this.pipCam.far = Q.far; this.cam.updateProjectionMatrix(); this.pipCam.updateProjectionMatrix();
      W.sky.scale.setScalar(Q.far * 0.85);
      if (W.hills) W.hills.visible = Q.hills;
      this.wx.geo.setDrawRange(0, Q.drops * 2);
      if (changedShadow) this.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
      this.applyPR();
      this.applyEnv();
      this.pipDirty = true;
    }
    applyPR() {
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const pr = Math.max(0.5, Math.min(dpr, this.T.pr) * this.dyn);
      if (Math.abs(pr - this.renderer.getPixelRatio()) > 0.01) { this.renderer.setPixelRatio(pr); if (this.w) this.renderer.setSize(this.w, this.h, false); this.pipDirty = true; }
    }
    // جودة تلقائية: لو الفريمات أقل من ~45 بالثانية (أبطأ من شاشة 50/60 هرتز) نقلل الدقة، وبعدين ننزل مستوى.
    // ولو رجعت فوق ~57 نرجّع الدقة شوي شوي.
    adapt(dt) {
      if (dt <= 0 || dt > 0.25) return;
      this.emaDt += (dt - this.emaDt) * 0.05;
      if (!this.auto) return;
      this.adaptT += dt;
      if (this.adaptT < 2) return;
      this.adaptT = 0;
      if (this.emaDt > 0.0225) {
        this.goodN = 0;
        if (this.dyn > (this.lite ? 0.55 : 0.66)) { this.dyn = Math.max(this.lite ? 0.5 : 0.6, this.dyn - 0.1); this.applyPR(); }
        else if (this.tier === 'high') { this.dyn = 1; this.applyTier('medium'); }
        else if (this.tier === 'medium') { this.dyn = 1; this.applyTier('low'); }
      } else if (this.emaDt < 0.0175 && this.dyn < 1) {
        if (++this.goodN >= 3) { this.goodN = 0; this.dyn = Math.min(1, this.dyn + 0.1); this.applyPR(); }
      } else this.goodN = 0;
    }

    // ---------------- الوقت والطقس والحراري ----------------
    setTimeOfDay(t) { this.tod = TOD[t] ? t : 'day'; this.applyEnv(); }
    setWeather(w) { this.weather = (w === 'rain' || w === 'dust') ? w : 'clear'; this.applyEnv(); }
    setThermal(on) { this.thermal = !!on; this.pipDirty = true; }
    applyEnv() {
      if (!this.T) return;
      const W = this.world, E = TOD[this.tod], wx = this.weather, su = W.sky.material.uniforms, fog = this.scene.fog;
      su.top.value.setHex(E.top); su.mid.value.setHex(E.mid); su.bot.value.setHex(E.bot);
      this.fogCol.setHex(E.fog);
      let sunI = E.sunI, hI = E.hI, near = E.fogNear, far = this.T.fog * E.fogK, glow = E.glow, stars = E.stars;
      if (wx !== 'clear') {
        const dim = this.tod === 'night' ? 0.12 : this.tod === 'sunset' ? 0.6 : 1;
        this.wcol.setHex(wx === 'rain' ? 0x8a96a3 : 0xc4a47a).multiplyScalar(dim);
        su.top.value.lerp(this.wcol, 0.75); su.mid.value.lerp(this.wcol, 0.85); su.bot.value.lerp(this.wcol, 0.85);
        this.fogCol.lerp(this.wcol, 0.9);
        sunI *= wx === 'rain' ? 0.35 : 0.5; hI *= 0.8; glow *= 0.2; stars = 0;
        near = wx === 'rain' ? 50 : 12; far = Math.min(far, wx === 'rain' ? 650 : 320);
      }
      fog.color.copy(this.fogCol); fog.near = near; fog.far = far;
      W.fogBase = W.fogBase || fog.color.clone(); W.fogBase.copy(this.fogCol);
      W.sun.color.setHex(E.sun); W.sun.intensity = sunI;
      W.hemi.color.setHex(E.hs); W.hemi.groundColor.setHex(E.hg); W.hemi.intensity = hI;
      const az = U.rad(E.az), el = U.rad(E.el);
      this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      su.sunDir.value.copy(this.sunDir); su.sunCol.value.setHex(E.sun); su.glow.value = glow; su.stars.value = stars;
      this.renderer.toneMappingExposure = E.exp;
      this.winGlow = E.win;
      for (const m of W.winMats || []) m.emissiveIntensity = E.win;
      this.isDark = this.tod === 'night';
      const lit = E.lights > 0;
      if (W.nightPts) { W.nightPts.visible = lit; W.nightPts.material.uniforms.intensity.value = E.lights; W.nightPts.material.uniforms.minPx.value = 2.2; }
      if (W.pools) { W.pools.visible = lit; W.pools.material.opacity = E.lights * (wx === 'clear' ? 1 : 0.8); }
      if (W.home && W.home.lights) W.home.lights.visible = lit;
      W.sun.castShadow = this.T.shadows && this.tod !== 'night';
      // أضواء الدرون: بالليل أكبر وأوضح
      for (const k in this.drones) { const u = this.drones[k].leds.material.uniforms; u.minPx.value = this.isDark ? 5 : 3; u.intensity.value = this.isDark ? 1.15 : 0.9; }
      // جزيئات المطر/الغبار
      const X = this.wx, U2 = X.mat.uniforms;
      X.lines.visible = wx !== 'clear';
      if (wx === 'rain') { U2.speed.value = 14; U2.len.value = 0.7; U2.box.value = 70; U2.hgt.value = 40; U2.color.value.setHex(this.isDark ? 0x5a6672 : 0xbfd4ea); U2.opacity.value = 0.5; }
      else if (wx === 'dust') { U2.speed.value = 0.8; U2.len.value = 0.3; U2.box.value = 50; U2.hgt.value = 24; U2.color.value.setHex(0xd8b888); U2.opacity.value = 0.35; }
      this.pipDirty = true;
    }

    // الكاميرا الحرارية: كل جسم مسجل له مادة رمادية حسب حرارته (أبيض = حار)
    thermAdd(objs) {
      const THREE = this.THREE;
      for (const root of objs) root.traverse(o => {
        if (o.userData.noThermal) { if (this.thermHide.indexOf(o) < 0) this.thermHide.push(o); return; }
        const lv = o.userData.therm;
        if (lv == null || !(o.isMesh || o.isLine) || !o.material || Array.isArray(o.material)) return;
        if (this.therm.some(e => e.o === o)) return;
        const n = o.material, v = 0.04 + 0.96 * Math.pow(U.clamp(lv, 0, 1), 1.15);   // سطوع على الشاشة (أبيض = حار)
        this.tc.setRGB(v, v, v).convertSRGBToLinear();
        // الأجسام الباردة تتظلل شوي مع الشمس (الكثبان والمباني يبان شكلها مثل الحراري الحقيقي) • الحارة بيضا ثابتة
        const cool = !o.isLine && lv < 0.6;
        const t = o.isLine ? new THREE.LineBasicMaterial({ color: this.tc, toneMapped: false })
          : cool ? new THREE.MeshLambertMaterial({ color: this.tc2.copy(this.tc).multiplyScalar(0.6), emissive: this.tc.clone().multiplyScalar(0.62), toneMapped: false })
            : new THREE.MeshBasicMaterial({ color: this.tc, toneMapped: false });
        t.side = n.side; t.depthWrite = n.depthWrite !== false; t.depthTest = n.depthTest !== false; t.fog = n.fog !== false;
        t.polygonOffset = !!n.polygonOffset; t.polygonOffsetFactor = n.polygonOffsetFactor || 0; t.polygonOffsetUnits = n.polygonOffsetUnits || 0;
        this.therm.push({ o, n, t, ic: o.isInstancedMesh ? o.instanceColor : null });   // ic: ألوان الشجر تنشال وقت الحراري
      });
    }
    thermRemove(objs) {
      for (const root of objs) root.traverse(o => {
        for (let i = this.therm.length - 1; i >= 0; i--) if (this.therm[i].o === o) { this.therm[i].t.dispose(); this.therm.splice(i, 1); }
        const k = this.thermHide.indexOf(o); if (k >= 0) this.thermHide.splice(k, 1);
      });
    }
    thermalPass(on) {
      const L = this.therm, H = this.thermHide;
      for (let i = 0; i < L.length; i++) {
        const e = L[i];
        if (on) { e.n = e.o.material === e.t ? e.n : e.o.material; e.o.material = e.t; if (e.ic) e.o.instanceColor = null; }
        else { e.o.material = e.n; if (e.ic) e.o.instanceColor = e.ic; }
      }
      for (let i = 0; i < H.length; i++) { const o = H[i]; if (on) { o.userData.wasVis = o.visible; o.visible = false; } else o.visible = !!o.userData.wasVis; }
      const fog = this.scene.fog;
      if (on) { this.fogSave = this.fogSave || { c: new this.THREE.Color(), n: 0, f: 0 }; this.fogSave.c.copy(fog.color); this.fogSave.n = fog.near; this.fogSave.f = fog.far; fog.color.setRGB(0.02, 0.02, 0.02); fog.near = Math.max(fog.near, 150); fog.far = Math.max(fog.far * 1.3, 500); }
      else if (this.fogSave) { fog.color.copy(this.fogSave.c); fog.near = this.fogSave.n; fog.far = this.fogSave.f; }
      this.thermOn = on;
    }

    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.w = w; this.h = h;
      this.renderer.setSize(w, h, false);
      this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
      this.pipDirty = true;
    }

    // ---------------- الدرونات بحجمها الحقيقي ----------------
    // ترتيب المحركات مثل physics.js (Betaflight): motor[0] ورا يمين، [1] قدام يمين، [2] ورا يسار، [3] قدام يسار
    buildMini() {
      const THREE = this.THREE, M = new DS.Merger(false);
      const grey = 0x80868d, dgrey = 0x3f444a, black = 0x141618;
      M.geo(new THREE.CapsuleGeometry(0.03, 0.085, 4, 10), 0, 0, 0.004, grey, 1.25, 1, 0.83, 0, Math.PI / 2);
      M.box(0.05, 0.006, 0.09, 0, 0.024, 0.008, dgrey);
      M.box(0.012, 0.009, 0.006, -0.016, 0.01, -0.071, black); M.box(0.012, 0.009, 0.006, 0.016, 0.01, -0.071, black);
      M.box(0.052, 0.034, 0.012, 0, -0.002, 0.074, dgrey);
      M.box(0.03, 0.02, 0.022, 0, -0.016, -0.066, dgrey);   // حامل الجيمبال
      const mp = [[0.11, 0.073], [0.11, -0.073], [-0.11, 0.073], [-0.11, -0.073]], py = [-0.042, 0.045, -0.042, 0.045];   // مراوح ورا تحت الذراع
      for (let i = 0; i < 4; i++) {
        const [x, z] = mp[i], front = z < 0, s = Math.sign(x);
        if (front) {
          M.beam(s * 0.026, 0.012, -0.03, x, 0.024, z, 0.012, grey, 0.009);
          M.geo(new THREE.CylinderGeometry(0.0115, 0.012, 0.016, 12), x, 0.034, z, dgrey);
          M.geo(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 6), x, -0.018, z, dgrey);   // رجل
        } else {
          M.beam(s * 0.028, -0.012, 0.04, x, -0.016, z, 0.012, grey, 0.009);
          M.geo(new THREE.CylinderGeometry(0.012, 0.0115, 0.016, 12), x, -0.027, z, dgrey);
        }
      }
      M.box(0.012, 0.03, 0.012, -0.02, -0.038, 0.05, dgrey); M.box(0.012, 0.03, 0.012, 0.02, -0.038, 0.05, dgrey);
      const body = new THREE.Mesh(M.build(), new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: 0x333333 }));
      // الكاميرا على الجيمبال (تثبت أفقية وتميل مع الجيمبال)
      const GM = new DS.Merger(false);
      GM.box(0.026, 0.024, 0.022, 0, 0, 0, dgrey);
      GM.geo(new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 14), 0, 0, -0.012, 0x0a1620, 1, 1, 1, 0, Math.PI / 2);
      const gimbal = new THREE.Mesh(GM.build(), new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 80 }));
      gimbal.position.set(0, -0.021, -0.081);
      const D = this.droneCommon(body, mp, py, 0.076, 2, 0x25282c, null);
      D.gimbal = gimbal; D.root.add(gimbal);
      D.hOff = 0.053; D.camOff = new THREE.Vector3(0, -0.021, -0.088); D.af = 'mini'; D.chase = { back: 2.6, up: 0.85 }; D.size = 0.36;
      // LEDs: قدام أحمر (يسار/يمين)، ورا مؤشر الحالة، فوق ضوء وميض (للّيل)
      D.leds = DS.lightPoints([{ x: -0.11, y: 0.02, z: -0.086, c: 0xff2020, s: 0.03 }, { x: 0.11, y: 0.02, z: -0.086, c: 0xff2020, s: 0.03 },
        { x: 0, y: 0.004, z: 0.082, c: 0x20ff40, s: 0.03 }, { x: 0, y: 0.03, z: 0.02, c: 0xffffff, s: 0.09 }]);
      D.root.add(D.leds);
      return D;
    }
    buildFpv() {
      const THREE = this.THREE, M = new DS.Merger(false), carbon = 0x1b1c1f, purple = 0x6d28d9;
      const mp = [[0.08, 0.08], [0.08, -0.08], [-0.08, 0.08], [-0.08, -0.08]], py = [0.026, 0.026, 0.026, 0.026];
      M.box(0.042, 0.004, 0.135, 0, 0, 0, carbon);
      for (const [x, z] of mp) {
        M.beam(0, 0, 0, x, 0, z, 0.017, carbon, 0.005);
        M.geo(new THREE.CylinderGeometry(0.0135, 0.0135, 0.014, 12), x, 0.011, z, purple);
        M.geo(new THREE.CylinderGeometry(0.01, 0.012, 0.006, 10), x, 0.002, z, 0x333333);
      }
      M.box(0.036, 0.003, 0.1, 0, 0.032, 0, carbon);
      for (const [x, z] of [[-0.015, -0.032], [0.015, -0.032], [-0.015, 0.032], [0.015, 0.032]]) M.geo(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 6), x, 0.017, z, 0x9ca3af);
      M.box(0.035, 0.034, 0.074, 0, 0.051, 0.008, 0x2a2a2a); M.box(0.036, 0.012, 0.075, 0, 0.051, 0.008, 0xfacc15);   // البطارية
      M.box(0.04, 0.006, 0.013, 0, 0.07, 0.008, 0xdc2626);   // الحزام
      M.box(0.058, 0.042, 0.03, 0, 0.056, -0.05, 0x111111); M.geo(new THREE.CylinderGeometry(0.01, 0.01, 0.006, 12), 0.016, 0.06, -0.066, 0x26313a, 1, 1, 1, 0, Math.PI / 2);   // GoPro
      M.beam(0, 0.03, 0.06, 0, 0.07, 0.085, 0.004, 0x111111); M.box(0.012, 0.004, 0.004, 0, 0.071, 0.086, 0x111111);   // الأنتين
      const body = new THREE.Mesh(M.build(), new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 30, specular: 0x222222 }));
      // كاميرا FPV (تميل لفوق بزاوية uptilt)
      const CM = new DS.Merger(false);
      CM.box(0.019, 0.019, 0.018, 0, 0, 0, 0xff6a00);
      CM.geo(new THREE.CylinderGeometry(0.007, 0.007, 0.008, 12), 0, 0, -0.012, 0x0b0b0b, 1, 1, 1, 0, Math.PI / 2);
      const cams = new THREE.Mesh(CM.build(), new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60 }));
      cams.position.set(0, 0.016, -0.055);
      const D = this.droneCommon(body, mp, py, 0.064, 3, 0xffffff, [0x22d3ee, 0xff7a1a, 0x22d3ee, 0xff7a1a]);   // قدام برتقالي، ورا سماوي
      D.cams = cams; D.root.add(cams);
      D.hOff = 0.008; D.camOff = new THREE.Vector3(0, 0.016, -0.058); D.af = 'fpv'; D.chase = { back: 2.4, up: 0.75 }; D.size = 0.3;
      D.leds = DS.lightPoints([{ x: 0, y: 0.01, z: -0.072, c: 0xffffff, s: 0.03 }, { x: -0.06, y: -0.004, z: 0.062, c: 0xff2020, s: 0.03 },
        { x: 0.06, y: -0.004, z: 0.062, c: 0xff2020, s: 0.03 }, { x: 0, y: 0.075, z: 0.03, c: 0xffffff, s: 0.07 }]);
      D.root.add(D.leds);
      return D;
    }
    // جسم + مراوح (instanced) + أقراص الدوران
    droneCommon(body, mp, py, pr, blades, bladeCol, propCols) {
      const THREE = this.THREE, root = new THREE.Group();
      body.castShadow = true; root.add(body);
      const BM = new DS.Merger(false);
      for (let b = 0; b < blades; b++) {
        const a = b / blades * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        BM.beam(ca * 0.006, 0, sa * 0.006, ca * pr, 0.002, sa * pr, 0.013, bladeCol, 0.0025);
      }
      BM.geo(new THREE.CylinderGeometry(0.006, 0.006, 0.008, 8), 0, 0, 0, 0x222222);
      const props = this.makeInst(BM.build(), new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff }), 4);
      if (propCols) { const c = new THREE.Color(); propCols.forEach((h, i) => props.setColorAt(i, c.setHex(h))); }
      props.castShadow = true;
      const dg = new THREE.CircleGeometry(pr, 24); dg.rotateX(-Math.PI / 2);
      const discs = this.makeInst(dg, new THREE.MeshLambertMaterial({ color: propCols ? 0xd8d0c8 : 0xb9bec4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }), 4);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 4; i++) { m.makeTranslation(mp[i][0], py[i] + 0.001, mp[i][1]); discs.setMatrixAt(i, m); props.setMatrixAt(i, m); }
      root.add(props, discs);
      return { root, body, props, discs, mp, py, ang: [0, 0, 0, 0], spin: [1, -1, -1, 1] };   // اتجاه الدوران مثل MOT_DIR
    }
    // ---------------- بديل InstancedMesh للأجهزة الضعيفة ----------------
    // نسخ ثابتة (شجر/صخور): ندمجها كلها في شكل واحد (رسمة وحدة)
    bakeAllInstanced(scene, W) {
      const list = [];
      scene.traverse(o => { if (o.isInstancedMesh) list.push(o); });
      for (const im of list) {
        const baked = this.bakeInstanced(im);
        const p = im.parent; if (!p) continue;
        p.add(baked); p.remove(im);
        if (W) for (const k in W) if (W[k] === im) W[k] = baked;
      }
    }
    bakeInstanced(im) {
      const THREE = this.THREE, g = im.geometry, n = im.count;
      const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, col = g.attributes.color, idx = g.index;
      const vc = pos.count, ic = im.instanceColor;
      const P = new Float32Array(vc * n * 3), N = nor ? new Float32Array(vc * n * 3) : null, UV = uv ? new Float32Array(vc * n * 2) : null;
      const C = (col || ic) ? new Float32Array(vc * n * 3) : null;
      const I = idx ? new (vc * n > 65535 ? Uint32Array : Uint16Array)(idx.count * n) : null;
      const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), c = new THREE.Color(1, 1, 1);
      for (let i = 0; i < n; i++) {
        im.getMatrixAt(i, m); nm.getNormalMatrix(m);
        if (ic) im.getColorAt(i, c);
        const o = i * vc;
        for (let j = 0; j < vc; j++) {
          v.fromBufferAttribute(pos, j).applyMatrix4(m); P[(o + j) * 3] = v.x; P[(o + j) * 3 + 1] = v.y; P[(o + j) * 3 + 2] = v.z;
          if (N) { v.fromBufferAttribute(nor, j).applyMatrix3(nm).normalize(); N[(o + j) * 3] = v.x; N[(o + j) * 3 + 1] = v.y; N[(o + j) * 3 + 2] = v.z; }
          if (UV) { UV[(o + j) * 2] = uv.getX(j); UV[(o + j) * 2 + 1] = uv.getY(j); }
          if (C) {
            const r0 = col ? col.getX(j) : 1, g0 = col ? col.getY(j) : 1, b0 = col ? col.getZ(j) : 1;
            C[(o + j) * 3] = r0 * c.r; C[(o + j) * 3 + 1] = g0 * c.g; C[(o + j) * 3 + 2] = b0 * c.b;
          }
        }
        if (I) for (let k = 0; k < idx.count; k++) I[i * idx.count + k] = idx.getX(k) + o;
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(P, 3));
      if (N) out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      if (UV) out.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
      if (C) out.setAttribute('color', new THREE.BufferAttribute(C, 3));
      if (I) out.setIndex(new THREE.BufferAttribute(I, 1));
      out.computeBoundingSphere();
      let mat = im.material;
      if (C && !mat.vertexColors) { mat = mat.clone(); mat.vertexColors = true; }
      const mesh = new THREE.Mesh(out, mat);
      mesh.name = im.name; mesh.visible = im.visible; mesh.castShadow = im.castShadow; mesh.receiveShadow = im.receiveShadow;
      mesh.position.copy(im.position); mesh.quaternion.copy(im.quaternion); mesh.scale.copy(im.scale);
      mesh.renderOrder = im.renderOrder; mesh.userData = im.userData;
      return mesh;
    }
    // نسخ تتحرك كل فريم (مراوح الدرون): مجموعة أشكال عادية بنفس واجهة InstancedMesh
    makeInst(geo, mat, n) {
      const THREE = this.THREE;
      if (this.instOK) return new THREE.InstancedMesh(geo, mat, n);
      const grp = new THREE.Group(), kids = [];
      for (let i = 0; i < n; i++) { const k = new THREE.Mesh(geo, mat); k.matrixAutoUpdate = false; kids.push(k); grp.add(k); }
      grp.count = n; grp.geometry = geo; grp.instanceMatrix = { needsUpdate: false };
      Object.defineProperty(grp, 'material', { get: () => mat });
      Object.defineProperty(grp, 'castShadow', { get: () => kids[0].castShadow, set: b => kids.forEach(k => { k.castShadow = b; }) });
      grp.setMatrixAt = (i, m) => { kids[i].matrix.copy(m); kids[i].matrixWorldNeedsUpdate = true; };
      grp.setColorAt = (i, c) => { if (kids[i].material === mat) kids[i].material = mat.clone(); kids[i].material.color.copy(c); };
      return grp;
    }
    setAirframe(af) {
      this.af = af;
      for (const k in this.drones) this.drones[k].root.visible = k === af;
      this.D = this.drones[af];
    }

    buildBlob() {
      const THREE = this.THREE;
      const tex = DS.canvasTex(64, 64, (g) => {
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      });
      const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16, toneMapped: false }));
      m.renderOrder = 7; m.userData.noThermal = true;
      return m;
    }

    // مطر/غبار بالـ shader: القطرات ثابتة بالعالم وتلف حول الكاميرا الشغالة (حتى في الشاشة الصغيرة)
    buildWeather() {
      const THREE = this.THREE, N = 2400, P = new Float32Array(N * 6), Tp = new Float32Array(N * 2), r = U.rng(5);
      for (let i = 0; i < N; i++) {
        const x = r() * 70, y = r() * 40, z = r() * 70;
        P.set([x, y, z, x, y, z], i * 6); Tp[i * 2] = 0; Tp[i * 2 + 1] = 1;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('tip', new THREE.BufferAttribute(Tp, 1));
      const mat = new THREE.ShaderMaterial({
        uniforms: { camPos: { value: new THREE.Vector3() }, time: { value: 0 }, speed: { value: 14 }, len: { value: 0.7 }, wind: { value: new THREE.Vector2() },
          box: { value: 70 }, hgt: { value: 40 }, color: { value: new THREE.Color(0xbfd4ea) }, opacity: { value: 0.5 } },
        vertexShader: [
          'attribute float tip; uniform vec3 camPos; uniform float time; uniform float speed; uniform float len; uniform vec2 wind; uniform float box; uniform float hgt;',
          'varying float vA;',
          'void main(){',
          '  vec3 s = position * vec3(box / 70.0, hgt / 40.0, box / 70.0);',
          '  float y = mod(s.y - time * speed, hgt);',
          '  float x = mod(s.x + wind.x * time - camPos.x, box) - box * 0.5 + camPos.x;',
          '  float z = mod(s.z + wind.y * time - camPos.z, box) - box * 0.5 + camPos.z;',
          '  vec3 p = vec3(x, max(camPos.y - hgt * 0.35, 0.0) + y, z);',
          '  vec3 dir = normalize(vec3(wind.x, -speed, wind.y));',
          '  p -= dir * len * tip;',
          '  vA = step(0.0, p.y) * (1.0 - smoothstep(box * 0.3, box * 0.5, length(p.xz - camPos.xz)));',
          '  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);',
          '}'].join('\n'),
        fragmentShader: 'uniform vec3 color; uniform float opacity; varying float vA; void main(){ gl_FragColor = vec4(color, opacity * vA); }',
        transparent: true, depthWrite: false
      });
      const lines = new THREE.LineSegments(geo, mat); lines.frustumCulled = false; lines.visible = false; lines.renderOrder = 8;
      return { lines, geo, mat };
    }

    // نسخ الشاشة الصغيرة (لما نرسمها كل فريمين)
    buildBlit() {
      const THREE = this.THREE;
      this.blitMat = new THREE.ShaderMaterial({
        uniforms: { map: { value: null } }, depthTest: false, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main(){ gl_FragColor = texture2D(map, vUv); }'
      });
      const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMat); q.frustumCulled = false;
      this.blitScene = new THREE.Scene(); this.blitScene.add(q);
      this.blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.pipTex = null;
    }

    // ---------------- كل فريم ----------------
    update(dt, s, alpha) {
      if (!s || !s.drone) return;
      if (alpha == null) alpha = 1;
      const d = s.drone, W = this.world;
      if (s !== this.sess) this.onSession(s);
      this.clock += dt; this.frame++; this.wt = (this.wt + dt) % 1000;
      this.adapt(dt);
      this.syncSettings(s);

      const af = d.airframe === 'fpv' ? 'fpv' : 'mini';
      if (af !== this.af) this.setAirframe(af);
      const D = this.D;
      this.interp(s, alpha, dt);
      D.root.position.set(this.ip.x, this.ip.y + D.hOff, this.ip.z);
      D.root.quaternion.copy(this.iq);
      this.updateProps(dt, d);
      this.updateLeds(d);
      this.updatePayloadParts(s);
      this.updateBlob(d);
      this.pushPose(s);
      this.lookupDelayed(af, d);
      this.updateWorld(dt, s);
      for (let i = 0; i < this.tickList.length; i++) this.tickList[i].tick(dt, this);
      this.updateCameras(dt, s);
      // أكاديمية طويق: الخريطة الحقيقية 3D (أو المجسم التقريبي) — geo3d.js يتكفل بكل شي، وما يخرب الرسم لو صار فيه خطأ
      const G3 = DS.Geo3D;
      if (G3 && (G3.attached || (s.def && s.def.zone === 'tuwaiq'))) { try { G3.update(dt, this, s); } catch (e) { if (!this._g3err) { this._g3err = true; console.warn('Geo3D:', e); } } }
      if (this.debug) { this.dbgT += dt; if (this.dbgT > 2 || this.frame === 6 || this.frame === 7) { this.dbgT = 0; console.log('[render] ' + JSON.stringify(this.stats()) + ' view=' + s.view + ' pip=' + !!s.pip); } }
    }

    onSession(s) {
      this.sess = s;
      const def = s.def || {};
      this.setTimeOfDay(s.timeOfDay || (s.env && s.env.timeOfDay) || def.timeOfDay || 'day');
      if (def.weather) this.setWeather(def.weather);
      this.setThermal(!!s.thermalView);   // ما يكمل الحراري من الجلسة اللي قبل
      this.rn = 0; this.ri = 0;
      this.snapCam = true;
      // الجهاز الضعيف: الشاشة الصغيرة تبدأ طافية (أسرع بحوالي 6 فريمات) — LB يشغلها وقت ما تبي
      if (this.lite && !s.demo && s.pip) s.pip = false;
    }
    // الإعدادات اللي ممكن تتغير وقت الطيران
    syncSettings(s) {
      const S = DS.settings || {};
      const pref = this.qOverride || S.quality || 'auto';
      if (pref !== this.qPref) this.setQuality(pref);
      const tod = s.timeOfDay || (s.env && s.env.timeOfDay) || (s.def && s.def.timeOfDay) || 'day';
      if (tod !== this.tod) this.setTimeOfDay(tod);
      if (typeof s.thermalView === 'boolean' && s.thermalView !== this.thermal) this.setThermal(s.thermalView);
      const up = S.fpvUptilt != null ? +S.fpvUptilt : 25;
      if (up !== this.upDeg) { this.upDeg = up; this.qUp.setFromAxisAngle(this.tv.set(1, 0, 0), U.rad(up)); if (this.drones.fpv.cams) this.drones.fpv.cams.rotation.x = U.rad(up); }
    }

    // مكان واتجاه الدرون بين خطوتين فيزياء (alpha)
    interp(s, a, dt) {
      const d = s.drone, p0 = s.pose0, q = d.q;
      if (q) {
        this.qb.set(q.x, q.y, q.z, q.w);
        if (p0 && p0.qw != null && a < 1) {
          this.qa.set(p0.qx, p0.qy, p0.qz, p0.qw);
          this.iq.slerpQuaternions(this.qa, this.qb, a);
          this.ip.set(U.lerp(p0.x, d.p.x, a), U.lerp(p0.y, d.p.y, a), U.lerp(p0.z, d.p.z, a));
        } else { this.iq.copy(this.qb); this.ip.set(d.p.x, d.p.y, d.p.z); }
        return;
      }
      // فيزياء قديمة (v1): yaw + tf/tr + تقلب عند الصدمة
      this.ip.set(d.p.x, d.p.y, d.p.z);
      if (d.crashed && d.tumble) {
        this.tumb = this.tumb || { x: 0, z: 0 };
        if (d.p.y > 0.05) { this.tumb.x += d.tumble.x * dt; this.tumb.z += d.tumble.z * dt; }
        else this.tumb.z = U.lerp(this.tumb.z, Math.PI * 0.95, 1 - Math.exp(-6 * dt));
        this.te.set(-d.tf + this.tumb.x, -d.yaw, -d.tr + this.tumb.z, 'YXZ');
      } else { if (this.tumb) this.tumb.x = this.tumb.z = 0; this.te.set(-(d.tf || 0), -d.yaw, -(d.tr || 0), 'YXZ'); }
      this.iq.setFromEuler(this.te);
    }

    // اتجاه الأنف على الأرض من الـ quaternion (0 = شمال، مع عقارب الساعة)
    headingOf(q) {
      const x = q.x, y = q.y, z = q.z, w = q.w;
      const nx = -2 * (x * z + w * y), ny = -2 * (y * z - w * x), nz = -(1 - 2 * (x * x + y * y));
      if (Math.abs(ny) < 0.97) return Math.atan2(nx, -nz);
      const ux = 2 * (x * y - w * z), uz = 2 * (y * z + w * x), sg = ny > 0 ? -1 : 1;   // الأنف عمودي: نستخدم اتجاه البطن/الظهر
      return Math.atan2(sg * ux, -sg * uz);
    }

    updateProps(dt, d) {
      const D = this.D, mot = d.motor, m4 = this.tm;
      let avg = 0;
      for (let i = 0; i < 4; i++) {
        const m = mot ? (mot[i] || 0) : (d.motors ? 0.45 + 0.4 * (d.load || 0.5) : 0);
        avg += m;
        D.ang[i] += D.spin[i] * (m > 0.02 ? 9 + 60 * m : 0) * dt;
        m4.makeRotationY(D.ang[i]); m4.setPosition(D.mp[i][0], D.py[i], D.mp[i][1]);
        D.props.setMatrixAt(i, m4);
      }
      avg /= 4;
      D.props.instanceMatrix.needsUpdate = true;
      const fast = avg > 0.18 && !d.crashed;
      D.props.visible = !fast;
      D.discs.visible = avg > 0.04 && !d.crashed;
      D.discs.material.opacity = U.clamp((avg - 0.04) * 1.1, 0, 0.32);
    }

    led(c, i, r, g, b, k) { c[i * 3] = r * k; c[i * 3 + 1] = g * k; c[i * 3 + 2] = b * k; }
    updateLeds(d) {
      const D = this.D, A = D.leds.geometry.attributes.lcolor, c = A.array, t = this.clock;
      const on = !d.crashed;
      const strobe = on && (d.strobe != null ? !!d.strobe : this.tod === 'night');
      const sp = t % 1, strobeK = strobe && (sp < 0.05 || (sp > 0.14 && sp < 0.19)) ? 1 : 0;
      if (D.af === 'mini') {
        this.led(c, 0, 1, 0.12, 0.12, on ? 1 : 0); this.led(c, 1, 1, 0.12, 0.12, on ? 1 : 0);
        // مؤشر الحالة ورا (DJI): أخضر بطيء = GPS، أخضر مزدوج = ATTI، أصفر = بدون GPS، أحمر = بطارية ضعيفة
        let r = 0.1, g = 1, b = 0.2, k = 0;
        const atti = d.effMode && d.effMode() === 'A', bat = d.battery != null ? d.battery : 100;
        if (on) {
          if (bat <= 15 && d.motors) { r = 1; g = 0.1; b = 0.1; k = (t * 4) % 1 < 0.5 ? 1 : 0; }
          else if (bat <= 30 && d.motors) { r = 1; g = 0.1; b = 0.1; k = (t * 1.25) % 1 < 0.35 ? 1 : 0; }
          else if (atti) { const p = t % 1.2; k = (p < 0.12 || (p > 0.26 && p < 0.38)) ? 1 : 0; }
          else if (d.gps === false) { r = 1; g = 0.8; b = 0.1; k = (t * 1.5) % 1 < 0.4 ? 1 : 0; }
          else k = (t % 1.6) < 0.3 ? 1 : 0;
        }
        this.led(c, 2, r, g, b, k);
      } else {
        this.led(c, 0, 1, 1, 1, on ? 1 : 0);
        const k = on ? 1 : ((t * 3) % 1 < 0.5 ? 0.8 : 0);
        this.led(c, 1, 1, 0.1, 0.1, k); this.led(c, 2, 1, 0.1, 0.1, k);
      }
      this.led(c, 3, 1, 1, 1, strobeK);
      A.needsUpdate = true;
    }

    // جيمبال الميني (ثابت أفقياً) + كاميرا الـ FPV
    updatePayloadParts(s) {
      const D = this.D;
      if (D.gimbal) {
        const g = U.rad(s.gimbal != null ? s.gimbal : -12), hd = this.headingOf(this.iq);
        this.te.set(g, -hd, 0, 'YXZ'); this.tq.setFromEuler(this.te);
        this.tq2.copy(this.iq).invert().multiply(this.tq);
        D.gimbal.quaternion.copy(this.tq2);
      }
    }

    // ظل دائري تحت الدرون دايماً (يساعد تعرف الارتفاع) — يطلع على السطوح والكثبان
    updateBlob(d) {
      const D = this.D, b = this.blob, x = this.ip.x, z = this.ip.z;
      const gy = this.world.groundAt ? this.world.groundAt(x, z, this.ip.y) : 0;
      const hA = Math.max(0, this.ip.y - gy);
      const sz = D.size * (1.4 + hA * 0.02);
      b.position.set(x, gy + 0.03, z); b.scale.set(sz, 1, sz);
      b.material.opacity = (this.T.shadows ? 0.55 : 0.75) * U.clamp(1 - hA / 40, 0.15, 1);
      b.visible = true;
    }

    // سجل الوضعيات (لتأخير الفيديو)
    pushPose(s) {
      const o = this.ri * 9, R = this.ring, p = this.ip, q = this.iq;
      R[o] = this.clock; R[o + 1] = p.x; R[o + 2] = p.y; R[o + 3] = p.z; R[o + 4] = q.x; R[o + 5] = q.y; R[o + 6] = q.z; R[o + 7] = q.w; R[o + 8] = s.gimbal != null ? s.gimbal : -12;
      this.ri = (this.ri + 1) % RING; if (this.rn < RING) this.rn++;
    }
    latency(af, d) {
      const v = (DS.settings || {}).videoLatency;
      if (v === 'off' || v === false || v === 0) return 0;
      if (typeof v === 'number') return v / 1000;
      const P = d && d.profile;
      return (P && P.cam && P.cam.latency != null) ? P.cam.latency : (LAT[af] || 0);
    }
    lookupDelayed(af, d) {
      const L = this.latency(af, d), R = this.ring, target = this.clock - L;
      let newer = (this.ri - 1 + RING) % RING, found = -1;
      for (let k = 1; k < this.rn; k++) {
        const i = (this.ri - 1 - k + RING * 2) % RING;
        if (R[i * 9] <= target) { found = i; break; }
        newer = i;
      }
      if (L <= 0 || found < 0) {
        const i = found < 0 && L > 0 ? newer : (this.ri - 1 + RING) % RING, o = i * 9;   // ما فيه تاريخ كافي → أقدم/أحدث
        this.dp.set(R[o + 1], R[o + 2], R[o + 3]); this.dq.set(R[o + 4], R[o + 5], R[o + 6], R[o + 7]); this.dg = R[o + 8];
        return;
      }
      const a = found * 9, b = newer * 9, span = R[b] - R[a], t = span > 1e-6 ? U.clamp((target - R[a]) / span, 0, 1) : 0;
      this.dp.set(U.lerp(R[a + 1], R[b + 1], t), U.lerp(R[a + 2], R[b + 2], t), U.lerp(R[a + 3], R[b + 3], t));
      this.qa.set(R[a + 4], R[a + 5], R[a + 6], R[a + 7]); this.qb.set(R[b + 4], R[b + 5], R[b + 6], R[b + 7]);
      this.dq.slerpQuaternions(this.qa, this.qb, t);
      this.dg = U.lerp(R[a + 8], R[b + 8], t);
    }

    updateWorld(dt, s) {
      const W = this.world, P = DS.PILOT, Hm = DS.HOME || { x: 0, z: 0 };
      // الطيار يطالع الدرون
      W.pilot.position.set(P.x, 0, P.z);
      W.pilot.rotation.y = Math.atan2(-(this.ip.x - P.x), -(this.ip.z - P.z));
      // منصة البيت + الممر للطيار
      const h = W.home;
      if (h && (h.x !== Hm.x || h.z !== Hm.z || h.px !== P.x || h.pz !== P.z)) {
        h.x = Hm.x; h.z = Hm.z; h.px = P.x; h.pz = P.z;
        h.pad.position.set(Hm.x, h.pad.position.y, Hm.z);
        const dx = P.x - Hm.x, dz = P.z - Hm.z, len = Math.hypot(dx, dz);
        h.apron.visible = len > 0.5 && len < 40;
        h.apron.position.set((Hm.x + P.x) / 2, h.apron.position.y, (Hm.z + P.z) / 2);
        h.apron.rotation.y = Math.atan2(dx, dz); h.apron.scale.set(1, 1, len + 3);
      }
      // الشمس تلحق الدرون (عشان الظل الحقيقي في الجودة العالية)
      const sd = this.sunDir;
      W.sun.position.set(this.ip.x + sd.x * 150, this.ip.y + sd.y * 150, this.ip.z + sd.z * 150);
      W.sun.target.position.copy(this.ip); W.sun.target.updateMatrixWorld();
      // مؤشر الريح
      const env = s.env;
      if (env && env.wind && env.wind.at) {
        const w = env.wind.at(5, this.wout), sp = Math.hypot(w.x, w.z);
        if (sp > 0.05) W.sock.rotation.y = -Math.atan2(w.x, -w.z);
        W.sock.rotation.x = -(1 - Math.min(1, sp / 9)) * 1.2;
        const X = this.wx.mat.uniforms; X.wind.value.set(w.x * 0.8, w.z * 0.8);
      }
      this.wx.mat.uniforms.time.value = this.wt;
    }

    // ---------------- الكاميرات ----------------
    eyeFov(dist) {
      const e = (DS.settings || {}).eyeFov;
      if (typeof e === 'number') return e;
      if (e === 'zoom') return U.clamp(66 - dist * 0.45, 22, 66);   // زوم تلقائي (مساعدة)
      return 40;
    }
    setPilot(c, dt, look, snap) {
      const P = DS.PILOT, D = this.D;
      c.up.set(0, 1, 0);
      c.position.set(P.x, 1.7, P.z);
      this.tv.set(this.ip.x, this.ip.y + D.hOff, this.ip.z);
      if (snap) look.copy(this.tv); else look.lerp(this.tv, 1 - Math.exp(-12 * dt));
      c.lookAt(look);
      const f = this.eyeFov(c.position.distanceTo(this.tv));
      c.fov = snap || Math.abs(c.fov - f) < 0.05 ? f : c.fov + (f - c.fov) * Math.min(1, dt * 4);
    }
    setChase(c, dt, snap) {
      // الـ FPV يقلب (flip/roll) فنلحق اتجاه السرعة لما يكون مسرع عشان الكاميرا ما تلف معه
      const D = this.D, v = this.sess && this.sess.drone && this.sess.drone.v, sp = v ? Math.hypot(v.x, v.z) : 0;
      const hd = (D.af === 'fpv' && sp > 3) ? Math.atan2(v.x, -v.z) : this.headingOf(this.iq), fx = Math.sin(hd), fz = -Math.cos(hd);
      const gy = this.blob.position.y;
      this.tv.set(this.ip.x - fx * D.chase.back, Math.max(gy + 0.35, this.ip.y + D.chase.up), this.ip.z - fz * D.chase.back);
      if (snap) this.chasePos.copy(this.tv); else this.chasePos.lerp(this.tv, 1 - Math.exp(-5 * dt));
      c.up.set(0, 1, 0); c.position.copy(this.chasePos);
      this.tv.set(this.ip.x + fx * 1.5, this.ip.y + D.hOff + 0.1, this.ip.z + fz * 1.5);
      if (snap) this.chaseLook.copy(this.tv); else this.chaseLook.lerp(this.tv, 1 - Math.exp(-9 * dt));
      c.lookAt(this.chaseLook); c.fov = 60;
    }
    setTop(c) {
      c.up.set(0, 0, -1); c.position.set(this.ip.x, this.ip.y + (this.D.af === 'fpv' ? 30 : 26), this.ip.z + 0.01);
      c.lookAt(this.ip); c.fov = 50;
    }
    // كاميرا الدرون (متأخرة بزمن الفيديو): الميني بجيمبال ثابت، الـ FPV مثبتة بالهيكل ومايلة لفوق
    // المكان = نفس drone.cameraPose في الفيزياء (p + q·cam.off) عشان ctx.camera() والصورة يتطابقون
    setPayload(c, s) {
      const D = this.D, S = DS.settings || {}, q = this.dq, prof = s.drone && s.drone.profile, pc = prof && prof.cam;
      if (pc && pc.off) { this.tv.set(pc.off.x, pc.off.y, pc.off.z).applyQuaternion(q); c.position.set(this.dp.x + this.tv.x, this.dp.y + this.tv.y, this.dp.z + this.tv.z); }
      else { this.tv.copy(D.camOff).applyQuaternion(q); c.position.set(this.dp.x + this.tv.x, this.dp.y + D.hOff + this.tv.y, this.dp.z + this.tv.z); }
      c.up.set(0, 1, 0);
      const zoom = Math.max(1, s.zoom || 1);
      let v0;
      if (D.af === 'fpv') {
        c.quaternion.copy(q).multiply(this.qUp);
        v0 = S.fpvFov != null ? +S.fpvFov : ((pc && pc.vfov) || 100);
      } else {
        this.te.set(U.rad(this.dg), -this.headingOf(q), 0, 'YXZ'); c.quaternion.setFromEuler(this.te);
        v0 = (pc && pc.vfov) || 43;
      }
      c.fov = zoom > 1 ? U.deg(2 * Math.atan(Math.tan(U.rad(v0) / 2) / zoom)) : v0;
    }
    updateCameras(dt, s) {
      const view = VIEW_OK[s.view] ? s.view : 'chase', c = this.cam, snap = !!this.snapCam;
      this.snapCam = false;
      if (view === 'pilot') this.setPilot(c, dt, this.lookMain, snap);
      else if (view === 'chase') this.setChase(c, dt, snap);
      else if (view === 'fpv') this.setPayload(c, s);
      else this.setTop(c);
      c.updateProjectionMatrix();
      this.mainKind = view === 'fpv' ? 'payload' : view;
      if (s.pip) {
        this.pipKind = view === 'fpv' ? 'pilot' : 'payload';
        if (this.pipKind === 'pilot') this.setPilot(this.pipCam, dt, this.lookPip, snap || this.pipKindLast !== 'pilot');
        else this.setPayload(this.pipCam, s);
        if (this.pipKindLast !== this.pipKind) this.pipDirty = true;
        this.pipKindLast = this.pipKind;
      }
    }

    // ---------------- الرسم ----------------
    pass(cam, kind, cssH) {
      const r = this.renderer, W = this.world;
      this.D.root.visible = kind !== 'payload';
      W.pilot.visible = kind !== 'pilot';
      W.sky.position.copy(cam.position);
      this.wx.mat.uniforms.camPos.value.copy(cam.position);
      const sc = (cssH / 2) / Math.tan(U.rad(cam.fov) / 2), pr = r.getPixelRatio(), LM = DS.LIGHT_MATS || [];
      for (let i = 0; i < LM.length; i++) { const u = LM[i].uniforms; u.scale.value = sc; u.pr.value = pr; u.time.value = this.clock; }
      const th = kind === 'payload' && this.thermal;
      if (th) this.thermalPass(true);
      r.render(this.scene, cam);
      if (th) this.thermalPass(false);
    }
    render(s) {
      const r = this.renderer, t0 = performance.now();
      r.info.reset();
      if (r.shadowMap.enabled) r.shadowMap.needsUpdate = true;   // الظل مرة وحدة بالفريم (الشاشة الصغيرة ما تعيده)
      r.setScissorTest(false); r.setViewport(0, 0, this.w, this.h);
      if (!this.mainKind) this.mainKind = 'pilot';
      this.pass(this.cam, s ? this.mainKind : 'pilot', this.h);
      this.pipRect = null;
      if (s && s.pip) {
        const pr = r.getPixelRatio();
        let pw = Math.round(U.clamp(this.w * 0.24, 200, 400));
        if (pw * pr > this.T.pipMax) pw = Math.floor(this.T.pipMax / pr);
        // التلفزيون: الشاشة الصغيرة داخل الهامش الآمن 5% (body.tv)
        const body = (typeof document !== 'undefined' && document.body) || null;
        const tvSafe = body ? body.classList.contains('tv') : this.platformTV;
        // الجوال (body.touchui): العصي تحت — الشاشة الصغيرة فوق بالنص (تحت شريط DJI + الحافة الآمنة)
        const touch = !!(body && body.classList.contains('touchui'));
        if (touch && (this._pipTopW !== this.w || this._pipTopH !== this.h || !this._pipTop)) this.pipTopMargin();
        if (touch) pw = Math.round(Math.max(120, Math.min(pw, this._pipGap1 - this._pipGap0 - 12)));   // بين الخريطة الصغيرة ولوحة المهمة
        const ph = Math.round(pw * 9 / 16), pc = this.pipCam;
        const x = touch ? Math.round(U.clamp((this._pipGap0 + this._pipGap1 - pw) / 2, 4, this.w - pw - 4)) : tvSafe ? Math.max(16, Math.round(this.w * 0.05)) : 16;
        const y = touch ? Math.max(8, this.h - ph - this._pipTop) : tvSafe ? Math.max(16, Math.round(this.h * 0.05)) : 16;   // y من تحت (WebGL)
        if (Math.abs(pc.aspect - pw / ph) > 1e-3) { pc.aspect = pw / ph; }
        pc.updateProjectionMatrix();
        r.setScissorTest(true); r.setScissor(x, y, pw, ph); r.setViewport(x, y, pw, ph);
        const every = this.T.pipEvery, tw = Math.floor(pw * pr), thh = Math.floor(ph * pr);
        const fresh = every <= 1 || this.pipDirty || (this.frame % every) === 0 || !this.pipTex || this.pipTex.image.width !== tw || this.pipTex.image.height !== thh;
        if (fresh) {
          this.pass(pc, this.pipKind || 'payload', ph);
          if (every > 1) {
            if (!this.pipTex || this.pipTex.image.width !== tw || this.pipTex.image.height !== thh) {
              if (this.pipTex) this.pipTex.dispose();
              this.pipTex = new this.THREE.FramebufferTexture(tw, thh, this.THREE.RGBAFormat);
              this.blitMat.uniforms.map.value = this.pipTex;
            }
            this.v2.set(Math.floor(x * pr), Math.floor(y * pr));
            r.copyFramebufferToTexture(this.v2, this.pipTex);
          }
          this.pipDirty = false;
        } else r.render(this.blitScene, this.blitCam);
        r.setScissorTest(false); r.setViewport(0, 0, this.w, this.h);
        const pRect = this.pipRectObj; pRect.x = x; pRect.y = y; pRect.w = pw; pRect.h = ph;
        this.pipRect = pRect;
      }
      this.D.root.visible = true; this.world.pilot.visible = true;
      const st = this._stats;
      st.calls = r.info.render.calls; st.tris = r.info.render.triangles;
      st.cpu += (performance.now() - t0 - st.cpu) * 0.1;
    }

    // الجوال: كم بكسل من فوق = نفس سطر عدادات DJI (تحت الشريط + الحافة الآمنة) — نحسبها لما يتغير المقاس بس
    pipTopMargin() {
      this._pipTopW = this.w; this._pipTopH = this.h;
      let top = 0, g0 = 0, g1 = this.w;
      try {
        const el = document.getElementById('djiTel'); if (el) top = el.getBoundingClientRect().top;
        // الفراغ فوق بين الخريطة الصغيرة (يسار) ولوحة المهمة (يمين) — الشاشة الصغيرة تنحط بنصه
        const mini = document.getElementById('mini'), rc = document.getElementById('rightCol') || document.getElementById('taskPanel');
        const a = mini && mini.getBoundingClientRect(), b = rc && rc.getBoundingClientRect();
        if (a && a.width && a.right < this.w * 0.6) g0 = a.right + 4;
        const t = el && el.getBoundingClientRect();
        if (t && t.width && t.right < this.w * 0.6 && t.right + 4 > g0) g0 = t.right + 4;
        if (b && b.width && b.left > this.w * 0.4) g1 = b.left - 4;
      } catch (e) { /* افتراضي */ }
      if (g1 - g0 < 140) { g0 = 0; g1 = this.w; }
      this._pipGap0 = g0; this._pipGap1 = g1;
      this._pipTop = Math.round(top > 8 && top < this.h * 0.4 ? top : 58);
    }

    // شاشة القوائم: كاميرا تدور حول الساحة
    renderIdle(dt) {
      if (DS.Geo3D && DS.Geo3D.attached) { try { DS.Geo3D.detach(this); } catch (e) { console.warn('Geo3D:', e); } }   // رجعنا للقائمة: عالم المحاكي يرجع
      this.idleT = (this.idleT || 0) + (dt || 0.016);
      const t = this.idleT * 0.06, c = this.cam;
      c.up.set(0, 1, 0); c.position.set(Math.sin(t) * 55, 16, -38 + Math.cos(t) * 55); c.lookAt(0, 2, -38);
      c.fov = 55; c.updateProjectionMatrix();
      this.renderer.info.reset();
      if (this.renderer.shadowMap.enabled) this.renderer.shadowMap.needsUpdate = true;
      this.renderer.setScissorTest(false); this.renderer.setViewport(0, 0, this.w, this.h);
      this.pass(c, 'idle', this.h);
      this.pipRect = null;
    }

    stats() {
      const st = this._stats;
      st.ms = Math.round(this.emaDt * 10000) / 10; st.fps = Math.round(1 / Math.max(1e-3, this.emaDt));
      st.cpu = Math.round(st.cpu * 100) / 100; st.pr = Math.round(this.renderer.getPixelRatio() * 100) / 100; st.tier = this.tier; st.pip = this.T.pipEvery;
      return st;
    }

    // مكان الدرون على الشاشة (للدائرة المساعدة) — نفس الكائن يرجع كل مرة
    project(d) {
      const own = this.sess && d === this.sess.drone;
      this.tv2.set(own ? this.ip.x : d.p.x, (own ? this.ip.y : d.p.y) + (this.D ? this.D.hOff : 0.05), own ? this.ip.z : d.p.z).project(this.cam);
      if (this.tv2.z > 1) return null;
      this.proj.x = (this.tv2.x + 1) / 2 * this.w; this.proj.y = (1 - this.tv2.y) / 2 * this.h;
      return this.proj;
    }
  }
  DS.Render = Render;
  DS.RENDER_QUALITY = QUALITY;
})();
