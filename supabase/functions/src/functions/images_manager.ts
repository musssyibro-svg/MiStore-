// supabase/functions/src/functions/images_manager.ts
import { sb } from '../utils/supabaseClient';
import formidable from 'formidable';
import fs from 'fs';
import sharp from 'sharp';
import { verifyAdminToken } from '../utils/auth';

export const config = { api: { bodyParser: false } };

async function uploadToStorage(bucket, path, buffer, contentType){
  const { data, error } = await sb.storage.from(bucket).upload(path, buffer, { contentType, upsert: true });
  if(error) throw error;
  return data;
}

async function ensureVariants(buffer, originalName){
  const img = sharp(buffer);
  const meta = await img.metadata();
  const thumbBuf = await img.resize({ width: 400 }).jpeg({ quality: 78 }).toBuffer();
  const webpBuf = await img.toFormat('webp', { quality: 78 }).toBuffer();
  const compressedBuf = await img.jpeg({ quality: 84 }).toBuffer();
  return { meta, variants:[{name:'thumb.jpg', buf:thumbBuf, ct:'image/jpeg'},{name:'webp.webp', buf:webpBuf, ct:'image/webp'},{name:'compressed.jpg', buf:compressedBuf, ct:'image/jpeg'}] };
}

// For non-image files (video/3d), create a generic SVG thumbnail converted to PNG
async function generatePlaceholderThumb(filename){
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'><rect width='100%' height='100%' fill='#111'/><text x='50%' y='50%' fill='#fff' font-size='40' font-family='Arial' dominant-baseline='middle' text-anchor='middle'>${escapeXml(filename)}</text></svg>`;
  const buf = Buffer.from(svg);
  const png = await sharp(buf).png().toBuffer();
  return png;
}

function escapeXml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

