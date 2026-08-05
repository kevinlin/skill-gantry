/**
 * Terminals that honour OSC 52 vary in what they will accept, and one that
 * refuses an oversized payload refuses it silently. The cap is here so the
 * caller can tell the user "too large to copy" rather than report a copy the
 * terminal never made.
 */
export const OSC52_MAX_BYTES = 74_994

/**
 * `ESC ] 52 ; c ; <base64> BEL`. Base64 over **UTF-8** explicitly: a non-ASCII
 * character in a finding message is mangled by the `binary` encoding, and the
 * paste would carry the damage rather than fail visibly.
 *
 * Null when the payload is over the cap, so a caller cannot claim a copy that
 * did not happen.
 */
export function osc52(text: string): string | null {
  const payload = Buffer.from(text, 'utf8').toString('base64')
  if (payload.length > OSC52_MAX_BYTES) return null
  return `\u001B]52;c;${payload}\u0007`
}
