import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runSearch } from "../src/commands/search"
import { runDetail } from "../src/commands/detail"
import { htmlFetch } from "../src/helpers"

// In-process tests: fetch is stubbed and any unexpected URL fails the test, so
// the suite never reaches a live SelectMinds site.
const SEARCH = readFileSync(join(import.meta.dir, "fixtures", "search-tetratech.html"), "utf8")
const DETAIL = readFileSync(join(import.meta.dir, "fixtures", "detail-tetratech-58033.html"), "utf8")
const BASE = "https://tetratech.referrals.selectminds.com"

const originalFetch = globalThis.fetch
const originalWrite = process.stdout.write
const originalErr = process.stderr.write
let stdout = ""
let requests: string[] = []

function respond(body: string, url: string): Response {
  const r = new Response(body, { status: 200 })
  Object.defineProperty(r, "url", { value: url })
  return r
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "sm-"))
  const reg = join(dir, "sites.json")
  writeFileSync(reg, JSON.stringify([{ name: "Tetra Tech", url: BASE }]))
  process.env.SELECTMINDS_SITES_FILE = reg
  stdout = ""
  requests = []
  process.stdout.write = ((c: string | Uint8Array) => ((stdout += c.toString()), true)) as typeof process.stdout.write
  process.stderr.write = (() => true) as typeof process.stderr.write
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString()
    requests.push(url)
    if (url.startsWith(`${BASE}/jobs/search?`)) return respond(SEARCH, `${BASE}/jobs/search/17439585`)
    if (url === `${BASE}/jobs/search/17439585/page2`) return respond(SEARCH, url)
    if (url.startsWith(`${BASE}/jobs/x-`)) return respond(DETAIL, url)
    throw new Error(`unexpected external request: ${url}`)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalWrite
  process.stderr.write = originalErr
  delete process.env.SELECTMINDS_SITES_FILE
})

describe("runSearch", () => {
  test("page 1: one request, contract shape, portal total", async () => {
    expect(await runSearch({ query: "energy engineer", page: 1, format: "json" })).toBe(0)
    expect(requests).toEqual([`${BASE}/jobs/search?keywords=energy%20engineer`])
    const out = JSON.parse(stdout)
    expect(out.meta).toMatchObject({ count: 3, page: 1, total: 1034 })
    expect(out.results[1]).toMatchObject({ id: "58033", title: "Recruiter - Engineering & Energy", date: null })
  })

  test("page 2 follows the numbered search id", async () => {
    await runSearch({ query: "x", page: 2, format: "json" })
    expect(requests[1]).toBe(`${BASE}/jobs/search/17439585/page2`)
  })

  test("--jobage fetches each posting and fills dates", async () => {
    await runSearch({ query: "x", jobage: 14, page: 1, format: "json" })
    expect(requests.filter((u) => u.includes("/jobs/x-"))).toHaveLength(3)
    const out = JSON.parse(stdout)
    expect(out.results.every((r: { postedAgo: string }) => r.postedAgo === "5 days ago")).toBe(true)
  })

  test("--jobage 3 drops postings older than three days", async () => {
    await runSearch({ query: "x", jobage: 3, page: 1, format: "json" })
    expect(JSON.parse(stdout).results).toHaveLength(0)
  })

  test("--location filters client-side", async () => {
    await runSearch({ query: "x", location: "colorado", page: 1, format: "json" })
    expect(JSON.parse(stdout).results.map((r: { id: string }) => r.id)).toEqual(["58033"])
  })

  test("--limit caps; unknown --site exits 1 without a request", async () => {
    await runSearch({ query: "x", page: 1, limit: 1, format: "json" })
    expect(JSON.parse(stdout).results).toHaveLength(1)
    requests = []
    expect(await runSearch({ query: "x", site: "Nope", page: 1, format: "json" })).toBe(1)
    expect(requests).toHaveLength(0)
  })
})

describe("runDetail", () => {
  test("bare id resolves against the single registry entry", async () => {
    expect(await runDetail({ id: "58033", format: "plain" })).toBe(0)
    expect(requests).toEqual([`${BASE}/jobs/x-58033`])
    expect(stdout).toContain("Requisition: 22100000301")
  })
  test("a non-SelectMinds URL is rejected without a request", async () => {
    expect(await runDetail({ id: "https://boards.greenhouse.io/a/jobs/1", format: "json" })).toBe(1)
    expect(requests).toHaveLength(0)
  })
})

describe("htmlFetch", () => {
  test("returns null on 404 and passes a timeout signal", async () => {
    let init: RequestInit | undefined
    globalThis.fetch = (async (_u: RequestInfo | URL, i?: RequestInit) => {
      init = i
      return new Response("", { status: 404 })
    }) as typeof fetch
    expect(await htmlFetch(`${BASE}/jobs/x-1`)).toBeNull()
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
