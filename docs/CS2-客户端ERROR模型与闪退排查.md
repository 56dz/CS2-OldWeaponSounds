# CS2 客户端 ERROR 模型与闪退排查记录

> 2026-10-15。涉及「模型包换装 + 自编译旧音效 addon」的客户端侧故障。
> 结论都用实测日志/minidump 支撑，可复现步骤与工具都在本仓库 `tools/`。

## 1. 现象

| 现象 | 表现 |
| :--- | :--- |
| **ERROR 模型** | 用 WeaponModelChanger 换皮肤后，客户端显示错误模型（黄色 ERROR） |
| **客户端闪退** | 游玩 30~70 秒后 `cs2.exe` 崩溃，Steam 生成 minidump |
| **AWP 少 1 次换弹** | 购买 AWP 后显示 5 发，换一次弹才变 10 发 |

前提：服务端挂载一个自编译 addon（89 个武器皮肤模型 + `scripts/weapons.vdata` + `soundevents`），
插件在运行时对武器调用 `AcceptInput("ChangeSubclass", ...)` 切换子类。

## 2. ERROR 模型的根因：模型没进资源清单

客户端 `console.log`（启动项加 `-condebug`）：

```
ERROR: RESOURCE_TYPE_MODEL resource A1A67A69E8898A99 requested but not resident. (Missing from from a manifest?)
ERROR: RESOURCE_TYPE_MODEL resource 0CBB20466CCBB748 requested but not resident. (Missing from from a manifest?)
（一次会话共 21 次，涉及 2 个资源 ID）
```

**关键点：模型文件明明是完整的**，排查时逐条验证过：

- 服务端与客户端两侧 VPK 都是 8252 条目、`weapons/` 2660 条 ✓
- `glock_doro` 的 21 个文件（1 个 `.vmdl_c` + 20 个材质/贴图）都在 ✓
- `materials/default/*.vtex_c`（模型引用的默认 AO/法线）都在 ✓
- 骨骼 `animation/skeletons/weapons/glock18.vnmskel` 在基础游戏 `pak01_dir.vpk` 里 ✓
- vdata 里 `m_szWorldModel` 路径与实际文件一字不差 ✓

→ 所以不是"文件缺失"，而是**引擎认为它不在资源清单里**。
修法：在服务端把模型登记进资源清单。

```csharp
// CounterStrikeSharp.API.Modules.Utils.ResourceManifest
private void OnServerPrecacheResources(ResourceManifest manifest)
{
    foreach (var path in SkinModelPaths.AllModelPaths)   // weapons/models/<skin>/<skin>.vmdl
        manifest.AddResource(path);                      // 89 条，逐条 try/catch
}
```

要点：

- `ResourceManifest` 在 CSS 1.0.376 的 XML 文档里**没有**，只能从 DLL 元数据查；公开成员只有
  `AddResource(string)`（转调 `NativeAPI.AddResource`，纯字符串透传，managed 层不做路径变换）
- **路径带 `.vmdl`、不带 `_c`**（与 vdata 的 `resource_name:"..."` 写法、`resourceinfo -dep runtime`
  显示一致；最终 hash 必须与请求方一致）
- 回调由 `Listeners.OnServerPrecacheResources` 触发，CSS 文档说明为"服务端启动 / 换图时"

## 3. 客户端闪退的取证：minidump 离线解析

Steam 的转储在 `Steam/dumps/crash_cs2.exe_*.dmp`。本仓库 `tools/parse_minidump.js` 可离线解析
（纯 Node，无依赖，只读）：

```bash
node tools/parse_minidump.js                # 默认解析最近的转储并做一致性汇总
node tools/parse_minidump.js --stack --comment <file.dmp>
node tools/parse_minidump.js --json <file.dmp>
```

它在 minidump 里读 **ExceptionStream(6)** 取异常码/异常地址，用 **ModuleListStream(4)** 把地址
映射到模块，再从磁盘 DLL 反查崩溃指令（用 PE TimeDateStamp 对齐同一 build），并可扫描线程栈候选帧。

实测结论（3 个转储）：

| 转储时间 | 异常码 | 故障模块 + 偏移 | 定性 |
| :--- | :--- | :--- | :--- |
| 13:41:35 | `0xC0000005` READ 野地址 | `amdxx64.dll + 0xFD7831` | AMD 驱动崩溃，启动期、无 addon，**独立问题** |
| 16:16:51 | `0xC0000005` READ NULL | `client.dll + 0x826DAF` | 与下一行**完全同源** |
| 16:28:52 | `0xC0000005` READ NULL | `client.dll + 0x826DAF` | 同 build、同指令、调用链逐帧 offset 一致 |

