import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { lookup, indexItems } from "../src/lookup.ts";
import type { Skill, Scar } from "../src/types.ts";

/**
 * A scar nobody can retrieve is shelf-ware: the corpus grows, the agent still
 * walks into the wall. These are CONTRACT tests over the SHIPPED corpus — they
 * pin that a scar fires for queries phrased the way an agent actually describes
 * the task it is about to start, not for the scar's keywords echoed back.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(HERE, "..", "skills");

function loadDir<T>(dir: string): T[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as T);
}

const skills = indexItems(loadDir<Skill>(join(SKILLS_DIR, "community")));
const scars = indexItems(loadDir<Scar>(join(SKILLS_DIR, "scars")));

const firedScarIds = (keyword: string, context: string[] = []) =>
  lookup(skills, scars, { keyword, context }).scars.map((s) => s.id);

describe("shipped corpus is reachable by agent-phrased queries", () => {
  // The trap: an agent picks up a stale TODO/issue/lead that names a cause,
  // confirms the named code exists, and implements — without ever asking how
  // many real inputs reach that branch. Green tests, zero behaviour change.
  const REACH_SCAR = "scar.lead-names-a-branch-no-input-reaches.v1";

  it.each([
    "implement the fix from a stale TODO",
    "act on an old lead in the issue tracker",
    "code path never taken by real data",
  ])("surfaces the reach scar for %j", (query) => {
    expect(firedScarIds(query)).toContain(REACH_SCAR);
  });
});

/**
 * The floor under the whole corpus: no query is closer to an entry than the
 * words its own author chose for the title. An entry that its own title cannot
 * retrieve is reachable by nothing — it grows the corpus without growing what
 * the agent can find. `scar.threshold-tuned-to-one-example.v1` sat in exactly
 * that state (its title says "Tuned…", its keywords say "tune"/"tuning") until
 * the stemmer learned to fold past tense.
 *
 * Asserted as one list rather than a case per entry so a corpus addition that
 * lands unreachable names itself, and so the failure shows every such entry at
 * once instead of the first.
 */
describe("every shipped entry is retrievable by its own title", () => {
  it("scars", () => {
    const unreachable = scars
      .filter((s) => !firedScarIds(s.title).includes(s.id))
      .map((s) => s.id);
    expect(unreachable).toEqual([]);
  });

  it("skills", () => {
    const unreachable = skills
      .filter(
        (s) =>
          !lookup(skills, scars, { keyword: s.title, context: [] })
            .skills.map((m) => m.id)
            .includes(s.id)
      )
      .map((s) => s.id);
    expect(unreachable).toEqual([]);
  });
});
