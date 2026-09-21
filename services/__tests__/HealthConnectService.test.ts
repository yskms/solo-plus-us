/**
 * `react-native-health-connect` はネイティブモジュールなので、実際の呼び出しが
 * 本物の Health Connect とどう振る舞うかはここでは検証できない（Pixel 3 実機
 * 検証は README「Phase 4」参照）。ここで検証するのはこのファイル自身の
 * 変換・分岐（§9.4/§9.9 のレコード組み立て、§9.7 の resolve/reject の
 * 単純な扱い、`ExceptionsUtils.kt` の code 一覧に基づくエラー分類、
 * recreate の「delete 失敗なら insert しない」）だけ。
 */
const mockInitialize = jest.fn();
const mockGetSdkStatus = jest.fn();
const mockRequestPermission = jest.fn();
const mockGetGrantedPermissions = jest.fn();
const mockInsertRecords = jest.fn();
const mockDeleteRecordsByUuids = jest.fn();

jest.mock('react-native-health-connect', () => ({
  initialize: (...args: unknown[]) => mockInitialize(...args),
  getSdkStatus: (...args: unknown[]) => mockGetSdkStatus(...args),
  requestPermission: (...args: unknown[]) => mockRequestPermission(...args),
  getGrantedPermissions: (...args: unknown[]) => mockGetGrantedPermissions(...args),
  insertRecords: (...args: unknown[]) => mockInsertRecords(...args),
  deleteRecordsByUuids: (...args: unknown[]) => mockDeleteRecordsByUuids(...args),
  // 実際の定数値（node_modules/react-native-health-connect/lib/typescript/constants.d.ts で確認済み）。
  SdkAvailabilityStatus: { SDK_UNAVAILABLE: 1, SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2, SDK_AVAILABLE: 3 },
  ProtectionUsed: { UNKNOWN: 0, PROTECTED: 1, UNPROTECTED: 2 },
}));

import * as HealthConnectService from '../HealthConnectService';

