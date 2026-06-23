const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 8787);
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const NODE_ENV = String(process.env.NODE_ENV || "development");

// Parses the allowed origins from Render Environment Variables
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 90);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 1000 * 60 * 60 * 6); // 6h
const STALE_TTL_MS = Number(process.env.STALE_TTL_MS || 1000 * 60 * 60 * 24); // 24h
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 9_000);

const queryCache = new Map();
const rateLimitStore = new Map();

function normalizeQuery(query) {
  return String(query || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

// FIXED: Gracefully accepts "null" or missing origins if we are locked down to an extension
function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes("*")) return true;
  
  // If the origin is the string literal "null", allow it if an extension is authorized
  if (origin === "null" && ALLOWED_ORIGINS.some(o => o.startsWith("chrome-extension://"))) {
    return true;
  }
  
  return ALLOWED_ORIGINS.includes(origin);
}

// FIXED: Dynamically returns the correct headers without breaking on "null"
function buildCorsHeaders(origin) {
  const extensionFallback = ALLOWED_ORIGINS.find(o => o.startsWith("chrome-extension://")) || "*";
  const allowOrigin = isAllowedOrigin(origin) 
    ? (origin && origin !== "null" ? origin : extensionFallback) 
    : "null";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function writeJson(req, res, statusCode, payload, extraHeaders = {}) {
  const clientOrigin = req.headers.origin || '*';
  const cors = buildCorsHeaders(clientOrigin);

  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    ...cors,
    ...extraHeaders,
  });

  if (statusCode === 204) {
    res.end();
    return;
  }

  res.end(JSON.stringify(payload));
}

function checkRateLimit(clientIp) {
  const now = Date.now();
  const existing = rateLimitStore.get(clientIp);

  if (!existing || now > existing.resetAt) {
    const entry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(clientIp, entry);
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: entry.resetAt };
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - existing.count),
    resetAt: existing.resetAt,
  };
}

function getCachedQuery(normalizedQuery) {
  const entry = queryCache.get(normalizedQuery);
  if (!entry) return { hit: false };

  const now = Date.now();
  if (now <= entry.expiresAt) {
    return { hit: true, stale: false, data: entry.data };
  }

  if (now <= entry.staleUntil) {
    return { hit: true, stale: true, data: entry.data };
  }

  queryCache.delete(normalizedQuery);
  return { hit: false };
}

function setCachedQuery(normalizedQuery, data) {
  const now = Date.now();
  queryCache.set(normalizedQuery, {
    data,
    expiresAt: now + CACHE_TTL_MS,
    staleUntil: now + STALE_TTL_MS,
  });
}

function filterAndMapSerpImages(images, maxCount) {
  const urls = images
    .filter((img) => {
      const width = img.original_width;
      const height = img.original_height;

      if (width && height) {
        if (width < 1280 || height < 720) return false;
        if (width < height) return false;
      }

      return Boolean(img.original);
    })
    .map((img) => img.original)
    .filter((url) => typeof url === "string" && url.startsWith("https://"));

  return [...new Set(urls)].slice(0, maxCount);
}

async function fetchSerpImages(query, page, maxCount) {
  const params = new URLSearchParams({
    engine: "google_images",
    q: query,
    api_key: SERPAPI_KEY,
    ijn: String(page),
  });

  const serpApiUrl = `https://serpapi.com/search.json?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(serpApiUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`SerpAPI HTTP ${response.status}`);
    }

    const data = await response.json();
    const images = Array.isArray(data.images_results) ? data.images_results : [];
    return filterAndMapSerpImages(images, maxCount);
  } finally {
    clearTimeout(timeout);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) rateLimitStore.delete(ip);
  }
  for (const [query, entry] of queryCache.entries()) {
    if (entry.staleUntil < now) queryCache.delete(query);
  }
}, 30_000).unref?.();

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    writeJson(req, res, 204, {});
    return;
  }

  const requestUrl = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && requestUrl.pathname === "/health") {
    writeJson(req, res, 200, {
      ok: true,
      cacheSize: queryCache.size,
      rateLimitTrackedClients: rateLimitStore.size,
      hasSerpApiKey: Boolean(SERPAPI_KEY),
    });
    return;
  }

  // FIXED: Accepts both the root "/" route and "/search-images" route to support your extension url layout
  if (req.method !== "GET" || (requestUrl.pathname !== "/search-images" && requestUrl.pathname !== "/")) {
    writeJson(req, res, 404, { error: "Not found" });
    return;
  }

  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    writeJson(req, res, 403, { error: "Origin not allowed" });
    return;
  }

  if (!SERPAPI_KEY) {
    writeJson(req, res, 500, { error: "SERPAPI_KEY is not set on server" });
    return;
  }

  const rawQ = String(requestUrl.searchParams.get("q") || "");
  const normalizedQ = normalizeQuery(rawQ);
  if (normalizedQ.length < 2) {
    writeJson(req, res, 400, { error: "q must be at least 2 characters" });
    return;
  }
  if (normalizedQ.length > 180) {
    writeJson(req, res, 400, { error: "q is too long" });
    return;
  }

  const page = Math.min(10, Math.max(0, Number(requestUrl.searchParams.get("page") || 0) || 0));
  const maxCount = Math.min(30, Math.max(1, Number(requestUrl.searchParams.get("count") || 20) || 20));

  const cacheKey = `${normalizedQ}|${page}|${maxCount}`;
  const cached = getCachedQuery(cacheKey);
  if (cached.hit && !cached.stale) {
    writeJson(
      req,
      res,
      200,
      { images: cached.data, cache: "hit" },
      { "Cache-Control": "public, max-age=300" }
    );
    return;
  }

  const clientIp = getClientIp(req);
  const rate = checkRateLimit(clientIp);
  if (!rate.allowed) {
    writeJson(
      req,
      res,
      429,
      { error: "Rate limit exceeded" },
      {
        "X-RateLimit-Remaining": String(rate.remaining),
        "X-RateLimit-Reset": String(rate.resetAt),
      }
    );
    return;
  }

  try {
    const urls = await fetchSerpImages(normalizedQ, page, maxCount);
    setCachedQuery(cacheKey, urls);

    writeJson(
      req,
      res,
      200,
      { images: urls, cache: cached.hit && cached.stale ? "refresh" : "miss" },
      {
        "Cache-Control": "public, max-age=300",
        "X-RateLimit-Remaining": String(rate.remaining),
        "X-RateLimit-Reset": String(rate.resetAt),
      }
    );
  } catch (error) {
    if (cached.hit && cached.stale) {
      writeJson(
        req,
        res,
        200,
        { images: cached.data, cache: "stale-fallback", warning: "Upstream unavailable" },
        {
          "X-RateLimit-Remaining": String(rate.remaining),
          "X-RateLimit-Reset": String(rate.resetAt),
        }
      );
      return;
    }

    writeJson(
      req,
      res,
      502,
      {
        error: "Failed to fetch images from upstream",
        details: NODE_ENV === "development" ? String(error) : undefined,
      },
      {
        "X-RateLimit-Remaining": String(rate.remaining),
        "X-RateLimit-Reset": String(rate.resetAt),
      }
    );
  }
});

server.listen(PORT, () => {
  if (!SERPAPI_KEY || SERPAPI_KEY.includes("replace_with")) {
    console.warn("[WARN] SERPAPI_KEY is missing or placeholder. Search endpoint will fail.");
  }
  console.log(`Image proxy running on http://localhost:${PORT} (${NODE_ENV})`);
});