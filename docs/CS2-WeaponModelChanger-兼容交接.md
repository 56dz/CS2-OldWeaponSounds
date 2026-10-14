# CS2-WeaponModelChanger ↔ CS2-OldWeaponSounds 冲突分析与兼容交接

> 交接对象：负责 **CS2-OldWeaponSounds**（音效覆盖 addon `3819498100` + `plugin/Plugin.cs`）的 agent
> 撰写时间：2026-10-14 23:00（CST）
> 撰写依据：本机与线上服务器 `192.168.5.222` 的**实测**（非推测），每条结论都附证据

---

## 0. TL;DR（先看这段）

武器模型插件换的不是"模型"，而是**整个武器 VData**。VData 里同时包含**开火音效事件**（`m_aShootSounds`）。
所以模型插件一旦生效，就会**直接改写服务端下发给客户端的开火音效事件名** —— 这正好是 OldWeaponSounds 赖以工作的唯一支点。

实测发现 **两处硬冲突 + 两处待确认**：

| # | 冲突 | 严重度 | 证据强度 |
|---|---|---|---|
| **C1** | 两个 addon **抢同一个文件路径** `soundevents/soundevents_addon.vsndevts_c`，互相覆盖 | 🔴 致命（旧枪声整体失效） | 已提取两边文件比对，内容完全不同 |
| **C2** | 模型包 89 个 subclass **各自重定义了 `m_aShootSounds`**，其中 **9 个把开火事件指到了别的武器** | 🔴 严重（响成别的枪 / 开关行为不一致） | 已从 `weapons.vdata_c` 反解出全部 89 条 |
| **C3** | 34 个刀/雷皮肤也声明了 `Weapon_DEagle.Single` | 🟡 观察项 | 数据已列出，需实机确认 |
| **C4** | subclass 应用后 `item_def_index` / `DesignerName` 是否变化 → 影响 452 查表 | 🟠 待实测 | 未知，给了 5 分钟验证方法 |

**最短修复路径**：C1 合并 addon 的 soundevents 文件；C2 让插件不再依赖"事件名 = `Weapon_XXX.Single`"这个假设（见 §4）。

---

## 1. 武器模型修改的原理（完整链路）

### 1.1 CS2 的 subclass（实体子类）机制

CS2 每个 entity 都有一个 `m_nSubclassID`（类型 `CUtlStringToken`），它指向 `scripts/weapons.vdata` 里的一个 **VData 条目**。

一个武器 VData 条目里包含（实测自模型包的 `weapons.vdata_c`）：

```
weapon_skin_001 = {
    m_nDamage / m_iMaxClip1 / m_flCycleTime / m_flSpread / ...   ← 全套数值
    m_GearSlot            = "GEAR_SLOT_RIFLE"
    m_WeaponType          = "WEAPONTYPE_RIFLE"
    m_szName              = "weapon_ak47"                         ← 基准武器名
    m_szWorldModel        = "weapons/models/ak103_hina/ak103_hina.vmdl"   ← 世界模型
    m_szAnimSkeleton      = "animation/skeletons/weapons/ak47.vnmskel"
    m_aShootSounds = {                                            ← ★★★ 开火音效
        WEAPON_SOUND_SINGLE     = soundevent:"Weapon_AK47.Single"
        WEAPON_SOUND_NEARLYEMPTY= soundevent:"Default.nearlyempty"
    }
    m_szTracerParticle    = "particles/aur1c/tracers/weapon_tracers_purple.vpcf"
    ...
}
```

> **结论：换 subclass = 换整套 VData = 同时换掉模型、骨骼、数值、曳光弹、以及开火音效事件。**
> 这是理解整个冲突的关键。

### 1.2 怎么改：`AcceptInput("ChangeSubclass", ...)`

```csharp
weapon.AcceptInput("ChangeSubclass", weapon, weapon, "weapon_skin_001");
```

**实测证据**（我在服务器上写了一个临时诊断插件，直接创建实体并调用，CS2 `1.41.9.0 / ServerVersion 2000930`）：

```
weapon_ak47     sub_before=0   sub_after=2233641767
weapon_knife    sub_before=0   sub_after=2233641767
weapon_hkp2000  sub_before=0   sub_after=2233641767
weapon_mp7      sub_before=0   sub_after=2233641767
weapon_m4a1     sub_before=0   sub_after=2233641767
```

