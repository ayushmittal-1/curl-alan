const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3333;
const API_KEY = 'sk-2546bad4f1654c208c55637bd8d81255';
const API_HOST = 'dashscope-intl.aliyuncs.com';

const SUPABASE_URL = 'https://qjavmntfobozbyzzysze.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqYXZtbnRmb2JvemJ5enp5c3plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzY3ODAsImV4cCI6MjA5MzQ1Mjc4MH0.Ir9Ah2ZTzNb3vQQQIlt86sDbP_rmcttqaGuwG4Mb7TM';
const supabaseServer = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Download a URL (follows redirects) and return a Buffer
function downloadFile(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
        return resolve(downloadFile(res.headers.location, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed with status ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve static files
  if (!req.url.startsWith('/api/')) {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  // Proxy: POST /api/generate → DashScope video synthesis
  if (req.method === 'POST' && req.url === '/api/generate') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const opts = {
        hostname: API_HOST,
        path: '/api/v1/services/aigc/video-generation/video-synthesis',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'X-DashScope-Async': 'enable'
        }
      };

      const proxy = https.request(opts, proxyRes => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      });

      proxy.on('error', err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });

      proxy.write(body);
      proxy.end();
    });
    return;
  }

  // Proxy: POST /api/generate-image → DashScope image generation
  if (req.method === 'POST' && req.url === '/api/generate-image') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { parsed = {}; }
      const model = parsed.model || '';
      // qwen-image models use the multimodal-generation endpoint
      const apiPath = model.startsWith('qwen-image')
        ? '/api/v1/services/aigc/multimodal-generation/generation'
        : '/api/v1/services/aigc/image-generation/generation';

      const isQwen = model.startsWith('qwen-image');
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      };
      if (!isQwen) headers['X-DashScope-Async'] = 'enable';

      const opts = {
        hostname: API_HOST,
        path: apiPath,
        method: 'POST',
        headers
      };

      const proxy = https.request(opts, proxyRes => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      });

      proxy.on('error', err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });

      proxy.write(body);
      proxy.end();
    });
    return;
  }

  // Proxy: GET /api/tasks/:id → DashScope task status
  const taskMatch = req.url.match(/^\/api\/tasks\/(.+)$/);
  if (req.method === 'GET' && taskMatch) {
    const taskId = taskMatch[1];
    const opts = {
      hostname: API_HOST,
      path: `/api/v1/tasks/${taskId}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    };

    const proxy = https.request(opts, proxyRes => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(data);
      });
    });

    proxy.on('error', err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    proxy.end();
    return;
  }

  // POST /api/persist/:id — download media from DashScope and upload to Supabase Storage
  const persistMatch = req.url.match(/^\/api\/persist\/(.+)$/);
  if (req.method === 'POST' && persistMatch) {
    const genId = persistMatch[1];
    try {
      const { data: row, error: fetchErr } = await supabaseServer
        .from('generations')
        .select('*')
        .eq('id', genId)
        .single();

      if (fetchErr || !row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Generation not found' }));
        return;
      }

      if (row.storage_url) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ storage_url: row.storage_url }));
        return;
      }

      if (!row.result_url) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No result_url to persist' }));
        return;
      }

      const ext = row.type === 'video' ? 'mp4' : 'png';
      const storagePath = `${genId}.${ext}`;
      const contentType = row.type === 'video' ? 'video/mp4' : 'image/png';

      const fileBuffer = await downloadFile(row.result_url);

      const { error: uploadErr } = await supabaseServer.storage
        .from('media')
        .upload(storagePath, fileBuffer, { contentType, upsert: true });

      if (uploadErr) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: uploadErr.message }));
        return;
      }

      const { data: publicData } = supabaseServer.storage
        .from('media')
        .getPublicUrl(storagePath);

      const storageUrl = publicData.publicUrl;

      await supabaseServer
        .from('generations')
        .update({ storage_url: storageUrl })
        .eq('id', genId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ storage_url: storageUrl }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  Alan server running at http://localhost:${PORT}\n`);
});
