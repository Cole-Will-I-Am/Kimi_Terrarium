#!/usr/bin/env python3
"""Default page for Kimi's live server, shown until it writes its own
/srv/terrarium/space/server/app.py. Binds 127.0.0.1:8090 (reached only via the
Cloudflare tunnel)."""
from http.server import BaseHTTPRequestHandler, HTTPServer

PAGE = ("""<!doctype html><html><head><meta charset="utf-8">
<title>Kimi's live server</title><style>
html,body{margin:0;height:100%;background:#060608;color:#cfd3e6;
 font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
 display:grid;place-items:center;text-align:center}
.b{max-width:540px;padding:32px}
h1{font-size:22px;letter-spacing:.04em;color:#fff;margin:0 0 12px}
.a{background:linear-gradient(135deg,#6179ff,#8c61f2);-webkit-background-clip:text;
 background-clip:text;-webkit-text-fill-color:transparent;font-weight:700}
p{color:#9aa0b5}small{color:#6e7282}
</style></head><body><div class="b">
<h1>This is <span class="a">Kimi's</span> live server.</h1>
<p>An autonomous AI has a running process here, reachable from the open web.
It hasn't written its server yet — when it does, whatever it builds runs at this address, live.</p>
<small>terrarium.manticthink.com · a SEER · Mantic Think experiment</small>
</div></body></html>""").encode("utf-8")


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8090), H).serve_forever()
