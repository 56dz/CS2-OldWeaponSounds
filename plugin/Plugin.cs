// OldWeaponSounds —— CS2 每武器枪声开关（配合 soundevents addon）
//
// 背景：
//   addon(soundevents/soundevents_addon.vsndevts) 把 Weapon_XXX.Single 覆盖成 CS:GO 旧音，
//   所以**默认所有玩家听到的都是 CS:GO 旧音**。本插件只负责"把某些武器还原成 CS2 原声"。
//
// 语义：
//   总开关 enabled=false        -> 插件完全不干预（全部武器都是 addon 的旧音）
//   武器 enabled=true  (默认)   -> 插件什么都不做，原版开火音效消息照常发出 -> 客户端播 addon 的旧音
//   武器 enabled=false          -> 插件拦下该武器的原版开火音效消息(452)，
//                                  先播放 Orig_Weapon_XXX.Single(内容=CS2 原事件)，拿到非 0 guid 才屏蔽原版
//                                  —— 任何一步失败都保留原版消息，绝不出现"无声枪"
//
// 命令：
//   css_oldws status                    查看状态
//   css_oldws <item_def_index> on|off   开/关某把武器的 CS:GO 旧音（off = 还原 CS2 原声）
//   css_oldws reload                    重新读取配置文件
//   css_oldws list                      列出所有关闭（还原成 CS2 原声）的武器

using System.Text;
using System.Text.Json;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.UserMessages;
using CounterStrikeSharp.API.Modules.Utils;

namespace OldWeaponSounds;

public class WeaponCfg
{
    /// <summary>显示名（仅用于日志/命令输出）。</summary>
    public string name { get; set; } = "";

    /// <summary>items_game.txt 里的武器类名，如 weapon_ak47。用于 weapon_fire 事件关联。</summary>
    public string weapon_name { get; set; } = "";

    /// <summary>物品定义索引（= config 里的 key）。PartyHorn 没有该索引，为 null。</summary>
    public int? item_def_index { get; set; }

    /// <summary>addon 覆盖后指向 CS:GO 旧音的事件名。</summary>
    public string legacy_event { get; set; } = "";

    /// <summary>addon 里内容与 CS2 原事件完全一致的事件名，用于还原 CS2 原声。</summary>
    public string orig_event { get; set; } = "";

    /// <summary>true = 保持 CS:GO 旧音（插件不干预）；false = 还原成 CS2 原声。</summary>
    public bool enabled { get; set; } = true;
}

public class RootCfg
{
    /// <summary>插件总开关。false 时完全不干预任何音效。</summary>
    public bool enabled { get; set; } = true;

    /// <summary>诊断日志。</summary>
    public bool debug { get; set; } = true;

    /// <summary>
    /// 排错开关：true = 对所有武器都由插件显式播放旧音事件（不再依赖 subclass 检测）。
    /// 正常情况下不需要开启 —— 只有检测到自定义 subclass（换过模型）时才接管。
    /// </summary>
    public bool forceEmitAlways { get; set; } = false;

    /// <summary>按 item_def_index 索引的武器表。</summary>
    public Dictionary<string, WeaponCfg> weapons { get; set; } = new();
}

public class OldWeaponSoundsPlugin : BasePlugin
{
    public override string ModuleName => "OldWeaponSounds";
    public override string ModuleVersion => "2.0.0";
    public override string ModuleAuthor => "dsh";
    public override string ModuleDescription => "CS:GO 旧版枪声 addon 的每武器开关（把指定武器还原成 CS2 原声）";

    /// <summary>武器开火音效 usermessage（fields: weapon_id / sound_type / item_def_index）。</summary>
    private const int MsgWeaponFireSound = 452;

    /// <summary>原始诊断日志条数上限，避免刷爆日志。</summary>
    private const int MaxRawDiagnostics = 300;

    /// <summary>日志超过该字节数时在加载阶段归档。</summary>
    private const long MaxLogBytes = 2 * 1024 * 1024;

    private static readonly object FileLock = new();

    /// <summary>写文件不带 BOM：避免用户用编辑器/其它 JSON 工具打开配置时报错。</summary>
    private static readonly UTF8Encoding Utf8NoBom = new(false);

    private static string _logPath = "";

    private RootCfg _cfg = new();
    private string _cfgPath = "";

