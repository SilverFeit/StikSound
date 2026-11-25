import { describe, expect, it } from "vitest";
import { parseTimeToMs } from "../src/time-parse";

describe("apps/cli time parser", () => {
  it("parses milliseconds, seconds, and mm:ss formats", () => {
    expect(parseTimeToMs("0", "--start")).toBe(0);
    expect(parseTimeToMs("1500", "--start")).toBe(1500);
    expect(parseTimeToMs("1500ms", "--start")).toBe(1500);
    expect(parseTimeToMs("2.5s", "--end")).toBe(2500);
    expect(parseTimeToMs("0:05", "--end")).toBe(5000);
    expect(parseTimeToMs("1:02.5", "--end")).toBe(62500);
  });

  it("rejects malformed or out-of-range time values", () => {
    expect(() => parseTimeToMs("", "--start")).toThrowError(/empty/);
    expect(() => parseTimeToMs("-5s", "--start")).toThrowError(/Invalid/);
    expect(() => parseTimeToMs("1:75", "--start")).toThrowError(/Invalid/);
    expect(() => parseTimeToMs("abc", "--start")).toThrowError(/Invalid/);
  });
});
