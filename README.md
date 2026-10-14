# CS2-OldWeaponSounds

把 CS2 服务器的武器枪声换回 **CS:GO 旧版**：**soundevents 覆盖 addon + CounterStrikeSharp 每武器开关**。

- **35 把**武器的开火音效（`Weapon_XXX.Single`）全部覆盖为 CS:GO 旧音
- 其中 **29 把**指向 CS2 客户端**已经存在**的 CS:GO 原文件（零体积）
- **5 把**（FAMAS / Galil / Glock / Revolver / XM1014）CS2 换了音频，由 addon 自带 wav 编译（addon ≈ 3 MB）
- **AK47** 用 addon 自带的 CS:GO **第一人称**音效（`ak47_csgo_01.vsnd`）
- 每把武器都额外提供 `Orig_Weapon_XXX.Single`（内容 = CS2 原事件，逐字段相同），
  插件可以按武器把音效**单独还原成 CS2 原声**

> 原理：CS2 服务端只下发 **soundevent 名 + 参数**，音色由**客户端本地**解析。
> 因此覆盖客户端本地的 soundevent 定义（addon）是唯一能同时保证音色与 3D 定位/衰减的做法。

---

## 使用方法

### 依赖（三项，缺一不可）

| 依赖 | 作用 | 下载 |
|------|------|------|
| **Metamod:Source** | 插件加载器（CSS 的前置） | https://www.sourcemm.net/downloads.php?branch=dev |
| **CounterStrikeSharp** | 本插件的运行框架 | https://github.com/roflmuffin/CounterStrikeSharp |
| **MultiAddonManager** | **把音效资源包分发给客户端**（关键） | https://github.com/Source2ZE/MultiAddonManager |

> ⚠️ **MultiAddonManager 是必需的**：CS2 没有传统 FastDL（`sv_downloadurl` 在 CS2 中不存在），
> 客户端只能通过创意工坊获取自定义音效，而 MultiAddonManager 就负责这件事。
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

### 2) 配置 MultiAddonManager（关键一步）

编辑 `game/csgo/cfg/multiaddonmanager/multiaddonmanager.cfg`，
把**创意工坊 ID** 填入下面两项：

```cfg
mm_extra_addons         "3819498100"
mm_client_extra_addons  "3819498100"

mm_addon_mount_download 1     // 每次启动都校验/更新 addon
mm_addon_debug          1     // 排查用；稳定后可改回 0
```

**本项目的创意工坊 ID：`3819498100`**
<https://steamcommunity.com/sharedfiles/filedetails/?id=3819498100>

### 3) 重启服务器

```bash
sudo systemctl restart cs2
```

启动日志中应能看到：

```
[MultiAddonManager] Addon 3819498100 downloaded successfully
[MultiAddonManager] Adding search path: .../3819498100.vpk
```

### 4) 客户端进服

首次进入会**下载约 3.8 MB 音效包 → 被断开一次 → 自动重连** ——
这是 MultiAddonManager 的固有行为（由 `mm_extra_addons_timeout` 控制），属正常现象。

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

例：`css_oldws 7 off` → 把 AK47 还原成 CS2 原声（`7` 是 AK47 的 `item_def_index`）

### 效果预期

| 武器 | 听感 |
|------|------|
| **AK47** | 变为 CS:GO **第一人称**枪声（`ak47_01`），即自己开枪时听到的那个 |
| **FAMAS / Galil / Glock / Revolver / XM1014** | 这 5 把是 CS2 **真的换过音频**的，变化最明显 |
| 其余（AWP / M4A1 / 沙鹰 / AUG / P250 …） | CS2 本来就在用 CS:GO 那份音频，**听感不变**（正常） |

> 原理、逐字节比对、编译方式、故障排查见下文。

---

## 一、核心发现（决定了整个方案）

**CS2 客户端至今仍原样保留着大量 CS:GO 时代的武器枪声文件。**

AK47 逐字节比对：

| 来源 | 文件 | 大小 |
|------|------|------|
| CS:GO 原始 | `sound/weapons/ak47/ak47-1.wav` | 288,436 B（PCM 288,392 B） |
| CS2 现有 | `sounds/weapons/ak47/ak47-1.vsnd_c` | 289,678 B（头 1,286 B + PCM 288,392 B） |

