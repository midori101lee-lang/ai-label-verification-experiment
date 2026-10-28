// 可选 · 独立 Cloudflare Worker 入口（与 Pages Functions 共用同一套逻辑 app.mjs）。
// 部署方式见 docs/服务端部署与后台说明.md。
// 若已采用 Pages Functions（functions/ 目录），则无需部署此文件。
import { handle } from "../functions/_shared/app.mjs";
import { adminHtml } from "../functions/_shared/admin-ui.mjs";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      return new Response(adminHtml(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return handle(url.pathname, request.method, request, env);
  }
};
