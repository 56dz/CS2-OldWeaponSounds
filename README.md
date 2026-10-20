# CS2-OldWeaponSounds

把 CS2 服务器的武器音效**整体换回 CS:GO 旧版** —— 不只是开火，还包括切枪、换弹、拉栓、开镜、检视等全部工艺音。

方案：**soundevents 覆盖 addon + CounterStrikeSharp 每武器开关**。

> 原理：CS2 服务端只下发 **soundevent 名 + 参数**，音色由**客户端本地**解析。
> 因此覆盖客户端本地的 soundevent 定义（addon）是唯一能同时保证音色与 3D 定位/衰减的做法。

---

## 覆盖范围（v8）

| 项目 | 覆盖内容 |
|---|---|
| 事件数 | **462** 个基础事件 + **57** 个 `_Q` 安静版变体 + **56** 个 `Orig_` 回退事件 = **575 块** |
| 音频文件 | **456** 个从 CS:GO 提取的 wav（69.9 MB，编译后 72.4 MB），全部**逐字节原创**，不依赖 CS2 客户端现有文件 |
| 武器 | 35 把枪 + 刀 + 手雷 + C4 + 掉落/命中/跳弹等环境音 |
| 工艺音后缀 | `Single` `SingleDistant` `SilencedShot` `Draw` `Deploy` `Clipin` `Clipout` `ClipHit` `Slideback` `Sliderelease` `BoltBack` `BoltForward` `BoltPull` `Boltrelease` `Insertshell` `Pump` `PumpBack` `PumpForward` `WeaponMove1/2/3` `Zoom` `ZoomIn` `ZoomOut` `Throw` `Bounce` `IdleLoop` `TauntLook*` `LookAt*` `SilencerScrew*` … |

三件事让「听起来就是 CS:GO」而不只是「换了文件」：

1. **`vsnd_duration` 按真实 wav 长度重写**。该字段描述的是音频长度，引擎按它回收声音实例；照抄 CS2 的声明会让 CS:GO 素材被截断（`M4A1.Clipin` 声明 0.0998s、实际 0.416s，被截掉 3/4）或虚长拖尾（`AK47.Clipout` 声明 0.727s、实际 0.189s）。462 个事件全部对齐。
2. **音量按素材实测 RMS 逐事件归一**。CS2 的音量是配它自己重编码的素材调的，套到 CS:GO 素材上会让同类音效忽大忽小（`Draw` 组极差 20.2 dB、`Clipin` 组 20.2 dB）。改为保持每个后缀的平均有效响度不变、只搬 CS:GO 内部的相对比例，单事件相对 CS2 封顶 ±6 dB。实测离散度：`Draw` sd 4.63→1.27、`Clipin` 5.27→1.45、`Clipout` 3.96→1.40、`BoltBack` 3.07→0.66。
3. **补上 57 个 `_Q` 安静版事件**。引擎在**快速切枪/快速换弹**时播的是 `Weapon_XXX.BoltPull_Q` 这类变体，而不是主事件。不覆盖它们，主事件换成了旧音、但一快速切枪还是 CS2 新录音 —— 这正是「切枪拉栓声听着还是 CS2」的真正原因。

另外**剔除了 7 个 CS2 独有的叠层子事件**（`Weapon_Glock.Element_CRB` / `Element_Click`、`Weapon_M249.Jangle`、`Weapon_FAMAS.Mech`、`Weapon_Taser.Charging`、`SmokeGrenade.Bounce_Can`、`IncGrenade.Bounce_M`）。CS:GO 完全没有这些层，不删掉会和旧音叠在一起（表现为「格洛克开火音有杂音」）。

---

## 使用方法

### 依赖（三项，缺一不可）

| 依赖 | 作用 | 下载 |
|------|------|------|
| **Metamod:Source** | 插件加载器（CSS 的前置） | https://www.sourcemm.net/downloads.php?branch=dev |
| **CounterStrikeSharp** | 本插件的运行框架 | https://github.com/roflmuffin/CounterStrikeSharp |
| **MultiAddonManager** | **把资源包分发给客户端**（关键） | https://github.com/Source2ZE/MultiAddonManager |

