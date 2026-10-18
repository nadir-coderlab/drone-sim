# محاكي الدرون على التلفزيون (بوكس شاومي / Android TV)

هذا الملف يشرح لك خطوة بخطوة كيف تشغّل المحاكي على بوكس التلفزيون وتطيّر بيد إكس بوكس أو بلايستيشن.
التطبيق صغير (حوالي 1 إلى 2 ميقا) ويشتغل بدون نت.

> ✅ **الخطوة 1 والخطوة 2 خلصناها لك:** الأدوات منزّلة في `C:\tools`، وملف التطبيق جاهز هنا: `android\DroneSim.apk`.
> ابدأ من **الخطوة 3**. (الخطوتين 1 و 2 تحتاجها بس لو نقلت المحاكي لكمبيوتر ثاني.)

**باختصار:**

1. جهّز الكمبيوتر مرة وحدة (تنزيل الأدوات).
2. سوّ ملف التطبيق `DroneSim.apk`.
3. جهّز البوكس (خيارات المطوّر).
4. اربط اليد بالبوكس.
5. ثبّت التطبيق (أول مرة بس).
6. شغّله واضغط **A**.
7. **التحديثات بعدين:** ضغطة وحدة في الكمبيوتر والتطبيق يحدّث نفسه، **بدون ما تحذفه** (شوف قسم «التحديث بدون ما تحذف التطبيق» تحت).

---

## وش تحتاج؟

### البوكس: أي واحد أحسن؟

| البوكس | رأينا |
|---|---|
| **Xiaomi TV Box S الجيل الثالث (2025)** | الأفضل. أقوى رسوميات، ونظامه Google TV 14 |
| **Xiaomi TV Box S الجيل الثاني** | ممتاز. يمشي سلس على الجودة المنخفضة والمتوسطة |
| Xiaomi TV Stick 4K | ما ننصح فيه: معالجه ضعيف وما فيه منفذ USB |
| Mi Box S القديم (2018) | يشتغل، بس على 30 إطار وجودة منخفضة |

تبي تعرف وش عندك؟ الإعدادات ← النظام (أو تفضيلات الجهاز) ← حول.

### اليد (الكنترولر)

- **إكس بوكس (الأضمن):** موديل **1914** (حق Series X|S) أو **1708** (حق One S). رقم الموديل مكتوب داخل غطاء البطارية. الموديلات القديمة 1537 و 1697 ما فيها بلوتوث.
- **بلايستيشن 5 (DualSense):** تشتغل على أندرويد 12 وفوق. الأزرار الضاغطة الذكية (Adaptive triggers) ما تشتغل على أندرويد.
- **بلايستيشن 4 (DualShock 4):** تشتغل على أندرويد 10 وفوق.

### الكمبيوتر

ويندوز 10 أو 11، ونت لأول مرة بس (تنزيل حوالي 330 ميقا).

---

## الخطوة 1: جهّز الكمبيوتر (مرة وحدة بس)

1. افتح مجلد المحاكي، وبعدين مجلد `android`.
2. اضغط على شريط العنوان فوق في مستكشف الملفات، اكتب `powershell` واضغط Enter. بتنفتح نافذة زرقا أو سودا.
3. انسخ هالأمر والصقه فيها واضغط Enter:

   ```
   powershell -ExecutionPolicy Bypass -File .\tools\setup-toolchain.ps1
   ```

4. بيطلع لك قائمة باللي بينزل وحجم كل ملف. اكتب `y` واضغط Enter.
5. الأدوات تنحط في `C:\tools` (جافا + أدوات أندرويد + ملف الرسم three.js). تنزيلها يعني إنك موافق على رخصة أدوات أندرويد من قوقل.

> إذا كانت الأدوات موجودة من قبل، السكربت يقول لك وما ينزّل شي.

---

## الخطوة 2: سوّ ملف التطبيق

في نفس النافذة (داخل مجلد `android`):

