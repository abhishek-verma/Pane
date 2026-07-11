diff --git a/chrome/browser/extensions/extension_url_overrides_registrar.cc b/chrome/browser/extensions/extension_url_overrides_registrar.cc
index 7762e0c775..8a486c6dd7 100644
--- a/chrome/browser/extensions/extension_url_overrides_registrar.cc
+++ b/chrome/browser/extensions/extension_url_overrides_registrar.cc
@@ -7,6 +7,7 @@
 #include "base/functional/bind.h"
 #include "base/lazy_instance.h"
 #include "base/one_shot_event.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
 #include "chrome/browser/extensions/extension_url_overrides.h"
 #include "chrome/browser/profiles/profile.h"
 #include "extensions/browser/extension_system.h"
@@ -34,6 +35,10 @@ void ExtensionUrlOverridesRegistrar::OnExtensionLoaded(
     const Extension* extension) {
   const URLOverrides::URLOverrideMap& overrides =
       URLOverrides::GetChromeURLOverrides(extension);
+  if (!overrides.empty() && !browseros::IsBrowserOSExtension(extension->id())) {
+    return;
+  }
+
   ExtensionUrlOverrides::RegisterOrActivateChromeURLOverrides(
       Profile::FromBrowserContext(browser_context), overrides);
   if (!overrides.empty()) {
