diff --git a/chrome/browser/profiles/profile_io_data.cc b/chrome/browser/profiles/profile_io_data.cc
index 080e9b0e43c70913f84490ccafb068ab1e9fbc62..18bdb22682a48e788ab68ce4ede1c1cb9d970084 100644
--- a/chrome/browser/profiles/profile_io_data.cc
+++ b/chrome/browser/profiles/profile_io_data.cc
@@ -45,6 +45,7 @@ bool ProfileIOData::IsHandledProtocol(std::string_view scheme) {
 #endif
       content::kChromeUIScheme,
       content::kChromeUIUntrustedScheme,
+      chrome::kPiScheme,
       url::kDataScheme,
 #if BUILDFLAG(IS_CHROMEOS)
       content::kExternalFileScheme,
