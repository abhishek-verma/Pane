diff --git a/chrome/browser/browseros/onboarding/launch_after_agent_ready.cc b/chrome/browser/browseros/onboarding/launch_after_agent_ready.cc
new file mode 100644
index 0000000000..b2c3d4e5f6
--- /dev/null
+++ b/chrome/browser/browseros/onboarding/launch_after_agent_ready.cc
@@ -0,0 +1,148 @@
+// Copyright 2026 The Chromium Authors
+// Use of this source code is governed by a BSD-style license that can be
+// found in the LICENSE file.
+
+#include "chrome/browser/browseros/onboarding/launch_after_agent_ready.h"
+
+#include <utility>
+
+#include "base/functional/bind.h"
+#include "base/logging.h"
+#include "base/memory/weak_ptr.h"
+#include "base/scoped_observation.h"
+#include "base/timer/timer.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
+#include "chrome/browser/profiles/profile.h"
+#include "content/public/browser/browser_context.h"
+#include "extensions/browser/extension_registry.h"
+#include "extensions/browser/extension_registry_observer.h"
+#include "extensions/common/extension.h"
+#include "url/gurl.h"
+
+namespace browseros::onboarding {
+namespace {
+
+constexpr base::TimeDelta kAgentReadyTimeout = base::Seconds(3);
+
+GURL GetAgentOnboardingUrl() {
+  const std::string url = browseros::GetBrowserOSExtensionURL("/onboarding");
+  if (url.empty()) {
+    return GURL();
+  }
+  return GURL(url);
+}
+
+bool IsAgentExtensionLoaded(Profile* profile) {
+  if (!profile) {
+    return false;
+  }
+  extensions::ExtensionRegistry* registry =
+      extensions::ExtensionRegistry::Get(profile);
+  return registry && registry->enabled_extensions().Contains(
+                         browseros::kAgentExtensionId);
+}
+
+std::vector<GURL> OnboardingFirstRunUrls() {
+  const GURL onboarding_url = GetAgentOnboardingUrl();
+  if (!onboarding_url.is_valid()) {
+    return {};
+  }
+  return {onboarding_url};
+}
+
+// Waits for the agent extension to load, then runs |launch| once.
+class AgentReadyLauncher : public extensions::ExtensionRegistryObserver {
+ public:
+  AgentReadyLauncher(
+      Profile* profile,
+      std::vector<GURL> fallback_urls,
+      base::OnceCallback<void(std::vector<GURL>)> launch)
+      : fallback_urls_(std::move(fallback_urls)), launch_(std::move(launch)) {
+    extensions::ExtensionRegistry* registry =
+        extensions::ExtensionRegistry::Get(profile);
+    if (registry) {
+      registry_observation_.Observe(registry);
+    }
+    timeout_timer_.Start(FROM_HERE, kAgentReadyTimeout,
+                         base::BindOnce(&AgentReadyLauncher::OnTimeout,
+                                        weak_factory_.GetWeakPtr()));
+  }
+
+  AgentReadyLauncher(const AgentReadyLauncher&) = delete;
+  AgentReadyLauncher& operator=(const AgentReadyLauncher&) = delete;
+
+  ~AgentReadyLauncher() override = default;
+
+  // extensions::ExtensionRegistryObserver:
+  void OnExtensionLoaded(content::BrowserContext* browser_context,
+                         const extensions::Extension* extension) override {
+    if (!extension ||
+        extension->id() != browseros::kAgentExtensionId) {
+      return;
+    }
+    Finish(OnboardingFirstRunUrls());
+  }
+
+ private:
+  void OnTimeout() {
+    LOG(WARNING) << "browseros: Timed out waiting for agent extension; "
+                    "falling back to default first-run tabs";
+    Finish(fallback_urls_);
+  }
+
+  void Finish(std::vector<GURL> urls) {
+    if (!launch_) {
+      return;
+    }
+    timeout_timer_.Stop();
+    registry_observation_.Reset();
+    // Keep |this| alive across the launch callback.
+    auto launch = std::move(launch_);
+    std::move(launch).Run(std::move(urls));
+    delete this;
+  }
+
+  std::vector<GURL> fallback_urls_;
+  base::OnceCallback<void(std::vector<GURL>)> launch_;
+  base::OneShotTimer timeout_timer_;
+  base::ScopedObservation<extensions::ExtensionRegistry,
+                          extensions::ExtensionRegistryObserver>
+      registry_observation_{this};
+  base::WeakPtrFactory<AgentReadyLauncher> weak_factory_{this};
+};
+
+}  // namespace
+
+void LaunchBrowserAfterAgentReady(
+    Profile* profile,
+    std::vector<GURL> fallback_urls,
+    base::OnceCallback<void(std::vector<GURL> first_run_urls)> launch) {
+  if (!profile || !launch) {
+    return;
+  }
+
+  if (IsAgentExtensionLoaded(profile)) {
+    std::vector<GURL> urls = OnboardingFirstRunUrls();
+    if (urls.empty()) {
+      std::move(launch).Run(std::move(fallback_urls));
+      return;
+    }
+    LOG(INFO) << "browseros: Agent extension ready; opening onboarding";
+    std::move(launch).Run(std::move(urls));
+    return;
+  }
+
+  const GURL onboarding_url = GetAgentOnboardingUrl();
+  if (!onboarding_url.is_valid()) {
+    LOG(WARNING) << "browseros: Onboarding URL unavailable; using fallback tabs";
+    std::move(launch).Run(std::move(fallback_urls));
+    return;
+  }
+
+  LOG(INFO) << "browseros: Waiting up to " << kAgentReadyTimeout.InSeconds()
+            << "s for agent extension before opening onboarding";
+  // Self-deleting on Finish().
+  new AgentReadyLauncher(profile, std::move(fallback_urls), std::move(launch));
+}
+
+}  // namespace browseros::onboarding
