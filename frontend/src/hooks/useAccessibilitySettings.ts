import { useCallback, useEffect, useRef, useState } from 'react';
import { storage } from '../utils/storage';

const STORAGE_KEY = 'lotus.accessibility.v1';

export type Palette = 'dark' | 'light' | 'hi-vis-dark' | 'hi-vis-light';
export type Handedness = 'right' | 'left';
export type ReduceMotion = 'auto' | 'on' | 'off';
export type TextScale = 'sm' | 'md' | 'lg';

export interface AccessibilitySettings {
  palette: Palette;
  handedness: Handedness;
  reduceMotion: ReduceMotion;
  textScale: TextScale;
  colorBlindCharts: boolean;
}

function systemPalette(): Palette {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function defaults(): AccessibilitySettings {
  return {
    palette: systemPalette(),
    handedness: 'right',
    reduceMotion: 'auto',
    textScale: 'md',
    colorBlindCharts: false,
  };
}

function load(): AccessibilitySettings {
  const raw = storage.get(STORAGE_KEY);
  if (!raw) return defaults();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults();
    return { ...defaults(), ...(parsed as Partial<AccessibilitySettings>) };
  } catch {
    return defaults();
  }
}

function save(settings: AccessibilitySettings): void {
  storage.set(STORAGE_KEY, JSON.stringify(settings));
}

function applyToHtml(settings: AccessibilitySettings): void {
  const html = document.documentElement;
  html.dataset.palette = settings.palette;
  html.dataset.handedness = settings.handedness;
  html.dataset.textScale = settings.textScale;

  const reduce =
    settings.reduceMotion === 'on' ||
    (settings.reduceMotion === 'auto' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (reduce) {
    html.dataset.reduceMotion = 'on';
  } else {
    delete html.dataset.reduceMotion;
  }
}

/**
 * Per-device accessibility settings. Reads localStorage on mount, mirrors
 * settings to <html> data attributes, and persists on change. The pre-React
 * inline script in index.html applies these same attributes before first
 * paint to avoid FOUC.
 */
export function useAccessibilitySettings() {
  const [settings, setSettings] = useState<AccessibilitySettings>(load);

  const isMounted = useRef(false);

  useEffect(() => {
    applyToHtml(settings);
    if (isMounted.current) {
      save(settings);
    } else {
      isMounted.current = true;
    }
  }, [settings]);

  useEffect(() => {
    return storage.subscribe((e) => {
      if (e.key === STORAGE_KEY) setSettings(load());
    });
  }, []);

  const update = useCallback(<K extends keyof AccessibilitySettings>(
    key: K,
    value: AccessibilitySettings[K],
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setPalette = useCallback((v: Palette) => update('palette', v), [update]);
  const setHandedness = useCallback((v: Handedness) => update('handedness', v), [update]);
  const setReduceMotion = useCallback((v: ReduceMotion) => update('reduceMotion', v), [update]);
  const setTextScale = useCallback((v: TextScale) => update('textScale', v), [update]);
  const setColorBlindCharts = useCallback((v: boolean) => update('colorBlindCharts', v), [update]);

  return { settings, setPalette, setHandedness, setReduceMotion, setTextScale, setColorBlindCharts };
}
