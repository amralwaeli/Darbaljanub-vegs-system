// ============================================================================
// Input normalisation for Arabic keyboards.
//
// The app runs RTL with Arabic as the default language and staff type on
// Arabic layouts, where several characters LOOK to the user exactly like the
// ones the machine expects and are not them:
//
//   ٠١٢٣٤٥٦٧٨٩   Arabic-Indic digits      (U+0660..U+0669)  are not [0-9]
//   ۰۱۲۳۴۵۶۷۸۹   Extended Arabic-Indic    (U+06F0..U+06F9)  are not [0-9]
//   ۔            Arabic full stop         (U+06D4)          is not "."
//
// On top of that, an RTL text field collects invisible direction marks
// (U+200E/U+200F, the embedding controls, U+061C). They survive .trim(),
// because they are not whitespace — they just ride along inside the value.
//
// Two concrete failures came from this:
//
//   * Typing the PIN produced an EMPTY field. `\d` in JavaScript is ASCII
//     [0-9] only, so `value.replace(/\D/g, "")` deleted every Arabic-Indic
//     digit the keyboard had just produced.
//   * The login email was rejected by the browser with "a part following '@'
//     should not contain the symbol '.'" — the character next to "com" was an
//     Arabic full stop, or an invisible direction mark sat beside a real one.
//     Both are unreadable on screen, so the message looks like it is objecting
//     to an ordinary dot.
// ============================================================================

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/** Arabic-Indic and Persian numerals -> ASCII. Everything else untouched. */
export function toAsciiDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (char) => {
    const code = char.charCodeAt(0);
    const zero =
      code >= EXTENDED_ARABIC_INDIC_ZERO
        ? EXTENDED_ARABIC_INDIC_ZERO
        : ARABIC_INDIC_ZERO;
    return String(code - zero);
  });
}

/** Digits only — accepting whichever numerals the keyboard produced. */
export function digitsOnly(value: string): string {
  return toAsciiDigits(value).replace(/\D/g, "");
}

/** The invisible direction marks an RTL field picks up. Not whitespace. */
const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/g;

/**
 * Turn whatever the keyboard produced into an email address.
 *
 * Deliberately forgiving: every substitution here maps a character the user
 * cannot visually distinguish from the ASCII one onto the ASCII one. Nothing
 * that changes what a human would read as the address is touched.
 */
export function normalizeEmail(value: string): string {
  return toAsciiDigits(value)
    .replace(BIDI_MARKS, "")
    // Full stops that are not U+002E: Arabic, one-dot leader, fullwidth, CJK.
    .replace(/[\u06D4\u2024\uFF0E\u3002]/g, ".")
    .replace(/\uFF20/g, "@") // fullwidth @
    // \s covers NBSP and the zero-width no-break space, which Android
    // keyboards insert around a long-pressed character.
    .replace(/[\s\u200B-\u200D\uFEFF]+/g, "")
    .toLowerCase();
}

/**
 * Is this plausibly an address we can send to the server?
 *
 * Intentionally loose — the server is the authority on whether an account
 * exists. This exists only to replace the browser's native `type="email"`
 * bubble, which is untranslated (it appears in the BROWSER's language, not the
 * app's) and, as above, phrases its complaint in terms of a character the user
 * cannot see.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}
