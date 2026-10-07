# Provider runtime contract

Pane's API and ACP transports share capabilities and permission policy, not the
vendor's internal reasoning loop. Claude Code and Codex still own their native
loops; Pane must preserve their protocol events without interpreting status text
as tool arguments.

## Capabilities and approval

- Register core Pane tools in `apps/server/src/agent/pane-toolset.ts`. Both the
  AI SDK agent and the MCP endpoint consume that factory. Skills are discovered
  through the same memory/skill tools, not a provider-specific inventory.
- Browser and filesystem tools retain their shared package registries.
- MCP calls inherit the profile-scoped conversation context, bucket, run, and
  trust pins. Register an approval waiter before sending any notification.
- Persist an Always allow pin only after a live approval was accepted and its
  waiter resumed. Global pins and per-chat pins use the same storage as API chat.
- ACP tool IDs, arguments, results, and terminal state are protocol data. Failed
  tools are recoverable; a dangling tool at end of turn is an error, not success.
  There is no implicit five-minute turn deadline. The owning abort signal and
  explicit approval timeout remain in effect.

## Shared memory

Claude Code and Codex use Pane's shared memory through the `browseros` MCP tools,
with the same profile, bucket, approval, and read-only rules as API providers.
Chat reloads the budgeted memory/persona/skills snapshot before each ACP turn;
the transport sends changed system context without replaying native chat history.
Standalone agent sessions receive the same shared snapshot and tool guidance.
Legacy per-agent `AGENT_HOME` notes are preserved, but are not the shared memory
shown in Settings and are not automatically imported into it.

## Native-code trust

Production resolves installed CLIs through the user's login shell and supplies
the selected executable's exact path to the packaged ACP adapter. Claude prefers
the installed CLI. Codex compares stable CLI versions and uses the bundled runtime
when it is newer, so an older standalone installation cannot hide bundled model
support. Equal/newer installed Codex versions, custom/unrecognized versions, and
failed version comparisons retain the installed CLI. Chat, agent sessions, model
discovery, and health probes use the same selection. A discovered CLI's
launch or authentication failure is reported rather than silently switching it
to another runtime. User-installed CLI updates remain under the user's control.

When no installed CLI is found, or the bundled Codex is newer, Pane uses its
packaged executable. Adapters and
fallback executables come from `scripts/build/acp-runtime/package-lock.json` and
must be updated and tested as a release unit. Production does not install adapter
packages, update bundled executables, perform ad-hoc signing, or add Gatekeeper
exceptions on the user's machine.

On macOS, the build executes the locked Claude runtime with an extraction preload
to enumerate all embedded native addons. A release-owned loader redirects virtual
Bun addon paths to those staged files. Unknown addons or escaping symlinks fail
explicitly instead of extracting unsigned executable code into a user's temp dir.
This addresses dialogs naming files such as `.bun-501-….node` for the bundled
fallback. Installed CLIs do not use this loader or require the bundled native
files; their Node interpreter and temporary-directory settings take precedence.

The app signer discovers native binaries by Mach-O signature, including new
provider executables without a filename allowlist. Browser CI resources are
signed/notarized in the app packaging stage; standalone server artifacts have a
pre-archive signing/notarization hook. Neither path may upload unsigned macOS code.

## Required release checks

1. Run provider protocol, tool-parity, approval, native-loader, and signing tests,
   plus server/app/build-tool type checks.
2. Build the actual compiled server and locked resources on macOS.
3. Verify Developer ID signatures and load an actual embedded addon through the
   packaged loader with an empty temp directory; assert no addon was extracted.
4. Exercise authenticated Claude Code and Codex through `/chat`: multiple tools,
   a recoverable tool failure, a skill load, a schedule suggestion, and a terminal
   finish event. An unavailable account is a verification gap, not a passing test.
5. Exercise an approval wait, accept with pinning, and confirm the next same-class
   tool does not prompt. Test persistent global settings separately.
6. Verify the final signed/notarized app on a quarantined clean installation.

Validate both installed-CLI selection and the pinned fallback in release checks.
Installed versions can change independently of Pane, so adapter and model
compatibility still require ongoing validation.


## Model catalog refresh

API-provider settings refresh public model metadata from `https://models.dev/api.json`
when opened, with a six-hour in-memory freshness window. The checked-in snapshot in
`packages/shared/src/model-catalog-data.json` provides immediate offline choices.
Both paths use `packages/shared/src/model-catalog.ts`, exclude deprecated and
non-chat models, and carry context/output limits, image/reasoning/tool support and
pricing. Refresh the release fallback with `bun run generate:models` from the
agent workspace. A failed or invalid fetch keeps the last successful query result,
or the bundled snapshot. No API credentials are sent to the catalog service.

The coding-agent `/agents/adapters` endpoint probes the installed Claude Code and
Codex adapters for model IDs and effort options. Results are cached for five minutes;
concurrent probes share one request. Listings return cached or bundled choices immediately
while discovery refreshes in the background; the active UI polls every 30 seconds.
Creation resolves omitted model and effort fields through discovery before persistence.
Failed discovery preserves the last successful
result (or bundled defaults) and retries after 30 seconds. Creation accepts newly
discovered IDs as well as bundled choices. Discovery refreshes metadata only; it
does not install a CLI, change saved provider selections, or upgrade runtime packages.

Public catalog availability does not establish account entitlement. ChatGPT's
subscription endpoint retains a separate curated fallback, and Qwen's login endpoint
retains its endpoint-specific aliases. Custom/local model availability and Azure
deployment names still require explicit configuration. New API protocols or parameters
require an integration change; catalog refresh cannot add SDK support by itself.
