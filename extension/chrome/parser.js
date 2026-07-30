/*
 * Proxy string parser.
 *
 * Goal: accept a single string describing a proxy in (almost) any common
 * layout and return { scheme, host, port, username, password }.
 *
 * Supported shapes (case-insensitive scheme, optional):
 *   user:pass@host:port
 *   host:port@user:pass
 *   host:port:user:pass
 *   user:pass:host:port
 *   host:port                       (no auth)
 *   scheme://user:pass@host:port
 *   scheme://host:port              (no auth)
 *   host (bare, defaults to port 80/1080)
 *
 * The host may be an IPv4 address, a hostname, or a bracketed IPv6 literal
 * ([::1]:8080). The port is any 1-65535 integer. Auth credentials may
 * contain URL-encoded characters and are decoded when possible.
 */

(function (root) {
  "use strict";

  var KNOWN_SCHEMES = ["socks5", "socks4", "https", "http", "quic", "socks"];

  function isPort(token) {
    if (!/^\d{1,5}$/.test(token)) return false;
    var n = parseInt(token, 10);
    return n >= 1 && n <= 65535;
  }

  // Looks like a host: an IPv4/hostname (contains a dot), "localhost",
  // or a bracketed IPv6 literal. Deliberately conservative so that a plain
  // word (likely a username) is NOT treated as a host on its own.
  function looksLikeHost(token) {
    if (!token) return false;
    if (token[0] === "[") return true; // [ipv6]
    if (token.indexOf(".") !== -1) return true; // ipv4 or dotted hostname
    if (token.toLowerCase() === "localhost") return true;
    return false;
  }

  function tryDecode(s) {
    if (s == null) return s;
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  function splitScheme(raw) {
    var scheme = null;
    var rest = raw;
    var m = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
    if (m) {
      scheme = m[1].toLowerCase();
      rest = raw.slice(m[0].length);
    }
    return { scheme: scheme, rest: rest };
  }

  // Split "host:port", tolerating bracketed IPv6 "[::1]:8080".
  function splitHostPort(pair) {
    pair = pair.trim();
    var host, port;
    if (pair[0] === "[") {
      var end = pair.indexOf("]");
      if (end === -1) throw new Error("Unterminated IPv6 literal");
      host = pair.slice(1, end);
      var after = pair.slice(end + 1);
      if (after[0] === ":") port = after.slice(1);
    } else {
      var idx = pair.lastIndexOf(":");
      if (idx === -1) {
        host = pair;
      } else {
        host = pair.slice(0, idx);
        port = pair.slice(idx + 1);
      }
    }
    return { host: host, port: port };
  }

  function normalizeResult(scheme, host, port, username, password, defaultPort) {
    host = (host || "").trim();
    if (!host) throw new Error("Missing host");
    if (host[0] === "[" && host[host.length - 1] === "]") {
      host = host.slice(1, -1);
    }

    var portNum;
    if (port == null || port === "") {
      portNum = defaultPort;
    } else {
      port = String(port).trim();
      if (!isPort(port)) throw new Error("Invalid port: " + port);
      portNum = parseInt(port, 10);
    }

    return {
      scheme: scheme || "http",
      host: host,
      port: portNum,
      username: username ? tryDecode(username.trim()) : "",
      password: password != null ? tryDecode(password) : ""
    };
  }

  // Given two "a:b" pairs, decide which is host:port and which is user:pass.
  // Returns { hp: {host,port}, cred: {user,pass} } or null if undecidable.
  function orderPairs(left, right) {
    // A pair is host:port if it has exactly one ':' separating a host-ish
    // token and a valid port. We score each pair.
    function scoreAsHostPort(pairTokens) {
      // pairTokens is the array from splitting the pair on ':'.
      if (pairTokens.length !== 2) return -1;
      var h = pairTokens[0];
      var p = pairTokens[1];
      var score = 0;
      if (isPort(p)) score += 2;
      if (looksLikeHost(h)) score += 2;
      // A username rarely contains a dot; a host usually does.
      return score;
    }

    var lt = left.split(":");
    var rt = right.split(":");
    var ls = scoreAsHostPort(lt);
    var rs = scoreAsHostPort(rt);

    if (ls > rs) return { hpRaw: left, credRaw: right };
    if (rs > ls) return { hpRaw: right, credRaw: left };

    // Tie-break: if exactly one side has a numeric second token, that's host:port.
    var lPortish = lt.length === 2 && isPort(lt[1]);
    var rPortish = rt.length === 2 && isPort(rt[1]);
    if (lPortish && !rPortish) return { hpRaw: left, credRaw: right };
    if (rPortish && !lPortish) return { hpRaw: right, credRaw: left };

    return null;
  }

  function parseProxyString(input, opts) {
    opts = opts || {};
    if (typeof input !== "string") throw new Error("Expected a string");
    var raw = input.trim();
    if (!raw) throw new Error("Empty input");

    // Strip surrounding quotes if pasted with them.
    raw = raw.replace(/^["']|["']$/g, "").trim();

    var s = splitScheme(raw);
    var scheme = s.scheme;
    var body = s.rest.trim();

    // Normalize scheme aliases.
    if (scheme === "socks") scheme = "socks5";

    var defaultPort = scheme === "socks5" || scheme === "socks4" ? 1080 : 80;

    var username, password, host, port;

    if (body.indexOf("@") !== -1) {
      // Split on the LAST '@' so passwords containing '@' (rare, but the
      // host side never contains '@') mostly still work.
      var at = body.lastIndexOf("@");
      var a = body.slice(0, at);
      var b = body.slice(at + 1);

      // Decide which side is host:port. The host side almost never contains
      // characters that only appear in creds, so we test both.
      var aTokens = a.split(":");
      var bTokens = b.split(":");
      var aIsHP = bTokens.length <= 2 && looksLikeHostPort(bTokens);
      var bIsHP = looksLikeHostPort(bTokens);
      var aHP = looksLikeHostPort(aTokens);

      var hpRaw, credRaw;
      if (bIsHP && !aHP) {
        hpRaw = b; credRaw = a; // user:pass@host:port  (standard)
      } else if (aHP && !bIsHP) {
        hpRaw = a; credRaw = b; // host:port@user:pass
      } else {
        // Both or neither look like host:port. Prefer the standard layout:
        // creds before '@', host after '@'.
        hpRaw = b; credRaw = a;
      }

      var hp = splitHostPort(hpRaw);
      host = hp.host;
      port = hp.port;

      var ci = credRaw.indexOf(":");
      if (ci === -1) {
        username = credRaw;
        password = "";
      } else {
        username = credRaw.slice(0, ci);
        password = credRaw.slice(ci + 1);
      }
    } else {
      // No '@'. Split on ':'.
      var parts = body.split(":");

      if (body[0] === "[") {
        // Bracketed IPv6 with no auth: [::1]:8080
        var hpb = splitHostPort(body);
        host = hpb.host;
        port = hpb.port;
      } else if (parts.length === 1) {
        host = parts[0];
      } else if (parts.length === 2) {
        host = parts[0];
        port = parts[1];
      } else if (parts.length === 4) {
        // host:port:user:pass  OR  user:pass:host:port
        var left = parts[0] + ":" + parts[1];
        var right = parts[2] + ":" + parts[3];
        var ordered = orderPairs(left, right);
        if (!ordered) {
          // Default to the most common list format: host:port:user:pass
          ordered = { hpRaw: left, credRaw: right };
        }
        var hp4 = splitHostPort(ordered.hpRaw);
        host = hp4.host;
        port = hp4.port;
        var cr = ordered.credRaw.split(":");
        username = cr[0];
        password = cr.slice(1).join(":");
      } else if (parts.length === 3) {
        // Ambiguous: host:port:user (missing pass) or user:host:port etc.
        // Most common real case is host:port:user with empty pass, but that's
        // rare. Try: if last token is a port -> user:host:port? unlikely.
        // Treat as host:port:username when middle token is a port.
        if (isPort(parts[1])) {
          host = parts[0];
          port = parts[1];
          username = parts[2];
          password = "";
        } else if (isPort(parts[2])) {
          // user:host:port  (no password) — uncommon
          username = parts[0];
          host = parts[1];
          port = parts[2];
          password = "";
        } else {
          throw new Error("Ambiguous proxy string: " + input);
        }
      } else {
        throw new Error("Unrecognized proxy format: " + input);
      }
    }

    return normalizeResult(scheme, host, port, username, password, defaultPort);
  }

  // Helper used by the '@' branch: does this token array plausibly describe
  // a host:port pair?
  function looksLikeHostPort(tokens) {
    if (tokens.length === 2) {
      return isPort(tokens[1]) || looksLikeHost(tokens[0]);
    }
    if (tokens.length === 1) {
      return looksLikeHost(tokens[0]);
    }
    // Bracketed IPv6 splits into more tokens; handled elsewhere.
    return false;
  }

  var api = { parseProxyString: parseProxyString, isPort: isPort };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ProxyParser = api;
})(typeof self !== "undefined" ? self : this);
