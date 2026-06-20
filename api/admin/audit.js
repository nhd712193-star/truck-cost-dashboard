const { listAuditLogs } = require("../_lib/access");
const { requireAdmin } = require("../_lib/session");
const { setApiSecurityHeaders, setNoStore } = require("../_lib/security");

module.exports = async function auditHandler(req, res) {
  setApiSecurityHeaders(res);
  setNoStore(res);

  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    return res.status(200).json({ logs: await listAuditLogs(req.query?.limit || 100) });
  } catch (error) {
    console.error(error);
    return res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Không tải được audit log." });
  }
};
