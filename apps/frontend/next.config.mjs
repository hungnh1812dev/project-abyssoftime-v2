import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const CMS_HEALTH_URL = `${new URL(process.env.GRAPHQL_URL ?? "http://localhost:5000/graphql").origin}/health`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Only the Docker image (apps/frontend/Dockerfile) sets NEXT_OUTPUT=standalone, so the Vercel build
  // stays exactly as before.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  env: {
    CMS_HEALTH_URL,
  },
  poweredByHeader: false,
  compress: true,

  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },

  logging: {
    fetches: {
      fullUrl: true,
      hmrRefreshes: false,
    },
  },

  reactCompiler: true,
};

export default withBundleAnalyzer(nextConfig);
