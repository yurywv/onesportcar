import type { MetadataRoute } from "next";

// App instalável (PWA): no celular, "Adicionar à tela inicial" abre o sistema como aplicativo,
// em tela cheia, com o ícone da OneSportCar. Mecânicos caem direto em "Minha oficina".
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "OneSportCar — Gestão da oficina",
    short_name: "OneSportCar",
    description: "Ordens de serviço, orçamentos, oficina, estoque, financeiro e notas fiscais da OneSportCar.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0c0d0f",
    theme_color: "#0c0d0f",
    lang: "pt-BR",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Minha oficina", short_name: "Oficina", url: "/oficina/minhas", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Nova OS (balcão)", short_name: "Nova OS", url: "/os/balcao", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Kanban", url: "/oficina/kanban", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
