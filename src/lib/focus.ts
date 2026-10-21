import type { FiscalKind, FiscalStatus } from "@prisma/client";

// Cliente HTTP da Focus NFe (API v2). Autenticação HTTP Basic: usuário = token, senha vazia.
const HOST = { PRODUCAO: "https://api.focusnfe.com.br", HOMOLOGACAO: "https://homologacao.focusnfe.com.br" } as const;
type Env = keyof typeof HOST;
const PATH: Record<FiscalKind, string> = { NFSE: "nfsen", NFE: "nfe" };

export type FocusResponse = { httpStatus: number; body: Record<string, unknown> };

export async function focusRequest(env: Env, token: string, method: "GET" | "POST" | "DELETE", kind: FiscalKind, ref: string, payload?: unknown): Promise<FocusResponse> {
  const url = method === "POST" ? `${HOST[env]}/v2/${PATH[kind]}?ref=${encodeURIComponent(ref)}` : `${HOST[env]}/v2/${PATH[kind]}/${encodeURIComponent(ref)}${method === "GET" && kind === "NFE" ? "?completa=0" : ""}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`, ...(payload ? { "Content-Type": "application/json" } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const text = await res.text();
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { body = { mensagem: text.slice(0, 500) }; }
    return { httpStatus: res.status, body };
  } catch (e) {
    return { httpStatus: 0, body: { codigo: "falha_comunicacao", mensagem: e instanceof Error ? e.message : String(e) } };
  }
}

type Parsed = {
  status: FiscalStatus; message: string | null; number: string | null; accessKey: string | null; verificationCode: string | null; protocol: string | null;
  xmlPath: string | null; pdfPath: string | null;
};

const s = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));

function errorText(b: Record<string, unknown>) {
  const errs = Array.isArray(b.erros) ? (b.erros as Record<string, unknown>[]).map((e) => [e.mensagem, e.correcao && `(${e.correcao})`].filter(Boolean).join(" ")) : [];
  return [s(b.mensagem_sefaz), s(b.mensagem), ...errs].filter(Boolean).join(" · ") || null;
}

/** Traduz a resposta da Focus para o status interno. */
export function parseFocusResponse(kind: FiscalKind, r: FocusResponse): Parsed {
  const b = r.body;
  const st = s(b.status);
  const base: Parsed = {
    status: "ERRO", message: errorText(b), number: s(b.numero), accessKey: null, verificationCode: s(b.codigo_verificacao), protocol: s(b.protocolo),
    xmlPath: s(b.caminho_xml_nota_fiscal), pdfPath: kind === "NFE" ? s(b.caminho_danfe) : s(b.url_danfse),
  };
  if (kind === "NFE") base.accessKey = s(b.chave_nfe)?.replace(/^NFe/, "") ?? null;
  else {
    const url = s(b.url);
    base.accessKey = url ? new URL(url, "https://x").searchParams.get("chave") : null;
  }
  if (r.httpStatus === 0) return { ...base, status: "ERRO" };
  if (r.httpStatus === 401) return { ...base, status: "ERRO", message: "Token do provedor recusado (HTTP 401). Confira o token do ambiente." };
  switch (st) {
    case "processando_autorizacao": return { ...base, status: "PROCESSANDO", message: base.message ?? "Em processamento na prefeitura/SEFAZ." };
    case "autorizado": return { ...base, status: "AUTORIZADA", message: null };
    case "cancelado": return { ...base, status: "CANCELADA" };
    case "erro_autorizacao": case "negado": case "denegado": return { ...base, status: "REJEITADA" };
    case "erro_cancelamento": return { ...base, status: "AUTORIZADA", message: base.message ?? "Cancelamento recusado." };
  }
  // 4xx de validação: a nota não entrou na fila — pode corrigir e retransmitir com a mesma referência
  if (r.httpStatus >= 400 && r.httpStatus < 500) return { ...base, status: "REJEITADA" };
  return base;
}

/** Caminhos de arquivo da Focus vêm relativos ("/arquivos/..."); URLs da NFS-e nacional vêm absolutas. */
export function focusFileUrl(env: Env, path: string | null) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${HOST[env]}${path.startsWith("/") ? "" : "/"}${path}`;
}
