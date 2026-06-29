diff --git a/components/os_crypt/common/keychain_password_mac.mm b/components/os_crypt/common/keychain_password_mac.mm
index f240dc22ee391..9d2da65a7198c 100644
--- a/components/os_crypt/common/keychain_password_mac.mm
+++ b/components/os_crypt/common/keychain_password_mac.mm
@@ -38,8 +38,9 @@
 const char kDefaultServiceName[] = "Chrome Safe Storage";
 const char kDefaultAccountName[] = "Chrome";
 #else
-const char kDefaultServiceName[] = "Chromium Safe Storage";
-const char kDefaultAccountName[] = "Chromium";
+// BrowserOS: custom keychain service name
+const char kDefaultServiceName[] = "Pane Safe Storage";
+const char kDefaultAccountName[] = "Pane";
 #endif
 
 // These values are persisted to logs. Entries should not be renumbered and
