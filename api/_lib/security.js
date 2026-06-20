const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_ORIGIN = "https://truck-cost-dashboard.vercel.app";
const LOCAL_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const rateBuckets = new Map();

function parseOrigin(value) {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch (error) {
    return "";
  }
}

function allowedOrigins() {
  const values = new Set([DEFAULT_ORIGIN, ...LOCAL_ORIGINS]);
  if (process.env.VERCEL_URL) values.add(`https://${process.env.VERCEL_URL}`);
  for (const value of String(process.env.APP_ORIGIN || "").split(",")) {
    const origin = parseOrigin(value.trim());
    if (origin) values.add(origin);
  }
  for (const value of String(process.env.ALLOWED_ORIGINS || "").split(",")) {
    const origin = parseOrigin(value.trim());
    if (origin) values.add(origin);
  }
  return values;
}

function requestOrigin(req) {
  const origin = parseOrigin(req.headers.origin);
  if (origin) return origin;
  return parseOrigin(req.headers.referer);
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function setApiSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function requireTrustedOrigin(req, res) {
  if (SAFE_METHODS.has(req.method)) return true;
  const origin = requestOrigin(req);
  if (!origin || !allowedOrigins().has(origin)) {
    res.status(403).json({ message: "Origin không được phép." });
    return false;
  }
  return true;
}

function requireSameSiteFetch(req, res) {
  const site = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (site && !["same-origin", "same-site", "none"].includes(site)) {
    res.status(403).json({ message: "Cross-site data request không được phép." });
    return false;
  }
  return true;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return require("crypto").timingSafeEqual(left, right);
}

function requireCsrf(req, res, session) {
  if (SAFE_METHODS.has(req.method)) return true;
  const token = req.headers["x-csrf-token"];
  if (!session?.csrfToken || !safeEqual(token, session.csrfToken)) {
    res.status(403).json({ message: "CSRF token không hợp lệ." });
    return false;
  }
  return true;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function rateLimit(req, res, options = {}) {
  const windowMs = options.windowMs || 60_000;
  const max = options.max || 30;
  const scope = options.scope || "default";
  const now = Date.now();
  const key = [
    scope,
    options.email || "",
    clientIp(req),
  ].join(":");
  const bucket = rateBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  bucket.count += 1;
  if (bucket.count > max) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ message: "Quá nhiều request. Vui lòng thử lại sau." });
    return false;
  }

  return true;
}

module.exports = {
  allowedOrigins,
  rateLimit,
  requireCsrf,
  requireSameSiteFetch,
  requireTrustedOrigin,
  setApiSecurityHeaders,
  setNoStore,
};
