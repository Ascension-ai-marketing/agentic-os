/** Shared by voice-lab /api/stt and the authenticated Jev voice proxy. */
export async function transcribeVoice(audio: Uint8Array, options: { key: string; fishKey?: string; contentType?: string; base?: string; fetch?: typeof fetch; timings?: boolean; convert?: (a: Uint8Array) => Promise<Uint8Array> }) {
  // Fish Audio speech-to-text when a Fish key is set; OpenAI Whisper otherwise.
  if (options.fishKey) return transcribeFish(audio, { ...options, fishKey: options.fishKey });
  if (!options.key) throw new Error("OPENAI_API_KEY is missing");
  if (!audio.byteLength || audio.byteLength > 12 * 1024 * 1024) throw new Error("Audio must be between 1 byte and 12 MB");
  const type = options.contentType ?? "audio/webm";
  const ext = type.includes("wav") ? "wav" : type.includes("mpeg") ? "mp3" : type.includes("mp4") ? "mp4" : "webm";
  const fd = new FormData(); fd.append("file", new Blob([new Uint8Array(audio)], { type }), `turn.${ext}`); fd.append("model", "whisper-1");
  if (options.timings) { fd.append("response_format", "verbose_json"); fd.append("timestamp_granularities[]", "word"); fd.append("timestamp_granularities[]", "segment"); }
  const r = await (options.fetch ?? fetch)(`${options.base ?? "https://api.openai.com"}/v1/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${options.key}` }, body: fd, signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`Voice transcription HTTP ${r.status}`);
  const body = await r.json();
  return { text: typeof body.text === "string" ? body.text : "", words: Array.isArray(body.words) ? body.words : [], segments: Array.isArray(body.segments) ? body.segments : [], source: "voice-lab Whisper API" };
}

/** Browser recordings are WebM/Opus or MP4, which Fish ASR cannot decode
 *  ("format not recognised", HTTP 400). Convert to 16 kHz mono WAV locally. */
export async function toWav(audio: Uint8Array): Promise<Uint8Array> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-v", "error", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"]);
    const out: Buffer[] = [];
    let err = "";
    ff.stdout.on("data", (d: Buffer) => out.push(d));
    ff.stderr.on("data", (d: Buffer) => (err += d));
    ff.on("error", () => reject(new Error("Audio conversion needs ffmpeg (brew install ffmpeg)")));
    ff.on("close", (code) => (code === 0 ? resolve(new Uint8Array(Buffer.concat(out))) : reject(new Error(`Audio could not be converted: ${err.trim().slice(0, 120)}`))));
    ff.stdin.on("error", () => {});
    ff.stdin.end(Buffer.from(audio));
  });
}

/** Fish Audio ASR: multipart upload to /v1/asr. */
export async function transcribeFish(audio: Uint8Array, options: { fishKey: string; contentType?: string; fetch?: typeof fetch; timings?: boolean; convert?: (a: Uint8Array) => Promise<Uint8Array> }) {
  if (!audio.byteLength || audio.byteLength > 12 * 1024 * 1024) throw new Error("Audio must be between 1 byte and 12 MB");
  let type = options.contentType ?? "audio/webm";
  if (!/wav|mpeg|mp3/.test(type)) {
    audio = await (options.convert ?? toWav)(audio);
    type = "audio/wav";
  }
  const ext = type.includes("wav") ? "wav" : "mp3";
  const fd = new FormData();
  fd.append("audio", new Blob([new Uint8Array(audio)], { type }), `turn.${ext}`);
  fd.append("ignore_timestamps", options.timings ? "false" : "true");
  const r = await (options.fetch ?? fetch)("https://api.fish.audio/v1/asr", { method: "POST", headers: { Authorization: `Bearer ${options.fishKey}` }, body: fd, signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`Fish transcription HTTP ${r.status}`);
  const body = await r.json();
  const segments = Array.isArray(body.segments) ? body.segments : [];
  return { text: typeof body.text === "string" ? body.text.trim() : "", words: [], segments, source: "Fish Audio ASR" };
}
