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

// GET /api/editors - Get all editors grouped by role
router.get('/', (req, res) => {
    try {
        const db = getDatabase();
        const editors = db.prepare('SELECT * FROM editors ORDER BY role, name ASC').all();

        // Group by role
        const grouped = {};
        for (const editor of editors) {
            if (!grouped[editor.role]) {
                grouped[editor.role] = [];
            }
            grouped[editor.role].push(serializeRow(editor));
        }

        // Convert to array format matching original _editors.json structure
        const result = Object.entries(grouped).map(([role, members]) => ({
            role,
            members
        }));

        res.json(result);
    } catch (error) {
        console.error('Error fetching editors:', error);
        res.status(500).json({ error: 'Failed to fetch editors' });
    }
});

// GET /api/editors/:id - Get single editor
router.get('/:id', (req, res) => {
    try {
        const db = getDatabase();
        const editor = db.prepare('SELECT * FROM editors WHERE id = ?').get(req.params.id);

        if (!editor) {
            return res.status(404).json({ error: 'Editor not found' });
        }

        res.json(serializeRow(editor));
    } catch (error) {
        console.error('Error fetching editor:', error);
        res.status(500).json({ error: 'Failed to fetch editor' });
    }
});

// POST /api/editors - Add editor
router.post('/', requireAuth, (req, res) => {
    try {
        const db = getDatabase();
        const { name, link, role } = req.body;

        if (!name || !role) {
            return res.status(400).json({ error: 'Missing required fields: name, role' });
        }

        const validRoles = ['owner', 'coowner', 'admin', 'helper', 'dev', 'trial', 'patreon'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
        }

        const result = db.prepare(`
            INSERT INTO editors (name, link, role)
            VALUES (?, ?, ?)
        `).run(name, link || '', role);

        res.status(201).json({ id: result.lastInsertRowid, message: 'Editor added successfully' });
    } catch (error) {
        console.error('Error adding editor:', error);
        res.status(500).json({ error: 'Failed to add editor' });
    }
});

// PUT /api/editors/:id - Update editor
router.put('/:id', requireAuth, (req, res) => {
    try {
        const db = getDatabase();
        const { name, link, role } = req.body;

        const existing = db.prepare('SELECT id FROM editors WHERE id = ?').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Editor not found' });
        }

        if (role) {
            const validRoles = ['owner', 'coowner', 'admin', 'helper', 'dev', 'trial', 'patreon'];
            if (!validRoles.includes(role)) {
                return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
            }
        }

        db.prepare(`
            UPDATE editors 
            SET name = COALESCE(?, name),
                link = COALESCE(?, link),
                role = COALESCE(?, role)
            WHERE id = ?
        `).run(name, link, role, req.params.id);

        res.json({ message: 'Editor updated successfully' });
    } catch (error) {
        console.error('Error updating editor:', error);
        res.status(500).json({ error: 'Failed to update editor' });
    }
});

// DELETE /api/editors/:id - Remove editor
router.delete('/:id', requireAuth, (req, res) => {
    try {
        const db = getDatabase();
        const result = db.prepare('DELETE FROM editors WHERE id = ?').run(req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Editor not found' });
        }

        res.json({ message: 'Editor removed successfully' });
    } catch (error) {
        console.error('Error removing editor:', error);
        res.status(500).json({ error: 'Failed to remove editor' });
    }
});

export default router;