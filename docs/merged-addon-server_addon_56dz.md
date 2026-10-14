# 合并 addon `server_addon_56dz`（模型包 3781467527 + 音效包 3819498100）

> 目标：把两个互相抢 `soundevents/soundevents_addon.vsndevts_c` 的工坊 addon 融成一个干净的
> 新 addon，修掉模型包里 89 个 skin subclass 的失效 `_base` 与 9 个写错的开火事件。
> 产出位置：
> - 源：`<CS2>/content/csgo_addons/server_addon_56dz/`
> - 编译产物（发布用）：`<CS2>/game/csgo_addons/server_addon_56dz/`

## 1. 结论 / 产物

| 路径（`game/csgo_addons/server_addon_56dz/`） | 大小 | 说明 |
|---|---|---|
| `scripts/weapons.vdata_c` | 26,951 B | 178 个当前 CS2 原版条目 + 89 个 `weapon_skin_*`（模型包原版为 31,441 B） |
| `soundevents/soundevents_addon.vsndevts_c` | **10,069 B** | 70 个事件（35×`Weapon_*.Single` + 35×`Orig_Weapon_*.Single`） |
| `sounds/weapons/ak47/ak47_csgo_01.vsnd_c` | 503,858 B | CS:GO 第一人称 AK |
| `sounds/weapons_csgo/famas/famas_01.vsnd_c` | 450,278 B | |
| `sounds/weapons_csgo/galilar/galil_01.vsnd_c` | 558,066 B | |
| `sounds/weapons_csgo/glock18/glock_01.vsnd_c` | 293,750 B | |
| `sounds/weapons_csgo/revolver/revolver-1_01.vsnd_c` | 618,716 B | 比参考产物多 16 B（见 §5） |
| `sounds/weapons_csgo/xm1014/xm1014-1.vsnd_c` | 564,782 B | |
| `weapons/models/**` | 2,660 文件 / 457,988,337 B | 从模型包提取，`content/` 与 `game/` 两处 md5 全同 |
| `materials/**` | 74 文件 / 24,324,800 B | 同上 |

`game/` 侧合计 **2,762 文件 / 487,148,685 B（464.6 MB）**；`content/` 侧 2,754 文件 / 468.1 MB。

## 2. 复现步骤

```bash
CS2="D:\\Program Files\\Steam\\steamapps\\common\\Counter-Strike Global Offensive"
NODE=<node>; PY=<python3>

# (1) 从本机工坊缓存提取武器模型与材质（排除 characters/ agents/ models/ sounds/ particles/ maps/ soundevents/）
$PY tools/extract_model_pack.py \
  "D:\\Program Files\\Steam\\steamapps\\workshop\\content\\730\\3781467527\\3781467527_dir.vpk" \
  "$CS2/content/csgo_addons/server_addon_56dz" "$CS2/game/csgo_addons/server_addon_56dz"

# (2) 取当前 CS2 原版 weapons.vdata 作为模板（权威「原版条目」）
$PY tools/dump_vanilla_weapons_vdata.py "$CS2"

# (3) 生成 weapons.vdata
$NODE tools/build_merged_vdata.js \
  --vanilla  data/model-pack-analysis/vanilla_weapons_vdata_dump.txt \
  --modelpack data/model-pack-analysis/vdata_dump.txt \
  --tsv "docs/weapon_skin-音效事件映射表.tsv" \
  --out "$CS2/content/csgo_addons/server_addon_56dz/scripts/weapons.vdata"

# (4) 编译（-game 必须传目录！）
cd "$CS2"
game/bin/win64/resourcecompiler.exe -f -i "…\\scripts\\weapons.vdata" -game "…\\game\\csgo"
game/bin/win64/resourcecompiler.exe -f -i "…\\soundevents\\soundevents_addon.vsndevts" -game "…\\game\\csgo"
for w in ak47_csgo_01 famas_01 galil_01 glock_01 revolver-1_01 xm1014-1; do … done

# (5) 校验编译产物
game/bin/win64/resourceinfo.exe -i "$ADDON/scripts/weapons.vdata_c" -all -baremode -game "$CS2/game/csgo" > merged_vdata_dump.txt
$NODE tools/verify_merged_vdata.js merged_vdata_dump.txt \
  data/model-pack-analysis/vanilla_weapons_vdata_dump.txt \
  data/model-pack-analysis/vdata_dump.txt "docs/weapon_skin-音效事件映射表.tsv"

game/bin/win64/resourceinfo.exe -i "$ADDON/soundevents/soundevents_addon.vsndevts_c" -all -baremode -game "$CS2/game/csgo" > vsndevts_dump.txt
$NODE tools/verify_compiled_vsndevts.js vsndevts_dump.txt data/gsw.txt tools/legacy_map_full.json
```

