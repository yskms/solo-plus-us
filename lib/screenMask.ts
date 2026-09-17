/**
 * 基本設計 §18「画面マスク」／要件定義書 §21 Discreet Mode「Recent Apps 画面
 * のマスク」（v1.0 必須、●）— OS の Recent Apps／App Switcher が撮る
 * スナップショットに、この端末の記録内容を映さない。
 *
 * Always on, not a user preference — this sits at the same tier as §8 の
 * DB 暗号化・§8.6 のバックアップ除外（OS レベルの露出を防ぐ、判断の余地のない
 * 保護）であって、App Lock 自体の enabled/disabled のような端末所有者の
 * 好みの設定ではない。`app/settings/hide-app-preview.tsx` に、この前提で
 * 「常時オン」を伝える情報のみの画面を用意している。
 *
 * `preventScreenCaptureAsync()`（両 OS）：スクリーンショット・画面収録を
 * ブロックする。Android では**これ単体で** Recent Apps のサムネイルも
 * 空白化される（`FLAG_SECURE`）——要求されているのは「バックグラウンド
 * 移行時のマスク」だが、この API はスクリーンショット自体も併せてブロックし、
 * 両者を分離する設定は無い。この副次的な保護は害ではなく意図どおりとして
 * 受け入れる（README 参照）。
 *
 * `enableAppSwitcherProtectionAsync()`（iOS のみ）：iOS には `FLAG_SECURE`
 * 相当が無いため、App Switcher・バックグラウンド・割り込み（着信・Siri・
 * コントロールセンター等）でネイティブ側がぼかしオーバーレイを出す。
 * このアプリの View 階層で `AppState` を監視して自前でオーバーレイを
 * 描画する必要はない——`contexts/AppLock.tsx` が `inactive` を意図的に
 * 無視しているのと対照的に、この保護自体はネイティブ実装が `inactive` 相当の
 * 遷移を検知して処理する。
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { logError } from './log';

export function useScreenMask(): void {
  useEffect(() => {
    ScreenCapture.preventScreenCaptureAsync().catch((error) => logError('preventScreenCaptureAsync failed', error));
    if (Platform.OS === 'ios') {
      ScreenCapture.enableAppSwitcherProtectionAsync().catch((error) =>
        logError('enableAppSwitcherProtectionAsync failed', error),
      );
    }
  }, []);
}
