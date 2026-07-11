diff --git a/chrome/browser/devtools/chrome_devtools_manager_delegate.h b/chrome/browser/devtools/chrome_devtools_manager_delegate.h
index a37b46861f..af1e0e2602 100644
--- a/chrome/browser/devtools/chrome_devtools_manager_delegate.h
+++ b/chrome/browser/devtools/chrome_devtools_manager_delegate.h
@@ -73,6 +73,9 @@ class ChromeDevToolsManagerDelegate : public content::DevToolsManagerDelegate,
   std::string GetTargetTitle(content::WebContents* web_contents) override;
   std::optional<bool> ShouldReportAsTabTarget(
       content::WebContents* web_contents) override;
+  bool GetTargetTabId(content::WebContents* web_contents,
+                      int* tab_id,
+                      int* window_id) override;
 
   content::BrowserContext* CreateBrowserContext() override;
   void DisposeBrowserContext(content::BrowserContext*,