const activity = {
  id: 'activity-1',
  occurredAtUtc: '2026-09-14T14:42:00Z',
  protectionUsed: true as boolean | null,
  syncVersion: 3,
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe('isAvailable', () => {
  it('is true only for SDK_AVAILABLE (3)', async () => {
    mockGetSdkStatus.mockResolvedValue(3);
    expect(await HealthConnectService.isAvailable()).toBe(true);
  });

  it('is false for SDK_UNAVAILABLE / provider-update-required', async () => {
    mockGetSdkStatus.mockResolvedValue(1);
    expect(await HealthConnectService.isAvailable()).toBe(false);
    mockGetSdkStatus.mockResolvedValue(2);
    expect(await HealthConnectService.isAvailable()).toBe(false);
  });
});

describe('requestWritePermission', () => {
  it('requests only WRITE SexualActivity — never READ (D-20/§9.7/D-12)', async () => {
    mockRequestPermission.mockResolvedValue([]);
    await HealthConnectService.requestWritePermission();
    expect(mockRequestPermission).toHaveBeenCalledWith([{ accessType: 'write', recordType: 'SexualActivity' }]);
  });

  it('is true when the write permission comes back granted', async () => {
    mockRequestPermission.mockResolvedValue([{ accessType: 'write', recordType: 'SexualActivity' }]);
    expect(await HealthConnectService.requestWritePermission()).toBe(true);
  });

  it('is false when the granted list does not include it (declined)', async () => {
    mockRequestPermission.mockResolvedValue([]);
    expect(await HealthConnectService.requestWritePermission()).toBe(false);
  });
});

describe('hasWritePermission (Settings §18 の接続ステータス表示用)', () => {
  it('does not show a dialog — reads getGrantedPermissions, not requestPermission', async () => {
    mockGetGrantedPermissions.mockResolvedValue([{ accessType: 'write', recordType: 'SexualActivity' }]);
    await HealthConnectService.hasWritePermission();
    expect(mockGetGrantedPermissions).toHaveBeenCalled();
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('is true when the write permission is currently granted', async () => {
    mockGetGrantedPermissions.mockResolvedValue([{ accessType: 'write', recordType: 'SexualActivity' }]);
    expect(await HealthConnectService.hasWritePermission()).toBe(true);
  });

  it('is false once the OS-side permission has been revoked (§9.5.4)', async () => {
    mockGetGrantedPermissions.mockResolvedValue([]);
    expect(await HealthConnectService.hasWritePermission()).toBe(false);
  });
});

describe('upsertActivity', () => {
  it('sends only time + protectionUsed + clientRecordId/Version (§9.4/§9.9) — no context/outcome/mood/note', async () => {
    mockInsertRecords.mockResolvedValue(['native-uuid']);
    const result = await HealthConnectService.upsertActivity(activity);

    expect(mockInsertRecords).toHaveBeenCalledWith([
      {
        recordType: 'SexualActivity',
        time: '2026-09-14T14:42:00Z',
        protectionUsed: 1, // PROTECTED
        metadata: { clientRecordId: 'activity-1', clientRecordVersion: 3 },
      },
    ]);
    // health_connect addresses by clientRecordId, so external_record_id stays null (§5.4).
    expect(result).toEqual({ ok: true, externalRecordId: null });
  });

  it.each<[boolean | null, number]>([
    [true, 1], // PROTECTED
    [false, 2], // UNPROTECTED
    [null, 0], // UNKNOWN — "not recorded" must not collapse into UNPROTECTED (§5.3/§9.9)
  ])('maps protectionUsed %s to Health Connect value %i', async (protectionUsed, expected) => {
    mockInsertRecords.mockResolvedValue([]);
    await HealthConnectService.upsertActivity({ ...activity, protectionUsed });
    expect(mockInsertRecords).toHaveBeenCalledWith([expect.objectContaining({ protectionUsed: expected })]);
  });

  it.each<[string, string]>([
    ['PERMISSION_ERROR', 'PERMISSION_DENIED'],
    ['SERVICE_UNAVAILABLE', 'UNAVAILABLE'],
    ['SDK_VERSION_ERROR', 'UNAVAILABLE'],
    ['CLIENT_NOT_INITIALIZED', 'UNAVAILABLE'],
    ['ARGUMENT_VALIDATION_ERROR', 'UNKNOWN'],
    ['IO_EXCEPTION', 'UNKNOWN'],
    ['UNDERLYING_ERROR', 'UNKNOWN'],
    ['SOME_FUTURE_CODE_NOT_YET_MAPPED', 'UNKNOWN'],
  ])('classifies native rejection code %s as %s (ExceptionsUtils.kt mapping)', async (nativeCode, expected) => {
    const error = Object.assign(new Error('boom'), { code: nativeCode });
    mockInsertRecords.mockRejectedValue(error);
    const result = await HealthConnectService.upsertActivity(activity);
    expect(result).toEqual({ ok: false, errorCode: expected });
  });

  it('classifies a rejection with no .code as UNKNOWN (safe default, still retried)', async () => {
    mockInsertRecords.mockRejectedValue(new Error('no code here'));
    const result = await HealthConnectService.upsertActivity(activity);
    expect(result).toEqual({ ok: false, errorCode: 'UNKNOWN' });
  });
});

describe('deleteActivityRecord', () => {
  it('addresses by clientRecordId (= activityId), not a native record UUID (§9.4)', async () => {
    mockDeleteRecordsByUuids.mockResolvedValue(undefined);
    const result = await HealthConnectService.deleteActivityRecord('activity-1');
    expect(mockDeleteRecordsByUuids).toHaveBeenCalledWith('SexualActivity', [], ['activity-1']);
    expect(result).toEqual({ ok: true, externalRecordId: null });
  });

  it('does not special-case a "not found" rejection — any reject is just a failure to retry (§9.7 confirmed result)', async () => {
    mockDeleteRecordsByUuids.mockRejectedValue(Object.assign(new Error('not found'), { code: 'UNDERLYING_ERROR' }));
    const result = await HealthConnectService.deleteActivityRecord('activity-1');
    expect(result).toEqual({ ok: false, errorCode: 'UNKNOWN' });
  });
});

describe('recreateActivity (§9.3.1)', () => {
  it('deletes by clientRecordId then inserts with the current sync_version on success', async () => {
    mockDeleteRecordsByUuids.mockResolvedValue(undefined);
    mockInsertRecords.mockResolvedValue(['native-uuid']);

    const result = await HealthConnectService.recreateActivity(activity);

    expect(mockDeleteRecordsByUuids).toHaveBeenCalledWith('SexualActivity', [], ['activity-1']);
    expect(mockInsertRecords).toHaveBeenCalledWith([expect.objectContaining({ recordType: 'SexualActivity' })]);
    expect(result).toEqual({ ok: true, externalRecordId: null });
  });

  it('does NOT insert when the delete step fails — "delete がそれ以外のエラーなら作成しない" (§9.3.1)', async () => {
    mockDeleteRecordsByUuids.mockRejectedValue(Object.assign(new Error('boom'), { code: 'SERVICE_UNAVAILABLE' }));

    const result = await HealthConnectService.recreateActivity(activity);

    expect(mockInsertRecords).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, errorCode: 'UNAVAILABLE' });
  });

  it('does not persist a "delete done" substate — a retried recreate always starts from delete again (§9.3.1)', async () => {
    mockDeleteRecordsByUuids.mockResolvedValue(undefined);
    mockInsertRecords.mockResolvedValue([]);

    await HealthConnectService.recreateActivity(activity);
    await HealthConnectService.recreateActivity(activity); // simulates a retry after e.g. insert failed previously

    expect(mockDeleteRecordsByUuids).toHaveBeenCalledTimes(2);
  });
});
