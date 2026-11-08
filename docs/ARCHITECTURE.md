# 聖地コンパス Reborn — Production Architecture

## 1. システム全体像

```
[Web Browser (Next.js 15)]          [iOS / Android App (Expo SDK 53)]
  ├─ Web Compass / Geolocation        ├─ 60fps Magnetometer + GPS + Haptics
  ├─ <SeichiMap /> (MapLibre GL)      ├─ <MapView /> (Apple / Google Maps)
  ├─ OGP Share (/spots/[id])          ├─ OS Geofencing (power_save / out_and_about)
  └─ Cookie Session                   └─ SecureStore Bearer Token + Share Sheet URL
                 \                           /
                  v                         v
        [@seichi/api — Hono RPC API (Cloudflare Workers / Next Route)]
          ├─ Auth: Anonymous Guest Session -> Email / OAuth Merge (Better Auth)
          ├─ Geocoder: Google Maps Short-URL Resolver + Places API / 国土地理院 Fallback
          ├─ Domain: @seichi/shared (Seeded Masking, SSRF Guard, KML/CSV Importer)
          ├─ Spatial DB: @seichi/db -> Neon PostgreSQL + PostGIS (GiST ST_DWithin / KNN)
          └─ Private Storage: Cloudflare R2 (ALBUM_BUCKET, Owner-Only Auth Check)
```

## 2. コアドメイン設計のポイント

### ネタバレ防止（座標非漏洩 ＆ 決定論的シード伏せ字）
- **決定論的虫食いマスク (`maskSpotTitle`)**: `spotId` から生成した FNV-1a + Mulberry32 乱数で各文字の開示優先順位を固定。リロードしても別の文字が漏れず、`full ⊂ hard ⊂ normal ⊂ easy` の単調開示が数学的に保証されます。
- **未訪問座標の秘匿 (`radarLat` / `radarLng`)**: `treasure` モード時は未訪問スポットの真の座標 (`exactLat`/`exactLng`) をAPIレスポンスから除外し、120〜380mオフセットした決定論的レーダー中心座標とサーバー計算距離のみを返却します。モバイルの省電力OSジオフェンスでもこの `radarLat`/`radarLng` を中心に `380m + 通知半径` の領域を張ることで、通信傍受による座標特定を防ぎながら確実な接近通知を実現しています。

### 1スポット × 複数登場シーン構造 ＆ 二重登録防止
- 同一施設でMV・冠番組・ブログなど複数回登場するケースに対応するため、`spots`（物理場所）と `spot_episodes`（登場シーン）を `1:N` で分離。
- 新規登録時およびKML/CSV一括インポート時に半径 `60m` 以内の近接スポットを PostGIS `ST_DWithin` で高速検索し、新規ピン乱立ではなく既存スポットへのエピソード追記へ誘導します。

### 著作権・プライバシー保護
- **公式コンテンツへの還元**: 公式画像やキャプチャの転載機能を持たせず、HTTPS検証済みの公式YouTube（再生開始秒数パラメータ対応）・公式ブログURLへの誘導に特化。
- **完全非公開の巡礼アルバム**: ユーザーが現地で撮影した記念写真は Cloudflare R2 非公開バケット (`ALBUM_BUCKET`) に格納され、`/api/me/visits/:spotId/photo` にてセッションオーナー本人のみが取得可能です。他ユーザーには一切露出せず、ゲストから本登録へ連携した際も `mergeAnonymousUserData` によりR2キーごと引き継がれます。
