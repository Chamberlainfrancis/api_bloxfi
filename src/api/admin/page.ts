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

export function renderDashboardHtml(nonce: string): string {
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
  .err { color:var(--bad); padding:8px 24px; }
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
</style>
</head>
<body>
<header>
  <h1>BloxFi Transactions</h1>
  <span class="warn">⚠ Internal dashboard — do not share the link publicly</span>
</header>
<div class="tabs">
  <div class="tab active" data-view="transactions" data-type="onramp">Onramps</div>
  <div class="tab" data-view="transactions" data-type="offramp">Offramps</div>
  <div class="tab" data-view="settlements">Fee settlements</div>
</div>
<div class="toolbar" id="txnToolbar">
  <label class="muted" id="statusLabel">Status</label>
  <select id="statusFilter"><option value="">All</option></select>
  <button class="ghost" id="reload">Reload</button>
</div>
<div id="err" class="err" style="display:none"></div>
<table>
  <thead id="tableHead"><tr><th>Reference</th><th>Status</th><th>Amount</th><th>Beneficiary</th><th>Created</th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<div style="padding:16px 24px"><button class="ghost" id="more" style="display:none">Load more</button></div>

<dialog id="detail">
  <div class="dhead"><span class="t" id="dTitle">Transaction</span><button class="ghost" id="dClose">Close</button></div>
  <div class="dbody" id="dBody"></div>
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
  clientReference:"Palremit reference", withdrawalAsset:"Payout asset", user:"Customer", beneficiary:"Beneficiary", reference:"Reference"
};
const SKIP = new Set(["userId","externalWalletId","documents","rawProvisionRequest","rawProvisionResponse","metadata"]);

let state = { view: "transactions", type: "onramp", status: "", cursor: null };
const $ = (id) => document.getElementById(id);

function setTableHead(view) {
  if (view === "settlements") {
    $("tableHead").innerHTML = "<tr><th>Reference</th><th>Status</th><th>Fee</th><th>Platform wallet</th><th>Network</th><th>Offramp</th><th>Queued</th><th></th></tr>";
  } else {
    $("tableHead").innerHTML = "<tr><th>Reference</th><th>Status</th><th>Amount</th><th>Beneficiary</th><th>Created</th></tr>";
  }
}

function showErr(msg) { const e = $("err"); e.style.display = msg ? "block" : "none"; e.textContent = msg || ""; }
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

    if (t.type === "offramp" && t.fees && t.fees.platformFee && t.fees.platformFee.settlement) {
      const pf = t.fees.platformFee;
      const st = pf.settlement.status;
      let notice = "";
      let actions = "";
      if (st === "pending") {
        notice = '<div class="notice">This offramp has a platform fee waiting for admin approval before USDC is sent.</div>';
        actions = '<div class="actions"><button class="ok" id="approveFee">Approve fee settlement</button></div>';
      } else if (st === "failed") {
        const failNotes = Array.isArray(pf.settlement.notes) ? pf.settlement.notes.join("; ") : (t.failedReason || "Settlement failed");
        notice = '<div class="notice bad">Platform fee settlement failed. See audit trail below.</div><div class="audit-detail" style="margin-bottom:8px">' + esc(failNotes) + "</div>";
        actions = '<div class="actions"><button class="ok" id="approveFee">Retry fee settlement</button></div>';
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
      ["Internal ID", t.id, "mono"]
    ]));

    const processingWarn = t.withdrawalProcessing
      ? '<div class="notice">⚠ Palremit withdrawal is still processing. Wait for the LP webhook if you can — marking now may conflict with an in-flight payout.</div>'
      : "";

    body += '<div class="section"><h3>Mark this transaction</h3><div class="card">' +
      processingWarn +
      '<div class="actions"><button class="ok" id="markOk">Mark Successful</button><button class="danger" id="markFail">Mark Failed</button></div></div></div>';

    body += '<details class="raw"><summary>Show raw data</summary><pre>' + esc(JSON.stringify(t, null, 2)) + "</pre></details>";

    $("dBody").innerHTML = body;
    $("markOk").onclick = function () { mark(id, "success", t.withdrawalProcessing); };
    $("markFail").onclick = function () { mark(id, "failed", t.withdrawalProcessing); };
    const approveBtn = $("approveFee");
    if (approveBtn) approveBtn.onclick = function () { approveSettlement(id, t.fees && t.fees.platformFee); };
    $("detail").showModal();
    $("dBody").scrollTop = 0;
  } catch (e) { showErr(e.message); }
}

