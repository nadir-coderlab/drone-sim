// الخريطة الحقيقية 3D حول أكاديمية طويق (Google Photorealistic 3D Tiles عن طريق Map Tiles API)
// + مجسم تقريبي لو ما فيه نت/مفتاح/جهاز قوي (أرض صحراء + مباني OSM + طريق المطار + منطقة حظر المطار).
// يعتمد على (وكلها اختيارية — نتحقق منها): window.THREE (r149)، window.Tiles3D (lib/tiles3d.bundle.js)،
// DS.CONFIG.googleMapsKey (js/config.js)، DS.TUWAIQ / DS.HeightField / DS.GeoSurface (worlddata.js).
// render.js ينادي DS.Geo3D.update كل فريم لما الجلسة في منطقة 'tuwaiq'، و detach لما نرجع للقائمة.
// الفيزياء تاخذ الأرض والمباني من DS.Geo3D.surface() (شبكة ارتفاعات): البلاطات نرسمها من فوق لنسيج صغير (GPU) ونقرا الارتفاعات.
// قاعدة: ما ننشئ أشياء جديدة كل فريم (كل المتغيرات محجوزة مسبقاً).
(function () {
  const DS = window.DS = window.DS || {};
  const QS = (typeof location !== 'undefined' && location.search) || '';
  const GOOGLE_ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json';
  const UA = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const MOBILE = /Android|iPhone|iPad|Mobile|CrKey|AFT|BRAVIA|SmartTV/i.test(UA);
  const KEY_RE = /AIza[0-9A-Za-z_-]{20,}/g;   // ما نطبع المفتاح أبد
  const safe = t => String(t == null ? '' : t).replace(KEY_RE, 'AIza…').replace(/([?&]key=)[^&\s"']+/g, '$1…');

  // إعدادات (DS.Geo3D.cfg — تقدر تعدلها للتجربة من الكونسول)
  const CFG = {
    far: 16000, near: 0.15,              // الكاميرا تشوف لين المطار (11 كم)
    fogNear: 1500, fogFar: 8500,         // ضباب خفيف مع البلاطات (يغطي حد التحميل)
    fbFogNear: 500, fbFogFar: 6000,      // المجسم التقريبي
    initialY: -621.5,                    // تخمين أول: الأرض عند الأكاديمية ~621.5 م فوق الإهليلج (قسناها من البلاطات؛ تتصحح تلقائياً)
    capN: 256, capCell: 0.5,             // شبكة ارتفاعات حول الدرون: 256×256 × 0.5 م = 128 م
    capTop: 1600, capBase: -300, capRange: 1200,
    lodHalf: 72, lodGe: 3,               // كاميرا "تحت الدرون" للبلاطات: تطلب بلاطات دقتها ~3 م أو أحسن (الأرض والمباني تحته)
    lodFar: MOBILE ? 6000 : 8000,        // البلاطات نحمّلها لين هالمسافة بس (ورا كذا ضباب)
    sseNear: MOBILE ? 120 : 150,         // بعد هالمسافة (+ 2× ارتفاع الكاميرا) نطلب تفاصيل أقل (مثل Cesium dynamic SSE) — وإلا الأفق ياكل الذاكرة قبل اللي جنبك
    geMax: 5,                            // شبكة الارتفاعات من البلاطات الدقيقة بس (الخشنة ممكن تطلع سطح وهمي فوق المباني)
    recenter: 24, capEvery: 0.8, capMin: 0.25, capMax: 3,
    err: { high: 28, medium: 32, low: 40, tv: 48, mobile: 40 },
    bytes: MOBILE ? [110, 170] : [300, 500],     // ذاكرة الكاش (ميغابايت) [أقل، أكثر]
    jobs: MOBILE ? [12, 4] : [30, 10],           // [تحميل، تجهيز] بنفس الوقت (قوقل تنصح 30/10)
    readyIdle: 0.6, readyTimeout: 25, padSearch: 40
  };
  const TINT = { day: [1, 1, 1], sunset: [1, 0.84, 0.7], night: [0.2, 0.23, 0.32] };
  const TODK = { day: 1, sunset: 0.85, night: 0.6 };

  const S = {
    R: null, sess: null, clock: 0, tiles: null, tilesOn: false, ready: false, switched: false, err: '', errT: -1e9,
    yOff: CFG.initialY, readyTry: -9, sseF: CFG.sseNear, field: null, proxy: null, fb: null, hidden: [], hiddenVis: [], saved: null,
    cap: null, lastCap: -9, dirty: true, loads: 0, idleT: 0, firstData: -1, pad: null, pilot: null,
    attrArr: [], attrTxt: '', attrT: 0, overlay: null, tintTod: '', tStart: 0, emaDt: 1 / 60, adaptT: 0, baseErr: 24,
    flat: false, notified: {}, captures: 0, valid: 0, rootOK: false, rootFail: '', net: { inflight: 0, done: 0, err: 0, lastT: 0, codes: {} }, hidTmp: [], padValid: 0
  };
  // توزيع geometricError للبلاطات الظاهرة (للتشخيص)
  function geHist() {
    const T = S.tiles; if (!T) return null;
    const B = [1, 2, 4, 8, 16, 32, 64, 1e9], out = {};
    for (const t of T.visibleTiles) { const e = t.geometricError; for (let i = 0; i < B.length; i++) if (e < B[i]) { const k = '<' + (B[i] > 1e8 ? 'inf' : B[i]); out[k] = (out[k] || 0) + 1; break; } }
    return out;
  }
  const toast = (t, k) => { try { if (DS.HUD && DS.HUD.toast) DS.HUD.toast(t, k || 'info'); } catch (e) { /* اختياري */ } };
  const once = (k, t, kind) => { if (S.notified[k]) return; S.notified[k] = true; toast(t, kind); };

  const G3 = DS.Geo3D = {
    cfg: CFG, attached: false, mode: 'off', status: '',
    key() {
      const s = DS.settings && DS.settings.googleKey;
      if (typeof s === 'string' && s.trim()) return s.trim();
      return (DS.CONFIG && typeof DS.CONFIG.googleMapsKey === 'string') ? DS.CONFIG.googleMapsKey.trim() : '';
    },
    // رابط بلاطات للتجربة (نسبي بس، بدون مفتاح): ?tiles=path/tileset.json أو DS.CONFIG.tilesUrl
    customUrl() {
      const m = QS.match(/[?&]tiles=([^&]+)/);
      const u = m ? decodeURIComponent(m[1]) : (DS.CONFIG && DS.CONFIG.tilesUrl) || '';
      return u && !/^[a-z]+:|^\/\//i.test(u) ? u : '';
    },
    // نقدر نشغل الخريطة الحقيقية؟ (يكتب السبب بالعربي في status)
    available() {
      const no = t => { G3.status = t; return false; };
      if (/[?&]geo3d=0\b/.test(QS)) return no('الخريطة الحقيقية طافية (geo3d=0)');
      if (!window.THREE) return no('three.js ما تحمل');
      if (!window.Tiles3D || !window.Tiles3D.TilesRenderer) return no('مكتبة الخريطة الحقيقية ما تحملت');
      if (!G3.customUrl() && !G3.key()) return no('الخريطة الحقيقية 3D تحتاج نت ومفتاح قوقل');
      if (DS.lite || (S.R && !S.R.isGL2 && MOBILE)) return no('جهازك خفيف — نستخدم المجسم التقريبي');
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return no('الخريطة الحقيقية 3D تحتاج نت ومفتاح قوقل (ما فيه نت)');
      if (typeof location !== 'undefined' && location.protocol === 'file:') return no('الخريطة الحقيقية تحتاج تفتح المحاكي من رابط (مو ملف)');
      if (S.err && S.clock - S.errT < 60) return no(S.err);
      if (!G3.attached) G3.status = 'الخريطة الحقيقية جاهزة (تحتاج نت)';
      return true;
    },
    // الإعدادات غيّرت المفتاح (DS.settings.googleKey): نبدأ من جديد بالطيران الجاي
    setKey() { G3.reload(); },
    reload() {
      S.err = ''; S.errT = -1e9; G3.status = '';
      if (G3.attached) { S.needReload = true; return; }
      dropTiles();
    },
    latLonToLocal(lat, lon, out) { return DS.Geo ? DS.Geo.latLonToLocal(lat, lon, out) : null; },
    localToLatLon(x, z, out) { return DS.Geo ? DS.Geo.localToLatLon(x, z, out) : null; },
    // سطح الفيزياء (نفس الكائن دايم: يبدأ بالمجسم التقريبي ويتحول للبلاطات لما تجهز)
    surface() {
      if (!S.proxy && DS.TUWAIQ && DS.GeoSurface) { const fb = DS.TUWAIQ.surface(); S.proxy = new DS.GeoSurface(fb.field, 0); }
      return S.proxy;
    },
    groundAt(x, z, below) { const p = G3.surface(); return p ? p.groundAt(x, z, below) : null; },
    _dbg() { return S; },   // للتشخيص من الكونسول بس
    hit(x, y, z, r, out) { const p = G3.surface(); return p ? p.hit(x, y, z, r, out) : false; },
    stats() {
      const T = S.tiles;
      return {
        mode: G3.mode, status: G3.status, ready: S.ready, switched: S.switched, flat: S.flat, yOff: Math.round(S.yOff * 100) / 100,
        visible: T ? T.visibleTiles.size : 0, downloading: T ? T.stats.downloading : 0, parsing: T ? T.stats.parsing : 0, failed: T ? T.stats.failed : 0,
        loads: S.loads, captures: S.captures, valid: S.valid, errorTarget: T ? Math.round(T.errorTarget * 10) / 10 : null,
        cacheMB: T ? Math.round(T.lruCache.cachedBytes / 1048576) : 0, net: { inflight: S.net.inflight, done: S.net.done, err: S.net.err, idle: Math.round(S.clock - S.net.lastT), codes: S.net.codes }, padValid: Math.round(S.padValid * 100), ge: geHist(), pad: S.pad, pilot: S.pilot, rootOK: S.rootOK, rootFail: S.rootFail, attribution: S.attrTxt
      };
    },

    attach(R, s) {
      if (G3.attached) G3.detach(R);
      if (!window.THREE || !DS.TUWAIQ) return;
      G3.attached = true; S.R = R; S.sess = null; S.notified = {};
      G3.surface();
      hideWorld(R);
      buildFallback(R);
      R.scene.add(S.fb.group);
      S.saved = { near: R.cam.near, far: R.cam.far, pnear: R.pipCam.near, pfar: R.pipCam.far, groundAt: R.world.groundAt };
      let lastG = 0;
      R.world.groundAt = (x, z, below) => { const v = S.proxy.groundAt(x, z, below); if (v != null) lastG = v; return lastG; };   // الظل الدائري تحت الدرون
      showOverlay(true);
      S.tilesOn = false;
      if (G3.available()) startTiles(R);
      else { G3.mode = 'fallback'; useFallback(); once('fb', G3.status + ' — هذا مجسم تقريبي', 'info'); }
      setFbVisible(!S.switched);
    },

    detach(R) {
      if (!G3.attached) return;
      R = R || S.R;
      for (let i = 0; i < S.hidden.length; i++) S.hidden[i].visible = S.hiddenVis[i];
      S.hidden.length = 0; S.hiddenVis.length = 0;
      if (S.fb) R.scene.remove(S.fb.group);
      if (S.tiles) {
        R.scene.remove(S.tiles.group);
        if (S.tiles.hasCamera(R.pipCam)) S.tiles.deleteCamera(R.pipCam);
        if (MOBILE) dropTiles();   // الجوال: نفضي الذاكرة
      }
      if (S.saved) {
        R.cam.near = S.saved.near; R.cam.far = S.saved.far; R.pipCam.near = S.saved.pnear; R.pipCam.far = S.saved.pfar;
        R.cam.updateProjectionMatrix(); R.pipCam.updateProjectionMatrix();
        R.world.groundAt = S.saved.groundAt; S.saved = null;
      }
      try { R.applyTier(R.tier); } catch (e) { /* يرجّع الضباب والسما والجبال */ }
      if (S.needReload) { S.needReload = false; dropTiles(); }
      showOverlay(false);
      useFallback();
      G3.attached = false; G3.mode = 'off'; S.sess = null; S.switched = false; S.tilesOn = false;
    },

    update(dt, R, s) {
      S.clock += dt;
      if (!s || !s.def || s.def.zone !== 'tuwaiq') { if (G3.attached) G3.detach(R); return; }
      if (!G3.attached) G3.attach(R, s);
      if (!G3.attached) return;
      if (s !== S.sess) onSession(s);
      if (dt > 0 && dt < 0.25) S.emaDt += (dt - S.emaDt) * 0.05;
      keepView(R);
      if (S.tiles && S.tilesOn) {
        try { tilesFrame(dt, R, s); }
        catch (e) { failTiles('خطأ في الخريطة الحقيقية', e); }
      }
      if (R.tod !== S.tintTod) applyTint(R.tod);
      overlayTick(dt);
    }
  };

  // ---------------- عالم المحاكي: نخفيه (السما والشمس والطيار والمنصة نخليها) ----------------
  function hideWorld(R) {
    const W = R.world, keep = [W.sky, W.sun, W.sun && W.sun.target, W.hemi, W.pilot, W.home && W.home.pad, W.home && W.home.apron];
    const list = R.worldObjs || R.scene.children.slice();
    S.hidden.length = 0; S.hiddenVis.length = 0;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o || keep.indexOf(o) >= 0 || o === (S.fb && S.fb.group) || (S.tiles && o === S.tiles.group)) continue;
      S.hidden.push(o); S.hiddenVis.push(o.visible); o.visible = false;
    }
  }
  function keepView(R) {
    for (let i = 0; i < S.hidden.length; i++) S.hidden[i].visible = false;   // applyEnv/applyTier ممكن يرجعونها
    const c = R.cam, p = R.pipCam;
    if (c.far !== CFG.far || c.near !== CFG.near) { c.far = CFG.far; c.near = CFG.near; c.updateProjectionMatrix(); }
    if (p.far !== CFG.far || p.near !== CFG.near) { p.far = CFG.far; p.near = CFG.near; p.updateProjectionMatrix(); }
    R.world.sky.scale.setScalar(CFG.far * 0.9);
    const fog = R.scene.fog, k = TODK[R.tod] || 1;
    if (fog && !R.thermOn) { fog.near = (S.switched ? CFG.fogNear : CFG.fbFogNear) * k; fog.far = (S.switched ? CFG.fogFar : CFG.fbFogFar) * k; }
  }

  // ---------------- جلسة جديدة ----------------
  function onSession(s) {
    S.sess = s;
    const P = G3.surface();
    if (s.env && P && s.env.geo !== P) s.env.geo = P;
    if (S.switched) applyPad(s);
  }

  // ---------------- المجسم التقريبي (بدون نت) ----------------
  function setFbVisible(on) {
    if (!S.fb) return;
    S.fb.local.visible = on;
    S.fb.blds.visible = on || S.flat;   // البلاطات بدون مجسمات (صورة على أرض مستوية): نخلي مباني OSM فوقها
    S.fb.labelFb.visible = on; S.fb.labelReal.visible = !on;
  }
  function useFallback() {
    if (!S.proxy) return;
    S.proxy.field = DS.TUWAIQ.surface().field; S.proxy.outside = 0;
  }
  function textSprite(lines, w, h, worldW, color) {
    const THREE = window.THREE;
    const tex = DS.canvasTex(w, h, g => {
      g.fillStyle = 'rgba(10,18,30,0.72)';
      const r = 18; g.beginPath(); g.moveTo(r, 0); g.lineTo(w - r, 0); g.quadraticCurveTo(w, 0, w, r); g.lineTo(w, h - r); g.quadraticCurveTo(w, h, w - r, h);
      g.lineTo(r, h); g.quadraticCurveTo(0, h, 0, h - r); g.lineTo(0, r); g.quadraticCurveTo(0, 0, r, 0); g.fill();
      g.lineWidth = 6; g.strokeStyle = color || '#38bdf8'; g.stroke();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl';
      const n = lines.length;
      for (let i = 0; i < n; i++) { g.font = (i ? '600 ' : 'bold ') + Math.round(h / (n + 1) * (i ? 0.62 : 0.8)) + 'px Tahoma, Arial'; g.fillText(lines[i], w / 2, h * (i + 0.75) / (n + 0.5)); }
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    sp.scale.set(worldW, worldW * h / w, 1); sp.renderOrder = 15;
    return sp;
  }
  function buildFallback(R) {
    if (S.fb) return;
    const THREE = window.THREE, TW = DS.TUWAIQ, F = TW.fence;
    const group = new THREE.Group(); group.name = 'Geo3D.tuwaiq';
    const local = new THREE.Group(); group.add(local);   // الأرض والطرق والمدارج: تختفي لما تشتغل البلاطات
    const blds = new THREE.Group(); group.add(blds);     // مباني OSM: تبقى فوق البلاطات لو قوقل ما عندها مجسمات 3D هنا
    // الأرض: صحراء الرياض (تغطي الأكاديمية والمطار)
    {
      const tex = DS.canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = '#cdb68e'; g.fillRect(0, 0, w, h);
        const r = DS.U.rng(31);
        for (let i = 0; i < 2600; i++) { const v = 150 + r() * 70 | 0; g.fillStyle = 'rgba(' + v + ',' + (v - 22) + ',' + (v - 55) + ',0.35)'; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3); }
      }, [900, 900], 8);
      const geo = new THREE.PlaneGeometry(36000, 36000); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, -7000);
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, color: 0xffffff }));
      m.receiveShadow = true; local.add(m);
    }
    // المباني من OSM (الأزرق = الأكاديمية تقريباً): الجدران بنوافذ (كل دور 3.5 م وكل 4 م شباك) + السطوح — شكلين مدموجين
    {
      const cp = [], cn = [], cc = [], wp = [], wn = [], wu = [], wc = [], col = new THREE.Color(), rc = new THREE.Color();
      for (const b of TW.buildings) {
        const P = b.p, sh = new THREE.Shape();
        for (let k = 0; k < P.length; k += 2) { if (k) sh.lineTo(P[k], -P[k + 1]); else sh.moveTo(P[k], -P[k + 1]); }
        const g = new THREE.ExtrudeGeometry(sh, { depth: b.h + 2, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, -2, 0);   // ينزل 2 م تحت الأرض (الأرض الحقيقية مو مستوية بالضبط)
        const pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
        col.setHex(b.academy ? 0xd2dde6 : 0xeadcc4).convertSRGBToLinear(); rc.setHex(b.academy ? 0x8197a8 : 0xb4a78f).convertSRGBToLinear();   // ألوان الرياض (بيج) — الأكاديمية أفتح
        for (const gr of g.groups) {
          const wall = gr.materialIndex === 1;
          for (let i = gr.start; i < gr.start + gr.count; i++) {
            (wall ? wp : cp).push(pa.getX(i), pa.getY(i), pa.getZ(i)); (wall ? wn : cn).push(na.getX(i), na.getY(i), na.getZ(i));
            if (wall) { wu.push(ua.getX(i), ua.getY(i)); wc.push(col.r, col.g, col.b); } else cc.push(rc.r, rc.g, rc.b);
          }
        }
        g.dispose();
      }
      const mk = (p, n, c, u) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); if (u) g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2)); g.computeBoundingSphere(); return g; };
      const facade = DS.canvasTex(128, 128, (g, w, h) => {
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#dcd6cc'; g.fillRect(0, h * 0.9, w, h * 0.1);                  // خط الدور
        g.fillStyle = '#3f5568'; g.fillRect(w * 0.18, h * 0.22, w * 0.64, h * 0.52);  // الشباك
        g.fillStyle = '#6d8296'; g.fillRect(w * 0.18, h * 0.22, w * 0.64, h * 0.12);
        g.fillStyle = '#ffffff'; g.fillRect(w * 0.49, h * 0.22, w * 0.02, h * 0.52);
      }, [0.25, 1 / 3.5], 8);
      const walls = new THREE.Mesh(mk(wp, wn, wc, wu), new THREE.MeshLambertMaterial({ map: facade, vertexColors: true }));
      const roofs = new THREE.Mesh(mk(cp, cn, cc, null), new THREE.MeshLambertMaterial({ vertexColors: true }));
      walls.castShadow = roofs.castShadow = true; walls.receiveShadow = roofs.receiveShadow = true;
      blds.add(walls, roofs);
    }
    // الطرق (طريق المطار + شارع أنس بن مالك) والمدارج
    {
      const M = new DS.Merger(false), up = [0, 1, 0];
      const strip = (P, w, y, col) => {
        for (let k = 0; k + 2 < P.length; k += 2) {
          const ax = P[k], az = P[k + 1], bx = P[k + 2], bz = P[k + 3], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l * w / 2, nz = dx / l * w / 2;
          M.quad([ax + nx, y, az + nz], [bx + nx, y, bz + nz], [bx - nx, y, bz - nz], [ax - nx, y, az - nz], up, col);
        }
      };
      for (const r of TW.roads) strip(r.p, r.w, r.bridge ? 0.06 : 0.05, r.airport ? 0x3d4148 : 0x4b5058);
      for (const r of TW.runways) strip([r.ax, r.az, r.bx, r.bz], r.w, 0.07, 0x2b2e33);
      const g = M.build();
      if (g) {
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide });
        const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.renderOrder = 1; local.add(m);
      }
    }
    // جدار أحمر شفاف على حد منطقة الحظر + برتقالي على حد التحذير (يبان في المجسم والخريطة الحقيقية)
    const wall = (P, y0, y1, color, op) => {
      const n = P.length / 2, pos = new Float32Array(n * 6 * 3);
      for (let k = 0; k < n; k++) {
        const q = (k + 1) % n, ax = P[k * 2], az = P[k * 2 + 1], bx = P[q * 2], bz = P[q * 2 + 1];
        pos.set([ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az], k * 18);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      m.renderOrder = 9; m.frustumCulled = false; return m;
    };
    group.add(wall(F.outline('nfz'), -60, 320, 0xff2a2a, 0.2));
    group.add(wall(F.outline('warn'), -60, 90, 0xff9a1f, 0.1));
    // علامات: الأكاديمية + المطار
    const A = TW.academy || { cx: 0, cz: 0, h: 18 };
    const labelFb = textSprite(['أكاديمية طويق (مبنى تقريبي)', 'مجسم تقريبي — الخريطة الحقيقية تحتاج نت'], 1024, 220, 46, '#38bdf8');
    labelFb.position.set(A.cx, A.h + 14, A.cz);
    const labelReal = textSprite(['أكاديمية طويق'], 640, 150, 30, '#38bdf8');
    labelReal.position.set(A.cx, A.h + 22, A.cz); labelReal.visible = false;
    const ap = textSprite(['⛔ مطار الملك خالد الدولي', 'منطقة حظر طيران'], 1024, 240, 1600, '#ef4444');
    ap.position.set(F.cx, 650, F.cz);
    group.add(labelFb, labelReal, ap);
    S.fb = { group, local, blds, labelFb, labelReal, ap };
  }

  // ---------------- البلاطات الحقيقية ----------------
  function dropTiles() {
    if (!S.tiles) return;
    try { if (S.tiles.group.parent) S.tiles.group.parent.remove(S.tiles.group); S.tiles.dispose(); } catch (e) { /* */ }
    S.tiles = null; S.ready = false; S.rootOK = false; S.switched = false; S.flat = false; S.tilesOn = false;
  }
  function startTiles(R) {
    if (!S.tiles) { if (!createTiles(R)) { G3.mode = 'fallback'; useFallback(); once('fb', G3.status + ' — هذا مجسم تقريبي', 'info'); return; } }
    R.scene.add(S.tiles.group);
    S.tiles.group.visible = S.switched;
    S.tilesOn = true;
    if (!S.rootOK) S.tStart = S.clock;
    G3.mode = S.ready ? 'tiles' : 'loading';
    G3.status = S.ready ? 'الخريطة الحقيقية جاهزة' : 'جاري تحميل الخريطة الحقيقية…';
    if (!S.ready) once('load', '🌍 جاري تحميل الخريطة الحقيقية لأكاديمية طويق… (لحظات)', 'info');
  }
  function failTiles(msg, e) {
    if (e) console.warn('Geo3D: ' + safe(e && (e.message || e)));
    S.err = msg; S.errT = S.clock; G3.status = msg; S.tilesOn = false;
    if (S.tiles && S.R) { S.R.scene.remove(S.tiles.group); try { S.tiles.dispose(); } catch (x) { /* */ } }
    S.tiles = null; S.ready = false; S.rootOK = false;
    if (S.switched) { S.switched = false; setFbVisible(true); }
    useFallback();
    G3.mode = 'fallback';
    once('fail', 'ما قدرنا نحمّل الخريطة الحقيقية (' + msg + ') — نكمل بالمجسم التقريبي', 'bad');
  }
  function createTiles(R) {
    const T3 = window.Tiles3D, THREE = window.THREE;
    const custom = G3.customUrl(), key = G3.key();
    let tiles;
    try {
      tiles = new T3.TilesRenderer(custom || GOOGLE_ROOT);
      if (!custom) {
        const auth = new T3.GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true });
        // نراقب طلب الجذر: لو رفض (مفتاح/نت) نوقف بهدوء ونرجع للمجسم (بدون ما ينطبع الرابط اللي فيه المفتاح)
        const watch = {
          name: 'SIM_WATCH',
          fetchData(uri, opt) {
            const root = /\/v1\/3dtiles\/root\.json/.test(uri), N = S.net;
            N.inflight++;
            return auth.fetchData(uri, opt).then(res => {
              N.inflight--; N.done++; N.lastT = S.clock; N.codes[res.status] = (N.codes[res.status] || 0) + 1;
              if (root && !res.ok) { S.rootFail = 'HTTP ' + res.status; failLater(res.status === 403 || res.status === 400 ? 'المفتاح مرفوض (' + res.status + ')' : res.status === 429 ? 'خلصت حصة اليوم (429)' : 'الخادم رد ' + res.status); return new Promise(() => {}); }
              return res;
            }, err => {
              N.inflight--; N.err++;
              if (root) { S.rootFail = 'network'; failLater('ما فيه نت'); return new Promise(() => {}); }
              throw err;
            });
          }
        };
        tiles.registerPlugin(watch);
        tiles.registerPlugin(auth);
      }
      // المواد: صورة البلاطات كما هي (بدون إضاءة ولا tone mapping) + لون حسب الوقت (الغروب/الليل أغمق)
      tiles.registerPlugin({
        name: 'SIM_MATERIALS',
        processTileModel(scene) {
          const tint = S.tintC || (S.tintC = new THREE.Color(1, 1, 1));
          scene.traverse(c => {
            if (!c.isMesh || !c.material) return;
            const m0 = c.material, m = new THREE.MeshBasicMaterial({ map: m0.map || null });
            if (m0.map) m.color.copy(tint); else if (m0.color) m.color.copy(m0.color).multiply(tint);
            if (c.geometry && c.geometry.attributes.color) m.vertexColors = true;
            m.toneMapped = false; m.fog = true; c.material = m; m0.dispose();
            c.castShadow = false; c.receiveShadow = false;
          });
        }
      });
      const draco = new T3.DRACOLoader(); draco.setDecoderPath('lib/draco/');
      const gltf = new T3.GLTFLoader(tiles.manager); gltf.setDRACOLoader(draco);
      if (T3.GLTFCesiumRTCExtension) gltf.register(() => new T3.GLTFCesiumRTCExtension());
      tiles.manager.addHandler(/\.(gltf|glb)$/i, gltf);
      S.draco = draco;
      // الأداء
      const tier = MOBILE && R.tier !== 'tv' ? 'mobile' : R.tier;
      S.baseErr = CFG.err[tier] || CFG.err.medium;
      tiles.errorTarget = S.baseErr;
      tiles.lruCache.minBytesSize = CFG.bytes[0] * 1048576; tiles.lruCache.maxBytesSize = CFG.bytes[1] * 1048576;
      // عدد البلاطات: قوقل فيها ملفات كثيرة (JSON + نماذج) — لو العدد صغير الكاش يمتلي ويوقف التحميل. الحد الحقيقي = الحجم بالميغا
      tiles.lruCache.minSize = MOBILE ? 2500 : 5000; tiles.lruCache.maxSize = MOBILE ? 3500 : 7000;
      tiles.downloadQueue.maxJobs = CFG.jobs[0]; tiles.parseQueue.maxJobs = CFG.jobs[1];
      tiles.autoDisableRendererCulling = false;   // three يقص اللي برا الكاميرا (عندنا أكثر من كاميرا)
      // الأولوية: اللي قدام الكاميرا وأهم (خطأ أكبر = أقرب/أخشن) أول — بدل "الأسطح أول" اللي يحمّل الأفق كله قبل اللي جنبك
      const prio = (a, b) => {
        if (a.__inFrustum !== b.__inFrustum) return a.__inFrustum ? 1 : -1;
        if (a.__used !== b.__used) return a.__used ? 1 : -1;
        if (a.__error !== b.__error) return a.__error > b.__error ? 1 : -1;
        if (a.__depthFromRenderedParent !== b.__depthFromRenderedParent) return a.__depthFromRenderedParent > b.__depthFromRenderedParent ? -1 : 1;
        return a.__distanceFromCamera > b.__distanceFromCamera ? -1 : a.__distanceFromCamera < b.__distanceFromCamera ? 1 : 0;
      };
      tiles.downloadQueue.priorityCallback = prio; tiles.parseQueue.priorityCallback = prio;
      // خطأ الشاشة: نفس حساب المكتبة، بس البعيد عن الكاميرا (> sseNear) نقلل طلبه (الخطأ × near/المسافة)
      // — من الأرض الكاميرا تشوف كيلومترات من الأفق (ألف بلاطة) وما يبقى مكان للي جنبك. كاميرا "تحت الدرون" ما تتأثر
      tiles.calculateError = function (tile) {
        const bv = tile.cached.boundingVolume, cams = this.cameras, infos = this.cameraInfo, F = S.sseF;
        let maxError = 0, minDistance = Infinity;
        for (let i = 0, l = cams.length; i < l; i++) {
          const info = infos[i];
          let error, dist = 0;
          if (!info.isOrthographic) { dist = bv.distanceToPoint(info.position); if (dist < minDistance) minDistance = dist; }
          // مهم: كل كاميرا تحسب بس للبلاطات اللي تشوفها — وإلا كاميرا "تحت الدرون" (خطأها ما يعتمد على المسافة)
          // تطلب تفاصيل دقيقة لبلاطات بعيدة 8 كم تشوفها الكاميرا الرئيسية، وتمتلي الذاكرة (هذا اللي صار في 0.3.39)
          if (!bv.intersectsFrustum(info.frustum)) continue;
          if (info.isOrthographic) error = tile.geometricError / info.pixelSize;
          else { error = tile.geometricError / (dist * info.sseDenominator); if (dist > F) error *= F / dist; }
          if (error > maxError) maxError = error;
        }
        tile.__distanceFromCamera = minDistance; tile.__error = maxError;
      };
      tiles.addEventListener('load-tile-set', () => { S.rootOK = true; });
      tiles.addEventListener('load-model', () => { S.dirty = true; S.loads++; if (S.firstData < 0) S.firstData = S.clock; });
      tiles.addEventListener('dispose-model', () => { S.dirty = true; });
      // كاميرا "تحت الدرون" (عشان تتحمل الأرض والمباني اللي تحته حتى لو الكاميرا تطالع قدام)
      const lod = new THREE.OrthographicCamera(-CFG.lodHalf, CFG.lodHalf, CFG.lodHalf, -CFG.lodHalf, 1, CFG.capTop + 2000);
      lod.up.set(0, 0, -1);
      // نسخة من الكاميرا الرئيسية بمدى أقصر (للتحميل بس)
      const main = new THREE.PerspectiveCamera(40, 1, CFG.near, CFG.lodFar); main.matrixAutoUpdate = false;
      tiles.setCamera(main); tiles.setCamera(lod);
      S.lod = lod; S.main = main; S.lodErr = -1;
      S.tiles = tiles;
      S.yOff = CFG.initialY; S.ready = false; S.switched = false; S.firstData = -1; S.loads = 0; S.idleT = 0; S.rootOK = false; S.rootFail = '';
      applyGroupMatrix();
      makeCapture(R);
      return true;
    } catch (e) {
      console.warn('Geo3D: ' + safe(e && (e.message || e)));
      G3.status = 'ما قدرنا نشغّل مكتبة الخريطة الحقيقية';
      S.err = G3.status; S.errT = S.clock;
      return false;
    }
  }
  let pendingFail = '';
  const failLater = m => { pendingFail = m; };   // من داخل promise → نطبقه في الفريم الجاي

  // مصفوفة البلاطات: ECEF → محلي (x شرق، y فوق، z جنوب) + إزاحة الارتفاع (الأرض عند المنصة = 0)
  function applyGroupMatrix() {
    const g = S.tiles.group, R9 = DS.Geo.rot, O = DS.Geo.origin;
    const tx = -(R9[0] * O[0] + R9[1] * O[1] + R9[2] * O[2]);
    const ty = -(R9[3] * O[0] + R9[4] * O[1] + R9[5] * O[2]) + S.yOff;
    const tz = -(R9[6] * O[0] + R9[7] * O[1] + R9[8] * O[2]);
    g.matrix.set(R9[0], R9[1], R9[2], tx, R9[3], R9[4], R9[5], ty, R9[6], R9[7], R9[8], tz, 0, 0, 0, 1);
    g.matrix.decompose(g.position, g.quaternion, g.scale);
    g.updateMatrixWorld(true);
  }

  // ---------------- شبكة الارتفاعات من البلاطات (نرسمها من فوق ونقرا البكسلات) ----------------
  function makeCapture(R) {
    if (S.cap) return;
    const THREE = window.THREE, N = CFG.capN, half = N * CFG.capCell / 2;
    const rt = new THREE.WebGLRenderTarget(N, N, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false, generateMipmaps: false });
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, CFG.capTop + 2000); cam.up.set(0, 0, -1);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTop: { value: CFG.capTop }, uBase: { value: CFG.capBase }, uRange: { value: CFG.capRange } },
      vertexShader: 'varying float vZ; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: [
        'uniform float uTop; uniform float uBase; uniform float uRange; varying float vZ;',
        'void main(){ float v = clamp((uTop + vZ - uBase) / uRange, 0.0, 0.999999);',
        '  vec3 e = fract(v * vec3(1.0, 255.0, 65025.0)); e -= e.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);',
        '  gl_FragColor = vec4(e, 1.0); }'].join('\n'),
      side: THREE.DoubleSide
    });
    const scene = new THREE.Scene(); scene.overrideMaterial = mat; scene.matrixWorldAutoUpdate = true;
    S.cap = { rt, cam, mat, scene, buf: new Uint8Array(N * N * 4), clear: new THREE.Color(), tmp: new Float32Array(N * N) };
    S.field = new DS.HeightField(N, N, CFG.capCell);
  }
  function capture(R, cx, cz) {
    const C = S.cap, T = S.tiles, r = R.renderer, f = S.field, N = CFG.capN, cell = CFG.capCell;
    cx = Math.round(cx / cell) * cell; cz = Math.round(cz / cell) * cell;
    C.cam.position.set(cx, CFG.capTop, cz); C.cam.lookAt(cx, 0, cz); C.cam.updateMatrixWorld();
    const g = T.group, vis = g.visible, parent = g.parent, hid = S.hidTmp;
    C.scene.add(g); g.visible = true;
    hid.length = 0;   // البلاطات الخشنة ما ندخلها في الشبكة (تطلع سطح مستوي فوق المباني وقت التحميل)
    for (const tile of T.visibleTiles) { const sc = tile.cached && tile.cached.scene; if (sc && sc.visible && tile.geometricError > CFG.geMax) { sc.visible = false; hid.push(sc); } }
    r.getClearColor(C.clear); const ca = r.getClearAlpha(), prevRT = r.getRenderTarget(), sc = r.getScissorTest();
    r.setScissorTest(false);
    r.setRenderTarget(C.rt); r.setClearColor(0x000000, 0); r.clear(true, true, false);
    r.render(C.scene, C.cam);
    r.readRenderTargetPixels(C.rt, 0, 0, N, N, C.buf);
    r.setRenderTarget(prevRT); r.setClearColor(C.clear, ca); r.setScissorTest(sc);
    for (let i = 0; i < hid.length; i++) hid[i].visible = true;
    g.visible = vis; if (parent) parent.add(g); else R.scene.add(g);
    // فك الترميز: صف 0 تحت الصورة = جنوب (z كبير)
    const B = C.buf, H = f.h, base = CFG.capBase, range = CFG.capRange;
    let valid = 0;
    f.setCenter(cx, cz);
    for (let py = 0; py < N; py++) {
      const j = N - 1 - py;
      for (let px = 0; px < N; px++) {
        const o = (py * N + px) * 4;
        if (B[o + 3] < 128) { H[j * N + px] = NaN; continue; }
        const v = B[o] / 255 + B[o + 1] / 65025 + B[o + 2] / 16581375;
        H[j * N + px] = base + v * range; valid++;
      }
    }
    f.version++;
    if (S.flat) rasterOsm();
    S.valid = Math.round(valid / (N * N) * 100);
    S.captures++; S.lastCap = S.clock; S.dirty = false;
  }

  // مباني OSM في شبكة الارتفاعات (لما بلاطات قوقل هنا مستوية) — بس اللي داخل نافذة الشبكة
  function rasterOsm() {
    const f = S.field, B = DS.TUWAIQ.buildings, x0 = f.x0, z0 = f.z0, x1 = x0 + f.nx * f.cell, z1 = z0 + f.nz * f.cell;
    for (let i = 0; i < B.length; i++) {
      const P = B[i].p; let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
      for (let k = 0; k < P.length; k += 2) { if (P[k] < a) a = P[k]; if (P[k] > b) b = P[k]; if (P[k + 1] < c) c = P[k + 1]; if (P[k + 1] > d) d = P[k + 1]; }
      if (b < x0 || a > x1 || d < z0 || c > z1) continue;
      f.rasterPoly(P, B[i].h);
    }
  }
  // كم نسبة الخلايا اللي فيها معلومة حول نقطة
  function validAround(x, z, r) {
    const f = S.field; let n = 0, v = 0;
    for (let dz = -r; dz <= r; dz += 1) for (let dx = -r; dx <= r; dx += 1) { if (dx * dx + dz * dz > r * r) continue; n++; const h = f.at(x + dx, z + dz); if (h === h) v++; }
    return n ? v / n : 0;
  }
  // الإحصائيات حول نقطة (نصف قطر r): الوسيط والمدى (لأرض مستوية)
  const ST = { med: 0, min: 0, max: 0, n: 0 };
  function statsAt(x, z, r) {
    const f = S.field, c = f.cell, tmp = S.cap.tmp;
    let n = 0, mn = Infinity, mx = -Infinity;
    for (let dz = -r; dz <= r; dz += c) for (let dx = -r; dx <= r; dx += c) {
      if (dx * dx + dz * dz > r * r) continue;
      const v = f.at(x + dx, z + dz); if (v !== v) continue;
      tmp[n++] = v; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    ST.n = n; ST.min = mn; ST.max = mx;
    if (!n) { ST.med = NaN; return ST; }
    const sub = tmp.subarray(0, n); sub.sort(); ST.med = sub[n >> 1];
    return ST;
  }
  function percentileAround(x, z, r, q) {
    const f = S.field, tmp = S.cap.tmp, c = f.cell * 2;
    let n = 0;
    for (let dz = -r; dz <= r; dz += c) for (let dx = -r; dx <= r; dx += c) { const v = f.at(x + dx, z + dz); if (v === v) tmp[n++] = v; }
    if (!n) return NaN;
    const sub = tmp.subarray(0, n); sub.sort(); return sub[Math.min(n - 1, Math.floor(n * q))];
  }
  // المنصة: مكان مستوي على الأرض (مو سطح) قريب من الساحة. يرجع ارتفاع الأرض هناك
  function findPad() {
    const TW = DS.TUWAIQ, sp = TW.spawn, lvl = percentileAround(sp.x, sp.z, 45, 0.25);
    if (lvl !== lvl) return null;
    const ok = (x, z) => { const s = statsAt(x, z, 2.5); return s.n > 12 && s.max - s.min < 0.45 && s.med < lvl + 1.5 ? s.med : NaN; };
    let px = sp.x, pz = sp.z, g = ok(px, pz);
    for (let r = 2; g !== g && r <= CFG.padSearch; r += 2) {
      const steps = Math.max(8, Math.round(2 * Math.PI * r / 2));
      for (let k = 0; k < steps; k++) {
        const a = k / steps * 2 * Math.PI, x = sp.x + Math.sin(a) * r, z = sp.z - Math.cos(a) * r, v = ok(x, z);
        if (v === v) { px = x; pz = z; g = v; break; }
      }
    }
    if (g !== g) { const s = statsAt(sp.x, sp.z, 3); g = s.n ? s.min : lvl; px = sp.x; pz = sp.z; }
    // الطيار: 8 م ورا المنصة (جنوب) أو جنب، على أرض مستوية
    let lx = px, lz = pz + 8;
    const tries = [[0, 8], [8, 0], [-8, 0], [0, -8], [0, 12], [10, 6], [-10, 6], [6, 6], [-6, 6]];
    for (let i = 0; i < tries.length; i++) { const v = ok(px + tries[i][0], pz + tries[i][1]); if (v === v && Math.abs(v - g) < 1.2) { lx = px + tries[i][0]; lz = pz + tries[i][1]; break; } }
    S.pad = { x: Math.round(px * 10) / 10, z: Math.round(pz * 10) / 10 }; S.pilot = { x: Math.round(lx * 10) / 10, z: Math.round(lz * 10) / 10 };
    return g;
  }
  // نحرك الأرض (البلاطات + الشبكة) بحيث المنصة = 0
  function shiftY(dy) {
    if (!dy) return;
    S.yOff += dy; applyGroupMatrix();
    const H = S.field.h; for (let i = 0; i < H.length; i++) H[i] += dy;   // NaN يبقى NaN
    S.field.version++;
  }
  // المنصة والطيار للجلسة (لو الدرون على الأرض وطافي)
  function applyPad(s) {
    if (!S.pad || !s || !s.drone) return;
    const d = s.drone, P = S.pad, L = S.pilot || { x: P.x, z: P.z + 8 };
    if (DS.HOME) { DS.HOME.x = P.x; DS.HOME.z = P.z; }
    if (DS.PILOT) { DS.PILOT.x = L.x; DS.PILOT.z = L.z; }
    if (s.spawn) { s.spawn.x = P.x; s.spawn.z = P.z; s.spawn.y = 0; }
    d.home = { x: P.x, z: P.z, y: 0 };
    if (d.onGround && !d.motors && !d.airborne && !d.crashed) {
      d.p.x = P.x; d.p.z = P.z; d.p.y = 0; d._groundY = 0; d._geoG = 0; d._lx = P.x; d._lz = P.z;
      d._gpx = P.x; d._gpy = 0; d._gpz = P.z;
      if (s.pose0) { s.pose0.x = P.x; s.pose0.y = 0; s.pose0.z = P.z; }
      if (S.R) S.R.snapCam = true;
    } else if (d.onGround) {
      const v = S.proxy.groundAt(d.p.x, d.p.z, d.p.y + 50);
      if (v != null) { d.p.y = v; d._groundY = v; d._geoG = v; }
    }
  }
  function switchToTiles(s) {
    S.switched = true; G3.mode = 'tiles'; G3.status = 'الخريطة الحقيقية (Google 3D)';
    S.tiles.group.visible = true; setFbVisible(false);
    S.proxy.field = S.field; S.proxy.outside = null;
    applyPad(s);
    once('switch', '🌍 هذي الخريطة الحقيقية لأكاديمية طويق (Google 3D) — طِر بحذر حول المبنى', 'good');
    if (S.flat) once('flat', 'قوقل عندها صورة حقيقية لهالمكان بس بدون مجسمات 3D — المباني اللي تشوفها من خريطة OSM (تقريبية)', 'info');
  }

  function tilesFrame(dt, R, s) {
    const T = S.tiles, d = s.drone;
    if (pendingFail) { const m = pendingFail; pendingFail = ''; failTiles(m); return; }
    // الكاميرات (الرئيسية + الصغيرة + تحت الدرون)
    const pr = R.renderer.getPixelRatio(), c = R.cam, M = S.main;
    c.updateMatrixWorld(); c.matrixWorldInverse.copy(c.matrixWorld).invert();
    M.matrixWorld.copy(c.matrixWorld); M.matrixWorldInverse.copy(c.matrixWorldInverse);
    if (M.fov !== c.fov || M.aspect !== c.aspect) { M.fov = c.fov; M.aspect = c.aspect; M.updateProjectionMatrix(); }
    S.sseF = CFG.sseNear + 2 * Math.max(0, c.position.y);   // من فوق نشوف أبعد بتفاصيل أكثر
    T.setResolution(M, Math.max(1, R.w * pr), Math.max(1, R.h * pr));
    if (S.lodErr !== T.errorTarget) { S.lodErr = T.errorTarget; const res = Math.round(T.errorTarget * 2 * CFG.lodHalf / CFG.lodGe); T.setResolution(S.lod, res, res); }
    const pc = R.pipCam;
    if (s.pip) {
      if (!T.hasCamera(pc)) T.setCamera(pc);
      pc.updateMatrixWorld(); pc.matrixWorldInverse.copy(pc.matrixWorld).invert();
      const rr = R.pipRect; T.setResolution(pc, rr ? rr.w * pr : 400, rr ? rr.h * pr : 225);
    } else if (T.hasCamera(pc)) T.deleteCamera(pc);
    const L = S.lod;
    L.position.set(d.p.x, CFG.capTop, d.p.z); L.lookAt(d.p.x, 0, d.p.z); L.updateMatrixWorld(); L.matrixWorldInverse.copy(L.matrixWorld).invert();
    T.update();
    // الأداء: لو الفريمات قليلة نخفف التفاصيل
    S.adaptT += dt;
    if (S.adaptT > 2) {   // وقت التحميل الفريمات تنزل لحالها — نقيس بس لما يهدأ التحميل
      S.adaptT = 0;
      const loading = T.stats.downloading + T.stats.parsing > 0;
      if (!loading && S.emaDt > 1 / 36) T.errorTarget = Math.min(S.baseErr * 1.8, T.errorTarget * 1.15);
      else if (S.emaDt < 1 / 52) T.errorTarget = Math.max(S.baseErr, T.errorTarget * 0.93);
    }
    if (!S.rootOK || S.loads === 0) { if (!S.rootOK && S.clock - S.tStart > 40) failTiles('الخريطة ما ردت'); return; }
    // شبكة الارتفاعات حول الدرون
    const f = S.field, since = S.clock - S.lastCap;
    const far = Math.abs(d.p.x - f.cx) > CFG.recenter || Math.abs(d.p.z - f.cz) > CFG.recenter;
    if (since >= CFG.capMin && (S.captures === 0 || far || (S.dirty && since > CFG.capEvery) || since > CFG.capMax)) capture(R, d.p.x, d.p.z);
    const busy = T.stats.downloading + T.stats.parsing;
    S.idleT = busy ? 0 : S.idleT + dt;
    if (!S.ready) {
      const waited = S.firstData >= 0 ? S.clock - S.firstData : 0;
      if (S.captures > 0 && (S.idleT > CFG.readyIdle || waited > CFG.readyTimeout) && S.clock - S.readyTry > 1) {
        S.readyTry = S.clock;
        const sp = DS.TUWAIQ.spawn;
        capture(R, sp.x, sp.z);
        S.padValid = validAround(sp.x, sp.z, 10);
        if (S.padValid < 0.85) return;   // لسا ما وصلت البلاطات الدقيقة عند المنصة
        const g = findPad();
        if (g != null && g === g) {
          shiftY(-g); S.ready = true; G3.mode = 'tiles'; G3.status = 'الخريطة الحقيقية جاهزة';
          // قوقل في بعض الأماكن عندها صورة على أرض بس (بدون مباني 3D): نشيك حول الأكاديمية — لو مستوية نحط مباني OSM فوقها
          const A = DS.TUWAIQ.academy || sp, st = statsAt(A.cx != null ? A.cx : sp.x, A.cz != null ? A.cz : sp.z, 45);
          S.flat = !(st.n > 50 && st.max - st.med > 6);
          if (S.flat) rasterOsm();
        }
      }
      return;
    }
    if (!S.switched) {
      if (d.onGround && !d.motors) switchToTiles(s);
      else once('wait', '🌍 الخريطة الحقيقية جاهزة — هبّط وطفّ المحركات عشان تنتقل لها', 'info');
      return;
    }
    // قبل أول إقلاع: نضبط الأرض عند المنصة = 0 (البلاطات تتحسن مع الوقت)
    if (d.onGround && !d.motors && !d.airborne && S.pad && since < 0.05) {
      const st = statsAt(S.pad.x, S.pad.z, 2);
      if (st.n > 8 && Math.abs(st.med) > 0.12 && st.max - st.min < 0.6) shiftY(-st.med);
    }
  }
  // لون البلاطات حسب الوقت
  function applyTint(tod) {
    S.tintTod = tod;
    const THREE = window.THREE, t = TINT[tod] || TINT.day;
    if (!S.tintC) S.tintC = new THREE.Color(1, 1, 1);
    S.tintC.setRGB(t[0], t[1], t[2]);
    if (S.tiles) S.tiles.forEachLoadedModel(sc => sc.traverse(c => { if (c.isMesh && c.material && c.material.isMeshBasicMaterial && c.material.map) c.material.color.copy(S.tintC); }));
  }

  // ---------------- الحقوق (Google + OSM) تحت بالنص ----------------
  function showOverlay(on) {
    if (typeof document === 'undefined' || !document.body) return;
    let el = S.overlay;
    if (!el && on) {
      if (!document.getElementById('g3dCss')) {
        const st = document.createElement('style'); st.id = 'g3dCss';
        st.textContent = '#g3dAttr{position:fixed;left:50%;bottom:3px;transform:translateX(-50%);max-width:62vw;padding:2px 10px;border-radius:8px;' +
          'background:rgba(0,0,0,.45);color:#e5e7eb;font:11px/1.45 Tahoma,Arial,sans-serif;text-align:center;pointer-events:none;z-index:3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:ltr}' +
          '#g3dAttr b{font:700 12px Arial,sans-serif;color:#fff;margin-left:2px}#g3dAttr.off{display:none}body.tv #g3dAttr{bottom:calc(3vh);font-size:13px}';
        document.head.appendChild(st);
      }
      el = S.overlay = document.createElement('div'); el.id = 'g3dAttr';
      el.innerHTML = '<b></b><span></span>';
      document.body.appendChild(el);
    }
    if (el) { el.className = on ? '' : 'off'; S.attrTxt = ''; S.attrT = 99; }
  }
  function overlayTick(dt) {
    const el = S.overlay; if (!el) return;
    S.attrT += dt; if (S.attrT < 0.5) return; S.attrT = 0;
    let head = '', txt;
    if (S.switched && S.tiles) {
      const a = S.attrArr; a.length = 0;
      try { S.tiles.getAttributions(a); } catch (e) { /* */ }
      let data = '';
      for (let i = 0; i < a.length; i++) if (a[i].type === 'string' && a[i].value) data += (data ? '; ' : '') + a[i].value;
      head = G3.customUrl() ? '3D Tiles' : 'Google';
      txt = (data ? ' • ' + data : '') + ' • © OpenStreetMap contributors';
    } else txt = 'مجسم تقريبي • المباني والمطار: © OpenStreetMap contributors';
    if (head + txt !== S.attrTxt) { S.attrTxt = head + txt; el.firstChild.textContent = head; el.lastChild.textContent = txt; }
  }
})();
