import { describe, it, expect } from "vitest";
import { judgeShareability } from "../src/shareability.js";

/**
 * Collection is the loop's weakest link: recording a failure is automatic and
 * sharing it is one call away, but nothing ever asks. The question a human
 * answers here is narrow — "is this true on a machine that is not mine?" — and
 * the cost of getting it wrong is asymmetric: a false "shareable" spends a
 * reviewer's attention and the author's credibility, while a false negative
 * costs one suggestion that can be made again next session.
 *
 * Measured over 196 real personal scars: 150 name some public tool, which is
 * far too loose to be triage. Requiring weight the author already recorded
 * (critical, or it recurred) takes that to 31.
 */

const base = {
  title: "npm publish returned 404",
  mistake: "Debugged the registry URL after npm publish returned 404.",
  instead: "Check npm whoami first — a 404 on publish is how npm reports dead auth.",
  keywords: ["npm publish"],
  contexts: ["npm"],
};

describe("judgeShareability", () => {
  it("suggests a critical failure about a public surface", () => {
    const v = judgeShareability({ ...base, severity: "critical" });
    expect(v.shareable).toBe(true);
    expect(v.surfaces).toContain("npm");
    expect(v.reason).toContain("critical");
  });

  it("suggests a recurring failure even when it is only a warning", () => {
    const v = judgeShareability({ ...base, severity: "warning", hit_count: 3 });
    expect(v.shareable).toBe(true);
    // The lesson failed to stick for its own author — the strongest available
    // evidence that it is a pattern rather than a one-off.
    expect(v.reason).toContain("3");
  });

  it("holds back a one-off warning — naming npm is not enough on its own", () => {
    const v = judgeShareability({ ...base, severity: "warning", hit_count: 1 });
    expect(v.shareable).toBe(false);
    expect(v.surfaces).toContain("npm"); // the surface is still reported
    expect(v.reason).toMatch(/one-off/);
  });

  it("holds back anything naming this machine or project, however severe", () => {
    for (const local of [
      "the build script under /home/someone/work/thing broke",
      "our internal deploy box at 192.168.1.40 rejected it",
      "うちの本番機だけで再現する",
    ]) {
      const v = judgeShareability({ ...base, mistake: local, severity: "critical" });
      expect(v.shareable, local).toBe(false);
      expect(v.reason).toMatch(/machine or project/);
    }
  });

  it("holds back a failure with no third-party surface at all", () => {
    const v = judgeShareability({
      title: "Misread my own notes and redid finished work",
      mistake: "Assumed a section was unfinished because the heading was terse.",
      instead: "Re-read the whole note before restarting anything.",
      severity: "critical",
    });
    expect(v.shareable).toBe(false);
    expect(v.surfaces).toHaveLength(0);
  });

  it("matches a surface as a word, not as a substring", () => {
    // "git" inside "legitimate", "go" inside "going" — neither is a tool mention.
    const v = judgeShareability({
      title: "A legitimate concern about going forward",
      mistake: "Nothing here is about a tool; the letters merely appear.",
      instead: "Read the words, not the characters.",
      severity: "critical",
    });
    expect(v.surfaces).not.toContain("git");
    expect(v.surfaces).not.toContain("go");
  });
});
