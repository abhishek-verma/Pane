diff --git a/chrome/browser/resources/settings/about_page/about_page.ts b/chrome/browser/resources/settings/about_page/about_page.ts
index aa3f435d83..a118fba7c4 100644
--- a/chrome/browser/resources/settings/about_page/about_page.ts
+++ b/chrome/browser/resources/settings/about_page/about_page.ts
@@ -215,7 +215,7 @@ export class SettingsAboutPageElement extends SettingsAboutPageElementBase
   }
 
   private onHelpClick_() {
-    this.aboutBrowserProxy_.openHelpPage();
+    window.open('https://github.com/abhishek-verma/Pane');
   }
 
   private onRelaunchClick_() {
