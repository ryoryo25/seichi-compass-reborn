'use client';

import {
  type AuthUser,
  HINATAZAKA_MEMBERS,
  MEDIA_CATEGORY_META,
  type MediaCategory,
  type SpotReport,
} from '@seichi/shared';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  MapPin,
  PlusCircle,
  Search,
  ShieldAlert,
  Upload,
  UserPlus,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { SeichiMap } from '@/components/map/SeichiMap';

interface DuplicateCandidate {
  id: string;
  title: string;
  distanceMeters: number;
  episodeCount: number;
  mediaCategories: MediaCategory[];
}

interface PlaceCandidate {
  name: string;
  address?: string;
  lat: number;
  lng: number;
  provider: string;
}

export interface RegisterSpotPanelProps {
  currentUser: AuthUser | null;
  initialLat: number;
  initialLng: number;
  onRequireAuth: () => void;
  onSpotCreated: () => void;
}

export function RegisterSpotPanel({
  currentUser,
  initialLat,
  initialLng,
  onRequireAuth,
  onSpotCreated,
}: RegisterSpotPanelProps) {
  const isGuest = !currentUser || currentUser.isAnonymous;
  const isAdmin = currentUser?.role === 'admin';

  const [mapUrlInput, setMapUrlInput] = useState('');
  const [placeSearchInput, setPlaceSearchInput] = useState('');
  const [placeCandidates, setPlaceCandidates] = useState<PlaceCandidate[]>([]);
  const [urlResolveMsg, setUrlResolveMsg] = useState<string | null>(null);

  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [selectedExistingSpotId, setSelectedExistingSpotId] = useState<string>('');

  const [title, setTitle] = useState('');
  const [mediaCategory, setMediaCategory] = useState<MediaCategory>('youtube');
  const [description, setDescription] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [hashtagsInput, setHashtagsInput] = useState('');
  const [arrivalRadiusMeters, setArrivalRadiusMeters] = useState(80);

  const [submitStatus, setSubmitStatus] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 管理者機能（一括インポート ＋ マイマップURL同期 ＋ 通報審査）
  const [importFormat, setImportFormat] = useState<'mymap_url' | 'csv' | 'kml'>(
    'mymap_url',
  );
  const [importText, setImportText] = useState(
    'https://www.google.com/maps/d/viewer?mid=14Otcijw10dc-Fyu1P-q-BygLgiLK2sQ',
  );
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [openReports, setOpenReports] = useState<SpotReport[]>([]);

  // 座標変更時に半径60m以内の重複スポットを自動照会
  useEffect(() => {
    let cancelled = false;
    const checkDuplicates = async () => {
      try {
        const res = await fetch(`/api/spots/duplicates?lat=${lat}&lng=${lng}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { duplicates: DuplicateCandidate[] };
        if (!cancelled) {
          setDuplicates(data.duplicates);
          if (
            selectedExistingSpotId &&
            !data.duplicates.some((d) => d.id === selectedExistingSpotId)
          ) {
            setSelectedExistingSpotId('');
          }
        }
      } catch {
        // ignore
      }
    };
    checkDuplicates();
    return () => {
      cancelled = true;
    };
  }, [lat, lng, selectedExistingSpotId]);

  // 管理者の場合は未対応通報一覧を取得
  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/admin/reports?status=open')
      .then((r) => (r.ok ? r.json() : { reports: [] }))
      .then((d: { reports?: SpotReport[] }) => setOpenReports(d.reports ?? []))
      .catch(() => {});
  }, [isAdmin]);

  const handleResolveMapUrl = async () => {
    if (!mapUrlInput.trim()) return;
    setUrlResolveMsg('URL・座標を解析中...');
    try {
      const res = await fetch('/api/locations/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: mapUrlInput }),
      });
      const data = (await res.json()) as {
        lat?: number;
        lng?: number;
        placeQuery?: string;
      };
      if (data.lat !== undefined && data.lng !== undefined) {
        setLat(data.lat);
        setLng(data.lng);
        if (data.placeQuery && !title) setTitle(data.placeQuery);
        setUrlResolveMsg(
          `✓ 座標を取得しました (${data.lat.toFixed(5)}, ${data.lng.toFixed(5)})。下の地図でピンを微調整できます！`,
        );
      } else {
        setUrlResolveMsg(
          'URLから座標を直接特定できませんでした。隣の「施設・住所検索」または地図タップをご利用ください。',
        );
      }
    } catch {
      setUrlResolveMsg('URL解析に失敗しました。');
    }
  };

  const handlePlaceSearch = async () => {
    if (!placeSearchInput.trim()) return;
    const res = await fetch(
      `/api/locations/search?q=${encodeURIComponent(placeSearchInput.trim())}`,
    );
    if (!res.ok) return;
    const data = (await res.json()) as { candidates: PlaceCandidate[] };
    setPlaceCandidates(data.candidates);
  };

  const toggleMember = (name: string) => {
    setSelectedMembers((prev) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isGuest) {
      onRequireAuth();
      return;
    }
    setSubmitStatus(null);
    setSubmitting(true);

    const existingSpot = duplicates.find((d) => d.id === selectedExistingSpotId);
    const effectiveTitle = existingSpot ? existingSpot.title : title.trim();

    try {
      const res = await fetch('/api/spots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          existingSpotId: selectedExistingSpotId || undefined,
          title: effectiveTitle,
          lat,
          lng,
          arrivalRadiusMeters,
          mediaCategory,
          description,
          referenceUrl,
          members: selectedMembers,
          hashtags: hashtagsInput
            .split(/[,\s、#]+/)
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSubmitStatus({
          type: 'error',
          text: data.error ?? '登録に失敗しました',
        });
      } else {
        setSubmitStatus({
          type: 'success',
          text: selectedExistingSpotId
            ? `既存スポット「${effectiveTitle}」に新しい聖地エピソードを追記しました！`
            : `新しい聖地「${effectiveTitle}」を登録しました！`,
        });
        setTitle('');
        setDescription('');
        setReferenceUrl('');
        setSelectedMembers([]);
        setHashtagsInput('');
        setSelectedExistingSpotId('');
        onSpotCreated();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportText(text);
    setImportFormat(file.name.toLowerCase().endsWith('.kml') ? 'kml' : 'csv');
  };

  const handleRunBulkImport = async () => {
    if (!importText.trim()) return;
    setImportStatus('インポート・重複統合を実行中...');
    const res = await fetch('/api/admin/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: importFormat,
        content: importText,
      }),
    });
    const data = (await res.json()) as {
      error?: string;
      addedSpots?: number;
      mergedEpisodes?: number;
      totalSpots?: number;
    };
    if (!res.ok) {
      setImportStatus(`エラー: ${data.error ?? '失敗しました'}`);
    } else {
      setImportStatus(
        `✓ 完了！新規スポット ${data.addedSpots}件追加 / 近接スポットへのエピソード統合 ${data.mergedEpisodes}件（総計 ${data.totalSpots}スポット）`,
      );
      onSpotCreated();
    }
  };

  const handleResolveReport = async (
    reportId: string,
    status: 'resolved' | 'dismissed',
  ) => {
    const res = await fetch(`/api/admin/reports/${reportId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setOpenReports((prev) => prev.filter((r) => r.id !== reportId));
    }
  };

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      {isGuest && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex flex-wrap items-center justify-between gap-3 text-amber-900 text-xs">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-extrabold">
                聖地の追加には無料アカウント登録（またはログイン）が必要です
              </p>
              <p className="mt-0.5">
                これまでのゲスト訪問履歴・アルバム写真は登録後もそのまま引き継がれます！
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRequireAuth}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            アカウント登録 / ログイン
          </button>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-3xl border border-sky-100 shadow-sm p-6 space-y-6"
      >
        <div>
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-sky-600" />
            聖地・エピソードを追加する
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            ① GoogleマップURL読取、② 施設・住所検索、③ ミニマップ上のピンドラッグ微調整の3ステップで正確な立ち位置を登録できます。
          </p>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-slate-700">
                方法A：Googleマップ共有URL / 短縮URL
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={mapUrlInput}
                  onChange={(e) => setMapUrlInput(e.target.value)}
                  placeholder="https://maps.app.goo.gl/... または座標"
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs"
                />
                <button
                  type="button"
                  onClick={handleResolveMapUrl}
                  className="px-3 py-2 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-800 text-xs font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  読取
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-slate-700">
                方法B：施設名・駅名・住所で検索
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={placeSearchInput}
                  onChange={(e) => setPlaceSearchInput(e.target.value)}
                  placeholder="例: 晴海橋公園 / 調布駅 / 東京ドーム"
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs"
                />
                <button
                  type="button"
                  onClick={handlePlaceSearch}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5" />
                  検索
                </button>
              </div>
            </div>
          </div>

          {placeCandidates.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 flex flex-wrap gap-1.5">
              {placeCandidates.map((cand, i) => (
                <button
                  key={`${cand.lat}_${cand.lng}_${i}`}
                  type="button"
                  onClick={() => {
                    setLat(cand.lat);
                    setLng(cand.lng);
                    if (!title) setTitle(cand.name);
                    setPlaceCandidates([]);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:border-sky-400 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  📍 {cand.name}
                </button>
              ))}
            </div>
          )}

          {urlResolveMsg && (
            <p className="text-xs text-sky-700 font-medium">{urlResolveMsg}</p>
          )}

          <SeichiMap
            centerLat={lat}
            centerLng={lng}
            zoom={15}
            pickerMode
            pickerLat={lat}
            pickerLng={lng}
            onPickerChange={(newLat, newLng) => {
              setLat(newLat);
              setLng(newLng);
            }}
            heightClassName="h-64"
          />
          <p className="text-xs text-slate-500 inline-flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-sky-600" />
            選択座標: {lat.toFixed(6)}, {lng.toFixed(6)}（地図クリックまたはピンドラッグで微調整）
          </p>
        </div>

        {/* 半径60m重複検知サジェスト */}
        {duplicates.length > 0 && (
          <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 space-y-2.5">
            <p className="text-xs font-extrabold text-sky-900">
              💡 半径60m以内に登録済みの聖地が見つかりました（PostGIS 空間重複検知）
            </p>
            <div className="space-y-1.5">
              {duplicates.map((dup) => {
                const selected = selectedExistingSpotId === dup.id;
                return (
                  <button
                    key={dup.id}
                    type="button"
                    onClick={() =>
                      setSelectedExistingSpotId(selected ? '' : dup.id)
                    }
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between cursor-pointer transition ${
                      selected
                        ? 'bg-sky-600 text-white border-sky-700 font-bold'
                        : 'bg-white text-slate-800 border-sky-200 hover:bg-sky-100/50'
                    }`}
                  >
                    <span>
                      {selected ? '✓ エピソード追記中: ' : ''}
                      {dup.title}（距離 {dup.distanceMeters}m・既存 {dup.episodeCount}件）
                    </span>
                    <span className="underline text-[11px]">
                      {selected ? '新規スポットに戻す' : 'この場所に追記する'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!selectedExistingSpotId && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="block text-xs font-extrabold text-slate-700">
                聖地の正式タイトル
              </label>
              <input
                type="text"
                required={!selectedExistingSpotId}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: キャットストリート / 〇〇カフェ"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-extrabold text-slate-700">
                到着判定の半径
              </label>
              <select
                value={arrivalRadiusMeters}
                onChange={(e) => setArrivalRadiusMeters(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white"
              >
                <option value={50}>50m（店舗・ピンポイント）</option>
                <option value={80}>80m（標準）</option>
                <option value={150}>150m（公園・駅・大型施設）</option>
                <option value={250}>250m（ドーム・スタジアム）</option>
              </select>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-extrabold text-slate-700">
              媒体カテゴリ
            </label>
            <select
              value={mediaCategory}
              onChange={(e) => setMediaCategory(e.target.value as MediaCategory)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white"
            >
              {Object.entries(MEDIA_CATEGORY_META).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-extrabold text-slate-700">
              参考URL（httpsのみ・YouTube秒数 ?t= 対応）
            </label>
            <input
              type="url"
              value={referenceUrl}
              onChange={(e) => setReferenceUrl(e.target.value)}
              placeholder="https://youtu.be/...?t=142 または公式ブログURL"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-extrabold text-slate-700">
            聖地の説明（到着後に解禁される解説文）
          </label>
          <textarea
            required
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例: 日向坂ちゃんねる『〇〇企画』（3:15〜）で山下葉留花さんが食べていたかき氷店。"
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-extrabold text-slate-700">
            関連メンバー（複数選択可）
          </label>
          <div className="max-h-36 overflow-y-auto rounded-2xl border border-slate-200 p-3 flex flex-wrap gap-1.5 bg-slate-50/50">
            {HINATAZAKA_MEMBERS.map((m) => {
              const active = selectedMembers.includes(m.name);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMember(m.name)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer ${
                    active
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'bg-white text-slate-700 border border-slate-200 hover:border-sky-300'
                  }`}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-extrabold text-slate-700">
            自由ハッシュタグ
          </label>
          <input
            type="text"
            value={hashtagsInput}
            onChange={(e) => setHashtagsInput(e.target.value)}
            placeholder="例: ソンナコトナイヨ, 日向坂ちゃんねる"
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs"
          />
        </div>

        {submitStatus && (
          <div
            className={`p-3.5 rounded-2xl text-xs font-bold flex items-center gap-2 ${
              submitStatus.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-700 border border-rose-200'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {submitStatus.text}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3.5 rounded-2xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white font-extrabold text-sm shadow cursor-pointer"
        >
          {isGuest
            ? 'アカウント登録・ログインして聖地を追加する'
            : selectedExistingSpotId
              ? '既存スポットにエピソードを追記する'
              : 'この内容で聖地を登録する'}
        </button>
      </form>

      {/* 管理者機能：マイマップURL直接同期 / KML・CSVインポート / 通報審査 */}
      {isAdmin && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-indigo-200 shadow-sm p-6 space-y-4">
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
              管理者機能：GoogleマイマップURL同期 / KML・CSV一括取込
            </h3>

            <div className="flex flex-wrap items-center gap-3">
              <select
                value={importFormat}
                onChange={(e) => {
                  const nextFmt = e.target.value as 'mymap_url' | 'csv' | 'kml';
                  setImportFormat(nextFmt);
                  if (nextFmt === 'mymap_url') {
                    setImportText(
                      'https://www.google.com/maps/d/viewer?mid=14Otcijw10dc-Fyu1P-q-BygLgiLK2sQ',
                    );
                  } else {
                    setImportText('');
                  }
                }}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white font-semibold"
              >
                <option value="mymap_url">Googleマイマップ公開URLから直接同期</option>
                <option value="csv">CSVテキスト / ファイル</option>
                <option value="kml">KMLファイル</option>
              </select>

              {importFormat !== 'mymap_url' && (
                <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer">
                  <Upload className="w-4 h-4" />
                  ファイル(.kml / .csv)を選択
                  <input
                    type="file"
                    accept=".csv,.kml,.xml"
                    onChange={handleFileImport}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {importFormat === 'mymap_url' ? (
              <input
                type="url"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="https://www.google.com/maps/d/viewer?mid=..."
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-mono"
              />
            ) : (
              <textarea
                rows={4}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono"
              />
            )}

            {importStatus && (
              <p className="text-xs font-bold text-indigo-700 bg-indigo-50 px-3 py-2 rounded-xl">
                {importStatus}
              </p>
            )}

            <button
              type="button"
              disabled={!importText.trim()}
              onClick={handleRunBulkImport}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-extrabold cursor-pointer"
            >
              差分同期・一括インポートを実行
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-rose-100 shadow-sm p-6 space-y-3">
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-rose-600" />
              管理者機能：未対応の通報キュー（{openReports.length}件）
            </h3>
            {openReports.length === 0 ? (
              <p className="text-xs text-slate-400">現在未対応の通報はありません。</p>
            ) : (
              <div className="space-y-2">
                {openReports.map((rep) => (
                  <div
                    key={rep.id}
                    className="rounded-xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="font-bold text-rose-700 mr-2">
                        [{rep.reason}]
                      </span>
                      <span className="font-extrabold text-slate-800">
                        {rep.spotTitle ?? rep.spotId}
                      </span>
                      {rep.detail && (
                        <p className="text-slate-600 mt-0.5">{rep.detail}</p>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleResolveReport(rep.id, 'resolved')}
                        className="px-3 py-1 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                      >
                        対応済にする
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolveReport(rep.id, 'dismissed')}
                        className="px-3 py-1 rounded-lg bg-slate-200 text-slate-700 font-bold cursor-pointer"
                      >
                        却下
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
