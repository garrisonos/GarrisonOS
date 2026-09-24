/**
 * Returns the configured canonical public origin, defaulting to the local web server.
 *
 * @returns Public origin for absolute metadata URLs.
 */
export function configuredPublicOrigin(): string {
  return process.env['PUBLIC_ORIGIN'] || `http://localhost:${process.env['WEB_PORT'] || '8080'}`;
}

/**
 * Builds the absolute OpenGraph image URL from a trusted public origin.
 *
 * @param publicOrigin - Canonical HTTP(S) origin configured for the web presentation server.
 * @returns Absolute URL for the default OpenGraph image.
 */
export function ogImageUrl(publicOrigin: string): string {
  const origin = new URL(publicOrigin);
  if ((origin.protocol !== 'http:' && origin.protocol !== 'https:') || origin.username || origin.password) {
    throw new TypeError('PUBLIC_ORIGIN must be an HTTP(S) origin without credentials');
  }
  return new URL('/public/og-image.png', origin.origin).href;
}
