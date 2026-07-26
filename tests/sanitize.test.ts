import { describe, it, expect } from "vitest";
import {
  sanitize,
  sanitizeWithReport,
  sanitizePayload,
  PATTERNS,
  NOTE_MAX,
  CONTEXT_MAX,
} from "../src/sanitize.ts";
import type { Rule } from "../src/sanitize.ts";
import type { ReportPayloadV1 } from "../src/types.ts";
import fixtures from "./fixtures/redaction-cases.json" with { type: "json" };

describe("sanitize patterns", () => {
  for (const c of fixtures.cases) {
    it(`redacts: ${c.name}`, () => {
      const out = sanitize(c.input, 4096)!;
      if ("expectContains" in c && c.expectContains) {
        expect(out).toContain(c.expectContains);
      }
      if ("expectNotContains" in c && c.expectNotContains) {
        expect(out).not.toContain(c.expectNotContains);
      }
    });
  }

  for (const c of fixtures.negative_cases) {
    it(`leaves untouched: ${c.name}`, () => {
      const out = sanitize(c.input, 4096)!;
      if ("expectEqual" in c && c.expectEqual) {
        expect(out).toBe(c.expectEqual);
      }
      if ("expectContains" in c && c.expectContains) {
        expect(out).toContain(c.expectContains);
      }
    });
  }
});

describe("sanitize edge cases", () => {
  it("returns undefined for undefined input", () => {
    expect(sanitize(undefined, 100)).toBeUndefined();
  });

  it("truncates to maxLen before applying patterns", () => {
    // Use uppercase non-hex filler to avoid triggering any redaction pattern.
    const long = "X".repeat(1000) + " sk-NOTREALNOTREALNOTREALNOTREALNOT";
    const out = sanitize(long, 100)!;
    expect(out.length).toBe(100);
    expect(out).not.toContain("sk-NOTREALNOTREALNOTREALNOTREALNOT");
  });

  it("is idempotent", () => {
    const input = "sk-NOTREALNOTREALNOTREALNOTREALNOT in /home/u/p";
    const once = sanitize(input, 4096)!;
    const twice = sanitize(once, 4096)!;
    expect(twice).toBe(once);
  });
});

describe("sanitizePayload", () => {
  const base: ReportPayloadV1 = {
    v: 1,
    skill_id: "community.deploy-vercel-nextjs.v1",
    status: "success",
    client_id: "00000000-0000-4000-8000-000000000001",
    kira_version: "0.5.0",
    ts: "2026-05-10T00:00:00.000Z",
    env: { os: "linux", node_major: 20, tier: "free" },
  };

  it("passes through when no detail layer", () => {
    expect(sanitizePayload(base)).toEqual(base);
  });

  it("redacts note and context", () => {
    const p: ReportPayloadV1 = {
      ...base,
      detail: {
        note: "leaked sk-NOTREALNOTREALNOTREALNOTREALNOT here",
        context: "in /home/alice/proj",
      },
    };
    const out = sanitizePayload(p);
    expect(out.detail?.note).toContain("[REDACTED]");
    expect(out.detail?.note).not.toContain("sk-NOTREAL");
    expect(out.detail?.context).toContain("/[USER]");
  });

  it("respects field length caps", () => {
    expect(NOTE_MAX).toBe(500);
    expect(CONTEXT_MAX).toBe(2000);
    const p: ReportPayloadV1 = {
      ...base,
      detail: { note: "x".repeat(1000), context: "y".repeat(5000) },
    };
    const out = sanitizePayload(p);
    expect(out.detail?.note?.length).toBe(NOTE_MAX);
    expect(out.detail?.context?.length).toBe(CONTEXT_MAX);
  });
});

