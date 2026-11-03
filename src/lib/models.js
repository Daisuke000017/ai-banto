// AIのモデルの割り当て（ここだけで変える）
// - 宿泊係（案内の下書き・訳し戻し）＝ Sonnet：速くて安い
// - 監査役（出す前の最終チェック）＝ Opus：見落としを減らす
// - 番頭（予約メールの書き写し）＝ Sonnet：決まった項目を写すだけ。正しさはプログラムが確かめる
export const MODELS = {
  banto: "claude-sonnet-5-5",
  shukuhaku: "claude-sonnet-5-5",
  kansa: "claude-opus-5-5",
};

// アプリ全体のAI呼び出しの上限（デモ用・1日あたり）。Anthropic 側の月の上限とは別にかける
export const DAILY_AI_CALL_LIMIT = 100;
