# 對帳

先押注，再對帳，每週只改一件事。個人用的紀錄、復盤、回饋 App。

- **每日紀錄**：在網頁或 LINE 講今天要做什麼、做了什麼。AI 整理摘要，抓出要做的事和你說的預估時間。
- **今晚對帳**：每件押注只按有做／沒做／改期，填實際時間，看預估和實際的差距。過期沒確認的一起清。每晚 9 點 LINE 推對帳卡，回「1 2 有做，3 沒做 被插隊」即可。
- **每週回顧**：先驗證上週的預測，再看本週事實、AI 找出的模式（可按對／部分對／不對），最後選下週只改的一件事並寫下預測。
- **結果軌跡**：預估準確度的趨勢，以及把成果連回當初的紀錄。

## 架構

- `public/`：前端（純 HTML/CSS/JS，不需要建置）
- `netlify/functions/api.mjs`：`/api/*` 後端
- `netlify/functions/line-webhook.mjs`：LINE webhook（`/line/webhook`）
- `netlify/functions/nightly.mjs`：每天 21:00（台北）推送對帳卡
- `lib/`：商業邏輯、儲存（Netlify Blobs）、AI（Claude）、LINE
- 資料存在 Netlify Blobs，單一使用者，用 PIN 登入。

## 環境變數（在 Netlify 的 Site configuration → Environment variables 設定）

| 變數 | 必要 | 說明 |
|---|---|---|
| `APP_PIN` | 是 | 登入用的 PIN |
| `APP_SECRET` | 建議 | 簽 session cookie 的密鑰，隨機長字串；沒設就用 PIN |
| `ANTHROPIC_API_KEY` | 選用 | 啟用 AI 整理與每週回顧（模型 `claude-opus-5-5`） |
| `LINE_CHANNEL_SECRET` | 選用 | LINE Messaging API 的 Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | 選用 | LINE Messaging API 的長期 Channel access token |

沒有 AI 或 LINE 也能用：紀錄只存原文，押注手動新增，對帳在網頁做。

## LINE 設定

1. 在 LINE Developers 建立 Messaging API channel。
2. 把 Channel secret 和 Channel access token 設成上面的環境變數，重新部署。
3. Webhook URL 填 `https://<你的網站>/line/webhook`，開啟 Use webhook，關閉自動回覆訊息。
4. 用自己的 LINE 加官方帳號好友。**第一個傳訊息的人會被綁定**，之後其他人傳的訊息不會寫入。

## 本機開發

```bash
npm install
npm run dev     # http://localhost:8888，PIN 1234，資料存在 .data/
npm test
```

## 部署

```bash
netlify deploy --prod
```
