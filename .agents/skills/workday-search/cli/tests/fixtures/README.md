# Fixtures

Trimmed from live Workday CXS responses for Ameresco (ameresco.wd5.myworkdayjobs.com),
captured 2026-11-18 during `/add-portal` reconnaissance:

- `search-ameresco.json` - POST `/wday/cxs/ameresco/Ameresco/jobs`, `searchText: "energy engineer"`.
  Five real postings kept. Two entries were edited for test coverage and are not real:
  the `"Malformed entry without a path"` posting, and R4109's `locationsText`/`postedOn`
  (live values were not captured in the excerpt; set to a single location and "30+ Days Ago").
- `detail-ameresco-excerpt.json` - GET `.../job/USA-Texas-Dallas/Senior-Electrical-Engineer---...R4109`.
  The description is shortened. The `display:none` paragraph was added to test hidden-text
  stripping. The live response's remaining fields (after the first 5 KB) were not captured.
