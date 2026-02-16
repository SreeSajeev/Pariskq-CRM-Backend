// src/routes/feActions.js
// Backend-authoritative FE token validation routes

import express from "express";
import { validateFeActionToken } from "../controllers/feActionsController.js";

const router = express.Router();

/* =====================================================
   VALIDATE FE ACTION TOKEN
===================================================== */
/*
  GET /fe/action/:token

  Purpose:
  - Validate FE action token
  - Ensure token exists, unused, unexpired
  - Return read-only context to FE frontend

  NEVER:
  - mutate DB
  - accept uploads
*/
router.get("/fe/action/:token", validateFeActionToken);

export default router;
