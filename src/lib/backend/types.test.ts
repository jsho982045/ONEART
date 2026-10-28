import { describe, expect, it } from "vitest";
import { friendlyError } from "./types";

describe("friendly errors", () => {
  it("never shows a database code to a person", () => {
    for (const code of ["out_of_ink", "canvas_closed", "email_not_verified", "not_onboarded", "banned", "slow_down", "not_yours", "weird_thing"]) {
      const m = friendlyError(`P0001: ${code}`);
      expect(m).not.toMatch(/_|P0001/);
      expect(m.length).toBeGreaterThan(10);
    }
  });
});
