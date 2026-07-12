diff --git a/chrome/browser/extensions/api/browser_os/browser_os_capture.cc b/chrome/browser/extensions/api/browser_os/browser_os_capture.cc
new file mode 100644
index 0000000000000..8f2d4c91b7e12
--- /dev/null
+++ b/chrome/browser/extensions/api/browser_os/browser_os_capture.cc
@@ -0,0 +1,168 @@
+// Copyright 2025 The Chromium Authors
+// Use of this source code is governed by a BSD-style license that can be
+// found in the LICENSE file.
+
+#include "chrome/browser/extensions/api/browser_os/browser_os_capture.h"
+
+#include <algorithm>
+
+#include "base/command_line.h"
+#include "base/no_destructor.h"
+#include "chrome/browser/extensions/api/tab_capture/tab_capture_registry.h"
+#include "chrome/browser/extensions/extension_tab_util.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
+#include "chrome/common/chrome_switches.h"
+#include "components/sessions/content/session_tab_helper.h"
+#include "content/public/browser/desktop_media_id.h"
+#include "content/public/browser/render_frame_host.h"
+#include "content/public/browser/render_process_host.h"
+#include "content/public/browser/web_contents.h"
+#include "content/public/browser/web_contents_media_capture_id.h"
+#include "extensions/common/mojom/api_permission_id.mojom-shared.h"
+#include "extensions/common/permissions/permissions_data.h"
+#include "extensions/common/switches.h"
+
+#include "url/gurl.h"
+
+namespace extensions {
+namespace api {
+namespace {
+
+content::DesktopMediaID BuildDesktopMediaIdForTab(
+    content::WebContents* target_contents) {
+  content::RenderFrameHost* const target_frame =
+      target_contents->GetPrimaryMainFrame();
+  return content::DesktopMediaID(
+      content::DesktopMediaID::TYPE_WEB_CONTENTS,
+      content::DesktopMediaID::kNullId,
+      content::WebContentsMediaCaptureId(
+          target_frame->GetProcess()->GetDeprecatedID(),
+          target_frame->GetRoutingID()));
+}
+
+std::string GetAllowlistedExtensionId() {
+  return base::CommandLine::ForCurrentProcess()->GetSwitchValueASCII(
+      switches::kAllowlistedExtensionID);
+}
+
+bool CanCaptureTab(const Extension* extension,
+                   content::WebContents* target_contents) {
+  if (!extension || !target_contents) {
+    return false;
+  }
+
+  const std::string extension_id = extension->id();
+  if (extension->permissions_data()->HasAPIPermissionForTab(
+          sessions::SessionTabHelper::IdForTab(target_contents).id(),
+          mojom::APIPermissionID::kTabCaptureForTab) ||
+      GetAllowlistedExtensionId() == extension_id ||
+      extension_id == browseros::kAgentExtensionId) {
+    return true;
+  }
+
+  return false;
+}
+
+}  // namespace
+
+BrowserOSCaptureService::Session::Session() = default;
+BrowserOSCaptureService::Session::~Session() = default;
+BrowserOSCaptureService::Session::Session(const Session&) = default;
+BrowserOSCaptureService::Session& BrowserOSCaptureService::Session::operator=(
+    const Session&) = default;
+BrowserOSCaptureService::Session::Session(Session&&) = default;
+BrowserOSCaptureService::Session& BrowserOSCaptureService::Session::operator=(
+    Session&&) = default;
+
+BrowserOSCaptureService::BrowserOSCaptureService() = default;
+BrowserOSCaptureService::~BrowserOSCaptureService() = default;
+
+// static
+BrowserOSCaptureService* BrowserOSCaptureService::Get() {
+  static base::NoDestructor<BrowserOSCaptureService> instance;
+  return instance.get();
+}
+
+BrowserOSCaptureService::Session* BrowserOSCaptureService::FindSession(
+    int tab_id) {
+  for (Session& session : sessions_) {
+    if (session.tab_id == tab_id) {
+      return &session;
+    }
+  }
+  return nullptr;
+}
+
+const BrowserOSCaptureService::Session* BrowserOSCaptureService::FindSession(
+    int tab_id) const {
+  for (const Session& session : sessions_) {
+    if (session.tab_id == tab_id) {
+      return &session;
+    }
+  }
+  return nullptr;
+}
+
+std::optional<BrowserOSCaptureService::Session>
+BrowserOSCaptureService::StartCapture(content::BrowserContext* browser_context,
+                                      const Extension* extension,
+                                      int caller_process_id,
+                                      std::optional<int> restrict_to_frame_id,
+                                      int tab_id,
+                                      browser_os::CaptureClass capture_class,
+                                      const std::string& bucket_id,
+                                      const std::string& session_id) {
+  content::WebContents* target_contents = nullptr;
+  if (!ExtensionTabUtil::GetTabById(tab_id, browser_context, true,
+                                    &target_contents) ||
+      !target_contents) {
+    return std::nullopt;
+  }
+
+  if (!CanCaptureTab(extension, target_contents)) {
+    return std::nullopt;
+  }
+
+  if (Session* existing = FindSession(tab_id)) {
+    if (existing->active && !existing->stream_id.empty()) {
+      return *existing;
+    }
+    sessions_.erase(
+        std::remove_if(sessions_.begin(), sessions_.end(),
+                       [tab_id](const Session& session) {
+                         return session.tab_id == tab_id;
+                       }),
+        sessions_.end());
+  }
+
+  if (caller_process_id == -1) {
+    return std::nullopt;
+  }
+
+  TabCaptureRegistry* registry = TabCaptureRegistry::Get(browser_context);
+  if (!registry) {
+    return std::nullopt;
+  }
+
+  const GURL origin = extension->url();
+  const content::DesktopMediaID source =
+      BuildDesktopMediaIdForTab(target_contents);
+  const std::string device_id = registry->AddRequest(
+      target_contents, extension->id(), /*is_anonymous=*/false, origin, source,
+      caller_process_id, restrict_to_frame_id);
+  if (device_id.empty()) {
+    return std::nullopt;
+  }
+
+  Session session;
+  session.tab_id = tab_id;
+  session.stream_id = device_id;
+  session.capture_class = capture_class;
+  session.bucket_id = bucket_id;
+  session.session_id = session_id;
+  session.active = true;
+  sessions_.push_back(session);
+  return session;
+}
+
+bool BrowserOSCaptureService::StopCapture(int tab_id) {
+  if (!FindSession(tab_id)) {
+    return false;
+  }
+
+  sessions_.erase(
+      std::remove_if(sessions_.begin(), sessions_.end(),
+                     [tab_id](const Session& session) {
+                       return session.tab_id == tab_id;
+                     }),
+      sessions_.end());
+  return true;
+}
+
+std::optional<BrowserOSCaptureService::Session>
+BrowserOSCaptureService::GetStatus(int tab_id) const {
+  const Session* session = FindSession(tab_id);
+  if (!session) {
+    return std::nullopt;
+  }
+  return *session;
+}
+
+}  // namespace api
+}  // namespace extensions
