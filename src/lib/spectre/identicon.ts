/**
 * The Spectre/Master Password "user image" (identicon): a small 4-glyph figure
 * plus an ANSI color, deterministically derived from `fullName` and the master
 * secret via HMAC-SHA256(secret, fullName). Shown live while the secret is
 * typed, so a user can confirm the correct identity — unchanged from the
 * original mpw_identicon (left arm · body · right arm · accessory, color).
 */

const encoder = new TextEncoder()

const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer

const LEFT_ARMS = ['╔', '╚', '╰', '═']
const BODIES = ['█', '░', '▒', '▓', '☺', '☻']
const RIGHT_ARMS = ['╗', '╝', '╯', '═']
const ACCESSORIES = [
  '◈',
  '◎',
  '◐',
  '◑',
  '◒',
  '◓',
  '☀',
  '☁',
  '☂',
  '☃',
  '☄',
  '★',
  '☆',
  '☎',
  '☏',
  '⎈',
  '⌂',
  '☘',
  '☢',
  '☣',
  '☕',
  '⌚',
  '⌛',
  '⏰',
  '⚡',
  '⛄',
  '⛅',
  '☔',
  '♔',
  '♕',
  '♖',
  '♗',
  '♘',
  '♙',
  '♚',
  '♛',
  '♜',
  '♝',
  '♞',
  '♟',
  '♨',
  '♩',
  '♪',
  '♫',
  '⚐',
  '⚑',
  '⚔',
  '⚖',
  '⚙',
  '⚠',
  '⌘',
  '⏎',
  '✄',
  '✆',
  '✈',
  '✉',
  '✌',
]

/** The 7 ANSI SGR colors (31–37), as hex for the dark theme. */
const COLORS = [
  '#f87171', // red
  '#4ade80', // green
  '#facc15', // yellow
  '#60a5fa', // blue
  '#e879f9', // magenta
  '#22d3ee', // cyan
  '#e2e8f0', // white
]

export interface Identicon {
  glyphs: string
  color: string
}

/** Placeholder shown before a full name + secret are both entered. */
export const EMPTY_IDENTICON: Identicon = { glyphs: '····', color: '#475569' }

export const computeIdenticon = async (
  fullName: string,
  secret: string,
): Promise<Identicon> => {
  const key = await crypto.subtle.importKey(
    'raw',
    toBuf(encoder.encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const seed = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, toBuf(encoder.encode(fullName))),
  )
  return {
    glyphs:
      LEFT_ARMS[seed[0] % LEFT_ARMS.length] +
      BODIES[seed[1] % BODIES.length] +
      RIGHT_ARMS[seed[2] % RIGHT_ARMS.length] +
      ACCESSORIES[seed[3] % ACCESSORIES.length],
    color: COLORS[seed[4] % COLORS.length],
  }
}
