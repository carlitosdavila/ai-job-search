import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runSearch } from "../src/commands/search"
import { runDetail } from "../src/commands/detail"
import { jsonFetch } from "../src/helpers"

// In-process tests: fetch is stubbed and any request to an unexpected URL
// fails the test, so the suite never reaches a live Workday tenant.
const SEARCH = readFileSync(join(import.meta.dir, "fixtures", "search-ameresco.json"), "utf8")
const DETAIL = readFileSync(join(import.meta.dir, "fixtures", "detail-ameresco-excerpt.json"), "utf8")
const API = "https://ameresco.wd5.myworkdayjobs.com/wday/cxs/ameresco/Ameresco"

const originalFetch = globalThis.fetch
const originalWrite = process.stdout.write
const originalErr = process.stderr.write
let stdout = ""
let requests: { url: string; init?: RequestInit }[] = []

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "wd-"))
  const reg = join(dir, "sites.json")
  writeFileSync(reg, JSON.stringify([{ name: "Ameresco", url: "https://ameresco.wd5.myworkdayjobs.com/Ameresco" }]))
  process.env.WORKDAY_SITES_FILE = reg
  stdout = ""
  requests = []
  process.stdout.write = ((c: string | Uint8Array) => ((stdout += c.toString()), true)) as typeof process.stdout.write
  process.stderr.write = (() => true) as typeof process.stderr.write
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    requests.push({ url, init })
    if (url === `${API}/jobs`) return new Response(SEARCH, { status: 200 })
    if (url.startsWith(`${API}/job/`)) return new Response(DETAIL, { status: 200 })
    throw new Error(`unexpected external request: ${url}`)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  process.stdout.write = originalWrite
  process.stderr.write = originalErr
  delete process.env.WORKDAY_SITES_FILE
})

describe("runSearch", () => {
  test("POSTs the query and emits the contract shape", async () => {
    const code = await runSearch({ query: "energy engineer", page: 2, format: "json" })
    expect(code).toBe(0)
    expect(requests[0].init?.method).toBe("POST")
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      appliedFacets: {},
      limit: 20,
      offset: 20,
      searchText: "energy engineer",
    })
    const out = JSON.parse(stdout)
    expect(out.meta.page).toBe(2)
    expect(out.meta.total).toBe(76)
    expect(out.results[0].id).toBe("R4117")
    expect(out.results[0].title).toBe("Project Site Administrator")
    expect(out.results[0].url).toContain("/Ameresco/job/Canada---Ontario---Remote/")
  })

  test("--jobage 14 drops 30+ day postings and keeps recent ones", async () => {
    await runSearch({ query: "x", jobage: 14, page: 1, format: "json" })
    const ids = JSON.parse(stdout).results.map((r: { id: string }) => r.id)
    expect(ids).not.toContain("R4109")
    expect(ids).toContain("R4062")
  })

  test("--jobage 3 drops an 8-day-old posting", async () => {
    await runSearch({ query: "x", jobage: 3, page: 1, format: "json" })
    const ids = JSON.parse(stdout).results.map((r: { id: string }) => r.id)
    expect(ids).toEqual(["R4117", "R4148"])
  })

  test("--location filters but keeps 'N Locations' postings", async () => {
    await runSearch({ query: "x", location: "bristol", page: 1, format: "json" })
    const ids = JSON.parse(stdout).results.map((r: { id: string }) => r.id)
    expect(ids).toEqual(["R4148", "R4062"])
  })

  test("--limit caps results", async () => {
    await runSearch({ query: "x", page: 1, limit: 2, format: "json" })
    expect(JSON.parse(stdout).results).toHaveLength(2)
  })

  test("unknown --site exits 1 without a request", async () => {
    const code = await runSearch({ query: "x", site: "Nope", page: 1, format: "json" })
    expect(code).toBe(1)
    expect(requests).toHaveLength(0)
  })
})

describe("runDetail", () => {
  test("by URL: GETs the job path on the API host", async () => {
    const code = await runDetail({
      id: "https://ameresco.wd5.myworkdayjobs.com/Ameresco/job/USA-Texas-Dallas/Senior-Electrical-Engineer---Microgrid-Controls---Automation-Architecture_R4109",
      format: "json",
    })
    expect(code).toBe(0)
    expect(requests[0].url).toBe(
      `${API}/job/USA-Texas-Dallas/Senior-Electrical-Engineer---Microgrid-Controls---Automation-Architecture_R4109`,
    )
    expect(requests[0].init?.method).toBe("GET")
    expect(JSON.parse(stdout).company).toBe("Ameresco")
  })

  test("by requisition id: one search, then the detail GET", async () => {
    const code = await runDetail({ id: "R4109", site: "ameresco", format: "plain" })
    expect(code).toBe(0)
    expect(requests).toHaveLength(2)
    expect(requests[1].url).toContain("/job/USA-Texas-Dallas/")
    expect(stdout).toContain("• Ability to review confidential US security information.")
  })

  test("a non-Workday URL is rejected without a request", async () => {
    const code = await runDetail({ id: "https://boards.greenhouse.io/acme/jobs/1", format: "json" })
    expect(code).toBe(1)
    expect(requests).toHaveLength(0)
  })
})

describe("jsonFetch", () => {
  test("passes an AbortSignal timeout and returns null on 404", async () => {
    let init: RequestInit | undefined
    globalThis.fetch = (async (_u: RequestInfo | URL, i?: RequestInit) => {
      init = i
      return new Response("", { status: 404 })
    }) as typeof fetch
    expect(await jsonFetch(`${API}/jobs`, {})).toBeNull()
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
