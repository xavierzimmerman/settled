// Lightweight validation instrumentation. Every event is forwarded to the active
// realtime backend's logEvent() (relay -> events.jsonl, or supabase -> events
// table) AND mirrored to the console for quick local inspection.
//
// Tracked events (the validation questions we care about):
//   room_created, participant_joined, swipe, match, time_to_match
export function createInstrumentation(backend, code) {
  const roomStart = Date.now();
  let firstSwipeAt = null;

  function emit(type, payload = {}) {
    const event = { type, code, ts: Date.now(), ...payload };
    if (type === "swipe" && firstSwipeAt === null) firstSwipeAt = event.ts;
    // eslint-disable-next-line no-console
    console.debug("[instrument]", type, event);
    backend.logEvent(event);
  }

  return {
    roomCreated: (meta) => emit("room_created", meta),
    participantJoined: (p) => emit("participant_joined", { participant: p }),
    swipe: (s) => emit("swipe", s),
    match: (restaurant) =>
      emit("match", {
        restaurantId: restaurant?.id,
        restaurantName: restaurant?.name,
        timeToMatchMs: Date.now() - roomStart,
        timeFromFirstSwipeMs: firstSwipeAt ? Date.now() - firstSwipeAt : null,
      }),
  };
}
