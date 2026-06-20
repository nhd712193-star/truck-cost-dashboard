const crypto = require("crypto");

const DATA_PATHS = [
  /^manifest\.json$/,
  /^rollups\/(daily|province|ward)\.csv\.gz$/,
  /^rollups\/order_index\/month=20\d{2}-(0[1-9]|1[0-2])\.csv\.gz$/,
];

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizeDataPath(value = "") {
  let path = String(value || "").split("?")[0].replace(/^\/+/, "");
  try {
    path = decodeURIComponent(path);
  } catch (error) {
    return "";
  }
  if (!path || path.includes("..") || path.includes("\\") || path.startsWith("/")) return "";
  return DATA_PATHS.some((pattern) => pattern.test(path)) ? path : "";
}

function signingKey(secretKey, dateStamp, region = "auto", service = "s3") {
  let key = Buffer.from(`AWS4${secretKey}`, "utf8");
  key = crypto.createHmac("sha256", key).update(dateStamp).digest();
  key = crypto.createHmac("sha256", key).update(region).digest();
  key = crypto.createHmac("sha256", key).update(service).digest();
  return crypto.createHmac("sha256", key).update("aws4_request").digest();
}

function r2Config() {
  const required = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    const error = new Error(`Missing R2 config: ${missing.join(", ")}`);
    error.statusCode = 500;
    throw error;
  }
  return {
    accountId: process.env.R2_ACCOUNT_ID,
    bucket: process.env.R2_BUCKET,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    prefix: String(process.env.R2_PREFIX || "prod").replace(/^\/+|\/+$/g, ""),
    expiresIn: Math.max(30, Math.min(Number(process.env.R2_SIGNED_URL_TTL_SECONDS || 180), 900)),
  };
}

function signedR2Url(dataPath, method = "GET") {
  const path = normalizeDataPath(dataPath);
  if (!path) {
    const error = new Error("Data path không được phép.");
    error.statusCode = 404;
    throw error;
  }

  const cfg = r2Config();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const objectKey = cfg.prefix ? `${cfg.prefix}/${path}` : path;
  const canonicalUri = `/${cfg.bucket}/${objectKey.split("/").map(encodeRfc3986).join("/")}`;
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
    "X-Amz-Credential": `${cfg.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(cfg.expiresIn),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(params[key])}`)
    .join("&");
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signature = crypto
    .createHmac("sha256", signingKey(cfg.secretAccessKey, dateStamp))
    .update(stringToSign)
    .digest("hex");

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

module.exports = {
  normalizeDataPath,
  signedR2Url,
};
