// ============================================================================
// Delivery-proof camera.
//
// WHY THIS EXISTS: the web path is `<input type="file" capture="environment">`,
// which on many Android phones returns HEIC. Chrome cannot decode HEIC, so
// createImageBitmap() in imageCompress.ts threw and the driver could never
// complete the delivery. Chrome being killed mid-capture lost the photo too.
//
// The native camera removes the whole failure class at the source: the OS
// hands back an already-resized JPEG, so there is nothing to convert and
// nothing to compress.
// ============================================================================

import { isNative } from "./index";

// Must stay within the delivery-photos bucket limits (0005_storage.sql):
// image/jpeg, <= 1 MB. 1280px @ q70 lands around 100-200 KB.
const MAX_DIM = 1280;
const QUALITY = 70;

export interface CapturedPhoto {
  blob: Blob;
  /**
   * True when the OS camera already produced an upload-ready JPEG, so the
   * canvas compression step can be skipped entirely.
   */
  preOptimized: boolean;
}

/** True only in the APK — the website keeps using its file input. */
export const hasNativeCamera = isNative;

/**
 * Open the native camera and return the photo as a JPEG blob.
 *
 * Returns `null` when the user backs out, which is a normal outcome and must
 * not surface as an error.
 */
export async function capturePhoto(): Promise<CapturedPhoto | null> {
  const { Camera, CameraResultType, CameraSource } = await import(
    "@capacitor/camera"
  );

  let webPath: string | undefined;
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri,
      quality: QUALITY,
      width: MAX_DIM,
      // Phones record orientation in EXIF rather than rotating pixels; without
      // this, proof photos arrive sideways.
      correctOrientation: true,
      allowEditing: false,
      saveToGallery: false,
    });
    webPath = photo.webPath;
  } catch (e) {
    // The plugin reports cancellation as a thrown error. Everything else is a
    // real fault worth logging, but either way the caller just gets null and
    // the driver can tap the button again.
    const message = e instanceof Error ? e.message : String(e);
    if (!/cancel/i.test(message)) {
      console.error("[photo] native camera failed", message);
      throw e;
    }
    return null;
  }

  if (!webPath) return null;

  // webPath is a WebView-local URL; fetching it is how Capacitor exposes the
  // bytes. No network involved.
  const blob = await (await fetch(webPath)).blob();
  return { blob, preOptimized: true };
}
