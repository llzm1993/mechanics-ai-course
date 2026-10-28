# 《力学》AI 智慧课程

> 基于人工智能的大学物理《力学》互动教学平台 —— 用 3D 互动闪卡与物理过程可视化，让抽象的力学概念变得可感、可玩、可懂。

## 项目简介

本项目是一个**纯静态前端**的开放教学站点，依托 AI 重构传统力学课堂的学习体验：

- 🧠 **AI 知识梳理**：自动提炼核心概念、易错点与知识图谱
- 🎴 **3D 互动闪卡**：公式、概念与三维示意结合，翻转记忆
- 🌀 **物理过程可视化**：实时三维动画演示陀螺进动、角动量变化等
- 📈 **自适应学习**：根据反馈动态调整难度与重点

## 目录结构

```
力学/
├── index.html                          # 课程主页面（首页 + 演示跳转入口）
├── README.md
├── .gitignore
└── demos/                              # 互动演示
    ├── mechanics_ch1_flashcards.html   # 第一章 质点运动学 3D 互动闪卡
    └── gyroscope-precession.html       # 陀螺重力进动与角动量增量 3D 演示
```

## 本地预览

项目无任何构建步骤，直接用浏览器打开 `index.html` 即可：

```bash
# 方式一：直接双击 index.html
# 方式二：启动一个本地静态服务器（推荐，避免个别浏览器对本地文件的限制）
cd 力学
python -m http.server 8000
# 然后浏览器访问 http://localhost:8000
```

## 部署到 GitHub Pages

1. 在 GitHub 上 **New repository**，仓库名建议为 `mechanics-ai-course`（或任意名称）。
2. 将本仓库推送到 GitHub：
   ```bash
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git branch -M main
   git push -u origin main
   ```
3. 进入仓库 **Settings → Pages**，Source 选择 `Deploy from a branch`，
   Branch 选择 `main`、目录选 `/ (root)`，保存。
4. 稍等片刻，访问 `https://<你的用户名>.github.io/<仓库名>/` 即可看到课程主页。

> 主页 `index.html` 位于仓库根目录，GitHub Pages 会自动将其作为站点首页。

## 演示说明

| 演示 | 内容 | 技术 |
| --- | --- | --- |
| 质点运动学闪卡 | 第一章核心概念与公式的 3D 互动闪卡 | MathJax |
| 陀螺进动演示 | 重力矩下陀螺为何不倒、角动量增量几何 | Three.js |

## 后续规划

- [ ] 按章节补充更多 AI 互动演示
- [ ] 增加知识点自测与错题本
- [ ] 接入大语言模型做答疑助手

欢迎通过仓库 Issues 提出需求与建议。
