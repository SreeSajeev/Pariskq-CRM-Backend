import { supabase } from '../supabaseClient.js';

/**
 * Backend authentication middleware
 * Verifies Supabase JWT sent from frontend
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const token = authHeader.replace('Bearer ', '');

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Attach verified user to request
  req.user = data.user;

  next();
}
