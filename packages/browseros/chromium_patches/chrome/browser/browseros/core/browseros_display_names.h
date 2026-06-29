diff --git a/chrome/browser/browseros/core/browseros_display_names.h b/chrome/browser/browseros/core/browseros_display_names.h
new file mode 100644
index 0000000000000..1111111111111
--- /dev/null
+++ b/chrome/browser/browseros/core/browseros_display_names.h
@@ -0,0 +1,42 @@
+// Copyright 2026 The Chromium Authors
+// Use of this source code is governed by a BSD-style license that can be
+// found in the LICENSE file.
+
+#ifndef CHROME_BROWSER_BROWSEROS_CORE_BROWSEROS_DISPLAY_NAMES_H_
+#define CHROME_BROWSER_BROWSEROS_CORE_BROWSEROS_DISPLAY_NAMES_H_
+
+#include <string>
+
+#include "base/strings/utf_string_conversions.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
+
+namespace browseros {
+
+// User-facing extension names. Manifests may still say Assistant/BrowserOS
+// until CDN bundles are updated; native UI should always show Pane branding.
+inline std::u16string GetBrowserOSExtensionDisplayName(
+    const std::string& extension_id) {
+  if (extension_id == kAgentExtensionId) {
+    return u"Pane";
+  }
+  if (extension_id == kBugReporterExtensionId) {
+    return u"Pane Feedback";
+  }
+  if (extension_id == kBrowserClawExtensionId) {
+    return u"Pane Claw";
+  }
+  return std::u16string();
+}
+
+inline std::u16string GetBrowserOSExtensionDisplayNameOrFallback(
+    const std::string& extension_id,
+    const std::string& fallback_name) {
+  std::u16string display_name = GetBrowserOSExtensionDisplayName(extension_id);
+  if (!display_name.empty()) {
+    return display_name;
+  }
+  return base::UTF8ToUTF16(fallback_name);
+}
+
+}  // namespace browseros
+
+#endif  // CHROME_BROWSER_BROWSEROS_CORE_BROWSEROS_DISPLAY_NAMES_H_
