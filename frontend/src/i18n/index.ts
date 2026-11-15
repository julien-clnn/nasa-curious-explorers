// Minimal i18n: all UI copy lives in locales/<lang>.json; add a language by adding a file.
import en from "./locales/en.json";

type Dict = typeof en;
export type Key = keyof Dict;

const dicts: Record<string, Dict> = { en };
let current = "en";

export const locale = () => current;
export function setLocale(lang: string) {
  if (dicts[lang]) current = lang;
}

/** t("answer.rank", { n: 2 }) — replaces {n} placeholders. */
export function t(key: Key | (string & {}), vars?: Record<string, string | number>): string {
  const d = dicts[current] as Record<string, string>;
  let s: string = d[key] ?? (en as Record<string, string>)[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