→ `ChangeSubclass` 在当前 CS2 上**有效**，`m_nSubclassID` 会被写入。

### 1.3 模型资源从哪来：创意工坊 addon + MultiAddonManager

- addon 内 `scripts/weapons.vdata_c` 定义新 subclass（模型包 `3781467527` 定义了 89 个：`weapon_skin_001` ~ `weapon_skin_089`）
- addon 内 `weapons/models/**` 放 `.vmdl_c` 与材质
- MAM 配置：
  ```cfg
  mm_extra_addons        "3819498100,3781467527"
  mm_client_extra_addons "3819498100,3781467527"
  ```
  - `mm_extra_addons` → 服务端把 addon 作为 **VPK 搜索路径**挂载（日志：`Adding search path: .../3781467527/3781467527.vpk`）
  - `mm_client_extra_addons` → 客户端**必须下载**同一 addon，否则看不到模型
- **`sv_pure` 在 CS2 已不存在**（实测服务器 `libserver.so` 里 0 命中），所以覆盖客户端资源是可行路径

### 1.4 WeaponModelChanger 插件的实现（逐行）

| 位置 | 行为 |
|---|---|
| `Events.OnEntityCreated` | `entity.DesignerName.StartsWith("weapon_")` → `Server.NextWorldUpdate` 延后一帧 → `Weapons.ProcessEntity` |
| `Weapons.ProcessEntity` | 反查武器归属玩家 → 查内存缓存 `Database.PlayerSkinCache[steamid][GetDesignerName(weapon)]` → 命中则 `SetSubclass` |
| `Weapons.SetSubclass` | 把**原** subclass 记到 `oldDesignerName[weapon.Handle]` → `AcceptInput("ChangeSubclass", weapon, weapon, skinId)` |
| `Weapons.Unequip` | 从 `oldDesignerName` 取回原值 → `ChangeSubclass` 还原 |
| `Menu.cs` | CS2MenuManager 的 `CenterHtmlMenu`，命令 `css_cw`；选择 → `Database.SetPlayerSkin` + `Weapons.Equip` |
| `Database.cs` | SQLite，表 `player_skins(SteamId, WeaponId, SkinId)`；DB 落在进程 CWD：`game/bin/linuxsteamrt64/weaponmodelchanger.db` |

**`Weapons.GetDesignerName()` 的归一化表（配置左值必须匹配它）：**

| 实体 DesignerName | item_def_index | 归一化结果 |
|---|---|---|
| 含 `bayonet` | 任意 | `weapon_knife` |
| `weapon_m4a1` | 60 | `weapon_m4a1_silencer` |
| `weapon_hkp2000` | 61 | `weapon_usp_silencer` |
| `weapon_mp7` | 23 | `weapon_mp5sd` |
| 其它 | | 原样 |

**实测补充：CS2 里所有刀都是 `weapon_knife` 这一个实体类。**
`weapon_knife_karambit` / `weapon_bayonet` / `weapon_knife_butterfly` 等**不是有效实体类**（`CreateEntityByName` 出来是无效实体，`DispatchSpawn` 抛 `Entity is not valid`）。
→ 所以线上配置把 **22 个刀皮肤全部挂在 `weapon_knife`** 下。（也与你 10 月 4 日的历史 DB 记录一致）

---

## 2. 音效侧现状（OldWeaponSounds 现有机制）

### 2.1 addon `3819498100`

覆盖 `soundevents/soundevents_addon.vsndevts_c`（**10069 字节**），定义 **70 个事件**：

- `Weapon_XXX.Single`（35 把 → CS:GO 旧音）
- `Orig_Weapon_XXX.Single`（35 把 → 内容 = CS2 原事件，逐字段相同）

### 2.2 插件 `plugin/Plugin.cs`

```csharp
HookUserMessage(452, OnWeaponFireSound, HookMode.Pre);   // 452 = 武器开火音效消息
```

`OnWeaponFireSound` 逻辑：

1. 读 452 的 `item_def_index` → 查配置表 `_cfg.weapons[defIndex]`
2. 表里没有 / `enabled == true`（默认）→ **`HookResult.Continue`，什么都不做**
   → 客户端播**服务端下发的那条消息所指定的事件**
