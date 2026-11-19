import { describe, expect, test } from "bun:test"
import { isoDate } from "../src/helpers"

// /scrape reads the portal-skill contract field `date` (YYYY-MM-DD); this skill
// stores the ATS timestamp as `posted`. isoDate bridges the two.
describe("isoDate", () => {
  test("keeps the publisher's calendar day from an offset timestamp", () => {
    expect(isoDate("2026-09-30T07:45:41-04:00")).toBe("2026-09-30")
    expect(isoDate("2026-11-18T23:30:00-06:00")).toBe("2026-11-18")
  })
  test("handles a bare date and a millisecond-epoch ISO string", () => {
    expect(isoDate("2026-11-02")).toBe("2026-11-02")
    expect(isoDate(new Date(Date.UTC(2026, 0, 5)).toISOString())).toBe("2026-01-05")
  })
  test("is null for missing or unparseable input, never a guess", () => {
    expect(isoDate(null)).toBeNull()
    expect(isoDate("")).toBeNull()
    expect(isoDate("recently")).toBeNull()
  })
})
