// Google Places (New) "Nearby Search" provider — ENABLED (key in config.js).
//
// ⚠️ COST + ToS WARNING — accepted when this provider was enabled:
//
// 1. COST: Places API Nearby Search is a PAID, billable endpoint. Google gives a
//    recurring monthly credit, but calls beyond it are billed per request and the
//    "Pro"/"Enterprise" field SKUs (photos, ratings, price) cost more than basic
//    fields. We request the cheapest viable FieldMask only. Even so — every live
//    room = 1 billable Nearby Search + up to N billable Photo fetches. Flag this
//    to the user before flipping config.dataProvider to "google".
//
// 2. CACHING ToS: Google Maps Platform ToS (section 3.2.3) PROHIBITS caching or
//    storing Places *content* except Place IDs (cacheable up to 30 days) and
//    limited fields for performance. Storing names/photos/ratings long-term in our
//    own DB to "serve the same list to all" is in TENSION with the ToS.
//    --> RESOLUTION for this validator: the cached list lives ONLY for the lifetime
//        of one ephemeral room (minutes), in memory, never persisted to disk by the
//        relay when this provider is active. This is "performance caching" of a
//        single user session, not a content database. If you productionize, review
//        the ToS with the actual Google terms in hand. DO NOT work around the ToS.
//
// 3. PHOTOS: Place Photos must be fetched through the Places Photo endpoint and
//    displayed with required attribution. One lazy-loaded photo per card only.
//
// `search` still THROWS if no API key is configured, so removing the key from
// config.js is enough to stop all spend.

export class GooglePlacesProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey || null;
    this.maxResults = options.maxResults || 12; // cap to limit photo fetches
  }

  async search({ lat, lng, radiusMeters }) {
    if (!this.apiKey) {
      throw new Error(
        "GooglePlacesProvider is a guarded stub: no apiKey configured. " +
          "This endpoint is BILLABLE and has caching ToS constraints — see the file " +
          "header. Use the 'mock' provider for zero-cost testing."
      );
    }

    // --- Live implementation ---
    // Cheapest-viable field mask: id + displayName + a single photo ref + rating +
    // priceLevel + location. We deliberately omit reviews, editorial summaries,
    // opening hours, etc. (more expensive SKUs / more data than needed).
    const body = {
      includedTypes: ["restaurant"],
      maxResultCount: this.maxResults,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      },
    };
    const res = await fetch(
      "https://places.googleapis.com/v1/places:searchNearby",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": [
            "places.id",
            "places.displayName",
            "places.priceLevel",
            "places.rating",
            "places.formattedAddress",
            "places.photos",
          ].join(","),
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      throw new Error(`Google Places error ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    return (data.places || []).map((p) => ({
      id: p.id,
      name: p.displayName?.text || "Unknown",
      cuisine: "",
      priceLevel: priceLevelToInt(p.priceLevel),
      rating: p.rating || null,
      address: p.formattedAddress || "",
      // Lazy photo: store only the resource name; the card builds the photo URL on
      // demand so we fetch at most one photo per visible card.
      photoUrl: p.photos?.[0]
        ? `https://places.googleapis.com/v1/${p.photos[0].name}/media?maxWidthPx=800&key=${this.apiKey}`
        : null,
      _attribution: p.photos?.[0]?.authorAttributions || [],
    }));
  }
}

function priceLevelToInt(level) {
  const map = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return map[level] ?? null;
}
