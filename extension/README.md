# Proxy Switcher (Auth)

Save and switch between authenticated (`username:password`) proxies. Paste a
proxy string in almost any common format and it's parsed into
scheme / host / port / user / pass automatically.

Ships as **two builds** from the same shared UI:

- `chrome/` — **Chrome / Edge** (Manifest V3, uses `chrome.proxy`).
- `firefox/` — **Firefox** (Manifest V2, uses `proxy.onRequest`).

## Install (unpacked)

**Chrome / Edge**
1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. **Load unpacked** → select the `extension/chrome` folder

**Firefox**
1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select `extension/firefox/manifest.json`
   (temporary add-ons are removed on restart; use `web-ext` or a signed
   build for a permanent install)

## Usage

The popup has a bold **connection status banner** at the top — bright green
**CONNECTED** with the active endpoint, or a greyed-out **DIRECT CONNECTION**
when no proxy is routing — plus three tabs:

- **Paste** — paste a proxy in any format; it parses into editable
  scheme / host / port / user / pass fields you can tweak before connecting.
- **Generate** — pull a fresh proxy from your Evomi account (see below).
- **Saved** — your Recent list and saved profiles, one click to switch.

- **Connect:** paste a proxy string, optionally give it a label, click
  **Connect**. It's parsed, activated immediately, and **automatically added to
  Recent**. If the **Save to profiles** box is ticked (default), it's also
  stored as a permanent profile. A live preview shows the parse before you act.
- **Save (without connecting):** click **Save** to add to profiles only.
  Paste multiple lines to bulk-save. Duplicates are skipped.
- **Switch:** click **Use** on any saved profile. The active one is highlighted,
  the top bar shows the live endpoint, and the toolbar icon shows an `ON` badge.
- **Recent:** the last 10 proxies you connected to appear in a **Recent** list
  for one-click reconnection — even if you deleted the saved profile. Click **＋**
  on a recent entry to save it back as a profile, or **clear** to empty the list.
- **Disable:** toggle **Enabled** off, or click **Use direct (no proxy)**.
- **Import / Export:** back up all profiles to JSON, or import a JSON backup or
  a plain-text list (one proxy string per line). Duplicates are skipped.
- **Generate from Evomi:** expand the **Generate from Evomi** panel to pull a
  fresh proxy straight from your [Evomi](https://evomi.com) account via their
  [Public API](https://docs.evomi.com/public-api/). Paste your API key once
  (Dashboard → Settings → API — stored locally, remembered between sessions),
  pick a product, country/city, and sticky-vs-rotating session, then click
  **Fetch proxy → input**. The generated `user:pass:host:port` string(s) land in
  the input box above; hit **Connect** to activate. Requesting several (Amount
  > 1) drops them all in, ready to bulk-save. Products: Core/Premium
  Residential, Mobile, Datacenter, Static Residential.

Authentication is handled automatically — when the proxy issues a `407`
challenge, the extension supplies the stored credentials. A wrong password is
rejected once and then cancelled to avoid an auth loop. (For SOCKS proxies in
Firefox, credentials are attached to the connection directly.)

## Supported input formats

All of these parse to the same proxy:

```
user:pass@host:port
host:port@user:pass
host:port:user:pass
user:pass:host:port
http://user:pass@host:port
https://user:pass@host:port
socks5://user:pass@host:port
socks5://host:port            (no auth)
host:port                     (no auth)
[::1]:8080                    (IPv6, bracketed)
host:port:user                (empty password)
```

- Scheme is optional (defaults to `http`; `socks` is treated as `socks5`).
- Percent-encoded credentials (e.g. `p%40ss` → `p@ss`) are decoded.
- Host/port order is detected by which pair contains a valid port and a
  dotted/`localhost`/bracketed host.

## Files

Shared between both builds (byte-identical): `parser.js`, `evomi.js`,
`popup.html`, `popup.css`, `popup.js` — the format-tolerant parser, the Evomi
Public API client, and the management UI. The UI uses a `browser ?? chrome`
alias so it runs on either engine unchanged.

Build-specific:

- **Chrome** `chrome/`
  - `manifest.json` — MV3 (`proxy`, `storage`, `webRequest`,
    `webRequestAuthProvider`, `<all_urls>`).
  - `background.js` — service worker; applies the proxy via `chrome.proxy` and
    answers auth via `webRequest.onAuthRequired` (`asyncBlocking`).
- **Firefox** `firefox/`
  - `manifest.json` — MV2 (`proxy`, `storage`, `webRequest`,
    `webRequestBlocking`, `<all_urls>`).
  - `background.js` — persistent script; routes via `proxy.onRequest` and
    answers HTTP(S) auth via `webRequest.onAuthRequired` (`blocking`).

## Storage model

`chrome.storage.local` (same keys on both engines):

- `proxies` — saved profiles `{id,label,scheme,host,port,username,password,raw}`
- `active` — full snapshot of the currently-applied proxy (or `null`)
- `recents` — up to 10 recently-activated snapshots, most-recent first

Storing `active`/`recents` as full snapshots (not just ids) lets a recent
proxy be reconnected even after its saved profile is deleted.

## Notes / limitations

- Proxy settings apply browser-wide.
- `localhost`, `127.0.0.1`, and `<local>` bypass the proxy.
- Credentials are stored in extension local storage (unencrypted, like all
  extension storage). Use on a trusted machine.
- A single password containing `@` may be misparsed when using the
  `user:pass@host:port` form; percent-encode it (`%40`) to be safe.
- Firefox: SOCKS credentials are attached to the connection directly and
  SOCKS5 resolves DNS through the proxy (`proxyDNS`) to avoid DNS leaks.
