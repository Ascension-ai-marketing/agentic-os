import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parsePublicProfiles, type PublicProfileLink } from "../src/lib/workspace-profile-links";

export interface WorkspaceProfile {
  name: string;
  role: string;
  about: string;
  responsePreferences: string;
  timeZone: string;
  currency: string;
  avatar: string;
  hourlyRate: number | null;
  publicProfiles: PublicProfileLink[];
  /** Tools the operator chose to bring into the OS (agents, editors, runtimes). Ids only. */
  tools: string[];
  /** Where the operator is based. Used for weather and local context in the brief. */
  city: string;
  onboardingFlowVersion: 2;
  onboardingStep: number;
  onboardingCompletedAt?: string;
  updatedAt?: string;
}

function applyProfileFields(
  current: WorkspaceProfile,
  body: Record<string, unknown>,
): WorkspaceProfile {
  if (!body || Array.isArray(body) || typeof body !== "object")
    throw new Error("Choose valid profile fields.");
  const value = { ...current };
  if (body.publicProfiles !== undefined)
    value.publicProfiles = parsePublicProfiles(body.publicProfiles);
  for (const key of ["name", "role", "about", "responsePreferences", "city"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "string") throw new Error("Profile fields must contain text.");
    value[key] = (body[key] as string)
      .trim()
      .slice(0, key === "name" || key === "role" ? 160 : key === "city" ? 80 : 3000);
  }
  if (body.timeZone !== undefined) {
    if (typeof body.timeZone !== "string" || !body.timeZone.trim())
      throw new Error("Choose a valid timezone.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: body.timeZone }).format();
    } catch {
      throw new Error("Choose a valid timezone.");
    }
    value.timeZone = body.timeZone;
  }
  if (body.currency !== undefined) {
    if (
      ![
        "USD",
        "GBP",
        "EUR",
        "AED",
        "CAD",
        "AUD",
        "INR",
        "SGD",
        "CHF",
        "JPY",
        "BRL",
        "ZAR",
      ].includes(body.currency as string)
    )
      throw new Error("Choose a supported currency.");
    value.currency = body.currency as string;
  }
  if (body.avatar !== undefined) {
    if (
      typeof body.avatar !== "string" ||
      body.avatar.length > 700000 ||
      (body.avatar && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(body.avatar))
    )
      throw new Error("Choose a PNG, JPEG or WebP profile photo under 500 KB.");
    if (body.avatar) {
      const data = Buffer.from(body.avatar.split(",")[1], "base64");
      const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpg = data[0] === 255 && data[1] === 216 && data[2] === 255;
      const webp =
        data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
      if (
        data.length > 500000 ||
        !(body.avatar.startsWith("data:image/png;")
          ? png
          : body.avatar.startsWith("data:image/jpeg;")
            ? jpg
            : webp)
      )
        throw new Error("Choose a valid PNG, JPEG or WebP profile photo under 500 KB.");
    }
    value.avatar = body.avatar;
  }
  if (body.hourlyRate !== undefined) {
    if (
      body.hourlyRate !== null &&
      (typeof body.hourlyRate !== "number" ||
        !Number.isFinite(body.hourlyRate) ||
        body.hourlyRate < 0 ||
        body.hourlyRate > 1_000_000)
    )
      throw new Error("Choose an hourly value between 0 and 1,000,000, or leave it blank.");
    value.hourlyRate = body.hourlyRate === null ? null : Math.round(body.hourlyRate * 100) / 100;
  }
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools) || body.tools.length > 60 || body.tools.some((id) => typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)))
      throw new Error("Choose valid tool ids.");
    value.tools = [...new Set(body.tools as string[])];
  }
  if (body.onboardingFlowVersion !== undefined && body.onboardingFlowVersion !== 2)
    throw new Error("Choose a supported setup version.");
  if (body.onboardingStep !== undefined) {
    if (
      !Number.isInteger(body.onboardingStep) ||
      Number(body.onboardingStep) < 0 ||
      Number(body.onboardingStep) > 5
    )
      throw new Error("Choose a valid setup step.");
    value.onboardingStep = Number(body.onboardingStep);
  }
  if (body.complete !== undefined && typeof body.complete !== "boolean")
    throw new Error("Choose a valid setup completion state.");
  return value;
}

export function workspaceProfile(root: string) {
  const folder = join(root, ".operator-data"),
    file = join(folder, "profile.json");
  const blank = (): WorkspaceProfile => ({
    name: "",
    role: "",
    about: "",
    responsePreferences: "",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    currency: "USD",
    avatar: "",
    hourlyRate: null,
    publicProfiles: [],
    tools: [],
    city: "",
    onboardingFlowVersion: 2,
    onboardingStep: 0,
  });
  function read(): WorkspaceProfile {
    if (!existsSync(file)) return blank();
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      // Project only known fields: neither damaged types nor unrelated secrets
      // in this file should reach profile UI or AI context.
      const legacySteps = [0, 4, 5];
      const step = data.onboardingStep;
      if (
        data.onboardingFlowVersion === undefined &&
        (!Number.isInteger(step) || step < 0 || step > 2)
      )
        throw new Error("Invalid legacy setup step.");
      const value = applyProfileFields(blank(), {
        ...data,
        onboardingStep: data.onboardingFlowVersion === undefined ? legacySteps[step] : step,
      });
      for (const key of ["onboardingCompletedAt", "updatedAt"] as const) {
        if (data[key] === undefined) continue;
        if (typeof data[key] !== "string" || !Number.isFinite(Date.parse(data[key])))
          throw new Error();
        value[key] = data[key];
      }
      return value;
    } catch {
      throw new Error("Your profile could not be read. The saved file has been preserved.");
    }
  }
  function update(body: Record<string, unknown>): WorkspaceProfile {
    const value = applyProfileFields(read(), body);
    if (body.complete === true) value.onboardingCompletedAt = new Date().toISOString();
    value.updatedAt = new Date().toISOString();
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(temporary, file);
    return value;
  }
  return { read, update };
}
