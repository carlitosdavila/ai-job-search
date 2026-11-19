// Data source: the public JSON API ("CXS") behind every Workday-hosted careers
// site (<tenant>.wdN.myworkdayjobs.com). No authentication required.
//   search: POST https://<host>/wday/cxs/<tenant>/<site>/jobs   (JSON body)
//   detail: GET  https://<host>/wday/cxs/<tenant>/<site>/job/<path>
// One skill covers any employer on Workday: the employer list lives in a
// personal registry file (workday_sites.json at the repo root, gitignored).

import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

export const UA = "Mozilla/5.0 (compatible; workday-search-cli/1.0)"
export const PAGE_SIZE = 20

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface SiteEntry {
  name: string
  url: string
  notes?: string
}

export interface WorkdaySite {
  name: string
  host: string // e.g. ameresco.wd5.myworkdayjobs.com
  tenant: string // e.g. ameresco
  site: string // e.g. Ameresco
  api: string // https://<host>/wday/cxs/<tenant>/<site>
  publicBase: string // https://<host>/<site>
}

const WORKDAY_HOST = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i
const LOCALE = /^[a-z]{2}-[A-Z]{2}$/

/**
 * Turn a careers-site URL into its API coordinates. Accepts
 * https://<tenant>.wdN.myworkdayjobs.com/<site> with an optional locale
 * segment (/en-US/<site>) and anything after the site name. Any other host is
 * rejected: the CLI only ever talks to Workday.
 */
export function parseSiteUrl(name: string, raw: string): WorkdaySite | null {
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  const hm = u.hostname.match(WORKDAY_HOST)
  if (!hm) return null
  const segs = u.pathname.split("/").filter(Boolean)
  if (segs.length && LOCALE.test(segs[0])) segs.shift()
  const site = segs[0]
  if (!site || site === "wday" || site === "job") return null
  const host = u.hostname.toLowerCase()
  const tenant = hm[1].toLowerCase()
  return {
    name,
    host,
    tenant,
    site,
    api: `https://${host}/wday/cxs/${tenant}/${encodeURIComponent(site)}`,
    publicBase: `https://${host}/${encodeURIComponent(site)}`,
  }
}

const SKILL_DIR = path.resolve(import.meta.dir, "..", "..")
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..", "..")
export const EXAMPLE_REGISTRY = path.join(SKILL_DIR, "workday_sites.example.json")

/** Registry path: $WORKDAY_SITES_FILE, else <repo>/workday_sites.json, else the example. */
export function registryPath(): { file: string; example: boolean } {
  const override = process.env.WORKDAY_SITES_FILE
  if (override) return { file: override, example: false }
  const personal = path.join(REPO_ROOT, "workday_sites.json")
  if (existsSync(personal)) return { file: personal, example: false }
  return { file: EXAMPLE_REGISTRY, example: true }
}

