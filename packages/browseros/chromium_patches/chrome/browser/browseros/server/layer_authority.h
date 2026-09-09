diff --git a/chrome/browser/browseros/server/layer_authority.h b/chrome/browser/browseros/server/layer_authority.h
new file mode 100644
--- /dev/null
+++ b/chrome/browser/browseros/server/layer_authority.h
@@ -0,0 +1,14 @@
+// Copyright 2026 The Chromium Authors
+// Use of this source code is governed by a BSD-style license.
+#ifndef CHROME_BROWSER_BROWSEROS_SERVER_LAYER_AUTHORITY_H_
+#define CHROME_BROWSER_BROWSEROS_SERVER_LAYER_AUTHORITY_H_
+#include <optional>
+#include <string>
+namespace browseros {
+inline constexpr char kLayerExtensionId[] = "biedncddmddkpapdplhcnkhhplnfgbif";
+// Called at launch only. Transfer the returned secret through inherited IPC.
+std::string RotateLayerLaunchSecret();
+void ClearLayerLaunchSecret();
+std::optional<std::string> MintLayerCredential(const std::string& profile_id);
+}  // namespace browseros
+#endif
