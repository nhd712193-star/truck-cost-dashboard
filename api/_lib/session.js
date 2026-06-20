const crypto = require("crypto");

const COOKIE_NAME = "truck_cost_session";

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function unbase64url(value) {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV) {
    throw new Error("Missing SESSION_SECRET");
  }
  return "truck-cost-dashboard-dev-secret";
}

function signPayload(payload) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", sessionSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyPayload(token) {
  if (!token || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", sessionSecret())
    .update(encoded)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature || "");
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(unbase64url(encoded));
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function createCsrfToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const index = entry.indexOf("=");
      if (index === -1) return acc;
      acc[entry.slice(0, index)] = decodeURIComponent(entry.slice(index + 1));
      return acc;
    }, {});
}

function setSessionCookie(res, session, maxAgeSeconds = 3600) {
  const payload = {
    email: session.email,
    name: session.name,
    role: session.role,
    permissions: session.permissions,
    csrfToken: session.csrfToken || createCsrfToken(),
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  };
  const token = signPayload(payload);
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
  return payload;
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function readSession(req) {
  return verifyPayload(parseCookies(req)[COOKIE_NAME]);
}

function requireAdmin(req, res) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ message: "Phiên đăng nhập không hợp lệ." });
    return null;
  }
  if (!session.permissions?.admin) {
    res.status(403).json({ message: "Tài khoản chưa có quyền quản trị." });
    return null;
  }
  return session;
}

function requireDashboard(req, res) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ message: "Phiên đăng nhập không hợp lệ." });
    return null;
  }
  if (!session.permissions?.dashboard) {
    res.status(403).json({ message: "Tài khoản chưa có quyền xem dashboard." });
    return null;
  }
  return session;
}

module.exports = {
  clearSessionCookie,
  createCsrfToken,
  readSession,
  requireAdmin,
  requireDashboard,
  setSessionCookie,
};
