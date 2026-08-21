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
npx datocms plugins:add marcelofinamorvieira/datocms-cli-plugin-content-diff#v0.2.0-beta.1
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

### Use with the primary environment

To compare a sandbox with the current primary environment, omit the destination
from `--autogenerate`:

```bash
npx datocms content:diff "sync staging into primary" \
  --autogenerate=staging
```

Review the generated files, then apply them to a new fork of primary first:

```bash
npx datocms migrations:run --destination=content-diff-review --dry-run
npx datocms migrations:run --destination=content-diff-review
```

After validating that fork, you can intentionally apply the migration directly
to primary with both safety opt-ins:

```bash
npx datocms migrations:run --in-place --allow-primary --dry-run
npx datocms migrations:run --in-place --allow-primary
```

Direct primary execution has no automatic rollback and can leave a partially
migrated environment if execution fails. Prefer promoting a validated fork when
your project workflow allows it.

### Across duplicated projects

The beta can also compare two projects that were duplicated from each other, or
from the same boilerplate project. Configure a profile for each project, then
select both explicitly:

```bash
npx datocms content:diff "sync shared content" \
  --source-profile=source_project \
  --destination-profile=destination_project \
  --autogenerate=main:main
```

The destination profile owns the migration directory and tracking model. Run
the generated migration with destination credentials only:

```bash
npx datocms migrations:run \
  --profile=destination_project \
  --source=main \
  --dry-run

npx datocms migrations:run \
  --profile=destination_project \
  --source=main
```

To compare the source environment with the destination project's primary
environment, omit the destination from `--autogenerate`:

```bash
npx datocms content:diff "sync blueprint into destination primary" \
  --source-profile=source_project \
  --destination-profile=destination_project \
  --autogenerate=main

npx datocms migrations:run \
  --profile=destination_project \
  --destination=content-diff-review \
  --dry-run
```

Common ancestry is your responsibility: the CMA cannot prove that two projects
share a history. The plugin verifies the managed model, field, workflow/stage,
locale, validator, default, and content-setting identities exactly and fails
closed when they have drifted. Unrelated projects and generic schema/content ID
mapping are not supported. Cross-project schema autogeneration is also not part
of this beta; keep both projects aligned through the same checked-in schema
migration history. A copied `datocms_content_diff` legacy-ID ledger that still
names another project is rejected rather than silently rebased.

Use OAuth-linked profiles or profile-specific token environment variables when
possible. `--source-api-token` and `--destination-api-token` are available for
explicit automation, but tokens and local profile names are never written into
generated files. Only generation needs source credentials. For durable transfer
of source-only upload bytes, add `--bundle-assets`.

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
