import { config, ensureSupabaseClient } from "./config.js";
import { getProvider } from "./providers/index.js";
import { getRealtime } from "./realtime/index.js";
import { createInstrumentation } from "./instrumentation.js";

// ---------------------------------------------------------------------------
// Anonymous session identity (no accounts). One identity per browser tab so you
// can test multiple participants by opening multiple tabs.
// ---------------------------------------------------------------------------
const ADJ = ["Hungry", "Picky", "Hangry", "Starving", "Peckish", "Ravenous"];
const ANIMAL = ["Otter", "Panda", "Fox", "Raccoon", "Penguin", "Llama"];
function makeIdentity() {
  let id = sessionStorage.getItem("settled_pid");
  let name = sessionStorage.getItem("settled_name");
  if (!id) {
    id = "p_" + Math.random().toString(36).slice(2, 10);
    name =
      ADJ[Math.floor(Math.random() * ADJ.length)] +
      " " +
      ANIMAL[Math.floor(Math.random() * ANIMAL.length)];
    sessionStorage.setItem("settled_pid", id);
    sessionStorage.setItem("settled_name", name);
  }
  return { id, name };
}

function genCode() {
  // Jackbox-style: 4 uppercase letters, no ambiguous chars.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let c = "";
  for (let i = 0; i < 4; i++)
    c += alphabet[Math.floor(Math.random() * alphabet.length)];
  return c;
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const me = makeIdentity();
let backend = null;
let instrument = null;
let unsubscribe = null;
let roomCode = null;
let isHost = false;
let restaurants = [];
let deckIndex = 0;
let matched = false;
let location = null; // { lat, lng, label }

const $ = (sel) => document.querySelector(sel);
const screens = {};
function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[name].classList.add("active");
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", async () => {
  ["home", "setup", "lobby", "swipe", "match", "done"].forEach(
    (n) => (screens[n] = $("#screen-" + n))
  );
  $("#my-name").textContent = me.name;
  await ensureSupabaseClient().catch((e) => console.warn("Supabase CDN load failed:", e));

  try {
    backend = getRealtime(config.realtime, config.realtime === "supabase" ? config.supabase : {});
  } catch (e) {
    document.body.innerHTML = `<div style="padding:2rem;color:red;font-family:sans-serif">
      <strong>Setup error:</strong> ${e.message}<br><br>
      Check your Supabase config in config.js and ensure the CDN loaded.
    </div>`;
    return;
  }

  // Deep-link join: ?room=CODE
  const params = new URLSearchParams(location?.search || window.location.search);
  const deep = params.get("room");
  if (deep) {
    $("#join-code").value = deep.toUpperCase();
  }

  wireHome();
  wireSetup();
  wireLobby();
  wireSwipe();
  wireMatch();
  showScreen("home");
});

// ---------------------------------------------------------------------------
// Home — host or join
// ---------------------------------------------------------------------------
function wireHome() {
  $("#btn-host").addEventListener("click", () => {
    isHost = true;
    showScreen("setup");
    $("#radius").value = config.defaultRadiusMeters;
    $("#radius-label").textContent = (config.defaultRadiusMeters / 1000).toFixed(1) + " km";
  });

  $("#btn-join").addEventListener("click", async () => {
    const code = $("#join-code").value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) {
      $("#join-error").textContent = "Enter a 4-letter room code.";
      return;
    }
    $("#join-error").textContent = "";
    try {
      await joinRoom(code);
    } catch (e) {
      $("#join-error").textContent = e.message || "Couldn't find that room. Check the code.";
      console.error(e);
    }
  });
}