> ⚠️ **MultiAddonManager 是必需的**：CS2 没有传统 FastDL（`sv_downloadurl` 在 CS2 中不存在），
> 客户端只能通过创意工坊获取自定义资源。
>
> ⚠️ Linux 服务器请下载 **`steamrt3`** 构建 —— `-steamrt4` 需要 glibc 2.38，
> 而 Debian 12 只有 2.36，会直接加载失败。

### 1) 安装插件

下载 [Releases](../../releases) 里的 zip，解压到服务器的 **`game/csgo/`** 目录（合并覆盖）：

```
game/csgo/addons/counterstrikesharp/plugins/OldWeaponSounds/
├── OldWeaponSounds.dll
└── OldWeaponSounds.deps.json
```

### 2) 配置 MultiAddonManager

编辑 `game/csgo/cfg/multiaddonmanager/multiaddonmanager.cfg`：

```cfg
mm_extra_addons         "<创意工坊ID>"
mm_client_extra_addons  "<创意工坊ID>"

mm_addon_mount_download 1     // 每次启动都校验/更新 addon
mm_addon_debug          1     // 排查用；稳定后可改回 0
```

本项目提供两个创意工坊物品，**同一套音效内容**，按需选一个（**不要同时挂**，见下方警告）：

| 物品 | 内容 | 适用 |
|---|---|---|
| **`3819498100`** | 纯音频包（72.8 MB）<br><https://steamcommunity.com/sharedfiles/filedetails/?id=3819498100> | 已有自己模型包的服务器 |
| **`3819972417`** | 模型包 + 音效（1.62 GB）<br><https://steamcommunity.com/sharedfiles/filedetails/?id=3819972417> | 同时需要武器模型包 |

> ⚠️ **两个包不能同时挂**。它们提供相同的资源路径（`soundevents/soundevents_addon.vsndevts_c`、
> `sounds/weapons_csgo/*.vsnd`），引擎按加载顺序取其中一个，会出现「改了却没生效」的假象。

### 3) 重启服务器

```bash
sudo systemctl restart cs2
```

### 4) 客户端进服

首次进入会下载音效包（约 73 MB）→ 可能被断开一次 → 自动重连。
这是 MultiAddonManager 的固有行为（`mm_extra_addons_timeout` 控制），属正常现象。

### 5) 配置与命令

插件配置**首次运行会自动生成**，无需手动创建（含全部 35 把武器）：

```
game/csgo/addons/counterstrikesharp/configs/plugins/OldWeaponSounds/OldWeaponSounds.json
```

| 命令 | 说明 |
|------|------|
| `css_oldws status` | 查看总开关 / 武器条目数 / 已处理消息数 / 成功还原数 |
| `css_oldws list` | 列出所有被还原成 CS2 原声的武器 |
| `css_oldws <item_def_index> on\|off` | 单独开关某把武器（`off` = 还原 CS2 原声），并写回配置 |
| `css_oldws reload` | 重新读取配置文件 |
| `css_oldws test [事件名或vsnd路径]` | **排查用**：在自己身上直接发射一个声音，看 `guid`。`guid=0` = 服务端没解析出来（事件名/路径有问题）；`guid≠0` = 已发出，请听结果。不带参数默认发 `Weapon_AK47.Single` |

例：`css_oldws 7 off` → 把 AK47 还原成 CS2 原声（`7` 是 AK47 的 `item_def_index`）

配置里另有两个排查开关（默认 `false`，正常使用不需要动）：

| 字段 | 作用 |
|------|------|
| `emitForSubclass` | 检测到玩家用了自定义 subclass（换模型/换皮）时，强制播放本武器正确的旧音事件 |
| `forceEmitAlways` | 无条件强制发射旧音（不管 subclass），用于验证"音效到底有没有发出去" |

---

## 一、核心结论（决定了整个方案）

**CS2 客户端至今仍保留着大量 CS:GO 时代的武器音效文件，但「同名同路径」不等于「同一份录音」。**

两个独立的坑：

