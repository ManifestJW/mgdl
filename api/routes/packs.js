import { Router } from 'express';
import { getDatabase, serializeRow, serializeRows } from '../db/database.js';

const router = Router();

// Middleware to check API key for write operations
function requireAuth(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== req.apiKey) {
        return res.status(401).json({ error: 'Invalid or missing API key' });
    }
    next();
}

// GET /api/packs - Get all packs
router.get('/', (req, res) => {
    try {
        const db = getDatabase();
        const packs = db.prepare(`
            SELECT p.*, pt.name as tier_name, pt.color as tier_color,
                   (SELECT COUNT(*) FROM pack_levels pl WHERE pl.pack_id = p.id) as level_count
            FROM packs p
            LEFT JOIN pack_tiers pt ON p.tier_id = pt.id
            ORDER BY p.name ASC
        `).all();
        res.json(serializeRows(packs));
    } catch (error) {
        console.error('Error fetching packs:', error);
        res.status(500).json({ error: 'Failed to fetch packs' });
    }
});

// GET /api/packs/:id - Get pack with its levels
router.get('/:id', (req, res) => {
    try {
        const db = getDatabase();
        const pack = db.prepare(`
            SELECT p.*, pt.name as tier_name, pt.color as tier_color
            FROM packs p
            LEFT JOIN pack_tiers pt ON p.tier_id = pt.id
            WHERE p.id = ?
        `).get(req.params.id);

        if (!pack) {
            return res.status(404).json({ error: 'Pack not found' });
        }

        // Get levels in pack
        const levels = db.prepare(`
            SELECT l.* FROM levels l
            JOIN pack_levels pl ON l.id = pl.level_id
            WHERE pl.pack_id = ?
            ORDER BY l.list_position ASC
        `).all(req.params.id);

        res.json({
            ...serializeRow(pack),
            levels: serializeRows(levels)
        });
    } catch (error) {
        console.error('Error fetching pack:', error);
        res.status(500).json({ error: 'Failed to fetch pack' });
    }
});

// POST /api/packs - Create new pack
router.post('/', requireAuth, (req, res) => {
    try {
        const db = getDatabase();
        const { name, colour, tier_id, levels } = req.body;

        if (!name || !colour) {
            return res.status(400).json({ error: 'Missing required fields: name, colour' });
        }

        const result = db.prepare(`
            INSERT INTO packs (name, colour, tier_id)
            VALUES (?, ?, ?)
        `).run(name, colour, tier_id || null);

        // Add levels if provided
        if (levels && Array.isArray(levels)) {
            const insertLevel = db.prepare('INSERT OR IGNORE INTO pack_levels (pack_id, level_id) VALUES (?, ?)');
            for (const levelId of levels) {
                insertLevel.run(result.lastInsertRowid, levelId);
            }
        }

        res.status(201).json({ id: result.lastInsertRowid, message: 'Pack created successfully' });
    } catch (error) {
        console.error('Error creating pack:', error);
        if (error.message.includes('UNIQUE constraint failed')) {
            res.status(409).json({ error: 'Pack with this name already exists' });
        } else {
            res.status(500).json({ error: 'Failed to create pack' });
        }
    }
});

// PUT /api/packs/:id - Update pack
router.put('/:id', requireAuth, (req, res) => {
    try {
        const db = getDatabase();
        const { name, colour, tier_id, levels } = req.body;

        const existing = db.prepare('SELECT id FROM packs WHERE id = ?').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Pack not found' });
        }

        db.prepare(`
            UPDATE packs 
            SET name = COALESCE(?, name),
                colour = COALESCE(?, colour),
                tier_id = COALESCE(?, tier_id)
            WHERE id = ?
        `).run(name, colour, tier_id, req.params.id);

        // Update levels if provided
        if (levels && Array.isArray(levels)) {
            db.prepare('DELETE FROM pack_levels WHERE pack_id = ?').run(req.params.id);
            const insertLevel = db.prepare('INSERT OR IGNORE INTO pack_levels (pack_id, level_id) VALUES (?, ?)');
            for (const levelId of levels) {
                insertLevel.run(req.params.id, levelId);
            }
        }

        res.json({ message: 'Pack updated successfully' });
    } catch (error) {
        console.error('Error updating pack:', error);
        res.status(500).json({ error: 'Failed to update pack' });
    }
});

// DELETE /api/packs/:id - Delete pack
router.delete('/:id', requireAuth, (req, res) => {
    try {
        const db = getDatabase();
        const result = db.prepare('DELETE FROM packs WHERE id = ?').run(req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Pack not found' });
        }

        res.json({ message: 'Pack deleted successfully' });
    } catch (error) {
        console.error('Error deleting pack:', error);
        res.status(500).json({ error: 'Failed to delete pack' });
    }
});

// GET /api/packs/tiers - Get all pack tiers
router.get('/tiers', (req, res) => {
    try {
        const db = getDatabase();
        const tiers = db.prepare('SELECT * FROM pack_tiers ORDER BY name ASC').all();
        res.json(serializeRows(tiers));
    } catch (error) {
        console.error('Error fetching pack tiers:', error);
        res.status(500).json({ error: 'Failed to fetch pack tiers' });
    }
});

export default router;