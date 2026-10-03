"""Stream the harness's actual OpenRouter response without exposing SDK internals.

The pinned Python SDK publishes committed messages, not live model deltas.
This authenticated, loopback-only transport passes the same SSE bytes to the
harness and observes only visible answer text. It neither generates nor replays
text, and never publishes reasoning, request bodies, headers or credentials.
"""
import hmac
import json
import secrets
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer


class HarnessStreamRelay:
    def __init__(self, api_key, emit, open_url=urllib.request.urlopen):
        self._api_key = api_key
        self._emit = emit
        self._open = open_url
        self.token = secrets.token_urlsafe(32)
        self.text = ""
        self._server = None
        self._thread = None

    def observe(self, line):
        if not line.startswith(b"data:"):
            return
        value = line[5:].strip()
        if value == b"[DONE]" or not value:
            return
        event = json.loads(value.decode("utf-8"))
        choices = event.get("choices") or []
        if not choices:
            return
        delta = choices[0].get("delta") or {}
        text = delta.get("content")
        if isinstance(text, str) and text:
            if len(self.text) + len(text) > 1_000_000:
                raise ValueError("Answer exceeded its size limit")
            self.text += text
            self._emit({"type": "delta", "text": text})

    def __enter__(self):
        relay = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                if self.path != "/v1/chat/completions":
                    self.send_error(404)
                    return
                supplied = self.headers.get("Authorization", "")
                if not hmac.compare_digest(supplied, "Bearer " + relay.token):
                    self.send_error(403)
                    return
                try:
                    size = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    size = 0
                if not 0 < size <= 300_000:
                    self.send_error(413)
                    return
                # A retry after partial output must not append a different answer.
                if relay.text:
                    self.send_error(409, "Retry the interrupted answer")
                    return
                data = self.rfile.read(size)
                request = urllib.request.Request(
                    "https://openrouter.ai/api/v1/chat/completions", data=data,
                    headers={"Authorization": "Bearer " + relay._api_key,
                             "Content-Type": "application/json", "Accept": "text/event-stream"},
                )
                started = False
                try:
                    with relay._open(request, timeout=150) as response:
                        self.send_response(response.status)
                        self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                        self.send_header("Connection", "close")
                        self.end_headers()
                        started = True
                        total = 0
                        streaming = "text/event-stream" in response.headers.get("Content-Type", "")
                        while True:
                            line = response.readline(1_000_001)
                            if not line:
                                break
                            total += len(line)
                            if len(line) > 1_000_000 or total > 8_000_000:
                                raise ValueError("Provider stream exceeded its size limit")
                            if streaming:
                                relay.observe(line)
                            self.wfile.write(line)
                            self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                except Exception:
                    if not started:
                        self.send_error(502, "Model provider could not complete this request")
                finally:
                    self.close_connection = True

        self._server = HTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True)
        self._thread.start()
        self.base_url = f"http://127.0.0.1:{self._server.server_port}/v1"
        return self

    def __exit__(self, *_args):
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=1)