1. **工艺音早就被重录过**。用 PCM 归一化互相关（NCC）比对同名文件：`ak47_draw.vsnd_c` vs
   CS:GO 的 `ak47_draw.wav` NCC = **0.020**、`ak47_boltpull_01.vsnd_c` vs `ak47_boltpull.wav`
   NCC = **0.045** —— 完全不相关，是不同录音。用户的原话（`csgo的音效更厚重，而cs2更清脆`）
   与这个数字一致。
2. **CS2 把工艺音系统性地「压平」了**。很多武器共用通用占位音：`AK47.Clipin`、`DEagle.Clipin`、
   `GalilAR.Clipin` 全都指向 `magazine_slide_01.vsnd`；`sg556.ZoomIn` 用的是 AUG 的
   `aug_zoom_in.vsnd`；`FX_RicochetSound` 用 `bullet_ric_01..06`（CS:GO 用 `ric3/4/5`）。

结论：**不能靠「CS2 里路径相同就跳过」的假设**。v8 因此改为**全部 456 个 wav 由 addon 自带**，
彻底不依赖 CS2 客户端里的任何一份音频。

这些音频放在**私有命名空间** `sounds/weapons_csgo/`，而不是覆盖 `sounds/weapons/`。
理由：覆盖原版路径会让 `Orig_` 回退块也指向被换掉的旧音，插件「按武器还原 CS2 原声」的功能就废了。

> 曾经的历史：v1~v4 只覆盖 `.Single`（35 把开火音），v5 扩到全量但沿用 CS2 音量，
> v7 补 `_Q` 变体，v8 定型。详见 `docs/交接文档.md` 的 §7 各小节。

---

## 二、为什么不直接用 `_Q` 之外的旧事件名

`Orig_Weapon_XXX.Single` 这类回退事件的**内容**是 CS2 原事件（只改名字，`vsnd` 指向
`sounds/weapons/...` 原版文件），供插件按武器还原原声。

生成时有个容易漏的地方：`soundevent_N` 子事件引用有两种写法 ——

```
soundevent_01 = "Weapon_AK47.SingleDistant"          ← 标量
soundevent_01 =                                       ← 数组（`=` 后面换行）
[
	"Weapon_Glock.SingleDistant",
	"Weapon_Glock.Element_CRB",
]
```

只写正则 `/soundevent_(\d+)\s*=\s*"([^"]+)"/g` 会漏掉数组形式（`Weapon_Glock.Single` 就是这种），
导致回退块里的子事件没改名。`build_legacy_all.js` 的 `mapChildren()` 两种都处理。

---

## 三、故意不覆盖的部分

| 项 | 原因 |
|---|---|
| **6 个变体数不兼容的事件** | CS:GO 的 wave 变体多于 CS2 时，套旧音只能截断、静默丢素材：`GalilAR.Single`(1→4)、`Glock.Single`(1→2)、`FAMAS.Single`(3→4)、`MP7.Single`(3→4)、`Sawedoff.Insertshell`(2→4)、`SCAR20.SingleDistant`(1→3)。**改用 CS2 原音**（`plan_full_cover.js` 的 `KEEP_CS2_EVENTS`）。不生成 `Orig_` 也安全：`EmitSound` 返回 guid=0 时插件放行原版，不会无声 |
| **12 个循环重复变体的事件** | CS:GO 变体少于 CS2 时循环填充（`AK47.Single` 三个槽是同一个文件）。**保留**：不丢素材，拆成单变体会让响度/时长归一失真 |
| **`pitch`** | CS:GO 是百分比（`"98,101"`）、CS2 是倍率（`0.9`）。239 个可比事件里只有 16 个差异 >30 音分。改动收益低、音高变化很扎耳，**故意不动** |
| **M4A1-S 开火音** | 走 `Weapon_M4A1.Silenced`（在覆盖范围内）；`Weapon_M4A1S.*` 只有 `BoltBack/BoltForward` |
| **CS2 独有的 `_Q` 事件** | 60 个 `_Q` 里 57 个的主事件在覆盖范围内，已全部覆盖；剩 3 个（`Weapon_CZ.*`）对应武器在 CS2 已废弃 |

---

## 四、目录结构

