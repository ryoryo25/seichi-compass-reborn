import { resolveRepository } from '@seichi/db';
import { MEDIA_CATEGORY_META, type MediaCategory, maskSpotTitle } from '@seichi/shared';
import { Compass } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

interface SpotSharePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: SpotSharePageProps): Promise<Metadata> {
  const { id } = await params;
  const repo = resolveRepository(process.env.DATABASE_URL);
  const spot = await repo.getSpotById(id);
  if (!spot) {
    return { title: '聖地が見つかりません | 聖地コンパス' };
  }

  const masked = maskSpotTitle(spot.id, spot.title, 'normal');
  const members = Array.from(
    new Set(spot.episodes.flatMap((e) => e.members)),
  ).slice(0, 3);
  const memberHint = members.length > 0 ? `（#${members.join(' #')}）` : '';

  const title = `聖地「${masked}」を探そう！ | 聖地コンパス 日向坂46 Edition`;
  const description = `${spot.prefecture}にある日向坂46の聖地${memberHint}。コンパスと虫食いヒントだけを頼りに現地で発見しよう！`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function SpotSharePage({ params }: SpotSharePageProps) {
  const { id } = await params;
  const repo = resolveRepository(process.env.DATABASE_URL);
  const spot = await repo.getSpotById(id);
  if (!spot) notFound();

  const masked = maskSpotTitle(spot.id, spot.title, 'normal');
  const categories = Array.from(
    new Set(spot.episodes.map((e) => e.mediaCategory)),
  ) as MediaCategory[];
  const members = Array.from(
    new Set(spot.episodes.flatMap((e) => e.members)),
  ).slice(0, 6);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-sky-50 to-white">
      <div className="max-w-md w-full bg-white rounded-3xl border border-sky-100 shadow-xl p-7 text-center space-y-6">
        <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-sky-400 to-indigo-600 text-white flex items-center justify-center mx-auto shadow-md">
          <Compass className="w-9 h-9" />
        </div>

        <div className="space-y-2">
          <span className="inline-block text-xs font-extrabold px-3 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
            {spot.prefecture}・到着判定 {spot.arrivalRadiusMeters}m圏内
          </span>
          <p className="text-xs font-bold text-slate-400 pt-1">
            ネタバレ防止のため到着まで虫食い表示中
          </p>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-wide">
            {masked}
          </h1>
        </div>

        <div className="flex flex-wrap justify-center gap-1.5">
          {categories.map((cat) => (
            <span
              key={cat}
              className="text-xs font-bold px-2.5 py-0.5 rounded-full text-white"
              style={{ backgroundColor: MEDIA_CATEGORY_META[cat].color }}
            >
              #{MEDIA_CATEGORY_META[cat].shortLabel}
            </span>
          ))}
          {members.map((m) => (
            <span
              key={m}
              className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200"
            >
              #{m}
            </span>
          ))}
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          アプリ未導入でも今すぐブラウザ上のコンパスでこの聖地の方向・残り距離を探索できます！
        </p>

        <div className="space-y-2.5 pt-2">
          <Link
            href={`/?compass=${encodeURIComponent(spot.id)}`}
            className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-extrabold text-sm shadow-md flex items-center justify-center gap-2 hover:opacity-95"
          >
            <Compass className="w-4 h-4" />
            この聖地をコンパスで探す
          </Link>
          <Link
            href="/"
            className="block text-xs font-bold text-slate-500 hover:text-sky-700 py-2"
          >
            周辺の聖地一覧トップへ
          </Link>
        </div>
      </div>
    </div>
  );
}
