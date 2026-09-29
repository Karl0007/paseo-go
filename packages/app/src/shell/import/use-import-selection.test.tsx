// @vitest-environment jsdom
// KI-13: 勾选集随主机复位——行 key 只在一台主机内有意义，切主机后旧 key 对新列表
// 全是死键，必须即刻清空（列表侧的清空在 use-import-list，两侧同轴 serverId）。
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useImportSelection } from "./use-import-selection";

describe("useImportSelection host-switch reset (KI-13)", () => {
  it("switching hosts empties the selection", () => {
    const { result, rerender } = renderHook(({ serverId }) => useImportSelection(serverId), {
      initialProps: { serverId: "A" as string | null },
    });
    act(() => result.current.toggle("a:1"));
    act(() => result.current.toggle("a:2"));
    expect(result.current.selectedSet.has("a:1")).toBe(true);
    expect(result.current.selectedSet.has("a:2")).toBe(true);

    rerender({ serverId: "B" });
    expect(result.current.selectedSet.size).toBe(0);
  });

  it("selection survives same-host re-renders; clear() empties it", () => {
    const { result, rerender } = renderHook(({ serverId }) => useImportSelection(serverId), {
      initialProps: { serverId: "A" as string | null },
    });
    act(() => result.current.toggle("a:1"));
    // 同主机重渲染（query 编辑/刷新等）不得吃掉勾选——复位只挂 serverId 轴。
    rerender({ serverId: "A" });
    expect(result.current.selectedSet.has("a:1")).toBe(true);
    // 导入成功后的显式清空（runImport 尾）。
    act(() => result.current.clear());
    expect(result.current.selectedSet.size).toBe(0);
  });
});
