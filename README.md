# CS2-OldWeaponSounds

还原 CS:GO 旧版武器枪声的 CS2 服务端方案：**CounterStrikeSharp 插件 + soundevents 覆盖 addon**。

> 覆盖 29 把武器（AK47、AWP、M4A1、沙鹰、AUG、P250、SSG08、MP9、MAC10、UMP45、Nova、Negev、M249、SG556、Tec9、五七、Galil…）
> **addon 不含任何音频文件**，体积极小、下载极快。

---

## 一、核心发现（决定了整个方案）

**CS2 客户端至今仍原样保留着 CS:GO 时代的武器枪声文件。**

逐字节比对 AK47 的结果：

| 来源 | 文件 | 大小 |
|------|------|------|
| CS:GO 原始 | `sound/weapons/ak47/ak47-1.wav` | 288,436 B（PCM 数据 288,392 B） |
| CS2 现有 | `sounds/weapons/ak47/ak47-1.vsnd_c` | 289,678 B（头部 1,286 B + PCM 288,392 B） |

**CS2 里那份的 PCM 与 CS:GO 原始 WAV 逐字节 100% 相同**（相同字节数 `288392 / 288392`）。

翻 CS:GO 的 `scripts/game_sounds_weapons.txt` 可以确认 `ak47-1` 的身份：

```json
"Weapon_AK47.Single"      → "wave" "weapons/ak47/ak47_01.wav"   // 自己开枪听到的
"3rd_Weapon_AK47.Single"  → "wave" "weapons/ak47/ak47-1.wav"    // 听到"别人"开枪的
```

也就是说 `ak47-1` 正是 **CS:GO 里别人开枪时你听到的经典 AK 枪声**，而 CS2 完整保留了它。
（CS2 反而把 `ak47_01` 换成了新录音 —— 已验证 CS2 的 `ak47_01.vsnd_c` 中**找不到** CS:GO 的 PCM。）

### 全武器普查

自动比对 CS:GO 全部 590 个武器音频 vs CS2 的 1237 个：

- **35 把有开火音效的武器中，30 把的 CS:GO 原版枪声在 CS2 客户端中 PCM 逐字节保留**
- 被 CS2 换掉、需要自行编译音频的 5 把：`FAMAS`、`Galil`、`Glock`、`Revolver`、`XM1014`

> 因此 **无需从 CS:GO 提取音频、无需 wav→vsnd 编译**，只要让客户端去播它硬盘上已有的旧文件即可。

---

## 二、实现方式

### 音效链路（为什么必须用 addon）

CS2 服务端只下发 **soundevent 名称的哈希 + 参数**，**音色定义由客户端本地解析**。所以：

