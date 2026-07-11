diff --git a/chrome/browser/ui/browser_list.cc b/chrome/browser/ui/browser_list.cc
index ca9007acd8..8117ede5ee 100644
--- a/chrome/browser/ui/browser_list.cc
+++ b/chrome/browser/ui/browser_list.cc
@@ -125,6 +125,21 @@ void BrowserList::RemoveObserver(BrowserListObserver* observer) {
   observers_.Get().RemoveObserver(observer);
 }
 
+bool ShouldShowBrowserInUserInterface(const Browser* browser) {
+  return browser && !browser->is_hidden();
+}
+
+// static
+BrowserList::BrowserVector BrowserList::GetUserVisibleBrowsers() {
+  BrowserVector result;
+  for (Browser* browser : GetInstance()->browsers_) {
+    if (ShouldShowBrowserInUserInterface(browser)) {
+      result.push_back(browser);
+    }
+  }
+  return result;
+}
+
 // static
 void BrowserList::SetLastActive(Browser* browser) {
   BrowserList* instance = GetInstance();
@@ -134,6 +149,12 @@ void BrowserList::SetLastActive(Browser* browser) {
   DCHECK(browser->window())
       << "SetLastActive called for a browser with no window set.";
 
+  // Hidden Browsers never become last-active — FindLastActive and
+  // default-new-tab resolution should always target user-visible windows.
+  if (browser->is_hidden()) {
+    return;
+  }
+
   base::RecordAction(UserMetricsAction("ActiveBrowserChanged"));
 
   RemoveBrowserFrom(browser, &instance->browsers_ordered_by_activation_);
