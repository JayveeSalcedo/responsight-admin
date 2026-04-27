/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile packages that ship ESM-only to avoid parse errors
  transpilePackages: ['recharts', 'lucide-react'],

  // Reduce cold-start time by pre-bundling large deps
  experimental: {
    optimizePackageImports: [
      'recharts',
      'lucide-react',
      'date-fns',
    ],
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
}

module.exports = nextConfig
