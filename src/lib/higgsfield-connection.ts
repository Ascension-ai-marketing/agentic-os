export function preferredHiggsfieldMode(saved: "api" | "account" | null, api: boolean, account: boolean): "api" | "account" {
  if (saved) return saved;
  return api ? "api" : account ? "account" : "api";
}
export function higgsfieldCredential(key: string, secret = ""): string {
  const value = key.trim().replace(/^Key\s+/i, "");
  const credential = value.includes(":") ? value : `${value}:${secret.trim()}`;
  if (!/^[\x21-\x39\x3b-\x7e]{4,512}:[\x21-\x39\x3b-\x7e]{4,1024}$/.test(credential)) {
    throw new Error("Paste the complete API key from Higgsfield: ID:SECRET. The ID alone cannot connect. Get the full value from open.higgsfield.ai/api-keys.");
  }
  return credential;
}
