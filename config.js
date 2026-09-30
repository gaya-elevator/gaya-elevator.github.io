/* 가야 자재·자료 — 연결 설정
   SUPABASE_URL / SUPABASE_ANON_KEY : Supabase › Project Settings › API Keys (Publishable key, 공개해도 되는 값)
   DRIVE_STORES : 자료 저장소(구글 앱스 스크립트 웹앱 주소). 저장소를 늘리면 { no: 2, url: '...' } 를 뒤에 추가
   비밀 키(secret key)는 절대 이 파일에 넣지 않는다 */
window.GAYA_CONFIG = {
  SUPABASE_URL: 'https://vzjtprwzolvzyvudeqnk.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_6fwIlURBNuS_vxMqt6B6PQ_5WhKdaXG',
  DRIVE_STORES: [
    { no: 1, url: 'https://script.google.com/macros/s/AKfycbxDKn8LHriwkRiZJV9RdaXFRbK8guNnKMS9WWAhvofvsxzWFBuBtQkOaDr20xGJmBHLuw/exec' }
  ],
  APP_URL: 'https://gaya-elevator.github.io/',
  EMAIL_DOMAIN: 'gaya.local'
};