两者 PCM **逐字节 100% 相同**。CS:GO 里 `3rd_Weapon_AK47.Single → ak47-1.wav`（听别人开枪），
`Weapon_AK47.Single → ak47_01.wav`（自己开枪）；CS2 已取消 `3rd_` 体系（数量为 0），
一个事件只能选一份文件：

- AK47 实测选第三人称 `ak47-1` 会"比 CS:GO 更脆"，因此 AK47 采用**第一人称** `ak47_csgo_01`
  （从 CS:GO 的 `weapons/ak47/ak47_01.wav` 提取后编译，随 addon 附带）。
- 全武器普查：35 把有开火音效的武器中，**30 把**的 CS:GO 原版枪声在 CS2 客户端中 PCM 逐字节保留
  （`docs/verified_map.json`），**5 把**被换掉、必须自带音频。

---

## 二、覆盖清单（全部 35 把）

每个武器生成两个事件：`Weapon_XXX.Single`（CS:GO 旧音）与 `Orig_Weapon_XXX.Single`（CS2 原音）。

| def_index | 武器 | weapon_name | 旧音来源 | `vsnd` |
|---|---|---|---|---|
| 1 | DEagle | `weapon_deagle` | CS2 已含 | `sounds/weapons/deagle/deagle_01.vsnd` |
| 2 | ELITE | `weapon_elite` | CS2 已含 | `sounds/weapons/elite/elites_01.vsnd` |
| 3 | FiveSeven | `weapon_fiveseven` | CS2 已含 | `sounds/weapons/fiveseven/fiveseven_01.vsnd` |
| 4 | Glock | `weapon_glock` | addon 自带（CS:GO 提取） | `sounds/weapons_csgo/glock18/glock_01.vsnd` |
| 7 | AK47 | `weapon_ak47` | addon 自带（**第一人称**） | `sounds/weapons/ak47/ak47_csgo_01.vsnd` |
| 8 | AUG | `weapon_aug` | CS2 已含 | `sounds/weapons/aug/aug_01.vsnd` |
| 9 | AWP | `weapon_awp` | CS2 已含 | `sounds/weapons/awp/awp_01.vsnd` |
| 10 | FAMAS | `weapon_famas` | addon 自带（CS:GO 提取） | `sounds/weapons_csgo/famas/famas_01.vsnd` |
| 11 | G3SG1 | `weapon_g3sg1` | CS2 已含 | `sounds/weapons/g3sg1/g3sg1_01.vsnd` |
| 13 | Galil | `weapon_galilar` | addon 自带（CS:GO 提取） | `sounds/weapons_csgo/galilar/galil_01.vsnd` |
| 14 | M249 | `weapon_m249` | CS2 已含 | `sounds/weapons/m249/m249-1.vsnd` |
| 16 | M4A1 | `weapon_m4a1` | CS2 已含 | `sounds/weapons/m4a1/m4a1_01.vsnd` |
| 17 | MAC10 | `weapon_mac10` | CS2 已含 | `sounds/weapons/mac10/mac10_01.vsnd` |
| 19 | P90 | `weapon_p90` | CS2 已含 | `sounds/weapons/p90/p90_01.vsnd` |
| 23 | MP5 | `weapon_mp5sd` | CS2 已含 | `sounds/weapons/mp5/mp5_01.vsnd` |
| 24 | UMP45 | `weapon_ump45` | CS2 已含 | `sounds/weapons/ump45/ump45_02.vsnd` |
| 25 | XM1014 | `weapon_xm1014` | addon 自带（CS:GO 提取） | `sounds/weapons_csgo/xm1014/xm1014-1.vsnd` |
| 26 | bizon | `weapon_bizon` | CS2 已含 | `sounds/weapons/bizon/bizon_01.vsnd` |
| 27 | Mag7 | `weapon_mag7` | CS2 已含 | `sounds/weapons/mag7/mag7_01.vsnd` |
| 28 | Negev | `weapon_negev` | CS2 已含 | `sounds/weapons/negev/negev_01.vsnd` |
| 29 | Sawedoff | `weapon_sawedoff` | CS2 已含 | `sounds/weapons/sawedoff/sawedoff-1.vsnd` |
| 30 | tec9 | `weapon_tec9` | CS2 已含 | `sounds/weapons/tec9/tec9_02.vsnd` |
| 31 | Taser | `weapon_taser` | CS2 已含 | `sounds/weapons/taser/taser_shoot.vsnd` |
| 32 | hkp2000 | `weapon_hkp2000` | CS2 已含 | `sounds/weapons/hkp2000/hkp2000_01.vsnd` |
| 33 | MP7 | `weapon_mp7` | CS2 已含 | `sounds/weapons/mp7/mp7_01.vsnd` |
| 34 | MP9 | `weapon_mp9` | CS2 已含 | `sounds/weapons/mp9/mp9_01.vsnd` |
| 35 | Nova | `weapon_nova` | CS2 已含 | `sounds/weapons/nova/nova-1.vsnd` |
| 36 | P250 | `weapon_p250` | CS2 已含 | `sounds/weapons/p250/p250_01.vsnd` |
| 38 | SCAR20 | `weapon_scar20` | CS2 已含 | `sounds/weapons/scar20/scar20_01.vsnd` |
| 39 | sg556 | `weapon_sg556` | CS2 已含 | `sounds/weapons/sg556/sg556_01.vsnd` |
| 40 | SSG08 | `weapon_ssg08` | CS2 已含 | `sounds/weapons/ssg08/ssg08_01.vsnd` |
| 61 | USP | `weapon_usp_silencer` | CS2 已含 | `sounds/weapons/usp/usp_unsilenced_01.vsnd` |
| 63 | CZ75A | `weapon_cz75a` | CS2 已含 | `sounds/weapons/cz75a/cz75_01.vsnd` |
| 64 | Revolver | `weapon_revolver` | addon 自带（CS:GO 提取） | `sounds/weapons_csgo/revolver/revolver-1_01.vsnd` |
| — | PartyHorn | `weapon_partyhorn` | CS2 已含 | `sounds/weapons/party_horn_01.vsnd` |

