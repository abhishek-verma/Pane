diff --git a/chrome/common/chrome_constants.cc b/chrome/common/chrome_constants.cc
index 6e30ef1147..0a6aaeb85d 100644
--- a/chrome/common/chrome_constants.cc
+++ b/chrome/common/chrome_constants.cc
@@ -46,7 +46,7 @@ const base::FilePath::CharType kBrowserProcessExecutableName[] = FPL("chrome");
 const base::FilePath::CharType kHelperProcessExecutableName[] =
     FPL("sandboxed_process");
 #elif BUILDFLAG(IS_POSIX)
-const base::FilePath::CharType kBrowserProcessExecutableName[] = FPL("chrome");
+const base::FilePath::CharType kBrowserProcessExecutableName[] = FPL("browseros");
 // Helper processes end up with a name of "exe" due to execing via
 // /proc/self/exe.  See bug 22703.
 const base::FilePath::CharType kHelperProcessExecutableName[] = FPL("exe");
@@ -75,8 +75,8 @@ const base::FilePath::CharType kHelperProcessExecutablePath[] =
 const base::FilePath::CharType kBrowserProcessExecutablePath[] = FPL("chrome");
 const base::FilePath::CharType kHelperProcessExecutablePath[] = FPL("chrome");
 #elif BUILDFLAG(IS_POSIX)
-const base::FilePath::CharType kBrowserProcessExecutablePath[] = FPL("chrome");
-const base::FilePath::CharType kHelperProcessExecutablePath[] = FPL("chrome");
+const base::FilePath::CharType kBrowserProcessExecutablePath[] = FPL("browseros");
+const base::FilePath::CharType kHelperProcessExecutablePath[] = FPL("browseros");
 #endif  // OS_*
 
 #if BUILDFLAG(IS_MAC)
