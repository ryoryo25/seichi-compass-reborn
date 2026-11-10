# 聖地コンパス Reborn (Seichi Compass Reborn)

「推しの聖地・ロケ地巡りに宝探しゲームのワクワクを」—— 2024年の **聖地コンパス** を、**TypeScript モノレポ（Next.js 15 + Cloudflare Workers / Hono RPC + Neon PostGIS + Better Auth + Cloudflare R2 + Expo React Native）** としてフルリメイクした本実装リポジトリです。

初期ターゲットは **日向坂46**（「日向坂46 聖地一覧」Googleマイマップをベースに構造化・近接統合した **4,270スポット / 4,501登場シーン** を初期収録し、`groupId` による他グループ展開にも対応）。

## モノレポ構成

| ワークスペース | 概要 |
| --- | --- |
| `packages/shared` (`@seichi/shared`) | Zodスキーマ、スポットID固定シード虫食いエンジン、測地計算、日向坂46メンバー自動抽出、Google Maps URL解析・SSRF防御、KML/CSVインポーター＆単体テスト |
| `packages/db` (`@seichi/db`) | Drizzle ORM + **Neon Serverless PostgreSQL (`PostGIS`)** + **Better Auth** + **Cloudflare R2** 非公開アルバム層（`DATABASE_URL` 未設定時は `.local-data/` 永続化へ自動フォールバック） |
| `apps/api` (`@seichi/api`) | **Cloudflare Workers + Hono RPC** バックエンド（Cookie / Bearer両対応認証、R2オーナー限定写真配信、Google Places / 国土地理院ハイブリッドジオコーダ、管理者KML/CSV/MyMap URL一括インポート＆通報審査） |
| `apps/web` (`@seichi/web`) | **Next.js 15 (App Router)** Webアプリ（コンパス探索、宝探しレーダー＆通常マップ融合 `<SeichiMap />`、60m重複検知付き聖地登録、ネタバレ防止XシェアOGP `/spots/[id]`、公開実績 `/users/[id]`） |
| `apps/mobile` (`@seichi/mobile`) | **Expo (React Native)** iOS / Android ネイティブアプリ（60fps磁気コンパス＆Haptics到着振動、省電力OSジオフェンス＆お出かけ中モード接近通知、Googleマップ共有URL自動取込、カメラR2非公開アルバム保存） |

## クイックスタート（ローカル開発）

クラウドのAPIキーやDB接続情報が未設定の状態でも、ローカル永続化＆国土地理院ジオコーダにより全機能がそのまま動作します。

```bash
# 1. 依存パッケージのインストール
npm install

# 2. 単体テスト & 全ワークスペース型チェック
npm test
npm run typecheck

# 3. Web + API 開発サーバー起動 (http://localhost:3000)
npm run dev

# 4. Expo モバイルアプリ起動（別ターミナル）
npm run dev:mobile
```

## 本番環境（Neon PostGIS + Cloudflare Workers + R2）セットアップ

1. `.env.example` を `.env` にコピーし、`DATABASE_URL`（Neon PostgreSQL）と `BETTER_AUTH_SECRET` を設定します。
2. PostGIS拡張の有効化とスキーマ反映・初期シード投入を実行します：
   ```bash
   # Neon上で CREATE EXTENSION IF NOT EXISTS postgis; 実行後:
   npm run db:push
   npm run db:seed
   ```
3. Cloudflare Workers（スタンドアロンAPI + R2バケット `ALBUM_BUCKET`）へデプロイする場合：
   ```bash
   npm run deploy:api
   ```

詳細なアーキテクチャ・セキュリティ設計は [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)、本番デプロイおよび iOS/Android 単体アプリのビルド手順は [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) を参照してください。
