// src/functions/images.ts
import { sb } from '../utils/supabaseClient';
import formidable from 'formidable';
import fs from 'fs';
import sharp from 'sharp';

// This function file demonstrates endpoints to accept multipart upload, process images (crop/thumbnail/webp)
// In production you should use signed uploads to Supabase Storage and process asynchronously.

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  try {
    const method = req.method;
    if (method === 'POST') {
      // Accept file upload, process and insert into images table
      const form = new formidable.IncomingForm();
      form.parse(req, async (err, fields, files) => {
        if (err) return res.status(400).json({ error: 'invalid form' });
        const file = files.file as any;
        if (!file) return res.status(400).json({ error: 'missing file' });

        // Read buffer (for environments where file.path exists)
        const buffer = fs.readFileSync(file.filepath || file.path);
        const image = sharp(buffer);
        const meta = await image.metadata();

        // Example: create a thumbnail and a webp derivative
        const thumbBuffer = await image.resize({ width: 400 }).toBuffer();
        const webpBuffer = await image.toFormat('webp').toBuffer();

        // Upload to Supabase Storage using client
        const bucket = process.env.CATALOG_PHOTO_BUCKET || 'catalog-photos';
        const path = `uploads/${Date.now()}-${file.originalFilename}`;
        const { data: uploadData, error: uploadError } = await sb.storage.from(bucket).upload(path, buffer, { contentType: file.mimetype });
        if (uploadError) return res.status(500).json({ error: uploadError });

        // Register image row
        const imgRow = {
          product_id: fields.product_id || null,
          storage_bucket: bucket,
          storage_path: uploadData.path || path,
          filename: file.originalFilename,
          mime: file.mimetype,
          filesize: file.size,
          width: meta.width,
          height: meta.height,
          variants: JSON.stringify([
            { type: 'thumb', path: uploadData.path + '.thumb.jpg', width: 400 },
            { type: 'webp', path: uploadData.path + '.webp', mime: 'image/webp' }
          ]),
          metadata: JSON.stringify({ source: 'admin_upload' })
        };
        const { data, error: insertError } = await sb.from('images').insert([imgRow]).select().single();
        if (insertError) return res.status(500).json({ error: insertError });

        return res.json({ ok: true, image: data });
      });
      return;
    }

    if (method === 'PUT') {
      // Reorder / update metadata
      const body = req.body;
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'missing id' });
      const { data, error } = await sb.from('images').update(body).eq('id', id).select().single();
      if (error) return res.status(400).json({ error });
      return res.json(data);
    }

    if (method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'missing id' });
      // Delete storage object if exists then remove DB row
      const { data: img } = await sb.from('images').select('*').eq('id', id).single();
      if (img && img.storage_path) {
        const bucket = img.storage_bucket || process.env.CATALOG_PHOTO_BUCKET || 'catalog-photos';
        await sb.storage.from(bucket).remove([img.storage_path]).catch(() => null);
      }
      const { error } = await sb.from('images').delete().eq('id', id);
      if (error) return res.status(400).json({ error });
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
}