3. `enabled == false` → `ResolveShooter()` 定位开枪者 → `pawn.EmitSound(wc.orig_event, ...)`
   → 只有 `guid != 0` 才 `HookResult.Handled` 屏蔽原消息

> **关键假设**：第 2 步"什么都不做"能成立，前提是**服务端下发的事件名恰好是 `Weapon_XXX.Single`**。
> 这个前提**会被模型插件的 subclass 打破**（见 C2）。

---

## 3. 冲突点清单

### 🔴 C1【文件级】两个 addon 抢同一个 `soundevents/soundevents_addon.vsndevts_c`

**证据（我把两个 addon 的文件都从 VPK 里提取出来对比）：**

| addon | 虚拟路径 | 大小 | 实际内容 |
|---|---|---|---|
| `3819498100` 音效包 | `soundevents/soundevents_addon.vsndevts_c` | **10069 B** | 70 个 `Weapon_*.Single` / `Orig_Weapon_*.Single` |
| `3781467527` 模型包 | `soundevents/soundevents_addon.vsndevts_c` | **3780 B** | 只有**环境音**：`ambient_example.outdoors`、`amb.*`、`rockfall`、`wind_sand`、`airplane_01`、`dsp_preset` … **完全没有任何 `Weapon_*` 事件** |

提取出的原文已存档：
- `data/3819498100-soundevents_addon.vsndevts_c`
- `data/3781467527-soundevents_addon.vsndevts_c`

**机理**：两个 addon 都提供**同一个虚拟路径**的文件 → VPK 搜索路径里只有一个能命中，另一个被完全遮蔽。

**当前挂载顺序**（服务器日志）：
```
[MultiAddonManager] Adding search path: .../3819498100/3819498100.vpk
[MultiAddonManager] Adding search path: .../3781467527/3781467527.vpk
```

**实测现象与"后挂载者胜"一致** → 模型包的 3780 B 文件生效 → **音效包的 70 个武器事件全部消失 → CS:GO 旧枪声整体失效**。

> ⚠️ 严谨起见：CS2 的 VPK 同名文件解析优先级我没有 100% 实测确认。**5 分钟确认方法见 §5.3**。
> 但无论谁胜，修复动作都是同一个（合并成一个文件，删掉重复路径）。

**补充事实**：基座游戏 `pak01_dir.vpk` 里**没有** `soundevents/soundevents_addon.vsndevts_c`（已用 `tools/vpk.py list` 核对），它是 workshop addon 的约定文件名。

---

### 🔴 C2【VData 级】subclass 重定义了 `m_aShootSounds`，9 个皮肤把开火事件指到了**别的武器**

模型包 `3781467527` 的**每一个** subclass 都完整声明了 `m_aShootSounds`。
把 89 个皮肤逐个对照"它应该响的事件名"，发现 **9 个错配**：

| subclass | 模型 | 配置里挂在 | VData 里实际 `WEAPON_SOUND_SINGLE` | **应该是** |
|---|---|---|---|---|
| `weapon_skin_054` | `mp9_aje` | `weapon_mp9` | `Weapon_MP5.Single` | `Weapon_MP9.Single` |
| `weapon_skin_068` | `iso9bg` | `weapon_ump45` | `Weapon_MP9.Single` | `Weapon_UMP45.Single` |
| `weapon_skin_075` | `qcq171_xh` | `weapon_ump45` | `Weapon_MP5.Single` | `Weapon_UMP45.Single` |
| `weapon_skin_076` | `m7_prisma` | `weapon_m4a1_silencer` | `Weapon_M4A4.Single` | `Weapon_M4A1.Single` |
| `weapon_skin_080` | `m1911_lty` | `weapon_hkp2000` | `Weapon_USP.Single` | `Weapon_hkp2000.Single` |
| `weapon_skin_081` | `m4a4s_winefox` | `weapon_m4a1` | `Weapon_M4A1.Single` | `Weapon_M4A4.Single` |
| `weapon_skin_083` | `ssls_hd` | `weapon_awp` | `Weapon_scar20.Single` | `Weapon_AWP.Single` |
| `weapon_skin_086` | `smg_requiem` | `weapon_mac10` | `Weapon_MP9.Single` | `Weapon_MAC10.Single` |
| `weapon_skin_089` | `m82_kanami` | `weapon_awp` | `Weapon_scar20.Single` | `Weapon_AWP.Single` |

