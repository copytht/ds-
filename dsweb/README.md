# dsweb/ — DeepSeek 网页的逆向笔记

这里放**对 DeepSeek 网页版本身**的逆向结论：它自己的上限怎么算、检查点
在哪、请求体长什么样。跟本仓的实现无关，是「对手侧的事实」。

## 边界

- `bundle/` 是**下载下来的站点产物**，不进版本库（跟 `captures/` 同例）。
  随时用下面的命令重建。
- `tokenizer.json` 是 DeepSeek-V3 分词器（7.8MB），也不进版本库；取法见下。
- `FINDINGS.md` 是逆向结论，**进版本库**——它是这份材料里唯一有价值的部分。

## 抓取 bundle

```sh
uv run scripts/fetch-dsweb-bundle.py
```

脚本从线上页面**自动发现**当前 bundle 列表（文件名带 hash，发版就变，
写死 URL 会悄悄拿到旧包），默认走本机代理 7897。

## 数 token

网页上限按 **token** 计，前端自己却数不出来（见下「未摸清」），所以要离线数：

```sh
# 一次性取分词器（走代理 7897）
HF_HUB_PROXY=http://127.0.0.1:7897 \
  uv run --with 'huggingface_hub[cli]' hf download \
    deepseek-ai/DeepSeek-V3 tokenizer.json --local-dir dsweb/

# 数任意一段文本（tokenizers 是可选依赖，不进 dsb 的依赖表）
uv run --with tokenizers scripts/count-tokens.py --file 稿子.txt
uv run --with tokenizers scripts/count-tokens.py --file 稿子.txt --repeat 154 --json
```

## 已逆向到的

见 [FINDINGS.md](FINDINGS.md)。当前记着的核心事实：

| 项                     | 值                                              | 出处                                      |
| ---------------------- | ----------------------------------------------- | ----------------------------------------- |
| 前端文本输入字符上限   | `input_character_limit = 2,621,440`             | `model_configs`（服务端下发，三模型同值） |
| 文件 / 历史 token 限额 | `normal_history_and_file_token_limit = 890,880` | 特性缓存 store                            |
| 服务端文本 token 上限  | **982,000 < 上限 < 982,700**（宽 700，±0.07%）  | 真机二分（ADR-0028）                      |
| 「超长约 X%」          | `(输入长度 − 2,621,440) / 输入长度 × 100`       | 前端 `vB` 钩子                            |

上界那个数是 **DeepSeek-V3 分词器口径**——**站点服务端用哪个分词器仍未证实**。

**最大的未摸清项**：站点实际用哪个模型 / 分词器。前端**没有任何分词器**
（`tokenizer`/`BPE`/`count_tokens`/`estimate_token` 全部零命中），所以前端
无法把字符数折算成 token——这解释了前端那个 2,621,440 为什么不会与
token 预算对齐。但「服务端到底按哪个分词器算」仍未证实。
