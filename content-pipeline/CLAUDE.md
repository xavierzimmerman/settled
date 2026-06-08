# Settled — Content / Ads Pipeline (CLAUDE.md)

This repo generates short-form marketing assets (TikTok / Reels / Shorts) for
**Settled**, the swipe-to-agree-on-a-restaurant app. It is meant to be run
repeatedly: each run emits a batch of ready-to-produce concepts and updates a
tracking log so we can learn what converts.

## What "good" looks like here
**The writing is the product.** Every script must:
- Open on CONFLICT in the first 1–2 seconds (no setup).
- Escalate the absurdity quickly.
- Land the app name as the punchline: **"…just Settled."**
- Use short, lip-sync-friendly dialogue (these become AI videos).

## How it works
`generate.py` runs the pipeline. Per concept it makes 4 LLM calls against the
**local DeepSeek model via Ollama** (`deepseek.py`), one per asset:
1. **script** → `prompts/script.txt`
2. **video prompt** (shot-by-shot, for the configured target) → `prompts/video.txt`
3. **image/thumbnail prompts** → `prompts/image.txt`
4. **ad copy** (hooks, caption w/ CTA + AI disclosure, hashtags) → `prompts/adcopy.txt`

Output lands in `output/batch-<timestamp>/concept-NN/` and `tracking/tracking.csv`
gets a new row per concept.

## Running it
```bash
# Requires Ollama running locally with the model pulled (deepseek-r1:14b).
python3 generate.py                  # uses config.json (default 3 concepts)
python3 generate.py --concepts 5     # more concepts
python3 generate.py --model qwen2.5-coder:14b   # swap model
python3 generate.py --mock           # no LLM — canned text, tests the plumbing
```

## Configuration — `config.json`
- `model`, `temperature`, `concepts_per_run`
- `brand`: name, tagline, **cta ("Get Settled")**, punchline, app_url
- `video.target`: `kling` | `veo` | `sora` (changes the video-prompt format)
- `video.aspect_ratio`, `video.duration_seconds`
- `compliance.ai_disclosure_label`: stamped into every caption

## Compliance (non-negotiable)
- **AI disclosure on every caption.** The ad-copy prompt forces the label in; the
  pipeline verifies it's present and flags `ai_disclosure_present=false` per concept.
  Also flip each platform's in-app "AI-generated" toggle when posting.
- **No-watermark / paid tiers:** the video prompt ends with a `NOTE_ON_TIER` line
  stating whether the chosen model needs a paid tier for a clean export. Read it
  before producing — that's the one place this workflow can start costing money.

## Tracking — measure installs/clicks, not vanity
`tracking/tracking.csv` (one row per concept) + a `tracking.json` inside each
concept folder hold the performance slots: `views, likes, shares, comments,
clicks, installs`. **Clicks and installs are the real signal.** After posting,
fill `posted_url` + `platform`, then update the metric columns. Use UTM params /
a per-concept link so clicks and installs are attributable.

## Conventions for editing
- Prompt wording lives in `prompts/*.txt` (placeholders in `{braces}`). Tune copy
  there, not in code.
- Keep `deepseek.py` provider-agnostic enough to swap the local model.
- `output/` and `tracking/tracking.csv` are generated artifacts.
