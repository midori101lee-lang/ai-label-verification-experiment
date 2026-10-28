// 研究者后台页面（/admin）。UI 为公开静态页，不含任何密钥；
// 鉴权在登录后通过 Bearer 令牌进行，密码/JWT 密钥仅存在于服务端 Secret。
import { adminHtml } from "./_shared/admin-ui.mjs";

export const onRequest = () =>
  new Response(adminHtml(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
