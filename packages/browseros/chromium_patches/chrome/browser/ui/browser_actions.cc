diff --git a/chrome/browser/ui/browser_actions.cc b/chrome/browser/ui/browser_actions.cc
--- a/chrome/browser/ui/browser_actions.cc
+++ b/chrome/browser/ui/browser_actions.cc
@@ -17,6 +17,14 @@
 #include "base/metrics/user_metrics_action.h"
 #include "build/branding_buildflags.h"
 #include "chrome/app/chrome_command_ids.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
+#include "chrome/browser/extensions/extension_view_host.h"
+#include "chrome/browser/extensions/extension_view_host_factory.h"
+#include "chrome/browser/ui/views/extensions/extension_popup.h"
+#include "chrome/browser/ui/views/toolbar/pinned_toolbar_actions.h"
+#include "extensions/browser/extension_registry.h"
+#include "extensions/common/extension.h"
+#include "chrome/grit/theme_resources.h"
 #include "chrome/app/vector_icons/vector_icons.h"
 #include "chrome/browser/contextual_tasks/contextual_tasks_side_panel_coordinator.h"
 #include "chrome/browser/devtools/devtools_window.h"
@@ -32,6 +40,8 @@
 #include "chrome/browser/ui/actions/chrome_action_id.h"
 #include "chrome/browser/ui/actions/chrome_actions.h"
 #include "chrome/browser/ui/ai_overlay_dialog/ai_overlay_dialog_controller.h"
+#include "chrome/browser/ui/extensions/extension_side_panel_utils.h"
+#include "chrome/browser/ui/side_panel/side_panel_action_callback.h"
 #include "chrome/browser/ui/autofill/address_bubbles_icon_controller.h"
 #include "chrome/browser/ui/autofill/autofill_bubble_base.h"
 #include "chrome/browser/ui/autofill/payments/filled_card_information_bubble_controller_impl.h"
@@ -310,6 +320,66 @@
             .Build());
   }
 
+
+  // Layers has an independent native control; opening it does not change
+  // the assistant sidebar or the website's extension-action popup.
+  root_action_item_->AddChild(
+      actions::ActionItem::Builder(base::BindRepeating(
+          [](BrowserWindowInterface* window, actions::ActionItem*,
+             actions::ActionInvocationContext) {
+            Profile* profile = window->GetProfile();
+            if (profile->IsOffTheRecord())
+              return;
+            const auto* extension = extensions::ExtensionRegistry::Get(profile)
+                                        ->enabled_extensions()
+                                        .GetByID(browseros::kAgentExtensionId);
+            if (!extension)
+              return;
+            auto* browser = window->GetBrowserForMigrationOnly();
+            auto* provider = browser->GetBrowserView().toolbar_button_provider();
+            if (!provider || !provider->GetPinnedToolbarActions())
+              return;
+            auto host = extensions::ExtensionViewHostFactory::CreatePopupHost(
+                *extension, extension->GetResourceURL("layers.html"), window);
+            if (!host)
+              return;
+            ExtensionPopup::ShowPopup(
+                browser, std::move(host),
+                provider->GetPinnedToolbarActions()->GetBubbleAnchor(kActionPaneLayers),
+                views::BubbleBorder::TOP_RIGHT, PopupShowAction::kShow, {});
+          }, bwi))
+          .SetActionId(kActionPaneLayers)
+          .SetText(u"Layers")
+          .SetTooltipText(u"Layers for this site")
+          .SetImage(ui::ImageModel::FromVectorIcon(kTabGroupIcon, ui::kColorIcon, 16))
+          .SetProperty(actions::kActionItemPinnableKey,
+                       std::underlying_type_t<actions::ActionPinnableState>(
+                           actions::ActionPinnableState::kEnterpriseControlled))
+          .Build());
+
+  // BrowserOS Agent - dispatches a real action.onClicked event so
+  // toggleSidePanel.ts's scope-aware logic (per-tab vs. shared per-window)
+  // is the single implementation of side panel open/close behavior, instead
+  // of native code deciding panel scope itself. See
+  // side_panel_action_callback.h for DispatchAgentSidePanelToggleClick.
+  root_action_item_->AddChild(
+      actions::ActionItem::Builder(
+          base::BindRepeating(
+              [](BrowserWindowInterface* bwi, actions::ActionItem* item,
+                 actions::ActionInvocationContext context) {
+                DispatchAgentSidePanelToggleClick(bwi);
+              },
+              bwi))
+          .SetActionId(kActionBrowserOSAgent)
+          .SetText(u"Pane")
+          .SetTooltipText(u"Ask Pane")
+          .SetImage(ui::ImageModel::FromVectorIcon(
+              vector_icons::kPaneMarkIcon, ui::kColorIcon, 16))
+          .SetProperty(actions::kActionItemPinnableKey,
+                       std::underlying_type_t<actions::ActionPinnableState>(
+                           actions::ActionPinnableState::kEnterpriseControlled))
+          .Build());
+
   if (HistorySidePanelCoordinator::IsSupported()) {
     root_action_item_->AddChild(
         SidePanelAction(SidePanelEntryId::kHistory, IDS_HISTORY_TITLE,
