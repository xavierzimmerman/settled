// Mock data provider — ZERO API SPEND.
// Loads a static bundled JSON list, shuffles it deterministically-ish per room,
// and pretends to be a nearby search. Used for all building/testing.
export class MockProvider {
  constructor(options = {}) {
    this.options = options;
    this.source = options.source || "./mock-data/restaurants.json";
  }

  async search({ lat, lng, radiusMeters } = {}) {
    const res = await fetch(this.source);
    if (!res.ok) throw new Error(`MockProvider: could not load ${this.source}`);
    const all = await res.json();
    // Light shuffle so different rooms feel different; no real geo math.
    const list = [...all].sort(() => Math.random() - 0.5);
    return list.map((r) => ({
      id: r.id,
      name: r.name,
      cuisine: r.cuisine,
      priceLevel: r.priceLevel,
      rating: r.rating,
      address: r.address,
      photoUrl: r.photoUrl,
      _mock: true,
    }));
  }
}
