/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export", // enables static HTML export
  images: { unoptimized: true }, // since GitHub Pages doesn’t support Next Image optimization
  basePath: "/FormatDaddy", // repo name
  assetPrefix: "/FormatDaddy/",
};

export default nextConfig;