说明：

- **def_index 全部来自 CS2 `scripts/items/items_game.txt`**（`docs/items_game_defindex.tsv` 是解析结果）。
  注意 `weapon_m4a1`=16 在 CS2 里显示名是 **M4A4**（M4A1-S 是 60，使用 `Weapon_M4A1.Silenced`，不在本项目覆盖范围内）。
- **PartyHorn**：`items_game.txt` 里**没有**这个物品（只有 `Weapon_PartyHorn.Single` 这个事件），
  因此它**没有 item_def_index**，插件配置里用非数字 key（`partyhorn`）保证永不误匹配；
  addon 的覆盖仍然有效。
- 5 把自带音频的武器让 addon 体积从 ~10 KB 增加到 **≈ 3 MB**（编译后）。

---

## 三、目录结构

```
.
├── addon/soundevents/soundevents_addon.vsndevts   # 核心：35x2 = 70 个 soundevent 覆盖定义（162 KB）
├── plugin/
│   ├── Plugin.cs                                  # 插件源码（每武器开关）
│   ├── OldWeaponSounds.csproj                     # 工程文件（net10.0）
│   ├── config.json                                # 默认配置（随插件一起分发；首次运行会自动迁移到 configs/plugins/ 惯例位置）
│   └── compiled/                                  # 已编译产物，可直接部署
│       ├── OldWeaponSounds.dll
│       ├── OldWeaponSounds.deps.json
│       └── OldWeaponSounds.pdb
├── tools/
│   ├── legacy_map_full.json     # 35 把武器映射表（事件名 / def_index / 旧音 vsnd）★核心数据
│   ├── build_full_addon.js      # 生成 70 事件的 soundevents_addon.vsndevts
│   ├── verify_full_addon.js     # 校验生成的文本（括号/事件数/逐块 diff）
│   ├── verify_compiled_vsndevts.js # 校验**编译产物**（resourceinfo 转储）
│   ├── gen_config_full.js       # 生成插件 config.json
│   ├── verify_plugin_config.js  # 校验 config ↔ addon ↔ items_game.txt 三方一致
│   ├── extract_sources.sh       # 提取 gsw.txt 与 5 个 CS:GO 原始 wav
│   ├── build_faithful_addon.js  # 旧版（只覆盖 30 把、无 Orig_ 事件）
│   ├── vpk.py / cmp_audio.py / build_map.py / verify_map.py / match_sounds.py  # 音频比对脚本
└── docs/
    ├── verified_map.json        # 30 把"CS2 已含且 PCM 与 CS:GO 一致"的校验结果
    ├── items_game_defindex.tsv  # CS2 items_game.txt 解析出的 def_index → weapon_name
    └── 可行性分析.md            # 完整技术分析报告（含逐字节比对）
```

