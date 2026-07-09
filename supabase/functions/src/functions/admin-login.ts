// src/functions/admin-login.ts
import { sb } from '../utils/supabaseClient';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

export default async function handler(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'missing credentials' });

    const { data, error } = await sb.from('admin_users').select('*').eq('email', email).limit(1).single();
    if (error || !data) return res.status(401).json({ error: 'invalid credentials' });

    const ok = await bcrypt.compare(password, data.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });

    const token = jwt.sign({ sub: data.id, email: data.email, role: data.role }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token, admin: { id: data.id, email: data.email, display_name: data.display_name, role: data.role } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
}
