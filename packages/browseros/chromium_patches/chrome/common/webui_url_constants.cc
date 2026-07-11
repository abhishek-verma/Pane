diff --git a/chrome/common/webui_url_constants.cc b/chrome/common/webui_url_constants.cc
index 016104d9a3..5b05791b4f 100644
--- a/chrome/common/webui_url_constants.cc
+++ b/chrome/common/webui_url_constants.cc
@@ -120,6 +120,7 @@ bool IsSystemWebUIHost(std::string_view host) {
 // These hosts will also be suggested by BuiltinProvider.
 base::span<const base::cstring_view> ChromeURLHosts() {
   static constexpr auto kChromeURLHosts = std::to_array<base::cstring_view>({
+      kBrowserOSFirstRun,
       kChromeUIAboutHost,
       kChromeUIAccessibilityHost,
       kChromeUIActorInternalsHost,
@@ -128,6 +129,7 @@ base::span<const base::cstring_view> ChromeURLHosts() {
 #endif
       kChromeUIAutofillInternalsHost,
       kChromeUIBluetoothInternalsHost,
+      kChromeUIBrowserOSOnboardingHost,
       kChromeUIBrowsingTopicsInternalsHost,
       kChromeUIChromeFindsInternalsHost,
       kChromeUIChromeURLsHost,
