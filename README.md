# 武大法硕求职雷达 · 2027

面向“武汉大学法律硕士（非法学）2027届、本科非法学”的全国公开招聘信息网站。

## 已实现

- 完全公开：任何设备无需登录或注册即可阅读，投递按钮只跳转招聘单位官方页面。
- 全国范围筛选：覆盖央企、中科院体系企业、地方国企、烟草、金融、事业单位、科研院所、律所与大型科技企业。
- 专业限制判断：区分“明确接受法律硕士（非法学）”“可能接受”“要求本科法学”“要求本硕均法学”和“专业限制待核验”。
- 建筑硬排除：建筑施工、工程建设、施工企业、房地产开发建设及相关岗位不会入库。
- 自动巡检：GitHub Actions 每 6 小时读取官方招聘源，识别 2027 届岗位并按岗位 ID 去重更新；截止日期已过的岗位会自动关闭。
- 实时推送：数据库新增或更新岗位后，已打开的网页自动刷新岗位数据。
- 来源标注：无法确认官方来源或专业限制时仍自动公开，但显示醒目标记并降低匹配度。
- 初始数据：包含截至 2026-08-31 核验的 7 个 2027 届岗位和 12 个官方巡检入口。

## 本地运行

```powershell
pnpm install
pnpm dev
```

未配置 Supabase 时，网站使用内置的首批已核验岗位，便于直接预览。登录和跨设备进度需要完成云端配置。

## 免费部署

### 1. 创建 Supabase 项目

1. 登录 Supabase，新建免费项目。
2. 在 SQL Editor 依次执行：
   - `supabase/schema.sql`
   - `supabase/seed.sql`
3. 在 Authentication → URL Configuration 中添加：
   - Site URL：部署后的 Vercel 地址
   - Redirect URL：`https://你的地址.vercel.app/auth/callback`

### 2. 部署到 Vercel

将本目录上传至一个 Git 仓库，在 Vercel 导入该仓库，然后配置以下环境变量：

```text
NEXT_PUBLIC_SUPABASE_URL=Supabase 项目 URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=Supabase publishable key
SUPABASE_SERVICE_ROLE_KEY=Supabase secret key
```

`SUPABASE_SERVICE_ROLE_KEY` 只能配置为服务端环境变量，不得写入浏览器代码或公开仓库。

### 3. 启用六小时巡检（推荐）

在 GitHub 仓库的 Settings → Secrets and variables → Actions 中添加：

```text
SUPABASE_URL=Supabase 项目 URL
SUPABASE_SERVICE_ROLE_KEY=Supabase service role key
```

`.github/workflows/sync-jobs.yml` 会每 6 小时运行，也可以在 Actions 页面手动触发。仓库建议保持为私有；按每天 4 次的运行频率，通常远低于 GitHub Free 每月 2,000 分钟额度。

GitHub Actions 是唯一启用的巡检执行器。这样无需配置额外密钥，也不会因为免费计划的每日任务限制产生重复抓取。

## 数据表

- `jobs`：公开岗位信息和唯一岗位 ID。
- `sources`：招聘来源和单位分类。
- `sync_runs`：每次巡检的结果和错误记录。

## 更新规则

- 只收录招聘年度为 2027 的岗位。
- `job_id` 已存在时仅更新岗位信息，不新增重复记录。
- 高置信度岗位直接公开；来源或专业要求不清时带标记公开。
- 招聘页面消失、明确截止或截止日期已过时，更新为“已截止”或“已关闭”。
- 聚合网站只用于发现岗位；能找到官方投递页时，投递按钮必须指向官方页面。

## 重要说明

抓取公开网页不能保证秒级同步，实际更新周期为 6 小时。验证码、登录墙、公众号封闭页面和强反爬系统可能导致单个来源暂时失败，错误会写入 `sources.last_error` 和 `sync_runs`，不会生成虚假岗位。