    /// <summary>weapon_fire 记录，用于把 452 关联到开枪玩家（defIndex -> player, 时间）。</summary>
    private readonly List<(int DefIndex, CCSPlayerController Player, DateTime At)> _pending = new();

    private int _rawLogged;
    private long _replaced;       // 成功还原成 CS2 原声的次数
    private long _suppressFailed; // 还原失败、保留原版音效的次数
    private int _msgSeen;

    // ---------------------------------------------------------------- 生命周期

    public override void Load(bool hotReload)
    {
        _logPath = Path.Combine(ModuleDirectory, "oldweaponsounds.log");
        _cfgPath = ResolveConfigPath();
        RotateLog();

        Log($"=== OldWeaponSounds v2.0 加载 (hotReload={hotReload}) ===");
        LoadConfig();

        HookUserMessage(MsgWeaponFireSound, OnWeaponFireSound, HookMode.Pre);
        RegisterEventHandler<EventWeaponFire>(OnWeaponFire, HookMode.Pre);

        Log($"配置: 总开关={_cfg.enabled} debug={_cfg.debug} 武器条目={_cfg.weapons.Count} " +
            $"还原成CS2原声的武器={DisabledCount()} 保持CS:GO旧音的武器={EnabledCount()}");
    }

    private void RotateLog()
    {
        try
        {
            if (File.Exists(_logPath) && new FileInfo(_logPath).Length > MaxLogBytes)
                File.Move(_logPath, _logPath + ".old", true);
        }
        catch { }
    }

    private static void Log(string msg)
    {
        try
        {
            lock (FileLock)
                File.AppendAllText(_logPath, $"[{DateTime.Now:HH:mm:ss.fff}] {msg}{Environment.NewLine}", Utf8NoBom);
        }
        catch { }
    }

