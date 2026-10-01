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
const APP_VER = '8bbb1bbd';

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
/* 화면 모드: 자동(휴대폰 설정을 따름) / 밝게 / 어둡게 — 이 기기에만 저장하고, 첫 화면이 그려지기 전에 적용한다 */
const THEME_KEY = 'gaya-theme';
const THEME_BAR = { light: '#13265C', dark: '#0F1C3D' };
function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    if (!m.hasAttribute('data-orig')) m.setAttribute('data-orig', m.getAttribute('content') || '');
    m.setAttribute('content', THEME_BAR[t] || m.getAttribute('data-orig'));
  });
}
const themeNow = () => { const t = store.get(THEME_KEY, 'auto'); return t === 'light' || t === 'dark' ? t : 'auto'; };
if (!DEMO || store.get(THEME_KEY, null)) applyTheme(themeNow());
/* 글자 크기: 보통 / 크게 (화면 전체를 한 단계 키운다) */
/* 알림 창 켜기·끄기 (이 기기에만 저장). done: 저장 완료 알림, undo: 되돌리기 버튼, install: 홈 화면 추가 안내 상자 */
const PREF_KEY = 'gaya-pref';
const PREF_DEF = { done: true, undo: true, install: true };
const pref = k => { const p = store.get(PREF_KEY, {}) || {}; return k in p ? !!p[k] : PREF_DEF[k]; };
const setPref = (k, v) => { const p = store.get(PREF_KEY, {}) || {}; p[k] = !!v; store.set(PREF_KEY, p); };
const SIZE_KEY = 'gaya-size';
const sizeNow = () => store.get(SIZE_KEY, 'md') === 'lg' ? 'lg' : 'md';
function applySize(v) { if (v === 'lg') document.documentElement.setAttribute('data-size', 'lg'); else document.documentElement.removeAttribute('data-size'); }
applySize(sizeNow());
/* 휴대폰 종류·설치 상태 */
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
/* 파일 내려받기 (엑셀에서 바로 열리는 CSV: 한글이 깨지지 않게 BOM 을 붙인다) */
const csvCell = v => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
function downloadCSV(name, rows) {
  const text = '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
const pad = n => String(n).padStart(2, '0');
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

/* ───────── 한글 검색: 초성(ㄷㅇㄹㄹ → 도어 롤러), 띄어쓰기 무시, 여러 낱말은 모두 포함 ───────── */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const choOf = c => { const k = c.charCodeAt(0) - 0xAC00; return k >= 0 && k < 11172 ? CHO[Math.floor(k / 588)] : c; };
function kmatch(text, q) {
  text = String(text || '').toLowerCase(); q = String(q || '').toLowerCase();
  if (!q) return true;
  if (!/[ㄱ-ㅎ]/.test(q)) return text.includes(q);
  const T = [...text], Q = [...q];
  outer: for (let i = 0; i + Q.length <= T.length; i++) {
    for (let j = 0; j < Q.length; j++) { const t = T[i + j], c = Q[j]; if (!(t === c || (/[ㄱ-ㅎ]/.test(c) && choOf(t) === c))) continue outer; }
    return true;
  }
  return false;
}
function smatch(text, q) {
  q = String(q || '').trim(); if (!q) return true;
  const words = q.split(/\s+/);
  if (words.every(w => kmatch(text, w))) return true;
  const squash = x => String(x).replace(/[\s·\-_/().,ØøΦφ×*]+/g, ''); // 띄어쓰기·기호 무시 (롤러62 → 롤러 Ø62)
  const sq = squash(q); return !!sq && kmatch(squash(text), sq);
}

/* ───────── 현장: 「현장 이름 + 동 + 호기」 칸을 한 줄(예: 한빛아파트 103동 2호기)로 저장하고, 되읽을 때는 다시 나눈다 ───────── */
const siteText = d => { const n = String(d.site || '').trim(), dg = String(d.dong || '').trim().replace(/\s*동$/, ''), ho = String(d.ho || '').trim().replace(/\s*호기?$/, ''); return [n, dg && dg + '동', ho && ho + '호기'].filter(Boolean).join(' '); };
function parseSite(s) {
  s = String(s || '').trim();
  const m = s.match(/^(.*?)(?:(?:^|\s+)([0-9A-Za-z][0-9A-Za-z-]*|[가-힣])동)?(?:(?:^|\s+)([0-9A-Za-z-]+)호기)?$/);
  return m ? { name: m[1].trim(), dong: m[2] || '', ho: m[3] || '' } : { name: s, dong: '', ho: '' };
}
const siteHo = p => [p.dong && p.dong + '동', p.ho && p.ho + '호기'].filter(Boolean).join(' ');
/* 서버 시각 문자열을 날짜로 — 아이폰 사파리는 "2026-10-01 03:00:00.123456+00" 같은 형식을 못 읽는다 */
function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v !== 'string') return new Date(v);
  let s = v.trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i);
  if (m) {
    const frac = m[3] ? (m[3] + '000').slice(0, 4) : '';
    let tz = m[4] || 'Z';
    if (/^[+-]\d{2}$/.test(tz)) tz += ':00';
    else if (/^[+-]\d{4}$/.test(tz)) tz = tz.slice(0, 3) + ':' + tz.slice(3);
    s = m[1] + 'T' + m[2] + frac + tz.toUpperCase();
  }
  const d = new Date(s);
  return isNaN(d) ? new Date(v) : d;
}
function fmtWhen(iso) {
  if (!iso) return '';
  const d = toDate(iso), now = new Date();
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
function fmtDate(iso) { const d = toDate(iso); return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.'; }
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
  return ['etc', esc(ext.slice(0, 4).toUpperCase()) || 'FILE'];
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
  dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
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
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  starOn: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19h14"/>',
  textsize: '<path d="M3 19 8 6l5 13M4.8 14.5h6.4M14.5 19l3.3-8.5 3.2 8.5M15.6 16.2h4.4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  iosShare: '<path d="M12 3.5v11M8.5 7 12 3.5 15.5 7"/><path d="M8 10H6v10h12V10h-2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4l2.8 1.8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  mark: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M12 3v18"/><path d="m8 9.5 1.8-2 1.8 2M16 14.5l-1.8 2-1.8-2"/>'
};
/* 가야엘리베이터 심볼 (거북 등 방패 + 육각 G) — 사옥 간판을 보고 다시 그린 것. 원본 파일을 받으면 바꿔 넣는다 */
let LOGO_N = 0;
function logo(cls = 'logo', outline = false) {
  const n = ++LOGO_N, sh = 'M50 5L87.5 17.5L90 31L83.5 81.5L50 117L16.5 81.5L10 31L12.5 17.5Z';
  return `<svg class="${cls}" viewBox="0 0 100 122" aria-hidden="true"><defs><linearGradient id="lg${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5287EC"/><stop offset="1" stop-color="#1C3A96"/></linearGradient><clipPath id="lc${n}"><path d="${sh}"/></clipPath></defs><path d="${sh}" fill="url(#lg${n})" stroke="url(#lg${n})" stroke-width="3" stroke-linejoin="round"/><g clip-path="url(#lc${n})" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"><path d="M50 34.1V0M32 44.8L5.6 28.2M68 44.8L94.4 28.2M32 66.2L11.9 86.1M68 66.2L88.1 86.1M50 76.9V122"/><path d="M68 44.8L50 34.1L32 44.8V66.2L50 76.9L68 66.2V58.7M60.5 58.7H75.5"/></g>${outline ? `<path d="${sh}" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/>` : ''}</svg>`;
}
const isNet = e => !!e && (e.net || /Failed to fetch|NetworkError|Load failed|network|timeout|연결이 끊|인터넷/i.test(e.message || ''));
const NET_MSG = '인터넷 연결이 끊겼거나 서버에 닿지 않습니다. 연결을 확인하고 다시 시도하세요.';
const netErr = () => Object.assign(new Error(NET_MSG), { net: true });
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { net: true })), ms))]);
const isInt = (v, min = 0) => /^\s*\d+\s*$/.test(String(v ?? '')) && +v >= min;
const ic = (n, cls = '') =>`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

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
      return obj && obj.user_id === u.id && (Date.now() - toDate(obj.created_at)) < 7 * 864e5;
    case 'delComment': return adm || (obj && obj.user_id === u.id);
    case 'setDev': return u.role === 'dev';
    default: return adm; // item, location, category, adjust, folderAdmin, docAdmin, users, audit, trash, status
  }
}

/* ───────── 체험판 데이터 계층 ─────────
   실서버(Supabase)용 계층과 같은 이름·같은 동작의 함수를 제공한다. 데이터는 이 기기에만 저장된다. */
/* 체험판 예시 파일: 캔버스에 그린 쪽 그림을 JPEG 로 만들어 PDF 로 묶는다 (실제 앱에서는 올린 파일 그대로) */
async function demoSample(d, kind) {
  const page = (no, total) => new Promise(res => {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#13265C'; g.fillRect(0, 0, c.width, 150);
    g.fillStyle = '#fff'; g.font = 'bold 46px sans-serif'; g.fillText('가야엘리베이터 · 체험판 예시 파일', 70, 95);
    g.fillStyle = '#0E1A33'; g.font = 'bold 54px sans-serif'; g.fillText(d.name.replace(/\.[^.]+$/, ''), 70, 280);
    g.font = '34px sans-serif'; g.fillStyle = '#5A6783'; g.fillText(no + ' / ' + total + ' 쪽 · 전파가 없어도 폰에 저장된 이 파일이 열립니다', 70, 340);
    g.strokeStyle = '#2453C6'; g.lineWidth = 4;
    for (let i = 0; i < 6; i++) { const y = 440 + i * 190; g.strokeRect(70, y, 1100, 150); g.fillStyle = '#E3EBFB'; g.fillRect(74, y + 4, 300, 142); g.fillStyle = '#0E1A33'; g.font = 'bold 36px sans-serif'; g.fillText((no - 1) * 6 + i + 1 + '. 항목', 100, y + 88); g.font = '32px sans-serif'; g.fillStyle = '#5A6783'; g.fillText((d.text || '점검 기준 · 결선 · 에러코드').split(' ').slice(0, 4).join(' · '), 410, y + 88); }
    c.toBlob(b => b.arrayBuffer().then(buf => res({ bytes: new Uint8Array(buf), w: c.width, h: c.height })), 'image/jpeg', .72);
  });
  if (kind === 'img') { const p = await page(1, 1); return new Blob([p.bytes], { type: 'image/jpeg' }); }
  const pages = [await page(1, 2), await page(2, 2)];
  const enc = new TextEncoder(); const parts = []; let len = 0; const offs = [];
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, f) => { offs[n] = len; push(n + ' 0 obj\n'); f(); push('\nendobj\n'); };
  push('%PDF-1.4\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] >>'));
  pages.forEach((j, i) => {
    const pg = 3 + i * 3, im = pg + 1, ct = pg + 2, cs = 'q 595 0 0 842 0 0 cm /Im' + i + ' Do Q';
    obj(pg, () => push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im' + i + ' ' + im + ' 0 R >> >> /Contents ' + ct + ' 0 R >>'));
    obj(im, () => { push('<< /Type /XObject /Subtype /Image /Width ' + j.w + ' /Height ' + j.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + j.bytes.length + ' >>\nstream\n'); push(j.bytes); push('\nendstream'); });
    obj(ct, () => push('<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream'));
  });
  const xref = len, total = 3 + pages.length * 3;
  push('xref\n0 ' + total + '\n0000000000 65535 f \n' + offs.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new Blob(parts, { type: 'application/pdf' });
}

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
    async whoami() { const u = me(); return u ? clone(u) : null; },
    async txToday() { const t = new Date(); t.setHours(0, 0, 0, 0); return D.tx.filter(x => ['in', 'out', 'move'].includes(x.type) && new Date(x.created_at) >= t).length; },
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
    async txList({ item_id, location_id, user_id, limit = 50 } = {}) {
      await tick();
      return clone(D.tx.filter(t => (!item_id || t.item_id === item_id) && (!user_id || t.user_id === user_id) && (!location_id || t.from_loc === location_id || t.to_loc === location_id)).slice(0, limit));
    },
    async txRange({ from, to }) { await tick(); return clone(D.tx.filter(t => t.created_at >= from && t.created_at < to)); },

    /* 입출고 — 서버에서는 한 번의 트랜잭션 함수로 처리된다 */
    async stockIn({ item_id, location_id, qty, note, op_id }) {
      await tick(); const u = need('stock');
      if (dupOp(op_id)) return; qty = +qty;
      if (!(qty > 0)) fail('수량을 1 이상으로 입력하세요.');
      if (!location_id) fail('넣을 위치를 고르세요.');
      stockRow(item_id, location_id).qty += qty;
      const it = byId(D.items, item_id);
      const tid = uid('t'); D.tx.unshift({ id: tid, op_id, type: 'in', item_id, from_loc: null, to_loc: location_id, qty, site: '', note: note || '', user_id: u.id, created_at: now() });
      log('입고', 'item', item_id, itemLabel(it) + ' ' + qty + it.unit + ' → ' + locPath(location_id));
      save(); return tid;
    },
    async stockOut({ item_id, location_id, qty, site, note, op_id }) {
      await tick(); const u = need('stock');
      if (dupOp(op_id)) return; qty = +qty;
      if (!(qty > 0)) fail('수량을 1 이상으로 입력하세요.');
      const r = stockRow(item_id, location_id);
      if (r.qty < qty) fail('이 위치에는 ' + r.qty + '개밖에 없습니다. 수량이나 위치를 확인하세요.');
      const before = totalOf(item_id); r.qty -= qty;
      const it = byId(D.items, item_id);
      const tid = uid('t'); D.tx.unshift({ id: tid, op_id, type: 'out', item_id, from_loc: location_id, to_loc: null, qty, site: site || '', note: note || '', user_id: u.id, created_at: now() });
      log('출고', 'item', item_id, itemLabel(it) + ' ' + qty + it.unit + ' ← ' + locPath(location_id) + (site ? ' / ' + site : ''));
      lowCheck(item_id, before); save(); return tid;
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
      const tid = uid('t'); D.tx.unshift({ id: tid, op_id, type: 'move', item_id, from_loc: from, to_loc: to, qty, site: '', note: note || '', user_id: u.id, created_at: now() });
      log('이동', 'item', item_id, itemLabel(it) + ' ' + qty + it.unit + ' ' + locPath(from) + ' → ' + locPath(to));
      save(); return tid;
    },
    async stockCancel({ tx_id, op_id }) {
      await tick(); const u = me();
      if (dupOp(op_id)) return;
      const t = byId(D.tx, tx_id);
      if (!t) fail('기록을 찾지 못했습니다.');
      if (!can(u, 'cancel', t)) fail('본인이 7일 안에 한 기록만 취소할 수 있습니다. 그 밖에는 관리자에게 요청하세요.');
      if (t.canceled_by) fail('이미 취소된 기록입니다.');
      if (!['in', 'out', 'move'].includes(t.type)) fail('이 기록은 취소할 수 없습니다.');
      if (t.type !== 'in') { const fl = byId(D.locations, t.from_loc); if (!fl || fl.deleted_at) fail('원래 위치(' + (fl ? fl.name : '?') + ')가 지워져 되돌릴 수 없습니다. 「수량 정정」으로 맞춰 주세요.'); }
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

    /* 여러 개 한 번에 꺼내기: 하나라도 모자라면 아무것도 꺼내지 않는다 */
    async stockOutMany({ rows, site, note, op_id }) {
      await tick(); const u = need('stock');
      if (!rows || !rows.length) fail('꺼낼 자재를 담으세요.');
      if (rows.length > 50) fail('한 번에 50가지까지 꺼낼 수 있습니다.');
      if (op_id && D.ops && D.ops[op_id]) return clone(D.ops[op_id]);
      const want = new Map();
      rows.forEach(r => { const k = r.item_id + '|' + r.location_id; want.set(k, (want.get(k) || 0) + (+r.qty || 0)); });
      rows.forEach(r => {
        const it = byId(D.items, r.item_id); if (!it || it.deleted_at) fail('지워졌거나 없는 품목이 들어 있습니다. 화면을 새로 고친 뒤 다시 하세요.');
        if (!isInt(r.qty, 1)) fail(itemLabel(it) + ': 수량을 1 이상으로 입력하세요.');
        const have = (D.stock.find(x => x.item_id === r.item_id && x.location_id === r.location_id) || {}).qty || 0;
        if (have < want.get(r.item_id + '|' + r.location_id)) fail(itemLabel(it) + ': 이 위치에는 ' + have + '개밖에 없습니다. 수량이나 위치를 확인하세요.');
      });
      const ids = rows.map(r => {
        const it = byId(D.items, r.item_id); const before = totalOf(r.item_id); stockRow(r.item_id, r.location_id).qty -= +r.qty;
        const tid = uid('t'); D.tx.unshift({ id: tid, op_id: null, type: 'out', item_id: r.item_id, from_loc: r.location_id, to_loc: null, qty: +r.qty, site: site || '', note: note || '', user_id: u.id, created_at: now() });
        log('출고', 'item', r.item_id, itemLabel(it) + ' ' + r.qty + it.unit + ' ← ' + locPath(r.location_id) + (site ? ' / ' + site : ''));
        lowCheck(r.item_id, before); return tid;
      });
      if (op_id) { D.ops = D.ops || {}; D.ops[op_id] = ids; }
      save(); return ids;
    },
    /* 여러 개 한 번에 입고: 하나라도 안 되면 아무것도 넣지 않는다 */
    async stockInMany({ rows, note, op_id }) {
      await tick(); const u = need('stock');
      if (!rows || !rows.length) fail('입고할 자재가 없습니다.');
      if (op_id && D.ops && D.ops[op_id]) return clone(D.ops[op_id]);
      rows.forEach(r => { const it = byId(D.items, r.item_id); if (!it || it.deleted_at) fail('지워졌거나 없는 품목이 들어 있습니다. 화면을 새로 고친 뒤 다시 하세요.');
        if (!isInt(r.qty, 1)) fail(itemLabel(it) + ': 수량을 1 이상으로 입력하세요.');
        const l = byId(D.locations, r.location_id); if (!l || l.deleted_at) fail(itemLabel(it) + ': 넣을 위치를 고르세요.'); });
      const ids = rows.map(r => {
        const it = byId(D.items, r.item_id); stockRow(r.item_id, r.location_id).qty += +r.qty;
        const tid = uid('t'); D.tx.unshift({ id: tid, op_id: null, type: 'in', item_id: r.item_id, from_loc: null, to_loc: r.location_id, qty: +r.qty, site: '', note: note || '', user_id: u.id, created_at: now() });
        log('입고', 'item', r.item_id, itemLabel(it) + ' ' + r.qty + it.unit + ' → ' + locPath(r.location_id)); return tid;
      });
      if (op_id) { D.ops = D.ops || {}; D.ops[op_id] = ids; }
      save(); return ids;
    },
    async stockCancelMany(ids, op) {
      await tick(); const u = me();
      if (op && D.ops && D.ops[op] != null) return D.ops[op];
      (ids || []).forEach(id => { const t = byId(D.tx, id); const it = t && byId(D.items, t.item_id);
        if (!t) fail('기록을 찾지 못했습니다.'); if (t.canceled_by) fail(itemLabel(it) + ': 이미 취소된 기록입니다.');
        if (!can(u, 'cancel', t)) fail(itemLabel(it) + ': 본인이 7일 안에 한 기록만 취소할 수 있습니다.'); });
      for (const id of ids) await api.stockCancel({ tx_id: id });
      if (op) { D.ops = D.ops || {}; D.ops[op] = ids.length; save(); }
      return ids.length;
    },
    /* 재고 실사: 한 위치의 품목 수량을 한꺼번에 맞춘다 (바뀐 품목만 정정 기록) */
    async stockCount({ location_id, rows, reason, op_id }) {
      await tick(); const u = need('adjust');
      if (op_id && D.ops && D.ops[op_id] != null) return D.ops[op_id];
      const l = byId(D.locations, location_id); if (!l || l.deleted_at) fail('위치를 찾지 못했습니다. 화면을 새로 고친 뒤 다시 하세요.');
      rows.forEach(r => { const it = byId(D.items, r.item_id); if (!it || it.deleted_at) fail('지워졌거나 없는 품목이 들어 있습니다. 화면을 새로 고친 뒤 다시 하세요.'); if (!isInt(r.qty)) fail(itemLabel(it) + ': 수량을 0 이상의 정수로 입력하세요.'); });
      let n = 0; const why = String(reason || '').trim() || '실사';
      rows.forEach(r => {
        const row = stockRow(r.item_id, location_id); const before = row.qty, q = +r.qty; if (before === q) return;
        const it = byId(D.items, r.item_id); const tb = totalOf(r.item_id); row.qty = q;
        D.tx.unshift({ id: uid('t'), op_id: null, type: 'adjust', item_id: r.item_id, from_loc: location_id, to_loc: location_id, qty: q - before, site: '', note: why, user_id: u.id, created_at: now(), before, after: q });
        log('수량 정정', 'item', r.item_id, itemLabel(it) + ' @' + locPath(location_id) + ' ' + before + ' → ' + q + ' (사유: ' + why + ')');
        lowCheck(r.item_id, tb); n++;
      });
      if (n) log('재고 실사', 'location', location_id, locPath(location_id) + ' · ' + n + '개 품목 수량 맞춤');
      if (op_id) { D.ops = D.ops || {}; D.ops[op_id] = n; }
      save(); return n;
    },
    async itemsMinSet(rows, op) {
      await tick(); need('item');
      if (op && D.ops && D.ops[op] != null) return D.ops[op];
      let n = 0; const names = [];
      rows.forEach(r => { const it = byId(D.items, r.id); if (!isInt(r.min_qty)) fail('최소 재고는 0 이상의 정수여야 합니다.'); if (it && !it.deleted_at && it.min_qty !== +r.min_qty) { it.min_qty = +r.min_qty; it.updated_at = now(); n++; if (names.length < 5) names.push(itemLabel(it) + ' ' + it.min_qty); } });
      if (n) log('최소 재고 조정', 'item', null, n + '개 품목: ' + names.join(', ') + (n > 5 ? ' 외' : ''));
      if (op) { D.ops = D.ops || {}; D.ops[op] = n; }
      save(); return n;
    },
    /* 현장별 사용 이력 */
    async siteTx(since) { await tick(); return clone(D.tx.filter(t => t.site && t.created_at >= since)); },
    async siteDetail(name) { await tick(); return clone(D.tx.filter(t => t.site && parseSite(t.site).name === name)); },
    /* 위치 한 번에 만들기: 이미 있는 코드는 그대로 두고 안쪽만 채운다 */
    async locationsBulk(parent, rows, op) {
      await tick(); need('location');
      if (op && D.ops && D.ops[op] != null) return D.ops[op];
      if (!rows || !rows.length) fail('만들 위치가 없습니다.');
      const codes = []; (function walk(rs) { (rs || []).forEach(r => { const c = String(r.code || '').trim().toUpperCase(); if (c) codes.push(c); walk(r.kids); }); })(rows);
      const dup = codes.find((c, i) => codes.indexOf(c) !== i); if (dup) fail('같은 라벨 코드가 두 번 들어 있습니다: ' + dup);
      const par0 = parent ? byId(D.locations, parent) : null; if (parent && (!par0 || par0.deleted_at)) fail('위치를 찾지 못했습니다. 화면을 새로 고친 뒤 다시 하세요.');
      const live = () => D.locations.filter(l => !l.deleted_at);
      const made = []; let n = 0;
      try {
        (function walk(pid, rs, depth) {
          (rs || []).forEach(r => {
            const name = String(r.name || '').trim(); if (!name) fail('이름이 빈 위치가 있습니다.');
            if (depth > 3) fail('위치는 구역 › 캐비넷·선반 › 칸, 세 단계까지만 만들 수 있습니다.');
            const c = String(r.code || '').trim().toUpperCase();
            let ex = c ? live().find(l => (l.code || '').toUpperCase() === c) : live().find(l => (l.parent_id || null) === (pid || null) && l.name === name);
            if (ex && (ex.parent_id || null) !== (pid || null)) fail('이미 다른 곳(' + locPath(ex.id) + ')에서 쓰는 라벨 코드입니다: ' + c);
            if (!ex) { const p = byId(D.locations, pid); ex = { id: uid('l'), parent_id: pid || null, name, code: c, kind: !p ? 'zone' : p.parent_id ? 'slot' : 'unit', photo: '', sort: D.locations.length }; D.locations.push(ex); made.push(ex); n++; }
            walk(ex.id, r.kids, depth + 1);
          });
        })(parent || null, rows, !par0 ? 1 : par0.kind === 'zone' ? 2 : par0.kind === 'unit' ? 3 : 4);
      } catch (e) { D.locations = D.locations.filter(l => !made.includes(l)); throw e; }
      log('위치 한 번에 추가', 'location', parent || null, (parent ? locPath(parent) : '맨 위') + ' · ' + n + '곳 추가');
      if (op) { D.ops = D.ops || {}; D.ops[op] = n; }
      save(); return n;
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
    async bulkItems(rows, op) {
      await tick(); need('item'); let n = 0;
      if (op && D.ops && D.ops[op] != null) return D.ops[op];
      rows.forEach(r => {
        const it = { id: uid('i'), name: r.name, spec: r.spec || '', maker: r.maker || '', models: r.models || '', category_id: r.category_id || null, unit: r.unit || '개', min_qty: +r.min_qty || 0, photo: '', memo: r.memo || '', created_at: now(), updated_at: now() };
        D.items.push(it); n++;
        if (r.location_id && +r.qty > 0) {
          stockRow(it.id, r.location_id).qty += +r.qty;
          D.tx.unshift({ id: uid('t'), op_id: null, type: 'in', item_id: it.id, from_loc: null, to_loc: r.location_id, qty: +r.qty, site: '', note: '대량 등록 초기 수량', user_id: meId, created_at: now() });
        }
      });
      log('품목 대량 등록', 'item', null, n + '개 품목 등록'); if (op) { D.ops = D.ops || {}; D.ops[op] = n; } save(); return n;
    },
    async saveLocation(x) {
      await tick(); need('location');
      if (!String(x.name || '').trim()) fail('위치 이름을 입력하세요.');
      const code = String(x.code || '').trim().toUpperCase();
      if (code && D.locations.some(l => !l.deleted_at && (l.code || '').toUpperCase() === code && l.id !== x.id)) fail('같은 라벨 코드(' + code + ')가 이미 있습니다. 다른 코드를 정하세요.');
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
      if (/[\/\\]/.test(name)) fail('폴더 이름에 / 나 \\ 는 쓸 수 없습니다.');
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
    /* 폰에 저장할 파일 받기 — 체험판은 실제 파일이 없어 예시 파일을 만들어 준다 */
    async docFile(id, onProg) {
      const d = byId(D.docs, id); if (!d) fail('없는 자료입니다.');
      for (let i = 1; i <= 4; i++) { await sleep(150); if (onProg) onProg(i / 4); }
      if (d.dataurl) return (await fetch(d.dataurl)).blob();
      const k = fileKind(d.name, d.kind)[0];
      if (k === 'pdf' || k === 'img') return demoSample(d, k);
      return new Blob(['체험판 예시 파일: ' + d.name + '\n실제 앱에서는 올린 파일 그대로 받아집니다.'], { type: 'text/plain' });
    },

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
      const jamo = /[ㄱ-ㅎ]/.test(q);
      return clone({
        items: D.items.filter(i => !i.deleted_at && smatch([i.name, i.spec, i.maker, i.models, i.memo].join(' '), q)).map(i => i.id),
        docs: D.docs.filter(d => !d.deleted_at && (smatch(d.name, q) || (!jamo && d.text && smatch(d.text, q)))).map(d => ({ id: d.id, inside: !smatch(d.name, q) }))
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
      await tick(); const u = need('users'); const p = byId(D.profiles, id);
      if (p.role === 'dev' && !can(u, 'setDev')) fail('개발자 계정의 비밀번호는 개발자만 초기화할 수 있습니다.');
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
    if (NETRE.test(m)) return NET_MSG;
    if (/JWT expired|invalid JWT/i.test(m)) return '로그인이 만료되었습니다. 다시 로그인하세요.';
    if (/duplicate key.*locations|locations_code/i.test(m)) return '같은 라벨 코드를 쓰는 위치가 이미 있습니다. 그 위치의 코드를 먼저 바꾸세요.';
    if (/duplicate key/i.test(m)) return '같은 내용이 이미 있습니다.';
    if (/invalid input syntax for type (integer|bigint)/i.test(m)) return '숫자 칸에는 0 이상의 정수만 넣을 수 있습니다.';
    if (/violates check constraint/i.test(m)) return '수량이 맞지 않습니다. 0보다 작아질 수 없습니다.';
    return m.replace(/^.*?ERROR:\s*/, '');
  }
  const NETRE = /Failed to fetch|NetworkError|Load failed|network request failed|fetch failed/i;
  const E = e => { const m = (e && (e.message || e.error_description || e.msg)) || String(e); const x = new Error(errMsg(e)); if (NETRE.test(m) || (e && (e.status === 0 || e.name === 'AuthRetryableFetchError'))) x.net = true; return x; };
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
    let r;
    try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: session && session.access_token, action, ...payload }) }); }
    catch { if (!navigator.onLine) throw netErr(); throw new Error('자료 저장소(구글 드라이브)에 연결되지 않습니다. 잠시 뒤 다시 해 보고, 계속되면 관리자에게 알려 주세요.'); }
    const j = await r.json().catch(() => ({ ok: false, error: '자료 저장소 응답을 읽지 못했습니다. 잠시 뒤 다시 시도하세요.' }));
    if (!j.ok) throw new Error(/^알 수 없는 작업/.test(j.error || '') ? '자료 저장소가 아직 이 기능을 모릅니다(저장소 새 버전 배포 전). 개발자·관리자에게 알려 주세요.' : (j.error || '저장소 작업 실패'));
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
      progress(`큰 파일 올리는 중 ${Math.round(end / file.size * 100)}% · ${file.name}`);
      res = await drive('uploadChunk', { session: st.session, start, end, total: file.size, data: b64(await file.slice(start, end).arrayBuffer()) }, no);
    }
    progress(null);
    if (!res || !res.id) throw new Error('큰 파일 올리기를 마치지 못했습니다.');
    return { id: res.id, store: no };
  }

  return {
    demo: false,
    async session() {
      const { data: { session }, error } = await sb.auth.getSession();
      if (error) { const x = E(error); if (x.net) throw x; return null; } // 연결 문제면 「서버에 닿지 않음」, 로그인 만료면 다시 로그인
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
    async whoami() { // 30초마다: 계정이 중지·삭제되었는지, 권한이 바뀌었는지 확인 (연결 문제면 아무것도 바꾸지 않음)
      const { data: { session }, error } = await sb.auth.getSession();
      if (error || !session) return undefined;
      const p = await profile(session.user.id); if (p) me = p; return p || null;
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
    async txList({ item_id, location_id, user_id, limit = 50 } = {}) {
      let x = sb.from('tx').select('*').order('created_at', { ascending: false }).limit(limit);
      if (item_id) x = x.eq('item_id', item_id);
      if (user_id) x = x.eq('user_id', user_id);
      if (location_id) x = x.or(`from_loc.eq.${location_id},to_loc.eq.${location_id}`);
      return q(x);
    },
    stockOutMany: ({ rows, site, note, op_id }) => rpc('stock_out_many', { p_rows: rows, p_site: site || '', p_note: note || '', p_op: op_id || null }),
    stockInMany: ({ rows, note, op_id }) => rpc('stock_in_many', { p_rows: rows, p_note: note || '', p_op: op_id || null }),
    stockCancelMany: (ids, op) => rpc('stock_cancel_many', { p_txs: ids, p_op: op || null }),
    stockCount: ({ location_id, rows, reason, op_id }) => rpc('stock_count', { p_loc: location_id, p_rows: rows, p_reason: reason || '실사', p_op: op_id || null }),
    itemsMinSet: (rows, op) => rpc('items_min_set', { p_rows: rows, p_op: op || null }),
    locationsBulk: (parent, rows, op) => rpc('locations_bulk', { p_parent: parent || null, p_rows: rows, p_op: op || null }),
    siteTx: since => all('tx', 'id,type,item_id,qty,site,user_id,created_at,canceled_by', x => x.neq('site', '').gte('created_at', since).order('created_at', { ascending: false })),
    async siteDetail(name) {
      const pat = String(name).replace(/[\\%_]/g, m => '\\' + m) + '%';
      const rows = await all('tx', '*', x => x.ilike('site', pat).order('created_at', { ascending: false }));
      return rows.filter(t => parseSite(t.site).name === name);
    },
    txRange: ({ from, to }) => all('tx', '*', x => x.gte('created_at', from).lt('created_at', to).order('created_at', { ascending: false })),
    async txToday() {
      const t = new Date(); t.setHours(0, 0, 0, 0);
      const { count, error } = await sb.from('tx').select('id', { count: 'exact', head: true }).gte('created_at', t.toISOString()).in('type', ['in', 'out', 'move']);
      if (error) throw E(error); return count || 0;
    },
    stockIn: d => rpc('stock_in', { p_item: d.item_id, p_loc: d.location_id, p_qty: +d.qty, p_note: d.note || '', p_op: d.op_id }),
    stockOut: d => rpc('stock_out', { p_item: d.item_id, p_loc: d.location_id, p_qty: +d.qty, p_site: d.site || '', p_note: d.note || '', p_op: d.op_id }),
    stockMove: d => rpc('stock_move', { p_item: d.item_id, p_from: d.from, p_to: d.to, p_qty: +d.qty, p_note: d.note || '', p_op: d.op_id }),
    stockCancel: d => rpc('stock_cancel', { p_tx: d.tx_id, p_op: d.op_id }),
    stockAdjust: d => rpc('stock_adjust', { p_item: d.item_id, p_loc: d.location_id, p_qty: +d.qty, p_reason: d.reason || '', p_op: d.op_id }),

    saveItem: x => { const p = { ...x }; delete p.op_id; delete p.created_at; delete p.updated_at; delete p.deleted_at; return rpc('item_save', { p }); },
    deleteItem: id => rpc('item_delete', { p_id: id }),
    bulkItems: (rows, op) => rpc('items_bulk', { p_rows: rows, p_op: op || null }),
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
    /* 폰에 저장할 파일 받기: 저장소에서 6MB 씩 나눠 받는다 (등록된 자료만, 50MB 까지) */
    async docFile(id, onProg) {
      const d = S.ix.doc.get(id); if (!d || !d.drive_id) throw new Error('파일로 올린 자료만 받을 수 있습니다.');
      if (d.size > 50 * 1048576) throw new Error('50MB 가 넘는 파일은 폰에 저장할 수 없습니다. 드라이브에서 바로 보세요.');
      const CH = 6 * 1048576, parts = []; let start = 0, total = null, mime = d.mime || '';
      while (total === null || start < total) {
        const r = await drive('download', { id: d.drive_id, start, len: CH }, d.store_no);
        total = +r.total || 0; if (r.mime) mime = String(r.mime).split(';')[0];
        const bin = atob(r.data || ''); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        if (!u.length) break;
        parts.push(u); start += u.length; if (onProg) onProg(total ? Math.min(1, start / total) : 1);
      }
      return new Blob(parts, { type: mime || 'application/octet-stream' });
    },
    async trash() { return (await rpc('trash_list')).map(r => ({ ...r, where: r.where || '' })); },
    async restore(type, id) {
      const list = await rpc('trash_list'); const row = list.find(r => r.id === id);
      await rpc('trash_restore', { p_type: type, p_id: id });
      if (type === 'doc' && row && row.drive_id) drive('untrashFile', { id: row.drive_id }, row.store_no).catch(e => console.warn(e));
      if (type === 'folder') { await loadCache(); await driveAll('untrashPath', { path: pathNames(id) }); }
    },

    async search(qs) {
      qs = qs.trim().toLowerCase(); if (!qs) return { items: [], docs: [] };
      const items = S.cache.items.filter(i => smatch([i.name, i.spec, i.maker, i.models, i.memo].join(' '), qs)).map(i => i.id);
      const byName = S.cache.docs.filter(d => smatch(d.name, qs)).map(d => ({ id: d.id, inside: false }));
      let inside = [];
      if (qs.length >= 2 && !/[ㄱ-ㅎ]/.test(qs) && stores().length) {
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
const ROOTS = { items: { tab: 'items', view: 'browse', node: null }, docs: { tab: 'docs', view: 'browse', folder: null }, scan: { tab: 'scan', view: 'scan' }, alerts: { tab: 'alerts', view: 'list' }, more: { tab: 'more', view: 'menu' } };
const S = {
  user: null, api: null, cache: null, ix: null,
  tab: 'items', stack: [{ ...ROOTS.items }],
  itemsMode: store.get('gaya-mode', 'loc'), q: '', docsQ: '', logKind: '',
  sheet: null, toast: null, unread: 0,
  fakeOffline: false, authView: 'login', authErr: '', busy: false,
  lastTab: {}, searchRes: null, docSearchRes: null, recentSites: [], labelsOpen: false
};
const route = () => S.stack[S.stack.length - 1];
const online = () => navigator.onLine !== false && !S.fakeOffline;
const EMPTY_CACHE = () => ({ locations: [], categories: [], items: [], stock: [], people: [], folders: [], docs: [] });

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
const itemTitle = it => it ? it.name + (it.spec ? ' · ' + it.spec : '') : '(지워진 품목)';
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

/* ───────── 이동 ─────────
   휴대폰 「뒤로」 버튼: 앱 안에 늘 한 칸짜리 덫(trap) 기록을 두고, 눌리면
   시트 닫기 → 이전 화면 → 첫 탭 순서로 처리한 뒤 덫을 다시 깐다. 첫 화면에서 한 번 더 누르면 앱이 닫힌다. */
function ensureTrap() { try { if (!history.state || !history.state.gayaTrap) history.pushState({ gayaTrap: 1 }, ''); } catch {} }
window.addEventListener('popstate', () => {
  if (!S.user) return;
  if (S.sheet) { S.sheet = null; render(); ensureTrap(); return; }
  if (S.stack.length > 1) { back(); ensureTrap(); return; }
  if (S.tab !== 'items' || route().node) { goTab('items', true); ensureTrap(); return; }
  toast('뒤로 버튼을 한 번 더 누르면 앱이 닫힙니다.');
});
function nav(r, replace = false) {
  if (replace) S.stack[S.stack.length - 1] = r; else S.stack.push(r);
  S.tab = r.tab; ensureTrap();
  render(); window.scrollTo(0, 0);
  onEnterRoute();
}
function back() {
  if (S.sheet) { S.sheet = null; render(); return; }
  if (S.stack.length > 1) { S.stack.pop(); S.tab = route().tab; render(); onEnterRoute(); }
}
function resetStack(r) { S.stack = [r]; S.tab = r.tab; ensureTrap(); render(); window.scrollTo(0, 0); onEnterRoute(); }
function goTab(t, toRoot = false) {
  if (S.tab === t && (S.stack.length > 1 || toRoot)) { S.stack = [{ ...ROOTS[t] }]; }
  else if (S.tab !== t) { S.lastTab[S.tab] = S.stack; S.stack = S.lastTab[t] || [{ ...ROOTS[t] }]; }
  S.tab = t; S.q = ''; S.searchRes = null; stopScan(); ensureTrap();
  render(); window.scrollTo(0, 0); onEnterRoute();
}

/* 화면에 들어갈 때 필요한 추가 자료 (이력·댓글 등)를 받아 온다 */
const VIEWDATA = {};
async function onEnterRoute() {
  const r = route(); const key = JSON.stringify(r);
  if (r.view === 'scan') { startScan(); return; }
  if (r.tab === 'items' && r.view === 'browse' && S.q.trim() && !S.searchRes) searchItems(true);
  if (r.tab === 'docs' && r.view === 'browse' && S.docsQ.trim() && !S.docSearchRes) searchDocs(true);
  if (r.view === 'doc') rememberDoc(r.id);
  if (!online()) return; // 오프라인: 받아 둔 기본 자료만 보여 준다 (기록·댓글 칸에는 안내가 뜬다)
  try {
    if (r.view === 'item') { const [tx, cm] = await Promise.all([S.api.txList({ item_id: r.id }), S.api.comments('item', r.id)]); VIEWDATA[key] = { tx, cm }; }
    else if (r.tab === 'items' && r.view === 'browse' && !r.node) { const [tx, today, mine] = await Promise.all([S.api.txList({ limit: 6 }), S.api.txToday().catch(() => null), S.api.txList({ user_id: S.user.id, limit: 60 }).catch(() => [])]); VIEWDATA[key] = { tx, today, mine }; }
    else if (r.view === 'sites') { const y = new Date(); y.setFullYear(y.getFullYear() - 1); VIEWDATA[key] = { list: await S.api.siteTx(y.toISOString()) }; }
    else if (r.view === 'site') { VIEWDATA[key] = { list: await S.api.siteDetail(r.name) }; }
    else if (r.view === 'stats') { const [y, m] = r.month.split('-').map(Number); VIEWDATA[key] = statsData(await S.api.txRange({ from: new Date(y, m - 3, 1).toISOString(), to: new Date(y, m, 1).toISOString() }), r.month); }
    else if (r.view === 'history') { const [y, m] = r.month.split('-').map(Number); VIEWDATA[key] = { list: await S.api.txRange({ from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString() }) }; }
    else if (r.view === 'doc') { VIEWDATA[key] = { cm: await S.api.comments('doc', r.id), data: await S.api.docData(r.id) }; }
    else if (r.view === 'list') { VIEWDATA[key] = { list: await S.api.notifications() }; }
    else if (r.view === 'users') VIEWDATA[key] = { list: await S.api.users() };
    else if (r.view === 'log') VIEWDATA[key] = { list: await S.api.audit({ kind: S.logKind }) };
    else if (r.view === 'status') VIEWDATA[key] = { st: await S.api.status() };
    else if (r.view === 'trash') VIEWDATA[key] = { list: await S.api.trash() };
    else if (r.view === 'menu' && can(S.user, 'users')) VIEWDATA[key] = { st: await S.api.status(), users: await S.api.users() };
    else return;
    if (JSON.stringify(route()) === key) render();
  } catch (e) {
    if (!isNet(e)) return toast(e.message, true);
    VIEWDATA[key] = { ...(VIEWDATA[key] || {}), netErr: true }; if (JSON.stringify(route()) === key) render();
  }
}
const vd = () => VIEWDATA[JSON.stringify(route())] || {};
const loadingBox = (icon = 'list') => !online() ? empty('wifioff', '오프라인이라 불러오지 못했습니다.', '연결되면 자동으로 다시 보입니다.')
  : vd().netErr ? empty('wifioff', '서버에 닿지 않아 불러오지 못했습니다.', '잠시 뒤 자동으로 다시 시도합니다.') : empty(icon, '불러오는 중…');

/* ───────── 알림 띠 (화면 전체를 다시 그리지 않는다) ───────── */
let toastTimer;
function drawToast() {
  const t = $('#toast'); if (!t) return;
  const x = S.toast; if (!x) { t.innerHTML = ''; return; }
  const pos = S.sheet ? 'top' : $('.fab') || $('.cartbar') || $('.countbar') || $('.ordbar') ? 'up' : '';
  t.innerHTML = `<div class="toast ${x.err ? 'err' : ''} ${pos} ${x.act ? 'has-act' : ''}" role="status"><span>${esc(x.msg)}</span>${x.act ? `<button class="tact" data-act="toastAct">${esc(x.act.label)}</button>` : ''}</div>`;
}
/* 알림 띠. 빨간 알림(err)과 꼭 필요한 안내(must)는 늘 띄우고, 나머지는 더보기 › 알림 창 설정의 「저장 완료 알림」을 따른다 */
function toast(msg, err = false, act = null, must = false) {
  if (!err && !must && !act && !pref('done')) return;
  S.toast = { msg, err, act }; drawToast();
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { S.toast = null; drawToast(); }, act ? 8000 : err ? 4500 : Math.min(6000, Math.max(2600, String(msg).length * 70)));
}
const note = msg => toast(msg, false, null, true);
function progress(msg) { clearTimeout(toastTimer); S.toast = msg ? { msg, progress: true } : null; drawToast(); }

/* ───────── 저장 작업 실행기 ─────────
   · 오프라인이면 아예 막는다
   · 누르는 동안 버튼을 잠가 두 번 저장되지 않게 한다 (서버에도 op_id 로 중복 방지)
   · 저장이 실패하면 시트를 닫지 않고 입력한 내용을 그대로 둔다
   · 저장은 됐는데 새 목록을 못 받은 경우는 「저장됨」으로 처리한다 (다시 눌러 두 번 저장되는 일 방지) */
async function run(fn, okMsg, { keepSheet = false, reload = true } = {}) {
  if (!online()) { toast('오프라인이라 저장할 수 없습니다. 연결되면 다시 눌러 주세요.', true); return false; }
  if (S.busy) return false;
  S.busy = true; if (S.sheet) S.sheet.err = ''; render();
  let r;
  try { r = await fn(); }
  catch (e) {
    S.busy = false;
    const msg = isNet(e) ? '연결이 끊겨 저장하지 못했습니다. 입력한 내용은 그대로 있으니 연결되면 다시 누르세요.' : e.message;
    if (S.sheet) { S.sheet.err = msg; render(); } else { render(); toast(msg, true); }
    return false;
  }
  if (reload) { try { await loadCache(); } catch { /* 저장은 끝남. 목록은 다음 새로 고침 때 맞춰진다 */ } }
  if (!keepSheet) S.sheet = null;
  S.busy = false; render();
  if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
  onEnterRoute();
  return r ?? true;
}

/* ───────── 이벤트 연결 ───────── */
const ACT = {};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.dataset.write !== undefined && !online()) { e.preventDefault(); toast('오프라인이라 저장할 수 없습니다. 연결되면 다시 눌러 주세요.', true); return; }
  const f = ACT[el.dataset.act];
  if (!f) return;
  // 시트 바깥(어두운 곳)을 누른 경우만 처리한다. 시트 안의 체크박스·라벨은 원래 동작을 그대로 둔다
  if (el.dataset.act === 'scrim' && e.target !== el) return;
  if (el.tagName !== 'INPUT') e.preventDefault();
  f(el.dataset, el, e);
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.bind && S.sheet) { S.sheet.d[el.dataset.bind] = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset.live !== undefined) updateSheetPart(); }
  if (el.id === 'q-items') { S.q = el.value; searchItems(); }
  if (el.id === 'q-docs') { S.docsQ = el.value; searchDocs(); }
  if (el.id === 'bulk-in' && S.bulk) S.bulk.text = el.value;
  if (el.id === 'q-hist') { S.histQ = el.value; clearTimeout(hT); hT = setTimeout(updatePane, 120); }
  if (el.id === 'q-sites') { S.sitesQ = el.value; clearTimeout(hT); hT = setTimeout(updatePane, 120); }
  if (el.id === 'q-cnt') { S.cntQ = el.value; clearTimeout(hT); hT = setTimeout(() => { const b = $('#cnt-add'); if (b) b.innerHTML = countAddList(); }, 120); }
  if (el.id === 'q-ord') { S.ordQ = el.value; clearTimeout(hT); hT = setTimeout(() => { const b = $('#ord-add'); if (b) b.innerHTML = orderAddList(); }, 120); }
  if (el.dataset.cnt) { const loc = route().node; const c = countState(loc); c.vals[el.dataset.cnt] = el.value; countSaveLocal(); const row = el.closest('.crow'); if (row) { const cur = qtyAt(el.dataset.cnt, loc); const ch = isInt(el.value) && +el.value !== cur; row.classList.toggle('chg', ch); row.classList.toggle('bad', el.value.trim() !== '' && !isInt(el.value)); const t = row.querySelector('.was'); if (t) t.textContent = ch ? `기록 ${cur} → ${+el.value}` : `기록 ${cur}`; } updateCountBar(); }
});
let hT;
/* 자료 즐겨찾기 · 최근 본 자료 (이 기기에 저장) */
const favKey = () => 'gaya-fav-' + (S.user ? S.user.id : '');
const recentKey = () => 'gaya-recent-' + (S.user ? S.user.id : '');
const favs = () => new Set(store.get(favKey(), []));
const recentDocs = () => store.get(recentKey(), []);
function rememberDoc(id) { store.set(recentKey(), [id, ...recentDocs().filter(x => x !== id)].slice(0, 8)); }
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.bind && S.sheet && (el.tagName === 'SELECT' || el.type === 'checkbox')) { S.sheet.d[el.dataset.bind] = el.type === 'checkbox' ? el.checked : el.value; render(); }
  if (el.id === 'filepick') { const files = [...el.files]; el.value = ''; uploadFiles(files); }
  if (el.id === 'photopick') { const f = el.files[0]; el.value = ''; pickPhoto(f); }
});
document.addEventListener('toggle', e => { if (e.target.id === 'label-pick') S.labelsOpen = e.target.open; }, true);
document.addEventListener('submit', e => { e.preventDefault(); const f = ACT[e.target.dataset.submit]; if (f) f(e.target.dataset, e.target); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.sheet) { S.sheet = null; render(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
});
window.addEventListener('online', () => { render(); if (S.waitOnline) { S.waitOnline = false; connect(); } else if (S.user) refresh(); });
window.addEventListener('offline', () => render());
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && online() && !S.waitOnline) refresh(); });

/* 다른 곳에서 바뀐 내용 받기. 계정이 중지·삭제되었거나 권한이 바뀌었으면 바로 반영한다 */
async function refresh() {
  if (S.fromCache) return connect(); // 아직 서버에서 로그인 확인을 못 한 상태 → 확인부터
  try {
    const u = await S.api.whoami();
    if (u === undefined) return; // 로그인 상태를 확인하지 못함(연결 문제 등) → 아무것도 바꾸지 않는다
    if (u === null || u.status !== 'active') { await ACT.logout(); toast('계정 사용이 중지되었거나 승인이 취소되었습니다. 관리자에게 문의하세요.', true); return; }
    if (u.role !== S.user.role || u.name !== S.user.name) { S.user = { ...S.user, ...u }; store.set('gaya-user', S.user); }
    await loadCache(); S.serverDown = false; render(); onEnterRoute(); offPrune();
  } catch {}
}

/* ───────── 검색: 결과 칸(#pane)만 바꿔 그려 입력 중인 칸을 건드리지 않는다 (한글 조합이 깨지지 않게) ───────── */
let sT, sSeq = 0;
function searchItems(now) {
  clearTimeout(sT);
  const go = async () => {
    const q = S.q.trim(); const seq = ++sSeq;
    if (!q) S.searchRes = null;
    else { const res = await S.api.search(q).catch(() => ({ items: [] })); if (seq !== sSeq || q !== S.q.trim()) return; S.searchRes = res.items; }
    updatePane();
  };
  if (now) go(); else sT = setTimeout(go, 150);
}
let dT, dSeq = 0;
function searchDocs(now) {
  clearTimeout(dT);
  const go = async () => {
    const q = S.docsQ.trim(); const seq = ++dSeq;
    if (!q) { S.docSearchRes = null; return updatePane(); }
    // 파일 이름이 맞는 것은 바로 보여 주고, 파일 안 글자 검색(구글)은 끝나는 대로 더한다
    const lq = q.toLowerCase();
    S.docSearchRes = S.cache.docs.filter(d => smatch(d.name, lq)).map(d => ({ id: d.id, inside: false }));
    S.docSearching = true; updatePane();
    const res = await S.api.search(q).catch(() => null);
    if (seq !== dSeq || q !== S.docsQ.trim()) return;
    S.docSearching = false; if (res) S.docSearchRes = res.docs; updatePane();
  };
  if (now) go(); else dT = setTimeout(go, 200);
}
function updatePane() {
  const p = $('#pane'); const r = route(); const v = VIEW[r.tab + '.' + r.view];
  if (p && v && S.user) { const out = v(r); if (out.pane != null) { p.innerHTML = out.pane; return; } }
  render();
}

/* ───────── 전체 다시 그리기 ─────────
   · 한글을 조합하는 중에는 미뤘다가 조합이 끝나면 그린다
   · 다시 그려도 입력하던 글자·커서 위치가 그대로 남는다 */
let composing = false, renderPending = false;
document.addEventListener('compositionstart', () => { composing = true; });
document.addEventListener('compositionend', () => { composing = false; if (renderPending) { renderPending = false; setTimeout(render, 0); } });
const KEEP_SEL = 'input[id]:not([type=file]):not([type=checkbox]):not([type=radio]):not([data-bind]),textarea[id]:not([data-bind])';
function render() {
  const a = document.activeElement;
  if (composing && a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) { renderPending = true; return; }
  const fid = a && a.id; let sel = null;
  try { if (fid && a.selectionStart != null) sel = [a.selectionStart, a.selectionEnd]; } catch {}
  const keep = {}; document.querySelectorAll('#app ' + KEEP_SEL.split(',').join(',#app ') + ',#overlay ' + KEEP_SEL.split(',').join(',#overlay ')).forEach(el => { if (!el.hasAttribute('data-nokeep')) keep[el.id] = el.value; });
  const sy = S.sheet ? ($('.sheet') || {}).scrollTop : null;
  $('#app').innerHTML = S.user && S.user.status === 'active' && S.cache ? shell() : authView();
  $('#overlay').innerHTML = S.sheet ? sheetView() : '';
  for (const id in keep) { const n = document.getElementById(id); if (n && n.value !== keep[id] && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA')) n.value = keep[id]; }
  drawToast();
  if (sy != null && $('.sheet')) $('.sheet').scrollTop = sy;
  if (fid) { const n = document.getElementById(fid); if (n) { n.focus({ preventScroll: true }); if (sel) try { n.setSelectionRange(sel[0], sel[1]); } catch {} } }
  if (S.sheet && !S.sheetFocused) { S.sheetFocused = true; const fa = $('.sheet [data-autofocus]'); if (fa) fa.focus(); }
  afterRender();
}

/* ───────── 로그인 · 가입 ───────── */
function authView() {
  const u = S.user;
  const hero = (sub = '') => `<div class="auth-hero">${logo('logo', true)}<div class="co">(주)가야엘리베이터</div><h1>자재·자료 관리</h1><p>${sub || '사내 전용 · 자재 입출고와 기술 자료'}</p></div>`;
  if ((u && u.status === 'active') || S.booting) return `<div class="auth-wrap">${hero('불러오는 중…')}</div>`;
  if (u && u.status === 'pending') return `<div class="auth-wrap">${hero()}<div class="auth">
    <div class="card"><h2>가입 신청을 보냈습니다</h2>
      <p style="margin:0" class="muted">${esc(u.name)}님(사내번호 ${esc(u.emp_no)})의 신청을 관리자가 승인하면 바로 쓸 수 있습니다. 승인되면 이 화면에서 「다시 확인」을 누르세요.</p>
      <button class="btn primary block big" data-act="recheck">다시 확인</button>
      <button class="btn ghost block" data-act="logout">다른 사내번호로 로그인</button></div></div></div>`;
  const down = S.serverDown ? `<div class="notice warn" role="alert">${ic('warn')}<span>서버에 연결되지 않습니다. 잠시 뒤 다시 시도하고, 계속 안 되면 관리자에게 알려 주세요. (관리자 안내 › 빨간 불이 켜졌을 때)</span></div>` : '';
  const off = online() ? '' : `<div class="notice crit" role="alert">${ic('wifioff')}<span>인터넷에 연결되어 있지 않습니다. 연결된 뒤 로그인하세요.</span></div>`;
  const err = S.authErr ? `<div class="notice crit" role="alert">${ic('warn')}<span>${esc(S.authErr)}</span></div>` : '';
  if (S.authView === 'signup') return `<div class="auth-wrap">${hero()}<div class="auth">
    <form class="card" data-submit="signup" autocomplete="off">
      <h2>가입 신청</h2>
      <div class="field"><label for="su-emp">사내번호</label><input id="su-emp" name="emp" inputmode="text" autocapitalize="off" required placeholder="예: 1023"><span class="hint">로그인할 때 아이디로 씁니다.</span></div>
      <div class="field"><label for="su-name">실명</label><input id="su-name" name="name" required placeholder="예: 홍길동"><span class="hint">앱 안에서는 사내번호 대신 이름이 보입니다.</span></div>
      <div class="field"><label for="su-pw">비밀번호</label><input id="su-pw" name="pw" type="password" required minlength="6" autocomplete="new-password"><span class="hint">6자 이상</span></div>
      <div class="field"><label for="su-pw2">비밀번호 확인</label><input id="su-pw2" name="pw2" type="password" required autocomplete="new-password"></div>
      <div class="field"><label for="su-phone">연락처 (선택)</label><input id="su-phone" name="phone" inputmode="tel" placeholder="010-0000-0000"></div>
      ${off}${err}
      <button class="btn primary block big" ${S.busy ? 'disabled' : ''}>${S.busy ? '보내는 중…' : '가입 신청 보내기'}</button>
      <p style="margin:0;font-size:13px" class="muted">메일 인증은 없습니다. 관리자가 이름과 사내번호를 확인하고 승인합니다.</p>
    </form>
    <p style="text-align:center;margin:0">이미 가입했다면 <button class="linkbtn" data-act="authView" data-v="login">로그인</button></p></div></div>`;
  return `<div class="auth-wrap">${hero()}<div class="auth">
    <form class="card" data-submit="login">
      ${down}
      <div class="field"><label for="li-emp">사내번호</label><input id="li-emp" name="emp" autocapitalize="off" autocomplete="username" required placeholder="예: 1023"></div>
      <div class="field"><label for="li-pw">비밀번호</label><input id="li-pw" name="pw" type="password" autocomplete="current-password" required></div>
      ${off}${err}
      <button class="btn primary block big" ${S.busy ? 'disabled' : ''}>${S.busy ? '확인하는 중…' : '로그인'}</button>
      <p style="margin:0;font-size:13px" class="muted">비밀번호를 잊었으면 관리자에게 초기화를 요청하세요.</p>
    </form>
    <p style="text-align:center;margin:0">처음이면 <button class="linkbtn" data-act="authView" data-v="signup">가입 신청</button></p>
    ${DEMO ? `<div class="card" style="gap:10px"><div style="font-weight:700">체험판 · 역할을 골라 바로 들어가기</div>
      <div class="rolepick"><button data-act="quick" data-role="dev"><b>개발자</b><span>재석</span></button><button data-act="quick" data-role="admin"><b>관리자</b><span>김도윤</span></button><button data-act="quick" data-role="staff"><b>직원</b><span>박성호</span></button></div>
      <p style="margin:0;font-size:12.5px" class="muted">예시 데이터입니다. 직접 로그인하려면 사내번호 1001~1006, 비밀번호 1234.</p></div>` : ''}
  </div></div>`;
}

/* ───────── 뼈대 ───────── */
function shell() {
  const r = route(); const v = VIEW[r.tab + '.' + r.view] || VIEW['items.browse'];
  const out = v(r);
  const tabs = [['items', 'box', '자재'], ['docs', 'docs', '자료'], ['scan', 'scan', '스캔'], ['alerts', 'bell', '알림'], ['more', 'more', '더보기']];
  const isRoot = S.stack.length === 1;
  return `${S.serverDown && online() ? `<div class="offline down" role="status">${ic('warn')}<span>서버에 연결되지 않아 마지막으로 받은 내용만 보입니다.</span></div>` : ''}${online() ? '' : `<div class="offline" role="status">${ic('wifioff')}<span>오프라인 · 마지막으로 받은 내용만 보입니다. 저장은 연결된 뒤에 됩니다.</span></div>`}
  ${DEMO ? `<div class="demo-strip"><b>체험판</b><span>예시 데이터 · 이 기기에만 저장됩니다</span></div>` : ''}
  <header class="appbar"><div class="appbar-top">
    ${isRoot ? logo('logo', true) : `<button class="iconbtn" data-act="back" aria-label="뒤로">${ic('back')}</button>`}
    <div class="ttl">${isRoot ? '<span class="brandline">가야엘리베이터</span>' : ''}<h1>${esc(out.title)}</h1></div>${out.actions ? `<div class="actions">${out.actions}</div>` : ''}</div>
    ${out.crumbs ? `<nav class="crumbs" aria-label="경로">${out.crumbs}</nav>` : ''}</header>
  <main id="main" class="${(S.tab === 'items' || S.tab === 'scan') && cart().length && !out.bar ? 'has-bar' : ''} ${out.bar ? 'has-bar' : ''}">${out.body}</main>
  ${out.fab || ''}${out.bar || ((S.tab === 'items' || S.tab === 'scan') && cart().length ? `<div class="cartbar"><button data-act="cartOpen">${ic('box')}<span class="t">담은 자재 <b>${cart().length}가지</b></span><span class="go">한 번에 출고 ${ic('chev')}</span></button></div>` : '')}
  <nav class="tabbar" aria-label="메뉴"><div class="tabbar-in">${tabs.map(([t, i, l]) => `<button class="tab ${t === 'scan' ? 'scan' : ''}" data-act="tab" data-t="${t}" ${S.tab === t ? 'aria-current="page"' : ''}>${t === 'scan' ? `<span class="bub">${ic(i)}</span>` : ic(i)}<span>${l}</span>${t === 'alerts' && S.unread ? `<span class="dot">${S.unread > 99 ? '99+' : S.unread}</span>` : ''}</button>`).join('')}</div></nav>`;
}
const crumbs = (list) => list.map((c, i) => i === list.length - 1 ? `<span class="here">${esc(c.label)}</span>` : `<button data-act="${c.act}" ${Object.entries(c.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${esc(c.label)}</button><span class="sep">›</span>`).join('');
const empty = (icon, msg, sub = '') => `<div class="empty"><span class="eic">${ic(icon)}</span><div>${msg}</div>${sub ? `<div style="font-size:13px">${sub}</div>` : ''}</div>`;
const lowChip = it => isLow(it) ? `<span class="chip crit">부족 · 최소 ${it.min_qty}</span>` : '';
const searchBox = (id, val, ph, label) => `<div class="search">${ic('search')}<input id="${id}" type="search" enterkeyhint="search" placeholder="${ph}" value="${esc(val)}" aria-label="${label}" autocomplete="off"></div>`;

/* 품목 목록: 같은 품명이 여러 사양이면 묶음 머리를 달아 준다 */
function itemList(items, qtyOf, sub, outLoc) {
  if (!items.length) return '';
  const groups = new Map();
  items.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko') || (a.spec || '').localeCompare(b.spec || '', 'ko', { numeric: true })).forEach(it => { if (!groups.has(it.name)) groups.set(it.name, []); groups.get(it.name).push(it); });
  let h = '';
  for (const [name, arr] of groups) {
    const grouped = arr.length > 1;
    if (grouped) h += `<div class="group-h"><span>${esc(name)}</span><span>${arr.length}종</span></div>`;
    arr.forEach(it => {
      const q = qtyOf(it);
      const inner = `<div class="main"><span class="t">${esc(grouped ? (it.spec || '(규격 없음)') : itemTitle(it))}</span><span class="s">${esc([it.maker, it.models].filter(Boolean).join(' · ') || ' ')}</span>${sub ? sub(it) : ''}</div>
        <div class="end"><span class="qty ${isLow(it) ? 'low' : ''}">${q}<small>${esc(it.unit)}</small></span>${lowChip(it)}</div>`;
      h += outLoc
        ? `<div class="lrow irow"><button class="hit" data-act="item" data-id="${it.id}">${inner}</button><button class="btn sm outbtn" data-act="outHere" data-id="${it.id}" data-loc="${outLoc}" data-write ${q ? '' : 'disabled'}>${ic('out')}꺼내기</button></div>`
        : `<button class="lrow" data-act="item" data-id="${it.id}">${inner}</button>`;
    });
  }
  return `<div class="ledger">${h}</div>`;
}
const locRow = (l, extra = '') => {
  const ids = descLocs(l.id); const items = new Set();
  ids.forEach(id => (S.ix.byLoc.get(id) || []).forEach(s => items.add(s.item_id)));
  return `<button class="lrow" data-act="loc" data-id="${l.id}"><span class="ic">${ic(l.kind === 'zone' ? 'pin' : 'shelf')}</span>
    <div class="main"><span class="t">${esc(l.name)}</span><span class="s">${items.size}품목${extra}</span></div>
    ${l.code ? `<span class="tape">${esc(l.code)}</span>` : ''}<span class="chev">${ic('chev')}</span></button>`;
};
const tapesOf = it => `<span class="tapes">${(S.ix.byItem.get(it.id) || []).map(s => `<span class="tape">${esc(locCode(s.location_id))} · ${s.qty}</span>`).join('') || '<span class="s">재고 없음</span>'}</span>`;

/* 내가 최근에 자주 입출고한 품목 6개 (많이 쓴 순, 같으면 최근 순) */
function myItems(tx) {
  const score = new Map();
  (tx || []).forEach((t, i) => { if (!S.ix.item.has(t.item_id) || t.type === 'cancel') return; const v = score.get(t.item_id) || { n: 0, first: i }; v.n++; score.set(t.item_id, v); });
  return [...score.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first).slice(0, 6).map(([id]) => S.ix.item.get(id));
}
/* 홈 화면에 앱 설치 안내 (설치했거나 「다음에」를 누르면 2주 동안 숨김) */
function installPromo() {
  if (isStandalone() || !pref('install')) return '';
  if (!S.installEvt && !isIOS() && !DEMO) return '';
  return `<div class="promo">${ic('phone')}<div class="main"><b>앱을 홈 화면에 추가하세요</b><span>아이콘을 눌러 바로 열리고, 화면도 넓게 쓸 수 있습니다.</span></div><div class="acts"><button class="btn sm primary" data-act="install">추가하기</button><button class="btn sm ghost" data-act="installLater">다음에</button></div></div>`;
}

/* ───────── 화면들 ───────── */
const VIEW = {};

VIEW['items.browse'] = r => {
  const node = r.node; const mode = node ? (r.mode || S.itemsMode) : S.itemsMode; const q = S.q.trim();
  let title = '자재', cr = null, pane = '', actions = '';
  const tools = `<div class="toolbar"><div class="seg" role="group" aria-label="보기 방식"><button data-act="mode" data-m="loc" aria-pressed="${mode === 'loc'}">위치별</button><button data-act="mode" data-m="cat" aria-pressed="${mode === 'cat'}">분류별</button></div><span class="grow"></span>${can(S.user, 'item') ? `<button class="btn sm" data-act="itemNew" data-write>${ic('plus')}품목 추가</button>` : ''}</div>`;
  if (q) {
    const items = (S.searchRes || []).map(id => S.ix.item.get(id)).filter(Boolean);
    pane = `<section class="sec"><div class="sec-h"><h2>검색 결과</h2><span class="aside">${S.searchRes ? items.length + '건' : ''}</span></div>
      ${items.length ? itemList(items, it => total(it.id), tapesOf) : `<div class="ledger">${empty('search', S.searchRes ? '찾는 자재가 없습니다.' : '찾는 중…', '규격 숫자(예: 62, MY4N)나 제조사로도 찾아보세요.')}</div>`}</section>`;
  } else if (mode === 'loc') {
    if (!node) {
      const lows = S.cache.items.filter(isLow); const d = vd(); const tx = d.tx || [];
      const mine = myItems(d.mine);
      pane = `${installPromo()}<div class="stats">
          <button class="stile ${lows.length ? 'crit' : ''}" data-act="jump" data-to="sec-low"><span class="k">${ic('warn')}재고 부족</span><span class="v">${lows.length}<small>품목</small></span></button>
          <button class="stile" data-act="history"><span class="k">${ic('move')}오늘 입출고</span><span class="v">${d.today ?? '–'}<small>건</small></span></button>
          <div class="stile"><span class="k">${ic('box')}등록 품목</span><span class="v">${S.cache.items.length}<small>종</small></span></div></div>
        <div class="quicklinks"><button data-act="history">${ic('history')}<span>입출고 기록</span></button><button data-act="sites">${ic('pin')}<span>현장별 이력</span></button>${can(S.user, 'item') ? `<button data-act="order">${ic('list')}<span>발주·입고</span></button>` : ''}</div>
        ${mine.length ? `<section class="sec"><div class="sec-h"><h2>내가 자주 쓰는 품목</h2></div><div class="quick">${mine.map(it => `<button class="qitem" data-act="item" data-id="${it.id}"><span class="t">${esc(itemTitle(it))}</span><span class="qty ${isLow(it) ? 'low' : ''}">${total(it.id)}<small>${esc(it.unit)}</small></span></button>`).join('')}</div></section>` : ''}
        ${tools}
        ${lows.length ? `<section class="sec" id="sec-low"><div class="sec-h"><h2>재고 부족</h2><span class="grow"></span>${can(S.user, 'item') ? `<button class="btn sm" data-act="order">${ic('list')}발주 목록</button>` : ''}<button class="btn sm" data-act="shareLow">${ic('share')}목록 보내기</button></div>${itemList(lows, it => total(it.id))}</section>` : ''}
        <section class="sec"><div class="sec-h"><h2>보관 위치</h2></div><div class="ledger">${(S.ix.locKids.get(null) || []).map(l => locRow(l)).join('') || empty('pin', '등록된 위치가 없습니다.', can(S.user, 'location') ? '더보기 › 위치 관리에서 구역을 추가하세요.' : '')}</div></section>
        <section class="sec" id="sec-recent"><div class="sec-h"><h2>최근 입출고</h2><button class="btn sm ghost" data-act="history">${ic('history')}전체 기록</button></div><div class="ledger hist">${d.tx ? (tx.length ? tx.map(t => txRow(t, true)).join('') : empty('list', '아직 입출고 기록이 없습니다.')) : loadingBox()}</div></section>`;
    } else {
      const l = S.ix.loc.get(node); if (!l) return { title: '위치 없음', body: empty('pin', '지워진 위치입니다.') };
      const path = pathOf(S.ix.loc, node);
      title = l.name;
      cr = crumbs([{ label: '자재', act: 'locRoot' }, ...path.map(p => ({ label: p.name, act: 'loc', data: { id: p.id } }))]);
      const here = (S.ix.byLoc.get(node) || []).map(s => ({ it: S.ix.item.get(s.item_id), q: s.qty })).filter(x => x.it);
      const qmap = new Map(here.map(x => [x.it.id, x.q]));
      const kids = S.ix.locKids.get(node) || [];
      actions = can(S.user, 'location') ? `<button class="iconbtn" data-act="locEdit" data-id="${l.id}" aria-label="위치 수정" data-write>${ic('edit')}</button>` : '';
      pane = `<section class="hero" style="flex-direction:row;gap:14px;align-items:center">
          <div class="photo" style="width:68px;height:68px">${l.photo ? `<img src="${esc(l.photo)}" alt="">` : ic('shelf')}</div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">${l.code ? `<span class="tape lg" style="align-self:flex-start">${esc(l.code)}</span>` : ''}<span class="muted" style="font-size:13.5px">${esc(locPathText(node))}</span></div>
          <div class="herobtns"><button class="btn sm" data-act="labelsFor" data-id="${l.id}">${ic('qr')}라벨</button>${can(S.user, 'adjust') ? `<button class="btn sm" data-act="countOpen" data-id="${l.id}" data-write>${ic('check')}실사</button>` : ''}</div></section>
        ${can(S.user, 'adjust') && countChanges(node).out.length ? `<button class="notice warn" data-act="countOpen" data-id="${l.id}" style="border:0;text-align:left;width:100%;cursor:pointer">${ic('warn')}<span>실사하던 수량 <b>${countChanges(node).out.length}개</b>가 아직 저장되지 않았습니다. 눌러서 이어서 하세요.</span></button>` : ''}
        ${kids.length ? `<section class="sec"><div class="sec-h"><h2>안쪽 위치</h2></div><div class="ledger">${kids.map(k => locRow(k)).join('')}</div></section>` : ''}
        <section class="sec"><div class="sec-h"><h2>이 위치의 자재</h2><button class="btn sm" data-act="inHere" data-id="${l.id}" data-write>${ic('in')}여기에 입고</button></div>
        ${here.length ? itemList(here.map(x => x.it), it => qmap.get(it.id), null, node) : `<div class="ledger">${empty('box', '이 위치에 등록된 자재가 없습니다.', kids.length ? '안쪽 위치를 열어 보세요.' : '「여기에 입고」로 자재를 넣을 수 있습니다.')}</div>`}</section>`;
    }
  } else {
    const kids = S.ix.catKids.get(node || null) || [];
    const c = node ? S.ix.cat.get(node) : null;
    if (node && !c) return { title: '분류 없음', body: empty('tag', '지워진 분류입니다.') };
    title = c ? c.name : '자재';
    if (c) cr = crumbs([{ label: '자재', act: 'catRoot' }, ...pathOf(S.ix.cat, node).map(p => ({ label: p.name, act: 'cat', data: { id: p.id } }))]);
    const direct = S.cache.items.filter(i => (i.category_id || null) === (node || null));
    const catRow = k => { const ids = descCats(k.id); const its = S.cache.items.filter(i => ids.includes(i.category_id)); const low = its.filter(isLow).length;
      return `<button class="lrow" data-act="cat" data-id="${k.id}"><span class="ic">${ic('tag')}</span><div class="main"><span class="t">${esc(k.name)}</span><span class="s">${its.length}품목</span></div>${low ? `<span class="chip crit">부족 ${low}</span>` : ''}<span class="chev">${ic('chev')}</span></button>`; };
    pane = (node ? '' : tools) + (kids.length ? `<section class="sec"><div class="sec-h"><h2>${c ? '하위 분류' : '분류'}</h2></div><div class="ledger">${kids.map(catRow).join('')}</div></section>` : '')
      + (direct.length ? `<section class="sec"><div class="sec-h"><h2>${c ? '품목' : '분류 없음'}</h2><span class="aside">전체 수량</span></div>${itemList(direct, it => total(it.id), tapesOf)}</section>` : '')
      + (!kids.length && !direct.length ? `<div class="ledger">${empty('tag', '이 분류에는 품목이 없습니다.')}</div>` : '');
  }
  const body = searchBox('q-items', S.q, '품명·규격·제조사·기종 검색', '자재 검색') + `<div id="pane" class="pane">${pane}</div>`;
  return { title, body, pane, crumbs: q ? null : cr, actions: q ? '' : actions };
};

/* 입출고 기록 찾기: 달별로 보고, 현장·품목·사람·메모로 거른다. 관리자는 엑셀로 받는다 */
const HIST_KINDS = [['', '전체'], ['out', '출고'], ['in', '입고'], ['move', '이동'], ['etc', '취소·정정']];
function histRows(list) {
  const q = (S.histQ || '').trim().toLowerCase(); const k = S.histKind || '';
  return (list || []).filter(t => {
    if (k === 'etc' ? !['cancel', 'adjust'].includes(t.type) : k && t.type !== k) return false;
    if (!q) return true;
    const it = S.ix.item.get(t.item_id);
    const hay = [it && it.name, it && it.spec, it && it.maker, t.site, t.note, personName(t.user_id), t.from_loc && locCode(t.from_loc), t.to_loc && locCode(t.to_loc), t.from_loc && locPathText(t.from_loc), t.to_loc && locPathText(t.to_loc)].join(' ').toLowerCase();
    return q.split(/\s+/).every(w => kmatch(hay, w));
  });
}
const monthLabel = m => { const [y, mm] = m.split('-'); return `${y}년 ${+mm}월`; };
const shiftMonth = (m, d) => { const [y, mm] = m.split('-').map(Number); const x = new Date(y, mm - 1 + d, 1); return x.getFullYear() + '-' + pad(x.getMonth() + 1); };
const thisMonth = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
VIEW['items.history'] = r => {
  const list = vd().list; const rows = list ? histRows(list) : null;
  const cnt = k => (rows || []).filter(t => t.type === k && !t.canceled_by).reduce((a, t) => a + 1, 0);
  let pane;
  if (!rows) pane = `<div class="ledger">${loadingBox()}</div>`;
  else {
    let h = '', day = '';
    rows.forEach(t => { const d = toDate(t.created_at); const dl = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + '일월화수목금토'[d.getDay()] + ')'; if (dl !== day) { day = dl; h += `<div class="group-h"><span>${dl}</span></div>`; } h += txRow(t, true); });
    pane = `<div class="sumline"><span>${rows.length}건</span>${['out', 'in', 'move'].map(k => cnt(k) ? `<span class="chip ${k === 'out' ? 'out' : k === 'in' ? 'acc' : ''}">${TX_NAME[k]} ${cnt(k)}</span>` : '').join('')}</div>
      <div class="ledger hist">${h || empty('search', S.histQ ? '찾는 기록이 없습니다.' : '이 달에는 기록이 없습니다.', S.histQ ? '현장 이름 일부, 품명, 사람 이름으로 찾아보세요.' : '')}</div>`;
  }
  const body = `<div class="monthbar"><button class="iconbtn" data-act="histMonth" data-d="-1" aria-label="이전 달">${ic('back')}</button><b>${monthLabel(r.month)}</b><button class="iconbtn" data-act="histMonth" data-d="1" aria-label="다음 달" ${r.month >= thisMonth() ? 'disabled' : ''}>${ic('chev')}</button></div>
    ${searchBox('q-hist', S.histQ || '', '현장·품명·사람·메모로 찾기 (예: 한빛)', '기록 검색')}
    <div class="filters" role="group" aria-label="종류">${HIST_KINDS.map(([k, l]) => `<button class="fchip" data-act="histKind" data-k="${k}" aria-pressed="${(S.histKind || '') === k}">${l}</button>`).join('')}</div>
    <div id="pane" class="pane">${pane}</div>`;
  const actions = `<button class="btn sm" data-act="sites">${ic('pin')}현장별</button>` + (can(S.user, 'audit') ? `<button class="btn sm" data-act="histExport">${ic('download')}엑셀</button>` : '');
  return { title: '입출고 기록', crumbs: crumbs([{ label: '자재', act: 'locRoot' }, { label: '입출고 기록' }]), body, pane, actions };
};

/* 현장별 사용 이력 — 최근 1년 출고를 현장 이름으로 묶는다 */
VIEW['items.sites'] = () => {
  const list = vd().list; let pane;
  if (!list) pane = `<div class="ledger">${loadingBox('pin')}</div>`;
  else {
    const g = new Map();
    list.forEach(t => { if (t.type !== 'out' || t.canceled_by) return; const nm = parseSite(t.site).name || t.site; const x = g.get(nm) || { n: 0, last: t.created_at, hos: new Set() }; x.n++; if (t.created_at > x.last) x.last = t.created_at; const h = siteHo(parseSite(t.site)); if (h) x.hos.add(h); g.set(nm, x); });
    const q = (S.sitesQ || '').trim();
    const rows = [...g].filter(([nm]) => smatch(nm, q)).sort((a, b) => b[1].last.localeCompare(a[1].last));
    pane = `<div class="ledger">${rows.map(([nm, x]) => `<button class="lrow" data-act="site" data-v="${esc(nm)}"><span class="ic">${ic('pin')}</span><div class="main"><span class="t">${esc(nm)}</span><span class="s">출고 ${x.n}건 · 마지막 ${fmtWhen(x.last)}${x.hos.size ? ' · ' + esc([...x.hos].slice(0, 3).join(', ')) + (x.hos.size > 3 ? ` 외 ${x.hos.size - 3}` : '') : ''}</span></div><span class="chev">${ic('chev')}</span></button>`).join('') || empty('pin', q ? '찾는 현장이 없습니다.' : '최근 1년 동안 현장을 적은 출고가 없습니다.', q ? '초성으로도 찾을 수 있습니다 (예: ㅎㅂ).' : '출고할 때 「현장」 칸을 적으면 여기에 모입니다.')}</div>`;
  }
  const body = searchBox('q-sites', S.sitesQ || '', '현장 이름 찾기 (예: 한빛, ㅎㅂ)', '현장 검색') + `<div id="pane" class="pane">${pane}</div>`;
  return { title: '현장별', crumbs: crumbs([{ label: '자재', act: 'locRoot' }, { label: '현장별' }]), body, pane };
};
VIEW['items.site'] = r => {
  const list = vd().list;
  const body = (() => {
    if (!list) return `<div class="ledger">${loadingBox('pin')}</div>`;
    const hos = [...new Set(list.map(t => siteHo(parseSite(t.site))).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
    const sel = S.siteHo || '';
    const rows = list.filter(t => !sel || siteHo(parseSite(t.site)) === sel);
    const outs = rows.filter(t => t.type === 'out' && !t.canceled_by);
    const sum = new Map(); outs.forEach(t => sum.set(t.item_id, (sum.get(t.item_id) || 0) + t.qty));
    const top = [...sum].sort((a, b) => b[1] - a[1]);
    let h = '', day = '';
    rows.forEach(t => { const d = toDate(t.created_at); const dl = d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; if (dl !== day) { day = dl; h += `<div class="group-h"><span>${dl}</span></div>`; } h += txRow(t, true); });
    return `${hos.length ? `<div class="filters" role="group" aria-label="동·호기">${[['', '전체'], ...hos.map(x => [x, x])].map(([v, l]) => `<button class="fchip" data-act="siteHo" data-v="${esc(v)}" aria-pressed="${sel === v}">${esc(l)}</button>`).join('')}</div>` : ''}
      <div class="stats"><div class="stile"><span class="k">${ic('out')}출고</span><span class="v">${outs.length}<small>건</small></span></div><div class="stile"><span class="k">${ic('box')}자재 종류</span><span class="v">${sum.size}<small>가지</small></span></div><div class="stile"><span class="k">${ic('clock')}처음 기록</span><span class="v sm">${rows.length ? (d => (d.getFullYear() % 100) + '.' + (d.getMonth() + 1) + '.' + d.getDate())(toDate(rows[rows.length - 1].created_at)) : '–'}</span></div></div>
      ${top.length ? `<section class="sec"><div class="sec-h"><h2>이 현장에 쓴 자재</h2><span class="aside">취소한 것은 빼고</span></div><div class="ledger">${top.map(([id, q]) => { const it = S.ix.item.get(id); return `<button class="lrow" data-act="item" data-id="${id}"><div class="main"><span class="t">${esc(itemTitle(it))}</span><span class="s">${outs.filter(t => t.item_id === id).length}번 출고</span></div><span class="qty">${q}<small>${esc(it ? it.unit : '')}</small></span><span class="chev">${ic('chev')}</span></button>`; }).join('')}</div></section>` : ''}
      <section class="sec"><div class="sec-h"><h2>기록</h2><span class="aside">${rows.length}건</span></div><div class="ledger hist">${h || empty('list', '기록이 없습니다.')}</div></section>`;
  })();
  return { title: r.name, crumbs: crumbs([{ label: '자재', act: 'locRoot' }, { label: '현장별', act: 'sites' }, { label: r.name }]), body };
};

/* 재고 실사: 선반에 실제로 있는 수량을 차례로 적고 한 번에 저장 */
function countAddList() {
  const q = (S.cntQ || '').trim(); if (!q) return '';
  const have = new Set(countIds(route().node));
  const list = S.cache.items.filter(i => !have.has(i.id) && smatch([i.name, i.spec, i.maker, i.models].join(' '), q)).slice(0, 20);
  return `<div class="ledger">${list.map(i => `<button class="lrow" data-act="cntAdd" data-id="${i.id}"><span class="ic">${ic('plus')}</span><div class="main"><span class="t">${esc(itemTitle(i))}</span><span class="s">${esc(i.maker || '')} · 전체 ${total(i.id)}${esc(i.unit)}</span></div></button>`).join('') || empty('search', '찾는 품목이 없습니다.', '아래 「새 품목 등록」으로 바로 만들 수 있습니다.')}</div>`;
}
VIEW['items.count'] = r => {
  const l = S.ix.loc.get(r.node); if (!l) return { title: '실사', body: empty('pin', '지워진 위치입니다.') };
  if (!can(S.user, 'adjust')) return { title: '실사', body: empty('info', '재고 실사는 관리자만 할 수 있습니다.') };
  const c = countState(r.node); const ids = countIds(r.node); const { out } = countChanges(r.node);
  const rows = ids.map(id => { const it = S.ix.item.get(id); const cur = qtyAt(id, r.node); const v = c.vals[id] ?? ''; const ch = isInt(v) && +v !== cur;
    return `<div class="crow ${ch ? 'chg' : ''} ${String(v).trim() !== '' && !isInt(v) ? 'bad' : ''}"><div class="main"><span class="t">${esc(itemTitle(it))}</span><span class="s was">${ch ? `기록 ${cur} → ${+v}` : `기록 ${cur}`}</span></div>
      <div class="ministep big"><button type="button" data-act="cntStep" data-id="${id}" data-d="-1" aria-label="하나 빼기">−</button><input id="cnt-${id}" data-cnt="${id}" data-nokeep inputmode="numeric" value="${esc(v)}" placeholder="${cur}" aria-label="${esc(itemTitle(it))} 실제 수량" autocomplete="off"><button type="button" data-act="cntStep" data-id="${id}" data-d="1" aria-label="하나 더하기">+</button></div><span class="unit">${esc(it.unit)}</span></div>`; }).join('');
  const body = `<section class="hero" style="flex-direction:row;gap:12px;align-items:center">${l.code ? `<span class="tape lg">${esc(l.code)}</span>` : ''}<span class="muted" style="font-size:13.5px;flex:1;min-width:0">${esc(locPathText(l.id))}</span></section>
    <div class="notice">${ic('info')}<span>선반에 <b>실제로 있는 수량</b>을 세어 적으세요. 비워 둔 칸은 그대로 두고, 바뀐 품목만 「수량 정정(실사)」으로 저장됩니다. 적던 수량은 저장 전까지 이 폰에 남아 있습니다.</span></div>
    <section class="sec"><div class="sec-h"><h2>이 위치의 품목</h2><span class="aside">${ids.length}가지</span></div><div class="ledger countlist">${rows || empty('box', '이 위치에 등록된 품목이 없습니다.', '아래에서 품목을 찾아 넣으세요.')}</div></section>
    <section class="sec"><div class="sec-h"><h2>다른 품목 넣기</h2><button class="btn sm" data-act="cntNewItem" data-write>${ic('plus')}새 품목 등록</button></div>
      ${searchBox('q-cnt', S.cntQ || '', '품명·규격 검색 (초성도 됨)', '넣을 품목 검색')}<div id="cnt-add">${countAddList()}</div></section>`;
  const bar = `<div class="countbar"><button class="btn ghost" data-act="cntReset" ${Object.keys(c.vals).length || c.added.length ? '' : 'disabled'}>처음대로</button><span id="cnt-sum" class="grow">${out.length ? `바뀐 품목 ${out.length}개` : '바뀐 품목 없음'}</span><button id="cnt-save" class="btn primary" data-act="cntSave" data-write ${out.length && !S.busy ? '' : 'disabled'}>저장</button></div>`;
  return { title: '실사 · ' + l.name, crumbs: crumbs([{ label: '자재', act: 'locRoot' }, ...pathOf(S.ix.loc, l.id).map(p => ({ label: p.name, act: 'loc', data: { id: p.id } })), { label: '실사' }]), body, bar, actions: `<button class="btn sm" data-act="cntNext">${ic('scan')}다음 선반</button>` };
};

/* 발주 목록: 재고 부족 품목을 최소 재고까지 채우는 수량으로 미리 채워 둔다 */
function orderAddList() {
  const q = (S.ordQ || '').trim(); if (!q) return '';
  const have = new Set(orderRows().map(r => r.id));
  const list = S.cache.items.filter(i => !have.has(i.id) && smatch([i.name, i.spec, i.maker, i.models].join(' '), q)).slice(0, 20);
  return `<div class="ledger">${list.map(i => `<button class="lrow" data-act="ordAdd" data-id="${i.id}"><span class="ic">${ic('plus')}</span><div class="main"><span class="t">${esc(itemTitle(i))}</span><span class="s">${esc(i.maker || '제조사 미정')} · 지금 ${total(i.id)}${esc(i.unit)}</span></div></button>`).join('') || empty('search', '찾는 품목이 없습니다.')}</div>`;
}
VIEW['items.order'] = () => {
  if (!S.order) orderInit();
  const rows = orderRows(); const groups = new Map();
  rows.forEach(r => { const it = S.ix.item.get(r.id); const k = it.maker || '제조사 미정'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  const on = rows.filter(r => r.on && r.qty > 0).length;
  const body = `<div class="notice">${ic('info')}<span>재고 부족 품목을 <b>최소 재고까지 채우는 수량</b>으로 미리 적어 두었습니다. 수량을 고치거나 체크를 빼고 「보내기」를 누르면 제조사별로 묶은 글이 카톡·문자로 보내집니다. 자재가 들어오면 <b>「한 번에 입고」</b>로 체크한 품목을 한꺼번에 넣으세요. (지금 ${on}품목 체크)</span></div>
    ${[...groups].map(([k, rs]) => `<section class="sec"><div class="sec-h"><h2>${esc(k)}</h2><span class="aside">${rs.length}품목</span></div><div class="ledger">${rs.map(r => { const it = S.ix.item.get(r.id); return `<label class="crow ${r.on ? '' : 'off'}"><input type="checkbox" data-act="ordToggle" data-id="${r.id}" ${r.on ? 'checked' : ''} aria-label="포함"><div class="main"><span class="t">${esc(itemTitle(it))}</span><span class="s">지금 ${total(it.id)} · 최소 ${it.min_qty}${esc(it.unit)}${r.low ? '' : ' · 직접 넣음'}</span></div>
      <div class="ministep"><button type="button" data-act="ordStep" data-id="${r.id}" data-d="-1" aria-label="하나 빼기">−</button><output>${r.qty}</output><button type="button" data-act="ordStep" data-id="${r.id}" data-d="1" aria-label="하나 더하기">+</button></div>${r.low ? '' : `<button type="button" class="iconbtn" data-act="ordDel" data-id="${r.id}" aria-label="빼기">${ic('x')}</button>`}</label>`; }).join('')}</div></section>`).join('') || `<div class="ledger">${empty('check', '재고가 부족한 품목이 없습니다.', '아래에서 발주할 품목을 직접 찾아 넣을 수 있습니다.')}</div>`}
    <section class="sec"><div class="sec-h"><h2>다른 품목 넣기</h2></div>${searchBox('q-ord', S.ordQ || '', '품명·규격 검색 (초성도 됨)', '발주할 품목 검색')}<div id="ord-add">${orderAddList()}</div></section>`;
  const bar = `<div class="countbar ordbar"><button class="btn ghost" data-act="ordCsv" aria-label="엑셀로 받기">${ic('download')}엑셀</button><button class="btn" data-act="ordShare">${ic('share')}보내기</button><button class="btn in" data-act="ordIn" data-write>${ic('in')}한 번에 입고</button></div>`;
  return { title: '발주·입고', crumbs: crumbs([{ label: '자재', act: 'locRoot' }, { label: '발주·입고' }]), body, bar, actions: `<button class="btn sm" data-act="ordReset">다시 채우기</button>` };
};

function txRow(t, withItem = false) {
  const it = S.ix.item.get(t.item_id); const unit = it ? it.unit : '';
  const where = t.type === 'in' ? '→ ' + locCode(t.to_loc) : t.type === 'out' ? '← ' + locCode(t.from_loc) : t.type === 'move' ? locCode(t.from_loc) + ' → ' + locCode(t.to_loc) : t.type === 'adjust' ? '@' + locCode(t.from_loc) + ' ' + t.before + '→' + t.after : '원상복구';
  const sign = t.type === 'in' ? '+' : t.type === 'out' ? '−' : t.type === 'adjust' ? (t.qty >= 0 ? '+' : '−') : '';
  const kcls = { in: 'k-in', out: 'k-out', move: 'k-move', cancel: 'k-cancel', adjust: 'k-adjust' }[t.type];
  const canC = !withItem && !t.canceled_by && ['in', 'out', 'move'].includes(t.type) && can(S.user, 'cancel', t);
  return `<div class="hrow ${t.canceled_by ? 'void' : ''}" ${withItem && it ? `data-act="item" data-id="${t.item_id}" role="button" tabindex="0" style="cursor:pointer"` : ''}>
    <span class="kind ${kcls}">${TX_NAME[t.type]}</span>
    <div class="d">${withItem ? `<div style="font-weight:600">${esc(itemTitle(it))}</div>` : ''}<span class="who">${esc(personName(t.user_id))}</span> <span class="meta">${fmtWhen(t.created_at)}</span>
      <div class="meta"><span class="mono">${esc(where)}</span>${t.site ? ` · <button class="sitelink" data-act="site" data-v="${esc(parseSite(t.site).name || t.site)}">${esc(t.site)}</button>` : ''}${t.note ? ' · ' + esc(t.note) : ''}${t.canceled_by ? ' · 취소됨' : ''}</div></div>
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
  const t = total(it.id); const u = esc(it.unit);
  const body = `<section class="hero">
      <div class="hero-top"><button class="photo" data-act="photoItem" data-id="${it.id}" aria-label="사진 바꾸기" style="padding:0">${it.photo ? `<img src="${esc(it.photo)}" alt="">` : ic('cam')}</button>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px"><h2>${esc(it.name)}${it.spec ? `<span style="display:block;font-size:16px;font-weight:500;color:var(--muted)">${esc(it.spec)}</span>` : ''}</h2>
        <dl class="kv">${it.maker ? `<dt>제조사</dt><dd>${esc(it.maker)}</dd>` : ''}${it.models ? `<dt>적용 기종</dt><dd>${esc(it.models)}</dd>` : ''}<dt>분류</dt><dd>${esc(catPathText(it.category_id) || '없음')}</dd><dt>최소 재고</dt><dd class="num">${it.min_qty ? it.min_qty + u : '정하지 않음'}</dd></dl></div></div>
      <div class="total"><span class="big" style="${isLow(it) ? 'color:var(--crit)' : ''}">${t}<small>${u}</small></span><span class="muted">전체 재고</span>${lowChip(it)}</div>
      <div class="actions3"><button class="btn in" data-act="txIn" data-id="${it.id}" data-write>${ic('in')}입고</button><button class="btn out" data-act="txOut" data-id="${it.id}" data-write ${t ? '' : 'disabled'}>${ic('out')}출고</button><button class="btn" data-act="txMove" data-id="${it.id}" data-write ${t ? '' : 'disabled'}>${ic('move')}이동</button></div>
    </section>
    <section class="sec"><div class="sec-h"><h2>위치별 수량</h2>${adm ? `<button class="btn sm ghost" data-act="txAdjust" data-id="${it.id}" data-write>수량 정정</button>` : ''}</div>
      <div class="ledger">${rows.length ? rows.map(s => `<button class="lrow" data-act="loc" data-id="${s.location_id}"><div class="main"><span class="t"><span class="tape">${esc(locCode(s.location_id))}</span></span><span class="s">${esc(locPathText(s.location_id))}</span></div><span class="qty">${s.qty}<small>${u}</small></span><span class="chev">${ic('chev')}</span></button>`).join('') : empty('pin', '재고가 없습니다.', '「입고」로 넣을 위치와 수량을 기록하세요.')}</div></section>
    <section class="sec"><div class="sec-h"><h2>메모</h2><button class="btn sm ghost" data-act="memoEdit" data-id="${it.id}" data-write>${ic('edit')}${it.memo ? '고치기' : '적기'}</button></div>
      ${it.memo ? `<div class="memo">${esc(it.memo)}</div>` : `<div class="muted" style="font-size:14px">대체품, 보관 요령, 주의할 점 등을 적어 두면 모두가 봅니다.</div>`}</section>
    <section class="sec"><div class="sec-h"><h2>입출고 기록</h2><span class="aside">최근 50건</span></div>
      <div class="ledger hist">${d.tx ? (d.tx.length ? d.tx.map(x => txRow(x)).join('') : empty('list', '아직 기록이 없습니다.')) : loadingBox()}</div></section>
    ${commentsBlock('item', it.id, d.cm)}`;
  const actions = adm ? `<button class="iconbtn" data-act="itemEdit" data-id="${it.id}" aria-label="품목 수정" data-write>${ic('edit')}</button>` : '';
  return { title: it.name, crumbs: cr, body, actions };
};

function commentsBlock(type, id, list) {
  return `<section class="sec"><div class="sec-h"><h2>댓글</h2><span class="aside">${list ? list.length + '개' : ''}</span></div>
    <div class="ledger">${list ? list.map(c => `<div class="cmt"><div class="h"><b>${esc(c.name)}</b><span class="w">${fmtWhen(c.created_at)}</span>${can(S.user, 'delComment', c) ? `<button class="linkbtn" style="margin-left:auto;font-size:12.5px;color:var(--muted)" data-act="delComment" data-id="${c.id}" data-write>지우기</button>` : ''}</div><div class="b">${esc(c.body)}</div></div>`).join('') : (online() ? '' : `<div class="cmt"><span class="muted" style="font-size:13.5px">오프라인이라 댓글을 불러오지 못했습니다.</span></div>`)}
    <form class="cmt-form" data-submit="comment" data-type="${type}" data-id="${id}"><input id="cmt-${id}" name="body" placeholder="댓글 남기기" autocomplete="off" enterkeyhint="send" aria-label="댓글"><button class="btn primary" data-write ${S.busy ? 'disabled' : ''}>등록</button></form></div></section>`;
}

/* ───────── 자료 ───────── */
VIEW['docs.browse'] = r => {
  const fid = r.folder || null; const f = fid ? S.ix.folder.get(fid) : null;
  if (fid && !f) return { title: '자료', body: empty('folder', '지워졌거나 없는 폴더입니다.') };
  const q = S.docsQ.trim(); let pane;
  if (q) {
    const res = (S.docSearchRes || []).map(x => ({ d: S.ix.doc.get(x.id), inside: x.inside })).filter(x => x.d);
    pane = `<section class="sec"><div class="sec-h"><h2>검색 결과</h2><span class="aside">${S.docSearchRes ? res.length + '건' : ''}${S.docSearching ? ' · 파일 안 글자 찾는 중…' : ''}</span></div><div class="ledger">${res.length ? res.map(x => docRow(x.d, true, x.inside)).join('') : empty('search', S.docSearchRes && !S.docSearching ? '찾는 자료가 없습니다.' : '찾는 중…')}</div>
      <p class="muted" style="font-size:12.5px;margin:0">파일 이름뿐 아니라 PDF·문서 안의 글자까지 찾습니다. 스캔 이미지로만 된 PDF는 안쪽 글자가 잡히지 않을 수 있습니다.</p></section>`;
  } else {
    const kids = S.ix.folderKids.get(fid) || [];
    const docs = (S.ix.docsIn.get(fid) || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    const adm = can(S.user, 'folderAdmin');
    pane = `<div class="toolbar"><button class="btn sm" data-act="mkdir" data-write>${ic('folderPlus')}폴더 만들기</button>${fid ? `<button class="btn sm" data-act="addLink" data-write>${ic('link')}영상·링크</button>` : ''}<span class="grow"></span>${f && adm ? `<button class="btn sm ghost" data-act="folderMenu" data-id="${fid}" data-write>폴더 관리</button>` : ''}</div>
      ${f && f.auto_sort ? `<div class="notice">${ic('info')}<span>이 폴더에 올린 파일은 날짜에 맞춰 <b>연도 › 월</b> 폴더로 자동 정리됩니다.</span></div>` : ''}
      ${kids.length ? `<section class="sec"><div class="sec-h"><h2>폴더</h2></div><div class="ledger">${kids.map(k => { const n = (S.ix.docsIn.get(k.id) || []).length, m = (S.ix.folderKids.get(k.id) || []).length;
        return `<button class="lrow" data-act="folder" data-id="${k.id}"><span class="folder-ic">${ic('folder')}</span><div class="main"><span class="t">${esc(k.name)}</span><span class="s">${[m ? '폴더 ' + m : '', n ? '파일 ' + n : ''].filter(Boolean).join(' · ') || '비어 있음'}${k.auto_sort ? ' · 날짜별 자동 정리' : ''}</span></div><span class="chev">${ic('chev')}</span></button>`; }).join('')}</div></section>` : (fid ? '' : `<div class="ledger">${empty('folder', '아직 폴더가 없습니다.', '「폴더 만들기」로 도면, 교육 자료 같은 폴더를 만드세요.')}</div>`)}
      ${fid ? `<section class="sec"><div class="sec-h"><h2>파일</h2><span class="aside">${docs.length ? docs.length + '개 · 최근 올린 순' : ''}</span></div><div class="ledger">${docs.length ? docs.map(d => docRow(d)).join('') : empty('docs', '아직 파일이 없습니다.', '아래 「올리기」로 PDF·엑셀·사진 등을 그대로 올리세요.')}</div></section>` : ''}
      ${!fid ? `<p class="muted" style="font-size:12.5px;margin:0">자료는 회사용 구글 드라이브에 저장되고, 앱 폴더와 같은 모양으로 정리됩니다.</p>` : ''}`;
    if (!fid) {
      const rc = recentDocs().map(id => S.ix.doc.get(id)).filter(Boolean).slice(0, 5);
      pane = (rc.length ? `<section class="sec"><div class="sec-h"><h2>최근 본 자료</h2></div><div class="ledger">${rc.map(d => docRow(d, true)).join('')}</div></section>` : '') + pane;
    }
  }
  const cr = f && !q ? crumbs([{ label: '자료', act: 'folder', data: { id: '' } }, ...pathOf(S.ix.folder, fid).map(p => ({ label: p.name, act: 'folder', data: { id: p.id } }))]) : null;
  const fab = fid ? `<button class="fab" data-act="upload" data-write>${ic('upload')}올리기</button>` : '';
  const body = (fid ? '' : docSeg('all')) + searchBox('q-docs', S.docsQ, '파일 이름·내용 검색 (예: E-15)', '자료 검색') + `<div id="pane" class="pane">${pane}</div>`;
  return { title: f ? f.name : '자료', crumbs: cr, body, pane, fab };
};
const docSeg = m => `<div class="seg block docseg" role="group" aria-label="자료 보기"><button data-act="docsMode" data-m="all" aria-pressed="${m === 'all'}">${ic('docs')}모든 자료</button><button data-act="docsMode" data-m="mine" aria-pressed="${m === 'mine'}">${ic('starOn')}내 저장함 <b>${myIds().length}</b></button></div>`;
/* 내 저장함: ☆ 누른 자료가 모이고 폰에도 저장된다. 폴더는 내 마음대로 (이 휴대폰에만) */
function myDocRow(d) {
  const [k, lab] = fileKind(d.name, d.kind); const off = offInfo(d.id); const busy = S.offBusy && S.offBusy[d.id] != null;
  const st = off ? `<span class="chip ok offchip">${ic('phone')}폰 저장 · ${fmtSize(off.size)}</span>` : busy ? `<span class="chip">저장 중 ${Math.round((S.offBusy[d.id] || 0) * 100)}%</span>` : d.kind === 'file' ? `<span class="chip warn">폰에 없음</span>` : `<span class="chip">링크</span>`;
  return `<div class="lrow irow"><button class="hit" data-act="doc" data-id="${d.id}"><span class="ftype ft-${k}">${lab}</span><div class="main"><span class="t">${esc(d.name)}</span><span class="s">${st} ${esc(folderPathText(d.folder_id))}</span></div></button><button class="iconbtn" data-act="myDocMenu" data-id="${d.id}" aria-label="옮기기·빼기">${ic('dots')}</button></div>`;
}
VIEW['docs.mine'] = r => {
  const md = myData(); const fid = r.folder && md.folders.some(x => x.id === r.folder) ? r.folder : null;
  const f = fid ? md.folders.find(x => x.id === fid) : null;
  const kids = myKids(md, fid); const docs = myDocsIn(md, fid);
  const all = myIds(); const notSaved = all.filter(id => { const d = S.ix.doc.get(id); return d && d.kind === 'file' && !offInfo(id) && !(S.offBusy && S.offBusy[id] != null); });
  const cr = f ? crumbs([{ label: '내 저장함', act: 'myOpen', data: { id: '' } }, ...myPath(md, fid).map(p => ({ label: p.name, act: 'myOpen', data: { id: p.id } }))]) : null;
  const body = `${f ? '' : docSeg('mine')}
    ${!all.length ? `<div class="notice">${ic('info')}<span>자료를 열고 오른쪽 위 <b>☆</b>를 누르면 여기에 모이고 <b>폰에도 저장</b>됩니다. 전파가 약한 기계실·피트에서도 열립니다. 폴더를 만들어 내 마음대로 정리하세요. (이 휴대폰에만 저장)</span></div>` : ''}
    ${notSaved.length && online() ? `<div class="notice warn">${ic('warn')}<span>아직 폰에 없는 자료가 ${notSaved.length}개 있습니다.</span><button class="btn sm" data-act="mySaveAll">모두 폰에 저장</button></div>` : ''}
    <div class="toolbar"><button class="btn sm" data-act="myMkdir">${ic('folderPlus')}폴더 만들기</button>${f ? `<span class="grow"></span><button class="btn sm ghost" data-act="myRename" data-id="${f.id}">${ic('edit')}이름 바꾸기</button><button class="btn sm ghost danger" data-act="myDelFolder" data-id="${f.id}">${ic('trash')}폴더 지우기</button>` : ''}</div>
    ${kids.length ? `<section class="sec"><div class="sec-h"><h2>내 폴더</h2></div><div class="ledger">${kids.map(k => { const n = myDocsIn(md, k.id).length, m = myKids(md, k.id).length;
      return `<button class="lrow" data-act="myOpen" data-id="${k.id}"><span class="folder-ic mine">${ic('folder')}</span><div class="main"><span class="t">${esc(k.name)}</span><span class="s">${[m ? '폴더 ' + m : '', n ? '자료 ' + n : ''].filter(Boolean).join(' · ') || '비어 있음'}</span></div><span class="chev">${ic('chev')}</span></button>`; }).join('')}</div></section>` : ''}
    <section class="sec"><div class="sec-h"><h2>${f ? '이 폴더의 자료' : kids.length ? '폴더에 넣지 않은 자료' : '저장한 자료'}</h2><span class="aside">${docs.length ? docs.length + '개' : ''}</span></div>
      <div class="ledger">${docs.map(d => myDocRow(d)).join('') || empty('docs', f ? '이 폴더는 비어 있습니다.' : all.length ? '모두 폴더에 들어 있습니다.' : '아직 저장한 자료가 없습니다.', f ? '자료 옆 「⋯」 › 「폴더로 옮기기」로 넣으세요.' : '')}</div></section>
    ${all.length ? `<p class="muted" style="font-size:12.5px;margin:0">폰에 저장한 파일 ${Object.keys(offList()).length}개 · ${fmtSize(offTotal())}. PDF·사진은 앱 안에서 바로 열리고, 엑셀·한글 같은 파일은 「파일 열기」로 휴대폰 앱에서 엽니다.</p>` : ''}`;
  return { title: f ? f.name : '자료', crumbs: cr, body };
};
function docRow(d, showPath = false, inside = false) {
  const [k, lab] = fileKind(d.name, d.kind);
  return `<button class="lrow" data-act="doc" data-id="${d.id}"><span class="ftype ft-${k}">${lab}</span><div class="main"><span class="t">${esc(d.name)}${offInfo(d.id) ? ` <span class="chip ok offchip">${ic('phone')}폰 저장</span>` : ''}</span>
    <span class="s">${showPath ? esc(folderPathText(d.folder_id)) + ' · ' : ''}${d.size ? fmtSize(d.size) + ' · ' : ''}${esc(personName(d.uploaded_by))} · ${fmtWhen(d.created_at)}${inside ? ' · <b>파일 안에서 찾음</b>' : ''}</span></div><span class="chev">${ic('chev')}</span></button>`;
}
VIEW['docs.doc'] = r => {
  const d = S.ix.doc.get(r.id);
  if (!d) return { title: '자료', body: empty('docs', '지워졌거나 없는 파일입니다.') };
  const [k, lab] = fileKind(d.name, d.kind); const v = vd(); const adm = can(S.user, 'docAdmin');
  let viewer; const off = offInfo(d.id); const busy = S.offBusy && S.offBusy[d.id] != null;
  if (off && offView(d) && !(S.driveView && S.driveView[d.id] && online())) viewer = `<div id="offview" data-id="${d.id}"></div>`;
  else if (d.kind === 'video' || d.kind === 'link') viewer = `<div class="viewer-page" style="aspect-ratio:16/9">${ic(d.kind === 'video' ? 'play' : 'link')}<div>${d.kind === 'video' ? '유튜브 영상' : '바깥 링크'}</div><a class="btn primary" href="${esc(d.url)}" target="_blank" rel="noopener">${d.kind === 'video' ? '유튜브에서 재생' : '링크 열기'}</a></div>`;
  else if (!DEMO && d.drive_id && online()) viewer = `<iframe src="https://drive.google.com/file/d/${esc(d.drive_id)}/preview" style="width:100%;aspect-ratio:1/1.3;border:0;display:block" allow="autoplay" title="${esc(d.name)}"></iframe>`;
  else if (v.data) viewer = `<img src="${v.data}" alt="${esc(d.name)}" style="display:block;width:100%">`;
  else if (off) viewer = `<div class="viewer-page"><span class="ftype ft-${k}">${lab}</span><div><b style="color:var(--ink)">${esc(d.name)}</b></div><div>폰에 저장된 파일입니다. 전파가 없어도<br>「파일 열기」를 누르면 휴대폰 앱(엑셀·한글 등)으로 엽니다.</div><button class="btn primary" data-act="docDownload" data-id="${d.id}">${ic('download')}파일 열기</button></div>`;
  else viewer = `<div class="viewer-page"><span class="ftype ft-${k}">${lab}</span><div><b style="color:var(--ink)">${esc(d.name)}</b></div><div>${DEMO ? '체험판에서는 드라이브 미리보기가 열리지 않습니다.<br>☆ 를 누르면 내 저장함에 넣고 폰에 저장된 예시 파일로 보기를 해 볼 수 있습니다.' : '오프라인이라 파일을 열 수 없습니다.<br>☆ 로 「내 저장함」에 넣어 둔 자료는 폰에 저장돼 전파가 없어도 열립니다.'}</div></div>`;
  const md = myData(); const where = favs().has(d.id) ? '내 저장함' + myPath(md, myPlace(md, d.id)).map(x => ' › ' + esc(x.name)).join('') : '';
  const offbar = off ? `<div class="offbar ok">${ic('phone')}<span>${where} · 폰에 저장됨 ${fmtSize(off.size)} · ${offView(d) ? '전파가 없어도 열립니다' : '전파가 없어도 「파일 열기」로 엽니다'}</span><button class="linkbtn" data-act="myDocMenu" data-id="${d.id}">폴더로 옮기기</button>${offView(d) && online() && d.drive_id && !DEMO ? `<button class="linkbtn" data-act="driveView" data-id="${d.id}">${S.driveView && S.driveView[d.id] ? '저장본으로 보기' : '드라이브에서 보기'}</button>` : ''}</div>`
    : busy ? `<div class="offbar">${ic('download')}<span>폰에 저장하는 중 ${Math.round((S.offBusy[d.id] || 0) * 100)}%</span></div>`
    : offOK(d) ? `<div class="offbar">${ic('phone')}<span>${favs().has(d.id) ? where + '에 있지만 아직 폰에 없습니다.' : '☆를 누르면 「내 저장함」에 모이고 폰에도 저장돼, 전파 없는 곳에서도 열립니다.'}</span><button class="btn sm" data-act="offSave" data-id="${d.id}">${ic('download')}${favs().has(d.id) ? '폰에 저장' : '내 저장함에 넣기'}</button></div>` : '';
  const body = `<div class="viewer">${viewer}</div>${offbar}
    <section class="hero" style="gap:12px"><dl class="kv">${d.size ? `<dt>크기</dt><dd>${fmtSize(d.size)}</dd>` : ''}<dt>올린 사람</dt><dd>${esc(personName(d.uploaded_by))}</dd><dt>올린 날</dt><dd>${fmtWhen(d.created_at)}</dd><dt>폴더</dt><dd>${esc(folderPathText(d.folder_id))}</dd>${d.store_no ? `<dt>저장소</dt><dd>${esc(d.store_no)}호</dd>` : ''}</dl>
      <div class="toolbar">${!DEMO && d.drive_id ? `<a class="btn sm" href="https://drive.google.com/file/d/${esc(d.drive_id)}/view" target="_blank" rel="noopener">${ic('eye')}크게 보기</a>` : ''}${d.kind === 'file' ? `<button class="btn sm" data-act="docDownload" data-id="${d.id}">${ic('download')}파일 받기</button>` : ''}${adm ? `<button class="btn sm" data-act="docRename" data-id="${d.id}" data-write>${ic('edit')}이름 변경</button><button class="btn sm" data-act="docMove" data-id="${d.id}" data-write>${ic('move')}이동</button><button class="btn sm danger" data-act="docDelete" data-id="${d.id}" data-write>${ic('trash')}삭제</button>` : ''}</div></section>
    ${commentsBlock('doc', d.id, v.cm)}`;
  const cr = crumbs([{ label: '자료', act: 'folder', data: { id: '' } }, ...pathOf(S.ix.folder, d.folder_id).map(p => ({ label: p.name, act: 'folder', data: { id: p.id } })), { label: d.name }]);
  const on = favs().has(d.id);
  const actions = `<button class="iconbtn fav ${on ? 'on' : ''}" data-act="fav" data-id="${d.id}" aria-label="${on ? '내 저장함에서 빼기' : '내 저장함에 넣기'}" aria-pressed="${on}">${ic(on ? 'starOn' : 'star')}</button>`;
  return { title: d.name, crumbs: cr, body, actions };
};

/* ───────── 스캔 ───────── */
VIEW['scan.scan'] = () => {
  const units = S.cache.locations.filter(l => l.code && l.kind !== 'zone');
  return { title: 'QR 스캔', body: `<div class="scanbox" id="scanbox"><video id="scanvid" playsinline muted hidden></video><div class="frame"></div><div class="msg" id="scanmsg">카메라를 켜는 중…</div></div>
    <p class="muted" style="margin:0;font-size:13.5px">캐비넷·선반에 붙은 QR 라벨을 네모 안에 맞추면 그 위치의 자재가 바로 열립니다.</p>
    <form class="toolbar" data-submit="codeGo"><div class="search grow">${ic('tag')}<input id="code-in" name="code" placeholder="라벨 코드 직접 입력 (예: WH-S1-상)" autocapitalize="characters" autocomplete="off" enterkeyhint="go" aria-label="라벨 코드"></div><button class="btn primary" style="min-height:50px">열기</button></form>
    ${DEMO ? `<section class="sec"><div class="sec-h"><h2>체험판 · 라벨 골라서 스캔 흉내</h2></div><div class="ledger">${units.map(l => `<button class="lrow" data-act="loc" data-id="${l.id}"><span class="tape">${esc(l.code)}</span><div class="main"><span class="s">${esc(locPathText(l.id))}</span></div><span class="chev">${ic('chev')}</span></button>`).join('')}</div></section>` : ''}` };
};

/* ───────── 알림 ───────── */
VIEW['alerts.list'] = () => {
  const list = vd().list;
  const icn = { signup: 'user', low: 'warn', comment: 'chat', welcome: 'check' };
  return { title: '알림', actions: list && list.some(n => !n.read_at) ? `<button class="btn sm" data-act="readAll" data-write>모두 읽음</button>` : '',
    body: `<div class="ledger">${!list ? loadingBox('bell') : list.length ? list.map(n => `<button class="lrow" data-act="notif" data-link="${esc(JSON.stringify(n.link || {}))}" style="${n.read_at ? '' : 'background:var(--accent-soft)'}"><span class="ic" style="${n.kind === 'low' ? 'color:var(--crit);background:var(--crit-soft)' : ''}">${ic(icn[n.kind] || 'bell')}</span><div class="main"><span class="t" style="font-weight:${n.read_at ? 500 : 700}">${esc(n.title)}</span><span class="s">${esc(n.body || '')} · ${fmtWhen(n.created_at)}</span></div></button>`).join('') : empty('bell', '새 알림이 없습니다.', '내 자재·자료에 댓글이 달리거나 재고가 부족해지면 여기에 쌓입니다.')}</div>
    <p class="muted" style="font-size:12.5px;margin:0">휴대폰 알림(푸시)은 2차 업데이트에서 켤 수 있게 됩니다. 아이폰은 홈 화면에 추가한 경우에만 됩니다.</p>` };
};

/* ───────── 더보기 / 관리 ───────── */
VIEW['more.menu'] = () => {
  const u = S.user; const adm = can(u, 'users'); const v = vd();
  const pending = (v.users || []).filter(p => p.status === 'pending').length;
  const st = v.st; const lampOk = st && lampState(st).every(x => x.ok);
  const row = (act, icon, t, s, end = '') => `<button class="lrow" data-act="${act}"><span class="ic">${ic(icon)}</span><div class="main"><span class="t">${t}</span>${s ? `<span class="s">${s}</span>` : ''}</div>${end}<span class="chev">${ic('chev')}</span></button>`;
  const body = `<section class="profile"><div class="avatar">${esc((u.name || '?').slice(0, 1))}</div>
      <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:17px">${esc(u.name)}</div><div class="muted" style="font-size:13.5px">사내번호 <span class="mono">${esc(u.emp_no)}</span> · ${ROLE_NAME[u.role]}</div></div>
      <button class="btn sm" data-act="go" data-v="me">내 정보</button></section>
    ${adm ? `<section class="sec"><div class="sec-h"><h2>관리</h2></div><div class="ledger menu">
      ${row('go" data-v="users', 'users', '직원 관리', '가입 승인 · 권한 · 비밀번호 초기화 · 퇴사자', pending ? `<span class="chip crit">승인 대기 ${pending}</span>` : '')}
      ${row('go" data-v="status', 'gauge', '시스템 상태', '자동 깨우기 · 백업 · 저장 용량', st ? `<span class="lamp ${lampOk ? '' : 'off'}" title="${lampOk ? '정상' : '확인 필요'}"></span>` : '')}
      ${row('go" data-v="log', 'list', '활동 기록', '누가 언제 무엇을 했는지 전부')}
      ${row('go" data-v="places', 'shelf', '위치 관리 · QR 라벨', '캐비넷·선반 추가, 사진, 라벨 인쇄')}
      ${row('go" data-v="cats', 'tag', '분류 관리', '도어 부품, 전장 부품 같은 자재 분류')}
      ${row('go" data-v="bulk', 'paste', '품목 대량 등록', '엑셀에서 복사해 한 번에 넣기')}
      ${row('stats', 'gauge', '사용 통계', '많이 나간 자재 · 현장별 사용량 · 최소 재고 추천')}
      ${row('poster', 'docs', '직원 안내문 인쇄', '앱 주소 QR과 쓰는 법을 A4 한 장에')}
      ${row('go" data-v="trash', 'trash', '휴지통', '지운 뒤 30일 안에 되살리기')}
      ${row('go" data-v="guide', 'book', '관리자 안내', '문제가 생겼을 때 할 일')}
    </div></section>` : ''}
    <section class="sec"><div class="sec-h"><h2>도움말</h2></div><div class="ledger menu">
      ${adm ? '' : row('go" data-v="guide', 'book', '사용 안내', '입고·출고·되돌리기·자료 올리기')}
      ${row('tour', 'info', '처음 안내 다시 보기', '꺼내기 · 되돌리기 · 자료 검색 (3장)')}
      ${isStandalone() ? '' : row('install', 'phone', '홈 화면에 앱 추가', '아이콘을 눌러 바로 열기')}
    </div></section>
    <section class="sec"><div class="sec-h"><h2>화면</h2></div><div class="ledger">
      <div class="lrow"><span class="ic">${ic(themeNow() === 'dark' ? 'moon' : themeNow() === 'light' ? 'sun' : 'contrast')}</span><div class="main"><span class="t">화면 모드</span><span class="s">자동은 휴대폰의 밝게·어둡게 설정을 따릅니다. 이 기기에만 저장됩니다.</span></div></div>
      <div class="themepick"><div class="seg block" role="group" aria-label="화면 모드">${[['auto', 'contrast', '자동'], ['light', 'sun', '밝게'], ['dark', 'moon', '어둡게']].map(([v, i, l]) => `<button data-act="theme" data-v="${v}" aria-pressed="${themeNow() === v}">${ic(i)}${l}</button>`).join('')}</div></div>
      <div class="lrow"><span class="ic">${ic('textsize')}</span><div class="main"><span class="t">글자 크기</span><span class="s">「크게」는 글자와 버튼을 모두 키웁니다. 이 기기에만 저장됩니다.</span></div></div>
      <div class="themepick"><div class="seg block" role="group" aria-label="글자 크기">${[['md', '보통'], ['lg', '크게']].map(([v, l]) => `<button data-act="size" data-v="${v}" aria-pressed="${sizeNow() === v}" ${v === 'lg' ? 'style="font-size:16px"' : ''}>가 ${l}</button>`).join('')}</div></div></div></section>
    ${Object.keys(offList()).length ? `<section class="sec"><div class="sec-h"><h2>폰에 저장한 자료</h2><span class="aside">이 기기</span></div><div class="ledger"><div class="lrow"><span class="ic">${ic('phone')}</span><div class="main"><span class="t">${Object.keys(offList()).length}개 · ${fmtSize(offTotal())}</span><span class="s">☆ 로 「내 저장함」에 넣은 자료는 폰에 저장돼 전파가 없어도 열립니다</span></div><button class="btn sm" data-act="docsMode" data-m="mine">내 저장함</button><button class="btn sm ghost" data-act="offClear">모두 지우기</button></div></div></section>` : ''}
    <section class="sec"><div class="sec-h"><h2>알림 창 설정</h2><span class="aside">이 기기에만 저장</span></div><div class="ledger">
      ${[['done', 'check', '저장 완료 알림', '「출고했습니다」처럼 저장한 뒤 아래에 잠깐 뜨는 알림'], ['undo', 'undo', '되돌리기 버튼', '입고·출고·이동 직후 8초 동안 뜨는 「되돌리기」'], ['install', 'phone', '홈 화면 추가 안내', '자재 첫 화면 맨 위의 파란 상자']].map(([k, i, t, s]) => `<label class="lrow" style="cursor:pointer"><span class="ic">${ic(i)}</span><div class="main"><span class="t">${t}</span><span class="s">${s}</span></div><input type="checkbox" class="switch" data-act="pref" data-k="${k}" ${pref(k) ? 'checked' : ''} aria-label="${t}"></label>`).join('')}</div>
      <p class="muted" style="font-size:12.5px;margin:0">저장 실패·연결 끊김 같은 빨간 알림은 꺼도 항상 뜹니다.</p></section>
    ${DEMO ? `<section class="sec"><div class="sec-h"><h2>체험판 설정</h2></div><div class="ledger">
      <label class="lrow" style="cursor:pointer"><span class="ic">${ic('wifioff')}</span><div class="main"><span class="t">오프라인 흉내</span><span class="s">켜면 인터넷이 끊긴 것처럼 저장이 막힙니다</span></div><input type="checkbox" class="switch" id="fake-off" data-act="fakeOff" ${S.fakeOffline ? 'checked' : ''} aria-label="오프라인 흉내"></label>
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
    <button class="btn primary big" data-write ${S.busy ? 'disabled' : ''}>바꾸기</button></form>
  <p class="muted" style="font-size:12.5px;margin:0;text-align:center">가야 자재·자료 · 화면 버전 ${esc(APP_VER)}</p>` });

VIEW['more.users'] = () => {
  const list = vd().list;
  if (!list) return { title: '직원 관리', crumbs: moreCr('직원 관리'), body: `<div class="ledger">${loadingBox('users')}</div>` };
  const pend = list.filter(p => p.status === 'pending'), act = list.filter(p => p.status === 'active'), off = list.filter(p => p.status === 'disabled');
  const sel = S.userSel || (S.userSel = new Set());
  const body = `<section class="sec"><div class="sec-h"><h2>가입 승인 대기</h2><span class="aside">${pend.length}명</span></div>
    ${pend.length ? `<div class="ledger">${pend.map(p => `<label class="lrow" style="cursor:pointer"><input type="checkbox" data-act="selUser" data-id="${p.id}" ${sel.has(p.id) ? 'checked' : ''} style="width:22px;height:22px;flex:none;accent-color:var(--accent)"><div class="main"><span class="t">${esc(p.name)}</span><span class="s">사내번호 <span class="mono">${esc(p.emp_no)}</span>${p.phone ? ' · ' + esc(p.phone) : ''} · ${fmtWhen(p.created_at)} 신청</span></div><button class="btn sm danger" data-act="rejectUser" data-id="${p.id}" data-write>거절</button></label>`).join('')}</div>
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
    <div class="ledger">${!list ? loadingBox() : list.length ? list.map(a => `<div class="log-row"><div class="a"><b>${esc(a.action)}</b> · ${esc(a.summary)}</div><div class="w">${fmtWhen(a.at)}</div><div class="muted" style="font-size:12.5px">${esc(a.actor_name)}</div></div>`).join('') : empty('list', '해당하는 기록이 없습니다.')}</div>
    <p class="muted" style="font-size:12.5px;margin:0">활동 기록은 누구도 고치거나 지울 수 없습니다. 매일 새벽 백업 파일(구글 드라이브 「가야앱 백업」 폴더)에도 함께 저장됩니다.</p>`;
  return { title: '활동 기록', crumbs: moreCr('활동 기록'), body };
};

function lampState(st) {
  const h = iso => iso ? (Date.now() - toDate(iso)) / 36e5 : 1e9;
  return [
    { k: '서버 깨우기 · 구글', at: st.last_ping, ok: h(st.last_ping) < 48, note: '매일 새벽 3시' },
    { k: '서버 깨우기 · GitHub', at: st.last_ping2, ok: h(st.last_ping2) < 48, note: '매일 오후 3시' },
    { k: '자동 백업', at: st.last_backup, ok: h(st.last_backup) < 48, note: st.backup_file || '' }
  ];
}
VIEW['more.status'] = () => {
  const st = vd().st;
  if (!st) return { title: '시스템 상태', crumbs: moreCr('시스템 상태'), body: `<div class="ledger">${loadingBox('gauge')}</div>` };
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
  const body = `<div class="toolbar"><button class="btn sm primary" data-act="locBulk" data-write>${ic('plus')}한 번에 만들기</button><button class="btn sm" data-act="locNew" data-write>${ic('plus')}구역 하나 추가</button><button class="btn sm" data-act="go" data-v="labels">${ic('qr')}QR 라벨 만들기</button></div>
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
  const body = `<details class="ledger" id="label-pick" ${S.labelsOpen ? 'open' : ''}><summary class="lrow" style="cursor:pointer"><span class="ic">${ic('check')}</span><div class="main"><span class="t">라벨 만들 위치 고르기</span><span class="s">${sel.size}곳 선택됨 · 눌러서 고르기</span></div><span class="chev">${ic('chev')}</span></summary>
      ${rows.map(({ n, depth }) => `<label class="lrow" style="padding-left:${16 + depth * 20}px;cursor:pointer"><input type="checkbox" data-act="selLabel" data-id="${n.id}" ${sel.has(n.id) ? 'checked' : ''} style="width:22px;height:22px;flex:none;accent-color:var(--accent)"><div class="main"><span class="t">${esc(n.name)}</span></div>${n.code ? `<span class="tape">${esc(n.code)}</span>` : ''}</label>`).join('')}</details>
    <div class="toolbar"><button class="btn primary" data-act="printLabels">${ic('docs')}인쇄</button><span class="muted" style="font-size:13px">A4에 인쇄해 잘라 붙이세요. 라벨지에 인쇄하면 더 오래갑니다.</span></div>
    ${DEMO ? `<div class="notice">${ic('info')}<span>체험판 화면에서는 인쇄 창이 열리지 않습니다. 실제 앱에서는 이 버튼으로 바로 인쇄됩니다.</span></div>` : ''}
    <p class="muted" style="font-size:12.5px;margin:0">화면에 보이는 QR은 같은 휴대폰으로 찍을 수 없으니, 라벨 아래 「열기」를 누르면 QR을 찍었을 때와 같은 위치 화면이 열립니다. 「열기」는 인쇄되지 않습니다.</p>
    <div class="labels" id="labels">${chosen.map(l => `<div class="qrlabel"><span class="lh">${logo('logo')}가야엘리베이터</span>${qrSvg(base + '?loc=' + encodeURIComponent(l.code || l.id))}<span class="code">${esc(l.code || l.name)}</span><span class="nm">${esc(locPathText(l.id))}</span><button class="btn sm qropen noprint" data-act="loc" data-id="${l.id}">${ic('box')}열기</button></div>`).join('')}</div>`;
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
  const body = `<div class="notice">${ic('info')}<span>「빈 양식 받기」로 받은 파일(또는 아래 순서대로 열을 만든 엑셀)에 품목을 채우고, 채운 칸을 드래그해 복사(Ctrl+C)한 뒤 아래 칸에 붙여 넣으세요(Ctrl+V). 제목 줄은 같이 복사해도 저절로 빠집니다. 분류와 위치 코드는 앱에 이미 있는 이름·코드와 같아야 연결됩니다.</span></div>
    <div class="toolbar"><button class="btn sm" data-act="bulkTemplate">${ic('download')}빈 양식 받기 (엑셀)</button><span class="muted" style="font-size:12.5px">열 순서가 맞춰진 빈 엑셀 파일입니다.</span></div>
    <div class="scrollx"><table class="tbl"><tr>${BULK_COLS.map(c => `<th>${c}</th>`).join('')}</tr><tr><td>도어 롤러</td><td>Ø50 행거용</td><td>현대엘리베이터</td><td>STVF</td><td>롤러·슈</td><td>개</td><td>6</td><td>WH-S1-상</td><td>12</td><td></td></tr></table></div>
    <details class="ledger"><summary class="lrow" style="cursor:pointer"><span class="ic">${ic('tag')}</span><div class="main"><span class="t">지금 앱에 있는 분류·위치 코드</span><span class="s">「분류」「위치 코드」 칸에 이 이름을 그대로 쓰세요</span></div><span class="chev">${ic('chev')}</span></summary>
      <div class="reflist"><b>분류</b><div>${S.cache.categories.map(c => `<span class="chip">${esc(c.name)}</span>`).join('') || '<span class="muted">없음</span>'}</div><b>위치 코드</b><div>${S.cache.locations.filter(l => l.code).map(l => `<span class="tape">${esc(l.code)}</span>`).join('') || '<span class="muted">없음</span>'}</div></div></details>
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
  return { title: '휴지통', crumbs: moreCr('휴지통'), body: `<div class="ledger">${!list ? loadingBox('trash') : list.length ? list.map(x => `<div class="lrow"><div class="main"><span class="t">${esc(x.name)}</span><span class="s">${nm[x.type]} · ${esc(x.where)} · ${fmtWhen(x.at)} 삭제</span></div><button class="btn sm" data-act="restore" data-type="${x.type}" data-id="${x.id}" data-write>${ic('restore')}되살리기</button></div>`).join('') : empty('trash', '휴지통이 비어 있습니다.')}</div>
    <p class="muted" style="font-size:12.5px;margin:0">지운 지 30일이 지나면 목록에서 사라집니다. 파일 실물은 구글 드라이브 휴지통 규칙을 따릅니다.</p>` };
};

VIEW['more.guide'] = () => {
  const adm = can(S.user, 'users');
  const body = `<article class="guide hero" style="gap:6px">
    <h3>자재 쓰는 법</h3><ol><li>가운데 <b>스캔</b>으로 선반 QR을 찍으면 그 선반의 자재가 열립니다. 쓸 자재 옆 <b>꺼내기</b>를 누르고 수량·현장만 맞추면 출고가 끝납니다.</li><li>자재 탭 검색창이나 위치별·분류별 목록으로 찾아 품목을 열고 <b>출고</b>를 눌러도 됩니다. 자주 쓰는 품목은 자재 첫 화면 「내가 자주 쓰는 품목」에 저절로 모입니다.</li><li>저장 직후 아래에 뜨는 <b>되돌리기</b>를 누르면 방금 기록이 취소됩니다.</li><li>꺼냈다가 안 쓰고 돌려놓으면 기록 옆의 <b>출고 취소 (안 씀)</b>를 누릅니다. 수량이 원래대로 돌아갑니다. 본인 기록은 7일 안에 취소할 수 있고, 그 뒤에는 관리자가 합니다.</li><li>새로 들어온 자재는 <b>입고</b>, 다른 캐비넷으로 옮길 때는 <b>이동</b>입니다.</li><li>지난 기록은 자재 첫 화면 위쪽 <b>입출고 기록</b>에서 달별로 보고, 현장 이름·품명·사람으로 찾을 수 있습니다.</li></ol>
    <h3>자료 쓰는 법</h3><ol><li>자료 탭에서 폴더를 열고 <b>올리기</b>로 PDF·엑셀·사진을 그대로 올립니다.</li><li>검색창에 에러코드나 부품명을 치면 파일 안의 글자까지 찾아 줍니다.</li><li>교육 영상은 유튜브에 「일부 공개」로 올린 뒤 <b>영상·링크</b>로 주소만 등록합니다.</li><li>자주 보는 자료는 파일 화면 오른쪽 위 <b>☆</b>를 누르면 자료 탭의 <b>「내 저장함」</b>에 모이고 폰에도 저장됩니다. 전파가 없는 기계실·피트에서도 열리고, 내 폴더를 만들어 정리할 수 있습니다(이 휴대폰에만 저장).</li><li>지난 입출고는 자재 첫 화면 위쪽 바로가기 <b>「입출고 기록」</b>에서, 현장마다 쓴 자재는 <b>「현장별 이력」</b>에서 봅니다.</li></ol>
    ${adm ? `<h3>가입 승인과 퇴사자</h3><ol><li>더보기 › 직원 관리에서 이름·사내번호를 확인하고 승인합니다.</li><li>비밀번호를 잊은 직원은 이름을 눌러 <b>비밀번호 초기화</b> → 화면에 뜬 임시 번호를 알려 주고, 로그인 뒤 본인이 바꾸게 합니다.</li><li>퇴사자는 지우지 않고 <b>사용 중지</b>합니다. 그 사람이 남긴 입출고 기록은 그대로 남습니다.</li></ol>
    <h3>위치 추가와 QR 라벨</h3><ol><li>더보기 › 위치 관리에서 캐비넷·선반을 추가하고 짧은 코드(예: WH-S5)를 붙입니다.</li><li>QR 라벨 만들기 → 인쇄 → 선반에 붙입니다. 앱의 <b>스캔</b> 탭으로 찍으면 그 선반 화면이 바로 열립니다. (안드로이드는 폰 기본 카메라로 찍어도 열립니다. 아이폰은 기본 카메라로 찍으면 사파리에서 열려 로그인을 따로 해야 하니 앱의 스캔 탭을 쓰세요.)</li></ol>
    <h3>빨간 불이 켜졌을 때 (시스템 상태)</h3><ol><li>직원들이 앱을 평소처럼 쓰고 있다면 급한 일은 아닙니다. 앱을 쓰는 것만으로도 서버는 깨어 있습니다.</li><li>회사용 구글 계정(gaya.elevator.app)에 로그인해 보안 경고나 계정 잠김 안내가 있는지 봅니다.</li><li>그래도 계속 빨간 불이면 개발자(재석)에게 연락합니다.</li><li>앱이 아예 열리지 않고 「서버가 쉬고 있습니다」라고 나오면: supabase.com 에 소유자 계정으로 로그인 → 가야엘리베이터 조직 › gaya-app 프로젝트 → <b>Resume project</b> 를 누르고 몇 분 기다립니다. 멈춘 뒤 1년 안이면 데이터는 그대로입니다.</li></ol>
    <h3>재고 부족 알리기와 기록 받기</h3><ol><li>자재 첫 화면 「재고 부족」의 <b>목록 보내기</b>를 누르면 부족한 품목 목록을 카톡 등으로 바로 보낼 수 있습니다.</li><li>입출고 기록 화면 오른쪽 위 <b>엑셀</b>을 누르면 그 달 기록(검색·종류로 거른 그대로)이 엑셀 파일로 받아집니다.</li><li>자재 첫 화면 바로가기 <b>「발주·입고」</b>: 부족한 만큼 미리 채운 발주 목록을 거래처에 보내고, 자재가 들어오면 「한 번에 입고」로 체크한 품목을 위치별로 한꺼번에 넣습니다.</li></ol>
    <h3>저장 용량 80% 경고</h3><p>개발자(재석)에게 연락합니다. 구글 원 구독(100GB 월 2,400원) 또는 무료 구글 계정 추가 중에서 고르면 되고, 어느 쪽이든 앱은 그대로 씁니다.</p>
    <h3>매년 1월에 할 일</h3><p>회사용 구글 계정(gaya.elevator.app)에 한 번 로그인해 드라이브의 「가야앱 백업」 폴더를 열어 봅니다. 구글은 2년 동안 쓰지 않은 계정을 지우기 때문에, 사람이 1년에 한 번 들어가 두는 것입니다.</p>
    <h3>앱이 업데이트되면</h3><p>개발자가 고친 내용은 올리는 즉시 반영됩니다. 직원 폰에서 예전 화면이 보이면 앱을 완전히 닫았다가 다시 열면 됩니다.</p>` : ''}
  </article>`;
  return { title: adm ? '관리자 안내' : '사용 안내', crumbs: moreCr(adm ? '관리자 안내' : '사용 안내'), body };
};

/* ───────── 사용 통계 · 최소 재고 추천 (관리자) ───────── */
function statsData(list, month) {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(y, m - 1, 1), from3 = new Date(y, m - 3, 1), end = new Date(y, m, 1);
  const live = t => !t.canceled_by;
  const cur = list.filter(t => toDate(t.created_at) >= start);
  const outs = cur.filter(t => t.type === 'out' && live(t)), ins = cur.filter(t => t.type === 'in' && live(t));
  const agg = (rows, key) => { const g = new Map(); rows.forEach(t => { const k = key(t); if (!k) return; const x = g.get(k) || { q: 0, n: 0 }; x.q += t.qty; x.n++; g.set(k, x); }); return g; };
  const top = [...agg(outs, t => S.ix.item.has(t.item_id) ? t.item_id : null)].sort((a, b) => b[1].q - a[1].q).slice(0, 10);
  const sites = [...agg(outs, t => t.site ? parseSite(t.site).name || t.site : null)].sort((a, b) => b[1].n - a[1].n || b[1].q - a[1].q).slice(0, 10);
  const outs3 = list.filter(t => t.type === 'out' && live(t));
  const first = outs3.length ? Math.min(...outs3.map(t => +toDate(t.created_at))) : +end;
  const until = Math.min(Date.now(), +end);
  const months = Math.max(1, Math.min(3, (until - Math.max(+from3, first)) / (30.44 * 864e5)));
  const recs = [...agg(outs3, t => S.ix.item.has(t.item_id) ? t.item_id : null)].map(([id, x]) => { const it = S.ix.item.get(id); const avg = x.q / months; return { id, q: x.q, avg, rec: Math.max(1, Math.ceil(avg)), cur: it.min_qty }; })
    .filter(x => x.rec !== x.cur).sort((a, b) => b.q - a.q);
  return { outs: outs.length, outQty: outs.reduce((a, t) => a + t.qty, 0), ins: ins.length, top, sites, recs, months, short: until - first < 60 * 864e5 };
}
const barRow = (act, data, label, sub, val, ratio) => `<button class="barrow" data-act="${act}" ${data}><span class="bl"><span class="t">${label}</span>${sub ? `<span class="s">${sub}</span>` : ''}</span><span class="bv">${val}</span><span class="bar"><i style="width:${Math.max(2, Math.round(ratio * 100))}%"></i></span></button>`;
VIEW['more.stats'] = r => {
  const v = vd(); const isNow = r.month >= thisMonth();
  const mb = `<div class="monthbar"><button class="iconbtn" data-act="statsMonth" data-d="-1" aria-label="이전 달">${ic('back')}</button><b>${monthLabel(r.month)}</b><button class="iconbtn" data-act="statsMonth" data-d="1" aria-label="다음 달" ${isNow ? 'disabled' : ''}>${ic('chev')}</button></div>`;
  if (!v.top) return { title: '사용 통계', crumbs: moreCr('사용 통계'), body: mb + `<div class="ledger">${loadingBox('gauge')}</div>` };
  const maxQ = v.top.length ? v.top[0][1].q : 1, maxN = v.sites.length ? Math.max(...v.sites.map(x => x[1].n)) : 1;
  const off = S.minOff || new Set(); const pick = v.recs.filter(x => !off.has(x.id)).length;
  const body = `${mb}
    <div class="stats"><div class="stile"><span class="k">${ic('out')}출고</span><span class="v">${v.outs}<small>건</small></span></div><div class="stile"><span class="k">${ic('in')}입고</span><span class="v">${v.ins}<small>건</small></span></div><div class="stile"><span class="k">${ic('pin')}현장</span><span class="v">${v.sites.length}<small>곳</small></span></div></div>
    <section class="sec"><div class="sec-h"><h2>많이 나간 자재</h2><span class="aside">출고 수량 순 · 취소 뺌</span></div><div class="ledger bars">${v.top.map(([id, x]) => { const it = S.ix.item.get(id); return barRow('item', `data-id="${id}"`, esc(itemTitle(it)), '', `${x.q}${esc(it.unit)} <small>${x.n}건</small>`, x.q / maxQ); }).join('') || empty('gauge', '이 달에는 출고가 없습니다.')}</div></section>
    <section class="sec"><div class="sec-h"><h2>현장별 출고</h2><span class="aside">건수 순</span></div><div class="ledger bars">${v.sites.map(([nm, x]) => barRow('site', `data-v="${esc(nm)}"`, esc(nm), '', `${x.n}건 <small>${x.q}개</small>`, x.n / maxN)).join('') || empty('pin', '현장을 적은 출고가 없습니다.')}</div></section>
    ${isNow ? `<section class="sec"><div class="sec-h"><h2>최소 재고 추천</h2><span class="aside">최근 3개월 기준</span></div>
      <div class="notice">${ic('info')}<span>한 달 평균으로 나간 만큼을 최소 재고로 두면, 「부족」 표시가 뜬 뒤 다시 채울 때까지 한 달쯤 버틸 수 있습니다. 바꾸고 싶은 품목만 체크해서 반영하세요.${v.short ? ' <b>기록이 두 달이 안 돼 추천이 실제보다 낮거나 높을 수 있습니다.</b>' : ''}</span></div>
      <div class="ledger">${v.recs.map(x => { const it = S.ix.item.get(x.id); return `<label class="crow ${off.has(x.id) ? 'off' : ''}"><input type="checkbox" data-act="minToggle" data-id="${x.id}" ${off.has(x.id) ? '' : 'checked'} aria-label="반영"><div class="main"><span class="t">${esc(itemTitle(it))}</span><span class="s">3개월 출고 ${x.q}${esc(it.unit)} · 한 달 평균 ${Math.round(x.avg * 10) / 10}${esc(it.unit)}</span></div><span class="recv"><span class="muted">${x.cur}</span> → <b>${x.rec}</b></span></label>`; }).join('') || empty('check', '지금 최소 재고가 사용량과 맞습니다.', '바꿀 만한 품목이 없습니다.')}</div>
      ${v.recs.length ? `<button class="btn primary block big" data-act="minApply" data-write ${pick ? '' : 'disabled'}>선택한 ${pick}개 반영</button>` : ''}</section>` : ''}`;
  return { title: '사용 통계', crumbs: moreCr('사용 통계'), body };
};

/* ───────── 직원 안내문 (A4 한 장, 인쇄·PDF) ───────── */
function posterHtml(url, admins) {
  const st = (n, t, b) => `<li><span class="n">${n}</span><div><b>${t}</b><p>${b}</p></div></li>`;
  return `<div class="ps-head">${logo('logo')}<div><div class="ps-brand">(주)가야엘리베이터</div><div class="ps-title">자재·자료 앱 사용 안내</div></div></div>
    <div class="ps-qr">${qrSvg(url)}<div><b>휴대폰 카메라로 QR을 찍으세요</b><span class="ps-url">${esc(url)}</span><a class="ps-btn" href="${esc(url)}" target="_blank" rel="noopener">휴대폰으로 보고 있다면 여기를 누르세요 ›</a><span>아이폰은 사파리, 안드로이드는 크롬에서 열립니다</span></div></div>
    <ol class="ps-steps">
      ${st(1, '가입 신청', '첫 화면 「가입 신청」에서 사내번호·이름·비밀번호를 적습니다. 관리자가 승인하면 바로 씁니다.')}
      ${st(2, '홈 화면에 추가', '아이폰: 아래 공유 버튼 → 「홈 화면에 추가」<br>안드로이드: ⋮ 메뉴 → 「홈 화면에 추가」 또는 「앱 설치」')}
      ${st(3, '자재 꺼내기', '가운데 「스캔」으로 선반 QR을 찍고, 쓸 자재 옆 「꺼내기」 → 수량·현장(동·호기) → 출고')}
      ${st(4, '여러 개를 꺼낼 때', '「담기」로 모은 뒤 「한 번에 출고」. 현장은 한 번만 적으면 됩니다.')}
      ${st(5, '잘못 눌렀으면', '저장 직후 뜨는 「되돌리기」. 꺼냈다가 안 쓴 자재는 기록의 「출고 취소 (안 씀)」')}
      ${st(6, '자료 찾기', '자료 탭 검색에 에러코드·부품명 (ㄷㅇㄹㄹ처럼 초성도 됨). ☆ 를 누르면 「내 저장함」에 모이고 전파 없는 기계실에서도 열립니다.')}
    </ol>
    <div class="ps-foot">비밀번호를 잊었거나 궁금한 점은 ${admins.length ? '관리자(' + esc(admins.join(', ')) + ')' : '관리자'}에게 · 앱 안 더보기 › 사용 안내</div>`;
}
VIEW['more.poster'] = () => {
  const url = CONFIG.APP_URL || (DEMO ? 'https://gaya-elevator.github.io/' : location.origin + location.pathname);
  const admins = S.cache.people.filter(p => p.role === 'admin' && p.status === 'active').map(p => p.name);
  const body = `<div class="toolbar"><button class="btn primary" data-act="printPoster">${ic('docs')}인쇄</button><button class="btn" data-act="shareApp">${ic('share')}앱 주소 보내기</button></div>
    <p class="muted" style="font-size:13px;margin:0">A4 한 장 · 인쇄 창에서 「PDF로 저장」도 됩니다. 사무실·창고에 붙여 두세요. 휴대폰으로 보는 사람은 화면의 QR을 찍을 수 없으니 「앱 주소 보내기」로 카톡에 링크를 보내 주세요. 안내문 PDF 안의 「여기를 누르세요」도 눌러서 열립니다.</p>
    <div class="posterwrap"><div id="poster" class="poster">${posterHtml(url, admins)}</div></div>`;
  return { title: '직원 안내문', crumbs: moreCr('직원 안내문'), body };
};

/* ───────── 아래에서 올라오는 입력 시트 ───────── */
function openSheet(type, d = {}) { S.sheet = { type, d: { op_id: opId(), ...d }, err: '' }; S.sheetFocused = false; ensureTrap(); render(); }
const stepper = (k, v) => `<div class="stepper"><button type="button" data-act="step" data-k="${k}" data-d="-1" aria-label="하나 빼기">−</button><input id="sh-${k}" inputmode="numeric" pattern="[0-9]*" data-bind="${k}" value="${esc(v)}" aria-label="수량" autocomplete="off"><button type="button" data-act="step" data-k="${k}" data-d="1" aria-label="하나 더하기">+</button></div>`;
function locPicker(k, sel, { onlyWith, qtyOf, exclude } = {}) {
  const rows = flatTree(S.ix.locKids).filter(({ n }) => (!onlyWith || onlyWith.has(n.id)) && n.id !== exclude);
  if (!rows.length) return `<div class="notice">${ic('info')}<span>${onlyWith ? '재고가 있는 위치가 없습니다.' : '고를 수 있는 위치가 없습니다. 관리자가 더보기 › 위치 관리에서 먼저 위치를 만들어야 합니다.'}</span></div>`;
  return `<div class="pickgrid" role="listbox">${rows.map(({ n, depth }) => `<button type="button" class="pick" data-act="pick" data-k="${k}" data-v="${n.id}" aria-pressed="${sel === n.id}" style="padding-left:${14 + (onlyWith ? 0 : depth * 16)}px">
    <div class="main"><span>${esc(onlyWith ? locPathText(n.id) : n.name)}</span>${n.code ? `<span class="s"><span class="tape">${esc(n.code)}</span></span>` : ''}</div>${qtyOf ? `<span class="qty">${qtyOf(n.id)}</span>` : ''}</button>`).join('')}</div>`;
}
const sheetHead = (t, sub = '') => `<div class="sheet-h"><h3 id="sheet-t">${esc(t)}</h3><button class="iconbtn" data-act="sheetClose" aria-label="닫기">${ic('x')}</button></div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
const sheetErr = () => S.sheet.err ? `<div class="notice crit" role="alert">${ic('warn')}<span>${esc(S.sheet.err)}</span></div>` : '';
const okBtn = (label, cls = 'primary') => `<button class="btn ${cls} block big" data-act="sheetOk" data-write ${S.busy ? 'disabled' : ''}>${S.busy ? '저장하는 중…' : esc(label)}</button>`;
function folderPicker(k, sel, exclude, allowTop = true) {
  const rows = flatTree(S.ix.folderKids).filter(({ n }) => !exclude || !pathOf(S.ix.folder, n.id).some(p => p.id === exclude));
  return `<div class="pickgrid">${allowTop ? `<button type="button" class="pick" data-act="pick" data-k="${k}" data-v="" aria-pressed="${!sel}"><div class="main"><span>자료 (맨 위)</span></div></button>` : ''}${rows.map(({ n, depth }) => `<button type="button" class="pick" data-act="pick" data-k="${k}" data-v="${n.id}" aria-pressed="${sel === n.id}" style="padding-left:${14 + depth * 16}px"><span class="folder-ic" style="width:24px;height:24px">${ic('folder')}</span><div class="main"><span>${esc(n.name)}</span></div></button>`).join('')}</div>`;
}
/* 입고할 품목 고르기: 목록 칸만 바꿔 그려 검색칸의 한글 입력이 끊기지 않게 한다 */
function inPickList(q) {
  q = (q || '').trim().toLowerCase();
  const list = S.cache.items.filter(i => !q || smatch([i.name, i.spec, i.maker, i.models].join(' '), q)).slice(0, 60);
  return list.map(i => `<button type="button" class="pick" data-act="pick" data-k="item_id" data-v="${i.id}"><div class="main"><span>${esc(itemTitle(i))}</span><span class="s">${esc(i.maker || '')}</span></div><span class="qty">${total(i.id)}<small>${esc(i.unit)}</small></span></button>`).join('') || `<div class="empty">찾는 품목이 없습니다. 새 품목은 관리자가 등록합니다.</div>`;
}
function updateSheetPart() {
  if (!S.sheet) return render();
  const t = S.sheet.type, el = t === 'in' ? $('#iq-list') : t === 'locBulk' ? $('#lb-prev') : null;
  if (!el) return render();
  el.innerHTML = t === 'in' ? inPickList(S.sheet.d.iq) : locBulkPreview(S.sheet.d);
}
/* 현장 + 동 + 호기 칸 (출고·한 번에 출고 공용) */
function siteFields(d) {
  return `<div class="field"><label for="sh-site">현장 (선택)</label><div class="siterow"><input id="sh-site" data-bind="site" list="sites" value="${esc(d.site || '')}" placeholder="예: 한빛아파트" autocomplete="off" enterkeyhint="next"><div class="unitin"><input id="sh-dong" data-bind="dong" value="${esc(d.dong || '')}" inputmode="numeric" placeholder="103" autocomplete="off" enterkeyhint="next" aria-label="동"><span>동</span></div><div class="unitin ho"><input id="sh-ho" data-bind="ho" value="${esc(d.ho || '')}" inputmode="numeric" placeholder="2" autocomplete="off" enterkeyhint="done" aria-label="호기"><span>호기</span></div></div>
    <datalist id="sites">${siteNames().map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    ${(S.mySites || []).length ? `<div class="sitechips"><span>최근</span>${S.mySites.slice(0, 4).map(x => `<button type="button" class="fchip sm" data-act="pickSite" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}</div>`;
}

function sheetView() {
  const s = S.sheet, d = s.d; let h = '';
  const it = d.item_id ? S.ix.item.get(d.item_id) : null;
  const unit = it ? it.unit : '개';
  const stockAt = id => ((S.ix.byItem.get(d.item_id) || []).find(x => x.location_id === id) || {}).qty || 0;
  const withStock = () => new Set((S.ix.byItem.get(d.item_id) || []).filter(x => x.qty > 0).map(x => x.location_id));
  const qn = isInt(d.qty) ? +d.qty : 0;
  switch (s.type) {
    case 'in':
      if (!it) {
        h = sheetHead('입고할 품목 고르기', esc(locPathText(d.location_id)) + '에 넣을 품목') + `<div class="search">${ic('search')}<input id="sh-iq" data-bind="iq" data-live value="${esc(d.iq || '')}" placeholder="품명·규격 검색" autocomplete="off" data-autofocus></div>
          <div class="pickgrid" style="max-height:calc(50vh / var(--z,1))" id="iq-list">${inPickList(d.iq)}</div>`;
        break;
      }
      h = sheetHead('입고', esc(itemTitle(it))) + `<div class="field"><span class="lab">넣을 위치</span>${locPicker('location_id', d.location_id, { qtyOf: stockAt })}</div>
        <div class="field"><span class="lab">수량 (${esc(unit)})</span>${stepper('qty', d.qty)}</div>
        <div class="field"><label for="sh-note">메모 (선택)</label><input id="sh-note" data-bind="note" value="${esc(d.note || '')}" placeholder="예: 거래처 입고, 정기 발주분"></div>
        ${sheetErr()}${okBtn('입고 ' + qn + unit, 'in')}`;
      break;
    case 'out':
      h = sheetHead('출고', esc(itemTitle(it))) + `<div class="field"><span class="lab">꺼내는 위치</span>${d.quick && d.location_id ? `<div class="fixedloc"><span class="tape">${esc(locCode(d.location_id))}</span><span class="p">${esc(locPathText(d.location_id))}</span><button type="button" class="btn sm ghost" data-act="outFull">바꾸기</button></div>` : locPicker('location_id', d.location_id, { onlyWith: withStock(), qtyOf: stockAt })}</div>
        <div class="field"><span class="lab">수량 (${esc(unit)})${d.location_id ? ' · 이 위치에 ' + stockAt(d.location_id) + esc(unit) : ''}</span>${stepper('qty', d.qty)}</div>
        ${siteFields(d)}
        <div class="field"><label for="sh-note">메모 (선택)</label><input id="sh-note" data-bind="note" value="${esc(d.note || '')}"></div>
        ${sheetErr()}${cart().length ? `<div class="notice">${ic('box')}<span>담은 자재 <b>${cart().length}가지</b>가 있습니다. 이것도 「담기」 하면 현장을 한 번만 적고 한 번에 출고합니다.</span></div>` : ''}
        <div class="outbtns"><button class="btn big" data-act="cartAdd" data-write ${S.busy ? 'disabled' : ''}>${ic('plus')}담기</button>${okBtn('출고 ' + qn + unit, 'out')}</div>
        <p class="muted" style="margin:0;font-size:12.5px">여러 자재를 꺼낼 때는 「담기」로 모아 한 번에 출고하세요. 꺼냈다가 안 쓰면 기록에서 「출고 취소 (안 씀)」를 누르면 수량이 돌아옵니다.</p>`;
      break;
    case 'move':
      h = sheetHead('이동', esc(itemTitle(it))) + `<div class="field"><span class="lab">보내는 위치</span>${locPicker('from', d.from, { onlyWith: withStock(), qtyOf: stockAt })}</div>
        <div class="field"><span class="lab">받는 위치</span>${locPicker('to', d.to, { qtyOf: stockAt, exclude: d.from })}</div>
        <div class="field"><span class="lab">수량 (${esc(unit)})${d.from ? ' · 보내는 위치에 ' + stockAt(d.from) + esc(unit) : ''}</span>${stepper('qty', d.qty)}</div>
        <div class="field"><label for="sh-note">메모 (선택)</label><input id="sh-note" data-bind="note" value="${esc(d.note || '')}" placeholder="예: 당직 차량용"></div>
        ${sheetErr()}${okBtn('이동 ' + qn + unit)}`;
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
        <div class="field"><label for="sh-min">최소 재고</label><input id="sh-min" data-bind="min_qty" inputmode="numeric" pattern="[0-9]*" value="${esc(d.min_qty ?? '')}" placeholder="0"><span class="hint">이보다 적으면 「부족」 표시</span></div></div>
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
        <div class="field"><label for="sh-code">라벨 코드</label><input id="sh-code" data-bind="code" value="${esc(d.code || '')}" placeholder="예: WH-S5" autocapitalize="characters" autocomplete="off"><span class="hint">QR 라벨에 크게 찍히는 짧은 이름입니다. 겹치지 않게 정하세요.</span></div>
        <div class="field"><span class="lab">사진 (선택)</span><div class="toolbar"><div class="photo" style="width:68px;height:68px">${d.photo ? `<img src="${esc(d.photo)}" alt="">` : ic('shelf')}</div><button type="button" class="btn sm" data-act="sheetPhoto">${ic('cam')}${d.photo ? '사진 바꾸기' : '사진 찍기'}</button></div></div>
        ${sheetErr()}${okBtn(d.id ? '저장' : '추가')}
        ${d.id ? `<button class="btn danger block" data-act="locDelete" data-id="${d.id}" data-write>${ic('trash')}위치 삭제</button>` : ''}`;
      break;
    case 'cat':
      h = sheetHead(d.id ? '분류 수정' : (d.parent_id ? (S.ix.cat.get(d.parent_id) || {}).name + ' 하위 분류 추가' : '분류 추가')) + `<div class="field"><label for="sh-cname">이름</label><input id="sh-cname" data-bind="name" value="${esc(d.name || '')}" data-autofocus></div>${sheetErr()}${okBtn(d.id ? '저장' : '추가')}${d.id ? `<button class="btn danger block" data-act="catDelete" data-id="${d.id}" data-write>${ic('trash')}분류 삭제</button>` : ''}`;
      break;
    case 'mkdir':
      h = sheetHead('폴더 만들기', esc(d.parent_id ? folderPathText(d.parent_id) : '자료') + ' 안에') + `<div class="field"><label for="sh-fname">폴더 이름</label><input id="sh-fname" data-bind="name" value="${esc(d.name || '')}" placeholder="예: 현대 STVF" data-autofocus></div>
        <label class="notice check"><input type="checkbox" data-bind="auto_sort" ${d.auto_sort ? 'checked' : ''}><span><b>날짜별 자동 정리</b> · 업무일지처럼 매달 쌓이는 자료라면 켜세요. 올릴 때 연도 › 월 폴더가 저절로 생깁니다.</span></label>
        ${sheetErr()}${okBtn('만들기')}`;
      break;
    case 'rename':
      h = sheetHead(d.kind === 'folder' ? '폴더 이름 변경' : '파일 이름 변경') + `<div class="field"><label for="sh-rn">새 이름</label><input id="sh-rn" data-bind="name" value="${esc(d.name || '')}" data-autofocus></div>${sheetErr()}${okBtn('저장')}`;
      break;
    case 'moveTo':
      h = sheetHead(d.kind === 'folder' ? '폴더 옮기기' : '파일 옮기기', '옮길 곳을 고르세요') + folderPicker('target', d.target, d.kind === 'folder' ? d.id : null, d.kind === 'folder') + sheetErr() + okBtn('여기로 옮기기');
      break;
    case 'link':
      h = sheetHead('영상·링크 등록', esc(folderPathText(d.folder_id))) + `<div class="field"><label for="sh-lt">제목</label><input id="sh-lt" data-bind="name" value="${esc(d.name || '')}" placeholder="예: 피트 작업 추락 방지 요령" data-autofocus></div>
        <div class="field"><label for="sh-url">주소</label><input id="sh-url" data-bind="url" value="${esc(d.url || '')}" inputmode="url" autocapitalize="off" autocomplete="off" placeholder="https://youtu.be/..."><span class="hint">교육 영상은 유튜브에 「일부 공개」로 올린 뒤 주소를 붙여 넣으세요. 드라이브 용량을 쓰지 않습니다.</span></div>
        ${sheetErr()}${okBtn('등록')}`;
      break;
    case 'folderMenu': {
      const f = S.ix.folder.get(d.id); if (!f) { S.sheet = null; return ''; }
      h = sheetHead(f.name, '폴더 관리 (관리자)') + `<div class="ledger"><button class="lrow" data-act="folderRename" data-id="${f.id}" data-write><span class="ic">${ic('edit')}</span><div class="main"><span class="t">이름 변경</span></div></button><button class="lrow" data-act="folderMove" data-id="${f.id}" data-write><span class="ic">${ic('move')}</span><div class="main"><span class="t">다른 폴더로 옮기기</span></div></button><button class="lrow" data-act="folderDelete" data-id="${f.id}" data-write><span class="ic" style="color:var(--crit);background:var(--crit-soft)">${ic('trash')}</span><div class="main"><span class="t" style="color:var(--crit)">폴더 삭제</span><span class="s">안의 폴더·파일도 함께 휴지통으로 갑니다</span></div></button></div>`;
      break;
    }
    case 'confirm':
      h = sheetHead(d.title) + `<p style="margin:0;overflow-wrap:anywhere">${esc(d.msg)}</p>${sheetErr()}<div class="row2"><button class="btn big" data-act="sheetClose">그만두기</button><button class="btn big ${d.danger ? 'danger' : 'primary'}" data-act="sheetOk" data-write ${S.busy ? 'disabled' : ''}>${esc(d.ok || '확인')}</button></div>`;
      break;
    case 'userMenu': {
      const p = (vd().list || []).find(x => x.id === d.id); if (!p) return '';
      const roles = can(S.user, 'setDev') ? ['staff', 'admin', 'dev'] : ['staff', 'admin'];
      h = sheetHead(p.name, '사내번호 ' + esc(p.emp_no) + ' · ' + ROLE_NAME[p.role]) + (p.id === S.user.id ? `<div class="notice">${ic('info')}<span>본인 계정은 여기서 바꿀 수 없습니다. 비밀번호는 더보기 › 내 정보에서 바꾸세요.</span></div>` : `
        <div class="field"><span class="lab">권한</span><div class="seg" role="group">${roles.map(r => `<button data-act="setRole" data-id="${p.id}" data-role="${r}" aria-pressed="${p.role === r}" data-write ${p.role === 'dev' && !can(S.user, 'setDev') ? 'disabled' : ''}>${ROLE_NAME[r]}</button>`).join('')}</div><span class="hint">관리자는 품목·위치·폴더 관리와 직원 승인을 할 수 있습니다.</span></div>
        <div class="ledger"><button class="lrow" data-act="resetPw" data-id="${p.id}" data-write ${p.role === 'dev' && !can(S.user, 'setDev') ? 'disabled' : ''}><span class="ic">${ic('key')}</span><div class="main"><span class="t">비밀번호 초기화</span><span class="s">임시 비밀번호 6자리를 만들어 보여 줍니다</span></div></button>
        <button class="lrow" data-act="disableUser" data-id="${p.id}" data-write><span class="ic" style="color:var(--crit);background:var(--crit-soft)">${ic('logout')}</span><div class="main"><span class="t" style="color:var(--crit)">사용 중지 (퇴사)</span><span class="s">로그인만 막고, 남긴 기록은 그대로 둡니다</span></div></button></div>`) + sheetErr();
      break;
    }
    case 'tempPw':
      h = sheetHead('임시 비밀번호') + `<p style="margin:0">${esc(d.name)}님에게 아래 번호를 알려 주세요. 로그인한 뒤 더보기 › 내 정보에서 바로 바꾸도록 안내하세요.</p><div class="total" style="justify-content:center;border:0;padding:0"><span class="big mono" style="letter-spacing:.12em">${esc(d.pw)}</span></div><button class="btn block" data-act="copyPw" data-pw="${esc(d.pw)}">번호 복사</button><button class="btn primary block big" data-act="sheetClose">확인</button>`;
      break;
    case 'cart': {
      const rows = cart(); const sq = (r, i) => d['cq_' + i] ?? String(r.qty);
      h = sheetHead('한 번에 출고', `담은 자재 ${rows.length}가지 · 현장은 한 번만 적으면 됩니다`)
        + `<div class="ledger cartlist">${rows.map((r, i) => { const it = S.ix.item.get(r.item_id); const have = ((S.ix.byItem.get(r.item_id) || []).find(x => x.location_id === r.location_id) || {}).qty || 0;
          return `<div class="crow ${isInt(sq(r, i), 1) && +sq(r, i) <= have ? '' : 'bad'}"><div class="main"><span class="t">${esc(itemTitle(it))}</span><span class="s"><span class="tape">${esc(locCode(r.location_id))}</span> 이 위치에 ${have}${esc(it ? it.unit : '')}</span></div>
            <div class="ministep"><button type="button" data-act="cartStep" data-i="${i}" data-d="-1" aria-label="하나 빼기">−</button><input id="cq-${i}" data-bind="cq_${i}" inputmode="numeric" value="${esc(sq(r, i))}" aria-label="수량" autocomplete="off"><button type="button" data-act="cartStep" data-i="${i}" data-d="1" aria-label="하나 더하기">+</button></div>
            <button type="button" class="iconbtn" data-act="cartDel" data-i="${i}" aria-label="빼기">${ic('x')}</button></div>`; }).join('') || empty('box', '담은 자재가 없습니다.')}</div>
          ${siteFields(d)}
          <div class="field"><label for="sh-note">메모 (선택)</label><input id="sh-note" data-bind="note" value="${esc(d.note || '')}"></div>
          ${sheetErr()}<div class="row2"><button class="btn big ghost" data-act="cartClear">비우기</button>${okBtn('출고 ' + rows.length + '가지', 'out')}</div>`;
      break;
    }
    case 'locBulk': {
      const zones = S.ix.locKids.get(null) || [];
      h = sheetHead('위치 한 번에 만들기', '구역 › 캐비넷·선반 › 칸 을 한꺼번에 만들고 QR 라벨 코드도 붙입니다')
        + `<div class="field"><span class="lab">① 어디에</span><div class="pickgrid" style="max-height:none">${[['', '새 구역 만들기']].concat(zones.map(z => [z.id, z.name + (z.code ? ' · ' + z.code : '')])).map(([v, l]) => `<button type="button" class="pick" data-act="pick" data-k="zone" data-v="${v}" aria-pressed="${(d.zone || '') === v}"><span class="ic">${ic(v ? 'pin' : 'plus')}</span><div class="main"><span>${esc(l)}</span></div></button>`).join('')}</div></div>
        ${d.zone ? '' : `<div class="row2"><div class="field"><label for="lb-zn">구역 이름</label><input id="lb-zn" data-bind="zname" data-live value="${esc(d.zname || '')}" placeholder="예: 창고" autocomplete="off"></div><div class="field"><label for="lb-zc">구역 코드</label><input id="lb-zc" data-bind="zcode" data-live value="${esc(d.zcode || '')}" placeholder="예: WH" autocapitalize="characters" autocomplete="off"></div></div>`}
        <div class="field"><span class="lab">② 캐비넷·선반</span><div class="seg block" role="group">${['선반', '캐비넷'].map(t => `<button type="button" data-act="lbType" data-v="${t}" aria-pressed="${(d.utype || '선반') === t}">${t}</button>`).join('')}</div></div>
        <div class="lbrange"><div class="field"><label for="lb-a">번호 처음</label><input id="lb-a" data-bind="from" data-live inputmode="numeric" value="${esc(d.from ?? '1')}" autocomplete="off"></div><span class="tilde">~</span><div class="field"><label for="lb-b">번호 끝</label><input id="lb-b" data-bind="to" data-live inputmode="numeric" value="${esc(d.to ?? '4')}" autocomplete="off"></div><div class="field"><label for="lb-uc">코드 앞부분</label><input id="lb-uc" data-bind="ucode" data-live value="${esc(d.ucode || '')}" placeholder="${esc(locBulkPlan(d).auto)}" autocapitalize="characters" autocomplete="off"></div></div>
        <div class="field"><span class="lab">③ 칸 (선택)</span><div class="filters" style="margin:0;padding:0;flex-wrap:wrap">${[['', '칸 없음'], ['상,하', '상·하'], ['상,중,하', '상·중·하'], ['1,2,3,4', '1·2·3·4']].map(([v, l]) => `<button type="button" class="fchip" data-act="lbSlots" data-v="${v}" aria-pressed="${(d.slots || '') === v}">${l}</button>`).join('')}</div><input id="lb-sl" data-bind="slots" data-live value="${esc(d.slots || '')}" placeholder="직접 적기: 예) 상,중,하" autocomplete="off"></div>
        <div id="lb-prev">${locBulkPreview(d)}</div>${sheetErr()}${okBtn('만들기')}`;
      break;
    }
    case 'recv': {
      const rows = orderRows().filter(r => r.on && r.qty > 0); const locs = flatTree(S.ix.locKids);
      h = sheetHead('한 번에 입고', `체크한 ${rows.length}가지 · 품목마다 넣을 위치와 수량을 확인하세요`)
        + `<div class="ledger cartlist recvlist">${rows.map(r => { const it = S.ix.item.get(r.id); const q = d['rq_' + r.id] ?? String(r.qty); const loc = d['rl_' + r.id] || '';
          return `<div class="crow ${isInt(q, 1) && loc ? '' : 'bad'}"><div class="main"><span class="t">${esc(itemTitle(it))}</span><select id="rl-${r.id}" data-bind="rl_${r.id}" aria-label="넣을 위치"><option value="">넣을 위치 고르기</option>${locs.map(({ n, depth }) => `<option value="${n.id}" ${loc === n.id ? 'selected' : ''}>${'\u00a0\u00a0'.repeat(depth)}${esc(n.name)}${n.code ? ' · ' + esc(n.code) : ''}${qtyAt(r.id, n.id) ? ' (지금 ' + qtyAt(r.id, n.id) + ')' : ''}</option>`).join('')}</select></div>
            <div class="ministep"><button type="button" data-act="recvStep" data-id="${r.id}" data-d="-1" aria-label="하나 빼기">−</button><input id="rq-${r.id}" data-bind="rq_${r.id}" inputmode="numeric" value="${esc(q)}" aria-label="수량" autocomplete="off"><button type="button" data-act="recvStep" data-id="${r.id}" data-d="1" aria-label="하나 더하기">+</button></div><span class="unit">${esc(it.unit)}</span></div>`; }).join('') || empty('box', '체크한 품목이 없습니다.')}</div>
          <div class="field"><label for="sh-note">메모 (선택)</label><input id="sh-note" data-bind="note" value="${esc(d.note || '')}" placeholder="예: 10월 발주분, 거래처 이름"></div>
          ${sheetErr()}${okBtn('입고 ' + rows.length + '가지', 'in')}
          <p class="muted" style="margin:0;font-size:12.5px">위치는 그 품목이 지금 가장 많이 있는 곳으로 미리 골라 두었습니다. 넣은 품목은 발주 목록에서 빠집니다.</p>`;
      break;
    }
    case 'myFolder':
      h = sheetHead(d.id ? '내 폴더 이름 바꾸기' : '내 폴더 만들기', '내 저장함 정리용 · 이 휴대폰에만 저장됩니다') + `<div class="field"><label for="sh-mf">폴더 이름</label><input id="sh-mf" data-bind="name" value="${esc(d.name || '')}" placeholder="예: 자주 보는 회로도" data-autofocus autocomplete="off"></div>${sheetErr()}${okBtn(d.id ? '저장' : '만들기')}`;
      break;
    case 'myMove': {
      const md = myData(); const doc = S.ix.doc.get(d.id);
      h = sheetHead('폴더로 옮기기', esc(doc ? doc.name : '')) + `<div class="pickgrid" style="max-height:calc(50vh / var(--z,1))"><button type="button" class="pick" data-act="pick" data-k="target" data-v="" aria-pressed="${!d.target}"><span class="ic">${ic('starOn')}</span><div class="main"><span>내 저장함 (맨 위)</span></div></button>${flatMy(md).map(({ n, depth }) => `<button type="button" class="pick" data-act="pick" data-k="target" data-v="${n.id}" aria-pressed="${d.target === n.id}" style="padding-left:${14 + depth * 16}px"><span class="folder-ic mine" style="width:24px;height:24px">${ic('folder')}</span><div class="main"><span>${esc(n.name)}</span></div></button>`).join('')}</div>
        <button type="button" class="btn block" data-act="myMkdirHere">${ic('folderPlus')}새 폴더 만들어 넣기</button>${sheetErr()}${okBtn('여기로 옮기기')}`;
      break;
    }
    case 'myDocMenu': {
      const doc = S.ix.doc.get(d.id); if (!doc) { S.sheet = null; return ''; } const off = offInfo(doc.id);
      h = sheetHead(doc.name, off ? '폰에 저장됨 · ' + fmtSize(off.size) : '아직 폰에 없음') + `<div class="ledger">
        <button class="lrow" data-act="myMoveOpen" data-id="${doc.id}"><span class="ic">${ic('folder')}</span><div class="main"><span class="t">내 폴더로 옮기기</span></div></button>
        ${doc.kind === 'file' ? `<button class="lrow" data-act="docDownload" data-id="${doc.id}"><span class="ic">${ic('download')}</span><div class="main"><span class="t">파일 열기</span><span class="s">휴대폰 앱(PDF·엑셀·한글 등)으로 엽니다</span></div></button>` : ''}
        ${!off && offOK(doc) ? `<button class="lrow" data-act="offSave" data-id="${doc.id}"><span class="ic">${ic('phone')}</span><div class="main"><span class="t">폰에 저장</span></div></button>` : ''}
        <button class="lrow" data-act="myRemove" data-id="${doc.id}"><span class="ic" style="color:var(--crit);background:var(--crit-soft)">${ic('x')}</span><div class="main"><span class="t" style="color:var(--crit)">내 저장함에서 빼기</span><span class="s">폰에 저장한 파일도 지웁니다. 원래 자료는 그대로입니다</span></div></button></div>`;
      break;
    }
    case 'install': {
      const ios = isIOS() || DEMO, and = !isIOS() || DEMO;
      h = sheetHead('홈 화면에 앱 추가', '한 번만 해 두면 아이콘을 눌러 바로 열립니다')
        + (ios ? `<div class="howto"><div class="howto-h">아이폰 · 사파리에서</div><ol class="steps"><li><span class="n">1</span><span>화면 아래쪽 <b>공유 버튼</b> <span class="kbd">${ic('iosShare')}</span> 을 누릅니다. (아이패드는 위쪽)</span></li><li><span class="n">2</span><span>목록을 위로 올려 <b>「홈 화면에 추가」</b>를 누릅니다.</span></li><li><span class="n">3</span><span>오른쪽 위 <b>「추가」</b>를 누르면 끝입니다.</span></li></ol></div>` : '')
        + (and ? `<div class="howto"><div class="howto-h">안드로이드 · 크롬 또는 삼성 인터넷에서</div><ol class="steps"><li><span class="n">1</span><span>크롬은 오른쪽 위 <b>⋮</b>, 삼성 인터넷은 아래쪽 <b>≡</b> 메뉴를 누릅니다.</span></li><li><span class="n">2</span><span><b>「홈 화면에 추가」</b> 또는 <b>「앱 설치」</b>를 누릅니다.</span></li><li><span class="n">3</span><span><b>「설치」</b>(또는 「추가」)를 누르면 끝입니다.</span></li></ol></div>` : '')
        + `<div class="notice">${ic('info')}<span>카카오톡 안에서 열린 화면이면 먼저 카톡 메뉴의 <b>「다른 브라우저로 열기」</b>(아이폰은 「Safari로 열기」)를 누른 뒤 위 순서대로 하세요.</span></div><button class="btn primary block big" data-act="sheetClose">확인</button>`;
      break;
    }
    case 'tour': {
      const T = TOUR[d.step] || TOUR[0]; const last = d.step >= TOUR.length - 1;
      h = `<div class="tour"><div class="tour-ill">${ic(T.icon)}</div><div class="tour-step">처음 안내 ${d.step + 1} / ${TOUR.length}</div><h3 id="sheet-t">${T.t}</h3><p>${T.b}</p></div>
        <div class="dots" aria-hidden="true">${TOUR.map((_, i) => `<i class="${i === d.step ? 'on' : ''}"></i>`).join('')}</div>
        ${last ? `<button class="btn primary block big" data-act="tourNext">시작하기</button>` : `<div class="row2"><button class="btn big ghost" data-act="sheetClose">건너뛰기</button><button class="btn big primary" data-act="tourNext">다음</button></div>`}`;
      break;
    }
    case 'shareText':
      h = sheetHead(d.title || '보내기', '아래 글을 복사해 카톡 대화방에 붙여 넣으세요') + `<textarea class="sharebox" id="share-text" readonly rows="8" data-nokeep>${esc(d.text)}</textarea><button class="btn primary block big" data-act="copyText">복사하기</button>`;
      break;
    case 'switchRole':
      h = sheetHead('다른 역할로 보기', '체험판 전용') + `<div class="rolepick"><button data-act="quick" data-role="dev"><b>개발자</b><span>재석</span></button><button data-act="quick" data-role="admin"><b>관리자</b><span>김도윤</span></button><button data-act="quick" data-role="staff"><b>직원</b><span>박성호</span></button></div>`;
      break;
  }
  return `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t">${h}</div></div>`;
}

/* 시트의 「저장」 — 먼저 입력을 확인한다 */
ACT.sheetOk = () => {
  const s = S.sheet, d = s.d, A = S.api;
  const bad = m => { s.err = m; render(); };
  const itName = () => itemTitle(S.ix.item.get(d.item_id)); const un = () => (S.ix.item.get(d.item_id) || {}).unit || '';
  const needQty = (min = 1) => isInt(d.qty, min) ? (d.qty = +d.qty, true) : (bad(min ? '수량을 1 이상의 정수로 입력하세요.' : '수량을 0 이상의 정수로 입력하세요.'), false);
  const jobs = {
    in: () => { if (!d.item_id) return bad('품목을 고르세요.'); if (!d.location_id) return bad('넣을 위치를 고르세요.'); if (!needQty()) return; return run(() => A.stockIn(d), null).then(r => r && undoable(`입고했습니다 · ${itName()} ${d.qty}${un()}`, r)); },
    out: () => { if (!d.location_id) return bad('꺼내는 위치를 고르세요.'); if (!needQty()) return; const site = siteText(d);
      return run(() => A.stockOut({ ...d, site }), null).then(r => { if (!r) return; undoable(`출고했습니다 · ${itName()} ${d.qty}${un()}${site ? ' · ' + site : ''}`, r); if (site) rememberSite(site); }); },
    move: () => { if (!d.from) return bad('보내는 위치를 고르세요.'); if (!d.to) return bad('받는 위치를 고르세요.'); if (!needQty()) return; return run(() => A.stockMove(d), null).then(r => r && undoable(`옮겼습니다 · ${itName()} ${d.qty}${un()}`, r)); },
    adjust: () => { if (!d.location_id) return bad('위치를 고르세요.'); if (!needQty(0)) return; if (!(d.reason || '').trim()) return bad('정정 사유를 적어 주세요. 활동 기록에 남습니다.'); return run(() => A.stockAdjust(d), '수량을 정정했습니다'); },
    item: () => {
      if (!(d.name || '').trim()) return bad('품명을 입력하세요.');
      if (String(d.min_qty ?? '').trim() !== '' && !isInt(d.min_qty)) return bad('최소 재고는 0 이상의 정수로 입력하세요. (모르면 비워 두세요)');
      let p = d;
      if (d.id && s.orig) { p = { id: d.id }; ['name', 'spec', 'maker', 'models', 'category_id', 'unit', 'min_qty', 'memo'].forEach(k => { if (String(d[k] ?? '') !== String(s.orig[k] ?? '')) p[k] = d[k]; }); } // 바꾼 칸만 보낸다
      return run(() => A.saveItem(p), d.id ? '저장했습니다' : '품목을 추가했습니다').then(id => { if (!id || d.id || id === true) return; if (d.countLoc) { countAdd(d.countLoc, id); render(); return; } nav({ tab: 'items', view: 'item', id }); });
    },
    memo: () => run(() => A.saveItem({ id: d.id, memo: d.memo }), '메모를 저장했습니다'),
    cart: () => {
      const rows = cart(); if (!rows.length) return bad('담은 자재가 없습니다.');
      for (let i = 0; i < rows.length; i++) { const v = d['cq_' + i] ?? String(rows[i].qty); if (!isInt(v, 1)) return bad(itemTitle(S.ix.item.get(rows[i].item_id)) + ': 수량을 1 이상의 정수로 입력하세요.'); rows[i].qty = +v; }
      saveCart(); const site = siteText(d);
      return run(() => A.stockOutMany({ rows: rows.map(r => ({ item_id: r.item_id, location_id: r.location_id, qty: r.qty })), site, note: d.note || '', op_id: d.op_id }), null)
        .then(r => { if (!r) return; S.cart = []; saveCart(); render(); if (site) rememberSite(site); undoable(`${rows.length}가지 출고했습니다${site ? ' · ' + site : ''}`, r); });
    },
    recv: () => {
      const rows = orderRows().filter(r => r.on && r.qty > 0); if (!rows.length) return bad('체크한 품목이 없습니다.');
      const out = [];
      for (const r of rows) { const it = S.ix.item.get(r.id); const q = d['rq_' + r.id] ?? String(r.qty); const loc = d['rl_' + r.id];
        if (!isInt(q, 1)) return bad(itemTitle(it) + ': 수량을 1 이상의 정수로 입력하세요.');
        if (!loc || !S.ix.loc.has(loc)) return bad(itemTitle(it) + ': 넣을 위치를 고르세요.');
        out.push({ item_id: r.id, location_id: loc, qty: +q }); }
      return run(() => A.stockInMany({ rows: out, note: d.note || '발주 입고', op_id: d.op_id }), null).then(ids => {
        if (!ids) return; const done = new Set(out.map(x => x.item_id));
        S.order.rows = S.order.rows.filter(r => !done.has(r.id)); S.lastRecvLoc = out[out.length - 1].location_id; render();
        undoable(`${out.length}가지 입고했습니다 · 발주 목록에서 뺐습니다`, ids);
      });
    },
    myFolder: () => {
      const n = (d.name || '').trim(); if (!n) return bad('폴더 이름을 입력하세요.');
      const md = myData();
      if (d.id) { const f = md.folders.find(x => x.id === d.id); if (f) f.name = n; }
      else { const f = { id: uid('mf'), name: n, parent: d.parent || null }; md.folders.push(f); if (d.thenMove) md.place[d.thenMove] = f.id; }
      mySave(md); S.sheet = null; render(); toast(d.id ? '이름을 바꿨습니다' : d.thenMove ? `「${n}」 폴더를 만들어 넣었습니다` : `「${n}」 폴더를 만들었습니다`);
    },
    myMove: () => { const md = myData(); if (d.target) md.place[d.id] = d.target; else delete md.place[d.id]; mySave(md); S.sheet = null; render(); toast('옮겼습니다 · ' + ('내 저장함' + myPath(md, d.target || null).map(x => ' › ' + x.name).join(''))); },
    locBulk: () => {
      const P = locBulkPlan(d);
      if (P.err) return bad(P.err);
      return run(() => A.locationsBulk(P.zone ? P.zone.id : null, P.rows, d.op_id), n => n ? n + '곳을 만들었습니다 · 바로 QR 라벨을 인쇄할 수 있습니다' : '새로 만들 위치가 없습니다 (모두 이미 있음)').then(n => {
        if (n === false) return;
        const codes = new Set(); (function walk(rs) { rs.forEach(r => { if (r.code) codes.add(r.code); walk(r.kids || []); }); })(P.rows);
        S.labelSel = new Set(S.cache.locations.filter(l => codes.has((l.code || '').toUpperCase()) && l.kind !== 'zone').map(l => l.id));
        nav({ tab: 'more', view: 'labels' });
      });
    },
    loc: () => { if (!(d.name || '').trim()) return bad('위치 이름을 입력하세요.'); return run(() => A.saveLocation(d), d.id ? '저장했습니다' : '위치를 추가했습니다'); },
    cat: () => { if (!(d.name || '').trim()) return bad('분류 이름을 입력하세요.'); return run(() => A.saveCategory(d), '저장했습니다'); },
    mkdir: () => { const n = (d.name || '').trim(); if (!n) return bad('폴더 이름을 입력하세요.'); if (/[\/\\]/.test(n)) return bad('폴더 이름에 / 나 \\ 는 쓸 수 없습니다.'); return run(() => A.mkdir(d), '폴더를 만들었습니다'); },
    rename: () => { const n = (d.name || '').trim(); if (!n) return bad('이름을 입력하세요.'); if (d.kind === 'folder' && /[\/\\]/.test(n)) return bad('폴더 이름에 / 나 \\ 는 쓸 수 없습니다.'); return run(() => d.kind === 'folder' ? A.renameFolder(d.id, n) : A.renameDoc(d.id, n), '이름을 바꿨습니다'); },
    moveTo: () => { if (d.kind !== 'folder' && !d.target) return bad('옮길 폴더를 고르세요.'); return run(() => d.kind === 'folder' ? A.moveFolder(d.id, d.target || null) : A.moveDoc(d.id, d.target), '옮겼습니다'); },
    link: () => { if (!(d.name || '').trim()) return bad('제목을 입력하세요.'); if (!/^https?:\/\//i.test((d.url || '').trim())) return bad('주소는 https:// 로 시작해야 합니다.'); d.url = d.url.trim(); return run(() => A.addLink(d.folder_id, d), '등록했습니다'); },
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
  approveAll: d => run(() => S.api.approve(d.ids), d.ids.length + '명을 승인했습니다').then(ok => { if (ok && S.userSel) S.userSel.clear(); }),
  bulkGo: d => run(() => S.api.bulkItems(d.rows, d.op_id), n => n + '개 품목을 등록했습니다').then(ok => { if (ok) { S.bulk = null; render(); } }),
  demoReset: () => { S.api.reset(); location.reload(); }
};
const ask = (title, msg, cb, extra = {}) => openSheet('confirm', { title, msg, cb, ...extra });

/* ───────── 누름 처리 ───────── */
const toItemsTab = () => { if (S.tab !== 'items') { S.lastTab[S.tab] = S.stack; S.stack = [{ ...ROOTS.items }]; } };
Object.assign(ACT, {
  tab: d => goTab(d.t),
  back: () => back(),
  scrim: (d, el, e) => { if (e.target === el) { S.sheet = null; render(); } },
  sheetClose: () => { S.sheet = null; render(); },
  theme: d => { store.set(THEME_KEY, d.v); applyTheme(d.v); render(); toast(d.v === 'dark' ? '어두운 화면으로 바꿨습니다' : d.v === 'light' ? '밝은 화면으로 바꿨습니다' : '휴대폰 설정을 따릅니다'); },
  jump: d => { const el = document.getElementById(d.to); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  mode: d => { S.itemsMode = d.m; store.set('gaya-mode', d.m); S.q = ''; S.searchRes = null; resetStack({ ...ROOTS.items }); },
  locRoot: () => resetStack({ ...ROOTS.items }),
  catRoot: () => { S.itemsMode = 'cat'; store.set('gaya-mode', 'cat'); resetStack({ ...ROOTS.items }); },
  loc: d => { S.q = ''; S.searchRes = null; toItemsTab(); if (S.countNext && can(S.user, 'adjust')) { S.countNext = false; return nav({ tab: 'items', view: 'count', node: d.id }); } nav({ tab: 'items', view: 'browse', node: d.id, mode: 'loc' }); },
  cat: d => { S.q = ''; S.searchRes = null; nav({ tab: 'items', view: 'browse', node: d.id, mode: 'cat' }); },
  item: d => { toItemsTab(); nav({ tab: 'items', view: 'item', id: d.id }); },
  folder: d => { S.docsQ = ''; S.docSearchRes = null; if (!d.id) return resetStack({ ...ROOTS.docs }); const i = S.stack.findIndex(r => r.folder === d.id); if (i >= 0) { S.stack = S.stack.slice(0, i + 1); render(); window.scrollTo(0, 0); } else nav({ tab: 'docs', view: 'browse', folder: d.id }); },
  doc: d => { if (S.tab !== 'docs') { S.lastTab[S.tab] = S.stack; S.stack = [{ ...ROOTS.docs }]; } nav({ tab: 'docs', view: 'doc', id: d.id }); },
  go: d => nav({ tab: 'more', view: d.v }),
  authView: d => { S.authView = d.v; S.authErr = ''; render(); },
  quick: async d => { S.sheet = null; S.user = await S.api.quickLogin(d.role); await afterLogin(); },
  recheck: async () => { try { S.user = await S.api.session(); } catch (e) { return toast(isNet(e) ? NET_MSG : e.message, true); } if (S.user && S.user.status === 'active') await afterLogin(); else { render(); note('아직 승인되지 않았습니다.'); } },
  logout: async () => {
    try { await S.api.logout(); } catch {}
    store.del('gaya-cache'); store.del('gaya-user'); store.del('gaya-sites'); store.del('gaya-mysites');
    S.user = null; S.cache = null; S.ix = null; S.sheet = null; S.authView = 'login'; S.stack = [{ ...ROOTS.items }]; S.tab = 'items'; S.lastTab = {}; S.recentSites = []; S.mySites = []; S.cart = null; S.cartSite = null; S.order = null; S.count = null; closeViewer(); S.q = ''; S.docsQ = ''; S.searchRes = null; S.docSearchRes = null;
    for (const k in VIEWDATA) delete VIEWDATA[k];
    stopScan(); render();
  },

  txIn: d => { const rows = (S.ix.byItem.get(d.id) || []).slice().sort((a, b) => b.qty - a.qty); const here = route().node && S.ix.loc.has(route().node) ? route().node : null; openSheet('in', { item_id: d.id, location_id: here || (rows[0] || {}).location_id || null, qty: 1 }); },
  txOut: d => { const rows = (S.ix.byItem.get(d.id) || []).filter(r => r.qty > 0).sort((a, b) => b.qty - a.qty); const here = route().node && rows.find(r => r.location_id === route().node); openSheet('out', { item_id: d.id, location_id: (here || rows[0] || {}).location_id || null, qty: 1, quick: !!here || rows.length === 1 }); },
  outHere: d => openSheet('out', { item_id: d.id, location_id: d.loc, qty: 1, quick: true }),
  outFull: () => { if (S.sheet) { S.sheet.d.quick = false; render(); } },
  txMove: d => { const rows = (S.ix.byItem.get(d.id) || []).slice().sort((a, b) => b.qty - a.qty); openSheet('move', { item_id: d.id, from: (rows[0] || {}).location_id || null, to: null, qty: 1 }); },
  txAdjust: d => { const rows = S.ix.byItem.get(d.id) || []; const l = (rows[0] || {}).location_id || null; openSheet('adjust', { item_id: d.id, location_id: l, qty: l ? rows[0].qty : 0 }); },
  inHere: d => openSheet('in', { item_id: null, location_id: d.id, qty: 1 }),
  pick: d => {
    const s = S.sheet; if (!s) return; s.d[d.k] = d.v || null; s.err = '';
    if (s.type === 'adjust' && d.k === 'location_id') s.d.qty = ((S.ix.byItem.get(s.d.item_id) || []).find(x => x.location_id === d.v) || {}).qty || 0;
    if (s.type === 'move' && d.k === 'from' && s.d.to === d.v) s.d.to = null;
    render();
  },
  step: d => { const s = S.sheet; const min = s.type === 'adjust' ? 0 : 1; s.d[d.k] = Math.max(min, (parseInt(s.d[d.k], 10) || 0) + +d.d); render(); },
  cancelTx: d => { const t = (vd().tx || []).find(x => x.id === d.id); if (!t) return; const it = S.ix.item.get(t.item_id); const unit = it ? it.unit : '';
    ask(t.type === 'out' ? '출고를 취소할까요?' : TX_NAME[t.type] + '을 취소할까요?', `${personName(t.user_id)} · ${fmtWhen(t.created_at)} · ${itemTitle(it)} ${t.qty}${unit}. ${t.type === 'out' ? (locPathText(t.from_loc) || '원래 위치') + '에 수량이 다시 더해집니다.' : '수량이 기록 전 상태로 돌아갑니다.'}`, 'cancelTx', { id: d.id, ok: '취소하기' }); },

  itemNew: () => openSheet('item', { unit: '개', category_id: (route().mode || S.itemsMode) === 'cat' ? route().node || '' : '' }),
  itemEdit: d => { const it = S.ix.item.get(d.id); if (!it) return; openSheet('item', { ...clone(it) }); S.sheet.orig = clone(it); },
  itemDelete: d => ask('품목을 지울까요?', itemTitle(S.ix.item.get(d.id)) + ' · 휴지통에서 30일 안에 되살릴 수 있습니다. 재고가 남아 있으면 지워지지 않습니다.', 'itemDelete', { id: d.id, ok: '지우기', danger: true }),
  memoEdit: d => openSheet('memo', { id: d.id, memo: (S.ix.item.get(d.id) || {}).memo || '' }),
  photoItem: d => { if (!online()) return toast('오프라인이라 저장할 수 없습니다.', true); S.photoTarget = { type: 'item', id: d.id }; $('#photopick').click(); },
  sheetPhoto: () => { if (!online()) return toast('오프라인이라 사진을 올릴 수 없습니다.', true); S.photoTarget = { type: 'sheet' }; $('#photopick').click(); },
  locNew: d => openSheet('loc', { parent_id: d.parent || null }),
  locEdit: d => { const l = S.ix.loc.get(d.id); if (l) openSheet('loc', { ...clone(l) }); },
  locDelete: d => ask('위치를 지울까요?', locPathText(d.id) + ' · 자재나 안쪽 위치가 남아 있으면 지워지지 않습니다.', 'locDelete', { id: d.id, ok: '지우기', danger: true }),
  labelsFor: d => { S.labelSel = new Set(descLocs(d.id).filter(id => S.ix.loc.get(id).kind !== 'zone' || id === d.id)); nav({ tab: 'more', view: 'labels' }); },
  selLabel: (d, el) => { el.checked ? S.labelSel.add(d.id) : S.labelSel.delete(d.id); setTimeout(render, 0); },
  printLabels: () => { if (DEMO) return note('체험판 화면에서는 인쇄 창이 열리지 않습니다. 실제 앱에서는 바로 인쇄됩니다.'); window.print(); },
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

  notif: d => { let l = {}; try { l = JSON.parse(d.link || '{}'); } catch {} if (!l.tab) return;
    if (l.view === 'item' && l.id) ACT.item({ id: l.id });
    else if (l.view === 'doc' && l.id) ACT.doc({ id: l.id });
    else if (l.view === 'users') { S.lastTab[S.tab] = S.stack; S.stack = [{ ...ROOTS.more }]; nav({ tab: 'more', view: 'users' }); }
    else goTab(l.tab); },
  readAll: () => run(() => S.api.markAllRead(), null, { reload: false }).then(ok => { if (ok) { S.unread = 0; render(); } }),

  selUser: (d, el) => { S.userSel = S.userSel || new Set(); el.checked ? S.userSel.add(d.id) : S.userSel.delete(d.id); setTimeout(render, 0); },
  approveSel: () => { const ids = [...(S.userSel || [])]; if (ids.length) run(() => S.api.approve(ids), ids.length + '명을 승인했습니다').then(ok => { if (ok) S.userSel.clear(); }); },
  approveAll: () => { const pend = (vd().list || []).filter(p => p.status === 'pending'); const ids = pend.map(p => p.id); if (!ids.length) return; ask('전체 승인할까요?', pend.map(p => p.name + '(' + p.emp_no + ')').join(', ') + ' · 모두 바로 앱을 쓸 수 있게 됩니다.', 'approveAll', { ids, ok: ids.length + '명 승인' }); },
  rejectUser: (d, el, e) => { e.preventDefault(); const p = (vd().list || []).find(x => x.id === d.id); if (!p) return; ask('가입 신청을 거절할까요?', p.name + ' (' + p.emp_no + ') · 신청이 지워집니다. 실수라면 다시 신청하면 됩니다.', 'rejectUser', { id: d.id, ok: '거절', danger: true }); },
  userMenu: d => openSheet('userMenu', { id: d.id }),
  setRole: d => run(() => S.api.setRole(d.id, d.role), '권한을 바꿨습니다', { keepSheet: true }),
  resetPw: async d => { const p = (vd().list || []).find(x => x.id === d.id); const pw = await run(() => S.api.resetPassword(d.id), null, { reload: false }); if (pw && pw !== true) openSheet('tempPw', { name: p.name, pw }); },
  copyPw: d => { (navigator.clipboard ? navigator.clipboard.writeText(d.pw) : Promise.reject()).then(() => toast('복사했습니다'), () => toast('복사하지 못했습니다. 번호를 직접 알려 주세요.', true)); },
  disableUser: d => { const p = (vd().list || []).find(x => x.id === d.id); ask('사용을 중지할까요?', p.name + ' · 로그인만 막히고 입출고·댓글 기록은 그대로 남습니다. 언제든 「다시 사용」할 수 있습니다.', 'disableUser', { id: d.id, ok: '사용 중지', danger: true }); },
  enableUser: d => run(() => S.api.setActive(d.id, true), '다시 쓸 수 있게 했습니다'),
  logKind: d => { S.logKind = d.k; VIEWDATA[JSON.stringify(route())] = {}; render(); onEnterRoute(); },
  restore: d => run(() => S.api.restore(d.type, d.id), '되살렸습니다'),

  bulkCheck: () => {
    const text = ($('#bulk-in') || {}).value || ''; S.bulk = { text, rows: [] };
    const byCat = new Map(S.cache.categories.map(c => [c.name.trim(), c.id])); const byCode = new Map(S.cache.locations.filter(l => l.code).map(l => [l.code.toUpperCase(), l.id]));
    S.bulk.rows = text.split(/\r?\n/).map(l => l.split('\t')).filter(c => c.join('').trim()).filter((c, i) => !(i === 0 && (c[0] || '').trim() === '품명')).map(c => {
      const [name, spec, maker, models, cat, unit, min, code, qty, memo] = c.map(x => (x || '').trim());
      const r = { name, spec, maker, models, unit: unit || '개', min_qty: isInt(min) ? +min : 0, qty: isInt(qty) ? +qty : 0, memo, catName: cat, locCode: code, rawQty: qty };
      if (cat) r.category_id = byCat.get(cat); if (code) r.location_id = byCode.get(code.toUpperCase());
      r.warn = !name ? '품명 없음' : cat && !r.category_id ? '모르는 분류' : code && !r.location_id ? '모르는 위치 코드' : qty && !isInt(qty) ? '수량이 정수가 아님' : min && !isInt(min) ? '최소 재고가 정수가 아님' : '';
      return r;
    });
    if (!S.bulk.rows.length) toast('붙여 넣은 내용이 없습니다.', true); render();
  },
  bulkGo: () => { const rows = S.bulk.rows.filter(r => r.name).map(r => { const x = { ...r }; delete x.warn; delete x.catName; delete x.locCode; delete x.rawQty; return x; }); ask(rows.length + '개 품목을 등록할까요?', '위치 코드와 수량이 있는 줄은 그 위치에 입고 기록까지 함께 남깁니다.', 'bulkGo', { rows, ok: '등록' }); },

  fakeOff: (d, el) => { S.fakeOffline = el.checked; setTimeout(render, 0); },
  switchRole: () => openSheet('switchRole'),
  demoReset: () => ask('체험판을 처음 상태로 돌릴까요?', '이 기기에서 해 본 입출고·업로드가 모두 지워지고 예시 데이터가 다시 채워집니다.', 'demoReset', { ok: '처음으로', danger: true })
});
const descFolders = id => { const out = [id]; for (let i = 0; i < out.length; i++) (S.ix.folderKids.get(out[i]) || []).forEach(k => out.push(k.id)); return { f: out.length - 1, d: out.reduce((a, f) => a + (S.ix.docsIn.get(f) || []).length, 0) }; };

/* 폼 제출 */
Object.assign(ACT, {
  login: async (ds, f) => {
    if (!online()) { S.authErr = '인터넷에 연결되어 있지 않습니다. 연결된 뒤 다시 누르세요.'; return render(); }
    S.busy = true; S.authErr = ''; render();
    try { S.user = await S.api.login(f.emp.value, f.pw.value); S.busy = false; if (S.user.status === 'active') await afterLogin(); else render(); }
    catch (e) { S.busy = false; S.authErr = isNet(e) ? NET_MSG : e.message; render(); }
  },
  signup: async (ds, f) => {
    if (f.elements.namedItem('pw').value !== f.elements.namedItem('pw2').value) { S.authErr = '비밀번호 확인이 맞지 않습니다.'; return render(); }
    if (!online()) { S.authErr = '인터넷에 연결되어 있지 않습니다. 연결된 뒤 다시 누르세요.'; return render(); }
    const g = k => f.elements.namedItem(k).value;
    const vals = { emp_no: g('emp'), name: g('name'), phone: g('phone'), pw: g('pw') };
    S.busy = true; S.authErr = ''; render();
    try { S.user = await S.api.signup(vals); S.busy = false; render(); }
    catch (e) { S.busy = false; S.authErr = isNet(e) ? NET_MSG : e.message; render(); }
  },
  comment: async (ds, f) => { const el = document.getElementById('cmt-' + ds.id); const body = el ? el.value : ''; if (!body.trim()) return; const ok = await run(() => S.api.addComment(ds.type, ds.id, body), '댓글을 남겼습니다', { reload: false }); if (ok) { const n = document.getElementById('cmt-' + ds.id); if (n) n.value = ''; } },
  changePw: async () => { const o = $('#pw-old'), n = $('#pw-new'); if (!o || !n) return; const ok = await run(() => S.api.changePassword(o.value, n.value), '비밀번호를 바꿨습니다', { reload: false }); if (ok) ['pw-old', 'pw-new'].forEach(id => { const x = document.getElementById(id); if (x) x.value = ''; }); },
  codeGo: () => { const v = ($('#code-in') || {}).value || ''; const l = findLoc(v); if (l) ACT.loc({ id: l.id }); else toast('그 코드의 위치가 없습니다. 라벨에 적힌 코드를 확인하세요.', true); }
});

/* ───────── 편의 기능 (업데이트 4) ───────── */
/* 입고·출고·이동 직후 잠깐 뜨는 「되돌리기」: 누르면 방금 기록을 취소해 수량을 원래대로 돌린다 */
function undoable(msg, tid) {
  if (!tid || tid === true || !pref('undo')) return toast(msg);
  const many = Array.isArray(tid);
  toast(msg, false, { label: '되돌리기', fn: () => run(() => many ? S.api.stockCancelMany(tid, opId()) : S.api.stockCancel({ tx_id: tid, op_id: opId() }), many ? `되돌렸습니다 · ${tid.length}가지 수량이 원래대로 돌아갔습니다` : '되돌렸습니다 · 수량이 원래대로 돌아갔습니다') });
}
const siteNames = () => [...new Set((S.recentSites || []).map(x => parseSite(x).name).filter(Boolean))].slice(0, 40);
function rememberSite(site) {
  S.recentSites = [site, ...(S.recentSites || []).filter(x => x !== site)].slice(0, 60); store.set('gaya-sites', S.recentSites);
  S.mySites = [site, ...(S.mySites || []).filter(x => x !== site)].slice(0, 8); store.set('gaya-mysites', S.mySites);
}
/* 카톡 등으로 보내기: 폰 공유 창 → 안 되면 복사 → 그것도 안 되면 글을 띄워 직접 복사 */
async function shareOut(title, text) {
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text); note('복사했습니다. 카톡 대화방에 붙여 넣으세요.'); return; } catch {}
  openSheet('shareText', { title, text });
}
const TOUR = [
  { icon: 'scan', t: '선반에서 바로 꺼내기', b: '가운데 <b>스캔</b>으로 선반의 QR을 찍으면 그 선반의 자재가 열립니다. 쓸 자재 옆 <b>꺼내기</b>를 누르고 수량만 맞추면 출고가 끝납니다.' },
  { icon: 'undo', t: '잘못 눌렀다면 되돌리기', b: '입고·출고·이동을 저장하면 아래에 <b>되돌리기</b>가 잠깐 뜹니다. 꺼냈다가 안 쓴 자재는 기록 옆 <b>출고 취소 (안 씀)</b>를 누르면 수량이 돌아옵니다. 되돌리기 버튼이 필요 없으면 더보기 › 알림 창 설정에서 끌 수 있습니다.' },
  { icon: 'docs', t: '자료는 검색으로, 자주 보는 건 내 저장함에', b: '자료 탭 검색창에 에러코드나 부품명을 치면 파일 안의 글자까지 찾습니다(ㄷㅇㄹㄹ 같은 초성도 됨). 자주 보는 자료는 <b>☆</b>를 누르면 <b>「내 저장함」</b>에 모이고 폰에도 저장돼, 전파 없는 기계실에서도 열립니다.' }
];
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
Object.assign(ACT, {
  toastAct: () => { const a = S.toast && S.toast.act; clearTimeout(toastTimer); S.toast = null; drawToast(); if (a) a.fn(); },
  shareLow: () => {
    const lows = S.cache.items.filter(isLow).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    if (!lows.length) return note('재고가 부족한 품목이 없습니다.');
    const n = new Date();
    const text = `[가야 자재] 재고 부족 ${n.getMonth() + 1}/${n.getDate()} (${'일월화수목금토'[n.getDay()]})\n` + lows.map(it => `- ${itemTitle(it)}: ${total(it.id)}${it.unit} (최소 ${it.min_qty})`).join('\n') + `\n총 ${lows.length}품목`;
    shareOut('재고 부족 목록', text);
  },
  copyText: () => {
    const el = $('#share-text'); if (!el) return;
    const done = () => { S.sheet = null; render(); note('복사했습니다. 카톡 대화방에 붙여 넣으세요.'); };
    (navigator.clipboard ? navigator.clipboard.writeText(el.value) : Promise.reject()).then(done, () => { el.focus(); el.select(); try { if (document.execCommand('copy')) return done(); } catch {} toast('글을 길게 눌러 「전체 선택 › 복사」 하세요.', true); });
  },

  history: () => { S.histQ = ''; S.histKind = ''; nav({ tab: 'items', view: 'history', month: thisMonth() }); },
  histMonth: d => { const r = route(); const m = shiftMonth(r.month, +d.d); if (m > thisMonth()) return; nav({ ...r, month: m }, true); },
  histKind: d => { S.histKind = d.k; render(); },
  histExport: () => {
    const r = route(), v = vd();
    if (!v.list) return note('기록을 불러오는 중입니다. 잠시 뒤 다시 누르세요.');
    const rows = histRows(v.list); if (!rows.length) return toast('내려받을 기록이 없습니다.', true);
    const lp = id => id ? (locPathText(id) || locCode(id)) : '';
    const out = [['날짜', '시간', '구분', '품명', '규격', '수량', '단위', '보낸 위치', '받은 위치', '현장', '동', '호기', '메모', '담당자', '취소 여부']];
    rows.slice().reverse().forEach(t => {
      const dt = toDate(t.created_at), it = S.ix.item.get(t.item_id) || {}, adj = t.type === 'adjust';
      out.push([ymd(dt), pad(dt.getHours()) + ':' + pad(dt.getMinutes()), TX_NAME[t.type] || t.type, it.name || '(지워진 품목)', it.spec || '', t.qty, it.unit || '',
        t.type === 'in' ? '' : lp(t.from_loc), adj || t.type === 'out' ? '' : lp(t.to_loc), ...(p => [p.name, p.dong, p.ho])(parseSite(t.site)), (t.note || '') + (adj ? ` (기록 ${t.before} → 실제 ${t.after})` : ''), personName(t.user_id), t.canceled_by ? '취소됨' : '']);
    });
    const tag = (S.histKind ? '_' + (HIST_KINDS.find(x => x[0] === S.histKind) || [, ''])[1].replace(/[^가-힣a-z0-9]/gi, '') : '') + ((S.histQ || '').trim() ? '_검색' : '');
    downloadCSV(`가야자재_입출고_${r.month}${tag}.csv`, out);
    if (DEMO) note('체험판 화면에서는 파일이 안 받아질 수 있습니다. 실제 앱에서는 바로 받아집니다.'); else toast(`${rows.length}건을 엑셀 파일로 받았습니다`);
  },
  bulkTemplate: () => {
    downloadCSV('가야자재_품목등록_양식.csv', [BULK_COLS]);
    if (DEMO) note('체험판 화면에서는 파일이 안 받아질 수 있습니다. 실제 앱에서는 바로 받아집니다.'); else toast('빈 양식을 받았습니다. 엑셀에서 열어 채우세요.');
  },

  fav: d => {
    const s = favs(); const on = !s.has(d.id); on ? s.add(d.id) : s.delete(d.id); store.set(favKey(), [...s]);
    const doc = S.ix.doc.get(d.id);
    if (!on) { const md = myData(); delete md.place[d.id]; mySave(md); const had = !!offInfo(d.id); offDel(d.id); render(); return toast(had ? '내 저장함에서 뺐습니다 · 폰에 저장한 파일도 지웠습니다' : '내 저장함에서 뺐습니다'); }
    render();
    if (offOK(doc)) { toast('내 저장함에 넣었습니다 · 폰에도 저장합니다'); return saveOffline(d.id); }
    toast('내 저장함에 넣었습니다 · 자료 탭 「내 저장함」에 모입니다');
  },

  install: async () => {
    const ev = S.installEvt;
    if (!ev) return openSheet('install');
    S.installEvt = null;
    try { ev.prompt(); await ev.userChoice; } catch { openSheet('install'); }
    render();
  },
  installLater: () => { setPref('install', false); render(); note('홈 화면 추가는 언제든 더보기 › 도움말 › 「홈 화면에 앱 추가」에서 할 수 있습니다.'); },
  pref: (d, el) => { setPref(d.k, el.checked); setTimeout(render, 0); },
  pickSite: d => { const s = S.sheet; if (!s) return; const p = parseSite(d.v); Object.assign(s.d, { site: p.name, dong: p.dong, ho: p.ho }); render(); },
  size: d => { store.set(SIZE_KEY, d.v); applySize(d.v); render(); toast(d.v === 'lg' ? '글자를 크게 바꿨습니다' : '보통 크기로 바꿨습니다'); },
  tour: () => openSheet('tour', { step: 0 }),
  tourNext: () => { const s = S.sheet; if (!s) return; if (s.d.step >= TOUR.length - 1) { S.sheet = null; render(); return; } s.d.step++; render(); }
});
/* 안드로이드 크롬: 「앱 설치」 창을 우리 버튼으로 띄우기 위해 잡아 둔다 */
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; if (S.user && !S.sheet) render(); });
window.addEventListener('appinstalled', () => { S.installEvt = null; if (S.user) { render(); toast('홈 화면에 추가했습니다. 다음부터는 아이콘으로 여세요.'); } });

/* ───────── 업데이트 5 ───────── */

/* 담은 자재 (여러 개 한 번에 꺼내기) — 사람·기기마다 저장 */
const cartKey = () => 'gaya-cart-' + (S.user ? S.user.id : '');
const cart = () => S.cart || (S.cart = (store.get(cartKey(), []) || []).filter(r => S.ix && S.ix.item.has(r.item_id) && S.ix.loc.has(r.location_id)));
const saveCart = () => store.set(cartKey(), S.cart || []);
function cartSync() { const s = S.sheet; if (!s || s.type !== 'cart') return; cart().forEach((r, i) => { const v = s.d['cq_' + i]; if (isInt(v, 1)) r.qty = +v; }); saveCart(); }

/* 위치 한 번에 만들기: 고른 값으로 만들 위치 목록을 짠다 */
function locBulkPlan(d) {
  const zone = d.zone ? S.ix.loc.get(d.zone) : null;
  const zcode = (zone ? zone.code || '' : String(d.zcode || '')).trim().toUpperCase();
  const utype = d.utype || '선반';
  const auto = (zcode ? zcode + '-' : '') + (utype === '캐비넷' ? 'C' : 'S');
  const pre = String(d.ucode || '').trim().toUpperCase() || auto;
  const slots = [...new Set(String(d.slots || '').split(/[,\s·/]+/).map(x => x.trim()).filter(Boolean))];
  const a = String(d.from ?? '1').trim(), b = String(d.to ?? '4').trim();
  let err = '';
  if (!zone && !String(d.zname || '').trim()) err = '새 구역 이름을 적으세요. (예: 창고)';
  else if (!isInt(a, 1) || !isInt(b, 1)) err = '번호는 1 이상의 정수로 적으세요.';
  else if (+b < +a) err = '번호 끝이 처음보다 작습니다.';
  else if (+b - +a >= 40) err = '한 번에 40개까지만 만들 수 있습니다.';
  const units = [];
  if (!err) for (let n = +a; n <= +b; n++) units.push({ name: utype + ' ' + n, code: pre + n, kids: slots.map(x => ({ name: x, code: pre + n + '-' + x.toUpperCase() })) });
  const rows = zone ? units : [{ name: String(d.zname || '').trim(), code: zcode, kids: units }];
  const byCode = new Map(S.cache.locations.filter(l => l.code).map(l => [l.code.toUpperCase(), l]));
  let make = 0, have = 0, clash = '';
  (function walk(rs, parentId, parentNew) {
    rs.forEach(r => { const ex = r.code ? byCode.get(r.code) : null;
      if (ex && (parentNew || (ex.parent_id || null) !== (parentId || null))) clash = clash || r.code;
      if (ex) have++; else make++;
      walk(r.kids || [], ex ? ex.id : null, !ex); });
  })(rows, zone ? zone.id : null, false);
  if (!err && clash) err = '이미 다른 곳에서 쓰는 라벨 코드가 있습니다: ' + clash + ' — 「코드 앞부분」을 바꾸세요.';
  return { zone, zcode, auto, pre, slots, units, rows, make, have, err };
}
function locBulkPreview(d) {
  const P = locBulkPlan(d);
  if (P.err) return `<div class="notice warn">${ic('warn')}<span>${esc(P.err)}</span></div>`;
  const lines = []; const byCode = new Set(S.cache.locations.map(l => (l.code || '').toUpperCase()).filter(Boolean));
  (function walk(rs, depth) { rs.forEach(r => { if (lines.length < 40) lines.push(`<div class="lbline" style="padding-left:${depth * 18}px"><span>${esc(r.name)}</span>${r.code ? `<span class="tape">${esc(r.code)}</span>` : ''}${byCode.has(r.code) ? '<span class="chip">이미 있음</span>' : ''}</div>`); walk(r.kids || [], depth + 1); }); })(P.rows, 0);
  return `<div class="lbprev"><div class="lbsum">새로 만들 위치 <b>${P.make}곳</b>${P.have ? ` · 이미 있는 ${P.have}곳은 그대로 둡니다` : ''}</div>${lines.join('')}${P.make + P.have > 40 ? '<div class="lbline muted">…</div>' : ''}</div>`;
}

/* 재고 실사: 위치마다 적던 수량을 기기에 잠시 저장해 둔다 (다른 화면에 다녀와도 그대로) */
const COUNT_KEY = 'gaya-count';
const countAll = () => S.count || (S.count = store.get(COUNT_KEY, {}) || {});
const countState = loc => { const a = countAll(); return a[loc] || (a[loc] = { vals: {}, added: [] }); };
const countSaveLocal = () => store.set(COUNT_KEY, countAll());
const qtyAt = (item, loc) => ((S.ix.byItem.get(item) || []).find(x => x.location_id === loc) || {}).qty || 0;
function countIds(loc) { const c = countState(loc); return [...new Set([...(S.ix.byLoc.get(loc) || []).map(x => x.item_id), ...c.added])].filter(id => S.ix.item.has(id)); }
function countChanges(loc) {
  const c = countState(loc); const out = [], bad = [];
  countIds(loc).forEach(id => { const v = c.vals[id]; if (v == null || String(v).trim() === '') return; if (!isInt(v)) bad.push(id); else if (+v !== qtyAt(id, loc)) out.push({ item_id: id, qty: +v }); });
  return { out, bad };
}
function countAdd(loc, id) { const c = countState(loc); if (!c.added.includes(id)) c.added.push(id); if (c.vals[id] == null) c.vals[id] = ''; countSaveLocal(); }
function updateCountBar() { const r = route(); if (r.view !== 'count') return; const { out } = countChanges(r.node); const b = $('#cnt-sum'); if (b) b.textContent = out.length ? `바뀐 품목 ${out.length}개` : '바뀐 품목 없음'; const sv = $('#cnt-save'); if (sv) sv.disabled = !out.length; }

/* 발주 목록 */
function orderInit() { S.order = { rows: S.cache.items.filter(isLow).map(it => ({ id: it.id, qty: Math.max(1, it.min_qty - total(it.id)), on: true, low: true })) }; }
const orderRows = () => (S.order ? S.order.rows : []).filter(r => S.ix.item.has(r.id));
function orderText() {
  const rows = orderRows().filter(r => r.on && r.qty > 0); const groups = new Map();
  rows.forEach(r => { const it = S.ix.item.get(r.id); const k = it.maker || '제조사 미정'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(`- ${itemTitle(it)} ${r.qty}${it.unit}`); });
  const n = new Date();
  return `[가야엘리베이터 자재 발주] ${n.getMonth() + 1}/${n.getDate()} (${'일월화수목금토'[n.getDay()]})\n` + [...groups].map(([k, v]) => `■ ${k}\n${v.join('\n')}`).join('\n') + `\n총 ${rows.length}품목`;
}

/* ───────── 폰에 저장한 자료 (기계실·피트처럼 전파가 약한 곳에서 보기) ───────── */
const OFF_KEY = 'gaya-offline', OFF_CACHE = 'gaya-docs', OFF_URL = id => 'https://gaya-offline.local/doc/' + id;
const OFF_MEM = new Map(); // 기기 저장소를 못 쓰는 곳(체험판 미리보기 등)에서는 잠시 기억만
const offList = () => store.get(OFF_KEY, {}) || {};
const offInfo = id => offList()[id] || null;
const offOK = d => !!d && d.kind === 'file' && !(d.size > 50 * 1048576); // 폰에 저장할 수 있는 자료 (파일, 50MB 까지)
const offView = d => !!d && ['pdf', 'img'].includes(fileKind(d.name, d.kind)[0]); // 앱 안에서 바로 그려 보이는 종류
const offTotal = () => Object.values(offList()).reduce((a, x) => a + (x.size || 0), 0);
async function offPut(id, blob) { try { const c = await caches.open(OFF_CACHE); await c.put(OFF_URL(id), new Response(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream' } })); OFF_MEM.delete(id); } catch { OFF_MEM.set(id, blob); } }
async function offGet(id) { try { const c = await caches.open(OFF_CACHE); const r = await c.match(OFF_URL(id)); if (r) return await r.blob(); } catch {} return OFF_MEM.get(id) || null; }
async function offDel(id) { const l = offList(); delete l[id]; store.set(OFF_KEY, l); OFF_MEM.delete(id); if (S.viewer && S.viewer.id === id) closeViewer(); try { const c = await caches.open(OFF_CACHE); await c.delete(OFF_URL(id)); } catch {} }
function offPrune() { if (!S.ix || !online()) return; Object.keys(offList()).forEach(id => { if (!S.ix.doc.has(id)) offDel(id); }); }
async function saveOffline(id) {
  const d = S.ix.doc.get(id); if (!offOK(d)) return;
  if (!online()) return note('오프라인이라 지금은 폰에 저장할 수 없습니다. 연결되면 다시 누르세요.');
  S.offBusy = S.offBusy || {}; if (S.offBusy[id] != null) return;
  S.offBusy[id] = 0; render();
  try {
    const blob = await S.api.docFile(id, f => { S.offBusy[id] = f; progress(`폰에 저장하는 중 ${Math.round(f * 100)}% · ${d.name}`); });
    await offPut(id, blob);
    const l = offList(); l[id] = { size: blob.size, at: Date.now(), type: blob.type }; store.set(OFF_KEY, l);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
    if (!favs().has(id)) { const fs = favs(); fs.add(id); store.set(favKey(), [...fs]); }
    if (fileKind(d.name, d.kind)[0] === 'pdf') loadPdfLib().catch(() => {}); // 전파 없는 곳에서도 PDF 를 그릴 수 있게 미리 받아 둔다
    progress(null); note(offView(d) ? '폰에 저장했습니다 · 전파가 없어도 열립니다' : '폰에 저장했습니다 · 전파가 없어도 「파일 열기」로 휴대폰 앱에서 엽니다');
  } catch (e) { progress(null); toast(isNet(e) ? NET_MSG : e.message, true); }
  delete S.offBusy[id]; render();
}

/* 내 저장함 폴더 (사람·기기마다, 서버에는 저장하지 않음) */
const myKey = () => 'gaya-myfold-' + (S.user ? S.user.id : '');
const myData = () => { const d = store.get(myKey(), null) || {}; d.folders = d.folders || []; d.place = d.place || {}; return d; };
const mySave = d => store.set(myKey(), d);
const myIds = () => [...favs()].filter(id => S.ix && S.ix.doc.has(id));
const myKids = (md, pid) => md.folders.filter(f => (f.parent || null) === (pid || null)).sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
const myPath = (md, id) => { const out = []; let f = md.folders.find(x => x.id === id); while (f) { out.unshift(f); f = md.folders.find(x => x.id === f.parent); } return out; };
const myPlace = (md, docId) => md.folders.some(f => f.id === md.place[docId]) ? md.place[docId] : null;
const myDocsIn = (md, fid) => myIds().filter(id => myPlace(md, id) === (fid || null)).map(id => S.ix.doc.get(id)).sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
function flatMy(md, pid = null, depth = 0, out = []) { myKids(md, pid).forEach(n => { out.push({ n, depth }); flatMy(md, n.id, depth + 1, out); }); return out; }

/* PDF 보기 도구 (필요할 때만 받는다. 실제 앱은 앱 안 vendor 폴더, 체험판은 cdnjs) */
let pdfLibP = null;
function loadPdfLib() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfLibP) return pdfLibP;
  if (document.getElementById('pdfjs-main')) { // 체험판: 도구를 페이지 안에 담아 두었다 (바깥 주소를 쓰지 않고 이 화면 안에서 그린다)
    pdfLibP = new Promise((res, rej) => {
      try { ['pdfjs-worker', 'pdfjs-main'].forEach(id => { const sc = document.createElement('script'); sc.textContent = document.getElementById(id).textContent; document.head.appendChild(sc); }); if (!window.pdfjsLib) throw new Error('x'); res(window.pdfjsLib); }
      catch { pdfLibP = null; rej(new Error('PDF 보기 도구를 불러오지 못했습니다.')); }
    });
    return pdfLibP;
  }
  const base = window.PDFJS_BASE || (DEMO ? 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/' : 'vendor/');
  pdfLibP = new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = base + 'pdf.min.js';
    sc.onload = () => { if (!window.pdfjsLib) { pdfLibP = null; return rej(new Error('PDF 보기 도구를 불러오지 못했습니다.')); } pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js'; res(pdfjsLib); };
    sc.onerror = () => { pdfLibP = null; sc.remove(); rej(new Error('PDF 보기 도구를 불러오지 못했습니다. 인터넷에 한 번 연결된 상태에서 이 자료를 열어 두면 다음부터는 전파 없이도 열립니다.')); };
    document.head.appendChild(sc);
  });
  if (!DEMO && /^https?:/.test(location.protocol)) fetch(base + 'pdf.worker.min.js').catch(() => {});
  return pdfLibP;
}
/* 저장본 보기: 화면을 다시 그려도 PDF 를 다시 그리지 않도록 보기 칸을 따로 들고 있다가 끼워 넣는다 */
function closeViewer() { const v = S.viewer; S.viewer = null; if (!v) return; try { v.io && v.io.disconnect(); v.pdf && v.pdf.destroy(); v.url && URL.revokeObjectURL(v.url); } catch {} }
function afterRender() {
  const slot = $('#offview'); if (!slot) return;
  const id = slot.dataset.id;
  if (S.viewer && S.viewer.id === id) { if (S.viewer.el.parentNode !== slot) slot.replaceChildren(S.viewer.el); return; }
  closeViewer();
  const el = document.createElement('div'); el.className = 'pdfpages'; el.innerHTML = `<div class="viewer-page">${ic('docs')}<div>폰에 저장된 파일을 여는 중…</div></div>`;
  const v = S.viewer = { id, el }; slot.replaceChildren(el);
  (async () => {
    const blob = await offGet(id);
    if (S.viewer !== v) return;
    if (!blob) { el.innerHTML = `<div class="viewer-page">${ic('warn')}<div>폰에 저장된 파일이 지워졌습니다.<br>인터넷이 될 때 다시 저장하세요.</div></div>`; const l = offList(); delete l[id]; store.set(OFF_KEY, l); return; }
    if ((blob.type || '').startsWith('image/')) { v.url = URL.createObjectURL(blob); el.innerHTML = `<img src="${v.url}" alt="" style="display:block;width:100%">`; return; }
    try {
      const lib = await loadPdfLib(); const pdf = v.pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      if (S.viewer !== v) { pdf.destroy(); return; }
      const first = await pdf.getPage(1); const vp1 = first.getViewport({ scale: 1 });
      el.innerHTML = Array.from({ length: pdf.numPages }, (_, i) => `<div class="pg" data-p="${i + 1}" style="aspect-ratio:${vp1.width}/${vp1.height}"><span>${i + 1}</span></div>`).join('') + `<div class="pgnote">${pdf.numPages}쪽 · 두 손가락으로 벌리면 크게 보입니다</div>`;
      const draw = async box => {
        if (box.dataset.done) return; box.dataset.done = '1';
        const pg = await pdf.getPage(+box.dataset.p); const vp = pg.getViewport({ scale: 1 });
        const w = Math.min(2200, Math.round((box.clientWidth || 360) * Math.min(3, (window.devicePixelRatio || 1) * 1.5)));
        const sv = pg.getViewport({ scale: w / vp.width }); const c = document.createElement('canvas'); c.width = Math.round(sv.width); c.height = Math.round(sv.height);
        box.style.aspectRatio = vp.width + '/' + vp.height;
        await pg.render({ canvasContext: c.getContext('2d'), viewport: sv }).promise; box.replaceChildren(c);
      };
      v.io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) draw(e.target).catch(() => {}); }), { rootMargin: '800px 0px' });
      el.querySelectorAll('.pg').forEach(b => v.io.observe(b));
    } catch (e) { if (S.viewer === v) el.innerHTML = `<div class="viewer-page">${ic('warn')}<div>${esc(/[가-힣]/.test(e && e.message || '') ? e.message : 'PDF 를 열지 못했습니다. 인터넷이 될 때 「드라이브에서 보기」로 열어 보세요.')}</div></div>`; }
  })();
}

