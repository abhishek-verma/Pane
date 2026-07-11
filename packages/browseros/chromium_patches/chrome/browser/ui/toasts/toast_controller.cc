diff --git a/chrome/browser/ui/toasts/toast_controller.cc b/chrome/browser/ui/toasts/toast_controller.cc
index 1b41d0c895..459f1ac097 100644
--- a/chrome/browser/ui/toasts/toast_controller.cc
+++ b/chrome/browser/ui/toasts/toast_controller.cc
@@ -268,8 +268,8 @@ void ToastController::ShowToast(ToastParams params) {
   const bool is_actionable =
       current_toast_spec->action_button_string_id().has_value() ||
       current_toast_spec->has_menu();
-  base::TimeDelta timeout =
-      is_actionable ? kToastWithActionTimeout : kToastDefaultTimeout;
+  base::TimeDelta timeout = params.timeout_override.value_or(
+      is_actionable ? kToastWithActionTimeout : kToastDefaultTimeout);
 
   toast_close_timer_.Start(
       FROM_HERE, timeout,