**后果（这就是"插件冲突"的直接表现）：**

1. **`enabled=true` 的武器**：服务端 452 下发的是**另一个武器的事件**。
   - 例：装上 `weapon_skin_089` 的 AWP → 服务端下发 `Weapon_scar20.Single` → 客户端播的是**音效包覆盖后的 SCAR-20 旧音**，AWP 响成 SCAR。
   - 音效包对 `Weapon_AWP.Single` 的覆盖**完全不会被触发**。
2. **`enabled=false` 的武器**：插件强制 `EmitSound(Orig_Weapon_AWP.Single)` + 屏蔽原消息 → **反而正确**。
3. → **同一个功能在不同皮肤下表现不一致**：同一把 AWP，默认皮肤走"旧音"，换皮肤后变成"SCAR 音"或"CS2 原音"，取决于 `enabled`。

**注意：你自己 DB 里已配置的 19 条皮肤中有 5 条命中此表**：
`weapon_awp→089`、`weapon_m4a1→081`、`weapon_mac10→086`、`weapon_ump45→075`、`weapon_hkp2000→080`。

**根因**：模型包作者是用"复制某个模板武器 VData 再改模型"的方式批量生成 89 个条目的，`m_aShootSounds` 跟着模板一起被复制过来了。

---

### 🟡 C3【观察项】22 个刀皮肤被塞了 `Weapon_DEagle.Single`，12 个雷皮肤丢了音效槽

模型包里 34 个非枪械皮肤（22 刀 + 12 雷）的 `m_aShootSounds` 同样被模板污染：

| 类别 | 数量 | subclass | 实际 `m_aShootSounds` |
|---|---|---|---|
| 刀 | **22** | `003 004 005 006 010 011 014 015 021 022 023 032 038 039 043 053 056 061 062 072 074 087` | `WEAPON_SOUND_SINGLE = Weapon_DEagle.Single`（明显是模板残留） |
| 手雷/烟雾/燃烧 | **12** | `008 009 026 027 028 048 049 050 051 058 070 071` | **没有** `WEAPON_SOUND_SINGLE`（只剩 `RADIO_USE` 或空） |

刀不开枪、手雷不"开火"，理论上下发不到 452。
但刀有挥砍音、手雷有投掷/反弹音、烟雾有引爆音 —— 这些是否也读 VData，需要实机确认（属于 `enabled=true` 路径的潜在坑）。

---

### 🟠 C4【待实测】subclass 应用后 `item_def_index` 是否变化

插件的 452 处理完全基于 `item_def_index` 查表。
- 若 subclass 不改 def_index → 查表不受影响
- 若改了 → `_cfg.weapons[defIndex]` 查不到 → 直接 `Continue` → **还原功能静默失效**

**5 分钟验证方法**：在 `OnWeaponFireSound` 里把 `item_def_index` + `weapon_id` 打成日志，装模型皮肤前后对比一次。

---

## 4. 兼容方案建议（按性价比排序）

### 方案 A：合并 addon 的 soundevents 文件 —— **必做，成本最低**
把模型包里那份 `soundevents_addon.vsndevts` 的**环境音事件**合并进音效包的 `addon/soundevents/soundevents_addon.vsndevts`（或反过来），
让两个 addon**只保留一份**该路径的文件。

- 环境音事件清单可从 `data/3781467527-soundevents_addon.vsndevts_c` 反解（含 `ambient_example.outdoors` / `amb.*` / `rockfall` / `wind_sand` / `airplane_01` / `dsp_preset` / `mix.Amb_Common` 等）
- 合并后重新发布两个 addon 之一即可（或让模型包去掉 soundevents 目录）
- 这样 C1 彻底消失，音效包的 70 个事件一定生效

### 方案 B：修模型包的 `m_aShootSounds`（治 C2 的根）
在模型包源工程的 `scripts/weapons.vdata` 里，把上表 9 个条目的 `WEAPON_SOUND_SINGLE` 改回本武器的事件名，重新编译发布。
- 优点：一次性、最干净
- 缺点：需要模型包作者（你）重新发 workshop，且以后新增皮肤要记得改

