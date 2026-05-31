const crypto = require("crypto");

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
let tokenCache = null;

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  } catch (error) {
    return null;
  }
}

function isFirestoreConfigured() {
  const account = serviceAccount();
  return Boolean(account?.client_email && account?.private_key && (account.project_id || process.env.FIREBASE_PROJECT_ID));
}

function projectId() {
  const account = serviceAccount();
  return process.env.FIREBASE_PROJECT_ID || account?.project_id || "";
}

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const account = serviceAccount();
  if (!account?.client_email || !account?.private_key) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: account.client_email,
    scope: FIRESTORE_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(claim)}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(account.private_key, "base64url");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${signature}`,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Cannot authenticate Firebase service account");
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return tokenCache.accessToken;
}

function documentUrl(path) {
  return `https://firestore.googleapis.com/v1/projects/${projectId()}/databases/(default)/documents/${path}`;
}

function encodePath(...segments) {
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number") return { doubleValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, toFirestoreValue(item)]),
        ),
      },
    };
  }
  return { stringValue: String(value) };
}

function fromFirestoreValue(value) {
  if (!value || "nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, fromFirestoreValue(item)]),
    );
  }
  return null;
}

function toFirestoreFields(data) {
  return {
    fields: Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)]),
    ),
  };
}

function fromFirestoreDoc(doc) {
  if (!doc) return null;
  return {
    id: String(doc.name || "").split("/").pop(),
    ...Object.fromEntries(
      Object.entries(doc.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)]),
    ),
  };
}

async function firestoreFetch(path, options = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(documentUrl(path), {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (response.status === 404) return null;
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error?.message || `Firestore request failed: ${response.status}`);
  }
  return data;
}

async function getDocument(collection, docId) {
  const doc = await firestoreFetch(encodePath(collection, docId));
  return fromFirestoreDoc(doc);
}

async function patchDocument(collection, docId, data) {
  const path = encodePath(collection, docId);
  const params = new URLSearchParams();
  Object.keys(data).forEach((key) => params.append("updateMask.fieldPaths", key));
  const doc = await firestoreFetch(`${path}?${params.toString()}`, {
    method: "PATCH",
    body: JSON.stringify(toFirestoreFields(data)),
  });
  return fromFirestoreDoc(doc);
}

async function createDocument(collection, data) {
  const doc = await firestoreFetch(encodePath(collection), {
    method: "POST",
    body: JSON.stringify(toFirestoreFields(data)),
  });
  return fromFirestoreDoc(doc);
}

async function listDocuments(collection, pageSize = 100) {
  const data = await firestoreFetch(`${encodePath(collection)}?pageSize=${pageSize}`);
  return (data?.documents || []).map(fromFirestoreDoc);
}

module.exports = {
  createDocument,
  getDocument,
  isFirestoreConfigured,
  listDocuments,
  patchDocument,
};
