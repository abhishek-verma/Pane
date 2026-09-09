diff --git a/chrome/browser/browseros/server/layer_authority.cc b/chrome/browser/browseros/server/layer_authority.cc
new file mode 100644
--- /dev/null
+++ b/chrome/browser/browseros/server/layer_authority.cc
@@ -0,0 +1,50 @@
+// Copyright 2026 The Chromium Authors
+// Use of this source code is governed by a BSD-style license.
+#include "chrome/browser/browseros/server/layer_authority.h"
+#include "base/base64url.h"
+#include "base/containers/span.h"
+#include "base/json/json_writer.h"
+#include "base/no_destructor.h"
+#include "base/rand_util.h"
+#include "base/strings/string_number_conversions.h"
+#include "base/synchronization/lock.h"
+#include "base/time/time.h"
+#include "base/uuid.h"
+#include "base/values.h"
+#include "crypto/hmac.h"
+namespace browseros {
+namespace {
+struct Authority { base::Lock lock; std::string secret; };
+Authority& GetAuthority() { static base::NoDestructor<Authority> value; return *value; }
+}
+std::string RotateLayerLaunchSecret() {
+  auto& authority = GetAuthority();
+  base::AutoLock lock(authority.lock);
+  authority.secret = base::HexEncode(base::as_byte_span(base::RandBytesAsString(32)));
+  return authority.secret;
+}
+void ClearLayerLaunchSecret() {
+  auto& authority = GetAuthority();
+  base::AutoLock lock(authority.lock);
+  authority.secret.clear();
+}
+std::optional<std::string> MintLayerCredential(const std::string& profile_id) {
+  if (!base::Uuid::ParseCaseInsensitive(profile_id).is_valid()) return std::nullopt;
+  auto& authority = GetAuthority();
+  base::AutoLock lock(authority.lock);
+  if (authority.secret.empty()) return std::nullopt;
+  base::DictValue claims;
+  claims.Set("profileId", profile_id);
+  claims.Set("extensionId", kLayerExtensionId);
+  claims.Set("expiresAt", static_cast<double>((base::Time::Now() + base::Minutes(5)).InMillisecondsSinceUnixEpoch()));
+  const auto json = base::WriteJson(claims);
+  if (!json) return std::nullopt;
+  std::string body;
+  base::Base64UrlEncode(*json, base::Base64UrlEncodePolicy::OMIT_PADDING, &body);
+  const std::string message = "pane.layers.auth.v1." + body;
+  const auto signature = crypto::hmac::SignSha256(base::as_byte_span(authority.secret), base::as_byte_span(message));
+  std::string encoded_signature;
+  base::Base64UrlEncode(signature, base::Base64UrlEncodePolicy::OMIT_PADDING, &encoded_signature);
+  return message + "." + encoded_signature;
+}
+}  // namespace browseros
