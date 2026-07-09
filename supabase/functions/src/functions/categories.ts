// supabase/functions/src/functions/categories.ts
import { sb } from '../utils/supabaseClient';
import { verifyAdminToken } from '../utils/auth';

export default async function handler(req, res){
  try{
    const method = req.method;
    if(method === 'GET'){
      const { limit=100, offset=0, q } = req.query;
      let query = sb.from('categories').select('*').order('name').limit(Number(limit)).offset(Number(offset));
      if(q) query = query.ilike('name', `%${q}%`);
      const { data, error } = await query;
      if(error) return res.status(500).json({ error });
      return res.json(data);
    }

    // Mutations require admin
    try{ verifyAdminToken(req.headers.authorization || ''); }catch(e){ return res.status(401).json({ error:'unauthorized' }); }

    if(method === 'POST'){
      const payload = req.body;
      const { data, error } = await sb.from('categories').insert([payload]).select().single();
      if(error) return res.status(400).json({ error });
      return res.json(data);
    }
    if(method === 'PUT'){
      const { id } = req.query; if(!id) return res.status(400).json({ error:'missing id' });
      const payload = req.body; const { data, error } = await sb.from('categories').update(payload).eq('id', id).select().single();
      if(error) return res.status(400).json({ error });
      return res.json(data);
    }
    if(method === 'DELETE'){
      const { id } = req.query; if(!id) return res.status(400).json({ error:'missing id' });
      const { error } = await sb.from('categories').delete().eq('id', id);
      if(error) return res.status(400).json({ error });
      return res.json({ ok:true });
    }

    res.status(405).json({ error:'method not allowed' });
  }catch(err){ console.error(err); res.status(500).json({ error:'server error' }); }
}
