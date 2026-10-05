# Spec Delta

## ADDED Requirements

### Requirement: 两个小开关按文字认控件

写作框旁边那两个开关（深度思考 / 智能搜索）SHALL 认作站点设计系统的
`div.ds-toggle-button`，**按按钮文字认控件**：`textContent` 去掉前后空白后与标签严格相等。

文字是站点本地化的，这两个开关**只认中文**（`深度思考` / `智能搜索`）。认不出时 SHALL 当
控件不在、回 `page-changed`，MUST NOT 猜、也 MUST NOT 退回按图标或按 DOM 位置认。

状态 SHALL 只认 `aria-pressed === "true"` 为开，**别的一律算关**（不认 `data-*`、不看样式）。

`set` SHALL **幂等**：已在目标态就不点（点了反而拨反）；点完 SHALL 再读一次回**达成态**——
站点可能拒绝或异步生效，回目标态会说谎。`params.enabled` 非布尔时 SHALL 判形状认不出、
回 `unknown-action`，MUST NOT 把 `"false"` 这种字符串按真值收下（与主开关 `toggle.set`
同一口径）。

#### Scenario: 站点改了文案或切到别的语言

- **WHEN** 页面上的开关文字不再是 `深度思考` / `智能搜索`
- **THEN** `think.get` / `think.set` 回 `page-changed`，MUST NOT 按图标或位置猜是哪一个

#### Scenario: 拨一个已经在目标态的开关

- **WHEN** `think.set` 收到 `{ enabled: true }` 而开关本来就是开的
- **THEN** 不点它（幂等），返回 `{ enabled: true }`

#### Scenario: 站点拒了这一拨

- **WHEN** 点过之后 `aria-pressed` 仍是关的
- **THEN** 返回 `{ enabled: false }`（达成态），MUST NOT 返回想要的目标态

#### Scenario: `enabled` 传了字符串

- **WHEN** `think.set` 收到 `{ enabled: "false" }`
- **THEN** 回 `unknown-action`，MUST NOT 把它当 `false` 收下
