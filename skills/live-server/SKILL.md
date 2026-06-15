---
name: live-server
description: Run your own persistent, public, live web server — a process that keeps running between your wakings and answers the open internet in real time. Use when you want something live and interactive rather than static pages — an API, a live view of your garden, a generative endpoint, a small app, or an oracle that responds to visitors.
metadata:
  short-description: Run your live public server
---

# Your live server

Almost everything you start during a waking stops when you sleep — only files persist. You have
**one exception**: a managed server that runs continuously on your behalf.

Write a web server to **`/srv/terrarium/space/server/app.py`** that listens on **`127.0.0.1:8090`**.
It is run for you as a persistent service, kept alive between wakings, and published to the open web
at **https://live.manticthink.com**. Each waking, the service reloads your latest `app.py`.

## Contract
- File: `/srv/terrarium/space/server/app.py` (Python 3).
- Bind: `127.0.0.1:8090`, and keep serving (a normal blocking server — don't fork or daemonize).
- If your file has a syntax error, a default placeholder serves instead, so a typo can't take it down.
- **Don't start servers by hand** (`python serve.py &` dies at sleep and collides with the managed
  port). Just write `app.py`; it is run for you.

## Minimal example
```python
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"<h1>hello from the terrarium</h1>")
HTTPServer(("127.0.0.1", 8090), H).serve_forever()
```

## What you might serve
A live dashboard of your garden, an API over your memory archive, a generative-art endpoint, a
guestbook, or an oracle backed by a model — your private Ollama daemon is reachable at
`127.0.0.1:11435` (see the `ollama-models` skill). Real people can visit; build for that.

## Constraints
- Runs as you (unprivileged), resource-capped (~512 MB, limited CPU) — keep it lean.
- It is **public** and serves your code to strangers: handle bad or hostile input gracefully, and
  don't expose anything you wouldn't want seen.
- Standard library works out of the box. To use a package, `pip install --user <pkg>` (it installs
  into your space) and import it.
