import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setupDisplayStep,
  setupStoredStep,
  setupDraftStep,
  personalContext,
  personalContextPatch,
  profilePhotoSize,
  editableProfileLinks,
} from "../src/lib/workspace-onboarding-state";
import { workspaceProfile } from "./workspace-profile";

test("old saved setup positions resume in the corresponding three-stage section", () => {
  expect([0, 1, 2, 3, 4, 5].map(setupDisplayStep)).toEqual([0, 0, 1, 1, 1, 2]);
  const root = mkdtempSync(join(tmpdir(), "onboarding-migration-"));
  try {
    const store = workspaceProfile(root);
    store.update({
      name: "Fixture",
      role: "Saved role",
      about: "Personal context",
      responsePreferences: "Short answers",
      publicProfiles: [{ label: "Website", url: "https://example.com/" }],
    });
    for (const display of [0, 1, 2]) {
      store.update({ onboardingStep: setupStoredStep(display) });
      const saved = store.read();
      expect(setupDisplayStep(saved.onboardingStep)).toBe(display);
      expect(saved.role).toBe("Saved role");
      expect(saved.about).toBe("Personal context");
      expect(saved.responsePreferences).toBe("Short answers");
      expect(saved.publicProfiles).toEqual([{ label: "Website", url: "https://example.com/" }]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("draft migration covers every historical version and rejects invalid positions", () => {
  for (const version of [1, 4])
    expect([0, 1, 2].map((step) => setupDraftStep(version, step))).toEqual([0, 1, 2]);
  for (const version of [2, 3])
    expect([0, 1, 2, 3, 4, 5].map((step) => setupDraftStep(version, step))).toEqual([
      0, 0, 1, 1, 1, 2,
    ]);
  for (const [version, step] of [
    [1, 3],
    [4, 3],
    [3, 6],
    [5, 0],
    [3, -1],
    [3, 1.5],
    [3, NaN],
  ])
    expect(setupDraftStep(version, step)).toBeUndefined();
});

test("one personal field retains old preferences and respects both persistence limits", () => {
  expect(personalContext({ about: "Outdoors", responsePreferences: "Direct answers" })).toBe(
    "Outdoors\n\nDirect answers",
  );
  expect(personalContextPatch("Outdoors\n\nDirect answers")).toEqual({
    about: "Outdoors\n\nDirect answers",
    responsePreferences: "",
  });
  const root = mkdtempSync(join(tmpdir(), "onboarding-context-"));
  try {
    const text = `${"a".repeat(2998)}\n\n${"b".repeat(3000)}`;
    const patch = personalContextPatch(text);
    const saved = workspaceProfile(root).update(patch);
    expect(personalContext(saved)).toBe(text);
    expect(saved.about.length).toBeLessThanOrEqual(3000);
    expect(saved.responsePreferences.length).toBeLessThanOrEqual(3000);
    expect(personalContextPatch("")).toEqual({ about: "", responsePreferences: "" });
    expect(() => personalContextPatch("x".repeat(6001))).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("partial social URLs survive draft restore while canonical profile saving still rejects them", () => {
  const partial = [{ label: "YouTube", url: "https://you" }];
  expect(editableProfileLinks(partial)).toEqual(partial);
  const root = mkdtempSync(join(tmpdir(), "onboarding-url-draft-"));
  try {
    const store = workspaceProfile(root);
    expect(() => store.update({ publicProfiles: partial })).toThrow();
    expect(store.read().publicProfiles).toEqual([]);
    const sourced = [
      { label: "Website", url: "https://example.com", source: { id: "note-1", title: "My site" } },
    ];
    expect(editableProfileLinks(sourced)).toEqual(sourced);
    for (const invalid of [
      null,
      [{}],
      [{ label: "", url: "" }],
      Array(9).fill(partial[0]),
      [{ ...partial[0], source: { id: "../private", title: "Invalid" } }],
    ])
      expect(() => editableProfileLinks(invalid)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("large portrait and landscape photos resize without stretching or upscaling", () => {
  expect(profilePhotoSize(6000, 4000)).toEqual({ width: 640, height: 427 });
  expect(profilePhotoSize(4000, 6000)).toEqual({ width: 427, height: 640 });
  expect(profilePhotoSize(32, 24)).toEqual({ width: 32, height: 24 });
  expect(() => profilePhotoSize(0, 100)).toThrow();
  expect(() => profilePhotoSize(NaN, 100)).toThrow();
});
