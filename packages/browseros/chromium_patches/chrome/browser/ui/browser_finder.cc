diff --git a/chrome/browser/ui/browser_finder.cc b/chrome/browser/ui/browser_finder.cc
index 9caa555fd7..0c3ecb1302 100644
--- a/chrome/browser/ui/browser_finder.cc
+++ b/chrome/browser/ui/browser_finder.cc
@@ -154,6 +154,12 @@ bool BrowserMatches(BrowserWindowInterface* browser,
     return false;
   }
 
+  // Hidden Browsers are agent-owned scratch space; never pick them as a
+  // default target for user-initiated actions (new tabs, find-any, etc.).
+  if (browser->GetBrowserForMigrationOnly()->is_hidden()) {
+    return false;
+  }
+
   return true;
 }
 
