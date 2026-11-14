/**
 * D-58 - the "last export" record for the Settings screens. Reloads every time
 * the screen regains focus, so coming back from the Export screen shows the
 * date that export just wrote. `state` is `null` until the first read finishes
 * (callers show nothing rather than a wrong "never exported").
 *
 * `reload` is for the Export screen itself: opening the share sheet does not
 * change navigation focus, so it must re-read right after it stamps the export.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useDatabase } from '../contexts/DatabaseContext';
import { loadBackupState, type BackupState } from '../services/BackupStateService';
import { logError } from '../lib/log';

export function useBackupState(): { state: BackupState | null; reload: () => Promise<void> } {
  const db = useDatabase();
  const [state, setState] = useState<BackupState | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const loaded = await loadBackupState(db);
      if (mountedRef.current) setState(loaded);
    } catch (error) {
      logError('loadBackupState failed', error);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { state, reload };
}