Object.assign(ACT, {
  /* 담기 · 한 번에 출고 */
  cartAdd: () => {
    const s = S.sheet; if (!s) return; const d = s.d; const bad = m => { s.err = m; render(); };
    if (!d.location_id) return bad('꺼내는 위치를 고르세요.');
    if (!isInt(d.qty, 1)) return bad('수량을 1 이상의 정수로 입력하세요.');
    const rows = cart(); const have = qtyAt(d.item_id, d.location_id);
    const hit = rows.find(r => r.item_id === d.item_id && r.location_id === d.location_id);
    const sum = (hit ? hit.qty : 0) + +d.qty;
    if (sum > have) return bad(`이 위치에는 ${have}개밖에 없습니다${hit ? ` (이미 ${hit.qty}개 담음)` : ''}. 수량이나 위치를 확인하세요.`);
    if (hit) hit.qty = sum; else rows.push({ item_id: d.item_id, location_id: d.location_id, qty: +d.qty });
    if (siteText(d)) S.cartSite = { site: d.site, dong: d.dong, ho: d.ho };
    saveCart(); S.sheet = null; render();
    note(`담았습니다 · 담은 자재 ${rows.length}가지 — 아래 「한 번에 출고」를 누르면 끝납니다`);
  },
  cartOpen: () => { if (!cart().length) return; openSheet('cart', { ...(S.cartSite || {}) }); },
  cartStep: d => { const s = S.sheet; if (!s) return; const i = +d.i; const r = cart()[i]; if (!r) return; const v = Math.max(1, (parseInt(s.d['cq_' + i] ?? r.qty, 10) || 0) + +d.d); s.d['cq_' + i] = String(v); r.qty = v; saveCart(); render(); },
  cartDel: d => { const s = S.sheet; if (!s) return; cartSync(); const rows = cart(); rows.splice(+d.i, 1); Object.keys(s.d).filter(k => k.startsWith('cq_')).forEach(k => delete s.d[k]); saveCart(); if (!rows.length) { S.sheet = null; note('담은 자재를 모두 뺐습니다'); } render(); },
  cartClear: () => { S.cart = []; saveCart(); S.cartSite = null; S.sheet = null; render(); note('담은 자재를 비웠습니다'); },

  /* 한 번에 입고 (발주 목록에서) */
  ordIn: () => {
    const rows = orderRows().filter(r => r.on && r.qty > 0); if (!rows.length) return note('입고할 품목을 체크하고 수량을 적으세요.');
    const d = {}; rows.forEach(r => { const best = (S.ix.byItem.get(r.id) || []).slice().sort((a, b) => b.qty - a.qty)[0]; d['rl_' + r.id] = best ? best.location_id : (S.lastRecvLoc && S.ix.loc.has(S.lastRecvLoc) ? S.lastRecvLoc : ''); });
    openSheet('recv', d);
  },
  recvStep: d => { const s = S.sheet; if (!s) return; const r = orderRows().find(x => x.id === d.id); if (!r) return; const v = Math.max(1, (parseInt(s.d['rq_' + d.id] ?? r.qty, 10) || 0) + +d.d); s.d['rq_' + d.id] = String(v); r.qty = v; render(); },

  /* 내 저장함 */
  docsMode: d => { S.docsQ = ''; S.docSearchRes = null; resetStack(d.m === 'mine' ? { tab: 'docs', view: 'mine', folder: null } : { ...ROOTS.docs }); },
  myOpen: d => { if (!d.id) return resetStack({ tab: 'docs', view: 'mine', folder: null }); const i = S.stack.findIndex(r => r.view === 'mine' && r.folder === d.id); if (i >= 0) { S.stack = S.stack.slice(0, i + 1); render(); window.scrollTo(0, 0); } else nav({ tab: 'docs', view: 'mine', folder: d.id }); },
  myMkdir: () => openSheet('myFolder', { parent: route().view === 'mine' ? route().folder || null : null }),
  myMkdirHere: () => { const s = S.sheet; if (!s) return; openSheet('myFolder', { parent: null, thenMove: s.d.id }); },
  myRename: d => { const f = myData().folders.find(x => x.id === d.id); if (f) openSheet('myFolder', { id: f.id, name: f.name }); },
  myDelFolder: d => { const md = myData(); const f = md.folders.find(x => x.id === d.id); if (!f) return; ask(`「${f.name}」 폴더를 지울까요?`, '안에 있던 자료와 폴더는 한 칸 위로 옮겨집니다. 자료는 지워지지 않습니다.', 'myDelFolder', { id: f.id, ok: '폴더 지우기', danger: true }); },
  myDocMenu: d => openSheet('myDocMenu', { id: d.id }),
  myMoveOpen: d => openSheet('myMove', { id: d.id, target: myPlace(myData(), d.id) }),
  myRemove: d => { S.sheet = null; ACT.fav({ id: d.id }); },
  mySaveAll: async () => { for (const id of myIds()) { const doc = S.ix.doc.get(id); if (offOK(doc) && !offInfo(id) && online()) await saveOffline(id); } },

  /* 위치 한 번에 만들기 */
  locBulk: () => openSheet('locBulk', { zone: null, utype: '선반', from: '1', to: '4', slots: '' }),
  lbType: d => { const s = S.sheet; if (!s) return; s.d.utype = d.v; render(); },
  lbSlots: d => { const s = S.sheet; if (!s) return; s.d.slots = d.v; render(); },

  /* 현장별 사용 이력 */
  sites: () => { S.sitesQ = ''; nav({ tab: 'items', view: 'sites' }); },
  site: d => { const r = route(); if (r.view === 'site' && r.name === d.v) return; S.siteHo = ''; toItemsTab(); nav({ tab: 'items', view: 'site', name: d.v }); },
  siteHo: d => { S.siteHo = d.v; render(); },

  /* 재고 실사 */
  countOpen: d => nav({ tab: 'items', view: 'count', node: d.id }),
  cntStep: d => { const loc = route().node; const c = countState(loc); const cur = c.vals[d.id]; const base = isInt(cur) ? +cur : qtyAt(d.id, loc); c.vals[d.id] = String(Math.max(0, base + +d.d)); countSaveLocal(); render(); },
  cntAdd: d => { countAdd(route().node, d.id); S.cntQ = ''; const qi = $('#q-cnt'); if (qi) qi.value = ''; render(); const el = document.getElementById('cnt-' + d.id); if (el) el.focus(); },
  cntNewItem: () => openSheet('item', { unit: '개', countLoc: route().node }),
  cntReset: () => { const a = countAll(); delete a[route().node]; countSaveLocal(); render(); note('실사하던 수량을 처음대로 돌렸습니다'); },
  cntSave: () => {
    const loc = route().node; const { out, bad } = countChanges(loc);
    if (bad.length) return toast(itemTitle(S.ix.item.get(bad[0])) + ': 수량을 0 이상의 정수로 적으세요.', true);
    if (!out.length) return note('바뀐 수량이 없습니다.');
    const c = countState(loc); c.op = c.op || opId(); countSaveLocal();
    run(() => S.api.stockCount({ location_id: loc, rows: out, reason: '실사', op_id: c.op }), n => `${n}개 품목 수량을 맞췄습니다 · 활동 기록에 「수량 정정(실사)」으로 남습니다`).then(ok => { if (ok === false) return; const a = countAll(); delete a[loc]; countSaveLocal(); render(); });
  },
  cntNext: () => { S.countNext = true; goTab('scan'); note('다음 선반의 QR을 찍으면 바로 실사 화면이 열립니다'); },

  /* 발주 목록 */
  order: () => { if (!S.order) orderInit(); nav({ tab: 'items', view: 'order' }); },
  ordReset: () => { orderInit(); render(); note('재고 부족 품목으로 다시 채웠습니다'); },
  ordToggle: (d, el) => { const r = orderRows().find(x => x.id === d.id); if (r) r.on = el.checked; setTimeout(render, 0); },
  ordStep: d => { const r = orderRows().find(x => x.id === d.id); if (!r) return; r.qty = Math.max(0, (r.qty || 0) + +d.d); render(); },
  ordAdd: d => { if (!S.order) orderInit(); if (!S.order.rows.some(r => r.id === d.id)) S.order.rows.push({ id: d.id, qty: 1, on: true }); S.ordQ = ''; const qi = $('#q-ord'); if (qi) qi.value = ''; render(); },
  ordDel: d => { S.order.rows = S.order.rows.filter(r => r.id !== d.id); render(); },
  ordShare: () => { if (!orderRows().some(r => r.on && r.qty > 0)) return note('보낼 품목이 없습니다. 수량을 적거나 체크하세요.'); shareOut('발주 목록', orderText()); },
  ordCsv: () => {
    const rows = orderRows().filter(r => r.on && r.qty > 0); if (!rows.length) return note('보낼 품목이 없습니다.');
    const n = new Date();
    downloadCSV(`가야자재_발주_${ymd(n)}.csv`, [['제조사', '품명', '규격', '발주 수량', '단위', '지금 재고', '최소 재고'], ...rows.map(r => { const it = S.ix.item.get(r.id); return [it.maker || '', it.name, it.spec || '', r.qty, it.unit, total(it.id), it.min_qty]; })]);
    if (DEMO) note('체험판 화면에서는 파일이 안 받아질 수 있습니다. 실제 앱에서는 바로 받아집니다.'); else toast('발주 목록을 엑셀 파일로 받았습니다');
  },

  /* 자료: 폰에 저장 · 파일 받기 */
  offSave: d => { const s = favs(); if (!s.has(d.id)) { s.add(d.id); store.set(favKey(), [...s]); } saveOffline(d.id); },
  driveView: d => { S.driveView = S.driveView || {}; S.driveView[d.id] = !S.driveView[d.id]; render(); },
  docDownload: async d => {
    const doc = S.ix.doc.get(d.id); if (!doc) return;
    if (DEMO) return note('체험판 화면에서는 파일이 받아지지 않습니다. 실제 앱에서는 폰의 「다운로드」에 저장됩니다.');
    let blob = offInfo(d.id) ? await offGet(d.id) : null;
    if (!blob) {
      if (!online()) return toast('오프라인이라 받을 수 없습니다. 연결되면 다시 누르세요.', true);
      try { blob = await S.api.docFile(d.id, f => progress(`파일 받는 중 ${Math.round(f * 100)}% · ${doc.name}`)); progress(null); }
      catch (e) { progress(null); return toast(isNet(e) ? NET_MSG : e.message, true); }
    }
    downloadBlob(doc.name, blob); toast('파일을 받았습니다 · 폰의 「다운로드」(아이폰은 「파일」 앱)에서 열 수 있습니다');
  },
  offClear: () => ask('폰에 저장한 자료를 모두 지울까요?', `${Object.keys(offList()).length}개 · ${fmtSize(offTotal())} · 즐겨찾기는 그대로 두고 폰에 저장한 파일만 지웁니다. 다시 열 때는 인터넷이 필요합니다.`, 'offClear', { ok: '지우기', danger: true }),

  /* 사용 통계 · 최소 재고 추천 */
  stats: () => nav({ tab: 'more', view: 'stats', month: thisMonth() }),
  statsMonth: d => { const r = route(); const m = shiftMonth(r.month, +d.d); if (m > thisMonth()) return; nav({ ...r, month: m }, true); },
  minToggle: (d, el) => { S.minOff = S.minOff || new Set(); el.checked ? S.minOff.delete(d.id) : S.minOff.add(d.id); setTimeout(render, 0); },
  minApply: () => {
    const rows = (vd().recs || []).filter(x => !(S.minOff && S.minOff.has(x.id))).map(x => ({ id: x.id, min_qty: x.rec }));
    if (!rows.length) return note('반영할 품목을 체크하세요.');
    ask(`최소 재고 ${rows.length}개를 바꿀까요?`, '추천한 값으로 바꿉니다. 품목 화면에서 언제든 다시 고칠 수 있고, 활동 기록에 남습니다.', 'minApply', { rows, ok: rows.length + '개 바꾸기' });
  },
  poster: () => nav({ tab: 'more', view: 'poster' }),
  shareApp: () => { const url = CONFIG.APP_URL || (DEMO ? 'https://gaya-elevator.github.io/' : location.origin + location.pathname);
    shareOut('앱 주소 보내기', `[가야엘리베이터] 자재·자료 앱\n아래 주소를 누르면 열립니다.\n${url}\n① 「가입 신청」에서 사내번호·이름·비밀번호를 적고, 관리자가 승인하면 바로 씁니다.\n② 홈 화면에 추가해 두면 앱처럼 아이콘으로 열립니다.`); },
  printPoster: () => { if (DEMO) return note('체험판 화면에서는 인쇄 창이 열리지 않습니다. 실제 앱에서는 바로 인쇄되고, 인쇄 창에서 「PDF로 저장」도 됩니다.'); document.body.classList.add('print-poster'); window.print(); setTimeout(() => document.body.classList.remove('print-poster'), 500); }
});
Object.assign(CONFIRM, {
  offClear: async () => { S.sheet = null; for (const id of Object.keys(offList())) await offDel(id); render(); note('폰에 저장한 자료를 지웠습니다'); },
  minApply: d => run(() => S.api.itemsMinSet(d.rows, d.op_id), n => `${n}개 품목의 최소 재고를 바꿨습니다`).then(ok => { if (ok !== false) { S.minOff = null; } }),
  myDelFolder: d => { const md = myData(); const f = md.folders.find(x => x.id === d.id); S.sheet = null; if (!f) return render();
    md.folders.forEach(x => { if (x.parent === f.id) x.parent = f.parent || null; });
    Object.keys(md.place).forEach(k => { if (md.place[k] === f.id) { if (f.parent) md.place[k] = f.parent; else delete md.place[k]; } });
    md.folders = md.folders.filter(x => x.id !== f.id); mySave(md);
    if (route().view === 'mine' && route().folder === f.id) { S.stack.pop(); if (!S.stack.length) S.stack = [{ tab: 'docs', view: 'mine', folder: null }]; }
    render(); toast('폴더를 지웠습니다 · 안의 자료는 위로 옮겼습니다'); }
});

