import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { uploadToS3, getLastImageNumber } from '../utils/s3Client.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload', upload.single('image'), async (req, res) => {
    try {
        const { path } = req.body; // "2030/event"
        const buffer = req.file.buffer;

        const prefix = `preview/${path}/`;
        const nextNumber = (await getLastImageNumber(prefix)) + 1;
        const filename = `${nextNumber}.jpg`;

        const previewBuffer = await sharp(buffer)
            .resize(480, 480, { fit: 'inside' })
            .jpeg({ quality: 40 })
            .toBuffer();

        const originalKey = `original_photo/${path}/${filename}`;
        const previewKey = `preview/${path}/${filename}`;

        await Promise.all([
            uploadToS3(buffer, originalKey),
            uploadToS3(previewBuffer, previewKey),
        ]);

        res.json({
            success: true,
            filename,
            originalKey,
            previewKey,
        });
    } catch (err) {
        console.error('Ошибка при загрузке изображения:', err);
        res.status(500).json({ error: 'Upload failed' });
    }
});

export default router;
