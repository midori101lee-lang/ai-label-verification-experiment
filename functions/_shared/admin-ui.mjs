// 研究者后台 UI（公开静态页，不含任何密钥）。
// 密码 / JWT 密钥仅存在于服务端 Secret；本页只在登录后于 sessionStorage 持有运行时令牌。
export function adminHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>实验数据后台 · AI 标识研究</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;background:#f3f5f8;color:#1f2530}
  .wrap{max-width:1100px;margin:0 auto;padding:22px}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:#69707d;font-size:13px;margin-bottom:14px}
  .card{background:#fff;border:1px solid #e3e7ee;border-radius:10px;padding:16px;margin-bottom:14px}
  input[type=password]{padding:9px 11px;font-size:14px;border:1px solid #ccd3de;border-radius:8px;width:260px}
  button{font-size:14px;padding:8px 13px;border:0;border-radius:8px;background:#155a94;color:#fff;cursor:pointer}
  button.sec{background:#eef2f7;color:#243044}
  button.sm{font-size:12px;padding:5px 9px}
  #login{display:block}
  #app{display:none}
  #counts{font-size:14px;color:#243044;margin-bottom:8px;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{border:1px solid #e3e7ee;padding:7px 9px;text-align:left}
  th{background:#f7f9fc;position:sticky;top:0}
  tbody tr{cursor:pointer}
  tbody tr:hover{background:#f0f6ff}
  .detail{white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12px;max-height:360px;overflow:auto;background:#0f1622;color:#d7e2f0;padding:12px;border-radius:8px}
  .muted{color:#8a93a0}
  .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .err{color:#c0392b}
</style>
</head>
<body>
<div class="wrap">
  <h1>实验数据后台</h1>
  <div class="sub">AI 标识与信息验证行为实验 · 仅限研究者访问</div>

  <div id="login" class="card">
    <div class="row">
      <input id="pw" type="password" placeholder="研究者管理密码" autocomplete="off">
      <button onclick="doLogin(event)">登录</button>
    </div>
    <div id="loginErr" class="err" style="margin-top:8px"></div>
  </div>

  <div id="app">
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div id="counts">加载中…</div>
        <div class="row">
          <button class="sec sm" onclick="dlJson()">批量下载 JSON</button>
          <button class="sec sm" onclick="dlCsv()">批量下载 CSV</button>
          <button class="sec sm" onclick="logout()">退出登录</button>
        </div>
      </div>
    </div>

    <div class="card">
      <table>
        <thead><tr>
          <th>编号</th><th>状态</th><th>开始时间</th><th>完成时间</th>
          <th>AI标识</th><th>一致性</th><th>核查状态</th><th>verification</th><th>服务端接收</th>
        </tr></thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>

    <div class="card" id="detailCard" style="display:none">
      <div class="row" style="justify-content:space-between">
        <b>记录详情：<span id="detailPid"></span></b>
        <button class="sec sm" onclick="dlOne()">下载此条 JSON</button>
      </div>
      <div class="detail" id="detailBody" style="margin-top:10px"></div>
    </div>
  </div>
</div>

<script>
var token = sessionStorage.getItem('exp_admin_token') || '';
function show(id,on){ document.getElementById(id).style.display = on ? 'block' : 'none'; }
function api(path, opts){ opts = opts || {}; opts.headers = Object.assign({'Authorization':'Bearer '+token}, opts.headers||{}); return fetch(path, opts); }
function fmt(ts){ return ts ? new Date(ts).toLocaleString() : '-'; }
function downloadBlob(name, blob){
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}
function doLogin(e){
  e.preventDefault();
  var pw = document.getElementById('pw').value;
  fetch('/api/admin/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:pw})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, d:d}; }); })
    .then(function(o){
      if(!o.ok || !o.d.ok){ document.getElementById('loginErr').textContent = '密码错误'; return; }
      token = o.d.token; sessionStorage.setItem('exp_admin_token', token);
      document.getElementById('loginErr').textContent = '';
      show('login', false); show('app', true); load();
    })
    .catch(function(){ document.getElementById('loginErr').textContent = '网络错误，请重试'; });
}
function load(){
  api('/api/admin/records').then(function(r){
    if(r.status === 401){ sessionStorage.removeItem('exp_admin_token'); token=''; show('app',false); show('login',true); return; }
    return r.json().then(function(d){ render(d); });
  });
}
function render(d){
  document.getElementById('counts').textContent = '共 ' + d.counts.total + ' 条 ｜ 完成 ' + d.counts.completed + ' ｜ 未完成 ' + d.counts.in_progress;
  var rows = d.records.map(function(x){
    return '<tr data-pid="'+x.participant_id+'"><td>'+x.participant_id+'</td><td>'+x.status+'</td><td>'+fmt(x.started_at)+
      '</td><td>'+fmt(x.completed_at)+'</td><td>'+x.AI_label+'</td><td>'+x.evidence_consistency+'</td><td>'+x.verify_status+
      '</td><td>'+x.verification+'</td><td>'+fmt(x.server_received_at)+'</td></tr>';
  }).join('');
  document.getElementById('tbody').innerHTML = rows || '<tr><td colspan="9" class="muted">暂无记录</td></tr>';
  document.getElementById('tbody').querySelectorAll('tr[data-pid]').forEach(function(tr){
    tr.addEventListener('click', function(){ viewOne(tr.getAttribute('data-pid')); });
  });
}
var currentPid = '';
function viewOne(pid){
  currentPid = pid;
  api('/api/admin/record/'+encodeURIComponent(pid)).then(function(r){ return r.text(); }).then(function(t){
    document.getElementById('detailPid').textContent = pid;
    document.getElementById('detailBody').textContent = t;
    show('detailCard', true);
  });
}
function dlOne(){ if(!currentPid) return; api('/api/admin/record/'+encodeURIComponent(currentPid)).then(function(r){ return r.blob(); }).then(function(b){ downloadBlob('record_'+currentPid+'.json', b); }); }
function dlJson(){ api('/api/admin/export/json').then(function(r){ return r.blob(); }).then(function(b){ downloadBlob('experiment_records_server.json', b); }); }
function dlCsv(){ api('/api/admin/export/csv').then(function(r){ return r.blob(); }).then(function(b){ downloadBlob('experiment_records_server.csv', b); }); }
function logout(){ sessionStorage.removeItem('exp_admin_token'); token=''; show('app',false); show('login',true); }
if(token){ show('login',false); show('app',true); load(); }
</script>
</body>
</html>`;
}