/* 로그인 뒤: 기본 자료를 받고 첫 화면을 연다. keepNav 면 보고 있던 화면을 그대로 둔다 (오프라인 저장본으로 먼저 연 경우) */
async function afterLogin({ keepNav = false } = {}) {
  S.authErr = '';
  if (!keepNav) { S.stack = [{ ...ROOTS.items }]; S.tab = 'items'; S.lastTab = {}; }
  store.set('gaya-user', S.user);
  try { await loadCache(); S.serverDown = false; }
  catch (e) {
    const c = store.get('gaya-cache', null);
    if (c) { S.cache = c; S.ix = buildIndex(c); if (isNet(e)) S.serverDown = online(); else toast(e.message, true); }
    else { S.cache = EMPTY_CACHE(); S.ix = buildIndex(S.cache); toast(isNet(e) ? NET_MSG : e.message, true); }
  }
  render(); ensureTrap(); onEnterRoute();
  S.recentSites = store.get('gaya-sites', S.recentSites || []); S.mySites = store.get('gaya-mysites', []);
  S.api.txList({ limit: 80 }).then(l => { S.recentSites = [...new Set([...l.map(t => t.site).filter(Boolean), ...S.recentSites])].slice(0, 40); store.set('gaya-sites', S.recentSites); }).catch(() => {});
  openDeep();
  if (!store.get('gaya-tour', false) && !S.sheet) { store.set('gaya-tour', true); openSheet('tour', { step: 0 }); } // 이 기기에서 처음 로그인했을 때 한 번
}
function findLoc(code) { code = String(code || '').trim().toUpperCase(); if (!code) return null; return (S.cache ? S.cache.locations : []).find(l => (l.code || '').toUpperCase() === code || l.id === code) || null; }
/* QR 라벨 주소(?loc=코드)로 열린 경우: 시작할 때 주소에서 떼어 두었다가 화면이 준비되면 그 위치를 연다 */
function takeDeepCode() {
  let code = null; try { code = new URLSearchParams(location.search).get('loc'); } catch {}
  return code;
}
function openDeep() {
  if (!S.deepCode || !S.cache || !S.user) return;
  const code = S.deepCode; S.deepCode = null; const l = findLoc(code);
  if (l) ACT.loc({ id: l.id }); else toast('라벨 코드 「' + code + '」 위치가 앱에 없습니다.', true);
}

