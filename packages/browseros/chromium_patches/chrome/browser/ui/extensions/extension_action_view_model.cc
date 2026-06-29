diff --git a/chrome/browser/ui/extensions/extension_action_view_model.cc b/chrome/browser/ui/extensions/extension_action_view_model.cc
index 1111111111111..2222222222222 100644
--- a/chrome/browser/ui/extensions/extension_action_view_model.cc
+++ b/chrome/browser/ui/extensions/extension_action_view_model.cc
@@ -16,6 +16,8 @@
 #include "base/strings/strcat.h"
 #include "base/strings/string_util.h"
 #include "base/strings/utf_string_conversions.h"
+#include "chrome/browser/browseros/core/browseros_constants.h"
+#include "chrome/browser/browseros/core/browseros_display_names.h"
 #include "chrome/browser/extensions/commands/command_service.h"
 #include "chrome/browser/extensions/extension_action_runner.h"
 #include "chrome/browser/extensions/extension_context_menu_model.h"
@@ -43,6 +45,9 @@
 #include "extensions/common/manifest_constants.h"
 #include "ui/base/l10n/l10n_util.h"
 #include "ui/base/models/image_model.h"
+#include "components/vector_icons/vector_icons.h"
+#include "third_party/skia/include/core/SkColor.h"
+#include "ui/gfx/paint_vector_icon.h"
 #include "ui/color/color_provider_manager.h"
 #include "ui/gfx/image/image_skia.h"
 #include "ui/gfx/native_ui_types.h"
@@ -199,6 +204,13 @@ ExtensionActionViewModel::GetIcon(
   if (!ExtensionIsValid()) {
     return ui::ImageModel();
   }
+
+  if (browseros::IsBrowserOSExtension(extension_id_)) {
+    constexpr SkColor orange = SkColorSetRGB(0xFB, 0x65, 0x18);
+    return ui::ImageModel::FromImageSkia(gfx::CreateVectorIcon(
+        vector_icons::kPaneMarkIcon, size.height(), orange));
+  }
 
   return ui::ImageModel::FromImageSkia(
       gfx::ImageSkia(GetIconImageSource(web_contents, size), size));
@@ -212,7 +224,8 @@ std::u16string ExtensionActionViewModel::GetActionName() const {
     return std::u16string();
   }
 
-  return base::UTF8ToUTF16(extension_->name());
+  return browseros::GetBrowserOSExtensionDisplayNameOrFallback(
+      extension_->id(), extension_->name());
 }
 
 std::u16string ExtensionActionViewModel::GetActionTitle(
