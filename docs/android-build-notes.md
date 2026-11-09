# Android のネイティブビルド・リリース・R8 の詳細

- 読むタイミング: ネイティブモジュールを追加した／初めて import したとき、Android のリリースビルド（`eas build --local`）と AAB の確認、R8 の設定や検証、AGP/RN/Expo の更新、ダーク/ライト切替や遷移中の帯を触るとき、`expo prebuild --clean` を実行しようとするとき
- 元の場所: `CLAUDE.md` の「package.json にあるのに未リンクなネイティブモジュール（Gradle デーモンのキャッシュ）」「Android のダーク/ライト切替まわりの落とし穴」「Android リリースビルド（`eas build --local`）の注意」「Android R8（難読化・最適化・縮小）」の4節（最後の節の見出しは、後ろに「`plugins/withAndroidR8.js` は外さない・簡略化しない」と続く）（2026-11-03 に移動）。区切り線より下は原文のまま。ただし、各節が兄弟の節になるよう、見出しの `#` の数だけそろえた（見出しの文言は変えていない）
- 注記（参照元）: `docs/health-connect-dev-notes.md` の「リリースビルド分離」の節が「本ファイル…の節」として参照しているのは、この文書の最初の節（package.json にあるのに未リンクなネイティブモジュール）
- 注記（追加した節）: 末尾の「`expo prebuild --clean` の影響と、実行前の確認」は、2026-11-04 に新しく書いた節で、CLAUDE.md からの移動ではない（CLAUDE.md には載せていない）
- 注記（EAS の実行許可）: 「Android リリースビルド」の節の `eas build --local` の手順は、実行が許可されたあとの手順。実行許可の基準は `CLAUDE.md` の「ローカル iOS ビルドは M4 MacBook Air 移行後にブロック解除済み」の節の「EAS の実行許可」に従う

---

## package.json にあるのに未リンクなネイティブモジュール（Gradle デーモンのキャッシュ）

`expo-application`/`expo-constants` は Phase 1 から `package.json` の
dependencies にあったが、実際には一度もネイティブ側でリンクされておらず、
2026-09-21（Settings > Version 表示で `expo-application` を初めて使おうと
した際）まで気づかれていなかった。`npx expo-modules-autolinking resolve -p
android --json` を直接実行すると両方とも解決対象に含まれるのに、Android の
通常のネイティブビルド（`expo run:android`・`./gradlew installDebug`）を
何度実行しても効果が無かった。

**原因は Gradle デーモンの再利用**：`expo-modules-autolinking` の解決結果は
Gradle の settings 評価フェーズでキャッシュされる。デーモンが起動したまま
だと、依存関係の解決結果が古いまま使い回されることがある（今回は長時間
（2日以上）起動しっぱなしだった `expo run:android` プロセスが影響していた
可能性が高い）。

**新しいネイティブモジュール（native code を持つ Expo モジュール）を
package.json に追加した／既存の未使用モジュールを初めて import した際、
通常のビルドで一見成功していてもリンクされていないことがある。** 疑わしい
場合は、ビルド前に一度 `cd android && ./gradlew --stop` で Gradle デーモンを
止めてから再ビルドすること。`android/build/generated/autolinking/
autolinking.json`（React Native コミュニティ側の legacy autolinking 設定）
は Expo モジュールのリンク状況の確認には使えない——別物なので確認先を
間違えないこと。確実な確認方法は、対象モジュールの値だけが変わる形で
JS 側のフォールバック値と native 側の値を意図的に食い違わせ（例：
`app.json` の `version` を一時的に別の値へ変更して JS だけリロードし、
native から読んだ値が変わらないことを見る）、実際に native 経由で
読めているかを実機で確認すること——見た目の値が同じだと「動いているように
見えるだけ」で気づけない。

## Android のダーク/ライト切替まわりの落とし穴

画面遷移中に一瞬見える帯や、テーマ切替の反映漏れは `contentStyle`（React Navigation
の各画面コンテナ）や `useColorScheme()` のオーバーライドだけでは直らないことがある。
原因はそれより下のネイティブ層（`android:windowBackground`、`AppCompatDelegate` の
Day/Night モード、ステータスバー）にあることが多く、`values-night/colors.xml` や
`Appearance.setColorScheme()`、`expo-system-ui` での対応が必要になる。色の定数は
`constants/theme.ts`・`plugins/withAndroidNightColors.js`・`app.json` の3箇所に
手動同期が必要（自動参照する手段が無い）。詳細と発見の経緯は README「Phase 3
実装状況 > Appearance」参照。

## Android リリースビルド（`eas build --local`）の注意

- **`versionCode` は手で上げない。** `eas.json` の `production` は
  `autoIncrement: true` で、ビルド時に `app.json` の `android.versionCode` を
  +1 する（ログに `Bumping expo.android.versionCode from N to N+1`）。手で
  上げてからビルドすると二重に上がる（1.0.1 で 4 → 5 になった実例）。ビルド後に
  `app.json` の差分をコミットして AAB と揃える。iOS の `buildNumber` は別管理。
- **`eas` は PATH に無い。** `npx --yes eas-cli@25.3.0 build --local …`（npx
  キャッシュにある版）で実行する。`--output` で出力先を指定する。
- **AAB の中身の確認（bundletool が無いとき）：** `aapt2` は AAB を直接読めない。
  AAB を unzip し、`base/` の `AndroidManifest.xml`（`manifest/` から出す）・
  `resources.pb`・`res/` だけを zip し直して `aapt2 convert --output-format
  binary` → `aapt2 dump badging` で versionCode・versionName・権限を見る
  （`~/Library/Android/sdk/build-tools/*/aapt2`）。健康データ権限
  （`android.permission.health.*`）が無いことを毎回確認する。
