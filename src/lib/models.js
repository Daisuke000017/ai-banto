// AIのモデルの割り当て（ここだけで変える）
// - 宿泊係（案内の下書き・訳し戻し）＝ Sonnet：速くて安い
// - 監査役（出す前の最終チェック）＝ Opus：見落としを減らす
export const MODELS = {
  shukuhaku: "claude-sonnet-5-5",
  kansa: "claude-opus-5-5",
};

// アプリ全体のAI呼び出しの上限（デモ用・1日あたり）。Anthropic 側の月の上限とは別にかける
export const DAILY_AI_CALL_LIMIT = 100;
