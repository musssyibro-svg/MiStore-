// supabase/functions/src/functions/collections_items.ts
import { sb } from '../utils/supabaseClient';
import { verifyAdminToken } from '../utils/auth';

export default async function handler(req,res){
  try{
    const method = req.method;
    if(method === 'POST'){
      try{ verifyAdminToken(req.headers.authorization || ''); }catch(e){ return res.status(401).json({ error:'unauthorized' }); }
      const payload = req.body; // collection_id, product_id, position
      const { data, error } = await sb.from('collection_items').insert([payload]).select().single();
      if(error) return res.status(400).json({ error });
      return res.json(data);
    }
    if(method === 'PUT'){
      try{ verifyAdminToken(req.headers.authorization || ''); }catch(e){ return res.status(401).json({ error:'unauthorized' }); }
      const { id } = req.query; if(!id) return res.status(400).json({ error:'missing id' }); const payload = req.body; const { data, error } = await sb.from('collection_items').update(payload).eq('id', id).select().single(); if(error) return res.status(400).json({ error }); return res.json(data);
    }
    if(method === 'DELETE'){
      try{ verifyAdminToken(req.headers.authorization || ''); }catch(e){ return res.status(401).json({ error:'unauthorized' }); }
      const { id } = req.query; if(!id) return res.status(400).json({ error:'missing id' }); const { error } = await sb.from('collection_items').delete().eq('id', id); if(error) return res.status(400).json({ error }); return res.json({ ok:true });
    }
    res.status(405).json({ error:'method not allowed' });
  }catch(err){ console.error(err); res.status(500).json({ error:'server error' }); }
}
