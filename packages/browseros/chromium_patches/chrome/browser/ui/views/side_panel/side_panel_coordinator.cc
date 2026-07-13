diff --git a/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc b/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc
index a394820870..f14bcf2771 100644
--- a/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc
+++ b/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc
@@ -32,6 +32,7 @@
 #include "chrome/browser/ui/views/side_panel/side_panel_helper.h"
 #include "chrome/browser/ui/views/side_panel/side_panel_toolbar_pinning_controller.h"
 #include "chrome/browser/ui/views/side_panel/side_panel_web_ui_view.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
 #include "chrome/browser/ui/views/toolbar/pinned_toolbar_actions_container.h"
 #include "chrome/browser/ui/views/toolbar/toolbar_view.h"
 #include "components/feature_engagement/public/event_constants.h"
@@ -350,9 +351,21 @@ void SidePanelCoordinator::PopulateSidePanel(
   entry->OnEntryShown();
   if (previous_entry) {
     previous_entry->OnEntryHidden();
-  } else {
-    content->RequestFocus();
   }
+  content->RequestFocus();
+
+  if (header_view_) {
+    bool is_browseros_extension = false;
+    if (entry->key().id() == SidePanelEntryId::kExtension) {
+      const std::optional<extensions::ExtensionId>& extension_id =
+          entry->key().extension_id();
+      if (extension_id.has_value() &&
+          browseros::IsBrowserOSExtension(*extension_id)) {
+        is_browseros_extension = true;
+      }
+    }
+    header_view_->SetVisible(!is_browseros_extension);
+  }
 
   side_panel->UpdateWidthOnEntryChanged();
 
