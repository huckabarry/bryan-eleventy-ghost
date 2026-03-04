"use strict";

const MICROBLOG_PING_ENDPOINT = "https://micro.blog/ping";

function parseFeedUrls() {
  const raw = String(process.env.MICROBLOG_FEED_URLS || "").trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRequestToken(event) {
  const queryToken = event.queryStringParameters && event.queryStringParameters.token;
  const headerToken = event.headers && (event.headers["x-afterword-token"] || event.headers["X-Afterword-Token"]);
  return queryToken || headerToken || "";
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, error: "Method not allowed" })
    };
  }

  const expectedToken = String(process.env.MICROBLOG_PING_SECRET || "").trim();
  if (expectedToken) {
    const providedToken = String(getRequestToken(event) || "").trim();
    if (!providedToken || providedToken !== expectedToken) {
      return {
        statusCode: 401,
        body: JSON.stringify({ ok: false, error: "Unauthorized" })
      };
    }
  }

  const feedUrls = parseFeedUrls();
  if (!feedUrls.length) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: "MICROBLOG_FEED_URLS is not configured"
      })
    };
  }

  const results = [];
  for (const feedUrl of feedUrls) {
    try {
      const response = await fetch(MICROBLOG_PING_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ url: feedUrl }).toString()
      });

      const text = await response.text();
      results.push({
        feedUrl,
        ok: response.ok,
        status: response.status,
        body: text.slice(0, 400)
      });
    } catch (error) {
      results.push({
        feedUrl,
        ok: false,
        status: 0,
        body: error.message
      });
    }
  }

  const success = results.every((item) => item.ok);
  return {
    statusCode: success ? 200 : 502,
    body: JSON.stringify({
      ok: success,
      endpoint: MICROBLOG_PING_ENDPOINT,
      results
    })
  };
};
