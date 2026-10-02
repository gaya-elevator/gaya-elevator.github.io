/* GAYA Hub (가야엘리베이터 자재·자료 앱) — 오프라인용 서비스 워커
   · 앱 화면 파일은 폰에 저장해 두고, 인터넷이 끊겨도 앱이 열리게 한다
   · 데이터(Supabase)와 자료 저장소(구글)는 저장하지 않는다 → 저장·조회는 항상 서버 기준
   · 화면(index.html)과 연결 설정(config.js)은 인터넷에서 먼저 받되, 3초 안에 안 오면 저장본으로 먼저 연다 (전파 약한 곳에서 몇 분씩 기다리지 않게)
   · app.js / app.css 는 버전 번호(?v=)가 붙은 주소 그대로 저장한다 → 새 버전을 올리면 새로 받는다
   · 새 버전을 받다가 꼭 필요한 파일 하나라도 실패하면 설치하지 않는다 → 옛 버전이 그대로 남아 앱이 깨지지 않는다
   · 폰 알림: 서버가 보낸 알림을 폰 알림으로 띄우고, 누르면 앱을 열어 그 화면으로 간다 */
const VER = '61de2dfd';
const SHELL = 'gaya-shell-' + VER;
const FONT = 'gaya-font';
const LIB = 'gaya-lib'; // PDF 보기 도구: 버전이 바뀌어도 지우지 않는다 (전파 없는 곳에서 저장한 PDF 를 열기 위해)
const VENDOR = 'gaya-vendor'; // 로그인·QR 도구: 도구 버전(?v=)이 바뀔 때만 새로 받는다
const VFILES = ['vendor/supabase.js?v=d5dda203', 'vendor/qrcode.js?v=d5dda203', 'vendor/jsQR.js?v=d5dda203'];
const CORE = ['./', 'index.html', 'app.css?v=' + VER, 'app.js?v=' + VER, 'config.js?v=' + VER];
const EXTRA = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL), v = await caches.open(VENDOR);
    try {
      await Promise.all(CORE.map(f => c.add(new Request(f, { cache: 'reload' })))); // 하나라도 실패하면 설치 실패 → 옛 버전 유지
      await Promise.all(VFILES.map(async f => { if (!(await v.match(f))) await v.add(new Request(f, { cache: 'reload' })); }));
    } catch (err) { await caches.delete(SHELL); throw err; } // 반쯤 받은 새 버전은 지운다 (다음에 다시 시도)
    await Promise.all(EXTRA.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('gaya-shell-') && k !== SHELL).map(k => caches.delete(k)));
    const v = await caches.open(VENDOR); const keep = new Set(VFILES.map(f => new URL(f, self.registration.scope).href));
    for (const r of await v.keys()) if (!keep.has(r.url)) await v.delete(r);
    await self.clients.claim();
  })());
});
/* 인터넷 먼저, 3초 안에 답이 없거나 실패하면 저장본 (받아지는 대로 저장본도 새것으로 바꿔 둔다) */
function netFirst(req, key, ms = 3000) {
  const store = r => { if (r && r.ok) { const c = r.clone(); caches.open(SHELL).then(x => x.put(key, c)); } return r; };
  const net = fetch(req, { cache: 'no-cache' }).then(store); // 브라우저 임시 저장본 말고 서버에 새로 묻는다 (바뀐 게 없으면 짧은 답만 옴)
  return new Promise(resolve => {
    let done = false;
    const fromCache = async () => { const hit = await caches.match(key, { ignoreSearch: true }); if (hit && !done) { done = true; resolve(hit); } return !!hit; };
    const t = setTimeout(fromCache, ms);
    net.then(async r => { if (done) return; if (r.ok) { done = true; clearTimeout(t); return resolve(r); } if (!(await fromCache()) && !done) { done = true; resolve(r); } }) // 404·500 이면 저장본
      .catch(async () => { if (done) return; clearTimeout(t); if (!(await fromCache()) && !done) { done = true; resolve(Response.error()); } });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co') || url.hostname.includes('google.com') || url.hostname.includes('googleusercontent')) return;
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT).then(async c => { const hit = await c.match(req); const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit); return hit || net; }));
    return;
  }
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // 앱 첫 화면(/ 또는 /index.html)만 저장한다 — 다른 주소의 화면이 앱 화면 자리에 저장되는 일을 막는다
    const scope = new URL(self.registration.scope).pathname;
    const isApp = url.pathname === scope || url.pathname === scope + 'index.html';
    if (isApp) e.respondWith(netFirst(req, 'index.html'));
    return;
  }
  if (url.pathname.endsWith('/config.js')) { e.respondWith(netFirst(req, req.url)); return; }
  if (url.pathname.includes('/vendor/pdf')) { e.respondWith(caches.open(LIB).then(async c => (await c.match(req, { ignoreSearch: true })) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }))); return; }
  if (url.pathname.includes('/vendor/')) { e.respondWith(caches.open(VENDOR).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }))); return; }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(SHELL).then(x => x.put(req, c)); } return r; })));
});

/* ───────── 폰 알림 ───────── */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { t: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.t || 'GAYA Hub', {
    body: d.b || '', tag: d.id || undefined, icon: 'icon-192.png', lang: 'ko', data: { link: d.l || {}, id: d.id || '' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const link = (e.notification.data || {}).link || {};
  e.waitUntil((async () => {
    const scope = new URL(self.registration.scope);
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(c => new URL(c.url).pathname.startsWith(scope.pathname));
    if (w) { try { await w.focus(); } catch {} w.postMessage({ type: 'gaya-open', link }); return; } // 열려 있는 앱으로
    const u = new URL(scope.href); u.searchParams.set('go', JSON.stringify(link));
    await self.clients.openWindow(u.href);
  })());
});
