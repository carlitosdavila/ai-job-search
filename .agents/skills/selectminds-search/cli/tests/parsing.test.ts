import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { dateFromDaysAgo, daysAgo, parseDetail, parseSearch, parseSite, stripInvisible } from "../src/helpers"
import { resolveRef } from "../src/commands/detail"

const fx = (n: string) => readFileSync(join(import.meta.dir, "fixtures", n), "utf8")
const SITE = parseSite("Tetra Tech", "https://tetratech.referrals.selectminds.com")!
const NOW = new Date(2026, 10, 18, 12)

describe("parseSite", () => {
  test("accepts selectminds hosts only", () => {
    expect(SITE.base).toBe("https://tetratech.referrals.selectminds.com")
    expect(parseSite("x", "https://example.com")).toBeNull()
    expect(parseSite("x", "https://tetratech.referrals.selectminds.com.evil.io")).toBeNull()
    expect(parseSite("x", "https://user@tetratech.referrals.selectminds.com")).toBeNull()
  })
})

describe("parseSearch on the captured Tetra Tech page", () => {
  const { total, pages, jobs } = parseSearch(fx("search-tetratech.html"), SITE)
  test("reads total, page count and three cards", () => {
    expect(total).toBe(1034)
    expect(pages).toBe(104)
    expect(jobs.map((j) => j.id)).toEqual(["57052", "58033", "54528"])
  })
  test("maps fields and decodes entities", () => {
    const j = jobs[1]
    expect(j.title).toBe("Recruiter - Engineering & Energy")
    expect(j.company).toBe("Tetra Tech")
    expect(j.location).toBe("Arvada, Colorado, United States")
    expect(j.category).toBe("Human Resources")
    expect(jobs[0].category).toBe("Engineering")
    expect(j.isNew).toBe(true)
    expect(j.date).toBeNull()
    expect(j.url).toBe("https://tetratech.referrals.selectminds.com/jobs/recruiter-engineering-energy-58033")
    expect(jobs[0].title).toContain("Senior Civil Engineering Project Manager – Energy Projects")
    expect(jobs[0].isNew).toBe(false)
  })
  test("every result carries the contract fields", () => {
    for (const j of jobs) for (const k of ["id", "title", "company", "location", "date", "url"]) expect(k in j).toBe(true)
  })
  test("a card whose link points off-site gets the canonical URL", () => {
    const html = `<div id="job_list_99" class="job_list_row"><a href="https://evil.example/jobs/x-99" class="job_link font_bold">T</a></div>`
    expect(parseSearch(html, SITE).jobs[0].url).toBe("https://tetratech.referrals.selectminds.com/jobs/x-99")
  })
})

describe("relative dates", () => {
  test("parse labels", () => {
    expect(daysAgo("5 days ago")).toBe(5)
    expect(daysAgo("Yesterday")).toBe(1)
    expect(daysAgo("Today")).toBe(0)
    expect(daysAgo("a month ago")).toBe(30)
    expect(daysAgo("2 weeks ago")).toBe(14)
    expect(daysAgo("Recently")).toBeNull()
  })
  test("local calendar date", () => {
    expect(dateFromDaysAgo(5, NOW)).toBe("2026-11-13")
    expect(dateFromDaysAgo(null, NOW)).toBeNull()
  })
})

describe("parseDetail on the captured posting", () => {
  const d = parseDetail(fx("detail-tetratech-58033.html"), SITE, "58033", NOW)!
  test("fields", () => {
    expect(d.title).toBe("Recruiter - Engineering & Energy")
    expect(d.location).toBe("Arvada, Colorado, United States")
    expect(d.postedAgo).toBe("5 days ago")
    expect(d.date).toBe("2026-11-13")
    expect(d.requisition).toBe("22100000301")
  })
  test("description is readable and drops hidden text", () => {
    expect(d.description).toContain("Recruiter – Engineering & Energy")
    expect(d.description).toContain("The Opportunity")
    expect(d.description).not.toContain("HIDDEN TEXT")
    expect(d.description).not.toMatch(/<|&amp;/)
  })
})

describe("resolveRef", () => {
  test("bare id with a single-entry registry", () => {
    expect(resolveRef("58033", [SITE])).toEqual({ site: SITE, id: "58033" })
  })
  test("posting URL", () => {
    const r = resolveRef("https://tetratech.referrals.selectminds.com/jobs/recruiter-engineering-energy-58033", [SITE])
    expect(typeof r).not.toBe("string")
    expect((r as { id: string }).id).toBe("58033")
  })
  test("rejects other hosts and bare ids without a site", () => {
    expect(typeof resolveRef("https://boards.greenhouse.io/x/jobs/1", [SITE])).toBe("string")
    expect(typeof resolveRef("58033", [SITE, { ...SITE, name: "Other" }])).toBe("string")
  })
  test("stripInvisible", () => {
    expect(stripInvisible({ t: "Te​tra\u{E0041}" })).toEqual({ t: "Tetra" })
  })
})
