import express from 'express';
import { supabase } from '../supabaseClient.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';

const router = express.Router();

router.patch(
  '/:id/status',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req, res) => {
    const userId = req.params.id;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active must be a boolean' });
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .update({
          is_active,
          active: is_active,
        })
        .eq('id', userId)
        .select('id, is_active, active')
        .single();

      if (error) {
        return res.status(500).json({ error: error.message });
      }
      if (!data) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

export default router;
