'use client';

import {
  type AuthUser,
  MEDIA_CATEGORY_META,
  type Spot,
  type SpotComment,
  type SpotReportReason,
  validateAndParseReferenceUrl,
  type VisitRecord,
} from '@seichi/shared';
import {
  Award,
  Camera,
  CheckCircle2,
  ExternalLink,
  Flag,
  Lock,
  MessageSquarePlus,
  Share2,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { compressImageToDataUrl } from '@/lib/storage';

export interface SpotDetailModalProps {
  spot: Spot;
  visitEntry?: VisitRecord;
  currentUser: AuthUser | null;
  initialComments: SpotComment[];
  onClose: () => void;
  onVisitUpdated: (updated: VisitRecord) => void;
  onSpotDeleted?: (spotId: string) => void;
}

export function SpotDetailModal({
  spot,
  visitEntry,
  currentUser,
  initialComments,
  onClose,
  onVisitUpdated,
  onSpotDeleted,
}: SpotDetailModalProps) {
  const [memo, setMemo] = useState(visitEntry?.privateMemo ?? '');
  const [photoCacheBust, setPhotoCacheBust] = useState(() => Date.now());
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingMemo, setSavingMemo] = useState(false);
  const [albumToast, setAlbumToast] = useState<string | null>(null);

  const [comments, setComments] = useState<SpotComment[]>(initialComments);
  const [commentText, setCommentText] = useState('');
  const [isPublicComment, setIsPublicComment] = useState(
    currentUser?.settings.defaultPublicComment ?? true,
  );
  const [submittingComment, setSubmittingComment] = useState(false);

  // 通報フォーム
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] =
    useState<SpotReportReason>('wrong_location');
  const [reportDetail, setReportDetail] = useState('');
  const [reportSent, setReportSent] = useState(false);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const compressedDataUrl = await compressImageToDataUrl(file);
      const res = await fetch(`/api/me/visits/${spot.id}/photo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl: compressedDataUrl }),
      });
      const data = (await res.json()) as { error?: string; visit?: VisitRecord };
      if (!res.ok || !data.visit) {
        alert(data.error ?? '写真の保存に失敗しました');
        return;
      }
      onVisitUpdated(data.visit);
      setPhotoCacheBust(Date.now());
      setAlbumToast('✓ 非公開アルバム（R2）に写真を保存しました！');
      setTimeout(() => setAlbumToast(null), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : '画像の処理に失敗しました');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSaveMemo = async () => {
    setSavingMemo(true);
    try {
      const res = await fetch(`/api/me/visits/${spot.id}/memo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privateMemo: memo }),
      });
      const data = (await res.json()) as { visit?: VisitRecord };
      if (res.ok && data.visit) {
        onVisitUpdated(data.visit);
        setAlbumToast('✓ アルバムメモを保存しました！');
        setTimeout(() => setAlbumToast(null), 2500);
      }
    } finally {
      setSavingMemo(false);
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/spots/${spot.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorName: currentUser?.settings.nickname ?? 'おひさま探索者',
          content: commentText.trim(),
          isPublic: isPublicComment,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { comment: SpotComment };
        setComments((prev) => [data.comment, ...prev]);
        setCommentText('');
      }
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`/api/spots/${spot.id}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: reportReason,
        detail: reportDetail,
      }),
    });
    if (res.ok) {
      setReportSent(true);
      setReportDetail('');
    }
  };

  const handleAdminDelete = async () => {
    if (!confirm(`管理者操作：「${spot.title}」を削除しますか？`)) return;
    const res = await fetch(`/api/admin/spots/${spot.id}`, { method: 'DELETE' });
    if (res.ok) {
      onSpotDeleted?.(spot.id);
      onClose();
    }
  };

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://seichi-compass.pages.dev';
  const shareUrl = `${origin}/spots/${spot.id}`;
  const shareText =
    visitEntry?.status === 'visited'
      ? `聖地コンパスで日向坂46の聖地（${spot.prefecture}）を${
          visitEntry.selfDiscovered ? 'コンパス自力発見' : '訪問達成'
        }しました！🧭☀️ #日向坂46 #聖地コンパス`
      : `日向坂46の聖地（${spot.prefecture}）をチェックしました！☀️ #日向坂46 #聖地コンパス`;

  const xShareHref = `https://x.com/intent/tweet?text=${encodeURIComponent(
    shareText,
  )}&url=${encodeURIComponent(shareUrl)}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl border border-sky-100">
        {/* ヘッダー */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-100 px-6 py-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {visitEntry?.status === 'visited' ? (
                <span className="inline-flex items-center gap-1 text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-sky-600 text-white">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  訪問達成！
                </span>
              ) : visitEntry?.status === 'give_up' ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700">
                  ギブアップ閲覧（未達成）
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                  管理者プレビュー（未訪問）
                </span>
              )}
              {visitEntry?.selfDiscovered && (
                <span className="inline-flex items-center gap-1 text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                  <Award className="w-3.5 h-3.5" />
                  コンパス自力発見バッジ
                </span>
              )}
              <span className="text-xs font-semibold text-slate-500">
                {spot.prefecture}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900">
              {spot.title}
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            {currentUser?.role === 'admin' && (
              <button
                type="button"
                onClick={handleAdminDelete}
                title="管理者削除"
                className="p-2 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-7">
          {/* エピソード一覧 */}
          <section className="space-y-4">
            <h3 className="text-sm font-extrabold text-slate-800">
              🎬 登場エピソード（{spot.episodes.length}件）
            </h3>

            {spot.episodes.map((ep) => {
              const catMeta = MEDIA_CATEGORY_META[ep.mediaCategory];
              const refCheck = ep.referenceUrl
                ? validateAndParseReferenceUrl(ep.referenceUrl)
                : null;

              return (
                <div
                  key={ep.id}
                  className="rounded-2xl border border-slate-200 p-4 space-y-3 bg-slate-50/60"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="text-xs font-bold px-2.5 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: catMeta.color }}
                    >
                      {catMeta.label}
                    </span>
                    {ep.members.map((m) => (
                      <span
                        key={m}
                        className="text-xs font-semibold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800"
                      >
                        #{m}
                      </span>
                    ))}
                    {ep.hashtags.map((tag) => (
                      <span
                        key={tag}
                        className="text-xs px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>

                  <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                    {ep.description}
                  </p>

                  {ep.youtubeVideoId && (
                    <div className="aspect-video w-full rounded-xl overflow-hidden bg-black border border-slate-200">
                      <iframe
                        title={spot.title}
                        src={`https://www.youtube.com/embed/${ep.youtubeVideoId}${
                          ep.videoStartSec ? `?start=${ep.videoStartSec}` : ''
                        }`}
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  )}

                  {refCheck && refCheck.ok && (
                    <div className="pt-1">
                      <a
                        href={refCheck.normalizedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-700 hover:underline break-all"
                      >
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                        参考リンクを開く ({refCheck.hostname}
                        {ep.videoStartSec ? `・${ep.videoStartSec}秒〜` : ''})
                      </a>
                      {refCheck.trustTier === 'external_safe' && (
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                          <ShieldAlert className="w-3 h-3" />
                          外部サイトへ移動します。アクセス先の安全性にご注意ください。
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {/* ネタバレ防止シェアURL付き Xポスト & Googleマップ */}
          <div className="flex flex-wrap gap-3">
            <a
              href={xShareHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-[200px] py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-2"
            >
              <Share2 className="w-4 h-4" />
              𝕏（Twitter）で巡礼報告（虫食いカード付）
            </a>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5"
            >
              <ExternalLink className="w-4 h-4" />
              Googleマップ
            </a>
          </div>

          {/* 自分専用の巡礼アルバム（R2 非公開保存） */}
          {visitEntry && (
            <section className="rounded-2xl border border-sky-200 bg-sky-50/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-sky-950 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-sky-600" />
                  自分専用の巡礼アルバム（非公開ストレージ）
                </h3>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 bg-white px-2 py-0.5 rounded-full border border-sky-200">
                  <Lock className="w-3 h-3" />
                  本人のみ閲覧可能
                </span>
              </div>

              {visitEntry.hasPrivatePhoto && (
                <div className="relative rounded-xl overflow-hidden border border-sky-200 bg-white max-h-60 flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/me/visits/${spot.id}/photo?v=${photoCacheBust}`}
                    alt="自分の巡礼写真"
                    className="object-contain max-h-60"
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                <label className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-sky-300 text-sky-800 text-xs font-bold hover:bg-sky-100 cursor-pointer">
                  <Camera className="w-4 h-4" />
                  {uploadingPhoto
                    ? 'アップロード中...'
                    : visitEntry.hasPrivatePhoto
                      ? '写真を変更する'
                      : '巡礼写真をアップロード'}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploadingPhoto}
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="space-y-2">
                <textarea
                  rows={2}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="自分用の巡礼メモ（例：同じアングルで撮影できた！かき氷も美味しかった）"
                  className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-emerald-700 font-semibold">
                    {albumToast ?? ''}
                  </span>
                  <button
                    type="button"
                    disabled={savingMemo}
                    onClick={handleSaveMemo}
                    className="px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold cursor-pointer"
                  >
                    {savingMemo ? '保存中...' : 'アルバムメモを保存'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* 到着者限定ひとことコメント */}
          <section className="space-y-3 border-t border-slate-100 pt-5">
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
              <MessageSquarePlus className="w-4 h-4 text-sky-600" />
              おひさま巡礼ひとことコメント（解禁者のみ閲覧・投稿可）
            </h3>

            <form onSubmit={handlePostComment} className="space-y-2">
              <textarea
                rows={2}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="現地に行った感想や巡礼のコツをひとこと残せます"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPublicComment}
                    onChange={(e) => setIsPublicComment(e.target.checked)}
                    className="rounded text-sky-600"
                  />
                  他のおひさまにもコメントを公開する
                </label>
                <button
                  type="submit"
                  disabled={submittingComment || !commentText.trim()}
                  className="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-bold cursor-pointer"
                >
                  投稿する
                </button>
              </div>
            </form>

            <div className="space-y-2 pt-1">
              {comments.length === 0 ? (
                <p className="text-xs text-slate-400">
                  まだコメントはありません。最初のひとことを残してみましょう！
                </p>
              ) : (
                comments.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between text-slate-500">
                      <span className="font-bold text-slate-700">
                        {c.authorName}
                        {!c.isPublic && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                            自分のみ
                          </span>
                        )}
                      </span>
                      <span>{new Date(c.createdAt).toLocaleDateString('ja-JP')}</span>
                    </div>
                    <p className="text-slate-800 whitespace-pre-wrap">{c.content}</p>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* 誤情報・不審URLの通報 */}
          <section className="border-t border-slate-100 pt-3">
            {!showReportForm ? (
              <button
                type="button"
                onClick={() => setShowReportForm(true)}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-600 cursor-pointer"
              >
                <Flag className="w-3 h-3" />
                場所のズレ・重複・不審な参考URLを通報する
              </button>
            ) : reportSent ? (
              <p className="text-xs text-emerald-700 font-semibold">
                ✓ 通報を受け付けました。管理者が確認いたします。
              </p>
            ) : (
              <form
                onSubmit={handleSubmitReport}
                className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-2.5 text-xs"
              >
                <p className="font-bold text-slate-700">このスポットを通報する</p>
                <select
                  value={reportReason}
                  onChange={(e) =>
                    setReportReason(e.target.value as SpotReportReason)
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5"
                >
                  <option value="wrong_location">ピンの位置がズレている</option>
                  <option value="duplicate">別のスポットと重複している</option>
                  <option value="unsafe_url">参考URLが不審・リンク切れ</option>
                  <option value="closed_or_changed">閉店・移転している</option>
                  <option value="inappropriate">不適切な内容が含まれる</option>
                  <option value="other">その他</option>
                </select>
                <input
                  type="text"
                  value={reportDetail}
                  onChange={(e) => setReportDetail(e.target.value)}
                  placeholder="補足コメント（任意）"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowReportForm(false)}
                    className="px-3 py-1 rounded-lg text-slate-500 cursor-pointer"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    className="px-3.5 py-1 rounded-lg bg-rose-600 text-white font-bold cursor-pointer"
                  >
                    通報を送信
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
