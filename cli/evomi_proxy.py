#!/usr/bin/env python3
"""
evomi_proxy.py — generate Evomi proxy strings (username:password:host:port).

Talks to the Evomi Public API `GET /public/generate` endpoint and prints
ready-to-use proxy strings. Stdlib only — no third-party packages required.

Docs: https://docs.evomi.com/public-api/

Quick start:
    python evomi_proxy.py configure           # save your API key once
    python evomi_proxy.py rp --country US      # one US residential proxy
    python evomi_proxy.py mp --country DE --city berlin --amount 5

The output line format is always:  username:password:host:port
(Evomi's format=3, protocol stripped.)
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request

API_BASE = "https://api.evomi.com/public"
GENERATE_URL = API_BASE + "/generate"

# CLI product aliases -> Evomi `product` query value.
PRODUCTS = {
    "rp": "rp",                       # Premium Residential
    "rpc": "rpc",                     # Core Residential
    "mp": "mp",                       # Mobile
    "dc": "sdc",                      # Datacenter (shared)
    "sdc": "sdc",
    "static": "static_residential",   # Static Residential (ISP)
    "static-residential": "static_residential",
}

# Evomi `product` value -> key under Get Proxy Data's `products` object.
# /generate returns a generic host (rp.evomi.com) for every product, so we look
# up the product's real endpoint + port and substitute it (Core stays on
# core-residential.evomi.com, Mobile on mp.evomi.com:3000, etc.).
GPD_KEY = {
    "rpc": "rpc",
    "rp": "rp",
    "mp": "mp",
    "sdc": "dcp",
    "static_residential": "static_residential",
}

CONFIG_PATH = os.path.join(
    os.path.expanduser("~"), ".config", "evomi", "config.json"
)


# --------------------------------------------------------------------------- #
# Config / API key handling
# --------------------------------------------------------------------------- #
def load_api_key(cli_key: str | None) -> str | None:
    """Resolve the API key: --api-key > env EVOMI_API_KEY > config file."""
    if cli_key:
        return cli_key.strip()
    env = os.environ.get("EVOMI_API_KEY")
    if env:
        return env.strip()
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
            return (json.load(fh).get("api_key") or "").strip() or None
    except (OSError, json.JSONDecodeError):
        return None


def save_api_key(key: str) -> None:
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
        json.dump({"api_key": key.strip()}, fh, indent=2)
    # Best-effort tighten perms (no-op on Windows, meaningful on POSIX).
    try:
        os.chmod(CONFIG_PATH, 0o600)
    except OSError:
        pass


# --------------------------------------------------------------------------- #
# API call
# --------------------------------------------------------------------------- #
def build_params(args: argparse.Namespace, product: str) -> dict[str, str]:
    params: dict[str, str] = {
        "product": product,
        "amount": str(args.amount),
        "format": "3",                # username:password:host:port
        "prepend_protocol": "false",  # we want a bare string, no http:// prefix
        "protocol": args.protocol,
        "session": args.session,
    }
    if args.country:
        params["countries"] = args.country
    if args.region:
        params["region"] = args.region
    if args.city:
        params["city"] = args.city
    if args.isp:
        params["isp"] = args.isp
    if args.lifetime is not None:
        params["lifetime"] = str(args.lifetime)
    if args.adblock:
        params["adblock"] = "true"
    return params


def call_generate(api_key: str, params: dict[str, str]) -> str:
    url = GENERATE_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={
            "x-apikey": api_key,
            # Evomi sits behind Cloudflare, which 403s (code 1010) the default
            # python-urllib User-Agent. Send a normal one.
            "User-Agent": "evomi-proxy-gen/1.0",
            "Accept": "*/*",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace").strip()
        detail = extract_api_error(body) if body else ""
        raise SystemExit(
            f"Evomi API error {exc.code} {exc.reason}"
            + (f": {detail}" if detail else "")
        )
    except urllib.error.URLError as exc:
        raise SystemExit(f"Network error reaching Evomi API: {exc.reason}")


def fetch_product_endpoint(
    api_key: str, product: str, protocol: str
) -> tuple[str, int] | None:
    """Return (host, port) for a product from Get Proxy Data, or None."""
    req = urllib.request.Request(
        API_BASE,
        headers={
            "x-apikey": api_key,
            "User-Agent": "evomi-proxy-gen/1.0",
            "Accept": "*/*",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, json.JSONDecodeError):
        return None
    prod = (data.get("products") or {}).get(GPD_KEY.get(product, product))
    if not prod or not prod.get("endpoint") or not prod.get("ports"):
        return None
    port = prod["ports"].get("socks5" if protocol == "socks5" else "http")
    if not port:
        return None
    return prod["endpoint"], int(port)


def apply_product_endpoint(line: str, endpoint: tuple[str, int]) -> str:
    """Replace host:port in a user:pass:host:port line with the real endpoint."""
    parts = line.split(":")
    if len(parts) != 4:
        return line
    parts[2], parts[3] = endpoint[0], str(endpoint[1])
    return ":".join(parts)


def extract_api_error(raw: str) -> str:
    """Pull a readable message out of an Evomi JSON error body.

    Validation failures arrive as a nested ZodError object, e.g.
    {"success": false, "error": {"issues": [{"path": [...], "message": "..."}]}}.
    """
    try:
        err = json.loads(raw).get("error", raw)
    except (json.JSONDecodeError, AttributeError):
        return raw.strip()
    if isinstance(err, str):
        return err
    if isinstance(err, dict):
        issues = err.get("issues")
        if isinstance(issues, list) and issues:
            parts = []
            for i in issues:
                path = ".".join(str(p) for p in i.get("path", []))
                msg = i.get("message", "invalid")
                parts.append(f"{path}: {msg}" if path else msg)
            return "; ".join(parts)
        if isinstance(err.get("message"), str):
            return err["message"]
    return json.dumps(err)


def resolve_host_to_ip(line: str) -> str:
    """Replace the host in username:password:host:port with its resolved IP."""
    parts = line.split(":")
    if len(parts) != 4:
        return line  # unexpected shape; leave as-is
    user, pwd, host, port = parts
    try:
        ip = socket.gethostbyname(host)
    except socket.gaierror:
        return line
    return f"{user}:{pwd}:{ip}:{port}"


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
def cmd_configure(args: argparse.Namespace) -> int:
    key = args.api_key
    if not key:
        try:
            key = input("Paste your Evomi API key: ").strip()
        except EOFError:
            key = ""
    if not key:
        print("No key provided; nothing saved.", file=sys.stderr)
        return 1
    save_api_key(key)
    print(f"Saved API key to {CONFIG_PATH}")
    return 0


def cmd_generate(args: argparse.Namespace) -> int:
    api_key = load_api_key(args.api_key)
    if not api_key:
        print(
            "No API key found. Provide --api-key, set EVOMI_API_KEY, "
            "or run:  python evomi_proxy.py configure",
            file=sys.stderr,
        )
        return 1

    product = PRODUCTS[args.product]
    params = build_params(args, product)
    raw = call_generate(api_key, params).strip()

    # /generate returns plain-text proxy lines on success, but a JSON object
    # like {"error": "Not enough balance"} on failure (still HTTP 200).
    if raw.startswith("{"):
        print(f"Evomi refused the request: {extract_api_error(raw)}", file=sys.stderr)
        return 1

    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    if not lines:
        print("Evomi returned no proxies for that request.", file=sys.stderr)
        print(f"(raw response: {raw!r})", file=sys.stderr)
        return 1

    # /generate returns a generic host (rp.evomi.com) for every product; swap in
    # the product's real endpoint + port unless the user opted out.
    if not args.raw_host:
        endpoint = fetch_product_endpoint(api_key, product, args.protocol)
        if endpoint:
            lines = [apply_product_endpoint(ln, endpoint) for ln in lines]

    if args.resolve_ip:
        lines = [resolve_host_to_ip(ln) for ln in lines]

    out = "\n".join(lines)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(out + "\n")
        print(f"Wrote {len(lines)} proxy string(s) to {args.output}")
    else:
        print(out)
    return 0


# --------------------------------------------------------------------------- #
# Arg parsing
# --------------------------------------------------------------------------- #
def add_generate_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--country", "-c", help="ISO country code(s), e.g. US or US,DE,NL")
    p.add_argument("--region", "-r", help="Target region/state")
    p.add_argument("--city", help="Target city, e.g. berlin")
    p.add_argument("--isp", help="Target ISP name")
    p.add_argument(
        "--session",
        choices=["sticky", "hard"],
        default="sticky",
        help="sticky = keep same IP for the session; hard = rotate each request "
        "(default: sticky)",
    )
    p.add_argument(
        "--lifetime",
        type=int,
        help="Sticky session lifetime in minutes (1-1440)",
    )
    p.add_argument(
        "--protocol",
        choices=["http", "socks5"],
        default="http",
        help="Proxy protocol (affects port; default: http)",
    )
    p.add_argument(
        "--amount", "-n", type=int, default=1, help="Number of proxies (1-100)"
    )
    p.add_argument(
        "--adblock", action="store_true", help="Enable Evomi ad-block on the proxy"
    )
    p.add_argument(
        "--resolve-ip",
        action="store_true",
        help="Resolve the Evomi hostname to a literal IP in the output string "
        "(default keeps the hostname, which is what Evomi recommends)",
    )
    p.add_argument(
        "--raw-host",
        action="store_true",
        help="Keep the exact host /generate returns (generic rp.evomi.com) "
        "instead of substituting the product's real endpoint",
    )
    p.add_argument("--output", "-o", help="Write results to a file instead of stdout")
    p.add_argument("--api-key", help="Evomi API key (overrides env/config)")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="evomi_proxy",
        description="Generate Evomi proxy strings (username:password:host:port).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    cfg = sub.add_parser("configure", help="Save your Evomi API key")
    cfg.add_argument("--api-key", help="API key (otherwise prompted)")
    cfg.set_defaults(func=cmd_configure)

    for alias, label in [
        ("rp", "Premium Residential"),
        ("rpc", "Core Residential"),
        ("mp", "Mobile"),
        ("dc", "Datacenter"),
        ("static", "Static Residential (ISP)"),
    ]:
        sp = sub.add_parser(alias, help=f"Generate {label} proxies")
        add_generate_args(sp)
        sp.set_defaults(func=cmd_generate, product=alias)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
