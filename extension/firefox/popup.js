/* Popup UI logic (shared by the Chrome and Firefox builds). */

const api = globalThis.browser ?? globalThis.chrome;

const PROXIES_KEY = "proxies";
const ACTIVE_KEY = "active";
const RECENTS_KEY = "recents";
const MAX_RECENTS = 10;

const els = {
  master: document.getElementById("masterToggle"),
  activeBar: document.getElementById("activeBar"),
  statusLabel: document.getElementById("statusLabel"),
  activeText: document.getElementById("activeText"),
  input: document.getElementById("proxyInput"),
  label: document.getElementById("labelInput"),
  saveCheck: document.getElementById("saveCheck"),
  saveBtn: document.getElementById("saveBtn"),
  connectBtn: document.getElementById("connectBtn"),
  preview: document.getElementById("preview"),
  list: document.getElementById("proxyList"),
  empty: document.getElementById("empty"),
  count: document.getElementById("count"),
  recentSection: document.getElementById("recentSection"),
  recentList: document.getElementById("recentList"),
  clearRecent: document.getElementById("clearRecent"),
  directBtn: document.getElementById("directBtn"),
  importBtn: document.getElementById("importBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importFile: document.getElementById("importFile"),
  ioMsg: document.getElementById("ioMsg"),
  tpl: document.getElementById("itemTemplate"),
  recentTpl: document.getElementById("recentTemplate"),
  parsedFields: document.getElementById("parsedFields"),
  fScheme: document.getElementById("fScheme"),
  fHost: document.getElementById("fHost"),
  fPort: document.getElementById("fPort"),
  fUser: document.getElementById("fUser"),
  fPass: document.getElementById("fPass"),
  evomiPanel: document.getElementById("evomiPanel"),
  evomiKey: document.getElementById("evomiKey"),
  evomiProduct: document.getElementById("evomiProduct"),
  evomiSession: document.getElementById("evomiSession"),
  evomiCountry: document.getElementById("evomiCountry"),
  evomiCity: document.getElementById("evomiCity"),
  evomiLifetime: document.getElementById("evomiLifetime"),
  evomiAmount: document.getElementById("evomiAmount"),
  evomiFetch: document.getElementById("evomiFetch"),
  evomiMsg: document.getElementById("evomiMsg"),
  tabs: document.getElementById("tabs"),
  tabCount: document.getElementById("tabCount"),
  tabBtns: Array.from(document.querySelectorAll(".tab-btn")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel"))
};

const EVOMI_KEY_STORE = "evomiApiKey";
const EVOMI_OPTS_STORE = "evomiOpts";
const TAB_STORE = "uiTab";
const SCHEMES = ["http", "https", "socks5", "socks4"];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function ioMessage(text, kind) {
  els.ioMsg.textContent = text || "";
  els.ioMsg.className = "io-msg" + (kind ? " " + kind : "");
  if (text)
    setTimeout(() => {
      if (els.ioMsg.textContent === text) {
        els.ioMsg.textContent = "";
        els.ioMsg.className = "io-msg";
      }
    }, 4000);
}

// A proxy's identity ignores id/label so the same endpoint dedupes across
// saved profiles, the active proxy, and the recents list.
function keyOf(p) {
  if (!p) return "";
  return [
    (p.scheme || "http").toLowerCase(),
    p.host,
    p.port,
    p.username || "",
    p.password || ""
  ].join("|");
}

async function getState() {
  const data = await api.storage.local.get([
    PROXIES_KEY,
    ACTIVE_KEY,
    RECENTS_KEY
  ]);
  return {
    proxies: data[PROXIES_KEY] || [],
    active: data[ACTIVE_KEY] || null,
    recents: data[RECENTS_KEY] || []
  };
}

// ---- Display helpers ----
function proxyToDisplay(p) {
  const auth = p.username ? `${p.username}:${maskPass(p.password)}@` : "";
  return `${p.scheme}://${auth}${p.host}:${p.port}`;
}

function maskPass(pw) {
  if (!pw) return "";
  return pw.length <= 2 ? "••" : pw[0] + "•".repeat(Math.min(pw.length - 1, 6));
}

function labelFor(p) {
  return p.label || `${p.host}:${p.port}`;
}

// Build a clean snapshot (no id/label baggage the active/recent lists need).
function snapshot(p, label) {
  return {
    label: label || p.label || "",
    scheme: (p.scheme || "http").toLowerCase(),
    host: p.host,
    port: Number(p.port),
    username: p.username || "",
    password: p.password || ""
  };
}

// ---- Activation & recents ----
async function activate(proxy) {
  const snap = proxy ? snapshot(proxy) : null;
  const patch = { [ACTIVE_KEY]: snap };

  if (snap) {
    const { recents } = await getState();
    const k = keyOf(snap);
    const next = [snap, ...recents.filter((r) => keyOf(r) !== k)].slice(
      0,
      MAX_RECENTS
    );
    patch[RECENTS_KEY] = next;
  }

  await api.storage.local.set(patch);
  render();
}

async function goDirect() {
  await api.storage.local.set({ [ACTIVE_KEY]: null });
  render();
}

async function toggleMaster() {
  if (els.master.checked) {
    const { active, recents, proxies } = await getState();
    const target = active || recents[0] || proxies[0] || null;
    if (target) await activate(target);
    else render();
  } else {
    await goDirect();
  }
}

async function clearRecents() {
  await api.storage.local.set({ [RECENTS_KEY]: [] });
  render();
}

// ---- Add ----
function nonEmptyLines(raw) {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function entryFromParsed(parsed, label, raw) {
  return {
    id: uid(),
    label: label || "",
    scheme: parsed.scheme,
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    password: parsed.password,
    raw: raw
  };
}

// ---- Parsed editable fields (single-proxy mode) ----
function showFields(parsed) {
  els.fScheme.value = SCHEMES.includes(parsed.scheme) ? parsed.scheme : "http";
  els.fHost.value = parsed.host || "";
  els.fPort.value = parsed.port || "";
  els.fUser.value = parsed.username || "";
  els.fPass.value = parsed.password || "";
  els.parsedFields.hidden = false;
}

function hideFields() {
  els.parsedFields.hidden = true;
}

function fieldsVisible() {
  return !els.parsedFields.hidden;
}

// Build a proxy object from the editable fields; throws if incomplete.
function proxyFromFields() {
  const host = els.fHost.value.trim();
  const port = els.fPort.value.trim();
  if (!host) throw new Error("Host required");
  if (!ProxyParser.isPort(port)) throw new Error("Invalid port");
  return {
    scheme: els.fScheme.value,
    host: host,
    port: parseInt(port, 10),
    username: els.fUser.value.trim(),
    password: els.fPass.value
  };
}

// A field was edited: mirror the fields back into the textarea (canonical
// string) and refresh the preview — without re-parsing/re-filling the fields.
function syncFieldsToInput() {
  const user = els.fUser.value.trim();
  const auth = user ? `${user}:${els.fPass.value}@` : "";
  els.input.value = `${els.fScheme.value}://${auth}${els.fHost.value.trim()}:${els.fPort.value.trim()}`;
  try {
    els.preview.textContent = "→ " + proxyToDisplay(proxyFromFields());
    els.preview.className = "preview ok";
  } catch (e) {
    els.preview.textContent = "✕ " + e.message;
    els.preview.className = "preview err";
  }
}

function livePreview() {
  const raw = els.input.value.trim();
  if (!raw) {
    els.preview.textContent = "";
    els.preview.className = "preview";
    hideFields();
    return;
  }
  const lines = nonEmptyLines(raw);
  if (lines.length > 1) {
    let ok = 0;
    let bad = 0;
    for (const line of lines) {
      try {
        ProxyParser.parseProxyString(line);
        ok++;
      } catch (e) {
        bad++;
      }
    }
    els.preview.textContent =
      `${ok} valid` + (bad ? `, ${bad} invalid (skipped)` : "");
    els.preview.className = "preview " + (ok ? "ok" : "err");
    hideFields();
    return;
  }
  try {
    const parsed = ProxyParser.parseProxyString(lines[0]);
    els.preview.textContent = "→ " + proxyToDisplay(parsed);
    els.preview.className = "preview ok";
    showFields(parsed);
  } catch (e) {
    els.preview.textContent = "✕ " + e.message;
    els.preview.className = "preview err";
    hideFields();
  }
}

function clearInput() {
  els.input.value = "";
  els.label.value = "";
  els.preview.textContent = "";
  els.preview.className = "preview";
  hideFields();
}

// Parse the given lines and append any new ones to the saved-profiles list.
// Duplicates (same scheme/host/port/user/pass) are skipped, not re-added.
async function addLinesToProfiles(lines, single) {
  const { proxies } = await getState();
  const existing = new Set(proxies.map(keyOf));
  let added = 0;
  let dup = 0;
  const errors = [];

  lines.forEach((line, i) => {
    try {
      const parsed = ProxyParser.parseProxyString(line);
      const label = single ? els.label.value.trim() : "";
      const entry = entryFromParsed(parsed, label, line);
      const k = keyOf(entry);
      if (existing.has(k)) {
        dup++;
        return;
      }
      existing.add(k);
      proxies.push(entry);
      added++;
    } catch (e) {
      errors.push(`line ${i + 1}: ${e.message}`);
    }
  });

  if (added) await api.storage.local.set({ [PROXIES_KEY]: proxies });
  return { added, dup, errors };
}

// "Save" button: add to profiles only — does NOT connect.
async function saveProxy() {
  const lines = nonEmptyLines(els.input.value);
  if (!lines.length) {
    els.input.focus();
    return;
  }
  const { added, dup, errors } = await addLinesToProfiles(
    lines,
    lines.length === 1
  );
  if (!added) {
    els.preview.textContent =
      "✕ " + (errors[0] || (dup ? "Already saved" : "Nothing to add"));
    els.preview.className = "preview err";
    return;
  }
  clearInput();
  const extra = [];
  if (dup) extra.push(`${dup} dup`);
  if (errors.length) extra.push(`${errors.length} invalid`);
  ioMessage(
    `Saved ${added}` + (extra.length ? ` (${extra.join(", ")})` : ""),
    "ok"
  );
  render();
}

// "Connect" button: parse, activate now (auto-added to Recent), and — when the
// "Save to profiles" box is checked — also persist it to the profiles list.
async function connectProxy() {
  const lines = nonEmptyLines(els.input.value);
  if (!lines.length) {
    els.input.focus();
    return;
  }

  // Bulk input can't be "connected" (only one proxy is active at a time),
  // so fall back to saving them all to profiles.
  if (lines.length > 1) {
    const { added, dup, errors } = await addLinesToProfiles(lines, false);
    if (!added) {
      ioMessage(
        `Nothing added` +
          (dup ? `, ${dup} dup` : "") +
          (errors.length ? `, ${errors.length} invalid` : ""),
        "err"
      );
      return;
    }
    clearInput();
    ioMessage(`Saved ${added} to profiles — pick one to connect`, "ok");
    render();
    return;
  }

  // Single proxy: parse it.
  let parsed;
  try {
    parsed = ProxyParser.parseProxyString(lines[0]);
  } catch (e) {
    els.preview.textContent = "✕ " + e.message;
    els.preview.className = "preview err";
    return;
  }

  const label = els.label.value.trim();

  // Optionally persist to the saved-profiles list (deduped).
  if (els.saveCheck.checked) {
    await addLinesToProfiles(lines, true);
  }

  // Activate — this writes `active` and unshifts into `recents` automatically.
  await activate({ ...parsed, label });
  clearInput();
  ioMessage(
    els.saveCheck.checked ? "Connected · saved to profiles" : "Connected",
    "ok"
  );
}

async function remove(id) {
  const { proxies } = await getState();
  await api.storage.local.set({
    [PROXIES_KEY]: proxies.filter((p) => p.id !== id)
  });
  render();
}

// Save a recent snapshot as a persistent profile (if not already saved).
async function saveRecent(snap) {
  const { proxies } = await getState();
  const k = keyOf(snap);
  if (proxies.some((p) => keyOf(p) === k)) {
    ioMessage("Already saved", "ok");
    return;
  }
  proxies.push(entryFromParsed(snap, snap.label || "", ""));
  await api.storage.local.set({ [PROXIES_KEY]: proxies });
  ioMessage("Saved to profiles", "ok");
  render();
}

// ---- Import / Export ----
async function exportProxies() {
  const { proxies, active } = await getState();
  if (!proxies.length) {
    ioMessage("Nothing to export", "err");
    return;
  }
  const doc = {
    type: "proxy-switcher-export",
    version: 2,
    exportedAt: new Date().toISOString(),
    active,
    proxies
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `proxies-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  ioMessage(`Exported ${proxies.length}`, "ok");
}

function normalizeImported(p) {
  if (p && typeof p === "object" && p.host && p.port) {
    return {
      id: uid(),
      label: p.label || "",
      scheme: (p.scheme || "http").toLowerCase(),
      host: String(p.host),
      port: Number(p.port),
      username: p.username || "",
      password: p.password || "",
      raw: p.raw || ""
    };
  }
  if (typeof p === "string") {
    return entryFromParsed(ProxyParser.parseProxyString(p), "", p);
  }
  throw new Error("unrecognized entry");
}

async function importFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    ioMessage("Empty file", "err");
    return;
  }

  let incoming = [];
  let parsedJson = null;
  try {
    parsedJson = JSON.parse(trimmed);
  } catch (e) {
    parsedJson = null;
  }

  if (parsedJson) {
    incoming = Array.isArray(parsedJson)
      ? parsedJson
      : parsedJson.proxies || [];
  } else {
    incoming = nonEmptyLines(trimmed);
  }

  const { proxies } = await getState();
  const existing = new Set(proxies.map(keyOf));

  let added = 0;
  let skippedDup = 0;
  let bad = 0;

  for (const item of incoming) {
    try {
      const entry = normalizeImported(item);
      const k = keyOf(entry);
      if (existing.has(k)) {
        skippedDup++;
        continue;
      }
      existing.add(k);
      proxies.push(entry);
      added++;
    } catch (e) {
      bad++;
    }
  }

  if (!added) {
    ioMessage(
      `Nothing added` +
        (skippedDup ? `, ${skippedDup} duplicate` : "") +
        (bad ? `, ${bad} invalid` : ""),
      "err"
    );
    return;
  }

  await api.storage.local.set({ [PROXIES_KEY]: proxies });
  const parts = [`Imported ${added}`];
  if (skippedDup) parts.push(`${skippedDup} dup`);
  if (bad) parts.push(`${bad} invalid`);
  ioMessage(parts.join(", "), "ok");
  render();
}

function handleImportFile(evt) {
  const file = evt.target.files && evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importFromText(String(reader.result));
  reader.onerror = () => ioMessage("Could not read file", "err");
  reader.readAsText(file);
  evt.target.value = "";
}

// ---- Render ----
async function render() {
  const { proxies, active, recents } = await getState();
  const activeKey = keyOf(active);

  // Connection status banner + master toggle.
  els.master.checked = !!active;
  if (active) {
    els.statusLabel.textContent = "Connected";
    els.activeText.textContent = labelFor(active) + " · " + proxyToDisplay(active);
    els.activeBar.classList.add("on");
  } else {
    els.statusLabel.textContent = "Direct connection";
    els.activeText.textContent = "No proxy — traffic is not routed";
    els.activeBar.classList.remove("on");
  }

  // Recents.
  els.recentList.innerHTML = "";
  const savedKeys = new Set(proxies.map(keyOf));
  els.recentSection.style.display = recents.length ? "block" : "none";
  for (const r of recents) {
    const node = els.recentTpl.content.firstElementChild.cloneNode(true);
    if (keyOf(r) === activeKey) node.classList.add("active");
    node.querySelector(".item-label").textContent = labelFor(r);
    node.querySelector(".item-detail").textContent = proxyToDisplay(r);
    node.querySelector(".use").addEventListener("click", () => activate(r));
    const saveBtn = node.querySelector(".save");
    if (savedKeys.has(keyOf(r))) {
      saveBtn.disabled = true;
      saveBtn.title = "Already saved";
    } else {
      saveBtn.addEventListener("click", () => saveRecent(r));
    }
    els.recentList.appendChild(node);
  }

  // Saved profiles.
  els.list.innerHTML = "";
  els.count.textContent = proxies.length ? `${proxies.length}` : "";
  els.tabCount.textContent = proxies.length ? `(${proxies.length})` : "";
  els.empty.style.display = proxies.length ? "none" : "block";
  for (const p of proxies) {
    const node = els.tpl.content.firstElementChild.cloneNode(true);
    if (keyOf(p) === activeKey) node.classList.add("active");
    node.querySelector(".item-label").textContent = labelFor(p);
    node.querySelector(".item-detail").textContent = proxyToDisplay(p);
    node.querySelector(".use").addEventListener("click", () => activate(p));
    node.querySelector(".del").addEventListener("click", () => remove(p.id));
    els.list.appendChild(node);
  }
}

// ---- Evomi generator ----
function evomiMsg(text, kind) {
  els.evomiMsg.textContent = text || "";
  els.evomiMsg.className = "preview" + (kind ? " " + kind : "");
}

async function initEvomi() {
  const data = await api.storage.local.get([EVOMI_KEY_STORE, EVOMI_OPTS_STORE]);
  if (data[EVOMI_KEY_STORE]) els.evomiKey.value = data[EVOMI_KEY_STORE];
  const o = data[EVOMI_OPTS_STORE] || {};
  if (o.product) els.evomiProduct.value = o.product;
  if (o.session) els.evomiSession.value = o.session;
  if (o.country) els.evomiCountry.value = o.country;
  if (o.city) els.evomiCity.value = o.city;
  if (o.lifetime) els.evomiLifetime.value = o.lifetime;
  if (o.amount) els.evomiAmount.value = o.amount;
}

function readEvomiOpts() {
  const session = els.evomiSession.value;
  return {
    product: els.evomiProduct.value,
    session: session,
    country: els.evomiCountry.value.trim(),
    city: els.evomiCity.value.trim(),
    // Lifetime only applies to sticky sessions; omit it for rotating.
    lifetime: session === "sticky" ? els.evomiLifetime.value.trim() : "",
    amount: parseInt(els.evomiAmount.value, 10) || 1
  };
}

// Prefilled text fields clear when focused and restore their default if left
// blank — so a click gives you an empty field to type in, per field.
function wireEvomiDefaults() {
  els.evomiPanel.querySelectorAll("input[data-default]").forEach((el) => {
    el.addEventListener("focus", () => {
      if (el.value === el.dataset.default) el.value = "";
    });
    el.addEventListener("blur", () => {
      if (el.value.trim() === "") el.value = el.dataset.default;
    });
  });
}

async function fetchFromEvomi() {
  const key = els.evomiKey.value.trim();
  if (!key) {
    evomiMsg("Enter your Evomi API key", "err");
    els.evomiKey.focus();
    return;
  }
  const opts = readEvomiOpts();
  await api.storage.local.set({
    [EVOMI_KEY_STORE]: key,
    [EVOMI_OPTS_STORE]: opts
  });

  els.evomiFetch.disabled = true;
  evomiMsg("Fetching…");
  try {
    const lines = await Evomi.fetchEvomiProxies(key, opts);
    els.input.value = lines.join("\n");
    livePreview();
    evomiMsg(`Got ${lines.length} — sent to Paste tab`, "ok");
    // Surface the result in the Paste tab so Connect / fields are right there.
    switchTab("paste");
    els.input.focus();
  } catch (e) {
    evomiMsg("✕ " + e.message, "err");
  } finally {
    els.evomiFetch.disabled = false;
  }
}

// ---- Tabs ----
function switchTab(name) {
  els.tabBtns.forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name)
  );
  els.tabPanels.forEach((p) => {
    p.hidden = p.dataset.panel !== name;
  });
  api.storage.local.set({ [TAB_STORE]: name });
}

async function initTab() {
  const data = await api.storage.local.get(TAB_STORE);
  const name = data[TAB_STORE] || "paste";
  if (els.tabBtns.some((b) => b.dataset.tab === name)) switchTab(name);
}

// ---- Wire up ----
els.tabBtns.forEach((b) =>
  b.addEventListener("click", () => switchTab(b.dataset.tab))
);
els.evomiFetch.addEventListener("click", fetchFromEvomi);
els.saveBtn.addEventListener("click", saveProxy);
els.connectBtn.addEventListener("click", connectProxy);
els.input.addEventListener("input", livePreview);
els.input.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") connectProxy();
});
// Edits to the parsed fields mirror back into the input + preview.
[els.fHost, els.fPort, els.fUser, els.fPass].forEach((el) =>
  el.addEventListener("input", syncFieldsToInput)
);
els.fScheme.addEventListener("change", syncFieldsToInput);
els.master.addEventListener("change", toggleMaster);
els.directBtn.addEventListener("click", goDirect);
els.clearRecent.addEventListener("click", clearRecents);
els.exportBtn.addEventListener("click", exportProxies);
els.importBtn.addEventListener("click", () => els.importFile.click());
els.importFile.addEventListener("change", handleImportFile);

render();
initTab();
initEvomi();
wireEvomiDefaults();
