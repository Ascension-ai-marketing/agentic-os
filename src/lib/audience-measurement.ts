/** Only scopes whose metric definitions are verified by a shipped adapter. */
export type AudienceMeasurementScope = "youtube-channel-totals-v1";

/** A label or API key does not establish measurement scope or channel identity. */
export function audienceMeasurementIdentity(platform: unknown, scope: unknown, sourceUrl: unknown): string | undefined {
  if (typeof sourceUrl !== "string") return undefined;
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    const path = url.pathname.replace(/\/$/, "");
    if (platform === "youtube" && scope === "youtube-channel-totals-v1" && ["youtube.com", "www.youtube.com"].includes(url.hostname)) {
      const id = path.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})$/)?.[1];
      if (id) return `youtube:${id}`;
    }
  } catch { /* Unknown or malformed metadata remains non-comparable. */ }
  return undefined;
}
