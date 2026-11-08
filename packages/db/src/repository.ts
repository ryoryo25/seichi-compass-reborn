import type {
  AuthUser,
  CreateSpotInput,
  ExplorerSettings,
  MediaCategory,
  PublicUserAchievements,
  RawCandidateEpisode,
  Spot,
  SpotComment,
  SpotReport,
  SpotReportReason,
  UpdateSpotInput,
  VisitRecord,
} from '@seichi/shared';

export interface StoredPhotoObject {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * 自分専用アルバム画像の非公開ストレージ抽象化
 * 本番: Cloudflare R2 Bucket / ローカル開発: .local-data/r2-album/
 */
export interface PrivateAlbumStorage {
  putPhoto(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getPhoto(key: string): Promise<StoredPhotoObject | null>;
  deletePhoto(key: string): Promise<void>;
}

export interface SeichiRepository {
  // ユーザー・セッション・認証管理
  getOrCreateAnonymousUser(sessionToken?: string): Promise<{
    user: AuthUser;
    sessionToken: string;
  }>;
  getUserBySessionToken(token: string): Promise<AuthUser | null>;
  signUpOrLinkEmail(params: {
    currentSessionToken?: string;
    email: string;
    password: string;
    name: string;
  }): Promise<{ user: AuthUser; sessionToken: string }>;
  signInWithEmail(params: {
    currentSessionToken?: string;
    email: string;
    password: string;
  }): Promise<{ user: AuthUser; sessionToken: string }>;
  signOutSession(token: string): Promise<void>;
  updateUserSettings(userId: string, settings: ExplorerSettings): Promise<AuthUser>;
  setUserRoleForDev(userId: string, role: 'user' | 'admin'): Promise<AuthUser>;
  mergeAnonymousUserData(fromGuestUserId: string, toUserId: string): Promise<void>;
  getPublicUserAchievements(userId: string): Promise<PublicUserAchievements | null>;

  // 聖地スポット検索・取得・登録・編集
  getMetaSummary(): Promise<{
    totalSpots: number;
    totalEpisodes: number;
    prefectures: Array<{ prefecture: string; totalSpots: number }>;
  }>;
  getSpotById(spotId: string): Promise<Spot | null>;
  querySpots(params: {
    lat: number;
    lng: number;
    member?: string;
    mediaCategory?: MediaCategory;
    prefecture?: string;
    tagQuery?: string;
    limit?: number;
  }): Promise<Array<{ spot: Spot; distanceMeters: number }>>;
  findNearbyDuplicates(
    lat: number,
    lng: number,
    withinMeters?: number,
  ): Promise<Array<{ spot: Spot; distanceMeters: number }>>;
  createOrAppendSpot(input: CreateSpotInput, createdByUserId: string): Promise<Spot>;
  updateSpot(spotId: string, input: UpdateSpotInput): Promise<Spot | null>;
  deleteSpot(spotId: string): Promise<boolean>;
  bulkImportCandidates(
    candidates: RawCandidateEpisode[],
    createdByUserId: string,
  ): Promise<{
    totalSpots: number;
    addedSpots: number;
    mergedEpisodes: number;
  }>;

  // 訪問・ギブアップ記録 & 非公開アルバムメタデータ
  getUserVisits(userId: string): Promise<Record<string, VisitRecord>>;
  recordVisit(params: {
    userId: string;
    spotId: string;
    status: 'visited' | 'give_up';
    selfDiscovered: boolean;
  }): Promise<VisitRecord>;
  updateVisitAlbum(params: {
    userId: string;
    spotId: string;
    privateMemo?: string;
    privatePhotoR2Key?: string;
    privatePhotoMime?: string;
  }): Promise<VisitRecord | null>;
  getVisitPhotoMeta(
    userId: string,
    spotId: string,
  ): Promise<{ r2Key: string; mime: string } | null>;

  // コメント & 通報モデレーション
  getPublicCommentsForSpot(spotId: string, viewerUserId?: string): Promise<SpotComment[]>;
  addComment(params: {
    spotId: string;
    userId: string;
    authorName: string;
    content: string;
    isPublic: boolean;
  }): Promise<SpotComment>;
  createReport(params: {
    spotId: string;
    reporterUserId: string;
    reason: SpotReportReason;
    detail?: string;
  }): Promise<SpotReport>;
  listReports(status?: 'open' | 'resolved' | 'dismissed'): Promise<SpotReport[]>;
  updateReportStatus(
    reportId: string,
    status: 'resolved' | 'dismissed',
  ): Promise<SpotReport | null>;
}
