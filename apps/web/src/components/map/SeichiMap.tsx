'use client';

import {
  type MapMode,
  type MaskedSpotSummary,
  RADAR_CIRCLE_RADIUS_METERS,
} from '@seichi/shared';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';

const OPEN_FREE_MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';

function createCirclePolygon(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  points = 28,
): [number, number][] {
  const coords: [number, number][] = [];
  const latRad = (centerLat * Math.PI) / 180;
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const dLat = (radiusMeters * Math.cos(angle)) / 111320;
    const dLng =
      (radiusMeters * Math.sin(angle)) /
      (111320 * Math.max(0.2, Math.cos(latRad)));
    coords.push([centerLng + dLng, centerLat + dLat]);
  }
  return coords;
}

export interface SeichiMapProps {
  centerLat: number;
  centerLng: number;
  zoom?: number;
  spots?: MaskedSpotSummary[];
  mapMode?: MapMode;
  onSelectSpot?: (spot: MaskedSpotSummary) => void;
  /** 聖地登録画面用のピンドラッグ微調整モード */
  pickerMode?: boolean;
  pickerLat?: number;
  pickerLng?: number;
  onPickerChange?: (lat: number, lng: number) => void;
  heightClassName?: string;
}

/**
 * 地図表示抽象化アダプタコンポーネント (<SeichiMap />)
 * 初期は課金リスクゼロの MapLibre GL + OpenFreeMap を使用。
 * 将来 Google Maps JS SDK (@vis.gl/react-google-maps) へ切り替える際もこの1ファイルの差し替えのみで完結する。
 */
