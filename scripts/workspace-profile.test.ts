import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceProfile } from "./workspace-profile";
import { profileChanges } from "../src/lib/workspace-profile";
import { businessWorkspace } from "./business-workspace";
import {
  parsePublicProfiles,
  profileLinksInMemory,
  publicProfileUrl,
} from "../src/lib/workspace-profile-links";

test("public profiles are optional, preserve reviewed provenance and survive unrelated saves", () => {
  const root = mkdtempSync(join(tmpdir(), "agentic-public-profile-"));
  try {
    const store = workspaceProfile(root);
    expect(store.read().publicProfiles).toEqual([]);
    const links = [
      {
        label: "My channel",
        url: "https://www.youtube.com/@fixture",
        source: { id: "memory-1", title: "My profile notes" },
      },
    ];
    const saved = store.update({ publicProfiles: links, name: "Fixture" });
    expect(workspaceProfile(root).read().publicProfiles).toEqual(links);
    expect(store.update({ onboardingStep: 3 }).publicProfiles).toEqual(links);
    expect(profileChanges(saved, JSON.parse(JSON.stringify(saved)))).toEqual({});
    expect(profileChanges(saved, { ...saved, publicProfiles: [] })).toEqual({ publicProfiles: [] });
    expect(store.update({ publicProfiles: [] }).publicProfiles).toEqual([]);
    const path = join(root, ".operator-data/profile.json");
    const legacy = JSON.parse(readFileSync(path, "utf8"));
    delete legacy.publicProfiles;
    const before = JSON.stringify(legacy);
    writeFileSync(path, before);
    expect(store.read().publicProfiles).toEqual([]);
    expect(readFileSync(path, "utf8")).toBe(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid public links never replace the saved profile", () => {
  const root = mkdtempSync(join(tmpdir(), "agentic-public-profile-validation-"));
  try {
    const store = workspaceProfile(root);
    store.update({
      name: "Preserved",
      publicProfiles: [{ label: "Website", url: "https://example.com" }],
    });
    const path = join(root, ".operator-data/profile.json"),
      before = readFileSync(path, "utf8");
    for (const url of [
      "javascript:alert(1)",
      "file:///private/profile",
      "http://example.com",
      "https://me:password@example.com",
      "https://example.com?token=secret",
      "https://example.com/#access_token",
      "https://localhost/path",
      "https://127.0.0.1",
      "https://2130706433",
      "https://[::1]",
      "https://host.local",
      "https://example.com:9000",
      "https://exam\nple.com",
    ]) {
      expect(() => store.update({ publicProfiles: [{ label: "Invalid", url }] })).toThrow();
      expect(readFileSync(path, "utf8")).toBe(before);
    }
    expect(() =>
      store.update({
        publicProfiles: Array(9).fill({ label: "Website", url: "https://example.com" }),
      }),
    ).toThrow();
    expect(() =>
      store.update({ publicProfiles: [{ label: "", url: "https://example.com" }] }),
    ).toThrow();
    expect(() =>
      store.update({
        publicProfiles: [
          {
            label: "Website",
            url: "https://example.com",
            source: { id: "bad/path", title: "Notes" },
          },
        ],
      }),
    ).toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(publicProfileUrl(" https://EXAMPLE.com/profile ")).toBe("https://example.com/profile");
    expect(
      parsePublicProfiles([
        { label: "Website", url: "https://example.com", credential: "ignored" },
      ]),
    ).toEqual([{ label: "Website", url: "https://example.com/" }]);
    expect(() =>
      parsePublicProfiles([
        { label: "One", url: "https://example.com" },
        { label: "Two", url: "https://example.com/" },
      ]),
    ).toThrow("already added");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("profile suggestions use only explicit profile URLs in the selected bounded excerpt", () => {
  const source = {
    id: "selected-memory",
    title: "A reviewed memory",
    text: "@someone alone is not a URL. A link: https://www.youtube.com/@creator and [profile](https://linkedin.com/in/someone). A repeat https://www.youtube.com/@creator. A video https://youtube.com/watch?v=abc and post https://x.com/name/status/123 are not profiles. https://instagram.com/accounts/login/ is not a profile. https://x.com/home is not a profile.",
  };
  const found = profileLinksInMemory(source);
  expect(found).toEqual([
    {
      label: "YouTube",
      url: "https://www.youtube.com/@creator",
      source: { id: source.id, title: source.title },
    },
    {
      label: "LinkedIn",
      url: "https://linkedin.com/in/someone",
      source: { id: source.id, title: source.title },
    },
  ]);
  expect(
    profileLinksInMemory({
      ...source,
      text: "Find my socials; I am named Example Person, @example.",
    }),
  ).toEqual([]);
  expect(
    profileLinksInMemory({ ...source, text: "a".repeat(8000) + " https://x.com/after_bound" }),
  ).toEqual([]);
  expect(
    profileLinksInMemory({
      ...source,
      text: Array.from({ length: 20 }, (_, index) => `https://x.com/user${index}`).join(" "),
    }),
  ).toHaveLength(8);
  expect(source.text).toContain("https://www.youtube.com/@creator");
});

test("setup navigation and unrelated edits preserve newer personal and business context", () => {
  const root = mkdtempSync(join(tmpdir(), "agentic-profile-edits-"));
  try {
    const personal = workspaceProfile(root);
    const base = personal.update({ name: "Existing", about: "Original context", timeZone: "UTC" });
    expect(profileChanges(base, { ...base })).toEqual({});
    personal.update({ about: "Context saved in another tab", currency: "GBP" });
    const saved = personal.update({
      ...profileChanges(base, { ...base, role: "Creator" }),
      onboardingStep: 4,
    });
    expect(saved).toMatchObject({
      role: "Creator",
      about: "Context saved in another tab",
      currency: "GBP",
      onboardingStep: 4,
    });
    const business = businessWorkspace(root);
    const original = business.update({
      profile: { businessName: "Original", longTermDirection: "Original direction" },
    }).profile;
    business.update({
      profile: { longTermDirection: "New direction", personalPriorities: "Keep this memory" },
    });
    const result = business.update({
      profile: profileChanges(original, { ...original, businessName: "Updated name" }),
    });
    expect(result.profile).toMatchObject({
      businessName: "Updated name",
      longTermDirection: "New direction",
      personalPriorities: "Keep this memory",
    });
    expect(profileChanges(saved, { ...saved, about: "", hourlyRate: 0 })).toEqual({
      about: "",
      hourlyRate: 0,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("profile persists across store recreation and setup completion preserves existing fields", () => {
  const root = mkdtempSync(join(tmpdir(), "agentic-profile-"));
  try {
    const store = workspaceProfile(root);
    expect(store.read().onboardingCompletedAt).toBeUndefined();
    store.update({
      name: "Alex",
      role: "Creator",
      timeZone: "Asia/Dubai",
      currency: "GBP",
      onboardingStep: 1,
    });
    const next = workspaceProfile(root).update({ complete: true, onboardingStep: 2 });
    expect(next.name).toBe("Alex");
    expect(next.currency).toBe("GBP");
    expect(next.onboardingCompletedAt).toBeTruthy();
    expect(workspaceProfile(root).read()).toEqual(next);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("invalid profile fields never damage an existing profile", () => {
  const root = mkdtempSync(join(tmpdir(), "agentic-profile-"));
  try {
    const store = workspaceProfile(root);
    store.update({ name: "Existing" });
    const path = join(root, ".operator-data/profile.json"),
      before = readFileSync(path, "utf8");
    for (const patch of [
      { timeZone: "Fake/Zone" },
      { currency: "XYZ" },
      { avatar: "https://example.com/private.png" },
      { avatar: "data:image/png;base64,SGVsbG8=" },
      { onboardingStep: 6 },
      { hourlyRate: -1 },
      { hourlyRate: "100" },
      { hourlyRate: Number.NaN },
      { hourlyRate: Infinity },
      { hourlyRate: 1_000_001 },
    ]) {
      expect(() => store.update(patch)).toThrow();
      expect(readFileSync(path, "utf8")).toBe(before);
    }
    writeFileSync(path, "{bad");
    expect(() => store.update({ name: "Overwrite" })).toThrow();
    expect(readFileSync(path, "utf8")).toBe("{bad");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saved profile schema is validated and unknown fields never enter client context", () => {
  const root = mkdtempSync(join(tmpdir(), "agentic-profile-schema-"));
  try {
    const store = workspaceProfile(root);
    const saved = store.update({ name: "Known", timeZone: "UTC" });
    const file = join(root, ".operator-data/profile.json");
    writeFileSync(file, JSON.stringify({ ...saved, credential: "SHOULD-STAY-LOCAL" }));
    expect(store.read()).toEqual(saved);
    for (const invalid of [
      { name: {} },
      { onboardingStep: 99 },
      { avatar: "https://example.com/image" },
      { updatedAt: [] },
    ]) {
      const content = JSON.stringify({ ...saved, ...invalid });
      writeFileSync(file, content);
      expect(() => store.read()).toThrow("preserved");
      expect(() => store.update({ name: "Replace" })).toThrow("preserved");
      expect(readFileSync(file, "utf8")).toBe(content);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hourly value persists in the chosen currency, preserves zero and supports removal", () => {
  const root = mkdtempSync(join(tmpdir(), "agentic-profile-value-"));
  try {
    const store = workspaceProfile(root);
    expect(store.read().hourlyRate).toBeNull();
    store.update({ hourlyRate: 125.555, currency: "GBP", onboardingStep: 5 });
    expect(workspaceProfile(root).read()).toMatchObject({
      hourlyRate: 125.56,
      currency: "GBP",
      onboardingStep: 5,
      onboardingFlowVersion: 2,
    });
    expect(store.update({ hourlyRate: 0 }).hourlyRate).toBe(0);
    expect(store.update({ hourlyRate: null }).hourlyRate).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("old three-step progress resumes at the corresponding screen without completing setup", () => {
  const root = mkdtempSync(join(tmpdir(), "agentic-profile-migration-"));
  try {
    const store = workspaceProfile(root);
    const saved = store.update({ name: "Existing" });
    const { onboardingFlowVersion, hourlyRate, ...legacy } = saved;
    const file = join(root, ".operator-data/profile.json");
    for (const [before, after] of [
      [0, 0],
      [1, 4],
      [2, 5],
    ]) {
      writeFileSync(file, JSON.stringify({ ...legacy, onboardingStep: before }));
      const migrated = store.read();
      expect(migrated.onboardingStep).toBe(after);
      expect(migrated.onboardingFlowVersion).toBe(2);
      expect(migrated.onboardingCompletedAt).toBeUndefined();
      expect(JSON.parse(readFileSync(file, "utf8")).onboardingStep).toBe(before);
      store.update({ onboardingStep: after });
      expect(workspaceProfile(root).read().onboardingStep).toBe(after);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
