/**
 * Which personal scars have already been prepared for submission.
 *
 * `kira_share_scar` deliberately uploads nothing — it builds a prefilled link
 * and hands it to the human, so acceptance is never something this machine can
 * observe. That is the right boundary, but it leaves the share PROMPT with no
 * memory: the strongest candidate is by definition the one that keeps scoring
 * highest, so without a ledger it occupies a slot in every future brief, forever,
 * including after its author already promoted it. A recommendation that cannot
 * be dismissed stops being read.
 *
 * So this records exactly one fact, and only the fact it can honestly know:
 * a submission was PREPARED for this id, at this time. Not accepted, not
 * uploaded, not merged. Local-only, like everything else under ~/.kira.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { PERSONAL_SCARS_DIR } from "./personal-scars.js";

/** Sibling of the scar store, so a wiped store takes its ledger with it. */
export const SHARE_LEDGER_PATH = path.join(
  path.dirname(PERSONAL_SCARS_DIR),
  "shared-prepared.json"
);

interface Ledger {
  /** scar id → ISO timestamp a submission was prepared. */
  prepared: Record<string, string>;
}

const EMPTY: Ledger = { prepared: {} };

async function read(): Promise<Ledger> {
  try {
    const raw = await fs.readFile(SHARE_LEDGER_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Ledger>;
    const prepared = parsed?.prepared;
    if (!prepared || typeof prepared !== "object") return { ...EMPTY };
    return { prepared: { ...prepared } };
  } catch {
    // Missing or unreadable ledger is not an error: it means nothing was
    // prepared yet, and a corrupt one must never block recording a failure.
    return { ...EMPTY };
  }
}

/** Ids already prepared for submission. Never throws. */
export async function preparedIds(): Promise<Set<string>> {
  return new Set(Object.keys((await read()).prepared));
}

/**
 * Note that a submission was prepared for `id`. Best-effort: a write failure is
 * swallowed, because losing the ledger costs a duplicate suggestion while
 * throwing here would break the share tool itself.
 */
export async function notePrepared(id: string, now = new Date()): Promise<void> {
  if (!id) return;
  try {
    const ledger = await read();
    ledger.prepared[id] = now.toISOString();
    await fs.mkdir(path.dirname(SHARE_LEDGER_PATH), { recursive: true });
    await fs.writeFile(SHARE_LEDGER_PATH, JSON.stringify(ledger, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
}
