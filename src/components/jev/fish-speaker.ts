// Fish Audio as the speaking half of live voice. Reply text arrives as it
// streams; it is cut into speakable chunks (the first at the first clause, so
// the voice starts early), each chunk is fetched from the local
// /__voice/speak-stream route as raw 24 kHz PCM, and played back in order the
// moment bytes arrive. stop() silences everything at once (barge-in).

const RATE = 24000;

/** Cut streaming text into chunks worth speaking. */
export function createChunker(emit: (text: string) => void) {
  let buf = "";
  let first = true;
  return {
    push(delta: string) {
      buf += delta;
      for (;;) {
        // The first chunk goes at the first clause (≥ 25 chars); later ones at sentence ends (≥ 60).
        const min = first ? 12 : 60;
        const re = first ? /[.!?;:,](?=\s)|\n/g : /[.!?;:](?=\s)|\n/g;
        let cut = -1;
        for (let m; (m = re.exec(buf)); ) if (m.index + 1 >= min) { cut = m.index + 1; break; }
        if (cut < 0) return;
        const text = buf.slice(0, cut).trim();
        buf = buf.slice(cut);
        first = false;
        if (text) emit(text);
      }
    },
    flush() {
      const text = buf.trim();
      buf = "";
      first = true;
      if (text) emit(text);
    },
    reset() {
      buf = "";
      first = true;
    },
  };
}

export type FishSpeakerOptions = {
  voiceId: () => string;
  speed: () => number;
  /** First sound of this reply. */
  onStart?: () => void;
  /** All queued speech has played. */
  onIdle?: () => void;
  /** Fish refused or failed a chunk (HTTP status, or 0 for a network error). */
  onError?: (status: number) => void;
  token: () => Promise<string>;
};

export function createFishSpeaker(options: FishSpeakerOptions) {
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let gain: GainNode | null = null;
  let playhead = 0;
  let generation = 0;
  let sources = new Set<AudioBufferSourceNode>();
  let queue: Promise<void> = Promise.resolve();
  let controllers = new Set<AbortController>();
  let pending = 0;
  let speaking = false;
  let idleTimer = 0;

  function audio() {
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: RATE });
      gain = ctx.createGain();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      gain.connect(analyser);
      analyser.connect(ctx.destination);
    }
    void ctx.resume().catch(() => {});
    return ctx;
  }

  function schedule(samples: Float32Array<ArrayBuffer>, gen: number) {
    if (gen !== generation || !samples.length) return;
    const c = audio();
    const buffer = c.createBuffer(1, samples.length, RATE);
    buffer.copyToChannel(samples, 0);
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(gain!);
    const at = Math.max(c.currentTime + 0.01, playhead);
    src.start(at);
    playhead = at + buffer.duration;
    sources.add(src);
    if (!speaking) {
      speaking = true;
      options.onStart?.();
    }
    src.onended = () => {
      sources.delete(src);
      checkIdle();
    };
  }

  function checkIdle() {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (speaking && !sources.size && !pending) {
        speaking = false;
        options.onIdle?.();
      }
    }, 120);
  }

  /** Queue one chunk of text. Fetching starts now; playback waits its turn. */
  function speak(text: string) {
    const gen = generation;
    const controller = new AbortController();
    controllers.add(controller);
    pending++;
    audio();
    // Start the request at once, so the next chunk is ready when this one ends.
    const response = options
      .token()
      .then((token) =>
        fetch("/__voice/speak-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-claude-os-token": token },
          body: JSON.stringify({ text, voiceId: options.voiceId(), speed: options.speed() }),
          signal: controller.signal,
        }),
      );
    queue = queue.then(async () => {
      try {
        const r = await response;
        if (gen !== generation) return;
        if (!r.ok || !r.body) return options.onError?.(r.status);
        const reader = r.body.getReader();
        let carry: number | null = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done || gen !== generation) break;
          let bytes = value;
          if (carry !== null) {
            const joined = new Uint8Array(bytes.length + 1);
            joined[0] = carry;
            joined.set(bytes, 1);
            bytes = joined;
            carry = null;
          }
          if (bytes.length % 2) {
            carry = bytes[bytes.length - 1];
            bytes = bytes.subarray(0, bytes.length - 1);
          }
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const samples = new Float32Array(bytes.length / 2);
          for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
          schedule(samples, gen);
        }
      } catch (e) {
        // Stopped on purpose (abort) is silent; a real failure is reported.
        if (gen === generation && !(e instanceof DOMException && e.name === "AbortError")) options.onError?.(0);
      } finally {
        controllers.delete(controller);
        if (gen === generation) pending--;
        checkIdle();
      }
    });
  }

  /** Silence now: stop playback, drop queued chunks, abort their requests. */
  function stop() {
    generation++;
    for (const c of controllers) c.abort();
    controllers = new Set();
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
    }
    sources = new Set();
    queue = Promise.resolve();
    pending = 0;
    playhead = 0;
    if (speaking) {
      speaking = false;
      options.onIdle?.();
    }
  }

  function level() {
    if (!analyser || !speaking) return 0;
    const v = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(v);
    return Math.min(1, Math.sqrt(v.reduce((n, x) => n + ((x - 128) / 128) ** 2, 0) / v.length) * 4);
  }

  return { speak, stop, level, isSpeaking: () => speaking, unlock: audio, close: () => void ctx?.close().catch(() => {}) };
}
