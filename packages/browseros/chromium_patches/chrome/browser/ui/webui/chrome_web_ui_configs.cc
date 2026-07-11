diff --git a/chrome/browser/ui/webui/chrome_web_ui_configs.cc b/chrome/browser/ui/webui/chrome_web_ui_configs.cc
index 30dddd61a2..c6a0798f68 100644
--- a/chrome/browser/ui/webui/chrome_web_ui_configs.cc
+++ b/chrome/browser/ui/webui/chrome_web_ui_configs.cc
@@ -7,6 +7,7 @@
 #include "build/android_buildflags.h"
 #include "build/branding_buildflags.h"
 #include "build/build_config.h"
+#include "chrome/browser/browseros/onboarding/browseros_onboarding.h"
 #include "chrome/browser/contextual_tasks/contextual_tasks_ui.h"
 #include "chrome/browser/glic/host/glic_ui.h"
 #include "chrome/browser/optimization_guide/optimization_guide_internals_ui.h"
@@ -16,6 +17,7 @@
 #include "chrome/browser/ui/webui/autofill_and_password_manager_internals/autofill_internals_ui.h"
 #include "chrome/browser/ui/webui/autofill_and_password_manager_internals/password_manager_internals_ui.h"
 #include "chrome/browser/ui/webui/bluetooth_internals/bluetooth_internals_ui.h"  // nogncheck
+#include "chrome/browser/ui/webui/browseros_welcome.h"
 #include "chrome/browser/ui/webui/browsing_topics/browsing_topics_internals_ui.h"
 #include "chrome/browser/ui/webui/chrome_finds_internals/chrome_finds_internals_ui.h"
 #include "chrome/browser/ui/webui/chrome_urls/chrome_urls_ui.h"
@@ -290,6 +292,8 @@ void RegisterChromeWebUIConfigs() {
   map.AddWebUIConfig(std::make_unique<SiteEngagementUIConfig>());
   map.AddWebUIConfig(std::make_unique<SyncInternalsUIConfig>());
   map.AddWebUIConfig(std::make_unique<TranslateInternalsUIConfig>());
+  map.AddWebUIConfig(std::make_unique<BrowserOSOnboardingUIConfig>());
+  map.AddWebUIConfig(std::make_unique<BrowserOSWelcomeUIConfig>());
   map.AddWebUIConfig(std::make_unique<UsbInternalsUIConfig>());
   map.AddWebUIConfig(std::make_unique<user_actions_ui::UserActionsUIConfig>());
   map.AddWebUIConfig(std::make_unique<VersionUIConfig>());
