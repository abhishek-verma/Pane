diff --git a/chrome/browser/ui/accelerator_table.cc b/chrome/browser/ui/accelerator_table.cc
index 06e3a9b5e0..ac91d60262 100644
--- a/chrome/browser/ui/accelerator_table.cc
+++ b/chrome/browser/ui/accelerator_table.cc
@@ -15,6 +15,7 @@
 #include "build/branding_buildflags.h"
 #include "build/build_config.h"
 #include "chrome/app/chrome_command_ids.h"
+#include "chrome/browser/browser_features.h"
 #include "chrome/browser/ui/tabs/features.h"
 #include "chrome/browser/ui/ui_features.h"
 #include "components/lens/buildflags.h"
@@ -333,6 +334,11 @@ std::vector<AcceleratorMapping> GetAcceleratorList() {
     }
 #endif
 
+    if (base::FeatureList::IsEnabled(features::kBrowserOsKeyboardShortcuts)) {
+      accelerators->push_back(
+          {ui::VKEY_A, ui::EF_ALT_DOWN, IDC_TOGGLE_BROWSEROS_AGENT});
+    }
+
     if (base::FeatureList::IsEnabled(features::kUIDebugTools)) {
       accelerators->insert(accelerators->begin(),
                            std::begin(kUIDebugAcceleratorMap),
