// Pages Functions 统一入口（捕获所有 /api/* 路径）。
// 静态文件（index.html、admin 页面等）由 Pages 直接提供，不进入此函数。
import { handle } from "./_shared/app.mjs";

export const onRequest = ({ request, env }) => {
  const url = new URL(request.url);
  return handle(url.pathname, request.method, request, env);
};
