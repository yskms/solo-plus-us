/**
 * 基本設計 v0.11 §8.6 (D-07) — excludes the app from Android backup and
 * device-to-device transfer.
 *
 * `android:allowBackup="false"` is kept for pre-12 devices, but on
 * Android 12+ it does not reliably cover Google's device-to-device (D2D)
 * migration flow the way `fullBackupContent` used to for cloud backup —
 * `fullBackupContent` itself is also ignored once `allowBackup="false"` is
 * set. Android 12 introduced `android:dataExtractionRules` specifically to
 * control cloud backup and D2D transfer separately; we point it at an XML
 * resource that excludes everything from both, as a second, explicit line
 * of defense on top of `allowBackup="false"`.
 *
 * Without this, a device-to-device migration could move the encrypted
 * SQLite file to a new phone while the key (Keychain/Keystore,
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY`) stays behind — exactly the state §8.6
 * exists to prevent.
 *
 * This is one half of §8.6 ("検証対象は2つある"). The other half — actively
 * excluding the DB file from iCloud backup on iOS via
 * `NSURLIsExcludedFromBackupKey` — needs a small native module and is not
 * implemented yet; see README "Known gaps".
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const RULES_FILE_NAME = 'solo_plus_us_no_backup_rules.xml';

const RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  基本設計 v0.11 §8.6 (D-07). Excludes the entire app data directory from
  both Android Auto Backup (cloud) and device-to-device transfer. Kept in
  sync with android:allowBackup="false" below — this is belt-and-suspenders
  for Android 12+'s separate D2D transfer path, not a replacement for it.
-->
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" />
    </device-transfer>
</data-extraction-rules>
`;

const withAndroidNoBackupManifest = (config) => {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:allowBackup'] = 'false';
      application.$['android:fullBackupContent'] = 'false';
      application.$['android:dataExtractionRules'] = `@xml/${RULES_FILE_NAME.replace(/\.xml$/, '')}`;
    }
    return config;
  });
};

const withAndroidNoBackupRulesFile = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const xmlDir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(xmlDir, { intermediates: true, recursive: true });
      fs.writeFileSync(path.join(xmlDir, RULES_FILE_NAME), RULES_XML, 'utf-8');
      return config;
    },
  ]);
};

const withAndroidNoBackup = (config) => {
  config = withAndroidNoBackupManifest(config);
  config = withAndroidNoBackupRulesFile(config);
  return config;
};

module.exports = withAndroidNoBackup;