---

## 四、构建

### 1. 准备素材

```bash
# gsw.txt（CS2 真实 soundevent 定义，纯文本 kv3）+ 5 个 CS:GO 原始 wav
CS2="<CS2 安装目录>" CSGO_DS="<CS:GO DS 目录>" ./tools/extract_sources.sh
```

`gsw.txt` 来自社区转储（CS2 自带的 `game_sounds_weapons.vsndevts_c` 是 old-introspected blob，
`resourceinfo.exe` 无法导出文本）。5 个 wav 只在 CS:GO 里存在。

### 2. 生成覆盖文件

```bash
node tools/build_full_addon.js gsw.txt tools/legacy_map_full.json addon/soundevents/soundevents_addon.vsndevts
node tools/verify_full_addon.js addon/soundevents/soundevents_addon.vsndevts gsw.txt tools/legacy_map_full.json
```

输出结构（**必须是**这个结构，否则 addon 不生效）：

```
<!-- kv3 encoding:text:version{...} format:generic:version{...} -->   ← 第 1 行 kv3 头
{                                                                   ← 第 2 行**匿名**根块
	Weapon_AK47.Single = { ...原版全部字段..., vsnd_files_track_01 = [ "…/ak47_csgo_01.vsnd", ] }
	Orig_Weapon_AK47.Single = { ...原版全部字段..., vsnd_files_track_01 = [ "…/ak47_02.vsnd", … ] }
	…（35 把 x 2 = 70 个事件）
}
```

- 字段全部逐字取自 CS2 真实定义，**只改 `vsnd_files_track_01`**，
  `distance_volume_mapping_curve`、`occlusion_intensity`、`position_offset`、
  `broadcast_distance_override` 等 3D/衰减/遮挡字段原样保留 → 方位与距离衰减不会变。
- `vsnd_files_track_01` 的**数组**与**标量**两种写法都已兼容。
- `vsnd_duration` 由编译器按实际引用的 vsnd **自动重算**，无需手工维护。

### 3. 编译

```bat
resourcecompiler.exe -f -i "<CS2>\content\csgo_addons\oldweaponsounds\soundevents\soundevents_addon.vsndevts" -game "<CS2>\game\csgo"
resourcecompiler.exe -f -i "<CS2>\content\csgo_addons\oldweaponsounds\sounds\weapons_csgo\famas\famas_01.wav" -game "<CS2>\game\csgo"
:: …其余 4 个 wav（galilar / glock18 / revolver / xm1014）同样处理
```

> `-game` 必须传**目录**（`<CS2>\game\csgo`），传 `gameinfo.gi` 会 `FATAL ERROR`。

