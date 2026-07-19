diff --git a/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc b/chrome/browser/ui/views/side_panel/side_panel_coordinator.cc
index a394820870..572bd52914 100644
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
@@ -282,6 +283,21 @@ void SidePanelCoordinator::PopulateSidePanel(
   side_panel->SetActiveEntryUsesDefaultHorizontalAlignment(
       entry->key().id() != SidePanelEntry::Id::kContextualTasks);
 
+  // BrowserOS: suppress the native header for the Pane extension side panel.
+  // The extension renders its own chrome, so we disable the header entirely
+  // (including its top-inset padding) by calling set_should_show_header(false)
+  // before the AddHeaderView / RemoveHeaderView branch below. Using
+  // SetVisible(false) is wrong — it hides the widget but leaves the border
+  // inset reserved for the header height, causing the blank gap at the top.
+  if (entry->key().id() == SidePanelEntryId::kExtension) {
+    const std::optional<extensions::ExtensionId>& extension_id =
+        entry->key().extension_id();
+    if (extension_id.has_value() &&
+        browseros::IsBrowserOSExtension(*extension_id)) {
+      entry->set_should_show_header(false);
+    }
+  }
+
   if (entry->should_show_header()) {
     side_panel->AddHeaderView(std::make_unique<SidePanelHeader>(
         std::make_unique<SidePanelHeaderController>(
@@ -350,9 +366,8 @@ void SidePanelCoordinator::PopulateSidePanel(
   entry->OnEntryShown();
   if (previous_entry) {
     previous_entry->OnEntryHidden();
-  } else {
-    content->RequestFocus();
   }
+  content->RequestFocus();
 
   side_panel->UpdateWidthOnEntryChanged();
 
