diff --git a/chrome/browser/resources/settings/route.ts b/chrome/browser/resources/settings/route.ts
index 1503074a46519..6bfcc19577dd9 100644
--- a/chrome/browser/resources/settings/route.ts
+++ b/chrome/browser/resources/settings/route.ts
@@ -161,6 +161,7 @@ function createRoutes(): SettingsRoutes {
 
   // Root page.
   r.BASIC = new Route('/');
+  r.BROWSEROS_PREFS = new Route('/browseros-settings', 'Pane Settings');
 
   r.ABOUT = r.BASIC.createSection(
       '/help', 'about', loadTimeData.getString('aboutPageTitle'));
