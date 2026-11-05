// ログイン画面：パスワードを JSON で送る（CSP で form の送信は止めているため）
const form = document.getElementById("login-form");
const input = document.getElementById("password");
const msg = document.getElementById("msg");
const submit = document.getElementById("submit");

function showMsg(text) {
  msg.textContent = text;
  msg.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!input.value) {
    showMsg("パスワードを入れてください");
    input.focus();
    return;
  }
  submit.disabled = true;
  msg.hidden = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: input.value }),
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
    showMsg(res.status < 500 && data?.error ? data.error : "ログインできませんでした。少し待ってから、もう一度お試しください");
    input.value = "";
    input.focus();
  } catch {
    showMsg("つながりませんでした。少し待ってから、もう一度お試しください");
  } finally {
    submit.disabled = false;
  }
});