// ---------------------------------------------------------------------------
// Setup (host) — location + radius, then create room
// ---------------------------------------------------------------------------
function wireSetup() {
  $("#radius").addEventListener("input", (e) => {
    $("#radius-label").textContent = (e.target.value / 1000).toFixed(1) + " km";
  });

  $("#btn-geo").addEventListener("click", () => {
    $("#setup-status").textContent = "Locating…";
    if (!navigator.geolocation) {
      $("#setup-status").textContent = "Geolocation unavailable — enter a location manually.";
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Current location" };
        $("#setup-status").textContent = `📍 Current location set (${location.lat.toFixed(3)}, ${location.lng.toFixed(3)})`;
      },
      () => {
        $("#setup-status").textContent = "Location permission denied — enter manually below.";
      }
    );
  });

  $("#btn-fallback").addEventListener("click", () => {
    const manual = $("#manual-location").value.trim();
    if (manual) {
      // Mock provider ignores coords; we just label it. (No geocoding API = no spend.)
      location = { ...config.fallbackLocation, label: manual };
    } else {
      location = { ...config.fallbackLocation };
    }
    $("#setup-status").textContent = `📍 Using ${location.label}`;
  });

  $("#btn-create").addEventListener("click", async () => {
    if (!location) location = { ...config.fallbackLocation };
    $("#btn-create").disabled = true;
    $("#setup-status").textContent = "Finding restaurants nearby (one cached search)…";
    try {
      const radiusMeters = Number($("#radius").value);
      const provider = getProvider(
        config.dataProvider,
        config.dataProvider === "google" ? config.google : {}
      );
      // ⬇️ THE ONLY data-provider call per room. Cached + served to everyone.
      restaurants = await provider.search({ lat: location.lat, lng: location.lng, radiusMeters });
      if (!restaurants.length) throw new Error("No restaurants returned");

      roomCode = genCode();
      const state = await backend.createRoom({
        code: roomCode,
        restaurants,
        matchRule: config.matchRule,
        participant: me,
      });
      // Only replace local restaurants if Supabase returned a non-empty list.
      if (state.restaurants && state.restaurants.length > 0) {
        restaurants = state.restaurants;
      }
      instrument = createInstrumentation(backend, roomCode);
      instrument.roomCreated({
        host: me.id,
        radiusMeters,
        location: location.label,
        provider: config.dataProvider,
        restaurantCount: restaurants.length,
      });
      enterRoom();
    } catch (e) {
      console.error(e);
      $("#setup-status").textContent = "Error creating room: " + e.message;
      $("#btn-create").disabled = false;
    }
  });
}

async function joinRoom(code) {
  const state = await backend.joinRoom({ code, participant: me });
  roomCode = code;
  isHost = false;
  restaurants = state.restaurants || [];
  if (!restaurants.length) throw new Error("Room has no restaurants");
  instrument = createInstrumentation(backend, code);
  instrument.participantJoined(me);
  enterRoom();
}

// ---------------------------------------------------------------------------
// Room — lobby + live subscription
// ---------------------------------------------------------------------------
function enterRoom() {
  $("#room-code-display").textContent = roomCode;
  $("#lobby-code").textContent = roomCode;
  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
  $("#share-url").value = shareUrl;
  showScreen("lobby");

  if (unsubscribe) unsubscribe();
  unsubscribe = backend.subscribe({ code: roomCode, onEvent });
  refreshState();
}

async function refreshState() {
  try {
    const state = await backend.getState({ code: roomCode });
    renderParticipants(state.participants || []);
  } catch (e) {
    console.warn(e);
  }
}

function onEvent(ev) {
  if (ev.type === "state" && ev.state) {
    renderParticipants(ev.state.participants || []);
  } else if (ev.type === "participant_joined") {
    refreshState();
  } else if (ev.type === "match") {
    showMatch(ev.restaurant);
  }
}

function renderParticipants(participants) {
  const list = $("#participant-list");
  list.innerHTML = "";
  participants.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.id === me.id ? " (you)" : "");
    list.appendChild(li);
  });
  $("#participant-count").textContent = participants.length;
}

function wireLobby() {
  $("#btn-copy-share").addEventListener("click", () => {
    $("#share-url").select();
    navigator.clipboard?.writeText($("#share-url").value).catch(() => {});
    $("#btn-copy-share").textContent = "Copied!";
    setTimeout(() => ($("#btn-copy-share").textContent = "Copy invite link"), 1500);
  });
  $("#btn-start-swiping").addEventListener("click", () => {
    deckIndex = 0;
    showScreen("swipe");
    renderCard();
  });
}

// ---------------------------------------------------------------------------
// Swiping deck
// ---------------------------------------------------------------------------
function wireSwipe() {
  $("#btn-no").addEventListener("click", () => doSwipe("no"));
  $("#btn-yes").addEventListener("click", () => doSwipe("yes"));
}

