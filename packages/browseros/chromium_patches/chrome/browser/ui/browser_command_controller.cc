diff --git a/chrome/browser/ui/browser_command_controller.cc b/chrome/browser/ui/browser_command_controller.cc
index 738696abf0..dfc8ded0aa 100644
--- a/chrome/browser/ui/browser_command_controller.cc
+++ b/chrome/browser/ui/browser_command_controller.cc
@@ -7,6 +7,7 @@
 #include <stddef.h>
 
 #include <algorithm>
+#include <optional>
 #include <string>
 
 #include "base/check_deref.h"
@@ -71,6 +72,7 @@
 #include "chrome/browser/ui/profiles/profile_view_utils.h"
 #include "chrome/browser/ui/read_anything/read_anything_controller.h"
 #include "chrome/browser/ui/read_anything/read_anything_entry_point_controller.h"
+#include "chrome/browser/ui/side_panel/side_panel_action_callback.h"
 #include "chrome/browser/ui/side_panel/side_panel_entry_id.h"
 #include "chrome/browser/ui/side_panel/side_panel_ui.h"
 #include "chrome/browser/ui/singleton_tabs.h"
@@ -1089,6 +1091,13 @@ bool BrowserCommandController::ExecuteCommandWithDisposition(
       browser_->GetFeatures().side_panel_ui()->Show(
           SidePanelEntryId::kBookmarks, SidePanelOpenTrigger::kAppMenu);
       break;
+    case IDC_TOGGLE_BROWSEROS_AGENT:
+      // Dispatches a real action.onClicked event so toggleSidePanel.ts's
+      // scope-aware logic is the single implementation of side panel
+      // open/close behavior. See side_panel_action_callback.h for
+      // DispatchAgentSidePanelToggleClick.
+      DispatchAgentSidePanelToggleClick(browser_);
+      break;
     case IDC_SHOW_APP_MENU:
       base::RecordAction(base::UserMetricsAction("Accel_Show_App_Menu"));
       ShowAppMenu(browser_);
@@ -1802,6 +1811,7 @@ void BrowserCommandController::InitCommandState() {
   }
 
   command_updater_.UpdateCommandEnabled(IDC_SHOW_BOOKMARK_SIDE_PANEL, true);
+  command_updater_.UpdateCommandEnabled(IDC_TOGGLE_BROWSEROS_AGENT, true);
 
   if (browser_->is_type_normal()) {
     // Reading list commands.
