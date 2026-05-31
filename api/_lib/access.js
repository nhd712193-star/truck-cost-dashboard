const {
  createDocument,
  getDocument,
  isFirestoreConfigured,
  listDocuments,
  patchDocument,
} = require("./firestore");

const USERS_COLLECTION = "dashboard_users";
const AUDIT_COLLECTION = "dashboard_audit_logs";
const DEFAULT_ALLOWED_DOMAIN = "ghn.vn";

function nowIso() {
  return new Date().toISOString();
}

function docIdForEmail(email) {
  return Buffer.from(String(email).toLowerCase()).toString("base64url");
}

function bootstrapAdminEmails() {
  return String(process.env.BOOTSTRAP_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function defaultPermissions(role, status = "active") {
  if (status !== "active") return { dashboard: false, admin: false };
  return {
    dashboard: true,
    admin: role === "admin",
  };
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function userAgent(req) {
  return String(req.headers["user-agent"] || "");
}

function autoProvisionUsers() {
  return process.env.AUTO_PROVISION_USERS !== "false";
}

function isBootstrapAdmin(email) {
  return bootstrapAdminEmails().includes(String(email).toLowerCase());
}

function normalizeUser(user) {
  const role = user.role || "viewer";
  const status = user.status || "active";
  return {
    ...user,
    role,
    status,
    permissions: user.permissions || defaultPermissions(role, status),
  };
}

async function auditLogin(req, event) {
  if (!isFirestoreConfigured()) return;
  try {
    await createDocument(AUDIT_COLLECTION, {
      ...event,
      createdAt: nowIso(),
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
  } catch (error) {
    console.error("Cannot write audit log", error);
  }
}

async function resolveDashboardUser(req, token) {
  const allowedDomain = (process.env.ALLOWED_DOMAIN || DEFAULT_ALLOWED_DOMAIN).toLowerCase();
  const email = String(token.email || "").toLowerCase();
  const hostedDomain = String(token.hd || "").toLowerCase();
  const displayName = token.name || email;
  const picture = token.picture || "";

  if (!email.endsWith(`@${allowedDomain}`) || hostedDomain !== allowedDomain) {
    await auditLogin(req, { email, result: "denied", reason: "domain" });
    const error = new Error(`Chỉ tài khoản @${allowedDomain} mới được truy cập.`);
    error.statusCode = 403;
    throw error;
  }

  if (!isFirestoreConfigured()) {
    const role = isBootstrapAdmin(email) ? "admin" : "viewer";
    return {
      email,
      name: displayName,
      picture,
      role,
      status: "active",
      user_group: "truck-cost-dashboard",
      permissions: defaultPermissions(role),
    };
  }

  const docId = docIdForEmail(email);
  const existing = await getDocument(USERS_COLLECTION, docId);
  const bootstrapAdmin = isBootstrapAdmin(email);

  if (!existing && !autoProvisionUsers() && !bootstrapAdmin) {
    await auditLogin(req, { email, result: "denied", reason: "not_registered" });
    const error = new Error("Tài khoản chưa nằm trong danh sách được cấp quyền.");
    error.statusCode = 403;
    throw error;
  }

  const createdUser = existing || {
    email,
    name: displayName,
    picture,
    role: bootstrapAdmin ? "admin" : "viewer",
    status: "active",
    user_group: "truck-cost-dashboard",
    permissions: defaultPermissions(bootstrapAdmin ? "admin" : "viewer"),
    createdAt: nowIso(),
    loginCount: 0,
  };

  const role = bootstrapAdmin ? "admin" : createdUser.role || "viewer";
  const status = createdUser.status || "active";
  const permissions = bootstrapAdmin ? defaultPermissions("admin", status) : (createdUser.permissions || defaultPermissions(role, status));
  const user = normalizeUser({
    ...createdUser,
    email,
    name: createdUser.name || displayName,
    picture: picture || createdUser.picture || "",
    role,
    status,
    permissions,
    user_group: createdUser.user_group || "truck-cost-dashboard",
  });

  await patchDocument(USERS_COLLECTION, docId, {
    ...user,
    lastLoginAt: nowIso(),
    loginCount: Number(user.loginCount || 0) + 1,
    updatedAt: nowIso(),
  });

  if (user.status !== "active" || !user.permissions.dashboard) {
    await auditLogin(req, { email, result: "denied", reason: "disabled", role: user.role });
    const error = new Error("Tài khoản đã bị tắt quyền truy cập dashboard.");
    error.statusCode = 403;
    throw error;
  }

  await auditLogin(req, { email, result: "success", reason: "login", role: user.role });
  return user;
}

async function listDashboardUsers() {
  if (!isFirestoreConfigured()) return [];
  return (await listDocuments(USERS_COLLECTION, 200))
    .map(normalizeUser)
    .sort((a, b) => String(a.email).localeCompare(String(b.email)));
}

async function updateDashboardUser(email, patch) {
  if (!isFirestoreConfigured()) {
    const error = new Error("Firebase chưa được cấu hình.");
    error.statusCode = 503;
    throw error;
  }

  const role = patch.role === "admin" ? "admin" : "viewer";
  const status = patch.status === "suspended" ? "suspended" : "active";
  const data = {
    email: String(email || "").toLowerCase(),
    role,
    status,
    permissions: patch.permissions || defaultPermissions(role, status),
    updatedAt: nowIso(),
  };
  return normalizeUser(await patchDocument(USERS_COLLECTION, docIdForEmail(data.email), data));
}

async function listAuditLogs(limit = 100) {
  if (!isFirestoreConfigured()) return [];
  return (await listDocuments(AUDIT_COLLECTION, Math.min(Number(limit) || 100, 200)))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

module.exports = {
  auditLogin,
  defaultPermissions,
  listAuditLogs,
  listDashboardUsers,
  resolveDashboardUser,
  updateDashboardUser,
};
