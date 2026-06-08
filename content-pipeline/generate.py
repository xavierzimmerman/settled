#!/usr/bin/env python3
"""Settled content pipeline — one run produces a batch of marketing assets.

Per concept it generates, using the LOCAL DeepSeek model (Ollama):
  1. a comedic "can't agree where to eat" script (conflict in 1-2s -> "...just Settled")
  2. a shot-by-shot VIDEO prompt for the configured target (kling/veo/sora)
  3. thumbnail/ad IMAGE prompts
  4. ad COPY (hooks, caption w/ CTA + AI-disclosure, hashtags)
Then it writes everything into organized files and updates the tracking log.

Usage:
  python3 generate.py                  # full run via DeepSeek (config-driven)
  python3 generate.py --concepts 2     # override count
  python3 generate.py --model qwen2.5-coder:14b
  python3 generate.py --mock           # no LLM; canned text, tests the plumbing

Acceptance: a single run yields scripts + video prompts + image prompts + ad copy
in organized files, plus an updated tracking file.
"""
import argparse
import csv
import datetime as dt
import json
import os
import random
import sys

import deepseek

HERE = os.path.dirname(os.path.abspath(__file__))
PROMPTS_DIR = os.path.join(HERE, "prompts")
OUTPUT_DIR = os.path.join(HERE, "output")
TRACKING_DIR = os.path.join(HERE, "tracking")
TRACKING_CSV = os.path.join(TRACKING_DIR, "tracking.csv")

# Comedic seed angles so concepts in a batch don't collide.
ANGLES = [
    "a couple has been 'deciding' for 45 minutes and are now starving and feral",
    "a group chat where everyone says 'I don't care, you pick' but vetoes everything",
    "roommates negotiating dinner like it's a UN peace summit",
    "a first date derailed because neither will admit what they actually want",
    "friends driving in circles while every restaurant 'looks closed'",
    "family dinner where grandma vetoes everything that isn't her recipe",
    "coworkers on lunch break burning the entire hour on the decision",
    "two people 'compromising' into a gas station instead of choosing",
    "someone suggests the same place every single time and gets shut down",
    "a hangry meltdown escalating to threats over tacos vs sushi",
]


def load_config():
    with open(os.path.join(HERE, "config.json")) as f:
        return json.load(f)


def load_prompt(name):
    with open(os.path.join(PROMPTS_DIR, name)) as f:
        return f.read()


def call(prompt, cfg, args, kind):
    if args.mock:
        return _mock_response(kind, cfg)
    return deepseek.generate(prompt, model=args.model or cfg["model"],
                             temperature=cfg.get("temperature", 0.9))


def extract(text, label):
    """Pull a single-line labeled field, e.g. extract(text, 'TITLE').

    Tolerant of markdown the model adds, e.g. '**TITLE:** **Lunch Hour Dilemma**'.
    """
    for line in text.splitlines():
        # strip markdown emphasis/heading chars before matching
        clean = line.strip().lstrip("#").replace("*", "").strip()
        if clean.upper().startswith(label.upper() + ":"):
            return clean.split(":", 1)[1].strip()
    return ""


def generate_concept(idx, cfg, args, batch_dir, batch_id):
    angle = random.choice(ANGLES)
    b = cfg["brand"]
    v = cfg["video"]
    disclosure = cfg["compliance"]["ai_disclosure_label"]

    print(f"  [concept {idx:02d}] angle: {angle[:50]}…")

    # 1. Script
    script = call(load_prompt("script.txt").format(
        brand_name=b["name"], tagline=b["tagline"], punchline=b["punchline"],
        duration=v["duration_seconds"], angle=angle), cfg, args, "script")

    # 2. Video prompt (depends on script)
    print("           → video prompt")
    video = call(load_prompt("video.txt").format(
        video_target=v["target"], aspect_ratio=v["aspect_ratio"],
        duration=v["duration_seconds"], script=script), cfg, args, "video")

    # 3. Image prompts
    print("           → image prompts")
    image = call(load_prompt("image.txt").format(
        brand_name=b["name"], aspect_ratio=v["aspect_ratio"], script=script),
        cfg, args, "image")

    # 4. Ad copy
    print("           → ad copy")
    adcopy = call(load_prompt("adcopy.txt").format(
        brand_name=b["name"], tagline=b["tagline"], cta=b["cta"],
        app_url=b["app_url"], disclosure=disclosure, script=script),
        cfg, args, "adcopy")

    # --- write organized files ---
    cdir = os.path.join(batch_dir, f"concept-{idx:02d}")
    os.makedirs(cdir, exist_ok=True)
    _write(os.path.join(cdir, "script.txt"), script)
    _write(os.path.join(cdir, "video-prompt.txt"), video)
    _write(os.path.join(cdir, "image-prompts.txt"), image)
    _write(os.path.join(cdir, "ad-copy.txt"), adcopy)

    title = extract(script, "TITLE") or f"Concept {idx}"
    hashtags = extract(adcopy, "HASHTAGS")
    disclosure_ok = disclosure.lower() in adcopy.lower()

    concept_meta = {
        "batch_id": batch_id,
        "concept_id": f"{batch_id}-{idx:02d}",
        "title": title,
        "angle": angle,
        "video_target": v["target"],
        "created_at": dt.datetime.now().isoformat(timespec="seconds"),
        "ai_disclosure_present": disclosure_ok,
        "hashtags": hashtags,
        "files": ["script.txt", "video-prompt.txt", "image-prompts.txt", "ad-copy.txt"],
        # performance slots — fill these after posting:
        "performance": {
            "posted_url": "", "platform": "", "views": "", "likes": "",
            "shares": "", "comments": "", "clicks": "", "installs": "",
        },
    }
    _write(os.path.join(cdir, "tracking.json"), json.dumps(concept_meta, indent=2))

    if not disclosure_ok:
        print(f"           ⚠️  AI-disclosure label missing in ad copy — review {cdir}/ad-copy.txt")
    return concept_meta


