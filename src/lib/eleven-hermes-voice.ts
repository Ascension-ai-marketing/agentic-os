// Voice with ElevenLabs as ears and voice, and Hermes as the mind.
// Microphone audio -> /__operator/voice/stt (ElevenLabs Scribe) -> /__hermes_chat -> /__operator/voice/speak
// (ElevenLabs text to speech). Keys stay on the local server. Nothing here falls back to another
// speech provider: when ElevenLabs fails the reply stays on screen as text and the error says so.

export type HermesVoicePhase = "listening" | "thinking" | "speaking";
export type HermesVoiceOptions = {
  signal?: AbortSignal;
  /** Where the user is in the app, added to the first Hermes turn. */
  context?: () => string;
  /** Handles a request without Hermes (opening an app page). Return the spoken confirmation, or null. */
  onLocal?: (text: string) => Promise<string | null>;
  onMessage: (role: "user" | "assistant", text: string) => void;
  onCaption: (text: string) => void;
  onPhase: (phase: HermesVoicePhase) => void;
  onError: (message: string) => void;
  /** Off only for headphones: without it, speakers would feed the reply back into the microphone. */
  echoCancellation?: boolean;
  /** Injected in tests. */
  fetch?: typeof fetch;
};

const VOICE_BRIEF =
  "You are answering through a voice interface inside Agentic OS. The user's words were transcribed from speech, so allow for small mishearings. Reply in plain spoken English: two or three short sentences, no markdown, lists, code, links or emoji. Say what you did or found; if you could not do something, say so plainly.";
const SPEECH_CAP = 900;

async function localToken(request: typeof fetch) {
  const response = await request("/__token");
  return String((await response.json()).token || "");
}

/** Hermes prints setup warnings before the answer; they are not part of the reply. */
export function cleanHermesReply(text: string) {
  return text
    .split("\n")
    .filter((line) => !/^\s*Warning:\s*(Unknown toolset|Unrecognized|Deprecat|No config)/i.test(line))
    .join("\n")
    .trim();
}

