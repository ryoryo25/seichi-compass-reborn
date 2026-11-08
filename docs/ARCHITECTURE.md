# 聖地コンパス Reborn (Seichi Compass Reborn) — Architecture

## 概要
「推しの聖地・ロケ地巡りに宝探しゲームのワクワクを」をコンセプトにした **聖地コンパス** のリメイク版モノレポです。
初期ターゲットとして **日向坂46** の聖地巡礼体験に最適化しつつ、`groupId` による将来の多グループ・他ジャンル展開に対応した設計となっています。

## モノレポ構成
- `packages/shared`: Web・API・将来のモバイルアプリ（Expo）で共有するコアロジック
  - Zod スキーマ・型定義 (`schemas.ts`)
  - スポットIDシード固定・段階的虫食いタイトル生成エンジン (`masking.ts`)
  - 距離・コンパス方位角・ぼかしレーダー円・都道府県推定 (`geo.ts`)
  - 日向坂46メンバーマスタ＆説明文からの自動タグ抽出 (`members.ts`)
  - Google Maps URL 座標解析・参考URL安全性検証・YouTube秒数抽出 (`url-parser.ts`)
  - Googleマイマップ KML / CSV 構造化インポーター＆近接スポット自動統合 (`kml-importer.ts`)
- `packages/db`: データ永続化層
  - 本番用 **Neon (PostgreSQL + PostGIS) + Drizzle ORM + Better Auth** スキーマ定義 (`schema.ts`)
  - プロトタイプが外部クラウド認証情報なしで即動作するローカルリポジトリ実装 (`local-store.ts`)
  - Googleマイマップから構造化・重複統合した初期シードデータ (`seed/hinatazaka-spots.json`)
- `apps/web`: **Next.js (App Router) + Hono RPC API**
  - コンパス探索（リアルGPS/磁気センサー ＋ PC検証用デモ位置シミュレーター）
  - 宝探しレーダーマップ ＆ 通常聖地マップ融合ビュー（`<SeichiMap />` アダプタによる MapLibre GL 実装、将来 Google Maps SDK 差替対応）
  - 聖地・エピソード追加（Google Maps URL解析、ミニマップでのピンドラッグ微調整、半径50m重複検知サジェスト）
  - 自分専用の非公開巡礼アルバム ＋ 到着者限定ひとことコメント ＋ 実績・難易度カスタマイズ設定
  - 管理者向け KML / CSV 一括インポート機能
- `apps/mobile` *(Phase 2 予定)*: **Expo (React Native)** iOS / Android アプリ（バックグラウンド Geofencing 接近通知、共有シート連携）

## 本番クラウド構成（ターゲット）
- **API & Web**: Cloudflare Workers (Hono RPC + OpenNext)
- **Database**: Neon Serverless PostgreSQL + PostGIS
- **Auth**: Better Auth（ゲスト匿名セッション → X / Google / Apple アカウント連携引き継ぎ）
- **Private Storage**: Cloudflare R2（自分専用の巡礼アルバム写真のみ非公開保管）
