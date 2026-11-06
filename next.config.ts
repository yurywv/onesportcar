import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
// Origens das câmeras (player do NVR/nuvem, HLS, imagens). Ex.: "https://cam.onesportcar.com.br https://*.cloudcam.com".
// Sem configuração, aceita qualquer origem HTTPS só para mídia/iframe/imagem/conexão.
const cams = (process.env.CAMERA_ORIGINS ?? "https:").trim();
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${cams}`,
  `media-src 'self' blob: ${cams}`,
  `frame-src 'self' ${cams}`,
  "font-src 'self'",
  `connect-src 'self' https://viacep.com.br ${cams}`,
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
      ],
    }];
  },
};

export default nextConfig;
