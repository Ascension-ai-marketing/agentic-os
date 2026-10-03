import { parsePublicProfiles, type PublicProfileLink } from "./workspace-profile-links";

/** The profile API still stores the six-step flow; keep upgrades reversible. */
export function setupDisplayStep(stored: number): number {
  return [0, 0, 1, 1, 1, 2][stored] ?? 0;
}

export function setupStoredStep(display: number): number {
  return [0, 4, 5][display] ?? 0;
}

/** v1 already had three stages; v2/v3 used the later six-stage setup. */
export function setupDraftStep(version: number, step: number): number | undefined {
  if (![1, 2, 3, 4].includes(version) || !Number.isInteger(step) || step < 0) return;
  if (version === 1 || version === 4) return step < 3 ? step : undefined;
  return step < 6 ? setupDisplayStep(step) : undefined;
}

export function personalContext(value: { about: string; responsePreferences: string }): string {
  return [value.about, value.responsePreferences].filter(Boolean).join("\n\n");
}

/** Preserve the existing two 3,000-character storage slots behind one question. */
export function personalContextPatch(text: string): { about: string; responsePreferences: string } {
  if (text.length <= 3000) return { about: text, responsePreferences: "" };
  const paragraph = text.lastIndexOf("\n\n", 3000);
  const split = paragraph > 0 && text.length - paragraph - 2 <= 3000 ? paragraph : 3000;
  const remainder = text.slice(split).replace(/^\n\n/, "");
  if (remainder.length > 3000) throw new Error("Keep personal context under 6,000 characters.");
  return { about: text.slice(0, split), responsePreferences: remainder };
}

export const PROFILE_PHOTO_INPUT_LIMIT = 20 * 1024 * 1024;
export const PROFILE_PHOTO_OUTPUT_LIMIT = 500_000;

export function profilePhotoSize(width: number, height: number, maximum = 640) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error("That photo has no readable dimensions.");
  const scale = Math.min(1, maximum / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Resize and strip image metadata in the browser. No original is uploaded. */
export async function prepareProfilePhoto(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > PROFILE_PHOTO_INPUT_LIMIT
  )
    throw new Error("Choose a PNG, JPEG or WebP up to 20 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That photo couldn’t be opened. Try another image."));
      img.src = url;
    });
    const size = profilePhotoSize(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser couldn’t resize the photo. Try another browser.");
    context.fillStyle = "#17151d";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    for (const quality of [0.88, 0.72, 0.55]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (!blob || blob.size > PROFILE_PHOTO_OUTPUT_LIMIT) continue;
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error("That photo couldn’t be prepared. Try another image."));
        reader.readAsDataURL(blob);
      });
    }
    throw new Error("That photo couldn’t be made small enough. Try another image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function editableProfileLinks(value: unknown): PublicProfileLink[] {
  if (
    !Array.isArray(value) ||
    value.length > 8 ||
    value.some(
      (link) =>
        !link ||
        typeof link.label !== "string" ||
        !link.label.trim() ||
        link.label.length > 60 ||
        typeof link.url !== "string" ||
        link.url.length > 2048,
    )
  )
    throw new Error("Invalid saved profile links.");
  return value.map((link) => ({
    label: link.label,
    url: link.url,
    ...(link.source
      ? { source: parsePublicProfiles([{ ...link, url: "https://example.com" }])[0].source }
      : {}),
  }));
}
