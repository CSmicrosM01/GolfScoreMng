# 近藤/鹿中グループ版 デプロイ手順

## 概要

近藤さん・鹿中さん用のゴルフスコア管理アプリ。機能は既存版（松本/正本/渡邉/近藤/比企/内藤）と同一で、以下の点のみ異なる。

| 項目 | 既存版 | 近藤/鹿中版 |
|------|--------|-------------|
| メンバー | 6名 | 近藤・鹿中の2名 |
| 有効ラウンドの最小参加人数 | 3名 | 2名 |
| デフォルト杯名 | 正本杯 | 近藤杯 |
| フロント配置 | バケット直下 | `kondo/` 配下 |
| データファイル | `config.json` / `data-YYYY.json`（バケット直下） | `kondo/config.json` / `kondo/data-YYYY.json` |
| localStorage キー | `golfScoreApp` | `golfScoreAppKondo` |

## データ分離の仕組み

- Lambda（`lambda/index.mjs`）に `group` クエリパラメータを追加した。
  - `group` 未指定: 従来どおりバケット直下のファイルを読み書き（既存版に影響なし）。
  - `group=kondo`: S3 キーに `kondo/` プレフィックスを付けて読み書き。
- フロント（`kondo/app.js`）は全ての Lambda 呼び出しに `group=kondo` を付与する。
- S3 バケット・Lambda 関数は既存版と共用。データファイルのみ分離されるため競合しない。

## デプロイ手順

### 1. Lambda 関数の更新（必須・1回のみ）

`group` パラメータ対応版の `lambda/index.mjs` を反映する。

```bash
cd lambda
zip function.zip index.mjs
aws lambda update-function-code \
  --function-name <関数名> \
  --zip-file fileb://function.zip
```

またはコンソール（Lambda → 該当関数 → index.mjs を上書き → Deploy）。

※ 後方互換のため、既存版はそのまま動作する（先に Lambda を更新してよい）。

### 2. フロントファイルのアップロード

```bash
export BUCKET_NAME=score-manage-micros

aws s3 cp kondo/index.html s3://${BUCKET_NAME}/kondo/index.html --content-type "text/html; charset=utf-8"
aws s3 cp kondo/app.js s3://${BUCKET_NAME}/kondo/app.js --content-type "application/javascript; charset=utf-8"
aws s3 cp kondo/styles.css s3://${BUCKET_NAME}/kondo/styles.css --content-type "text/css; charset=utf-8"
```

コンソールの場合はバケット内に `kondo/` フォルダを作成し、3ファイルをアップロードする。

※ `data.js`（既存版の初期データ）はアップロードしない。近藤/鹿中版は読み込まない設計。
※ `kondo/config.json` / `kondo/data-YYYY.json` は初回保存時に Lambda が自動作成するため、事前アップロード不要。

### 3. アクセスURL

```
http://score-manage-micros.s3-website-ap-northeast-1.amazonaws.com/kondo/
```

### 4. 動作確認

- [ ] `/kondo/` でログイン画面に「近藤杯」と近藤・鹿中の2名のボタンが表示される
- [ ] スコアを入力・保存すると S3 に `kondo/data-YYYY.json` が作成される
- [ ] 既存版（バケット直下）のデータ（`config.json` / `data-2025.json` 等）が変化していない
- [ ] 既存版のアプリが従来どおり動作する

## 注意事項

- 既存版・近藤/鹿中版は同一オリジンだが、localStorage キーを分けているためブラウザ内でも競合しない。
- ランキング対象の最小参加回数（3回）は既存版と同じ。
