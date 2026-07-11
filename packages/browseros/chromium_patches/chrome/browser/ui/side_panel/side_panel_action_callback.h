diff --git a/chrome/browser/ui/side_panel/side_panel_action_callback.h b/chrome/browser/ui/side_panel/side_panel_action_callback.h
index eb087227fd..7fa9b9469b 100644
--- a/chrome/browser/ui/side_panel/side_panel_action_callback.h
+++ b/chrome/browser/ui/side_panel/side_panel_action_callback.h
@@ -7,6 +7,7 @@
 
 #include "chrome/browser/ui/side_panel/side_panel_entry_key.h"
 #include "chrome/browser/ui/side_panel/side_panel_enums.h"
+#include "extensions/common/extension_id.h"
 #include "ui/actions/actions.h"
 #include "ui/base/class_property.h"
 
@@ -16,6 +17,13 @@ actions::ActionItem::InvokeActionCallback CreateToggleSidePanelActionCallback(
     SidePanelEntryKey key,
     BrowserWindowInterface* bwi);
 
+// Creates an action callback for BrowserOS extensions that uses the contextual
+// tab-specific side panel toggle.
+actions::ActionItem::InvokeActionCallback
+CreateBrowserosToggleSidePanelActionCallback(
+    const extensions::ExtensionId& extension_id,
+    BrowserWindowInterface* bwi);
+
 extern const ui::ClassProperty<
     std::underlying_type_t<SidePanelOpenTrigger>>* const
     kSidePanelOpenTriggerKey;
