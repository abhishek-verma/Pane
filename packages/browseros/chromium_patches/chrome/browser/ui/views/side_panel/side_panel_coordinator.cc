diff --git a/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc b/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc
index a394820870..f14bcf2771 100644
--- a/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc
+++ b/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc
@@ -29,6 +29,7 @@
 #include "chrome/browser/ui/views/side_panel/side_panel_registry.h"
 #include "chrome/browser/ui/views/side_panel/side_panel_resize_area.h"
 #include "chrome/browser/ui/views/side_panel/side_panel_util.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
 
 namespace {
 
@@ -350,9 +350,22 @@ void SidePanelCoordinator::PopulateSidePanel(
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
