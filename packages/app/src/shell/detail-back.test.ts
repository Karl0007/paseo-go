// KI-9 acceptance: the (detail) screens' back contract, pinned against the global
// expo-router double (vitest.setup). Pop when the stack can go back — that is the
// hardware-back-parity path every push lands on; the replace onto the screen's own
// tab fires ONLY for a deep-linked entry with nothing underneath (and a replace,
// never a push, so the兑底 frame never stacks a dead end).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "expo-router";
import { SHELL } from "./routes";
import { detailBack } from "./detail-back";

const mockedRouter = vi.mocked(router);

beforeEach(() => {
  mockedRouter.back.mockClear();
  mockedRouter.replace.mockClear();
  mockedRouter.canGoBack.mockReset();
});

describe("detailBack", () => {
  it("pops when the stack can go back (no fallback navigation)", () => {
    mockedRouter.canGoBack.mockReturnValue(true);
    detailBack(SHELL.chats as never);
    expect(mockedRouter.back).toHaveBeenCalledTimes(1);
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it("replaces onto the fallback when nothing is underneath (deep link)", () => {
    mockedRouter.canGoBack.mockReturnValue(false);
    detailBack(SHELL.workspace as never);
    expect(mockedRouter.back).not.toHaveBeenCalled();
    expect(mockedRouter.replace).toHaveBeenCalledWith(SHELL.workspace);
  });
});
