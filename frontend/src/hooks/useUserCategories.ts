import { useState, useEffect, useRef, useCallback } from 'react';
import { UserCategories, CategoryMapping, Category, BUILT_IN_CATEGORIES } from '../types';
import { getUserCategories, saveUserCategories } from '../api/client';
import { derivePattern } from '../utils/categories';

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
  const loaded = useRef(false);

  useEffect(() => {
    getUserCategories()
      .then((data) => {
        setUserCategories(data);
        loaded.current = true;
      })
      .catch(() => {
        loaded.current = true;
      });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    saveUserCategories(userCategories).catch((err) => {
      console.error('Failed to save user categories', err);
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
  };
}
