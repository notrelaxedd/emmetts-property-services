import { randomInt } from "node:crypto"

/** Letters and digits that can't be misread when texted or read out loud (no 0/O, 1/l/I, 5/S, 8/B, 2/Z). */
const ALPHABET = "abcdefghjkmnpqrtuvwxyz34679"

/**
 * A one-time password the owner hands to a crew member: `mow-xxxx-xxxx` (8 random characters from a
 * 27-symbol alphabet, about 38 bits). Easy to text, easy to type on a phone, and the crew member can
 * replace it at /account/password as soon as they are in.
 */
export function generateTempPassword(groups = 2, groupLength = 4): string {
  const parts: string[] = []
  for (let g = 0; g < groups; g++) {
    let part = ""
    for (let i = 0; i < groupLength; i++) part += ALPHABET[randomInt(ALPHABET.length)]
    parts.push(part)
  }
  return `mow-${parts.join("-")}`
}

export const TEMP_PASSWORD_ALPHABET = ALPHABET