export default async function handler(req,res){
  try{
    const method = req.method;
    if(method === 'GET'){
      const { product_id, collection_id, limit=200 } = req.query;
      let q = sb.from('images').select('*').order('position');
      if(product_id) q = q.eq('product_id', product_id);
      if(collection_id) q = q.eq('collection_id', collection_id);
      const { data, error } = await q.limit(Number(limit));
      if(error) return res.status(500).json({ error });
      return res.json(data);
    }

    // Mutations require admin
    try{ verifyAdminToken(req.headers.authorization || ''); }catch(e){ return res.status(401).json({ error:'unauthorized' }); }

    if(method === 'POST'){
      const form = new formidable.IncomingForm();
      form.parse(req, async (err, fields, files) => {
        if(err) return res.status(400).json({ error:'invalid form' });
        const fls = files.files || files.file || files[Object.keys(files)[0]];
        const arr = Array.isArray(fls) ? fls : [fls];
        const bucket = process.env.CATALOG_PHOTO_BUCKET || 'catalog-photos';
        const basePath = fields.basePath || 'uploads';
        const out = [];
        for(const f of arr){
          const buffer = fs.readFileSync(f.filepath || f.path);
          const mime = f.mimetype || 'application/octet-stream';
          const isImage = /^image\//.test(mime);
          let variants=[];
          let meta={ width:null, height:null };
          if(isImage){
            const r = await ensureVariants(buffer, f.originalFilename);
            meta = r.meta; variants = r.variants;
          } else {
            // video or model: generate placeholder thumb
            const thumb = await generatePlaceholderThumb(f.originalFilename);
            variants = [{ name:'thumb.png', buf:thumb, ct:'image/png' }];
          }

          const timestamp = Date.now();
          const origPath = `${basePath}/${timestamp}-${sanitizeFilename(f.originalFilename)}`;
          await uploadToStorage(bucket, origPath, buffer, mime);
          const vmeta = [];
          for(const v of variants){
            const pname = `${basePath}/${timestamp}-${v.name}`;
            await uploadToStorage(bucket, pname, v.buf, v.ct);
            vmeta.push({ type:v.name, path:pname, content_type:v.ct });
          }

          const row = {
            product_id: fields.product_id || null,
            collection_id: fields.collection_id || null,
            storage_bucket: bucket,
            storage_path: origPath,
            filename: f.originalFilename,
            mime: mime,
            filesize: f.size,
            width: meta.width || null,
            height: meta.height || null,
            variants: vmeta,
            metadata: JSON.stringify({ source:'admin_upload', uploader: fields.uploader || null }),
            position: Number(fields.position || 0)
          };
          const { data, error } = await sb.from('images').insert([row]).select().single();
          if(error) return res.status(500).json({ error });
          out.push(data);
        }
        return res.json({ ok:true, images: out });
      });
      return;
    }

    if(method === 'PUT'){
      const { id, action } = req.query;
      if(!id) return res.status(400).json({ error:'missing id' });
      if(action === 'crop'){
        // expect JSON body with { crop: { left, top, width, height }, outputFormat }
        const body = await getJsonBody(req);
        if(!body || !body.crop) return res.status(400).json({ error:'missing crop' });
        const { data: imgRow } = await sb.from('images').select('*').eq('id', id).single();
        if(!imgRow) return res.status(404).json({ error:'not found' });
        const bucket = imgRow.storage_bucket || process.env.CATALOG_PHOTO_BUCKET || 'catalog-photos';
        // download original
        const download = await sb.storage.from(bucket).download(imgRow.storage_path).catch(()=>null);
        if(!download) return res.status(500).json({ error:'failed to download original' });
        const buffer = Buffer.from(await download.arrayBuffer());
        const img = sharp(buffer);
        const crop = body.crop; // left, top, width, height (pixels)
        const cropped = await img.extract({ left: Math.max(0, Math.floor(crop.left)), top: Math.max(0, Math.floor(crop.top)), width: Math.max(1, Math.floor(crop.width)), height: Math.max(1, Math.floor(crop.height)) }).toBuffer();
        // regenerate variants
        const r = await ensureVariants(cropped, imgRow.filename);
        const timestamp = Date.now();
        const origPath = imgRow.storage_path.replace(/(\/[^/]+$)/, `/cropped-${timestamp}$1`);
        await uploadToStorage(bucket, origPath, cropped, 'image/jpeg');
        const vmeta = [];
        for(const v of r.variants){ const pname = origPath + '.' + v.name; await uploadToStorage(bucket, pname, v.buf, v.ct); vmeta.push({ type:v.name, path:pname, content_type:v.ct }); }
        const updates = { storage_path: origPath, variants: vmeta, width: r.meta.width || null, height: r.meta.height || null, updated_at: new Date().toISOString() };
        const { data, error } = await sb.from('images').update(updates).eq('id', id).select().single();
        if(error) return res.status(500).json({ error });
        return res.json(data);
      }

      if(action === 'replace'){
        // multipart with new file, replace original and regenerate variants
        const form = new formidable.IncomingForm();
        form.parse(req, async (err, fields, files) => {
          if(err) return res.status(400).json({ error:'invalid form' });
          const f = files.file || files.files || files[Object.keys(files)[0]];
          if(!f) return res.status(400).json({ error:'missing file' });
          const buffer = fs.readFileSync(f.filepath || f.path);
          const mime = f.mimetype || 'application/octet-stream';
          const { data: imgRow } = await sb.from('images').select('*').eq('id', id).single();
          if(!imgRow) return res.status(404).json({ error:'not found' });
          const bucket = imgRow.storage_bucket || process.env.CATALOG_PHOTO_BUCKET || 'catalog-photos';
          const isImage = /^image\//.test(mime);
          let variants=[];
          let meta={};
          if(isImage){ const r = await ensureVariants(buffer, f.originalFilename); meta = r.meta; variants = r.variants; }
          else { const thumb = await generatePlaceholderThumb(f.originalFilename); variants = [{ name:'thumb.png', buf:thumb, ct:'image/png' }]; }
          const timestamp = Date.now();
          const origPath = imgRow.storage_path.replace(/(\/[^/]+$)/, `/replaced-${timestamp}$1`);
          await uploadToStorage(bucket, origPath, buffer, mime);
          const vmeta=[];
          for(const v of variants){ const pname = origPath + '.' + v.name; await uploadToStorage(bucket, pname, v.buf, v.ct); vmeta.push({ type:v.name, path:pname, content_type:v.ct }); }
          const updates = { storage_path: origPath, filename: f.originalFilename, mime, filesize: f.size, variants: vmeta, width: meta.width||null, height: meta.height||null, updated_at: new Date().toISOString() };
          const { data, error } = await sb.from('images').update(updates).eq('id', id).select().single();
          if(error) return res.status(500).json({ error });
          return res.json(data);
        });
        return;
      }

      // default: metadata update (assign product/variant/position)
      const body = await getJsonBody(req);
      const payload = {};
      if(body.product_id !== undefined) payload.product_id = body.product_id;
      if(body.collection_id !== undefined) payload.collection_id = body.collection_id;
      if(body.position !== undefined) payload.position = Number(body.position);
      if(body.metadata !== undefined) payload.metadata = body.metadata;
      if(body.variant_id !== undefined) payload.metadata = Object.assign({}, body.metadata || {}, { variant_id: body.variant_id });
      const { data, error } = await sb.from('images').update(payload).eq('id', id).select().single();
      if(error) return res.status(400).json({ error });
      return res.json(data);
    }

    if(method === 'DELETE'){
      const { id } = req.query; if(!id) return res.status(400).json({ error:'missing id' });
      const { data: img } = await sb.from('images').select('*').eq('id', id).single();
      if(img && img.storage_path){ const bucket = img.storage_bucket || process.env.CATALOG_PHOTO_BUCKET || 'catalog-photos'; const paths = [img.storage_path]; if(Array.isArray(img.variants)) img.variants.forEach(v=>paths.push(v.path)); await sb.storage.from(bucket).remove(paths).catch(()=>null); }
      const { error } = await sb.from('images').delete().eq('id', id);
      if(error) return res.status(400).json({ error });
      return res.json({ ok:true });
    }

    res.status(405).json({ error:'method not allowed' });
  }catch(err){ console.error(err); res.status(500).json({ error: String(err && err.message) || 'server error' }); }
}

async function getJsonBody(req){ return new Promise((resolve,reject)=>{ let s=''; req.on('data',c=>s+=c); req.on('end',()=>{ try{ resolve(s?JSON.parse(s):{}); }catch(e){ reject(e); } }); req.on('error',reject); }); }

function sanitizeFilename(name){ return String(name).replace(/[^a-zA-Z0-9._-]/g,'_'); }
