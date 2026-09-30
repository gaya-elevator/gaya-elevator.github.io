'use strict';
/* ───────── 설정 ─────────
   SUPABASE_URL 이 비어 있으면 체험판(예시 데이터, 이 기기에만 저장)으로 동작한다. */
const CONFIG = Object.assign({
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  DRIVE_ENDPOINT: '',          // 구글 앱스 스크립트 웹앱 주소 (자료 업로드 창구)
  APP_URL: '',                 // 배포 주소 (QR 라벨에 들어감)
  EMAIL_DOMAIN: 'gaya.local',  // 사내번호 → 내부용 가짜 주소 (메일 발송 없음)
  STORAGE_WARN: 0.8
}, window.GAYA_CONFIG || {});
const DEMO = !CONFIG.SUPABASE_URL;

/* ───────── 작은 도구들 ───────── */
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
// 저장 요청마다 붙이는 고유 번호(UUID). 같은 번호로 두 번 와도 서버는 한 번만 처리한다
const opId = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const clone = o => JSON.parse(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const pad = n => String(n).padStart(2, '0');
function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return Math.floor(diff / 60) + '분 전';
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (d >= day0) return '오늘 ' + hm;
  if (d >= new Date(day0 - 864e5)) return '어제 ' + hm;
  if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + hm;
  return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.';
}
function fmtDate(iso) { const d = new Date(iso); return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.'; }
function fmtSize(b) {
  if (b == null) return '';
  if (b < 1024) return b + 'B';
  if (b < 1048576) return (b / 1024).toFixed(0) + 'KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + 'MB';
  return (b / 1073741824).toFixed(2) + 'GB';
}
function fileKind(name, kind) {
  if (kind === 'video') return ['vid', '영상'];
  if (kind === 'link') return ['etc', '링크'];
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return ['pdf', 'PDF'];
  if (['xls', 'xlsx', 'csv'].includes(ext)) return ['xls', 'XLS'];
  if (['ppt', 'pptx'].includes(ext)) return ['ppt', 'PPT'];
  if (['doc', 'docx'].includes(ext)) return ['doc', 'DOC'];
  if (['hwp', 'hwpx'].includes(ext)) return ['hwp', 'HWP'];
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return ['img', 'IMG'];
  if (['mp4', 'mov', 'avi'].includes(ext)) return ['vid', 'MP4'];
  return ['etc', ext.slice(0, 4).toUpperCase() || 'FILE'];
}
const ROLE_NAME = { dev: '개발자', admin: '관리자', staff: '직원' };
const TX_NAME = { in: '입고', out: '출고', move: '이동', cancel: '취소', adjust: '정정' };

/* 이미지 줄이기: 사진은 긴 변 1280px, JPEG 0.8 로 저장해 용량을 아낀다 */
function shrinkImage(file, max = 1280, q = 0.8) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('사진을 읽지 못했습니다.'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('사진 형식을 읽지 못했습니다.'));
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => b ? res(b) : rej(new Error('사진 변환 실패')), 'image/jpeg', q);
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
const blobToDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });

/* ───────── 아이콘 (선 굵기 1.8, 24격자) ───────── */
const P = {
  box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
  docs: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 8h3v3H8zM13 13h3v3h-3zM13 8h3M8 13v3"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  more: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  chev: '<path d="m9 5 7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  in: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 15v4h16v-4"/>',
  out: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v4h16v-4"/>',
  move: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  undo: '<path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 0 1 0 10H11"/>',
  edit: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  folderPlus: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><path d="M12 11v6M9 14h6"/>',
  upload: '<path d="M12 16V5M7.5 9.5 12 5l4.5 4.5"/><path d="M5 19h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  cam: '<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.5 13.5A6 6 0 0 1 21 19"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="3"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21z"/><circle cx="12" cy="10" r="2.3"/>',
  tag: '<path d="M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5z"/><circle cx="8" cy="8.5" r="1.4"/>',
  qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 20h1M20 14v1"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  warn: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17h.01"/>',
  wifioff: '<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 5-2.6M19 12.5a10 10 0 0 0-2.3-1.6M2 9a15 15 0 0 1 4-2.5M22 9a15 15 0 0 0-9-3.8M12 20h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 17 4-5"/>',
  book: '<path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21M17 12v3M20 12v2"/>',
  paste: '<path d="M8 4h8v3H8z"/><path d="M16 5.5h2.5V21h-13V5.5H8"/>',
  shelf: '<path d="M4 3v18M20 3v18M4 8h16M4 14h16M4 20h16"/>',
  logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>',
  sort: '<path d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  mark: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M12 3v18"/><path d="m8 9.5 1.8-2 1.8 2M16 14.5l-1.8 2-1.8-2"/>'
};
const ic = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

/* ───────── 권한 ─────────
   직원: 입고·출고·이동·본인 출고 취소(7일 안)·폴더 만들기·파일 올리기·댓글·품목 메모/사진
   관리자: 위 전부 + 품목/위치/분류 관리, 수량 정정, 폴더·파일 이름 변경/이동/삭제, 직원 승인·관리, 활동 로그, 휴지통
   개발자: 전부 + 관리자 지정 */
function can(u, act, obj) {
  if (!u || u.status !== 'active') return false;
  const adm = u.role === 'admin' || u.role === 'dev';
  switch (act) {
    case 'stock': case 'upload': case 'mkdir': case 'comment': case 'memo': return true;
    case 'cancel':
      if (adm) return true;
      return obj && obj.user_id === u.id && (Date.now() - new Date(obj.created_at)) < 7 * 864e5;
    case 'delComment': return adm || (obj && obj.user_id === u.id);
    case 'setDev': return u.role === 'dev';
    default: return adm; // item, location, category, adjust, folderAdmin, docAdmin, users, audit, trash, status
  }
}

/* ───────── 체험판 데이터 계층 ─────────
   실서버(Supabase)용 계층과 같은 이름·같은 동작의 함수를 제공한다. 데이터는 이 기기에만 저장된다. */
