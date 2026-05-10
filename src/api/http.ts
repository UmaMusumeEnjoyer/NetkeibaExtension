const DEFAULT_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
  referer: 'https://race.netkeiba.com/',
}

const CHALLENGE_MARKERS = [
  'captcha',
  'challenge',
  'access denied',
  'forbidden',
  '異常',
]

const DECODER_CANDIDATES = ['utf-8', 'shift_jis', 'euc-jp'] as const

function extractCharset(contentType: string | null): string | null {
  if (!contentType) {
    return null
  }

  const match = contentType.match(/charset\s*=\s*([^;]+)/i)
  return match?.[1]?.trim().toLowerCase() ?? null
}

function decodeWithCharset(buffer: ArrayBuffer, charset: string): string | null {
  try {
    return new TextDecoder(charset).decode(buffer)
  } catch {
    return null
  }
}

function countReplacements(text: string): number {
  return (text.match(/\uFFFD/g) ?? []).length
}

function countJapanese(text: string): number {
  return (text.match(/[\u3040-\u30ff\u3400-\u9fff]/g) ?? []).length
}

function decodeHtmlBuffer(buffer: ArrayBuffer, contentType: string | null): string {
  const preferredCharset = extractCharset(contentType)
  const tried = new Set<string>()
  const decodedCandidates: Array<{ charset: string; text: string; replacements: number; japanese: number }> = []

  const charsetOrder = [
    ...(preferredCharset ? [preferredCharset] : []),
    ...DECODER_CANDIDATES,
  ]

  for (const charset of charsetOrder) {
    if (!charset || tried.has(charset)) {
      continue
    }
    tried.add(charset)

    const text = decodeWithCharset(buffer, charset)
    if (!text) {
      continue
    }

    decodedCandidates.push({
      charset,
      text,
      replacements: countReplacements(text),
      japanese: countJapanese(text),
    })
  }

  if (decodedCandidates.length === 0) {
    return new TextDecoder('utf-8').decode(buffer)
  }

  decodedCandidates.sort((a, b) => {
    if (a.replacements !== b.replacements) {
      return a.replacements - b.replacements
    }
    return b.japanese - a.japanese
  })

  return decodedCandidates[0].text
}

function detectChallengePage(html: string): string | null {
  const lower = html.toLowerCase()
  
  // Only flag as challenge if we find clear markers of an anti-bot page
  // Avoid false positives from race names or generic form elements
  if (lower.includes('access denied') || lower.includes('forbidden')) {
    return 'access-denied'
  }
  
  // Look for actual CAPTCHA/challenge form patterns - must have both markers AND form elements
  if ((/recaptcha|hcaptcha/i).test(html)) {
    // Must also have form or data-sitekey attribute to be a real challenge
    if (/<form|data-sitekey/i.test(html)) {
      return 'challenge-form'
    }
  }
  
  // Check for Cloudflare Turnstile or similar challenge markers
  if ((/<iframe[^>]*id=["']?cf_challenge["']?|class=["']?cf-challenge["']?/i).test(html)) {
    return 'cloudflare-challenge'
  }
  
  // Check for Japanese error message in error context only
  if (lower.includes('異常') && /エラー|error|exception|invalid/i.test(html)) {
    return 'error-marker'
  }
  
  return null
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchHtml(url: string, delayMs = 0): Promise<string> {
  if (delayMs > 0) {
    await sleep(delayMs)
  }

  // Use a copy of default headers and adjust referer for EN pages
  const headers = { ...DEFAULT_HEADERS }
  try {
    const u = new URL(url)
    if (u.hostname === 'en.netkeiba.com') {
      headers.referer = 'https://en.netkeiba.com/'
    }
  } catch {
    // ignore URL parse errors and fallback to defaults
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: headers as HeadersInit,
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`)
  }

  const buffer = await response.arrayBuffer()
  const html = decodeHtmlBuffer(buffer, response.headers.get('content-type'))
  const challengeMarker = detectChallengePage(html)
  if (challengeMarker) {
    throw new Error(`Potential anti-bot page detected (${challengeMarker}) for ${url}`)
  }

  return html
}

export function toAbsoluteUrl(baseUrl: string, maybeRelativeUrl: string): string {
  return new URL(maybeRelativeUrl, baseUrl).toString()
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  initialDelayMs = 400,
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      // Keep logs concise but explicit for sidepanel debugging.
      console.warn(
        `[crawl] attempt ${attempt + 1}/${retries + 1} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      if (attempt === retries) {
        break
      }
      await sleep(initialDelayMs * (attempt + 1))
    }
  }

  throw lastError
}
