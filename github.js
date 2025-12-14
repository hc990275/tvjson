// ========== Cloudflare Worker 完整代码 (GitHub 管理器 v9) ==========
// 功能：多仓库管理、分支切换、批量下载、上传删除、重命名、友情链接、Releases
// 作者：hc990275
// GitHub：https://github.com/hc990275

// ========== 配置区域 ==========
const FALLBACK_REPOS = [
  { owner: "hc990275", repo: "CF-Workers-TXT", branch: "main", source: "owned" }
];

const TOKENS = {
  "your-read-uuid-here": "read",
  "your-editor-uuid-here": "write",
  "your-admin-uuid-here": "admin"
};

// ========== 工具函数 ==========

function getGitHubToken(env) {
  return env.GITHUB_TOKEN || env.GITHUBWEB;
}

async function getUserRepos(env) {
  const token = getGitHubToken(env);
  if (!token) return [];
  
  try {
    const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator", {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "Cloudflare-Worker-GitHub-Manager"
      }
    });
    
    if (!res.ok) return [];
    
    const repos = await res.json();
    return repos.map(r => ({
      owner: r.owner.login,
      repo: r.name,
      branch: r.default_branch || "main",
      source: r.fork ? "fork" : "owned",
      private: r.private,
      description: r.description,
      fork: r.fork,
      stars: r.stargazers_count,
      forks: r.forks_count
    }));
  } catch (e) {
    console.error("Failed to fetch user repos:", e);
    return [];
  }
}

async function getStarredRepos(env) {
  const token = getGitHubToken(env);
  if (!token) return [];
  
  try {
    const res = await fetch("https://api.github.com/user/starred?per_page=100&sort=updated", {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "Cloudflare-Worker-GitHub-Manager"
      }
    });
    
    if (!res.ok) return [];
    
    const repos = await res.json();
    return repos.map(r => ({
      owner: r.owner.login,
      repo: r.name,
      branch: r.default_branch || "main",
      source: "starred",
      private: r.private,
      description: r.description,
      stars: r.stargazers_count,
      forks: r.forks_count
    }));
  } catch (e) {
    console.error("Failed to fetch starred repos:", e);
    return [];
  }
}

async function getAllRepos(env) {
  const [owned, starred] = await Promise.all([
    getUserRepos(env),
    getStarredRepos(env)
  ]);
  
  const ownedKeys = new Set(owned.map(r => `${r.owner}/${r.repo}`));
  const filteredStarred = starred.filter(r => !ownedKeys.has(`${r.owner}/${r.repo}`));
  
  return {
    owned: owned.filter(r => r.source === "owned"),
    forked: owned.filter(r => r.source === "fork"),
    starred: filteredStarred
  };
}

async function getBranches(env, owner, repo) {
  const token = getGitHubToken(env);
  if (!token) return [];
  
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "Cloudflare-Worker-GitHub-Manager"
      }
    });
    
    if (!res.ok) return [];
    
    const branches = await res.json();
    return branches.map(b => ({
      name: b.name,
      protected: b.protected || false
    }));
  } catch (e) {
    console.error("Failed to fetch branches:", e);
    return [];
  }
}

async function searchRepos(env, query) {
  const token = getGitHubToken(env);
  if (!token || !query) return [];
  
  try {
    const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=20&sort=stars`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "Cloudflare-Worker-GitHub-Manager"
      }
    });
    
    if (!res.ok) return [];
    
    const data = await res.json();
    return data.items.map(r => ({
      owner: r.owner.login,
      repo: r.name,
      branch: r.default_branch || "main",
      description: r.description,
      stars: r.stargazers_count,
      forks: r.forks_count,
      language: r.language
    }));
  } catch (e) {
    return [];
  }
}

async function starRepo(env, owner, repo) {
  const token = getGitHubToken(env);
  const res = await fetch(`https://api.github.com/user/starred/${owner}/${repo}`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "Cloudflare-Worker-GitHub-Manager",
      "Content-Length": "0"
    }
  });
  return res.status === 204;
}

async function unstarRepo(env, owner, repo) {
  const token = getGitHubToken(env);
  const res = await fetch(`https://api.github.com/user/starred/${owner}/${repo}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "Cloudflare-Worker-GitHub-Manager"
    }
  });
  return res.status === 204;
}

async function forkRepo(env, owner, repo) {
  const token = getGitHubToken(env);
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/forks`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "Cloudflare-Worker-GitHub-Manager"
    }
  });
  return res.json();
}

function checkAuth(request, env) {
  const token = request.headers.get("X-Token") || "";
  if (env.TOKEN_ADMIN && token === env.TOKEN_ADMIN) return "admin";
  if (env.TOKEN_EDITOR && token === env.TOKEN_EDITOR) return "write";
  if (env.TOKEN_READ && token === env.TOKEN_READ) return "read";
  return TOKENS[token] || null;
}

function getFriendLinks(env) {
  try {
    if (env.FRIEND_LINKS) {
      return JSON.parse(env.FRIEND_LINKS);
    }
  } catch (e) {}
  return [];
}

function getShareSecret(env) {
  return env.SHARE_SECRET || "default-share-secret-change-me";
}

function generateShareSign(path, secret) {
  const data = path + ":" + secret;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function verifyShareSign(path, sign, secret) {
  return generateShareSign(path, secret) === sign;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Token"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders() }
  });
}

function htmlResponse(html) {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders() }
  });
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function base64ToUtf8(str) {
  return decodeURIComponent(escape(atob(str)));
}

async function githubFetch(env, url, method = "GET", body = null) {
  const token = getGitHubToken(env);
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "Cloudflare-Worker-GitHub-Manager"
  };
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  return fetch(url, options);
}

async function githubAPI(env, owner, repo, path, method = "GET", body = null) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const res = await githubFetch(env, url, method, body);
  return res.json();
}

async function getTree(env, owner, repo, branch) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const res = await githubFetch(env, url);
  const data = await res.json();
  if (!data.tree) return [];
  return data.tree.filter(item => item.type === "blob").map(item => ({
    path: item.path,
    size: item.size
  }));
}

async function getFileAsText(env, owner, repo, branch, path) {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  try {
    const res = await fetch(rawUrl + '?t=' + Date.now(), {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache"
      }
    });
    if (!res.ok) throw new Error("Not found");
    const content = await res.text();
    
    const metaRes = await githubFetch(env, `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`);
    const meta = await metaRes.json();
    
    return { content: content || '', sha: meta.sha, size: meta.size || content.length, name: path.split('/').pop() };
  } catch (e) {
    return { error: e.message };
  }
}

async function saveFile(env, owner, repo, branch, path, content, sha = null) {
  const body = {
    message: `Update ${path} via GitHub Manager`,
    content: utf8ToBase64(content),
    branch: branch
  };
  if (sha) body.sha = sha;
  return await githubAPI(env, owner, repo, path, "PUT", body);
}

async function deleteFile(env, owner, repo, branch, path, sha) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const res = await githubFetch(env, url, "DELETE", {
    message: `Delete ${path} via GitHub Manager`,
    sha: sha,
    branch: branch
  });
  return res.json();
}

async function deleteDirectory(env, owner, repo, branch, dirPath) {
  const files = await getTree(env, owner, repo, branch);
  const filesToDelete = files.filter(f => f.path.startsWith(dirPath + '/') || f.path === dirPath);
  
  if (filesToDelete.length === 0) {
    return { error: "Directory not found or empty", count: 0 };
  }
  
  let count = 0;
  for (const file of filesToDelete) {
    const fileData = await githubAPI(env, owner, repo, file.path);
    if (fileData.sha) {
      await deleteFile(env, owner, repo, branch, file.path, fileData.sha);
      count++;
    }
  }
  
  return { count };
}

async function deleteRepository(env, owner, repo) {
  const token = getGitHubToken(env);
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "Cloudflare-Worker-GitHub-Manager",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  
  return { success: res.status === 204, status: res.status };
}

// 重命名文件（复制内容到新路径，删除旧文件）
async function renameFile(env, owner, repo, branch, oldPath, newPath) {
  // 获取原文件内容
  const fileData = await githubAPI(env, owner, repo, oldPath + '?ref=' + branch);
  if (!fileData.sha) {
    return { error: "File not found" };
  }
  
  // 创建新文件
  const content = fileData.content ? fileData.content.replace(/\n/g, '') : '';
  const createRes = await githubFetch(env, 
    `https://api.github.com/repos/${owner}/${repo}/contents/${newPath}`,
    "PUT",
    {
      message: `Rename ${oldPath} to ${newPath} via GitHub Manager`,
      content: content,
      branch: branch
    }
  );
  
  if (!createRes.ok) {
    const err = await createRes.json();
    return { error: err.message || "Failed to create new file" };
  }
  
  // 删除旧文件
  await deleteFile(env, owner, repo, branch, oldPath, fileData.sha);
  
  return { success: true, oldPath, newPath };
}

// 重命名目录（复制所有文件到新路径，删除旧文件）
async function renameDirectory(env, owner, repo, branch, oldDir, newDir) {
  const files = await getTree(env, owner, repo, branch);
  const filesToRename = files.filter(f => f.path.startsWith(oldDir + '/') || f.path === oldDir);
  
  if (filesToRename.length === 0) {
    return { error: "Directory not found or empty", count: 0 };
  }
  
  let count = 0;
  for (const file of filesToRename) {
    const newPath = file.path.replace(oldDir, newDir);
    const result = await renameFile(env, owner, repo, branch, file.path, newPath);
    if (result.success) count++;
  }
  
  return { count };
}

async function getReleases(env, owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases`;
  const res = await githubFetch(env, url);
  return res.json();
}

async function createRelease(env, owner, repo, tagName, name, body, draft = false, prerelease = false) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases`;
  const res = await githubFetch(env, url, "POST", {
    tag_name: tagName,
    name: name,
    body: body,
    draft: draft,
    prerelease: prerelease
  });
  return res.json();
}

