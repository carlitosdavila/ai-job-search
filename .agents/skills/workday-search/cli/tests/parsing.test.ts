import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  descriptionToText,
  parseDetail,
  parseSearch,
  parseSiteUrl,
  postedDate,
  postedDaysAgo,
  stripInvisible,
} from "../src/helpers"
import { splitPostingUrl } from "../src/commands/detail"

const fx = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, "fixtures", name), "utf8"))
const SITE = parseSiteUrl("Ameresco", "https://ameresco.wd5.myworkdayjobs.com/Ameresco")!
const NOW = new Date("2026-11-18T12:00:00Z")

describe("parseSiteUrl", () => {
  test("derives tenant, site and API base", () => {
    expect(SITE.tenant).toBe("ameresco")
    expect(SITE.site).toBe("Ameresco")
    expect(SITE.api).toBe("https://ameresco.wd5.myworkdayjobs.com/wday/cxs/ameresco/Ameresco")
  })
  test("skips a locale segment", () => {
    expect(parseSiteUrl("X", "https://acme.wd1.myworkdayjobs.com/en-US/External/job/a")!.site).toBe("External")
  })
  test("rejects non-Workday and look-alike hosts", () => {
    expect(parseSiteUrl("X", "https://example.com/Ameresco")).toBeNull()
    expect(parseSiteUrl("X", "https://ameresco.wd5.myworkdayjobs.com.evil.io/Ameresco")).toBeNull()
    expect(parseSiteUrl("X", "https://ameresco.wd5.myworkdayjobs.com/")).toBeNull()
  })
})

describe("posted labels", () => {
  test("parse relative ages", () => {
    expect(postedDaysAgo("Posted Today")).toEqual({ days: 0, plus: false })
    expect(postedDaysAgo("Posted Yesterday")).toEqual({ days: 1, plus: false })
    expect(postedDaysAgo("Posted 5 Days Ago")).toEqual({ days: 5, plus: false })
    expect(postedDaysAgo("Posted 30+ Days Ago")).toEqual({ days: 30, plus: true })
    expect(postedDaysAgo("Recently")).toBeNull()
  })
  test("convert to an ISO date; 30+ is unknown", () => {
    expect(postedDate("Posted 5 Days Ago", NOW)).toBe("2026-11-13")
    expect(postedDate("Posted 30+ Days Ago", NOW)).toBeNull()
  })
})

describe("parseSearch on the captured Ameresco response", () => {
  const { total, jobs } = parseSearch(fx("search-ameresco.json"), SITE, NOW)
  test("reads the portal total and skips the malformed entry", () => {
    expect(total).toBe(76)
    expect(jobs).toHaveLength(5)
  })
  test("maps fields and decodes entities", () => {
    const j = jobs[1]
    expect(j.id).toBe("R4148")
    expect(j.title).toBe("PV and Energy Storage Remote Operator & Data Analyst")
    expect(j.company).toBe("Ameresco")
    expect(j.location).toBe("2 Locations")
    expect(j.date).toBe("2026-11-17")
    expect(j.url).toBe(
      "https://ameresco.wd5.myworkdayjobs.com/Ameresco/job/United-States---Massachusetts---Westborough/PV-and-Energy-Storage-Remote-Operator---Data-Analyst_R4148",
    )
  })
  test("every result carries the contract fields", () => {
    for (const j of jobs) {
      for (const k of ["id", "title", "company", "location", "date", "url"]) expect(k in j).toBe(true)
    }
  })
})

describe("detail", () => {
  test("double-escaped description becomes readable text without hidden content", () => {
    const d = parseDetail(fx("detail-ameresco-excerpt.json"), SITE, "https://fallback", NOW)!
    expect(d.title).toBe("Senior Electrical Engineer - Microgrid Controls & Automation Architecture")
    expect(d.description).toContain("Senior Electrical Engineer - Microgrid Controls & Automation Architecture")
    expect(d.description).toContain("• Bachelor's degree in Electrical Engineering.")
    expect(d.description).toContain("• Ability to review confidential US security information.")
    expect(d.description).not.toContain("HIDDEN TEXT")
    expect(d.description).not.toMatch(/<|&lt;|&amp;/)
    expect(d.url).toBe("https://fallback")
  })
  test("plain HTML descriptions are not unescaped a second time", () => {
    expect(descriptionToText("<p>Use &amp;lt;tag&amp;gt; literally</p>")).toBe("Use &lt;tag&gt; literally")
  })
  test("splitPostingUrl accepts Workday posting URLs only", () => {
    const s = splitPostingUrl("https://ameresco.wd5.myworkdayjobs.com/en-US/Ameresco/job/USA-Texas-Dallas/X_R4109")!
    expect(s.site.api).toBe(SITE.api)
    expect(s.jobPath).toBe("/job/USA-Texas-Dallas/X_R4109")
    expect(splitPostingUrl("https://boards.greenhouse.io/acme/jobs/123")).toBeNull()
    expect(splitPostingUrl("https://ameresco.wd5.myworkdayjobs.com@evil.io/Ameresco/job/x")).toBeNull()
  })
  test("stripInvisible removes zero-width and tag characters", () => {
    expect(stripInvisible({ t: "En​ergy\u{E0041}" })).toEqual({ t: "Energy" })
  })
})
