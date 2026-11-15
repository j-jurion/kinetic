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
      <label class="field" id="email-field" for="email">Email
        <input id="email" type="email" placeholder="you@example.com" autocomplete="email">
      </label>
      <label class="field" id="password-field" for="password">Password
        <input id="password" type="password" placeholder="Enter your password"
          autocomplete="current-password">
      </label>
      <button id="submit" type="submit">Sign in</button>
    </form>
    <p id="message" role="status"></p>
    <nav aria-label="Account options"><a href="/login">Sign in</a><a href="/register">Register</a>
      <a href="/forgot">Reset password</a><a href="/resend">Resend verification</a>
    </nav>
  </section>
</main>
<script>
const path = location.pathname;
const token = location.hash.slice(1);
if (token) history.replaceState(null, "", path);
const email = document.getElementById("email"), password = document.getElementById("password");
const form = document.getElementById("form"), message = document.getElementById("message");
document.getElementById("title").textContent = ({
  "/login":"Sign in", "/register":"Create account", "/forgot":"Reset password",
  "/verify":"Verify email", "/reset":"Choose a new password",
  "/resend":"Resend verification"
})[path];
document.getElementById("subtitle").textContent = ({
  "/login":"Welcome back. Sign in to view your activities.",
  "/register":"Create an account to start tracking your activities.",
  "/forgot":"Enter your email and we'll send you a reset link.",
  "/verify":"Confirm your email address to finish setting up your account.",
  "/reset":"Choose a new password for your account.",
  "/resend":"Enter your email to receive another verification link."
})[path];
document.getElementById("submit").textContent = ({
  "/login":"Sign in", "/register":"Create account", "/forgot":"Send reset link",
  "/reset":"Update password", "/resend":"Send verification link"
})[path] || "Continue";
if (path === "/register" || path === "/reset") password.autocomplete = "new-password";
if (path === "/forgot" || path === "/verify" || path === "/resend")
  document.getElementById("password-field").remove();
if (path === "/reset" || path === "/verify") document.getElementById("email-field").remove();
if (path === "/verify") form.style.display = "none";
async function post(url, body, formEncoded=false) {
  const response = await fetch(url, {method:"POST", credentials:"same-origin",
    headers:{"Content-Type": formEncoded ?
      "application/x-www-form-urlencoded" : "application/json"},
    body: formEncoded ? new URLSearchParams(body) : JSON.stringify(body)});
  if (!response.ok) {
    let data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
  }
}
form.addEventListener("submit", async event => {
  event.preventDefault(); message.textContent = "";
  try {
    if (path === "/login") {
      await post("/auth/cookie/login", {username:email.value, password:password.value}, true);
      location.assign("/");
    } else if (path === "/register") {
      await post("/auth/register", {email:email.value, password:password.value});
      message.textContent = "Check your email for a verification link.";
    } else if (path === "/forgot") {
      await post("/auth/forgot-password", {email:email.value});
      message.textContent = "If the account exists, a reset email will be sent.";
    } else if (path === "/resend") {
      await post("/auth/request-verify-token", {email:email.value});
      message.textContent = "If verification is needed, an email will be sent.";
    } else if (path === "/reset") {
      if (!token) throw new Error("Missing reset token");
      await post("/auth/reset-password", {token, password:password.value});
      message.textContent = "Password updated. Sign in again.";
    }
  } catch (error) { message.textContent = error.message; }
});
if (path === "/verify") {
  if (!token) message.textContent = "Missing verification token";
  else post("/auth/verify", {token})
    .then(() => { message.textContent = "Email verified. You can now sign in."; })
    .catch(error => { message.textContent = error.message; });
}
</script></body></html>"""


@router.get("/login", response_class=HTMLResponse)
@router.get("/register", response_class=HTMLResponse)
@router.get("/forgot", response_class=HTMLResponse)
@router.get("/verify", response_class=HTMLResponse)
@router.get("/reset", response_class=HTMLResponse)
@router.get("/resend", response_class=HTMLResponse)
def account_page() -> HTMLResponse:
    return HTMLResponse(
        PAGE, headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}
    )
