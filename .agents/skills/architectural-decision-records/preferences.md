# ADR Preferences

preferred-style: madr-minimal

Recorded 2026-10-05 at the user's choice when adopting the `spec-driven-with-adr`
schema (`openspec/schemas/spec-driven-with-adr/`).

本仓 ADR 用 `madr-minimal`：标题 / Status+Date / Context / Considered Options /
Decision / Consequences。与既有的 9 篇（原 `docs/adr/`，现 `adr/0002`–`0016`）结构一致——
它们已是「决定 + Considered Options + Consequences」的形状，只是缺 Status/Date/Supersedes 头。

既有 9 篇在迁到 `adr/` 时**只补 Status / Date / Supersedes 三行头，正文一字不改**
（用户 2026-10-05 拍板）——保住历史，让 design 步能读出 supersession 图。

格式细节：正文中文（与 `openspec/config.yaml` 的 `Language: zh-CN` 一致），
章节名沿用现有篇的混排（`## 决定` / `## Considered Options` / `## Consequences`），
文件名 `NNNN-kebab-title.md`。
