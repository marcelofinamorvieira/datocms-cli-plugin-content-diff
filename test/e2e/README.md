# Real CMA content-diff E2E

This suite runs generated content migrations against the real DatoCMS CMA. It
is deliberately excluded from `npm test` because each scenario creates and
destroys sandbox environments. Run it only against a disposable project.

The authoritative executable inventory is
[`executable-coverage.ts`](./executable-coverage.ts). Its offline contract test
fails if an actual `*.e2e.ts` spec is missing from the registry or from the
table below. The older `fixture-matrix.ts` is a design catalog, not evidence
that a live scenario exists or passed.

## Evidence status

The checked-in status is **unrun for this GA audit** for every executable lane.
`structural-invalid.e2e.ts` is separately marked
**historical-unconstructible**. A spec becomes **live-proven** only after the
complete command below passes against a disposable project with `KEEP` unset,
cleanup succeeds, primary is independently verified before and after, and the
centralized evidence value in `executable-coverage.ts` is updated with that
dated result and the machine-checked suite-source digest. Source review and
offline scenario tests do not count as live proof.

The inventory currently contains 33 spec files and 50 Mocha cases: 32
executable spec files containing 49 cases, plus one intentional pending case.
These counts describe the checked-in files, not a pass result.

## Secure run

The token needs permission to create and destroy environments; edit schema;
read, write, publish, and schedule records; manage uploads; and create the
migration-tracking model. The harness reads it only from
`DATOCMS_API_TOKEN`. It does not put it in generated config files or command
arguments.

In a private interactive shell, read the token without echoing it or adding it
to shell history:

```bash
cd '<datocms-cli-plugin-content-diff-repository>'
read -r -s DATOCMS_API_TOKEN
printf '\n'
export DATOCMS_API_TOKEN
export DATOCMS_CONTENT_DIFF_E2E=1
export DATOCMS_CONTENT_DIFF_E2E_DISPOSABLE_PROJECT='<project-id>'
unset DATOCMS_CONTENT_DIFF_E2E_KEEP
npm run test:e2e:real-cma
unset DATOCMS_API_TOKEN DATOCMS_CONTENT_DIFF_E2E DATOCMS_CONTENT_DIFF_E2E_DISPOSABLE_PROJECT
```

The explicit opt-in is mandatory. The project marker is also recommended even
for a blank project and becomes mandatory if primary contains data. For a
non-empty primary, the project name must additionally contain `e2e`, `test`,
`testing`, or `disposable` as a separate word.

For an offline-only release check, explicitly skip the long live suite:

```bash
npm run release:check -- --skip-e2e
```

This runs the complete offline, build, manifest, audit, and package checks but
does not record any live-CMA proof.

## What a passing executable lane proves

The harness performs the same lifecycle for each successful scenario:

1. It checks the primary environment safety boundary, then forks isolated
   source and destination sandboxes.
2. It seeds the scenario and requires the captured site/schema/current and
   published record/upload/collection fingerprints to remain unchanged across
   `content:diff` generation. Workflow definitions and full schedule resources
   are not part of that fingerprint.
3. It runs the generated artifact through the real core `migrations:run`
   command into a third sandbox.
4. The scenario checks its own CMA oracle. Lanes explicitly tagged with the raw
   claim compare raw current/published slices; other lanes use typed CMA reads.
   IDs, lifecycle/validity state, schema state, and exact asset bytes are
   asserted only where the registry says so.
5. It directly replays the migration behind a mutator-rejecting CMA proxy, then
   regenerates the diff and requires zero operation/destructive counts. A
   zero-operation regeneration can still contain warnings or preserved/skipped
   aggregate diagnostics; it is not necessarily an empty diagnostic plan.
6. It destroys the created environments in reverse order.

Expected-generation-failure scenarios instead prove fail-closed diagnostics,
unchanged captured source/destination fingerprints, and no leftover migration
artifact. For GA proof, every executable case must pass, the one documented
historical fixture must remain pending, `KEEP` must be unset, cleanup must
succeed, and a separate read-only check must verify primary before and after.

## Executable lane inventory

The descriptions are deliberately narrow. They state what each seeded live
scenario asserts; they are not claims of exhaustive state-space coverage.