### 方案 C（**推荐给音效插件 agent**）：让插件不再依赖事件名假设
现在的脆弱点是"`enabled=true` 时把控制权交给 VData"。

建议改成：**只要检测到该武器挂了自定义 subclass（`m_nSubclassID != 0` / 或 def_index 与默认不符），就一律走显式 `EmitSound` 路径**：

```
452 消息进来
  → 取出武器实体（weapon_id / FIFO）与 def_index
  → 若该武器挂了自定义 subclass：
        直接 EmitSound(legacy_event = Weapon_XXX.Single)   ← 显式播放，不受 VData 影响
        guid != 0 → Handled
  → 否则维持现有逻辑（enabled 开关）
```

- 好处：把控制权从"模型包的 VData"收回到插件，**无论模型包怎么配 `m_aShootSounds` 都不会被带偏**
- 需要 `weapon_fire` FIFO / `weapon_id` 能稳定定位到武器实体（现在 `ResolveShooter` 已有这条路）

### 方案 D：插件侧维护 subclass → 事件名映射表（兜底）
在插件里维护"哪些 subclass 的 `m_aShootSounds` 是错的"（当前 9 条），对这些强制走 `EmitSound`。
- 优点：不动 addon、不动模型包
- 缺点：模型包更新就要跟着改，是硬编码

---

## 5. 复现与验证环境

### 5.1 线上环境

| 项 | 值 |
|---|---|
| 服务器 | `192.168.5.222`（Debian 12），`ssh zhz@192.168.5.222`（本机公钥已装） |
| CS2 | `/zfs1t/Games/Steam/cs2-ds`，构建 `2000930` / PatchVersion `1.41.9.0` / `Oct 08 2026` |
| 服务 | `cs2.service`（systemd，`Restart=always`） |
| 重启 | 无 root，用 `kill -TERM $(systemctl show cs2 -p MainPID --value)`，约 5 秒后自动拉起 |
| CounterStrikeSharp | 1.0.376（自带 .NET 10.0.3 运行时） |
| 服务器 .NET SDK | `~/.dotnet/dotnet`（10.0.401） |
| 模型插件源码/编译产物 | `~/wmc-build/WeaponModelChanger/`（net10.0） |
| MAM 配置 | `game/csgo/cfg/multiaddonmanager/multiaddonmanager.cfg`（已备份 `.bak-*`） |
| addon 缓存 | `game/bin/linuxsteamrt64/steamapps/workshop/content/730/<id>/` |
| 插件日志 | `addons/counterstrikesharp/logs/log-all<日期>.txt` |
| 引擎日志 | `journalctl -u cs2` |

### 5.2 快速看状态

```bash
# 两个 addon 是否都挂上
journalctl -u cs2 | grep -E "Adding search path|MountAddon"

# 模型插件是否加载
journalctl -u cs2 | grep -i WeaponModelChanger

# 音效插件日志
tail -50 .../addons/counterstrikesharp/logs/log-<当天>.txt | grep OldWeaponSounds
```

### 5.3 5 分钟确认 C1（谁的文件生效）

**方法一（推荐，无需玩家）**：临时把 `mm_extra_addons` 只留 `3819498100`，重启，进服听 AK 是否是 CS:GO 旧音；
再只留 `3781467527` 对比。若前者正常、两者同时挂就失效 → C1 确认。

**方法二**：把两个 addon 的添加顺序对调（`3781467527,3819498100`），若现象反转 → C1 确认且优先级 = 后挂载者胜。

### 5.4 复现 C2（无需玩家）

见 `data/weapon_skin-音效事件映射表.tsv`，或对模型包重跑：

```bash
# 1) 从工坊 addon 提取编译后的 vdata
python tools/vpk.py extract <...>/3781467527_dir.vpk scripts/weapons.vdata_c /tmp/weapons.vdata_c
# 2) 用 CS2 自带工具反解成文本
"<CS2>/game/bin/win64/resourceinfo.exe" -i /tmp/weapons.vdata_c -all -baremode \
   -game "<CS2>/game/game/csgo" > vdata_dump.txt
# 3) 在 vdata_dump.txt 里搜 m_aShootSounds
```

