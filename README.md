# Evomi Proxy Toolkit

Generate and use [Evomi](https://evomi.com) proxies with almost no friction —
a **zero-dependency Python CLI** that turns your Evomi account into ready-to-use
proxy strings, plus a **Chrome/Firefox browser extension** that can fetch those
proxies from the Evomi API and apply them to your browser in two clicks.

Both talk to the official [Evomi Public API](https://docs.evomi.com/public-api/)
using your API key, which can be found in your account settings on evomi dashboard.

> Not affiliated with or Evomi.
> Made this for myself, and found it 

---

## What's in the box

| Component | Path | What it does |
|-----------|------|--------------|
| **CLI** | [`cli/`](cli/) | `evomi_proxy.py` — a single-file, stdlib-only Python tool that calls Evomi's `/public/generate` endpoint and prints proxy strings as `username:password:host:port`. |
| **Extension** | [`extension/`](extension/) | "Proxy Switcher (Auth)" for Chrome/Edge (MV3) and Firefox (MV2). Save/switch authenticated proxies **and** generate fresh ones from Evomi right inside the popup. |

Each component has its own README with full details:
[CLI docs](cli/README.md) · [Extension docs](extension/README.md).

---

## Why

Evomi (like most residential providers) encodes geo-targeting and session
control into the proxy **username/password** — e.g.
`password_country-US_session-AB12CD_lifetime-30`. Building those strings by hand
is fiddly and error-prone. This toolkit asks the Evomi API to build them for you,
so you always get a valid, correctly-targeted proxy string.

The output is the plain, portable shape almost every tool accepts:

```
username:password:host:port
```

---

## Quick start

### 1. Get an API key
Log in to the Evomi dashboard → **Settings → API** and copy your key.

### 2. CLI

Requires Python 3.10+. No `pip install` needed.

```bash
cd cli
python evomi_proxy.py configure          # paste your API key once
python evomi_proxy.py rpc --country US    # one US Core-Residential proxy
python evomi_proxy.py mp -c DE --city berlin --amount 5 --session hard
```

Output:

```
username:password_country-US_session-XXXXXXXX:rp.evomi.com:1000
```

See [`cli/README.md`](cli/README.md) for every product and flag.

### 3. Extension

**Chrome / Edge:** `chrome://extensions` → enable **Developer mode** →
**Load unpacked** → select `extension/chrome`.

**Firefox:** `about:debugging#/runtime/this-firefox` →
**Load Temporary Add-on…** → select `extension/firefox/manifest.json`.

Then open the popup, expand **Generate from Evomi**, paste your API key once,
choose a product + country + session, and click **Fetch proxy → input** →
**Connect**. See [`extension/README.md`](extension/README.md).

---

## Products

| CLI command | Extension option | Evomi product |
|-------------|------------------|---------------|
| `rpc`       | Core Residential | `rpc` |
| `rp`        | Premium Residential | `rp` |
| `mp`        | Mobile | `mp` |
| `dc`        | Datacenter | `sdc` |
| `static`    | Static Residential | `static-residential` |

Targeting supported: country, region, city, ISP, plus sticky sessions with a
configurable lifetime, or per-request rotation.

---

## Security & privacy

- **Your key stays local.** The CLI stores it in `~/.config/evomi/config.json`;
  the extension stores it in the browser's local extension storage. Neither is
  encrypted, so use a trusted machine. Nothing is sent anywhere except the Evomi
  API.
- **Never commit your key.** The provided `.gitignore` excludes the CLI config
  file. Treat generated proxy strings as secrets too — they contain live
  credentials.
- If a key leaks, rotate it in the Evomi dashboard.

---

## License

[MIT](LICENSE) — do what you like, no warranty.
