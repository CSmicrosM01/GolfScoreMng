# 松本杯 ゴルフスコア管理アプリ デプロイ手順

## 前提条件

- AWSアカウントを持っていること
- AWS CLIがインストールされていること（オプション）

## 方法1: AWSコンソールからデプロイ（推奨）

### Step 1: S3バケットの作成

1. [AWS S3コンソール](https://s3.console.aws.amazon.com/s3/)にログイン
2. 「バケットを作成」をクリック
3. バケット名を入力（例: `matsumoto-cup-golf-2025`）
   - バケット名はグローバルで一意である必要があります
4. リージョンを選択（例: `ap-northeast-1` 東京）
5. 「パブリックアクセスをすべてブロック」の**チェックを外す**
6. 警告を確認してチェックボックスにチェック
7. 「バケットを作成」をクリック

### Step 2: 静的ウェブサイトホスティングの有効化

1. 作成したバケットをクリック
2. 「プロパティ」タブを選択
3. 一番下の「静的ウェブサイトホスティング」で「編集」をクリック
4. 以下を設定:
   - 静的ウェブサイトホスティング: **有効にする**
   - ホスティングタイプ: **静的ウェブサイトをホストする**
   - インデックスドキュメント: `index.html`
   - エラードキュメント: `index.html`（任意）
5. 「変更の保存」をクリック
6. 表示される「バケットウェブサイトエンドポイント」をメモ

### Step 3: バケットポリシーの設定

1. 「アクセス許可」タブを選択
2. 「バケットポリシー」で「編集」をクリック
3. 以下のポリシーを貼り付け（`your-bucket-name`を実際のバケット名に置き換え）:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::your-bucket-name/*"
        }
    ]
}
```

4. 「変更の保存」をクリック

### Step 4: ファイルのアップロード

1. 「オブジェクト」タブを選択
2. 「アップロード」をクリック
3. 以下の5ファイルをドラッグ＆ドロップまたは「ファイルを追加」:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `data.js`（初期データ定義）
   - `data.json`（共有データファイル - 初回は下記の手順で作成）
4. 「アップロード」をクリック

#### data.jsonの初回作成

初回デプロイ時は`data.json`ファイルを作成する必要があります：

1. ローカルでアプリを開く（`index.html`をブラウザで開く）
2. 適当なユーザーでログイン
3. 「一括入力」タブを開く
4. 「エクスポート」ボタンをクリック
5. ダウンロードされた`golf-score-2025.json`を`data.json`にリネーム
6. S3にアップロード

### Step 5: 動作確認

1. 「プロパティ」タブに戻る
2. 「静的ウェブサイトホスティング」のエンドポイントURLをクリック
3. アプリが表示されることを確認

エンドポイントURL例:
```
http://matsumoto-cup-golf-2025.s3-website-ap-northeast-1.amazonaws.com
```

---

## 方法2: AWS CLIでデプロイ

### Step 1: AWS CLIの設定

```bash
aws configure
```

以下を入力:
- AWS Access Key ID
- AWS Secret Access Key
- Default region name: `ap-northeast-1`
- Default output format: `json`

### Step 2: バケット作成とデプロイ（PowerShell）

```powershell
# 変数設定
$BUCKET_NAME = "matsumoto-cup-golf-2025"
$REGION = "ap-northeast-1"

# バケット作成
aws s3 mb s3://$BUCKET_NAME --region $REGION

# パブリックアクセスブロックの解除
aws s3api put-public-access-block --bucket $BUCKET_NAME --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

# バケットポリシーの設定
$POLICY = @"
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::$BUCKET_NAME/*"
        }
    ]
}
"@
$POLICY | Out-File -Encoding utf8 policy.json
aws s3api put-bucket-policy --bucket $BUCKET_NAME --policy file://policy.json
Remove-Item policy.json

# 静的ウェブサイトホスティングの有効化
aws s3 website s3://$BUCKET_NAME --index-document index.html

# ファイルのアップロード
aws s3 cp index.html s3://$BUCKET_NAME/ --content-type "text/html; charset=utf-8"
aws s3 cp styles.css s3://$BUCKET_NAME/ --content-type "text/css; charset=utf-8"
aws s3 cp app.js s3://$BUCKET_NAME/ --content-type "application/javascript; charset=utf-8"
aws s3 cp data.js s3://$BUCKET_NAME/ --content-type "application/javascript; charset=utf-8"

# エンドポイントURL表示
Write-Host "デプロイ完了！"
Write-Host "URL: http://$BUCKET_NAME.s3-website-$REGION.amazonaws.com"
```

---

## 2025年度データの利用について

### 初回アクセス時

`data.js`に2025年度のデータが含まれているため、初回アクセス時に自動で読み込まれます。

### 既存データがある場合

localStorageに既存データがある場合は、そちらが優先されます。
初期データに戻したい場合は、ブラウザの開発者ツールで以下を実行:

```javascript
localStorage.removeItem('golfScoreApp');
location.reload();
```

### 端末間のデータ共有（自動同期）

本アプリはS3上の`data.json`ファイルを使って端末間でデータを共有します。

#### データ共有の仕組み

```
[端末A] ──保存──> data.json ダウンロード ──> S3にアップロード
                                                    ↓
[端末B] ──────────────────────────────────> 最新データ取得
```

#### データ更新の流れ

1. **スコアを入力・保存**すると、画面下部に通知が表示されます
2. 「**S3用データをダウンロード**」ボタンをクリック
3. `data.json`ファイルがダウンロードされます
4. S3バケットに`data.json`をアップロード（上書き）

#### 他の端末でデータを取得

1. アプリにログイン
2. ヘッダーの「**最新データ取得**」ボタンをクリック
3. S3から最新のdata.jsonが読み込まれます

#### 注意事項

- 複数人が同時に編集すると、後からアップロードした人のデータで上書きされます
- 同時編集を避けるため、スコア入力担当者を決めることを推奨します
- アプリ起動時にも自動でS3からデータを取得します

---

## ファイル更新時

ファイルを更新した場合は、再度アップロードするだけでOKです。

### コンソールから
1. S3バケットの「オブジェクト」タブを開く
2. 更新したいファイルをアップロード（上書き）

### CLIから
```powershell
aws s3 cp index.html s3://$BUCKET_NAME/ --content-type "text/html; charset=utf-8"
```

---

## CloudFront（CDN）の設定（オプション）

HTTPSが必要な場合や高速化したい場合は、CloudFrontを設定します。

1. [CloudFrontコンソール](https://console.aws.amazon.com/cloudfront/)を開く
2. 「ディストリビューションを作成」をクリック
3. オリジンドメイン: S3バケットのウェブサイトエンドポイントを入力
4. 「ディストリビューションを作成」をクリック
5. 数分後、CloudFront URLでアクセス可能に

---

## トラブルシューティング

### 403 Forbiddenエラー

- バケットポリシーが正しく設定されているか確認
- パブリックアクセスブロックが解除されているか確認

### 文字化け

- アップロード時にContent-Typeに`charset=utf-8`が設定されているか確認
- CLIの場合は`--content-type`オプションを使用

### 更新が反映されない

- ブラウザのキャッシュをクリア（Ctrl+Shift+R）
- CloudFront使用時は、キャッシュの無効化を実行

---

## 料金目安

S3静的ホスティングは非常に低コストです。

- ストレージ: 約0.025ドル/GB/月（数KB程度なのでほぼ無料）
- リクエスト: GET 1,000回あたり約0.0004ドル
- データ転送: 最初の1GB/月は無料、以降0.114ドル/GB

月間数百アクセス程度なら、ほぼ無料で運用できます。
