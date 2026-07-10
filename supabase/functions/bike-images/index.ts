// supabase/functions/bike-images/index.ts
//
// This is the highest-priority piece of the whole repair job: real, working,
// server-side bike image management. Deploy with:
//   supabase functions deploy bike-images
//
// Why not `sharp` (like the old, non-functional images_manager.ts)?
// Supabase Edge Functions run on Deno Deploy, which does not support sharp's
// native binary. Instead this uses:
//   - ImageScript (github.com/matmen/ImageScript), a pure WASM/Deno image
//     library, for decoding, cropping, and generating a real JPEG thumbnail.
//   - Supabase Storage's built-in image transformation endpoint for on-demand
//     resizing/WebP at *read* time (?width=&quality=&format=webp appended to
//     the public URL) -- so we don't need to hand-generate a WebP variant for
//     every image on upload. If your project's Storage image transformation
//     is not enabled (it's a paid-tier feature), the admin UI simply falls
//     back to the pre-generated thumbnail below.
//
// Routes (relative to /functions/v1/bike-images), all mutations admin-only:
//   GET    ?bike_id=<uuid>                        -> list images for a bike, ordered
//   POST   multipart/form-data: bike_id + file(s) -> upload one or more images
//   PUT    ?id=<uuid>&action=cover                -> set as cover image
//   PUT    ?id=<uuid>&action=crop   {crop:{left,top,width,height}} -> crop + re-save
//   PUT    ?id=<uuid>&action=replace  multipart: file -> replace original, keep row
//   PUT    (no action) body: [{id, position}, ...]  -> bulk reorder
//   DELETE ?id=<uuid>                              -> delete one image
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { corsHeaders, handleOptions, json } from "../_shared/cors.ts";
import { adminClient, verifyAdmin } from "../_shared/auth.ts";

const BUCKET = Deno.env.get("BIKE_PHOTO_BUCKET") || "bike-photos";
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB per file
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

async function uploadBuffer(path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await adminClient.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
}

async function makeThumbnail(bytes: Uint8Array): Promise<{ buf: Uint8Array; w: number; h: number } | null> {
  try {
    const img = await Image.decode(bytes);
    const targetW = 400;
    const scale = targetW / img.width;
    const targetH = Math.max(1, Math.round(img.height * scale));
    const resized = img.resize(targetW, targetH);
    const jpg = await resized.encodeJPEG(80);
    return { buf: jpg, w: targetW, h: targetH };
  } catch (_e) {
    // Non-image or unsupported format (e.g. an already-broken upload) -- skip thumb.
    return null;
  }
}

async function nextPosition(bikeId: string): Promise<number> {
  const { data } = await adminClient
    .from("bike_images")
    .select("position")
    .eq("bike_id", bikeId)
    .order("position", { ascending: false })
    .limit(1);
  return data && data.length ? (data[0].position || 0) + 1 : 0;
}

