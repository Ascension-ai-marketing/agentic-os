"use client";

import * as React from "react";
import { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { EffortSlider } from "./effort-slider";
import { MoreHorizontal } from "lucide-react";

// ----------------------------------------------------------------------
// Transition Physics
// ----------------------------------------------------------------------
const SPRING_TRANSITION =
  "max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
const SMOOTH_HEIGHT_TRANSITION =
  "max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.15s ease-out";

// ----------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------
interface Attachment {
  id: string;
  file: File;
  url: string;
  name: string;
  width?: number;
  height?: number;
}

// ----------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------
function MorphingText({ text }: { text: string }) {
  const [width, setWidth] = useState<number | "auto">("auto");
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (spanRef.current) {
      setWidth(spanRef.current.offsetWidth);
    }
  }, [text]);

  return (
    <span
      className="relative inline-flex items-center justify-center overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
      style={{ width }}
    >
      <span ref={spanRef} className="invisible whitespace-nowrap px-1">
        {text}
      </span>
      <span
        key={text}
        className="absolute inset-0 flex items-center justify-center whitespace-nowrap animate-in fade-in zoom-in-95 duration-300"
      >
        {text}
      </span>
    </span>
  );
}

function ModelIcon({ model, className }: { model: string; className?: string }) {
  const icons: Record<string, string> = {
    "Composer 2.5":
      "https://cdn.21st.dev/assets/mirror/7d/7dc00bc09f225fcda46cbc9c6b669c69c025a231877d6c17baa6a003f04f02b2.svg",
    "Gemini 3.5 Flash":
      "https://cdn.21st.dev/assets/mirror/cd/cda2df6631d5fa227de3fa04ed78cf354f910ba92a9f086e7455655c10ad9d09.svg",
    "GPT 5.5":
      "https://cdn.21st.dev/assets/mirror/b9/b93fa7942be639a1dae60194ff12141145d7d9fd59581582d6ff23335755f19c.svg",
    "Opus 4.8":
      "https://cdn.21st.dev/assets/mirror/5d/5de1221c77cc91e748066fd642ad0eee1c1fa65328814f5178166f901e599709.svg",
    "GLM 5.2":
      "https://cdn.21st.dev/assets/mirror/b2/b2a6c0ff63efd8a555edf8a174ea6fcfeca120ac1595a2d461ca11d3ae89276c.svg",
  };

  const filters: Record<string, string> = {
    "GPT 5.5": "dark:invert",
  };

  return (
    <img
      src={icons[model] || icons["GPT 5.5"]}
      alt=""
      className={cn("object-contain", filters[model], className)}
    />
  );
}

function ArrowUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 12V2M7 2L2.5 6.5M7 2L11.5 6.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="5" y="1" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M2.75 6.5V7a4.25 4.25 0 0 0 8.5 0v-.5M7 11.25V13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 2.5V11.5M2.5 7H11.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DynamicBarsIcon({ level }: { level: string }) {
  const isMediumOrHigh = level === "Medium" || level === "Max Effort";
  const isHigh = level === "Max Effort";

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect
        x="1.5"
        y="8"
        width="2.5"
        height="4.5"
        rx="1"
        fill="currentColor"
        className="transition-opacity duration-300"
        opacity={1}
      />
      <rect
        x="5.75"
        y="5"
        width="2.5"
        height="7.5"
        rx="1"
        fill="currentColor"
        className="transition-opacity duration-300"
        opacity={isMediumOrHigh ? 1 : 0.3}
      />
      <rect
        x="10"
        y="2"
        width="2.5"
        height="10.5"
        rx="1"
        fill="currentColor"
        className="transition-opacity duration-300"
        opacity={isHigh ? 1 : 0.3}
      />
    </svg>
  );
}

