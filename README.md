# Scripting-Scripts

我的 [Scripting](https://scripting.fun)（iOS）脚本集合。源码以子目录形式管理，便于 git 版本控制；每个脚本打包成 `dist/*.scripting` 供导入。

## 仓库结构

```
src/<脚本名>/        每个脚本的源码（script.json + index.tsx + 子目录），可 git diff
dist/<脚本名>.scripting   打包产物（zip），导入链接指向它
build.sh             把 src/<名> 打包成 dist/<名>.scripting
make_links.sh        为 dist 下每个脚本生成导入链接并写入本 README
release.sh           发布版本（合并 dev→main + 打 tag，手动 push）
rollback.sh          回退到任意旧版本 tag（前进式，不 force push）
```

> `build.sh` / `make_links.sh` / `release.sh` / `rollback.sh` 是本地辅助脚本，不纳入 git。

## 导入脚本

在 iOS 上点「网页导入」链接即可唤起 Scripting 导入；或复制 `scripting://` deep link。

<!-- LINKS_START -->
- **Pong** — [网页导入](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2FSEMANTICx%2FScripting-Scripts%2Fraw%2Frefs%2Fheads%2Fmain%2Fdist%2FPong.scripting%22%5D) · `scripting://import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2FSEMANTICx%2FScripting-Scripts%2Fraw%2Frefs%2Fheads%2Fmain%2Fdist%2FPong.scripting%22%5D`
<!-- LINKS_END -->

## 开发与发布流程

每个脚本的源码在 `src/<名>/`。导入源是 `dist/<名>.scripting`（zip），由源码打包生成。

**日常开发（dev 分支）**
```bash
git checkout dev
# 改 src/<名>/ 下源码
git add -A && git commit -m "改动说明"
```

**打包 + 刷新导入链接**
```bash
sh build.sh            # 打包所有脚本（或 sh build.sh Pong 只打一个）
sh make_links.sh       # 重新生成 README 里的导入链接
git add -A && git commit -m "build: 更新打包产物"
```

**发布一个版本**（把 dev 推成线上版本并打 tag）
```bash
sh release.sh v1.0.1 "本次更新说明"
git push origin main --follow-tags    # 确认后手动 push 才真正上线
```

**改坏了，回退**
```bash
sh rollback.sh v1.0.0
git push origin main                  # 确认后手动 push
```

回退采用「用旧版本内容生成新提交」，不需要 force push，远程历史永远完整、安全。

## 添加一个新脚本

1. 把新脚本源码放进 `src/<新脚本名>/`（确保根有 `script.json`，`entry` 指向入口文件）
2. `sh build.sh <新脚本名>` 打包
3. `sh make_links.sh` 刷新导入链接
4. commit、`release.sh` 发版、push
