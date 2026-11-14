/**
 * `plugins/withAndroidNoBackup.js` keeps the app's data out of Android cloud
 * backup and device-to-device (D2D) transfer (D-07).
 *
 * Two things this guards against:
 *
 * 1. `<exclude domain="root" />` alone does not exclude `files/` (where the DB
 *    lives, `Paths.document`) or `shared_prefs/` (where expo-secure-store keeps
 *    the DB key's ciphertext), because the domains are separate.
 * 2. On Android 12+ the OS ignores `android:allowBackup="false"` during D2D
 *    (AOSP `IGNORE_ALLOW_BACKUP_IN_D2D`), so the manifest must keep pointing at
 *    the rules file. If the attribute is dropped, the rules are never read.
 *
 * See the comment in the plugin.
 */
const plugin = require('../../plugins/withAndroidNoBackup') as {
  RULES_XML: string;
  EXCLUDED_DOMAINS: string[];
  RULES_FILE_NAME: string;
  applyNoBackupAttributes: (attributes: Record<string, string>) => Record<string, string>;
};
const appJson = require('../../app.json') as {
  expo: { plugins: Array<string | [string, Record<string, unknown>?]> };
};

// Written out on purpose, NOT derived from the plugin: a test that compares the
// plugin with its own list passes when a domain is removed from that list.
const REQUIRED_DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external'];

function section(tag: 'cloud-backup' | 'device-transfer'): string {
  const match = plugin.RULES_XML.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!match) throw new Error(`<${tag}> section not found in the rules XML`);
  return match[1];
}

describe('Android backup exclusion rules (XML)', () => {
  it.each(['cloud-backup', 'device-transfer'] as const)('%s excludes all five domains, including file (DB) and sharedpref (SecureStore)', (tag) => {
    const body = section(tag);
    for (const domain of REQUIRED_DOMAINS) {
      expect(body).toContain(`<exclude domain="${domain}" path="." />`);
    }
  });

  it('lists every required domain in EXCLUDED_DOMAINS (the source of the XML)', () => {
    expect([...plugin.EXCLUDED_DOMAINS].sort()).toEqual([...REQUIRED_DOMAINS].sort());
  });

  it('has no include rules (an include would invert the default and re-add data)', () => {
    expect(plugin.RULES_XML).not.toMatch(/<include\b/);
  });
});

describe('Android backup exclusion rules (manifest attributes)', () => {
  it('sets allowBackup, fullBackupContent and dataExtractionRules', () => {
    const attributes = plugin.applyNoBackupAttributes({ 'android:name': '.MainApplication' });
    expect(attributes['android:allowBackup']).toBe('false');
    expect(attributes['android:fullBackupContent']).toBe('false');
    expect(attributes['android:dataExtractionRules']).toBe('@xml/solo_plus_us_no_backup_rules');
    // Other attributes are left alone.
    expect(attributes['android:name']).toBe('.MainApplication');
  });

  it('points dataExtractionRules at the file the plugin writes', () => {
    const attributes = plugin.applyNoBackupAttributes({});
    expect(plugin.RULES_FILE_NAME).toBe('solo_plus_us_no_backup_rules.xml');
    expect(attributes['android:dataExtractionRules']).toBe(`@xml/${plugin.RULES_FILE_NAME.replace(/\.xml$/, '')}`);
  });

  // This only covers our own function. It does NOT cover a plugin whose mod runs
  // after ours: Expo runs mods in reverse registration order, so expo-secure-store
  // (registered earlier in app.json) runs AFTER this plugin. What keeps it from
  // changing the result is its own design (with `configureAndroidBackup: false` it
  // only removes attributes equal to its own rule paths; with `true` it refuses to
  // overwrite other values) plus the app.json test below. The final guarantee is
  // the merged-manifest check in docs/android-build-notes.md.
  it('replaces values that are already on the element', () => {
    const attributes = plugin.applyNoBackupAttributes({
      'android:allowBackup': 'true',
      'android:fullBackupContent': '@xml/other_plugin_backup_rules',
      'android:dataExtractionRules': '@xml/other_plugin_extraction_rules',
    });
    expect(attributes['android:allowBackup']).toBe('false');
    expect(attributes['android:fullBackupContent']).toBe('false');
    expect(attributes['android:dataExtractionRules']).toBe('@xml/solo_plus_us_no_backup_rules');
  });
});

describe('app.json plugin registration', () => {
  const entries = appJson.expo.plugins;

  it('registers the no-backup plugin', () => {
    expect(entries).toContain('./plugins/withAndroidNoBackup.js');
  });

  it('passes configureAndroidBackup: false to expo-secure-store (the app replaces its backup rules)', () => {
    const entry = entries.find((e) => Array.isArray(e) && e[0] === 'expo-secure-store');
    expect(entry).toBeDefined();
    expect((entry as [string, Record<string, unknown>])[1]).toMatchObject({ configureAndroidBackup: false });
  });
});
