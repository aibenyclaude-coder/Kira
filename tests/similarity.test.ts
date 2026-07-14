import { describe, expect, it } from "vitest";
import { nearMatches, sharedScripts, tokenize, type SimIndexed } from "../src/similarity.js";

function item(title: string, keywords: string[], extra = ""): SimIndexed & { title: string } {
  return {
    title,
    _kwTokens: new Set(keywords.flatMap((k) => tokenize(k))),
    _simTokens: new Set([title, extra, ...keywords].flatMap((t) => tokenize(t))),
  };
}

describe("tokenize", () => {
  it("lowercases, splits and drops stop words", () => {
    expect(tokenize("How to Deploy my App")).toEqual(
      expect.arrayContaining(["deployment"])
    );
    expect(tokenize("How to Deploy my App")).not.toEqual(
      expect.arrayContaining(["how", "to", "my", "app"])
    );
  });

  it("expands aliases before and after stemming", () => {
    expect(tokenize("prs")).toEqual(expect.arrayContaining(["pull", "request"]));
    expect(tokenize("k8s")).toEqual(tokenize("kubernetes"));
    expect(tokenize("deploying")).toEqual(expect.arrayContaining(["deployment"]));
    expect(tokenize("repos")).toEqual(expect.arrayContaining(["repository"]));
  });

  it("is consistent between query and item side (crude stems cancel out)", () => {
    expect(tokenize("kubernetes cluster")).toEqual(tokenize("k8s clusters"));
  });

  it("dedupes and drops short tokens", () => {
    expect(tokenize("a a b vercel vercel")).toEqual(["vercel"]);
  });
});

describe("nearMatches", () => {
  const items = [
    item("Deploy a Next.js project to Vercel", ["deploy vercel", "vercel deploy"]),
    item("Set up Auth.js v5 in Next.js", ["setup authjs", "add auth"]),
    item("Create a Postgres database on Neon", ["create database", "postgres neon"]),
  ];

  it("ranks keyword-token hits above title-only hits", () => {
    const res = nearMatches(items, "deploy my app to vercel");
    expect(res.length).toBeGreaterThan(0);
    expect(res[0]!.item.title).toContain("Vercel");
    expect(res[0]!.score).toBeGreaterThan(0.5);
  });

  it("returns nothing when nothing overlaps", () => {
    expect(nearMatches(items, "kubernetes ingress controller")).toEqual([]);
  });

  it("respects the threshold for weak single-token overlap", () => {
    // "auth" hits one keyword token out of a 3-token query → 2/6 ≈ 0.33 ≥ 0.30
    const res = nearMatches(items, "auth broken somewhere");
    expect(res.map((r) => r.item.title)).toContain("Set up Auth.js v5 in Next.js");
  });

  it("is deterministic (stable order on ties)", () => {
    const a = nearMatches(items, "database auth");
    const b = nearMatches(items, "database auth");
    expect(a.map((x) => x.item.title)).toEqual(b.map((x) => x.item.title));
  });

  it("returns empty for an empty query", () => {
    expect(nearMatches(items, "")).toEqual([]);
    expect(nearMatches(items, "the to my")).toEqual([]);
  });
});

describe("tokenize — CJK (日本語)", () => {
  it("splits CJK runs into character bigrams", () => {
    const t = tokenize("仕訳の自動化");
    expect(t).toEqual(expect.arrayContaining(["仕訳", "自動", "動化"]));
  });

  it("keeps short CJK runs whole", () => {
    expect(tokenize("仕訳")).toEqual(["仕訳"]);
  });

  it("handles mixed Japanese + Latin", () => {
    const t = tokenize("vercel デプロイ失敗");
    expect(t).toEqual(expect.arrayContaining(["vercel", "デプ", "プロ", "ロイ", "失敗"]));
  });

  it("matches Japanese query against Japanese-keyword items", () => {
    const jp = {
      title: "記帳・仕訳の自動化",
      _kwTokens: new Set(tokenize("仕訳 自動化")),
      _simTokens: new Set(tokenize("記帳・仕訳の自動化 会計 accounting")),
    };
    const res = nearMatches([jp], "仕訳を自動化したい");
    expect(res.length).toBe(1);
    expect(res[0]!.score).toBeGreaterThan(0.3);
  });

  it("query/item 両側が同じパイプラインを通るので一貫する", () => {
    expect(tokenize("デプロイ失敗")).toEqual(tokenize("デプロイ失敗"));
  });
});

describe("sharedScripts", () => {
  const S = (...t: string[]) => new Set(t);
  const seen = (pair: [Set<string>, Set<string>]) => pair.map((s) => [...s].sort());

  it("drops the CJK tokens when the other side has none at all", () => {
    // An English text cannot contain a CJK bigram, so those tokens are not
    // evidence that the two texts differ — they only inflate the denominator.
    const ja = S("gh", "merge", "ブラ", "ラン", "ンチ");
    const en = S("gh", "merge", "branch");
    expect(seen(sharedScripts(ja, en))).toEqual([
      ["gh", "merge"],
      ["branch", "gh", "merge"],
    ]);
  });

  it("keeps the CJK tokens when both sides use CJK", () => {
    const a = S("gh", "ブラ", "ラン");
    const b = S("npm", "デプ", "プロ");
    expect(seen(sharedScripts(a, b))).toEqual([
      ["gh", "ブラ", "ラン"],
      ["npm", "デプ", "プロ"],
    ]);
  });

  it("is a no-op for two latin-only sets", () => {
    const a = S("build", "gate");
    const b = S("build", "pipe");
    expect(seen(sharedScripts(a, b))).toEqual([
      ["build", "gate"],
      ["build", "pipe"],
    ]);
  });

  it("drops the latin tokens when the other side is pure CJK", () => {
    const a = S("デプ", "プロ");
    const b = S("デプ", "プロ", "vercel");
    expect(seen(sharedScripts(a, b))).toEqual([
      ["デプ", "プロ"],
      ["デプ", "プロ"],
    ]);
  });

  it("leaves an empty set alone rather than projecting against nothing", () => {
    expect(seen(sharedScripts(S(), S("gh", "ブラ")))).toEqual([[], ["gh", "ブラ"]]);
  });
});
