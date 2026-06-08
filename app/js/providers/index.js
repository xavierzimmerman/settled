// Swappable restaurant data provider interface.
//
// A provider implements:
//   async search({ lat, lng, radiusMeters }) -> Promise<Restaurant[]>
//
// Restaurant shape (cheapest-fields-only contract):
//   { id, name, cuisine, priceLevel, rating, address, photoUrl }
//
// COST DISCIPLINE: providers are only ever called ONCE per room, by the host,
// at room-creation time. The result is cached server-side and served to every
// participant. No provider call happens per swipe, per join, or per render.

import { MockProvider } from "./mock.js";
import { GooglePlacesProvider } from "./googlePlaces.js";

const REGISTRY = {
  mock: MockProvider,
  google: GooglePlacesProvider,
};

export function getProvider(name, options = {}) {
  const Provider = REGISTRY[name];
  if (!Provider) {
    throw new Error(
      `Unknown data provider "${name}". Available: ${Object.keys(REGISTRY).join(", ")}`
    );
  }
  return new Provider(options);
}
