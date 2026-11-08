'use client';

import {
  formatDistance,
  MEDIA_CATEGORY_META,
  type MaskedSpotSummary,
} from '@seichi/shared';
import { ArrowLeft, Compass, Flag, Footprints, Sparkles } from 'lucide-react';

function bearingToJapaneseDirection(deg: number): string {
  const dirs = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'] as const;
  const idx = Math.round(((deg % 360) / 45)) % 8;
  return dirs[idx] ?? '北';
}

export interface CompassViewProps {
  spot: MaskedSpotSummary;
  deviceHeadingDeg: number;
  isDemoMode: boolean;
  isUnlocking: boolean;
  needsCompassPermission?: boolean;
  errorMessage?: string | null;
  onBack: () => void;
  onRequestCompassPermission?: () => void;
  onDemoApproach: () => void;
  onArriveUnlock: () => void;
  onGiveUpUnlock: () => void;
}

export function CompassView({
  spot,
  deviceHeadingDeg,
  isDemoMode,
  isUnlocking,
  needsCompassPermission = false,
  errorMessage,
  onBack,
  onRequestCompassPermission,
  onDemoApproach,
  onArriveUnlock,
  onGiveUpUnlock,
}: CompassViewProps) {
  const canArrive = spot.distanceMeters <= spot.arrivalRadiusMeters;
  const relativeAngle = (spot.bearingDeg - deviceHeadingDeg + 360) % 360;
  const directionText = bearingToJapaneseDirection(spot.bearingDeg);

  return (
    <div className="bg-white rounded-3xl border border-sky-100 shadow-sm p-5 sm:p-7 max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-sky-700 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          周辺の聖地一覧へ戻る
        </button>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
          {spot.prefecture}・到着判定 {spot.arrivalRadiusMeters}m圏内
        </span>
      </div>

      {/* 虫食いタイトル & 残り距離 */}
      <div className="text-center space-y-2 mb-6">
        <p className="text-xs font-bold tracking-wider text-sky-600 uppercase">
          聖地へ行こう！
        </p>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-wide">
          {spot.displayTitle}
        </h2>
        <div className="flex items-baseline justify-center gap-2 pt-1">
          <span className="text-4xl sm:text-5xl font-black text-sky-600 tabular-nums">
            {formatDistance(spot.distanceMeters)}
          </span>
          <span className="text-sm font-semibold text-slate-500">
            （真{directionText} {Math.round(spot.bearingDeg)}°）
          </span>
        </div>

        {/* 事前ヒントタグ */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 pt-2">
          {spot.visibleMediaCategories.map((cat) => (
            <span
              key={cat}
              className="text-xs font-bold px-2.5 py-0.5 rounded-full text-white"
              style={{ backgroundColor: MEDIA_CATEGORY_META[cat].color }}
            >
              #{MEDIA_CATEGORY_META[cat].shortLabel}
            </span>
          ))}
          {spot.visibleMembers.slice(0, 5).map((m) => (
            <span
              key={m}
              className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200"
            >
              #{m}
            </span>
          ))}
          {spot.visibleHashtags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"
            >
              #{tag}
            </span>
          ))}
        </div>
      </div>

      {/* コンパスダイヤル（スライド15・22のデザインをモダンに再現） */}
      <div className="relative w-64 h-64 sm:w-72 sm:h-72 mx-auto my-6 flex items-center justify-center">
        <div
          className={`absolute inset-0 rounded-full border-4 transition-colors duration-500 ${
            canArrive
              ? 'border-amber-400 bg-amber-50/40 shadow-[0_0_40px_rgba(251,191,36,0.35)]'
              : 'border-sky-100 bg-gradient-to-b from-sky-50/60 to-white'
          }`}
        />

        {/* 方位目盛り（端末の向きに応じて背景リングが回転） */}
        <div
          className="absolute inset-3 rounded-full border border-dashed border-sky-200 transition-transform duration-200"
          style={{ transform: `rotate(${-deviceHeadingDeg}deg)` }}
        >
          <span className="absolute top-1.5 left-1/2 -translate-x-1/2 text-xs font-black text-rose-500">
            N
          </span>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
            E
          </span>
          <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-xs font-bold text-slate-400">
            S
          </span>
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
            W
          </span>
        </div>

        {/* 聖地の方向を指すダイヤモンド針 */}
        <div
          className="relative w-44 h-44 transition-transform duration-300 ease-out flex items-center justify-center"
          style={{ transform: `rotate(${relativeAngle}deg)` }}
        >
          <svg viewBox="0 0 120 120" className="w-full h-full drop-shadow-md">
            {/* 先端（赤/空色：聖地の方向） */}
            <polygon
              points="60,8 84,60 60,52 36,60"
              fill={canArrive ? '#f59e0b' : '#ef4444'}
              stroke="#1e293b"
              strokeWidth="1.5"
            />
            {/* 後端（白） */}
            <polygon
              points="60,112 84,60 60,68 36,60"
              fill="#ffffff"
              stroke="#64748b"
              strokeWidth="1.5"
            />
            <circle cx="60" cy="60" r="5" fill="#0f172a" />
          </svg>
        </div>
      </div>

      {needsCompassPermission && !isDemoMode && (
        <div className="mb-4 text-center">
          <button
            type="button"
            onClick={onRequestCompassPermission}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold shadow-xs cursor-pointer"
          >
            <Compass className="w-4 h-4" />
            端末の方位センサー（電子コンパス）を有効にする
          </button>
        </div>
      )}

      {canArrive ? (
        <div className="mb-4 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-center text-sm font-bold">
          🎉 聖地の到着圏内（{spot.arrivalRadiusMeters}m以内）に入りました！
        </div>
      ) : (
        <p className="text-center text-xs text-slate-500 mb-4">
          赤い針が真上を指す方向へ進んでください。残り {spot.arrivalRadiusMeters}m 以内に入ると発見ボタンが解禁されます。
        </p>
      )}

      {errorMessage && (
        <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold text-center">
          {errorMessage}
        </div>
      )}

      {/* アクションボタン群 */}
      <div className="space-y-3">
        <button
          type="button"
          disabled={!canArrive || isUnlocking}
          onClick={onArriveUnlock}
          className={`w-full py-3.5 px-5 rounded-2xl font-extrabold text-base flex items-center justify-center gap-2 transition-all ${
            canArrive
              ? 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-lg hover:opacity-95 cursor-pointer'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          <Sparkles className="w-5 h-5" />
          {spot.isUnlocked ? '聖地の詳細を見る' : '聖地を発見！（達成登録）'}
        </button>

        {isDemoMode && !canArrive && (
          <button
            type="button"
            onClick={onDemoApproach}
            className="w-full py-2.5 px-4 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Footprints className="w-4 h-4" />
            デモ移動：この聖地の近く（到着圏内）まで歩いて近づく
          </button>
        )}

        {!spot.isUnlocked && (
          <div className="pt-2 text-center">
            <button
              type="button"
              disabled={isUnlocking}
              onClick={onGiveUpUnlock}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 underline underline-offset-4 cursor-pointer"
            >
              <Flag className="w-3.5 h-3.5" />
              どうしても近づけないのでギブアップして詳細を見る（達成バッジなし）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