崩溃指令（从磁盘 `client.dll` 反查，PE TimeDateStamp 与转储一致）：

```asm
mov rdx, r14          ; r14 = 0
je  0x826DAF          ; ZF=1，实际走此分支
mov edx, dword ptr [rdx]   ; ← 崩溃：拿 NULL 当对象指针解引用
```

两次崩溃都发生在加载该 addon 的会话里，且**紧跟那 21 条 manifest 错误**（末次错误后 16 秒 /
首次后 48 秒）。判定：**强时间关联 + 形态吻合（"拿到空句柄"）**，但 minidump 无法直接证明因果；
最终确认靠实机——修掉资源清单登记后，21 条错误归零且闪退不再出现。

> 注意：`-condebug` 每次启动会**覆盖** `console.log`，崩溃后要立刻备份该文件，否则会话日志会丢。

## 4. AWP「购买后 5 发、换弹才 10 发」

两个独立知识点叠加：

1. **addon 的 `scripts/weapons.vdata` 是合并语义** —— 能**新增**条目（`weapon_skin_*`、
   以及为默认态新增的 `weapon_awp_10round`），但**覆盖基础游戏已有条目无效**
   （把原版 `weapon_awp` 的 `m_iMaxClip1` 改成 10 不会生效）。
   所以"默认 AWP 也 10 发"必须靠**新增子类 + 插件应用**。
2. **`m_iDefaultClip1` 只在武器创建时生效** —— 子类是创建之后才切换的，弹匣仍按旧 VData 填了 5 发，
   已填充的 `m_iClip1` 不会自动重算。修法：`ChangeSubclass` 成功（`subclassToken` 前后不同）后，
   读切换后的 `CBasePlayerWeaponVData.MaxClip1` 刷新弹匣。

安全闸（避免"换皮肤白嫖子弹"）：

- 只在子类**真的提高了上限**时补（`beforeMax < target`，AWP 5→10 补；AK 30→30 不补）
- 只升不降（`clip >= target` 跳过）
- 只在应用子类那一刻执行一次（复用幂等缓存，不挂 tick / 换弹 / 开火）
- 写法：`weapon.Clip1 = n`（`ref int` 直写 schema）+ `Utilities.SetStateChanged(weapon, "CBasePlayerWeapon", "m_iClip1", 0)` + 回读校验
  （CSS 1.0.376 的 `Clip1` **只有 getter**，ref 直写是唯一干净路径）

## 5. 发布链路上的两个坑（自编译 addon 必看）

1. **打包白名单**：`game/csgo/gameinfo.gi` 的 `AddonConfig -> VpkDirectories` 是 addon 打包白名单，
   默认**没有** `weapons` / `characters` / `agents` → 这些目录会被静默丢出发布包
   （表现为发布出来的 item 只有 26 MiB 而不是 1.4 GiB）。
   发布前跑 `tools/fix-gameinfo-weapons.cmd` 补齐（幂等；**游戏更新会还原该文件，需重跑**）。
2. **Windows MAX_PATH 259**：创意工坊工具没有声明 long-path-aware，
   路径超过 259 字符会 `FATAL ERROR: error opening required file`
   （典型:皮肤材质文件名很长且含 `&`，`...\weapons\models\iso9bg\materials\wpn_p43_..._c&..._vtex_c` 达 273 字符）。
   解法：**缩短 addon 目录名**（addon 内部路径不受影响）。

## 6. 服务端本地挂载 addon 的顺序（MultiAddonManager）

服务器 Steam 未登录时 MM 无法自行下载 addon，可手工同步：

```bash
# 1) 用 steamcmd 下载（登录态会缓存）
steamcmd.sh +login <账号> +workshop_download_item 730 <ID> +quit
# 2) 拷到服务端工坊缓存（steamcmd 的根目录与游戏不同）
cp -a ~/Steam/steamapps/workshop/content/730/<ID>/. \
      <cs2>/game/bin/linuxsteamrt64/steamapps/workshop/content/730/<ID>/
# 3) 把工坊物品写进安装登记表 —— MM 判断"是否已安装"读的就是它
python3 tools/acf_upsert.py <...>/steamapps/workshop/appworkshop_730.acf \
        --from ~/Steam/steamapps/workshop/appworkshop_730.acf
# 4) mm_extra_addons / mm_client_extra_addons 填 <ID>，重启
```

`appworkshop_730.acf` 是 Valve KeyValues 文本：写坏它（例如括号不配对）会让**所有** addon 都变成
`not installed` —— 所以 `acf_upsert.py` 会在写入前做括号配对校验，并自动备份。
物品 ID 不变、内容更新时，必须**覆盖 manifest**（脚本默认 upsert，不是简单跳过）。
