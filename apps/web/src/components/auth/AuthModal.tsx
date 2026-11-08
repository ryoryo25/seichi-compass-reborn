'use client';

import type { AuthUser, VisitRecord } from '@seichi/shared';
import { KeyRound, Sparkles, UserPlus, X } from 'lucide-react';
import { useState } from 'react';

export interface AuthModalProps {
  currentUser: AuthUser | null;
  oauthProviders: {
    twitter: boolean;
    google: boolean;
    apple: boolean;
  };
  onClose: () => void;
  onAuthenticated: (
    user: AuthUser,
    visits: Record<string, VisitRecord>,
  ) => void;
}

export function AuthModal({
  currentUser,
  oauthProviders,
  onClose,
  onAuthenticated,
}: AuthModalProps) {
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [name, setName] = useState(currentUser?.name ?? 'おひさま探索者');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/signin';
      const payload =
        mode === 'signup' ? { name, email, password } : { email, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        user?: AuthUser;
        visits?: Record<string, VisitRecord>;
      };
      if (!res.ok || !data.user) {
        setError(data.error ?? '認証処理に失敗しました');
        return;
      }
      onAuthenticated(data.user, data.visits ?? {});
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-sky-100 overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-sky-500 to-indigo-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            <h2 className="text-base font-black">
              アカウント連携・ログイン
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {currentUser?.isAnonymous && (
            <div className="rounded-2xl bg-sky-50 border border-sky-200 p-3.5 text-xs text-sky-900 leading-relaxed">
              💡 <strong>ゲストデータの自動引き継ぎに対応！</strong>
              <br />
              現在ゲスト利用中の訪問達成バッジ・非公開アルバム写真は、新規登録またはログインすると自動的にアカウントへ統合されます。
            </div>
          )}

          {/* モード切替 */}
          <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-xs font-extrabold">
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError(null);
              }}
              className={`py-2 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                mode === 'signup'
                  ? 'bg-white text-sky-700 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              新規登録（ゲスト引継）
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError(null);
              }}
              className={`py-2 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                mode === 'signin'
                  ? 'bg-white text-sky-700 shadow-xs'
                  : 'text-slate-500'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              ログイン
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'signup' && (
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  ニックネーム
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs"
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">
                メールアドレス
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ohisama@example.com"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">
                パスワード（8文字以上）
              </label>
              <input
                type="password"
                required
                minLength={mode === 'signup' ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs"
              />
            </div>

            {error && (
              <p className="text-xs font-bold text-rose-600 bg-rose-50 px-3 py-2 rounded-xl border border-rose-200">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-2xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white text-xs font-extrabold cursor-pointer"
            >
              {submitting
                ? '処理中...'
                : mode === 'signup'
                  ? 'アカウントを作成して引き継ぐ'
                  : 'ログインする'}
            </button>
          </form>

          {/* OAuth ソーシャルログイン（.env にキー設定時に自動有効化） */}
          {(oauthProviders.twitter || oauthProviders.google || oauthProviders.apple) && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <p className="text-[11px] font-bold text-center text-slate-400">
                またはSNSアカウントで連携
              </p>
              <div className="grid grid-cols-1 gap-2">
                {oauthProviders.twitter && (
                  <a
                    href="/api/auth/oauth-start/twitter"
                    className="py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold text-center"
                  >
                    𝕏（Twitter）でログイン
                  </a>
                )}
                {oauthProviders.google && (
                  <a
                    href="/api/auth/oauth-start/google"
                    className="py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold text-center hover:bg-slate-50"
                  >
                    Google でログイン
                  </a>
                )}
                {oauthProviders.apple && (
                  <a
                    href="/api/auth/oauth-start/apple"
                    className="py-2.5 rounded-xl bg-black text-white text-xs font-bold text-center"
                  >
                    Apple でサインイン
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
