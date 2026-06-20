const { listDashboardUsers, updateDashboardUser } = require("../_lib/access");
const { requireAdmin } = require("../_lib/session");
const {
  rateLimit,
  requireCsrf,
  requireTrustedOrigin,
  setApiSecurityHeaders,
  setNoStore,
} = require("../_lib/security");

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch (error) {
    return {};
  }
}

module.exports = async function usersHandler(req, res) {
  setApiSecurityHeaders(res);
  setNoStore(res);

  const session = requireAdmin(req, res);
  if (!session) return;

  try {
    if (req.method === "GET") {
      return res.status(200).json({ users: await listDashboardUsers() });
    }

    if (req.method === "POST" || req.method === "PATCH") {
      if (!requireTrustedOrigin(req, res)) return;
      if (!requireCsrf(req, res, session)) return;
      if (!rateLimit(req, res, { scope: "admin-users", email: session.email, max: 30, windowMs: 60_000 })) return;

      const body = parseBody(req.body);
      if (!body.email) {
        return res.status(400).json({ message: "Thiếu email user." });
      }
      const user = await updateDashboardUser(body.email, {
        role: body.role,
        status: body.status,
        permissions: body.permissions,
      });
      return res.status(200).json({ user });
    }

    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error(error);
    return res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Không tải được danh sách user." });
  }
};
