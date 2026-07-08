/**
 * 相册图片上传工具
 * 启动: node scripts/upload-server.js
 * 访问: http://localhost:3456
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const ALBUMS_DIR = join(ROOT, "public", "images", "albums");
const PORT = 3456;

// ─── 工具函数 ───────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function getContentType(filePath) {
  const ext = extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  return map[ext] || "application/octet-stream";
}

// ─── 相册管理 ───────────────────────────────────────────────
function listAlbums() {
  if (!existsSync(ALBUMS_DIR)) {
    mkdirSync(ALBUMS_DIR, { recursive: true });
  }
  return readdirSync(ALBUMS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const infoPath = join(ALBUMS_DIR, d.name, "info.json");
      let info = { title: d.name, description: "", tags: [] };
      if (existsSync(infoPath)) {
        try { info = JSON.parse(readFileSync(infoPath, "utf-8")); } catch {}
      }
      const photoCount = readdirSync(join(ALBUMS_DIR, d.name)).filter(
        (f) => !f.startsWith(".") && f !== "info.json" && f !== "cover.jpg" && f !== "cover.webp"
      ).length;
      return { id: d.name, ...info, photoCount };
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

function createAlbum(id, info) {
  const albumDir = join(ALBUMS_DIR, id);
  if (existsSync(albumDir)) return false;
  mkdirSync(albumDir, { recursive: true });
  const albumInfo = {
    title: info.title || id,
    description: info.description || "",
    date: info.date || new Date().toISOString().split("T")[0],
    tags: info.tags || [],
  };
  writeFileSync(join(albumDir, "info.json"), JSON.stringify(albumInfo, null, 2), "utf-8");
  return true;
}

function savePhoto(albumId, filename, buffer) {
  const albumDir = join(ALBUMS_DIR, albumId);
  if (!existsSync(albumDir)) return false;

  const ext = extname(filename).toLowerCase();
  const hash = createHash("md5").update(buffer).digest("hex").slice(0, 8);
  const safeName = `${hash}${ext}`;
  const filePath = join(albumDir, safeName);

  writeFileSync(filePath, buffer);

  // 自动生成/更新 cover
  const coverJpg = join(albumDir, "cover.jpg");
  const coverWebp = join(albumDir, "cover.webp");
  if (!existsSync(coverJpg) && !existsSync(coverWebp) && [".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    writeFileSync(coverJpg, buffer);
  }

  return { filename: safeName, path: `/images/albums/${albumId}/${safeName}` };
}

// ─── 解析 multipart ──────────────────────────────────────────
function parseMultipart(buffer, boundary) {
  const boundaryStr = `--${boundary}`;
  const boundaryBuf = Buffer.from(boundaryStr);
  const result = [];
  let pos = buffer.indexOf(boundaryBuf);

  while (pos !== -1) {
    const nextPos = buffer.indexOf(boundaryBuf, pos + boundaryBuf.length);
    if (nextPos === -1) break;
    const section = buffer.slice(pos + boundaryBuf.length, nextPos);
    const headerEnd = section.indexOf("\r\n\r\n");
    if (headerEnd === -1) { pos = nextPos; continue; }

    const headerStr = section.slice(0, headerEnd).toString();

    // 跳过非文件字段
    if (!headerStr.includes("filename=")) { pos = nextPos; continue; }

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    if (!filenameMatch) { pos = nextPos; continue; }

    const rawBody = section.slice(headerEnd + 4);
    // 去掉末尾的 \r\n
    const body = rawBody.length >= 2 && rawBody[rawBody.length - 2] === 0x0d ? rawBody.slice(0, -2) : rawBody;

    result.push({
      fieldName: nameMatch ? nameMatch[1] : "file",
      filename: filenameMatch[1],
      data: body,
    });
    pos = nextPos;
  }
  return result;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// ─── 上传页面 HTML ───────────────────────────────────────────
const UPLOAD_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>📸 Mizuki 相册上传</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    --pink: #ec4899;
    --pink-dark: #db2777;
    --purple: #8b5cf6;
    --indigo: #6366f1;
    --card-bg: rgba(255,255,255,0.92);
    --card-border: rgba(255,255,255,0.6);

    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    position: relative;
    overflow-x: hidden;
    background: #0f0a1a;
  }

  /* ── 动态背景 ───────────────────────── */
  .bg-layer {
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }
  .bg-gradient {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 80% 60% at 20% 20%, rgba(236,72,153,0.25) 0%, transparent 60%),
      radial-gradient(ellipse 60% 80% at 80% 70%, rgba(139,92,246,0.25) 0%, transparent 60%),
      radial-gradient(ellipse 50% 50% at 50% 40%, rgba(99,102,241,0.15) 0%, transparent 50%),
      linear-gradient(180deg, #0f0a1a 0%, #1a1025 50%, #0f0a1a 100%);
  }

  /* 浮动光点 */
  .floating-dots {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .floating-dots::before,
  .floating-dots::after {
    content: "";
    position: absolute;
    border-radius: 50%;
    filter: blur(60px);
    animation: float 12s ease-in-out infinite;
  }
  .floating-dots::before {
    width: 300px; height: 300px;
    background: rgba(236,72,153,0.12);
    top: 10%; left: 5%;
  }
  .floating-dots::after {
    width: 250px; height: 250px;
    background: rgba(139,92,246,0.12);
    bottom: 15%; right: 5%;
    animation-delay: -6s;
  }
  @keyframes float {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(30px, -20px) scale(1.1); }
    50% { transform: translate(-10px, 30px) scale(0.9); }
    75% { transform: translate(-25px, -10px) scale(1.05); }
  }

  /* 网格纹理 */
  .grid-texture {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px);
    background-size: 48px 48px;
  }

  /* ── 主容器 ─────────────────────────── */
  .container {
    position: relative;
    z-index: 1;
    background: var(--card-bg);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 1px solid var(--card-border);
    border-radius: 1.75rem;
    padding: 2.75rem;
    max-width: 720px;
    width: 100%;
    box-shadow:
      0 4px 6px rgba(0,0,0,0.1),
      0 20px 50px rgba(0,0,0,0.2),
      0 0 0 1px rgba(255,255,255,0.05) inset;
    animation: fadeUp 0.6s ease;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── 头部 ───────────────────────────── */
  .header-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.35rem;
  }
  .logo-dot {
    width: 42px; height: 42px;
    border-radius: 12px;
    background: linear-gradient(135deg, var(--pink), var(--purple));
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    box-shadow: 0 8px 20px rgba(236,72,153,0.3);
    flex-shrink: 0;
  }
  h1 {
    font-size: 1.6rem;
    font-weight: 700;
    background: linear-gradient(135deg, #1e1b4b, #4c1d95);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .subtitle {
    color: #6b7280;
    font-size: 0.9rem;
    margin-bottom: 1.5rem;
    margin-left: 54px;
  }

  /* ── 状态栏 ─────────────────────────── */
  .status-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    background: linear-gradient(135deg, rgba(236,72,153,0.06), rgba(139,92,246,0.06));
    border: 1px solid rgba(236,72,153,0.12);
    border-radius: 0.75rem;
    color: #8b5cf6;
    font-size: 0.82rem;
    margin-bottom: 1.5rem;
    font-weight: 500;
  }
  .status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #10b981;
    box-shadow: 0 0 8px rgba(16,185,129,0.5);
    animation: pulse-dot 2s ease-in-out infinite;
  }
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* ── 表单 ───────────────────────────── */
  .form-section {
    background: rgba(139,92,246,0.03);
    border: 1px solid rgba(139,92,246,0.08);
    border-radius: 1rem;
    padding: 1.25rem;
    margin-bottom: 1rem;
  }
  .form-section-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: #8b5cf6;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.75rem;
  }
  .form-row {
    display: flex;
    gap: 0.5rem;
  }
  .form-group { margin-bottom: 0.85rem; }
  .form-group:last-child { margin-bottom: 0; }
  .form-label {
    display: block;
    font-weight: 600;
    margin-bottom: 0.3rem;
    font-size: 0.82rem;
    color: #374151;
  }
  select, input[type="text"] {
    width: 100%;
    padding: 0.65rem 0.9rem;
    border: 1.5px solid #e5e7eb;
    border-radius: 0.7rem;
    font-size: 0.9rem;
    transition: all 0.2s;
    font-family: inherit;
    background: #fafafa;
    color: #1f2937;
  }
  select:hover, input[type="text"]:hover { border-color: #d1d5db; background: #fff; }
  select:focus, input:focus {
    outline: none;
    border-color: var(--purple);
    background: #fff;
    box-shadow: 0 0 0 3px rgba(139,92,246,0.1);
  }

  .divider {
    display: flex; align-items: center; gap: 1rem;
    margin: 0.25rem 0 0.75rem;
    color: #9ca3af; font-size: 0.78rem; font-weight: 500;
  }
  .divider::before, .divider::after {
    content: ""; flex: 1; height: 1px;
    background: #e5e7eb;
  }

  /* ── 上传区 ─────────────────────────── */
  .dropzone {
    border: 2px dashed #d1d5db;
    border-radius: 1rem;
    padding: 2.5rem 1.5rem;
    text-align: center;
    cursor: pointer;
    transition: all 0.3s;
    background: linear-gradient(135deg, rgba(236,72,153,0.02), rgba(139,92,246,0.02));
    position: relative;
    overflow: hidden;
  }
  .dropzone::after {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 50% 50%, rgba(139,92,246,0.06) 0%, transparent 70%);
    opacity: 0;
    transition: opacity 0.3s;
  }
  .dropzone:hover, .dropzone.dragover {
    border-color: var(--purple);
    background: linear-gradient(135deg, rgba(236,72,153,0.05), rgba(139,92,246,0.05));
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(139,92,246,0.1);
  }
  .dropzone.dragover::after { opacity: 1; }
  .dropzone-icon {
    font-size: 2.5rem;
    margin-bottom: 0.4rem;
    position: relative;
    z-index: 1;
  }
  .dropzone-text {
    color: #4b5563;
    font-size: 0.95rem;
    font-weight: 500;
    position: relative;
    z-index: 1;
  }
  .dropzone-hint {
    color: #9ca3af;
    font-size: 0.78rem;
    margin-top: 0.3rem;
    position: relative;
    z-index: 1;
  }
  .dropzone input[type="file"] { display: none; }

  /* ── 预览网格 ───────────────────────── */
  .preview-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
    gap: 0.6rem;
    margin-top: 0.85rem;
  }
  .preview-item {
    position: relative;
    border-radius: 0.7rem;
    overflow: hidden;
    aspect-ratio: 1;
    background: #f3f4f6;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    animation: popIn 0.3s ease;
  }
  @keyframes popIn {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
  }
  .preview-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .preview-item .remove {
    position: absolute;
    top: 5px; right: 5px;
    width: 22px; height: 22px;
    background: rgba(0,0,0,0.5);
    backdrop-filter: blur(4px);
    color: #fff;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    font-size: 0.7rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    opacity: 0;
  }
  .preview-item:hover .remove { opacity: 1; }
  .preview-item .remove:hover { background: #ef4444; transform: scale(1.1); }

  /* ── 按钮 ───────────────────────────── */
  .btn {
    width: 100%;
    padding: 0.8rem;
    border: none;
    border-radius: 0.75rem;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
    position: relative;
    overflow: hidden;
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--pink), var(--purple));
    color: #fff;
    margin-top: 0.75rem;
    box-shadow: 0 4px 15px rgba(236,72,153,0.25);
  }
  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(236,72,153,0.35);
  }
  .btn-primary:active { transform: translateY(0); }
  .btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }
  .btn-primary:not(:disabled)::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.15), transparent);
    pointer-events: none;
  }

  .btn-danger {
    padding: 0.65rem 0.9rem;
    border: 1.5px solid #fecaca;
    border-radius: 0.7rem;
    background: #fff;
    color: #ef4444;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .btn-danger:hover {
    background: #fef2f2;
    border-color: #ef4444;
    box-shadow: 0 2px 10px rgba(239,68,68,0.1);
  }

  /* ── Toast ──────────────────────────── */
  .toast {
    position: fixed;
    top: 1.5rem;
    right: 1.5rem;
    padding: 0.9rem 1.4rem;
    border-radius: 0.75rem;
    color: #fff;
    font-weight: 500;
    font-size: 0.9rem;
    z-index: 999;
    animation: slideIn 0.35s ease;
    box-shadow: 0 8px 30px rgba(0,0,0,0.25);
    backdrop-filter: blur(8px);
  }
  .toast.success { background: rgba(16,185,129,0.92); }
  .toast.error { background: rgba(239,68,68,0.92); }
  @keyframes slideIn {
    from { transform: translateX(100px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  /* ── 管理面板 ───────────────────────── */
  .manage-section {
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid #f3f4f6;
  }
  .manage-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .manage-header h2 {
    font-size: 1.05rem;
    font-weight: 600;
    color: #1f2937;
  }
  .manage-header .count-badge {
    background: #f3f4f6;
    color: #6b7280;
    padding: 0.15rem 0.55rem;
    border-radius: 99px;
    font-size: 0.75rem;
    font-weight: 500;
  }
  .photo-manage-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(95px, 1fr));
    gap: 0.5rem;
  }
  .photo-manage-item {
    position: relative;
    border-radius: 0.6rem;
    overflow: hidden;
    aspect-ratio: 1;
    background: #f3f4f6;
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0,0,0,0.05);
    transition: transform 0.15s;
  }
  .photo-manage-item:hover { transform: scale(1.03); }
  .photo-manage-item img {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
  }
  .photo-manage-item .del-btn {
    position: absolute;
    top: 3px; right: 3px;
    width: 24px; height: 24px;
    background: rgba(0,0,0,0.45);
    backdrop-filter: blur(4px);
    color: #fff;
    border: none;
    cursor: pointer;
    font-size: 0.7rem;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.15s;
  }
  .photo-manage-item:hover .del-btn { opacity: 1; }
  .photo-manage-item .del-btn:hover { background: #ef4444; }
  .photo-manage-empty {
    color: #d1d5db;
    text-align: center;
    padding: 2rem 1rem;
    font-size: 0.85rem;
    grid-column: 1 / -1;
  }
  .del-confirm {
    position: absolute;
    inset: 0;
    background: rgba(239,68,68,0.92);
    backdrop-filter: blur(2px);
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border-radius: 0.6rem;
    font-size: 0.75rem;
  }
  .del-confirm .btn-sm {
    padding: 0.25rem 0.65rem;
    border: none;
    border-radius: 99px;
    font-size: 0.7rem;
    font-weight: 600;
    cursor: pointer;
    color: #fff;
  }
  .del-confirm .btn-yes { background: #fff; color: #ef4444; }
  .del-confirm .btn-no { background: transparent; border: 1px solid rgba(255,255,255,0.5); }

  /* ── 响应式 ─────────────────────────── */
  @media (max-width: 480px) {
    body { padding: 0.75rem; align-items: flex-start; padding-top: 1.5rem; }
    .container { padding: 1.5rem; border-radius: 1.25rem; }
    h1 { font-size: 1.3rem; }
    .subtitle { margin-left: 46px; font-size: 0.8rem; }
    .logo-dot { width: 34px; height: 34px; border-radius: 10px; font-size: 1.1rem; }
    .form-row { flex-direction: column; }
    .photo-manage-grid { grid-template-columns: repeat(3, 1fr); }
  }
</style>
</head>
<body>

<!-- 动态背景 -->
<div class="bg-layer">
  <div class="bg-gradient"></div>
  <div class="floating-dots"></div>
  <div class="grid-texture"></div>
</div>

<div class="container">
  <div class="header-row">
    <div class="logo-dot">🌸</div>
    <h1>Mizuki 相册管理</h1>
  </div>
  <p class="subtitle">拖拽上传图片，轻松管理你的相册</p>

  <div class="status-bar" id="statusBar">
    <span class="status-dot"></span>
    上传服务运行中 · 端口 ${PORT}
  </div>

  <!-- 已有相册 -->
  <div class="form-section">
    <div class="form-section-label">📁 选择已有相册</div>
    <div class="form-row">
      <select id="albumSelect" style="flex:1;">
        <option value="">-- 选择一个相册 --</option>
      </select>
      <button id="deleteAlbumBtn" class="btn-danger" style="display:none;" title="删除整个相册">🗑</button>
    </div>
  </div>

  <div class="divider"><span>或者新建</span></div>

  <!-- 新建相册 -->
  <div class="form-section">
    <div class="form-section-label">🆕 创建新相册</div>
    <div class="form-row" style="gap:0.6rem;">
      <div class="form-group" style="flex:1;margin-bottom:0;">
        <label class="form-label">英文 ID</label>
        <input type="text" id="newAlbumId" placeholder="trip-2026">
      </div>
      <div class="form-group" style="flex:1;margin-bottom:0;">
        <label class="form-label">显示标题</label>
        <input type="text" id="newAlbumTitle" placeholder="旅行随拍">
      </div>
    </div>
    <div class="form-group" style="margin-top:0.6rem;">
      <label class="form-label">标签（逗号分隔）</label>
      <input type="text" id="newAlbumTags" placeholder="旅行, 风景">
    </div>
  </div>

  <!-- 上传区 -->
  <div class="dropzone" id="dropzone">
    <div class="dropzone-icon">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    </div>
    <div class="dropzone-text">拖拽图片到此处，或点击选择</div>
    <div class="dropzone-hint">支持 JPG · PNG · WEBP · GIF · 多图同时上传</div>
    <input type="file" id="fileInput" multiple accept="image/*">
  </div>

  <div class="preview-grid" id="preview"></div>

  <button class="btn btn-primary" id="uploadBtn" disabled>
    📤 上传到相册
  </button>

  <!-- 管理面板 -->
  <div class="manage-section" id="manageSection" style="display:none;">
    <div class="manage-header">
      <h2>📷 相册照片</h2>
      <span class="count-badge" id="photoCount">0 张</span>
    </div>
    <div class="photo-manage-grid" id="photoGrid"></div>
  </div>
</div>

<script>
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const preview = document.getElementById("preview");
  const uploadBtn = document.getElementById("uploadBtn");
  const albumSelect = document.getElementById("albumSelect");
  const statusBar = document.getElementById("statusBar");
  let selectedFiles = [];

  // ── 加载相册列表 ──────────────────────────
  async function loadAlbums() {
    try {
      const res = await fetch("/api/albums");
      const albums = await res.json();
      albumSelect.innerHTML = \`<option value="">-- 不选，使用上方新建 --</option>\` +
        albums.map(a =>
          \`<option value="\${a.id}">\${a.title}（\${a.photoCount} 张）</option>\`
        ).join("");
    } catch(e) {
      albumSelect.innerHTML = \`<option value="">-- 不选，使用上方新建 --</option>\`;
    }
  }
  loadAlbums();

  // ── 照片管理：选择/输入相册时加载已有照片 ──
  const photoGrid = document.getElementById("photoGrid");
  const manageSection = document.getElementById("manageSection");
  const photoCount = document.getElementById("photoCount");

  let currentAlbum = "";

  async function loadPhotos(albumId) {
    if (!albumId) {
      manageSection.style.display = "none";
      currentAlbum = "";
      return;
    }
    currentAlbum = albumId;
    try {
      const res = await fetch(\`/api/photos?album=\${encodeURIComponent(albumId)}\`);
      const data = await res.json();
      const photos = data.photos || [];
      photoCount.textContent = \`\${photos.length} 张\`;
      manageSection.style.display = "block";

      if (photos.length === 0) {
        photoGrid.innerHTML = \`<div class="photo-manage-empty">暂无照片</div>\`;
        return;
      }
      photoGrid.innerHTML = photos.map(p => \`
        <div class="photo-manage-item" data-filename="\${p.filename}">
          <img src="http://127.0.0.1:3000\${p.path}" loading="lazy" onerror="this.style.opacity='0.3'">
          <button class="del-btn" title="删除">✕</button>
        </div>
      \`).join("");

      // 绑定删除事件
      photoGrid.querySelectorAll(".del-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const item = btn.closest(".photo-manage-item");
          const filename = item.dataset.filename;
          showDeleteConfirm(item, filename);
        });
      });
    } catch(e) {
      manageSection.style.display = "none";
    }
  }

  function showDeleteConfirm(item, filename) {
    const overlay = document.createElement("div");
    overlay.className = "del-confirm";
    overlay.innerHTML = \`
      <span>确认删除？</span>
      <div style="display:flex;gap:0.5rem;">
        <button class="btn-sm btn-yes">删除</button>
        <button class="btn-sm btn-no">取消</button>
      </div>
    \`;
    item.appendChild(overlay);

    overlay.querySelector(".btn-yes").addEventListener("click", async () => {
      try {
        const res = await fetch("/api/photos", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ album: currentAlbum, filename }),
        });
        if (res.ok) {
          toast("已删除", "success");
          loadPhotos(currentAlbum);
          loadAlbums();
        } else {
          const d = await res.json();
          toast("删除失败: " + (d.error || ""), "error");
          overlay.remove();
        }
      } catch(e) {
        toast("删除失败: " + e.message, "error");
        overlay.remove();
      }
    });

    overlay.querySelector(".btn-no").addEventListener("click", () => overlay.remove());
  }

  // 监听：选择已有相册 → 加载照片 + 显示删除按钮
  albumSelect.addEventListener("change", () => {
    const deleteAlbumBtn = document.getElementById("deleteAlbumBtn");
    if (albumSelect.value) {
      deleteAlbumBtn.style.display = "block";
      loadPhotos(albumSelect.value);
    } else {
      deleteAlbumBtn.style.display = "none";
      manageSection.style.display = "none";
    }
  });

  // ── 删除整个相册 ────────────────────────
  document.getElementById("deleteAlbumBtn").addEventListener("click", async () => {
    const albumId = albumSelect.value;
    if (!albumId) return;
    if (!confirm(\`确定要删除整个相册【\${albumId}】吗？\\n\\n⚠️ 相册内所有照片将被永久删除，不可恢复！\`)) return;

    try {
      const res = await fetch("/api/albums", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: albumId }),
      });
      if (res.ok) {
        toast(\`✅ 相册【\${albumId}】已删除\`, "success");
        loadAlbums();
        manageSection.style.display = "none";
        document.getElementById("deleteAlbumBtn").style.display = "none";
      } else {
        const d = await res.json();
        toast("删除失败: " + (d.error || ""), "error");
      }
    } catch(e) {
      toast("删除失败: " + e.message, "error");
    }
  });

  // 监听：输入新相册名时（输入框失焦），如果已有同名相册也加载
  document.getElementById("newAlbumId").addEventListener("input", function() {
    if (this.value.trim()) {
      // 尝试加载已有照片
      fetch(\`/api/photos?album=\${encodeURIComponent(this.value.trim())}\`)
        .then(r => r.json())
        .then(d => {
          if (d.photos && d.photos.length > 0) {
            currentAlbum = this.value.trim();
            photoCount.textContent = \`（\${d.photos.length} 张）\`;
            manageSection.style.display = "block";
            photoGrid.innerHTML = d.photos.map(p => \`
              <div class="photo-manage-item" data-filename="\${p.filename}">
                <img src="http://127.0.0.1:3000\${p.path}" loading="lazy" onerror="this.style.opacity='0.3'">
                <button class="del-btn" title="删除">✕</button>
              </div>
            \`).join("");
            photoGrid.querySelectorAll(".del-btn").forEach(btn => {
              btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const item = btn.closest(".photo-manage-item");
                showDeleteConfirm(item, item.dataset.filename);
              });
            });
          }
        }).catch(() => {});
    }
  });

  // ── 拖拽上传 ──────────────────────────────
  dropzone.addEventListener("click", () => fileInput.click());

  ["dragenter", "dragover"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
  });
  ["dragleave", "drop"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); });
  });

  dropzone.addEventListener("drop", (e) => {
    handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => {
    handleFiles(fileInput.files);
  });

  function handleFiles(files) {
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      selectedFiles.push(f);
    }
    renderPreview();
  }

  function renderPreview() {
    preview.innerHTML = "";
    selectedFiles.forEach((f, i) => {
      const div = document.createElement("div");
      div.className = "preview-item";
      const img = document.createElement("img");
      img.src = URL.createObjectURL(f);
      const btn = document.createElement("button");
      btn.className = "remove";
      btn.textContent = "✕";
      btn.onclick = () => { selectedFiles.splice(i, 1); renderPreview(); };
      div.appendChild(img);
      div.appendChild(btn);
      preview.appendChild(div);
    });
    uploadBtn.disabled = selectedFiles.length === 0;
    uploadBtn.textContent = selectedFiles.length ? \`📤 上传 \${selectedFiles.length} 张图片\` : "📤 上传到相册";
  }

  // ── 上传 ──────────────────────────────────
  uploadBtn.addEventListener("click", async () => {
    if (selectedFiles.length === 0) return;

    uploadBtn.disabled = true;
    uploadBtn.textContent = "⏳ 上传中...";

    const newId = document.getElementById("newAlbumId").value.trim();
    const selectedAlbum = albumSelect.value;
    let targetAlbum;

    // 优先使用新建相册，否则使用选择的已有相册
    if (newId) {
      const newTitle = document.getElementById("newAlbumTitle").value.trim() || newId;
      const newTags = document.getElementById("newAlbumTags").value.trim();
      try {
        const res = await fetch("/api/albums", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: newId, title: newTitle, tags: newTags.split(",").map(t => t.trim()).filter(Boolean) }),
        });
        if (!res.ok) { const d = await res.json(); toast(d.error || "创建相册失败", "error"); uploadBtn.disabled = false; uploadBtn.textContent = "📤 上传到相册"; return; }
        targetAlbum = newId;
      } catch(e) { toast("创建相册失败: " + e.message, "error"); uploadBtn.disabled = false; uploadBtn.textContent = "📤 上传到相册"; return; }
    } else if (selectedAlbum) {
      targetAlbum = selectedAlbum;
    } else {
      toast("请选择已有相册，或填写新相册名称", "error");
      uploadBtn.disabled = false;
      uploadBtn.textContent = "📤 上传到相册";
      return;
    }

    let success = 0, fail = 0;
    for (const file of selectedFiles) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("album", targetAlbum);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        if (res.ok) success++;
        else fail++;
      } catch(e) { fail++; }
    }

    if (fail === 0) {
      toast(\`✅ 成功上传 \${success} 张图片到相册！\`, "success");
    } else {
      toast(\`⚠️ \${success} 张成功，\${fail} 张失败\`, "error");
    }
    selectedFiles = [];
    renderPreview();
    loadAlbums();
    loadPhotos(targetAlbum);
    uploadBtn.textContent = "📤 上传到相册";
    fileInput.value = "";
  });

  function toast(msg, type) {
    const t = document.createElement("div");
    t.className = \`toast \${type}\`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }
</script>
</body>
</html>`;

// ─── HTTP 服务器 ─────────────────────────────────────────────
const server = createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── 主页（上传 UI）───────────────────────
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(UPLOAD_PAGE);
  }

  // ── 列出相册 ─────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/albums") {
    try { return json(res, listAlbums()); }
    catch (e) { return json(res, { error: e.message }, 500); }
  }

  // ── 创建相册 ─────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/albums") {
    const body = JSON.parse((await readBody(req)).toString());
    if (!body.id || !body.title) return json(res, { error: "缺少 id 或 title" }, 400);
    const ok = createAlbum(body.id, body);
    if (!ok) return json(res, { error: "相册已存在" }, 409);
    return json(res, { success: true, album: body.id });
  }

  // ── 上传图片 ─────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/upload") {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      return json(res, { error: "需要 multipart/form-data" }, 400);
    }
    const boundary = contentType.split("boundary=")[1];
    if (!boundary) return json(res, { error: "缺少 boundary" }, 400);

    const raw = await readBody(req);
    const parts = parseMultipart(raw, boundary);

    if (parts.length === 0) return json(res, { error: "未找到文件" }, 400);

    const albumId = parts.find((p) => p.fieldName === "album")?.data?.toString() || "默认相册";

    // 确保相册目录存在
    const albumDir = join(ALBUMS_DIR, albumId);
    if (!existsSync(albumDir)) {
      mkdirSync(albumDir, { recursive: true });
      writeFileSync(
        join(albumDir, "info.json"),
        JSON.stringify({ title: albumId, date: new Date().toISOString().split("T")[0], tags: [] }, null, 2),
        "utf-8"
      );
    }

    const saved = [];
    for (const part of parts) {
      if (part.fieldName !== "file") continue;
      const result = savePhoto(albumId, part.filename, part.data);
      if (result) saved.push(result);
    }

    return json(res, { success: true, saved, album: albumId });
  }

  // ── 列出相册内照片 ───────────────────────
  if (req.method === "GET" && url.pathname === "/api/photos") {
    const albumId = url.searchParams.get("album");
    if (!albumId) return json(res, { error: "缺少 album 参数" }, 400);
    const albumDir = join(ALBUMS_DIR, albumId);
    if (!existsSync(albumDir)) return json(res, { photos: [] });
    const files = readdirSync(albumDir).filter(
      (f) => !f.startsWith(".") && f !== "info.json" && f !== "cover.jpg" && f !== "cover.webp"
    );
    const photos = files.map((f) => ({
      filename: f,
      path: `/images/albums/${albumId}/${f}`,
      url: `http://localhost:${PORT}/images/${albumId}/${f}`,
    }));
    return json(res, { photos });
  }

  // ── 删除照片 ─────────────────────────────
  if (req.method === "DELETE" && url.pathname === "/api/photos") {
    const body = JSON.parse((await readBody(req)).toString());
    if (!body.album || !body.filename) return json(res, { error: "缺少 album 或 filename" }, 400);
    const resolved = join(ALBUMS_DIR, body.album, body.filename);
    if (!resolved.startsWith(ALBUMS_DIR)) return json(res, { error: "非法路径" }, 403);
    if (!existsSync(resolved)) return json(res, { error: "文件不存在" }, 404);
    const { unlinkSync } = await import("node:fs");
    unlinkSync(resolved);
    return json(res, { success: true, deleted: body.filename });
  }

  // ── 删除整个相册 ─────────────────────────
  if (req.method === "DELETE" && url.pathname === "/api/albums") {
    const body = JSON.parse((await readBody(req)).toString());
    if (!body.id) return json(res, { error: "缺少 id" }, 400);
    const resolved = join(ALBUMS_DIR, body.id);
    if (!resolved.startsWith(ALBUMS_DIR)) return json(res, { error: "非法路径" }, 403);
    if (!existsSync(resolved)) return json(res, { error: "相册不存在" }, 404);
    const { rmSync } = await import("node:fs");
    rmSync(resolved, { recursive: true, force: true });
    return json(res, { success: true, deleted: body.id });
  }

  // ── 404 ──────────────────────────────────
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// ─── 启动 ────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n📸 相册上传工具已启动！`);
  console.log(`   打开浏览器访问: http://localhost:${PORT}\n`);
  console.log(`   图片保存位置: ${ALBUMS_DIR}\n`);
});
