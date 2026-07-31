diff --git a/chrome/common/chrome_content_client.cc b/chrome/common/chrome_content_client.cc
index 12b399993afcdd071b2c53d7836c40444032dd05..cc359aab59dd6f05f7691736e0e8fe116c5fd1e8 100644
--- a/chrome/common/chrome_content_client.cc
+++ b/chrome/common/chrome_content_client.cc
@@ -194,7 +194,7 @@ static const char* const kChromeStandardURLSchemes[] = {
 #endif  // BUILDFLAG(IS_WIN) || BUILDFLAG(IS_MAC) || BUILDFLAG(IS_LINUX) ||
         // BUILDFLAG(IS_CHROMEOS)
     chrome::kChromeNativeScheme,        chrome::kChromeSearchScheme,
-    dom_distiller::kDomDistillerScheme,
+    chrome::kPiScheme,                  dom_distiller::kDomDistillerScheme,
 #if BUILDFLAG(IS_ANDROID)
     content::kAndroidAppScheme,
 #endif
@@ -228,6 +228,9 @@ void ChromeContentClient::AddAdditionalSchemes(Schemes* schemes) {
   // chrome-search: resources shouldn't trigger insecure content warnings.
   schemes->secure_schemes.push_back(chrome::kChromeSearchScheme);
 
+  // pi: is rewritten to the local Pane agent extension (private profile data).
+  schemes->secure_schemes.push_back(chrome::kPiScheme);
+
 #if BUILDFLAG(ENABLE_EXTENSIONS_CORE)
   // Treat extensions as secure because communication with them is entirely in
   // the browser, so there is no danger of manipulation or eavesdropping on
