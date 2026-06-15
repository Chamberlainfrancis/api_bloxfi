/**
 * Self-contained admin dashboard page, served by GET /dashboard.
 * Vanilla HTML/CSS/JS — no framework, no build step. Calls /dashboard/api/*.
 *
 * The inline <script> carries a per-request CSP nonce so it runs under the
 * app's helmet Content-Security-Policy (which otherwise blocks inline scripts).
 */

export function renderDashboardHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BloxFi Transactions</title>
<style>
  :root { --bg:#0f1419; --panel:#1a2230; --line:#2a3547; --txt:#e6edf3; --mut:#8b97a7; --accent:#3b82f6; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--txt); }
  header { padding:16px 24px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:16px; }
  header h1 { font-size:16px; margin:0; }
  header .warn { font-size:12px; color:#f59e0b; }
  .tabs { display:flex; gap:4px; padding:12px 24px 0; }
  .tab { padding:8px 16px; cursor:pointer; border:1px solid var(--line); border-bottom:none; border-radius:6px 6px 0 0; background:var(--panel); color:var(--mut); }
  .tab.active { color:var(--txt); background:var(--bg); border-color:var(--accent); }
  .toolbar { padding:12px 24px; display:flex; gap:12px; align-items:center; }
  select, button, input { font:inherit; }
  select { background:var(--panel); color:var(--txt); border:1px solid var(--line); border-radius:6px; padding:6px 10px; }
  button { background:var(--accent); color:#fff; border:none; border-radius:6px; padding:7px 14px; cursor:pointer; }
  button.ghost { background:transparent; border:1px solid var(--line); color:var(--txt); }
  button.danger { background:#dc2626; }
  button.ok { background:#16a34a; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:10px 24px; border-bottom:1px solid var(--line); font-size:13px; }
  th { color:var(--mut); font-weight:600; }
  tr.row { cursor:pointer; }
  tr.row:hover { background:var(--panel); }
  .badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; background:var(--panel); border:1px solid var(--line); }
  .badge.ok { color:#22c55e; border-color:#22c55e55; }
  .badge.fail { color:#ef4444; border-color:#ef444455; }
  .err { color:#ef4444; padding:8px 24px; }
  .muted { color:var(--mut); }
  dialog { background:var(--panel); color:var(--txt); border:1px solid var(--line); border-radius:10px; max-width:760px; width:92%; padding:0; }
  dialog::backdrop { background:rgba(0,0,0,.6); }
  .dhead { padding:16px 20px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; }
  .dbody { padding:16px 20px; max-height:70vh; overflow:auto; }
  .section { margin-bottom:18px; }
  .section h3 { margin:0 0 8px; font-size:13px; color:var(--accent); text-transform:uppercase; letter-spacing:.04em; }
  .kv { display:grid; grid-template-columns:160px 1fr; gap:4px 12px; }
  .kv div:nth-child(odd){ color:var(--mut); }
  pre { background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:10px; overflow:auto; font-size:12px; }
  .actions { display:flex; gap:8px; margin-top:8px; }
  .hist { font-size:12px; }
  .hist li { margin-bottom:6px; }
</style>
</head>
<body>
<header>
  <h1>BloxFi Transactions</h1>
  <span class="warn">⚠ Internal, no-auth dashboard — do not expose publicly</span>
</header>
<div class="tabs">
  <div class="tab active" data-type="onramp">Onramps</div>
  <div class="tab" data-type="offramp">Offramps</div>
</div>
<div class="toolbar">
  <label class="muted">Status</label>
  <select id="statusFilter"><option value="">All</option></select>
  <button class="ghost" id="reload">Reload</button>
</div>
<div id="err" class="err" style="display:none"></div>
<table>
  <thead><tr><th>Txn Ref</th><th>Status</th><th>User</th><th>Amount</th><th>Created</th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<div style="padding:16px 24px"><button class="ghost" id="more" style="display:none">Load more</button></div>

<dialog id="detail">
  <div class="dhead"><strong id="dTitle">Transaction</strong><button class="ghost" id="dClose">Close</button></div>
  <div class="dbody" id="dBody"></div>
</dialog>

<script nonce="${nonce}">
const ONRAMP_STATUSES = ["CREATED","AWAITING_FUNDS","FIAT_PENDING","FIAT_PROCESSED","CRYPTO_INITIATED","CRYPTO_PENDING","COMPLETED","FIAT_FAILED","FIAT_RETURNED","CRYPTO_FAILED","EXPIRED"];
const OFFRAMP_STATUSES = ["CREATED","AWAITING_CRYPTO","CRYPTO_PENDING","CRYPTO_RECEIVED","CRYPTO_CONFIRMED","PROCESSING_FEE","FEE_PROCESSED","FIAT_INITIATED","FIAT_PENDING","COMPLETED","FAILED","CANCELLED","REFUNDED","CRYPTO_FAILED","FIAT_FAILED","EXPIRED"];
const OK = new Set(["COMPLETED"]);
const FAIL = new Set(["FAILED","FIAT_FAILED","CRYPTO_FAILED","EXPIRED","CANCELLED"]);

let state = { type: "onramp", status: "", cursor: null };
const $ = (id) => document.getElementById(id);

function showErr(msg) { const e = $("err"); e.style.display = msg ? "block" : "none"; e.textContent = msg || ""; }
function badgeClass(s) { return OK.has(s) ? "badge ok" : FAIL.has(s) ? "badge fail" : "badge"; }
async function api(path, opts) {
  const res = await fetch("/dashboard/api" + path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json.error && json.error.message) || res.statusText);
  return json.data;
}

function fillStatusFilter() {
  const list = state.type === "onramp" ? ONRAMP_STATUSES : OFFRAMP_STATUSES;
  $("statusFilter").innerHTML = '<option value="">All</option>' + list.map((s) => '<option value="' + s + '">' + s + '</option>').join("");
}

// Escape dynamic values before they go into innerHTML/insertAdjacentHTML.
// Server data includes externally-influenced fields (txnRef, source/destination)
// and free-form notes — treat all of it as untrusted text.
function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function rowHtml(t) {
  const amt = t.amount != null ? esc(t.amount + " " + (t.currency || "")) : "—";
  return '<tr class="row" data-id="' + esc(t.id) + '">' +
    "<td>" + (t.txnRef ? esc(t.txnRef) : '<span class="muted">' + esc(t.id.slice(0, 8)) + "</span>") + "</td>" +
    '<td><span class="' + badgeClass(t.status) + '">' + esc(t.status) + "</span></td>" +
    '<td class="muted">' + esc(t.userId.slice(0, 8)) + "</td>" +
    "<td>" + amt + "</td>" +
    '<td class="muted">' + esc(new Date(t.createdAt).toLocaleString()) + "</td>" +
    "</tr>";
}

async function load(reset) {
  showErr("");
  if (reset) { state.cursor = null; $("rows").innerHTML = ""; }
  try {
    const q = new URLSearchParams({ type: state.type });
    if (state.status) q.set("status", state.status);
    if (state.cursor) q.set("cursor", state.cursor);
    const data = await api("/transactions?" + q.toString());
    $("rows").insertAdjacentHTML("beforeend", data.items.map(rowHtml).join(""));
    state.cursor = data.nextCursor;
    $("more").style.display = data.nextCursor ? "inline-block" : "none";
  } catch (e) { showErr(e.message); }
}

function kv(obj) {
  return Object.entries(obj).map(([k, v]) =>
    "<div>" + esc(k) + "</div><div>" + (v == null ? "—" : esc(v)) + "</div>"
  ).join("");
}

async function openDetail(id) {
  showErr("");
  try {
    const t = await api("/transactions/" + state.type + "/" + id);
    $("dTitle").textContent = (t.txnRef || id) + "  ·  " + t.status;
    const dest = t.destination || {};
    const src = t.source || {};
    const hist = (t.adminActions || []).map((a) =>
      "<li>" + esc(new Date(a.createdAt).toLocaleString()) + " — <b>" + esc(a.fromStatus) + " → " + esc(a.toStatus) + "</b>" +
      (a.actor ? " by " + esc(a.actor) : "") + (a.note ? ': "' + esc(a.note) + '"' : "") + "</li>"
    ).join("") || '<li class="muted">No manual actions yet.</li>';
    $("dBody").innerHTML =
      '<div class="section"><h3>Destination</h3><pre>' + esc(JSON.stringify(dest, null, 2)) + "</pre></div>" +
      '<div class="section"><h3>Source</h3><pre>' + esc(JSON.stringify(src, null, 2)) + "</pre></div>" +
      '<div class="section"><h3>Summary</h3><div class="kv">' +
        kv({ id: t.id, txnRef: t.txnRef, userId: t.userId, status: t.status, failedReason: t.failedReason, createdAt: t.createdAt, updatedAt: t.updatedAt }) +
      "</div></div>" +
      '<div class="section"><h3>Manage</h3><div class="actions">' +
        '<button class="ok" id="markOk">Mark Successful</button>' +
        '<button class="danger" id="markFail">Mark Failed</button>' +
      "</div></div>" +
      '<div class="section"><h3>Action history</h3><ul class="hist">' + hist + "</ul></div>";
    $("markOk").onclick = () => mark(id, "success");
    $("markFail").onclick = () => mark(id, "failed");
    $("detail").showModal();
  } catch (e) { showErr(e.message); }
}

async function mark(id, outcome) {
  const note = prompt("Note for marking this transaction " + outcome + " (why?):", "");
  if (note === null) return;
  const actor = prompt("Your name (optional):", "") || undefined;
  try {
    await api("/transactions/" + state.type + "/" + id + "/mark", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome, note, actor }),
    });
    $("detail").close();
    await load(true);
  } catch (e) { showErr(e.message); }
}

document.querySelectorAll(".tab").forEach((el) => el.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  el.classList.add("active");
  state.type = el.dataset.type; state.status = "";
  fillStatusFilter();
  load(true);
}));
$("statusFilter").addEventListener("change", (e) => { state.status = e.target.value; load(true); });
$("reload").addEventListener("click", () => load(true));
$("more").addEventListener("click", () => load(false));
$("dClose").addEventListener("click", () => $("detail").close());
$("rows").addEventListener("click", (e) => {
  const tr = e.target.closest("tr.row");
  if (tr) openDetail(tr.dataset.id);
});

fillStatusFilter();
load(true);
</script>
</body>
</html>`;
}
