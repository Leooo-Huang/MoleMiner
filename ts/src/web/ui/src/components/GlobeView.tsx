import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import * as topojson from 'topojson-client';
import type { Topology } from 'topojson-specification';
import landTopology from 'world-atlas/countries-110m.json';
import type { SearchResultItem, GeoLocation } from '../types.js';
import { useI18n } from '../hooks/useI18n.js';

interface GlobeViewProps {
  results: SearchResultItem[];
  onMarkerClick: (location: GeoLocation, results: SearchResultItem[]) => void;
}

interface MarkerGroup {
  lat: number;
  lng: number;
  location: GeoLocation;
  results: SearchResultItem[];
  size: number;
}

interface RingData {
  lat: number;
  lng: number;
}

// Pre-convert topojson → geojson at module load time
const countriesGeo = topojson.feature(
  landTopology as unknown as Topology,
  (landTopology as unknown as Topology).objects.countries,
);
const countryFeatures = 'features' in countriesGeo ? countriesGeo.features : [];

/** Map result count to a color between cyan (#4fc3f7) and purple (#ab47bc) */
function markerColor(count: number): string {
  // Clamp t to [0, 1] based on count 1..10+
  const t = Math.min(1, Math.max(0, (count - 1) / 9));
  const r = Math.round(79 + (171 - 79) * t);
  const g = Math.round(195 + (71 - 195) * t);
  const b = Math.round(247 + (188 - 247) * t);
  return `rgb(${r},${g},${b})`;
}

export function GlobeView({ results, onMarkerClick }: GlobeViewProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<unknown>(null);
  const [GlobeModule, setGlobeModule] = useState<{ default: React.ComponentType<Record<string, unknown>> } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 500 });
  const [ringsData, setRingsData] = useState<RingData[]>([]);
  const [pulsePhase, setPulsePhase] = useState(0);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animFrameRef = useRef<number>(0);

  // Lazy-load react-globe.gl
  useEffect(() => {
    import('react-globe.gl').then((mod) => {
      setGlobeModule(mod as unknown as { default: React.ComponentType<Record<string, unknown>> });
    });
  }, []);

  // Enable auto-rotation after globe mounts
  useEffect(() => {
    const globe = globeRef.current as { controls?: () => { autoRotate: boolean; autoRotateSpeed: number } } | null;
    if (globe?.controls) {
      const controls = globe.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.3;
    }
  }, [GlobeModule]);

  // Track container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setDimensions({ width, height });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Pulse animation: toggle phase every 2 seconds
  useEffect(() => {
    let mounted = true;
    let lastToggle = performance.now();

    function tick(now: number) {
      if (!mounted) return;
      if (now - lastToggle >= 2000) {
        lastToggle = now;
        setPulsePhase((prev) => (prev + 1) % 2);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Cleanup ring timer on unmount
  useEffect(() => {
    return () => {
      if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    };
  }, []);

  // Group results by location (round lat/lng to 1 decimal)
  const markers = useMemo(() => {
    const groups = new Map<string, MarkerGroup>();

    for (const r of results) {
      if (!r.location) continue;
      const key = `${r.location.lat.toFixed(1)},${r.location.lng.toFixed(1)}`;
      const existing = groups.get(key);
      if (existing) {
        existing.results.push(r);
        existing.size = Math.min(1.5, 0.4 + existing.results.length * 0.15);
      } else {
        groups.set(key, {
          lat: r.location.lat,
          lng: r.location.lng,
          location: r.location,
          results: [r],
          size: 0.4,
        });
      }
    }

    return Array.from(groups.values());
  }, [results]);

  // Labels: only show for markers with 3+ results
  const labelsData = useMemo(() => {
    return markers
      .filter((m) => m.results.length >= 3)
      .map((m) => ({
        lat: m.lat,
        lng: m.lng,
        text: t('globe.markerLabel', { name: m.location.name, count: m.results.length }),
        color: 'rgba(255, 255, 255, 0.75)',
      }));
  }, [markers, t]);

  const handleClick = useCallback((marker: object) => {
    const m = marker as MarkerGroup;
    onMarkerClick(m.location, m.results);

    // Zoom to clicked marker
    const globe = globeRef.current as { pointOfView?: (pov: { lat: number; lng: number; altitude: number }, ms: number) => void } | null;
    if (globe?.pointOfView) {
      globe.pointOfView({ lat: m.lat, lng: m.lng, altitude: 1.5 }, 1000);
    }

    // Show ring at clicked location
    setRingsData([{ lat: m.lat, lng: m.lng }]);

    // Clear previous timer
    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);

    // Remove ring after 3 seconds
    ringTimerRef.current = setTimeout(() => {
      setRingsData([]);
      ringTimerRef.current = null;
    }, 3000);
  }, [onMarkerClick]);

  // Pulse altitude based on phase
  const pointAltitude = useCallback(
    () => (pulsePhase === 0 ? 0.01 : 0.03),
    [pulsePhase],
  );

  if (!GlobeModule) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center text-text-secondary">
        {t('globe.loading')}
      </div>
    );
  }

  const Globe = GlobeModule.default;

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{ background: 'radial-gradient(ellipse at center, #0a0a1a 0%, #000000 70%)' }}
    >
      <Globe
        ref={globeRef as never}
        // Globe style: dark digital
        globeImageUrl=""
        backgroundColor="rgba(0,0,0,0)"
        showGlobe={true}
        showAtmosphere={true}
        atmosphereColor="rgba(79, 195, 247, 0.15)"
        atmosphereAltitude={0.15}
        // Country polygons for digital borders
        polygonsData={countryFeatures}
        polygonCapColor={() => '#1b2838'}
        polygonSideColor={() => '#0d1b2a'}
        polygonStrokeColor={() => '#2a5a6a'}
        polygonAltitude={0.005}
        // Marker points
        pointsData={markers}
        pointLat={(d: object) => (d as MarkerGroup).lat}
        pointLng={(d: object) => (d as MarkerGroup).lng}
        pointAltitude={pointAltitude}
        pointRadius={(d: object) => (d as MarkerGroup).size}
        pointColor={(d: object) => markerColor((d as MarkerGroup).results.length)}
        onPointClick={handleClick}
        // Labels layer — permanent text labels next to markers
        labelsData={labelsData}
        labelLat={(d: object) => (d as { lat: number }).lat}
        labelLng={(d: object) => (d as { lng: number }).lng}
        labelText={(d: object) => (d as { text: string }).text}
        labelSize={() => 0.6}
        labelColor={(d: object) => (d as { color: string }).color}
        labelResolution={2}
        labelDotRadius={0}
        // Rings layer — ripple on click
        ringsData={ringsData}
        ringLat={(d: object) => (d as RingData).lat}
        ringLng={(d: object) => (d as RingData).lng}
        ringColor={() => (t: number) => `rgba(79, 195, 247, ${1 - t})`}
        ringMaxRadius={3}
        ringPropagationSpeed={2}
        ringRepeatPeriod={1500}
        // Animation
        animateIn={true}
        width={dimensions.width}
        height={dimensions.height}
      />
    </div>
  );
}