```
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

- **مفتاح التوقيع موجود عندك من قبل**، وكلمة سره محفوظة في ملف، فالبناء ما يسألك عن شي.
  (لو كان جهاز جديد بدون مفتاح: أول مرة بس يطلب كلمة سر جديدة، ويحفظها لحاله.)
- المفتاح وكلمة سره في المجلد `C:\Users\اسمك\.dronesim\` (ملفين: `dronesim-release.keystore` و `keystore-password.txt`).
  **خذ نسخة من هالمجلد كامل** على فلاش أو Google Drive.
  ليش؟ كل تحديث لازم ينوقّع بنفس المفتاح. إذا ضاع، ما تقدر تحدّث التطبيق، ولازم تحذفه وتنزله من جديد ويضيع تقدّمك.
- البناء يتأكد لحاله إن المفتاح هو نفسه (الملف `android\signing-cert.txt`). لو حطيت مفتاح ثاني بالغلط، **يوقف** ويقول لك «المفتاح غلط»، عشان ما تخرب التحديث.
- الناتج: الملف `android\DroneSim.apk`.
- بعد ما تثبّت التطبيق أول مرة، ما تحتاج هالخطوة للتحديثات: استخدم «التحديث بدون ما تحذف التطبيق» تحت.

---

## الخطوة 3: جهّز البوكس

### أ) فعّل خيارات المطوّر

- **Android TV** (Mi Box S و Stick 4K): الإعدادات ← تفضيلات الجهاز (Device Preferences) ← حول (About) ← انزل لين "الإصدار" (Build) واضغط OK في الريموت **7 مرات** لين يقول لك "صرت مطوّر".
- **Google TV** (Box S الجيل الثاني والثالث): الإعدادات ← النظام (System) ← حول (About) ← "إصدار نظام Android TV" (Android TV OS build) واضغط OK **7 مرات**.

بعدها افتح **خيارات المطوّر** (Developer options) وشغّل **تصحيح أخطاء USB** (USB debugging).
مكانها: في Android TV تحت تفضيلات الجهاز، وفي Google TV تحت النظام.

### ب) اسمح بتثبيت التطبيقات من برا المتجر

- **Android TV:** الإعدادات ← تفضيلات الجهاز ← الأمان والقيود (Security & restrictions) ← مصادر غير معروفة (Unknown sources) ← شغّلها للتطبيق اللي بتثبّت منه.
- **Google TV:** الإعدادات ← التطبيقات (Apps) ← الأمان والقيود ← مصادر غير معروفة. (في بعض الأجهزة تلقاها تحت "الخصوصية")

> إذا بتثبّت من الكمبيوتر بالطريقة (ج) تحت، ما تحتاج هالخطوة.

---

## الخطوة 4: اربط اليد بالبوكس

مكان الربط في البوكس:

- **Android TV:** الإعدادات ← أجهزة التحكم والملحقات (Remotes & Accessories) ← إضافة ملحق (Add accessory).
- **Google TV:** الإعدادات ← أجهزة التحكم والملحقات ← ربط جهاز تحكم أو ملحق (Pair remote or accessory).

### يد إكس بوكس

1. **حدّثها أول مرة** من الكمبيوتر: نزّل برنامج **Xbox Accessories** من متجر مايكروسوفت، وصّل اليد بسلك USB، واضغط تحديث. (التحديث ما يصير بالبلوتوث)
2. شغّل اليد بزر إكس بوكس.
3. اضغط مطوّل على **زر الربط** الصغير (فوق، جنب منفذ الشحن) 3 ثواني لين يصير الشعار يومض بسرعة.
4. في البوكس اختر **Xbox Wireless Controller**.

### يد بلايستيشن 5

1. تأكد إن اليد طافية.
2. اضغط مطوّل على **Create** (الزر الصغير يسار التاتش باد) و **PS** مع بعض، لين يصير الضوء يومض بسرعة.
3. في البوكس اختر **DualSense Wireless Controller**.

### يد بلايستيشن 4

اضغط مطوّل **SHARE** وبعدين **PS** لين يومض الضوء، واختر **Wireless Controller**.

**نصايح:** خل البوكس على واي فاي **5GHz** (البلوتوث والواي فاي 2.4 يتزاحمون ويصير تقطيع في اليد). خل اليد قريبة من البوكس ومشحونة.

---

## الخطوة 5: ثبّت التطبيق

هذي تسويها **مرة وحدة بس**. لو فيه نسخة قديمة من التطبيق في التلفزيون، ثبّت الجديدة **فوقها** (لا تحذف القديمة، عشان تقدّمك يبقى).
بعدها التحديثات تصير لحالها (شوف «التحديث بدون ما تحذف التطبيق»).

اختر طريقة وحدة من هذي:

### (أ) تطبيق Send Files to TV (الأسهل)

1. نزّل تطبيق **Send Files to TV** من Google Play على الجوال وعلى التلفزيون.
2. انقل `DroneSim.apk` من الكمبيوتر للجوال (كيبل، أو Google Drive، أو أرسله لنفسك).
3. في التلفزيون افتح التطبيق واختر **Receive**. في الجوال اختر **Send** وبعدين الملف وبعدين اسم التلفزيون.
4. في التلفزيون افتح الملف من مجلد **Downloads** واختر **تثبيت** (Install).
   إذا طلب إذن "مصادر غير معروفة"، فعّله لتطبيق Send Files to TV.

### (ب) فلاش USB (للـ Box S و Mi Box S، الستك ما فيه منفذ)

1. انسخ `DroneSim.apk` على الفلاش وركّبه في البوكس.
2. نزّل مدير ملفات من Google Play (مثل **X-plore** أو **File Commander**).
3. افتح الفلاش من مدير الملفات، اضغط على الملف، واختر تثبيت.

### (ج) من الكمبيوتر عبر الواي فاي (adb)

1. لازم يكون **تصحيح أخطاء USB** شغّال (الخطوة 3).
2. اعرف عنوان البوكس: الإعدادات ← الشبكة والإنترنت ← اسم الواي فاي ← عنوان IP (مثلًا `192.168.1.50`).
3. في الكمبيوتر داخل مجلد `android`:

   ```
   powershell -ExecutionPolicy Bypass -File .\install-tv.ps1 -Ip 192.168.1.50
   ```

4. أول مرة يطلع في التلفزيون "السماح بتصحيح أخطاء USB؟": حط صح على **السماح دائمًا من هذا الكمبيوتر** واضغط **موافق**.
5. المرات الجاية يكفي: `powershell -ExecutionPolicy Bypass -File .\install-tv.ps1` (يتذكر العنوان).

إذا قال لك **refused** (يصير في أندرويد 11 وفوق و Google TV):
خيارات المطوّر ← تصحيح الأخطاء اللاسلكي (Wireless debugging) ← شغّله ← "ربط جهاز برمز" (Pair device with pairing code).
بيطلع لك عنوانين ورمز من 6 أرقام. اكتب (بالأرقام اللي عندك):

```
powershell -ExecutionPolicy Bypass -File .\install-tv.ps1 -Pair 192.168.1.50:37215 -Ip 192.168.1.50:41003
```

الأول (`-Pair`) هو العنوان اللي جنب الرمز، والثاني (`-Ip`) هو "عنوان IP والمنفذ" اللي في صفحة تصحيح الأخطاء اللاسلكي. وبعدين اكتب الرمز لما يطلبه.

---

## الخطوة 6: أول تشغيل

- التطبيق يطلع في صف **التطبيقات** أو **الألعاب** باسم **محاكي الدرون**.
  ما لقيته؟ الإعدادات ← التطبيقات ← كل التطبيقات ← محاكي الدرون ← فتح.
- **اضغط A في اليد أول شي.** التلفزيون ما يشوف اليد لين تضغط زر، وأحيانًا أول ضغطة تروح، فاضغط مرة ثانية.
- **وضع الألعاب (Game Mode):** التطبيق يطلبه من التلفزيون لحاله (أندرويد 11 وفوق مع تلفزيون يدعم ALLM). إذا ما اشتغل، فعّله من إعدادات الصورة في التلفزيون نفسه (Picture mode ← Game). يقلل التأخير بين اليد والشاشة، وهذا مهم في الطيران.
- **60 هرتز:** في البوكس: الإعدادات ← تفضيلات الجهاز ← الشاشة والصوت ← الدقة ← اختر 1080p 60Hz (أو 4K 60Hz). التطبيق يحاول يحوّل لـ 60 لحاله إذا كانت 50.
- **الجودة:** إذا فيه تقطيع، خل الجودة **منخفضة** من إعدادات المحاكي.
- **زر الرجوع في الريموت:** إيقاف مؤقت أو رجوع للقائمة. **ضغطتين ورا بعض** = طلوع من التطبيق. زر إكس بوكس أو PS يوديك للشاشة الرئيسية.
- **التقدّم والإعدادات** تنحفظ في البوكس. ما تضيع لما تحدّث التطبيق، بس تضيع لو حذفته. **لا تحذفه أبد.**
- **صوت المدرب** يستخدم صوت قوقل العربي اللي في البوكس. إذا ما تسمعه شوف المشاكل تحت.

---

## التحديث بدون ما تحذف التطبيق

التطبيق يحدّث نفسه من الكمبيوتر عن طريق الواي فاي. **ما تحذف شي، وتقدّمك ما يضيع.**

**أول مرة بس:** ثبّت النسخة الجديدة من التطبيق (اللي فيها التحديث التلقائي) بأي طريقة من الخطوة 5، **فوق** القديمة. لا تحذف القديمة.

**وبعدها كل مرة تبي تحدّث:**

1. شغّل الكمبيوتر والتلفزيون على **نفس الواي فاي**.
2. في الكمبيوتر: **دبل كلك** على الاختصار **«تحديث محاكي التلفزيون»** اللي على سطح المكتب.
3. بتطلع نافذة تقول «قاعد أجهّز التحديث»، وبعد دقيقة تقريبًا تقول «التحديث جاهز». **خلّها مفتوحة.**
4. في التلفزيون: افتح **محاكي الدرون** (لو كان مفتوح: اطلع منه بزر الرجوع **مرتين** وافتحه من جديد).
5. التطبيق يلقى التحديث وينزّله لحاله:
   - أغلب التحديثات تصير **بصمت**: النافذة في الكمبيوتر تقول «تم! التلفزيون نزّل التحديث»، والتحديث يشتغل لحاله أول ما تكون في القائمة الرئيسية للمحاكي (ما يقطع عليك الطيران).
   - أحيانًا يطلع في التلفزيون «فيه نسخة جديدة من التطبيق» (يطلع بس وأنت مو طاير) ← اضغط **«حدّث الحين»** ← وبعدين أندرويد يقول **«تحديث»** (Update) ← اضغطه.
     **بعدها التطبيق يتسكّر لحاله: افتحه من جديد.** تقدّمك محفوظ.
   - ضغطت **«بعدين»**؟ ما يسألك مرة ثانية إلا بعد يوم، أو لما تدبل كلك على الاختصار مرة ثانية وتطلع من التطبيق بزر الرجوع مرتين وتفتحه.
6. خلاص. النافذة في الكمبيوتر توقف لحالها بعد 20 دقيقة، أو اضغط «سكّر».

**أول مرة بس في التلفزيون:** أندرويد بيسألك عن إذن **«السماح لهذا التطبيق بتثبيت التحديثات»** (أو «السماح من هذا المصدر» / Allow from this source).
التطبيق يوديك للشاشة بنفسه: فعّل الإذن لـ **محاكي الدرون**، وارجع بزر الرجوع، واضغط «حدّث الحين» مرة ثانية.

**أول مرة بس في الكمبيوتر:** ممكن تطلع رسالة **«جدار حماية Windows»** عن Windows PowerShell:
حط صح على **«الشبكات الخاصة»** واضغط **«السماح بالوصول»** (Allow access)، وإذا سألك «هل تريد السماح...؟» اضغط **نعم**.

> **مهم:** لازم تكون شبكة الواي فاي في الكمبيوتر مضبوطة **«خاصة»** (Private)، مو «عامة» (Public). النافذة تنبهك لو كانت عامة.
> الطريقة: الإعدادات ← الشبكة والإنترنت ← الواي فاي ← اسم الشبكة ← نوع ملف تعريف الشبكة ← **خاصة**.

**ثلاث قواعد:**

- **لا تحذف التطبيق من التلفزيون أبد.** الحذف يمسح التقدّم.
- **لا تضيّع المفتاح.** خذ نسخة من المجلد `C:\Users\اسمك\.dronesim\` (فلاش أو Google Drive). بدونه ما ينفع أي تحديث.
- **لا تغيّر الملفات اللي في `C:\tools\dronesim-updates` بيدك.** التطبيق يرفض أي ملف ما ينوقّع بمفتاحك.

**ما زبط؟**

| المشكلة | الحل |
|---|---|
| النافذة تقول «أنتظر التلفزيون» وما يصير شي | تأكد إن التلفزيون والكمبيوتر على نفس الواي فاي، وإن الشبكة «خاصة»، وإنك ضغطت «السماح بالوصول». اطلع من التطبيق في التلفزيون بزر الرجوع مرتين وافتحه. |
| ضغطت «بعدين» بالغلط | دبل كلك على الاختصار مرة ثانية، واطلع من التطبيق بزر الرجوع مرتين وافتحه: يسألك من جديد. |
| «فيه نافذة تحديث ثانية مفتوحة» | سكّر النافذة الثانية (أو أعد تشغيل الكمبيوتر) وجرّب مرة ثانية. |
| «المفتاح غلط» أو «ملف مفتاح التوقيع مو موجود» | رجّع المجلد `.dronesim` كامل (فيه المفتاح وكلمة السر) من النسخة الاحتياطية. لا تسوي مفتاح جديد. |
| ضغطت «إلغاء» في رسالة جدار الحماية بالغلط | Windows Security ← جدار الحماية وحماية الشبكة ← السماح لتطبيق عبر جدار الحماية ← Windows PowerShell ← حط صح على «خاص». |
| تبي تحدّث بالكيبل/adb بدل الواي فاي | في مجلد `android`: `powershell -ExecutionPolicy Bypass -File .\update-tv.ps1 -Adb -Ip 192.168.1.50` (يبني نسخة جديدة كاملة ويثبّتها فوق القديمة؛ يحتاج تصحيح الأخطاء من الخطوة 3، والتقدّم ما يضيع). |
| الاختصار انحذف من سطح المكتب | في مجلد `android`: `powershell -ExecutionPolicy Bypass -File .\update-tv.ps1 -MakeShortcut` |

---

## مشاكل وحلولها

| المشكلة | الحل |
|---|---|
| اليد ما تحرّك شي | اضغط A مرتين. تأكد إنها مربوطة (الإعدادات ← أجهزة التحكم والملحقات). احذفها من القائمة واربطها من جديد. يد إكس بوكس: حدّثها من الكمبيوتر. |
| الأزرار مخربطة | يد PS5 على أندرويد 11 وأقل ممكن تتلخبط أزرارها. استخدم يد إكس بوكس، أو عدّل الأزرار من إعدادات اليد داخل المحاكي. |
| اليد تقطّع أو تتأخر | واي فاي 5GHz، قرّب اليد من البوكس، اشحنها، وفعّل وضع الألعاب في التلفزيون. |
| شاشة سودا أو ما يطلع الرسم | ملف الرسم three.js ناقص داخل التطبيق: شغّل الخطوة 1 والخطوة 2 من جديد وثبّت. أو وصّل البوكس بالنت. |
| بطيء أو يقطّع | خل الجودة منخفضة، أعد تشغيل البوكس (يسكّر التطبيقات الثانية)، وخل الصورة 60 هرتز. |
| طلعت رسالة "صار خلل في الرسم" | ذاكرة البوكس خلصت والتطبيق رجع لحاله. خل الجودة منخفضة. |
| ما أسمع صوت المدرب | تأكد إن الصوت مفعّل في إعدادات المحاكي. بعدين في البوكس: الإعدادات ← تفضيلات الجهاز (أو النظام) ← إمكانية الوصول ← تحويل النص إلى كلام ← محرك Google ← تثبيت بيانات الصوت ← العربية. |
| "لم يتم تثبيت التطبيق" | غالبًا مساحة البوكس مليانة. أو النسخة اللي في التلفزيون موقّعة بمفتاح ثاني: ابنِ بنفس ملف المفتاح القديم (المجلد `.dronesim`). الحذف آخر حل لأنه يمسح التقدّم. |
| رسالة "متصفح النظام مو شغال" | حدّث **Android System WebView** من Google Play. |
| PowerShell يقول إن السكربتات ممنوعة | استخدم الأمر مثل ما هو مكتوب هنا بالضبط (فيه `-ExecutionPolicy Bypass`). |
| build.ps1 يقول Missing build tools | سوّ الخطوة 1 أول. |
| نسيت كلمة سر المفتاح | محفوظة في الملف `keystore-password.txt` داخل المجلد `C:\Users\اسمك\.dronesim\`. لو ضاع المجلد كله وما عندك نسخة: ما فيه حل غير مفتاح جديد (`build.ps1 -AllowNewKey`) وحذف التطبيق من التلفزيون (يضيع التقدّم). |

> **ملاحظة:** البلايستيشن 5 نفسه ما يشغّل المحاكي (ما فيه متصفح حقيقي). البوكس هو الحل.

---

## للمطوّرين (English)

- **What it is:** one `Activity` with a full-screen `WebView`. Assets are served from
  `https://appassets.androidplatform.net/assets/` by a hand-written `shouldInterceptRequest` (no androidx).
  Start URL: `.../assets/index.html?platform=tv`. Sources: `src/com/nadir/dronesim/*.java`.
