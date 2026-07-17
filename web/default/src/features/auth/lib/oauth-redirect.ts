export function normalizeOAuthRedirectTarget(
  target: string | undefined,
  currentOrigin: string
): string {
  if (!target) return '/dashboard'
  try {
    const parsed = new URL(target, currentOrigin)
    if (parsed.origin !== currentOrigin) return '/dashboard'
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/dashboard'
  } catch {
    return '/dashboard'
  }
}

export function buildOAuthReturnURL(
  returnOrigin: string | undefined,
  target: string,
  currentOrigin: string
): string | null {
  if (!returnOrigin) return null
  try {
    const origin = new URL(returnOrigin)
    if (origin.protocol !== 'https:' || origin.origin === currentOrigin) {
      return null
    }
    return `${origin.origin}${target}`
  } catch {
    return null
  }
}
