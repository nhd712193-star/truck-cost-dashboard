const AUTH_CONFIG = {
  googleClientId: "788267823901-4p3ls3u8mc5i395odcccamek13tq7qtn.apps.googleusercontent.com",
  allowedDomain: "ghn.vn",
  apiEndpoint: "/api/auth",
};

const el = (id) => document.getElementById(id);
let googleAuthInitialized = false;

function decodeJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch (error) {
    return null;
  }
}

function isAllowedEmail(email) {
  return String(email || "").toLowerCase().endsWith(`@${AUTH_CONFIG.allowedDomain}`);
}

function setLoginLoading(isLoading) {
  el("loginLoading").hidden = !isLoading;
}

function showLoginError(message) {
  const node = el("loginError");
  node.hidden = false;
  node.textContent = message;
  setLoginLoading(false);
}

function hideLoginError() {
  const node = el("loginError");
  node.hidden = true;
  node.textContent = "";
}

async function verifyAuthWithServer(credential) {
  const response = await fetch(AUTH_CONFIG.apiEndpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || "Lỗi xác thực từ server.");
  }
  return data;
}

function writeAuthSession(user, csrfToken) {
  try {
    sessionStorage.setItem("truck_cost_dashboard_session", JSON.stringify({
      email: user.email || "",
      name: user.name || user.email || "",
      picture: "",
      sub: "",
      exp: user.exp || 0,
      savedAt: Date.now(),
      role: user.role || "viewer",
      user_group: "truck-cost-dashboard",
      permissions: user.permissions || { dashboard: true },
      csrfToken: csrfToken || "",
    }));
  } catch (error) {
    console.warn("Cannot save auth session", error);
  }
}

async function handleCredentialResponse(response) {
  setLoginLoading(true);
  hideLoginError();

  const credential = response?.credential || "";
  const payload = decodeJwt(credential);
  if (!payload) {
    showLoginError("Không thể đọc token Google. Vui lòng thử lại.");
    return;
  }

  const email = payload.email || "";
  if (!isAllowedEmail(email)) {
    showLoginError(`Email ${email || "này"} không hợp lệ. Chỉ tài khoản @${AUTH_CONFIG.allowedDomain} mới được truy cập.`);
    window.google?.accounts?.id?.disableAutoSelect();
    return;
  }

  try {
    const data = await verifyAuthWithServer(credential);
    writeAuthSession(data.user || {}, data.csrfToken || "");
    window.google?.accounts?.id?.disableAutoSelect();
    window.location.assign("/");
  } catch (error) {
    showLoginError(error.message || "Lỗi xác thực từ server. Vui lòng thử lại.");
    window.google?.accounts?.id?.disableAutoSelect();
  }
}

function initGoogleAuth() {
  if (googleAuthInitialized) return true;
  if (!window.google?.accounts?.id) return false;

  googleAuthInitialized = true;
  window.google.accounts.id.initialize({
    client_id: AUTH_CONFIG.googleClientId,
    callback: handleCredentialResponse,
    hosted_domain: AUTH_CONFIG.allowedDomain,
    auto_select: false,
    ux_mode: "popup",
  });

  const googleSignInButton = el("googleSigninButton");
  const googleButtonWidth = Math.min(
    340,
    Math.max(280, Math.floor(googleSignInButton.getBoundingClientRect().width || 340)),
  );

  window.google.accounts.id.renderButton(
    googleSignInButton,
    {
      theme: "filled_black",
      size: "large",
      width: googleButtonWidth,
      text: "signin_with",
      shape: "rectangular",
      logo_alignment: "left",
    },
  );
  window.google.accounts.id.prompt();
  return true;
}

function waitForGoogleAuth() {
  if (initGoogleAuth()) return;
  const script = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
  script?.addEventListener("load", initGoogleAuth, { once: true });
  window.setTimeout(() => {
    if (!googleAuthInitialized) {
      showLoginError("Không tải được Google Sign-In. Vui lòng kiểm tra kết nối hoặc thử tải lại trang.");
    }
  }, 6000);
}

waitForGoogleAuth();
