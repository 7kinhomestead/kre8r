const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3020;
const ROOT = path.join(__dirname, '..');

const MIME = {
    '.html': 'text/html',
    '.js':   'application/javascript',
};

const ROUTES = {
    '/':                          path.join(ROOT, 'public', 'solar-array.html'),
    '/solar-array.html':          path.join(ROOT, 'public', 'solar-array.html'),
    '/libs/three.module.min.js':  path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.min.js'),
    '/libs/three.core.min.js':    path.join(ROOT, 'node_modules', 'three', 'build', 'three.core.min.js'),
    '/libs/OrbitControls.js':     path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'controls', 'OrbitControls.js'),
};

http.createServer((req, res) => {
    const filePath = ROUTES[req.url];
    if (!filePath) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(500);
            res.end('Error reading file');
            return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
        res.end(data);
    });
}).listen(PORT, () => {
    console.log(`Solar array viewer running at http://localhost:${PORT}`);
});
