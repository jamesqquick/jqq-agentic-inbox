# Project guidance

Guidance for agents and contributors working in this repo. This complements any
global AGENTS.md; project-specific rules here take precedence.

## Testing

**New features and bug fixes should ship with tests.** When you add or change
behavior, add or update tests in the same change. If something genuinely can't
be tested (e.g. a thin wrapper over an external binding), say so explicitly in
the PR rather than skipping silently.

### How to run

```bash
pnpm test           # run all unit tests once
pnpm run test:watch # watch mode while developing
pnpm run typecheck  # type-check the whole project
```

> This project uses [pnpm](https://pnpm.io) (pinned via the `packageManager`
> field in `package.json`). Use pnpm, not npm — the npm lockfile is not
> committed. Note that `pnpm deploy` is a reserved pnpm command, so the deploy
> script must be run as `pnpm run deploy`.

### Conventions

- **Runner:** [Vitest](https://vitest.dev) (`vitest.config.ts`, Node environment).
- **Location:** tests are **co-located** with the code they cover as
  `*.test.ts` (e.g. `workers/lib/actions/title.ts` →
  `workers/lib/actions/title.test.ts`). The config picks up
  `{workers,shared,app}/**/*.{test,spec}.ts`.
- **Keep units pure and injectable.** Unit tests run in plain Node, so the code
  under test should avoid Worker-only imports (Browser Rendering, Durable
  Objects, etc.). Pass bindings like the Workers AI `ai` object in as
  parameters so they can be faked. The title logic in
  `workers/lib/actions/title.ts` is the reference example: pure functions,
  no Worker imports, AI injected.
- **What to prioritize:** deterministic logic — parsing, fallbacks, formatting,
  validation, prompt construction. These are cheap to test and where most
  regressions hide.

### Testing code that needs Worker bindings

For logic that genuinely requires Worker bindings (Notion fetches, Durable
Object state, real Browser Rendering), prefer one of:

1. Refactor the pure part out into a binding-free module and unit test that
   (preferred — see `title.ts`).
2. If true integration coverage is needed, add
   [`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/)
   as a separate Vitest project so it runs in `workerd`, rather than forcing
   all tests into that pool.

The end-to-end email path (inbound email → action handler → Notion + reply) is
not exercised by unit tests. Validate it manually against a scratch Notion
database before merging changes to that flow.

## Definition of done

Don't call a task complete until `pnpm run typecheck` and `pnpm test` both pass.
There are some pre-existing `NOTION_API_KEY`-on-`Env` type errors unrelated to
most changes; don't let your change add new ones.
