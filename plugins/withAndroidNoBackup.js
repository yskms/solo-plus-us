/**
 * 基本設計 v0.11 §8.6 (D-07) - excludes the app's data from Android backup
 * and device-to-device transfer.
 *
 * `android:allowBackup="false"` stops cloud backup. But the Android docs say
 * that for apps targeting Android 12+ on some manufacturers' devices it does
 * not stop device-to-device (D2D) transfer. Android 12 introduced
 * `android:dataExtractionRules` to control cloud backup and D2D transfer
 * separately, so the rules below are the part that covers D2D.
 * `android:fullBackupContent="false"` covers Android 11 and lower, where
 * `allowBackup="false"` is enough on its own.
 *
 * Why the rules are listed per domain, and why `root` alone is NOT enough:
 * `root`, `file`, `database`, `sharedpref` and `external` are separate
 * domains. `root` only matches what sits directly in the app's data
 * directory. The framework's backup agent (AOSP `BackupAgent#fullBackup`)
 * puts `files/`, `databases/` and `shared_prefs/` on the traversal exclude
 * list for the `root` pass and handles each of them as its own domain. An
 * `<exclude domain="root" />` therefore leaves out neither the SQLCipher DB
 * (it lives under `Paths.document`, which is `files/` on Android, the `file`
 * domain) nor expo-secure-store's data (`shared_prefs/SecureStore.xml`, the
 * `sharedpref` domain). An earlier version of this file had only `root`, and
 * the DB and the key's SharedPreferences were not excluded from D2D. Do not
 * simplify this back to `root`.
 *
 * The listed domains are the ones Auto Backup includes by default for the
 * credential-protected storage. They are all excluded, not just the two the
 * app uses today, so that a library that starts keeping state somewhere else
 * is not carried to another device silently; nothing in this app needs to be
 * restored by the OS (restoring is done from a JSON backup, D-09). The
 * device-protected `device_*` domains are not listed because the app does not
 * use device-protected storage.
 *
 * expo-secure-store ships its own backup rules (it excludes only the
 * `SecureStore` preferences file). They are not used here: app.json passes
 * `configureAndroidBackup: false` to that plugin, and the rules below cover
 * `sharedpref` as a whole.
 *
 * Why this matters: the DB key is kept by expo-secure-store, encrypted with an
 * Android Keystore key, and Keystore keys are not backed up or transferred. A
 * D2D transfer that carried the encrypted DB (and the key's ciphertext in
 * SharedPreferences) to a new phone would leave a DB nothing can decrypt, which
 * is the state §8.6 exists to prevent.
 *
 * Checked: the generated manifest and rules XML, and the AOSP source for the
 * domain semantics. NOT checked: an actual D2D transfer on a device.
 *
 * This is one half of §8.6 ("検証対象は2つある"). The other half, actively
 * excluding the DB file from iCloud backup on iOS via
 * `NSURLIsExcludedFromBackupKey`, is `modules/backup-exclusion`.
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const RULES_FILE_NAME = 'solo_plus_us_no_backup_rules.xml';

/** Exported for `test/__tests__/androidBackupRules.test.ts`. */
const EXCLUDED_DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external'];

const excludeLines = EXCLUDED_DOMAINS.map((domain) => `        <exclude domain="${domain}" path="." />`).join('\n');

const RULES_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  基本設計 v0.11 §8.6 (D-07). Excludes the app's data from both Android Auto
  Backup (cloud) and device-to-device transfer. The domains are separate, so
  every one of them is listed; "root" alone does not cover files/ or
  shared_prefs/. See plugins/withAndroidNoBackup.js before changing this.
-->
<data-extraction-rules>
    <cloud-backup>
${excludeLines}
    </cloud-backup>
    <device-transfer>
${excludeLines}
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
module.exports.EXCLUDED_DOMAINS = EXCLUDED_DOMAINS;
module.exports.RULES_XML = RULES_XML;
