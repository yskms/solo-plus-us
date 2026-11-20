/**
 * `plugins/withAndroidPortraitNotRequired.js` declares
 * `android.hardware.screen.portrait` as NOT required.
 *
 * Why it matters: the app locks the screen to portrait (`app.json` `orientation`),
 * which makes Android imply a REQUIRED portrait feature. Play Console then blocked
 * the 1.0.6 release ("required hardware feature limits distribution"). The
 * explicit `required="false"` is the documented way to switch that off.
 * See the comment in the plugin.
 */
type Manifest = { 'uses-feature'?: Array<{ $?: Record<string, string> }> } & Record<string, unknown>;

const plugin = require('../../plugins/withAndroidPortraitNotRequired') as {
  FEATURE_NAME: string;
  applyPortraitNotRequired: (manifest: Manifest) => Manifest;
};
const appJson = require('../../app.json') as {
  expo: { orientation?: string; plugins: Array<string | [string, Record<string, unknown>?]> };
};

// Written out on purpose, NOT derived from the plugin.
const PORTRAIT = 'android.hardware.screen.portrait';

function portraitEntries(manifest: Manifest) {
  return (manifest['uses-feature'] ?? []).filter((entry) => entry.$?.['android:name'] === PORTRAIT);
}

describe('applyPortraitNotRequired', () => {
  it('declares the portrait feature with required="false"', () => {
    const manifest = plugin.applyPortraitNotRequired({});
    expect(portraitEntries(manifest)).toEqual([{ $: { 'android:name': PORTRAIT, 'android:required': 'false' } }]);
  });

  it('keeps other uses-feature entries', () => {
    const manifest = plugin.applyPortraitNotRequired({
      'uses-feature': [{ $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } }],
    });
    expect(manifest['uses-feature']).toHaveLength(2);
    expect(manifest['uses-feature']?.[0].$?.['android:name']).toBe('android.hardware.camera');
  });

  it('is idempotent (a second run does not stack another declaration)', () => {
    const once = plugin.applyPortraitNotRequired({});
    const twice = plugin.applyPortraitNotRequired(once);
    expect(portraitEntries(twice)).toHaveLength(1);
  });

  it('turns an existing required="true" declaration into false', () => {
    const manifest = plugin.applyPortraitNotRequired({
      'uses-feature': [{ $: { 'android:name': PORTRAIT, 'android:required': 'true' } }],
    });
    expect(portraitEntries(manifest)).toEqual([{ $: { 'android:name': PORTRAIT, 'android:required': 'false' } }]);
  });

  it('uses the feature name Play reported', () => {
    expect(plugin.FEATURE_NAME).toBe(PORTRAIT);
  });
});

describe('app.json', () => {
  it('registers the plugin', () => {
    expect(appJson.expo.plugins).toContain('./plugins/withAndroidPortraitNotRequired.js');
  });

  it('still locks the app to portrait (the plugin must not be a reason to drop the lock)', () => {
    expect(appJson.expo.orientation).toBe('portrait');
  });
});
