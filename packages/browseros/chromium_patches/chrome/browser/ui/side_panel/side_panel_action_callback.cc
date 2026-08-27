diff --git a/chrome/browser/ui/side_panel/side_panel_action_callback.cc b/chrome/browser/ui/side_panel/side_panel_action_callback.cc
index f81e396170..5db0724ad5 100644
--- a/chrome/browser/ui/side_panel/side_panel_action_callback.cc
+++ b/chrome/browser/ui/side_panel/side_panel_action_callback.cc
@@ -4,6 +4,15 @@
 
 #include "chrome/browser/ui/side_panel/side_panel_action_callback.h"
 
+#include "base/logging.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
+#include "chrome/browser/extensions/extension_action_dispatcher.h"
+#include "chrome/browser/infobars/simple_alert_infobar_creator.h"
+#include "chrome/browser/profiles/profile.h"
+#include "components/infobars/content/content_infobar_manager.h"
+#include "extensions/browser/extension_action.h"
+#include "extensions/browser/extension_action_manager.h"
+
 // TODO(crbug.com/492550611): Remove once we only need BWI.
 #if !BUILDFLAG(IS_ANDROID)
 #include "chrome/browser/ui/browser.h"
@@ -12,6 +21,9 @@
 #include "chrome/browser/ui/browser_window/public/browser_window_features.h"
 #include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
 #include "chrome/browser/ui/side_panel/side_panel_ui.h"
+#include "components/tabs/public/tab_interface.h"
+#include "content/public/browser/web_contents.h"
+#include "extensions/browser/extension_registry.h"
 
 namespace {
 constexpr std::underlying_type_t<SidePanelOpenTrigger>
@@ -41,3 +53,61 @@ actions::ActionItem::InvokeActionCallback CreateToggleSidePanelActionCallback(
       },
       key, bwi);
 }
+
+// Dispatches action.onClicked for the BrowserOS Agent extension on the
+// active tab of `bwi`, exactly as if a normal pinned extension toolbar icon
+// had been clicked. See side_panel_action_callback.h for why: this makes the
+// extension's own toggleSidePanel() the single implementation of side panel
+// open/close behavior (for both per-tab and per-window modes) rather than
+// having native code re-decide panel scope itself.
+void DispatchAgentSidePanelToggleClick(BrowserWindowInterface* bwi) {
+  tabs::TabInterface* active_tab = bwi->GetActiveTabInterface();
+  if (!active_tab) {
+    LOG(WARNING) << "browseros: No active tab for Agent side panel toggle";
+    return;
+  }
+
+  content::WebContents* active_contents = active_tab->GetContents();
+  if (!active_contents) {
+    LOG(WARNING) << "browseros: No active tab contents for Agent toggle";
+    return;
+  }
+
+  Profile* profile =
+      Profile::FromBrowserContext(active_contents->GetBrowserContext());
+  const extensions::Extension* extension =
+      extensions::ExtensionRegistry::Get(profile)
+          ->enabled_extensions()
+          .GetByID(browseros::kAgentExtensionId);
+
+  if (!extension) {
+    LOG(WARNING) << "browseros: Agent extension not found";
+    infobars::ContentInfoBarManager* infobar_manager =
+        infobars::ContentInfoBarManager::FromWebContents(active_contents);
+    if (infobar_manager) {
+      CreateSimpleAlertInfoBar(
+          infobar_manager,
+          infobars::InfoBarDelegate::
+              BROWSEROS_AGENT_INSTALLING_INFOBAR_DELEGATE,
+          nullptr,
+          u"Pane Agent is installing/updating. Please try again shortly.",
+          /*auto_expire=*/true,
+          /*should_animate=*/true,
+          /*closeable=*/true);
+    }
+    return;
+  }
+
+  extensions::ExtensionAction* extension_action =
+      extensions::ExtensionActionManager::Get(profile)->GetExtensionAction(
+          *extension);
+  if (!extension_action) {
+    LOG(WARNING) << "browseros: No ExtensionAction for Agent extension";
+    return;
+  }
+
+  LOG(INFO) << "browseros: Dispatching action.onClicked for Agent extension";
+  extensions::ExtensionActionDispatcher::Get(profile)
+      ->DispatchExtensionActionClicked(*extension_action, active_contents,
+                                        extension);
+}
