diff --git a/chrome/browser/ui/startup/startup_browser_creator.cc b/chrome/browser/ui/startup/startup_browser_creator.cc
index 597bd5bfdc..9f4392215e 100644
--- a/chrome/browser/ui/startup/startup_browser_creator.cc
+++ b/chrome/browser/ui/startup/startup_browser_creator.cc
@@ -39,6 +39,8 @@
 #include "chrome/browser/apps/app_service/app_service_proxy_factory.h"
 #include "chrome/browser/apps/platform_apps/app_load_service.h"
 #include "chrome/browser/apps/platform_apps/platform_app_launch.h"
+#include "chrome/browser/browseros/onboarding/browseros_onboarding_prefs.h"
+#include "chrome/browser/browseros/onboarding/launch_after_agent_ready.h"
 #include "chrome/browser/browser_features.h"
 #include "chrome/browser/browser_process.h"
 #include "chrome/browser/extensions/startup_helper.h"
@@ -474,6 +476,37 @@ void OpenNewWindowForFirstRun(const base::CommandLine& command_line,
 }
 #endif  // BUILDFLAG(ENABLE_DICE_SUPPORT)
 
+#if !BUILDFLAG(IS_CHROMEOS)
+void OpenNewWindowForBrowserOSOnboarding(
+    const base::CommandLine& command_line,
+    Profile* profile,
+    const base::FilePath& cur_dir,
+    const std::vector<GURL>& first_run_urls,
+    chrome::startup::IsProcessStartup process_startup,
+    chrome::startup::IsFirstRun is_first_run,
+    ProfilePicker::FirstRunExitStatus status) {
+  if (status != ProfilePicker::FirstRunExitStatus::kCompleted) {
+    return;
+  }
+
+  browseros::onboarding::LaunchBrowserAfterAgentReady(
+      profile, first_run_urls,
+      base::BindOnce(
+          [](base::CommandLine command_line, Profile* profile,
+             base::FilePath cur_dir,
+             chrome::startup::IsProcessStartup process_startup,
+             chrome::startup::IsFirstRun is_first_run,
+             std::vector<GURL> urls) {
+            StartupBrowserCreator browser_creator;
+            browser_creator.AddFirstRunTabs(urls);
+            browser_creator.LaunchBrowser(
+                command_line, profile, cur_dir, process_startup, is_first_run,
+                /*restore_tabbed_browser=*/true);
+          },
+          command_line, profile, cur_dir, process_startup, is_first_run));
+}
+#endif  // !BUILDFLAG(IS_CHROMEOS)
+
 #if BUILDFLAG(IS_CHROMEOS)
 // Returns the app id of the kiosk app associated with the current user session.
 // Returns nullopt for non-kiosk user sessions and for ARCVM kiosk sessions,
@@ -712,6 +745,18 @@ void StartupBrowserCreator::LaunchBrowser(
       command_line, {profile, StartupProfileMode::kBrowserWindow});
 
   if (!IsSilentLaunchEnabled(command_line, profile)) {
+#if !BUILDFLAG(IS_CHROMEOS)
+    if (!command_line.HasSwitch(switches::kNoFirstRun) &&
+        browseros::onboarding::ShouldShow(profile)) {
+      ProfilePicker::Show(ProfilePicker::Params::ForFirstRun(
+          profile->GetPath(),
+          base::BindOnce(&OpenNewWindowForBrowserOSOnboarding, command_line,
+                         profile, cur_dir, first_run_tabs_, process_startup,
+                         is_first_run)));
+      return;
+    }
+#endif  // !BUILDFLAG(IS_CHROMEOS)
+
 #if BUILDFLAG(ENABLE_DICE_SUPPORT)
     auto* fre_service = FirstRunServiceFactory::GetForBrowserContext(profile);
     if (fre_service && fre_service->ShouldOpenFirstRun()) {
