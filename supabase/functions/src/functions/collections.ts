// supabase/functions/src/functions/collections.ts
import { sb } from '../utils/supabaseClient';
import { verifyAdminToken } from '../utils/auth';

export default async function handler(req, res){
  try{
    const method = req.method;
    if(method === 'GET'){
      const { id, q, limit=200 } = req.query;
      if(id){ const { data, error } = await sb.from('collections').select('*, collection_items(*)').eq('id', id).single(); if(error) return res.status(404).json({ error }); return res.json(data); }
      let query = sb.from('collections').select('*').order('created_at', { ascending:false }).limit(Number(limit));
      if(q) query = query.ilike('title', `%${q}%`);
      const { data, error } = await query; if(error) return res.status(500).json({ error }); return res.json(data);
    }

    // Mutations (admin only)
    try{ verifyAdminToken(req.headers.authorization || ''); }catch(e){ return res.status(401).json({ error:'unauthorized' }); }

    if(method === 'POST'){
      const payload = req.body;
      const { data, error } = await sb.from('collections').insert([payload]).select().single();
      if(error) return res.status(400).json({ error });
      return res.json(data);
    }
    if(method === 'PUT'){
      const { id } = req.query; if(!id) return res.status(400).json({ error:'missing id' });
      const payload = req.body; const { data, error } = await sb.from('collections').update(payload).eq('id', id).select().single();
      if(error) return res.status(400).json({ error });
      return res.json(data);
    }
    if(method === 'DELETE'){
      const { id } = req.query; if(!id) return res.status(400).json({ error:'missing id' });
      const { error } = await sb.from('collections').delete().eq('id', id);
      if(error) return res.status(400).json({ error });
      return res.json({ ok:true });
    }

    res.status(405).json({ error:'method not allowed' });
  }catch(err){ console.error(err); res.status(500).json({ error:'server error' }); }
}