function makeDemoAPI() {
  const KEY = 'gaya-demo-v3';
  let D = store.get(KEY, null) || seed();
  let meId = store.get(KEY + '-me', null);
  const save = () => store.set(KEY, D);
  const now = () => new Date().toISOString();
  const byId = (arr, id) => arr.find(x => x.id === id);
  const me = () => byId(D.profiles, meId) || null;
  const nameOf = id => (byId(D.profiles, id) || {}).name || '알 수 없음';
  const fail = m => { throw new Error(m); };
  const need = act => { const u = me(); if (!can(u, act)) fail('이 작업은 관리자만 할 수 있습니다.'); return u; };
  function log(action, target_type, target_id, summary) {
    const u = me();
    D.audit.unshift({ id: uid('a'), at: now(), actor_id: u ? u.id : null, actor_name: u ? u.name : '시스템', action, target_type, target_id, summary });
  }
  function notify(userIds, n) {
    [...new Set(userIds)].filter(Boolean).forEach(id => D.notifs.unshift({ id: uid('n'), user_id: id, read_at: null, created_at: now(), ...n }));
  }
  const admins = () => D.profiles.filter(p => (p.role === 'admin' || p.role === 'dev') && p.status === 'active').map(p => p.id);
  const stockRow = (item_id, location_id) => {
    let r = D.stock.find(s => s.item_id === item_id && s.location_id === location_id);
    if (!r) { r = { item_id, location_id, qty: 0 }; D.stock.push(r); }
    return r;
  };
  const totalOf = item_id => D.stock.filter(s => s.item_id === item_id).reduce((a, s) => a + s.qty, 0);
  const itemLabel = it => it.name + (it.spec ? ' · ' + it.spec : '');
  const locPath = id => { const out = []; let n = byId(D.locations, id); while (n) { out.unshift(n.name); n = byId(D.locations, n.parent_id); } return out.join(' › '); };
  function dupOp(op_id) { return op_id && D.tx.find(t => t.op_id === op_id); }
  function lowCheck(item_id, before) { // 최소 재고선을 넘어 내려갈 때 한 번만 알린다
    const it = byId(D.items, item_id);
    if (it && it.min_qty && totalOf(item_id) < it.min_qty && before >= it.min_qty) {
      notify(admins(), { kind: 'low', title: '재고 부족: ' + itemLabel(it), body: '남은 수량 ' + totalOf(item_id) + it.unit + ' / 최소 ' + it.min_qty + it.unit, link: { tab: 'items', view: 'item', id: item_id } });
    }
  }
  const tick = async () => { await sleep(90); };

  const api = {
    demo: true,
    async session() { await tick(); const u = me(); return u ? clone(u) : null; },
    async login(emp_no, pw) {
      await tick();
      const u = D.profiles.find(p => p.emp_no === String(emp_no).trim());
      if (!u || (D.pw[u.id] || '1234') !== pw) fail('사내번호 또는 비밀번호가 맞지 않습니다.');
      if (u.status === 'disabled') fail('사용이 중지된 계정입니다. 관리자에게 문의하세요.');
      meId = u.id; store.set(KEY + '-me', meId);
      if (u.status === 'active') { log('로그인', 'account', u.id, u.name + ' 로그인'); save(); }
      return clone(u);
    },
    async quickLogin(role) {
      const u = D.profiles.find(p => p.role === role && p.status === 'active');
      meId = u.id; store.set(KEY + '-me', meId); return clone(u);
    },
    async signup({ emp_no, name, phone, pw }) {
      await tick();
      emp_no = String(emp_no).trim(); name = String(name).trim();
      if (!/^[A-Za-z0-9-]{2,20}$/.test(emp_no)) fail('사내번호는 영문·숫자 2~20자로 입력하세요.');
      if (!name) fail('실명을 입력하세요.');
      if (!pw || pw.length < 6) fail('비밀번호는 6자 이상으로 정하세요.');
      if (D.profiles.some(p => p.emp_no === emp_no)) fail('이미 가입된 사내번호입니다. 비밀번호를 잊었다면 관리자에게 초기화를 요청하세요.');
      const u = { id: uid('u'), emp_no, name, phone: phone || '', role: 'staff', status: 'pending', created_at: now() };
      D.profiles.push(u); D.pw[u.id] = pw;
      meId = u.id; store.set(KEY + '-me', meId);
      log('가입 신청', 'account', u.id, name + ' (' + emp_no + ') 가입 신청');
      notify(admins(), { kind: 'signup', title: '가입 신청: ' + name, body: '사내번호 ' + emp_no, link: { tab: 'more', view: 'users' } });
      save(); return clone(u);
    },
    async logout() { meId = null; store.del(KEY + '-me'); },
    async changePassword(oldPw, newPw) {
      await tick(); const u = me();
      if ((D.pw[u.id] || '1234') !== oldPw) fail('지금 비밀번호가 맞지 않습니다.');
      if (!newPw || newPw.length < 6) fail('새 비밀번호는 6자 이상으로 정하세요.');
      D.pw[u.id] = newPw; log('비밀번호 변경', 'account', u.id, u.name + ' 본인 비밀번호 변경'); save();
    },

    /* 한 번에 받아 두는 기본 자료 (오프라인 조회용으로도 저장) */
    async bootstrap() {
      await tick();
      return clone({
        locations: D.locations.filter(x => !x.deleted_at),
        categories: D.categories.filter(x => !x.deleted_at),
        items: D.items.filter(x => !x.deleted_at),
        stock: D.stock.filter(s => s.qty !== 0),
        people: D.profiles.map(p => ({ id: p.id, name: p.name, role: p.role, status: p.status })),
        folders: D.folders.filter(x => !x.deleted_at),
        docs: D.docs.filter(x => !x.deleted_at).map(d => { const c = { ...d }; delete c.dataurl; return c; })
      });
    },
    async txList({ item_id, location_id, limit = 50 } = {}) {
      await tick();
      return clone(D.tx.filter(t => (!item_id || t.item_id === item_id) && (!location_id || t.from_loc === location_id || t.to_loc === location_id)).slice(0, limit));
    },

    /* 입출고 — 서버에서는 한 번의 트랜잭션 함수로 처리된다 */
    async stockIn({ item_id, location_id, qty, note, op_id }) {
      await tick(); const u = need('stock');
      if (dupOp(op_id)) return; qty = +qty;
      if (!(qty > 0)) fail('수량을 1 이상으로 입력하세요.');
      if (!location_id) fail('넣을 위치를 고르세요.');
      stockRow(item_id, location_id).qty += qty;
      const it = byId(D.items, item_id);
      D.tx.unshift({ id: uid('t'), op_id, type: 'in', item_id, from_loc: null, to_loc: location_id, qty, site: '', note: note || '', user_id: u.id, created_at: now() });
      log('입고', 'item', item_id, itemLabel(it) + ' ' + qty + it.unit + ' → ' + locPath(location_id));
      save();
    },
    async stockOut({ item_id, location_id, qty, site, note, op_id }) {
      await tick(); const u = need('stock');
      if (dupOp(op_id)) return; qty = +qty;
      if (!(qty > 0)) fail('수량을 1 이상으로 입력하세요.');
      const r = stockRow(item_id, location_id);
      if (r.qty < qty) fail('이 위치에는 ' + r.qty + '개밖에 없습니다. 수량이나 위치를 확인하세요.');
      const before = totalOf(item_id); r.qty -= qty;
      const it = byId(D.items, item_id);
      D.tx.unshift({ id: uid('t'), op_id, type: 'out', item_id, from_loc: location_id, to_loc: null, qty, site: site || '', note: note || '', user_id: u.id, created_at: now() });
      log('출고', 'item', item_id, itemLabel(it) + ' ' + qty + it.unit + ' ← ' + locPath(location_id) + (site ? ' / ' + site : ''));
      lowCheck(item_id, before); save();
    },
    async stockMove({ item_id, from, to, qty, note, op_id }) {
      await tick(); const u = need('stock');
      if (dupOp(op_id)) return; qty = +qty;
      if (!(qty > 0)) fail('수량을 1 이상으로 입력하세요.');
      if (!from || !to) fail('어디서 어디로 옮기는지 고르세요.');
      if (from === to) fail('같은 위치로는 옮길 수 없습니다.');
      const a = stockRow(item_id, from);
      if (a.qty < qty) fail('보내는 위치에 ' + a.qty + '개밖에 없습니다.');
      a.qty -= qty; stockRow(item_id, to).qty += qty;
      const it = byId(D.items, item_id);
      D.tx.unshift({ id: uid('t'), op_id, type: 'move', item_id, from_loc: from, to_loc: to, qty, site: '', note: note || '', user_id: u.id, created_at: now() });
      log('이동', 'item', item_id, itemLabel(it) + ' ' + qty + it.unit + ' ' + locPath(from) + ' → ' + locPath(to));
      save();
    },
    async stockCancel({ tx_id, op_id }) {
      await tick(); const u = me();
      if (dupOp(op_id)) return;
      const t = byId(D.tx, tx_id);
      if (!t) fail('기록을 찾지 못했습니다.');
      if (!can(u, 'cancel', t)) fail('본인이 7일 안에 한 기록만 취소할 수 있습니다. 그 밖에는 관리자에게 요청하세요.');
      if (t.canceled_by) fail('이미 취소된 기록입니다.');
      if (!['in', 'out', 'move'].includes(t.type)) fail('이 기록은 취소할 수 없습니다.');
      if (t.type === 'out') stockRow(t.item_id, t.from_loc).qty += t.qty;
      if (t.type === 'in') { const r = stockRow(t.item_id, t.to_loc); if (r.qty < t.qty) fail('이미 일부가 출고되어 입고를 취소할 수 없습니다.'); r.qty -= t.qty; }
      if (t.type === 'move') { const r = stockRow(t.item_id, t.to_loc); if (r.qty < t.qty) fail('옮긴 수량 중 일부가 이미 쓰여서 되돌릴 수 없습니다.'); r.qty -= t.qty; stockRow(t.item_id, t.from_loc).qty += t.qty; }
      const c = { id: uid('t'), op_id, type: 'cancel', item_id: t.item_id, from_loc: t.to_loc, to_loc: t.from_loc, qty: t.qty, site: t.site, note: TX_NAME[t.type] + ' 취소', user_id: u.id, created_at: now(), ref_tx: t.id };
      t.canceled_by = c.id; D.tx.unshift(c);
      const it = byId(D.items, t.item_id);
      log(TX_NAME[t.type] + ' 취소', 'item', t.item_id, itemLabel(it) + ' ' + t.qty + it.unit + ' 원상복구 (' + nameOf(t.user_id) + ' ' + fmtWhen(t.created_at) + ' 기록)');
      save();
    },
    async stockAdjust({ item_id, location_id, qty, reason, op_id }) {
      await tick(); const u = need('adjust');
      if (dupOp(op_id)) return; qty = +qty;
      if (!(qty >= 0)) fail('수량을 0 이상으로 입력하세요.');
      if (!reason) fail('정정 사유를 적어 주세요. 활동 기록에 남습니다.');
      const tb = totalOf(item_id); const r = stockRow(item_id, location_id); const before = r.qty; r.qty = qty;
      const it = byId(D.items, item_id);
      D.tx.unshift({ id: uid('t'), op_id, type: 'adjust', item_id, from_loc: location_id, to_loc: location_id, qty: qty - before, site: '', note: reason, user_id: u.id, created_at: now(), before, after: qty });
      log('수량 정정', 'item', item_id, itemLabel(it) + ' @' + locPath(location_id) + ' ' + before + ' → ' + qty + ' (사유: ' + reason + ')');
      lowCheck(item_id, tb); save();
    },

    /* 품목·위치·분류 */
    async saveItem(x) {
      await tick(); const u = me();
      const isNew = !x.id; const adm = can(u, 'item');
      if (isNew && !adm) fail('새 품목 등록은 관리자만 할 수 있습니다.');
      if ((isNew || x.name !== undefined) && !String(x.name || '').trim()) fail('품명을 입력하세요.');
      if (isNew) {
        const it = { id: uid('i'), name: x.name.trim(), spec: x.spec || '', maker: x.maker || '', models: x.models || '', category_id: x.category_id || null, unit: x.unit || '개', min_qty: +x.min_qty || 0, photo: x.photo || '', memo: x.memo || '', created_at: now(), updated_at: now() };
        D.items.push(it); log('품목 추가', 'item', it.id, itemLabel(it)); save(); return it.id;
      }
      const it = byId(D.items, x.id);
      const fields = adm ? ['name', 'spec', 'maker', 'models', 'category_id', 'unit', 'min_qty', 'photo', 'memo'] : ['memo', 'photo'];
      const changed = fields.filter(f => x[f] !== undefined && String(x[f]) !== String(it[f] ?? ''));
      changed.forEach(f => it[f] = f === 'min_qty' ? +x[f] || 0 : x[f]);
      it.updated_at = now();
      if (changed.length) log('품목 수정', 'item', it.id, itemLabel(it) + ' (' + changed.map(f => ({ name: '품명', spec: '규격', maker: '제조사', models: '적용 기종', category_id: '분류', unit: '단위', min_qty: '최소 재고', photo: '사진', memo: '메모' }[f])).join(', ') + ')');
      save(); return it.id;
    },
    async deleteItem(id) {
      await tick(); need('item'); const it = byId(D.items, id);
      if (totalOf(id) > 0) fail('재고가 남아 있는 품목은 지울 수 없습니다. 수량을 먼저 0으로 정정하세요.');
      it.deleted_at = now(); log('품목 삭제', 'item', id, itemLabel(it) + ' → 휴지통'); save();
    },
    async bulkItems(rows) {
      await tick(); need('item'); let n = 0;
      rows.forEach(r => {
        const it = { id: uid('i'), name: r.name, spec: r.spec || '', maker: r.maker || '', models: r.models || '', category_id: r.category_id || null, unit: r.unit || '개', min_qty: +r.min_qty || 0, photo: '', memo: r.memo || '', created_at: now(), updated_at: now() };
        D.items.push(it); n++;
        if (r.location_id && +r.qty > 0) {
          stockRow(it.id, r.location_id).qty += +r.qty;
          D.tx.unshift({ id: uid('t'), op_id: null, type: 'in', item_id: it.id, from_loc: null, to_loc: r.location_id, qty: +r.qty, site: '', note: '대량 등록 초기 수량', user_id: meId, created_at: now() });
        }
      });
      log('품목 대량 등록', 'item', null, n + '개 품목 등록'); save(); return n;
    },
    async saveLocation(x) {
      await tick(); need('location');
      if (!String(x.name || '').trim()) fail('위치 이름을 입력하세요.');
      if (!x.id) {
        const parent = byId(D.locations, x.parent_id);
        const l = { id: uid('l'), parent_id: x.parent_id || null, name: x.name.trim(), code: (x.code || '').trim().toUpperCase(), kind: parent ? (parent.parent_id ? 'slot' : 'unit') : 'zone', photo: x.photo || '', sort: D.locations.length };
        D.locations.push(l); log('위치 추가', 'location', l.id, locPath(l.id) + (l.code ? ' [' + l.code + ']' : '')); save(); return l.id;
      }
      const l = byId(D.locations, x.id); const old = locPath(l.id);
      ['name', 'code', 'photo'].forEach(f => { if (x[f] !== undefined) l[f] = f === 'code' ? String(x[f]).toUpperCase() : x[f]; });
      log('위치 수정', 'location', l.id, old + ' → ' + locPath(l.id)); save(); return l.id;
    },
    async deleteLocation(id) {
      await tick(); need('location');
      if (D.locations.some(l => l.parent_id === id && !l.deleted_at)) fail('안에 다른 위치가 있어 지울 수 없습니다. 안쪽 위치부터 정리하세요.');
      if (D.stock.some(s => s.location_id === id && s.qty > 0)) fail('이 위치에 자재가 남아 있습니다. 다른 위치로 옮긴 뒤 지우세요.');
      const l = byId(D.locations, id); l.deleted_at = now(); log('위치 삭제', 'location', id, locPath(id) + ' → 휴지통'); save();
    },
    async saveCategory(x) {
      await tick(); need('category');
      if (!String(x.name || '').trim()) fail('분류 이름을 입력하세요.');
      if (!x.id) { const c = { id: uid('c'), parent_id: x.parent_id || null, name: x.name.trim(), sort: D.categories.length }; D.categories.push(c); log('분류 추가', 'category', c.id, c.name); save(); return c.id; }
      const c = byId(D.categories, x.id); const old = c.name; c.name = x.name.trim(); log('분류 수정', 'category', c.id, old + ' → ' + c.name); save(); return c.id;
    },
    async deleteCategory(id) {
      await tick(); need('category');
      if (D.categories.some(c => c.parent_id === id && !c.deleted_at)) fail('안에 하위 분류가 있어 지울 수 없습니다.');
      if (D.items.some(i => i.category_id === id && !i.deleted_at)) fail('이 분류에 품목이 있습니다. 품목의 분류를 먼저 바꾸세요.');
      const c = byId(D.categories, id); c.deleted_at = now(); log('분류 삭제', 'category', id, c.name); save();
    },

    /* 자료 */
    async mkdir({ parent_id, name, auto_sort }) {
      await tick(); need('mkdir');
      if (!String(name || '').trim()) fail('폴더 이름을 입력하세요.');
      if (D.folders.some(f => !f.deleted_at && f.parent_id === (parent_id || null) && f.name === name.trim())) fail('같은 이름의 폴더가 이미 있습니다.');
      const f = { id: uid('f'), parent_id: parent_id || null, name: name.trim(), auto_sort: !!auto_sort, created_by: meId, created_at: now() };
      D.folders.push(f); log('폴더 만들기', 'folder', f.id, folderPath(f.id)); save(); return f.id;
    },
    async renameFolder(id, name) {
      await tick(); need('folderAdmin'); const f = byId(D.folders, id); const old = folderPath(id);
      if (!String(name || '').trim()) fail('폴더 이름을 입력하세요.');
      f.name = name.trim(); log('폴더 이름 변경', 'folder', id, old + ' → ' + f.name); save();
    },
    async moveFolder(id, parent_id) {
      await tick(); need('folderAdmin');
      let p = parent_id; while (p) { if (p === id) fail('폴더를 자기 안쪽으로 옮길 수 없습니다.'); p = (byId(D.folders, p) || {}).parent_id; }
      const f = byId(D.folders, id); const old = folderPath(id); f.parent_id = parent_id || null;
      log('폴더 이동', 'folder', id, old + ' → ' + folderPath(id)); save();
    },
    async deleteFolder(id) {
      await tick(); need('folderAdmin'); const f = byId(D.folders, id); const t = now();
      const all = [id]; for (let i = 0; i < all.length; i++) D.folders.filter(x => x.parent_id === all[i] && !x.deleted_at).forEach(x => all.push(x.id));
      const nDocs = D.docs.filter(d => all.includes(d.folder_id) && !d.deleted_at).length;
      all.forEach(fid => { const x = byId(D.folders, fid); x.deleted_at = t; x.del_root = id; });
      D.docs.filter(d => all.includes(d.folder_id) && !d.deleted_at).forEach(d => { d.deleted_at = t; d.del_root = id; });
      log('폴더 삭제', 'folder', id, folderPath(id) + ' (안의 폴더 ' + (all.length - 1) + '개, 파일 ' + nDocs + '개 포함) → 휴지통'); save();
    },
    async upload(folder_id, file) {
      await tick(); need('upload');
      let target = folder_id; const f = byId(D.folders, folder_id);
      if (f && f.auto_sort) { // 업무일지처럼 자동 분류: 연/월 폴더를 만들어 넣는다
        const d = new Date(file.lastModified || Date.now());
        const y = String(d.getFullYear()), m = pad(d.getMonth() + 1);
        let fy = D.folders.find(x => !x.deleted_at && x.parent_id === folder_id && x.name === y);
        if (!fy) { fy = { id: uid('f'), parent_id: folder_id, name: y, created_by: meId, created_at: now() }; D.folders.push(fy); }
        let fm = D.folders.find(x => !x.deleted_at && x.parent_id === fy.id && x.name === m);
        if (!fm) { fm = { id: uid('f'), parent_id: fy.id, name: m, created_by: meId, created_at: now() }; D.folders.push(fm); }
        target = fm.id;
      }
      const doc = { id: uid('d'), folder_id: target, name: file.name, kind: 'file', mime: file.type, size: file.size, store_no: 1, uploaded_by: meId, created_at: now() };
      if (file.type.startsWith('image/') && file.size < 6e6) { try { doc.dataurl = await blobToDataURL(await shrinkImage(file, 1000, .75)); } catch {} }
      D.docs.push(doc); D.status.storage_used += file.size;
      log('파일 올리기', 'doc', doc.id, folderPath(target) + ' › ' + file.name + ' (' + fmtSize(file.size) + ')'); save();
      return { id: doc.id, folder_id: target };
    },
    async addLink(folder_id, { name, url }) {
      await tick(); need('upload');
      if (!String(name || '').trim()) fail('제목을 입력하세요.');
      if (!/^https?:\/\//.test(url || '')) fail('주소는 https:// 로 시작해야 합니다.');
      const video = /youtu\.?be/.test(url);
      const doc = { id: uid('d'), folder_id, name: name.trim(), kind: video ? 'video' : 'link', url, size: null, uploaded_by: meId, created_at: now() };
      D.docs.push(doc); log(video ? '영상 등록' : '링크 등록', 'doc', doc.id, folderPath(folder_id) + ' › ' + doc.name); save(); return doc.id;
    },
    async renameDoc(id, name) { await tick(); need('docAdmin'); const d = byId(D.docs, id); const old = d.name; if (!String(name || '').trim()) fail('파일 이름을 입력하세요.'); d.name = name.trim(); log('파일 이름 변경', 'doc', id, old + ' → ' + d.name); save(); },
    async moveDoc(id, folder_id) { await tick(); need('docAdmin'); const d = byId(D.docs, id); const old = folderPath(d.folder_id); d.folder_id = folder_id; log('파일 이동', 'doc', id, d.name + ': ' + old + ' → ' + folderPath(folder_id)); save(); },
    async deleteDoc(id) { await tick(); need('docAdmin'); const d = byId(D.docs, id); d.deleted_at = now(); d.del_root = null; log('파일 삭제', 'doc', id, folderPath(d.folder_id) + ' › ' + d.name + ' → 휴지통'); save(); },
    async docData(id) { const d = byId(D.docs, id); return d ? d.dataurl || null : null; },

    async trash() {
      await tick(); need('trash'); const lim = Date.now() - 30 * 864e5;
      const out = [];
      D.folders.filter(f => f.deleted_at && f.del_root === f.id && new Date(f.deleted_at) > lim).forEach(f => out.push({ type: 'folder', id: f.id, name: f.name, where: folderPath(f.parent_id) || '자료', at: f.deleted_at }));
      D.docs.filter(d => d.deleted_at && !d.del_root && new Date(d.deleted_at) > lim).forEach(d => out.push({ type: 'doc', id: d.id, name: d.name, where: folderPath(d.folder_id), at: d.deleted_at }));
      D.items.filter(i => i.deleted_at && new Date(i.deleted_at) > lim).forEach(i => out.push({ type: 'item', id: i.id, name: itemLabel(i), where: '자재', at: i.deleted_at }));
      D.locations.filter(l => l.deleted_at && new Date(l.deleted_at) > lim).forEach(l => out.push({ type: 'location', id: l.id, name: l.name, where: '위치', at: l.deleted_at }));
      return out.sort((a, b) => b.at.localeCompare(a.at));
    },
    async restore(type, id) {
      await tick(); need('trash');
      if (type === 'folder') { D.folders.filter(f => f.del_root === id).forEach(f => { f.deleted_at = null; f.del_root = null; }); D.docs.filter(d => d.del_root === id).forEach(d => { d.deleted_at = null; d.del_root = null; }); }
      else { const arr = { doc: D.docs, item: D.items, location: D.locations }[type]; const x = byId(arr, id); x.deleted_at = null; }
      const nm = type === 'folder' ? folderPath(id) : type === 'doc' ? byId(D.docs, id).name : type === 'item' ? itemLabel(byId(D.items, id)) : byId(D.locations, id).name;
      log('휴지통에서 복원', type, id, nm); save();
    },

    async search(q) {
      await tick(); q = q.trim().toLowerCase(); if (!q) return { items: [], docs: [] };
      const hit = s => String(s || '').toLowerCase().includes(q);
      return clone({
        items: D.items.filter(i => !i.deleted_at && (hit(i.name) || hit(i.spec) || hit(i.maker) || hit(i.models) || hit(i.memo))).map(i => i.id),
        docs: D.docs.filter(d => !d.deleted_at && (hit(d.name) || (d.text && hit(d.text)))).map(d => ({ id: d.id, inside: !hit(d.name) }))
      });
    },

    /* 댓글·알림 */
    async comments(target_type, target_id) {
      await tick();
      return clone(D.comments.filter(c => c.target_type === target_type && c.target_id === target_id && !c.deleted_at).map(c => ({ ...c, name: nameOf(c.user_id) })));
    },
    async addComment(target_type, target_id, body) {
      await tick(); const u = need('comment'); body = String(body || '').trim(); if (!body) fail('내용을 입력하세요.');
      const c = { id: uid('c'), target_type, target_id, user_id: u.id, body, created_at: now() };
      D.comments.push(c);
      const tname = target_type === 'item' ? itemLabel(byId(D.items, target_id)) : byId(D.docs, target_id).name;
      const others = D.comments.filter(x => x.target_type === target_type && x.target_id === target_id).map(x => x.user_id);
      if (target_type === 'doc') others.push(byId(D.docs, target_id).uploaded_by);
      notify(others.filter(id => id !== u.id), { kind: 'comment', title: u.name + '님의 댓글: ' + tname, body: body.slice(0, 80), link: target_type === 'item' ? { tab: 'items', view: 'item', id: target_id } : { tab: 'docs', view: 'doc', id: target_id } });
      log('댓글', target_type, target_id, tname + ': ' + body.slice(0, 40)); save();
    },
    async deleteComment(id) {
      await tick(); const c = byId(D.comments, id); if (!can(me(), 'delComment', c)) fail('본인 댓글만 지울 수 있습니다.');
      c.deleted_at = now(); log('댓글 삭제', c.target_type, c.target_id, c.body.slice(0, 40)); save();
    },
    async notifications() { await tick(); return clone(D.notifs.filter(n => n.user_id === meId).slice(0, 60)); },
    async unreadCount() { return D.notifs.filter(n => n.user_id === meId && !n.read_at).length; },
    async markAllRead() { D.notifs.forEach(n => { if (n.user_id === meId && !n.read_at) n.read_at = now(); }); save(); },

    /* 계정 관리 */
    async users() { await tick(); need('users'); return clone(D.profiles); },
    async approve(ids) {
      await tick(); need('users');
      ids.forEach(id => { const p = byId(D.profiles, id); if (p && p.status === 'pending') { p.status = 'active'; p.approved_by = meId; p.approved_at = now(); log('가입 승인', 'account', id, p.name + ' (' + p.emp_no + ')'); notify([id], { kind: 'welcome', title: '가입이 승인되었습니다', body: '이제 모든 기능을 쓸 수 있습니다.', link: { tab: 'items' } }); } });
      save();
    },
    async reject(id) { await tick(); need('users'); const p = byId(D.profiles, id); D.profiles = D.profiles.filter(x => x.id !== id); log('가입 거절', 'account', id, p.name + ' (' + p.emp_no + ')'); save(); },
    async setRole(id, role) {
      await tick(); const u = need('users'); const p = byId(D.profiles, id);
      if ((role === 'dev' || p.role === 'dev') && !can(u, 'setDev')) fail('개발자 권한은 개발자만 바꿀 수 있습니다.');
      if (id === u.id) fail('본인 권한은 바꿀 수 없습니다.');
      const old = p.role; p.role = role; log('권한 변경', 'account', id, p.name + ': ' + ROLE_NAME[old] + ' → ' + ROLE_NAME[role]); save();
    },
    async resetPassword(id) {
      await tick(); need('users'); const p = byId(D.profiles, id);
      const tmp = String(Math.floor(100000 + Math.random() * 900000));
      D.pw[id] = tmp; log('비밀번호 초기화', 'account', id, p.name + ' (' + p.emp_no + ')'); save(); return tmp;
    },
    async setActive(id, on) {
      await tick(); const u = need('users'); const p = byId(D.profiles, id);
      if (id === u.id) fail('본인 계정은 중지할 수 없습니다.');
      if (p.role === 'dev' && !can(u, 'setDev')) fail('개발자 계정은 개발자만 바꿀 수 있습니다.');
      p.status = on ? 'active' : 'disabled'; log(on ? '계정 다시 사용' : '계정 사용 중지', 'account', id, p.name + ' (' + p.emp_no + ')'); save();
    },
    async audit({ kind, actor } = {}) {
      await tick(); need('audit');
      const map = { stock: ['item'], docs: ['doc', 'folder'], account: ['account'], place: ['location', 'category'] };
      return clone(D.audit.filter(a => (!kind || (kind === 'comment' ? a.action.startsWith('댓글') : (map[kind] || []).includes(a.target_type) && !a.action.startsWith('댓글'))) && (!actor || a.actor_id === actor)).slice(0, 300));
    },
    async status() { await tick(); return clone(D.status); },

    /* 체험판 전용 */
    reset() { D = seed(); meId = null; save(); store.del(KEY + '-me'); }
  };

  function folderPath(id) { const out = []; let n = byId(D.folders, id); while (n) { out.unshift(n.name); n = byId(D.folders, n.parent_id); } return out.join(' › '); }
  return api;

  /* ───────── 예시 데이터 ───────── */
  function seed() {
    const T = (daysAgo, h = 9, m = 0) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const profiles = [
      ['u1', '1001', '재석', 'dev', 'active'], ['u2', '1002', '김도윤', 'admin', 'active'], ['u3', '1003', '박성호', 'staff', 'active'],
      ['u4', '1004', '이준영', 'staff', 'active'], ['u5', '1005', '최현우', 'staff', 'active'], ['u6', '1006', '정민석', 'staff', 'active'],
      ['u7', '1011', '한지수', 'staff', 'pending'], ['u8', '1012', '윤태경', 'staff', 'pending'], ['u9', '0998', '서동현', 'staff', 'disabled']
    ].map(([id, emp_no, name, role, status], i) => ({ id, emp_no, name, role, status, phone: '', created_at: T(40 - i) }));
    profiles[6].created_at = T(0, 8, 12); profiles[7].created_at = T(0, 8, 40);
    const L = (id, parent_id, name, code, kind) => ({ id, parent_id, name, code, kind, photo: '', sort: 0 });
    const locations = [
      L('L1', null, '사무실 캐비넷', 'OF', 'zone'),
      L('L11', 'L1', '캐비넷 1', 'OF-C1', 'unit'), L('L111', 'L11', '상단', 'OF-C1-상', 'slot'), L('L112', 'L11', '하단', 'OF-C1-하', 'slot'),
      L('L12', 'L1', '캐비넷 2', 'OF-C2', 'unit'),
      L('L2', null, '당직실 앞 캐비넷', 'DT', 'zone'), L('L21', 'L2', '캐비넷 A', 'DT-A', 'unit'), L('L22', 'L2', '캐비넷 B', 'DT-B', 'unit'),
      L('L3', null, '창고', 'WH', 'zone'),
      L('L31', 'L3', '선반 1', 'WH-S1', 'unit'), L('L311', 'L31', '상단', 'WH-S1-상', 'slot'), L('L312', 'L31', '중단', 'WH-S1-중', 'slot'), L('L313', 'L31', '하단', 'WH-S1-하', 'slot'),
      L('L32', 'L3', '선반 2', 'WH-S2', 'unit'),
      L('L33', 'L3', '선반 3', 'WH-S3', 'unit'), L('L331', 'L33', '상단', 'WH-S3-상', 'slot'), L('L332', 'L33', '하단', 'WH-S3-하', 'slot'),
      L('L34', 'L3', '선반 4', 'WH-S4', 'unit'),
      L('L4', null, '밀양사무실', 'MY', 'zone'), L('L41', 'L4', '캐비넷 1', 'MY-C1', 'unit')
    ].map((l, i) => ({ ...l, sort: i }));
    const C = (id, parent_id, name) => ({ id, parent_id, name, sort: 0 });
    const categories = [
      C('C1', null, '도어 부품'), C('C11', 'C1', '롤러·슈'), C('C12', 'C1', '스위치·인터록'), C('C13', 'C1', '벨트·구동'),
      C('C2', null, '전장 부품'), C('C21', 'C2', '릴레이·접촉기'), C('C22', 'C2', '퓨즈'), C('C23', 'C2', '버튼·표시기'), C('C24', 'C2', '센서·엔코더'),
      C('C3', null, '기계 부품'), C('C31', 'C3', '가이드·라이너'), C('C32', 'C3', '브레이크'),
      C('C4', null, '안전·비상'), C('C5', null, '소모품')
    ].map((c, i) => ({ ...c, sort: i }));
    const I = (id, name, spec, maker, models, category_id, unit, min_qty, memo = '') => ({ id, name, spec, maker, models, category_id, unit, min_qty, photo: '', memo, created_at: T(60), updated_at: T(60) });
    const items = [
      I('i1', '도어 롤러', 'Ø50 행거용', '현대엘리베이터', 'STVF 계열', 'C11', '개', 6),
      I('i2', '도어 롤러', 'Ø62 행거용', '오티스', 'GEN2', 'C11', '개', 4, '행거 쪽 롤러. 편심 롤러와 헷갈리지 않게 봉투에 이름 적어 둠.'),
      I('i3', '도어 롤러', 'Ø45 편심', '미쓰비시', '', 'C11', '개', 4),
      I('i4', '도어 슈', '카도어용 18mm', '공용', '', 'C11', '개', 10),
      I('i5', '도어 인터록 스위치', '홀도어용', '현대엘리베이터', '', 'C12', '개', 3),
      I('i6', '도어 인터록 스위치', '홀도어용', '티센크루프', '', 'C12', '개', 2),
      I('i7', '도어 모터 벨트', '치형', '미쓰비시', '', 'C13', '개', 2),
      I('i8', '전자접촉기', 'MC-32a AC220V', 'LS ELECTRIC', '', 'C21', '개', 4),
      I('i9', '릴레이', 'MY4N DC24V', '오므론', '', 'C21', '개', 10),
      I('i10', '릴레이 소켓', 'PYF14A', '오므론', '', 'C21', '개', 10),
      I('i11', '퓨즈', '미니 10A', '', '', 'C22', '개', 20),
      I('i12', '퓨즈', '미니 5A', '', '', 'C22', '개', 20),
      I('i13', '홀 버튼', '원형 푸시버튼 LED 백색', '현대엘리베이터', '', 'C23', '개', 5),
      I('i14', '층 표시기 기판', '도트 매트릭스', '동양', '', 'C23', '개', 1),
      I('i15', '리미트 스위치', '롤러 레버형', '', '', 'C24', '개', 3),
      I('i16', '로터리 엔코더', '1024P/R', '', '', 'C24', '개', 1),
      I('i17', '가이드 슈 라이너', '카용 16mm 레일', '공용', '', 'C31', '개', 8),
      I('i18', '브레이크 라이닝', '권상기용', '미쓰비시', '', 'C32', '세트', 2),
      I('i19', '비상등 배터리', '7.2V Ni-Cd', '공용', '', 'C4', '개', 4),
      I('i20', '인터폰 핸드셋', '카 내부용', '공용', '', 'C4', '개', 2),
      I('i21', '케이블 타이', '200mm 흑색', '', '', 'C5', '봉', 5),
      I('i22', '절연 테이프', '흑색 19mm', '', '', 'C5', '개', 10),
      I('i23', '그리스', '레일·도어용', '', '', 'C5', '통', 2)
    ];
    const stock = [
      ['i1', 'L311', 12], ['i1', 'L111', 4], ['i2', 'L311', 3], ['i3', 'L311', 8], ['i4', 'L312', 26], ['i4', 'L21', 6],
      ['i5', 'L112', 5], ['i6', 'L112', 1], ['i7', 'L32', 4], ['i8', 'L12', 7], ['i8', 'L41', 2], ['i9', 'L12', 22], ['i9', 'L22', 8],
      ['i10', 'L12', 15], ['i11', 'L22', 45], ['i12', 'L22', 12], ['i13', 'L111', 9], ['i14', 'L331', 2], ['i15', 'L332', 4],
      ['i16', 'L331', 1], ['i17', 'L32', 16], ['i18', 'L34', 2], ['i19', 'L21', 5], ['i19', 'L41', 1], ['i20', 'L21', 3],
      ['i21', 'L34', 9], ['i22', 'L22', 14], ['i23', 'L34', 3]
    ].map(([item_id, location_id, qty]) => ({ item_id, location_id, qty }));
    const X = (id, type, item_id, from_loc, to_loc, qty, user_id, at, site = '', note = '') => ({ id, op_id: null, type, item_id, from_loc, to_loc, qty, site, note, user_id, created_at: at });
    const tx = [
      X('t1', 'out', 'i2', 'L311', null, 2, 'u3', T(0, 10, 24), '한빛아파트 103동 2호기', '행거 롤러 소음'),
      X('t2', 'out', 'i9', 'L12', null, 1, 'u4', T(0, 9, 5), '중앙상가 1호기'),
      X('t3', 'in', 'i11', null, 'L22', 30, 'u2', T(1, 16, 40), '', '거래처 입고'),
      X('t4', 'move', 'i4', 'L312', 'L21', 6, 'u5', T(1, 8, 30), '', '당직 차량용'),
      X('t5', 'out', 'i6', 'L112', null, 1, 'u6', T(2, 14, 12), '삼문동 오피스텔 1호기'),
      X('t6', 'out', 'i12', 'L22', null, 3, 'u3', T(2, 11, 3), '푸른숲빌라 1호기'),
      X('t7', 'out', 'i1', 'L311', null, 2, 'u4', T(3, 15, 50), '대성병원 3호기'),
      X('t8', 'in', 'i1', null, 'L311', 10, 'u2', T(5, 10, 0), '', '정기 발주분'),
      X('t9', 'out', 'i19', 'L21', null, 1, 'u5', T(6, 17, 20), '한빛아파트 101동 1호기')
    ];
    const folders = [
      ['F1', null, '도면'], ['F11', 'F1', '현대 STVF'], ['F12', 'F1', '오티스 GEN2'], ['F13', 'F1', '미쓰비시 ELENESSA'], ['F14', 'F1', '동양'],
      ['F2', null, '매뉴얼·에러코드'], ['F3', null, '교육 자료'], ['F31', 'F3', '안전 교육'], ['F32', 'F3', '신입 교육'],
      ['F4', null, '업무일지'], ['F41', 'F4', '2026'], ['F411', 'F41', '09'], ['F412', 'F41', '10']
    ].map(([id, parent_id, name]) => ({ id, parent_id, name, auto_sort: id === 'F4', created_by: 'u1', created_at: T(30) }));
    const Dd = (id, folder_id, name, size, by, at, extra = {}) => ({ id, folder_id, name, kind: 'file', mime: '', size, store_no: 1, uploaded_by: by, created_at: at, ...extra });
    const docs = [
      Dd('d1', 'F11', 'STVF5 제어반 회로도.pdf', 8.4e6, 'u1', T(20), { text: '안전회로 도어 스위치 인터록 브레이크 MC 접촉기' }),
      Dd('d2', 'F11', 'STVF7 도어 결선도.pdf', 3.1e6, 'u1', T(20), { text: '도어 모터 인터록 결선' }),
      Dd('d3', 'F12', 'GEN2 에러코드 일람.pdf', 1.2e6, 'u2', T(14), { text: 'E-15 도어 존 E-21 속도 이상 엔코더 UCM' }),
      Dd('d4', 'F12', 'GEN2 도어 조정 절차.pdf', 2.6e6, 'u2', T(14)),
      Dd('d5', 'F13', 'ELENESSA 인버터 파라미터.xlsx', 4.1e5, 'u1', T(12)),
      Dd('d6', 'F2', '브레이크 간극 점검 기준.pdf', 9.2e5, 'u2', T(9), { text: '브레이크 라이닝 간극 권상기' }),
      Dd('d7', 'F31', '2026 하반기 안전교육.pptx', 1.2e7, 'u2', T(7)),
      { id: 'd8', folder_id: 'F31', name: '피트 작업 추락 방지 요령', kind: 'video', url: 'https://www.youtube.com/watch?v=example', size: null, uploaded_by: 'u2', created_at: T(7) },
      Dd('d9', 'F32', '신입 교육 체크리스트.docx', 2.2e5, 'u2', T(25)),
      Dd('d10', 'F411', '업무일지_2026-09.xlsx', 6.4e5, 'u4', T(1)),
      Dd('d11', 'F412', '업무일지_2026-10.xlsx', 1.1e5, 'u4', T(0, 8, 2)),
      Dd('d12', 'F2', '리미트 스위치 교체 위치.jpg', 1.8e6, 'u5', T(4))
    ];
    const comments = [
      { id: 'c1', target_type: 'item', target_id: 'i2', user_id: 'u3', body: '한빛 103동 2호기 행거 롤러 2개 교체했습니다. 남은 게 3개라 발주 필요해 보여요.', created_at: T(0, 10, 30) },
      { id: 'c2', target_type: 'item', target_id: 'i2', user_id: 'u2', body: '이번 주 목요일 발주 넣겠습니다.', created_at: T(0, 11, 2) },
      { id: 'c3', target_type: 'doc', target_id: 'd3', user_id: 'u5', body: 'E-15 나오면 도어 존 센서부터 확인. 7쪽에 있음.', created_at: T(3, 18, 0) }
    ];
    const notifs = [];
    const add = (user_id, kind, title, body, link, at, read) => notifs.push({ id: uid('n'), user_id, kind, title, body, link, created_at: at, read_at: read ? at : null });
    ['u1', 'u2'].forEach(u => {
      add(u, 'signup', '가입 신청: 윤태경', '사내번호 1012', { tab: 'more', view: 'users' }, T(0, 8, 40));
      add(u, 'signup', '가입 신청: 한지수', '사내번호 1011', { tab: 'more', view: 'users' }, T(0, 8, 12));
      add(u, 'low', '재고 부족: 도어 롤러 · Ø62 행거용', '남은 수량 3개 / 최소 4개', { tab: 'items', view: 'item', id: 'i2' }, T(0, 10, 24));
      add(u, 'low', '재고 부족: 퓨즈 · 미니 5A', '남은 수량 12개 / 최소 20개', { tab: 'items', view: 'item', id: 'i12' }, T(2, 11, 3), true);
    });
    add('u3', 'comment', '김도윤님의 댓글: 도어 롤러 · Ø62 행거용', '이번 주 목요일 발주 넣겠습니다.', { tab: 'items', view: 'item', id: 'i2' }, T(0, 11, 2));
    add('u3', 'welcome', '앱 사용을 시작했습니다', '자재 탭에서 위치별·분류별로 찾아보세요.', { tab: 'items' }, T(30), true);
    const audit = [];
    const A = (at, actor_id, action, target_type, target_id, summary) => audit.push({ id: uid('a'), at, actor_id, actor_name: profiles.find(p => p.id === actor_id).name, action, target_type, target_id, summary });
    A(T(0, 11, 2), 'u2', '댓글', 'item', 'i2', '도어 롤러 · Ø62 행거용: 이번 주 목요일 발주 넣겠습니다.');
    A(T(0, 10, 30), 'u3', '댓글', 'item', 'i2', '도어 롤러 · Ø62 행거용: 한빛 103동 2호기 행거 롤러 2개 교체했습니다.');
    A(T(0, 10, 24), 'u3', '출고', 'item', 'i2', '도어 롤러 · Ø62 행거용 2개 ← 창고 › 선반 1 › 상단 / 한빛아파트 103동 2호기');
    A(T(0, 9, 5), 'u4', '출고', 'item', 'i9', '릴레이 · MY4N DC24V 1개 ← 사무실 캐비넷 › 캐비넷 2 / 중앙상가 1호기');
    A(T(0, 8, 40), 'u8', '가입 신청', 'account', 'u8', '윤태경 (1012) 가입 신청');
    A(T(0, 8, 12), 'u7', '가입 신청', 'account', 'u7', '한지수 (1011) 가입 신청');
    A(T(0, 8, 2), 'u4', '파일 올리기', 'doc', 'd11', '업무일지 › 2026 › 10 › 업무일지_2026-10.xlsx (110KB)');
    A(T(1, 16, 40), 'u2', '입고', 'item', 'i11', '퓨즈 · 미니 10A 30개 → 당직실 앞 캐비넷 › 캐비넷 B');
    A(T(1, 8, 30), 'u5', '이동', 'item', 'i4', '도어 슈 · 카도어용 18mm 6개 창고 › 선반 1 › 중단 → 당직실 앞 캐비넷 › 캐비넷 A');
    A(T(2, 14, 12), 'u6', '출고', 'item', 'i6', '도어 인터록 스위치 · 홀도어용 1개 ← 사무실 캐비넷 › 캐비넷 1 › 하단 / 삼문동 오피스텔 1호기');
    A(T(3, 9, 0), 'u2', '폴더 만들기', 'folder', 'F14', '도면 › 동양');
    A(T(9, 13, 0), 'u2', '위치 수정', 'location', 'L34', '창고 › 선반 4 사진 교체');
    const status = { last_ping: T(0, 3, 0), last_backup: T(0, 3, 1), backup_file: '가야앱_백업_' + fmtDate(T(0)).replace(/\. ?/g, '-').replace(/-$/, '') + '.xlsx', last_ping2: T(1, 15, 0), storage_used: 1.34e9, storage_total: 15 * 1073741824, stores: [{ no: 1, email: 'gaya.elevator.app@gmail.com' }] };
    return { profiles, pw: {}, locations, categories, items, stock, tx, folders, docs, comments, notifs, audit, status };
  }
}

/* ───────── 실서버(Supabase) 데이터 계층 ─────────
   체험판(makeDemoAPI)과 같은 이름·같은 동작의 함수를 제공한다.
   저장은 전부 서버 함수(RPC)로 하며, 권한 확인과 활동 기록은 서버가 한다.
   자료 파일 실물은 구글 앱스 스크립트(DRIVE_STORES)를 거쳐 회사용 구글 드라이브에 저장한다. */
function makeLiveAPI() {
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'gaya-auth' }
  });
  let me = null;
  const email = emp => String(emp).trim().toLowerCase() + '@' + CONFIG.EMAIL_DOMAIN;
  function errMsg(e) {
    const m = (e && (e.message || e.error_description || e.msg)) || String(e);
    if (/Invalid login credentials/i.test(m)) return '사내번호 또는 비밀번호가 맞지 않습니다.';
    if (/already registered|already exists|duplicate key.*emp_no/i.test(m)) return '이미 가입된 사내번호입니다. 비밀번호를 잊었다면 관리자에게 초기화를 요청하세요.';
    if (/banned/i.test(m)) return '사용이 중지된 계정입니다. 관리자에게 문의하세요.';
    if (/rate limit|too many/i.test(m)) return '요청이 한꺼번에 몰렸습니다. 1~2분 뒤에 다시 시도하세요.';
    if (/Password should be at least/i.test(m)) return '비밀번호는 6자 이상으로 정하세요.';
    if (/Email not confirmed/i.test(m)) return '관리자 설정 확인이 필요합니다 (Supabase › Authentication › Confirm email 끄기).';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Failed to fetch';
    if (/JWT expired|invalid JWT/i.test(m)) return '로그인이 만료되었습니다. 다시 로그인하세요.';
    return m.replace(/^.*?ERROR:\s*/, '');
  }
  const E = e => new Error(errMsg(e));
  async function q(p) { const { data, error } = await p; if (error) throw E(error); return data; }
  const rpc = (fn, args = {}) => q(sb.rpc(fn, args));
  async function all(table, cols, build = x => x) { // 1000개씩 끊어 전부 받기
    const out = []; for (let from = 0; ; from += 1000) {
      const rows = await q(build(sb.from(table).select(cols)).range(from, from + 999));
      out.push(...rows); if (rows.length < 1000) return out;
    }
  }
  async function profile(id) { return q(sb.from('profiles').select('*').eq('id', id).maybeSingle()); }
  const pathNames = id => (S.ix ? pathOf(S.ix.folder, id).map(f => f.name) : []);

  /* 구글 드라이브 창고 (앱스 스크립트 웹앱) */
  const stores = () => (CONFIG.DRIVE_STORES || []).filter(s => s.url);
  const storeUrl = no => { const s = stores(); const hit = s.find(x => x.no === no); return (hit || s[s.length - 1] || {}).url; };
  async function drive(action, payload = {}, storeNo) {
    const url = storeUrl(storeNo); if (!url) throw new Error('자료 저장소가 아직 연결되지 않았습니다. 개발자에게 알려 주세요.');
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: session && session.access_token, action, ...payload }) });
    const j = await r.json().catch(() => ({ ok: false, error: '저장소 응답을 읽지 못했습니다.' }));
    if (!j.ok) throw new Error(j.error || '저장소 작업 실패');
    return j;
  }
  const driveAll = async (action, payload) => { for (const s of stores()) { try { await drive(action, payload, s.no); } catch (e) { console.warn('drive', action, e); } } };
  const b64 = buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  async function driveUpload(path, file) {
    const cur = stores(); const no = (cur[cur.length - 1] || {}).no;
    const SMALL = 20 * 1048576, CH = 8 * 1048576;
    if (file.size <= SMALL) {
      const r = await drive('upload', { path, name: file.name, mime: file.type || 'application/octet-stream', data: b64(await file.arrayBuffer()) }, no);
      return { id: r.id, store: no };
    }
    const st = await drive('uploadStart', { path, name: file.name, mime: file.type || 'application/octet-stream', size: file.size }, no);
    let res = null;
    for (let start = 0; start < file.size; start += CH) {
      const end = Math.min(file.size, start + CH);
      S.toast = { msg: `큰 파일 올리는 중 ${Math.round(end / file.size * 100)}% · ${file.name}` }; render();
      res = await drive('uploadChunk', { session: st.session, start, end, total: file.size, data: b64(await file.slice(start, end).arrayBuffer()) }, no);
    }
    if (!res || !res.id) throw new Error('큰 파일 올리기를 마치지 못했습니다.');
    return { id: res.id, store: no };
  }

  return {
    demo: false,
    async session() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      me = await profile(session.user.id);
      if (me && me.status === 'disabled') { await sb.auth.signOut(); return null; }
      return me;
    },
    async login(emp_no, pw) {
      const { data, error } = await sb.auth.signInWithPassword({ email: email(emp_no), password: pw });
      if (error) throw E(error);
      me = await profile(data.user.id);
      if (!me) throw new Error('계정 정보를 찾지 못했습니다. 관리자에게 문의하세요.');
      if (me.status === 'disabled') { await sb.auth.signOut(); throw new Error('사용이 중지된 계정입니다. 관리자에게 문의하세요.'); }
      if (me.status === 'active') rpc('log_event', { p_action: '로그인', p_summary: me.name + ' 로그인' }).catch(() => {});
      return me;
    },
    async signup({ emp_no, name, phone, pw }) {
      emp_no = String(emp_no).trim(); name = String(name).trim();
      if (!/^[A-Za-z0-9-]{2,20}$/.test(emp_no)) throw new Error('사내번호는 영문·숫자 2~20자로 입력하세요.');
      if (!name) throw new Error('실명을 입력하세요.');
      if (!pw || pw.length < 6) throw new Error('비밀번호는 6자 이상으로 정하세요.');
      const { data, error } = await sb.auth.signUp({ email: email(emp_no), password: pw, options: { data: { emp_no, name, phone: phone || '' } } });
      if (error) throw E(error);
      if (!data.session) throw new Error('가입 신청은 들어갔지만 관리자 설정이 한 가지 남아 있습니다 (Supabase › Authentication › Confirm email 끄기). 개발자에게 알려 주세요.');
      if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw new Error('이미 가입된 사내번호입니다.');
      me = await profile(data.user.id);
      return me;
    },
    async logout() { await sb.auth.signOut(); me = null; store.del('gaya-cache'); store.del('gaya-user'); },
    async changePassword(oldPw, newPw) {
      if (!newPw || newPw.length < 6) throw new Error('새 비밀번호는 6자 이상으로 정하세요.');
      const chk = await sb.auth.signInWithPassword({ email: email(me.emp_no), password: oldPw });
      if (chk.error) throw new Error('지금 비밀번호가 맞지 않습니다.');
      const { error } = await sb.auth.updateUser({ password: newPw }); if (error) throw E(error);
      await rpc('log_event', { p_action: '비밀번호 변경', p_summary: me.name + ' 본인 비밀번호 변경' });
    },

    async bootstrap() {
      const nd = x => x.is('deleted_at', null);
      const [locations, categories, items, stock, people, folders, docs] = await Promise.all([
        all('locations', '*', nd), all('categories', '*', nd), all('items', '*', nd),
        all('stock', 'item_id,location_id,qty', x => x.gt('qty', 0)), all('profiles', 'id,name,role,status'),
        all('folders', '*', nd), all('docs', 'id,folder_id,name,kind,mime,size,drive_id,store_no,url,uploaded_by,created_at', nd)
      ]);
      return { locations, categories, items, stock, people, folders, docs };
    },
    async txList({ item_id, location_id, limit = 50 } = {}) {
      let x = sb.from('tx').select('*').order('created_at', { ascending: false }).limit(limit);
      if (item_id) x = x.eq('item_id', item_id);
      if (location_id) x = x.or(`from_loc.eq.${location_id},to_loc.eq.${location_id}`);
      return q(x);
    },
    stockIn: d => rpc('stock_in', { p_item: d.item_id, p_loc: d.location_id, p_qty: +d.qty, p_note: d.note || '', p_op: d.op_id }),
    stockOut: d => rpc('stock_out', { p_item: d.item_id, p_loc: d.location_id, p_qty: +d.qty, p_site: d.site || '', p_note: d.note || '', p_op: d.op_id }),
    stockMove: d => rpc('stock_move', { p_item: d.item_id, p_from: d.from, p_to: d.to, p_qty: +d.qty, p_note: d.note || '', p_op: d.op_id }),
    stockCancel: d => rpc('stock_cancel', { p_tx: d.tx_id, p_op: d.op_id }),
    stockAdjust: d => rpc('stock_adjust', { p_item: d.item_id, p_loc: d.location_id, p_qty: +d.qty, p_reason: d.reason || '', p_op: d.op_id }),

    saveItem: x => { const p = { ...x }; delete p.op_id; delete p.created_at; delete p.updated_at; delete p.deleted_at; return rpc('item_save', { p }); },
    deleteItem: id => rpc('item_delete', { p_id: id }),
    bulkItems: rows => rpc('items_bulk', { p_rows: rows }),
    saveLocation: x => rpc('location_save', { p: { id: x.id || null, parent_id: x.parent_id || null, name: x.name, code: x.code || '', photo: x.photo || '' } }),
    deleteLocation: id => rpc('location_delete', { p_id: id }),
    saveCategory: x => rpc('category_save', { p: { id: x.id || null, parent_id: x.parent_id || null, name: x.name } }),
    deleteCategory: id => rpc('category_delete', { p_id: id }),

    mkdir: ({ parent_id, name, auto_sort }) => rpc('folder_create', { p_parent: parent_id || null, p_name: name, p_auto: !!auto_sort }),
    async renameFolder(id, name) { const old = pathNames(id); await rpc('folder_rename', { p_id: id, p_name: name }); await driveAll('renamePath', { path: old, name: String(name).trim() }); },
    async moveFolder(id, parent_id) { const old = pathNames(id); await rpc('folder_move', { p_id: id, p_parent: parent_id || null }); await driveAll('movePath', { path: old, to: parent_id ? pathNames(parent_id) : [] }); },
    async deleteFolder(id) { const p = pathNames(id); await rpc('folder_delete', { p_id: id }); await driveAll('trashPath', { path: p }); },
    async upload(folder_id, file) {
      if (file.size > 400 * 1048576) throw new Error('400MB가 넘는 파일은 올릴 수 없습니다. 영상은 유튜브에 올린 뒤 링크로 등록하세요.');
      const f = S.ix.folder.get(folder_id); let target = folder_id; let path = pathNames(folder_id);
      if (f && f.auto_sort) {
        const d = new Date(file.lastModified || Date.now()); const y = String(d.getFullYear()), m = pad(d.getMonth() + 1);
        target = await rpc('folder_ensure', { p_parent: folder_id, p_names: [y, m] }); path = [...path, y, m];
      }
      const up = await driveUpload(path, file);
      const id = await rpc('doc_add', { p_folder: target, p_name: file.name, p_kind: 'file', p_mime: file.type || '', p_size: file.size, p_drive_id: up.id, p_store: up.store, p_url: null });
      return { id, folder_id: target };
    },
    addLink: (folder_id, { name, url }) => rpc('doc_add', { p_folder: folder_id, p_name: name, p_kind: /youtu\.?be/.test(url || '') ? 'video' : 'link', p_mime: '', p_size: null, p_drive_id: null, p_store: null, p_url: url }),
    async renameDoc(id, name) { const d = S.ix.doc.get(id); await rpc('doc_rename', { p_id: id, p_name: name }); if (d && d.drive_id) drive('renameFile', { id: d.drive_id, name: String(name).trim() }, d.store_no).catch(e => console.warn(e)); },
    async moveDoc(id, folder_id) { const d = S.ix.doc.get(id); await rpc('doc_move', { p_id: id, p_folder: folder_id }); if (d && d.drive_id) drive('moveFile', { id: d.drive_id, path: pathNames(folder_id) }, d.store_no).catch(e => console.warn(e)); },
    async deleteDoc(id) { const d = S.ix.doc.get(id); await rpc('doc_delete', { p_id: id }); if (d && d.drive_id) drive('trashFile', { id: d.drive_id }, d.store_no).catch(e => console.warn(e)); },
    async docData() { return null; },
    async trash() { return (await rpc('trash_list')).map(r => ({ ...r, where: r.where || '' })); },
    async restore(type, id) {
      const list = await rpc('trash_list'); const row = list.find(r => r.id === id);
      await rpc('trash_restore', { p_type: type, p_id: id });
      if (type === 'doc' && row && row.drive_id) drive('untrashFile', { id: row.drive_id }, row.store_no).catch(e => console.warn(e));
      if (type === 'folder') { await loadCache(); await driveAll('untrashPath', { path: pathNames(id) }); }
    },

    async search(qs) {
      qs = qs.trim().toLowerCase(); if (!qs) return { items: [], docs: [] };
      const hit = s => String(s || '').toLowerCase().includes(qs);
      const items = S.cache.items.filter(i => hit(i.name) || hit(i.spec) || hit(i.maker) || hit(i.models) || hit(i.memo)).map(i => i.id);
      const byName = S.cache.docs.filter(d => hit(d.name)).map(d => ({ id: d.id, inside: false }));
      let inside = [];
      if (qs.length >= 2 && stores().length) {
        try {
          const res = await Promise.all(stores().map(s => drive('search', { q: qs }, s.no).catch(() => ({ ids: [] }))));
          const ids = new Set(res.flatMap(r => r.ids || []));
          inside = S.cache.docs.filter(d => d.drive_id && ids.has(d.drive_id) && !byName.some(b => b.id === d.id)).map(d => ({ id: d.id, inside: true }));
        } catch {}
      }
      return { items, docs: [...byName, ...inside] };
    },

    async comments(t, id) {
      const rows = await q(sb.from('comments').select('*').eq('target_type', t).eq('target_id', id).is('deleted_at', null).order('created_at'));
      return rows.map(c => ({ ...c, name: personName(c.user_id) }));
    },
    addComment: (t, id, body) => rpc('comment_add', { p_type: t, p_id: id, p_body: body }),
    deleteComment: id => rpc('comment_delete', { p_id: id }),
    notifications: () => q(sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60)),
    async unreadCount() { const { count, error } = await sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null); if (error) throw E(error); return count || 0; },
    markAllRead: () => rpc('notif_read_all'),

    users: () => q(sb.from('profiles').select('*').order('created_at')),
    approve: ids => rpc('users_approve', { p_ids: ids }),
    reject: id => rpc('user_reject', { p_id: id }),
    setRole: (id, role) => rpc('user_set_role', { p_id: id, p_role: role }),
    resetPassword: id => rpc('user_reset_password', { p_id: id }),
    setActive: (id, on) => rpc('user_set_active', { p_id: id, p_on: on }),
    async audit({ kind, actor } = {}) {
      let x = sb.from('audit_log').select('*').order('id', { ascending: false }).limit(300);
      if (kind === 'stock') x = x.eq('target_type', 'item').not('action', 'like', '댓글%');
      if (kind === 'docs') x = x.in('target_type', ['doc', 'folder']).not('action', 'like', '댓글%');
      if (kind === 'account') x = x.eq('target_type', 'account');
      if (kind === 'comment') x = x.like('action', '댓글%');
      if (kind === 'place') x = x.in('target_type', ['location', 'category']);
      if (actor) x = x.eq('actor_id', actor);
      return q(x);
    },
    async status() {
      const rows = await q(sb.from('system_status').select('key,value'));
      const o = Object.fromEntries(rows.map(r => [r.key, r.value]));
      o.storage_used = +o.storage_used || 0; o.storage_total = +o.storage_total || 16106127360;
      return o;
    },
    async putPhoto(blob) {
      const path = (crypto.randomUUID ? crypto.randomUUID() : uid('p')) + '.jpg';
      const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw E(error);
      return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
    }
  };
}

