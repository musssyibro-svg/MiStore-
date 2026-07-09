// src/functions/products.ts
import { sb } from '../utils/supabaseClient';

export default async function handler(req, res) {
  try {
    const method = req.method;
    if (method === 'GET') {
      const { id, q, limit=200, offset=0 } = req.query;
      if (id) {
        const { data, error } = await sb.from('products').select('*').eq('id', id).single();
        if (error) return res.status(404).json({ error });
        return res.json(data);
      }
      let query = sb.from('products').select('*,categories(*)').order('name', { ascending: true }).limit(limit).offset(offset);
      if (q) query = query.ilike('name', `%${q}%`);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error });
      return res.json(data);
    }

    if (method === 'POST') { // create
      const payload = req.body;
      const { data, error } = await sb.from('products').insert([payload]).select().single();
      if (error) return res.status(400).json({ error });
      return res.json(data);
    }

    if (method === 'PUT') { // update
      const { id } = req.query;
      const payload = req.body;
      if (!id) return res.status(400).json({ error: 'missing id' });
      const { data, error } = await sb.from('products').update(payload).eq('id', id).select().single();
      if (error) return res.status(400).json({ error });
      return res.json(data);
    }

    if (method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'missing id' });
      const { error } = await sb.from('products').delete().eq('id', id);
      if (error) return res.status(400).json({ error });
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
}
