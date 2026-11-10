import {
  HINATAZAKA_MEMBERS,
  MEDIA_CATEGORY_META,
  type MediaCategory,
  type PlaceSearchCandidate,
  validateAndParseReferenceUrl,
} from '@seichi/shared';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { mobileApi } from '@/api/client.ts';
import { useApp } from '@/context/AppContext.tsx';

const MEDIA_KEYS = Object.keys(MEDIA_CATEGORY_META) as MediaCategory[];

export default function RegisterSpotScreen() {
  const router = useRouter();
  const {
    user,
    coords,
    pendingSharedUrl,
    setPendingSharedUrl,
    refreshSpots,
  } = useApp();

  const [locationInput, setLocationInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [placeCandidates, setPlaceCandidates] = useState<
    PlaceSearchCandidate[]
  >([]);

  const [pinLat, setPinLat] = useState(coords.lat);
  const [pinLng, setPinLng] = useState(coords.lng);
  const [title, setTitle] = useState('');
  const [arrivalRadiusMeters, setArrivalRadiusMeters] = useState(80);
  const [mediaCategory, setMediaCategory] = useState<MediaCategory>('youtube');
  const [description, setDescription] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [hashtagsText, setHashtagsText] = useState('');

  const [duplicates, setDuplicates] = useState<
    Array<{
      id: string;
      title: string;
      distanceMeters: number;
      episodeCount: number;
    }>
  >([]);
  const [appendTargetSpotId, setAppendTargetSpotId] = useState<string | undefined>(
    undefined,
  );
  const [submitting, setSubmitting] = useState(false);

  const checkNearbyDuplicates = useCallback(async (lat: number, lng: number) => {
    try {
      const res = await mobileApi.checkDuplicates(lat, lng);
      setDuplicates(res.duplicates);
      if (res.duplicates.length === 0) {
        setAppendTargetSpotId(undefined);
      }
    } catch {
      // Ignore network errors
    }
  }, []);

  const handleResolveInput = useCallback(
    async (rawInput: string) => {
      const trimmed = rawInput.trim();
      if (!trimmed) return;
      setResolving(true);
      try {
        const res = await mobileApi.resolveLocation(trimmed);
        if (res.lat !== undefined && res.lng !== undefined) {
          setPinLat(res.lat);
          setPinLng(res.lng);
          if (res.placeQuery && !title) {
            setTitle(res.placeQuery);
          }
          setPlaceCandidates([]);
          await checkNearbyDuplicates(res.lat, res.lng);
        } else {
          const queryForSearch = res.placeQuery || trimmed;
          const searchRes = await mobileApi.searchPlaces(queryForSearch);
          setPlaceCandidates(searchRes.candidates);
          if (searchRes.candidates.length === 0) {
            Alert.alert(
              '場所が見つかりません',
              '別のキーワードまたはGoogleマップ共有URLをお試しください',
            );
          }
        }
      } catch (err) {
        Alert.alert(
          '検索エラー',
          err instanceof Error ? err.message : '場所の解決に失敗しました',
        );
      } finally {
        setResolving(false);
      }
    },
    [checkNearbyDuplicates, title],
  );

  // Googleマップアプリからの共有URL受信時に自動解決
  useEffect(() => {
    if (!pendingSharedUrl) return;
    const shared = pendingSharedUrl;
    setPendingSharedUrl(null);
    setLocationInput(shared);
    void handleResolveInput(shared);
  }, [pendingSharedUrl, setPendingSharedUrl, handleResolveInput]);

  const toggleMember = (name: string) => {
    setSelectedMembers((prev) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name],
    );
  };

  const handleSubmit = async () => {
    if (!user || user.isAnonymous) {
      Alert.alert(
        'ログインが必要です',
        '聖地の追加にはアカウント登録・ログインが必要です（マイページから登録すると現在の訪問記録もすべて引き継がれます）',
        [
          { text: 'キャンセル', style: 'cancel' },
          { text: 'マイページへ', onPress: () => router.push('/(tabs)/profile') },
        ],
      );
      return;
    }

    if (!appendTargetSpotId && !title.trim()) {
      Alert.alert('入力不足', '聖地・施設名を入力してください');
      return;
    }
    if (!description.trim()) {
      Alert.alert('入力不足', '登場シーンやエピソード説明を入力してください');
      return;
    }

    if (referenceUrl.trim()) {
      const check = validateAndParseReferenceUrl(referenceUrl.trim());
      if (!check.ok) {
        Alert.alert('URLエラー', check.reason);
        return;
      }
    }

    setSubmitting(true);
    try {
      const hashtags = hashtagsText
        .split(/[\s,、]+/)
        .map((t) => t.replace(/^#/, '').trim())
        .filter(Boolean);

      const saved = await mobileApi.createOrAppendSpot({
        existingSpotId: appendTargetSpotId,
        title: appendTargetSpotId ? title || '既存スポット追記' : title.trim(),
        lat: pinLat,
        lng: pinLng,
        arrivalRadiusMeters,
        mediaCategory,
        description: description.trim(),
        referenceUrl: referenceUrl.trim() || undefined,
        members: selectedMembers,
        hashtags,
      });

      await refreshSpots();
      Alert.alert(
        '登録完了！',
        appendTargetSpotId
          ? `『${saved.spot.title}』に新しい登場シーンを追記しました！`
          : `『${saved.spot.title}』を聖地として追加しました！`,
      );
      setDescription('');
      setReferenceUrl('');
      setHashtagsText('');
      setAppendTargetSpotId(undefined);
    } catch (err) {
      Alert.alert(
        '登録エラー',
        err instanceof Error ? err.message : '登録に失敗しました',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {user?.isAnonymous && (
        <Pressable
          style={styles.guestNotice}
          onPress={() => router.push('/(tabs)/profile')}
        >
          <Text style={styles.guestNoticeText}>
            💡 現在はゲスト探索モードです。聖地を登録するにはタップしてアカウント連携（無料・記録引き継ぎ）を行ってください。
          </Text>
        </Pressable>
      )}

      {/* Step 1: Googleマップ共有URL または 施設名検索 */}
      <View style={styles.section}>
        <View style={styles.stepHeaderRow}>
          <Text style={styles.sectionTitle}>
            1. Googleマップ共有URL または 場所検索
          </Text>
          <Pressable
            style={styles.openMapBtn}
            onPress={() => void Linking.openURL('https://www.google.com/maps')}
          >
            <Text style={styles.openMapBtnText}>🗺️ Mapアプリを開く</Text>
          </Pressable>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="maps.app.goo.gl/... または施設名を入力"
            placeholderTextColor="#94a3b8"
            value={locationInput}
            onChangeText={setLocationInput}
          />
          <Pressable
            style={styles.resolveBtn}
            onPress={() => void handleResolveInput(locationInput)}
            disabled={resolving}
          >
            <Text style={styles.resolveBtnText}>
              {resolving ? '解析中...' : '検索'}
            </Text>
          </Pressable>
        </View>

        {placeCandidates.map((cand, idx) => (
          <Pressable
            key={`${cand.lat}-${cand.lng}-${idx}`}
            style={styles.candidateItem}
            onPress={() => {
              setPinLat(cand.lat);
              setPinLng(cand.lng);
              setTitle(cand.name);
              setPlaceCandidates([]);
              void checkNearbyDuplicates(cand.lat, cand.lng);
            }}
          >
            <Text style={styles.candidateTitle}>📍 {cand.name}</Text>
            {cand.address ? (
              <Text style={styles.candidateAddr}>{cand.address}</Text>
            ) : null}
          </Pressable>
        ))}
      </View>

      {/* Step 2: 地図ピン微調整（長押しドラッグ） */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          2. ピン位置の微調整（マーカー長押しドラッグで正確なベンチ・交差点へ）
        </Text>
        <MapView
          style={styles.miniMap}
          region={{
            latitude: pinLat,
            longitude: pinLng,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          }}
          onPress={(e) => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            setPinLat(Number(latitude.toFixed(6)));
            setPinLng(Number(longitude.toFixed(6)));
            void checkNearbyDuplicates(latitude, longitude);
          }}
        >
          <Marker
            draggable
            coordinate={{ latitude: pinLat, longitude: pinLng }}
            onDragEnd={(e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              setPinLat(Number(latitude.toFixed(6)));
              setPinLng(Number(longitude.toFixed(6)));
              void checkNearbyDuplicates(latitude, longitude);
            }}
          />
        </MapView>
        <Text style={styles.coordCaption}>
          座標: {pinLat.toFixed(6)}, {pinLng.toFixed(6)}
        </Text>

        {/* 半径60m重複検知アラート */}
        {duplicates.length > 0 && (
          <View style={styles.dupBox}>
            <Text style={styles.dupTitle}>
              ⚠️ 半径60m以内に既存の聖地があります（シーン追記を推奨）
            </Text>
            {duplicates.map((d) => {
              const selected = appendTargetSpotId === d.id;
              return (
                <Pressable
                  key={d.id}
                  style={[styles.dupItem, selected && styles.dupItemSelected]}
                  onPress={() => {
                    setAppendTargetSpotId(selected ? undefined : d.id);
                    if (!selected) setTitle(d.title);
                  }}
                >
                  <Text style={styles.dupItemText}>
                    {selected ? '✅ 追記先として選択中: ' : '➕ シーン追記する: '}
                    {d.title}（距離 {Math.round(d.distanceMeters)}m・既存
                    {d.episodeCount}件）
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {/* Step 3: 聖地・登場シーン情報 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>3. 聖地名・エピソード詳細</Text>
        <Text style={styles.label}>聖地・施設名（探索者には自動で伏せ字化されます）</Text>
        <TextInput
          style={styles.input}
          placeholder="例: 横浜スタジアム / 〇〇カフェ"
          placeholderTextColor="#94a3b8"
          value={title}
          onChangeText={setTitle}
          editable={!appendTargetSpotId}
        />

        <Text style={styles.label}>メディア種別</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {MEDIA_KEYS.map((cat) => {
            const active = mediaCategory === cat;
            return (
              <Pressable
                key={cat}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setMediaCategory(cat)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {MEDIA_CATEGORY_META[cat].shortLabel}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={styles.label}>登場シーン・説明（到着解禁後に表示）</Text>
        <TextInput
          style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
          multiline
          placeholder="例: 日向坂ちゃんねる『〇〇企画』で3人が訪れたパン屋さん"
          placeholderTextColor="#94a3b8"
          value={description}
          onChangeText={setDescription}
        />

        <Text style={styles.label}>関連メンバー（複数選択可）</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {HINATAZAKA_MEMBERS.map((m) => {
            const active = selectedMembers.includes(m.name);
            return (
              <Pressable
                key={m.id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => toggleMember(m.name)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {m.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={styles.label}>公式コンテンツ参照URL（YouTube秒数指定・公式ブログ等）</Text>
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          placeholder="https://youtu.be/...?t=125"
          placeholderTextColor="#94a3b8"
          value={referenceUrl}
          onChangeText={setReferenceUrl}
        />

        <Text style={styles.label}>ハッシュタグ（カンマ・空白区切り）</Text>
        <TextInput
          style={styles.input}
          placeholder="日向坂ちゃんねる, 4期生"
          placeholderTextColor="#94a3b8"
          value={hashtagsText}
          onChangeText={setHashtagsText}
        />

        <Text style={styles.label}>GPS到着判定半径: {arrivalRadiusMeters}m</Text>
        <View style={styles.radiusRow}>
          {[50, 80, 120, 200].map((r) => (
            <Pressable
              key={r}
              style={[
                styles.chip,
                arrivalRadiusMeters === r && styles.chipActive,
              ]}
              onPress={() => setArrivalRadiusMeters(r)}
            >
              <Text
                style={[
                  styles.chipText,
                  arrivalRadiusMeters === r && styles.chipTextActive,
                ]}
              >
                {r}m
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={styles.submitBtn}
          onPress={() => void handleSubmit()}
          disabled={submitting}
        >
          <Text style={styles.submitBtnText}>
            {submitting
              ? '送信中...'
              : appendTargetSpotId
                ? '➕ 既存スポットへ新シーンを追記する'
                : '✨ 新しい聖地として登録する'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 14, gap: 14, paddingBottom: 40 },
  guestNotice: {
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  guestNoticeText: { fontSize: 12, color: '#92400e', fontWeight: '600' },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#0c4a6e', flexShrink: 1 },
  stepHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  openMapBtn: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  openMapBtnText: { fontSize: 11, fontWeight: '700', color: '#0369a1' },
  inputRow: { flexDirection: 'row', gap: 8 },
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
  resolveBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 10,
  },
  resolveBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 13 },
  candidateItem: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#f0f9ff',
    marginTop: 4,
  },
  candidateTitle: { fontSize: 13, fontWeight: '700', color: '#0369a1' },
  candidateAddr: { fontSize: 11, color: '#64748b', marginTop: 2 },
  miniMap: { height: 200, borderRadius: 12, overflow: 'hidden' },
  coordCaption: { fontSize: 11, color: '#64748b', textAlign: 'right' },
  dupBox: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  dupTitle: { fontSize: 12, fontWeight: '800', color: '#92400e' },
  dupItem: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  dupItemSelected: { backgroundColor: '#dcfce7', borderColor: '#22c55e' },
  dupItemText: { fontSize: 12, fontWeight: '700', color: '#1e293b' },
  label: { fontSize: 12, fontWeight: '700', color: '#334155', marginTop: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    marginRight: 6,
    marginVertical: 4,
  },
  chipActive: { backgroundColor: '#0284c7' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#334155' },
  chipTextActive: { color: '#ffffff' },
  radiusRow: { flexDirection: 'row', flexWrap: 'wrap' },
  submitBtn: {
    marginTop: 12,
    backgroundColor: '#0284c7',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
});
