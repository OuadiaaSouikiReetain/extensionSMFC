import { useAppStore } from "../store/appStore";
import type { StorageMinerData } from "../store/types";

export function useStorageMiner(): StorageMinerData | null {
  return useAppStore(s => s.storageMinerData);
}
