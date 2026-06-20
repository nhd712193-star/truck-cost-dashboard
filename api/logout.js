const { clearSessionCookie } = require("./_lib/session");
const { requireTrustedOrigin, setApiSecurityHeaders, setNoStore } = require("./_lib/security");

module.exports = async function logoutHandler(req, res) {
  setApiSecurityHeaders(res);
  setNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }
  if (!requireTrustedOrigin(req, res)) return;

  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
};
