/**
 * Standalone demo — calls lookup directly (no MCP client needed).
 * Shows both Skills (how to do it) and Scars (what to avoid).
 */
import { loadAllSkills, loadAllScars } from "./index-loader.js";
import { lookup } from "./lookup.js";
import { record } from "./report.js";

const SEP = "─".repeat(64);

async function main(): Promise<void> {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Kira v0.3 — demo                                          ║");
  console.log("║  Where agents shine.                                       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const [skills, scars] = await Promise.all([loadAllSkills(), loadAllScars()]);
  console.log(`[index] Loaded ${skills.length} skill(s) + ${scars.length} scar(s)\n`);

  // ── Test 1: deploy vercel (has skill + scar) ─────────────────────────
  const q1 = { keyword: "deploy vercel", context: ["nextjs"] };
  console.log(`[lookup] ${JSON.stringify(q1)}`);
  const r1 = lookup(skills, scars, q1);
  console.log(`  → ${r1.skill_count} skill(s), ${r1.scar_count} scar(s)\n`);

  if (r1.skill_count > 0) {
    const s = r1.skills[0]!;
    console.log(`  SKILL: ${s.title}`);
    console.log(`  Declaration: "${s.declaration.slice(0, 100)}..."\n`);
  }

  for (const scar of r1.scars) {
    console.log(`  ⚠ SCAR [${scar.severity}] (${scar.hit_count} hits): ${scar.title}`);
    console.log(`    Mistake: ${scar.mistake.slice(0, 120)}...`);
    console.log(`    Instead: ${scar.instead.slice(0, 120)}...\n`);
  }

  // ── Test 2: stripe (has skill + scar) ────────────────────────────────
  const q2 = { keyword: "stripe", context: ["nextjs"] };
  console.log(SEP);
  console.log(`[lookup] ${JSON.stringify(q2)}`);
  const r2 = lookup(skills, scars, q2);
  console.log(`  → ${r2.skill_count} skill(s), ${r2.scar_count} scar(s)\n`);

  if (r2.skill_count > 0) {
    console.log(`  SKILL: ${r2.skills[0]!.title}\n`);
  }
  for (const scar of r2.scars) {
    console.log(`  ⚠ SCAR [${scar.severity}] (${scar.hit_count} hits): ${scar.title}\n`);
  }

  // ── Test 3: prisma (has skill + scar) ────────────────────────────────
  const q3 = { keyword: "prisma", context: ["nextjs"] };
  console.log(SEP);
  console.log(`[lookup] ${JSON.stringify(q3)}`);
  const r3 = lookup(skills, scars, q3);
  console.log(`  → ${r3.skill_count} skill(s), ${r3.scar_count} scar(s)\n`);

  if (r3.skill_count > 0) {
    console.log(`  SKILL: ${r3.skills[0]!.title}\n`);
  }
  for (const scar of r3.scars) {
    console.log(`  ⚠ SCAR [${scar.severity}] (${scar.hit_count} hits): ${scar.title}\n`);
  }

  // ── Test 4: keyword with no matches ──────────────────────────────────
  const q4 = { keyword: "deploy to mars" };
  console.log(SEP);
  console.log(`[lookup] ${JSON.stringify(q4)}`);
  const r4 = lookup(skills, scars, q4);
  console.log(`  → ${r4.skill_count} skill(s), ${r4.scar_count} scar(s) (expected 0)`);

  // ── Test 5: all keywords ─────────────────────────────────────────────
  console.log(SEP);
  console.log("[index] All available keywords:\n");
  const allKeywords = new Set<string>();
  for (const s of skills) s.keywords.forEach((k) => allKeywords.add(k));
  for (const s of scars) s.keywords.forEach((k) => allKeywords.add(k));
  const sorted = Array.from(allKeywords).sort();
  for (const k of sorted) {
    const r = lookup(skills, scars, { keyword: k });
    console.log(`  "${k}" → ${r.skill_count}S ${r.scar_count}X`);
  }

  // ── Report ───────────────────────────────────────────────────────────
  console.log(`\n${SEP}`);
  const ack = await record({
    skill_id: "community.deploy-vercel-nextjs.v1",
    status: "success",
    note: "demo run",
  });
  console.log(`[report] Recorded at ${ack.recorded_at}`);

  console.log("\n✓ demo complete.\n");
}

main().catch((err) => {
  console.error("\n✗ demo failed:", err);
  process.exit(1);
});