    /// <summary>
    /// 内建的默认武器表（35 把）。
    /// 由 tools/gen_defaults_cs.js 从 plugin/config.json 生成，请勿手工编辑。
    /// 作用：只部署插件（不带 config.json）时，也能在惯例位置生成**完整**的默认配置。
    /// </summary>
    private static Dictionary<string, WeaponCfg> BuildDefaultWeapons() => new()
    {
        ["1"] = new WeaponCfg { name = "DEagle", weapon_name = "weapon_deagle", item_def_index = 1, legacy_event = "Weapon_DEagle.Single", orig_event = "Orig_Weapon_DEagle.Single", enabled = true },
        ["2"] = new WeaponCfg { name = "ELITE", weapon_name = "weapon_elite", item_def_index = 2, legacy_event = "Weapon_ELITE.Single", orig_event = "Orig_Weapon_ELITE.Single", enabled = true },
        ["3"] = new WeaponCfg { name = "FiveSeven", weapon_name = "weapon_fiveseven", item_def_index = 3, legacy_event = "Weapon_FiveSeven.Single", orig_event = "Orig_Weapon_FiveSeven.Single", enabled = true },
        ["4"] = new WeaponCfg { name = "Glock", weapon_name = "weapon_glock", item_def_index = 4, legacy_event = "Weapon_Glock.Single", orig_event = "Orig_Weapon_Glock.Single", enabled = true },
        ["7"] = new WeaponCfg { name = "AK47", weapon_name = "weapon_ak47", item_def_index = 7, legacy_event = "Weapon_AK47.Single", orig_event = "Orig_Weapon_AK47.Single", enabled = true },
        ["8"] = new WeaponCfg { name = "AUG", weapon_name = "weapon_aug", item_def_index = 8, legacy_event = "Weapon_AUG.Single", orig_event = "Orig_Weapon_AUG.Single", enabled = true },
        ["9"] = new WeaponCfg { name = "AWP", weapon_name = "weapon_awp", item_def_index = 9, legacy_event = "Weapon_AWP.Single", orig_event = "Orig_Weapon_AWP.Single", enabled = true },
        ["10"] = new WeaponCfg { name = "FAMAS", weapon_name = "weapon_famas", item_def_index = 10, legacy_event = "Weapon_FAMAS.Single", orig_event = "Orig_Weapon_FAMAS.Single", enabled = true },
        ["11"] = new WeaponCfg { name = "G3SG1", weapon_name = "weapon_g3sg1", item_def_index = 11, legacy_event = "Weapon_G3SG1.Single", orig_event = "Orig_Weapon_G3SG1.Single", enabled = true },
        ["13"] = new WeaponCfg { name = "Galil", weapon_name = "weapon_galilar", item_def_index = 13, legacy_event = "Weapon_GalilAR.Single", orig_event = "Orig_Weapon_GalilAR.Single", enabled = true },
        ["14"] = new WeaponCfg { name = "M249", weapon_name = "weapon_m249", item_def_index = 14, legacy_event = "Weapon_M249.Single", orig_event = "Orig_Weapon_M249.Single", enabled = true },
        ["16"] = new WeaponCfg { name = "M4A1", weapon_name = "weapon_m4a1", item_def_index = 16, legacy_event = "Weapon_M4A1.Single", orig_event = "Orig_Weapon_M4A1.Single", enabled = true },
        ["17"] = new WeaponCfg { name = "MAC10", weapon_name = "weapon_mac10", item_def_index = 17, legacy_event = "Weapon_MAC10.Single", orig_event = "Orig_Weapon_MAC10.Single", enabled = true },
        ["19"] = new WeaponCfg { name = "P90", weapon_name = "weapon_p90", item_def_index = 19, legacy_event = "Weapon_P90.Single", orig_event = "Orig_Weapon_P90.Single", enabled = true },
        ["23"] = new WeaponCfg { name = "MP5", weapon_name = "weapon_mp5sd", item_def_index = 23, legacy_event = "Weapon_MP5.Single", orig_event = "Orig_Weapon_MP5.Single", enabled = true },
        ["24"] = new WeaponCfg { name = "UMP45", weapon_name = "weapon_ump45", item_def_index = 24, legacy_event = "Weapon_UMP45.Single", orig_event = "Orig_Weapon_UMP45.Single", enabled = true },
        ["25"] = new WeaponCfg { name = "XM1014", weapon_name = "weapon_xm1014", item_def_index = 25, legacy_event = "Weapon_XM1014.Single", orig_event = "Orig_Weapon_XM1014.Single", enabled = true },
        ["26"] = new WeaponCfg { name = "bizon", weapon_name = "weapon_bizon", item_def_index = 26, legacy_event = "Weapon_bizon.Single", orig_event = "Orig_Weapon_bizon.Single", enabled = true },
        ["27"] = new WeaponCfg { name = "Mag7", weapon_name = "weapon_mag7", item_def_index = 27, legacy_event = "Weapon_Mag7.Single", orig_event = "Orig_Weapon_Mag7.Single", enabled = true },
        ["28"] = new WeaponCfg { name = "Negev", weapon_name = "weapon_negev", item_def_index = 28, legacy_event = "Weapon_Negev.Single", orig_event = "Orig_Weapon_Negev.Single", enabled = true },
        ["29"] = new WeaponCfg { name = "Sawedoff", weapon_name = "weapon_sawedoff", item_def_index = 29, legacy_event = "Weapon_Sawedoff.Single", orig_event = "Orig_Weapon_Sawedoff.Single", enabled = true },
        ["30"] = new WeaponCfg { name = "tec9", weapon_name = "weapon_tec9", item_def_index = 30, legacy_event = "Weapon_tec9.Single", orig_event = "Orig_Weapon_tec9.Single", enabled = true },
        ["31"] = new WeaponCfg { name = "Taser", weapon_name = "weapon_taser", item_def_index = 31, legacy_event = "Weapon_Taser.Single", orig_event = "Orig_Weapon_Taser.Single", enabled = true },
        ["32"] = new WeaponCfg { name = "hkp2000", weapon_name = "weapon_hkp2000", item_def_index = 32, legacy_event = "Weapon_hkp2000.Single", orig_event = "Orig_Weapon_hkp2000.Single", enabled = true },
        ["33"] = new WeaponCfg { name = "MP7", weapon_name = "weapon_mp7", item_def_index = 33, legacy_event = "Weapon_MP7.Single", orig_event = "Orig_Weapon_MP7.Single", enabled = true },
        ["34"] = new WeaponCfg { name = "MP9", weapon_name = "weapon_mp9", item_def_index = 34, legacy_event = "Weapon_MP9.Single", orig_event = "Orig_Weapon_MP9.Single", enabled = true },
        ["35"] = new WeaponCfg { name = "Nova", weapon_name = "weapon_nova", item_def_index = 35, legacy_event = "Weapon_Nova.Single", orig_event = "Orig_Weapon_Nova.Single", enabled = true },
        ["36"] = new WeaponCfg { name = "P250", weapon_name = "weapon_p250", item_def_index = 36, legacy_event = "Weapon_P250.Single", orig_event = "Orig_Weapon_P250.Single", enabled = true },
        ["38"] = new WeaponCfg { name = "SCAR20", weapon_name = "weapon_scar20", item_def_index = 38, legacy_event = "Weapon_SCAR20.Single", orig_event = "Orig_Weapon_SCAR20.Single", enabled = true },
        ["39"] = new WeaponCfg { name = "sg556", weapon_name = "weapon_sg556", item_def_index = 39, legacy_event = "Weapon_sg556.Single", orig_event = "Orig_Weapon_sg556.Single", enabled = true },
        ["40"] = new WeaponCfg { name = "SSG08", weapon_name = "weapon_ssg08", item_def_index = 40, legacy_event = "Weapon_SSG08.Single", orig_event = "Orig_Weapon_SSG08.Single", enabled = true },
        ["61"] = new WeaponCfg { name = "USP", weapon_name = "weapon_usp_silencer", item_def_index = 61, legacy_event = "Weapon_USP.Single", orig_event = "Orig_Weapon_USP.Single", enabled = true },
        ["63"] = new WeaponCfg { name = "CZ75A", weapon_name = "weapon_cz75a", item_def_index = 63, legacy_event = "Weapon_CZ75A.Single", orig_event = "Orig_Weapon_CZ75A.Single", enabled = true },
        ["64"] = new WeaponCfg { name = "Revolver", weapon_name = "weapon_revolver", item_def_index = 64, legacy_event = "Weapon_Revolver.Single", orig_event = "Orig_Weapon_Revolver.Single", enabled = true },
        ["partyhorn"] = new WeaponCfg { name = "PartyHorn", weapon_name = "weapon_partyhorn", item_def_index = null, legacy_event = "Weapon_PartyHorn.Single", orig_event = "Orig_Weapon_PartyHorn.Single", enabled = true },
    };
    private void LoadConfig()
    {
        try
        {
            if (!File.Exists(_cfgPath))
            {
                _cfg = new RootCfg { weapons = BuildDefaultWeapons() };
                SaveConfig();
                Log($"未找到配置，已生成默认配置: {_cfgPath}");
                return;
            }

            var json = File.ReadAllText(_cfgPath, Encoding.UTF8);
            var opts = new JsonSerializerOptions
            {
                ReadCommentHandling = JsonCommentHandling.Skip,
                AllowTrailingCommas = true,
                PropertyNameCaseInsensitive = true,
            };
            _cfg = JsonSerializer.Deserialize<RootCfg>(json, opts) ?? new RootCfg();
            _cfg.weapons ??= new Dictionary<string, WeaponCfg>();

            // 兼容：config 里漏写事件名时按名字补全
            foreach (var kv in _cfg.weapons)
            {
                var w = kv.Value;
                if (string.IsNullOrEmpty(w.name)) w.name = kv.Key;
                if (string.IsNullOrEmpty(w.legacy_event)) w.legacy_event = $"Weapon_{w.name}.Single";
                if (string.IsNullOrEmpty(w.orig_event)) w.orig_event = $"Orig_{w.name}.Single";
            }
        }
        catch (Exception e)
        {
            // 读配置失败时保持"不干预"，此时玩家听到的是 addon 的 CS:GO 旧音（不是无声）
            Log("读取配置失败，使用默认值(不干预任何武器): " + e.Message);
            _cfg = new RootCfg { enabled = false, debug = true };
        }
    }

