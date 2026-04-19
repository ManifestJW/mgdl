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

// GET /api/levels - Get all levels ordered by list position
router.get('/', (req, res) => {
    try {
        const db = getDatabase();
        const levels = db.prepare(`
            SELECT l.*,
                   (SELECT COUNT(*) FROM records r WHERE r.level_id = l.id AND r.status = 'approved') as record_count
            FROM levels l
            ORDER BY 
                CASE WHEN l.list_position IS NULL THEN 1 ELSE 0 END,
                l.list_position ASC
        `).all();

        res.json(serializeRows(levels));
    } catch (error) {
        console.error('Error fetching levels:', error);
        res.status(500).json({ error: 'Failed to fetch levels' });
    }
});

// GET /api/levels/:id - Get single level with records and creators
router.get('/:id', (req, res) => {
    try {
        const db = getDatabase();
        const level = db.prepare('SELECT * FROM levels WHERE id = ?').get(req.params.id);

        if (!level) {
            return res.status(404).json({ error: 'Level not found' });
        }

        // Get creators
        const creators = db.prepare('SELECT creator_name FROM level_creators WHERE level_id = ?').all(req.params.id);
        
        // Get records
        const records = db.prepare(`
            SELECT * FROM records 
            WHERE level_id = ? AND status = 'approved'
            ORDER BY percent DESC
        `).all(req.params.id);

        // Get packs
        const packs = db.prepare(`
            SELECT p.* FROM packs p
            JOIN pack_levels pl ON p.id = pl.pack_id
            WHERE pl.level_id = ?
        `).all(req.params.id);

        res.json({
            ...serializeRow(level),
            creators: creators.map(c => c.creator_name),
            records: serializeRows(records),
            packs
        });
    } catch (error) {
        console.error('Error fetching level:', error);
        res.status(500).json({ error: 'Failed to fetch level' });
    }
});

// POST /api/levels - Create new level
router.post('/', requireAuth, (req, res) => {
    try {
        const db = getDatabase();
        const { gd_id, name, author, verifier, verification, percent_to_qualify, password, benchmark, creators } = req.body;

        if (!name || !author || !verifier || !verification) {
            return res.status(400).json({ error: 'Missing required fields: name, author, verifier, verification' });
        }

        // Get max list position
        const maxPos = db.prepare('SELECT MAX(list_position) as max_pos FROM levels').get();
        const newPosition = (maxPos.max_pos || 0) + 1;

        const result = db.prepare(`
            INSERT INTO levels (gd_id, name, author, verifier, verification, percent_to_qualify, password, benchmark, list_position)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            gd_id || 0,
            name,
            author,
            verifier,
            verification,
            percent_to_qualify || 100,
            password || 'Free to Copy',
            benchmark ? 1 : 0,
            benchmark ? null : newPosition
        );

        // Add creators if provided
        if (creators && Array.isArray(creators)) {
            const insertCreator = db.prepare('INSERT OR IGNORE INTO level_creators (level_id, creator_name) VALUES (?, ?)');
            for (const creator of creators) {
                insertCreator.run(result.lastInsertRowid, creator);
            }
        }

        res.status(201).json({ id: result.lastInsertRowid, message: 'Level created successfully' });
    } catch (error) {
        console.error('Error creating level:', error);
        if (error.message.includes('UNIQUE constraint failed')) {
            res.status(409).json({ error: 'Level with this name already exists' });
        } else {
            res.status(500).json({ error: 'Failed to create level' });
        }
    }
});

// PUT /api/levels/:id - Update level
router.put('/:id', requireAuth, (req, res) => {
    try {
        const db = getDatabase();
        const { gd_id, name, author, verifier, verification, percent_to_qualify, password, benchmark, creators } = req.body;

        const existing = db.prepare('SELECT id FROM levels WHERE id = ?').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Level not found' });
        }

        db.prepare(`
            UPDATE levels 
            SET gd_id = COALESCE(?, gd_id),
                name = COALESCE(?, name),
                author = COALESCE(?, author),
                verifier = COALESCE(?, verifier),
                verification = COALESCE(?, verification),
                percent_to_qualify = COALESCE(?, percent_to_qualify),
                password = COALESCE(?, password),
                benchmark = COALESCE(?, benchmark),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            gd_id,
            name,
            author,
            verifier,
            verification,
            percent_to_qualify,
            password,
            benchmark !== undefined ? (benchmark ? 1 : 0) : null,
            req.params.id
        );

        // Update creators if provided
        if (creators && Array.isArray(creators)) {
            db.prepare('DELETE FROM level_creators WHERE level_id = ?').run(req.params.id);
            const insertCreator = db.prepare('INSERT OR IGNORE INTO level_creators (level_id, creator_name) VALUES (?, ?)');
            for (const creator of creators) {
                insertCreator.run(req.params.id, creator);
            }
        }

        res.json({ message: 'Level updated successfully' });
    } catch (error) {
        console.error('Error updating level:', error);
        res.status(500).json({ error: 'Failed to update level' });
    }
});

// DELETE /api/levels/:id - Delete level
router.delete('/:id', requireAuth, (req, res) => {
    try {
        const db = getDatabase();
        const result = db.prepare('DELETE FROM levels WHERE id = ?').run(req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Level not found' });
        }

        res.json({ message: 'Level deleted successfully' });
    } catch (error) {
        console.error('Error deleting level:', error);
        res.status(500).json({ error: 'Failed to delete level' });
    }
});

// PUT /api/levels/reorder - Reorder levels
router.put('/reorder', requireAuth, (req, res) => {
    try {
        const db = getDatabase();
        const { order } = req.body; // Array of level IDs in new order

        if (!Array.isArray(order)) {
            return res.status(400).json({ error: 'Order must be an array of level IDs' });
        }

        const updatePosition = db.prepare('UPDATE levels SET list_position = ? WHERE id = ?');
        const transaction = db.transaction((orderIds) => {
            orderIds.forEach((id, index) => {
                updatePosition.run(index + 1, id);
            });
        });

        transaction(order);
        res.json({ message: 'Levels reordered successfully' });
    } catch (error) {
        console.error('Error reordering levels:', error);
        res.status(500).json({ error: 'Failed to reorder levels' });
    }
});

export default router;