<!-- executable-e2e-inventory:start -->
| Spec | Executable scope |
| --- | --- |
| `assets-deletions.e2e.ts` | Bundled upload bytes, canonical source-only creation, same-ID binary replacement, writable metadata, upload collections, one unreferenced managed upload deletion, an isolated same-byte stem rename requiring only read plus replace-asset permission, and an EXIF-bearing replacement that must preserve cleared manual fields. |
| `cascade-strategies.e2e.ts` | Managed publish/unpublish/delete reference cascades and an external fail-strategy rejection boundary. |
| `complex-recursive-boundary.e2e.ts` | Deterministic 500-block, project-supported depth (four or five, capped at five), complete seeded DAST grammar, and at-least-250,000-byte record boundary. |
| `custom-structured-text.e2e.ts` | Non-DAST Structured Text children traversal, real nested references/blocks, and ignored sidecar decoys. |
| `environment-semantics.e2e.ts` | Timezone mismatch rejection without artifacts or captured-fingerprint changes; API-read order is not instrumented. |
| `fresh-nested-update.e2e.ts` | Safe aggregate preservation when staging/restoration would require fresh nested IDs. |
| `historical-null-default.e2e.ts` | Non-localized and localized float nulls under later non-null defaults, with exact opt-in default suppression and restoration. |
| `invalid-content.e2e.ts` | Invalid current/published migration with exact opt-in validator relaxation, plus default fail-closed skips. |
| `invalid-schedule-only.e2e.ts` | Preservation of invalid aggregates when future selective schedule state cannot be safely reconciled. |
| `localized-media-defaults.e2e.ts` | Localized file/gallery/SEO/video, localized metadata, nested uploads, null/empty/omitted locales, bundled bytes, supported normalized non-string defaults, and exact suppression/restoration for the seven CREATE-time historical null fields. |
| `medium-scale-recursive.e2e.ts` | 65 paginated records with localized/scalar/lifecycle/order/link/recursive-block drift; not a throughput benchmark. |
| `mixed-state-skip-closure.e2e.ts` | Multi-hop invalid A to published B to current-only C skip closure, protected target upload, and independent D/upload convergence. |
| `mixed-validity.e2e.ts` | Opposite current/published validity states and exact enum-validator restoration. |
| `no-draft-singleton.e2e.ts` | Source-only published dependency creation before a no-draft singleton. |
| `optional-create-validation.e2e.ts` | Three-record optional-reference create SCC under order-dependent `size.multiple_of` validation. |
| `optional-deletion-validation.e2e.ts` | Optional-reference deletion SCC under strict `size.multiple_of` validation. |
| `published-tree.e2e.ts` | Parent-first source publish and reparent-before-child-first destination subtree deletion. |
| `sanitized-html-write-guard.e2e.ts` | Expected pre-artifact rejection for active `sanitized_html` rewrites across source-only CREATE and an invalid/full-rehydrate unrelated-field UPDATE, with exact raw historical bytes and unchanged environment fingerprints. |
| `real-cma-lifecycle.e2e.ts` | Draft, published, updated, unpublished, and no-draft lifecycle states. |
| `real-cma-schedules.e2e.ts` | Selective publication/unpublishing plus quiescence and exact restoration of unchanged schedules on changed and noop records. |
| `real-cma-topology.e2e.ts` | Tree topology, sortable order, and workflow stages. |
| `real-cma.e2e.ts` | Portable generated-JavaScript golden path through core, raw CMA verification, replay, and regeneration. |
| `recursive-content.e2e.ts` | Localized published Structured Text-only required cycles: exact opt-in relaxation and default skip. |
| `required-deletion.e2e.ts` | Required deletion SCC preservation, including a published nested-block SCC that cannot be safely unlinked. |
| `schema-gating.e2e.ts` | Managed validator/default drift rejection and unrelated schema-drift allowance. |
| `selective-publication.e2e.ts` | Exact published locale membership/nonlocalized inclusion with divergent current values. |
| `selective-schedule-validity.e2e.ts` | Provably valid scheduled locale slice migration while an invalid unselected locale is preserved. |
| `shell-components.e2e.ts` | Required one-way dependency across independently planned shell SCCs. |
| `structural-invalid.e2e.ts` | **Pending:** needs a curated historical/server-seeded excluded-block state; no live behavior is claimed. |
| `transitive-schema-presentation.e2e.ts` | Fourth-hop managed schema gating and preservation of destination-only presentation metadata. |
| `typescript-artifact.e2e.ts` | Generated TypeScript artifact through core, guarded direct replay, and empty regeneration. |
| `unique-deletion.e2e.ts` | Current/published unique handoffs, cyclic swaps, localized staging, invalid peers, optional deletion SCCs, external referrers, and skipped-owner upload protection. |
| `validator-gauntlet.e2e.ts` | Constructible scalar/date/slug/HTML and upload/image/gallery/SEO/description validators with exact restoration and bundled bytes; `slug_title_field` remains source/offline-only. |
<!-- executable-e2e-inventory:end -->

## Intentional exclusions and limits

Identity conversion and the separate update-IDs product are out of scope for
this suite. Their design-catalog entries must not be counted as executable or
live coverage here.

The suite also does not prove that the product is safe under simultaneous
writers to the same destination. Run E2E jobs serially per project. There is no
environment-wide transaction across every CMA mutation, and a hard process
kill can interrupt best-effort validator/default restoration or environment cleanup.
Those architecture limits cannot be removed by adding more scenarios.

The structural-invalid state remains an honest coverage gap. The CMA rejects
creation of blocks excluded by a structural field validator, while narrowing
an existing allowlist removes blocks of the retired model. A live test needs a
curated historical or server-seeded fixture; weakening the validator would
manufacture a different state and is not accepted as coverage.

## Retain fixtures for inspection

By default, created environments and the temporary local workspace are removed
even after failures. To retain the environments for manual inspection, set:

```bash
export DATOCMS_CONTENT_DIFF_E2E_KEEP=1
```

The harness prints every retained environment ID. Destroy them manually when
finished. A hard process kill can bypass cleanup; generated environments use
the `cde2e-` prefix so abandoned fixtures can be found explicitly. Never run
two content-diff E2E jobs concurrently against the same project.
