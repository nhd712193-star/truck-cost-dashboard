const { signedR2Url, normalizeDataPath } = require("./_lib/r2");
const { requireDashboard } = require("./_lib/session");
const {
  rateLimit,
  requireSameSiteFetch,
  setApiSecurityHeaders,
  setNoStore,
} = require("./_lib/security");

function requestedPath(req) {
  if (req.query?.path) return Array.isArray(req.query.path) ? req.query.path.join("/") : req.query.path;
  return String(req.url || "").replace(/^\/api\/data\/?/, "").split("?")[0];
}

module.exports = async function dataHandler(req, res) {
  setApiSecurityHeaders(res);
  setNoStore(res);

  if (!["GET", "HEAD"].includes(req.method)) {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ message: "Method not allowed" });
  }
  if (!requireSameSiteFetch(req, res)) return;

  const session = requireDashboard(req, res);
  if (!session) return;
  if (!rateLimit(req, res, { scope: "data", email: session.email, max: 240, windowMs: 60_000 })) return;

  try {
    const path = normalizeDataPath(requestedPath(req));
    if (!path) return res.status(404).json({ message: "Data path không được phép." });
    res.setHeader("Location", signedR2Url(path, req.method));
    res.statusCode = 307;
    return res.end();
  } catch (error) {
    console.error(error);
    return res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Không tạo được signed URL dữ liệu." });
  }
};