// --- mark with shared passcode ---------------------------------------------

function getSecret(force) {
  let s = force ? null : sessionStorage.getItem("dashSecret");
  if (!s) {
    s = prompt("Enter the dashboard passcode to mark transactions:", "");
    if (s) sessionStorage.setItem("dashSecret", s);
  }
  return s;
}

async function mark(id, outcome, withdrawalProcessing) {
  if (withdrawalProcessing) {
    const proceed = confirm(
      "The Palremit withdrawal is still processing. Marking it now may conflict with an in-flight payout. Continue anyway?"
    );
    if (!proceed) return;
  }
  const verb = outcome === "success" ? "successful" : "failed";
  const note = prompt("Why are you marking this " + verb + "? (note)", "");
  if (note === null) return;
  const actor = prompt("Your name (optional):", "") || undefined;
  let secret = getSecret(false);
  if (!secret) return;
  try {
    await api("/transactions/" + state.type + "/" + id + "/mark", {
      method: "POST",
      headers: { "content-type": "application/json", "x-dashboard-secret": secret },
      body: JSON.stringify({ outcome: outcome, note: note, actor: actor })
    });
    $("detail").close();
    await load(true);
  } catch (e) {
    if (e.status === 401) {
      sessionStorage.removeItem("dashSecret");
      showErr("Incorrect passcode — please try the mark again.");
    } else {
      showErr(e.message);
    }
  }
}

async function approveSettlement(offrampId, platformFee) {
  const pf = platformFee || {};
  const isRetry = pf.settlement && pf.settlement.status === "failed";
  const verb = isRetry ? "Retry sending" : "Approve sending";
  const msg = verb + " " +
    (pf.amount ? pf.amount + " " + String(pf.currency || pf.settlementCurrency || "USDC").toUpperCase() : "platform fee") +
    " to\\n" + (pf.walletAddress || "(no wallet)") +
    "\\non network " + (pf.settlementNetwork || "(unknown)") + "?";
  if (!confirm(msg)) return;
  const actor = prompt("Your name (optional):", "") || undefined;
  let secret = getSecret(false);
  if (!secret) return;
  try {
    await api("/fee-settlements/" + offrampId + "/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "x-dashboard-secret": secret },
      body: JSON.stringify({ actor: actor })
    });
    $("detail").close();
    await load(true);
  } catch (e) {
    if (e.status === 401) {
      sessionStorage.removeItem("dashSecret");
      showErr("Incorrect passcode — please try approval again.");
    } else {
      showErr(e.message);
    }
  }
}

// --- wiring -----------------------------------------------------------------

document.querySelectorAll(".tab").forEach(function (el) {
  el.addEventListener("click", function () {
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
    el.classList.add("active");
    state.view = el.dataset.view || "transactions";
    if (state.view === "transactions") state.type = el.dataset.type || "onramp";
    state.status = "";
    state.cursor = null;
    $("statusFilter").value = "";
    $("txnToolbar").style.display = "flex";
    $("statusLabel").style.display = state.view === "settlements" ? "none" : "";
    $("statusFilter").style.display = state.view === "settlements" ? "none" : "";
    setTableHead(state.view);
    fillStatusFilter();
    load(true);
  });
});
$("statusFilter").addEventListener("change", function (e) { state.status = e.target.value; load(true); });
$("reload").addEventListener("click", function () { load(true); });
$("more").addEventListener("click", function () { load(false); });
$("dClose").addEventListener("click", function () { $("detail").close(); });
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
      });
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
load(true);
</script>
</body>
</html>`;
}
