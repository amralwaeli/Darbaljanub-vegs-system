import { supabase } from "../supabase";
import { must, maybe, ApiError } from "./helpers";
import { compressImage } from "../imageCompress";
import { enqueueCheck } from "../offlineQueue";
import { t } from "../../i18n/strings";
import type { DeliveryWithStore } from "../types";
import type { Views } from "../database.types";

export type ChecklistRow = Views<"driver_delivery_items">;

const BUCKET = "delivery-photos";

export async function fetchDeliveries(
  cycleId: string,
): Promise<DeliveryWithStore[]> {
  const { data, error } = await supabase
    .from("deliveries")
    .select("*, store:stores(id,name,address)")
    .eq("cycle_id", cycleId)
    .order("created_at")
    .returns<DeliveryWithStore[]>();
  return must(data, error);
}

export async function fetchDelivery(
  deliveryId: string,
): Promise<DeliveryWithStore | null> {
  const { data, error } = await supabase
    .from("deliveries")
    .select("*, store:stores(id,name,address)")
    .eq("id", deliveryId)
    .maybeSingle<DeliveryWithStore>();
  return maybe(data, error);
}

/**
 * Checklist rows come from the price-free driver_delivery_items VIEW —
 * a driver session has no access path to any price column.
 */
export async function fetchChecklist(
  deliveryId: string,
): Promise<ChecklistRow[]> {
  const { data, error } = await supabase
    .from("driver_delivery_items")
    .select("*")
    .eq("delivery_id", deliveryId)
    .order("item_name");
  return must(data, error);
}

/**
 * Tick/untick one checklist row. If the network is down the tick is queued
 * locally and replayed automatically (see offlineQueue).
 */
export async function setCheck(
  checkId: string,
  checked: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("delivery_item_checks")
    .update({ checked })
    .eq("id", checkId);
  if (error) {
    if (/fetch|network|failed|abort|timeout/i.test(error.message)) {
      enqueueCheck(checkId, checked); // offline — will sync later
      return;
    }
    must(true, error);
  }
}

/** Compress on-device, then upload to the private bucket. Returns the path. */
export async function uploadDeliveryPhoto(
  deliveryId: string,
  file: File | Blob,
): Promise<string> {
  const compressed = await compressImage(file);
  const path = `${deliveryId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, compressed, { contentType: "image/jpeg", upsert: false });
  if (error) throw new ApiError(t.photoFailed, error);
  return path;
}

/**
 * "Loaded" — the server-side deliveries_guard trigger re-validates that a
 * photo exists and every item is checked; the client cannot skip either.
 */
export async function markLoaded(
  deliveryId: string,
  photoPath: string,
): Promise<void> {
  const { error } = await supabase
    .from("deliveries")
    .update({ status: "LOADED", photo_path: photoPath })
    .eq("id", deliveryId);
  must(true, error);
}

/**
 * "Offloaded" — the driver has handed the goods over at the branch. The guard
 * trigger requires the offload photo, so proof of the drop-off cannot be
 * skipped any more than proof of the load can.
 */
export async function markOffloaded(
  deliveryId: string,
  offloadPhotoPath: string,
): Promise<void> {
  const { error } = await supabase
    .from("deliveries")
    .update({ status: "OFFLOADED", offload_photo_path: offloadPhotoPath })
    .eq("id", deliveryId);
  must(true, error);
}

export async function markReceived(deliveryId: string): Promise<void> {
  const { error } = await supabase
    .from("deliveries")
    .update({ status: "RECEIVED" })
    .eq("id", deliveryId);
  must(true, error);
}

/** Short-lived signed URL — the bucket is private, there are no public URLs. */
export async function getPhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);
  const res = must(data, error);
  return res.signedUrl;
}
