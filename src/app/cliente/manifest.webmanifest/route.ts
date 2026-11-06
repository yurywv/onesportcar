// App do cliente instalável (separado do app da equipe).
export function GET() {
  return Response.json({
    id: "/cliente", name: "Meu OneSportCar", short_name: "OneSportCar", start_url: "/cliente", scope: "/cliente",
    display: "standalone", background_color: "#0c0d0f", theme_color: "#0c0d0f", lang: "pt-BR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, { headers: { "Content-Type": "application/manifest+json" } });
}
