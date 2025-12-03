# Cloudflare IP 收集器 UI+ 使用说明

## 项目简介

这是一个基于 Cloudflare Workers 的 IP 收集器，能够自动从多个来源收集 Cloudflare 优质 IP，并提供测速、管理功能。支持多种输出格式，适合配合各类代理工具使用。

## 🌟 主要功能

- **自动收集**：从多个公开来源收集 Cloudflare IP
- **智能测速**：自动测试 IP 延迟并筛选优质 IP
- **多种输出格式**：
  - EdgeTunnel 格式（纯 IP）
  - CFnew 格式（IP:443, 逗号分隔）
  - 自定义端口格式
- **Web 管理界面**：可视化操作界面
- **定时更新**：支持定时自动更新 IP 列表
- **Token 保护**：支持 API 访问权限控制
- **自定义数据源**：可添加自己的 IP 数据源

## 🚀 快速开始

### 前置要求

1. **Cloudflare 账号**
   - 注册 [Cloudflare](https://cloudflare.com) 账号
   - 准备一个域名（可选，推荐使用）

2. **基本工具**
   - 现代浏览器（Chrome/Edge/Safari）
   - 文本编辑器

### 部署步骤

#### 方法一：Cloudflare Dashboard（推荐）

1. **登录 Cloudflare Dashboard**
   - 进入 Workers & Pages
   - 点击 "创建应用程序"

2. **创建 Worker**
   - 点击 "创建 Worker"
   - 输入 Worker 名称（如 `cf-ip-collector`）
   - 点击 "部署"

3. **配置 KV 命名空间**
   - 左侧菜单选择 "KV"
   - 点击 "创建命名空间"
   - 输入名称（如 `CF_IP_STORAGE`）
   - 记下命名空间 ID

4. **绑定 KV 到 Worker**
   - 进入 Worker 设置
   - 选择 "变量" → "KV 命名空间绑定"
   - 点击 "添加绑定"：
     - 变量名称：`IP_STORAGE`
     - KV 命名空间：选择刚才创建的命名空间

5. **设置环境变量**
   - 在 "变量" 部分，添加环境变量：
     - 名称：`password`
     - 值：设置您的管理密码（建议使用强密码）

6. **复制代码**
   - 进入 Worker 的 "编辑代码"
   - 将本文档提供的完整代码复制粘贴
   - 点击 "保存并部署"

7. **配置定时任务（可选）**
   - 进入 Worker 的 "触发器"
   - 点击 "添加 Cron 触发器"
   - 输入 Cron 表达式：`0 */6 * * *`（每6小时运行一次）
   - 描述：自动更新 IP

#### 方法二：使用 Wrangler CLI

```bash
# 安装 Wrangler
npm install -g wrangler

# 登录
wrangler login

# 创建 KV 命名空间
wrangler kv:namespace create "CF_IP_STORAGE"

# 创建 Worker
wrangler generate cf-ip-collector
cd cf-ip-collector

# 配置 wrangler.toml
# 添加 KV 绑定和变量配置

# 部署
wrangler deploy
```

### 配置文件参考

`wrangler.toml` 配置示例：

```toml
name = "cf-ip-collector"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
password = "YourSecurePassword123!"

[[kv_namespaces]]
binding = "IP_STORAGE"
id = "your-kv-namespace-id-here"  # 替换为实际的 KV ID
```

## 🔧 配置说明

### 必需配置

| 配置项 | 说明 | 示例值 |
|--------|------|--------|
| `password` | 管理界面登录密码 | `MyStrongPassword2024!` |
| `IP_STORAGE` | KV 命名空间绑定 | 选择您创建的 KV 命名空间 |

### 可选配置

在代码开头部分可以调整的参数：

```javascript
const FAST_IP_COUNT = 20;         // 优质 IP 数量（默认 20）
const AUTO_TEST_MAX_IPS = 200;    // 自动测速最大 IP 数（默认 200）
```

### 定时任务配置

建议的 Cron 表达式：
- `0 */6 * * *` - 每6小时运行一次
- `0 0 * * *` - 每天午夜运行
- `0 */12 * * *` - 每12小时运行一次

## 📱 使用方法

### 首次使用

1. **访问 Worker**
   - 打开您的 Worker URL（如 `https://cf-ip-collector.your-username.workers.dev`）
   - 显示登录页面

2. **登录**
   - 输入您在环境变量中设置的密码
   - 点击登录

3. **初始数据获取**
   - 登录后点击 "立即更新"
   - 等待系统收集 IP 并完成测速（约 1-3 分钟）

### 管理界面功能

#### 系统状态
- 显示当前 IP 数量
- 最后更新时间
- 优质 IP 数量

#### 操作按钮
- **立即更新**：手动触发 IP 收集
- **EdgeTunnel 版**：下载 EdgeTunnel 格式 IP
- **CFnew 版**：下载 CFnew 格式 IP
- **开始测速**：手动测速当前 IP
- **ITDog 测速**：复制 IP 到 ITDog 批量测试
- **Token 管理**：配置 API 访问 Token

#### 优质 IP 列表
- 显示筛选后的优质 IP
- 点击 "复制" 复制单个 IP
- 点击 "复制优质 IP" 复制所有优质 IP

#### 自定义数据源
- 添加自定义 IP 列表 URL
- 管理自定义数据源

### API 接口

所有 API 接口支持 Token 验证（如果配置了 Token）。

#### 公开接口（无需 Token）
- `GET /edgetunnel.txt` - EdgeTunnel 格式 IP 列表
- `GET /cfnew.txt` - CFnew 格式 IP 列表
- `GET /cf-custom-port?port=443` - 自定义端口格式

#### 受保护接口（需要登录或 Token）
- `GET /` - 管理界面
- `POST /update` - 手动更新
- `GET /ips` - 获取所有 IP
- `GET /fast-ips` - 获取优质 IP

### Token 配置

1. 点击 "配置 Token"
2. 输入 Token 字符串（或点击随机生成）
3. 设置过期时间（或选择永不过期）
4. 保存配置

配置后，API 访问需要带上 Token 参数：
```
https://your-worker.com/cfnew.txt?token=YOUR_TOKEN
```

## 🔍 常见问题

### Q1: 无法登录管理界面
- 检查 `password` 环境变量是否正确设置
- 确保密码输入正确
- 清除浏览器缓存后重试

### Q2: IP 收集失败
- 检查网络连接
- 确认源网站是否可以访问
- 查看 Worker 日志获取详细错误信息

### Q3: 测速结果不准确
- 测速基于 Cloudflare 的速度测试服务
- 实际使用效果可能因地区而异
- 建议使用 ITDog 进行多地区测试

### Q4: Worker 超时
- 减少 `AUTO_TEST_MAX_IPS` 值
- 减少 `FAST_IP_COUNT` 值
- 分批测速，不要一次性测试太多 IP

## 🔒 安全建议

1. **使用强密码**
   - 密码至少12位
   - 包含大小写字母、数字、特殊字符

2. **启用 Token 保护**
   - 为 API 接口配置 Token
   - 定期更换 Token

3. **定期更新**
   - 定期更新 Worker 代码
   - 定期更换密码和 Token

4. **访问控制**
   - 使用 Cloudflare Access 限制访问
   - 设置 IP 白名单

## 📊 数据说明

### IP 来源
系统从多个公开来源收集 IP，包括：
- ip.164746.xyz
- stock.hostmonit.com
- api.uouin.com
- 其他公开 IP 列表

### 数据存储
所有数据存储在 Cloudflare KV 中：
- `cloudflare_ips` - 原始 IP 数据
- `cloudflare_fast_ips` - 测速后的优质 IP
- `token_config` - Token 配置
- `custom_source_list` - 自定义数据源

### 数据更新
- 手动：点击 "立即更新"
- 自动：按设定的 Cron 时间执行
- 每次更新会重新测速并筛选优质 IP

## 🛠️ 故障排除

### 查看日志
1. 进入 Worker 控制台
2. 点击 "日志"
3. 查看实时日志输出

### 测试 KV
```bash
# 使用 Wrangler 测试 KV
wrangler kv:key list --binding=IP_STORAGE
wrangler kv:key get "cloudflare_ips" --binding=IP_STORAGE
```

### 重置数据
```bash
# 删除所有 KV 数据
wrangler kv:key delete "cloudflare_ips" --binding=IP_STORAGE
wrangler kv:key delete "cloudflare_fast_ips" --binding=IP_STORAGE
wrangler kv:key delete "token_config" --binding=IP_STORAGE
```

## 📞 支持与反馈

如果遇到问题或有建议：

1. **查看文档**：仔细阅读本使用说明
2. **检查日志**：查看 Worker 运行日志
3. **社区支持**：在 GitHub Issues 中提问
4. **功能建议**：提交 Pull Request

## 📄 许可证

本项目基于 MIT 许可证开源。使用前请遵守相关法律法规和 Cloudflare 的服务条款。

---

**提示**：本工具仅供学习和合法用途，请勿用于非法活动。使用 Cloudflare 服务请遵守其服务条款。

*最后更新：2024年1月*