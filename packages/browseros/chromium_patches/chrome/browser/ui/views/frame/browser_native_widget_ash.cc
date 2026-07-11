diff --git a/chrome/browser/ui/views/frame/browser_native_widget_ash.cc b/chrome/browser/ui/views/frame/browser_native_widget_ash.cc
index e40416204f..0297c184a5 100644
--- a/chrome/browser/ui/views/frame/browser_native_widget_ash.cc
+++ b/chrome/browser/ui/views/frame/browser_native_widget_ash.cc
@@ -189,6 +189,7 @@ views::Widget::InitParams BrowserNativeWidgetAsh::GetWidgetParams(
   params.context = ash::Shell::GetPrimaryRootWindow();
 
   Browser* browser = browser_view_->browser();
+  params.headless = browser->is_hidden();
   const int32_t restore_id = browser->create_params().restore_id;
   params.init_properties_container.SetProperty(app_restore::kWindowIdKey,
                                                browser->session_id().id());
