# R8の最適化（proguard-android-optimize.txt）を有効にしたときに必要な、このアプリ固有のkeepルール。
# plugins/withAndroidR8.js が android/app/ へコピーし、build.gradle の proguardFiles に足す。

# --- Expo の注釈インターフェース ---
# Expo Modules は、実行時に注釈のメンバーを読む。
#   - expo.modules.kotlin.records.Field          : Record変換（RecordTypeConverter、JSTypeConverterHelper）が
#                                                  `fieldAnnotation.key` を読む
#   - expo.modules.kotlin.records.Required       : 同じく有無を読む
#   - expo.modules.kotlin.services.ServiceInterface : ServicesRegistry が `clazz` を読む
# これらは注釈インターフェースで、プログラム内に実装クラスが無い（実体は実行時にAndroidのランタイムが動的Proxyとして作る）。
# 最適化が有効だと、R8は「実体の無い型のメソッド呼び出し」と判断し、呼び出しを `throw null` に
# 置き換えることがある。Field で実際に起き、Recordを引数に取るネイティブ関数が、リリースビルドだけで
# NullPointerException になり、起動直後にアプリが落ちた（別のExpo 57のアプリで、エミュレータで確認。
# -dontoptimize のときは起きない。Expoのテンプレートは -dontoptimize なので、Expo標準の構成では表に出ない）。
# ServiceInterface は、呼び出しが残っていて壊れていなかったが、なぜ壊れないのかは確かめられていない。
# 同種の不具合を未然に防ぐため、個別に列挙せず、Expoの注釈インターフェースをまとめて残す
# （残るのは小さな注釈クラスだけで、難読化・最適化・縮小の率への影響はごくわずか）。
-keep @interface expo.modules.** { *; }
