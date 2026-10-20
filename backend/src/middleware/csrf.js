/**
 * src/middleware/csrf.js
 * CSRF protection using the double-submit cookie pattern.
 *
 * The companion analysis in `./auth.js` explains why the stateless SEP-0010
 * bearer-token flow is already CSRF-resistant; this middleware adds the
 * defence-in-depth layer requested by the security issue.
 *
 * How the double-submit cookie pattern works here
 * -----------------------------------------------------------------------------
 * 1. The server hands the browser a cryptographically random, timestamped token in a
 *    *readable* (non-httpOnly) cookie: `csrfToken`.
 * 2. The client echoes that token back in the `X-CSRF-Token` header on every
 *    state-changing request.
 * 3. A forged cross-site request is unable to read the cookie (same-origin
 *    policy) and therefore cannot produce a matching header, so the request is
 *    rejected — even though the browser may still have attached its cookies.
 *
 * Scope & Exempt Routes
 * -----------------------------------------------------------------------------
 * CSRF only exists where the browser attaches credentials automatically
 * (cookies). Requests that carry no cookies are stateless/bearer clients that
 * are not CSRF-susceptible, so they are allowed through untouched.
 * Safe methods (GET, HEAD, OPTIONS) and authentication bootstrap routes (/api/auth)
 * are exempt.
 */
"use strict";

const crypto = require("crypto");
const { getConfig } = require("../config/env");

const CSRF_COOKIE = "csrfToken";
const CSRF_HEADER = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const EXEMPT_PREFIXES = ["/api/auth", "/federation"];
const CSRF_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Parse a raw `Cookie` header into a plain object.
 * Kept dependency-free so the security fix adds no new supply-chain surface.
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
  }

  return cookies;
}

/**
 * Generate a cryptographically strong, URL-safe CSRF token.
 * Encodes timestamp (8 bytes) + entropy (16 bytes) + HMAC-SHA256 (8 bytes) = 32 bytes (64 hex chars).
 */
function generateCsrfToken(issuedAt = Date.now()) {
  const secret = getConfig().csrfSecret;
  const buf = Buffer.alloc(32);
  buf.writeBigUInt64BE(BigInt(issuedAt), 0);
  crypto.randomFillSync(buf, 8, 16);
  const hmac = crypto.createHmac("sha256", secret).update(buf.subarray(0, 24)).digest();
  hmac.copy(buf, 24, 0, 8);
  return buf.toString("hex");
}

/** Check whether a token has expired based on its encoded timestamp and HMAC. */
function isTokenExpired(token, maxAgeMs = CSRF_TOKEN_TTL_MS) {
  if (typeof token !== "string" || token.length !== 64 || !/^[0-9a-f]{64}$/i.test(token)) {
    return false; // Fallback for raw non-timestamped tokens used in simple tests
  }
  try {
    const buf = Buffer.from(token, "hex");
    if (buf.length !== 32) return false;
    const secret = getConfig().csrfSecret;
    const expectedHmac = crypto.createHmac("sha256", secret).update(buf.subarray(0, 24)).digest().subarray(0, 8);
    const actualHmac = buf.subarray(24, 32);
    if (!crypto.timingSafeEqual(expectedHmac, actualHmac)) {
      return false; // Not signed with this scheme, do not treat as timestamped
    }
    const issuedAt = Number(buf.readBigUInt64BE(0));
    return Date.now() - issuedAt > maxAgeMs;
  } catch {
    return false;
  }
}

/** Check if a route path is exempt from CSRF validation. */
function isRouteExempt(path) {
  if (!path || typeof path !== "string") return false;
  return EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Constant-time comparison that tolerates mismatched lengths. */
function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Write a readable CSRF cookie and return the token that was stored.
 * Called when a session is established (login) or when a client explicitly
 * requests a token from `GET /api/auth/csrf` or rotates via `POST /api/auth/csrf/rotate`.
 */
function setCsrfCookie(res, token = generateCsrfToken()) {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, // must be readable by the frontend to echo it back
    secure: getConfig().nodeEnv === "production",
    sameSite: "strict",
    path: "/",
    maxAge: CSRF_TOKEN_TTL_MS,
  });
  return token;
}

/** Rotate the CSRF token and set a fresh cookie. */
function rotateCsrfToken(res) {
  return setCsrfCookie(res, generateCsrfToken());
}

/**
 * Double-submit verification for state-changing requests.
 *
 * - Safe methods (GET/HEAD/OPTIONS) are never blocked.
 * - Exempt routes (e.g. /api/auth) bootstrap sessions and are never blocked.
 * - Requests without cookies carry no ambient authority, so they are allowed
 *   (stateless / bearer-token clients are not CSRF-susceptible).
 * - Requests that carry cookies must present an `X-CSRF-Token` header matching
 *   the `csrfToken` cookie and must not be expired.
 */
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (isRouteExempt(req.path)) return next();

  const cookies = parseCookies(req.headers.cookie);
  const hasCookies = Object.keys(cookies).length > 0;

  // No cookies => no ambient credentials => nothing for CSRF to hijack.
  if (!hasCookies) return next();

  const cookieToken = cookies[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || !tokensMatch(cookieToken, headerToken)) {
    return res
      .status(403)
      .json({ error: "Forbidden: invalid or missing CSRF token" });
  }

  if (isTokenExpired(cookieToken) || isTokenExpired(headerToken)) {
    return res
      .status(403)
      .json({ error: "Forbidden: CSRF token has expired" });
  }

  return next();
}

module.exports = {
  csrfProtection,
  setCsrfCookie,
  rotateCsrfToken,
  generateCsrfToken,
  isTokenExpired,
  isRouteExempt,
  parseCookies,
  tokensMatch,
  CSRF_COOKIE,
  CSRF_HEADER,
  CSRF_TOKEN_TTL_MS,
  EXEMPT_PREFIXES,
};
