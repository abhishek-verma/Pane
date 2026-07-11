diff --git a/chrome/browser/resources/settings/router.ts b/chrome/browser/resources/settings/router.ts
index f918f01db0..980f2134fa 100644
--- a/chrome/browser/resources/settings/router.ts
+++ b/chrome/browser/resources/settings/router.ts
@@ -14,6 +14,7 @@ import {loadTimeData} from './i18n_setup.js';
 export interface SettingsRoutes {
   ABOUT: Route;
   ACCESSIBILITY: Route;
+  BROWSEROS_PREFS: Route;
   ADDRESSES: Route;
   ADVANCED: Route;
   AI: Route;
