import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static SPA export → uploaded to logo.corantsoft.com's shared-hosting folder (D-014).
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true, // LiteSpeed directory mapping
  // fileURLToPath, not URL.pathname: on Windows .pathname yields "/C:/cora-demo/",
  // which Turbopack cannot canonicalize (os error 123). POSIX hosts never hit it.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: ['@cora/shared'],
};

export default nextConfig;
