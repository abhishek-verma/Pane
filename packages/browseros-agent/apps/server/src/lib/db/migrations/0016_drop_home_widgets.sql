-- Drop Adaptive Home widget tables (UI and tools removed; PI home replaces them).
DROP TABLE IF EXISTS home_widget_cache;
DROP TABLE IF EXISTS home_widgets;
DROP INDEX IF EXISTS home_widgets_status_idx;
