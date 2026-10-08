import { expect, test } from "bun:test";
import { ceoJobs, tunnelHost } from "./install-ceo-brain";

const fixture = { repo: "/tmp/os & <repo>", home: "/tmp/home", bun: "/tmp/tools/bun", node: "/tmp/node/bin/node", ngrok: "/tmp/brew/ngrok", wsUrl: "wss://fixture-host.example.invalid/ws" };
const args = (plist: string) => [...plist.matchAll(/^    <string>(.*)<\/string>$/gm)].map((match) => match[1]);

test("the tunnel host comes from the saved Speech Engine address and nothing else", () => {
  expect(tunnelHost("wss://fixture-host.example.invalid/ws")).toBe("fixture-host.example.invalid");
  for (const bad of [undefined, 7, "", "https://fixture-host.example.invalid/ws", "wss://host/ws --authtoken x", "wss://host/other"]) expect(tunnelHost(bad)).toBe("");
});

test("three jobs, each kept alive, started at login and logging inside private storage", () => {
  const { jobs, missing } = ceoJobs(fixture);
  expect(missing).toEqual([]);
  expect(jobs.map((job) => job.label)).toEqual(["com.agentic-os.ceo-brain", "com.agentic-os.ceo-tunnel", "com.agentic-os.dashboard"]);
  for (const job of jobs) {
    expect(job.plist).toContain(`<key>Label</key><string>${job.label}</string>`);
    expect(job.plist).toContain("<key>KeepAlive</key><true/>");
    expect(job.plist).toContain("<key>RunAtLoad</key><true/>");
    expect(job.plist).toContain("<key>WorkingDirectory</key><string>/tmp/os &amp; &lt;repo&gt;</string>");
    expect(job.log.startsWith("/tmp/os & <repo>/.operator-data/ceo/logs/")).toBe(true);
    expect(job.plist).not.toContain("& <");
  }
});

test("each job runs the program the plan names", () => {
  const [brain, tunnel, dashboard] = ceoJobs(fixture).jobs.map((job) => args(job.plist));
  expect(brain).toEqual(["/tmp/tools/bun", "run", "/tmp/os &amp; &lt;repo&gt;/scripts/speech-engine.ts", "serve"]);
  expect(tunnel).toEqual(["/tmp/brew/ngrok", "http", "--url=fixture-host.example.invalid", "3001", "--log=stdout"]);
  expect(dashboard).toEqual(["/tmp/node/bin/node", "/tmp/os &amp; &lt;repo&gt;/node_modules/vite/bin/vite.js", "dev", "--port", "8081", "--strictPort"]);
  expect(dashboard).not.toContain("--open");
});

test("no job carries a key or token: only PATH and HOME are set", () => {
  for (const job of ceoJobs(fixture).jobs) {
    const env = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(job.plist)![1];
    expect([...env.matchAll(/<key>(.*?)<\/key>/g)].map((match) => match[1])).toEqual(["PATH", "HOME"]);
    expect(job.plist).not.toMatch(/authtoken|api[_-]?key|secret/i);
    expect(/<key>PATH<\/key><string>(.*?)<\/string>/.exec(env)![1].split(":")).toContain("/tmp/home/.local/bin");
  }
});

test("a job with no program or no address is reported, not written", () => {
  const { jobs, missing } = ceoJobs({ ...fixture, ngrok: "", node: "", wsUrl: undefined });
  expect(jobs.map((job) => job.name)).toEqual(["brain"]);
  expect(missing.map((job) => job.name)).toEqual(["tunnel", "dashboard"]);
  expect(ceoJobs({ ...fixture, wsUrl: "not an address" }).missing).toEqual([{ name: "tunnel", why: expect.stringContaining("speech:create") }]);
});
