# 真机抓取：停止键 / 发送键（2026-10-04）

同一会话 `https://chat.deepseek.com/a/chat/s/cd45fe05-1ee8-4a29-8c7d-6c139523ac24`，
在 ds-browser 页面控制台跑只读探测脚本（见本任务 `implement.md` 第 0 步）两次：
生成中一次、空闲一次。结论：**停止键与发送键是同一个元素、同一套 class**，
`aria-label` 为空，只有圆键里的图标不同。

## 生成中（停止）

容器 `sendContainer`：

```html
<div style="width: fit-content;">
  <div role="button"
       class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m _52c986b"
       style="--dsl-button-height: 34px;" tabindex="0">
    <div class="ds-button__background"></div>
    <div class="ds-button__icon ds-button__icon--last-child">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 4.88C2 3.68009 2 3.08013 2.30557 2.65954C2.40426 2.52371 2.52371 2.40426 2.65954 2.30557C3.08013 2 3.68009 2 4.88 2H11.12C12.3199 2 12.9199 2 13.3405 2.30557C13.4763 2.40426 13.5957 2.52371 13.6944 2.65954C14 3.08013 14 3.68009 14 4.88V11.12C14 12.3199 14 12.9199 13.6944 13.3405C13.5957 13.4763 13.4763 13.5957 13.3405 13.6944C12.9199 14 12.3199 14 11.12 14H4.88C3.68009 14 3.08013 14 2.65954 13.6944C2.52371 13.5957 2.40426 13.4763 2.30557 13.3405C2 12.9199 2 12.3199 2 11.12V4.88Z"
              fill="currentColor"></path>
      </svg>
    </div>
  </div>
</div>
```

- `sendPresent: true`（`SEND_SELECTOR` 命中的就是这个停止键）
- 图标 = 填色圆角**方块**（停止）
- class 里没有 `ds-button--disabled`、没有 `bd74640a`

## 空闲（发送，输入框为空）

```html
<div style="width: fit-content;">
  <div role="button"
       class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m ds-button--disabled _52c986b bd74640a"
       style="--dsl-button-height: 34px;">
    <div class="ds-button__background"></div>
    <div class="ds-button__icon ds-button__icon--last-child">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8.3125 0.980206C8.66767 1.05312 8.97902 1.2042 9.2627 1.43235C9.48724 1.613 9.73029 1.85795 9.97949 2.10716L14.707 6.8347L13.293 8.24876L9 3.95579V15.0417H7V3.95579L2.70703 8.24876L1.29297 6.8347L6.02051 2.10716C6.26971 1.85795 6.51277 1.613 6.7373 1.43235C6.97662 1.23988 7.28445 1.04404 7.6875 0.980206C7.8973 0.947029 8.1031 0.955183 8.3125 0.980206Z"
              fill="currentColor"></path>
      </svg>
    </div>
  </div>
</div>
```

- 图标 = 上**箭头**（发送）
- 多了 `ds-button--disabled` 与 `bd74640a`——但那是「输入框空」的禁用态，**不能**当判据
  （输入框有字时空闲的发送键同样没有 disabled）

## 结论（写进 `src/lib/page.ts` 的判据）

1. 停止键与发送键**同一个元素**：`div[role="button"].ds-button--primary.ds-button--filled.ds-button--circle`。
2. 真机上 `aria-label` / `title` / `aria-pressed` 全空 → 不能靠语义属性。
3. 只能**认图标 `path`**：方块 `M2 4.88C2 3.68009…` = 停止；箭头 `M8.3125 0.980206…` = 发送。
4. 认不出回 `page-changed`（fail-safe，绝不误点发送）。

## 附带发现（不在本任务范围）

生成期 `SEND_SELECTOR` 命中的是停止键，所以 `findSendButton()` / `send.click` 在生成中
会点到「停止」。记录待办，本任务不动。
