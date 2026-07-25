diff --git a/chrome/browser/browseros/onboarding/launch_after_agent_ready.h b/chrome/browser/browseros/onboarding/launch_after_agent_ready.h
new file mode 100644
index 0000000000..a1b2c3d4e5
--- /dev/null
+++ b/chrome/browser/browseros/onboarding/launch_after_agent_ready.h
@@ -0,0 +1,34 @@
+// Copyright 2026 The Chromium Authors
+// Use of this source code is governed by a BSD-style license that can be
+// found in the LICENSE file.
+
+#ifndef CHROME_BROWSER_BROWSEROS_ONBOARDING_LAUNCH_AFTER_AGENT_READY_H_
+#define CHROME_BROWSER_BROWSEROS_ONBOARDING_LAUNCH_AFTER_AGENT_READY_H_
+
+#include <vector>
+
+#include "base/functional/callback.h"
+#include "url/gurl.h"
+
+class Profile;
+
+namespace browseros::onboarding {
+
+// After native BrowserOS onboarding completes, open the first browser window.
+//
+// If the Pane agent extension is already loaded, |launch| is invoked
+// immediately with the extension onboarding URL as the sole first-run tab.
+// Otherwise waits briefly for ExtensionRegistry::OnExtensionLoaded, then
+// invokes |launch| with that URL. On timeout (or if the onboarding URL cannot
+// be resolved), |launch| is invoked with |fallback_urls| unchanged — the
+// historical NTP/Home path.
+//
+// Does not block the UI thread. |launch| runs at most once.
+void LaunchBrowserAfterAgentReady(
+    Profile* profile,
+    std::vector<GURL> fallback_urls,
+    base::OnceCallback<void(std::vector<GURL> first_run_urls)> launch);
+
+}  // namespace browseros::onboarding
+
+#endif  // CHROME_BROWSER_BROWSEROS_ONBOARDING_LAUNCH_AFTER_AGENT_READY_H_