## 3. 实现里三个必须知道的硬约束（都是本机实测）

1. **根块第一个键必须是 `generic_data_type = "CBasePlayerWeaponVData"`**
   否则：`RESOURCE COMPILE ERROR: VData must have a 'generic_data_type' key`。
2. **`_base` 在编译期解析，被引用条目必须出现在同一个文件里**
   否则：`RESOURCE COMPILE ERROR: Invalid _base specified: 'xxx' - no entry with that name.`
   （纯数字串如 `_base = "7"` 不会被校验 —— 这正是模型包能编译成功、却在运行时继承不到任何东西的原因。）
3. **值一律写成纯字符串**：resourceinfo 转储里的 `resource_name:"x"` / `soundevent:"x"`
   前缀必须去掉，kv3 文本里只写 `"x"`。

## 4. 关键取舍（与原始指令的差异，均有证据）

* **模板取自当前 CS2 原版，而不是模型包自带的 `vdata_dump.txt`。**
  逐条比对：模型包的 103 个共有条目内容 **103/103 全部不同**（它是更早 CS2 版本的拷贝，
  例如 `weapon_ak47` 里 `m_nPrimaryReserveAmmoMax = 90` 且没有 `m_bReserveAmmoAsClips = true`，
  当前原版是 `3` + `m_bReserveAmmoAsClips = true`；另外缺 `m_flCycleTimeWhenInBurstMode`、
  `m_flTimeBetweenBurstShots`，多 `m_nCrosshairMinDistance`/`m_nCrosshairDeltaDistance`）。
  用旧拷贝会重新引入过期数值，与「让数值回归默认」的目标相反。
  → `tools/dump_vanilla_weapons_vdata.py` 负责生成该权威模板 dump。
* **输出包含完整的 178 个原版条目**（15 taxonomy + 44 prefab + 46 weapon + 73 个带引号的
  def-index 别名 `"1"`…`"526"`），而不是只带 base 链。
  理由：`_base` 编译期解析（见上）；且本机工坊缓存里**另外 6 个**武器皮肤 addon
  （3608612434 / 3615968422 / 3670050075 / 3672657008 / 3711322683 / 3758986810）
  **全部**都带完整原版集合。在「addon vdata 覆盖 game vdata」与「两者合并」两种语义下，
  带完整集合都安全（副本与当前原版逐字段相同）；只带 base 链在覆盖语义下会让所有原版武器失效。
* **刀的模板统一是 `weapon_knife`。** TSV 里 7 个刀 `base_weapon`
  （`weapon_bayonet` / `weapon_knife_butterfly` / `weapon_knife_css` / `weapon_knife_karambit` /
  `weapon_knife_kukri` / `weapon_knife_m9_bayonet` / `weapon_knife_skeleton`）在
  `weapons.vdata` 里并没有同名条目，22 个刀皮肤全部走 `_class = "weapon_knife"`。
* **`m_szName` 例外**：原版 `weapon_knife` 没有 `m_szName` 字段，而模型包给每个刀皮肤写了
  items_game 的 weapon_name（`weapon_knife_karambit` 等）。为不改变模型插件现有行为，
  这 22 个（实际补回 21 个，`weapon_skin_038` 原本也没有）保留了该字段。
  其余 84 个皮肤的 `m_szName` 本来就等于模板值。
