import {
  formatDistance,
  MEDIA_CATEGORY_META,
  type MaskedSpotSummary,
  type Spot,
  type SpotComment,
  type SpotReportReason,
  type VisitRecord,
} from '@seichi/shared';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { mobileApi } from '@/api/client.ts';
import { useApp } from '@/context/AppContext.tsx';

export default function NativeCompassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const spotId = String(id ?? '');

  const {
    meta,
    spots,
    visits,
    coords,
    settings,
    setSimulatedCoords,
    reloadSession,
    refreshSpots,
  } = useApp();

  const listSummary = spots.find((s) => s.id === spotId);
  const [fallbackSummary, setFallbackSummary] =
    useState<MaskedSpotSummary | null>(null);
  const summary =
    listSummary ??
    (fallbackSummary?.id === spotId ? fallbackSummary : undefined);
  const existingVisit = visits[spotId];

  const [deviceHeadingDeg, setDeviceHeadingDeg] = useState(0);
  const [livePos, setLivePos] = useState(coords);
  const [distanceMeters, setDistanceMeters] = useState(
    summary?.distanceMeters ?? 9999,
  );
  const [bearingDeg, setBearingDeg] = useState(summary?.bearingDeg ?? 0);
  const [arrivalRadiusMeters, setArrivalRadiusMeters] = useState(
    summary?.arrivalRadiusMeters ?? 80,
  );

  const [unlockedSpot, setUnlockedSpot] = useState<Spot | null>(null);
  const [visitRecord, setVisitRecord] = useState<VisitRecord | undefined>(
    existingVisit,
  );
  const [comments, setComments] = useState<SpotComment[]>([]);
  const [privateMemo, setPrivateMemo] = useState(
    existingVisit?.privateMemo ?? '',
  );
  const [privatePhotoSource, setPrivatePhotoSource] = useState<{
    uri: string;
    headers?: Record<string, string>;
  } | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentPublic, setCommentPublic] = useState(
    settings.defaultPublicComment,
  );
  const [busy, setBusy] = useState(false);

  const hapticTriggeredRef = useRef(false);
  const loadedUnlockedSpotRef = useRef<string | null>(null);

  // ディープリンクやプッシュ通知で最寄り250件外の聖地が開かれた場合も単体サマリを取得
  useEffect(() => {
    if (!spotId || listSummary) return;
    let cancelled = false;
    void mobileApi
      .fetchSpotSummary(spotId, {
        lat: coords.lat,
        lng: coords.lng,
        maskLevel: settings.maskLevel,
        tagVisibility: settings.tagVisibility,
        mapMode: settings.mapMode,
      })
      .then((res) => {
        if (!cancelled) {
          setFallbackSummary(res.spot);
          setDistanceMeters(res.spot.distanceMeters);
          setBearingDeg(res.spot.bearingDeg);
          setArrivalRadiusMeters(res.spot.arrivalRadiusMeters);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    spotId,
    listSummary,
    coords.lat,
    coords.lng,
    settings.maskLevel,
    settings.tagVisibility,
    settings.mapMode,
  ]);

  // 1. 電子磁気コンパス（60fps滑らかな方角追従） + 高精度GPS距離更新
  useEffect(() => {
    let headingSub: Location.LocationSubscription | null = null;
    let posSub: Location.LocationSubscription | null = null;

    void (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return;

      headingSub = await Location.watchHeadingAsync((heading) => {
        const deg =
          heading.trueHeading >= 0 ? heading.trueHeading : heading.magHeading;
        setDeviceHeadingDeg(deg);
      });

      posSub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 3,
          timeInterval: 2500,
        },
        (loc) => {
          setLivePos({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          });
        },
      );
    })();

    return () => {
      headingSub?.remove();
      posSub?.remove();
    };
  }, []);

  // 2. サーバーから現在地との正確な距離・方位を取得（未訪問でも正確な座標自体はクライアントへ渡さない）
  const syncBearing = useCallback(
    async (lat: number, lng: number) => {
      if (!spotId) return;
      try {
        const res = await mobileApi.fetchBearing(spotId, lat, lng);
        setDistanceMeters(res.distanceMeters);
        setBearingDeg(res.bearingDeg);
        setArrivalRadiusMeters(res.arrivalRadiusMeters);

        if (
          res.distanceMeters <= res.arrivalRadiusMeters &&
          !hapticTriggeredRef.current
        ) {
          hapticTriggeredRef.current = true;
          void Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          );
        }
      } catch {
        // Ignore transient network errors
      }
    },
    [spotId],
  );

  useEffect(() => {
    void syncBearing(livePos.lat, livePos.lng);
  }, [livePos.lat, livePos.lng, syncBearing]);

  // 3. 既に解禁済みの場合は初回のみスポット詳細と非公開写真を読み込み（歩行中のGPS更新でメモ入力が上書きされないようガード）
  useEffect(() => {
    if (!existingVisit || !spotId) return;
    if (loadedUnlockedSpotRef.current === spotId) return;
    loadedUnlockedSpotRef.current = spotId;
    void mobileApi
      .unlockSpot(spotId, {
        userLat: coords.lat,
        userLng: coords.lng,
        mode: 'view_unlocked',
        mapMode: settings.mapMode,
      })
      .then((res) => {
        setUnlockedSpot(res.spot);
        if (res.visit) {
          setVisitRecord(res.visit);
          setPrivateMemo(res.visit.privateMemo ?? '');
        }
        setComments(res.comments);
      })
      .catch(() => {
        loadedUnlockedSpotRef.current = null;
      });
  }, [existingVisit, spotId, coords.lat, coords.lng, settings.mapMode]);

  useEffect(() => {
    if (!visitRecord?.hasPrivatePhoto) return;
    void mobileApi
      .getPrivatePhotoImageSource(spotId, visitRecord.visitedAt)
      .then(setPrivatePhotoSource);
  }, [visitRecord?.hasPrivatePhoto, visitRecord?.visitedAt, spotId]);

  const relativeArrowAngle = (bearingDeg - deviceHeadingDeg + 360) % 360;
  const withinArrivalZone = distanceMeters <= arrivalRadiusMeters;

  const handleUnlock = async (mode: 'arrive' | 'give_up') => {
    setBusy(true);
    try {
      const res = await mobileApi.unlockSpot(spotId, {
        userLat: livePos.lat,
        userLng: livePos.lng,
        mode,
        mapMode: settings.mapMode,
      });
      setUnlockedSpot(res.spot);
      setVisitRecord(res.visit);
      setComments(res.comments);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await reloadSession();
      await refreshSpots();
    } catch (err) {
      Alert.alert(
        '解禁できませんでした',
        err instanceof Error ? err.message : 'もう少し聖地に近づいてください',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDemoApproach = async () => {
    try {
      const demo = await mobileApi.simulateDemoApproach(spotId);
      setLivePos(demo);
      setSimulatedCoords(demo.lat, demo.lng);
      await syncBearing(demo.lat, demo.lng);
    } catch (err) {
      Alert.alert(
        'デモ移動エラー',
        err instanceof Error ? err.message : '移動できませんでした',
      );
    }
  };

  const handlePickOrTakePhoto = async (useCamera: boolean) => {
    const perm = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('権限が必要です', '写真へのアクセスを許可してください');
      return;
    }

    const result = useCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.72,
          base64: true,
          allowsEditing: true,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.72,
          base64: true,
          allowsEditing: true,
        });

    const asset = result.assets?.[0];
    if (result.canceled || !asset?.base64) return;

    const mime = asset.mimeType ?? 'image/jpeg';
    const dataUrl = `data:${mime};base64,${asset.base64}`;

    setBusy(true);
    try {
      const saved = await mobileApi.uploadVisitPhoto(spotId, dataUrl);
      setVisitRecord(saved.visit);
      const src = await mobileApi.getPrivatePhotoImageSource(
        spotId,
        String(Date.now()),
      );
      setPrivatePhotoSource(src);
      await reloadSession();
      Alert.alert(
        '保存完了',
        '自分専用の非公開巡礼アルバム（Cloudflare R2）に写真を保存しました！',
      );
    } catch (err) {
      Alert.alert(
        'アップロード失敗',
        err instanceof Error ? err.message : '保存できませんでした',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSaveMemo = async () => {
    try {
      const saved = await mobileApi.saveVisitMemo(spotId, privateMemo);
      setVisitRecord(saved.visit);
      await reloadSession();
      Alert.alert('保存完了', '非公開メモを保存しました');
    } catch (err) {
      Alert.alert(
        '保存失敗',
        err instanceof Error ? err.message : 'メモ保存に失敗しました',
      );
    }
  };

  const handlePostComment = async () => {
    if (!commentText.trim()) return;
    try {
      const res = await mobileApi.addComment(spotId, {
        authorName: settings.nickname,
        content: commentText.trim(),
        isPublic: commentPublic,
      });
      setComments((prev) => [res.comment, ...prev]);
      setCommentText('');
    } catch (err) {
      Alert.alert(
        '投稿エラー',
        err instanceof Error ? err.message : '投稿できませんでした',
      );
    }
  };

  const handleShareX = () => {
    const shareBaseUrl =
      process.env.EXPO_PUBLIC_WEB_ORIGIN ?? 'https://seichi-compass.example.com';
    const maskedHint = summary?.displayTitle ?? '？？？';
    const text =
      visitRecord?.status === 'visited'
        ? `日向坂46の聖地『${maskedHint}』（${unlockedSpot?.prefecture ?? summary?.prefecture ?? ''}）に巡礼達成しました！🧭✨ #聖地コンパス #日向坂46`
        : `日向坂46の聖地『${maskedHint}』を探索中！🧭 #聖地コンパス #日向坂46`;
    const shareUrl = `${shareBaseUrl}/spots/${encodeURIComponent(spotId)}`;
    const intentUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
    void Linking.openURL(intentUrl);
  };

  const handleReport = (reason: SpotReportReason) => {
    void mobileApi
      .reportSpot(spotId, { reason })
      .then(() =>
        Alert.alert('通報を受け付けました', '管理者が位置・内容を確認いたします。'),
      )
      .catch(() => Alert.alert('エラー', '通報の送信に失敗しました'));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* コンパスダイヤルカード */}
      <View style={styles.compassCard}>
        <Text style={styles.prefPill}>
          {unlockedSpot?.prefecture ?? summary?.prefecture ?? '聖地探索'}
        </Text>
        <Text style={styles.spotHeading}>
          {unlockedSpot ? unlockedSpot.title : (summary?.displayTitle ?? '？？？')}
        </Text>

        <View
          style={[
            styles.compassDial,
            withinArrivalZone && styles.compassDialArrived,
          ]}
        >
          <Text
            style={[
              styles.compassNeedle,
              { transform: [{ rotate: `${relativeArrowAngle}deg` }] },
            ]}
          >
            ⬆️
          </Text>
          <Text style={styles.distanceBig}>
            {formatDistance(distanceMeters)}
          </Text>
          <Text style={styles.arrivalHint}>
            {withinArrivalZone
              ? '🎉 到着判定圏内に入りました！'
              : `到着解禁まで半径 ${arrivalRadiusMeters}m 以内へ接近`}
          </Text>
        </View>

        {/* アクションボタン群 */}
        {(!unlockedSpot || visitRecord?.status === 'give_up') && (
          <View style={styles.actionGroup}>
            <Pressable
              style={[
                styles.arriveBtn,
                !withinArrivalZone && styles.arriveBtnDisabled,
              ]}
              onPress={() => void handleUnlock('arrive')}
              disabled={busy}
            >
              <Text style={styles.arriveBtnText}>
                {visitRecord?.status === 'give_up'
                  ? '🎉 現地に到着して「訪問達成」へ昇格する！'
                  : '🎉 聖地に到着！封印を解く'}
              </Text>
            </Pressable>

            {!unlockedSpot && (
              <Pressable
                style={styles.giveUpBtn}
                onPress={() =>
                  Alert.alert(
                    'ギブアップ救済確認',
                    '現在地から離れていても正解・元ネタ詳細を閲覧できます（訪問実績バッジは付与されませんが、後日現地へ行けば訪問達成に昇格できます）。開きますか？',
                    [
                      { text: 'まだ自力で探す', style: 'cancel' },
                      {
                        text: '正解を見る',
                        onPress: () => void handleUnlock('give_up'),
                      },
                    ],
                  )
                }
                disabled={busy}
              >
                <Text style={styles.giveUpBtnText}>
                  🏳️ どうしても分からないので正解を見る（救済）
                </Text>
              </Pressable>
            )}

            {meta?.enableDemoSimulator !== false && (
              <Pressable
                style={styles.demoBtn}
                onPress={() => void handleDemoApproach()}
              >
                <Text style={styles.demoBtnText}>
                  🧪 室内テスト用: 聖地の近く（約35m手前）へ仮想ワープ
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {/* 解禁後の元ネタ・登場シーン詳細 */}
      {unlockedSpot && (
        <>
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>
                🎬 登場エピソード（全{unlockedSpot.episodes.length}シーン）
              </Text>
              <Pressable style={styles.xShareBtn} onPress={handleShareX}>
                <Text style={styles.xShareText}>𝕏 ネタバレ防止シェア</Text>
              </Pressable>
            </View>

            {unlockedSpot.episodes.map((ep) => (
              <View key={ep.id} style={styles.episodeBox}>
                <View style={styles.epBadgeRow}>
                  <Text
                    style={[
                      styles.epMediaBadge,
                      { color: MEDIA_CATEGORY_META[ep.mediaCategory].color },
                    ]}
                  >
                    ● {MEDIA_CATEGORY_META[ep.mediaCategory].label}
                  </Text>
                </View>
                <Text style={styles.epDesc}>{ep.description}</Text>
                {ep.members.length > 0 && (
                  <Text style={styles.epMembers}>
                    参加メンバー: {ep.members.join('・')}
                  </Text>
                )}
                {ep.referenceUrl ? (
                  <Pressable
                    style={styles.linkBtn}
                    onPress={() => void Linking.openURL(ep.referenceUrl!)}
                  >
                    <Text style={styles.linkBtnText}>
                      🔗 公式動画・元記事を開く
                      {ep.videoStartSec
                        ? `（${Math.floor(ep.videoStartSec / 60)}分${ep.videoStartSec % 60}秒〜）`
                        : ''}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>

          {/* 自分専用の非公開アルバム（カメラ・ライブラリ → R2非公開保存） */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              🔒 自分専用の非公開巡礼アルバム（他人に非公開）
            </Text>
            {privatePhotoSource && (
              <Image
                source={privatePhotoSource}
                style={styles.privatePhotoPreview}
                resizeMode="cover"
              />
            )}
            <View style={styles.photoBtnRow}>
              <Pressable
                style={styles.photoBtn}
                onPress={() => void handlePickOrTakePhoto(true)}
              >
                <Text style={styles.photoBtnText}>📷 カメラで記念撮影</Text>
              </Pressable>
              <Pressable
                style={styles.photoBtn}
                onPress={() => void handlePickOrTakePhoto(false)}
              >
                <Text style={styles.photoBtnText}>🖼️ アルバムから選択</Text>
              </Pressable>
            </View>

            <TextInput
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
              multiline
              placeholder="自分だけの巡礼メモ（当時の天気や感想など）"
              placeholderTextColor="#94a3b8"
              value={privateMemo}
              onChangeText={setPrivateMemo}
            />
            <Pressable
              style={styles.saveMemoBtn}
              onPress={() => void handleSaveMemo()}
            >
              <Text style={styles.saveMemoText}>非公開メモを保存</Text>
            </Pressable>
          </View>

          {/* 聖地ノート（テキストのみ公開/非公開切替コメント） */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              💬 巡礼者ひとことノート（テキストのみ）
            </Text>
            <TextInput
              style={styles.input}
              placeholder="現地の雰囲気や感想をひとこと..."
              placeholderTextColor="#94a3b8"
              value={commentText}
              onChangeText={setCommentText}
            />
            <View style={styles.commentFooter}>
              <View style={styles.publicToggle}>
                <Switch value={commentPublic} onValueChange={setCommentPublic} />
                <Text style={styles.publicToggleText}>
                  {commentPublic ? '他の到着者にも公開' : '自分のみ表示'}
                </Text>
              </View>
              <Pressable
                style={styles.postCommentBtn}
                onPress={() => void handlePostComment()}
              >
                <Text style={styles.postCommentText}>投稿</Text>
              </Pressable>
            </View>

            {comments.map((c) => (
              <View key={c.id} style={styles.commentItem}>
                <Text style={styles.commentAuthor}>
                  {c.authorName} {!c.isPublic ? '🔒' : ''}
                </Text>
                <Text style={styles.commentBody}>{c.content}</Text>
              </View>
            ))}
          </View>

          {/* 通報・修正提案 */}
          <View style={styles.reportRow}>
            <Pressable
              onPress={() =>
                Alert.alert('スポットの修正・通報', '理由を選択してください', [
                  {
                    text: 'ピンの位置がずれている',
                    onPress: () => handleReport('wrong_location'),
                  },
                  {
                    text: '閉店・立ち入り不可',
                    onPress: () => handleReport('closed_or_changed'),
                  },
                  {
                    text: '重複スポットがある',
                    onPress: () => handleReport('duplicate'),
                  },
                  { text: 'キャンセル', style: 'cancel' },
                ])
              }
            >
              <Text style={styles.reportLink}>
                🚩 ピン位置ずれ・閉店などを管理者に知らせる
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 14, gap: 14, paddingBottom: 44 },
  compassCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  prefPill: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0369a1',
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  spotHeading: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0f172a',
    marginTop: 8,
    textAlign: 'center',
  },
  compassDial: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#f0f9ff',
    borderWidth: 5,
    borderColor: '#38bdf8',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 18,
    padding: 12,
  },
  compassDialArrived: {
    backgroundColor: '#ecfdf5',
    borderColor: '#10b981',
  },
  compassNeedle: { fontSize: 54 },
  distanceBig: {
    fontSize: 28,
    fontWeight: '900',
    color: '#0c4a6e',
    marginTop: 6,
  },
  arrivalHint: {
    fontSize: 11,
    color: '#475569',
    textAlign: 'center',
    marginTop: 4,
    fontWeight: '600',
  },
  actionGroup: { width: '100%', gap: 8 },
  arriveBtn: {
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  arriveBtnDisabled: { backgroundColor: '#94a3b8' },
  arriveBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  giveUpBtn: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
  },
  giveUpBtnText: { color: '#92400e', fontSize: 12, fontWeight: '700' },
  demoBtn: {
    backgroundColor: '#f1f5f9',
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  demoBtnText: { color: '#475569', fontSize: 11, fontWeight: '600' },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#0c4a6e', flexShrink: 1 },
  xShareBtn: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  xShareText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  episodeBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    gap: 5,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  epBadgeRow: { flexDirection: 'row', alignItems: 'center' },
  epMediaBadge: { fontSize: 12, fontWeight: '800' },
  epDesc: { fontSize: 13, color: '#1e293b', lineHeight: 19 },
  epMembers: { fontSize: 12, color: '#0369a1', fontWeight: '600' },
  linkBtn: {
    marginTop: 4,
    backgroundColor: '#e0f2fe',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  linkBtnText: { fontSize: 12, fontWeight: '700', color: '#0284c7' },
  privatePhotoPreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
  },
  photoBtnRow: { flexDirection: 'row', gap: 8 },
  photoBtn: {
    flex: 1,
    backgroundColor: '#e0f2fe',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  photoBtnText: { fontSize: 12, fontWeight: '700', color: '#0369a1' },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0f172a',
  },
  saveMemoBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveMemoText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  commentFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  publicToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  publicToggleText: { fontSize: 12, color: '#475569' },
  postCommentBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  postCommentText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  commentItem: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 8,
  },
  commentAuthor: { fontSize: 11, fontWeight: '700', color: '#0369a1' },
  commentBody: { fontSize: 13, color: '#1e293b', marginTop: 2 },
  reportRow: { alignItems: 'center', paddingVertical: 8 },
  reportLink: { fontSize: 12, color: '#64748b', textDecorationLine: 'underline' },
});
