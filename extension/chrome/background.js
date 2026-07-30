/*
 * Chrome (MV3) service worker.
 * Applies the active proxy via chrome.proxy and answers proxy auth
 * challenges via webRequest.onAuthRequired.
 *
 * Storage model:
 *   proxies : saved profiles       [{id,label,scheme,host,port,username,password,raw}]
 *   active  : full snapshot of the currently-applied proxy, or null
 *   recents : up to 10 recently-activated snapshots, most recent first
 */

const api = globalThis.browser ?? globalThis.chrome;
const ACTIVE_KEY = "active";

let activeProxy = null;
// Track auth attempts per requestId so a wrong password does not loop forever.
const authAttempts = new Map();

async function loadActive() {
  const data = await api.storage.local.get(ACTIVE_KEY);
  activeProxy = data[ACTIVE_KEY] || null;
  return activeProxy;
}

function schemeForProxy(p) {
  // chrome.proxy accepts: http, https, quic, socks4, socks5.
  const s = (p.scheme || "http").toLowerCase();
  if (s === "socks") return "socks5";
  return s;
}

async function applyProxy(proxy) {
  if (!proxy) {
    await api.proxy.settings.clear({ scope: "regular" });
    await updateBadge(null);
    return;
  }

  const config = {
    mode: "fixed_servers",
    rules: {
      singleProxy: {
        scheme: schemeForProxy(proxy),
        host: proxy.host,
        port: Number(proxy.port)
      },
      bypassList: ["localhost", "127.0.0.1", "<local>"]
    }
  };

  await api.proxy.settings.set({ value: config, scope: "regular" });
  await updateBadge(proxy);
}

async function updateBadge(proxy) {
  try {
    if (proxy) {
      await api.action.setBadgeText({ text: "ON" });
      await api.action.setBadgeBackgroundColor({ color: "#16a34a" });
      await api.action.setTitle({
        title: `Proxy: ${proxy.label || proxy.host + ":" + proxy.port}`
      });
    } else {
      await api.action.setBadgeText({ text: "" });
      await api.action.setTitle({ title: "Proxy Switcher (no proxy)" });
    }
  } catch (e) {
    // action APIs may be unavailable in some contexts; ignore.
  }
}

// Provide credentials for proxy auth challenges.
api.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    // Only answer proxy challenges (not website logins).
    if (!details.isProxy) {
      callback({});
      return;
    }
    if (!activeProxy || !activeProxy.username) {
      callback({});
      return;
    }

    const prev = authAttempts.get(details.requestId) || 0;
    if (prev >= 1) {
      // Credentials already supplied once and rejected: cancel to avoid loop.
      authAttempts.delete(details.requestId);
      callback({ cancel: true });
      return;
    }
    authAttempts.set(details.requestId, prev + 1);

    callback({
      authCredentials: {
        username: activeProxy.username,
        password: activeProxy.password || ""
      }
    });
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

function cleanup(details) {
  authAttempts.delete(details.requestId);
}
api.webRequest.onCompleted.addListener(cleanup, { urls: ["<all_urls>"] });
api.webRequest.onErrorOccurred.addListener(cleanup, { urls: ["<all_urls>"] });

// React to changes made in the popup.
api.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes[ACTIVE_KEY]) {
    await loadActive();
    await applyProxy(activeProxy);
  }
});

// Restore proxy on startup / install.
async function init() {
  await loadActive();
  await applyProxy(activeProxy);
}
api.runtime.onStartup.addListener(init);
api.runtime.onInstalled.addListener(init);
init();
