import ExpoModulesCore

/// 基本設計 §8.6 / D-07 — sets `URLResourceKey.isExcludedFromBackupKey`
/// (`NSURLIsExcludedFromBackupKey`), which expo-file-system has no API for.
///
/// Setting it on a *directory* excludes everything inside it, including
/// files created later — so callers mark the DB directory once rather than
/// each file (the `-wal`/`-shm` siblings and migration/recovery temp files
/// appear and disappear on their own schedule).
public class BackupExclusionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackupExclusion")

    Function("setExcludedFromBackup") { (path: String) in
      var url = URL(fileURLWithPath: path)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
    }

    Function("isExcludedFromBackup") { (path: String) -> Bool in
      let url = URL(fileURLWithPath: path)
      return try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup ?? false
    }
  }
}