产物：`<CS2>\game\csgo_addons\oldweaponsounds\…`（**不是** `game\csgo\`）：

| 产物 | 大小 |
|------|------|
| `soundevents/soundevents_addon.vsndevts_c` | 10,069 B（70 个事件） |
| `sounds/weapons/ak47/ak47_csgo_01.vsnd_c` | 503,858 B |
| `sounds/weapons_csgo/famas/famas_01.vsnd_c` | 450,278 B |
| `sounds/weapons_csgo/galilar/galil_01.vsnd_c` | 558,066 B |
| `sounds/weapons_csgo/glock18/glock_01.vsnd_c` | 293,750 B |
| `sounds/weapons_csgo/revolver/revolver-1_01.vsnd_c` | 618,700 B |
| `sounds/weapons_csgo/xm1014/xm1014-1.vsnd_c` | 564,782 B |

校验编译产物：

```bash
resourceinfo.exe -i <addon>/soundevents/soundevents_addon.vsndevts_c -all -baremode -game "<CS2>\game\csgo" > dump.txt
node tools/verify_compiled_vsndevts.js dump.txt gsw.txt tools/legacy_map_full.json
```

### 4. 发布 addon

用 **CS2 创意工坊工具** 打开 addon 并 Publish（客户端必须能下载到）。
服务器侧 [MultiAddonManager](https://github.com/Source2ZE/MultiAddonManager) 配置：

```cfg
mm_extra_addons        "<workshopID>"
mm_client_extra_addons "<workshopID>"
```

⚠️ **每次改了 addon 都必须重新发布**，否则客户端拿到的还是旧版本。

---

## 五、插件：每武器开关

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

插件本体（**只有二进制**）：

```
game/csgo/addons/counterstrikesharp/plugins/OldWeaponSounds/
├── OldWeaponSounds.dll
├── OldWeaponSounds.deps.json
└── OldWeaponSounds.pdb          （可选，调试用）
```

**配置文件放在 CounterStrikeSharp 惯例位置**（与其它插件一致）：

```
game/csgo/addons/counterstrikesharp/configs/plugins/OldWeaponSounds/OldWeaponSounds.json
```

文件夹名与文件名都等于插件 `ModuleName`，与 `configs/plugins/` 下其它插件
（`RemovePlayerClipping`、`WeaponPaints` 等）保持一致。

三种情况的行为：

| 情况 | 行为 |
|------|------|
| 惯例位置已有配置 | 直接使用 |
| 惯例位置没有，但插件目录下有 `config.json`（旧版布局） | **自动迁移**到惯例位置并写日志，旧文件不再使用 |
| 两者都没有（全新安装） | 在惯例位置生成默认配置（35 把武器，全部保持 CS:GO 旧音） |

> 这样**升级插件只需替换插件目录**，不会覆盖用户已改过的配置。

前置依赖：**Metamod:Source** + **CounterStrikeSharp**。替换 dll 后 CSS 约 1 秒自动热重载。

### 命令

| 命令 | 说明 |
|------|------|
| `css_oldws status` | 总开关 / 武器条目数 / 已处理消息数 / 成功还原数 |
| `css_oldws list` | 列出所有被还原成 CS2 原声的武器 |
| `css_oldws <item_def_index> on\|off` | `on` = CS:GO 旧音（默认）、`off` = CS2 原声，并写回配置文件 |
| `css_oldws reload` | 重新读取配置文件 |

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
dotnet build -c Release   # 需要 .NET SDK（API 目标框架 net10.0）
```

`OldWeaponSounds.csproj` 通过 `<Reference>` 直接引用服务器上的 `CounterStrikeSharp.API.dll`，
避免 NuGet 版本不匹配；路径不同请改 `HintPath`。

---

## 六、验证状态与已知限制

### 已通过脚本校验（`tools/verify_*.js`）

- 生成的 `soundevents_addon.vsndevts`：kv3 头 + 匿名根块、大括号平衡、**70 个事件**，
  每块都有 `vsnd_files_track_01`；35 个旧音块与原块的差异**只**在 vsnd 上（其余逐行一致）
- **编译产物**（用 `resourceinfo.exe` 转储后校验）：70 个事件全部在册
  （含 `m_SubassetDefinitions.soundevent` 清单）、35 个旧音 vsnd 与映射表一致、
  35 个 `Orig_` vsnd 与 CS2 原事件一致、同一武器两块除 vsnd / `vsnd_duration` 外逐行一致
- 6 个自带 `.vsnd_c` 的 PCM 与 CS:GO 原始 wav **逐字节相同**
- 29 个指向 CS2 已有文件的 vsnd 路径，在 CS2 DS 的 `pak01_dir.vpk` 中全部存在
- 35 把武器的 `item_def_index` / `weapon_name` 与 CS2 `items_game.txt` 完全一致
- `config.json` 的 70 个事件名全部命中 addon，35 条映射无遗漏
- 插件 `dotnet build -c Release` 编译通过（0 错误），部署后 CSS 热重载无报错
- addon 覆盖同名 soundevent 后客户端播放旧音 —— 已实机确认（AK47）

### 仅能靠听觉确认（脚本无法覆盖）

