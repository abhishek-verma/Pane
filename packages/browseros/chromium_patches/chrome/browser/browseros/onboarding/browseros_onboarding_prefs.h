diff --git a/chrome/browser/browseros/onboarding/browseros_onboarding_prefs.h b/chrome/browser/browseros/onboarding/browseros_onboarding_prefs.h
new file mode 100644
index 0000000000..fc0d5b3bfc
--- /dev/null
+++ b/chrome/browser/browseros/onboarding/browseros_onboarding_prefs.h
@@ -0,0 +1,20 @@
+// Copyright 2026 The Chromium Authors
+// Use of this source code is governed by a BSD-style license that can be
+// found in the LICENSE file.
+
+#ifndef CHROME_BROWSER_BROWSEROS_ONBOARDING_BROWSEROS_ONBOARDING_PREFS_H_
+#define CHROME_BROWSER_BROWSEROS_ONBOARDING_BROWSEROS_ONBOARDING_PREFS_H_
+
+class Profile;
+
+namespace browseros::onboarding {
+
+// Returns whether BrowserOS onboarding should interrupt startup for `profile`.
+bool ShouldShow(Profile* profile);
+
+// Marks the BrowserOS onboarding popup complete for `profile`.
+void MarkCompleted(Profile* profile);
+
+}  // namespace browseros::onboarding
+
+#endif  // CHROME_BROWSER_BROWSEROS_ONBOARDING_BROWSEROS_ONBOARDING_PREFS_H_
