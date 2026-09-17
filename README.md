# 论文实验材料预测试 Demo

> 毕业论文《AI标识如何影响用户的信息验证行为——基于信息加工机制的实验研究》的**材料预测试**网页。
> 用途：邀请少量非相关专业同学，检验刺激材料是否容易被普通人自然理解。**不是正式实验**，不收集个人身份信息。

## 实验设计（3 × 2）

| 自变量 | 水平 | 说明 |
| --- | --- | --- |
| **AI_label**（AI标识） | 0 = 无标识 ｜ 1 = AI辅助 ｜ 2 = AI生成 | 仅在署名行下方以灰色 chip「AI 辅助 ⓘ」/「AI 生成 ⓘ」呈现 |
| **evidence_consistency**（内容证据一致性） | 0 = 一致 ｜ 1 = 冲突 | 一致：两项结果方向一致；冲突：第一项明显改善、第二项只有较小变化 |

六个条件：0/0、0/1、1/0、1/1、2/0、2/1。

选题：手机「护眼模式」对视疲劳的作用（健康/生活类，无需专业知识，无政治/立场敏感）。

## 项目结构

```
ai-label-verification-experiment/
├── index.html            # 单文件、零依赖（HTML+CSS+JS），可直接部署
├── README.md
└── docs/
    └── material-audit.md # 材料纯净度审计要点（14 项 + 预测试说明）
```

## 本地打开

直接用浏览器打开 `index.html` 即可；或起一个本地静态服务：

```bash
cd ai-label-verification-experiment
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000
```

## 两种模式

### 预测试模式（默认显示，参与者视图）

- 进入即随机分配一个实验条件，**对参与者隐藏**（页面不显示条件名/条件码，不显示对错）。
- 流程：介绍 → 阅读新闻 → Q1–Q4 + 开放题 → 完成页。
- 问题（仅用于材料理解诊断，非假设检验）：
  - **Q1** 护眼模式学生是否报告眼睛更舒服？（理解检验）
  - **Q2** 不同观察结果的变化是否一致？（一致性操纵检验，1–7）
  - **Q3** 能否通过查其他资料得到更明确判断？（可化解性，1–7）
  - **Q4** 是否存在明显错误信息？（假信息诊断）
  - **开放题** 哪个地方难以理解？
- **数据**：写入本机浏览器（localStorage），完成页可「复制我的回答」或「下载 JSON」发给研究者。跨设备时由参与者手动发送，无后端、无登录、无 PII。

### 研究者测试模式（默认隐藏）

页面右下角有一个**低存在感**的「研究者」按钮（半透明），点击后展开完整开发工具，包含：

1. 刺激材料对比（6 条件矩阵 + 证据速览行开关）
2. 被试完整流程（含操作检验、核验机会、最终判断）
3. 数据与导出（JSON / CSV）
4. 实验纯净度审计（14 项实时核对）
5. 分析与风险
6. 材料理解自检（研究者自测，显示标准答案）
7. **预测试数据**（本机累计的参与者作答表 + CSV/JSON 下载）

> 研究者模式下「证据速览行」默认**关闭**；「高亮改动位置」仅影响研究者视图。正式预测试前请确认两者均为关闭状态。

## 部署（GitHub + Cloudflare Pages）

纯静态站点，无需 build：

- 仓库：`ai-label-verification-experiment`（public，独立仓库，与论文其他项目隔离）
- 部署源：GitHub 仓库
- 分支：`main`
- Build command：留空
- Build output directory：项目根目录（即 `index.html` 所在目录）

具体步骤见下方「给研究者的部署步骤」。

## 数据伦理

- 不收集姓名、手机号、邮箱、身份证、学校等任何个人身份信息。
- 参与者仅被分配一个匿名 `participant_id`（随机生成）。
- 材料条件（AI_label / evidence_consistency）仅研究者可见，用于按条件汇总；参与者页面不显示。
- 本仓库**不包含**任何真实被试数据；预测试数据由研究者在本机浏览器收集。

## 给研究者的部署步骤（本环境 gh / Cloudflare 未登录，需你执行）

1. **登录 GitHub CLI**（终端）：
   ```bash
   gh auth login          # 按提示完成浏览器/设备授权
   ```
2. **创建仓库**（已确认同名仓库不存在时）：
   ```bash
   gh repo create ai-label-verification-experiment --public --description "Thesis experiment material pilot demo" --source=. --remote=origin --push
   ```
   或手动在 GitHub 网页创建后，添加 SSH remote：
   ```bash
   git remote add origin git@github.com:<你的用户名>/ai-label-verification-experiment.git
   git push -u origin main
   ```
   > 使用 **SSH** remote，不要 HTTPS。
3. **部署 Cloudflare Pages**：登录 Cloudflare 面板 → Pages → 创建项目 → 连接 GitHub 仓库 `ai-label-verification-experiment` → 分支 `main`，Build command 留空，输出目录为根 → 部署。生成类似 `https://ai-label-verification-experiment.pages.dev`。

## 当前已知风险（预测试重点观察）

- 冲突版的「两项结果并没有呈现同样明显的变化」一句仍偏直白，预测试目标：Q2/Q3 正确率落在 **80%–95%**；若接近 100% 需再弱化。
- 信息完整度在冲突版客观上更高（操纵固有属性），已在论文局限中说明。
- 素材理解门槛已实测：正文 p 值 0 次、统计术语 0 次、专家判断 0 次。
