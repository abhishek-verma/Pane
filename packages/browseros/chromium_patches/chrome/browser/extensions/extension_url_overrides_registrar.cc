diff --git a/chrome/browser/extensions/extension_url_overrides_registrar.cc b/chrome/browser/extensions/extension_url_overrides_registrar.cc
index 7762e0c..209cc9f 100644
--- a/chrome/browser/extensions/extension_url_overrides_registrar.cc
+++ b/chrome/browser/extensions/extension_url_overrides_registrar.cc
@@ -7,14 +7,83 @@
 #include "base/functional/bind.h"
 #include "base/lazy_instance.h"
 #include "base/one_shot_event.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
+#include "chrome/browser/extensions/extension_tab_util.h"
 #include "chrome/browser/extensions/extension_url_overrides.h"
 #include "chrome/browser/profiles/profile.h"
+#include "chrome/common/webui_url_constants.h"
+#include "content/public/browser/navigation_controller.h"
+#include "content/public/browser/navigation_entry.h"
+#include "content/public/browser/web_contents.h"
+#include "content/public/common/referrer.h"
 #include "extensions/browser/extension_system.h"
 #include "extensions/buildflags/buildflags.h"
+#include "extensions/common/constants.h"
+#include "ui/base/page_transition_types.h"
 
 static_assert(BUILDFLAG(ENABLE_EXTENSIONS_CORE));
 
 namespace extensions {
+namespace {
+
+// Returns true if |entry| is showing Chrome's built-in NTP (or the chrome://
+// newtab virtual URL), rather than an already-active extension NTP.
+bool IsChromeDefaultNtp(content::NavigationEntry* entry) {
+  if (!entry || entry->IsInitialEntry()) {
+    return false;
+  }
+
+  const GURL& url = entry->GetURL();
+  if (url.SchemeIs(kExtensionScheme)) {
+    // Already serving an extension NTP (including Pane's).
+    return false;
+  }
+
+  auto is_chrome_ntp_host = [](const GURL& gurl) {
+    return gurl.SchemeIs(content::kChromeUIScheme) &&
+           (gurl.host() == chrome::kChromeUINewTabHost ||
+            gurl.host() == chrome::kChromeUINewTabPageHost ||
+            gurl.host() == chrome::kChromeUINewTabPageThirdPartyHost);
+  };
+
+  return is_chrome_ntp_host(url) || is_chrome_ntp_host(entry->GetVirtualURL());
+}
+
+// Startup often opens chrome://newtab before the BrowserOS agent extension has
+// loaded its chrome_url_overrides.newtab entry. Chromium activates the override
+// on load but does not reload existing NTP tabs, so the default Chrome NTP can
+// stick. Reload those tabs once the override is active.
+void ReloadChromeNtpIfNeeded(Profile* profile,
+                             content::WebContents* web_contents) {
+  if (Profile::FromBrowserContext(web_contents->GetBrowserContext()) !=
+      profile) {
+    return;
+  }
+
+  content::NavigationController& controller = web_contents->GetController();
+  content::NavigationEntry* entry = controller.GetPendingEntry()
+                                         ? controller.GetPendingEntry()
+                                         : controller.GetLastCommittedEntry();
+  if (!IsChromeDefaultNtp(entry)) {
+    return;
+  }
+
+  const GURL new_tab_url(chrome::kChromeUINewTabURL);
+  controller.LoadURL(
+      new_tab_url,
+      content::Referrer::SanitizeForRequest(
+          new_tab_url,
+          content::Referrer(new_tab_url,
+                            network::mojom::ReferrerPolicy::kDefault)),
+      ui::PAGE_TRANSITION_RELOAD, std::string());
+}
+
+void ReloadBrowserOSNewTabOverrides(Profile* profile) {
+  ExtensionTabUtil::ForEachTab(
+      base::BindRepeating(&ReloadChromeNtpIfNeeded, profile));
+}
+
+}  // namespace
 
 ExtensionUrlOverridesRegistrar::ExtensionUrlOverridesRegistrar(
     content::BrowserContext* context) {
@@ -34,9 +103,20 @@ void ExtensionUrlOverridesRegistrar::OnExtensionLoaded(
     const Extension* extension) {
   const URLOverrides::URLOverrideMap& overrides =
       URLOverrides::GetChromeURLOverrides(extension);
-  ExtensionUrlOverrides::RegisterOrActivateChromeURLOverrides(
-      Profile::FromBrowserContext(browser_context), overrides);
+  if (!overrides.empty() && !browseros::IsBrowserOSExtension(extension->id())) {
+    return;
+  }
+
+  Profile* profile = Profile::FromBrowserContext(browser_context);
+  ExtensionUrlOverrides::RegisterOrActivateChromeURLOverrides(profile,
+                                                              overrides);
   if (!overrides.empty()) {
+    // Pane's homepage is the agent extension NTP override. If startup already
+    // painted Chrome's default NTP, swap those tabs over now.
+    if (browseros::IsBrowserOSExtension(extension->id()) &&
+        overrides.contains(chrome::kChromeUINewTabHost)) {
+      ReloadBrowserOSNewTabOverrides(profile);
+    }
     for (auto& observer : observer_list_) {
       observer.OnExtensionOverrideAdded(*extension);
     }
