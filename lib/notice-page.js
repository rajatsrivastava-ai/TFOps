"use strict";
/* The page you get instead of the board when the deploy is not finished — no
   password set on a public host, or a remote store with nothing in it yet.
   It says the one command that fixes it, because the alternative is a stack
   trace in a log nobody is watching. */

module.exports = function noticePage({ title, lead, steps = [], tone = "warn" }) {
  const esc = (x) => String(x == null ? "" : x)
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const step = (s) => (typeof s === "string"
    ? `<li>${esc(s)}</li>`
    : `<li>${esc(s.text)}${s.code ? `<code>${esc(s.code)}</code>` : ""}</li>`);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)} · TFOps</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%236258e9'/><path d='M18 22h28M32 22v22' stroke='white' stroke-width='6' stroke-linecap='round'/></svg>">
<style>
:root{color-scheme:light;--plane:#f5f5f7;--surface:#fff;--ink:#010101;--ink-2:rgba(1,1,1,.62);
  --ink-3:rgba(1,1,1,.42);--line:rgba(1,1,1,.09);--grid:rgba(1,1,1,.055);--accent:#6258e9;
  --wash:#fdf3e3;--edge:#e0a63a}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--plane:#0d0d0f;--surface:#17171a;
  --ink:#f7f7f8;--ink-2:rgba(255,255,255,.68);--ink-3:rgba(255,255,255,.46);
  --line:rgba(255,255,255,.10);--grid:rgba(255,255,255,.05);--accent:#8b82f2;--wash:#2a2213}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
  background-color:var(--plane);background-image:radial-gradient(var(--grid) 1px,transparent 1px);
  background-size:22px 22px;color:var(--ink);
  font-family:Inter,"Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;
  font-size:14px;line-height:1.55;letter-spacing:-.006em;-webkit-font-smoothing:antialiased}
.box{width:100%;max-width:520px;background:var(--surface);border:1px solid var(--line);
  border-radius:28px;padding:32px 30px 28px;box-shadow:0 1px 3px rgba(1,1,1,.05),0 24px 56px -20px rgba(1,1,1,.22)}
.mark{display:inline-block;font-size:15px;font-weight:600;letter-spacing:-.03em;
  padding:3px 9px;border-radius:10px;background:var(--ink);color:var(--plane)}
h1{font-size:23px;font-weight:400;letter-spacing:-.03em;margin:18px 0 6px}
p{color:var(--ink-2);margin:0 0 18px}
ol{margin:0;padding-left:20px;color:var(--ink-2)}
li{margin:0 0 12px}
code{display:block;margin:7px 0 0;padding:9px 12px;border-radius:12px;background:var(--plane);
  border:1px solid var(--line);color:var(--ink);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:12.5px;overflow-x:auto;white-space:pre}
.tag{display:inline-block;font-size:11.5px;letter-spacing:.02em;padding:3px 9px;border-radius:999px;
  background:var(--wash);color:var(--ink-2);border:1px solid var(--line);margin-left:8px;vertical-align:2px}
</style></head>
<body><div class="box">
  <span class="mark">TFOps</span><span class="tag">${tone === "stop" ? "not serving" : "setup"}</span>
  <h1>${esc(title)}</h1>
  <p>${esc(lead)}</p>
  ${steps.length ? `<ol>${steps.map(step).join("")}</ol>` : ""}
</div></body></html>`;
};
