'use client';

import {
  type AuthUser,
  type ExplorerSettings,
  HINATAZAKA_MEMBERS,
  type MaskLevel,
  maskSpotTitle,
  type NotificationMode,
  type TagVisibility,
  type VisitRecord,
} from '@seichi/shared';
import {
  Award,
  Bell,
  Camera,
  ExternalLink,
  Eye,
  Lock,
  LogOut,
  Sliders,
  Trophy,
  UserPlus,
} from 'lucide-react';

export interface ProfileSettingsPanelProps {
  currentUser: AuthUser | null;
  settings: ExplorerSettings;
  visitBook: Record<string, VisitRecord>;
  totalSpotsCount: number;
  onUpdateSettings: (next: ExplorerSettings) => void;
  onOpenVisitedSpot: (spotId: string) => void;
  onOpenAuthModal: () => void;
  onSignOut: () => void;
}

export function ProfileSettingsPanel({
  currentUser,
  settings,
  visitBook,
  totalSpotsCount,
  onUpdateSettings,
  onOpenVisitedSpot,
  onOpenAuthModal,
  onSignOut,
}: ProfileSettingsPanelProps) {
  const entries = Object.values(visitBook).sort((a, b) =>
    b.visitedAt.localeCompare(a.visitedAt),
  );
  const visitedEntries = entries.filter((e) => e.status === 'visited');
  const selfDiscoveredCount = visitedEntries.filter((e) => e.selfDiscovered).length;
  const albumCount = entries.filter(
    (e) => Boolean(e.hasPrivatePhoto || e.privateMemo),
  ).length;

  const previewTitle = maskSpotTitle(
    'spot_demo_catstreet',
    'キャットストリート',
    settings.maskLevel,
  );

  const toggleNotifyMember = (name: string) => {
    const exists = settings.notificationMembers.includes(name);
    const nextMembers = exists
      ? settings.notificationMembers.filter((m) => m !== name)
      : [...settings.notificationMembers, name];
    onUpdateSettings({ ...settings, notificationMembers: nextMembers });
  };

  return (
    <div className="space-y-7 max-w-3xl mx-auto">
      {/* 巡礼実績サマリ */}
      <section className="bg-gradient-to-br from-sky-500 to-indigo-600 rounded-3xl p-6 text-white shadow-md space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-sky-100">日向坂46 聖地巡礼実績</p>
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-white/20">
                {currentUser?.isAnonymous ? 'ゲスト利用中' : currentUser?.email}
              </span>
            </div>
            <h2 className="text-2xl font-black mt-0.5">{settings.nickname}</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 bg-white/15 backdrop-blur px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={settings.publicProfileStats}
                onChange={(e) =>
                  onUpdateSettings({
                    ...settings,
                    publicProfileStats: e.target.checked,
                  })
                }
                className="rounded"
              />
              {settings.publicProfileStats ? (
                <span className="inline-flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" /> 実績を公開中
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5" /> 実績を非公開
                </span>
              )}
            </label>

            {currentUser?.isAnonymous ? (
              <button
                type="button"
                onClick={onOpenAuthModal}
                className="px-3.5 py-1.5 rounded-full bg-white text-sky-700 text-xs font-extrabold inline-flex items-center gap-1 shadow-xs cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                アカウント連携・保存
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignOut}
                className="px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                ログアウト
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-1">
          <div className="bg-white/15 backdrop-blur rounded-2xl p-3.5">
            <div className="text-xs text-sky-100 flex items-center gap-1">
              <Trophy className="w-3.5 h-3.5" /> 訪問達成数
            </div>
            <div className="text-2xl sm:text-3xl font-black mt-1 tabular-nums">
              {visitedEntries.length}
              <span className="text-xs font-normal text-sky-100 ml-1">
                / {totalSpotsCount}
              </span>
            </div>
          </div>

          <div className="bg-white/15 backdrop-blur rounded-2xl p-3.5">
            <div className="text-xs text-sky-100 flex items-center gap-1">
              <Award className="w-3.5 h-3.5" /> コンパス自力発見
            </div>
            <div className="text-2xl sm:text-3xl font-black mt-1 tabular-nums">
              {selfDiscoveredCount}
              <span className="text-xs font-normal text-sky-100 ml-1">ヶ所</span>
            </div>
          </div>

          <div className="bg-white/15 backdrop-blur rounded-2xl p-3.5">
            <div className="text-xs text-sky-100 flex items-center gap-1">
              <Camera className="w-3.5 h-3.5" /> 非公開アルバム
            </div>
            <div className="text-2xl sm:text-3xl font-black mt-1 tabular-nums">
              {albumCount}
              <span className="text-xs font-normal text-sky-100 ml-1">件</span>
            </div>
          </div>
        </div>

        {currentUser && settings.publicProfileStats && (
          <div className="pt-1">
            <a
              href={`/users/${currentUser.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-100 hover:text-white underline underline-offset-4"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              公開用の巡礼実績プロフィールページを見る（写真やメモは含まれません）
            </a>
          </div>
        )}
      </section>

      {/* 自分専用の巡礼アルバム一覧（R2 非公開） */}
      <section className="bg-white rounded-3xl border border-sky-100 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <Camera className="w-5 h-5 text-sky-600" />
            自分専用の巡礼アルバム（非公開ストレージ）
          </h3>
          <span className="text-[11px] font-semibold text-slate-500">
            写真はオーナー本人のみに認可配信されます
          </span>
        </div>

        {entries.length === 0 ? (
          <p className="text-xs text-slate-500 bg-slate-50 rounded-2xl p-4">
            まだ訪問記録がありません。「周辺・コンパス探索」から聖地を発見して写真やメモを残してみましょう！
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {entries.map((entry) => (
              <button
                key={entry.spotId}
                type="button"
                onClick={() => onOpenVisitedSpot(entry.spotId)}
                className="text-left rounded-2xl border border-slate-200 hover:border-sky-300 p-3 flex gap-3 bg-slate-50/50 transition cursor-pointer"
              >
                {entry.hasPrivatePhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/me/visits/${entry.spotId}/photo`}
                    alt={entry.spotTitle}
                    className="w-16 h-16 rounded-xl object-cover shrink-0 border border-slate-200"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center shrink-0 text-xs font-bold">
                    No Photo
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        entry.status === 'visited'
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {entry.status === 'visited' ? '達成' : '閲覧済'}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {entry.prefecture}
                    </span>
                  </div>
                  <p className="text-sm font-extrabold text-slate-900 truncate mt-0.5">
                    {entry.spotTitle}
                  </p>
                  {entry.privateMemo && (
                    <p className="text-xs text-slate-600 truncate mt-0.5">
                      {entry.privateMemo}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 宝探し難易度設定 */}
      <section className="bg-white rounded-3xl border border-sky-100 shadow-sm p-6 space-y-5">
        <div>
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-sky-600" />
            宝探し難易度・ヒント表示設定
          </h3>
        </div>

        <div className="rounded-2xl bg-sky-50 border border-sky-200 p-3.5 flex items-center justify-between">
          <span className="text-xs font-bold text-sky-900">
            虫食い表示プレビュー（例：キャットストリート）
          </span>
          <span className="text-base font-black text-sky-700 tracking-wide">
            {previewTitle}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-extrabold text-slate-700">
              タイトルの虫食い度
            </label>
            <select
              value={settings.maskLevel}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  maskLevel: e.target.value as MaskLevel,
                })
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white font-semibold"
            >
              <option value="easy">イージー（約30%伏字・推理しやすい）</option>
              <option value="normal">ノーマル（約55%伏字・おすすめ）</option>
              <option value="hard">ハード（約80%伏字・ほぼ1〜2文字のみ）</option>
              <option value="full">ノーヒント（100%完全伏字）</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-extrabold text-slate-700">
              到着前に表示するタグ量
            </label>
            <select
              value={settings.tagVisibility}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  tagVisibility: e.target.value as TagVisibility,
                })
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white font-semibold"
            >
              <option value="all">すべて表示（媒体＋メンバー＋ハッシュタグ）</option>
              <option value="member_and_media">メンバー名＋媒体のみ表示</option>
              <option value="media_only">媒体カテゴリ（#MV 等）のみ表示</option>
              <option value="none">タグ非表示（着くまで誰の何の聖地か秘密）</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div className="space-y-1.5">
            <label className="block text-xs font-extrabold text-slate-700">
              表示ニックネーム
            </label>
            <input
              type="text"
              value={settings.nickname}
              onChange={(e) =>
                onUpdateSettings({ ...settings, nickname: e.target.value })
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
        </div>
      </section>

      {/* 接近通知設定 */}
      <section className="bg-white rounded-3xl border border-sky-100 shadow-sm p-6 space-y-4">
        <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
          <Bell className="w-5 h-5 text-sky-600" />
          接近プッシュ通知設定（Geofencing & おでかけ監視）
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-extrabold text-slate-700">
              監視モード
            </label>
            <select
              value={settings.notificationMode}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  notificationMode: e.target.value as NotificationMode,
                })
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white font-semibold"
            >
              <option value="power_save">常時省電力エリア監視</option>
              <option value="out_and_about">おでかけ中こまめ監視</option>
              <option value="off">通知OFF</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-extrabold text-slate-700">
              通知する距離
            </label>
            <select
              value={settings.notificationRadiusMeters}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  notificationRadiusMeters: Number(e.target.value),
                })
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white font-semibold"
            >
              <option value={150}>半径 150m 以内</option>
              <option value={300}>半径 300m 以内（標準）</option>
              <option value={500}>半径 500m 以内</option>
              <option value={1000}>半径 1km 以内</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-extrabold text-slate-700">
              同一聖地の再通知防止
            </label>
            <select
              value={settings.notificationCooldownHours}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  notificationCooldownHours: Number(e.target.value),
                })
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white font-semibold"
            >
              <option value={6}>6時間空ける</option>
              <option value={24}>24時間空ける（標準）</option>
              <option value={72}>3日間空ける</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-extrabold text-slate-700">
            通知対象の推しメン絞り込み
          </label>
          <div className="max-h-28 overflow-y-auto rounded-2xl border border-slate-200 p-2.5 flex flex-wrap gap-1.5 bg-slate-50/50">
            {HINATAZAKA_MEMBERS.map((m) => {
              const active = settings.notificationMembers.includes(m.name);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleNotifyMember(m.name)}
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold cursor-pointer ${
                    active
                      ? 'bg-sky-600 text-white'
                      : 'bg-white text-slate-600 border border-slate-200'
                  }`}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
