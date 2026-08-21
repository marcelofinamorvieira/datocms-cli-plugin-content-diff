# DatoCMS Content Diff CLI Plugin

> [!WARNING]
> **Unofficial Beta.** This project is not affiliated with or endorsed by
> DatoCMS. Test generated migrations on a sandbox, review every planned change,
> and keep a recovery path before applying content changes.

`content:diff` compares content in two environments and generates a reviewable
migration for the normal DatoCMS `migrations:run` workflow.

The source environment is the desired state. The destination is the environment
that should receive those changes. Generation reads both environments and writes
files locally; it does not mutate DatoCMS. Running the generated migration does.

The migration can preserve supported records, current and published versions,
references, nested blocks, uploads, upload collections, schedules, tree
positions, and workflow stages. Destination-only records and uploads are kept
unless deletions are explicitly enabled.

## Install

Node.js 20 or newer and `datocms@4.0.29` are required for this beta.

```bash
npx datocms plugins:add marcelofinamorvieira/datocms-cli-plugin-content-diff#v0.1.0-beta.1
```

This is a user-installed CLI plugin. It is not listed among the official
DatoCMS plugins. While installed, it supplies compatible versions of
`migrations:new` and `migrations:run` so generated content migrations can safely
use the stock `datocms` CLI host.

## Use

Generate a migration from `staging` into `production`:

```bash
npx datocms content:diff "sync staging content" \
  --autogenerate=staging:production
```

Review the generated migration and its `.datocms-content` plan. Then use the
fork-first workflow:

```bash
npx datocms migrations:run --source=production --dry-run
npx datocms migrations:run --source=production
```

The dry run lists pending migration files; the generated plan is the detailed
content preview. Without `--in-place`, `migrations:run` forks the source and
applies the migration to the new sandbox.

Useful optional scopes:

```bash
# Limit records to selected model API keys
npx datocms content:diff "sync articles" \
  --autogenerate=staging:production \
  --item-types=article,author

# Include all uploads and explicitly allow destination-only cleanup
npx datocms content:diff "mirror content" \
  --autogenerate=staging:production \
  --uploads=all \
  --include-deletions
```

Run `npx datocms content:diff --help` for the complete command reference.

Generated plans contain project content, source asset URLs, identifiers, and
validation state. Keep them private and review them before execution. Never run
two content-diff migrations against the same destination concurrently.

## Beta bugs

If you find a bug, open a
[GitHub issue](https://github.com/marcelofinamorvieira/datocms-cli-plugin-content-diff/issues).
Include the plugin, DatoCMS CLI, and Node.js versions plus sanitized phase names,
counts, IDs, and error codes. **Never attach API tokens, raw content, generated
plans, snapshots, full state directories, or complete CMA logs.**

## License

MIT License. Copyright (c) 2026 Marcelo Finamor Vieira. Portions derived from
the MIT-licensed DatoCMS CLI retain their original copyright notice.