Deno.serve(async (req: Request) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  const url = new URL(req.url);
  const method = req.method;

  try {
    if (method === "GET") {
      const bikeId = url.searchParams.get("bike_id");
      if (!bikeId) return json({ error: "missing bike_id" }, 400);
      const { data, error } = await adminClient
        .from("bike_images")
        .select("*")
        .eq("bike_id", bikeId)
        .order("position", { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    // Every mutation below requires the same admin session admin.html already logs into.
    await verifyAdmin(req);

    if (method === "POST") {
      const form = await req.formData();
      const bikeId = form.get("bike_id");
      if (!bikeId || typeof bikeId !== "string") return json({ error: "missing bike_id" }, 400);

      const { data: bike } = await adminClient.from("bikes").select("id").eq("id", bikeId).single();
      if (!bike) return json({ error: "bike not found" }, 404);

      const files = form.getAll("files").length ? form.getAll("files") : form.getAll("file");
      if (!files.length) return json({ error: "no files provided" }, 400);

      let pos = await nextPosition(bikeId);
      const created = [];

      for (const entry of files) {
        if (!(entry instanceof File)) continue;
        if (entry.size > MAX_FILE_BYTES) {
          return json({ error: `${entry.name} exceeds 15MB limit` }, 400);
        }
        if (entry.type && !ALLOWED_MIME.has(entry.type)) {
          return json({ error: `${entry.name}: unsupported type ${entry.type}` }, 400);
        }

        const bytes = new Uint8Array(await entry.arrayBuffer());
        const timestamp = Date.now();
        const safeName = sanitizeFilename(entry.name || "upload.jpg");
        const originalPath = `bikes/${bikeId}/${timestamp}-${safeName}`;
        await uploadBuffer(originalPath, bytes, entry.type || "image/jpeg");

        let thumbPath: string | null = null;
        let width: number | null = null;
        let height: number | null = null;
        const thumb = await makeThumbnail(bytes);
        if (thumb) {
          thumbPath = `bikes/${bikeId}/${timestamp}-thumb.jpg`;
          await uploadBuffer(thumbPath, thumb.buf, "image/jpeg");
        }
        try {
          const decoded = await Image.decode(bytes);
          width = decoded.width;
          height = decoded.height;
        } catch (_e) { /* non-fatal */ }

        const { data: existingCover } = await adminClient
          .from("bike_images")
          .select("id")
          .eq("bike_id", bikeId)
          .eq("is_cover", true)
          .maybeSingle();

        const row = {
          bike_id: bikeId,
          storage_bucket: BUCKET,
          storage_path: originalPath,
          filename: entry.name,
          mime: entry.type || "image/jpeg",
          filesize: entry.size,
          width,
          height,
          position: pos++,
          is_cover: !existingCover, // first image uploaded for a bike becomes the cover automatically
          metadata: { source: "admin_upload", thumbnail_path: thumbPath },
        };

        const { data, error } = await adminClient.from("bike_images").insert([row]).select().single();
        if (error) return json({ error: error.message }, 500);
        created.push(data);
      }

      return json({ ok: true, images: created }, 201);
    }

    if (method === "PUT") {
      const id = url.searchParams.get("id");
      const action = url.searchParams.get("action");

      if (!id && !action) {
        // Bulk reorder: body is [{id, position}, ...]
        const body = await req.json();
        if (!Array.isArray(body)) return json({ error: "expected array of {id, position}" }, 400);
        for (const item of body) {
          if (!item.id) continue;
          await adminClient.from("bike_images").update({ position: Number(item.position) || 0 }).eq("id", item.id);
        }
        return json({ ok: true });
      }

      if (!id) return json({ error: "missing id" }, 400);
      const { data: imgRow } = await adminClient.from("bike_images").select("*").eq("id", id).single();
      if (!imgRow) return json({ error: "not found" }, 404);

      if (action === "cover") {
        await adminClient.from("bike_images").update({ is_cover: false }).eq("bike_id", imgRow.bike_id);
        const { data, error } = await adminClient.from("bike_images").update({ is_cover: true }).eq("id", id).select().single();
        if (error) return json({ error: error.message }, 400);
        return json(data);
      }

      if (action === "crop") {
        const body = await req.json();
        const crop = body?.crop;
        if (!crop) return json({ error: "missing crop {left,top,width,height}" }, 400);

        const { data: download, error: dlErr } = await adminClient.storage.from(imgRow.storage_bucket).download(imgRow.storage_path);
        if (dlErr || !download) return json({ error: "failed to download original" }, 500);
        const bytes = new Uint8Array(await download.arrayBuffer());
        const decoded = await Image.decode(bytes);
        const left = Math.max(0, Math.floor(crop.left));
        const top = Math.max(0, Math.floor(crop.top));
        const w = Math.max(1, Math.floor(crop.width));
        const h = Math.max(1, Math.floor(crop.height));
        const cropped = decoded.crop(left, top, w, h);
        const jpg = await cropped.encodeJPEG(88);

        const timestamp = Date.now();
        const newPath = `bikes/${imgRow.bike_id}/${timestamp}-cropped.jpg`;
        await uploadBuffer(newPath, jpg, "image/jpeg");

        const thumb = await makeThumbnail(jpg);
        let thumbPath: string | null = null;
        if (thumb) {
          thumbPath = `bikes/${imgRow.bike_id}/${timestamp}-cropped-thumb.jpg`;
          await uploadBuffer(thumbPath, thumb.buf, "image/jpeg");
        }

        const { data, error } = await adminClient
          .from("bike_images")
          .update({
            storage_path: newPath,
            width: w,
            height: h,
            mime: "image/jpeg",
            metadata: { ...(imgRow.metadata || {}), thumbnail_path: thumbPath, cropped_from: imgRow.storage_path },
          })
          .eq("id", id)
          .select()
          .single();
        if (error) return json({ error: error.message }, 400);
        return json(data);
      }

      if (action === "replace") {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return json({ error: "missing file" }, 400);
        if (file.size > MAX_FILE_BYTES) return json({ error: "file exceeds 15MB limit" }, 400);

        const bytes = new Uint8Array(await file.arrayBuffer());
        const timestamp = Date.now();
        const safeName = sanitizeFilename(file.name || "replacement.jpg");
        const newPath = `bikes/${imgRow.bike_id}/${timestamp}-${safeName}`;
        await uploadBuffer(newPath, bytes, file.type || "image/jpeg");

        let width: number | null = null;
        let height: number | null = null;
        let thumbPath: string | null = null;
        try {
          const decoded = await Image.decode(bytes);
          width = decoded.width;
          height = decoded.height;
        } catch (_e) { /* non-fatal */ }
        const thumb = await makeThumbnail(bytes);
        if (thumb) {
          thumbPath = `bikes/${imgRow.bike_id}/${timestamp}-thumb.jpg`;
          await uploadBuffer(thumbPath, thumb.buf, "image/jpeg");
        }

        // Best-effort cleanup of the old files being replaced.
        const oldPaths = [imgRow.storage_path];
        if (imgRow.metadata?.thumbnail_path) oldPaths.push(imgRow.metadata.thumbnail_path);
        await adminClient.storage.from(imgRow.storage_bucket).remove(oldPaths).catch(() => null);

        const { data, error } = await adminClient
          .from("bike_images")
          .update({
            storage_path: newPath,
            filename: file.name,
            mime: file.type || "image/jpeg",
            filesize: file.size,
            width,
            height,
            metadata: { ...(imgRow.metadata || {}), thumbnail_path: thumbPath },
          })
          .eq("id", id)
          .select()
          .single();
        if (error) return json({ error: error.message }, 400);
        return json(data);
      }

      return json({ error: "unknown action" }, 400);
    }

    if (method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing id" }, 400);
      const { data: imgRow } = await adminClient.from("bike_images").select("*").eq("id", id).single();
      if (imgRow) {
        const paths = [imgRow.storage_path];
        if (imgRow.metadata?.thumbnail_path) paths.push(imgRow.metadata.thumbnail_path);
        await adminClient.storage.from(imgRow.storage_bucket).remove(paths).catch(() => null);
      }
      const { error } = await adminClient.from("bike_images").delete().eq("id", id);
      if (error) return json({ error: error.message }, 400);

      // If we just deleted the cover image, promote the next one in position order.
      if (imgRow?.is_cover) {
        const { data: next } = await adminClient
          .from("bike_images")
          .select("id")
          .eq("bike_id", imgRow.bike_id)
          .order("position", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (next) await adminClient.from("bike_images").update({ is_cover: true }).eq("id", next.id);
      }

      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    if (err?.name === "UnauthorizedError") return json({ error: "unauthorized" }, 401);
    console.error(err);
    return json({ error: String(err?.message || err) }, 500);
  }
});
