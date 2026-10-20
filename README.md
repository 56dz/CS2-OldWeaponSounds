# CS2-OldWeaponSounds

把 CS2 服务器的武器音效整体换回 CS:GO 旧版 —— 不只是开火音，还包括切枪、换弹、拉栓、开镜、检视等全部工艺音（Foley）。

实现方式：**soundevents 覆盖 addon + CounterStrikeSharp 插件按武器开关**。

## 为什么是这个方案

CS2 的服务端不传输音频。它在 `CMsgSosStartSoundEvent` 里只下发 **soundevent 名 + 参数（位置、音量、音高）**，音色由**客户端本地**查表解析。因此：

- 服务端换音频文件没有意义 —— 客户端根本不会收到。
- 用 `EmitSound` 直接播 `.vsnd` 路径也不行 —— 会丢掉 soundevent 里带的 3D 定位、距离衰减、遮挡、混响等参数。
- **唯一能同时保证音色与空间效果的路径，是在客户端覆盖同名 soundevent 的定义。**

`Orig_<事件名>` 系列事件是本项目为插件提供的回退通道：其内容与 CS2 原事件逐字段相同，只改事件名，因此播放它等价于播放原版。

## 覆盖范围

| 项目 | 数量 |
|---|---|
| 基础事件 | 462 |
| `_Q` 安静版变体 | 57 |
| `Orig_` 回退事件 | 56 |
| **soundevents 定义块合计** | **575** |
| 音频文件 | 456 个 wav（源 69.9 MB，编译后 72.4 MB） |

覆盖 35 把枪，以及刀、手雷、C4、跳弹、命中、掉落等环境音。涉及的后缀：

```
Single  SingleDistant  SilencedShot  Draw  Deploy  Clipin  Clipout  ClipHit
Slideback  Sliderelease  BoltBack  BoltForward  BoltPull  Boltrelease
Insertshell  Pump  PumpBack  PumpForward  WeaponMove1/2/3
Zoom  ZoomIn  ZoomOut  Throw  Bounce  IdleLoop  TauntLook*  LookAt*  SilencerScrew*
```

所有 456 个音频均由 addon 自带，放在私有命名空间 `sounds/weapons_csgo/` 下，不依赖客户端已有的任何一份音频。

> 用私有命名空间而非覆盖 `sounds/weapons/`，是因为后者会连带改掉 `Orig_` 回退块引用的文件，使「按武器还原原声」失效。

## 三个容易做错的地方

这三点是让音效「听起来确实是 CS:GO」而不只是「换了文件」的关键，也是本项目的核心工作。

### 1. `vsnd_duration` 必须按素材真实长度重写

该字段声明音频时长，引擎据此回收声音实例。

- 声明**偏小** → 声音被截断。`Weapon_M4A1.Clipin` 的 CS2 声明是 0.0998s，而 CS:GO 素材实际 0.416s，被截掉四分之三。
- 声明**偏大** → 尾部拖静音，并白占 `instance_limit` 的槽位。`Weapon_AK47.Clipout` 声明 0.727s，实际 0.189s。

因此不能沿用 CS2 的 `vsnd_duration` —— 它描述的是 CS2 自己那份音频。生成器会解析每个 wav 的 RIFF 头算出真实时长（兼容 `JUNK` 等非标准块顺序）并写入。

### 2. 音量要按素材实测响度归一，不能照搬 CS2 的数值

CS2 的 `volume` 是针对它自己重编码过的素材调出来的。换用 CS:GO 素材后，如果原样保留，同类工艺音的响度会散得很开 —— `Draw` 组内极差 20.2 dB，`Clipin` 组 20.2 dB，听感就是「忽大忽小」。

本项目改为：**保持每个后缀的平均有效响度不变，只搬运 CS:GO 内部的相对比例**，单事件相对 CS2 的变化封顶 ±6 dB。

（另一个常见错误是直接照抄 CS:GO 的 `volume`。CS2 故意把狙击枪切枪音压得很低 —— `Weapon_AWP.Draw` 是 0.05，而 CS:GO 写的是 0.3，照抄等于 +13.8 dB。逐事件归一 + 限幅可以同时避免这两个方向的问题。）

### 3. 必须覆盖 `_Q` 后缀的安静版事件

引擎在**快速切枪、快速换弹**等场景下播的是 `Weapon_XXX.BoltPull_Q` 这类变体，而不是主事件。

