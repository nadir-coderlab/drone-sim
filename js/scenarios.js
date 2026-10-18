// السيناريوهات (وش تسوي لو صار كذا؟) + دروس المبتدئ
(function () {
  const DS = window.DS, U = DS.U, SC = DS.SC;
  const dec = (q, opts, ex) => {
    const idx = U.pick(opts.map((_, i) => i), opts.length);
    return { decide: { q, a: idx.map(i => opts[i]), c: idx.indexOf(0), ex, lang: 'ar' } };
  };
  const landHome = (r, o) => SC.land(Object.assign({ x: 0, z: 0, r, home: true }, o || {}));
  const skipLand = s => { const t0 = s.tick; s.tick = (ctx, st, dt, task) => st.skip ? 'next' : t0(ctx, st, dt, task); return s; };
  const far = (ctx, lim) => U.dist2(ctx.drone.p.x, ctx.drone.p.z, 0, 0) > lim;
  const tip = (st, t) => { st.tips = st.tips || []; if (!st.tips.includes(t)) st.tips.push(t); };
  const lh = pre => (ctx, st) => pre + (st.lc ? st.lc.hint(ctx.drone, 'H') : '');
  const noseErr = d => Math.abs(U.wrap(U.bearing(d.p.x, d.p.z, DS.PILOT.x, DS.PILOT.z) - d.yaw));
  const tailErr = d => Math.abs(U.wrap(U.bearing(DS.PILOT.x, DS.PILOT.z, d.p.x, d.p.z) - d.yaw));
  const unmap = (st, item) => { const i = st.map.indexOf(item); if (i >= 0) st.map.splice(i, 1); };
  const NEW = o => new DS.ScenarioTask(Object.assign({ timeLimit: 330 }, o));
  // المحترف يحوّل S (السهم فوق) إذا الهواء أقوى من الدرون وما يتقدم
  const sportIfStuck = step => {
    const g0 = step.guide;
    step.guide = (ctx, st) => {
      const d = ctx.drone, g = g0(ctx, st);
      if (g && d.mode !== 'S' && !d.onGround && st.stepT > 3 && U.dist2(d.p.x, d.p.z, 0, 0) > 8 && Math.hypot(d.v.x, d.v.z) < 2.5) return Object.assign({ press: { UP: true } }, g);
      return g;
    };
    return step;
  };

  const S = DS.SCN_TASKS = {};

  S.signal = (o = {}) => () => NEW({
    title: 'انقطاع الاتصال', short: 'انقطاع الاتصال',
    steps: [
      SC.flyTo({ x: 0, z: -50, alt: 15, r: 4, label: '1' }),
      Object.assign(dec('انقطع الاتصال بين الريموت والدرون! وش تسوي؟',
        ['لا تطفي الريموت: وجّه جنب الأنتينا للدرون وانتظر رجوعه التلقائي', 'تطفي الريموت وتشغله', 'تركض وراه', 'تعتبره طاح وتترك الريموت'],
        'الدرون يشغل نظام الأمان (Failsafe) ويرجع للبيت لحاله. وأول ما يرجع الاتصال استلم التحكم.'),
      { enter(ctx) { const d = ctx.drone; d.link = false; d.toggleRTH(true); ctx.msg('📵 انقطعت الإشارة!', 'bad'); } }),
      {
        tick(ctx, st) {
          const d = ctx.drone;
          if (!d.link && st.stepT > 6) { d.link = true; ctx.msg('📶 رجعت الإشارة — استلم التحكم', 'good'); }
          if (d.link && d.onGround && !d.motors) { st.pen += 15; tip(st, 'أول ما ترجع الإشارة استلم التحكم بنفسك'); st.skip = true; return 'next'; }
          return d.link && d.auto !== 'rth' && !d.onGround ? 'next' : null;
        },
        hint: ctx => ctx.drone.link ? 'رجعت الإشارة! ضغطة B وحدة عشان تلغي الرجوع وتستلم التحكم' : '📵 الإشارة مقطوعة… الدرون يرجع لحاله. انتظر ولا تطفي الريموت',
        guide: ctx => ctx.drone.link ? { press: { B: true } } : { none: true }
      },
      skipLand(landHome(o.padR || 1.5))
    ],
    cleanup(ctx) { ctx.drone.link = true; }
  });

  S.lowbat = () => () => NEW({
    title: 'بطارية ضعيفة وأنت بعيد', short: 'البطارية الضعيفة',
    setup(ctx) { ctx.env.wind.set(6, 180, 1.5); },
    steps: [
      SC.flyTo({ x: 0, z: -90, alt: 30, r: 6, label: '1', speed: 7 }),
      Object.assign(dec('جاك تحذير بطارية ضعيفة وأنت بعيد، والهواء بيكون ضدك وأنت راجع. وش تسوي؟',
        ['ترجع فوراً بخط مستقيم وتنزل لارتفاع أقل لأن الهواء تحت أخف', 'تكمل المهمة دقيقة بس', 'تصعد أعلى', 'تطفي المحركات'],
        'ارجع فوراً. والهواء فوق أقوى، فانزل لارتفاع أقل في الرجعة.'),
      { enter(ctx) { const d = ctx.drone; d.battery = 28; d.batWarned = { 30: 1 }; d.drain = 2.2; d.emit('warn', 'بطارية ضعيفة (28%) — ارجع للبيت الحين'); } }),
      landHome(2, {
        hint: (ctx, st) => (!ctx.drone.onGround && ctx.drone.p.y > 14 ? 'نزّل لتحت 12 متر (الهواء تحت أخف) — ' : '') + (st.lc ? st.lc.hint(ctx.drone, 'H') : '')
      })
    ],
    always(ctx, st) { const d = ctx.drone; if (st.k >= 2 && !d.onGround && d.p.y < 12) st.data.low = true; },
    score(st) {
      const dp = st.dec.length ? 100 * st.dec.filter(Boolean).length / st.dec.length : 100;
      if (!st.data.low) tip(st, 'في الرجعة ضد الهواء انزل لارتفاع أقل');
      return Math.round(0.5 * dp + 0.5 * U.clamp(100 - st.pen - (st.data.low ? 0 : 15), 0, 100));
    },
    cleanup(ctx) { ctx.drone.drain = 1; }
  });
  // نخلي المحترف (الطيار الآلي) ينزل تحت 12 متر في الرجعة
  const _lb = S.lowbat;
  S.lowbat = () => () => { const t = _lb()(); const st = t.o.steps[2]; const g0 = st.guide; st.guide = (c, s) => { const g = g0(c, s); if (g.alt != null) g.alt = Math.min(g.alt, 8); return g; }; return t; };

  S.gps = (o = {}) => () => NEW({
    title: 'ضاع الـ GPS', short: 'فقدان GPS',
    steps: [
      SC.flyTo({ x: -15, z: -45, alt: 8, r: 4, label: '1' }),
      Object.assign(dec('ضاع الـ GPS والدرون صار ينجرف مع الهواء. وش الصح؟',
        ['تتحكم فيه بيدك وتصحح الانجراف وترجعه وتنزل بأمان', 'تترك العصي وتنتظر يوقف لحاله', 'تضغط الرجوع للبيت', 'تصعد عالي'],
        'الدرون صار ATTI: ما يثبت مكانه، والرجوع للبيت يحتاج GPS.'),
      { enter(ctx) { ctx.drone.loseGnss(); ctx.msg('⚠️ راح الـ GPS والحساسات تحت ما تشوف الأرض — ATTI', 'bad'); } }),
      landHome(o.padR || 2.5, { hint: lh('رجّعه بيدك وصحح الانجراف — ') })
    ],
    cleanup(ctx) { ctx.drone.setGnss(true); }
  });

  S.wind = () => () => NEW({
    title: 'هواء قوي فوق', short: 'الهواء القوي',
    setup(ctx) { ctx.env.wind.set(1.5, 180, 0.5); },
    steps: [
      SC.flyTo({ x: 0, z: -50, alt: 40, r: 6, label: '1', speed: 6 }),
      Object.assign(dec('هبّ هواء قوي فجأة والدرون صار ينسحب بعيد وما يتقدم ناحيتك. وش تسوي؟',
        ['تنزل لارتفاع أقل (الهواء تحت أخف) وترجعه، وإذا ما تقدم تحوله Sport', 'تصعد أعلى', 'تتركه يبعد مع الهواء', 'تتجاهل تحذير الهواء'],
        'الهواء فوق أقوى من تحت. انزل، ولو ما زال ما يتقدم حوّل Sport عشان ياخذ قوة أكثر.'),
      { enter(ctx) { ctx.env.wind.set(13, 180, 2); ctx.drone.emit('warn', 'هواء قوي جداً!'); } }),
      SC.cond(c => !c.drone.onGround && c.drone.p.y < 12, 'نزّل لتحت 12 متر عشان تطلع من الهواء القوي', { guide: c => ({ x: c.drone.p.x, z: c.drone.p.z + 5, alt: 6, speed: 8 }) }),
      sportIfStuck(landHome(2.5, { hint: lh('رجّعه ضد الهواء (لو ما يتقدم: السهم فوق ▲ لين يصير S) — ') }))
    ],
    always(ctx) { if (far(ctx, 150)) return 'fail:الدرون راح بعيد مع الهواء وضاع'; }
  });

  S.heli = () => () => NEW({
    title: 'طيارة فيها ناس تقرب', short: 'الطيارة المأهولة',
    steps: [
      SC.flyTo({ x: 10, z: -40, alt: 35, r: 5, label: '1' }),
      Object.assign(dec('هليكوبتر فيها ناس جاية صوب منطقتك! وش تسوي؟',
        ['تنزل فوراً لارتفاع منخفض وتبعد عن طريقها', 'تصعد عشان تصورها', 'تكمل مهمتك عادي', 'تثبت مكانك في طريقها'],
        'الطيارة اللي فيها بشر لها الأولوية دايماً. انزل وابعد عن طريقها.'),
      { enter(ctx, st, task) { const h = st.data; h.h = ctx.R.add(task, { type: 'heli' }); h.hx = -260; st.map.push(h.m = { kind: 'heli', x: -260, z: -42 }); ctx.msg('🚁 هليكوبتر تقرب!', 'bad'); } }),
      SC.cond(c => c.drone.onGround || c.drone.p.y <= 15, 'انزل فوراً لتحت 15 متر!', { limit: 11, failMsg: 'ما نزلت بسرعة — الهليكوبتر قربت منك', guide: c => ({ x: c.drone.p.x, z: c.drone.p.z + 3, alt: 8, speed: 3 }) }),
      SC.cond((c, st) => st.data.hx > 120, 'خلك منخفض لين تمر الهليكوبتر', { guide: c => ({ x: c.drone.p.x, z: c.drone.p.z, alt: 8 }) }),
      landHome(2)
    ],
    always(ctx, st, dt) {
      const h = st.data;
      if (h.hx == null || h.hx > 300) { if (h.h && h.hx > 300) { h.h.remove(); h.h = null; unmap(st, h.m); } return; }
      h.hx += 25 * dt; h.h.move(h.hx, 48, -42, Math.PI / 2); h.m.x = h.hx;
      const d = ctx.drone;
      if (Math.hypot(d.p.x - h.hx, (d.p.y - 48) * 1.5, d.p.z + 42) < 22) return 'fail:قربت كثير من الهليكوبتر — خطر تصادم!';
    }
  });

  S.bird = () => () => NEW({
    title: 'طير جارح يهاجم', short: 'الطير الجارح',
    steps: [
      SC.flyTo({ x: -12, z: -35, alt: 12, r: 4, label: '1' }),
      Object.assign(dec('صقر يهاجم الدرون! وش أفضل تصرف؟',
        ['تبعد عنه بسرعة وتصعد، لأن أغلب الطيور ما تصعد بسرعة الدرون', 'تثبت مكانك وتستناه', 'تلاحقه', 'تنزل فوق الموية'],
        'اصعد بسرعة وابعد، وبعدين ارجع وانزل وافحص المراوح.'),
      { enter(ctx, st, task) { const b = st.data; b.h = ctx.R.add(task, { type: 'bird' }); b.x = -70; b.y = 9; b.z = -80; st.map.push(b.m = { kind: 'bird', x: b.x, z: b.z }); ctx.msg('🦅 صقر يهاجم!', 'bad'); } }),
      SC.cond((c, st) => st.data.gone, 'اصعد بسرعة (العصا اليسار لفوق للآخر) وابعد عن الصقر!', { limit: 25, failMsg: 'الصقر لحقك', guide: c => ({ x: c.drone.p.x + 6, z: c.drone.p.z + 6, alt: 40, speed: 6 }) }),
      landHome(2, { hint: lh('الصقر راح ✓ ارجع وهبط وافحص المراوح — ') })
    ],
    always(ctx, st, dt) {
      const b = st.data, d = ctx.drone;
      if (b.x == null || b.gone) return;
      const dx = d.p.x - b.x, dz = d.p.z - b.z, hd = Math.hypot(dx, dz) || 1;
      b.x += dx / hd * 11 * dt; b.z += dz / hd * 11 * dt; b.y += U.clamp(d.p.y - b.y, -3 * dt, 1.6 * dt);
      b.h.move(b.x, b.y, b.z, Math.atan2(dx, -dz)); b.m.x = b.x; b.m.z = b.z;
      if (Math.hypot(d.p.x - b.x, d.p.y - b.y, d.p.z - b.z) < 1.4) { d.crash('الصقر ضرب المروحة!'); return; }
      if (d.p.y > b.y + 9) { b.gone = true; b.h.remove(); unmap(st, b.m); ctx.msg('✓ الصقر ما لحقك وراح', 'good'); }
    }
  });

  S.people = () => () => NEW({
    title: 'ناس دخلوا منطقة الطيران', short: 'الناس في المنطقة',
    steps: [
      SC.flyTo({ x: 0, z: -40, alt: 15, r: 4, label: '1' }),
      Object.assign(dec('ناس دخلوا منطقة الطيران وبيمرون تحت الدرون. وش تسوي؟',
        ['ما تطير فوقهم: تبعد عنهم أو تنزل لين يطلعون', 'تطير فوقهم بسرعة وترجع', 'تكمل عادي فوقهم', 'تنزل قريب منهم تصورهم'],
        'الطيران فوق الناس ممنوع. خل مسافة أمان.'),
      { enter(ctx, st, task) { const p = st.data; p.h = ctx.R.add(task, { type: 'people' }); p.x = -48; p.z = -40; st.map.push(p.m = { kind: 'people', x: p.x, z: p.z }); } }),
      SC.cond((c, st) => st.data.x > 46, 'ابعد عن الناس (أكثر من 12 متر) وانتظر لين يطلعون من الساحة', { guide: () => ({ x: 0, z: -18, alt: 15, speed: 4 }) }),
      landHome(2)
    ],
    always(ctx, st, dt) {
      const p = st.data;
      if (p.x == null || p.x > 46) return;
      p.x += 2 * dt; p.h.move(p.x, 0, p.z, Math.PI / 2); p.m.x = p.x;
      const d = ctx.drone; if (d.onGround) return;
      const hd = U.dist2(d.p.x, d.p.z, p.x, p.z);
      if (hd < 3.5) return 'fail:طرت فوق الناس!';
      if (hd < 12) { st.pen += dt * 6; tip(st, 'خل مسافة أكبر عن الناس'); }
    }
  });

  S.rthtower = () => () => NEW({
    title: 'مبنى في طريق الرجوع', short: 'RTH والمبنى', timeLimit: 400,
    setup(ctx, st, task) {
      ctx.drone.rthSetting = 20;
      ctx.R.add(task, { type: 'tower', x: 0, z: -40, w: 10, d: 10, h: 32 });
      ctx.env.taskColliders.push({ type: 'box', x: 0, z: -40, w: 10, d: 10, h: 32, name: 'المبنى' });
      st.map.push({ kind: 'tower', x: 0, z: -40, r: 5 });
    },
    steps: [
      SC.flyTo({ x: -16, z: -40, alt: 12, r: 4, label: '1', hint: () => 'روح للعلامة 1 جنب المبنى (لا تخبط فيه)' }),
      SC.flyTo({ x: 0, z: -75, alt: 12, r: 5, label: '2' }),
      SC.cond(c => c.drone.auto === 'rth', 'الحين اضغط B مطوّل (ثانية) — الرجوع للبيت (ارتفاع الرجوع مضبوط على 20 متر)', { guide: () => ({ hold: { B: 1.2 } }) }),
      SC.cond(c => c.drone.auto === 'rth' && c.drone.rthPhase === 'cruise', 'الدرون يرجع لحاله… انتبه وش قدامه!', { guide: () => ({ none: true }) }),
      dec('الدرون راجع لحاله على ارتفاع 20 متر وقدامه مبنى طوله 32 متر! وش تسوي؟',
        ['تلغي الرجوع (ضغطة B) وتتحكم فيه بيدك وترفعه فوق المبنى أو تلف حوله', 'تتركه يكمل لحاله', 'تطفي الريموت', 'تنزله فوق المبنى'],
        'الرجوع يمشي بخط مستقيم على الارتفاع المضبوط. اضبط ارتفاع الرجوع دايماً أعلى من أطول عائق.'),
      SC.cond(c => c.drone.auto !== 'rth', 'بسرعة! اضغط B ضغطة وحدة عشان تلغي الرجوع', { limit: 8, failMsg: 'ما ألغيت الرجوع', guide: () => ({ press: { B: true } }) }),
      SC.cond(c => c.drone.p.z > -28, 'ارفعه فوق المبنى (أعلى من 35 متر) أو لف حوله، وارجع صوبك',
        { guide: c => c.drone.p.y < 36 ? { x: c.drone.p.x, z: Math.min(c.drone.p.z, -52), alt: 38, speed: 2 } : { x: 0, z: -20, alt: 38, speed: 6 } }),
      landHome(2)
    ],
    cleanup(ctx) { ctx.drone.rthSetting = 20; }
  });

  S.toilet = () => () => NEW({
    title: 'دوائر تكبر (البوصلة)', short: 'Toilet Bowl',
    steps: [
      SC.flyTo({ x: 0, z: -25, alt: 10, r: 4, label: '1' }),
      Object.assign(SC.wait(4, 'شوف… الدرون صار يتحرك لحاله!', () => ({ none: true })), { enter(ctx, st) { st.data.tb = 0; } }),
      dec('الدرون يدور دوائر لحاله والدوائر تكبر (Toilet Bowl). وش الصح؟',
        ['تحوله ATTI (السهم اليسار ◀) وتتحكم فيه بيدك وتنزل', 'تكمل الطيران عادي', 'تبعد فيه أكثر', 'تصعد أعلى'],
        'السبب غالباً البوصلة. وضع ATTI يوقف الاعتماد عليها، وبعدين افحص البوصلة وسو لها معايرة.'),
      SC.cond(c => c.drone.mode === 'A', 'اضغط السهم اليسار ◀ عشان يصير الوضع ATTI', { limit: 25, failMsg: 'الدوائر كبرت والدرون ضاع', guide: () => ({ press: { LEFT: true } }) }),
      landHome(2.5, { hint: lh('ممتاز ✓ تحكم فيه بيدك ورجّعه للمنصة — ') })
    ],
    always(ctx, st, dt) {
      const d = ctx.drone, b = st.data;
      if (b.tb == null) return;
      // البوصلة تعطي اتجاه غلط (يكبر شوي شوي) → حلقة GPS تدوّر الدرون بدوائر تكبر. في ATTI ما تأثر
      b.tb += dt;
      d.injectHeadingError(U.rad(Math.min(130, 75 + 5 * b.tb)));
      if (far(ctx, 120)) return 'fail:الدرون ضاع بالدوائر';
    },
    cleanup(ctx) { ctx.drone.injectHeadingError(0); ctx.drone.dist = { x: 0, z: 0 }; }
  });

  S.flyaway = () => () => NEW({
    title: 'الدرون هرب لحاله', short: 'Fly-away',
    steps: [
      SC.flyTo({ x: 10, z: -30, alt: 12, r: 4, label: '1' }),
      Object.assign(dec('الدرون صار يطير لحاله بعيد وما يسمع أوامرك (Fly-away). وش الصح؟',
        ['تجرب الرجوع للبيت، وإذا ما نفع تحوله ATTI (◀) وتاخذ التحكم بيدك وتنزل بأمان', 'تطفي الريموت', 'تتفرج عليه وهو يبعد', 'تركض وراه'],
        'وسجل آخر مكان ظهر فيه بالخريطة.'),
      { enter(ctx, st) { st.data.fa = true; ctx.msg('⚠️ الدرون يطير لحاله!', 'bad'); } }),
      SC.cond(c => c.drone.auto === 'rth', 'جرّب أول: اضغط B مطوّل (الرجوع للبيت)', { limit: 20, failMsg: 'الدرون هرب بعيد', guide: () => ({ hold: { B: 1.2 } }) }),
      SC.wait(3, 'الرجوع ما نفع… الدرون مازال يهرب!', () => ({ none: true })),
      SC.cond(c => c.drone.mode === 'A', 'حوّله ATTI بسرعة: اضغط السهم اليسار ◀', { limit: 20, failMsg: 'الدرون هرب بعيد', guide: () => ({ press: { LEFT: true } }) }),
      landHome(2.5, { hint: lh('ممتاز ✓ أخذت التحكم. رجّعه بيدك وهبط — ') })
    ],
    always(ctx, st) {
      const d = ctx.drone;
      if (st.data.fa) {
        const gm = d.mode === 'P' || d.mode === 'S';
        d.dist = gm ? { x: -9, z: -6 } : { x: 0, z: 0 };
        if (!gm && d.auto === 'rth') { d.auto = null; d.rthPhase = null; }
      }
      if (far(ctx, 160)) return 'fail:الدرون هرب بعيد وضاع';
    },
    cleanup(ctx) { ctx.drone.dist = { x: 0, z: 0 }; }
  });

  S.vrs = () => () => NEW({
    title: 'دوامة المراوح (VRS)', short: 'VRS',
    setup(ctx) { ctx.drone.setMode('S'); },
    steps: [
      SC.flyTo({ x: 0, z: -20, alt: 40, r: 6, label: '1' }),
      dec('أنت على 40 متر وتبي تنزل لتحت. وش أفضل طريقة؟',
        ['تنزل ببطء، أو تنزل مائل وهو يمشي شوي لقدام', 'تنزل عمودي بأقصى سرعة', 'تطفي المحركات وتخليه يطيح', 'تنزل وأنت تلف حول نفسك بسرعة'],
        'النزول العمودي السريع يدخله في دوامة هواء مراوحه (VRS) فيرتج ويطيح. لو صار، دفه لقدام عشان يطلع منها.'),
      SC.cond(c => !c.drone.onGround && c.drone.p.y < 6, 'أنت في Sport (نزوله سريع!). نزّل لين 5 متر: نزول بطيء أو مائل لقدام', { guide: c => ({ x: c.drone.p.x, z: c.drone.p.z - 8, alt: 4, speed: 4, vdown: 2.5 }) }),
      landHome(2)
    ],
    always(ctx, st) { const d = ctx.drone; if (d.vrs && !st.data.hit) { st.data.hit = true; st.pen += 35; tip(st, 'دخلت الدوامة! انزل ببطء أو مائل، وإذا ارتج دفه لقدام'); } },
    cleanup(ctx) { ctx.drone.setMode(ctx.session.def.mode || 'P'); }
  });

  S.orient = () => () => NEW({
    title: 'تلخبطت في الاتجاه', short: 'الاتجاه',
    steps: [
      SC.flyTo({ x: 25, z: -55, alt: 15, r: 5, label: '1' }),
      SC.cond(c => noseErr(c.drone) < U.rad(30), 'لف الدرون لين يصير وجهه لك (العصا اليسار يمين أو يسار)',
        { hold: 1, guide: c => ({ x: 25, z: -55, alt: 15, yaw: U.bearing(c.drone.p.x, c.drone.p.z, DS.PILOT.x, DS.PILOT.z) }) }),
      dec('الدرون بعيد ووجهه لك وتلخبطت في الحركات. وش أول شي تسويه؟',
        ['تترك العصي فيوقف (بوضع GPS)، تشوف الخريطة، وتلفه بهدوء لين يصير ظهره لك', 'تحرك العصي بسرعة وعشوائي', 'تحرك كل العصي مع بعض', 'تطفي الريموت'],
        'وقفه أول، بعدين صحح الاتجاه بهدوء. وتذكر: وجهه لك = الحركات معكوسة.'),
      SC.cond(c => tailErr(c.drone) < U.rad(25), 'لفه بهدوء لين يصير ظهره لك (شوف السهم في الخريطة الصغيرة)',
        { hold: 1, guide: c => ({ x: 25, z: -55, alt: 15, yaw: U.bearing(DS.PILOT.x, DS.PILOT.z, c.drone.p.x, c.drone.p.z) }) }),
      SC.flyTo({ x: 0, z: -12, alt: 6, r: 3, label: '2' }),
      landHome(2)
    ]
  });

  S.rain = () => () => NEW({
    title: 'بدأ المطر', short: 'المطر',
    steps: [
      SC.flyTo({ x: -20, z: -60, alt: 20, r: 5, label: '1' }),
      Object.assign(dec('بدأ المطر وأنت طاير. وش الصح؟',
        ['ترجع وتنزل فوراً', 'تكمل المهمة', 'تصعد فوق الغيم', 'تكمل لين يخف المطر'],
        'أغلب الدرونات مو ضد الموية. وبعد الهبوط نشفه وخله يجف كامل قبل الشحن.'),
      { enter(ctx, st, task) { ctx.R.add(task, { type: 'rain' }); ctx.msg('🌧️ بدأ المطر!', 'bad'); } }),
      landHome(2, { limit: 50, failMsg: 'تأخرت تحت المطر والدرون تعطل' })
    ]
  });

  S.critical = () => () => NEW({
    title: 'بطارية حرجة فوق الموية', short: 'البطارية الحرجة',
    setup(ctx, st, task) {
      ctx.R.add(task, { type: 'pond', x: 0, z: -45, r: 18 });
      ctx.env.isWater = (x, z) => U.dist2(x, z, 0, -45) < 18;
      st.map.push({ kind: 'pond', x: 0, z: -45, r: 18 });
    },
    steps: [
      SC.flyTo({ x: 0, z: -45, alt: 12, r: 4, label: '1', hint: () => 'روح فوق البحيرة للعلامة 1' }),
      Object.assign(dec('البطارية صارت حرجة والدرون بدأ ينزل لحاله فوق الموية! وش تسوي؟',
        ['توجهه لأقرب أرض يابسة وآمنة وهو نازل', 'تتركه ينزل مكانه', 'تحاول ترفعه وترجعه للبيت', 'تطفي الريموت'],
        'وهو نازل تقدر تحركه قدام وورا ويمين ويسار. وجهه لأقرب مكان آمن.'),
      { enter(ctx) { const d = ctx.drone; d.battery = 5.8; d.batWarned = { 30: 1, 15: 1, 6: 1 }; d.auto = 'forced'; d.rthPhase = null; d.emit('warn', 'البطارية خلصت — الدرون ينزل لحاله!'); } }),
      SC.cond(c => c.drone.onGround, 'حرّكه بالعصا اليمين لأرض يابسة (برا الموية) وهو نازل!',
        { guide: c => { const d = c.drone, a = U.bearing(0, -45, d.p.x, d.p.z); return { x: Math.sin(a) * 26, z: -45 - Math.cos(a) * 26, speed: 7 }; } }),
      SC.cond(c => !c.drone.motors, 'ممتاز ✓ نزل على اليابسة', { guide: () => ({ descend: true }) })
    ],
    cleanup(ctx) { ctx.env.isWater = null; ctx.drone.battery = Math.max(ctx.drone.battery, 60); ctx.drone.batWarned = {}; }
  });

  S.spoof = () => () => NEW({
    title: 'خداع إشارة الأقمار (عسكري)', short: 'GPS Spoofing',
    steps: [
      SC.flyTo({ x: 15, z: -50, alt: 15, r: 5, label: '1' }),
      Object.assign(dec('مكان الدرون في الخريطة قفز فجأة أكثر من 100 متر والدرون صار يتحرك لحاله. وش الصح؟',
        ['تحوله ATTI أو يدوي وتعتمد على نظرك والكاميرا وتبلغ، وما تضغط الرجوع للبيت', 'تثق بالخريطة وتكمل', 'تضغط الرجوع للبيت', 'تصعد أعلى'],
        'هذا خداع GPS (Spoofing). الرجوع للبيت يعتمد على الإشارة المخدوعة فيوديه للمكان الغلط.'),
      { enter(ctx, st) { st.data.sp = true; ctx.session.mapOffset = { x: 110, z: 40 }; ctx.drone.home = { x: -110, z: -40 }; ctx.msg('⚠️ قفزة غريبة في الخريطة!', 'bad'); } }),
      SC.cond(c => c.drone.mode === 'A', 'حوّله ATTI (السهم اليسار ◀) وطيّره بنظرك — لا تثق بالخريطة', { limit: 25, failMsg: 'الدرون انسحب بعيد', guide: () => ({ press: { LEFT: true } }) }),
      landHome(2.5, { hint: lh('الخريطة غلط! رجّعه بنظرك للمنصة H — ') })
    ],
    always(ctx, st, dt) {
      const d = ctx.drone;
      if (st.data.sp) {
        const gm = d.mode === 'P' || d.mode === 'S';
        d.dist = gm ? { x: -3, z: 2 } : { x: 0, z: 0 };
        if (d.auto === 'rth') { st.pen += 6 * dt; tip(st, 'لا تضغط الرجوع للبيت والإشارة مخدوعة'); if (!gm) { d.auto = null; d.rthPhase = null; } }
      }
      if (far(ctx, 160)) return 'fail:الدرون راح بعيد';
    },
    cleanup(ctx) { ctx.drone.dist = { x: 0, z: 0 }; ctx.drone.home = { x: 0, z: 0 }; ctx.session.mapOffset = null; }
  });

  DS.SCENARIOS = [
    { id: 'signal', icon: '📵', title: 'انقطاع الاتصال', desc: 'الإشارة تنقطع وأنت بعيد. وش تسوي؟ وبعدين استلم التحكم.' },
    { id: 'lowbat', icon: '🪫', title: 'بطارية ضعيفة وأنت بعيد', desc: 'تحذير بطارية والهواء ضدك في الرجعة.', wind: { s: 6, g: 1.5 } },
    { id: 'gps', icon: '📡', title: 'ضاع الـ GPS', desc: 'الدرون يصير ATTI وينجرف. رجعه بيدك.', wind: { s: 4.5, g: 1.5 } },
    { id: 'wind', icon: '🌬️', title: 'هواء قوي فوق', desc: 'الهواء يسحب الدرون بعيد. الحل تحت!' },
    { id: 'heli', icon: '🚁', title: 'طيارة فيها ناس تقرب', desc: 'هليكوبتر جاية صوبك. الأولوية لها.' },
    { id: 'bird', icon: '🦅', title: 'طير جارح يهاجم', desc: 'صقر يلاحق الدرون. كيف تنجو؟' },
    { id: 'people', icon: '🚶', title: 'ناس دخلوا المنطقة', desc: 'ناس يمرون تحت الدرون. لا تطير فوقهم.' },
    { id: 'rthtower', icon: '🏢', title: 'مبنى في طريق الرجوع', desc: 'الرجوع للبيت أوطى من المبنى. تصرف بسرعة!' },
    { id: 'toilet', icon: '🌀', title: 'دوائر تكبر (البوصلة)', desc: 'Toilet Bowl: الدرون يدور لحاله.' },
    { id: 'flyaway', icon: '🛸', title: 'الدرون هرب لحاله', desc: 'Fly-away: جرب الرجوع، وإذا ما نفع ATTI.' },
    { id: 'vrs', icon: '🌪️', title: 'دوامة المراوح (VRS)', desc: 'انزل من 40 متر بدون ما تطيح.' },
    { id: 'orient', icon: '🙃', title: 'تلخبطت في الاتجاه', desc: 'الدرون بعيد ووجهه لك. رجّعه صح.' },
    { id: 'rain', icon: '🌧️', title: 'بدأ المطر', desc: 'المطر بدأ وأنت بعيد.' },
    { id: 'critical', icon: '🌊', title: 'بطارية حرجة فوق الموية', desc: 'الدرون ينزل لحاله فوق بحيرة!' },
    { id: 'spoof', icon: '🛰️', title: 'خداع الأقمار (عسكري)', desc: 'الخريطة تكذب. طير بنظرك.', wind: { s: 3, g: 1 } }
  ];
  DS.scenarioDef = s => ({
    kind: 'scenario', id: s.id, key: 'scn:' + s.id, title: s.title, icon: s.icon, sub: 'سيناريو', desc: s.desc,
    mode: 'P', wind: s.wind || { s: 1.5, g: 0.5 }, fence: false, maxAlt: 120, tasks: [S[s.id]()], pass: { total: 60 }
  });

  // ---------------- دروس المبتدئ ----------------
  const C2 = SC.cond;
  const THR = () => DS.settings.stickMode === 1 ? 'العصا اليمين' : 'العصا اليسار';
  const PIT = () => DS.settings.stickMode === 1 ? 'العصا اليسار' : 'العصا اليمين';
  const holdPos = (st, d) => { if (st.data.hx == null) { st.data.hx = d.p.x; st.data.hz = d.p.z; } return { x: st.data.hx, z: st.data.hz }; };
  const CSC = st => st.stepT < 0.7 ? { raw: {} } : { raw: { thr: -1, pitch: -1, yaw: 1, roll: -1 } };
  const LES = (title, steps, extra) => () => new DS.ScenarioTask(Object.assign({ title, short: title, timeLimit: 99999, steps }, extra || {}));
  const stick = (k, sign, txt) => C2(c => sign * c.controls[k] > 0.7, txt, { hold: 0.3, guide: () => ({ raw: { [k]: sign } }) });

  DS.LESSONS = [
    { id: 'checklist', icon: '🧾', title: 'قبل ما تطير: الفحص', desc: 'أسئلة سريعة عن الفحص قبل الطيران وترتيب التشغيل.', task: () => DS.quizTask(6, ['preflight'], 'أسئلة الفحص قبل الطيران')() },
    { id: 'sticks', icon: '🕹️', title: 'تعرّف على العصي', desc: 'حرك كل عصا وشوف وش تسوي (المحركات طافية).', task: LES('تعرّف على العصي', [
      C2(c => c.controls.thr > 0.7, () => THR() + ' لفوق ⬆ = الارتفاع (الدرون يطلع)', { hold: 0.3, guide: () => ({ raw: { thr: 1 } }) }),
      C2(c => c.controls.thr < -0.7, () => THR() + ' لتحت ⬇ = الدرون ينزل', { hold: 0.3, guide: () => ({ raw: { thr: -1 } }) }),
      stick('yaw', 1, 'العصا اليسار يمين ➡ = يلف حول نفسه لليمين'),
      stick('yaw', -1, 'العصا اليسار يسار ⬅ = يلف حول نفسه لليسار'),
      C2(c => c.controls.pitch > 0.7, () => PIT() + ' لفوق ⬆ = يمشي لقدام', { hold: 0.3, guide: () => ({ raw: { pitch: 1 } }) }),
      C2(c => c.controls.pitch < -0.7, () => PIT() + ' لتحت ⬇ = يرجع ورا', { hold: 0.3, guide: () => ({ raw: { pitch: -1 } }) }),
      stick('roll', 1, 'العصا اليمين يمين ➡ = يمشي على جنبه يمين'),
      stick('roll', -1, 'العصا اليمين يسار ⬅ = يمشي على جنبه يسار')
    ]) },
    { id: 'motors', icon: '⚙️', title: 'تشغيل وإطفاء المحركات', desc: 'حركة CSC، والإطفاء بعصا الارتفاع، والإقلاع والهبوط التلقائي.', task: LES('تشغيل وإطفاء المحركات', [
      C2(c => c.drone.motors, 'شغّل المحركات (CSC): نزّل العصا اليسار لتحت-يمين والعصا اليمين لتحت-يسار مع بعض', { guide: (c, st) => CSC(st) }),
      C2(c => !c.drone.motors, 'ممتاز ✓ المحركات شغالة. الحين طفّها بنفس الحركة (CSC)', { guide: (c, st) => CSC(st) }),
      C2(c => c.drone.motors, 'شغّلها مرة ثانية بنفس الحركة', { guide: (c, st) => CSC(st) }),
      C2(c => !c.drone.motors, () => 'اترك العصي، بعدين نزّل ' + THR() + ' لتحت وخلها 3 ثواني — المحركات تطفي لحالها', { guide: (c, st) => st.stepT < 0.7 ? { raw: {} } : { raw: { thr: -1 } } }),
      C2(c => !c.drone.onGround && c.drone.p.y > 1, 'اضغط A مطوّل (ثانية) — إقلاع تلقائي', { guide: () => ({ holdA: true }) }),
      C2(c => c.drone.onGround && !c.drone.motors, 'وهو طاير اضغط A مطوّل مرة ثانية — هبوط تلقائي، وخله ينزل لين تطفي المحركات',
        { guide: c => (!c.drone.onGround && c.drone.auto !== 'land') ? { holdA: true } : { none: true } })
    ]) },
    { id: 'takeoff', icon: '🛫', title: 'الإقلاع والهبوط', desc: 'أقلع بيدك لين 3 متر، اثبت، وانزل بهدوء.', task: LES('الإقلاع والهبوط', [
      C2(c => c.drone.motors, 'شغّل المحركات (CSC) أو اضغط A مطوّل', { guide: (c, st) => CSC(st) }),
      C2(c => c.drone.p.y >= 2.6, () => 'ارفع ' + THR() + ' شوي شوي لين توصل 3 متر (شوف الرقم H تحت)', { guide: (c, st) => Object.assign(holdPos(st, c.drone), { alt: 3 }) }),
      C2(c => !c.drone.onGround && Math.abs(c.drone.p.y - 3) < 1.5, 'اترك العصي واثبت 5 ثواني', { hold: 5, guide: (c, st) => Object.assign(holdPos(st, c.drone), { alt: 3 }) }),
      C2(c => c.drone.onGround, () => 'نزّل ' + THR() + ' بشويش لين يلمس الأرض', { guide: () => ({ descend: true }) }),
      C2(c => !c.drone.motors, () => 'خل ' + THR() + ' تحت لين تطفي المحركات', { guide: () => ({ descend: true }) })
    ]) },
    { id: 'yaw', icon: '🔁', title: 'اللف حول النفس', desc: 'لف يمين ويسار، وخل وجه الدرون لك وظهره لك.', task: LES('اللف حول النفس', [
      C2(c => !c.drone.onGround && c.drone.p.y > 2.5, 'أقلع لـ 3 متر (A مطوّل أو CSC وارفع العصا)', { guide: (c, st) => Object.assign(holdPos(st, c.drone), { alt: 3 }) }),
      { enter(c, st) { st.data.acc = 0; st.data.last = c.drone.yaw; }, tick(c, st) { st.data.acc += U.wrap(c.drone.yaw - st.data.last); st.data.last = c.drone.yaw; return st.data.acc >= Math.PI * 2 * 0.92 ? 'next' : null; },
        hint: (c, st) => 'لف يمين لفة كاملة (العصا اليسار يمين) — ' + Math.round(U.clamp(st.data.acc / (Math.PI * 2), 0, 1) * 100) + '%', guide: c => ({ x: c.drone.p.x, z: c.drone.p.z, alt: 3, yaw: c.drone.yaw + 0.8 }) },
      { enter(c, st) { st.data.acc = 0; st.data.last = c.drone.yaw; }, tick(c, st) { st.data.acc += U.wrap(c.drone.yaw - st.data.last); st.data.last = c.drone.yaw; return st.data.acc <= -Math.PI * 2 * 0.92 ? 'next' : null; },
        hint: (c, st) => 'الحين لف يسار لفة كاملة (العصا اليسار يسار) — ' + Math.round(U.clamp(-st.data.acc / (Math.PI * 2), 0, 1) * 100) + '%', guide: c => ({ x: c.drone.p.x, z: c.drone.p.z, alt: 3, yaw: c.drone.yaw - 0.8 }) },
      C2(c => noseErr(c.drone) < U.rad(20), 'لف لين يصير وجهه لك (النور الأحمر قدام الدرون)', { hold: 1.5, guide: c => ({ x: c.drone.p.x, z: c.drone.p.z, alt: 3, yaw: U.bearing(c.drone.p.x, c.drone.p.z, DS.PILOT.x, DS.PILOT.z) }) }),
      C2(c => tailErr(c.drone) < U.rad(20), 'ورجّعه لين يصير ظهره لك (النور الأخضر ورا)', { hold: 1.5, guide: c => ({ x: c.drone.p.x, z: c.drone.p.z, alt: 3, yaw: U.bearing(DS.PILOT.x, DS.PILOT.z, c.drone.p.x, c.drone.p.z) }) }),
      landHome(3)
    ]) },
    { id: 'move', icon: '➡️', title: 'قدام وورا وجنب', desc: 'روح للعلامات بالعصا اليمين بدون ما تلف الدرون.', task: LES('قدام وورا وجنب', [
      SC.flyTo({ x: 0, z: -20, alt: 3, r: 2.5, label: '1', hint: () => 'روح قدام للعلامة 1 (' + PIT() + ' لفوق)' }),
      SC.flyTo({ x: 12, z: -20, alt: 3, r: 2.5, label: '2', hint: () => 'روح جنب يمين للعلامة 2 (العصا اليمين يمين)' }),
      SC.flyTo({ x: 12, z: -8, alt: 3, r: 2.5, label: '3', hint: () => 'ارجع ورا للعلامة 3 (' + PIT() + ' لتحت) — لا تلف الدرون' }),
      SC.flyTo({ x: 0, z: -8, alt: 3, r: 2.5, label: '4', hint: () => 'روح جنب يسار للعلامة 4 (العصا اليمين يسار)' }),
      landHome(2)
    ]) },
    { id: 'modes', icon: '🎛️', title: 'الأوضاع: C و N و S و ATTI', desc: 'الأسهم فوق/تحت ▲▼ = C (هادي) / N (عادي) / S (سريع). السهم اليسار ◀ = ATTI يمشي مع الريح.', wind: { s: 3.5, g: 0.6 }, task: LES('الأوضاع C و N و S و ATTI', [
      C2(c => !c.drone.onGround && c.drone.p.y > 3, 'أقلع لـ 4 متر', { guide: (c, st) => Object.assign(holdPos(st, c.drone), { alt: 4 }) }),
      C2(c => c.drone.mode === 'S', 'اضغط السهم فوق ▲ — وضع S (سريع وحساس، للريح القوية)', { guide: () => ({ press: { UP: true } }) }),
      C2(c => c.drone.mode === 'C', 'الحين اضغط السهم تحت ▼ مرتين — وضع C (هادي وناعم، للتصوير)', { guide: () => ({ press: { DOWN: true } }) }),
      C2(c => c.drone.mode === 'P', 'اضغط السهم فوق ▲ مرة — رجعت N (العادي)', { guide: () => ({ press: { UP: true } }) }),
      C2(c => !c.drone.onGround, 'اترك العصي 5 ثواني: شوف كيف يثبت بمكانه رغم الريح (وضع N)', { hold: 5, guide: () => ({ raw: {} }) }),
      C2(c => c.drone.mode === 'A', 'اضغط السهم اليسار ◀ عشان تغير لوضع ATTI', { guide: () => ({ press: { LEFT: true } }) }),
      C2(c => !c.drone.onGround, 'اترك العصي 5 ثواني: شوف كيف يمشي مع الريح!', { hold: 5, guide: () => ({ raw: {} }) }),
      SC.flyTo({ x: 0, z: -12, alt: 4, r: 3, label: '★', hint: () => 'رجّعه بيدك للعلامة ★ وصحح الانجراف بالعصا اليمين' }),
      C2(c => !c.drone.onGround && U.dist2(c.drone.p.x, c.drone.p.z, 0, -12) < 3.5, 'اثبت قريب من العلامة 5 ثواني (صحح الانجراف بحركات صغيرة)', { hold: 5, guide: () => ({ x: 0, z: -12, alt: 4 }) }),
      C2(c => c.drone.mode === 'P', 'اضغط السهم اليسار ◀ مرة ثانية عشان يرجع N', { guide: () => ({ press: { LEFT: true } }) }),
      landHome(2.5, { hint: lh('شفت الفرق؟ في N يثبت لحاله ✓ الحين هبط — ') })
    ]) },
    { id: 'smart', icon: '🤖', title: 'الأزرار الذكية', desc: 'إقلاع تلقائي (A مطوّل)، توقف (X)، رجوع للبيت (B مطوّل)، هبوط تلقائي (A مطوّل).', task: LES('الأزرار الذكية', [
      C2(c => !c.drone.onGround && c.drone.p.y > 1, 'اضغط A مطوّل (ثانية) — إقلاع تلقائي', { guide: () => ({ holdA: true }) }),
      SC.flyTo({ x: 0, z: -25, alt: 8, r: 4, label: '1', hint: () => 'طر للعلامة 1 (25 متر قدام)' }),
      C2(c => c.drone.paused, 'اضغط X — توقف (Flight Pause): الدرون يفرمل ويثبت مكانه لين تحرك العصي', { guide: () => ({ press: { X: true } }) }),
      C2(c => c.drone.auto === 'rth', 'اضغط B مطوّل (ثانية) — الرجوع للبيت', { guide: () => ({ hold: { B: 1.2 } }) }),
      C2(c => c.drone.onGround && !c.drone.motors, 'خله يرجع ويهبط لحاله… (تقدر تلغيه بضغطة B)', { guide: () => ({ none: true }) }),
      C2(c => !c.drone.onGround && c.drone.p.y > 1, 'اضغط A مطوّل — إقلاع', { guide: () => ({ holdA: true }) }),
      C2(c => c.drone.auto === 'land', 'وهو طاير اضغط A مطوّل — هبوط تلقائي', { guide: c => c.drone.p.y > 1.1 ? { holdA: true } : { none: true } }),
      C2(c => !c.drone.motors, 'خله ينزل لين تطفي المحركات', { guide: () => ({ none: true }) })
    ]) },
    { id: 'camera', icon: '🎥', title: 'الكاميرات والعرض', desc: 'غيّر الكاميرا (Y)، كاميرا الدرون (LB)، تحريك الكاميرا (LT/RT)، التصوير (RB)، القياسات (VIEW).', task: LES('الكاميرات والعرض', [
      C2(c => c.session.viewCount >= 1, 'اضغط Y عشان تغير الكاميرا', { guide: () => ({ press: { Y: true } }) }),
      C2(c => c.session.viewsSeen.size >= 4 && c.session.view === 'pilot', 'كمّل اضغط Y وجرب كل الكاميرات لين ترجع لعين الطيار', { guide: () => ({ press: { Y: true } }) }),
      C2(c => c.session.pipToggles >= 1, 'الشاشة الصغيرة هي كاميرا الدرون. اضغط LB عشان تخفيها', { guide: () => ({ press: { LB: true } }) }),
      C2(c => c.session.pip, 'اضغط LB مرة ثانية عشان ترجعها', { guide: () => ({ press: { LB: true } }) }),
      C2(c => !c.drone.onGround && c.drone.p.y > 2.5, 'أقلع لـ 3 متر', { guide: (c, st) => Object.assign(holdPos(st, c.drone), { alt: 3 }) }),
      C2(c => c.session.gimbal < -40, 'اضغط الزناد LT (يسار) عشان تنزّل الكاميرا وتشوف تحت', { guide: () => ({ raw: { lt: 1 } }) }),
      C2(c => c.session.gimbal > -12, 'واضغط RT (يمين) عشان ترفعها', { guide: () => ({ raw: { rt: 1 } }) }),
      C2(c => c.session.shots >= 1, 'اضغط RB — تصوير 📸 (نفس زر التصوير في ريموت DJI)', { guide: () => ({ press: { RB: true } }) }),
      C2(c => c.session.showTelem, 'اضغط VIEW (الزر الصغير يسار) — يطلع لك القياسات (السرعة والارتفاع والإشارة)', { guide: () => ({ press: { VIEW: true } }) }),
      C2(c => !c.session.showTelem, 'اضغط VIEW مرة ثانية عشان تخفيها (VIEW مطوّل = ضوء الوميض للطيران بالليل)', { guide: () => ({ press: { VIEW: true } }) }),
      landHome(2.5)
    ]) }
  ];
  DS.lessonDef = l => ({
    kind: 'lesson', id: l.id, key: 'les:' + l.id, title: l.title, icon: l.icon, sub: 'درس', desc: l.desc,
    mode: 'P', wind: l.wind || { s: 0.5, g: 0.2 }, fence: false, maxAlt: 120, tasks: [typeof l.task === 'function' && l.task.length === 0 && l.id === 'checklist' ? () => l.task() : l.task], pass: { total: 0 }
  });
})();
