/**
 * `plugins/withAndroidNoBackup.js` writes the rules XML that keeps the app's
 * data out of Android cloud backup and device-to-device transfer (D-07).
 *
 * The bug this guards against: `<exclude domain="root" />` alone does not
 * exclude `files/` (where the DB lives, `Paths.document`) or `shared_prefs/`
 * (where expo-secure-store keeps the DB key's ciphertext), because the
 * domains are separate. See the comment in the plugin.
 */
const { RULES_XML, EXCLUDED_DOMAINS } = require('../../plugins/withAndroidNoBackup') as {
  RULES_XML: string;
  EXCLUDED_DOMAINS: string[];
};

function section(tag: 'cloud-backup' | 'device-transfer'): string {
  const match = RULES_XML.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!match) throw new Error(`<${tag}> section not found in the rules XML`);
  return match[1];
}

describe('Android backup exclusion rules', () => {
  // The DB is under files/ (file), the SecureStore preferences under shared_prefs/ (sharedpref).
  const REQUIRED_DOMAINS = ['file', 'sharedpref'];

  it.each(['cloud-backup', 'device-transfer'] as const)('%s excludes every domain, including the ones that hold the DB and its key', (tag) => {
    const body = section(tag);
    for (const domain of [...REQUIRED_DOMAINS, ...EXCLUDED_DOMAINS]) {
      expect(body).toContain(`<exclude domain="${domain}" path="." />`);
    }
  });

  it('does not rely on the root domain alone', () => {
    expect(EXCLUDED_DOMAINS.length).toBeGreaterThan(1);
    for (const domain of REQUIRED_DOMAINS) {
      expect(EXCLUDED_DOMAINS).toContain(domain);
    }
  });

  it('has no include rules (an include would invert the default and re-add data)', () => {
    expect(RULES_XML).not.toMatch(/<include\b/);
  });
});
