# Health Connect まわりの経緯と詳細（排他制御・iOS の Proxy・ビルド分離）

- 読むタイミング: Health Connect の同期（`SyncWorker`/`SyncCoordinator`/`SyncWorkerLoop`）、切断・全削除・置換復元などの破壊的操作、Settings > Health Connect 画面、`without-health-connect`/`with-health-connect` のビルド分離、`EXPO_PUBLIC_*` の扱いを触るとき
- 元の場所: `CLAUDE.md` の「Health Connect 同期の排他制御（`SyncWorker`/`SyncCoordinator`/`SyncWorkerLoop`）」「`react-native-health-connect` は iOS で「呼ぶと必ず throw する Proxy」」「リリースビルド分離（`without-health-connect`/`with-health-connect`）はネイティブモジュールを除去しない」の3節（2026-11-03 に移動）。区切り線より下は原文のまま。ただし、各節が兄弟の節になるよう、見出しの `#` の数だけそろえた（見出しの文言は変えていない）
- 注記（「本ファイル」）: 「リリースビルド分離」の節にある「本ファイル「package.json にあるのに未リンクなネイティブモジュール」の節」の「本ファイル」は、移動前の `CLAUDE.md` を指す。その節は今は `docs/android-build-notes.md` にある
- 注記（`.env.local`）: 「リリースビルド分離」の節の `.env.local` の扱いのうち、ローカルで Health Connect を触るために `.env.local` が必要になる点は、`CLAUDE.md` の「ローカルで Health Connect を触るには `.env.local` が必要（既定は無効）」の節に残している

---

## Health Connect 同期の排他制御（`SyncWorker`/`SyncCoordinator`/`SyncWorkerLoop`）

`services/SyncWorker.ts` は「v1 はプロセス内単一ワーカー」（§6.2/D-36）を
前提に書かれているが、**この前提はコード自身では守られず、呼び出し側が
守る責務**になっている。実際に一度、この前提が壊れて
「cannot start a transaction within a transaction」（`db.transaction` の
衝突）と「claim が解放されずに次回起動まで残る」の両方を実機相当の
再現で踏んだ（`contexts/SyncWorkerLoop.tsx` のレビュー時）。

- **drain のトリガを増やすときは、必ず `contexts/SyncWorkerLoop.tsx` の
  `drainingRef`/`rerunRequestedRef` による直列化を経由すること。**
  `drainDueJobs` を独自のタイマーやイベントから直接呼ぶコードを新設しない。
- **破壊的操作（置換復元・全削除・HC切断等）は必ず
  `SyncCoordinator.runExclusive` 経由で呼ぶこと。** そして
  `runExclusive` に渡す関数の**内側**から `drainDueJobs`/`useSyncWorkerLoop`
  相当の処理を呼ばないこと——`SyncCoordinator` の直列化キューは同一
  呼び出しスタック内でのネストに対応できず、デッドロックする
  （`services/SyncCoordinator.ts` の「直列化」節参照）。

Settings UI（HC の ON/OFF・手動再試行/破棄）を実装する際は、新しい
drain トリガや破壊的操作を追加することになるため、この2点を必ず踏まえる
こと。詳細な経緯は README「Phase 4 実装状況」のレビュー履歴参照。

## `react-native-health-connect` は iOS で「呼ぶと必ず throw する Proxy」

`node_modules/react-native-health-connect/lib/commonjs/index.js` は iOS/未対応
プラットフォーム向けに `HealthConnectModule` を「どのメソッドを呼んでも
`throw` する `Proxy`」にしている（`moduleProxy`）。つまり
`HealthConnectService.isAvailable()`/`ensureInitialized()` 等は iOS では
**毎回確実に reject する**——一時的なエラーではなく恒常的な状態。

これを他の非同期処理（特に DB 読み取り）と同じ `Promise.all` に入れると、
その `Promise.all` 全体が常に失敗扱いになる。Settings > Health Connect 画面
（`app/settings/health-connect.tsx`）の初版でこの事故を実際に踏んだ——DB
読み取り4件とまとめていたため、iOS では毎回「何も同期されていない」ように
見えるだけでなく、未処理の delete job が残っていても件数が0件に見え、
§10.5「未処理が残っている間は件数を表示し続ける」に違反していた。

