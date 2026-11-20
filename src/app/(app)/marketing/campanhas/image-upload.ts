"use client";
import { uploadCampaignAsset } from "./actions";

const MAX_W = 1200;

async function load(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Reduz a imagem para 1200 px de largura (e-mail não precisa de mais) antes de enviar; GIF vai como está (animação). */
async function shrink(file: File): Promise<{ file: File; width: number; height: number }> {
  const img = await load(file);
  const { naturalWidth: w, naturalHeight: h } = img;
  if (file.type === "image/gif" || (w <= MAX_W && file.size <= 1.5 * 1024 * 1024)) return { file, width: w, height: h };
  const scale = Math.min(1, MAX_W / w);
  const cw = Math.round(w * scale), ch = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  const png = file.type === "image/png";
  if (!png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch); }
  ctx.drawImage(img, 0, 0, cw, ch);
  const type = png ? "image/png" : "image/jpeg";
  let blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.86));
  if (blob && png && blob.size > 2.5 * 1024 * 1024) blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
  if (!blob) return { file, width: w, height: h };
  const ext = blob.type === "image/png" ? "png" : "jpg";
  return { file: new File([blob], file.name.replace(/\.\w+$/, "") + "." + ext, { type: blob.type }), width: cw, height: ch };
}

export async function uploadImage(file: File, campaignId?: string) {
  if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) return { ok: false as const, error: "Use JPG, PNG, GIF ou WebP." };
  const s = await shrink(file);
  const fd = new FormData();
  fd.set("file", s.file);
  fd.set("width", String(s.width));
  fd.set("height", String(s.height));
  if (campaignId) fd.set("campaignId", campaignId);
  return uploadCampaignAsset(fd);
}
