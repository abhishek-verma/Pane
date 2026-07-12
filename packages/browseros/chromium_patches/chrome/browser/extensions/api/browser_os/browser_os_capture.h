diff --git a/chrome/browser/extensions/api/browser_os/browser_os_capture.h b/chrome/browser/extensions/api/browser_os/browser_os_capture.h
new file mode 100644
index 0000000000000..c4b8e1a2f3d01
--- /dev/null
+++ b/chrome/browser/extensions/api/browser_os/browser_os_capture.h
@@ -0,0 +1,75 @@
+// Copyright 2025 The Chromium Authors
+// Use of this source code is governed by a BSD-style license that can be
+// found in the LICENSE file.
+
+#ifndef CHROME_BROWSER_EXTENSIONS_API_BROWSER_OS_BROWSER_OS_CAPTURE_H_
+#define CHROME_BROWSER_EXTENSIONS_API_BROWSER_OS_BROWSER_OS_CAPTURE_H_
+
+#include <optional>
+#include <string>
+#include <vector>
+
+#include "base/no_destructor.h"
+#include "chrome/common/extensions/api/browser_os.h"
+
+namespace content {
+class BrowserContext;
+class WebContents;
+}  // namespace content
+
+namespace extensions {
+class Extension;
+
+namespace api {
+
+// Tracks BrowserOS capture sessions and delegates stream IDs to TabCaptureRegistry.
+class BrowserOSCaptureService {
+ public:
+  struct Session {
+    Session();
+    ~Session();
+    Session(const Session&);
+    Session& operator=(const Session&);
+    Session(Session&&);
+    Session& operator=(Session&&);
+
+    int tab_id = 0;
+    std::string stream_id;
+    browser_os::CaptureClass capture_class =
+        browser_os::CaptureClass::kMeeting;
+    std::string bucket_id;
+    std::string session_id;
+    bool active = false;
+  };
+
+  static BrowserOSCaptureService* Get();
+
+  std::optional<Session> StartCapture(content::BrowserContext* browser_context,
+                                      const Extension* extension,
+                                      int caller_process_id,
+                                      std::optional<int> restrict_to_frame_id,
+                                      int tab_id,
+                                      browser_os::CaptureClass capture_class,
+                                      const std::string& bucket_id,
+                                      const std::string& session_id);
+
+  bool StopCapture(int tab_id);
+
+  std::optional<Session> GetStatus(int tab_id) const;
+
+ private:
+  friend base::NoDestructor<BrowserOSCaptureService>;
+
+  BrowserOSCaptureService();
+  ~BrowserOSCaptureService();
+
+  Session* FindSession(int tab_id);
+  const Session* FindSession(int tab_id) const;
+
+  std::vector<Session> sessions_;
+};
+
+}  // namespace api
+}  // namespace extensions
+
+#endif  // CHROME_BROWSER_EXTENSIONS_API_BROWSER_OS_BROWSER_OS_CAPTURE_H_
