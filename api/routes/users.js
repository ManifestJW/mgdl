import { Router } from 'express';
import { getDatabase, serializeRow, serializeRows } from '../db/database.js';

const router = Router();

// GET /api/users - Get all users
router.get('/', (req, res) => {
    try {
        const db = getDatabase();
        const users = db.prepare('SELECT * FROM users ORDER BY name ASC').all();
        res.json(serializeRows(users));
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// GET /api/users/:name - Get user with their records and stats
router.get('/:name', (req, res) => {
    try {
        const db = getDatabase();
        const user = db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').get(req.params.name);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get verified levels
        const verified = db.prepare(`
            SELECT l.id, l.name, l.list_position, l.verification as link
            FROM levels l
            WHERE l.verifier = ? COLLATE NOCASE AND l.benchmark = 0 AND l.list_position IS NOT NULL
            ORDER BY l.list_position ASC
        `).get(user.name) || [];
        const verifiedLevels = db.prepare(`
            SELECT l.id, l.name, l.list_position, l.verification as link
            FROM levels l
            WHERE l.verifier = ? COLLATE NOCASE AND l.benchmark = 0 AND l.list_position IS NOT NULL
            ORDER BY l.list_position ASC
        `).all(user.name);

        // Get completed records (100%)
        const completed = db.prepare(`
            SELECT r.*, l.name as level_name, l.list_position
            FROM records r
            JOIN levels l ON r.level_id = l.id
            WHERE r.user_name = ? COLLATE NOCASE AND r.status = 'approved' AND r.percent = 100
            ORDER BY l.list_position ASC
        `).all(user.name);

        // Get progress records (< 100%)
        const progressed = db.prepare(`
            SELECT r.*, l.name as level_name, l.list_position
            FROM records r
            JOIN levels l ON r.level_id = l.id
            WHERE r.user_name = ? COLLATE NOCASE AND r.status = 'approved' AND r.percent < 100
            ORDER BY l.list_position ASC
        `).all(user.name);

        res.json({
            ...serializeRow(user),
            verified: serializeRows(verifiedLevels),
            completed: serializeRows(completed),
            progressed: serializeRows(progressed)
        });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// GET /api/users/search/:query - Search users by name
router.get('/search/:query', (req, res) => {
    try {
        const db = getDatabase();
        const users = db.prepare(
            'SELECT * FROM users WHERE name LIKE ? ORDER BY name ASC'
        ).all(`%${req.params.query}%`);
        res.json(serializeRows(users));
    } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).json({ error: 'Failed to search users' });
    }
});

export default router;