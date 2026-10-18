// بيانات العالم (منطق فقط — بدون رسم): الساحة، الطيار، البيت، المناطق، الشجر، المباني، الطرق، الكهرباء، الأبراج
// المحاور: x = شرق، y = فوق، z = جنوب (الشمال = -z). كل شي ثابت ومحسوب بنفس البذرة (deterministic).
// لازم يشتغل بدون three.js وبدون document (الاختبار الذاتي).
(function () {
  const DS = window.DS, U = DS.U;

  // ---------------- الساحة والطيار والبيت ----------------
  DS.FIELD = { x0: -60, x1: 60, z0: -115, z1: 25 };   // حدود ساحة التدريب
  DS.inField = (x, z) => x >= DS.FIELD.x0 && x <= DS.FIELD.x1 && z >= DS.FIELD.z0 && z <= DS.FIELD.z1;
  DS.PILOT = { x: 0, z: 6 };   // مكان الطيار (session.start يغيره حسب المهمة)
  DS.HOME = { x: 0, z: 0 };    // نقطة البيت / منصة الإقلاع

  // مقاسات سطل NIST (قطر 20 سم تحت، حلقة مرسومة جوّا)
  DS.BUCKET = { rTop: 0.13, rBot: 0.10, rRing: 0.08, depth: 0.23 };

  // ---------------- أدوات هندسية صغيرة ----------------
  function segD2(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
    let t = l > 0 ? ((px - ax) * dx + (pz - az) * dz) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - px, ez = az + dz * t - pz;
    return ex * ex + ez * ez;
  }
  function polyDist(road, x, z) {
    const p = road.pts, n = p.length, last = road.closed ? n : n - 1;
    let best = Infinity;
    for (let i = 0; i < last; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const d = segD2(x, z, a.x, a.z, b.x, b.z);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  const inRect = (r, x, z, m) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;

  // طريق مستطيل بزوايا مدورة (يمشي عكس عقارب الساعة لما تشوفه من فوق والشمال لفوق)
  function roundedRect(x0, z0, x1, z1, r, n) {
    const pts = [];
    const C = [[x1 - r, z1 - r, Math.PI / 2, 0], [x1 - r, z0 + r, 0, -Math.PI / 2],
      [x0 + r, z0 + r, -Math.PI / 2, -Math.PI], [x0 + r, z1 - r, Math.PI, Math.PI / 2]];
    for (const [cx, cz, a0, a1] of C) {
      for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; pts.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) }); }
    }
    return pts;
  }
  function finishRoad(road) {
    const p = road.pts, n = p.length, cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
    road.len = cum[n - 1] + (road.closed ? Math.hypot(p[0].x - p[n - 1].x, p[0].z - p[n - 1].z) : 0);
    road.cum = cum;
    return road;
  }

  // نقطة على الطريق بعد مسافة s متر من البداية → out = {x, z, yaw}
  DS.roadPoint = function (road, s, out) {
    out = out || { x: 0, z: 0, yaw: 0 };
    const p = road.pts, n = p.length, cum = road.cum, L = road.len;
    if (road.closed) { s %= L; if (s < 0) s += L; } else s = U.clamp(s, 0, L);
    let i = 0;
    // بحث ثنائي على المسافات التراكمية
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid - 1; }
    i = lo;
    const a = p[i], b = p[(i + 1) % n];
    const segL = (i + 1 < n ? cum[i + 1] : L) - cum[i];
    const t = segL > 1e-6 ? (s - cum[i]) / segL : 0;
    out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t;
    out.yaw = Math.atan2(b.x - a.x, -(b.z - a.z));
    return out;
  };

  // ---------------- بناء العالم ----------------
  function build() {
    const rnd = U.rng(20261018);
    const F = DS.FIELD;
    const trees = [], buildings = [], colliders = [], props = [], lamps = [], masts = [], dunes = [], rocks = [];

    // ---- المناطق (spawn = المنصة + مكان الطيار المقترح)
    const zones = {
      field: { id: 'field', name: 'ساحة التدريب', x0: F.x0, x1: F.x1, z0: F.z0, z1: F.z1, cx: 0, cz: -45,
        spawn: { x: 0, z: 0, yaw: 0, pilot: { x: 0, z: 6 } } },
      nist: { id: 'nist', name: 'مسار NIST', x0: -8, x1: 8, z0: -20, z1: 2, cx: 0, cz: -9,
        spawn: { x: 0, z: 0, yaw: 0, pilot: { x: 0, z: 6 } } },
      race: { id: 'race', name: 'حديقة السباق', cx: 190, cz: -60, x0: 80, x1: 300, z0: -170, z1: 50,
        spawn: { x: 120, z: 30, yaw: 0, pilot: { x: 120, z: 36 } } },
      city: { id: 'city', name: 'المدينة', cx: -200, cz: -60, x0: -317.5, x1: -95, z0: -160, z1: 40,
        spawn: { x: -140, z: 6, yaw: 0, pilot: { x: -140, z: 12 } } },
      desert: { id: 'desert', name: 'الصحراء', cx: 0, cz: -420, x0: -200, x1: 200, z0: -620, z1: -220,
        spawn: { x: 0, z: -232, yaw: 0, pilot: { x: 0, z: -226 } } }
    };
    const zoneList = [zones.nist, zones.field, zones.race, zones.city, zones.desert];

    // مسار NIST: المنصة البيت (0,0) والستاندات شمالها كل 3 م (السطل A يطالع المنصة = جنوب)
    const lanes = { nist: { id: 'nist', pad: { x: 0, z: 0 }, S: 3, aYaw: Math.PI, stands: [] } };
    for (let k = 1; k <= 4; k++) lanes.nist.stands.push({ id: k, x: 0, z: -3 * k, h: 1.0 });

    // ---- الطرق
    const roads = [
      finishRoad({ id: 'loop', name: 'الطريق الدائري', closed: true, w: 8, pts: roundedRect(-90, -160, 90, 40, 20, 6) }),
      finishRoad({ id: 'north', name: 'طريق الصحراء', closed: false, w: 7, pts: [{ x: 0, z: -164 }, { x: 0, z: -222 }] }),
      finishRoad({ id: 'south', name: 'طريق الحي', closed: false, w: 7, pts: [{ x: 0, z: 44 }, { x: 0, z: 190 }] })
    ];

    // ---- خط الكهرباء: أبراج كل 125 م على z = -170 من x = -300 إلى 200
    const PL = { id: 'main', name: 'خط الكهرباء', z: -170, x0: -300, x1: 200, pylons: [], insulators: [],
      // dz = إزاحة السلك عن خط البرج، y = ارتفاع التعليق، sag = ارتخاء نص المسافة
      wires: [{ dz: -6, y: 21, sag: 3, kind: 'phase' }, { dz: 6, y: 21, sag: 3, kind: 'phase' }, { dz: 0, y: 25.5, sag: 2, kind: 'earth' }],
      armY: 22.5, armHalf: 7.2, h: 26.2 };
    for (let x = PL.x0; x <= PL.x1 + 0.1; x += 125) PL.pylons.push({ x, z: PL.z, h: PL.h });
    const powerlines = [PL];

    // ---- برج الاتصالات (شبكي مثلث، أوجه 3 م، 60 م)
    const towers = [{ id: 'telecom', name: 'برج الاتصالات', kind: 'lattice', x: -150, z: -20, h: 60, face: 3, steel: true,
      panels: { y0: 42, y1: 54, n: 12 }, dishes: [{ y: 36, yaw: 0.6 }, { y: 32, yaw: 2.6 }, { y: 30, yaw: 4.4 }],
      shelter: { x: -143, z: -16, w: 3, d: 4, h: 3 }, fence: { r: 9, n: 24, h: 2 } }];

    // ---------------- المدينة ----------------
    // شوارع عرضها 25 م: شرق-غرب عند z = -112.5 و -42.5 و 27.5 ، شمال-جنوب عند x = -305 و -235 و -165 (والدائري عند -90)
    const CITY_COLS = [-270, -200, -130];
    const CITY_ROWS = [{ c: -137.5, d: 25 }, { c: -77.5, d: 45 }, { c: -7.5, d: 45 }];
    const cityB = [];
    const addB = (x, z, w, d, h, style, extra) => {
      const b = Object.assign({ x, z, w, d, h, style, c: rnd(), blocksSignal: true, zone: 'city', housing: null }, extra || {});
      if (h > 24 && w > 12 && d > 12) b.housing = { w: 6, d: 5, h: 3.2 };
      cityB.push(b);
    };
    CITY_COLS.forEach((cx, ci) => {
      CITY_ROWS.forEach((row, ri) => {
        const bw = 45, bd = row.d, x0 = cx - bw / 2 + 2, x1 = cx + bw / 2 - 2, z0 = row.c - bd / 2 + 2, z1 = row.c + bd / 2 - 2;
        if (ci === 2 && ri === 2) {   // بلوك البرج: مبنى واطي بس في الشرق
          addB(-118, -12, 16, 22, 15 + rnd() * 4, 'res');
          return;
        }
        const canyon = ri === 1 && (ci === 0 || ci === 1);   // شارع ضيق بين عمارات 60 م (x = -235)
        const style = rnd() < 0.55 ? 'office' : 'res';
        if (bd < 30) {   // الصف الشمالي: قطعتين
          const mid = (x0 + x1) / 2;
          for (const [a, b] of [[x0, mid - 1.5], [mid + 1.5, x1]]) {
            const w = (b - a) - rnd() * 3, d = (z1 - z0) - rnd() * 3;
            addB((a + b) / 2, (z0 + z1) / 2, w, d, 15 + rnd() * 20, rnd() < 0.5 ? 'office' : 'res');
          }
          return;
        }
        if (!canyon && rnd() < 0.3) {   // عمارة وحدة كبيرة
          addB(cx, row.c, x1 - x0 - 2, z1 - z0 - 2, 22 + rnd() * 22, style);
          return;
        }
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        for (const [a, b] of [[x0, mx - 1.5], [mx + 1.5, x1]]) {
          for (const [c, e] of [[z0, mz - 1.5], [mz + 1.5, z1]]) {
            const lx = (a + b) / 2, lz = (c + e) / 2;
            let h = 15 + rnd() * 30;
            const onCanyon = canyon && ((ci === 0 && lx > cx) || (ci === 1 && lx < cx));
            if (onCanyon) h = 50 + rnd() * 10;
            if (ci === 1 && ri === 1 && lx > cx && lz < row.c) h = 60;   // أطول عمارة: علامة مميزة
            const w = (b - a) - rnd() * 3, d = (e - c) - rnd() * 3;
            addB(lx, lz, w, d, h, onCanyon ? 'office' : (rnd() < 0.5 ? 'office' : 'res'));
          }
        }
      });
    });
    cityB.forEach(b => buildings.push(b));

    // ---------------- الحي الجنوبي (فلل + مسجد + خزان موية) ----------------
    const villas = [[-24, 110], [24, 110], [-24, 140], [24, 140], [-24, 170], [24, 170], [-56, 122], [56, 122]];
    villas.forEach(([x, z]) => buildings.push({ x, z, w: 13 + rnd() * 2, d: 13 + rnd() * 2, h: 7.5, style: 'villa', c: rnd(), blocksSignal: true, zone: 'south', yard: 21 }));
    const mosque = { id: 'mosque', kind: 'mosque', x: -62, z: 166, w: 24, d: 24, h: 8, dome: 7, minaret: { x: -46, z: 150, r: 1.7, h: 34 } };
    const waterTower = { id: 'water', kind: 'watertower', x: 96, z: 150, r: 2.2, bowlR: 9, y0: 24, y1: 33 };
    props.push(mosque, waterTower);

    // ---------------- حديقة السباق ----------------
    const tents = [[112, 22], [124, 22], [136, 22]].map(([x, z]) => ({ kind: 'tent', x, z, w: 5, d: 5, h: 3 }));
    tents.forEach(t => props.push(t));
    const banners = [];   // أعلام على طرف حديقة السباق
    for (let k = 0; k < 6; k++) banners.push({ kind: 'banner', x: 150 + k * 22, z: 42, h: 3.4, color: [0xff7a1a, 0x22d3ee, 0xfacc15][k % 3] });
    banners.forEach(b => props.push(b));
    // أعمدة كشافات: الساحة + حديقة السباق
    [[-67, 31], [67, 31], [-67, -121], [67, -121]].forEach(([x, z]) => masts.push({ x, z, h: 16, zone: 'field', aim: { x: 0, z: -45 } }));
    [[100, 45], [285, 45], [100, -158], [285, -158]].forEach(([x, z]) => masts.push({ x, z, h: 18, zone: 'race', aim: { x: 190, z: -60 } }));

    // ---------------- أعمدة الإنارة ----------------
    {
      const loop = roads[0], tmp = { x: 0, z: 0, yaw: 0 };
      for (let s = 10; s < loop.len; s += 45) {
        DS.roadPoint(loop, s, tmp);
        const rx = Math.cos(tmp.yaw), rz = Math.sin(tmp.yaw);   // يمين اتجاه السير = برا الدائري
        lamps.push({ x: tmp.x + rx * 6.5, z: tmp.z + rz * 6.5, h: 8, yaw: tmp.yaw - Math.PI / 2 });
      }
      // شوارع المدينة (على الرصيف)
      const clearOfTower = (x, z) => towers.every(t => Math.hypot(x - t.x, z - t.z) > 16);
      for (const zc of [-112.5, -42.5, 27.5]) for (let x = -300; x <= -100; x += 40) if (clearOfTower(x, zc + 11)) lamps.push({ x, z: zc + 11, h: 8, yaw: 0 });
      for (const xc of [-305, -235, -165]) for (let z = -150; z <= 30; z += 40) if (clearOfTower(xc + 11, z)) lamps.push({ x: xc + 11, z, h: 8, yaw: -Math.PI / 2 });
    }

    // ---------------- الصحراء: كثبان (قبب كروية) وصخور ----------------
    // القبة: نصف قطر القاعدة a وارتفاعها h = 0.2a → كرة نصف قطرها 2.6a ومركزها تحت الأرض بـ 2.4a (التصادم = نفس الشكل بالضبط)
    {
      const D = zones.desert;
      let tries = 0;
      while (dunes.length < 22 && tries < 800) {
        tries++;
        const ang = rnd() * Math.PI * 2, r = 120 + rnd() * 160;
        const x = D.cx + Math.sin(ang) * r, z = D.cz - Math.cos(ang) * r, a = 14 + rnd() * 22;
        if (z - a < -760 || z + a > D.z1 - 10) continue;
        if (dunes.some(o => Math.hypot(o.x - x, o.z - z) < o.a + a + 6)) continue;
        dunes.push({ x, z, a, h: 0.2 * a });
      }
      tries = 0;
      while (rocks.length < 36 && tries < 800) {
        tries++;
        const x = D.x0 + 10 + rnd() * (D.x1 - D.x0 - 20), z = D.z0 + 10 + rnd() * (D.z1 - D.z0 - 20);
        if (Math.hypot(x - D.cx, z - D.cz) < 40) continue;   // وسط منطقة البحث فاضي
        if (dunes.some(o => Math.hypot(o.x - x, o.z - z) < o.a + 3)) continue;
        rocks.push({ x, z, s: 0.4 + Math.pow(rnd(), 1.6) * 1.6, rot: rnd() * 6.28, hue: rnd() });
      }
    }

    // ---------------- الشجر (برا المناطق والطرق والمباني) ----------------
    const blockedForTree = (x, z) => {
      if (inRect(F, x, z, 14)) return true;
      if (inRect(zones.race, x, z, 5) || inRect(zones.city, x, z, 6) || inRect(zones.desert, x, z, 2)) return true;
      if (Math.abs(z - PL.z) < 22 && x > PL.x0 - 25 && x < PL.x1 + 25) return true;
      for (const r of roads) if (polyDist(r, x, z) < r.w / 2 + 7) return true;
      for (const b of buildings) if (Math.abs(x - b.x) < (b.yard || b.w) / 2 + 5 && Math.abs(z - b.z) < (b.yard || b.d) / 2 + 5) return true;
      if (Math.hypot(x - mosque.x, z - mosque.z) < 22 || Math.hypot(x - mosque.minaret.x, z - mosque.minaret.z) < 6) return true;
      if (Math.hypot(x - waterTower.x, z - waterTower.z) < 14) return true;
      for (const m of masts) if (Math.hypot(x - m.x, z - m.z) < 6) return true;
      for (const l of lamps) if (Math.hypot(x - l.x, z - l.z) < 4) return true;
      for (const d of dunes) if (Math.hypot(x - d.x, z - d.z) < d.a + 4) return true;
      return false;
    };
    {
      let tries = 0;
      while (trees.length < 340 && tries < 30000) {
        tries++;
        const a = rnd() * Math.PI * 2, r = 85 + Math.pow(rnd(), 0.75) * 500;
        const x = Math.sin(a) * r, z = -60 - Math.cos(a) * r;
        if (blockedForTree(x, z)) continue;
        if (trees.some(t => Math.abs(t.x - x) < 3.2 && Math.abs(t.z - z) < 3.2)) continue;
        // نخل قرب الصحراء والحي، وشجر عادي باقي المكان
        const nearDesert = z < -185, nearSouth = z > 80 && Math.abs(x) < 120;
        const pr = rnd();
        const kind = (nearDesert || nearSouth) ? (pr < 0.7 ? 'palm' : pr < 0.9 ? 'round' : 'pine') : (pr < 0.55 ? 'round' : pr < 0.82 ? 'pine' : 'palm');
        const h = kind === 'palm' ? 7 + rnd() * 6 : kind === 'pine' ? 7 + rnd() * 9 : 5 + rnd() * 7;
        const cr = kind === 'palm' ? 2.8 + rnd() * 0.8 : kind === 'pine' ? 1.6 + rnd() * 1.4 : 1.8 + rnd() * 2;
        trees.push({ x, z, h, cr, kind, pine: kind === 'pine', palm: kind === 'palm', hue: rnd() });
      }
    }

    // ---------------- التصادم (كل شي مرسوم داخل 600 م له جسم) ----------------
    const C = (o) => { colliders.push(o); return o; };
    for (const t of trees) {
      if (t.kind === 'pine') {   // مخروط تقريبي = اسطوانتين فوق بعض
        const yb = 0.15 * t.h, hc = 0.85 * t.h;
        C({ type: 'cyl', x: t.x, z: t.z, r: t.cr * 0.8, y0: 0, h: yb + hc * 0.45, name: 'شجرة' });
        C({ type: 'cyl', x: t.x, z: t.z, r: t.cr * 0.34, y0: yb + hc * 0.45, h: t.h, name: 'شجرة' });
      } else if (t.kind === 'palm') {
        C({ type: 'cyl', x: t.x, z: t.z, r: 0.35, y0: 0, h: t.h - 1, name: 'نخلة' });
        C({ type: 'cyl', x: t.x, z: t.z, r: t.cr * 0.85, y0: t.h - 2.2, h: t.h + 0.5, name: 'نخلة' });
      } else {
        C({ type: 'cyl', x: t.x, z: t.z, r: t.cr * 0.85, y0: 0, h: t.h, name: 'شجرة' });
      }
    }
    for (const b of buildings) {
      if (b.style === 'villa') {
        C({ type: 'box', x: b.x, z: b.z, w: b.w, d: b.d, h: b.h + 0.6, name: 'بيت', blocksSignal: true });
        C({ type: 'box', x: b.x, z: b.z, w: b.yard, d: b.yard, h: 2.6, name: 'سور', blocksSignal: false });
      } else {
        C({ type: 'box', x: b.x, z: b.z, w: b.w, d: b.d, h: b.h + 0.9, name: 'مبنى', blocksSignal: true });
        if (b.housing) C({ type: 'box', x: b.x, z: b.z, w: b.housing.w, d: b.housing.d, h: b.h + b.housing.h, name: 'مبنى', blocksSignal: true });
      }
    }
    // المسجد والمنارة وخزان الموية
    C({ type: 'box', x: mosque.x, z: mosque.z, w: mosque.w, d: mosque.d, h: mosque.h + 0.8, name: 'المسجد', blocksSignal: true });
    C({ type: 'sphere', x: mosque.x, y: mosque.h, z: mosque.z, r: mosque.dome, name: 'قبة المسجد' });
    C({ type: 'cyl', x: mosque.minaret.x, z: mosque.minaret.z, r: mosque.minaret.r + 0.4, y0: 0, h: mosque.minaret.h + 2.5, name: 'المنارة' });
    C({ type: 'cyl', x: waterTower.x, z: waterTower.z, r: waterTower.r + 0.2, y0: 0, h: waterTower.y0 + 0.5, name: 'خزان الموية' });
    C({ type: 'cyl', x: waterTower.x, z: waterTower.z, r: waterTower.bowlR + 0.3, y0: waterTower.y0, h: waterTower.y1 + 1.2, name: 'خزان الموية' });
    for (const t of tents) C({ type: 'box', x: t.x, z: t.z, w: t.w, d: t.d, h: t.h + 0.3, name: 'خيمة' });
    for (const b of banners) C({ type: 'cyl', x: b.x + 0.3, z: b.z, r: 0.45, y0: 0, h: b.h, name: 'علم', thin: true });
    for (const m of masts) C({ type: 'cyl', x: m.x, z: m.z, r: 0.4, y0: 0, h: m.h + 1.2, name: 'عمود الكشاف' });
    for (const l of lamps) C({ type: 'cyl', x: l.x, z: l.z, r: 0.2, y0: 0, h: l.h + 0.3, name: 'عمود إنارة' });
    // برج الاتصالات (فولاذ — يأثر على البوصلة)
    for (const tw of towers) {
      C({ type: 'cyl', x: tw.x, z: tw.z, r: 2.0, y0: 0, h: tw.h, name: tw.name, steel: true });
      C({ type: 'cyl', x: tw.x, z: tw.z, r: 2.5, y0: tw.panels.y0 - 1, h: tw.panels.y1 + 1.2, name: tw.name, steel: true });
      C({ type: 'cyl', x: tw.x, z: tw.z, r: 0.35, y0: tw.h, h: tw.h + 4, name: tw.name, steel: true });
      const sh = tw.shelter; C({ type: 'box', x: sh.x, z: sh.z, w: sh.w, d: sh.d, h: sh.h, name: 'غرفة المعدات' });
      const fc = tw.fence;
      for (let k = 0; k < fc.n; k++) { const a = k / fc.n * Math.PI * 2; C({ type: 'cyl', x: tw.x + Math.sin(a) * fc.r, z: tw.z - Math.cos(a) * fc.r, r: 0.08, y0: 0, h: fc.h, name: 'سياج', thin: true }); }
    }
    // أبراج وأسلاك الكهرباء (السلك = كبسولة رفيعة thin:true — حساسات الدرون ما تشوفه)
    for (const p of PL.pylons) {
      C({ type: 'box', x: p.x, z: p.z, w: 6.4, d: 6.4, h: 8, name: 'برج الكهرباء', steel: true });
      C({ type: 'box', x: p.x, z: p.z, w: 3.4, d: 3.4, h: p.h, name: 'برج الكهرباء', steel: true });
      C({ type: 'wire', x1: p.x, z1: p.z - PL.armHalf, x2: p.x, z2: p.z + PL.armHalf, y: PL.armY, y1: PL.armY, y2: PL.armY, r: 0.6, name: 'ذراع برج الكهرباء', steel: true });
      for (let j = 0; j < 2; j++) {   // عوازل الأسلاك (المهام تحط عليها علامات/عيوب)
        const w = PL.wires[j];
        PL.insulators.push({ id: PL.insulators.length, pylon: PL.pylons.indexOf(p), wire: j, x: p.x, y: (w.y + PL.armY) / 2, z: p.z + w.dz, top: PL.armY, bottom: w.y });
      }
    }
    const SUB = 8;
    for (let k = 0; k + 1 < PL.pylons.length; k++) {
      const xa = PL.pylons[k].x, xb = PL.pylons[k + 1].x;
      for (const w of PL.wires) {
        for (let i = 0; i < SUB; i++) {
          const ta = i / SUB, tb = (i + 1) / SUB;
          const ya = w.y - 4 * w.sag * ta * (1 - ta), yb = w.y - 4 * w.sag * tb * (1 - tb);
          C({ type: 'wire', x1: xa + (xb - xa) * ta, z1: PL.z + w.dz, x2: xa + (xb - xa) * tb, z2: PL.z + w.dz, y: (ya + yb) / 2, y1: ya, y2: yb, r: 0.05, thin: true, name: 'سلك الكهرباء' });
        }
      }
    }
    // الصحراء
    // الكثبان أرض (terrain): الفيزياء تهبط عليها مثل الأرض بدل ما تعتبرها عائق (DS.World.terrainAt)
    for (const d of dunes) C({ type: 'sphere', x: d.x, y: -2.4 * d.a, z: d.z, r: 2.6 * d.a, name: 'كثيب رمل', terrain: true });
    for (const r of rocks) if (r.s >= 0.7) C({ type: 'cyl', x: r.x, z: r.z, r: r.s * 0.75, y0: 0, h: r.s * 0.7, name: 'صخرة' });
    // سياج الساحة (منخفض ورفيع) + عمود مؤشر الريح
    for (const [x, z, w, d] of [[(F.x0 + F.x1) / 2, F.z0, F.x1 - F.x0, 0.12], [(F.x0 + F.x1) / 2, F.z1, F.x1 - F.x0, 0.12],
      [F.x0, (F.z0 + F.z1) / 2, 0.12, F.z1 - F.z0], [F.x1, (F.z0 + F.z1) / 2, 0.12, F.z1 - F.z0]]) {
      C({ type: 'box', x, z, w, d, h: 1.1, name: 'السياج', thin: true });
    }
    const windsock = { x: -8, z: 3, h: 5 };
    C({ type: 'cyl', x: windsock.x, z: windsock.z, r: 0.1, y0: 0, h: windsock.h + 0.3, name: 'عمود مؤشر الريح', thin: true });

    return { version: 2, trees, buildings, colliders, zones, zoneList, roads, powerlines, towers, lanes, props, lamps, masts, dunes, rocks, windsock };
  }

  const W = DS.World = build();
  DS.buildWorldData = build;

  // ---------------- شبكة سريعة للتصادم (خلية 20 م) ----------------
  // DS.World.near(x, z) → مصفوفة الأجسام اللي ممكن تلمس نقطة داخل نفس الخلية (هامش 2 م). بدون إنشاء مصفوفات جديدة.
  {
    const CELL = 20, GX0 = -900, GZ0 = -1000, NX = 90, NZ = 90, M = 2;
    const cells = new Array(NX * NZ).fill(null), EMPTY = [];
    const reg = (c, x0, z0, x1, z1) => {
      const i0 = Math.max(0, Math.floor((x0 - M - GX0) / CELL)), i1 = Math.min(NX - 1, Math.floor((x1 + M - GX0) / CELL));
      const j0 = Math.max(0, Math.floor((z0 - M - GZ0) / CELL)), j1 = Math.min(NZ - 1, Math.floor((z1 + M - GZ0) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * NX + i; (cells[k] || (cells[k] = [])).push(c); }
    };
    W.indexCollider = c => {
      switch (c.type) {
        case 'cyl': reg(c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r); break;
        case 'box': reg(c, c.x - c.w / 2, c.z - c.d / 2, c.x + c.w / 2, c.z + c.d / 2); break;
        case 'sphere': { const rb = Math.abs(c.y || 0) < c.r ? Math.sqrt(c.r * c.r - (c.y || 0) * (c.y || 0)) : c.r; reg(c, c.x - rb, c.z - rb, c.x + rb, c.z + rb); break; }
        case 'wire': { const r = c.r || 0.05; reg(c, Math.min(c.x1, c.x2) - r, Math.min(c.z1, c.z2) - r, Math.max(c.x1, c.x2) + r, Math.max(c.z1, c.z2) + r); break; }
        case 'ring': reg(c, c.x - c.R - c.r, c.z - c.R - c.r, c.x + c.R + c.r, c.z + c.R + c.r); break;
        default: reg(c, -1e4, -1e4, 1e4, 1e4);
      }
    };
    W.colliders.forEach(W.indexCollider);
    W.near = (x, z) => {
      const i = Math.floor((x - GX0) / CELL), j = Math.floor((z - GZ0) / CELL);
      if (i < 0 || j < 0 || i >= NX || j >= NZ) return EMPTY;
      return cells[j * NX + i] || EMPTY;
    };
  }

  // ---------------- ارتفاع الأرض (الكثبان) ----------------
  // DS.World.terrainAt(x, z) → ارتفاع سطح الرمل (0 = أرض مستوية). نفس شكل القبة بالضبط (كرة 2.6a مركزها تحت بـ 2.4a)
  {
    const D = W.dunes, n = D.length;
    let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
    for (let i = 0; i < n; i++) { const d = D[i]; bx0 = Math.min(bx0, d.x - d.a); bx1 = Math.max(bx1, d.x + d.a); bz0 = Math.min(bz0, d.z - d.a); bz1 = Math.max(bz1, d.z + d.a); }
    W.terrainAt = (x, z) => {
      if (x < bx0 || x > bx1 || z < bz0 || z > bz1) return 0;
      let top = 0;
      for (let i = 0; i < n; i++) {
        const d = D[i], dx = x - d.x, dz = z - d.z, r2 = dx * dx + dz * dz;
        if (r2 >= d.a * d.a) continue;
        const R = 2.6 * d.a, h = Math.sqrt(R * R - r2) - 2.4 * d.a;
        if (h > top) top = h;
      }
      return top;
    };
  }

  // ---------------- أسئلة سريعة عن العالم ----------------
  // وين هالنقطة؟ → id المنطقة أو null
  DS.zoneAt = (x, z) => { for (const zn of W.zoneList) if (inRect(zn, x, z, 0)) return zn.id; return null; };

  // ارتفاع السلك j من خط الكهرباء عند x (null إذا برا الخط)
  DS.wireY = function (line, j, x) {
    const P = line.pylons, w = line.wires[j];
    if (x < P[0].x || x > P[P.length - 1].x) return null;
    for (let k = 0; k + 1 < P.length; k++) {
      if (x <= P[k + 1].x) { const t = (x - P[k].x) / (P[k + 1].x - P[k].x); return w.y - 4 * w.sag * t * (1 - t); }
    }
    return w.y;
  };
  // أقرب مسافة لأي سلك كهرباء (للمسافة الآمنة 4 م ولتشويش البوصلة)
  DS.World.distToWire = function (x, y, z) {
    let best = Infinity;
    for (const L of W.powerlines) {
      const P = L.pylons, xa = P[0].x, xb = P[P.length - 1].x;
      const cx = x < xa ? xa : x > xb ? xb : x, dx = x - cx;
      for (let j = 0; j < L.wires.length; j++) {
        const wy = DS.wireY(L, j, cx), dz = z - (L.z + L.wires[j].dz), dy = y - wy;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < best) best = d;
      }
    }
    return best;
  };
  // أقرب مسافة لحديد (برج الاتصالات + أبراج الكهرباء) — للبوصلة
  DS.World.distToSteel = function (x, y, z) {
    let best = Infinity;
    const vert = (px, pz, h, r) => {
      const dy = y > h ? y - h : y < 0 ? -y : 0, d = Math.sqrt(Math.max(0, Math.hypot(x - px, z - pz) - r) ** 2 + dy * dy);
      if (d < best) best = d;
    };
    for (const t of W.towers) vert(t.x, t.z, t.h, 1.8);
    for (const L of W.powerlines) for (const p of L.pylons) vert(p.x, p.z, p.h, 1.6);
    return best;
  };

  // ---------------- ستاند NIST: وين قاع السطل واتجاه فتحته ----------------
  // stand = {x, z, h, aYaw?}  (aYaw = اتجاه السطل A، الافتراضي π = يطالع الجنوب/المنصة)
  // dir = 'top' | 'A' | 'B' | 'C' | 'D' — مع عقارب الساعة من فوق: A يطالع المنصة، B يسار، C ورا، D يمين
  // out = {x, y, z, ax, ay, az} = قاع السطل (المركز) + محور الفتحة (وحدة)
  const DIRK = { A: 0, B: 1, C: 2, D: 3 };
  DS.bucketPose = function (stand, dir, out) {
    out = out || { x: 0, y: 0, z: 0, ax: 0, ay: 1, az: 0 };
    const h = stand.h != null ? stand.h : 1;
    if (dir === 'top' || DIRK[dir] == null) { out.x = stand.x; out.y = h; out.z = stand.z; out.ax = 0; out.ay = 1; out.az = 0; return out; }
    const yaw = (stand.aYaw != null ? stand.aYaw : Math.PI) + DIRK[dir] * Math.PI / 2;
    const sx = Math.sin(yaw), sz = -Math.cos(yaw), c45 = Math.SQRT1_2;
    out.x = stand.x + sx * 0.17; out.y = h - 0.12; out.z = stand.z + sz * 0.17;
    out.ax = sx * c45; out.ay = c45; out.az = sz * c45;
    return out;
  };

  // ---------------- بوابة السباق: الأبعاد + أجسام التصادم ----------------
  // spec = {x, y?, z, yaw, w, h}: y = مركز الفتحة (لو مو محدد: البوابة واقفة على الأرض)
  DS.gateFrame = function (spec) {
    const w = spec.w || 1.52, h = spec.h || 1.52, t = spec.t || 0.16;
    const bottom = spec.y != null ? spec.y - h / 2 : 0.18;   // أسفل الفتحة
    return { w, h, t, bottom, top: bottom + h, cy: bottom + h / 2, floating: bottom > 0.5 };
  };
  DS.gateColliders = function (spec, name) {
    const G = DS.gateFrame(spec), yaw = spec.yaw || 0, rx = Math.cos(yaw), rz = Math.sin(yaw);   // يمين البوابة
    const half = G.w / 2 + G.t / 2, r = G.t / 2 + 0.02, nm = name || 'بوابة';
    const lx = spec.x - rx * half, lz = spec.z - rz * half, qx = spec.x + rx * half, qz = spec.z + rz * half;
    const out = [
      { type: 'cyl', x: lx, z: lz, r, y0: 0, h: G.top + G.t, name: nm },
      { type: 'cyl', x: qx, z: qz, r, y0: 0, h: G.top + G.t, name: nm },
      { type: 'wire', x1: lx, z1: lz, x2: qx, z2: qz, y: G.top + G.t / 2, y1: G.top + G.t / 2, y2: G.top + G.t / 2, r, name: nm }
    ];
    if (G.bottom > 0.25) out.push({ type: 'wire', x1: lx, z1: lz, x2: qx, z2: qz, y: G.bottom - G.t / 2, y1: G.bottom - G.t / 2, y2: G.bottom - G.t / 2, r, name: nm });
    return out;
  };
})();

