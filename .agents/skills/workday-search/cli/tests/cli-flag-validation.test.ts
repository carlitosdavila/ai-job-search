import { describe, expect, test } from "bun:test"
import { runCLI } from "./helpers"

// Every case here exits during argument validation, before any request.
function errorOf(stderr: string): { error: string; code: string } {
  return JSON.parse(stderr.split("\n").filter((l) => l.includes('"error"')).pop() ?? "{}")
}

describe("CLI argument validation", () => {
  test("unknown flag exits 1 with a JSON error", async () => {
    const r = await runCLI(["search", "-q", "energy", "--bogus", "1"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("UNKNOWN_FLAG")
    expect(r.stdout).toBe("")
  })
  test("empty --query exits 1", async () => {
    const r = await runCLI(["search", "-q"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_ARG")
  })
  test("non-integer --jobage exits 1", async () => {
    const r = await runCLI(["search", "-q", "x", "--jobage", "0.5"])
    expect(r.exitCode).toBe(1)
  })
  test("bad --format exits 1", async () => {
    const r = await runCLI(["search", "-q", "x", "--format", "xml"])
    expect(r.exitCode).toBe(1)
  })
  test("detail without an id exits 1", async () => {
    const r = await runCLI(["detail"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("NO_ID")
  })
  test("unknown command exits 1", async () => {
    const r = await runCLI(["crawl"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stderr).code).toBe("BAD_CMD")
  })
})