    /// <summary>
    /// 配置路径遵循 CounterStrikeSharp 惯例：
    ///   &lt;counterstrikesharp&gt;/configs/plugins/&lt;插件名&gt;/&lt;插件名&gt;.json
    /// 若发现早期放在插件目录下的 config.json，则自动迁移到惯例位置。
    /// 这样升级插件（整目录替换）时不会覆盖用户的配置。
    /// </summary>
    private string ResolveConfigPath()
    {
        // ModuleDirectory = <counterstrikesharp>/plugins/<插件名>，上溯两级即 <counterstrikesharp>
        var cssRoot = Path.GetFullPath(Path.Combine(ModuleDirectory, "..", ".."));
        var preferred = Path.Combine(cssRoot, "configs", "plugins", ModuleName, ModuleName + ".json");
        var legacy = Path.Combine(ModuleDirectory, "config.json");

        if (File.Exists(preferred)) return preferred;

        if (File.Exists(legacy))
        {
            try
            {
                var dir = Path.GetDirectoryName(preferred);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.Copy(legacy, preferred);
                Log($"配置已从插件目录迁移到惯例位置: {preferred}");
                return preferred;
            }
            catch (Exception e)
            {
                Log($"迁移配置失败，继续沿用旧位置: {e.Message}");
                return legacy;
            }
        }

        return preferred;   // 全新安装：在惯例位置生成
    }

