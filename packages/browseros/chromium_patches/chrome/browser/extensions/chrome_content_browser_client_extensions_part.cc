diff --git a/chrome/browser/extensions/chrome_content_browser_client_extensions_part.cc b/chrome/browser/extensions/chrome_content_browser_client_extensions_part.cc
index 0000000000..1111111111 100644
--- a/chrome/browser/extensions/chrome_content_browser_client_extensions_part.cc
+++ b/chrome/browser/extensions/chrome_content_browser_client_extensions_part.cc
@@ -27,6 +27,7 @@
 #include "chrome/browser/sync_file_system/local/sync_file_system_backend.h"
 #include "chrome/common/chrome_constants.h"
 #include "chrome/common/chrome_switches.h"
+#include "third_party/blink/public/common/switches.h"
 #include "chrome/common/extensions/extension_constants.h"
 #include "chrome/common/url_constants.h"
 #include "components/dom_distiller/core/url_constants.h"
@@ -911,6 +912,13 @@
           ProcessMap::Get(process.GetBrowserContext())
               ->GetEnabledExtensionByProcessID(process.GetDeprecatedID())) {
     command_line->AppendSwitch(switches::kExtensionProcess);
+
+    // Pane agent extension (biedncdd…): larger V8 heap for long chat + evidence.
+    // Other extensions keep Chromium defaults.
+    if (extension->id() == "biedncddmddkpapdplhcnkhhplnfgbif") {
+      command_line->AppendSwitchASCII(blink::switches::kJavaScriptFlags,
+                                      "--max-old-space-size=4096");
+    }
 
     // Blink usually initializes the main-thread Isolate in background mode for
     // extension processes, assuming that they can't detect visibility. However,
