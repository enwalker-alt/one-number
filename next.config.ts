import type { NextConfig } from "next";
const nextConfig: NextConfig = { serverExternalPackages: ["twilio", "googleapis", "openai"] };
export default nextConfig;
