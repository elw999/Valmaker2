import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import path from "path";
import { fileURLToPath } from "url";

// 讓 __dirname 在 ES Module 中也能正常使用
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// ✅ 健康检查端点，供 Render 使用
app.get("/api/health", (_req, res) => {
  res.status(200).send("OK");
});

// ✅ 託管前端靜態檔案（從 public 資料夾提供）
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", router);

// ✅ 所有非 /api 路徑都回傳前端入口頁（支援 React Router）
// 使用 use 而非 get，避免 Express 5 path-to-regexp 報錯
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

export default app;