---

## 6. 附录

### 6.1 附件清单

| 文件 | 说明 |
|---|---|
| `docs/weapon_skin-音效事件映射表.tsv` | **89 个皮肤 × 基准武器 × 模型 × 实际开火事件 × 状态**，完整表 |
| `data/3781467527-soundevents_addon.vsndevts_c` | 模型包的 soundevents 原文（3780 B，只有环境音） |
| `data/3819498100-soundevents_addon.vsndevts_c` | 音效包的 soundevents 原文（10069 B，70 个武器事件） |
| `data/model_addon-shoot-sounds.json` | 89 个 subclass 的 `m_aShootSounds` 全量 JSON（由 vdata 反解） |
| `data/model-pack-analysis/vdata_dump.txt` | 模型包 `scripts/weapons.vdata_c` 的 **完整文本反解**（5 万行，含全部 206 个条目） |
| `data/model-pack-analysis/subclasses.json` | 183 个条目的结构化解析（name / `_class` / `m_szName` / 模型路径） |
| `data/model-pack-analysis/vpk_list.txt` | 模型包 VPK 内 8258 个文件的完整清单 |
| `data/model-pack-analysis/weapons.vdata_c` | 从工坊 VPK 提取的原始编译产物（31441 B） |
| `data/model-pack-analysis/deployed-plugin-src/` | 实际部署到服务器的模型插件源码（net10.0 版）+ 生成的 89 条配置 |
| `data/session-raw.jsonl` | 本次部署/诊断会话原始记录（1267 条） |
| `data/会话记录-WeaponModelChanger-完整导出.md` | 上者的可读 Markdown 版 |
| `docs/CS2-WeaponModelChanger-兼容交接.md` | **本文** |

### 6.2 89 个皮肤的基准武器分布

| 基准武器（插件侧 key） | 皮肤数 | 备注 |
|---|---|---|
| `weapon_knife` | 22 | **CS2 所有刀都是这一个实体类**；含 bayonet/karambit/butterfly/m9/kukri/skeleton/css 全部 |
| `weapon_m4a1_silencer` | 8 | def 60 |
| `weapon_hegrenade` | 8 | |
| `weapon_mp9` | 7 | |
| `weapon_negev` | 7 | |
| `weapon_usp_silencer` | 6 | def 61 |
| `weapon_ak47` | 5 | |
| `weapon_famas` | 3 | |
| `weapon_smokegrenade` | 3 | |
| `weapon_xm1014` | 3 | |
| `weapon_awp` | 2 | **都错配成 `Weapon_scar20.Single`** |
| `weapon_bizon` | 2 | |
| `weapon_m4a1` | 2 | 其中 081 错配 |
| `weapon_mp5sd` | 2 | def 23 |
| `weapon_ump45` | 2 | **两条都错配** |
| 其余 13 类（aug/awp/deagle/glock/hkp2000/incgrenade/mac10/mp9… ）各 1 | 13 | 080/086 错配 |
| **合计** | **89** | |

### 6.3 关键结论速查

1. `ChangeSubclass` 在 CS2 1.41.9.0 **可用**（实测 token 0 → 非 0）
2. subclass 改变的是**整套 VData**，**包含开火音效事件**
3. CS2 **所有刀 = `weapon_knife`** 实体类
4. 模型包 `3781467527` 与音效包 `3819498100` **共用同一个 `soundevents/soundevents_addon.vsndevts_c` 路径** → 必然互相遮蔽
5. 模型包 89 个条目里 **9 个开火事件错配**（见 C2 表）

---

# 修复记录（OldWeaponSounds 侧 · 2026-10-14 23:10）

## 一、静音的直接原因（已定位）

文档 §C2 指出"9 个皮肤的开火事件**错配**"，但把 89 个皮肤的事件名逐个对照
**CS2 基础游戏真实事件表**（`data/gsw.txt`，628 个事件）后发现更严重的问题：

**其中 2 个皮肤指向的事件在基础游戏里根本不存在 → 客户端解析不到 → 完全无声。**

