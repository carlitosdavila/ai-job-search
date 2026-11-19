# Workday CXS API reference

Every Workday-hosted careers site (`https://<tenant>.wdN.myworkdayjobs.com/<site>`) is a
client-side app backed by a public JSON API under `/wday/cxs/`. No login, cookie or
token is needed. Recorded from Ameresco's site on 2026-11-18.

## Coordinates

| Part | Example | Where it comes from |
|------|---------|---------------------|
| host | `ameresco.wd5.myworkdayjobs.com` | careers-site URL (`wd1`-`wd12` vary by data centre) |
| tenant | `ameresco` | first label of the host |
| site | `Ameresco` | first path segment after an optional locale (`/en-US/`) |
| API base | `https://<host>/wday/cxs/<tenant>/<site>` | |

## Search

`POST <API base>/jobs` with headers `Content-Type: application/json` and
`Accept: application/json`:

```json
{ "appliedFacets": {}, "limit": 20, "offset": 0, "searchText": "energy engineer" }
```

| Field | Meaning |
|-------|---------|
| `searchText` | keywords; see the Query syntax line in SKILL.md |
| `limit` | page size; 20 is the value the site's own UI sends |
| `offset` | `(page - 1) * limit` |
| `appliedFacets` | facet filters (`locations`, `jobFamilyGroup`, `timeType`, ...). Facet ids are tenant-specific, so the CLI sends `{}` and filters location client-side |

Response:

```json
{
  "total": 76,
  "jobPostings": [
    {
      "title": "PV and Energy Storage Remote Operator &amp; Data Analyst",
      "externalPath": "/job/United-States---Massachusetts---Westborough/PV-and-Energy-Storage-Remote-Operator---Data-Analyst_R4148",
      "locationsText": "2 Locations",
      "postedOn": "Posted Yesterday",
      "bulletFields": ["R4148"]
    }
  ],
  "facets": [ ... ]
}
```

- `title` and `locationsText` carry HTML entities (`&amp;`). Decode them.
- `externalPath` + `https://<host>/<site>` = the public posting URL.
- `bulletFields[0]` is the requisition id on Ameresco. Other tenants may put other
  fields there; the CLI uses it only as `id`.
- `postedOn` labels seen: `Posted Today`, `Posted Yesterday`, `Posted N Days Ago`,
  `Posted 30+ Days Ago`.
- There is no company field.

## Detail

`GET <API base><externalPath>` (i.e. `<API base>/job/<location>/<slug>_<req>`).

Response fields used:

| Path | Notes |
|------|-------|
| `jobPostingInfo.title` | entity-encoded |
| `jobPostingInfo.jobDescription` | HTML. On Ameresco it is **entity-escaped HTML** (`&lt;p&gt;`, with `&amp;amp;` inside). The CLI unescapes the outer layer only when the field contains no real tags |
| `jobPostingInfo.location`, `additionalLocations[]` | |
| `jobPostingInfo.postedOn`, `startDate` | `startDate` is `YYYY-MM-DD` |
| `jobPostingInfo.timeType` | e.g. `Full time` |
| `jobPostingInfo.jobReqId` | e.g. `R4109` |
| `jobPostingInfo.externalUrl` | public posting URL |
| `jobPostingInfo.canApply` | `false` once a posting stops accepting applications |
| `hiringOrganization.name` | legal employer name, e.g. `Ameresco Inc` |

A 404 means the posting is gone or the path is wrong.

## Access notes

- `robots.txt` on `ameresco.wd5.myworkdayjobs.com` permits both the careers page and
  `/wday/cxs/` (checked with `tools/robots_check.py`, 2026-11-18).
- The honest User-Agent `Mozilla/5.0 (compatible; workday-search-cli/1.0)` is served
  normally. There's no bot challenge, so no browser headers are needed.
- Search is a POST because that is how the API is built. It is still a read-only query
  and sends nothing but the keywords, page size and offset.
