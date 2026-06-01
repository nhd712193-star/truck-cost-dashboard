const REMOTE_DATA_BASE = "https://pub-a8611e8e054b4700b1baf208dfd70d3a.r2.dev/prod";
const LOCAL_DATA_BASE = "./data";
const isLocalHost = ["localhost", "127.0.0.1", ""].includes(location.hostname);
const DATA_BASE = new URLSearchParams(location.search).get("dataBase")
  || (isLocalHost ? LOCAL_DATA_BASE : REMOTE_DATA_BASE);
const ORDER_INDEX_DELAY_MS = 1500;
const AUTH_CONFIG = {
  googleClientId: "788267823901-4p3ls3u8mc5i395odcccamek13tq7qtn.apps.googleusercontent.com",
  allowedDomain: "ghn.vn",
  apiEndpoint: "/api/auth",
  sessionKey: "truck_cost_dashboard_session",
};

const state = {
  data: {},
  filtered: {},
  filters: {},
  filterCache: null,
  manifest: null,
  map: null,
  districtMap: null,
  districtMapPromise: null,
  selectedDistrict: "",
  wardLoading: false,
  wardError: null,
  orderIndexLoading: false,
  orderIndexError: null,
  orderIndexPartitions: [],
  orderIndexPartitionsByMonth: new Map(),
  orderIndexRowsByMonth: new Map(),
  orderIndexLoadsByMonth: new Map(),
  orderIndexFallbackRollup: "",
  dashboardStarted: false,
  authSession: null,
  adminLoaded: false,
};

const el = (id) => document.getElementById(id);
const orderStatsMemo = new WeakMap();
const pendingDetailsMemo = new WeakMap();
const partitionMemo = new WeakMap();
let googleAuthInitialized = false;
let loginBgStarted = false;

const formatVnd = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});

const formatNumber = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 1,
});

const money = (value) => `${formatVnd.format(value || 0)} đ`;
const number = (value) => formatNumber.format(value || 0);
const pct = (value) => `${formatNumber.format((value || 0) * 100)}%`;

const TYPE_LABELS = {
  DELIVER: "Giao hàng",
  RETURN: "Trả hàng",
};

const STATUS_LABELS = {
  LASTMILE: "Đã khớp Last-mile",
  NOT_MATCH_EXCEL: "Chưa khớp chuyến",
  NOT_MATCH_LASTMILE: "Chưa khớp Last-mile",
  OFF_BY_GHN: "Phát sinh do GHN",
  OFF_BY_PARTNER: "Phát sinh do đối tác",
};

const HELP_TEXT = {
  "Bình quân toàn quốc": "Chi phí/kg bình quân của tất cả tỉnh trong phạm vi lọc, chỉ tính phần đã có chi phí thuê xe.",
  "Chi phí/kg": "Tổng chi phí chia cho tổng kg đã có chi phí thuê xe.",
  "Tổng chi phí": "Tổng chi phí thuê xe đã ghi nhận. Nếu còn đơn chưa có chi phí, số này chưa phải chi phí cuối cùng.",
  "Tỷ trọng chi phí": "Phần chi phí của tỉnh đang chọn so với tổng chi phí đang hiển thị.",
  "Đơn unique": "Số mã đơn không trùng trong phạm vi lọc. Một đơn chỉ tính một lần dù có nhiều dòng chi phí.",
  "Khối lượng": "Tổng trọng lượng tính chi phí của các đơn từ 15kg trở lên trong phạm vi lọc.",
  "Khối lượng đã có chi phí": "Khối lượng của các đơn đã có chi phí thuê xe, dùng làm mẫu số cho chi phí/kg.",
  "Chưa có chi phí thuê xe": "Đơn có trọng lượng nhưng file chi phí thuê xe chưa cập nhật. Đây không phải chi phí thực tế bằng 0.",
  "Chi phí/đơn": "Tổng chi phí chia cho số đơn unique đã có chi phí thuê xe. Đơn chưa có chi phí không dùng trong mẫu số.",
  "Tỷ lệ chi phí chưa khớp chuyến": "Phần chi phí thuộc nhóm chưa tìm thấy chuyến Last-mile tương ứng. Tỷ lệ cao nên kiểm tra mapping chuyến.",
  "Tỉnh cao nhất": "Tỉnh có chi phí/kg cao nhất trong phạm vi lọc. Nên xem cùng volume và số đơn chưa có chi phí.",
  "Tỉnh thấp nhất": "Tỉnh có chi phí/kg thấp nhất trong phạm vi lọc. Nên áp dụng ngưỡng volume tối thiểu.",
  "Tỉnh chỉ có đơn chưa có chi phí": "Tỉnh có đơn/weight nhưng chưa có chi phí thuê xe ghi nhận trong phạm vi lọc.",
  "Bản đồ tỉnh": "Màu càng đậm là chi phí/kg càng cao, chỉ tính phần đã có chi phí thuê xe. Tỉnh gạch chéo là còn đơn chưa có chi phí.",
  "Bản đồ quận/huyện": "Sau khi chọn tỉnh, bản đồ chuyển sang quận/huyện của tỉnh đó. Màu càng đậm là chi phí/kg càng cao.",
  "Quận/huyện cao nhất": "Top quận/huyện theo chi phí/kg trong tỉnh đang chọn. Nên xem cùng tổng chi phí, khối lượng và số đơn chưa có chi phí.",
  "Quận/huyện thấp nhất": "Quận/huyện có chi phí/kg thấp nhất trong tỉnh đang chọn. Nên áp dụng ngưỡng volume tối thiểu.",
  "Phường/xã cao nhất": "Top phường/xã theo chi phí/kg trong quận/huyện đang chọn.",
};

function isAllowedEmail(email) {
  return String(email || "").toLowerCase().endsWith(`@${AUTH_CONFIG.allowedDomain}`);
}

function decodeJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch (error) {
    return null;
  }
}

function readAuthSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_CONFIG.sessionKey);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeAuthSession(session) {
  try {
    sessionStorage.setItem(AUTH_CONFIG.sessionKey, JSON.stringify(session));
  } catch (error) {
    console.warn("Cannot save auth session", error);
  }
}

function clearAuthSession() {
  try {
    sessionStorage.removeItem(AUTH_CONFIG.sessionKey);
  } catch (error) {
    console.warn("Cannot clear auth session", error);
  }
}

function isAuthSessionValid(session) {
  if (!session?.email || !isAllowedEmail(session.email)) return false;
  if (!session.exp) return false;
  if (Date.now() / 1000 >= Number(session.exp)) return false;
  return Boolean(session.permissions && Object.keys(session.permissions).length);
}

function isAdminSession(session) {
  return Boolean(session?.permissions?.admin);
}

function setLoginLoading(isLoading) {
  el("loginLoading").hidden = !isLoading;
}

function showLoginError(message) {
  const node = el("loginError");
  node.hidden = false;
  node.textContent = message;
  setLoginLoading(false);
}

function hideLoginError() {
  const node = el("loginError");
  node.hidden = true;
  node.textContent = "";
}

function showLoginGate() {
  document.body.classList.remove("auth-pending", "auth-ready");
  document.body.classList.add("auth-required");
  el("dashboardApp").hidden = true;
  el("loginGate").hidden = false;
  startLoginBackground();
}

function showDashboardShell(session) {
  state.authSession = session;
  document.body.classList.remove("auth-pending", "auth-required");
  document.body.classList.add("auth-ready");
  el("loginGate").hidden = true;
  el("dashboardApp").hidden = false;
  const signOut = el("signOutButton");
  signOut.hidden = false;
  signOut.title = session?.email ? `Đang đăng nhập: ${session.email}` : "Đăng xuất";
  el("adminTab").hidden = !isAdminSession(session);
  el("adminSessionSummary").textContent = session?.email
    ? `${session.email} | ${session.role || "viewer"}`
    : "";
}

function saveAuthPayload(payload, userInfo = {}) {
  const session = {
    email: payload.email || "",
    name: userInfo.name || payload.name || payload.email || "",
    picture: payload.picture || "",
    sub: payload.sub || "",
    exp: payload.exp || 0,
    savedAt: Date.now(),
    role: userInfo.role || "user",
    user_group: userInfo.user_group || "truck-cost-dashboard",
    permissions: userInfo.permissions || { dashboard: true },
  };
  writeAuthSession(session);
  return session;
}

function startDashboardAfterAuth(session) {
  showDashboardShell(session);
  if (state.dashboardStarted) return;
  state.dashboardStarted = true;
  loadData().catch((error) => {
    console.error(error);
    const banner = el("qualityBanner");
    banner.hidden = false;
    banner.innerHTML = `
      <strong>Lỗi dữ liệu</strong>
      <div><span>Không tải được dữ liệu: ${escapeHtml(error.message)}</span></div>
    `;
  });
}

function startDevAuthIfRequested() {
  const params = new URLSearchParams(location.search);
  if (!isLocalHost || params.get("devAuth") !== "1") return false;
  const session = {
    email: `local.dev@${AUTH_CONFIG.allowedDomain}`,
    name: "Local Dev",
    picture: "",
    sub: "local-dev",
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    savedAt: Date.now(),
    role: "developer",
    user_group: "local",
    permissions: { dashboard: true },
  };
  writeAuthSession(session);
  startDashboardAfterAuth(session);
  return true;
}