这些 `_Q` 事件在 CS:GO 里并不存在同名定义 —— 它们不是独立的声音，只是主事件的音量变体（`volume` 通常是主事件的一半，`vsnd` 指向同一个文件）。所以不能因为它们「在 CS:GO 里查不到」就跳过。漏掉它们的结果是：静止时听到旧音，一快速切枪就变回 CS2 的录音。

## 使用

### 依赖

| 依赖 | 作用 | 地址 |
|---|---|---|
| **Metamod:Source** | 插件加载器（CounterStrikeSharp 的前置） | <https://www.sourcemm.net/downloads.php?branch=dev> |
| **CounterStrikeSharp** | 本插件的运行框架 | <https://github.com/roflmuffin/CounterStrikeSharp> |
| **MultiAddonManager** | 把资源包分发给客户端 | <https://github.com/Source2ZE/MultiAddonManager> |

MultiAddonManager 是必需的。CS2 没有传统 FastDL，`sv_downloadurl` 在 CS2 中不存在，客户端只能通过创意工坊取得自定义资源。

Linux 服务器请选 **`steamrt3`** 构建。`steamrt4` 需要 glibc 2.38，在 Debian 12（glibc 2.36）上会直接加载失败。

### 安装

从 [Releases](../../releases) 下载 zip，解压到服务器的 `game/csgo/` 目录（合并覆盖）：

```
game/csgo/addons/counterstrikesharp/plugins/OldWeaponSounds/
├── OldWeaponSounds.dll
└── OldWeaponSounds.deps.json
```

编辑 `game/csgo/cfg/multiaddonmanager/multiaddonmanager.cfg`：

```cfg
mm_extra_addons         "<创意工坊ID>"
mm_client_extra_addons  "<创意工坊ID>"

mm_addon_mount_download 1     // 每次启动校验并更新 addon
mm_addon_debug          1     // 排查用，稳定后可设为 0
```

本项目对应两个创意工坊物品，音效内容相同，按需选**一个**：