- **Input:** the page should keep using the W3C Gamepad API (Chromium maps Xbox/DualSense/DualShock).
  Every controller event is still forwarded to the WebView; the Activity only consumes it afterwards so Android
  does not turn B into BACK, A into DPAD_CENTER or sticks into D-pad keys. Fallback bridge `window.NativePad`:
  `state()` → `"seq,buttons,lx,ly,rx,ry,lt,rt,hatX,hatY,rawRX,rawRY"` (W3C button bit order; seq 0 = no controller
  input yet; hat also folded into bits 12..15; bits 6/7 stay 0 on analog-trigger pads, so always read `lt`/`rt`;
  legacy-DualSense RX/RY triggers already converted into `lt`/`rt`), `device()`, `count()`, `info()` (JSON), `exit()`,
  `rumble(strong, weak, ms)`.
- **BACK key:** calls `window.onNativeBack()`; return `true` when the page handled it (pause / close a screen).
  Anything else → "press BACK again to exit" (second press within 2 s exits). Pages without the hook get an Escape key.
  Optional: `window.onNativeLowMemory(level)` is called on Android memory pressure (drop quality there). If the WebGL
  renderer still dies, the app rebuilds the WebView and reloads (shows a message instead on the 4th loss within 60 s).
- **`web/native-shim.js`** is injected by `build.ps1` as the first script of the APK's `index.html`:
  `speechSynthesis` polyfill over Android TextToSpeech (`window.NativeVoice`; WebView has no Web Speech TTS),
  and a `dual-rumble` `vibrationActuator` on every gamepad backed by `NativePad.rumble`. Does nothing in browsers.
