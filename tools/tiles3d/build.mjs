// يبني lib/tiles3d.bundle.js (IIFE عادي) + ينسخ ملفات Draco إلى lib/draco/
// الاستخدام:  node tools/tiles3d/build.mjs <مجلد البناء اللي فيه node_modules>
//   مثال:    node tools/tiles3d/build.mjs C:\tools\tiles-build
// مجلد البناء لازم يكون بالإنجليزي وفيه:  npm i three@0.149.0 3d-tiles-renderer@0.3.39 esbuild@0.24.0
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, '..', '..');
const buildDir = path.resolve(process.argv[2] || 'C:/tools/tiles-build');
const nm = path.join(buildDir, 'node_modules');
if (!fs.existsSync(path.join(nm, '3d-tiles-renderer'))) {
  console.error('ما لقيت 3d-tiles-renderer في ' + nm + '\nشغّل:  cd ' + buildDir + ' && npm i three@0.149.0 3d-tiles-renderer@0.3.39 esbuild@0.24.0');
  process.exit(1);
}
const req = createRequire(path.join(buildDir, 'package.json'));
const esbuild = req('esbuild');
const pkgVer = n => JSON.parse(fs.readFileSync(path.join(nm, n, 'package.json'), 'utf8')).version;
const vThree = pkgVer('three'), vTiles = pkgVer('3d-tiles-renderer');
if (vThree !== '0.149.0') console.warn('تنبيه: three في مجلد البناء = ' + vThree + ' (المحاكي يستخدم r149)');

const shim = path.join(here, 'three-shim.cjs');
const threeShim = {
  name: 'three-shim',
  setup(b) {
    // 'three' بالضبط → window.THREE. الملفات مثل three/examples/jsm/... تنحل عادي من node_modules
    b.onResolve({ filter: /^three$/ }, () => ({ path: shim }));
  }
};
const outFile = path.join(project, 'lib', 'tiles3d.bundle.js');
const res = await esbuild.build({
  entryPoints: [path.join(here, 'entry.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome67', 'safari14', 'firefox68'],
  supported: { bigint: true },   // BigInt (ميتاداتا البلاطات) — Chrome 67+
  minify: true,
  legalComments: 'none',
  nodePaths: [nm],
  absWorkingDir: buildDir,
  plugins: [threeShim],
  metafile: true,
  // ما يشتغل إلا إذا three.js موجود (الصفحة تكمل بدون الخريطة الحقيقية لو مو موجود)
  banner: { js: '/* tiles3d.bundle.js — 3d-tiles-renderer ' + vTiles + ' (Apache-2.0, NASA-AMMOS) + three ' + vThree + ' GLTFLoader/DRACOLoader (MIT). Built by tools/tiles3d/build.mjs */\nif (typeof window !== "undefined" && window.THREE && !window.Tiles3D) {' },
  footer: { js: '}' },
  outfile: outFile,
  logLevel: 'warning'
});
fs.writeFileSync(path.join(buildDir, 'tiles3d-meta.json'), JSON.stringify(res.metafile));   // تحليل الحجم (في مجلد البناء، مو في المشروع)

// ملفات Draco (فك ضغط أشكال البلاطات)
const dsrc = path.join(nm, 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
const ddst = path.join(project, 'lib', 'draco');
fs.mkdirSync(ddst, { recursive: true });
for (const f of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) fs.copyFileSync(path.join(dsrc, f), path.join(ddst, f));

const kb = f => (fs.statSync(f).size / 1024).toFixed(1) + ' KB';
console.log('OK  lib/tiles3d.bundle.js ' + kb(outFile) + '  (3d-tiles-renderer ' + vTiles + ', three ' + vThree + ')');
console.log('OK  lib/draco/: ' + fs.readdirSync(ddst).map(f => f + ' ' + kb(path.join(ddst, f))).join(', '));
