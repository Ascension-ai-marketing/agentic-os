/**
 * Brand from URL: Firecrawl's branding format → a Motion Library theme.
 * The key is read server-side only and never leaves this process.
 */
import { isIP } from "node:net";
import { brandTheme, cleanName } from "../engine/brand";
import type { Theme } from "../engine/types";

export const FIRECRAWL_SETUP = "https://www.firecrawl.dev/app/api-keys";

export class BrandError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly setup = false,
  ) {
    super(message);
  }
}

/** Public http(s) pages only. */
export function brandURL(input: unknown): URL {
  if (typeof input !== "string" || !input.trim() || input.length > 2048)
    throw new BrandError("Paste a website address.");
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new BrandError("That doesn't look like a website address.");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new BrandError("Use an http or https address.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".") ||
    (isIP(host) &&
      /^(?:10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|0\.|::1|fc|fd|fe80)/i.test(
        host,
      ))
  )
    throw new BrandError("Use a public website; Firecrawl can't read local addresses.");
  url.hash = "";
  return url;
}

type Branding = {
  colorScheme?: string;
  logo?: string | null;
  colors?: Record<string, string | undefined>;
  fonts?: { family?: string }[];
  typography?: { fontFamilies?: Record<string, string | undefined> };
  images?: { logo?: string | null; favicon?: string | null };
};

export interface BrandResult {
  theme: Theme;
  logoUrl: string | null;
  site: string;
  colors: string[];
}

export async function brandFromUrl(
  input: unknown,
  key: string,
  fallback: Theme,
  fetchImpl: typeof fetch = fetch,
): Promise<BrandResult> {
  const url = brandURL(input);
  if (!key)
    throw new BrandError(
      "Add a Firecrawl key to brand from a URL. Get one at firecrawl.dev, then set FIRECRAWL_API_KEY.",
      412,
      true,
    );
  let response: Response;
  try {
    response = await fetchImpl("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: url.href,
        formats: ["branding"],
        onlyMainContent: false,
        timeout: 60000,
      }),
      signal: AbortSignal.timeout(75000),
    });
  } catch (error) {
    throw new BrandError(
      error instanceof Error && error.name === "TimeoutError"
        ? "Firecrawl took too long. Try again in a moment."
        : "Couldn't reach Firecrawl. Check your connection.",
      502,
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new BrandError("Firecrawl rejected the key. Check FIRECRAWL_API_KEY.", 401, true);
  if (response.status === 402)
    throw new BrandError("Your Firecrawl credits have run out.", 402, true);
  if (response.status === 429)
    throw new BrandError("Firecrawl is rate limiting. Try again in a minute.", 429);
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    error?: string;
    data?: { branding?: Branding; metadata?: Record<string, unknown> };
  } | null;
  if (!response.ok || !body?.success || !body.data?.branding)
    throw new BrandError(
      body?.error
        ? `Firecrawl: ${String(body.error).slice(0, 160)}`
        : "Firecrawl couldn't read that site's brand.",
      502,
    );
  const b = body.data.branding;
  const meta = body.data.metadata ?? {};
  const c = b.colors ?? {};
  const colors = [
    c.primary,
    c.accent,
    c.secondary,
    c.link,
    c.background,
    c.textPrimary,
    c.textSecondary,
  ].filter((x): x is string => typeof x === "string");
  const family =
    b.typography?.fontFamilies?.heading ||
    b.typography?.fontFamilies?.primary ||
    b.fonts?.[0]?.family ||
    null;
  const siteName =
    (typeof meta.ogSiteName === "string" && meta.ogSiteName) ||
    (typeof meta["og:site_name"] === "string" && (meta["og:site_name"] as string)) ||
    (typeof meta.title === "string" && meta.title) ||
    (Array.isArray(meta.title) && typeof meta.title[0] === "string" && meta.title[0]) ||
    "";
  const hostLabel = url.hostname.replace(/^www\./, "").split(".")[0];
  const name =
    cleanName(siteName) || cleanName(hostLabel.charAt(0).toUpperCase() + hostLabel.slice(1));
  const theme = brandTheme(
    {
      colors: [c.primary, c.accent, c.secondary, c.link].filter(
        (x): x is string => typeof x === "string",
      ),
      background: c.background,
      text: c.textPrimary,
      font: family,
      name,
    },
    fallback,
  );
  const logo = b.logo || b.images?.logo || null;
  return {
    theme,
    logoUrl: typeof logo === "string" && /^https?:\/\//.test(logo) ? logo : null,
    site: url.hostname.replace(/^www\./, ""),
    colors,
  };
}
