# selectminds-cli

Searches Oracle SelectMinds career sites by parsing their server-rendered HTML. It has zero
runtime dependencies and needs only `bun`. `bun install` pulls only the TypeScript dev
types used by `typecheck`.

```bash
bun run src/cli.ts search -q '"energy engineer"' --format table
bun run src/cli.ts detail 58033 --site "Tetra Tech" --format plain
bun run src/cli.ts list --format table
```

Employers come from `selectminds_sites.json` at the repo root. See `../SKILL.md` for the
format and `../url-reference.md` for the API details.

## Tests

```bash
bun install && bun run typecheck && bun run test
```

The suite is network-free: `fetch` is stubbed, and any request to an unexpected URL
fails the test. The fixtures in `tests/fixtures/` are trimmed from live responses;
their README records what was edited.
