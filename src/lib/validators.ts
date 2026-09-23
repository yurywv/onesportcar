// Validadores brasileiros (spec §6.2, §6.3)

export const onlyDigits = (s: string) => s.replace(/\D/g, "");

export function isValidCPF(value: string): boolean {
  const c = onlyDigits(value);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

/** Normaliza CNPJ numérico ou alfanumérico (IN RFB 2.229/2024): 12 posições alfanuméricas + 2 DV numéricos. */
export const normalizeCNPJ = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, "");

export function isValidCNPJ(value: string): boolean {
  const c = normalizeCNPJ(value);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  // Valor de cada caractere = código ASCII − 48 (vale para dígitos e letras)
  const v = (ch: string) => ch.charCodeAt(0) - 48;
  const dv = (base: string) => {
    let w = 2, sum = 0;
    for (let i = base.length - 1; i >= 0; i--) {
      sum += v(base[i]) * w;
      w = w === 9 ? 2 : w + 1;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}

export function normalizeDocument(type: "PF" | "PJ", s: string) {
  return type === "PF" ? onlyDigits(s) : normalizeCNPJ(s);
}

export function formatDocument(doc: string) {
  if (/^\d{11}$/.test(doc)) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (/^[0-9A-Z]{14}$/.test(doc)) return doc.replace(/(.{2})(.{3})(.{3})(.{4})(.{2})/, "$1.$2.$3/$4-$5");
  return doc;
}

/** Placa: aceita antiga (AAA9999) e Mercosul (AAA9A99), com ou sem hífen. */
export const normalizePlate = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, "");
export const isValidPlate = (s: string) => /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(normalizePlate(s));
export function formatPlate(p: string) {
  return /^[A-Z]{3}\d{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

/** VIN: 17 caracteres, sem I, O, Q. */
export const isValidVIN = (s: string) => /^[A-HJ-NPR-Z0-9]{17}$/.test(s.toUpperCase());

export function isValidRenavam(value: string): boolean {
  const r = onlyDigits(value).padStart(11, "0");
  if (r.length !== 11) return false;
  const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(r[i]), 0);
  let d = 11 - (sum % 11);
  if (d >= 10) d = 0;
  return d === Number(r[10]);
}

export const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
