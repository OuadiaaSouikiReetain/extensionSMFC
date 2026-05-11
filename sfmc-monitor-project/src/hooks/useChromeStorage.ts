import { useState, useEffect } from "react";

export function useChromeStorage<T>(key: string, defaultValue: T): [T, (v: T) => Promise<void>] {
  const [value, setValue] = useState<T>(defaultValue);

  useEffect(() => {
    chrome.storage.local.get([key], data => {
      if (data[key] !== undefined) setValue(data[key] as T);
    });

    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[key]) setValue(changes[key].newValue as T);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [key]);

  const set = async (v: T) => {
    await chrome.storage.local.set({ [key]: v });
    setValue(v);
  };

  return [value, set];
}