/* ───────── 화면 상태 ───────── */
const S = {
  user: null, api: null, cache: null, ix: null,
  tab: 'items', stack: [{ tab: 'items', view: 'browse', node: null }],
  itemsMode: store.get('gaya-mode', 'loc'), q: '', docsQ: '', logKind: '',
  sheet: null, toast: null, unread: 0,
  fakeOffline: false, authView: 'login', authErr: '', busy: false,
  lastTab: {}, searchRes: null, docSearchRes: null
};
const route = () => S.stack[S.stack.length - 1];
const online = () => navigator.onLine !== false && !S.fakeOffline;

/* 캐시 색인: 위치·분류·품목·재고·폴더를 빠르게 찾기 위한 표 */
function buildIndex(c) {
  const m = arr => new Map(arr.map(x => [x.id, x]));
  const kids = (arr, key = 'parent_id') => { const k = new Map(); arr.forEach(x => { const p = x[key] || null; if (!k.has(p)) k.set(p, []); k.get(p).push(x); }); return k; };
  const ix = {
    loc: m(c.locations), locKids: kids(c.locations), cat: m(c.categories), catKids: kids(c.categories),
    item: m(c.items), folder: m(c.folders), folderKids: kids(c.folders), docsIn: kids(c.docs, 'folder_id'),
    doc: m(c.docs), person: m(c.people), byItem: new Map(), byLoc: new Map()
  };
  for (const [, v] of ix.locKids) v.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name, 'ko'));
  for (const [, v] of ix.catKids) v.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  for (const [, v] of ix.folderKids) v.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
  c.stock.forEach(s => {
    if (!ix.item.has(s.item_id) || !ix.loc.has(s.location_id) || !s.qty) return;
    if (!ix.byItem.has(s.item_id)) ix.byItem.set(s.item_id, []);
    ix.byItem.get(s.item_id).push(s);
    if (!ix.byLoc.has(s.location_id)) ix.byLoc.set(s.location_id, []);
    ix.byLoc.get(s.location_id).push(s);
  });
  return ix;
}
const total = id => (S.ix.byItem.get(id) || []).reduce((a, s) => a + s.qty, 0);
const isLow = it => it.min_qty > 0 && total(it.id) < it.min_qty;
const pathOf = (map, id) => { const out = []; let n = map.get(id); while (n) { out.unshift(n); n = map.get(n.parent_id); } return out; };
const locPathText = id => pathOf(S.ix.loc, id).map(l => l.name).join(' › ');
const locCode = id => { const l = S.ix.loc.get(id); return l ? (l.code || l.name) : '?'; };
const catPathText = id => pathOf(S.ix.cat, id).map(c => c.name).join(' › ');
const folderPathText = id => pathOf(S.ix.folder, id).map(f => f.name).join(' › ');
const personName = id => (S.ix.person.get(id) || {}).name || '알 수 없음';
const itemTitle = it => it.name + (it.spec ? ' · ' + it.spec : '');
const descLocs = id => { const out = [id]; for (let i = 0; i < out.length; i++) (S.ix.locKids.get(out[i]) || []).forEach(k => out.push(k.id)); return out; };
const descCats = id => { const out = [id]; for (let i = 0; i < out.length; i++) (S.ix.catKids.get(out[i]) || []).forEach(k => out.push(k.id)); return out; };
function flatTree(kidsMap, root = null, depth = 0, out = []) {
  (kidsMap.get(root) || []).forEach(n => { out.push({ n, depth }); flatTree(kidsMap, n.id, depth + 1, out); });
  return out;
}