```
.
├── addon/soundevents/soundevents_addon.vsndevts   # 575 块覆盖定义（886 KB，v8）
├── plugin/
│   ├── Plugin.cs                                  # 插件源码（566 行，v2.0.0）
│   ├── OldWeaponSounds.csproj                     # 工程文件（net10.0）
│   ├── config.json                                # 默认配置（首次运行自动在 configs/plugins/ 生成）
│   └── compiled/                                  # 已编译产物，可直接部署
│       ├── OldWeaponSounds.dll
│       ├── OldWeaponSounds.deps.json
│       └── OldWeaponSounds.pdb
├── tools/
│   ├── legacy_map_full.json       # 35 把武器的 Single 映射（事件名 / def_index / 旧音）
│   ├── volume_gains.json          # 逐事件音量方案（270 条 events + 152 个后缀兜底 gain）
│   ├── plan_full_cover.js         # ① 生成覆盖计划（含 KEEP_CS2_EVENTS 排除）
│   ├── measure_loudness.js        # ② 测所有 wav 的 RMS/峰值/时长
│   ├── plan_volume_gains.js       # ③ 逐事件算归一音量
│   ├── build_legacy_all.js        # ④ 生成 vsndevts（核心，600+ 行）
│   ├── verify_new_addon.js        # ⑤ 校验生成的文本
│   ├── verify_compiled6.js        # ⑥ 校验**编译产物**（resourceinfo 转储）
│   ├── check_duration_mismatch.js # 时长偏差体检
│   ├── parse_csgo_soundevents.js  # 解析 CS:GO 的 KV1 soundevents 文本
│   ├── vpk_extract.js / vpk.py    # VPK 解包（Node / Python 各一份）
│   ├── _srv_install_audio8.sh     # 服务器端安装音频包（steamcmd 下载 → 缓存 + acf）
│   ├── _srv_install_wa2.sh        # 服务器端安装模型包
│   ├── _srv_drop_audio.sh         # 从服务器摘除某个 addon（acf + 缓存目录）
│   └── …（音频比对、VData 构建等约 40 个工具）
└── docs/
    ├── 交接文档.md                # ★ 完整交接（服务器信息 / 架构 / 生成链 / 踩坑清单）
    ├── merged-addon-server_addon_56dz.md  # 融合模型包的复现步骤
    ├── 可行性分析.md               # 早期技术分析（含逐字节比对）
    └── items_game_defindex.tsv     # def_index → weapon_name
```

---

## 五、构建

### 1) 准备素材

需要两样输入，都**不入库**（Valve 版权）：

- `data/gsw.txt` —— CS2 的 soundevents 全量文本（628 个事件）。来源：社区转储
  `https://raw.githubusercontent.com/Vauff/cs2_dumps/main/soundevents/game_sounds_weapons.vsndevts`
  （CS2 自带的 `game_sounds_weapons.vsndevts_c` 是 old-introspected blob，`resourceinfo.exe` 导不出文本）
- `data/csgo_ref/wavout/**/*.wav` —— 456 个 CS:GO 原始 wav，从 CS:GO DS 的 `pak01_*.vpk` 提取
  （`tools/extract_wavs.py`，在服务器上跑）

### 2) 生成（v8 完整链路）

```bash
# ① 覆盖计划（含 keep_cs2 排除 6 个变体不兼容事件）
node tools/plan_full_cover.js
#    期望：目标事件 462 / 唯一 wav 456 / 跳过 刻意保留CS2音(6)

# ② 测量素材响度
node tools/measure_loudness.js data/csgo_ref/wavout data/csgo_ref/loudness.json
#    期望：files 456  measurable ~453

# ③ 逐事件音量方案（cap ±6dB）
node tools/plan_volume_gains.js data/gsw.txt data/csgo_ref/csgo_events.json \
     data/csgo_ref/plan_full_cover.json data/csgo_ref/loudness.json tools/volume_gains.json

# ④ 生成 vsndevts
node tools/build_legacy_all.js data/gsw.txt data/csgo_ref/plan_full_cover.json \
     data/out/soundevents_addon.vsndevts \
     --csgo-volume data/csgo_ref/csgo_events.json \
     --wav-dir data/csgo_ref/wavout --gains tools/volume_gains.json
#    期望：blocks 575 / override 462 / _Q 57 / orig 56 / child_dropped 7 / duration_fixed 462

# ⑤ 校验文本
node tools/verify_new_addon.js
#    期望：生成块 575  主覆盖 462  _Q 57  Orig_ 56  ✅ 全部自检通过
```

