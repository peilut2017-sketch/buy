import { describe, expect, it } from "vitest";
import { normalizeTheme, resolveTheme } from "./theme.ts";

describe("theme", () => {
  it("defaults to light for anything unknown", () => {
    expect(normalizeTheme(undefined)).toBe("light");
    expect(normalizeTheme("purple")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("system")).toBe("system");
  });
  it("resolves system by the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