- 服务端插件**无法**单方面改变客户端播放的音色；
- 插件用 `EmitSound()` 直接播 `.vsnd` **路径**虽然能响，但社区实测**会丢失 3D 定位与距离衰减**（[cs2-quake-sounds](https://github.com/Kandru/cs2-quake-sounds) README：直接文件路径 "play at full volume and are not positional"）。枪声没有方位感实战体验会崩。

所以正确做法是**覆盖客户端本地的 soundevent 定义**，保留原有的 3D/衰减配置，只把 `vsnd_files_track_01` 指向已存在的旧 `.vsnd`：

```
<addon>/soundevents/soundevents_addon.vsndevts     ← 文件名与位置都不可改，否则不 precache
```

Valve 官方文档（CS2 Workshop Tools / Addon Sounds）明确：
> *"To override existing soundevents, that is all that is required."*

### 插件的作用与安全设计

插件本身**不是**音色的来源（音色由 addon 决定），它负责：开关控制、诊断、以及"不用 addon 时的降级方案"。

`replaceMode` 三种模式：

| 模式 | 行为 | 适用 |
|------|------|------|
| `none` | 只写日志诊断，**不改变任何音效** | 默认值，绝对安全 |
| `soundevent` | 播放 soundevent（配合 addon，**方位/衰减正确**） | **推荐** |
| `vsnd` | 直接播 `.vsnd` 文件路径 | 不想用 addon 时可用，但可能丢 3D 定位 |

**防呆设计：先发射新音效、拿到有效 guid 后才屏蔽原版**（返回 `HookResult.Handled`）。
任何一步失败都**保留原版音效**，因此**不会出现"无声枪"**。

---

## 三、目录结构

```
.
├── addon/soundevents/soundevents_addon.vsndevts   # 核心：29 武器的 soundevent 覆盖定义
├── plugin/
│   ├── Plugin.cs                                  # 插件源码
│   ├── OldWeaponSounds.csproj                     # 工程文件（net10.0）
│   ├── config.json                                # 武器映射配置（默认关闭）
│   └── compiled/                                  # 已编译产物，可直接部署
│       ├── OldWeaponSounds.dll
│       ├── OldWeaponSounds.deps.json
│       └── OldWeaponSounds.pdb
├── tools/                                         # 可复现的全套分析脚本（Python3）
│   ├── vpk.py            # Source 1/2 通用 VPK 解析与提取
│   ├── cmp_audio.py      # 比对 .wav 与 .vsnd_c 的 PCM 是否一致
│   ├── build_map.py      # 从 CS:GO 音效脚本生成映射
│   ├── verify_map.py     # 逐项校验 PCM 一致性并生成带 def_index 的表
│   ├── gen_addon.py      # 生成 soundevents_addon.vsndevts
│   ├── gen_config.py     # 生成插件 config.json
│   └── match_sounds.py   # CS:GO / CS2 音频清单比对
└── docs/
    ├── verified_map.json        # 30 把武器的校验结果（含 PCM 一致性）
    └── 可行性分析.md            # 完整技术调研报告（含大量一手取证）
```

---

## 四、使用方法

### 第 1 步：编译并发布 addon（主路线，决定成败）

需要 **CS2 创意工坊工具**（`resourcecompiler.exe` 位于
`<CS2>/game/bin/win64/`，随工具安装）。

1. 打开 **CS2 创意工坊工具**，用 `addon_template` 新建 addon（例如 `oldweaponsounds`）
2. 把 `addon/soundevents/soundevents_addon.vsndevts` 放到该 addon 的
   **`soundevents/soundevents_addon.vsndevts`**（名字与目录必须完全一致）
3. 也可手动编译验证：
   ```bat
   resourcecompiler.exe -i "<addon>\soundevents\soundevents_addon.vsndevts" ^
                        -game "<CS2>\game\csgo\gameinfo.gi"
   ```
4. 用 **Workshop Item Editor** 发布为**公开**物品（客户端必须能下载到）
5. 服务器启用 [MultiAddonManager](https://github.com/Source2ZE/MultiAddonManager)，
   在 `game/csgo/cfg/multiaddonmanager/multiaddonmanager.cfg` 填入 Workshop ID：
   ```cfg
   mm_extra_addons <你的workshopID>
   ```
6. 客户端首次进服会因下载 addon **被断开并自动重连一次**（该机制的固有行为）

> **想覆盖被 CS2 换掉的那 5 把**（FAMAS/Galil/Glock/Revolver/XM1014）：
> 额外把 CS:GO 的 `.wav` 放进 addon 的 `sounds/` 目录让工具链编译成 `.vsnd`，
> 再在 vsndevts 里指向它们。源 WAV 可用 `tools/vpk.py` 从 CS:GO DS 的 `pak01_dir.vpk` 提取。

### 第 2 步：部署插件（可选）

把 `plugin/compiled/` 下的文件放到：

```
game/csgo/addons/counterstrikesharp/plugins/OldWeaponSounds/
├── OldWeaponSounds.dll
├── OldWeaponSounds.deps.json
└── config.json
```

前置依赖：**Metamod:Source** + **CounterStrikeSharp**。

**命令**（控制台或游戏内聊天）：

| 命令 | 说明 |
|------|------|
| `css_oldws status` | 查看当前状态 |
| `css_oldws 1` / `0` | 启用 / 停用替换 |
| `css_oldws reload` | 重载 `config.json` |

**配置**（`config.json`）：

```jsonc
{
  "enabled": false,          // 总开关，默认 false（纯诊断，不改音效）
  "replaceMode": "none",     // none | soundevent(推荐) | vsnd
  "suppressVanilla": true,   // 替换成功后屏蔽原版，避免双重音
  "debug": true,             // 诊断日志
  "weapons": {
    "7": {                   // item_def_index，7 = AK47
      "name": "AK47",
      "weapon_name": "weapon_ak47",
      "vsnd": "sounds/weapons/ak47/ak47-1.vsnd",
      "soundevent": "Weapon_AK47.Single",
      "volume": 1.0
    }
    // …共 29 把
  }
}
```

日志：`plugins/OldWeaponSounds/oldweaponsounds.log`

### 自行编译插件

```bash
# 需要 .NET SDK（API 目标框架为 net10.0）
dotnet build -c Release
```
`OldWeaponSounds.csproj` 通过 `<Reference>` 直接引用服务器上的
`CounterStrikeSharp.API.dll`，避免 NuGet 版本不匹配。若你的路径不同，请修改 `HintPath`。

---

## 五、已验证 / 未验证（诚实标注）

**已验证（逐字节或源码级）：**

- CS2 内置 30 把武器的 CS:GO 原版枪声，PCM 与 CS:GO 一致（`docs/verified_map.json`）
- `item_def_index` 解析经交叉验证：`weapon_ak47=7`、`weapon_awp=9`、`weapon_m4a1_silencer=60`、`weapon_usp_silencer=61`（与 [StopSound](https://github.com/oylsister/StopSound) 源码注释一致）
- 插件编译通过、在 CS2 DS 上加载成功、配置解析正确

**未验证（需要进服用耳朵确认）：**

- addon 覆盖后枪声是否真的变为 CS:GO 旧版音色
- 3D 方位与距离衰减是否正常
- 插件 `soundevent` / `vsnd` 两种模式的听感差异
- `Handled` 屏蔽是否彻底（若听到双重音，把 `suppressVanilla` 改为 `false`）

**未查证到的疑点：**

- 除 AK47 外的 `volume` 值是按经验设的参考值（**AK47 那条是逐字段抄自 CS2 真实定义**），建议按听感微调
- CS2 客户端是按 soundevent 名解析、还是按 `(weapon, sound_type)` 硬编码变体，未取得运行时证据；这决定了 addon 覆盖能否影响**开火者本人**听到的那一份
- 空服休眠时 CSS 定时器不推进（实测心跳未触发），插件中依赖定时器的逻辑需有人在线

---

## 六、复现方式

```bash
# 1) 列出 / 提取 VPK 内容
python3 tools/vpk.py list <pak01_dir.vpk> [子串过滤]
python3 tools/vpk.py extract <pak01_dir.vpk> <内部路径> <输出文件>

# 2) 比对 wav 与 vsnd_c 的 PCM
python3 tools/cmp_audio.py <csgo.wav> <cs2.vsnd_c>

# 3) 生成映射并逐项校验
python3 tools/build_map.py  <csgo_game_sounds_weapons.txt> <cs2_weapons.txt> legacy_map.json
python3 tools/verify_map.py legacy_map.json items_game.txt verified_map.json

# 4) 生成 addon 覆盖文件与插件配置
python3 tools/gen_addon.py  verified_map.json <addon>/soundevents
python3 tools/gen_config.py verified_map.json items_game.txt config.json
```

`build_map.py` 需要的 `csgo_game_sounds_weapons.txt` 取自 CS:GO DS 的
`scripts/game_sounds_weapons.txt`（在 `pak01_dir.vpk` 内），
`items_game.txt` 取自 CS2 的 `scripts/items/items_game.txt`。

---

## 七、说明

- 本 addon **不附带任何音频文件**，只重新指向客户端已有的资源
- 音效资产版权归 Valve；本项目仅修改 soundevent 的引用关系，供社区服务器使用
- 仅供社区服务器；官方匹配不加载第三方 Metamod 插件
