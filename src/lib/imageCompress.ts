// Client-side photo compression before upload — keeps us comfortably inside
// the Supabase free-tier 1 GB storage: ~1280px JPEG @ q0.7 ≈ 100–200 KB.

const MAX_DIM = 1280;
const QUALITY = 0.7;

export async function compressImage(file: File | Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not supported");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob) throw new Error("Image compression failed");
    return blob;
  } finally {
    bitmap.close();
  }
}
