import {
  formatDistance,
  HINATAZAKA_MEMBERS,
  MEDIA_CATEGORY_META,
  type MaskedSpotSummary,
  type MediaCategory,
} from '@seichi/shared';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useApp } from '@/context/AppContext.tsx';

const MEDIA_KEYS = Object.keys(MEDIA_CATEGORY_META) as MediaCategory[];

export default function ExploreListScreen() {
  const router = useRouter();
  const {
    meta,
    visits,
    spots,
    loadingSpots,
    usingRealGps,
    selectedMember,
    setSelectedMember,
    selectedMedia,
    setSelectedMedia,
    tagQuery,
    setTagQuery,
    refreshGpsLocation,
    refreshSpots,
  } = useApp();

  const visitList = Object.values(visits);
  const visitedCount = visitList.filter((v) => v.status === 'visited').length;
  const selfDiscoveredCount = visitList.filter((v) => v.selfDiscovered).length;

  const renderSpotItem = ({ item }: { item: MaskedSpotSummary }) => {
    const statusBadge =
      item.visitStatus === 'visited'
        ? item.selfDiscovered
          ? { text: '✨ 自力発見', bg: '#dcfce7', fg: '#166534' }
          : { text: '✅ 訪問済', bg: '#e0f2fe', fg: '#075985' }
        : item.visitStatus === 'give_up'
          ? { text: '🏳️ 救済閲覧', bg: '#fef3c7', fg: '#92400e' }
          : { text: '🔒 未解禁', bg: '#f1f5f9', fg: '#475569' };

    return (
      <Pressable
        style={styles.card}
        onPress={() => router.push(`/compass/${encodeURIComponent(item.id)}`)}
      >
        <View style={styles.cardHeader}>
          <View style={styles.prefRow}>
            <Text style={styles.prefBadge}>{item.prefecture}</Text>
            <View
              style={[styles.statusBadge, { backgroundColor: statusBadge.bg }]}
            >
              <Text style={[styles.statusText, { color: statusBadge.fg }]}>
                {statusBadge.text}
              </Text>
            </View>
            {item.episodeCount > 1 && (
              <Text style={styles.multiSceneBadge}>
                🎬 {item.episodeCount}シーン
              </Text>
            )}
          </View>
          <View style={styles.compassPill}>
            <Text
              style={[
                styles.arrowIcon,
                { transform: [{ rotate: `${item.bearingDeg}deg` }] },
              ]}
            >
              ↑
            </Text>
            <Text style={styles.distanceText}>
              {formatDistance(item.distanceMeters)}
            </Text>
          </View>
        </View>

        <Text style={styles.spotTitle}>{item.displayTitle}</Text>

        <View style={styles.tagWrap}>
          {item.visibleMediaCategories.map((cat) => (
            <View
              key={cat}
              style={[
                styles.mediaChip,
                { borderColor: MEDIA_CATEGORY_META[cat].color },
              ]}
            >
              <Text
                style={[
                  styles.mediaChipText,
                  { color: MEDIA_CATEGORY_META[cat].color },
                ]}
              >
                {MEDIA_CATEGORY_META[cat].shortLabel}
              </Text>
            </View>
          ))}
          {item.visibleMembers.slice(0, 4).map((m) => (
            <View key={m} style={styles.memberChip}>
              <Text style={styles.memberChipText}>{m}</Text>
            </View>
          ))}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {/* 上部サマリーバー */}
      <View style={styles.summaryBar}>
        <View>
          <Text style={styles.summaryTitle}>
            収録聖地 {meta?.totalSpots?.toLocaleString() ?? '---'} 箇所
          </Text>
          <Text style={styles.summarySub}>
            訪問済 {visitedCount} / 自力発見 {selfDiscoveredCount} ・{' '}
            {usingRealGps ? '📡 現在地GPS連動' : '📍 デモ基準位置'}
          </Text>
        </View>
        <Pressable style={styles.gpsBtn} onPress={() => void refreshGpsLocation()}>
          <Text style={styles.gpsBtnText}>現在地更新</Text>
        </Pressable>
      </View>

      {/* キーワード・フィルタ */}
      <View style={styles.filterBox}>
        <TextInput
          style={styles.searchInput}
          placeholder="番組名・楽曲・ハッシュタグで絞り込み..."
          placeholderTextColor="#94a3b8"
          value={tagQuery}
          onChangeText={setTagQuery}
        />

        {/* メディア種別チップ */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipScroll}
        >
          <Pressable
            style={[
              styles.filterChip,
              selectedMedia === '' && styles.filterChipActive,
            ]}
            onPress={() => setSelectedMedia('')}
          >
            <Text
              style={[
                styles.filterChipText,
                selectedMedia === '' && styles.filterChipTextActive,
              ]}
            >
              全メディア
            </Text>
          </Pressable>
          {MEDIA_KEYS.map((cat) => {
            const active = selectedMedia === cat;
            return (
              <Pressable
                key={cat}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setSelectedMedia(active ? '' : cat)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                  ]}
                >
                  {MEDIA_CATEGORY_META[cat].shortLabel}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* メンバー絞り込みチップ */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipScroll}
        >
          <Pressable
            style={[
              styles.filterChip,
              selectedMember === '' && styles.filterChipActive,
            ]}
            onPress={() => setSelectedMember('')}
          >
            <Text
              style={[
                styles.filterChipText,
                selectedMember === '' && styles.filterChipTextActive,
              ]}
            >
              全メンバー
            </Text>
          </Pressable>
          {HINATAZAKA_MEMBERS.map((m) => {
            const active = selectedMember === m.name;
            return (
              <Pressable
                key={m.id}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setSelectedMember(active ? '' : m.name)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                  ]}
                >
                  {m.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loadingSpots && spots.length === 0 ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>近くの聖地をスキャン中...</Text>
        </View>
      ) : (
        <FlatList
          data={spots}
          keyExtractor={(item) => item.id}
          renderItem={renderSpotItem}
          refreshing={loadingSpots}
          onRefresh={() => void refreshSpots()}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.centerBox}>
              <Text style={styles.emptyText}>
                条件に一致する聖地が見つかりませんでした
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#e0f2fe',
    borderBottomWidth: 1,
    borderBottomColor: '#bae6fd',
  },
  summaryTitle: { fontSize: 14, fontWeight: '800', color: '#0c4a6e' },
  summarySub: { fontSize: 12, color: '#0369a1', marginTop: 2 },
  gpsBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  gpsBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  filterBox: {
    backgroundColor: '#ffffff',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  searchInput: {
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    fontSize: 13,
    color: '#0f172a',
  },
  chipScroll: { paddingHorizontal: 12, paddingVertical: 3, gap: 6 },
  filterChip: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    marginRight: 6,
  },
  filterChipActive: { backgroundColor: '#0284c7' },
  filterChipText: { fontSize: 12, color: '#334155', fontWeight: '600' },
  filterChipTextActive: { color: '#ffffff' },
  listContent: { padding: 12, gap: 10 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  prefRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  prefBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369a1',
    backgroundColor: '#f0f9ff',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '700' },
  multiSceneBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6366f1',
  },
  compassPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0c4a6e',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    gap: 4,
  },
  arrowIcon: { color: '#38bdf8', fontSize: 13, fontWeight: '900' },
  distanceText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  spotTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 8,
    letterSpacing: 0.4,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  mediaChip: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  mediaChipText: { fontSize: 11, fontWeight: '700' },
  memberChip: {
    backgroundColor: '#f0f9ff',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  memberChipText: { fontSize: 11, color: '#0369a1', fontWeight: '600' },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText: { marginTop: 10, color: '#64748b', fontSize: 13 },
  emptyText: { color: '#64748b', fontSize: 14 },
});
