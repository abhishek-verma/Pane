# Dead-code analysis

Run `bun run fallow` from `packages/browseros-agent`. Configuration lives in
`.fallowrc.json`. Keep findings enabled for application code; remove unused
declarations or make locally used helpers private instead of adding exclusions.

Some entry points are invisible to static imports:

- The retrieval worker and ASR sidecar are launched by file path. The offline
  ASR replay script is a standalone CLI.
- `extract-native.cjs` is preloaded through `BUN_OPTIONS` when packaging ACP
  runtimes.
- The extension manifest/CRX scripts and `test-id.cjs` are used by release
  tooling. The host-provider smoke script is a standalone diagnostic.
- The Layers runtime probe builds source strings that import the app runtime
  and translation modules, so those modules have explicit entries.

The Whisper native addon must remain a dependency: the ASR sidecar locates its
platform-specific `.node` binary by path, and the server resource manifest
packages it. Fallow cannot infer that dependency from an ES import.

`/set-favicon.js` is served from the app's public directory. Generated GraphQL
output, public assets, and shadcn/AI Elements components are excluded from the
relevant unused-code checks. Apply the same generated-component rules to the
main app, Claw app, and Claw onboarding app; do not hand-edit generated files.

After removing GraphQL documents, run `bun run codegen:agent`. After removing
dependencies, regenerate `bun.lock` with `bun install --lockfile-only`.

The former `apps/eval/pane-thesis` scaffold was not connected to the eval CLI or
grader registry and has been removed. Its scenarios remain described in
`specs/PHASE-7-PROMPT.md` at the repository root; those descriptions are not
evidence that an automated evaluation runs. Add future scenarios through the
current eval suite and grader interfaces.
