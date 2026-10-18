// إعدادات عامة للمحاكي (تنقرا قبل geo3d.js)
// googleMapsKey: مفتاح Google Map Tiles API (للخريطة الحقيقية 3D حول أكاديمية طويق).
// المفتاح مقفول على مواقع معيّنة (HTTP referrer) ومحدود بـ Map Tiles API بس — ما يشتغل من ملف محلي (file://).
// تقدر تغيّره وقت التشغيل: DS.settings.googleKey (لو فيه نص يستخدمه بدل هذا).
window.DS = window.DS || {};
DS.CONFIG = Object.assign({ googleMapsKey: 'AIzaSyAJgz5GW66WxiAR6smXb9d4etJbIjgUqZM' }, DS.CONFIG || {});
