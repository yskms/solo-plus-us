import { Platform } from 'react-native';
import { requireNativeModule } from 'expo';

type BackupExclusionNativeModule = {
  setExcludedFromBackup(path: string): void;
  isExcludedFromBackup(path: string): boolean;
};

// iOS-only native module (Android handles the same requirement declaratively
// via `plugins/withAndroidNoBackup.js`), so it's only required on iOS —
// requiring it on Android would throw because nothing is linked there.
const NativeModule: BackupExclusionNativeModule | null =
  Platform.OS === 'ios' ? requireNativeModule<BackupExclusionNativeModule>('BackupExclusion') : null;

/**
 * Marks `path` (a plain filesystem path, not a `file://` URI) as excluded
 * from iCloud/Finder backup. No-op outside iOS.
 */
export function setExcludedFromBackup(path: string): void {
  NativeModule?.setExcludedFromBackup(path);
}

/** For verification only. Always `false` outside iOS. */
export function isExcludedFromBackup(path: string): boolean {
  return NativeModule?.isExcludedFromBackup(path) ?? false;
}
