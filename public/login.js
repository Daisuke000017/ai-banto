// ログイン画面：パスワードを JSON で送る（CSP で form の送信は止めているため）
// 公開したサイトでは、Cloudflare のロボット除け（Turnstile）の確認も一緒に送る
const form = document.getElementById("login-form");
const input = document.getElementById("password");
const msg = document.getElementById("msg");
const submit = document.getElementById("submit");
const robotBox = document.getElementById("turnstile");

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let siteKey = null;
let widgetId = null;
let robotToken = "";

function showMsg(text) {
  msg.textContent = text;
  msg.hidden = false;
}

function resetRobot() {
  robotToken = "";
  if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
}

function renderRobot() {
  robotBox.hidden = false;
  widgetId = window.turnstile.render(robotBox, {
    sitekey: siteKey,
    action: "login",
    language: "ja",
    callback: (token) => {
      robotToken = token;
    },
    "expired-callback": () => {
      robotToken = "";
    },
    "error-callback": () => {
      robotToken = "";
      showMsg("ロボットではないことの確認ができませんでした。画面を読み直して、もう一度お試しください");
    },
  });
}

async function setupRobot() {
  try {
    const res = await fetch("/api/login-config");
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data?.turnstile_site_key !== "string" || !data.turnstile_site_key) return;
    siteKey = data.turnstile_site_key;
  } catch {
    return;
  }
  const s = document.createElement("script");
  s.src = TURNSTILE_SRC;
  s.async = true;
  s.addEventListener("load", renderRobot);
  s.addEventListener("error", () => showMsg("ロボット除けの部品を読めませんでした。少し待ってから、画面を読み直してください"));
  document.head.append(s);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!input.value) {
    showMsg("パスワードを入れてください");
    input.focus();
    return;
  }
  if (siteKey && !robotToken) {
    showMsg("「ロボットではありません」の確認が終わるまで、少しお待ちください");
    return;
  }
  submit.disabled = true;
  msg.hidden = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: input.value, ...(siteKey ? { turnstile: robotToken } : {}) }),
    });
    if (res.ok) {
      location.replace("/");
      return;
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    // サーバーの決まった日本語だけを出す
    const known = res.status < 500 || res.status === 503;
    showMsg(known && data?.error ? data.error : "ログインできませんでした。少し待ってから、もう一度お試しください");
    input.value = "";
    input.focus();
  } catch {
    showMsg("つながりませんでした。少し待ってから、もう一度お試しください");
  } finally {
    // 確認の札は1回しか使えないので、送るたびに出し直す
    resetRobot();
    submit.disabled = false;
  }
});

setupRobot();
