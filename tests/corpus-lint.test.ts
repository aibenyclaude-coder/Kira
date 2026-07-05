/**
 * Corpus quality gate — every shipped skill/scar must pass the same validator
 * that gates community submissions (scripts/validate-entry.mjs). This is the
 * poisoning/leak defense for a corpus whose text is injected into agents'
 * contexts: nothing secret-shaped, nothing structurally broken, honest fields.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { validateScar, validateSkill } from "../scripts/validate-entry.mjs";
import { sanitize } from "../src/sanitize.ts";

const ROOT = join(__dirname, "..");

function loadDir(dir: string): Array<{ file: string; json: unknown }> {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      file: join(dir, f),
      json: JSON.parse(readFileSync(join(dir, f), "utf-8")),
    }));
}

describe("shipped scars pass the submission validator", () => {
  for (const { file, json } of loadDir(join(ROOT, "skills", "scars"))) {
    it(file.split("/").slice(-1)[0]!, () => {
      expect(validateScar(json, { sanitize })).toEqual([]);
    });
  }
});

describe("shipped community skills pass the submission validator", () => {
  for (const { file, json } of loadDir(join(ROOT, "skills", "community"))) {
    it(file.split("/").slice(-1)[0]!, () => {
      expect(validateSkill(json, { sanitize })).toEqual([]);
    });
  }
});

describe("validator rejects what it must", () => {
  it("flags secret-shaped content, missing fields, and dishonest counts", () => {
    const bad = {
      id: "scar.bad.v1",
      keywords: ["one"],
      contexts: [],
      title: "short but ok title",
      summary: "summary is fine here",
      severity: "fatal",
      mistake: "too short",
      instead: "connect with sk-NOTREALNOTREALNOTREALNOTREALNOT and it will work somehow ok",
      hit_count: 0,
      version: "1.0",
      updated_at: "not-a-date",
    };
    const issues: string[] = validateScar(bad, { sanitize });
    expect(issues.join("\n")).toMatch(/keywords/);
    expect(issues.join("\n")).toMatch(/severity/);
    expect(issues.join("\n")).toMatch(/mistake/);
    expect(issues.join("\n")).toMatch(/hit_count/);
    expect(issues.join("\n")).toMatch(/version/);
    expect(issues.join("\n")).toMatch(/updated_at/);
    expect(issues.join("\n")).toMatch(/sanitizer would redact/);
  });
});