describe("sanitizeWithReport", () => {
  it("produces byte-identical text to sanitize()", () => {
    const samples = [
      "env -i HOME=/tmp/x PATH=/usr/bin kira",
      "npm published kira-mcp@0.8.2 successfully",
      "contact alice@example.com from 10.0.0.5",
      "nothing to redact here at all",
      "",
    ];
    for (const s of samples) {
      expect(sanitizeWithReport(s, 4096).text).toBe(sanitize(s, 4096));
    }
  });

  it("reports nothing for clean text", () => {
    const { report } = sanitizeWithReport("plain prose, no secrets", 4096);
    expect(report.hits).toEqual([]);
    expect(report.truncated).toBe(false);
  });

  it("names the rule that fired and counts every span", () => {
    const { report } = sanitizeWithReport("env -i HOME=/tmp/x PATH=/usr/bin", 4096);
    expect(report.hits).toEqual([{ pattern: "env-assignment", count: 2 }]);
  });

  it("no longer eats an npm spec, and says so by reporting nothing", () => {
    // A real corruption found in a live personal-scar store: the lesson said
    // "npm published kira-mcp@0.8.2" and reached disk as "npm published
    // [EMAIL]". A TLD is never all digits, so this is not an address.
    const { text, report } = sanitizeWithReport("npm published kira-mcp@0.8.2", 4096);
    expect(text).toBe("npm published kira-mcp@0.8.2");
    expect(report.hits).toEqual([]);
  });

  it("no longer eats a shell expansion, and says so by reporting nothing", () => {
    // A third real corruption from the same live store: a scar whose whole
    // point was a runbook command reached disk as
    //   `JID=[REDACTED] run view <id> ...'); gh api .../$JID/logs`
    // — `[^\s'"]+` stops at whitespace, so it ate `$(gh` and left a dangling
    // `)`. The lesson now teaches a command that cannot run. A value that is a
    // shell expansion is a REFERENCE, never the secret itself, so keeping it
    // costs no coverage.
    const cmd = "JID=$(gh run view 42 --json jobs)";
    const { text, report } = sanitizeWithReport(cmd, 4096);
    expect(text).toBe(cmd);
    expect(report.hits).toEqual([]);
  });

  it("keeps $VAR and ${VAR} references in a bare-environment command", () => {
    // Stored as `env -i HOME=[REDACTED] PATH=[REDACTED]` in the live store.
    const cmd = "env -i HOME=$HOME PATH=${PATH} kira";
    expect(sanitizeWithReport(cmd, 4096).text).toBe(cmd);
  });

  it("keeps a placeholder value that carries no credential material", () => {
    // Measured over 115 real kira_record_failure calls and the 155-scar live
    // store: every env-assignment span the rule ever rewrote in real text was
    // a prose placeholder, not a secret. These four are verbatim from that
    // data — `HOME=...` and `PATH=(最小)` come from a scar teaching a bare
    // -environment smoke test, whose command the redaction made unrunnable.
    for (const s of [
      "env -i HOME=... PATH=(最小) でスモークする",
      ".env の VAR=値 は source ではexportされない",
      "bash の GROUPS=(...) は読み取り専用",
    ]) {
      const { text, report } = sanitizeWithReport(s, 4096);
      expect(text).toBe(s);
      expect(report.hits).toEqual([]);
    }
  });

  it("still redacts a value that is punctuation around one alnum character", () => {
    // Boundary of the carve-out: "no ASCII alphanumeric" means NONE. One is
    // enough to keep the span redacted.
    expect(sanitize("SECRET=***a***", 4096)).toBe("SECRET=[REDACTED]");
    expect(sanitize("SECRET=***", 4096)).toBe("SECRET=***");
  });

  it("still reports the short-literal false positives it cannot tell apart", () => {
    // Deliberately unfixed and deliberately still REPORTED, like the systemd
    // -unit case below: a one-character number and a UTC offset are alnum and
    // shape-identical to a short secret. Both are real corruptions in the live
    // store (`MAX_THINKING_TOKENS=[REDACTED]`, `JST=[REDACTED]`); narrowing
    // them needs an entropy argument this rule does not have.
    for (const s of ["EnvironmentFile に MAX_THINKING_TOKENS=0 を入れる", "JST=UTC+9"]) {
      expect(sanitizeWithReport(s, 4096).report.hits).toEqual([
        { pattern: "env-assignment", count: 1 },
      ]);
    }
  });

  it("still redacts a literal secret value, and one beside an expansion", () => {
    // Negative control: the narrowing must not release anything that is an
    // actual value. `$`-prefixed spans are spared; the literal beside them
    // is not.
    expect(sanitize("DISCORD_TOKEN=abc123literalsecret", 4096)).toBe(
      "DISCORD_TOKEN=[REDACTED]"
    );
    const { text, report } = sanitizeWithReport("TOKEN=hunter2 PATH=$PATH", 4096);
    expect(text).toBe("TOKEN=[REDACTED] PATH=$PATH");
    expect(report.hits).toEqual([{ pattern: "env-assignment", count: 1 }]);
  });

  it("spares a systemd template unit, whatever its instance id", () => {
    // The other real corruption from the same store, recovered verbatim from
    // the transcript that produced it: `user@1000.service` reached a live scar
    // as `[EMAIL]`, in a lesson whose whole point was that the cgroup parse had
    // picked up the WRONG unit. The instance is not always numeric, so the
    // discriminator is the unit type, not the instance.
    const unit = "cgroup showed user@1000.service, not iroha-worker@1.service";
    const { text, report } = sanitizeWithReport(unit, 4096);
    expect(text).toBe(unit);
    expect(report.hits).toEqual([]);
    expect(sanitize("kura-health@iroha.timer fired", 4096)).toBe(
      "kura-health@iroha.timer fired"
    );
    expect(sanitize("gnome-session-manager@ubuntu.service died", 4096)).toBe(
      "gnome-session-manager@ubuntu.service died"
    );
  });

  it("keeps redacting addresses a unit suffix could be confused with", () => {
    // Negative control for the narrowing. `.target` is the one systemd suffix
    // ICANN has actually delegated, so it is deliberately NOT spared; a domain
    // with more labels than a unit has is not a unit either.
    for (const addr of [
      "noreply@anthropic.com",
      "user@163.com",
      "user@192.168.1.1",
      "buyer@circle.target",
      "user@mail.example.service",
    ]) {
      expect(sanitize(`mail ${addr} now`, 4096), addr).toBe("mail [EMAIL] now");
    }
  });

  it("folds rules that share a name into one entry", () => {
    const two = `ghp_${"a".repeat(30)} and github_pat_${"b".repeat(40)}`;
    const { report } = sanitizeWithReport(two, 4096);
    expect(report.hits).toEqual([{ pattern: "github-token", count: 2 }]);
  });

  it("flags truncation separately from redaction", () => {
    const { report } = sanitizeWithReport("X".repeat(200), 100);
    expect(report.truncated).toBe(true);
    expect(report.hits).toEqual([]);
  });

  it("reports nothing on a second pass (idempotent)", () => {
    const once = sanitize("mail alice@example.com, HOME=/tmp/x", 4096)!;
    expect(sanitizeWithReport(once, 4096).report.hits).toEqual([]);
  });

  it("passes undefined through with an empty report", () => {
    const { text, report } = sanitizeWithReport(undefined, 100);
    expect(text).toBeUndefined();
    expect(report).toEqual({ hits: [], truncated: false });
  });
});