async function verifyAuthWithServer(credential) {
  if (isLocalHost || !AUTH_CONFIG.apiEndpoint) return {};

  const apiResponse = await fetch(AUTH_CONFIG.apiEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  let data = {};
  try {
    data = await apiResponse.json();
  } catch (error) {
    data = {};
  }

  if (!apiResponse.ok) {
    throw new Error(data.message || data.error || "Lỗi xác thực từ server.");
  }
  return data.user || {};
}

async function handleCredentialResponse(response) {
  setLoginLoading(true);
  hideLoginError();

  const credential = response?.credential || "";
  const payload = decodeJwt(credential);
  if (!payload) {
    showLoginError("Không thể đọc token Google. Vui lòng thử lại.");
    return;
  }

  const email = payload.email || "";
  if (!isAllowedEmail(email)) {
    showLoginError(`Email ${email || "này"} không hợp lệ. Chỉ tài khoản @${AUTH_CONFIG.allowedDomain} mới được truy cập.`);
    window.google?.accounts?.id?.disableAutoSelect();
    return;
  }

  try {
    const userInfo = await verifyAuthWithServer(credential);
    const session = saveAuthPayload(payload, userInfo);
    setLoginLoading(false);
    startDashboardAfterAuth(session);
  } catch (error) {
    showLoginError(error.message || "Lỗi xác thực từ server. Vui lòng thử lại.");
    window.google?.accounts?.id?.disableAutoSelect();
  }
}

function initGoogleAuth() {
  if (googleAuthInitialized) return true;
  if (!window.google?.accounts?.id) return false;

  googleAuthInitialized = true;
  window.google.accounts.id.initialize({
    client_id: AUTH_CONFIG.googleClientId,
    callback: handleCredentialResponse,
    hosted_domain: AUTH_CONFIG.allowedDomain,
    auto_select: false,
    ux_mode: "popup",
  });
  const googleSignInButton = el("googleSigninButton");
  const googleButtonWidth = Math.min(
    340,
    Math.max(280, Math.floor(googleSignInButton.getBoundingClientRect().width || 340)),
  );

  window.google.accounts.id.renderButton(
    googleSignInButton,
    {
      theme: "filled_black",
      size: "large",
      width: googleButtonWidth,
      text: "signin_with",
      shape: "rectangular",
      logo_alignment: "left",
    },
  );
  window.google.accounts.id.prompt();
  return true;
}

function waitForGoogleAuth() {
  if (initGoogleAuth()) return;
  const script = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
  script?.addEventListener("load", initGoogleAuth, { once: true });
  window.setTimeout(() => {
    if (!googleAuthInitialized && !isAuthSessionValid(readAuthSession())) {
      showLoginError("Không tải được Google Sign-In. Vui lòng kiểm tra kết nối hoặc thử tải lại trang.");
    }
  }, 6000);
}

function initAuthGate() {
  if (startDevAuthIfRequested()) return;

  const session = readAuthSession();
  if (isAuthSessionValid(session)) {
    startDashboardAfterAuth(session);
    return;
  }

  clearAuthSession();
  showLoginGate();
  waitForGoogleAuth();
}

function startLoginBackground() {
  if (loginBgStarted || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = el("loginBgCanvas");
  const ctx = canvas?.getContext?.("2d");
  if (!ctx) return;

  loginBgStarted = true;
  let dots = [];
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    dots = Array.from({ length: 80 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.6 + 0.5,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      a: Math.random() * 0.55 + 0.2,
    }));
  };
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dots.forEach((dot) => {
      dot.x += dot.vx;
      dot.y += dot.vy;
      if (dot.x < 0) dot.x = canvas.width;
      if (dot.x > canvas.width) dot.x = 0;
      if (dot.y < 0) dot.y = canvas.height;
      if (dot.y > canvas.height) dot.y = 0;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(249,115,22,${dot.a})`;
      ctx.fill();
    });
    window.requestAnimationFrame(draw);
  };

  resize();
  draw();
  window.addEventListener("resize", resize);
}

function compactNumber(value, suffix = "") {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const format = (scaled, digits) => new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: digits,
  }).format(scaled);
  const withSuffix = (text) => suffix ? `${text} ${suffix}` : text;

  if (abs >= 1_000_000_000) return withSuffix(`${format(n / 1_000_000_000, abs < 10_000_000_000 ? 2 : 1)} tỷ`);
  if (abs >= 1_000_000) return withSuffix(`${format(n / 1_000_000, abs < 10_000_000 ? 2 : 1)} triệu`);
  if (abs >= 1_000) return withSuffix(`${format(n / 1_000, abs < 1_000_000 ? 1 : 0)} nghìn`);
  return withSuffix(formatVnd.format(n));
}

function compactMoney(value) {
  return compactNumber(value, "đ");
}

function compactWeightKg(value) {
  const kg = Number(value) || 0;
  if (kg < 1000) return `${formatVnd.format(Math.round(kg))} kg`;
  return compactNumber(kg / 1000, "tấn");
}

function setMetric(id, text, fullText) {
  const node = el(id);
  node.textContent = text;
  node.title = fullText || text;
}

function helpTip(label) {
  const text = HELP_TEXT[label];
  if (!text) return "";
  return `<button class="help-tip" type="button" aria-label="Giải thích ${escapeHtml(label)}" data-tip="${escapeHtml(text)}">?</button>`;
}

let activeTip = null;

function hideTip() {
  activeTip?.remove();
  activeTip = null;
}

function showTip(button) {
  const text = button?.dataset?.tip;
  if (!text) return;
  hideTip();
  activeTip = document.createElement("div");
  activeTip.className = "tip-popover";
  activeTip.setAttribute("role", "tooltip");
  activeTip.textContent = text;
  document.body.appendChild(activeTip);

  const buttonRect = button.getBoundingClientRect();
  const tipRect = activeTip.getBoundingClientRect();
  const top = Math.max(8, buttonRect.top - tipRect.height - 10);
  const left = Math.min(
    window.innerWidth - tipRect.width - 8,
    Math.max(8, buttonRect.left + buttonRect.width / 2 - tipRect.width / 2),
  );
  activeTip.style.top = `${top}px`;
  activeTip.style.left = `${left}px`;
}

document.addEventListener("mouseover", (event) => {
  const button = event.target.closest?.(".help-tip");
  if (button) showTip(button);
});

document.addEventListener("mouseout", (event) => {
  if (event.target.closest?.(".help-tip")) hideTip();
});

document.addEventListener("focusin", (event) => {
  const button = event.target.closest?.(".help-tip");
  if (button) showTip(button);
});

document.addEventListener("focusout", (event) => {
  if (event.target.closest?.(".help-tip")) hideTip();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest?.(".help-tip");
  if (!button) {
    hideTip();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  showTip(button);
});

window.addEventListener("scroll", hideTip, true);
window.addEventListener("resize", hideTip);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quote = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      if (c === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        quote = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quote = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift() || [];
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function fetchTextMaybeGzip(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  if (path.endsWith(".gz")) {
    const decodedResponse = response.clone();
    try {
      const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
      return await new Response(stream).text();
    } catch (error) {
      const text = await decodedResponse.text();
      if (text.includes("\n") && text.includes(",")) return text;
      throw error;
    }
  }
  return await response.text();
}

function numeric(row, key) {
  const n = Number(row[key]);
  return Number.isFinite(n) ? n : 0;
}

function normalize(row) {
  return {
    ...row,
    nb_orders: numeric(row, "nb_orders"),
    unique_orders: numeric(row, "unique_orders"),
    unique_ready_orders: numeric(row, "unique_ready_orders"),
    unique_pending_orders: numeric(row, "unique_pending_orders"),
    nb_trips: numeric(row, "nb_trips"),
    nb_trucks: numeric(row, "nb_trucks"),
    sum_weight_kg: numeric(row, "sum_weight_kg"),
    matched_cost: numeric(row, "matched_cost"),
    notmatch_cost: numeric(row, "notmatch_cost"),
    off_cost: numeric(row, "off_cost"),
    total_cost: numeric(row, "total_cost"),
  };
}

function normalizeOrderIndex(row) {
  return {
    ...row,
    has_ready_cost: numeric(row, "has_ready_cost"),
    has_pending_cost: numeric(row, "has_pending_cost"),
  };
}

function blankTotals() {
  return {
    orders: 0,
    occurrences: 0,
    trips: 0,
    trucks: 0,
    weightKg: 0,
    matched: 0,
    notmatch: 0,
    off: 0,
    cost: 0,
    readyOrders: 0,
    readyOccurrences: 0,
    readyWeightKg: 0,
    pendingOrders: 0,
    pendingOccurrences: 0,
    pendingWeightKg: 0,
    hasUniqueOrders: false,
  };
}

function makeOrderBucket() {
  return {
    orders: new Set(),
    readyOrders: new Set(),
    pendingOrders: new Set(),
  };
}

function finalizeOrderBucket(bucket) {
  return {
    orders: bucket.orders.size,
    readyOrders: bucket.readyOrders.size,
    pendingOrders: bucket.pendingOrders.size,
  };
}

function orderStats(rows, key = null) {
  if (!rows?.length) return key ? new Map() : null;
  const cacheKey = key || "__all__";
  let rowCache = orderStatsMemo.get(rows);
  if (rowCache?.has(cacheKey)) return rowCache.get(cacheKey);

  const map = new Map();
  rows.forEach((row) => {
    const code = row.order_code;
    if (!code) return;
    const groupKey = key ? (row[key] || "N/A") : "__all__";
    if (!map.has(groupKey)) map.set(groupKey, makeOrderBucket());
    const bucket = map.get(groupKey);
    bucket.orders.add(code);
    if (row.has_ready_cost) bucket.readyOrders.add(code);
    if (row.has_pending_cost) bucket.pendingOrders.add(code);
  });

  const result = !key
    ? finalizeOrderBucket(map.get("__all__") || makeOrderBucket())
    : new Map([...map.entries()].map(([groupKey, bucket]) => [groupKey, finalizeOrderBucket(bucket)]));

  if (!rowCache) {
    rowCache = new Map();
    orderStatsMemo.set(rows, rowCache);
  }
  rowCache.set(cacheKey, result);
  return result;
}

function partitionRows(rows, key) {
  if (!rows?.length) return new Map();
  let rowCache = partitionMemo.get(rows);
  if (rowCache?.has(key)) return rowCache.get(key);

  const map = new Map();
  rows.forEach((row) => {
    const value = row[key] || "N/A";
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  });

  if (!rowCache) {
    rowCache = new Map();
    partitionMemo.set(rows, rowCache);
  }
  rowCache.set(key, map);
  return map;
}

function applyOrderStats(totals, stats) {
  if (!stats) return totals;
  return {
    ...totals,
    orders: stats.orders,
    readyOrders: stats.readyOrders,
    pendingOrders: stats.pendingOrders,
    hasUniqueOrders: true,
  };
}

function pendingOrderDetails(limit = 1000) {
  const sourceRows = state.filtered.order;
  const cached = sourceRows ? pendingDetailsMemo.get(sourceRows)?.get(limit) : null;
  if (cached) return cached;
  const rows = sourceRows?.filter((row) => row.has_pending_cost) || [];

  const seen = new Set();
  const details = [];
  let firstDate = "";
  let lastDate = "";

  rows.forEach((row) => {
    if (row.cost_date) {
      if (!firstDate || row.cost_date < firstDate) firstDate = row.cost_date;
      if (!lastDate || row.cost_date > lastDate) lastDate = row.cost_date;
    }
    if (row.order_code && !seen.has(row.order_code)) {
      seen.add(row.order_code);
      if (details.length < limit) details.push(row);
    }
  });

  const result = {
    rows: details,
    totalUnique: seen.size,
    dateText: summarizeDateRange(firstDate, lastDate),
  };
  if (sourceRows) {
    let rowCache = pendingDetailsMemo.get(sourceRows);
    if (!rowCache) {
      rowCache = new Map();
      pendingDetailsMemo.set(sourceRows, rowCache);
    }
    rowCache.set(limit, result);
  }
  return result;
}

function sumRows(rows, orderRows = null) {
  const totals = rows.reduce(
    (acc, r) => {
      const pendingOrders = r.nb_orders > 0 && r.total_cost === 0 ? r.nb_orders : 0;
      const hasReadyCost = r.total_cost > 0;
      acc.orders += r.nb_orders;
      acc.occurrences += r.nb_orders;
      acc.trips += r.nb_trips;
      acc.trucks += r.nb_trucks;
      acc.weightKg += r.sum_weight_kg;
      acc.matched += r.matched_cost;
      acc.notmatch += r.notmatch_cost;
      acc.off += r.off_cost;
      acc.cost += r.total_cost;
      acc.readyOrders += hasReadyCost ? r.nb_orders : 0;
      acc.readyOccurrences += hasReadyCost ? r.nb_orders : 0;
      acc.readyWeightKg += hasReadyCost ? r.sum_weight_kg : 0;
      acc.pendingOrders += pendingOrders;
      acc.pendingOccurrences += pendingOrders;
      acc.pendingWeightKg += pendingOrders ? r.sum_weight_kg : 0;
      return acc;
    },
    blankTotals(),
  );
  return applyOrderStats(totals, orderStats(orderRows));
}

function groupBy(rows, key, orderRows = null) {
  const map = new Map();
  rows.forEach((row) => {
    const value = row[key] || "N/A";
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  });
  const statsByKey = orderStats(orderRows, key);
  return [...map.entries()].map(([name, items]) => ({
    name,
    ...applyOrderStats(sumRows(items), statsByKey.get(name)),
    rows: items.length,
  }));
}

function setOptions(select, values) {
  const current = select.value;
  const unique = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
  select.innerHTML = '<option value="">Tất cả</option>' + unique
    .map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(optionLabel(select.id, v))}</option>`)
    .join("");
  if (unique.includes(current)) select.value = current;
}

function optionLabel(selectId, value) {
  if (selectId === "typeFilter") return typeLabel(value);
  if (selectId === "statusFilter") return statusLabel(value);
  return value;
}

function typeLabel(value) {
  return TYPE_LABELS[value] || value || "N/A";
}

function statusLabel(value) {
  return STATUS_LABELS[value] || value || "N/A";
}

function baseFilterKey(filters) {
  return [filters.from, filters.to, filters.type, filters.status].join("\u0001");
}

function matchesBaseFilters(row, filters) {
  if (filters.from && row.cost_date < filters.from) return false;
  if (filters.to && row.cost_date > filters.to) return false;
  if (filters.type && row.cost_type !== filters.type) return false;
  if (filters.status && row.cost_status !== filters.status) return false;
  return true;
}

function addByProvince(map, row) {
  const province = row.to_province_name || "N/A";
  if (!map.has(province)) map.set(province, []);
  map.get(province).push(row);
}

function filteredRollup(rows, filters, byProvince = false) {
  const filtered = [];
  const provinceMap = byProvince ? new Map() : null;
  (rows || []).forEach((row) => {
    if (!matchesBaseFilters(row, filters)) return;
    filtered.push(row);
    if (provinceMap) addByProvince(provinceMap, row);
  });
  return byProvince ? { filtered, provinceMap } : { filtered };
}

function monthIndex(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return Number.isFinite(year) && Number.isFinite(monthNumber)
    ? year * 12 + monthNumber - 1
    : null;
}

function monthFromIndex(index) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthKeysBetween(from, to) {
  const fromMonth = from?.slice(0, 7);
  const toMonth = to?.slice(0, 7);
  const start = monthIndex(fromMonth || "");
  const end = monthIndex(toMonth || "");
  if (start === null || end === null || start > end) return [];

  const months = [];
  for (let index = start; index <= end; index += 1) {
    months.push(monthFromIndex(index));
  }
  return months;
}

function dailyDateBounds() {
  const dates = (state.data.daily || [])
    .map((row) => row.cost_date)
    .filter(Boolean)
    .sort();
  return {
    from: dates[0] || "",
    to: dates[dates.length - 1] || "",
  };
}

function filterDateRange(filters) {
  const bounds = dailyDateBounds();
  return {
    from: filters.from || bounds.from,
    to: filters.to || bounds.to,
  };
}

function orderIndexMonthsForFilters(filters) {
  if (!state.orderIndexPartitionsByMonth.size) return [];
  const { from, to } = filterDateRange(filters);
  return monthKeysBetween(from, to)
    .filter((month) => state.orderIndexPartitionsByMonth.has(month));
}

function missingOrderIndexMonths(filters) {
  return orderIndexMonthsForFilters(filters)
    .filter((month) => !state.orderIndexRowsByMonth.has(month));
}

function updateOrderIndexLoadingState(filters) {
  if (state.data.order_index) {
    state.orderIndexLoading = false;
    return;
  }

  if (state.orderIndexPartitionsByMonth.size) {
    state.orderIndexLoading = !state.orderIndexError && missingOrderIndexMonths(filters).length > 0;
    return;
  }

  state.orderIndexLoading = Boolean(state.orderIndexFallbackRollup && !state.orderIndexError);
}

function orderIndexRowsForFilters(filters) {
  if (state.data.order_index) return state.data.order_index;
  if (!state.orderIndexPartitionsByMonth.size) return null;

  const months = orderIndexMonthsForFilters(filters);
  const missingMonths = months.filter((month) => !state.orderIndexRowsByMonth.has(month));
  if (missingMonths.length) return null;

  return months.flatMap((month) => state.orderIndexRowsByMonth.get(month) || []);
}

function getFilterCache(filters) {
  const key = baseFilterKey(filters);
  if (state.filterCache?.key === key) return state.filterCache;

  const daily = filteredRollup(state.data.daily, filters).filtered;
  const province = filteredRollup(state.data.province, filters, true);
  const ward = filteredRollup(state.data.ward, filters, true);
  const orderByProvince = new Map();
  let order = null;
  const orderRows = orderIndexRowsForFilters(filters);

  if (orderRows) {
    order = [];
    orderRows.forEach((row) => {
      if (!matchesBaseFilters(row, filters)) return;
      order.push(row);
      addByProvince(orderByProvince, row);
    });
  }

  state.filterCache = {
    key,
    daily,
    order,
    orderByProvince,
    province: province.filtered,
    provinceByProvince: province.provinceMap,
    ward: ward.filtered,
    wardByProvince: ward.provinceMap,
  };
  return state.filterCache;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function applyFilters(options = {}) {
  const loadOrderIndex = options.loadOrderIndex !== false;
  const from = el("dateFrom").value;
  const to = el("dateTo").value;
  const type = el("typeFilter").value;
  const status = el("statusFilter").value;
  const province = el("provinceFilter").value;
  const previous = state.filters || {};
  if (
    previous.from !== from
    || previous.to !== to
    || previous.type !== type
    || previous.status !== status
    || previous.province !== province
  ) {
    state.selectedDistrict = "";
  }
  state.filters = { from, to, type, status, province };
  const baseFilters = { from, to, type, status };
  updateOrderIndexLoadingState(baseFilters);
  const base = getFilterCache(baseFilters);

  state.filtered = {
    daily: province ? (base.provinceByProvince.get(province) || []) : base.daily,
    mapProvince: base.province,
    order: province ? (base.orderByProvince.get(province) || []) : base.order,
    mapOrder: base.order,
    province: province ? (base.provinceByProvince.get(province) || []) : base.province,
    ward: province ? (base.wardByProvince.get(province) || []) : base.ward,
  };

  render();
  if (loadOrderIndex) {
    ensureOrderIndexForCurrentFilters();
  }
}

function renderKpis(rows) {
  const totals = sumRows(rows, state.filtered.order);
  const orderUnit = totals.hasUniqueOrders ? "đơn unique" : "lượt đơn";
  setMetric("kpiCost", compactMoney(totals.cost), money(totals.cost));
  setMetric(
    "kpiCostKg",
    totals.readyWeightKg ? money(totals.cost / totals.readyWeightKg) : "-",
    totals.readyWeightKg ? "Tính trên khối lượng đã có chi phí" : "Chưa có chi phí trong phạm vi lọc",
  );
  setMetric(
    "kpiCostOrder",
    state.orderIndexLoading && !state.filtered.order
      ? "Đang tải..."
      : totals.readyOrders ? money(totals.cost / totals.readyOrders) : "-",
    state.orderIndexLoading && !state.filtered.order
      ? "Đang tải số đơn unique chính xác"
      : totals.readyOrders ? `Tính trên ${orderUnit} đã có chi phí` : "Chưa có chi phí trong phạm vi lọc",
  );
  renderQualityBanner(totals);
}

function renderQualityBanner(totals) {
  const banner = el("qualityBanner");
  const pendingDetails = pendingOrderDetails();
  const dateText = pendingDetails.dateText;
  const hasFullPeriodPending = totals.orders > 0 && totals.weightKg > 0 && totals.cost === 0;
  const missingOrderIndex = !state.filtered.order;
  const messages = [];
  const pendingCount = pendingDetails.totalUnique || totals.pendingOrders;
  const orderUnit = totals.hasUniqueOrders ? "đơn unique" : "lượt đơn";

  if (hasFullPeriodPending) {
    messages.push(`${dateText ? `Từ ${dateText}` : "Giai đoạn này"} có ${compactNumber(pendingCount)} ${orderUnit} chưa có chi phí thuê xe.`);
  } else if (pendingCount) {
    messages.push(`${dateText ? `Từ ${dateText}` : "Giai đoạn này"} có ${compactNumber(pendingCount)} ${orderUnit} chưa có chi phí thuê xe.`);
  }

  if (state.orderIndexLoading && missingOrderIndex) {
    messages.push("Đang tải số đơn unique; dashboard sẽ tự cập nhật sau khi tải xong.");
  } else if (state.orderIndexError && missingOrderIndex) {
    messages.push("Không tải được order_index; số đơn có thể là lượt trong các lát dữ liệu, không phải đơn unique.");
  } else if (missingOrderIndex) {
    messages.push("Không có order_index; số đơn có thể là lượt trong các lát dữ liệu, không phải đơn unique.");
  }

  if (!messages.length) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }

  banner.hidden = false;
  banner.innerHTML = `
    <strong>Chú ý dữ liệu</strong>
    <div>${messages.map((message) => `<span>${escapeHtml(message)}</span>`).join(" ")}</div>
    ${pendingDetails.rows.length ? '<button id="pendingDetailOpen" class="banner-link" type="button">Chi tiết</button>' : ""}
  `;
}

function renderPendingDetails() {
  const { rows, totalUnique, dateText } = pendingOrderDetails();
  const shown = rows.length;
  el("pendingDetailSummary").textContent = dateText
    ? `Từ ${dateText} | hiển thị ${formatVnd.format(shown)} / ${formatVnd.format(totalUnique)} đơn unique`
    : `Hiển thị ${formatVnd.format(shown)} / ${formatVnd.format(totalUnique)} đơn unique`;

  if (!rows.length) {
    el("pendingDetailTable").innerHTML = '<div class="empty">Không có đơn đang thiếu chi phí thuê xe trong phạm vi lọc.</div>';
    return;
  }

  el("pendingDetailTable").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Mã đơn</th>
          <th>Ngày</th>
          <th>Loại chuyến</th>
          <th>Trạng thái</th>
          <th>Tỉnh/TP</th>
          <th>Quận/huyện</th>
          <th>Phường/xã</th>
          <th class="num">Mã khách hàng</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.order_code)}</td>
            <td>${escapeHtml(row.cost_date)}</td>
            <td>${escapeHtml(typeLabel(row.cost_type))}</td>
            <td>${escapeHtml(statusLabel(row.cost_status))}</td>
            <td>${escapeHtml(row.to_province_name)}</td>
            <td>${escapeHtml(row.to_district_name)}</td>
            <td>${escapeHtml(row.to_ward_name)}</td>
            <td class="num">${escapeHtml(row.booking_client_id)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function openPendingDetails() {
  renderPendingDetails();
  const dialog = el("pendingDetailDialog");
  if (dialog.showModal) {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function closePendingDetails() {
  const dialog = el("pendingDetailDialog");
  if (dialog.close) {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

function formatDateDisplay(date) {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function formatTimestampDisplay(value) {
  if (!value) return "";
  const [date, time = ""] = value.split("T");
  const formattedDate = formatDateDisplay(date);
  return time ? `${formattedDate} ${time.slice(0, 5)}` : formattedDate;
}

function summarizeDateRange(first, last) {
  if (!first && !last) return "";
  if (!last || first === last) return formatDateDisplay(first);
  return `${formatDateDisplay(first)} đến ${formatDateDisplay(last)}`;
}

function summarizeDates(dates) {
  if (!dates.length) return "";
  const first = dates[0];
  const last = dates[dates.length - 1];
  return summarizeDateRange(first, last);
}

function monthEndDate(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return "";
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function defaultCompleteMonthRange(rows, monthCount = 3) {
  const byMonth = new Map();

  rows.forEach((row) => {
    const month = row.cost_month || row.cost_date?.slice(0, 7);
    if (!month) return;
    if (!byMonth.has(month)) {
      byMonth.set(month, {
        month,
        cost: 0,
        orders: 0,
        pendingOrders: 0,
      });
    }

    const bucket = byMonth.get(month);
    const orders = numeric(row, "nb_orders");
    const cost = numeric(row, "total_cost");
    bucket.cost += cost;
    bucket.orders += orders;
    if (orders > 0 && cost === 0) bucket.pendingOrders += orders;
  });

  const completeMonths = [...byMonth.values()]
    .filter((bucket) => bucket.orders > 0 && bucket.cost > 0 && bucket.pendingOrders === 0)
    .map((bucket) => bucket.month)
    .sort();
  const selectedMonths = completeMonths.slice(-monthCount);
  if (!selectedMonths.length) return null;

  return {
    from: `${selectedMonths[0]}-01`,
    to: monthEndDate(selectedMonths[selectedMonths.length - 1]),
    months: selectedMonths,
  };
}

function dateToUtc(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateDiffDays(from, to) {
  return Math.round((dateToUtc(to) - dateToUtc(from)) / 86_400_000) + 1;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function adaptivePeriod() {
  const from = state.filters.from || state.data.daily?.map((row) => row.cost_date).sort()[0] || "";
  const to = state.filters.to || state.data.daily?.map((row) => row.cost_date).sort().at(-1) || "";
  if (!from || !to) return "month";
  const days = dateDiffDays(from, to);
  if (days <= 62) return "week";
  return "month";
}

function periodKey(date, period) {
  if (period === "day") return date;
  if (period === "month") return date.slice(0, 7);

  const utc = dateToUtc(date);
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  return isoDate(utc);
}

function periodLabel(key, period) {
  if (period === "day") return formatDateDisplay(key).slice(0, 5);
  if (period === "month") {
    const [year, month] = key.split("-");
    return `${month}/${year}`;
  }
  return `Tuần ${formatDateDisplay(key).slice(0, 5)}`;
}

function periodName(period) {
  return { day: "ngày", week: "tuần", month: "tháng" }[period] || "mốc";
}

function costKgValue(row) {
  return row.readyWeightKg ? row.cost / row.readyWeightKg : 0;
}

function weightedAverageCostKg(rows) {
  const totals = rows.reduce(
    (acc, row) => ({
      cost: acc.cost + row.cost,
      weight: acc.weight + row.readyWeightKg,
    }),
    { cost: 0, weight: 0 },
  );
  return totals.weight ? totals.cost / totals.weight : 0;
}

function aggregateRowsByPeriod(rows, period) {
  const map = new Map();

  rows.forEach((row) => {
    if (!row.cost_date) return;
    const key = period === "month" ? (row.cost_month || row.cost_date.slice(0, 7)) : periodKey(row.cost_date, "week");
    if (!map.has(key)) {
      map.set(key, {
        name: key,
        period,
        firstDate: row.cost_date,
        lastDate: row.cost_date,
        cost: 0,
        readyWeightKg: 0,
        orders: 0,
        pendingOrders: 0,
      });
    }

    const bucket = map.get(key);
    if (row.cost_date < bucket.firstDate) bucket.firstDate = row.cost_date;
    if (row.cost_date > bucket.lastDate) bucket.lastDate = row.cost_date;
    bucket.cost += row.total_cost;
    bucket.orders += row.nb_orders;
    if (row.total_cost > 0) bucket.readyWeightKg += row.sum_weight_kg;
    if (row.nb_orders > 0 && row.total_cost === 0) bucket.pendingOrders += row.nb_orders;
  });

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function chartScopeRows() {
  const province = state.filters.province;
  const source = province ? state.data.province : state.data.daily;
  return (source || []).filter((row) => {
    if (state.filters.type && row.cost_type !== state.filters.type) return false;
    if (state.filters.status && row.cost_status !== state.filters.status) return false;
    if (province && row.to_province_name !== province) return false;
    return true;
  });
}

function previousYearMonth(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${Number(year) - 1}-${month}`;
}

function formatVariance(current, previous) {
  if (!previous) return "";
  const variance = (current - previous) / previous;
  return `${variance >= 0 ? "+" : ""}${formatNumber.format(variance * 100)}%`;
}

function renderMonthComparison(rows) {
  const currentMonths = aggregateRowsByPeriod(rows, "month")
    .filter((d) => d.cost > 0 && d.readyWeightKg > 0)
    .slice(-6);
  if (!currentMonths.length) {
    el("trendNote").textContent = "";
    return emptyChart("trendChart", "Chưa có tháng nào ghi nhận chi phí trong phạm vi lọc");
  }

  const allMonths = aggregateRowsByPeriod(chartScopeRows(), "month");
  const byMonth = new Map(allMonths.map((d) => [d.name, d]));
  const data = currentMonths.map((current) => {
    const previous = byMonth.get(previousYearMonth(current.name));
    return { current, previous };
  });
  const missingPrevious = data.filter((d) => !d.previous?.readyWeightKg).length;
  const hasAnyPrevious = data.some((d) => d.previous?.readyWeightKg);
  el("trendNote").textContent = missingPrevious
    ? `${data.length} tháng gần nhất | chờ dữ liệu cùng kỳ năm trước`
    : `${data.length} tháng gần nhất | đã có cùng tháng năm trước`;

  const values = data.flatMap((d) => [
    costKgValue(d.current),
    d.previous?.readyWeightKg ? costKgValue(d.previous) : 0,
  ]).filter((value) => value > 0);
  const maxValue = Math.max(...values, 1) * 1.08;
  const width = 620;
  const height = 320;
  const pad = { left: 52, right: 18, top: hasAnyPrevious ? 42 : 34, bottom: 60 };
  const chartBottom = height - pad.bottom;
  const slot = (width - pad.left - pad.right) / Math.max(data.length, 1);
  const barW = hasAnyPrevious
    ? Math.max(14, Math.min(28, slot * 0.22))
    : Math.max(28, Math.min(58, slot * 0.34));
  const y = (value) => chartBottom - (value / maxValue) * (chartBottom - pad.top);

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => {
      const gy = y(maxValue * t);
      return `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${gy}" y2="${gy}"></line>
        <text class="label" x="8" y="${gy + 4}">${formatVnd.format(Math.round(maxValue * t))}</text>`;
    })
    .join("");

  const bars = data.map((d, index) => {
    const center = pad.left + slot * index + slot / 2;
    const currentValue = costKgValue(d.current);
    const currentY = y(currentValue);
    const previousValue = d.previous?.readyWeightKg ? costKgValue(d.previous) : 0;
    const previousY = previousValue ? y(previousValue) : chartBottom - 8;
    const monthLabel = periodLabel(d.current.name, "month");
    const varianceText = previousValue ? formatVariance(currentValue, previousValue) : "Chưa có LY";
    const previousCurrent = index ? costKgValue(data[index - 1].current) : 0;
    const momText = previousCurrent ? formatVariance(currentValue, previousCurrent) : "";
    const momClass = previousCurrent && currentValue > previousCurrent ? "above" : "below";
    const currentX = hasAnyPrevious ? center - barW - 3 : center - barW / 2;
    const previousX = center + 3;

    if (!hasAnyPrevious) {
      return `
        <g>
          <title>${escapeHtml(monthLabel)}
Chi phí/kg: ${money(currentValue)}/kg${momText ? `\nSo với tháng trước: ${momText}` : ""}</title>
          <rect class="month-bar current single" x="${currentX}" y="${currentY}" width="${barW}" height="${chartBottom - currentY}" rx="5"></rect>
          <text class="label value-label month-value" x="${center}" y="${Math.max(16, currentY - 8)}">${formatVnd.format(Math.round(currentValue))}</text>
          ${momText ? `<text class="label variance-label ${momClass}" x="${center}" y="${chartBottom + 18}">${escapeHtml(momText)} so với tháng trước</text>` : ""}
          <text class="label month-label" x="${center}" y="${height - 18}">${escapeHtml(monthLabel)}</text>
        </g>
      `;
    }

    return `
      <g>
        <title>${escapeHtml(monthLabel)}
Hiện tại: ${money(currentValue)}/kg${previousValue ? `\nCùng tháng năm trước: ${money(previousValue)}/kg\nChênh lệch: ${varianceText}` : "\nChưa có dữ liệu cùng tháng năm trước"}</title>
        <rect class="month-bar current" x="${currentX}" y="${currentY}" width="${barW}" height="${chartBottom - currentY}" rx="3"></rect>
        ${previousValue
          ? `<rect class="month-bar previous" x="${previousX}" y="${previousY}" width="${barW}" height="${chartBottom - previousY}" rx="3"></rect>`
          : `<rect class="missing-ly-bar" x="${previousX}" y="${previousY}" width="${barW}" height="8" rx="2"></rect>`}
        <text class="label value-label" x="${currentX + barW / 2}" y="${Math.max(14, currentY - 6)}">${formatVnd.format(Math.round(currentValue))}</text>
        <text class="label variance-label ${previousValue && currentValue > previousValue ? "above" : "below"}" x="${center}" y="${Math.min(chartBottom + 20, chartBottom + 16)}">${escapeHtml(varianceText)}</text>
        <text class="label month-label" x="${center}" y="${height - 16}">${escapeHtml(monthLabel)}</text>
      </g>
    `;
  }).join("");

  el("trendChart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="So sánh chi phí/kg tháng gần nhất với cùng tháng năm trước">
      ${grid}
      ${hasAnyPrevious ? `
        <g class="chart-legend" transform="translate(${pad.left + 48}, 14)">
          <rect class="month-bar current" x="0" y="-8" width="12" height="8" rx="2"></rect>
          <text class="label" x="18" y="0">Tháng hiện tại</text>
          <rect class="month-bar previous" x="130" y="-8" width="12" height="8" rx="2"></rect>
          <text class="label" x="148" y="0">Cùng tháng năm trước</text>
        </g>
      ` : ""}
      ${bars}
      <line class="axis" x1="${pad.left}" x2="${width - pad.right}" y1="${chartBottom}" y2="${chartBottom}"></line>
      <text class="label unit-label" x="${pad.left}" y="${pad.top - 14}">đ/kg</text>
    </svg>
  `;
}

function renderWeeklyComparison(rows) {
  const data = aggregateRowsByPeriod(rows, "week")
    .filter((d) => d.cost > 0 && d.readyWeightKg > 0)
    .slice(-8);
  const average = weightedAverageCostKg(data);
  el("timeCompareNote").textContent = data.length
    ? `${data.length} tuần gần nhất | bình quân ${money(average)}/kg`
    : "";
  if (!data.length) return emptyChart("timeCompareChart", "Chưa có tuần nào ghi nhận chi phí trong phạm vi lọc");

  const width = 620;
  const height = 320;
  const pad = { left: 52, right: 18, top: 30, bottom: 52 };
  const chartBottom = height - pad.bottom;
  const maxCostKg = Math.max(...data.map(costKgValue), average, 1);
  const slot = (width - pad.left - pad.right) / data.length;
  const barW = Math.max(16, Math.min(38, slot * 0.48));
  const y = (value) => chartBottom - (value / maxCostKg) * (chartBottom - pad.top);
  const averageY = y(average);

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => {
      const gy = y(maxCostKg * t);
      return `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${gy}" y2="${gy}"></line>
        <text class="label" x="8" y="${gy + 4}">${formatVnd.format(Math.round(maxCostKg * t))}</text>`;
    })
    .join("");

  const bars = data.map((d, index) => {
    const center = pad.left + slot * index + slot / 2;
    const costKg = costKgValue(d);
    const barY = y(costKg);
    const varianceText = formatVariance(costKg, average);
    const statusClass = costKg > average ? "above" : "below";
    const dateText = summarizeDateRange(d.firstDate, d.lastDate);
    return `
      <g>
        <title>${escapeHtml(dateText)}
Chi phí/kg: ${money(costKg)}/kg
So với bình quân: ${varianceText}</title>
        <rect class="time-bar ${statusClass}" x="${center - barW / 2}" y="${barY}" width="${barW}" height="${chartBottom - barY}" rx="3"></rect>
        <text class="label value-label" x="${center}" y="${Math.max(14, barY - 6)}">${formatVnd.format(Math.round(costKg))}</text>
        <text class="label variance-label ${statusClass}" x="${center}" y="${Math.min(chartBottom - 4, barY + 14)}">${varianceText}</text>
        <text class="label" x="${center - 24}" y="${height - 16}">${escapeHtml(periodLabel(d.name, "week"))}</text>
      </g>
    `;
  }).join("");

  el("timeCompareChart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="So sánh chi phí/kg theo 8 tuần gần nhất">
      ${grid}
      <line class="avg-line" x1="${pad.left}" x2="${width - pad.right}" y1="${averageY}" y2="${averageY}"></line>
      ${bars}
      <line class="axis" x1="${pad.left}" x2="${width - pad.right}" y1="${chartBottom}" y2="${chartBottom}"></line>
      <text class="label" x="${pad.left}" y="15">đ/kg</text>
    </svg>
  `;
}

function normalizeProvinceName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[Ðð]/g, (char) => (char === "Ð" ? "D" : "d"))
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function featureProvinceName(feature) {
  return feature?.properties?.NAME_1 || feature?.properties?.VARNAME_1 || "";
}

function districtCompareKey(value) {
  let key = normalizeProvinceName(value).replace(/qui/g, "quy");
  let previous = "";
  while (previous !== key) {
    previous = key;
    key = key.replace(/^(thanhpho|thixa|quan|huyendao|huyen|thitran)/, "");
  }
  return key;
}

const DISTRICT_FEATURE_TO_DATA_ALIASES = {
  [normalizeProvinceName("Bà Rịa - Vũng Tàu")]: {
    [districtCompareKey("Huyện Tân Thành")]: districtCompareKey("Thị Xã Phú Mỹ"),
  },
  [normalizeProvinceName("Thanh Hóa")]: {
    [districtCompareKey("Huyện Tĩnh Gia")]: districtCompareKey("Thị Xã Nghi Sơn"),
  },
  [normalizeProvinceName("Cao Bằng")]: {
    [districtCompareKey("Huyện Phục Hoà")]: districtCompareKey("Huyện Quảng Hòa"),
    [districtCompareKey("Huyện Quảng Uyên")]: districtCompareKey("Huyện Quảng Hòa"),
  },
};

function featureDistrictName(feature) {
  const type = feature?.properties?.TYPE_2 || "";
  const name = feature?.properties?.NAME_2 || feature?.properties?.VARNAME_2 || "";
  if (!type) return name;
  if (normalizeProvinceName(name).startsWith(normalizeProvinceName(type))) return name;
  return `${type} ${name}`.trim();
}

function districtDataKeyForFeature(provinceName, featureName) {
  const provinceKey = normalizeProvinceName(provinceName);
  const featureKey = districtCompareKey(featureName);
  return DISTRICT_FEATURE_TO_DATA_ALIASES[provinceKey]?.[featureKey] || featureKey;
}

function findDistrictRow(data, selectedDistrict) {
  const selectedKey = districtCompareKey(selectedDistrict);
  return data.find((d) => districtCompareKey(d.name) === selectedKey) || null;
}

async function ensureDistrictMap() {
  if (state.districtMap?.features?.length) return state.districtMap;
  if (!state.districtMapPromise) {
    state.districtMapPromise = fetchTextMaybeGzip("./assets/vietnam-districts.geojson.gz")
      .then((text) => JSON.parse(text))
      .then((data) => {
        state.districtMap = data;
        return data;
      });
  }
  return state.districtMapPromise;
}

function makeProjection(features, width, height, pad = 20) {
  const points = [];
  const collect = (coords) => {
    if (typeof coords?.[0] === "number") {
      const [lon, lat] = coords;
      const lonRad = (lon * Math.PI) / 180;
      const rad = (lat * Math.PI) / 180;
      points.push([lonRad, Math.log(Math.tan(Math.PI / 4 + rad / 2))]);
      return;
    }
    coords.forEach(collect);
  };
  features.forEach((feature) => collect(feature.geometry.coordinates));

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;

  return ([lon, lat]) => {
    const lonRad = (lon * Math.PI) / 180;
    const rad = (lat * Math.PI) / 180;
    const yMercator = Math.log(Math.tan(Math.PI / 4 + rad / 2));
    return [
      offsetX + (lonRad - minX) * scale,
      offsetY + (maxY - yMercator) * scale,
    ];
  };
}

function ringPath(ring, project) {
  return ring
    .map((coord, index) => {
      const [x, y] = project(coord);
      return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ") + "Z";
}

function featurePath(feature, project) {
  const { type, coordinates } = feature.geometry;
  if (type === "Polygon") {
    return coordinates.map((ring) => ringPath(ring, project)).join(" ");
  }
  if (type === "MultiPolygon") {
    return coordinates.flatMap((polygon) => polygon.map((ring) => ringPath(ring, project))).join(" ");
  }
  return "";
}

function colorScale(values) {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const colors = ["#d8efe3", "#8ccfb2", "#f1d77a", "#e99a52", "#c84e3a"];
  if (!sorted.length) return { colors, breaks: [], min: 0, max: 0 };
  const quantile = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  return {
    colors,
    breaks: [quantile(0.2), quantile(0.4), quantile(0.6), quantile(0.8)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function heatColor(value, scale) {
  if (!Number.isFinite(value) || value <= 0) return "#e5ebf2";
  const index = scale.breaks.findIndex((limit) => value <= limit);
  return scale.colors[index === -1 ? scale.colors.length - 1 : index];
}

function renderMapLegend(scale) {
  if (!scale.breaks.length) {
    el("mapLegend").innerHTML = '<span class="legend-note">Chưa có chi phí ghi nhận</span>';
    return;
  }
  const gradient = `linear-gradient(90deg, ${scale.colors.join(", ")})`;
  el("mapLegend").innerHTML = `
    <div class="legend-scale">
      <em>Thấp ${formatVnd.format(Math.round(scale.min))}</em>
      <i class="legend-gradient" style="background:${gradient}"></i>
      <em>Cao ${formatVnd.format(Math.round(scale.max))}</em>
    </div>
    <span><i class="pending-swatch"></i>Chưa có chi phí</span>
  `;
}

function setMapMode(mode, provinceName = "") {
  const districtMode = mode === "district";
  el("mapTitle").innerHTML = districtMode
    ? `Chi phí/kg theo quận/huyện ${helpTip("Bản đồ quận/huyện")}`
    : `Chi phí/kg theo tỉnh ${helpTip("Bản đồ tỉnh")}`;
  el("mapRankingTitle").innerHTML = districtMode
    ? `Quận/huyện cao nhất ${helpTip("Quận/huyện cao nhất")}`
    : `Tỉnh cao nhất ${helpTip("Tỉnh cao nhất")}`;
  const back = el("mapBack");
  back.hidden = !districtMode;
  back.textContent = provinceName ? `Tất cả tỉnh` : "Tất cả tỉnh";
  back.title = provinceName ? `Quay lại bản đồ tỉnh từ ${provinceName}` : "Quay lại bản đồ tỉnh";
  const scope = el("mapScope");
  scope.hidden = !districtMode;
  scope.innerHTML = districtMode
    ? `<span>Đang xem tỉnh</span><strong>${escapeHtml(provinceName)}</strong>`
    : "";
}

function districtRankLimit(count) {
  if (count <= 4) return Math.max(1, Math.floor(count / 2));
  if (count <= 8) return 3;
  return 5;
}

function renderMapRanking(data, selectedName, dataKey = "province") {
  const rows = data
    .filter((d) => d.readyWeightKg > 0)
    .sort((a, b) => (b.cost / b.readyWeightKg) - (a.cost / a.readyWeightKg));
  const limit = dataKey === "district" ? districtRankLimit(rows.length) : 8;
  const shownRows = rows.slice(0, limit);
  if (!shownRows.length) {
    el("mapRanking").innerHTML = '<div class="empty">Không có dữ liệu đã có chi phí</div>';
    return;
  }
  el("mapRanking").innerHTML = mapRankList(shownRows, selectedName, "", dataKey);
}

function mapRankList(rows, selectedName, rowClass = "", dataKey = "province") {
  const dataAttribute = dataKey === "district" ? "data-district" : "data-province";
  return `
    <ol>
      ${rows
        .map((d) => `
          <li>
            <button
              class="map-rank-row${rowClass ? ` ${rowClass}` : ""}${selectedName === d.name ? " selected" : ""}"
              ${dataAttribute}="${escapeHtml(d.name)}"
              type="button"
            >
              <span>${escapeHtml(d.name)}</span>
              <strong>${money(d.cost / d.readyWeightKg).replace(" đ", "")} đ/kg</strong>
              <small>${compactMoney(d.cost)} | ${compactWeightKg(d.readyWeightKg)} đã có chi phí</small>
            </button>
          </li>
        `)
        .join("")}
    </ol>
  `;
}

function detailMetric(label, value, subText = "") {
  return `
    <div class="detail-metric">
      <span class="metric-label">${escapeHtml(label)}${helpTip(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${subText ? `<small>${escapeHtml(subText)}</small>` : ""}
    </div>
  `;
}

function renderMapDetail(data, selectedProvince, totals) {
  const readyRows = data.filter((d) => d.readyWeightKg > 0);
  const selected = selectedProvince ? data.find((d) => d.name === selectedProvince) : null;
  const lowBase = readyRows.filter((d) => d.readyWeightKg >= 100_000);
  const lowestRows = (lowBase.length ? lowBase : readyRows)
    .slice()
    .sort((a, b) => (a.cost / a.readyWeightKg) - (b.cost / b.readyWeightKg));
  const subject = selected || totals;
  const costKg = subject.cost / Math.max(subject.readyWeightKg, 1);
  const costShare = selected ? selected.cost / Math.max(totals.cost, 1) : 1;
  const pendingRate = subject.pendingOrders / Math.max(subject.orders, 1);
  const notmatchRate = subject.notmatch / Math.max(subject.cost, 1);
  const orderUnit = subject.hasUniqueOrders ? "đơn unique" : "lượt đơn";
  const costKgText = subject.readyWeightKg ? money(costKg) : "-";
  const costKgSubText = subject.readyWeightKg ? "Không tính đơn chưa có chi phí" : "Chưa có chi phí trong phạm vi lọc";

  el("mapDetailTitle").textContent = selected ? selected.name : "Tỉnh thấp nhất";
  if (!selected) {
    if (!lowestRows.length) {
      el("mapDetail").innerHTML = '<div class="empty">Không có dữ liệu đã có chi phí</div>';
      return;
    }
    el("mapDetail").innerHTML = `
      <div class="map-ranking low-ranking">
        ${mapRankList(lowestRows.slice(0, 8), selectedProvince, "low-rank", "province")}
      </div>
    `;
    return;
  }

  el("mapDetail").innerHTML = `
    ${detailMetric("Chi phí/kg", costKgText, costKgSubText)}
    ${detailMetric("Tổng chi phí", compactMoney(selected.cost), money(selected.cost))}
    ${detailMetric("Tỷ trọng chi phí", pct(costShare))}
    ${detailMetric("Đơn unique", compactNumber(selected.orders), `${formatVnd.format(selected.orders)} ${orderUnit}`)}
    ${detailMetric("Khối lượng đã có chi phí", compactWeightKg(selected.readyWeightKg), `${number(selected.readyWeightKg)} kg`)}
    ${detailMetric("Chưa có chi phí thuê xe", compactNumber(selected.pendingOrders), `${pct(pendingRate)} ${orderUnit}`)}
    ${detailMetric("Tỷ lệ chi phí chưa khớp chuyến", pct(notmatchRate))}
  `;
}

function districtRowsByName(rows, selectedDistrict) {
  if (!rows?.length) return [];
  const exactRows = partitionRows(rows, "to_district_name").get(selectedDistrict);
  if (exactRows) return exactRows;
  const selectedKey = districtCompareKey(selectedDistrict);
  return rows.filter((row) => districtCompareKey(row.to_district_name) === selectedKey);
}

function renderWardDrilldown(selectedDistrict) {
  const wardRows = districtRowsByName(state.filtered.ward, selectedDistrict);
  const orderRows = state.filtered.order ? districtRowsByName(state.filtered.order, selectedDistrict) : null;
  const rows = groupBy(wardRows, "to_ward_name", orderRows)
    .filter((d) => d.readyWeightKg > 0)
    .sort((a, b) => (b.cost / b.readyWeightKg) - (a.cost / a.readyWeightKg))
    .slice(0, 8);

  if (!rows.length) {
    return '<div class="empty compact-empty">Không có phường/xã đã có chi phí</div>';
  }

  return `
    <div class="ward-drilldown">
      <h4>Phường/xã cao nhất ${helpTip("Phường/xã cao nhất")}</h4>
      <table>
        <thead>
          <tr>
            <th>Phường/xã</th>
            <th class="num">Chi phí/kg</th>
            <th class="num">Đơn unique</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              <td class="num">${money(row.cost / row.readyWeightKg)}/kg</td>
              <td class="num" title="${formatVnd.format(row.orders)} ${row.hasUniqueOrders ? "đơn unique" : "lượt"}">${compactNumber(row.orders)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDistrictDetail(data, selectedDistrict, totals) {
  const readyRows = data.filter((d) => d.readyWeightKg > 0);
  const selected = selectedDistrict ? findDistrictRow(data, selectedDistrict) : null;
  const lowestRows = readyRows
    .slice()
    .sort((a, b) => (a.cost / a.readyWeightKg) - (b.cost / b.readyWeightKg));
  const lowLimit = districtRankLimit(lowestRows.length);

  el("mapDetailTitle").textContent = selected ? selected.name : "Quận/huyện thấp nhất";
  if (!selected) {
    if (!lowestRows.length) {
      el("mapDetail").innerHTML = '<div class="empty">Không có dữ liệu đã có chi phí</div>';
      return;
    }
    el("mapDetail").innerHTML = `
      <div class="map-ranking low-ranking">
        ${mapRankList(lowestRows.slice(0, lowLimit), selectedDistrict, "low-rank", "district")}
      </div>
    `;
    return;
  }

  const costKg = selected.cost / Math.max(selected.readyWeightKg, 1);
  const costShare = selected.cost / Math.max(totals.cost, 1);
  const orderUnit = selected.hasUniqueOrders ? "đơn unique" : "lượt đơn";
  const costKgText = selected.readyWeightKg ? money(costKg) : "-";
  const costKgSubText = selected.readyWeightKg ? "Không tính đơn chưa có chi phí" : "Chưa có chi phí trong phạm vi lọc";

  el("mapDetail").innerHTML = `
    ${detailMetric("Chi phí/kg", costKgText, costKgSubText)}
    ${detailMetric("Tỷ trọng chi phí", pct(costShare))}
    ${detailMetric("Đơn unique", compactNumber(selected.orders), `${formatVnd.format(selected.orders)} ${orderUnit}`)}
    ${renderWardDrilldown(selected.name)}
  `;
}

function wireMapInteractions(mapTarget) {
  mapTarget.querySelectorAll("[data-province]").forEach((path) => {
    path.addEventListener("click", () => {
      const province = path.getAttribute("data-province");
      const select = el("provinceFilter");
      select.value = select.value === province ? "" : province;
      applyFilters();
    });
  });

  mapTarget.querySelectorAll("[data-district]").forEach((path) => {
    path.addEventListener("click", () => {
      const district = path.getAttribute("data-district");
      state.selectedDistrict = state.selectedDistrict === district ? "" : district;
      renderProvinceMap(state.filtered.mapProvince, state.filtered.mapOrder);
    });
  });

  document.querySelectorAll(".map-rank-row").forEach((row) => {
    row.addEventListener("click", () => {
      const district = row.getAttribute("data-district");
      if (district) {
        state.selectedDistrict = state.selectedDistrict === district ? "" : district;
        renderProvinceMap(state.filtered.mapProvince, state.filtered.mapOrder);
        return;
      }

      const province = row.getAttribute("data-province");
      if (!province) return;
      const select = el("provinceFilter");
      select.value = select.value === province ? "" : province;
      applyFilters();
    });
  });
}

function renderDistrictMap(selectedProvince) {
  const mapTarget = el("provinceMap");
  setMapMode("district", selectedProvince);

  if (state.wardLoading && !state.data.ward) {
    mapTarget.innerHTML = '<div class="empty">Đang tải dữ liệu quận/huyện...</div>';
    el("mapNote").textContent = `${selectedProvince} | đang tải dữ liệu chi tiết`;
    el("mapLegend").innerHTML = "";
    el("mapRanking").innerHTML = "";
    el("mapDetailTitle").textContent = "Quận/huyện thấp nhất";
    el("mapDetail").innerHTML = "";
    return;
  }

  if (state.wardError && !state.data.ward) {
    mapTarget.innerHTML = '<div class="empty">Không tải được dữ liệu quận/huyện</div>';
    el("mapNote").textContent = `${selectedProvince} | lỗi dữ liệu chi tiết`;
    el("mapLegend").innerHTML = "";
    el("mapRanking").innerHTML = "";
    el("mapDetailTitle").textContent = "Quận/huyện thấp nhất";
    el("mapDetail").innerHTML = "";
    return;
  }

  if (!state.districtMap?.features?.length) {
    mapTarget.innerHTML = '<div class="empty">Đang tải bản đồ quận/huyện...</div>';
    el("mapNote").textContent = `Đang mở chi tiết ${selectedProvince}`;
    el("mapLegend").innerHTML = "";
    el("mapRanking").innerHTML = "";
    el("mapDetailTitle").textContent = "Quận/huyện thấp nhất";
    el("mapDetail").innerHTML = "";
    ensureDistrictMap()
      .then(() => {
        if (el("provinceFilter").value === selectedProvince) {
          renderProvinceMap(state.filtered.mapProvince, state.filtered.mapOrder);
        }
      })
      .catch((error) => {
        console.error(error);
        mapTarget.innerHTML = '<div class="empty">Không tải được bản đồ quận/huyện</div>';
      });
    return;
  }

  const provinceKey = normalizeProvinceName(selectedProvince);
  const districtFeatures = state.districtMap.features
    .filter((feature) => normalizeProvinceName(featureProvinceName(feature)) === provinceKey);
  const data = groupBy(state.filtered.ward, "to_district_name", state.filtered.order);
  const byDistrict = new Map(data.map((d) => [districtCompareKey(d.name), d]));
  const values = data.filter((d) => d.readyWeightKg > 0).map((d) => d.cost / d.readyWeightKg);
  const scale = colorScale(values);

  renderMapLegend(scale);
  renderMapRanking(data, state.selectedDistrict, "district");
  renderDistrictDetail(data, state.selectedDistrict, sumRows(state.filtered.ward, state.filtered.order));

  if (!districtFeatures.length) {
    mapTarget.innerHTML = `<div class="empty">Không có polygon quận/huyện cho ${escapeHtml(selectedProvince)}</div>`;
    el("mapNote").textContent = `${selectedProvince} | ${data.length} quận/huyện có dữ liệu`;
    wireMapInteractions(mapTarget);
    return;
  }

  const width = 430;
  const height = 620;
  const project = makeProjection(districtFeatures, width, height, 14);
  const matchedDataKeys = new Set();

  const paths = districtFeatures.map((feature) => {
    const rawName = featureDistrictName(feature);
    const dataKey = districtDataKeyForFeature(selectedProvince, rawName);
    const dataRow = byDistrict.get(dataKey);
    const displayName = dataRow?.name || rawName;
    const costKg = dataRow?.readyWeightKg ? dataRow.cost / dataRow.readyWeightKg : 0;
    const hasPending = (dataRow?.pendingOrders || 0) > 0;
    const hasReady = (dataRow?.readyWeightKg || 0) > 0;
    if (dataRow) matchedDataKeys.add(districtCompareKey(dataRow.name));
    const fill = hasReady ? heatColor(costKg, scale) : hasPending ? "url(#pendingHatch)" : "#e7edf4";
    const selected = state.selectedDistrict && dataRow && districtCompareKey(dataRow.name) === districtCompareKey(state.selectedDistrict);
    const dataAttr = dataRow ? `data-district="${escapeHtml(dataRow.name)}"` : "";

    return `
      <path
        class="province-shape district-shape${selected ? " selected" : ""}${dataRow ? "" : " no-data"}"
        ${dataAttr}
        d="${featurePath(feature, project)}"
        fill="${fill}"
      >
        <title>${escapeHtml(displayName)}
Chi phí/kg: ${hasReady ? money(costKg) : "chưa có chi phí ghi nhận"}
Chi phí: ${money(dataRow?.cost || 0)}
Đơn: ${formatVnd.format(dataRow?.orders || 0)}
Chưa có chi phí: ${formatVnd.format(dataRow?.pendingOrders || 0)}</title>
      </path>
    `;
  });

  const totals = sumRows(state.filtered.ward, state.filtered.order);
  const weightedCostKg = totals.cost / Math.max(totals.readyWeightKg, 1);
  const pendingOnly = data.filter((d) => !d.readyWeightKg && d.pendingOrders > 0).length;
  const unmatched = Math.max(data.length - matchedDataKeys.size, 0);
  el("mapNote").textContent = totals.readyWeightKg
    ? `${selectedProvince} | ${data.length} quận/huyện có dữ liệu | bình quân ${money(weightedCostKg)}/kg${unmatched ? ` | ${unmatched} chỉ xem trong danh sách` : ""}${pendingOnly ? ` | ${pendingOnly} chưa có chi phí` : ""}`
    : `${selectedProvince} | ${data.length} quận/huyện có dữ liệu | chưa có chi phí ghi nhận${unmatched ? ` | ${unmatched} chỉ xem trong danh sách` : ""}`;

  mapTarget.innerHTML = `
    <svg class="vietnam-map district-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="Bản đồ nhiệt chi phí/kg theo quận huyện của ${escapeHtml(selectedProvince)}">
      <defs>
        <pattern id="pendingHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#fff6df"></rect>
          <line x1="0" y1="0" x2="0" y2="8" stroke="#d5901e" stroke-width="2"></line>
        </pattern>
      </defs>
      <rect class="map-bg" x="0" y="0" width="${width}" height="${height}" rx="10"></rect>
      <g>${paths.join("")}</g>
    </svg>
  `;

  wireMapInteractions(mapTarget);
}

function renderProvinceMap(rows, orderRows = null) {
  const selectedProvince = el("provinceFilter").value;
  if (selectedProvince) {
    renderDistrictMap(selectedProvince);
    return;
  }

  const mapTarget = el("provinceMap");
  setMapMode("province");
  if (!state.map?.features?.length) {
    mapTarget.innerHTML = '<div class="empty">Không tải được bản đồ Việt Nam</div>';
    el("mapNote").textContent = "";
    el("mapLegend").innerHTML = "";
    el("mapRanking").innerHTML = "";
    return;
  }

  const data = groupBy(rows, "to_province_name", orderRows);
  const byProvince = new Map(data.map((d) => [normalizeProvinceName(d.name), d]));
  const values = data.filter((d) => d.readyWeightKg > 0).map((d) => d.cost / d.readyWeightKg);
  const scale = colorScale(values);
  const width = 430;
  const height = 720;
  const project = makeProjection(state.map.features, width, height);
  let matched = 0;
  let pendingOnly = 0;

  const paths = state.map.features.map((feature) => {
    const rawName = featureProvinceName(feature);
    const dataRow = byProvince.get(normalizeProvinceName(rawName));
    const displayName = dataRow?.name || rawName;
    const costKg = dataRow?.readyWeightKg ? dataRow.cost / dataRow.readyWeightKg : 0;
    const hasPending = (dataRow?.pendingOrders || 0) > 0;
    const hasReady = (dataRow?.readyWeightKg || 0) > 0;
    if (dataRow) matched += 1;
    if (!hasReady && hasPending) pendingOnly += 1;
    const fill = hasReady ? heatColor(costKg, scale) : hasPending ? "url(#pendingHatch)" : "#e7edf4";
    return `
      <path
        class="province-shape"
        data-province="${escapeHtml(displayName)}"
        d="${featurePath(feature, project)}"
        fill="${fill}"
      >
        <title>${escapeHtml(displayName)}
Chi phí/kg: ${hasReady ? money(costKg) : "chưa có chi phí ghi nhận"}
Chi phí: ${money(dataRow?.cost || 0)}
Đơn: ${formatVnd.format(dataRow?.orders || 0)}
Chưa có chi phí: ${formatVnd.format(dataRow?.pendingOrders || 0)}</title>
      </path>
    `;
  });

  const totals = sumRows(rows, orderRows);
  const weightedCostKg = totals.cost / Math.max(totals.readyWeightKg, 1);
  el("mapNote").textContent = totals.readyWeightKg
    ? `${matched}/63 tỉnh có dữ liệu | bình quân ${money(weightedCostKg)}/kg đã có chi phí${pendingOnly ? ` | ${pendingOnly} tỉnh chỉ có đơn chưa có chi phí` : ""}`
    : `${matched}/63 tỉnh có dữ liệu | chưa có chi phí ghi nhận${pendingOnly ? ` | ${pendingOnly} tỉnh chỉ có đơn chưa có chi phí` : ""}`;
  renderMapLegend(scale);
  renderMapRanking(data, "", "province");
  renderMapDetail(data, "", totals);

  mapTarget.innerHTML = `
    <svg class="vietnam-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="Bản đồ nhiệt chi phí/kg theo tỉnh">
      <defs>
        <pattern id="pendingHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#fff6df"></rect>
          <line x1="0" y1="0" x2="0" y2="8" stroke="#d5901e" stroke-width="2"></line>
        </pattern>
      </defs>
      <rect class="map-bg" x="0" y="0" width="${width}" height="${height}" rx="10"></rect>
      <g>${paths.join("")}</g>
    </svg>
  `;

  wireMapInteractions(mapTarget);
}

function compactChartMoney(value) {
  if (value >= 1_000_000_000) return `${number(value / 1_000_000_000)} tỷ`;
  if (value >= 1_000_000) return `${number(value / 1_000_000)} triệu`;
  if (value >= 1_000) return `${number(value / 1_000)} nghìn`;
  return number(value);
}

function emptyChart(target, message = "Không có dữ liệu") {
  el(target).innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
}

function renderTable(target, rows, key, orderRows = null, limit = 15) {
  const data = groupBy(rows, key, orderRows)
    .filter((d) => d.readyWeightKg > 0)
    .sort((a, b) => (b.cost / b.readyWeightKg) - (a.cost / a.readyWeightKg))
    .slice(0, limit);
  if (!data.length) {
    el(target).innerHTML = '<div class="empty">Không có dữ liệu đã có chi phí</div>';
    return;
  }
  el(target).innerHTML = `
    <table class="ranking-table">
      <colgroup>
        <col class="rank-name-col" />
        <col class="rank-cost-col" />
        <col class="rank-orders-col" />
        <col class="rank-costkg-col" />
      </colgroup>
      <thead>
        <tr>
          <th>${keyLabel(key)}</th>
          <th class="num">Chi phí</th>
          <th class="num">Đơn unique</th>
          <th class="num">Chi phí/kg</th>
        </tr>
      </thead>
      <tbody>
        ${data
          .map(
            (d) => `
          <tr>
            <td>${escapeHtml(d.name)}</td>
            <td class="num" title="${money(d.cost)}">${compactMoney(d.cost)}</td>
            <td class="num" title="${formatVnd.format(d.orders)} ${d.hasUniqueOrders ? "đơn unique" : "lượt"}">${compactNumber(d.orders)}</td>
            <td class="num">${d.readyWeightKg ? money(d.cost / d.readyWeightKg) : "-"}</td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function keyLabel(key) {
  return {
    to_province_name: "Tỉnh/TP",
    to_ward_name: "Phường/xã",
    booking_client_id: "Mã khách hàng",
  }[key] || key;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `${response.status} ${url}`);
  }
  return data;
}

function showAdminError(message = "") {
  const banner = el("adminError");
  if (!message) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  banner.innerHTML = `
    <strong>Lỗi quyền truy cập</strong>
    <div><span>${escapeHtml(message)}</span></div>
  `;
}

function roleLabel(role) {
  if (!role) return "-";
  return role === "admin" ? "Admin" : "Viewer";
}

function statusLabelAdmin(status) {
  return status === "suspended" ? "Tạm tắt" : "Đang bật";
}

function renderAdminUsers(users = []) {
  el("adminUsersSummary").textContent = users.length ? `${formatVnd.format(users.length)} user` : "";
  if (!users.length) {
    el("adminUsersTable").innerHTML = '<div class="empty">Chưa có user trong Firebase.</div>';
    return;
  }

  el("adminUsersTable").innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Email</th>
          <th>Tên</th>
          <th>Role</th>
          <th>Trạng thái</th>
          <th>Lần vào gần nhất</th>
          <th class="num">Số lần</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${users.map((user) => `
          <tr>
            <td>${escapeHtml(user.email || "")}</td>
            <td>${escapeHtml(user.name || "")}</td>
            <td>
              <select class="admin-select" data-admin-role="${escapeHtml(user.email || "")}">
                <option value="viewer"${user.role !== "admin" ? " selected" : ""}>Viewer</option>
                <option value="admin"${user.role === "admin" ? " selected" : ""}>Admin</option>
              </select>
            </td>
            <td>
              <select class="admin-select" data-admin-status="${escapeHtml(user.email || "")}">
                <option value="active"${user.status !== "suspended" ? " selected" : ""}>Đang bật</option>
                <option value="suspended"${user.status === "suspended" ? " selected" : ""}>Tạm tắt</option>
              </select>
            </td>
            <td>${escapeHtml(formatTimestampDisplay(user.lastLoginAt || ""))}</td>
            <td class="num">${formatVnd.format(user.loginCount || 0)}</td>
            <td class="num"><button class="banner-link admin-save-user" type="button" data-admin-save="${escapeHtml(user.email || "")}">Lưu</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderAuditLogs(logs = []) {
  el("adminAuditSummary").textContent = logs.length ? `${formatVnd.format(logs.length)} log gần nhất` : "";
  if (!logs.length) {
    el("adminAuditTable").innerHTML = '<div class="empty">Chưa có audit log.</div>';
    return;
  }

  el("adminAuditTable").innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Thời gian</th>
          <th>Email</th>
          <th>Kết quả</th>
          <th>Role</th>
          <th>Lý do</th>
          <th>IP</th>
        </tr>
      </thead>
      <tbody>
        ${logs.map((log) => `
          <tr>
            <td>${escapeHtml(formatTimestampDisplay(log.createdAt || ""))}</td>
            <td>${escapeHtml(log.email || "")}</td>
            <td><span class="admin-badge ${log.result === "success" ? "ok" : "blocked"}">${escapeHtml(log.result || "")}</span></td>
            <td>${escapeHtml(roleLabel(log.role || ""))}</td>
            <td>${escapeHtml(log.reason || "")}</td>
            <td>${escapeHtml(log.ip || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function loadAdminData(force = false) {
  if (!isAdminSession(state.authSession)) return;
  if (state.adminLoaded && !force) return;

  showAdminError("");
  el("adminUsersTable").innerHTML = '<div class="empty">Đang tải user...</div>';
  el("adminAuditTable").innerHTML = '<div class="empty">Đang tải audit...</div>';

  try {
    const [usersData, auditData] = await Promise.all([
      fetchJson("/api/admin/users"),
      fetchJson("/api/admin/audit?limit=100"),
    ]);
    renderAdminUsers(usersData.users || []);
    renderAuditLogs(auditData.logs || []);
    state.adminLoaded = true;
  } catch (error) {
    showAdminError(error.message);
    el("adminUsersTable").innerHTML = '<div class="empty">Không tải được danh sách user.</div>';
    el("adminAuditTable").innerHTML = '<div class="empty">Không tải được audit log.</div>';
  }
}

async function saveAdminUser(email) {
  const role = document.querySelector(`[data-admin-role="${CSS.escape(email)}"]`)?.value || "viewer";
  const status = document.querySelector(`[data-admin-status="${CSS.escape(email)}"]`)?.value || "active";
  showAdminError("");
  try {
    await fetchJson("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        role,
        status,
        permissions: {
          dashboard: status === "active",
          admin: status === "active" && role === "admin",
        },
      }),
    });
    state.adminLoaded = false;
    await loadAdminData(true);
  } catch (error) {
    showAdminError(error.message);
  }
}

async function addAdminUser(event) {
  event.preventDefault();
  const emailInput = el("adminNewUserEmail");
  const roleInput = el("adminNewUserRole");
  const email = String(emailInput.value || "").trim().toLowerCase();
  const role = roleInput.value === "admin" ? "admin" : "viewer";

  if (!isAllowedEmail(email)) {
    showAdminError(`Email phải thuộc domain @${AUTH_CONFIG.allowedDomain}.`);
    return;
  }

  showAdminError("");
  try {
    await fetchJson("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        role,
        status: "active",
        permissions: {
          dashboard: true,
          admin: role === "admin",
        },
      }),
    });
    emailInput.value = "";
    roleInput.value = "viewer";
    state.adminLoaded = false;
    await loadAdminData(true);
  } catch (error) {
    showAdminError(error.message);
  }
}

function render() {
  renderKpis(state.filtered.province);
  renderProvinceMap(state.filtered.mapProvince, state.filtered.mapOrder);
  renderMonthComparison(state.filtered.daily);
  renderWeeklyComparison(state.filtered.daily);
}

function setActiveTab(targetId) {
  if (targetId === "adminPanel" && !isAdminSession(state.authSession)) {
    targetId = "dashboardPanel";
  }

  document.querySelectorAll(".tab-button").forEach((button) => {
    const active = button.dataset.tabTarget === targetId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const active = panel.id === targetId;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });

  document.querySelector(".app-shell")?.classList.toggle("method-active", targetId !== "dashboardPanel");
  if (targetId === "adminPanel") loadAdminData();
}

async function loadData() {
  const manifest = await fetch(`${DATA_BASE}/manifest.json`).then((r) => r.json());
  state.manifest = manifest;
  const rollups = Object.fromEntries((manifest.rollups || []).map((r) => [r.name, r.file]));
  state.orderIndexPartitions = manifest.order_index_partitions || [];
  state.orderIndexPartitionsByMonth = new Map(
    state.orderIndexPartitions.map((partition) => [partition.month, partition]),
  );
  state.orderIndexRowsByMonth = new Map();
  state.orderIndexLoadsByMonth = new Map();
  state.orderIndexFallbackRollup = rollups.order_index || "";
  const entries = await Promise.all(
    ["daily", "province"].map((name) => loadRollup(name, rollups)),
  );
  state.data = Object.fromEntries(entries);
  state.wardLoading = Boolean(rollups.ward);
  state.wardError = null;
  state.orderIndexLoading = Boolean(state.orderIndexPartitions.length || state.orderIndexFallbackRollup);
  state.orderIndexError = null;
  state.map = JSON.parse(await fetchTextMaybeGzip("./assets/vietnam-provinces.geojson.gz"));

  const dates = state.data.daily.map((r) => r.cost_date).sort();
  const defaultRange = defaultCompleteMonthRange(state.data.daily, 3);
  el("dateFrom").value = defaultRange?.from || dates[0] || "";
  el("dateTo").value = defaultRange?.to || dates[dates.length - 1] || "";
  setOptions(el("typeFilter"), state.data.daily.map((r) => r.cost_type));
  setOptions(el("statusFilter"), state.data.daily.map((r) => r.cost_status));
  setOptions(el("provinceFilter"), state.data.province.map((r) => r.to_province_name));
  el("dataFootnote").textContent = `Cập nhật: ${formatTimestampDisplay(manifest.generated_at) || "N/A"}.`;

  applyFilters({ loadOrderIndex: false });

  if (rollups.ward) {
    loadWard(rollups);
  }

  if (state.orderIndexPartitions.length) {
    scheduleBackgroundLoad(() => ensureOrderIndexForCurrentFilters(), ORDER_INDEX_DELAY_MS);
  } else if (state.orderIndexFallbackRollup) {
    scheduleBackgroundLoad(() => loadOrderIndex(rollups), ORDER_INDEX_DELAY_MS);
  }
}

async function loadRollup(name, rollups) {
  const file = rollups[name] || `rollups/${name}.csv.gz`;
  const text = await fetchTextMaybeGzip(`${DATA_BASE}/${file}`);
  const rows = parseCsv(text).map(name === "order_index" ? normalizeOrderIndex : normalize);
  return [name, rows];
}

async function loadOrderIndex(rollups) {
  try {
    const [, rows] = await loadRollup("order_index", rollups);
    state.data.order_index = rows;
    state.orderIndexError = null;
  } catch (error) {
    console.error(error);
    state.orderIndexError = error;
  } finally {
    state.orderIndexLoading = false;
    state.filterCache = null;
    applyFilters({ loadOrderIndex: false });
  }
}

async function loadOrderIndexMonth(month) {
  if (state.orderIndexRowsByMonth.has(month)) return;
  if (state.orderIndexLoadsByMonth.has(month)) {
    await state.orderIndexLoadsByMonth.get(month);
    return;
  }

  const partition = state.orderIndexPartitionsByMonth.get(month);
  if (!partition) return;

  const loadPromise = fetchTextMaybeGzip(`${DATA_BASE}/${partition.file}`)
    .then((text) => parseCsv(text).map(normalizeOrderIndex))
    .then((rows) => {
      state.orderIndexRowsByMonth.set(month, rows);
    })
    .finally(() => {
      state.orderIndexLoadsByMonth.delete(month);
    });
  state.orderIndexLoadsByMonth.set(month, loadPromise);
  await loadPromise;
}

async function ensureOrderIndexForCurrentFilters() {
  if (!state.orderIndexPartitionsByMonth.size) return;

  const baseFilters = {
    from: state.filters.from,
    to: state.filters.to,
    type: state.filters.type,
    status: state.filters.status,
  };
  const months = missingOrderIndexMonths(baseFilters);
  if (!months.length) {
    updateOrderIndexLoadingState(baseFilters);
    return;
  }

  state.orderIndexLoading = true;
  try {
    await Promise.all(months.map(loadOrderIndexMonth));
    state.orderIndexError = null;
  } catch (error) {
    console.error(error);
    state.orderIndexError = error;
  } finally {
    state.filterCache = null;
    const currentFilters = {
      from: state.filters.from,
      to: state.filters.to,
      type: state.filters.type,
      status: state.filters.status,
    };
    updateOrderIndexLoadingState(currentFilters);
    applyFilters({ loadOrderIndex: false });
  }
}

async function loadWard(rollups) {
  try {
    const [, rows] = await loadRollup("ward", rollups);
    state.data.ward = rows;
    state.wardError = null;
  } catch (error) {
    console.error(error);
    state.wardError = error;
  } finally {
    state.wardLoading = false;
    state.filterCache = null;
    applyFilters({ loadOrderIndex: false });
  }
}

function scheduleBackgroundLoad(task, timeout) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(task, { timeout });
    return;
  }
  window.setTimeout(task, timeout);
}

["dateFrom", "dateTo", "typeFilter", "statusFilter", "provinceFilter"].forEach((id) => {
  el(id).addEventListener("change", applyFilters);
});

document.addEventListener("click", (event) => {
  if (event.target.closest?.("#pendingDetailOpen")) openPendingDetails();
  if (event.target.closest?.("#adminRefreshButton")) loadAdminData(true);
  const saveButton = event.target.closest?.(".admin-save-user");
  if (saveButton) saveAdminUser(saveButton.dataset.adminSave);
});

el("pendingDetailClose").addEventListener("click", closePendingDetails);
el("pendingDetailDialog").addEventListener("click", (event) => {
  if (event.target === el("pendingDetailDialog")) closePendingDetails();
});
el("adminAddUserForm").addEventListener("submit", addAdminUser);
el("mapBack").addEventListener("click", () => {
  el("provinceFilter").value = "";
  state.selectedDistrict = "";
  applyFilters();
});

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => setActiveTab(button.dataset.tabTarget));
});

el("signOutButton").addEventListener("click", async () => {
  clearAuthSession();
  state.authSession = null;
  try {
    await fetch("/api/logout", { method: "POST", keepalive: true });
  } catch (error) {
    console.warn("Cannot clear server session", error);
  }
  window.google?.accounts?.id?.disableAutoSelect();
  const url = new URL(window.location.href);
  url.searchParams.delete("devAuth");
  window.location.href = url.toString();
});

initAuthGate();
