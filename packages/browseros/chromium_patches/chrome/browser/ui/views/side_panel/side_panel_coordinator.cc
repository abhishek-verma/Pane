diff --git a/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc b/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc
index a394820870..393359166b 100644
--- a/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc
+++ b/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc
@@ -26,6 +26,7 @@
 #include "chrome/browser/ui/toolbar/toolbar_actions_model.h"
 #include "chrome/browser/ui/user_education/browser_user_education_interface.h"
 #include "chrome/browser/ui/views/frame/browser_view.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
 #include "chrome/browser/ui/views/side_panel/side_panel.h"
 #include "chrome/browser/ui/views/side_panel/side_panel_header.h"
 #include "chrome/browser/ui/views/side_panel/side_panel_header_controller.h"
@@ -350,8 +351,20 @@ void SidePanelCoordinator::PopulateSidePanel(
   entry->OnEntryShown();
   if (previous_entry) {
     previous_entry->OnEntryHidden();
-  } else {
-    content->RequestFocus();
+  }
+  content->RequestFocus();
+
+  if (auto* header = side_panel->GetHeaderView<SidePanelHeader>()) {
+    bool is_browseros_extension = false;
+    if (entry->key().id() == SidePanelEntryId::kExtension) {
+      const std::optional<extensions::ExtensionId>& extension_id =
+          entry->key().extension_id();
+      if (extension_id.has_value() &&
+          browseros::IsBrowserOSExtension(*extension_id)) {
+        is_browseros_extension = true;
+      }
+    }
+    header->SetVisible(!is_browseros_extension);
   }
 
   side_panel->UpdateWidthOnEntryChanged();
