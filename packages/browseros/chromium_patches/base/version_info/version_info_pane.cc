diff --git a/base/version_info/version_info_pane.cc b/base/version_info/version_info_pane.cc
new file mode 100644
index 0000000000000..1111111111111
--- /dev/null
+++ b/base/version_info/version_info_pane.cc
@@ -0,0 +1,84 @@
+// Copyright 2026 Pane. All rights reserved.
+// SPDX-License-Identifier: AGPL-3.0-or-later
+
+#include "base/version_info/version_info.h"
+
+#include "base/files/file_path.h"
+#include "base/files/file_util.h"
+#include "base/no_destructor.h"
+#include "base/path_service.h"
+#include "base/strings/string_util.h"
+#include "build/build_config.h"
+
+namespace {
+
+// Parses a PANE_VERSION file whose lines are of the form KEY=VALUE.
+// Returns the assembled version string "MAJOR.MINOR.BUILD.PATCH" or an empty
+// string if parsing fails.
+std::string ParsePaneVersionFile(const std::string& contents) {
+  std::string major_v, minor_v, build_v, patch_v;
+  for (const auto& line :
+       base::SplitString(contents, "\n", base::TRIM_WHITESPACE,
+                         base::SPLIT_WANT_NONEMPTY)) {
+    if (base::StartsWith(line, "BROWSEROS_MAJOR="))
+      major_v = line.substr(16);
+    else if (base::StartsWith(line, "BROWSEROS_MINOR="))
+      minor_v = line.substr(16);
+    else if (base::StartsWith(line, "BROWSEROS_BUILD="))
+      build_v = line.substr(16);
+    else if (base::StartsWith(line, "BROWSEROS_PATCH="))
+      patch_v = line.substr(16);
+  }
+  if (major_v.empty() || minor_v.empty() || build_v.empty() || patch_v.empty())
+    return std::string();
+  return major_v + "." + minor_v + "." + build_v + "." + patch_v;
+}
+
+// Resolves the path to the PANE_VERSION file bundled alongside the server
+// binary.  On macOS the layout is:
+//   Pane.app/Contents/MacOS/Pane           <- DIR_EXE
+//   Pane.app/Contents/Resources/BrowserOSServer/default/resources/PANE_VERSION
+base::FilePath GetPaneVersionFilePath() {
+  base::FilePath exe_dir;
+  if (!base::PathService::Get(base::DIR_EXE, &exe_dir))
+    return base::FilePath();
+
+#if BUILDFLAG(IS_MAC)
+  base::FilePath resources = exe_dir.DirName().Append("Resources");
+#elif BUILDFLAG(IS_WIN)
+  base::FilePath resources = exe_dir;
+#else
+  base::FilePath resources = exe_dir;
+#endif
+
+  return resources.Append(FILE_PATH_LITERAL("BrowserOSServer"))
+                  .Append(FILE_PATH_LITERAL("default"))
+                  .Append(FILE_PATH_LITERAL("resources"))
+                  .Append(FILE_PATH_LITERAL("PANE_VERSION"));
+}
+
+}  // namespace
+
+namespace version_info {
+
+std::string GetRuntimePaneVersion() {
+  // Cache the result — path services are stable after browser init.
+  static base::NoDestructor<std::string> cached([]() -> std::string {
+    base::FilePath version_file = GetPaneVersionFilePath();
+    if (version_file.empty())
+      return std::string(GetPaneVersionNumber());
+
+    std::string contents;
+    if (!base::ReadFileToString(version_file, &contents)) {
+      LOG(WARNING) << "pane: PANE_VERSION file not found at "
+                   << version_file.value()
+                   << " — falling back to compiled-in version "
+                   << GetPaneVersionNumber();
+      return std::string(GetPaneVersionNumber());
+    }
+
+    std::string version = ParsePaneVersionFile(contents);
+    if (version.empty()) {
+      LOG(WARNING) << "pane: Failed to parse PANE_VERSION file at "
+                   << version_file.value()
+                   << " — falling back to compiled-in version "
+                   << GetPaneVersionNumber();
+      return std::string(GetPaneVersionNumber());
+    }
+
+    return version;
+  }());
+  return *cached;
+}
+
+}  // namespace version_info
