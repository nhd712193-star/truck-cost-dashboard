const { clearSessionCookie } = require("./_lib/session");

module.exports = async function logoutHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
};
