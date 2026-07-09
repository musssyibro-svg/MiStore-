// supabase/functions/src/functions/product_media.ts
import { sb } from '../utils/supabaseClient';
import { verifyAdminToken } from '../utils/auth';

export default async function handler(req,res){
  try{
    const method = req.method;
    if(method === 'GET'){
      const { product_id, limit=200 } = req.query;
      let q = sb.from('product_media').select('*').order('position');
      if(product_id) q = q.eq('product_id', product_id);
      const { data, error } = await q.limit(Number(limit));
      if(error) return res.status(500).json({ error });
      return res.json(data);
    }

    try{ verifyAdminToken(req.headers.authorization || ''); }catch(e){ return res.status(401).json({ error:'unauthorized' }); }

    if(method === 'POST'){
      const payload = req.body; const { data, error } = await sb.from('product_media').insert([payload]).select().single(); if(error) return res.status(400).json({ error }); return res.json(data);
    }
    if(method === 'PUT'){
      const { id } = req.query; if(!id) return res.status(400).json({ error:'missing id' }); const payload = req.body; const { data, error } = await sb.from('product_media').update(payload).eq('id', id).select().single(); if(error) return res.status(400).json({ error }); return res.json(data);
    }
    if(method === 'DELETE'){
      const { id } = req.query; if(!id) return res.status(400).json({ error:'missing id' }); const { error } = await sb.from('product_media').delete().eq('id', id); if(error) return res.status(400).json({ error }); return res.json({ ok:true });
    }

    res.status(405).json({ error:'method not allowed' });
  }catch(err){ console.error(err); res.status(500).json({ error:'server error' }); }
}
