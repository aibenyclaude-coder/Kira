/**
 * Report data lives in ~/.kira/reports.log (KIRA_HOME respected). It used to
 * live in a repo-relative ./reports/reports.log, which broke for installed
 * packages because __dirname points inside node_modules/npx caches.
 *
 * The writer moved. src/aggregate.ts did not, and nothing noticed for months:
 * it was imported by zero modules and had zero tests, so its only symptom was
 * `npm run aggregate` printing "0 skills tracked" against a log holding 59
 * real entries across 2 skills. It has been deleted (src/flywheel.ts owns this
 * job and reads the live path), and these tests keep the dead path dead.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "src");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("reports.log path ownership", () => {
  it("has exactly one reference to the repo-relative reports dir, and it is the deprecation probe", () => {
    // Match the bare path segment, not a particular join() shape: the module
    // this test exists for spelled it `join(PROJECT_ROOT, "reports")`, so a
    // pattern keyed on `join(__dirname, "..", ...)` would have missed it.
    const offenders = tsFiles(SRC)
      .filter((f) => /"reports"/.test(readFileSync(f, "utf-8")))
      .map((f) => f.slice(SRC.length + 1));

    // telemetry.legacyLogPath() only tests the old file for EXISTENCE, to warn.
    // Any other module here is reading data that the writer stopped producing.
    expect(offenders).toEqual(["telemetry.ts"]);
  });

  it("routes every reader of report data through KIRA_HOME", () => {
    const telemetry = readFileSync(join(SRC, "telemetry.ts"), "utf-8");
    const flywheel = readFileSync(join(SRC, "flywheel.ts"), "utf-8");

    expect(telemetry).toContain('join(KIRA_HOME, "reports.log")');
    expect(flywheel).toContain('join(home, "reports.log")');
  });
});
