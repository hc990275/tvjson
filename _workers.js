// 新增页面明暗：浅色/深色/跟随系统
// 新增自定义数据源
// 新增CFnew版IP输出方式，方便一键复制
// 新增环境变量添加密码，且输出结果url不需要密码，方便引用
// 改变默认edgetunnel输出方式为纯节点，方便结合Sub Store使用
// 更改时间格式为24时制并新增年月日显示
// 增加了Token管理
// 新增CFnew自动更新引用url
// 自定义优质IP数量
const FAST_IP_COUNT = 20; // 修改这个数字来自定义优质IP数量
const AUTO_TEST_MAX_IPS = 200; // 自动测速的最大IP数量，避免测速过多导致超时

export default {
    async scheduled(event, env, ctx) {
      console.log('Running scheduled IP update...');

      try {
        if (!env.IP_STORAGE) {
          console.error('KV namespace IP_STORAGE is not bound');
          return;
        }

        const startTime = Date.now();
        const { uniqueIPs, results } = await updateAllIPs(env);
        const duration = Date.now() - startTime;

        await env.IP_STORAGE.put('cloudflare_ips', JSON.stringify({
          ips: uniqueIPs,
          lastUpdated: new Date().toISOString(),
          count: uniqueIPs.length,
          sources: results
        }));

        // 自动触发测速并存储优质IP
        await autoSpeedTestAndStore(env, uniqueIPs);

        console.log(`Scheduled update: ${uniqueIPs.length} IPs collected in ${duration}ms`);
      } catch (error) {
        console.error('Scheduled update failed:', error);
      }
    },
  
    async fetch(request, env, ctx) {
      if (!env.password) {
        return new Response('未配置password环境变量！', {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }

      const _authUrl = new URL(request.url);
      const _clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

      if (_authUrl.pathname === '/auth-login' && request.method === 'POST') {
        return await handleLoginRequest(request, env, _clientIP);
      }

      // 新增：退出登录后端处理
      if (_authUrl.pathname === '/auth-logout') {
        return new Response(JSON.stringify({ success: true }), {
          headers: { 
            'Content-Type': 'application/json',
            'Set-Cookie': 'cf_ip_auth=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure' 
          }
        });
      }

      const _cookie = request.headers.get('Cookie') || '';
      const _isAuthorized = await verifyAuthCookie(_cookie, env.password);

      if (!_isAuthorized && _authUrl.pathname !== '/edgetunnel.txt' && _authUrl.pathname !== '/cfnew.txt' && _authUrl.pathname !== '/cf-custom-port') {
        return await serveAuthPage(env);
      }


      const url = new URL(request.url);
      const path = url.pathname;
      
      // 检查 KV 是否绑定
      if (!env.IP_STORAGE) {
        return new Response('KV namespace IP_STORAGE is not bound. Please bind it in Worker settings.', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
      
      if (request.method === 'OPTIONS') {
        return handleCORS();
      }

      try {
        switch (path) {
          case '/':
            return await serveHTML(env);
          case '/update':
            if (request.method !== 'POST') {
              return jsonResponse({ error: 'Method not allowed' }, 405);
            }
            return await handleUpdate(env);
          case '/ips':
            return await handleGetIPs(env);
          case '/ip.txt':
            return await handleGetIPs(env);
          case '/raw':
            return await handleRawIPs(env);
          case '/speedtest':
            return await handleSpeedTest(request, env);
          case '/itdog-data':
            return await handleItdogData(env);
          case '/fast-ips':
            return await handleGetFastIPs(env);
          case '/fast-ips.txt':
            return await handleGetFastIPsText(env);
          // 新增路由：EdgeTunnel版
          case '/edgetunnel.txt':
            return await handleGetEdgeTunnelIPs(request, env);
          // 新增路由：CFNew版
          case '/cfnew.txt':
            return await handleGetCFNewIPs(request, env);
          // 新增路由：自定义端口版
          case '/cf-custom-port':
            return await handleGetCFCustomPort(request, env);
          // --- 新增路由：自定义来源 ---
          case '/save-custom-source':
            return await handleSaveCustomSource(request, env);
          case '/get-custom-source':
            return await handleGetCustomSource(env);
          // --- 新增路由：删除自定义来源 ---
          case '/delete-custom-source':
            return await handleDeleteCustomSource(request, env);
          // --- 新增：Token管理 ---
          case '/admin-token':
            return await handleAdminToken(request, env);
          default:
            return jsonResponse({ error: 'Endpoint not found' }, 404);
        }
      } catch (error) {
        console.error('Error:', error);
        return jsonResponse({ error: error.message }, 500);
      }
    }
  };
  
  // 提供HTML页面
  async function serveHTML(env) {
    const data = await getStoredIPs(env);
    
    // 获取测速后的IP数据
    const speedData = await getStoredSpeedIPs(env);
    const fastIPs = speedData.fastIPs || [];
    // --- 新增：获取Token配置 ---
    const tokenConfig = await getTokenConfig(env);
    const tokenParam = (tokenConfig && tokenConfig.token) ? `?token=${tokenConfig.token}` : '';
    const html = `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
  <link rel="icon" href="https://raw.githubusercontent.com/alienwaregf/personal-use/refs/heads/main/image/Favicon/GF.svg" type="image/svg+xml">
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cloudflare IP 收集器</title>
      <style>
          * { 
              margin: 0; 
              padding: 0; 
              box-sizing: border-box; 
          }
          
          :root {
              --bg-color: #f8fafc;
              --text-color: #334155;
              --card-bg: white;
              --card-border: #e2e8f0;
              --stat-bg: #f8fafc;
              --ip-list-bg: #f8fafc;
              --hover-bg: #f1f5f9;
              --modal-bg: white;
          }

          body.dark-mode {
              --bg-color: #0f172a;
              --text-color: #cbd5e1;
              --card-bg: #1e293b;
              --card-border: #334155;
              --stat-bg: #334155;
              --ip-list-bg: #0f172a;
              --hover-bg: #334155;
              --modal-bg: #1e293b;
          }

          body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
              line-height: 1.6; 
              background: var(--bg-color);
              color: var(--text-color);
              min-height: 100vh;
              padding: 20px;
              transition: background 0.3s, color 0.3s;
          }
          
          .container {
              max-width: 1200px;
              margin: 0 auto;
          }
          
          /* 头部和社交图标 */
          .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 40px;
              padding-bottom: 20px;
              border-bottom: 1px solid var(--card-border);
          }
          
          .header-content h1 {
              font-size: 2.5rem;
              background: linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              margin-bottom: 8px;
              font-weight: 700;
          }
          
          .header-content p {
              color: #64748b;
              font-size: 1.1rem;
          }
          
          .social-links {
              display: flex;
              gap: 15px;
              align-items: center;
          }
          
          .social-link, .theme-toggle {
              display: flex;
              align-items: center;
              justify-content: center;
              width: 44px;
              height: 44px;
              border-radius: 12px;
              background: var(--card-bg);
              border: 1px solid var(--card-border);
              transition: all 0.3s ease;
              text-decoration: none;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
              cursor: pointer;
              color: var(--text-color);
          }

          /* 修复图标居中问题 */
          .social-link svg {
              display: block;
          }
          
          .social-link:hover, .theme-toggle:hover {
              background: var(--hover-bg);
              transform: translateY(-2px);
              border-color: #cbd5e1;
              box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          }
          
          .social-link.youtube { color: #dc2626; }
          .social-link.youtube:hover { background: #fef2f2; border-color: #fecaca; }
          .social-link.github { color: var(--text-color); }
          .social-link.github:hover { background: var(--hover-bg); border-color: #cbd5e1; }
          .social-link.telegram { color: #3b82f6; }
          .social-link.telegram:hover { background: #eff6ff; border-color: #bfdbfe; }
          
          .theme-toggle svg {
              fill: none;
              stroke: currentColor;
              stroke-width: 2;
              stroke-linecap: round;
              stroke-linejoin: round;
          }

          /* 卡片设计 */
          .card {
              background: var(--card-bg);
              border-radius: 16px;
              padding: 30px;
              margin-bottom: 24px;
              border: 1px solid var(--card-border);
              box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
          }
          
          .card h2 {
              font-size: 1.5rem;
              color: #3b82f6;
              margin-bottom: 20px;
              font-weight: 600;
          }
          
          /* 统计数字 */
          .stats {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
              gap: 16px;
              margin-bottom: 24px;
          }
          
          .stat {
              background: var(--stat-bg);
              padding: 20px;
              border-radius: 12px;
              text-align: center;
              border: 1px solid var(--card-border);
          }
          
          .stat-value {
              font-size: 2rem;
              font-weight: 700;
              color: #3b82f6;
              margin-bottom: 8px;
          }

          .stat-date {
              font-size: 0.9rem;
              color: #64748b;
              margin-bottom: 4px;
          }
          
          /* 按钮组 */
          .button-group {
              display: flex;
              flex-wrap: wrap;
              gap: 12px;
              margin-bottom: 20px;
          }
          
          .button {
              padding: 12px 20px;
              border: none;
              border-radius: 10px;
              font-size: 0.95rem;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.3s ease;
              text-decoration: none;
              display: inline-flex;
              align-items: center;
              gap: 8px;
              background: #3b82f6;
              color: white;
              border: 1px solid #3b82f6;
          }
          
          .button:hover {
              transform: translateY(-1px);
              box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3);
          }
          
          .button:disabled {
              opacity: 0.6;
              cursor: not-allowed;
              transform: none;
              box-shadow: none;
          }
          
          .button-success { background: #10b981; border-color: #10b981; }
          .button-success:hover { background: #059669; border-color: #059669; }
          
          .button-warning { background: #f59e0b; border-color: #f59e0b; }
          .button-warning:hover { background: #d97706; border-color: #d97706; }
          
          .button-secondary { background: var(--card-bg); color: var(--text-color); border-color: var(--card-border); }
          .button-secondary:hover { background: var(--hover-bg); border-color: #94a3b8; }
          
          /* 定制按钮样式 */
          .button-edgetunnel {
              background-color: #374151; /* 灰色背景 */
              color: #f97316; /* 橙色字体 */
              border: 1px solid #f97316; /* 橙色边框 */
          }
          .button-edgetunnel:hover {
              background-color: #1f2937;
              box-shadow: 0 4px 8px rgba(249, 115, 22, 0.2);
          }

          .button-cfnew {
              background-color: #000000; /* 黑色背景 */
              color: #00ff00; /* 绿色字体 */
              border: 1px solid #00ff00; /* 绿色边框 */
              text-shadow: 0 0 5px #00ff00; /* 字体微光 */
              box-shadow: 0 0 5px rgba(0, 255, 0, 0.3); /* 边框微光 */
          }
          .button-cfnew:hover {
              background-color: #0a0a0a;
              box-shadow: 0 0 15px rgba(0, 255, 0, 0.6);
          }

          /* 下拉按钮组 */
          .dropdown {
              position: relative;
              display: inline-block;
          }

          /* 修复下拉菜单无法选中：增加一个透明的桥接层，防止鼠标移出按钮时菜单消失 */
          .dropdown::after {
              content: '';
              position: absolute;
              top: 100%;
              left: 0;
              width: 100%;
              height: 10px; /* 覆盖间隙 */
          }
          
          .dropdown-content {
              display: none;
              position: absolute;
              background-color: var(--card-bg);
              min-width: 160px;
              box-shadow: 0 8px 16px 0 rgba(0,0,0,0.2);
              z-index: 100;
              border-radius: 10px;
              border: 1px solid var(--card-border);
              overflow: hidden;
              top: 100%;
              left: 50%;
              transform: translateX(-50%);
              margin-top: 5px;
          }
          
          .dropdown-content a {
              color: var(--text-color);
              padding: 12px 16px;
              text-decoration: none;
              display: block;
              border-bottom: 1px solid var(--card-border);
              transition: all 0.3s ease;
              text-align: center;
              cursor: pointer;
          }
          
          .dropdown-content a:hover {
              background-color: var(--hover-bg);
              color: #3b82f6;
          }
          
          .dropdown-content a:last-child {
              border-bottom: none;
          }
          
          .dropdown:hover .dropdown-content {
              display: block;
          }
          
          .dropdown-btn {
              display: flex;
              align-items: center;
              gap: 4px;
          }
          
          /* IP 列表 */
          .ip-list-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 20px;
              flex-wrap: wrap;
              gap: 15px;
          }
          
          .ip-list {
              background: var(--ip-list-bg);
              border-radius: 12px;
              padding: 20px;
              max-height: 500px;
              overflow-y: auto;
              border: 1px solid var(--card-border);
          }
          
          .ip-item {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 12px 16px;
              border-bottom: 1px solid var(--card-border);
              transition: background 0.3s ease;
          }
          
          .ip-item:hover {
              background: var(--hover-bg);
          }
          
          .ip-item:last-child {
              border-bottom: none;
          }
          
          .ip-info {
              display: flex;
              align-items: center;
              gap: 16px;
          }
          
          .ip-address {
              font-family: 'SF Mono', 'Courier New', monospace;
              font-weight: 600;
              min-width: 140px;
              color: var(--text-color);
          }
          
          .speed-result {
              font-size: 0.85rem;
              padding: 4px 12px;
              border-radius: 8px;
              background: #e2e8f0;
              min-width: 70px;
              text-align: center;
              font-weight: 600;
              color: #334155;
          }
          
          .speed-fast { background: #d1fae5; color: #065f46; }
          .speed-medium { background: #fef3c7; color: #92400e; }
          .speed-slow { background: #fee2e2; color: #991b1b; }
          
          .action-buttons {
              display: flex;
              gap: 8px;
          }
          
          .small-btn {
              padding: 6px 12px;
              border-radius: 8px;
              font-size: 0.8rem;
              border: 1px solid var(--card-border);
              background: var(--card-bg);
              color: var(--text-color);
              cursor: pointer;
              transition: all 0.3s ease;
          }
          
          .small-btn:hover {
              background: var(--hover-bg);
              border-color: #94a3b8;
          }
          
          .small-btn:disabled {
              opacity: 0.5;
              cursor: not-allowed;
          }
          
          /* 加载和状态 */
          .loading {
              display: none;
              text-align: center;
              padding: 30px;
          }
          
          .spinner {
              border: 3px solid var(--card-border);
              border-top: 3px solid #3b82f6;
              border-radius: 50%;
              width: 40px;
              height: 40px;
              animation: spin 1s linear infinite;
              margin: 0 auto 16px;
          }
          
          @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
          }
          
          .result {
              margin: 20px 0;
              padding: 16px 20px;
              border-radius: 12px;
              display: none;
              border-left: 4px solid;
          }
          
          .success {
              background: #d1fae5;
              color: #065f46;
              border-left-color: #10b981;
          }
          
          .error {
              background: #fee2e2;
              color: #991b1b;
              border-left-color: #ef4444;
          }
          
          /* 进度条 */
          .speed-test-progress {
              margin: 16px 0;
              background: var(--card-border);
              border-radius: 8px;
              height: 8px;
              overflow: hidden;
              display: none;
          }
          
          .speed-test-progress-bar {
              background: linear-gradient(90deg, #3b82f6, #06b6d4);
              height: 100%;
              width: 0%;
              transition: width 0.3s ease;
          }
          
          /* 数据来源 */
          .sources {
              display: grid;
              gap: 12px;
          }
          
          .source {
              padding: 12px 16px;
              background: var(--stat-bg);
              border-radius: 8px;
              border-left: 4px solid #10b981;
          }
          
          .source.error {
              border-left-color: #ef4444;
          }

          /* 自定义数据源列表样式 */
          .custom-sources-list {
              margin-top: 20px;
              display: grid;
              gap: 12px;
              max-height: 380px; /* 新增: 限制高度，大约6行的高度 */
              overflow-y: auto;  /* 新增: 增加纵向滚动条 */
              padding-right: 5px; /* 新增: 避免滚动条遮挡 */
          }

          .custom-source-item {
              display: flex;
              justify-content: space-between;
              align-items: center;
              background: var(--stat-bg);
              padding: 10px 15px;
              border-radius: 8px;
              border: 1px solid var(--card-border);
              font-size: 0.9rem;
          }

          .delete-btn {
              background: #fee2e2;
              color: #dc2626;
              border: 1px solid #fecaca;
              padding: 4px 10px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 0.8rem;
              transition: all 0.2s;
          }

          .delete-btn:hover {
              background: #fecaca;
              border-color: #dc2626;
          }
          
          /* 页脚 */
          .footer {
              text-align: center;
              margin-top: 40px;
              padding-top: 30px;
              border-top: 1px solid var(--card-border);
              color: #64748b;
          }
          
          /* 模态框 */
          .modal {
              display: none;
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background: rgba(0, 0, 0, 0.5);
              backdrop-filter: blur(5px);
              z-index: 1000;
              justify-content: center;
              align-items: center;
          }
          
          .modal-content {
              background: var(--modal-bg);
              padding: 30px;
              border-radius: 16px;
              max-width: 500px;
              width: 90%;
              border: 1px solid var(--card-border);
              box-shadow: 0 20px 25px rgba(0, 0, 0, 0.1);
              color: var(--text-color);
          }
          
          .modal h3 {
              margin-bottom: 16px;
              color: #3b82f6;
          }
          
          .modal-buttons {
              display: flex;
              gap: 12px;
              justify-content: flex-end;
              margin-top: 20px;
          }
          
          /* 响应式设计 */
          @media (max-width: 768px) {
              .header {
                  flex-direction: column;
                  gap: 20px;
                  text-align: center;
              }
              
              .header-content h1 {
                  font-size: 2rem;
              }
              
              .social-links {
                  justify-content: center;
                  width: 100%;
                  flex-wrap: nowrap; /* 强制单行显示，禁止换行 */
              }

              /* 修复：社交图标区域的下拉菜单保持自动宽度，防止主题切换图标被拉伸 */
              .social-links .dropdown {
                  width: auto;
              }
              
              .button-group {
                  flex-direction: column;
              }
              
              .button {
                  width: 100%;
                  justify-content: center;
              }
              
              .dropdown {
                  width: 100%;
              }
              
              /* 移除了原本的 .dropdown-content 样式覆盖，
                 这样手机端会继承电脑端的 absolute 定位和居中样式，
                 防止菜单把图标挤飞 */
              
              .ip-list-header {
                  flex-direction: column;
                  align-items: flex-start;
              }
              
              .ip-item {
                  flex-direction: column;
                  align-items: flex-start;
                  gap: 12px;
              }
              
              .ip-info {
                  width: 100%;
                  justify-content: space-between;
              }
              
              .action-buttons {
                  width: 100%;
                  justify-content: flex-end;
              }
              
              .modal-buttons {
                  flex-direction: column;
              }
          }
          
          /* --- 插入的Token管理样式 --- */
          .token-section { background: var(--stat-bg); border-radius: 12px; padding: 20px; margin-top: 20px; border: 1px solid var(--card-border); }
          .token-info { background: var(--card-bg); padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 1px solid var(--card-border); }
          .token-display { font-family: 'SF Mono', 'Courier New', monospace; background: #1e293b; color: #f1f5f9; padding: 12px; border-radius: 6px; margin: 8px 0; word-break: break-all; }
          .form-group { margin-bottom: 16px; text-align: left; }
          .form-label { display: block; margin-bottom: 8px; font-weight: 600; color: var(--text-color); }
          .form-input { width: 100%; padding: 10px 12px; border: 2px solid var(--card-border); border-radius: 8px; font-size: 0.95rem; background: var(--bg-color); color: var(--text-color); transition: border-color 0.3s ease; }
          .form-input:focus { outline: none; border-color: #3b82f6; }
          .form-input:disabled { background-color: var(--stat-bg); color: #64748b; }
          .form-help { font-size: 0.85rem; color: #64748b; margin-top: 4px; }
          .checkbox-group { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
          .checkbox-label { font-weight: 600; color: var(--text-color); cursor: pointer; }

      </style>
  </head>
  <body>
      <div class="container">
          <div class="header">
              <div class="header-content">
                  <h1>Cloudflare 优选IP 收集器 UI+</h1>
                  <p> 自动定时拉取IP并测速</p>
              </div>
              <div class="social-links">
                  <div class="dropdown">
                      <button class="theme-toggle" title="切换深浅色模式">
                          <svg class="sun-icon" width="20" height="20" viewBox="0 0 24 24" style="display:none">
                              <circle cx="12" cy="12" r="5"></circle>
                              <line x1="12" y1="1" x2="12" y2="3"></line>
                              <line x1="12" y1="21" x2="12" y2="23"></line>
                              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                              <line x1="1" y1="12" x2="3" y2="12"></line>
                              <line x1="21" y1="12" x2="23" y2="12"></line>
                              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                          </svg>
                          <svg class="moon-icon" width="20" height="20" viewBox="0 0 24 24">
                              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                          </svg>
                      </button>
                      <div class="dropdown-content" style="min-width: 100px;">
                          <a onclick="setTheme('system')">🖥️ 系统</a>
                          <a onclick="setTheme('light')">🌞 浅色</a>
                          <a onclick="setTheme('dark')">🌙 深色</a>
                      </div>
                  </div>

                  <a href="https://youtu.be/rZl2jz--Oes" target="_blank" title="好软推荐" class="social-link youtube">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.546 12 3.546 12 3.546s-7.505 0-9.377.504A3.016 3.016 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.504 9.376.504 9.376.504s7.505 0 9.377-.504a3.016 3.016 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12 9.545 15.568z"/>
                      </svg>
                  </a>
                  <a href="https://github.com/ethgan/CF-Worker-BestIP-collector" target="_blank" title="GitHub" class="social-link github">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.085 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                      </svg>
                  </a>
                  <a href="https://github.com/alienwaregf/CF-Worker-BestIP-collector-UI" target="_blank" title="感谢好软推荐" class="social-link">
                      <img src="https://raw.githubusercontent.com/alienwaregf/personal-use/refs/heads/main/image/Favicon/github.svg" width="20" height="20" style="display: block;">
                  </a>
                  <a href="https://t.me/yt_hytj" target="_blank" title="Telegram" class="social-link telegram">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <path d="m20.665 3.717-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z"/>
                      </svg>
                  </a>
              </div>
          </div>

          <div class="card">
              <h2>📊 系统状态</h2>
              <div class="stats">
                  <div class="stat">
                      <div class="stat-value" id="ip-count">${data.count || 0}</div>
                      <div>IP 地址数量</div>
                  </div>
                  <div class="stat">
                      <div class="stat-value" id="last-updated">${data.lastUpdated ? '已更新' : '未更新'}</div>
                      <div>最后更新</div>
                  </div>
                  <div class="stat">
                      <div class="stat-date" id="last-date">----/--/--</div>
                      <div class="stat-value" id="last-time">--:--:--</div>
                      <div>更新时间</div>
                  </div>
                  <div class="stat">
                      <div class="stat-value" id="fast-ip-count">${fastIPs.length}</div>
                      <div>优质 IP 数量</div>
                  </div>
              </div>
              
              <div class="button-group">
                  <button class="button" onclick="updateIPs()" id="update-btn">
                      🔄 立即更新
                  </button>
                  
                  <div class="dropdown">
                      <a href="javascript:void(0)" class="button button-edgetunnel dropdown-btn">
                          edgetunnel版
                          <span style="font-size: 0.8rem;">▼</span>
                      </a>
                      <div class="dropdown-content">
                          <a href="/edgetunnel.txt${tokenParam}" target="_blank">🔗 在线查看</a>
                          <a href="/edgetunnel.txt${tokenParam}" download="edgetunnel_ips.txt">📥 下载文件</a>
                      </div>
                  </div>

                  <div class="dropdown">
                      <a href="javascript:void(0)" class="button button-cfnew dropdown-btn">
                          CFnew版
                          <span style="font-size: 0.8rem;">▼</span>
                      </a>
                      <div class="dropdown-content">
                          <a href="/cfnew.txt${tokenParam}" target="_blank">🔗 在线查看</a>
                          <a href="/cfnew.txt${tokenParam}" download="cfnew_ips.txt">📥 下载文件</a>
                          <a href="javascript:void(0)" onclick="openCustomPortLink()">♻️ 自动更新</a>
                      </div>
                  </div>
                  
                  <button class="button button-warning" onclick="startSpeedTest()" id="speedtest-btn">
                      ⚡ 开始测速
                  </button>
                  <button class="button" onclick="openItdogModal()">
                      🌐 ITDog 测速
                  </button>
                  <button class="button button-secondary" onclick="refreshData()">
                      🔄 刷新状态
                  </button>
                  <button class="button button-secondary" onclick="logout()">⏏️ 退出登陆</button>
              </div>
              
              <div class="loading" id="loading">
                  <div class="spinner"></div>
                  <p>正在从多个来源收集 IP 地址，请稍候...</p>
              </div>
              
              <div class="result" id="result"></div>

              <div class="token-section">
                  <h3>🔑 API Token 状态</h3>
                  ${tokenConfig ? `
                  <div class="token-info">
                      <p><strong>当前 Token:</strong></p>
                      <div class="token-display">${tokenConfig.token}</div>
                      <p><strong>过期时间:</strong> ${tokenConfig.neverExpire ? '永不过期' : new Date(tokenConfig.expires).toLocaleString()}</p>
                      ${tokenConfig.lastUsed ? `<p><strong>最后使用:</strong> ${new Date(tokenConfig.lastUsed).toLocaleString()}</p>` : ''}
                  </div>
                  ` : '<p style="margin-bottom: 15px; color: #64748b;">暂无Token配置，请点击下方按钮进行配置。</p>'}
                  
                  <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                       <button class="button button-warning" onclick="openTokenModal()">⚙️ 配置 Token</button>
                  </div>
              </div>

          </div>

          <div class="card">
              <div class="ip-list-header">
                  <h2>⚡ 优质 IP 列表</h2>
                  <div>
                      <button class="small-btn" onclick="copyAllFastIPs()">
                          📋 复制优质IP
                      </button>
                  </div>
              </div>
              
              <div class="speed-test-progress" id="speed-test-progress">
                  <div class="speed-test-progress-bar" id="speed-test-progress-bar"></div>
              </div>
              <div style="text-align: center; margin: 8px 0; font-size: 0.9rem; color: #64748b;" id="speed-test-status">准备测速...</div>
              
              <div class="ip-list" id="ip-list">
                  ${fastIPs.length > 0 ? 
                    fastIPs.map(item => {
                      const ip = item.ip;
                      const latency = item.latency;
                      const speedClass = latency < 200 ? 'speed-fast' : latency < 500 ? 'speed-medium' : 'speed-slow';
                      return `
                      <div class="ip-item" data-ip="${ip}">
                          <div class="ip-info">
                              <span class="ip-address">${ip}</span>
                              <span class="speed-result ${speedClass}" id="speed-${ip.replace(/\./g, '-')}">${latency}ms</span>
                          </div>
                          <div class="action-buttons">
                              <button class="small-btn" onclick="copyIP('${ip}')">复制</button>
                          </div>
                      </div>
                    `}).join('') : 
                    '<p style="text-align: center; color: #64748b; padding: 40px;">暂无优质 IP 地址数据，请点击更新按钮获取</p>'
                  }
              </div>
          </div>

          <div class="card">
              <h2>🔗 自定义数据源</h2>
              <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                  <input type="text" id="custom-source-input" placeholder="添加新的 IP 列表 URL (例如: https://example.com/ips.txt)" style="flex: 1; padding: 12px; border: 1px solid var(--card-border); border-radius: 10px; background: var(--bg-color); color: var(--text-color); min-width: 200px;">
                  <button class="button" onclick="saveCustomSource()">添加源</button>
              </div>
              <p style="margin-top: 10px; color: #64748b; font-size: 0.9rem;">提示：输入一个返回纯文本IP列表的URL，点击添加后，该来源将加入到下方的来源状态列表中（下次更新生效）。</p>
              
              <h3 style="margin-top: 20px; font-size: 1.1rem; color: #3b82f6;">已保存的自定义源</h3>
              <div class="custom-sources-list" id="saved-custom-sources">
                  <p style="color: #64748b; font-size: 0.9rem;">暂无自定义源</p>
              </div>
          </div>

          <div class="card">
              <h2>🌍 数据来源状态</h2>
              <div class="sources" id="sources">
                  ${data.sources ? data.sources.map(source => `
                      <div class="source ${source.status === 'success' ? '' : 'error'}">
                          <strong>${source.name}</strong>: 
                          ${source.status === 'success' ? 
                            `成功获取 ${source.count} 个IP` : 
                            `失败: ${source.error}`
                          }
                      </div>
                  `).join('') : '<p style="color: #64748b;">暂无数据来源信息</p>'}
              </div>
          </div>

          <div class="footer">
              <p>Cloudflare IP Collector &copy; ${new Date().getFullYear()} | 好软推荐</p>
          </div>
      </div>

      <div class="modal" id="itdog-modal">
          <div class="modal-content">
              <h3>🌐 ITDog 批量 TCPing 测速</h3>
              <p>ITDog.cn 提供了从多个国内监测点进行 TCPing 测速的功能，可以更准确地测试 IP 在国内的连通性。</p>
              <p><strong>使用方法：</strong></p>
              <ol style="margin-left: 20px; margin-bottom: 16px;">
                  <li>点击下方按钮复制所有 IP 地址</li>
                  <li>打开 ITDog 批量 TCPing 页面</li>
                  <li>将复制的 IP 粘贴到输入框中</li>
                  <li>点击开始测试按钮</li>
              </ol>
              <p><strong>注意：</strong> ITDog 免费版可能有 IP 数量限制，如果 IP 过多请分批测试。</p>
              <div class="modal-buttons">
                  <button class="button button-secondary" onclick="closeItdogModal()">取消</button>
                  <button class="button" onclick="copyIPsForItdog()">复制 IP 列表</button>
                  <a href="https://www.itdog.cn/batch_tcping/" class="button button-success" target="_blank">打开 ITDog</a>
              </div>
          </div>
      </div>

      <div class="modal" id="token-modal">
        <div class="modal-content">
            <h3>⚙️ Token 配置</h3>
            <div class="form-group">
                <label class="form-label">Token 字符串</label>
                <input type="text" class="form-input" id="token-input" placeholder="输入自定义Token或留空自动生成">
                <div class="form-help">建议使用复杂的随机字符串，长度至少16位</div>
            </div>
            <div class="checkbox-group">
                <input type="checkbox" id="never-expire-checkbox" onchange="toggleExpireInput()">
                <label class="checkbox-label" for="never-expire-checkbox">永不过期</label>
            </div>
            <div class="form-group" id="expires-group">
                <label class="form-label">过期天数</label>
                <input type="number" class="form-input" id="expires-days" value="30" min="1" max="365">
                <div class="form-help">设置Token的有效期（1-365天）</div>
            </div>
            <div class="modal-buttons">
                <button class="button" onclick="clearTokenConfig()" style="margin-right: auto; background-color: #ef4444; border-color: #ef4444; color: white;">🗑️ 清除配置</button>
                <button class="button button-secondary" onclick="closeTokenModal()">取消</button>
                <button class="button" onclick="generateRandomToken()">🎲 随机生成</button>
                <button class="button button-success" onclick="saveTokenConfig()">保存</button>
            </div>
        </div>
      </div>

      <div class="modal" id="port-modal">
        <div class="modal-content">
            <h3>⚙️ 自动更新 - 端口配置</h3>
            <div class="form-group">
                <label class="form-label">请输入端口号</label>
                <input type="number" class="form-input" id="custom-port-input" value="443" placeholder="例如: 443, 8443, 2053" onkeypress="if(event.key==='Enter') submitCustomPort()">
                <div class="form-help">默认为 443，点击确认后将在新窗口打开</div>
            </div>
            <div class="modal-buttons">
                <button class="button button-secondary" onclick="closePortModal()">取消</button>
                <button class="button" onclick="submitCustomPort()">确认</button>
            </div>
        </div>
      </div>

      <script>
          // 深浅色模式控制
          function setTheme(mode) {
              localStorage.setItem('theme', mode);
              applyTheme();
          }

          function applyTheme() {
              const savedTheme = localStorage.getItem('theme') || 'system';
              const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
              let isDark = savedTheme === 'dark';

              if (savedTheme === 'system') {
                  isDark = systemDark;
              }

              const body = document.body;
              const sunIcon = document.querySelector('.sun-icon');
              const moonIcon = document.querySelector('.moon-icon');

              if (isDark) {
                  body.classList.add('dark-mode');
                  sunIcon.style.display = 'block';
                  moonIcon.style.display = 'none';
              } else {
                  body.classList.remove('dark-mode');
                  sunIcon.style.display = 'none';
                  moonIcon.style.display = 'block';
              }
          }

          // 初始化主题
          function initTheme() {
              applyTheme();
              // 监听系统主题变化
              window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                  if (localStorage.getItem('theme') === 'system' || !localStorage.getItem('theme')) {
                      applyTheme();
                  }
              });
          }
          
          // 辅助函数：前端获取URL名称，逻辑需与后端保持一致
          function getSourceName(url) {
              try {
                  const urlObj = new URL(url);
                  return urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname : '');
              } catch (e) {
                  return url;
              }
          }

          // JavaScript 代码
          let tokenConfig = ${tokenConfig ? JSON.stringify(tokenConfig) : 'null'};
          let updateController = null; // 用于控制停止

          // --- 新增：Token管理相关JS ---
          async function logout() {
            try { await fetch('/auth-logout', { method: 'POST' }); location.reload(); } catch (e) { location.reload(); }
          }

          // --- 新增：自定义端口模态框控制 ---
          function openCustomPortLink() {
            document.getElementById('port-modal').style.display = 'flex';
            document.getElementById('custom-port-input').value = '443';
            // 自动聚焦输入框
            setTimeout(() => document.getElementById('custom-port-input').focus(), 100);
          }

          function closePortModal() {
            document.getElementById('port-modal').style.display = 'none';
          }

          function submitCustomPort() {
            let port = document.getElementById('custom-port-input').value;
            port = port.trim();
            if (!port) port = "443";
            
            let url = '/cf-custom-port?port=' + port;
            if (tokenConfig && tokenConfig.token) {
                url += '&token=' + tokenConfig.token;
            }
            window.open(url, '_blank');
            closePortModal();
          }

          function openTokenModal() {
            document.getElementById('token-modal').style.display = 'flex';
            if (tokenConfig) {
                document.getElementById('token-input').value = tokenConfig.token;
                const neverExpire = tokenConfig.neverExpire || false;
                document.getElementById('never-expire-checkbox').checked = neverExpire;
                
                if (neverExpire) {
                    document.getElementById('expires-group').style.display = 'none';
                    document.getElementById('expires-days').disabled = true;
                } else {
                    document.getElementById('expires-group').style.display = 'block';
                    document.getElementById('expires-days').disabled = false;
                    const expires = new Date(tokenConfig.expires);
                    const today = new Date();
                    const diffTime = expires - today;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    document.getElementById('expires-days').value = diffDays > 0 ? diffDays : 30;
                }
            } else {
                document.getElementById('token-input').value = '';
                document.getElementById('never-expire-checkbox').checked = false;
                document.getElementById('expires-group').style.display = 'block';
                document.getElementById('expires-days').disabled = false;
                document.getElementById('expires-days').value = 30;
            }
          }

          function closeTokenModal() {
            document.getElementById('token-modal').style.display = 'none';
          }
          
          function toggleExpireInput() {
            const checkbox = document.getElementById('never-expire-checkbox');
            const expiresGroup = document.getElementById('expires-group');
            const expiresInput = document.getElementById('expires-days');
            
            if (checkbox.checked) {
                expiresGroup.style.display = 'none';
                expiresInput.disabled = true;
            } else {
                expiresGroup.style.display = 'block';
                expiresInput.disabled = false;
            }
          }

          function generateRandomToken() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let result = '';
            for (let i = 0; i < 32; i++) {
                result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            document.getElementById('token-input').value = result;
          }

async function saveTokenConfig() {
            const token = document.getElementById('token-input').value.trim();
            const neverExpire = document.getElementById('never-expire-checkbox').checked;
            const expiresDays = neverExpire ? null : parseInt(document.getElementById('expires-days').value);
            
            if (!token) {
                showMessage('请输入Token字符串', 'error');
                return;
            }
            
            if (!neverExpire && (!expiresDays || expiresDays < 1 || expiresDays > 365)) {
                showMessage('请输入有效的过期天数（1-365）', 'error');
                return;
            }

            try {
                const response = await fetch('/admin-token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        token: token,
                        expiresDays: expiresDays,
                        neverExpire: neverExpire
                    })
                });

                const data = await response.json();

                if (data.success) {
                    tokenConfig = data.tokenConfig;
                    showMessage('Token配置已保存', 'success');
                    closeTokenModal();
                    // 刷新页面以更新链接
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showMessage(data.error, 'error');
                }
            } catch (error) {
                showMessage('保存失败: ' + error.message, 'error');
            }
          }

          async function clearTokenConfig() {
            if(!confirm('⚠️ 确定要清除 Token 配置吗？清除后，Token 保护将被移除，您的接口将恢复为【公开访问】状态。')) return;
            
            try {
                const response = await fetch('/admin-token', { method: 'DELETE' });
                const data = await response.json();
                
                if (data.success) {
                    tokenConfig = null;
                    showMessage('Token 配置已清除，即将刷新...');
                    closeTokenModal();
                    setTimeout(() => location.reload(), 1000);
                } else {
                    showMessage(data.error, 'error');
                }
            } catch (error) {
                showMessage('请求失败: ' + error.message, 'error');
            }
          }
          // --------------------------

          let speedResults = {};
          let isTesting = false;
          let currentTestIndex = 0;

          function showMessage(message, type = 'success') {
              const result = document.getElementById('result');
              result.className = \`result \${type}\`;
              result.innerHTML = \`<p>\${message}</p>\`;
              result.style.display = 'block';
              setTimeout(() => {
                  result.style.display = 'none';
              }, 3000);
          }

          function openItdogModal() {
              document.getElementById('itdog-modal').style.display = 'flex';
          }

          function closeItdogModal() {
              document.getElementById('itdog-modal').style.display = 'none';
          }

          async function copyIPsForItdog() {
              try {
                  const response = await fetch('/itdog-data');
                  const data = await response.json();
                  
                  if (data.ips && data.ips.length > 0) {
                      const ipText = data.ips.join('\\n');
                      await navigator.clipboard.writeText(ipText);
                      showMessage('已复制 IP 列表，请粘贴到 ITDog 网站');
                      closeItdogModal();
                  } else {
                      showMessage('没有可测速的IP地址', 'error');
                  }
              } catch (error) {
                  console.error('获取 ITDog 数据失败:', error);
                  showMessage('获取 IP 列表失败', 'error');
              }
          }

          function copyIP(ip) {
              navigator.clipboard.writeText(ip).then(() => {
                  showMessage(\`已复制 IP: \${ip}\`);
              }).catch(err => {
                  showMessage('复制失败，请手动复制', 'error');
              });
          }

          function copyAllIPs() {
              const ipItems = document.querySelectorAll('.ip-item span.ip-address');
              const allIPs = Array.from(ipItems).map(span => span.textContent).join('\\n');
              
              if (!allIPs) {
                  showMessage('没有可复制的IP地址', 'error');
                  return;
              }
              
              navigator.clipboard.writeText(allIPs).then(() => {
                  showMessage(\`已复制 \${ipItems.length} 个IP地址\`);
              }).catch(err => {
                  showMessage('复制失败，请手动复制', 'error');
              });
          }

          function copyAllFastIPs() {
              const ipItems = document.querySelectorAll('.ip-item span.ip-address');
              const allIPs = Array.from(ipItems).map(span => span.textContent).join('\\n');
              
              if (!allIPs) {
                  showMessage('没有可复制的优质IP地址', 'error');
                  return;
              }
              
              navigator.clipboard.writeText(allIPs).then(() => {
                  showMessage(\`已复制 \${ipItems.length} 个优质IP地址\`);
              }).catch(err => {
                  showMessage('复制失败，请手动复制', 'error');
              });
          }

          async function startSpeedTest() {
              if (isTesting) {
                  showMessage('测速正在进行中，请稍候...', 'error');
                  return;
              }
              
              const ipItems = document.querySelectorAll('.ip-item');
              if (ipItems.length === 0) {
                  showMessage('没有可测速的IP地址', 'error');
                  return;
              }
              
              const speedtestBtn = document.getElementById('speedtest-btn');
              const progressBar = document.getElementById('speed-test-progress');
              const progressBarInner = document.getElementById('speed-test-progress-bar');
              const statusElement = document.getElementById('speed-test-status');
              
              isTesting = true;
              speedtestBtn.disabled = true;
              speedtestBtn.textContent = '测速中...';
              progressBar.style.display = 'block';
              
              const totalIPs = ipItems.length;
              currentTestIndex = 0;
              
              document.querySelectorAll('.speed-result').forEach(el => {
                  el.textContent = '测试中...';
                  el.className = 'speed-result';
              });
              
              for (let i = 0; i < totalIPs; i++) {
                  if (!isTesting) break;
                  
                  const ip = ipItems[i].dataset.ip;
                  
                  statusElement.textContent = \`正在测速 \${i+1}/\${totalIPs}: \${ip}\`;
                  
                  const startTime = performance.now();
                  try {
                      const response = await fetch(\`/speedtest?ip=\${ip}\`, {
                          method: 'GET',
                          headers: {
                              'Content-Type': 'application/json'
                          }
                      });
                      
                      if (!response.ok) {
                          throw new Error(\`HTTP \${response.status}\`);
                      }
                      
                      const data = await response.json();
                      const endTime = performance.now();
                      const latency = endTime - startTime;
                      
                      speedResults[ip] = {
                          latency: latency,
                          success: data.success,
                          time: data.time || '未知'
                      };
                      
                      const speedElement = document.getElementById(\`speed-\${ip.replace(/\./g, '-')}\`);
                      if (data.success) {
                          const speedClass = latency < 200 ? 'speed-fast' : latency < 500 ? 'speed-medium' : 'speed-slow';
                          speedElement.textContent = \`\${Math.round(latency)}ms\`;
                          speedElement.className = \`speed-result \${speedClass}\`;
                      } else {
                          speedElement.textContent = '失败';
                          speedElement.className = 'speed-result speed-slow';
                      }
                  } catch (error) {
                      const speedElement = document.getElementById(\`speed-\${ip.replace(/\./g, '-')}\`);
                      speedElement.textContent = '错误';
                      speedElement.className = 'speed-result speed-slow';
                  }
                  
                  currentTestIndex = i + 1;
                  const progress = (currentTestIndex / totalIPs) * 100;
                  progressBarInner.style.width = \`\${progress}%\`;
                  
                  await new Promise(resolve => setTimeout(resolve, 300));
              }
              
              isTesting = false;
              speedtestBtn.disabled = false;
              speedtestBtn.textContent = '⚡ 开始测速';
              progressBar.style.display = 'none';
              
              showMessage(\`测速完成，已测试 \${currentTestIndex} 个IP地址\`);
              
              // 测速完成后刷新数据，显示最新的优质IP列表
              setTimeout(refreshData, 1000);
          }

          async function updateIPs() {
              const btn = document.getElementById('update-btn');
              const loading = document.getElementById('loading');
              const result = document.getElementById('result');
              
              // --- 如果正在更新，则执行停止逻辑 ---
              if (updateController) {
                  updateController.abort();
                  updateController = null;
                  btn.innerHTML = '🔄 立即更新';
                  btn.classList.remove('button-warning');
                  loading.style.display = 'none';
                  showMessage('🛑 更新已手动停止', 'error');
                  return;
              }

              // --- 开始更新逻辑 ---
              updateController = new AbortController();
              const signal = updateController.signal;

              btn.innerHTML = '🖐️ 停止更新'; 
              btn.classList.add('button-warning');
              // 注意：这里删除了 btn.disabled = true，否则无法点击停止
              loading.style.display = 'block';
              result.style.display = 'none';
              
              try {
                  const response = await fetch('/update', { method: 'POST', signal: signal });
                  const data = await response.json();
                  
                  if (data.success) {
                      result.className = 'result success';
                      result.innerHTML = \`
                          <h3>✅ 更新成功！</h3>
                          <p>耗时: \${data.duration}</p>
                          <p>收集到 \${data.totalIPs} 个唯一 IP 地址</p>
                          <p>时间: \${new Date(data.timestamp).toLocaleString()}</p>
                      \`;
                  } else {
                      result.className = 'result error';
                      result.innerHTML = \`
                          <h3>❌ 更新失败</h3>
                          <p>\${data.error}</p>
                      \`;
                  }
                  result.style.display = 'block';
                  
                  setTimeout(refreshData, 1000);
                  
              } catch (error) {
                  if (error.name === 'AbortError') return; // 忽略手动停止的报错
                  result.className = 'result error';
                  result.innerHTML = \`
                      <h3>❌ 请求失败</h3>
                      <p>\${error.message}</p>
                  \`;
                  result.style.display = 'block';
              } finally {
                  // 只有当不是手动停止的时候，才重置按钮
                  if (updateController && updateController.signal === signal) {
                      updateController = null;
                      btn.innerHTML = '🔄 立即更新';
                      btn.classList.remove('button-warning');
                      loading.style.display = 'none';
                  }
              }
          }

          // --- 新增：自定义来源相关函数 (修改后的逻辑) ---
          async function saveCustomSource() {
              const input = document.getElementById('custom-source-input');
              const url = input.value.trim();
              
              if (!url) {
                  showMessage('请输入有效的 URL', 'error');
                  return;
              }
              
              try {
                  const response = await fetch('/save-custom-source', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ url })
                  });
                  const data = await response.json();
                  
                  if (data.success) {
                      showMessage('自定义源已添加，请点击“立即更新”使其生效！');
                      input.value = ''; // 添加成功后清空
                      refreshData(); // 刷新数据，进而刷新自定义源列表
                  } else {
                      showMessage('添加失败: ' + data.error, 'error');
                  }
              } catch (e) {
                  showMessage('请求失败', 'error');
              }
          }

          // 修改：加载并显示自定义源列表，支持传入状态数据实现样式同步
          async function loadCustomSources(latestResults = []) {
              try {
                  const response = await fetch('/get-custom-source');
                  const data = await response.json();
                  const container = document.getElementById('saved-custom-sources');
                  
                  let sources = [];
                  if (data.list) {
                      sources = data.list;
                  } else if (data.url) {
                      // 兼容旧版单个URL
                      sources = [data.url];
                  }

                  if (sources.length > 0) {
                      container.innerHTML = sources.map(url => {
                          // 尝试匹配最新的状态结果
                          const nameToCheck = getSourceName(url);
                          const statusObj = latestResults.find(r => r.name === nameToCheck);
                          
                          let statusClass = ''; 
                          let statusText = '等待下次更新...';

                          if (statusObj) {
                               if (statusObj.status === 'success') {
                                   statusText = \`成功获取 \${statusObj.count} 个IP\`;
                               } else {
                                   statusClass = 'error';
                                   statusText = \`失败: \${statusObj.error}\`;
                               }
                          } else {
                               statusText = '等待下次更新 (请点击立即更新)';
                          }

                          // 使用与数据来源状态一致的 .source 类名和结构，并保留删除按钮
                          return \`
                          <div class="source \${statusClass}" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                              <div style="flex: 1; overflow: hidden; margin-right: 10px;">
                                  <div style="font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">自定义源: \${url}</div>
                                  <div style="font-size: 0.9rem; color: \${statusClass === 'error' ? '#991b1b' : '#065f46'};">
                                      \${statusText}
                                  </div>
                              </div>
                              <button class="delete-btn" style="flex-shrink: 0;" onclick="deleteSource('\${url}')">删除</button>
                          </div>
                      \`}).join('');
                  } else {
                      container.innerHTML = '<p style="color: #64748b; font-size: 0.9rem;">暂无自定义源</p>';
                  }
              } catch (e) {
                  console.error('Failed to load custom sources', e);
              }
          }

          // 新增：删除自定义源
          async function deleteSource(url) {

              try {
                  const response = await fetch('/delete-custom-source', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ url })
                  });
                  const data = await response.json();
                  
                  if (data.success) {
                      showMessage('删除成功！');
                      refreshData(); // 刷新数据，进而刷新列表
                  } else {
                      showMessage('删除失败: ' + data.error, 'error');
                  }
              } catch (e) {
                  showMessage('请求失败', 'error');
              }
          }
          // --------------------------
          
          async function refreshData() {
              try {
                  const response = await fetch('/raw');
                  const data = await response.json();
                  
                  document.getElementById('ip-count').textContent = data.count || 0;
                  document.getElementById('last-updated').textContent = data.lastUpdated ? '已更新' : '未更新';
                  
                  if (data.lastUpdated) {
                      const d = new Date(data.lastUpdated);
                      const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                      const timeStr = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
                      document.getElementById('last-date').textContent = dateStr;
                      document.getElementById('last-time').textContent = timeStr;
                  } else {
                      document.getElementById('last-date').textContent = '----/--/--';
                      document.getElementById('last-time').textContent = '从未更新';
                  }
                  
                  // 获取优质IP数据
                  const fastResponse = await fetch('/fast-ips');
                  const fastData = await fastResponse.json();
                  
                  document.getElementById('fast-ip-count').textContent = fastData.fastIPs ? fastData.fastIPs.length : 0;
                  
                  const ipList = document.getElementById('ip-list');
                  if (fastData.fastIPs && fastData.fastIPs.length > 0) {
                      ipList.innerHTML = fastData.fastIPs.map(item => {
                          const ip = item.ip;
                          const latency = item.latency;
                          const speedClass = latency < 200 ? 'speed-fast' : latency < 500 ? 'speed-medium' : 'speed-slow';
                          return \`
                          <div class="ip-item" data-ip="\${ip}">
                              <div class="ip-info">
                                  <span class="ip-address">\${ip}</span>
                                  <span class="speed-result \${speedClass}" id="speed-\${ip.replace(/\./g, '-')}">\${latency}ms</span>
                              </div>
                              <div class="action-buttons">
                                  <button class="small-btn" onclick="copyIP('\${ip}')">复制</button>
                              </div>
                          </div>
                          \`;
                      }).join('');
                  } else {
                      ipList.innerHTML = '<p style="text-align: center; color: #64748b; padding: 40px;">暂无优质 IP 地址数据，请点击更新按钮获取</p>';
                  }
                  
                  const sources = document.getElementById('sources');
                  if (data.sources && data.sources.length > 0) {
                      sources.innerHTML = data.sources.map(source => \`
                          <div class="source \${source.status === 'success' ? '' : 'error'}">
                              <strong>\${source.name}</strong>: 
                              \${source.status === 'success' ? 
                                \`成功获取 \${source.count} 个IP\` : 
                                \`失败: \${source.error}\`
                              }
                          </div>
                      \`).join('');
                  }

                  // 在刷新主数据的同时，传入 sources 状态给自定义源列表以更新其 UI 状态
                  loadCustomSources(data.sources || []);

              } catch (error) {
                  console.error('刷新数据失败:', error);
              }
          }
          
          document.addEventListener('DOMContentLoaded', function() {
              refreshData();
              // 移除单独的 loadCustomSources() 调用，由 refreshData 统一带状态调用
              initTheme(); // 初始化主题
          });
      </script>
  </body>
  </html>`;
    
    return new Response(html, {
      headers: { 
        'Content-Type': 'text/html; charset=utf-8',
      }
    });
  }
  
  // 处理优质IP列表获取（JSON格式）
  async function handleGetFastIPs(env) {
    const data = await getStoredSpeedIPs(env);
    return jsonResponse(data);
  }
  
  // 处理优质IP列表获取（文本格式，IP#实际的延迟ms格式）
  async function handleGetFastIPsText(env) {
    const data = await getStoredSpeedIPs(env);
    const fastIPs = data.fastIPs || [];
    
    // 格式化为 IP#实际的延迟ms
    const ipList = fastIPs.map(item => `${item.ip}#${item.latency}ms`).join('\n');
    
    return new Response(ipList, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline; filename="cloudflare_fast_ips.txt"',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // 新增：处理 edgetunnel 版 IP 列表获取 (纯IP，一行一个)
  async function handleGetEdgeTunnelIPs(request, env) {
    // --- 门禁检查 ---
    const tokenConfig = await getTokenConfig(env);
    if (tokenConfig && tokenConfig.token) {
        const url = new URL(request.url);
        if (url.searchParams.get('token') !== tokenConfig.token) {
            return new Response('需要管理员权限', { 
                status: 401, 
                headers: { 'Content-Type': 'text/plain; charset=utf-8' } 
            });
        }
    }
    // ----------------
    
    const data = await getStoredSpeedIPs(env);
    const fastIPs = data.fastIPs || [];
    
    // 格式化为纯IP，一行一个
    const ipList = fastIPs.map(item => item.ip).join('\n');
    
    return new Response(ipList, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline; filename="edgetunnel_ips.txt"',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // 新增：处理 CFNew 版 IP 列表获取 (IP:443，用逗号隔开)
  async function handleGetCFNewIPs(request, env) {
    // --- 门禁检查 ---
    const tokenConfig = await getTokenConfig(env);
    if (tokenConfig && tokenConfig.token) {
        const url = new URL(request.url);
        if (url.searchParams.get('token') !== tokenConfig.token) {
            return new Response('需要管理员权限', { 
                status: 401, 
                headers: { 'Content-Type': 'text/plain; charset=utf-8' } 
            });
        }
    }
    // ----------------

    const data = await getStoredSpeedIPs(env);
    const fastIPs = data.fastIPs || [];
    
    // 格式化为 IP:443,IP:443
    const ipList = fastIPs.map(item => `${item.ip}:443`).join(',');
    
    return new Response(ipList, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline; filename="cfnew_ips.txt"',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // 新增：处理自定义端口版 IP 列表获取 (IP:端口，一行一个)
  async function handleGetCFCustomPort(request, env) {
    // --- 门禁检查 ---
    const tokenConfig = await getTokenConfig(env);
    if (tokenConfig && tokenConfig.token) {
        const url = new URL(request.url);
        if (url.searchParams.get('token') !== tokenConfig.token) {
            return new Response('需要管理员权限', { 
                status: 401, 
                headers: { 'Content-Type': 'text/plain; charset=utf-8' } 
            });
        }
    }
    // ----------------

    const url = new URL(request.url);
    const port = url.searchParams.get('port') || '443'; // 获取端口参数

    const data = await getStoredSpeedIPs(env);
    const fastIPs = data.fastIPs || [];
    
    // 格式化为 IP:端口#备注 (一行一个)
    // 修改：使用间隔号 (·) 代替空格，彻底解决被替换为下划线的问题
    const ipList = fastIPs.map(item => `${item.ip}:${port}#♾️·CFnew·${item.ip}`).join('\n');
    
    return new Response(ipList, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `inline; filename="cf_custom_${port}.txt"`,
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  
  // 处理 ITDog 数据获取
  async function handleItdogData(env) {
    const data = await getStoredIPs(env);
    return jsonResponse({
      ips: data.ips || [],
      count: data.count || 0
    });
  }
  
  // 处理测速请求
  async function handleSpeedTest(request, env) {
    const url = new URL(request.url);
    const ip = url.searchParams.get('ip');
    
    if (!ip) {
      return jsonResponse({ error: 'IP parameter is required' }, 400);
    }
    
    try {
      // 使用 Cloudflare 的测速域名
      const testUrl = `https://speed.cloudflare.com/__down?bytes=1000`;
      
      // 设置自定义 Host 头来指向特定 IP
      const response = await fetch(testUrl, {
        headers: {
          'Host': 'speed.cloudflare.com'
        },
        cf: {
          // 使用 resolveOverride 来指定 IP
          resolveOverride: ip
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // 读取响应以确保连接完成
      await response.text();
      
      return jsonResponse({
        success: true,
        ip: ip,
        time: new Date().toISOString()
      });
      
    } catch (error) {
      console.error(`Speed test failed for IP ${ip}:`, error);
      return jsonResponse({
        success: false,
        ip: ip,
        error: error.message,
        time: new Date().toISOString()
      }, 500);
    }
  }
  
  // 处理手动更新
  async function handleUpdate(env) {
    try {
      // 再次检查 KV 绑定
      if (!env.IP_STORAGE) {
        throw new Error('KV namespace IP_STORAGE is not bound. Please check your Worker settings.');
      }

      const startTime = Date.now();
      const { uniqueIPs, results } = await updateAllIPs(env);
      const duration = Date.now() - startTime;

      // 存储到 KV
      await env.IP_STORAGE.put('cloudflare_ips', JSON.stringify({
        ips: uniqueIPs,
        lastUpdated: new Date().toISOString(),
        count: uniqueIPs.length,
        sources: results
      }));

      // 自动触发测速并存储优质IP
      await autoSpeedTestAndStore(env, uniqueIPs);

      return jsonResponse({
        success: true,
        message: 'IPs collected and speed test completed successfully',
        duration: `${duration}ms`,
        totalIPs: uniqueIPs.length,
        timestamp: new Date().toISOString(),
        results: results
      });
    } catch (error) {
      console.error('Update error:', error);
      return jsonResponse({
        success: false,
        error: error.message
      }, 500);
    }
  }
  
  // 自动测速并存储优质IP - 优化后的逻辑
  async function autoSpeedTestAndStore(env, ips) {
    if (!ips || ips.length === 0) return;
    
    const speedResults = [];
    const BATCH_SIZE = 5; // 控制并发数
    
    // 对所有IP进行测速，但限制最大数量避免超时
    const ipsToTest = ips.slice(0, AUTO_TEST_MAX_IPS);
    
    console.log(`Starting auto speed test for ${ipsToTest.length} IPs (out of ${ips.length} total)...`);
    
    for (let i = 0; i < ipsToTest.length; i += BATCH_SIZE) {
      const batch = ipsToTest.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(ip => testIPSpeed(ip));
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const ip = batch[j];
        
        if (result.status === 'fulfilled') {
          const speedData = result.value;
          if (speedData.success && speedData.latency) {
            speedResults.push({
              ip: ip,
              latency: Math.round(speedData.latency) // 确保延迟是整数
            });
          }
        }
      }
      
      // 批次间延迟
      if (i + BATCH_SIZE < ipsToTest.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // 按延迟排序，取前FAST_IP_COUNT个最快的IP
    speedResults.sort((a, b) => a.latency - b.latency);
    const fastIPs = speedResults.slice(0, FAST_IP_COUNT);
    
    console.log(`Speed test results: ${speedResults.length} IPs tested successfully`);
    console.log(`Fastest IP: ${fastIPs[0]?.ip} (${fastIPs[0]?.latency}ms)`);
    console.log(`Slowest fast IP: ${fastIPs[fastIPs.length-1]?.ip} (${fastIPs[fastIPs.length-1]?.latency}ms)`);
    
    // 存储优质IP
    await env.IP_STORAGE.put('cloudflare_fast_ips', JSON.stringify({
      fastIPs: fastIPs,
      lastTested: new Date().toISOString(),
      count: fastIPs.length,
      testedCount: speedResults.length,
      totalIPs: ips.length
    }));
    
    console.log(`Auto speed test completed. Found ${fastIPs.length} fast IPs out of ${speedResults.length} tested.`);
  }
  
  // 测试单个IP的速度
  async function testIPSpeed(ip) {
    try {
      const startTime = Date.now();
      const testUrl = `https://speed.cloudflare.com/__down?bytes=1000`;
      
      const response = await fetch(testUrl, {
        headers: {
          'Host': 'speed.cloudflare.com'
        },
        cf: {
          resolveOverride: ip
        },
        // 设置较短的超时时间
        signal: AbortSignal.timeout(3000)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      await response.text();
      const endTime = Date.now();
      const latency = endTime - startTime;
      
      return {
        success: true,
        ip: ip,
        latency: latency
      };
      
    } catch (error) {
      return {
        success: false,
        ip: ip,
        error: error.message
      };
    }
  }
  
  // 处理获取IP列表 - 纯文本格式
  async function handleGetIPs(env) {
    const data = await getStoredIPs(env);
    return new Response(data.ips.join('\n'), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline; filename="cloudflare_ips.txt"',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  
  // 处理获取原始数据
  async function handleRawIPs(env) {
    const data = await getStoredIPs(env);
    return jsonResponse(data);
  }

  // --- 新增：保存自定义来源 (逻辑已修改为追加) ---
  async function handleSaveCustomSource(request, env) {
    try {
        const body = await request.json();
        if (body.url) {
            // 获取现有的列表
            let currentList = [];
            try {
                const stored = await env.IP_STORAGE.get('custom_source_list');
                if (stored) {
                    currentList = JSON.parse(stored);
                }
            } catch(e) {
                // 如果是第一次或出错，默认为空列表
                currentList = [];
            }
            
            // 确保不重复添加
            if (!currentList.includes(body.url)) {
                currentList.push(body.url);
                await env.IP_STORAGE.put('custom_source_list', JSON.stringify(currentList));
            }

            return jsonResponse({ success: true });
        }
        return jsonResponse({ error: 'URL is required' }, 400);
    } catch (e) {
        return jsonResponse({ error: e.message }, 500);
    }
  }

  // --- 修改：获取自定义来源 (支持返回列表) ---
  async function handleGetCustomSource(env) {
    // 优先读取新的列表
    const listStr = await env.IP_STORAGE.get('custom_source_list');
    if (listStr) {
        return jsonResponse({ list: JSON.parse(listStr) });
    }

    // 降级：读取旧的单个URL（为了兼容性）
    const url = await env.IP_STORAGE.get('custom_source_url');
    return jsonResponse({ url: url || '' });
  }

  // --- 新增：删除自定义来源 ---
  async function handleDeleteCustomSource(request, env) {
      try {
          const body = await request.json();
          if (body.url) {
              let currentList = [];
              try {
                  const stored = await env.IP_STORAGE.get('custom_source_list');
                  if (stored) {
                      currentList = JSON.parse(stored);
                  }
              } catch(e) {
                  currentList = [];
              }
              
              // 过滤掉要删除的URL
              const newList = currentList.filter(u => u !== body.url);
              await env.IP_STORAGE.put('custom_source_list', JSON.stringify(newList));
              
              return jsonResponse({ success: true });
          }
          return jsonResponse({ error: 'URL is required' }, 400);
      } catch (e) {
          return jsonResponse({ error: e.message }, 500);
      }
  }
  
  // 主要的IP收集逻辑
  async function updateAllIPs(env) {
    const urls = [
      'https://ip.164746.xyz', 
      'https://ip.haogege.xyz/',
      'https://stock.hostmonit.com/CloudFlareYes', 
      'https://api.uouin.com/cloudflare.html',
      'https://addressesapi.090227.xyz/CloudFlareYes',
      'https://addressesapi.090227.xyz/ip.164746.xyz',
      'https://www.wetest.vip/page/cloudflare/address_v4.html'
    ];

    // --- 新增：读取自定义来源并添加到列表 (包含旧版和新版逻辑) ---
    try {
        // 1. 尝试读取旧的单条数据（为了兼容性）
        const customUrl = await env.IP_STORAGE.get('custom_source_url');
        if (customUrl && customUrl.startsWith('http')) {
            console.log('Adding legacy custom source:', customUrl);
            urls.push(customUrl);
        }

        // 2. 尝试读取新的列表数据
        const customListStr = await env.IP_STORAGE.get('custom_source_list');
        if (customListStr) {
            const customList = JSON.parse(customListStr);
            if (Array.isArray(customList)) {
                customList.forEach(url => {
                    if (url && url.startsWith('http')) {
                        console.log('Adding custom source from list:', url);
                        urls.push(url);
                    }
                });
            }
        }
    } catch (e) {
        console.error('Failed to load custom sources:', e);
    }
    // ------------------------------------

    const uniqueIPs = new Set();
    const results = [];
  
    // 使用与Python脚本相同的正则表达式
    const ipPattern = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/gi;
  
    // 批量处理URL，控制并发数
    const BATCH_SIZE = 3;
    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
      const batch = urls.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(url => fetchURLWithTimeout(url, 8000));
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const url = batch[j];
        const sourceName = getSourceName(url);
        
        if (result.status === 'fulfilled') {
          const content = result.value;
          const ipMatches = content.match(ipPattern) || [];
          
          // 添加到集合中（自动去重）
          ipMatches.forEach(ip => {
            if (isValidIPv4(ip)) {
              uniqueIPs.add(ip);
            }
          });
          
          results.push({
            name: sourceName,
            status: 'success',
            count: ipMatches.length,
            error: null
          });
          
          console.log(`Successfully collected ${ipMatches.length} IPs from ${sourceName}`);
        } else {
          console.error(`Failed to fetch ${sourceName}:`, result.reason);
          results.push({
            name: sourceName,
            status: 'error',
            count: 0,
            error: result.reason.message
          });
        }
      }
      
      // 批次间延迟
      if (i + BATCH_SIZE < urls.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  
    // 按IP地址的数字顺序排序（与Python脚本相同）
    const sortedIPs = Array.from(uniqueIPs).sort((a, b) => {
      const aParts = a.split('.').map(part => parseInt(part, 10));
      const bParts = b.split('.').map(part => parseInt(part, 10));
      
      for (let i = 0; i < 4; i++) {
        if (aParts[i] !== bParts[i]) {
          return aParts[i] - bParts[i];
        }
      }
      return 0;
    });
  
    return {
      uniqueIPs: sortedIPs,
      results: results
    };
  }
  
  // 获取URL的友好名称
  function getSourceName(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname : '');
    } catch (e) {
      return url;
    }
  }
  
  // 带超时的fetch
  function fetchURLWithTimeout(url, timeout = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // 返回 fetch promise
    return fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare-IP-Collector/1.0)',
          'Accept': 'text/html,application/json,text/plain,*/*'
        }
      }).then(async (response) => {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.text();
      }).finally(() => {
        clearTimeout(timeoutId);
      });
  }
  
  // 从 KV 获取存储的 IPs
  async function getStoredIPs(env) {
    try {
      if (!env.IP_STORAGE) {
        console.error('KV namespace IP_STORAGE is not bound');
        return getDefaultData();
      }
      
      const data = await env.IP_STORAGE.get('cloudflare_ips');
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error reading from KV:', error);
    }
    
    return getDefaultData();
  }
  
  // 从 KV 获取存储的测速IPs
  async function getStoredSpeedIPs(env) {
    try {
      if (!env.IP_STORAGE) {
        console.error('KV namespace IP_STORAGE is not bound');
        return getDefaultSpeedData();
      }
      
      const data = await env.IP_STORAGE.get('cloudflare_fast_ips');
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error reading speed IPs from KV:', error);
    }
    
    return getDefaultSpeedData();
  }
  
  // 默认数据
  function getDefaultData() {
    return {
      ips: [],
      lastUpdated: null,
      count: 0,
      sources: []
    };
  }
  
  // 默认测速数据
  function getDefaultSpeedData() {
    return {
      fastIPs: [],
      lastTested: null,
      count: 0
    };
  }
  
  // IPv4地址验证
  function isValidIPv4(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    
    for (const part of parts) {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0 || num > 255) return false;
      // 排除私有IP段
      if (part.startsWith('0') && part.length > 1) return false;
    }
    
    // 排除私有地址
    if (ip.startsWith('10.') || 
        ip.startsWith('192.168.') ||
        (ip.startsWith('172.') && parseInt(parts[1]) >= 16 && parseInt(parts[1]) <= 31) ||
        ip.startsWith('127.') ||
        ip.startsWith('169.254.') ||
        ip === '255.255.255.255') {
      return false;
    }
    
    return true;
  }
  
  // 工具函数
  function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  
  function handleCORS() {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  // =========================================================================
  // [新增辅助函数 START]
  // =========================================================================

  // 生成简单的哈希 (用于鉴权Cookie)
  async function sha256(text) {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // 验证Cookie逻辑
  async function verifyAuthCookie(cookieHeader, correctPassword) {
    if (!cookieHeader) return false;
    const cookies = Object.fromEntries(cookieHeader.split('; ').map(c => c.split('=')));
    const token = cookies['cf_ip_auth'];
    if (!token) return false;
    const expectedToken = await sha256(correctPassword);
    return token === expectedToken;
  }

  // 处理登录请求
  async function handleLoginRequest(request, env, clientIP) {
    if (!env.IP_STORAGE) {
        return jsonResponse({ success: false, message: '系统错误: IP_STORAGE 未绑定' }, 500);
    }

    // 1. 检查是否锁定 (Lockout Check)
    const lockKey = `login_fail:${clientIP}`;
    const lockData = await env.IP_STORAGE.get(lockKey, { type: 'json' });
    
    if (lockData && lockData.count >= 3) {
        const now = Date.now();
        if (now < lockData.blockedUntil) {
            return jsonResponse({ success: false, message: '尝试次数过多，IP已被锁定24小时。' }, 403);
        } else {
            // 过期了，清除锁定
            await env.IP_STORAGE.delete(lockKey);
        }
    }

    try {
        const body = await request.json();
        const inputPassword = body.password || '';

        // 2. 验证密码
        if (inputPassword === env.password) {
            // 登录成功
            // 清除之前的错误记录
            await env.IP_STORAGE.delete(lockKey);
            
            // 设置Cookie
            const token = await sha256(env.password);
            const headers = new Headers();
            // Cookie 有效期设为7天
            headers.append('Set-Cookie', `cf_ip_auth=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax; Secure`);
            
            return new Response(JSON.stringify({ success: true }), {
                headers: { 'Content-Type': 'application/json', ...Object.fromEntries(headers) }
            });
        } else {
            // 登录失败
            const currentCount = (lockData ? lockData.count : 0) + 1;
            const remaining = 3 - currentCount;
            
            // 更新错误记录
            let storeData = { count: currentCount, blockedUntil: 0 };
            
            // 如果达到3次，锁定24小时
            if (currentCount >= 3) {
                storeData.blockedUntil = Date.now() + 24 * 60 * 60 * 1000;
                // KV ttl 设为 24小时稍多一点
                await env.IP_STORAGE.put(lockKey, JSON.stringify(storeData), { expirationTtl: 86500 });
                return jsonResponse({ success: false, message: '密码错误，已被锁定24小时！' }, 403);
            } else {
                // 未达到锁定，记录次数 (保留24小时记录)
                await env.IP_STORAGE.put(lockKey, JSON.stringify(storeData), { expirationTtl: 86400 });
                return jsonResponse({ success: false, message: `密码错误，还剩${remaining}次尝试机会` }, 401);
            }
        }
    } catch (e) {
        return jsonResponse({ success: false, message: '请求格式错误' }, 400);
    }
  }

  // 返回登录页面 HTML
  async function serveAuthPage(env) {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare IP 收集器 - 登录</title>
    <style>
        :root {
            --bg-color: #f8fafc;
            --card-bg: white;
            --text-color: #334155;
            --border-color: #e2e8f0;
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --bg-color: #0f172a;
                --card-bg: #1e293b;
                --text-color: #cbd5e1;
                --border-color: #334155;
            }
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: var(--bg-color);
            color: var(--text-color);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .login-card {
            background: var(--card-bg);
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            width: 100%;
            max-width: 400px;
            text-align: center;
            border: 1px solid var(--border-color);
        }
        h1 {
            color: #3b82f6;
            margin-bottom: 10px;
            font-size: 1.8rem;
        }
        p {
            color: #64748b;
            margin-bottom: 30px;
            font-size: 0.95rem;
        }
        input {
            width: 100%;
            padding: 12px 16px;
            border: 1px solid var(--border-color);
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 1rem;
            outline: none;
            background: var(--bg-color);
            color: var(--text-color);
            transition: border-color 0.2s;
        }
        input:focus {
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        button {
            width: 100%;
            padding: 12px;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }
        button:hover {
            background: #2563eb;
        }
        button:disabled {
            opacity: 0.7;
            cursor: not-allowed;
        }
        .error-msg {
            background: #fee2e2;
            color: #991b1b;
            padding: 10px;
            border-radius: 8px;
            margin-top: 20px;
            font-size: 0.9rem;
            display: none;
            border: 1px solid #fecaca;
        }
    </style>
</head>
<body>
    <div class="login-card">
        <h1>Cloudflare IP 收集器 UI+</h1>
        <p>请输入管理员密码访问此页面</p>
        <input type="password" id="password" placeholder="输入管理员密码" onkeypress="if(event.key==='Enter') doLogin()">
        <button onclick="doLogin()" id="loginBtn">登录</button>
        <div class="error-msg" id="errorMsg"></div>
    </div>

    <script>
        async function doLogin() {
            const pwd = document.getElementById('password').value;
            const btn = document.getElementById('loginBtn');
            const msg = document.getElementById('errorMsg');
            
            if(!pwd) return;
            
            btn.disabled = true;
            btn.innerText = '验证中...';
            msg.style.display = 'none';
            
            try {
                const res = await fetch('/auth-login', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({password: pwd})
                });
                const data = await res.json();
                
                if(data.success) {
                    location.reload();
                } else {
                    msg.innerText = data.message;
                    msg.style.display = 'block';
                    btn.disabled = false;
                    btn.innerText = '登录';
                }
            } catch(e) {
                msg.innerText = '网络错误，请重试';
                msg.style.display = 'block';
                btn.disabled = false;
                btn.innerText = '登录';
            }
        }
    </script>
</body>
</html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
// --- Token 后端逻辑 (新增) ---
  async function handleAdminToken(request, env) {
    if (request.method === 'GET') {
      const config = await getTokenConfig(env);
      return jsonResponse({ tokenConfig: config });
    } else if (request.method === 'POST') {
      try {
        const { token, expiresDays, neverExpire } = await request.json();
        
        if (!token) {
          return jsonResponse({ error: 'Token不能为空' }, 400);
        }
        
        let expiresDate;
        if (neverExpire) {
          expiresDate = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString(); 
        } else {
          if (!expiresDays) {
            return jsonResponse({ error: '过期时间不能为空' }, 400);
          }
          if (expiresDays < 1 || expiresDays > 365) {
            return jsonResponse({ error: '过期时间必须在1-365天之间' }, 400);
          }
          expiresDate = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();
        }
        
        const tokenConfig = {
          token: token.trim(),
          expires: expiresDate,
          createdAt: new Date().toISOString(),
          lastUsed: null,
          neverExpire: neverExpire || false
        };
        
        await env.IP_STORAGE.put('token_config', JSON.stringify(tokenConfig));
        
        return jsonResponse({ 
          success: true, 
          tokenConfig,
          message: 'Token更新成功'
        });
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    } else if (request.method === 'DELETE') {
      // --- 新增：处理删除请求 ---
      try {
          await env.IP_STORAGE.delete('token_config');
          return jsonResponse({ success: true, message: 'Token配置已清除' });
      } catch (error) {
          return jsonResponse({ error: error.message }, 500);
      }
    } else {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }
  }

  // 获取Token配置
  async function getTokenConfig(env) {
    try {
      const config = await env.IP_STORAGE.get('token_config');
      return config ? JSON.parse(config) : null;
    } catch (error) {
      return null;
    }
  }  