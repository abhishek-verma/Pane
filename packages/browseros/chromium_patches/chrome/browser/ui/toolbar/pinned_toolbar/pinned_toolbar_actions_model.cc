diff --git a/chrome/browser/ui/toolbar/pinned_toolbar/pinned_toolbar_actions_model.cc b/chrome/browser/ui/toolbar/pinned_toolbar/pinned_toolbar_actions_model.cc
index 0177d0e3bda7c..dbdd029d1ffb4 100644
--- a/chrome/browser/ui/toolbar/pinned_toolbar/pinned_toolbar_actions_model.cc
+++ b/chrome/browser/ui/toolbar/pinned_toolbar/pinned_toolbar_actions_model.cc
@@ -16,6 +16,8 @@
 #include "base/observer_list.h"
 #include "base/strings/strcat.h"
 #include "base/values.h"
+#include "chrome/browser/browseros/core/browseros_action_utils.h"
+#include "chrome/browser/browseros/core/browseros_prefs.h"
 #include "chrome/browser/profiles/profile.h"
 #include "chrome/browser/ui/actions/chrome_action_id.h"
 #include "chrome/browser/ui/tab_search_feature.h"
@@ -37,6 +39,24 @@ PinnedToolbarActionsModel::PinnedToolbarActionsModel(Profile* profile)
       base::BindRepeating(&PinnedToolbarActionsModel::UpdatePinnedActionIds,
                           base::Unretained(this)));
 
+  // Observe BrowserOS visibility prefs for reactive updates.
+  pref_change_registrar_.Add(
+      browseros::prefs::kShowAssistant,
+      base::BindRepeating(
+          &PinnedToolbarActionsModel::OnBrowserOSVisibilityPrefChanged,
+          base::Unretained(this)));
+  pref_change_registrar_.Add(
+      browseros::prefs::kShowToolbarLabels,
+      base::BindRepeating(
+          &PinnedToolbarActionsModel::OnBrowserOSLabelsPrefChanged,
+          base::Unretained(this)));
+
   // Initialize the model with the current state of the kPinnedActions pref.
   UpdatePinnedActionIds();
+  EnsureAlwaysPinnedActions();
 }
@@ -239,8 +258,11 @@ void PinnedToolbarActionsModel::MaybeMigrateExistingPinnedStates() {
   if (!CanUpdate()) {
     return;
   }
+  // Chrome Labs is no longer automatically pinned for new profiles
+  // We keep this migration complete check to not affect users who already have
+  // it
   if (!pref_service_->GetBoolean(prefs::kPinnedChromeLabsMigrationComplete)) {
-    UpdatePinnedState(kActionShowChromeLabs, true);
+    // UpdatePinnedState(kActionShowChromeLabs, true);  // No longer auto-pin
     pref_service_->SetBoolean(prefs::kPinnedChromeLabsMigrationComplete, true);
   }
   if (features::HasTabSearchToolbarButton() &&
@@ -256,6 +278,36 @@ void PinnedToolbarActionsModel::MaybeMigrateExistingPinnedStates() {
   }
 }
 
+void PinnedToolbarActionsModel::EnsureAlwaysPinnedActions() {
+  // Only update if we're allowed to (not incognito/guest profiles).
+  if (!CanUpdate()) {
+    return;
+  }
+
+  // Pin native BrowserOS actions when their visibility pref allows it.
+  for (actions::ActionId id : browseros::kBrowserOSNativeActionIds) {
+    bool pref_enabled = browseros::ShouldShowToolbarAction(id, pref_service_);
+
+    if (pref_enabled) {
+      // Should be pinned - add if not already present
+      if (!Contains(id)) {
+        UpdatePinnedState(id, true);
+      }
+    } else {
+      // Should not be pinned - remove if currently pinned
+      if (Contains(id)) {
+        UpdatePinnedState(id, false);
+      }
+    }
+  }
+
+  // Note: Extension pinning is handled by ExtensionSidePanelManager
+}
+
 const std::vector<actions::ActionId>&
 PinnedToolbarActionsModel::PinnedActionIds() const {
   return pinned_action_ids_;
@@ -274,3 +326,20 @@ void PinnedToolbarActionsModel::UpdatePref(
     list_of_values.Append(id_string.value());
   }
 }
+
+void PinnedToolbarActionsModel::OnBrowserOSVisibilityPrefChanged() {
+  // Re-evaluate which BrowserOS actions should be pinned.
+  EnsureAlwaysPinnedActions();
+
+  // Notify observers that actions may have changed.
+  for (Observer& observer : observers_) {
+    observer.OnActionsChanged();
+  }
+}
+
+void PinnedToolbarActionsModel::OnBrowserOSLabelsPrefChanged() {
+  // Notify observers so buttons can refresh their labels.
+  for (Observer& observer : observers_) {
+    observer.OnLabelsVisibilityChanged();
+  }
+}
