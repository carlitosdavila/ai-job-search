// Data source: Oracle SelectMinds career/referral sites (<org>.referrals.selectminds.com),
// server-rendered HTML. No authentication required.
//   search: GET /jobs/search?keywords=<q>  -> 302 to /jobs/search/<searchId> (page 1)
//           GET /jobs/search/<searchId>/page<N>                             (page N)
//   detail: GET /jobs/<slug>-<id>  (any slug works, e.g. /jobs/x-58033)
// The sites searched come from a personal registry, selectminds_sites.json at the
// repo root (gitignored).

import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

export const UA = "Mozilla/5.0 (compatible; selectminds-search-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface Site {
  name: string
  host: string // e.g. tetratech.referrals.selectminds.com
  base: string // https://<host>
}

const SM_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.selectminds\.com$/i

export function parseSite(name: string, raw: string): Site | null {
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (!SM_HOST.test(u.hostname) || u.username || u.password) return null
  const host = u.hostname.toLowerCase()
  return { name, host, base: `https://${host}` }
}

const SKILL_DIR = path.resolve(import.meta.dir, "..", "..")
const REPO_ROOT = path.resolve(SKILL_DIR, "..", "..", "..")
export const EXAMPLE_REGISTRY = path.join(SKILL_DIR, "selectminds_sites.example.json")

export function registryPath(): { file: string; example: boolean } {
  const override = process.env.SELECTMINDS_SITES_FILE
  if (override) return { file: override, example: false }
  const personal = path.join(REPO_ROOT, "selectminds_sites.json")
  if (existsSync(personal)) return { file: personal, example: false }
  return { file: EXAMPLE_REGISTRY, example: true }
}

