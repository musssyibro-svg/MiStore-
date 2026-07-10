// supabase/functions/catalog-images/index.ts
// Same design as bike-images (see that file for the full rationale on using
// ImageScript instead of sharp), generalized to catalog_products/variants.
// Deploy with: supabase functions deploy catalog-images
//
// Routes (relative to /functions/v1/catalog-images):
//   GET    ?product_id=<uuid>                         -> list images
//   POST   multipart: product_id, variant_id?, files[] -> upload
//   PUT    ?id=<uuid>&action=cover                     -> set cover
//   PUT    ?id=<uuid>&action=replace  multipart: file   -> replace original
//   PUT    (no action) body: [{id, position}, ...]      -> bulk reorder
//   DELETE ?id=<uuid>                                   -> delete
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { corsHeaders, handleOptions, json } from "../_shared/cors.ts";
import { adminClient, verifyAdmin } from "../_shared/auth.ts";

const BUCKET = Deno.env.get("CATALOG_PHOTO_BUCKET") || "catalog-photos";
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function sanitizeFilename(name: string) { return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120); }

async function uploadBuffer(path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await adminClient.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
}

async function makeThumbnail(bytes: Uint8Array) {
  try {
    const img = await Image.decode(bytes);
    const targetW = 400;
    const targetH = Math.max(1, Math.round(img.height * (targetW / img.width)));
    const jpg = await img.resize(targetW, targetH).encodeJPEG(80);
    return jpg;
  } catch (_e) { return null; }
}

async function nextPosition(productId: string) {
  const { data } = await adminClient.from("catalog_images").select("position").eq("product_id", productId)
    .order("position", { ascending: false }).limit(1);
  return data && data.length ? (data[0].position || 0) + 1 : 0;
}

Deno.serve(async (req: Request) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const url = new URL(req.url);
  const method = req.method;

  try {
    if (method === "GET") {
      const productId = url.searchParams.get("product_id");
      if (!productId) return json({ error: "missing product_id" }, 400);
      const { data, error } = await adminClient.from("catalog_images").select("*").eq("product_id", productId).order("position", { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json(data);
    }

    await verifyAdmin(req);

    if (method === "POST") {
      const form = await req.formData();
      const productId = form.get("product_id");
      const variantId = form.get("variant_id") || null;
      if (!productId || typeof productId !== "string") return json({ error: "missing product_id" }, 400);

      const { data: product } = await adminClient.from("catalog_products").select("id").eq("id", productId).single();
      if (!product) return json({ error: "product not found" }, 404);

      const files = form.getAll("files").length ? form.getAll("files") : form.getAll("file");
      if (!files.length) return json({ error: "no files provided" }, 400);

      let pos = await nextPosition(productId);
      const created = [];
      for (const entry of files) {
        if (!(entry instanceof File)) continue;
        if (entry.size > MAX_FILE_BYTES) return json({ error: `${entry.name} exceeds 15MB` }, 400);
        if (entry.type && !ALLOWED_MIME.has(entry.type)) return json({ error: `${entry.name}: unsupported type` }, 400);

        const bytes = new Uint8Array(await entry.arrayBuffer());
        const ts = Date.now();
        const safeName = sanitizeFilename(entry.name || "upload.jpg");
        const originalPath = `catalog/${productId}/${ts}-${safeName}`;
        await uploadBuffer(originalPath, bytes, entry.type || "image/jpeg");

        let thumbPath: string | null = null;
        const thumb = await makeThumbnail(bytes);
        if (thumb) { thumbPath = `catalog/${productId}/${ts}-thumb.jpg`; await uploadBuffer(thumbPath, thumb, "image/jpeg"); }

        let width = null, height = null;
        try { const d = await Image.decode(bytes); width = d.width; height = d.height; } catch (_e) {}

        const { data: existingCover } = await adminClient.from("catalog_images").select("id").eq("product_id", productId).eq("is_cover", true).maybeSingle();

        const row = {
          product_id: productId, variant_id: variantId || null,
          storage_bucket: BUCKET, storage_path: originalPath,
          filename: entry.name, mime: entry.type || "image/jpeg", filesize: entry.size,
          width, height, position: pos++, is_cover: !existingCover,
          metadata: { source: "admin_upload", thumbnail_path: thumbPath },
        };
        const { data, error } = await adminClient.from("catalog_images").insert([row]).select().single();
        if (error) return json({ error: error.message }, 500);
        created.push(data);
      }
      return json({ ok: true, images: created }, 201);
    }

    if (method === "PUT") {
      const id = url.searchParams.get("id");
      const action = url.searchParams.get("action");

      if (!id && !action) {
        const body = await req.json();
        if (!Array.isArray(body)) return json({ error: "expected array" }, 400);
        for (const item of body) if (item.id) await adminClient.from("catalog_images").update({ position: Number(item.position) || 0 }).eq("id", item.id);
        return json({ ok: true });
      }

      if (!id) return json({ error: "missing id" }, 400);
      const { data: imgRow } = await adminClient.from("catalog_images").select("*").eq("id", id).single();
      if (!imgRow) return json({ error: "not found" }, 404);

      if (action === "cover") {
        await adminClient.from("catalog_images").update({ is_cover: false }).eq("product_id", imgRow.product_id);
        const { data, error } = await adminClient.from("catalog_images").update({ is_cover: true }).eq("id", id).select().single();
        if (error) return json({ error: error.message }, 400);
        return json(data);
      }

      if (action === "replace") {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) return json({ error: "missing file" }, 400);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const ts = Date.now();
        const newPath = `catalog/${imgRow.product_id}/${ts}-${sanitizeFilename(file.name || "replacement.jpg")}`;
        await uploadBuffer(newPath, bytes, file.type || "image/jpeg");
        const thumb = await makeThumbnail(bytes);
        let thumbPath: string | null = null;
        if (thumb) { thumbPath = `catalog/${imgRow.product_id}/${ts}-thumb.jpg`; await uploadBuffer(thumbPath, thumb, "image/jpeg"); }
        const oldPaths = [imgRow.storage_path]; if (imgRow.metadata?.thumbnail_path) oldPaths.push(imgRow.metadata.thumbnail_path);
        await adminClient.storage.from(imgRow.storage_bucket).remove(oldPaths).catch(() => null);
        const { data, error } = await adminClient.from("catalog_images").update({
          storage_path: newPath, filename: file.name, mime: file.type || "image/jpeg", filesize: file.size,
          metadata: { ...(imgRow.metadata || {}), thumbnail_path: thumbPath },
        }).eq("id", id).select().single();
        if (error) return json({ error: error.message }, 400);
        return json(data);
      }

      return json({ error: "unknown action" }, 400);
    }

    if (method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing id" }, 400);
      const { data: imgRow } = await adminClient.from("catalog_images").select("*").eq("id", id).single();
      if (imgRow) {
        const paths = [imgRow.storage_path]; if (imgRow.metadata?.thumbnail_path) paths.push(imgRow.metadata.thumbnail_path);
        await adminClient.storage.from(imgRow.storage_bucket).remove(paths).catch(() => null);
      }
      const { error } = await adminClient.from("catalog_images").delete().eq("id", id);
      if (error) return json({ error: error.message }, 400);
      if (imgRow?.is_cover) {
        const { data: next } = await adminClient.from("catalog_images").select("id").eq("product_id", imgRow.product_id).order("position", { ascending: true }).limit(1).maybeSingle();
        if (next) await adminClient.from("catalog_images").update({ is_cover: true }).eq("id", next.id);
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
