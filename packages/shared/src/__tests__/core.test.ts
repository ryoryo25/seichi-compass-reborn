import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateBearingDeg,
  estimatePrefecture,
  extractMembersFromText,
  haversineDistanceMeters,
  maskSpotTitle,
  mergeCandidatesIntoSpots,
  parseCsvToCandidates,
  parseGoogleMapsUrl,
  parseKmlToCandidates,
  validateAndParseReferenceUrl,
} from '../index.ts';

const MASK_CHARS = new Set(['〇', '△', '＊', '？']);

describe('maskSpotTitle (deterministic seeded masking)', () => {
  it('returns identical masked strings across repeated calls (prevents reload leaks)', () => {
    const first = maskSpotTitle('spot_123', 'キャットストリート', 'normal');
    const second = maskSpotTitle('spot_123', 'キャットストリート', 'normal');
    assert.equal(first, second);
  });

  it('maintains strict subset revelation from hard -> normal -> easy', () => {
    const title = '横浜スタジアム正面ゲート前';
    const hard = Array.from(maskSpotTitle('spot_abc', title, 'hard'));
    const normal = Array.from(maskSpotTitle('spot_abc', title, 'normal'));
    const easy = Array.from(maskSpotTitle('spot_abc', title, 'easy'));
    const full = Array.from(maskSpotTitle('spot_abc', title, 'full'));

    // full masks every maskable char
    assert.ok(full.every((ch) => MASK_CHARS.has(ch)));

    // Any character visible in hard MUST also be visible in normal and easy
    hard.forEach((ch, idx) => {
      if (!MASK_CHARS.has(ch)) {
        assert.equal(normal[idx], ch);
        assert.equal(easy[idx], ch);
      }
    });
    normal.forEach((ch, idx) => {
      if (!MASK_CHARS.has(ch)) {
        assert.equal(easy[idx], ch);
      }
    });
  });
});

describe('parseGoogleMapsUrl & validateAndParseReferenceUrl', () => {
  it('prioritizes !3d!4d exact pin coords over @lat,lng viewport center', () => {
    const url =
      'https://www.google.com/maps/place/調布駅/@35.650000,139.540000,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d35.651821!4d139.544612';
    const parsed = parseGoogleMapsUrl(url);
    assert.equal(parsed.sourceType, 'pin_3d4d');
    assert.equal(parsed.lat, 35.651821);
    assert.equal(parsed.lng, 139.544612);
    assert.equal(parsed.placeQuery, '調布駅');
  });

  it('blocks non-HTTPS and SSRF private IPs while extracting YouTube timestamps', () => {
    assert.equal(validateAndParseReferenceUrl('javascript:alert(1)').ok, false);
    assert.equal(validateAndParseReferenceUrl('http://example.com').ok, false);
    assert.equal(validateAndParseReferenceUrl('https://127.0.0.1/admin').ok, false);
    assert.equal(validateAndParseReferenceUrl('https://192.168.1.1/test').ok, false);

    const yt = validateAndParseReferenceUrl('https://youtu.be/7njC5lgL61c?t=2m22s');
    assert.equal(yt.ok, true);
    if (yt.ok) {
      assert.equal(yt.trustTier, 'youtube');
      assert.equal(yt.youtubeVideoId, '7njC5lgL61c');
      assert.equal(yt.videoStartSec, 142);
    }
  });
});

describe('Geodesic math & member/KML/CSV extraction', () => {
  it('computes accurate Haversine distance, bearing, and prefecture', () => {
    const dist = haversineDistanceMeters(35.6652, 139.7058, 35.6656, 139.7058);
    assert.ok(dist >= 40 && dist <= 50);
    const bearingNorth = calculateBearingDeg(35.0, 139.0, 36.0, 139.0);
    assert.ok(bearingNorth < 1 || bearingNorth > 359);
    assert.equal(estimatePrefecture(31.911, 131.423), '宮崎県');
  });

  it('extracts Hinatazaka46 members and deduplicates nearby identical spots', () => {
    const members = extractMembersFromText(
      '日向坂ちゃんねるで松田好花と山下葉留花が訪れたカフェ',
    );
    assert.deepEqual(members.sort(), ['山下葉留花', '松田好花'].sort());

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
      <kml><Document><Folder><name>日向ちゃんねる関連</name>
        <Placemark><name>テストカフェ</name><description>松田好花が訪問 https://youtu.be/abc12345?t=30</description><Point><coordinates>139.7058,35.6652,0</coordinates></Point></Placemark>
        <Placemark><name>テストカフェ</name><description>正源司陽子も別動画で訪問</description><Point><coordinates>139.70585,35.66522,0</coordinates></Point></Placemark>
      </Folder></Document></kml>`;

    const candidates = parseKmlToCandidates(kml);
    assert.equal(candidates.length, 2);
    const merged = mergeCandidatesIntoSpots(candidates);
    assert.equal(merged.addedSpots, 1);
    assert.equal(merged.mergedEpisodes, 1);
    assert.equal(merged.spots[0]?.episodes.length, 2);

    const csv = `title,lat,lng,mediaCategory,description,referenceUrl,members,hashtags
晴海橋公園,35.6528,139.7918,ドラマ,声春っ！ロケ地,https://www.hinatazaka46.com/,佐々木美玲|丹生明里,声春っ`;
    const csvParsed = parseCsvToCandidates(csv);
    assert.equal(csvParsed.length, 1);
    assert.ok(csvParsed[0]?.members.includes('佐々木美玲'));
  });
});
