#!/usr/bin/env python3
"""Loopback dev server, for running the looper on the computer the mixer is
plugged into and an iPad on the same Wi-Fi.

Serves the whole site (Loopback loads graphics/app/firebase.js from outside its
own folder) on every interface, plus one small endpoint:

    GET  /loopback/station  ->  {"room": "<pairing room or null>", "lan": "<address for the iPad>"}
    POST /loopback/station  body {"room": "<room>"}, or {"room": null, "was": "<room>"}
                            to clear it if it's still that one; from this computer only

The station page (opened at localhost) posts its pairing room whenever iPad
pairing is on. A browser that opens the computer's address and can't record
there, like an iPad, asks for the room and becomes the remote, so typing
http://<computer>:8931/loopback/ on the iPad is enough.

Note this is a LAN dev server with no auth: while it's running, anything on
your Wi-Fi can read the site's files and get the pairing room, which grants
control of the looper. Don't run it on untrusted networks.

    python3 loopback/serve.py [port]      # default 8931, or $PORT
"""
import json
import os
import re
import socket
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

SITE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOM_RE = re.compile(r"^[a-z0-9]{8,40}$")   # same as validRoom() in js/link.js
LOCAL_CLIENTS = {"127.0.0.1", "::1"}

station = {"room": None}


def lan_host():
    """A name the iPad can reach this computer by: its Bonjour name, which
    survives the router handing out a new IP, else its Wi-Fi address."""
    name = socket.gethostname()
    if name.endswith(".local"):
        return name
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))   # picks the outgoing interface; sends nothing
            return s.getsockname()[0]
    except OSError:
        return name


def lan_url(port):
    return "http://%s:%d/loopback/" % (lan_host(), port)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=SITE_DIR, **kw)

    def end_headers(self):
        # the iPad caches aggressively; never serve a stale module mid-session
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, *a):
        pass

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def info(self):
        return {"room": station["room"], "lan": lan_url(self.server.server_address[1])}

    def do_GET(self):
        if self.path.split("?")[0] == "/loopback/station":
            return self.send_json(self.info())
        super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/loopback/station":
            return self.send_error(404, "no such endpoint")
        if self.client_address[0] not in LOCAL_CLIENTS:
            return self.send_error(403, "only the station can set the room")
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(min(n, 1024)) or b"{}")
            room = body.get("room")
        except (ValueError, AttributeError):
            return self.send_error(400, "body must be JSON like {\"room\": ...}")
        if room is not None and not (isinstance(room, str) and ROOM_RE.match(room)):
            return self.send_error(400, "not a pairing room")
        # a station turning pairing off only clears its own room, not another's
        if room is not None or body.get("was") in (None, station["room"]):
            station["room"] = room
        self.send_json(self.info())


if __name__ == "__main__":
    port = int(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PORT", 8931))
    with ThreadingHTTPServer(("", port), Handler) as httpd:
        print("Loopback on http://localhost:%d/loopback/ (iPad: %s)" % (port, lan_url(port)), flush=True)
        httpd.serve_forever()
