/**
 * 基本設計 v0.11 §8.6 (D-07) — excludes the app from Android Auto Backup.
 *
 * The DB encryption key never leaves this device (database/key.ts uses
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY`), so if the OS ever restored the SQLite
 * file from a backup onto a *different* device, the result would be a file
 * that can never be decrypted there. Turning off `allowBackup` avoids that
 * state ever existing rather than trying to recover from it.
 *
 * This is one half of §8.6 ("検証対象は2つある"). The other half — actively
 * excluding the DB file from iCloud backup on iOS via
 * `NSURLIsExcludedFromBackupKey` — needs a small native module and is not
 * implemented yet; see README "Known gaps".
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const withAndroidNoBackup = (config) => {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:allowBackup'] = 'false';
      application.$['android:fullBackupContent'] = 'false';
    }
    return config;
  });
};

module.exports = withAndroidNoBackup;
