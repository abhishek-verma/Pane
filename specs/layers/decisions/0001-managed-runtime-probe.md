# Managed runtime and advanced-script prerequisite

Date: 2026-09-08. Scope: first LP-00 experiment; other LP-00 decisions remain open.

## Evidence

`packages/browseros-agent/scripts/dev/layers-runtime-probe.ts` launches `/Applications/Pane.app/Contents/MacOS/Pane` using a disposable profile and fixture MV3 extension. The binary reports `Chrome/148.0.7778.97`.

The extension declares `userScripts`, `scripting`, `storage`, `tabs` and only the local fixture origin. Without changing browser preferences, `chrome.userScripts` is undefined. The attempted `getScripts()` call therefore cannot run. This is an availability result, not proof that an enabled API would lack multi-world support.

Read-only inspection of the local Chromium checkout identifies `extensions/browser/user_script_manager.cc`: `AreUserScriptsAllowed` checks both the API permission and profile/extension allowed state; `IsUserScriptPrefEnabled` defaults false. The checked `runtime.json` message-sender declaration includes document identity but no user-script world ID. A script-authored `layerId` therefore cannot establish broker authority. Native enablement and an attestation design still need implementation and executable tests.

The managed interpreter runs as packaged content code and passes the fixture checks recorded in `../IMPLEMENTATION-STATUS.md`, including a response with `script-src 'none'; style-src 'none'`. That result covers this build/fixture, not every site's rendering behavior.

## Decision

Continue with a packaged managed interpreter and typed action transport. Keep advanced capability false until a native-owned enablement and identity path is proved. Do not evaluate agent source in the privileged extension world or enable a browser-wide development preference as the product solution.

The browser-to-sidecar bootstrap and provider-action isolation experiments are still outstanding. This probe is not an LP-00 completion receipt and does not justify enabling production Layers.