async function loadCache() {
  const c = await S.api.bootstrap();
  S.cache = c; S.ix = buildIndex(c);
  store.set('gaya-cache', c); // 오프라인일 때 마지막으로 본 내용을 보여 주기 위해 저장
  S.unread = await S.api.unreadCount().catch(() => S.unread);
}

/* ───────── 이동 ───────── */
function nav(r, replace = false) {
  if (replace) S.stack[S.stack.length - 1] = r; else S.stack.push(r);
  S.tab = r.tab;
  try { history.pushState({ d: S.stack.length }, ''); S.hist = true; } catch {}
  S.searchRes = null;
  render(); window.scrollTo(0, 0);
  onEnterRoute();
}
function back() {
  if (S.sheet) { S.sheet = null; render(); return; }
  if (S.stack.length > 1) { S.stack.pop(); S.tab = route().tab; render(); onEnterRoute(); }
}
function goTab(t) {
  const roots = { items: { tab: 'items', view: 'browse', node: null }, docs: { tab: 'docs', view: 'browse', folder: null }, scan: { tab: 'scan', view: 'scan' }, alerts: { tab: 'alerts', view: 'list' }, more: { tab: 'more', view: 'menu' } };
  if (S.tab === t && S.stack.length > 1) { S.stack = [roots[t]]; }
  else if (S.tab !== t) { S.lastTab[S.tab] = S.stack; S.stack = S.lastTab[t] || [roots[t]]; }
  S.tab = t; S.q = ''; S.searchRes = null; stopScan();
  render(); window.scrollTo(0, 0); onEnterRoute();
}
window.addEventListener('popstate', () => { if (S.sheet || S.stack.length > 1) back(); });

/* 화면에 들어갈 때 필요한 추가 자료 (이력·댓글 등)를 받아 온다 */
const VIEWDATA = {};
async function onEnterRoute() {
  const r = route(); const key = JSON.stringify(r);
  try {
    if (r.view === 'item') { const [tx, cm] = await Promise.all([S.api.txList({ item_id: r.id }), S.api.comments('item', r.id)]); VIEWDATA[key] = { tx, cm }; }
    else if (r.tab === 'items' && r.view === 'browse' && !r.node) VIEWDATA[key] = { tx: await S.api.txList({ limit: 6 }) };
    else if (r.view === 'doc') VIEWDATA[key] = { cm: await S.api.comments('doc', r.id), data: await S.api.docData(r.id) };
    else if (r.view === 'list') { VIEWDATA[key] = { list: await S.api.notifications() }; }
    else if (r.view === 'users') VIEWDATA[key] = { list: await S.api.users() };
    else if (r.view === 'log') VIEWDATA[key] = { list: await S.api.audit({ kind: S.logKind }) };
    else if (r.view === 'status') VIEWDATA[key] = { st: await S.api.status() };
    else if (r.view === 'trash') VIEWDATA[key] = { list: await S.api.trash() };
    else if (r.view === 'menu' && can(S.user, 'users')) VIEWDATA[key] = { st: await S.api.status(), users: await S.api.users() };
    else if (r.view === 'scan') { render(); startScan(); return; }
    else return;
    if (JSON.stringify(route()) === key) render();
  } catch (e) { toast(e.message, true); }
}
const vd = () => VIEWDATA[JSON.stringify(route())] || {};

/* ───────── 알림 띠 ───────── */
let toastTimer;
function toast(msg, err = false) {
  S.toast = { msg, err }; render();
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { S.toast = null; render(); }, err ? 4200 : 2400);
}

/* ───────── 저장 작업 실행기 ─────────
   · 오프라인이면 아예 막는다
   · 누르는 동안 버튼을 잠가 두 번 저장되지 않게 한다 (서버에도 op_id 로 중복 방지)
   · 실패하면 시트를 닫지 않고 입력한 내용을 그대로 둔다 */
async function run(fn, okMsg, { keepSheet = false, reload = true } = {}) {
  if (!online()) { toast('오프라인이라 저장할 수 없습니다. 연결되면 다시 눌러 주세요.', true); return false; }
  if (S.busy) return false;
  S.busy = true; if (S.sheet) S.sheet.err = ''; render();
  try {
    const r = await fn();
    if (reload) await loadCache();
    if (!keepSheet) S.sheet = null;
    S.busy = false;
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); else render();
    onEnterRoute();
    return r ?? true;
  } catch (e) {
    S.busy = false;
    const msg = /fetch|network|Failed/i.test(e.message) ? '연결이 끊겨 저장하지 못했습니다. 입력한 내용은 그대로 있으니 연결되면 다시 누르세요.' : e.message;
    if (S.sheet) { S.sheet.err = msg; render(); } else toast(msg, true);
    return false;
  }
}

/* ───────── 이벤트 연결 ───────── */
const ACT = {};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.dataset.write !== undefined && !online()) { e.preventDefault(); toast('오프라인이라 저장할 수 없습니다. 연결되면 다시 눌러 주세요.', true); return; }
  const f = ACT[el.dataset.act];
  if (f) { if (el.tagName !== 'INPUT') e.preventDefault(); f(el.dataset, el, e); }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.bind && S.sheet) { S.sheet.d[el.dataset.bind] = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset.live !== undefined) render(); }
  if (el.id === 'q-items') { S.q = el.value; searchItems(); }
  if (el.id === 'q-docs') { S.docsQ = el.value; searchDocs(); }
  if (el.id === 'bulk-in' && S.bulk) S.bulk.text = el.value;
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.bind && S.sheet && (el.tagName === 'SELECT' || el.type === 'checkbox')) { S.sheet.d[el.dataset.bind] = el.type === 'checkbox' ? el.checked : el.value; render(); }
  if (el.id === 'filepick') { uploadFiles([...el.files]); el.value = ''; }
  if (el.id === 'photopick') { pickPhoto(el.files[0]); el.value = ''; }
});
document.addEventListener('submit', e => { e.preventDefault(); const f = ACT[e.target.dataset.submit]; if (f) f(e.target.dataset, e.target); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) { S.sheet = null; render(); } });
window.addEventListener('online', () => { render(); if (S.user) refresh(); });
window.addEventListener('offline', () => render());
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && online()) refresh(); });
async function refresh() { try { await loadCache(); S.serverDown = false; render(); onEnterRoute(); } catch {} }

let sT;
function searchItems() {
  clearTimeout(sT);
  sT = setTimeout(async () => { S.searchRes = S.q.trim() ? (await S.api.search(S.q)).items : null; render(); }, 180);
}
let dT;
function searchDocs() {
  clearTimeout(dT);
  dT = setTimeout(async () => { S.docSearchRes = S.docsQ.trim() ? (await S.api.search(S.docsQ)).docs : null; render(); }, 220);
}

/* 전체 다시 그리기 — 입력 중이던 칸의 커서 위치를 지켜 준다 */
function render() {
  const a = document.activeElement; const fid = a && a.id; let sel = null;
  try { if (fid && a.selectionStart != null) sel = [a.selectionStart, a.selectionEnd]; } catch {}
  const sy = S.sheet ? ($('.sheet') || {}).scrollTop : null;
  $('#app').innerHTML = S.user && S.user.status === 'active' ? shell() : authView();
  const ov = $('#overlay'); ov.innerHTML = (S.sheet ? sheetView() : '') + (S.toast ? `<div class="toast ${S.toast.err ? 'err' : ''}" role="status">${esc(S.toast.msg)}</div>` : '');
  if (sy != null && $('.sheet')) $('.sheet').scrollTop = sy;
  if (fid) { const n = document.getElementById(fid); if (n) { n.focus({ preventScroll: true }); if (sel) try { n.setSelectionRange(sel[0], sel[1]); } catch {} } }
  if (S.sheet && !S.sheetFocused) { S.sheetFocused = true; const fa = $('.sheet [data-autofocus]'); if (fa) fa.focus(); }
}

/* ───────── 로그인 · 가입 ───────── */
function authView() {
  const u = S.user;
  const brand = `<div class="brand"><div class="mark">${ic('mark')}<h1>가야 자재·자료</h1></div><p>가야엘리베이터 사내 전용 · 자재 입출고와 기술 자료</p></div>`;
  if (u && u.status === 'pending') return `<div class="auth">${brand}
    <div class="card"><h2 style="margin:0;font-size:18px">가입 신청을 보냈습니다</h2>
      <p style="margin:0" class="muted">${esc(u.name)}님(사내번호 ${esc(u.emp_no)})의 신청을 관리자가 승인하면 바로 쓸 수 있습니다. 승인되면 이 화면에서 「다시 확인」을 누르세요.</p>
      <button class="btn primary block big" data-act="recheck">다시 확인</button>
      <button class="btn ghost block" data-act="logout">다른 사내번호로 로그인</button></div></div>`;
  const down = S.serverDown ? `<div class="notice warn" role="alert">${ic('warn')}<span>서버가 쉬고 있어 연결되지 않습니다. 관리자에게 알려 주세요. (관리자 안내 › 빨간 불이 켜졌을 때)</span></div>` : '';
  const err = S.authErr ? `<div class="notice crit" role="alert">${ic('warn')}<span>${esc(S.authErr)}</span></div>` : '';
  if (S.authView === 'signup') return `<div class="auth">${brand}
    <form class="card" data-submit="signup" autocomplete="off">
      <h2 style="margin:0;font-size:18px">가입 신청</h2>
      <div class="field"><label for="su-emp">사내번호</label><input id="su-emp" name="emp" inputmode="text" autocapitalize="off" required placeholder="예: 1023"><span class="hint">로그인할 때 아이디로 씁니다.</span></div>
      <div class="field"><label for="su-name">실명</label><input id="su-name" name="name" required placeholder="예: 홍길동"><span class="hint">앱 안에서는 사내번호 대신 이름이 보입니다.</span></div>
      <div class="field"><label for="su-pw">비밀번호</label><input id="su-pw" name="pw" type="password" required minlength="6" autocomplete="new-password"><span class="hint">6자 이상</span></div>
      <div class="field"><label for="su-pw2">비밀번호 확인</label><input id="su-pw2" name="pw2" type="password" required autocomplete="new-password"></div>
      <div class="field"><label for="su-phone">연락처 (선택)</label><input id="su-phone" name="phone" inputmode="tel" placeholder="010-0000-0000"></div>
      ${err}
      <button class="btn primary block big" ${S.busy ? 'disabled' : ''}>가입 신청 보내기</button>
      <p style="margin:0;font-size:13px" class="muted">메일 인증은 없습니다. 관리자가 이름과 사내번호를 확인하고 승인합니다.</p>
    </form>
    <p style="text-align:center;margin:0">이미 가입했다면 <button class="linkbtn" data-act="authView" data-v="login">로그인</button></p></div>`;
  return `<div class="auth">${brand}
    ${down}<form class="card" data-submit="login">
      <div class="field"><label for="li-emp">사내번호</label><input id="li-emp" name="emp" autocapitalize="off" autocomplete="username" required></div>
      <div class="field"><label for="li-pw">비밀번호</label><input id="li-pw" name="pw" type="password" autocomplete="current-password" required></div>
      ${err}
      <button class="btn primary block big" ${S.busy ? 'disabled' : ''}>로그인</button>
      <p style="margin:0;font-size:13px" class="muted">비밀번호를 잊었으면 관리자에게 초기화를 요청하세요.</p>
    </form>
    <p style="text-align:center;margin:0">처음이면 <button class="linkbtn" data-act="authView" data-v="signup">가입 신청</button></p>
    ${DEMO ? `<div class="card" style="gap:10px"><div style="font-weight:600">체험판 · 역할을 골라 바로 들어가기</div>
      <div class="rolepick"><button data-act="quick" data-role="dev"><b>개발자</b><span>재석</span></button><button data-act="quick" data-role="admin"><b>관리자</b><span>김도윤</span></button><button data-act="quick" data-role="staff"><b>직원</b><span>박성호</span></button></div>
      <p style="margin:0;font-size:12.5px" class="muted">예시 데이터입니다. 직접 로그인하려면 사내번호 1001~1006, 비밀번호 1234.</p></div>` : ''}
  </div>`;
}

/* ───────── 뼈대 ───────── */
function shell() {
  const r = route(); const v = VIEW[r.tab + '.' + r.view] || VIEW['items.browse'];
  const out = v(r);
  const tabs = [['items', 'box', '자재'], ['docs', 'docs', '자료'], ['scan', 'scan', '스캔'], ['alerts', 'bell', '알림'], ['more', 'more', '더보기']];
  return `${S.serverDown && online() ? `<div class="offline" role="status" style="background:var(--warn)">${ic('warn')}<span>서버에 연결되지 않아 마지막으로 받은 내용만 보입니다. 관리자에게 알려 주세요.</span></div>` : ''}${online() ? '' : `<div class="offline" role="status">${ic('wifioff')}<span>오프라인 · 마지막으로 받은 내용만 보입니다. 저장은 연결된 뒤에 됩니다.</span></div>`}
  ${DEMO ? `<div class="demo-strip"><b>체험판</b><span>예시 데이터 · 이 기기에만 저장됩니다</span></div>` : ''}
  <header class="appbar"><div class="appbar-top">
    ${S.stack.length > 1 ? `<button class="iconbtn" data-act="back" aria-label="뒤로">${ic('back')}</button>` : ''}
    <h1>${esc(out.title)}</h1>${out.actions || ''}</div>
    ${out.crumbs ? `<nav class="crumbs" aria-label="경로">${out.crumbs}</nav>` : ''}</header>
  <main id="main">${out.body}</main>
  ${out.fab || ''}
  <nav class="tabbar" aria-label="메뉴"><div class="tabbar-in">${tabs.map(([t, i, l]) => `<button class="tab" data-act="tab" data-t="${t}" ${S.tab === t ? 'aria-current="page"' : ''}>${ic(i)}<span>${l}</span>${t === 'alerts' && S.unread ? `<span class="dot">${S.unread > 99 ? '99+' : S.unread}</span>` : ''}</button>`).join('')}</div></nav>
  <input type="file" id="filepick" multiple hidden><input type="file" id="photopick" accept="image/*" hidden>`;
}
const crumbs = (list) => list.map((c, i) => i === list.length - 1 ? `<span class="here">${esc(c.label)}</span>` : `<button data-act="${c.act}" ${Object.entries(c.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${esc(c.label)}</button><span class="sep">›</span>`).join('');
const empty = (icon, msg, sub = '') => `<div class="empty">${ic(icon)}<div>${msg}</div>${sub ? `<div style="font-size:13px">${sub}</div>` : ''}</div>`;
const lowChip = it => isLow(it) ? `<span class="chip crit">부족 · 최소 ${it.min_qty}</span>` : '';

/* 품목 목록: 같은 품명이 여러 사양이면 묶음 머리를 달아 준다 */
function itemList(items, qtyOf, sub) {
  if (!items.length) return '';
  const groups = new Map();
  items.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko') || (a.spec || '').localeCompare(b.spec || '', 'ko', { numeric: true })).forEach(it => { if (!groups.has(it.name)) groups.set(it.name, []); groups.get(it.name).push(it); });
  let h = '';
  for (const [name, arr] of groups) {
    const grouped = arr.length > 1;
    if (grouped) h += `<div class="group-h"><span>${esc(name)}</span><span>${arr.length}종</span></div>`;
    arr.forEach(it => {
      const q = qtyOf(it);
      h += `<button class="lrow" data-act="item" data-id="${it.id}">
        <div class="main"><span class="t">${esc(grouped ? (it.spec || '(규격 없음)') : itemTitle(it))}</span><span class="s">${esc([it.maker, it.models].filter(Boolean).join(' · ') || ' ')}${sub ? sub(it) : ''}</span></div>
        <div class="end"><span class="qty ${isLow(it) ? 'low' : ''}">${q}<small>${esc(it.unit)}</small></span>${lowChip(it)}</div></button>`;
    });
  }
  return `<div class="ledger">${h}</div>`;
}
const locRow = (l, extra = '') => {
  const ids = descLocs(l.id); let n = 0; const items = new Set();
  ids.forEach(id => (S.ix.byLoc.get(id) || []).forEach(s => { n += s.qty; items.add(s.item_id); }));
  return `<button class="lrow" data-act="loc" data-id="${l.id}"><span class="ic">${ic(l.kind === 'zone' ? 'pin' : 'shelf')}</span>
    <div class="main"><span class="t">${esc(l.name)}</span><span class="s">${items.size}품목${extra}</span></div>
    ${l.code ? `<span class="tape">${esc(l.code)}</span>` : ''}<span class="chev">${ic('chev')}</span></button>`;
};

/* ───────── 화면들 ───────── */
const VIEW = {};