/** What gets read aloud: markdown and links removed, long answers cut at a sentence. */
export function spokenText(reply: string, cap = SPEECH_CAP) {
  const plain = reply
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^[\s>#*-]+/gm, "")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= cap) return plain;
  const cut = plain.slice(0, cap);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return `${(end > cap / 2 ? cut.slice(0, end + 1) : cut).trim()} The rest is on screen.`;
}

/** Sentence-sized pieces so the first audio starts before the whole reply is synthesised. */
export function speechChunks(text: string, size = 260) {
  const chunks: string[] = [];
  let current = "";
  for (const sentence of text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]) {
    if (current && (current + sentence).length > size) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** One Hermes turn over the app's own /__hermes_chat stream. Resolves with the reply and session. */
export async function askHermes(
  prompt: string,
  options: { sessionId?: string; signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<{ text: string; sessionId?: string }> {
  const request = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await request("/__hermes_chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Claude-OS-Token": await localToken(request) },
      body: JSON.stringify({ prompt, ...(options.sessionId ? { sessionId: options.sessionId } : {}) }),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new Error("Hermes could not be reached. Check that the app server is running.");
  }
  if (!response.ok || !response.body)
    throw new Error("Hermes did not accept the request. Refresh the page and try again.");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    text = "",
    failure = "",
    sessionId = options.sessionId;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      let name = "chunk";
      const data: string[] = [];
      for (const line of event.split("\n")) {
        if (line.startsWith("event: ")) name = line.slice(7).trim();
        else if (line.startsWith("data: ")) data.push(line.slice(6));
      }
      const value = data.join("\n");
      if (name === "chunk") text += value + "\n";
      else if (name === "info") {
        const match = value.match(/session_id:\s*([A-Za-z0-9_-]{6,128})/);
        if (match) sessionId = match[1];
      } else if (name === "error" && value) failure = value;
    }
  }
  const reply = cleanHermesReply(text);
  if (!reply && failure)
    throw new Error(
      /not found on PATH/i.test(failure)
        ? "Hermes is not installed on this computer. Install it, then start the call again."
        : `Hermes could not answer: ${failure.slice(0, 200)}`,
    );
  if (!reply) throw new Error("Hermes returned no answer. Check its model provider with `hermes setup`.");
  return { text: reply, sessionId };
}

export async function startElevenHermesVoice(options: HermesVoiceOptions) {
  const request = options.fetch ?? fetch;
  const stream = await navigator.mediaDevices.getUserMedia({
    // Echo cancellation keeps the assistant's own voice from counting as an interruption.
    audio: {
      echoCancellation: options.echoCancellation !== false,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const audioContext = new AudioContext();
  // A context created outside a click starts suspended and would read silence.
  await audioContext.resume().catch(() => {});
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  audioContext.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );

  let ended = false,
    muted = false,
    volume = 1,
    level = 0,
    phase: HermesVoicePhase = "listening",
    sessionId: string | undefined,
    turn: AbortController | null = null,
    playing: HTMLAudioElement | null = null;
  // Voice activity: an utterance starts after steady speech and ends after a pause.
  let recorder: MediaRecorder | null = null,
    chunks: Blob[] = [],
    recordingSince = 0,
    voiced = 0,
    silent = 0,
    heard = false,
    noise = 0.01;
  const TICK = 50;
  let lastTick = performance.now();
  // With echo cancellation the reply is already removed from the microphone, and the user’s own
  // voice arrives quieter and in bursts while audio plays. Without it, only a clearly louder voice counts.
  const cancelsEcho = stream.getAudioTracks()[0]?.getSettings?.().echoCancellation === true;

  const setPhase = (next: HermesVoicePhase) => {
    phase = next;
    if (!ended) options.onPhase(next);
  };
  function record() {
    try {
      recorder?.stop();
    } catch {
      /* already stopped */
    }
    chunks = [];
    const next = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const mine = chunks;
    next.ondataavailable = (event) => {
      if (event.data.size) mine.push(event.data);
    };
    next.start();
    recorder = next;
    recordingSince = Date.now();
    voiced = 0;
    silent = 0;
    heard = false;
  }
  function finishRecording(): Promise<Blob> {
    const current = recorder,
      mine = chunks;
    recorder = null;
    return new Promise((resolve) => {
      if (!current || current.state === "inactive")
        return resolve(new Blob(mine, { type: type || "audio/webm" }));
      current.onstop = () => resolve(new Blob(mine, { type: current.mimeType || type || "audio/webm" }));
      current.stop();
    });
  }
  function silence() {
    turn?.abort();
    turn = null;
    if (playing) {
      playing.pause();
      playing.src = "";
      playing = null;
    }
  }
  /** Stops the reply in progress (speech, synthesis and the Hermes run) and listens again. */
  function interrupt(keepRecording = false) {
    silence();
    options.onCaption("");
    if (!keepRecording) record();
    setPhase("listening");
  }
  async function speak(reply: string, signal: AbortSignal) {
    const pieces = speechChunks(spokenText(reply));
    if (!pieces.length) return;
    const token = await localToken(request);
    const fetchPiece = async (piece: string) => {
      const response = await request("/__operator/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Claude-OS-Token": token },
        body: JSON.stringify({ text: piece }),
        signal,
      });
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => ({}))).error || "ElevenLabs could not speak the reply.",
        );
      return URL.createObjectURL(await response.blob());
    };
    let next = fetchPiece(pieces[0]);
    for (let index = 0; index < pieces.length; index++) {
      const url = await next;
      // Start synthesising the following sentence while this one plays.
      if (index + 1 < pieces.length) {
        next = fetchPiece(pieces[index + 1]);
        next.catch(() => {});
      }
      if (signal.aborted) return URL.revokeObjectURL(url);
      setPhase("speaking");
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(url);
        audio.volume = volume;
        playing = audio;
        const done = () => {
          URL.revokeObjectURL(url);
          if (playing === audio) playing = null;
          resolve();
        };
        audio.onended = done;
        audio.onpause = done;
        audio.onerror = () => {
          done();
          reject(new Error("The reply audio could not be played."));
        };
        signal.addEventListener("abort", () => audio.pause(), { once: true });
        audio.play().catch((error) => {
          done();
          reject(error);
        });
      });
      if (signal.aborted) return;
    }
  }
  async function respond(text: string, controller: AbortController) {
    const { signal } = controller;
    setPhase("thinking");
    options.onCaption("");
    let reply = "";
    try {
      const local = await options.onLocal?.(text);
      if (signal.aborted) return;
      if (local) reply = local;
      else {
        const first = !sessionId;
        const answer = await askHermes(
          first ? `${VOICE_BRIEF}\n${options.context?.() ?? ""}\n\nThe user said: ${text}` : text,
          { sessionId, signal, fetch: request },
        );
        if (signal.aborted) return;
        sessionId = answer.sessionId;
        reply = answer.text;
      }
    } catch (error) {
      if (signal.aborted || (error as Error).name === "AbortError") return;
      options.onError((error as Error).message);
      if (turn === controller) interrupt();
      return;
    }
    // The text is on screen before any audio, so a speech failure still leaves the answer readable.
    options.onMessage("assistant", reply);
    try {
      await speak(reply, signal);
    } catch (error) {
      if (!signal.aborted && (error as Error).name !== "AbortError")
        options.onError(
          `${(error as Error).message} The reply is shown as text; no other voice was used.`,
        );
    }
    if (turn === controller) {
      turn = null;
      record();
      setPhase("listening");
    }
  }
  function begin(text: string) {
    silence();
    const controller = new AbortController();
    turn = controller;
    // Keep recording during the reply so the first words of an interruption are not lost.
    record();
    options.onMessage("user", text);
    void respond(text, controller);
  }
  async function transcribeTurn() {
    // Leave "listening" before the first await so the next tick cannot start a second transcription.
    const controller = new AbortController();
    turn = controller;
    heard = false;
    voiced = 0;
    setPhase("thinking");
    options.onCaption("Transcribing…");
    const audio = await finishRecording();
    if (ended || controller.signal.aborted) return;
    let text = "";
    try {
      const response = await request("/__operator/voice/stt", {
        method: "POST",
        headers: {
          "Content-Type": audio.type || "audio/webm",
          "X-Claude-OS-Token": await localToken(request),
        },
        body: audio,
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "ElevenLabs could not transcribe the audio.");
      text = String(result.text || "").trim();
    } catch (error) {
      if (controller.signal.aborted) return;
      options.onError(`${(error as Error).message} You can type your message instead.`);
      if (turn === controller) interrupt();
      return;
    }
    if (controller.signal.aborted || turn !== controller) return;
    options.onCaption("");
    // Scribe returns nothing, or a bracketed sound label, for noise without words.
    if (!text || /^[\[(][^\])]*[\])]$/.test(text)) return interrupt();
    begin(text);
  }
  record();
  const timer = window.setInterval(() => {
    if (ended) return;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const rms = Math.sqrt(sum / samples.length);
    level = muted ? 0 : Math.min(1, rms * 8);
    if (muted) return;
    // Real elapsed time: a background tab runs this timer far less often than every 50 ms.
    const now = performance.now(),
      elapsed = Math.min(1000, now - lastTick);
    lastTick = now;
    const replying = phase !== "listening";
    const base = Math.max(0.018, noise * 3);
    // The lower bar is only for echo-cancelled audio during playback. While Hermes is still thinking
    // nothing is playing, so a cough must not cancel a slow answer.
    const threshold =
      phase === "speaking"
        ? cancelsEcho
          ? Math.max(0.012, noise * 2.5)
          : base * 2.5
        : replying
          ? base * 1.8
          : base;
    const speaking = rms > threshold;
    if (!speaking && !heard && !replying) noise = noise * 0.95 + rms * 0.05;
    if (speaking) {
      voiced += elapsed;
      silent = 0;
    } else {
      silent += elapsed;
      // While replying, short gaps only drain the count, since cancelled speech arrives in bursts.
      if (phase === "speaking") voiced = Math.max(0, voiced - elapsed / 3);
      else if (silent > 300 && !heard) voiced = 0;
    }
    if (replying) {
      // Thinking with no reply audio yet still counts: talking over a slow answer cancels it.
      if (voiced >= (phase === "speaking" ? 250 : 400) && turn && recorder) {
        heard = true;
        interrupt(true);
      }
      return;
    }
    if (!heard && voiced >= 200) heard = true;
    if (heard && silent >= 800) void transcribeTurn();
    else if (heard && Date.now() - recordingSince > 60_000) void transcribeTurn();
    else if (!heard && Date.now() - recordingSince > 12_000) record();
  }, TICK);
  async function endSession() {
    if (ended) return;
    ended = true;
    window.clearInterval(timer);
    silence();
    try {
      recorder?.stop();
    } catch {
      /* already stopped */
    }
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close().catch(() => {});
  }
  options.signal?.addEventListener("abort", () => void endSession(), { once: true });
  if (options.signal?.aborted) await endSession();
  return {
    endSession,
    setMicMuted(next: boolean) {
      muted = next;
      stream.getAudioTracks().forEach((track) => (track.enabled = !next));
      if (!next && phase === "listening") record();
    },
    getInputVolume: () => level,
    getOutputVolume: () => (playing ? volume : 0),
    setVolume({ volume: next }: { volume: number }) {
      volume = Math.max(0, Math.min(1, next));
      if (playing) playing.volume = volume;
    },
    /** Hermes keeps its own session; app context rides along with the first turn instead. */
    sendContextualUpdate(_text: string) {},
    /** A typed message: the same Hermes turn and spoken reply, without the microphone. */
    sendUserMessage(text: string) {
      if (!ended && text.trim()) begin(text.trim());
    },
    sendUserActivity() {
      if (!ended && phase !== "listening") interrupt();
    },
    resumeAudio: () => audioContext.resume(),
  };
}