/* 파일 올리기 */
async function uploadFiles(files) {
  if (!files.length) return; const fid = route().folder;
  if (!fid) return toast('폴더를 먼저 여세요.', true);
  if (!online()) return toast('오프라인이라 올릴 수 없습니다. 연결되면 다시 해 주세요.', true);
  let ok = 0; let lastTarget = null; const fails = [];
  for (let i = 0; i < files.length; i++) {
    progress(`올리는 중 ${i + 1}/${files.length} · ${files[i].name}`);
    try { const r = await S.api.upload(fid, files[i]); ok++; lastTarget = r.folder_id; }
    catch (e) { fails.push(files[i].name + ': ' + (isNet(e) ? '연결이 끊김' : e.message)); }
  }
  try { await loadCache(); } catch {}
  render();
  const moved = lastTarget && lastTarget !== fid;
  if (fails.length) toast((ok ? ok + '개 올림 · ' : '') + fails.length + '개 실패 — ' + fails.join(' / '), true);
  else toast(ok + '개 올렸습니다' + (moved ? ' · ' + folderPathText(lastTarget) + ' 폴더로 정리됨' : ''), false, null, moved);
}
async function pickPhoto(file) {
  if (!file) return; const t = S.photoTarget; if (!t) return;
  try {
    progress('사진 올리는 중…');
    const blob = await shrinkImage(file, 900, .78);
    const url = S.api.putPhoto ? await S.api.putPhoto(blob) : await blobToDataURL(blob);
    progress(null);
    if (t.type === 'sheet' && S.sheet) { S.sheet.d.photo = url; render(); }
    else if (t.type === 'item') run(() => S.api.saveItem({ id: t.id, photo: url }), '사진을 저장했습니다');
  } catch (e) { progress(null); toast(isNet(e) ? '연결이 끊겨 사진을 올리지 못했습니다. 연결되면 다시 해 주세요.' : e.message, true); }
}

