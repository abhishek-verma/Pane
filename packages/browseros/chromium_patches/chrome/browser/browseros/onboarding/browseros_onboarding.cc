diff --git a/chrome/browser/browseros/onboarding/browseros_onboarding.cc b/chrome/browser/browseros/onboarding/browseros_onboarding.cc
new file mode 100644
index 0000000000..861b651ec3
--- /dev/null
+++ b/chrome/browser/browseros/onboarding/browseros_onboarding.cc
@@ -0,0 +1,408 @@
+// Copyright 2026 The Chromium Authors
+// Use of this source code is governed by a BSD-style license that can be
+// found in the LICENSE file.
+
+#include "chrome/browser/browseros/onboarding/browseros_onboarding.h"
+
+#include <stdint.h>
+
+#include <memory>
+#include <string>
+#include <string_view>
+#include <utility>
+
+#include "base/functional/bind.h"
+#include "base/functional/callback.h"
+#include "base/strings/stringprintf.h"
+#include "base/strings/utf_string_conversions.h"
+#include "base/values.h"
+#include "chrome/browser/browser_process.h"
+#include "chrome/browser/importer/external_process_importer_host.h"
+#include "chrome/browser/importer/importer_list.h"
+#include "chrome/browser/importer/importer_progress_observer.h"
+#include "chrome/browser/importer/profile_writer.h"
+#include "chrome/browser/profiles/profile.h"
+#include "chrome/common/webui_url_constants.h"
+#include "chrome/grit/browseros_onboarding_resources.h"
+#include "chrome/grit/browseros_onboarding_resources_map.h"
+#include "components/user_data_importer/common/importer_data_types.h"
+#include "content/public/browser/web_ui.h"
+#include "content/public/browser/web_ui_data_source.h"
+#include "content/public/browser/web_ui_message_handler.h"
+#include "content/public/common/url_constants.h"
+#include "ui/webui/webui_util.h"
+
+namespace {
+
+constexpr int kBrowserOSOnboardingApiVersion = 1;
+constexpr uint16_t kBrowserOSImportableItems =
+    user_data_importer::HISTORY | user_data_importer::FAVORITES |
+    user_data_importer::COOKIES | user_data_importer::PASSWORDS |
+    user_data_importer::SEARCH_ENGINES |
+    user_data_importer::AUTOFILL_FORM_DATA | user_data_importer::EXTENSIONS;
+
+std::string SourceIdForIndex(size_t index) {
+  return base::StringPrintf("source-%zu", index);
+}
+
+const char* ImportItemToString(user_data_importer::ImportItem item) {
+  switch (item) {
+    case user_data_importer::HISTORY:
+      return "history";
+    case user_data_importer::FAVORITES:
+      return "bookmarks";
+    case user_data_importer::COOKIES:
+      return "cookies";
+    case user_data_importer::PASSWORDS:
+      return "passwords";
+    case user_data_importer::SEARCH_ENGINES:
+      return "searchEngines";
+    case user_data_importer::AUTOFILL_FORM_DATA:
+      return "autofill";
+    case user_data_importer::EXTENSIONS:
+      return "extensions";
+    case user_data_importer::NONE:
+    case user_data_importer::HOME_PAGE:
+    case user_data_importer::ALL:
+      return nullptr;
+  }
+}
+
+uint16_t ImportItemMaskFromString(std::string_view item) {
+  if (item == "history") {
+    return user_data_importer::HISTORY;
+  }
+  if (item == "bookmarks") {
+    return user_data_importer::FAVORITES;
+  }
+  if (item == "cookies") {
+    return user_data_importer::COOKIES;
+  }
+  if (item == "passwords") {
+    return user_data_importer::PASSWORDS;
+  }
+  if (item == "searchEngines") {
+    return user_data_importer::SEARCH_ENGINES;
+  }
+  if (item == "autofill") {
+    return user_data_importer::AUTOFILL_FORM_DATA;
+  }
+  if (item == "extensions") {
+    return user_data_importer::EXTENSIONS;
+  }
+  return user_data_importer::NONE;
+}
+
+void AppendImportItem(base::ListValue& items,
+                      uint16_t services,
+                      user_data_importer::ImportItem item) {
+  if ((services & item) == 0) {
+    return;
+  }
+
+  const char* name = ImportItemToString(item);
+  if (name) {
+    items.Append(name);
+  }
+}
+
+base::ListValue ImportItemsFromMask(uint16_t services) {
+  base::ListValue items;
+  AppendImportItem(items, services, user_data_importer::HISTORY);
+  AppendImportItem(items, services, user_data_importer::FAVORITES);
+  AppendImportItem(items, services, user_data_importer::COOKIES);
+  AppendImportItem(items, services, user_data_importer::PASSWORDS);
+  AppendImportItem(items, services, user_data_importer::SEARCH_ENGINES);
+  AppendImportItem(items, services, user_data_importer::AUTOFILL_FORM_DATA);
+  AppendImportItem(items, services, user_data_importer::EXTENSIONS);
+  return items;
+}
+
+}  // namespace
+
+class BrowserOSOnboardingHandler : public content::WebUIMessageHandler,
+                                   public importer::ImporterProgressObserver {
+ public:
+  BrowserOSOnboardingHandler() = default;
+  BrowserOSOnboardingHandler(const BrowserOSOnboardingHandler&) = delete;
+  BrowserOSOnboardingHandler& operator=(const BrowserOSOnboardingHandler&) =
+      delete;
+  ~BrowserOSOnboardingHandler() override {
+    if (importer_host_) {
+      importer_host_->set_observer(nullptr);
+    }
+  }
+
+  void SetCompletionCallback(base::RepeatingClosure completion_callback) {
+    completion_callback_ = std::move(completion_callback);
+  }
+
+ private:
+  void RegisterMessages() override {
+    web_ui()->RegisterMessageCallback(
+        "browserosOnboardingPageReady",
+        base::BindRepeating(&BrowserOSOnboardingHandler::HandlePageReady,
+                            base::Unretained(this)));
+    web_ui()->RegisterMessageCallback(
+        "browserosOnboardingRefreshSources",
+        base::BindRepeating(&BrowserOSOnboardingHandler::HandleRefreshSources,
+                            base::Unretained(this)));
+    web_ui()->RegisterMessageCallback(
+        "browserosOnboardingStartImport",
+        base::BindRepeating(&BrowserOSOnboardingHandler::HandleStartImport,
+                            base::Unretained(this)));
+    web_ui()->RegisterMessageCallback(
+        "browserosOnboardingComplete",
+        base::BindRepeating(&BrowserOSOnboardingHandler::HandleComplete,
+                            base::Unretained(this)));
+  }
+
+  void OnJavascriptDisallowed() override {
+    importer_list_.reset();
+    importer_list_loaded_ = false;
+    current_item_ = user_data_importer::NONE;
+    completed_items_ = user_data_importer::NONE;
+    imported_items_ = user_data_importer::NONE;
+    if (importer_host_) {
+      importer_host_->set_observer(nullptr);
+      importer_host_ = nullptr;
+    }
+  }
+
+  void HandlePageReady(const base::ListValue& args) {
+    if (!IsJavascriptAllowed()) {
+      AllowJavascript();
+    }
+    SendState("detecting");
+    DetectSources();
+  }
+
+  void HandleRefreshSources(const base::ListValue& args) {
+    SendState("detecting");
+    DetectSources();
+  }
+
+  void HandleStartImport(const base::ListValue& args) {
+    if (!importer_list_loaded_ || !importer_list_ ||
+        importer_list_->count() == 0) {
+      SendFailure("no_sources", "No detected import source is ready.");
+      return;
+    }
+
+    int browser_index = 0;
+    uint16_t selected_items = user_data_importer::NONE;
+    bool has_selected_items = false;
+    if (!args.empty() && args[0].is_dict()) {
+      const base::DictValue& request = args[0].GetDict();
+      const std::string* source_id = request.FindString("sourceId");
+      if (!source_id || !FindSourceIndex(*source_id, &browser_index)) {
+        SendFailure("invalid_source", "Selected import source is not valid.");
+        return;
+      }
+
+      if (const base::ListValue* items = request.FindList("items")) {
+        has_selected_items = true;
+        for (const base::Value& item : *items) {
+          if (item.is_string()) {
+            selected_items |= ImportItemMaskFromString(item.GetString());
+          }
+        }
+      }
+    } else if (!args.empty()) {
+      browser_index = args[0].GetInt();
+    }
+    if (browser_index < 0 ||
+        browser_index >= static_cast<int>(importer_list_->count())) {
+      SendFailure("invalid_source", "Selected import source is out of range.");
+      return;
+    }
+
+    const user_data_importer::SourceProfile& source_profile =
+        importer_list_->GetSourceProfileAt(browser_index);
+    uint16_t supported_items =
+        source_profile.services_supported & kBrowserOSImportableItems;
+    uint16_t imported_items = has_selected_items
+                                  ? (selected_items & supported_items)
+                                  : supported_items;
+    if (!imported_items) {
+      SendFailure("no_supported_items",
+                  "Selected source has no supported import items.");
+      return;
+    }
+
+    if (importer_host_) {
+      importer_host_->set_observer(nullptr);
+    }
+
+    import_did_succeed_ = false;
+    imported_items_ = imported_items;
+    completed_items_ = user_data_importer::NONE;
+    current_item_ = user_data_importer::NONE;
+    importer_host_ = new ExternalProcessImporterHost();
+    importer_host_->set_observer(this);
+    Profile* profile = Profile::FromWebUI(web_ui());
+    SendState("importing");
+    importer_host_->StartImportSettings(source_profile, profile, imported_items,
+                                        new ProfileWriter(profile));
+  }
+
+  void HandleComplete(const base::ListValue& args) {
+    SendState("completed");
+
+    base::RepeatingClosure completion_callback = completion_callback_;
+    if (completion_callback) {
+      completion_callback.Run();
+      return;
+    }
+  }
+
+  void DetectSources() {
+    importer_list_loaded_ = false;
+    current_item_ = user_data_importer::NONE;
+    completed_items_ = user_data_importer::NONE;
+    imported_items_ = user_data_importer::NONE;
+    importer_list_ = std::make_unique<ImporterList>();
+    importer_list_->DetectSourceProfiles(
+        g_browser_process->GetApplicationLocale(), false,
+        base::BindOnce(&BrowserOSOnboardingHandler::HandleSourcesDetected,
+                       base::Unretained(this)));
+  }
+
+  void HandleSourcesDetected() {
+    importer_list_loaded_ = true;
+    SendState("ready");
+  }
+
+  bool FindSourceIndex(const std::string& source_id, int* index) const {
+    for (size_t i = 0; importer_list_ && i < importer_list_->count(); ++i) {
+      if (SourceIdForIndex(i) == source_id) {
+        *index = static_cast<int>(i);
+        return true;
+      }
+    }
+    return false;
+  }
+
+  base::ListValue BuildSources() const {
+    base::ListValue sources;
+    for (size_t i = 0; importer_list_ && i < importer_list_->count(); ++i) {
+      const user_data_importer::SourceProfile& source_profile =
+          importer_list_->GetSourceProfileAt(i);
+      uint16_t services = source_profile.services_supported;
+      std::string browser_name =
+          base::UTF16ToUTF8(source_profile.importer_name);
+      std::string profile_name = base::UTF16ToUTF8(source_profile.profile);
+      std::string display_name = profile_name.empty()
+                                     ? browser_name
+                                     : browser_name + " - " + profile_name;
+
+      base::DictValue source;
+      source.Set("id", SourceIdForIndex(i));
+      source.Set("displayName", display_name);
+      source.Set("browserName", browser_name);
+      source.Set("profileName", profile_name);
+      source.Set("supportedItems", ImportItemsFromMask(services));
+      source.Set("recommendedItems", ImportItemsFromMask(services));
+      sources.Append(std::move(source));
+    }
+    return sources;
+  }
+
+  base::DictValue BuildProgress() const {
+    base::DictValue progress;
+    progress.Set("completedItems", ImportItemsFromMask(completed_items_));
+    progress.Set("totalItems",
+                 static_cast<int>(ImportItemsFromMask(imported_items_).size()));
+    const char* current_item = ImportItemToString(current_item_);
+    if (current_item) {
+      progress.Set("currentItem", current_item);
+    }
+    return progress;
+  }
+
+  void SendState(std::string_view status) {
+    if (IsJavascriptAllowed()) {
+      base::DictValue state;
+      state.Set("apiVersion", kBrowserOSOnboardingApiVersion);
+      state.Set("status", std::string(status));
+      state.Set("sources", BuildSources());
+      if (imported_items_) {
+        state.Set("progress", BuildProgress());
+      }
+      CallJavascriptFunction("browserosOnboarding.receiveState", state);
+    }
+  }
+
+  void SendFailure(const std::string& code, const std::string& message) {
+    if (IsJavascriptAllowed()) {
+      base::DictValue state;
+      state.Set("apiVersion", kBrowserOSOnboardingApiVersion);
+      state.Set("status", "failed");
+      state.Set("sources", BuildSources());
+      base::DictValue error;
+      error.Set("code", code);
+      error.Set("message", message);
+      state.Set("error", std::move(error));
+      CallJavascriptFunction("browserosOnboarding.receiveState", state);
+    }
+  }
+
+  void ImportStarted() override { SendState("importing"); }
+
+  void ImportItemStarted(user_data_importer::ImportItem item) override {
+    current_item_ = item;
+    SendState("importing");
+  }
+
+  void ImportItemEnded(user_data_importer::ImportItem item) override {
+    completed_items_ |= static_cast<uint16_t>(item);
+    current_item_ = user_data_importer::NONE;
+    import_did_succeed_ = true;
+    SendState("importing");
+  }
+
+  void ImportEnded() override {
+    if (importer_host_) {
+      importer_host_->set_observer(nullptr);
+      importer_host_ = nullptr;
+    }
+    current_item_ = user_data_importer::NONE;
+    SendState(import_did_succeed_ ? "succeeded" : "failed");
+  }
+
+  std::unique_ptr<ImporterList> importer_list_;
+  raw_ptr<ExternalProcessImporterHost> importer_host_ = nullptr;
+  base::RepeatingClosure completion_callback_;
+  user_data_importer::ImportItem current_item_ = user_data_importer::NONE;
+  uint16_t completed_items_ = user_data_importer::NONE;
+  uint16_t imported_items_ = user_data_importer::NONE;
+  bool importer_list_loaded_ = false;
+  bool import_did_succeed_ = false;
+};
+
+BrowserOSOnboardingUIConfig::BrowserOSOnboardingUIConfig()
+    : DefaultWebUIConfig(content::kChromeUIScheme,
+                         chrome::kChromeUIBrowserOSOnboardingHost) {}
+
+BrowserOSOnboarding::BrowserOSOnboarding(content::WebUI* web_ui)
+    : content::WebUIController(web_ui) {
+  content::WebUIDataSource* source = content::WebUIDataSource::CreateAndAdd(
+      Profile::FromWebUI(web_ui), chrome::kChromeUIBrowserOSOnboardingHost);
+  webui::SetupWebUIDataSource(source, kBrowserosOnboardingResources,
+                              IDR_BROWSEROS_ONBOARDING_INDEX_HTML);
+
+  auto handler = std::make_unique<BrowserOSOnboardingHandler>();
+  handler_ = handler.get();
+  web_ui->AddMessageHandler(std::move(handler));
+}
+
+BrowserOSOnboarding::~BrowserOSOnboarding() = default;
+
+void BrowserOSOnboarding::SetCompletionCallback(
+    base::RepeatingClosure completion_callback) {
+  if (handler_) {
+    handler_->SetCompletionCallback(std::move(completion_callback));
+  }
+}
+
+WEB_UI_CONTROLLER_TYPE_IMPL(BrowserOSOnboarding)
