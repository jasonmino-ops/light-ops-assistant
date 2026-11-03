import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/products/import/jobs/*/analyze': ['./.next/server/chunks/product-import-pdf-worker.js'],
  },
  webpack(config, { isServer, nextRuntime }) {
    if (isServer && nextRuntime === 'nodejs') {
      // Node workers load from the server chunk directory, not the browser asset URL.
      config.output.workerPublicPath = './'
    }
    return config
  },
}

export default nextConfig