/* ───────── QR 스캔 ───────── */
let scanStream = null, scanLoop = null;
async function startScan() {
  const msg = t => { const m = $('#scanmsg'); if (m) m.textContent = t; };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return msg('이 브라우저는 카메라를 쓸 수 없습니다. 코드를 직접 입력하세요.');
  if (scanStream) return;
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch { return msg(DEMO ? '체험판 화면에서는 카메라를 쓸 수 없습니다. 아래에서 라벨을 골라 보세요.' : '카메라 권한이 필요합니다. 주소창 옆 자물쇠(아이폰은 설정 › Safari › 카메라)에서 허용하세요.'); }
  const v = $('#scanvid'); if (!v || route().view !== 'scan') return stopScan();
  v.srcObject = scanStream; v.hidden = false; await v.play().catch(() => {}); msg('QR 라벨을 네모 안에 맞추세요');
  // 휴대폰에 QR 읽기 기능이 있으면 쓰고, 없거나 실패하면 jsQR 로 읽는다
  let det = null;
  try { if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) det = new BarcodeDetector({ formats: ['qr_code'] }); } catch {}
  const cv = document.createElement('canvas'); const cx = cv.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (!scanStream) return;
    const vid = $('#scanvid'); if (!vid || route().view !== 'scan') return stopScan();
    if (!vid.srcObject) { vid.srcObject = scanStream; vid.hidden = false; vid.play().catch(() => {}); }
    let text = null;
    if (det) { try { const r = await det.detect(vid); if (r[0]) text = r[0].rawValue; } catch { det = null; } }
    if (!text && !det && window.jsQR && vid.videoWidth) {
      try { const sc = Math.min(1, 720 / vid.videoWidth); cv.width = vid.videoWidth * sc | 0; cv.height = vid.videoHeight * sc | 0; cx.drawImage(vid, 0, 0, cv.width, cv.height); const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'dontInvert' }); if (r) text = r.data; } catch {}
    }
    if (text) { let code = text; try { code = new URL(text).searchParams.get('loc') || text; } catch {} const l = findLoc(code); if (l) { stopScan(); if (navigator.vibrate) navigator.vibrate(60); ACT.loc({ id: l.id }); return; } msg('앱에 없는 라벨입니다: ' + code); }
    scanLoop = setTimeout(tick, 200);
  };
  tick();
}
function stopScan() { clearTimeout(scanLoop); if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; } }

