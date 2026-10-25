import { describe, expect, it } from "vitest";
import { decideDetection, isDetected, type DecisionInput } from "./detection.ts";

const parentOf = (sku: string) => sku.slice(0, 6);

function run(urlSku: string | null, verifications: [string, string | null][]) {
  const input: DecisionInput = {
    siteId: "example",
    urlSku,
    verifications: verifications.map(([name, value]) => ({ name, value })),
    parentOf,
  };
  return decideDetection(input);
}

describe("decideDetection (spec 4)", () => {
  it("rule 1: URL SKU plus one agreeing confirmation is high", () => {
    const d = run("w817260002", [["canonical", "w817260002"], ["image", null]]);
    expect(d).toMatchObject({ sku: "w817260002", parentSku: "w81726", confidence: "high", conflict: false });
    expect(d.signals.find((s) => s.name === "canonical")?.agrees).toBe(true);
    expect(d.signals.find((s) => s.name === "image")?.agrees).toBe(false);
  });

  it("rule 2: URL SKU with no confirmation available is medium", () => {
    const d = run("w817260002", [["canonical", null], ["ogUrl", null]]);
    expect(d).toMatchObject({ sku: "w817260002", confidence: "medium", conflict: false });
  });

  it("rule 3: two confirmations that contradict the URL win by majority and raise a conflict", () => {
    const d = run("w817260002", [["canonical", "w817260003"], ["image", "w817260003"]]);
    expect(d).toMatchObject({ sku: "w817260003", confidence: "medium", conflict: true });
  });

  it("rule 3: contradicting confirmations that disagree with each other leave nothing decided", () => {
    const d = run("w817260002", [["canonical", "w817260003"], ["image", "w817260004"]]);
    expect(d).toMatchObject({ sku: null, confidence: "none", conflict: true });
    expect(isDetected(d)).toBe(false);
  });

  it("a single contradicting confirmation does not override the URL, but confidence stays medium", () => {
    const d = run("w817260002", [["canonical", "w817260003"], ["image", null]]);
    expect(d).toMatchObject({ sku: "w817260002", confidence: "medium", conflict: true });
  });

  it("agreeing confirmations outweigh contradicting ones", () => {
    const d = run("w817260002", [["canonical", "w817260002"], ["ogUrl", "w817260002"], ["image", "w817260003"]]);
    expect(d).toMatchObject({ sku: "w817260002", confidence: "high" });
  });

  it("rule 4: no URL SKU, two confirmations agree: medium", () => {
    const d = run(null, [["canonical", "w817260002"], ["image", "w817260002"]]);
    expect(d).toMatchObject({ sku: "w817260002", confidence: "medium" });
  });

  it("rule 4: no URL SKU, one confirmation: low, and not treated as detected", () => {
    const d = run(null, [["canonical", "w817260002"], ["image", null]]);
    expect(d).toMatchObject({ sku: "w817260002", confidence: "low" });
    expect(isDetected(d)).toBe(false);
  });

  it("rule 4: no signals at all: none", () => {
    const d = run(null, [["canonical", null]]);
    expect(d).toMatchObject({ sku: null, parentSku: null, confidence: "none" });
  });

  it("rule 4: a tie between two confirmations decides nothing", () => {
    const d = run(null, [["canonical", "w817260002"], ["image", "w817260003"]]);
    expect(d).toMatchObject({ sku: null, confidence: "none" });
  });

  it("normalizes case and whitespace", () => {
    const d = run(" W817260002 ", [["canonical", "w817260002"]]);
    expect(d).toMatchObject({ sku: "w817260002", confidence: "high" });
  });

  it("records every signal, with the URL first", () => {
    const d = run("w817260002", [["canonical", "w817260002"], ["ogUrl", null]]);
    expect(d.signals.map((s) => s.name)).toEqual(["url", "canonical", "ogUrl"]);
  });

  it("isDetected is true for high and medium only", () => {
    expect(isDetected(run("w817260002", [["canonical", "w817260002"]]))).toBe(true);
    expect(isDetected(run("w817260002", []))).toBe(true);
    expect(isDetected(run(null, []))).toBe(false);
  });
});