def update_tracking_csv(concepts):
    os.makedirs(TRACKING_DIR, exist_ok=True)
    fields = ["concept_id", "batch_id", "title", "angle", "video_target",
              "created_at", "ai_disclosure_present", "platform", "posted_url",
              "views", "likes", "shares", "comments", "clicks", "installs", "notes"]
    exists = os.path.exists(TRACKING_CSV)
    with open(TRACKING_CSV, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        if not exists:
            w.writeheader()
        for c in concepts:
            p = c["performance"]
            w.writerow({
                "concept_id": c["concept_id"], "batch_id": c["batch_id"],
                "title": c["title"], "angle": c["angle"],
                "video_target": c["video_target"], "created_at": c["created_at"],
                "ai_disclosure_present": c["ai_disclosure_present"],
                "platform": p["platform"], "posted_url": p["posted_url"],
                "views": p["views"], "likes": p["likes"], "shares": p["shares"],
                "comments": p["comments"], "clicks": p["clicks"],
                "installs": p["installs"], "notes": "",
            })


def _write(path, text):
    with open(path, "w") as f:
        f.write(text.rstrip() + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--concepts", type=int, default=None)
    ap.add_argument("--model", default=None)
    ap.add_argument("--mock", action="store_true", help="no LLM; canned text")
    args = ap.parse_args()

    cfg = load_config()
    n = args.concepts or cfg["concepts_per_run"]
    model = args.model or cfg["model"]

    if not args.mock and not deepseek.ping(model):
        print(f"❌ Model '{model}' not reachable via Ollama. Run `ollama list`, or use "
              f"--mock to test the pipeline without an LLM.", file=sys.stderr)
        sys.exit(1)

    batch_id = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    batch_dir = os.path.join(OUTPUT_DIR, f"batch-{batch_id}")
    os.makedirs(batch_dir, exist_ok=True)

    mode = "MOCK (no LLM)" if args.mock else f"DeepSeek '{model}'"
    print(f"Settled content pipeline — {mode}\nBatch {batch_id}: generating {n} concept(s)…")

    concepts = [generate_concept(i + 1, cfg, args, batch_dir, batch_id) for i in range(n)]
    _write(os.path.join(batch_dir, "batch.json"), json.dumps({
        "batch_id": batch_id, "model": "mock" if args.mock else model,
        "count": len(concepts), "concepts": concepts,
    }, indent=2))
    update_tracking_csv(concepts)

    print(f"\n✅ Done. {len(concepts)} concept(s) in {batch_dir}")
    print(f"   Tracking updated: {TRACKING_CSV}")
    missing = [c["concept_id"] for c in concepts if not c["ai_disclosure_present"]]
    if missing:
        print(f"   ⚠️ Review AI-disclosure for: {', '.join(missing)}")


# --- mock content so the pipeline can be exercised with zero LLM cost/time ---
def _mock_response(kind, cfg):
    b, v = cfg["brand"], cfg["video"]
    d = cfg["compliance"]["ai_disclosure_label"]
    return {
        "script": (
            "TITLE: The Eternal Dinner Debate\n"
            "LOGLINE: Two friends starve to death deciding on tacos vs sushi.\n"
            "SCRIPT:\n"
            "[0-2s] MIA: Where do you wanna eat? | both standing in a kitchen, hangry\n"
            "[2-5s] JAY: I don't care, you pick. | shrugs unhelpfully\n"
            "[5-9s] MIA: Tacos? JAY: Eh. | Mia's eye twitches\n"
            "[9-13s] JAY: Sushi? MIA: We had that. | dramatic standoff\n"
            f"[13-15s] BOTH: ...let's just— | phone shows app — \"{b['punchline']}\""
        ),
        "video": (
            f"VIDEO_TARGET: {v['target']}\nASPECT: {v['aspect_ratio']}\n"
            "STYLE: warm sitcom lighting, punchy cuts\n"
            "CHARACTERS: MIA: 20s curly hair yellow hoodie; JAY: 20s denim jacket\n---\n"
            "SHOT 1 [0-2s]\nCAMERA: medium two-shot\nACTION: hangry standoff\n"
            'DIALOGUE: "Where do you wanna eat?"\nSETTING/LIGHT: kitchen, golden hour\n---\n'
            "NOTE_ON_TIER: For a clean no-watermark 15s export you'll need the PAID tier."
        ),
        "image": (
            "THUMB 1: two starving friends glaring across a kitchen island, empty plates, vertical\n"
            "THUMB 2: phone screen mid-swipe on a restaurant card, dramatic lighting\n"
            "THUMB 3: exhausted couple slumped in car outside closed restaurants at night\n"
            "TEXT_OVERLAY: JUST PICK ONE\nNEGATIVE: extra fingers, watermark, garbled text"
        ),
        "adcopy": (
            "HOOK 1: POV: nobody will just pick a place\nHOOK 2: it's been 45 minutes\n"
            "HOOK 3: the hunger games, dinner edition\n"
            f"CAPTION: When 'I don't care' starts a war. {b['cta']} {b['app_url']}\n"
            f"{d}\nHASHTAGS: #Settled #wheretoeat #couplesbelike #foodtok #datenight #hangry"
        ),
    }[kind]


if __name__ == "__main__":
    main()
