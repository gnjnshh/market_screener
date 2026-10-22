/**
 * Minimal Cloudflare Worker Proxy for VolEdge India (Upstox API)
 *
 * Security & Privacy:
 * - Forwards incoming requests to https://api.upstox.com.
 * - Passes Authorization and Accept headers directly.
 * - Strictly NEVER logs or stores the access token or request/response body.
 * - Restricts Access-Control-Allow-Origin to authorized GitHub Pages domain or localhost.
 *
 * Deployment Steps:
 * 1. Log in to Cloudflare Dashboard (https://dash.cloudflare.com/) and go to Workers & Pages.
 * 2. Click "Create Application" -> "Create Worker".
 * 3. Name the worker (e.g., "voledge-proxy") and click "Deploy".
 * 4. Click "Edit Code", paste the entire contents of this file, and click "Save and Deploy".
 * 5. Copy your worker endpoint URL (e.g., https://voledge-proxy.<your-subdomain>.workers.dev).
 * 6. In VolEdge India, open Settings and paste this URL into the "Proxy URL" field.
 */

// Allow GitHub Pages origin and local development origins
function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    // Allow any github.io domain, localhost, or 127.0.0.1
    if (url.hostname.endsWith(".github.io")) return true;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
    return false;
  } catch (e) {
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = isAllowedOrigin(origin) ? origin : "https://github.io";

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    }

    // Forward path and search params to Upstox API
    const url = new URL(request.url);
    const targetUrl = new URL(`https://api.upstox.com${url.pathname}${url.search}`);

    // Clone headers without logging
    const forwardHeaders = new Headers();
    const authHeader = request.headers.get("Authorization");
    if (authHeader) {
      forwardHeaders.set("Authorization", authHeader);
    }
    const acceptHeader = request.headers.get("Accept");
    if (acceptHeader) {
      forwardHeaders.set("Accept", acceptHeader);
    }
    const contentType = request.headers.get("Content-Type");
    if (contentType) {
      forwardHeaders.set("Content-Type", contentType);
    }

    const init = {
      method: request.method,
      headers: forwardHeaders,
      redirect: "follow",
    };

    if (request.method === "POST" && request.body) {
      init.body = request.body;
    }

    try {
      const response = await fetch(targetUrl.toString(), init);

      // Return response with CORS headers
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", allowedOrigin);
      responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      responseHeaders.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
      responseHeaders.set("Vary", "Origin");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Proxy connection failure" }), {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": allowedOrigin,
        },
      });
    }
  },
};
