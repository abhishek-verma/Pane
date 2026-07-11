diff --git a/chrome/browser/ui/browser_unittest.cc b/chrome/browser/ui/browser_unittest.cc
index ccec5fda90..998d966d0a 100644
--- a/chrome/browser/ui/browser_unittest.cc
+++ b/chrome/browser/ui/browser_unittest.cc
@@ -265,6 +265,23 @@ TEST_F(BrowserUnitTest, CreateBrowserWithIncognitoModeEnabled) {
   EXPECT_TRUE(otr_browser);
 }
 
+TEST_F(BrowserUnitTest, IsHiddenReflectsCreateParams) {
+  Browser::CreateParams params(profile(), /*user_gesture=*/true);
+  params.hidden = true;
+  std::unique_ptr<BrowserWindow> hidden_window(CreateBrowserWindow());
+  params.window = hidden_window.release();
+  std::unique_ptr<Browser> browser =
+      Browser::DeprecatedCreateOwnedForTesting(params);
+  EXPECT_TRUE(browser->is_hidden());
+
+  Browser::CreateParams visible_params(profile(), /*user_gesture=*/true);
+  std::unique_ptr<BrowserWindow> visible_window(CreateBrowserWindow());
+  visible_params.window = visible_window.release();
+  std::unique_ptr<Browser> visible =
+      Browser::DeprecatedCreateOwnedForTesting(visible_params);
+  EXPECT_FALSE(visible->is_hidden());
+}
+
 #if BUILDFLAG(IS_CHROMEOS)
 TEST_F(BrowserUnitTest, CreateBrowserDuringKioskSplashScreen) {
   // Setting up user manager state to be in kiosk mode:
