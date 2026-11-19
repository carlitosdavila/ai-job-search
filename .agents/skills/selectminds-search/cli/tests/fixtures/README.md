# Fixtures

Cut from live Tetra Tech SelectMinds pages (tetratech.referrals.selectminds.com), captured
2026-11-18 during `/add-portal` reconnaissance. The markup inside each kept block is
unmodified.

- `search-tetratech.html`: `/jobs/search?keywords=energy+engineer` (redirected to
  `/jobs/search/17439585`). Keeps the `number_of_results` block (total 1034), the first
  three `job_list_row` cards and the two pagination ghost divs. Page CSS and chrome are removed.
- `detail-tetratech-58033.html`: `/jobs/recruiter-engineering-energy-58033`. Keeps the
  `<h1 class="title">` and primary location, the post-date and requisition `<dl>` fields, and
  the start of `<div class="job_description">` (truncated). The `display:none` paragraph and
  the closing `</div>` were added to test hidden-text stripping.