async function deleteRelease(env, owner, repo, releaseId) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/${releaseId}`;
  const res = await githubFetch(env, url, "DELETE");
  return res.status === 204;
}

async function uploadReleaseAsset(env, uploadUrl, fileName, fileContent, contentType) {
  const token = getGitHubToken(env);
  const url = uploadUrl.replace('{?name,label}', '') + `?name=${encodeURIComponent(fileName)}`;
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": contentType || "application/octet-stream",
      "User-Agent": "Cloudflare-Worker-GitHub-Manager"
    },
    body: fileContent
  });
  return res.json();
}

async function uploadFileToRepo(env, owner, repo, branch, path, content, sha = null) {
  const body = {
    message: `Upload ${path} via GitHub Manager`,
    content: content,
    branch: branch
  };
  if (sha) body.sha = sha;
  return await githubAPI(env, owner, repo, path, "PUT", body);
}

// ========== 前端 HTML ==========
const FRONTEND_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GitHub 管理器</title>
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; }
  #editor { font-family: 'Fira Code', 'Consolas', monospace; tab-size: 2; }
  #preview { line-height: 1.8; }
  #preview h1 { font-size: 1.8em; font-weight: bold; border-bottom: 1px solid #444; padding-bottom: 0.3em; margin: 1em 0 0.5em; }
  #preview h2 { font-size: 1.5em; font-weight: bold; margin: 1em 0 0.5em; }
  #preview h3 { font-size: 1.25em; font-weight: bold; margin: 1em 0 0.5em; }
  #preview p { margin: 0.8em 0; }
  #preview code { background: #1e293b; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  #preview pre { background: #0f172a; padding: 1em; border-radius: 8px; overflow-x: auto; margin: 1em 0; }
  #preview pre code { background: none; padding: 0; }
  #preview ul, #preview ol { padding-left: 1.5em; margin: 0.5em 0; }
  #preview blockquote { border-left: 4px solid #3b82f6; padding-left: 1em; margin: 1em 0; color: #94a3b8; }
  #preview a { color: #60a5fa; text-decoration: underline; }
  .tree-item { cursor: pointer; padding: 6px 12px; border-radius: 6px; transition: all 0.15s; }
  .tree-item:hover { background: #334155; }
  .tree-item.active { background: #3b82f6; color: white; }
  .tree-folder-header { cursor: pointer; padding: 6px 12px; border-radius: 6px; transition: all 0.15s; }
  .tree-folder-header:hover { background: #334155; }
  .tree-folder-content { overflow: hidden; transition: max-height 0.3s ease; }
  .tree-folder-content.collapsed { max-height: 0 !important; }
  .folder-icon { transition: transform 0.2s; display: inline-block; }
  .folder-icon.collapsed { transform: rotate(-90deg); }
  .toast { animation: slideIn 0.3s ease; }
  @keyframes slideIn { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: #1e293b; }
  ::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
  .modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 100; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
  .modal.show { display: flex; }
  .tab-btn { transition: all 0.2s; }
  .tab-btn.active { background: #3b82f6; color: white; }
  .file-date { font-size: 10px; color: #64748b; }
  .copy-btn { cursor: pointer; opacity: 0.6; transition: opacity 0.2s; }
  .copy-btn:hover { opacity: 1; }
  .toolbar-btn { padding: 6px 12px; border-radius: 6px; font-size: 13px; transition: all 0.15s; white-space: nowrap; }
</style>
</head>
<body class="bg-slate-900 text-slate-100 h-screen overflow-hidden">

<!-- 认证弹窗 -->
<div id="authModal" class="modal show">
  <div class="bg-slate-800 rounded-2xl p-8 w-full max-w-md shadow-2xl border border-slate-700">
    <div class="text-center mb-6">
      <div class="text-5xl mb-3">🐙</div>
      <h2 class="text-2xl font-bold">GitHub 管理器</h2>
      <p class="text-slate-400 mt-2">请输入访问令牌</p>
    </div>
    <input id="tokenInput" type="password" placeholder="输入 Token..." 
      class="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4 text-center text-lg">
    <div class="flex gap-3 mb-4">
      <button id="authBtn" class="flex-1 bg-blue-600 hover:bg-blue-700 py-3 rounded-xl font-semibold transition">🔑 验证登录</button>
      <button id="guestBtn" class="flex-1 bg-slate-600 hover:bg-slate-500 py-3 rounded-xl font-semibold transition">👁️ 游客浏览</button>
    </div>
    <p id="authError" class="text-red-400 text-center hidden text-sm"></p>
  </div>
</div>

<!-- 搜索仓库弹窗 -->
<div id="searchRepoModal" class="modal">
  <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-2xl shadow-2xl border border-slate-700 max-h-[80vh] flex flex-col">
    <h3 class="text-xl font-bold mb-4">🔍 搜索仓库</h3>
    <div class="flex gap-2 mb-4">
      <input id="searchRepoInput" type="text" placeholder="搜索 GitHub 仓库..." 
        class="flex-1 px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-base">
      <button id="searchRepoBtn" class="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold text-base">🔍 搜索</button>
    </div>
    <div id="searchRepoResults" class="flex-1 overflow-y-auto space-y-2"></div>
    <button id="searchRepoClose" class="w-full bg-slate-600 hover:bg-slate-500 py-2 rounded-lg mt-4">关闭</button>
  </div>
</div>

<!-- 新建弹窗 -->
<div id="createModal" class="modal">
  <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-slate-700">
    <h3 class="text-xl font-bold mb-4">➕ 新建</h3>
    <div class="mb-4">
      <label class="block text-sm mb-2">类型</label>
      <div class="flex gap-2">
        <button id="createTypeFile" class="flex-1 py-2 px-4 bg-blue-600 rounded-lg text-sm">📄 文件</button>
        <button id="createTypeFolder" class="flex-1 py-2 px-4 bg-slate-600 rounded-lg text-sm">📁 文件夹</button>
      </div>
    </div>
    <div class="mb-4" id="createDirSection">
      <label class="block text-sm mb-2">选择目录</label>
      <select id="createDirSelect" class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg"></select>
    </div>
    <div class="mb-4">
      <label class="block text-sm mb-2" id="createNameLabel">文件名</label>
      <input id="createFileName" type="text" placeholder="例如: notes.md" 
        class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
    </div>
    <div class="flex gap-2">
      <button id="createConfirm" class="flex-1 bg-green-600 hover:bg-green-700 py-2 rounded-lg font-semibold">✅ 创建</button>
      <button id="createCancel" class="flex-1 bg-slate-600 hover:bg-slate-500 py-2 rounded-lg">❌ 取消</button>
    </div>
  </div>
</div>

<!-- 上传弹窗 -->
<div id="uploadModal" class="modal">
  <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-slate-700">
    <h3 class="text-xl font-bold mb-4">📤 上传文件</h3>
    <div class="mb-4">
      <label class="block text-sm mb-2">选择目录</label>
      <select id="uploadDirSelect" class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg"></select>
    </div>
    <div class="mb-4">
      <label class="block text-sm mb-2">选择文件</label>
      <input id="uploadFileInput" type="file" multiple class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg">
      <p class="text-xs text-slate-400 mt-1">支持多文件上传</p>
    </div>
    <div id="uploadProgress" class="mb-4 hidden">
      <div class="text-sm text-slate-400 mb-1">上传进度:</div>
      <div class="bg-slate-700 rounded-full h-2">
        <div id="uploadProgressBar" class="bg-blue-600 h-2 rounded-full transition-all" style="width: 0%"></div>
      </div>
      <div id="uploadProgressText" class="text-xs text-slate-400 mt-1">0/0</div>
    </div>
    <div class="flex gap-2">
      <button id="uploadConfirm" class="flex-1 bg-green-600 hover:bg-green-700 py-2 rounded-lg font-semibold">📤 上传</button>
      <button id="uploadCancel" class="flex-1 bg-slate-600 hover:bg-slate-500 py-2 rounded-lg">❌ 取消</button>
    </div>
  </div>
</div>

<!-- 重命名弹窗 -->
<div id="renameModal" class="modal">
  <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl border border-slate-700 max-h-[80vh] overflow-hidden flex flex-col">
    <h3 class="text-xl font-bold mb-4">✏️ 重命名</h3>
    <div class="mb-4">
      <div class="flex gap-2">
        <button id="renameTypeFile" class="flex-1 py-2 px-3 bg-blue-600 rounded-lg text-sm">📄 文件</button>
        <button id="renameTypeDir" class="flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm">📁 目录</button>
      </div>
    </div>
    <div id="renameFileSection" class="flex-1 overflow-hidden flex flex-col">
      <label class="block text-sm mb-2">选择文件</label>
      <select id="renameFileSelect" class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg mb-4"></select>
      <label class="block text-sm mb-2">新文件名</label>
      <input id="renameNewFileName" type="text" placeholder="输入新文件名..." 
        class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg">
      <p class="text-xs text-slate-400 mt-1">注意：需要包含完整路径，如 docs/readme.md</p>
    </div>
    <div id="renameDirSection" class="hidden">
      <label class="block text-sm mb-2">选择目录</label>
      <select id="renameDirSelect" class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg mb-4"></select>
      <label class="block text-sm mb-2">新目录名</label>
      <input id="renameNewDirName" type="text" placeholder="输入新目录名..." 
        class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg">
      <p class="text-yellow-400 text-sm mt-2">⚠️ 将重命名该目录下的所有文件</p>
    </div>
    <div class="flex gap-2 mt-4">
      <button id="renameConfirm" class="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg font-semibold">✏️ 确认重命名</button>
      <button id="renameCancel" class="flex-1 bg-slate-600 hover:bg-slate-500 py-2 rounded-lg">❌ 取消</button>
    </div>
  </div>
</div>

<!-- 下载弹窗 -->
<div id="downloadModal" class="modal">
  <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl border border-slate-700 max-h-[80vh] overflow-hidden flex flex-col">
    <h3 class="text-xl font-bold mb-4">⬇️ 下载文件</h3>
    <div class="flex items-center gap-2 mb-2">
      <button id="downloadSelectAll" class="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded">全选</button>
      <button id="downloadDeselectAll" class="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded">取消全选</button>
      <span id="downloadSelectedCount" class="text-xs text-slate-400 ml-auto">已选: 0</span>
    </div>
    <div id="downloadFileList" class="flex-1 overflow-y-auto bg-slate-900 rounded-lg p-2 max-h-96"></div>
    <div class="flex gap-2 mt-4">
      <button id="downloadConfirm" class="flex-1 bg-green-600 hover:bg-green-700 py-2 rounded-lg font-semibold">⬇️ 开始下载</button>
      <button id="downloadCancel" class="flex-1 bg-slate-600 hover:bg-slate-500 py-2 rounded-lg">❌ 取消</button>
    </div>
  </div>
</div>

<!-- 分享弹窗 -->
<div id="shareModal" class="modal">
  <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl border border-slate-700 max-h-[80vh] overflow-hidden flex flex-col">
    <h3 class="text-xl font-bold mb-4">📤 分享文件</h3>
    <div class="flex items-center gap-2 mb-2">
      <button id="shareSelectAll" class="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded">全选</button>
      <button id="shareDeselectAll" class="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded">取消全选</button>
      <span id="shareSelectedCount" class="text-xs text-slate-400 ml-auto">已选: 0</span>
    </div>
    <div id="shareFileList" class="flex-1 overflow-y-auto bg-slate-900 rounded-lg p-2 max-h-64 mb-4"></div>
    <div class="mb-4">
      <label class="flex items-center gap-2 cursor-pointer mb-2">
        <input id="shareBase64" type="checkbox" class="w-4 h-4">
        <span class="text-sm">Base64 编码</span>
      </label>
      <p class="text-xs text-slate-400">🔒 链接包含签名保护并强制实时刷新</p>
    </div>
    <div id="shareResults" class="hidden mb-4 bg-slate-900 rounded-lg p-3 max-h-48 overflow-y-auto">
      <div class="text-sm text-slate-400 mb-2">分享链接:</div>
      <div id="shareUrlList" class="space-y-2"></div>
    </div>
    <div class="flex gap-2">
      <button id="shareGenerate" class="flex-1 bg-purple-600 hover:bg-purple-700 py-2 rounded-lg font-semibold">🔗 生成链接</button>
      <button id="shareCopyAll" class="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg font-semibold hidden">📋 复制全部</button>
      <button id="shareClose" class="flex-1 bg-slate-600 hover:bg-slate-500 py-2 rounded-lg">关闭</button>
    </div>
  </div>
</div>

<!-- 删除弹窗 -->
<div id="deleteModal" class="modal">
  <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl border border-slate-700 max-h-[80vh] overflow-hidden flex flex-col">
    <h3 class="text-xl font-bold mb-4">🗑️ 删除管理</h3>
    <div class="mb-4">
      <div class="flex gap-2">
        <button id="deleteTypeFile" class="flex-1 py-2 px-3 bg-blue-600 rounded-lg text-sm">📄 文件</button>
        <button id="deleteTypeDir" class="flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm">📁 目录</button>
        <button id="deleteTypeRepo" class="flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm">🗄️ 仓库</button>
      </div>
    </div>
    <div id="deleteFileSection" class="flex-1 overflow-hidden flex flex-col">
      <div class="flex items-center gap-2 mb-2">
        <button id="deleteSelectAll" class="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded">全选</button>
        <button id="deleteDeselectAll" class="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded">取消全选</button>
        <span id="deleteSelectedCount" class="text-xs text-slate-400 ml-auto">已选: 0</span>
      </div>
      <div id="deleteFileList" class="flex-1 overflow-y-auto bg-slate-900 rounded-lg p-2 max-h-64"></div>
    </div>
    <div id="deleteDirSection" class="hidden">
      <select id="deleteDirSelect" class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg"></select>
      <p class="text-yellow-400 text-sm mt-2">⚠️ 将删除该目录下的所有文件</p>
    </div>
    <div id="deleteRepoSection" class="hidden">
      <p class="text-red-400 text-sm mb-4">⚠️ 危险操作！此操作不可恢复！</p>
      <p class="text-slate-300 mb-2">当前仓库: <span id="deleteRepoName" class="font-bold text-white"></span></p>
      <p class="text-yellow-400 text-xs mb-2">注意: GitHub Token 需要有 delete_repo 权限</p>
      <input id="deleteRepoConfirmInput" type="text" placeholder="输入仓库名确认..." 
        class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg">
    </div>
    <div class="flex gap-2 mt-4">
      <button id="deleteConfirm" class="flex-1 bg-red-600 hover:bg-red-700 py-2 rounded-lg font-semibold">🗑️ 确认删除</button>
      <button id="deleteCancel" class="flex-1 bg-slate-600 hover:bg-slate-500 py-2 rounded-lg">❌ 取消</button>
    </div>
  </div>
</div>

<!-- Releases 弹窗 -->
<div id="releaseModal" class="modal">
  <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-2xl shadow-2xl border border-slate-700 max-h-[90vh] flex flex-col">
    <div class="flex items-center justify-between mb-4 shrink-0">
      <h3 class="text-xl font-bold">🚀 发布管理</h3>
      <button id="releaseCloseTop" class="text-slate-400 hover:text-white text-2xl leading-none px-2">&times;</button>
    </div>
    <div class="flex gap-2 mb-4 shrink-0">
      <button id="tabReleases" class="tab-btn px-4 py-2 rounded-lg bg-slate-700 active">📦 版本列表</button>
      <button id="tabNewRelease" class="tab-btn px-4 py-2 rounded-lg bg-slate-700">➕ 新建版本</button>
    </div>
    <div id="releasesList" class="flex-1 overflow-y-auto mb-4 min-h-0"></div>
    <div id="newReleaseForm" class="hidden flex-1 overflow-y-auto space-y-4 min-h-0">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm mb-2">Tag *</label>
          <input id="releaseTag" type="text" placeholder="v1.0.0" class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg">
        </div>
        <div>
          <label class="block text-sm mb-2">标题 *</label>
          <input id="releaseTitle" type="text" placeholder="版本标题" class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg">
        </div>
      </div>
      <div>
        <label class="block text-sm mb-2">说明</label>
        <textarea id="releaseBody" rows="3" class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg"></textarea>
      </div>
      <div>
        <label class="block text-sm mb-2">📎 上传附件</label>
        <input id="releaseFiles" type="file" multiple class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg">
        <p class="text-xs text-slate-400 mt-1">可选择多个文件</p>
      </div>
      <div class="flex gap-4">
        <label class="flex items-center gap-2"><input id="releaseDraft" type="checkbox" class="w-4 h-4"><span class="text-sm">草稿</span></label>
        <label class="flex items-center gap-2"><input id="releasePrerelease" type="checkbox" class="w-4 h-4"><span class="text-sm">预发布</span></label>
      </div>
      <button id="createReleaseBtn" class="w-full bg-green-600 hover:bg-green-700 py-3 rounded-lg font-semibold">🚀 发布</button>
    </div>
    <button id="releaseClose" class="w-full bg-slate-600 hover:bg-slate-500 py-2 rounded-lg mt-2 shrink-0">关闭</button>
  </div>
</div>

<!-- 主应用 -->
<div id="app" class="flex h-full">
  <!-- 侧边栏 -->
  <div class="w-72 bg-slate-800 border-r border-slate-700 flex flex-col">
    <div class="p-4 border-b border-slate-700">
      <h1 class="text-lg font-bold flex items-center gap-2"><span class="text-2xl">🐙</span> GitHub 管理器</h1>
      <div class="mt-3 flex items-center justify-between">
        <span id="roleTag" class="text-xs px-2 py-1 rounded-full bg-slate-600">未登录</span>
        <button id="logoutBtn" class="text-xs text-slate-400 hover:text-red-400 transition hidden">退出</button>
      </div>
    </div>
    
    <!-- 仓库选择 -->
    <div class="p-3 border-b border-slate-700">
      <label class="text-xs text-slate-400 mb-2 block">选择仓库</label>
      <select id="repoSelect" class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm mb-2"></select>
      <div class="flex gap-2">
        <button id="copyRepoBtn" class="flex-1 text-xs px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded transition" title="复制仓库名">📋</button>
        <button id="searchRepoOpenBtn" class="flex-1 text-xs px-2 py-1.5 bg-blue-600 hover:bg-blue-700 rounded transition">🔍 搜索</button>
      </div>
      
      <!-- 分支选择 -->
      <div class="mt-2">
        <label class="text-xs text-slate-400 mb-1 block">分支</label>
        <select id="branchSelect" class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm"></select>
      </div>
      
      <div id="repoActions" class="flex gap-2 mt-2 hidden">
        <button id="starRepoBtn" class="flex-1 text-xs bg-yellow-600 hover:bg-yellow-700 py-1.5 rounded">⭐ Star</button>
        <button id="forkRepoBtn" class="flex-1 text-xs bg-purple-600 hover:bg-purple-700 py-1.5 rounded">🍴 Fork</button>
      </div>
    </div>
    
    <div class="p-3">
      <input id="search" placeholder="搜索文件…" class="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
    </div>
    <div class="px-3 flex gap-1">
      <button id="expandAllBtn" class="flex-1 text-xs bg-slate-700 hover:bg-slate-600 py-1.5 rounded">📂 展开</button>
      <button id="collapseAllBtn" class="flex-1 text-xs bg-slate-700 hover:bg-slate-600 py-1.5 rounded">📁 折叠</button>
    </div>
    <div id="tree" class="flex-1 overflow-y-auto p-2 mt-2">
      <div class="text-center text-slate-500 py-12">
        <div class="inline-block w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin mb-3"></div>
        <div class="text-sm">加载中...</div>
      </div>
    </div>
    <div class="p-3 border-t border-slate-700 space-y-2">
      <div class="grid grid-cols-2 gap-2">
        <button id="createBtn" class="bg-green-600 hover:bg-green-700 py-2 rounded-lg text-sm transition hidden">➕ 新建</button>
        <button id="uploadBtn" class="bg-blue-600 hover:bg-blue-700 py-2 rounded-lg text-sm transition hidden">📤 上传</button>
        <button id="renameBtn" class="bg-yellow-600 hover:bg-yellow-700 py-2 rounded-lg text-sm transition hidden">✏️ 重命名</button>
        <button id="deleteBtn" class="bg-red-600 hover:bg-red-700 py-2 rounded-lg text-sm transition hidden">🗑️ 删除</button>
      </div>
      <button id="releaseBtn" class="w-full bg-orange-600 hover:bg-orange-700 py-2 rounded-lg text-sm transition hidden">🚀 发布</button>
    </div>
  </div>

  <!-- 编辑区 -->
  <div class="flex-1 flex flex-col bg-slate-900">
    <div class="h-14 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4">
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <span id="filepath" class="text-slate-400 font-mono text-sm truncate">未选择文件</span>
        <button id="copyFilePathBtn" class="copy-btn hidden shrink-0" title="复制文件路径">📋</button>
        <span id="fileStatus" class="text-xs px-2 py-0.5 rounded-full bg-yellow-600 hidden shrink-0">● 未保存</span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <div id="friendLinksTop" class="flex items-center gap-2 mr-2 hidden"></div>
        <button id="shareTopBtn" class="toolbar-btn bg-purple-600 hover:bg-purple-700 hidden">📤 分享</button>
        <button id="downloadTopBtn" class="toolbar-btn bg-cyan-600 hover:bg-cyan-700">⬇️ 下载</button>
        <button id="refreshTopBtn" class="toolbar-btn bg-slate-700 hover:bg-slate-600">🔄 刷新</button>
        <button id="previewToggle" class="toolbar-btn bg-slate-700 hover:bg-slate-600 hidden">👁️ 预览</button>
        <button id="saveBtn" class="toolbar-btn bg-blue-600 hover:bg-blue-700 font-semibold disabled:opacity-40" disabled>💾 保存</button>
      </div>
    </div>
    <div id="panes" class="flex-1 flex overflow-hidden">
      <div id="welcome" class="flex-1 flex items-center justify-center">
        <div class="text-center">
          <div class="text-7xl mb-6">🐙</div>
          <h2 class="text-2xl font-bold mb-3">GitHub 管理器</h2>
          <p class="text-slate-400">无需翻墙，在线管理 GitHub 仓库</p>
        </div>
      </div>
      <textarea id="editor" class="hidden flex-1 bg-slate-950 text-slate-100 p-4 resize-none focus:outline-none text-sm leading-relaxed" spellcheck="false"></textarea>
      <div id="preview" class="hidden w-1/2 bg-slate-850 p-6 overflow-y-auto border-l border-slate-700"></div>
    </div>
  </div>
</div>

<!-- Toast -->
<div id="toasts" class="fixed bottom-4 right-4 space-y-2 z-50"></div>

<script>
const $ = id => document.getElementById(id);

const state = { 
  currentFile: null, 
  currentSha: null, 
  originalContent: '', 
  userRole: null, 
  userToken: '', 
  fileList: [], 
  allRepos: { owned: [], forked: [], starred: [] },
  currentRepo: null,
  currentBranch: null,
  branches: [],
  isPreviewVisible: true,
  folderStates: {},
  deleteType: 'file',
  renameType: 'file',
  selectedFiles: new Set(),
  downloadFiles: new Set(),
  shareFiles: new Set(),
  createType: 'file'
};

function toast(msg, type = 'info') {
  const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-blue-600', warning: 'bg-yellow-600' };
  const div = document.createElement('div');
  div.className = 'toast ' + colors[type] + ' text-white px-4 py-3 rounded-lg shadow-lg min-w-64';
  div.textContent = msg;
  $('toasts').appendChild(div);
  setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 3000);
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const icons = { md: '📝', txt: '📄', json: '📋', js: '🟨', html: '🌐', css: '🎨', py: '🐍', yml: '⚙️', yaml: '⚙️', ts: '🔷', go: '🔵', rs: '🦀', sh: '📜', png: '🖼️', jpg: '🖼️', gif: '🖼️', svg: '🖼️', mp4: '🎬', mp3: '🎵', zip: '📦', pdf: '📕' };
  return icons[ext] || '📄';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function api(endpoint, options = {}) {
  const headers = { ...options.headers };
  if (state.userToken) headers['X-Token'] = state.userToken;
  return fetch(endpoint, { ...options, headers });
}

async function loadRepos() {
  try {
    const res = await api('/api/repos');
    state.allRepos = await res.json();
    renderRepoSelect();
    
    const allRepos = [...state.allRepos.owned, ...state.allRepos.forked, ...state.allRepos.starred];
    if (allRepos.length > 0) {
      state.currentRepo = allRepos[0];
      state.currentBranch = allRepos[0].branch;
      $('repoSelect').value = '0-owned';
      await loadBranches();
      loadTree();
    }
  } catch (e) {
    toast('加载仓库失败', 'error');
  }
}

function renderRepoSelect() {
  let html = '';
  if (state.allRepos.owned.length > 0) {
    html += '<optgroup label="📁 我的仓库">';
    state.allRepos.owned.forEach((r, i) => { html += '<option value="' + i + '-owned">' + r.owner + '/' + r.repo + '</option>'; });
    html += '</optgroup>';
  }
  if (state.allRepos.forked.length > 0) {
    html += '<optgroup label="🍴 Fork 的仓库">';
    state.allRepos.forked.forEach((r, i) => { html += '<option value="' + i + '-forked">' + r.owner + '/' + r.repo + '</option>'; });
    html += '</optgroup>';
  }
  if (state.allRepos.starred.length > 0) {
    html += '<optgroup label="⭐ 关注的仓库">';
    state.allRepos.starred.forEach((r, i) => { html += '<option value="' + i + '-starred">' + r.owner + '/' + r.repo + '</option>'; });
    html += '</optgroup>';
  }
  $('repoSelect').innerHTML = html;
}

async function loadBranches() {
  if (!state.currentRepo) return;
  try {
    const { owner, repo } = state.currentRepo;
    const res = await api('/api/branches?owner=' + owner + '&repo=' + repo);
    state.branches = await res.json();
    $('branchSelect').innerHTML = state.branches.map(b => 
      '<option value="' + b.name + '"' + (b.name === state.currentBranch ? ' selected' : '') + '>' + b.name + '</option>'
    ).join('');
  } catch (e) {
    $('branchSelect').innerHTML = '<option value="' + state.currentBranch + '">' + state.currentBranch + '</option>';
  }
}

$('branchSelect').addEventListener('change', () => {
  state.currentBranch = $('branchSelect').value;
  state.currentFile = null;
  $('editor').classList.add('hidden');
  $('welcome').classList.remove('hidden');
  $('filepath').textContent = '未选择文件';
  $('copyFilePathBtn').classList.add('hidden');
  loadTree();
});

$('repoSelect').addEventListener('change', async () => {
  const [idx, type] = $('repoSelect').value.split('-');
  const repos = type === 'owned' ? state.allRepos.owned : type === 'forked' ? state.allRepos.forked : state.allRepos.starred;
  state.currentRepo = repos[parseInt(idx)];
  state.currentBranch = state.currentRepo.branch;
  state.currentFile = null;
  $('editor').classList.add('hidden');
  $('welcome').classList.remove('hidden');
  $('filepath').textContent = '未选择文件';
  $('copyFilePathBtn').classList.add('hidden');
  
  await loadBranches();
  loadTree();
  
  if (state.userRole && state.userRole !== 'read') {
    $('repoActions').classList.remove('hidden');
    $('starRepoBtn').textContent = type === 'starred' ? '⭐ Unstar' : '⭐ Star';
  }
});

$('copyRepoBtn').addEventListener('click', () => {
  if (!state.currentRepo) return;
  const repoName = state.currentRepo.owner + '/' + state.currentRepo.repo;
  navigator.clipboard.writeText(repoName).then(() => toast('已复制: ' + repoName, 'success'));
});

$('copyFilePathBtn').addEventListener('click', () => {
  if (!state.currentFile) return;
  navigator.clipboard.writeText(state.currentFile).then(() => toast('已复制: ' + state.currentFile, 'success'));
});

$('starRepoBtn').addEventListener('click', async () => {
  if (!state.currentRepo) return;
  const { owner, repo } = state.currentRepo;
  const isStarred = state.currentRepo.source === 'starred';
  try {
    const res = await api('/api/' + (isStarred ? 'unstar' : 'star') + '?owner=' + owner + '&repo=' + repo, { method: 'POST' });
    if (res.ok) { toast(isStarred ? '已取消关注' : '已关注仓库', 'success'); loadRepos(); }
  } catch (e) { toast('操作失败', 'error'); }
});

$('forkRepoBtn').addEventListener('click', async () => {
  if (!state.currentRepo) return;
  const { owner, repo } = state.currentRepo;
  if (!confirm('确定要 Fork 仓库 ' + owner + '/' + repo + ' 吗？')) return;
  try {
    const res = await api('/api/fork?owner=' + owner + '&repo=' + repo, { method: 'POST' });
    const data = await res.json();
    if (data.id) { toast('Fork 成功!', 'success'); loadRepos(); }
    else throw new Error(data.message || 'Fork 失败');
  } catch (e) { toast('Fork 失败: ' + e.message, 'error'); }
});

async function loadTree() {
  if (!state.currentRepo || !state.currentBranch) return;
  $('tree').innerHTML = '<div class="text-center py-8"><div class="inline-block w-6 h-6 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin"></div></div>';
  try {
    const { owner, repo } = state.currentRepo;
    const res = await api('/api/tree?owner=' + owner + '&repo=' + repo + '&branch=' + state.currentBranch);
    state.fileList = await res.json();
    renderTree(state.fileList);
    updateDirSelect();
  } catch (e) {
    $('tree').innerHTML = '<div class="text-center text-red-400 py-8">加载失败</div>';
  }
}

function renderTree(files, filter = '') {
  const filtered = filter ? files.filter(f => f.path.toLowerCase().includes(filter.toLowerCase())) : files;
  if (!filtered.length) { $('tree').innerHTML = '<div class="text-center text-slate-500 py-8">无文件</div>'; return; }
  
  const groups = {};
  filtered.forEach(file => {
    const parts = file.path.split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '根目录';
    if (!groups[folder]) groups[folder] = [];
    groups[folder].push({ ...file, name: parts[parts.length - 1] });
  });
  
  let html = '';
  Object.keys(groups).sort().forEach(folder => {
    const isCollapsed = state.folderStates[folder] === false;
    const folderId = 'folder-' + folder.replace(/[^a-zA-Z0-9]/g, '-');
    html += '<div class="mb-1"><div class="tree-folder-header flex items-center gap-2 text-slate-300" data-folder="' + folder + '">';
    html += '<span class="folder-icon ' + (isCollapsed ? 'collapsed' : '') + '">▼</span>';
    html += '<span>📁</span><span class="text-sm font-medium truncate">' + folder + '</span>';
    html += '<span class="text-xs text-slate-500 ml-auto">' + groups[folder].length + '</span></div>';
    html += '<div id="' + folderId + '" class="tree-folder-content pl-2 ' + (isCollapsed ? 'collapsed' : '') + '" style="max-height: ' + (isCollapsed ? '0' : groups[folder].length * 50) + 'px">';
    groups[folder].forEach(file => {
      html += '<div class="tree-item flex items-center gap-2" data-path="' + file.path + '">';
      html += '<span>' + getFileIcon(file.name) + '</span><div class="flex-1 min-w-0">';
      html += '<div class="truncate text-sm">' + file.name + '</div>';
      html += '<div class="file-date">' + formatSize(file.size || 0) + '</div></div></div>';
    });
    html += '</div></div>';
  });
  $('tree').innerHTML = html;
  
  $('tree').querySelectorAll('.tree-item').forEach(el => el.addEventListener('click', () => loadFile(el.dataset.path)));
  $('tree').querySelectorAll('.tree-folder-header').forEach(el => {
    el.addEventListener('click', () => {
      const folder = el.dataset.folder;
      const folderId = 'folder-' + folder.replace(/[^a-zA-Z0-9]/g, '-');
      const content = $(folderId);
      const icon = el.querySelector('.folder-icon');
      if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        content.style.maxHeight = content.scrollHeight + 'px';
        icon.classList.remove('collapsed');
        state.folderStates[folder] = true;
      } else {
        content.classList.add('collapsed');
        icon.classList.add('collapsed');
        state.folderStates[folder] = false;
      }
    });
  });
}

function updateDirSelect() {
  const dirs = new Set(['']);
  state.fileList.forEach(file => {
    const parts = file.path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  });
  const dirOptions = Array.from(dirs).sort().map(dir => '<option value="' + dir + '">' + (dir || '根目录') + '</option>').join('');
  $('createDirSelect').innerHTML = dirOptions;
  $('uploadDirSelect').innerHTML = dirOptions;
  const nonRootDirs = Array.from(dirs).filter(d => d).sort().map(dir => '<option value="' + dir + '">' + dir + '</option>').join('');
  $('deleteDirSelect').innerHTML = nonRootDirs;
  $('renameDirSelect').innerHTML = nonRootDirs;
}

async function loadFile(path) {
  if (!state.currentRepo || !state.currentBranch) return;
  $('filepath').textContent = '加载中...';
  try {
    const { owner, repo } = state.currentRepo;
    const res = await api('/api/file?owner=' + owner + '&repo=' + repo + '&branch=' + state.currentBranch + '&path=' + encodeURIComponent(path));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    state.currentFile = path;
    state.currentSha = data.sha;
    state.originalContent = data.content;
    
    $('filepath').textContent = path;
    $('editor').value = data.content;
    $('welcome').classList.add('hidden');
    $('editor').classList.remove('hidden');
    $('fileStatus').classList.add('hidden');
    $('copyFilePathBtn').classList.remove('hidden');
    
    if (path.endsWith('.md')) {
      $('previewToggle').classList.remove('hidden');
      $('preview').classList.remove('hidden');
      $('editor').classList.add('w-1/2');
      $('editor').classList.remove('w-full');
      updatePreview();
    } else {
      $('previewToggle').classList.add('hidden');
      $('preview').classList.add('hidden');
      $('editor').classList.remove('w-1/2');
      $('editor').classList.add('w-full');
    }
    
    document.querySelectorAll('.tree-item').forEach(el => el.classList.toggle('active', el.dataset.path === path));
    updateSaveBtn();
  } catch (e) {
    $('filepath').textContent = '加载失败';
    toast('加载失败: ' + e.message, 'error');
  }
}

async function saveFile() {
  if (!state.currentFile || !state.userRole || state.userRole === 'read' || !state.currentRepo || !state.currentBranch) return;
  $('saveBtn').disabled = true;
  $('saveBtn').textContent = '⏳ 保存中...';
  try {
    const { owner, repo } = state.currentRepo;
    const res = await api('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner, repo, branch: state.currentBranch, path: state.currentFile, content: $('editor').value, sha: state.currentSha })
    });
    if (res.status === 403) throw new Error('无权限');
    const data = await res.json();
    if (data.content?.sha) {
      state.currentSha = data.content.sha;
      state.originalContent = $('editor').value;
      $('fileStatus').classList.add('hidden');
      toast('保存成功!', 'success');
    } else if (data.message) throw new Error(data.message);
  } catch (e) { toast('保存失败: ' + e.message, 'error'); }
  finally {
    $('saveBtn').disabled = false;
    $('saveBtn').textContent = '💾 保存';
    updateSaveBtn();
  }
}

// 上传
$('uploadBtn').addEventListener('click', () => {
  updateDirSelect();
  $('uploadFileInput').value = '';
  $('uploadProgress').classList.add('hidden');
  $('uploadModal').classList.add('show');
});

$('uploadConfirm').addEventListener('click', async () => {
  const files = $('uploadFileInput').files;
  if (!files.length) { toast('请选择文件', 'warning'); return; }
  if (!state.currentRepo || !state.currentBranch) return;
  
  const dir = $('uploadDirSelect').value;
  const { owner, repo } = state.currentRepo;
  
  $('uploadProgress').classList.remove('hidden');
  $('uploadConfirm').disabled = true;
  
  let uploaded = 0;
  for (const file of files) {
    const path = dir ? dir + '/' + file.name : file.name;
    try {
      const reader = new FileReader();
      const content = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo, branch: state.currentBranch, path, content })
      });
      uploaded++;
      $('uploadProgressBar').style.width = (uploaded / files.length * 100) + '%';
      $('uploadProgressText').textContent = uploaded + '/' + files.length;
    } catch (e) { toast('上传失败: ' + file.name, 'error'); }
  }
  $('uploadConfirm').disabled = false;
  toast('上传完成: ' + uploaded + ' 个文件', 'success');
  $('uploadModal').classList.remove('show');
  loadTree();
});

$('uploadCancel').addEventListener('click', () => $('uploadModal').classList.remove('show'));

// 下载
$('downloadTopBtn').addEventListener('click', () => {
  state.downloadFiles.clear();
  renderDownloadFileList();
  $('downloadModal').classList.add('show');
});

function renderDownloadFileList() {
  $('downloadFileList').innerHTML = state.fileList.map(file => 
    '<label class="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-slate-800">' +
      '<input type="checkbox" class="download-file-checkbox w-4 h-4" data-path="' + file.path + '">' +
      '<span>' + getFileIcon(file.path.split('/').pop()) + '</span>' +
      '<span class="truncate flex-1 text-sm">' + file.path + '</span></label>'
  ).join('');
  $('downloadFileList').querySelectorAll('.download-file-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.downloadFiles.add(cb.dataset.path);
      else state.downloadFiles.delete(cb.dataset.path);
      $('downloadSelectedCount').textContent = '已选: ' + state.downloadFiles.size;
    });
  });
  $('downloadSelectedCount').textContent = '已选: 0';
}

$('downloadSelectAll').addEventListener('click', () => {
  $('downloadFileList').querySelectorAll('.download-file-checkbox').forEach(cb => { cb.checked = true; state.downloadFiles.add(cb.dataset.path); });
  $('downloadSelectedCount').textContent = '已选: ' + state.downloadFiles.size;
});
$('downloadDeselectAll').addEventListener('click', () => {
  $('downloadFileList').querySelectorAll('.download-file-checkbox').forEach(cb => cb.checked = false);
  state.downloadFiles.clear();
  $('downloadSelectedCount').textContent = '已选: 0';
});

$('downloadConfirm').addEventListener('click', () => {
  if (state.downloadFiles.size === 0) { toast('请选择要下载的文件', 'warning'); return; }
  if (!state.currentRepo || !state.currentBranch) return;
  const { owner, repo } = state.currentRepo;
  state.downloadFiles.forEach(path => {
    const url = 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + state.currentBranch + '/' + path;
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split('/').pop();
    a.click();
  });
  toast('开始下载 ' + state.downloadFiles.size + ' 个文件...', 'success');
  $('downloadModal').classList.remove('show');
});

$('downloadCancel').addEventListener('click', () => $('downloadModal').classList.remove('show'));

// 分享
$('shareTopBtn').addEventListener('click', () => {
  state.shareFiles.clear();
  renderShareFileList();
  $('shareResults').classList.add('hidden');
  $('shareCopyAll').classList.add('hidden');
  $('shareModal').classList.add('show');
});

function renderShareFileList() {
  $('shareFileList').innerHTML = state.fileList.map(file => 
    '<label class="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-slate-800">' +
      '<input type="checkbox" class="share-file-checkbox w-4 h-4" data-path="' + file.path + '">' +
      '<span>' + getFileIcon(file.path.split('/').pop()) + '</span>' +
      '<span class="truncate flex-1 text-sm">' + file.path + '</span></label>'
  ).join('');
  $('shareFileList').querySelectorAll('.share-file-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.shareFiles.add(cb.dataset.path);
      else state.shareFiles.delete(cb.dataset.path);
      $('shareSelectedCount').textContent = '已选: ' + state.shareFiles.size;
    });
  });
  $('shareSelectedCount').textContent = '已选: 0';
}

$('shareSelectAll').addEventListener('click', () => {
  $('shareFileList').querySelectorAll('.share-file-checkbox').forEach(cb => { cb.checked = true; state.shareFiles.add(cb.dataset.path); });
  $('shareSelectedCount').textContent = '已选: ' + state.shareFiles.size;
});
$('shareDeselectAll').addEventListener('click', () => {
  $('shareFileList').querySelectorAll('.share-file-checkbox').forEach(cb => cb.checked = false);
  state.shareFiles.clear();
  $('shareSelectedCount').textContent = '已选: 0';
});

$('shareGenerate').addEventListener('click', async () => {
  if (state.shareFiles.size === 0) { toast('请选择要分享的文件', 'warning'); return; }
  if (!state.currentRepo || !state.currentBranch) return;
  
  const { owner, repo } = state.currentRepo;
  const encode = $('shareBase64').checked ? '&encode=base64' : '';
  const urls = [];
  
  for (const filePath of state.shareFiles) {
    const path = owner + '/' + repo + '/' + state.currentBranch + '/' + filePath;
    try {
      const res = await api('/api/share-url?path=' + encodeURIComponent(path) + encode);
      const data = await res.json();
      urls.push({ path: filePath, url: data.url });
    } catch (e) { urls.push({ path: filePath, url: '生成失败' }); }
  }
  
  $('shareUrlList').innerHTML = urls.map(u => 
    '<div class="flex items-center gap-2"><input type="text" readonly value="' + u.url + '" class="flex-1 px-2 py-1 bg-slate-700 rounded text-xs">' +
    '<button class="share-copy-btn text-xs bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded" data-url="' + u.url + '">📋</button></div>'
  ).join('');
  
  $('shareUrlList').querySelectorAll('.share-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.url).then(() => toast('已复制', 'success'));
    });
  });
  
  $('shareResults').classList.remove('hidden');
  $('shareCopyAll').classList.remove('hidden');
  window.shareUrls = urls;
});

$('shareCopyAll').addEventListener('click', () => {
  if (window.shareUrls) {
    const text = window.shareUrls.map(u => u.url).join('\\n');
    navigator.clipboard.writeText(text).then(() => toast('已复制全部链接', 'success'));
  }
});

$('shareClose').addEventListener('click', () => $('shareModal').classList.remove('show'));

// 新建
$('createTypeFile').addEventListener('click', () => {
  state.createType = 'file';
  $('createTypeFile').className = 'flex-1 py-2 px-4 bg-blue-600 rounded-lg text-sm';
  $('createTypeFolder').className = 'flex-1 py-2 px-4 bg-slate-600 rounded-lg text-sm';
  $('createNameLabel').textContent = '文件名';
  $('createFileName').placeholder = '例如: notes.md';
});
$('createTypeFolder').addEventListener('click', () => {
  state.createType = 'folder';
  $('createTypeFile').className = 'flex-1 py-2 px-4 bg-slate-600 rounded-lg text-sm';
  $('createTypeFolder').className = 'flex-1 py-2 px-4 bg-blue-600 rounded-lg text-sm';
  $('createNameLabel').textContent = '文件夹名';
  $('createFileName').placeholder = '例如: docs';
});

$('createConfirm').addEventListener('click', async () => {
  if (!state.currentRepo || !state.currentBranch) return;
  const dir = $('createDirSelect').value;
  const name = $('createFileName').value.trim();
  if (!name) { toast('请输入名称', 'warning'); return; }
  const { owner, repo } = state.currentRepo;
  
  if (state.createType === 'file') {
    const fullPath = dir ? dir + '/' + name : name;
    try {
      const res = await api('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo, branch: state.currentBranch, path: fullPath, content: '', sha: null })
      });
      if (res.ok) {
        toast('创建成功!', 'success');
        $('createModal').classList.remove('show');
        $('createFileName').value = '';
        await loadTree();
        setTimeout(() => loadFile(fullPath), 500);
      } else { const data = await res.json(); throw new Error(data.error || '创建失败'); }
    } catch (e) { toast('创建失败: ' + e.message, 'error'); }
  } else {
    const folderPath = dir ? dir + '/' + name : name;
    const gitkeepPath = folderPath + '/.gitkeep';
    try {
      const res = await api('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo, branch: state.currentBranch, path: gitkeepPath, content: '', sha: null })
      });
      if (res.ok) {
        toast('文件夹创建成功!', 'success');
        $('createModal').classList.remove('show');
        $('createFileName').value = '';
        await loadTree();
      } else { const data = await res.json(); throw new Error(data.error || '创建失败'); }
    } catch (e) { toast('创建失败: ' + e.message, 'error'); }
  }
});

$('createBtn').addEventListener('click', () => {
  $('createFileName').value = '';
  state.createType = 'file';
  $('createTypeFile').className = 'flex-1 py-2 px-4 bg-blue-600 rounded-lg text-sm';
  $('createTypeFolder').className = 'flex-1 py-2 px-4 bg-slate-600 rounded-lg text-sm';
  $('createNameLabel').textContent = '文件名';
  updateDirSelect();
  $('createModal').classList.add('show');
});
$('createCancel').addEventListener('click', () => $('createModal').classList.remove('show'));

// 重命名
$('renameBtn').addEventListener('click', () => {
  state.renameType = 'file';
  $('renameTypeFile').className = 'flex-1 py-2 px-3 bg-blue-600 rounded-lg text-sm';
  $('renameTypeDir').className = 'flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm';
  $('renameFileSection').classList.remove('hidden');
  $('renameDirSection').classList.add('hidden');
  updateDirSelect();
  $('renameFileSelect').innerHTML = state.fileList.map(f => '<option value="' + f.path + '">' + f.path + '</option>').join('');
  if (state.currentFile) $('renameFileSelect').value = state.currentFile;
  $('renameNewFileName').value = state.currentFile || '';
  $('renameModal').classList.add('show');
});

$('renameTypeFile').addEventListener('click', () => {
  state.renameType = 'file';
  $('renameTypeFile').className = 'flex-1 py-2 px-3 bg-blue-600 rounded-lg text-sm';
  $('renameTypeDir').className = 'flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm';
  $('renameFileSection').classList.remove('hidden');
  $('renameDirSection').classList.add('hidden');
});

$('renameTypeDir').addEventListener('click', () => {
  state.renameType = 'dir';
  $('renameTypeFile').className = 'flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm';
  $('renameTypeDir').className = 'flex-1 py-2 px-3 bg-blue-600 rounded-lg text-sm';
  $('renameFileSection').classList.add('hidden');
  $('renameDirSection').classList.remove('hidden');
  $('renameNewDirName').value = $('renameDirSelect').value || '';
});

$('renameFileSelect').addEventListener('change', () => {
  $('renameNewFileName').value = $('renameFileSelect').value;
});

$('renameDirSelect').addEventListener('change', () => {
  $('renameNewDirName').value = $('renameDirSelect').value;
});

$('renameConfirm').addEventListener('click', async () => {
  if (!state.currentRepo || !state.currentBranch) return;
  const { owner, repo } = state.currentRepo;
  
  $('renameConfirm').disabled = true;
  $('renameConfirm').textContent = '⏳ 重命名中...';
  
  try {
    if (state.renameType === 'file') {
      const oldPath = $('renameFileSelect').value;
      const newPath = $('renameNewFileName').value.trim();
      if (!newPath) { toast('请输入新文件名', 'warning'); return; }
      if (oldPath === newPath) { toast('文件名未改变', 'warning'); return; }
      
      const res = await api('/api/rename-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo, branch: state.currentBranch, oldPath, newPath })
      });
      const data = await res.json();
      if (data.success) {
        toast('重命名成功!', 'success');
        $('renameModal').classList.remove('show');
        if (state.currentFile === oldPath) state.currentFile = newPath;
        loadTree();
      } else throw new Error(data.error || '重命名失败');
    } else {
      const oldDir = $('renameDirSelect').value;
      const newDir = $('renameNewDirName').value.trim();
      if (!newDir) { toast('请输入新目录名', 'warning'); return; }
      if (oldDir === newDir) { toast('目录名未改变', 'warning'); return; }
      
      const res = await api('/api/rename-dir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo, branch: state.currentBranch, oldDir, newDir })
      });
      const data = await res.json();
      if (data.count > 0) {
        toast('已重命名 ' + data.count + ' 个文件', 'success');
        $('renameModal').classList.remove('show');
        loadTree();
      } else throw new Error(data.error || '重命名失败');
    }
  } catch (e) { toast('重命名失败: ' + e.message, 'error'); }
  finally {
    $('renameConfirm').disabled = false;
    $('renameConfirm').textContent = '✏️ 确认重命名';
  }
});

$('renameCancel').addEventListener('click', () => $('renameModal').classList.remove('show'));

// 删除
function showDeleteModal() {
  state.deleteType = 'file';
  state.selectedFiles.clear();
  $('deleteTypeFile').className = 'flex-1 py-2 px-3 bg-blue-600 rounded-lg text-sm';
  $('deleteTypeDir').className = 'flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm';
  $('deleteTypeRepo').className = 'flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm';
  $('deleteFileSection').classList.remove('hidden');
  $('deleteDirSection').classList.add('hidden');
  $('deleteRepoSection').classList.add('hidden');
  renderDeleteFileList();
  $('deleteModal').classList.add('show');
}

function renderDeleteFileList() {
  $('deleteFileList').innerHTML = state.fileList.map(file => 
    '<label class="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-slate-800">' +
      '<input type="checkbox" class="delete-file-checkbox w-4 h-4" data-path="' + file.path + '">' +
      '<span>' + getFileIcon(file.path.split('/').pop()) + '</span>' +
      '<span class="truncate flex-1 text-sm">' + file.path + '</span></label>'
  ).join('');
  $('deleteFileList').querySelectorAll('.delete-file-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.selectedFiles.add(cb.dataset.path);
      else state.selectedFiles.delete(cb.dataset.path);
      $('deleteSelectedCount').textContent = '已选: ' + state.selectedFiles.size;
    });
  });
  $('deleteSelectedCount').textContent = '已选: 0';
}

$('deleteTypeFile').addEventListener('click', () => {
  state.deleteType = 'file';
  $('deleteTypeFile').className = 'flex-1 py-2 px-3 bg-blue-600 rounded-lg text-sm';
  $('deleteTypeDir').className = 'flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm';
  $('deleteTypeRepo').className = 'flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm';
  $('deleteFileSection').classList.remove('hidden');
  $('deleteDirSection').classList.add('hidden');
  $('deleteRepoSection').classList.add('hidden');
});
$('deleteTypeDir').addEventListener('click', () => {
  state.deleteType = 'dir';
  $('deleteTypeFile').className = 'flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm';
  $('deleteTypeDir').className = 'flex-1 py-2 px-3 bg-blue-600 rounded-lg text-sm';
  $('deleteTypeRepo').className = 'flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm';
  $('deleteFileSection').classList.add('hidden');
  $('deleteDirSection').classList.remove('hidden');
  $('deleteRepoSection').classList.add('hidden');
});
$('deleteTypeRepo').addEventListener('click', () => {
  state.deleteType = 'repo';
  $('deleteTypeFile').className = 'flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm';
  $('deleteTypeDir').className = 'flex-1 py-2 px-3 bg-slate-600 rounded-lg text-sm';
  $('deleteTypeRepo').className = 'flex-1 py-2 px-3 bg-red-600 rounded-lg text-sm';
  $('deleteFileSection').classList.add('hidden');
  $('deleteDirSection').classList.add('hidden');
  $('deleteRepoSection').classList.remove('hidden');
  $('deleteRepoName').textContent = state.currentRepo.owner + '/' + state.currentRepo.repo;
  $('deleteRepoConfirmInput').value = '';
});

$('deleteSelectAll').addEventListener('click', () => {
  $('deleteFileList').querySelectorAll('.delete-file-checkbox').forEach(cb => { cb.checked = true; state.selectedFiles.add(cb.dataset.path); });
  $('deleteSelectedCount').textContent = '已选: ' + state.selectedFiles.size;
});
$('deleteDeselectAll').addEventListener('click', () => {
  $('deleteFileList').querySelectorAll('.delete-file-checkbox').forEach(cb => cb.checked = false);
  state.selectedFiles.clear();
  $('deleteSelectedCount').textContent = '已选: 0';
});

$('deleteConfirm').addEventListener('click', async () => {
  if (!state.currentRepo || !state.currentBranch) return;
  const { owner, repo } = state.currentRepo;
  
  if (state.deleteType === 'file') {
    if (state.selectedFiles.size === 0) { toast('请选择要删除的文件', 'warning'); return; }
    if (!confirm('确定删除选中的 ' + state.selectedFiles.size + ' 个文件？')) return;
    $('deleteConfirm').disabled = true;
    $('deleteConfirm').textContent = '⏳ 删除中...';
    try {
      const res = await api('/api/delete-files', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo, branch: state.currentBranch, files: Array.from(state.selectedFiles) })
      });
      const data = await res.json();
      toast('已删除 ' + data.count + ' 个文件', 'success');
      $('deleteModal').classList.remove('show');
      state.currentFile = null;
      $('editor').classList.add('hidden');
      $('welcome').classList.remove('hidden');
      $('copyFilePathBtn').classList.add('hidden');
      loadTree();
    } catch (e) { toast('删除失败: ' + e.message, 'error'); }
    finally { $('deleteConfirm').disabled = false; $('deleteConfirm').textContent = '🗑️ 确认删除'; }
  } else if (state.deleteType === 'dir') {
    const dir = $('deleteDirSelect').value;
    if (!dir) { toast('请选择目录', 'warning'); return; }
    if (!confirm('确定删除目录 "' + dir + '" 及其所有文件？')) return;
    try {
      const res = await api('/api/delete-dir', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo, branch: state.currentBranch, path: dir })
      });
      const data = await res.json();
      toast('已删除 ' + data.count + ' 个文件', 'success');
      $('deleteModal').classList.remove('show');
      loadTree();
    } catch (e) { toast('删除失败: ' + e.message, 'error'); }
  } else if (state.deleteType === 'repo') {
    if ($('deleteRepoConfirmInput').value.trim() !== state.currentRepo.repo) { toast('仓库名不匹配', 'error'); return; }
    if (!confirm('最后确认：真的要删除整个仓库吗？此操作不可恢复！')) return;
    $('deleteConfirm').disabled = true;
    $('deleteConfirm').textContent = '⏳ 删除中...';
    try {
      const res = await api('/api/delete-repo', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo })
      });
      const data = await res.json();
      if (data.success) { toast('仓库已删除', 'success'); $('deleteModal').classList.remove('show'); loadRepos(); }
      else throw new Error(data.error || '删除失败');
    } catch (e) { toast('删除失败: ' + e.message, 'error'); }
    finally { $('deleteConfirm').disabled = false; $('deleteConfirm').textContent = '🗑️ 确认删除'; }
  }
});

$('deleteBtn').addEventListener('click', showDeleteModal);
$('deleteCancel').addEventListener('click', () => $('deleteModal').classList.remove('show'));

// 搜索仓库
$('searchRepoOpenBtn').addEventListener('click', () => {
  $('searchRepoInput').value = '';
  $('searchRepoResults').innerHTML = '<div class="text-center text-slate-400 py-8">输入关键词搜索 GitHub 仓库</div>';
  $('searchRepoModal').classList.add('show');
});

$('searchRepoBtn').addEventListener('click', async () => {
  const query = $('searchRepoInput').value.trim();
  if (!query) return;
  $('searchRepoResults').innerHTML = '<div class="text-center py-8"><div class="inline-block w-6 h-6 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin"></div></div>';
  try {
    const res = await api('/api/search-repos?q=' + encodeURIComponent(query));
    const repos = await res.json();
    if (!repos.length) { $('searchRepoResults').innerHTML = '<div class="text-center text-slate-400 py-8">无结果</div>'; return; }
    $('searchRepoResults').innerHTML = repos.map((r, i) => 
      '<div class="bg-slate-700 rounded-lg p-3 flex items-center justify-between">' +
        '<div class="flex-1 min-w-0"><div class="font-bold truncate">' + r.owner + '/' + r.repo + '</div>' +
        '<div class="text-xs text-slate-400 truncate">' + (r.description || '无描述') + '</div>' +
        '<div class="text-xs text-slate-500 mt-1">⭐ ' + r.stars + ' 🍴 ' + r.forks + (r.language ? ' 📝 ' + r.language : '') + '</div></div>' +
        '<div class="flex gap-2 ml-2">' +
          '<button class="search-star-btn text-xs bg-yellow-600 hover:bg-yellow-700 px-2 py-1 rounded" data-owner="' + r.owner + '" data-repo="' + r.repo + '">⭐</button>' +
          '<button class="search-fork-btn text-xs bg-purple-600 hover:bg-purple-700 px-2 py-1 rounded" data-owner="' + r.owner + '" data-repo="' + r.repo + '">🍴</button>' +
          '<button class="search-view-btn text-xs bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded" data-owner="' + r.owner + '" data-repo="' + r.repo + '" data-branch="' + r.branch + '">👁️</button>' +
        '</div></div>'
    ).join('');
    window.searchResults = repos;
    $('searchRepoResults').querySelectorAll('.search-star-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await api('/api/star?owner=' + btn.dataset.owner + '&repo=' + btn.dataset.repo, { method: 'POST' });
        if (res.ok) { toast('已关注仓库', 'success'); loadRepos(); }
      });
    });
    $('searchRepoResults').querySelectorAll('.search-fork-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await api('/api/fork?owner=' + btn.dataset.owner + '&repo=' + btn.dataset.repo, { method: 'POST' });
        const data = await res.json();
        if (data.id) { toast('Fork 成功!', 'success'); loadRepos(); }
        else toast('Fork 失败: ' + (data.message || ''), 'error');
      });
    });
    $('searchRepoResults').querySelectorAll('.search-view-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        state.currentRepo = { owner: btn.dataset.owner, repo: btn.dataset.repo, branch: btn.dataset.branch, source: 'search' };
        state.currentBranch = btn.dataset.branch;
        $('searchRepoModal').classList.remove('show');
        await loadBranches();
        loadTree();
        toast('正在查看: ' + btn.dataset.owner + '/' + btn.dataset.repo, 'info');
      });
    });
  } catch (e) { $('searchRepoResults').innerHTML = '<div class="text-center text-red-400 py-8">搜索失败</div>'; }
});

$('searchRepoInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('searchRepoBtn').click(); });
$('searchRepoClose').addEventListener('click', () => $('searchRepoModal').classList.remove('show'));

// Releases
$('releaseBtn').addEventListener('click', () => { loadReleases(); $('releaseModal').classList.add('show'); });
$('releaseClose').addEventListener('click', () => $('releaseModal').classList.remove('show'));
$('releaseCloseTop').addEventListener('click', () => $('releaseModal').classList.remove('show'));

$('tabReleases').addEventListener('click', () => {
  $('tabReleases').classList.add('active');
  $('tabNewRelease').classList.remove('active');
  $('releasesList').classList.remove('hidden');
  $('newReleaseForm').classList.add('hidden');
});
$('tabNewRelease').addEventListener('click', () => {
  $('tabNewRelease').classList.add('active');
  $('tabReleases').classList.remove('active');
  $('releasesList').classList.add('hidden');
  $('newReleaseForm').classList.remove('hidden');
});

async function loadReleases() {
  if (!state.currentRepo) return;
  $('releasesList').innerHTML = '<div class="text-center py-8"><div class="inline-block w-6 h-6 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin"></div></div>';
  try {
    const { owner, repo } = state.currentRepo;
    const res = await api('/api/releases?owner=' + owner + '&repo=' + repo);
    const releases = await res.json();
    if (!releases.length) { $('releasesList').innerHTML = '<div class="text-center py-8 text-slate-400">暂无版本</div>'; return; }
    $('releasesList').innerHTML = releases.map((r, idx) => 
      '<div class="bg-slate-700 rounded-lg p-3 mb-2">' +
        '<div class="flex items-center justify-between cursor-pointer release-header" data-index="' + idx + '">' +
          '<div class="flex items-center gap-3"><span class="release-toggle text-slate-400">▶</span><span class="font-bold">' + r.name + '</span>' +
          '<span class="text-xs px-2 py-0.5 rounded-full bg-blue-600">' + r.tag_name + '</span>' +
          (r.draft ? '<span class="text-xs px-2 py-0.5 rounded-full bg-gray-600">草稿</span>' : '') +
          (r.prerelease ? '<span class="text-xs px-2 py-0.5 rounded-full bg-yellow-600">预发布</span>' : '') + '</div>' +
          '<button class="release-delete-btn text-red-400 hover:text-red-300 text-sm" data-id="' + r.id + '" onclick="event.stopPropagation()">🗑️</button></div>' +
        '<div class="release-content hidden mt-3 pt-3 border-t border-slate-600 text-sm">' +
          '<div class="mb-2"><span class="text-slate-400">发布者:</span> ' + (r.author?.login || 'Unknown') + '</div>' +
          '<div class="mb-2"><span class="text-slate-400">发布时间:</span> ' + new Date(r.published_at).toLocaleString('zh-CN') + '</div>' +
          (r.body ? '<div class="mb-2"><span class="text-slate-400">说明:</span><div class="mt-1 p-2 bg-slate-800 rounded text-slate-300 whitespace-pre-wrap">' + r.body + '</div></div>' : '') +
          (r.assets && r.assets.length > 0 ? '<div><span class="text-slate-400">附件 (' + r.assets.length + '):</span><div class="mt-1 space-y-1">' + r.assets.map(a => '<a href="' + a.browser_download_url + '" target="_blank" class="block text-blue-400 hover:text-blue-300 text-xs truncate">📎 ' + a.name + ' (' + (a.size / 1024 / 1024).toFixed(2) + ' MB)</a>').join('') + '</div></div>' : '') +
        '</div></div>'
    ).join('');
    $('releasesList').querySelectorAll('.release-header').forEach(header => {
      header.addEventListener('click', () => {
        const content = header.nextElementSibling;
        const toggle = header.querySelector('.release-toggle');
        if (content.classList.contains('hidden')) { content.classList.remove('hidden'); toggle.textContent = '▼'; }
        else { content.classList.add('hidden'); toggle.textContent = '▶'; }
      });
    });
    $('releasesList').querySelectorAll('.release-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteReleaseHandler(btn.dataset.id));
    });
  } catch (e) { $('releasesList').innerHTML = '<div class="text-center py-8 text-red-400">加载失败</div>'; }
}

async function deleteReleaseHandler(id) {
  if (!confirm('确定删除此版本？')) return;
  if (!state.currentRepo) return;
  try {
    const { owner, repo } = state.currentRepo;
    const res = await api('/api/releases/' + id + '?owner=' + owner + '&repo=' + repo, { method: 'DELETE' });
    if (res.ok) { toast('删除成功', 'success'); loadReleases(); }
  } catch (e) { toast('删除失败', 'error'); }
}

$('createReleaseBtn').addEventListener('click', async () => {
  if (!state.currentRepo) return;
  const tag = $('releaseTag').value.trim();
  const title = $('releaseTitle').value.trim();
  const body = $('releaseBody').value;
  const draft = $('releaseDraft').checked;
  const prerelease = $('releasePrerelease').checked;
  const files = $('releaseFiles').files;
  if (!tag || !title) { toast('请填写 Tag 和标题', 'warning'); return; }
  $('createReleaseBtn').disabled = true;
  $('createReleaseBtn').textContent = '⏳ 发布中...';
  try {
    const { owner, repo } = state.currentRepo;
    const res = await api('/api/releases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner, repo, tag_name: tag, name: title, body, draft, prerelease })
    });
    const release = await res.json();
    if (!release.id) throw new Error(release.message || '创建失败');
    if (files.length > 0) {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('owner', owner);
        formData.append('repo', repo);
        formData.append('release_id', release.id);
        formData.append('upload_url', release.upload_url);
        await api('/api/upload-asset', { method: 'POST', body: formData });
      }
      toast('附件上传成功!', 'success');
    }
    toast('发布成功!', 'success');
    $('releaseTag').value = '';
    $('releaseTitle').value = '';
    $('releaseBody').value = '';
    $('releaseFiles').value = '';
    $('tabReleases').click();
    loadReleases();
  } catch (e) { toast('发布失败: ' + e.message, 'error'); }
  finally { $('createReleaseBtn').disabled = false; $('createReleaseBtn').textContent = '🚀 发布'; }
});

function updatePreview() {
  if (state.currentFile?.endsWith('.md')) {
    $('preview').innerHTML = marked.parse($('editor').value);
    $('preview').querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
  }
}

function updateSaveBtn() {
  $('saveBtn').disabled = !state.userRole || state.userRole === 'read' || !state.currentFile;
}

function updateRoleUI() {
  const cfg = { admin: ['👑 管理员', 'bg-purple-600'], write: ['✏️ 编辑者', 'bg-green-600'], read: ['👁️ 只读', 'bg-blue-600'] };
  if (state.userRole && cfg[state.userRole]) {
    $('roleTag').textContent = cfg[state.userRole][0];
    $('roleTag').className = 'text-xs px-2 py-1 rounded-full ' + cfg[state.userRole][1];
    $('logoutBtn').classList.remove('hidden');
    if (state.userRole !== 'read') {
      $('createBtn').classList.remove('hidden');
      $('uploadBtn').classList.remove('hidden');
      $('renameBtn').classList.remove('hidden');
      $('deleteBtn').classList.remove('hidden');
      $('shareTopBtn').classList.remove('hidden');
      $('releaseBtn').classList.remove('hidden');
      $('repoActions').classList.remove('hidden');
    }
  } else {
    $('roleTag').textContent = '🚶 游客';
    $('roleTag').className = 'text-xs px-2 py-1 rounded-full bg-slate-600';
    $('logoutBtn').classList.add('hidden');
    $('createBtn').classList.add('hidden');
    $('uploadBtn').classList.add('hidden');
    $('renameBtn').classList.add('hidden');
    $('deleteBtn').classList.add('hidden');
    $('shareTopBtn').classList.add('hidden');
    $('releaseBtn').classList.add('hidden');
    $('repoActions').classList.add('hidden');
  }
  updateSaveBtn();
}

async function verifyToken(token) {
  try {
    const res = await fetch('/api/verify', { headers: { 'X-Token': token } });
    if (res.ok) { const data = await res.json(); return data.role; }
  } catch (e) {}
  return null;
}

async function loadFriendLinks() {
  try {
    const res = await api('/api/friend-links');
    const links = await res.json();
    if (links && links.length > 0) {
      $('friendLinksTop').classList.remove('hidden');
      $('friendLinksTop').innerHTML = links.map(link => 
        '<a href="' + link.url + '" target="_blank" class="text-sm text-blue-400 hover:text-blue-300 px-2 py-1 bg-slate-700 rounded transition">' + link.name + '</a>'
      ).join('');
    }
  } catch (e) {}
}

$('authBtn').addEventListener('click', async () => {
  const token = $('tokenInput').value.trim();
  if (!token) { $('authError').textContent = '请输入 Token'; $('authError').classList.remove('hidden'); return; }
  const role = await verifyToken(token);
  if (role) {
    state.userToken = token;
    state.userRole = role;
    localStorage.setItem('editorToken', token);
    $('authModal').classList.remove('show');
    updateRoleUI();
    loadRepos();
    loadFriendLinks();
    toast('登录成功! 权限: ' + role, 'success');
  } else { $('authError').textContent = 'Token 无效'; $('authError').classList.remove('hidden'); }
});

$('tokenInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('authBtn').click(); });

$('guestBtn').addEventListener('click', () => {
  $('authModal').classList.remove('show');
  updateRoleUI();
  loadRepos();
  loadFriendLinks();
});

$('logoutBtn').addEventListener('click', () => {
  state.userRole = null;
  state.userToken = '';
  state.currentFile = null;
  localStorage.removeItem('editorToken');
  $('editor').classList.add('hidden');
  $('welcome').classList.remove('hidden');
  $('copyFilePathBtn').classList.add('hidden');
  $('authModal').classList.add('show');
  $('tokenInput').value = '';
  updateRoleUI();
  toast('已退出', 'info');
});

$('expandAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.tree-folder-content').forEach(el => { el.classList.remove('collapsed'); el.style.maxHeight = el.scrollHeight + 'px'; });
  document.querySelectorAll('.folder-icon').forEach(el => el.classList.remove('collapsed'));
  state.folderStates = {};
});

$('collapseAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.tree-folder-content').forEach(el => el.classList.add('collapsed'));
  document.querySelectorAll('.folder-icon').forEach(el => el.classList.add('collapsed'));
  document.querySelectorAll('.tree-folder-header').forEach(el => { state.folderStates[el.dataset.folder] = false; });
});

$('search').addEventListener('input', e => renderTree(state.fileList, e.target.value));
$('editor').addEventListener('input', () => {
  $('fileStatus').classList.toggle('hidden', $('editor').value === state.originalContent);
  if (state.currentFile?.endsWith('.md')) updatePreview();
});
$('saveBtn').addEventListener('click', saveFile);
$('refreshTopBtn').addEventListener('click', loadTree);
$('previewToggle').addEventListener('click', () => {
  state.isPreviewVisible = !state.isPreviewVisible;
  $('preview').classList.toggle('hidden', !state.isPreviewVisible);
  $('editor').classList.toggle('w-1/2', state.isPreviewVisible);
  $('editor').classList.toggle('w-full', !state.isPreviewVisible);
  $('previewToggle').textContent = state.isPreviewVisible ? '📝 仅编辑' : '👁️ 预览';
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (!$('saveBtn').disabled) saveFile(); }
});

const saved = localStorage.getItem('editorToken');
if (saved) {
  verifyToken(saved).then(role => {
    if (role) {
      state.userToken = saved;
      state.userRole = role;
      $('authModal').classList.remove('show');
      updateRoleUI();
      loadRepos();
      loadFriendLinks();
    }
  });
}
</script>
</body>
</html>`;

