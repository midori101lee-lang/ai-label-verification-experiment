// Pages Functions 后端入口，位于 functions/api/ 下，仅匹配 /api/*（含任意深度，如 /api/admin/login）。
// 首页 "/" 及静态资源（index.html、xlsx-writer.js 等）不在此匹配范围内，由 Pages 直接提供静态文件。
import { handle } from "../_shared/app.mjs";

export const onRequest = ({ request, env }) => {
  const url = new URL(request.url);
  return handle(url.pathname, request.method, request, env);
};
