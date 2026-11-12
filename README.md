# Wallet Scout

本地运行的 meme 币钱包研究台，支持 BSC、Solana 和 Robinhood Chain。
贴上钱包地址或合约地址（CA），就能看到谁早期买进、谁跟谁有资金关联、谁真的赚到钱。
可以建立自己的钱包库、实时跟踪聪明钱，也能在 GMGN、DeBot、Ave 的代币页面上看到自己的标签。

所有东西都在你自己的电脑上运行，资料只存在 `data/` 文件夹。

[使用说明](USAGE.zh-CN.md)

## 功能

- **查地址**：分析钱包或 CA。CA 会列出早期买家、进场时间、持仓、已实现／未实现盈亏，以及有共同资金来源的钱包群组。
- **资金追查**：追一个钱包的钱从哪里来、往哪里去。
- **钱包库**：查过的钱包都能存下来，加标签和备注；可以筛选、搜索，导出成 XLSX 或 DeBot／GMGN 的导入格式。
- **聪明钱**：收集 GMGN 聪明钱和 KOL 的交易，加上你自己的名单，给钱包评分（0～100，等级 S～D）；多个有份量的钱包买同一颗币时显示共识信号。另外有实时动态、挖掘（从涨过的币里找出赚钱的钱包），以及追踪过去信号表现的覆盘页。
- **Chrome 扩展**：在 GMGN、DeBot、Ave 代币页的持有人旁边显示徽章，侧边栏查看钱包库，右键菜单直接查地址。
- **书签**：把 pump.fun 盈亏、FOMO 持有人和热门榜转进钱包库；只有你点了才会运行。
- **简体中文界面**：网页、扩展和使用说明都是简体中文。

所有评分和信号都是过去交易的统计，只是研究工具，不是买卖建议，也不会下单。

## 需要

- Python 3.10 以上（只用标准库，不用 `pip install`）
- Node.js（目前的 LTS 版本）。聪明钱和部分查询会调用 [gmgn-cli](https://www.npmjs.com/package/gmgn-cli)：装了 pnpm 就用 `pnpm dlx`，没装就用 `npx`。
- GMGN API Key（聪明钱和 GMGN 数据需要）。可选：Etherscan V2 Key、NodeReal API Key（资金追查更深）。都在应用里的 **设置** 填写，去哪里申请见 [API Key](USAGE.zh-CN.md#api-key)。不需要币安或其他交易所的 API Key。
- Chrome 或 Edge（使用扩展时才需要）

## 快速开始

1. 安装 [Python](https://www.python.org/downloads/) 3.10 以上。Windows 安装时要勾选「Add python.exe to PATH」。
2. 安装 [Node.js](https://nodejs.org/)（LTS 版）。
3. 下载这个仓库（**Code → Download ZIP**）并解压，或用 `git clone`。
4. 在那个文件夹打开终端（Windows：用文件资源管理器打开文件夹，在地址栏输入 `cmd` 按 Enter），运行：

   ```bash
   python wallet-server.py
   ```

   Windows 也可以用 `py wallet-server.py`。
5. 打开 <http://127.0.0.1:8787>，点 **设置**，贴上 GMGN API Key。

每一页怎么用、每个 Key 去哪里申请，请看 [使用说明](USAGE.zh-CN.md)。

参数：

| 参数 | 作用 |
| --- | --- |
| `--port 8787` | 监听的端口 |
| `--no-smart-money` | 不启动聪明钱背景收集 |
| `--no-prune` | 不跑钱包库每天的自动清理 |

## 设置

门槛和评分规则都有一般的默认值。要改的话，把 `config.example.json` 复制成 `config.json`，只留下要改的项目；`_help` 里有每一项的说明。`SIGNAL`、`GRADE_FLOORS` 这类分组设置可以只写其中一项，其他照默认值：

```json
{
  "GRADE_FLOORS": { "S": 85 },
  "SIGNAL": { "strongUsd": 3000 }
}
```

改完重启服务器。

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WALLET_SCOUT_DATA` | `./data` | 数据库、封存和密钥放的位置 |
| `WALLET_SCOUT_CONFIG` | `./config.json` | 设置文件路径 |
| `PNPM_EXECUTABLE` | 从 PATH 找 | gmgn-cli 用的 pnpm |
| `NODE_EXECUTABLE` | 从 PATH 找 | 使用的 Node.js |

## Chrome 扩展

1. 打开 `chrome://extensions`（或 `edge://extensions`），开启 **开发者模式**。
2. 点 **加载已解压的扩展程序**，选 `extension` 文件夹。
3. 服务器要保持运行。扩展只连 `http://127.0.0.1:8787`，地址可以在侧边栏的设置里改。

## 数据和隐私

- 数据库、封存和日志都在 `data/`（git 会忽略）。
- API Key 存在 `data/private/`。Windows 上会用你的 Windows 账户加密（DPAPI）；其他系统是明文文件，请保管好这个文件夹。
- 服务器只会调用查询需要的公开接口（GMGN、DexScreener、Binance Web3、pump.fun、FOMO、公开 RPC 节点和区块浏览器），不会把资料送到别的地方。

## 测试

```bash
python -m unittest discover -s tests -v
```

测试用临时数据文件夹，不会连网络。

## 授权

[MIT](LICENSE)
