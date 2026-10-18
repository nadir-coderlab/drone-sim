// مدخل الحزمة: lib/tiles3d.bundle.js (سكربت عادي، يحط window.Tiles3D)
// يستخدم نفس three.js حق الصفحة (window.THREE r149) — 'three' محوّل لـ three-shim.cjs وقت البناء.
// البناء: node tools/tiles3d/build.mjs C:\tools\tiles-build   (شوف README.txt)
import { TilesRenderer, GoogleCloudAuthPlugin, GLTFCesiumRTCExtension, WGS84_ELLIPSOID } from '3d-tiles-renderer';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

window.Tiles3D = {
  version: '3d-tiles-renderer@0.3.39 + three@0.149.0 loaders',
  TilesRenderer,
  GoogleCloudAuthPlugin,
  GLTFCesiumRTCExtension,
  WGS84_ELLIPSOID,
  GLTFLoader,
  DRACOLoader
};
