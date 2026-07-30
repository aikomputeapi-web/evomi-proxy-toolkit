/*
 * Evomi Public API client for the extension.
 *
 * Calls GET https://api.evomi.com/public/generate and returns ready-to-use
 * proxy strings in `username:password:host:port` form (format=3, no protocol
 * prefix). The extension's host_permissions (<all_urls>) let the popup fetch
 * this cross-origin; a normal browser User-Agent avoids Evomi's Cloudflare
 * block that trips non-browser clients.
 *
 * Docs: https://docs.evomi.com/public-api/
 */
(function (root) {
  "use strict";

  var GENERATE_URL = "https://api.evomi.com/public/generate";

  // UI product value -> Evomi `product` query value.
  var PRODUCT_MAP = {
    rpc: "rpc", // Core Residential
    rp: "rp", // Premium Residential
    mp: "mp", // Mobile
    dc: "sdc", // Datacenter (shared)
    static: "static_residential" // Static Residential (ISP)
  };

  // Evomi returns validation failures as a JSON object (a ZodError), not a
  // string, so pull out a human-readable message rather than "[object Object]".
  function extractError(j) {
    var e = j && j.error != null ? j.error : j;
    if (typeof e === "string") return e;
    if (e && Array.isArray(e.issues) && e.issues.length) {
      return e.issues
        .map(function (i) {
          var p = i.path && i.path.length ? i.path.join(".") + ": " : "";
          return p + (i.message || "invalid");
        })
        .join("; ");
    }
    if (e && typeof e.message === "string") return e.message;
    try {
      return JSON.stringify(e);
    } catch (x) {
      return String(e);
    }
  }

  async function fetchEvomiProxies(apiKey, opts) {
    opts = opts || {};
    if (!apiKey) throw new Error("Missing Evomi API key");

    var product = PRODUCT_MAP[opts.product] || opts.product || "rpc";
    var params = new URLSearchParams({
      product: product,
      amount: String(opts.amount || 1),
      format: "3", // username:password:host:port
      prepend_protocol: "false", // bare string, no http:// prefix
      protocol: opts.protocol || "http",
      session: opts.session || "sticky"
    });
    if (opts.country) params.set("countries", opts.country);
    if (opts.region) params.set("region", opts.region);
    if (opts.city) params.set("city", opts.city);
    if (opts.isp) params.set("isp", opts.isp);
    if (opts.lifetime) params.set("lifetime", String(opts.lifetime));

    var resp = await fetch(GENERATE_URL + "?" + params.toString(), {
      method: "GET",
      headers: { "x-apikey": apiKey, Accept: "*/*" }
    });

    var text = (await resp.text()).trim();

    // Errors may come back as HTTP 4xx or as a 200 with a JSON error body
    // (either {"error":"..."} or a nested {"error":{ZodError}}).
    if (text.startsWith("{")) {
      var j = null;
      try {
        j = JSON.parse(text);
      } catch (e) {
        j = null;
      }
      if (j && (j.success === false || j.error)) {
        throw new Error(extractError(j));
      }
    }
    if (!resp.ok) {
      throw new Error("Evomi API error " + resp.status);
    }

    var lines = text
      .split(/\r?\n/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    if (!lines.length) throw new Error("No proxies returned");
    return lines;
  }

  var apiObj = { fetchEvomiProxies: fetchEvomiProxies, PRODUCT_MAP: PRODUCT_MAP };
  if (typeof module !== "undefined" && module.exports) module.exports = apiObj;
  root.Evomi = apiObj;
})(typeof self !== "undefined" ? self : this);
