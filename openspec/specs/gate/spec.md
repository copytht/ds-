# Spec: gate

## Purpose

控制扩展是否接管页面的全局闸，以及站点范围在申请权限时固定为 `chat.deepseek.com`，运行期不接受任何切换或扩权（ADR-0001/ADR-0007）。

## Requirements

### 总开关

扩展有唯一全局闸 `TOGGLE_STORAGE_KEY`，默认关。开着时扩展接管页面；关着时不执行任何写动作，回 `disabled`。

### 站点范围钉死

站点范围在申请权限的那一刻就固定为 `chat.deepseek.com`，运行期不接受任何切换或扩权（`permission` 在 manifest 固定，不可扩权）。
