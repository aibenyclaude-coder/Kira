import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

// share-ledger.ts resolves its path from KIRA_HOME (via personal-scars ->
// consent) at module load, so each test points KIRA_HOME at a fresh temp dir
// and re-imports the registry — the same pattern as record-failure.test.ts.
let tmp: string;

async function fresh() {
  vi.resetModules();
  return await import("../src/share-ledger.ts");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kira-ledger-test-"));
  process.env.KIRA_HOME = tmp;
});

afterEach(() => {
  delete process.env.KIRA_HOME;
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * kira_share_scar uploads nothing by design, so acceptance is not observable
 * from here. Without a ledger the share prompt has no memory and re-suggests
 * its own strongest candidate forever — including after the author promoted it.
 * A recommendation that cannot be dismissed stops being read.
 */
describe("share ledger", () => {
  it("remembers that a submission was prepared", async () => {
    const { notePrepared, preparedIds } = await fresh();
    expect(await preparedIds()).toEqual(new Set());
    await notePrepared("scar.personal.a.1111.v1");
    expect(await preparedIds()).toEqual(new Set(["scar.personal.a.1111.v1"]));
  });

  it("accumulates rather than replacing", async () => {
    const { notePrepared, preparedIds } = await fresh();
    await notePrepared("scar.personal.a.1111.v1");
    await notePrepared("scar.personal.b.2222.v1");
    expect((await preparedIds()).size).toBe(2);
  });

  it("treats a corrupt ledger as empty instead of throwing", async () => {
    const { SHARE_LEDGER_PATH, preparedIds, notePrepared } = await fresh();
    mkdirSync(dirname(SHARE_LEDGER_PATH), { recursive: true });
    writeFileSync(SHARE_LEDGER_PATH, "{ this is not json", "utf8");
    // Losing the ledger costs a duplicate suggestion. Throwing here would take
    // down the share tool itself, which is a strictly worse trade.
    expect(await preparedIds()).toEqual(new Set());
    await expect(notePrepared("scar.personal.c.3333.v1")).resolves.toBeUndefined();
  });

  it("ignores an empty id", async () => {
    const { notePrepared, preparedIds } = await fresh();
    await notePrepared("");
    expect(await preparedIds()).toEqual(new Set());
  });
});
