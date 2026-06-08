# Settled

> Can't agree on where to eat? Swipe together, match instantly. **…just Settled.**

A **throwaway validator** for a swipe-to-match-on-a-restaurant app, plus a
**content pipeline** to drive traffic to it. Built to answer "do people actually
like this?" for **near $0** before building anything polished.

This repo has two independent workstreams:

| | Workstream A — MVP web validator | Workstream B — Content pipeline |
|---|---|---|
| **What** | Mobile-first web app: host opens a room, others join by code, everyone swipes the same cached restaurant list, a match broadcasts in real time. | Repeatable generator for TikTok/Reels/Shorts ad concepts (scripts, video prompts, image prompts, ad copy). |
| **Where** | [`app/`](app/) | [`content-pipeline/`](content-pipeline/) |
| **Cost** | $0 in mock mode; ≤1 restaurant search per live room. | $0 — uses a **local DeepSeek** model. |
| **Stack** | Vanilla JS (no build) + Python stdlib relay; Supabase free tier for deploy. | Python stdlib + Ollama. |

---

## Workstream A — run it (zero setup, zero cost)

No Node, no build step. Just Python 3.

```bash
python3 app/server.py          # serves http://localhost:8000
```

Then:
1. Open `http://localhost:8000` → **Start a room** → set location → **Create room**.
2. Open the invite link (or the code) in a **second browser / phone on your LAN** → **Join**.
3. Both **Start swiping**. The instant everyone likes the same place, a **match**
   screen pops up in real time for everyone.
4. See logged validation events at `http://localhost:8000/admin.html`.

### How it stays cheap
- **Mock data by default** (`app/mock-data/restaurants.json`) — zero API spend.
- The restaurant data provider is **swappable** (`app/js/providers/`) and is called
  **once per room** (by the host, at creation), then cached + served to everyone.
  Never per-swipe.
- The real provider ([Google Places](app/js/providers/googlePlaces.js)) is a
  **guarded stub**: it throws unless you add a key, and its header documents the
  **billing + caching-ToS** constraints. Flip `config.dataProvider` to `"google"`
  only after accepting those.
- One lazy-loaded photo per card.

### Realtime backends (swappable)
- **`local`** (default) — the Python relay (`app/server.py`): SSE + POST, works
  across browsers on your machine/LAN, **zero cost**, no signup.
- **`supabase`** — Supabase **free tier** for public deploy. Run
  [`app/supabase-schema.sql`](app/supabase-schema.sql), then put your URL + anon
  key in [`app/js/config.js`](app/js/config.js).

### Config
Everything is in [`app/js/config.js`](app/js/config.js): data provider, realtime
backend, **match rule** (default: unanimous among everyone present, min 2), radius.

### Before public traffic
- ⚠️ Complete [`app/privacy.html`](app/privacy.html) — it's a **placeholder**
  (the app collects approximate location).
- ⚠️ Tighten Supabase RLS policies (the schema ships permissive for prototyping).

### Acceptance ✅
- Two browsers join one room by code and both see the match the instant they agree.
- Zero paid API calls in mock mode; ≤1 search request per live room.
- Validation events (rooms, participants, swipes, matches, time-to-match) logged
  to `app/data/events.jsonl` and viewable at `/admin.html`.

---

## Workstream B — run it

See [`content-pipeline/README.md`](content-pipeline/README.md) and
[`content-pipeline/CLAUDE.md`](content-pipeline/CLAUDE.md).

```bash
cd content-pipeline
python3 generate.py            # one batch of concepts via local DeepSeek
python3 generate.py --mock     # test the plumbing with no LLM
```

---

## Guiding principle
Build A so cheaply it can be thrown away. Validate first; spend later.
