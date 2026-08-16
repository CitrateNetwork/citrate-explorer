import { describe, it, expect } from "vitest";
import {
  LANGUAGES,
  FEATURED_LANGUAGES,
  findLanguage,
  isRTL,
  labelFor,
} from "./languages";
import { engineSupported, getSavedLanguage, currentLanguage } from "./engine";

describe("i18n language catalogue", () => {
  it("has unique BCP-47 codes", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("features the languages chosen for Citrate (incl. Indonesian + RTL)", () => {
    const featured = FEATURED_LANGUAGES.map((l) => l.code);
    for (const code of ["en", "es", "fr", "de", "it", "pt", "nl", "zh-Hans", "zh-Hant", "ja", "ko", "id", "ar", "he", "hi", "ru"]) {
      expect(featured).toContain(code);
    }
  });

  it("resolves exact, case-insensitive, and region-suffixed codes", () => {
    expect(findLanguage("es")?.code).toBe("es");
    expect(findLanguage("ES")?.code).toBe("es");
    expect(findLanguage("pt-BR")?.code).toBe("pt");
    expect(findLanguage("es-419")?.code).toBe("es");
    expect(findLanguage("zh-Hans")?.code).toBe("zh-Hans");
    expect(findLanguage(null)).toBeUndefined();
    expect(findLanguage("xx-unknown")).toBeUndefined();
  });

  it("flags right-to-left scripts", () => {
    expect(isRTL("ar")).toBe(true);
    expect(isRTL("he")).toBe(true);
    expect(isRTL("fa")).toBe(true);
    expect(isRTL("ur")).toBe(true);
    expect(isRTL("en")).toBe(false);
    expect(isRTL("id")).toBe(false);
  });

  it("labels with the endonym", () => {
    expect(labelFor("ja")).toBe("日本語");
    expect(labelFor("id")).toBe("Bahasa Indonesia");
    expect(labelFor("unknown")).toBe("unknown");
  });
});

describe("i18n engine (server / no-DOM safety)", () => {
  it("degrades gracefully with no browser present", () => {
    // In the node test environment there is no on-device Translator API and no
    // document — the engine must not throw and must default to English.
    expect(engineSupported()).toBe(false);
    expect(getSavedLanguage()).toBe("en");
    expect(currentLanguage()).toBe("en");
  });
});
