/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
export function inspectIntelligenceHtml(source: string) {
  const document = new DOMParser().parseFromString(source, 'text/html')
  const externalAttributes = [
    ...document.querySelectorAll('[src], [href], [srcset], [poster], [data]'),
  ].some((element) =>
    ['src', 'href', 'srcset', 'poster', 'data'].some((name) => {
      const value = element.getAttribute(name)?.trim()
      return value && !value.startsWith('#') && !value.startsWith('data:')
    })
  )
  const hasExternalReferences =
    externalAttributes ||
    /@import\b|(?:url\(\s*['"]?(?!data:|#)[^\s)'" ])|(?:https?:\/\/)/i.test(
      [...document.querySelectorAll('style, script, [style]')]
        .map(
          (element) =>
            `${element.textContent ?? ''} ${element.getAttribute('style') ?? ''}`
        )
        .join('\n')
    )
  return {
    completeHtml:
      /^\s*(?:<!doctype\s+html[^>]*>\s*)?<html\b/i.test(source) &&
      /<\/html>\s*$/i.test(source) &&
      !source.includes('```'),
    inlineSvg: document.querySelector('svg') !== null,
    animation:
      /@keyframes|<animate(?:Transform|Motion)?\b|requestAnimationFrame\s*\(/i.test(
        source
      ),
    selfContained: !hasExternalReferences,
    responsive:
      document.querySelector('meta[name="viewport"]') !== null &&
      /viewBox\s*=|@media|(?:width|max-width)\s*:\s*(?:100%|100vw)/i.test(
        source
      ),
  }
}

// The iframe has an opaque origin (no allow-same-origin). Place CSP before all
// generated content so inline code can animate but cannot fetch dependencies.
export function intelligencePreviewDocument(source: string): string {
  const document = new DOMParser().parseFromString(source, 'text/html')
  document
    .querySelectorAll('base, meta[http-equiv], iframe, object, embed')
    .forEach((element) => element.remove())
  document.querySelectorAll('a, area, form').forEach((element) => {
    element.removeAttribute('href')
    element.removeAttribute('action')
    element.removeAttribute('target')
  })
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  document.head.prepend(policy)
  return `<!DOCTYPE html>\n${document.documentElement.outerHTML}`
}