| subclass | 基准武器 | VData 里的事件 | 基础游戏存在？ | 正确的应该是 |
|---|---|---|---|---|
| `weapon_skin_083` | AWP | `Weapon_scar20.Single` | ❌ **不存在** | `Weapon_AWP.Single` |
| `weapon_skin_089` | AWP | `Weapon_scar20.Single` | ❌ **不存在** | `Weapon_AWP.Single` |

原因：CS2 真实事件名是 **`Weapon_SCAR20.Single`（SCAR20 全大写）**，模型包写成了小写。
soundevent 名以字符串哈希（seed `0x53524332`）索引，**区分大小写** → 是两个不同事件。

其余 7 个错配（054/068/075/076/080/081/086）指向的事件**存在**，
所以它们不是无声，而是**响成别的枪**；另有 12 个手雷皮肤没有 `WEAPON_SOUND_SINGLE`（不"开火"，理论无影响）。

复现方式：把 89 行事件的第 4 列逐个对照 `data/gsw.txt` 里 `^\t<事件名> = $` 的行。

## 二、插件侧修复（文档 §4 方案 C，已实现并部署）

`plugin/Plugin.cs` 的 452 处理改为：

| 情况 | 行为 |
|---|---|
| `enabled = false` | 显式播 `orig_event`（还原 CS2 原声）—— 原有行为 |
| `enabled = true` 且**挂了自定义 subclass** | **新增**：显式播 `legacy_event`（本武器正确的 CS:GO 旧音），并屏蔽原版消息 |
| `enabled = true` 且未改过 | 不做任何事，交给原版路径 —— 原有行为 |

subclass 检测用 CounterStrikeSharp 的 schema 属性：

```csharp
var wpn = shooter.PlayerPawn?.Value?.WeaponServices?.ActiveWeapon?.Value;
long token = wpn.SubclassID.Value;   // CBaseEntity.m_nSubclassID；0 = 原版，非 0 = 被换过模型
```

**效果**：把开火音效的控制权从"模型包的 VData"收回到插件，模型包怎么写 `m_aShootSounds` 都不再影响结果：

- `083` / `089`（AWP）不再静音，播 AWP 的旧音
- `054/068/075/076/080/081/086` 不再响成别的枪，播本武器的旧音
- 以后新增皮肤、作者再写错事件名，也不会被带偏

安全性未变：**先发目标事件、拿到非 0 guid 才屏蔽原版**；任一步失败都保留原版，不会产生无声。

新增排错开关 `forceEmitAlways`（默认 `false`）：置 `true` 后**所有 35 把武器**都由插件显式播放旧音，
用于排除"subclass 检测失效"这一可能。

## 三、C1（同路径 soundevents 冲突）—— 需要一次实机确认

文档 §C1 判断模型包的 3780 B 文件覆盖了音效包的 10069 B 文件、导致 70 个武器事件整体失效。
**但这条与用户报告的症状不完全吻合** —— 用户只报告"改过模型的武器没声音"，
没有报告"所有武器的旧音都没了"。若 70 个事件真的整体失效，所有武器都会退回 CS2 原声。

两种可能的实际状态：

| 谁的文件生效 | 未改模型的武器 | 改过模型的武器 |
|---|---|---|
| 音效包 | ✅ CS:GO 旧音 | 修复前 083/089 静音 → 修复后 ✅ 旧音 |
| 模型包 | ❌ 退回 CS2 原声 | 同上 |

**2 分钟判定法**：进服拿一把**没换过模型**的 AK47 开枪 ——
是 CS:GO 旧音即音效包生效（C1 目前无害，无需处理）；是 CS2 新音即模型包生效。

若确认模型包生效，可选方案（按成本排序）：

1. **对调挂载顺序**（免费）：MM 配置改为 `3781467527,3819498100`，把音效包放最后。
   依据是文档"后挂载者胜"的观察。代价是模型包的模板环境音被遮蔽（无人引用，无害）。
2. **模型包去掉 `soundevents/` 后重新发布**（彻底，但需重传 1.44 GB）。
3. **音效包侧加别名**（重传 3.8 MB）：补一条 `Weapon_scar20.Single` → AWP 旧音。
   只能解决 083/089 的静音，解决不了 7 个错配（多个皮肤共用同一错事件名，一份别名只能对应一份音频）。

> 目前**未执行任何 C1 处理**，避免在未确认的情况下去改动一个可能正在正常工作的状态。
