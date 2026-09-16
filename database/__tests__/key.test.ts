/**
 * §8.5/D-06: whether the DB file already exists must change what a
 * missing key means. Runs against jest-expo's SecureStore mock, which
 * always resolves `getItemAsync` to `undefined` (no persisted storage) —
 * that's exactly the "key unreadable" condition this is testing.
 */
import { getOrCreateDatabaseKey } from '../key';
import { DatabaseKeyUnavailableError } from '../../lib/errors';

describe('getOrCreateDatabaseKey', () => {
  it('generates a new key when no DB file exists yet (genuine first launch)', async () => {
    const key = await getOrCreateDatabaseKey(false);
    expect(key).toMatch(/^[0-9a-f]{64}$/); // 32 bytes, hex-encoded
  });

  it('throws DatabaseKeyUnavailableError — never silently generates a replacement — when the DB file exists but no key is readable', async () => {
    await expect(getOrCreateDatabaseKey(true)).rejects.toThrow(DatabaseKeyUnavailableError);
  });
});
