"""Minimal browser forms for account management."""

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Kinetic account</title>
<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px 20px;
  background: radial-gradient(ellipse at 50% 0%, #fff3e8 0%, #f8fafc 55%);
  color: #111827;
  font: 16px/1.5 Inter, system-ui, -apple-system, sans-serif;
}
.auth-shell { width: min(100%, 440px); }
.brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 28px;
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -.04em;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: #f97316;
  color: white;
  box-shadow: 0 6px 16px rgba(249, 115, 22, .25);
}
.card {
  padding: 36px;
  border: 1px solid #e5e7eb;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 20px 55px rgba(15, 23, 42, .08);
}
.eyebrow {
  margin: 0 0 8px;
  color: #9a3412;
  font-size: 12px;
  font-weight: 750;
  letter-spacing: .12em;
  text-transform: uppercase;
}
h1 { margin: 0; font-size: 28px; line-height: 1.2; letter-spacing: -.04em; }
.subtitle { margin: 10px 0 26px; color: #6b7280; font-size: 14px; }
.field { display: block; margin-bottom: 18px; color: #374151; font-size: 14px; font-weight: 650; }
input {
  display: block;
  width: 100%;
  margin-top: 7px;
  padding: 12px 14px;
  border: 1px solid #d1d5db;
  border-radius: 9px;
  background: #fff;
  color: #111827;
  font: 16px/1.5 Inter, system-ui, -apple-system, sans-serif;
}
input::placeholder { color: #9ca3af; }
input:focus { border-color: #ea580c; outline: 3px solid #fed7aa; outline-offset: 0; }
button {
  width: 100%;
  margin-top: 6px;
  padding: 13px 16px;
  border: 0;
  border-radius: 9px;
  background: #c2410c;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}
button:hover { background: #9a3412; }
button:focus-visible, a:focus-visible { outline: 3px solid #fdba74; outline-offset: 3px; }
#message {
  margin: 18px 0 0;
  padding: 12px 14px;
  border: 1px solid #fed7aa;
  border-radius: 9px;
  background: #fff7ed;
  color: #7c2d12;
  font-size: 14px;
}
#message:empty { display: none; }
nav {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px 18px;
  margin-top: 26px;
  padding-top: 22px;
  border-top: 1px solid #f3f4f6;
  font-size: 13px;
}
a { color: #9a3412; font-weight: 600; text-decoration: none; }
a:hover { text-decoration: underline; }
@media (max-width: 480px) { .card { padding: 28px 22px; } }
</style></head><body>
<main class="auth-shell">
  <div class="brand">
    <span class="brand-mark" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13 2 4.5 13h6l-.5 9L19.5 10h-6L13 2z"></path>
      </svg>
    </span>
    <span>Kinetic</span>
  </div>
  <section class="card" aria-labelledby="title">
    <p class="eyebrow">Your activity, in motion</p>
    <h1 id="title">Sign in</h1>
    <p class="subtitle" id="subtitle">Welcome back. Sign in to view your activities.</p>
    <form id="form">
      <label class="field" for="username">Username
        <input id="username" type="text" placeholder="Your username" autocomplete="username"
          autocapitalize="none" spellcheck="false" required minlength="3" maxlength="32"
          pattern="[A-Za-z0-9][A-Za-z0-9_.\\-]{2,31}">
      </label>
      <label class="field" for="password">Password
        <input id="password" type="password" placeholder="Enter your password"
          autocomplete="current-password" required>
      </label>
      <button id="submit" type="submit">Sign in</button>
    </form>
    <p id="message" role="status"></p>
    <nav aria-label="Account options"><a href="/login">Sign in</a><a href="/register">Register</a>
    </nav>
  </section>
</main>
<script>
const register = location.pathname === "/register";
const username = document.getElementById("username");
const password = document.getElementById("password");
const form = document.getElementById("form"), message = document.getElementById("message");
if (register) {
  document.getElementById("title").textContent = "Create account";
  document.getElementById("subtitle").textContent =
    "Choose a username and a password of at least 12 characters.";
  document.getElementById("submit").textContent = "Create account";
  username.placeholder = "Choose a username";
  password.placeholder = "At least 12 characters";
  password.autocomplete = "new-password";
  password.minLength = 12;
}
form.addEventListener("submit", async event => {
  event.preventDefault(); message.textContent = "";
  try {
    const response = await fetch(register ? "/auth/register" : "/auth/login", {
      method: "POST", credentials: "same-origin",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({username: username.value, password: password.value})});
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
    }
    location.assign("/");
  } catch (error) { message.textContent = error.message; }
});
</script></body></html>"""


@router.get("/login", response_class=HTMLResponse)
@router.get("/register", response_class=HTMLResponse)
def account_page() -> HTMLResponse:
    return HTMLResponse(
        PAGE, headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}
    )
