/** Shared types for the Motion Library page. */
import type { Theme } from "@/motion/engine/types";

export type Chip =
  | { kind: "style"; key: string; id: string; name: string; thumb?: string | null }
  | {
      kind: "logo" | "image";
      key: string;
      name: string;
      dataUrl: string;
      path?: string;
      display?: string;
      /** The theme this logo gives the wall (null for a black or white logo). */
      theme?: Theme | null;
      status: "uploading" | "ready" | "error";
      progress?: number;
      error?: string;
    }
  | {
      kind: "video";
      key: string;
      name: string;
      poster?: string | null;
      path?: string;
      display?: string;
      frames?: string[];
      status: "uploading" | "ready" | "error";
      progress?: number;
      error?: string;
    }
  | {
      kind: "url";
      key: string;
      url: string;
      host: string;
      status: "pulling" | "brand" | "reference" | "error";
      brand?: Theme | null;
      logoUrl?: string | null;
      note?: string;
      setup?: boolean;
    };

/** Loop length in seconds (3 to 60). */
export type Seconds = number;

export interface Written {
  prompt: string;
  engine: "claude" | "template" | "plain";
  note?: string;
  ms: number;
  /** A fingerprint of the inputs it was written from. */
  from: string;
}

let counter = 0;
export const newKey = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;
