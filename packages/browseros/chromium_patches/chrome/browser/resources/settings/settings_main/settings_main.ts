diff --git a/chrome/browser/resources/settings/settings_main/settings_main.ts b/chrome/browser/resources/settings/settings_main/settings_main.ts
index bf151d0e00..978c05d061 100644
--- a/chrome/browser/resources/settings/settings_main/settings_main.ts
+++ b/chrome/browser/resources/settings/settings_main/settings_main.ts
@@ -21,6 +21,7 @@ import '../privacy_page/privacy_page_index.js';
 import '../reset_page/reset_profile_banner.js';
 import '../search_page/search_page_index.js';
 import '../your_saved_info_page/your_saved_info_page_index.js';
+import '../browseros_prefs_page/browseros_prefs_page.js';
 // <if expr="not is_chromeos">
 import '../default_browser_page/default_browser_page.js';
 
@@ -47,7 +48,6 @@ import {combineSearchResults} from '../search_settings.js';
 import {getTemplate} from './settings_main.html.js';
 import type {SettingsPlugin} from './settings_plugin.js';
 
-
 export interface SettingsMainElement {
   $: {
     noSearchResults: HTMLElement,
