// Local realtime backend — talks to the Python stdlib relay (server.py).
// Transport: plain POST for writes, Server-Sent Events (EventSource) for the
// live stream. Zero external services, zero cost, works across browsers/devices
// on the same machine or LAN.
export class LocalBackend {
  constructor(options = {}) {
    // Same-origin by default (the relay serves the app), overridable for LAN.
    this.base = options.base || "";
  }

  async _post(path, body) {
    const res = await fetch(this.base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async createRoom({ code, restaurants, matchRule, participant }) {
    return this._post("/api/room", { code, restaurants, matchRule, participant });
  }

  async joinRoom({ code, participant }) {
    return this._post("/api/join", { code, participant });
  }

  async getState({ code }) {
    const res = await fetch(`${this.base}/api/state?code=${encodeURIComponent(code)}`);
    if (!res.ok) throw new Error(`getState -> ${res.status}`);
    return res.json();
  }

  async swipe({ code, participantId, restaurantId, dir }) {
    return this._post("/api/swipe", { code, participantId, restaurantId, dir });
  }

  subscribe({ code, onEvent }) {
    const url = `${this.base}/api/stream?code=${encodeURIComponent(code)}`;
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch (_) {
        /* ignore keep-alive pings */
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; surface for debugging only.
      console.warn("SSE connection hiccup, auto-reconnecting…");
    };
    return () => es.close();
  }

  async logEvent(event) {
    try {
      await this._post("/api/event", event);
    } catch (_) {
      /* instrumentation is best-effort; never block the UX */
    }
  }
}