- ビルドログの `expo doctor` の「Patch version mismatches」は警告で、ビルドは
  止まらず成功する（既存の状態）。

## Android R8（難読化・最適化・縮小）——`plugins/withAndroidR8.js` は外さない・簡略化しない

2027年2月から、Google Play は DEX が 10MB 超のアプリに難読化・最適化・縮小の各率 25% 以上を
求める。Expo/RN のテンプレートは R8 を使わず、このアプリの DEX は約 46MB（1.0.1）。plugin で
R8 を有効にすると約 9.9MB（各率 80% 台）。実測・確認した範囲は README「Android R8 の有効化」。
各設定が必要な理由は plugin 冒頭のコメントにある。簡略化したくなるが外さないもの：

- **`proguard-android-optimize.txt` への置き換えと `plugins/android-r8-rules.pro`（Expo の注釈
  インターフェースの keep）はセット。** 最適化を有効にして keep を外すと、Expo の Record 変換が
  R8 に壊され、**リリースビルドだけ**で起動直後にネイティブ関数が `NullPointerException` になる
  （debug・`tsc`・`jest` では出ない）。`-dontoptimize` へ戻して済ませない（最適化率が出ない）。
  keep を `Field`・`Required` の2つに絞らない
- **AGP は plugin が 8.12.3（8.12 系の最新パッチ）に指定している。** Play が `r8.json` から率を読むのは
  「AGP 8.10 以降の最新パッチ」のときだけで、RN 固定の 8.12.0 のままだと最適化率・縮小率が `-` になる。
  RN・Expo の更新で AGP が変わったときや 8.12.4 以降が出たときは `AGP_VERSION` を見直す
- **`shrinkResources` は無効のまま。** 要件は DEX の率だけ。JS から `require()` した画像はリリースで
  名前引きされ、リソース縮小に消される恐れがある（今は画像の `require()` が無いが、足したとき用の予防）
- `org.gradle.jvmargs` の 4GB 指定を戻さない（minify で AAB に約 100MB の対応表 `proguard.map`
  が入り、2GB だと AAB のバンドルが `Java heap space` で落ちうる）
- **R8 の不具合はリリースの実行時にしか出ない。** Expo・RN・ライブラリ・plugin を更新したら、R8 入りの
  release APK（arm64・debug 署名でよい。`cd android && nice -n 10 ./gradlew assembleRelease
  -PreactNativeArchitectures=arm64-v8a`）をエミュレータへ新規インストールし、オンボーディング→記録→
  App Lock→書き出し・読み込みまで動かして、logcat の `FATAL EXCEPTION`・`has been rejected` を探す。
  `with-health-connect` ビルドは HC 経由の動作も確認する（2026-11-09 に確認済み。環境変数
  `EXPO_PUBLIC_HEALTH_CONNECT_ENABLED=1` を `expo prebuild` と `./gradlew assembleRelease` の両方に付ける。
  結果と、確認しなかった範囲は `docs/health-connect-release.md`）
- DEX は 10MB に近い（9.86MB）。依存を足して 10MB を超えると、率（各 25% 以上）が要件の対象になる

## `expo prebuild --clean` の影響と、実行前の確認

`android/` と `ios/` は `expo prebuild` の生成物で、どちらも gitignore 対象（`.gitignore` の `/android`・`/ios`）。`npm run prebuild` は `--clean` なしの `expo prebuild`。`--clean` を付けると、既存の `android/` と `ios/` を削除してから、`app.json`・`app.config.js`・`plugins/*.js` とテンプレートで作り直す（`--platform` で片方だけにもできる）。

- **端末に入っているアプリやそのデータには影響しない。** 影響するのは、この Mac のディスク上の生成物だけ
- **gitignore 対象なので、削除したものは git から戻せない。** 生成物に直接加えた変更や、手で置いたファイルは失われる。このプロジェクトでは、修正を `plugins/*.js`・`app.json` 側に入れる方針（`ios/` を直接編集しても次の prebuild で消える）。2026-11-04 に調べた範囲では、`android/`・`ios/` に、再生成できないファイル（`local.properties`、`google-services.json`、リリース用の keystore や証明書、`credentials.json`、`xcuserdata`）は無かった。ただし、生成ファイルの中の細かい手編集までは、この確認では分からない
- **ビルドキャッシュが全部消え、次のビルドはフルリビルドになる**（`android/.gradle`・`android/build`・`android/app/build`・`.cxx`、`ios/Pods`・`ios/build`）。ファンレス機の発熱と CPU 負荷が大きい。Android のビルドには `nice -n 10` を付ける。`ios/Podfile.lock` も消えるため、Pod のバージョンが再解決されて変わりうる（`pod install` にネットワークが要る）
- `android/app/debug.keystore` はテンプレートから再生成される。SHA1 は `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` で、React Native テンプレート標準の debug 鍵として知られる値と一致した（2026-11-04）。再生成されても署名は変わらず、debug 署名で入れてある端末に `adb install -r` で上書きできる。リリース署名（EAS・Play）は `android/` の外にある
- `android/gradle.properties` も再生成される。Gradle の並列数の制限は `~/.gradle/gradle.properties` にあるため、失われない（グローバルの CLAUDE.md）

実行前の確認：

1. `--clean` が本当に必要か。plugin や `app.json` の変更を反映したいだけなら、まず `--clean` なしの `npm run prebuild` を試す
2. `android/`・`ios/` に、手で入れた変更や置いたファイルが無いか。疑わしいときは、先に `android/`・`ios/` を別の場所へコピーしておき、実行後に差分を取る
3. ほかのビルド（`./gradlew`・`xcodebuild`）が動いていないか
4. 実行後はフルリビルドになる。時間と発熱を見込む
