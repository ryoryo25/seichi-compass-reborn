import type {
  MaskLevel,
  NotificationMode,
  TagVisibility,
  VisitRecord,
} from '@seichi/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
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

function PrivatePhotoThumb({ visit }: { visit: VisitRecord }) {
  const [source, setSource] = useState<{
    uri: string;
    headers?: Record<string, string>;
  } | null>(null);

  useEffect(() => {
    if (!visit.hasPrivatePhoto) return;
    void mobileApi
      .getPrivatePhotoImageSource(visit.spotId, visit.visitedAt)
      .then(setSource);
  }, [visit.hasPrivatePhoto, visit.spotId, visit.visitedAt]);

  if (!visit.hasPrivatePhoto || !source) return null;
  return <Image source={source} style={styles.albumThumb} />;
}

export default function ProfileScreen() {
  const router = useRouter();
  const {
    user,
    visits,
    settings,
    geofenceStatusText,
    updateSettings,
    signUp,
    signIn,
    signOut,
  } = useApp();

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signup' | 'signin'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(settings.nickname);
  const [authBusy, setAuthBusy] = useState(false);

  const visitEntries = Object.values(visits).sort((a, b) =>
    b.visitedAt.localeCompare(a.visitedAt),
  );
  const visitedCount = visitEntries.filter((v) => v.status === 'visited').length;
  const selfDiscoveredCount = visitEntries.filter((v) => v.selfDiscovered).length;
  const prefCount = new Set(
    visitEntries
      .filter((v) => v.status === 'visited')
      .map((v) => v.prefecture),
  ).size;

  const handleAuthSubmit = async () => {
    setAuthBusy(true);
    try {
      if (authMode === 'signup') {
        await signUp({
          email: email.trim(),
          password,
          name: name.trim() || 'おひさま探索者',
        });
      } else {
        await signIn({ email: email.trim(), password });
      }
      setAuthModalOpen(false);
      setPassword('');
      Alert.alert(
        '完了',
        'アカウント連携が完了しました！これまでの訪問記録・非公開アルバムもそのまま引き継がれています。',
      );
    } catch (err) {
      Alert.alert(
        '認証エラー',
        err instanceof Error ? err.message : '処理に失敗しました',
      );
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* アカウント状態カード */}
      <View style={styles.card}>
        <View style={styles.accountRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>
              {user?.name ?? settings.nickname}{' '}
              {user?.isAnonymous ? '（ゲスト探索中）' : '（連携済）'}
            </Text>
            <Text style={styles.userSub}>
              {user?.isAnonymous
                ? 'アカウント登録すると機種変更時も訪問記録と非公開写真を引き継げます'
                : user?.email ?? `ID: ${user?.id}`}
            </Text>
          </View>
          {user?.isAnonymous ? (
            <Pressable
              style={styles.primaryBtn}
              onPress={() => setAuthModalOpen(true)}
            >
              <Text style={styles.primaryBtnText}>登録 / ログイン</Text>
            </Pressable>
          ) : (
            <Pressable
              style={styles.outlineBtn}
              onPress={() => void signOut()}
            >
              <Text style={styles.outlineBtnText}>ログアウト</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* 巡礼実績スタッツ */}
      <View style={styles.statsGrid}>
        <View style={styles.statBox}>
          <Text style={styles.statNum}>{visitedCount}</Text>
          <Text style={styles.statLabel}>訪問達成</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: '#059669' }]}>
            {selfDiscoveredCount}
          </Text>
          <Text style={styles.statLabel}>自力発見✨</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: '#7c3aed' }]}>{prefCount}</Text>
          <Text style={styles.statLabel}>制覇都道府県</Text>
        </View>
      </View>

      {/* 探索難易度・伏せ字設定 */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>🕵️ 探索難易度カスタマイズ</Text>

        <Text style={styles.label}>聖地タイトルの伏せ字レベル</Text>
        <View style={styles.chipWrap}>
          {(
            [
              ['easy', 'イージー（半分表示）'],
              ['normal', 'ノーマル（頭文字ヒント）'],
              ['hard', 'ハード（1文字のみ）'],
              ['full', '完全秘匿（？？？）'],
            ] as Array<[MaskLevel, string]>
          ).map(([lv, label]) => {
            const active = settings.maskLevel === lv;
            return (
              <Pressable
                key={lv}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => void updateSettings({ ...settings, maskLevel: lv })}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>未解禁時のタグヒント開示</Text>
        <View style={styles.chipWrap}>
          {(
            [
              ['all', 'すべて表示'],
              ['member_and_media', 'メンバー＋媒体'],
              ['media_only', '媒体のみ'],
              ['none', 'ヒントなし'],
            ] as Array<[TagVisibility, string]>
          ).map(([tv, label]) => {
            const active = settings.tagVisibility === tv;
            return (
              <Pressable
                key={tv}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() =>
                  void updateSettings({ ...settings, tagVisibility: tv })
                }
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* バックグラウンド接近通知（OSジオフェンス / お出かけ中モード） */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          📡 バックグラウンド聖地接近通知（{geofenceStatusText}）
        </Text>
        <View style={styles.chipWrap}>
          {(
            [
              ['power_save', '🔋 省電力（OSジオフェンス）'],
              ['out_and_about', '🚶 お出かけ中（高感度）'],
              ['off', '🔕 オフ'],
            ] as Array<[NotificationMode, string]>
          ).map(([mode, label]) => {
            const active = settings.notificationMode === mode;
            return (
              <Pressable
                key={mode}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() =>
                  void updateSettings({ ...settings, notificationMode: mode })
                }
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>公開プロフィールで訪問数のみ公開</Text>
          <Switch
            value={settings.publicProfileStats}
            onValueChange={(v) =>
              void updateSettings({ ...settings, publicProfileStats: v })
            }
          />
        </View>
      </View>

      {/* 自分専用の非公開巡礼アルバム（Cloudflare R2 オーナー限定） */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          📔 自分専用の非公開巡礼アルバム（{visitEntries.length}件）
        </Text>
        <Text style={styles.albumNotice}>
          ※ 写真と個人メモはCloudflare R2非公開バケットに保存され、あなた以外の誰にも公開されません。
        </Text>
        {visitEntries.length === 0 ? (
          <Text style={styles.emptyAlbum}>
            まだ解禁した聖地がありません。探索リストから聖地に近づいてみましょう！
          </Text>
        ) : (
          visitEntries.map((v) => (
            <Pressable
              key={v.spotId}
              style={styles.albumItem}
              onPress={() =>
                router.push(`/compass/${encodeURIComponent(v.spotId)}`)
              }
            >
              <PrivatePhotoThumb visit={v} />
              <View style={{ flex: 1 }}>
                <Text style={styles.albumSpotTitle}>
                  {v.status === 'visited'
                    ? v.selfDiscovered
                      ? '✨ '
                      : '✅ '
                    : '🏳️ '}
                  {v.spotTitle}
                </Text>
                <Text style={styles.albumMeta}>
                  {v.prefecture} ・ {new Date(v.visitedAt).toLocaleDateString('ja-JP')}
                </Text>
                {v.privateMemo ? (
                  <Text style={styles.albumMemo} numberOfLines={2}>
                    📝 {v.privateMemo}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))
        )}
      </View>

      {/* ゲスト引き継ぎログイン・新規登録モーダル */}
      <Modal
        visible={authModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAuthModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {authMode === 'signup'
                ? 'アカウント作成（ゲスト記録を自動引き継ぎ）'
                : 'ログイン（ゲスト記録を自動マージ）'}
            </Text>

            <View style={styles.tabRow}>
              <Pressable
                style={[
                  styles.tabBtn,
                  authMode === 'signup' && styles.tabBtnActive,
                ]}
                onPress={() => setAuthMode('signup')}
              >
                <Text
                  style={[
                    styles.tabBtnText,
                    authMode === 'signup' && styles.tabBtnTextActive,
                  ]}
                >
                  新規登録
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.tabBtn,
                  authMode === 'signin' && styles.tabBtnActive,
                ]}
                onPress={() => setAuthMode('signin')}
              >
                <Text
                  style={[
                    styles.tabBtnText,
                    authMode === 'signin' && styles.tabBtnTextActive,
                  ]}
                >
                  ログイン
                </Text>
              </Pressable>
            </View>

            {authMode === 'signup' && (
              <TextInput
                style={styles.input}
                placeholder="ニックネーム"
                placeholderTextColor="#94a3b8"
                value={name}
                onChangeText={setName}
              />
            )}
            <TextInput
              style={styles.input}
              placeholder="メールアドレス"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="パスワード（8文字以上）"
              placeholderTextColor="#94a3b8"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={styles.outlineBtn}
                onPress={() => setAuthModalOpen(false)}
              >
                <Text style={styles.outlineBtnText}>閉じる</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, { flex: 1, alignItems: 'center' }]}
                onPress={() => void handleAuthSubmit()}
                disabled={authBusy}
              >
                <Text style={styles.primaryBtnText}>
                  {authBusy
                    ? '処理中...'
                    : authMode === 'signup'
                      ? '登録して引き継ぐ'
                      : 'ログイン'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 14, gap: 14, paddingBottom: 40 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  userName: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  userSub: { fontSize: 11, color: '#64748b', marginTop: 3 },
  primaryBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  primaryBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  outlineBtn: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  outlineBtnText: { color: '#334155', fontSize: 12, fontWeight: '700' },
  statsGrid: { flexDirection: 'row', gap: 10 },
  statBox: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statNum: { fontSize: 22, fontWeight: '900', color: '#0284c7' },
  statLabel: { fontSize: 11, color: '#64748b', fontWeight: '700', marginTop: 2 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#0c4a6e' },
  label: { fontSize: 12, fontWeight: '700', color: '#334155', marginTop: 4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
  },
  chipActive: { backgroundColor: '#0284c7' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#334155' },
  chipTextActive: { color: '#ffffff' },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  switchLabel: { fontSize: 12, color: '#334155', fontWeight: '600' },
  albumNotice: { fontSize: 11, color: '#64748b' },
  emptyAlbum: { fontSize: 12, color: '#64748b', paddingVertical: 12 },
  albumItem: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    alignItems: 'center',
  },
  albumThumb: {
    width: 60,
    height: 60,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
  },
  albumSpotTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  albumMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },
  albumMemo: { fontSize: 12, color: '#334155', marginTop: 4 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 3,
  },
  tabBtn: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: '#0284c7' },
  tabBtnText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  tabBtnTextActive: { color: '#ffffff' },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0f172a',
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
});
