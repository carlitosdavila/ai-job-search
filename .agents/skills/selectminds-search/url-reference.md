# SelectMinds reference

Oracle SelectMinds career sites (`https://<org>.referrals.selectminds.com`) serve
server-rendered HTML, charset UTF-8. Recorded from Tetra Tech on 2026-11-18.

## Search

| Request | Notes |
|---------|-------|
| `GET /jobs/search?keywords=<q>` | 302 to `/jobs/search/<searchId>`: page 1 of the results |
| `GET /jobs/search?all` | every posting (no keywords) |
| `GET /jobs/search/<searchId>/page<N>` | page N (10 per page) |

No server-side location or date parameters were identified, so the CLI filters location
client-side and resolves dates from detail pages.

### Results page anchors

| Field | Anchor |
|-------|--------|
| total | `<span class="total_results">1034</span>` |
| page count | `<div id="jPaginateNumPages" class="ghost">104.0</div>` |
| card | `<div id="job_list_<id>" class="job_list_row ...">`. The CLI splits on `<div id="job_list_` |
| id | the digits in `job_list_<id>` |
| title + URL | `<a href="https://<host>/jobs/<slug>-<id>" class="job_link font_bold">Title</a>` |
| location | `<span class="location">Portland, Oregon, United States</span>` |
| category | `<span class="category">Engineering</span>` |
| snippet | `<p class="jlr_description">...</p>` |
| new flag | `<span class="job_flg ... new_flg">New</span>` |

There is no posting date on the card. Pagination links are built by script, so the
page-N URL above was confirmed by fetching it.

## Detail

`GET /jobs/<slug>-<id>`. The slug is ignored, so `/jobs/x-<id>` works.

| Field | Anchor |
|-------|--------|
| title | `<h1 class="title">...</h1>` |
| location | `<h4 class="primary_location"><a ...><span class="loc_icon ...">icon</span> City, State, Country</a></h4>` |
| post date | `<dd class="job_post_date"><span class="field_value">5 days ago</span>` |
| requisition | `<dd class="job_external_id"><span class="field_value">22100000301</span>` |
| description | `<div class="job_description">...</div>` (nested divs; extracted with depth tracking) |

Applications go to the employer's Taleo career section (e.g. `tetratech.taleo.net`),
which the CLI never contacts.

## Access notes

- `robots.txt` on `tetratech.referrals.selectminds.com` permits `/jobs/search` (checked
  with `tools/robots_check.py`).
- The honest User-Agent `Mozilla/5.0 (compatible; selectminds-search-cli/1.0)` is served
  normally. There's no bot challenge.