describe("worker sanitizer parity", () => {
  // worker/src/sanitize.ts is a deliberate copy (the Worker must build with no
  // dependency on this project), and a hand-maintained duplicate drifts: the
  // pattern list here changed once while the Worker kept redacting the old way,
  // which is a privacy rule enforced differently on each side of the wire.
  //
  // Sampling cannot certify that. When this suite compared 15 hand-picked
  // strings, 11 of the 16 rules matched NONE of them — the Worker's copy of any
  // of those eleven could have been edited or deleted with the test still
  // green. So parity is asserted structurally first (below), and the samples
  // are demoted to a behavioural cross-check whose coverage is itself asserted.
  const loadWorker = () => import("../worker/src/sanitize.ts");

  // Every redaction fixture, so the battery grows whenever a case is added,
  // plus the shapes that exercise a per-MATCH carve-out — which no fixture can
  // cover, because a spared span redacts to itself and would fail `sanitize
  // patterns` above.
  const battery = [
    ...fixtures.cases.map((c) => c.input),
    "cgroup showed iroha-worker@1.service",
    "kura-health@iroha.timer fired",
    "buyer@circle.target ordered",
    "npm published kira-mcp@0.8.2 ok",
    "run with PATH=$PATH set",
    "JID=$(gh run view 42 --json jobs)",
    "PATH=(最小) と VAR=値 と HOME=...",
    "ghs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "env -i HOME=/tmp/x PATH=/usr/bin kira",
    "plain prose, no secrets",
  ];

  /**
   * Replacements are compared as SOURCE TEXT, which is the only dimension the
   * previous divergence lived in: same regex on both sides, different decision
   * about what to write back. Whitespace is squashed because the two files
   * format the same expression at different nesting depths.
   */
  const replSource = (repl: Rule["repl"]) => String(repl).replace(/\s+/g, " ").trim();

  it("holds a pattern list identical to the client's, entry by entry", async () => {
    const worker = await loadWorker();
    expect(worker.PATTERNS.length).toBe(PATTERNS.length);
    PATTERNS.forEach((rule, i) => {
      const mirror = worker.PATTERNS[i];
      expect(
        {
          name: mirror.name,
          source: mirror.re.source,
          flags: mirror.re.flags,
          repl: replSource(mirror.repl),
        },
        `rule ${i} (${rule.name})`
      ).toEqual({
        name: rule.name,
        source: rule.re.source,
        flags: rule.re.flags,
        repl: replSource(rule.repl),
      });
    });
  });

  // Structural equality cannot see a divergent CONSTANT: both sides would read
  // `SYSTEMD_UNIT_TAIL.test(m)` whatever it holds. Firing every rule at least
  // once is what closes that, so the battery must keep covering all of them.
  it("exercises every rule at least once in the battery", () => {
    PATTERNS.forEach((rule, i) => {
      const fires = battery.some((s) => s.replace(rule.re, rule.repl) !== s);
      expect(fires, `rule ${i} (${rule.name}) is not exercised by any sample`).toBe(true);
    });
  });

  it("redacts identically to the client copy", async () => {
    const worker = await loadWorker();
    for (const s of battery) {
      expect(worker.sanitize(s, 4096), s).toBe(sanitize(s, 4096));
    }
  });
});
