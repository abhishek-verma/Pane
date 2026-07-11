diff --git a/chrome/browser/sessions/session_service_base.cc b/chrome/browser/sessions/session_service_base.cc
index 05c5d94300..f0eeb34bf6 100644
--- a/chrome/browser/sessions/session_service_base.cc
+++ b/chrome/browser/sessions/session_service_base.cc
@@ -822,6 +822,11 @@ bool SessionServiceBase::ShouldTrackBrowser(
     return false;
   }
 
+  // Hidden Browsers are ephemeral agent workspaces; never persist them.
+  if (browser->GetBrowserForMigrationOnly()->is_hidden()) {
+    return false;
+  }
+
   // Never track app popup windows that do not have a trusted source (i.e.
   // popup windows spawned by an app). If this logic changes, be sure to also
   // change SessionRestoreImpl::CreateRestoredBrowser().
