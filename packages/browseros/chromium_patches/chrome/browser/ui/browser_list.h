diff --git a/chrome/browser/ui/browser_list.h b/chrome/browser/ui/browser_list.h
index 52cf009c56..2c1affc7aa 100644
--- a/chrome/browser/ui/browser_list.h
+++ b/chrome/browser/ui/browser_list.h
@@ -26,6 +26,12 @@ class Browser;
 class BrowserWindowInterface;
 class BrowserListObserver;
 
+// True if `browser` should appear in user-facing UI enumerations (tab search,
+// window menus, drag-drop candidates, extensions API, etc.). Returns false for
+// hidden Browsers — agent-owned workspaces that exist in BrowserList but are
+// not part of the user's visible windowing experience.
+bool ShouldShowBrowserInUserInterface(const Browser* browser);
+
 // Maintains a list of Browser objects.
 class BrowserList {
  public:
@@ -38,6 +44,11 @@ class BrowserList {
 
   static BrowserList* GetInstance();
 
+  // Returns the BrowserList filtered to user-visible Browsers (see
+  // ShouldShowBrowserInUserInterface). Use this — instead of GetInstance() —
+  // at UI enumeration sites so hidden agent workspaces are excluded.
+  static BrowserVector GetUserVisibleBrowsers();
+
   // Adds or removes |browser| from the list it is associated with. The browser
   // object should be valid BEFORE these calls (for the benefit of observers),
   // so notify and THEN delete the object.
