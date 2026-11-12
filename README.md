# Java Silver SE 17 演習アプリ

Java Silver SE 17(1Z0-825-JPN)向けの、演習が中心の学習アプリです。「問題を解く → 間違えたら解説とコード実行 → 類題」のループで進み、1日・3日・7日後の復習と、60問・90分の模擬試験があります。すべての問題は JDK 17 で実際にコンパイル・実行して、正解と解説が実際の動きと一致することを確かめてから収録します。

現在の収録は分野3「演算子と制御構造」の25組・75問です(表・即時類題・復習バリエーションの3問1組)。残り5分野は同じ手順で追加します。

## ディレクトリ構成

```
.
├── app/            アプリ本体(React 18 + TypeScript + Vite)。claude.ai のアーティファクトとして公開
├── questions/      問題データ(分野ごとの JSON と topics.json)。アプリと検証が読む唯一の問題データ
├── authoring/      問題の執筆用ソース(<分野ID>.src.mjs)と、questions/ を生成する build-questions.mjs
├── tools/          JDK 17 での検証(verify-questions.mjs)とレビューページの生成(render-review.mjs)
├── reports/        検証レポート(verification-report.json)。review/ はレビューページの出力先(Git 管理外)
├── runner/         書き換えたコードを実行するサーバー一式(リモート MCP + Docker サンドボックス)
└── docs/           設計・類題ポリシー・実行サーバーの手順書
```

問題は `authoring/` で書き、`npm run questions` で `questions/` と `reports/` を作り直します。`questions/` を手で直接編集しないでください(次の生成で上書きされます)。アプリは `questions/` と `reports/verification-report.json` から問題データを組み立て、検証が通っていない問題があるとビルドを止めます。

## 必要なもの

| 用途 | 必要なもの |
| --- | --- |
| アプリの開発・ビルド | Node.js 20 以上 |
| 問題の検証 | JDK 17(`java -version` が 17 のもの)。他のバージョンを指定すると止まります |
| 実行サーバー | Docker Engine 23 以降と Docker Compose、公開ドメイン([手順書](docs/runner-deployment.md)) |

## 起動方法

### アプリ

```bash
npm run setup     # app/ の依存パッケージを入れる(初回だけ)
npm run dev       # http://localhost:5173 で開発サーバーを起動
npm run build     # app/dist/ に公開用の静的ファイルを作る
```

`dev` と `build` は、先に `questions/` と `reports/verification-report.json` からアプリ用のデータ(`app/src/data/bank.json`)を作ります。

手元のブラウザで開いた場合、学習履歴はブラウザの localStorage に保存されます。書き換えたコードの実行は claude.ai 上でコネクタ経由でだけ動くので、手元では「この表示環境では実行サーバーを使えません」と表示されます。書き換えていないコードは、JDK 17 で検証済みの実行結果を表示します。

### 問題の生成と検証

```bash
JAVA_HOME=/path/to/jdk-17 npm run questions
```

次の3つをまとめて行います。

1. `authoring/*.src.mjs` から `questions/*.json` と `questions/topics.json` を作り、ID・選択肢・3問の組がそろっているかをチェックする
2. 全問を JDK 17 でコンパイル・実行し、正解の選択肢だけが実際の結果と一致するかを確かめる。即時類題と復習バリエーションの構造チェックもここで行う
3. javac の実際のエラーメッセージを問題データに書き戻し、`reports/verification-report.json` を更新する

最後に「75/75 問が一致・構造チェック 25組で問題 0件」のように表示されれば成功です。

### レビューページ

```bash
npm run review    # reports/review/<分野ID>-review.html を作る
```

表・即時類題・復習バリエーションを横に並べたページです。「自分で解く」に切り替えると正解を隠して解けます。ブラウザでファイルを開くだけで見られます。

### 実行サーバー

`runner/` を Docker で動かし、claude.ai のカスタムコネクタ「Java Silver Runner」として登録します。認証は必須で、実行は1回ごとに使い捨てのコンテナ(10秒・ネットワークなし・CPU 1・メモリ 256MB)で行います。手順は [docs/runner-deployment.md](docs/runner-deployment.md) にあります。

## 問題の追加方法

### 1. 執筆用ソースに書く

問題は `authoring/<分野ID>.src.mjs` に書きます。`authoring/operators.src.mjs` が見本です。1つの表問題に、即時類題と復習バリエーションを1問ずつ付けた3問を1組にします。それぞれの作り方は [類題ポリシー](docs/similar-question-policy.md) に従ってください。

