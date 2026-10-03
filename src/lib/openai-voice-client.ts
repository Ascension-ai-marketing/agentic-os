/** OpenAI Realtime WebRTC transport. The permanent API key never enters this module. */
export type VoicePhase = "listening" | "thinking" | "speaking";
export type RealtimeCallbacks = {
  signal: AbortSignal;
  createSession: (sdp: string) => Promise<{ sdp: string; model: string; voice: string }>;
  /** meta: the audio item a spoken transcript belongs to, or typed: true for typed text. */
  onMessage: (role: "user" | "assistant", text: string, meta?: { itemId?: string; typed?: boolean }) => void;
  onCaption: (text: string) => void;
  onPhase: (phase: VoicePhase) => void;
  onError: (message: string) => void;
  onDisconnect: () => void;
  onTool: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<string>;
  /** Text-only sessions (another voice speaks): each reply text delta as it streams. */
  onTextDelta?: (delta: string, responseId: string) => void;
  /** A reply finished (or was cancelled). */
  onResponseDone?: (responseId: string, cancelled: boolean) => void;
  /** Your words as they are transcribed, while you are still talking. */
  onUserDelta?: (delta: string) => void;
  /** The user started talking: stop any speech now. */
  onSpeechStarted?: (itemId?: string) => void;
};
type RealtimeEvent = {
  type: string;
  response_id?: string;
  item_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  delta?: string;
  transcript?: string;
  text?: string;
  response?: { id?: string; status?: string; output?: RealtimeEvent[] };
  error?: { code?: string };
};
export async function startOpenAIVoice(options: RealtimeCallbacks) {
  const { signal } = options;
  signal.throwIfAborted();
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("Microphone access requires localhost or HTTPS in a supported browser.");
  const peer = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  const events = peer.createDataChannel("oai-events");
  let microphone: MediaStream | undefined, sound: AudioContext | undefined;
  let inputMeter: AnalyserNode | undefined, outputMeter: AnalyserNode | undefined;
  let closed = false,
    responding = false,
    speaking = false,
    responseWanted = false;
  let caption = "",
    timeout: ReturnType<typeof setTimeout> | undefined;
  const completedCalls = new Set<string>();
  const pendingCalls = new Map<string, Promise<void>>();
  const toolControllers = new Map<string, AbortController>();
  const cancelledResponses = new Set<string>();
  let currentResponse = "";
  let sessionReady = false,
    channelReady = false;
  let resolveReady: (() => void) | undefined;
  const checkReady = () => {
    if (sessionReady && channelReady) {
      clearTimeout(timeout);
      resolveReady?.();
    }
  };
  const send = (value: unknown) => {
    if (closed || signal.aborted || events.readyState !== "open") return false;
    events.send(JSON.stringify(value));
    return true;
  };
  const end = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    for (const controller of toolControllers.values()) controller.abort();
    microphone?.getTracks().forEach((t) => t.stop());
    audio.pause();
    audio.srcObject = null;
    events.close();
    peer.close();
    void sound?.close().catch(() => {});
    signal.removeEventListener("abort", end);
  };
  signal.addEventListener("abort", end, { once: true });
  const createResponse = () => {
    if (responding || pendingCalls.size) {
      responseWanted = true;
      return;
    }
    responseWanted = false;
    responding = send({ type: "response.create" });
  };
  const fail = (message: string) => {
    if (!closed) {
      end();
      options.onError(message);
      options.onDisconnect();
    }
  };
  function meter(stream: MediaStream) {
    sound ||= new AudioContext();
    void sound.resume().catch(() => {});
    const analyser = sound.createAnalyser();
    analyser.fftSize = 256;
    sound.createMediaStreamSource(stream).connect(analyser);
    return analyser;
  }
  peer.ontrack = (event) => {
    if (closed) return;
    const remote = event.streams[0] || new MediaStream([event.track]);
    audio.srcObject = remote;
    outputMeter = meter(remote);
    void audio
      .play()
      .catch(() =>
        options.onError("Your browser paused audio. Press Resume audio to hear the reply."),
      );
  };
  peer.onconnectionstatechange = () => {
    if (closed) return;
    if (peer.connectionState === "failed")
      fail("The voice connection failed. Check your network and start again.");
    if (peer.connectionState === "closed") {
      end();
      options.onDisconnect();
    }
  };
  const runTool = (call: RealtimeEvent) => {
    if (
      closed ||
      signal.aborted ||
      typeof call.call_id !== "string" ||
      completedCalls.has(call.call_id)
    )
      return;
    completedCalls.add(call.call_id);
    const controller = new AbortController();
    toolControllers.set(call.call_id, controller);
    if (cancelledResponses.has(call.response_id || "")) controller.abort();
    const task = (async () => {
      let result: string;
      try {
        if (typeof call.arguments !== "string" || call.arguments.length > 8000) throw new Error();
        const args = JSON.parse(call.arguments);
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error();
        controller.signal.throwIfAborted();
        result = await options.onTool(call.name || "", args, controller.signal);
      } catch {
        result =
          "This action could not finish. Ask the user to try again. Do not claim it happened.";
      }
      if (closed || signal.aborted) return;
      const cancelled = controller.signal.aborted || cancelledResponses.has(call.response_id || "");
      send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: call.call_id,
          output: cancelled ? "This turn was interrupted by the user." : result.slice(0, 16000),
        },
      });
      if (!cancelled) responseWanted = true;
    })();
    pendingCalls.set(call.call_id, task);
    void task.finally(() => {
      pendingCalls.delete(call.call_id!);
      toolControllers.delete(call.call_id!);
      if (responseWanted && !responding && !pendingCalls.size) createResponse();
    });
  };
  const invalidateTurn = () => {
    if (currentResponse) cancelledResponses.add(currentResponse);
    for (const controller of toolControllers.values()) controller.abort();
    responseWanted = false;
  };
  events.onmessage = ({ data }) => {
    if (closed || signal.aborted || typeof data !== "string") return;
    let event: RealtimeEvent;
    try {
      const parsed: unknown = JSON.parse(data);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("type" in parsed) ||
        typeof parsed.type !== "string"
      )
        return;
      event = parsed as RealtimeEvent;
    } catch {
      return;
    }
    switch (event.type) {
      case "session.created":
        sessionReady = true;
        checkReady();
        break;
      case "input_audio_buffer.speech_started":
        invalidateTurn();
        options.onSpeechStarted?.(typeof event.item_id === "string" ? event.item_id : undefined);
        caption = "";
        options.onCaption("");
        options.onPhase("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        options.onPhase("thinking");
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (event.delta) options.onUserDelta?.(event.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript?.trim()) options.onMessage("user", event.transcript.trim(), { itemId: typeof event.item_id === "string" ? event.item_id : undefined });
        break;
      case "response.created":
        responding = true;
        currentResponse = event.response?.id || "";
        caption = "";
        options.onPhase("thinking");
        break;
      case "response.output_audio_transcript.delta":
      case "response.output_text.delta":
        if (cancelledResponses.has(event.response_id || "")) break;
        if (event.type === "response.output_text.delta") options.onTextDelta?.(event.delta || "", event.response_id || "");
        caption += event.delta || "";
        options.onCaption(caption);
        break;
      case "response.output_audio_transcript.done":
      case "response.output_text.done":
        if (
          !cancelledResponses.has(event.response_id || "") &&
          (event.transcript || event.text)?.trim()
        ) {
          options.onMessage("assistant", event.transcript || event.text || "");
          options.onCaption("");
        }
        break;
      case "output_audio_buffer.started":
        speaking = true;
        options.onPhase("speaking");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        speaking = false;
        options.onPhase("listening");
        break;
      case "response.function_call_arguments.done":
        runTool(event);
        break;
      case "response.done":
        responding = false;
        options.onResponseDone?.(event.response?.id || "", cancelledResponses.has(event.response?.id || "") || event.response?.status === "cancelled");
        for (const item of event.response?.output || [])
          if (item.type === "function_call") runTool({ ...item, response_id: event.response?.id });
        if (event.response?.status === "failed") {
          fail("OpenAI could not answer this turn. Check your account usage and try again.");
          break;
        }
        if (responseWanted && !pendingCalls.size) createResponse();
        if (!speaking && !pendingCalls.size) options.onPhase("listening");
        break;
      case "error":
        if (
          ["response_cancel_not_active", "output_audio_buffer_clear_failed"].includes(
            event.error?.code || "",
          )
        )
          break;
        if (event.error?.code === "insufficient_quota")
          fail("OpenAI reports no available API credit. Add credit to this project to continue.");
        else options.onError("OpenAI could not complete that voice turn. Try again.");
        break;
    }
  };
  const opened = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    timeout = setTimeout(() => {
      fail("Voice connection timed out. Please try again.");
      reject(new Error("Voice connection timed out. Please try again."));
    }, 30000);
    events.onopen = () => {
      channelReady = true;
      checkReady();
    };
    events.onclose = () => {
      if (!closed) {
        end();
        options.onDisconnect();
      }
      reject(new Error("Voice connection closed."));
    };
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("Voice stopped", "AbortError")),
      { once: true },
    );
  });
  // Attach a rejection handler immediately while permission / SDP awaits.
  void opened.catch(() => {});
  try {
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (closed || signal.aborted) {
      microphone.getTracks().forEach((t) => t.stop());
      signal.throwIfAborted();
      throw new Error("Voice connection stopped.");
    }
    inputMeter = meter(microphone);
    for (const track of microphone.getAudioTracks()) peer.addTrack(track, microphone);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    signal.throwIfAborted();
    const connection = await options.createSession(offer.sdp || "");
    signal.throwIfAborted();
    if (closed) throw new Error("Voice connection stopped.");
    await peer.setRemoteDescription({ type: "answer", sdp: connection.sdp });
    await opened;
    signal.throwIfAborted();
    options.onPhase("listening");
    const volume = (node?: AnalyserNode) => {
      if (!node || closed) return 0;
      const values = new Uint8Array(node.fftSize);
      node.getByteTimeDomainData(values);
      return Math.min(
        1,
        Math.sqrt(values.reduce((n, v) => n + Math.pow((v - 128) / 128, 2), 0) / values.length) * 4,
      );
    };
    return {
      model: connection.model,
      voice: connection.voice,
      greet: () => {
        if (!responding)
          responding = send({
            type: "response.create",
            response: {
              instructions:
                "Greet the user briefly in your calm British voice: you are ready to work together, and they can ask you to bring up a memory, their day, or discuss an image. Do not claim to have accessed any data yet.",
            },
          });
      },
      endSession: async () => end(),
      /** Have the voice say something now (e.g. "Codex needs your answer"), unless it is mid-reply. */
      say: (instructions: string) => {
        if (!responding) responding = send({ type: "response.create", response: { instructions: instructions.slice(0, 2000) } });
      },
      setMicMuted: (muted: boolean) =>
        microphone?.getAudioTracks().forEach((t) => (t.enabled = !muted)),
      setVolume: ({ volume }: { volume: number }) => {
        audio.volume = Math.max(0, Math.min(1, volume));
      },
      getInputVolume: () => volume(inputMeter),
      getOutputVolume: () => volume(outputMeter),
      resumeAudio: () => audio.play(),
      sendContextualUpdate: (text: string) =>
        send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [{ type: "input_text", text: text.slice(0, 12000) }],
          },
        }),
      sendUserMessage: (text: string, image?: string) => {
        if (
          image &&
          (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) ||
            image.length > 60000)
        )
          throw new Error("Choose a smaller supported image.");
        const content: Array<
          { type: "input_text"; text: string } | { type: "input_image"; image_url: string }
        > = [{ type: "input_text", text: text.slice(0, 4000) }];
        if (image) content.push({ type: "input_image", image_url: image });
        if (
          !send({
            type: "conversation.item.create",
            item: { type: "message", role: "user", content },
          })
        )
          throw new Error("Start a voice conversation first.");
        options.onMessage("user", text, { typed: true });
        createResponse();
      },
      sendUserActivity: () => {
        invalidateTurn();
        if (responding) send({ type: "response.cancel" });
        if (speaking) send({ type: "output_audio_buffer.clear" });
        options.onCaption("");
        options.onPhase("listening");
      },
    };
  } catch (error) {
    end();
    throw error;
  }
}

/** Prepare bounded image input for WebRTC; SVG and arbitrary URLs are excluded. */
export async function prepareVoiceImage(file: File) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 12 * 1024 * 1024
  )
    throw new Error("Choose a PNG, JPEG or WebP under 12 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare the image.");
    let longest = Math.min(1280, Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 8; attempt++) {
      const ratio = longest / Math.max(bitmap.width, bitmap.height);
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/jpeg", 0.78);
      if (url.length <= 60000)
        return { name: file.name.slice(0, 200), url, width: canvas.width, height: canvas.height };
      longest *= 0.77;
    }
    throw new Error("The image could not be prepared. Try a smaller image.");
  } finally {
    bitmap.close();
  }
}
