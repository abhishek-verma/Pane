# Provider action isolation experiments

2026-09-09. These experiments use fake local APIs and disposable configuration/workspace directories. They do not use a paid account or establish language quality.

## Claude Code

Installed version 2.1.265 (retested after 2.1.263) supports `--restricted`, `--safe-mode`, `--tools ""`, `--strict-mcp-config`, `--no-chrome`, `--no-session-persistence`, `--disable-slash-commands`, explicit system prompt and `--json-schema`. The Layer adapter uses those together, pins the requested model for primary/fallback, disables retries/background title generation, bounds turns and per-request output, and terminates the subprocess on cancellation/deadline.

The production adapter's local API probe observed one request on the specified model with only `StructuredOutput` in the tool inventory and `max_tokens=512`. The result passed the same invocation-bound semantic validator as the native API runner. Tests reject a widened tool inventory, model mismatch and invalid result, and verify cancellation and workspace cleanup. Mandatory operator-managed policy remains the CLI's policy; no bypass flags are used.

The adapter preserves the host's Claude authentication environment, as normal Pane Claude sessions do. No Layer-specific API key is required by the implementation. The full browser action fixture now passes all 48 checks with the installed CLI, including actual trusted clicks, generated-script inspection/repair, Keep/reload and cancellation. This identity path still needs a real-account test before release.

