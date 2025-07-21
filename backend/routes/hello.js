// check work
import express from 'express'
import { logAction } from '../utils/logger.js'

const router = express.Router()

router.get('/hello', async (req, res) => {
    res.json({ message: 'Hello from backend!' })
    await logAction(req, '👋 API Hello')
})

export default router