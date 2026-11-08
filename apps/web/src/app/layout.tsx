import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '聖地コンパス Reborn 〜日向坂46 聖地・ロケ地巡りを楽しく〜',
  description:
    '虫食いヒントとコンパスを使って宝探し感覚で巡る、日向坂46の聖地巡礼プラットフォーム（プロトタイプ）',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="min-h-screen antialiased pb-20 sm:pb-10">{children}</body>
    </html>
  );
}
