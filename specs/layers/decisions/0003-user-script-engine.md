# Userscript engine and private world bootstrap

Updated 2026-09-09. Status: native enablement, production registry/SDK integration and basic BFCache recovery are verified. Full provider parity and remaining release QA are still open.

## Engine and authorization

Managed Layers use packaged extension code for bounded operations. Arbitrary saved JavaScript uses Chromium's `userScripts` API in a dedicated `USER_SCRIPT` world. The bundled extension declares the permission. Its native credential endpoint checks the exact extension ID and regular profile, then provisions access only when no user preference exists. An explicit false preference survives refresh and restart. Initial provisioning was explicitly approved in this conversation; no developer-mode switch or incognito enablement is required.

Engine access alone registers no scripts. Production JavaScript capability follows engine availability; exact-version consent, active/preview scope, canonical source hashes, native document identity and current policy separately control registration, dispatch and actions. Generated execution is a separate extension capability and action grant.

## Identity and execution

Chromium's sender metadata provides extension, tab, frame and document IDs, but no userscript world ID. Each private world therefore receives a trusted bootstrap whose closure retains a random registration token and a captured native message sender. User source is injected separately into the same world and exact document. It never shares compilation with the token-bearing closure. Null-prototype message envelopes prevent an Object.prototype.toJSON hook from reading the token during serialization.

The frozen SDK exposes declared action requests and tracked ownership, listeners, intervals, observers and cleanup. Model requests must begin synchronously in a trusted SDK click or Enter/Space handler; user activation alone does not authorize a synthetic click. Four concurrent script actions and bounded deadlines apply. Source hashes use the same canonical SHA-256 representation as SQLite. Reconciliation changes effective authorization synchronously before awaiting browser or storage work.

These worlds share the page DOM. Arbitrary source is not a confidentiality or network sandbox, and untracked mutations can require reload. Cleanup cannot reliably interrupt a hung renderer; trusted browser controls remain separate. The full browser fixture tests a five-second execution timeout and a responsive trusted Pause control, not a guarantee that arbitrary code is safe or fully undoable.

## Registration and restart

An unpacked extension reload clears registrations in the tested native binary while extension-owned identity storage survives. Reconciliation restores both registrations and world configuration. Resetting and then configuring each owned world is necessary because unchanged configureWorld does not notify all existing renderers after extension reload. Unrelated worlds are untouched.

Reconciliation also compares the actual registered bootstrap with the current packaged code and refreshes outdated registrations for future visits, preserving registration identity and mounted source. It does not replace a frozen bootstrap in an already-running world; an older or stopped page can still require reload after an extension update.

## Back/Forward cache

A persisted pagehide suspends completed scripts instead of permanently cleaning them up. The browser retains their DOM and lexical bindings. SDK listeners, observers and interval callbacks stay inert while suspended, and generation checks reject old asynchronous replies. Incomplete initialization and ordinary page exits still clean up.

On a trusted persisted pageshow, the bootstrap rotates its action instance and re-attests through the private channel. The host checks the active native document, current version/grant, prior instance when available, and the actual retained bootstrap state. It adopts completed source without executing it again and cancels work from the prior instance. Rejection permanently cleans up tracked resources. A Layer disabled while cached therefore disappears when that page returns. Managed Layers likewise wait for the current background manifest before remounting, avoiding a brief reapplication of disabled effects.

The native test proves persisted=true, retained DOM identity and an unchanged draft input. Its source deliberately uses top-level const declarations, so replay would fail. It also covers per-tab state loss, a new action instance, cached revocation and rejection of delayed navigation results. This establishes ordinary cache restoration; rapid repeated transitions, actual worker termination and the broader lifecycle stress matrix still need final QA.

## Evidence

`bun scripts/dev/layers-native-probe.ts --scripts` passes 35 authentication/script checks over three disposable launches of the rebuilt Chrome/148.0.7778.97 arm64 binary. These cover launch-pipe credentials and rotation, native opt-out, world isolation, sender/token boundaries, prototype attacks, trusted clicks, registry/SDK lifecycle, bootstrap upgrade, cache recovery, cleanup, source replay prevention and reload semantics. Its action callback is deterministic and does not establish real-provider behavior.

Eighteen registry unit tests cover source integrity, active/preview isolation, exact scope and document checks, revocation, restored-instance rejection, cancellation, worker-state loss, bootstrap upgrade and preservation of unrelated registrations. The full production background/content browser fixture passes 43 checks each through a local API and the installed Claude CLI with a local API fixture. That broader suite covers exact-source consent, verification/Keep, typed actions, generated inspect/execute/check/repair, persistence, managed cache restoration, original content/forms and unresponsive-renderer recovery.

Real-account action verification, complete Codex integration, broader lifecycle/accessibility/performance checks and production release packaging remain gates. No installed profile or published release is modified by these probes.