export async function loadRegistry(): Promise<Site[]> {
  const { file, example } = registryPath()
  if (example) {
    process.stderr.write(
      JSON.stringify({
        warning: `No personal registry at ${path.join(REPO_ROOT, "selectminds_sites.json")}; using the example registry. Copy selectminds_sites.example.json to the repo root as selectminds_sites.json and edit it.`,
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
  return (raw as { name?: unknown; url?: unknown }[]).map((e) => {
    if (typeof e?.name !== "string" || typeof e?.url !== "string") {
      throw new Error(`Registry entry ${JSON.stringify(e)} needs string "name" and "url"`)
    }
    const s = parseSite(e.name, e.url)
    if (!s) throw new Error(`Registry entry "${e.name}": "${e.url}" is not a *.selectminds.com URL`)
    return s
  })
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * GET HTML with exponential backoff + jitter on 429/5xx. Follows redirects
 * (search answers with a 302 to its numbered results page) and returns the
 * final URL with the body. Returns null on a 404.
 */
export async function htmlFetch(url: string): Promise<{ html: string; url: string } | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
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
    return { html: await response.text(), url: response.url || url }
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
    .replace(/&amp;/g, "&")
}

const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip invisible characters from every string in a result, recursively: the CLI's output boundary. */
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

/** Drop markup a browser never renders (comments, script/style/template, hidden elements). */
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

export function clean(html: string | undefined | null): string | null {
  if (!html) return null
  const out = decodeHtmlEntities(visibleHtml(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
  return out || null
}

/** Inner HTML of the first <div> whose class list contains `className`, tracking nested divs. */
export function extractDivContent(html: string, className: string): string | null {
  const esc = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const openRe = new RegExp(`<div[^>]*class="(?:[^"]*\\s)?${esc}(?:\\s[^"]*)?"[^>]*>`, "i")
  const open = openRe.exec(html)
  if (!open) return null
  let i = open.index + open[0].length
  let depth = 1
  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)
    if (nextClose === -1) return html.slice(open.index + open[0].length)
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }
  return html.slice(open.index + open[0].length, i - 6)
}

/** Description HTML to text, keeping paragraph and list breaks. */
export function descriptionToText(html: string | null): string | null {
  if (!html) return null
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<\/?(?:b|strong|i|em|u|span|a|font|sup|sub)\b[^>]*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const text = withBreaks
    .split("\n")
    .map((line) => {
      const bullet = line.trimStart().startsWith("•")
      const c = clean(line.replace(/^\s*•/, ""))
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
  id: string
  title: string
  company: string
  location: string | null
  date: string | null // YYYY-MM-DD; only resolved when --jobage fetches each posting (see SKILL.md)
  postedAgo: string | null // the site's relative label ("5 days ago"), when resolved
  isNew: boolean // the site's "New" flag on the card
  category: string | null
  snippet: string | null
  url: string
  site: string
}

/** Parse a search results page. Each card is parsed on its own so one bad card cannot break the rest. */
export function parseSearch(html: string, site: Site): { total: number | null; pages: number | null; jobs: JobCard[] } {
  const totalM = html.match(/class="total_results"[^>]*>\s*([\d,]+)\s*</i)
  const pagesM = html.match(/id="jPaginateNumPages"[^>]*>\s*([\d.]+)\s*</i)
  const chunks = html.split(/<div id="job_list_(?=\d+")/).slice(1)
  const jobs: JobCard[] = []
  for (const chunk of chunks) {
    try {
      const id = chunk.match(/^(\d+)"/)?.[1]
      const link = chunk.match(/<a href="([^"]+)"[^>]*class="[^"]*job_link[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      if (!id || !link) continue
      const title = clean(link[2])
      if (!title) continue
      let url = decodeHtmlEntities(link[1])
      try {
        const u = new URL(url, site.base)
        url = u.hostname.toLowerCase() === site.host ? u.toString() : `${site.base}/jobs/x-${id}`
      } catch {
        url = `${site.base}/jobs/x-${id}`
      }
      jobs.push({
        id,
        title,
        company: site.name,
        location: clean(chunk.match(/<span class="location"[^>]*>([\s\S]*?)<\/span>/i)?.[1]),
        date: null,
        postedAgo: null,
        isNew: /class="[^"]*\bnew_flg\b/i.test(chunk),
        category: clean(chunk.match(/<span class="category"[^>]*>([\s\S]*?)<\/span>/i)?.[1]),
        snippet: clean(chunk.match(/<p class="jlr_description"[^>]*>([\s\S]*?)<\/p>/i)?.[1]),
        url,
        site: site.name,
      })
    } catch {
      continue
    }
  }
  return {
    total: totalM ? parseInt(totalM[1].replace(/,/g, ""), 10) : null,
    pages: pagesM ? Math.round(parseFloat(pagesM[1])) : null,
    jobs,
  }
}

/**
 * Days since posting from the site's relative label. Handles today/yesterday
 * and "N day(s)/week(s)/month(s) ago"; anything else is null (never guessed).
 */
export function daysAgo(label: string | null): number | null {
  if (!label) return null
  const s = label.toLowerCase()
  if (/\btoday\b|\bhours?\s+ago\b|\bminutes?\s+ago\b/.test(s)) return 0
  if (/\byesterday\b/.test(s)) return 1
  const m = s.match(/(\d+|an?|one)\s+(day|week|month)s?\s+ago/)
  if (!m) return null
  const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : 1
  return n * (m[2] === "day" ? 1 : m[2] === "week" ? 7 : 30)
}

/** YYYY-MM-DD `days` before `now` on the local calendar. Approximate for week/month labels. */
export function dateFromDaysAgo(days: number | null, now: Date = new Date()): string | null {
  if (days === null) return null
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface JobDetail {
  id: string
  title: string
  company: string
  location: string | null
  date: string | null
  postedAgo: string | null
  requisition: string | null
  description: string | null
  url: string
  site: string
}

export function parseDetail(html: string, site: Site, id: string, now: Date = new Date()): JobDetail | null {
  const title = clean(html.match(/<h1 class="title"[^>]*>([\s\S]*?)<\/h1>/i)?.[1])
  if (!title) return null
  const postedAgo = clean(html.match(/<dd class="job_post_date"[^>]*>\s*<span class="field_value"[^>]*>([\s\S]*?)<\/span>/i)?.[1])
  return {
    id,
    title,
    company: site.name,
    location: clean(html.match(/<h4 class="primary_location"[^>]*>([\s\S]*?)<\/h4>/i)?.[1]?.replace(/<span class="loc_icon[\s\S]*?<\/span>/i, "")),
    date: dateFromDaysAgo(daysAgo(postedAgo), now),
    postedAgo,
    requisition: clean(html.match(/<dd class="job_external_id"[^>]*>\s*<span class="field_value"[^>]*>([\s\S]*?)<\/span>/i)?.[1]),
    description: descriptionToText(extractDivContent(html, "job_description")),
    url: `${site.base}/jobs/x-${id}`,
    site: site.name,
  }
}
