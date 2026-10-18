// الاختبار النظري: اختبار تجريبي كامل + تدريب + أخطائي + بطاقات المصطلحات
(function () {
  const DS = window.DS, U = DS.U, UI = DS.UI, esc = DS.esc;
  const $ = id => document.getElementById(id);
  const L_AR = ['أ', 'ب', 'ج', 'د'], L_EN = ['A', 'B', 'C', 'D'];
  const qid = q => q.gen ? null : q.lang + ':' + q.q;

  const T = DS.Theory = {
    stats: U.load('theory', { history: [], wrong: {}, flash: {} }),
    save() { U.save('theory', this.stats); },
    resetStats() { this.stats = { history: [], wrong: {}, flash: {} }; this.save(); },
    cur: null,

    // ---- بناء اختبار 60 سؤال مثل الحقيقي ----
    buildExam(n) {
      n = n || 60;
      const k = n / 60;
      const quota = { basics: 5, controls: 5, modes: 5, preflight: 4, weather: 5, scenarios: 7, safety: 4, military: 3, fixedwing: 1, english: 1 };
      const ar = [], en = [];
      for (const t in quota) ar.push(...U.pick(DS.QB.filter(q => q.t === t && q.lang === 'ar'), Math.max(1, Math.round(quota[t] * k))));
      const nCalc = Math.max(1, Math.round(5 * k)), nEn = Math.max(2, Math.round(15 * k));
      for (let i = 0; i < nCalc; i++) { const g = DS.genCalc(); if (g) (g.lang === 'en' ? en : ar).push(g); }
      en.push(...U.pick(DS.QB.filter(q => q.lang === 'en'), Math.max(0, nEn - en.length)));
      while (ar.length + en.length > n) (ar.length > en.length * 2 ? ar : en).pop();
      while (ar.length + en.length < n) { const g = DS.genCalc(); if (g) ar.push(g); }
      const qs = U.pick(ar, ar.length).concat(U.pick(en, en.length)).map(DS.shuffleQ);
      return qs;
    },
    startExam(n, minutes) {
      const qs = this.buildExam(n);
      this.cur = { mode: 'exam', qs, ans: qs.map(() => -1), flag: qs.map(() => false), i: 0, start: Date.now(), dur: (minutes || 60) * 60, done: false, nAr: qs.filter(q => q.lang === 'ar').length };
      UI.show('thExam');
    },
    remaining() { const c = this.cur; return Math.max(0, c.dur - (Date.now() - c.start) / 1000); },
    submit() {
      const c = this.cur; if (!c || c.done) return;
      c.done = true; c.used = Math.min(c.dur, (Date.now() - c.start) / 1000);
      let right = 0; const by = {};
      c.qs.forEach((q, i) => {
        const ok = c.ans[i] === q.c; if (ok) right++;
        const t = q.lang === 'en' ? 'english_sec' : q.t;
        by[t] = by[t] || [0, 0]; by[t][1]++; if (ok) by[t][0]++;
        this.markResult(q, ok);
      });
      c.right = right; c.by = by;
      this.stats.history.unshift({ date: Date.now(), right, total: c.qs.length, used: Math.round(c.used), by });
      this.stats.history = this.stats.history.slice(0, 30);
      this.save();
      UI.show('thResult');
    },
    markResult(q, ok) {
      const id = qid(q); if (!id) return;
      const w = this.stats.wrong;
      if (!ok) w[id] = (w[id] || 0) + 1; else if (w[id]) { w[id]--; if (w[id] <= 0) delete w[id]; }
    },
    wrongQs() { const set = this.stats.wrong; return DS.QB.filter(q => set[qid(q)]); },
    historyRows() {
      const h = this.stats.history; if (!h.length) return '';
      return '<table class="tbl"><tr><th>التاريخ</th><th>الدرجة</th><th>النسبة</th><th>الوقت</th></tr>' + h.slice(0, 8).map(x =>
        '<tr><td>' + new Date(x.date).toLocaleDateString('ar-SA') + '</td><td>' + x.right + '/' + x.total + '</td><td class="' + (x.right / x.total >= 0.85 ? 'ok' : x.right / x.total >= 0.7 ? 'warn' : 'bad') + '">' + Math.round(100 * x.right / x.total) + '%</td><td>' + U.mmss(x.used) + '</td></tr>').join('') + '</table>';
    },
    verdict(p) {
      if (p >= 0.85) return ['ok', '✅ جاهز للاختبار! استمر على المراجعة الخفيفة'];
      if (p >= 0.7) return ['warn', '🟡 قريب! راجع الأقسام اللي درجتها أقل وحل "أخطائي"'];
      return ['bad', '🔴 تحتاج مذاكرة أكثر: ابدأ بالتدريب حسب القسم وبطاقات المصطلحات'];
    }
  };
  DS.theoryStats = () => { const h = T.stats.history; if (!h.length) return ''; const best = h.reduce((a, x) => Math.max(a, x.right / x.total), 0); return 'أفضل: ' + Math.round(best * 100) + '%'; };

  const head = (title, sub) => '<div class="head"><h2>' + title + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>';
  const S = UI.screens;

  S.theoryHome = () => {
    const nWrong = Object.keys(T.stats.wrong).length;
    const last = T.stats.history[0];
    const c = (act, arg, ic, t, d, extra, cls) => '<button class="btn card ' + (cls || '') + '" data-act="' + act + '" data-arg="' + arg + '"><span class="ic">' + ic + '</span><span class="tt">' + t + '</span><span class="ds">' + d + '</span>' + (extra || '') + '</button>';
    return {
      cls: 'menu',
      html: head('📘 الاختبار النظري', '60 سؤال • 60 دقيقة • بعض الأسئلة بالإنجليزي • مرة وحدة بدون إعادة' + (last ? ' • آخر نتيجة: ' + last.right + '/' + last.total : '')) +
        '<div class="grid">' +
        c('exam', '60', '📝', 'اختبار تجريبي كامل', '60 سؤال في 60 دقيقة بنفس طريقة الاختبار الحقيقي', '', 'hl') +
        c('exam', '15', '⚡', 'اختبار سريع', '15 سؤال في 15 دقيقة') +
        c('topics', '', '📚', 'تدريب حسب القسم', 'سؤال سؤال مع الشرح على طول') +
        c('wrong', '', '🔁', 'أخطائي', nWrong ? nWrong + ' سؤال غلطت فيه — عيدها لين تتقنها' : 'ما فيه أخطاء محفوظة للحين', nWrong ? '<span class="badge bad">' + nWrong + '</span>' : '') +
        c('flash', '', '🃏', 'بطاقات المصطلحات', DS.GLOSS.length + ' مصطلح بالإنجليزي مع النطق والمعنى') +
        c('tips', '', '💡', 'نصائح يوم الاختبار', 'طريقة الحل + التعليمات المهمة') +
        '</div><div class="row"><button class="btn" data-act="back">↩ رجوع (B)</button></div>',
      acts: {
        exam: n => UI.show('thIntro', +n), topics: () => UI.show('thTopics'),
        wrong: () => { if (nWrong) T.startPractice(T.wrongQs().map(DS.shuffleQ), 'أخطائي', true); },
        flash: () => UI.show('thFlashCats'), tips: () => UI.show('thTips'), back: () => UI.show('main')
      },
      back: () => UI.show('main')
    };
  };

  S.thIntro = (n) => ({
    cls: 'menu brief',
    html: head(n === 60 ? '📝 اختبار تجريبي كامل' : '⚡ اختبار سريع', n + ' سؤال • ' + n + ' دقيقة') +
      '<ul class="rules"><li>القسم الأول بالعربي، والقسم الثاني بالإنجليزي (بدون ترجمة مثل الحقيقي)</li><li>تقدر تتنقل بين الأسئلة وتغير جوابك قبل التسليم</li><li>لما يخلص الوقت يتسلم الاختبار لحاله</li><li>بعد التسليم تطلع لك النتيجة وتقدر تراجع كل سؤال مع الشرح</li></ul>' +
      '<div class="tipbox">🎮 أعلى/أسفل = تختار • A = تجاوب • LB/RB = السابق/التالي • Y = علّم للمراجعة • X = قائمة الأسئلة • ☰ = تسليم<br>⌨️ 1-4 = الجواب • الأسهم • Enter • F = علّم</div>' +
      '<div class="row"><button class="btn big default" data-act="go">ابدأ الاختبار ▶</button><button class="btn" data-act="back">↩ رجوع</button></div>',
    acts: { go: () => T.startExam(n, n), back: () => UI.show('theoryHome') },
    back: () => UI.show('theoryHome')
  });

  S.thExam = () => {
    const c = T.cur, q = c.qs[c.i], en = q.lang === 'en', L = en ? L_EN : L_AR;
    const answered = c.ans.filter(a => a >= 0).length;
    const sec = c.i < c.nAr ? 'القسم الأول (عربي)' : 'Section 2 (English)';
    const opts = q.a.map((a, j) => '<button class="btn opt ' + (c.ans[c.i] === j ? 'sel' : '') + (c.ans[c.i] === j ? ' default' : '') + '" data-act="ans" data-arg="' + j + '" dir="' + (en ? 'ltr' : 'rtl') + '"><b>' + L[j] + '</b> ' + esc(a) + '</button>').join('');
    return {
      cls: 'menu exam',
      html: '<div class="exbar"><span>📝 سؤال <b>' + (c.i + 1) + '</b> من ' + c.qs.length + '</span><span class="sec">' + sec + '</span><span>✔ ' + answered + '/' + c.qs.length + '</span><span id="thTimer" class="timer">⏳ ' + U.mmss(T.remaining()) + '</span></div>' +
        '<div class="q big" dir="' + (en ? 'ltr' : 'rtl') + '">' + (c.flag[c.i] ? '🚩 ' : '') + esc(q.q) + '</div><div class="opts1">' + opts + '</div>' +
        '<div class="row nav"><button class="btn" data-act="prev" ' + (c.i === 0 ? 'disabled' : '') + '>→ السابق (LB)</button>' +
        '<button class="btn" data-act="flag">' + (c.flag[c.i] ? '🚩 شيل العلامة' : '🚩 علّم') + ' (Y)</button>' +
        '<button class="btn" data-act="grid">☷ الأسئلة (X)</button>' +
        (c.i < c.qs.length - 1 ? '<button class="btn" data-act="next">التالي ← (RB)</button>' : '') +
        '<button class="btn submit" data-act="submit">تسليم (☰)</button></div>',
      acts: {
        ans: j => { c.ans[c.i] = +j; if (c.i < c.qs.length - 1) { c.i++; } UI.show('thExam'); },
        prev: () => { if (c.i > 0) { c.i--; UI.show('thExam'); } },
        next: () => { if (c.i < c.qs.length - 1) { c.i++; UI.show('thExam'); } },
        flag: () => { c.flag[c.i] = !c.flag[c.i]; UI.show('thExam'); },
        grid: () => UI.show('thGrid'), submit: () => UI.show('thSubmit')
      },
      onButton: k => {
        if (k === 'LB' && c.i > 0) { c.i--; UI.show('thExam'); }
        else if (k === 'RB' && c.i < c.qs.length - 1) { c.i++; UI.show('thExam'); }
        else if (k === 'Y') { c.flag[c.i] = !c.flag[c.i]; UI.show('thExam'); }
        else if (k === 'X') UI.show('thGrid');
        else if (k === 'START') UI.show('thSubmit');
      },
      onDigit: j => { if (j < q.a.length) { c.ans[c.i] = j; if (c.i < c.qs.length - 1) c.i++; UI.show('thExam'); } },
      bind() {
        if (T._timer) return;
        T._timer = setInterval(() => {   // العداد يشتغل حتى لو كنت في قائمة الأسئلة
          const cc = T.cur;
          if (!cc || cc.mode !== 'exam' || cc.done) { clearInterval(T._timer); T._timer = null; return; }
          const r = T.remaining(), el = $('thTimer');
          if (el) { el.textContent = '⏳ ' + U.mmss(r); el.classList.toggle('low', r < 300); }
          if (r <= 0) { clearInterval(T._timer); T._timer = null; T.submit(); }
        }, 500);
      },
      back: () => UI.show('thQuit')
    };
  };

  S.thGrid = () => {
    const c = T.cur;
    return {
      cls: 'menu',
      html: head('☷ قائمة الأسئلة', '🟩 جاوبته • ⬜ ما جاوبته • 🚩 معلّم') + '<div class="qgrid">' +
        c.qs.map((q, i) => '<button class="btn qn ' + (c.ans[i] >= 0 ? 'done' : '') + (c.flag[i] ? ' flag' : '') + (i === c.i ? ' default' : '') + '" data-act="go" data-arg="' + i + '">' + (i + 1) + '</button>').join('') +
        '</div><div class="row"><button class="btn" data-act="back">↩ رجوع للسؤال</button><button class="btn submit" data-act="submit">تسليم</button></div>',
      acts: { go: i => { c.i = +i; UI.show('thExam'); }, back: () => UI.show('thExam'), submit: () => UI.show('thSubmit') },
      back: () => UI.show('thExam')
    };
  };

  S.thSubmit = () => {
    const c = T.cur, left = c.ans.filter(a => a < 0).length, fl = c.flag.filter(Boolean).length;
    return {
      overlay: true, cls: 'menu small',
      html: '<div class="q">' + (left ? '⚠️ باقي <b>' + left + '</b> سؤال بدون جواب.<br>' : '✅ جاوبت كل الأسئلة.<br>') + (fl ? '🚩 عندك ' + fl + ' سؤال معلّم.<br>' : '') + 'بعد التسليم ما تقدر ترجع. متأكد؟</div>' +
        '<div class="row"><button class="btn" data-act="yes">نعم، سلّم</button><button class="btn default" data-act="no">لا، رجعني</button></div>',
      acts: { yes: () => T.submit(), no: () => UI.show('thExam') }, back: () => UI.show('thExam')
    };
  };

  S.thQuit = () => ({
    overlay: true, cls: 'menu small',
    html: '<div class="q">تبي تطلع من الاختبار؟ ما راح تنحسب لك نتيجة.</div><div class="row"><button class="btn" data-act="yes">اطلع</button><button class="btn default" data-act="no">كمّل الاختبار</button></div>',
    acts: { yes: () => { clearInterval(T._timer); T._timer = null; T.cur = null; UI.show('theoryHome'); }, no: () => UI.show('thExam') }, back: () => UI.show('thExam')
  });

  S.thResult = () => {
    const c = T.cur, p = c.right / c.qs.length, [vc, vt] = T.verdict(p);
    const names = Object.assign({}, DS.TOPICS, { english_sec: 'القسم الإنجليزي' });
    const bars = Object.keys(c.by).sort((a, b) => c.by[a][0] / c.by[a][1] - c.by[b][0] / c.by[b][1]).map(t => {
      const [r, n] = c.by[t], pp = Math.round(100 * r / n);
      return '<div class="bar2"><span>' + (names[t] || t) + '</span><div><i class="' + (pp >= 85 ? 'ok' : pp >= 70 ? 'warn' : 'bad') + '" style="width:' + pp + '%"></i></div><b>' + r + '/' + n + '</b></div>';
    }).join('');
    return {
      cls: 'menu result',
      html: head('📝 نتيجة الاختبار', 'الوقت: ' + U.mmss(c.used) + ' من ' + U.mmss(c.dur)) +
        '<div class="score">' + c.right + '<small>/' + c.qs.length + '</small> <span class="pct ' + vc + '">' + Math.round(p * 100) + '%</span></div>' +
        '<div class="res ' + vc + '">' + vt + '</div><h3>الأقسام (الأضعف فوق)</h3><div class="bars">' + bars + '</div>' +
        '<div class="row"><button class="btn big default" data-act="review">🔍 راجع إجاباتي</button><button class="btn" data-act="wrong">🔍 الغلط بس</button><button class="btn" data-act="again">🔄 اختبار جديد</button><button class="btn" data-act="home">↩ القائمة</button></div>',
      acts: {
        review: () => { c.ri = 0; c.onlyWrong = false; UI.show('thReview'); },
        wrong: () => { c.ri = 0; c.onlyWrong = true; UI.show('thReview'); },
        again: () => UI.show('thIntro', c.qs.length), home: () => UI.show('theoryHome')
      },
      back: () => UI.show('theoryHome')
    };
  };

  S.thReview = () => {
    const c = T.cur;
    const list = c.qs.map((q, i) => i).filter(i => !c.onlyWrong || c.ans[i] !== c.qs[i].c);
    if (!list.length) return { cls: 'menu', html: head('🔍 المراجعة', 'ما عندك ولا غلطة 🎉') + '<div class="row"><button class="btn default" data-act="back">↩ رجوع</button></div>', acts: { back: () => UI.show('thResult') }, back: () => UI.show('thResult') };
    c.ri = U.clamp(c.ri || 0, 0, list.length - 1);
    const i = list[c.ri], q = c.qs[i], en = q.lang === 'en', L = en ? L_EN : L_AR, a = c.ans[i];
    const opts = q.a.map((x, j) => '<div class="opt rv ' + (j === q.c ? 'right' : j === a ? 'wrong' : '') + '" dir="' + (en ? 'ltr' : 'rtl') + '"><b>' + L[j] + '</b> ' + esc(x) + (j === q.c ? ' ✔' : j === a ? ' ✘' : '') + '</div>').join('');
    return {
      cls: 'menu exam',
      html: '<div class="exbar"><span>🔍 مراجعة ' + (c.ri + 1) + ' من ' + list.length + '</span><span>سؤال رقم ' + (i + 1) + '</span><span class="' + (a === q.c ? 'ok' : 'bad') + '">' + (a === q.c ? '✅ صح' : a < 0 ? '⬜ ما جاوبته' : '❌ غلط') + '</span></div>' +
        '<div class="q big" dir="' + (en ? 'ltr' : 'rtl') + '">' + esc(q.q) + '</div>' + (q.tr ? '<p class="tr">المعنى: ' + esc(q.tr) + '</p>' : '') +
        '<div class="opts1">' + opts + '</div><div class="fb">💡 ' + esc(q.ex || '') + '</div>' +
        '<div class="row nav"><button class="btn" data-act="prev" ' + (c.ri === 0 ? 'disabled' : '') + '>→ السابق</button><button class="btn default" data-act="next" ' + (c.ri >= list.length - 1 ? 'disabled' : '') + '>التالي ←</button><button class="btn" data-act="back">↩ النتيجة</button></div>',
      acts: { prev: () => { c.ri--; UI.show('thReview'); }, next: () => { c.ri++; UI.show('thReview'); }, back: () => UI.show('thResult') },
      onButton: k => { if (k === 'LB' && c.ri > 0) { c.ri--; UI.show('thReview'); } if (k === 'RB' && c.ri < list.length - 1) { c.ri++; UI.show('thReview'); } },
      back: () => UI.show('thResult')
    };
  };

  // ---- التدريب سؤال سؤال ----
  T.startPractice = function (qs, title, fromWrong) {
    this.cur = { mode: 'practice', qs, i: 0, chosen: -1, right: 0, done: 0, title, fromWrong, showTr: false };
    UI.show('thPractice');
  };
  S.thTopics = () => {
    const btn = (arg, ic, t, n) => '<button class="btn card" data-act="go" data-arg="' + arg + '"><span class="ic">' + ic + '</span><span class="tt">' + t + '</span><span class="ds">' + n + '</span></button>';
    const count = t => DS.QB.filter(q => q.t === t).length;
    const icons = { basics: '🧩', controls: '🕹️', modes: '🎛️', preflight: '🧾', weather: '🌦️', scenarios: '⚠️', safety: '🛡️', military: '🎖️', fixedwing: '✈️', calc: '🧮', english: '🔤' };
    return {
      cls: 'menu',
      html: head('📚 تدريب حسب القسم', 'كل سؤال تجاوبه يطلع لك الصح والشرح على طول') + '<div class="grid">' +
        btn('all', '🎲', 'خليط من كل الأقسام', DS.QB.length + ' سؤال') +
        btn('en', '🇬🇧', 'الأسئلة الإنجليزية بس', DS.QB.filter(q => q.lang === 'en').length + ' سؤال') +
        btn('gen', '🧮', 'حسابات بأرقام جديدة', 'سرعة • ارتفاع • اتجاهات • بطارية') +
        Object.keys(DS.TOPICS).map(t => btn(t, icons[t] || '•', DS.TOPICS[t], count(t) + ' سؤال')).join('') +
        '</div><div class="row"><button class="btn" data-act="back">↩ رجوع</button></div>',
      acts: {
        go: a => {
          let qs;
          if (a === 'all') qs = U.pick(DS.QB, 40);
          else if (a === 'en') qs = U.pick(DS.QB.filter(q => q.lang === 'en'), 30);
          else if (a === 'gen') { qs = []; for (let i = 0; i < 20; i++) { const g = DS.genCalc(); if (g) qs.push(g); } }
          else qs = U.pick(DS.QB.filter(q => q.t === a), 30);
          T.startPractice(qs.map(DS.shuffleQ), a === 'all' ? 'خليط' : a === 'en' ? 'الإنجليزي' : a === 'gen' ? 'الحسابات' : DS.TOPICS[a]);
        },
        back: () => UI.show('theoryHome')
      },
      back: () => UI.show('theoryHome')
    };
  };
  S.thPractice = () => {
    const c = T.cur;
    if (c.i >= c.qs.length) {
      return {
        cls: 'menu result', html: head('🏁 خلصت التدريب: ' + esc(c.title), '') + '<div class="score">' + c.right + '<small>/' + c.done + '</small></div>' +
          '<div class="row"><button class="btn big default" data-act="again">🔄 أسئلة ثانية</button><button class="btn" data-act="home">↩ رجوع</button></div>',
        acts: { again: () => UI.show(c.fromWrong ? 'theoryHome' : 'thTopics'), home: () => UI.show('theoryHome') }, back: () => UI.show('theoryHome')
      };
    }
    const q = c.qs[c.i], en = q.lang === 'en', L = en ? L_EN : L_AR, ans = c.chosen >= 0;
    const opts = q.a.map((a, j) => {
      const cls = ans ? (j === q.c ? 'right' : j === c.chosen ? 'wrong' : 'dim') : '';
      return '<button class="btn opt ' + cls + '" data-act="ans" data-arg="' + j + '" ' + (ans ? 'disabled' : '') + ' dir="' + (en ? 'ltr' : 'rtl') + '"><b>' + L[j] + '</b> ' + esc(a) + '</button>';
    }).join('');
    return {
      cls: 'menu exam',
      html: '<div class="exbar"><span>📚 ' + esc(c.title) + '</span><span>سؤال ' + (c.i + 1) + ' من ' + c.qs.length + '</span><span class="ok">✔ ' + c.right + '/' + c.done + '</span>' + (en && q.tr ? '<button class="btn chip" data-act="tr">' + (c.showTr ? 'إخفاء الترجمة' : 'الترجمة (Y)') + '</button>' : '') + '</div>' +
        '<div class="q big" dir="' + (en ? 'ltr' : 'rtl') + '">' + esc(q.q) + '</div>' + (en && q.tr && (c.showTr || ans) ? '<p class="tr">المعنى: ' + esc(q.tr) + '</p>' : '') +
        '<div class="opts1">' + opts + '</div>' +
        (ans ? '<div class="fb ' + (c.chosen === q.c ? 'ok' : 'bad') + '">' + (c.chosen === q.c ? '✅ صح!' : '❌ غلط') + ' — ' + esc(q.ex || '') + '</div><div class="row"><button class="btn big default" data-act="next">التالي ▶ (A)</button><button class="btn" data-act="home">إنهاء</button></div>' :
          '<div class="row"><button class="btn" data-act="home">إنهاء</button></div>'),
      acts: {
        ans: j => { c.chosen = +j; c.done++; const ok = c.chosen === q.c; if (ok) { c.right++; DS.Audio.ok(); } else DS.Audio.fail(); T.markResult(q, ok); T.save(); UI.show('thPractice'); },
        next: () => { c.i++; c.chosen = -1; UI.show('thPractice'); },
        tr: () => { c.showTr = !c.showTr; UI.show('thPractice'); },
        home: () => UI.show('theoryHome')
      },
      onDigit: j => { if (!ans && j < q.a.length) UI.cur.acts.ans(j); },
      onButton: k => { if (k === 'Y' && en && q.tr) { c.showTr = !c.showTr; UI.show('thPractice'); } },
      back: () => UI.show('theoryHome')
    };
  };

  // ---- بطاقات المصطلحات ----
  S.thFlashCats = () => {
    const known = T.stats.flash;
    const cnt = cat => { const all = DS.GLOSS.filter(g => !cat || g[3] === cat); return all.filter(g => (known[g[0]] || {}).k >= 2).length + '/' + all.length; };
    const btn = (arg, t) => '<button class="btn card" data-act="go" data-arg="' + arg + '"><span class="tt">' + t + '</span><span class="ds">حفظت ' + cnt(arg) + '</span></button>';
    return {
      cls: 'menu',
      html: head('🃏 بطاقات المصطلحات', 'تشوف الكلمة بالإنجليزي ونطقها، تتذكر المعنى، وبعدين تقلب البطاقة') + '<div class="grid">' +
        btn('', '🎲 كل المصطلحات') + Object.keys(DS.GLOSS_CATS).map(k => btn(k, DS.GLOSS_CATS[k])).join('') +
        '</div><div class="row"><button class="btn" data-act="back">↩ رجوع</button></div>',
      acts: { go: cat => T.startFlash(cat), back: () => UI.show('theoryHome') },
      back: () => UI.show('theoryHome')
    };
  };
  T.startFlash = function (cat) {
    const deck = U.pick(DS.GLOSS.filter(g => !cat || g[3] === cat), 999)
      .sort((a, b) => ((this.stats.flash[a[0]] || {}).k || 0) - ((this.stats.flash[b[0]] || {}).k || 0));
    this.cur = { mode: 'flash', deck, i: 0, flip: false, known: 0, rev: false, cat };
    UI.show('thFlash');
  };
  S.thFlash = () => {
    const c = T.cur;
    if (c.i >= c.deck.length) return {
      cls: 'menu result', html: head('🏁 خلصت البطاقات', 'عرفت ' + c.known + ' من ' + c.deck.length) + '<div class="row"><button class="btn big default" data-act="again">🔄 مرة ثانية</button><button class="btn" data-act="home">↩ رجوع</button></div>',
      acts: { again: () => T.startFlash(c.cat), home: () => UI.show('thFlashCats') }, back: () => UI.show('thFlashCats')
    };
    const g = c.deck[c.i], st = T.stats.flash[g[0]] || { k: 0, u: 0 };
    const front = c.rev ? '<div class="fc-ar">' + esc(g[2]) + '</div>' : '<div class="fc-en" dir="ltr">' + esc(g[0]) + '</div><div class="fc-pr">🔊 ' + esc(g[1]) + '</div>';
    const back = c.rev ? '<div class="fc-en" dir="ltr">' + esc(g[0]) + '</div><div class="fc-pr">🔊 ' + esc(g[1]) + '</div>' : '<div class="fc-ar">' + esc(g[2]) + '</div>';
    const mark = ok => { const s = T.stats.flash[g[0]] = T.stats.flash[g[0]] || { k: 0, u: 0 }; if (ok) { s.k++; c.known++; } else { s.u++; s.k = 0; c.deck.splice(Math.min(c.deck.length, c.i + 4), 0, g); } T.save(); c.i++; c.flip = false; UI.show('thFlash'); };
    return {
      cls: 'menu flash',
      html: '<div class="exbar"><span>🃏 ' + (c.i + 1) + ' / ' + c.deck.length + '</span><span>' + (DS.GLOSS_CATS[g[3]] || '') + '</span><span class="ok">✔ ' + c.known + '</span><button class="btn chip" data-act="rev">' + (c.rev ? 'عربي ← إنجليزي' : 'إنجليزي ← عربي') + '</button></div>' +
        '<button class="btn fcard ' + (c.flip ? 'flipped default' : 'default') + '" data-act="flip">' + front + (c.flip ? '<hr>' + back : '<div class="fc-hint">اضغط A عشان تقلب البطاقة</div>') + '</button>' +
        (c.flip ? '<div class="row"><button class="btn bad" data-act="no">✗ ما عرفتها (LB)</button><button class="btn ok" data-act="yes">✓ عرفتها (RB)</button></div>' : '') +
        '<div class="row"><button class="btn" data-act="home">إنهاء</button></div>',
      acts: { flip: () => { c.flip = !c.flip; UI.show('thFlash'); }, yes: () => mark(true), no: () => mark(false), rev: () => { c.rev = !c.rev; c.flip = false; UI.show('thFlash'); }, home: () => UI.show('thFlashCats') },
      onButton: k => { if (c.flip && k === 'RB') mark(true); else if (c.flip && k === 'LB') mark(false); else if (k === 'Y') { c.rev = !c.rev; c.flip = false; UI.show('thFlash'); } },
      back: () => UI.show('thFlashCats')
    };
  };

  S.thTips = () => ({
    cls: 'menu brief',
    html: head('💡 نصائح يوم الاختبار', '') +
      '<ul class="rules">' +
      ['الوقت: 60 سؤال في 60 دقيقة = دقيقة لكل سؤال. لا تعلق في سؤال؛ علّمه وارجع له.',
        'اقرأ السؤال كامل، ودوّر على الكلمات اللي تقلب المعنى: NOT • EXCEPT • FIRST • BEST.',
        'في أسئلة السيناريو اختار الأأمن: الناس أول، ثم الطيارات اللي فيها بشر، ثم الدرون.',
        'اشطب الغلط الواضح: «تجاهل» أو «كمّل عادي» أو «طفّ الريموت» أو «اطلع أعلى وقت الهواء القوي» غالباً غلط.',
        'بالإنجليزي: لا تترجم كل كلمة. دوّر على الكلمات اللي تعرفها واربطها.',
        'قبل التسليم: تأكد إنك جاوبت كل الأسئلة. بعد التسليم ما تقدر ترجع.',
        'الليلة اللي قبل: نام بدري، وجهّز الجهاز والشاحن والنت، وادخل قبل 10 دقائق بمكان هادي ولحالك.'].map(t => '<li>' + t + '</li>').join('') + '</ul>' +
      '<div class="tipbox warnbox">⚠️ <b>مهم جداً:</b> وقت الاختبار الحقيقي سكّر هذا المحاكي وكل البرامج والصفحات الثانية. ولا تستخدم أي ذكاء اصطناعي أو إضافات للمتصفح. الدليل الرسمي يقول إن أي مخالفة تلغي النتيجة وتستبعدك نهائياً. هذا المحاكي للمذاكرة قبل الاختبار بس.</div>' +
      '<div class="row"><button class="btn default" data-act="back">↩ رجوع</button></div>',
    acts: { back: () => UI.show('theoryHome') }, back: () => UI.show('theoryHome')
  });
})();
