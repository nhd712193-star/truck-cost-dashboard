const { readSession } = require("./_lib/session");
const { setApiSecurityHeaders, setNoStore } = require("./_lib/security");

module.exports = async function sessionHandler(req, res) {
  setApiSecurityHeaders(res);
  setNoStore(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = readSession(req);
  if (!session || !session.permissions?.dashboard) {
    return res.status(401).json({ message: "Phiên đăng nhập không hợp lệ." });
  }

  return res.status(200).json({
    user: {
      email: session.email,
      name: session.name,
      role: session.role,
      permissions: session.permissions,
      exp: session.exp,
    },
    csrfToken: session.csrfToken,
  });
};
