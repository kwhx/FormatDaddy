/** @type {import('next').NextConfig} */
const nextConfig = {
  // remove `output: "export"` unless you intentionally want a static export
  // output: "export",
  images: { unoptimized: true }, // ok to keep if you want client-side images
};

export default nextConfig;
