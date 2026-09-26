// 売掛ウォッチの接続先（秘密ではない値だけを置く。公開リポジトリに載る）
window.AR_CONFIG = {
  // GAS の Webアプリ（本番用デプロイ @2、2026-09-26 W6。計画 §6-20）の /exec。空にすると画面が「接続先が未設定」を出す
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxv-ZVZ_wFPMfqWinjJxHp6e3O-7aMv4esQ1z_Y8gNp0d6UAcmUfqmn7RpRldBw1rlm/exec',
  // Google サインイン用の OAuth クライアント ID（gas-ar-app/ar-config.gs の AR_GOOGLE_CLIENT_ID と同じ値）
  GOOGLE_CLIENT_ID: '426013466468-7403io6sj5ctmgnqsdk1ttsv5sihhktv.apps.googleusercontent.com',
  // 1回の送信を待つ上限（計画 §6-10 案A）。超えたら打ち切り、一覧は1回だけ取り直し、保存は最新の状態を読み直す
  TIMEOUT_MS: 15000,
  // これを超えたら「応答を待っています」を出す
  SLOW_NOTICE_MS: 5000
};
