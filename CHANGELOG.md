## Unreleased

- docs(tests): document baseline Google Drive/Docs tests and poller
  - mapping.json: notebook→doc, note→tab
  - pull/push with optimistic concurrency
  - Drive Changes poller confirmed pulling into `google-api-tests/local/{noteId}.md`

 - feat(plugin): scaffold initial plugin skeleton
   - Add `plugin/` with `manifest.json`, `src/index.ts`, `tsconfig.json`
   - TypeScript build via `tsc`; local ambient `api` typing
   - Register `gdocsHello` command for load verification


