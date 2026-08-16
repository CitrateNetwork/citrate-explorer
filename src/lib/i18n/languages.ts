// Language catalogue for Citrate's browser-first multilingual layer.
//
// Strategy: content is authored in English (`<html lang="en">`). We do NOT ship
// per-language message catalogues. Instead we (a) keep the source `lang` correct
// so Chrome / Edge / Safari automatically offer their built-in page translation,
// and (b) let a user pick any language from the header, at which point — where the
// browser exposes the on-device Translator API — we translate the live DOM with no
// network call (CSP-clean), and otherwise fall back to the browser's own translator.
//
// `code` is a BCP-47 tag the Translator API + browsers understand (e.g. "zh-Hans").

export type Language = {
  code: string;
  /** English name, for the picker's search + a11y label. */
  name: string;
  /** Endonym — how speakers write the language's own name. */
  native: string;
  /** Right-to-left script. Drives `dir="rtl"`. */
  rtl?: boolean;
  /** Surfaced in the header quick-pick (per the chosen featured set). */
  featured?: boolean;
};

// Featured quick-pick = union of the sets chosen for Citrate:
// Global top · Western Europe · East Asia · RTL (Arabic/Hebrew) · Indonesian.
// The full list below extends coverage toward "any country".
export const LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English", featured: true },
  { code: "es", name: "Spanish", native: "Español", featured: true },
  { code: "fr", name: "French", native: "Français", featured: true },
  { code: "de", name: "German", native: "Deutsch", featured: true },
  { code: "it", name: "Italian", native: "Italiano", featured: true },
  { code: "pt", name: "Portuguese", native: "Português", featured: true },
  { code: "nl", name: "Dutch", native: "Nederlands", featured: true },
  { code: "zh-Hans", name: "Chinese (Simplified)", native: "简体中文", featured: true },
  { code: "zh-Hant", name: "Chinese (Traditional)", native: "繁體中文", featured: true },
  { code: "ja", name: "Japanese", native: "日本語", featured: true },
  { code: "ko", name: "Korean", native: "한국어", featured: true },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", featured: true },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true, featured: true },
  { code: "he", name: "Hebrew", native: "עברית", rtl: true, featured: true },
  { code: "hi", name: "Hindi", native: "हिन्दी", featured: true },
  { code: "ru", name: "Russian", native: "Русский", featured: true },

  // Extended coverage — searchable in the full list.
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "uk", name: "Ukrainian", native: "Українська" },
  { code: "cs", name: "Czech", native: "Čeština" },
  { code: "sk", name: "Slovak", native: "Slovenčina" },
  { code: "hu", name: "Hungarian", native: "Magyar" },
  { code: "ro", name: "Romanian", native: "Română" },
  { code: "el", name: "Greek", native: "Ελληνικά" },
  { code: "bg", name: "Bulgarian", native: "Български" },
  { code: "sr", name: "Serbian", native: "Српски" },
  { code: "hr", name: "Croatian", native: "Hrvatski" },
  { code: "sl", name: "Slovenian", native: "Slovenščina" },
  { code: "sv", name: "Swedish", native: "Svenska" },
  { code: "nb", name: "Norwegian", native: "Norsk" },
  { code: "da", name: "Danish", native: "Dansk" },
  { code: "fi", name: "Finnish", native: "Suomi" },
  { code: "et", name: "Estonian", native: "Eesti" },
  { code: "lv", name: "Latvian", native: "Latviešu" },
  { code: "lt", name: "Lithuanian", native: "Lietuvių" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "fa", name: "Persian", native: "فارسی", rtl: true },
  { code: "ur", name: "Urdu", native: "اردو", rtl: true },
  { code: "ms", name: "Malay", native: "Bahasa Melayu" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt" },
  { code: "th", name: "Thai", native: "ไทย" },
  { code: "fil", name: "Filipino", native: "Filipino" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
  { code: "mr", name: "Marathi", native: "मराठी" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml", name: "Malayalam", native: "മലയാളം" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "sw", name: "Swahili", native: "Kiswahili" },
  { code: "am", name: "Amharic", native: "አማርኛ" },
  { code: "af", name: "Afrikaans", native: "Afrikaans" },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code.toLowerCase(), l]));
const RTL_CODES = new Set(LANGUAGES.filter((l) => l.rtl).map((l) => l.code));

export const FEATURED_LANGUAGES = LANGUAGES.filter((l) => l.featured);

export function findLanguage(code: string | null | undefined): Language | undefined {
  if (!code) return undefined;
  const c = code.toLowerCase();
  if (BY_CODE.has(c)) return BY_CODE.get(c);
  // Fall back on the primary subtag, so "es-419" resolves to "es", "pt-BR" to "pt".
  const base = c.split("-")[0] ?? c;
  return LANGUAGES.find((l) => l.code.toLowerCase() === base || l.code.toLowerCase().startsWith(base + "-"));
}

export function isRTL(code: string | null | undefined): boolean {
  const l = findLanguage(code);
  return !!(l && (l.rtl || RTL_CODES.has(l.code)));
}

export function labelFor(code: string): string {
  const l = findLanguage(code);
  return l ? l.native : code;
}
