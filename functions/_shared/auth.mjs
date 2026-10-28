// 研究者后台鉴权（仅依赖 Web Crypto，浏览器/Worker/Node22 通用）
// - 管理密码 ADMIN_PASSWORD 与签名密钥 JWT_SECRET 仅存在于服务端 Secret，绝不进入前端。
// - 登录成功签发 HMAC-SHA256(JWT) 短时效令牌；后台接口凭 Bearer 令牌访问。
// - 前端只在登录后于 sessionStorage 持有运行时令牌，不含任何硬编码密钥。

const subtle = globalThis.crypto && globalThis.crypto.subtle;

function b64urlEncode(bytes) {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(obj) {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
  const bin = atob(str + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function issueToken(secret, ttlSec = 8 * 3600) {
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const payload = b64urlJson({ sub: "admin", iat: now, exp: now + ttlSec });
  const data = header + "." + payload;
  const key = await subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: { name: "SHA-256" } }, false, ["sign", "verify"]);
  const sig = await subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return data + "." + b64urlEncode(new Uint8Array(sig));
}

export async function verifyToken(token, secret) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = parts[0] + "." + parts[1];
  try {
    const key = await subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: { name: "SHA-256" } }, false, ["sign", "verify"]);
    const ok = await subtle.verify("HMAC", key, b64urlDecode(parts[2]), new TextEncoder().encode(data));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

// 恒定时间字符串比较，避免密码逐字符时序侧信道
export function timingSafeEqualStr(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
