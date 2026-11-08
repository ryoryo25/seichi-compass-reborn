import { resolveRepository } from '@seichi/db';
import { Award, Compass, MapPin, Trophy } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

interface UserAchievementsPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: UserAchievementsPageProps): Promise<Metadata> {
  const { id } = await params;
  const repo = resolveRepository(process.env.DATABASE_URL);
  const stats = await repo.getPublicUserAchievements(id);
  if (!stats) {
    return { title: '非公開プロフィール | 聖地コンパス' };
  }
  const title = `${stats.nickname}さんの聖地巡礼実績（達成 ${stats.visitedCount}ヶ所） | 聖地コンパス`;
  const description = `日向坂46の聖地を${stats.visitedCount}ヶ所訪問達成（コンパス自力発見 ${stats.selfDiscoveredCount}ヶ所・${stats.prefecturesVisited}都道府県制覇）！`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: 'summary', title, description },
  };
}

export default async function UserAchievementsPage({
  params,
}: UserAchievementsPageProps) {
  const { id } = await params;
  const repo = resolveRepository(process.env.DATABASE_URL);
  const stats = await repo.getPublicUserAchievements(id);

  if (!stats) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl border border-slate-200 p-8 max-w-md w-full text-center space-y-4">
          <p className="text-sm font-bold text-slate-700">
            このユーザーの実績は非公開に設定されているか、存在しません。
          </p>
          <Link
            href="/"
            className="inline-block px-5 py-2.5 rounded-xl bg-sky-600 text-white text-xs font-bold"
          >
            聖地コンパストップへ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-sky-50 to-white">
      <div className="max-w-lg w-full bg-white rounded-3xl border border-sky-100 shadow-xl overflow-hidden">
        <div className="bg-gradient-to-br from-sky-500 to-indigo-600 p-7 text-white text-center space-y-2">
          <p className="text-xs font-extrabold text-sky-100">
            聖地コンパス 日向坂46 巡礼実績カード
          </p>
          <h1 className="text-2xl font-black">{stats.nickname}</h1>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl bg-sky-50 border border-sky-100 p-3.5">
              <Trophy className="w-5 h-5 text-sky-600 mx-auto mb-1" />
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                {stats.visitedCount}
              </div>
              <div className="text-[11px] font-bold text-slate-500">訪問達成</div>
            </div>

            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3.5">
              <Award className="w-5 h-5 text-amber-600 mx-auto mb-1" />
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                {stats.selfDiscoveredCount}
              </div>
              <div className="text-[11px] font-bold text-slate-500">
                コンパス自力発見
              </div>
            </div>

            <div className="rounded-2xl bg-indigo-50 border border-indigo-100 p-3.5">
              <MapPin className="w-5 h-5 text-indigo-600 mx-auto mb-1" />
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                {stats.prefecturesVisited}
              </div>
              <div className="text-[11px] font-bold text-slate-500">
                訪問都道府県
              </div>
            </div>
          </div>

          {stats.topPrefectures.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-extrabold text-slate-700">
                よく巡っているエリア
              </p>
              <div className="flex flex-wrap gap-2">
                {stats.topPrefectures.map((p) => (
                  <span
                    key={p.prefecture}
                    className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold"
                  >
                    {p.prefecture}：{p.count}ヶ所
                  </span>
                ))}
              </div>
            </div>
          )}

          <Link
            href="/"
            className="w-full py-3 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold flex items-center justify-center gap-2"
          >
            <Compass className="w-4 h-4" />
            自分も聖地コンパスで探索する
          </Link>
        </div>
      </div>
    </div>
  );
}
