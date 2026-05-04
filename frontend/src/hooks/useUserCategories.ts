import { useState, useEffect, useRef, useCallback } from 'react';
import { UserCategories, CategoryMapping, Category, BUILT_IN_CATEGORIES } from '../types';
import { getUserCategories, saveUserCategories } from '../api/categories';
import { ConflictError, getActiveInstanceId, subscribeActiveInstance } from '../api/core';
import { derivePattern } from '../utils/categorization/rules';

/**
 * Hook that loads the user's custom categories + mappings from the server
 * on mount, keeps them in local React state, and auto-persists any change
 * back to the server. Used by DataEntry, Dashboard (edit flow), and Settings.
 *
 * Returns the current state plus a bundle of mutator helpers so callers
 * don't have to reimplement the add-custom-category / save-mapping logic.
 */
export function useUserCategories() {
  const [userCategories, setUserCategories] = useState<UserCategories>({
    customCategories: [],
    mappings: [],
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const loaded = useRef(false);
  // Suppresses the first save effect after a successful load — that change
  // came from the server, not the user, and re-saving it would either be a
  // no-op or a 409 if the server's version moved (e.g., another tab wrote).
  const skipNextSave = useRef(false);

  // Load gated on active instance: the GET requires X-Instance-Id, so we
  // can't fire it until useWorkspaces (or a prior session) has set one.
  // Subscribes so a freshly logged-in user gets their categories as soon
  // as the active instance becomes available.
  useEffect(() => {
    let cancelled = false;
    const tryLoad = () => {
      if (loaded.current) return;
      if (!getActiveInstanceId()) return;
      getUserCategories()
        .then((data) => {
          if (cancelled) return;
          skipNextSave.current = true;
          setUserCategories(data);
          loaded.current = true;
        })
        .catch(() => {
          if (cancelled) return;
          loaded.current = true;
        });
    };
    tryLoad();
    const unsub = subscribeActiveInstance(() => tryLoad());
    return () => { cancelled = true; unsub(); };
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    saveUserCategories(userCategories).catch(async (err) => {
      if (err instanceof ConflictError) {
        // Refresh our local copy from the server so the version map is updated,
        // then retry the save with the fresh version.
        console.warn('User categories conflict detected; refreshing and retrying.');
        try {
          const fresh = await getUserCategories();
          // Merge: prefer the in-memory changes over the server state for
          // customCategories and mappings — caller's intent wins.
          await saveUserCategories({ ...fresh, customCategories: userCategories.customCategories, mappings: userCategories.mappings });
          setSaveError(null);
        } catch (retryErr) {
          console.error('Failed to save user categories after conflict retry', retryErr);
          setSaveError('Your category changes could not be saved. Please refresh and try again.');
        }
      } else {
        console.error('Failed to save user categories', err);
        setSaveError('Your category changes could not be saved. Please refresh and try again.');
      }
    });
  }, [userCategories]);

  /**
   * Add a custom category (idempotent). Returns the canonical name that
   * ended up being used, or null if the name was invalid. If the name
   * matches an existing built-in, we return that built-in name so callers
   * can just select it without polluting customCategories.
   */
  const addCustomCategory = useCallback(
    (rawName: string): string | null => {
      const name = rawName.trim();
      if (!name) return null;

      const existingBuiltIn = BUILT_IN_CATEGORIES.find(
        (c) => c.toLowerCase() === name.toLowerCase(),
      );
      if (existingBuiltIn) return existingBuiltIn;

      const existingCustom = userCategories.customCategories.find(
        (c) => c.toLowerCase() === name.toLowerCase(),
      );
      if (existingCustom) return existingCustom;

      setUserCategories((prev) => ({
        ...prev,
        customCategories: [...prev.customCategories, name],
      }));
      return name;
    },
    [userCategories.customCategories],
  );

  /**
   * Save a description-pattern → category mapping. The pattern is derived
   * from the description via derivePattern. If a mapping already exists for
   * the same pattern it's replaced.
   */
  const saveMapping = useCallback((description: string, category: Category) => {
    const pattern = derivePattern(description);
    if (pattern.length < 3) return;
    setUserCategories((prev) => ({
      ...prev,
      mappings: [
        ...prev.mappings.filter((m) => m.pattern.toLowerCase() !== pattern.toLowerCase()),
        { pattern, category } as CategoryMapping,
      ],
    }));
  }, []);

  return {
    userCategories,
    setUserCategories,
    addCustomCategory,
    saveMapping,
    saveError,
  };
}
