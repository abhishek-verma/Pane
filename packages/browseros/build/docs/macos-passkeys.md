# iCloud passkeys in Pane

Chromium enables iCloud Keychain authentication on macOS 13.3+ only when the
browser process has `com.apple.developer.web-browser.public-key-credential`.
Pane's original signing configuration omitted this capability, so passkeys stored
in Apple Passwords could work in Chrome but remain unavailable in Pane.

This is an Apple-managed capability. Adding it to the static entitlements plist
without Apple's provisioning approval is not a supported fix.

1. The Apple Developer organization account holder must request
   [macOS browser passkeys](https://developer.apple.com/contact/request/macos-browsers-passkeys/)
   for Pane. See Apple's [entitlement requirements](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.web-browser.public-key-credential).
2. After approval, enable the capability for `com.panebrowser.app` and generate a
   Developer ID distribution provisioning profile using the release signing
   certificate. Download the profile to the signing machine.
3. Set `MACOS_PASSKEY_PROVISIONING_PROFILE` to its absolute path in the signing
   environment. Run the normal signed/notarized package flow. This is a signing
   change; it does not require recompiling Chromium.

The signer validates the profile's capability, app identifier, expiration, and
distribution type, embeds it at `Contents/embedded.provisionprofile`, and merges
the application identifier and passkey entitlement with the browser's existing
entitlements. An embedded profile is reused when repackaging. A configured but
invalid profile fails signing. Without a profile, signing emits an explicit
warning and produces a browser without iCloud passkey support.

After installing the newly signed build, quit and relaunch Pane, then check:

```sh
codesign -d --entitlements - /Applications/Pane.app
codesign --verify --deep --strict /Applications/Pane.app
spctl --assess --type execute --verbose /Applications/Pane.app
```

Confirm the passkey entitlement is `true` and the embedded profile exists. On a
site with an existing iCloud passkey, choose the passkey login/2FA option, allow
Pane access when macOS prompts, and complete the system authentication dialog.
Also verify a password plus one-time-code login still works. End-to-end success
requires the approved profile and an interactive account test; signing tests
alone cannot establish that the login succeeds.