输出结构（**必须是**这个结构，否则 addon 不生效）：

```
<!-- kv3 encoding:text:version{...} format:generic:version{...} -->   ← 第 1 行 kv3 头
{                                                                   ← 第 2 行**匿名**根块
	Weapon_AK47.Single = { ...原版全部字段..., vsnd_files_track_01 = [ "sounds/weapons_csgo/ak47/ak47_01.vsnd", ] }
	Orig_Weapon_AK47.Single = { ...CS2 原字段..., vsnd_files_track_01 = [ "sounds/weapons/ak47/ak47_02.vsnd", … ] }
	…
}
```

- 字段全部逐字取自 CS2 真实定义，**只改 `vsnd_files_track_01` / `volume` / `vsnd_duration`**，
  `distance_volume_mapping_curve`、`occlusion_intensity`、`position_offset`、
  `broadcast_distance_override` 等 3D/衰减/遮挡字段原样保留 → 方位与距离衰减不会变。
- `vsnd_files_track_01` 的**数组**与**标量**两种写法都已兼容。

### 3) 编译

```bat
:: 1) soundevents（-game 必须传目录，传 gameinfo.gi 会 FATAL ERROR）
resourcecompiler.exe -i soundevents_addon.vsndevts -o . -f -nop4 -game "<CS2>\game\csgo"

:: 2) 456 个 wav（用 -filelist 批量，比逐文件快得多）
resourcecompiler.exe -filelist soundevents/wavlist.txt -o . -f -nop4 -game "<CS2>\game\csgo"
```

产物落在 **`game/csgo_addons/<addon名>/`**，不是 `content/` 也不是 `game/csgo/`：

| 产物 | 大小 |
|------|------|
| `soundevents/soundevents_addon.vsndevts_c` | 58,851 B（462+57+56 = 575 块） |
| `sounds/weapons_csgo/**/*.vsnd_c` | 456 个 / 72.4 MB |

校验编译产物：

```bash
resourceinfo.exe -i "<...>.vsndevts_c" -all -baremode -game "<CS2>\game\csgo" > dump.txt
node tools/verify_compiled6.js dump.txt
# 期望：主覆盖块 462/462 / Orig_ 56 / vsnd_duration 一致 462 不符 0 / _Q 57/57 通过
```

> ⚠️ 发布前必须确认 `game\csgo\gameinfo.gi` 的 `AddonConfig -> VpkDirectories` 白名单含
> `sounds` / `soundevents`（模型包还需 `weapons` / `characters` / `agents`）。
> 游戏更新会还原这个文件，改回去跑 `tools/fix-gameinfo-weapons.cmd`。

### 4) 发布 addon

用 **CS2 创意工坊工具**（`cs2.exe -tools` → Tools → Counter-Strike 2 Workshop Manager）
选中物品 → Re-Upload → **核对「加载项文件夹」下拉框** → 填更改日志 → 提交。

> ⚠️ 下拉框默认停在**上次发布的 addon**。给模型包发布时忘了切到 `wa`，会把 1.6 GB 的包
> 覆盖成 76 MB 的音频包。

新版本需要 Steam 审核（人工，几小时）。审核期间 `steamcmd` 拉到的仍是上一个已批准版本。
查是否过审：

```bash
steamcmd +login <user> +workshop_download_item 730 <ID> +quit
# 下到的字节数 == 本地 vpks/<ID>/ 总和 ⇒ 已过审
```

---

## 六、插件：每武器开关

### 语义（关键）

addon 把 `Weapon_XXX.Single` 覆盖成 CS:GO 旧音，所以 **默认所有玩家听到的都是 CS:GO 旧音**。
插件只做一件事：**把指定武器还原成 CS2 原声**。

