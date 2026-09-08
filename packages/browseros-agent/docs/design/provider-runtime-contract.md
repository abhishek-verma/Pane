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

## Native-code trust

Production does not run npm/bun package installation, self-updates, ad-hoc
signing, or Gatekeeper exceptions on the user's machine. Provider adapters and
executables come from the committed `scripts/build/acp-runtime/package-lock.json`.
This dependency set must be updated and tested as a release unit.

On macOS, the build executes the locked Claude runtime with an extraction preload
to enumerate all embedded native addons. A release-owned loader redirects virtual
Bun addon paths to those staged files. Unknown addons or escaping symlinks fail
explicitly instead of extracting unsigned executable code into a user's temp dir.
This addresses dialogs naming files such as `.bun-501-….node`.

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

Pinned runtimes prevent untested vendor updates from silently changing the local
execution closure. They do not guarantee perpetual support for future cloud
models; model compatibility still requires ongoing release validation.
