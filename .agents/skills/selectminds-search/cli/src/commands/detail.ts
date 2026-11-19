import { htmlFetch, loadRegistry, parseDetail, parseSite, stripInvisible, writeError, type Site } from "../helpers.js"

export interface DetailOpts {
  id: string
  site?: string
  format: "json" | "plain"
}

/**
 * Resolve a posting reference to (site, numeric id). Accepts a posting URL on
 * a *.selectminds.com host (/jobs/<slug>-<id>) or a bare numeric id. A bare id
 * needs --site unless the registry has exactly one entry.
 */
export function resolveRef(input: string, sites: Site[], siteName?: string): { site: Site; id: string } | string {
  const s = input.trim()
  if (/^\d+$/.test(s)) {
    const site = siteName ? sites.find((x) => x.name.toLowerCase() === siteName.toLowerCase()) : sites.length === 1 ? sites[0] : undefined
    if (!site) return siteName ? `No registry entry named "${siteName}"` : "A bare job id needs --site <registry name> when the registry has several entries"
    return { site, id: s }
  }
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return `Could not parse a job id or URL from "${input}"`
  }
  const site = parseSite("", u.toString())
  if (!site) return `"${input}" is not a *.selectminds.com posting URL`
  const m = decodeURIComponent(u.pathname).match(/^\/jobs\/(?:[^/]*-)?(\d+)\/?$/)
  if (!m) return `"${input}" is not a /jobs/<slug>-<id> posting URL`
  const known = sites.find((x) => x.host === site.host)
  return { site: known ?? { ...site, name: site.host.split(".")[0] }, id: m[1] }
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  let sites: Site[]
  try {
    sites = await loadRegistry()
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "BAD_REGISTRY")
    return 1
  }
  const ref = resolveRef(opts.id, sites, opts.site)
  if (typeof ref === "string") {
    writeError(ref, "BAD_ID")
    return 1
  }
  try {
    const page = await htmlFetch(`${ref.site.base}/jobs/x-${ref.id}`)
    const job = page ? parseDetail(page.html, ref.site, ref.id) : null
    if (!job) {
      writeError("Job not found (it may have closed)", "NOT_FOUND")
      return 1
    }
    const c = stripInvisible(job)
    if (opts.format === "plain") {
      const lines = [
        c.title,
        `${c.company} · ${c.location || "—"}`,
        c.requisition ? `Requisition: ${c.requisition}` : "",
        c.postedAgo ? `Posted: ${c.postedAgo}${c.date ? ` (~${c.date})` : ""}` : "",
        "",
        c.description || "(no description)",
        "",
        `URL: ${c.url}`,
      ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""))
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(c, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
