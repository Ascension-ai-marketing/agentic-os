"""Scoped DeepSeek Harness; credentials arrive on stdin, never argv or logs."""
import json
import sys
from pathlib import Path
from deepseek_harness import DeepSeekHarness
from dsh_stream import HarnessStreamRelay

request = json.load(sys.stdin)
root = Path(__file__).resolve().parents[1]
def emit(event):
    print(json.dumps(event), flush=True)

# Observe the model's live text while the SDK still owns the complete turn.
# Current SDK notifications contain committed messages, so those must not be
# replayed as though they were a live token stream.
try:
    with HarnessStreamRelay(request["apiKey"], emit) as relay:
        with DeepSeekHarness(
            provider="deepseek-official", model=request["model"],
            profile="sdk-minimal", dsh_home=str(root / ".operator-data/dsh"),
            cwd=str(root / ".operator-data"),
            patches=(str(root / "scripts/dsh-companion.patch.yml"),),
            max_tokens=max(1024, min(8192, int(request.get("maxTokens", 4096)))),
            reasoning_effort="off", base_url=relay.base_url, api_key=relay.token,
            request_timeout_seconds=150,
        ) as harness:
            result = harness.run(request["prompt"])
            final = result.final_response
            if not final or not final.startswith(relay.text):
                raise ValueError("The streamed answer did not match the completed turn")
            if len(final) > len(relay.text):
                emit({"type": "delta", "text": final[len(relay.text):]})
            emit({"type": "done"})
except Exception:
    emit({"type": "error", "message": "DeepSeek Harness could not complete this answer. Please retry."})
    sys.exit(1)
