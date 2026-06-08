# Settled — Content Pipeline

Generates batches of short-form ad concepts (script + video prompt + image prompts
+ ad copy) for the Settled app, using a **local DeepSeek model** (zero API cost).

## Quick start
```bash
# 1. Make sure Ollama is running and the model is pulled:
ollama list            # expect deepseek-r1:14b
# 2. Generate a batch:
python3 generate.py            # default 3 concepts -> output/batch-<ts>/
# Test without the LLM:
python3 generate.py --mock --concepts 2
```

Each run produces, per concept:
```
output/batch-<timestamp>/concept-NN/
  script.txt           # comedic script, punchline "...just Settled."
  video-prompt.txt     # shot-by-shot for kling/veo/sora (+ tier note)
  image-prompts.txt    # 3 thumbnail prompts + overlay text
  ad-copy.txt          # hooks, caption (CTA + AI disclosure), hashtags
  tracking.json        # metadata + empty performance slots
```
…and appends rows to `tracking/tracking.csv`.

See [CLAUDE.md](CLAUDE.md) for the full spec, compliance rules, and conventions.
