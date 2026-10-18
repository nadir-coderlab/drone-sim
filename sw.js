// Service worker حق المحاكي: يخزن ملفات الموقع عشان يفتح ويشتغل بدون نت (أول ملفاتنا من الذاكرة، بعدين من النت).
// - لما تنشر تحديث للموقع: غيّر VERSION تحت (أي نص جديد). الجوال ياخذ النسخة الجديدة ويمسح القديمة.
// - أي شي من موقع ثاني (خرائط قوقل ثلاثية الأبعاد، googleapis، CDN) = من النت دايم، ما نخزنه أبد.
// - ما يتسجل إلا على https أو localhost (مو file:// ولا داخل تطبيق التلفزيون) — main.js يشيك.
'use strict';
const VERSION = 'dsim-2026-10-18-web2-geo3d';
const PREFIX = 'dsim-';
// لازم كلها موجودة (إذا واحد ناقص التخزين ما يكمل)
const CORE = [
  'index.html', 'manifest.webmanifest', 'lib/three.min.js',
  'js/util.js', 'js/input.js', 'js/touch.js', 'js/worlddata.js', 'js/physics.js', 'js/tasks.js', 'js/scoring.js',
  'js/qbank_ar.js', 'js/qbank_en.js', 'js/glossary.js', 'js/content.js', 'js/scenarios.js', 'js/content_pro.js',
  'js/course.js', 'js/autopilot.js', 'js/session.js', 'js/world.js', 'js/render.js', 'js/hud.js', 'js/ui.js',
  'js/theory.js', 'js/main.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'
];
// اختيارية: نخزنها إذا موجودة (الخرائط الحقيقية ومفكك draco). أي ملف ثاني من موقعنا ينخزن أول ما ينطلب
const OPTIONAL = [
  './', 'lib/tiles3d.bundle.js', 'js/config.js', 'js/geo3d.js',
  'lib/draco/draco_decoder.js', 'lib/draco/draco_decoder.wasm', 'lib/draco/draco_wasm_wrapper.js'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    await Promise.all(OPTIONAL.map(u => fetch(new Request(u, { cache: 'reload' }))
      .then(r => (r && r.ok && r.type === 'basic' ? c.put(u, r) : null)).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  let url;
  try { url = new URL(req.url); } catch (x) { return; }
  if (url.origin !== self.location.origin) return;            // موقع ثاني (قوقل وغيره): من النت بس، بدون تخزين
  if (url.pathname.endsWith('/sw.js')) return;
  e.respondWith(fromCache(req, url));
});

async function fromCache(req, url) {
  const c = await caches.open(VERSION);
  const nav = req.mode === 'navigate';
  let hit = await c.match(req, { ignoreSearch: nav });         // index.html?platform=tv#... = نفس الصفحة
  if (!hit && nav) hit = (await c.match('index.html')) || (await c.match('./'));
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if (r && r.ok && r.type === 'basic' && !url.search) c.put(req, r.clone()).catch(() => {});
    return r;
  } catch (err) {
    if (nav) { const h = await c.match('index.html'); if (h) return h; }
    return new Response('', { status: 504, statusText: 'offline' });
  }
}
