// AIのモデルの割り当て（ここだけで変える）
// - 宿泊係（案内の下書き・訳し戻し）＝ Sonnet：速くて安い
// - 監査役（出す前の最終チェック）＝ Opus：見落としを減らす
// - 番頭（予約メールの書き写し）＝ Sonnet：決まった項目を写すだけ。正しさはプログラムが確かめる
export const MODELS = {
  banto: "claude-sonnet-5-5",
  shukuhaku: "claude-sonnet-5-5",
  kansa: "claude-opus-5-5",
  // 経理担当（明細の列の対応の案・ずれの理由の候補）＝ Sonnet：正しさはプログラムが計算で確かめる
  keiri: "claude-sonnet-5-5",
  // 案内係（ゲストの質問から行き先を読む・説明の文）＝ Sonnet：時刻はプログラムが出すので、文だけ。
  // Haiku にしない理由：混んだときの代わりのモデルがなく、考える量・決まった形の出力の対応も確かめられていないため
  annai: "claude-sonnet-5-5",
};

// アプリ全体のAI呼び出しの上限（デモ用・1日あたり）。Anthropic 側の月の上限とは別にかける
export const DAILY_AI_CALL_LIMIT = 100;