// ========== 路由处理 ==========

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (path === "/" || path === "/index.html") {
      return htmlResponse(FRONTEND_HTML);
    }

    if (path.startsWith("/share/")) {
      const fullPath = decodeURIComponent(path.substring(7));
      const sign = url.searchParams.get("sign");
      const encode = url.searchParams.get("encode");
      
      const secret = getShareSecret(env);
      if (!sign || !verifyShareSign(fullPath, sign, secret)) {
        return textResponse("无效的分享链接（需要签名）", 403);
      }
      
      const parts = fullPath.split('/');
      if (parts.length < 4) return textResponse("路径格式错误", 400);
      const owner = parts[0];
      const repo = parts[1];
      const branch = parts[2];
      const filePath = parts.slice(3).join('/');
      
      try {
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
        const res = await githubFetch(env, apiUrl);
        if (!res.ok) return textResponse("文件不存在", 404);
        const data = await res.json();
        let content = base64ToUtf8(data.content.replace(/\n/g, ''));
        if (encode === "base64") content = utf8ToBase64(content);
        return new Response(content, {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0", ...corsHeaders() }
        });
      } catch (e) { return textResponse("读取失败: " + e.message, 500); }
    }

    if (path === "/api/repos") {
      try { return jsonResponse(await getAllRepos(env)); }
      catch (e) { return jsonResponse({ owned: FALLBACK_REPOS, forked: [], starred: [] }); }
    }

    if (path === "/api/branches") {
      const owner = url.searchParams.get("owner");
      const repo = url.searchParams.get("repo");
      if (!owner || !repo) return jsonResponse({ error: "Missing params" }, 400);
      try { return jsonResponse(await getBranches(env, owner, repo)); }
      catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path === "/api/search-repos") {
      const query = url.searchParams.get("q");
      if (!query) return jsonResponse([]);
      try { return jsonResponse(await searchRepos(env, query)); }
      catch (e) { return jsonResponse([]); }
    }

    if (path === "/api/star") {
      const role = checkAuth(request, env);
      if (!role || role === "read") return jsonResponse({ error: "No permission" }, 403);
      const owner = url.searchParams.get("owner");
      const repo = url.searchParams.get("repo");
      if (!owner || !repo) return jsonResponse({ error: "Missing params" }, 400);
      const success = await starRepo(env, owner, repo);
      return success ? jsonResponse({ success: true }) : jsonResponse({ error: "Failed" }, 500);
    }

    if (path === "/api/unstar") {
      const role = checkAuth(request, env);
      if (!role || role === "read") return jsonResponse({ error: "No permission" }, 403);
      const owner = url.searchParams.get("owner");
      const repo = url.searchParams.get("repo");
      if (!owner || !repo) return jsonResponse({ error: "Missing params" }, 400);
      const success = await unstarRepo(env, owner, repo);
      return success ? jsonResponse({ success: true }) : jsonResponse({ error: "Failed" }, 500);
    }

    if (path === "/api/fork") {
      const role = checkAuth(request, env);
      if (!role || role === "read") return jsonResponse({ error: "No permission" }, 403);
      const owner = url.searchParams.get("owner");
      const repo = url.searchParams.get("repo");
      if (!owner || !repo) return jsonResponse({ error: "Missing params" }, 400);
      try { return jsonResponse(await forkRepo(env, owner, repo)); }
      catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path === "/api/share-url") {
      const filePath = url.searchParams.get("path");
      const encode = url.searchParams.get("encode");
      if (!filePath) return jsonResponse({ error: "Missing path" }, 400);
      const secret = getShareSecret(env);
      const sign = generateShareSign(filePath, secret);
      let shareUrl = url.origin + '/share/' + encodeURIComponent(filePath) + '?sign=' + sign;
      if (encode) shareUrl += '&encode=' + encode;
      shareUrl += '&t=' + Date.now();
      return jsonResponse({ url: shareUrl, sign });
    }

    if (path === "/api/verify") {
      const role = checkAuth(request, env);
      if (role) return jsonResponse({ success: true, role });
      return jsonResponse({ success: false, message: "Invalid token" }, 401);
    }

    if (path === "/api/friend-links") {
      return jsonResponse(getFriendLinks(env));
    }

    if (path === "/api/tree") {
      const owner = url.searchParams.get("owner");
      const repo = url.searchParams.get("repo");
      const branch = url.searchParams.get("branch") || "main";
      if (!owner || !repo) return jsonResponse({ error: "Missing params" }, 400);
      try { return jsonResponse(await getTree(env, owner, repo, branch)); }
      catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path === "/api/file") {
      const owner = url.searchParams.get("owner");
      const repo = url.searchParams.get("repo");
      const branch = url.searchParams.get("branch") || "main";
      const filePath = url.searchParams.get("path");
      if (!owner || !repo || !filePath) return jsonResponse({ error: "Missing params" }, 400);
      try {
        const result = await getFileAsText(env, owner, repo, branch, filePath);
        if (result.error) return jsonResponse({ error: result.error }, 404);
        return jsonResponse(result);
      } catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path === "/api/save") {
      const role = checkAuth(request, env);
      if (!role) return jsonResponse({ error: "Unauthorized" }, 401);
      if (role === "read") return jsonResponse({ error: "No permission" }, 403);
      try {
        const body = await request.json();
        const { owner, repo, branch, path: filePath, content, sha } = body;
        if (!owner || !repo || !filePath || content === undefined) return jsonResponse({ error: "Missing params" }, 400);
        const result = await saveFile(env, owner, repo, branch || "main", filePath, content, sha);
        return jsonResponse(result);
      } catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path === "/api/upload") {
      const role = checkAuth(request, env);
      if (!role) return jsonResponse({ error: "Unauthorized" }, 401);
      if (role === "read") return jsonResponse({ error: "No permission" }, 403);
      try {
        const body = await request.json();
        const { owner, repo, branch, path: filePath, content } = body;
        if (!owner || !repo || !filePath || !content) return jsonResponse({ error: "Missing params" }, 400);
        const result = await uploadFileToRepo(env, owner, repo, branch || "main", filePath, content);
        return jsonResponse(result);
      } catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path === "/api/rename-file") {
      const role = checkAuth(request, env);
      if (!role) return jsonResponse({ error: "Unauthorized" }, 401);
      if (role === "read") return jsonResponse({ error: "No permission" }, 403);
      try {
        const body = await request.json();
        const { owner, repo, branch, oldPath, newPath } = body;
        if (!owner || !repo || !oldPath || !newPath) return jsonResponse({ error: "Missing params" }, 400);
        const result = await renameFile(env, owner, repo, branch || "main", oldPath, newPath);
        return jsonResponse(result);
      } catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path === "/api/rename-dir") {
      const role = checkAuth(request, env);
      if (!role) return jsonResponse({ error: "Unauthorized" }, 401);
      if (role === "read") return jsonResponse({ error: "No permission" }, 403);
      try {
        const body = await request.json();
        const { owner, repo, branch, oldDir, newDir } = body;
        if (!owner || !repo || !oldDir || !newDir) return jsonResponse({ error: "Missing params" }, 400);
        const result = await renameDirectory(env, owner, repo, branch || "main", oldDir, newDir);
        return jsonResponse(result);
      } catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path === "/api/delete-files") {
      const role = checkAuth(request, env);
      if (!role) return jsonResponse({ error: "Unauthorized" }, 401);
      if (role === "read") return jsonResponse({ error: "No permission" }, 403);
      try {
        const body = await request.json();
        const { owner, repo, branch, files } = body;
        if (!files || !files.length) return jsonResponse({ error: "No files" }, 400);
        let count = 0;
        for (const filePath of files) {
          const fileData = await githubAPI(env, owner, repo, filePath);
          if (fileData.sha) { await deleteFile(env, owner, repo, branch || "main", filePath, fileData.sha); count++; }
        }
        return jsonResponse({ count });
      } catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path === "/api/delete-dir") {
      const role = checkAuth(request, env);
      if (!role) return jsonResponse({ error: "Unauthorized" }, 401);
      if (role === "read") return jsonResponse({ error: "No permission" }, 403);
      try {
        const body = await request.json();
        const { owner, repo, branch, path: dirPath } = body;
        return jsonResponse(await deleteDirectory(env, owner, repo, branch || "main", dirPath));
      } catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path === "/api/delete-repo") {
      const role = checkAuth(request, env);
      if (role !== "admin") return jsonResponse({ error: "需要管理员权限" }, 403);
      try {
        const body = await request.json();
        const { owner, repo } = body;
        const result = await deleteRepository(env, owner, repo);
        return jsonResponse(result);
      } catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path === "/api/releases" && request.method === "GET") {
      const owner = url.searchParams.get("owner");
      const repo = url.searchParams.get("repo");
      if (!owner || !repo) return jsonResponse({ error: "Missing params" }, 400);
      try { return jsonResponse(await getReleases(env, owner, repo)); }
      catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path === "/api/releases" && request.method === "POST") {
      const role = checkAuth(request, env);
      if (!role || role === "read") return jsonResponse({ error: "No permission" }, 403);
      try {
        const body = await request.json();
        const { owner, repo, tag_name, name, body: releaseBody, draft, prerelease } = body;
        return jsonResponse(await createRelease(env, owner, repo, tag_name, name, releaseBody || '', draft, prerelease));
      } catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path.startsWith("/api/releases/") && request.method === "DELETE") {
      const role = checkAuth(request, env);
      if (!role || role === "read") return jsonResponse({ error: "No permission" }, 403);
      const owner = url.searchParams.get("owner");
      const repo = url.searchParams.get("repo");
      const releaseId = path.split("/").pop();
      try {
        const success = await deleteRelease(env, owner, repo, releaseId);
        return success ? jsonResponse({ success: true }) : jsonResponse({ error: "Failed" }, 500);
      } catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    if (path === "/api/upload-asset" && request.method === "POST") {
      const role = checkAuth(request, env);
      if (!role || role === "read") return jsonResponse({ error: "No permission" }, 403);
      try {
        const formData = await request.formData();
        const file = formData.get("file");
        const uploadUrl = formData.get("upload_url");
        if (!file || !uploadUrl) return jsonResponse({ error: "Missing file or upload_url" }, 400);
        const arrayBuffer = await file.arrayBuffer();
        const result = await uploadReleaseAsset(env, uploadUrl, file.name, arrayBuffer, file.type);
        return jsonResponse(result);
      } catch (e) { return jsonResponse({ error: e.message }, 500); }
    }

    return jsonResponse({ error: "Not found" }, 404);
  }
};
1优化排版，小屏幕操作困难（建议操作按钮全部放在最上面）
2分享功能要改一下，分享出去总是txt格式的，我的要求是改为，分享的文件是什么格式分享出去别人看到的就是什么格式的
3友情链接功能删掉
4我是在cloudflare上面部署worker
