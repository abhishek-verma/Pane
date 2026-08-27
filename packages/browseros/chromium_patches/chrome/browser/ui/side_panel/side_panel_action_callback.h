diff --git a/chrome/browser/ui/side_panel/side_panel_action_callback.h b/chrome/browser/ui/side_panel/side_panel_action_callback.h
index eb087227fd..6b2f9ec63c 100644
--- a/chrome/browser/ui/side_panel/side_panel_action_callback.h
+++ b/chrome/browser/ui/side_panel/side_panel_action_callback.h
@@ -16,6 +16,16 @@ actions::ActionItem::InvokeActionCallback CreateToggleSidePanelActionCallback(
     SidePanelEntryKey key,
     BrowserWindowInterface* bwi);
 
+// Dispatches a real extension action.onClicked event for the BrowserOS Agent
+// extension on the active tab of `bwi`, exactly as if the user had clicked a
+// normal pinned extension toolbar icon. This lets the extension's own
+// scope-aware toggleSidePanel() (apps/app/lib/browseros/toggleSidePanel.ts)
+// be the single implementation of open/close behavior for both per-tab and
+// per-window (shared) side panel modes, instead of native code re-deciding
+// panel scope itself. Shows an "installing/updating" infobar if the agent
+// extension isn't installed/enabled yet.
+void DispatchAgentSidePanelToggleClick(BrowserWindowInterface* bwi);
+
 extern const ui::ClassProperty<
     std::underlying_type_t<SidePanelOpenTrigger>>* const
     kSidePanelOpenTriggerKey;
