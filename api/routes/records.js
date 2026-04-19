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

// GET /api/records - Get all records (optionally filter by status)
router.get('/', (req, res) => {
    try {
        const db = getDatabase();
        const { status, level_id, user_name } = req.query;

        let query = `
            SELECT r.*, l.name as level_name, l.list_position
            FROM records r
            JOIN levels l ON r.level_id = l.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ' AND r.status = ?';
            params.push(status);
        }
        if (level_id) {
            query += ' AND r.level_id = ?';
            params.push(level_id);
        }
        if (user_name) {
            query += ' AND r.user_name = ?';
            params.push(user_name);
        }

        query += ' ORDER BY r.submitted_at DESC';

        const records = db.prepare(query).all(...params);
        res.json(serializeRows(records));
    } catch (error) {
        console.error('Error fetching records:', error);
        res.status(500).json({ error: 'Failed to fetch records' });
    }
});

// GET /api/records/pending - Get pending records for review
router.get('/pending', (req, res) => {
    try {
        const db = getDatabase();
        const records = db.prepare(`
            SELECT r.*, l.name as level_name, l.list_position, l.percent_to_qualify
            FROM records r
            JOIN levels l ON r.level_id = l.id
            WHERE r.status = 'pending'
            ORDER BY r.submitted_at ASC
        `).all();

        res.json(serializeRows(records));
    } catch (error) {
        console.error('Error fetching pending records:', error);
        res.status(500).json({ error: 'Failed to fetch pending records' });
    }
});

// GET /api/records/:id - Get single record
router.get('/:id', (req, res) => {
    try {
        const db = getDatabase();
        const record = db.prepare(`
            SELECT r.*, l.name as level_name
            FROM records r
            JOIN levels l ON r.level_id = l.id
            WHERE r.id = ?
        `).get(req.params.id);

        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        res.json(serializeRow(record));
    } catch (error) {
        console.error('Error fetching record:', error);
        res.status(500).json({ error: 'Failed to fetch record' });
    }
});

// POST /api/records - Submit new record (default: pending)
router.post('/', (req, res) => {
    try {
        const db = getDatabase();
        const { level_id, user_name, percent, link, mobile } = req.body;

        if (!level_id || !user_name || !percent || !link) {
            return res.status(400).json({ error: 'Missing required fields: level_id, user_name, percent, link' });
        }

        // Verify level exists
        const level = db.prepare('SELECT id, percent_to_qualify FROM levels WHERE id = ?').get(level_id);
        if (!level) {
            return res.status(404).json({ error: 'Level not found' });
        }

        // Check if percent meets minimum requirement
        if (percent < level.percent_to_qualify) {
            return res.status(400).json({ error: `Percent must be at least ${level.percent_to_qualify}%` });
        }

        // Check for duplicate record
        const existing = db.prepare(
            'SELECT id FROM records WHERE level_id = ? AND user_name = ? AND percent >= ?'
        ).get(level_id, user_name, percent);
        if (existing) {
            return res.status(409).json({ error: 'A record with equal or higher percent already exists for this user on this level' });
        }

        const result = db.prepare(`
            INSERT INTO records (level_id, user_name, percent, link, mobile, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
        `).run(level_id, user_name, percent, link, mobile ? 1 : 0);

        res.status(201).json({ 
            id: result.lastInsertRowid, 
            message: 'Record submitted successfully. Awaiting review.',
            status: 'pending'
        });
    } catch (error) {
        console.error('Error submitting record:', error);
        res.status(500).json({ error: 'Failed to submit record' });
    }
});

// PUT /api/records/:id/approve - Approve a record
router.put('/:id/approve', requireAuth, (req, res) => {
    try {
        const db = getDatabase();
        const record = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);

        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        if (record.status === 'approved') {
            return res.status(400).json({ error: 'Record is already approved' });
        }

        db.prepare("UPDATE records SET status = 'approved' WHERE id = ?").run(req.params.id);
        res.json({ message: 'Record approved successfully' });
    } catch (error) {
        console.error('Error approving record:', error);
        res.status(500).json({ error: 'Failed to approve record' });
    }
});

// PUT /api/records/:id/reject - Reject a record
router.put('/:id/reject', requireAuth, (req, res) => {
    try {
        const db = getDatabase();
        const { reason } = req.body;
        const record = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);

        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        db.prepare("UPDATE records SET status = 'rejected' WHERE id = ?").run(req.params.id);
        res.json({ message: 'Record rejected', reason: reason || null });
    } catch (error) {
        console.error('Error rejecting record:', error);
        res.status(500).json({ error: 'Failed to reject record' });
    }
});

// DELETE /api/records/:id - Delete record
router.delete('/:id', requireAuth, (req, res) => {
    try {
        const db = getDatabase();
        const result = db.prepare('DELETE FROM records WHERE id = ?').run(req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Record not found' });
        }

        res.json({ message: 'Record deleted successfully' });
    } catch (error) {
        console.error('Error deleting record:', error);
        res.status(500).json({ error: 'Failed to delete record' });
    }
});

export default router;