- **Dev build / live reload:** `.\build.ps1 -Dev` (`aapt2 --debug-mode` = FLAG_DEBUGGABLE: chrome://inspect, honours `--es url`), install once, then
  serve the simulator folder (`python -m http.server 8080`) and run `.\install-tv.ps1 -NoInstall -Reverse`
  (TV opens `http://localhost:8080` through `adb reverse`) or `-DevUrl http://<PC-IP>:8080/index.html`.
  Debug with `chrome://inspect`; logs: `.\install-tv.ps1 -NoInstall -NoLaunch -Logcat` (tag `DroneSim`).
- **Build details:** everything runs in an ASCII work folder (`C:\tools\dronesim-build`) because Java tools cannot open
  the Arabic project path. minSdk 24, targetSdk 34, versionCode = minutes since 2025-01-01 UTC (= the content version
  written to `assets/content-version.txt`; `assets/update-config.properties` gets `sources=` from `-UpdateSources`,
  default `lan`). Keystore (PKCS12, alias `dronesim`) lives outside the repo in `%USERPROFILE%\.dronesim\`; password from
  `$env:DS_KS_PASS`, else `keystore-password.txt` next to the keystore, else a prompt. After signing, the certificate
  SHA-256 is compared with `signing-cert.txt` (pinned release key); a mismatch stops the build with exit code 3 unless
  `-AllowNewKey` (which re-pins). `install-tv.ps1` and `publish-update.ps1` check the same pin.
- **Self-update (OTA), PC side:**
  - `publish-update.ps1` writes `C:\tools\dronesim-updates\`: `update.properties` (java Properties, non-ASCII as `\uXXXX`),
    `update.properties.sig` (hex SHA256withRSA by the release key, `tools\SignUpdate.java`), `content-<ver>.zip` (the staged
    web root + `content-version.txt`) and `DroneSim-<code>.apk`. A new APK is built only when `src\`, `res\`,
    `AndroidManifest.xml`, `build.ps1` or `-UpdateSources` changed since the last published APK (or `-ForceApk`); otherwise
    only web content is published (hot update, no install prompt). `content.minNative` = `UpdateCore.NATIVE_API`.
    Versions always increase; the newest 3 zips/APKs are kept. `-Notes`/`-NotesFile` = Arabic text for the update dialog,
    `-Sources 'https://host/path/'` = extra base URLs the apps remember, `-ApkPath` = publish an existing APK.
  - `serve-updates.ps1`: UDP 47800 discovery (`DRONESIM?1` -> `DRONESIM!1 http://<pc-ip>:47801/`, IP on the sender's
    subnet) + HTTP GET/HEAD on TCP 47801 of the files in that folder only. `-Bind 127.0.0.1` for tests. Warns about a
    Public network profile / firewall block rules (changes nothing).
  - `update-tv.ps1` (desktop shortcut «تحديث محاكي التلفزيون»): publish, then serve 20 min with an Arabic status window.
    `-Adb [-Ip x]` publishes with `-ForceApk` (the APK must carry the newest web content) and installs it with
    `adb install -r` instead. `-MakeShortcut` recreates the shortcut. Exit codes of `publish-update.ps1`: 3 = wrong
    signing key, 5 = keystore / password missing or unreadable (both shown in Arabic in the window).
  - **App side** (`Updater`, `UpdateCore`, `MainActivity`): checks at cold start (+5 s) and on resume (every 30 min,
    or 15 s after a check that reached nothing). Downloaded web content is loaded at the next cold start or as soon
    as the page shows a menu screen (`DS.app.state === 'menu'` and `DS.UI.cur.name` in title/main/course/unit/pro/
    proLevel/missions/theoryHome); never during a flight, a paused flight or a quiz. The APK dialog waits while
    `DS.app.state` is `fly` (or the theory exam is open) and ignores keys for its first second; only «بعدين»
    snoozes (24 h, or until a newer `published`). P7: the probe runs 15 s after `onPageFinished` (30 s after
    `loadUrl` at the latest) and must answer within 8 s (API 29+: also an unresponsive renderer); renderer deaths
    count only while the app is in front (background deaths are rebuilt on return). Crash loops across restarts:
    `state.properties` keys `trial` / `trialAttempts` (counted before an unproven installed version loads, undone on
    a clean stop, cleared when the check passes; 2 failed starts = bad) and `good`.
  - Internet host later: build once with `-UpdateSources 'lan;https://user.github.io/dronesim/'` (or publish with
    `-Sources ...` so installed apps learn it), then upload `update.properties`, `update.properties.sig`, `content-*.zip`
    and `DroneSim-*.apk` from `C:\tools\dronesim-updates\` (not `state\`) as they are. Same signed protocol; nothing on
    the host needs to be trusted.