VIEW['items.browse'] = r => {
  const mode = S.itemsMode; const q = S.q.trim();
  const node = r.node; let title = '자재', cr = null, body = '', actions = '';
  const top = `<div class="toolbar"><div class="search grow">${ic('search')}<input id="q-items" type="search" placeholder="품명·규격·제조사·기종 검색" value="${esc(S.q)}" aria-label="자재 검색"></div></div>
    ${q ? '' : `<div class="toolbar"><div class="seg" role="group" aria-label="보기 방식"><button data-act="mode" data-m="loc" aria-pressed="${mode === 'loc'}">위치별</button><button data-act="mode" data-m="cat" aria-pressed="${mode === 'cat'}">분류별</button></div><span class="grow"></span>${can(S.user, 'item') ? `<button class="btn sm" data-act="itemNew" data-write>${ic('plus')}품목 추가</button>` : ''}</div>`}`;
  if (q) {
    const ids = S.searchRes || [];
    const items = ids.map(id => S.ix.item.get(id)).filter(Boolean);
    body = top + `<section class="sec"><div class="sec-h"><h2>검색 결과</h2><span class="aside">${items.length}건</span></div>
      ${items.length ? itemList(items, it => total(it.id), it => `<br>${(S.ix.byItem.get(it.id) || []).map(s => `<span class="tape" style="margin:3px 4px 0 0">${esc(locCode(s.location_id))} · ${s.qty}</span>`).join('')}`) : `<div class="ledger">${empty('search', S.searchRes ? '찾는 자재가 없습니다.' : '찾는 중…', '규격 숫자(예: 62, MY4N)나 제조사로도 찾아보세요.')}</div>`}</section>`;
    return { title, body };
  }
  if (mode === 'loc') {
    if (!node) {
      const lows = S.cache.items.filter(isLow);
      const tx = vd().tx || [];
      body = top + (lows.length ? `<section class="sec"><div class="sec-h"><h2>재고 부족</h2><span class="aside">최소 수량보다 적은 품목 ${lows.length}개</span></div>${itemList(lows, it => total(it.id))}</section>` : '')
        + `<section class="sec"><div class="sec-h"><h2>보관 위치</h2></div><div class="ledger">${(S.ix.locKids.get(null) || []).map(l => locRow(l)).join('') || empty('pin', '등록된 위치가 없습니다.')}</div></section>`
        + (tx.length ? `<section class="sec"><div class="sec-h"><h2>최근 입출고</h2></div><div class="ledger hist">${tx.map(t => txRow(t, true)).join('')}</div></section>` : '');
    } else {
      const l = S.ix.loc.get(node); if (!l) return { title: '위치 없음', body: empty('pin', '지워진 위치입니다.') };
      const path = pathOf(S.ix.loc, node);
      title = l.name;
      cr = crumbs([{ label: '자재', act: 'locRoot' }, ...path.map(p => ({ label: p.name, act: 'loc', data: { id: p.id } }))]);
      const here = (S.ix.byLoc.get(node) || []).map(s => ({ it: S.ix.item.get(s.item_id), q: s.qty })).filter(x => x.it);
      const qmap = new Map(here.map(x => [x.it.id, x.q]));
      const kids = S.ix.locKids.get(node) || [];
      actions = can(S.user, 'location') ? `<button class="iconbtn" data-act="locEdit" data-id="${l.id}" aria-label="위치 수정" data-write>${ic('edit')}</button>` : '';
      body = top + `<section class="hero" style="flex-direction:row;gap:14px;align-items:center">
          <div class="photo" style="width:64px;height:64px">${l.photo ? `<img src="${esc(l.photo)}" alt="">` : ic('shelf')}</div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">${l.code ? `<span class="tape lg" style="align-self:flex-start">${esc(l.code)}</span>` : ''}<span class="muted" style="font-size:13.5px">${esc(locPathText(node))}</span></div>
          <button class="btn sm" data-act="labelsFor" data-id="${l.id}">${ic('qr')}라벨</button></section>
        ${kids.length ? `<section class="sec"><div class="sec-h"><h2>안쪽 위치</h2></div><div class="ledger">${kids.map(k => locRow(k)).join('')}</div></section>` : ''}
        <section class="sec"><div class="sec-h"><h2>이 위치의 자재</h2><button class="btn sm" data-act="inHere" data-id="${l.id}" data-write>${ic('in')}여기에 입고</button></div>
        ${here.length ? itemList(here.map(x => x.it), it => qmap.get(it.id)) : `<div class="ledger">${empty('box', '이 위치에 등록된 자재가 없습니다.', kids.length ? '안쪽 위치를 열어 보세요.' : '「여기에 입고」로 자재를 넣을 수 있습니다.')}</div>`}</section>`;
    }
  } else {
    const kids = S.ix.catKids.get(node || null) || [];
    const c = node ? S.ix.cat.get(node) : null;
    title = c ? c.name : '자재';
    if (c) cr = crumbs([{ label: '자재', act: 'locRoot' }, ...pathOf(S.ix.cat, node).map(p => ({ label: p.name, act: 'cat', data: { id: p.id } }))]);
    const direct = S.cache.items.filter(i => (i.category_id || null) === (node || null));
    const catRow = k => { const ids = descCats(k.id); const its = S.cache.items.filter(i => ids.includes(i.category_id)); const low = its.filter(isLow).length;
      return `<button class="lrow" data-act="cat" data-id="${k.id}"><span class="ic">${ic('tag')}</span><div class="main"><span class="t">${esc(k.name)}</span><span class="s">${its.length}품목</span></div>${low ? `<span class="chip crit">부족 ${low}</span>` : ''}<span class="chev">${ic('chev')}</span></button>`; };
    body = top + (kids.length ? `<section class="sec"><div class="sec-h"><h2>${c ? '하위 분류' : '분류'}</h2></div><div class="ledger">${kids.map(catRow).join('')}</div></section>` : '')
      + (direct.length ? `<section class="sec"><div class="sec-h"><h2>${c ? '품목' : '분류 없음'}</h2><span class="aside">전체 수량</span></div>${itemList(direct, it => total(it.id), it => ' · ' + ((S.ix.byItem.get(it.id) || []).map(s => locCode(s.location_id)).join(', ') || '재고 없음'))}</section>` : '')
      + (!kids.length && !direct.length ? `<div class="ledger">${empty('tag', '이 분류에는 품목이 없습니다.')}</div>` : '');
  }
  return { title, body, crumbs: cr, actions };
};

function txRow(t, withItem = false) {
  const it = S.ix.item.get(t.item_id); const unit = it ? it.unit : '';
  const where = t.type === 'in' ? '→ ' + locCode(t.to_loc) : t.type === 'out' ? '← ' + locCode(t.from_loc) : t.type === 'move' ? locCode(t.from_loc) + ' → ' + locCode(t.to_loc) : t.type === 'adjust' ? '@' + locCode(t.from_loc) + ' ' + t.before + '→' + t.after : '원상복구';
  const sign = t.type === 'in' ? '+' : t.type === 'out' ? '−' : t.type === 'adjust' ? (t.qty >= 0 ? '+' : '−') : '';
  const kcls = { in: 'k-in', out: 'k-out', move: 'k-move', cancel: 'k-cancel', adjust: 'k-adjust' }[t.type];
  const canC = !withItem && !t.canceled_by && ['in', 'out', 'move'].includes(t.type) && can(S.user, 'cancel', t);
  return `<div class="hrow ${t.canceled_by ? 'void' : ''}" ${withItem ? `data-act="item" data-id="${t.item_id}" role="button" tabindex="0" style="cursor:pointer"` : ''}>
    <span class="kind ${kcls}">${TX_NAME[t.type]}</span>
    <div class="d">${withItem && it ? `<div style="font-weight:600">${esc(itemTitle(it))}</div>` : ''}<span class="who">${esc(personName(t.user_id))}</span> <span class="meta">${fmtWhen(t.created_at)}</span>
      <div class="meta"><span class="mono">${esc(where)}</span>${t.site ? ' · ' + esc(t.site) : ''}${t.note ? ' · ' + esc(t.note) : ''}${t.canceled_by ? ' · 취소됨' : ''}</div></div>
    <span class="n">${sign}${Math.abs(t.qty)}${esc(unit)}</span>
    ${canC ? `<div class="ops"><button class="btn sm" data-act="cancelTx" data-id="${t.id}" data-write>${ic('undo')}${t.type === 'out' ? '출고 취소 (안 씀)' : TX_NAME[t.type] + ' 취소'}</button></div>` : ''}
  </div>`;
}

VIEW['items.item'] = r => {
  const it = S.ix.item.get(r.id);
  if (!it) return { title: '품목', body: empty('box', '지워졌거나 없는 품목입니다.') };
  const d = vd(); const rows = (S.ix.byItem.get(it.id) || []).slice().sort((a, b) => b.qty - a.qty);
  const adm = can(S.user, 'item');
  const catP = it.category_id ? pathOf(S.ix.cat, it.category_id) : [];
  const cr = crumbs([{ label: '자재', act: 'catRoot' }, ...catP.map(p => ({ label: p.name, act: 'cat', data: { id: p.id } })), { label: it.name }]);
  const t = total(it.id);
  const body = `<section class="hero">
      <div class="hero-top"><button class="photo" data-act="photoItem" data-id="${it.id}" aria-label="사진 바꾸기" style="padding:0">${it.photo ? `<img src="${esc(it.photo)}" alt="">` : ic('cam')}</button>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px"><h2>${esc(it.name)}${it.spec ? `<span style="display:block;font-size:16px;font-weight:500;color:var(--muted)">${esc(it.spec)}</span>` : ''}</h2>
        <dl class="kv">${it.maker ? `<dt>제조사</dt><dd>${esc(it.maker)}</dd>` : ''}${it.models ? `<dt>적용 기종</dt><dd>${esc(it.models)}</dd>` : ''}<dt>분류</dt><dd>${esc(catPathText(it.category_id) || '없음')}</dd><dt>최소 재고</dt><dd class="num">${it.min_qty ? it.min_qty + it.unit : '정하지 않음'}</dd></dl></div></div>
      <div class="total"><span class="big ${isLow(it) ? 'low' : ''}" style="${isLow(it) ? 'color:var(--crit)' : ''}">${t}<small>${esc(it.unit)}</small></span><span class="muted">전체 재고</span>${lowChip(it)}</div>
      <div class="actions3"><button class="btn in" data-act="txIn" data-id="${it.id}" data-write>${ic('in')}입고</button><button class="btn out" data-act="txOut" data-id="${it.id}" data-write ${t ? '' : 'disabled'}>${ic('out')}출고</button><button class="btn" data-act="txMove" data-id="${it.id}" data-write ${t ? '' : 'disabled'}>${ic('move')}이동</button></div>
    </section>
    <section class="sec"><div class="sec-h"><h2>위치별 수량</h2>${adm ? `<button class="btn sm ghost" data-act="txAdjust" data-id="${it.id}" data-write>수량 정정</button>` : ''}</div>
      <div class="ledger">${rows.length ? rows.map(s => `<button class="lrow" data-act="loc" data-id="${s.location_id}"><div class="main"><span class="t"><span class="tape">${esc(locCode(s.location_id))}</span></span><span class="s">${esc(locPathText(s.location_id))}</span></div><span class="qty">${s.qty}<small>${esc(it.unit)}</small></span><span class="chev">${ic('chev')}</span></button>`).join('') : empty('pin', '재고가 없습니다.', '「입고」로 넣을 위치와 수량을 기록하세요.')}</div></section>
    <section class="sec"><div class="sec-h"><h2>메모</h2><button class="btn sm ghost" data-act="memoEdit" data-id="${it.id}" data-write>${ic('edit')}${it.memo ? '고치기' : '적기'}</button></div>
      ${it.memo ? `<div class="memo">${esc(it.memo)}</div>` : `<div class="muted" style="font-size:14px">대체품, 보관 요령, 주의할 점 등을 적어 두면 모두가 봅니다.</div>`}</section>
    <section class="sec"><div class="sec-h"><h2>입출고 기록</h2><span class="aside">최근 50건</span></div>
      <div class="ledger hist">${d.tx ? (d.tx.length ? d.tx.map(x => txRow(x)).join('') : empty('list', '아직 기록이 없습니다.')) : empty('list', '불러오는 중…')}</div></section>
    ${commentsBlock('item', it.id, d.cm)}`;
  const actions = adm ? `<button class="iconbtn" data-act="itemEdit" data-id="${it.id}" aria-label="품목 수정" data-write>${ic('edit')}</button>` : '';
  return { title: it.name, crumbs: cr, body, actions };
};

function commentsBlock(type, id, list) {
  return `<section class="sec"><div class="sec-h"><h2>댓글</h2><span class="aside">${list ? list.length + '개' : ''}</span></div>
    <div class="ledger">${list ? list.map(c => `<div class="cmt"><div class="h"><b>${esc(c.name)}</b><span class="w">${fmtWhen(c.created_at)}</span>${can(S.user, 'delComment', c) ? `<button class="linkbtn" style="margin-left:auto;font-size:12.5px;color:var(--muted)" data-act="delComment" data-id="${c.id}" data-write>지우기</button>` : ''}</div><div class="b">${esc(c.body)}</div></div>`).join('') : ''}
    <form class="cmt-form" data-submit="comment" data-type="${type}" data-id="${id}"><input id="cmt-${id}" name="body" placeholder="댓글 남기기" autocomplete="off" aria-label="댓글"><button class="btn primary" data-write ${S.busy ? 'disabled' : ''}>등록</button></form></div></section>`;
}

