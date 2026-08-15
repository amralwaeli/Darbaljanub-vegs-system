// Client-side photo compression before upload — keeps us comfortably inside
// the Supabase free-tier 1 GB storage: ~1280px JPEG @ q0.7 ≈ 100–200 KB.
//
// Compression is BEST EFFORT. It used to be the single unguarded step between
// the camera and the upload: one throw here and the driver saw "check your
// connection" for a failure that never touched the network, with nothing
// logged. A phone whose camera hands back a format Chrome cannot decode (HEIC
// is the usual culprit) could never complete a delivery.
//
// Now: try to shrink; if that fails, hand the original back when it is already
// something the bucket accepts, and otherwise throw an error that names the
// real cause.

const MAX_DIM = 1280;
const QUALITY = 0.7;

/** Mirrors the delivery-photos bucket config in 0005_storage.sql. */
const BUCKET_MIME = ["image/jpeg", "image/webp"];
const BUCKET_MAX_BYTES = 1_048_576;

export class ImageCompressError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(detail);
    this.name = "ImageCompressError";
    this.detail = detail;
  }
}

export interface CompressResult {
  blob: Blob;
  /** True when compression failed and the original file is being used as-is. */
  fellBack: boolean;
  /** Human-readable reason compression failed, for logging. */
  reason?: string;
}

async function shrink(file: File | Blob): Promise<Blob> {
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
    if (!blob) throw new Error("canvas.toBlob returned null");
    return blob;
  } finally {
    bitmap.close();
  }
}

export async function compressImage(
  file: File | Blob,
): Promise<CompressResult> {
  try {
    return { blob: await shrink(file), fellBack: false };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const type = (file as File).type || "unknown";
    // Log the true cause: this is the only trace of it on a phone in the field.
    console.error("[photo] compression failed", { type, size: file.size, reason });

    // The original may still be perfectly uploadable.
    if (BUCKET_MIME.includes(type) && file.size <= BUCKET_MAX_BYTES) {
      return { blob: file, fellBack: true, reason };
    }

    // It is not, and we could not convert it. Say exactly why.
    if (!BUCKET_MIME.includes(type)) {
      throw new ImageCompressError(
        `Camera returned "${type}", which this phone's browser cannot convert. ` +
          `Set the camera to JPEG and retry. (${reason})`,
      );
    }
    throw new ImageCompressError(
      `Photo is ${Math.round(file.size / 1024)} KB and could not be compressed. (${reason})`,
    );
  }
}
