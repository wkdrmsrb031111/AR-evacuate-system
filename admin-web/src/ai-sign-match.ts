export const normalizeSign = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export function cameraSignMatches(registered: string | undefined, recognized: string, source: 'camera' | 'sample') {
  const expected = normalizeSign(registered ?? '')
  return source === 'camera' && expected.length >= 2 && expected === normalizeSign(recognized)
}