| 物品 | 内容 | 适用场景 |
|---|---|---|
| [`3819498100`](https://steamcommunity.com/sharedfiles/filedetails/?id=3819498100) | 纯音频包（72.8 MB） | 已有自己的模型包 |
| [`3819972417`](https://steamcommunity.com/sharedfiles/filedetails/?id=3819972417) | 模型包 + 音效（1.62 GB） | 同时需要武器模型 |

> **两个包不能同时挂载。** 它们提供相同的资源路径（`soundevents/soundevents_addon.vsndevts_c`、`sounds/weapons_csgo/*.vsnd`），引擎按加载顺序取其一，会出现「改了却没生效」的假象。

重启服务器：

```bash
sudo systemctl restart cs2
```

客户端首次进服会下载资源包，可能被断开一次后自动重连 —— 这是 MultiAddonManager 的固有行为（由 `mm_extra_addons_timeout` 控制），不是故障。

### 配置

插件首次运行会在 CounterStrikeSharp 惯例位置生成完整配置（含全部 35 把武器），无需手工创建：

```
game/csgo/addons/counterstrikesharp/configs/plugins/OldWeaponSounds/OldWeaponSounds.json
```

```jsonc
{
  "enabled": true,          // 插件总开关
  "debug": true,            // 诊断日志
  "weapons": {
    "7": {
      "name": "AK47",
      "weapon_name": "weapon_ak47",
      "item_def_index": 7,
      "legacy_event": "Weapon_AK47.Single",       // addon 覆盖的 CS:GO 旧音
      "orig_event": "Orig_Weapon_AK47.Single",    // 内容为 CS2 原事件
      "enabled": true                             // true = 旧音, false = CS2 原声
    }
    // …共 35 把（含 partyhorn 的非数字 key）
  }
}
```

若检测到旧版布局（配置放在插件目录下），启动时自动迁移到惯例位置并记录日志。这样升级插件只需替换插件目录，不会覆盖已修改的配置。

### 命令

| 命令 | 说明 |
|---|---|
| `css_oldws status` | 总开关、武器条目数、已处理消息数、成功复原数 |
| `css_oldws list` | 列出所有被还原成 CS2 原声的武器 |
| `css_oldws <item_def_index> on\|off` | 开关单把武器（`off` = 还原 CS2 原声），并写回配置 |
| `css_oldws reload` | 重新读取配置 |
| `css_oldws test [事件名或 vsnd 路径]` | 在自己身上直接发射声音，检查返回的 `guid` |

`css_oldws test` 用于判断问题出在服务端还是客户端：`guid = 0` 表示服务端没能解析出该事件或路径；`guid ≠ 0` 表示服务端已发出，问题在客户端侧。

例：`css_oldws 7 off` 把 AK47 还原成 CS2 原声。

配置里另有两个排查开关，默认 `false`：

| 字段 | 作用 |
|---|---|
| `emitForSubclass` | 检测到自定义 subclass（换模型/换皮）时，强制播放本武器正确的旧音事件 |
| `forceEmitAlways` | 无条件强制发射旧音，用于验证音效是否发出 |

## 插件行为

addon 把事件覆盖成了旧音，所以**默认所有玩家听到的都是旧音**。插件只做减法：把指定武器还原成 CS2 原声。

| 状态 | 行为 |
|---|---|
| `enabled: false`（总开关） | 插件完全不干预，全部武器为旧音 |
| 武器 `enabled: true`（默认） | 插件不做任何事，原版消息照常发出，客户端播放 addon 的旧音 |
| 武器 `enabled: false` | 拦下该武器的 452 消息，先用 `EmitSound` 播 `Orig_<事件>`，**仅在 `guid != 0` 时**返回 `Handled` 屏蔽原版 |

最后一条的 `guid` 检查是防无声保证：拿不到开枪者实体、pawn 无效、或 `EmitSound` 返回 0 —— 任一情况都返回 `Continue` 保留原版音效，绝不会静默屏蔽。日志会记录 `[保留原版]`。

日志位于 `plugins/OldWeaponSounds/oldweaponsounds.log`，超过 2 MB 自动归档为 `.old`。

## 构建

### 输入

两样输入需要自备，不入库（Valve 版权）：

**`data/gsw.txt`** —— CS2 的 soundevents 全量文本（628 个事件）。取自社区转储：

```
https://raw.githubusercontent.com/Vauff/cs2_dumps/main/soundevents/game_sounds_weapons.vsndevts
```

CS2 自带的 `game_sounds_weapons.vsndevts_c` 是 old-introspected blob，`resourceinfo.exe` 无法导出为文本。

**`data/csgo_ref/wavout/**/*.wav`** —— 456 个 CS:GO 原始 wav，从 CS:GO 专用服务器的 `pak01_*.vpk` 提取（`tools/extract_wavs.py`，需在 Linux 上运行）。

### 生成链

```bash
# 1) 覆盖计划（含 KEEP_CS2_EVENTS 排除）
node tools/plan_full_cover.js
#    目标事件 462 / 唯一 wav 456

# 2) 测量素材响度
node tools/measure_loudness.js data/csgo_ref/wavout data/csgo_ref/loudness.json

# 3) 逐事件音量方案（±6 dB）
node tools/plan_volume_gains.js data/gsw.txt data/csgo_ref/csgo_events.json \
     data/csgo_ref/plan_full_cover.json data/csgo_ref/loudness.json tools/volume_gains.json

# 4) 生成 vsndevts
node tools/build_legacy_all.js data/gsw.txt data/csgo_ref/plan_full_cover.json \
     data/out/soundevents_addon.vsndevts \
     --csgo-volume data/csgo_ref/csgo_events.json \
     --wav-dir data/csgo_ref/wavout --gains tools/volume_gains.json
#    blocks 575 / override 462 / _Q 57 / orig 56 / duration_fixed 462

# 5) 校验文本
node tools/verify_new_addon.js
#    生成块 575  主覆盖 462  _Q 57  Orig_ 56
```

产物必须遵循以下结构，否则 addon 不会生效：

```
<!-- kv3 encoding:text:version{...} format:generic:version{...} -->   第 1 行 kv3 头
{                                                                    第 2 行匿名根块
	Weapon_AK47.Single = { ...CS2 全部字段..., vsnd_files_track_01 = [ "sounds/weapons_csgo/ak47/ak47_01.vsnd", ] }
	Orig_Weapon_AK47.Single = { ...CS2 原字段..., vsnd_files_track_01 = [ "sounds/weapons/ak47/ak47_02.vsnd", … ] }
}
```

字段逐字取自 CS2 的真实定义，生成器只改 `vsnd_files_track_01`、`volume`、`vsnd_duration` 三项。`distance_volume_mapping_curve`、`occlusion_intensity`、`position_offset`、`broadcast_distance_override` 等空间参数原样保留，因此方位与距离衰减与原版一致。

`vsnd_files_track_01` 的数组与标量两种写法都已支持。

### 编译

```bat
:: soundevents（-game 必须传目录，传 gameinfo.gi 会报 FATAL ERROR）
resourcecompiler.exe -i soundevents_addon.vsndevts -o . -f -nop4 -game "<CS2>\game\csgo"

:: 456 个 wav，用 -filelist 批量比逐文件快得多
resourcecompiler.exe -filelist soundevents/wavlist.txt -o . -f -nop4 -game "<CS2>\game\csgo"
```

产物落在 `game/csgo_addons/<addon名>/`（不是 `content/`，也不是 `game/csgo/`）：

| 产物 | 大小 |
|---|---|
| `soundevents/soundevents_addon.vsndevts_c` | 58,851 B |
| `sounds/weapons_csgo/**/*.vsnd_c` | 456 个 / 72.4 MB |

校验编译产物：

```bash
resourceinfo.exe -i "<...>.vsndevts_c" -all -baremode -game "<CS2>\game\csgo" > dump.txt
node tools/verify_compiled6.js dump.txt
# 主覆盖块 462/462 / Orig_ 56 / vsnd_duration 一致 462 不符 0 / _Q 57/57
```

发布前需确认 `game\csgo\gameinfo.gi` 的 `AddonConfig -> VpkDirectories` 白名单含 `sounds` 与 `soundevents`（模型包还需 `weapons`、`characters`、`agents`）。游戏更新会还原此文件，可用 `tools/fix-gameinfo-weapons.cmd` 修复。

### 发布

用 CS2 创意工坊工具（`cs2.exe -tools` → Tools → Counter-Strike 2 Workshop Manager），选中物品 → Re-Upload → **核对「加载项文件夹」下拉框** → 填写更改日志 → 提交。

下拉框默认停在**上次发布的 addon**。给模型包发布时若忘记切到 `wa`，会把 1.6 GB 的包覆盖成 76 MB 的音频包。

新版本需 Steam 审核，期间 `steamcmd` 拉到的仍是上一个已批准版本。判断是否过审：

```bash
steamcmd +login <user> +workshop_download_item 730 <ID> +quit
```

下载字节数等于本地 `vpks/<ID>/` 之和即已过审。

### 编译插件

```bash
dotnet build -c Release     # .NET SDK 10.x，目标框架 net10.0
```

`OldWeaponSounds.csproj` 通过 `<Reference>` 直接引用服务器上的 `CounterStrikeSharp.API.dll`，避免 NuGet 版本不匹配。路径不同请修改 `HintPath`。

## 目录结构

```
.
├── addon/soundevents/soundevents_addon.vsndevts   # 575 块覆盖定义（886 KB）
├── plugin/
│   ├── Plugin.cs                                  # 插件源码
│   ├── OldWeaponSounds.csproj                     # net10.0
│   ├── config.json                                # 默认配置（供首次运行生成）
│   └── compiled/                                  # 已编译产物
│       ├── OldWeaponSounds.dll
│       ├── OldWeaponSounds.deps.json
│       └── OldWeaponSounds.pdb
├── tools/
│   ├── legacy_map_full.json       # 35 把武器的 Single 映射
│   ├── volume_gains.json          # 逐事件音量方案
│   ├── plan_full_cover.js         # 1) 生成覆盖计划
│   ├── measure_loudness.js        # 2) 测量 wav 响度
│   ├── plan_volume_gains.js       # 3) 计算归一音量
│   ├── build_legacy_all.js        # 4) 生成 vsndevts
│   ├── verify_new_addon.js        # 5) 校验文本
│   ├── verify_compiled6.js        # 6) 校验编译产物
│   ├── check_duration_mismatch.js # 时长偏差体检
│   ├── parse_csgo_soundevents.js  # 解析 CS:GO 的 KV1 soundevents
│   ├── vpk_extract.js / vpk.py    # VPK 解包（Node / Python）
│   ├── _srv_install_*.sh          # 服务器端安装脚本
│   └── _srv_drop_audio.sh         # 从服务器摘除 addon（acf + 缓存）
└── docs/
    ├── 交接文档.md                       # 部署与运维记录
    ├── merged-addon-server_addon_56dz.md # 融合模型包的复现步骤
    ├── 可行性分析.md                     # 技术分析（含逐字节比对）
    ├── CS2-WeaponModelChanger-兼容交接.md
    ├── CS2-客户端ERROR模型与闪退排查.md
    ├── items_game_defindex.tsv           # def_index → weapon_name
    └── weapon_skin-音效事件映射表.tsv     # skin subclass → 音效事件
```

## 已知限制

| 限制 | 说明 |
|---|---|
| **变体数循环重复（12 个事件）** | CS:GO 的 wave 变体少于 CS2 时循环填充，例如 `Weapon_AK47.Single` 三个槽指向同一文件、`Weapon_M4A1.Single` 四个槽是两份文件重复。听感上等于没有变体。可从 CS2 自带的 `ak47_02/03/04` 借变体，属可选优化 |
| **6 个事件保留 CS2 原音** | CS:GO 变体多于 CS2 时，套用旧音只能截断并静默丢弃素材：`GalilAR.Single`(1→4)、`Glock.Single`(1→2)、`FAMAS.Single`(3→4)、`MP7.Single`(3→4)、`Sawedoff.Insertshell`(2→4)、`SCAR20.SingleDistant`(1→3)。这些事件由 `plan_full_cover.js` 的 `KEEP_CS2_EVENTS` 排除，改用 CS2 原音。不生成对应 `Orig_` 也是安全的：`EmitSound` 返回 `guid = 0` 时插件放行原版 |
| **`pitch` 沿用 CS2** | CS:GO 用百分比（`"98,101"`），CS2 用倍率（`0.9`）。239 个可比事件中仅 16 个差异超过 30 音分。改动收益低而音高变化敏感，故不处理 |
| **M4A1-S 开火音** | 走 `Weapon_M4A1.Silenced`（已覆盖）。`Weapon_M4A1S.*` 只有 `BoltBack` / `BoltForward` |
| **每玩家开关** | 当前为服务端全局开关。按玩家区分需基于 `RecipientFilter` 分流 |
| **`Orig_` 重放保真度** | 原版 452 消息可能携带 `sound_type` 等参数，`EmitSound` 无法完全复刻 |
| **换模型插件交互** | 更换 subclass 会连带更换整套 VData，包括 `m_aShootSounds`。若模型包把事件名写成错误或不存在的值（例如小写 `Weapon_scar20.Single`），会导致完全无声。插件检测到自定义 subclass 后会显式播放本武器正确的旧音；排错开关为 `forceEmitAlways` |

## 排错

**某把枪完全没声音**

1. 先查 VData 的 `m_aShootSounds`（换模型插件）。临时把 `emitForSubclass` 设为 `true` 可验证。
2. 看 `oldweaponsounds.log` 有无 `[保留原版]`。有则说明插件正确退让，问题在 addon 或 VData。
3. 事件名**大小写敏感**，`Weapon_SCAR20.Single` ≠ `Weapon_scar20.Single`，未定义即完全无声。

**改了 addon 但客户端没变化**

1. 服务端缓存目录里的文件是否为最新（看时间戳）。
2. `mm_addon_mount_download` 是否为 `1`。
3. 客户端是否清过 `steamapps/workshop/content/730/<ID>`。
4. 新版本是否仍在审核：用 `steamcmd +workshop_download_item 730 <ID>` 下载的字节数与本地 `vpks/<ID>/` 对比，相同即已过审。
5. acf 里的 `manifest` / `latest_manifest` 是否等于目标版本号。

**切枪拉栓声仍是 CS2 的**

确认 `_Q` 变体已覆盖：

```bash
grep -c "_Q" addon/soundevents/soundevents_addon.vsndevts    # 应为 57
```

快速切枪播放的是 `Weapon_XXX.BoltPull_Q`，不是主事件。

## 许可

本项目以 **GNU GPL-3.0** 发布，见 [LICENSE](LICENSE)。

仓库不附带任何 Valve 音频。456 个 wav 与 `gsw.txt` 需从自己的游戏安装中提取，其版权归 Valve 所有。本项目只做 soundevent 引用替换与开关控制，供社区服务器使用；官方匹配不加载第三方 Metamod 插件。
