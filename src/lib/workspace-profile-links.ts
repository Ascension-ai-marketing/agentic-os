export type PublicProfileLink = {
  label: string;
  url: string;
  source?: { id: string; title: string };
};
export const PUBLIC_PROFILE_LIMIT = 8;

export function publicProfileUrl(value: unknown): string {
  const error = "Use a public HTTPS link without login details, query strings or fragments.";
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\u0000-\u0020\u007f]/.test(value.trim())
  )
    throw new Error(error);
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(error);
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !host.includes(".") ||
    host.endsWith(".") ||
    host.includes(":") ||
    /^[\d.]+$/.test(host) ||
    /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host)
  )
    throw new Error(error);
  return url.href;
}

export function parsePublicProfiles(value: unknown): PublicProfileLink[] {
  if (!Array.isArray(value) || value.length > PUBLIC_PROFILE_LIMIT)
    throw new Error(`Add up to ${PUBLIC_PROFILE_LIMIT} public profile links.`);
  const seen = new Set<string>();
  return value.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof item.label !== "string" ||
      !item.label.trim() ||
      item.label.length > 60 ||
      /[\u0000-\u001f\u007f]/.test(item.label)
    )
      throw new Error("Give each profile link a short label.");
    const url = publicProfileUrl(item.url);
    if (seen.has(url)) throw new Error("That profile link is already added.");
    seen.add(url);
    const link: PublicProfileLink = { label: item.label.trim(), url };
    if (item.source !== undefined) {
      if (
        !item.source ||
        typeof item.source !== "object" ||
        typeof item.source.id !== "string" ||
        !/^[\w-]{1,160}$/.test(item.source.id) ||
        typeof item.source.title !== "string" ||
        !item.source.title.trim() ||
        item.source.title.length > 160 ||
        /[\u0000-\u001f\u007f]/.test(item.source.title)
      )
        throw new Error("The memory reference for that link is invalid.");
      link.source = { id: item.source.id, title: item.source.title.trim() };
    }
    return link;
  });
}

/** Examine only the explicitly selected excerpt. These are links, not identity claims. */
export function profileLinksInMemory(source: {
  id: string;
  title: string;
  text: string;
}): PublicProfileLink[] {
  const results: PublicProfileLink[] = [];
  const seen = new Set<string>();
  const excerpt = source.text.slice(0, 8000);
  for (const match of excerpt.matchAll(/https:\/\/[^\s<>"`]+/gi)) {
    try {
      const url = publicProfileUrl(match[0].replace(/[)\]},.;!?]+$/, ""));
      if (seen.has(url)) continue;
      const parsed = new URL(url),
        host = parsed.hostname.replace(/^www\./, ""),
        path = parsed.pathname;
      const provider =
        host === "youtube.com" && /^\/(?:@[\w.-]+|channel\/[\w-]+)\/?$/.test(path)
          ? "YouTube"
          : host === "instagram.com" &&
              /^\/(?!p\/|reel\/|stories\/|explore\/|accounts\/)[\w.]+\/?$/.test(path)
            ? "Instagram"
            : host === "linkedin.com" && /^\/(?:in|company)\/[\w-]+\/?$/.test(path)
              ? "LinkedIn"
              : host === "tiktok.com" && /^\/@[\w.-]+\/?$/.test(path)
                ? "TikTok"
                : ["x.com", "twitter.com"].includes(host) &&
                    /^\/(?!home\/?$|search\/?$|explore\/?$|settings\/?$|i\/?$)[\w]{1,15}\/?$/.test(
                      path,
                    )
                  ? "X"
                  : host === "github.com" &&
                      /^\/(?!login\/?$|settings\/?$|explore\/?$)[\w-]+\/?$/.test(path)
                    ? "GitHub"
                    : undefined;
      if (!provider) continue;
      seen.add(url);
      results.push({
        label: provider,
        url,
        source: {
          id: source.id,
          title:
            source.title
              .replace(/[\u0000-\u001f\u007f]/g, " ")
              .trim()
              .slice(0, 160) || "Selected memory",
        },
      });
      if (results.length === PUBLIC_PROFILE_LIMIT) break;
    } catch {
      /* Invalid or private-looking links are not suggestions. */
    }
  }
  return results;
}
