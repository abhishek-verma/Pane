diff --git a/base/version_info/version_info.h b/base/version_info/version_info.h
index 1f54eef6f4b0a..ad12af4d982c2 100644
--- a/base/version_info/version_info.h
+++ b/base/version_info/version_info.h
@@ -30,6 +30,24 @@ constexpr std::string_view GetVersionNumber() {
   return PRODUCT_VERSION;
 }
 
+// Returns the Pane version number compiled into the binary, e.g. "0.47.0.46".
+// This reflects the version at the last full Chromium compile and does NOT
+// change across repackage releases.  Prefer GetRuntimePaneVersion() for any
+// user-visible display so that the correct installed version is shown.
+constexpr std::string_view GetPaneVersionNumber() {
+  return PANE_VERSION;
+}
+
+// Returns the Pane version read at runtime from the PANE_VERSION resource file
+// that is updated on every release (including repackages).  Falls back to the
+// compiled-in GetPaneVersionNumber() when the file is absent (e.g. in dev
+// builds).  The result is cached after the first call.
+//
+// NOTE: Must only be called from the browser process after the browser has
+// initialised its path services.  Do NOT call from constexpr contexts.
+std::string GetRuntimePaneVersion();
+
 // Returns the major component (aka the milestone) of the version as an int,
 // e.g. 6 when the version is "6.0.490.1".
 int GetMajorVersionNumberAsInt();
