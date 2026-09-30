const { withInfoPlist, withAppDelegate, withXcodeProject, IOSConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Xcode 27 (iOS 27 SDK) 以降、UISceneライフサイクル未対応のアプリは起動直後に
// クラッシュする（"UIScene life cycle is required for apps built with this SDK"。
// Apple: WWDC25で「iOS 26の次のリリース以降、最新SDKでビルドしたUIKitアプリは
// UISceneライフサイクル必須」と予告済みの仕様変更）。
//
// Expo 57 / React Native 0.86時点ではExpo・RN本体ともに公式のシーン対応が
// 未実装。そのためios/ が `expo prebuild` の自動生成物であることを踏まえ、
// config plugin として恒久的にAppDelegate/SceneDelegateへ手動でシーン対応を注入している。
// filto-app リポジトリの同名プラグインを移植したもの（2026-09-30）。
//
// Expoが公式にUIScene対応した場合は、このプラグインとSceneDelegate.swiftを撤去し、
// 公式の仕組みに乗り換えること。詳細: CLAUDE.md「iOS 27 (UIScene) 対応」
//
// 【重要】AppDelegateのwindow生成・factory.startReactNative呼び出しは意図的に
// 元のまま(didFinishLaunchingWithOptions内)残している。expo-dev-launcher
// （Dev Client、Debugビルドのみ）はdidFinishLaunchingWithOptions時点で
// UIApplication.shared.delegate?.window（またはkeyWindow）が存在することを
// 前提にしており、無いとfatalErrorする
// （node_modules/expo-dev-launcher/ios/ReactDelegateHandler/ExpoDevLauncherAppDelegateSubscriber.swift）。
// windowをSceneDelegate側で新規生成する設計にすると、didFinishLaunching時点では
// まだシーンが接続されておらずwindowが存在しないため、Dev Client(Debugビルド)が
// 起動直後に必ずクラッシュする。SceneDelegateは新しいwindowを作らず、
// AppDelegateが作った既存のwindowにwindowSceneを割り当てるだけにすること。

const SCENE_DELEGATE_CLASS_NAME = 'SceneDelegate';
const SCENE_DELEGATE_FILENAME = `${SCENE_DELEGATE_CLASS_NAME}.swift`;
// Info.plist（UISceneConfigurations）とAppDelegate.swift（configurationForConnectingが
// 返すUISceneConfiguration）の両方で同じ名前を指定する必要がある。値そのものに意味は
// 無いが、食い違うと「シーン設定が見つからない」実行時エラーになるため定数化して揃える。
const SCENE_CONFIGURATION_NAME = 'Default Configuration';
// AppDelegate.swiftのパッチが既に適用済みかどうかの判定専用マーカー。
// 実装コード（configurationForConnectingなど）の文字列に依存すると、将来Expo側や
// 他のプラグインが同名のメソッドを追加した場合に誤判定するため、専用の文字列にする。
const PATCH_MARKER = '// __withIosSceneDelegate_patched__';

const SCENE_DELEGATE_SOURCE = `// このファイルは plugins/withIosSceneDelegate.js が生成する。
// 手で編集しても \`expo prebuild\` 実行時に上書きされる。
//
// iOS 27 SDK (Xcode 27) のUISceneライフサイクル必須化への対応。
// windowの生成自体はAppDelegate.didFinishLaunchingWithOptionsに残したまま
// （expo-dev-launcher対策。詳細はwithIosSceneDelegate.js冒頭コメント参照）、
// そのwindowにwindowSceneを割り当てる役割だけをここで担う。
//
// URLスキーム/Universal Linksは、シーン採用後はAppDelegateの
// application(_:open:)・application(_:continue:restorationHandler:) が
// 呼ばれなくなるため、ExpoAppDelegateSubscriberManagerへの転送もここで肩代わりする
// （expo-linking / expo-dev-launcher 等のサブスクライバーが動作しなくなるのを防ぐため）。
//
// \`internal import\`はAppDelegate.swift（Expoテンプレート自動生成）や
// ExpoModulesProvider.swift（expo-modules-autolinking自動生成——Podsの
// ターゲットではなく、アプリ自身のターゲットに直接コンパイルされる）の
// 指定に合わせている——Swift 6.2の「importのアクセスレベル」機能により、
// 同一モジュール内の別ファイルで同じモジュールを異なる暗黙アクセスレベルで
// importするとコンパイルエラーになるため。両方とも明示的に揃えること。

internal import Expo
internal import ExpoModulesCore
import React
import UIKit

class ${SCENE_DELEGATE_CLASS_NAME}: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let window = (UIApplication.shared.delegate as? AppDelegate)?.window else {
      // AppDelegate.application(_:didFinishLaunchingWithOptions:)が必ず先に呼ばれ、
      // その中でwindowを生成しているはずなので、ここがnilになることは想定していない。
      // assertionFailureはRelease構成では何もしないため、実機のクラッシュログ／
      // コンソールから追えるようNSLogも残す。
      NSLog("withIosSceneDelegate: AppDelegate.window が生成されていません")
      assertionFailure("withIosSceneDelegate: AppDelegate.window が生成されていません")
      return
    }

    window.windowScene = windowScene
    window.makeKeyAndVisible()
    self.window = window

    // 【既知の制約】ここで転送できるのはウォームスタート相当の経路のみ。
    // コールドスタート（未起動状態から直接URLで起動）でJS側のLinking.getInitialURL()に
    // このURLを渡す手段が無い——RCTLinkingManager.getInitialURL()はbridge.launchOptions
    // （node_modules/react-native/Libraries/LinkingIOS/RCTLinkingManager.mm）しか見ず、このプロパティは
    // AppDelegate.didFinishLaunchingWithOptionsでbridge生成時に固定されて以後read-only
    // になる。シーン方式ではURLはdidFinishLaunchingWithOptionsの時点ではまだ渡らず
    // （scene接続時にconnectionOptionsとして渡る）、bridge生成後にこの関数へ来るため、
    // 遡ってlaunchOptionsへ差し込むことができない。下記のopenURLContexts/continue
    // 呼び出しはRCTOpenURLNotificationを飛ばすだけで、JS側がまだ購読前のコールド
    // スタートでは失われる（購読済みのウォームスタートでは問題なく届く）。
    // 2026-09-30時点でアプリ内にディープリンク機能は無いため実害は無いが、
    // 将来ウィジェット・通知・共有シート等でsoloplusus://を使い始める場合は
    // この制約を踏まえて設計すること（\`xcrun simctl openurl <UDID> soloplusus://...\`
    // をアプリ未起動状態から実行すると、URLが無視されトップ画面から始まることで
    // 再現できる）。
    if !connectionOptions.urlContexts.isEmpty {
      self.scene(scene, openURLContexts: connectionOptions.urlContexts)
    }
    if let userActivity = connectionOptions.userActivities.first {
      self.scene(scene, continue: userActivity)
    }
  }

  // Linking API（旧AppDelegate.application(_:open:options:)相当）
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [
        .openInPlace: context.options.openInPlace,
      ]
      if let sourceApplication = context.options.sourceApplication {
        options[.sourceApplication] = sourceApplication
      }
      if let annotation = context.options.annotation {
        options[.annotation] = annotation
      }

      _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: options)
      _ = ExpoAppDelegateSubscriberManager.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  // Universal Links（旧AppDelegate.application(_:continue:restorationHandler:)相当）
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    let noopRestorationHandler: ([UIUserActivityRestoring]?) -> Void = { _ in }
    _ = RCTLinkingManager.application(UIApplication.shared, continue: userActivity, restorationHandler: noopRestorationHandler)
    _ = ExpoAppDelegateSubscriberManager.application(UIApplication.shared, continue: userActivity, restorationHandler: noopRestorationHandler)
  }
}
`;

// didFinishLaunchingWithOptionsの終端に、configurationForConnecting(シーン設定)を
// 追加するだけの純粋な追記。window生成やstartReactNative呼び出しには一切触れない
// （触れてはいけない理由は本ファイル冒頭コメント参照）。
const DID_FINISH_LAUNCHING_END = `    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }`;

const CONFIGURATION_FOR_CONNECTING = `    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  ${PATCH_MARKER}
  // iOS 27 SDK のUISceneライフサイクル必須化対応。詳細は plugins/withIosSceneDelegate.js を参照。
  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let sceneConfig = UISceneConfiguration(name: "${SCENE_CONFIGURATION_NAME}", sessionRole: connectingSceneSession.role)
    sceneConfig.delegateClass = SceneDelegate.self
    return sceneConfig
  }`;

// シーン採用後はシステムから呼ばれなくなるため撤去し、同等の処理をSceneDelegate側へ
// 移植する（残したままだと二重発火はしないが、実際には呼ばれない死んだコードとして
// 紛らわしく残ってしまう）。
const OLD_LINKING_OVERRIDES = `

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }`;

function patchAppDelegate(contents) {
  if (contents.includes(PATCH_MARKER)) {
    // 既にパッチ済み（expo prebuildの再実行など）。
    return contents;
  }

  let patched = contents;

  const beforeConfigInsert = patched;
  patched = patched.replace(DID_FINISH_LAUNCHING_END, CONFIGURATION_FOR_CONNECTING);
  if (patched === beforeConfigInsert) {
    throw new Error(
      'withIosSceneDelegate: AppDelegate.swift内にdidFinishLaunchingWithOptionsの終端が' +
        '見つかりませんでした。Expoのテンプレートが変わった可能性があるため ' +
        'plugins/withIosSceneDelegate.js を確認してください。'
    );
  }

  const beforeLinkingRemoval = patched;
  patched = patched.replace(OLD_LINKING_OVERRIDES, '');
  if (patched === beforeLinkingRemoval) {
    throw new Error(
      'withIosSceneDelegate: AppDelegate.swift内のLinking API ' +
        '(open url / continue userActivity)のoverrideが見つかりませんでした。' +
        'Expoのテンプレートが変わった可能性があるため plugins/withIosSceneDelegate.js を確認してください。'
    );
  }

  return patched;
}

// キーの並び順に依存せず値だけを比較するための正規化。オブジェクトのキーを
// 再帰的にソートしてからJSON.stringifyする（plist読み戻し時のキー順は
// 保証されないため、単純なJSON.stringify同士の比較では順序違いを
// 「値が異なる」と誤判定しうる）。
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function withIosSceneManifest(config) {
  return withInfoPlist(config, (config) => {
    const desiredManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: SCENE_CONFIGURATION_NAME,
            UISceneDelegateClassName: `$(PRODUCT_MODULE_NAME).${SCENE_DELEGATE_CLASS_NAME}`,
          },
        ],
      },
    };

    const existingManifest = config.modResults.UIApplicationSceneManifest;
    if (existingManifest) {
      // withInfoPlistは`ios/`に既存のInfo.plistがあれば、その内容をmodResultsとして
      // 渡してくる（`--clean`無しでのprebuild再実行時など）。つまりここに値がある
      // ケースの大半は「前回自分が書いた値がそのまま返ってきた」であり、他プラグイン
      // との衝突ではない。前回書いたのと同じ値ならそのまま通し、値が異なる場合だけ
      // （他のプラグインが設定した可能性）明示的なエラーで止める。
      if (JSON.stringify(canonicalize(existingManifest)) === JSON.stringify(canonicalize(desiredManifest))) {
        return config;
      }
      throw new Error(
        'withIosSceneDelegate: Info.plist の UIApplicationSceneManifest に' +
          'このプラグインが書き込む値と異なる既存の設定があります' +
          '（他の config plugin が設定した可能性）。上書きすると壊れるため、' +
          'plugins/withIosSceneDelegate.js の withIosSceneManifest を' +
          'マージするよう修正してください。'
      );
    }

    config.modResults.UIApplicationSceneManifest = desiredManifest;
    return config;
  });
}

function withIosSceneAppDelegate(config) {
  return withAppDelegate(config, (config) => {
    config.modResults.contents = patchAppDelegate(config.modResults.contents);
    return config;
  });
}

function withIosSceneDelegateFile(config) {
  return withXcodeProject(config, (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const sourceRoot = IOSConfig.Paths.getSourceRoot(projectRoot);

    fs.writeFileSync(path.join(sourceRoot, SCENE_DELEGATE_FILENAME), SCENE_DELEGATE_SOURCE);

    const filePath = `${projectName}/${SCENE_DELEGATE_FILENAME}`;
    if (!config.modResults.hasFile(filePath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: filePath,
        groupName: projectName,
        project: config.modResults,
      });
    }

    return config;
  });
}

module.exports = function withIosSceneDelegate(config) {
  config = withIosSceneManifest(config);
  config = withIosSceneAppDelegate(config);
  config = withIosSceneDelegateFile(config);
  return config;
};
