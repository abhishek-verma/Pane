diff --git a/chrome/browser/ui/views/frame/browser_native_widget_mac.mm b/chrome/browser/ui/views/frame/browser_native_widget_mac.mm
index d6d2a757c2..abe157b257 100644
--- a/chrome/browser/ui/views/frame/browser_native_widget_mac.mm
+++ b/chrome/browser/ui/views/frame/browser_native_widget_mac.mm
@@ -568,6 +568,9 @@ - (NSTouchBar*)makeTouchBar {
     views::Widget::InitParams::Ownership ownership) {
   views::Widget::InitParams params(ownership);
   params.native_widget = this;
+  if (browser_view_) {
+    params.headless = browser_view_->browser()->is_hidden();
+  }
   return params;
 }
 
