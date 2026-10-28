/**
 * ⚠️ 已废弃（DEPRECATED）
 * ============================================================
 * 本文件是早期「KV + 仅导出」的模板，缺少：
 *   - 可查询的持久化（后台需要计数 / 单条详情 / 稳定顺序 CSV）；
 *   - 受保护的研究者后台与账号体系（原 token-in-URL 较弱）；
 *   - 幂等 upsert 与管理接口。
 *
 * 请改用以下实现（满足本任务全部要求）：
 *   - 统一逻辑：functions/_shared/app.mjs
 *   - Pages Functions 路由：functions/[[path]].mjs、functions/admin.mjs
 *   - 独立 Worker（可选）：deploy/worker.mjs
 *   - D1 表结构：deploy/schema.sql
 *   - 部署与后台说明：docs/服务端部署与后台说明.md
 *
 * 新的持久化使用 Cloudflare D1（真实数据库），管理员鉴权为
 * 「密码 → HMAC-JWT」，密码/JWT 密钥仅存在于服务端 Secret。
 * 本文件保留仅作历史参考，请勿再部署。
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 管理接口：导出全部记录为 JSON（带令牌）
    if (request.method === "GET" && url.pathname === "/export") {
      if (url.searchParams.get("token") !== env.ADMIN_TOKEN) {
        return new Response("Unauthorized", { status: 401 });
      }
      const list = await env.EXP_KV.list();
      const out = [];
      for (const key of list.keys) {
        const v = await env.EXP_KV.get(key.name);
        if (v) try { out.push(JSON.parse(v)); } catch (_) {}
      }
      return new Response(JSON.stringify(out, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // 管理接口：计数
    if (request.method === "GET" && url.pathname === "/count") {
      if (url.searchParams.get("token") !== env.ADMIN_TOKEN) {
        return new Response("Unauthorized", { status: 401 });
      }
      const list = await env.EXP_KV.list();
      return new Response(JSON.stringify({ count: list.keys.length }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 数据接收：POST /submit
    if (request.method === "POST" && url.pathname === "/submit") {
      let payload;
      try { payload = await request.json(); } catch (_) {
        return new Response("Bad JSON", { status: 400 });
      }
      const pid = payload && payload.participant_id;
      if (!pid || typeof pid !== "string" || !/^EXP-[A-Z0-9]{8}$/.test(pid)) {
        return new Response("Invalid participant_id", { status: 400 });
      }
      if (payload.schema_version !== "exp-v1") {
        return new Response("Unsupported schema_version", { status: 400 });
      }
      // 以 participant_id 去重：已存在则不覆盖（保留首次完整提交）
      const existing = await env.EXP_KV.get(pid);
      if (!existing) {
        await env.EXP_KV.put(pid, JSON.stringify(payload));
      }
      return new Response(JSON.stringify({ ok: true, stored: !existing }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
