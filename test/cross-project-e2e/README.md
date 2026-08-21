# Aligned cross-project real-CMA suite

This opt-in suite verifies content migration between two separately
authenticated disposable projects. The projects must have been duplicated from
one another, or created from the same boilerplate, so the fixture can create the
same requested model, field, and record IDs in both sandboxes.

The suite never creates or deletes projects. It creates sandbox environments in
the supplied projects, verifies both primary environments before and after the
run, and removes every owned sandbox unless `DATOCMS_CONTENT_DIFF_E2E_KEEP=1`.

Required environment variables:

```bash
export DATOCMS_CONTENT_DIFF_E2E_CROSS_PROJECT=1
export DATOCMS_CONTENT_DIFF_E2E_SOURCE_API_TOKEN=...
export DATOCMS_CONTENT_DIFF_E2E_DESTINATION_API_TOKEN=...
export DATOCMS_CONTENT_DIFF_E2E_SOURCE_PROJECT_ID=...
export DATOCMS_CONTENT_DIFF_E2E_DESTINATION_PROJECT_ID=...
```

Both projects must be test-only and their names must contain `e2e`, `test`,
`testing`, or `disposable`. The two project IDs and tokens must be distinct. Use
full-access CMA tokens limited to their respective projects.

Run from the package root:

```bash
npm run test:e2e:cross-project
```

The suite proves read-only generation in both projects, destination-only
execution without the source token, wrong-project rejection before mutation,
fork convergence, guarded replay, zero-operation regeneration, exact primary
fingerprint preservation, and cleanup. With `DATOCMS_CONTENT_DIFF_E2E_KEEP=1`,
the owned environment IDs are printed for manual inspection and are not
destroyed.

The normal release gate runs this suite after the single-project real-CMA suite.
`npm run release:check -- --skip-e2e` skips both live suites while retaining all
offline validation.
