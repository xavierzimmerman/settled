"""Local DeepSeek client via Ollama (http://localhost:11434).

Stdlib-only. Handles deepseek-r1's <think>…</think> reasoning blocks by stripping
them from the returned text, so callers get clean, usable content.
"""
import json
import re
import sys
import urllib.request
import urllib.error

OLLAMA_URL = "http://localhost:11434/api/generate"
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


class DeepSeekError(RuntimeError):
    pass


def strip_thinking(text: str) -> str:
    """Remove <think> blocks (deepseek-r1) and any leading orphan reasoning."""
    text = _THINK_RE.sub("", text)
    # If a stray opening tag remains with no close, drop everything before content.
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    return text.strip()


def generate(prompt: str, model: str = "deepseek-r1:14b", temperature: float = 0.9,
             timeout: int = 600) -> str:
    """Call the local model and return cleaned text. Raises DeepSeekError on failure."""
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": temperature},
    }).encode()
    req = urllib.request.Request(
        OLLAMA_URL, data=payload, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read())
    except urllib.error.URLError as e:
        raise DeepSeekError(
            f"Could not reach Ollama at {OLLAMA_URL} ({e}). Is `ollama serve` running "
            f"and is the model pulled? Try: ollama list"
        )
    raw = data.get("response", "")
    cleaned = strip_thinking(raw)
    if not cleaned:
        raise DeepSeekError("Model returned empty content after stripping reasoning.")
    return cleaned


def ping(model: str = "deepseek-r1:14b") -> bool:
    """Quick availability check used by generate.py before a full run."""
    try:
        with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=10) as resp:
            tags = json.loads(resp.read())
        names = {m["name"] for m in tags.get("models", [])}
        return model in names
    except Exception:
        return False


if __name__ == "__main__":
    # Smoke test: python3 deepseek.py "say hi in 5 words"
    prompt = sys.argv[1] if len(sys.argv) > 1 else "Say hello in exactly five words."
    print(generate(prompt))
