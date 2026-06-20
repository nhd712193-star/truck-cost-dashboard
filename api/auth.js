const DEFAULT_GOOGLE_CLIENT_ID = "788267823901-4p3ls3u8mc5i395odcccamek13tq7qtn.apps.googleusercontent.com";
const { resolveDashboardUser } = require("./_lib/access");
const { setSessionCookie } = require("./_lib/session");
const { rateLimit, requireTrustedOrigin, setApiSecurityHeaders, setNoStore } = require("./_lib/security");

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch (error) {
    return {};
  }
}

module.exports = async function authHandler(req, res) {
  setApiSecurityHeaders(res);
  setNoStore(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!requireTrustedOrigin(req, res)) return;
  if (!rateLimit(req, res, { scope: "auth", max: 20, windowMs: 60_000 })) return;

  const googleClientId = process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
  const { credential } = parseBody(req.body);

  if (!credential) {
    return res.status(400).json({ message: "Thiếu Google credential." });
  }

  try {
    const tokenResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
    );
    const token = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res.status(401).json({ message: "Google token không hợp lệ." });
    }
    if (token.aud !== googleClientId) {
      return res.status(401).json({ message: "Google client không khớp dashboard này." });
    }
    if (String(token.email_verified) !== "true") {
      return res.status(401).json({ message: "Email Google chưa được xác minh." });
    }
    if (!token.exp || Number(token.exp) <= Date.now() / 1000) {
      return res.status(401).json({ message: "Phiên Google đã hết hạn. Vui lòng đăng nhập lại." });
    }

    const user = await resolveDashboardUser(req, token);
    const session = setSessionCookie(res, user);
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
  } catch (error) {
    console.error(error);
    return res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Lỗi xác thực từ server. Vui lòng thử lại sau." });
  }
};
