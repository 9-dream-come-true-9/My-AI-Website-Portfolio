# Vercel 部署清单

把 `vercel_site/` 作为 Vercel 项目根目录上传或导入。

## 必须包含

```text
index.html
style.css
script.js
assets/
api/chat.js
package.json
vercel.json
```

## MiniMax 环境变量

本地已创建 `.env` 用于开发调试。这个文件包含真实密钥，只能留在本地，不要上传。

Vercel 线上环境变量需要在项目后台配置：

```text
AI_API_KEY=你的 MiniMax API Key
AI_API_BASE=https://api.minimaxi.com/v1
AI_MODEL=MiniMax-M3
CHAT_RATE_LIMIT_WINDOW_MS=60000
CHAT_RATE_LIMIT_MAX=12
```

## 不要上传 / 不要写入前端

```text
.env
真实 API Key
server.js
knowledge/
neocities_site/
```

API Key 只能放 Vercel Environment Variables，不能写进 `index.html` 或 `script.js`。