// ----------------------------------------------------------------------
// Attachment Thumbnail
// ----------------------------------------------------------------------
function AttachmentThumb({
  attachment,
  index,
  onRemove,
  onOpen,
  registerRef,
}: {
  attachment: Attachment;
  index: number;
  onRemove: (id: string) => void;
  onOpen: (attachment: Attachment, rect: DOMRect) => void;
  registerRef: (id: string, el: HTMLButtonElement | null) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const isImage = attachment.file.type.startsWith("image/");
  return (
    <div className="relative shrink-0" style={{ animationDelay: `${index * 35}ms` }}>
      <button
        ref={(el) => {
          btnRef.current = el;
          registerRef(attachment.id, el);
        }}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          if (isImage && btnRef.current) onOpen(attachment, btnRef.current.getBoundingClientRect());
        }}
        className={cn(
          "h-12 overflow-hidden rounded-xl border border-border bg-muted",
          isImage ? "w-12" : "w-28 px-2 pr-5 text-left",
        )}
        title={attachment.name}
        aria-label={isImage ? `Preview ${attachment.name}` : `Attached file: ${attachment.name}`}
      >
        {isImage ? (
          <img src={attachment.url} alt="" className="size-full object-cover" />
        ) : (
          <span className="block truncate text-[10px] font-medium">{attachment.name}</span>
        )}
      </button>
      <button
        type="button"
        aria-label={`Remove ${attachment.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(attachment.id);
        }}
        className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-background/90 text-foreground/70 hover:text-foreground"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------
// Shared-Element Gallery Modal
// ----------------------------------------------------------------------
function AttachmentGalleryModal({
  attachment,
  originRect,
  onClose,
}: {
  attachment: Attachment;
  originRect: DOMRect;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"opening" | "open" | "closing">("opening");
  const [targetRect, setTargetRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    radius: number;
  } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const maxW = Math.min(window.innerWidth * 0.86, 560);
    const maxH = Math.min(window.innerHeight * 0.78, 720);

    const naturalW = attachment.width || 800;
    const naturalH = attachment.height || 600;
    const scale = Math.min(maxW / naturalW, maxH / naturalH, 1.6);

    const width = naturalW * scale;
    const height = naturalH * scale;

    setTargetRect({
      top: (window.innerHeight - height) / 2,
      left: (window.innerWidth - width) / 2,
      width,
      height,
      radius: 20,
    });

    const raf = requestAnimationFrame(() => setPhase("open"));
    return () => cancelAnimationFrame(raf);
  }, [attachment]);

  const handleClose = useCallback(() => setPhase("closing"), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const isOpen = phase === "open";
  const isClosing = phase === "closing";

  const geometry =
    isOpen && targetRect
      ? targetRect
      : {
          top: originRect.top,
          left: originRect.left,
          width: originRect.width,
          height: originRect.height,
          radius: 12,
        };

  const animEasing = isClosing ? "ease-out" : "cubic-bezier(0.175, 0.885, 0.32, 1.275)";
  const animDur = isClosing ? "0.3s" : "0.45s";
  const flipTransition = `top ${animDur} ${animEasing}, left ${animDur} ${animEasing}, width ${animDur} ${animEasing}, height ${animDur} ${animEasing}, border-radius ${animDur} ${animEasing}`;

  return (
    <div
      className="fixed inset-0 z-[100]"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${attachment.name}`}
    >
      <div
        className="absolute inset-0 bg-background/70 backdrop-blur-md transition-opacity duration-400"
        style={{ opacity: isOpen ? 1 : 0 }}
      />
      <div
        style={{
          position: "fixed",
          top: geometry.top,
          left: geometry.left,
          width: geometry.width,
          height: geometry.height,
          borderRadius: geometry.radius,
          transition: flipTransition,
          overflow: "hidden",
          boxShadow: isOpen
            ? "0 24px 60px -12px rgb(0 0 0 / 0.35)"
            : "0 0px 0px 0px rgb(0 0 0 / 0)",
        }}
        className="bg-muted"
        onTransitionEnd={() => {
          if (phase === "closing") onClose();
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          ref={imgRef}
          src={attachment.url}
          alt={attachment.name}
          className="size-full object-cover"
          draggable={false}
        />
      </div>

      <button
        type="button"
        onClick={handleClose}
        aria-label="Close file preview"
        style={{ opacity: isOpen ? 1 : 0, transform: isOpen ? "scale(1)" : "scale(0.7)" }}
        className={cn(
          "fixed right-4 top-4 flex size-9 items-center justify-center rounded-full bg-card/90 text-foreground/70 shadow-md backdrop-blur-sm",
          "transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:bg-card hover:text-foreground",
          !isOpen && "pointer-events-none",
        )}
      >
        <span className="scale-150">
          <CloseIcon />
        </span>
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------
// Main Component
// ----------------------------------------------------------------------

export interface PromptInputProps {
  onSubmit?: (
    value: string,
    meta: { model: string; effort: string; attachments: File[] },
  ) => void | boolean | Promise<void | boolean>;
  onVoice?: () => void;
  placeholder?: string;
  className?: string;
  models?: string[];
  efforts?: string[];
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  maxAttachments?: number;
  accept?: string;
  maxFileBytes?: number;
  onAttachmentError?: (message: string) => void;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  selectedEffort?: string;
  onEffortChange?: (effort: string) => void;
  renderModelIcon?: (model: string) => React.ReactNode;
  renderGroupIcon?: (group: string) => React.ReactNode;
  modelGroups?: Record<string, string>;
  runtimeChoices?: string[];
  localModels?: string[];
  runtimeDescriptions?: Record<string, string>;
  modelLabels?: Record<string, string>;
  unavailableModels?: string[];
  modelPickerFooter?: React.ReactNode;
  /** Compact runtime picker: quiet actions (refresh, connections) behind a small overflow menu. */
  modelPickerMenu?: React.ReactNode;
  /** Move the same selector into the workspace header, leaving one control. */
  modelPickerTarget?: HTMLElement | null;
  modelRuntimeLabel?: string;
  modelDescriptions?: Record<string, string>;
  modelLoading?: boolean;
  hideModelPicker?: boolean;
  controlsAlign?: "left" | "right";
  effortControl?: "cycle" | "slider";
  onModelPickerOpen?: () => void;
  alwaysExpanded?: boolean;
  showEffort?: boolean;
  disabled?: boolean;
  sendDisabled?: boolean;
  busy?: boolean;
  onStop?: () => void;
  inputRef?: React.Ref<HTMLTextAreaElement>;
}

export const PromptInput = React.forwardRef<HTMLDivElement, PromptInputProps>(
  (
    {
      onSubmit,
      onVoice,
      placeholder = "Ask anything",
      className,
      models = [],
      efforts = ["Low", "Medium", "Max Effort"],
      defaultValue = "",
      value: controlledValue,
      onChange,
      maxAttachments = 6,
      accept = "image/*",
      maxFileBytes,
      onAttachmentError,
      selectedModel: controlledModel,
      onModelChange,
      selectedEffort: controlledEffort,
      onEffortChange,
      renderModelIcon,
      renderGroupIcon,
      modelGroups,
      runtimeChoices,
      localModels,
      runtimeDescriptions,
      modelLabels,
      unavailableModels = [],
      modelPickerFooter,
      modelPickerMenu,
      modelPickerTarget,
      modelRuntimeLabel,
      modelDescriptions,
      modelLoading = false,
      hideModelPicker = false,
      controlsAlign = "left",
      effortControl = "cycle",
      onModelPickerOpen,
      alwaysExpanded = false,
      showEffort = false,
      disabled = false,
      sendDisabled = false,
      busy = false,
      onStop,
      inputRef,
    },
    ref,
  ) => {
    const [expanded, setExpanded] = useState(alwaysExpanded);
    const [isSmoothResize, setIsSmoothResize] = useState(false);
    const [localValue, setLocalValue] = useState(defaultValue);
    const [localModel, setSelectedModel] = useState(models[0]);
    const selectedModel = controlledModel ?? localModel;
    const [modelGroup, setModelGroup] = useState(runtimeChoices ? localModels?.includes(selectedModel) ? "Local" : modelGroups?.[selectedModel] || runtimeChoices[0] : "All");
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const [effortIndex, setEffortIndex] = useState(Math.min(1, efforts.length - 1));
    const effort = controlledEffort ?? efforts[effortIndex] ?? efforts[0] ?? "Default";
    const [modelQuery, setModelQuery] = useState("");
    const [isModelSelectOpen, setIsModelSelectOpen] = useState(false);
    const modelTriggerRef = useRef<HTMLButtonElement>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);
    const [modelMenuStyle, setModelMenuStyle] = useState<React.CSSProperties>({});
    const groupOrder = [
      "Jev",
      "Codex",
      "OpenAI",
      "Claude Code",
      "Claude",
      "OpenRouter",
      "DeepSeek",
      "DeepSeek Harness",
      "Hermes",
      "Local",
      "Ollama",
      "LM Studio",
    ];
    const groupRank = (group: string) => {
      const rank = groupOrder.indexOf(group);
      return rank < 0 ? groupOrder.length : rank;
    };
    const orderedGroups = [...new Set(Object.values(modelGroups || {}))].sort(
      (a, b) => groupRank(a) - groupRank(b),
    );
    const visibleModels = models
      .filter(
        (model) =>
          (modelGroup === "Local" && localModels ? localModels.includes(model) : modelGroup === "All" || modelGroups?.[model] === modelGroup) &&
          `${model} ${modelLabels?.[model] || ""}`.toLowerCase().includes(modelQuery.toLowerCase()),
      )
      .sort((a, b) => groupRank(modelGroups?.[a] || "") - groupRank(modelGroups?.[b] || ""));

    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [activeAttachment, setActiveAttachment] = useState<{
      attachment: Attachment;
      rect: DOMRect;
    } | null>(null);

    // Audio/Voice recording states
    const [isRecording, setIsRecording] = useState(false);
    const [audioData, setAudioData] = useState<number[]>(new Array(5).fill(0));
    const valueRef = useRef(controlledValue !== undefined ? controlledValue : localValue);

    // Refs for Web Audio & Speech Recognition cleanup
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const rafRef = useRef<number | null>(null);
    const recognitionRef = useRef<any>(null);
    const demoIntervalRef = useRef<number | null>(null);
    const demoTextIntervalRef = useRef<number | null>(null);

    const [containerHeight, setContainerHeight] = useState(116);
    const [textareaHeight, setTextareaHeight] = useState(68);
    const [isScrolling, setIsScrolling] = useState(false);

    const isControlled = controlledValue !== undefined;
    const value = isControlled ? controlledValue : localValue;
    const hasValue = value.trim() !== "" || attachments.length > 0;
    const hasAttachments = attachments.length > 0;

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const internalContainerRef = useRef<HTMLDivElement>(null);
    const topFadeRef = useRef<HTMLDivElement>(null);
    const bottomFadeRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const attachmentsRef = useRef(attachments);
    attachmentsRef.current = attachments;
    const thumbRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

    // Sync value ref for audio callback closure
    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    const updateFades = () => {
      const el = textareaRef.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (topFadeRef.current) {
        topFadeRef.current.style.opacity = Math.min(scrollTop / 20, 1).toString();
      }
      if (bottomFadeRef.current) {
        const bottomScroll = scrollHeight - clientHeight - scrollTop;
        bottomFadeRef.current.style.opacity = Math.min(
          Math.max(bottomScroll - 16, 0) / 10,
          1,
        ).toString();
      }
    };

    const handleValueChange = useCallback(
      (val: string) => {
        setIsSmoothResize(true);
        if (!isControlled) setLocalValue(val);
        onChange?.(val);
      },
      [isControlled, onChange],
    );

    const expand = () => {
      setIsSmoothResize(false);
      setExpanded(true);
    };

    // --- Voice Recording Logic ---
    const stopRecording = useCallback(() => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (demoIntervalRef.current) {
        window.clearInterval(demoIntervalRef.current);
        demoIntervalRef.current = null;
      }
      if (demoTextIntervalRef.current) {
        window.clearInterval(demoTextIntervalRef.current);
        demoTextIntervalRef.current = null;
      }
      setIsRecording(false);
      setAudioData(new Array(5).fill(0));
    }, []);

    const startRecording = useCallback(async () => {
      setIsSmoothResize(false);
      setExpanded(true);

      let stream: MediaStream | null = null;
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      } catch (err) {
        onAttachmentError?.(
          "Microphone access is unavailable. Check your browser microphone permission.",
        );
      }

      setIsRecording(true);

      if (stream) {
        streamRef.current = stream;

        // Setup Web Audio API for visualizer
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioContextRef.current = audioCtx;

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateVisualizer = () => {
          analyser.getByteFrequencyData(dataArray);
          const bands = new Array(5).fill(0);
          const step = Math.floor(dataArray.length / 5);
          for (let i = 0; i < 5; i++) {
            let sum = 0;
            for (let j = 0; j < step; j++) {
              sum += dataArray[i * step + j];
            }
            bands[i] = sum / step / 255; // normalize to 0-1
          }
          setAudioData(bands);
          rafRef.current = requestAnimationFrame(updateVisualizer);
        };
        updateVisualizer();

        // Setup Speech Recognition
        const SpeechRecognition =
          (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;

          let baseline = valueRef.current;

          recognition.onresult = (event: any) => {
            let interimTranscript = "";
            let finalTranscript = "";

            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
              } else {
                interimTranscript += event.results[i][0].transcript;
              }
            }

            if (finalTranscript) {
              baseline += (baseline ? " " : "") + finalTranscript;
            }

            handleValueChange(
              (baseline + (interimTranscript ? " " + interimTranscript : "")).trim(),
            );
          };

          recognition.onerror = (e: any) => {
            console.error("Speech recognition error", e);
            stopRecording();
          };

          recognition.onend = () => {
            stopRecording();
          };

          recognitionRef.current = recognition;
          recognition.start();
        } else {
          onAttachmentError?.(
            "Speech recognition is unavailable in this browser. Use the voice companion instead.",
          );
          stopRecording();
        }
      } else {
        onAttachmentError?.("Microphone access is unavailable.");
        stopRecording();
      }
    }, [handleValueChange, stopRecording, onAttachmentError]);

    // Keep textarea auto-scrolled to bottom while recording
    useEffect(() => {
      if (isRecording && textareaRef.current) {
        textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
      }
    }, [value, isRecording]);

    // Ensure cleanup of mic/streams on unmount
    useEffect(() => {
      return () => {
        stopRecording();
        attachmentsRef.current.forEach((a) => URL.revokeObjectURL(a.url));
      };
    }, [stopRecording]);

    useEffect(() => {
      if ((value.trim() !== "" || hasAttachments) && !expanded) {
        setIsSmoothResize(false);
        setExpanded(true);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, expanded, hasAttachments]);

    useEffect(() => {
      if (expanded && !isRecording) {
        const timer = setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            const length = textareaRef.current.value.length;
            textareaRef.current.setSelectionRange(length, length);
          }
        }, 50);
        return () => clearTimeout(timer);
      }
    }, [expanded, isRecording]);

    // ONLY updates height on value/text change. Adding attachments leaves this completely isolated.
    useEffect(() => {
      if (!textareaRef.current) return;
      const el = textareaRef.current;

      const currentHeight = el.style.height;
      el.style.transition = "none";
      el.style.height = "0px";
      const scrollHeight = el.scrollHeight;
      el.style.height = currentHeight;
      void el.offsetHeight;
      el.style.transition = "";

      const newHeight = Math.max(68, Math.min(scrollHeight, 160));
      el.style.height = `${newHeight}px`;

      setTextareaHeight(newHeight);
      setIsScrolling(scrollHeight > 160);

      setTimeout(updateFades, 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, expanded]);

    useEffect(() => {
      setContainerHeight(Math.max(116, textareaHeight + 48));
      setTimeout(updateFades, 0);
    }, [textareaHeight]);

    useEffect(() => {
      if (!isModelSelectOpen) return;
      const position = () => {
        const trigger = modelTriggerRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        const width = Math.min(runtimeChoices ? 424 : 400, window.innerWidth - 24);
        const above = rect.top > window.innerHeight - rect.bottom;
        const theme = getComputedStyle(trigger);
        const tokens = Object.fromEntries(
          [
            ...["bg", "panel", "ink", "muted", "border", "inset", "accent", "accent-soft"].map(
              (name) => `--op-${name}`,
            ),
            ...["card", "foreground", "muted-foreground", "border", "accent", "background"].map(
              (name) => `--${name}`,
            ),
          ]
            .map((name) => [name, theme.getPropertyValue(name)])
            .filter(([, value]) => value.trim()),
        );
        setModelMenuStyle({
          ...tokens,
          position: "fixed",
          width,
          // Right-aligned to the model button so the menu opens over the composer.
          left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
          ...(above ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
          maxHeight: Math.max(
            120,
            Math.min(650, (above ? rect.top : window.innerHeight - rect.bottom) - 20),
          ),
          zIndex: 10050,
        });
      };
      position();
      modelMenuRef.current?.querySelector("input")?.focus();
      const handleOutsideClick = (e: MouseEvent) => {
        if (
          internalContainerRef.current &&
          !internalContainerRef.current.contains(e.target as Node) &&
          !modelTriggerRef.current?.contains(e.target as Node) &&
          !modelMenuRef.current?.contains(e.target as Node)
        ) {
          setIsModelSelectOpen(false);
        }
      };
      const onEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          setIsModelSelectOpen(false);
          modelTriggerRef.current?.focus();
        }
      };
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("keydown", onEscape);
      window.addEventListener("resize", position);
      window.addEventListener("scroll", position, true);
      return () => {
        document.removeEventListener("mousedown", handleOutsideClick);
        document.removeEventListener("keydown", onEscape);
        window.removeEventListener("resize", position);
        window.removeEventListener("scroll", position, true);
      };
    }, [isModelSelectOpen]);

    const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
      if (
        internalContainerRef.current &&
        (internalContainerRef.current.contains(e.relatedTarget as Node) ||
          modelMenuRef.current?.contains(e.relatedTarget as Node) ||
          modelTriggerRef.current?.contains(e.relatedTarget as Node))
      )
        return;
      if (!alwaysExpanded && value.trim() === "" && !hasAttachments && !isRecording) {
        setIsSmoothResize(false);
        setExpanded(false);
        setIsModelSelectOpen(false);
      }
    };

    const handleSubmit = async () => {
      if (
        disabled ||
        sendDisabled ||
        busy ||
        submittingRef.current ||
        (value.trim() === "" && !hasAttachments)
      )
        return;
      submittingRef.current = true;
      setSubmitting(true);
      try {
        if (
          (await onSubmit?.(value, {
            model: selectedModel,
            effort,
            attachments: attachments.map((a) => a.file),
          })) === false
        )
          return;
        handleValueChange("");
        attachments.forEach((a) => URL.revokeObjectURL(a.url));
        attachmentsRef.current = [];
        setAttachments([]);
        setExpanded(alwaysExpanded);
        setIsModelSelectOpen(false);
      } catch (error) {
        onAttachmentError?.(
          (error as Error).message || "Could not send. Your draft is still here.",
        );
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    };

    const cycleEffort = (e: React.MouseEvent) => {
      e.stopPropagation();
      const next = (Math.max(0, efforts.indexOf(effort)) + 1) % efforts.length;
      setEffortIndex(next);
      onEffortChange?.(efforts[next]);
    };

    const openFileChooser = (e: React.MouseEvent) => {
      e.stopPropagation();
      fileInputRef.current?.click();
    };

    const handleFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";

      if (files.length === 0 || disabled || busy || submittingRef.current) return;
      const room = Math.max(0, maxAttachments - attachmentsRef.current.length);
      if (files.some((file) => maxFileBytes && file.size > maxFileBytes)) {
        onAttachmentError?.(
          `Each attachment must be under ${Math.round((maxFileBytes || 0) / 1024 / 1024)} MB.`,
        );
        return;
      }
      if (files.length > room)
        onAttachmentError?.(`A message can contain up to ${maxAttachments} files.`);
      const accepted = files.slice(0, room);

      if (!expanded) {
        setIsSmoothResize(false);
        setExpanded(true);
      } else {
        setIsSmoothResize(true);
      }

      // Reserve every slot immediately. Image decoding must not append files
      // after send, bypass the file limit, or recreate a removed attachment.
      const added = accepted.map((file) => ({
        id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        url: URL.createObjectURL(file),
        name: file.name,
        width: 0,
        height: 0,
      }));
      attachmentsRef.current = [...attachmentsRef.current, ...added];
      setAttachments(attachmentsRef.current);
      for (const attachment of added) {
        if (!attachment.file.type.startsWith("image/")) continue;
        const img = new Image();
        img.onload = () =>
          setAttachments((prev) =>
            prev.map((item) =>
              item.id === attachment.id
                ? { ...item, width: img.naturalWidth, height: img.naturalHeight }
                : item,
            ),
          );
        img.src = attachment.url;
      }
    };

    const removeAttachment = (id: string) => {
      if (submittingRef.current) return;
      setIsSmoothResize(true);
      const target = attachmentsRef.current.find((a) => a.id === id);
      if (target) URL.revokeObjectURL(target.url);
      attachmentsRef.current = attachmentsRef.current.filter((a) => a.id !== id);
      setAttachments(attachmentsRef.current);
      thumbRefs.current.delete(id);
    };

    // Calculate action button states
    const showArrow = hasValue && !isRecording && !busy && !submitting;
    const showStop = isRecording || busy || submitting;

    const onActionButtonClick = (e: React.MouseEvent) => {
      e.preventDefault();
      if (busy) {
        onStop?.();
      } else if (isRecording) {
        stopRecording();
      } else if (hasValue) {
        handleSubmit();
      } else {
        if (onVoice) onVoice();
        else startRecording();
      }
    };

    const modelControl = (
      <div className="relative agentic-model-control">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            if (!isModelSelectOpen) {
              if (runtimeChoices) { setModelGroup(localModels?.includes(selectedModel) ? "Local" : modelGroups?.[selectedModel] || runtimeChoices[0]); setModelQuery(""); }
              onModelPickerOpen?.();
            }
            setIsModelSelectOpen((prev) => !prev);
          }}
          className={cn(
            "agentic-model-trigger group flex items-center gap-1 rounded-full px-2 py-1 text-foreground/50 transition-all duration-200 outline-none hover:bg-accent/60 hover:text-foreground cursor-default",
            isModelSelectOpen ? "bg-accent/60 text-foreground" : "",
          )}
          disabled={disabled || busy || submitting}
          aria-expanded={isModelSelectOpen}
          aria-haspopup="dialog"
          ref={modelTriggerRef}
          aria-label={`Select model. Current: ${modelLabels?.[selectedModel] || selectedModel || "Choose model"}`}
        >
          {renderModelIcon ? (
            renderModelIcon(selectedModel)
          ) : (
            <ModelIcon
              model={selectedModel}
              className="size-3.5 opacity-70 group-hover:opacity-100 transition-opacity"
            />
          )}
          <span className="agentic-model-trigger-copy text-xs font-semibold select-none transition-colors">
            {modelPickerTarget ? (
              <span className="agentic-model-header-name">
                {modelLabels?.[selectedModel] || selectedModel || "Choose model"}
              </span>
            ) : (
              <MorphingText
                text={modelLabels?.[selectedModel] || selectedModel || "Choose model"}
              />
            )}
            {modelRuntimeLabel && <small>{modelRuntimeLabel}</small>}
          </span>
          <svg
            className="agentic-model-chevron"
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m4 6 4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {isModelSelectOpen &&
          createPortal(
            <div
              ref={modelMenuRef}
              role="dialog"
              aria-label="Choose a model"
              style={modelMenuStyle}
              aria-hidden={!isModelSelectOpen}
              className={cn(
                "agentic-model-picker rounded-2xl border border-border bg-card p-2 shadow-xl flex flex-col cursor-default",
                className?.includes("ar-agentic-prompt") && "ar-agentic-prompt",
                isModelSelectOpen
                  ? "opacity-100 scale-100 translate-y-0 pointer-events-auto ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                  : "opacity-0 scale-95 translate-y-3 pointer-events-none ease-[cubic-bezier(0.175,0.885,0.32,1.275)]",
              )}
            >
              <div className="flex min-h-0 flex-col gap-1">
                {runtimeChoices ? (
                  <div className="amp-top">
                    <div className="amp-tiles" role="group" aria-label="Who runs this chat">
                      {runtimeChoices.map((group) => (
                        <button type="button" key={group} aria-pressed={modelGroup === group} title={runtimeDescriptions?.[group] || group}
                          onClick={(e) => { e.stopPropagation(); setModelGroup(group); setModelQuery(""); }}>
                          {renderGroupIcon?.(group)}
                          <span>{group}</span>
                        </button>
                      ))}
                    </div>
                    {modelPickerMenu && (
                      <details className="amp-more" onClick={(e) => e.stopPropagation()}>
                        <summary aria-label="More model options" title="Refresh models, connections">
                          <MoreHorizontal size={15} />
                        </summary>
                        <div className="amp-menu">{modelPickerMenu}</div>
                      </details>
                    )}
                  </div>
                ) : (
                  <>
                <div className="agentic-model-picker-heading">
                  <strong>{runtimeChoices ? "Who are we working with?" : "Model & runtime"}</strong>
                  <p>{runtimeChoices ? "Choose a connection, then a model." : "Pick a model. Each option shows what runs it."}</p>
                </div>
                {modelGroups && (
                  <div className={`agentic-model-groups${runtimeChoices ? " is-runtime-grid" : ""}`} role="group" aria-label="Chat runtime">
                    {(runtimeChoices || ["All", ...orderedGroups]).map((group) => (
                      <button type="button" key={group} aria-pressed={modelGroup === group}
                        onClick={(e) => { e.stopPropagation(); setModelGroup(group); setModelQuery(""); }}>
                        {renderGroupIcon?.(group)}
                        <span>{group}</span>
                      </button>
                    ))}
                  </div>
                )}
                  </>
                )}
                <input aria-label="Search available models" value={modelQuery}
                  onChange={(e) => setModelQuery(e.target.value)} placeholder={`Search ${runtimeChoices ? modelGroup + " models" : "models"}…`}
                  className={runtimeChoices ? "amp-search" : "sticky top-0 z-10 rounded-lg border border-border bg-card p-2 m-1 text-xs outline-none"} />
                <div className={`agentic-model-options min-h-0 overflow-y-auto${runtimeChoices ? " amp-list" : ""}`}>
                  {!visibleModels.length && (
                    <p className="p-3 text-xs text-muted-foreground" role="status">
                      {modelLoading
                        ? "Checking available models…"
                        : modelGroup === "Local" && localModels && !localModels.length
                          ? "Start Ollama or LM Studio, then refresh models. You can configure the connection in Settings."
                          : models.length
                          ? "No models match these filters."
                          : "No models found. Open Connections, then check again."}
                    </p>
                  )}
                  {visibleModels.map((model) => (
                    <button
                      key={model}
                      type="button"
                      aria-pressed={model === selectedModel}
                      disabled={unavailableModels.includes(model)}
                      title={
                        unavailableModels.includes(model)
                          ? "This model needs its runtime or sign-in. Check Model connections and refresh."
                          : undefined
                      }
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedModel(model);
                        onModelChange?.(model);
                        setIsModelSelectOpen(false);
                        modelTriggerRef.current?.focus();
                      }}
                      className="group relative flex min-h-10 w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs font-medium text-foreground outline-none hover:bg-accent focus-visible:bg-accent cursor-default disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="flex items-center gap-2">
                        {renderModelIcon ? (
                          renderModelIcon(model)
                        ) : (
                          <ModelIcon
                            model={model}
                            className="size-3.5 opacity-85 group-hover:opacity-100 transition-opacity"
                          />
                        )}
                        <span>
                          {modelLabels?.[model] || model}
                          {modelGroups?.[model] && !runtimeChoices && (
                            <small className="block text-muted-foreground">
                              {modelDescriptions?.[model] || modelGroups[model]}
                            </small>
                          )}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                {!runtimeChoices || !modelPickerMenu ? modelPickerFooter : null}
              </div>
            </div>,
            document.body,
          )}
      </div>
    );

    return (
      <>
        {/* Outer Wrapper for positioning and max-width scaling */}
        <div
          ref={(node) => {
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
            // @ts-ignore
            internalContainerRef.current = node;
          }}
          onBlur={handleBlur}
          className={cn("relative flex flex-col w-full", className)}
          style={{
            maxWidth: alwaysExpanded ? "100%" : expanded ? 480 : 320,
            transition: isSmoothResize
              ? "max-width 0.15s ease-out"
              : "max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            multiple
            onChange={handleFilesChosen}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
          />

          {/* Independent Attachment Tab (Slides up from behind the prompt input) */}
          <div
            aria-hidden={!hasAttachments}
            style={{
              height: hasAttachments && expanded ? 68 : 0,
              transition: isSmoothResize
                ? "height 0.15s ease-out"
                : "height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
            }}
            className="w-full relative z-0 overflow-hidden"
          >
            <div
              style={{
                position: "absolute",
                bottom: -8,
                left: 20,
                right: 20,
                height: 68,
                transform: hasAttachments && expanded ? "translateY(0)" : "translateY(100%)",
                opacity: hasAttachments && expanded ? 1 : 0,
                transition: isSmoothResize
                  ? "transform 0.15s ease-out, opacity 0.15s ease-out"
                  : "transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease-out",
              }}
              className="border border-border border-b-0 bg-muted rounded-t-2xl px-2 pt-2 pb-1 flex items-start gap-2 overflow-x-auto prompt-scrollbar"
            >
              {attachments.map((attachment, index) => (
                <AttachmentThumb
                  key={attachment.id}
                  attachment={attachment}
                  index={index}
                  onRemove={removeAttachment}
                  onOpen={(a, rect) => setActiveAttachment({ attachment: a, rect })}
                  registerRef={(id, el) => thumbRefs.current.set(id, el)}
                />
              ))}
            </div>
          </div>

          {/* Main Input Card */}
          <div
            onMouseDown={(e) => {
              const isTextarea =
                e.target instanceof HTMLInputElement || e.target === textareaRef.current;
              if (expanded && !isTextarea && !isRecording) {
                e.preventDefault();
                textareaRef.current?.focus();
              }
            }}
            style={{
              borderRadius: 24,
              height: expanded ? containerHeight : 48,
              transition: isSmoothResize ? SMOOTH_HEIGHT_TRANSITION : SPRING_TRANSITION,
              overflow: expanded ? "visible" : "hidden",
            }}
            className={cn(
              "relative w-full border border-border bg-card shadow-sm focus-within:border-ring/40 focus-within:ring-1 focus-within:ring-ring/20 hover:border-border/80 z-10",
              expanded ? "cursor-text" : "cursor-default",
            )}
          >
            <style
              dangerouslySetInnerHTML={{
                __html: `
              .prompt-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; background: transparent; }
              .prompt-scrollbar::-webkit-scrollbar-track { background: transparent; }
              .prompt-scrollbar::-webkit-scrollbar-thumb { background: transparent; border-radius: 4px; }
              .prompt-scrollbar:hover::-webkit-scrollbar-thumb { background: hsl(var(--muted-foreground) / 0.3); }
            `,
              }}
            />

            <textarea
              ref={(node) => {
                textareaRef.current = node;
                if (typeof inputRef === "function") inputRef(node);
                else if (inputRef) inputRef.current = node;
              }}
              value={value}
              onChange={(e) => handleValueChange(e.target.value)}
              onScroll={updateFades}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSubmit();
                }
                if (
                  !alwaysExpanded &&
                  e.key === "Escape" &&
                  value.trim() === "" &&
                  !hasAttachments
                ) {
                  setIsSmoothResize(false);
                  setExpanded(false);
                  setIsModelSelectOpen(false);
                }
              }}
              placeholder={placeholder}
              aria-label="Prompt"
              disabled={isRecording || disabled || submitting}
              style={{
                transition: isSmoothResize
                  ? "height 0.15s ease-out"
                  : "opacity 0.3s ease-out, transform 0.3s ease-out, height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
              }}
              className={cn(
                "prompt-scrollbar absolute top-0 inset-x-0 z-[1] w-full resize-none bg-transparent pl-4 pr-12 py-3.5 text-sm leading-[22px] text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground/80 cursor-text",
                expanded
                  ? "opacity-100 scale-100 translate-y-0"
                  : "opacity-0 scale-95 -translate-y-1 pointer-events-none",
                isScrolling ? "overflow-y-auto" : "overflow-y-hidden",
                isRecording && "pointer-events-none",
              )}
            />

            <div
              ref={topFadeRef}
              className="absolute left-4 right-12 top-0 z-[2] h-8 bg-gradient-to-b from-card via-card/90 to-transparent pointer-events-none"
            />
            <div
              ref={bottomFadeRef}
              className="absolute left-4 right-12 z-[2] h-8 bg-gradient-to-t from-card via-card/90 to-transparent pointer-events-none"
              style={{
                opacity: 0,
                top: `${textareaHeight - 32}px`,
                transition: isSmoothResize
                  ? "top 0.15s ease-out"
                  : "top 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
              }}
            />

            <button
              type="button"
              onClick={expand}
              style={{
                transition: isSmoothResize
                  ? "none"
                  : "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
              }}
              className={cn(
                "absolute inset-x-0 top-0 z-[1] cursor-text pl-4 pr-12 py-[15px] text-left text-sm font-medium leading-[17px] text-muted-foreground/80 outline-none",
                !expanded
                  ? "opacity-100 scale-100 translate-y-0"
                  : "opacity-0 scale-105 translate-y-1 pointer-events-none",
              )}
              tabIndex={expanded ? -1 : 0}
              aria-hidden={expanded}
              aria-label="Open prompt input"
            >
              {placeholder}
            </button>

            {/* Bottom Actions Wrapper - Hides when recording to make space for visualizer */}
            <div
              className={cn(
                "agentic-composer-controls absolute bottom-2 left-3 right-12 z-[10] flex items-center gap-0 transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]",
                controlsAlign === "right" && "is-right-aligned",
                expanded && !isRecording
                  ? "opacity-100 blur-0 translate-y-0 pointer-events-auto"
                  : "opacity-0 blur-sm translate-y-2 pointer-events-none",
              )}
            >
              {!hideModelPicker && (modelPickerTarget ? createPortal(modelControl, modelPickerTarget) : modelControl)}

              {(efforts.length > 1 || showEffort) && (effortControl === "slider" ? <EffortSlider levels={efforts} value={effort} disabled={disabled || busy || submitting} onChange={next => { setEffortIndex(efforts.indexOf(next)); onEffortChange?.(next); }} /> : (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={cycleEffort}
                  disabled={disabled || efforts.length < 2 || busy || submitting}
                  title={
                    efforts.length < 2
                      ? "Uses this harness’s configured reasoning"
                      : "Change reasoning effort"
                  }
                  className="group flex items-center gap-1 rounded-full px-2 py-1 text-foreground/50 transition-all duration-200 hover:bg-accent/60 hover:text-foreground outline-none cursor-default"
                >
                  <DynamicBarsIcon level={effort} />
                  <span className="text-xs font-semibold select-none transition-colors">
                    <MorphingText text={effort} />
                  </span>
                </button>
              ))}

              {maxAttachments > 0 && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openFileChooser}
                  aria-label="Attach files"
                  title="Attach files"
                  disabled={disabled || busy || submitting || attachments.length >= maxAttachments}
                  className="ml-auto flex size-7 items-center justify-center rounded-full text-foreground/50 transition-all duration-200 hover:bg-accent/60 hover:text-foreground outline-none cursor-default disabled:opacity-40 disabled:pointer-events-none"
                >
                  <PlusIcon />
                </button>
              )}
            </div>

            {/* Audio Wave Visualizer Overlay positioned precisely to the left of the mic button */}
            <div
              className={cn(
                "absolute right-12 bottom-2 z-[10] flex h-8 items-center justify-end gap-[3px] transition-all duration-400 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]",
                isRecording
                  ? "w-16 opacity-100 translate-x-0"
                  : "w-0 opacity-0 translate-x-4 pointer-events-none",
              )}
            >
              {audioData.map((val, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full bg-primary transition-[height] duration-75 ease-out"
                  style={{ height: `${Math.max(4, val * 24)}px` }}
                />
              ))}
            </div>

            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={onActionButtonClick}
              disabled={disabled || submitting || (sendDisabled && hasValue && !busy)}
              aria-label={
                busy
                  ? "Stop response"
                  : submitting
                    ? "Reading attachments"
                    : showArrow
                      ? "Send prompt"
                      : showStop
                        ? "Stop recording"
                        : "Use voice input"
              }
              style={{ borderRadius: 12 }}
              className={cn("agentic-prompt-send absolute right-2 bottom-2 z-[10] flex h-8 w-8 items-center justify-center bg-primary text-primary-foreground transition-all duration-300 hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-default", (showArrow || busy || submitting) && "is-send", (busy || submitting) && "is-working")}
            >
              <span className="agentic-action-glyph" key={showStop ? "stop" : showArrow ? "send" : "voice"}>
                {showStop ? <StopIcon /> : showArrow ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg> : <MicIcon />}
              </span>
            </button>
          </div>
        </div>

        {activeAttachment && (
          <AttachmentGalleryModal
            attachment={activeAttachment.attachment}
            originRect={activeAttachment.rect}
            onClose={() => setActiveAttachment(null)}
          />
        )}
      </>
    );
  },
);

PromptInput.displayName = "PromptInput";
