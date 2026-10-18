// الدرجات + المهام + الاختبارات العملية
(function () {
  const DS = window.DS, U = DS.U;

  DS.DIFF = {
    easy: { id: 'easy', name: 'سهل', wind: 0.8, gust: 0.3, mode: 'P', tol: 1.6, hold: 0.8, head: 45, color: '#22c55e', note: 'هواء خفيف • وضع N • مساحة كبيرة' },
    medium: { id: 'medium', name: 'متوسط', wind: 3, gust: 1.0, mode: 'P', tol: 1.25, hold: 1.0, head: 35, color: '#eab308', note: 'هواء متوسط • وضع N' },
    hard: { id: 'hard', name: 'صعب', wind: 4.5, gust: 1.8, mode: 'A', tol: 1.0, hold: 1.2, head: 28, color: '#f97316', note: 'هواء قوي • وضع ATTI (الدرون ينجرف)' },
    pro: { id: 'pro', name: 'محترف', wind: 6.5, gust: 2.6, mode: 'A', tol: 0.75, hold: 1.5, head: 22, color: '#ef4444', note: 'هواء قوي وهبات • ATTI • دقة عالية' }
  };
  DS.DIFF_ORDER = ['easy', 'medium', 'hard', 'pro'];

  const H = o => () => new DS.HoverTask(o);
  const C = o => () => new DS.CourseTask(o);
  const O = o => () => new DS.OrbitTask(o);
  const L = o => () => new DS.LandingTask(o);
  DS.mk = { H, C, O, L };

  // ---- أشكال المسارات ----
  const BOX = [[-10, -10], [-10, -30], [10, -30], [10, -10], [-10, -10]];
  const NOSEIN = [[0, -45], [-10, -37], [10, -29], [-10, -21], [0, -13]];
  const EIGHT = [[0, -28], [9, -37], [18, -28], [9, -19], [0, -28], [-9, -37], [-18, -28], [-9, -19], [0, -28]];
  const GATES = [[0, -18, 4], [-14, -38, 6], [0, -58, 8], [18, -42, 5], [10, -20, 3]];
  const pts = (arr, alt, r) => arr.map(([x, z]) => ({ x, z, alt, r }));
  const gates = (R) => {
    let px = 0, pz = 0;
    return GATES.map(([x, z, alt]) => { const yaw = U.bearing(px, pz, x, z); px = x; pz = z; return { x, z, alt, gate: true, R, yaw }; });
  };

  // ---- مهام الطيران ----
  const T = DS.TASKS = {
    hover: D => H({ title: 'أقلع واثبت داخل العمود', short: 'الثبات', x: 0, z: -12, r: 1.2 * D.tol, rv: 0.6 * D.tol, steps: [{ alt: 3, hold: Math.round(20 * D.hold) }], timeLimit: 150 + 60 * D.hold }),
    orient: D => H({ title: 'الثبات بأربع اتجاهات', short: 'الاتجاهات الأربعة', x: 0, z: -12, r: 1.4 * D.tol, rv: 0.7 * D.tol, headTol: D.head,
      steps: ['tail', 'right', 'nose', 'left'].map(h => ({ alt: 3, hold: Math.round(8 * D.hold), head: h })), timeLimit: 240 + 60 * D.hold }),
    box: D => C({ title: 'المربع ووجهه لقدام', short: 'المربع', pts: pts(BOX, 5, 2 * D.tol), altTol: 1.5 * D.tol, nose: 'fixed', fixedYaw: 0, headTol: D.head + 5, par: 75, timeLimit: 300 }),
    boxyaw: D => C({ title: 'المربع مع اللف', short: 'المربع مع اللف', pts: pts(BOX, 5, 2 * D.tol), altTol: 1.5 * D.tol, nose: 'forward', headTol: D.head + 10, par: 90, timeLimit: 320 }),
    nosein: D => C({ title: 'الوجه لك (الحركات معكوسة)', short: 'الوجه لك', pts: pts(NOSEIN, 6, 2.4 * D.tol), altTol: 1.6 * D.tol, nose: 'noseIn', headTol: D.head + 10, par: 70, timeLimit: 300 }),
    eight: D => C({ title: 'رقم 8 حول العمودين', short: 'رقم 8', pts: pts(EIGHT, 5, 2.6 * D.tol), altTol: 1.6 * D.tol, nose: D.id === 'easy' ? 'any' : 'forward', headTol: D.head + 15, par: 95, timeLimit: 360, pylons: [{ x: -9, z: -28, h: 8 }, { x: 9, z: -28, h: 8 }] }),
    orbit: D => O({ title: 'الدوران حول التمثال ووجهه عليه', short: 'الدوران حول نقطة', x: 0, z: -30, R: 10, band: 2.2 * D.tol, alt: 6, altTol: 1.6 * D.tol, headTol: D.head + 5, deg: 360, timeLimit: 300 }),
    vertical: D => H({ title: 'الصعود والنزول بدقة', short: 'الصعود والنزول', x: 0, z: -12, r: 1.8 * D.tol, rv: 0.8 * D.tol,
      steps: [{ alt: 3, hold: 4 }, { alt: 20, hold: 5 }, { alt: 8, hold: 5 }, { alt: 2, hold: 4 }], timeLimit: 260 }),
    landPad: D => L({ title: 'اهبط على المنصة البعيدة', short: 'الهبوط الدقيق', x: 14, z: -28, r: 1.2 * D.tol, maxVs: 1.2, label: '1', timeLimit: 200 }),
    landHome: D => L({ title: 'ارجع واهبط على منصة البيت H', short: 'الهبوط على H', x: 0, z: 0, r: 1.0 * D.tol, maxVs: 1.2, home: true, timeLimit: 200 }),
    gates: D => C({ title: 'مسار البوابات', short: 'البوابات', pts: gates(1.6 * D.tol), altTol: 3, nose: D.id === 'easy' ? 'any' : 'forward', headTol: 60, par: 70, timeLimit: 300 }),
    slalom: D => C({ title: 'بين العواميد (سلالوم)', short: 'بين العوائق', pts: [[-5, -15], [5, -27], [-5, -39], [5, -51], [0, -62]].map(([x, z]) => ({ x, z, alt: 3, r: Math.min(3.2, 2 * D.tol) })),
      altTol: 1.5 * D.tol, nose: D.id === 'easy' ? 'any' : 'forward', headTol: 55, par: 60, timeLimit: 300, pylons: [-15, -27, -39, -51].map(z => ({ x: 0, z, h: 7 })) }),
    rth: D => () => {
      const cancel = D.id === 'hard' || D.id === 'pro';
      const steps = [
        DS.SC.flyTo({ x: 0, z: -55, alt: 12, r: 4, label: '1' }),
        DS.SC.cond(c => c.drone.auto === 'rth', 'اضغط B مطوّل (ثانية) — الرجوع للبيت (RTH)', { guide: () => ({ hold: { B: 1.2 } }) })
      ];
      if (cancel) {
        steps.push(DS.SC.cond(c => c.drone.auto === 'rth' && U.dist2(c.drone.p.x, c.drone.p.z, 0, 0) < 25, 'خله يرجع… وانتبه للتعليمات', { guide: () => ({ none: true }) }));
        steps.push(DS.SC.cond(c => c.drone.auto !== 'rth', 'الحين ألغِ الرجوع: اضغط B ضغطة وحدة واستلم التحكم', { guide: () => ({ press: { B: true } }) }));
        steps.push(DS.SC.land({ x: 0, z: 0, r: 1.0 * D.tol, home: true }));
      } else {
        steps.push(DS.SC.cond(c => c.drone.onGround && !c.drone.motors, 'الدرون يرجع ويهبط لحاله… (تقدر تلغيه بضغطة B بس لا تلغيه الحين)', { guide: () => ({ none: true }) }));
      }
      return new DS.ScenarioTask({ title: cancel ? 'الرجوع للبيت ثم إلغاؤه والهبوط بيدك' : 'الرجوع للبيت', short: 'الرجوع للبيت', steps, timeLimit: 300 });
    }
  };

  // ---- قائمة المهام ----
  DS.MISSIONS = [
    { id: 'hover', icon: '🎯', title: 'الثبات في الهوا', desc: 'أقلع واثبت داخل العمود الملوّن بدون ما تطلع منه.', tasks: ['hover'] },
    { id: 'orient', icon: '🧭', title: 'الثبات بأربع اتجاهات', desc: 'اثبت وظهره لك، ثم وجهه يمين، ثم وجهه لك، ثم يسار.', tasks: ['orient'] },
    { id: 'box', icon: '⬛', title: 'المربع', desc: 'مربع 20×20 متر ووجه الدرون ثابت لقدام (تحرك بالعصا اليمين بس).', tasks: ['box'] },
    { id: 'boxyaw', icon: '🔄', title: 'المربع مع اللف', desc: 'نفس المربع بس وجه الدرون يلف مع الطريق في كل زاوية.', tasks: ['boxyaw'] },
    { id: 'nosein', icon: '🙃', title: 'الوجه لك', desc: 'رجّع الدرون صوبك ووجهه لك بخط متعرج — الحركات معكوسة!', tasks: ['nosein'] },
    { id: 'eight', icon: '♾️', title: 'رقم 8', desc: 'طر شكل رقم 8 حول العمودين بدون ما تلمسهم.', tasks: ['eight'] },
    { id: 'orbit', icon: '🌀', title: 'الدوران حول نقطة', desc: 'لف لفة كاملة حول التمثال ووجه الدرون عليه طول الوقت.', tasks: ['orbit'] },
    { id: 'vertical', icon: '↕️', title: 'الصعود والنزول', desc: 'اثبت على ارتفاعات مختلفة: 3 ثم 20 ثم 8 ثم 2 متر.', tasks: ['vertical'] },
    { id: 'landing', icon: '🛬', title: 'الهبوط الدقيق', desc: 'اهبط على منصة بعيدة، وبعدين ارجع واهبط على H.', tasks: ['landPad', 'landHome'] },
    { id: 'gates', icon: '🏁', title: 'مسار البوابات', desc: 'ادخل من 5 بوابات على ارتفاعات مختلفة.', tasks: ['gates'] },
    { id: 'slalom', icon: '🌲', title: 'بين العوائق', desc: 'طر بين العواميد يمين ويسار بدون ما تخبط.', tasks: ['slalom'] },
    { id: 'rth', icon: '🏠', title: 'الرجوع للبيت', desc: 'استخدم RTH (B مطوّل). وفي الصعب والمحترف: ألغه بضغطة B وهبط بيدك.', tasks: ['rth'] }
  ];

  // تحويل مهمة + درجة إلى جلسة
  DS.missionDef = function (m, diffId) {
    const D = DS.DIFF[diffId];
    return {
      kind: 'mission', id: m.id, key: m.id + ':' + diffId, title: m.title, icon: m.icon, sub: 'درجة: ' + D.name, desc: m.desc,
      diff: diffId, mode: D.mode, modeLocked: D.mode === 'A', wind: { s: D.wind, g: D.gust }, fence: true, maxAlt: 60,
      tasks: m.tasks.map(k => T[k](D)), pass: { total: 60 }
    };
  };

  // ---- الاختبارات العملية ----
  const quiz = (n, topics, title) => () => new DS.ScenarioTask({
    title: title || 'أسئلة قبل الطيران', short: 'أسئلة قبل الطيران', quiz: true, timeLimit: 9999,
    steps: DS.pickQuestions(n, topics, true).map(q => ({ decide: q }))
  });
  DS.quizTask = quiz;
  const custom = (D, over) => Object.assign({}, D, over);
  DS.FLIGHT_EXAMS = [
    { id: 'basic', icon: '🥉', title: 'الاختبار العملي الأساسي', desc: 'وضع N وهواء خفيف: أسئلة قبل الطيران، الثبات، المربع، الوجه لك، الهبوط الدقيق، الرجوع للبيت.',
      mode: 'P', wind: { s: 2, g: 0.8 }, pass: { total: 70, each: 40 },
      tasks: () => { const D = custom(DS.DIFF.medium, { tol: 1.3 });
        return [quiz(6, ['preflight', 'controls', 'modes']), T.hover(custom(D, { hold: 0.75 })), T.box(D), T.nosein(D), T.landPad(custom(D, { tol: 0.85 })), T.rth(DS.DIFF.easy)]; } },
    { id: 'advanced', icon: '🥈', title: 'الاختبار العملي المتقدم', desc: 'وضع ATTI وهواء متوسط: أسئلة سيناريوهات، الاتجاهات الأربعة، المربع مع اللف، رقم 8، الدوران، الهبوط الدقيق.',
      mode: 'A', modeLocked: true, wind: { s: 4, g: 1.5 }, pass: { total: 75, each: 50 },
      tasks: () => { const D = custom(DS.DIFF.hard, { tol: 1.1 });
        return [quiz(8, ['scenarios', 'modes', 'weather']), T.orient(custom(D, { hold: 1 })), T.boxyaw(D), T.eight(D), T.orbit(D), T.landPad(custom(D, { tol: 0.7 }))]; } },
    { id: 'pro', icon: '🥇', title: 'الاختبار الاحترافي', desc: 'ATTI وهواء قوي بهبات + طوارئ: فقدان GPS وانقطاع الإشارة، بوابات، ودقة عالية جداً.',
      mode: 'A', modeLocked: true, wind: { s: 6, g: 2.5 }, pass: { total: 80, each: 60 },
      tasks: () => { const D = custom(DS.DIFF.pro, { tol: 0.85 });
        return [quiz(10, null), T.orient(custom(D, { hold: 1.25 })), T.eight(D), T.orbit(D), T.gates(D),
          DS.SCN_TASKS.gps({ padR: 2 }), DS.SCN_TASKS.signal({ padR: 1.6 }), T.landPad(custom(D, { tol: 0.55 }))]; } }
  ];
  DS.examDef = function (e) {
    return {
      kind: 'exam', id: e.id, key: 'exam:' + e.id, title: e.title, icon: e.icon, sub: 'اختبار عملي', desc: e.desc,
      mode: e.mode, modeLocked: !!e.modeLocked, wind: e.wind, fence: true, maxAlt: 60, tasks: e.tasks(), pass: e.pass
    };
  };

  // اختيار أسئلة من البنك (مع خلط الخيارات)
  DS.shuffleQ = function (q) {
    const idx = U.pick(q.a.map((_, i) => i), q.a.length);
    return Object.assign({}, q, { a: idx.map(i => q.a[i]), c: idx.indexOf(q.c) });
  };
  DS.pickQuestions = function (n, topics, arabicOnly) {
    let pool = DS.QB.filter(q => (!topics || topics.includes(q.t)) && (!arabicOnly || q.lang === 'ar'));
    return U.pick(pool, Math.min(n, pool.length)).map(DS.shuffleQ);
  };
})();
