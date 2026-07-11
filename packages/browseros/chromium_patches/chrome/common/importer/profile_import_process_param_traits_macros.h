diff --git a/chrome/common/importer/profile_import_process_param_traits_macros.h b/chrome/common/importer/profile_import_process_param_traits_macros.h
index b19a5aa8ce..1d7aaad822 100644
--- a/chrome/common/importer/profile_import_process_param_traits_macros.h
+++ b/chrome/common/importer/profile_import_process_param_traits_macros.h
@@ -23,11 +23,11 @@
 #if BUILDFLAG(IS_WIN)
 IPC_ENUM_TRAITS_MIN_MAX_VALUE(user_data_importer::ImporterType,
                               user_data_importer::TYPE_UNKNOWN,
-                              user_data_importer::TYPE_EDGE)
+                              user_data_importer::TYPE_CHROME)
 #else
 IPC_ENUM_TRAITS_MIN_MAX_VALUE(user_data_importer::ImporterType,
                               user_data_importer::TYPE_UNKNOWN,
-                              user_data_importer::TYPE_BOOKMARKS_FILE)
+                              user_data_importer::TYPE_CHROME)
 #endif
 
 IPC_ENUM_TRAITS_MIN_MAX_VALUE(user_data_importer::ImportItem,
