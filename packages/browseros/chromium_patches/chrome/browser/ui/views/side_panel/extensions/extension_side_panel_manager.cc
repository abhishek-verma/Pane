diff --git a/chrome/browser/ui/views/side_panel/extensions/extension_side_panel_manager.cc b/chrome/browser/ui/views/side_panel/extensions/extension_side_panel_manager.cc
index c2437bfc29..9bc9ffea9c 100644
--- a/chrome/browser/ui/views/side_panel/extensions/extension_side_panel_manager.cc
+++ b/chrome/browser/ui/views/side_panel/extensions/extension_side_panel_manager.cc
@@ -4,8 +4,12 @@
 
 #include "chrome/browser/ui/views/side_panel/extensions/extension_side_panel_manager.h"
 
+#include "base/logging.h"
 #include "base/memory/scoped_refptr.h"
 #include "base/strings/utf_string_conversions.h"
+#include "components/vector_icons/vector_icons.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
+#include "chrome/browser/browseros/core/browseros_prefs.h"
 #include "chrome/browser/profiles/profile.h"
 #include "chrome/browser/ui/actions/chrome_action_id.h"
 #include "chrome/browser/ui/actions/chrome_actions.h"
@@ -15,14 +19,17 @@
 #include "chrome/browser/ui/browser_window/public/browser_window_features.h"
 #include "chrome/browser/ui/side_panel/side_panel_action_callback.h"
 #include "chrome/browser/ui/side_panel/side_panel_registry.h"
+#include "chrome/browser/ui/toolbar/pinned_toolbar/pinned_toolbar_actions_model.h"
 #include "chrome/browser/ui/ui_features.h"
 #include "chrome/browser/ui/views/frame/browser_view.h"
 #include "chrome/browser/ui/views/side_panel/side_panel_coordinator.h"
 #include "content/public/browser/browser_context.h"
 #include "content/public/browser/web_contents.h"
+#include "extensions/browser/unloaded_extension_reason.h"
 #include "extensions/common/extension.h"
 #include "extensions/common/extension_features.h"
 #include "extensions/common/permissions/api_permission.h"
+#include "ui/base/models/image_model.h"
 #include "extensions/common/permissions/permissions_data.h"
 #include "third_party/abseil-cpp/absl/memory/memory.h"
 #include "ui/actions/actions.h"
@@ -120,8 +127,38 @@ void ExtensionSidePanelManager::MaybeCreateActionItemForExtension(
                        std::underlying_type_t<actions::ActionPinnableState>(
                            actions::ActionPinnableState::kPinnable))
           .Build());
+  // Use the Pane mark for BrowserOS extension side panel headers and toolbar.
+  if (browseros::IsBrowserOSExtension(extension->id())) {
+    if (actions::ActionItem* action_item =
+            actions::ActionManager::Get().FindAction(
+                extension_action_id, root_action_item)) {
+      action_item->SetImage(ui::ImageModel::FromVectorIcon(
+          vector_icons::kPaneMarkIcon, ui::kColorIcon, 16));
+      if (extension->id() == browseros::kAgentExtensionId) {
+        action_item->SetText(u"Pane");
+      }
+    }
+  }
+
+  // Auto-pin other bundled BrowserOS extensions (not the agent).
+  if (browseros::ShouldPinBrowserOSExtension(extension->id(),
+                                             profile_->GetPrefs())) {
+    DVLOG(1) << "browseros: Auto-pinning BrowserOS extension: "
+             << extension->id();
+    if (auto* pinned_model = PinnedToolbarActionsModel::Get(profile_)) {
+      pinned_model->UpdatePinnedState(extension_action_id, true);
+    }
+  } else if (extension->id() == browseros::kAgentExtensionId) {
+    // The agent side panel is toggled via the native toolbar button. Ensure
+    // the extension action is not pinned for users upgrading from older builds.
+    if (auto* pinned_model = PinnedToolbarActionsModel::Get(profile_)) {
+      pinned_model->UpdatePinnedState(extension_action_id, false);
+    }
+  }
+
 }
 
+
 actions::ActionId ExtensionSidePanelManager::GetOrCreateActionIdForExtension(
     const Extension* extension) {
   return actions::ActionIdMap::CreateActionId(