/* ───────── 자료 ───────── */
VIEW['docs.browse'] = r => {
  const fid = r.folder || null; const f = fid ? S.ix.folder.get(fid) : null;
  const q = S.docsQ.trim();
  let body = `<div class="toolbar"><div class="search grow">${ic('search')}<input id="q-docs" type="search" placeholder="파일 이름·내용 검색 (예: E-15)" value="${esc(S.docsQ)}" aria-label="자료 검색"></div></div>`;
  if (q) {
    const res = (S.docSearchRes || []).map(x => ({ d: S.ix.doc.get(x.id), inside: x.inside })).filter(x => x.d);
    body += `<section class="sec"><div class="sec-h"><h2>검색 결과</h2><span class="aside">${res.length}건</span></div><div class="ledger">${res.length ? res.map(x => docRow(x.d, true, x.inside)).join('') : empty('search', S.docSearchRes ? '찾는 자료가 없습니다.' : '찾는 중…')}</div>
      <p class="muted" style="font-size:12.5px;margin:0">파일 이름뿐 아니라 PDF·문서 안의 글자까지 찾습니다. 스캔 이미지로만 된 PDF는 안쪽 글자가 잡히지 않을 수 있습니다.</p></section>`;
    return { title: '자료', body };
  }
  const kids = S.ix.folderKids.get(fid) || [];
  const docs = (S.ix.docsIn.get(fid) || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const adm = can(S.user, 'folderAdmin');
  body += `<div class="toolbar"><button class="btn sm" data-act="mkdir" data-write>${ic('folderPlus')}폴더 만들기</button>${fid ? `<button class="btn sm" data-act="addLink" data-write>${ic('link')}영상·링크</button>` : ''}<span class="grow"></span>${f && adm ? `<button class="btn sm ghost" data-act="folderMenu" data-id="${fid}" data-write>폴더 관리</button>` : ''}</div>
    ${f && f.auto_sort ? `<div class="notice">${ic('info')}<span>이 폴더에 올린 파일은 날짜에 맞춰 <b>연도 › 월</b> 폴더로 자동 정리됩니다.</span></div>` : ''}
    ${kids.length ? `<section class="sec"><div class="sec-h"><h2>폴더</h2></div><div class="ledger">${kids.map(k => { const n = (S.ix.docsIn.get(k.id) || []).length, m = (S.ix.folderKids.get(k.id) || []).length;
      return `<button class="lrow" data-act="folder" data-id="${k.id}"><span class="folder-ic">${ic('folder')}</span><div class="main"><span class="t">${esc(k.name)}</span><span class="s">${[m ? '폴더 ' + m : '', n ? '파일 ' + n : ''].filter(Boolean).join(' · ') || '비어 있음'}</span></div><span class="chev">${ic('chev')}</span></button>`; }).join('')}</div></section>` : ''}
    ${fid ? `<section class="sec"><div class="sec-h"><h2>파일</h2><span class="aside">${docs.length ? docs.length + '개 · 최근 올린 순' : ''}</span></div><div class="ledger">${docs.length ? docs.map(d => docRow(d)).join('') : empty('docs', '아직 파일이 없습니다.', '아래 「올리기」로 PDF·엑셀·사진 등을 그대로 올리세요.')}</div></section>` : ''}
    ${!fid ? `<p class="muted" style="font-size:12.5px;margin:0">자료는 회사용 구글 드라이브에 저장되고, 앱 폴더와 같은 모양으로 정리됩니다.</p>` : ''}`;
  const cr = f ? crumbs([{ label: '자료', act: 'folder', data: { id: '' } }, ...pathOf(S.ix.folder, fid).map(p => ({ label: p.name, act: 'folder', data: { id: p.id } }))]) : null;
  const fab = fid ? `<button class="fab" data-act="upload" data-write>${ic('upload')}올리기</button>` : '';
  return { title: f ? f.name : '자료', crumbs: cr, body, fab };
};
function docRow(d, showPath = false, inside = false) {
  const [k, lab] = fileKind(d.name, d.kind);
  return `<button class="lrow" data-act="doc" data-id="${d.id}"><span class="ftype ft-${k}">${lab}</span><div class="main"><span class="t">${esc(d.name)}</span>
    <span class="s">${showPath ? esc(folderPathText(d.folder_id)) + ' · ' : ''}${d.size ? fmtSize(d.size) + ' · ' : ''}${esc(personName(d.uploaded_by))} · ${fmtWhen(d.created_at)}${inside ? ' · <b>파일 안에서 찾음</b>' : ''}</span></div><span class="chev">${ic('chev')}</span></button>`;
}
VIEW['docs.doc'] = r => {
  const d = S.ix.doc.get(r.id);
  if (!d) return { title: '자료', body: empty('docs', '지워졌거나 없는 파일입니다.') };
  const [k, lab] = fileKind(d.name, d.kind); const v = vd(); const adm = can(S.user, 'docAdmin');
  let viewer;
  if (d.kind === 'video' || d.kind === 'link') viewer = `<div class="viewer-page" style="aspect-ratio:16/9">${ic(d.kind === 'video' ? 'play' : 'link')}<div>${d.kind === 'video' ? '유튜브 영상' : '바깥 링크'}</div><a class="btn primary" href="${esc(d.url)}" target="_blank" rel="noopener">${d.kind === 'video' ? '유튜브에서 재생' : '링크 열기'}</a></div>`;
  else if (!DEMO && d.drive_id) viewer = `<iframe src="https://drive.google.com/file/d/${esc(d.drive_id)}/preview" style="width:100%;aspect-ratio:1/1.3;border:0;display:block" allow="autoplay" title="${esc(d.name)}"></iframe>`;
  else if (v.data) viewer = `<img src="${v.data}" alt="${esc(d.name)}" style="display:block;width:100%">`;
  else viewer = `<div class="viewer-page"><span class="ftype ft-${k}">${lab}</span><div><b style="color:var(--ink)">${esc(d.name)}</b></div><div>체험판에서는 파일 내용을 보여 드릴 수 없습니다.<br>실제 앱에서는 이 자리에 파일이 바로 열립니다.</div></div>`;
  const body = `<div class="viewer">${viewer}</div>
    <section class="hero" style="gap:10px"><dl class="kv">${d.size ? `<dt>크기</dt><dd>${fmtSize(d.size)}</dd>` : ''}<dt>올린 사람</dt><dd>${esc(personName(d.uploaded_by))}</dd><dt>올린 날</dt><dd>${fmtWhen(d.created_at)}</dd><dt>폴더</dt><dd>${esc(folderPathText(d.folder_id))}</dd>${d.store_no ? `<dt>저장소</dt><dd>${d.store_no}호</dd>` : ''}</dl>
      <div class="toolbar">${!DEMO && d.drive_id ? `<a class="btn sm" href="https://drive.google.com/file/d/${esc(d.drive_id)}/view" target="_blank" rel="noopener">${ic('eye')}크게 보기</a>` : ''}${adm ? `<button class="btn sm" data-act="docRename" data-id="${d.id}" data-write>${ic('edit')}이름 변경</button><button class="btn sm" data-act="docMove" data-id="${d.id}" data-write>${ic('move')}이동</button><button class="btn sm danger" data-act="docDelete" data-id="${d.id}" data-write>${ic('trash')}삭제</button>` : ''}</div></section>
    ${commentsBlock('doc', d.id, v.cm)}`;
  const cr = crumbs([{ label: '자료', act: 'folder', data: { id: '' } }, ...pathOf(S.ix.folder, d.folder_id).map(p => ({ label: p.name, act: 'folder', data: { id: p.id } })), { label: d.name }]);
  return { title: d.name, crumbs: cr, body };
};

/* ───────── 스캔 ───────── */
VIEW['scan.scan'] = () => {
  const units = S.cache.locations.filter(l => l.code && l.kind !== 'zone');
  return { title: 'QR 스캔', body: `<div class="scanbox" id="scanbox"><video id="scanvid" playsinline muted hidden></video><div class="frame"></div><div class="msg" id="scanmsg">카메라를 켜는 중…</div></div>
    <p class="muted" style="margin:0;font-size:13.5px">캐비넷·선반에 붙은 QR 라벨을 네모 안에 맞추면 그 위치의 자재가 바로 열립니다. 폰 기본 카메라로 찍어도 앱이 열립니다.</p>
    <form class="toolbar" data-submit="codeGo"><div class="search grow">${ic('tag')}<input id="code-in" name="code" placeholder="라벨 코드 직접 입력 (예: WH-S1-상)" autocapitalize="characters" aria-label="라벨 코드"></div><button class="btn">열기</button></form>
    ${DEMO ? `<section class="sec"><div class="sec-h"><h2>체험판 · 라벨 골라서 스캔 흉내</h2></div><div class="ledger">${units.map(l => `<button class="lrow" data-act="loc" data-id="${l.id}"><span class="tape">${esc(l.code)}</span><div class="main"><span class="s">${esc(locPathText(l.id))}</span></div><span class="chev">${ic('chev')}</span></button>`).join('')}</div></section>` : ''}` };
};

/* ───────── 알림 ───────── */
VIEW['alerts.list'] = () => {
  const list = vd().list;
  const icn = { signup: 'user', low: 'warn', comment: 'chat', welcome: 'check' };
  return { title: '알림', actions: list && list.some(n => !n.read_at) ? `<button class="btn sm ghost" data-act="readAll">모두 읽음</button>` : '',
    body: `<div class="ledger">${!list ? empty('bell', '불러오는 중…') : list.length ? list.map(n => `<button class="lrow" data-act="notif" data-link="${esc(JSON.stringify(n.link || {}))}" style="${n.read_at ? '' : 'background:var(--accent-soft)'}"><span class="ic" style="${n.kind === 'low' ? 'color:var(--crit)' : ''}">${ic(icn[n.kind] || 'bell')}</span><div class="main"><span class="t" style="font-weight:${n.read_at ? 500 : 600}">${esc(n.title)}</span><span class="s">${esc(n.body || '')} · ${fmtWhen(n.created_at)}</span></div></button>`).join('') : empty('bell', '새 알림이 없습니다.', '내 자재·자료에 댓글이 달리거나 재고가 부족해지면 여기에 쌓입니다.')}</div>
    <p class="muted" style="font-size:12.5px;margin:0">휴대폰 알림(푸시)은 2차 업데이트에서 켤 수 있게 됩니다. 아이폰은 홈 화면에 추가한 경우에만 됩니다.</p>` };
};

/* ───────── 더보기 / 관리 ───────── */
VIEW['more.menu'] = () => {
  const u = S.user; const adm = can(u, 'users'); const v = vd();
  const pending = (v.users || []).filter(p => p.status === 'pending').length;
  const st = v.st; const lampOk = st && lampState(st).every(x => x.ok);
  const row = (act, icon, t, s, end = '') => `<button class="lrow" data-act="${act}"><span class="ic">${ic(icon)}</span><div class="main"><span class="t">${t}</span>${s ? `<span class="s">${s}</span>` : ''}</div>${end}<span class="chev">${ic('chev')}</span></button>`;
  const body = `<section class="hero" style="flex-direction:row;align-items:center;gap:14px"><div class="photo" style="width:52px;height:52px;border-radius:50%">${ic('user')}</div>
      <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:17px">${esc(u.name)}</div><div class="muted" style="font-size:13.5px">사내번호 <span class="mono">${esc(u.emp_no)}</span> · ${ROLE_NAME[u.role]}</div></div>
      <button class="btn sm" data-act="go" data-v="me">내 정보</button></section>
    ${adm ? `<section class="sec"><div class="sec-h"><h2>관리</h2></div><div class="ledger menu">
      ${row('go" data-v="users', 'users', '직원 관리', '가입 승인 · 권한 · 비밀번호 초기화 · 퇴사자', pending ? `<span class="chip crit">승인 대기 ${pending}</span>` : '')}
      ${row('go" data-v="status', 'gauge', '시스템 상태', '자동 깨우기 · 백업 · 저장 용량', st ? `<span class="lamp ${lampOk ? '' : 'off'}" title="${lampOk ? '정상' : '확인 필요'}"></span>` : '')}
      ${row('go" data-v="log', 'list', '활동 기록', '누가 언제 무엇을 했는지 전부')}
      ${row('go" data-v="places', 'shelf', '위치 관리 · QR 라벨', '캐비넷·선반 추가, 사진, 라벨 인쇄')}
      ${row('go" data-v="cats', 'tag', '분류 관리', '도어 부품, 전장 부품 같은 자재 분류')}
      ${row('go" data-v="bulk', 'paste', '품목 대량 등록', '엑셀에서 복사해 한 번에 넣기')}
      ${row('go" data-v="trash', 'trash', '휴지통', '지운 뒤 30일 안에 되살리기')}
      ${row('go" data-v="guide', 'book', '관리자 안내', '문제가 생겼을 때 할 일')}
    </div></section>` : `<section class="sec"><div class="ledger menu">${row('go" data-v="guide', 'book', '사용 안내', '입고·출고·자료 올리기')}</div></section>`}
    ${DEMO ? `<section class="sec"><div class="sec-h"><h2>체험판 설정</h2></div><div class="ledger">
      <label class="lrow" style="cursor:pointer"><span class="ic">${ic('wifioff')}</span><div class="main"><span class="t">오프라인 흉내</span><span class="s">켜면 인터넷이 끊긴 것처럼 저장이 막힙니다</span></div><input type="checkbox" id="fake-off" data-act="fakeOff" ${S.fakeOffline ? 'checked' : ''} style="width:22px;height:22px"></label>
      <button class="lrow" data-act="switchRole"><span class="ic">${ic('users')}</span><div class="main"><span class="t">다른 역할로 보기</span><span class="s">개발자 · 관리자 · 직원 화면 비교</span></div><span class="chev">${ic('chev')}</span></button>
      <button class="lrow" data-act="demoReset"><span class="ic">${ic('restore')}</span><div class="main"><span class="t">체험판 처음 상태로</span><span class="s">예시 데이터를 다시 채웁니다</span></div></button></div></section>` : ''}
    <button class="btn block ghost" data-act="logout">${ic('logout')}로그아웃</button>`;
  return { title: '더보기', body };
};
const moreCr = label => crumbs([{ label: '더보기', act: 'tab', data: { t: 'more' } }, { label }]);

VIEW['more.me'] = () => ({ title: '내 정보', crumbs: moreCr('내 정보'), body: `<section class="hero"><dl class="kv"><dt>이름</dt><dd>${esc(S.user.name)}</dd><dt>사내번호</dt><dd class="mono">${esc(S.user.emp_no)}</dd><dt>권한</dt><dd>${ROLE_NAME[S.user.role]}</dd></dl></section>
  <form class="card" data-submit="changePw"><h2 style="margin:0;font-size:16px">비밀번호 변경</h2>
    <div class="field"><label for="pw-old">지금 비밀번호</label><input id="pw-old" name="old" type="password" required autocomplete="current-password"></div>
    <div class="field"><label for="pw-new">새 비밀번호</label><input id="pw-new" name="nw" type="password" required minlength="6" autocomplete="new-password"><span class="hint">6자 이상</span></div>
    <button class="btn primary" data-write ${S.busy ? 'disabled' : ''}>바꾸기</button></form>` });

VIEW['more.users'] = () => {
  const list = vd().list;
  if (!list) return { title: '직원 관리', crumbs: moreCr('직원 관리'), body: empty('users', '불러오는 중…') };
  const pend = list.filter(p => p.status === 'pending'), act = list.filter(p => p.status === 'active'), off = list.filter(p => p.status === 'disabled');
  const sel = S.userSel || (S.userSel = new Set());
  const body = `<section class="sec"><div class="sec-h"><h2>가입 승인 대기</h2><span class="aside">${pend.length}명</span></div>
    ${pend.length ? `<div class="ledger">${pend.map(p => `<label class="lrow" style="cursor:pointer"><input type="checkbox" data-act="selUser" data-id="${p.id}" ${sel.has(p.id) ? 'checked' : ''} style="width:22px;height:22px;flex:none"><div class="main"><span class="t">${esc(p.name)}</span><span class="s">사내번호 <span class="mono">${esc(p.emp_no)}</span>${p.phone ? ' · ' + esc(p.phone) : ''} · ${fmtWhen(p.created_at)} 신청</span></div><button class="btn sm danger" data-act="rejectUser" data-id="${p.id}" data-write>거절</button></label>`).join('')}</div>
      <div class="toolbar"><button class="btn primary grow" data-act="approveSel" data-write ${sel.size ? '' : 'disabled'}>선택한 ${sel.size}명 승인</button><button class="btn grow" data-act="approveAll" data-write>전체 ${pend.length}명 승인</button></div>
      <p class="muted" style="font-size:12.5px;margin:0">이름과 사내번호가 실제 직원과 맞는지 확인한 뒤 승인하세요. 모르는 신청은 「거절」하면 됩니다.</p>` : `<div class="ledger">${empty('check', '승인을 기다리는 신청이 없습니다.')}</div>`}</section>
  <section class="sec"><div class="sec-h"><h2>사용 중</h2><span class="aside">${act.length}명</span></div><div class="ledger">${act.sort((a, b) => ({ dev: 0, admin: 1, staff: 2 }[a.role] - { dev: 0, admin: 1, staff: 2 }[b.role]) || a.name.localeCompare(b.name, 'ko')).map(p => `<button class="lrow" data-act="userMenu" data-id="${p.id}"><span class="ic">${ic('user')}</span><div class="main"><span class="t">${esc(p.name)}${p.id === S.user.id ? ' <span class="chip">나</span>' : ''}</span><span class="s">사내번호 <span class="mono">${esc(p.emp_no)}</span></span></div><span class="chip ${p.role === 'staff' ? '' : 'acc'}">${ROLE_NAME[p.role]}</span><span class="chev">${ic('chev')}</span></button>`).join('')}</div></section>
  ${off.length ? `<section class="sec"><div class="sec-h"><h2>사용 중지 (퇴사 등)</h2><span class="aside">기록은 그대로 남습니다</span></div><div class="ledger">${off.map(p => `<div class="lrow"><span class="ic">${ic('user')}</span><div class="main"><span class="t" style="color:var(--muted)">${esc(p.name)}</span><span class="s">사내번호 <span class="mono">${esc(p.emp_no)}</span></span></div><button class="btn sm" data-act="enableUser" data-id="${p.id}" data-write>다시 사용</button></div>`).join('')}</div></section>` : ''}`;
  return { title: '직원 관리', crumbs: moreCr('직원 관리'), body };
};

VIEW['more.log'] = () => {
  const list = vd().list;
  const kinds = [['', '전체'], ['stock', '자재'], ['docs', '자료'], ['account', '계정'], ['comment', '댓글'], ['place', '위치·분류']];
  const body = `<div class="filters" role="group" aria-label="종류">${kinds.map(([k, l]) => `<button class="fchip" data-act="logKind" data-k="${k}" aria-pressed="${S.logKind === k}">${l}</button>`).join('')}</div>
    <div class="ledger">${!list ? empty('list', '불러오는 중…') : list.length ? list.map(a => `<div class="log-row"><div class="a"><b>${esc(a.action)}</b> · ${esc(a.summary)}</div><div class="w">${fmtWhen(a.at)}</div><div class="muted" style="font-size:12.5px">${esc(a.actor_name)}</div></div>`).join('') : empty('list', '해당하는 기록이 없습니다.')}</div>
    <p class="muted" style="font-size:12.5px;margin:0">활동 기록은 누구도 고치거나 지울 수 없습니다. 매일 새벽 백업 파일(구글 드라이브 「가야앱 백업」 폴더)에도 함께 저장됩니다.</p>`;
  return { title: '활동 기록', crumbs: moreCr('활동 기록'), body };
};

function lampState(st) {
  const h = iso => iso ? (Date.now() - new Date(iso)) / 36e5 : 1e9;
  return [
    { k: '서버 깨우기 · 구글', at: st.last_ping, ok: h(st.last_ping) < 48, note: '매일 새벽 3시' },
    { k: '서버 깨우기 · GitHub', at: st.last_ping2, ok: h(st.last_ping2) < 48, note: '매일 오후 3시' },
    { k: '자동 백업', at: st.last_backup, ok: h(st.last_backup) < 48, note: st.backup_file || '' }
  ];
}
VIEW['more.status'] = () => {
  const st = vd().st;
  if (!st) return { title: '시스템 상태', crumbs: moreCr('시스템 상태'), body: empty('gauge', '불러오는 중…') };
  const lamps = lampState(st); const ratio = st.storage_used / st.storage_total; const hi = ratio >= CONFIG.STORAGE_WARN;
  const body = `<div class="statusboard">${lamps.map(l => `<div class="stat"><div class="l"><span class="lamp ${l.ok ? '' : 'off'}"></span>${esc(l.k)}</div><div class="v">${l.ok ? '정상' : '멈춤 확인 필요'}</div><div class="muted" style="font-size:12.5px">마지막 ${fmtWhen(l.at) || '기록 없음'} · ${esc(l.note)}</div></div>`).join('')}
    <div class="stat"><div class="l">${ic('docs', '')}자료 저장 용량</div><div class="v num">${fmtSize(st.storage_used)} <span class="muted" style="font-size:13px;font-weight:500">/ ${fmtSize(st.storage_total)}</span></div><div class="gauge ${hi ? 'hi' : ''}" role="img" aria-label="${Math.round(ratio * 100)}% 사용"><i style="width:${Math.min(100, ratio * 100).toFixed(1)}%"></i></div><div class="muted" style="font-size:12.5px">${Math.round(ratio * 100)}% 사용 · 80%가 되면 경고</div></div></div>
    ${hi ? `<div class="notice crit">${ic('warn')}<span>저장 용량이 80%를 넘었습니다. 개발자(재석)에게 연락해 저장소를 늘리세요. 구독(100GB 월 2,400원) 또는 무료 계정 추가 중에서 고를 수 있습니다.</span></div>` : ''}
    ${lamps.every(l => l.ok) ? `<div class="notice">${ic('check')}<span>모든 자동 작업이 정상입니다. 초록 불이 하나라도 빨간 불로 바뀌면 「관리자 안내」의 순서를 따르세요.</span></div>` : `<div class="notice warn">${ic('warn')}<span>이틀 넘게 기록이 없는 작업이 있습니다. 「관리자 안내 › 빨간 불이 켜졌을 때」를 보세요. 직원들이 앱을 계속 쓰고 있다면 서버는 멈추지 않습니다.</span></div>`}
    <button class="btn" data-act="go" data-v="guide">${ic('book')}관리자 안내 열기</button>`;
  return { title: '시스템 상태', crumbs: moreCr('시스템 상태'), body };
};

VIEW['more.places'] = () => {
  const rows = flatTree(S.ix.locKids);
  const body = `<div class="toolbar"><button class="btn sm primary" data-act="locNew" data-write>${ic('plus')}구역 추가</button><button class="btn sm" data-act="go" data-v="labels">${ic('qr')}QR 라벨 만들기</button></div>
    <div class="ledger">${rows.map(({ n, depth }) => `<div class="lrow" style="padding-left:${14 + depth * 20}px"><span class="ic">${ic(n.kind === 'zone' ? 'pin' : 'shelf')}</span><div class="main"><span class="t">${esc(n.name)}</span>${n.code ? `<span class="s"><span class="tape">${esc(n.code)}</span></span>` : ''}</div>
      ${depth < 2 ? `<button class="btn sm ghost" data-act="locNew" data-parent="${n.id}" data-write aria-label="${esc(n.name)} 안에 추가">${ic('plus')}안에</button>` : ''}<button class="iconbtn" data-act="locEdit" data-id="${n.id}" data-write aria-label="수정">${ic('edit')}</button></div>`).join('')}</div>
    <p class="muted" style="font-size:12.5px;margin:0">구역(예: 창고) › 캐비넷·선반(예: 선반 3) › 칸(예: 하단) 세 단계까지 만들 수 있습니다. 코드는 라벨에 크게 찍히는 짧은 이름입니다.</p>`;
  return { title: '위치 관리', crumbs: moreCr('위치 관리'), body };
};

VIEW['more.labels'] = r => {
  const sel = S.labelSel || (S.labelSel = new Set(S.cache.locations.filter(l => l.kind !== 'zone').map(l => l.id)));
  const rows = flatTree(S.ix.locKids);
  const chosen = rows.filter(x => sel.has(x.n.id)).map(x => x.n);
  const base = CONFIG.APP_URL || (location.origin + location.pathname);
  const body = `<details class="ledger" style="padding:0"><summary class="lrow" style="cursor:pointer;font-weight:600">라벨 만들 위치 고르기 (${sel.size}곳)</summary>
      ${rows.map(({ n, depth }) => `<label class="lrow" style="padding-left:${14 + depth * 20}px;cursor:pointer"><input type="checkbox" data-act="selLabel" data-id="${n.id}" ${sel.has(n.id) ? 'checked' : ''} style="width:20px;height:20px"><div class="main"><span class="t">${esc(n.name)}</span></div>${n.code ? `<span class="tape">${esc(n.code)}</span>` : ''}</label>`).join('')}</details>
    <div class="toolbar"><button class="btn primary" data-act="printLabels">${ic('docs')}인쇄</button><span class="muted" style="font-size:13px">A4에 인쇄해 잘라 붙이세요. 라벨지에 인쇄하면 더 오래갑니다.</span></div>
    ${DEMO ? `<div class="notice">${ic('info')}<span>체험판 화면에서는 인쇄 창이 열리지 않습니다. 실제 앱에서는 이 버튼으로 바로 인쇄됩니다.</span></div>` : ''}
    <div class="labels" id="labels">${chosen.map(l => `<div class="qrlabel">${qrSvg(base + '?loc=' + encodeURIComponent(l.code || l.id))}<span class="code">${esc(l.code || l.name)}</span><span class="nm">${esc(locPathText(l.id))}</span></div>`).join('')}</div>`;
  return { title: 'QR 라벨', crumbs: crumbs([{ label: '더보기', act: 'tab', data: { t: 'more' } }, { label: '위치 관리', act: 'go', data: { v: 'places' } }, { label: 'QR 라벨' }]), body };
};
function qrSvg(text) {
  if (typeof qrcode !== 'function') return `<div style="width:110px;height:110px;display:grid;place-items:center;border:1px solid #ccc;font-size:11px">QR</div>`;
  const q = qrcode(0, 'M'); q.addData(unescape(encodeURIComponent(text))); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

VIEW['more.cats'] = () => {
  const rows = flatTree(S.ix.catKids);
  const body = `<div class="toolbar"><button class="btn sm primary" data-act="catNew" data-write>${ic('plus')}분류 추가</button></div>
    <div class="ledger">${rows.map(({ n, depth }) => { const cnt = S.cache.items.filter(i => i.category_id === n.id).length; return `<div class="lrow" style="padding-left:${14 + depth * 20}px"><span class="ic">${ic('tag')}</span><div class="main"><span class="t">${esc(n.name)}</span><span class="s">품목 ${cnt}개</span></div>${depth < 1 ? `<button class="btn sm ghost" data-act="catNew" data-parent="${n.id}" data-write>${ic('plus')}하위</button>` : ''}<button class="iconbtn" data-act="catEdit" data-id="${n.id}" data-write aria-label="수정">${ic('edit')}</button></div>`; }).join('')}</div>`;
  return { title: '분류 관리', crumbs: moreCr('분류 관리'), body };
};

const BULK_COLS = ['품명', '규격', '제조사', '적용 기종', '분류', '단위', '최소 재고', '위치 코드', '수량', '메모'];
VIEW['more.bulk'] = () => {
  const b = S.bulk || (S.bulk = { text: '', rows: [] });
  const body = `<div class="notice">${ic('info')}<span>엑셀에 아래 순서대로 열을 만들고, 제목 줄을 뺀 나머지 칸을 드래그해 복사(Ctrl+C)한 뒤 아래 칸에 붙여 넣으세요(Ctrl+V). 분류와 위치 코드는 앱에 이미 있는 이름·코드와 같아야 연결됩니다.</span></div>
    <div class="scrollx"><table class="tbl"><tr>${BULK_COLS.map(c => `<th>${c}</th>`).join('')}</tr><tr><td>도어 롤러</td><td>Ø50 행거용</td><td>현대엘리베이터</td><td>STVF</td><td>롤러·슈</td><td>개</td><td>6</td><td>WH-S1-상</td><td>12</td><td></td></tr></table></div>
    <div class="field"><label for="bulk-in">붙여 넣을 곳</label><textarea id="bulk-in" rows="6" placeholder="엑셀에서 복사한 내용을 여기에 붙여 넣으세요" data-act="noop">${esc(b.text)}</textarea></div>
    <button class="btn" data-act="bulkCheck">${ic('check')}미리 보기</button>
    ${b.rows.length ? `<section class="sec"><div class="sec-h"><h2>미리 보기</h2><span class="aside">${b.rows.length}줄 · 문제 ${b.rows.filter(r => r.warn).length}줄</span></div>
      <div class="scrollx ledger"><table class="tbl"><tr><th>품명</th><th>규격</th><th>분류</th><th>위치</th><th>수량</th><th>확인</th></tr>${b.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.spec)}</td><td>${esc(r.catName || '-')}</td><td>${esc(r.locCode || '-')}</td><td class="num">${esc(r.qty || '')}</td><td>${r.warn ? `<span class="chip warn">${esc(r.warn)}</span>` : '<span class="chip ok">좋음</span>'}</td></tr>`).join('')}</table></div>
      <button class="btn primary big" data-act="bulkGo" data-write ${S.busy ? 'disabled' : ''}>${b.rows.filter(r => r.name).length}개 품목 등록</button>
      <p class="muted" style="font-size:12.5px;margin:0">문제가 있는 줄도 등록은 되지만, 모르는 분류는 「분류 없음」, 모르는 위치는 수량 없이 들어갑니다.</p></section>` : ''}`;
  return { title: '품목 대량 등록', crumbs: moreCr('품목 대량 등록'), body };
};

VIEW['more.trash'] = () => {
  const list = vd().list;
  const nm = { folder: '폴더', doc: '파일', item: '품목', location: '위치' };
  return { title: '휴지통', crumbs: moreCr('휴지통'), body: `<div class="ledger">${!list ? empty('trash', '불러오는 중…') : list.length ? list.map(x => `<div class="lrow"><div class="main"><span class="t">${esc(x.name)}</span><span class="s">${nm[x.type]} · ${esc(x.where)} · ${fmtWhen(x.at)} 삭제</span></div><button class="btn sm" data-act="restore" data-type="${x.type}" data-id="${x.id}" data-write>${ic('restore')}되살리기</button></div>`).join('') : empty('trash', '휴지통이 비어 있습니다.')}</div>
    <p class="muted" style="font-size:12.5px;margin:0">지운 지 30일이 지나면 목록에서 사라집니다. 파일 실물은 구글 드라이브 휴지통 규칙을 따릅니다.</p>` };
};

VIEW['more.guide'] = () => {
  const adm = can(S.user, 'users');
  const body = `<article class="guide hero" style="gap:6px">
    <h3>자재 쓰는 법</h3><ol><li>자재 탭에서 위치별 또는 분류별로 찾거나, 스캔 탭에서 선반 QR을 찍습니다.</li><li>품목을 열고 <b>출고</b>를 누른 뒤 꺼낸 위치·수량·현장을 고릅니다.</li><li>꺼냈다가 안 쓰고 돌려놓으면 기록 옆의 <b>출고 취소 (안 씀)</b>를 누릅니다. 수량이 원래대로 돌아갑니다. 본인 기록은 7일 안에 취소할 수 있고, 그 뒤에는 관리자가 합니다.</li><li>새로 들어온 자재는 <b>입고</b>, 다른 캐비넷으로 옮길 때는 <b>이동</b>입니다.</li></ol>
    <h3>자료 쓰는 법</h3><ol><li>자료 탭에서 폴더를 열고 <b>올리기</b>로 PDF·엑셀·사진을 그대로 올립니다.</li><li>검색창에 에러코드나 부품명을 치면 파일 안의 글자까지 찾아 줍니다.</li><li>교육 영상은 유튜브에 「일부 공개」로 올린 뒤 <b>영상·링크</b>로 주소만 등록합니다.</li></ol>
    ${adm ? `<h3>가입 승인과 퇴사자</h3><ol><li>더보기 › 직원 관리에서 이름·사내번호를 확인하고 승인합니다.</li><li>비밀번호를 잊은 직원은 이름을 눌러 <b>비밀번호 초기화</b> → 화면에 뜬 임시 번호를 알려 주고, 로그인 뒤 본인이 바꾸게 합니다.</li><li>퇴사자는 지우지 않고 <b>사용 중지</b>합니다. 그 사람이 남긴 입출고 기록은 그대로 남습니다.</li></ol>
    <h3>위치 추가와 QR 라벨</h3><ol><li>더보기 › 위치 관리에서 캐비넷·선반을 추가하고 짧은 코드(예: WH-S5)를 붙입니다.</li><li>QR 라벨 만들기 → 인쇄 → 선반에 붙입니다. 폰 기본 카메라로 찍어도 앱이 그 선반 화면으로 열립니다.</li></ol>
    <h3>빨간 불이 켜졌을 때 (시스템 상태)</h3><ol><li>직원들이 앱을 평소처럼 쓰고 있다면 급한 일은 아닙니다. 앱을 쓰는 것만으로도 서버는 깨어 있습니다.</li><li>회사용 구글 계정(gaya.elevator.app)에 로그인해 보안 경고나 계정 잠김 안내가 있는지 봅니다.</li><li>그래도 계속 빨간 불이면 개발자(재석)에게 연락합니다.</li><li>앱이 아예 열리지 않고 「서버가 쉬고 있습니다」라고 나오면: supabase.com 에 소유자 계정으로 로그인 → 가야엘리베이터 조직 › gaya-app 프로젝트 → <b>Resume project</b> 를 누르고 몇 분 기다립니다. 멈춘 뒤 1년 안이면 데이터는 그대로입니다.</li></ol>
    <h3>저장 용량 80% 경고</h3><p>개발자(재석)에게 연락합니다. 구글 원 구독(100GB 월 2,400원) 또는 무료 구글 계정 추가 중에서 고르면 되고, 어느 쪽이든 앱은 그대로 씁니다.</p>
    <h3>매년 1월에 할 일</h3><p>회사용 구글 계정(gaya.elevator.app)에 한 번 로그인해 드라이브의 「가야앱 백업」 폴더를 열어 봅니다. 구글은 2년 동안 쓰지 않은 계정을 지우기 때문에, 사람이 1년에 한 번 들어가 두는 것입니다.</p>
    <h3>앱이 업데이트되면</h3><p>개발자가 고친 내용은 올리는 즉시 반영됩니다. 직원 폰에서 예전 화면이 보이면 앱을 완전히 닫았다가 다시 열면 됩니다.</p>` : ''}
  </article>`;
  return { title: adm ? '관리자 안내' : '사용 안내', crumbs: moreCr(adm ? '관리자 안내' : '사용 안내'), body };
};

/* ───────── 아래에서 올라오는 입력 시트 ───────── */
function openSheet(type, d = {}) { S.sheet = { type, d: { op_id: opId(), ...d }, err: '' }; S.sheetFocused = false; render(); }
const stepper = (k, v) => `<div class="stepper"><button type="button" data-act="step" data-k="${k}" data-d="-1" aria-label="하나 빼기">−</button><input id="sh-${k}" inputmode="numeric" pattern="[0-9]*" data-bind="${k}" value="${esc(v)}" aria-label="수량"><button type="button" data-act="step" data-k="${k}" data-d="1" aria-label="하나 더하기">+</button></div>`;
function locPicker(k, sel, { onlyWith, qtyOf, exclude } = {}) {
  const rows = flatTree(S.ix.locKids).filter(({ n }) => (!onlyWith || onlyWith.has(n.id)) && n.id !== exclude);
  if (!rows.length) return `<div class="notice">${ic('info')}<span>고를 수 있는 위치가 없습니다.</span></div>`;
  return `<div class="pickgrid" role="listbox">${rows.map(({ n, depth }) => `<button type="button" class="pick" data-act="pick" data-k="${k}" data-v="${n.id}" aria-pressed="${sel === n.id}" style="padding-left:${12 + (onlyWith ? 0 : depth * 16)}px">
    <div class="main"><span>${esc(onlyWith ? locPathText(n.id) : n.name)}</span>${n.code ? `<span class="s"><span class="tape">${esc(n.code)}</span></span>` : ''}</div>${qtyOf ? `<span class="qty">${qtyOf(n.id)}</span>` : ''}</button>`).join('')}</div>`;
}
const sheetHead = (t, sub = '') => `<div class="sheet-h"><h3 id="sheet-t">${esc(t)}</h3><button class="iconbtn" data-act="sheetClose" aria-label="닫기">${ic('x')}</button></div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
const sheetErr = () => S.sheet.err ? `<div class="notice crit" role="alert">${ic('warn')}<span>${esc(S.sheet.err)}</span></div>` : '';
const okBtn = (label, cls = 'primary') => `<button class="btn ${cls} block big" data-act="sheetOk" data-write ${S.busy ? 'disabled' : ''}>${S.busy ? '저장하는 중…' : label}</button>`;
function folderPicker(k, sel, exclude) {
  const rows = flatTree(S.ix.folderKids).filter(({ n }) => !exclude || !pathOf(S.ix.folder, n.id).some(p => p.id === exclude));
  return `<div class="pickgrid"><button type="button" class="pick" data-act="pick" data-k="${k}" data-v="" aria-pressed="${!sel}"><div class="main"><span>자료 (맨 위)</span></div></button>${rows.map(({ n, depth }) => `<button type="button" class="pick" data-act="pick" data-k="${k}" data-v="${n.id}" aria-pressed="${sel === n.id}" style="padding-left:${12 + depth * 16}px"><span class="folder-ic" style="width:22px;height:22px">${ic('folder')}</span><div class="main"><span>${esc(n.name)}</span></div></button>`).join('')}</div>`;
}

function sheetView() {
  const s = S.sheet, d = s.d; let h = '';
  const it = d.item_id ? S.ix.item.get(d.item_id) : null;
  const unit = it ? it.unit : '개';
  const stockAt = id => ((S.ix.byItem.get(d.item_id) || []).find(x => x.location_id === id) || {}).qty || 0;
  const withStock = () => new Set((S.ix.byItem.get(d.item_id) || []).filter(x => x.qty > 0).map(x => x.location_id));
  switch (s.type) {
    case 'in':
      if (!it) {
        const q = (d.iq || '').trim().toLowerCase();
        const list = S.cache.items.filter(i => !q || [i.name, i.spec, i.maker, i.models].join(' ').toLowerCase().includes(q)).slice(0, 60);
        h = sheetHead('입고할 품목 고르기', esc(locPathText(d.location_id)) + '에 넣을 품목') + `<div class="search">${ic('search')}<input id="sh-iq" data-bind="iq" data-live value="${esc(d.iq || '')}" placeholder="품명·규격 검색" data-autofocus></div>
          <div class="pickgrid" style="max-height:50vh">${list.map(i => `<button type="button" class="pick" data-act="pick" data-k="item_id" data-v="${i.id}"><div class="main"><span>${esc(itemTitle(i))}</span><span class="s">${esc(i.maker || '')}</span></div><span class="qty">${total(i.id)}</span></button>`).join('') || '<div class="empty">찾는 품목이 없습니다. 새 품목은 관리자가 등록합니다.</div>'}</div>`;
        break;
      }
      h = sheetHead('입고', esc(itemTitle(it))) + `<div class="field"><span class="lab">넣을 위치</span>${locPicker('location_id', d.location_id, { qtyOf: stockAt })}</div>
        <div class="field"><span class="lab">수량 (${esc(unit)})</span>${stepper('qty', d.qty)}</div>
        <div class="field"><label for="sh-note">메모 (선택)</label><input id="sh-note" data-bind="note" value="${esc(d.note || '')}" placeholder="예: 거래처 입고, 정기 발주분"></div>
        ${sheetErr()}${okBtn('입고 ' + (+d.qty || 0) + unit, 'in')}`;
      break;
    case 'out':
      h = sheetHead('출고', esc(itemTitle(it))) + `<div class="field"><span class="lab">꺼내는 위치</span>${locPicker('location_id', d.location_id, { onlyWith: withStock(), qtyOf: stockAt })}</div>
        <div class="field"><span class="lab">수량 (${esc(unit)}) · 이 위치에 ${stockAt(d.location_id)}${esc(unit)}</span>${stepper('qty', d.qty)}</div>
        <div class="field"><label for="sh-site">현장 (선택)</label><input id="sh-site" data-bind="site" list="sites" value="${esc(d.site || '')}" placeholder="예: 한빛아파트 103동 2호기"><datalist id="sites">${[...new Set(S.cache.recentSites || [])].map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
        <div class="field"><label for="sh-note">메모 (선택)</label><input id="sh-note" data-bind="note" value="${esc(d.note || '')}"></div>
        ${sheetErr()}${okBtn('출고 ' + (+d.qty || 0) + unit, 'out')}
        <p class="muted" style="margin:0;font-size:12.5px">꺼냈다가 안 쓰면 기록에서 「출고 취소 (안 씀)」를 누르면 수량이 돌아옵니다.</p>`;
      break;
    case 'move':
      h = sheetHead('이동', esc(itemTitle(it))) + `<div class="field"><span class="lab">보내는 위치</span>${locPicker('from', d.from, { onlyWith: withStock(), qtyOf: stockAt })}</div>
        <div class="field"><span class="lab">받는 위치</span>${locPicker('to', d.to, { qtyOf: stockAt, exclude: d.from })}</div>
        <div class="field"><span class="lab">수량 (${esc(unit)})</span>${stepper('qty', d.qty)}</div>
        <div class="field"><label for="sh-note">메모 (선택)</label><input id="sh-note" data-bind="note" value="${esc(d.note || '')}" placeholder="예: 당직 차량용"></div>
        ${sheetErr()}${okBtn('이동 ' + (+d.qty || 0) + unit)}`;
      break;
    case 'adjust':
      h = sheetHead('수량 정정', esc(itemTitle(it)) + ' · 실제로 세어 본 수량으로 맞춥니다') + `<div class="field"><span class="lab">위치</span>${locPicker('location_id', d.location_id, { qtyOf: stockAt })}</div>
        <div class="field"><span class="lab">실제 수량 (${esc(unit)}) · 지금 기록 ${stockAt(d.location_id)}${esc(unit)}</span>${stepper('qty', d.qty)}</div>
        <div class="field"><label for="sh-reason">사유 (필수)</label><input id="sh-reason" data-bind="reason" value="${esc(d.reason || '')}" placeholder="예: 월말 실사, 파손 폐기"></div>
        ${sheetErr()}${okBtn('정정 저장')}`;
      break;
    case 'item': {
      const cats = flatTree(S.ix.catKids);
      h = sheetHead(d.id ? '품목 수정' : '품목 추가') + `<div class="field"><label for="sh-name">품명</label><input id="sh-name" data-bind="name" value="${esc(d.name || '')}" placeholder="예: 도어 롤러" data-autofocus></div>
        <div class="row2"><div class="field"><label for="sh-spec">규격·사양</label><input id="sh-spec" data-bind="spec" value="${esc(d.spec || '')}" placeholder="예: Ø62 행거용"></div><div class="field"><label for="sh-maker">제조사</label><input id="sh-maker" data-bind="maker" value="${esc(d.maker || '')}"></div></div>
        <div class="field"><label for="sh-models">적용 기종</label><input id="sh-models" data-bind="models" value="${esc(d.models || '')}" placeholder="예: GEN2, STVF"></div>
        <div class="field"><label for="sh-cat">분류</label><select id="sh-cat" data-bind="category_id"><option value="">분류 없음</option>${cats.map(({ n, depth }) => `<option value="${n.id}" ${d.category_id === n.id ? 'selected' : ''}>${'  '.repeat(depth)}${depth ? '└ ' : ''}${esc(n.name)}</option>`).join('')}</select></div>
        <div class="row2"><div class="field"><label for="sh-unit">단위</label><input id="sh-unit" data-bind="unit" value="${esc(d.unit || '개')}" list="units"><datalist id="units"><option value="개"><option value="세트"><option value="봉"><option value="통"><option value="m"><option value="롤"></datalist></div>
        <div class="field"><label for="sh-min">최소 재고</label><input id="sh-min" data-bind="min_qty" inputmode="numeric" value="${esc(d.min_qty ?? '')}" placeholder="0"><span class="hint">이보다 적으면 「부족」 표시</span></div></div>
        <div class="field"><label for="sh-memo">메모</label><textarea id="sh-memo" data-bind="memo">${esc(d.memo || '')}</textarea></div>
        ${sheetErr()}${okBtn(d.id ? '저장' : '품목 추가')}
        ${d.id ? `<button class="btn danger block" data-act="itemDelete" data-id="${d.id}" data-write>${ic('trash')}품목 삭제</button>` : ''}`;
      break;
    }
    case 'memo':
      h = sheetHead('메모', esc(itemTitle(S.ix.item.get(d.id)))) + `<div class="field"><label for="sh-memo" class="sr">메모</label><textarea id="sh-memo" data-bind="memo" rows="6" data-autofocus placeholder="대체품, 보관 요령, 주의할 점">${esc(d.memo || '')}</textarea></div>${sheetErr()}${okBtn('메모 저장')}`;
      break;
    case 'loc':
      h = sheetHead(d.id ? '위치 수정' : (d.parent_id ? locPathText(d.parent_id) + ' 안에 추가' : '구역 추가')) + `<div class="field"><label for="sh-lname">이름</label><input id="sh-lname" data-bind="name" value="${esc(d.name || '')}" placeholder="${d.parent_id ? '예: 선반 5, 하단' : '예: 창고'}" data-autofocus></div>
        <div class="field"><label for="sh-code">라벨 코드</label><input id="sh-code" data-bind="code" value="${esc(d.code || '')}" placeholder="예: WH-S5" autocapitalize="characters"><span class="hint">QR 라벨에 크게 찍히는 짧은 이름입니다. 겹치지 않게 정하세요.</span></div>
        <div class="field"><span class="lab">사진 (선택)</span><div class="toolbar"><div class="photo" style="width:64px;height:64px">${d.photo ? `<img src="${esc(d.photo)}" alt="">` : ic('shelf')}</div><button type="button" class="btn sm" data-act="sheetPhoto">${ic('cam')}${d.photo ? '사진 바꾸기' : '사진 찍기'}</button></div></div>
        ${sheetErr()}${okBtn(d.id ? '저장' : '추가')}
        ${d.id ? `<button class="btn danger block" data-act="locDelete" data-id="${d.id}" data-write>${ic('trash')}위치 삭제</button>` : ''}`;
      break;
    case 'cat':
      h = sheetHead(d.id ? '분류 수정' : (d.parent_id ? S.ix.cat.get(d.parent_id).name + ' 하위 분류 추가' : '분류 추가')) + `<div class="field"><label for="sh-cname">이름</label><input id="sh-cname" data-bind="name" value="${esc(d.name || '')}" data-autofocus></div>${sheetErr()}${okBtn(d.id ? '저장' : '추가')}${d.id ? `<button class="btn danger block" data-act="catDelete" data-id="${d.id}" data-write>${ic('trash')}분류 삭제</button>` : ''}`;
      break;
    case 'mkdir':
      h = sheetHead('폴더 만들기', esc(d.parent_id ? folderPathText(d.parent_id) : '자료') + ' 안에') + `<div class="field"><label for="sh-fname">폴더 이름</label><input id="sh-fname" data-bind="name" value="${esc(d.name || '')}" placeholder="예: 현대 STVF" data-autofocus></div>
        <label class="notice" style="cursor:pointer"><input type="checkbox" data-bind="auto_sort" ${d.auto_sort ? 'checked' : ''} style="width:20px;height:20px;flex:none"><span><b>날짜별 자동 정리</b> · 업무일지처럼 매달 쌓이는 자료라면 켜세요. 올릴 때 연도 › 월 폴더가 저절로 생깁니다.</span></label>
        ${sheetErr()}${okBtn('만들기')}`;
      break;
    case 'rename':
      h = sheetHead(d.kind === 'folder' ? '폴더 이름 변경' : '파일 이름 변경') + `<div class="field"><label for="sh-rn">새 이름</label><input id="sh-rn" data-bind="name" value="${esc(d.name || '')}" data-autofocus></div>${sheetErr()}${okBtn('저장')}`;
      break;
    case 'moveTo':
      h = sheetHead(d.kind === 'folder' ? '폴더 옮기기' : '파일 옮기기', '옮길 곳을 고르세요') + folderPicker('target', d.target, d.kind === 'folder' ? d.id : null) + sheetErr() + okBtn('여기로 옮기기');
      break;
    case 'link':
      h = sheetHead('영상·링크 등록', esc(folderPathText(d.folder_id))) + `<div class="field"><label for="sh-lt">제목</label><input id="sh-lt" data-bind="name" value="${esc(d.name || '')}" placeholder="예: 피트 작업 추락 방지 요령" data-autofocus></div>
        <div class="field"><label for="sh-url">주소</label><input id="sh-url" data-bind="url" value="${esc(d.url || '')}" inputmode="url" placeholder="https://youtu.be/..."><span class="hint">교육 영상은 유튜브에 「일부 공개」로 올린 뒤 주소를 붙여 넣으세요. 드라이브 용량을 쓰지 않습니다.</span></div>
        ${sheetErr()}${okBtn('등록')}`;
      break;
    case 'folderMenu': {
      const f = S.ix.folder.get(d.id);
      h = sheetHead(f.name, '폴더 관리 (관리자)') + `<div class="ledger menu"><button class="lrow" data-act="folderRename" data-id="${f.id}" data-write><span class="ic">${ic('edit')}</span><div class="main"><span class="t">이름 변경</span></div></button><button class="lrow" data-act="folderMove" data-id="${f.id}" data-write><span class="ic">${ic('move')}</span><div class="main"><span class="t">다른 폴더로 옮기기</span></div></button><button class="lrow" data-act="folderDelete" data-id="${f.id}" data-write><span class="ic" style="color:var(--crit)">${ic('trash')}</span><div class="main"><span class="t" style="color:var(--crit)">폴더 삭제</span><span class="s">안의 폴더·파일도 함께 휴지통으로 갑니다</span></div></button></div>`;
      break;
    }
    case 'confirm':
      h = sheetHead(d.title) + `<p style="margin:0">${esc(d.msg)}</p>${sheetErr()}<div class="row2"><button class="btn big" data-act="sheetClose">그만두기</button><button class="btn big ${d.danger ? 'danger' : 'primary'}" data-act="sheetOk" data-write ${S.busy ? 'disabled' : ''}>${esc(d.ok || '확인')}</button></div>`;
      break;
    case 'userMenu': {
      const p = (vd().list || []).find(x => x.id === d.id); if (!p) return '';
      const roles = can(S.user, 'setDev') ? ['staff', 'admin', 'dev'] : ['staff', 'admin'];
      h = sheetHead(p.name, '사내번호 ' + esc(p.emp_no) + ' · ' + ROLE_NAME[p.role]) + (p.id === S.user.id ? `<div class="notice">${ic('info')}<span>본인 계정은 여기서 바꿀 수 없습니다. 비밀번호는 더보기 › 내 정보에서 바꾸세요.</span></div>` : `
        <div class="field"><span class="lab">권한</span><div class="seg" role="group">${roles.map(r => `<button data-act="setRole" data-id="${p.id}" data-role="${r}" aria-pressed="${p.role === r}" data-write ${p.role === 'dev' && !can(S.user, 'setDev') ? 'disabled' : ''}>${ROLE_NAME[r]}</button>`).join('')}</div><span class="hint">관리자는 품목·위치·폴더 관리와 직원 승인을 할 수 있습니다.</span></div>
        <div class="ledger menu"><button class="lrow" data-act="resetPw" data-id="${p.id}" data-write><span class="ic">${ic('key')}</span><div class="main"><span class="t">비밀번호 초기화</span><span class="s">임시 비밀번호 6자리를 만들어 보여 줍니다</span></div></button>
        <button class="lrow" data-act="disableUser" data-id="${p.id}" data-write><span class="ic" style="color:var(--crit)">${ic('logout')}</span><div class="main"><span class="t" style="color:var(--crit)">사용 중지 (퇴사)</span><span class="s">로그인만 막고, 남긴 기록은 그대로 둡니다</span></div></button></div>`) + sheetErr();
      break;
    }
    case 'tempPw':
      h = sheetHead('임시 비밀번호') + `<p style="margin:0">${esc(d.name)}님에게 아래 번호를 알려 주세요. 로그인한 뒤 더보기 › 내 정보에서 바로 바꾸도록 안내하세요.</p><div class="total" style="justify-content:center"><span class="big mono" style="letter-spacing:.12em">${esc(d.pw)}</span></div><button class="btn block" data-act="copyPw" data-pw="${esc(d.pw)}">번호 복사</button><button class="btn primary block big" data-act="sheetClose">확인</button>`;
      break;
    case 'switchRole':
      h = sheetHead('다른 역할로 보기', '체험판 전용') + `<div class="rolepick"><button data-act="quick" data-role="dev"><b>개발자</b><span>재석</span></button><button data-act="quick" data-role="admin"><b>관리자</b><span>김도윤</span></button><button data-act="quick" data-role="staff"><b>직원</b><span>박성호</span></button></div>`;
      break;
  }
  return `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t">${h}</div></div>`;
}

/* 시트의 「저장」 */
ACT.sheetOk = () => {
  const s = S.sheet, d = s.d, A = S.api;
  const itName = () => itemTitle(S.ix.item.get(d.item_id));
  const jobs = {
    in: () => run(() => A.stockIn(d), `입고했습니다 · ${itName()} ${d.qty}`),
    out: () => { if (!d.location_id) return (s.err = '꺼내는 위치를 고르세요.', render()); return run(() => A.stockOut(d), `출고했습니다 · ${itName()} ${d.qty}`); },
    move: () => run(() => A.stockMove(d), '옮겼습니다'),
    adjust: () => run(() => A.stockAdjust(d), '수량을 정정했습니다'),
    item: () => run(() => A.saveItem(d), d.id ? '저장했습니다' : '품목을 추가했습니다').then(id => { if (id && !d.id && id !== true) nav({ tab: 'items', view: 'item', id }); }),
    memo: () => run(() => A.saveItem({ id: d.id, memo: d.memo }), '메모를 저장했습니다'),
    loc: () => run(() => A.saveLocation(d), d.id ? '저장했습니다' : '위치를 추가했습니다'),
    cat: () => run(() => A.saveCategory(d), '저장했습니다'),
    mkdir: () => run(() => A.mkdir(d), '폴더를 만들었습니다'),
    rename: () => run(() => d.kind === 'folder' ? A.renameFolder(d.id, d.name) : A.renameDoc(d.id, d.name), '이름을 바꿨습니다'),
    moveTo: () => run(() => d.kind === 'folder' ? A.moveFolder(d.id, d.target || null) : A.moveDoc(d.id, d.target || null), '옮겼습니다'),
    link: () => run(() => A.addLink(d.folder_id, d), '등록했습니다'),
    confirm: () => CONFIRM[d.cb] && CONFIRM[d.cb](d)
  };
  jobs[s.type] && jobs[s.type]();
};
const CONFIRM = {
  cancelTx: d => run(() => S.api.stockCancel({ tx_id: d.id, op_id: d.op_id }), '취소했습니다 · 수량이 원래대로 돌아갔습니다'),
  itemDelete: d => run(() => S.api.deleteItem(d.id), '품목을 휴지통으로 옮겼습니다').then(ok => { if (ok) back(); }),
  locDelete: d => run(() => S.api.deleteLocation(d.id), '위치를 지웠습니다').then(ok => { if (ok && route().node === d.id) back(); }),
  catDelete: d => run(() => S.api.deleteCategory(d.id), '분류를 지웠습니다'),
  folderDelete: d => run(() => S.api.deleteFolder(d.id), '폴더를 휴지통으로 옮겼습니다').then(ok => { if (ok) back(); }),
  docDelete: d => run(() => S.api.deleteDoc(d.id), '파일을 휴지통으로 옮겼습니다').then(ok => { if (ok) back(); }),
  rejectUser: d => run(() => S.api.reject(d.id), '신청을 거절했습니다'),
  disableUser: d => run(() => S.api.setActive(d.id, false), '사용을 중지했습니다'),
  approveAll: d => run(() => S.api.approve(d.ids), d.ids.length + '명을 승인했습니다').then(() => S.userSel && S.userSel.clear()),
  bulkGo: d => run(() => S.api.bulkItems(d.rows), n => n + '개 품목을 등록했습니다').then(ok => { if (ok) S.bulk = null; }),
  demoReset: () => { S.api.reset(); location.reload(); }
};
const ask = (title, msg, cb, extra = {}) => openSheet('confirm', { title, msg, cb, ...extra });

/* ───────── 누름 처리 ───────── */
Object.assign(ACT, {
  tab: d => goTab(d.t),
  back: () => { if (S.hist && history.state && history.state.d) history.back(); else back(); },
  scrim: (d, el, e) => { if (e.target === el) { S.sheet = null; render(); } },
  sheetClose: () => { S.sheet = null; render(); },
  mode: d => { S.itemsMode = d.m; store.set('gaya-mode', d.m); S.stack = [{ tab: 'items', view: 'browse', node: null }]; render(); onEnterRoute(); },
  locRoot: () => { S.stack = [{ tab: 'items', view: 'browse', node: null }]; render(); onEnterRoute(); },
  catRoot: () => { S.itemsMode = 'cat'; ACT.locRoot(); },
  loc: d => { S.itemsMode = 'loc'; S.q = ''; if (S.tab !== 'items') { S.lastTab[S.tab] = S.stack; S.stack = [{ tab: 'items', view: 'browse', node: null }]; } nav({ tab: 'items', view: 'browse', node: d.id }); },
  cat: d => { S.itemsMode = 'cat'; nav({ tab: 'items', view: 'browse', node: d.id }); },
  item: d => { if (S.tab !== 'items') { S.lastTab[S.tab] = S.stack; S.stack = [{ tab: 'items', view: 'browse', node: null }]; } nav({ tab: 'items', view: 'item', id: d.id }); },
  folder: d => { S.docsQ = ''; S.docSearchRes = null; if (!d.id) { S.stack = [{ tab: 'docs', view: 'browse', folder: null }]; render(); return; } const i = S.stack.findIndex(r => r.folder === d.id); if (i >= 0) { S.stack = S.stack.slice(0, i + 1); render(); } else nav({ tab: 'docs', view: 'browse', folder: d.id }); },
  doc: d => nav({ tab: 'docs', view: 'doc', id: d.id }),
  go: d => nav({ tab: 'more', view: d.v }),
  authView: d => { S.authView = d.v; S.authErr = ''; render(); },
  quick: async d => { S.sheet = null; S.user = await S.api.quickLogin(d.role); await afterLogin(); },
  recheck: async () => { S.user = await S.api.session(); if (S.user && S.user.status === 'active') await afterLogin(); else toast('아직 승인되지 않았습니다.'); },
  logout: async () => { await S.api.logout(); S.user = null; S.cache = null; S.authView = 'login'; S.stack = [{ tab: 'items', view: 'browse', node: null }]; S.tab = 'items'; S.lastTab = {}; render(); },

  txIn: d => { const it = S.ix.item.get(d.id); const rows = S.ix.byItem.get(d.id) || []; openSheet('in', { item_id: d.id, location_id: (rows[0] || {}).location_id || null, qty: 1 }); },
  txOut: d => { const rows = (S.ix.byItem.get(d.id) || []).slice().sort((a, b) => b.qty - a.qty); const here = route().node && rows.find(r => r.location_id === route().node); openSheet('out', { item_id: d.id, location_id: (here || rows[0] || {}).location_id || null, qty: 1 }); },
  txMove: d => { const rows = (S.ix.byItem.get(d.id) || []).slice().sort((a, b) => b.qty - a.qty); openSheet('move', { item_id: d.id, from: (rows[0] || {}).location_id || null, to: null, qty: 1 }); },
  txAdjust: d => { const rows = S.ix.byItem.get(d.id) || []; const l = (rows[0] || {}).location_id || null; openSheet('adjust', { item_id: d.id, location_id: l, qty: l ? rows[0].qty : 0 }); },
  inHere: d => openSheet('in', { item_id: null, location_id: d.id, qty: 1 }),
  pick: d => {
    const s = S.sheet; s.d[d.k] = d.v || null;
    if (s.type === 'adjust' && d.k === 'location_id') s.d.qty = ((S.ix.byItem.get(s.d.item_id) || []).find(x => x.location_id === d.v) || {}).qty || 0;
    if (s.type === 'move' && d.k === 'from' && s.d.to === d.v) s.d.to = null;
    render();
  },
  step: d => { const s = S.sheet; const min = s.type === 'adjust' ? 0 : 1; s.d[d.k] = Math.max(min, (parseInt(s.d[d.k], 10) || 0) + +d.d); render(); },
  cancelTx: d => { const t = (vd().tx || []).find(x => x.id === d.id); const it = S.ix.item.get(t.item_id);
    ask(t.type === 'out' ? '출고를 취소할까요?' : TX_NAME[t.type] + '을 취소할까요?', `${personName(t.user_id)} · ${fmtWhen(t.created_at)} · ${itemTitle(it)} ${t.qty}${it.unit}. ${t.type === 'out' ? locPathText(t.from_loc) + '에 수량이 다시 더해집니다.' : '수량이 기록 전 상태로 돌아갑니다.'}`, 'cancelTx', { id: d.id, ok: '취소하기' }); },

  itemNew: () => openSheet('item', { unit: '개', category_id: S.itemsMode === 'cat' ? route().node || '' : '' }),
  itemEdit: d => { const it = S.ix.item.get(d.id); openSheet('item', { ...clone(it) }); },
  itemDelete: d => ask('품목을 지울까요?', itemTitle(S.ix.item.get(d.id)) + ' · 휴지통에서 30일 안에 되살릴 수 있습니다. 재고가 남아 있으면 지워지지 않습니다.', 'itemDelete', { id: d.id, ok: '지우기', danger: true }),
  memoEdit: d => openSheet('memo', { id: d.id, memo: S.ix.item.get(d.id).memo || '' }),
  photoItem: d => { if (!online()) return toast('오프라인이라 저장할 수 없습니다.', true); S.photoTarget = { type: 'item', id: d.id }; $('#photopick').click(); },
  sheetPhoto: () => { S.photoTarget = { type: 'sheet' }; $('#photopick').click(); },
  locNew: d => openSheet('loc', { parent_id: d.parent || null }),
  locEdit: d => { const l = S.ix.loc.get(d.id); openSheet('loc', { ...clone(l) }); },
  locDelete: d => ask('위치를 지울까요?', locPathText(d.id) + ' · 자재나 안쪽 위치가 남아 있으면 지워지지 않습니다.', 'locDelete', { id: d.id, ok: '지우기', danger: true }),
  labelsFor: d => { S.labelSel = new Set(descLocs(d.id).filter(id => S.ix.loc.get(id).kind !== 'zone' || id === d.id)); nav({ tab: 'more', view: 'labels' }); },
  selLabel: (d, el) => { el.checked ? S.labelSel.add(d.id) : S.labelSel.delete(d.id); setTimeout(render, 0); },
  printLabels: () => { if (DEMO) return toast('체험판 화면에서는 인쇄 창이 열리지 않습니다. 실제 앱에서는 바로 인쇄됩니다.'); window.print(); },
  catNew: d => openSheet('cat', { parent_id: d.parent || null }),
  catEdit: d => openSheet('cat', { ...clone(S.ix.cat.get(d.id)) }),
  catDelete: d => ask('분류를 지울까요?', S.ix.cat.get(d.id).name + ' · 품목이나 하위 분류가 있으면 지워지지 않습니다.', 'catDelete', { id: d.id, ok: '지우기', danger: true }),

  mkdir: () => openSheet('mkdir', { parent_id: route().folder || null }),
  addLink: () => openSheet('link', { folder_id: route().folder }),
  upload: () => $('#filepick').click(),
  folderMenu: d => openSheet('folderMenu', { id: d.id }),
  folderRename: d => openSheet('rename', { kind: 'folder', id: d.id, name: S.ix.folder.get(d.id).name }),
  folderMove: d => openSheet('moveTo', { kind: 'folder', id: d.id, target: S.ix.folder.get(d.id).parent_id }),
  folderDelete: d => { const n = descFolders(d.id); ask('폴더를 지울까요?', `${folderPathText(d.id)} · 안의 폴더 ${n.f}개와 파일 ${n.d}개도 함께 휴지통으로 갑니다. 30일 안에 되살릴 수 있습니다.`, 'folderDelete', { id: d.id, ok: '지우기', danger: true }); },
  docRename: d => openSheet('rename', { kind: 'doc', id: d.id, name: S.ix.doc.get(d.id).name }),
  docMove: d => openSheet('moveTo', { kind: 'doc', id: d.id, target: S.ix.doc.get(d.id).folder_id }),
  docDelete: d => ask('파일을 지울까요?', S.ix.doc.get(d.id).name + ' · 휴지통에서 30일 안에 되살릴 수 있습니다.', 'docDelete', { id: d.id, ok: '지우기', danger: true }),
  delComment: d => run(() => S.api.deleteComment(d.id), '댓글을 지웠습니다', { reload: false }),

  notif: d => { const l = JSON.parse(d.link || '{}'); if (!l.tab) return; if (l.view === 'item') ACT.item({ id: l.id }); else if (l.view === 'users') { S.lastTab[S.tab] = S.stack; S.stack = [{ tab: 'more', view: 'menu' }]; nav({ tab: 'more', view: 'users' }); } else goTab(l.tab); },
  readAll: async () => { await S.api.markAllRead(); S.unread = 0; onEnterRoute(); },

  selUser: (d, el) => { S.userSel = S.userSel || new Set(); el.checked ? S.userSel.add(d.id) : S.userSel.delete(d.id); setTimeout(render, 0); },
  approveSel: () => { const ids = [...(S.userSel || [])]; if (ids.length) run(() => S.api.approve(ids), ids.length + '명을 승인했습니다').then(() => S.userSel.clear()); },
  approveAll: () => { const ids = (vd().list || []).filter(p => p.status === 'pending').map(p => p.id); ask('전체 승인할까요?', (vd().list || []).filter(p => p.status === 'pending').map(p => p.name + '(' + p.emp_no + ')').join(', ') + ' · 모두 바로 앱을 쓸 수 있게 됩니다.', 'approveAll', { ids, ok: ids.length + '명 승인' }); },
  rejectUser: (d, el, e) => { e.preventDefault(); const p = (vd().list || []).find(x => x.id === d.id); ask('가입 신청을 거절할까요?', p.name + ' (' + p.emp_no + ') · 신청이 지워집니다. 실수라면 다시 신청하면 됩니다.', 'rejectUser', { id: d.id, ok: '거절', danger: true }); },
  userMenu: d => openSheet('userMenu', { id: d.id }),
  setRole: d => run(() => S.api.setRole(d.id, d.role), '권한을 바꿨습니다', { keepSheet: true }),
  resetPw: async d => { const p = (vd().list || []).find(x => x.id === d.id); const pw = await run(() => S.api.resetPassword(d.id), null, { reload: false }); if (pw && pw !== true) openSheet('tempPw', { name: p.name, pw }); },
  copyPw: d => { navigator.clipboard.writeText(d.pw).then(() => toast('복사했습니다'), () => toast('복사하지 못했습니다. 번호를 직접 알려 주세요.', true)); },
  disableUser: d => { const p = (vd().list || []).find(x => x.id === d.id); ask('사용을 중지할까요?', p.name + ' · 로그인만 막히고 입출고·댓글 기록은 그대로 남습니다. 언제든 「다시 사용」할 수 있습니다.', 'disableUser', { id: d.id, ok: '사용 중지', danger: true }); },
  enableUser: d => run(() => S.api.setActive(d.id, true), '다시 쓸 수 있게 했습니다'),
  logKind: d => { S.logKind = d.k; VIEWDATA[JSON.stringify(route())] = {}; render(); onEnterRoute(); },
  restore: d => run(() => S.api.restore(d.type, d.id), '되살렸습니다'),

  bulkCheck: () => {
    const text = ($('#bulk-in') || {}).value || ''; S.bulk = { text, rows: [] };
    const byCat = new Map(S.cache.categories.map(c => [c.name.trim(), c.id])); const byCode = new Map(S.cache.locations.filter(l => l.code).map(l => [l.code.toUpperCase(), l.id]));
    S.bulk.rows = text.split(/\r?\n/).map(l => l.split('\t')).filter(c => c.join('').trim()).map(c => {
      const [name, spec, maker, models, cat, unit, min, code, qty, memo] = c.map(x => (x || '').trim());
      const r = { name, spec, maker, models, unit: unit || '개', min_qty: +min || 0, qty: +qty || 0, memo, catName: cat, locCode: code };
      if (cat) r.category_id = byCat.get(cat); if (code) r.location_id = byCode.get(code.toUpperCase());
      r.warn = !name ? '품명 없음' : cat && !r.category_id ? '모르는 분류' : code && !r.location_id ? '모르는 위치 코드' : qty && isNaN(+qty) ? '수량이 숫자가 아님' : '';
      return r;
    });
    if (!S.bulk.rows.length) toast('붙여 넣은 내용이 없습니다.', true); render();
  },
  bulkGo: () => { const rows = S.bulk.rows.filter(r => r.name); ask(rows.length + '개 품목을 등록할까요?', '위치 코드와 수량이 있는 줄은 그 위치에 입고 기록까지 함께 남깁니다.', 'bulkGo', { rows, ok: '등록' }); },

  fakeOff: (d, el) => { S.fakeOffline = el.checked; setTimeout(render, 0); },
  switchRole: () => openSheet('switchRole'),
  demoReset: () => ask('체험판을 처음 상태로 돌릴까요?', '이 기기에서 해 본 입출고·업로드가 모두 지워지고 예시 데이터가 다시 채워집니다.', 'demoReset', { ok: '처음으로', danger: true })
});
const descFolders = id => { const out = [id]; for (let i = 0; i < out.length; i++) (S.ix.folderKids.get(out[i]) || []).forEach(k => out.push(k.id)); return { f: out.length - 1, d: out.reduce((a, f) => a + (S.ix.docsIn.get(f) || []).length, 0) }; };

/* 폼 제출 */
Object.assign(ACT, {
  login: async (ds, f) => {
    S.busy = true; S.authErr = ''; render();
    try { S.user = await S.api.login(f.emp.value, f.pw.value); S.busy = false; if (S.user.status === 'active') await afterLogin(); else render(); }
    catch (e) { S.busy = false; S.authErr = e.message; render(); }
  },
  signup: async (ds, f) => {
    if (f.elements.namedItem('pw').value !== f.elements.namedItem('pw2').value) { S.authErr = '비밀번호 확인이 맞지 않습니다.'; return render(); }
    const g = k => f.elements.namedItem(k).value;
    const vals = { emp_no: g('emp'), name: g('name'), phone: g('phone'), pw: g('pw') };
    S.busy = true; S.authErr = ''; render();
    try { S.user = await S.api.signup(vals); S.busy = false; render(); }
    catch (e) { S.busy = false; S.authErr = e.message; render(); ['emp', 'name', 'phone'].forEach(k => { const el = document.querySelector(`[name=${k}]`); if (el) el.value = vals[k === 'emp' ? 'emp_no' : k]; }); }
  },
  comment: async (ds, f) => { const body = f.body.value; if (!body.trim()) return; const ok = await run(() => S.api.addComment(ds.type, ds.id, body), '댓글을 남겼습니다', { reload: false }); if (ok) { const el = document.getElementById('cmt-' + ds.id); if (el) el.value = ''; } },
  changePw: async (ds, f) => { const ok = await run(() => S.api.changePassword(f.old.value, f.nw.value), '비밀번호를 바꿨습니다', { reload: false }); if (ok) f.reset(); },
  codeGo: (ds, f) => { const l = findLoc(f.code.value); if (l) ACT.loc({ id: l.id }); else toast('그 코드의 위치가 없습니다. 라벨에 적힌 코드를 확인하세요.', true); }
});

async function afterLogin() {
  S.authErr = ''; S.stack = [{ tab: 'items', view: 'browse', node: null }]; S.tab = 'items'; S.lastTab = {};
  try { await loadCache(); } catch (e) { const c = store.get('gaya-cache', null); if (c) { S.cache = c; S.ix = buildIndex(c); } else { toast(e.message, true); } }
  S.cache.recentSites = [];
  try { S.cache.recentSites = (await S.api.txList({ limit: 80 })).map(t => t.site).filter(Boolean); } catch {}
  const deep = consumeDeepLink();
  render(); onEnterRoute();
  if (deep) ACT.loc({ id: deep.id });
}
function findLoc(code) { code = String(code || '').trim().toUpperCase(); if (!code) return null; return S.cache.locations.find(l => (l.code || '').toUpperCase() === code || l.id === code) || null; }
function consumeDeepLink() {
  let code = null; try { code = new URLSearchParams(location.search).get('loc'); } catch {}
  if (!code) return null; try { history.replaceState(null, '', location.pathname); } catch {}
  return findLoc(code);
}

/* 파일 올리기 */
async function uploadFiles(files) {
  if (!files.length) return; const fid = route().folder;
  if (!fid) return toast('폴더를 먼저 여세요.', true);
  if (!online()) return toast('오프라인이라 올릴 수 없습니다. 연결되면 다시 해 주세요.', true);
  let ok = 0; let lastTarget = null;
  for (let i = 0; i < files.length; i++) {
    S.toast = { msg: `올리는 중 ${i + 1}/${files.length} · ${files[i].name}` }; render();
    try { const r = await S.api.upload(fid, files[i]); ok++; lastTarget = r.folder_id; } catch (e) { toast(files[i].name + ': ' + e.message, true); await sleep(1500); }
  }
  await loadCache();
  const moved = lastTarget && lastTarget !== fid;
  toast(ok + '개 올렸습니다' + (moved ? ' · ' + folderPathText(lastTarget) + ' 폴더로 정리됨' : ''));
}
async function pickPhoto(file) {
  if (!file) return; const t = S.photoTarget; if (!t) return;
  try {
    const blob = await shrinkImage(file, 900, .78);
    const url = S.api.putPhoto ? await S.api.putPhoto(blob) : await blobToDataURL(blob);
    if (t.type === 'sheet' && S.sheet) { S.sheet.d.photo = url; render(); }
    else if (t.type === 'item') run(() => S.api.saveItem({ id: t.id, photo: url }), '사진을 저장했습니다');
  } catch (e) { toast(e.message, true); }
}

/* ───────── QR 스캔 ───────── */
let scanStream = null, scanLoop = null;
async function startScan() {
  const msg = t => { const m = $('#scanmsg'); if (m) m.textContent = t; };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return msg('이 브라우저는 카메라를 쓸 수 없습니다. 코드를 직접 입력하세요.');
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch { return msg(DEMO ? '체험판 화면에서는 카메라를 쓸 수 없습니다. 아래에서 라벨을 골라 보세요.' : '카메라 권한이 필요합니다. 주소창 옆 자물쇠에서 카메라를 허용하세요.'); }
  const v = $('#scanvid'); if (!v || route().view !== 'scan') return stopScan();
  v.srcObject = scanStream; v.hidden = false; await v.play().catch(() => {}); msg('QR 라벨을 네모 안에 맞추세요');
  const det = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
  const cv = document.createElement('canvas'); const cx = cv.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (!scanStream) return;
    const vid = $('#scanvid'); if (!vid || route().view !== 'scan') return stopScan();
    if (!vid.srcObject) { vid.srcObject = scanStream; vid.hidden = false; vid.play().catch(() => {}); }
    let text = null;
    try {
      if (det) { const r = await det.detect(vid); if (r[0]) text = r[0].rawValue; }
      else if (window.jsQR && vid.videoWidth) { cv.width = vid.videoWidth; cv.height = vid.videoHeight; cx.drawImage(vid, 0, 0); const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height); if (r) text = r.data; }
    } catch {}
    if (text) { let code = text; try { code = new URL(text).searchParams.get('loc') || text; } catch {} const l = findLoc(code); if (l) { stopScan(); if (navigator.vibrate) navigator.vibrate(60); ACT.loc({ id: l.id }); return; } msg('앱에 없는 라벨입니다: ' + code); }
    scanLoop = setTimeout(tick, 220);
  };
  tick();
}
function stopScan() { clearTimeout(scanLoop); if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; } }

/* ───────── 시작 ───────── */
async function boot() {
  S.api = DEMO ? makeDemoAPI() : makeLiveAPI();
  try { S.user = await S.api.session(); }
  catch (e) {
    // 서버에 닿지 않음: 마지막으로 받아 둔 내용으로 조회만 가능하게 연다
    const u = store.get('gaya-user', null), c = store.get('gaya-cache', null);
    if (u && c) { S.user = u; S.cache = c; S.ix = buildIndex(c); render(); if (!online()) return; }
    S.serverDown = online();
  }
  if (S.user && S.user.status === 'active') { store.set('gaya-user', S.user); await afterLogin(); }
  else render();
  if (!DEMO) setInterval(() => { if (!document.hidden && S.user && online() && !S.sheet) refresh(); }, 30000);
}
boot();
