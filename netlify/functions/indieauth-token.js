"use strict";

const crypto = require("crypto");

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache"
    },
    body: JSON.stringify(payload)
  };
}

function formEncoded(statusCode, payload) {
  const body = new URLSearchParams(
    Object.entries(payload).reduce((acc, [key, value]) => {
      acc[key] = value == null ? "" : String(value);
      return acc;
    }, {})
  ).toString();

  return {
    statusCode,
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8"
    },
    body
  };
}

function wantsJson(event) {
  const accept = String(event.headers?.accept || event.headers?.Accept || "").toLowerCase();
  if (!accept) {
    return false;
  }
  return accept.includes("application/json") || accept.includes("application/jrd+json");
}

function tokenResponse(event, payload) {
  return wantsJson(event) ? json(200, payload) : formEncoded(200, payload);
}

function b64urlDecode(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function b64urlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signPayload(payload, secret) {
  const encodedPayload = b64urlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${encodedPayload}.${sig}`;
}

function verifySignedPayload(token, secret) {
  const [encodedPayload, sig] = String(token || "").split(".");
  if (!encodedPayload || !sig) {
    return null;
  }

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload = JSON.parse(b64urlDecode(encodedPayload));
    if (payload.exp && Math.floor(Date.now() / 1000) > Number(payload.exp)) {
      return null;
    }
    return payload;
  } catch (error) {
    return null;
  }
}

function parseBody(body) {
  const params = new URLSearchParams(body || "");
  const result = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

function getBearerToken(headers) {
  const raw = headers?.authorization || headers?.Authorization || "";
  const match = String(raw).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function getSiteUrl() {
  const configured = String(process.env.SITE_URL || "").trim() || "https://afterword.blog";
  return /^https?:\/\//i.test(configured) ? configured.replace(/\/+$/, "") : `https://${configured.replace(/\/+$/, "")}`;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const secret = String(process.env.INDIEAUTH_SECRET || process.env.MICROPUB_TOKEN || "").trim();
  if (!secret) {
    return json(500, { error: "INDIEAUTH_SECRET is not configured" });
  }

  const staticMicropubToken = String(process.env.MICROPUB_TOKEN || "").trim();

  const params = event.httpMethod === "POST" ? parseBody(event.body || "") : (event.queryStringParameters || {});
  const grantType = String(params.grant_type || "");
  const code = String(params.code || "");
  const clientId = String(params.client_id || "");
  const redirectUri = String(params.redirect_uri || "");
  const requestedToken = String(params.token || "").trim() || getBearerToken(event.headers);

  if (grantType === "authorization_code" || code) {
    if (!code || !clientId || !redirectUri) {
      return json(400, { error: "code, client_id, and redirect_uri are required" });
    }

    const codePayload = verifySignedPayload(code, secret);
    if (!codePayload || codePayload.t !== "code") {
      return json(400, { error: "Invalid code" });
    }

    if (codePayload.client_id !== clientId || codePayload.redirect_uri !== redirectUri) {
      return json(400, { error: "Code mismatch for client_id or redirect_uri" });
    }

    const accessPayload = {
      t: "access",
      me: codePayload.me || getSiteUrl(),
      client_id: clientId,
      scope: codePayload.scope || "create",
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
    };
    const accessToken = signPayload(accessPayload, secret);

    return json(200, {
      access_token: accessToken,
      token_type: "Bearer",
      scope: accessPayload.scope,
      me: accessPayload.me
    });
  }

  if (requestedToken) {
    if (staticMicropubToken && requestedToken === staticMicropubToken) {
      return tokenResponse(event, {
        me: getSiteUrl(),
        scope: "create",
        client_id: getSiteUrl()
      });
    }

    const payload = verifySignedPayload(requestedToken, secret);
    if (!payload || payload.t !== "access") {
      return json(401, { error: "Invalid token" });
    }

    return tokenResponse(event, {
      me: payload.me || getSiteUrl(),
      scope: payload.scope || "create",
      client_id: payload.client_id || ""
    });
  }

  return json(400, { error: "Unsupported token request" });
};
