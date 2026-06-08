#!/usr/bin/env python3
"""Settled — local realtime relay + static server (Python stdlib only).

Zero external dependencies, zero cost. Enables true multi-browser testing on
localhost/LAN without Supabase or any cloud service. Run:

    python3 app/server.py            # serves http://localhost:8000

It serves the static app AND provides the realtime API the "local" backend talks
to: POST writes + Server-Sent Events for live push. Room state is in-memory and
ephemeral; validation events are appended to app/data/events.jsonl.

The match rule here MUST stay in sync with app/js/matchRule.js.
"""
import json
import os
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
EVENTS_LOG = os.path.join(DATA_DIR, "events.jsonl")
PORT = int(os.environ.get("PORT", "8000"))

# --- shared state ---------------------------------------------------------
LOCK = threading.Lock()
ROOMS = {}          # code -> room dict
EVENTS = []         # in-memory mirror of events.jsonl (for /api/events)


def _new_room(code, restaurants, match_rule):
    return {
        "code": code,
        "restaurants": restaurants,
        "matchRule": match_rule,
        "participants": {},          # id -> {"id","name"}
        "swipes": [],                # {participantId, restaurantId, dir}
        "matched": None,             # restaurantId once matched
        "subscribers": [],           # list[queue.Queue]
    }


def detect_match(room):
    """Mirror of app/js/matchRule.js detectMatch(). Returns restaurantId|None."""
    rule = room.get("matchRule") or {"type": "unanimous", "minParticipants": 2}
    yes_by = {}
    for s in room["swipes"]:
        if s["dir"] != "yes":
            continue
        yes_by.setdefault(s["restaurantId"], set()).add(s["participantId"])

    if rule.get("type") == "threshold":
        need = rule.get("count", 2)
        for rid, voters in yes_by.items():
            if len(voters) >= need:
                return rid
        return None

    active = list(room["participants"].keys())
    min_n = rule.get("minParticipants", 2)
    if len(active) < min_n:
        return None
    for rid, voters in yes_by.items():
        if all(pid in voters for pid in active):
            return rid
    return None


def broadcast(room, event):
    dead = []
    for q in room["subscribers"]:
        try:
            q.put_nowait(event)
        except Exception:
            dead.append(q)
    for q in dead:
        room["subscribers"].remove(q)


def state_payload(room):
    return {
        "restaurants": room["restaurants"],
        "matchRule": room["matchRule"],
        "participants": list(room["participants"].values()),
        "swipes": room["swipes"],
        "matched": room["matched"],
    }


def log_event(event):
    os.makedirs(DATA_DIR, exist_ok=True)
    with LOCK:
        EVENTS.append(event)
        with open(EVENTS_LOG, "a") as f:
            f.write(json.dumps(event) + "\n")


def _load_events():
    if not os.path.exists(EVENTS_LOG):
        return
    with open(EVENTS_LOG) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    EVENTS.append(json.loads(line))
                except json.JSONDecodeError:
                    pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass  # quiet

    # --- helpers ---
    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw or b"{}")

    # --- routing ---
    def do_GET(self):
        parsed = urlparse(self.path)
        path, qs = parsed.path, parse_qs(parsed.query)
        if path == "/api/state":
            return self.handle_state(qs)
        if path == "/api/stream":
            return self.handle_stream(qs)
        if path == "/api/events":
            with LOCK:
                return self._json(list(EVENTS))
        return self.serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self._read_json()
        except json.JSONDecodeError:
            return self._json({"error": "bad json"}, 400)
        if path == "/api/room":
            return self.handle_create(body)
        if path == "/api/join":
            return self.handle_join(body)
        if path == "/api/swipe":
            return self.handle_swipe(body)
        if path == "/api/event":
            log_event(body)
            return self._json({"ok": True})
        return self._json({"error": "not found"}, 404)

    # --- handlers ---
    def handle_create(self, body):
        code = body["code"].upper()
        with LOCK:
            room = _new_room(code, body["restaurants"], body.get("matchRule"))
            ROOMS[code] = room
            p = body.get("participant")
            if p:
                room["participants"][p["id"]] = {"id": p["id"], "name": p["name"]}
            payload = state_payload(room)
        return self._json(payload)

    def handle_join(self, body):
        code = body["code"].upper()
        with LOCK:
            room = ROOMS.get(code)
            if not room:
                return self._json({"error": "room not found"}, 404)
            p = body["participant"]
            room["participants"][p["id"]] = {"id": p["id"], "name": p["name"]}
            payload = state_payload(room)
            broadcast(room, {"type": "state", "state": payload})
        return self._json(payload)

    def handle_state(self, qs):
        code = (qs.get("code", [""])[0]).upper()
        with LOCK:
            room = ROOMS.get(code)
            if not room:
                return self._json({"error": "room not found"}, 404)
            return self._json(state_payload(room))

    def handle_swipe(self, body):
        code = body["code"].upper()
        with LOCK:
            room = ROOMS.get(code)
            if not room:
                return self._json({"error": "room not found"}, 404)
            room["swipes"].append({
                "participantId": body["participantId"],
                "restaurantId": body["restaurantId"],
                "dir": body["dir"],
            })
            broadcast(room, {"type": "state", "state": state_payload(room)})
            if not room["matched"]:
                matched_id = detect_match(room)
                if matched_id:
                    room["matched"] = matched_id
                    restaurant = next(
                        (r for r in room["restaurants"] if r.get("id") == matched_id),
                        {"id": matched_id},
                    )
                    broadcast(room, {"type": "match", "restaurant": restaurant})
        return self._json({"ok": True})

    def handle_stream(self, qs):
        code = (qs.get("code", [""])[0]).upper()
        with LOCK:
            room = ROOMS.get(code)
            if not room:
                return self._json({"error": "room not found"}, 404)
            q = queue.Queue()
            room["subscribers"].append(q)
            # Replay current state immediately so late joiners are caught up.
            q.put({"type": "state", "state": state_payload(room)})
            if room["matched"]:
                restaurant = next(
                    (r for r in room["restaurants"] if r.get("id") == room["matched"]), None
                )
                if restaurant:
                    q.put({"type": "match", "restaurant": restaurant})

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            while True:
                try:
                    event = q.get(timeout=15)
                    self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")  # keep-alive
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with LOCK:
                if q in room["subscribers"]:
                    room["subscribers"].remove(q)

    # --- static files ---
    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        # prevent path traversal
        safe = os.path.normpath(path).lstrip("/")
        full = os.path.join(ROOT, safe)
        if not full.startswith(ROOT) or not os.path.isfile(full):
            return self._json({"error": "not found"}, 404)
        ctype = {
            ".html": "text/html",
            ".css": "text/css",
            ".js": "text/javascript",
            ".json": "application/json",
            ".svg": "image/svg+xml",
        }.get(os.path.splitext(full)[1], "application/octet-stream")
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    _load_events()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Settled relay running:  http://localhost:{PORT}")
    print(f"  admin/events:         http://localhost:{PORT}/admin.html")
    print(f"  events log:           {EVENTS_LOG}")
    print("Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
