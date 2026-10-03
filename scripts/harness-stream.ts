/** Consume only answer deltas; credentials and harness diagnostics never cross this boundary. */
export class HarnessTextStream {
  private decoder = new TextDecoder();
  private buffer = "";
  private size = 0;
  private textLength = 0;
  private completed = false;
  constructor(private readonly onText: (text: string) => void) {}
  push(bytes: Uint8Array) {
    this.size += bytes.length;
    if (this.size > 2_000_000) throw new Error("DeepSeek Harness exceeded the response size limit.");
    this.buffer += this.decoder.decode(bytes, { stream: true });
    const lines = this.buffer.split("\n"); this.buffer = lines.pop() || "";
    for (const line of lines) this.consume(line);
  }
  private consume(line: string) {
    if (!line.trim()) return;
    let event: any;
    try { event = JSON.parse(line); } catch { throw new Error("DeepSeek Harness returned an invalid stream."); }
    if (this.completed) throw new Error("DeepSeek Harness sent data after completion.");
    if (event.type === "error") throw new Error("DeepSeek Harness could not complete this answer. Please retry.");
    if (event.type === "delta" && typeof event.text === "string") {
      this.textLength += event.text.length;
      this.onText(event.text);
    } else if (event.type === "done") this.completed = true;
    else throw new Error("DeepSeek Harness returned an unknown stream event.");
  }
  finish() {
    this.buffer += this.decoder.decode();
    if (this.buffer.trim()) this.consume(this.buffer);
    if (!this.completed || !this.textLength) throw new Error("DeepSeek Harness's answer was incomplete. Please retry.");
  }
}
