import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { R2LikeBucket } from '@seichi/db';
import {
  ApiMetaResponseSchema,
  haversineDistanceMeters,
  MaskedSpotSummarySchema,
  RADAR_CIRCLE_RADIUS_METERS,
  RADAR_MAX_OFFSET_METERS,
  ResolvedLocationResponseSchema,
} from '@seichi/shared';
import { type ApiBindings, apiApp } from '../app.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localDataDir = path.resolve(__dirname, '../../../../.local-data');
const hadLocalDataBefore = fs.existsSync(localDataDir);

after(() => {
  if (!hadLocalDataBefore && fs.existsSync(localDataDir)) {
    fs.rmSync(localDataDir, { recursive: true, force: true });
  }
});

function createMemoryR2Bucket(): R2LikeBucket & { keys: () => string[] } {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    keys: () => Array.from(store.keys()),
    async put(key, value, options) {
      const bytes =
        value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
      store.set(key, {
        bytes,
        contentType: options?.httpMetadata?.contentType,
      });
    },
    async get(key) {
      const item = store.get(key);
      if (!item) return null;
      return {
        async arrayBuffer() {
          return item.bytes.buffer.slice(
            item.bytes.byteOffset,
            item.bytes.byteOffset + item.bytes.byteLength,
          ) as ArrayBuffer;
        },
        httpMetadata: { contentType: item.contentType },
      };
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

// 1x1 透過PNG DataURL
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('@seichi/api Hono RPC 統合テスト', () => {
  it('C-1: 開発用フラグ未設定時（本番相当）は dev-role / demo/approach が 403 でフェイルクローズになること', async () => {
    const prodEnv: ApiBindings = {};

    const metaRes = await apiApp.request('https://seichi.example/api/meta', {}, prodEnv);
    assert.equal(metaRes.status, 200);
    const metaJson = ApiMetaResponseSchema.parse(await metaRes.json());
    assert.equal(metaJson.allowDevRoleSwitch, false);
    assert.equal(metaJson.enableDemoSimulator, false);

    const sessionRes = await apiApp.request(
      'https://seichi.example/api/auth/session',
      { method: 'POST' },
      prodEnv,
    );
    const sessionData = (await sessionRes.json()) as { sessionToken: string };

    const devRoleRes = await apiApp.request(
      'https://seichi.example/api/me/dev-role',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.sessionToken}`,
        },
        body: JSON.stringify({ role: 'admin' }),
      },
      prodEnv,
    );
    assert.equal(devRoleRes.status, 403);

    const demoRes = await apiApp.request(
      'https://seichi.example/api/demo/approach/spot_gme98q_0',
      { method: 'POST' },
      prodEnv,
    );
    assert.equal(demoRes.status, 403);
  });

  it('C-3: /api/locations/resolve のレスポンスがモバイル・Web共通スキーマと一致すること', async () => {
    const res = await apiApp.request(
      'https://seichi.example/api/locations/resolve',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input:
            'https://www.google.com/maps/place/%E6%A8%AA%E6%B5%9C%E3%82%B9%E3%82%BF%E3%82%B8%E3%82%A2%E3%83%A0/@35.443,139.638,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d35.443221!4d139.640108',
        }),
      },
      {},
    );
    assert.equal(res.status, 200);
    const parsed = ResolvedLocationResponseSchema.parse(await res.json());
    assert.equal(parsed.lat, 35.443221);
    assert.equal(parsed.lng, 139.640108);
    assert.equal(parsed.placeQuery, '横浜スタジアム');
  });

  it('C-5: CORS が未許可オリジンを拒否し、許可オリジンのみ反映・HTTPS時に Secure Cookie を付与すること', async () => {
    const env: ApiBindings = {
      ALLOWED_ORIGINS: 'https://app.seichi.example',
    };

    const blockedRes = await apiApp.request(
      'https://api.seichi.example/api/meta',
      {
        headers: { Origin: 'https://evil.example' },
      },
      env,
    );
    assert.equal(blockedRes.headers.get('Access-Control-Allow-Origin'), null);

    const allowedRes = await apiApp.request(
      'https://api.seichi.example/api/auth/session',
      {
        method: 'POST',
        headers: { Origin: 'https://app.seichi.example' },
      },
      env,
    );
    assert.equal(
      allowedRes.headers.get('Access-Control-Allow-Origin'),
      'https://app.seichi.example',
    );
    assert.equal(
      allowedRes.headers.get('Access-Control-Allow-Credentials'),
      'true',
    );
    const setCookieHeader = allowedRes.headers.get('Set-Cookie') ?? '';
    assert.ok(setCookieHeader.includes('HttpOnly'));
    assert.ok(setCookieHeader.includes('Secure'));
  });

  it('H-1 / H-5 / M-4: treasure検索の座標秘匿・レーダー円包含・タグ非表示時の推しメン通知一致・単体summary取得', async () => {
    const searchRes = await apiApp.request(
      'https://seichi.example/api/spots/search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: 35.6626,
          lng: 139.7038,
          limit: 25,
          maskLevel: 'normal',
          tagVisibility: 'none',
          mapMode: 'treasure',
          notificationMembers: ['小坂菜緒'],
        }),
      },
      {},
    );
    assert.equal(searchRes.status, 200);
    const { spots } = (await searchRes.json()) as { spots: unknown[] };
    assert.ok(spots.length > 0);

    for (const raw of spots) {
      const s = MaskedSpotSummarySchema.parse(raw);
      assert.equal(s.exactLat, undefined);
      assert.equal(s.exactLng, undefined);
      assert.deepEqual(s.visibleMembers, []);
      assert.equal(typeof s.matchesNotificationMembers, 'boolean');
    }

    // 単体サマリ取得 (H-5) & standard モードとの比較でレーダー円包含確認 (H-1)
    const targetId = (spots[0] as { id: string }).id;
    const summaryTreasureRes = await apiApp.request(
      `https://seichi.example/api/spots/${encodeURIComponent(targetId)}/summary?lat=35.6626&lng=139.7038&mapMode=treasure`,
      {},
      {},
    );
    assert.equal(summaryTreasureRes.status, 200);
    const treasureSummary = MaskedSpotSummarySchema.parse(
      ((await summaryTreasureRes.json()) as { spot: unknown }).spot,
    );

    const summaryStdRes = await apiApp.request(
      `https://seichi.example/api/spots/${encodeURIComponent(targetId)}/summary?lat=35.6626&lng=139.7038&mapMode=standard`,
      {},
      {},
    );
    const stdSummary = MaskedSpotSummarySchema.parse(
      ((await summaryStdRes.json()) as { spot: unknown }).spot,
    );
    assert.ok(stdSummary.exactLat !== undefined && stdSummary.exactLng !== undefined);

    const offsetDist = haversineDistanceMeters(
      stdSummary.exactLat!,
      stdSummary.exactLng!,
      treasureSummary.radarLat,
      treasureSummary.radarLng,
    );
    assert.ok(offsetDist <= RADAR_MAX_OFFSET_METERS + 2);
    assert.ok(offsetDist < RADAR_CIRCLE_RADIUS_METERS);
  });

  it('認証・解禁・R2非公開写真の本人限定認可・ゲスト記録引き継ぎ・スポット削除時のR2クリーンアップ (M-3)', async () => {
    const bucket = createMemoryR2Bucket();
    const env: ApiBindings = {
      ALBUM_BUCKET: bucket,
      ALLOW_DEV_ROLE_SWITCH: 'true',
      ENABLE_DEMO_SIMULATOR: 'true',
    };

    // 1. ゲストセッション作成
    const guestSessionRes = await apiApp.request(
      'https://seichi.example/api/auth/session',
      { method: 'POST' },
      env,
    );
    const guestSession = (await guestSessionRes.json()) as {
      sessionToken: string;
    };

    // 2. 新規テスト用アカウントで専用スポットを作成して削除テストにも使うため、まず別ユーザーを用意
    const otherSessionRes = await apiApp.request(
      'https://seichi.example/api/auth/session',
      { method: 'POST' },
      env,
    );
    const otherSession = (await otherSessionRes.json()) as {
      sessionToken: string;
    };

    // 3. ゲストがデモ接近座標を使って聖地を正規解禁 (arrive)
    const approachRes = await apiApp.request(
      'https://seichi.example/api/demo/approach/spot_gme98q_0',
      { method: 'POST' },
      env,
    );
    assert.equal(approachRes.status, 200);
    const nearPos = (await approachRes.json()) as { lat: number; lng: number };

    const unlockRes = await apiApp.request(
      'https://seichi.example/api/spots/spot_gme98q_0/unlock',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${guestSession.sessionToken}`,
        },
        body: JSON.stringify({
          userLat: nearPos.lat,
          userLng: nearPos.lng,
          mode: 'arrive',
          mapMode: 'treasure',
        }),
      },
      env,
    );
    assert.equal(unlockRes.status, 200);
    const unlockData = (await unlockRes.json()) as {
      visit: { status: string; selfDiscovered: boolean };
    };
    assert.equal(unlockData.visit.status, 'visited');
    assert.equal(unlockData.visit.selfDiscovered, true);

    // 4. ゲストが自分専用の非公開写真を R2 へ保存
    const putPhotoRes = await apiApp.request(
      'https://seichi.example/api/me/visits/spot_gme98q_0/photo',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${guestSession.sessionToken}`,
        },
        body: JSON.stringify({ dataUrl: TINY_PNG_DATA_URL }),
      },
      env,
    );
    assert.equal(putPhotoRes.status, 200);
    assert.equal(bucket.keys().length, 1);

    // 5. 他ユーザーからは非公開写真を取得できないこと (404)
    const forbiddenPhotoRes = await apiApp.request(
      'https://seichi.example/api/me/visits/spot_gme98q_0/photo',
      {
        headers: { Authorization: `Bearer ${otherSession.sessionToken}` },
      },
      env,
    );
    assert.equal(forbiddenPhotoRes.status, 404);

    // 6. ゲストから本登録へサインアップすると訪問記録とR2写真が自動引き継ぎされること
    const uniqueEmail = `test_${Date.now()}@seichi.example`;
    const signupRes = await apiApp.request(
      'https://seichi.example/api/auth/signup',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${guestSession.sessionToken}`,
        },
        body: JSON.stringify({
          name: 'テストおひさま',
          email: uniqueEmail,
          password: 'password1234',
        }),
      },
      env,
    );
    assert.equal(signupRes.status, 200);
    const signupData = (await signupRes.json()) as {
      sessionToken: string;
      visits: Record<string, { hasPrivatePhoto: boolean }>;
    };
    assert.equal(signupData.visits.spot_gme98q_0?.hasPrivatePhoto, true);

    // 引き継ぎ後の新セッショントークンで本人写真を取得できること (200)
    const ownerPhotoRes = await apiApp.request(
      'https://seichi.example/api/me/visits/spot_gme98q_0/photo',
      {
        headers: { Authorization: `Bearer ${signupData.sessionToken}` },
      },
      env,
    );
    assert.equal(ownerPhotoRes.status, 200);
    assert.equal(ownerPhotoRes.headers.get('Content-Type'), 'image/png');

    // 7. テスト用スポット新規作成 -> 訪問&写真保存 -> Admin削除でR2オブジェクトも連動削除されること
    const createSpotRes = await apiApp.request(
      'https://seichi.example/api/spots',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${signupData.sessionToken}`,
        },
        body: JSON.stringify({
          title: '統合テスト一時スポット',
          lat: 35.123456,
          lng: 139.123456,
          arrivalRadiusMeters: 80,
          mediaCategory: 'youtube',
          description: '統合テスト用のエピソード',
          members: ['小坂菜緒'],
          hashtags: ['テスト'],
        }),
      },
      env,
    );
    assert.equal(createSpotRes.status, 200);
    const createdSpot = (
      (await createSpotRes.json()) as { spot: { id: string } }
    ).spot;

    await apiApp.request(
      `https://seichi.example/api/spots/${createdSpot.id}/unlock`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${signupData.sessionToken}`,
        },
        body: JSON.stringify({
          userLat: 35.123456,
          userLng: 139.123456,
          mode: 'arrive',
          mapMode: 'treasure',
        }),
      },
      env,
    );
    await apiApp.request(
      `https://seichi.example/api/me/visits/${createdSpot.id}/photo`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${signupData.sessionToken}`,
        },
        body: JSON.stringify({ dataUrl: TINY_PNG_DATA_URL }),
      },
      env,
    );
    assert.equal(bucket.keys().length, 2);

    // Admin 昇格（開発フラグ有効環境）して一時スポットを削除
    await apiApp.request(
      'https://seichi.example/api/me/dev-role',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${signupData.sessionToken}`,
        },
        body: JSON.stringify({ role: 'admin' }),
      },
      env,
    );

    const delRes = await apiApp.request(
      `https://seichi.example/api/admin/spots/${createdSpot.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${signupData.sessionToken}` },
      },
      env,
    );
    assert.equal(delRes.status, 200);
    // 削除されたスポットに紐づくR2キーがクリーンアップされ、元の1件のみ残ること
    assert.equal(bucket.keys().length, 1);
  });
});
