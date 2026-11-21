import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';

const distDir = resolve(process.cwd(), 'dist');
const iconsDir = resolve(distDir, 'icons');
mkdirSync(iconsDir, { recursive: true });

// Minimal pure-Node PNG encoder for crisp Trailmind graph-node brand icons
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function generateIconPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.44;
  const nodes = [
    { x: size * 0.32, y: size * 0.36, r: size * 0.11 },
    { x: size * 0.68, y: size * 0.34, r: size * 0.09 },
    { x: size * 0.5, y: size * 0.67, r: size * 0.12 },
  ];

  const distToSegment = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const idx = rowStart + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);

      if (dist > radius + 0.5) {
        raw[idx] = 0;
        raw[idx + 1] = 0;
        raw[idx + 2] = 0;
        raw[idx + 3] = 0;
        continue;
      }

      // Deep indigo background (#1e3a8a -> #0f766e subtle diagonal gradient)
      const mix = (x + y) / (size * 2);
      let r = Math.round(29 + (15 - 29) * mix);
      let g = Math.round(78 + (118 - 78) * mix);
      let b = Math.round(216 + (110 - 216) * mix);
      let a = dist > radius - 0.5 ? Math.round((radius + 0.5 - dist) * 255) : 255;

      // Connecting edges
      const lineWidth = Math.max(1, size * 0.055);
      const onEdge =
        distToSegment(x, y, nodes[0].x, nodes[0].y, nodes[1].x, nodes[1].y) <= lineWidth ||
        distToSegment(x, y, nodes[0].x, nodes[0].y, nodes[2].x, nodes[2].y) <= lineWidth ||
        distToSegment(x, y, nodes[1].x, nodes[1].y, nodes[2].x, nodes[2].y) <= lineWidth;

      if (onEdge) {
        r = 186;
        g = 230;
        b = 253;
      }

      // Graph nodes
      for (const node of nodes) {
        if (Math.hypot(x - node.x, y - node.y) <= node.r) {
          r = 255;
          g = 255;
          b = 255;
        }
      }

      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = a;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(iconsDir, `icon-${size}.png`), generateIconPng(size));
}

const manifest = {
  manifest_version: 3,
  name: 'Trailmind',
  short_name: 'Trailmind',
  version: '1.0.0',
  description:
    'Your browsing, remembered. On your device. Turns what you read into a private, searchable knowledge graph powered by Firebase AI Logic hybrid inference.',
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
  action: {
    default_popup: 'popup.html',
    default_title: 'Trailmind — Personal Browsing Memory',
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
    },
  },
  side_panel: {
    default_path: 'sidepanel.html',
  },
  background: {
    service_worker: 'background.js',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['content.js'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  permissions: [
    'history',
    'storage',
    'unlimitedStorage',
    'tabs',
    'tabGroups',
    'sidePanel',
    'offscreen',
    'alarms',
    'notifications',
    'scripting',
    'bookmarks',
    'idle',
  ],
  optional_host_permissions: ['https://*/*', 'http://*/*', 'https://api.notion.com/*'],
  omnibox: {
    keyword: 'tm',
  },
  commands: {
    'open-search-overlay': {
      suggested_key: {
        default: 'Alt+M',
        mac: 'Alt+M',
      },
      description: 'Ask your Trailmind memory from any page',
    },
    'open-side-panel': {
      suggested_key: {
        default: 'Alt+G',
        mac: 'Alt+G',
      },
      description: 'Open Trailmind Knowledge Graph side panel',
    },
    'capture-highlight': {
      suggested_key: {
        default: 'Alt+H',
        mac: 'Alt+H',
      },
      description: 'Save selected text as a highlight fact',
    },
  },
  sandbox: {
    pages: ['snapshot.html'],
  },
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://firebaseinstallations.googleapis.com https://firebaseremoteconfig.googleapis.com https://firebaseappcheck.googleapis.com https://content-firebaseappcheck.googleapis.com https://firebasevertexai.googleapis.com https://generativelanguage.googleapis.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://api.notion.com https://huggingface.co https://*.huggingface.co https://hf.co https://*.hf.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co;",
    sandbox: "sandbox allow-scripts; script-src 'self'; object-src 'none';",
  },
  minimum_chrome_version: '139',
};

writeFileSync(resolve(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Generated dist/manifest.json and dist/icons/*');
