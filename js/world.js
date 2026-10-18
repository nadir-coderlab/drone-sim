// العالم ثلاثي الأبعاد (يحتاج three.js): المناظر الثابتة من DS.World (مدمجة/مكررة عشان أوامر الرسم تكون قليلة)
// + أشكال المهام (DS.Vis). كل جسم له userData.therm (0..1) = سطوعه في الكاميرا الحرارية.
(function () {
  const DS = window.DS, U = DS.U;
  let THREE, T = null;   // T = متغيرات مؤقتة (تنسوى مرة وحدة)
  const G = {};          // أشكال أساسية مشتركة

  function initTemps() {
    if (T) return;
    T = { m: new THREE.Matrix4(), v: new THREE.Vector3(), v2: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(),
      c: new THREE.Color(), nm: new THREE.Matrix3(), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1), e: new THREE.Euler() };
    G.box = new THREE.BoxGeometry(1, 1, 1);
  }

  // ---------------- القوام (canvas) ----------------
  let maxAniso = 4;
  function canvasTex(w, h, draw, repeat, aniso) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding; t.anisotropy = Math.min(aniso || 1, maxAniso);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  DS.canvasTex = (w, h, draw, repeat, aniso) => { THREE = window.THREE; return canvasTex(w, h, draw, repeat, aniso); };

  const texCache = {};
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();   // لون hex بمساحة خطية (مثل الصورة)
  const once = (k, f) => texCache[k] || (texCache[k] = f());

  const groundTex = () => once('ground', () => canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, w, h);
    const r = U.rng(7);
    for (let i = 0; i < 5200; i++) {
      const l = 175 + r() * 80 | 0; g.fillStyle = 'rgba(' + l + ',' + l + ',' + l + ',0.55)';
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 3);
    }
  }, [750, 750], 8));

  const sandTex = () => once('sand', () => canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e3c99c'; g.fillRect(0, 0, w, h);
    const r = U.rng(11);
    for (let y = 0; y < h; y += 2) {   // تموجات الرمل
      g.strokeStyle = 'rgba(160,125,80,' + (0.05 + r() * 0.06) + ')'; g.lineWidth = 1.2;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.07 + y * 0.31) * 2.2);
      g.stroke(); y += 5 + r() * 4;
    }
    for (let i = 0; i < 2500; i++) { g.fillStyle = r() < 0.5 ? 'rgba(120,90,60,0.25)' : 'rgba(255,245,225,0.3)'; g.fillRect(r() * w, r() * h, 1, 1); }
  }, [34, 34], 8));

  function fieldTex() {
    const F = DS.FIELD, W = 1024, H = 1024, kx = W / (F.x1 - F.x0), kz = H / (F.z1 - F.z0);
    return canvasTex(W, H, (g) => {
      const px = x => (x - F.x0) * kx, pz = z => (z - F.z0) * kz;
      for (let z = F.z0; z < F.z1; z += 5) { g.fillStyle = ((z / 5) & 1) ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'; g.fillRect(0, pz(z), W, 5 * kz); }
      g.strokeStyle = 'rgba(255,255,255,0.33)'; g.lineWidth = 2;
      for (let x = F.x0; x <= F.x1; x += 10) { g.beginPath(); g.moveTo(px(x), 0); g.lineTo(px(x), H); g.stroke(); }
      for (let z = F.z0 + 5; z <= F.z1; z += 10) { g.beginPath(); g.moveTo(0, pz(z)); g.lineTo(W, pz(z)); g.stroke(); }
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(px(0), 0); g.lineTo(px(0), H); g.stroke();
      g.strokeRect(3, 3, W - 6, H - 6);
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = 'bold 30px Tahoma, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let z = -10; z >= F.z0 + 5; z -= 10) { g.fillText(String(-z), px(-52), pz(z)); g.fillText(String(-z), px(52), pz(z)); }
    }, null, 8);
  }

  function padTex(label, color) {
    return canvasTex(256, 256, (g) => {
      g.fillStyle = '#2b3138'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 108, 0, Math.PI * 2); g.stroke();
      g.fillStyle = color || '#facc15'; g.font = 'bold 130px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label || 'H', 128, 138);
    }, null, 4);
  }

  function stripeTex(c1, c2, n, vertical) {
    return canvasTex(64, 256, (g, w, h) => {
      for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? c2 : c1; if (vertical) g.fillRect(0, i * h / n, w, h / n); else g.fillRect(i * w / n, 0, w / n, h); }
    });
  }

  // نوافذ العمارات: 4 أعمدة × 4 أدوار (12.8 م × 13.6 م) — lit = نسخة الليل (النوافذ المنورة)
  const WIN = { cw: 12.8, ch: 13.6 };
  function windowTex(style, lit) {
    return once('win:' + style + lit, () => canvasTex(256, 256, (g, w, h) => {
      const r = U.rng(style === 'office' ? 31 : 47), cw = w / 4, ch = h / 4;
      if (lit) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
      else { g.fillStyle = style === 'office' ? '#8d9aa6' : '#d9c9a8'; g.fillRect(0, 0, w, h); }
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const x = i * cw, y = j * ch;
          if (style === 'office') {
            const gx = x + 3, gy = y + 5, gw = cw - 6, gh = ch - 12;
            if (lit) { if (r() < 0.55) { g.fillStyle = r() < 0.7 ? 'rgba(255,244,214,0.95)' : 'rgba(200,225,255,0.9)'; g.fillRect(gx, gy, gw, gh); } else r(); }
            else { const t = 70 + r() * 40 | 0; g.fillStyle = 'rgb(' + (t - 20) + ',' + (t + 5) + ',' + (t + 30) + ')'; g.fillRect(gx, gy, gw, gh); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(gx, gy, gw, gh * 0.35); }
          } else {
            const gx = x + cw * 0.22, gy = y + ch * 0.22, gw = cw * 0.56, gh = ch * 0.5;
            if (lit) { if (r() < 0.45) { g.fillStyle = 'rgba(255,214,150,0.95)'; g.fillRect(gx, gy, gw, gh); } else r(); }
            else { g.fillStyle = '#4a5560'; g.fillRect(gx, gy, gw, gh); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(gx - 3, gy + gh, gw + 6, 4); r(); }
          }
        }
      }
    }, [1, 1], 4));
  }

  // أرض المدينة: شوارع + أرصفة + خطوط مشاة
  function cityTex(Z) {
    const W = 1024, H = 1024, kx = W / (Z.x1 - Z.x0), kz = H / (Z.z1 - Z.z0);
    return canvasTex(W, H, (g) => {
      const px = x => (x - Z.x0) * kx, pz = z => (z - Z.z0) * kz;
      g.fillStyle = '#3d4044'; g.fillRect(0, 0, W, H);
      const r = U.rng(3);
      for (let i = 0; i < 9000; i++) { const l = 50 + r() * 30 | 0; g.fillStyle = 'rgba(' + l + ',' + l + ',' + l + ',0.5)'; g.fillRect(r() * W, r() * H, 1.5, 1.5); }
      const cols = [-270, -200, -130], rows = [[-150, -125], [-100, -55], [-30, 15]];
      for (const cx of cols) for (const [z0, z1] of rows) {
        g.fillStyle = '#a49c8e'; g.fillRect(px(cx - 22.5), pz(z0), 45 * kx, (z1 - z0) * kz);
        g.fillStyle = '#8f887c'; g.fillRect(px(cx - 20.5), pz(z0 + 2), 41 * kx, (z1 - z0 - 4) * kz);
      }
      // خطوط الشوارع المتقطعة
      g.strokeStyle = 'rgba(240,240,230,0.8)'; g.lineWidth = 2; g.setLineDash([3 * kx, 5 * kx]);
      for (const zc of [-112.5, -42.5, 27.5]) { g.beginPath(); g.moveTo(0, pz(zc)); g.lineTo(W, pz(zc)); g.stroke(); }
      for (const xc of [-305, -235, -165]) { g.beginPath(); g.moveTo(px(xc), 0); g.lineTo(px(xc), H); g.stroke(); }
      g.setLineDash([]);
      // ممرات مشاة عند التقاطعات
      g.fillStyle = 'rgba(245,245,240,0.85)';
      for (const xc of [-305, -235, -165]) for (const zc of [-112.5, -42.5, 27.5]) {
        for (let k = -5; k <= 5; k++) {
          g.fillRect(px(xc + k * 2 - 0.5), pz(zc - 12.5 - 3), 1 * kx, 3 * kz);
          g.fillRect(px(xc + k * 2 - 0.5), pz(zc + 12.5), 1 * kx, 3 * kz);
        }
      }
      // ساحة برج الاتصالات
      g.fillStyle = '#7d776c'; g.fillRect(px(-160), pz(-30), 28 * kx, 22 * kz);
    }, null, 8);
  }

  function roadTex() {
    return once('road', () => canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#3a3c40'; g.fillRect(0, 0, w, h);
      const r = U.rng(9);
      for (let i = 0; i < 1500; i++) { const l = 45 + r() * 35 | 0; g.fillStyle = 'rgba(' + l + ',' + l + ',' + l + ',0.6)'; g.fillRect(r() * w, r() * h, 1, 1); }
      g.fillStyle = '#e8d24a'; g.fillRect(5, 0, 3, h); g.fillRect(w - 8, 0, 3, h);   // خطوط الحافة
      g.fillStyle = '#f2f2f2'; g.fillRect(w / 2 - 1.5, 0, 3, h * 0.4);               // الخط المتقطع (3 م من 8)
    }, [1, 1], 8));
  }

  function raceTex(x0, z0, x1, z1) {
    const W = 512, H = 512, kx = W / (x1 - x0), kz = H / (z1 - z0);
    return canvasTex(W, H, (g) => {
      const px = x => (x - x0) * kx, pz = z => (z - z0) * kz;
      for (let i = 0; i < 20; i++) { g.fillStyle = i % 2 ? '#5f9a3e' : '#6eab48'; g.fillRect(0, i * H / 20, W, H / 20 + 1); }
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; g.strokeRect(px(x0 + 4), pz(z0 + 4), (x1 - x0 - 8) * kx, (z1 - z0 - 8) * kz);
      // منطقة الطيارين + خط البداية
      g.fillStyle = 'rgba(190,170,130,0.9)'; g.fillRect(px(104), pz(16), 40 * kx, 22 * kz);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (let k = 0; k < 12; k++) g.fillRect(px(150 + k * 3), pz(10), 1.5 * kx, 1.5 * kz);
      g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.fillText('START', px(168), pz(6));
    }, null, 8);
  }

  const glowTex = () => once('glow', () => canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }));
  DS.glowTex = () => { THREE = window.THREE; return glowTex(); };

  function label(text, color, scale) {
    const tex = canvasTex(128, 128, (g) => {
      g.fillStyle = 'rgba(15,23,32,0.78)'; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
      g.lineWidth = 7; g.strokeStyle = color || '#fff'; g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 62px Tahoma, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(text), 64, 68);
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(scale || 1.5, scale || 1.5, 1); sp.renderOrder = 20;
    return sp;
  }

  // ---------------- دمج الأشكال (عشان أوامر رسم أقل) ----------------
  class Merger {
    constructor(withUv) { this.pos = []; this.nor = []; this.col = []; this.uv = withUv ? [] : null; this.count = 0; }
    add(g, m, c) {
      const src = g.index ? g.toNonIndexed() : g;
      const P = src.attributes.position, N = src.attributes.normal, UVA = src.attributes.uv;
      T.nm.getNormalMatrix(m); T.c.set(c).convertSRGBToLinear();   // ألوان hex = sRGB → نخزنها خطية عشان تطلع مثل ما اخترناها
      const start = this.count;
      for (let i = 0; i < P.count; i++) {
        T.v.fromBufferAttribute(P, i).applyMatrix4(m); this.pos.push(T.v.x, T.v.y, T.v.z);
        if (N) { T.v.fromBufferAttribute(N, i).applyMatrix3(T.nm).normalize(); this.nor.push(T.v.x, T.v.y, T.v.z); } else this.nor.push(0, 1, 0);
        this.col.push(T.c.r, T.c.g, T.c.b);
        if (this.uv) { if (UVA) this.uv.push(UVA.getX(i), UVA.getY(i)); else this.uv.push(0, 0); }
      }
      this.count += P.count;
      if (src !== g) src.dispose();
      return { start, count: P.count };
    }
    // صندوق: مقاس + مكان (مركز) + لف حول y
    box(w, h, d, x, y, z, c, ry) {
      T.q.setFromAxisAngle(T.Y, ry || 0);
      T.m.compose(T.v2.set(x, y, z), T.q, T.s.set(w, h, d));
      return this.add(G.box, T.m, c);
    }
    // عارضة بين نقطتين (سماكة t)
    beam(ax, ay, az, bx, by, bz, t, c, t2) {
      const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-4) return null;
      T.v.set(dx / len, dy / len, dz / len); T.q.setFromUnitVectors(T.Z, T.v);
      T.m.compose(T.v2.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), T.q, T.s.set(t, t2 || t, len));
      return this.add(G.box, T.m, c);
    }
    geo(g, x, y, z, c, sx, sy, sz, ry, rx, rz) {
      T.e.set(rx || 0, ry || 0, rz || 0, 'YXZ'); T.q.setFromEuler(T.e);
      T.m.compose(T.v2.set(x, y, z), T.q, T.s.set(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz));
      const r = this.add(g, T.m, c); g.dispose(); return r;
    }
    // مربع بنقاط وعادي ولون + uv
    quad(a, b, cc, d, n, col, uv) {
      if (col && col.isColor) T.c.copy(col); else T.c.set(col).convertSRGBToLinear();
      const P = [a, b, cc, a, cc, d], UV = uv ? [uv[0], uv[1], uv[2], uv[0], uv[2], uv[3]] : null;
      for (let i = 0; i < 6; i++) {
        this.pos.push(P[i][0], P[i][1], P[i][2]); this.nor.push(n[0], n[1], n[2]); this.col.push(T.c.r, T.c.g, T.c.b);
        if (this.uv) { if (UV) this.uv.push(UV[i][0], UV[i][1]); else this.uv.push(0, 0); }
      }
      this.count += 6;
    }
    build() {
      if (!this.count) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.computeBoundingSphere();
      this.pos = this.nor = this.col = this.uv = null;
      return g;
    }
  }
  DS.Merger = Merger;

  // جدار عمارة بنوافذ: من (x0,z0) إلى (x1,z1)، والعادي للخارج بعيد عن (cx,cz)
  function wall(M, x0, z0, x1, z1, y0, y1, cx, cz, uOff, col) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    let nx = dz / len, nz = -dx / len;
    if (nx * ((x0 + x1) / 2 - cx) + nz * ((z0 + z1) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
    // يمين الناظر من برا = cross(Y, n) = (nz, 0, -nx)
    let ax = x0, az = z0, bx = x1, bz = z1;
    if (dx * nz + dz * -nx < 0) { ax = x1; az = z1; bx = x0; bz = z0; }
    const u0 = uOff, u1 = uOff + len / WIN.cw, v0 = y0 / WIN.ch, v1 = y1 / WIN.ch;
    M.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [nx, 0, nz], col, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }
  function buildingWalls(M, b, col) {
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, u = (b.c || 0) * 3;
    wall(M, x0, z0, x1, z0, 0, b.h, b.x, b.z, u, col);
    wall(M, x1, z0, x1, z1, 0, b.h, b.x, b.z, u + 0.37, col);
    wall(M, x1, z1, x0, z1, 0, b.h, b.x, b.z, u + 0.71, col);
    wall(M, x0, z1, x0, z0, 0, b.h, b.x, b.z, u + 0.13, col);
  }
  function buildingRoof(M, b, col) {
    const p = 0.8;
    M.box(b.w, 0.3, b.d, b.x, b.h - 0.1, b.z, col);
    M.box(b.w + 0.3, p, 0.3, b.x, b.h + p / 2, b.z - b.d / 2, col);
    M.box(b.w + 0.3, p, 0.3, b.x, b.h + p / 2, b.z + b.d / 2, col);
    M.box(0.3, p, b.d, b.x - b.w / 2, b.h + p / 2, b.z, col);
    M.box(0.3, p, b.d, b.x + b.w / 2, b.h + p / 2, b.z, col);
    if (b.housing) M.box(b.housing.w, b.housing.h, b.housing.d, b.x, b.h + b.housing.h / 2, b.z, 0x8c8c88);
  }

  // شخص (للطيار): جسم مدمج
  function personGeo(shirt, withRC) {
    const M = new Merger(false), skin = 0xc58c5c, pants = 0x3a3f47;
    M.box(0.16, 0.85, 0.18, -0.11, 0.43, 0, pants); M.box(0.16, 0.85, 0.18, 0.11, 0.43, 0, pants);
    M.box(0.46, 0.62, 0.26, 0, 1.17, 0, shirt);
    M.geo(new THREE.SphereGeometry(0.13, 10, 8), 0, 1.62, 0, skin);
    M.geo(new THREE.CylinderGeometry(0.14, 0.14, 0.07, 10), 0, 1.72, 0, 0x2b2f36);   // كاب
    M.box(0.2, 0.025, 0.12, 0, 1.70, -0.13, 0x2b2f36);
    if (withRC) {
      M.beam(-0.24, 1.42, 0, -0.1, 1.12, -0.27, 0.1, shirt); M.beam(0.24, 1.42, 0, 0.1, 1.12, -0.27, 0.1, shirt);
      M.box(0.22, 0.05, 0.12, 0, 1.12, -0.32, 0x222222);
      M.box(0.012, 0.09, 0.012, -0.08, 1.18, -0.36, 0x333333); M.box(0.012, 0.09, 0.012, 0.08, 1.18, -0.36, 0x333333);
    } else {
      M.box(0.11, 0.55, 0.12, -0.3, 1.15, -0.02, shirt); M.box(0.11, 0.55, 0.12, 0.3, 1.15, -0.02, shirt);
    }
    return M.build();
  }

  // ---------------- مادة نقاط الإضاءة (لمبات بالليل/الدرون) ----------------
  // حجم النقطة بالمتر يصغر مع البعد بس ما يقل عن minPx — عشان تبين الأضواء من بعيد
  DS.lightMaterial = function () {
    THREE = window.THREE;
    return new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, intensity: { value: 1 }, pr: { value: 1 }, minPx: { value: 2 }, scale: { value: 500 } },
      vertexShader: [
        'attribute vec3 lcolor; attribute float lsize; attribute float blink;',
        'uniform float time; uniform float intensity; uniform float pr; uniform float minPx; uniform float scale;',
        'varying vec3 vC; varying float vA;',
        'void main(){',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  float d = max(0.05, -mv.z), on = 1.0;',
        '  if (blink > 0.0) { float ph = fract(time / blink + position.x * 0.0131 + position.z * 0.007); on = ph < 0.16 ? 1.0 : 0.0; }',
        '  vA = intensity * on; vC = lcolor;',
        '  gl_PointSize = on * max(minPx, lsize * scale / d) * pr;',
        '  gl_Position = projectionMatrix * mv;',
        '}'].join('\n'),
      fragmentShader: [
        'varying vec3 vC; varying float vA;',
        'void main(){ float r = length(gl_PointCoord * 2.0 - 1.0); if (r > 1.0) discard;',
        '  float core = smoothstep(0.5, 0.0, r), halo = (1.0 - r) * (1.0 - r) * 0.5, a = clamp(core + halo, 0.0, 1.0);',
        '  gl_FragColor = vec4(vC * (0.6 + 0.8 * core), a * vA); }'].join('\n'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
  };
  // نقاط: [{x,y,z,c (hex), s (متر), b (فترة الوميض ث، 0 = ثابت)}]
  DS.LIGHT_MATS = DS.LIGHT_MATS || [];
  DS.lightPoints = function (list, mat) {
    THREE = window.THREE;
    const n = list.length, P = new Float32Array(n * 3), C = new Float32Array(n * 3), S = new Float32Array(n), B = new Float32Array(n), col = new THREE.Color();
    list.forEach((l, i) => { P[i * 3] = l.x; P[i * 3 + 1] = l.y; P[i * 3 + 2] = l.z; col.set(l.c); C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b; S[i] = l.s || 1; B[i] = l.b || 0; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('lcolor', new THREE.BufferAttribute(C, 3));
    g.setAttribute('lsize', new THREE.BufferAttribute(S, 1));
    g.setAttribute('blink', new THREE.BufferAttribute(B, 1));
    const lm = mat || DS.lightMaterial();
    if (DS.LIGHT_MATS.indexOf(lm) < 0) DS.LIGHT_MATS.push(lm);   // Render يحدّث مقاسها كل رسمة
    const pts = new THREE.Points(g, lm);
    pts.userData.noThermal = true; pts.renderOrder = 5;
    return pts;
  };

  // لون الأرض (يتغير: حديقة خضرا قريب، يابسة بعيد، رمل قرب الصحراء)
  function groundColor(x, z, Z, out) {
    const n = 0.5 * Math.sin(x * 0.011 + 1.3) * Math.sin(z * 0.013 - 0.7) + 0.3 * Math.sin(x * 0.031 + z * 0.027) + 0.2 * Math.sin(x * 0.05 - z * 0.043 + 2);
    const d = Math.hypot(x, z + 40);
    const wet = U.clamp(1 - (d - 170) / 280, 0, 1);
    const D = Z.desert, ddx = Math.max(D.x0 - x, 0, x - D.x1), ddz = Math.max(D.z0 - z, 0, z - D.z1);
    const sand = U.clamp(1 - Math.hypot(ddx, ddz) / 170, 0, 1);
    // أخضر → يابس → رمل
    let r = U.lerp(0.62, 0.36, wet), g = U.lerp(0.57, 0.55, wet), b = U.lerp(0.36, 0.22, wet);
    const k = U.clamp(n * 0.12, -0.1, 0.1); r += k; g += k; b += k * 0.6;
    const sd = Math.max(sand, (1 - wet) * 0.3);
    r = U.lerp(r, 0.88, sd); g = U.lerp(g, 0.76, sd); b = U.lerp(b, 0.55, sd);
    const C = Z.city;
    if (x > C.x0 - 15 && x < C.x1 + 6 && z > C.z0 - 15 && z < C.z1 + 15) { r = U.lerp(r, 0.58, 0.6); g = U.lerp(g, 0.55, 0.6); b = U.lerp(b, 0.46, 0.6); }
    out.setRGB(r, g, b).convertSRGBToLinear();   // ألوان النقاط تنضرب في القوام (اللي ينفك من sRGB) — نخليها خطية
    return out;
  }

  // ---------------- بناء العالم ----------------
  // يرجّع W: {sky, sun, hemi, fogBase, sock, pilot, home, nightPts, pools, hills, winMats, groundAt(), ...}
  DS.buildWorld = function (scene, renderer) {
    THREE = window.THREE; initTemps();
    try { maxAniso = renderer.capabilities.getMaxAnisotropy() || 1; } catch (e) { maxAniso = 1; }
    const WD = (DS.World && DS.World.zones) ? DS.World : (DS.buildWorldData ? (DS.World = DS.buildWorldData()) : DS.World);
    const Z = WD.zones || {}, F = DS.FIELD;
    const W = { thermStatic: [] };
    const addT = (o, level) => { o.userData.therm = level; scene.add(o); return o; };

    // السماء (لونها + الشمس/القمر + نجوم بالليل)
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x2f6fbf) }, mid: { value: new THREE.Color(0xa9cdeb) }, bot: { value: new THREE.Color(0xd9cfb8) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xffffff) }, glow: { value: 0.3 }, stars: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; uniform float stars; varying vec3 vP;',
        'float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
        'void main(){ vec3 d = normalize(vP); float h = d.y;',
        '  vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h * 1.4, 0.0, 1.0), 0.7)) : mix(mid, bot, clamp(-h * 5.0, 0.0, 1.0));',
        '  float sd = max(dot(d, sunDir), 0.0);',
        '  c += sunCol * (pow(sd, 8.0) * 0.35 * glow + pow(sd, 900.0) * 1.6);',
        '  if (stars > 0.0 && h > 0.03) { vec3 q = d * 420.0; float s = hash(floor(q));',
        '    if (s > 0.9955) { float r = length(fract(q) - 0.5); c += vec3(smoothstep(0.32, 0.0, r) * (s - 0.9955) / 0.0045) * stars * (0.4 + 0.6 * h); } }',
        '  gl_FragColor = vec4(c, 1.0); }'].join('\n')
    }));
    sky.renderOrder = -10; sky.frustumCulled = false; sky.scale.setScalar(2000); scene.add(sky); W.sky = sky;
    sky.userData.therm = 0.03;
    scene.fog = new THREE.Fog(0xc9dbe8, 260, 1700); W.fogBase = scene.fog.color.clone();

    // الإضاءة
    const hemi = new THREE.HemisphereLight(0xd6eaff, 0x5f7a38, 0.85); scene.add(hemi); W.hemi = hemi;
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.25);
    sun.castShadow = false; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 300;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target); W.sun = sun;

    // ---- الأرض (لون متغير بالـ vertex colors)
    {
      const g = new THREE.PlaneGeometry(6000, 6000, 64, 64); g.rotateX(-Math.PI / 2);
      const P = g.attributes.position, col = new Float32Array(P.count * 3), c = new THREE.Color();
      for (let i = 0; i < P.count; i++) { groundColor(P.getX(i), P.getZ(i), Z, c); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: groundTex(), vertexColors: true }));
      ground.receiveShadow = true; addT(ground, 0.2); W.ground = ground;
    }
    const overlay = (geo, mat, y, level, layer) => {
      mat.polygonOffset = true; mat.polygonOffsetFactor = -1 - layer; mat.polygonOffsetUnits = -2 - 2 * layer;
      const m = new THREE.Mesh(geo, mat); m.position.y = y; m.receiveShadow = true; m.renderOrder = layer; return addT(m, level);
    };
    // ساحة التدريب
    {
      const g = new THREE.PlaneGeometry(F.x1 - F.x0, F.z1 - F.z0); g.rotateX(-Math.PI / 2); g.translate((F.x0 + F.x1) / 2, 0, (F.z0 + F.z1) / 2);
      overlay(g, new THREE.MeshLambertMaterial({ map: fieldTex(), transparent: true, depthWrite: false }), 0.02, 0.22, 1);
    }
    // المدينة
    if (Z.city) {
      const C = Z.city, g = new THREE.PlaneGeometry(C.x1 - C.x0, C.z1 - C.z0); g.rotateX(-Math.PI / 2); g.translate((C.x0 + C.x1) / 2, 0, (C.z0 + C.z1) / 2);
      overlay(g, new THREE.MeshLambertMaterial({ map: cityTex(C) }), 0.02, 0.3, 1);
    }
    // حديقة السباق
    if (Z.race) {
      const x0 = 98, x1 = 298, z0 = -164, z1 = 48;
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
      overlay(g, new THREE.MeshLambertMaterial({ map: raceTex(x0, z0, x1, z1) }), 0.02, 0.2, 1);
    }
    // الصحراء (مستوية — الكثبان أجسام لها تصادم)
    if (Z.desert) {
      const D = Z.desert, g = new THREE.PlaneGeometry(D.x1 - D.x0 + 60, D.z1 - D.z0 + 60, 24, 24); g.rotateX(-Math.PI / 2); g.translate((D.x0 + D.x1) / 2, 0, (D.z0 + D.z1) / 2);
      const P = g.attributes.position, col = new Float32Array(P.count * 3), c = new THREE.Color();
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), z = P.getZ(i), n = 0.5 + 0.25 * Math.sin(x * 0.02) * Math.cos(z * 0.017) + 0.25 * Math.sin(x * 0.05 + z * 0.04);
        c.setRGB(0.93 + 0.07 * n, 0.86 + 0.08 * n, 0.78 + 0.08 * n).convertSRGBToLinear();
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      overlay(g, new THREE.MeshLambertMaterial({ map: sandTex(), vertexColors: true }), 0.015, 0.4, 1);
    }
    // الطرق (شريط واحد مدمج لكل الطرق، uv على طول الطريق كل 8 م)
    if (WD.roads) {
      const M = new Merger(true);
      for (const rd of WD.roads) {
        const p = rd.pts, n = p.length, hw = rd.w / 2, y = rd.closed ? 0.05 : 0.035, cnt = rd.closed ? n + 1 : n;
        const Lp = [], Rp = [], V = [];
        let along = 0;
        for (let k = 0; k < cnt; k++) {
          const i = k % n, c = p[i];
          const a = rd.closed ? p[(i - 1 + n) % n] : p[Math.max(0, i - 1)], b = rd.closed ? p[(i + 1) % n] : p[Math.min(n - 1, i + 1)];
          let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
          if (k > 0) { const pc = p[(k - 1) % n]; along += Math.hypot(c.x - pc.x, c.z - pc.z); }
          Lp.push([c.x + tz * hw, y, c.z - tx * hw]); Rp.push([c.x - tz * hw, y, c.z + tx * hw]); V.push(along / 8);
        }
        for (let k = 0; k + 1 < cnt; k++) M.quad(Lp[k], Rp[k], Rp[k + 1], Lp[k + 1], [0, 1, 0], 0xffffff, [[0, V[k]], [1, V[k]], [1, V[k + 1]], [0, V[k + 1]]]);
      }
      const g = M.build();
      if (g) overlay(g, new THREE.MeshLambertMaterial({ map: roadTex() }), 0, 0.32, 2);
    }

    // ---- منصة البيت (تتحرك مع DS.HOME) + الطيار (يتحرك مع DS.PILOT ويلف على الدرون)
    {
      const apron = overlay(new THREE.PlaneGeometry(5, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6f6c66 }), 0.03, 0.3, 3);
      const pad = overlay(new THREE.CircleGeometry(1.25, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: padTex('H') }), 0.05, 0.3, 4);
      const pl = []; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; pl.push({ x: Math.sin(a) * 1.45, y: 0.08, z: Math.cos(a) * 1.45, c: k % 2 ? 0x7dff9a : 0xffffff, s: 0.25 }); }
      const padLights = DS.lightPoints(pl); pad.add(padLights); padLights.visible = false;
      W.home = { apron, pad, lights: padLights, x: NaN, z: NaN, px: NaN, pz: NaN };
      const pilot = new THREE.Mesh(personGeo(0x1e3a8a, true), new THREE.MeshLambertMaterial({ vertexColors: true }));
      pilot.castShadow = true; addT(pilot, 0.95); W.pilot = pilot;
    }

    // ---- الشجر (مكرر instanced: 5 أوامر رسم لكل الشجر)
    if (WD.trees) {
      const trees = WD.trees, pines = trees.filter(t => t.kind === 'pine'), rounds = trees.filter(t => t.kind === 'round'), palms = trees.filter(t => t.kind === 'palm');
      const col = new THREE.Color(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), m4 = new THREE.Matrix4();
      const trunkG = new THREE.CylinderGeometry(0.12, 0.22, 1, 6); trunkG.translate(0, 0.5, 0);
      const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: lin(0x6b4f2a) }), pines.length + rounds.length);
      let ti = 0;
      const pineG = new THREE.ConeGeometry(1, 1, 8); pineG.translate(0, 0.5, 0);
      const pineM = new THREE.InstancedMesh(pineG, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, pines.length));
      pines.forEach((t, i) => {
        m4.compose(v.set(t.x, 0, t.z), q, s.set(1, t.h * 0.3, 1)); trunks.setMatrixAt(ti++, m4);
        m4.compose(v.set(t.x, t.h * 0.15, t.z), q, s.set(t.cr, t.h * 0.85, t.cr)); pineM.setMatrixAt(i, m4);
        pineM.setColorAt(i, col.setHSL(0.3 + t.hue * 0.05, 0.42, 0.18 + t.hue * 0.07));
      });
      const roundM = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, rounds.length));
      rounds.forEach((t, i) => {
        const th = Math.max(1.2, t.h - 1.5 * t.cr);
        m4.compose(v.set(t.x, 0, t.z), q, s.set(1, th + 0.4, 1)); trunks.setMatrixAt(ti++, m4);
        m4.compose(v.set(t.x, t.h - 0.9 * t.cr, t.z), q.setFromAxisAngle(T.Y, t.hue * 6), s.set(t.cr, t.cr * 0.9, t.cr)); roundM.setMatrixAt(i, m4);
        roundM.setColorAt(i, col.setHSL(0.22 + t.hue * 0.08, 0.42, 0.22 + t.hue * 0.1));
      });
      q.identity();
      // النخل: جذع + سعف
      const palmTG = new THREE.CylinderGeometry(0.18, 0.3, 1, 7); palmTG.translate(0, 0.5, 0);
      const palmT = new THREE.InstancedMesh(palmTG, new THREE.MeshLambertMaterial({ color: lin(0x8a6a45) }), Math.max(1, palms.length));
      const PM = new Merger(false);
      for (let k = 0; k < 10; k++) {   // سعفة = شريط منحني (مربعات رفيعة، وجهين)
        const a = k / 10 * Math.PI * 2 + (k % 2) * 0.3, ca = Math.cos(a), sa = Math.sin(a), up = k % 2 ? 0.35 : 0.1;
        let px = 0, py = 0, pz = 0, pw = 0.12;
        for (let j = 1; j <= 4; j++) {
          const t2 = j / 4, nx = ca * t2 * 3.2, nz = sa * t2 * 3.2, ny = up + 0.6 * t2 - 1.6 * t2 * t2, w = 0.32 * (1.2 - t2 * 0.9);
          PM.quad([px - sa * pw, py, pz + ca * pw], [nx - sa * w, ny, nz + ca * w], [nx + sa * w, ny, nz - ca * w], [px + sa * pw, py, pz - ca * pw], [0, 1, 0], j % 2 ? 0x5f7f2e : 0x56752a);
          px = nx; py = ny; pz = nz; pw = w;
        }
      }
      PM.geo(new THREE.IcosahedronGeometry(0.42, 0), 0, -0.1, 0, 0x6d5a35);
      const palmC = new THREE.InstancedMesh(PM.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), Math.max(1, palms.length));
      palms.forEach((t, i) => {
        m4.compose(v.set(t.x, 0, t.z), q, s.set(1, t.h, 1)); palmT.setMatrixAt(i, m4);
        m4.compose(v.set(t.x, t.h, t.z), T.q.setFromAxisAngle(T.Y, t.hue * 6.28), s.setScalar(t.cr / 3)); palmC.setMatrixAt(i, m4);
        palmC.setColorAt(i, col.setHSL(0.2 + t.hue * 0.05, 0.3, 0.75 + t.hue * 0.2));
      });
      if (!pines.length) pineM.count = 0; if (!rounds.length) roundM.count = 0; if (!palms.length) { palmT.count = 0; palmC.count = 0; }
      [trunks, pineM, roundM, palmT, palmC].forEach(mm => { mm.castShadow = true; addT(mm, 0.12); });
      W.trees = [trunks, pineM, roundM, palmT, palmC];
    }

    // ---- العمارات: جدران بنوافذ (نوعين) + أسطح
    W.winMats = [];
    {
      const MO = new Merger(true), MR = new Merger(true), MF = new Merger(false), col = new THREE.Color();
      for (const b of WD.buildings || []) {
        if (b.style === 'office') buildingWalls(MO, b, col.setHSL(0.58, 0.08, 0.82 + b.c * 0.18));
        else buildingWalls(MR, b, b.style === 'villa' ? col.setHSL(0.1, 0.25, 0.86 + b.c * 0.1) : col.setHSL(0.09, 0.2, 0.78 + b.c * 0.2));
        buildingRoof(MF, b, b.style === 'villa' ? 0xb9b2a3 : 0x8a8a86);
        if (b.yard) {   // سور الفيلا
          const y = b.yard / 2, h = 2.5, c = 0xd8ccb4;
          MF.box(b.yard, h, 0.25, b.x, h / 2, b.z - y, c); MF.box(b.yard * 0.38, h, 0.25, b.x - b.yard * 0.31, h / 2, b.z + y, c); MF.box(b.yard * 0.38, h, 0.25, b.x + b.yard * 0.31, h / 2, b.z + y, c);
          MF.box(0.25, h, b.yard, b.x - y, h / 2, b.z, c); MF.box(0.25, h, b.yard, b.x + y, h / 2, b.z, c);
        }
      }
      const mk = (geo, style) => {
        if (!geo) return null;
        const mat = new THREE.MeshLambertMaterial({ map: windowTex(style, false), emissiveMap: windowTex(style, true), emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true });
        W.winMats.push(mat);
        const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; return addT(m, 0.28);
      };
      mk(MO.build(), 'office'); mk(MR.build(), 'res');
      const rg = MF.build();
      if (rg) { const roofs = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ vertexColors: true })); roofs.castShadow = roofs.receiveShadow = true; addT(roofs, 0.3); }
    }

    // ---- كل الأشياء الثابتة الثانية في مجسم واحد: سياج، أعمدة، أبراج، مسجد، خزان، خيام…
    const night = [];   // أضواء الليل
    const pools = [];   // بقع الضوء على الأرض
    {
      const M = new Merger(false);
      // سياج الساحة
      const postC = 0xf1f5f9, railC = 0xe2e8f0;
      for (let x = F.x0; x <= F.x1; x += 5) { M.box(0.09, 1.1, 0.09, x, 0.55, F.z0, postC); M.box(0.09, 1.1, 0.09, x, 0.55, F.z1, postC); }
      for (let z = F.z0 + 5; z < F.z1; z += 5) { M.box(0.09, 1.1, 0.09, F.x0, 0.55, z, postC); M.box(0.09, 1.1, 0.09, F.x1, 0.55, z, postC); }
      for (const y of [0.55, 1.0]) {
        M.box(F.x1 - F.x0, 0.05, 0.05, (F.x0 + F.x1) / 2, y, F.z0, railC); M.box(F.x1 - F.x0, 0.05, 0.05, (F.x0 + F.x1) / 2, y, F.z1, railC);
        M.box(0.05, 0.05, F.z1 - F.z0, F.x0, y, (F.z0 + F.z1) / 2, railC); M.box(0.05, 0.05, F.z1 - F.z0, F.x1, y, (F.z0 + F.z1) / 2, railC);
      }
      // عمود مؤشر الريح
      const ws = WD.windsock || { x: -8, z: 3, h: 5 };
      M.geo(new THREE.CylinderGeometry(0.05, 0.06, ws.h, 8), ws.x, ws.h / 2, ws.z, 0xdddddd);
      // أعمدة الكشافات
      for (const m of WD.masts || []) {
        M.geo(new THREE.CylinderGeometry(0.16, 0.28, m.h, 8), m.x, m.h / 2, m.z, 0x9aa1a8);
        const ay = Math.atan2(m.aim.x - m.x, -(m.aim.z - m.z)), rx = Math.cos(ay), rz = Math.sin(ay), fx = Math.sin(ay), fz = -Math.cos(ay);
        M.box(2.6, 0.12, 0.12, m.x, m.h, m.z, 0x6b7280, -ay);
        for (const o of [-0.9, 0, 0.9]) {
          M.box(0.5, 0.4, 0.25, m.x + rx * o + fx * 0.15, m.h + 0.3, m.z + rz * o + fz * 0.15, 0x3a3f45, -ay);
          night.push({ x: m.x + rx * o + fx * 0.32, y: m.h + 0.3, z: m.z + rz * o + fz * 0.32, c: 0xfff3dc, s: 1.4 });
        }
        const px = m.x + (m.aim.x - m.x) * 0.35, pz = m.z + (m.aim.z - m.z) * 0.35;
        pools.push({ x: px, z: pz, r: m.zone === 'field' ? 48 : 70, c: 0xfff1d8, k: 0.55 });
      }
      // أعمدة الإنارة
      for (const l of WD.lamps || []) {
        M.geo(new THREE.CylinderGeometry(0.07, 0.11, l.h, 6), l.x, l.h / 2, l.z, 0x7c838b);
        const fx = Math.sin(l.yaw), fz = -Math.cos(l.yaw);
        M.beam(l.x, l.h - 0.1, l.z, l.x + fx * 1.6, l.h + 0.05, l.z + fz * 1.6, 0.08, 0x7c838b);
        M.box(0.25, 0.12, 0.55, l.x + fx * 1.8, l.h, l.z + fz * 1.8, 0x50565d, -l.yaw);
        night.push({ x: l.x + fx * 1.8, y: l.h - 0.1, z: l.z + fz * 1.8, c: 0xffd59a, s: 0.9 });
        pools.push({ x: l.x + fx * 2.5, z: l.z + fz * 2.5, r: 8, c: 0xffc98a, k: 0.45 });
      }
      // برج الاتصالات الشبكي (مثلث، أحمر/أبيض)
      for (const tw of WD.towers || []) {
        const R = tw.face / Math.sqrt(3), legs = [0, 1, 2].map(k => { const a = k / 3 * Math.PI * 2 + 0.3; return [tw.x + Math.sin(a) * R, tw.z - Math.cos(a) * R]; });
        const sec = 3, nS = Math.round(tw.h / sec);
        for (let k = 0; k < nS; k++) {
          const y0 = k * sec, y1 = y0 + sec, c = (Math.floor(k / 3) % 2) ? 0xf2f2f2 : 0xd23b2f;
          for (let i = 0; i < 3; i++) {
            const a = legs[i], b = legs[(i + 1) % 3];
            M.beam(a[0], y0, a[1], a[0], y1, a[1], 0.16, c);
            M.beam(a[0], y1, a[1], b[0], y1, b[1], 0.08, c);
            M.beam(a[0], y0, a[1], b[0], y1, b[1], 0.05, c);
            M.beam(b[0], y0, b[1], a[0], y1, a[1], 0.05, c);
          }
        }
        // ألواح الهوائيات (12) + أطباق المايكرويف
        const P = tw.panels, per = P.n / 3;
        for (let i = 0; i < 3; i++) {
          const a = i / 3 * Math.PI * 2 + 0.3 + Math.PI / 3, fx = Math.sin(a), fz = -Math.cos(a), rx = Math.cos(a), rz = Math.sin(a);
          for (let j = 0; j < per; j++) {
            const o = (j - (per - 1) / 2) * 0.55, y = j % 2 ? P.y1 - 1 : P.y0 + 1.2;
            M.box(0.32, 1.9, 0.14, tw.x + fx * (R * 0.6 + 0.55) + rx * o, y, tw.z + fz * (R * 0.6 + 0.55) + rz * o, 0xe8e8e8, -a);
          }
          M.beam(tw.x, P.y0, tw.z, tw.x + fx * (R * 0.6 + 0.5), P.y0, tw.z + fz * (R * 0.6 + 0.5), 0.08, 0x9a9a9a);
          M.beam(tw.x, P.y1, tw.z, tw.x + fx * (R * 0.6 + 0.5), P.y1, tw.z + fz * (R * 0.6 + 0.5), 0.08, 0x9a9a9a);
        }
        for (const d of tw.dishes) {
          const fx = Math.sin(d.yaw), fz = -Math.cos(d.yaw);
          M.geo(new THREE.CylinderGeometry(0.6, 0.6, 0.35, 14), tw.x + fx * (R + 0.2), d.y, tw.z + fz * (R + 0.2), 0xdcdcdc, 1, 1, 1, -d.yaw, Math.PI / 2);
        }
        M.geo(new THREE.CylinderGeometry(0.04, 0.06, 4, 5), tw.x, tw.h + 2, tw.z, 0x777777);
        const sh = tw.shelter; M.box(sh.w, sh.h, sh.d, sh.x, sh.h / 2, sh.z, 0xc9c2b0);
        // سياج المجمع
        const fc = tw.fence || { r: 9, n: 24, h: 2 };
        for (let k = 0; k < fc.n; k++) { const a = k / fc.n * Math.PI * 2; M.box(0.06, fc.h, 0.06, tw.x + Math.sin(a) * fc.r, fc.h / 2, tw.z - Math.cos(a) * fc.r, 0x9aa0a6); }
        night.push({ x: tw.x, y: tw.h + 4.1, z: tw.z, c: 0xff2a1a, s: 1.2, b: 1.5 }, { x: tw.x, y: tw.h * 0.5, z: tw.z, c: 0xff2a1a, s: 0.9 });
      }
      // أبراج الكهرباء الشبكية + العوازل
      for (const L of WD.powerlines || []) {
        for (const p of L.pylons) {
          const c = 0xa7adb3, hb = 3.2, ht = 0.8, yw = 19;   // نص القاعدة / نص الرأس / الخصر
          const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
          for (let i = 0; i < 4; i++) {
            const [sx, sz] = corners[i], [tx, tz] = corners[(i + 1) % 4];
            M.beam(p.x + sx * hb, 0, p.z + sz * hb, p.x + sx * ht, yw, p.z + sz * ht, 0.2, c);
            M.beam(p.x + sx * ht, yw, p.z + sz * ht, p.x + sx * 0.5, p.h - 0.5, p.z + sz * 0.5, 0.14, c);
            // تكتيف X على كل وجه
            for (let k = 0; k < 4; k++) {
              const ya = k * yw / 4, yb = (k + 1) * yw / 4, wa = hb + (ht - hb) * ya / yw, wb = hb + (ht - hb) * yb / yw;
              M.beam(p.x + sx * wa, ya, p.z + sz * wa, p.x + tx * wb, yb, p.z + tz * wb, 0.07, c);
              M.beam(p.x + tx * wa, ya, p.z + tz * wa, p.x + sx * wb, yb, p.z + sz * wb, 0.07, c);
              M.beam(p.x + sx * wb, yb, p.z + sz * wb, p.x + tx * wb, yb, p.z + tz * wb, 0.07, c);
            }
          }
          // الذراع والقمة
          M.beam(p.x - 0.6, L.armY, p.z - L.armHalf, p.x - 0.6, L.armY, p.z + L.armHalf, 0.22, c);
          M.beam(p.x + 0.6, L.armY, p.z - L.armHalf, p.x + 0.6, L.armY, p.z + L.armHalf, 0.22, c);
          M.beam(p.x, L.armY + 1.6, p.z, p.x, L.armY, p.z - L.armHalf, 0.12, c); M.beam(p.x, L.armY + 1.6, p.z, p.x, L.armY, p.z + L.armHalf, 0.12, c);
          M.box(0.3, 1.2, 0.3, p.x, p.h - 0.3, p.z, c);
          // عوازل معلقة (أقراص)
          for (const w of L.wires) {
            if (w.kind !== 'phase') continue;
            for (let k = 0; k < 7; k++) M.geo(new THREE.CylinderGeometry(0.13, 0.13, 0.045, 10), p.x, w.y + 0.15 + k * 0.19, p.z + w.dz, 0x6f8f86);
            M.beam(p.x, w.y, p.z + w.dz, p.x, L.armY, p.z + w.dz, 0.03, 0x555555);
          }
        }
      }
      // المسجد + المنارة
      for (const pr of WD.props || []) {
        if (pr.kind === 'mosque') {
          M.box(pr.w, pr.h, pr.d, pr.x, pr.h / 2, pr.z, 0xf3efe6);
          M.box(pr.w + 0.4, 0.6, pr.d + 0.4, pr.x, pr.h + 0.3, pr.z, 0xe2dccf);
          M.geo(new THREE.SphereGeometry(pr.dome, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), pr.x, pr.h, pr.z, 0xf6f3ec);
          M.geo(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 5), pr.x, pr.h + pr.dome + 0.8, pr.z, 0xc9a227);
          for (let k = 0; k < 5; k++) M.box(1.6, 3, 0.1, pr.x - 8 + k * 4, 3.5, pr.z + pr.d / 2 + 0.02, 0x6b7a74);   // شبابيك
          const mn = pr.minaret;
          M.geo(new THREE.CylinderGeometry(mn.r * 0.85, mn.r, mn.h, 12), mn.x, mn.h / 2, mn.z, 0xf3efe6);
          M.geo(new THREE.CylinderGeometry(mn.r + 0.6, mn.r + 0.4, 0.5, 12), mn.x, mn.h * 0.75, mn.z, 0xe2dccf);
          M.geo(new THREE.CylinderGeometry(mn.r * 0.7, mn.r * 0.7, 2.5, 12), mn.x, mn.h + 1.25, mn.z, 0xf3efe6);
          M.geo(new THREE.ConeGeometry(mn.r * 0.8, 2.2, 12), mn.x, mn.h + 3.6, mn.z, 0x2f7d4f);
          night.push({ x: mn.x, y: mn.h * 0.75 + 0.4, z: mn.z, c: 0x3cff7a, s: 1.2 }, { x: mn.x, y: mn.h + 4.8, z: mn.z, c: 0x3cff7a, s: 0.9 });
        } else if (pr.kind === 'watertower') {
          M.geo(new THREE.CylinderGeometry(pr.r * 0.8, pr.r, pr.y0, 14), pr.x, pr.y0 / 2, pr.z, 0xe9e4da);
          M.geo(new THREE.ConeGeometry(pr.bowlR, pr.y1 - pr.y0 - 3, 20, 1, true), pr.x, pr.y0 + (pr.y1 - pr.y0 - 3) / 2, pr.z, 0x4c9bd6, 1, 1, 1, 0, Math.PI);
          M.geo(new THREE.CylinderGeometry(pr.bowlR, pr.bowlR, 3, 20), pr.x, pr.y1 - 1.5, pr.z, 0x5aa8e0);
          M.geo(new THREE.ConeGeometry(pr.bowlR * 0.95, 1.4, 20), pr.x, pr.y1 + 0.7, pr.z, 0xe9e4da);
          night.push({ x: pr.x, y: pr.y1 + 1.5, z: pr.z, c: 0xff2a1a, s: 1, b: 1.8 });
        } else if (pr.kind === 'tent') {
          for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) M.box(0.06, pr.h - 0.4, 0.06, pr.x + sx * pr.w / 2, (pr.h - 0.4) / 2, pr.z + sz * pr.d / 2, 0xdddddd);
          M.geo(new THREE.ConeGeometry(pr.w * 0.72, 0.9, 4, 1), pr.x, pr.h - 0.1, pr.z, 0xe2462f, 1, 1, 1, Math.PI / 4);
          M.box(pr.w, 0.35, 0.03, pr.x, pr.h - 0.6, pr.z + pr.d / 2, 0xe2462f);
        }
      }
      // أعلام على طرف حديقة السباق
      for (const pr of WD.props || []) if (pr.kind === 'banner') {
        M.geo(new THREE.CylinderGeometry(0.03, 0.04, pr.h, 5), pr.x, pr.h / 2, pr.z, 0x333333);
        M.box(0.55, 2.2, 0.02, pr.x + 0.3, pr.h - 1.2, pr.z, pr.color);
      }
      // أضواء التحذير فوق العمارات العالية
      for (const b of WD.buildings || []) if (b.h >= 45) night.push({ x: b.x, y: b.h + (b.housing ? b.housing.h : 0) + 1, z: b.z, c: 0xff2a1a, s: 0.9, b: 2 });
      const props = new THREE.Mesh(M.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
      props.castShadow = true; props.receiveShadow = true; addT(props, 0.3); W.props = props;
    }

    // ---- أسلاك الكهرباء (خطوط رفيعة ومرتخية)
    if (WD.powerlines && WD.powerlines.length) {
      const pts = [], SEG = 16;
      for (const L of WD.powerlines) {
        for (let k = 0; k + 1 < L.pylons.length; k++) {
          const xa = L.pylons[k].x, xb = L.pylons[k + 1].x;
          for (const w of L.wires) for (let i = 0; i < SEG; i++) {
            const ta = i / SEG, tb = (i + 1) / SEG;
            pts.push(xa + (xb - xa) * ta, w.y - 4 * w.sag * ta * (1 - ta), L.z + w.dz, xa + (xb - xa) * tb, w.y - 4 * w.sag * tb * (1 - tb), L.z + w.dz);
          }
        }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.computeBoundingSphere();
      const wires = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2b2b2b }));
      addT(wires, 0.45); W.wires = wires;
    }

    // ---- الصحراء: كثبان (قبب) + صخور
    if (WD.dunes && WD.dunes.length) {
      const th = Math.acos(2.4 / 2.6);
      const g = new THREE.SphereGeometry(2.6, 20, 4, 0, Math.PI * 2, 0, th); g.translate(0, -2.4, 0);
      const dm = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xffffff }), WD.dunes.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
      WD.dunes.forEach((d, i) => { m4.compose(v.set(d.x, 0.01, d.z), q, s.setScalar(d.a)); dm.setMatrixAt(i, m4); dm.setColorAt(i, col.setHex(i % 3 ? 0xdcbd8a : 0xd2b07c).convertSRGBToLinear()); });
      dm.receiveShadow = true; addT(dm, 0.42);
    }
    if (WD.rocks && WD.rocks.length) {
      const rm = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), WD.rocks.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color(), e = new THREE.Euler();
      WD.rocks.forEach((r, i) => { e.set(r.rot * 0.3, r.rot, 0); m4.compose(v.set(r.x, r.s * 0.22, r.z), q.setFromEuler(e), s.set(r.s, r.s * 0.7, r.s * 0.9)); rm.setMatrixAt(i, m4); rm.setColorAt(i, col.setHSL(0.07, 0.25, 0.32 + r.hue * 0.15)); });
      rm.castShadow = true; addT(rm, 0.38);
    }

    // ---- جبال بعيدة (مكررة)
    {
      const hr = U.rng(99), n = 26;
      const hm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: lin(0xa48b66) }), n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2 + hr() * 0.2, r = 1100 + hr() * 300;
        m4.compose(v.set(Math.sin(a) * r, -10, -45 - Math.cos(a) * r), q, s.set(120 + hr() * 160, 40 + hr() * 110, 120 + hr() * 160)); hm.setMatrixAt(i, m4);
      }
      addT(hm, 0.15); W.hills = hm;
    }

    // ---- مؤشر الريح (القماش يتحرك مع الريح)
    {
      const ws = WD.windsock || { x: -8, z: 3, h: 5 };
      const sockPivot = new THREE.Group(); sockPivot.position.set(ws.x, ws.h - 0.1, ws.z); sockPivot.rotation.order = 'YXZ';
      const sock = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.9, 14, 1, true), new THREE.MeshLambertMaterial({ map: stripeTex('#ef4444', '#f8fafc', 5, true), side: THREE.DoubleSide }));
      sock.rotation.x = -Math.PI / 2; sock.position.z = -0.95; sock.userData.therm = 0.25; sockPivot.add(sock); scene.add(sockPivot);
      W.sock = sockPivot;
    }

    // ---- أضواء الليل + بقع الضوء (تظهر بالليل والغروب بس)
    W.nightPts = DS.lightPoints(night); W.nightPts.visible = false; scene.add(W.nightPts);
    {
      const tex = once('pool', () => canvasTex(64, 64, (g) => {
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      }));
      const M = new Merger(true), c = new THREE.Color();
      for (const p of pools) {
        c.set(p.c).multiplyScalar(p.k);
        M.quad([p.x - p.r, 0, p.z + p.r], [p.x + p.r, 0, p.z + p.r], [p.x + p.r, 0, p.z - p.r], [p.x - p.r, 0, p.z - p.r], [0, 1, 0], c, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      const g = M.build();
      if (g) {
        const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 1,
          polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
        const m = new THREE.Mesh(g, mat); m.position.y = 0.06; m.renderOrder = 6; m.userData.noThermal = true; m.visible = false;
        scene.add(m); W.pools = m;
      }
    }

    // ارتفاع "الأرض" تحت نقطة (سطوح المباني والكثبان) — للظل الدائري تحت الدرون
    W.groundAt = function (x, z, below) {
      let top = 0;
      const list = WD.near ? WD.near(x, z) : [];
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        let h = -1;
        if (c.type === 'box') { if (!c.thin && Math.abs(x - c.x) < c.w / 2 && Math.abs(z - c.z) < c.d / 2) h = c.h; }
        else if (c.type === 'sphere') { const dx = x - c.x, dz = z - c.z, rr = c.r * c.r - dx * dx - dz * dz; if (rr > 0) h = c.y + Math.sqrt(rr); }
        else if (c.type === 'cyl') { if (c.r > 1.2 && (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z) < c.r * c.r) h = c.h; }
        if (h > top && h < below + 0.05) top = h;
      }
      return top;
    };
    return W;
  };

  // ---------------- أشكال المهام ----------------
  const COL = { next: 0x22d3ee, idle: 0x94a3b8, done: 0x22c55e, in: 0x22c55e, out: 0xf59e0b, fail: 0xef4444, bad: 0xef4444 };
  const OPA = { next: 0.9, idle: 0.3, done: 0.35, in: 0.9, out: 0.9, fail: 0.9, bad: 0.9 };
  const colorOf = c => (typeof c === 'number' ? c : (typeof c === 'string' ? c : 0x2563eb));

  // سيارة/شاحنة/قارب: جسم مدمج + غطا المكينة (حار في الحراري) + أضواء
  function vehicleParts(kind, paint) {
    const M = new Merger(false), H = new Merger(false), dark = 0x1d2329, glass = 0x23303a, tire = 0x181818, lights = [];
    if (kind === 'boat') {
      M.geo(new THREE.CylinderGeometry(0.7, 1.1, 5.6, 10, 1, false, 0, Math.PI), 0, 0.6, 0, paint, 0.55, 1, 1, Math.PI / 2, 0, -Math.PI / 2);   // نص اسطوانة = بدن
      M.box(2.0, 0.12, 5.4, 0, 0.62, 0.1, 0xf4f4f4);
      M.box(1.5, 0.9, 1.6, 0, 1.1, 0.4, 0xf4f4f4); M.box(1.52, 0.4, 1.0, 0, 1.25, -0.1, glass);
      H.box(0.6, 0.5, 0.7, 0, 0.75, 2.7, 0x333333);   // المكينة ورا
      lights.push({ x: -0.9, y: 0.9, z: -2.6, c: 0xff3333, s: 0.3 }, { x: 0.9, y: 0.9, z: -2.6, c: 0x33ff66, s: 0.3 }, { x: 0, y: 2.0, z: 0.9, c: 0xffffff, s: 0.35 });
      return { body: M.build(), hot: H.build(), lights, len: 5.6, w: 2.2 };
    }
    const truck = kind === 'truck';
    const L = truck ? 7.6 : 4.5, Wd = truck ? 2.4 : 1.8, wr = truck ? 0.48 : 0.33, f = -L / 2;
    for (const [sx, z] of [[-1, f + (truck ? 1.3 : 0.85)], [1, f + (truck ? 1.3 : 0.85)], [-1, L / 2 - (truck ? 1.5 : 0.85)], [1, L / 2 - (truck ? 1.5 : 0.85)]]) {
      M.geo(new THREE.CylinderGeometry(wr, wr, 0.26, 12), sx * (Wd / 2 - 0.12), wr, z, tire, 1, 1, 1, 0, 0, Math.PI / 2);   // محور العجلة عرضي
    }
    if (truck) {
      H.box(Wd, 1.1, 1.3, 0, 1.1, f + 0.65, paint);                // مقدمة الكابينة (المكينة)
      M.box(Wd, 1.3, 1.0, 0, 2.0, f + 1.5, paint); M.box(Wd + 0.02, 0.6, 0.7, 0, 2.2, f + 1.2, glass);
      M.box(Wd, 0.25, L - 2.2, 0, 1.2, f + 2.2 + (L - 2.2) / 2, 0x4b5563);   // صندوق مسطح
      M.box(0.1, 0.4, L - 2.2, -Wd / 2, 1.45, f + 2.2 + (L - 2.2) / 2, 0x374151); M.box(0.1, 0.4, L - 2.2, Wd / 2, 1.45, f + 2.2 + (L - 2.2) / 2, 0x374151);
      M.box(Wd - 0.2, 0.5, L - 0.4, 0, 0.62, 0, dark);
    } else {
      H.box(Wd, 0.6, 1.25, 0, 0.72, f + 0.62, paint);              // كبوت (المكينة)
      M.box(Wd, 0.62, L - 1.25, 0, 0.72, f + 1.25 + (L - 1.25) / 2, paint);
      M.box(Wd - 0.14, 0.52, 2.3, 0, 1.28, f + 2.35, paint);
      M.box(Wd - 0.12, 0.42, 2.0, 0, 1.3, f + 2.35, glass);
      M.box(Wd + 0.04, 0.12, L + 0.04, 0, 0.42, 0, dark);
    }
    const ly = truck ? 1.0 : 0.75;
    lights.push({ x: -Wd / 2 + 0.25, y: ly, z: f - 0.02, c: 0xfff6dd, s: 0.35 }, { x: Wd / 2 - 0.25, y: ly, z: f - 0.02, c: 0xfff6dd, s: 0.35 },
      { x: -Wd / 2 + 0.2, y: ly, z: L / 2 + 0.02, c: 0xff2020, s: 0.28 }, { x: Wd / 2 - 0.2, y: ly, z: L / 2 + 0.02, c: 0xff2020, s: 0.28 });
    return { body: M.build(), hot: H.build(), lights, len: L, w: Wd, bed: truck ? 1.33 : 0 };
  }

  DS.Vis = {
    make(R, spec) {
      THREE = window.THREE; initTemps();
      const scene = R.scene, objs = [], add = (...o) => { o.forEach(x => { scene.add(x); objs.push(x); }); };
      const h = {
        objs, set() {}, setArrow() {}, update() {}, move() {}, tick: null,
        remove() {
          if (R.thermRemove) R.thermRemove(objs);
          objs.forEach(o => { scene.remove(o); o.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => { const li = DS.LIGHT_MATS.indexOf(m); if (li >= 0) DS.LIGHT_MATS.splice(li, 1); if (m.map && !m.map.userData.shared) m.map.dispose(); m.dispose(); }); } }); });
          if (R.untick) R.untick(h); else if (R.ticks && R.ticks.delete) R.ticks.delete(h);
          if (h.onRemove) h.onRemove();
        }
      };
      const basic = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });
      const ring = (r, y, mat) => { const pts = []; for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); } return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat); };
      const hot = (o, level) => { o.traverse(c => { if (c.isMesh || c.isLine) c.userData.therm = level; }); return o; };

      switch (spec.type) {
        case 'zone': {
          const g = new THREE.Group(); g.position.set(spec.x, spec.y, spec.z);
          const mat = basic(COL.idle, 0.15), lm = new THREE.LineBasicMaterial({ color: COL.idle });
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(spec.r, spec.r, spec.h, 48, 1, true), mat), ring(spec.r, spec.h / 2, lm), ring(spec.r, -spec.h / 2, lm));
          const disc = new THREE.Mesh(new THREE.CircleGeometry(spec.r, 48), basic(COL.idle, 0.25)); disc.rotation.x = -Math.PI / 2; disc.position.set(spec.x, 0.07, spec.z);
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6), basic(0xffffff, 0.5));
          const arrow = new THREE.Group(); const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.1, 12), basic(0xff4d4d, 0.95)); cone.rotation.x = -Math.PI / 2; arrow.add(cone); arrow.visible = false;
          g.add(arrow);
          const place = () => { arrow.position.set(0, spec.h / 2 + 0.6, 0); stem.scale.y = Math.max(0.01, g.position.y - spec.h / 2); stem.position.set(spec.x, stem.scale.y / 2, spec.z); };
          place(); add(g, disc, stem);
          h.set = st => { const c = COL[st] || COL.idle; mat.color.setHex(c); lm.color.setHex(c); disc.material.color.setHex(c); };
          h.setArrow = yaw => { arrow.visible = yaw != null; if (yaw != null) arrow.rotation.y = -yaw; };
          h.update = p => { if (p.y != null) { g.position.y = p.y; place(); } };
          break;
        }
        case 'beacon': {
          const mats = [];
          const m = (c, o) => { const x = basic(c, o); mats.push([x, o]); return x; };
          const base = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.2, spec.r - 0.15), spec.r, 48), m(COL.idle, 0.9)); base.rotation.x = -Math.PI / 2; base.position.set(spec.x, 0.07, spec.z);
          const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, spec.alt, 8), m(COL.idle, 0.5)); beam.position.set(spec.x, spec.alt / 2, spec.z);
          const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), m(COL.idle, 0.95)); ball.position.set(spec.x, spec.alt, spec.z);
          const halo = new THREE.Mesh(new THREE.TorusGeometry(spec.r, 0.05, 6, 48), m(COL.idle, 0.8)); halo.rotation.x = Math.PI / 2; halo.position.copy(ball.position);
          add(base, beam, ball, halo);
          if (spec.label !== '' && spec.label != null) { const lb = label(spec.label, '#22d3ee', 1.4); lb.position.set(spec.x, spec.alt + 1.4, spec.z); add(lb); }
          h.set = st => { const c = COL[st] || COL.idle, f = OPA[st] || 0.3; mats.forEach(([mm, o]) => { mm.color.setHex(c); mm.opacity = o * f; }); };
          h.set('idle');
          break;
        }
        case 'gate': {
          const g = new THREE.Group(); g.position.set(spec.x, spec.y, spec.z); g.rotation.y = -spec.yaw;
          const mat = new THREE.MeshLambertMaterial({ color: 0x64748b, emissive: 0x000000 });
          const tor = new THREE.Mesh(new THREE.TorusGeometry(spec.R, 0.12, 10, 56), mat); tor.castShadow = true;
          const arr = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 12), basic(0xffffff, 0.55)); arr.rotation.x = -Math.PI / 2;
          g.add(tor, arr);
          const postH = Math.max(0.1, spec.y - spec.R - 0.15);
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, postH, 8), new THREE.MeshLambertMaterial({ color: 0x475569 })); post.position.set(spec.x, postH / 2, spec.z);
          const lb = label(spec.label, '#ff7a1a', 1.3); lb.position.set(spec.x, spec.y + spec.R + 0.9, spec.z);
          add(g, post, lb);
          h.set = st => {
            if (st === 'next') { mat.color.setHex(0xff7a1a); mat.emissive.setHex(0x7a2e00); arr.visible = true; }
            else if (st === 'done') { mat.color.setHex(0x22c55e); mat.emissive.setHex(0x0a3d1d); arr.visible = false; }
            else { mat.color.setHex(0x64748b); mat.emissive.setHex(0); arr.visible = false; }
          };
          h.set('idle');
          break;
        }
        case 'pylon': {
          const p = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, spec.h, 16), new THREE.MeshLambertMaterial({ map: stripeTex('#f97316', '#f8fafc', 8, true) }));
          p.position.set(spec.x, spec.h / 2, spec.z); p.castShadow = true;
          const top = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff3b3b })); top.position.set(spec.x, spec.h + 0.3, spec.z);
          add(p, top);
          break;
        }
        case 'pad': {
          const p = new THREE.Mesh(new THREE.CircleGeometry(spec.r, 48), new THREE.MeshLambertMaterial({ map: padTex(spec.label || '★', '#22d3ee'), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
          p.rotation.x = -Math.PI / 2; p.position.set(spec.x, 0.06, spec.z); p.receiveShadow = true;
          const rim = new THREE.Mesh(new THREE.RingGeometry(spec.r, spec.r + 0.25, 48), basic(0x22d3ee, 0.9)); rim.rotation.x = -Math.PI / 2; rim.position.set(spec.x, 0.07, spec.z);
          const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 6), basic(0x22d3ee, 0.4)); beam.position.set(spec.x, 3, spec.z);
          add(p, rim, beam);
          if (spec.hot) hot(p, 0.9);
          break;
        }
        case 'orbit': {
          const rg = new THREE.Mesh(new THREE.RingGeometry(spec.R - spec.band, spec.R + spec.band, 96), basic(0x38bdf8, 0.3)); rg.rotation.x = -Math.PI / 2; rg.position.set(spec.x, 0.07, spec.z);
          const st = new THREE.Group(); st.position.set(spec.x, 0, spec.z);
          const stone = new THREE.MeshLambertMaterial({ color: 0xd6c7a1 });
          const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 2.4), stone); b.position.y = 0.3;
          const c = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 3.4, 12), stone); c.position.y = 2.3;
          const t = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), new THREE.MeshPhongMaterial({ color: 0xd4a017, shininess: 60 })); t.position.y = 4.4;
          st.add(b, c, t); st.traverse(o => { if (o.isMesh) o.castShadow = true; });
          add(rg, st);
          h.set = s2 => rg.material.color.setHex(s2 === 'in' ? 0x22c55e : 0x38bdf8);
          break;
        }
        case 'heli': {
          const g = new THREE.Group();
          const red = new THREE.MeshLambertMaterial({ color: 0xc81e1e }), dk = new THREE.MeshLambertMaterial({ color: 0x222222 });
          const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), red); body.scale.set(1.3, 1.2, 2.4);
          const glass = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), new THREE.MeshPhongMaterial({ color: 0x9fd3ff, shininess: 90 })); glass.position.set(0, 0.3, -1.4); glass.scale.set(1, 0.8, 0.9);
          const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 5, 10), red); tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.3, 3.8);
          const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.8), red); fin.position.set(0, 1, 6.1);
          const rotor = new THREE.Group(); rotor.position.y = 1.5;
          rotor.add(new THREE.Mesh(new THREE.BoxGeometry(11, 0.06, 0.35), dk), new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 11), dk));
          const skidL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), dk); skidL.rotation.x = Math.PI / 2; skidL.position.set(-1, -1.4, 0);
          const skidR = skidL.clone(); skidR.position.x = 1;
          g.add(body, glass, tail, fin, rotor, skidL, skidR); g.traverse(o => { if (o.isMesh) o.castShadow = true; });
          hot(g, 0.85);
          add(g);
          h.move = (x, y, z, yaw) => { g.position.set(x, y, z); g.rotation.y = -yaw; };
          h.tick = dt => { rotor.rotation.y += dt * 30; };
          break;
        }
        case 'bird': {
          const g = new THREE.Group(); g.scale.setScalar(1.4);
          const br = new THREE.MeshLambertMaterial({ color: 0x5a3e24 });
          const body = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 8), br); body.rotation.x = -Math.PI / 2;
          const wl = new THREE.Group(), wr = new THREE.Group();
          const wing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.22), br); wing.position.x = -0.35; wl.add(wing);
          const wing2 = wing.clone(); wing2.position.x = 0.35; wr.add(wing2);
          g.add(body, wl, wr); hot(g, 0.75); add(g);
          let ph = 0;
          h.move = (x, y, z, yaw) => { g.position.set(x, y, z); g.rotation.y = -yaw; };
          h.tick = dt => { ph += dt * 9; const a = Math.sin(ph) * 0.6; wl.rotation.z = a; wr.rotation.z = -a; };
          break;
        }
        case 'people': {
          const g = new THREE.Group(), legs = [];
          [0xdc2626, 0x16a34a, 0xf59e0b].forEach((c, i) => { const p = DS.Vis.person(c); p.position.set((i - 1) * 1.1, 0, (i % 2) * 0.8); g.add(p); legs.push(p.userData); });
          hot(g, 1); add(g);
          let ph = 0;
          h.move = (x, y, z, yaw) => { g.position.set(x, 0, z); g.rotation.y = -yaw; };
          h.tick = dt => { ph += dt * 7; for (let i = 0; i < legs.length; i++) { const a = Math.sin(ph + i) * 0.4; legs[i].legL.rotation.x = a; legs[i].legR.rotation.x = -a; } };
          break;
        }
        case 'tower': {
          const tex = canvasTex(128, 256, (g2, w, hh) => { g2.fillStyle = '#9aa3ad'; g2.fillRect(0, 0, w, hh); g2.fillStyle = '#2b3a4a'; for (let yy = 8; yy < hh; yy += 24) for (let xx = 8; xx < w; xx += 30) g2.fillRect(xx, yy, 18, 14); }, [1, 1]);
          const tw = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), new THREE.MeshLambertMaterial({ map: tex }));
          tw.position.set(spec.x, spec.h / 2, spec.z); tw.castShadow = tw.receiveShadow = true;
          const light = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2222 })); light.position.set(spec.x, spec.h + 0.5, spec.z);
          hot(tw, 0.3); add(tw, light);
          break;
        }
        case 'pond': {
          const sand = new THREE.Mesh(new THREE.RingGeometry(spec.r, spec.r + 2.5, 64), new THREE.MeshLambertMaterial({ color: 0xd8c08f, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 })); sand.rotation.x = -Math.PI / 2; sand.position.set(spec.x, 0.05, spec.z);
          const water = new THREE.Mesh(new THREE.CircleGeometry(spec.r, 64), new THREE.MeshPhongMaterial({ color: 0x2b7bb9, shininess: 90, specular: 0x99ccff, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
          water.rotation.x = -Math.PI / 2; water.position.set(spec.x, 0.07, spec.z);
          hot(water, 0.08); hot(sand, 0.35);
          add(sand, water);
          break;
        }
        case 'rain': {
          // المطر نفسه يرسمه Render (بدون إنشاء أشياء كل فريم وحول الكاميرا الشغالة)
          R.setWeather('rain');
          h.onRemove = () => R.setWeather('clear');
          break;
        }
        case 'dust': {
          R.setWeather('dust');
          h.onRemove = () => R.setWeather('clear');
          break;
        }

        // ---------- أنواع v2 ----------
        case 'raceGate': {
          const GF = DS.gateFrame(spec), g = new THREE.Group(), M = new Merger(false), t = GF.t, half = GF.w / 2 + t / 2;
          const c1 = colorOf(spec.color || 0xff7a1a), c2 = 0x1f2937;
          // أعمدة + عارضة فوق (+ تحت لو معلقة) بخطوط ملونة
          const seg = (x0, y0, x1, y1) => {
            const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.38));
            for (let i = 0; i < n; i++) { const a = i / n, b = (i + 1) / n; M.beam(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, 0, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b, 0, t, i % 2 ? c2 : c1); }
          };
          seg(-half, 0, -half, GF.top + t); seg(half, 0, half, GF.top + t);
          seg(-half, GF.top + t / 2, half, GF.top + t / 2);
          if (GF.floating) seg(-half, GF.bottom - t / 2, half, GF.bottom - t / 2);
          M.box(0.5, 0.06, 0.7, -half, 0.03, 0, 0x374151); M.box(0.5, 0.06, 0.7, half, 0.03, 0, 0x374151);
          const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x000000 });
          const frame = new THREE.Mesh(M.build(), mat); frame.castShadow = true;
          const arr = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 10), basic(0xffffff, 0.6)); arr.rotation.x = -Math.PI / 2; arr.position.y = GF.cy; arr.visible = false;
          g.add(frame, arr); g.position.set(spec.x, 0, spec.z); g.rotation.y = -(spec.yaw || 0);
          hot(frame, 0.3); add(g);
          if (spec.label != null && spec.label !== '') { const lb = label(spec.label, '#ff7a1a', 0.9); lb.position.set(spec.x, GF.top + t + 0.7, spec.z); add(lb); }
          h.set = st => {
            if (st === 'next') { mat.emissive.setHex(0x6a2a00); arr.visible = true; }
            else if (st === 'done') { mat.emissive.setHex(0x0a4020); arr.visible = false; }
            else { mat.emissive.setHex(0); arr.visible = false; }
          };
          h.frame = GF;
          break;
        }
        case 'flag': {
          const M = new Merger(false), c = colorOf(spec.color || 0x22d3ee), hh = spec.h || 3.2;
          M.geo(new THREE.CylinderGeometry(0.025, 0.035, hh, 6), 0, hh / 2, 0, 0x2b2b2b);
          for (let i = 0; i < 6; i++) { const y = hh - 0.15 - i * 0.36, w = 0.55 - i * 0.03, bend = Math.sin(i * 0.5) * 0.06; M.box(w, 0.36, 0.015, 0.03 + w / 2, y - 0.18, bend, c); }
          const m = new THREE.Mesh(M.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
          m.position.set(spec.x, 0, spec.z); m.rotation.y = spec.yaw ? -spec.yaw : 0; m.castShadow = true;
          hot(m, 0.3); add(m);
          break;
        }
        case 'bucketStand': {
          // ستاند NIST: عمود + 5 سطول (فوق + A/B/C/D مايلة 45°)
          const BK = DS.BUCKET, st = { x: spec.x, z: spec.z, h: spec.h != null ? spec.h : 1, aYaw: spec.aYaw != null ? spec.aYaw : (spec.yaw != null ? spec.yaw : Math.PI) };
          const M = new Merger(false), rims = {}, pose = { x: 0, y: 0, z: 0, ax: 0, ay: 1, az: 0 }, orange = colorOf(spec.color || 0xf97316);
          M.box(0.12, st.h - 0.05, 0.12, st.x, (st.h - 0.05) / 2, st.z, 0x6b7280);
          M.box(0.5, 0.05, 0.5, st.x, 0.025, st.z, 0x4b5563);
          M.box(0.46, 0.05, 0.08, st.x, st.h - 0.1, st.z, 0x6b7280, st.aYaw); M.box(0.08, 0.05, 0.46, st.x, st.h - 0.1, st.z, 0x6b7280, st.aYaw);
          const list = spec.buckets || [{ dir: 'top' }, { dir: 'A' }, { dir: 'B' }, { dir: 'C' }, { dir: 'D' }];
          const mk = (b) => {
            DS.bucketPose(st, b.dir, pose);
            T.v.set(pose.ax, pose.ay, pose.az); const q = new THREE.Quaternion().setFromUnitVectors(T.Y, T.v), pos = new THREE.Vector3(pose.x, pose.y, pose.z);
            const put = (geo, col) => { T.m.compose(pos, q, T.s.set(1, 1, 1)); const r = M.add(geo, T.m, col); geo.dispose(); return r; };
            const outer = new THREE.CylinderGeometry(BK.rTop, BK.rBot, BK.depth, 18, 1, true); outer.translate(0, BK.depth / 2, 0);
            const inner = new THREE.CylinderGeometry(BK.rTop - 0.006, BK.rBot - 0.006, BK.depth - 0.004, 18, 1, true); inner.translate(0, BK.depth / 2 + 0.002, 0);
            put(outer, orange); put(inner, 0x1a1a1a);
            put(new THREE.CircleGeometry(BK.rBot - 0.004, 18).rotateX(-Math.PI / 2).translate(0, 0.004, 0), 0x111111);
            put(new THREE.RingGeometry(BK.rRing - 0.012, BK.rRing, 24).rotateX(-Math.PI / 2).translate(0, 0.007, 0), 0xffffff);
            const rim = put(new THREE.TorusGeometry(BK.rTop, 0.012, 6, 20).rotateX(Math.PI / 2).translate(0, BK.depth, 0), orange);
            rims[b.id != null ? b.id : b.dir] = rim;
          };
          list.forEach(mk);
          const geo = M.build(), colA = geo.attributes.color;
          const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: spec.lit ? 0x3a3a3a : 0x000000 });
          const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; hot(mesh, 0.3); add(mesh);
          if (spec.label != null && spec.label !== '') { const lb = label(spec.label, '#f97316', 0.6); lb.position.set(st.x, st.h + 0.75, st.z); add(lb); }
          const tint = new THREE.Color(), orangeC = new THREE.Color(orange);
          h.set = (state, id) => {
            const keys = id != null ? [id] : Object.keys(rims);
            tint.set(state === 'next' ? COL.next : state === 'done' ? COL.done : state === 'fail' ? COL.fail : orangeC);
            for (const k of keys) { const r = rims[k]; if (!r) continue; for (let i = r.start; i < r.start + r.count; i++) colA.setXYZ(i, tint.r, tint.g, tint.b); }
            colA.needsUpdate = true;
          };
          h.setLit = on => mat.emissive.setHex(on ? 0x3a3a3a : 0);
          h.stand = st; h.pose = (dir, out) => DS.bucketPose(st, dir, out);
          break;
        }
        case 'insulator': {
          const M = new Merger(false), n = 7, len = 1.5, k = 1.1;
          M.beam(0, -len / 2, 0, 0, len / 2, 0, 0.035, 0x555555);
          for (let i = 0; i < n; i++) {
            if (spec.defect && i === 3) { M.geo(new THREE.CylinderGeometry(0.13 * k, 0.1 * k, 0.03, 10, 1, false, 0, Math.PI * 1.2), 0.04, -len / 2 + 0.15 + i * 0.19, 0, 0x262626); continue; }
            const burnt = spec.defect && (i === 2 || i === 4);
            M.geo(new THREE.CylinderGeometry(0.13 * k, 0.13 * k, 0.05, 12), 0, -len / 2 + 0.15 + i * 0.19, 0, burnt ? 0x2a2622 : 0x6f8f86);
          }
          const m = new THREE.Mesh(M.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
          m.position.set(spec.x, spec.y, spec.z); hot(m, spec.defect ? 0.8 : 0.45);   // العيب يسخن (هذا اللي يبين بالحراري)
          const halo = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 6, 24), basic(COL.next, 0.85)); halo.position.copy(m.position); halo.visible = false;
          add(m, halo);
          h.set = st => { halo.visible = st === 'next' || st === 'done'; halo.material.color.setHex(COL[st] || COL.next); };
          break;
        }
        case 'vehicle': {
          const kind = spec.kind || 'car', parts = vehicleParts(kind, colorOf(spec.color || 0xe5e7eb));
          const g = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ vertexColors: true });
          const body = new THREE.Mesh(parts.body, mat); body.castShadow = true; g.add(body); hot(body, 0.5);
          if (parts.hot) { const hm = new THREE.Mesh(parts.hot, new THREE.MeshLambertMaterial({ vertexColors: true })); hm.castShadow = true; g.add(hm); hot(hm, 1); }
          const lights = DS.lightPoints(parts.lights); lights.visible = false; g.add(lights);
          g.userData.nightLights = lights;
          g.position.set(spec.x, spec.y || 0, spec.z); g.rotation.y = -(spec.yaw || 0);
          add(g);
          h.move = (x, y, z, yaw) => { g.position.set(x, y || 0, z); if (yaw != null) g.rotation.y = -yaw; };
          h.tick = (dt, Rr) => { lights.visible = !!(Rr && Rr.isDark) || !!spec.lights; };
          h.size = { len: parts.len, w: parts.w, bed: parts.bed };
          break;
        }
        case 'person': {
          const p = DS.Vis.person(colorOf(spec.color || spec.shirt || 0xdc2626));
          const g = new THREE.Group(); g.add(p);
          if (spec.pose === 'lie') { p.rotation.x = -Math.PI / 2; p.position.set(0, 0.14, 0.85); }
          g.position.set(spec.x, spec.y || 0, spec.z); g.rotation.y = -(spec.yaw || 0);
          hot(g, spec.hot === false ? 0.35 : 1); add(g);
          let ph = 0, lx = spec.x, lz = spec.z;
          h.move = (x, y, z, yaw) => {
            const dd = Math.hypot(x - lx, z - lz); lx = x; lz = z;
            g.position.set(x, y || 0, z); if (yaw != null) g.rotation.y = -yaw;
            if (spec.pose !== 'lie' && dd > 0.0005) { ph += dd * 4.5; const a = Math.sin(ph) * 0.45; p.userData.legL.rotation.x = a; p.userData.legR.rotation.x = -a; }
          };
          break;
        }
        case 'building': {
          const b = { x: spec.x, z: spec.z, w: spec.w, d: spec.d, h: spec.h, c: 0.5, housing: null };
          const MW = new Merger(true), MF = new Merger(false);
          buildingWalls(MW, b, spec.color != null ? colorOf(spec.color) : 0xe9e2d0); buildingRoof(MF, b, 0x8a8a86);
          const mat = new THREE.MeshLambertMaterial({ map: windowTex(spec.style || 'res', false), emissiveMap: windowTex(spec.style || 'res', true), emissive: 0xffffff, emissiveIntensity: R.isDark ? 1 : 0, vertexColors: true });
          mat.map.userData.shared = true; mat.emissiveMap.userData.shared = true;
          const walls = new THREE.Mesh(MW.build(), mat), roof = new THREE.Mesh(MF.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
          walls.castShadow = walls.receiveShadow = roof.castShadow = true;
          hot(walls, 0.28); hot(roof, 0.3); add(walls, roof);
          h.tick = (dt, Rr) => { mat.emissiveIntensity = Rr && Rr.winGlow != null ? Rr.winGlow : 0; };
          break;
        }
        case 'wall': {
          const t = spec.t || 0.3, m = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, t), new THREE.MeshLambertMaterial({ color: colorOf(spec.color || 0xc8bfae) }));
          m.position.set(spec.x, spec.h / 2, spec.z); m.rotation.y = -(spec.yaw || 0); m.castShadow = m.receiveShadow = true;
          hot(m, 0.3); add(m);
          break;
        }
        case 'platform': {
          const w = spec.w || 2.5, d = spec.d || 2.5, th = 0.12, g = new THREE.Group();
          const base = new THREE.Mesh(new THREE.BoxGeometry(w, th, d), new THREE.MeshLambertMaterial({ color: 0x374151 })); base.position.y = -th / 2;
          const top = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, d * 0.92), new THREE.MeshLambertMaterial({ map: padTex(spec.label || 'H', '#facc15') }));
          top.rotation.x = -Math.PI / 2; top.position.y = 0.004;
          g.add(base, top); g.position.set(spec.x, spec.y != null ? spec.y : th, spec.z); g.rotation.y = -(spec.yaw || 0);
          base.castShadow = true; base.receiveShadow = top.receiveShadow = true;
          hot(g, spec.hot ? 0.9 : 0.35); add(g);
          h.move = (x, y, z, yaw) => { g.position.set(x, y != null ? y : th, z); if (yaw != null) g.rotation.y = -yaw; };
          break;
        }
        case 'tag': {
          const sz = spec.size || 0.3, txt = String(spec.label != null ? spec.label : '?');
          const tex = canvasTex(256, 128, (g2, w, hh) => {
            g2.fillStyle = '#facc15'; g2.fillRect(0, 0, w, hh); g2.strokeStyle = '#111'; g2.lineWidth = 8; g2.strokeRect(6, 6, w - 12, hh - 12);
            g2.fillStyle = '#111'; g2.font = 'bold 64px Arial'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText(txt, w / 2, hh / 2 + 4);
          });
          // الإطار يطلع بس للوحة الجاية (رسمة وحدة زيادة)؛ اللي خلصت تتلون أخضر فاتح بدل الإطار — A5 فيه 24 لوحة (حد التلفزيون ≤100 رسمة)
          let plate, faceM, frm = null;
          const frameM = basic(COL.next, 0.95);
          if (spec.yaw != null) {
            plate = new THREE.Group();
            faceM = new THREE.MeshLambertMaterial({ map: tex });
            const face = new THREE.Mesh(new THREE.PlaneGeometry(sz * 2, sz), faceM);
            frm = new THREE.Mesh(new THREE.PlaneGeometry(sz * 2.3, sz * 1.3), frameM); frm.position.z = -0.005; frm.visible = false;
            plate.add(frm, face); plate.rotation.y = -spec.yaw + Math.PI;   // الوجه يطالع اتجاه yaw
          } else {
            faceM = new THREE.SpriteMaterial({ map: tex });
            plate = new THREE.Sprite(faceM); plate.scale.set(sz * 2, sz, 1);
          }
          plate.position.set(spec.x, spec.y, spec.z); hot(plate, 0.3); add(plate);
          h.set = st => {
            if (frm) frm.visible = st === 'next';
            faceM.color.setHex(st === 'done' ? 0x5fe08a : 0xffffff);   // خلصت = أخضر واضح
          };
          break;
        }
        case 'powerline': case 'cellTower': case 'reticle': {
          // ثابتة في العالم (أو في الـ HUD) — نرجع بيانات العالم بس
          h.world = spec.type === 'powerline' ? (DS.World.powerlines || [])[0] : spec.type === 'cellTower' ? (DS.World.towers || [])[0] : null;
          break;
        }
        default: break;
      }
      if (R.thermAdd) R.thermAdd(objs);
      if (h.tick) { if (R.addTick) R.addTick(h); else if (R.ticks && R.ticks.add) R.ticks.add(h); }
      return h;
    },

    // شخص: جسم مدمج + رجلين (للمشي)
    person(shirt) {
      THREE = window.THREE; initTemps();
      const p = new THREE.Group();
      const M = new Merger(false), skin = 0xc58c5c;
      M.box(0.46, 0.62, 0.26, 0, 1.17, 0, shirt);
      M.geo(new THREE.SphereGeometry(0.13, 10, 8), 0, 1.62, 0, skin);
      M.box(0.11, 0.55, 0.12, -0.3, 1.15, -0.02, shirt); M.box(0.11, 0.55, 0.12, 0.3, 1.15, -0.02, shirt);
      const body = new THREE.Mesh(M.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
      const legG = new THREE.BoxGeometry(0.16, 0.85, 0.18); legG.translate(0, -0.425, 0);
      const pants = new THREE.MeshLambertMaterial({ color: 0x3a3f47 });
      const legL = new THREE.Mesh(legG, pants), legR = new THREE.Mesh(legG.clone(), pants);
      legL.position.set(-0.11, 0.86, 0); legR.position.set(0.11, 0.86, 0);
      p.add(body, legL, legR);
      p.traverse(o => { if (o.isMesh) o.castShadow = true; });
      p.userData = { legL, legR };
      return p;
    }
  };
})();
