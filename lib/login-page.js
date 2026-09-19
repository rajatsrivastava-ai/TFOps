"use strict";
/* The login screen. Inline rather than a file in public/, because public/ is
   served without a session and this is the only page that needs to be. */

module.exports = function loginPage({ error = "", orgName = "TrueFan", admin = "your admin", names = [], name = "" } = {}) {
  const esc = (x) => String(x == null ? "" : x)
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign in · TFOps</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%236258e9'/><path d='M18 22h28M32 22v22' stroke='white' stroke-width='6' stroke-linecap='round'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap">
<style>
:root{
  color-scheme:light;
  --plane:#f5f5f7;--surface:#fff;--ink:#010101;--ink-2:rgba(1,1,1,.62);--ink-3:rgba(1,1,1,.42);
  --line:rgba(1,1,1,.09);--line-2:rgba(1,1,1,.16);--grid:rgba(1,1,1,.055);
  --accent:#6258e9;--accent-ink:#5242d2;--accent-ring:rgba(98,88,233,.28);
  --crit:#d03b3b;--crit-wash:#fae9e9;--crit-ink:#b42f2f;
}
@media (prefers-color-scheme:dark){:root{
  color-scheme:dark;
  --plane:#0d0d0f;--surface:#17171a;--ink:#f7f7f8;--ink-2:rgba(255,255,255,.68);--ink-3:rgba(255,255,255,.46);
  --line:rgba(255,255,255,.10);--line-2:rgba(255,255,255,.18);--grid:rgba(255,255,255,.05);
  --accent:#8b82f2;--accent-ink:#a8aeff;--crit-wash:#2e1414;--crit-ink:#e87070;
}}
*{box-sizing:border-box}
body{
  margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
  background-color:var(--plane);
  background-image:radial-gradient(var(--grid) 1px,transparent 1px);background-size:22px 22px;
  color:var(--ink);font-family:Inter,"Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;
  font-size:14px;line-height:1.5;letter-spacing:-.006em;-webkit-font-smoothing:antialiased;
}
.box{
  width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);
  border-radius:28px;padding:32px 30px 28px;
  box-shadow:0 1px 3px rgba(1,1,1,.05),0 24px 56px -20px rgba(1,1,1,.22);
}
.mark{
  display:inline-block;font-size:15px;font-weight:600;letter-spacing:-.03em;
  padding:3px 9px;border-radius:10px;background:var(--ink);color:var(--plane);
}
h1{font-size:23px;font-weight:400;letter-spacing:-.03em;margin:18px 0 4px}
p.sub{color:var(--ink-3);font-size:13px;margin:0 0 22px}
label{display:block;font-size:11.5px;color:var(--ink-3);font-weight:500;margin-bottom:5px}
input+label{margin-top:14px}
input{
  font:inherit;font-size:14px;color:var(--ink);background:var(--surface);
  border:1px solid var(--line-2);border-radius:10px;padding:10px 13px;width:100%;
}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-ring)}
button{
  font:inherit;font-size:14px;font-weight:500;cursor:pointer;width:100%;margin-top:14px;
  background:var(--accent);color:#fff;border:0;border-radius:999px;padding:11px 16px;
}
button:hover{background:var(--accent-ink)}
.err{
  background:var(--crit-wash);color:var(--crit-ink);font-size:12.5px;
  padding:9px 13px;border-radius:10px;margin-bottom:16px;
}
.foot{margin-top:20px;font-size:11.5px;color:var(--ink-3);line-height:1.5}
</style>
</head><body>
<form class="box" method="POST" action="/login">
  <span class="mark">TFOps</span>
  <h1>${esc(orgName)} operations</h1>
  <p class="sub">Project timeline, team status and the company overview.</p>
  ${error ? `<div class="err">${esc(error)}</div>` : ""}

  <label for="nm">Your name</label>
  <input id="nm" name="name" type="text" list="roster" autocomplete="username"
         placeholder="Start typing…" value="${esc(name)}" required ${name ? "" : "autofocus"}>
  <datalist id="roster">${names.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>

  <label for="pw" style="margin-top:14px">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password"
         required ${name ? "autofocus" : ""}>

  <button type="submit">Sign in</button>
  <div class="foot">Your name signs everything you post, so pick the one you are
    listed under on the board. Ask ${esc(admin)} for the password — leadership has a
    separate read-only one that cannot change anything.</div>
</form>
</body></html>`;
};