    private void SaveConfig()
    {
        try
        {
            var dir = Path.GetDirectoryName(_cfgPath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

            var header =
                $"// OldWeaponSounds 配置{Environment.NewLine}" +
                $"// 路径遵循 CounterStrikeSharp 惯例: configs/plugins/{ModuleName}/{ModuleName}.json{Environment.NewLine}" +
                $"// weapons.<def_index>.enabled = true  → 保持 addon 提供的 CS:GO 旧音{Environment.NewLine}" +
                $"//                             = false → 还原为 CS2 原声（由插件拦截并重播 Orig_ 事件）{Environment.NewLine}";

            File.WriteAllText(_cfgPath, header + JsonSerializer.Serialize(_cfg, new JsonSerializerOptions { WriteIndented = true }), Utf8NoBom);
        }
        catch (Exception e) { Log("保存配置失败: " + e.Message); }
    }

    private int DisabledCount() => _cfg.weapons.Values.Count(w => !w.enabled);
    private int EnabledCount() => _cfg.weapons.Values.Count(w => w.enabled);

    // ------------------------------------------------ weapon_fire：记录"谁开了什么枪"

    private HookResult OnWeaponFire(EventWeaponFire e, GameEventInfo info)
    {
        try
        {
            var p = e.Userid;
            if (p == null || !p.IsValid) return HookResult.Continue;

            var di = FindDefIndex(e.Weapon);
            if (di < 0) return HookResult.Continue;

            lock (_pending)
            {
                _pending.Add((di, p, DateTime.UtcNow));
                _pending.RemoveAll(x => (DateTime.UtcNow - x.At).TotalSeconds > 2.0);
            }
        }
        catch (Exception ex) { Log("weapon_fire 异常: " + ex.Message); }
        return HookResult.Continue;
    }

    private int FindDefIndex(string weaponName)
    {
        if (string.IsNullOrEmpty(weaponName)) return -1;
        foreach (var kv in _cfg.weapons)
            if (string.Equals(kv.Value.weapon_name, weaponName, StringComparison.OrdinalIgnoreCase))
                return int.TryParse(kv.Key, out var d) ? d : -1;
        return -1;
    }

    // ------------------------------------------------ 452：武器开火音效消息

    private HookResult OnWeaponFireSound(UserMessage um)
    {
        try
        {
            _msgSeen++;

            if (!_cfg.enabled) return HookResult.Continue;

            var idi = um.HasField("item_def_index") ? um.ReadInt("item_def_index") : int.MinValue;
            if (idi == int.MinValue) return HookResult.Continue;

            // 查表
            if (!_cfg.weapons.TryGetValue(idi.ToString(), out var wc)) return HookResult.Continue;

            var wid = um.HasField("weapon_id") ? um.ReadInt("weapon_id") : -1;
            var st = um.HasField("sound_type") ? um.ReadInt("sound_type") : -1;

            // 1) 定位开枪者实体（位置音效必需）
            var shooter = ResolveShooter(wid, idi);

            // 1b) 判断该武器是否被「换模型」类插件改过 subclass。
            //     换 subclass 会连带换掉整套 VData，**其中包括开火音效表 m_aShootSounds**。
            //     模型包里的 m_aShootSounds 可能是错的，甚至指向不存在的事件名
            //     （实测：AWP 皮肤写成小写的 Weapon_scar20.Single，而 CS2 真实事件是
            //      Weapon_SCAR20.Single —— 事件名按字符串哈希、区分大小写 → 未定义 → 完全无声）。
            //     所以只要检测到自定义 subclass，就由本插件显式播放「本武器正确」的旧音事件，
            //     不再依赖 VData 里写了什么。
            bool customSubclass = false;
            long subToken = 0;
            if (shooter != null)
            {
                try
                {
                    var wpn = shooter.PlayerPawn?.Value?.WeaponServices?.ActiveWeapon?.Value;
                    if (wpn != null && wpn.IsValid)
                    {
                        subToken = wpn.SubclassID.Value;
                        customSubclass = subToken != 0;
                    }
                }
                catch { }
            }

            // 决定本次显式播放哪个事件：
            //   enabled = false                → 还原 CS2 原声（orig_event）
            //   enabled = true + 自定义 subclass → 插件接管，显式播 CS:GO 旧音（legacy_event）
            //   enabled = true + 未改过          → 什么都不做，交给原版路径（addon 覆盖已生效）
            string target;
            if (!wc.enabled) target = wc.orig_event;
            else if (customSubclass || _cfg.forceEmitAlways) target = wc.legacy_event;
            else return HookResult.Continue;

            if (_cfg.debug && _rawLogged < MaxRawDiagnostics)
            {
                _rawLogged++;
                Log($"452 weapon_id={wid} sound_type={st} item_def_index={idi}({wc.name}) " +
                    $"subclass={subToken}({(customSubclass ? "已换模型" : "原版")}) -> 显式播放 {target}");
            }

            if (shooter == null)
            {
                _suppressFailed++;
                Log($"[保留原版] {wc.name}(def={idi}) 未定位到开枪者，不做任何替换（不会无声）");
                return HookResult.Continue;
            }

            var pawn = shooter.PlayerPawn?.Value;
            if (pawn == null || !pawn.IsValid)
            {
                _suppressFailed++;
                Log($"[保留原版] {wc.name}(def={idi}) 开枪者 pawn 无效，不做任何替换（不会无声）");
                return HookResult.Continue;
            }

            // 2) 先发出目标事件（legacy = CS:GO 旧音；orig = CS2 原声）
            var recipients = new RecipientFilter();
            recipients.AddAllPlayers();
            var guid = pawn.EmitSound(target, recipients, 1.0f);

            // 3) 只有拿到非 0 guid 才屏蔽原版消息（失败一律保留原版，绝不产生无声）
            if (guid == 0)
            {
                _suppressFailed++;
                Log($"[保留原版] {wc.name}(def={idi}) EmitSound(\"{target}\") 返回 guid=0，保留原版音效（不会无声）");
                return HookResult.Continue;
            }

            _replaced++;
            if (_cfg.debug)
                Log($"[已替换] {wc.name}(def={idi}) 玩家=\"{shooter.PlayerName}\" -> {target} guid={guid}，已屏蔽原版消息");

            return HookResult.Handled;
        }
        catch (Exception ex)
        {
            Log("452 处理异常(已放行原版): " + ex);
            return HookResult.Continue;
        }
    }

    /// <summary>
    /// 定位开枪者：
    ///   A. 把 weapon_id 当实体索引 -> OwnerEntity（玩家则直接返回，pawn 则反查控制器）
    ///   B. weapon_fire 事件记录的 (defIndex -> player) FIFO，取 1 秒内最近的一条
    /// 都失败返回 null（调用方会保留原版音效）。
    /// </summary>
    private CCSPlayerController ResolveShooter(int weaponId, int defIndex)
    {
        // 策略 A
        try
        {
            var ent = Utilities.GetEntityFromIndex<CBaseEntity>(weaponId);
            if (ent != null && ent.IsValid)
            {
                var owner = ent.OwnerEntity?.Value;
                if (owner != null && owner.IsValid)
                {
                    if (owner.DesignerName == "player")
                    {
                        var ctrl = owner.As<CCSPlayerController>();
                        if (ctrl != null && ctrl.IsValid) return ctrl;
                    }
                    foreach (var p in Utilities.GetPlayers())
                        if (p.IsValid && p.PlayerPawn?.Value?.Index == owner.Index) return p;
                }
            }
        }
        catch { }

        // 策略 B
        lock (_pending)
        {
            var now = DateTime.UtcNow;
            for (var i = _pending.Count - 1; i >= 0; i--)
            {
                var x = _pending[i];
                if (!x.Player.IsValid)
                {
                    _pending.RemoveAt(i);
                    continue;
                }
                if (x.DefIndex == defIndex && (now - x.At).TotalSeconds < 1.0)
                {
                    _pending.RemoveAt(i);
                    return x.Player;
                }
            }
            // 清理过期记录
            _pending.RemoveAll(x => (now - x.At).TotalSeconds > 2.0);
        }

        return null;
    }

    // ---------------------------------------------------------------- 命令

    [ConsoleCommand("css_oldws", "旧版枪声每武器开关: css_oldws status | css_oldws <item_def_index> on|off | css_oldws reload | css_oldws list")]
    public void OnOldWsCommand(CCSPlayerController? player, CommandInfo info)
    {
        var a1 = info.ArgCount > 1 ? info.GetArg(1).Trim().ToLowerInvariant() : "status";

        switch (a1)
        {
            case "reload":
                LoadConfig();
                info.ReplyToCommand($"[OldWeaponSounds] 配置已重载: 总开关={_cfg.enabled} 武器条目={_cfg.weapons.Count} 还原CS2原声={DisabledCount()}");
                return;

            case "list":
                {
                    var restored = _cfg.weapons.Where(kv => !kv.Value.enabled).Select(kv => $"{kv.Value.name}({kv.Key})").ToList();
                    info.ReplyToCommand(restored.Count == 0
                        ? "[OldWeaponSounds] 当前没有武器被还原成 CS2 原声（全部使用 CS:GO 旧音）"
                        : $"[OldWeaponSounds] 还原成 CS2 原声 ({restored.Count}): {string.Join(", ", restored)}");
                    return;
                }

            case "status":
                info.ReplyToCommand($"[OldWeaponSounds] 总开关={_cfg.enabled} debug={_cfg.debug} 武器条目={_cfg.weapons.Count} " +
                                    $"保持CS:GO旧音={EnabledCount()} 还原CS2原声={DisabledCount()}");
                info.ReplyToCommand($"[OldWeaponSounds] 已处理 452 消息={_msgSeen} 成功还原={_replaced} 还原失败(保留原版)={_suppressFailed}");
                info.ReplyToCommand("[OldWeaponSounds] 用法: css_oldws <item_def_index> on|off （on=CS:GO旧音, off=CS2原声）");
                return;
        }

        // css_oldws <item_def_index> on|off
        if (!int.TryParse(a1, out var defIndex))
        {
            info.ReplyToCommand("[OldWeaponSounds] 用法: css_oldws status | css_oldws list | css_oldws <item_def_index> on|off | css_oldws reload");
            return;
        }

        if (!_cfg.weapons.TryGetValue(defIndex.ToString(), out var wc))
        {
            info.ReplyToCommand($"[OldWeaponSounds] 未找到 item_def_index={defIndex} 的武器");
            return;
        }

        if (info.ArgCount <= 2)
        {
            info.ReplyToCommand($"[OldWeaponSounds] {wc.name}({defIndex}) 当前={(wc.enabled ? "CS:GO 旧音" : "CS2 原声")}；" +
                                $"用法: css_oldws {defIndex} on|off");
            return;
        }

        var a2 = info.GetArg(2).Trim().ToLowerInvariant();
        var isOn = a2 is "on" or "1" or "true" or "yes" or "enable";
        var isOff = a2 is "off" or "0" or "false" or "no" or "disable";
        if (!isOn && !isOff)
        {
            info.ReplyToCommand($"[OldWeaponSounds] 参数要 on 或 off，收到 \"{a2}\"");
            return;
        }

        wc.enabled = isOn;
        SaveConfig();
        info.ReplyToCommand($"[OldWeaponSounds] {wc.name}({defIndex}) -> {(isOn ? "CS:GO 旧音(插件不干预)" : "CS2 原声(插件拦截并播放 Orig 事件)")}");
        Log($"命令: {wc.name}(def={defIndex}) enabled={wc.enabled} 操作者={(player?.PlayerName ?? "服务端控制台")}");
    }
}
