import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeCandidatesIntoSpots,
  parseKmlToCandidates,
  type RawCandidateEpisode,
} from '../packages/shared/src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kmlPath = path.resolve(__dirname, '../data/hinatazaka-mymap.kml');
const outPath = path.resolve(__dirname, '../packages/db/seed/hinatazaka-spots.json');

if (!fs.existsSync(kmlPath)) {
  console.error(`KML file not found at ${kmlPath}`);
  process.exit(1);
}

const kmlXml = fs.readFileSync(kmlPath, 'utf8');
const kmlCandidates = parseKmlToCandidates(kmlXml);

// 成果報告スライドのデモ（ソンナコトナイヨMV キャットストリート 等）も確実に含める
const featuredCandidates: RawCandidateEpisode[] = [
  {
    title: 'キャットストリート',
    lat: 35.665242,
    lng: 139.705812,
    mediaCategory: 'mv',
    description:
      '4thシングル『ソンナコトナイヨ』のMV（2:22〜）でメンバー全員が踊っている渋谷・原宿間の通り。',
    referenceUrl: 'https://youtu.be/7njC5lgL61c?t=142',
    youtubeVideoId: '7njC5lgL61c',
    videoStartSec: 142,
    members: ['小坂菜緒', '加藤史帆', '齊藤京子', '金村美玖', '東村芽依'],
    hashtags: ['MV', 'ソンナコトナイヨ'],
  },
  {
    title: '日向坂（港区三田）',
    lat: 35.651275,
    lng: 139.736647,
    mediaCategory: 'other',
    description: 'けやき坂46から「日向坂46」への改名ゆかりの聖地である港区三田の坂道。',
    members: [],
    hashtags: ['日向坂46', 'ゆかりの地'],
  },
];

const { spots, addedSpots, mergedEpisodes } = mergeCandidatesIntoSpots([
  ...featuredCandidates,
  ...kmlCandidates,
]);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(spots), 'utf8');

const totalEpisodes = spots.reduce((sum, s) => sum + s.episodes.length, 0);
console.log(
  `Seed built successfully! Raw placemarks: ${kmlCandidates.length} -> Unique spots: ${addedSpots}, Merged multi-scene episodes: ${mergedEpisodes}, Total episodes: ${totalEpisodes}`,
);