function renderCard() {
  const stack = $("#card-stack");
  stack.innerHTML = "";
  if (deckIndex >= restaurants.length) {
    showDone();
    return;
  }
  $("#deck-progress").textContent = `${deckIndex + 1} / ${restaurants.length}`;
  const r = restaurants[deckIndex];
  const card = document.createElement("div");
  card.className = "card";
  const price = r.priceLevel != null ? "$".repeat(Math.max(1, r.priceLevel)) : "";
  const rating = r.rating ? `★ ${r.rating}` : "";
  card.innerHTML = `
    <div class="card-photo">
      <img loading="lazy" src="${r.photoUrl || ""}" alt="${escapeHtml(r.name)}"
           onerror="this.style.display='none';this.parentElement.classList.add('no-photo')" />
    </div>
    <div class="card-body">
      <h2>${escapeHtml(r.name)}</h2>
      <p class="card-meta">${escapeHtml(r.cuisine || "")} ${price ? "· " + price : ""} ${rating ? "· " + rating : ""}</p>
      <p class="card-address">${escapeHtml(r.address || "")}</p>
    </div>
    <div class="card-stamp stamp-yes">YES</div>
    <div class="card-stamp stamp-no">NOPE</div>`;
  stack.appendChild(card);
  enableDrag(card);
}

let drag = null;
function enableDrag(card) {
  const start = (x) => (drag = { x0: x, dx: 0 });
  const move = (x) => {
    if (!drag) return;
    drag.dx = x - drag.x0;
    card.style.transform = `translateX(${drag.dx}px) rotate(${drag.dx / 20}deg)`;
    card.classList.toggle("show-yes", drag.dx > 40);
    card.classList.toggle("show-no", drag.dx < -40);
  };
  const end = () => {
    if (!drag) return;
    const dx = drag.dx;
    drag = null;
    if (dx > 100) return flyOut(card, "yes");
    if (dx < -100) return flyOut(card, "no");
    card.style.transform = "";
    card.classList.remove("show-yes", "show-no");
  };
  card.addEventListener("pointerdown", (e) => {
    card.setPointerCapture(e.pointerId);
    start(e.clientX);
  });
  card.addEventListener("pointermove", (e) => move(e.clientX));
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

function flyOut(card, dir) {
  card.style.transition = "transform .3s ease";
  card.style.transform = `translateX(${dir === "yes" ? 1000 : -1000}px) rotate(${dir === "yes" ? 30 : -30}deg)`;
  setTimeout(() => doSwipe(dir), 150);
}

async function doSwipe(dir) {
  if (matched || deckIndex >= restaurants.length) return;
  const r = restaurants[deckIndex];
  deckIndex++;
  instrument.swipe({ participantId: me.id, restaurantId: r.id, dir });
  backend
    .swipe({ code: roomCode, participantId: me.id, restaurantId: r.id, dir })
    .catch((e) => console.warn("swipe failed", e));
  renderCard();
}

function showDone() {
  $("#card-stack").innerHTML = "";
  showScreen("done");
}

// ---------------------------------------------------------------------------
// Match screen
// ---------------------------------------------------------------------------
function wireMatch() {
  $("#btn-book").addEventListener("click", () => {
    // STUB — future OpenTable affiliate link. No network call, no spend.
    alert("📅 Booking is a stub in this validator.\n(Future: OpenTable affiliate link.)");
  });
  $("#btn-newroom").addEventListener("click", () => window.location.reload());
}

function showMatch(restaurant) {
  if (matched) return;
  matched = true;
  if (restaurant) instrument.match(restaurant);
  $("#match-name").textContent = restaurant?.name || "It's a match!";
  $("#match-meta").textContent = [
    restaurant?.cuisine,
    restaurant?.priceLevel != null ? "$".repeat(Math.max(1, restaurant.priceLevel)) : "",
    restaurant?.rating ? "★ " + restaurant.rating : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const img = $("#match-photo");
  if (restaurant?.photoUrl) {
    img.src = restaurant.photoUrl;
    img.style.display = "";
  } else {
    img.style.display = "none";
  }
  showScreen("match");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
