/*
 * Firefox (MV2) background script.
 *
 * Firefox applies proxies per-request via browser.proxy.onRequest (returning
 * a ProxyInfo) rather than Chrome's chrome.proxy.settings. SOCKS credentials
 * ride on the ProxyInfo directly; HTTP/HTTPS proxy credentials are supplied
 * through webRequest.onAuthRequired, same as Chrome.
 *
 * Storage model (shared with the popup):
 *   proxies : saved profiles
 *   active  : full snapshot of the currently-applied proxy, or null
 *   recents : up to 10 recently-activated snapshots
 */

const ACTIVE_KEY = "active";

let activeProxy = null;
const authAttempts = new Map();

async function loadActive() {
  const data = await browser.storage.local.get(ACTIVE_KEY);
  activeProxy = data[ACTIVE_KEY] || null;
  return activeProxy;
}

// Map our scheme to a Firefox ProxyInfo type.
function fxType(scheme) {
  const s = (scheme || "http").toLowerCase();
  if (s === "socks5" || s === "socks") return "socks"; // Firefox: "socks" == SOCKSv5
  if (s === "socks4") return "socks4";
  if (s === "https") return "https";
  return "http";
}

// Decide the proxy for each request.
function handleProxyRequest(requestInfo) {
  if (!activeProxy) return { type: "direct" };

  const type = fxType(activeProxy.scheme);
  const info = {
    type: type,
    host: activeProxy.host,
    port: Number(activeProxy.port)
  };

  if (type === "socks" || type === "socks4") {
    // SOCKS auth is carried on the ProxyInfo itself.
    if (activeProxy.username) {
      info.username = activeProxy.username;
      info.password = activeProxy.password || "";
    }
    // Resolve DNS through the proxy (avoids local DNS leaks for SOCKS5).
    info.proxyDNS = type === "socks";
  }

  return info;
}

browser.proxy.onRequest.addListener(handleProxyRequest, {
  urls: ["<all_urls>"]
});

// Surface proxy configuration errors to the console for debugging.
if (browser.proxy.onError) {
  browser.proxy.onError.addListener((err) => {
    console.error("[Proxy Switcher] proxy error:", err && err.message);
  });
}

// Supply credentials for HTTP/HTTPS proxy auth challenges.
browser.webRequest.onAuthRequired.addListener(
  (details) => {
    if (!details.isProxy) return {};
    if (!activeProxy || !activeProxy.username) return {};

    const prev = authAttempts.get(details.requestId) || 0;
    if (prev >= 1) {
      // Already tried once and it was rejected: cancel to avoid a loop.
      authAttempts.delete(details.requestId);
      return { cancel: true };
    }
    authAttempts.set(details.requestId, prev + 1);

    return {
      authCredentials: {
        username: activeProxy.username,
        password: activeProxy.password || ""
      }
    };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

function cleanup(details) {
  authAttempts.delete(details.requestId);
}
browser.webRequest.onCompleted.addListener(cleanup, { urls: ["<all_urls>"] });
browser.webRequest.onErrorOccurred.addListener(cleanup, {
  urls: ["<all_urls>"]
});

async function updateBadge() {
  try {
    if (activeProxy) {
      await browser.browserAction.setBadgeText({ text: "ON" });
      await browser.browserAction.setBadgeBackgroundColor({ color: "#16a34a" });
      await browser.browserAction.setTitle({
        title: `Proxy: ${
          activeProxy.label || activeProxy.host + ":" + activeProxy.port
        }`
      });
    } else {
      await browser.browserAction.setBadgeText({ text: "" });
      await browser.browserAction.setTitle({
        title: "Proxy Switcher (no proxy)"
      });
    }
  } catch (e) {
    /* ignore */
  }
}

// React to popup changes.
browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes[ACTIVE_KEY]) {
    await loadActive();
    await updateBadge();
  }
});

async function init() {
  await loadActive();
  await updateBadge();
}
init();
