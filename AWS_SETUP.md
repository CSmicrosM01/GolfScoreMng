# AWS Lambda 関数URL 設定手順

## 概要

Lambda関数URLを使用して、アプリからS3へのデータ保存を自動化します。
API Gatewayを使わないシンプルな構成です。

## 前提条件

- AWSアカウントを持っていること
- S3バケットが既に作成済みであること（DEPLOY.md参照）

---

## Step 1: IAMロールの作成

Lambda関数がS3にアクセスするためのロールを作成します。

### 1.1 IAMコンソールを開く
1. [IAMコンソール](https://console.aws.amazon.com/iam/)にアクセス
2. 左メニューから「ロール」を選択
3. 「ロールを作成」をクリック

### 1.2 ロールの設定
1. **信頼されたエンティティタイプ**: AWS サービス
2. **ユースケース**: Lambda
3. 「次へ」をクリック

### 1.3 許可ポリシーを追加
1. `AWSLambdaBasicExecutionRole`を検索して選択
2. 「次へ」をクリック

### 1.4 ロール名を設定
- ロール名: `GolfScoreLambdaRole`
- 「ロールを作成」をクリック

### 1.5 S3アクセス用のインラインポリシーを追加
1. 作成したロール「GolfScoreLambdaRole」をクリック
2. 「許可を追加」→「インラインポリシーを作成」
3. JSONタブを選択
4. 以下を貼り付け（`your-bucket-name`を実際のバケット名に置換）：

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject"
            ],
            "Resource": "arn:aws:s3:::your-bucket-name/data.json"
        }
    ]
}
```

5. 「次へ」→ ポリシー名: `GolfScoreS3Access` → 「ポリシーを作成」

---

## Step 2: Lambda関数の作成

### 2.1 Lambdaコンソールを開く
1. [Lambdaコンソール](https://console.aws.amazon.com/lambda/)にアクセス
2. 「関数の作成」をクリック

### 2.2 関数の設定
- **関数名**: `GolfScoreDataSync`
- **ランタイム**: Node.js 20.x
- **アーキテクチャ**: x86_64
- **実行ロール**: 既存のロールを使用 → `GolfScoreLambdaRole`
- 「関数の作成」をクリック

### 2.3 コードをデプロイ
1. コードソースセクションで「index.mjs」を開く
2. `lambda/index.mjs`の内容をコピーして貼り付け
3. 「Deploy」をクリック

### 2.4 環境変数を設定
1. 「設定」タブ → 「環境変数」
2. 「編集」をクリック
3. 以下を追加：
   - キー: `BUCKET_NAME`
   - 値: `your-bucket-name`（実際のバケット名）
4. 「保存」をクリック

### 2.5 タイムアウトを設定
1. 「設定」タブ → 「一般設定」
2. 「編集」をクリック
3. タイムアウト: 10秒
4. 「保存」をクリック

---

## Step 3: 関数URLの作成

### 3.1 関数URLを有効化
1. 「設定」タブ → 「関数URL」
2. 「関数URLを作成」をクリック

### 3.2 関数URLの設定
- **認証タイプ**: NONE（パブリックアクセス）
- **CORS を設定**にチェック
  - **許可するオリジン**: `*`
  - **許可するメソッド**: GET, POST
  - **許可するヘッダー**: content-type
  - **公開するヘッダー**: (空欄のまま)
  - **最大エージ**: 0
- 「保存」をクリック

### 3.3 関数URLを確認
作成後、関数URLが表示されます：
```
https://xxxxxxxxxxxxxxxxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws/
```
このURLをメモしてください。

---

## Step 4: アプリの設定更新

### 4.1 app.jsを更新
`app.js`の先頭にある設定を以下のように変更：

```javascript
// ===== データ同期設定 =====
const LAMBDA_FUNCTION_URL = 'https://xxxxxxxxxxxxxxxxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws/';
const USE_LAMBDA_SYNC = true; // Lambda関数URL経由で自動保存
const S3_DATA_URL = './data.json';
const USE_S3_SYNC = false; // 手動アップロードは無効化
```

※ URLを実際の関数URLに置き換えてください。

### 4.2 ファイルをS3にアップロード
更新した`app.js`をS3バケットにアップロードします。

---

## 動作確認

1. アプリにアクセス
2. スコアを入力して保存
3. 「データを保存しました」と表示されることを確認
4. 別の端末でアプリを開く
5. 自動でデータが同期されることを確認

---

## トラブルシューティング

### CORSエラー
- Lambda関数URLのCORS設定を確認
- 許可するオリジンが`*`になっているか確認
- 「Access-Control-Allow-Origin が複数の値を含む」エラーの場合：
  - Lambda関数のコードからCORSヘッダーを削除してください
  - CORSは関数URLの設定で管理し、コード側では`Content-Type`のみ設定

### 保存エラー
- Lambda関数のCloudWatchログを確認
- IAMロールの権限を確認
- 環境変数`BUCKET_NAME`が正しいか確認

### データが取得できない
- S3バケットに`data.json`が存在するか確認
- Lambda関数URLが正しいか確認

---

## セキュリティに関する注意

関数URLは認証なし（NONE）で設定しています。
より高いセキュリティが必要な場合は：

1. **IAM認証を使用**: 認証タイプを「AWS_IAM」に変更
2. **CloudFront + OACを使用**: Lambda関数URLをCloudFrontで保護

現在の設定は、URLを知っている人なら誰でもアクセスできます。
ただし、URLは推測困難なランダム文字列なので、
プライベートな少人数グループでの利用には十分です。

---

## 料金目安

- **Lambda**: 月100万リクエストまで無料、以降0.20ドル/100万リクエスト
- **S3**: 前述の通りほぼ無料

月間数百アクセス程度なら、ほぼ無料で運用できます。
