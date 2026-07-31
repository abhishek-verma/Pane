diff --git a/chrome/common/url_constants.h b/chrome/common/url_constants.h
index 012f27fbd5df9bdf8ad29edf9a92b7de0c923e1c..18a13068566880b71e2b1bfb79b3e24c30550f41 100644
--- a/chrome/common/url_constants.h
+++ b/chrome/common/url_constants.h
@@ -131,6 +131,9 @@ inline constexpr char kChromeOsHelpViaWebUIURL[] =
 // widgets instead of using HTML.
 inline constexpr char kChromeNativeScheme[] = "chrome-native";
 
+// Personalised Internet pages in Pane (rewritten to the agent extension).
+inline constexpr char kPiScheme[] = "pi";
+
 // The URL of safe section in Chrome page (https://www.google.com/chrome).
 inline constexpr char16_t kChromeSafePageURL[] =
     u"https://www.google.com/chrome/#safe";
