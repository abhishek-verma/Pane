diff --git a/chrome/browser/ui/side_panel/side_panel_action_callback.cc b/chrome/browser/ui/side_panel/side_panel_action_callback.cc
index f81e396170..c4d7abeeac 100644
--- a/chrome/browser/ui/side_panel/side_panel_action_callback.cc
+++ b/chrome/browser/ui/side_panel/side_panel_action_callback.cc
@@ -4,6 +4,13 @@
 
 #include "chrome/browser/ui/side_panel/side_panel_action_callback.h"
 
+#include <optional>
+
+#include "base/logging.h"
+#include "chrome/browser/extensions/api/side_panel/side_panel_service.h"
+#include "chrome/browser/extensions/extension_tab_util.h"
+#include "chrome/browser/profiles/profile.h"
+
 // TODO(crbug.com/492550611): Remove once we only need BWI.
 #if !BUILDFLAG(IS_ANDROID)
 #include "chrome/browser/ui/browser.h"
@@ -12,6 +19,9 @@
 #include "chrome/browser/ui/browser_window/public/browser_window_features.h"
 #include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
 #include "chrome/browser/ui/side_panel/side_panel_ui.h"
+#include "components/tabs/public/tab_interface.h"
+#include "content/public/browser/web_contents.h"
+#include "extensions/browser/extension_registry.h"
 
 namespace {
 constexpr std::underlying_type_t<SidePanelOpenTrigger>
@@ -41,3 +51,62 @@ actions::ActionItem::InvokeActionCallback CreateToggleSidePanelActionCallback(
       },
       key, bwi);
 }
+
+actions::ActionItem::InvokeActionCallback
+CreateBrowserosToggleSidePanelActionCallback(
+    const extensions::ExtensionId& extension_id,
+    BrowserWindowInterface* bwi) {
+  return base::BindRepeating(
+      [](extensions::ExtensionId extension_id, BrowserWindowInterface* bwi,
+         actions::ActionItem* item, actions::ActionInvocationContext context) {
+        LOG(INFO) << "browseros: Toolbar action clicked for extension="
+                  << extension_id;
+
+        tabs::TabInterface* active_tab = bwi->GetActiveTabInterface();
+        if (!active_tab) {
+          LOG(WARNING) << "browseros: No active tab";
+          return;
+        }
+
+        content::WebContents* active_contents = active_tab->GetContents();
+        if (!active_contents) {
+          LOG(WARNING) << "browseros: No active tab contents";
+          return;
+        }
+
+        int tab_id = extensions::ExtensionTabUtil::GetTabId(active_contents);
+        LOG(INFO) << "browseros: Active tab_id=" << tab_id;
+
+        Profile* profile =
+            Profile::FromBrowserContext(active_contents->GetBrowserContext());
+        const extensions::Extension* extension =
+            extensions::ExtensionRegistry::Get(profile)
+                ->enabled_extensions()
+                .GetByID(extension_id);
+
+        if (!extension) {
+          LOG(WARNING) << "browseros: Extension not found: " << extension_id;
+          return;
+        }
+
+        extensions::SidePanelService* service =
+            extensions::SidePanelService::Get(profile);
+        if (!service) {
+          LOG(WARNING) << "browseros: SidePanelService not found";
+          return;
+        }
+
+        auto result = service->BrowserosToggleSidePanelForTab(
+            *extension, profile, tab_id,
+            /*include_incognito_information=*/true,
+            /*desired_state=*/std::nullopt);
+
+        if (!result.has_value()) {
+          LOG(WARNING) << "browseros: Toggle failed: " << result.error();
+          return;
+        }
+
+        LOG(INFO) << "browseros: Toggle result: " << result.value();
+      },
+      extension_id, bwi);
+}
