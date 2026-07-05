import { describe, expect, it } from "vitest";
import { nearMatches, tokenize, type SimIndexed } from "../src/similarity.js";

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
