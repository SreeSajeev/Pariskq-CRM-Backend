import { supabase } from '../supabaseClient.js';

/**
 * Backend authentication middleware
 * Verifies Supabase JWT sent from frontend.
 * Loads app user from public.users and denies access if is_active === false.
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

  req.user = data.user;

  const { data: appUser, error: appError } = await supabase
    .from('users')
    .select('id, role, is_active, active')
    .eq('auth_id', data.user.id)
    .maybeSingle();

  if (!appError && appUser) {
    const isActive = appUser.is_active !== false && appUser.is_active !== null;
    if (!isActive) {
      return res.status(403).json({
        error: 'Account deactivated. Contact administrator.',
      });
    }
    req.appUser = appUser;
  }

  next();
}
