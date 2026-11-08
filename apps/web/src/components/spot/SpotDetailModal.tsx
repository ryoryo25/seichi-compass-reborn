'use client';

import {
  MEDIA_CATEGORY_META,
  type Spot,
  type SpotComment,
  validateAndParseReferenceUrl,
} from '@seichi/shared';
import {
  Award,
  Camera,
  CheckCircle2,
  ExternalLink,
  Lock,
  MessageSquarePlus,
  Share2,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { compressImageToDataUrl, type LocalVisitEntry } from '@/lib/storage';

export interface SpotDetailModalProps {
  spot: Spot;
  visitEntry: LocalVisitEntry;
  initialComments: SpotComment[];
  defaultPublicComment: boolean;
  nickname: string;
  onClose: () => void;
  onSavePrivateAlbum: (spotId: string, memo: string, photoDataUrl?: string) => void;
}

export function SpotDetailModal({
  spot,
  visitEntry,
  initialComments,
  defaultPublicComment,
  nickname,
  onClose,
  onSavePrivateAlbum,
}: SpotDetailModalProps) {
  const [memo, setMemo] = useState(visitEntry.privateMemo ?? '');
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(
    visitEntry.privatePhotoDataUrl,
  );
  const [albumSavedToast, setAlbumSavedToast] = useState(false);

  const [comments, setComments] = useState<SpotComment[]>(initialComments);
  const [commentText, setCommentText] = useState('');
  const [isPublicComment, setIsPublicComment] = useState(defaultPublicComment);
  const [submittingComment, setSubmittingComment] = useState(false);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageToDataUrl(file);
      setPhotoUrl(compressed);
      onSavePrivateAlbum(spot.id, memo, compressed);
      setAlbumSavedToast(true);
      setTimeout(() => setAlbumSavedToast(false), 2500);
    } catch (err) {
      alert(err instanceof Error ? err.message : '画像の処理に失敗しました');
    }
  };

  const handleSaveMemo = () => {
    onSavePrivateAlbum(spot.id, memo, photoUrl);
    setAlbumSavedToast(true);
    setTimeout(() => setAlbumSavedToast(false), 2500);
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
          authorName: nickname,
          content: commentText.trim(),
          isPublic: isPublicComment,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { comment: SpotComment };
        if (data.comment.isPublic) {
          setComments((prev) => [data.comment, ...prev]);
        }
        setCommentText('');
      }
    } finally {
      setSubmittingComment(false);
    }
  };

  const shareText =
    visitEntry.status === 'visited'
      ? `聖地コンパスで日向坂46の聖地「${spot.title}」（${spot.prefecture}）を発見しました！🧭☀️ #日向坂46 #聖地コンパス`
      : `日向坂46の聖地「${spot.title}」（${spot.prefecture}）をチェックしました！☀️ #日向坂46 #聖地コンパス`;

  const xShareHref = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl border border-sky-100">
        {/* ヘッダー */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-100 px-6 py-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {visitEntry.status === 'visited' ? (
                <span className="inline-flex items-center gap-1 text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-sky-600 text-white">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  訪問達成！
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700">
                  ギブアップ閲覧（未達成）
                </span>
              )}
              {visitEntry.selfDiscovered && (
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

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-7">
          {/* エピソード一覧（1地点複数シーン対応） */}
          <section className="space-y-4">
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-2">
              <span>🎬 登場エピソード（{spot.episodes.length}件）</span>
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

                  {/* YouTube 秒数指定埋め込み */}
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

                  {/* 参考URL安全リンク表示 */}
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

          {/* Xシェア & Googleマップ確認ボタン */}
          <div className="flex flex-wrap gap-3">
            <a
              href={xShareHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-[200px] py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-2"
            >
              <Share2 className="w-4 h-4" />
              𝕏（Twitter）で巡礼報告をポスト
            </a>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5"
            >
              <ExternalLink className="w-4 h-4" />
              Googleマップで開く
            </a>
          </div>

          {/* 自分専用の巡礼アルバム（完全非公開） */}
          <section className="rounded-2xl border border-sky-200 bg-sky-50/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-sky-950 flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-sky-600" />
                自分専用の巡礼アルバム（非公開）
              </h3>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 bg-white px-2 py-0.5 rounded-full border border-sky-200">
                <Lock className="w-3 h-3" />
                あなただけに表示されます
              </span>
            </div>

            {photoUrl && (
              <div className="relative rounded-xl overflow-hidden border border-sky-200 bg-white max-h-60 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl}
                  alt="自分の巡礼写真"
                  className="object-contain max-h-60"
                />
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <label className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-sky-300 text-sky-800 text-xs font-bold hover:bg-sky-100 cursor-pointer">
                <Camera className="w-4 h-4" />
                {photoUrl ? '写真を変更する' : '巡礼写真を追加する'}
                <input
                  type="file"
                  accept="image/*"
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
                  {albumSavedToast ? '✓ マイアルバムに保存しました！' : ''}
                </span>
                <button
                  type="button"
                  onClick={handleSaveMemo}
                  className="px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold cursor-pointer"
                >
                  アルバムメモを保存
                </button>
              </div>
            </div>
          </section>

          {/* 到着者限定ひとことコメント（画像なしテキストのみ・公開/非公開選択可） */}
          <section className="space-y-3 border-t border-slate-100 pt-5">
            <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
              <MessageSquarePlus className="w-4 h-4 text-sky-600" />
              おひさま巡礼ひとことコメント（解禁者のみ閲覧可）
            </h3>

            <form onSubmit={handlePostComment} className="space-y-2">
              <textarea
                rows={2}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="現地に行った感想や巡礼のコツをひとこと残せます（ネタバレ配慮のため解禁済みの人にだけ表示されます）"
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
                  まだ公開コメントはありません。最初のひとことを残してみましょう！
                </p>
              ) : (
                comments.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between text-slate-500">
                      <span className="font-bold text-slate-700">{c.authorName}</span>
                      <span>{new Date(c.createdAt).toLocaleDateString('ja-JP')}</span>
                    </div>
                    <p className="text-slate-800 whitespace-pre-wrap">{c.content}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