| ID | 役割 | 決まり |
| --- | --- | --- |
| `oc-01a` | 表 | 演習と模擬試験で出す |
| `oc-01b` | 即時類題 | 表と同じコード構造・同じ選択肢構成。変えてよいのは数値・変数名・クラス名・文字列の中身だけ |
| `oc-01c` | 復習バリエーション | 同じトピック・同じ難易度で別の角度から問う。表との違いを `NOTES` に1行で書く(`variationNote` になる) |

実行結果を選ぶ問題の例です(oc-01a を簡略化したもの)。選択肢ごとに「その選択肢が正しいなら実際に起きること」(claim)を書きます。検証は、正解の claim だけが実際の結果と一致することを確かめます。

```js
q({
  id: 'oc-01a', topic: 'oc-arith', tags: ['後置インクリメント'], diff: 1, format: 'output',
  prompt: P1,                                    // 「次のプログラムを…(1つ選択)」
  code: main('int x = 3;', 'int y = x++;', 'System.out.println(x + "," + y);'),
  options: [
    [shown('3,3'), out('3,3')],                  // [選択肢の文, claim]
    [shown('4,3'), out('4,3')],
    [shown('4,4'), out('4,4')],
    [CE, ce()],                                  // コンパイルエラーになる、という主張
  ],
  answer: ['B'],
  point: '要点(1〜2文)',
  detail: '詳しい解説',
  why: ['A の解説', '正解。', 'C の解説', 'D の解説'],  // 選択肢と同じ数・同じ順
  refs: ['postInc'],                             // ファイル先頭の R に定義した JLS などの参照
}),
```

コンパイルできるかを選ぶ問題は、`template: tpl()` と `polarity: 'error'`(エラーになるものを選ぶ)または `'ok'` を指定し、選択肢を `{ code: '…' }` で書きます。各選択肢を `{{OPTION}}` の位置に埋め込んで1つずつコンパイルします。

claim には `out('標準出力')`、`exc('それまでの出力', '例外クラス名')`、`ce(行番号…)`(コンパイルエラー)、`loop()`(終わらない)を使えます。単一選択の正解の位置は `POS` で入れ替えられます。

### 2. 生成して JDK 17 で検証する

```bash
JAVA_HOME=/path/to/jdk-17 npm run questions
```

NG が出たら、解説や claim ではなくまず問題のコードと正解を疑ってください。実際の JDK 17 の動きが正です。

### 3. レビューして、アプリで確かめる

```bash
npm run review    # reports/review/ のページで本文・コード・解説を読む
npm run dev       # アプリで実際に解く
```

### 4. まとめてコミットする

執筆用ソース(`authoring/`)、生成した問題データ(`questions/`)、検証レポート(`reports/verification-report.json`)を同じコミットに入れます。3つがずれていると、アプリのビルドが止まるか、古い検証結果が表示されます。

### 新しい分野を始めるとき

`authoring/operators.src.mjs` を複製して `authoring/<分野ID>.src.mjs` を作ります。ファイル名は分野 ID と同じにし、問題 ID とトピック ID には分野の接頭辞を付けます。

| 分野 | 分野 ID | 接頭辞 |
| --- | --- | --- |
| 1. Javaの概要と簡単なJavaプログラムの作成 | `basics` | `bs` |
| 2. Javaの基本データ型と文字列の操作 | `types` | `ty` |
| 3. 演算子と制御構造 | `operators` | `oc` |
| 4. クラスの定義とインスタンスの使用 | `classes` | `cl` |
| 5. 継承とインターフェイスの使用 | `inheritance` | `ih` |
| 6. 例外処理 | `exceptions` | `ex` |

複製したら、`q()` の中の `fieldId: 'operators'` を新しい分野 ID に変え、`questions` と `topics` を書き直します。1分野は25組で、表の難易度は易・中・難をおよそ 3:5:2(25組なら 8・12・5)にします。出題は試験の公式チェックリストの範囲だけにします。

## ドキュメント

- [設計](docs/design.md): アーキテクチャ、データ設計、学習状態のルール、分野3の配分と検証結果
- [類題ポリシー](docs/similar-question-policy.md): 即時類題と復習バリエーションの作り分け、復習で出す問題の選び方
- [実行サーバーの手順書](docs/runner-deployment.md): デプロイ、動作確認、claude.ai のコネクタ登録、運用

## 公開中のもの

- アプリ: [Java Silver 演習](https://claude.ai/artifact/U6BQ81hdLyCZC6mDzwESVC)(claude.ai のアーティファクト)
- 分野3のレビューページ: [演算子と制御構造 問題レビュー](https://claude.ai/artifact/EReEC2UX2GvAZ6Bzfz9MbM)