| 配置 | 行为 |
|------|------|
| `enabled: false`（总开关） | 插件完全不干预 → 全部武器 = CS:GO 旧音 |
| 武器 `enabled: true`（默认） | 插件**什么都不做**，原版开火音效消息照常发出 → 客户端播 addon 的旧音 |
| 武器 `enabled: false` | 插件拦下该武器的 452 消息，**先**用 `EmitSound` 播放 `Orig_Weapon_XXX.Single`，**只有 guid != 0** 才返回 `Handled` 屏蔽原版 → 还原成 CS2 原声 |

`Orig_` 事件的字段与 CS2 原事件**逐字段相同**（只改事件名、不改 `vsnd_files_track_01`），
所以"还原"后的音色/衰减就是 CS2 原版。

**防无声保证**：定位不到开枪者、pawn 无效、`EmitSound` 返回 guid=0 —— 任何一种情况都
**返回 `Continue` 保留原版音效**，绝不屏蔽。日志里会写明 `[保留原版]`。

### 部署

```
game/csgo/addons/counterstrikesharp/plugins/OldWeaponSounds/
├── OldWeaponSounds.dll
├── OldWeaponSounds.deps.json
└── OldWeaponSounds.pdb          （可选，调试用）
```

**配置文件放在 CounterStrikeSharp 惯例位置**：

```
game/csgo/addons/counterstrikesharp/configs/plugins/OldWeaponSounds/OldWeaponSounds.json
```

| 情况 | 行为 |
|------|------|
| 惯例位置已有配置 | 直接使用 |
| 惯例位置没有，但插件目录下有 `config.json`（旧版布局） | **自动迁移**到惯例位置并写日志 |
| 两者都没有（全新安装） | 在惯例位置生成默认配置（35 把武器，全部保持 CS:GO 旧音） |

> 这样**升级插件只需替换插件目录**，不会覆盖用户已改过的配置。

### 配置（`OldWeaponSounds.json`）

```jsonc
{
  "enabled": true,          // 插件总开关
  "debug": true,            // 诊断日志
  "weapons": {
    "7": {                  // item_def_index
      "name": "AK47",
      "weapon_name": "weapon_ak47",
      "item_def_index": 7,
      "legacy_event": "Weapon_AK47.Single",        // addon 覆盖后的 CS:GO 旧音
      "orig_event": "Orig_Weapon_AK47.Single",     // 内容 = CS2 原事件
      "enabled": true                              // true=旧音, false=CS2 原声
    }
    // …共 35 把（含 partyhorn 的非数字 key）
  }
}
```

日志：`plugins/OldWeaponSounds/oldweaponsounds.log`（超过 2 MB 自动归档为 `.old`）

### 自行编译插件

```bash
dotnet build -c Release   # .NET SDK 10.x（API 目标框架 net10.0）
```

`OldWeaponSounds.csproj` 通过 `<Reference>` 直接引用服务器上的 `CounterStrikeSharp.API.dll`，
避免 NuGet 版本不匹配；路径不同请改 `HintPath`。

---

## 七、验证状态与已知限制

### 已通过脚本校验

- 生成的 `soundevents_addon.vsndevts`：kv3 头 + 匿名根块、大括号平衡、**575 块**，
  每块都有 `vsnd_files_track_01`；462 个主覆盖块相对 CS2 原块的差异只在 `vsnd` / `volume` / `vsnd_duration`
- **编译产物**（`resourceinfo.exe` 转储后校验）：462 个主覆盖块全部在册且路径都在 `sounds/weapons_csgo/`、
  56 个 `Orig_` 块指向原版路径、**462 个 `vsnd_duration` 与 wav 实测长度全部一致（不符 0）**、57 个 `_Q` 块全部通过
- 单事件音量相对 CS2 变化全部 ≤ ±6.5 dB；同后缀有效响度标准差全部不劣于 CS2
- 6 个 `KEEP_CS2_EVENTS` 事件确认未出现在主覆盖与 `Orig_` 两侧
- 从客户端实际加载的 vpk 里解出打包的 vsnd_c，用 CS:GO 原始 wav 的 PCM 做探针：
  AK47 的 `draw / clipin / clipout / boltpull` 全部 **3/3 命中** → 素材层面确实是 CS:GO 原始字节