export function SeichiMap({
  centerLat,
  centerLng,
  zoom = 13.5,
  spots = [],
  mapMode = 'treasure',
  onSelectSpot,
  pickerMode = false,
  pickerLat,
  pickerLng,
  onPickerChange,
  heightClassName = 'h-[460px]',
}: SeichiMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const pickerMarkerRef = useRef<maplibregl.Marker | null>(null);
  const spotsByIdRef = useRef<Map<string, MaskedSpotSummary>>(new Map());
  const onSelectSpotRef = useRef(onSelectSpot);

  useEffect(() => {
    spotsByIdRef.current = new Map(spots.map((s) => [s.id, s]));
    onSelectSpotRef.current = onSelectSpot;
  }, [spots, onSelectSpot]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialLat = pickerMode && pickerLat !== undefined ? pickerLat : centerLat;
    const initialLng = pickerMode && pickerLng !== undefined ? pickerLng : centerLng;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OPEN_FREE_MAP_STYLE,
      center: [initialLng, initialLat],
      zoom,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    if (pickerMode) {
      map.on('click', (e) => {
        onPickerChange?.(
          Number(e.lngLat.lat.toFixed(6)),
          Number(e.lngLat.lng.toFixed(6)),
        );
      });
    }

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Picker モードのドラッグ可能ピン管理
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pickerMode || pickerLat === undefined || pickerLng === undefined) return;

    if (!pickerMarkerRef.current) {
      const marker = new maplibregl.Marker({
        color: '#0284c7',
        draggable: true,
      })
        .setLngLat([pickerLng, pickerLat])
        .addTo(map);

      marker.on('dragend', () => {
        const pos = marker.getLngLat();
        onPickerChange?.(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
      });
      pickerMarkerRef.current = marker;
    } else {
      pickerMarkerRef.current.setLngLat([pickerLng, pickerLat]);
    }

    map.easeTo({ center: [pickerLng, pickerLat], duration: 400 });
  }, [pickerMode, pickerLat, pickerLng, onPickerChange]);

  // 現在地マーカー更新（通常マップ時）
  useEffect(() => {
    const map = mapRef.current;
    if (!map || pickerMode) return;

    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.className =
        'w-4 h-4 rounded-full bg-sky-500 border-2 border-white shadow-md ring-4 ring-sky-400/40';
      userMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([centerLng, centerLat])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([centerLng, centerLat]);
    }
  }, [centerLat, centerLng, pickerMode]);

  // 聖地ピン ＆ ぼかしレーダー円の描画
  useEffect(() => {
    const map = mapRef.current;
    if (!map || pickerMode) return;

    // 既存マーカークリア
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    const renderRadarLayer = () => {
      const radarSpots =
        mapMode === 'treasure'
          ? spots.filter((s) => !s.isUnlocked).slice(0, 120)
          : [];

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: radarSpots.map((s) => ({
          type: 'Feature',
          properties: { id: s.id, title: s.displayTitle },
          geometry: {
            type: 'Polygon',
            coordinates: [
              createCirclePolygon(
                s.radarLat,
                s.radarLng,
                RADAR_CIRCLE_RADIUS_METERS,
              ),
            ],
          },
        })),
      };

      const existingSource = map.getSource('radar-circles') as
        | maplibregl.GeoJSONSource
        | undefined;

      if (existingSource) {
        existingSource.setData(geojson);
      } else {
        map.addSource('radar-circles', {
          type: 'geojson',
          data: geojson,
        });
        map.addLayer({
          id: 'radar-circles-fill',
          type: 'fill',
          source: 'radar-circles',
          paint: {
            'fill-color': '#38bdf8',
            'fill-opacity': 0.16,
          },
        });
        map.addLayer({
          id: 'radar-circles-stroke',
          type: 'line',
          source: 'radar-circles',
          paint: {
            'line-color': '#0284c7',
            'line-width': 1.5,
            'line-dasharray': [3, 2],
            'line-opacity': 0.55,
          },
        });

        map.on('click', 'radar-circles-fill', (e) => {
          const spotId = e.features?.[0]?.properties?.id as string | undefined;
          if (!spotId) return;
          const clickedSpot = spotsByIdRef.current.get(spotId);
          if (clickedSpot) {
            onSelectSpotRef.current?.(clickedSpot);
          }
        });
        map.on('mouseenter', 'radar-circles-fill', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'radar-circles-fill', () => {
          map.getCanvas().style.cursor = '';
        });
      }
    };

    if (map.isStyleLoaded()) {
      renderRadarLayer();
    } else {
      map.once('load', renderRadarLayer);
    }

    // 正確なピン（達成済み / ギブアップ済み / または通常聖地マップモード）
    const pinSpots = spots
      .filter(
        (s) =>
          s.exactLat !== undefined &&
          s.exactLng !== undefined &&
          (s.isUnlocked || mapMode === 'standard'),
      )
      .slice(0, 250);

    for (const spot of pinSpots) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isVisited = spot.visitStatus === 'visited';
      const isGiveUp = spot.visitStatus === 'give_up';

      btn.className = isVisited
        ? 'px-2 py-1 rounded-full text-xs font-bold text-white bg-sky-600 border-2 border-white shadow-lg hover:scale-110 transition-transform flex items-center gap-1 cursor-pointer'
        : isGiveUp
          ? 'px-2 py-0.5 rounded-full text-xs font-semibold text-white bg-slate-500 border-2 border-white shadow cursor-pointer'
          : 'w-6 h-6 rounded-full bg-amber-500 border-2 border-white shadow-md hover:scale-110 transition-transform cursor-pointer flex items-center justify-center text-[10px] text-white font-bold';

      btn.textContent = isVisited
        ? spot.selfDiscovered
          ? '🧭達成'
          : '✓達成'
        : isGiveUp
          ? '閲覧済'
          : '?';
      btn.title = spot.displayTitle;
      btn.onclick = (e) => {
        e.stopPropagation();
        onSelectSpot?.(spot);
      };

      const marker = new maplibregl.Marker({ element: btn })
        .setLngLat([spot.exactLng!, spot.exactLat!])
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [spots, mapMode, pickerMode, onSelectSpot]);

  const flyToCurrentCenter = () => {
    mapRef.current?.flyTo({
      center: [centerLng, centerLat],
      zoom: 14.5,
      duration: 600,
    });
  };

  return (
    <div className={`relative w-full rounded-2xl overflow-hidden border border-sky-100 shadow-sm ${heightClassName}`}>
      <div ref={containerRef} className="w-full h-full" />
      {!pickerMode && (
        <button
          type="button"
          onClick={flyToCurrentCenter}
          className="absolute bottom-3 left-3 bg-white/95 backdrop-blur px-3 py-1.5 rounded-xl text-xs font-bold text-sky-700 shadow border border-sky-200 hover:bg-sky-50 cursor-pointer"
        >
          📍 現在地へ移動
        </button>
      )}
    </div>
  );
}
