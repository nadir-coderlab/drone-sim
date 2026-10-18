بناء مكتبة الخريطة الحقيقية 3D (lib/tiles3d.bundle.js + lib/draco/)
=====================================================================
المكتبة: 3d-tiles-renderer 0.3.39 (Apache-2.0) + GLTFLoader/DRACOLoader من three 0.149.0 (MIT).
الحزمة تستخدم نفس three.js حق الصفحة (window.THREE) — 'three' محوّل لـ three-shim.cjs.

مرة وحدة (مجلد إنجليزي، فيه نت):
  mkdir C:\tools\tiles-build && cd C:\tools\tiles-build
  npm init -y
  npm i three@0.149.0 3d-tiles-renderer@0.3.39 esbuild@0.24.0

البناء (من مجلد المحاكي):
  node tools/tiles3d/build.mjs C:\tools\tiles-build

يطلع: lib/tiles3d.bundle.js (~103 KB) + lib/draco/draco_decoder.js / .wasm / draco_wasm_wrapper.js
مجلد tools/ ما ينسخ لتطبيق التلفزيون (android/build.ps1 يتجاهله).
