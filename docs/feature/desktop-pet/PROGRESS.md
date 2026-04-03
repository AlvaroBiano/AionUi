# 桌面宠物功能 — 开发进度

## 分支
- 设计资产: `feat/desktop-pet` (已合并部分到 v2)
- 代码实现: `feat/desktop-pet-v2` (当前活跃)

## 已完成 ✅

### 设计资产
- [x] 基准造型 `pet-static-base.svg`（用户设计稿）
- [x] 20 个独立 SVG 动画状态文件（`docs/feature/desktop-pet/states/`）
- [x] HTML 预览 demo（`pet-demo-v6.html` / `pet-interactive-demo.html`）
- [x] SVG 画廊预览（`states/preview.html`）
- [x] public 目录资产（`public/pet-states/`）

### Electron 窗口
- [x] 独立透明 BrowserWindow（`focusable: false` + `setIgnoreMouseEvents(true)`）
- [x] macOS 层级（`screen-saver` + `visibleOnAllWorkspaces`）
- [x] Windows 层级（`pop-up-menu`）
- [x] dock 图标正常显示（`app.dock.show()` 恢复）
- [x] app 退出时销毁宠物窗口
- [x] 不影响主窗口焦点（不闪退）

### AI 事件联动
- [x] `bridge.adapter.emit` hook（`setPetNotifyHook`）
- [x] 覆盖所有平台：ACP / OpenClaw / Gemini / Codex / Nanobot / Remote
- [x] 状态映射：thought→thinking / content→working / finish→happy / error→error
- [x] 防抖：状态相同不重复发 IPC
- [x] 异步：`setImmediate` 不阻塞 bridge 主流程

### 交互（双窗口方案）
- [x] hitWin 创建（透明输入窗口覆盖宠物身体区域）
- [x] 拖拽：hitWin pointerdown → 主进程光标轮询 → setBounds + syncHitWin
- [x] 拖拽状态恢复：拖拽结束后回到拖拽前的 AI 状态
- [x] 单击：attention（3s 回 idle）
- [x] 右键菜单：摸一摸 / 大小调整(240/320/440) / 隐藏

### 系统托盘
- [x] 「🐾 桌面宠物」子菜单（摸一摸 / 睡觉 / 重置）

### 文档
- [x] 方案设计 `desktop-pet-proposal.md`
- [x] 交互映射表 `interaction-mapping.md`
- [x] 实现方案 review `implementation-review.md`
- [x] 拖拽 & 行为调研 `drag-and-behavior-research.md`

## 进行中 🔧

### 已知问题
- [ ] AI 回复延迟 — 发消息后宠物反应慢一拍，需排查是 bridge hook 性能还是 AI 本身延迟
- [ ] 拖拽灵敏度 — threshold=2 可能还不够灵敏
- [ ] hitWin 焦点 — macOS 上 `focusable: false` 的 hitWin 是否真的不抢焦点待长期验证

## 未完成 ❌

### 空闲行为系统
- [ ] 主进程 50ms tick 循环
- [ ] 20s 随机 idle（random-look / random-read）
- [ ] 60s yawning → dozing
- [ ] 10min sleeping
- [ ] 鼠标移动 → waking

### 交互完善
- [ ] 双击方向偏头（poke-left / poke-right）
- [ ] 连点恼怒（3+ → error）
- [ ] 拖拽中切换 dragging SVG（当前用主进程 changePetState，待验证）

### 眼睛追踪
- [ ] idle 时眼球跟随鼠标（需通过 SVG contentDocument 访问内部元素）

### 权限气泡窗口
- [ ] 监听 confirmation.add 事件
- [ ] 弹出气泡窗口（跟随宠物位置）
- [ ] approve/deny 按钮
- [ ] AionUi 隐藏时仍可通过宠物确认权限

### 设置面板
- [ ] 设置 → 显示 → 桌面宠物（开关/大小/AI联动/眼睛追踪/勿扰）
- [ ] 首次引导卡片
- [ ] 位置记忆（ConfigStorage）

### 造型统一
- [ ] 所有状态 SVG 基于 base 统一帽子/手/身体风格
- [ ] 状态切换不跳变

### 平台适配
- [ ] Windows 测试
- [ ] Linux 测试
- [ ] 多显示器支持

## 改动的文件

### 新增文件
```
src/renderer/pet.html              — 宠物渲染窗口
src/renderer/pet-renderer.ts       — 宠物渲染逻辑
src/renderer/pet-hit.html          — 输入窗口
src/renderer/pet-hit-renderer.ts   — 输入窗口逻辑
src/petPreload.ts                  — 宠物窗口 preload
src/petHitPreload.ts               — 输入窗口 preload
src/process/pet/PetWindowManager.ts — 主进程窗口管理
public/pet-states/*.svg            — 20 个 SVG 资产
docs/feature/desktop-pet/          — 设计资产 + 文档
```

### 修改的现有文件
```
electron.vite.config.ts            — 加了 pet/petHit preload + renderer 入口
src/index.ts                       — import + createPetWindow + destroyPetWindow
src/common/adapter/main.ts         — setPetNotifyHook + bridge.adapter.emit hook
src/process/utils/tray.ts          — 桌面宠物子菜单
```
