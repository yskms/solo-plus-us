/**
 * 基本設計 v0.11 §8.6 (D-07) - excludes the app's data from Android backup
 * and device-to-device transfer.
 *
 * `android:allowBackup="false"` stops cloud backup, but it does NOT stop
 * device-to-device (D2D) transfer on Android 12+. AOSP's
 * `BackupEligibilityRules#isAppBackupAllowed` returns true for a non-system
 * app during D2D whenever the compat change `IGNORE_ALLOW_BACKUP_IN_D2D` is
 * enabled, whatever `allowBackup` says, and that change is enabled by default
 * for apps whose targetSdk is 31 (Android 12) or higher. This app targets 36.
 * (Checked in the android-12.0.0_r1, -13, -14 and -15 tags and in main. The
 * change is `@Overridable`, so a manufacturer could differ; the Android docs
 * word this as "some manufacturers' devices".) Android 12 introduced
 * `android:dataExtractionRules` to control cloud backup and D2D transfer
 * separately, so the rules below are what actually stops D2D.
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
 * The listed domains are all the ones Auto Backup includes by default: the
 * credential-protected storage (`root`, `file`, `database`, `sharedpref`,
 * `external`) and the device-protected storage (`device_root`, `device_file`,
 * `device_database`, `device_sharedpref`). `BackupAgent#fullBackup` walks both
 * with the same rules. They are all excluded, not just the two the app uses
 * today (`file` and `sharedpref`), so that a library that starts keeping state
 * somewhere else, device-protected storage included, is not carried to another
 * device silently; nothing in this app needs to be restored by the OS
 * (restoring is done from a JSON backup, D-09). An earlier revision left the
 * `device_*` domains out because the app does not use device-protected
 * storage, which contradicted this reasoning.
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
 * domain semantics and the `allowBackup` handling in D2D. The lint detector
 * for these rules (`FullBackupContentDetector`, severity FATAL) accepts
 * `path="."` and no `<include>` by its source, but lint itself has not been
 * run on this project. NOT checked: an actual D2D transfer on a device.
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
const EXCLUDED_DOMAINS = [
  'root',
  'file',
  'database',
  'sharedpref',
  'external',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
];

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

/**
 * Sets the three backup attributes on the `<application>` element's attribute
 * map. Split out from the mod so that `test/__tests__/androidBackupRules.test.ts`
 * can check it without running Expo's mod pipeline.
 */
const applyNoBackupAttributes = (applicationAttributes) => {
  applicationAttributes['android:allowBackup'] = 'false';
  applicationAttributes['android:fullBackupContent'] = 'false';
  applicationAttributes['android:dataExtractionRules'] = `@xml/${RULES_FILE_NAME.replace(/\.xml$/, '')}`;
  return applicationAttributes;
};

const withAndroidNoBackupManifest = (config) => {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      applyNoBackupAttributes(application.$);
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
module.exports.RULES_FILE_NAME = RULES_FILE_NAME;
module.exports.applyNoBackupAttributes = applyNoBackupAttributes;
