diff --git a/chrome/common/webui_url_constants.h b/chrome/common/webui_url_constants.h
index d4f57a6ed3..70112d4153 100644
--- a/chrome/common/webui_url_constants.h
+++ b/chrome/common/webui_url_constants.h
@@ -33,6 +33,11 @@ namespace chrome {
 // needed.
 // Please keep in alphabetical order, with OS/feature specific sections below.
 inline constexpr char kChromeUIAboutHost[] = "about";
+inline constexpr char kBrowserOSFirstRun[] = "browseros-welcome";
+inline constexpr char kChromeUIBrowserOSOnboardingHost[] =
+    "browseros-onboarding";
+inline constexpr char kChromeUIBrowserOSOnboardingURL[] =
+    "chrome://browseros-onboarding/";
 inline constexpr char kChromeUIAboutURL[] = "chrome://about/";
 inline constexpr char kChromeUIAccessCodeCastHost[] = "access-code-cast";
 inline constexpr char kChromeUIAccessCodeCastURL[] =
