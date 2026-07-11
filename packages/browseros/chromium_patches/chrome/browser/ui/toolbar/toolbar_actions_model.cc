diff --git a/chrome/browser/ui/toolbar/toolbar_actions_model.cc b/chrome/browser/ui/toolbar/toolbar_actions_model.cc
index d4f8091fff..81ff748379 100644
--- a/chrome/browser/ui/toolbar/toolbar_actions_model.cc
+++ b/chrome/browser/ui/toolbar/toolbar_actions_model.cc
@@ -18,6 +18,8 @@
 #include "base/one_shot_event.h"
 #include "base/strings/utf_string_conversions.h"
 #include "base/task/single_thread_task_runner.h"
+#include "chrome/browser/browseros/core/browseros_prefs.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
 #include "chrome/browser/extensions/extension_management.h"
 #include "chrome/browser/extensions/extension_tab_util.h"
 #include "chrome/browser/extensions/managed_toolbar_pin_mode.h"
@@ -66,6 +68,10 @@ ToolbarActionsModel::ToolbarActionsModel(
       extensions::pref_names::kPinnedExtensions,
       base::BindRepeating(&ToolbarActionsModel::UpdatePinnedActionIds,
                           base::Unretained(this)));
+  pref_change_registrar_.Add(
+      browseros::prefs::kShowAssistant,
+      base::BindRepeating(&ToolbarActionsModel::UpdatePinnedActionIds,
+                          base::Unretained(this)));
 }
 
 ToolbarActionsModel::~ToolbarActionsModel() = default;
@@ -260,6 +266,10 @@ void ToolbarActionsModel::OnReady() {
 
 bool ToolbarActionsModel::ShouldAddExtension(
     const extensions::Extension* extension) {
+  if (!browseros::ShouldExposeExtensionInToolbar(extension->id())) {
+    return false;
+  }
+
   // In incognito mode, don't add any extensions that aren't incognito-enabled.
   if (profile_->IsOffTheRecord() &&
       !extensions::util::IsIncognitoEnabled(extension->id(), profile_)) {
