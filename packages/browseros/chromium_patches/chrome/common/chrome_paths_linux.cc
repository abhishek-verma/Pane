diff --git a/chrome/common/chrome_paths_linux.cc b/chrome/common/chrome_paths_linux.cc
index 5575c049b2..98ed6e4e8f 100644
--- a/chrome/common/chrome_paths_linux.cc
+++ b/chrome/common/chrome_paths_linux.cc
@@ -95,7 +95,7 @@ bool GetDefaultUserDataDirectory(base::FilePath* result) {
 #elif BUILDFLAG(GOOGLE_CHROME_BRANDING)
   std::string data_dir_basename = "google-chrome";
 #else
-  std::string data_dir_basename = "chromium";
+  std::string data_dir_basename = "browser-os";
 #endif
   *result = config_dir.Append(data_dir_basename + GetChannelSuffixForDataDir());
   return true;