References: [CLI restrictions and structured output](https://code.claude.com/docs/en/cli-reference), [output limits and retries](https://code.claude.com/docs/en/env-vars). The executable probe is the evidence for this installed version.

Generated sessions use a private loopback MCP endpoint with a random invocation token. The installed CLI exposes exactly the three private page tools and preserves the 512-token per-request ceiling in the standalone fixture. Safe mode suppresses even explicitly supplied MCP servers, so generated sessions instead combine restricted mode, exact tool allowlisting, empty user settings, disabled skills/memories/hooks/plugins, and no built-in tools. The endpoint uses full strict schemas; passing only their raw shapes was found to strip unknown arguments and has been corrected. Cancellation closes the endpoint, and private tool failures do not disclose raw page/provider errors. Final results come from browser-host receipts, not model-authored success data.

## Codex

`layers-codex-probe.ts` starts an ephemeral CLI with user config/rules ignored, a read-only sandbox, no configured MCP servers, web search disabled, `tools.view_image=false`, and the tested shell, app, plugin, browser, computer, agent, hook and skill feature flags disabled. It uses a fake Responses API and no real auth.

The observed upstream inventory still contains `update_plan`, `request_user_input`, `apply_patch` and `view_image`. The CLI sends a JSON output schema, but no `max_output_tokens`. Consequently this experiment is an **unsupported adapter report**, not a passing isolation test. Production capability stays false. Disabling shell alone, or trusting an instruction not to use files, does not satisfy the contract.

The [official config reference](https://learn.chatgpt.com/docs/config-file/config-reference) describes a local-image toggle; the observed installed-CLI behavior is what gates availability. A future adapter needs a verified tool/transport boundary and enforceable limits with the same configured account/model. No fallback provider has been substituted.

## Native lifecycle

The native credential/pipe probe uses the actual newly built Pane binary and production authentication/routes in a small fixture sidecar. It validates profile binding, unsigned rejection and five-minute expiry. Two launches of the same disposable profile preserve identity and rotate authority: the new sidecar rejects the old credential. Existing native orphan recovery terminates old sidecars before a new launch; it does not adopt an unauthenticated orphan connection.

## Codex transport guard follow-up

The --guard probe now passes against installed codex-cli 0.146.0 and a fake local Responses API. The actual upstream request contains no built-in tools and max_output_tokens=512. The guard buffers each bounded response before returning it to the CLI, rejects undeclared tool items and unbound function argument events, requires a complete response and validates reported output usage. Unit cases also cover model pinning, request rewriting, missing completion, excess output and unknown event types. Closing the guard cancels upstream work.

This resolves a transport mechanism question, not the complete Codex adapter. Production capability remains false until the configured host account/auth path, actual backend acceptance of the output cap, private generated MCP tools and browser actions are proven. The existing ChatGPT-account fetch adapter strips max_output_tokens; a fake API pass cannot establish that endpoint’s budget support. No separate API key, alternate provider or billing guarantee has been substituted for the requested account.


## Codex private adapter and account compatibility — 2026-09-09

The candidate `codex-action-runner.ts` now runs installed codex-cli 0.146.0 with canonical private MCP tools. This CLI defers MCP tools behind tool search and uses namespaces: `mcp__pane_layer.submit_layer_result` and the three private page tools. The guard advertises those canonical schemas eagerly and validates namespace-qualified response items. Flat legacy MCP names are rejected by this CLI. Only the invocation-private MCP server receives its supported `default_tools_approval_mode="approve"`; Pane's exact action grant and current document checks still govern execution. User config/rules, hooks, plugins, general tools and authoring workspaces remain excluded.

The MCP SDK exports only object schemas. Refined translation schemas therefore need their strict underlying object exported while the complete canonical refinement is validated before execution. A regression test proves the declared fields and rejection of invalid aggregate values.

Installed-CLI fixtures pass translation in exactly one model request and generated inspect/execute/complete in exactly three, with a 512-token request ceiling in both fixtures. Results come from the canonical private callback after the model stream has passed the guard. The child is then stopped without requesting a narration turn. Four additional adapter tests prove rejection of chat-text results, cancellation, deadline enforcement, child/workspace cleanup and closure of both endpoints. Claude's installed-CLI generated flow still passes after the shared MCP change.

Native account forwarding through a custom model endpoint is proven with a disposable fake account: both Authorization and ChatGPT-Account-Id reach the guarded upstream, while a separate random invocation header protects the loopback endpoint. Account metadata requests in this probe also use the local fixture. The candidate reuses the normal Pane auth-file symlink pattern in an otherwise empty temporary Codex home; no alternate provider key is required for this mechanism.

The explicit live-account compatibility request returned HTTP 400 with an unsupported max_output_tokens error. No credential, account identifier or provider response content was logged. This is evidence that the current account backend cannot enforce the proposed hard output-token ceiling. A bounded accepted response and deadline do not establish a hard token-spend ceiling. The optional budget preference remained unanswered; the stated engineering default is enforced turns/deadlines and bounded accepted output, with an explicit no-hard-spend-ceiling disclosure. This is not a claim of user approval for a live export. Production capability remains disabled, and the candidate is not connected to the public action runner yet. Full Codex browser verification and live action completion remain release gates; no all-provider release claim follows from the local fixtures.


## Account adapter follow-up and approval boundary

The candidate transport now distinguishes provider generation ceilings from accepted-output limits. Account mode omits the unsupported max_output_tokens field but still rejects excessive reported output before forwarding a tool event. A unit test covers this distinction. Production capability remains disabled until corresponding capability/UI disclosures and the full provider flow are complete.

A live test initially failed before reaching the transport because the development server inherited its parent Codex session/IPC/permission environment. The private child now discards parent CODEX control variables while preserving configured authentication and setting its own temporary home. Local process tests verify that these parent settings do not enter the child. With that corrected, the live account returned HTTP 400 for the tools declaration; the namespace now supplies its description, and the installed-CLI local generated fixture still passes.

The next live probe was rejected by automatic approval review: it classified sending internal Layer instructions and private tool schemas to the configured external provider as an export without sufficiently explicit user authorization. No further live request was sent. The concrete pending check sends the fixed Bonjour sample and generic Layer instructions/tool schema through the existing Codex account, not page or workspace content. Explicit user approval is requested for that live check. Local fixtures, UI work and other release QA remain authorized and can continue. This is a gate on live verification, not a completed adapter or a blocked whole-project goal.