* **曳光弹不再指向 `particles/aur1c/...`**：按指令排除了 `particles/`，而「其余字段取自原版」
  意味着 `m_szTracerParticle` 回到原版。若需要模型包的自定义曳光弹，需要额外提取
  `particles/aur1c/tracers/**`。

## 5. 校验结果（全部实测）

| # | 检查 | 结果 |
|---|---|---|
| 1 | `game/.../scripts/weapons.vdata_c` | **26,951 B** 存在（模型包原版 31,441 B，同量级） |
| 2 | `game/.../soundevents/soundevents_addon.vsndevts_c` | **10,069 B** 存在（70 事件版特征值，精确命中） |
| 3 | 6 个 `.vsnd_c` | 大小除 revolver 外全部精确命中；revolver 618,716 vs 618,700 |
| 3b | `.vsnd_c` 音频负载 | 6/6 与 `oldweaponsounds` 参考产物**逐字节相同**，且与源 wav 的 PCM 逐字节相同 |
| 4 | `weapons/models/` + `materials/` | content 与 game 各 2,660 / 74 文件，**2734 个文件 md5 全部一致** |
| 5 | soundevents 目录 | content 只有 `soundevents_addon.vsndevts`(162,527 B)，game 只有 `.vsndevts_c`；无 `zero_*`、无 `characters/`、全 addon 无第 2 个 `*.vsndevts` |
| 6 | `resourceinfo -all -baremode` 转储 | 267 条目 = 178 原版 + 89 皮肤；89 个 `weapon_skin_*` 全在；每个皮肤的字段与模板逐行一致；`m_aShootSounds` 深等于 base_weapon；AWP 皮肤 083/089 `m_iMaxClip1 = m_iDefaultClip1 = 10`；所有 `_base` 都能在文件内解析 |
| 6b | `verify_compiled_vsndevts.js` | 全部通过：事件数 70 = 35×2、子资源清单 70 项、35 把武器 vsnd 与结构逐行正确 |
| 7 | `game/.../server_addon_56dz` | **2,762 文件 / 487,148,685 B（464.6 MB）** |

### revolver 的 +16 B

`.vsnd_c` 头部会记录源文件所属 addon 路径（`csgo_addons/<addon>/…`）。
`server_addon_56dz`(17 字符) 比 `oldweaponsounds`(15 字符) 长 2 字符，
revolver 那份的头部字符串正好跨过 4 字节对齐边界，于是头部 1,316 B（参考 1,300 B），
总大小 +16 B。音频负载逐字节相同。

## 6. 被修正的 9 个开火事件

| subclass | base_weapon | 模型包原值 | 修正后 |
|---|---|---|---|
| weapon_skin_054 | weapon_mp9 | `Weapon_MP5.Single` | `Weapon_MP9.Single` |
| weapon_skin_068 | weapon_ump45 | `Weapon_MP9.Single` | `Weapon_UMP45.Single` |
| weapon_skin_075 | weapon_ump45 | `Weapon_MP5.Single` | `Weapon_UMP45.Single` |
| weapon_skin_076 | weapon_m4a1_silencer | `Weapon_M4A4.Single` | `Weapon_M4A1.Single` |
| weapon_skin_080 | weapon_hkp2000 | `Weapon_USP.Single` | `Weapon_hkp2000.Single` |
| weapon_skin_081 | weapon_m4a1 | `Weapon_M4A1.Single` | `Weapon_M4A4.Single` |
| weapon_skin_083 | weapon_awp | `Weapon_scar20.Single` | `Weapon_AWP.Single` |
| weapon_skin_086 | weapon_mac10 | `Weapon_MP9.Single` | `Weapon_MAC10.Single` |
| weapon_skin_089 | weapon_awp | `Weapon_scar20.Single` | `Weapon_AWP.Single` |

083/089 顺带把 `_class` 从 `weapon_scar20` 修回 `weapon_awp`（原值让小写
`Weapon_scar20.Single` 这类事件被指到别的枪上）。

校验产物：`data/model-pack-analysis/merged-vdata-verification.json`。
