// check work
import express from 'express';
import { logAction } from '../utils/logger.js';

const router = express.Router();

router.get('/hello', (req, res) => {
    res.json({ message: 'Hello from backend!' });
    logAction(req, '👋 API Hello');
});

export default router;
