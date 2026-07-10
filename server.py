#!/usr/bin/env python3
"""
CPLD Web Viewer
===============
A standalone Flask server that does what the cpld-viewer VS Code extension does,
but in a browser — no VS Code required.

Replicates the extension pipeline:
  1. Reads an HTML file (local path or remote URL)
  2. Finds <link type="application/ld+json" rel="describedby" href="…"> elements
  3. Reads / fetches the linked JSON-LD files
  4. Embeds them as <script type="application/ld+json"> blocks
  5. Injects cpldviewer.js
  6. Returns the resulting page to the browser

Routes
------
  GET /                      → playground UI (paste & edit HTML/JSON-LD, live preview)
  GET /view?file=<path>      → render a local CP/LD document
  GET /view?url=<url>        → fetch & render a remote CP/LD document
  GET /media/…               → static assets  (cpldviewer.js, fonts, …)
  GET /browse?uri=<iri>      → linked-data proxy (CORS bypass for dereferencing IRIs)

Usage
-----
  python server.py                        # serves on http://127.0.0.1:5000/
  python server.py --port 8080            # custom port
  python server.py --doc-root /data/cpld  # restrict /view?file= to this directory
  python server.py --host 0.0.0.0         # listen on all interfaces (for deployment)
"""

import argparse
import logging
import os
import re
import sys
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

import requests
import yaml
from bs4 import BeautifulSoup
from flask import Flask, make_response, redirect, request
from flask_cors import CORS

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

ROOT = Path(__file__).parent.resolve()

app = Flask(
    __name__,
    static_folder=str(ROOT / "media"),
    static_url_path="/media",
)
CORS(app)

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = app.logger

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_config: dict = {}
_config_path = ROOT / "config.yml"
if _config_path.exists():
    try:
        _config = yaml.safe_load(_config_path.read_text()) or {}
    except Exception as e:
        log.warning(f"Could not load config.yml: {e}")

# The document root restricts which local files /view?file= can access.
# Set via --doc-root CLI flag or config.yml key "document_root".
DOCUMENT_ROOT: Path = Path(_config.get("document_root", ".")).resolve()

# ---------------------------------------------------------------------------
# Playground
# ---------------------------------------------------------------------------


_PLAYGROUND_HTML = ROOT / "playground" / "index.html"


@app.route("/")
@app.route("/playground/")
@app.route("/playground/index.html")
def playground():
    html = _PLAYGROUND_HTML.read_text(encoding="utf-8")
    return make_response(html, 200, {"Content-Type": "text/html; charset=utf-8"})


def _serve_playground_js(filename):
    path = (ROOT / "playground" / filename).resolve()
    if not str(path).startswith(str(ROOT / "playground")):
        return make_response("Forbidden", 403)
    if not path.exists():
        return make_response("Not found", 404)
    return make_response(path.read_text(encoding="utf-8"), 200,
                         {"Content-Type": "text/javascript; charset=utf-8"})


@app.route("/playground/validation.js")
def playground_validation_js():
    return _serve_playground_js("validation.js")


@app.route("/playground/comunica-browser.js")
def playground_comunica_js():
    return _serve_playground_js("comunica-browser.js")


@app.route("/playground/examples/<path:filename>")
def playground_example_file(filename):
    if not (filename.endswith(".html") or filename.endswith(".jsonld") or filename.endswith(".css")):
        return make_response("Forbidden", 403)
    path = (ROOT / "playground" / "examples" / filename).resolve()
    if not str(path).startswith(str(ROOT / "playground" / "examples")):
        return make_response("Forbidden", 403)
    if not path.exists():
        return make_response("Not found", 404)
    if filename.endswith(".html"):
        ct = "text/html; charset=utf-8"
    elif filename.endswith(".css"):
        ct = "text/css; charset=utf-8"
    else:
        ct = "application/ld+json"
    return make_response(path.read_text(encoding="utf-8"), 200, {"Content-Type": ct})


# ---------------------------------------------------------------------------
# Viewer
# ---------------------------------------------------------------------------


@app.route("/view")
def view():
    file_param = request.args.get("file")
    url_param  = request.args.get("url")

    if file_param:
        abs_path = (DOCUMENT_ROOT / file_param).resolve()

        # Path-traversal guard
        if not str(abs_path).startswith(str(DOCUMENT_ROOT)):
            return make_response("Forbidden: path escapes the document root.", 403)

        if not abs_path.exists():
            return make_response(f"Not found: {file_param}", 404)

        html     = abs_path.read_text(encoding="utf-8")
        base_dir = abs_path.parent
        base_url = None

    elif url_param:
        try:
            resp = requests.get(
                url_param, timeout=20,
                headers={"Accept": "text/html,application/xhtml+xml,*/*"},
            )
            resp.raise_for_status()
            html = resp.text
        except Exception as exc:
            return make_response(f"Could not fetch {url_param}:\n{exc}", 502)

        base_dir = None
        base_url = url_param

    else:
        return _usage_page()

    processed = _process_cpld(html, base_dir=base_dir, base_url=base_url)
    return make_response(processed, 200, {"Content-Type": "text/html; charset=utf-8"})


