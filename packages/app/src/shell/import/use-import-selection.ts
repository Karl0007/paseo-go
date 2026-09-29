// Import-selection lifecycle for the shell import screen (card KI-13). Row keys
// (provider:handle:cwd…) only carry meaning WITHIN one host, so a host switch
// must empty the selection: leftover keys are dead weight for the new list, and
// keeping them would leave the footer "import n" count misaligned with the list
// `useImportList` just cleared. Same reset semantics, same axis (serverId) as
// the list clear — the screen keeps only the rows↔selection join. React-free of
// the screen's chrome so the reset is unit-testable with renderHook.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toggleRowSelection } from "./rows";

export interface ImportSelection {
  selectedSet: ReadonlySet<string>;
  toggle: (key: string) => void;
  clear: () => void;
}

export function useImportSelection(serverId: string | null): ImportSelection {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // KI-13: 切主机即清空勾选。effect（非 render-phase）足够：同一 commit 里
  // useImportList 已把 rows 清空，selectedRows=rows∩set 恒为空、按钮已禁用，
  // 旧 keys 在这里只多活一个 effect 拍、不产生任何可见错位。
  useEffect(() => {
    setSelectedKeys([]);
  }, [serverId]);

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const toggle = useCallback((key: string) => {
    setSelectedKeys((prev) => toggleRowSelection(prev, key));
  }, []);
  const clear = useCallback(() => setSelectedKeys([]), []);

  return { selectedSet, toggle, clear };
}
