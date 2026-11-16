"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { tickCampaign } from "../actions";

/** Enquanto esta tela estiver aberta, dispara o lote quando chegar a hora (complementa o cron da Vercel). */
export function Ticker({ id, cron }: { id: string; cron: boolean }) {
  const router = useRouter();
  const [last, setLast] = useState<string>("");
  useEffect(() => {
    let alive = true;
    const go = async () => {
      try {
        const r = await tickCampaign(id);
        if (!alive) return;
        if (r.sent) setLast(`${new Date().toLocaleTimeString("pt-BR")}: ${r.sent} enviada(s)`);
        router.refresh();
      } catch { /* ignora; tenta de novo */ }
    };
    go();
    const t = setInterval(go, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [id, router]);
  return <p className="text-xs text-muted">Atualizando a cada 30 s{last ? ` · último lote ${last}` : ""}. {cron ? "Pode fechar esta tela: o envio continua pelo servidor." : "Mantenha esta tela aberta: o disparo automático (cron) ainda não está configurado."}</p>;
}
