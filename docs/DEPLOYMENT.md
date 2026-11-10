# 本番デプロイ＆アプリリリース手順書 (`docs/DEPLOYMENT.md`)

このドキュメントでは、**聖地コンパス Reborn** を本番環境にデプロイし、Web アプリ・API サーバー・iOS / Android ネイティブアプリとして公開するための準備と手順をまとめています。

---

## 1. 全体構成と必要なサービス一覧

本プロジェクトは**すべて無料枠からスモールスタートできる構成**になっており、外部 API キー（SNS ログインや Google Maps API）は後からいつでも追加できます。

| レイヤー | 推奨サービス | 必須 / 任意 | 用途・備考 |
| :--- | :--- | :--- | :--- |
| **データベース** | [Neon Serverless PostgreSQL](https://neon.tech/) | **必須** | PostGIS による高速な周辺聖地検索・ユーザー・訪問履歴の永続化（無料枠あり） |
| **Web & API ホスティング** | [Vercel](https://vercel.com/) または [Cloudflare Workers](https://workers.cloudflare.com/) | **必須** | Next.js Web フロントエンド（`apps/web`）および Hono API（`/api/*`）の配信 |
| **非公開アルバム写真ストレージ** | [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) | 任意（推奨） | 巡礼者の記念写真（本人限定公開）のオブジェクトストレージ（月 10GB まで無料） |
| **ネイティブアプリビルド** | [Expo Application Services (EAS)](https://expo.dev/eas) | ネイティブ配布時のみ | `apps/mobile` を単体の Android (`.apk` / `.aab`)・iOS (`.ipa`) アプリとしてビルド |
| **SNS OAuth ログイン** | X / Google / Apple Developer | 任意 | 未設定でも「ゲスト利用」＋「メールアドレス＆パスワード登録・引き継ぎ」が動作 |
| **施設・住所検索 API** | Google Maps Places API (New) | 任意 | 未設定でも「国土地理院 無料ジオコーディング API」＋「Google マップ短縮 URL 展開」で動作 |

---

## 2. データベースの準備（Neon PostgreSQL + PostGIS）

1. [Neon](https://neon.tech/) で無料アカウントを作成し、新規プロジェクトを作成します（リージョンは `AWS Asia Pacific (Tokyo)` または `Singapore` 推奨）。
2. Neon ダッシュボードから接続文字列（`postgresql://user:pass@ep-xxxx.aws.neon.tech/neondb?sslmode=require`）をコピーします。
3. ローカル端末のターミナルで、リポジトリルートから以下のコマンドを **1回だけ** 実行してスキーマ作成・PostGIS 空間インデックス構築・初期聖地データ（4,270スポット）の投入を行います。

```bash
# 1. テーブル・PostGIS拡張・空間インデックスの反映
DATABASE_URL="コピーしたNeon接続URL" npm run db:push

# 2. 日向坂46 初期聖地データ（4,270ヶ所 / 4,501エピソード）のシード投入
DATABASE_URL="コピーしたNeon接続URL" npm run db:seed
```

---

## 3. 本番用環境変数の準備

ホスティング先（Vercel または Cloudflare）に設定する環境変数一覧です（テンプレートは [`.env.example`](../.env.example) を参照）。

### 必須の環境変数

| 環境変数名 | 本番での設定値（例） | 説明 |
| :--- | :--- | :--- |
| `DATABASE_URL` | `postgresql://...` | Neon PostgreSQL の接続文字列 |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` で生成した文字列 | セッション Cookie・トークン署名用のランダムな32文字以上の秘密鍵 |
| `BETTER_AUTH_URL` | `https://seichi-compass.example.com` | 認証コールバックの基準 URL（末尾スラッシュなし） |
| `NEXT_PUBLIC_APP_URL` | `https://seichi-compass.example.com` | X シェアリンク・OGP 画像生成の基準 URL（末尾スラッシュなし） |
| `ALLOW_DEV_ROLE_SWITCH` | `"false"` | **本番では必ず `"false"`**：開発用のワンタップ Admin 切替ボタンを無効化 |
| `ENABLE_DEMO_SIMULATOR` | `"false"` | **本番では必ず `"false"`**：室内テスト用の仮想ワープ機能を無効化 |

### オプションの環境変数（後から追加可能）

| 環境変数名 | 説明 |
| :--- | :--- |
| `ALLOWED_ORIGINS` | カンマ区切りの追加許可オリジン（Web と API を別ドメインで運用する場合のみ指定） |
| `GOOGLE_MAPS_API_KEY` | Google Places API (New) キー（未設定時は国土地理院 API へ自動フォールバック） |
| `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` | X (Twitter) OAuth 2.0 ログインを有効化する場合に設定 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth ログインを有効化する場合に設定 |
| `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` | Sign in with Apple を有効化する場合に設定 |

---

## 4. Web アプリ & API サーバーのデプロイ手順

### パターンA：Vercel で Web + API を一括デプロイする（最も簡単・推奨）

Next.js アプリ（`apps/web`）内の Route Handler（`apps/web/src/app/api/[[...route]]/route.ts`）に Hono バックエンドが統合されているため、Vercel だけでフロントエンドと API の両方をホストできます。

1. [Vercel](https://vercel.com/) にログインし、GitHub リポジトリ `ryoryo25/seichi-compass-reborn` を Import します。
2. プロジェクト設定で以下を指定します：
   - **Root Directory**: `apps/web`
   - **Framework Preset**: `Next.js`
3. **Environment Variables** に「[3. 本番用環境変数の準備](#3-本番用環境変数の準備)」の環境変数を登録し、**Deploy** をクリックします。

### パターンB：Cloudflare Workers + R2 に API をデプロイする

非公開アルバム写真（巡礼記念写真）に **Cloudflare R2** バケット（`ALBUM_BUCKET`）を利用し、エッジ Worker 上で API を動かす場合の手順です。

```bash
# 1. Cloudflare にログイン
npx wrangler login

# 2. 非公開アルバム用 R2 バケットを作成（初回のみ）
npx wrangler r2 bucket create seichi-compass-album

# 3. 本番シークレットを Cloudflare Workers に登録
npx --workspace=@seichi/api wrangler secret put DATABASE_URL
npx --workspace=@seichi/api wrangler secret put BETTER_AUTH_SECRET

# 4. Cloudflare Workers へ API をデプロイ
npm run deploy:api
```
（※設定ファイルは [`apps/api/wrangler.jsonc`](../apps/api/wrangler.jsonc) に定義されています）

---

## 5. スマホネイティブアプリ（iOS / Android）の単体ビルド＆リリース手順

Expo Go を使わず、スマホのホーム画面に「聖地コンパス」の独立したアイコンが並ぶ単体アプリ（`.apk` / `.aab` / `.ipa`）としてバンドルします。

### 事前準備
1. [expo.dev](https://expo.dev/) で無料アカウントを作成します。
2. EAS CLI をインストールしてログインします：
   ```bash
   npm install -g eas-cli
   eas login
   ```
3. [`apps/mobile/eas.json`](../apps/mobile/eas.json) 内の `EXPO_PUBLIC_API_URL` と `EXPO_PUBLIC_WEB_ORIGIN` を、手順 4 で公開した本番ドメインに書き換えます。

### 方法①：Android スマホに直接インストールできる `.apk` を作る（ストア審査不要・無料）
自分や友人の Android スマホに QR コード経由ですぐにインストールできる単体アプリを作成します。

```bash
cd apps/mobile
eas build --platform android --profile preview
```
- ビルド完了後に表示される URL / QR コードをスマホで開くだけで、「聖地コンパス Reborn」単体アプリとしてインストールできます。
- 単体アプリ化により、アプリを閉じて歩いている時の**バックグラウンド聖地接近通知**もフル機能で動作します。

### 方法②：Google Play / App Store にストア公開する
一般ユーザー向けにストアで公開する場合は `production` プロファイルでビルドします。

```bash
cd apps/mobile
# Android (Google Play 提出用 .aab)
eas build --platform android --profile production

# iOS (App Store / TestFlight 提出用 .ipa)
eas build --platform ios --profile production
```
- **Google Play 公開に必要なもの**: Google Play Console アカウント（初回登録のみ $25）
- **App Store 公開に必要なもの**: Apple Developer Program アカウント（年額 $99）

### 方法③：手元の Mac から USB 接続で実機に直接ビルド転送する（ローカルビルド）
クラウドビルドを使わず、Mac 上の Xcode / Android Studio で直接実機に書き込むことも可能です。

```bash
cd apps/mobile
# iPhone を USB 接続してビルド＆インストール
npx expo run:ios --device

# Android を USB 接続してビルド＆インストール
npx expo run:android --device
```

---

## 6. 本番公開前の最終チェックリスト

- [ ] Neon PostgreSQL に `npm run db:push` と `npm run db:seed` を実行済みか
- [ ] `BETTER_AUTH_SECRET` にランダムな32文字以上の文字列を設定したか
- [ ] `ALLOW_DEV_ROLE_SWITCH="false"` に設定し、一般ユーザーが Admin 切替できないようになっているか
- [ ] `ENABLE_DEMO_SIMULATOR="false"` に設定し、室内テスト用の仮想ワープが無効化されているか
- [ ] 本番環境で最初の管理者（Admin）アカウントを作成する際、Neon の SQL エディタから自分のユーザーの `role` を `'admin'` に更新したか：
  ```sql
  UPDATE users SET role = 'admin' WHERE email = 'あなたのメールアドレス';
  ```