- 插件 `dotnet build -c Release` 编译通过（0 错误），部署后 CSS 热重载无报错
- **实机确认**：4 个历史问题（USP 切枪 / a1·a4 切枪忽大忽小 / 格洛克开火音 / AK 切枪不完整）已修复

### 已知限制

| 限制 | 说明 | 建议 |
|------|------|------|
| **变体数循环重复（12 个）** | CS:GO 变体少于 CS2 时循环填充：`AK47.Single` 三个槽是同一个文件、`M4A1.Single` 4 个槽是 2 个文件重复。听感上等于没有变体 | 可从 CS2 自带的 `ak47_02/03/04` 借变体，属可选优化 |
| **`pitch` 沿用 CS2** | 16 个事件差异 >30 音分（最大 `Mag7.PumpBack` +702 音分） | 改动收益低、风险高，故意不动 |
| **每玩家开关** | 目前是**全局**开关（服务端范围） | 做每玩家需按 `RecipientFilter` 分流 |
| **`Orig_` 重放保真度** | 原版 452 消息可能带 `sound_type` 等参数，`EmitSound` 无法完全复刻 | 实机未听出差异 |
| **USP 消音射击** | `Weapon_USP.SilencedShot` 在覆盖范围内；但插件还原逻辑走 `Single` 系列 | 保持默认 `enabled=true` |
| **服务器偶发「溢出错误」踢人** | 与音效包无关：hibernating 唤醒 + `Warmup_Start` + 换模型插件载皮肤 + 封禁检查同帧 → 主线程 823~2149ms 长帧 → netchan 判 CPU 超预算踢人 | 重启可清；根治要查换模型插件的进场开销 |
| **换模型插件兼容** | 换 subclass 会连带换掉整套 VData，包括 `m_aShootSounds`；模型包可能把它写成错误甚至不存在的事件名（实测 AWP 皮肤写成小写 `Weapon_scar20.Single` → 完全无声） | 已兼容：插件检测到自定义 subclass 后会显式播放本武器正确的旧音。排错开关 `forceEmitAlways` |

---

## 八、排错

**"某把枪完全没声音"**
1. 优先怀疑 VData 的 `m_aShootSounds`（换模型插件）；临时把 `emitForSubclass` 设 `true` 验证
2. 看 `oldweaponsounds.log` 有没有 `[保留原版]`（有 = 插件正确退让，问题在 addon/VData）
3. 事件名**大小写敏感**，`Weapon_SCAR20.Single` ≠ `Weapon_scar20.Single`，
   未定义 → 完全无声

**"改了 addon 但客户端没变化"**

1. 服务端缓存目录里的文件是不是新的（`stat` 看时间戳）
2. `mm_addon_mount_download 1` 有没有开
3. 客户端是否清过 `steamapps/workshop/content/730/<ID>`
4. **新版是否还在审核**：`steamcmd +workshop_download_item 730 <ID>` 的字节数与本地
   `vpks/<ID>/` 对比。一样 = 已过审；还是旧尺寸 = 审核中
5. acf 里的 `manifest` / `latest_manifest` 是否等于实际要用的版本号

**"切枪拉栓声还是 CS2 的"**

先确认 `_Q` 变体是否覆盖了：`grep "_Q" addon/soundevents/soundevents_addon.vsndevts | wc -l`
应为 57。快速切枪播的是 `Weapon_XXX.BoltPull_Q` 而不是主事件。

---

## 九、说明与许可

- 仓库**不附带任何 Valve 音频**：456 个 wav 与 `gsw.txt` 需从自己的游戏安装提取。
- addon 里的音频与 `gsw.txt` 源自 CS:GO / CS2 游戏文件，**版权归 Valve**；
  本项目只做 soundevent 引用替换与开关控制，供社区服务器使用。
- 仅供社区服务器使用；官方匹配不加载第三方 Metamod 插件。
- 本项目以 **GNU GPL-3.0** 许可发布，见 [LICENSE](LICENSE)。