// ================= أكاديمية طويق (خريطة حقيقية) + منطقة حظر مطار الملك خالد الدولي =================
// منطق بس (بدون three.js) — يشتغل في الاختبار الذاتي. الأصل (0,0) = نقطة الأكاديمية (Google Maps: 24.8540475, 46.7129177).
// المحاور مثل باقي المحاكي: x = شرق، y = فوق، z = جنوب (الشمال = -z).
// بيانات المدارج وأرض المطار والمباني والطرق: © OpenStreetMap contributors (رخصة ODbL) — أخذناها مرة وحدة من Overpass API
// (aeroway=runway / aerodrome حول 24.96, 46.70 + building حول الأكاديمية 350 م + طريق المطار وشارع أنس بن مالك) — 2026-10-18.
(function () {
  const DS = window.DS;
  const D2R = Math.PI / 180;

  // ---------------- WGS84 → ENU (شرق/شمال/فوق) حول نقطة أصل ----------------
  const WA = 6378137, WF = 1 / 298.257223563, WE2 = WF * (2 - WF);
  function makeGeo(lat0, lon0) {
    const sp = Math.sin(lat0 * D2R), cp = Math.cos(lat0 * D2R), sl = Math.sin(lon0 * D2R), cl = Math.cos(lon0 * D2R);
    const N0 = WA / Math.sqrt(1 - WE2 * sp * sp), M0 = WA * (1 - WE2) / Math.pow(1 - WE2 * sp * sp, 1.5);
    const ox = N0 * cp * cl, oy = N0 * cp * sl, oz = N0 * (1 - WE2) * sp;
    const tmp = { x: 0, z: 0 };
    const G = {
      lat: lat0, lon: lon0,
      // ECEF → محلي: صفوف الدوران (شرق، فوق، -شمال) والأصل ECEF — geo3d.js يبني منها مصفوفة البلاطات (نفس الحساب بالضبط)
      rot: [-sl, cl, 0, cp * cl, cp * sl, sp, sp * cl, sp * sl, -cp], origin: [ox, oy, oz],
      latLonToLocal(lat, lon, out) {
        out = out || { x: 0, z: 0 };
        const p = lat * D2R, l = lon * D2R, s = Math.sin(p), c = Math.cos(p), N = WA / Math.sqrt(1 - WE2 * s * s);
        const X = N * c * Math.cos(l) - ox, Y = N * c * Math.sin(l) - oy, Z = N * (1 - WE2) * s - oz;
        out.x = -sl * X + cl * Y;
        out.z = sp * cl * X + sp * sl * Y - cp * Z;   // = -شمال
        return out;
      },
      localToLatLon(x, z, out) {
        out = out || { lat: 0, lon: 0 };
        let lat = lat0 - z / M0 / D2R, lon = lon0 + x / (N0 * cp) / D2R;
        for (let k = 0; k < 3; k++) {
          G.latLonToLocal(lat, lon, tmp);
          lat -= (z - tmp.z) / M0 / D2R; lon += (x - tmp.x) / (N0 * cp) / D2R;
        }
        out.lat = lat; out.lon = lon; return out;
      }
    };
    return G;
  }
  DS.makeGeo = makeGeo;

  // ---------------- شبكة ارتفاعات (سطح الأرض + المباني) ----------------
  // نفس الشكل للمجسم التقريبي (مباني OSM) وللخريطة الحقيقية (geo3d.js يعبيها من البلاطات). NaN = ما فيه معلومة
  class HeightField {
    constructor(nx, nz, cell, fill) {
      this.nx = nx; this.nz = nz; this.cell = cell;
      this.x0 = -nx * cell / 2; this.z0 = -nz * cell / 2;
      this.h = new Float32Array(nx * nz); this.h.fill(fill == null ? NaN : fill);
      this.version = 0;
    }
    setCenter(cx, cz) { this.x0 = cx - this.nx * this.cell / 2; this.z0 = cz - this.nz * this.cell / 2; }
    get cx() { return this.x0 + this.nx * this.cell / 2; }
    get cz() { return this.z0 + this.nz * this.cell / 2; }
    at(x, z) {
      const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
      if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return NaN;
      return this.h[j * this.nx + i];
    }
    // ثنائي الخطوط بين مراكز الخلايا — لو فيه خلية فاضية أو درجة كبيرة (جدار): قيمة الخلية نفسها (ما نسوي منحدر وهمي عند الجدار)
    sample(x, z) {
      const c = this.cell, fx = (x - this.x0) / c - 0.5, fz = (z - this.z0) / c - 0.5;
      const i = Math.floor(fx), j = Math.floor(fz);
      if (i < 0 || j < 0 || i + 1 >= this.nx || j + 1 >= this.nz) return this.at(x, z);
      const H = this.h, k = j * this.nx + i, a = H[k], b = H[k + 1], d = H[k + this.nx], e = H[k + this.nx + 1];
      if (a !== a || b !== b || d !== d || e !== e) return this.at(x, z);
      const lo = Math.min(a, b, d, e), hi = Math.max(a, b, d, e);
      if (hi - lo > 0.5) return this.at(x, z);
      const tx = fx - i, tz = fz - j;
      return (a * (1 - tx) + b * tx) * (1 - tz) + (d * (1 - tx) + e * tx) * tz;
    }
    // أعلى ارتفاع داخل دائرة نصف قطرها r. out (اختياري) = مركز الخلايا اللي أعلى من thr {cx, cz, n}
    maxDisc(x, z, r, thr, out) {
      const c = this.cell, rr = (r + c * 0.71) * (r + c * 0.71);
      const i0 = Math.max(0, Math.floor((x - r - this.x0) / c)), i1 = Math.min(this.nx - 1, Math.floor((x + r - this.x0) / c));
      const j0 = Math.max(0, Math.floor((z - r - this.z0) / c)), j1 = Math.min(this.nz - 1, Math.floor((z + r - this.z0) / c));
      let m = -Infinity, sx = 0, sz = 0, n = 0;
      for (let j = j0; j <= j1; j++) {
        const zc = this.z0 + (j + 0.5) * c, dz = zc - z;
        for (let i = i0; i <= i1; i++) {
          const xc = this.x0 + (i + 0.5) * c, dx = xc - x;
          if (dx * dx + dz * dz > rr) continue;
          const v = this.h[j * this.nx + i];
          if (v !== v) continue;
          if (v > m) m = v;
          if (out && v > thr) { sx += xc; sz += zc; n++; }
        }
      }
      if (out) { out.n = n; out.cx = n ? sx / n : x; out.cz = n ? sz / n : z; }
      return m;
    }
    // تعبئة مضلع (x,z,...) بارتفاع h (مسح أفقي لكل صف)
    rasterPoly(P, h) {
      const n = P.length / 2, c = this.cell, xs = [];
      let zmin = Infinity, zmax = -Infinity;
      for (let k = 0; k < n; k++) { zmin = Math.min(zmin, P[k * 2 + 1]); zmax = Math.max(zmax, P[k * 2 + 1]); }
      const j0 = Math.max(0, Math.floor((zmin - this.z0) / c)), j1 = Math.min(this.nz - 1, Math.floor((zmax - this.z0) / c));
      for (let j = j0; j <= j1; j++) {
        const zc = this.z0 + (j + 0.5) * c;
        xs.length = 0;
        for (let k = 0, q = n - 1; k < n; q = k++) {
          const az = P[k * 2 + 1], bz = P[q * 2 + 1];
          if ((az > zc) !== (bz > zc)) xs.push(P[k * 2] + (zc - az) / (bz - az) * (P[q * 2] - P[k * 2]));
        }
        xs.sort((a, b) => a - b);
        for (let s = 0; s + 1 < xs.length; s += 2) {
          const i0 = Math.max(0, Math.ceil((xs[s] - this.x0) / c - 0.5)), i1 = Math.min(this.nx - 1, Math.floor((xs[s + 1] - this.x0) / c - 0.5));
          for (let i = i0; i <= i1; i++) { const k = j * this.nx + i; if (!(this.h[k] >= h)) this.h[k] = h; }
        }
      }
      this.version++;
    }
  }
  DS.HeightField = HeightField;

  // ---------------- السطح للفيزياء (الأرض + المباني) من شبكة الارتفاعات ----------------
  // physics.js يستخدمه عن طريق env.geo: groundAt / hit / sense / los. كل الدوال بدون إنشاء كائنات جديدة.
  const HIT_TOL = 0.3;    // شي أعلى من مركز الدرون بـ 30 سم داخل نصف قطره = خبطة
  const STEP_UP = 0.6;    // أعلى من كذا تحت الدرون = جدار (مو أرض)
  const LOS_NEAR = 150;   // الإشارة: نشوف المباني اللي قرب الدرون بس
  class GeoSurface {
    constructor(field, outside) { this.field = field; this.outside = outside; this._o = { cx: 0, cz: 0, n: 0 }; this.name = 'مبنى'; }
    // ارتفاع الأرض/السطح تحت (x,z). below = ارتفاع الدرون: لو السطح أعلى منه بكثير = جدار → null
    groundAt(x, z, below) {
      const f = this.field;
      const v = f ? f.sample(x, z) : NaN;
      if (v !== v) return this.outside;
      if (below != null && v > below + STEP_UP) return null;
      return v;
    }
    // خبط في مبنى/شجرة/سيارة؟ out = {nx, nz} اتجاه الابتعاد عن الشي
    hit(x, y, z, r, out) {
      const f = this.field; if (!f) return false;
      const o = this._o, m = f.maxDisc(x, z, r, y + HIT_TOL, o);
      if (!(m > y + HIT_TOL) || !o.n) return false;
      if (out) {
        let nx = x - o.cx, nz = z - o.cz; const l = Math.hypot(nx, nz);
        if (l > 1e-6) { nx /= l; nz /= l; } else { nx = 0; nz = 0; }
        out.nx = nx; out.nz = nz; out.top = m;
      }
      return true;
    }
    // حساسات العوائق: كم متر لين أول شي على ارتفاع الدرون باتجاه (ux,uz)؟ (-1 = فاضي)
    sense(x, y, z, ux, uz, maxD) {
      const f = this.field; if (!f) return -1;
      const st = Math.max(0.4, f.cell);
      for (let s = st * 0.5; s <= maxD; s += st) {
        const v = f.at(x + ux * s, z + uz * s);
        if (v > y - 0.15) return s;
      }
      return -1;
    }
    // كم شي يقطع الخط بين الريموت والدرون (0..2) — نشوف آخر 150 م قرب الدرون بس
    // (الدرون ورا مبنى = الإشارة تضعف؛ المباني اللي جنب الطيار نتجاهلها: الطيار يقدر يتحرك/يرفع الريموت)
    los(ax, ay, az, bx, by, bz) {
      const f = this.field; if (!f) return 0;
      const L = Math.hypot(bx - ax, bz - az); if (L < 2) return 0;
      const t0 = L > LOS_NEAR ? 1 - LOS_NEAR / L : 0, span = Math.min(L, LOS_NEAR);
      const n = Math.min(400, Math.ceil(span / Math.max(1, f.cell))), inv = (1 - t0) / n;
      let blocks = 0, inB = false;
      for (let k = 1; k < n; k++) {
        const t = t0 + k * inv, v = f.at(ax + (bx - ax) * t, az + (bz - az) * t);
        const b = v > ay + (by - ay) * t;
        if (b && !inB && ++blocks >= 2) return 2;
        inB = b;
      }
      return blocks;
    }
  }
  DS.GeoSurface = GeoSurface;

  // ---------------- منطقة الحظر (مثل DJI GEO): 5 كم من خط نص المدرج (شكل ملعب) + أرض المطار ----------------
  // query(x, z, out) → out = {state, d, dWarn, nx, nz}
  //   d = المسافة لحد منطقة الحظر (موجب = برا)، dWarn = المسافة لحد منطقة التحذير (5–7 كم)
  //   (nx, nz) = اتجاه الابتعاد عن منطقة الحظر، state: 0 عادي، 1 تحذير، 2 قريب جداً من الحد (< near)، 3 داخل الحظر
  function makeFence(G, data, o) {
    const segs = data.runways.map(r => {
      const a = G.latLonToLocal(r.a[0], r.a[1]), b = G.latLonToLocal(r.b[0], r.b[1]);
      return { ref: r.ref, ax: a.x, az: a.z, bx: b.x, bz: b.z, w: r.w || 60 };
    });
    const A = data.aerodrome, poly = new Float64Array(A.length), tp = { x: 0, z: 0 };
    for (let k = 0; k < A.length; k += 2) { G.latLonToLocal(A[k], A[k + 1], tp); poly[k] = tp.x; poly[k + 1] = tp.z; }
    let cx = 0, cz = 0; segs.forEach(s => { cx += (s.ax + s.bx) / 2; cz += (s.az + s.bz) / 2; }); cx /= segs.length; cz /= segs.length;
    const F = {
      id: o.id, name: o.name, short: o.short, R: o.R, W: o.W, PW: o.PW, near: o.near, segs, poly, cx, cz, _ol: {},
      query(x, z, out) {
        out = out || { state: 0, d: 0, dWarn: 0, nx: 0, nz: 0 };
        let dS = Infinity, dW = Infinity, sx = 1, sz = 0;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i], dx = s.bx - s.ax, dz = s.bz - s.az, l = dx * dx + dz * dz;
          let t = l > 0 ? ((x - s.ax) * dx + (z - s.az) * dz) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = x - (s.ax + dx * t), ez = z - (s.az + dz * t), dist = Math.sqrt(ex * ex + ez * ez);
          if (dist - F.R < dS) { dS = dist - F.R; if (dist > 1e-6) { sx = ex / dist; sz = ez / dist; } }
          if (dist - F.W < dW) dW = dist - F.W;
        }
        // أرض المطار: مسافة بإشارة (سالب = داخل)
        const n = poly.length / 2;
        let best = Infinity, px = 1, pz = 0, inside = false;
        for (let k = 0, q = n - 1; k < n; q = k++) {
          const ax = poly[q * 2], az = poly[q * 2 + 1], bx = poly[k * 2], bz = poly[k * 2 + 1];
          if ((bz > z) !== (az > z) && x < (ax - bx) * (z - bz) / (az - bz) + bx) inside = !inside;
          const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
          let t = l > 0 ? ((x - ax) * dx + (z - az) * dz) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = x - (ax + dx * t), ez = z - (az + dz * t), dd = ex * ex + ez * ez;
          if (dd < best) { best = dd; px = ex; pz = ez; }
        }
        best = Math.sqrt(best);
        if (best > 1e-6) { px /= best; pz /= best; }
        const dP = inside ? -best : best;
        if (inside) { px = -px; pz = -pz; }
        let d, nx, nz;
        if (dP < dS) { d = dP; nx = px; nz = pz; } else { d = dS; nx = sx; nz = sz; }
        const dWarn = Math.min(dW, dP - F.PW);
        out.d = d; out.dWarn = dWarn; out.nx = nx; out.nz = nz;
        out.state = d <= 0 ? 3 : d < F.near ? 2 : dWarn <= 0 ? 1 : 0;
        return out;
      },
      // حد المنطقة كمضلع (للخريطة والجدار الأحمر): مسح دائري من نص المطار + تنصيف — Float32Array [x,z,...]
      outline(kind, n) {
        const key = kind + ':' + (n || 360);
        if (F._ol[key]) return F._ol[key];
        n = n || 360;
        const out = new Float32Array(n * 2), q = { state: 0, d: 0, dWarn: 0, nx: 0, nz: 0 };
        const fn = (x, z) => { F.query(x, z, q); return kind === 'warn' ? q.dWarn : q.d; };
        for (let k = 0; k < n; k++) {
          const a = k / n * Math.PI * 2, ux = Math.sin(a), uz = -Math.cos(a);
          let lo = 0, hi = 30000;
          for (let it = 0; it < 32; it++) { const m = (lo + hi) / 2; if (fn(cx + ux * m, cz + uz * m) < 0) lo = m; else hi = m; }
          out[k * 2] = cx + ux * lo; out[k * 2 + 1] = cz + uz * lo;
        }
        return (F._ol[key] = out);
      }
    };
    return F;
  }
  DS.makeFence = makeFence;

  // ---------------- أكاديمية طويق ----------------
  const LAT = 24.8540475, LON = 46.7129177;
  const G = makeGeo(LAT, LON);
  DS.Geo = G;
  const RAW = {
    runways: [{"ref":"15L/33R","a":[24.9768681,46.7020387],"b":[24.9439616,46.7227999],"w":60},{"ref":"15R/33L","a":[24.9709546,46.67491],"b":[24.9380862,46.6956837],"w":60}],
    aerodrome: [24.97398,46.661536,24.975701,46.660967,24.977252,46.661176,24.97857,46.662051,24.986385,46.676227,24.986648,46.677181,24.986639,46.678432,24.986313,46.679437,24.985844,46.680314,24.984893,46.681222,24.9838,46.682217,24.993299,46.700436,24.979899,46.724054,24.974028,46.739062,24.967678,46.745392,24.949563,46.756131,24.948987,46.756511,24.948045,46.753896,24.947242,46.751627,24.946102,46.748731,24.943554,46.742474,24.91927,46.696377],
    // [أكاديمية؟ 1/0، الارتفاع م، [x,z,...] محلي بالمتر]
    buildings: [
      [0, 9, [-135.5,292,-88,285.5,-82,285,-76,329,-80.5,329.5,-129.5,336,-130.5,326]],
      [0, 10, [-229,264.5,-190,258.5,-182.5,307.5,-169.5,305.5,-167,321,-165,336,-179,338,-174.5,365,-213.5,371,-217.5,345,-227,346,-231.5,318,-221,316]],
      [0, 10, [306.5,-159.5,308.5,-146.5,309.5,-140,291,-137,294,-117.5,287,-116.5,284,-137,275.5,-135.5,273,-153,283.5,-155,280,-176.5,287,-178,290.5,-157]],
      [0, 9, [-197.5,-114,-137,-124,-130,-79,-191.5,-70.5]],
      [0, 18.5, [113.5,301.5,132,299,136,325.5,211,315,213.5,333.5,120,346.5]],
      [0, 18.5, [70.5,278,91,274.5,84,231.5,-1,245.5,-30,258,-41.5,271.5,-52.5,300,-53.5,316.5,-46,334,-23.5,355,-8.5,361,18.5,363.5,105,350,98,307,78,310.5,81.5,332,6,343.5,-5.5,341,-16,335.5,-25,323.5,-28.5,314,-30,299.5,-27.5,287.5,-20,275.5,-7,267,66.5,255]],
      [0, 18.5, [-78.5,-191,-59,-194,-66,-239.5,-9,-248,-2,-202,17.5,-205,7.5,-269,-88,-254]],
      [0, 18.5, [25.5,-271,123.5,-286,133.5,-220.5,112.5,-217.5,105,-264.5,47,-255.5,54,-210.5,35,-208]],
      [0, 18.5, [140,-289.5,239.5,-306,250.5,-238.5,230.5,-235,222.5,-281.5,165,-272,172.5,-226.5,151,-223]],
      [0, 18.5, [134.5,-183,42,-168.5,49,-126.5,68,-129.5,64.5,-153.5,137.5,-165]],
      [0, 18.5, [157,-185.5,248,-199,254,-158,235.5,-155.5,232,-178.5,159.5,-168]],
      [0, 18.5, [15.5,-115.5,34,-119,27,-160,-58,-148,-79.5,-140.5,-95.5,-125.5,-107,-104.5,-112,-82,-102.5,-60,-87.5,-44.5,-67,-34,-41.5,-30.5,44,-43.5,37.5,-85.5,20,-83,24,-60,-45,-49.5,-62,-52.5,-75,-60.5,-85.5,-72,-90.5,-85,-89.5,-100,-82,-114.5,-70.5,-124.5,-55.5,-129,11,-138]],
      [0, 18.5, [54.5,-95.5,75,-99,79,-73.5,150.5,-84.5,153,-66.5,61,-52]],
      [0, 18.5, [173,-87,246,-98,242.5,-123,260,-126,266.5,-84.5,175.5,-70.5]],
      [0, 18.5, [200.5,-36.5,181,-33.5,191.5,34,287.5,19,277,-45.5,260,-43,267,2,208,11]],
      [0, 18.5, [62.5,-17.5,83,-20.5,91,29,150,20,142.5,-26,161.5,-29,171.5,34.5,73,49.5]],
      [1, 18.5, [27,-9,46,-12.5,57,52.5,-39,68,-50,2,-33,-1,-24.5,49.5,35,39.5]],
      [0, 18.5, [108.5,270,129,267,125,244,199.5,232.5,196.5,215,102,230]],
      [0, 18.5, [219.5,212,312,198,318.5,241.5,300,244.5,296.5,220,222.5,231]],
      [0, 10, [169,255,258.5,242.5,265,289.5,175.5,302]],
      [0, 18.5, [97,191.5,116.5,188.5,109.5,144,165,135.5,172,178.5,191.5,175.5,181.5,113.5,87,128.5]],
      [0, 18.5, [-27,145,70.5,130.5,81,198,61.5,201,54.5,154,-4,163,3,209,-17,212]],
      [0, 18.5, [210,174,227.5,171.5,220,124,281,114.5,289,163.5,308,160.5,297.5,95,200,110.5]],
      [0, 10, [-396,-99,-389.5,-59,-359.5,-63.5,-354.5,-32,-365,-30.5,-358.5,9.5,-324.5,4,-323.5,9,-225.5,-6.5,-231,-42,-222.5,-43.5,-220,-27.5,-201,-30.5,-216.5,-126,-325.5,-108.5,-322,-85.5,-349,-81.5,-353,-105.5]],
      [0, 10, [114.5,-94.5,204.5,-109,197,-157,107,-142.5]]
    ],
    // [طريق المطار؟ 1/0، العرض م، جسر؟ 1/0، [x,z,...]]
    roads: [
      [1, 14, 0, [721,2926.5,854,2735,1273.5,2199.5,1436.5,1965.5,1583,1695.5,1693,1477.5,1735,1381,1849.5,1074,1904,889.5,1961,637.5,1986.5,491,2019,195,2028.5,47,2032.5,-70,2032,-246.5,2027,-397.5,2014,-547,1994,-701,1946.5,-963,1900,-1157,1868.5,-1266,1791.5,-1500]],
      [1, 14, 0, [1812.5,-1335.5,1831.5,-1277.5,1895.5,-1046,1943,-817.5,1965,-669.5,1993,-400.5,2000.5,-228.5,2004,-63,1992,183,1976.5,340,1949.5,526.5,1888,815.5,1836,1006,1738,1290,1697.5,1389,1562.5,1683.5,1462.5,1856,1361.5,2020,1207.5,2236.5,917,2609,723,2868,696,2910.5]],
      [0, 9, 0, [-2326.5,1710.5,-1863,1463.5,-1489,1254.5,-1420,1223.5,-1331.5,1193,-1225.5,1168,-1140.5,1156,-485.5,1085.5,-330,1066,-177,1040.5]],
      [0, 9, 1, [260,956,94,978,-178.5,1026]],
      [0, 9, 0, [-178.5,1026,-319.5,1049,-485,1068.5,-1142.5,1139,-1227.5,1150.5,-1379.5,1189.5,-1461.5,1222.5,-1567.5,1275.5,-2015.5,1527,-2333,1701]],
      [0, 9, 1, [-177,1040.5,96,991.5,264,970]],
      [0, 9, 0, [264,970,347,957.5]],
      [0, 9, 0, [345,941.5,260,956]]
    ]
  };
  const TW = DS.TUWAIQ = {
    id: 'tuwaiq', lat: LAT, lon: LON, title: 'أكاديمية طويق', menuTitle: '📍 أكاديمية طويق — خريطة حقيقية 3D',
    geo: G, latLonToLocal: G.latLonToLocal, localToLatLon: G.localToLatLon,
    // المنصة في الساحة اللي داخل المبنى (شكل U مفتوح للشمال)، والطيار وراها جنوب ويطالع الشمال
    spawn: { x: 0, z: 8, yaw: 0, pilot: { x: 0, z: 16 } },
    maxAlt: 120,   // نظام الطيران المدني: 120 م فوق الأرض (نحسبها من مكان الإقلاع مثل DJI)
    osm: '© OpenStreetMap contributors',
    raw: RAW,
    buildings: RAW.buildings.map(b => ({ academy: !!b[0], h: b[1], p: b[2] })),
    roads: RAW.roads.map(r => ({ name: r[0] ? 'طريق المطار' : 'شارع أنس بن مالك', airport: !!r[0], w: r[1], bridge: !!r[2], p: r[3] })),
    fence: makeFence(G, RAW, { id: 'kkia', name: 'مطار الملك خالد الدولي', short: 'مطار الملك خالد', R: 5000, W: 7000, PW: 2000, near: 150 }),
    zones: [
      { id: 'nfz', kind: 'restricted', name: 'منطقة حظر طيران — مطار الملك خالد الدولي', rule: '5 كم من المدرجات + أرض المطار' },
      { id: 'warn', kind: 'warning', name: 'منطقة تحذير — قربت من المطار', rule: 'من 5 إلى 7 كم من المدرجات' }
    ],
    realWorld: 'في الواقع: لازم تلتزم بأنظمة الهيئة العامة للطيران المدني (تسجيل الدرون وأخذ التصاريح) — هذا محاكي للتدريب'
  };
  DS.Geofence = TW.fence;
  {
    const a = TW.buildings.find(b => b.academy);
    if (a) {
      let x = 0, z = 0; const n = a.p.length / 2;
      for (let k = 0; k < n; k++) { x += a.p[k * 2]; z += a.p[k * 2 + 1]; }
      TW.academy = { name: 'أكاديمية طويق (مبنى تقريبي)', p: a.p, h: a.h, cx: x / n, cz: z / n };
    }
    TW.runways = TW.fence.segs;
  }
  // سطح المجسم التقريبي (بدون نت): أرض مستوية 0 + مباني OSM (خلايا 1 م) — نبنيه مرة وحدة وقت الحاجة
  TW.surface = function () {
    if (TW._surf) return TW._surf;
    const f = new HeightField(800, 800, 1, 0);
    for (const b of TW.buildings) f.rasterPoly(b.p, b.h);
    return (TW._surf = new GeoSurface(f, 0));
  };
})();
