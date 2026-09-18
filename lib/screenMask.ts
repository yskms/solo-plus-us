/**
 * 基本設計 §18「画面マスク」／要件定義書 §21 Discreet Mode「Recent Apps 画面
 * のマスク」（v1.0 必須、●）— OS の Recent Apps／App Switcher が撮る
 * スナップショットに、この端末の記録内容を映さない。
 *
 * Always on, not a user preference（設計判断記録 D-47）——この保護は §8 の
 * DB 暗号化・§8.6 のバックアップ除外と同じ「OS レベルの露出を防ぐ、判断の
 * 余地のない保護」の階層に属し、App Lock 自体の enabled/disabled のような
 * 端末所有者の好みの設定ではない。`app/settings/hide-app-preview.tsx` に
 * この前提で「常時オン」を伝える画面を用意しているが、下記の理由で結果を
 * 確認してから表示する。
 *
 * `preventScreenCaptureAsync()`（両 OS）：スクリーンショット・画面収録を
 * ブロックする。Android では**これ単体で** Recent Apps のサムネイルも
 * 空白化される（`FLAG_SECURE`、Android では分離できない副作用）。iOS では
 * App Switcher のマスク自体は `enableAppSwitcherProtectionAsync()` だけで
 * 成立するため、iOS でもこれを呼んでスクリーンショット・画面収録をブロック
 * するのは分離できない副作用ではなく**独立した選択**——設計判断記録 D-47 に
 * 理由を記録済み。
 *
 * `enableAppSwitcherProtectionAsync()`（iOS のみ）：iOS には `FLAG_SECURE`
 * 相当が無いため、App Switcher・バックグラウンド・割り込み（着信・Siri・
 * コントロールセンター等）でネイティブ側がぼかしオーバーレイを出す。
 * このアプリの View 階層で `AppState` を監視して自前でオーバーレイを
 * 描画する必要はない——`contexts/AppLock.tsx` が `inactive` を意図的に
 * 無視しているのと対照的に、この保護自体はネイティブ実装が `inactive` 相当の
 * 遷移を検知して処理する。`blurIntensity` は既定の 0.5 ではなく明示的に
 * `1.0`（最大）を渡す——隠したいのは "THIS MONTH 12" や "Sep 14 Solo" の
 * ような短い文字列で、中程度のぼかしでは判読できてしまう可能性がある。
 *
 * 成功したかどうかを呼び出し側が確認せず「常時オン」と断言していた
 * バグの修正：`isAvailableAsync()` が false の端末、iOS 12 以前（画面収録の
 * みブロック）・13 未満（スクリーンショットはブロックされない、型定義の
 * 注記のとおり）、または `preventScreenCaptureAsync`/
 * `enableAppSwitcherProtectionAsync` 自体が reject した場合、実際には
 * 保護が成立していないことがある。`attemptScreenMask()` は実際に確認できた
 * ことだけを結果として返す——設定画面はこれを呼んで結果を表示し、確認して
 * いない事実を保証として書かない。
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { logError } from './log';

const APP_SWITCHER_BLUR_INTENSITY = 1.0;

export type ScreenMaskResult = { active: true } | { active: false; reason: string };

export async function attemptScreenMask(): Promise<ScreenMaskResult> {
  let available: boolean;
  try {
    available = await ScreenCapture.isAvailableAsync();
  } catch (error) {
    logError('ScreenCapture.isAvailableAsync failed', error);
    return { active: false, reason: 'Could not check screen capture support on this device.' };
  }
  if (!available) {
    return { active: false, reason: 'This protection is not available on this device.' };
  }

  try {
    await ScreenCapture.preventScreenCaptureAsync();
  } catch (error) {
    logError('preventScreenCaptureAsync failed', error);
    return { active: false, reason: 'Could not block screenshots and screen recording on this device.' };
  }

  if (Platform.OS === 'ios') {
    try {
      await ScreenCapture.enableAppSwitcherProtectionAsync(APP_SWITCHER_BLUR_INTENSITY);
    } catch (error) {
      logError('enableAppSwitcherProtectionAsync failed', error);
      return { active: false, reason: 'Could not blur the app switcher preview on this device.' };
    }
  }

  return { active: true };
}

/** Fire-and-forget setup at app startup — see `attemptScreenMask` for the version that reports its own result, used by the settings screen. */
export function useScreenMask(): void {
  useEffect(() => {
    attemptScreenMask();
  }, []);
}
