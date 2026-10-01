// B4-LANG: language-switch → shell copy re-resolution contract.
// The official I18nProvider changes language DURING RENDER, so the synchronous
// `languageChanged` lands in React's render phase and subscriber re-renders can be
// deferred/dropped — surfaces keep the old copy until an unrelated render. The shell
// relay (`attachLanguageRebroadcast`) re-emits the event from a macrotask so every
// subscriber gets a clean event-time update. Node env, no mounting (chats-header.test.ts
// import style); real i18next instances; fake timers drive the macrotask deterministically.
import { createInstance } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { attachLanguageRebroadcast, SHELL_I18N_NAMESPACE } from "./i18n";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("attachLanguageRebroadcast", () => {
  it("re-emits languageChanged exactly once per real switch and terminates", async () => {
    const instance = createInstance();
    await instance.init({
      fallbackLng: "en",
      lng: "zh-CN",
      resources: {
        en: { [SHELL_I18N_NAMESPACE]: { hi: "Hello" } },
        "zh-CN": { [SHELL_I18N_NAMESPACE]: { hi: "你好" } },
      },
    });
    attachLanguageRebroadcast(instance);
    const events: string[] = [];
    instance.on("languageChanged", (lng: string) => events.push(lng));

    await instance.changeLanguage("en");
    // The real switch emits synchronously; the relay's copy is deferred to a macrotask.
    expect(events).toEqual(["en"]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(["en", "en"]);
    // The relay consumes its own echo — no runaway chain.
    vi.advanceTimersByTime(1000);
    expect(events).toEqual(["en", "en"]);

    await instance.changeLanguage("zh-CN");
    vi.advanceTimersByTime(1);
    expect(events).toEqual(["en", "en", "zh-CN", "zh-CN"]);
    expect(instance.t(`${SHELL_I18N_NAMESPACE}:hi`)).toBe("你好");
  });

  it("detach stops the relay", async () => {
    const instance = createInstance();
    await instance.init({ fallbackLng: "en", lng: "en", resources: {} });
    const detach = attachLanguageRebroadcast(instance);
    detach();
    const events: string[] = [];
    instance.on("languageChanged", (lng: string) => events.push(lng));
    await instance.changeLanguage("zh-CN");
    vi.advanceTimersByTime(1000);
    expect(events).toEqual(["zh-CN"]);
  });
});

describe("shell namespace re-resolves after a language switch (official instance)", () => {
  it("tabs.chats flips Chats ↔ 对话 across switches, via the deferred relay", async () => {
    // ensureShellI18n() ran at import: paseoGo bundles are registered on the official
    // instance and the relay is attached to it.
    const key = `${SHELL_I18N_NAMESPACE}:tabs.chats`;
    await i18n.changeLanguage("en");
    vi.advanceTimersByTime(1);
    expect(i18n.t(key)).toBe("Chats");

    await i18n.changeLanguage("zh-CN");
    vi.advanceTimersByTime(1);
    expect(i18n.t(key)).toBe("对话");
  });
});
