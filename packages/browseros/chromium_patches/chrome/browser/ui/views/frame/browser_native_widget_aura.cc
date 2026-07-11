diff --git a/chrome/browser/ui/views/frame/browser_native_widget_aura.cc b/chrome/browser/ui/views/frame/browser_native_widget_aura.cc
index b4c409f8c0..5b77b13ca3 100644
--- a/chrome/browser/ui/views/frame/browser_native_widget_aura.cc
+++ b/chrome/browser/ui/views/frame/browser_native_widget_aura.cc
@@ -81,6 +81,9 @@ views::Widget::InitParams BrowserNativeWidgetAura::GetWidgetParams(
     views::Widget::InitParams::Ownership ownership) {
   views::Widget::InitParams params(ownership);
   params.native_widget = this;
+  if (browser_view_) {
+    params.headless = browser_view_->browser()->is_hidden();
+  }
   return params;
 }
 
