// Tiny Express app used as the demo target. Not installed or run by Litti —
// the sample diffs in ../sample-diffs describe changes against these files.
const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/users/:id', (req, res) => res.json({ id: req.params.id, mfa_enabled: false }));

app.listen(3000, () => console.log('sample app on :3000'));