- 29 把「CS2 已含旧文件」的武器覆盖后的**实际听感**（脚本只能证明文件与 PCM 一致）
- 5 把自带音频武器的听感（PCM 已逐字节比对，但未试听）
- AK47 改用第一人称音效后的主观效果
- `Handled` 屏蔽是否**彻底无双音**；`Orig_` 事件重放是否与 CS2 原版**完全**一致
  —— 原版 452 消息可能携带 `sound_type` 等参数，`EmitSound` 无法完全复刻
- 距离 / 遮挡 / 回声等 3D 行为（字段逐行一致，未实机比对）
- 452 的 `weapon_id` 无法当实体索引解析（实测恒为 `4276626` → 无效实体），
  实际生效的是 `weapon_fire` FIFO 关联路径，该路径尚缺实弹环境验证

### 已知限制

| 限制 | 说明 | 建议 |
|------|------|------|
| **USP（61）** | `items_game.txt` 里 `sound_single_shot` = `Weapon_USP.Single`（未消音版）；玩家装消音器时 CS2 可能改用 `Weapon_USP.SilencedShot`，该事件未被覆盖。若把 USP 设为 `enabled=false`，消音射击会重放未消音版 | 保持默认 `enabled=true` |
| 远距离音效 | 走 `Weapon_XXX.SingleDistant`（指向 `*_distant.vsnd`），未覆盖 | 结构未变，不影响使用 |
| 覆盖范围 | 不含 M4A1-S（def 60，`Weapon_M4A1.Silenced`）、刀、手雷 | 按需扩展映射表 |
| 发布整洁度 | 编译产物目录若残留旧的文本 `vsndevts`（非 `_c`），发布会一并打包（无害，客户端只读 `_c`） | 发布前删除 |
| 空服休眠 | CSS 定时器在空服时不推进 | 本插件不依赖任何定时器 |
| **换模型插件** | 换 subclass 会连带换掉整套 VData，其中包括开火音效表 `m_aShootSounds`；模型包可能把它写成错误甚至不存在的事件名（实测 AWP 皮肤写成小写 `Weapon_scar20.Single` → 完全无声） | 已兼容：插件检测到自定义 subclass 后会**显式播放本武器正确的旧音**，不再依赖 VData。排错开关 `forceEmitAlways` |

---

## 七、复现与校验命令

```bash
# 1) 生成 + 校验文本
node tools/build_full_addon.js gsw.txt tools/legacy_map_full.json addon/soundevents/soundevents_addon.vsndevts
node tools/verify_full_addon.js addon/soundevents/soundevents_addon.vsndevts gsw.txt tools/legacy_map_full.json

# 2) 校验编译产物（先 resourceinfo 转储）
resourceinfo.exe -i <addon>/soundevents/soundevents_addon.vsndevts_c -all -baremode -game "<CS2>\game\csgo" > dump.txt
node tools/verify_compiled_vsndevts.js dump.txt gsw.txt tools/legacy_map_full.json

# 3) 生成 + 校验插件配置
node tools/gen_config_full.js tools/legacy_map_full.json plugin/config.json
node tools/verify_plugin_config.js plugin/config.json addon/soundevents/soundevents_addon.vsndevts \
     docs/items_game_defindex.tsv tools/legacy_map_full.json

# 4) 音频比对脚本（Python3）
python3 tools/vpk.py list <pak01_dir.vpk> [子串过滤]
python3 tools/vpk.py extract <pak01_dir.vpk> <内部路径> <输出文件>
python3 tools/cmp_audio.py <csgo.wav> <cs2.vsnd_c>
python3 tools/verify_map.py legacy_map.json items_game.txt verified_map.json
```

---

## 八、说明与许可

- 仓库**不附带任何 Valve 音频/脚本文本**：5 个 wav 与 `gsw.txt` 需从自己的游戏安装提取
  （见 `tools/extract_sources.sh`）。
- addon 里 5 把武器的音频与 `gsw.txt` 源自 CS:GO / CS2 游戏文件，**版权归 Valve**；
  本项目只做 soundevent 引用替换与开关控制，供社区服务器使用。
- 仅供社区服务器使用；官方匹配不加载第三方 Metamod 插件。
- 本项目以 **GNU GPL-3.0** 许可发布，见 [LICENSE](LICENSE)。

---
