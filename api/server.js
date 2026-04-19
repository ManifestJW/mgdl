import express from 'express';
import cors from 'cors';
import { initializeDatabase, closeDatabase, getDatabase } from './db/database.js';
import levelsRouter from './routes/levels.js';
import recordsRouter from './routes/records.js';
import usersRouter from './routes/users.js';
import packsRouter from './routes/packs.js';
import editorsRouter from './routes/editors.js';

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'changeme';

// Middleware
app.use(cors());
app.use(express.json());

// Make API key available to routes
app.use((req, res, next) => {
    req.apiKey = API_KEY;
    next();
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/levels', levelsRouter);
app.use('/api/records', recordsRouter);
app.use('/api/users', usersRouter);
app.use('/api/packs', packsRouter);
app.use('/api/editors', editorsRouter);

// Leaderboard endpoint (computed from levels/records)
app.get('/api/leaderboard', (req, res) => {
    try {
        const db = getDatabase();

        // Get all non-benchmark levels ordered by position
        const levels = db.prepare(`
            SELECT l.*, 
                   (SELECT COUNT(*) FROM records r WHERE r.level_id = l.id AND r.status = 'approved') as record_count
            FROM levels l
            WHERE l.benchmark = 0 AND l.list_position IS NOT NULL
            ORDER BY l.list_position ASC
        `).all();

        // Get all approved records
        const records = db.prepare(`
            SELECT r.*, l.name as level_name, l.list_position, l.benchmark
            FROM records r
            JOIN levels l ON r.level_id = l.id
            WHERE r.status = 'approved' AND l.benchmark = 0 AND l.list_position IS NOT NULL
        `).all();

        // Compute leaderboard
        const leaderboard = {};
        const rankedLevelCount = levels.length;

        // Score calculation (simplified - uses position-based scoring)
        levels.forEach((level, index) => {
            const rank = index + 1;
            const levelScore = Math.max(1, Math.round(250 * Math.exp(-3 * Math.pow((rank - 1) / Math.max(1, rankedLevelCount - 1), 0.7))));

            // Add verifier
            const verifierName = level.verifier;
            if (!leaderboard[verifierName]) {
                leaderboard[verifierName] = { verified: [], completed: [], progressed: [], total: 0 };
            }
            leaderboard[verifierName].verified.push({
                level: level.name,
                rank,
                score: levelScore,
                link: level.verification
            });
            leaderboard[verifierName].total += levelScore;

            // Add record holders
            records.filter(r => r.level_id === level.id).forEach(record => {
                const userName = record.user_name;
                if (!leaderboard[userName]) {
                    leaderboard[userName] = { verified: [], completed: [], progressed: [], total: 0 };
                }

                if (record.percent === 100) {
                    leaderboard[userName].completed.push({
                        level: level.name,
                        rank,
                        score: levelScore,
                        link: record.link
                    });
                    leaderboard[userName].total += levelScore;
                } else {
                    const minPercent = level.percent_to_qualify;
                    const scale = 0.1 + 0.4 * ((record.percent - minPercent) / (99 - minPercent));
                    const scaledScore = Math.round(levelScore * Math.min(Math.max(scale, 0.1), 0.5));
                    leaderboard[userName].progressed.push({
                        level: level.name,
                        rank,
                        percent: record.percent,
                        score: scaledScore,
                        link: record.link
                    });
                    leaderboard[userName].total += scaledScore;
                }
            });
        });

        // Convert to array and sort
        const result = Object.entries(leaderboard)
            .map(([user, data]) => ({
                user,
                total: Math.round(data.total * 1000) / 1000,
                verified: data.verified,
                completed: data.completed,
                progressed: data.progressed
            }))
            .sort((a, b) => b.total - a.total);

        res.json(result);
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ error: 'Failed to compute leaderboard' });
    }
});

// Initialize database and start server
initializeDatabase();

app.listen(PORT, () => {
    console.log(`Demonlist API running on http://localhost:${PORT}`);
    console.log(`API Key: ${API_KEY}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    closeDatabase();
    process.exit(0);
});

export default app;