// Settled — runtime configuration. Edit here to switch modes; no build step.
export const config = {
  // --- DATA PROVIDER (restaurant source) -----------------------------------
  // "mock"   -> bundled JSON, ZERO API spend. Default for all dev/testing.
  // "google" -> Google Places (BILLABLE + caching ToS constraints). Requires key.
  dataProvider: "google",
  google: {
    apiKey: "AIzaSyApB9L2DRQvDjArGMIHN4o-Pd5TIOt__nQ", // referrer-restricted; safe to expose
    maxResults: 12,
  },

  // --- REALTIME / PERSISTENCE BACKEND --------------------------------------
  // "local"    -> Python relay (server.py). Zero cost, multi-browser on LAN.
  // "supabase" -> Supabase free tier. Use for public deploy.
  realtime: "supabase",
  supabase: {
    url: "https://gptziklzkwfgsdxoxhxv.supabase.co",
    anonKey: "sb_publishable_RiKOtAEVRI1zByPUwqo-oQ_D7qpdxaU",
  },

  // --- MATCH RULE (shared with server.py detect_match) ---------------------
  // { type: "unanimous", minParticipants: 2 } | { type: "threshold", count: N }
  matchRule: { type: "unanimous", minParticipants: 2 },

  // --- LOCATION DEFAULTS ----------------------------------------------------
  defaultRadiusMeters: 2000,
  fallbackLocation: { lat: 37.7749, lng: -122.4194, label: "San Francisco, CA" },
};

// Lazily inject the supabase-js CDN client only when actually selected, so the
// mock/local path ships zero third-party JS.
export async function ensureSupabaseClient() {
  if (config.realtime !== "supabase") return;
  if (window.supabase) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load supabase-js from CDN"));
    document.head.appendChild(s);
  });
}
