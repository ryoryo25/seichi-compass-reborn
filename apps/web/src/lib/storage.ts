import { type ExplorerSettings, ExplorerSettingsSchema } from '@seichi/shared';

export type UserRole = 'guest' | 'user' | 'admin';

export interface LocalVisitEntry {
  spotId: string;
  spotTitle: string;
  prefecture: string;
  status: 'visited' | 'give_up';
  selfDiscovered: boolean;
  visitedAt: string;
  privateMemo?: string;
  privatePhotoDataUrl?: string;
}

const SETTINGS_KEY = 'seichi_reborn_settings_v1';
const VISITS_KEY = 'seichi_reborn_visits_v1';
const ROLE_KEY = 'seichi_reborn_role_v1';

export function loadExplorerSettings(): ExplorerSettings {
  if (typeof window === 'undefined') {
    return ExplorerSettingsSchema.parse({});
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return ExplorerSettingsSchema.parse({});
    return ExplorerSettingsSchema.parse(JSON.parse(raw));
  } catch {
    return ExplorerSettingsSchema.parse({});
  }
}

export function saveExplorerSettings(settings: ExplorerSettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadVisitBook(): Record<string, LocalVisitEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(VISITS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, LocalVisitEntry>;
  } catch {
    return {};
  }
}

export function saveVisitBook(book: Record<string, LocalVisitEntry>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(VISITS_KEY, JSON.stringify(book));
}

export function loadUserRole(): UserRole {
  if (typeof window === 'undefined') return 'user';
  const saved = window.localStorage.getItem(ROLE_KEY);
  if (saved === 'guest' || saved === 'user' || saved === 'admin') return saved;
  return 'user';
}

export function saveUserRole(role: UserRole): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ROLE_KEY, role);
}

/**
 * 自分専用の非公開アルバム保存用にクライアント側で画像を軽量JPEG（最大幅960px）へ圧縮
 */
export async function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('非対応の画像形式です'));
      img.onload = () => {
        const maxDim = 960;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvasが利用できません'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
