// Swappable realtime + persistence backend.
//
// A backend implements the room lifecycle used by app.js:
//   async createRoom({ code, restaurants, matchRule, participant })
//   async joinRoom({ code, participant })
//   async getState({ code })
//   async swipe({ code, participantId, restaurantId, dir })
//   subscribe({ code, onEvent })  -> () => void  (unsubscribe)
//   async logEvent(event)         -> instrumentation (best-effort)
//
// Two implementations:
//   "local"    -> tiny Python stdlib relay (server.py). Zero external cost,
//                 works across multiple browsers on localhost/LAN. Default for dev.
//   "supabase" -> Supabase free tier (Postgres + Realtime). Use for public deploy.
import { LocalBackend } from "./local.js";
import { SupabaseBackend } from "./supabase.js";

const REGISTRY = {
  local: LocalBackend,
  supabase: SupabaseBackend,
};

export function getRealtime(name, options = {}) {
  const Backend = REGISTRY[name];
  if (!Backend) {
    throw new Error(
      `Unknown realtime backend "${name}". Available: ${Object.keys(REGISTRY).join(", ")}`
    );
  }
  return new Backend(options);
}
