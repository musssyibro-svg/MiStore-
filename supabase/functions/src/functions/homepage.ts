// src/functions/homepage.ts
import { sb } from '../utils/supabaseClient';

export default async function handler(req, res) {
  try {
    const method = req.method;
    if (method === 'GET') {
      const { data, error } = await sb.from('homepage_blocks').select('*').order('position');
      if (error) return res.status(500).json({ error });
      return res.json(data);
    }

    if (method === 'POST') {
      const payload = req.body;
      const { data, error } = await sb.from('homepage_blocks').insert([payload]).select().single();
      if (error) return res.status(400).json({ error });
      return res.json(data);
    }

    if (method === 'PUT') {
      const { id } = req.query;
      const payload = req.body;
      if (!id) return res.status(400).json({ error: 'missing id' });
      const { data, error } = await sb.from('homepage_blocks').update(payload).eq('id', id).select().single();
      if (error) return res.status(400).json({ error });
      return res.json(data);
    }

    if (method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'missing id' });
      const { error } = await sb.from('homepage_blocks').delete().eq('id', id);
      if (error) return res.status(400).json({ error });
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
}
