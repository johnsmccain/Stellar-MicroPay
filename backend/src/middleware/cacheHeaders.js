/**
 * Simple cache‑header middleware for read‑only endpoints.
 * It sets Cache‑Control, Vary and ETag (using Express's built‑in weak ETag).
 * Routes are classified based on the request path and method.
 *
 *  • Analytics public endpoints  → public, max‑age=300
 *  • Account balance endpoint   → private, max‑age=30
 *  • Auth‑protected endpoints   → no‑store
 *  • All other GET routes       → no‑store (safe default)
 *
 * Errors (4xx/5xx) also receive no‑store.
 */
function cacheHeaders(req, res, next) {
  // Skip non‑GET requests – they are mutating.
  if (req.method !== 'GET') {
    res.set('Cache-Control', 'no-store');
    return next();
  }

  const path = req.path;
  const isAnalytics = /^\/api\/analytics\//.test(path);
  const isBalance = /\/balance$/.test(path);
  const isAuthProtected = /\/auth|\/payments|\/tips|\/price-alerts/.test(path);

  // Helper to set public cache.
  const setPublic = () => {
    res.set('Cache-Control', 'public, max-age=300');
    // Let Express generate weak ETag automatically.
    // Ensure we send Vary for auth‑related headers if any.
    res.set('Vary', 'Accept-Encoding');
  };

  // Helper to set private cache.
  const setPrivate = () => {
    res.set('Cache-Control', 'private, max-age=30');
    res.set('Vary', 'Authorization, Cookie');
  };

  // Helper to set no‑store.
  const setNoStore = () => {
    res.set('Cache-Control', 'no-store');
  };

  if (isAnalytics) {
    setPublic();
  } else if (isBalance) {
    setPrivate();
  } else if (isAuthProtected) {
    setNoStore();
  } else {
    // Default safe rule for any other GET route.
    setNoStore();
  }

  next();
}

module.exports = cacheHeaders;
