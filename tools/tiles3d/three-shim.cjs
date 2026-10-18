// بديل 'three' داخل الحزمة: نفس الكائن العالمي window.THREE (نسخة وحدة من three.js في الصفحة)
// + TextureUtils.getByteLength (موجودة في three الجديد بس) عشان مكتبة البلاطات تحسب الذاكرة وتنظف الكاش صح.
/* global window */
const T = window.THREE;
const BPC = { 1009: 1, 1010: 1, 1011: 2, 1012: 2, 1013: 4, 1014: 4, 1015: 4, 1016: 2 };   // بايت لكل قناة حسب النوع
const CH = { 1021: 1, 1023: 4, 1024: 1, 1025: 2, 1026: 1, 1027: 2, 1028: 1, 1029: 1, 1030: 2, 1031: 2, 1033: 4 }; // عدد القنوات حسب الصيغة
const TextureUtils = T.TextureUtils || {
  getByteLength(width, height, format, type) {
    const px = (width || 0) * (height || 0);
    if (type === 1017 || type === 1018 || type === 1019) return px * 2;   // 4444 / 5551 / 565
    if (CH[format] != null) return px * CH[format] * (BPC[type] || 1);
    return px;   // صيغ مضغوطة (DXT/ETC/ASTC): تقريباً بايت للبكسل
  }
};
module.exports = Object.assign({}, T, { TextureUtils });
