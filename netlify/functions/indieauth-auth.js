"use strict";

const crypto = require("crypto");

function getSiteUrl() {
  const configured = String(process.env.SITE_URL || "").trim() || "https://afterword.blog";
  return /^https?:\/\//i.test(configured) ? configured.replace(/\/+$/, "") : `https://${configured.replace(/\/+$/, "")}`;
}

function html(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "text/html; charset=utf-8"
    },
    body
  };
}

function b64urlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signCode(payload, secret) {
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

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseBody(body) {
  const params = new URLSearchParams(body || "");
  const result = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

function validateAuthRequest(query) {
  const responseType = String(query.response_type || "");
  const clientId = String(query.client_id || "");
  const redirectUri = String(query.redirect_uri || "");

  if (responseType !== "code") {
    return "Only response_type=code is supported.";
  }
  if (!clientId || !redirectUri) {
    return "client_id and redirect_uri are required.";
  }

  try {
    new URL(clientId);
    new URL(redirectUri);
  } catch (error) {
    return "client_id and redirect_uri must be valid URLs.";
  }

  return "";
}

function renderPage(query, errorMessage = "") {
  const clientId = escapeHtml(query.client_id || "");
  const redirectUri = escapeHtml(query.redirect_uri || "");
  const state = escapeHtml(query.state || "");
  const scope = escapeHtml(query.scope || "create");
  const responseType = escapeHtml(query.response_type || "code");
  const me = escapeHtml(query.me || getSiteUrl());

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Authorize app</title>
  <style>
    body { font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif; max-width: 560px; margin: 2rem auto; padding: 0 1rem; line-height: 1.45; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 1rem; }
    .error { color: #b00020; margin-bottom: 0.75rem; }
    input, button { font: inherit; }
    input[type="password"] { width: 100%; padding: 0.55rem; margin-top: 0.25rem; }
    button { margin-top: 0.9rem; padding: 0.55rem 0.85rem; }
    code { background: #f5f5f5; padding: 0.1rem 0.25rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Authorize app</h1>
  <div class="card">
    <p><strong>App:</strong> <code>${clientId}</code></p>
    <p><strong>Redirect:</strong> <code>${redirectUri}</code></p>
    <p><strong>Me:</strong> <code>${me}</code></p>
    <p><strong>Scope:</strong> <code>${scope}</code></p>
    ${errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : ""}
    <form method="post" action="/auth">
      <input type="hidden" name="response_type" value="${responseType}">
      <input type="hidden" name="client_id" value="${clientId}">
      <input type="hidden" name="redirect_uri" value="${redirectUri}">
      <input type="hidden" name="state" value="${state}">
      <input type="hidden" name="scope" value="${scope}">
      <input type="hidden" name="me" value="${me}">
      <label for="password">Authorization password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Authorize</button>
    </form>
  </div>
</body>
</html>`;
}

exports.handler = async function (event) {
  const secret = String(process.env.INDIEAUTH_SECRET || process.env.MICROPUB_TOKEN || "").trim();
  const authPassword = String(process.env.INDIEAUTH_PASSWORD || "").trim();
  if (!secret || !authPassword) {
    return html(500, "<h1>IndieAuth is not configured.</h1><p>Set INDIEAUTH_SECRET and INDIEAUTH_PASSWORD.</p>");
  }

  if (event.httpMethod === "GET") {
    const query = event.queryStringParameters || {};
    const requestError = validateAuthRequest(query);
    if (requestError) {
      return html(400, renderPage(query, requestError));
    }
    return html(200, renderPage(query));
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method not allowed"
    };
  }

  const form = parseBody(event.body || "");
  const requestError = validateAuthRequest(form);
  if (requestError) {
    return html(400, renderPage(form, requestError));
  }

  if (String(form.password || "") !== authPassword) {
    return html(401, renderPage(form, "Invalid password."));
  }

  const me = String(form.me || "").trim() || getSiteUrl();
  const codePayload = {
    t: "code",
    me,
    client_id: String(form.client_id || ""),
    redirect_uri: String(form.redirect_uri || ""),
    scope: String(form.scope || "create"),
    exp: Math.floor(Date.now() / 1000) + 300
  };

  const code = signCode(codePayload, secret);
  const redirect = new URL(codePayload.redirect_uri);
  redirect.searchParams.set("code", code);
  if (form.state) {
    redirect.searchParams.set("state", String(form.state));
  }

  return {
    statusCode: 302,
    headers: {
      Location: redirect.toString()
    },
    body: ""
  };
};
