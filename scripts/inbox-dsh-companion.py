"""Inbox-only DeepSeek Harness. Credentials arrive on stdin, never argv."""
import json
import sys
from pathlib import Path
from deepseek_harness import DeepSeekHarness

MODEL = "deepseek/deepseek-v4.1-flash"
root = Path(__file__).resolve().parents[1]
request = json.load(sys.stdin)
if request.get("model") != MODEL:
    raise ValueError("This inbox companion supports the configured DeepSeek Flash model only.")
prompt = request.get("prompt")
if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 100000:
    raise ValueError("The inbox prompt must contain between 1 and 100,000 characters.")
if not isinstance(request.get("apiKey"), str) or not request["apiKey"].strip():
    raise ValueError("Connect the OpenRouter provider before asking the inbox.")

with DeepSeekHarness(
    provider="openrouter",
    model=MODEL,
    profile="sdk-minimal",
    dsh_home=str(root / ".operator-data/dsh"),
    cwd=str(root / ".operator-data"),
    patches=(
        str(root / "scripts/dsh-companion.patch.yml"),
        str(root / "scripts/inbox-dsh-companion.patch.yml"),
    ),
    max_tokens=1024,
    reasoning_effort="off",
    base_url="https://openrouter.ai/api/v1",
    api_key=request["apiKey"],
    initialize_timeout_seconds=10,
    request_timeout_seconds=30,
) as harness:
    result = harness.run(prompt)
    print(json.dumps({"text": result.final_response, "finishReason": result.finish_reason}), flush=True)
