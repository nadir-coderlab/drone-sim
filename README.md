# 🚁 محاكي الدرون

محاكي تدريب على طيران الدرون، **بالعربي** ويشتغل من المتصفح:

- **كورس تعليمي** من الصفر (15 وحدة): العصي، الإقلاع والهبوط، الثبات، الاتجاهات، الأوضاع C/N/S و ATTI، الريح، الرجوع للبيت والطوارئ، التصوير، و FPV.
- **تدريب احترافي** بخمس مستويات، **سيناريوهات طوارئ**، **اختبارات عملية**، و**طيران حر** (درون تصوير مثل DJI Mini أو درون FPV).
- **📍 أكاديمية طويق — خريطة حقيقية 3D**: طيران حر فوق المكان الحقيقي (يحتاج نت).
- **اختبار نظري**: 60 سؤال في 60 دقيقة + تدريب ومصطلحات.

> ⚠️ **مشروع شخصي غير رسمي — مو تابع لأكاديمية طويق**، ولا لـ DJI ولا لقوقل ولا لأي جهة حكومية.
> هو للتدريب والتعلم بس، وما يغني عن التدريب الرسمي. بالطيران الحقيقي التزم بأنظمة الهيئة العامة للطيران المدني (تسجيل الدرون والتصاريح).

---

## كيف تفتحه

### 💻 بالكمبيوتر
- افتح رابط الموقع بكروم أو إيدج (أو افتح ملف `index.html` مباشرة — كل شي يشتغل إلا الخريطة الحقيقية والتثبيت).
- تطير بيد **إكس بوكس / بلايستيشن** (وصّلها واضغط أي زر فيها)، أو بالكيبورد.

### 📱 بالجوال
1. افتح الرابط بـ **كروم** (أندرويد) أو **سفاري** (آيفون).
2. **لفّ الجوال بالعرض** وقت الطيران.
3. تطير بـ **العصي اللي على الشاشة**: العصا اليسار تحت يسار، واليمين تحت يمين. حط إبهامك بأي مكان تحت وحرّكه، وإذا فكيته يرجع للنص (درون التصوير يثبت مكانه).
4. **يد التحكم مع الجوال:** وصّل يد إكس بوكس أو بلايستيشن بالبلوتوث واضغط أي زر فيها — تشتغل على طول، وأزرار الشاشة تختفي لحالها.
5. **التثبيت (مثل التطبيق، ويفتح بدون نت):**
   - أندرويد: زر «📲 ثبّت على الجوال» بشاشة البداية، أو قائمة كروم ⋮ ← «تثبيت التطبيق».
   - آيفون: زر **شارك** ⬆️ ← **أضف للشاشة الرئيسية**.

### 📺 بالتلفزيون (Android TV)
تطبيق التلفزيون في مجلد `android\` — طريقة البناء والتثبيت في `android\README-ar.md`.

---

## الأزرار

| وش يسوي | باللمس (الجوال) | إكس بوكس | بلايستيشن | الكيبورد |
|---|---|---|---|---|
| الارتفاع + اللف (Mode 2) | العصا اليسار | العصا اليسار | العصا اليسار | W/S + A/D |
| قدام/ورا + جنب | العصا اليمين | العصا اليمين | العصا اليمين | الأسهم |
| إقلاع / هبوط تلقائي | A مطوّل | A مطوّل | ✕ مطوّل | Space مطوّل |
| الرجوع للبيت (RTH) • ضغطة = إلغاء | B مطوّل | B مطوّل | ○ مطوّل | R أو B |
| وقوف بالجو (Flight Pause) | X | X | □ | M أو X |
| الكاميرا (مطوّل = حراري) | Y | Y | △ | C |
| الأوضاع C / N / S | ▲ ▼ | ▲ ▼ | ▲ ▼ | I / K |
| ATTI • بلاغ | ◀ • ▶ | ◀ • ▶ | ◀ • ▶ | J • L |
| الشاشة الصغيرة • تصوير | LB • RB | LB • RB | L1 • R1 | U • O |
| الكاميرا تحت / فوق | LT / RT | LT / RT | L2 / R2 | Q / E |
| القياسات (مطوّل = ضوء الوميض) | 📊 | VIEW | Create | V |
| إيقاف وقائمة | ☰ (فوق يسار) | ☰ Start | Options | Esc أو P |

تقدر تغيّر Mode 1/2 وأزرار اللمس (تلقائي / دايم / طافية) من **الإعدادات ← التحكم**.

---

## النشر على GitHub Pages
1. ارفع المجلد كمستودع (الملف `.nojekyll` موجود عشان GitHub ينشر الملفات كما هي).
2. **Settings ← Pages** ← اختر الفرع والمجلد الرئيسي (root).
3. الرابط يصير مثل: `https://<اسمك>.github.io/<اسم-المستودع>/`
4. **كل ما تحدّث الموقع غيّر `VERSION` في `sw.js`** (أي نص جديد) عشان الجوالات تاخذ النسخة الجديدة.
5. مفتاح خرائط قوقل في `js/config.js`: خلّه مقفول من Google Cloud على **دومين موقعك بس** (HTTP referrer) وعلى **Map Tiles API بس**. أي أحد يقدر يحط مفتاحه الخاص من الإعدادات ← الشاشة (يتخزن بجهازه بس).

## الملفات
- `index.html` — الصفحة (وكل التنسيق) • `js/` — المحاكي (فيزياء، دروس، قوائم، لمس…) • `lib/` — المكتبات
- `manifest.webmanifest` + `sw.js` + `icons/` — التثبيت على الجوال والتشغيل بدون نت
- `android/` — تطبيق التلفزيون

## شكر وحقوق
- [three.js](https://threejs.org/) — رخصة MIT.
- [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) — رخصة Apache-2.0. و [Draco](https://github.com/google/draco) (فك ضغط المجسمات) — رخصة Apache-2.0.
- **Google Maps Platform — Photorealistic 3D Tiles**: بيانات الخريطة © Google (وأصحابها المذكورين على الشاشة وقت الطيران). الاستخدام حسب شروط Google Maps Platform.
- بيانات المباني والطرق: **© OpenStreetMap contributors** — رخصة ODbL.

---

## English (short)

**Drone Simulator** — an Arabic-first, browser-based drone flight trainer: a 15-unit flight course, pro exercises, emergency
scenarios, practical exams, free flight (DJI Mini-style camera drone and 5" FPV), a 60-question theory exam, and free flight over a
real 3D map of the Tuwaiq Academy area.

- **PC:** open the site (or `index.html`) in Chrome/Edge; Xbox/PlayStation controller or keyboard.
- **Phone:** open the link in Chrome (Android) or Safari (iOS), hold it in landscape, fly with the on-screen sticks — or pair an
  Xbox/PS controller over Bluetooth (touch controls hide automatically). Installable as a PWA and works offline after the first visit
  (the real 3D map needs internet).
- **Android TV:** see `android/`.
- **Publishing:** GitHub Pages from the repository root (`.nojekyll` included). Bump `VERSION` in `sw.js` on every release.

*Personal, unofficial project — not affiliated with Tuwaiq Academy, DJI, Google or any government body. For practice only.*

Credits: three.js (MIT), 3d-tiles-renderer (Apache-2.0), Draco decoder (Apache-2.0), Google Maps Photorealistic 3D Tiles
(map data © Google), building/road data © OpenStreetMap contributors (ODbL).
