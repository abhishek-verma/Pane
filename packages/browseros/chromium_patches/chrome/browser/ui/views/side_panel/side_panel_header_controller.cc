diff --git a/chrome/browser/ui/views/side_panel/side_panel_header_controller.cc b/chrome/browser/ui/views/side_panel/side_panel_header_controller.cc
index 1111111111111..2222222222222 100644
--- a/chrome/browser/ui/views/side_panel/side_panel_header_controller.cc
+++ b/chrome/browser/ui/views/side_panel/side_panel_header_controller.cc
@@ -14,6 +14,7 @@
 #include "base/memory/weak_ptr.h"
 #include "base/metrics/field_trial_params.h"
 #include "base/time/time.h"
+#include "components/vector_icons/vector_icons.h"
 #include "chrome/browser/browseros/core/browseros_constants.h"
 #include "chrome/app/vector_icons/vector_icons.h"
 #include "chrome/browser/profiles/profile.h"
 #include "chrome/browser/ui/browser.h"
@@ -284,6 +285,16 @@ void SidePanelHeaderController::UpdatePinButton() {
 
 ui::ImageModel SidePanelHeaderController::GetIconImage() {
   CHECK(side_panel_entry_);
+  if (side_panel_entry_->key().id() == SidePanelEntryId::kExtension) {
+    const std::optional<extensions::ExtensionId>& extension_id =
+        side_panel_entry_->key().extension_id();
+    if (extension_id.has_value() &&
+        browseros::IsBrowserOSExtension(*extension_id)) {
+      return ui::ImageModel::FromVectorIcon(vector_icons::kPaneMarkIcon,
+                                            kColorSidePanelEntryIcon, 16);
+    }
+  }
   ui::ImageModel icon =
       SidePanelHelper::GetActionItem(browser_, side_panel_entry_->key())
           ->GetImage();
