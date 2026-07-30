# evomi-proxy-gen

Small CLI that calls the [Evomi Public API](https://docs.evomi.com/public-api/)
and prints ready-to-use proxy strings in the format:

```
username:password:host:port
```

Pure Python standard library — no `pip install` needed. Python 3.10+.

## Setup

Get your API key from the Evomi dashboard → **Settings → API**, then save it once:

```bash
python evomi_proxy.py configure
```

(Stored in `~/.config/evomi/config.json`. You can also use `--api-key` per call or
set the `EVOMI_API_KEY` environment variable.)

## Usage

```bash
# One US premium-residential proxy
python evomi_proxy.py rp --country US

# 5 mobile proxies in Berlin, rotating each request
python evomi_proxy.py mp --country DE --city berlin --amount 5 --session hard

# Sticky residential IP held for 30 minutes, written to a file
python evomi_proxy.py rp -c US --session sticky --lifetime 30 -o proxies.txt

# SOCKS5 datacenter proxy
python evomi_proxy.py dc -c US --protocol socks5
```

### Products (subcommands)

| Command  | Product                  | Evomi `product` |
|----------|--------------------------|-----------------|
| `rp`     | Premium Residential      | `rp`            |
| `rpc`    | Core Residential         | `rpc`           |
| `mp`     | Mobile                   | `mp`            |
| `dc`     | Datacenter               | `sdc`           |
| `static` | Static Residential (ISP) | `static-residential` |

### Options

| Flag | Meaning |
|------|---------|
| `-c, --country` | ISO code(s), e.g. `US` or `US,DE,NL` |
| `-r, --region`  | Region / state |
| `--city`        | City, e.g. `berlin` |
| `--isp`         | ISP name |
| `--session`     | `sticky` (keep IP) or `hard` (rotate). Default `sticky` |
| `--lifetime`    | Sticky session minutes, 1–1440 |
| `--protocol`    | `http` (default) or `socks5` — changes the port |
| `-n, --amount`  | Number of proxies, 1–100 |
| `--adblock`     | Enable Evomi ad-block |
| `--resolve-ip`  | Replace the Evomi hostname with a literal IP in the output |
| `-o, --output`  | Write to a file instead of stdout |
| `--api-key`     | Override the stored/env key for this call |

## Notes

- Evomi's connect endpoints are load-balanced **hostnames** (e.g.
  `rp.evomi.com`), so the default output keeps the hostname — that's what Evomi
  recommends. Use `--resolve-ip` only if you specifically need a literal IP; it
  pins you to whichever backend the DNS lookup returned at that moment.
- Under the hood this calls `GET /public/generate` with `format=3` and
  `prepend_protocol=false`, authenticated via the `x-apikey` header.