/* ───────── 시작 ─────────
   1) 이 폰에 받아 둔 내용이 있으면 바로 그 화면부터 보여 준다 (오프라인·느린 연결에서도 앱이 바로 열림)
   2) 그다음 서버에 로그인 상태를 확인하고 최신 내용으로 바꾼다
   3) 서버에 닿지 않으면 받아 둔 내용으로 조회만 할 수 있게 둔다 */
function ensureDom() {
  const add = (html) => document.body.insertAdjacentHTML('beforeend', html);
  if (!$('#app')) add('<div id="app"></div>');
  if (!$('#overlay')) add('<div id="overlay"></div>');
  if (!$('#toast')) add('<div id="toast"></div>');
  if (!$('#filepick')) add('<input type="file" id="filepick" multiple hidden>');
  if (!$('#photopick')) add('<input type="file" id="photopick" accept="image/*" hidden>');
}
async function boot() {
  ensureDom();
  S.deepCode = takeDeepCode();
  try { history.replaceState({ gayaBase: 1 }, '', location.pathname + location.hash); } catch {}
  S.api = DEMO ? makeDemoAPI() : makeLiveAPI();
  const cu = DEMO ? null : store.get('gaya-user', null), cc = DEMO ? null : store.get('gaya-cache', null);
  if (cu && cc && cu.status === 'active') {
    S.user = cu; S.cache = cc; S.ix = buildIndex(cc); S.recentSites = store.get('gaya-sites', []); S.mySites = store.get('gaya-mysites', []); S.fromCache = true;
    render(); ensureTrap(); openDeep();
  } else { S.booting = !DEMO; render(); }
  if (!online()) { S.waitOnline = true; S.booting = false; render(); } // 연결되면 자동으로 확인한다
  else await connect();
  if (!DEMO) setInterval(() => { if (!document.hidden && S.user && S.cache && online() && !S.sheet && !S.busy && !S.waitOnline) refresh(); }, 30000);
}
async function connect() {
  const cachedId = S.fromCache && S.user ? S.user.id : null;
  let u;
  try { u = await withTimeout(S.api.session(), 12000); }
  catch (e) {
    S.booting = false;
    if (S.user && S.cache) { S.serverDown = online(); render(); return; } // 받아 둔 내용으로 계속 본다
    S.serverDown = online(); render(); return;
  }
  S.fromCache = false; S.serverDown = false; S.booting = false;
  if (u && u.status === 'active') { S.user = u; await afterLogin({ keepNav: cachedId === u.id }); }
  else { // 로그아웃되었거나 승인 대기 → 받아 둔 내용은 지운다
    if (cachedId) { store.del('gaya-cache'); store.del('gaya-user'); }
    S.user = u || null; S.cache = null; S.ix = null; S.stack = [{ ...ROOTS.items }]; S.tab = 'items'; render();
  }
}
boot();
