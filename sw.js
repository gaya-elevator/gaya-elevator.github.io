/* 가야 자재·자료 — 오프라인용 서비스 워커
   · 앱 화면 파일은 폰에 저장해 두고, 인터넷이 끊겨도 앱이 열리게 한다
   · 데이터(Supabase)와 자료 저장소(구글)는 저장하지 않는다 → 저장·조회는 항상 서버 기준
   · 화면(index.html)과 연결 설정(config.js)은 항상 인터넷에서 먼저 받는다 → 설정을 고치면 바로 반영
   · app.js / app.css 는 버전 번호(?v=)가 붙은 주소 그대로 저장한다 → 새 버전을 올리면 새로 받는다 */
const VER = '38e908ee';
const SHELL = 'gaya-shell-' + VER;
const FONT = 'gaya-font';
const FILES = ['./', 'index.html', 'app.css?v=' + VER, 'app.js?v=' + VER, 'config.js?v=' + VER, 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'vendor/supabase.js', 'vendor/qrcode.js', 'vendor/jsQR.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(FILES.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('gaya-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const networkFirst = (req, key) => fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(SHELL).then(x => x.put(key || req, c)); } return r; })
  .catch(() => caches.match(key || req, { ignoreSearch: true }));

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co') || url.hostname.includes('google.com') || url.hostname.includes('googleusercontent')) return;
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT).then(async c => { const hit = await c.match(req); const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit); return hit || net; }));
    return;
  }
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, 'index.html')); return; }
  if (url.pathname.endsWith('/config.js')) { e.respondWith(networkFirst(req)); return; }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(SHELL).then(x => x.put(req, c)); } return r; })));
});
