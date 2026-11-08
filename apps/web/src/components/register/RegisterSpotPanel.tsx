'use client';

import {
  HINATAZAKA_MEMBERS,
  MEDIA_CATEGORY_META,
  type MediaCategory,
} from '@seichi/shared';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  MapPin,
  PlusCircle,
  Upload,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { SeichiMap } from '@/components/map/SeichiMap';
import type { UserRole } from '@/lib/storage';

interface DuplicateCandidate {
  id: string;
  title: string;
  distanceMeters: number;
  episodeCount: number;
  mediaCategories: MediaCategory[];
}

export interface RegisterSpotPanelProps {
  userRole: UserRole;
  initialLat: number;
  initialLng: number;
  onSpotCreated: () => void;
}

export function RegisterSpotPanel({
  userRole,
  initialLat,
  initialLng,
  onSpotCreated,
}: RegisterSpotPanelProps) {
  const [mapUrlInput, setMapUrlInput] = useState('');
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

  // 管理者一括インポート用
  const [importFormat, setImportFormat] = useState<'csv' | 'kml'>('csv');
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);

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

  const handleResolveMapUrl = async () => {
    if (!mapUrlInput.trim()) return;
    setUrlResolveMsg('URLを解析中...');
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
        sourceType: string;
      };
      if (data.lat !== undefined && data.lng !== undefined) {
        setLat(data.lat);
        setLng(data.lng);
        if (data.placeQuery && !title) {
          setTitle(data.placeQuery);
        }
        setUrlResolveMsg(
          `✓ 座標を読み取りました (${data.lat.toFixed(5)}, ${data.lng.toFixed(5)})。下の地図でピンをドラッグして微調整できます！`,
        );
      } else {
        setUrlResolveMsg(
          'URLから直接座標を抽出できませんでした。下のミニマップをタップ・ドラッグして位置を指定してください。',
        );
      }
    } catch {
      setUrlResolveMsg('URL解析に失敗しました。');
    }
  };

  const toggleMember = (name: string) => {
    setSelectedMembers((prev) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitStatus(null);
    setSubmitting(true);

    const existingSpot = duplicates.find((d) => d.id === selectedExistingSpotId);
    const effectiveTitle = existingSpot ? existingSpot.title : title.trim();

    try {
      const res = await fetch('/api/spots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
        },
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
    if (file.name.toLowerCase().endsWith('.kml')) {
      setImportFormat('kml');
    } else {
      setImportFormat('csv');
    }
  };

  const handleRunBulkImport = async () => {
    if (!importText.trim()) return;
    setImportStatus('インポート処理中...');
    const res = await fetch('/api/admin/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-role': userRole,
      },
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
        `✓ インポート完了！新規スポット ${data.addedSpots}件追加 / 近接スポットへのエピソード統合 ${data.mergedEpisodes}件（合計 ${data.totalSpots}スポット）`,
      );
      setImportText('');
      onSpotCreated();
    }
  };

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      {userRole === 'guest' && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3 text-amber-900 text-xs">
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-bold">現在「ゲスト（未ログイン）」状態です</p>
            <p className="mt-0.5">
              探索はログイン不要ですが、荒らし防止のため聖地の追加はログインユーザー限定としています。画面右上のロール切替から「ログイン中」または「管理者」に切り替えてお試しください。
            </p>
          </div>
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
            Googleマップの共有URLから座標を読み取り、ミニマップ上でピンをドラッグして正確な撮影立ち位置まで微調整できます。
          </p>
        </div>

        {/* Step 1: Google Maps URL 座標解析 + ミニマップ微調整 */}
        <div className="space-y-3">
          <label className="block text-xs font-extrabold text-slate-700">
            ① 場所を指定（GoogleマップURL または 緯度,経度）
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={mapUrlInput}
              onChange={(e) => setMapUrlInput(e.target.value)}
              placeholder="例: https://www.google.com/maps/place/... または 35.6652, 139.7058"
              className="flex-1 rounded-xl border border-slate-200 px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
            <button
              type="button"
              onClick={handleResolveMapUrl}
              className="px-4 py-2 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Link2 className="w-4 h-4" />
              座標読取
            </button>
          </div>
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
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-sky-600" />
              選択座標: {lat.toFixed(6)}, {lng.toFixed(6)}（地図クリックまたはピンドラッグで微調整）
            </span>
          </div>
        </div>

        {/* 重複検知サジェスト（半径60m以内） */}
        {duplicates.length > 0 && (
          <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 space-y-2.5">
            <p className="text-xs font-extrabold text-sky-900">
              💡 半径60m以内に登録済みの聖地が見つかりました（二重登録防止）
            </p>
            <p className="text-xs text-sky-800">
              同じお店や場所に別メンバー・別企画で訪れている場合は、既存スポットへの「エピソード追記」を選ぶと1つの聖地に綺麗にまとまります。
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

        {/* Step 2: タイトル & 判定半径 */}
        {!selectedExistingSpotId && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="block text-xs font-extrabold text-slate-700">
                ② 聖地の正式タイトル（探索者には自動で虫食い表示されます）
              </label>
              <input
                type="text"
                required={!selectedExistingSpotId}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: キャットストリート / 〇〇カフェ"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
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

        {/* Step 3: 媒体カテゴリ & 説明 & 参考URL */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-extrabold text-slate-700">
              ③ 媒体カテゴリ
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
            ④ 聖地の説明（到着後に解禁される解説文）
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

        {/* Step 4: メンバータグ & 自由ハッシュタグ */}
        <div className="space-y-2">
          <label className="block text-xs font-extrabold text-slate-700">
            ⑤ 関連メンバー（複数選択可）
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
            自由ハッシュタグ（カンマまたはスペース区切り）
          </label>
          <input
            type="text"
            value={hashtagsInput}
            onChange={(e) => setHashtagsInput(e.target.value)}
            placeholder="例: ソンナコトナイヨ, 日向坂ちゃんねる, 聖地巡礼"
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
          disabled={submitting || userRole === 'guest'}
          className="w-full py-3.5 rounded-2xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white font-extrabold text-sm shadow cursor-pointer"
        >
          {selectedExistingSpotId
            ? '既存スポットにエピソードを追記する'
            : 'この内容で聖地を登録する'}
        </button>
      </form>

      {/* 管理者専用：Googleマイマップ KML / CSV 一括インポート */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
              管理者機能：Googleマイマップ(KML) / CSV 一括インポート
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              近接する同名スポットは自動的に1箇所へエピソード統合され、本文からメンバー名も自動タギングされます。
            </p>
          </div>
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
            Admin限定
          </span>
        </div>

        {userRole !== 'admin' ? (
          <p className="text-xs text-slate-500 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            一括インポートを試すには、画面右上のロール表示を「管理者」に切り替えてください。
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={importFormat}
                onChange={(e) => setImportFormat(e.target.value as 'csv' | 'kml')}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white font-semibold"
              >
                <option value="csv">CSV形式</option>
                <option value="kml">Googleマイマップ KML形式</option>
              </select>

              <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer">
                <Upload className="w-4 h-4" />
                ファイル(.kml / .csv)を選択
                <input
                  type="file"
                  accept=".csv,.kml,.xml,text/csv,application/vnd.google-earth.kml+xml"
                  onChange={handleFileImport}
                  className="hidden"
                />
              </label>
            </div>

            <textarea
              rows={4}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={
                importFormat === 'csv'
                  ? 'title,lat,lng,mediaCategory,description,referenceUrl,members,hashtags\n調布駅,35.6518,139.5446,ブログ,ブログに登場した駅前,https://www.hinatazaka46.com/,松田好花,聖地'
                  : '<?xml version="1.0" encoding="UTF-8"?><kml ...>'
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono"
            />

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
              一括インポートを実行
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
