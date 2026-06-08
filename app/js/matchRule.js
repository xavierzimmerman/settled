// Shared match-rule logic. The SAME rule is reimplemented in the Python relay
// (server.py -> detect_match) so local and supabase backends agree. Keep them
// in sync if you change the semantics.
//
// matchRule shapes:
//   { type: "unanimous", minParticipants: 2 }
//       a restaurant matches when EVERY active participant swiped "yes" on it,
//       provided at least minParticipants are present.
//   { type: "threshold", count: 3 }
//       a restaurant matches as soon as `count` participants swiped "yes" on it.
//
// state: {
//   participants: [{ id }],
//   swipes: [{ participantId, restaurantId, dir }],   // dir: "yes" | "no"
// }
//
// Returns the matching restaurantId or null.
export function detectMatch(state, matchRule) {
  const rule = matchRule || { type: "unanimous", minParticipants: 2 };
  const yesByRestaurant = new Map(); // restaurantId -> Set(participantId)

  for (const s of state.swipes || []) {
    if (s.dir !== "yes") continue;
    if (!yesByRestaurant.has(s.restaurantId)) {
      yesByRestaurant.set(s.restaurantId, new Set());
    }
    yesByRestaurant.get(s.restaurantId).add(s.participantId);
  }

  if (rule.type === "threshold") {
    const need = rule.count || 2;
    for (const [restaurantId, voters] of yesByRestaurant) {
      if (voters.size >= need) return restaurantId;
    }
    return null;
  }

  // default: unanimous among active participants
  const active = (state.participants || []).map((p) => p.id);
  const minN = rule.minParticipants || 2;
  if (active.length < minN) return null;
  for (const [restaurantId, voters] of yesByRestaurant) {
    if (active.every((pid) => voters.has(pid))) return restaurantId;
  }
  return null;
}