export async function loadRegistry(): Promise<WorkdaySite[]> {
  const { file, example } = registryPath()
  if (example) {
    process.stderr.write(
      JSON.stringify({
        warning: `No personal registry at ${path.join(REPO_ROOT, "workday_sites.json")}; using the example registry. Copy workday_sites.example.json to the repo root as workday_sites.json and edit it.`,
        code: "USING_EXAMPLE_REGISTRY",
      }) + "\n",
    )
  }
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(file, "utf8"))
  } catch (e) {
    throw new Error(`Could not read registry ${file}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!Array.isArray(raw)) throw new Error(`Registry ${file} must be a JSON array of {name, url}`)
  const sites: WorkdaySite[] = []
  for (const entry of raw as SiteEntry[]) {
    if (!entry || typeof entry.name !== "string" || typeof entry.url !== "string") {
      throw new Error(`Registry entry ${JSON.stringify(entry)} needs string "name" and "url"`)
    }
    const s = parseSiteUrl(entry.name, entry.url)
    if (!s) throw new Error(`Registry entry "${entry.name}": "${entry.url}" is not a <tenant>.wdN.myworkdayjobs.com/<site> URL`)
    sites.push(s)
  }
  return sites
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Fetch JSON with exponential backoff + jitter on 429/5xx. Returns null on a
 * 404. GET when body is undefined, otherwise POST with a JSON body (Workday's
 * search endpoint only accepts POST; it is still a read-only query).
 */
export async function jsonFetch(url: string, body?: unknown): Promise<unknown | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers: Record<string, string> = {
      "User-Agent": UA,
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
    }
    if (body !== undefined) headers["Content-Type"] = "application/json"
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`Expected JSON from ${new URL(url).hostname}, got ${text.slice(0, 80).replace(/\s+/g, " ")}`)
    }
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------------------
// Text hygiene (copied from linkedin-search: the repo's output-boundary rules)
// ---------------------------------------------------------------------------

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    // &amp; last, so "&amp;lt;" decodes to the literal text "&lt;", not "<".
    .replace(/&amp;/g, "&")
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab/newline/CR, soft hyphen, bidi
 * controls, zero-width characters and invisible operators, BOM, variation
 * selectors, and Unicode tag characters.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from every string in a result, recursively: the CLI's output boundary. */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])

function isHiddenTag(attrs: string): boolean {
  for (const m of attrs.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ""
    if (name === "hidden") return true
    if (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)) {
      return true
    }
  }
  return false
}

/**
 * Drop markup a browser never renders - comments, <script>/<style>/<template>
 * blocks, and elements marked hidden - before tags are stripped.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  const open = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = m[1].toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag) && !m[0].endsWith("/>")) {
      const same = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi")
      same.lastIndex = end
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = same.exec(src)) !== null) {
        if (s[1]) depth--
        else if (!s[0].endsWith("/>")) depth++
        if (depth === 0) {
          end = same.lastIndex
          break
        }
      }
    }
    kept.push(src.slice(from, m.index))
    from = end
    open.lastIndex = end
  }
  kept.push(src.slice(from))
  return kept.join("")
}

function stripTags(html: string): string {
  return visibleHtml(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

/** Decode entities in a plain-text field (titles, locations arrive as "&amp;"). */
export function cleanText(s: unknown): string | null {
  if (typeof s !== "string") return null
  const out = decodeHtmlEntities(stripTags(s)).replace(/\s+/g, " ").trim()
  return out || null
}

/**
 * Workday's jobDescription is HTML; some tenants entity-escape it once more
 * ("&lt;p&gt;"). Unescape that outer layer only when the field carries no real
 * tags, then keep paragraph and list breaks as newlines.
 */
export function descriptionToText(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  let html = raw
  if (!/<[a-z!/]/i.test(html) && /&lt;[a-z/]/i.test(html)) {
    html = html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
  }
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    // Inline formatting tags vanish without a space, so "<b>5 GW</b>." stays "5 GW."
    .replace(/<\/?(?:b|strong|i|em|u|span|a|font|sup|sub)\b[^>]*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const text = withBreaks
    .split("\n")
    .map((line) => {
      const bullet = line.trimStart().startsWith("•")
      const c = decodeHtmlEntities(stripTags(line.replace(/^\s*•/, ""))).trim()
      return c ? (bullet ? `• ${c}` : c) : ""
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface JobCard {
  id: string | null // requisition id, e.g. "R4109"
  title: string
  company: string
  location: string | null
  date: string | null // YYYY-MM-DD, derived from Workday's relative "Posted N Days Ago"
  postedOn: string | null // the raw relative string, kept for auditability
  url: string
  site: string // registry name, pass to `detail --site`
}

/**
 * Days since posting from Workday's relative label. "Posted 30+ Days Ago"
 * returns 30 with `plus` set: the true age is unknown beyond that.
 */
export function postedDaysAgo(label: unknown): { days: number; plus: boolean } | null {
  if (typeof label !== "string") return null
  const s = label.toLowerCase()
  if (/\btoday\b/.test(s)) return { days: 0, plus: false }
  if (/\byesterday\b/.test(s)) return { days: 1, plus: false }
  const m = s.match(/(\d+)\s*(\+)?\s*days?\s+ago/)
  if (m) return { days: parseInt(m[1], 10), plus: !!m[2] }
  return null
}

/**
 * ISO date `days` before `now`, on the local calendar; null for an
 * open-ended "30+" age. Local, not UTC: in the Americas the UTC date rolls
 * over in the evening, which turned "Posted Yesterday" into today's date.
 */
export function postedDate(label: unknown, now: Date = new Date()): string | null {
  const p = postedDaysAgo(label)
  if (!p || p.plus) return null
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - p.days)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface RawPosting {
  title?: unknown
  externalPath?: unknown
  locationsText?: unknown
  postedOn?: unknown
  bulletFields?: unknown
}

/** Parse a search response. Each posting is parsed on its own so one bad entry cannot break the rest. */
export function parseSearch(data: unknown, site: WorkdaySite, now: Date = new Date()): { total: number | null; jobs: JobCard[] } {
  const obj = (data ?? {}) as { total?: unknown; jobPostings?: unknown }
  const total = typeof obj.total === "number" ? obj.total : null
  const list = Array.isArray(obj.jobPostings) ? (obj.jobPostings as RawPosting[]) : []
  const jobs: JobCard[] = []
  for (const p of list) {
    try {
      const title = cleanText(p.title)
      const ext = typeof p.externalPath === "string" && p.externalPath.startsWith("/job/") ? p.externalPath : null
      if (!title || !ext) continue
      const bullets = Array.isArray(p.bulletFields) ? p.bulletFields : []
      const reqId = typeof bullets[0] === "string" && bullets[0].trim() ? bullets[0].trim() : null
      jobs.push({
        id: reqId,
        title,
        company: site.name,
        location: cleanText(p.locationsText),
        date: postedDate(p.postedOn, now),
        postedOn: cleanText(p.postedOn),
        url: `${site.publicBase}${ext}`,
        site: site.name,
      })
    } catch {
      continue
    }
  }
  return { total, jobs }
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  additionalLocations: string[]
  startDate: string | null
  isActive: boolean | null
}

/** Parse a detail response (`jobPostingInfo` plus optional `hiringOrganization`). */
export function parseDetail(data: unknown, site: WorkdaySite, fallbackUrl: string, now: Date = new Date()): JobDetail | null {
  const root = (data ?? {}) as { jobPostingInfo?: Record<string, unknown>; hiringOrganization?: { name?: unknown } }
  const info = root.jobPostingInfo
  if (!info || typeof info !== "object") return null
  const extra = Array.isArray(info.additionalLocations)
    ? (info.additionalLocations as unknown[]).map(cleanText).filter((x): x is string => !!x)
    : []
  const startDate = typeof info.startDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(info.startDate) ? info.startDate.slice(0, 10) : null
  const url = typeof info.externalUrl === "string" && /^https:\/\/[^/]+\.myworkdayjobs\.com\//i.test(info.externalUrl)
    ? info.externalUrl
    : fallbackUrl
  return {
    id: cleanText(info.jobReqId),
    title: cleanText(info.title) ?? "(untitled)",
    company: cleanText(root.hiringOrganization?.name) ?? site.name,
    location: cleanText(info.location),
    // startDate is the posting's own start/publication date where the tenant
    // sets it; otherwise fall back to the relative label.
    date: startDate ?? postedDate(info.postedOn, now),
    postedOn: cleanText(info.postedOn),
    url,
    site: site.name,
    description: descriptionToText(info.jobDescription),
    employmentType: cleanText(info.timeType),
    additionalLocations: extra,
    startDate,
    isActive: typeof info.canApply === "boolean" ? info.canApply : null,
  }
}
