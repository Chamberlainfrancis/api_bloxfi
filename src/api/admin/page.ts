/**
 * Self-contained admin dashboard page, served by GET /dashboard.
 * Vanilla HTML/CSS/JS — no framework, no build step. Calls /dashboard/api/*.
 *
 * The inline <script> carries a per-request CSP nonce so it runs under the
 * app's helmet Content-Security-Policy (which otherwise blocks inline scripts).
 *
 * The embedded JS uses string concatenation (no backticks / no ${...}) so the
 * only interpolation in this template literal is the nonce.
 */

/**
 * Sanitize numeric string to only [0-9.] for safe HTML interpolation.
 */
function sanitizeNumeric(v: string): string {
  return String(v).replace(/[^0-9.]/g, '') || '0.00000000';
}

export function renderDashboardHtml(nonce: string, totalProfitUsdc: string = '0.00000000'): string {
  const safeTotalProfitUsdc = sanitizeNumeric(totalProfitUsdc);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BloxFi Transactions</title>
<style>
  :root { --bg:#ffffff; --panel:#f4f6f8; --line:#e2e6ea; --txt:#1a2230; --mut:#5b6675; --accent:#2563eb; --ok:#15803d; --warn:#b45309; --bad:#dc2626; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--txt); }
  a { color:var(--accent); }
  header { padding:16px 24px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:16px; }
  header h1 { font-size:16px; margin:0; }
  header .warn { font-size:12px; color:var(--warn); }
  .tabs { display:flex; gap:4px; padding:14px 24px 0; }
  .tab { padding:9px 18px; cursor:pointer; border:1px solid var(--line); border-bottom:none; border-radius:8px 8px 0 0; background:var(--panel); color:var(--mut); font-weight:600; }
  .tab.active { color:var(--txt); background:var(--bg); border-color:var(--accent); }
  .toolbar { padding:12px 24px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  select, button, input { font:inherit; }
  select { background:var(--panel); color:var(--txt); border:1px solid var(--line); border-radius:8px; padding:7px 10px; }
  button { background:var(--accent); color:#fff; border:none; border-radius:8px; padding:8px 15px; cursor:pointer; font-weight:600; }
  button.ghost { background:transparent; border:1px solid var(--line); color:var(--txt); font-weight:500; }
  button.danger { background:var(--bad); }
  button.ok { background:var(--ok); }
  button:disabled { opacity:.65; cursor:wait; }
  button.loading::after { content:" …"; }
  .toolbar input[type="password"] { padding:7px 10px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--txt); min-width:160px; }
  .err { color:var(--bad); padding:8px 24px; }
  .err.ok { color:var(--ok); }
  .err.info { color:var(--accent); }
  .payout-retry-form { margin-top:12px; }
  .payout-retry-fields { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
  .payout-retry-fields label { font-size:12px; color:var(--mut); }
  .payout-retry-fields input { padding:7px 10px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--txt); font:inherit; }
  .payout-retry-fields input[type="password"] { min-width:150px; }
  .payout-retry-fields input[type="text"] { min-width:160px; }
  .payout-retry-msg { padding:8px 10px; border-radius:8px; font-size:13px; margin-bottom:10px; }
  .payout-retry-msg.bad { background:#ef444414; border:1px solid #ef444455; color:var(--bad); }
  .payout-retry-msg.ok { background:#22c55e14; border:1px solid #22c55e55; color:var(--ok); }
  .payout-retry-msg.info { background:#2563eb14; border:1px solid #2563eb55; color:var(--accent); }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:11px 24px; border-bottom:1px solid var(--line); font-size:13px; }
  th { color:var(--mut); font-weight:600; }
  tr.row { cursor:pointer; }
  tr.row:hover { background:var(--panel); }
  .amt { font-variant-numeric: tabular-nums; }
  .badge { display:inline-block; padding:3px 9px; border-radius:11px; font-size:11px; font-weight:600; background:var(--panel); border:1px solid var(--line); }
  .badge.ok { color:var(--ok); border-color:#22c55e55; }
  .badge.fail { color:var(--bad); border-color:#ef444455; }
  .badge.pend { color:var(--warn); border-color:#f59e0b55; }
  .muted { color:var(--mut); }
  dialog { background:var(--panel); color:var(--txt); border:1px solid var(--line); border-radius:12px; max-width:880px; width:94%; padding:0; }
  dialog::backdrop { background:rgba(0,0,0,.6); }
  .dhead { padding:16px 20px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:12px; }
  .dhead .t { font-size:15px; font-weight:700; }
  .dbody { padding:18px 20px; max-height:74vh; overflow:auto; }
  .summary { display:flex; flex-wrap:wrap; gap:10px 18px; align-items:center; background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin-bottom:18px; }
  .flow { font-size:16px; font-weight:700; }
  .flow .arrow { color:var(--mut); margin:0 10px; }
  .flow .sub { color:var(--mut); font-weight:500; font-size:12px; }
  .pill { padding:4px 11px; border-radius:12px; font-size:12px; font-weight:600; border:1px solid var(--line); }
  .pill.sent { color:var(--ok); border-color:#22c55e55; background:#22c55e14; }
  .pill.pending { color:var(--warn); border-color:#f59e0b55; background:#f59e0b14; }
  .section { margin-bottom:16px; }
  .section > h3 { margin:0 0 8px; font-size:12px; color:var(--accent); text-transform:uppercase; letter-spacing:.05em; }
  .card { background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:13px 15px; }
  .kv2 { display:grid; grid-template-columns:210px 1fr; gap:7px 16px; align-items:start; }
  .kv2 .k { color:var(--mut); }
  .kv2 .v { word-break:break-word; }
  .kv2 .v .kv2 { margin-top:2px; }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; word-break:break-all; }
  .docs { display:flex; flex-wrap:wrap; gap:12px; }
  .doc { width:150px; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--bg); }
  .doc .thumb { width:100%; height:104px; object-fit:cover; display:block; background:var(--panel); }
  .doc .filethumb { display:flex; align-items:center; justify-content:center; height:104px; font-size:34px; background:var(--panel); }
  .doc .dmeta { padding:9px 10px; }
  .doc .dtype { font-size:11px; font-weight:700; text-transform:capitalize; color:var(--accent); }
  .doc .dname { font-size:11px; color:var(--mut); word-break:break-all; max-height:30px; overflow:hidden; margin:2px 0 6px; }
  .actions { display:flex; gap:10px; margin-top:6px; }
  .notice { background:#f59e0b14; border:1px solid #f59e0b55; color:var(--warn); border-radius:8px; padding:10px 12px; font-size:13px; margin-bottom:10px; }
  .notice.bad { background:#ef444414; border-color:#ef444455; color:var(--bad); }
  .d-inline-msg { margin:0 20px 12px; padding:10px 12px; border-radius:8px; font-size:13px; }
  .d-inline-msg.bad { background:#ef444414; border:1px solid #ef444455; color:var(--bad); }
  .d-inline-msg.ok { background:#22c55e14; border:1px solid #22c55e55; color:var(--ok); }
  .d-inline-msg.info { background:#2563eb14; border:1px solid #2563eb55; color:var(--accent); }
  .audit { display:flex; flex-direction:column; gap:10px; }
  .audit-item { border-left:3px solid var(--line); padding:8px 0 8px 12px; }
  .audit-item.ok { border-left-color:var(--ok); }
  .audit-item.warn { border-left-color:var(--warn); }
  .audit-item.bad { border-left-color:var(--bad); }
  .audit-item.admin { border-left-color:var(--accent); }
  .audit-time { font-size:12px; color:var(--mut); margin-bottom:2px; }
  .audit-label { font-weight:600; }
  .audit-detail { font-size:13px; color:var(--mut); margin-top:3px; word-break:break-word; }
  .hist { font-size:13px; margin:0; padding-left:18px; }
  .hist li { margin-bottom:6px; }
  details.raw { margin-top:6px; }
  details.raw summary { cursor:pointer; color:var(--mut); font-size:12px; }
  pre { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px; overflow:auto; font-size:12px; }
  .biz-results { padding:0 24px 16px; display:none; }
  .biz-results table { width:100%; border-collapse:collapse; background:var(--bg); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .biz-results th, .biz-results td { text-align:left; padding:11px 16px; border-bottom:1px solid var(--line); font-size:13px; }
  .biz-results th { color:var(--mut); font-weight:600; background:var(--panel); }
  .biz-results tr.biz-row { cursor:pointer; }
  .biz-results tr.biz-row:hover { background:var(--panel); }
  .biz-results tr.biz-row.active { background:#2563eb12; }
  .biz-results tr.biz-row:last-child td { border-bottom:none; }
  .biz-results-empty { padding:16px; color:var(--mut); font-size:13px; background:var(--bg); border:1px solid var(--line); border-radius:10px; }
  .biz-id { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; color:var(--mut); word-break:break-all; }
  .biz-more { padding:0 24px 16px; }
  dialog.biz-dialog { max-width:960px; width:96%; }
  .biz-mtabs { display:flex; gap:4px; padding:0 20px; border-bottom:1px solid var(--line); }
  .biz-mtab { padding:10px 16px; cursor:pointer; border:none; border-bottom:2px solid transparent; background:transparent; color:var(--mut); font-weight:600; border-radius:0; }
  .biz-mtab.active { color:var(--txt); border-bottom-color:var(--accent); }
  .biz-txn-table { width:100%; border-collapse:collapse; margin-top:8px; }
  .biz-txn-table th, .biz-txn-table td { padding:9px 12px; border-bottom:1px solid var(--line); font-size:13px; }
  .biz-txn-table th { color:var(--mut); font-weight:600; }
  .biz-txn-type.active { border-color:var(--accent); color:var(--accent); }
</style>
</head>
<body>
<header>
  <h1>BloxFi Transactions</h1>
  <span class="warn">⚠ Internal dashboard — do not share the link publicly</span>
  <span class="kv"><span class="k" style="color:var(--mut);font-size:12px">Total profit (COMPLETED)</span> <span class="v" style="font-variant-numeric:tabular-nums;font-weight:600">${safeTotalProfitUsdc} USDC</span></span>
</header>
<div class="tabs">
  <div class="tab active" data-view="transactions" data-type="onramp">Onramps</div>
  <div class="tab" data-view="transactions" data-type="offramp">Offramps</div>
  <div class="tab" data-view="settlements">Fee settlements</div>
  <div class="tab" data-view="businesses">Businesses</div>
</div>
<div class="toolbar" id="txnToolbar">
  <label class="muted" id="statusLabel">Status</label>
  <select id="statusFilter"><option value="">All</option></select>
  <label class="muted" id="includeExpiredLabel"><input type="checkbox" id="includeExpired" /> Include expired</label>
  <label class="muted" for="pagePasscode">Passcode</label>
  <input type="password" id="pagePasscode" placeholder="Dashboard passcode" autocomplete="current-password" />
  <button class="ghost" id="reload">Reload</button>
</div>
<div class="toolbar" id="bizToolbar" style="display:none">
  <label class="muted">Business</label>
  <input id="bizSearchInput" type="text" placeholder="Filter by business name or email" style="min-width:340px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--txt)" />
  <button id="bizSearch">Search</button>
  <button class="ghost" id="bizReload">Reload</button>
</div>
<div id="err" class="err" style="display:none"></div>
<table id="txnTable">
  <thead id="tableHead"><tr><th>Reference</th><th>Status</th><th>Amount</th><th>Beneficiary</th><th>Created</th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<div id="txnMoreWrap" style="padding:16px 24px"><button class="ghost" id="more" style="display:none">Load more</button></div>
<div id="bizResults" class="biz-results"></div>
<div id="bizMoreWrap" class="biz-more" style="display:none"><button class="ghost" id="bizMore" style="display:none">Load more</button></div>

<dialog id="detail">
  <div class="dhead"><span class="t" id="dTitle">Transaction</span><button type="button" class="ghost" id="dClose">Close</button></div>
  <div class="dbody" id="dBody"></div>
</dialog>

<dialog id="bizDetail" class="biz-dialog">
  <div class="dhead"><span class="t" id="bizDTitle">Business</span><button class="ghost" id="bizDClose">Close</button></div>
  <div class="biz-mtabs" id="bizMTabs">
    <button type="button" class="biz-mtab active" data-btab="details">Details</button>
    <button type="button" class="biz-mtab" data-btab="transactions">Transactions</button>
    <button type="button" class="biz-mtab" data-btab="providers">Provider config</button>
  </div>
  <div class="dbody" id="bizDBody"></div>
</dialog>

<script nonce="${nonce}">
const ONRAMP_STATUSES = ["CREATED","AWAITING_FUNDS","FIAT_PENDING","FIAT_PROCESSED","CRYPTO_INITIATED","CRYPTO_PENDING","COMPLETED","FIAT_FAILED","FIAT_RETURNED","CRYPTO_FAILED","EXPIRED"];
const OFFRAMP_STATUSES = ["CREATED","AWAITING_CRYPTO","CRYPTO_PENDING","CRYPTO_RECEIVED","CRYPTO_CONFIRMED","PROCESSING_FEE","FEE_PROCESSED","FIAT_INITIATED","FIAT_PENDING","COMPLETED","FAILED","CANCELLED","REFUNDED","CRYPTO_FAILED","FIAT_FAILED","EXPIRED"];
const OK = new Set(["COMPLETED"]);
const FAIL = new Set(["FAILED","FIAT_FAILED","CRYPTO_FAILED","EXPIRED","CANCELLED","FIAT_RETURNED","REFUNDED"]);
// Statuses that mean the fiat/crypto payout has been handed to Palremit.
const PAYOUT_SENT = {
  offramp: new Set(["FIAT_INITIATED","FIAT_PENDING","COMPLETED"]),
  onramp: new Set(["CRYPTO_INITIATED","CRYPTO_PENDING","COMPLETED"])
};
// Friendlier labels for known field names.
const LABELS = {
  txnRef:"Reference", requestId:"Request ID", lpReference:"Palremit reference", walletAddress:"Wallet address",
  externalWalletId:"Wallet ID", accountNumber:"Account number", routingNumber:"Routing number", bankName:"Bank",
  bankCode:"Bank code", accountName:"Account name", accountHolderName:"Account holder", businessName:"Business",
  firstName:"First name", lastName:"Last name", purposeOfPayment:"Purpose of payment", transferType:"Transfer type",
  accountId:"Account ID", depositBy:"Pay before", depositInfo:"Deposit details", conversionRate:"Rate",
  inverseRate:"Inverse rate", fromCurrency:"From", toCurrency:"To", fromChain:"Network", failedReason:"Failure reason",
  expiresAt:"Quote expires", createdAt:"Created", updatedAt:"Updated", provisionedAccountId:"Palremit account",
  clientReference:"Palremit reference", withdrawalAsset:"Payout asset", user:"Customer", beneficiary:"Beneficiary", reference:"Reference",
  sortCode:"Sort code", iban:"IBAN", bic:"BIC / SWIFT"
};
const SKIP = new Set(["userId","externalWalletId","documents","rawProvisionRequest","rawProvisionResponse","metadata"]);

let state = { view: "transactions", type: "onramp", status: "", includeExpired: false, cursor: null };
let detailCtx = { id: "", txnRef: "", type: "onramp", platformFee: null, withdrawalProcessing: false };
const $ = (id) => document.getElementById(id);

function showDetailMsg(msg, kind) {
  const els = [$("markActionMsg"), $("retryFiatPayoutMsg"), $("dInlineMsg")].filter(Boolean);
  if (!els.length) return;
  els.forEach(function (el) {
    if (!msg) {
      el.style.display = "none";
      el.textContent = "";
      el.className = (el.id === "retryFiatPayoutMsg" || el.id === "markActionMsg") ? "payout-retry-msg" : "d-inline-msg";
      return;
    }
    if (el.id === "retryFiatPayoutMsg" || el.id === "markActionMsg") {
      el.className = "payout-retry-msg" + (kind === "bad" ? " bad" : kind === "ok" ? " ok" : " info");
    } else {
      el.className = "d-inline-msg" + (kind === "bad" ? " bad" : kind === "ok" ? " ok" : " info");
    }
    el.textContent = msg;
    el.style.display = "block";
  });
}

function payoutRetryFormHtml() {
  return '<div class="payout-retry-form">' +
    '<div class="payout-retry-fields">' +
    '<label for="retryFiatPasscode">Passcode</label>' +
    '<input type="password" id="retryFiatPasscode" placeholder="Dashboard passcode" autocomplete="current-password" />' +
    '<label for="retryFiatActor">Your name</label>' +
    '<input type="text" id="retryFiatActor" placeholder="Optional" autocomplete="name" />' +
    "</div>" +
    '<div id="retryFiatPayoutMsg" class="payout-retry-msg" style="display:none"></div>' +
    '<div class="actions"><button type="button" class="ok" id="retryFiatPayout">Retry fiat payout</button></div>' +
    "</div>";
}

function readPasscode() {
  const candidates = [$("pagePasscode"), $("markPasscode"), $("retryFiatPasscode")];
  for (var i = 0; i < candidates.length; i++) {
    var el = candidates[i];
    var v = el && el.value ? el.value.trim() : "";
    if (v) {
      sessionStorage.setItem("dashSecret", v);
      return v;
    }
  }
  return (sessionStorage.getItem("dashSecret") || "").trim();
}

function readActor() {
  const candidates = [$("markActor"), $("retryFiatActor")];
  for (var i = 0; i < candidates.length; i++) {
    var el = candidates[i];
    if (el && el.value && el.value.trim()) return el.value.trim();
  }
  return undefined;
}

function restorePasscodeField() {
  const saved = sessionStorage.getItem("dashSecret");
  ["pagePasscode", "retryFiatPasscode", "markPasscode"].forEach(function (id) {
    var el = $(id);
    if (el && saved && !el.value) el.value = saved;
  });
}

function focusPasscode() {
  const detailOpen = $("detail") && $("detail").open;
  const el = detailOpen
    ? ($("markPasscode") || $("retryFiatPasscode") || $("pagePasscode"))
    : ($("pagePasscode") || $("markPasscode") || $("retryFiatPasscode"));
  if (el) { el.focus(); el.select(); }
}

function clearPasscodeFields() {
  ["pagePasscode", "retryFiatPasscode", "markPasscode"].forEach(function (id) {
    var el = $(id);
    if (el) el.value = "";
  });
}

function setBtnLoading(btn, loading, loadingText) {
  if (!btn) return;
  if (loading) {
    if (!btn.dataset.prevLabel) btn.dataset.prevLabel = btn.textContent || "";
    btn.disabled = true;
    btn.classList.add("loading");
    btn.textContent = loadingText || "Working";
  } else {
    btn.disabled = false;
    btn.classList.remove("loading");
    btn.textContent = btn.dataset.prevLabel || loadingText || btn.textContent;
    delete btn.dataset.prevLabel;
  }
}

function requirePasscode(actionLabel) {
  const secret = readPasscode();
  if (secret) return secret;
  showDetailMsg("Enter the dashboard passcode above, then " + actionLabel + ".", "bad");
  showErr("Enter the dashboard passcode, then " + actionLabel + ".");
  focusPasscode();
  return "";
}

function setTableHead(view) {
  if (view === "settlements") {
    $("tableHead").innerHTML = "<tr><th>Reference</th><th>Status</th><th>Fee</th><th>Platform wallet</th><th>Network</th><th>Offramp</th><th>Queued</th><th></th></tr>";
  } else {
    $("tableHead").innerHTML = "<tr><th>Reference</th><th>Status</th><th>Amount</th><th>Beneficiary</th><th>Created</th></tr>";
  }
}

function showErr(msg, kind) { const e = $("err"); e.className = kind === "ok" ? "err ok" : kind === "info" ? "err info" : "err"; e.style.display = msg ? "block" : "none"; e.textContent = msg || ""; }
function badgeClass(s) { return OK.has(s) ? "badge ok" : FAIL.has(s) ? "badge fail" : "badge pend"; }

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
    return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
  });
}
function humanize(k) {
  if (LABELS[k]) return LABELS[k];
  return String(k).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, function (c) { return c.toUpperCase(); });
}
function fmtMoney(a, c) {
  if (a == null || a === "") return "—";
  const n = Number(a);
  const amt = isNaN(n) ? esc(a) : n.toLocaleString(undefined, { maximumFractionDigits: 8 });
  return amt + (c ? " " + esc(String(c).toUpperCase()) : "");
}
function looksDate(k) { return /(At|By)$/.test(k) || /date|expires/i.test(k); }
function isImg(s) { return /\\.(png|jpe?g|webp|gif|bmp|svg)(\\?|$)/i.test(s || ""); }

async function api(path, opts) {
  const res = await fetch("/dashboard/api" + path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error((json.error && json.error.message) || res.statusText); e.status = res.status; throw e; }
  return json.data;
}

function fillStatusFilter() {
  const list = state.type === "onramp" ? ONRAMP_STATUSES : OFFRAMP_STATUSES;
  $("statusFilter").innerHTML = '<option value="">All statuses</option>' + list.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join("");
}

function rowHtml(t) {
  return '<tr class="row" data-id="' + esc(t.id) + '">' +
    "<td>" + (t.txnRef ? esc(t.txnRef) : '<span class="muted">' + esc(t.id.slice(0, 8)) + "</span>") + "</td>" +
    '<td><span class="' + badgeClass(t.status) + '">' + esc(t.status) + "</span></td>" +
    '<td class="amt">' + (t.amount != null ? fmtMoney(t.amount, t.currency) : "—") + "</td>" +
    "<td>" + (t.beneficiaryName ? esc(t.beneficiaryName) : '<span class="muted">' + esc(t.userId.slice(0, 8)) + "</span>") + "</td>" +
    '<td class="muted">' + esc(new Date(t.createdAt).toLocaleString()) + "</td>" +
    "</tr>";
}

function settlementStatusBadge(status) {
  const s = String(status || "unknown").toLowerCase();
  const cls = s === "failed" ? "badge fail" : s === "pending" ? "badge pend" : s === "processing" ? "badge pend" : "badge";
  return '<span class="' + cls + '">' + esc(String(status || "unknown").toUpperCase()) + "</span>";
}

function auditTrailHtml(events) {
  if (!events || !events.length) {
    return '<p class="muted">No audit events recorded yet.</p>';
  }
  return '<div class="audit">' + events.map(function (e) {
    const cls = e.severity === "success" ? "ok" : e.severity === "error" ? "bad" : e.severity === "warning" ? "warn" : e.severity === "admin" ? "admin" : "";
    return '<div class="audit-item ' + cls + '">' +
      '<div class="audit-time">' + esc(new Date(e.at).toLocaleString()) + "</div>" +
      '<div class="audit-label">' + esc(e.label) + "</div>" +
      (e.detail ? '<div class="audit-detail">' + esc(e.detail) + "</div>" : "") +
      "</div>";
  }).join("") + "</div>";
}

function settlementRowHtml(s) {
  const canApprove = s.settlementStatus === "pending";
  const canRetry = s.settlementStatus === "failed";
  const actionBtn = canApprove
    ? '<button class="ok approve-btn">Approve</button>'
    : canRetry
      ? '<button class="ok approve-btn">Retry</button>'
      : '<span class="muted">—</span>';
  return '<tr class="row settlement-row" data-id="' + esc(s.offrampId) + '"' +
    ' data-fee-amount="' + esc(s.feeAmount || "") + '"' +
    ' data-fee-currency="' + esc(s.feeCurrency || "") + '"' +
    ' data-wallet="' + esc(s.walletAddress || "") + '"' +
    ' data-network="' + esc(s.settlementNetwork || "") + '"' +
    ' data-settlement-status="' + esc(s.settlementStatus || "") + '">' +
    "<td>" + (s.txnRef ? esc(s.txnRef) : '<span class="muted">' + esc(s.offrampId.slice(0, 8)) + "</span>") + "</td>" +
    "<td>" + settlementStatusBadge(s.settlementStatus) + "</td>" +
    '<td class="amt">' + fmtMoney(s.feeAmount, s.feeCurrency) + "</td>" +
    '<td class="mono">' + (s.walletAddress ? esc(s.walletAddress) : "—") + "</td>" +
    "<td>" + (s.settlementNetwork ? esc(s.settlementNetwork) : "—") + "</td>" +
    '<td class="amt">' + fmtMoney(s.sendAmount, s.sendCurrency) + '<span class="arrow">→</span>' + fmtMoney(s.receiveAmount, s.receiveCurrency) + "</td>" +
    '<td class="muted">' + (s.queuedAt ? esc(new Date(s.queuedAt).toLocaleString()) : "—") + "</td>" +
    "<td>" + actionBtn + "</td>" +
    "</tr>";
}

async function load(reset) {
  if (state.view === "settlements") return loadSettlements(reset);
  showErr("");
  if (reset) { state.cursor = null; $("rows").innerHTML = ""; }
  try {
    const q = new URLSearchParams({ type: state.type });
    if (state.status) q.set("status", state.status);
    if (state.includeExpired) q.set("includeExpired", "true");
    if (state.cursor) q.set("cursor", state.cursor);
    const data = await api("/transactions?" + q.toString());
    if (!data.items.length && !$("rows").children.length) {
      $("rows").innerHTML = '<tr><td colspan="5" class="muted" style="padding:24px">No ' + state.type + ' transactions' + (state.status ? ' with status ' + esc(state.status) : '') + '.</td></tr>';
    } else {
      $("rows").insertAdjacentHTML("beforeend", data.items.map(rowHtml).join(""));
    }
    state.cursor = data.nextCursor;
    $("more").style.display = data.nextCursor ? "inline-block" : "none";
  } catch (e) { showErr(e.message); }
}

async function loadSettlements(reset) {
  showErr("");
  if (reset) { state.cursor = null; $("rows").innerHTML = ""; }
  try {
    const q = new URLSearchParams();
    if (state.cursor) q.set("cursor", state.cursor);
    const data = await api("/fee-settlements/pending?" + q.toString());
    if (!data.items.length && !$("rows").children.length) {
      $("rows").innerHTML = '<tr><td colspan="8" class="muted" style="padding:24px">No fee settlements awaiting review.</td></tr>';
    } else {
      $("rows").insertAdjacentHTML("beforeend", data.items.map(settlementRowHtml).join(""));
    }
    state.cursor = data.nextCursor;
    $("more").style.display = data.nextCursor ? "inline-block" : "none";
  } catch (e) { showErr(e.message); }
}

// --- detail rendering -------------------------------------------------------

function renderVal(key, val) {
  if (val == null || val === "") return '<span class="muted">—</span>';
  if (Array.isArray(val)) {
    if (!val.length) return '<span class="muted">—</span>';
    if (typeof val[0] === "object") return val.map(function (v) { return kvBlock(v); }).join("");
    return esc(val.join(", "));
  }
  if (typeof val === "object") return kvBlock(val);
  const s = String(val);
  if (/^https?:\\/\\//.test(s)) return '<a href="' + esc(s) + '" target="_blank" rel="noopener">Open link</a>';
  if (/address|wallet/i.test(key)) return '<span class="mono">' + esc(s) + "</span>";
  if (key === "currency") return esc(s.toUpperCase());
  if (/amount/i.test(key) && !isNaN(Number(s))) return '<span class="amt">' + esc(Number(s).toLocaleString(undefined, { maximumFractionDigits: 8 })) + "</span>";
  if (looksDate(key)) { const d = new Date(s); if (!isNaN(d.getTime())) return esc(d.toLocaleString()); }
  return esc(s);
}
function kvBlock(obj) {
  if (!obj || typeof obj !== "object") return '<span class="muted">—</span>';
  const rows = Object.keys(obj).filter(function (k) { return !SKIP.has(k); }).map(function (k) {
    return '<div class="k">' + esc(humanize(k)) + '</div><div class="v">' + renderVal(k, obj[k]) + "</div>";
  }).join("");
  return rows ? '<div class="kv2">' + rows + "</div>" : '<span class="muted">—</span>';
}
function kvPairs(pairs) {
  const rows = pairs.map(function (p) {
    const v = p[1];
    const html = (v == null || v === "") ? '<span class="muted">—</span>' : (p[2] === "mono" ? '<span class="mono">' + esc(v) + "</span>" : esc(v));
    return '<div class="k">' + esc(p[0]) + '</div><div class="v">' + html + "</div>";
  }).join("");
  return '<div class="kv2">' + rows + "</div>";
}
function section(title, innerHtml) {
  if (!innerHtml) return "";
  return '<div class="section"><h3>' + esc(title) + '</h3><div class="card">' + innerHtml + "</div></div>";
}
function hasContent(obj) { return obj && typeof obj === "object" && Object.keys(obj).some(function (k) { return !SKIP.has(k) && obj[k] != null && obj[k] !== ""; }); }

function gatherDocs(t) {
  const out = [];
  [t.metadata, t.destination && t.destination.metadata, t.source && t.source.metadata].forEach(function (m) {
    if (m && Array.isArray(m.documents)) m.documents.forEach(function (d) { out.push(d); });
  });
  return out;
}
function docsHtml(docs) {
  return '<div class="docs">' + docs.map(function (d) {
    // Only trust http(s) document URLs; reject javascript:/data:/etc. before
    // putting them in an href or img src.
    const safeUrl = (typeof d.url === "string" && /^https?:\\/\\//i.test(d.url)) ? d.url : "";
    const url = safeUrl ? esc(safeUrl) : "";
    const name = esc(d.name || "document");
    const type = esc(String(d.type || "file").replace(/_/g, " "));
    const img = isImg(d.name) || isImg(d.url);
    const thumb = (img && url) ? '<img class="thumb" src="' + url + '" alt="' + name + '" />' : '<div class="filethumb">📄</div>';
    const top = url ? '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + thumb + "</a>" : thumb;
    const open = url ? '<a class="dopen" href="' + url + '" target="_blank" rel="noopener noreferrer">Open</a>' : '<span class="muted">no link</span>';
    return '<div class="doc">' + top + '<div class="dmeta"><div class="dtype">' + type + '</div><div class="dname">' + name + "</div>" + open + "</div></div>";
  }).join("") + "</div>";
}

function payoutInfo(t) {
  const po = (t.providerRefs && t.providerRefs.palremitOrchestrator) || {};
  const sent = !!po.withdrawalStatus || (PAYOUT_SENT[t.type] && PAYOUT_SENT[t.type].has(t.status));
  return { po: po, sent: sent };
}

async function openDetail(id, forceType) {
  showErr("");
  const detailType = forceType || state.type;
  try {
    const t = await api("/transactions/" + detailType + "/" + id);
    detailCtx = {
      id: id,
      txnRef: t.txnRef || "",
      type: detailType,
      platformFee: t.fees && t.fees.platformFee ? t.fees.platformFee : null,
      withdrawalProcessing: !!t.withdrawalProcessing
    };
    const dest = t.destination || {};
    const src = t.source || {};
    const docs = gatherDocs(t);
    const pi = payoutInfo(t);
    const po = pi.po;

    $("dTitle").innerHTML = esc(t.txnRef || id) + ' &nbsp;<span class="' + badgeClass(t.status) + '">' + esc(t.status) + "</span>";

    const flow = '<span class="flow">' + fmtMoney(src.amount, src.currency) +
      '<span class="arrow">→</span>' + fmtMoney(dest.amount, dest.currency) +
      '<div class="sub">' + (t.type === "offramp" ? "Crypto in, cash out" : "Cash in, crypto out") + "</div></span>";
    const payoutPill = pi.sent
      ? '<span class="pill sent">✓ Payout sent to Palremit</span>'
      : '<span class="pill pending">Payout not sent yet</span>';
    const summary = '<div class="summary">' + flow + payoutPill + "</div>";

    // Sections ordered for an operator reading top-to-bottom.
    let body = summary;

    if (t.type === "offramp") {
      if (!pi.sent && t.payoutError) {
        var payoutHint = "";
        if (String(t.payoutError).indexOf("provider_customer_not_onboarded") >= 0) {
          payoutHint = '<div class="audit-detail" style="margin-top:8px">Set a custom OwlPay/Yativo customer ID under Businesses → Provider config, or seed the house default and ensure the orchestrator has ALLOW_HOUSE_CUSTOMER_FALLBACK=true, then retry.</div>';
        }
        body += '<div class="section"><h3>Fiat payout error</h3><div class="card">' +
          '<div class="notice bad">Palremit rejected the fiat payout:</div>' +
          '<div class="mono" style="font-size:12px;margin:8px 0;word-break:break-word">' + esc(t.payoutError) + "</div>" +
          payoutHint +
          (t.canRetryFiatPayout ? payoutRetryFormHtml() : "") +
          "</div></div>";
      } else if (t.canRetryFiatPayout) {
        body += '<div class="section"><h3>Fiat payout</h3><div class="card">' +
          '<div class="notice">Crypto is confirmed but fiat payout has not been sent to Palremit yet.</div>' +
          payoutRetryFormHtml() +
          "</div></div>";
      }
    }

    if (t.type === "offramp") {
      body += section("Beneficiary — who gets paid", kvBlock(dest));
      const ba = t.beneficiaryAccount;
      if (ba) {
        const ah = ba.accountHolder || {};
        const det = ba.details || {};
        let inner = kvPairs([
          ["Account holder", ah.name],
          ["Currency", det.currency ? String(det.currency).toUpperCase() : null],
          ["Country", det.country],
          ["Email", ah.email],
          ["Phone", ah.phone]
        ]);
        if (ba.providerPayout && ba.providerPayout.destination) {
          inner += '<div style="margin-top:8px">' + kvBlock(ba.providerPayout.destination) + "</div>";
        }
        body += section("Beneficiary bank account", inner);
      }
    } else {
      body += section("Cash deposit — where the customer pays in", hasContent(t.depositInfo) ? kvBlock(t.depositInfo) : "");
      body += section("Crypto delivered to", kvBlock(dest));
    }

    if (docs.length) body += section("Documents", docsHtml(docs));

    body += section("Liquidity provider (Palremit)", kvPairs([
      ["Payout to Palremit", pi.sent ? "Sent" : "Not sent yet"],
      ["Withdrawal status", po.withdrawalStatus || null],
      ["Palremit reference", po.clientReference || t.txnRef || t.lpReference, "mono"],
      ["Palremit account", po.provisionedAccountId, "mono"],
      ["Payout asset", po.withdrawalAsset ? String(po.withdrawalAsset).toUpperCase() : null],
      ["Crypto deposit status", po.depositStatus]
    ]));

    if (t.type === "offramp") {
      body += section("Customer sends crypto to", hasContent(t.depositInstructions) ? kvBlock(t.depositInstructions) : "");
    }

    const rate = t.rateInformation || t.quoteInformation;
    if (hasContent(rate)) body += section("Exchange & quote", kvBlock(rate));
    if (hasContent(src)) body += section("Paid from (sender)", kvBlock(src));
    if (hasContent(t.fees)) body += section("Fees", kvBlock(t.fees));

    if (t.profit && t.profit.amountInCurrency) {
      var profitData = t.profit;
      var profitRows = {
        "USDC": profitData.amountUsdc == null ? "—" : profitData.amountUsdc,
        "Native": profitData.amountInCurrency + " " + (profitData.currency || "").toUpperCase(),
        "Market rate": profitData.marketRate,
        "Our rate": profitData.customerRate,
      };
      body += section("Palremit profit", kvBlock(profitRows));
    }

    if (t.type === "offramp" && t.fees && t.fees.platformFee && t.fees.platformFee.settlement) {
      const pf = t.fees.platformFee;
      const st = pf.settlement.status;
      let notice = "";
      let actions = "";
      if (st === "pending") {
        notice = '<div class="notice">This offramp has a platform fee waiting for admin approval before the fee is sent.</div>';
        actions = '<div class="actions"><button type="button" class="ok" id="approveFee">Approve fee settlement</button></div>';
      } else if (st === "failed") {
        const failNotes = Array.isArray(pf.settlement.notes) ? pf.settlement.notes.join("; ") : (t.failedReason || "Settlement failed");
        notice = '<div class="notice bad">Platform fee settlement failed. See audit trail below.</div><div class="audit-detail" style="margin-bottom:8px">' + esc(failNotes) + "</div>";
        actions = '<div class="actions"><button type="button" class="ok" id="approveFee">Retry fee settlement</button></div>';
      } else if (st === "skipped") {
        const skipNotes = Array.isArray(pf.settlement.notes) ? pf.settlement.notes.join("; ") : "Settlement skipped";
        notice = '<div class="notice">Platform fee settlement was skipped.</div><div class="audit-detail" style="margin-bottom:8px">' + esc(skipNotes) + "</div>";
      } else if (st === "processing") {
        notice = '<div class="notice">Platform fee settlement is processing at Palremit.</div>';
      }
      if (notice || st) {
        body += '<div class="section"><h3>Platform fee settlement</h3><div class="card">' +
          notice +
          kvPairs([
            ["Status", st],
            ["Fee amount", pf.amount ? pf.amount + " " + String(pf.currency || "").toUpperCase() : null],
            ["Settlement asset", pf.settlementCurrency || "USDC"],
            ["Network", pf.settlementNetwork],
            ["Platform wallet", pf.walletAddress, "mono"],
            ["Withdrawal ID", pf.settlement.withdrawalId, "mono"],
            ["Transaction hash", pf.settlement.transactionHash || pf.transactionHash, "mono"]
          ]) +
          actions +
          "</div></div>";
      }
    }

    body += section("Audit trail", auditTrailHtml(t.auditTrail));

    body += section("Reference & timeline", kvPairs([
      ["Reference", t.txnRef, "mono"],
      ["Status", t.status],
      ["Palremit reference", t.lpReference, "mono"],
      ["Failure reason", t.failedReason],
      ["Created", t.createdAt ? new Date(t.createdAt).toLocaleString() : null],
      ["Updated", t.updatedAt ? new Date(t.updatedAt).toLocaleString() : null],
      ["Internal ID", t.id, "mono"],
      ["Business ID", t.userId, "mono"]
    ]));

    const processingWarn = t.withdrawalProcessing
      ? '<div class="notice">⚠ Palremit withdrawal is still processing. Wait for the LP webhook if you can — marking now may conflict with an in-flight payout.</div>'
      : "";

    body += '<div class="section"><h3>Mark this transaction</h3><div class="card">' +
      processingWarn +
      (t.type === "onramp" && (t.status === "AWAITING_FUNDS" || t.status === "FIAT_PENDING")
        ? '<div class="notice">Use “Mark fiat received” when the customer has paid into a static/fallback account (or fiat is confirmed offline). This starts the crypto payout. “Mark Successful” is for final payout completion only.</div>' +
          '<div class="payout-retry-fields">' +
            '<label for="fiatRecvCode">Bank reference</label>' +
            '<input type="text" id="fiatRecvCode" placeholder="Confirmation / bank reference" />' +
            '<label for="fiatRecvReason">Reason</label>' +
            '<input type="text" id="fiatRecvReason" placeholder="Why fiat is confirmed" />' +
          "</div>" +
          '<div class="actions" style="margin-bottom:12px"><button type="button" class="ok" id="markFiatReceived">Mark fiat received</button></div>'
        : "") +
      '<div class="payout-retry-fields">' +
        '<label for="markPasscode">Passcode</label>' +
        '<input type="password" id="markPasscode" placeholder="Dashboard passcode" autocomplete="current-password" />' +
        '<label for="markActor">Your name</label>' +
        '<input type="text" id="markActor" placeholder="Optional" autocomplete="name" />' +
      "</div>" +
      '<div class="payout-retry-fields">' +
        '<label for="markNote">Note</label>' +
        '<input type="text" id="markNote" placeholder="Why are you changing this status? (optional)" style="min-width:280px;flex:1" />' +
      "</div>" +
      (t.withdrawalProcessing
        ? '<label class="muted" style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="markAnyway" /> Palremit is still processing — mark anyway</label>'
        : "") +
      '<div id="markActionMsg" class="payout-retry-msg" style="display:none"></div>' +
      '<div class="actions"><button type="button" class="ok" id="markOk">Mark Successful</button><button type="button" class="danger" id="markFail">Mark Failed</button></div></div></div>';

    body += '<details class="raw"><summary>Show raw data</summary><pre>' + esc(JSON.stringify(t, null, 2)) + "</pre></details>";

    $("dBody").innerHTML = body;
    restorePasscodeField();
    $("detail").showModal();
    $("dBody").scrollTop = 0;
  } catch (e) { showErr(e.message); }
}

// --- mark with shared passcode ---------------------------------------------

async function mark(id, outcome, withdrawalProcessing) {
  if (withdrawalProcessing) {
    const box = $("markAnyway");
    if (!box || !box.checked) {
      showDetailMsg("Palremit withdrawal is still processing. Check “mark anyway” to proceed.", "bad");
      return;
    }
  }
  const noteEl = $("markNote");
  const note = noteEl && noteEl.value ? noteEl.value.trim() : "";
  const secret = requirePasscode("mark this transaction");
  if (!secret) return;
  const actor = readActor();
  const btn = outcome === "success" ? $("markOk") : $("markFail");
  setBtnLoading(btn, true, "Saving");
  showDetailMsg("Marking transaction…", "info");
  try {
    await api("/transactions/" + (detailCtx.type || state.type) + "/" + id + "/mark", {
      method: "POST",
      headers: { "content-type": "application/json", "x-dashboard-secret": secret },
      body: JSON.stringify({ outcome: outcome, note: note, actor: actor, secret: secret })
    });
    $("detail").close();
    await load(true);
  } catch (e) {
    if (e.status === 401) {
      sessionStorage.removeItem("dashSecret");
      clearPasscodeFields();
      showDetailMsg("Incorrect passcode — update the field above and try again.", "bad");
      focusPasscode();
    } else {
      showDetailMsg(e.message, "bad");
      showErr(e.message);
    }
  } finally {
    setBtnLoading(btn, false);
  }
}

async function markFiatReceived(id) {
  const codeEl = $("fiatRecvCode");
  const reasonEl = $("fiatRecvReason");
  const code = codeEl && codeEl.value ? String(codeEl.value).trim() : "";
  const reason = reasonEl && reasonEl.value ? String(reasonEl.value).trim() : "";
  if (!code) {
    showDetailMsg("A confirmation code is required.", "bad");
    if (codeEl) codeEl.focus();
    return;
  }
  if (!reason) {
    showDetailMsg("A reason is required.", "bad");
    if (reasonEl) reasonEl.focus();
    return;
  }
  const secret = requirePasscode("mark fiat received");
  if (!secret) return;
  const actor = readActor();
  const btn = $("markFiatReceived");
  setBtnLoading(btn, true, "Saving");
  showDetailMsg("Marking fiat received and starting crypto payout…", "info");
  try {
    await api("/transactions/onramp/" + id + "/mark-fiat-received", {
      method: "POST",
      headers: { "content-type": "application/json", "x-dashboard-secret": secret },
      body: JSON.stringify({ code: code, reason: reason, actor: actor, secret: secret })
    });
    $("detail").close();
    await load(true);
  } catch (e) {
    if (e.status === 401) {
      sessionStorage.removeItem("dashSecret");
      clearPasscodeFields();
      showDetailMsg("Incorrect passcode — update the field above and try again.", "bad");
      focusPasscode();
    } else {
      showDetailMsg(e.message, "bad");
      showErr(e.message);
    }
  } finally {
    setBtnLoading(btn, false);
  }
}

async function retryFiatPayout(offrampId, txnRef) {
  const btn = $("retryFiatPayout");
  const secret = requirePasscode("retry fiat payout");
  if (!secret) return;
  const actor = readActor();
  showErr("");
  setBtnLoading(btn, true, "Retrying");
  showDetailMsg("Sending fiat payout to Palremit…", "info");
  try {
    const data = await api("/offramps/" + offrampId + "/retry-fiat-payout", {
      method: "POST",
      headers: { "content-type": "application/json", "x-dashboard-secret": secret },
      body: JSON.stringify({ actor: actor })
    });
    const okMsg = data.status === "already_initiated"
      ? "Fiat payout was already initiated at Palremit."
      : "Fiat payout initiated at Palremit.";
    showDetailMsg(okMsg, "ok");
    await openDetail(offrampId, "offramp");
    if (state.view === "transactions" && state.type === "offramp") await load(true);
  } catch (e) {
    if (e.status === 401) {
      sessionStorage.removeItem("dashSecret");
      clearPasscodeFields();
      showDetailMsg("Incorrect passcode — update the field above and try again.", "bad");
      focusPasscode();
    } else {
      showDetailMsg(e.message || "Retry failed.", "bad");
      showErr(e.message);
      await openDetail(offrampId, "offramp");
    }
  } finally {
    setBtnLoading(btn, false, "Retry fiat payout");
  }
}

async function approveSettlement(offrampId, platformFee, triggerBtn) {
  const pf = platformFee || {};
  const isRetry = pf.settlement && pf.settlement.status === "failed";
  const verb = isRetry ? "Retry sending" : "Approve sending";
  const msg = verb + " " +
    (pf.amount ? pf.amount + " " + String(pf.currency || pf.settlementCurrency || "USDC").toUpperCase() : "platform fee") +
    " to " + (pf.walletAddress || "(no wallet)") +
    " on network " + (pf.settlementNetwork || "(unknown)") + "?";
  if (!confirm(msg)) return;
  const secret = requirePasscode("approve fee settlement");
  if (!secret) return;
  const actor = readActor();
  const btn = triggerBtn || $("approveFee");
  setBtnLoading(btn, true, isRetry ? "Retrying" : "Approving");
  showDetailMsg((isRetry ? "Retrying" : "Approving") + " platform fee settlement…", "info");
  showErr((isRetry ? "Retrying" : "Approving") + " platform fee settlement…", "info");
  try {
    await api("/fee-settlements/" + offrampId + "/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "x-dashboard-secret": secret },
      body: JSON.stringify({ actor: actor })
    });
    if ($("detail") && $("detail").open) $("detail").close();
    await load(true);
    showErr((isRetry ? "Retried" : "Approved") + " platform fee settlement.", "ok");
  } catch (e) {
    if (e.status === 401) {
      sessionStorage.removeItem("dashSecret");
      clearPasscodeFields();
      showDetailMsg("Incorrect passcode — update the field above and try again.", "bad");
      showErr("Incorrect passcode — update the field above and try again.");
      focusPasscode();
    } else {
      showDetailMsg(e.message, "bad");
      showErr(e.message);
    }
  } finally {
    setBtnLoading(btn, false, isRetry ? "Retry fee settlement" : "Approve fee settlement");
  }
}

// --- businesses: provider customer ID management ----------------------------

var BIZ_PROVIDERS = ["owlpay", "yativo", "swipelux"];
var HOUSE_BUSINESS_REFERENCE = "__house__";
var bizState = {
  userId: null,
  providers: {},
  houseProviders: {},
  houseFallbackEnabled: false,
  providersError: null,
  providersLoading: false,
  results: [],
  selectedBusiness: null,
  lastQuery: "",
  cursor: null,
  modalTab: "details",
  txnType: "onramp",
  txnCursors: { onramp: null, offramp: null },
  txnItems: { onramp: [], offramp: [] },
  txnLoaded: { onramp: false, offramp: false },
  providersLoaded: false
};

function kybBadge(status) {
  var s = String(status || "unknown").toLowerCase();
  var cls = s === "approved" ? "badge ok" : s === "rejected" ? "badge fail" : "badge pend";
  return '<span class="' + cls + '">' + esc(String(status || "unknown").toUpperCase()) + "</span>";
}

function providerStatusBadge(status) {
  if (status === "custom" || status === "active") return '<span class="badge ok">Custom</span>';
  if (status === "house") return '<span class="badge pend">House</span>';
  return '<span class="badge">Inactive</span>';
}

function fmtBizDate(iso) {
  if (!iso) return '<span class="muted">—</span>';
  return '<span class="muted">' + esc(new Date(iso).toLocaleString()) + "</span>";
}

function updateBizMore() {
  var onBusinesses = state.view === "businesses";
  $("bizMoreWrap").style.display = onBusinesses ? "block" : "none";
  $("bizMore").style.display = onBusinesses && bizState.cursor ? "inline-block" : "none";
}

function businessRowHtml(biz) {
  var active = bizState.userId === biz.id ? " active" : "";
  var providers = biz.providers || {};
  return '<tr class="biz-row' + active + '" data-business-id="' + esc(biz.id) + '">' +
    "<td><div>" + esc(biz.legalName) + '</div><div class="biz-id">' + esc(biz.id) + "</div></td>" +
    "<td>" + (biz.email ? esc(biz.email) : '<span class="muted">—</span>') + "</td>" +
    "<td>" + fmtBizDate(biz.createdAt) + "</td>" +
    "<td>" + fmtBizDate(biz.lastTransactedAt) + "</td>" +
    "<td>" + kybBadge(biz.kybStatus) + "</td>" +
    "<td>" + providerStatusBadge(providers.owlpay) + "</td>" +
    "<td>" + providerStatusBadge(providers.yativo) + "</td>" +
    "<td>" + providerStatusBadge(providers.swipelux) + "</td>" +
    "</tr>";
}

function renderBusinessResults() {
  var el = $("bizResults");
  if (state.view !== "businesses") {
    el.style.display = "none";
    return;
  }
  if (!bizState.results.length) {
    var emptyMsg = bizState.lastQuery
      ? 'No businesses matched "' + esc(bizState.lastQuery) + '".'
      : "No businesses found.";
    el.innerHTML = '<div class="biz-results-empty">' + emptyMsg + "</div>";
    el.style.display = "block";
    updateBizMore();
    return;
  }
  el.innerHTML = '<table><thead><tr><th>Business</th><th>Email</th><th>Created</th><th>Last txn</th><th>KYB</th><th>OwlPay</th><th>Yativo</th><th>SwipeLux</th></tr></thead><tbody>' +
    bizState.results.map(businessRowHtml).join("") +
    "</tbody></table>";
  el.style.display = "block";
  updateBizMore();
}

function providerCardHtml(name, current) {
  var hasValue = !!(current && current.channel_customer_id);
  var house = bizState.houseProviders[name];
  var houseId = house && house.channel_customer_id ? house.channel_customer_id : null;
  var label = name === "owlpay" ? "OwlPay" : name === "yativo" ? "Yativo" : name === "swipelux" ? "SwipeLux" : name;
  var mode = hasValue ? "Custom" : (bizState.houseFallbackEnabled && houseId ? "House" : "Inactive");
  var effectiveId = hasValue ? current.channel_customer_id : (bizState.houseFallbackEnabled && houseId ? houseId : null);
  var currentHtml = effectiveId
    ? '<div class="kv2" style="margin-bottom:10px"><div class="k">Mode</div><div class="v">' + esc(mode) + "</div>" +
      '<div class="k">Effective customer ID</div><div class="v mono">' + esc(effectiveId) + "</div>" +
      (hasValue
        ? '<div class="k">Last updated</div><div class="v muted">' + esc(current.updated_at ? new Date(current.updated_at).toLocaleString() : "—") + "</div>"
        : '<div class="k">House default</div><div class="v muted">Using platform __house__ mapping</div>') +
      "</div>"
    : '<div class="muted" style="margin-bottom:10px">Not onboarded with ' + esc(label) +
      (bizState.houseFallbackEnabled ? " and no house default is set." : " yet. House fallback is off.") + "</div>";
  var useHouseBtn = hasValue && bizState.houseFallbackEnabled
    ? '<button class="ghost biz-use-house-btn" data-provider="' + esc(name) + '">Use house</button>'
    : "";
  return '<div class="section"><h3>' + esc(label) + '</h3><div class="card">' +
    currentHtml +
    '<div class="actions" style="align-items:center">' +
    '<input type="text" class="biz-cust-input" data-provider="' + esc(name) + '" placeholder="Provider customer ID" value="' + (hasValue ? esc(current.channel_customer_id) : "") + '" style="flex:1;min-width:220px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--txt)" />' +
    '<button class="ok biz-save-btn" data-provider="' + esc(name) + '">' + (hasValue ? "Update" : "Save") + "</button>" +
    useHouseBtn +
    (hasValue ? '<button class="danger biz-remove-btn" data-provider="' + esc(name) + '">Remove</button>' : "") +
    "</div></div></div>";
}

function houseDefaultsHtml() {
  var notice = bizState.houseFallbackEnabled
    ? '<div class="notice">House fallback is <strong>on</strong>. Unmapped businesses use these IDs. Set a custom ID on a business to override.</div>'
    : '<div class="notice">House fallback is <strong>off</strong> in the dashboard constant. House IDs below are still editable.</div>';
  var cards = BIZ_PROVIDERS.map(function (name) {
    var current = bizState.houseProviders[name];
    var hasValue = !!(current && current.channel_customer_id);
    var label = name === "owlpay" ? "OwlPay" : name === "yativo" ? "Yativo" : name === "swipelux" ? "SwipeLux" : name;
    return '<div class="section"><h3>House · ' + esc(label) + '</h3><div class="card">' +
      (hasValue
        ? '<div class="kv2" style="margin-bottom:10px"><div class="k">House customer ID</div><div class="v mono">' + esc(current.channel_customer_id) + "</div></div>"
        : '<div class="muted" style="margin-bottom:10px">No house default for ' + esc(label) + ".</div>") +
      '<div class="actions" style="align-items:center">' +
      '<input type="text" class="biz-house-input" data-provider="' + esc(name) + '" placeholder="House customer ID" value="' + (hasValue ? esc(current.channel_customer_id) : "") + '" style="flex:1;min-width:220px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--txt)" />' +
      '<button class="ok biz-house-save-btn" data-provider="' + esc(name) + '">' + (hasValue ? "Update house" : "Save house") + "</button>" +
      "</div></div></div>";
  }).join("");
  return notice + cards;
}

function renderBizDetailsTab(biz) {
  var providers = biz.providers || {};
  return '<div class="notice">Business overview — use the Transactions and Provider config tabs for activity and payout routing.</div>' +
    kvPairs([
      ["Legal name", biz.legalName],
      ["Business ID", biz.id, "mono"],
      ["Email", biz.email],
      ["KYB status", String(biz.kybStatus || "unknown").toUpperCase()],
      ["Created", biz.createdAt ? new Date(biz.createdAt).toLocaleString() : null],
      ["Last transaction", biz.lastTransactedAt ? new Date(biz.lastTransactedAt).toLocaleString() : null],
      ["OwlPay", providers.owlpay === "custom" || providers.owlpay === "active" ? "Custom" : providers.owlpay === "house" ? "House" : "Inactive"],
      ["Yativo", providers.yativo === "custom" || providers.yativo === "active" ? "Custom" : providers.yativo === "house" ? "House" : "Inactive"],
      ["SwipeLux", providers.swipelux === "custom" || providers.swipelux === "active" ? "Custom" : providers.swipelux === "house" ? "House" : "Inactive"],
    ]);
}

function bizTxnRowHtml(t) {
  return '<tr class="row biz-txn-row" data-id="' + esc(t.id) + '" data-type="' + esc(t.type) + '">' +
    "<td>" + esc(t.type) + "</td>" +
    "<td>" + (t.txnRef ? esc(t.txnRef) : '<span class="muted">' + esc(t.id.slice(0, 8)) + "</span>") + "</td>" +
    '<td><span class="' + badgeClass(t.status) + '">' + esc(t.status) + "</span></td>" +
    '<td class="amt">' + (t.amount != null ? fmtMoney(t.amount, t.currency) : "—") + "</td>" +
    '<td class="muted">' + esc(new Date(t.createdAt).toLocaleString()) + "</td>" +
    "</tr>";
}

function renderBizTransactionsTab() {
  var type = bizState.txnType;
  var items = bizState.txnItems[type] || [];
  var onActive = type === "onramp" ? " active" : "";
  var offActive = type === "offramp" ? " active" : "";
  var rows = items.length
    ? items.map(bizTxnRowHtml).join("")
    : '<tr><td colspan="5" class="muted" style="padding:16px">No ' + esc(type) + " transactions for this business.</td></tr>";
  var moreBtn = bizState.txnCursors[type]
    ? '<div style="padding:12px 0 4px"><button type="button" class="ghost" id="bizTxnMore">Load more</button></div>'
    : "";
  return '<div class="toolbar" style="padding:0 0 12px">' +
    '<button type="button" class="ghost biz-txn-type' + onActive + '" data-type="onramp">Onramps</button>' +
    '<button type="button" class="ghost biz-txn-type' + offActive + '" data-type="offramp">Offramps</button>' +
    "</div>" +
    '<table class="biz-txn-table"><thead><tr><th>Type</th><th>Reference</th><th>Status</th><th>Amount</th><th>Created</th></tr></thead><tbody>' +
    rows +
    "</tbody></table>" + moreBtn;
}

function renderBizProvidersTab() {
  if (bizState.providersLoading) {
    return '<p class="muted">Loading provider configuration…</p>';
  }
  if (bizState.providersError) {
    return '<div class="err" style="padding:12px 0">Could not load providers: ' + esc(bizState.providersError) + "</div>";
  }
  return '<div class="notice">Same provider customer ID applies to both onramp and offramp — set it once per provider. Use house clears a custom ID so this business falls back to the platform default.</div>' +
    BIZ_PROVIDERS.map(function (p) { return providerCardHtml(p, bizState.providers[p]); }).join("") +
    '<div class="section" style="margin-top:24px"><h3 style="color:var(--mut)">Platform house defaults</h3></div>' +
    houseDefaultsHtml();
}

function renderBusinessModal() {
  var biz = bizState.selectedBusiness;
  if (!biz) return;
  var title = esc(biz.legalName);
  if (biz.email) title += ' <span class="muted" style="font-weight:500;font-size:13px">' + esc(biz.email) + "</span>";
  $("bizDTitle").innerHTML = title;
  document.querySelectorAll(".biz-mtab").forEach(function (el) {
    el.classList.toggle("active", el.dataset.btab === bizState.modalTab);
  });
  var body = "";
  if (bizState.modalTab === "details") body = renderBizDetailsTab(biz);
  else if (bizState.modalTab === "transactions") body = renderBizTransactionsTab();
  else body = renderBizProvidersTab();
  $("bizDBody").innerHTML = body;
}

function switchBizModalTab(tab) {
  bizState.modalTab = tab;
  if (tab === "transactions" && !bizState.txnLoaded[bizState.txnType]) {
    loadBusinessTransactions(bizState.txnType, true);
    return;
  }
  if (tab === "providers" && !bizState.providersLoaded && !bizState.providersLoading) {
    loadBusinessProviders();
    return;
  }
  renderBusinessModal();
}

async function loadBusinessList(reset) {
  showErr("");
  if (reset) {
    bizState.cursor = null;
    bizState.results = [];
  }
  try {
    var q = new URLSearchParams();
    var filter = $("bizSearchInput").value.trim();
    bizState.lastQuery = filter;
    if (filter) q.set("q", filter);
    if (bizState.cursor) q.set("cursor", bizState.cursor);
    var data = await api("/businesses?" + q.toString());
    var items = data.items || [];
    if (!items.length && !bizState.results.length) {
      bizState.results = [];
    } else if (reset) {
      bizState.results = items;
    } else {
      bizState.results = bizState.results.concat(items);
    }
    bizState.cursor = data.nextCursor;
    if (typeof data.house_fallback_enabled === "boolean") {
      bizState.houseFallbackEnabled = data.house_fallback_enabled;
    }
    updateBizMore();
    renderBusinessResults();
  } catch (e) { showErr(e.message); }
}

function syncBusinessRowProviders(userId) {
  var row = bizState.results.find(function (item) { return item.id === userId; });
  if (!row) return;
  var providers = { owlpay: "inactive", yativo: "inactive", swipelux: "inactive" };
  BIZ_PROVIDERS.forEach(function (name) {
    if (bizState.providers[name] && bizState.providers[name].channel_customer_id) {
      providers[name] = "custom";
    } else if (bizState.houseFallbackEnabled && bizState.houseProviders[name] && bizState.houseProviders[name].channel_customer_id) {
      providers[name] = "house";
    }
  });
  row.providers = providers;
  if (bizState.selectedBusiness && bizState.selectedBusiness.id === userId) {
    bizState.selectedBusiness.providers = providers;
  }
  renderBusinessResults();
}

async function loadBusinessProviders() {
  if (!bizState.userId) return;
  bizState.providersLoading = true;
  bizState.providersError = null;
  if (bizState.modalTab === "providers") renderBusinessModal();
  try {
    var data = await api("/businesses/" + encodeURIComponent(bizState.userId) + "/providers");
    bizState.providers = {};
    (data.providers || []).forEach(function (p) { bizState.providers[p.provider_name] = p; });
    bizState.houseProviders = {};
    (data.house_providers || []).forEach(function (p) { bizState.houseProviders[p.provider_name] = p; });
    if (typeof data.house_fallback_enabled === "boolean") {
      bizState.houseFallbackEnabled = data.house_fallback_enabled;
    }
    bizState.providersLoaded = true;
    syncBusinessRowProviders(bizState.userId);
  } catch (e) {
    bizState.providersError = e.message;
  } finally {
    bizState.providersLoading = false;
    if ($("bizDetail").open) renderBusinessModal();
  }
}

async function searchBusinesses() {
  await loadBusinessList(true);
}

async function loadBusinessTransactions(type, reset) {
  if (!bizState.userId) return;
  if (reset) bizState.txnCursors[type] = null;
  try {
    var q = new URLSearchParams({ type: type, userId: bizState.userId, includeExpired: "true" });
    if (bizState.txnCursors[type]) q.set("cursor", bizState.txnCursors[type]);
    var data = await api("/transactions?" + q.toString());
    var items = data.items || [];
    if (reset) bizState.txnItems[type] = items;
    else bizState.txnItems[type] = (bizState.txnItems[type] || []).concat(items);
    bizState.txnCursors[type] = data.nextCursor;
    bizState.txnLoaded[type] = true;
    if ($("bizDetail").open && bizState.modalTab === "transactions") renderBusinessModal();
  } catch (e) { showErr(e.message); }
}

async function openBusinessModal(biz) {
  showErr("");
  bizState.userId = biz.id;
  bizState.selectedBusiness = biz;
  bizState.providers = {};
  bizState.houseProviders = {};
  bizState.providersError = null;
  bizState.providersLoading = false;
  bizState.modalTab = "details";
  bizState.txnType = "onramp";
  bizState.txnCursors = { onramp: null, offramp: null };
  bizState.txnItems = { onramp: [], offramp: [] };
  bizState.txnLoaded = { onramp: false, offramp: false };
  bizState.providersLoaded = false;
  renderBusinessResults();
  renderBusinessModal();
  $("bizDetail").showModal();
  loadBusinessProviders();
}

async function saveBusinessProvider(provider, customerId) {
  if (!customerId || !customerId.trim()) { showErr("Enter a customer ID before saving."); return; }
  var actor = prompt("Your name (for the audit trail):", "") || undefined;
  showErr("");
  try {
    await api("/businesses/" + encodeURIComponent(bizState.userId) + "/providers/" + encodeURIComponent(provider) + "/customer", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel_customer_id: customerId.trim(),
        business_email: bizState.selectedBusiness && bizState.selectedBusiness.email ? bizState.selectedBusiness.email : null,
        actor: actor
      })
    });
    await loadBusinessProviders();
  } catch (e) { showErr(e.message); }
}

async function removeBusinessProvider(provider) {
  var msg = bizState.houseFallbackEnabled
    ? "Remove the custom " + provider + " customer ID? This business will use the house default if one is set."
    : "Remove the " + provider + " customer ID for this business? Its withdrawals routed to " + provider + " will fail until a new one is set.";
  if (!confirm(msg)) return;
  var actor = prompt("Your name (for the audit trail):", "") || undefined;
  showErr("");
  try {
    var q = actor ? "?actor=" + encodeURIComponent(actor) : "";
    await api("/businesses/" + encodeURIComponent(bizState.userId) + "/providers/" + encodeURIComponent(provider) + "/customer" + q, {
      method: "DELETE"
    });
    await loadBusinessProviders();
  } catch (e) { showErr(e.message); }
}

async function useHouseProvider(provider) {
  await removeBusinessProvider(provider);
}

async function saveHouseProvider(provider, customerId) {
  if (!customerId || !customerId.trim()) { showErr("Enter a house customer ID before saving."); return; }
  var actor = prompt("Your name (for the audit trail):", "") || undefined;
  showErr("");
  try {
    await api("/businesses/" + encodeURIComponent(HOUSE_BUSINESS_REFERENCE) + "/providers/" + encodeURIComponent(provider) + "/customer", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel_customer_id: customerId.trim(),
        actor: actor
      })
    });
    await loadBusinessProviders();
  } catch (e) { showErr(e.message); }
}

$("bizSearch").addEventListener("click", function () {
  searchBusinesses();
});
$("bizReload").addEventListener("click", function () {
  loadBusinessList(true);
});
$("bizSearchInput").addEventListener("keydown", function (e) {
  if (e.key === "Enter") $("bizSearch").click();
});
$("bizResults").addEventListener("click", function (e) {
  var row = e.target.closest(".biz-row");
  if (!row) return;
  var biz = bizState.results.find(function (item) { return item.id === row.dataset.businessId; });
  if (biz) openBusinessModal(biz);
});
$("bizDClose").addEventListener("click", function () { $("bizDetail").close(); });
$("bizDetail").addEventListener("close", function () {
  bizState.userId = null;
  bizState.selectedBusiness = null;
  renderBusinessResults();
});
$("bizDetail").addEventListener("click", function (e) {
  var mtab = e.target.closest(".biz-mtab");
  if (mtab) { switchBizModalTab(mtab.dataset.btab); return; }
  var txnTypeBtn = e.target.closest(".biz-txn-type");
  if (txnTypeBtn) {
    bizState.txnType = txnTypeBtn.dataset.type;
    if (!bizState.txnLoaded[bizState.txnType]) {
      loadBusinessTransactions(bizState.txnType, true);
    } else {
      renderBusinessModal();
    }
    return;
  }
  if (e.target.id === "bizTxnMore") { loadBusinessTransactions(bizState.txnType, false); return; }
  var txnRow = e.target.closest(".biz-txn-row");
  if (txnRow) { openDetail(txnRow.dataset.id, txnRow.dataset.type); return; }
  var saveBtn = e.target.closest(".biz-save-btn");
  if (saveBtn) {
    var input = $("bizDBody").querySelector('.biz-cust-input[data-provider="' + saveBtn.dataset.provider + '"]');
    saveBusinessProvider(saveBtn.dataset.provider, input ? input.value : "");
    return;
  }
  var useHouseBtn = e.target.closest(".biz-use-house-btn");
  if (useHouseBtn) { useHouseProvider(useHouseBtn.dataset.provider); return; }
  var houseSaveBtn = e.target.closest(".biz-house-save-btn");
  if (houseSaveBtn) {
    var houseInput = $("bizDBody").querySelector('.biz-house-input[data-provider="' + houseSaveBtn.dataset.provider + '"]');
    saveHouseProvider(houseSaveBtn.dataset.provider, houseInput ? houseInput.value : "");
    return;
  }
  var removeBtn = e.target.closest(".biz-remove-btn");
  if (removeBtn) { removeBusinessProvider(removeBtn.dataset.provider); return; }
});

// --- wiring -----------------------------------------------------------------

document.querySelectorAll(".tab").forEach(function (el) {
  el.addEventListener("click", function () {
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
    el.classList.add("active");
    state.view = el.dataset.view || "transactions";
    if (state.view === "transactions") state.type = el.dataset.type || "onramp";
    state.status = "";
    state.includeExpired = false;
    state.cursor = null;
    $("statusFilter").value = "";
    $("includeExpired").checked = false;
    showErr("");

    var isBusinesses = state.view === "businesses";
    $("txnToolbar").style.display = isBusinesses ? "none" : "flex";
    $("bizToolbar").style.display = isBusinesses ? "flex" : "none";
    $("txnTable").style.display = isBusinesses ? "none" : "table";
    $("txnMoreWrap").style.display = isBusinesses ? "none" : "block";
    $("more").style.display = "none";
    $("bizResults").style.display = isBusinesses ? "block" : "none";
    if (isBusinesses) {
      if (!bizState.results.length) loadBusinessList(true);
      else {
        renderBusinessResults();
        updateBizMore();
      }
      return;
    }

    $("statusLabel").style.display = state.view === "settlements" ? "none" : "";
    $("statusFilter").style.display = state.view === "settlements" ? "none" : "";
    $("includeExpiredLabel").style.display = state.view === "settlements" ? "none" : "";
    setTableHead(state.view);
    fillStatusFilter();
    load(true);
  });
});
$("statusFilter").addEventListener("change", function (e) { state.status = e.target.value; load(true); });
$("includeExpired").addEventListener("change", function (e) { state.includeExpired = e.target.checked; load(true); });
$("reload").addEventListener("click", function () { load(true); });
$("more").addEventListener("click", function () { load(false); });
$("bizMore").addEventListener("click", function () { loadBusinessList(false); });
$("dClose").addEventListener("click", function () { $("detail").close(); });
$("dBody").addEventListener("click", function (e) {
  if (e.target.closest("#markFiatReceived")) { markFiatReceived(detailCtx.id); return; }
  if (e.target.closest("#markOk")) { mark(detailCtx.id, "success", detailCtx.withdrawalProcessing); return; }
  if (e.target.closest("#markFail")) { mark(detailCtx.id, "failed", detailCtx.withdrawalProcessing); return; }
  if (e.target.closest("#approveFee")) { approveSettlement(detailCtx.id, detailCtx.platformFee); return; }
  if (e.target.closest("#retryFiatPayout")) { retryFiatPayout(detailCtx.id, detailCtx.txnRef); return; }
});
$("rows").addEventListener("click", function (e) {
  const approve = e.target.closest(".approve-btn");
  if (approve) {
    e.stopPropagation();
    const tr = approve.closest("tr.settlement-row");
    if (tr) {
      approveSettlement(tr.dataset.id, {
        amount: tr.dataset.feeAmount || "",
        currency: tr.dataset.feeCurrency || "",
        walletAddress: tr.dataset.wallet || "",
        settlementNetwork: tr.dataset.network || "",
        settlement: { status: tr.dataset.settlementStatus || "" }
      }, approve);
    }
    return;
  }
  const tr = e.target.closest("tr.row");
  if (tr && tr.classList.contains("settlement-row")) {
    openDetail(tr.dataset.id, "offramp");
    return;
  }
  if (tr) openDetail(tr.dataset.id);
});

fillStatusFilter();
restorePasscodeField();
load(true);
</script>
</body>
</html>`;
}