- Health Connect のネイティブ呼び出しは、DB 読み取りとは別の `try/catch`
  に分離すること（`services/SyncWorker.ts` の `drainDueJobs` が
  `ensureInitialized()` の reject を個別に扱っているのと同じ形）。
- 根本的な対策は `app/settings/index.tsx` の HEALTH セクションを
  `Platform.OS === 'android'` でガードすること——Health Connect は
  Android 専用機能（§9.11）なので、iOS でこの画面自体を表示しない。

## リリースビルド分離（`without-health-connect`/`with-health-connect`）はネイティブモジュールを除去しない

§9.11/§25.1 の実装（`app.config.js`・`lib/healthConnectBuild.ts`・
`eas.json`）は、`EXPO_PUBLIC_HEALTH_CONNECT_ENABLED` で **Manifest の
permission（`android.permission.health.WRITE_SEXUAL_ACTIVITY`）と
`withHealthConnectPermissionsRationale` plugin だけ** を切り替えている。
`react-native-health-connect` ネイティブモジュール自体は両ビルドとも
リンクされたまま——これは手抜きではなく意図的な設計判断。**既定値
（env 未設定）は「無効」**（`=== '1'` のときだけ有効、opt-in）——当初は
「未設定 = 有効」だったが、env 指定を忘れた/新しい build profile が
黙って permission 入りに倒れるのは危険側だとレビューで指摘され直した
（`app.config.js`・`lib/healthConnectBuild.ts` の doc comment参照）。
ローカルの `expo run:android`/`expo start` を HC 込みで使いたい場合は
`.env.local.example` を `.env.local` にコピーすること。

- Health apps declaration の提出トリガーは「配布 AAB の Manifest に
  health permission が含まれているか」であって、ネイティブモジュールの
  リンク有無ではない（§9.11 本文）。permission を切れば要件は満たされる。
  ただしライブラリ自身の `<queries><package android:name="com.google.
  android.apps.healthdata" /></queries>` は without ビルドでも Manifest に
  残る（審査トリガーになる permission ではないので問題無いが、「HC の痕跡が
  完全に消える」わけではない——レビュー指摘、2026-09-21）。
- ネイティブモジュールの物理除外（autolinking の `exclude`）は、
  Gradle デーモンのキャッシュ問題（本ファイル「package.json にあるのに
  未リンクなネイティブモジュール」の節）を踏むリスクの割に実益が無い
  ため、あえてやっていない。**「ネイティブモジュールも除外すべきでは」
  という直感で `exclude` 設定を足すような変更はしないこと**——上記の
  理由で不要かつリスクだけが増える。

**「行を隠せば実行時参照は起こり得ない」は誤りだった（レビュー指摘、
2026-09-21・実装当日に発見）。** 当初 `app/settings/index.tsx` が
`isHealthConnectBuildEnabled()` で HEALTH 行を隠すだけで十分だと考えたが、
以下の2経路で破られる：

1. **同一 applicationId での with→without 入れ替え。** `healthConnect.
   enabled` は暗号化 DB の設定として永続化され、アプリの入れ替え
   （`adb install -r` 相当のアップグレード）では消えない。以前
   with-health-connect ビルドで ON にしていた端末へ without ビルドを
   重ねると、`getActiveProviders`（`services/ActivityService.ts`）が
   health_connect を active と返し続け、`drainDueJobs` が permission の無い
   ビルドでジョブを claim しては失敗させ続ける——しかもそれを見る/止める
   UI（`health-connect.tsx`）は行が隠れていて到達不能。
2. **deep link での直接到達。** `app/settings/index.tsx` が行を隠しても、
   `soloplusus://settings/health-connect` は Expo Router のルートとして
   常に開ける。ON トグルを押すと `healthConnect.enabled = true` が書き込め
   てしまう（iOS は同じ「行を隠すだけ」だが、そちらはネイティブ呼び出しが
   必ず throw する Proxy なので安全側に倒れる——ビルドフラグのケースは
   ネイティブモジュールが生きたまま応答するため、同じロジックが通用しない）。

