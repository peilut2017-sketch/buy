import { describe, expect, it } from "vitest";
import { variantText } from "./format.ts";

describe("variantText", () => {
  it("lists colour first and size second when the store names them, whatever the order they were saved in", () => {
    expect(variantText({ "מידה": "M", "צבע": "כחול" }, ["צבע", "מידה"])).toBe("צבע: כחול · מידה: M");
  });
  it("keeps unknown groups after the known ones and drops empty values", () => {
    expect(variantText({ "חומר": "כותנה", "מידה": "S", "צבע": " " }, ["צבע", "מידה"])).toBe("מידה: S · חומר: כותנה");
  });
  it("works without any order", () => {
    expect(variantText({ "מידה": "L" })).toBe("מידה: L");
    expect(variantText({})).toBe("");
  });
});
