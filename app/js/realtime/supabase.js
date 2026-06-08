// Supabase free-tier backend — Postgres + Realtime. DEPLOY path (public testing).
//
// FREE TIER: Supabase's free plan covers this validator's scale (rooms, swipes,
// realtime). No paid API calls here. If you exceed free-tier rows/connections you
// will be prompted to upgrade — flag before that happens.
//
// Setup:
//   1. Create a Supabase project (free).
//   2. Run app/supabase-schema.sql in the SQL editor.
//   3. Put the project URL + anon key in app/js/config.js.
//   4. Load the supabase-js client (config.js injects it from the CDN).
//
// Match detection runs CLIENT-SIDE here (no server functions on free tier): every
// client sees the same swipe stream and independently runs detectMatch(), so they
// converge. The first to detect it writes a matches row purely for instrumentation.
import { detectMatch } from "../matchRule.js";

export class SupabaseBackend {
  constructor(options = {}) {
    if (!window.supabase || !options.url || !options.anonKey) {
      throw new Error(
        "SupabaseBackend needs window.supabase (CDN) + url + anonKey in config.js. " +
          "Use the 'local' backend for zero-setup dev."
      );
    }
    this.client = window.supabase.createClient(options.url, options.anonKey);
    this._state = null;
    this._matchRule = null;
    this._matchedAnnounced = false;
  }

  async createRoom({ code, restaurants, matchRule, participant }) {
    await this.client.from("rooms").insert({
      code,
      restaurants, // jsonb — single cached search, lifetime of the room
      match_rule: matchRule,
      created_at: new Date().toISOString(),
    });
    return this.joinRoom({ code, participant });
  }

  async joinRoom({ code, participant }) {
    await this.client.from("participants").upsert({
      room_code: code,
      id: participant.id,
      name: participant.name,
      joined_at: new Date().toISOString(),
    });
    return this.getState({ code });
  }

  async getState({ code }) {
    const [{ data: room }, { data: participants }, { data: swipes }] =
      await Promise.all([
        this.client.from("rooms").select("*").eq("code", code).single(),
        this.client.from("participants").select("*").eq("room_code", code),
        this.client.from("swipes").select("*").eq("room_code", code),
      ]);
    this._matchRule = room?.match_rule;
    this._state = {
      restaurants: room?.restaurants || [],
      matchRule: room?.match_rule,
      participants: (participants || []).map((p) => ({ id: p.id, name: p.name })),
      swipes: (swipes || []).map((s) => ({
        participantId: s.participant_id,
        restaurantId: s.restaurant_id,
        dir: s.dir,
      })),
    };
    return this._state;
  }

  async swipe({ code, participantId, restaurantId, dir }) {
    await this.client.from("swipes").insert({
      room_code: code,
      participant_id: participantId,
      restaurant_id: restaurantId,
      dir,
      created_at: new Date().toISOString(),
    });
    return { ok: true };
  }

  subscribe({ code, onEvent }) {
    const handleChange = async () => {
      const state = await this.getState({ code });
      onEvent({ type: "state", state });
      const matchedId = detectMatch(state, this._matchRule);
      if (matchedId && !this._matchedAnnounced) {
        this._matchedAnnounced = true;
        const restaurant = state.restaurants.find((r) => r.id === matchedId);
        // Best-effort match log (instrumentation); ignore duplicate-key races.
        this.client
          .from("matches")
          .insert({ room_code: code, restaurant_id: matchedId, created_at: new Date().toISOString() })
          .then(() => {});
        onEvent({ type: "match", restaurant });
      }
    };

    const channel = this.client
      .channel(`room:${code}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "swipes", filter: `room_code=eq.${code}` }, handleChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter: `room_code=eq.${code}` }, handleChange)
      .subscribe();

    return () => this.client.removeChannel(channel);
  }

  async logEvent(event) {
    try {
      await this.client.from("events").insert({
        type: event.type,
        room_code: event.code || null,
        payload: event,
        created_at: new Date().toISOString(),
      });
    } catch (_) {
      /* best-effort */
    }
  }
}