**対処（両方実装済み）：**
- `services/ActivityService.ts` の `reconcileHealthConnectBuildFlag()` を
  `contexts/DatabaseContext.tsx` の DB 接続確立直後（アプリへ公開する前）に
  1回呼び、`!isHealthConnectBuildEnabled()` なら `healthConnect.enabled` を
  false に是正する（この時点では SyncWorker は構造上まだ起動しえないため
  `SyncCoordinator.runExclusive` は不要——「初期化は runExclusive で
  包んでいない」と同じ理由。呼び出しは try/catch で握り、失敗しても DB
  接続自体は開いたまま起動を続ける——`ensureLocaleDefaultsPersisted` の
  ような「失敗したら以降の表示が壊れる」処理とは重みが違うため）。
- `app/settings/health-connect.tsx` の default export は薄いラッパーで、
  `!isHealthConnectBuildEnabled()` なら中身（全 hooks を持つ
  `HealthConnectSettingsScreenInner`）をマウントせず
  `<Redirect href="/settings" />`（`expo-router`）を返す（2回目のレビュー
  指摘で `useEffect`+`router.replace` の自作から差し替え——コンポーネント
  分割なら形式的にも Rules of Hooks 違反にならない）。

**ただし `reconcileHealthConnectBuildFlag` が解決するのは「provider が
active のまま止まる」「トグル画面が到達不能」の2点だけで、with-health-
connect ビルドで積まれた delete ジョブ自体が消えるわけではない
（3回目のレビュー指摘、2026-09-21）。** permission が無いビルドではその
ジョブを HC へ送る手段が無いため、jobs テーブルには残り続ける
（`drainDueJobs` の provider-disabled 早期 return で claim されないだけ
——§10.5 の「無効化中もジョブは保持される」と同じ扱い）。
`app/settings/delete-data.tsx` の全削除完了メッセージは、
`!isHealthConnectBuildEnabled()` のときだけ「このバージョンでは送信できない
（HC 対応版に更新されれば自動的に再開する）」という文言に分岐させている
——`healthConnect.enabled` が既に false なのに旧来の「Settings › Health
Connect で再接続してください」を出すと、到達不能な画面へ誘導することになる
ため。**with→without の入れ替えは、実際の配布（Play では片方のみ）ではなく
主にローカルでのビルド取り違え対策として作った経路であり、「ジョブが
いつか必ず送信される」ところまでは保証しない**——保証するのは「壊れた
UI 状態や誤った案内を出さない」ところまで。

「行を隠すだけで到達不能」という単純化は、**設定が他の経路（アップグレード・
deep link・将来の Import 等）で変わりうる場合は成立しない**——今後同種の
ビルドフラグ分岐を足すときは、UI を隠すことと「その状態に実際になれない」
ことを混同しないこと。

**`EXPO_PUBLIC_*` は `expo start`/`expo run:android` の dev-client 経由の
ライブリロードでは、shell の export だけでは反映されない（実機で実際に
踏んだ、2026-09-21）。** `app.config.js`（prebuild 時、素の Node プロセスが
`process.env` を読むだけ）は shell export で問題なく動くが、JS 側
（`lib/healthConnectBuild.ts` 等、bundle に埋め込まれる値）は別の仕組み
（`expo/virtual/env`、実体は `.env`/`.env.local`/`.env.development`/
`.env.development.local` からのみ値を取る require-context）を経由しており、
dev-client のライブ bundle ではこれが優先され、shell export した値が
反映されない（`undefined` になる）。**`npx expo export`（＝`eas build` が
実際に使う本番相当の静的バンドル生成)では shell export だけで正しく
リテラルへインライン展開される**（`return false;` まで定数畳み込みされる
ことを実際に確認済み）——つまり `eas.json` の `env` を使うリリースビルドは
問題なく動く。ローカルで dev-client 接続のまま JS 側の分岐だけを試したい
場合は、`.env.local`（gitignore 済み）に書いてから `expo start --clear`
すること。`app.config.js` と JS 側の判定で挙動が食い違って見えたら、まず
これを疑うこと。
