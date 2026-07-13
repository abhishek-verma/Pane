diff --git a/chrome/browser/ui/views/side_panel/side_panel.h b/chrome/browser/ui/views/side_panel/side_panel.h
index 4946a573e2..da735d4bf1 100644
--- a/chrome/browser/ui/views/side_panel/side_panel.h
+++ b/chrome/browser/ui/views/side_panel/side_panel.h
@@ -77,6 +77,7 @@ class SidePanel : public views::AccessiblePaneView,
   // pushing the other side panel content down.
   void AddHeaderView(std::unique_ptr<views::View> view);
  void RemoveHeaderView();

  void SetOutlineVisibility(bool visible);
 
@@ -164,6 +165,9 @@ class SidePanel : public views::AccessiblePaneView,
 
   bool animations_disabled_ = false;
 
+  // BrowserOS: flag to control animations
+  bool animations_disabled_browseros_ = true;
+
   // Starting bounds for the side panel content if kOpenWithContentTransition
   // animation is shown.
   std::optional<gfx::Rect> content_starting_bounds_;