def _process_cpld(html: str, *, base_dir: Optional[Path], base_url: Optional[str]) -> str:
    """
    Replicate what getCPLDWebviewContent() does in the VS Code extension:
      - embed linked JSON-LD files as <script type="application/ld+json"> blocks
      - inject cpldviewer.js
      - inject the proxy meta tag so cpldviewer.js can dereference IRIs
    """
    soup = BeautifulSoup(html, "html.parser")

    # Ensure a <head> exists
    if soup.head is None:
        if soup.html is None:
            soup.append(soup.new_tag("html"))
        soup.html.insert(0, soup.new_tag("head"))

    # ── 1. Embed linked JSON-LD ──────────────────────────────────────────────
    links = soup.find_all(
        "link",
        type="application/ld+json",
        rel=lambda r: r and "describedby" in r,
    )
    for link in links:
        href = (link.get("href") or "").strip()
        if not href:
            continue

        jsonld_text = _load_jsonld(href, base_dir=base_dir, base_url=base_url)
        if jsonld_text:
            script = soup.new_tag("script", type="application/ld+json")
            script.string = jsonld_text
            soup.head.append(script)

    # ── 2. Inject cpldviewer.js (skip if already present) ───────────────────
    if not soup.head.find("script", src=lambda s: s and "cpldviewer" in s):
        soup.head.append(soup.new_tag("script", src="/media/js/cpldviewer.js"))

    # ── 3. Inject proxy meta tag ─────────────────────────────────────────────
    if not soup.head.find("meta", attrs={"name": "proxyURLprefix"}):
        soup.head.append(
            soup.new_tag("meta", attrs={"name": "proxyURLprefix", "url": "/browse?uri="})
        )

    return str(soup)


def _load_jsonld(href: str, *, base_dir: Optional[Path], base_url: Optional[str]) -> Optional[str]:
    """Return the text of a JSON-LD resource identified by href."""
    if href.startswith("http://") or href.startswith("https://"):
        try:
            r = requests.get(href, timeout=10)
            r.raise_for_status()
            return r.text
        except Exception as exc:
            log.warning(f"Could not fetch JSON-LD from {href}: {exc}")
            return None

    # Relative reference — resolve against base_dir (local) or base_url (remote)
    if base_dir is not None:
        path = (base_dir / href).resolve()
        try:
            return path.read_text(encoding="utf-8")
        except Exception as exc:
            log.warning(f"Could not read JSON-LD from {path}: {exc}")
            return None

    if base_url is not None:
        resolved = urljoin(base_url, href)
        try:
            r = requests.get(resolved, timeout=10)
            r.raise_for_status()
            return r.text
        except Exception as exc:
            log.warning(f"Could not fetch JSON-LD from {resolved}: {exc}")
            return None

    return None


# ---------------------------------------------------------------------------
# Linked-data proxy  (mirrors proxy/proxy.py, consolidated here)
# ---------------------------------------------------------------------------

try:
    import rfc3987 as _rfc3987
    _HAS_RFC3987 = True
except ImportError:
    _HAS_RFC3987 = False


@app.route("/browse", methods=["GET"])
def browse():
    iri = request.args.get("uri")
    if not iri:
        return make_response({"ERROR": "Missing uri parameter"}, 400)

    if _HAS_RFC3987 and _rfc3987.match(iri) is None:
        return make_response({"ERROR": f"Not a valid IRI: {iri}"}, 400)

    try:
        proxy_headers = {
            "Accept": request.headers.get(
                "Accept", "application/ld+json,text/turtle,application/n-quads,*/*"
            )
        }
        proxied = _do_proxy_request(iri, proxy_headers)
        response = make_response(proxied.content)
        response.headers["Content-Type"] = proxied.headers.get(
            "Content-Type", "application/json"
        )
        return response
    except Exception as exc:
        return make_response({"ERROR": str(exc)}, 502)


def _do_proxy_request(iri: str, headers: dict) -> requests.Response:
    for api in _config.get("apis", {}).values():
        match = re.match(api["regex"], iri)
        if match:
            token_resp = requests.post(
                api["token_url"], auth=(api["key"], api["secret"])
            )
            token_resp.raise_for_status()
            headers["Authorization"] = f"Bearer {token_resp.json()['access_token']}"
            return requests.get(api["api_url"] + match.group("id"), headers=headers)

    for rewrite in _config.get("rewrites", {}).values():
        match = re.match(rewrite["regex"], iri)
        if match:
            return requests.get(
                rewrite["rewrite_url_prefix"] + match.group("id"), headers=headers
            )

    return requests.get(iri, headers=headers)


# ---------------------------------------------------------------------------
# Usage page (shown when /view is called without parameters)
# ---------------------------------------------------------------------------


def _usage_page() -> str:
    return """<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>CPLD Viewer</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 60px auto; color: #333; }
  h1   { color: #FA6900; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
  pre  { background: #f4f4f4; padding: 14px; border-radius: 6px; overflow-x: auto; }
  a    { color: #FA6900; }
</style>
</head>
<body>
<h1>&#9674; CPLD Viewer</h1>
<p>Provide a <code>file</code> or <code>url</code> parameter:</p>
<pre>
/view?file=relative/path/to/document.html
/view?url=https://example.org/some-cpld-document.html
</pre>
<p>Or use the <a href="/">Playground</a> to paste and preview documents interactively.</p>
</body>
</html>
""", 400


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CPLD Web Viewer")
    parser.add_argument("--host",     default="127.0.0.1",  help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--port",     default=5000, type=int, help="Port (default: 5000)")
    parser.add_argument("--doc-root", default=None,          help="Root directory for local documents")
    parser.add_argument("--debug",    action="store_true",   help="Enable Flask debug mode")
    args = parser.parse_args()

    if args.doc_root:
        DOCUMENT_ROOT = Path(args.doc_root).resolve()

    log.info(f"Starting CPLD Web Viewer")
    log.info(f"  Playground : http://{args.host}:{args.port}/")
    log.info(f"  Viewer     : http://{args.host}:{args.port}/view?file=...")
    log.info(f"  Document root: {DOCUMENT_ROOT}")

    app.run(host=args.host, port=args.port, debug=args.debug)
