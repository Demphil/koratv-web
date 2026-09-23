import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const TOKEN_TTL_SECONDS = 5 * 60;

export function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "0.0.0.0";
}

export function getSessionId(request) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)koratv_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "anonymous";
}

export function hashIp(ip) {
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

export function signStreamToken({ channelName, ip, sessionId }) {
  return jwt.sign(
    {
      sub: "stream",
      channelName,
      ipHash: hashIp(ip),
      sessionHash: hashIp(sessionId)
    },
    process.env.STREAM_JWT_SECRET,
    { expiresIn: TOKEN_TTL_SECONDS, issuer: "koratv-secure-streaming" }
  );
}

export function verifyStreamToken({ token, channelName, ip, sessionId }) {
  const payload = jwt.verify(token, process.env.STREAM_JWT_SECRET, {
    issuer: "koratv-secure-streaming"
  });
  if (payload.sub !== "stream") throw new Error("Invalid token subject.");
  if (payload.channelName !== channelName) throw new Error("Token channel mismatch.");
  if (payload.ipHash !== hashIp(ip)) throw new Error("Token IP mismatch.");
  if (payload.sessionHash !== hashIp(sessionId)) throw new Error("Token session mismatch.");
  return payload;
}

function encryptionKey() {
  const raw = process.env.STREAM_ENCRYPTION_KEY || "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("STREAM_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function sealJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function unsealJson(token) {
  const data = Buffer.from(token, "base64url");
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

export function corsHeaders(request) {
  const siteOrigin = process.env.PUBLIC_SITE_ORIGIN || "";
  const approved = new Set([
    siteOrigin,
    ...(process.env.APPROVED_IFRAME_ORIGINS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  ]);
  const origin = request.headers.get("origin");
  const allowOrigin = origin && approved.has(origin) ? origin : siteOrigin;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin"
  };
}

export function approvedOrigins() {
  return new Set([
    process.env.PUBLIC_SITE_ORIGIN || "",
    ...(process.env.APPROVED_IFRAME_ORIGINS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  ].filter(Boolean));
}

export function extractOrigin(value) {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function isApprovedOrigin(value) {
  const origin = extractOrigin(value) || value;
  return Boolean(origin && approvedOrigins().has(origin));
}

export function isEmbedRequestAllowed(headersList) {
  const referer = headersList.get("referer") || "";
  const origin = headersList.get("origin") || "";
  const destination = headersList.get("sec-fetch-dest") || "";
  const parentOrigin = extractOrigin(referer) || extractOrigin(origin);

  if (!parentOrigin) return destination !== "iframe";
  return isApprovedOrigin(parentOrigin);
}

export function securityHeaders(request) {
  return {
    ...corsHeaders(request),
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff"
  };
}

export function proxiedUrl(pathname, params) {
  const query = new URLSearchParams(params);
  return `${pathname}?${query.toString()}`;
}
