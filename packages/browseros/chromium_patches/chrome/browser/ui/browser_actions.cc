diff --git a/chrome/browser/ui/browser_actions.cc b/chrome/browser/ui/browser_actions.cc
index 8a43e7c2fc..5797a0de12 100644
--- a/chrome/browser/ui/browser_actions.cc
+++ b/chrome/browser/ui/browser_actions.cc
@@ -17,6 +17,7 @@
 #include "base/metrics/user_metrics_action.h"
 #include "build/branding_buildflags.h"
 #include "chrome/app/chrome_command_ids.h"
+#include "chrome/grit/theme_resources.h"
 #include "chrome/app/vector_icons/vector_icons.h"
 #include "chrome/browser/contextual_tasks/contextual_tasks_side_panel_coordinator.h"
 #include "chrome/browser/devtools/devtools_window.h"
@@ -31,7 +32,14 @@
 #include "chrome/browser/sharing_hub/sharing_hub_features.h"
 #include "chrome/browser/ui/actions/chrome_action_id.h"
 #include "chrome/browser/ui/actions/chrome_actions.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
+#include "chrome/browser/extensions/api/side_panel/side_panel_service.h"
+#include "chrome/browser/extensions/extension_tab_util.h"
+#include "chrome/browser/infobars/simple_alert_infobar_creator.h"
 #include "chrome/browser/ui/ai_overlay_dialog/ai_overlay_dialog_controller.h"
+#include "chrome/browser/ui/extensions/extension_side_panel_utils.h"
+#include "components/infobars/content/content_infobar_manager.h"
+#include "extensions/browser/extension_registry.h"
 #include "chrome/browser/ui/autofill/address_bubbles_icon_controller.h"
 #include "chrome/browser/ui/autofill/autofill_bubble_base.h"
 #include "chrome/browser/ui/autofill/payments/filled_card_information_bubble_controller_impl.h"
@@ -310,6 +318,79 @@ void BrowserActions::InitializeSidePanelActions() {
             .Build());
   }
 
+  // BrowserOS Agent - toggles contextual side panel on active tab.
+  root_action_item_->AddChild(
+      actions::ActionItem::Builder(
+          base::BindRepeating(
+              [](BrowserWindowInterface* bwi, actions::ActionItem* item,
+                 actions::ActionInvocationContext context) {
+                auto* tab = bwi->GetActiveTabInterface();
+                if (!tab || !tab->GetContents()) {
+                  LOG(WARNING) << "browseros: No active tab for Agent action";
+                  return;
+                }
+                content::WebContents* contents = tab->GetContents();
+                Profile* profile =
+                    Profile::FromBrowserContext(contents->GetBrowserContext());
+                const extensions::Extension* extension =
+                    extensions::ExtensionRegistry::Get(profile)
+                        ->enabled_extensions()
+                        .GetByID(browseros::kAgentExtensionId);
+                if (!extension) {
+                  LOG(WARNING) << "browseros: Agent extension not found";
+                  infobars::ContentInfoBarManager* infobar_manager =
+                      infobars::ContentInfoBarManager::FromWebContents(contents);
+                  if (infobar_manager) {
+                    CreateSimpleAlertInfoBar(
+                        infobar_manager,
+                        infobars::InfoBarDelegate::
+                            BROWSEROS_AGENT_INSTALLING_INFOBAR_DELEGATE,
+                        nullptr,
+                        u"Pane Agent is installing/updating. Please try again shortly.",
+                        /*auto_expire=*/true,
+                        /*should_animate=*/true,
+                        /*closeable=*/true);
+                  }
+                  return;
+                }
+                int tab_id = extensions::ExtensionTabUtil::GetTabId(contents);
+                extensions::SidePanelService* service =
+                    extensions::SidePanelService::Get(profile);
+                if (!service) {
+                  LOG(WARNING) << "browseros: SidePanelService not found";
+                  return;
+                }
+                auto result = service->BrowserosToggleSidePanelForTab(
+                    *extension, profile, tab_id,
+                    /*include_incognito_information=*/true,
+                    /*desired_state=*/std::nullopt);
+                if (!result.has_value()) {
+                  LOG(WARNING) << "browseros: Agent toggle failed: "
+                               << result.error();
+                }
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
