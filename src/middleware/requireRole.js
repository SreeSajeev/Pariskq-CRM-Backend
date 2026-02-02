import { supabase } from '../supabaseClient.js';

/**
 * Backend authentication middleware
 * Verifies Supabase JWT sent from frontend
 */
/**
 * Role-based authorization middleware
 */
export function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    const role = req.user?.user_metadata?.role;

    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({
        error: 'Forbidden',
      });
    }

    next();
  };
}
